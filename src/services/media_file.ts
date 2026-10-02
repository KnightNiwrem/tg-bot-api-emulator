import { getDocumentMimeType, getFileNameExtension } from '../media/document_file.ts';
import { readImageDimensions } from '../media/image_dimensions.ts';
import { getHttpUrlFileName, parseHttpUrl } from '../types/http_url.ts';
import {
  type DocumentUpload,
  MAX_BOT_DOWNLOAD_FILE_BYTES,
  MAX_PHOTO_UPLOAD_BYTES,
  MAX_THUMBNAIL_UPLOAD_BYTES,
  MAX_WEB_FILE_BYTES,
  type PhotoImageFormat,
  type PhotoUpload,
  type StoredFile,
  type StoredFileId,
  type ThumbnailUpload,
  type WebFile,
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

/** Downloads the file at a URL, as `WebFileDownloader` does. */
interface WebFileSource {
  download(url: string, maxContentBytes: number, signal?: AbortSignal): Promise<WebFileDownload>;
}

export interface WebFileDownloadRequest {
  /** The URL as the bot sent it. */
  readonly url: string;
  /** What the bot sends the file as, which decides how large it may be and of which types. */
  readonly fileKind: 'photo' | 'document';
  /** Aborts the download when the bot stops waiting for the answer. */
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
 * Checks files that users send as photos or documents, resolves the `file_id` by which a user
 * reuses a file it has seen, and lets bots download files, as Telegram does.
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
   * image; a document at most 20 MB and, as Telegram documents, only a PDF or ZIP file. Content
   * that cannot be downloaded, including larger content, fails as Telegram's `WEBPAGE_CURL_FAILED`,
   * and empty content or content of another type as its `WEBPAGE_MEDIA_EMPTY`.
   */
  async downloadWebFile(
    { url, fileKind, signal }: WebFileDownloadRequest,
  ): Promise<WebFileDownloadResult> {
    const parsing = parseHttpUrl(url);
    if (!parsing.parsed) {
      return { downloaded: false, reason: 'file_url_invalid', urlError: parsing.error };
    }
    const download = await this.#webFiles.download(
      parsing.url,
      MAX_WEB_FILE_BYTES[fileKind],
      signal,
    );
    if (!download.downloaded) {
      return { downloaded: false, reason: 'web_content_unavailable' };
    }
    const { content, mediaType } = download;
    const hasAcceptedType = mediaType !== undefined &&
      (fileKind === 'photo'
        ? mediaType.startsWith('image/')
        : WEB_DOCUMENT_MEDIA_TYPES.has(mediaType));
    if (content.length === 0 || !hasAcceptedType) {
      return { downloaded: false, reason: 'web_content_type_invalid' };
    }
    return {
      downloaded: true,
      webFile: { content, mediaType, fileName: getHttpUrlFileName(parsing.query) },
    };
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
    const extension = file.type === 'document'
      ? getFileNameExtension(file.fileName)
      : PHOTO_FILE_EXTENSIONS[file.imageFormat];
    const fileName = `file_${this.#files.countBotFilePaths(botId)}`;
    return `${BOT_FILE_DIRECTORIES[file.type]}/${
      extension === undefined ? fileName : `${fileName}.${extension}`
    }`;
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
