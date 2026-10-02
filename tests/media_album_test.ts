import {
  type AlbumMember,
  checkAlbumComposition,
  formsAlbum,
  MAX_ALBUM_MESSAGE_COUNT,
  toAlbumMember,
} from '../src/types/media_album.ts';

const photo: AlbumMember = { kind: 'photo', showsCaptionAboveMedia: false };
const document: AlbumMember = { kind: 'document', showsCaptionAboveMedia: false };

Deno.test('checkAlbumComposition accepts photos alone and documents alone, up to ten', () => {
  const accepted = [
    [photo],
    [document],
    [photo, photo],
    Array.from({ length: MAX_ALBUM_MESSAGE_COUNT }, () => document),
  ].map(checkAlbumComposition);
  if (accepted.some((failure) => failure !== undefined)) {
    throw new Error(`Expected every album to be accepted, received ${JSON.stringify(accepted)}`);
  }
});

Deno.test('checkAlbumComposition refuses albums in the order TDLib checks them', () => {
  const abovePhoto: AlbumMember = { kind: 'photo', showsCaptionAboveMedia: true };
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
  ].map(checkAlbumComposition);
  const expectedFailures = [
    'album_empty',
    'album_too_large',
    'album_too_large',
    'album_caption_placement_mixed',
    'album_caption_placement_mixed',
    'album_documents_mixed',
    'album_documents_mixed',
  ];
  if (JSON.stringify(failures) !== JSON.stringify(expectedFailures)) {
    throw new Error(`Expected TDLib's failures, received ${JSON.stringify(failures)}`);
  }
});

Deno.test('toAlbumMember places only a photo caption above its media', () => {
  const members = [
    toAlbumMember({ kind: 'photo', showsCaptionAboveMedia: true }),
    toAlbumMember({ kind: 'photo', showsCaptionAboveMedia: false }),
    toAlbumMember({ kind: 'document' }),
  ];
  if (
    JSON.stringify(members) !==
      JSON.stringify([
        { kind: 'photo', showsCaptionAboveMedia: true },
        { kind: 'photo', showsCaptionAboveMedia: false },
        { kind: 'document', showsCaptionAboveMedia: false },
      ])
  ) {
    throw new Error(
      `Expected album members as TDLib reads them, received ${JSON.stringify(members)}`,
    );
  }
});

Deno.test('formsAlbum groups two or more messages', () => {
  if (formsAlbum(1) || !formsAlbum(2) || !formsAlbum(MAX_ALBUM_MESSAGE_COUNT)) {
    throw new Error('Expected a single message to be sent outside any album');
  }
});
