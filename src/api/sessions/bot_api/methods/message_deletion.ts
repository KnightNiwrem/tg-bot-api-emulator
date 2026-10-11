import { z } from 'zod';

import { requireSpecifiedChatId } from '../chat_access.ts';
import { presentMessageDeletionFailure } from '../errors/message_deletion_failure_presenter.ts';
import {
  messageIdentifiersParameter,
  messageIdOrNone,
  requireMessageIdentifiers,
} from '../message_identifiers.ts';
import { type BotApiMethod, botApiResult } from '../method_call.ts';
import { commandMethodOfSteps, startSteps } from '../method_steps.ts';
import { integerParameter } from '../request_parameters.ts';

const deleteMessageParametersSchema = z.strictObject({
  chat_id: integerParameter(z.int()).optional(),
  message_id: integerParameter(z.int()).optional(),
});

const deleteMessagesParametersSchema = z.strictObject({
  chat_id: integerParameter(z.int()).optional(),
  message_ids: messageIdentifiersParameter().optional(),
});

/**
 * The methods that delete messages, each executed as a command in its call's transaction. Their
 * steps read the call; finding the chat and the messages, and every check of the bot's right to
 * delete, wait for the call's execution.
 */
export const MESSAGE_DELETION_METHODS: readonly BotApiMethod[] = [
  // Telegram looks at the chat before the message.
  commandMethodOfSteps({
    name: 'deleteMessage',
    recordsActivity: true,
    parameters: deleteMessageParametersSchema,
    steps: ({ parameters }) => startSteps(parameters).andThen(requireSpecifiedChatId),
    execute: (context, { chat_id: chatId, message_id: messageId }) => {
      const result = context.session.botApi.deleteMessage(
        context.bot,
        { chatId, messageId: messageIdOrNone(messageId) },
      );
      return result.deleted ? botApiResult(true) : presentMessageDeletionFailure(result);
    },
  }),
  // As the official server's `process_delete_messages_query` reads them, the message identifiers
  // come before the chat. The call deletes every message or none.
  commandMethodOfSteps({
    name: 'deleteMessages',
    recordsActivity: true,
    parameters: deleteMessagesParametersSchema,
    steps: ({ parameters }) =>
      startSteps(parameters).andThen(requireMessageIdentifiers).andThen(requireSpecifiedChatId),
    execute: (context, { chat_id: chatId, message_ids: messageIds }) => {
      const result = context.session.botApi.deleteMessages(context.bot, { chatId, messageIds });
      return result.deleted ? botApiResult(true) : presentMessageDeletionFailure(result);
    },
  }),
];
