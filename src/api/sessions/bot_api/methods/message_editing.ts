import { z } from 'zod';

import type { InlineKeyboard } from '../../../../types/inline_keyboard.ts';
import { requireSpecifiedChatId } from '../chat_access.ts';
import { BOT_API_ERRORS } from '../errors/error_catalogue.ts';
import { presentFixedBotApiError } from '../errors/error_template.ts';
import { presentMessageEditingFailure } from '../errors/message_editing_failure_presenter.ts';
import {
  captionParametersShape,
  linkPreviewParametersShape,
  readEmbeddedFormattedText,
  readSpecifiedCaption,
  readSpecifiedFormattedText,
  type SpecifiedFormattedText,
} from '../formatted_text_reading.ts';
import {
  describeInputMediaCaptionError,
  getRequestedMediaFile,
  readInputMediaParameter,
  toMediaReplacementRequest,
  type UnreadMediaReplacement,
} from '../input_media_parameter.ts';
import { messageEntitiesParameter } from '../message_entities_parameter.ts';
import {
  type ChatMessageCaptionEditResult,
  type ChatMessageKeyboardEditResult,
  type ChatMessageMediaEditResult,
  type ChatMessageTextEditResult,
  editChatMessageCaption,
  editChatMessageKeyboard,
  editChatMessageMedia,
  editChatMessageText,
  editInlineMessageCaption,
  editInlineMessageKeyboard,
  editInlineMessageMedia,
  editInlineMessageText,
  type InlineMessageCaptionEditResult,
  type InlineMessageKeyboardEditResult,
  type InlineMessageMediaEditResult,
  type InlineMessageTextEditResult,
  type MessageEditContext,
  type SendableTextMessageReplacement,
  stopPoll,
} from '../message_edits.ts';
import { messageIdOrNone, NO_MESSAGE_ID } from '../message_identifiers.ts';
import {
  type BotApiMethod,
  type BotApiMethodAnswer,
  type BotApiMethodContext,
  botApiResult,
  SESSION_ENDED,
} from '../method_call.ts';
import {
  answerWith,
  answerWithBadRequest,
  type BotApiStepCall,
  type BotApiStepResult,
  commandMethodOfSteps,
  proceedWith,
  startSteps,
  waitingCommandMethodOfSteps,
} from '../method_steps.ts';
import { inlineKeyboardMarkupParameter } from '../reply_markup_parameter.ts';
import { readInlineKeyboardParameter } from '../reply_markup_reading.ts';
import { booleanParameter, integerParameter } from '../request_parameters.ts';
import {
  readSpecifiedRichMessage,
  resolveSpecifiedRichMessage,
  type SpecifiedRichMessage,
} from '../specified_rich_message.ts';
import {
  resolveRequestedInputFile,
  SESSION_ENDED_RESOLUTION,
  toWaitResult,
  type WebFileResolution,
} from '../web_file_parameter.ts';

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

type StopPollParameters = z.output<typeof stopPollParametersSchema>;

/** The parameters every edit method takes: where it finds the message, and its new keyboard. */
interface EditParameters {
  readonly chat_id?: number;
  readonly message_id?: number;
  readonly inline_message_id: string;
  readonly reply_markup?: InlineKeyboard;
}

/** An edit as its steps read it, starting from its parameters. */
interface EditReading {
  readonly parameters: EditParameters;
}

/** Where an edit method finds the message it edits. */
type EditedMessageTarget =
  | { readonly kind: 'chat_message'; readonly chatId: number; readonly messageId: number }
  | { readonly kind: 'inline_message'; readonly inlineMessageId: string };

/**
 * The outcome of any edit method for a message addressed by its chat; each fails for a subset of
 * the reasons.
 */
type ChatMessageEditResult =
  | ChatMessageTextEditResult
  | ChatMessageCaptionEditResult
  | ChatMessageMediaEditResult
  | ChatMessageKeyboardEditResult;

/** The outcome of any edit method for an inline message; each fails for a subset of the reasons. */
type InlineMessageEditResult =
  | InlineMessageTextEditResult
  | InlineMessageCaptionEditResult
  | InlineMessageMediaEditResult
  | InlineMessageKeyboardEditResult;

/** New content of a text or rich message, as `editMessageText` specifies it. */
type TextMessageReplacementRequest =
  | Extract<SendableTextMessageReplacement, { readonly kind: 'text' }>
  | ({ readonly kind: 'rich_message' } & SpecifiedRichMessage);

/**
 * The methods that edit a sent message, and `stopPoll`, which stops a sent message's poll, each
 * executed as a command in its call's transaction. Each edit's steps read its new content, then
 * where it finds the message, then its new keyboard, as Telegram reads them; an edit that names
 * files by URL then waits for their downloads. Finding the message, with every check of the bot's
 * access to it, waits for the call's execution.
 */
export const MESSAGE_EDITING_METHODS: readonly BotApiMethod[] = [
  commandMethodOfSteps({
    name: 'editMessageCaption',
    recordsActivity: true,
    parameters: editMessageCaptionParametersSchema,
    steps: (call) =>
      startSteps(call.parameters)
        .andThen((parameters) => readCaptionReplacement(call, parameters))
        .andThen(readEditedMessageTarget)
        .andThen((edit) => readEditKeyboard(call.context, edit)),
    execute: (context: MessageEditContext, { parameters, caption, target, inlineKeyboard }) => {
      const edit = {
        caption,
        showsCaptionAboveMedia: parameters.show_caption_above_media,
        inlineKeyboard,
      };
      return target.kind === 'inline_message'
        ? inlineMessageEditAnswer(editInlineMessageCaption(context, { ...target, ...edit }))
        : chatMessageEditAnswer(editChatMessageCaption(context, { ...target, ...edit }));
    },
  }),
  waitingCommandMethodOfSteps({
    name: 'editMessageMedia',
    recordsActivity: true,
    parameters: editMessageMediaParametersSchema,
    steps: (call) =>
      startSteps(call.parameters)
        .andThen((parameters) => readMediaReplacement(call, parameters))
        .andThen(readEditedMessageTarget)
        .andThen((edit) => readEditKeyboard(call.context, edit)),
    waitFor: async (context, { media, caption, target, inlineKeyboard }) => {
      const fileResolution = await resolveRequestedInputFile(
        context,
        getRequestedMediaFile(media),
        media.kind,
      );
      if (!context.session.lifetime.admitsCommits) {
        return SESSION_ENDED;
      }
      return toWaitResult(fileResolution, (file) => ({
        target,
        edit: { media: toMediaReplacementRequest(media, file, caption), inlineKeyboard },
      }));
    },
    execute: (context: MessageEditContext, { target, edit }) =>
      target.kind === 'inline_message'
        ? inlineMessageEditAnswer(editInlineMessageMedia(context, { ...target, ...edit }))
        : chatMessageEditAnswer(editChatMessageMedia(context, { ...target, ...edit })),
  }),
  commandMethodOfSteps({
    name: 'editMessageReplyMarkup',
    recordsActivity: true,
    parameters: editMessageReplyMarkupParametersSchema,
    steps: (call) =>
      startSteps({ parameters: call.parameters })
        .andThen(readEditedMessageTarget)
        .andThen((edit) => readEditKeyboard(call.context, edit)),
    execute: (context: MessageEditContext, { target, inlineKeyboard }) =>
      target.kind === 'inline_message'
        ? inlineMessageEditAnswer(editInlineMessageKeyboard(context, { ...target, inlineKeyboard }))
        : chatMessageEditAnswer(editChatMessageKeyboard(context, { ...target, inlineKeyboard })),
  }),
  waitingCommandMethodOfSteps({
    name: 'editMessageText',
    recordsActivity: true,
    parameters: editMessageTextParametersSchema,
    steps: (call) =>
      startSteps(call.parameters)
        .andThen((parameters) => readTextMessageReplacement(call, parameters))
        .andThen(readEditedMessageTarget)
        .andThen((edit) => readEditKeyboard(call.context, edit)),
    waitFor: async (context, { content, target, inlineKeyboard }) => {
      const contentResolution = await resolveTextMessageReplacement(context, content);
      if (!context.session.lifetime.admitsCommits) {
        return SESSION_ENDED;
      }
      return toWaitResult(
        contentResolution,
        (resolvedContent) => ({ target, edit: { content: resolvedContent, inlineKeyboard } }),
      );
    },
    execute: (context: MessageEditContext, { target, edit }) =>
      target.kind === 'inline_message'
        ? inlineMessageEditAnswer(editInlineMessageText(context, { ...target, ...edit }))
        : chatMessageEditAnswer(editChatMessageText(context, { ...target, ...edit })),
  }),
  // As the official server's `process_stop_poll_query` reads them: the new keyboard, then the
  // chat and the message, which must be positive to be found.
  commandMethodOfSteps({
    name: 'stopPoll',
    recordsActivity: true,
    parameters: stopPollParametersSchema,
    steps: (call) =>
      startSteps(call.parameters)
        .andThen((parameters) => readStopPollKeyboard(call.context, parameters))
        .andThen(requireSpecifiedChatId),
    execute: (
      context: MessageEditContext,
      { chat_id: chatId, message_id: messageId, inlineKeyboard },
    ) => {
      const result = stopPoll(context, {
        chatId,
        messageId: messageIdOrNone(messageId),
        inlineKeyboard,
      });
      return result.stopped
        ? botApiResult(result.poll)
        : presentMessageEditingFailure('poll_stop', result);
    },
  }),
];

/**
 * The step that reads the new content of `editMessageText`, as the official Bot API server's
 * `process_edit_message_text_query` does: a `rich_message`, when the request has one, and
 * otherwise the text with its `parse_mode` or `entities`.
 */
function readTextMessageReplacement<Parameters extends EditParameters>(
  { context, uploadedFiles, invalidParametersDescription }: BotApiStepCall<unknown>,
  parameters: Parameters & {
    readonly text: string;
    readonly parse_mode?: string;
    readonly entities?: readonly unknown[];
    readonly rich_message?: string;
  },
): BotApiStepResult<
  { readonly parameters: Parameters; readonly content: TextMessageReplacementRequest }
> {
  const { text, parse_mode: parseMode, entities, rich_message: richMessageParameter } = parameters;
  if (richMessageParameter !== undefined) {
    const richMessageReading = readSpecifiedRichMessage(
      context,
      richMessageParameter,
      uploadedFiles,
      invalidParametersDescription,
    );
    return richMessageReading.read
      ? proceedWith({
        parameters,
        content: { kind: 'rich_message', ...richMessageReading.richMessage },
      })
      : answerWith(richMessageReading.errorAnswer);
  }
  const formattedTextReading = readSpecifiedFormattedText(
    { text, parseMode, entities },
    invalidParametersDescription,
  );
  return formattedTextReading.read
    ? proceedWith({
      parameters,
      content: { kind: 'text', ...formattedTextReading.formattedText },
    })
    : answerWith(formattedTextReading.errorAnswer);
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
  if (!context.session.lifetime.admitsCommits) {
    return SESSION_ENDED_RESOLUTION;
  }
  return resolution.resolved
    ? { resolved: true, value: { kind: 'rich_message', ...resolution.value } }
    : resolution;
}

/** The step that reads the new caption of `editMessageCaption` and its formatting. */
function readCaptionReplacement<Parameters extends EditParameters>(
  { invalidParametersDescription }: BotApiStepCall<unknown>,
  parameters: Parameters & {
    readonly caption: string;
    readonly parse_mode?: string;
    readonly caption_entities?: readonly unknown[];
  },
): BotApiStepResult<{ readonly parameters: Parameters; readonly caption: SpecifiedFormattedText }> {
  const captionReading = readSpecifiedCaption(parameters, invalidParametersDescription);
  return captionReading.read
    ? proceedWith({ parameters, caption: captionReading.formattedText })
    : answerWith(captionReading.errorAnswer);
}

/**
 * The step that reads the new media of `editMessageMedia`, as the official Bot API server's
 * `process_edit_message_media_query` does: the `media` parameter is read as
 * `readInputMediaParameter` reads it, with its caption reported as media Telegram cannot read.
 */
function readMediaReplacement<Parameters extends EditParameters>(
  { uploadedFiles, invalidParametersDescription }: BotApiStepCall<unknown>,
  parameters: Parameters & { readonly media?: string },
): BotApiStepResult<{
  readonly parameters: Parameters;
  readonly media: UnreadMediaReplacement;
  readonly caption: SpecifiedFormattedText;
}> {
  const mediaReading = readInputMediaParameter(
    parameters.media,
    uploadedFiles,
    invalidParametersDescription,
  );
  if (!mediaReading.read) {
    return answerWithBadRequest(mediaReading.description);
  }
  const captionReading = readEmbeddedFormattedText(
    mediaReading.media.caption,
    invalidParametersDescription,
    describeInputMediaCaptionError,
  );
  return captionReading.read
    ? proceedWith({ parameters, media: mediaReading.media, caption: captionReading.formattedText })
    : answerWithBadRequest(captionReading.description);
}

/**
 * The step that reads where an edit finds the message, as the official Bot API server does: an
 * edit without `chat_id` and without a positive `message_id` addresses an inline message by its
 * `inline_message_id`, which it reports missing as an unspecified message identifier.
 */
function readEditedMessageTarget<Edit extends EditReading>(
  edit: Edit,
): BotApiStepResult<Edit & { readonly target: EditedMessageTarget }> {
  const { chat_id: chatId, message_id: messageId, inline_message_id: inlineMessageId } =
    edit.parameters;
  if (chatId === undefined && messageIdOrNone(messageId) === NO_MESSAGE_ID) {
    return inlineMessageId.length === 0
      ? answerWith(presentFixedBotApiError(BOT_API_ERRORS.messageIdentifierNotSpecified))
      : proceedWith({ ...edit, target: { kind: 'inline_message', inlineMessageId } });
  }
  if (chatId === undefined) {
    return answerWith(presentFixedBotApiError(BOT_API_ERRORS.chatIdEmpty));
  }
  return proceedWith({
    ...edit,
    target: { kind: 'chat_message', chatId, messageId: messageIdOrNone(messageId) },
  });
}

/** The step that reads an edit's new inline keyboard, as `readInlineKeyboardParameter` does. */
function readEditKeyboard<Edit extends EditReading>(
  context: BotApiMethodContext,
  edit: Edit,
): BotApiStepResult<Edit & { readonly inlineKeyboard: InlineKeyboard | undefined }> {
  const keyboardReading = readInlineKeyboardParameter(context, edit.parameters.reply_markup);
  return keyboardReading.read
    ? proceedWith({ ...edit, inlineKeyboard: keyboardReading.inlineKeyboard })
    : answerWith(keyboardReading.errorAnswer);
}

/** The step that reads the new inline keyboard of `stopPoll`'s message. */
function readStopPollKeyboard(
  context: BotApiMethodContext,
  parameters: StopPollParameters,
): BotApiStepResult<StopPollParameters & { readonly inlineKeyboard: InlineKeyboard | undefined }> {
  const keyboardReading = readInlineKeyboardParameter(context, parameters.reply_markup);
  return keyboardReading.read
    ? proceedWith({ ...parameters, inlineKeyboard: keyboardReading.inlineKeyboard })
    : answerWith(keyboardReading.errorAnswer);
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
