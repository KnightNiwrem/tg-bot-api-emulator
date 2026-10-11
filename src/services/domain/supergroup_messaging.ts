import {
  resolveSupergroupBotMembership,
  type SupergroupBotAccessFailureReason,
  type SupergroupMembershipLookup,
} from '../../types/chat_membership.ts';
import type { VirtualAccount } from '../../types/virtual_account.ts';
import type { VirtualBot } from '../../types/virtual_bot.ts';
import type {
  Supergroup,
  SupergroupChatAddress,
  SupergroupChatKey,
} from '../../types/virtual_chat.ts';
import type { CanonicalMessageId, SupergroupMessage } from '../../types/virtual_message.ts';

export interface CheckSupergroupBotChatActionAccessInput {
  readonly fromBotId: number;
  readonly chat: SupergroupChatAddress;
}

export type CheckSupergroupBotChatActionAccessResult =
  | { readonly allowed: true }
  | {
    readonly allowed: false;
    readonly reason: 'bot_not_found' | SupergroupBotAccessFailureReason;
  };

export interface GetSupergroupMessageForBotInput {
  readonly botId: number;
  readonly chat: SupergroupChatAddress;
  /** The supergroup's ID of the message. */
  readonly messageId: number;
}

export type GetSupergroupMessageForBotResult =
  | { readonly found: true; readonly message: SupergroupMessage; readonly supergroup: Supergroup }
  | {
    readonly found: false;
    readonly reason: 'bot_not_found' | SupergroupBotAccessFailureReason | 'message_not_found';
  };

export interface GetSupergroupMessageHistoryInput {
  readonly accountId: number;
  readonly chatId: number;
}

export type GetSupergroupMessageHistoryResult =
  | { readonly found: true; readonly messages: readonly SupergroupMessage[] }
  | {
    readonly found: false;
    readonly reason: 'account_not_found' | 'chat_not_found' | 'not_a_member';
  };

interface AccountLookup {
  getById(accountId: number): VirtualAccount | undefined;
}

interface BotLookup {
  getById(botId: number): VirtualBot | undefined;
}

interface SupergroupMessageStore {
  findChatMessage(
    chat: SupergroupChatKey,
    messageId: CanonicalMessageId,
  ): SupergroupMessage | undefined;
  getChatMessages(chat: SupergroupChatKey): readonly SupergroupMessage[];
}

interface MessageBoxLookup {
  getCanonicalMessageId(ownerId: number, messageId: number): CanonicalMessageId | undefined;
}

interface SupergroupMessagingServiceDependencies {
  readonly accounts: AccountLookup;
  readonly bots: BotLookup;
  readonly sharedChats: SupergroupMembershipLookup;
  readonly messages: SupergroupMessageStore;
  readonly messageBoxes: MessageBoxLookup;
}

/**
 * Reads the messages of supergroups as their members do, by the IDs the supergroup's own message
 * box gave them, and decides whether a bot may show a chat action there. Only members read a
 * supergroup's messages. `MessageSendingService` sends, `MessageEditingService` edits, and
 * `MessageDeletionService` deletes, the messages of supergroups, as they do those of every chat
 * type.
 *
 * Results carry canonical messages; presenting them to an observer is left to the caller.
 */
export class SupergroupMessagingService {
  readonly #accounts: AccountLookup;
  readonly #bots: BotLookup;
  readonly #sharedChats: SupergroupMembershipLookup;
  readonly #messages: SupergroupMessageStore;
  readonly #messageBoxes: MessageBoxLookup;

  constructor(
    { accounts, bots, sharedChats, messages, messageBoxes }: SupergroupMessagingServiceDependencies,
  ) {
    this.#accounts = accounts;
    this.#bots = bots;
    this.#sharedChats = sharedChats;
    this.#messages = messages;
    this.#messageBoxes = messageBoxes;
  }

  /**
   * Checks that a bot may show a chat action, such as typing, to a supergroup: it must be a member.
   * The caller records the action members' clients show.
   */
  checkBotChatActionAccess(
    { fromBotId, chat }: CheckSupergroupBotChatActionAccessInput,
  ): CheckSupergroupBotChatActionAccessResult {
    if (this.#bots.getById(fromBotId) === undefined) {
      return { allowed: false, reason: 'bot_not_found' };
    }
    const resolution = resolveSupergroupBotMembership(this.#sharedChats, fromBotId, chat.chatId);
    return resolution.resolved ? { allowed: true } : { allowed: false, reason: resolution.reason };
  }

  /** Returns the supergroup's messages, oldest first, to an account that is a member of it. */
  getMessageHistory(
    { accountId, chatId }: GetSupergroupMessageHistoryInput,
  ): GetSupergroupMessageHistoryResult {
    if (this.#accounts.getById(accountId) === undefined) {
      return { found: false, reason: 'account_not_found' };
    }
    const chat = this.#sharedChats.getSharedChat(chatId);
    if (chat?.kind !== 'supergroup') {
      return { found: false, reason: 'chat_not_found' };
    }
    if (this.#sharedChats.getChatMembership(chatId, accountId) === undefined) {
      return { found: false, reason: 'not_a_member' };
    }
    return {
      found: true,
      messages: this.#messages.getChatMessages({ type: 'supergroup', chatId }),
    };
  }

  /**
   * Finds a message of a supergroup the bot is a member of, as the bot addresses a message it
   * forwards or copies.
   */
  getMessageForBot(
    { botId, chat, messageId }: GetSupergroupMessageForBotInput,
  ): GetSupergroupMessageForBotResult {
    if (this.#bots.getById(botId) === undefined) {
      return { found: false, reason: 'bot_not_found' };
    }
    const access = resolveSupergroupBotMembership(this.#sharedChats, botId, chat.chatId);
    if (!access.resolved) {
      return { found: false, reason: access.reason };
    }
    const message = this.getMessageByChatMessageId(chat.chatId, messageId);
    return message === undefined
      ? { found: false, reason: 'message_not_found' }
      : { found: true, message, supergroup: access.supergroup };
  }

  /** Finds a message of a supergroup by the ID the supergroup's message box gave it. */
  getMessageByChatMessageId(
    chatId: number,
    messageId: number,
  ): SupergroupMessage | undefined {
    const canonicalMessageId = this.#messageBoxes.getCanonicalMessageId(chatId, messageId);
    return canonicalMessageId === undefined
      ? undefined
      : this.#messages.findChatMessage({ type: 'supergroup', chatId }, canonicalMessageId);
  }
}
