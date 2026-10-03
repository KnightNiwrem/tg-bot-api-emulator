import type { EmulationSession } from '../../../types/emulation_session.ts';
import type { ChatMessage } from '../../../types/virtual_message.ts';

/**
 * Shows a message as the account routes show messages: a private message as the conversation's bot
 * sees it, and a supergroup message as the requesting account sees it.
 */
export function viewChatMessageForAccount(
  botMessageViews: EmulationSession['botMessageViews'],
  message: ChatMessage,
  accountId: number,
) {
  return message.kind === 'private_message'
    ? botMessageViews.viewPrivateMessageForBot(message)
    : botMessageViews.viewSupergroupMessage(message, accountId);
}
