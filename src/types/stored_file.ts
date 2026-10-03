/**
 * Emulator-internal identity of a stored file.
 *
 * It is never a Bot API `file_id`: as on Telegram, each user identifies a file by a `file_id` of
 * its own, so Bot API projections resolve `file_id` for their observer instead.
 */
export type StoredFileId = string;

/** Telegram lets bots download files of at most this size with `getFile`. */
export const MAX_BOT_DOWNLOAD_FILE_BYTES = 20 * 1024 * 1024;

/** TDLib refuses to upload a larger file as a photo, for bots and user accounts alike. */
export const MAX_PHOTO_UPLOAD_BYTES = 10 * 1024 * 1024;

/** What a bot sends a file by URL as, which decides how large it may be and of which types. */
export type WebFileKind = 'photo' | 'document' | 'video' | 'voice';

/**
 * Telegram downloads a file that a bot sends by URL only up to these sizes: 5 MB for a photo and
 * 20 MB for any other file, whatever the session's upload profile, since Telegram's own servers
 * download it. As for uploads, the documented figures are read in binary megabytes.
 */
export const MAX_WEB_FILE_BYTES: Readonly<Record<WebFileKind, number>> = {
  photo: 5 * 1024 * 1024,
  document: 20 * 1024 * 1024,
  video: 20 * 1024 * 1024,
  voice: 20 * 1024 * 1024,
};

/**
 * What an inline query result names a file by URL as, which Telegram downloads when an account
 * sends the result. Inline results have contracts of their own rather than those of the send
 * methods.
 */
export type InlineResultWebFileKind = 'photo' | 'document' | 'video' | 'voice';

/**
 * The largest file Telegram downloads for an inline query result: 5 MB for a photo, as the Bot API
 * documents for `InlineQueryResultPhoto`, and, as it documents no other size, the 20 MB it
 * downloads for any other file sent by URL.
 */
export const MAX_INLINE_RESULT_WEB_FILE_BYTES: Readonly<Record<InlineResultWebFileKind, number>> = {
  photo: 5 * 1024 * 1024,
  document: 20 * 1024 * 1024,
  video: 20 * 1024 * 1024,
  voice: 20 * 1024 * 1024,
};

/**
 * The largest file, in bytes, that Telegram sends as a voice note when a bot sends it by URL: the
 * Bot API documents 1 MB, read in binary megabytes as the other limits are, and sends a larger
 * one, up to the 20 MB it downloads, as a file.
 */
const MAX_WEB_VOICE_NOTE_BYTES = 1024 * 1024;

/**
 * Whether Telegram sends a voice note that a bot sends by URL as a voice note, rather than as a
 * file, as the Bot API documents it for `sendVoice`.
 */
export function isWebVoiceNoteSentAsVoiceNote(contentSizeBytes: number): boolean {
  return contentSizeBytes <= MAX_WEB_VOICE_NOTE_BYTES;
}

/**
 * A file that Telegram downloaded from the URL a bot sent it by, before it is stored as a photo,
 * document, video, or voice note.
 */
export interface WebFile {
  readonly content: Uint8Array<ArrayBuffer>;
  /** The lowercase media type of the response's `Content-Type`, without its parameters. */
  readonly mediaType: string;
  /** The last segment of the URL's path, which may be empty. */
  readonly fileName: string;
}

/** Image formats whose dimensions the emulator reads, which it accepts as photos. */
export type PhotoImageFormat = 'jpeg' | 'png' | 'gif' | 'webp' | 'bmp';

/** A photo's image as it was sent, before it is stored. */
export interface PhotoUpload {
  readonly type: 'photo';
  readonly content: Uint8Array<ArrayBuffer>;
  readonly imageFormat: PhotoImageFormat;
  readonly width: number;
  readonly height: number;
}

/** TDLib ignores a larger thumbnail that a sender uploads with a file. */
export const MAX_THUMBNAIL_UPLOAD_BYTES = 200 * 1024 - 1;

/**
 * A preview image that a sender uploaded with a document or video, as it was sent. Telegram asks
 * for a JPEG of at most 320 pixels a side; the emulator keeps any image whose dimensions it reads
 * unchanged.
 */
export interface ThumbnailUpload {
  readonly type: 'thumbnail';
  readonly content: Uint8Array<ArrayBuffer>;
  readonly imageFormat: PhotoImageFormat;
  readonly width: number;
  readonly height: number;
}

/** A file sent as a document, before it is stored. */
export interface DocumentUpload {
  readonly type: 'document';
  readonly content: Uint8Array<ArrayBuffer>;
  /** The file name as Telegram shows it, which is never empty. */
  readonly fileName: string;
  /**
   * The document's MIME type: for an upload, the one Telegram derives from the file name's
   * extension; for a file sent by URL, the media type it was served as, whatever its name.
   */
  readonly mimeType: string;
  /** Omitted for a document sent without a usable thumbnail. */
  readonly thumbnail?: ThumbnailUpload;
}

/**
 * The longest duration, in seconds, that the official Bot API server passes on for media, and the
 * latest second it starts a video from; it clamps larger values a bot specifies to it.
 */
export const MAX_MEDIA_DURATION_SECONDS = 24 * 60 * 60;

/**
 * The longest width or height, in pixels, that the official Bot API server passes on for a video;
 * it clamps larger values a bot specifies to it.
 */
export const MAX_VIDEO_SIDE_LENGTH = 10_000;

/**
 * The attributes of a video as its sender defines them, which Telegram shows as the sender
 * defined them; zero for an attribute the sender left unspecified.
 */
export interface VideoAttributes {
  readonly durationSeconds: number;
  readonly width: number;
  readonly height: number;
}

/** A file sent as a video, before it is stored. Its content is not inspected. */
export interface VideoUpload extends VideoAttributes {
  readonly type: 'video';
  readonly content: Uint8Array<ArrayBuffer>;
  /** The file name as Telegram shows it; omitted for a video sent without one. */
  readonly fileName?: string;
  /** The video's MIME type, which is always a `video/` type. */
  readonly mimeType: string;
  /** Omitted for a video sent without a usable thumbnail. */
  readonly thumbnail?: ThumbnailUpload;
}

/**
 * A file sent as a voice note, before it is stored. Its content is not inspected, and, as the Bot
 * API's `Voice` shows, it keeps no file name.
 */
export interface VoiceUpload {
  readonly type: 'voice';
  readonly content: Uint8Array<ArrayBuffer>;
  /** The voice note's MIME type: `audio/ogg`, `audio/mpeg`, or `audio/mp4`. */
  readonly mimeType: string;
  /** As the sender defined it; zero when it specified none. */
  readonly durationSeconds: number;
}

/**
 * A file a user sends as a message's media; a thumbnail is uploaded only with its document or
 * video.
 */
export type FileUpload = PhotoUpload | DocumentUpload | VideoUpload | VoiceUpload;

interface StoredFileIdentity {
  readonly id: StoredFileId;
  /**
   * Telegram's `file_unique_id`, which, unlike `file_id`, is the same for every user and cannot be
   * used to send or download the file.
   */
  readonly uniqueId: string;
}

/**
 * A stored photo. Telegram converts a photo to JPEG and keeps it in several sizes; the emulator
 * keeps the one size and the format it was sent in.
 */
export type StoredPhotoFile = StoredFileIdentity & PhotoUpload;

/** A stored thumbnail, which users know by a `file_id` of its own, as any file. */
export type StoredThumbnailFile = StoredFileIdentity & ThumbnailUpload;

export type StoredDocumentFile =
  & StoredFileIdentity
  & Omit<DocumentUpload, 'thumbnail'>
  & {
    /** Omitted for a document without a thumbnail. */
    readonly thumbnail?: StoredThumbnailFile;
  };

export type StoredVideoFile =
  & StoredFileIdentity
  & Omit<VideoUpload, 'thumbnail'>
  & {
    /** Omitted for a video without a thumbnail. */
    readonly thumbnail?: StoredThumbnailFile;
  };

export type StoredVoiceFile = StoredFileIdentity & VoiceUpload;

export type StoredFile =
  | StoredPhotoFile
  | StoredDocumentFile
  | StoredVideoFile
  | StoredVoiceFile
  | StoredThumbnailFile;

/** The thumbnail a stored file carries; `undefined` for a file without one. */
export function getStoredFileThumbnail(file: StoredFile): StoredThumbnailFile | undefined {
  switch (file.type) {
    case 'document':
    case 'video':
      return file.thumbnail;
    case 'photo':
    case 'voice':
    case 'thumbnail':
      return undefined;
    default: {
      const unhandledFile: never = file;
      throw new Error(`Unhandled stored file: ${JSON.stringify(unhandledFile)}`);
    }
  }
}
