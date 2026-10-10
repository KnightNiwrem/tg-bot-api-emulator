/**
 * The repository's modules, documentation code blocks and what they import, for the dependency
 * specifier checks. The inventory walks the whole repository rather than the directories tasks
 * name, so that a module anywhere is checked, and it refuses files it cannot classify instead of
 * skipping them. Markdown is read with a CommonMark parser, so every code block a reader sees is
 * found, whatever its fence.
 */
import { parseModule } from '@deno/graph';
import { fromMarkdown } from 'mdast-util-from-markdown';

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
  /** Every classified file, for checking that local imports and task paths stay inside the scan. */
  readonly kindsByPath: ReadonlyMap<string, RepositoryFileKind>;
  /** Files that would escape the checks: unknown extensions, symlinks, nested configuration. */
  readonly problems: readonly string[];
}

/** A module load that no static check and no `deno.lock` entry can follow. */
export interface UntraceableLoad {
  /** The 1-based line of the load. */
  readonly line: number;
  readonly description: string;
}

/** What one module imports and documents, as {@link readModuleAnalysis} finds it. */
export interface ModuleAnalysis {
  /** Every specifier the module imports, without the local files it resolves to. */
  readonly specifiers: readonly string[];
  /** The repository-relative paths of the local files the module's imports resolve to. */
  readonly localPaths: readonly string[];
  readonly untraceableLoads: readonly UntraceableLoad[];
  /** The code blocks of the module's JSDoc comments, which `deno doc` shows readers. */
  readonly documentationBlocks: readonly CodeBlock[];
}

/** A code block from Markdown or a JSDoc comment. */
export interface CodeBlock {
  /** The 1-based line in its file where the block starts. */
  readonly line: number;
  /** Whether the block is fenced; an indented code block has no info string. */
  readonly isFenced: boolean;
  /** The first word of the info string, lower-cased; absent for an untagged or indented block. */
  readonly language: string | undefined;
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
 * Only the root `deno.json` may configure resolution. Symlinks are refused, because the walk does
 * not follow them, and so are extensionless scripts with a `#!` line, which Deno can run.
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
      if (entry.isSymlink) {
        problems.push(`${path} is a symlink, which the dependency checks do not follow`);
        continue;
      }
      if (entry.isDirectory) {
        if (!(await isSeparateTree(new URL(`${path}/`, root)))) pending.push(`${path}/`);
        continue;
      }
      const kind = classifyFileName(entry.name);
      if (kind === 'unrecognised') {
        problems.push(`${path} has an extension the dependency checks do not recognise`);
      } else if (kind === 'configuration' && path !== 'deno.json') {
        problems.push(`${path} would configure dependency resolution outside deno.json`);
      } else if (kind === 'extensionless') {
        if (await startsWithShebang(new URL(path, root))) {
          problems.push(`${path} is a script without a module extension, which Deno can run`);
        }
      } else {
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

/** Whether a file starts with `#!`, as a script run directly, such as by `deno run`, does. */
async function startsWithShebang(file: URL): Promise<boolean> {
  const handle = await Deno.open(file);
  try {
    const start = new Uint8Array(2);
    const length = await handle.read(start);
    return length === 2 && start[0] === 0x23 && start[1] === 0x21;
  } finally {
    handle.close();
  }
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
 * arguments, `import()` types, `import x = require()`, triple-slash references, `@ts-types` and
 * `@deno-types` directives and `@jsxImportSource` pragmas. Specifiers are as written, except that a
 * directive's types specifier is reported resolved. Local files are reported separately, relative
 * to `root`.
 *
 * A lint rule over Deno's own parse finds the loads deno_graph cannot follow: a dynamic import
 * whose argument is computed, and a `Worker` whose module is not a relative `new URL()`. The same
 * pass reads the JSDoc comments, whose code blocks `deno doc` shows as examples.
 */
export async function readModuleAnalysis(
  root: URL,
  moduleUrl: URL,
  source: string,
): Promise<ModuleAnalysis> {
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
  const jsDocComments: Array<{ line: number; text: string }> = [];
  const lineOf = (offset: number) => source.slice(0, offset).split('\n').length;
  const diagnostics = Deno.lint.runPlugin(
    createLoadAnalysisPlugin((offset, text) => jsDocComments.push({ line: lineOf(offset), text })),
    moduleUrl.pathname,
    source,
  );
  return {
    specifiers: [...specifiers],
    localPaths: [...localPaths],
    untraceableLoads: diagnostics.map(({ range: [start], message }) => ({
      line: lineOf(start),
      description: message,
    })),
    documentationBlocks: jsDocComments.flatMap(({ line, text }) => extractJsDocBlocks(text, line)),
  };
}

/**
 * A lint plugin that reports untraceable loads and hands each JSDoc comment, with its offset, to
 * `onJsDocComment`.
 */
function createLoadAnalysisPlugin(
  onJsDocComment: (offset: number, text: string) => void,
): Deno.lint.Plugin {
  return {
    name: 'dependency-specifiers',
    rules: {
      'untraceable-load': {
        create(context) {
          return {
            Program() {
              for (const comment of context.sourceCode.getAllComments()) {
                if (comment.type === 'Block' && comment.value.startsWith('*')) {
                  onJsDocComment(comment.range[0], comment.value);
                }
              }
            },
            ImportExpression(node) {
              if (!isWrittenOutString(node.source)) {
                context.report({ node, message: 'computes its import specifier' });
              }
            },
            NewExpression(node) {
              if (node.callee.type !== 'Identifier' || node.callee.name !== 'Worker') return;
              const [moduleArgument] = node.arguments;
              if (moduleArgument === undefined || !isRelativeModuleUrl(moduleArgument)) {
                context.report({ node, message: 'starts a Worker from a module it cannot follow' });
              }
            },
          };
        },
      },
    },
  };
}

/** Whether an expression is a string written out in full: a literal or a plain template. */
function isWrittenOutString(node: Deno.lint.Expression): boolean {
  return (node.type === 'Literal' && typeof node.value === 'string') ||
    (node.type === 'TemplateLiteral' && node.expressions.length === 0);
}

/** Whether an expression is `new URL('./relative', import.meta.url)`, as Deno's docs write it. */
function isRelativeModuleUrl(node: Deno.lint.Expression | Deno.lint.SpreadElement): boolean {
  if (node.type !== 'NewExpression') return false;
  if (node.callee.type !== 'Identifier' || node.callee.name !== 'URL') return false;
  const [specifier, base] = node.arguments;
  return specifier !== undefined && specifier.type === 'Literal' &&
    typeof specifier.value === 'string' &&
    (specifier.value.startsWith('./') || specifier.value.startsWith('../')) &&
    base !== undefined && base.type === 'MemberExpression' &&
    base.object.type === 'MetaProperty' && base.property.type === 'Identifier' &&
    base.property.name === 'url';
}

/**
 * The code blocks of a Markdown text, as CommonMark defines them: fenced blocks with backticks or
 * tildes of any length, indented, inside lists or block quotes, or left open at the end, and
 * indented code blocks. `firstLine` is the line of the text's first line in its file.
 */
export function extractMarkdownCodeBlocks(markdown: string, firstLine = 1): CodeBlock[] {
  const blocks: CodeBlock[] = [];
  const visit = (node: MarkdownNode) => {
    if (node.type === 'code' && node.position !== undefined) {
      const { line, offset } = node.position.start;
      const fenceCharacter = offset === undefined ? undefined : markdown[offset];
      blocks.push({
        line: firstLine + line - 1,
        isFenced: fenceCharacter === '`' || fenceCharacter === '~',
        language: node.lang?.toLowerCase() ?? undefined,
        source: node.value ?? '',
      });
    }
    for (const child of node.children ?? []) visit(child);
  };
  visit(fromMarkdown(markdown));
  return blocks;
}

/** The parts of an mdast node that code block extraction reads. */
interface MarkdownNode {
  readonly type: string;
  readonly lang?: string | null;
  readonly value?: string;
  readonly position?: { readonly start: { readonly line: number; readonly offset?: number } };
  readonly children?: readonly MarkdownNode[];
}

/**
 * The code blocks of a JSDoc comment: its Markdown code blocks, and the body of each `@example` tag
 * that holds none, which `deno doc` and `deno check --doc` read as TypeScript.
 */
function extractJsDocBlocks(commentValue: string, commentLine: number): CodeBlock[] {
  const lines = commentValue.split('\n').map((line) => line.replace(/^\s*\*? ?/, ''));
  const blocks = extractMarkdownCodeBlocks(lines.join('\n'), commentLine);
  let exampleStart: number | undefined;
  const closeExample = (end: number) => {
    if (exampleStart === undefined) return;
    const body = lines.slice(exampleStart, end).join('\n').replace(/^@example\b/, '');
    if (extractMarkdownCodeBlocks(body).length === 0 && body.trim() !== '') {
      blocks.push({
        line: commentLine + exampleStart,
        isFenced: true,
        language: 'ts',
        source: body,
      });
    }
    exampleStart = undefined;
  };
  lines.forEach((line, index) => {
    if (!line.startsWith('@')) return;
    closeExample(index);
    if (/^@example\b/.test(line)) exampleStart = index;
  });
  closeExample(lines.length);
  return blocks;
}
