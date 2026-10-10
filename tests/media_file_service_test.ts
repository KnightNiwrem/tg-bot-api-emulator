import { FileRepository } from '../src/repositories/file.ts';
import { MediaFileService, type UploadSource } from '../src/services/media_file.ts';
import { WebFileDownloader, type WebResourceFetcher } from '../src/services/web_file_download.ts';
import { WebResourceService } from '../src/services/web_resource.ts';
import { WebResourceRepository } from '../src/repositories/web_resource.ts';
import {
  isWebVoiceNoteSentAsVoiceNote,
  MAX_BOT_DOWNLOAD_FILE_BYTES,
  MAX_PHOTO_UPLOAD_BYTES,
  MAX_THUMBNAIL_UPLOAD_BYTES,
  MAX_WEB_FILE_BYTES,
} from '../src/types/stored_file.ts';
import { MAX_BOT_UPLOAD_BYTES, type UploadProfile } from '../src/types/upload_profile.ts';
import { createRealTimeScheduler } from './support/scheduler.ts';

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

Deno.test('MediaFileService downloads files sent by URL as Telegram accepts them', async () => {
  const webResources = new WebResourceService({ webResources: new WebResourceRepository() });
  const register = (url: string, contentType: string, content: Uint8Array<ArrayBuffer>) =>
    webResources.registerWebResource({ url, status: 200, contentType, content });
  const pdfContent = new TextEncoder().encode('%PDF-1.7');
  register('https://example.com/files/report.pdf?v=2', 'application/pdf', pdfContent);
  register('https://example.com/chart.gif', 'image/gif', gifImage(64, 32));
  register('https://example.com/notes.txt', 'text/plain', new TextEncoder().encode('notes'));
  register('https://example.com/empty.pdf', 'application/pdf', new Uint8Array());
  register(
    'https://example.com/large.gif',
    'image/gif',
    new Uint8Array(MAX_WEB_FILE_BYTES.photo + 1),
  );
  register(
    'https://example.com/largest.gif',
    'image/gif',
    new Uint8Array(MAX_WEB_FILE_BYTES.photo),
  );
  webResources.registerWebResource({
    url: 'https://example.com/latest.pdf',
    status: 302,
    location: '/files/report.pdf?v=2',
    content: new Uint8Array(),
  });
  const { mediaFiles } = createMediaFileFixture(
    'cloud',
    createWebFileDownloader((request) => webResources.fetchWebResource(request)),
  );
  const download = (url: string, fileKind: 'photo' | 'document') =>
    mediaFiles.downloadWebFile({ url, fileKind });

  const document = await download('https://EXAMPLE.com/files/report.pdf?v=2', 'document');
  const redirected = await download('https://example.com/latest.pdf', 'document');
  const photo = await download('https://example.com/chart.gif', 'photo');
  const largestPhoto = await download('https://example.com/largest.gif', 'photo');
  if (
    !document.downloaded || document.webFile.fileName !== 'report.pdf' ||
    document.webFile.mediaType !== 'application/pdf' ||
    document.webFile.content.toBase64() !== pdfContent.toBase64() ||
    !redirected.downloaded || redirected.webFile.fileName !== 'latest.pdf' ||
    !photo.downloaded || photo.webFile.mediaType !== 'image/gif' ||
    !largestPhoto.downloaded
  ) {
    throw new Error(`Expected the files to be downloaded, received ${JSON.stringify(document)}`);
  }

  const failures = [
    await download('https://example.com/chart.gif', 'document'),
    await download('https://example.com/notes.txt', 'document'),
    await download('https://example.com/empty.pdf', 'document'),
    await download('https://example.com/files/report.pdf?v=2', 'photo'),
    await download('https://example.com/large.gif', 'photo'),
    await download('https://example.com/missing.pdf', 'document'),
    await download('ftp://example.com/report.pdf', 'document'),
  ].map((result) => result.downloaded ? 'downloaded' : JSON.stringify(result));
  const expectedFailures = [
    { downloaded: false, reason: 'web_content_type_invalid' },
    { downloaded: false, reason: 'web_content_type_invalid' },
    { downloaded: false, reason: 'web_content_type_invalid' },
    { downloaded: false, reason: 'web_content_type_invalid' },
    { downloaded: false, reason: 'web_content_unavailable' },
    { downloaded: false, reason: 'web_content_unavailable' },
    { downloaded: false, reason: 'file_url_invalid', urlError: 'Unsupported URL protocol' },
  ].map((failure) => JSON.stringify(failure));
  if (JSON.stringify(failures) !== JSON.stringify(expectedFailures)) {
    throw new Error(`Expected Telegram's refusals, received ${JSON.stringify(failures, null, 2)}`);
  }
});

Deno.test('MediaFileService prepares a downloaded document with the type it was served as', () => {
  const { mediaFiles } = createMediaFileFixture();
  const document = mediaFiles.prepareDocumentUpload({
    content: new Uint8Array([1]),
    fileName: 'download',
    mimeType: 'application/zip',
    source: 'web_download',
  });
  if (
    !document.prepared || document.upload.fileName !== 'download' ||
    document.upload.mimeType !== 'application/zip'
  ) {
    throw new Error(`Expected the served type to be kept, received ${JSON.stringify(document)}`);
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

Deno.test('MediaFileService keeps the attributes a sender defines for a video', () => {
  const { mediaFiles } = createMediaFileFixture();
  const attributes = { durationSeconds: 12, width: 1920, height: 1080 };
  const prepareVideo = (fileName: string | undefined, mimeType?: string) =>
    mediaFiles.prepareVideoUpload({
      // The content is never read, so any bytes are sent as a video.
      content: new TextEncoder().encode('not a video'),
      ...(fileName === undefined ? {} : { fileName }),
      ...(mimeType === undefined ? {} : { mimeType }),
      attributes,
      thumbnailContent: gifImage(320, 180),
      source: 'bot_upload',
    });

  const uploads = [
    prepareVideo('clip.mp4'),
    prepareVideo('clip.MOV'),
    prepareVideo('notes.txt'),
    prepareVideo(undefined),
    prepareVideo('download', 'video/mp4'),
  ].map((preparation) => {
    if (!preparation.prepared) {
      throw new Error(`Expected a video, received ${JSON.stringify(preparation)}`);
    }
    return preparation.upload;
  });
  // As TDLib uploads it, a video whose name names no video type is sent as `video/mp4`.
  const summaries = uploads.map(({ fileName, mimeType }) => [fileName ?? null, mimeType]);
  if (
    JSON.stringify(summaries) !== JSON.stringify([
        ['clip.mp4', 'video/mp4'],
        ['clip.MOV', 'video/quicktime'],
        ['notes.txt', 'video/mp4'],
        [null, 'video/mp4'],
        ['download', 'video/mp4'],
      ]) ||
    uploads.some(({ durationSeconds, width, height, thumbnail }) =>
      durationSeconds !== 12 || width !== 1920 || height !== 1080 || thumbnail?.width !== 320 ||
      thumbnail.height !== 180
    )
  ) {
    throw new Error(`Expected the sender's attributes, received ${JSON.stringify(summaries)}`);
  }

  const empty = mediaFiles.prepareVideoUpload({
    content: new Uint8Array(),
    fileName: 'clip.mp4',
    attributes,
    source: 'account_upload',
  });
  if (empty.prepared || empty.reason !== 'file_empty') {
    throw new Error(`Expected file_empty, received ${JSON.stringify(empty)}`);
  }
});

Deno.test('MediaFileService limits bot videos by the upload profile only', () => {
  const attributes = { durationSeconds: 0, width: 0, height: 0 };
  const prepareVideo = (
    profile: UploadProfile,
    content: Uint8Array<ArrayBuffer>,
    source: UploadSource,
  ) =>
    createMediaFileFixture(profile).mediaFiles.prepareVideoUpload({
      content,
      fileName: 'clip.mp4',
      attributes,
      source,
    });
  const overCloudLimit = new Uint8Array(MAX_BOT_UPLOAD_BYTES.cloud + 1);

  const cloudFailure = prepareVideo('cloud', overCloudLimit, 'bot_upload');
  if (
    !prepareVideo('cloud', new Uint8Array(MAX_BOT_UPLOAD_BYTES.cloud), 'bot_upload').prepared ||
    JSON.stringify(cloudFailure) !== JSON.stringify({
        prepared: false,
        reason: 'bot_upload_too_big',
        uploadProfile: 'cloud',
        fileSizeBytes: MAX_BOT_UPLOAD_BYTES.cloud + 1,
        maxFileSizeBytes: MAX_BOT_UPLOAD_BYTES.cloud,
      }) ||
    !prepareVideo('local', overCloudLimit, 'bot_upload').prepared ||
    !prepareVideo('cloud', overCloudLimit, 'account_upload').prepared
  ) {
    throw new Error(`Expected only the cloud bot upload to fail, received ${cloudFailure}`);
  }
});

Deno.test('MediaFileService downloads a video sent by URL only when served as MPEG-4', async () => {
  const webResources = new WebResourceService({ webResources: new WebResourceRepository() });
  const register = (url: string, contentType: string, content: Uint8Array<ArrayBuffer>) =>
    webResources.registerWebResource({ url, status: 200, contentType, content });
  register('https://example.com/clip.mp4', 'video/mp4', new Uint8Array([1, 2, 3]));
  register('https://example.com/clip.webm', 'video/webm', new Uint8Array([1, 2, 3]));
  register(
    'https://example.com/largest.mp4',
    'video/mp4',
    new Uint8Array(MAX_WEB_FILE_BYTES.video),
  );
  register(
    'https://example.com/large.mp4',
    'video/mp4',
    new Uint8Array(MAX_WEB_FILE_BYTES.video + 1),
  );
  const { mediaFiles } = createMediaFileFixture(
    'cloud',
    createWebFileDownloader((request) => webResources.fetchWebResource(request)),
  );
  const download = (url: string) => mediaFiles.downloadWebFile({ url, fileKind: 'video' });

  const video = await download('https://example.com/clip.mp4');
  const largest = await download('https://example.com/largest.mp4');
  const failures = [
    await download('https://example.com/clip.webm'),
    await download('https://example.com/large.mp4'),
  ].map((result) => result.downloaded ? 'downloaded' : result.reason);
  if (
    !video.downloaded || video.webFile.fileName !== 'clip.mp4' ||
    video.webFile.mediaType !== 'video/mp4' || !largest.downloaded ||
    JSON.stringify(failures) !==
      JSON.stringify(['web_content_type_invalid', 'web_content_unavailable'])
  ) {
    throw new Error(`Expected only MPEG-4 videos of up to 20 MB, received ${failures}`);
  }
});

Deno.test('MediaFileService types voice notes as TDLib uploads them and keeps their duration', () => {
  const { mediaFiles } = createMediaFileFixture();
  const prepareVoice = (fileName: string | undefined) =>
    mediaFiles.prepareVoiceUpload({
      // The content is never read, so any bytes are sent as a voice note.
      content: new TextEncoder().encode('not a recording'),
      ...(fileName === undefined ? {} : { fileName }),
      durationSeconds: 9,
      source: 'bot_upload',
    });

  const mimeTypes = ['note.ogg', 'note.opus', 'note.MP3', 'note.m4a', 'note.wav', undefined].map(
    (fileName) => {
      const preparation = prepareVoice(fileName);
      if (!preparation.prepared || preparation.upload.durationSeconds !== 9) {
        throw new Error(`Expected a voice note, received ${JSON.stringify(preparation)}`);
      }
      return preparation.upload.mimeType;
    },
  );
  const empty = mediaFiles.prepareVoiceUpload({
    content: new Uint8Array(),
    durationSeconds: 0,
    source: 'account_upload',
  });
  if (
    JSON.stringify(mimeTypes) !== JSON.stringify([
        'audio/ogg',
        'audio/ogg',
        'audio/mpeg',
        'audio/mp4',
        'audio/ogg',
        'audio/ogg',
      ]) || empty.prepared || empty.reason !== 'file_empty'
  ) {
    throw new Error(`Expected TDLib's voice note types, received ${JSON.stringify(mimeTypes)}`);
  }
});

Deno.test('MediaFileService limits bot voice notes by the upload profile only', () => {
  const prepareVoice = (
    profile: UploadProfile,
    content: Uint8Array<ArrayBuffer>,
    source: UploadSource,
  ) =>
    createMediaFileFixture(profile).mediaFiles.prepareVoiceUpload({
      content,
      durationSeconds: 0,
      source,
    });
  const overCloudLimit = new Uint8Array(MAX_BOT_UPLOAD_BYTES.cloud + 1);
  const cloudFailure = prepareVoice('cloud', overCloudLimit, 'bot_upload');
  if (
    !prepareVoice('cloud', new Uint8Array(MAX_BOT_UPLOAD_BYTES.cloud), 'bot_upload').prepared ||
    cloudFailure.prepared || cloudFailure.reason !== 'bot_upload_too_big' ||
    !prepareVoice('local', overCloudLimit, 'bot_upload').prepared ||
    !prepareVoice('cloud', overCloudLimit, 'account_upload').prepared
  ) {
    throw new Error(`Expected only the cloud bot upload to fail, received ${cloudFailure}`);
  }
});

Deno.test('MediaFileService downloads a voice note sent by URL only when served as OGG', async () => {
  const webResources = new WebResourceService({ webResources: new WebResourceRepository() });
  const register = (url: string, contentType: string, content: Uint8Array<ArrayBuffer>) =>
    webResources.registerWebResource({ url, status: 200, contentType, content });
  register('https://example.com/note.ogg', 'audio/ogg', new Uint8Array([1, 2]));
  register('https://example.com/note.mp3', 'audio/mpeg', new Uint8Array([1, 2]));
  register(
    'https://example.com/largest.ogg',
    'audio/ogg',
    new Uint8Array(MAX_WEB_FILE_BYTES.voice),
  );
  register(
    'https://example.com/large.ogg',
    'audio/ogg',
    new Uint8Array(MAX_WEB_FILE_BYTES.voice + 1),
  );
  const { mediaFiles } = createMediaFileFixture(
    'cloud',
    createWebFileDownloader((request) => webResources.fetchWebResource(request)),
  );
  const download = (url: string) => mediaFiles.downloadWebFile({ url, fileKind: 'voice' });

  const outcomes = await Promise.all([
    'https://example.com/note.ogg',
    'https://example.com/largest.ogg',
    'https://example.com/note.mp3',
    'https://example.com/large.ogg',
  ].map(async (url) => {
    const result = await download(url);
    return result.downloaded ? result.webFile.mediaType : result.reason;
  }));
  if (
    JSON.stringify(outcomes) !== JSON.stringify([
      'audio/ogg',
      'audio/ogg',
      'web_content_type_invalid',
      'web_content_unavailable',
    ])
  ) {
    throw new Error(`Expected only OGG voice notes of up to 20 MB, received ${outcomes}`);
  }
});

Deno.test('isWebVoiceNoteSentAsVoiceNote sends voice notes by URL as such up to 1 MB', () => {
  const megabyte = 1024 * 1024;
  if (!isWebVoiceNoteSentAsVoiceNote(megabyte) || isWebVoiceNoteSentAsVoiceNote(megabyte + 1)) {
    throw new Error('Expected voice notes of at most 1048576 bytes to stay voice notes');
  }
});

Deno.test('MediaFileService lets bots download voice notes under their type extension', () => {
  const { files, mediaFiles } = createMediaFileFixture();
  const voiceNotes = ['audio/ogg', 'audio/mpeg', 'audio/mp4'].map((mimeType) =>
    files.addFile({ type: 'voice', content: new Uint8Array([1]), mimeType, durationSeconds: 1 })
  );
  const paths = voiceNotes.map((voice) => {
    const result = mediaFiles.getBotFile(
      FIRST_BOT_ID,
      files.getOrAssignObserverFileId(FIRST_BOT_ID, voice.id),
    );
    return result.found ? result.downloadableFile.filePath : result.reason;
  });
  if (
    JSON.stringify(paths) !==
      JSON.stringify(['voice/file_0.oga', 'voice/file_1.mp3', 'voice/file_2.m4a'])
  ) {
    throw new Error(`Expected voice note paths, received ${JSON.stringify(paths)}`);
  }
});

Deno.test('MediaFileService lets bots download a video and its thumbnail as files', () => {
  const { files, mediaFiles } = createMediaFileFixture();
  const video = files.addFile({
    type: 'video',
    content: new Uint8Array([1, 2, 3]),
    fileName: 'clip.mov',
    mimeType: 'video/quicktime',
    durationSeconds: 3,
    width: 640,
    height: 480,
    thumbnail: {
      type: 'thumbnail',
      content: gifImage(32, 24),
      imageFormat: 'gif',
      width: 32,
      height: 24,
    },
  });
  const unnamedVideo = files.addFile({
    type: 'video',
    content: new Uint8Array([4]),
    mimeType: 'video/mp4',
    durationSeconds: 0,
    width: 0,
    height: 0,
  });
  const getPath = (fileId: string) => {
    const result = mediaFiles.getBotFile(
      FIRST_BOT_ID,
      files.getOrAssignObserverFileId(FIRST_BOT_ID, fileId),
    );
    return result.found ? result.downloadableFile.filePath : result.reason;
  };

  const paths = [video.id, video.thumbnail?.id ?? '', unnamedVideo.id].map(getPath);
  if (
    JSON.stringify(paths) !==
      JSON.stringify(['videos/file_0.mov', 'thumbnails/file_1.gif', 'videos/file_2'])
  ) {
    throw new Error(`Expected video and thumbnail paths, received ${JSON.stringify(paths)}`);
  }
});

Deno.test('MediaFileService keeps the metadata a sender defines for an audio file', () => {
  const { mediaFiles } = createMediaFileFixture();
  const prepareAudio = (
    fileName: string | undefined,
    attributes: { durationSeconds: number; performer?: string; title?: string },
  ) =>
    mediaFiles.prepareAudioUpload({
      // The content is never read, so any bytes are sent as an audio file, and no tags are read.
      content: new TextEncoder().encode('not audio'),
      ...(fileName === undefined ? {} : { fileName }),
      attributes,
      thumbnailContent: gifImage(300, 300),
      source: 'bot_upload',
    });

  const uploads = [
    prepareAudio('track.mp3', { durationSeconds: 215, performer: 'Ada', title: 'Engines' }),
    prepareAudio('live.flac', { durationSeconds: 0 }),
    prepareAudio(undefined, { durationSeconds: 3, performer: '', title: '' }),
  ].map((preparation) => {
    if (!preparation.prepared) {
      throw new Error(`Expected an audio file, received ${JSON.stringify(preparation)}`);
    }
    const { content: _content, thumbnail, ...upload } = preparation.upload;
    return { ...upload, thumbnail: thumbnail === undefined ? null : thumbnail.width };
  });
  // An empty performer or title is none, and a name that names no audio type is `audio/mpeg`.
  const expectedUploads = [
    {
      type: 'audio',
      fileName: 'track.mp3',
      mimeType: 'audio/mpeg',
      durationSeconds: 215,
      performer: 'Ada',
      title: 'Engines',
      thumbnail: 300,
    },
    {
      type: 'audio',
      fileName: 'live.flac',
      mimeType: 'audio/flac',
      durationSeconds: 0,
      thumbnail: 300,
    },
    { type: 'audio', mimeType: 'audio/mpeg', durationSeconds: 3, thumbnail: 300 },
  ];
  if (JSON.stringify(uploads) !== JSON.stringify(expectedUploads)) {
    throw new Error(`Expected the sender's metadata, received ${JSON.stringify(uploads)}`);
  }

  const empty = mediaFiles.prepareAudioUpload({
    content: new Uint8Array(),
    attributes: { durationSeconds: 1 },
    source: 'account_upload',
  });
  const tooBig = mediaFiles.prepareAudioUpload({
    content: new Uint8Array(MAX_BOT_UPLOAD_BYTES.cloud + 1),
    attributes: { durationSeconds: 1 },
    source: 'bot_upload',
  });
  if (
    empty.prepared || empty.reason !== 'file_empty' || tooBig.prepared ||
    tooBig.reason !== 'bot_upload_too_big'
  ) {
    throw new Error(
      `Expected empty and oversized audio to fail, received ${
        JSON.stringify([empty, tooBig].map((preparation) =>
          preparation.prepared || preparation.reason
        ))
      }`,
    );
  }
});

Deno.test('MediaFileService downloads an audio file sent by URL only when served as MP3', async () => {
  const webResources = new WebResourceService({ webResources: new WebResourceRepository() });
  const register = (url: string, contentType: string, content: Uint8Array<ArrayBuffer>) =>
    webResources.registerWebResource({ url, status: 200, contentType, content });
  register('https://example.com/songs/track.mp3', 'audio/mpeg', new Uint8Array([1, 2]));
  register('https://example.com/songs/track.m4a', 'audio/mp4', new Uint8Array([1, 2]));
  register(
    'https://example.com/songs/large.mp3',
    'audio/mpeg',
    new Uint8Array(MAX_WEB_FILE_BYTES.audio + 1),
  );
  const { mediaFiles } = createMediaFileFixture(
    'cloud',
    createWebFileDownloader((request) => webResources.fetchWebResource(request)),
  );

  const outcomes = await Promise.all([
    'https://example.com/songs/track.mp3',
    'https://example.com/songs/track.m4a',
    'https://example.com/songs/large.mp3',
  ].map(async (url) => {
    const result = await mediaFiles.downloadWebFile({ url, fileKind: 'audio' });
    if (!result.downloaded) {
      return result.reason;
    }
    const preparation = mediaFiles.prepareWebAudioUpload(result.webFile, {
      durationSeconds: 30,
      title: 'Engines',
    });
    return preparation.prepared
      ? [preparation.upload.fileName, preparation.upload.mimeType, preparation.upload.title]
      : preparation.reason;
  }));
  if (
    JSON.stringify(outcomes) !== JSON.stringify([
      ['track.mp3', 'audio/mpeg', 'Engines'],
      'web_content_type_invalid',
      'web_content_unavailable',
    ])
  ) {
    throw new Error(`Expected only MP3 audio files of up to 20 MB, received ${outcomes}`);
  }
});

Deno.test('MediaFileService lets bots download audio files under music/ as TDLib names them', () => {
  const { files, mediaFiles } = createMediaFileFixture();
  const addAudio = (fileName: string | undefined) =>
    files.addFile({
      type: 'audio',
      content: new Uint8Array([1]),
      ...(fileName === undefined ? {} : { fileName }),
      mimeType: 'audio/mpeg',
      durationSeconds: 1,
      ...(fileName === 'cover.m4a'
        ? {
          thumbnail: {
            type: 'thumbnail',
            content: gifImage(32, 32),
            imageFormat: 'gif',
            width: 32,
            height: 32,
          },
        }
        : {}),
    });
  const audioFiles = ['track.m4a', 'live.flac', undefined, 'cover.m4a'].map(addAudio);
  const fileIds = [...audioFiles.map(({ id }) => id), audioFiles[3].thumbnail?.id ?? ''];
  const paths = fileIds.map((fileId) => {
    const result = mediaFiles.getBotFile(
      FIRST_BOT_ID,
      files.getOrAssignObserverFileId(FIRST_BOT_ID, fileId),
    );
    return result.found ? result.downloadableFile.filePath : result.reason;
  });
  if (
    JSON.stringify(paths) !== JSON.stringify([
      'music/file_0.m4a',
      'music/file_1.mp3',
      'music/file_2.mp3',
      'music/file_3.m4a',
      'thumbnails/file_4.gif',
    ])
  ) {
    throw new Error(`Expected audio paths, received ${JSON.stringify(paths)}`);
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

function createMediaFileFixture(
  uploadProfile: UploadProfile = 'cloud',
  webFiles: WebFileDownloader = createWebFileDownloader(() => {
    throw new TypeError('No web resource is registered');
  }),
) {
  const files = new FileRepository();
  return { files, mediaFiles: new MediaFileService({ files, uploadProfile, webFiles }) };
}

function createWebFileDownloader(fetchWebResource: WebResourceFetcher): WebFileDownloader {
  return new WebFileDownloader({
    fetchWebResource,
    timeoutMilliseconds: 1_000,
    maxRedirects: 5,
    scheduler: createRealTimeScheduler(),
  });
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
