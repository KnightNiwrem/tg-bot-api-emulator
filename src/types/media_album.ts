import { type ChatMessage, getMessageAuthorId, type MediaGroupId } from './virtual_message.ts';

/** The most messages an album holds, as Telegram's servers limit it. */
export const MAX_ALBUM_MESSAGE_COUNT = 10;

/** What an album's rules read of one of its messages: its media and where it shows a caption. */
export interface AlbumMember {
  readonly kind: 'photo' | 'document';
  /** Whether clients show the caption above the media; a document never does. */
  readonly showsCaptionAboveMedia: boolean;
}

/**
 * Why messages cannot form an album: there are none, more than `MAX_ALBUM_MESSAGE_COUNT`, their
 * captions are placed differently, or documents are mixed with other media.
 */
export type AlbumCompositionFailureReason =
  | 'album_empty'
  | 'album_too_large'
  | 'album_caption_placement_mixed'
  | 'album_documents_mixed';

/**
 * Checks that messages can be sent as one album, as TDLib's `check_message_group_message_contents`
 * does, in its order: at most 10 and at least one message, each placing its caption as the first
 * does, and documents only among documents, since TDLib's `is_homogenous_media_group_content`
 * keeps documents apart. Photos and documents are the only media the emulator sends in albums, so
 * no other kind needs refusing here. Returns `undefined` for messages that can.
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
  const hasDocument = members.some(({ kind }) => kind === 'document');
  return hasDocument && members.some(({ kind }) => kind !== 'document')
    ? 'album_documents_mixed'
    : undefined;
}

/**
 * Reads what an album's rules need of media being sent: a photo shows its caption where its sender
 * chose, and a document below itself.
 */
export function toAlbumMember(
  media:
    | { readonly kind: 'photo'; readonly showsCaptionAboveMedia: boolean }
    | { readonly kind: 'document' },
): AlbumMember {
  return {
    kind: media.kind,
    showsCaptionAboveMedia: media.kind === 'photo' && media.showsCaptionAboveMedia,
  };
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
 * repeats 2 to 10 documents and nothing else, all first sent by the same user whom their forwards
 * show, they form one new album together, whichever albums they came from.
 */
export function groupRepeatedAlbums(messages: readonly ChatMessage[]): RepeatedAlbums {
  if (formsDocumentAlbum(messages)) {
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
 * Whether repeated messages are documents that TDLib groups into one album: 2 to 10 of them, all
 * first sent by the same user, as TDLib's `get_message_original_sender` finds them, whom no forward
 * hides.
 */
function formsDocumentAlbum(messages: readonly ChatMessage[]): boolean {
  if (!formsAlbum(messages.length) || messages.length > MAX_ALBUM_MESSAGE_COUNT) {
    return false;
  }
  const originalSenderIds = new Set(messages.map(getOriginalSenderId));
  return messages.every(({ content }) => content.kind === 'document') &&
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
