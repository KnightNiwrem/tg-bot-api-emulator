import { z } from 'zod';

import { CHAT_ID_EMPTY_DESCRIPTION } from '../chat_access.ts';
import { presentMessagePinningFailure } from '../errors/message_pinning_failure_presenter.ts';
import { messageIdOrNone, NO_MESSAGE_ID } from '../message_identifiers.ts';
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
} from '../request_parameters.ts';

/** The methods that pin or unpin a chat's messages. */
export const MESSAGE_PINNING_METHODS: readonly BotApiMethod[] = [
  { name: 'pinChatMessage', recordsActivity: true, handler: handlePinChatMessage },
  { name: 'unpinChatMessage', recordsActivity: true, handler: handleUnpinChatMessage },
  { name: 'unpinAllChatMessages', recordsActivity: true, handler: handleUnpinAllChatMessages },
];

// Business connections are not supported.
const pinChatMessageParametersSchema = z.strictObject({
  chat_id: integerParameter(z.int()).optional(),
  message_id: integerParameter(z.int()).optional(),
  disable_notification: booleanParameter().default(false),
});

// Telegram reads a missing or zero `message_id` as no target, which unpins the newest pinned
// message; it reads a negative one so too, which the emulator rejects to surface the bot's mistake.
const unpinChatMessageParametersSchema = z.strictObject({
  chat_id: integerParameter(z.int()).optional(),
  message_id: integerParameter(z.int().nonnegative()).optional(),
});

const unpinAllChatMessagesParametersSchema = z.strictObject({
  chat_id: integerParameter(z.int()).optional(),
});

function handlePinChatMessage(
  context: BotApiMethodContext,
  parameters: BotApiRequestParameters,
): BotApiMethodAnswer {
  const parsedParameters = pinChatMessageParametersSchema.safeParse(parameters);
  if (!parsedParameters.success) {
    return botApiError(400, 'Bad Request: invalid pinChatMessage parameters');
  }
  const { chat_id: chatId, message_id: messageId, disable_notification: isSilent } =
    parsedParameters.data;
  // Telegram looks at the chat before the message.
  if (chatId === undefined) {
    return botApiError(400, CHAT_ID_EMPTY_DESCRIPTION);
  }

  const result = context.session.botApi.pinChatMessage(context.bot, {
    chatId,
    messageId: messageIdOrNone(messageId),
    isSilent,
  });
  return result.pinned ? botApiResult(true) : presentMessagePinningFailure('message_pin', result);
}

function handleUnpinChatMessage(
  context: BotApiMethodContext,
  parameters: BotApiRequestParameters,
): BotApiMethodAnswer {
  const parsedParameters = unpinChatMessageParametersSchema.safeParse(parameters);
  if (!parsedParameters.success) {
    return botApiError(400, 'Bad Request: invalid unpinChatMessage parameters');
  }
  const { chat_id: chatId, message_id: messageId } = parsedParameters.data;
  if (chatId === undefined) {
    return botApiError(400, CHAT_ID_EMPTY_DESCRIPTION);
  }

  const result = context.session.botApi.unpinChatMessage(context.bot, {
    chatId,
    ...(messageId === undefined || messageId === NO_MESSAGE_ID ? {} : { messageId }),
  });
  return result.unpinned
    ? botApiResult(true)
    : presentMessagePinningFailure('message_unpin', result);
}

function handleUnpinAllChatMessages(
  context: BotApiMethodContext,
  parameters: BotApiRequestParameters,
): BotApiMethodAnswer {
  const parsedParameters = unpinAllChatMessagesParametersSchema.safeParse(parameters);
  if (!parsedParameters.success) {
    return botApiError(400, 'Bad Request: invalid unpinAllChatMessages parameters');
  }
  const { chat_id: chatId } = parsedParameters.data;
  if (chatId === undefined) {
    return botApiError(400, CHAT_ID_EMPTY_DESCRIPTION);
  }

  const result = context.session.botApi.unpinAllChatMessages(context.bot, { chatId });
  return result.unpinned
    ? botApiResult(true)
    : presentMessagePinningFailure('message_unpin', result);
}
