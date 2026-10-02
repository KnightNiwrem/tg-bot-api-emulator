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
