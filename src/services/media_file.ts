import { getAudioFileExtension, getAudioMimeType } from '../media/audio_file.ts';
import {
  cleanUploadedFileName,
  getDocumentMimeType,
  getFileNameExtension,
} from '../media/document_file.ts';
import { readImageDimensions } from '../media/image_dimensions.ts';
import { getVideoMimeType } from '../media/video_file.ts';
import { getVoiceFileExtension, getVoiceMimeType } from '../media/voice_file.ts';
import { formatHttpUrl, getHttpUrlFileName, parseHttpUrl } from '../types/http_url.ts';
import {
  type AudioAttributes,
  type AudioUpload,
  type DocumentUpload,
  type InlineResultWebFileKind,
  MAX_BOT_DOWNLOAD_FILE_BYTES,
  MAX_INLINE_RESULT_WEB_FILE_BYTES,
  MAX_PHOTO_UPLOAD_BYTES,
  MAX_THUMBNAIL_UPLOAD_BYTES,
  MAX_WEB_FILE_BYTES,
  type PhotoImageFormat,
  type PhotoUpload,
  type StoredFile,
  type StoredFileId,
  type ThumbnailUpload,
  type VideoAttributes,
  type VideoUpload,
  type VoiceUpload,
  type WebFile,
  type WebFileKind,
} from '../types/stored_file.ts';
import {
  type BotUploadTooBigFailure,
  checkBotUploadSize,
  IS_BOT_UPLOAD_LIMIT_CHECKED_BEFORE_TDLIB,
  type UploadProfile,
} from '../types/upload_profile.ts';
import type { WebFileDownload } from './web_file_download.ts';

/** Telegram rejects a photo whose width and height add up to more than this. */
const MAX_PHOTO_DIMENSION_SUM = 10_000;

/** Telegram rejects a photo whose longer side is more than this many times its shorter side. */
const MAX_PHOTO_ASPECT_RATIO = 20;

/** The directory of a bot's downloadable files of each type, as the Bot API server names it. */
const BOT_FILE_DIRECTORIES: Readonly<Record<StoredFile['type'], string>> = {
  photo: 'photos',
  document: 'documents',
  video: 'videos',
  voice: 'voice',
  audio: 'music',
  thumbnail: 'thumbnails',
};

const PHOTO_FILE_EXTENSIONS: Readonly<Record<PhotoImageFormat, string>> = {
  jpeg: 'jpg',
  png: 'png',
  gif: 'gif',
  webp: 'webp',
  bmp: 'bmp',
};

/**
 * Where new file content comes from, which decides the size limits it must meet: a bot's upload,
 * through the session's Bot API server; an account's upload, through its own Telegram client; or
 * Telegram's download of a URL a bot sent, which `downloadWebFile` limits as it reads.
 */
export type UploadSource = 'bot_upload' | 'account_upload' | 'web_download';

/** Media types of files that Telegram sends by URL as documents: PDF and ZIP files only. */
const WEB_DOCUMENT_MEDIA_TYPES: ReadonlySet<string> = new Set([
  'application/pdf',
  'application/zip',
]);

/**
 * Whether Telegram sends a file served as a media type by URL as each kind of file: a photo served
 * as an image; a document served as a PDF or ZIP file, the only kinds Telegram documents for URLs;
 * a video served as an MPEG-4 video, the only format Telegram documents that its clients play; a
 * voice note served as `audio/ogg`, which Telegram documents as required for `sendVoice`; and an
 * audio file served as `audio/mpeg`, the type Telegram's file sending reference names for
 * `sendAudio`.
 */
const ACCEPTS_WEB_MEDIA_TYPE: Readonly<Record<WebFileKind, (mediaType: string) => boolean>> = {
  photo: (mediaType) => mediaType.startsWith('image/'),
  document: (mediaType) => WEB_DOCUMENT_MEDIA_TYPES.has(mediaType),
  video: (mediaType) => mediaType === 'video/mp4',
  voice: (mediaType) => mediaType === 'audio/ogg',
  audio: (mediaType) => mediaType === 'audio/mpeg',
};

/**
 * Whether Telegram sends a file that an inline query result names by URL, served as a media type,
 * as the result's kind of media: a photo served as a JPEG image, the only format the Bot API
 * documents for `InlineQueryResultPhoto`; a document served as a PDF or ZIP file, the only kinds
 * it documents for `InlineQueryResultDocument`; a video file served as `video/mp4`, the only file
 * type it documents for `InlineQueryResultVideo`; a voice note served as `audio/ogg`, as TDLib
 * types the web document of `InlineQueryResultVoice`; and an audio file served as `audio/mpeg`, as
 * TDLib types that of `InlineQueryResultAudio`.
 */
const ACCEPTS_INLINE_RESULT_WEB_MEDIA_TYPE: Readonly<
  Record<InlineResultWebFileKind, (mediaType: string) => boolean>
> = {
  photo: (mediaType) => mediaType === 'image/jpeg',
  document: (mediaType) => WEB_DOCUMENT_MEDIA_TYPES.has(mediaType),
  video: (mediaType) => mediaType === 'video/mp4',
  voice: (mediaType) => mediaType === 'audio/ogg',
  audio: (mediaType) => mediaType === 'audio/mpeg',
};

/** Downloads the file at a URL, as `WebFileDownloader` does. */
interface WebFileSource {
  download(url: string, maxContentBytes: number, signal?: AbortSignal): Promise<WebFileDownload>;
}

export interface WebFileDownloadRequest {
  /** The URL as the bot sent it. */
  readonly url: string;
  /** What the bot sends the file as, which decides how large it may be and of which types. */
  readonly fileKind: WebFileKind;
  /** Aborts the download when the bot stops waiting for the answer. */
  readonly signal?: AbortSignal;
}

export interface InlineResultWebFileDownloadRequest {
  /** The URL as the bot's answer named it. */
  readonly url: string;
  /** What the result sends the file as, which decides how large it may be and of which types. */
  readonly fileKind: InlineResultWebFileKind;
  /** Aborts the download when the account stops waiting for the result to be sent. */
  readonly signal?: AbortSignal;
}

export type WebFileDownloadResult =
  | { readonly downloaded: true; readonly webFile: WebFile }
  | { readonly downloaded: false; readonly reason: 'file_url_invalid'; readonly urlError: string }
  | {
    readonly downloaded: false;
    readonly reason: 'web_content_unavailable' | 'web_content_type_invalid';
  };

/** An uploaded file is too large for a photo. */
export interface PhotoTooBigFailure {
  readonly reason: 'photo_too_big';
  readonly fileSizeBytes: number;
}

export type PhotoUploadPreparation =
  | { readonly prepared: true; readonly upload: PhotoUpload }
  | {
    readonly prepared: false;
    readonly reason: 'file_empty' | 'image_invalid' | 'photo_dimensions_invalid';
  }
  | ({ readonly prepared: false } & (PhotoTooBigFailure | BotUploadTooBigFailure));

export type DocumentUploadPreparation =
  | { readonly prepared: true; readonly upload: DocumentUpload }
  | { readonly prepared: false; readonly reason: 'file_empty' }
  | ({ readonly prepared: false } & BotUploadTooBigFailure);

export type VideoUploadPreparation =
  | { readonly prepared: true; readonly upload: VideoUpload }
  | { readonly prepared: false; readonly reason: 'file_empty' }
  | ({ readonly prepared: false } & BotUploadTooBigFailure);

export type VoiceUploadPreparation =
  | { readonly prepared: true; readonly upload: VoiceUpload }
  | { readonly prepared: false; readonly reason: 'file_empty' }
  | ({ readonly prepared: false } & BotUploadTooBigFailure);

export type AudioUploadPreparation =
  | { readonly prepared: true; readonly upload: AudioUpload }
  | { readonly prepared: false; readonly reason: 'file_empty' }
  | ({ readonly prepared: false } & BotUploadTooBigFailure);

export interface PhotoUploadRequest {
  readonly content: Uint8Array<ArrayBuffer>;
  readonly source: UploadSource;
}

export interface DocumentUploadRequest {
  readonly content: Uint8Array<ArrayBuffer>;
  /** The nonempty name to send the document under. */
  readonly fileName: string;
  /** The document's MIME type; omitted for the one its file name's extension decides. */
  readonly mimeType?: string;
  /** The content of the thumbnail uploaded with the document; omitted for none. */
  readonly thumbnailContent?: Uint8Array<ArrayBuffer>;
  readonly source: UploadSource;
}

export interface VideoUploadRequest {
  readonly content: Uint8Array<ArrayBuffer>;
  /** The nonempty name to send the video under; omitted for none. */
  readonly fileName?: string;
  /**
   * The video's MIME type, which must be a `video/` type; omitted for the one its file name
   * decides.
   */
  readonly mimeType?: string;
  /** The duration and dimensions its sender defines, unchecked against the content. */
  readonly attributes: VideoAttributes;
  /** The content of the thumbnail uploaded with the video; omitted for none. */
  readonly thumbnailContent?: Uint8Array<ArrayBuffer>;
  readonly source: UploadSource;
}

export interface VoiceUploadRequest {
  readonly content: Uint8Array<ArrayBuffer>;
  /**
   * The name the file was sent under, whose extension decides the voice note's MIME type; omitted
   * for none. The voice note keeps no name.
   */
  readonly fileName?: string;
  /**
   * The voice note's MIME type, which must be `audio/ogg`, `audio/mpeg`, or `audio/mp4`, as a voice
   * note sent by URL is served; omitted for the one its file name decides.
   */
  readonly mimeType?: string;
  /** As its sender defines it, unchecked against the content. */
  readonly durationSeconds: number;
  readonly source: UploadSource;
}

export interface AudioUploadRequest {
  readonly content: Uint8Array<ArrayBuffer>;
  /** The nonempty name to send the audio file under; omitted for none. */
  readonly fileName?: string;
  /**
   * The audio file's MIME type, which must be an `audio/` type; omitted for the one its file name
   * decides.
   */
  readonly mimeType?: string;
  /** The duration, performer and title its sender defines, unchecked against the content. */
  readonly attributes: AudioAttributes;
  /** The content of the thumbnail uploaded with the audio file; omitted for none. */
  readonly thumbnailContent?: Uint8Array<ArrayBuffer>;
  readonly source: UploadSource;
}

/** A file a bot can download, with the path it downloads the file from. */
export interface BotDownloadableFile {
  readonly file: StoredFile;
  /** The observing bot's `file_id` of the file. */
  readonly fileId: string;
  readonly filePath: string;
}

export type GetBotFileResult =
  | { readonly found: true; readonly downloadableFile: BotDownloadableFile }
  | { readonly found: false; readonly reason: 'file_id_invalid' | 'file_too_big' };

interface FileStore {
  getFileByUniqueId(uniqueId: string): StoredFile | undefined;
  findObserverFile(observerId: number, observerFileId: string): StoredFile | undefined;
  getBotFilePath(botId: number, fileId: StoredFileId): string | undefined;
  countBotFilePaths(botId: number): number;
  addBotFilePath(botId: number, fileId: StoredFileId, filePath: string): void;
  findBotFileByPath(botId: number, filePath: string): StoredFile | undefined;
}

interface MediaFileServiceDependencies {
  readonly files: FileStore;
  /** The upload profile of the session, which decides how large a file its bots may upload. */
  readonly uploadProfile: UploadProfile;
  /** Downloads the files bots send by URL from the session's emulated web. */
  readonly webFiles: WebFileSource;
}

/**
 * Checks files that users send as photos, documents, videos, voice notes, or audio files, resolves
 * the `file_id`
 * by which a user reuses a file it has seen, and lets bots download files, as Telegram does.
 *
 * Messages store their uploads when they are sent; this service stores no file content itself.
 */
export class MediaFileService {
  readonly #files: FileStore;
  readonly #uploadProfile: UploadProfile;
  readonly #webFiles: WebFileSource;

  constructor({ files, uploadProfile, webFiles }: MediaFileServiceDependencies) {
    this.#files = files;
    this.#uploadProfile = uploadProfile;
    this.#webFiles = webFiles;
  }

  /**
   * Downloads a file that a bot sends by URL, as Telegram does before it sends the file. The URL
   * is read as TDLib's `parse_url` reads it. A photo may be at most 5 MB and must be served as an
   * image. A document may be at most 20 MB and must be served as a PDF or ZIP file, the only kinds
   * Telegram documents for URLs. A video may be at most 20 MB and must be served as `video/mp4`, a
   * voice note at most 20 MB, served as `audio/ogg`, and an audio file at most 20 MB, served as
   * `audio/mpeg`. The content of a document, video, voice note, or audio file is not inspected.
   * Content that cannot be downloaded,
   * including larger content, fails as Telegram's `WEBPAGE_CURL_FAILED`, and empty content or
   * content of another type as its `WEBPAGE_MEDIA_EMPTY`.
   */
  downloadWebFile(
    { url, fileKind, signal }: WebFileDownloadRequest,
  ): Promise<WebFileDownloadResult> {
    return this.#downloadWebContent(
      url,
      MAX_WEB_FILE_BYTES[fileKind],
      ACCEPTS_WEB_MEDIA_TYPE[fileKind],
      signal,
    );
  }

  /**
   * Downloads a file that an inline query result names by URL, as Telegram does when an account
   * sends the result, with the contracts the Bot API documents for inline results rather than
   * those of the send methods: a photo of at most 5 MB served as `image/jpeg`, and, of at most
   * 20 MB, a document served as a PDF or ZIP file, a video served as `video/mp4`, a voice note
   * served as `audio/ogg`, and an audio file served as `audio/mpeg`. The URL is read, and failures are given, as `downloadWebFile` reads and
   * gives them.
   */
  downloadInlineResultWebFile(
    { url, fileKind, signal }: InlineResultWebFileDownloadRequest,
  ): Promise<WebFileDownloadResult> {
    return this.#downloadWebContent(
      url,
      MAX_INLINE_RESULT_WEB_FILE_BYTES[fileKind],
      ACCEPTS_INLINE_RESULT_WEB_MEDIA_TYPE[fileKind],
      signal,
    );
  }

  /**
   * Prepares a photo downloaded from a URL as `preparePhotoUpload` prepares an uploaded one, so
   * that content that is not a readable image, or whose dimensions Telegram refuses, fails.
   */
  prepareWebPhotoUpload(webFile: WebFile): PhotoUploadPreparation {
    return this.preparePhotoUpload({ content: webFile.content, source: 'web_download' });
  }

  /**
   * Prepares a photo that an inline query result names by URL, as `prepareWebPhotoUpload` does,
   * which must also be a JPEG image, the only format the Bot API documents for
   * `InlineQueryResultPhoto`, whatever type it was served as.
   */
  prepareInlineResultWebPhotoUpload(webFile: WebFile): PhotoUploadPreparation {
    const preparation = this.prepareWebPhotoUpload(webFile);
    return preparation.prepared && preparation.upload.imageFormat !== 'jpeg'
      ? { prepared: false, reason: 'image_invalid' }
      : preparation;
  }

  /**
   * Prepares a file downloaded from a URL as a document, as `prepareDocumentUpload` prepares an
   * upload: named after the URL's last path segment, cleaned as an upload's name, and typed as it
   * was served. TDLib sends a document given by URL as a web document, which takes no thumbnail.
   */
  prepareWebDocumentUpload(webFile: WebFile): DocumentUploadPreparation {
    return this.prepareDocumentUpload({
      content: webFile.content,
      fileName: cleanUploadedFileName(webFile.fileName),
      mimeType: webFile.mediaType,
      source: 'web_download',
    });
  }

  /**
   * Prepares a file downloaded from a URL as a video, as `prepareVideoUpload` prepares an upload,
   * with the attributes its sender specified: named after the URL's last path segment, if it has
   * one, and typed as it was served. As for a document, TDLib sends it as a web document, which
   * takes no thumbnail.
   */
  prepareWebVideoUpload(webFile: WebFile, attributes: VideoAttributes): VideoUploadPreparation {
    return this.prepareVideoUpload({
      content: webFile.content,
      ...(webFile.fileName.length === 0
        ? {}
        : { fileName: cleanUploadedFileName(webFile.fileName) }),
      mimeType: webFile.mediaType,
      attributes,
      source: 'web_download',
    });
  }

  /**
   * Prepares a file downloaded from a URL as a voice note, as `prepareVoiceUpload` prepares an
   * upload, typed as it was served and with the duration its sender specified.
   */
  prepareWebVoiceUpload(webFile: WebFile, durationSeconds: number): VoiceUploadPreparation {
    return this.prepareVoiceUpload({
      content: webFile.content,
      mimeType: webFile.mediaType,
      durationSeconds,
      source: 'web_download',
    });
  }

  /**
   * Prepares a file downloaded from a URL as an audio file, as `prepareAudioUpload` prepares an
   * upload, with the attributes its sender specified: named after the URL's last path segment, if
   * it has one, and typed as it was served. As for a video, TDLib sends it as a web document, which
   * takes no thumbnail.
   */
  prepareWebAudioUpload(webFile: WebFile, attributes: AudioAttributes): AudioUploadPreparation {
    return this.prepareAudioUpload({
      content: webFile.content,
      ...(webFile.fileName.length === 0
        ? {}
        : { fileName: cleanUploadedFileName(webFile.fileName) }),
      mimeType: webFile.mediaType,
      attributes,
      source: 'web_download',
    });
  }

  /**
   * Reads an uploaded image, which must be a JPEG, PNG, GIF, WebP, or BMP image, and checks its
   * dimensions as Telegram does for photos. Telegram also accepts other image formats, such as
   * TIFF, which the emulator does not read. As TDLib's `check_full_local_location` does for bots
   * and accounts alike, the photo's size is checked before Telegram's server reads the image. A
   * bot's upload must also fit its session's upload profile, which the cloud server checks first
   * and Telegram checks for a local server after TDLib's checks.
   */
  preparePhotoUpload({ content, source }: PhotoUploadRequest): PhotoUploadPreparation {
    if (content.length === 0) {
      return { prepared: false, reason: 'file_empty' };
    }
    const uploadSizeFailure = this.#checkUploadSize(content, source);
    if (
      uploadSizeFailure !== undefined &&
      IS_BOT_UPLOAD_LIMIT_CHECKED_BEFORE_TDLIB[uploadSizeFailure.uploadProfile]
    ) {
      return { prepared: false, ...uploadSizeFailure };
    }
    if (content.length > MAX_PHOTO_UPLOAD_BYTES) {
      return { prepared: false, reason: 'photo_too_big', fileSizeBytes: content.length };
    }
    if (uploadSizeFailure !== undefined) {
      return { prepared: false, ...uploadSizeFailure };
    }
    const dimensions = readImageDimensions(content);
    if (dimensions === undefined) {
      return { prepared: false, reason: 'image_invalid' };
    }
    const { width, height } = dimensions;
    if (
      width + height > MAX_PHOTO_DIMENSION_SUM ||
      Math.max(width, height) > MAX_PHOTO_ASPECT_RATIO * Math.min(width, height)
    ) {
      return { prepared: false, reason: 'photo_dimensions_invalid' };
    }
    return { prepared: true, upload: { type: 'photo', content, ...dimensions } };
  }

  /**
   * Prepares an uploaded file to be sent as a document, with the thumbnail uploaded for it, if any.
   * A bot's upload must fit its session's upload profile. As TDLib's
   * `get_input_thumbnail_photo_size` does, a thumbnail that cannot be used is left out rather than
   * failing the document: one that is empty or larger than 200 KB, which TDLib refuses, or whose
   * image the emulator cannot read.
   */
  prepareDocumentUpload(
    { content, fileName, mimeType, thumbnailContent, source }: DocumentUploadRequest,
  ): DocumentUploadPreparation {
    if (content.length === 0) {
      return { prepared: false, reason: 'file_empty' };
    }
    const uploadSizeFailure = this.#checkUploadSize(content, source);
    if (uploadSizeFailure !== undefined) {
      return { prepared: false, ...uploadSizeFailure };
    }
    const thumbnail = thumbnailContent === undefined
      ? undefined
      : readThumbnailUpload(thumbnailContent);
    return {
      prepared: true,
      upload: {
        type: 'document',
        content,
        fileName,
        mimeType: mimeType ?? getDocumentMimeType(fileName),
        ...(thumbnail === undefined ? {} : { thumbnail }),
      },
    };
  }

  /**
   * Prepares a file to be sent as a video, with the thumbnail uploaded for it, if any, as
   * `prepareDocumentUpload` prepares a document. As the Bot API documents the duration and
   * dimensions of a video as its sender defines them, they are kept as specified; the content is
   * neither inspected nor transcoded, so any content is sent as a video. TDLib refuses no video for
   * its size beyond the upload profile's limit.
   */
  prepareVideoUpload(
    { content, fileName, mimeType, attributes, thumbnailContent, source }: VideoUploadRequest,
  ): VideoUploadPreparation {
    if (content.length === 0) {
      return { prepared: false, reason: 'file_empty' };
    }
    const uploadSizeFailure = this.#checkUploadSize(content, source);
    if (uploadSizeFailure !== undefined) {
      return { prepared: false, ...uploadSizeFailure };
    }
    const thumbnail = thumbnailContent === undefined
      ? undefined
      : readThumbnailUpload(thumbnailContent);
    return {
      prepared: true,
      upload: {
        type: 'video',
        content,
        ...(fileName === undefined ? {} : { fileName }),
        mimeType: mimeType ?? getVideoMimeType(fileName),
        durationSeconds: attributes.durationSeconds,
        width: attributes.width,
        height: attributes.height,
        ...(thumbnail === undefined ? {} : { thumbnail }),
      },
    };
  }

  /**
   * Prepares a file to be sent as a voice note, as `prepareVideoUpload` prepares a video: its
   * duration is kept as its sender defines it, and its content is neither inspected nor
   * transcoded. TDLib refuses no voice note for its size beyond the upload profile's limit.
   */
  prepareVoiceUpload(
    { content, fileName, mimeType, durationSeconds, source }: VoiceUploadRequest,
  ): VoiceUploadPreparation {
    if (content.length === 0) {
      return { prepared: false, reason: 'file_empty' };
    }
    const uploadSizeFailure = this.#checkUploadSize(content, source);
    if (uploadSizeFailure !== undefined) {
      return { prepared: false, ...uploadSizeFailure };
    }
    return {
      prepared: true,
      upload: {
        type: 'voice',
        content,
        mimeType: mimeType ?? getVoiceMimeType(fileName),
        durationSeconds,
      },
    };
  }

  /**
   * Prepares a file to be sent as an audio file, with the thumbnail uploaded for it, if any, as
   * `prepareVideoUpload` prepares a video: its duration, performer and title are kept as its sender
   * defines them, without reading tags from the content, which is neither inspected nor
   * transcoded. An empty performer or title is none. TDLib refuses no audio file for its size
   * beyond the upload profile's limit.
   */
  prepareAudioUpload(
    { content, fileName, mimeType, attributes, thumbnailContent, source }: AudioUploadRequest,
  ): AudioUploadPreparation {
    if (content.length === 0) {
      return { prepared: false, reason: 'file_empty' };
    }
    const uploadSizeFailure = this.#checkUploadSize(content, source);
    if (uploadSizeFailure !== undefined) {
      return { prepared: false, ...uploadSizeFailure };
    }
    const thumbnail = thumbnailContent === undefined
      ? undefined
      : readThumbnailUpload(thumbnailContent);
    const { durationSeconds, performer, title } = attributes;
    return {
      prepared: true,
      upload: {
        type: 'audio',
        content,
        ...(fileName === undefined ? {} : { fileName }),
        mimeType: mimeType ?? getAudioMimeType(fileName),
        durationSeconds,
        ...(performer === undefined || performer.length === 0 ? {} : { performer }),
        ...(title === undefined || title.length === 0 ? {} : { title }),
        ...(thumbnail === undefined ? {} : { thumbnail }),
      },
    };
  }

  /**
   * Finds the file a user knows by a `file_id`. As on Telegram, a `file_id` belongs to the user
   * that saw the file, so another user's `file_id` finds nothing.
   */
  findObserverFile(observerId: number, fileId: string): StoredFile | undefined {
    return this.#files.findObserverFile(observerId, fileId);
  }

  /**
   * Prepares a file the bot knows by its `file_id` for download, as `getFile` does, and returns
   * its `file_path`. A file keeps its path once it has one; as on Telegram, files larger than
   * 20 MB cannot be downloaded by bots.
   */
  getBotFile(botId: number, fileId: string): GetBotFileResult {
    const file = this.#files.findObserverFile(botId, fileId);
    if (file === undefined) {
      return { found: false, reason: 'file_id_invalid' };
    }
    if (file.content.length > MAX_BOT_DOWNLOAD_FILE_BYTES) {
      return { found: false, reason: 'file_too_big' };
    }

    let filePath = this.#files.getBotFilePath(botId, file.id);
    if (filePath === undefined) {
      filePath = this.#createBotFilePath(botId, file);
      this.#files.addBotFilePath(botId, file.id, filePath);
    }
    return { found: true, downloadableFile: { file, fileId, filePath } };
  }

  /** Finds the file a bot downloads from a `file_path` that `getFile` gave it. */
  findBotFileByPath(botId: number, filePath: string): StoredFile | undefined {
    return this.#files.findBotFileByPath(botId, filePath);
  }

  /** Finds a file by its `file_unique_id`, which is the same for every user. */
  findFileByUniqueId(uniqueId: string): StoredFile | undefined {
    return this.#files.getFileByUniqueId(uniqueId);
  }

  /**
   * Downloads a file from a URL read as TDLib's `parse_url` reads it, failing for content that
   * cannot be downloaded within `maxContentBytes`, and for empty content or content served as a
   * media type that `acceptsMediaType` refuses.
   */
  async #downloadWebContent(
    url: string,
    maxContentBytes: number,
    acceptsMediaType: (mediaType: string) => boolean,
    signal: AbortSignal | undefined,
  ): Promise<WebFileDownloadResult> {
    const parsing = parseHttpUrl(url);
    if (!parsing.parsed) {
      return { downloaded: false, reason: 'file_url_invalid', urlError: parsing.error };
    }
    const download = await this.#webFiles.download(
      formatHttpUrl(parsing.url),
      maxContentBytes,
      signal,
    );
    if (!download.downloaded) {
      return { downloaded: false, reason: 'web_content_unavailable' };
    }
    const { content, mediaType } = download;
    if (content.length === 0 || mediaType === undefined || !acceptsMediaType(mediaType)) {
      return { downloaded: false, reason: 'web_content_type_invalid' };
    }
    return {
      downloaded: true,
      webFile: { content, mediaType, fileName: getHttpUrlFileName(parsing.url) },
    };
  }

  /**
   * Checks the size of new file content against the limit of its source. A bot's upload must fit
   * its session's upload profile. An account's upload meets no such limit: a user's own client
   * uploads files of up to 2000 MB, or 4000 MB with Telegram Premium, which base64 fixtures in
   * JSON requests are not meant to reach. A downloaded file met its limit as it was read.
   */
  #checkUploadSize(
    content: Uint8Array<ArrayBuffer>,
    source: UploadSource,
  ): BotUploadTooBigFailure | undefined {
    return source === 'bot_upload'
      ? checkBotUploadSize(this.#uploadProfile, content.length)
      : undefined;
  }

  /**
   * Names a file as the Bot API server names the files it downloads for a bot: numbered in the
   * bot's directory for the file's type, with the extension of the file's format or name.
   */
  #createBotFilePath(botId: number, file: StoredFile): string {
    const extension = getBotFileExtension(file);
    const fileName = `file_${this.#files.countBotFilePaths(botId)}`;
    return `${BOT_FILE_DIRECTORIES[file.type]}/${
      extension === undefined ? fileName : `${fileName}.${extension}`
    }`;
  }
}

/**
 * The extension of the file a bot downloads: that of an image's format, of the name a document or
 * video was sent under, of a voice note's type, or the one `getAudioFileExtension` gives an audio
 * file; `undefined` for a file without one.
 */
function getBotFileExtension(file: StoredFile): string | undefined {
  switch (file.type) {
    case 'photo':
    case 'thumbnail':
      return PHOTO_FILE_EXTENSIONS[file.imageFormat];
    case 'document':
      return getFileNameExtension(file.fileName);
    case 'video':
      return file.fileName === undefined ? undefined : getFileNameExtension(file.fileName);
    case 'voice':
      return getVoiceFileExtension(file.mimeType);
    case 'audio':
      return getAudioFileExtension(file.fileName);
    default: {
      const unhandledFile: never = file;
      throw new Error(`Unhandled stored file: ${JSON.stringify(unhandledFile)}`);
    }
  }
}

/** Reads a usable thumbnail, or returns `undefined` for one Telegram would leave out. */
function readThumbnailUpload(content: Uint8Array<ArrayBuffer>): ThumbnailUpload | undefined {
  if (content.length === 0 || content.length > MAX_THUMBNAIL_UPLOAD_BYTES) {
    return undefined;
  }
  const dimensions = readImageDimensions(content);
  return dimensions === undefined ? undefined : { type: 'thumbnail', content, ...dimensions };
}
