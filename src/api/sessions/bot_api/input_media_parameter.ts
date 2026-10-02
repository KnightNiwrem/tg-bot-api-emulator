import { z } from 'zod';

import type { EmulationSession } from '../../../types/emulation_session.ts';
import type { UnreadFormattedText } from './inline_query_answer_parameters.ts';
import {
  readInputFileParameter,
  readThumbnailParameter,
  type RequestedInputFile,
} from './input_file_parameter.ts';
import type { BotApiUploadedFiles } from './request_parameters.ts';

type MediaReplacementRequest = Parameters<
  EmulationSession['botApi']['editMessageMedia']
>[1]['media'];

type PhotoReplacementRequest = Extract<MediaReplacementRequest, { readonly kind: 'photo' }>;
type DocumentReplacementRequest = Extract<MediaReplacementRequest, { readonly kind: 'document' }>;

/** New media as a request specifies it, with its file as named and its caption not yet read. */
export type UnreadMediaReplacement =
  & (
    | (Omit<PhotoReplacementRequest, 'caption' | 'photo'> & {
      readonly photo: RequestedInputFile;
    })
    | (Omit<DocumentReplacementRequest, 'caption' | 'document'> & {
      readonly document: RequestedInputFile;
    })
  )
  & { readonly caption: UnreadFormattedText };

export type InputMediaParameterReading =
  | { readonly read: true; readonly media: UnreadMediaReplacement }
  | { readonly read: false; readonly description: string };

/** How the official Bot API server prefixes its description of `InputMedia` it cannot read. */
const INPUT_MEDIA_ERROR_PREFIX = "Bad Request: can't parse InputMedia: ";

/** Media types the official server reads but the emulator lacks. */
const UNSUPPORTED_MEDIA_TYPES: ReadonlySet<string> = new Set([
  'animation',
  'audio',
  'live_photo',
  'video',
]);

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
  ...captionShape,
  disable_content_type_detection: z.boolean().optional(),
});

/**
 * Reads the `media` parameter of `editMessageMedia`, a JSON `InputMediaPhoto` or
 * `InputMediaDocument`, as the official Bot API server's `get_input_media` reads it, with its
 * descriptions of media it cannot read. `media` names the file as `readInputFileParameter` reads
 * a file parameter, except that an upload is named only by `attach://<name>`; a document's
 * thumbnail is read as `readThumbnailParameter` reads it.
 *
 * Telegram also reads animations, audio, live photos and videos, which the emulator lacks and
 * rejects with its own description. `invalidParametersDescription` answers fields the Bot API
 * does not document for the media's type, or of the wrong JSON type, which Telegram reads
 * leniently; rejecting them instead surfaces the bot's mistake in tests.
 */
export function readInputMediaParameter(
  text: string | undefined,
  uploadedFiles: BotApiUploadedFiles,
  invalidParametersDescription: string,
): InputMediaParameterReading {
  const failure = (description: string): InputMediaParameterReading => ({
    read: false,
    description,
  });
  if (text === undefined || text.length === 0) {
    return failure('Bad Request: parameter "media" is required');
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return failure("Bad Request: can't parse input media JSON object");
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return failure(`${INPUT_MEDIA_ERROR_PREFIX}expected an Object`);
  }
  if (!('type' in value)) {
    return failure(`${INPUT_MEDIA_ERROR_PREFIX}Can't find field "type"`);
  }
  const typedValue = mediaTypeSchema.safeParse(value);
  if (!typedValue.success) {
    return failure(invalidParametersDescription);
  }
  const { type } = typedValue.data;
  if (UNSUPPORTED_MEDIA_TYPES.has(type)) {
    return failure(`Bad Request: InputMedia of type "${type}" is not supported`);
  }
  if (type !== 'photo' && type !== 'document') {
    return failure(
      `${INPUT_MEDIA_ERROR_PREFIX}type "${type}" is ${
        type === 'voice_note' ? 'not allowed' : 'unsupported'
      }`,
    );
  }

  const inputMedia = type === 'photo'
    ? inputMediaPhotoSchema.safeParse(value)
    : inputMediaDocumentSchema.safeParse(value);
  if (!inputMedia.success) {
    return failure(invalidParametersDescription);
  }
  const { data } = inputMedia;
  // The server reads `media` as a file parameter without a name of its own, so an empty value
  // names no uploaded part.
  const fileReading = readInputFileParameter('', data.media, uploadedFiles);
  if (!fileReading.read) {
    return failure(`${INPUT_MEDIA_ERROR_PREFIX}media not found`);
  }
  const caption: UnreadFormattedText = {
    text: data.caption,
    ...(data.parse_mode === undefined ? {} : { parseMode: data.parse_mode }),
    ...(data.caption_entities === undefined ? {} : { entities: data.caption_entities }),
  };
  if (data.type === 'photo') {
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
  }
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
