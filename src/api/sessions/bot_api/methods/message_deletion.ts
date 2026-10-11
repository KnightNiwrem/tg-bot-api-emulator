import { z } from 'zod';

import { getBotApiChatAddress } from '../../../../types/virtual_chat.ts';
import { excludeMissingBotFailure } from '../authenticated_bot_failures.ts';
import { requireSpecifiedChatId } from '../chat_access.ts';
import {
  type MessageListDeletionFailure,
  presentMessageDeletionFailure,
} from '../errors/message_deletion_failure_presenter.ts';
import {
  messageIdentifiersParameter,
  messageIdOrNone,
  requireMessageIdentifiers,
} from '../message_identifiers.ts';
import { type BotApiFamilyContext, type BotApiMethod, botApiResult } from '../method_call.ts';
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

/** What the message deletion methods use: the service that deletes chats' messages. */
type MessageDeletionContext = BotApiFamilyContext<'messageDeletion'>;

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
    // Unlike `deleteMessages`, it fails when the ID identifies no message of the chat, as on
    // Telegram.
    execute: (context: MessageDeletionContext, { chat_id: chatId, message_id: messageId }) => {
      const result = deleteChatMessages(context, chatId, [messageIdOrNone(messageId)]);
      if (!result.deleted) {
        return presentMessageDeletionFailure(result);
      }
      return result.deletedMessageCount === 0
        ? presentMessageDeletionFailure({ deleted: false, reason: 'message_not_found' })
        : botApiResult(true);
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
    // As on Telegram, IDs that identify no message of the chat are skipped.
    execute: (context: MessageDeletionContext, { chat_id: chatId, message_ids: messageIds }) => {
      const result = deleteChatMessages(context, chatId, messageIds);
      return result.deleted ? botApiResult(true) : presentMessageDeletionFailure(result);
    },
  }),
];

/**
 * Deletes messages of a chat: in a private chat, messages of either participant; in a supergroup,
 * the bot's own messages, or any message as an administrator with the `can_delete_messages`
 * right, as `MessageDeletionService.deleteChatMessages` deletes them.
 */
function deleteChatMessages(
  context: MessageDeletionContext,
  chatId: number,
  messageIds: readonly number[],
):
  | { readonly deleted: true; readonly deletedMessageCount: number }
  | MessageListDeletionFailure {
  const result = context.session.messageDeletion.deleteChatMessages({
    fromBotId: context.bot.id,
    chat: getBotApiChatAddress(chatId),
    messageIds,
  });
  return result.deleted
    ? result
    : { deleted: false, reason: excludeMissingBotFailure(context.bot, result.reason) };
}
