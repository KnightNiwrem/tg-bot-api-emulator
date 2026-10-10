import { z } from 'zod';

import type { SupergroupBotAccessFailureReason } from '../../../../types/chat_membership.ts';
import {
  BOT_BLOCKED_DESCRIPTION,
  CHAT_ID_EMPTY_DESCRIPTION,
  supergroupBotAccessFailureAnswer,
} from '../chat_access.ts';
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

/**
 * Telegram's descriptions for rejected pins: the official server's `check_message` and
 * `getChatPinnedMessage` failure, TDLib's `can_pin_message` errors, and Telegram's refusal of a pin
 * that changes nothing, which the server passes on.
 */
const MESSAGE_TO_PIN_NOT_FOUND_DESCRIPTION = 'Bad Request: message to pin not found';
const MESSAGE_TO_UNPIN_NOT_FOUND_DESCRIPTION = 'Bad Request: message to unpin not found';
const NOT_ENOUGH_RIGHTS_TO_PIN_DESCRIPTION =
  'Bad Request: not enough rights to manage pinned messages in the chat';
const SERVICE_MESSAGE_NOT_PINNABLE_DESCRIPTION = "Bad Request: service messages can't be pinned";
const PINNED_MESSAGE_NOT_MODIFIED_DESCRIPTION = 'Bad Request: CHAT_NOT_MODIFIED';

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
  if (result.pinned) {
    return botApiResult(true);
  }
  switch (result.reason) {
    case 'message_not_found':
      return botApiError(400, MESSAGE_TO_PIN_NOT_FOUND_DESCRIPTION);
    case 'message_already_pinned':
      return botApiError(400, PINNED_MESSAGE_NOT_MODIFIED_DESCRIPTION);
    default:
      return pinChangeFailureAnswer(result.reason);
  }
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
  if (result.unpinned) {
    return botApiResult(true);
  }
  switch (result.reason) {
    case 'message_not_found':
      return botApiError(400, MESSAGE_TO_UNPIN_NOT_FOUND_DESCRIPTION);
    case 'message_not_pinned':
      return botApiError(400, PINNED_MESSAGE_NOT_MODIFIED_DESCRIPTION);
    default:
      return pinChangeFailureAnswer(result.reason);
  }
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
  return result.unpinned ? botApiResult(true) : pinChangeFailureAnswer(result.reason);
}

/** Telegram's error for a pin or unpin refused for the chat, the bot's rights, or the message. */
function pinChangeFailureAnswer(
  reason:
    | SupergroupBotAccessFailureReason
    | 'bot_blocked'
    | 'not_enough_rights'
    | 'service_message_not_pinnable',
): BotApiMethodAnswer {
  switch (reason) {
    case 'chat_not_found':
    case 'bot_not_a_member':
    case 'bot_kicked':
      return supergroupBotAccessFailureAnswer(reason);
    case 'bot_blocked':
      return botApiError(403, BOT_BLOCKED_DESCRIPTION);
    case 'not_enough_rights':
      return botApiError(400, NOT_ENOUGH_RIGHTS_TO_PIN_DESCRIPTION);
    case 'service_message_not_pinnable':
      return botApiError(400, SERVICE_MESSAGE_NOT_PINNABLE_DESCRIPTION);
    default: {
      const unhandledReason: never = reason;
      throw new Error(`Unhandled pin failure: ${unhandledReason}`);
    }
  }
}
