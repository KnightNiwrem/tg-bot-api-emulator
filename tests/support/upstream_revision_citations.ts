// Reads the upstream commits a text cites, and the commits the upstream-revision manifest lists,
// so that `upstream_revision_manifest_test.ts` can compare them.

/** An upstream commit, as the manifest lists it. */
export interface UpstreamRevision {
  /** The repository on GitHub, as `owner/name`. */
  readonly repository: string;
  /** The full commit hash. */
  readonly commit: string;
}

/**
 * A reference to an upstream commit in a text: a link into a repository at a commit, or a hash
 * written on its own, which names no repository. The reference may be abbreviated.
 */
export interface RevisionCitation {
  readonly path: string;
  readonly repository?: string;
  readonly reference: string;
  /** Where the citation starts in the text, in UTF-16 code units. */
  readonly offset: number;
}

/** What is wrong with a citation, given the commits the manifest lists. */
export type CitationProblem =
  | 'abbreviated commit hash'
  | 'commit not listed for this repository'
  | 'commit not listed';

const HASH = '[0-9a-f]{7,40}';
const REPOSITORY = '([A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+)';
const HASH_END = '(?![0-9A-Za-z])';

/**
 * The link forms that name a repository and a commit, each with the repository as its first group
 * and the commit as the following ones: GitHub's pages of a file, a directory, a commit, a history
 * or a blame, its comparisons, its raw files, and jsDelivr's files of a GitHub repository.
 */
const REPOSITORY_LINK_PATTERNS: readonly RegExp[] = [
  new RegExp(
    `https?://github\\.com/${REPOSITORY}/(?:blob|tree|commit|commits|raw|blame)/(${HASH})${HASH_END}`,
    'g',
  ),
  new RegExp(
    `https?://github\\.com/${REPOSITORY}/compare/(${HASH})\\.{2,3}(${HASH})${HASH_END}`,
    'g',
  ),
  new RegExp(`https?://raw\\.githubusercontent\\.com/${REPOSITORY}/(${HASH})${HASH_END}`, 'g'),
  new RegExp(`https?://cdn\\.jsdelivr\\.net/gh/${REPOSITORY}@(${HASH})${HASH_END}`, 'g'),
];

/** A full commit hash on its own, outside a link: a run of exactly 40 hexadecimal digits. */
const STANDALONE_FULL_HASH_PATTERN = /(?<![0-9A-Za-z])[0-9a-f]{40}(?![0-9A-Za-z])/g;

/**
 * An abbreviated hash written after the word "commit" or "revision"; what lies between them, such
 * as a line break and a comment marker, holds no word character.
 */
const PROSE_ABBREVIATED_HASH_PATTERN = new RegExp(
  `\\b(?:[Cc]ommit|[Rr]evision)s?\\W+([0-9a-f]{7,39})${HASH_END}`,
  'g',
);

/** A commit link of the manifest, which declares the commit for its repository. */
const MANIFEST_DECLARATION_PATTERN = new RegExp(
  `https://github\\.com/${REPOSITORY}/commit/([0-9a-f]{40})${HASH_END}`,
  'g',
);

/** The commits the manifest declares by their commit links, in order. */
export function readDeclaredRevisions(manifest: string): UpstreamRevision[] {
  return [...manifest.matchAll(MANIFEST_DECLARATION_PATTERN)].map(([, repository, commit]) => ({
    repository,
    commit,
  }));
}

/**
 * The spans of the manifest that declare its commits: each declaration's link with its link text,
 * such as ``[`tdlib/td` at `<hash>`](https://github.com/tdlib/td/commit/<hash>)``, or the bare link.
 */
export function findDeclarationSpans(manifest: string): ReadonlyArray<readonly [number, number]> {
  const declarationWithText = new RegExp(
    `\\[[^\\]]*\\]\\(${MANIFEST_DECLARATION_PATTERN.source}\\)|${MANIFEST_DECLARATION_PATTERN.source}`,
    'g',
  );
  return [...manifest.matchAll(declarationWithText)].map((match) => [
    match.index,
    match.index + match[0].length,
  ]);
}

/** Every commit the text cites, by a repository link or by a hash written on its own. */
export function findRevisionCitations(path: string, text: string): RevisionCitation[] {
  const citations: RevisionCitation[] = [];
  const linkSpans: (readonly [number, number])[] = [];
  for (const pattern of REPOSITORY_LINK_PATTERNS) {
    for (const match of text.matchAll(pattern)) {
      const [whole, repository, ...references] = match;
      linkSpans.push([match.index, match.index + whole.length]);
      for (const reference of references) {
        citations.push({ path, repository, reference, offset: match.index });
      }
    }
  }
  const isInLink = (offset: number) =>
    linkSpans.some(([start, end]) => start <= offset && offset < end);
  for (const match of text.matchAll(STANDALONE_FULL_HASH_PATTERN)) {
    if (!isInLink(match.index)) {
      citations.push({ path, reference: match[0], offset: match.index });
    }
  }
  for (const match of text.matchAll(PROSE_ABBREVIATED_HASH_PATTERN)) {
    const reference = match[1];
    const offset = match.index + match[0].length - reference.length;
    if (!isInLink(offset)) citations.push({ path, reference, offset });
  }
  return citations.sort((left, right) => left.offset - right.offset);
}

/** What is wrong with the citation, or `undefined` when it names a listed commit in full. */
export function findCitationProblem(
  citation: RevisionCitation,
  revisions: readonly UpstreamRevision[],
): CitationProblem | undefined {
  if (citation.reference.length < 40) return 'abbreviated commit hash';
  if (citation.repository === undefined) {
    return revisions.some(({ commit }) => commit === citation.reference)
      ? undefined
      : 'commit not listed';
  }
  return revisions.some(({ repository, commit }) =>
      repository === citation.repository && commit === citation.reference
    )
    ? undefined
    : 'commit not listed for this repository';
}
