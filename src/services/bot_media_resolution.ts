import { cleanUploadedFileName } from '../media/document_file.ts';
import {
  convertRichMessageFiles,
  listRichMessageFiles,
  type RichMessage,
} from '../types/rich_message.ts';
import {
  type AudioAttributes,
  type FileUpload,
  isWebVoiceNoteSentAsVoiceNote,
  type StoredFile,
  type VideoAttributes,
  type WebFile,
} from '../types/stored_file.ts';
import type {
  BotApiInputFile,
  BotApiRichMessageDocument,
  BotApiRichMessageFileTypes,
  BotApiRichMessageVideo,
  BotApiRichMessageVoiceNote,
  FileIdFailure,
  FileResolution,
  FileResolutionFailure,
  InlineResultFileRequest,
  InlineResultFileResolution,
  MediaReplacementRequest,
  RichMessageFilesResolution,
  SpecifiedVoice,
} from './bot_api.ts';
import type {
  AudioUploadPreparation,
  AudioUploadRequest,
  DocumentUploadPreparation,
  DocumentUploadRequest,
  PhotoUploadPreparation,
  PhotoUploadRequest,
  VideoUploadPreparation,
  VideoUploadRequest,
  VoiceUploadPreparation,
  VoiceUploadRequest,
} from './media_file.ts';
import type {
  MediaContent,
  OutgoingAudio,
  OutgoingCaptionedMedia,
  OutgoingDocument,
  OutgoingFile,
  OutgoingPhoto,
  OutgoingVideo,
  OutgoingVoice,
} from './message_content.ts';

interface MediaFiles {
  preparePhotoUpload(request: PhotoUploadRequest): PhotoUploadPreparation;
  prepareDocumentUpload(request: DocumentUploadRequest): DocumentUploadPreparation;
  prepareWebPhotoUpload(webFile: WebFile): PhotoUploadPreparation;
  prepareWebDocumentUpload(webFile: WebFile): DocumentUploadPreparation;
  prepareVideoUpload(request: VideoUploadRequest): VideoUploadPreparation;
  prepareWebVideoUpload(webFile: WebFile, attributes: VideoAttributes): VideoUploadPreparation;
  prepareVoiceUpload(request: VoiceUploadRequest): VoiceUploadPreparation;
  prepareWebVoiceUpload(webFile: WebFile, durationSeconds: number): VoiceUploadPreparation;
  prepareAudioUpload(request: AudioUploadRequest): AudioUploadPreparation;
  prepareWebAudioUpload(webFile: WebFile, attributes: AudioAttributes): AudioUploadPreparation;
  findObserverFile(observerId: number, fileId: string): StoredFile | undefined;
}

interface BotMediaResolverDependencies {
  /**
   * Checks uploads and files downloaded from URLs as Telegram does, and finds the files bots know
   * by `file_id`.
   */
  readonly mediaFiles: MediaFiles;
}

type UploadPreparationFailure = Extract<
  | PhotoUploadPreparation
  | DocumentUploadPreparation
  | VideoUploadPreparation
  | VoiceUploadPreparation
  | AudioUploadPreparation,
  { readonly prepared: false }
>;

/** An upload of one type, prepared to be sent, or why Telegram refuses it. */
type UploadPreparation<Upload extends FileUpload> =
  | { readonly prepared: true; readonly upload: Upload }
  | UploadPreparationFailure;

/** A file uploaded with a request, under the name its sender gave it. */
type RequestUpload = Extract<BotApiInputFile, { readonly kind: 'upload' }>;

type StoredFileOfType<Type extends StoredFile['type']> = Extract<
  StoredFile,
  { readonly type: Type }
>;

/**
 * How a request's file is resolved as a file of one type: the type a `file_id` must identify, and
 * how an upload and a file downloaded from a URL are prepared as that type.
 */
interface FileTypeResolution<Type extends StoredFile['type'], Upload extends FileUpload> {
  readonly fileType: Type;
  prepareUpload(upload: RequestUpload): UploadPreparation<Upload>;
  prepareWebFile(webFile: WebFile): UploadPreparation<Upload>;
}

/**
 * Turns the files that Bot API requests send into the files of the messages they send, as TDLib
 * reads a request's input files: a file the bot knows by `file_id`, which must be of the type the
 * request sends; an upload, which the Bot API server names and TDLib checks as Telegram does; or a
 * file Telegram downloaded from a URL.
 *
 * Nothing is stored: a message stores its uploads when it is sent, so a request that fails after
 * some of its files are resolved leaves no trace of them.
 */
export class BotMediaResolver {
  readonly #mediaFiles: MediaFiles;

  constructor({ mediaFiles }: BotMediaResolverDependencies) {
    this.#mediaFiles = mediaFiles;
  }

  /**
   * Resolves new media with its caption, as `sendPhoto`, `sendDocument`, `sendVideo` and
   * `sendAudio` send it, an album holds it, and `editMessageMedia` replaces a message's media with
   * it: its file, as `#resolvePhoto`, `#resolveDocument`, `#resolveVideo` and `#resolveAudio`
   * resolve a photo, a document, a video, and an audio file.
   */
  resolveMediaContent(botId: number, media: MediaReplacementRequest): FileResolution<MediaContent> {
    const caption = { caption: media.caption.text, captionEntities: media.caption.entities };
    switch (media.kind) {
      case 'photo': {
        const resolution = this.#resolvePhoto(botId, media.photo);
        return resolution.resolved
          ? {
            resolved: true,
            file: {
              kind: 'photo',
              photo: resolution.file,
              ...caption,
              hasSpoiler: media.hasSpoiler,
              showsCaptionAboveMedia: media.showsCaptionAboveMedia,
            },
          }
          : resolution;
      }
      case 'document': {
        const resolution = this.#resolveDocument(botId, media.document, media.thumbnail);
        return resolution.resolved
          ? { resolved: true, file: { kind: 'document', document: resolution.file, ...caption } }
          : resolution;
      }
      case 'video': {
        const { video, attributes, thumbnail } = media;
        const resolution = this.#resolveVideo(botId, video, attributes, thumbnail);
        return resolution.resolved
          ? {
            resolved: true,
            file: {
              kind: 'video',
              video: resolution.file,
              ...caption,
              hasSpoiler: media.hasSpoiler,
              showsCaptionAboveMedia: media.showsCaptionAboveMedia,
              startTimestampSeconds: media.startTimestampSeconds,
            },
          }
          : resolution;
      }
      case 'audio': {
        const { audio, attributes, thumbnail } = media;
        const resolution = this.#resolveAudio(botId, audio, attributes, thumbnail);
        return resolution.resolved
          ? { resolved: true, file: { kind: 'audio', audio: resolution.file, ...caption } }
          : resolution;
      }
      default: {
        const unhandledMedia: never = media;
        throw new Error(`Unhandled media replacement: ${JSON.stringify(unhandledMedia)}`);
      }
    }
  }

  /**
   * Resolves the media that `sendVoice` sends: a voice note, as `#resolveVoice` resolves it, or, as
   * the Bot API documents for a voice note sent by URL that is larger than 1 MB, a document, which
   * `#resolveDocument` resolves from the downloaded file.
   */
  resolveVoiceMedia(
    botId: number,
    { voice, durationSeconds, caption }: SpecifiedVoice,
  ): FileResolution<Extract<OutgoingCaptionedMedia, { readonly kind: 'voice' | 'document' }>> {
    const specifiedCaption = { caption: caption.text, captionEntities: caption.entities };
    if (voice.kind === 'web_file' && !isWebVoiceNoteSentAsVoiceNote(voice.webFile.content.length)) {
      const resolution = this.#resolveDocument(botId, voice, undefined);
      return resolution.resolved
        ? {
          resolved: true,
          file: { kind: 'document', document: resolution.file, ...specifiedCaption },
        }
        : resolution;
    }
    const resolution = this.#resolveVoice(botId, voice, durationSeconds);
    return resolution.resolved
      ? { resolved: true, file: { kind: 'voice', voice: resolution.file, ...specifiedCaption } }
      : resolution;
  }

  /**
   * Resolves the files of a rich message's media blocks, in the order the message shows them, as
   * `#resolvePhoto`, `#resolveDocument`, `#resolveVideo` and `#resolveVoice` resolve the file of a
   * photo, document, video or voice note. Nothing is stored, so a file that fails leaves no trace
   * of those resolved before it. A voice note sent by URL stays a voice note whatever its size, as
   * nothing documents the conversion `sendVoice` makes for a block, which has no document to
   * become.
   */
  resolveRichMessageFiles(
    botId: number,
    richMessage: RichMessage<BotApiRichMessageFileTypes>,
  ): RichMessageFilesResolution {
    const photos = new Map<BotApiInputFile, OutgoingPhoto>();
    const documents = new Map<BotApiRichMessageDocument, OutgoingDocument>();
    const videos = new Map<BotApiRichMessageVideo, OutgoingVideo>();
    const voiceNotes = new Map<BotApiRichMessageVoiceNote, OutgoingVoice>();
    for (const file of listRichMessageFiles(richMessage)) {
      switch (file.kind) {
        case 'photo': {
          const resolution = this.#resolvePhoto(botId, file.file);
          if (!resolution.resolved) {
            return resolution;
          }
          photos.set(file.file, resolution.file);
          break;
        }
        case 'document': {
          const { document, thumbnail } = file.file;
          const resolution = this.#resolveDocument(botId, document, thumbnail);
          if (!resolution.resolved) {
            return resolution;
          }
          documents.set(file.file, resolution.file);
          break;
        }
        case 'video': {
          const { video, attributes, thumbnail } = file.file;
          const resolution = this.#resolveVideo(botId, video, attributes, thumbnail);
          if (!resolution.resolved) {
            return resolution;
          }
          videos.set(file.file, resolution.file);
          break;
        }
        case 'voice': {
          const { voice, durationSeconds } = file.file;
          const resolution = this.#resolveVoice(botId, voice, durationSeconds);
          if (!resolution.resolved) {
            return resolution;
          }
          voiceNotes.set(file.file, resolution.file);
          break;
        }
        default: {
          const unhandledFile: never = file;
          throw new Error(`Unhandled rich message file: ${JSON.stringify(unhandledFile)}`);
        }
      }
    }
    return {
      resolved: true,
      richMessage: convertRichMessageFiles(richMessage, {
        photo: (photo) => getResolvedFile(photos, photo),
        document: (document) => getResolvedFile(documents, document),
        video: (video) => getResolvedFile(videos, video),
        voice: (voiceNote) => getResolvedFile(voiceNotes, voiceNote),
      }),
    };
  }

  /**
   * Resolves the file of an inline query result: one the bot knows by `file_id`, which must be a
   * file of the result's type, as `#findFileOfType` finds it, or one it names by URL, which keeps
   * its URL for Telegram to download when the result is sent.
   */
  resolveInlineResultFile<Type extends StoredFile['type']>(
    botId: number,
    file: InlineResultFileRequest,
    expectedFileType: Type,
  ): InlineResultFileResolution<StoredFileOfType<Type>> {
    if (file.kind === 'url') {
      return { resolved: true, file: { source: 'web', url: file.url } };
    }
    const lookup = this.#findFileOfType(botId, file.fileId, expectedFileType);
    return lookup.found
      ? { resolved: true, file: { source: 'stored', file: lookup.file } }
      : { resolved: false, failure: lookup.failure };
  }

  /**
   * Resolves the photo a request sends: an upload, a photo the bot knows by `file_id`, or an image
   * downloaded from a URL, which is checked as an upload is.
   */
  #resolvePhoto(botId: number, input: BotApiInputFile): FileResolution<OutgoingPhoto> {
    return this.#resolveFile(botId, input, {
      fileType: 'photo',
      prepareUpload: ({ content }) =>
        this.#mediaFiles.preparePhotoUpload({ content, source: 'bot_upload' }),
      prepareWebFile: (webFile) => this.#mediaFiles.prepareWebPhotoUpload(webFile),
    });
  }

  /**
   * Resolves the document a request sends: an upload, whose name the Bot API server cleans, with
   * the thumbnail uploaded for it; a document the bot knows by `file_id`, which keeps its own
   * thumbnail; or a file downloaded from a URL, named after the URL and typed as it was served.
   * TDLib sends a URL document as `inputMediaDocumentExternal`, which takes no thumbnail, so an
   * uploaded thumbnail is left out.
   */
  #resolveDocument(
    botId: number,
    input: BotApiInputFile,
    thumbnailContent: Uint8Array<ArrayBuffer> | undefined,
  ): FileResolution<OutgoingDocument> {
    return this.#resolveFile(botId, input, {
      fileType: 'document',
      prepareUpload: ({ content, fileName }) =>
        this.#mediaFiles.prepareDocumentUpload({
          content,
          fileName: cleanUploadedFileName(fileName),
          ...(thumbnailContent === undefined ? {} : { thumbnailContent }),
          source: 'bot_upload',
        }),
      prepareWebFile: (webFile) => this.#mediaFiles.prepareWebDocumentUpload(webFile),
    });
  }

  /**
   * Resolves the video a request sends, as `#resolveDocument` resolves a document: an upload, whose
   * name the Bot API server cleans, with the duration, dimensions and thumbnail the bot specified;
   * a video the bot knows by `file_id`, which keeps its own; or a file downloaded from a URL, named
   * after the URL's last path segment, if it has one, and typed as it was served. As for a
   * document, TDLib sends a URL video as `inputMediaDocumentExternal`, which takes no thumbnail, so
   * an uploaded thumbnail is left out. That media carries none of the bot's attributes either,
   * which Telegram's servers determine themselves; the emulator, which reads no video content,
   * keeps the ones the bot specified.
   */
  #resolveVideo(
    botId: number,
    input: BotApiInputFile,
    attributes: VideoAttributes,
    thumbnailContent: Uint8Array<ArrayBuffer> | undefined,
  ): FileResolution<OutgoingVideo> {
    return this.#resolveFile(botId, input, {
      fileType: 'video',
      prepareUpload: ({ content, fileName }) =>
        this.#mediaFiles.prepareVideoUpload({
          content,
          fileName: cleanUploadedFileName(fileName),
          attributes,
          ...(thumbnailContent === undefined ? {} : { thumbnailContent }),
          source: 'bot_upload',
        }),
      prepareWebFile: (webFile) => this.#mediaFiles.prepareWebVideoUpload(webFile, attributes),
    });
  }

  /**
   * Resolves the voice note a request sends, as `#resolveVideo` resolves a video: an upload, whose
   * MIME type its file name decides, with the duration the bot specified; a voice note the bot
   * knows by `file_id`, which keeps its own; or a file downloaded from a URL, typed as it was
   * served. As for a video, how Telegram's servers determine the duration of a downloaded voice
   * note is not in the source, so the emulator keeps the one the bot specified.
   */
  #resolveVoice(
    botId: number,
    input: BotApiInputFile,
    durationSeconds: number,
  ): FileResolution<OutgoingVoice> {
    return this.#resolveFile(botId, input, {
      fileType: 'voice',
      prepareUpload: ({ content, fileName }) =>
        this.#mediaFiles.prepareVoiceUpload({
          content,
          fileName: cleanUploadedFileName(fileName),
          durationSeconds,
          source: 'bot_upload',
        }),
      prepareWebFile: (webFile) => this.#mediaFiles.prepareWebVoiceUpload(webFile, durationSeconds),
    });
  }

  /**
   * Resolves the audio file a request sends, as `#resolveVideo` resolves a video: an upload, whose
   * name the Bot API server cleans and whose MIME type its name decides, with the duration,
   * performer, title and thumbnail the bot specified; an audio file the bot knows by `file_id`,
   * which keeps its own, since TDLib sends it as `inputMediaDocument` without them; or a file
   * downloaded from a URL, named after the URL's last path segment, if it has one, and typed as it
   * was served. TDLib sends a URL audio file as `inputMediaDocumentExternal`, which carries neither
   * a thumbnail nor the bot's attributes; how Telegram's servers determine the attributes of a
   * downloaded audio file is not in the source, so the emulator keeps the ones the bot specified.
   */
  #resolveAudio(
    botId: number,
    input: BotApiInputFile,
    attributes: AudioAttributes,
    thumbnailContent: Uint8Array<ArrayBuffer> | undefined,
  ): FileResolution<OutgoingAudio> {
    return this.#resolveFile(botId, input, {
      fileType: 'audio',
      prepareUpload: ({ content, fileName }) =>
        this.#mediaFiles.prepareAudioUpload({
          content,
          fileName: cleanUploadedFileName(fileName),
          attributes,
          ...(thumbnailContent === undefined ? {} : { thumbnailContent }),
          source: 'bot_upload',
        }),
      prepareWebFile: (webFile) => this.#mediaFiles.prepareWebAudioUpload(webFile, attributes),
    });
  }

  /**
   * Resolves a file a request sends as a file of one type, as every type of media is resolved: a
   * `file_id` must identify a file of that type, as `#findFileOfType` finds it, and an upload or a
   * file downloaded from a URL is prepared as `fileTypeResolution` prepares it, which fails as
   * Telegram refuses it.
   */
  #resolveFile<Type extends StoredFile['type'], Upload extends FileUpload>(
    botId: number,
    input: BotApiInputFile,
    fileTypeResolution: FileTypeResolution<Type, Upload>,
  ): FileResolution<OutgoingFile<StoredFileOfType<Type>, Upload>> {
    if (input.kind === 'file_id') {
      const lookup = this.#findFileOfType(botId, input.fileId, fileTypeResolution.fileType);
      return lookup.found
        ? { resolved: true, file: { kind: 'stored', file: lookup.file } }
        : { resolved: false, failure: lookup.failure };
    }
    const preparation = input.kind === 'upload'
      ? fileTypeResolution.prepareUpload(input)
      : fileTypeResolution.prepareWebFile(input.webFile);
    return preparation.prepared
      ? { resolved: true, file: { kind: 'upload', upload: preparation.upload } }
      : { resolved: false, failure: uploadPreparationFailure(preparation) };
  }

  /**
   * Finds the file the bot knows by a `file_id`, which must be a file of the expected type. As on
   * Telegram, an unknown `file_id`, including one another bot knows a file by, identifies no file.
   */
  #findFileOfType<Type extends StoredFile['type']>(
    botId: number,
    fileId: string,
    expectedFileType: Type,
  ):
    | { readonly found: true; readonly file: StoredFileOfType<Type> }
    | { readonly found: false; readonly failure: FileIdFailure } {
    const file = this.#mediaFiles.findObserverFile(botId, fileId);
    if (isStoredFileOfType(file, expectedFileType)) {
      return { found: true, file };
    }
    return {
      found: false,
      failure: file === undefined
        ? { reason: 'file_id_invalid' }
        : { reason: 'file_type_mismatch', expectedFileType, actualFileType: file.type },
    };
  }
}

/** Why Telegram refuses an uploaded file, as its preparation reports it. */
function uploadPreparationFailure(preparation: UploadPreparationFailure): FileResolutionFailure {
  switch (preparation.reason) {
    case 'photo_too_big':
      return { reason: preparation.reason, fileSizeBytes: preparation.fileSizeBytes };
    case 'bot_upload_too_big': {
      const { reason, uploadProfile, fileSizeBytes, maxFileSizeBytes } = preparation;
      return { reason, uploadProfile, fileSizeBytes, maxFileSizeBytes };
    }
    default:
      return { reason: preparation.reason };
  }
}

function isStoredFileOfType<Type extends StoredFile['type']>(
  file: StoredFile | undefined,
  type: Type,
): file is StoredFileOfType<Type> {
  return file?.type === type;
}

/** Looks up what a file of a request resolved to, which must have been resolved before. */
function getResolvedFile<RequestedFile, ResolvedFile>(
  resolvedFiles: ReadonlyMap<RequestedFile, ResolvedFile>,
  requestedFile: RequestedFile,
): ResolvedFile {
  const resolvedFile = resolvedFiles.get(requestedFile);
  if (resolvedFile === undefined) {
    throw new Error('Expected every file of the rich message to be resolved');
  }
  return resolvedFile;
}
