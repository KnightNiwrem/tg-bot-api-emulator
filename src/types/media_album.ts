import { type ChatMessage, getMessageAuthorId, type MediaGroupId } from './virtual_message.ts';

/** The most messages an album holds, as Telegram's servers limit it. */
export const MAX_ALBUM_MESSAGE_COUNT = 10;

/** The kinds of media an album holds. */
export type AlbumMediaKind = 'photo' | 'document' | 'video' | 'audio';

/** What an album's rules read of one of its messages: its media and where it shows a caption. */
export interface AlbumMember {
  readonly kind: AlbumMediaKind;
  /** Whether clients show the caption above the media; only a photo or video does. */
  readonly showsCaptionAboveMedia: boolean;
}

/**
 * Why messages cannot form an album: there are none, more than `MAX_ALBUM_MESSAGE_COUNT`, their
 * captions are placed differently, or documents or audio files are mixed with other media.
 */
export type AlbumCompositionFailureReason =
  | 'album_empty'
  | 'album_too_large'
  | 'album_caption_placement_mixed'
  | 'album_documents_mixed'
  | 'album_audio_mixed';

/**
 * The kinds of media an album keeps apart from every other kind, as TDLib's
 * `is_homogenous_media_group_content` does for documents and audio files, while photos and videos
 * mix.
 */
type HomogeneousAlbumMediaKind = Extract<AlbumMediaKind, 'document' | 'audio'>;

function isHomogeneousAlbumMediaKind(
  kind: ChatMessage['content']['kind'],
): kind is HomogeneousAlbumMediaKind {
  return kind === 'document' || kind === 'audio';
}

/** The failure of an album that mixes a kind `isHomogeneousAlbumMediaKind` keeps apart. */
const MIXED_HOMOGENEOUS_ALBUM_FAILURES = {
  document: 'album_documents_mixed',
  audio: 'album_audio_mixed',
} as const satisfies Record<HomogeneousAlbumMediaKind, AlbumCompositionFailureReason>;

/**
 * Checks that messages can be sent as one album, as TDLib's `check_message_group_message_contents`
 * does, in its order: at most 10 and at least one message, each placing its caption as the first
 * does, and documents only among documents and audio files only among audio files, since
 * `isHomogeneousAlbumMediaKind` keeps them apart. Photos, videos, documents and audio files are the
 * only media the emulator sends in albums, so no other kind needs refusing here. Returns
 * `undefined` for messages that can.
 *
 * TDLib reports whichever homogeneous kind it meets first in an unordered set of the album's
 * kinds, so for an album that mixes documents with audio files it is not defined which it names;
 * the emulator names the kind of the first such message.
 *
 * A single message passes: as TDLib's `send_message_group` does, it is sent outside any album.
 */
export function checkAlbumComposition(
  members: readonly AlbumMember[],
): AlbumCompositionFailureReason | undefined {
  if (members.length > MAX_ALBUM_MESSAGE_COUNT) {
    return 'album_too_large';
  }
  const [firstMember] = members;
  if (firstMember === undefined) {
    return 'album_empty';
  }
  if (
    members.some(({ showsCaptionAboveMedia }) =>
      showsCaptionAboveMedia !== firstMember.showsCaptionAboveMedia
    )
  ) {
    return 'album_caption_placement_mixed';
  }
  if (members.every(({ kind }) => kind === firstMember.kind)) {
    return undefined;
  }
  const homogeneousKind = members.map(({ kind }) => kind).find(isHomogeneousAlbumMediaKind);
  return homogeneousKind === undefined
    ? undefined
    : MIXED_HOMOGENEOUS_ALBUM_FAILURES[homogeneousKind];
}

/**
 * Whether a message of an album may change its media from one kind to another, as TDLib's
 * `edit_message_media` decides: a photo and a video replace each other, while a kind
 * `isHomogeneousAlbumMediaKind` keeps apart, a document or an audio file, neither becomes nor
 * replaces another.
 */
export function canChangeAlbumMediaKind(oldKind: AlbumMediaKind, newKind: AlbumMediaKind): boolean {
  return oldKind === newKind ||
    (!isHomogeneousAlbumMediaKind(oldKind) && !isHomogeneousAlbumMediaKind(newKind));
}

/**
 * Reads what an album's rules need of media being sent: a photo or video shows its caption where
 * its sender chose, and a document or audio file below itself.
 */
export function toAlbumMember(
  media:
    | { readonly kind: 'photo' | 'video'; readonly showsCaptionAboveMedia: boolean }
    | { readonly kind: HomogeneousAlbumMediaKind },
): AlbumMember {
  return media.kind === 'photo' || media.kind === 'video'
    ? { kind: media.kind, showsCaptionAboveMedia: media.showsCaptionAboveMedia }
    : { kind: media.kind, showsCaptionAboveMedia: false };
}

/**
 * Whether messages sent together form an album, which takes at least two: as TDLib's
 * `send_message_group` does, a single message is sent outside any album.
 */
export function formsAlbum(memberCount: number): boolean {
  return memberCount > 1;
}

/** The new albums that messages forwarded or copied together form. */
export interface RepeatedAlbums {
  readonly albumCount: number;
  /**
   * For each message, in order, the index of the new album it belongs to, counted from 0 in order
   * of the albums' first messages; `undefined` for a message sent outside any album.
   */
  readonly albumIndexes: readonly (number | undefined)[];
}

/**
 * Groups the messages that one request forwards or copies, in order, into new albums, as TDLib's
 * `get_forwarded_messages` does. The repeated messages of an album form a new album of their own
 * when there are at least two of them, while a lone one is sent outside any album. When the request
 * repeats 2 to 10 documents and nothing else, or 2 to 10 audio files and nothing else, all first
 * sent by the same user, none of them a forward that hides its original sender, they form one new
 * album together, whichever albums they came from.
 */
export function groupRepeatedAlbums(messages: readonly ChatMessage[]): RepeatedAlbums {
  if (formsHomogeneousAlbum(messages)) {
    return { albumCount: 1, albumIndexes: messages.map(() => 0) };
  }
  const repeatedMemberCounts = new Map<MediaGroupId, number>();
  for (const { mediaGroupId } of messages) {
    if (mediaGroupId !== undefined) {
      repeatedMemberCounts.set(mediaGroupId, (repeatedMemberCounts.get(mediaGroupId) ?? 0) + 1);
    }
  }
  const newAlbumIndexes = new Map<MediaGroupId, number>();
  const albumIndexes = messages.map(({ mediaGroupId }) => {
    if (mediaGroupId === undefined || !formsAlbum(repeatedMemberCounts.get(mediaGroupId) ?? 0)) {
      return undefined;
    }
    const newAlbumIndex = newAlbumIndexes.get(mediaGroupId) ?? newAlbumIndexes.size;
    newAlbumIndexes.set(mediaGroupId, newAlbumIndex);
    return newAlbumIndex;
  });
  return { albumCount: newAlbumIndexes.size, albumIndexes };
}

/**
 * Whether repeated messages are documents, or audio files, that TDLib groups into one album: 2 to
 * 10 of them, all of the same kind that `isHomogeneousAlbumMediaKind` keeps apart, and all first
 * sent by the same user, as TDLib's `get_message_original_sender` finds them, whom no forward
 * hides.
 */
function formsHomogeneousAlbum(messages: readonly ChatMessage[]): boolean {
  const [firstMessage] = messages;
  if (
    firstMessage === undefined || !formsAlbum(messages.length) ||
    messages.length > MAX_ALBUM_MESSAGE_COUNT
  ) {
    return false;
  }
  const { kind } = firstMessage.content;
  const originalSenderIds = new Set(messages.map(getOriginalSenderId));
  return isHomogeneousAlbumMediaKind(kind) &&
    messages.every(({ content }) => content.kind === kind) &&
    originalSenderIds.size === 1 && !originalSenderIds.has(undefined);
}

/**
 * The user who first sent a message, as TDLib's `get_message_original_sender` finds them: the
 * author of a message, or the sender a forward shows; `undefined` for a forward that hides its
 * sender.
 */
function getOriginalSenderId(message: ChatMessage): number | undefined {
  if (message.forwardInfo === undefined) {
    return getMessageAuthorId(message);
  }
  const { originalSender } = message.forwardInfo;
  return originalSender.kind === 'user' ? originalSender.userId : undefined;
}
