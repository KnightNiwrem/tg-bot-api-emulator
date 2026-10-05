/**
 * Keeps the repository's Markdown documentation navigable and the TypeScript client guide in step
 * with the client: relative links lead to existing files and headings, the guide's fixture listing
 * is the fixture file, and the API index names every client operation.
 */
const REPOSITORY_ROOT = new URL('../', import.meta.url);
const GUIDE_DIRECTORY = 'docs/clients/typescript/';

Deno.test('relative links in the documentation lead to existing files and headings', async () => {
  const brokenLinks: string[] = [];
  for (const documentPath of await listDocumentationPaths()) {
    const documentUrl = new URL(documentPath, REPOSITORY_ROOT);
    const markdown = await Deno.readTextFile(documentUrl);
    for (const target of extractLinkTargets(markdown)) {
      if (/^[a-z][a-z0-9+.-]*:/i.test(target)) continue;
      const [pathPart, anchor] = splitAnchor(target);
      const targetUrl = pathPart === '' ? documentUrl : new URL(pathPart, documentUrl);
      const targetMarkdown = await readTextIfFile(targetUrl);
      if (targetMarkdown === undefined && !(await isDirectory(targetUrl))) {
        brokenLinks.push(`${documentPath}: ${target} (no such file)`);
      } else if (
        anchor !== undefined && targetUrl.pathname.endsWith('.md') &&
        !headingAnchors(targetMarkdown ?? '').has(decodeURIComponent(anchor))
      ) {
        brokenLinks.push(`${documentPath}: ${target} (no such heading)`);
      }
    }
  }
  if (brokenLinks.length > 0) {
    throw new Error(`Broken documentation links:\n${brokenLinks.join('\n')}`);
  }
});

Deno.test('the fixture listing of the client guide is the fixture file', async () => {
  const fixtureSource = await Deno.readTextFile(
    new URL(`${GUIDE_DIRECTORY}bot_fixture.ts`, REPOSITORY_ROOT),
  );
  const page = await Deno.readTextFile(
    new URL(`${GUIDE_DIRECTORY}sessions-and-fixtures.md`, REPOSITORY_ROOT),
  );
  if (!extractTypeScriptBlocks(page).includes(fixtureSource)) {
    throw new Error('Expected sessions-and-fixtures.md to list bot_fixture.ts exactly');
  }
});

Deno.test('the client guide API index names every client operation', async () => {
  const apiIndex = await Deno.readTextFile(
    new URL(`${GUIDE_DIRECTORY}api-index.md`, REPOSITORY_ROOT),
  );
  const operations = [
    ...await publicMethodNames(
      'clients/typescript/telegram_emulation_client.ts',
      'class',
      'TelegramEmulationClient',
    ),
    ...await publicMethodNames('clients/typescript/types.ts', 'interface', 'VirtualAccountClient'),
    ...await publicMethodNames('clients/typescript/types.ts', 'interface', 'BotActivityLog'),
    ...await publicMethodNames('clients/typescript/types.ts', 'interface', 'BotActivityCursor'),
    ...await publicMethodNames(
      'clients/typescript/emulation_session_client.ts',
      'interface',
      'EmulationSessionClient',
    ),
    ...await exportedValueNames('clients/typescript/mod.ts'),
  ];
  const codeSpans = [...apiIndex.matchAll(/`([^`\n]+)`/g)].map(([, code]) => code);
  const missing = operations.filter((name) =>
    !codeSpans.some((code) => new RegExp(`\\b${name}\\b`).test(code))
  );
  if (missing.length > 0) {
    throw new Error(`api-index.md does not name: ${missing.join(', ')}`);
  }
});

async function listDocumentationPaths(): Promise<string[]> {
  const paths = ['README.md'];
  const pending = ['docs/'];
  for (let directory = pending.pop(); directory !== undefined; directory = pending.pop()) {
    for await (const entry of Deno.readDir(new URL(directory, REPOSITORY_ROOT))) {
      if (entry.isDirectory) pending.push(`${directory}${entry.name}/`);
      else if (entry.name.endsWith('.md')) paths.push(`${directory}${entry.name}`);
    }
  }
  return paths.sort();
}

/** The targets of inline links and link reference definitions, outside code. */
function extractLinkTargets(markdown: string): string[] {
  const prose = withoutCode(markdown);
  const inlineTargets = [...prose.matchAll(/\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)].map(([, target]) =>
    target
  );
  const definitionTargets = [...prose.matchAll(/^\[[^\]]+\]:\s+(\S+)/gm)].map(([, target]) =>
    target
  );
  return [...inlineTargets, ...definitionTargets];
}

function withoutCode(markdown: string): string {
  return markdown.replace(/^```[\s\S]*?^```$/gm, '').replace(/`[^`\n]*`/g, 'code');
}

function extractTypeScriptBlocks(markdown: string): string[] {
  return [...markdown.matchAll(/^```ts\n([\s\S]*?)^```$/gm)].map(([, block]) => block);
}

function splitAnchor(target: string): [path: string, anchor: string | undefined] {
  const hashIndex = target.indexOf('#');
  return hashIndex === -1
    ? [target, undefined]
    : [target.slice(0, hashIndex), target.slice(hashIndex + 1)];
}

/** The anchors GitHub gives a document's headings, numbering repeated ones as it does. */
function headingAnchors(markdown: string): Set<string> {
  const anchors = new Set<string>();
  const occurrences = new Map<string, number>();
  for (
    const [, heading] of markdown.replace(/^```[\s\S]*?^```$/gm, '').matchAll(/^#{1,6} (.+)$/gm)
  ) {
    const slug = heading.trim().toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, '').replace(
      /\s/g,
      '-',
    );
    const count = occurrences.get(slug) ?? 0;
    occurrences.set(slug, count + 1);
    anchors.add(count === 0 ? slug : `${slug}-${count}`);
  }
  return anchors;
}

/**
 * The names of the public methods an exported interface or class declares, as `name(` or `name<`,
 * `async` or not; a class's constructor and `#private` members are not methods of its interface.
 */
async function publicMethodNames(
  sourcePath: string,
  declarationKind: 'interface' | 'class',
  declarationName: string,
): Promise<string[]> {
  const source = await Deno.readTextFile(new URL(sourcePath, REPOSITORY_ROOT));
  const body = source.match(
    new RegExp(
      `^export ${declarationKind} ${declarationName}\\b[^{]*\\{\\n([\\s\\S]*?)^\\}`,
      'm',
    ),
  )?.[1];
  if (body === undefined) {
    throw new Error(`No ${declarationKind} ${declarationName} in ${sourcePath}`);
  }
  return [...body.matchAll(/^ {2}(?:async )?([a-zA-Z]+)[<(]/gm)]
    .map(([, name]) => name)
    .filter((name) => name !== 'constructor');
}

/** The names of the values, not types, a module re-exports. */
async function exportedValueNames(sourcePath: string): Promise<string[]> {
  const source = await Deno.readTextFile(new URL(sourcePath, REPOSITORY_ROOT));
  return [...source.matchAll(/^export \{([^}]*)\}/gm)]
    .flatMap(([, names]) => names.split(','))
    .map((name) => name.trim())
    .filter((name) => name !== '' && !name.startsWith('type '));
}

async function readTextIfFile(url: URL): Promise<string | undefined> {
  try {
    return await Deno.readTextFile(url);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound || error instanceof Deno.errors.IsADirectory) {
      return undefined;
    }
    throw error;
  }
}

async function isDirectory(url: URL): Promise<boolean> {
  try {
    return (await Deno.stat(url)).isDirectory;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return false;
    throw error;
  }
}
