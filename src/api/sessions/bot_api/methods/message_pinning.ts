import { z } from 'zod';

import { CHAT_ID_EMPTY_DESCRIPTION } from '../chat_access.ts';
import { presentMessagePinningFailure } from '../errors/message_pinning_failure_presenter.ts';
import { messageIdOrNone, NO_MESSAGE_ID } from '../message_identifiers.ts';
import {
  answeredPreparation,
  type BotApiCallPreparation,
  botApiError,
  type BotApiMethod,
  type BotApiMethodContext,
  botApiResult,
} from '../method_call.ts';
import {
  booleanParameter,
  type BotApiRequestParameters,
  integerParameter,
} from '../request_parameters.ts';

/**
 * The methods that pin or unpin a chat's messages, each executed as a command in its call's
 * transaction: preparation reads the parameters, and execution reaches the chat, finds the
 * message, checks the bot's right to pin and changes the chat's pins.
 */
export const MESSAGE_PINNING_METHODS: readonly BotApiMethod[] = [
  { name: 'pinChatMessage', recordsActivity: true, prepare: preparePinChatMessage },
  { name: 'unpinChatMessage', recordsActivity: true, prepare: prepareUnpinChatMessage },
  { name: 'unpinAllChatMessages', recordsActivity: true, prepare: prepareUnpinAllChatMessages },
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

function preparePinChatMessage(
  context: BotApiMethodContext,
  parameters: BotApiRequestParameters,
): BotApiCallPreparation {
  const parsedParameters = pinChatMessageParametersSchema.safeParse(parameters);
  if (!parsedParameters.success) {
    return answeredPreparation(botApiError(400, 'Bad Request: invalid pinChatMessage parameters'));
  }
  const { chat_id: chatId, message_id: messageId, disable_notification: isSilent } =
    parsedParameters.data;
  // Telegram looks at the chat before the message.
  if (chatId === undefined) {
    return answeredPreparation(botApiError(400, CHAT_ID_EMPTY_DESCRIPTION));
  }

  return {
    kind: 'command',
    execute: () => {
      const result = context.session.botApi.pinChatMessage(context.bot, {
        chatId,
        messageId: messageIdOrNone(messageId),
        isSilent,
      });
      return result.pinned
        ? botApiResult(true)
        : presentMessagePinningFailure('message_pin', result);
    },
  };
}

function prepareUnpinChatMessage(
  context: BotApiMethodContext,
  parameters: BotApiRequestParameters,
): BotApiCallPreparation {
  const parsedParameters = unpinChatMessageParametersSchema.safeParse(parameters);
  if (!parsedParameters.success) {
    return answeredPreparation(
      botApiError(400, 'Bad Request: invalid unpinChatMessage parameters'),
    );
  }
  const { chat_id: chatId, message_id: messageId } = parsedParameters.data;
  if (chatId === undefined) {
    return answeredPreparation(botApiError(400, CHAT_ID_EMPTY_DESCRIPTION));
  }

  return {
    kind: 'command',
    execute: () => {
      const result = context.session.botApi.unpinChatMessage(context.bot, {
        chatId,
        ...(messageId === undefined || messageId === NO_MESSAGE_ID ? {} : { messageId }),
      });
      return result.unpinned
        ? botApiResult(true)
        : presentMessagePinningFailure('message_unpin', result);
    },
  };
}

function prepareUnpinAllChatMessages(
  context: BotApiMethodContext,
  parameters: BotApiRequestParameters,
): BotApiCallPreparation {
  const parsedParameters = unpinAllChatMessagesParametersSchema.safeParse(parameters);
  if (!parsedParameters.success) {
    return answeredPreparation(
      botApiError(400, 'Bad Request: invalid unpinAllChatMessages parameters'),
    );
  }
  const { chat_id: chatId } = parsedParameters.data;
  if (chatId === undefined) {
    return answeredPreparation(botApiError(400, CHAT_ID_EMPTY_DESCRIPTION));
  }

  return {
    kind: 'command',
    execute: () => {
      const result = context.session.botApi.unpinAllChatMessages(context.bot, { chatId });
      return result.unpinned
        ? botApiResult(true)
        : presentMessagePinningFailure('message_unpin', result);
    },
  };
}
