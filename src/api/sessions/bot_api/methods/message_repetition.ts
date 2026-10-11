import { z } from 'zod';

import type { BotApiMessageId } from '../../../../types/bot_api.ts';
import type { EmulationSession } from '../../../../types/emulation_session.ts';
import { CHAT_ID_EMPTY_DESCRIPTION } from '../chat_access.ts';
import {
  describeInvalidMethodParameters,
  invalidMethodParametersAnswer,
} from '../errors/invalid_parameters.ts';
import { presentMessageRepetitionFailure } from '../errors/message_repetition_failure_presenter.ts';
import { readSpecifiedCaption } from '../formatted_text_reading.ts';
import { messageEntitiesParameter } from '../message_entities_parameter.ts';
import {
  INVALID_MESSAGE_IDENTIFIER_DESCRIPTION,
  MESSAGE_IDENTIFIERS_NOT_SPECIFIED_DESCRIPTION,
  messageIdOrNone,
  TOO_MANY_MESSAGE_IDENTIFIERS_DESCRIPTION,
} from '../message_identifiers.ts';
import {
  botApiError,
  type BotApiMethod,
  type BotApiMethodAnswer,
  type BotApiMethodContext,
  botApiResult,
} from '../method_call.ts';
import {
  booleanParameter,
  type BotApiRequestParameters,
  integerParameter,
  jsonParameter,
  optionalInt64Identifier,
} from '../request_parameters.ts';
import {
  readSendOptions,
  replyMarkupParametersShape,
  sendOptionsParametersShape,
} from '../send_options.ts';

/** The methods that forward or copy existing messages. */
export const MESSAGE_REPETITION_METHODS: readonly BotApiMethod[] = [
  { name: 'copyMessage', recordsActivity: true, handler: handleCopyMessage },
  { name: 'copyMessages', recordsActivity: true, handler: handleCopyMessages },
  { name: 'forwardMessage', recordsActivity: true, handler: handleForwardMessage },
  { name: 'forwardMessages', recordsActivity: true, handler: handleForwardMessages },
];

/** Telegram's description for a forward or copy that names no chat to repeat from. */
const FROM_CHAT_ID_REQUIRED_DESCRIPTION = 'Bad Request: parameter "from_chat_id" is required';

/** Telegram forwards or copies at most 100 messages in one request. */
const MAX_REPEATED_MESSAGES_COUNT = 100;

/**
 * The second from which a forwarded or copied video plays, which other content ignores. As TDLib's
 * `send_message` reads it, a negative second plays the video from its beginning.
 */
const videoStartTimestampParametersShape = {
  video_start_timestamp: integerParameter(z.int().transform((seconds) => Math.max(seconds, 0)))
    .optional(),
};

// As for sending, an `@username` chat_id or from_chat_id reaches here already resolved by
// `resolveChatUsernameParameters`. Topics, paid broadcasts, and suggested posts are not supported.
const forwardMessageParametersSchema = z.strictObject({
  chat_id: integerParameter(z.int()).optional(),
  from_chat_id: integerParameter(z.int()).optional(),
  message_id: integerParameter(z.int()).optional(),
  ...videoStartTimestampParametersShape,
  disable_notification: booleanParameter().default(false),
  protect_content: booleanParameter().default(false),
  message_effect_id: optionalInt64Identifier().optional(),
});

// A caption, even an empty one, replaces the caption of copied media; without one, its parse mode
// and entities are ignored, as on Telegram.
const copyMessageParametersSchema = z.strictObject({
  ...sendOptionsParametersShape,
  ...replyMarkupParametersShape,
  from_chat_id: integerParameter(z.int()).optional(),
  message_id: integerParameter(z.int()).optional(),
  ...videoStartTimestampParametersShape,
  caption: z.string().optional(),
  parse_mode: z.string().optional(),
  caption_entities: messageEntitiesParameter().optional(),
  show_caption_above_media: booleanParameter().default(false),
});

// As for forwardMessage, topics, paid broadcasts, and suggested posts are not supported. Telegram
// also accepts message identifiers written as strings, as for deleteMessages.
const repeatMessagesParametersShape = {
  chat_id: integerParameter(z.int()).optional(),
  from_chat_id: integerParameter(z.int()).optional(),
  message_ids: jsonParameter(z.array(z.int())).optional(),
  disable_notification: booleanParameter().default(false),
  protect_content: booleanParameter().default(false),
  message_effect_id: optionalInt64Identifier().optional(),
};

const forwardMessagesParametersSchema = z.strictObject(repeatMessagesParametersShape);

const copyMessagesParametersSchema = z.strictObject({
  ...repeatMessagesParametersShape,
  remove_caption: booleanParameter().default(false),
});

/** The messages that `forwardMessages` or `copyMessages` repeats, and the chat they go to. */
type RepeatMessagesRequest = Parameters<EmulationSession['botApi']['forwardMessages']>[1];

function handleForwardMessage(
  context: BotApiMethodContext,
  parameters: BotApiRequestParameters,
): BotApiMethodAnswer {
  const parsedParameters = forwardMessageParametersSchema.safeParse(parameters);
  if (!parsedParameters.success) {
    return invalidMethodParametersAnswer('forwardMessage', parsedParameters.error);
  }
  const {
    chat_id: chatId,
    from_chat_id: fromChatId,
    message_id: messageId,
    video_start_timestamp: videoStartTimestampSeconds,
    disable_notification: isSilent,
    protect_content: isContentProtected,
    message_effect_id: messageEffectId,
  } = parsedParameters.data;
  if (fromChatId === undefined) {
    return botApiError(400, FROM_CHAT_ID_REQUIRED_DESCRIPTION);
  }
  // Telegram looks for the forwarded message before it looks at chat_id; the emulator reports a
  // missing chat_id first.
  if (chatId === undefined) {
    return botApiError(400, CHAT_ID_EMPTY_DESCRIPTION);
  }

  const result = context.session.botApi.forwardMessage(
    context.bot,
    {
      chatId,
      forwardedMessage: { chatId: fromChatId, messageId: messageIdOrNone(messageId) },
      ...(videoStartTimestampSeconds === undefined ? {} : { videoStartTimestampSeconds }),
      isContentProtected,
      isSilent,
      messageEffectId,
    },
  );
  return result.sent
    ? botApiResult(result.message)
    : presentMessageRepetitionFailure('message_forward', result);
}

function handleCopyMessage(
  context: BotApiMethodContext,
  parameters: BotApiRequestParameters,
): BotApiMethodAnswer {
  const invalidParametersDescription = describeInvalidMethodParameters('copyMessage');
  const parsedParameters = copyMessageParametersSchema.safeParse(parameters);
  if (!parsedParameters.success) {
    return invalidMethodParametersAnswer('copyMessage', parsedParameters.error);
  }
  const { data } = parsedParameters;
  if (data.from_chat_id === undefined) {
    return botApiError(400, FROM_CHAT_ID_REQUIRED_DESCRIPTION);
  }
  // Telegram reads a new caption and its formatting before it looks at either chat.
  const { caption } = data;
  const captionReading = caption === undefined
    ? undefined
    : readSpecifiedCaption(context, { ...data, caption }, invalidParametersDescription);
  if (captionReading?.read === false) {
    return captionReading.errorAnswer;
  }
  // As for forwardMessage, the emulator reports a missing chat_id before the copied message.
  const optionsReading = readSendOptions(context, data, invalidParametersDescription);
  if (!optionsReading.read) {
    return optionsReading.errorAnswer;
  }

  const result = context.session.botApi.copyMessage(
    context.bot,
    {
      ...optionsReading.options,
      copiedMessage: { chatId: data.from_chat_id, messageId: messageIdOrNone(data.message_id) },
      ...(data.video_start_timestamp === undefined
        ? {}
        : { videoStartTimestampSeconds: data.video_start_timestamp }),
      caption: captionReading?.formattedText,
      showsCaptionAboveMedia: data.show_caption_above_media,
    },
  );
  return result.sent
    ? botApiResult({ message_id: result.messageId } satisfies BotApiMessageId)
    : presentMessageRepetitionFailure('message_copy', result);
}

function handleForwardMessages(
  context: BotApiMethodContext,
  parameters: BotApiRequestParameters,
): BotApiMethodAnswer {
  const parsedParameters = forwardMessagesParametersSchema.safeParse(parameters);
  if (!parsedParameters.success) {
    return invalidMethodParametersAnswer('forwardMessages', parsedParameters.error);
  }
  const reading = readRepeatMessagesRequest(parsedParameters.data);
  if (!reading.read) {
    return reading.errorAnswer;
  }
  return repeatMessagesAnswer(
    'message_forward',
    context.session.botApi.forwardMessages(context.bot, reading.request),
  );
}

function handleCopyMessages(
  context: BotApiMethodContext,
  parameters: BotApiRequestParameters,
): BotApiMethodAnswer {
  const parsedParameters = copyMessagesParametersSchema.safeParse(parameters);
  if (!parsedParameters.success) {
    return invalidMethodParametersAnswer('copyMessages', parsedParameters.error);
  }
  const reading = readRepeatMessagesRequest(parsedParameters.data);
  if (!reading.read) {
    return reading.errorAnswer;
  }
  return repeatMessagesAnswer(
    'message_copy',
    context.session.botApi.copyMessages(context.bot, {
      ...reading.request,
      removesCaptions: parsedParameters.data.remove_caption,
    }),
  );
}

/**
 * Reads the messages that `forwardMessages` or `copyMessages` repeats and where to, checking them
 * in the order the official Bot API server does.
 */
function readRepeatMessagesRequest(
  parameters: z.output<z.ZodObject<typeof repeatMessagesParametersShape>>,
):
  | { readonly read: true; readonly request: RepeatMessagesRequest }
  | { readonly read: false; readonly errorAnswer: BotApiMethodAnswer } {
  const {
    chat_id: chatId,
    from_chat_id: fromChatId,
    message_ids: messageIds,
    disable_notification: isSilent,
    protect_content: isContentProtected,
    message_effect_id: messageEffectId,
  } = parameters;
  if (fromChatId === undefined) {
    return { read: false, errorAnswer: botApiError(400, FROM_CHAT_ID_REQUIRED_DESCRIPTION) };
  }
  if (messageIds === undefined || messageIds.length === 0) {
    return {
      read: false,
      errorAnswer: botApiError(400, MESSAGE_IDENTIFIERS_NOT_SPECIFIED_DESCRIPTION),
    };
  }
  if (messageIds.length > MAX_REPEATED_MESSAGES_COUNT) {
    return { read: false, errorAnswer: botApiError(400, TOO_MANY_MESSAGE_IDENTIFIERS_DESCRIPTION) };
  }
  if (messageIds.some((messageId) => messageId <= 0)) {
    return { read: false, errorAnswer: botApiError(400, INVALID_MESSAGE_IDENTIFIER_DESCRIPTION) };
  }
  if (chatId === undefined) {
    return { read: false, errorAnswer: botApiError(400, CHAT_ID_EMPTY_DESCRIPTION) };
  }
  return {
    read: true,
    request: { chatId, fromChatId, messageIds, isContentProtected, isSilent, messageEffectId },
  };
}

/** Telegram's answer to `forwardMessages` or `copyMessages`: the new messages' IDs, or its error. */
function repeatMessagesAnswer(
  operation: 'message_forward' | 'message_copy',
  result: ReturnType<EmulationSession['botApi']['forwardMessages']>,
): BotApiMethodAnswer {
  return result.sent
    ? botApiResult(
      result.messageIds.map((messageId): BotApiMessageId => ({ message_id: messageId })),
    )
    : presentMessageRepetitionFailure(operation, result);
}
