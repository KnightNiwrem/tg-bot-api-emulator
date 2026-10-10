import type {
  ChatIdentification,
  ChatMessageLookup,
  PrivateChatAccessPredicates,
  PrivateChatIdentityPolicy,
} from '../types/chat_policy.ts';
import type { VirtualAccount } from '../types/virtual_account.ts';
import type { VirtualBot } from '../types/virtual_bot.ts';
import type {
  PrivateChatAddress,
  PrivateChatKey,
  PrivateConversation,
  PrivateConversationKey,
} from '../types/virtual_chat.ts';
import type { PrivateMessage } from '../types/virtual_message.ts';

interface AccountLookup {
  getById(accountId: number): VirtualAccount | undefined;
}

interface BotLookup {
  getById(botId: number): VirtualBot | undefined;
}

interface PrivateConversationLookup {
  getPrivateConversation(key: PrivateConversationKey): PrivateConversation | undefined;
  isPrivateConversationStarted(key: PrivateConversationKey): boolean;
}

interface BlockedUserLookup {
  isBlocked(accountId: number, userId: number): boolean;
}

interface JoinRequesterContactLookup {
  mayContactJoinRequester(botId: number, accountId: number): boolean;
}

interface PrivateMessageLookup {
  getPrivateMessageByBotMessageId(
    conversation: PrivateConversationKey,
    botMessageId: number,
  ): PrivateMessage | undefined;
}

interface PrivateChatPolicyDependencies {
  readonly accounts: AccountLookup;
  readonly bots: BotLookup;
  readonly privateConversations: PrivateConversationLookup;
  readonly blockedUsers: BlockedUserLookup;
  readonly joinRequesterContacts: JoinRequesterContactLookup;
  readonly privateMessages: PrivateMessageLookup;
}

/**
 * How accounts and bots reach private chats and their messages: identity, access predicates and
 * message lookup, read from the session's state. `privateChatMessagePolicy` states how private
 * chats number their messages and who learns of them.
 */
export class PrivateChatPolicy
  implements
    PrivateChatIdentityPolicy,
    PrivateChatAccessPredicates,
    ChatMessageLookup<PrivateChatKey, PrivateMessage> {
  readonly #accounts: AccountLookup;
  readonly #bots: BotLookup;
  readonly #privateConversations: PrivateConversationLookup;
  readonly #blockedUsers: BlockedUserLookup;
  readonly #joinRequesterContacts: JoinRequesterContactLookup;
  readonly #privateMessages: PrivateMessageLookup;

  constructor(
    {
      accounts,
      bots,
      privateConversations,
      blockedUsers,
      joinRequesterContacts,
      privateMessages,
    }: PrivateChatPolicyDependencies,
  ) {
    this.#accounts = accounts;
    this.#bots = bots;
    this.#privateConversations = privateConversations;
    this.#blockedUsers = blockedUsers;
    this.#joinRequesterContacts = joinRequesterContacts;
    this.#privateMessages = privateMessages;
  }

  /** An account's private chat is its chat with the bot it names. */
  identifyChatForAccount(
    accountId: number,
    { peerId: botId }: PrivateChatAddress,
  ): ChatIdentification<{ readonly key: PrivateChatKey }, 'bot_not_found'> {
    return this.#bots.getById(botId) === undefined
      ? { identified: false, reason: 'bot_not_found' }
      : { identified: true, key: { type: 'private', conversation: { accountId, botId } } };
  }

  /** A bot's private chat is its chat with the account it names. */
  identifyChatForBot(
    botId: number,
    { peerId: accountId }: PrivateChatAddress,
  ): ChatIdentification<{ readonly key: PrivateChatKey }, 'account_not_found'> {
    return this.#accounts.getById(accountId) === undefined
      ? { identified: false, reason: 'account_not_found' }
      : { identified: true, key: { type: 'private', conversation: { accountId, botId } } };
  }

  findConversation({ conversation }: PrivateChatKey): PrivateConversation | undefined {
    return this.#privateConversations.getPrivateConversation(conversation);
  }

  isConversationStarted({ conversation }: PrivateChatKey): boolean {
    return this.#privateConversations.isPrivateConversationStarted(conversation);
  }

  isBotBlocked({ conversation: { accountId, botId } }: PrivateChatKey): boolean {
    return this.#blockedUsers.isBlocked(accountId, botId);
  }

  mayBotContactJoinRequester({ conversation: { accountId, botId } }: PrivateChatKey): boolean {
    return this.#joinRequesterContacts.mayContactJoinRequester(botId, accountId);
  }

  findMessageByChatMessageId(
    { conversation }: PrivateChatKey,
    chatMessageId: number,
  ): PrivateMessage | undefined {
    return this.#privateMessages.getPrivateMessageByBotMessageId(conversation, chatMessageId);
  }
}
