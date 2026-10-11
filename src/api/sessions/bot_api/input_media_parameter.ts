import { z } from 'zod';

import type { EmulationSession } from '../../../session/emulation_session.ts';
import { MAX_MEDIA_DURATION_SECONDS, MAX_VIDEO_SIDE_LENGTH } from '../../../types/stored_file.ts';
import { BOT_API_ERRORS } from './errors/error_catalogue.ts';
import type { FormattedTextError } from './formatted_text_reading.ts';
import type { UnreadFormattedText } from './inline_query_answer_parameters.ts';
import {
  type BotApiInputFile,
  readInputFileParameter,
  readThumbnailParameter,
  type RequestedInputFile,
} from './input_file_parameter.ts';
import {
  type BotApiUploadedFiles,
  type JsonObjectFieldError,
  parseBotApiJsonParameter,
} from './request_parameters.ts';

type MediaReplacementRequest = Parameters<
  EmulationSession['botMediaResolver']['resolveMediaContent']
>[1];

type PhotoReplacementRequest = Extract<MediaReplacementRequest, { readonly kind: 'photo' }>;
type DocumentReplacementRequest = Extract<MediaReplacementRequest, { readonly kind: 'document' }>;
type VideoReplacementRequest = Extract<MediaReplacementRequest, { readonly kind: 'video' }>;
type AudioReplacementRequest = Extract<MediaReplacementRequest, { readonly kind: 'audio' }>;

/** New media as a request specifies it, with its file as named and its caption not yet read. */
export type UnreadMediaReplacement =
  & (
    | (Omit<PhotoReplacementRequest, 'caption' | 'photo'> & {
      readonly photo: RequestedInputFile;
    })
    | (Omit<DocumentReplacementRequest, 'caption' | 'document'> & {
      readonly document: RequestedInputFile;
    })
    | (Omit<VideoReplacementRequest, 'caption' | 'video'> & {
      readonly video: RequestedInputFile;
    })
    | (Omit<AudioReplacementRequest, 'caption' | 'audio'> & {
      readonly audio: RequestedInputFile;
    })
  )
  & { readonly caption: UnreadFormattedText };

export type InputMediaParameterReading =
  | { readonly read: true; readonly media: UnreadMediaReplacement }
  | { readonly read: false; readonly description: string };

export type InputMediaGroupParameterReading =
  | { readonly read: true; readonly media: readonly UnreadMediaReplacement[] }
  | { readonly read: false; readonly description: string };

/**
 * Why the official Bot API server's `get_input_media` cannot read media: it is not an object, it
 * has no `type`, a type it does not take here, no file it can find, or a caption Telegram cannot
 * read with its formatting.
 */
export type InputMediaError =
  | { readonly reason: 'media_not_object' | 'animation_in_album' | 'media_file_not_found' }
  | Extract<JsonObjectFieldError, { readonly reason: 'field_missing' }>
  | {
    readonly reason: 'media_type_not_allowed' | 'media_type_unsupported';
    readonly mediaType: string;
  }
  | { readonly reason: 'caption_invalid'; readonly textError: FormattedTextError };

/** How the official Bot API server describes a request without media. */
const MEDIA_REQUIRED_DESCRIPTION = BOT_API_ERRORS.requiredParameterMissing.description({
  parameterName: 'media',
});

/**
 * Describes a caption of media that Telegram cannot read with its formatting, as the official Bot
 * API server does: as media it cannot parse.
 */
export function describeInputMediaCaptionError(textError: FormattedTextError): string {
  return BOT_API_ERRORS.inputMediaInvalid.description({ reason: 'caption_invalid', textError });
}

/**
 * Media types the official server reads but the emulator lacks. In albums, Telegram sends live
 * photos among photos and videos, while it refuses animations.
 */
const UNSUPPORTED_MEDIA_TYPES: ReadonlySet<string> = new Set(['animation', 'live_photo']);

/**
 * What media is read for, which decides the types the official server accepts: new media of a
 * message, or a message of an album, which cannot be an animation.
 */
type InputMediaUse = 'replacement' | 'album';

const mediaTypeSchema = z.looseObject({ type: z.string() });

const captionShape = {
  caption: z.string().default(''),
  parse_mode: z.string().optional(),
  caption_entities: z.array(z.unknown()).optional(),
};

const inputMediaPhotoSchema = z.strictObject({
  type: z.literal('photo'),
  media: z.string().default(''),
  ...captionShape,
  show_caption_above_media: z.boolean().default(false),
  has_spoiler: z.boolean().default(false),
});

// The emulator never detects other media types in documents, so
// `disable_content_type_detection` is validated and ignored.
const inputMediaDocumentSchema = z.strictObject({
  type: z.literal('document'),
  media: z.string().default(''),
  thumbnail: z.string().optional(),
  thumb: z.string().optional(),
  ...captionShape,
  disable_content_type_detection: z.boolean().optional(),
});

/**
 * An integer field of media that the official server's `get_input_video`, `get_input_voice_note`
 * and `get_input_audio` clamp to a range; a missing one is 0.
 */
export function clampedIntegerField(min: number, max: number) {
  return z.int().transform((value) => Math.min(Math.max(value, min), max)).default(0);
}

// As for `sendVideo`, `supports_streaming` is validated and ignored, and a cover is not supported.
const inputMediaVideoSchema = z.strictObject({
  type: z.literal('video'),
  media: z.string().default(''),
  thumbnail: z.string().optional(),
  thumb: z.string().optional(),
  start_timestamp: clampedIntegerField(0, MAX_MEDIA_DURATION_SECONDS),
  ...captionShape,
  show_caption_above_media: z.boolean().default(false),
  width: clampedIntegerField(0, MAX_VIDEO_SIDE_LENGTH),
  height: clampedIntegerField(0, MAX_VIDEO_SIDE_LENGTH),
  duration: clampedIntegerField(0, MAX_MEDIA_DURATION_SECONDS),
  supports_streaming: z.boolean().optional(),
  has_spoiler: z.boolean().default(false),
});

// As the official server's `get_input_audio` reads them, the duration is clamped, and a missing
// performer or title is none. Telegram's audio takes neither a spoiler nor a caption placement,
// which the official server reads and drops; the emulator rejects them as fields the Bot API does
// not document for the type.
const inputMediaAudioSchema = z.strictObject({
  type: z.literal('audio'),
  media: z.string().default(''),
  thumbnail: z.string().optional(),
  thumb: z.string().optional(),
  ...captionShape,
  duration: clampedIntegerField(0, MAX_MEDIA_DURATION_SECONDS),
  performer: z.string().default(''),
  title: z.string().default(''),
});

const INPUT_MEDIA_SCHEMAS = {
  photo: inputMediaPhotoSchema,
  document: inputMediaDocumentSchema,
  video: inputMediaVideoSchema,
  audio: inputMediaAudioSchema,
} as const;

/** Whether the emulator reads a type of media, as `INPUT_MEDIA_SCHEMAS` names it. */
function isReadMediaType(type: string): type is keyof typeof INPUT_MEDIA_SCHEMAS {
  return Object.hasOwn(INPUT_MEDIA_SCHEMAS, type);
}

/**
 * Reads the `media` parameter of `editMessageMedia`, a JSON `InputMediaPhoto`, `InputMediaDocument`,
 * `InputMediaVideo` or `InputMediaAudio`, as the official Bot API server's `get_input_media` reads
 * it, with its descriptions of media it cannot read, as `readInputMedia` reads it.
 */
export function readInputMediaParameter(
  text: string | undefined,
  uploadedFiles: BotApiUploadedFiles,
  invalidParametersDescription: string,
): InputMediaParameterReading {
  if (text === undefined || text.length === 0) {
    return { read: false, description: MEDIA_REQUIRED_DESCRIPTION };
  }
  const parsedParameter = parseBotApiJsonParameter(text);
  if (parsedParameter === undefined) {
    return { read: false, description: BOT_API_ERRORS.inputMediaJsonInvalid.description() };
  }
  const { value } = parsedParameter;
  return readInputMedia(value, 'replacement', uploadedFiles, invalidParametersDescription);
}

/**
 * Reads the `media` parameter of `sendMediaGroup`, a JSON array of `InputMediaPhoto`,
 * `InputMediaDocument`, `InputMediaVideo` and `InputMediaAudio`, as the official Bot API server's
 * `get_input_message_contents` reads it:
 * each as `readInputMedia` reads it, in order, until one cannot be read. As that server reads
 * `null`, it holds no media. Whether the media can form an album is left to the service.
 */
export function readInputMediaGroupParameter(
  text: string | undefined,
  uploadedFiles: BotApiUploadedFiles,
  invalidParametersDescription: string,
): InputMediaGroupParameterReading {
  if (text === undefined || text.length === 0) {
    return { read: false, description: MEDIA_REQUIRED_DESCRIPTION };
  }
  const parsedParameter = parseBotApiJsonParameter(text);
  if (parsedParameter === undefined) {
    return { read: false, description: BOT_API_ERRORS.mediaGroupJsonInvalid.description() };
  }
  const { value } = parsedParameter;
  if (value === null) {
    return { read: true, media: [] };
  }
  if (!Array.isArray(value)) {
    return { read: false, description: BOT_API_ERRORS.mediaGroupNotArray.description() };
  }
  const media: UnreadMediaReplacement[] = [];
  for (const memberValue of value) {
    const reading = readInputMedia(
      memberValue,
      'album',
      uploadedFiles,
      invalidParametersDescription,
    );
    if (!reading.read) {
      return reading;
    }
    media.push(reading.media);
  }
  return { read: true, media };
}

/**
 * Reads one JSON `InputMediaPhoto`, `InputMediaDocument`, `InputMediaVideo` or `InputMediaAudio` as
 * the official Bot API server's `get_input_media` reads it for its use, with its descriptions of
 * media it cannot read. `media` names the file as `readInputFileParameter` reads a file parameter,
 * except that an upload is named only by `attach://<name>`; a document's, video's or audio file's
 * thumbnail is read as `readThumbnailParameter` reads it, and the duration of a video or audio
 * file is clamped as `get_input_video` and `get_input_audio` clamp it.
 *
 * Telegram also reads animations and live photos, which the emulator lacks and
 * rejects with its own description, apart from an animation of an album, which Telegram refuses
 * itself. `invalidParametersDescription` answers fields the Bot API does not document for the
 * media's type, or of the wrong JSON type, which Telegram reads leniently; rejecting them instead
 * surfaces the bot's mistake in tests.
 */
function readInputMedia(
  value: unknown,
  use: InputMediaUse,
  uploadedFiles: BotApiUploadedFiles,
  invalidParametersDescription: string,
): InputMediaParameterReading {
  const failure = (description: string): InputMediaParameterReading => ({
    read: false,
    description,
  });
  const mediaFailure = (error: InputMediaError): InputMediaParameterReading =>
    failure(BOT_API_ERRORS.inputMediaInvalid.description(error));
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return mediaFailure({ reason: 'media_not_object' });
  }
  if (!('type' in value)) {
    return mediaFailure({ reason: 'field_missing', fieldName: 'type' });
  }
  const typedValue = mediaTypeSchema.safeParse(value);
  if (!typedValue.success) {
    return failure(invalidParametersDescription);
  }
  const { type } = typedValue.data;
  if (use === 'album' && type === 'animation') {
    return mediaFailure({ reason: 'animation_in_album' });
  }
  if (UNSUPPORTED_MEDIA_TYPES.has(type)) {
    return failure(BOT_API_ERRORS.inputMediaTypeUnsupported.description({ mediaType: type }));
  }
  if (!isReadMediaType(type)) {
    return mediaFailure({
      reason: type === 'voice_note' ? 'media_type_not_allowed' : 'media_type_unsupported',
      mediaType: type,
    });
  }

  const inputMedia = INPUT_MEDIA_SCHEMAS[type].safeParse(value);
  if (!inputMedia.success) {
    return failure(invalidParametersDescription);
  }
  const { data } = inputMedia;
  // The server reads `media` as a file parameter without a name of its own, so an empty value
  // names no uploaded part.
  const fileReading = readInputFileParameter('', data.media, uploadedFiles);
  if (!fileReading.read) {
    return mediaFailure({ reason: 'media_file_not_found' });
  }
  const caption: UnreadFormattedText = {
    text: data.caption,
    ...(data.parse_mode === undefined ? {} : { parseMode: data.parse_mode }),
    ...(data.caption_entities === undefined ? {} : { entities: data.caption_entities }),
  };
  switch (data.type) {
    case 'photo':
      return {
        read: true,
        media: {
          kind: 'photo',
          photo: fileReading.inputFile,
          caption,
          hasSpoiler: data.has_spoiler,
          showsCaptionAboveMedia: data.show_caption_above_media,
        },
      };
    case 'document': {
      const thumbnail = readThumbnailParameter(data, uploadedFiles);
      return {
        read: true,
        media: {
          kind: 'document',
          document: fileReading.inputFile,
          ...(thumbnail === undefined ? {} : { thumbnail }),
          caption,
        },
      };
    }
    case 'video': {
      const thumbnail = readThumbnailParameter(data, uploadedFiles);
      return {
        read: true,
        media: {
          kind: 'video',
          video: fileReading.inputFile,
          attributes: { durationSeconds: data.duration, width: data.width, height: data.height },
          ...(thumbnail === undefined ? {} : { thumbnail }),
          startTimestampSeconds: data.start_timestamp,
          caption,
          hasSpoiler: data.has_spoiler,
          showsCaptionAboveMedia: data.show_caption_above_media,
        },
      };
    }
    case 'audio': {
      const thumbnail = readThumbnailParameter(data, uploadedFiles);
      return {
        read: true,
        media: {
          kind: 'audio',
          audio: fileReading.inputFile,
          attributes: {
            durationSeconds: data.duration,
            performer: data.performer,
            title: data.title,
          },
          ...(thumbnail === undefined ? {} : { thumbnail }),
          caption,
        },
      };
    }
    default: {
      const unhandledMedia: never = data;
      throw new Error(`Unhandled input media: ${JSON.stringify(unhandledMedia)}`);
    }
  }
}

/** The file that new media names, as its request names it. */
export function getRequestedMediaFile(media: UnreadMediaReplacement): RequestedInputFile {
  switch (media.kind) {
    case 'photo':
      return media.photo;
    case 'document':
      return media.document;
    case 'video':
      return media.video;
    case 'audio':
      return media.audio;
    default: {
      const unhandledMedia: never = media;
      throw new Error(`Unhandled input media: ${JSON.stringify(unhandledMedia)}`);
    }
  }
}

/** New media as the service takes it: with its file resolved and its caption read. */
export function toMediaReplacementRequest(
  media: UnreadMediaReplacement,
  file: BotApiInputFile,
  caption: MediaReplacementRequest['caption'],
): MediaReplacementRequest {
  switch (media.kind) {
    case 'photo':
      return { ...media, photo: file, caption };
    case 'document':
      return { ...media, document: file, caption };
    case 'video':
      return { ...media, video: file, caption };
    case 'audio':
      return { ...media, audio: file, caption };
    default: {
      const unhandledMedia: never = media;
      throw new Error(`Unhandled input media: ${JSON.stringify(unhandledMedia)}`);
    }
  }
}
