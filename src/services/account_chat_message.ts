import type { ChatMembership } from '../types/chat_membership.ts';
import type { VirtualBot } from '../types/virtual_bot.ts';
import type {
  PrivateConversation,
  PrivateConversationKey,
  SharedChat,
  Supergroup,
} from '../types/virtual_chat.ts';
import type { ChatMessage, PrivateMessage, SupergroupMessage } from '../types/virtual_message.ts';

/**
 * A chat as an account addresses one of its messages: its private chat with a bot, where the bot's
 * message box numbers messages, or a supergroup, which numbers its own messages.
 */
export type AccountMessageChat =
  | { readonly type: 'private'; readonly botId: number }
  | { readonly type: 'supergroup'; readonly chatId: number };

/**
 * Why an account cannot reach a message: the bot of a private chat does not exist, the supergroup
 * does not exist or the account is no member of it, or the chat has no such message for the
 * account, as its private chat with a bot it has not started has none.
 */
export type AccountChatMessageLookupFailureReason =
  | 'bot_not_found'
  | 'chat_not_found'
  | 'not_a_member'
  | 'message_not_found';

/** A message an account reached, with the private conversation or supergroup that holds it. */
export type AccountChatMessageLookupResult =
  | {
    readonly found: true;
    readonly message: ChatMessage;
    readonly chat: PrivateConversation | Supergroup;
  }
  | { readonly found: false; readonly reason: AccountChatMessageLookupFailureReason };

interface BotLookup {
  getById(botId: number): VirtualBot | undefined;
}

interface PrivateConversationLookup {
  getPrivateConversation(key: PrivateConversationKey): PrivateConversation | undefined;
}

interface PrivateMessageLookup {
  getPrivateMessageByBotMessageId(
    conversation: PrivateConversationKey,
    botMessageId: number,
  ): PrivateMessage | undefined;
}

interface SupergroupLookup {
  getSharedChat(chatId: number): SharedChat | undefined;
  getChatMembership(chatId: number, identityId: number): ChatMembership | undefined;
}

interface SupergroupMessageLookup {
  getMessageByChatMessageId(chatId: number, messageId: number): SupergroupMessage | undefined;
}

/** The stores in which an account's message lookup finds chats, memberships and messages. */
export interface AccountChatMessageLookups {
  readonly bots: BotLookup;
  readonly privateConversations: PrivateConversationLookup;
  readonly privateMessages: PrivateMessageLookup;
  readonly sharedChats: SupergroupLookup;
  readonly supergroupMessages: SupergroupMessageLookup;
}

/**
 * Finds a message of a chat an account can reach, by the ID the chat numbers it with for its bots.
 * In a private chat, the bot must exist, and the account finds messages only once it has started
 * the chat. In a supergroup, the account must be a current member. The account itself is assumed
 * to exist.
 */
export function findAccountChatMessage(
  lookups: AccountChatMessageLookups,
  accountId: number,
  chat: AccountMessageChat,
  messageId: number,
): AccountChatMessageLookupResult {
  return chat.type === 'private'
    ? findPrivateChatMessage(lookups, { accountId, botId: chat.botId }, messageId)
    : findSupergroupMessage(lookups, accountId, chat.chatId, messageId);
}

function findPrivateChatMessage(
  { bots, privateConversations, privateMessages }: AccountChatMessageLookups,
  conversationKey: PrivateConversationKey,
  botMessageId: number,
): AccountChatMessageLookupResult {
  if (bots.getById(conversationKey.botId) === undefined) {
    return { found: false, reason: 'bot_not_found' };
  }
  const conversation = privateConversations.getPrivateConversation(conversationKey);
  const message = conversation === undefined
    ? undefined
    : privateMessages.getPrivateMessageByBotMessageId(conversationKey, botMessageId);
  if (conversation === undefined || message === undefined) {
    return { found: false, reason: 'message_not_found' };
  }
  return { found: true, message, chat: conversation };
}

function findSupergroupMessage(
  { sharedChats, supergroupMessages }: AccountChatMessageLookups,
  accountId: number,
  chatId: number,
  messageId: number,
): AccountChatMessageLookupResult {
  const supergroup = sharedChats.getSharedChat(chatId);
  if (supergroup?.kind !== 'supergroup') {
    return { found: false, reason: 'chat_not_found' };
  }
  if (sharedChats.getChatMembership(chatId, accountId) === undefined) {
    return { found: false, reason: 'not_a_member' };
  }
  const message = supergroupMessages.getMessageByChatMessageId(chatId, messageId);
  if (message === undefined) {
    return { found: false, reason: 'message_not_found' };
  }
  return { found: true, message, chat: supergroup };
}
