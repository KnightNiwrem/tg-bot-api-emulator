import type { ChatMembership } from '../types/chat_membership.ts';
import type { VirtualAccount } from '../types/virtual_account.ts';
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

/** A message as an account addresses it. */
export interface AccountChatMessageKey {
  readonly accountId: number;
  readonly chat: AccountMessageChat;
  /** The ID of the message, as the chat numbers it for its bots. */
  readonly messageId: number;
}

/**
 * Why an account cannot reach a message: the account or the bot of a private chat does not exist,
 * the supergroup does not exist or the account is no member of it, or the chat has no such message
 * for the account, as a private chat with a bot that never wrote to the account has none.
 */
export type AccountChatMessageLookupFailureReason =
  | 'account_not_found'
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

/**
 * Reads messages as an account reads them: a message of its private chat with a bot, or of a
 * supergroup it is a member of. The features that act on a message, such as pressing its buttons,
 * voting in its poll or forwarding it, apply their own rules to what the reader finds.
 */
export interface AccountChatMessageReader {
  findMessage(key: AccountChatMessageKey): AccountChatMessageLookupResult;
}

interface AccountLookup {
  getById(accountId: number): VirtualAccount | undefined;
}

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

/** The stores in which an account's message lookup finds accounts, chats and messages. */
export interface AccountChatMessageStores {
  readonly accounts: AccountLookup;
  readonly bots: BotLookup;
  readonly privateConversations: PrivateConversationLookup;
  readonly privateMessages: PrivateMessageLookup;
  readonly sharedChats: SupergroupLookup;
  readonly supergroupMessages: SupergroupMessageLookup;
}

/**
 * Creates the reader of a session's messages for its accounts. The account must exist. In a
 * private chat, the bot must exist, and the account finds messages once the conversation exists:
 * once the account started it, or once the bot wrote to it under a join request's contact grant,
 * which opens the conversation without starting it. In a supergroup, the account must be a current
 * member.
 */
export function createAccountChatMessageReader(
  stores: AccountChatMessageStores,
): AccountChatMessageReader {
  return {
    findMessage: ({ accountId, chat, messageId }) => {
      if (stores.accounts.getById(accountId) === undefined) {
        return { found: false, reason: 'account_not_found' };
      }
      return chat.type === 'private'
        ? findPrivateChatMessage(stores, { accountId, botId: chat.botId }, messageId)
        : findSupergroupMessage(stores, accountId, chat.chatId, messageId);
    },
  };
}

function findPrivateChatMessage(
  { bots, privateConversations, privateMessages }: AccountChatMessageStores,
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
  { sharedChats, supergroupMessages }: AccountChatMessageStores,
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
