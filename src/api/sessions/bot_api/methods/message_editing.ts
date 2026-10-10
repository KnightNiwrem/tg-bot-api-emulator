import { z } from 'zod';

import type { EmulationSession } from '../../../../types/emulation_session.ts';
import { CHAT_ID_EMPTY_DESCRIPTION, supergroupBotAccessFailureAnswer } from '../chat_access.ts';
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
import {
  BUTTON_DATA_INVALID_DESCRIPTION,
  BUTTON_TYPE_INVALID_DESCRIPTION,
  CAPTION_TOO_LONG_DESCRIPTION,
  fileResolutionFailureAnswer,
  MESSAGE_TEXT_EMPTY_DESCRIPTION,
  MESSAGE_TEXT_TOO_LONG_DESCRIPTION,
  SEND_PERMISSION_MISSING_DESCRIPTIONS,
} from '../message_content_answers.ts';
import { messageEntitiesParameter } from '../message_entities_parameter.ts';
import { messageIdOrNone, NO_MESSAGE_ID } from '../message_identifiers.ts';
import {
  badRequestDescription,
  botApiError,
  type BotApiMethod,
  type BotApiMethodAnswer,
  type BotApiMethodContext,
  botApiResult,
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
  { name: 'editMessageCaption', handler: handleEditMessageCaption },
  { name: 'editMessageMedia', handler: handleEditMessageMedia },
  { name: 'editMessageReplyMarkup', handler: handleEditMessageReplyMarkup },
  { name: 'editMessageText', handler: handleEditMessageText },
  { name: 'stopPoll', handler: handleStopPoll },
];

/** TDLib's description for a rich message edit of an inline message that uploads a file. */
const INLINE_MESSAGE_CONTENT_INVALID_DESCRIPTION = 'Bad Request: invalid message content specified';

/** Telegram's descriptions for rejected message edits. */
const MESSAGE_IDENTIFIER_NOT_SPECIFIED_DESCRIPTION =
  'Bad Request: message identifier is not specified';
const MESSAGE_TO_EDIT_NOT_FOUND_DESCRIPTION = 'Bad Request: message to edit not found';
const MESSAGE_HAS_NO_TEXT_DESCRIPTION = 'Bad Request: there is no text in the message to edit';
const MESSAGE_HAS_NO_CAPTION_DESCRIPTION =
  'Bad Request: there is no caption in the message to edit';
const MESSAGE_NOT_EDITABLE_DESCRIPTION = "Bad Request: message can't be edited";
/**
 * TDLib's `can_edit_message_media` refuses to edit the media of a voice note, a poll, a contact, or
 * a location.
 */
const MESSAGE_MEDIA_NOT_EDITABLE_DESCRIPTION = "Bad Request: message media can't be edited";

/** The descriptions of the Bot API server's `check_message` and TDLib's `stop_poll`. */
const MESSAGE_WITH_POLL_TO_STOP_NOT_FOUND_DESCRIPTION =
  'Bad Request: message with poll to stop not found';
const MESSAGE_HAS_NO_POLL_DESCRIPTION = 'Bad Request: message is not a poll';
const POLL_NOT_STOPPABLE_DESCRIPTION = "Bad Request: poll can't be stopped";
const POLL_ALREADY_CLOSED_DESCRIPTION = 'Bad Request: poll has already been closed';
/** TDLib's `edit_message_media` keeps a message of an album to its kind of media. */
const ALBUM_MEDIA_TYPE_UNCHANGEABLE_DESCRIPTION =
  "Bad Request: can't change media type in the album";
const MESSAGE_NOT_MODIFIED_DESCRIPTION =
  'Bad Request: message is not modified: specified new message content and reply markup are exactly the same as a current content and reply markup of the message';

/** Telegram's description for an edit of an unknown, deleted, or other bot's inline message. */
const INLINE_MESSAGE_ID_INVALID_DESCRIPTION = 'Bad Request: MESSAGE_ID_INVALID';

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

/** The outcome of any edit method; each fails for a subset of the reasons. */
type MessageEditResult =
  | ReturnType<EmulationSession['botApi']['editMessageText']>
  | ReturnType<EmulationSession['botApi']['editMessageCaption']>
  | ReturnType<EmulationSession['botApi']['editMessageMedia']>;

/** The outcome of any edit method for an inline message; each fails for a subset of the reasons. */
type InlineMessageEditResult =
  | ReturnType<EmulationSession['botApi']['editInlineMessageText']>
  | ReturnType<EmulationSession['botApi']['editInlineMessageCaption']>
  | ReturnType<EmulationSession['botApi']['editInlineMessageMedia']>;

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
): Promise<BotApiMethodAnswer> {
  const invalidParametersDescription = 'Bad Request: invalid editMessageText parameters';
  const parsedParameters = editMessageTextParametersSchema.safeParse(parameters);
  if (!parsedParameters.success) {
    return botApiError(400, invalidParametersDescription);
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

  const { target } = targetReading;
  const { botApi } = context.session;
  const edit = { content: contentResolution.value, inlineKeyboard: keyboardReading.inlineKeyboard };
  return target.kind === 'inline_message'
    ? inlineMessageEditAnswer(botApi.editInlineMessageText(context.bot, { ...target, ...edit }))
    : editMessageAnswer(botApi.editMessageText(context.bot, { ...target, ...edit }));
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
  const invalidParametersDescription = 'Bad Request: invalid editMessageCaption parameters';
  const parsedParameters = editMessageCaptionParametersSchema.safeParse(parameters);
  if (!parsedParameters.success) {
    return botApiError(400, invalidParametersDescription);
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
    : editMessageAnswer(botApi.editMessageCaption(context.bot, { ...target, ...edit }));
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
): Promise<BotApiMethodAnswer> {
  const invalidParametersDescription = 'Bad Request: invalid editMessageMedia parameters';
  const parsedParameters = editMessageMediaParametersSchema.safeParse(parameters);
  if (!parsedParameters.success) {
    return botApiError(400, invalidParametersDescription);
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

  const { target } = targetReading;
  const { botApi } = context.session;
  const edit = {
    media: toMediaReplacementRequest(media, fileResolution.value, captionReading.formattedText),
    inlineKeyboard: keyboardReading.inlineKeyboard,
  };
  return target.kind === 'inline_message'
    ? inlineMessageEditAnswer(botApi.editInlineMessageMedia(context.bot, { ...target, ...edit }))
    : editMessageAnswer(botApi.editMessageMedia(context.bot, { ...target, ...edit }));
}

function handleEditMessageReplyMarkup(
  context: BotApiMethodContext,
  parameters: BotApiRequestParameters,
): BotApiMethodAnswer {
  const parsedParameters = editMessageReplyMarkupParametersSchema.safeParse(parameters);
  if (!parsedParameters.success) {
    return botApiError(400, 'Bad Request: invalid editMessageReplyMarkup parameters');
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
    : editMessageAnswer(
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
    return botApiError(400, 'Bad Request: invalid stopPoll parameters');
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
  if (result.stopped) {
    return botApiResult(result.poll);
  }
  switch (result.reason) {
    case 'chat_not_found':
    case 'bot_not_a_member':
    case 'bot_kicked':
      return supergroupBotAccessFailureAnswer(result.reason);
    case 'message_not_found':
      return botApiError(400, MESSAGE_WITH_POLL_TO_STOP_NOT_FOUND_DESCRIPTION);
    case 'message_has_no_poll':
      return botApiError(400, MESSAGE_HAS_NO_POLL_DESCRIPTION);
    case 'poll_not_stoppable':
      return botApiError(400, POLL_NOT_STOPPABLE_DESCRIPTION);
    case 'poll_already_closed':
      return botApiError(400, POLL_ALREADY_CLOSED_DESCRIPTION);
    case 'callback_data_invalid':
      return botApiError(400, BUTTON_DATA_INVALID_DESCRIPTION);
    case 'button_type_invalid':
      return botApiError(400, BUTTON_TYPE_INVALID_DESCRIPTION);
    default: {
      const unhandledReason: never = result.reason;
      throw new Error(`Unhandled poll stop failure: ${unhandledReason}`);
    }
  }
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
        errorAnswer: botApiError(400, MESSAGE_IDENTIFIER_NOT_SPECIFIED_DESCRIPTION),
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

function editMessageAnswer(result: MessageEditResult): BotApiMethodAnswer {
  if (result.edited) {
    return botApiResult(result.message);
  }
  switch (result.reason) {
    case 'message_text_empty':
      return botApiError(400, MESSAGE_TEXT_EMPTY_DESCRIPTION);
    case 'text_invalid':
      return botApiError(400, badRequestDescription(result.textError));
    case 'chat_not_found':
    case 'bot_not_a_member':
    case 'bot_kicked':
      return supergroupBotAccessFailureAnswer(result.reason);
    case 'message_not_found':
      return botApiError(400, MESSAGE_TO_EDIT_NOT_FOUND_DESCRIPTION);
    case 'message_not_editable':
      return botApiError(400, MESSAGE_NOT_EDITABLE_DESCRIPTION);
    case 'message_has_no_text':
      return botApiError(400, MESSAGE_HAS_NO_TEXT_DESCRIPTION);
    case 'message_has_no_caption':
      return botApiError(400, MESSAGE_HAS_NO_CAPTION_DESCRIPTION);
    case 'message_text_too_long':
      return botApiError(400, MESSAGE_TEXT_TOO_LONG_DESCRIPTION);
    case 'caption_too_long':
      return botApiError(400, CAPTION_TOO_LONG_DESCRIPTION);
    case 'message_media_not_editable':
      return botApiError(400, MESSAGE_MEDIA_NOT_EDITABLE_DESCRIPTION);
    case 'album_media_kind_changed':
      return botApiError(400, ALBUM_MEDIA_TYPE_UNCHANGEABLE_DESCRIPTION);
    case 'callback_data_invalid':
      return botApiError(400, BUTTON_DATA_INVALID_DESCRIPTION);
    case 'button_type_invalid':
      return botApiError(400, BUTTON_TYPE_INVALID_DESCRIPTION);
    case 'message_not_modified':
      return botApiError(400, MESSAGE_NOT_MODIFIED_DESCRIPTION);
    case 'send_permission_missing':
      return botApiError(400, SEND_PERMISSION_MISSING_DESCRIPTIONS[result.contentKind]);
    case 'file_empty':
    case 'image_invalid':
    case 'photo_dimensions_invalid':
    case 'file_id_invalid':
      return fileResolutionFailureAnswer({ reason: result.reason });
    case 'photo_too_big':
    case 'bot_upload_too_big':
    case 'file_type_mismatch':
      return fileResolutionFailureAnswer(result);
    default: {
      const unhandledFailure: never = result;
      throw new Error(`Unhandled message edit failure: ${JSON.stringify(unhandledFailure)}`);
    }
  }
}

/** Answers a successful edit of an inline message with `true`, as Telegram does. */
function inlineMessageEditAnswer(result: InlineMessageEditResult): BotApiMethodAnswer {
  if (result.edited) {
    return botApiResult(true);
  }
  switch (result.reason) {
    case 'inline_message_not_found':
      return botApiError(400, INLINE_MESSAGE_ID_INVALID_DESCRIPTION);
    case 'message_text_empty':
      return botApiError(400, MESSAGE_TEXT_EMPTY_DESCRIPTION);
    case 'text_invalid':
      return botApiError(400, badRequestDescription(result.textError));
    case 'message_has_no_text':
      return botApiError(400, MESSAGE_HAS_NO_TEXT_DESCRIPTION);
    case 'message_has_no_caption':
      return botApiError(400, MESSAGE_HAS_NO_CAPTION_DESCRIPTION);
    case 'message_text_too_long':
      return botApiError(400, MESSAGE_TEXT_TOO_LONG_DESCRIPTION);
    case 'caption_too_long':
      return botApiError(400, CAPTION_TOO_LONG_DESCRIPTION);
    case 'callback_data_invalid':
      return botApiError(400, BUTTON_DATA_INVALID_DESCRIPTION);
    case 'button_type_invalid':
      return botApiError(400, BUTTON_TYPE_INVALID_DESCRIPTION);
    case 'message_not_modified':
      return botApiError(400, MESSAGE_NOT_MODIFIED_DESCRIPTION);
    case 'inline_message_upload_unsupported':
      return botApiError(400, INLINE_MESSAGE_CONTENT_INVALID_DESCRIPTION);
    case 'message_media_not_editable':
      return botApiError(400, MESSAGE_MEDIA_NOT_EDITABLE_DESCRIPTION);
    case 'file_empty':
    case 'image_invalid':
    case 'photo_dimensions_invalid':
    case 'file_id_invalid':
      return fileResolutionFailureAnswer({ reason: result.reason });
    case 'photo_too_big':
    case 'bot_upload_too_big':
    case 'file_type_mismatch':
      return fileResolutionFailureAnswer(result);
    default: {
      const unhandledFailure: never = result;
      throw new Error(`Unhandled inline message edit failure: ${JSON.stringify(unhandledFailure)}`);
    }
  }
}
