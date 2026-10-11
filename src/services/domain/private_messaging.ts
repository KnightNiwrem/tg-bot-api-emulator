import type { VirtualAccount } from '../../types/virtual_account.ts';
import type { VirtualBot } from '../../types/virtual_bot.ts';
import type {
  PrivateChatKey,
  PrivateConversation,
  PrivateConversationKey,
} from '../../types/virtual_chat.ts';
import type { CanonicalMessageId, PrivateMessage } from '../../types/virtual_message.ts';

export type PrivateConversationActivationFailureReason =
  | 'account_not_found'
  | 'bot_not_found';

export type PrivateConversationActivationResult =
  | {
    readonly activated: true;
    readonly conversation: PrivateConversation;
  }
  | {
    readonly activated: false;
    readonly reason: PrivateConversationActivationFailureReason;
  };

/** A bot's private chat, identified by the account at its other end. */
export interface BotPrivateChat {
  readonly type: 'private';
  readonly accountId: number;
}

export interface CheckBotChatActionAccessInput {
  readonly fromBotId: number;
  readonly to: BotPrivateChat;
}

export type CheckBotChatActionAccessResult =
  | { readonly allowed: true }
  | {
    readonly allowed: false;
    readonly reason:
      | 'bot_not_found'
      | 'account_not_found'
      | 'conversation_not_started'
      | 'bot_blocked';
  };

export interface GetMessageForBotInput {
  readonly botId: number;
  /** The account at the other end of the bot's private chat. */
  readonly accountId: number;
  /** The message's ID in the bot's message box. */
  readonly botMessageId: number;
}

export type GetMessageForBotResult =
  | { readonly found: true; readonly message: PrivateMessage }
  | {
    readonly found: false;
    readonly reason:
      | 'bot_not_found'
      | 'account_not_found'
      | 'conversation_not_started'
      | 'message_not_found';
  };

export interface GetPrivateMessageHistoryInput {
  readonly accountId: number;
  readonly botId: number;
}

export type GetPrivateMessageHistoryResult =
  | {
    readonly found: true;
    readonly messages: readonly PrivateMessage[];
  }
  | {
    readonly found: false;
    readonly reason: 'account_not_found' | 'bot_not_found';
  };

interface AccountLookup {
  getById(accountId: number): VirtualAccount | undefined;
}

interface BotLookup {
  getById(botId: number): VirtualBot | undefined;
}

interface PrivateConversationStore {
  startPrivateConversation(key: PrivateConversationKey): PrivateConversation;
  isPrivateConversationStarted(key: PrivateConversationKey): boolean;
}

interface PrivateMessageStore {
  findChatMessage(chat: PrivateChatKey, messageId: CanonicalMessageId): PrivateMessage | undefined;
  getChatMessages(chat: PrivateChatKey): readonly PrivateMessage[];
}

interface MessageBoxLookup {
  getCanonicalMessageId(ownerId: number, messageId: number): CanonicalMessageId | undefined;
}

interface BlockedUserLookup {
  isBlocked(accountId: number, userId: number): boolean;
}

interface PrivateMessagingServiceDependencies {
  readonly accounts: AccountLookup;
  readonly bots: BotLookup;
  readonly privateConversations: PrivateConversationStore;
  readonly messages: PrivateMessageStore;
  readonly messageBoxes: MessageBoxLookup;
  readonly blockedUsers: BlockedUserLookup;
}

/**
 * Reads the private conversations between accounts and bots: whether an account started one, the
 * messages a bot or an account finds there, and whether a bot may show a chat action. An account
 * starts a conversation by writing to the bot or as a test arranges it.
 * `MessageSendingService` sends, `MessageEditingService` edits, and `MessageDeletionService`
 * deletes, the messages of private chats, as they do those of every chat type.
 *
 * Results carry canonical messages; presenting them to an observer, such as through the Bot API,
 * is left to the caller.
 */
export class PrivateMessagingService {
  readonly #accounts: AccountLookup;
  readonly #bots: BotLookup;
  readonly #privateConversations: PrivateConversationStore;
  readonly #messages: PrivateMessageStore;
  readonly #messageBoxes: MessageBoxLookup;
  readonly #blockedUsers: BlockedUserLookup;

  constructor(
    {
      accounts,
      bots,
      privateConversations,
      messages,
      messageBoxes,
      blockedUsers,
    }: PrivateMessagingServiceDependencies,
  ) {
    this.#accounts = accounts;
    this.#bots = bots;
    this.#privateConversations = privateConversations;
    this.#messages = messages;
    this.#messageBoxes = messageBoxes;
    this.#blockedUsers = blockedUsers;
  }

  activatePrivateConversation(
    input: PrivateConversationKey,
  ): PrivateConversationActivationResult {
    if (this.#accounts.getById(input.accountId) === undefined) {
      return { activated: false, reason: 'account_not_found' };
    }
    if (this.#bots.getById(input.botId) === undefined) {
      return { activated: false, reason: 'bot_not_found' };
    }

    return {
      activated: true,
      conversation: this.#privateConversations.startPrivateConversation(input),
    };
  }

  /**
   * Whether the account has started a private conversation with the bot, which makes the private
   * chat known to the bot.
   */
  isPrivateConversationStarted(key: PrivateConversationKey): boolean {
    return this.#privateConversations.isPrivateConversationStarted(key);
  }

  /**
   * Checks that a bot may show a chat action, such as typing, to an account. As for messages, the
   * account must have started a conversation with the bot and not block it. TDLib sends a bot's
   * message drafts as chat actions too, so they need the same access. The caller records what the
   * account's client shows.
   */
  checkBotChatActionAccess(
    { fromBotId, to }: CheckBotChatActionAccessInput,
  ): CheckBotChatActionAccessResult {
    if (this.#bots.getById(fromBotId) === undefined) {
      return { allowed: false, reason: 'bot_not_found' };
    }
    if (this.#accounts.getById(to.accountId) === undefined) {
      return { allowed: false, reason: 'account_not_found' };
    }
    if (
      !this.#privateConversations.isPrivateConversationStarted({
        accountId: to.accountId,
        botId: fromBotId,
      })
    ) {
      return { allowed: false, reason: 'conversation_not_started' };
    }
    return this.#blockedUsers.isBlocked(to.accountId, fromBotId)
      ? { allowed: false, reason: 'bot_blocked' }
      : { allowed: true };
  }

  /**
   * Finds a message of a private conversation by its ID in the bot's message box. A bot numbers
   * the messages of all its chats in one box, so an ID from another chat finds nothing.
   */
  getPrivateMessageByBotMessageId(
    conversation: PrivateConversationKey,
    botMessageId: number,
  ): PrivateMessage | undefined {
    const canonicalMessageId = this.#messageBoxes.getCanonicalMessageId(
      conversation.botId,
      botMessageId,
    );
    return canonicalMessageId === undefined
      ? undefined
      : this.#messages.findChatMessage({ type: 'private', conversation }, canonicalMessageId);
  }

  /**
   * Finds a message of the bot's private chat with an account by its ID in the bot's message box,
   * as the bot addresses a message it forwards or copies. The chat is known to the bot only once
   * the account has started a conversation with it.
   */
  getMessageForBot(
    { botId, accountId, botMessageId }: GetMessageForBotInput,
  ): GetMessageForBotResult {
    if (this.#bots.getById(botId) === undefined) {
      return { found: false, reason: 'bot_not_found' };
    }
    if (this.#accounts.getById(accountId) === undefined) {
      return { found: false, reason: 'account_not_found' };
    }
    const conversation: PrivateConversationKey = { accountId, botId };
    if (!this.#privateConversations.isPrivateConversationStarted(conversation)) {
      return { found: false, reason: 'conversation_not_started' };
    }
    const message = this.getPrivateMessageByBotMessageId(conversation, botMessageId);
    return message === undefined
      ? { found: false, reason: 'message_not_found' }
      : { found: true, message };
  }

  getPrivateMessageHistory(
    input: GetPrivateMessageHistoryInput,
  ): GetPrivateMessageHistoryResult {
    const account = this.#accounts.getById(input.accountId);
    if (account === undefined) {
      return { found: false, reason: 'account_not_found' };
    }
    const bot = this.#bots.getById(input.botId);
    if (bot === undefined) {
      return { found: false, reason: 'bot_not_found' };
    }

    return {
      found: true,
      messages: this.#messages.getChatMessages({ type: 'private', conversation: input }),
    };
  }
}
