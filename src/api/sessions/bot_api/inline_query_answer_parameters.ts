import { z } from 'zod';

import type { WrittenContact } from '../../../types/contact.ts';
import {
  createGeoLocation,
  type GeoLocation,
  isPointOnEarth,
  MAX_HORIZONTAL_ACCURACY_METERS,
} from '../../../types/geo_location.ts';
import type { InlineKeyboard } from '../../../types/inline_keyboard.ts';
import type { InlineQueryResultsButton } from '../../../types/inline_query.ts';
import {
  MAX_MEDIA_DURATION_SECONDS,
  MAX_VIDEO_SIDE_LENGTH,
  type VideoAttributes,
} from '../../../types/stored_file.ts';
import { contactNameSchema, contactVcardSchema } from './contact_parameter.ts';
import { linkPreviewOptionsSchema } from './link_preview_options_parameter.ts';
import { inlineKeyboardMarkupSchema } from './reply_markup_parameter.ts';
import { jsonParameter } from './request_parameters.ts';

/** Text as a result specifies it, before its `parse_mode` or entities are read. */
export interface UnreadFormattedText {
  readonly text: string;
  readonly parseMode?: string;
  readonly entities?: readonly unknown[];
}

/**
 * A static location as a result specifies it, before its coordinates are checked. An accuracy of 0
 * means unknown.
 */
export interface UnreadLocation {
  readonly latitude: number;
  readonly longitude: number;
  readonly horizontalAccuracyMeters: number;
}

/**
 * What a result's `input_message_content` sends, before it is read: text; a rich message, which is
 * still the JSON `InputRichMessage` the bot specified; a contact, whose texts are not yet cleaned;
 * or a static location.
 */
export type UnreadInputMessageContent =
  | { readonly kind: 'text'; readonly text: UnreadFormattedText }
  | { readonly kind: 'rich_message'; readonly richMessage: Readonly<Record<string, unknown>> }
  | { readonly kind: 'contact'; readonly contact: WrittenContact }
  | { readonly kind: 'location'; readonly location: UnreadLocation };

/**
 * The file of a media result: one the bot knows by `file_id`, or one it names by URL, which
 * Telegram downloads when an account sends the result.
 */
export type InlineQueryResultFileParameter =
  | { readonly kind: 'file_id'; readonly fileId: string }
  | { readonly kind: 'url'; readonly url: string };

/**
 * The video of a video result: a video file, as `InlineQueryResultFileParameter`, or a web page
 * with an embedded video player, which the bot declares as `text/html`.
 */
export type InlineQueryResultVideoParameter =
  | InlineQueryResultFileParameter
  | { readonly kind: 'embedded_player'; readonly url: string };

interface InlineQueryResultParameterBase {
  readonly id: string;
  /** Omitted for a result whose message has no inline keyboard. */
  readonly inlineKeyboard?: InlineKeyboard;
}

interface DescribedInlineQueryResultParameter extends InlineQueryResultParameterBase {
  /** Empty for none. */
  readonly description: string;
}

/**
 * An inline query result as `answerInlineQuery` specifies it, before its text is read and its
 * file resolved. `messageContent` is what its `input_message_content` sends.
 */
export type InlineQueryResultParameter =
  | (DescribedInlineQueryResultParameter & {
    readonly kind: 'article';
    readonly title: string;
    /** Empty for none, including a URL the bot asks clients to hide. */
    readonly url: string;
    readonly messageContent: UnreadInputMessageContent;
  })
  | (InlineQueryResultParameterBase & {
    readonly kind: 'contact';
    /** Listed by its texts, which TDLib's `get_input_bot_inline_result` trims. */
    readonly contact: WrittenContact;
    readonly messageContent?: UnreadInputMessageContent;
  })
  | (InlineQueryResultParameterBase & {
    readonly kind: 'location';
    readonly title: string;
    /** Also listed by its coordinates, as TDLib's `get_input_bot_inline_result` describes them. */
    readonly location: UnreadLocation;
    readonly messageContent?: UnreadInputMessageContent;
  })
  | (DescribedInlineQueryResultParameter & {
    readonly kind: 'photo';
    readonly photo: InlineQueryResultFileParameter;
    /** The URL of the photo's thumbnail in the list of results; empty for none. */
    readonly thumbnailUrl: string;
    /** Empty for none. */
    readonly title: string;
    readonly caption: UnreadFormattedText;
    readonly showsCaptionAboveMedia: boolean;
    readonly messageContent?: UnreadInputMessageContent;
  })
  | (DescribedInlineQueryResultParameter & {
    readonly kind: 'document';
    readonly document: InlineQueryResultFileParameter;
    /** The URL of the document's thumbnail in the list of results; empty for none. */
    readonly thumbnailUrl: string;
    readonly title: string;
    readonly caption: UnreadFormattedText;
    readonly messageContent?: UnreadInputMessageContent;
  })
  | (DescribedInlineQueryResultParameter & {
    readonly kind: 'video';
    readonly video: InlineQueryResultVideoParameter;
    /** The URL of the video's thumbnail in the list of results; empty for none. */
    readonly thumbnailUrl: string;
    readonly title: string;
    readonly caption: UnreadFormattedText;
    readonly showsCaptionAboveMedia: boolean;
    /** As the bot specified them, clamped as `sendVideo` clamps them. */
    readonly attributes: VideoAttributes;
    /** Always given for an embedded video player, which cannot be sent itself. */
    readonly messageContent?: UnreadInputMessageContent;
  })
  | (InlineQueryResultParameterBase & {
    readonly kind: 'voice';
    readonly voice: InlineQueryResultFileParameter;
    readonly title: string;
    readonly caption: UnreadFormattedText;
    /** As the bot specified it, clamped as `sendVoice` clamps it. */
    readonly durationSeconds: number;
    readonly messageContent?: UnreadInputMessageContent;
  })
  | (InlineQueryResultParameterBase & {
    readonly kind: 'audio';
    readonly audio: InlineQueryResultFileParameter;
    /** Required for an audio file given by URL; empty for none. */
    readonly title: string;
    /** Empty for none. */
    readonly performer: string;
    readonly caption: UnreadFormattedText;
    /** As the bot specified it, clamped as `sendAudio` clamps it. */
    readonly durationSeconds: number;
    readonly messageContent?: UnreadInputMessageContent;
  });

export type InlineQueryResultsParameterReading =
  | { readonly read: true; readonly results: readonly InlineQueryResultParameter[] }
  | { readonly read: false; readonly description: string };

/**
 * The MIME types TDLib's `get_input_bot_inline_result` allows a document given by URL to declare,
 * which it matches as prefixes of the declared type: PDF and ZIP files only.
 */
const WEB_DOCUMENT_MIME_TYPES = ['application/pdf', 'application/zip'] as const;

const WEB_DOCUMENT_MIME_TYPE_INVALID_DESCRIPTION = 'Bad Request: unallowed document MIME type';

/**
 * The MIME types TDLib's `get_input_bot_inline_result` allows a video given by URL to declare,
 * matched as prefixes: a video file, or a web page with an embedded video player.
 */
const WEB_VIDEO_FILE_MIME_TYPE = 'video/mp4';
const EMBEDDED_VIDEO_PLAYER_MIME_TYPE = 'text/html';

const WEB_VIDEO_MIME_TYPE_INVALID_DESCRIPTION = 'Bad Request: unallowed video MIME type';

/**
 * The emulator's description for an embedded video player without `input_message_content`, which
 * the Bot API requires because the player itself cannot be sent; what Telegram does with one is not
 * documented.
 */
const EMBEDDED_VIDEO_PLAYER_CONTENT_MISSING_DESCRIPTION =
  'Bad Request: inline query results with an embedded video player must specify ' +
  'input_message_content';

/** The result types that the emulator reads, by the lowercase names Telegram matches. */
const SUPPORTED_RESULT_TYPES = [
  'article',
  'contact',
  'location',
  'photo',
  'document',
  'video',
  'voice',
  'audio',
] as const;

type SupportedResultType = typeof SUPPORTED_RESULT_TYPES[number];

/** Telegram's result types that the emulator does not support. */
const UNSUPPORTED_RESULT_TYPES = [
  'game',
  'gif',
  'mpeg4_gif',
  'sticker',
  'venue',
] as const;

/**
 * Fields by which the official server's `get_input_message_content` recognizes an
 * `input_message_content` it reads as a venue, which also has coordinates, or an invoice; the
 * emulator supports neither.
 */
const VENUE_INPUT_MESSAGE_CONTENT_FIELDS = ['latitude', 'longitude', 'title', 'address'] as const;
const INVOICE_INPUT_MESSAGE_CONTENT_FIELD = 'payload';

const UNSUPPORTED_INPUT_MESSAGE_CONTENT_DESCRIPTION =
  'Bad Request: inline query results sending a venue or invoice are not supported';

// TDLib reads an empty text as none, so the text of a photo or document result may be empty.
const inputTextMessageContentSchema = z.strictObject({
  message_text: z.string().default(''),
  parse_mode: z.string().optional(),
  entities: z.array(z.unknown()).optional(),
  link_preview_options: linkPreviewOptionsSchema.optional(),
  disable_web_page_preview: z.boolean().optional(),
}).transform(({ message_text, parse_mode, entities }): UnreadInputMessageContent | undefined =>
  message_text.length === 0 ? undefined : {
    kind: 'text',
    text: {
      text: message_text,
      ...(parse_mode === undefined ? {} : { parseMode: parse_mode }),
      ...(entities === undefined ? {} : { entities }),
    },
  }
);

// The official Bot API server's `get_input_message_content` reads a `rich_message` in place of
// any text; the emulator rejects content with both, to surface the ambiguity in tests.
const inputRichMessageContentSchema = z.strictObject({
  rich_message: z.record(z.string(), z.unknown()),
}).transform(({ rich_message }): UnreadInputMessageContent => ({
  kind: 'rich_message',
  richMessage: rich_message,
}));

// As for `sendContact`, a contact names no Telegram user.
const inputContactMessageContentSchema = z.strictObject({
  phone_number: z.string(),
  first_name: contactNameSchema,
  last_name: contactNameSchema.default(''),
  vcard: contactVcardSchema,
}).transform(({ phone_number, first_name, last_name, vcard }): UnreadInputMessageContent => ({
  kind: 'contact',
  contact: { phoneNumber: phone_number, firstName: first_name, lastName: last_name, vcard },
}));

/**
 * The fields of a static location, whose accuracy the Bot API documents from 0 to 1500 meters. As
 * for `sendLocation`, live locations are not supported, so `live_period`, `heading` and
 * `proximity_alert_radius` are refused.
 */
const locationShape = {
  latitude: z.number(),
  longitude: z.number(),
  horizontal_accuracy: z.number().min(0).max(MAX_HORIZONTAL_ACCURACY_METERS).default(0),
};

const inputLocationMessageContentSchema = z.strictObject(locationShape).transform((
  location,
): UnreadInputMessageContent => ({ kind: 'location', location: toUnreadLocation(location) }));

const inputMessageContentSchema = z.union([
  inputRichMessageContentSchema,
  inputContactMessageContentSchema,
  inputLocationMessageContentSchema,
  inputTextMessageContentSchema,
]);

function toUnreadLocation(
  { latitude, longitude, horizontal_accuracy }: {
    readonly latitude: number;
    readonly longitude: number;
    readonly horizontal_accuracy: number;
  },
): UnreadLocation {
  return { latitude, longitude, horizontalAccuracyMeters: horizontal_accuracy };
}

/**
 * Reads a static location as TDLib's `Location::init` does, returning `undefined` for coordinates
 * that name no point on Earth. The accuracy is rounded up to whole meters, as TDLib's
 * `get_input_geo_point` sends it.
 */
export function readUnreadLocation(
  { latitude, longitude, horizontalAccuracyMeters }: UnreadLocation,
): GeoLocation | undefined {
  return isPointOnEarth(latitude, longitude)
    ? createGeoLocation(latitude, longitude, horizontalAccuracyMeters)
    : undefined;
}

/**
 * Thumbnails, which clients show in the list of results; the emulator validates and ignores
 * them.
 */
const thumbnailShape = {
  thumbnail_url: z.string().optional(),
  thumbnail_width: z.int().optional(),
  thumbnail_height: z.int().optional(),
};

const sharedResultShape = {
  type: z.string(),
  id: z.string(),
  reply_markup: inlineKeyboardMarkupSchema.optional(),
  input_message_content: inputMessageContentSchema.optional(),
};

/** The description of the results that take one. */
const descriptionShape = { description: z.string().default('') };

const captionShape = {
  caption: z.string().default(''),
  parse_mode: z.string().optional(),
  caption_entities: z.array(z.unknown()).optional(),
};

// `hide_url` is an older option that Telegram still honors by not sending the URL.
const articleResultSchema = z.strictObject({
  ...sharedResultShape,
  ...descriptionShape,
  ...thumbnailShape,
  title: z.string(),
  url: z.string().default(''),
  hide_url: z.boolean().default(false),
});

// Photos are covered by no spoiler in inline results. The dimensions of a photo given by URL are
// validated and ignored.
const photoResultSchema = z.strictObject({
  ...sharedResultShape,
  ...descriptionShape,
  ...captionShape,
  photo_url: z.string().default(''),
  photo_file_id: z.string().default(''),
  photo_width: z.int().optional(),
  photo_height: z.int().optional(),
  thumbnail_url: z.string().default(''),
  title: z.string().default(''),
  show_caption_above_media: z.boolean().default(false),
});

const documentResultSchema = z.strictObject({
  ...sharedResultShape,
  ...descriptionShape,
  ...captionShape,
  ...thumbnailShape,
  title: z.string(),
  document_url: z.string().default(''),
  document_file_id: z.string().default(''),
  mime_type: z.string().optional(),
});

/**
 * An integer attribute of a video, voice note, or audio file, which the emulator clamps to a range as the
 * official server's `get_input_video` clamps those of `sendVideo`; a missing one is 0.
 */
function clampedAttributeField(max: number) {
  return z.int().transform((value) => Math.min(Math.max(value, 0), max)).default(0);
}

// As for `sendVideo`, inline videos are covered by no spoiler and start at their beginning.
const videoResultSchema = z.strictObject({
  ...sharedResultShape,
  ...descriptionShape,
  ...captionShape,
  title: z.string(),
  video_url: z.string().default(''),
  video_file_id: z.string().default(''),
  mime_type: z.string().optional(),
  thumbnail_url: z.string().default(''),
  video_width: clampedAttributeField(MAX_VIDEO_SIDE_LENGTH),
  video_height: clampedAttributeField(MAX_VIDEO_SIDE_LENGTH),
  video_duration: clampedAttributeField(MAX_MEDIA_DURATION_SECONDS),
  show_caption_above_media: z.boolean().default(false),
});

// A voice result has no description, which the Bot API server does not read for one.
const voiceResultSchema = z.strictObject({
  ...sharedResultShape,
  ...captionShape,
  title: z.string(),
  voice_url: z.string().default(''),
  voice_file_id: z.string().default(''),
  voice_duration: clampedAttributeField(MAX_MEDIA_DURATION_SECONDS),
});

// An audio result has no description: TDLib describes it by its performer. As the official server
// reads them, the title is required only for an audio file given by URL, which takes the title,
// performer and duration as its metadata; a cached audio file keeps its own, and its result lists
// the title and performer, which the Bot API does not document for it, only by them.
const audioResultSchema = z.strictObject({
  ...sharedResultShape,
  ...captionShape,
  title: z.string().optional(),
  performer: z.string().default(''),
  audio_url: z.string().default(''),
  audio_file_id: z.string().default(''),
  audio_duration: clampedAttributeField(MAX_MEDIA_DURATION_SECONDS),
});

// TDLib describes a contact result by its texts, so it takes no description, and names no user.
const contactResultSchema = z.strictObject({
  ...sharedResultShape,
  ...thumbnailShape,
  phone_number: z.string(),
  first_name: contactNameSchema,
  last_name: contactNameSchema.default(''),
  vcard: contactVcardSchema,
});

// TDLib describes a location result by its coordinates, so it takes no description.
const locationResultSchema = z.strictObject({
  ...sharedResultShape,
  ...thumbnailShape,
  ...locationShape,
  title: z.string(),
});

/**
 * Reads the elements of an `answerInlineQuery` `results` parameter as the official Bot API
 * server's `get_inline_query_result` does, failing with Telegram's description for a result it
 * cannot read. Article, contact, static location, photo, document, video, voice, and audio results
 * are supported, the media among them with files given by `file_id` or by URL; other result types fail
 * as unsupported. A result's `input_message_content` may send text, a rich message, a contact, or
 * a static location; a venue or an invoice fails as unsupported.
 *
 * `invalidParametersDescription` answers results that Telegram would read leniently, such as
 * numbers written as strings, which are rejected instead to surface the bot's mistake in tests.
 */
export function readInlineQueryResultsParameter(
  resultValues: readonly unknown[],
  invalidParametersDescription: string,
): InlineQueryResultsParameterReading {
  const results: InlineQueryResultParameter[] = [];
  for (const resultValue of resultValues) {
    const reading = readInlineQueryResult(resultValue);
    switch (reading.kind) {
      case 'result':
        results.push(reading.result);
        break;
      case 'failure':
        return { read: false, description: reading.description };
      case 'malformed':
        return { read: false, description: invalidParametersDescription };
      default: {
        const unhandledReading: never = reading;
        throw new Error(
          `Unhandled inline query result reading: ${JSON.stringify(unhandledReading)}`,
        );
      }
    }
  }
  return { read: true, results };
}

type InlineQueryResultReading =
  | { readonly kind: 'result'; readonly result: InlineQueryResultParameter }
  | { readonly kind: 'failure'; readonly description: string }
  | { readonly kind: 'malformed' };

/** Reads one `InlineQueryResult` object, matching its type case-insensitively as Telegram does. */
function readInlineQueryResult(value: unknown): InlineQueryResultReading {
  const typeReading = z.looseObject({ type: z.string() }).safeParse(value);
  if (!typeReading.success) {
    return { kind: 'malformed' };
  }
  const type = typeReading.data.type.toLowerCase();
  if ((UNSUPPORTED_RESULT_TYPES as readonly string[]).includes(type)) {
    return {
      kind: 'failure',
      description: `Bad Request: inline query results of type "${type}" are not supported`,
    };
  }
  if (!isSupportedResultType(type)) {
    return {
      kind: 'failure',
      description:
        `Bad Request: can't parse InlineQueryResult: type "${type}" is unsupported for the inline query result`,
    };
  }
  const inputMessageContent = z.looseObject({ input_message_content: z.looseObject({}) })
    .safeParse(value);
  if (
    inputMessageContent.success &&
    sendsVenueOrInvoice(inputMessageContent.data.input_message_content)
  ) {
    return { kind: 'failure', description: UNSUPPORTED_INPUT_MESSAGE_CONTENT_DESCRIPTION };
  }

  switch (type) {
    case 'article':
      return readArticleResult(value);
    case 'contact':
      return readContactResult(value);
    case 'location':
      return readLocationResult(value);
    case 'photo':
      return readPhotoResult(value);
    case 'document':
      return readDocumentResult(value);
    case 'video':
      return readVideoResult(value);
    case 'voice':
      return readVoiceResult(value);
    case 'audio':
      return readAudioResult(value);
    default: {
      const unhandledType: never = type;
      throw new Error(`Unhandled inline query result type: ${unhandledType}`);
    }
  }
}

function isSupportedResultType(type: string): type is SupportedResultType {
  return (SUPPORTED_RESULT_TYPES as readonly string[]).includes(type);
}

/**
 * Whether `input_message_content` is one the official server's `get_input_message_content` reads
 * as a venue, which has coordinates, a title, and an address, or as an invoice.
 */
function sendsVenueOrInvoice(inputMessageContent: Readonly<Record<string, unknown>>): boolean {
  return VENUE_INPUT_MESSAGE_CONTENT_FIELDS.every((field) => field in inputMessageContent) ||
    INVOICE_INPUT_MESSAGE_CONTENT_FIELD in inputMessageContent;
}

/** Reads a contact result, whose contact keeps the texts the bot wrote. */
function readContactResult(value: unknown): InlineQueryResultReading {
  const parsing = contactResultSchema.safeParse(value);
  if (!parsing.success) {
    return { kind: 'malformed' };
  }
  const { data } = parsing;
  const messageContent = data.input_message_content;
  return {
    kind: 'result',
    result: {
      kind: 'contact',
      ...readSharedFields(data),
      contact: {
        phoneNumber: data.phone_number,
        firstName: data.first_name,
        lastName: data.last_name,
        vcard: data.vcard,
      },
      ...(messageContent === undefined ? {} : { messageContent }),
    },
  };
}

/** Reads a static location result, whose coordinates are checked once it is read. */
function readLocationResult(value: unknown): InlineQueryResultReading {
  const parsing = locationResultSchema.safeParse(value);
  if (!parsing.success) {
    return { kind: 'malformed' };
  }
  const { data } = parsing;
  const messageContent = data.input_message_content;
  return {
    kind: 'result',
    result: {
      kind: 'location',
      ...readSharedFields(data),
      title: data.title,
      location: toUnreadLocation(data),
      ...(messageContent === undefined ? {} : { messageContent }),
    },
  };
}

function readArticleResult(value: unknown): InlineQueryResultReading {
  const parsing = articleResultSchema.safeParse(value);
  if (!parsing.success) {
    return { kind: 'malformed' };
  }
  const { data } = parsing;
  const messageContent = data.input_message_content;
  // An article sends only its `input_message_content`, which it requires.
  if (messageContent === undefined) {
    return {
      kind: 'failure',
      description:
        "Bad Request: can't parse InlineQueryResult: Input message content is not specified",
    };
  }
  return {
    kind: 'result',
    result: {
      kind: 'article',
      ...readSharedFields(data),
      description: data.description,
      title: data.title,
      url: data.hide_url ? '' : data.url,
      messageContent,
    },
  };
}

function readPhotoResult(value: unknown): InlineQueryResultReading {
  const parsing = photoResultSchema.safeParse(value);
  if (!parsing.success) {
    return { kind: 'malformed' };
  }
  const { data } = parsing;
  const photo = readResultFile(data.photo_url, data.photo_file_id);
  if (photo === undefined) {
    return { kind: 'malformed' };
  }
  const messageContent = data.input_message_content;
  return {
    kind: 'result',
    result: {
      kind: 'photo',
      ...readSharedFields(data),
      description: data.description,
      photo,
      thumbnailUrl: data.thumbnail_url,
      title: data.title,
      caption: readCaption(data),
      showsCaptionAboveMedia: data.show_caption_above_media,
      ...(messageContent === undefined ? {} : { messageContent }),
    },
  };
}

function readDocumentResult(value: unknown): InlineQueryResultReading {
  const parsing = documentResultSchema.safeParse(value);
  if (!parsing.success) {
    return { kind: 'malformed' };
  }
  const { data } = parsing;
  const document = readResultFile(data.document_url, data.document_file_id);
  // The Bot API server requires the MIME type of a document given by `document_url`.
  if (document === undefined || (data.document_url.length > 0 && data.mime_type === undefined)) {
    return { kind: 'malformed' };
  }
  const mimeType = data.mime_type ?? '';
  if (
    document.kind === 'url' &&
    !WEB_DOCUMENT_MIME_TYPES.some((allowedMimeType) => mimeType.startsWith(allowedMimeType))
  ) {
    return { kind: 'failure', description: WEB_DOCUMENT_MIME_TYPE_INVALID_DESCRIPTION };
  }
  const messageContent = data.input_message_content;
  return {
    kind: 'result',
    result: {
      kind: 'document',
      ...readSharedFields(data),
      description: data.description,
      document,
      thumbnailUrl: data.thumbnail_url ?? '',
      title: data.title,
      caption: readCaption(data),
      ...(messageContent === undefined ? {} : { messageContent }),
    },
  };
}

function readVideoResult(value: unknown): InlineQueryResultReading {
  const parsing = videoResultSchema.safeParse(value);
  if (!parsing.success) {
    return { kind: 'malformed' };
  }
  const { data } = parsing;
  const file = readResultFile(data.video_url, data.video_file_id);
  // The Bot API server requires the MIME type of a video given by `video_url`. The Bot API also
  // requires its thumbnail, for which Telegram documents no error, so the emulator refuses a video
  // URL without one as malformed.
  if (
    file === undefined ||
    (data.video_url.length > 0 && (data.mime_type === undefined || data.thumbnail_url === ''))
  ) {
    return { kind: 'malformed' };
  }
  const mimeType = data.mime_type ?? '';
  let video: InlineQueryResultVideoParameter = file;
  if (file.kind === 'url') {
    if (mimeType.startsWith(EMBEDDED_VIDEO_PLAYER_MIME_TYPE)) {
      video = { kind: 'embedded_player', url: file.url };
    } else if (!mimeType.startsWith(WEB_VIDEO_FILE_MIME_TYPE)) {
      return { kind: 'failure', description: WEB_VIDEO_MIME_TYPE_INVALID_DESCRIPTION };
    }
  }
  const messageContent = data.input_message_content;
  if (video.kind === 'embedded_player' && messageContent === undefined) {
    return { kind: 'failure', description: EMBEDDED_VIDEO_PLAYER_CONTENT_MISSING_DESCRIPTION };
  }
  return {
    kind: 'result',
    result: {
      kind: 'video',
      ...readSharedFields(data),
      description: data.description,
      video,
      thumbnailUrl: data.thumbnail_url,
      title: data.title,
      caption: readCaption(data),
      showsCaptionAboveMedia: data.show_caption_above_media,
      attributes: {
        durationSeconds: data.video_duration,
        width: data.video_width,
        height: data.video_height,
      },
      ...(messageContent === undefined ? {} : { messageContent }),
    },
  };
}

function readVoiceResult(value: unknown): InlineQueryResultReading {
  const parsing = voiceResultSchema.safeParse(value);
  if (!parsing.success) {
    return { kind: 'malformed' };
  }
  const { data } = parsing;
  const voice = readResultFile(data.voice_url, data.voice_file_id);
  if (voice === undefined) {
    return { kind: 'malformed' };
  }
  const messageContent = data.input_message_content;
  return {
    kind: 'result',
    result: {
      kind: 'voice',
      ...readSharedFields(data),
      voice,
      title: data.title,
      caption: readCaption(data),
      durationSeconds: data.voice_duration,
      ...(messageContent === undefined ? {} : { messageContent }),
    },
  };
}

function readAudioResult(value: unknown): InlineQueryResultReading {
  const parsing = audioResultSchema.safeParse(value);
  if (!parsing.success) {
    return { kind: 'malformed' };
  }
  const { data } = parsing;
  const audio = readResultFile(data.audio_url, data.audio_file_id);
  if (audio === undefined || (data.audio_url.length > 0 && data.title === undefined)) {
    return { kind: 'malformed' };
  }
  const messageContent = data.input_message_content;
  return {
    kind: 'result',
    result: {
      kind: 'audio',
      ...readSharedFields(data),
      audio,
      title: data.title ?? '',
      performer: data.performer,
      caption: readCaption(data),
      durationSeconds: data.audio_duration,
      ...(messageContent === undefined ? {} : { messageContent }),
    },
  };
}

function readSharedFields(
  { id, reply_markup }: { readonly id: string; readonly reply_markup?: InlineKeyboard },
) {
  return { id, ...(reply_markup === undefined ? {} : { inlineKeyboard: reply_markup }) };
}

/**
 * Reads the file of a media result as the Bot API server and TDLib do: a URL, if given, takes the
 * place of the `file_id`, and text with a dot is a URL, which `file_id` values never contain.
 * Returns `undefined` for a result that gives neither.
 */
function readResultFile(url: string, fileId: string): InlineQueryResultFileParameter | undefined {
  const file = url.length > 0 ? url : fileId;
  if (file.length === 0) {
    return undefined;
  }
  return file.includes('.') ? { kind: 'url', url: file } : { kind: 'file_id', fileId: file };
}

function readCaption(
  { caption, parse_mode, caption_entities }: {
    readonly caption: string;
    readonly parse_mode?: string;
    readonly caption_entities?: readonly unknown[];
  },
): UnreadFormattedText {
  return {
    text: caption,
    ...(parse_mode === undefined ? {} : { parseMode: parse_mode }),
    ...(caption_entities === undefined ? {} : { entities: caption_entities }),
  };
}

// Telegram requires Web App URLs to use HTTPS.
const inlineQueryResultsButtonSchema = z.union([
  z.strictObject({ text: z.string(), start_parameter: z.string() }).transform((
    { text, start_parameter },
  ): InlineQueryResultsButton => ({ kind: 'start_bot', text, startParameter: start_parameter })),
  z.strictObject({
    text: z.string(),
    web_app: z.strictObject({
      url: z.url({ protocol: /^https$/ }),
    }),
  }).transform(({ text, web_app }): InlineQueryResultsButton => ({
    kind: 'web_app',
    text,
    url: web_app.url,
  })),
]);

/**
 * A `button` parameter of `answerInlineQuery`: a JSON `InlineQueryResultsButton` that opens the
 * bot's private chat with a start parameter or a Web App. As on Telegram, it has exactly one of
 * them.
 */
export function inlineQueryResultsButtonParameter() {
  return jsonParameter(inlineQueryResultsButtonSchema);
}
