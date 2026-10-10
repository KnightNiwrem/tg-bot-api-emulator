/**
 * Keeps the checked dependency graph reproducible.
 *
 * - Every module in the repository outside `docs/` reaches external packages only through the
 *   import map in `deno.json`, which names exact versions.
 * - Documentation examples are meant to be copied, so they name the import map's registry packages
 *   in full, from the same registry and at the same versions; `deno.lock` records what each one
 *   resolved to. Examples are every script code block of every Markdown page and JSDoc comment,
 *   whatever its fence, and every module under `docs/`. grammY and auto-retry, which the import
 *   map takes from their Deno source, are named by their npm packages instead; see
 *   `ALIASES_BY_GUIDE_DISTRIBUTION`.
 * - Tasks, CI steps and shell examples fetch nothing by themselves and do not override resolution
 *   or locking; only the `lock:update` task may unfreeze the lock, and `deno.json` must freeze it.
 * - Every file in the repository is classified, so none escapes the scan unnoticed, and the local
 *   files that modules import and that tasks and CI steps run must be ones the scan covers.
 *
 * Out of scope, by design. Wherever Deno itself loads a module, `deno.lock` still holds it:
 * - the versions of GitHub Actions, which `uses:` pins by major tag;
 * - whether the locked remote modules stay available, which only vendoring could guarantee;
 * - transitive version ranges inside packages, which `deno.lock` resolves and freezes;
 * - what a locked tool, such as fallow or Redocly, does when it runs, including processes it
 *   starts; no task that runs repository code grants `--allow-run`;
 * - source a program fetches and evaluates itself (`eval`, `new Function`, WebAssembly from
 *   fetched bytes), which is not a module import;
 * - loads written indirectly, such as a `Worker` constructor under another name, or a command
 *   that assembles a specifier from shell variables or the environment;
 * - code in documentation languages other than scripts and shell, such as JSON, in inline code
 *   spans, or in HTML `<pre>` blocks, which `deno check --doc-only` does not check either;
 * - differences between deno_graph 0.111.0 and the analysis built into the pinned Deno.
 */
import { parse as parseYaml } from '@std/yaml';

import {
  analysisProblems,
  type CodeExample,
  codeSpecifierProblem,
  collectWorkflowStrings,
  commandProblem,
  type DenoConfiguration,
  documentationSpecifierProblem,
  importMapProblems,
  isMapped,
  type LabelledCommand,
  LOCK_REFRESH_TASK,
  modulePathArguments,
  pinnedVersionsByPackage,
  readDenoConfiguration,
  readPinnedTarget,
  sortDocumentationBlocks,
} from './support/dependency_policy.ts';
import {
  classifyFileName,
  type CodeBlock,
  extractMarkdownCodeBlocks,
  MODULE_EXTENSIONS,
  readModuleAnalysis,
  readRepositoryInventory,
} from './support/repository_modules.ts';

const REPOSITORY_ROOT = new URL('../', import.meta.url);
/** The directory whose modules are copyable examples rather than code that imports aliases. */
const DOCUMENTATION_DIRECTORY = 'docs/';
const CI_DIRECTORY = '.github/';

Deno.test('the import map pins every target to one exact version per package', async () => {
  const problems = importMapProblems(await readDenoConfiguration(REPOSITORY_ROOT));
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
  const { imports } = await readDenoConfiguration(REPOSITORY_ROOT);
  const inventory = await readRepositoryInventory(REPOSITORY_ROOT);
  const problems: string[] = [];
  for (const path of inventory.modulePaths) {
    if (path.startsWith(DOCUMENTATION_DIRECTORY)) continue;
    const analysis = await readModuleAnalysis(
      REPOSITORY_ROOT,
      new URL(path, REPOSITORY_ROOT),
      await readRepositoryText(path),
    );
    problems.push(...analysisProblems(path, analysis, inventory));
    for (const specifier of analysis.specifiers) {
      const problem = codeSpecifierProblem(specifier, imports);
      if (problem !== undefined) problems.push(`${path}: ${specifier} ${problem}`);
    }
  }
  if (problems.length > 0) {
    throw new Error(`Imports that bypass the import map:\n${problems.join('\n')}`);
  }
});

Deno.test('documentation examples name registry packages at import map versions', async () => {
  const configuration = await readDenoConfiguration(REPOSITORY_ROOT);
  const problems = await documentationProblems(configuration);
  if (problems.length > 0) {
    throw new Error(`Documentation out of step with deno.json:\n${problems.join('\n')}`);
  }
});

Deno.test('tasks and CI steps fetch packages only through the import map', async () => {
  const configuration = await readDenoConfiguration(REPOSITORY_ROOT);
  const inventory = await readRepositoryInventory(REPOSITORY_ROOT);
  const commands: LabelledCommand[] = Object.entries(configuration.taskCommands).map((
    [name, command],
  ) => ({ label: `deno.json task ${name}`, command, mayUnfreezeLock: name === LOCK_REFRESH_TASK }));
  for (const [path, kind] of inventory.kindsByPath) {
    if (kind !== 'data' || !path.startsWith(CI_DIRECTORY) || !/\.ya?ml$/.test(path)) continue;
    for (const command of collectWorkflowStrings(parseYaml(await readRepositoryText(path)))) {
      commands.push({ label: path, command, mayUnfreezeLock: false });
    }
  }
  const problems: string[] = [];
  for (const { label, command } of commands) {
    for (const path of modulePathArguments(command)) {
      if (!inventory.modulePaths.includes(path)) {
        problems.push(`${label}: runs ${path}, which the dependency checks do not cover`);
      }
    }
  }
  for (const command of commands) {
    const problem = commandProblem(command);
    if (problem !== undefined) problems.push(`${command.label}: ${problem}: ${command.command}`);
  }
  if (problems.length > 0) {
    throw new Error(`Commands that escape the import map or lock:\n${problems.join('\n')}`);
  }
});

Deno.test('import discovery finds every written import and flags untraceable loads', async () => {
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
    "new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });",
    "new Worker('npm:worker@latest', { type: 'module' });",
    'new Worker(new URL(name, import.meta.url));',
  ].join('\n');
  const analysis = await readModuleAnalysis(
    REPOSITORY_ROOT,
    new URL('tests/import_forms.ts', REPOSITORY_ROOT),
    source,
  );
  assertSameItems(analysis.specifiers, [
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
  assertSameItems(analysis.localPaths, ['tests/local.ts'], 'local files');
  assertSameItems(
    analysis.untraceableLoads.map(({ line }) => line),
    [15, 16, 18, 19],
    'untraceable load lines',
  );

  const jsxModule = await readModuleAnalysis(
    REPOSITORY_ROOT,
    new URL('clients/view.tsx', REPOSITORY_ROOT),
    [
      '/** @jsxImportSource npm:preact@latest */',
      "import { h } from 'npm:hooks@latest';",
      'export const view = <div>{h}</div>;',
    ].join('\n'),
  );
  assertSameItems(
    jsxModule.specifiers,
    ['npm:hooks@latest', 'npm:preact@latest/jsx-runtime'],
    'JSX module specifiers',
  );
});

Deno.test('every CommonMark code block is found, as Deno checks or a reader copies it', () => {
  const markdown = [
    '```ts', // 1: Deno checks it
    "import 'npm:backticks@^1';",
    '```',
    '~~~ts', // 4: a reader copies it, though Deno does not check tilde fences
    "import 'npm:tildes@^1';",
    '~~~',
    '````ts', // 7
    "import 'npm:four-backticks@^1';",
    '````',
    '   ```ts', // 10
    "   import 'npm:indented-fence@^1';",
    '   ```',
    '```ts   ', // 13
    "import 'npm:trailing-whitespace@^1';",
    '```   ',
    '``` ts', // 16: a reader copies it, though Deno does not check it
    "import 'npm:space-before-info@^1';",
    '```',
    '```TS title="x" ignore', // 19: a reader copies it, though Deno does not check it
    "import 'npm:attributes@^1';",
    '```',
    '- item',
    '',
    '  ```tsx', // 24
    "  import 'npm:in-a-list@^1';",
    '  ```',
    '',
    '> ```javascript', // 28
    "> import 'npm:in-a-quote@^1';",
    '> ```',
    '',
    '```sh', // 32
    'npx left-pad',
    '```',
    '',
    '```json', // 36
    '{ "imports": {} }',
    '```',
    '',
    '```', // 40
    "import 'npm:untagged@^1';",
    '```',
    '',
    "    import 'npm:indented-code@^1';", // 44
    '',
    '```ts', // 46: left open, it runs to the end of the document
    "import 'npm:unclosed@^1';",
  ].join('\n');
  const blocks = extractMarkdownCodeBlocks(markdown);
  assertSameItems(
    blocks.map(({ line, isFenced, language }) => `${line} ${isFenced} ${language}`),
    [
      '1 true ts',
      '4 true ts',
      '7 true ts',
      '10 true ts',
      '13 true ts',
      '16 true ts',
      '19 true ts',
      '24 true tsx',
      '28 true javascript',
      '32 true sh',
      '36 true json',
      '40 true undefined',
      '44 false undefined',
      '46 true ts',
    ],
    'code blocks',
  );
  const content = sortDocumentationBlocks(REPOSITORY_ROOT, 'docs/page.md', blocks);
  assertSameItems(
    content.examples.map(({ label }) => label),
    [1, 4, 7, 10, 13, 16, 19, 24, 28, 46].map((line) => `docs/page.md:${line}`),
    'script examples',
  );
  assertSameItems(content.commands.map(({ label }) => label), ['docs/page.md:32'], 'commands');
  assertSameItems(
    content.problems,
    [
      'docs/page.md:40: a code fence without a language; name its language',
      'docs/page.md:44: an indented code block; fence it and name its language',
    ],
    'block problems',
  );
});

Deno.test('every documentation form holds its imports to the pinned versions', async () => {
  const pinnedVersions = pinnedVersionsByPackage({
    'grammy': 'https://cdn.jsdelivr.net/gh/grammyjs/grammY@v1.46.0/src/mod.ts',
    '@grammyjs/auto-retry': 'https://cdn.jsdelivr.net/gh/grammyjs/auto-retry@v2.0.2/src/mod.ts',
  });
  const forms = [
    ['```ts', '```'],
    ['~~~ts', '~~~'],
    ['````ts', '````'],
    ['   ```ts', '   ```'],
    ['```ts   ', '```   '],
    ['``` ts', '```'],
    ['```TS ignore', '```'],
    ['```tsx', '```'],
    ['```javascript', '```'],
  ];
  for (const [open, close] of forms) {
    const markdown = `${open}\nimport 'npm:grammy@^1.46.0';\n${close}\n`;
    const { examples } = sortDocumentationBlocks(
      REPOSITORY_ROOT,
      'docs/page.md',
      extractMarkdownCodeBlocks(markdown),
    );
    const specifiers = await Promise.all(
      examples.map(async ({ moduleUrl, source }) =>
        (await readModuleAnalysis(REPOSITORY_ROOT, moduleUrl, source)).specifiers
      ),
    );
    const rejected = specifiers.flat().filter((specifier) =>
      documentationSpecifierProblem(specifier, pinnedVersions) !== undefined
    );
    if (rejected.length !== 1) {
      throw new Error(`Expected the ${JSON.stringify(open)} fence to reject npm:grammy@^1.46.0`);
    }
  }

  const jsDoc = await readModuleAnalysis(
    REPOSITORY_ROOT,
    new URL('clients/documented.ts', REPOSITORY_ROOT),
    [
      '/**',
      ' * Sends a message.',
      ' *',
      ' * ```ts',
      " * import { Bot } from 'npm:grammy@^1';",
      ' * ```',
      ' *',
      ' * @example',
      " * import { autoRetry } from 'npm:@grammyjs/auto-retry@^2';",
      ' */',
      'export function send(): void {}',
    ].join('\n'),
  );
  const jsDocContent = sortDocumentationBlocks(
    REPOSITORY_ROOT,
    'clients/documented.ts',
    jsDoc.documentationBlocks,
  );
  assertSameItems(
    jsDocContent.examples.map(({ label }) => label),
    ['clients/documented.ts:4', 'clients/documented.ts:8'],
    'JSDoc examples',
  );
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
    ['install.sh', 'unrecognised'],
  ];
  for (const [name, expected] of cases) {
    const classification = classifyFileName(name);
    if (classification !== expected) {
      throw new Error(`Expected ${name} to classify as ${expected}, not ${classification}`);
    }
  }
});

Deno.test('the command check rejects fetching, resolution overrides and unfreezing', () => {
  const cases: Array<[command: string, mayUnfreezeLock: boolean, accepted: boolean]> = [
    ['deno run -A fallow dead-code --boundary-violations', false, true],
    ['deno run --allow-read --allow-env @redocly/cli lint openapi/openapi.yaml', false, true],
    ['deno test --allow-net=127.0.0.1 --allow-import=cdn.jsdelivr.net,jsr.io', false, true],
    ['git diff --exit-code -- deno.lock', false, true],
    ['deno task ${{ matrix.task }}', false, true],
    ['deno install --frozen=false --allow-import=jsr.io', true, true],
    ['deno install --frozen=false --allow-import=jsr.io', false, false],
    ['npx --yes @redocly/cli@2.54.2 lint openapi/openapi.yaml', false, false],
    ['deno run -A npm:@redocly/cli@2.54.2 lint', false, false],
    ['deno run jsr:@std/http@1.0.0/file-server', false, false],
    ['deno run https://example.com/script.ts', false, false],
    ['deno test && npm exec redocly', false, false],
    ["curl 'http://localhost:8081/sessions/1/bot-activity?after=0'", false, true],
    ['curl -fsSL https://example.com/install.sh | sh', false, false],
    ['deno run -A "https://example.com/script.ts"', false, false],
    ['deno test --import-map=other.json', false, false],
    ['deno test --no-lock', false, false],
    ['deno run --config other.json src/main.ts', false, false],
    ['deno run -c other.json src/main.ts', false, false],
    ['deno install --allow-scripts', false, false],
    ['deno test\nnpx left-pad', false, false],
  ];
  for (const [command, mayUnfreezeLock, accepted] of cases) {
    const problem = commandProblem({ label: 'case', command, mayUnfreezeLock });
    if ((problem === undefined) !== accepted) {
      throw new Error(
        `Expected ${JSON.stringify(command)} to be ${accepted ? 'accepted' : 'rejected'}`,
      );
    }
  }
  assertSameItems(
    modulePathArguments('deno run --allow-read=. ./tests/support/report.ts out.jsonl src/'),
    ['tests/support/report.ts'],
    'module path arguments',
  );
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
    ['../../../clients/typescript/mod.ts', true],
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
  const overridden = importMapProblems({
    imports: { 'grammy': 'https://cdn.jsdelivr.net/gh/grammyjs/grammY@v1.46.0/src/mod.ts' },
    taskCommands: {},
    resolutionOverrides: ['scopes'],
    isLockFrozen: false,
    compilerDependencies: [
      { field: 'types', specifier: 'npm:@types/node@^22' },
      { field: 'jsxImportSource', specifier: 'grammy' },
    ],
  });
  assertSameItems(
    overridden,
    [
      'deno.json: scopes would resolve imports outside the import map',
      'deno.json: lock must be { "frozen": true } at the default deno.lock path',
      'compilerOptions.types: npm:@types/node@^22 bypasses the import map',
    ],
    'deno.json problems',
  );
});

/**
 * The problems of every documentation code example: the code blocks of each Markdown page, the
 * modules under `docs/`, and the JSDoc code blocks of every module.
 */
async function documentationProblems(configuration: DenoConfiguration): Promise<string[]> {
  const pinnedVersions = pinnedVersionsByPackage(configuration.imports);
  const inventory = await readRepositoryInventory(REPOSITORY_ROOT);
  const problems: string[] = [];
  const examples: CodeExample[] = [];
  const commands: LabelledCommand[] = [];
  const addContent = (path: string, blocks: readonly CodeBlock[]) => {
    const content = sortDocumentationBlocks(REPOSITORY_ROOT, path, blocks);
    examples.push(...content.examples);
    commands.push(...content.commands);
    problems.push(...content.problems);
  };
  for (const path of inventory.documentationPaths) {
    addContent(path, extractMarkdownCodeBlocks(await readRepositoryText(path)));
  }
  for (const path of inventory.modulePaths) {
    const moduleUrl = new URL(path, REPOSITORY_ROOT);
    const source = await readRepositoryText(path);
    const analysis = await readModuleAnalysis(REPOSITORY_ROOT, moduleUrl, source);
    addContent(path, analysis.documentationBlocks);
    if (path.startsWith(DOCUMENTATION_DIRECTORY)) examples.push({ label: path, moduleUrl, source });
  }
  for (const { label, moduleUrl, source } of examples) {
    const analysis = await readModuleAnalysis(REPOSITORY_ROOT, moduleUrl, source);
    problems.push(...analysisProblems(label, analysis, inventory));
    for (const specifier of analysis.specifiers) {
      const problem = documentationSpecifierProblem(specifier, pinnedVersions);
      if (problem !== undefined) problems.push(`${label}: ${specifier} ${problem}`);
    }
  }
  for (const command of commands) {
    const problem = commandProblem(command);
    if (problem !== undefined) problems.push(`${command.label}: ${problem}: ${command.command}`);
  }
  return problems;
}

function assertSameItems<T>(actual: readonly T[], expected: readonly T[], what: string): void {
  const sortedActual = JSON.stringify([...actual].sort());
  const sortedExpected = JSON.stringify([...expected].sort());
  if (sortedActual !== sortedExpected) {
    throw new Error(`Expected the ${what} ${sortedExpected}, found ${sortedActual}`);
  }
}

async function readRepositoryText(path: string): Promise<string> {
  return await Deno.readTextFile(new URL(path, REPOSITORY_ROOT));
}
