/**
 * The repository's modules and what they import, for the dependency specifier checks. The
 * inventory walks the whole repository rather than the directories tasks name, so that a module
 * anywhere is checked, and it refuses files it cannot classify instead of skipping them.
 */
import { parseModule } from '@deno/graph';

/** The extensions of the modules Deno loads, type-checks and tests, `.d.ts` files included. */
export const MODULE_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'];
/** The extensions of files Deno does not run: documentation, data and configuration. */
const DATA_EXTENSIONS = ['.md', '.json', '.jsonc', '.jsonl', '.yaml', '.yml', '.lock'];
/** Configuration files that would give the modules below them their own dependency resolution. */
const RESOLUTION_CONFIGURATION_NAMES = [
  'deno.json',
  'deno.jsonc',
  'package.json',
  'import_map.json',
];
/** The language tags of the Markdown code blocks `deno check --doc-only` type-checks. */
const EXAMPLE_LANGUAGES: ReadonlyMap<string, string> = new Map([
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

/** What a repository file is, as far as dependency resolution is concerned. */
export type RepositoryFileKind = 'module' | 'documentation' | 'data' | 'configuration';

/**
 * How a file name classifies: a kind; `extensionless` for files such as `LICENSE` or `.gitignore`,
 * which nothing imports; or `unrecognised` for an extension the checks do not know.
 */
export type FileClassification = RepositoryFileKind | 'extensionless' | 'unrecognised';

/** The files of the repository that the dependency checks cover, by repository-relative path. */
export interface RepositoryInventory {
  readonly modulePaths: readonly string[];
  readonly documentationPaths: readonly string[];
  /** Every classified file, for checking that a module's local imports stay inside the scan. */
  readonly kindsByPath: ReadonlyMap<string, RepositoryFileKind>;
  /** Files that would escape the checks: unknown extensions and nested resolution configuration. */
  readonly problems: readonly string[];
}

/** The imports of one module, as {@link readModuleImports} finds them. */
export interface ModuleImports {
  /** Every specifier the module imports, without the local files it resolves to. */
  readonly specifiers: readonly string[];
  /** The repository-relative paths of the local files the module's imports resolve to. */
  readonly localPaths: readonly string[];
  /** The 1-based lines of dynamic imports whose specifier is computed at run time. */
  readonly computedImportLines: readonly number[];
}

/** A code example from a Markdown page, under the module URL it is parsed as. */
export interface CodeExample {
  /** Where problems are reported, such as `docs/clients/typescript/polls.md, example 2`. */
  readonly label: string;
  readonly moduleUrl: URL;
  readonly source: string;
}

export function classifyFileName(name: string): FileClassification {
  if (RESOLUTION_CONFIGURATION_NAMES.includes(name)) return 'configuration';
  const extensionStart = name.lastIndexOf('.');
  if (extensionStart <= 0) return 'extensionless';
  const extension = name.slice(extensionStart);
  if (MODULE_EXTENSIONS.includes(extension)) return 'module';
  if (extension === '.md') return 'documentation';
  if (DATA_EXTENSIONS.includes(extension)) return 'data';
  return 'unrecognised';
}

/**
 * Walks the repository at `root`. It skips `.git`, nested checkouts (such as agent worktrees),
 * the root `.gitignore`'s entries and directories that ignore themselves with a `*` `.gitignore`.
 * Only the root `deno.json` may configure resolution.
 */
export async function readRepositoryInventory(root: URL): Promise<RepositoryInventory> {
  const isIgnored = await readRootIgnoreRules(root);
  const kindsByPath = new Map<string, RepositoryFileKind>();
  const problems: string[] = [];
  const pending = [''];
  for (let directory = pending.pop(); directory !== undefined; directory = pending.pop()) {
    for await (const entry of Deno.readDir(new URL(directory || '.', root))) {
      const path = `${directory}${entry.name}`;
      if (entry.name === '.git' || isIgnored(entry.name)) continue;
      if (entry.isDirectory) {
        if (!(await isSeparateTree(new URL(`${path}/`, root)))) pending.push(`${path}/`);
        continue;
      }
      const kind = classifyFileName(entry.name);
      if (kind === 'unrecognised') {
        problems.push(`${path} has an extension the dependency checks do not recognise`);
      } else if (kind === 'configuration' && path !== 'deno.json') {
        problems.push(`${path} would configure dependency resolution outside deno.json`);
      } else if (kind !== 'extensionless') {
        kindsByPath.set(path, kind);
      }
    }
  }
  const pathsOfKind = (kind: RepositoryFileKind) =>
    [...kindsByPath].filter(([, fileKind]) => fileKind === kind).map(([path]) => path).sort();
  return {
    modulePaths: pathsOfKind('module'),
    documentationPaths: pathsOfKind('documentation'),
    kindsByPath,
    problems,
  };
}

/** Whether a directory is another checkout or ignores all of its own contents. */
async function isSeparateTree(directory: URL): Promise<boolean> {
  try {
    await Deno.lstat(new URL('.git', directory));
    return true;
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
  }
  try {
    return (await Deno.readTextFile(new URL('.gitignore', directory))).trim() === '*';
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return false;
    throw error;
  }
}

/** Matches entry names against the root `.gitignore`, whose patterns name files or directories. */
async function readRootIgnoreRules(root: URL): Promise<(name: string) => boolean> {
  const patterns = (await Deno.readTextFile(new URL('.gitignore', root))).split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'));
  const matchers = patterns.map((pattern) => {
    if (pattern.startsWith('!') || pattern.slice(0, -1).includes('/')) {
      throw new Error(`The dependency checks cannot apply the .gitignore pattern ${pattern}`);
    }
    const name = pattern.replace(/\/$/, '');
    const expression = name.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(
      /\?/g,
      '.',
    );
    return new RegExp(`^${expression}$`);
  });
  return (name) => matchers.some((matcher) => matcher.test(name));
}

/**
 * What a module imports. Deno's own module analysis, deno_graph, finds every specifier Deno would
 * load or type-check: imports, re-exports, dynamic imports with string or plain template
 * arguments, `import()` types, `import x = require()`, triple-slash references and
 * `@ts-types`/`@deno-types` directives. Specifiers are as written, except that a directive's types
 * specifier is reported resolved. Local files are reported separately, relative to `root`.
 *
 * A dynamic import whose argument is computed has no specifier until it runs, so no static check
 * and no `deno.lock` entry can cover it; a lint rule over Deno's own parse finds those.
 */
export async function readModuleImports(
  root: URL,
  moduleUrl: URL,
  source: string,
): Promise<ModuleImports> {
  const module = await parseModule(moduleUrl.href, new TextEncoder().encode(source));
  const specifiers = new Set<string>();
  const localPaths = new Set<string>();
  const addResolved = (resolved: string | undefined) => {
    if (resolved === undefined) return;
    if (!resolved.startsWith('file:')) specifiers.add(resolved);
    else if (resolved.startsWith(root.href)) localPaths.add(resolved.slice(root.href.length));
    else localPaths.add(resolved);
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
    localPaths: [...localPaths],
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

/**
 * The code examples of a Markdown page in every language `deno check --doc-only` checks, each
 * with a module URL of that language's extension.
 */
export function extractCodeExamples(root: URL, path: string, markdown: string): CodeExample[] {
  const examples: CodeExample[] = [];
  for (
    const [, language, source] of markdown.matchAll(/^```([A-Za-z]+)[^\n]*\n([\s\S]*?)^```$/gm)
  ) {
    const extension = EXAMPLE_LANGUAGES.get(language.toLowerCase());
    if (extension === undefined) continue;
    examples.push({
      label: `${path}, example ${examples.length + 1}`,
      moduleUrl: new URL(`${path}$${examples.length + 1}${extension}`, root),
      source,
    });
  }
  return examples;
}
