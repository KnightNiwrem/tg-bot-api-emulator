import {
  type ChatMembership,
  getEffectiveChatPermissions,
  resolveSupergroupBotMembership,
  type SupergroupBotAccessFailureReason,
  type SupergroupMembershipLookup,
} from '../types/chat_membership.ts';
import type { VirtualAccount } from '../types/virtual_account.ts';
import type { VirtualBot } from '../types/virtual_bot.ts';
import type {
  PrivateConversation,
  PrivateConversationKey,
  Supergroup,
} from '../types/virtual_chat.ts';
import {
  type CanonicalMessageId,
  type ChatMessage,
  isContentMessage,
  type PrivateMessage,
  type SupergroupMessage,
} from '../types/virtual_message.ts';

/** The account or bot that pins or unpins a message of a chat it takes part in. */
export type MessagePinner =
  | { readonly kind: 'account'; readonly accountId: number }
  | { readonly kind: 'bot'; readonly botId: number };

/**
 * A chat as the account or bot that pins its messages addresses it: its private chat with the
 * other participant, a bot for an account and an account for a bot, or a supergroup.
 */
export type PinningChat =
  | { readonly type: 'private'; readonly peerId: number }
  | { readonly type: 'supergroup'; readonly chatId: number };

/**
 * A chat whose pinned messages the caller reads after checking the reader's access: a private
 * conversation, or a supergroup.
 */
export type PinnedMessagesChat =
  | { readonly type: 'private'; readonly conversation: PrivateConversationKey }
  | { readonly type: 'supergroup'; readonly chatId: number };

export interface PinMessageInput {
  readonly pinner: MessagePinner;
  readonly chat: PinningChat;
  /**
   * The message's ID as the chat's bots see it: in a private chat, its ID in the bot's message
   * box, by which accounts address private messages too; in a supergroup, the supergroup's ID.
   */
  readonly messageId: number;
}

export interface UnpinMessageInput {
  readonly pinner: MessagePinner;
  readonly chat: PinningChat;
  /**
   * The message's ID, as `PinMessageInput` describes it; omitted to unpin the newest pinned
   * message, as the Bot API's `unpinChatMessage` does without a `message_id`.
   */
  readonly messageId?: number;
}

/** Why an account or a bot cannot reach a chat to manage its pinned messages. */
type PinningChatAccessFailureReason =
  | 'pinner_not_found'
  /**
   * No such supergroup exists, or no such private chat: the other participant does not exist, or,
   * for a bot, the account never started a conversation with it.
   */
  | 'chat_not_found'
  | Exclude<SupergroupBotAccessFailureReason, 'chat_not_found'>
  /** The pinner is an account that is not a member of the supergroup. */
  | 'not_a_member';

/** Why an account or a bot cannot pin or unpin a message, in the order Telegram checks. */
type PinChangeFailureReason =
  | PinningChatAccessFailureReason
  /** No such message is in the chat; for an unpin without a target, no message is pinned. */
  | 'message_not_found'
  /** In a supergroup, the pinner lacks the `can_pin_messages` permission. */
  | 'not_enough_rights'
  /** The message records a change of its chat, which TDLib's `can_pin_message` refuses. */
  | 'service_message_not_pinnable';

export type PinMessageResult =
  | { readonly pinned: true; readonly message: ChatMessage }
  | {
    readonly pinned: false;
    readonly reason: PinChangeFailureReason | 'message_already_pinned';
  };

export type UnpinMessageResult =
  | { readonly unpinned: true; readonly message: ChatMessage }
  | {
    readonly unpinned: false;
    readonly reason: PinChangeFailureReason | 'message_not_pinned';
  };

export interface GetPinnedMessagesInput {
  readonly accountId: number;
  readonly chat: PinningChat;
}

export type GetPinnedMessagesResult =
  | {
    readonly found: true;
    /** The chat's pinned messages, newest first. */
    readonly messages: readonly ChatMessage[];
  }
  | {
    readonly found: false;
    readonly reason: Exclude<PinningChatAccessFailureReason, 'bot_not_a_member' | 'bot_kicked'>;
  };

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

interface SupergroupMessageLookup {
  getMessageByChatMessageId(chatId: number, messageId: number): SupergroupMessage | undefined;
}

interface PinnedMessageStore {
  getPrivateConversationMessages(conversation: PrivateConversationKey): readonly PrivateMessage[];
  getSupergroupMessages(chatId: number): readonly SupergroupMessage[];
  setMessagePinned(messageId: CanonicalMessageId, isPinned: boolean): ChatMessage;
}

interface MessagePinningServiceDependencies {
  readonly accounts: AccountLookup;
  readonly bots: BotLookup;
  readonly privateConversations: PrivateConversationLookup;
  readonly sharedChats: SupergroupMembershipLookup;
  readonly privateMessages: PrivateMessageLookup;
  readonly supergroupMessages: SupergroupMessageLookup;
  readonly messages: PinnedMessageStore;
}

/** A chat a pinner reached, with what it may do there. */
type ReachedPinningChat =
  | { readonly type: 'private'; readonly conversation: PrivateConversationKey }
  | {
    readonly type: 'supergroup';
    readonly chatId: number;
    /** Whether the pinner holds the `can_pin_messages` permission there. */
    readonly canPinMessages: boolean;
  };

/**
 * Pins and unpins messages of private chats and supergroups, for accounts and bots alike, and
 * reads which messages a chat pins.
 *
 * As on Telegram, a chat pins any number of its messages, each marked as pinned, so the pinned
 * messages are those of the chat's current history that carry the mark; deleting a message
 * unpins it. Either participant of a private chat pins and unpins any of its messages; in a
 * supergroup, the pinner needs the `can_pin_messages` permission, as `getEffectiveChatPermissions`
 * decides it. Service messages are never pinned.
 */
export class MessagePinningService {
  readonly #accounts: AccountLookup;
  readonly #bots: BotLookup;
  readonly #privateConversations: PrivateConversationLookup;
  readonly #sharedChats: SupergroupMembershipLookup;
  readonly #privateMessages: PrivateMessageLookup;
  readonly #supergroupMessages: SupergroupMessageLookup;
  readonly #messages: PinnedMessageStore;

  constructor(
    {
      accounts,
      bots,
      privateConversations,
      sharedChats,
      privateMessages,
      supergroupMessages,
      messages,
    }: MessagePinningServiceDependencies,
  ) {
    this.#accounts = accounts;
    this.#bots = bots;
    this.#privateConversations = privateConversations;
    this.#sharedChats = sharedChats;
    this.#privateMessages = privateMessages;
    this.#supergroupMessages = supergroupMessages;
    this.#messages = messages;
  }

  /**
   * Adds a message to its chat's pinned messages, as TDLib's `pin_dialog_message` checks it: the
   * pinner must reach the chat and find the message there, then hold the right to pin, and the
   * message must not be a service message. Telegram's servers refuse to pin a pinned message.
   */
  pinMessage({ pinner, chat, messageId }: PinMessageInput): PinMessageResult {
    const access = this.#reachChat(pinner, chat);
    if (!access.reached) {
      return { pinned: false, reason: access.reason };
    }
    const message = this.#findChatMessage(access.chat, messageId);
    if (message === undefined) {
      return { pinned: false, reason: 'message_not_found' };
    }
    const refusal = findPinChangeRefusal(access.chat, message);
    if (refusal !== undefined) {
      return { pinned: false, reason: refusal };
    }
    if (message.isPinned) {
      return { pinned: false, reason: 'message_already_pinned' };
    }
    return { pinned: true, message: this.#messages.setMessagePinned(message.id, true) };
  }

  /**
   * Removes a message from its chat's pinned messages, as TDLib's `pin_dialog_message` checks an
   * unpin: as for a pin, so a service message is refused even though it is never pinned. Without
   * a target, the newest pinned message is unpinned, as the official Bot API server finds it with
   * `getChatPinnedMessage`. Telegram's servers refuse to unpin a message that is not pinned.
   */
  unpinMessage({ pinner, chat, messageId }: UnpinMessageInput): UnpinMessageResult {
    const access = this.#reachChat(pinner, chat);
    if (!access.reached) {
      return { unpinned: false, reason: access.reason };
    }
    const message = messageId === undefined
      ? this.#listPinnedMessages(access.chat)[0]
      : this.#findChatMessage(access.chat, messageId);
    if (message === undefined) {
      return { unpinned: false, reason: 'message_not_found' };
    }
    const refusal = findPinChangeRefusal(access.chat, message);
    if (refusal !== undefined) {
      return { unpinned: false, reason: refusal };
    }
    if (!message.isPinned) {
      return { unpinned: false, reason: 'message_not_pinned' };
    }
    return { unpinned: true, message: this.#messages.setMessagePinned(message.id, false) };
  }

  /**
   * Returns the pinned messages of an account's private chat with a bot, or of a supergroup the
   * account is a member of, newest first, as Telegram's search for pinned messages lists them.
   */
  getPinnedMessages({ accountId, chat }: GetPinnedMessagesInput): GetPinnedMessagesResult {
    const access = this.#reachChat({ kind: 'account', accountId }, chat);
    if (!access.reached) {
      switch (access.reason) {
        case 'bot_not_a_member':
        case 'bot_kicked':
          throw new Error(`Account ${accountId} refused as a bot: ${access.reason}`);
        default:
          return { found: false, reason: access.reason };
      }
    }
    return { found: true, messages: this.#listPinnedMessages(access.chat) };
  }

  /**
   * Returns a chat's newest pinned message, which the Bot API's `getChat` shows as the most recent
   * pinned message by sending date, as TDLib's `last_pinned_message_id` is the greatest pinned
   * message ID; `undefined` when the chat pins none. The caller checks the reader's access.
   */
  findNewestPinnedMessage(chat: PinnedMessagesChat): ChatMessage | undefined {
    return this.#listPinnedMessages(chat)[0];
  }

  /**
   * Checks that a pinner reaches a chat and what it may do there: a bot as the official Bot API
   * server's `check_chat` requires for writing, which needs an account to have started its private
   * chat with the bot, and an account as a participant of the chat.
   */
  #reachChat(
    pinner: MessagePinner,
    chat: PinningChat,
  ):
    | { readonly reached: true; readonly chat: ReachedPinningChat }
    | { readonly reached: false; readonly reason: PinningChatAccessFailureReason } {
    if (!this.#pinnerExists(pinner)) {
      return { reached: false, reason: 'pinner_not_found' };
    }
    switch (chat.type) {
      case 'private':
        return this.#reachPrivateChat(pinner, chat.peerId);
      case 'supergroup':
        return this.#reachSupergroup(pinner, chat.chatId);
      default: {
        const unhandledChat: never = chat;
        throw new Error(`Unhandled chat: ${JSON.stringify(unhandledChat)}`);
      }
    }
  }

  #pinnerExists(pinner: MessagePinner): boolean {
    return pinner.kind === 'account'
      ? this.#accounts.getById(pinner.accountId) !== undefined
      : this.#bots.getById(pinner.botId) !== undefined;
  }

  #reachPrivateChat(
    pinner: MessagePinner,
    peerId: number,
  ):
    | { readonly reached: true; readonly chat: ReachedPinningChat }
    | { readonly reached: false; readonly reason: 'chat_not_found' } {
    if (pinner.kind === 'account') {
      return this.#bots.getById(peerId) === undefined
        ? { reached: false, reason: 'chat_not_found' }
        : {
          reached: true,
          chat: { type: 'private', conversation: { accountId: pinner.accountId, botId: peerId } },
        };
    }
    const conversation: PrivateConversationKey = { accountId: peerId, botId: pinner.botId };
    return this.#accounts.getById(peerId) === undefined ||
        this.#privateConversations.getPrivateConversation(conversation) === undefined
      ? { reached: false, reason: 'chat_not_found' }
      : { reached: true, chat: { type: 'private', conversation } };
  }

  #reachSupergroup(
    pinner: MessagePinner,
    chatId: number,
  ):
    | { readonly reached: true; readonly chat: ReachedPinningChat }
    | {
      readonly reached: false;
      readonly reason: SupergroupBotAccessFailureReason | 'not_a_member';
    } {
    const access = this.#resolveSupergroupMembership(pinner, chatId);
    if (!access.resolved) {
      return { reached: false, reason: access.reason };
    }
    const permissions = getEffectiveChatPermissions(access.membership, {
      defaultPermissions: access.supergroup.defaultPermissions,
      isBot: pinner.kind === 'bot',
    });
    return {
      reached: true,
      chat: { type: 'supergroup', chatId, canPinMessages: permissions.has('can_pin_messages') },
    };
  }

  #resolveSupergroupMembership(
    pinner: MessagePinner,
    chatId: number,
  ):
    | {
      readonly resolved: true;
      readonly supergroup: Supergroup;
      readonly membership: ChatMembership;
    }
    | {
      readonly resolved: false;
      readonly reason: SupergroupBotAccessFailureReason | 'not_a_member';
    } {
    if (pinner.kind === 'bot') {
      return resolveSupergroupBotMembership(this.#sharedChats, pinner.botId, chatId);
    }
    const supergroup = this.#sharedChats.getSharedChat(chatId);
    if (supergroup?.kind !== 'supergroup') {
      return { resolved: false, reason: 'chat_not_found' };
    }
    const membership = this.#sharedChats.getChatMembership(chatId, pinner.accountId);
    return membership === undefined
      ? { resolved: false, reason: 'not_a_member' }
      : { resolved: true, supergroup, membership };
  }

  #findChatMessage(chat: ReachedPinningChat, messageId: number): ChatMessage | undefined {
    return chat.type === 'private'
      ? this.#privateMessages.getPrivateMessageByBotMessageId(chat.conversation, messageId)
      : this.#supergroupMessages.getMessageByChatMessageId(chat.chatId, messageId);
  }

  /** A chat's pinned messages, newest first: its history lists messages oldest first. */
  #listPinnedMessages(chat: PinnedMessagesChat): readonly ChatMessage[] {
    const history: readonly ChatMessage[] = chat.type === 'private'
      ? this.#messages.getPrivateConversationMessages(chat.conversation)
      : this.#messages.getSupergroupMessages(chat.chatId);
    return history.filter((message) => message.isPinned).reverse();
  }
}

/**
 * Why a pinner that found a message may not pin or unpin it, in the order of TDLib's
 * `can_pin_message`: the right to pin comes first, then the message must not be a service message.
 */
function findPinChangeRefusal(
  chat: ReachedPinningChat,
  message: ChatMessage,
): 'not_enough_rights' | 'service_message_not_pinnable' | undefined {
  if (chat.type === 'supergroup' && !chat.canPinMessages) {
    return 'not_enough_rights';
  }
  return isContentMessage(message) ? undefined : 'service_message_not_pinnable';
}
