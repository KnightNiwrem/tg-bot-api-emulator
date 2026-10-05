import {
  createChatInstance,
  type PrivateConversation,
  type PrivateConversationKey,
} from '../types/virtual_chat.ts';
import type { CanonicalMessageId } from '../types/virtual_message.ts';

/**
 * Stores the private conversations between accounts and bots. A conversation exists once either
 * participant wrote to it, and is started once the account wrote to it, which lets the bot write
 * to the account at any time.
 */
export class PrivateConversationRepository {
  readonly #privateConversationsByAccountId = new Map<number, Map<number, PrivateConversation>>();
  /** The bot IDs of the conversations each account started, keyed by account ID. */
  readonly #startedBotIdsByAccountId = new Map<number, Set<number>>();
  /** Keyed like conversations: by account ID, then by bot ID. */
  readonly #replyInterfaceMessageIdsByAccountId = new Map<
    number,
    Map<number, CanonicalMessageId>
  >();

  /**
   * Records that the account started its conversation with the bot, which creates the
   * conversation unless it exists, and returns the conversation.
   */
  startPrivateConversation(key: PrivateConversationKey): PrivateConversation {
    const conversation = this.openPrivateConversation(key);
    const startedBotIds = this.#startedBotIdsByAccountId.get(key.accountId) ?? new Set<number>();
    startedBotIds.add(key.botId);
    this.#startedBotIdsByAccountId.set(key.accountId, startedBotIds);
    return conversation;
  }

  /** Whether the account started its conversation with the bot. */
  isPrivateConversationStarted({ accountId, botId }: PrivateConversationKey): boolean {
    return this.#startedBotIdsByAccountId.get(accountId)?.has(botId) ?? false;
  }

  /**
   * Returns the conversation of the account and the bot, creating it unless it exists, without
   * recording that the account started it.
   */
  openPrivateConversation(
    input: PrivateConversationKey,
  ): PrivateConversation {
    const existingConversation = this.getPrivateConversation(input);
    if (existingConversation !== undefined) {
      return existingConversation;
    }

    const conversation: PrivateConversation = {
      kind: 'private',
      accountId: input.accountId,
      botId: input.botId,
      chatInstance: createChatInstance(),
    };
    const conversationsByBotId = this.#privateConversationsByAccountId.get(input.accountId) ??
      new Map<number, PrivateConversation>();
    conversationsByBotId.set(input.botId, conversation);
    this.#privateConversationsByAccountId.set(input.accountId, conversationsByBotId);

    return conversation;
  }

  getPrivateConversation(
    { accountId, botId }: PrivateConversationKey,
  ): PrivateConversation | undefined {
    return this.#privateConversationsByAccountId.get(accountId)?.get(botId);
  }

  /**
   * Returns the message whose reply interface the account's client shows in the conversation, as
   * TDLib's `reply_markup_message_id` identifies it, or `undefined` when it shows none.
   */
  getReplyInterfaceMessageId(
    { accountId, botId }: PrivateConversationKey,
  ): CanonicalMessageId | undefined {
    return this.#replyInterfaceMessageIdsByAccountId.get(accountId)?.get(botId);
  }

  /** Records the message whose reply interface the client shows; `undefined` shows none. */
  setReplyInterfaceMessageId(
    { accountId, botId }: PrivateConversationKey,
    messageId: CanonicalMessageId | undefined,
  ): void {
    if (this.getPrivateConversation({ accountId, botId }) === undefined) {
      throw new Error(
        `Private conversation of account ${accountId} and bot ${botId} does not exist`,
      );
    }
    const messageIdsByBotId = this.#replyInterfaceMessageIdsByAccountId.get(accountId) ??
      new Map<number, CanonicalMessageId>();
    if (messageId === undefined) {
      messageIdsByBotId.delete(botId);
    } else {
      messageIdsByBotId.set(botId, messageId);
    }
    this.#replyInterfaceMessageIdsByAccountId.set(accountId, messageIdsByBotId);
  }
}
