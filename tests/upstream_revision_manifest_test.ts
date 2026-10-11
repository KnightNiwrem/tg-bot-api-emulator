import { assertEquals } from '@std/assert';

/**
 * Keeps `docs/upstream-revisions.md` the complete list of the upstream commits the repository
 * cites: every GitHub permalink names a commit the manifest lists for its repository, every full
 * commit hash written after the word "commit" is listed, and every listed commit is cited.
 */
const REPOSITORY_ROOT = new URL('../', import.meta.url);
const MANIFEST_PATH = 'docs/upstream-revisions.md';

/** Directories that hold no citations: installed and built output. */
const UNSCANNED_DIRECTORY_NAMES: ReadonlySet<string> = new Set(['node_modules', 'npm', 'dist']);

/** The kinds of files that cite upstream source: code, documentation and configuration. */
const SCANNED_FILE_EXTENSIONS: readonly string[] = ['.ts', '.md', '.yaml', '.json'];

/** A GitHub permalink to a file, a directory or a commit, at a full commit hash. */
const PERMALINK_PATTERN =
  /https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/(?:blob|tree|commit|raw)\/([0-9a-f]{40})(?![0-9a-f])/g;

/**
 * A full commit hash after the word "commit", as prose cites a commit; what lies between them, such
 * as a line break and a comment marker, holds no word character.
 */
const PROSE_COMMIT_PATTERN = /\bcommit\W+([0-9a-f]{40})(?![0-9a-f])/g;

/** A commit link of the manifest, which lists the commit for its repository. */
const MANIFEST_COMMIT_PATTERN =
  /https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/commit\/([0-9a-f]{40})(?![0-9a-f])/g;

/** A version of grammY's types, as the manifest links to its tag. */
const MANIFEST_GRAMMY_TYPES_VERSION_PATTERN =
  /https:\/\/github\.com\/grammyjs\/types\/tree\/v(\d+\.\d+\.\d+)\b/g;

interface UpstreamRevision {
  /** The repository on GitHub, as `owner/name`. */
  readonly repository: string;
  readonly commit: string;
}

/** Where a file cites an upstream commit, and the repository, when a permalink names it. */
interface RevisionCitation {
  readonly path: string;
  readonly repository?: string;
  readonly commit: string;
}

Deno.test('the upstream-revision manifest lists every upstream commit the repository cites', async () => {
  const listedRevisions = await readListedRevisions();
  const listedCommits = new Set(listedRevisions.map(({ commit }) => commit));
  const listedPermalinkTargets = new Set(listedRevisions.map(formatRevision));

  const unlistedCitations = (await readRevisionCitations())
    .filter((citation) =>
      citation.repository === undefined
        ? !listedCommits.has(citation.commit)
        : !listedPermalinkTargets.has(
          formatRevision({ ...citation, repository: citation.repository }),
        )
    )
    .map(({ path, repository, commit }) => `${path}: ${repository ?? 'commit'} ${commit}`);

  assertEquals(unlistedCitations, [], `Expected ${MANIFEST_PATH} to list these commits`);
});

Deno.test('every commit the upstream-revision manifest lists is cited', async () => {
  const citedCommits = new Set((await readRevisionCitations()).map(({ commit }) => commit));

  const uncitedRevisions = (await readListedRevisions())
    .filter(({ commit }) => !citedCommits.has(commit))
    .map(formatRevision);

  assertEquals(uncitedRevisions, [], `Expected ${MANIFEST_PATH} to list only cited commits`);
});

Deno.test('the upstream-revision manifest lists each commit once', async () => {
  const listedCommits = (await readListedRevisions()).map(({ commit }) => commit);

  assertEquals(listedCommits.length, new Set(listedCommits).size);
});

Deno.test('the upstream-revision manifest names the grammY types version deno.json pins', async () => {
  const configuration: { readonly imports: Readonly<Record<string, string>> } = JSON.parse(
    await Deno.readTextFile(new URL('deno.json', REPOSITORY_ROOT)),
  );
  const pinnedVersion = /@(\d+\.\d+\.\d+)\//.exec(configuration.imports['grammy-types-reference'])
    ?.[1];
  const manifest = await Deno.readTextFile(new URL(MANIFEST_PATH, REPOSITORY_ROOT));
  const listedVersions = [...manifest.matchAll(MANIFEST_GRAMMY_TYPES_VERSION_PATTERN)].map((
    [, version],
  ) => version);

  assertEquals(listedVersions, [pinnedVersion]);
});

async function readListedRevisions(): Promise<UpstreamRevision[]> {
  const manifest = await Deno.readTextFile(new URL(MANIFEST_PATH, REPOSITORY_ROOT));
  return [...manifest.matchAll(MANIFEST_COMMIT_PATTERN)].map(([, repository, commit]) => ({
    repository,
    commit,
  }));
}

/** The upstream commits that every scanned file but the manifest cites. */
async function readRevisionCitations(): Promise<RevisionCitation[]> {
  const citations: RevisionCitation[] = [];
  for (const path of await listScannedFilePaths()) {
    if (path === MANIFEST_PATH) continue;
    const text = await Deno.readTextFile(new URL(path, REPOSITORY_ROOT));
    for (const [, repository, commit] of text.matchAll(PERMALINK_PATTERN)) {
      citations.push({ path, repository, commit });
    }
    for (const [, commit] of text.matchAll(PROSE_COMMIT_PATTERN)) {
      citations.push({ path, commit });
    }
  }
  return citations;
}

/**
 * The paths of the repository's code, documentation and configuration files, relative to its
 * root, outside hidden directories such as `.git`, and outside installed and built output.
 */
async function listScannedFilePaths(): Promise<string[]> {
  const paths: string[] = [];
  const pendingDirectories = [''];
  for (
    let directory = pendingDirectories.pop();
    directory !== undefined;
    directory = pendingDirectories.pop()
  ) {
    for await (const entry of Deno.readDir(new URL(directory || '.', REPOSITORY_ROOT))) {
      if (entry.name.startsWith('.')) continue;
      const path = `${directory}${entry.name}`;
      if (entry.isDirectory) {
        if (!UNSCANNED_DIRECTORY_NAMES.has(entry.name)) pendingDirectories.push(`${path}/`);
      } else if (SCANNED_FILE_EXTENSIONS.some((extension) => entry.name.endsWith(extension))) {
        paths.push(path);
      }
    }
  }
  return paths.sort();
}

function formatRevision({ repository, commit }: UpstreamRevision): string {
  return `${repository}@${commit}`;
}
