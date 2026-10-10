import { z } from 'zod';

import type { EmulationSession } from '../../../../types/emulation_session.ts';
import { CHAT_ID_EMPTY_DESCRIPTION } from '../chat_access.ts';
import { BOT_API_ERRORS } from '../errors/error_catalogue.ts';
import { presentFixedBotApiError } from '../errors/error_template.ts';
import {
  describeInvalidMethodParameters,
  invalidMethodParametersAnswer,
} from '../errors/invalid_parameters.ts';
import { presentMessageEditingFailure } from '../errors/message_editing_failure_presenter.ts';
import {
  captionParametersShape,
  linkPreviewParametersShape,
  readEmbeddedFormattedText,
  readSpecifiedCaption,
  readSpecifiedFormattedText,
} from '../formatted_text_reading.ts';
import {
  getRequestedMediaFile,
  INPUT_MEDIA_ERROR_PREFIX,
  readInputMediaParameter,
  toMediaReplacementRequest,
} from '../input_media_parameter.ts';
import { messageEntitiesParameter } from '../message_entities_parameter.ts';
import { messageIdOrNone, NO_MESSAGE_ID } from '../message_identifiers.ts';
import {
  botApiError,
  type BotApiMethod,
  type BotApiMethodAnswer,
  type BotApiMethodContext,
  type BotApiMethodOutcome,
  botApiResult,
  SESSION_ENDED,
} from '../method_call.ts';
import { inlineKeyboardMarkupParameter } from '../reply_markup_parameter.ts';
import { readInlineKeyboardParameter } from '../reply_markup_reading.ts';
import {
  booleanParameter,
  type BotApiRequestParameters,
  type BotApiUploadedFiles,
  integerParameter,
} from '../request_parameters.ts';
import {
  readSpecifiedRichMessage,
  resolveSpecifiedRichMessage,
  type SpecifiedRichMessage,
} from '../specified_rich_message.ts';
import { resolveRequestedInputFile, type WebFileResolution } from '../web_file_parameter.ts';

/** The methods that edit a sent message, or stop its poll. */
export const MESSAGE_EDITING_METHODS: readonly BotApiMethod[] = [
  { name: 'editMessageCaption', recordsActivity: true, handler: handleEditMessageCaption },
  { name: 'editMessageMedia', recordsActivity: true, handler: handleEditMessageMedia },
  { name: 'editMessageReplyMarkup', recordsActivity: true, handler: handleEditMessageReplyMarkup },
  { name: 'editMessageText', recordsActivity: true, handler: handleEditMessageText },
  { name: 'stopPoll', recordsActivity: true, handler: handleStopPoll },
];

/** Where an edit method finds the message: in a chat, or sent through the bot's inline mode. */
const editedMessageParametersShape = {
  chat_id: integerParameter(z.int()).optional(),
  message_id: integerParameter(z.int()).optional(),
  inline_message_id: z.string().default(''),
};

// A `rich_message`, even an empty one, replaces the text and its formatting, as on Telegram.
const editMessageTextParametersSchema = z.strictObject({
  ...editedMessageParametersShape,
  text: z.string().default(''),
  parse_mode: z.string().optional(),
  entities: messageEntitiesParameter().optional(),
  ...linkPreviewParametersShape,
  rich_message: z.string().optional(),
  reply_markup: inlineKeyboardMarkupParameter().optional(),
});

const editMessageCaptionParametersSchema = z.strictObject({
  ...editedMessageParametersShape,
  ...captionParametersShape,
  show_caption_above_media: booleanParameter().default(false),
  reply_markup: inlineKeyboardMarkupParameter().optional(),
});

const editMessageMediaParametersSchema = z.strictObject({
  ...editedMessageParametersShape,
  media: z.string().optional(),
  reply_markup: inlineKeyboardMarkupParameter().optional(),
});

const editMessageReplyMarkupParametersSchema = z.strictObject({
  ...editedMessageParametersShape,
  reply_markup: inlineKeyboardMarkupParameter().optional(),
});

// Business connections are not supported.
const stopPollParametersSchema = z.strictObject({
  chat_id: integerParameter(z.int()).optional(),
  message_id: integerParameter(z.int()).optional(),
  reply_markup: inlineKeyboardMarkupParameter().optional(),
});

/**
 * The outcome of any edit method for a message addressed by its chat; each fails for a subset of
 * the reasons.
 */
type ChatMessageEditResult =
  | ReturnType<EmulationSession['botApi']['editMessageText']>
  | ReturnType<EmulationSession['botApi']['editMessageCaption']>
  | ReturnType<EmulationSession['botApi']['editMessageMedia']>
  | ReturnType<EmulationSession['botApi']['editMessageReplyMarkup']>;

/** The outcome of any edit method for an inline message; each fails for a subset of the reasons. */
type InlineMessageEditResult =
  | ReturnType<EmulationSession['botApi']['editInlineMessageText']>
  | ReturnType<EmulationSession['botApi']['editInlineMessageCaption']>
  | ReturnType<EmulationSession['botApi']['editInlineMessageMedia']>
  | ReturnType<EmulationSession['botApi']['editInlineMessageReplyMarkup']>;

/** New content of a text or rich message, as the service edits a message with it. */
type SendableTextMessageReplacement = Parameters<
  EmulationSession['botApi']['editMessageText']
>[1]['content'];

/** New content of a text or rich message, as `editMessageText` specifies it. */
type TextMessageReplacementRequest =
  | Extract<SendableTextMessageReplacement, { readonly kind: 'text' }>
  | ({ readonly kind: 'rich_message' } & SpecifiedRichMessage);

/** Where an edit method finds the message it edits, or the error answer for its parameters. */
type EditedMessageTargetReading =
  | {
    readonly read: true;
    readonly target:
      | { readonly kind: 'chat_message'; readonly chatId: number; readonly messageId: number }
      | { readonly kind: 'inline_message'; readonly inlineMessageId: string };
  }
  | { readonly read: false; readonly errorAnswer: BotApiMethodAnswer };

async function handleEditMessageText(
  context: BotApiMethodContext,
  parameters: BotApiRequestParameters,
  uploadedFiles: BotApiUploadedFiles,
): Promise<BotApiMethodOutcome> {
  const invalidParametersDescription = describeInvalidMethodParameters('editMessageText');
  const parsedParameters = editMessageTextParametersSchema.safeParse(parameters);
  if (!parsedParameters.success) {
    return invalidMethodParametersAnswer('editMessageText', parsedParameters.error);
  }
  // Telegram reads the new content before it looks for the message.
  const contentReading = readTextMessageReplacement(
    context,
    parsedParameters.data,
    uploadedFiles,
    invalidParametersDescription,
  );
  if (!contentReading.read) {
    return contentReading.errorAnswer;
  }
  const targetReading = readEditedMessageTarget(parsedParameters.data);
  if (!targetReading.read) {
    return targetReading.errorAnswer;
  }

  const keyboardReading = readInlineKeyboardParameter(context, parsedParameters.data.reply_markup);
  if (!keyboardReading.read) {
    return keyboardReading.errorAnswer;
  }

  const contentResolution = await resolveTextMessageReplacement(context, contentReading.content);
  if (!contentResolution.resolved) {
    return contentResolution.errorAnswer;
  }
  if (!context.session.lifetime.admitsCommits) {
    return SESSION_ENDED;
  }

  const { target } = targetReading;
  const { botApi } = context.session;
  const edit = { content: contentResolution.value, inlineKeyboard: keyboardReading.inlineKeyboard };
  return target.kind === 'inline_message'
    ? inlineMessageEditAnswer(botApi.editInlineMessageText(context.bot, { ...target, ...edit }))
    : chatMessageEditAnswer(botApi.editMessageText(context.bot, { ...target, ...edit }));
}

/** Downloads the files that new rich message content names by URL; text has none. */
async function resolveTextMessageReplacement(
  context: BotApiMethodContext,
  content: TextMessageReplacementRequest,
): Promise<WebFileResolution<SendableTextMessageReplacement>> {
  if (content.kind === 'text') {
    return { resolved: true, value: content };
  }
  const resolution = await resolveSpecifiedRichMessage(context, content);
  return resolution.resolved
    ? { resolved: true, value: { kind: 'rich_message', ...resolution.value } }
    : resolution;
}

/**
 * Reads the new content of `editMessageText`, as the official Bot API server's
 * `process_edit_message_text_query` does: a `rich_message`, when the request has one, and
 * otherwise the text with its `parse_mode` or `entities`.
 */
function readTextMessageReplacement(
  context: BotApiMethodContext,
  { text, parse_mode: parseMode, entities, rich_message: richMessageParameter }: z.output<
    typeof editMessageTextParametersSchema
  >,
  uploadedFiles: BotApiUploadedFiles,
  invalidParametersDescription: string,
):
  | { readonly read: true; readonly content: TextMessageReplacementRequest }
  | { readonly read: false; readonly errorAnswer: BotApiMethodAnswer } {
  if (richMessageParameter !== undefined) {
    const richMessageReading = readSpecifiedRichMessage(
      context,
      richMessageParameter,
      uploadedFiles,
      invalidParametersDescription,
    );
    return richMessageReading.read
      ? { read: true, content: { kind: 'rich_message', ...richMessageReading.richMessage } }
      : richMessageReading;
  }
  const formattedTextReading = readSpecifiedFormattedText(
    context,
    { text, parseMode, entities },
    invalidParametersDescription,
  );
  return formattedTextReading.read
    ? { read: true, content: { kind: 'text', ...formattedTextReading.formattedText } }
    : formattedTextReading;
}

function handleEditMessageCaption(
  context: BotApiMethodContext,
  parameters: BotApiRequestParameters,
): BotApiMethodAnswer {
  const invalidParametersDescription = describeInvalidMethodParameters('editMessageCaption');
  const parsedParameters = editMessageCaptionParametersSchema.safeParse(parameters);
  if (!parsedParameters.success) {
    return invalidMethodParametersAnswer('editMessageCaption', parsedParameters.error);
  }
  const { data } = parsedParameters;
  // Telegram reads the caption and its formatting before it looks for the message.
  const captionReading = readSpecifiedCaption(context, data, invalidParametersDescription);
  if (!captionReading.read) {
    return captionReading.errorAnswer;
  }
  const targetReading = readEditedMessageTarget(data);
  if (!targetReading.read) {
    return targetReading.errorAnswer;
  }
  const keyboardReading = readInlineKeyboardParameter(context, data.reply_markup);
  if (!keyboardReading.read) {
    return keyboardReading.errorAnswer;
  }

  const { target } = targetReading;
  const { botApi } = context.session;
  const edit = {
    caption: captionReading.formattedText,
    showsCaptionAboveMedia: data.show_caption_above_media,
    inlineKeyboard: keyboardReading.inlineKeyboard,
  };
  return target.kind === 'inline_message'
    ? inlineMessageEditAnswer(
      botApi.editInlineMessageCaption(context.bot, { ...target, ...edit }),
    )
    : chatMessageEditAnswer(botApi.editMessageCaption(context.bot, { ...target, ...edit }));
}

/**
 * Replaces a message's media, as the official Bot API server's `process_edit_message_media_query`
 * does: the `media` parameter is read as `readInputMediaParameter` reads it, with its caption
 * reported as media Telegram cannot read, before the message is looked for.
 */
async function handleEditMessageMedia(
  context: BotApiMethodContext,
  parameters: BotApiRequestParameters,
  uploadedFiles: BotApiUploadedFiles,
): Promise<BotApiMethodOutcome> {
  const invalidParametersDescription = describeInvalidMethodParameters('editMessageMedia');
  const parsedParameters = editMessageMediaParametersSchema.safeParse(parameters);
  if (!parsedParameters.success) {
    return invalidMethodParametersAnswer('editMessageMedia', parsedParameters.error);
  }
  const { data } = parsedParameters;
  const mediaReading = readInputMediaParameter(
    data.media,
    uploadedFiles,
    invalidParametersDescription,
  );
  if (!mediaReading.read) {
    return botApiError(400, mediaReading.description);
  }
  const captionReading = readEmbeddedFormattedText(
    context,
    mediaReading.media.caption,
    invalidParametersDescription,
    INPUT_MEDIA_ERROR_PREFIX,
  );
  if (!captionReading.read) {
    return botApiError(400, captionReading.description);
  }
  const targetReading = readEditedMessageTarget(data);
  if (!targetReading.read) {
    return targetReading.errorAnswer;
  }
  const keyboardReading = readInlineKeyboardParameter(context, data.reply_markup);
  if (!keyboardReading.read) {
    return keyboardReading.errorAnswer;
  }

  const { media } = mediaReading;
  const fileResolution = await resolveRequestedInputFile(
    context,
    getRequestedMediaFile(media),
    media.kind,
  );
  if (!fileResolution.resolved) {
    return fileResolution.errorAnswer;
  }
  if (!context.session.lifetime.admitsCommits) {
    return SESSION_ENDED;
  }

  const { target } = targetReading;
  const { botApi } = context.session;
  const edit = {
    media: toMediaReplacementRequest(media, fileResolution.value, captionReading.formattedText),
    inlineKeyboard: keyboardReading.inlineKeyboard,
  };
  return target.kind === 'inline_message'
    ? inlineMessageEditAnswer(botApi.editInlineMessageMedia(context.bot, { ...target, ...edit }))
    : chatMessageEditAnswer(botApi.editMessageMedia(context.bot, { ...target, ...edit }));
}

function handleEditMessageReplyMarkup(
  context: BotApiMethodContext,
  parameters: BotApiRequestParameters,
): BotApiMethodAnswer {
  const parsedParameters = editMessageReplyMarkupParametersSchema.safeParse(parameters);
  if (!parsedParameters.success) {
    return invalidMethodParametersAnswer('editMessageReplyMarkup', parsedParameters.error);
  }
  const targetReading = readEditedMessageTarget(parsedParameters.data);
  if (!targetReading.read) {
    return targetReading.errorAnswer;
  }

  const keyboardReading = readInlineKeyboardParameter(context, parsedParameters.data.reply_markup);
  if (!keyboardReading.read) {
    return keyboardReading.errorAnswer;
  }

  const { target } = targetReading;
  const { botApi } = context.session;
  const { inlineKeyboard } = keyboardReading;
  return target.kind === 'inline_message'
    ? inlineMessageEditAnswer(botApi.editInlineMessageReplyMarkup(context.bot, {
      ...target,
      inlineKeyboard,
    }))
    : chatMessageEditAnswer(
      botApi.editMessageReplyMarkup(context.bot, { ...target, inlineKeyboard }),
    );
}

/**
 * Stops a poll as the official Bot API server's `process_stop_poll_query` reads it: the new
 * keyboard, then the chat and the message, which must be positive to be found.
 */
function handleStopPoll(
  context: BotApiMethodContext,
  parameters: BotApiRequestParameters,
): BotApiMethodAnswer {
  const parsedParameters = stopPollParametersSchema.safeParse(parameters);
  if (!parsedParameters.success) {
    return invalidMethodParametersAnswer('stopPoll', parsedParameters.error);
  }
  const { chat_id: chatId, message_id: messageId, reply_markup: replyMarkup } =
    parsedParameters.data;
  const keyboardReading = readInlineKeyboardParameter(context, replyMarkup);
  if (!keyboardReading.read) {
    return keyboardReading.errorAnswer;
  }
  if (chatId === undefined) {
    return botApiError(400, CHAT_ID_EMPTY_DESCRIPTION);
  }

  const result = context.session.botApi.stopPoll(context.bot, {
    chatId,
    messageId: messageIdOrNone(messageId),
    inlineKeyboard: keyboardReading.inlineKeyboard,
  });
  return result.stopped
    ? botApiResult(result.poll)
    : presentMessageEditingFailure('poll_stop', result);
}

/**
 * Reads where an edit method finds the message, as the official Bot API server does: an edit
 * without `chat_id` and without a positive `message_id` addresses an inline message by its
 * `inline_message_id`, which it reports missing as an unspecified message identifier.
 */
function readEditedMessageTarget(
  { chat_id: chatId, message_id: messageId, inline_message_id: inlineMessageId }: {
    readonly chat_id?: number;
    readonly message_id?: number;
    readonly inline_message_id: string;
  },
): EditedMessageTargetReading {
  if (chatId === undefined && messageIdOrNone(messageId) === NO_MESSAGE_ID) {
    return inlineMessageId.length === 0
      ? {
        read: false,
        errorAnswer: presentFixedBotApiError(BOT_API_ERRORS.messageIdentifierNotSpecified),
      }
      : { read: true, target: { kind: 'inline_message', inlineMessageId } };
  }
  if (chatId === undefined) {
    return { read: false, errorAnswer: botApiError(400, CHAT_ID_EMPTY_DESCRIPTION) };
  }
  return {
    read: true,
    target: { kind: 'chat_message', chatId, messageId: messageIdOrNone(messageId) },
  };
}

/** Answers a successful edit of a message addressed by its chat with the edited message. */
function chatMessageEditAnswer(result: ChatMessageEditResult): BotApiMethodAnswer {
  return result.edited
    ? botApiResult(result.message)
    : presentMessageEditingFailure('chat_message_edit', result);
}

/** Answers a successful edit of an inline message with `true`, as Telegram does. */
function inlineMessageEditAnswer(result: InlineMessageEditResult): BotApiMethodAnswer {
  return result.edited
    ? botApiResult(true)
    : presentMessageEditingFailure('inline_message_edit', result);
}
