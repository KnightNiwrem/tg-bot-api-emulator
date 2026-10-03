import { z } from 'zod';

import type { InlineKeyboard } from '../../../types/inline_keyboard.ts';
import type { InlineQueryResultsButton } from '../../../types/inline_query.ts';
import {
  MAX_MEDIA_DURATION_SECONDS,
  MAX_VIDEO_SIDE_LENGTH,
  type VideoAttributes,
} from '../../../types/stored_file.ts';
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
 * What a result's `input_message_content` sends, before its text is read: text, or a rich
 * message, which is still the JSON `InputRichMessage` the bot specified.
 */
export type UnreadInputMessageContent =
  | { readonly kind: 'text'; readonly text: UnreadFormattedText }
  | { readonly kind: 'rich_message'; readonly richMessage: Readonly<Record<string, unknown>> };

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
  /** Empty for none. */
  readonly description: string;
  /** Omitted for a result whose message has no inline keyboard. */
  readonly inlineKeyboard?: InlineKeyboard;
}

/**
 * An inline query result as `answerInlineQuery` specifies it, before its text is read and its
 * file resolved. `messageContent` is what its `input_message_content` sends.
 */
export type InlineQueryResultParameter =
  | (InlineQueryResultParameterBase & {
    readonly kind: 'article';
    readonly title: string;
    /** Empty for none, including a URL the bot asks clients to hide. */
    readonly url: string;
    readonly messageContent: UnreadInputMessageContent;
  })
  | (InlineQueryResultParameterBase & {
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
  | (InlineQueryResultParameterBase & {
    readonly kind: 'document';
    readonly document: InlineQueryResultFileParameter;
    /** The URL of the document's thumbnail in the list of results; empty for none. */
    readonly thumbnailUrl: string;
    readonly title: string;
    readonly caption: UnreadFormattedText;
    readonly messageContent?: UnreadInputMessageContent;
  })
  | (InlineQueryResultParameterBase & {
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
  | (Omit<InlineQueryResultParameterBase, 'description'> & {
    readonly kind: 'voice';
    readonly voice: InlineQueryResultFileParameter;
    readonly title: string;
    readonly caption: UnreadFormattedText;
    /** As the bot specified it, clamped as `sendVoice` clamps it. */
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

/** Telegram's result types that the emulator does not support. */
const UNSUPPORTED_RESULT_TYPES = [
  'audio',
  'contact',
  'game',
  'gif',
  'location',
  'mpeg4_gif',
  'sticker',
  'venue',
] as const;

/**
 * Fields by which Telegram recognizes `input_message_content` of a location, venue, contact, or
 * invoice, which the emulator does not support.
 */
const UNSUPPORTED_INPUT_MESSAGE_CONTENT_FIELDS = [
  'latitude',
  'longitude',
  'phone_number',
  'payload',
] as const;

const UNSUPPORTED_INPUT_MESSAGE_CONTENT_DESCRIPTION =
  'Bad Request: inline query results sending a location, venue, contact, or invoice are not ' +
  'supported';

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

const inputMessageContentSchema = z.union([
  inputRichMessageContentSchema,
  inputTextMessageContentSchema,
]);

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
  description: z.string().default(''),
  reply_markup: inlineKeyboardMarkupSchema.optional(),
  input_message_content: inputMessageContentSchema.optional(),
};

const captionShape = {
  caption: z.string().default(''),
  parse_mode: z.string().optional(),
  caption_entities: z.array(z.unknown()).optional(),
};

// `hide_url` is an older option that Telegram still honors by not sending the URL.
const articleResultSchema = z.strictObject({
  ...sharedResultShape,
  ...thumbnailShape,
  title: z.string(),
  url: z.string().default(''),
  hide_url: z.boolean().default(false),
});

// Photos are covered by no spoiler in inline results. The dimensions of a photo given by URL are
// validated and ignored.
const photoResultSchema = z.strictObject({
  ...sharedResultShape,
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
  ...captionShape,
  ...thumbnailShape,
  title: z.string(),
  document_url: z.string().default(''),
  document_file_id: z.string().default(''),
  mime_type: z.string().optional(),
});

/**
 * An integer attribute of a video or voice note, which the emulator clamps to a range as the
 * official server's `get_input_video` clamps those of `sendVideo`; a missing one is 0.
 */
function clampedAttributeField(max: number) {
  return z.int().transform((value) => Math.min(Math.max(value, 0), max)).default(0);
}

// As for `sendVideo`, inline videos are covered by no spoiler and start at their beginning.
const videoResultSchema = z.strictObject({
  ...sharedResultShape,
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
  type: sharedResultShape.type,
  id: sharedResultShape.id,
  reply_markup: sharedResultShape.reply_markup,
  input_message_content: sharedResultShape.input_message_content,
  ...captionShape,
  title: z.string(),
  voice_url: z.string().default(''),
  voice_file_id: z.string().default(''),
  voice_duration: clampedAttributeField(MAX_MEDIA_DURATION_SECONDS),
});

/**
 * Reads the elements of an `answerInlineQuery` `results` parameter as the official Bot API
 * server's `get_inline_query_result` does, failing with Telegram's description for a result it
 * cannot read. Article, photo, document, video, and voice results are supported, all but articles
 * with files given by `file_id` or by URL; other result types fail as unsupported. A result's
 * `input_message_content`
 * may send text or a rich message; other message contents fail as unsupported.
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
  if (
    type !== 'article' && type !== 'photo' && type !== 'document' && type !== 'video' &&
    type !== 'voice'
  ) {
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
    UNSUPPORTED_INPUT_MESSAGE_CONTENT_FIELDS.some((field) =>
      field in inputMessageContent.data.input_message_content
    )
  ) {
    return { kind: 'failure', description: UNSUPPORTED_INPUT_MESSAGE_CONTENT_DESCRIPTION };
  }

  switch (type) {
    case 'article':
      return readArticleResult(value);
    case 'photo':
      return readPhotoResult(value);
    case 'document':
      return readDocumentResult(value);
    case 'video':
      return readVideoResult(value);
    case 'voice':
      return readVoiceResult(value);
    default: {
      const unhandledType: never = type;
      throw new Error(`Unhandled inline query result type: ${unhandledType}`);
    }
  }
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
      id: data.id,
      ...(data.reply_markup === undefined ? {} : { inlineKeyboard: data.reply_markup }),
      voice,
      title: data.title,
      caption: readCaption(data),
      durationSeconds: data.voice_duration,
      ...(messageContent === undefined ? {} : { messageContent }),
    },
  };
}

function readSharedFields(
  { id, description, reply_markup }: {
    readonly id: string;
    readonly description: string;
    readonly reply_markup?: InlineKeyboard;
  },
) {
  return {
    id,
    description,
    ...(reply_markup === undefined ? {} : { inlineKeyboard: reply_markup }),
  };
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
