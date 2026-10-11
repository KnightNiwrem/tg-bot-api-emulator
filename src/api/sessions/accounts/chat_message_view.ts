import type { EmulationSession } from '../../../session/emulation_session.ts';
import type { ChatMessage } from '../../../types/virtual_message.ts';

type BotMessageViews = EmulationSession['botMessageViews'];

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

/**
 * Shows a message that a lookup in a supergroup found, as the requesting account sees it, which is
 * how the account routes show supergroup messages.
 *
 * @throws {Error} when the message is a private chat's, which a supergroup never holds.
 */
export function viewSupergroupChatMessageForAccount(
  botMessageViews: BotMessageViews,
  message: ChatMessage,
  accountId: number,
): ReturnType<BotMessageViews['viewSupergroupMessage']> {
  if (message.kind === 'private_message') {
    throw new Error(`A supergroup's lookup found a ${message.kind}`);
  }
  return botMessageViews.viewSupergroupMessage(message, accountId);
}
