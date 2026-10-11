import { z } from 'zod';

import { requireSpecifiedChatId } from '../chat_access.ts';
import { presentMessagePinningFailure } from '../errors/message_pinning_failure_presenter.ts';
import { messageIdOrNone, NO_MESSAGE_ID } from '../message_identifiers.ts';
import { type BotApiMethod, botApiResult } from '../method_call.ts';
import { commandMethodOfSteps, startSteps } from '../method_steps.ts';
import { booleanParameter, integerParameter } from '../request_parameters.ts';

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

/**
 * The methods that pin or unpin a chat's messages, each executed as a command in its call's
 * transaction. Their steps read the chat, which Telegram looks at before the message; execution
 * reaches the chat, finds the message, checks the bot's right to pin and changes the chat's pins.
 */
export const MESSAGE_PINNING_METHODS: readonly BotApiMethod[] = [
  commandMethodOfSteps({
    name: 'pinChatMessage',
    recordsActivity: true,
    parameters: pinChatMessageParametersSchema,
    steps: ({ parameters }) => startSteps(parameters).andThen(requireSpecifiedChatId),
    execute: (context, { chat_id: chatId, message_id: messageId, disable_notification }) => {
      const result = context.session.botApi.pinChatMessage(context.bot, {
        chatId,
        messageId: messageIdOrNone(messageId),
        isSilent: disable_notification,
      });
      return result.pinned
        ? botApiResult(true)
        : presentMessagePinningFailure('message_pin', result);
    },
  }),
  commandMethodOfSteps({
    name: 'unpinChatMessage',
    recordsActivity: true,
    parameters: unpinChatMessageParametersSchema,
    steps: ({ parameters }) => startSteps(parameters).andThen(requireSpecifiedChatId),
    execute: (context, { chat_id: chatId, message_id: messageId }) => {
      const result = context.session.botApi.unpinChatMessage(context.bot, {
        chatId,
        ...(messageId === undefined || messageId === NO_MESSAGE_ID ? {} : { messageId }),
      });
      return result.unpinned
        ? botApiResult(true)
        : presentMessagePinningFailure('message_unpin', result);
    },
  }),
  commandMethodOfSteps({
    name: 'unpinAllChatMessages',
    recordsActivity: true,
    parameters: unpinAllChatMessagesParametersSchema,
    steps: ({ parameters }) => startSteps(parameters).andThen(requireSpecifiedChatId),
    execute: (context, { chat_id: chatId }) => {
      const result = context.session.botApi.unpinAllChatMessages(context.bot, { chatId });
      return result.unpinned
        ? botApiResult(true)
        : presentMessagePinningFailure('message_unpin', result);
    },
  }),
];
