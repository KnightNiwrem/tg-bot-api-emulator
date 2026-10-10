/**
 * The contracts by which a chat type states the rules in which its chats differ, which code shared
 * by every chat type asks for instead of branching on the type. Each rule is a separate decision:
 *
 * - identity resolves an actor-relative `ChatAddress` to the `ChatKey` of the chat it names, and
 *   decides nothing about access;
 * - access predicates each answer one question about who may act in a chat, which every operation
 *   asks at the point its check order requires, reporting the failure that operation reports;
 * - message lookup finds a chat's message by the ID by which the chat's messages are addressed;
 * - ID allocation chooses the message boxes that number a new message;
 * - observer numbering chooses the box from which an observer sees a message's ID;
 * - event recipients choose who receives an update about a message event, which having an ID for
 *   the message does not imply.
 *
 * Subscriptions are not a chat type's rule: whichever recipients a chat type chooses, update
 * delivery drops the updates a bot has not subscribed to when it creates them. Which bots receive
 * a supergroup's content messages depends on privacy mode, addressing and bot-to-bot settings,
 * which update delivery decides with state it keeps itself.
 *
 * @module
 */
import type { ChatMembership, SupergroupBotAccessFailureReason } from './chat_membership.ts';
import type {
  ChatAddress,
  ChatKey,
  PrivateChatAddress,
  PrivateChatKey,
  PrivateConversation,
  PrivateConversationRole,
  Supergroup,
  SupergroupChatAddress,
  SupergroupChatKey,
} from './virtual_chat.ts';
import {
  isPrivateContentMessage,
  type PrivateMessage,
  type SupergroupMessage,
} from './virtual_message.ts';

/** The chat an address names, or why the actor knows no such chat. */
export type ChatIdentification<
  Identified extends { readonly key: ChatKey },
  FailureReason extends string,
> =
  | ({ readonly identified: true } & Identified)
  | { readonly identified: false; readonly reason: FailureReason };

/**
 * Identity: resolves an address to the chat it names, for an account or for a bot, each with the
 * chat type's failures for that actor. It checks only that the chat exists; whether the actor may
 * act there is for the access predicates. The caller has authenticated the actor.
 */
export interface ChatIdentityPolicy<
  Address extends ChatAddress,
  Identified extends { readonly key: ChatKey },
  AccountFailureReason extends string,
  BotFailureReason extends string,
> {
  identifyChatForAccount(
    accountId: number,
    address: Address,
  ): ChatIdentification<Identified, AccountFailureReason>;
  identifyChatForBot(
    botId: number,
    address: Address,
  ): ChatIdentification<Identified, BotFailureReason>;
}

/**
 * A private chat names its peer, which must exist: for an account the bot, and for a bot the
 * account. The conversation itself need not exist yet.
 */
export type PrivateChatIdentityPolicy = ChatIdentityPolicy<
  PrivateChatAddress,
  { readonly key: PrivateChatKey },
  'bot_not_found',
  'account_not_found'
>;

/** A supergroup that an address names, with its current state. */
export interface IdentifiedSupergroup {
  readonly key: SupergroupChatKey;
  readonly supergroup: Supergroup;
}

/** A supergroup address names an existing supergroup, whoever the actor is. */
export type SupergroupIdentityPolicy = ChatIdentityPolicy<
  SupergroupChatAddress,
  IdentifiedSupergroup,
  'chat_not_found',
  'chat_not_found'
>;

/**
 * Access predicates of a private chat. As Telegram decides it, the bot may write to an account that
 * started their conversation, or that a pending join request lets it contact, and neither
 * participant may write while the account blocks the bot. Which of them an operation asks, and in
 * which order, is the operation's own.
 */
export interface PrivateChatAccessPredicates {
  /**
   * The conversation, once either participant wrote to it; `undefined` before. A bot's message
   * under a join request's contact grant opens it without starting it.
   */
  findConversation(chat: PrivateChatKey): PrivateConversation | undefined;
  /** Whether the account started its conversation with the bot. */
  isConversationStarted(chat: PrivateChatKey): boolean;
  /** Whether the account blocks the bot. */
  isBotBlocked(chat: PrivateChatKey): boolean;
  /**
   * Whether a pending join request of the account lets the bot send it messages before the
   * conversation is started. The grant covers sending messages only.
   */
  mayBotContactJoinRequester(chat: PrivateChatKey): boolean;
}

/** A member's standing in a supergroup, or why the identity is no member. */
export type SupergroupMembershipResolution<FailureReason extends string> =
  | { readonly member: true; readonly membership: ChatMembership }
  | { readonly member: false; readonly reason: FailureReason };

/**
 * Access predicates of a supergroup: an actor acts there as a current member, with the rights its
 * membership grants, which `holdsSupergroupAdministratorRight` and `getEffectiveChatPermissions`
 * decide.
 */
export interface SupergroupAccessPredicates {
  resolveAccountMembership(
    accountId: number,
    supergroup: Supergroup,
  ): SupergroupMembershipResolution<'not_a_member'>;
  /**
   * A bot that never joined the supergroup does not know it, as `chat_not_found`, whereas one that
   * left or was removed is turned away.
   */
  resolveBotMembership(
    botId: number,
    supergroup: Supergroup,
  ): SupergroupMembershipResolution<SupergroupBotAccessFailureReason>;
}

/**
 * Message lookup: finds a chat's message by its chat message ID, the ID by which the chat's
 * messages are addressed, which in a private chat is its ID in the bot's message box, by which
 * accounts address private messages too, and in a supergroup the supergroup's ID. Finds nothing
 * for an ID that numbers no message of this chat, including one that numbers another chat's message
 * in the same box.
 */
export interface ChatMessageLookup<Key extends ChatKey, Message> {
  findMessageByChatMessageId(chat: Key, chatMessageId: number): Message | undefined;
}

/**
 * ID allocation: the owners of the message boxes that number each new message of a chat, each
 * giving it the next ID of its box.
 */
export interface MessageIdAllocationPolicy<Key extends ChatKey> {
  getNumberingBoxOwnerIds(chat: Key): readonly number[];
}

/**
 * Observer numbering: the owner of the message box from which an observer sees a chat's message
 * IDs, which depends on the observer's role in the chat, not on who it is.
 */
export interface ObserverNumberingPolicy<Key extends ChatKey, ObserverRole extends string> {
  getObserverBoxOwnerId(chat: Key, observerRole: ObserverRole): number;
}

/**
 * The role of a supergroup's observer: every member, and a member that just left or was removed,
 * which still sees its departure, observes the supergroup alike.
 */
export type SupergroupObserverRole = 'member';

/** Event recipients of the messages of a private chat. */
export interface PrivateMessageRecipientPolicy {
  /**
   * The bots that receive an update about a private message being sent or edited, before
   * subscriptions filter them.
   */
  selectMessageRecipientBotIds(message: PrivateMessage): readonly number[];
}

/** Event recipients of the service messages of a supergroup. */
export interface SupergroupServiceMessageRecipientPolicy {
  /**
   * The identities, accounts and bots, that receive an update about a service message, given the
   * supergroup's members once its change was made, before update delivery keeps its subscribed
   * bots.
   */
  selectServiceMessageRecipientIds(
    message: SupergroupMessage,
    currentMemberIds: readonly number[],
  ): readonly number[];
}

/**
 * How private chats number messages and who learns of them. As Telegram numbers them, every user,
 * account or bot, numbers the messages of all its private chats in one box of its own, so each
 * participant has its own ID for a message, and an ID names a message of a given chat only if that
 * chat holds it.
 *
 * Only the conversation's bot receives updates, and, as on Telegram, none for its own content
 * message or its edit. A service message recording the bot's own pin is the exception, which the
 * Bot API server's `need_skip_update_message` keeps among a bot's outgoing messages.
 */
export const privateChatMessagePolicy:
  & MessageIdAllocationPolicy<PrivateChatKey>
  & ObserverNumberingPolicy<PrivateChatKey, PrivateConversationRole>
  & PrivateMessageRecipientPolicy = {
    getNumberingBoxOwnerIds: ({ conversation }) => [conversation.accountId, conversation.botId],
    getObserverBoxOwnerId: ({ conversation }, observerRole) =>
      observerRole === 'account' ? conversation.accountId : conversation.botId,
    selectMessageRecipientBotIds: (message) =>
      message.authorRole === 'bot' && isPrivateContentMessage(message)
        ? []
        : [message.conversation.botId],
  };

/**
 * How supergroups number messages and who learns of their service messages. A supergroup numbers
 * its messages in one box of its own, under its chat ID, so every member sees the same ID.
 *
 * A service message about a change of the supergroup's members or title, or a pin, reaches every
 * member, the member that made the change included, and a member that left or was removed, which,
 * as on Telegram, still learns of its own departure.
 */
export const supergroupMessagePolicy:
  & MessageIdAllocationPolicy<SupergroupChatKey>
  & ObserverNumberingPolicy<SupergroupChatKey, SupergroupObserverRole>
  & SupergroupServiceMessageRecipientPolicy = {
    getNumberingBoxOwnerIds: ({ chatId }) => [chatId],
    getObserverBoxOwnerId: ({ chatId }) => chatId,
    selectServiceMessageRecipientIds: (message, currentMemberIds) => [
      ...new Set([
        ...currentMemberIds,
        ...(message.content.kind === 'member_left' ? [message.content.memberId] : []),
      ]),
    ],
  };
