import { z } from 'zod';

import { MAX_CALLBACK_QUERY_ANSWER_TEXT_LENGTH } from '../../../../types/callback_query.ts';
import {
  readEmbeddedFormattedText,
  type SpecifiedFormattedText,
} from '../formatted_text_reading.ts';
import {
  checkInlineQueryResultFileType,
  type InlineQueryResultParameter,
  inlineQueryResultsButtonParameter,
  readInlineQueryResultParameter,
  readUnreadLocation,
  type UnreadInputMessageContent,
} from '../inline_query_answer_parameters.ts';
import {
  type InlineQueryAnswerRequest,
  type InlineQueryResultRequest,
  type InlineResultMessageContentRequest,
  resolveInlineQueryResults,
} from '../inline_query_result_resolution.ts';
import { BOT_API_ERRORS } from '../errors/error_catalogue.ts';
import { presentQueryAnswerFailure } from '../errors/query_answer_failure_presenter.ts';
import {
  badRequestDescription,
  type BotApiFamilyContext,
  type BotApiMethod,
  type BotApiMethodContext,
  botApiResult,
} from '../method_call.ts';
import {
  answerWith,
  answerWithBadRequest,
  type BotApiStepCall,
  type BotApiStepResult,
  commandMethodOfSteps,
  proceedWith,
  startSteps,
} from '../method_steps.ts';
import { readInlineKeyboardParameter } from '../reply_markup_reading.ts';
import {
  booleanParameter,
  type BotApiUploadedFiles,
  integerParameter,
  jsonParameter,
} from '../request_parameters.ts';
import {
  LOCATION_INVALID_DESCRIPTION,
  readRichMessageParameter,
} from '../rich_message_parameter.ts';
import type { SpecifiedRichMessage } from '../specified_rich_message.ts';
import { excludeRichMessageWebFiles } from '../web_file_parameter.ts';

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
// private chat, which Telegram still accepts. The official server's
// `process_answer_inline_query_query` reads the button before the results, so the schema names a
// problem with the button first.
const answerInlineQueryParametersSchema = z.strictObject({
  inline_query_id: z.string().default(''),
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
  results: jsonParameter(z.array(z.unknown())).optional(),
});

type AnswerInlineQueryParameters = z.output<typeof answerInlineQueryParametersSchema>;

/**
 * What the query answer methods use: the services that answer callback and inline queries, and
 * the resolver of the files that inline query results send.
 */
type QueryAnswerContext = BotApiFamilyContext<
  'callbackQueries' | 'inlineQueries' | 'botMediaResolver'
>;

/**
 * The methods that answer a user's callback query or inline query, each executed as a command in
 * its call's transaction.
 */
export const QUERY_ANSWER_METHODS: readonly BotApiMethod[] = [
  commandMethodOfSteps({
    name: 'answerCallbackQuery',
    recordsActivity: true,
    parameters: answerCallbackQueryParametersSchema,
    steps: ({ parameters }) => startSteps(parameters),
    execute: (context: QueryAnswerContext, parameters) => {
      const result = context.session.callbackQueries.answerCallbackQuery({
        fromBotId: context.bot.id,
        callbackQueryId: parameters.callback_query_id,
        text: parameters.text,
        showAlert: parameters.show_alert,
        cacheTimeSeconds: parameters.cache_time,
        url: parameters.url,
      });
      return result.answered ? botApiResult(true) : presentQueryAnswerFailure(result);
    },
  }),
  // As the official server's `process_answer_inline_query_query` reads them, the button comes
  // before the results, which it parses in full before TDLib checks any of them.
  commandMethodOfSteps({
    name: 'answerInlineQuery',
    recordsActivity: true,
    parameters: answerInlineQueryParametersSchema,
    steps: (call) =>
      startSteps(call.parameters)
        .andThen(readInlineQueryAnswerButton)
        .andThen((answer) => parseInlineQueryAnswerResults(call, answer))
        .andThen((answer) => checkInlineQueryAnswerResults(call.context, answer)),
    execute: (context: QueryAnswerContext, request) => {
      const resolution = resolveInlineQueryResults(context, request.results);
      if (!resolution.resolved) {
        return presentQueryAnswerFailure({ answered: false, ...resolution.failure });
      }
      const result = context.session.inlineQueries.answerInlineQuery({
        fromBotId: context.bot.id,
        inlineQueryId: request.inlineQueryId,
        results: resolution.results,
        cacheTimeSeconds: request.cacheTimeSeconds,
        isPersonal: request.isPersonal,
        nextOffset: request.nextOffset,
        button: request.button,
      });
      return result.answered ? botApiResult(true) : presentQueryAnswerFailure(result);
    },
  }),
];

/** An inline query's answer as the steps read it, before its results are read. */
type InlineQueryAnswerWithoutResults = Omit<InlineQueryAnswerRequest, 'results'> & {
  readonly resultValues: readonly unknown[];
};

/**
 * The step that reads an inline query's answer but its results: the `button`, or else the older
 * `switch_pm_text` and `switch_pm_parameter`, which open the bot's private chat.
 */
function readInlineQueryAnswerButton(
  parameters: AnswerInlineQueryParameters,
): BotApiStepResult<InlineQueryAnswerWithoutResults> {
  const button = parameters.button ?? (parameters.switch_pm_text.length === 0 ? undefined : {
    kind: 'start_bot' as const,
    text: parameters.switch_pm_text,
    startParameter: parameters.switch_pm_parameter,
  });
  return proceedWith({
    inlineQueryId: parameters.inline_query_id,
    cacheTimeSeconds: parameters.cache_time,
    isPersonal: parameters.is_personal,
    nextOffset: parameters.next_offset,
    button,
    resultValues: parameters.results ?? [],
  });
}

/**
 * What an inline query result's `input_message_content` sends once the official server has parsed
 * it: text read with its parse mode or entities, a rich message read as `sendRichMessage` reads
 * one, a contact, or a static location, whose coordinates TDLib checks later.
 */
type ParsedInlineResultMessageContent =
  | { readonly kind: 'text'; readonly text: SpecifiedFormattedText }
  | ({ readonly kind: 'rich_message' } & SpecifiedRichMessage)
  | Extract<UnreadInputMessageContent, { readonly kind: 'contact' | 'location' }>;

/**
 * An inline query result as the official server's `get_inline_query_result` parses it: its
 * fields, what its `input_message_content` sends, and a media result's caption, read with its
 * formatting. TDLib checks it only once every result is parsed.
 */
interface ParsedInlineQueryResult {
  readonly fields: InlineQueryResultParameter;
  /** Omitted for a result without `input_message_content`. */
  readonly messageContent?: ParsedInlineResultMessageContent;
  /** Omitted for a result that has no caption, as only media results have one. */
  readonly caption?: SpecifiedFormattedText;
}

/** An inline query's answer once the official server has parsed every result. */
interface InlineQueryAnswerWithParsedResults {
  readonly answer: Omit<InlineQueryAnswerRequest, 'results'>;
  readonly parsedResults: readonly ParsedInlineQueryResult[];
}

/**
 * The step that parses an inline query's results one after another until one cannot be parsed, as
 * the official server's `get_inline_query_results` does. It finds what the server reports as it
 * parses a result; what TDLib checks waits for `checkInlineQueryAnswerResults`, since the server
 * passes the results to TDLib only once all of them are parsed.
 */
function parseInlineQueryAnswerResults(
  call: BotApiStepCall<unknown>,
  { resultValues, ...answer }: InlineQueryAnswerWithoutResults,
): BotApiStepResult<InlineQueryAnswerWithParsedResults> {
  const parsedResults: ParsedInlineQueryResult[] = [];
  for (const resultValue of resultValues) {
    const parsing = parseInlineQueryResult(call, resultValue);
    if (!parsing.proceeds) {
      return parsing;
    }
    parsedResults.push(parsing.value);
  }
  return proceedWith({ answer, parsedResults });
}

/**
 * Parses one result as `get_inline_query_result` does: its fields, then the text or rich message
 * of its `input_message_content`, then a media result's caption. The server reports a problem with
 * any of them as an inline query result it cannot parse.
 */
function parseInlineQueryResult(
  { context, uploadedFiles, invalidParametersDescription }: BotApiStepCall<unknown>,
  resultValue: unknown,
): BotApiStepResult<ParsedInlineQueryResult> {
  const fieldsReading = readInlineQueryResultParameter(resultValue, invalidParametersDescription);
  if (!fieldsReading.read) {
    return answerWithBadRequest(fieldsReading.description);
  }
  const fields = fieldsReading.result;
  const messageContentParsing = fields.messageContent === undefined
    ? undefined
    : parseInlineResultMessageContent(
      context,
      fields.messageContent,
      uploadedFiles,
      invalidParametersDescription,
    );
  if (messageContentParsing?.read === false) {
    return answerWithBadRequest(messageContentParsing.description);
  }
  const parsedResult: ParsedInlineQueryResult = {
    fields,
    ...(messageContentParsing === undefined
      ? {}
      : { messageContent: messageContentParsing.content }),
  };
  if (!('caption' in fields)) {
    return proceedWith(parsedResult);
  }
  const captionReading = readEmbeddedFormattedText(
    context,
    fields.caption,
    invalidParametersDescription,
    INLINE_QUERY_RESULT_ERROR_PREFIX,
  );
  return captionReading.read
    ? proceedWith({ ...parsedResult, caption: captionReading.formattedText })
    : answerWithBadRequest(captionReading.description);
}

/**
 * Parses what a result's `input_message_content` sends, as the official server's
 * `get_input_message_content` does: text with its parse mode or entities, or a rich message, read
 * as `readSpecifiedRichMessage` reads the `rich_message` of `sendRichMessage`, with its uploads,
 * so that TDLib's check can refuse them. The server prefixes its own descriptions of a rich
 * message it cannot read with `can't parse InlineQueryResult: `, which the emulator words as for
 * `sendRichMessage`. A contact and a location need no parsing.
 */
function parseInlineResultMessageContent(
  context: BotApiMethodContext,
  content: UnreadInputMessageContent,
  uploadedFiles: BotApiUploadedFiles,
  invalidParametersDescription: string,
):
  | { readonly read: true; readonly content: ParsedInlineResultMessageContent }
  | { readonly read: false; readonly description: string } {
  switch (content.kind) {
    case 'text': {
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
    case 'rich_message': {
      const richMessageReading = readRichMessageParameter(
        JSON.stringify(content.richMessage),
        uploadedFiles,
        invalidParametersDescription,
      );
      return richMessageReading.read
        ? {
          read: true,
          content: {
            kind: 'rich_message',
            richMessage: richMessageReading.richMessage,
            detectsEntities: richMessageReading.detectsEntities,
          },
        }
        : richMessageReading;
    }
    case 'contact':
    case 'location':
      return { read: true, content };
    default: {
      const unhandledContent: never = content;
      throw new Error(`Unhandled inline result content: ${JSON.stringify(unhandledContent)}`);
    }
  }
}

/**
 * The step that checks every parsed result, one after another until one fails, as TDLib's
 * `answer_inline_query` checks each with `get_input_bot_inline_result`.
 */
function checkInlineQueryAnswerResults(
  context: BotApiMethodContext,
  { answer, parsedResults }: InlineQueryAnswerWithParsedResults,
): BotApiStepResult<InlineQueryAnswerRequest> {
  const results: InlineQueryResultRequest[] = [];
  for (const parsedResult of parsedResults) {
    const checking = checkInlineQueryResult(context, parsedResult);
    if (!checking.proceeds) {
      return checking;
    }
    results.push(checking.value);
  }
  return proceedWith({ ...answer, results });
}

/**
 * Checks a parsed result as TDLib's `get_input_bot_inline_result` does: the MIME type of a file it
 * names by URL, then, in `get_inline_message`, its inline keyboard's buttons, then what it sends,
 * such as a location's coordinates or a rich message's buttons and files.
 */
function checkInlineQueryResult(
  context: BotApiMethodContext,
  { fields, messageContent: parsedMessageContent, caption }: ParsedInlineQueryResult,
): BotApiStepResult<InlineQueryResultRequest> {
  const fileTypeChecking = checkInlineQueryResultFileType(fields);
  if (!fileTypeChecking.read) {
    return answerWithBadRequest(fileTypeChecking.description);
  }
  const result = fileTypeChecking.result;
  const keyboardReading = readInlineKeyboardParameter(context, result.inlineKeyboard);
  if (!keyboardReading.read) {
    return answerWith(keyboardReading.errorAnswer);
  }
  const messageContentChecking = parsedMessageContent === undefined
    ? undefined
    : checkInlineResultMessageContent(context, parsedMessageContent);
  if (messageContentChecking?.read === false) {
    return answerWithBadRequest(messageContentChecking.description);
  }
  const messageContent = messageContentChecking?.content;
  const shared = {
    id: result.id,
    ...(keyboardReading.inlineKeyboard === undefined
      ? {}
      : { inlineKeyboard: keyboardReading.inlineKeyboard }),
  };
  if (result.kind === 'article') {
    if (messageContent === undefined) {
      throw new Error('Expected an article result to send its input message content');
    }
    return proceedWith({
      ...shared,
      kind: 'article',
      description: result.description,
      title: result.title,
      url: result.url,
      messageContent,
    });
  }
  const optionalMessageContent = messageContent === undefined ? {} : { messageContent };
  if (result.kind === 'contact') {
    return proceedWith({
      ...shared,
      ...optionalMessageContent,
      kind: 'contact',
      contact: result.contact,
    });
  }
  if (result.kind === 'location') {
    const location = readUnreadLocation(result.location);
    return location === undefined
      ? answerWithBadRequest(LOCATION_INVALID_DESCRIPTION)
      : proceedWith({
        ...shared,
        ...optionalMessageContent,
        kind: 'location',
        title: result.title,
        location,
      });
  }

  if (caption === undefined) {
    throw new Error('Expected a media result to have its caption read');
  }
  const media = { ...shared, ...optionalMessageContent, title: result.title, caption };
  switch (result.kind) {
    case 'photo':
      return proceedWith({
        ...media,
        kind: 'photo',
        description: result.description,
        photo: result.photo,
        thumbnailUrl: result.thumbnailUrl,
        showsCaptionAboveMedia: result.showsCaptionAboveMedia,
      });
    case 'document':
      return proceedWith({
        ...media,
        kind: 'document',
        description: result.description,
        document: result.document,
        thumbnailUrl: result.thumbnailUrl,
      });
    case 'video':
      return proceedWith({
        ...media,
        kind: 'video',
        description: result.description,
        video: result.video,
        thumbnailUrl: result.thumbnailUrl,
        showsCaptionAboveMedia: result.showsCaptionAboveMedia,
        attributes: result.attributes,
      });
    case 'voice':
      return proceedWith({
        ...media,
        kind: 'voice',
        voice: result.voice,
        durationSeconds: result.durationSeconds,
      });
    case 'audio':
      return proceedWith({
        ...media,
        kind: 'audio',
        audio: result.audio,
        performer: result.performer,
        durationSeconds: result.durationSeconds,
      });
    default: {
      const unhandledResult: never = result;
      throw new Error(`Unhandled inline query result: ${JSON.stringify(unhandledResult)}`);
    }
  }
}

/**
 * Checks what a result's `input_message_content` sends, as TDLib's `get_inline_message` does: a
 * static location's coordinates must name a point on Earth, as `process_input_message_location`
 * requires, and a rich message's buttons are checked as in any inline message. A rich message must
 * reuse its files by `file_id`, since `get_inline_message` refuses an inline message's uploads and
 * files named by URL. Text and a contact need no check here; the service cleans a contact as
 * `sendContact` does.
 */
function checkInlineResultMessageContent(
  context: BotApiMethodContext,
  content: ParsedInlineResultMessageContent,
):
  | { readonly read: true; readonly content: InlineResultMessageContentRequest }
  | { readonly read: false; readonly description: string } {
  switch (content.kind) {
    case 'text':
    case 'contact':
      return { read: true, content };
    case 'location': {
      const location = readUnreadLocation(content.location);
      return location === undefined
        ? { read: false, description: LOCATION_INVALID_DESCRIPTION }
        : { read: true, content: { kind: 'location', location } };
    }
    case 'rich_message': {
      const buttonReading = context.session.botApi.readRichMessageButtons(content.richMessage);
      if (!buttonReading.read) {
        return { read: false, description: badRequestDescription(buttonReading.keyboardError) };
      }
      const richMessage = excludeRichMessageWebFiles(buttonReading.richMessage);
      return richMessage === undefined
        ? {
          read: false,
          description: BOT_API_ERRORS.inlineQueryResultContentInvalid.description(),
        }
        : {
          read: true,
          content: { kind: 'rich_message', richMessage, detectsEntities: content.detectsEntities },
        };
    }
    default: {
      const unhandledContent: never = content;
      throw new Error(`Unhandled inline result content: ${JSON.stringify(unhandledContent)}`);
    }
  }
}
