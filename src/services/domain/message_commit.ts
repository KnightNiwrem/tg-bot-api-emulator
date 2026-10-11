/**
 * Committing messages to their chats: a message that passed its checks is stored, numbered in the
 * message boxes its chat type chooses, emitted, and its change of the reply interface the chat's
 * accounts see is applied, each chat type in its own order. Sending commits the messages senders
 * write, and other features record the service messages of the changes they make.
 *
 * Each commit is one transaction, which joins the transaction of the command that commits the
 * message, so all of it is published together or not at all. A private chat changes the reply
 * interface the account's client shows before it emits the message; a supergroup emits it first
 * and then changes its members' interfaces, as TDLib does. The order decides only what the
 * message's projection sees of the staged state.
 *
 * @module
 */
import type { ChatDomainEvent } from '../../types/chat_domain_event.ts';
import { privateChatMessagePolicy, supergroupMessagePolicy } from '../../types/chat_policy.ts';
import { appliesReplyInterfaceTo } from '../../types/reply_interface.ts';
import type { VirtualAccount } from '../../types/virtual_account.ts';
import type { VirtualBot } from '../../types/virtual_bot.ts';
import type {
  PrivateConversationKey,
  PrivateConversationRole,
  SupergroupChatKey,
} from '../../types/virtual_chat.ts';
import {
  type CanonicalMessageId,
  getMessageSenderId,
  mentionsUser,
  type MessagePinnedContent,
  type NewPrivateMessage,
  type NewSupergroupMessage,
  type PrivateMessage,
  type SupergroupMessage,
  type SupergroupMessageSender,
  type SupergroupServiceContent,
} from '../../types/virtual_message.ts';

/** A change of a private chat that a caller made, recorded as a service message. */
export interface PrivateChatServiceMessageRecord {
  readonly conversation: PrivateConversationKey;
  /** The participant shown as having made the change: the one who pinned a message. */
  readonly sender: PrivateConversationRole;
  /**
   * The pin, the one change a caller records; users and chats an account shares, and data a Web
   * App sends, are sent only through `MessageSendingService.sendAccountPrivateChatServiceMessage`.
   */
  readonly content: MessagePinnedContent;
  /** Whether the service message notifies the other participant without sound. */
  readonly isSilent: boolean;
}

/** A change of a supergroup that a caller made, recorded as a service message. */
export interface SupergroupServiceMessageRecord {
  readonly chatId: number;
  /**
   * The member shown as having made the change: the one who added members, left, removed a
   * member, changed the title, or pinned a message.
   */
  readonly sender: SupergroupMessageSender;
  readonly content: SupergroupServiceContent;
  readonly changedAtUnixSeconds: number;
  /** Notifies the members without sound; omitted for a service message that notifies with sound. */
  readonly isSilent?: boolean;
}

interface AccountLookup {
  getById(accountId: number): VirtualAccount | undefined;
}

interface BotLookup {
  getById(botId: number): VirtualBot | undefined;
}

interface ChatMessageStore {
  addMessage(message: NewPrivateMessage): PrivateMessage;
  addMessage(message: NewSupergroupMessage): SupergroupMessage;
  findChatMessage(
    chat: SupergroupChatKey,
    messageId: CanonicalMessageId,
  ): SupergroupMessage | undefined;
}

interface MessageBoxNumbering {
  assignMessageId(ownerId: number, canonicalMessageId: CanonicalMessageId): number;
}

/** The message whose reply interface an account's client shows in its private chat with a bot. */
interface PrivateReplyInterfaceStore {
  setReplyInterfaceMessageId(
    key: PrivateConversationKey,
    messageId: CanonicalMessageId | undefined,
  ): void;
}

/** The members of supergroups, and the reply interface each account member's client shows. */
interface SupergroupMemberStore {
  getChatMemberIds(chatId: number): readonly number[];
  getReplyInterfaceMessageId(chatId: number, accountId: number): CanonicalMessageId | undefined;
  setReplyInterfaceMessageId(
    chatId: number,
    accountId: number,
    messageId: CanonicalMessageId | undefined,
  ): void;
}

/** The session's transactions: each commit runs in one, and emits its message's event into it. */
interface MessageCommitTransactions {
  /** Runs a command in the transaction of the command executing, or in one of its own. */
  withinTransaction<Result>(command: () => Result): Result;
  emit(event: ChatDomainEvent): void;
}

interface MessageDraftClearing {
  clearBotDraft(conversation: PrivateConversationKey): void;
}

interface MessageCommitterDependencies {
  readonly accounts: AccountLookup;
  readonly bots: BotLookup;
  readonly messages: ChatMessageStore;
  readonly messageBoxes: MessageBoxNumbering;
  readonly privateReplyInterfaces: PrivateReplyInterfaceStore;
  readonly supergroupMembers: SupergroupMemberStore;
  /** Runs each commit as one transaction, which receives the message's event. */
  readonly transactions: MessageCommitTransactions;
  /** Removes the message draft that any message from the bot removes from the chat. */
  readonly messageDrafts: MessageDraftClearing;
  readonly currentUnixTimeSeconds: () => number;
}

/**
 * Commits the messages of every chat type, each in its chat type's order, and records the service
 * messages of changes that other features made. As on Telegram, a service message is numbered
 * like any message.
 */
export class MessageCommitter {
  readonly #accounts: AccountLookup;
  readonly #bots: BotLookup;
  readonly #messages: ChatMessageStore;
  readonly #messageBoxes: MessageBoxNumbering;
  readonly #privateReplyInterfaces: PrivateReplyInterfaceStore;
  readonly #supergroupMembers: SupergroupMemberStore;
  readonly #transactions: MessageCommitTransactions;
  readonly #messageDrafts: MessageDraftClearing;
  readonly #currentUnixTimeSeconds: () => number;

  constructor(
    {
      accounts,
      bots,
      messages,
      messageBoxes,
      privateReplyInterfaces,
      supergroupMembers,
      transactions,
      messageDrafts,
      currentUnixTimeSeconds,
    }: MessageCommitterDependencies,
  ) {
    this.#accounts = accounts;
    this.#bots = bots;
    this.#messages = messages;
    this.#messageBoxes = messageBoxes;
    this.#privateReplyInterfaces = privateReplyInterfaces;
    this.#supergroupMembers = supergroupMembers;
    this.#transactions = transactions;
    this.#messageDrafts = messageDrafts;
    this.#currentUnixTimeSeconds = currentUnixTimeSeconds;
  }

  /**
   * Commits a message of a private conversation: stores it, numbers it in both participants'
   * message boxes, applies its change of the account's reply interface, and then emits it, all in
   * one transaction.
   */
  commitPrivateMessage(message: NewPrivateMessage): PrivateMessage {
    return this.#transactions.withinTransaction(() => {
      const storedMessage = this.#messages.addMessage(message);
      const { chat, replyInterfaceMarkup } = storedMessage;
      // Only the bot's numbering is projected today; the account's keeps the stored model faithful
      // to Telegram.
      for (const boxOwnerId of privateChatMessagePolicy.getNumberingBoxOwnerIds(chat)) {
        this.#messageBoxes.assignMessageId(boxOwnerId, storedMessage.id);
      }
      // As TDLib does for a private chat: a keyboard or forced reply replaces what the client
      // shows, and a removal clears it.
      if (replyInterfaceMarkup !== undefined) {
        this.#privateReplyInterfaces.setReplyInterfaceMessageId(
          chat.conversation,
          replyInterfaceMarkup.kind === 'reply_keyboard_removal' ? undefined : storedMessage.id,
        );
      }
      // As TDLib's `updatePendingMessage` tells clients, any incoming message removes the bot's
      // draft: a sent, forwarded or copied message, an album's, or a service message of its pin.
      if (storedMessage.sender === 'bot') {
        this.#messageDrafts.clearBotDraft(chat.conversation);
      }
      this.#transactions.emit({ type: 'message_created', message: storedMessage });
      return storedMessage;
    });
  }

  /**
   * Commits a message of a supergroup: stores it, numbers it in the supergroup's box, emits it,
   * and then changes the reply interface of the members' clients as it asks, which TDLib does
   * after announcing the message, all in one transaction. `repliedMessage` is the message of the
   * supergroup it replies to.
   */
  commitSupergroupMessage(
    message: NewSupergroupMessage,
    repliedMessage: SupergroupMessage | undefined,
  ): SupergroupMessage {
    return this.#transactions.withinTransaction(() => {
      const storedMessage = this.#messages.addMessage(message);
      for (const boxOwnerId of supergroupMessagePolicy.getNumberingBoxOwnerIds(message.chat)) {
        this.#messageBoxes.assignMessageId(boxOwnerId, storedMessage.id);
      }
      this.#transactions.emit({ type: 'message_created', message: storedMessage });
      this.#updateMemberReplyInterfaces(storedMessage, repliedMessage);
      return storedMessage;
    });
  }

  /**
   * Records a change of a private conversation, which the caller has made, as a service message
   * of the participant who made it, numbered for both participants.
   */
  recordPrivateChatServiceMessage(
    { conversation, sender, content, isSilent }: PrivateChatServiceMessageRecord,
  ): PrivateMessage {
    if (
      this.#accounts.getById(conversation.accountId) === undefined ||
      this.#bots.getById(conversation.botId) === undefined
    ) {
      throw new Error(
        `Participants of conversation ${JSON.stringify(conversation)} do not exist`,
      );
    }
    return this.commitPrivateMessage({
      chat: { type: 'private', conversation },
      sender,
      content,
      isSilent,
      sentAtUnixSeconds: this.#currentUnixTimeSeconds(),
    });
  }

  /**
   * Records a change of a supergroup, which the caller has made, as a service message of the
   * member who made it.
   */
  recordSupergroupServiceMessage(
    { chatId, sender, content, changedAtUnixSeconds, isSilent }: SupergroupServiceMessageRecord,
  ): SupergroupMessage {
    return this.commitSupergroupMessage({
      chat: { type: 'supergroup', chatId },
      sender,
      sentAtUnixSeconds: changedAtUnixSeconds,
      content,
      isSilent,
    }, undefined);
  }

  /**
   * Changes the reply interface each account member's client shows, as TDLib does for a received
   * message. Markup applies to the members `appliesReplyInterfaceTo` chooses: a keyboard or forced
   * reply replaces what a member's client shows, and a keyboard removal removes an interface that
   * the same bot set. As TDLib's `add_message_to_dialog` does, a service message recording that a
   * member left removes the interfaces that member set.
   */
  #updateMemberReplyInterfaces(
    message: SupergroupMessage,
    repliedMessage: SupergroupMessage | undefined,
  ): void {
    const { replyInterfaceMarkup: markup } = message;
    if (markup === undefined && message.content.kind !== 'member_left') {
      return;
    }
    const { chatId } = message.chat;
    for (const memberId of this.#supergroupMembers.getChatMemberIds(chatId)) {
      const account = this.#accounts.getById(memberId);
      // Bots' clients show no reply interface.
      if (account === undefined) {
        continue;
      }
      if (message.content.kind === 'member_left') {
        this.#removeReplyInterfaceSetBy(chatId, memberId, message.content.memberId);
        continue;
      }
      if (
        markup === undefined || !appliesReplyInterfaceTo(markup, {
          mentionsMember: mentionsUser(message.content, account.profile),
          repliesToMember: repliedMessage !== undefined &&
            getMessageSenderId(repliedMessage) === memberId,
        })
      ) {
        continue;
      }
      if (markup.kind === 'reply_keyboard_removal') {
        this.#removeReplyInterfaceSetBy(chatId, memberId, getMessageSenderId(message));
      } else {
        this.#supergroupMembers.setReplyInterfaceMessageId(chatId, memberId, message.id);
      }
    }
  }

  /**
   * Removes the reply interface a member's client shows when the given member set it, or when its
   * message was deleted.
   */
  #removeReplyInterfaceSetBy(chatId: number, accountId: number, setterId: number): void {
    const shownMessageId = this.#supergroupMembers.getReplyInterfaceMessageId(chatId, accountId);
    if (shownMessageId === undefined) {
      return;
    }
    const shownMessage = this.#messages.findChatMessage(
      { type: 'supergroup', chatId },
      shownMessageId,
    );
    if (shownMessage === undefined || getMessageSenderId(shownMessage) === setterId) {
      this.#supergroupMembers.setReplyInterfaceMessageId(chatId, accountId, undefined);
    }
  }
}
