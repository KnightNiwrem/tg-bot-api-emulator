import { z } from 'zod';

import type { EmulationSession } from '../../../../types/emulation_session.ts';
import { CHAT_ID_EMPTY_DESCRIPTION } from '../chat_access.ts';
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
import { sendMethodAnswer } from '../send_answer.ts';
import {
  readSendOptions,
  replyMarkupParametersShape,
  sendOptionsParametersShape,
} from '../send_options.ts';

/** The methods that forward or copy existing messages. */
export const MESSAGE_REPETITION_METHODS: readonly BotApiMethod[] = [
  { name: 'copyMessage', handler: handleCopyMessage },
  { name: 'copyMessages', handler: handleCopyMessages },
  { name: 'forwardMessage', handler: handleForwardMessage },
  { name: 'forwardMessages', handler: handleForwardMessages },
];

/** TDLib's description for a message effect in a request that cannot use one. */
const MESSAGE_EFFECT_NOT_ALLOWED_IN_METHOD_DESCRIPTION =
  "Bad Request: can't use message effects in the method";

/** Telegram's descriptions for rejected forwards and copies of messages. */
const FROM_CHAT_ID_REQUIRED_DESCRIPTION = 'Bad Request: parameter "from_chat_id" is required';
const MESSAGE_TO_FORWARD_NOT_FOUND_DESCRIPTION = 'Bad Request: message to forward not found';
const MESSAGE_TO_COPY_NOT_FOUND_DESCRIPTION = 'Bad Request: message to copy not found';
const MESSAGE_NOT_FORWARDABLE_DESCRIPTION = "Bad Request: the message can't be forwarded";
const MESSAGE_NOT_COPYABLE_DESCRIPTION = "Bad Request: the message can't be copied";
/** TDLib words these alike for forwardMessages and copyMessages, which both forward in TDLib. */
const NO_MESSAGES_TO_FORWARD_DESCRIPTION = 'Bad Request: there are no messages to forward';
const MESSAGE_IDS_NOT_INCREASING_DESCRIPTION =
  'Bad Request: message identifiers must be in a strictly increasing order';
const MESSAGES_NOT_FORWARDABLE_DESCRIPTION = "Bad Request: messages can't be forwarded";

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

type RepeatMessagesResult =
  | ReturnType<EmulationSession['botApi']['forwardMessages']>
  | ReturnType<EmulationSession['botApi']['copyMessages']>;

function handleForwardMessage(
  context: BotApiMethodContext,
  parameters: BotApiRequestParameters,
): BotApiMethodAnswer {
  const parsedParameters = forwardMessageParametersSchema.safeParse(parameters);
  if (!parsedParameters.success) {
    return botApiError(400, 'Bad Request: invalid forwardMessage parameters');
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
  if (result.sent) {
    return sendMethodAnswer(result);
  }
  switch (result.reason) {
    case 'repeated_message_not_found':
      return botApiError(400, MESSAGE_TO_FORWARD_NOT_FOUND_DESCRIPTION);
    case 'message_not_forwardable':
      return botApiError(400, MESSAGE_NOT_FORWARDABLE_DESCRIPTION);
    default:
      return sendMethodAnswer(result);
  }
}

function handleCopyMessage(
  context: BotApiMethodContext,
  parameters: BotApiRequestParameters,
): BotApiMethodAnswer {
  const invalidParametersDescription = 'Bad Request: invalid copyMessage parameters';
  const parsedParameters = copyMessageParametersSchema.safeParse(parameters);
  if (!parsedParameters.success) {
    return botApiError(400, invalidParametersDescription);
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
  if (result.sent) {
    return botApiResult({ message_id: result.messageId });
  }
  switch (result.reason) {
    case 'repeated_message_not_found':
      return botApiError(400, MESSAGE_TO_COPY_NOT_FOUND_DESCRIPTION);
    case 'message_not_copyable':
      return botApiError(400, MESSAGE_NOT_COPYABLE_DESCRIPTION);
    default:
      return sendMethodAnswer(result);
  }
}

function handleForwardMessages(
  context: BotApiMethodContext,
  parameters: BotApiRequestParameters,
): BotApiMethodAnswer {
  const parsedParameters = forwardMessagesParametersSchema.safeParse(parameters);
  if (!parsedParameters.success) {
    return botApiError(400, 'Bad Request: invalid forwardMessages parameters');
  }
  const reading = readRepeatMessagesRequest(parsedParameters.data);
  if (!reading.read) {
    return reading.errorAnswer;
  }
  return repeatMessagesAnswer(context.session.botApi.forwardMessages(context.bot, reading.request));
}

function handleCopyMessages(
  context: BotApiMethodContext,
  parameters: BotApiRequestParameters,
): BotApiMethodAnswer {
  const parsedParameters = copyMessagesParametersSchema.safeParse(parameters);
  if (!parsedParameters.success) {
    return botApiError(400, 'Bad Request: invalid copyMessages parameters');
  }
  const reading = readRepeatMessagesRequest(parsedParameters.data);
  if (!reading.read) {
    return reading.errorAnswer;
  }
  return repeatMessagesAnswer(
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

function repeatMessagesAnswer(result: RepeatMessagesResult): BotApiMethodAnswer {
  if (result.sent) {
    return botApiResult(result.messageIds.map((messageId) => ({ message_id: messageId })));
  }
  switch (result.reason) {
    case 'repeated_messages_not_found':
      return botApiError(400, NO_MESSAGES_TO_FORWARD_DESCRIPTION);
    case 'message_effect_not_allowed_for_several_messages':
      return botApiError(400, MESSAGE_EFFECT_NOT_ALLOWED_IN_METHOD_DESCRIPTION);
    case 'repeated_message_ids_not_increasing':
      return botApiError(400, MESSAGE_IDS_NOT_INCREASING_DESCRIPTION);
    case 'messages_not_repeatable':
      return botApiError(400, MESSAGES_NOT_FORWARDABLE_DESCRIPTION);
    default:
      return sendMethodAnswer(result);
  }
}
