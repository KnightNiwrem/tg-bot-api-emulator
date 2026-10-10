import { z } from 'zod';

import { MAX_CALLBACK_QUERY_ANSWER_TEXT_LENGTH } from '../../../../types/callback_query.ts';
import type { EmulationSession } from '../../../../types/emulation_session.ts';
import { readEmbeddedFormattedText } from '../formatted_text_reading.ts';
import {
  type InlineQueryResultParameter,
  inlineQueryResultsButtonParameter,
  readInlineQueryResultsParameter,
  readUnreadLocation,
  type UnreadFormattedText,
  type UnreadInputMessageContent,
} from '../inline_query_answer_parameters.ts';
import {
  BUTTON_DATA_INVALID_DESCRIPTION,
  TDLIB_FILE_TYPE_NAMES,
} from '../message_content_answers.ts';
import {
  badRequestDescription,
  botApiError,
  type BotApiMethod,
  type BotApiMethodAnswer,
  type BotApiMethodContext,
  botApiResult,
} from '../method_call.ts';
import { readInlineKeyboardParameter } from '../reply_markup_reading.ts';
import {
  booleanParameter,
  type BotApiRequestParameters,
  type BotApiUploadedFiles,
  integerParameter,
  jsonParameter,
} from '../request_parameters.ts';
import {
  LOCATION_INVALID_DESCRIPTION,
  readRichMessageParameter,
} from '../rich_message_parameter.ts';
import { excludeRichMessageWebFiles } from '../web_file_parameter.ts';

/** The methods that answer a user's callback query or inline query. */
export const QUERY_ANSWER_METHODS: readonly BotApiMethod[] = [
  { name: 'answerCallbackQuery', recordsActivity: true, handler: handleAnswerCallbackQuery },
  { name: 'answerInlineQuery', recordsActivity: true, handler: handleAnswerInlineQuery },
];

/** Telegram's description for a callback query answer whose URL its servers refuse. */
const URL_INVALID_DESCRIPTION = 'Bad Request: URL_INVALID';

/** Telegram's description for an unknown, expired, or already answered callback query. */
const QUERY_ID_INVALID_DESCRIPTION =
  'Bad Request: query is too old and response timeout expired or query ID is invalid';

/** Telegram's descriptions for rejected answerInlineQuery requests, by the failure's reason. */
const ANSWER_INLINE_QUERY_FAILURE_DESCRIPTIONS = {
  start_parameter_empty: "Bad Request: can't use empty start_parameter",
  start_parameter_too_long: 'Bad Request: too long start_parameter specified',
  start_parameter_invalid: 'Bad Request: unallowed characters in start_parameter are used',
  too_many_results: 'Bad Request: too many inline query results specified',
  query_id_invalid: QUERY_ID_INVALID_DESCRIPTION,
  next_offset_invalid: 'Bad Request: NEXT_OFFSET_INVALID',
  result_id_empty: 'Bad Request: RESULT_ID_EMPTY',
  result_id_invalid: 'Bad Request: RESULT_ID_INVALID',
  result_id_duplicate: 'Bad Request: RESULT_ID_DUPLICATE',
  article_title_empty: 'Bad Request: ARTICLE_TITLE_EMPTY',
  document_title_empty: 'Bad Request: FILE_TITLE_EMPTY',
  video_title_empty: 'Bad Request: VIDEO_TITLE_EMPTY',
  web_document_url_invalid: 'Bad Request: WEBDOCUMENT_URL_INVALID',
  photo_thumbnail_url_empty: 'Bad Request: PHOTO_THUMB_URL_EMPTY',
  callback_data_invalid: BUTTON_DATA_INVALID_DESCRIPTION,
  message_text_too_long: 'Bad Request: MESSAGE_TOO_LONG',
  caption_too_long: 'Bad Request: MEDIA_CAPTION_TOO_LONG',
  file_id_invalid: "Bad Request: wrong remote file identifier specified: can't unserialize it",
  inline_message_content_invalid: 'Bad Request: invalid inline message content specified',
  contact_phone_number_empty: 'Bad Request: field "phone_number" must contain a valid phone number',
  contact_first_name_empty: 'Bad Request: field "first_name" must be non-empty',
} as const;

/** How the Bot API server reports that it cannot read an inline query result. */
const INLINE_QUERY_RESULT_ERROR_PREFIX = "can't parse InlineQueryResult: ";

/** Telegram's default and range for how long clients may cache an inline query's answer. */
const DEFAULT_INLINE_QUERY_CACHE_TIME_SECONDS = 300;
const MAX_INLINE_QUERY_CACHE_TIME_SECONDS = 24 * 60 * 60;

/** Telegram caps how long a client may cache a callback query answer at 30 days. */
const MAX_CALLBACK_QUERY_ANSWER_CACHE_TIME_SECONDS = 30 * 24 * 60 * 60;

// Telegram answers with a URL only for game buttons and bot links. The emulator has no game
// buttons, so the callback query service accepts only a link that starts the answering bot.
const answerCallbackQueryParametersSchema = z.strictObject({
  callback_query_id: z.string().default(''),
  text: z.string().max(MAX_CALLBACK_QUERY_ANSWER_TEXT_LENGTH).optional(),
  show_alert: booleanParameter().default(false),
  url: z.string().optional(),
  cache_time: integerParameter(z.int().min(0).max(MAX_CALLBACK_QUERY_ANSWER_CACHE_TIME_SECONDS))
    .default(0),
});

// `switch_pm_text` and `switch_pm_parameter` are the older form of a `button` that opens the bot's
// private chat, which Telegram still accepts.
const answerInlineQueryParametersSchema = z.strictObject({
  inline_query_id: z.string().default(''),
  results: jsonParameter(z.array(z.unknown())).optional(),
  cache_time: integerParameter(
    z.int().transform((cacheTimeSeconds) =>
      Math.min(Math.max(cacheTimeSeconds, 0), MAX_INLINE_QUERY_CACHE_TIME_SECONDS)
    ),
  ).default(DEFAULT_INLINE_QUERY_CACHE_TIME_SECONDS),
  is_personal: booleanParameter().default(false),
  next_offset: z.string().default(''),
  button: inlineQueryResultsButtonParameter().optional(),
  switch_pm_text: z.string().default(''),
  switch_pm_parameter: z.string().default(''),
});

type InlineQueryResultRequest = Parameters<
  EmulationSession['botApi']['answerInlineQuery']
>[1]['results'][number];

/** What an inline query result's `input_message_content` sends, as the service reads it. */
type InlineResultMessageContentRequest = NonNullable<InlineQueryResultRequest['messageContent']>;

function handleAnswerCallbackQuery(
  context: BotApiMethodContext,
  parameters: BotApiRequestParameters,
): BotApiMethodAnswer {
  const parsedParameters = answerCallbackQueryParametersSchema.safeParse(parameters);
  if (!parsedParameters.success) {
    return botApiError(400, 'Bad Request: invalid answerCallbackQuery parameters');
  }

  const result = context.session.botApi.answerCallbackQuery(
    context.bot,
    {
      callbackQueryId: parsedParameters.data.callback_query_id,
      text: parsedParameters.data.text,
      showAlert: parsedParameters.data.show_alert,
      cacheTimeSeconds: parsedParameters.data.cache_time,
      url: parsedParameters.data.url,
    },
  );
  if (result.answered) {
    return botApiResult(true);
  }
  switch (result.reason) {
    case 'query_id_invalid':
      return botApiError(400, QUERY_ID_INVALID_DESCRIPTION);
    case 'url_invalid':
      return botApiError(400, URL_INVALID_DESCRIPTION);
    default: {
      const unhandledReason: never = result.reason;
      throw new Error(`Unhandled answerCallbackQuery failure: ${unhandledReason}`);
    }
  }
}

function handleAnswerInlineQuery(
  context: BotApiMethodContext,
  parameters: BotApiRequestParameters,
  uploadedFiles: BotApiUploadedFiles,
): BotApiMethodAnswer {
  const invalidParametersDescription = 'Bad Request: invalid answerInlineQuery parameters';
  const parsedParameters = answerInlineQueryParametersSchema.safeParse(parameters);
  if (!parsedParameters.success) {
    return botApiError(400, invalidParametersDescription);
  }
  const { data } = parsedParameters;
  const resultsReading = readInlineQueryResultsParameter(
    data.results ?? [],
    invalidParametersDescription,
  );
  if (!resultsReading.read) {
    return botApiError(400, resultsReading.description);
  }
  const results: InlineQueryResultRequest[] = [];
  for (const result of resultsReading.results) {
    const keyboardReading = readInlineKeyboardParameter(context, result.inlineKeyboard);
    if (!keyboardReading.read) {
      return keyboardReading.errorAnswer;
    }
    const resultReading = readInlineQueryResultContent(
      context,
      { ...result, inlineKeyboard: keyboardReading.inlineKeyboard },
      uploadedFiles,
      invalidParametersDescription,
    );
    if (!resultReading.read) {
      return botApiError(400, resultReading.description);
    }
    results.push(resultReading.result);
  }
  const button = data.button ?? (data.switch_pm_text.length === 0 ? undefined : {
    kind: 'start_bot' as const,
    text: data.switch_pm_text,
    startParameter: data.switch_pm_parameter,
  });

  const result = context.session.botApi.answerInlineQuery(
    context.bot,
    {
      inlineQueryId: data.inline_query_id,
      results,
      cacheTimeSeconds: data.cache_time,
      isPersonal: data.is_personal,
      nextOffset: data.next_offset,
      button,
    },
  );
  if (result.answered) {
    return botApiResult(true);
  }
  switch (result.reason) {
    case 'text_invalid':
      return botApiError(400, badRequestDescription(result.textError));
    case 'file_type_mismatch':
      return botApiError(
        400,
        `Bad Request: can't use file of type ${TDLIB_FILE_TYPE_NAMES[result.actualFileType]} as ${
          TDLIB_FILE_TYPE_NAMES[result.expectedFileType]
        }`,
      );
    default:
      return botApiError(400, ANSWER_INLINE_QUERY_FAILURE_DESCRIPTIONS[result.reason]);
  }
}

/**
 * Reads what an inline query result sends and shows: its `input_message_content`, whose text is
 * read with its parse mode or entities and whose rich message is read as `sendRichMessage` reads
 * one, and its caption.
 */
function readInlineQueryResultContent(
  context: BotApiMethodContext,
  result: InlineQueryResultParameter,
  uploadedFiles: BotApiUploadedFiles,
  invalidParametersDescription: string,
):
  | { readonly read: true; readonly result: InlineQueryResultRequest }
  | { readonly read: false; readonly description: string } {
  const readText = (text: UnreadFormattedText) =>
    readEmbeddedFormattedText(
      context,
      text,
      invalidParametersDescription,
      INLINE_QUERY_RESULT_ERROR_PREFIX,
    );
  const shared = {
    id: result.id,
    ...(result.inlineKeyboard === undefined ? {} : { inlineKeyboard: result.inlineKeyboard }),
  };
  const messageContentReading = result.messageContent === undefined
    ? undefined
    : readInlineResultMessageContent(
      context,
      result.messageContent,
      uploadedFiles,
      invalidParametersDescription,
    );
  if (messageContentReading?.read === false) {
    return messageContentReading;
  }
  const messageContent = messageContentReading?.content;
  if (result.kind === 'article') {
    if (messageContent === undefined) {
      throw new Error('Expected an article result to send its input message content');
    }
    return {
      read: true,
      result: {
        ...shared,
        kind: 'article',
        description: result.description,
        title: result.title,
        url: result.url,
        messageContent,
      },
    };
  }
  const optionalMessageContent = messageContent === undefined ? {} : { messageContent };
  if (result.kind === 'contact') {
    return {
      read: true,
      result: { ...shared, ...optionalMessageContent, kind: 'contact', contact: result.contact },
    };
  }
  if (result.kind === 'location') {
    const location = readUnreadLocation(result.location);
    return location === undefined ? { read: false, description: LOCATION_INVALID_DESCRIPTION } : {
      read: true,
      result: {
        ...shared,
        ...optionalMessageContent,
        kind: 'location',
        title: result.title,
        location,
      },
    };
  }

  const captionReading = readText(result.caption);
  if (!captionReading.read) {
    return captionReading;
  }
  const media = {
    ...shared,
    ...optionalMessageContent,
    title: result.title,
    caption: captionReading.formattedText,
  };
  switch (result.kind) {
    case 'photo':
      return {
        read: true,
        result: {
          ...media,
          kind: 'photo',
          description: result.description,
          photo: result.photo,
          thumbnailUrl: result.thumbnailUrl,
          showsCaptionAboveMedia: result.showsCaptionAboveMedia,
        },
      };
    case 'document':
      return {
        read: true,
        result: {
          ...media,
          kind: 'document',
          description: result.description,
          document: result.document,
          thumbnailUrl: result.thumbnailUrl,
        },
      };
    case 'video':
      return {
        read: true,
        result: {
          ...media,
          kind: 'video',
          description: result.description,
          video: result.video,
          thumbnailUrl: result.thumbnailUrl,
          showsCaptionAboveMedia: result.showsCaptionAboveMedia,
          attributes: result.attributes,
        },
      };
    case 'voice':
      return {
        read: true,
        result: {
          ...media,
          kind: 'voice',
          voice: result.voice,
          durationSeconds: result.durationSeconds,
        },
      };
    case 'audio':
      return {
        read: true,
        result: {
          ...media,
          kind: 'audio',
          audio: result.audio,
          performer: result.performer,
          durationSeconds: result.durationSeconds,
        },
      };
    default: {
      const unhandledResult: never = result;
      throw new Error(`Unhandled inline query result: ${JSON.stringify(unhandledResult)}`);
    }
  }
}

/**
 * Reads what a result's `input_message_content` sends: text with its parse mode or entities; a
 * rich message, read as `readSpecifiedRichMessage` reads the `rich_message` of `sendRichMessage`;
 * a contact, which the service cleans as `sendContact` does; or a static location, whose
 * coordinates must name a point on Earth, as TDLib's `process_input_message_location` requires.
 * A rich message's uploads are read so that answering can refuse them, as TDLib refuses an inline
 * message's uploads. The official server prefixes its own descriptions of a rich message it cannot
 * read with `can't parse InlineQueryResult: `, which the emulator words as for `sendRichMessage`.
 */
function readInlineResultMessageContent(
  context: BotApiMethodContext,
  content: UnreadInputMessageContent,
  uploadedFiles: BotApiUploadedFiles,
  invalidParametersDescription: string,
):
  | { readonly read: true; readonly content: InlineResultMessageContentRequest }
  | { readonly read: false; readonly description: string } {
  if (content.kind === 'text') {
    const textReading = readEmbeddedFormattedText(
      context,
      content.text,
      invalidParametersDescription,
      INLINE_QUERY_RESULT_ERROR_PREFIX,
    );
    return textReading.read
      ? { read: true, content: { kind: 'text', text: textReading.formattedText } }
      : textReading;
  }
  if (content.kind === 'contact') {
    return { read: true, content };
  }
  if (content.kind === 'location') {
    const location = readUnreadLocation(content.location);
    return location === undefined
      ? { read: false, description: LOCATION_INVALID_DESCRIPTION }
      : { read: true, content: { kind: 'location', location } };
  }
  const richMessageReading = readRichMessageParameter(
    JSON.stringify(content.richMessage),
    uploadedFiles,
    invalidParametersDescription,
  );
  if (!richMessageReading.read) {
    return richMessageReading;
  }
  const buttonReading = context.session.botApi.readRichMessageButtons(
    richMessageReading.richMessage,
  );
  if (!buttonReading.read) {
    return { read: false, description: badRequestDescription(buttonReading.keyboardError) };
  }
  // An inline query result's rich message must reuse files by `file_id`, as for uploads.
  const richMessage = excludeRichMessageWebFiles(buttonReading.richMessage);
  return richMessage === undefined
    ? {
      read: false,
      description: ANSWER_INLINE_QUERY_FAILURE_DESCRIPTIONS.inline_message_content_invalid,
    }
    : {
      read: true,
      content: {
        kind: 'rich_message',
        richMessage,
        detectsEntities: richMessageReading.detectsEntities,
      },
    };
}
