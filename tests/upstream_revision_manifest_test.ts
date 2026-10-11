import { assertEquals } from '@std/assert';

import {
  findCitationProblem,
  findDeclarationSpans,
  findRevisionCitations,
  readDeclaredRevisions,
  type RevisionCitation,
  type UpstreamRevision,
} from './support/upstream_revision_citations.ts';

/**
 * Keeps `docs/upstream-revisions.md` the complete list of the upstream commits the repository
 * cites. Every link into a repository at a commit, in any file including the manifest, must name
 * a commit the manifest lists for that repository; every full hash written on its own must be
 * listed; no hash may be abbreviated; and every listed commit must be cited outside its own
 * declaration.
 */
const REPOSITORY_ROOT = new URL('../', import.meta.url);
const MANIFEST_PATH = 'docs/upstream-revisions.md';

/**
 * Entries that hold no citations of the repository's own: Git's and Claude Code's local state,
 * installed and built output, and the records `openapi:coverage` writes, as `.gitignore` lists
 * them.
 */
const UNSCANNED_ENTRY_NAMES: ReadonlySet<string> = new Set([
  '.git',
  '.claude',
  '.deno',
  'node_modules',
  'npm',
  'dist',
  '.openapi-conformance-records.jsonl',
]);

// The examples' hashes are built at run time, so that this file cites no commit itself.
const TDLIB_COMMIT = 'a'.repeat(40);
const SERVER_COMMIT = 'b'.repeat(40);
const UNLISTED_COMMIT = 'c'.repeat(40);
const ABBREVIATED_COMMIT = TDLIB_COMMIT.slice(0, 8);
const LISTED_REVISIONS: readonly UpstreamRevision[] = [
  { repository: 'tdlib/td', commit: TDLIB_COMMIT },
  { repository: 'tdlib/telegram-bot-api', commit: SERVER_COMMIT },
];

Deno.test('the upstream-revision manifest lists every upstream commit the repository cites', async () => {
  const revisions = readDeclaredRevisions(await readManifest());

  const problems = (await readRepositoryCitations()).flatMap((citation) => {
    const problem = findCitationProblem(citation, revisions);
    return problem === undefined ? [] : [`${formatCitation(citation)}: ${problem}`];
  });

  assertEquals(problems, [], `Expected ${MANIFEST_PATH} to list the commits these cite in full`);
});

Deno.test('every commit the upstream-revision manifest lists is cited outside its declaration', async () => {
  const manifest = await readManifest();
  const declarationSpans = findDeclarationSpans(manifest);
  const citedCommits = new Set(
    (await readRepositoryCitations())
      .filter(({ path, offset }) =>
        path !== MANIFEST_PATH ||
        !declarationSpans.some(([start, end]) => start <= offset && offset < end)
      )
      .map(({ reference }) => reference),
  );

  const uncitedRevisions = readDeclaredRevisions(manifest)
    .filter(({ commit }) => !citedCommits.has(commit))
    .map(({ repository, commit }) => `${repository}@${commit}`);

  assertEquals(uncitedRevisions, [], `Expected ${MANIFEST_PATH} to list only cited commits`);
});

Deno.test('the upstream-revision manifest lists each commit once', async () => {
  const listedCommits = readDeclaredRevisions(await readManifest()).map(({ commit }) => commit);

  assertEquals(listedCommits.length, new Set(listedCommits).size);
});

Deno.test('the upstream-revision manifest names the grammY types version deno.json pins', async () => {
  const configuration: { readonly imports: Readonly<Record<string, string>> } = JSON.parse(
    await Deno.readTextFile(new URL('deno.json', REPOSITORY_ROOT)),
  );
  const pinnedVersion = /@(\d+\.\d+\.\d+)\//.exec(configuration.imports['grammy-types-reference'])
    ?.[1];
  const listedVersions = [
    ...(await readManifest()).matchAll(
      /https:\/\/github\.com\/grammyjs\/types\/tree\/v(\d+\.\d+\.\d+)\b/g,
    ),
  ].map(([, version]) => version);

  assertEquals(listedVersions, [pinnedVersion]);
});

// ## How citations are found
//
// Each form of citation, written with an unlisted, mismatched or abbreviated commit, is reported;
// the same form with a listed commit is not.

Deno.test('a link into a repository at a commit is checked in every form the web uses', () => {
  const links = [
    `https://github.com/tdlib/td/blob/${TDLIB_COMMIT}/td/telegram/MessageEntity.cpp#L1`,
    `https://github.com/tdlib/td/tree/${TDLIB_COMMIT}/td`,
    `https://github.com/tdlib/td/commit/${TDLIB_COMMIT}`,
    `https://github.com/tdlib/td/commits/${TDLIB_COMMIT}`,
    `https://github.com/tdlib/td/raw/${TDLIB_COMMIT}/README.md`,
    `https://github.com/tdlib/td/blame/${TDLIB_COMMIT}/README.md`,
    `https://raw.githubusercontent.com/tdlib/td/${TDLIB_COMMIT}/README.md`,
    `https://cdn.jsdelivr.net/gh/tdlib/td@${TDLIB_COMMIT}/README.md`,
  ];

  for (const link of links) {
    assertEquals(describeProblems(link), [], `Expected ${link} to cite a listed commit`);
    assertEquals(
      describeProblems(link.replace(TDLIB_COMMIT, UNLISTED_COMMIT)),
      [`tdlib/td ${UNLISTED_COMMIT}: commit not listed for this repository`],
    );
    assertEquals(
      describeProblems(link.replace('tdlib/td', 'tdlib/telegram-bot-api')),
      [`tdlib/telegram-bot-api ${TDLIB_COMMIT}: commit not listed for this repository`],
    );
    assertEquals(
      describeProblems(link.replace(TDLIB_COMMIT, ABBREVIATED_COMMIT)),
      [`tdlib/td ${ABBREVIATED_COMMIT}: abbreviated commit hash`],
    );
  }
});

Deno.test('both commits of a comparison are checked', () => {
  const comparison = `https://github.com/tdlib/td/compare/${TDLIB_COMMIT}...${UNLISTED_COMMIT}`;

  assertEquals(describeProblems(comparison), [
    `tdlib/td ${UNLISTED_COMMIT}: commit not listed for this repository`,
  ]);
});

Deno.test('a full hash written on its own is checked against every listed commit', () => {
  assertEquals(
    describeProblems(`// at the commit the emulator follows,\n// ${SERVER_COMMIT}.`),
    [],
  );
  assertEquals(describeProblems(`at [\`${SERVER_COMMIT}\`][revision]`), []);
  assertEquals(describeProblems(`TDLib's tests at\n// ${UNLISTED_COMMIT}`), [
    `${UNLISTED_COMMIT}: commit not listed`,
  ]);
});

Deno.test('an abbreviated hash after "commit" or "revision" is reported', () => {
  assertEquals(describeProblems(`ported at commit\n// ${ABBREVIATED_COMMIT}, with entity types`), [
    `${ABBREVIATED_COMMIT}: abbreviated commit hash`,
  ]);
  assertEquals(describeProblems(`the Revision ${ABBREVIATED_COMMIT} of the server`), [
    `${ABBREVIATED_COMMIT}: abbreviated commit hash`,
  ]);
});

Deno.test('a run of hexadecimal digits longer than a hash, or a version tag, cites no commit', () => {
  assertEquals(describeProblems(`'#${'1'.repeat(256)}'`), []);
  assertEquals(describeProblems('https://cdn.jsdelivr.net/gh/grammyjs/types@5.0.0/mod.ts'), []);
  assertEquals(describeProblems('https://github.com/grammyjs/types/tree/v5.0.0'), []);
});

Deno.test("a manifest's declarations are its commit links, with their link text", () => {
  const manifest = [
    `**[\`tdlib/td\` at \`${TDLIB_COMMIT}\`](https://github.com/tdlib/td/commit/${TDLIB_COMMIT})**,`,
    `the [submodule](https://github.com/tdlib/telegram-bot-api/tree/${SERVER_COMMIT}/td).`,
  ].join('\n');
  const declarationSpans = findDeclarationSpans(manifest);
  const citationsOutsideDeclarations = findRevisionCitations(MANIFEST_PATH, manifest)
    .filter(({ offset }) =>
      !declarationSpans.some(([start, end]) => start <= offset && offset < end)
    )
    .map(({ reference }) => reference);

  assertEquals(readDeclaredRevisions(manifest), [LISTED_REVISIONS[0]]);
  assertEquals(citationsOutsideDeclarations, [SERVER_COMMIT]);
});

function describeProblems(text: string): string[] {
  return findRevisionCitations('example.md', text).flatMap((citation) => {
    const problem = findCitationProblem(citation, LISTED_REVISIONS);
    return problem === undefined
      ? []
      : [`${[citation.repository, citation.reference].filter(Boolean).join(' ')}: ${problem}`];
  });
}

async function readManifest(): Promise<string> {
  return await Deno.readTextFile(new URL(MANIFEST_PATH, REPOSITORY_ROOT));
}

/** The commits every file of the repository cites, the manifest included. */
async function readRepositoryCitations(): Promise<RevisionCitation[]> {
  const citations: RevisionCitation[] = [];
  for (const path of await listScannedFilePaths()) {
    const text = await Deno.readTextFile(new URL(path, REPOSITORY_ROOT));
    citations.push(...findRevisionCitations(path, text));
  }
  return citations;
}

/** The paths of the repository's files, relative to its root, apart from unscanned entries. */
async function listScannedFilePaths(): Promise<string[]> {
  const paths: string[] = [];
  const pendingDirectories = [''];
  for (
    let directory = pendingDirectories.pop();
    directory !== undefined;
    directory = pendingDirectories.pop()
  ) {
    for await (const entry of Deno.readDir(new URL(directory || '.', REPOSITORY_ROOT))) {
      if (UNSCANNED_ENTRY_NAMES.has(entry.name)) continue;
      const path = `${directory}${entry.name}`;
      if (entry.isDirectory) pendingDirectories.push(`${path}/`);
      else if (entry.isFile) paths.push(path);
    }
  }
  return paths.sort();
}

function formatCitation({ path, repository, reference }: RevisionCitation): string {
  return `${path}: ${repository ?? 'hash'} ${reference}`;
}
