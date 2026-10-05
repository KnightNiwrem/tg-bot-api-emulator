import {
  type AlbumMember,
  canChangeAlbumMediaKind,
  checkAlbumComposition,
  formsAlbum,
  groupRepeatedAlbums,
  MAX_ALBUM_MESSAGE_COUNT,
  toAlbumMember,
} from '../src/types/media_album.ts';
import type {
  MessageContent,
  MessageOriginSender,
  PrivateMessage,
} from '../src/types/virtual_message.ts';

const photo: AlbumMember = { kind: 'photo', showsCaptionAboveMedia: false };
const document: AlbumMember = { kind: 'document', showsCaptionAboveMedia: false };
const abovePhoto: AlbumMember = { kind: 'photo', showsCaptionAboveMedia: true };
const video: AlbumMember = { kind: 'video', showsCaptionAboveMedia: false };
const aboveVideo: AlbumMember = { kind: 'video', showsCaptionAboveMedia: true };
const audio: AlbumMember = { kind: 'audio', showsCaptionAboveMedia: false };

Deno.test('checkAlbumComposition accepts photos with videos and documents alone, up to ten', () => {
  const accepted = [
    [photo],
    [document],
    [photo, photo],
    [video, photo, video],
    [abovePhoto, aboveVideo],
    Array.from({ length: MAX_ALBUM_MESSAGE_COUNT }, () => abovePhoto),
    Array.from({ length: MAX_ALBUM_MESSAGE_COUNT }, () => document),
  ].map(checkAlbumComposition);
  if (accepted.some((failure) => failure !== undefined)) {
    throw new Error(`Expected every album to be accepted, received ${JSON.stringify(accepted)}`);
  }
});

Deno.test('checkAlbumComposition refuses albums in the order TDLib checks them', () => {
  const failures = [
    [],
    Array.from({ length: MAX_ALBUM_MESSAGE_COUNT + 1 }, () => photo),
    // TDLib counts the album before it reads the messages' media.
    [...Array.from({ length: MAX_ALBUM_MESSAGE_COUNT }, () => photo), abovePhoto],
    [photo, abovePhoto],
    // A different caption placement is reported before documents mixed with photos.
    [abovePhoto, document],
    [photo, document],
    [document, photo, photo],
    [video, abovePhoto],
    [document, video],
  ].map(checkAlbumComposition);
  const expectedFailures = [
    'album_empty',
    'album_too_large',
    'album_too_large',
    'album_caption_placement_mixed',
    'album_caption_placement_mixed',
    'album_documents_mixed',
    'album_documents_mixed',
    'album_caption_placement_mixed',
    'album_documents_mixed',
  ];
  if (JSON.stringify(failures) !== JSON.stringify(expectedFailures)) {
    throw new Error(`Expected TDLib's failures, received ${JSON.stringify(failures)}`);
  }
});

Deno.test('checkAlbumComposition keeps audio files among audio files only', () => {
  const outcomes = [
    [audio, audio],
    Array.from({ length: MAX_ALBUM_MESSAGE_COUNT }, () => audio),
    [audio, photo],
    [video, audio],
    [audio, audio, document],
    // TDLib names whichever kind it meets first in a set; the emulator names the first message's.
    [document, audio],
    // A different caption placement is reported before audio mixed with photos.
    [abovePhoto, audio],
  ].map(checkAlbumComposition);
  const expectedOutcomes = [
    undefined,
    undefined,
    'album_audio_mixed',
    'album_audio_mixed',
    'album_audio_mixed',
    'album_documents_mixed',
    'album_caption_placement_mixed',
  ];
  if (JSON.stringify(outcomes) !== JSON.stringify(expectedOutcomes)) {
    throw new Error(`Expected TDLib's audio albums, received ${JSON.stringify(outcomes)}`);
  }
});

Deno.test('toAlbumMember places only a photo or video caption above its media', () => {
  const members = [
    toAlbumMember({ kind: 'photo', showsCaptionAboveMedia: true }),
    toAlbumMember({ kind: 'photo', showsCaptionAboveMedia: false }),
    toAlbumMember({ kind: 'video', showsCaptionAboveMedia: true }),
    toAlbumMember({ kind: 'document' }),
    toAlbumMember({ kind: 'audio' }),
  ];
  if (
    JSON.stringify(members) !==
      JSON.stringify([
        { kind: 'photo', showsCaptionAboveMedia: true },
        { kind: 'photo', showsCaptionAboveMedia: false },
        { kind: 'video', showsCaptionAboveMedia: true },
        { kind: 'document', showsCaptionAboveMedia: false },
        { kind: 'audio', showsCaptionAboveMedia: false },
      ])
  ) {
    throw new Error(
      `Expected album members as TDLib reads them, received ${JSON.stringify(members)}`,
    );
  }
});

Deno.test('canChangeAlbumMediaKind lets photos and videos replace each other only', () => {
  const kinds = ['photo', 'video', 'document', 'audio'] as const;
  const allowedChanges = kinds.flatMap((oldKind) =>
    kinds.filter((newKind) => canChangeAlbumMediaKind(oldKind, newKind)).map((newKind) =>
      `${oldKind}->${newKind}`
    )
  );
  const expectedChanges = [
    'photo->photo',
    'photo->video',
    'video->photo',
    'video->video',
    'document->document',
    'audio->audio',
  ];
  if (JSON.stringify(allowedChanges) !== JSON.stringify(expectedChanges)) {
    throw new Error(`Expected TDLib's album media changes, received ${allowedChanges}`);
  }
});

Deno.test('formsAlbum groups two or more messages', () => {
  if (formsAlbum(1) || !formsAlbum(2) || !formsAlbum(MAX_ALBUM_MESSAGE_COUNT)) {
    throw new Error('Expected a single message to be sent outside any album');
  }
});

Deno.test('groupRepeatedAlbums gives each album repeated twice or more a new album', () => {
  const albumPhoto = (mediaGroupId: string) => privateMessage({ kind: 'photo', mediaGroupId });
  const { albumCount, albumIndexes } = groupRepeatedAlbums([
    albumPhoto('1'),
    privateMessage({ kind: 'text' }),
    albumPhoto('2'),
    albumPhoto('1'),
    albumPhoto('3'),
    albumPhoto('2'),
    albumPhoto('2'),
  ]);
  if (
    albumCount !== 2 || albumIndexes.length !== 7 ||
    JSON.stringify(albumIndexes) !==
      JSON.stringify([0, undefined, 1, 0, undefined, 1, 1])
  ) {
    throw new Error(
      `Expected albums 1 and 2 to be regrouped, received ${JSON.stringify(albumIndexes)}`,
    );
  }
});

Deno.test('groupRepeatedAlbums groups documents that one visible user first sent', () => {
  const groupings = [
    // Separate documents of one sender form an album, whatever albums they came from.
    [
      privateMessage({ kind: 'document' }),
      privateMessage({ kind: 'document', mediaGroupId: '1' }),
    ],
    // A forward counts its original's sender.
    [
      privateMessage({ kind: 'document' }),
      privateMessage({ kind: 'document', forwardedFromUserId: 10 }),
    ],
    [
      privateMessage({ kind: 'document' }),
      privateMessage({ kind: 'document', forwardedFromUserId: 11 }),
    ],
    [
      privateMessage({ kind: 'document', hidesForwardSender: true }),
      privateMessage({ kind: 'document', hidesForwardSender: true }),
    ],
    [privateMessage({ kind: 'document' }), privateMessage({ kind: 'photo' })],
    Array.from({ length: MAX_ALBUM_MESSAGE_COUNT + 1 }, () => privateMessage({ kind: 'document' })),
    [privateMessage({ kind: 'document' })],
  ].map((messages) => groupRepeatedAlbums(messages));
  const ungrouped = (count: number) => ({
    albumCount: 0,
    albumIndexes: Array.from({ length: count }, () => undefined),
  });
  const expectedGroupings = [
    { albumCount: 1, albumIndexes: [0, 0] },
    { albumCount: 1, albumIndexes: [0, 0] },
    ungrouped(2),
    ungrouped(2),
    ungrouped(2),
    ungrouped(MAX_ALBUM_MESSAGE_COUNT + 1),
    ungrouped(1),
  ];
  if (JSON.stringify(groupings) !== JSON.stringify(expectedGroupings)) {
    throw new Error(`Expected TDLib's document albums, received ${JSON.stringify(groupings)}`);
  }
});

Deno.test('groupRepeatedAlbums groups audio files that one visible user first sent', () => {
  const groupings = [
    [privateMessage({ kind: 'audio' }), privateMessage({ kind: 'audio', mediaGroupId: '1' })],
    // Audio files and documents are each kept apart, so together they form no album.
    [privateMessage({ kind: 'audio' }), privateMessage({ kind: 'document' })],
    [
      privateMessage({ kind: 'audio' }),
      privateMessage({ kind: 'audio', forwardedFromUserId: 11 }),
    ],
  ].map((messages) => groupRepeatedAlbums(messages));
  const expectedGroupings = [
    { albumCount: 1, albumIndexes: [0, 0] },
    { albumCount: 0, albumIndexes: [undefined, undefined] },
    { albumCount: 0, albumIndexes: [undefined, undefined] },
  ];
  if (JSON.stringify(groupings) !== JSON.stringify(expectedGroupings)) {
    throw new Error(`Expected TDLib's audio albums, received ${JSON.stringify(groupings)}`);
  }
});

/**
 * A message of the private chat between account 10 and bot 20, written by the account, with the
 * given kind of content, album, and forward origin.
 */
function privateMessage(
  { kind, mediaGroupId, forwardedFromUserId, hidesForwardSender = false }: {
    readonly kind: 'text' | 'photo' | 'document' | 'audio';
    readonly mediaGroupId?: string;
    readonly forwardedFromUserId?: number;
    readonly hidesForwardSender?: boolean;
  },
): PrivateMessage {
  const caption = { text: '', entities: [] };
  const content: MessageContent = kind === 'text'
    ? { kind, text: 'Hi', entities: [] }
    : kind === 'photo'
    ? { kind, fileId: 'file', caption, hasSpoiler: false, showsCaptionAboveMedia: false }
    : { kind, fileId: 'file', caption };
  const originalSender: MessageOriginSender | undefined = hidesForwardSender
    ? { kind: 'hidden_user', name: 'Ada' }
    : forwardedFromUserId === undefined
    ? undefined
    : { kind: 'user', userId: forwardedFromUserId };
  return {
    kind: 'private_message',
    id: crypto.randomUUID(),
    conversation: { accountId: 10, botId: 20 },
    authorRole: 'account',
    sentAtUnixSeconds: 1_700_000_000,
    content,
    ...(mediaGroupId === undefined ? {} : { mediaGroupId }),
    ...(originalSender === undefined
      ? {}
      : { forwardInfo: { originalSender, originalSentAtUnixSeconds: 1_600_000_000 } }),
    isContentProtected: false,
    isSilent: false,
    isPinned: false,
  };
}
