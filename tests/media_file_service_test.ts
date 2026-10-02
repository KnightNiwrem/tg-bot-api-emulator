import { FileRepository } from '../src/repositories/file.ts';
import { MediaFileService, type UploadSource } from '../src/services/media_file.ts';
import {
  MAX_BOT_DOWNLOAD_FILE_BYTES,
  MAX_PHOTO_UPLOAD_BYTES,
  MAX_THUMBNAIL_UPLOAD_BYTES,
} from '../src/types/stored_file.ts';
import { MAX_BOT_UPLOAD_BYTES, type UploadProfile } from '../src/types/upload_profile.ts';

const FIRST_BOT_ID = 1;
const SECOND_BOT_ID = 2;

Deno.test('MediaFileService checks photos as Telegram does', () => {
  const { mediaFiles } = createMediaFileFixture();

  const photo = mediaFiles.preparePhotoUpload({
    content: gifImage(1280, 720),
    source: 'bot_upload',
  });
  if (
    !photo.prepared || photo.upload.imageFormat !== 'gif' || photo.upload.width !== 1280 ||
    photo.upload.height !== 720
  ) {
    throw new Error(`Expected a GIF photo of 1280x720, received ${JSON.stringify(photo)}`);
  }

  const rejections = [
    { content: new Uint8Array(), expectedReason: 'file_empty' },
    { content: new TextEncoder().encode('%PDF-1.7'), expectedReason: 'image_invalid' },
    // Width and height must add up to at most 10000.
    { content: gifImage(5_001, 5_000), expectedReason: 'photo_dimensions_invalid' },
    // The longer side must be at most 20 times the shorter one.
    { content: gifImage(2_100, 100), expectedReason: 'photo_dimensions_invalid' },
  ];
  for (const { content, expectedReason } of rejections) {
    const preparation = mediaFiles.preparePhotoUpload({ content, source: 'bot_upload' });
    if (preparation.prepared || preparation.reason !== expectedReason) {
      throw new Error(`Expected ${expectedReason}, received ${JSON.stringify(preparation)}`);
    }
  }
  if (
    !mediaFiles.preparePhotoUpload({ content: gifImage(2_000, 100), source: 'bot_upload' }).prepared
  ) {
    throw new Error('Expected a photo exactly 20 times as wide as it is tall to be accepted');
  }
});

Deno.test('MediaFileService refuses photos larger than 10 MB before reading them', () => {
  const { mediaFiles } = createMediaFileFixture();
  const imageOfSize = (sizeBytes: number) => {
    const content = new Uint8Array(sizeBytes);
    content.set(gifImage(1280, 720));
    return content;
  };

  // TDLib checks the photo limit for bots and accounts alike.
  for (const source of ['bot_upload', 'account_upload'] as const) {
    if (
      !mediaFiles.preparePhotoUpload({ content: imageOfSize(MAX_PHOTO_UPLOAD_BYTES), source })
        .prepared
    ) {
      throw new Error(`Expected a photo of exactly 10 MB to be accepted from ${source}`);
    }
    // The size is checked before the content, so even an unreadable file is too big.
    for (const content of [imageOfSize(MAX_PHOTO_UPLOAD_BYTES + 1), new Uint8Array(11_000_000)]) {
      const preparation = mediaFiles.preparePhotoUpload({ content, source });
      if (
        preparation.prepared || preparation.reason !== 'photo_too_big' ||
        preparation.fileSizeBytes !== content.length
      ) {
        throw new Error(`Expected photo_too_big, received ${JSON.stringify(preparation)}`);
      }
    }
  }
});

Deno.test('MediaFileService refuses bot uploads larger than the cloud profile allows', () => {
  const { mediaFiles } = createMediaFileFixture('cloud');
  const atLimit = new Uint8Array(MAX_BOT_UPLOAD_BYTES.cloud);
  const overLimit = new Uint8Array(MAX_BOT_UPLOAD_BYTES.cloud + 1);
  const prepareDocument = (content: Uint8Array<ArrayBuffer>, source: UploadSource) =>
    mediaFiles.prepareDocumentUpload({ content, fileName: 'video.mp4', source });

  if (!prepareDocument(atLimit, 'bot_upload').prepared) {
    throw new Error('Expected a bot document of exactly 50 MB to be accepted');
  }
  const expectedFailure = {
    prepared: false,
    reason: 'bot_upload_too_big',
    uploadProfile: 'cloud',
    fileSizeBytes: MAX_BOT_UPLOAD_BYTES.cloud + 1,
    maxFileSizeBytes: MAX_BOT_UPLOAD_BYTES.cloud,
  };
  // A photo over the server's limit fails for it before TDLib checks the photo limit.
  const failures = [
    prepareDocument(overLimit, 'bot_upload'),
    mediaFiles.preparePhotoUpload({ content: overLimit, source: 'bot_upload' }),
  ];
  for (const failure of failures) {
    if (JSON.stringify(failure) !== JSON.stringify(expectedFailure)) {
      throw new Error(`Expected bot_upload_too_big, received ${JSON.stringify(failure)}`);
    }
  }

  // An account uploads through its own client, which the Bot API server's limit does not bind.
  if (!prepareDocument(overLimit, 'account_upload').prepared) {
    throw new Error('Expected an account document over 50 MB to be accepted');
  }
  const accountPhoto = mediaFiles.preparePhotoUpload({
    content: overLimit,
    source: 'account_upload',
  });
  if (accountPhoto.prepared || accountPhoto.reason !== 'photo_too_big') {
    throw new Error(`Expected photo_too_big, received ${JSON.stringify(accountPhoto)}`);
  }
});

Deno.test('MediaFileService lets bots of the local profile upload documents over 50 MB', () => {
  const { mediaFiles } = createMediaFileFixture('local');
  const overCloudLimit = new Uint8Array(MAX_BOT_UPLOAD_BYTES.cloud + 1);

  const document = mediaFiles.prepareDocumentUpload({
    content: overCloudLimit,
    fileName: 'video.mp4',
    source: 'bot_upload',
  });
  if (!document.prepared) {
    throw new Error(`Expected the document to be accepted, received ${JSON.stringify(document)}`);
  }
  // TDLib's photo limit still applies to a local server's bots.
  const photo = mediaFiles.preparePhotoUpload({ content: overCloudLimit, source: 'bot_upload' });
  if (photo.prepared || photo.reason !== 'photo_too_big') {
    throw new Error(`Expected photo_too_big, received ${JSON.stringify(photo)}`);
  }
});

Deno.test('MediaFileService names documents and derives their MIME type', () => {
  const { mediaFiles } = createMediaFileFixture();

  const document = mediaFiles.prepareDocumentUpload({
    content: new Uint8Array([1]),
    fileName: 'Report.PDF',
    source: 'bot_upload',
  });
  const emptyDocument = mediaFiles.prepareDocumentUpload({
    content: new Uint8Array(),
    fileName: 'empty.txt',
    source: 'bot_upload',
  });
  if (
    !document.prepared || document.upload.fileName !== 'Report.PDF' ||
    document.upload.mimeType !== 'application/pdf' ||
    emptyDocument.prepared || emptyDocument.reason !== 'file_empty'
  ) {
    throw new Error(`Expected a PDF document and an empty file to be rejected`);
  }
});

Deno.test('MediaFileService keeps a usable thumbnail and leaves out others, as TDLib does', () => {
  const { mediaFiles } = createMediaFileFixture();
  const withThumbnail = (thumbnailContent: Uint8Array<ArrayBuffer>) =>
    mediaFiles.prepareDocumentUpload({
      content: new Uint8Array([1]),
      fileName: 'report.pdf',
      thumbnailContent,
      source: 'bot_upload',
    });

  const document = withThumbnail(gifImage(320, 240));
  if (
    !document.prepared ||
    JSON.stringify(document.upload.thumbnail) !== JSON.stringify({
        type: 'thumbnail',
        content: gifImage(320, 240),
        imageFormat: 'gif',
        width: 320,
        height: 240,
      })
  ) {
    throw new Error(`Expected a document with its thumbnail, received ${JSON.stringify(document)}`);
  }

  const largestThumbnail = new Uint8Array(MAX_THUMBNAIL_UPLOAD_BYTES);
  largestThumbnail.set(gifImage(90, 90));
  const unusableThumbnails = [
    new Uint8Array(),
    new Uint8Array(MAX_THUMBNAIL_UPLOAD_BYTES + 1),
    new TextEncoder().encode('not an image'),
  ];
  for (const thumbnailContent of unusableThumbnails) {
    const preparation = withThumbnail(thumbnailContent);
    if (!preparation.prepared || preparation.upload.thumbnail !== undefined) {
      throw new Error(
        `Expected the thumbnail to be left out, received ${JSON.stringify(preparation)}`,
      );
    }
  }
  const largest = withThumbnail(largestThumbnail);
  if (
    !largest.prepared || largest.upload.thumbnail?.content.length !== MAX_THUMBNAIL_UPLOAD_BYTES
  ) {
    throw new Error('Expected a thumbnail of 204799 bytes to be kept');
  }
});

Deno.test('MediaFileService lets bots download a document thumbnail as a file of its own', () => {
  const { files, mediaFiles } = createMediaFileFixture();
  const document = files.addFile({
    type: 'document',
    content: new Uint8Array([1, 2, 3]),
    fileName: 'notes.txt',
    mimeType: 'text/plain',
    thumbnail: {
      type: 'thumbnail',
      content: gifImage(32, 32),
      imageFormat: 'gif',
      width: 32,
      height: 32,
    },
  });
  const thumbnail = document.thumbnail;
  if (thumbnail === undefined || files.getFileByUniqueId(thumbnail.uniqueId) !== thumbnail) {
    throw new Error('Expected the thumbnail to be stored as a file of its own');
  }

  const thumbnailFileId = files.getOrAssignObserverFileId(FIRST_BOT_ID, thumbnail.id);
  const download = mediaFiles.getBotFile(FIRST_BOT_ID, thumbnailFileId);
  if (!download.found || download.downloadableFile.filePath !== 'thumbnails/file_0.gif') {
    throw new Error(`Expected a thumbnail download path, received ${JSON.stringify(download)}`);
  }
});

Deno.test('MediaFileService gives each bot its own file IDs and download paths', () => {
  const { files, mediaFiles } = createMediaFileFixture();
  const photo = files.addFile({
    type: 'photo',
    content: gifImage(10, 10),
    imageFormat: 'gif',
    width: 10,
    height: 10,
  });
  const document = files.addFile({
    type: 'document',
    content: new Uint8Array([1, 2, 3]),
    fileName: 'notes',
    mimeType: 'application/octet-stream',
  });
  const firstBotPhotoId = files.getOrAssignObserverFileId(FIRST_BOT_ID, photo.id);
  const firstBotDocumentId = files.getOrAssignObserverFileId(FIRST_BOT_ID, document.id);
  const secondBotPhotoId = files.getOrAssignObserverFileId(SECOND_BOT_ID, photo.id);

  if (
    files.getOrAssignObserverFileId(FIRST_BOT_ID, photo.id) !== firstBotPhotoId ||
    firstBotPhotoId === secondBotPhotoId ||
    mediaFiles.findObserverFile(FIRST_BOT_ID, firstBotPhotoId) !== photo ||
    mediaFiles.findObserverFile(FIRST_BOT_ID, secondBotPhotoId) !== undefined
  ) {
    throw new Error('Expected a stable file ID per bot that no other bot can use');
  }

  const photoFile = mediaFiles.getBotFile(FIRST_BOT_ID, firstBotPhotoId);
  const documentFile = mediaFiles.getBotFile(FIRST_BOT_ID, firstBotDocumentId);
  const photoFileAgain = mediaFiles.getBotFile(FIRST_BOT_ID, firstBotPhotoId);
  const secondBotPhotoFile = mediaFiles.getBotFile(SECOND_BOT_ID, secondBotPhotoId);
  const paths = [photoFile, documentFile, photoFileAgain, secondBotPhotoFile].map((result) =>
    result.found ? result.downloadableFile.filePath : result.reason
  );
  if (
    JSON.stringify(paths) !==
      JSON.stringify([
        'photos/file_0.gif',
        'documents/file_1',
        'photos/file_0.gif',
        'photos/file_0.gif',
      ])
  ) {
    throw new Error(`Expected numbered paths per bot, received ${JSON.stringify(paths)}`);
  }
  if (
    mediaFiles.findBotFileByPath(FIRST_BOT_ID, 'documents/file_1') !== document ||
    mediaFiles.findBotFileByPath(SECOND_BOT_ID, 'documents/file_1') !== undefined ||
    mediaFiles.findFileByUniqueId(document.uniqueId) !== document
  ) {
    throw new Error('Expected a download path to find the file only for its bot');
  }

  const unknownFile = mediaFiles.getBotFile(FIRST_BOT_ID, secondBotPhotoId);
  if (unknownFile.found || unknownFile.reason !== 'file_id_invalid') {
    throw new Error('Expected another bot file ID to identify no file');
  }
});

Deno.test('MediaFileService refuses downloads of files larger than 20 MB', () => {
  const { files, mediaFiles } = createMediaFileFixture();
  const largeDocument = files.addFile({
    type: 'document',
    content: new Uint8Array(MAX_BOT_DOWNLOAD_FILE_BYTES + 1),
    fileName: 'video.mp4',
    mimeType: 'video/mp4',
  });

  const result = mediaFiles.getBotFile(
    FIRST_BOT_ID,
    files.getOrAssignObserverFileId(FIRST_BOT_ID, largeDocument.id),
  );
  if (result.found || result.reason !== 'file_too_big') {
    throw new Error(`Expected the download to be refused, received ${JSON.stringify(result)}`);
  }
});

function createMediaFileFixture(uploadProfile: UploadProfile = 'cloud') {
  const files = new FileRepository();
  return { files, mediaFiles: new MediaFileService({ files, uploadProfile }) };
}

/** The header of a GIF image, which is all the emulator reads of a photo. */
function gifImage(width: number, height: number): Uint8Array<ArrayBuffer> {
  const image = new Uint8Array(13);
  image.set(new TextEncoder().encode('GIF89a'));
  const view = new DataView(image.buffer);
  view.setUint16(6, width, true);
  view.setUint16(8, height, true);
  return image;
}
