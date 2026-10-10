/**
 * Keeps the checked dependency graph reproducible. Source, test and client code reach external
 * packages only through the import map in `deno.json`, which names exact versions. Documentation
 * examples are meant to be copied, so they name registry packages in full, at the import map's
 * versions, and `deno.lock` records what each of those specifiers resolved to.
 */
import { parseModule } from '@deno/graph';

const REPOSITORY_ROOT = new URL('../', import.meta.url);
/** Directories whose TypeScript modules import external packages through the import map. */
const CODE_DIRECTORIES = ['src/', 'tests/', 'clients/'];
/** Documentation whose TypeScript files and ```ts blocks are copyable examples. */
const DOCUMENTATION_PATHS = ['README.md', 'docs/'];

/** An exact semantic version, without ranges, tags or build metadata. */
const EXACT_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

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

/** The exact versions the import map pins, by each package name an example may import. */
type PinnedVersions = ReadonlyMap<string, ReadonlySet<string>>;

/** The imports of one module, as {@link readModuleImports} finds them. */
interface ModuleImports {
  /** Every specifier the module imports, without the local files it resolves to. */
  readonly specifiers: readonly string[];
  /** The 1-based lines of dynamic imports whose specifier is computed at run time. */
  readonly computedImportLines: readonly number[];
}

/** A TypeScript example from the documentation, under the module URL it is parsed as. */
interface TypeScriptExample {
  /** Where problems are reported, such as `docs/clients/typescript/polls.md, example 2`. */
  readonly label: string;
  readonly moduleUrl: URL;
  readonly source: string;
}

Deno.test('the import map pins every target to one exact version per package', async () => {
  const imports = await readImportMap();
  const problems: string[] = [];
  const versionsBySource = new Map<string, Set<string>>();
  for (const [alias, target] of Object.entries(imports)) {
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

Deno.test('code imports external packages only through the import map', async () => {
  const imports = await readImportMap();
  const problems: string[] = [];
  for (const path of await listFiles(CODE_DIRECTORIES, '.ts')) {
    const moduleImports = await readModuleImports(
      new URL(path, REPOSITORY_ROOT),
      await readRepositoryText(path),
    );
    problems.push(...computedImportProblems(path, moduleImports));
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
  const pinnedVersions = pinnedVersionsByPackage(await readImportMap());
  const problems: string[] = [];
  for (const path of await listFiles(DOCUMENTATION_PATHS, '.md', '.ts')) {
    const text = await readRepositoryText(path);
    const examples = path.endsWith('.md')
      ? extractTypeScriptExamples(path, text)
      : [{ label: path, moduleUrl: new URL(path, REPOSITORY_ROOT), source: text }];
    for (const { label, moduleUrl, source } of examples) {
      const moduleImports = await readModuleImports(moduleUrl, source);
      problems.push(...computedImportProblems(label, moduleImports));
      for (const specifier of moduleImports.specifiers) {
        if (isRelative(specifier)) continue;
        const problem = documentationSpecifierProblem(specifier, pinnedVersions);
        if (problem !== undefined) problems.push(`${label}: ${specifier} ${problem}`);
      }
    }
  }
  if (problems.length > 0) {
    throw new Error(`Documentation imports out of step with deno.json:\n${problems.join('\n')}`);
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
    new URL('tests/import_forms.ts', REPOSITORY_ROOT),
    source,
  );
  const expectedSpecifiers = [
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
  ];
  const found = JSON.stringify([...moduleImports.specifiers].sort());
  if (found !== JSON.stringify([...expectedSpecifiers].sort())) {
    throw new Error(`Expected the specifiers ${expectedSpecifiers.join(', ')}, found ${found}`);
  }
  if (JSON.stringify(moduleImports.computedImportLines) !== JSON.stringify([15, 16])) {
    throw new Error(
      `Expected computed imports on lines 15 and 16, found ${moduleImports.computedImportLines}`,
    );
  }
});

Deno.test('the specifier checks reject remote URLs, ranges and unpinned packages', () => {
  const pinnedVersions: PinnedVersions = new Map([['grammy', new Set(['1.46.0'])]]);
  const documentationCases: Array<[specifier: string, accepted: boolean]> = [
    ['npm:grammy@1.46.0', true],
    ['npm:grammy@1.46.0/types', true],
    ['npm:grammy@^1.46.0', false],
    ['npm:grammy@1', false],
    ['npm:grammy', false],
    ['npm:grammy@1.45.1', false],
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
  const { packageName, version } = registrySpecifier;
  if (version === undefined || !EXACT_VERSION.test(version)) return 'names no exact version';
  const expectedVersions = pinnedVersions.get(packageName);
  if (expectedVersions === undefined) return `names ${packageName}, which deno.json does not pin`;
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
 * The versions the import map pins, by every package name an example may use for them: the name
 * of an aliased registry package and the package name of the alias itself, so that `npm:grammy`
 * finds the version of the `grammy` alias whichever distribution it maps to.
 */
function pinnedVersionsByPackage(imports: Readonly<Record<string, string>>): PinnedVersions {
  const versionsByPackage = new Map<string, Set<string>>();
  for (const [alias, target] of Object.entries(imports)) {
    const pinning = readPinnedTarget(target);
    if (typeof pinning === 'string' || /^[a-z][a-z0-9+.-]*:/i.test(alias)) continue;
    const names = [packageNameOf(alias), parseRegistrySpecifier(target)?.packageName];
    for (const name of names) {
      if (name === undefined) continue;
      const versions = versionsByPackage.get(name) ?? new Set();
      versions.add(pinning.version);
      versionsByPackage.set(name, versions);
    }
  }
  return versionsByPackage;
}

function parseRegistrySpecifier(specifier: string): RegistrySpecifier | undefined {
  const match = specifier.match(/^(npm|jsr):((?:@[^/@]+\/)?[^/@]+)(?:@([^/]+))?(?:\/.*)?$/);
  if (match === null) return undefined;
  const [, registry, packageName, version] = match;
  return { registry: registry === 'npm' ? 'npm' : 'jsr', packageName, version };
}

/** The package an import map alias such as `hono/route` or `@std/yaml` belongs to. */
function packageNameOf(alias: string): string {
  const segments = alias.split('/');
  return alias.startsWith('@') ? segments.slice(0, 2).join('/') : segments[0];
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
 * What a module imports. Deno's own module analysis, deno_graph, finds every specifier Deno would
 * load or type-check: imports, re-exports, dynamic imports with string or plain template
 * arguments, `import()` types, `import x = require()`, triple-slash references and
 * `@ts-types`/`@deno-types` directives. Specifiers are as written, except that a directive's types
 * specifier is reported resolved; a resolved local file is left out.
 *
 * A dynamic import whose argument is computed has no specifier until it runs, so no static check
 * and no `deno.lock` entry can cover it; Deno's parser finds those through a lint rule.
 */
async function readModuleImports(moduleUrl: URL, source: string): Promise<ModuleImports> {
  const module = await parseModule(moduleUrl.href, new TextEncoder().encode(source));
  const specifiers = new Set<string>();
  const addResolved = (resolved: string | undefined) => {
    if (resolved !== undefined && !resolved.startsWith('file:')) specifiers.add(resolved);
  };
  for (const dependency of module.dependencies ?? []) {
    specifiers.add(dependency.specifier);
    addResolved(dependency.code?.specifier);
    addResolved(dependency.type?.specifier);
  }
  if (module.typesDependency !== undefined) {
    specifiers.add(module.typesDependency.specifier);
    addResolved(module.typesDependency.dependency.specifier);
  }
  const computedImports = Deno.lint.runPlugin(COMPUTED_IMPORT_PLUGIN, moduleUrl.pathname, source);
  return {
    specifiers: [...specifiers],
    computedImportLines: computedImports.map(({ range: [start] }) =>
      source.slice(0, start).split('\n').length
    ),
  };
}

/** Reports each dynamic `import()` whose argument is not a string without substitutions. */
const COMPUTED_IMPORT_PLUGIN: Deno.lint.Plugin = {
  name: 'dependency-specifiers',
  rules: {
    'computed-import': {
      create(context) {
        return {
          ImportExpression(node) {
            const { source } = node;
            const isWrittenOut = source.type === 'Literal' ||
              (source.type === 'TemplateLiteral' && source.expressions.length === 0);
            if (!isWrittenOut) context.report({ node, message: 'computed import specifier' });
          },
        };
      },
    },
  },
};

/** One problem per computed dynamic import, which no specifier rule can check. */
function computedImportProblems(label: string, imports: ModuleImports): string[] {
  return imports.computedImportLines.map((line) =>
    `${label}:${line}: computes its import specifier, which neither this check nor deno.lock covers`
  );
}

/** The TypeScript examples of a Markdown page, each with a module URL Deno can parse it under. */
function extractTypeScriptExamples(path: string, markdown: string): TypeScriptExample[] {
  return [...markdown.matchAll(/^```ts\n([\s\S]*?)^```$/gm)].map(([, source], index) => ({
    label: `${path}, example ${index + 1}`,
    moduleUrl: new URL(`${path}$${index + 1}.ts`, REPOSITORY_ROOT),
    source,
  }));
}

async function readImportMap(): Promise<Record<string, string>> {
  const configuration: unknown = JSON.parse(await readRepositoryText('deno.json'));
  if (typeof configuration !== 'object' || configuration === null) {
    throw new Error('Expected deno.json to hold an object');
  }
  const imports: unknown = Reflect.get(configuration, 'imports');
  if (typeof imports !== 'object' || imports === null) {
    throw new Error('Expected deno.json to hold an import map');
  }
  const entries = Object.entries(imports);
  const targets: Record<string, string> = {};
  for (const [alias, target] of entries) {
    if (typeof target !== 'string') throw new Error(`Expected ${alias} to map to a specifier`);
    targets[alias] = target;
  }
  return targets;
}

/** Repository-relative paths of the files with one of `extensions` at or below `roots`. */
async function listFiles(roots: readonly string[], ...extensions: string[]): Promise<string[]> {
  const paths: string[] = [];
  const pending = [...roots];
  for (let path = pending.pop(); path !== undefined; path = pending.pop()) {
    if (!path.endsWith('/')) {
      paths.push(path);
      continue;
    }
    for await (const entry of Deno.readDir(new URL(path, REPOSITORY_ROOT))) {
      if (entry.isDirectory) pending.push(`${path}${entry.name}/`);
      else if (extensions.some((extension) => entry.name.endsWith(extension))) {
        paths.push(`${path}${entry.name}`);
      }
    }
  }
  return paths.sort();
}

async function readRepositoryText(path: string): Promise<string> {
  return await Deno.readTextFile(new URL(path, REPOSITORY_ROOT));
}
