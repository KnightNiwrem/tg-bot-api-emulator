/**
 * The rules the dependency specifier checks apply: exact import map targets, imports in code
 * through the import map, fully qualified and pinned imports in documentation examples, and tasks
 * and commands that fetch nothing by themselves.
 */
import type { CodeBlock, ModuleAnalysis, RepositoryInventory } from './repository_modules.ts';

/** An exact semantic version, without ranges, tags or build metadata. */
const EXACT_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
/** `deno.json` fields that would resolve imports other than through its own `imports`. */
const RESOLUTION_OVERRIDE_FIELDS = ['importMap', 'scopes', 'workspace', 'links', 'patch'];
/** `compilerOptions` fields whose values Deno loads as modules. */
const COMPILER_DEPENDENCY_FIELDS = ['types', 'jsxImportSource', 'jsxImportSourceTypes'];
/** The one task that may unfreeze `deno.lock`, to regenerate it after a deliberate change. */
export const LOCK_REFRESH_TASK = 'lock:update';

/**
 * A command that fetches a package or module by itself, so that neither the import map nor
 * `deno.lock` governs it: a registry specifier, a URL Deno would load as a module, a package
 * runner or installer, or a download piped into an interpreter. Plain HTTP requests, such as
 * `curl` to the emulator, load no code.
 */
const SELF_FETCHING_COMMAND = new RegExp(
  [
    String.raw`(?:^|[\s'"=(])(?:npm|jsr):`,
    String.raw`\bdeno\b[^\n;&|]*\s['"]?https?://`,
    String.raw`(?:^|[\s;&|(])(?:npx|bunx|pnpx)(?:\s|$)`,
    String.raw`(?:^|[\s;&|(])(?:npm|pnpm|yarn|bun)\s+(?:exec|dlx|x|install|i|ci|add)(?:\s|$)`,
    String.raw`\|\s*(?:sh|bash|zsh|node|deno)\b`,
  ].join('|'),
  'm',
);
/** Deno flags that would resolve or lock dependencies other than through `deno.json`. */
const RESOLUTION_OVERRIDING_FLAG = new RegExp(
  [
    String.raw`(?:^|\s)(?:--import-map|--no-lock|--lock|--no-config|--config)(?:[=\s]|$)`,
    String.raw`(?:^|\s)--allow-scripts(?:[=\s]|$)`,
    String.raw`\bdeno\b[^\n;&|]*\s-c(?:[=\s]|$)`,
  ].join('|'),
  'm',
);
/** A flag that unfreezes `deno.lock`. */
const UNFREEZING_FLAG = /--frozen(?:-lockfile)?(?:=|\s+)false\b/;
/** A path argument that names a module, such as `src/main.ts`. */
const MODULE_PATH_ARGUMENT = /(?:^|\s)(?:\.\/)?((?:[\w@.-]+\/)*[\w@.-]+\.[cm]?[jt]sx?)(?=\s|$)/gm;

/** The fence languages of the scripts `deno check --doc-only` type-checks, by module extension. */
const SCRIPT_LANGUAGES: ReadonlyMap<string, string> = new Map([
  ['ts', '.ts'],
  ['typescript', '.ts'],
  ['tsx', '.tsx'],
  ['mts', '.mts'],
  ['cts', '.cts'],
  ['js', '.js'],
  ['javascript', '.js'],
  ['jsx', '.jsx'],
  ['mjs', '.mjs'],
  ['cjs', '.cjs'],
]);
/** The fence languages of shell examples, whose commands readers run as written. */
const SHELL_LANGUAGES = new Set(['sh', 'bash', 'shell', 'console', 'zsh']);

/**
 * The registry packages the guide imports for import map aliases that map to another distribution
 * of the same release, each with the alias whose version it must match. The guide's readers run
 * grammY from npm, as grammY documents for Deno. The repository's own tests import grammY and its
 * plugins as Deno source modules, because the npm build passes Node-specific request options to a
 * custom `fetch`, which the tests' in-process `fetch` cannot accept.
 */
export const ALIASES_BY_GUIDE_DISTRIBUTION: ReadonlyMap<string, string> = new Map([
  ['npm:grammy', 'grammy'],
  ['npm:@grammyjs/auto-retry', '@grammyjs/auto-retry'],
]);

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
export type PinnedVersions = ReadonlyMap<string, ReadonlySet<string>>;

/** The parts of `deno.json` that decide how dependencies resolve and what tasks run. */
export interface DenoConfiguration {
  readonly imports: Readonly<Record<string, string>>;
  readonly taskCommands: Readonly<Record<string, string>>;
  /** The {@link RESOLUTION_OVERRIDE_FIELDS} the configuration sets. */
  readonly resolutionOverrides: readonly string[];
  /** The module specifiers `compilerOptions` makes Deno load, by the field that names each. */
  readonly compilerDependencies: ReadonlyArray<{ field: string; specifier: string }>;
  /** Whether `lock` is `{ "frozen": true }` at the default `deno.lock` path. */
  readonly isLockFrozen: boolean;
}

/** A code example under the module URL it is parsed as. */
export interface CodeExample {
  /** Where problems are reported, such as `docs/clients/typescript/polls.md:27`. */
  readonly label: string;
  readonly moduleUrl: URL;
  readonly source: string;
}

/** A command from a task, a CI step or a shell example. */
export interface LabelledCommand {
  readonly label: string;
  readonly command: string;
  /** Whether the command may unfreeze `deno.lock`; only {@link LOCK_REFRESH_TASK} may. */
  readonly mayUnfreezeLock: boolean;
}

/** What documentation code blocks hold, sorted by the rule that applies to them. */
export interface DocumentationContent {
  readonly examples: readonly CodeExample[];
  readonly commands: readonly LabelledCommand[];
  readonly problems: readonly string[];
}

/** Why the import map pins no exact version for an entry, or why `deno.json` escapes it. */
export function importMapProblems(configuration: DenoConfiguration): string[] {
  const problems = configuration.resolutionOverrides.map((field) =>
    `deno.json: ${field} would resolve imports outside the import map`
  );
  if (!configuration.isLockFrozen) {
    problems.push('deno.json: lock must be { "frozen": true } at the default deno.lock path');
  }
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
  for (const { field, specifier } of configuration.compilerDependencies) {
    if (codeSpecifierProblem(specifier, configuration.imports) !== undefined) {
      problems.push(`compilerOptions.${field}: ${specifier} bypasses the import map`);
    }
  }
  return problems;
}

/**
 * The source and exact version an import map target pins, or why it pins none. Remote targets must
 * be HTTPS URLs whose path names an exact version, such as `.../grammY@v1.46.0/src/mod.ts`.
 */
export function readPinnedTarget(target: string): PinnedTarget | string {
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
 * The versions the import map pins, by registry-qualified package such as `jsr:@hono/hono`: the
 * registry targets themselves, and each guide distribution of an alias that maps elsewhere.
 */
export function pinnedVersionsByPackage(imports: Readonly<Record<string, string>>): PinnedVersions {
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

/** Why code may not import `specifier`, or `undefined` when the import map governs it. */
export function codeSpecifierProblem(
  specifier: string,
  imports: Readonly<Record<string, string>>,
): string | undefined {
  if (isRelative(specifier) || specifier.startsWith('node:') || isMapped(specifier, imports)) {
    return undefined;
  }
  return 'bypasses the import map';
}

/** Why a documentation example may not import `specifier`, or `undefined` when it may. */
export function documentationSpecifierProblem(
  specifier: string,
  pinnedVersions: PinnedVersions,
): string | undefined {
  if (isRelative(specifier)) return undefined;
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
 * Whether the import map resolves `specifier`: by an exact entry, by a prefix ending in `/`, or by
 * a subpath of an entry that maps to a registry package, such as `ajv/dist/2020.js` for `ajv`,
 * which Deno resolves within that package.
 */
export function isMapped(specifier: string, imports: Readonly<Record<string, string>>): boolean {
  return Object.entries(imports).some(([key, target]) =>
    key === specifier || (key.endsWith('/') && specifier.startsWith(key)) ||
    (parseRegistrySpecifier(target) !== undefined && specifier.startsWith(`${key}/`))
  );
}

/** Why a command escapes the import map or the frozen lock, or `undefined` when it does not. */
export function commandProblem(command: LabelledCommand): string | undefined {
  if (SELF_FETCHING_COMMAND.test(command.command)) return 'fetches a package or module by itself';
  if (RESOLUTION_OVERRIDING_FLAG.test(command.command)) {
    return 'overrides how Deno resolves or locks dependencies';
  }
  if (!command.mayUnfreezeLock && UNFREEZING_FLAG.test(command.command)) {
    return 'unfreezes deno.lock';
  }
  return undefined;
}

/** The module paths a command names as arguments, such as `src/main.ts`, without a leading `./`. */
export function modulePathArguments(command: string): string[] {
  return [...command.matchAll(MODULE_PATH_ARGUMENT)].map(([, path]) => path);
}

/**
 * Every string in a parsed CI workflow or action: `run` steps, and also the `env`, `with` and
 * matrix values a step can expand into its command.
 */
export function collectWorkflowStrings(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(collectWorkflowStrings);
  if (typeof value !== 'object' || value === null) return [];
  return Object.values(value).flatMap(collectWorkflowStrings);
}

/**
 * Sorts documentation code blocks by the rule that applies. Script blocks are examples, whatever
 * their attributes, letter case or fence; shell blocks are commands. An indented code block or an
 * untagged fence is a problem, because a reader cannot tell what it holds; blocks in other
 * languages, such as JSON or plain text, import nothing.
 */
export function sortDocumentationBlocks(
  root: URL,
  path: string,
  blocks: readonly CodeBlock[],
): DocumentationContent {
  const examples: CodeExample[] = [];
  const commands: LabelledCommand[] = [];
  const problems: string[] = [];
  for (const block of blocks) {
    const label = `${path}:${block.line}`;
    if (!block.isFenced) {
      problems.push(`${label}: an indented code block; fence it and name its language`);
      continue;
    }
    if (block.language === undefined) {
      problems.push(`${label}: a code fence without a language; name its language`);
      continue;
    }
    const extension = SCRIPT_LANGUAGES.get(block.language);
    if (extension !== undefined) {
      const moduleUrl = new URL(`${path}$${block.line}${extension}`, root);
      examples.push({ label, moduleUrl, source: block.source });
    } else if (SHELL_LANGUAGES.has(block.language)) {
      commands.push({ label, command: block.source, mayUnfreezeLock: false });
    }
  }
  return { examples, commands, problems };
}

/**
 * Problems in a module's analysis that no allowed specifier can excuse: loads no static check can
 * follow, and local imports of files the inventory does not cover, such as a module in an ignored
 * directory. A local data or text file, such as an OpenAPI schema a test reads, imports nothing.
 */
export function analysisProblems(
  label: string,
  analysis: ModuleAnalysis,
  inventory: RepositoryInventory,
): string[] {
  const problems = analysis.untraceableLoads.map(({ line, description }) =>
    `${label}:${line}: ${description}, which neither this check nor deno.lock covers`
  );
  for (const path of analysis.localPaths) {
    if (!inventory.kindsByPath.has(path)) {
      problems.push(`${label}: imports ${path}, which the dependency checks do not cover`);
    }
  }
  return problems;
}

export async function readDenoConfiguration(root: URL): Promise<DenoConfiguration> {
  const configuration: unknown = JSON.parse(
    await Deno.readTextFile(new URL('deno.json', root)),
  );
  if (typeof configuration !== 'object' || configuration === null) {
    throw new Error('Expected deno.json to hold an object');
  }
  const compilerOptions: unknown = Reflect.get(configuration, 'compilerOptions') ?? {};
  if (typeof compilerOptions !== 'object' || compilerOptions === null) {
    throw new Error('Expected deno.json compilerOptions to be an object');
  }
  const compilerDependencies = COMPILER_DEPENDENCY_FIELDS.flatMap((field) => {
    const value: unknown = Reflect.get(compilerOptions, field);
    const specifiers: unknown[] = Array.isArray(value) ? value : value === undefined ? [] : [value];
    return specifiers.map((specifier) => {
      if (typeof specifier !== 'string') {
        throw new Error(`Expected deno.json compilerOptions.${field} to name specifiers`);
      }
      return { field, specifier };
    });
  });
  return {
    imports: readStringRecord(Reflect.get(configuration, 'imports'), 'imports', (target) => target),
    taskCommands: readStringRecord(Reflect.get(configuration, 'tasks'), 'tasks', (task) => {
      const command: unknown = typeof task === 'object' && task !== null
        ? Reflect.get(task, 'command')
        : task;
      return command;
    }),
    resolutionOverrides: RESOLUTION_OVERRIDE_FIELDS.filter((field) => field in configuration),
    compilerDependencies,
    isLockFrozen: isFrozenLock(Reflect.get(configuration, 'lock')),
  };
}

/** Whether a `deno.json` `lock` value freezes the default `deno.lock`. */
function isFrozenLock(lock: unknown): boolean {
  if (typeof lock !== 'object' || lock === null) return false;
  const path: unknown = Reflect.get(lock, 'path');
  return Reflect.get(lock, 'frozen') === true &&
    (path === undefined || path === 'deno.lock' || path === './deno.lock');
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

function parseRegistrySpecifier(specifier: string): RegistrySpecifier | undefined {
  const match = specifier.match(/^(npm|jsr):((?:@[^/@]+\/)?[^/@]+)(?:@([^/]+))?(?:\/.*)?$/);
  if (match === null) return undefined;
  const [, registry, packageName, version] = match;
  return { registry: registry === 'npm' ? 'npm' : 'jsr', packageName, version };
}

function isRelative(specifier: string): boolean {
  return specifier.startsWith('./') || specifier.startsWith('../');
}
