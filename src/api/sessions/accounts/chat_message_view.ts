import type { EmulationSession } from '../../../session/emulation_session.ts';
import type { ChatMessage } from '../../../types/virtual_message.ts';

type BotMessageViews = EmulationSession['botMessageViews'];

/**
 * Shows a message as the account routes show messages: a private message as the conversation's bot
 * sees it, and a supergroup message as the requesting account sees it.
 */
export function viewChatMessageForAccount(
  botMessageViews: BotMessageViews,
  message: ChatMessage,
  accountId: number,
) {
  return message.kind === 'private_message'
    ? botMessageViews.viewPrivateMessageForBot(message)
    : botMessageViews.viewSupergroupMessage(message, accountId);
}

/**
 * Shows a message that a lookup in an account's private chat with a bot found, as the bot sees
 * it, which is how the account routes show private messages.
 *
 * @throws {Error} when the message is a supergroup's, which a private chat never holds.
 */
export function viewPrivateChatMessageForBot(
  botMessageViews: BotMessageViews,
  message: ChatMessage,
): ReturnType<BotMessageViews['viewPrivateMessageForBot']> {
  if (message.kind !== 'private_message') {
    throw new Error(`A private chat's lookup found a ${message.kind}`);
  }
  return botMessageViews.viewPrivateMessageForBot(message);
}
