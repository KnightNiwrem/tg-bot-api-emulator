/**
 * Keeps the checked dependency graph reproducible. Every module in the repository outside `docs/`
 * reaches external packages only through the import map in `deno.json`, which names exact
 * versions, and tasks and CI steps fetch nothing by themselves. Documentation examples are meant
 * to be copied, so they name the import map's registry packages in full, from the same registry
 * and at the same versions, and `deno.lock` records what each one resolved to. grammY and
 * auto-retry, which the import map takes from their Deno source, are named by their npm packages
 * instead; see {@link ALIASES_BY_GUIDE_DISTRIBUTION}.
 *
 * Out of scope: the versions of GitHub Actions in CI, which `uses:` pins by major tag, and the
 * availability of the locked remote modules.
 */
import { parse as parseYaml } from '@std/yaml';

import {
  classifyFileName,
  type CodeExample,
  extractCodeExamples,
  MODULE_EXTENSIONS,
  type ModuleImports,
  readModuleImports,
  readRepositoryInventory,
  type RepositoryInventory,
} from './support/repository_modules.ts';

const REPOSITORY_ROOT = new URL('../', import.meta.url);
/** The directory whose modules are copyable examples rather than code that imports aliases. */
const DOCUMENTATION_DIRECTORY = 'docs/';
const CI_WORKFLOW_DIRECTORY = '.github/workflows/';

/** An exact semantic version, without ranges, tags or build metadata. */
const EXACT_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
/** `deno.json` fields that would resolve imports other than through its own `imports`. */
const RESOLUTION_OVERRIDE_FIELDS = ['importMap', 'scopes', 'workspace', 'links', 'patch'];
/**
 * A command that fetches a package or module by itself, so that neither the import map nor
 * `deno.lock` governs it: a registry or URL specifier, a package runner, or a download.
 */
const SELF_FETCHING_COMMAND = new RegExp(
  [
    String.raw`(?:^|[\s'"=(])(?:npm:|jsr:|https?://)`,
    String.raw`(?:^|[\s;&|(])(?:npx|bunx|pnpx|curl|wget)(?:\s|$)`,
    String.raw`(?:^|[\s;&|(])(?:npm|pnpm|yarn|bun)\s+(?:exec|dlx|x|install|i|ci|add)(?:\s|$)`,
  ].join('|'),
);

/** A specifier for a package in the npm or JSR registry, such as `npm:grammy@1.46.0/types`. */
interface RegistrySpecifier {
  readonly registry: 'npm' | 'jsr';
  readonly packageName: string;
  /** The version requirement as written; absent when the specifier names no version. */
  readonly version: string | undefined;
}

/** One import map target: the package source it names and the version it pins. */
interface PinnedTarget {
  /** The target without its version or path, such as `jsr:@hono/hono`. */
  readonly source: string;
  readonly version: string;
}

/** The exact versions the import map pins, by registry-qualified package such as `npm:zod`. */
type PinnedVersions = ReadonlyMap<string, ReadonlySet<string>>;

/** The parts of `deno.json` that decide how dependencies resolve and what tasks run. */
interface DenoConfiguration {
  readonly imports: Readonly<Record<string, string>>;
  readonly taskCommands: Readonly<Record<string, string>>;
  readonly resolutionOverrides: readonly string[];
}

Deno.test('the import map pins every target to one exact version per package', async () => {
  const configuration = await readDenoConfiguration();
  const problems = configuration.resolutionOverrides.map((field) =>
    `deno.json: ${field} would resolve imports outside the import map`
  );
  const versionsBySource = new Map<string, Set<string>>();
  for (const [alias, target] of Object.entries(configuration.imports)) {
    const pinning = readPinnedTarget(target);
    if (typeof pinning === 'string') {
      problems.push(`${alias}: ${pinning}`);
      continue;
    }
    const versions = versionsBySource.get(pinning.source) ?? new Set();
    versions.add(pinning.version);
    versionsBySource.set(pinning.source, versions);
  }
  for (const [source, versions] of versionsBySource) {
    if (versions.size > 1) problems.push(`${source} is pinned at ${[...versions].join(' and ')}`);
  }
  if (problems.length > 0) {
    throw new Error(`Import map targets that are not pinned exactly:\n${problems.join('\n')}`);
  }
});

Deno.test('every file is one the dependency checks can classify', async () => {
  const inventory = await readRepositoryInventory(REPOSITORY_ROOT);
  if (inventory.problems.length > 0) {
    throw new Error(`Files outside the dependency checks:\n${inventory.problems.join('\n')}`);
  }
  if (!inventory.modulePaths.includes('tests/dependency_specifiers_test.ts')) {
    throw new Error('Expected the inventory to include this test module');
  }
});

Deno.test('code imports external packages only through the import map', async () => {
  const { imports } = await readDenoConfiguration();
  const inventory = await readRepositoryInventory(REPOSITORY_ROOT);
  const problems: string[] = [];
  for (const path of inventory.modulePaths) {
    if (path.startsWith(DOCUMENTATION_DIRECTORY)) continue;
    const moduleImports = await readModuleImports(
      REPOSITORY_ROOT,
      new URL(path, REPOSITORY_ROOT),
      await readRepositoryText(path),
    );
    problems.push(...moduleScopeProblems(path, moduleImports, inventory));
    for (const specifier of moduleImports.specifiers) {
      if (!isRelative(specifier) && !isNodeBuiltIn(specifier) && !isMapped(specifier, imports)) {
        problems.push(`${path}: ${specifier}`);
      }
    }
  }
  if (problems.length > 0) {
    throw new Error(`Imports that bypass the import map:\n${problems.join('\n')}`);
  }
});

Deno.test('documentation examples name registry packages at import map versions', async () => {
  const pinnedVersions = pinnedVersionsByPackage((await readDenoConfiguration()).imports);
  const inventory = await readRepositoryInventory(REPOSITORY_ROOT);
  const examples: CodeExample[] = [];
  for (const path of inventory.documentationPaths) {
    examples.push(...extractCodeExamples(REPOSITORY_ROOT, path, await readRepositoryText(path)));
  }
  for (const path of inventory.modulePaths) {
    if (!path.startsWith(DOCUMENTATION_DIRECTORY)) continue;
    const moduleUrl = new URL(path, REPOSITORY_ROOT);
    examples.push({ label: path, moduleUrl, source: await readRepositoryText(path) });
  }
  const problems: string[] = [];
  for (const { label, moduleUrl, source } of examples) {
    const moduleImports = await readModuleImports(REPOSITORY_ROOT, moduleUrl, source);
    problems.push(...moduleScopeProblems(label, moduleImports, inventory));
    for (const specifier of moduleImports.specifiers) {
      if (isRelative(specifier)) continue;
      const problem = documentationSpecifierProblem(specifier, pinnedVersions);
      if (problem !== undefined) problems.push(`${label}: ${specifier} ${problem}`);
    }
  }
  if (problems.length > 0) {
    throw new Error(`Documentation imports out of step with deno.json:\n${problems.join('\n')}`);
  }
});

Deno.test('tasks and CI steps fetch packages only through the import map', async () => {
  const commands = Object.entries((await readDenoConfiguration()).taskCommands).map((
    [name, command],
  ) => ({ label: `deno.json task ${name}`, command }));
  for await (const entry of Deno.readDir(new URL(CI_WORKFLOW_DIRECTORY, REPOSITORY_ROOT))) {
    const path = `${CI_WORKFLOW_DIRECTORY}${entry.name}`;
    const workflow: unknown = parseYaml(await readRepositoryText(path));
    for (const command of collectRunCommands(workflow)) commands.push({ label: path, command });
  }
  const problems = commands.filter(({ command }) => SELF_FETCHING_COMMAND.test(command)).map((
    { label, command },
  ) => `${label}: ${command}`);
  if (problems.length > 0) {
    throw new Error(`Commands that fetch outside the import map:\n${problems.join('\n')}`);
  }
});

Deno.test('import discovery finds every written import form and flags computed ones', async () => {
  const source = [
    '/// <reference types="npm:reference-types@latest" />',
    "import { a } from 'npm:static@latest';",
    "import type { T } from 'npm:type-only@latest';",
    "export * from 'https://example.com/re-export.ts';",
    '// @ts-types="npm:ts-types@latest"',
    "import b from 'npm:typed@latest';",
    "type U = import('npm:import-type@latest').U;",
    'await import(`npm:template@latest`);',
    "await import(/* a comment */ 'npm:commented@latest');",
    "await import('npm:attributes@latest', { with: { type: 'json' } });",
    "import c from './local.ts';",
    "// import('npm:in-a-comment@latest');",
    'const text = "import(\'npm:in-a-string@latest\')";',
    "const name = 'computed';",
    'await import(`npm:${name}@latest`);',
    'await import(name);',
  ].join('\n');
  const moduleImports = await readModuleImports(
    REPOSITORY_ROOT,
    new URL('tests/import_forms.ts', REPOSITORY_ROOT),
    source,
  );
  assertSameItems(moduleImports.specifiers, [
    'npm:reference-types@latest',
    'npm:static@latest',
    'npm:type-only@latest',
    'https://example.com/re-export.ts',
    'npm:ts-types@latest',
    'npm:typed@latest',
    'npm:import-type@latest',
    'npm:template@latest',
    'npm:commented@latest',
    'npm:attributes@latest',
    './local.ts',
  ], 'specifiers');
  assertSameItems(moduleImports.localPaths, ['tests/local.ts'], 'local files');
  assertSameItems(moduleImports.computedImportLines, [15, 16], 'computed import lines');

  const jsxModule = await readModuleImports(
    REPOSITORY_ROOT,
    new URL('clients/view.tsx', REPOSITORY_ROOT),
    "import { h } from 'npm:preact@latest';\nexport const view = <div>{h}</div>;\n",
  );
  assertSameItems(jsxModule.specifiers, ['npm:preact@latest'], 'JSX module specifiers');
});

Deno.test('the inventory classifies every Deno module extension and refuses unknown ones', () => {
  const cases: Array<[name: string, classification: ReturnType<typeof classifyFileName>]> = [
    ...MODULE_EXTENSIONS.map((extension): [string, 'module'] => [`view${extension}`, 'module']),
    ['view_test.tsx', 'module'],
    ['types.d.ts', 'module'],
    ['README.md', 'documentation'],
    ['openapi.yaml', 'data'],
    ['.fallowrc.json', 'data'],
    ['deno.lock', 'data'],
    ['deno.json', 'configuration'],
    ['package.json', 'configuration'],
    ['import_map.json', 'configuration'],
    ['LICENSE', 'extensionless'],
    ['.gitignore', 'extensionless'],
    ['module.wasm', 'unrecognised'],
    ['component.vue', 'unrecognised'],
    ['script.coffee', 'unrecognised'],
  ];
  for (const [name, expected] of cases) {
    const classification = classifyFileName(name);
    if (classification !== expected) {
      throw new Error(`Expected ${name} to classify as ${expected}, not ${classification}`);
    }
  }
  const markdown = [
    '```tsx',
    "import { h } from 'npm:preact@latest';",
    '```',
    '```sh',
    'deno task start',
    '```',
    '```javascript',
    "import 'npm:left-pad@latest';",
    '```',
  ].join('\n');
  const examples = extractCodeExamples(REPOSITORY_ROOT, 'docs/page.md', markdown);
  assertSameItems(
    examples.map(({ moduleUrl }) => moduleUrl.pathname.slice(REPOSITORY_ROOT.pathname.length)),
    ['docs/page.md$1.tsx', 'docs/page.md$2.js'],
    'example modules',
  );
});

Deno.test('the command check rejects package runners, registry specifiers and downloads', () => {
  const cases: Array<[command: string, fetchesBySelf: boolean]> = [
    ['deno run -A fallow dead-code --boundary-violations', false],
    ['deno run --allow-read --allow-env @redocly/cli lint openapi/openapi.yaml', false],
    ['deno test --allow-net=127.0.0.1 --allow-import=cdn.jsdelivr.net,jsr.io', false],
    ['git diff --exit-code -- deno.lock', false],
    ['deno task ${{ matrix.task }}', false],
    ['npx --yes @redocly/cli@2.54.2 lint openapi/openapi.yaml', true],
    ['deno run -A npm:@redocly/cli@2.54.2 lint', true],
    ['deno run jsr:@std/http@1.0.0/file-server', true],
    ['deno run https://example.com/script.ts', true],
    ['deno test && npm exec redocly', true],
    ['curl -fsSL https://example.com/install.sh | sh', true],
  ];
  for (const [command, fetchesBySelf] of cases) {
    if (SELF_FETCHING_COMMAND.test(command) !== fetchesBySelf) {
      throw new Error(`Expected ${command} to be ${fetchesBySelf ? 'rejected' : 'accepted'}`);
    }
  }
});

Deno.test('the specifier checks reject remote URLs, ranges and unpinned packages', () => {
  const pinnedVersions = pinnedVersionsByPackage({
    'grammy': 'https://cdn.jsdelivr.net/gh/grammyjs/grammY@v1.46.0/src/mod.ts',
    '@grammyjs/auto-retry': 'https://cdn.jsdelivr.net/gh/grammyjs/auto-retry@v2.0.2/src/mod.ts',
    'hono': 'jsr:@hono/hono@4.13.13',
    'zod': 'npm:zod@4.6.5',
  });
  const documentationCases: Array<[specifier: string, accepted: boolean]> = [
    ['npm:grammy@1.46.0', true],
    ['npm:grammy@1.46.0/types', true],
    ['npm:@grammyjs/auto-retry@2.0.2', true],
    ['jsr:@hono/hono@4.13.13', true],
    ['npm:zod@4.6.5', true],
    ['npm:grammy@^1.46.0', false],
    ['npm:grammy@1', false],
    ['npm:grammy', false],
    ['npm:grammy@1.45.1', false],
    // The pinned version, but from another registry or under the alias's name.
    ['jsr:@grammyjs/grammy@1.46.0', false],
    ['npm:hono@4.13.13', false],
    ['npm:@hono/hono@4.13.13', false],
    ['jsr:zod@4.6.5', false],
    ['jsr:@std/assert@1.0.19', false],
    ['https://cdn.jsdelivr.net/gh/grammyjs/grammY@v1.46.0/src/mod.ts', false],
    ['grammy', false],
  ];
  for (const [specifier, accepted] of documentationCases) {
    const problem = documentationSpecifierProblem(specifier, pinnedVersions);
    if ((problem === undefined) !== accepted) {
      throw new Error(`Expected ${specifier} to be ${accepted ? 'accepted' : 'rejected'}`);
    }
  }
  const targetCases: Array<[target: string, accepted: boolean]> = [
    ['npm:zod@4.6.5', true],
    ['jsr:@hono/hono@4.13.13/route', true],
    ['https://cdn.jsdelivr.net/gh/grammyjs/grammY@v1.46.0/src/mod.ts', true],
    ['npm:zod@^4.6.5', false],
    ['jsr:@std/yaml@1', false],
    ['https://cdn.jsdelivr.net/gh/grammyjs/grammY@^1.46.0/src/mod.ts', false],
    ['https://lib.deno.dev/x/grammy@v1/mod.ts', false],
    ['http://cdn.jsdelivr.net/gh/grammyjs/grammY@v1.46.0/src/mod.ts', false],
    ['./vendor/grammy/mod.ts', false],
  ];
  for (const [target, accepted] of targetCases) {
    if ((typeof readPinnedTarget(target) !== 'string') !== accepted) {
      throw new Error(
        `Expected import map target ${target} to be ${accepted ? 'accepted' : 'rejected'}`,
      );
    }
  }
  const imports = {
    'grammy': 'https://cdn.jsdelivr.net/gh/grammyjs/grammY@v1.46.0/src/mod.ts',
    'ajv': 'npm:ajv@8.17.1',
    'https://lib.deno.dev/x/grammy@v1/': 'x',
  };
  const codeCases: Array<[specifier: string, accepted: boolean]> = [
    ['grammy', true],
    ['https://lib.deno.dev/x/grammy@v1/mod.ts', true],
    ['ajv/dist/2020.js', true],
    ['grammy/types', false],
    ['ajv-formats', false],
    ['npm:grammy@1.46.0', false],
    ['https://cdn.jsdelivr.net/gh/grammyjs/grammY@v1.46.0/src/mod.ts', false],
  ];
  for (const [specifier, accepted] of codeCases) {
    if (isMapped(specifier, imports) !== accepted) {
      throw new Error(
        `Expected code import ${specifier} to be ${accepted ? 'accepted' : 'rejected'}`,
      );
    }
  }
});

/** Why a documentation example may not import `specifier`, or `undefined` when it may. */
function documentationSpecifierProblem(
  specifier: string,
  pinnedVersions: PinnedVersions,
): string | undefined {
  const registrySpecifier = parseRegistrySpecifier(specifier);
  if (registrySpecifier === undefined) {
    return 'is not a fully qualified npm: or jsr: specifier';
  }
  const { registry, packageName, version } = registrySpecifier;
  if (version === undefined || !EXACT_VERSION.test(version)) return 'names no exact version';
  const registryPackage = `${registry}:${packageName}`;
  const expectedVersions = pinnedVersions.get(registryPackage);
  if (expectedVersions === undefined) {
    return `names ${registryPackage}, which deno.json does not pin from that registry`;
  }
  if (!expectedVersions.has(version)) {
    return `differs from the version deno.json pins, ${[...expectedVersions].join(' or ')}`;
  }
  return undefined;
}

/**
 * The source and exact version an import map target pins, or why it pins none. Remote targets must
 * be HTTPS URLs whose path names an exact version, such as `.../grammY@v1.46.0/src/mod.ts`.
 */
function readPinnedTarget(target: string): PinnedTarget | string {
  const registrySpecifier = parseRegistrySpecifier(target);
  if (registrySpecifier !== undefined) {
    const { registry, packageName, version } = registrySpecifier;
    if (version === undefined || !EXACT_VERSION.test(version)) {
      return `${target} names no exact version`;
    }
    return { source: `${registry}:${packageName}`, version };
  }
  if (!target.startsWith('https://')) return `${target} is neither a registry package nor HTTPS`;
  const versionedPath = target.match(/^(https:\/\/[^@]+)@v?([^/]+)\//);
  if (versionedPath === null || !EXACT_VERSION.test(versionedPath[2])) {
    return `${target} names no exact version in its path`;
  }
  return { source: versionedPath[1], version: versionedPath[2] };
}

/**
 * The registry packages the guide imports for import map aliases that map to another distribution
 * of the same release, each with the alias whose version it must match. The guide's readers run
 * grammY from npm, as grammY documents for Deno. The repository's own tests import grammY and its
 * plugins as Deno source modules, because the npm build passes Node-specific request options to a
 * custom `fetch`, which the tests' in-process `fetch` cannot accept.
 */
const ALIASES_BY_GUIDE_DISTRIBUTION: ReadonlyMap<string, string> = new Map([
  ['npm:grammy', 'grammy'],
  ['npm:@grammyjs/auto-retry', '@grammyjs/auto-retry'],
]);

/**
 * The versions the import map pins, by registry-qualified package such as `jsr:@hono/hono`: the
 * registry targets themselves, and each guide distribution of an alias that maps elsewhere.
 */
function pinnedVersionsByPackage(imports: Readonly<Record<string, string>>): PinnedVersions {
  const versionsByPackage = new Map<string, Set<string>>();
  const addVersion = (registryPackage: string, version: string) => {
    const versions = versionsByPackage.get(registryPackage) ?? new Set();
    versions.add(version);
    versionsByPackage.set(registryPackage, versions);
  };
  for (const target of Object.values(imports)) {
    const pinning = readPinnedTarget(target);
    if (typeof pinning !== 'string' && parseRegistrySpecifier(target) !== undefined) {
      addVersion(pinning.source, pinning.version);
    }
  }
  for (const [registryPackage, alias] of ALIASES_BY_GUIDE_DISTRIBUTION) {
    const target = imports[alias];
    const pinning = target === undefined ? undefined : readPinnedTarget(target);
    if (pinning === undefined || typeof pinning === 'string') {
      throw new Error(
        `Expected deno.json to pin the ${alias} alias that ${registryPackage} follows`,
      );
    }
    addVersion(registryPackage, pinning.version);
  }
  return versionsByPackage;
}

function parseRegistrySpecifier(specifier: string): RegistrySpecifier | undefined {
  const match = specifier.match(/^(npm|jsr):((?:@[^/@]+\/)?[^/@]+)(?:@([^/]+))?(?:\/.*)?$/);
  if (match === null) return undefined;
  const [, registry, packageName, version] = match;
  return { registry: registry === 'npm' ? 'npm' : 'jsr', packageName, version };
}

/**
 * Whether the import map resolves `specifier`: by an exact entry, by a prefix ending in `/`, or by
 * a subpath of an entry that maps to a registry package, such as `ajv/dist/2020.js` for `ajv`,
 * which Deno resolves within that package.
 */
function isMapped(specifier: string, imports: Readonly<Record<string, string>>): boolean {
  return Object.entries(imports).some(([key, target]) =>
    key === specifier || (key.endsWith('/') && specifier.startsWith(key)) ||
    (parseRegistrySpecifier(target) !== undefined && specifier.startsWith(`${key}/`))
  );
}

function isRelative(specifier: string): boolean {
  return specifier.startsWith('./') || specifier.startsWith('../');
}

function isNodeBuiltIn(specifier: string): boolean {
  return specifier.startsWith('node:');
}

/**
 * Problems that no allowed specifier can excuse: dynamic imports whose specifier is computed, and
 * local imports of files the inventory does not cover, such as a module in an ignored directory.
 * A local data or text file, such as an OpenAPI schema a test reads, imports nothing.
 */
function moduleScopeProblems(
  label: string,
  moduleImports: ModuleImports,
  inventory: RepositoryInventory,
): string[] {
  const problems = moduleImports.computedImportLines.map((line) =>
    `${label}:${line}: computes its import specifier, which neither this check nor deno.lock covers`
  );
  for (const path of moduleImports.localPaths) {
    if (!inventory.kindsByPath.has(path)) {
      problems.push(`${label}: imports ${path}, which the dependency checks do not cover`);
    }
  }
  return problems;
}

/** Every `run` command in a parsed CI workflow, wherever its steps are. */
function collectRunCommands(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(collectRunCommands);
  if (typeof value !== 'object' || value === null) return [];
  return Object.entries(value).flatMap(([key, child]) =>
    key === 'run' && typeof child === 'string' ? [child] : collectRunCommands(child)
  );
}

function assertSameItems<T>(actual: readonly T[], expected: readonly T[], what: string): void {
  const sortedActual = JSON.stringify([...actual].sort());
  const sortedExpected = JSON.stringify([...expected].sort());
  if (sortedActual !== sortedExpected) {
    throw new Error(`Expected the ${what} ${sortedExpected}, found ${sortedActual}`);
  }
}

async function readDenoConfiguration(): Promise<DenoConfiguration> {
  const configuration: unknown = JSON.parse(await readRepositoryText('deno.json'));
  if (typeof configuration !== 'object' || configuration === null) {
    throw new Error('Expected deno.json to hold an object');
  }
  return {
    imports: readStringRecord(Reflect.get(configuration, 'imports'), 'imports', (target) => target),
    taskCommands: readStringRecord(Reflect.get(configuration, 'tasks'), 'tasks', (task) => {
      const command: unknown = typeof task === 'object' && task !== null
        ? Reflect.get(task, 'command')
        : task;
      return command;
    }),
    resolutionOverrides: RESOLUTION_OVERRIDE_FIELDS.filter((field) => field in configuration),
  };
}

/** Reads a `deno.json` object whose entries `read` turns into strings, rejecting other shapes. */
function readStringRecord(
  value: unknown,
  field: string,
  read: (entry: unknown) => unknown,
): Record<string, string> {
  if (typeof value !== 'object' || value === null) {
    throw new Error(`Expected deno.json to hold ${field}`);
  }
  const record: Record<string, string> = {};
  for (const [name, entry] of Object.entries(value)) {
    const text = read(entry);
    if (typeof text !== 'string') throw new Error(`Expected deno.json ${field}.${name} as text`);
    record[name] = text;
  }
  return record;
}

async function readRepositoryText(path: string): Promise<string> {
  return await Deno.readTextFile(new URL(path, REPOSITORY_ROOT));
}
