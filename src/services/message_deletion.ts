/**
 * Deleting messages for everyone, written once for every chat type: bots delete messages of their
 * chats, several at once, and accounts delete one at a time. The deletion mechanics are shared;
 * what differs per chat type is how a sender reaches the chat, which its chat type's policy
 * decides, which messages the sender may delete, and what else a deleted message takes with it.
 *
 * @module
 */
import {
  type ChatMembership,
  holdsSupergroupAdministratorRight,
  type SupergroupBotAccessFailureReason,
} from '../types/chat_membership.ts';
import type {
  ChatMessageLookup,
  PrivateChatAccessPredicates,
  PrivateChatIdentityPolicy,
  SupergroupAccessPredicates,
  SupergroupIdentityPolicy,
} from '../types/chat_policy.ts';
import type { VirtualAccount } from '../types/virtual_account.ts';
import type { VirtualBot } from '../types/virtual_bot.ts';
import type {
  ChatAddress,
  PrivateChatAddress,
  PrivateChatKey,
  PrivateConversationKey,
  SupergroupChatAddress,
  SupergroupChatKey,
} from '../types/virtual_chat.ts';
import {
  type CanonicalMessageId,
  type ChatMessage,
  isSupergroupContentMessage,
  type PrivateMessage,
  type SupergroupMessage,
} from '../types/virtual_message.ts';

/** Messages of the bot's private chat with an account, which the bot deletes. */
export interface BotPrivateChatMessagesDeletion {
  readonly fromBotId: number;
  /** The bot's private chat, by the account it is with. */
  readonly chat: PrivateChatAddress;
  /** The messages' IDs in the bot's message box. */
  readonly messageIds: readonly number[];
}

/** Messages of a supergroup, which a bot deletes as a member. */
export interface BotSupergroupMessagesDeletion {
  readonly fromBotId: number;
  readonly chat: SupergroupChatAddress;
  /** The supergroup's IDs of the messages. */
  readonly messageIds: readonly number[];
}

/** A message of an account's private chat with a bot, which the account deletes. */
export interface AccountPrivateChatMessageDeletion {
  readonly fromAccountId: number;
  /** The account's private chat, by the bot it is with. */
  readonly chat: PrivateChatAddress;
  /** The message's ID in the bot's message box, by which accounts address private messages. */
  readonly messageId: number;
}

/** A message of a supergroup, which an account deletes as a member. */
export interface AccountSupergroupMessageDeletion {
  readonly fromAccountId: number;
  readonly chat: SupergroupChatAddress;
  /** The supergroup's ID of the message. */
  readonly messageId: number;
}

/**
 * The types by which one sender's deletions in a chat of one type differ from the others, which
 * the deletion operations report precisely: how the chat is addressed, what reaching it finds,
 * its messages, and why the chat is not reached or a message may not be deleted.
 */
interface DeletionTargetingTypes {
  readonly address: ChatAddress;
  /** The chat reached, with what deciding about its messages needs to know. */
  readonly reached: object;
  readonly message: ChatMessage;
  /** Why the sender does not reach the chat. */
  readonly lookupFailureReason: string;
  /** Why the sender may not delete a message it found. */
  readonly refusalReason: string;
}

/**
 * How one sender reaches a chat of one type to delete its messages, which of them it may delete,
 * and how a message of the chat is deleted. Every deletion reaches the chat first, then finds each
 * message and decides whether the sender may delete it, and deletes only once every message it
 * found may be.
 */
interface DeletionTargeting<Types extends DeletionTargetingTypes> {
  /** Reaches the chat, checking the sender's access in the chat's order. */
  reachChat(
    senderId: number,
    chat: Types['address'],
  ):
    | ({ readonly reached: true } & Types['reached'])
    | { readonly reached: false; readonly reason: Types['lookupFailureReason'] };
  /** Finds a message of the reached chat by its chat message ID. */
  findMessage(reached: Types['reached'], messageId: number): Types['message'] | undefined;
  /** Why the sender may not delete the message; `undefined` when it may. */
  findRefusal(
    reached: Types['reached'],
    senderId: number,
    message: Types['message'],
  ): Types['refusalReason'] | undefined;
  /** Deletes the message for everyone, with what the chat keeps of it. */
  deleteMessage(reached: Types['reached'], message: Types['message']): void;
}

/**
 * A bot reaches its private chat once the account exists and has started the chat: a join
 * request's contact grant lets the bot write there, but not delete. It deletes either
 * participant's messages.
 */
export interface BotPrivateChatDeletionTypes {
  readonly address: PrivateChatAddress;
  readonly reached: { readonly key: PrivateChatKey };
  readonly message: PrivateMessage;
  readonly lookupFailureReason: 'account_not_found' | 'conversation_not_started';
  readonly refusalReason: never;
}

/**
 * A bot reaches a supergroup as a member. It deletes its own messages, and, with the
 * `can_delete_messages` right, any message, service messages included.
 */
export interface BotSupergroupDeletionTypes {
  readonly address: SupergroupChatAddress;
  readonly reached: { readonly key: SupergroupChatKey; readonly membership: ChatMembership };
  readonly message: SupergroupMessage;
  readonly lookupFailureReason: SupergroupBotAccessFailureReason;
  readonly refusalReason: 'message_not_deletable';
}

/**
 * An account reaches its private chat with an existing bot, started or not, and deletes either
 * participant's messages there, as TDLib's `can_revoke_message` allows users in private chats.
 */
export interface AccountPrivateChatDeletionTypes {
  readonly address: PrivateChatAddress;
  readonly reached: { readonly key: PrivateChatKey };
  readonly message: PrivateMessage;
  readonly lookupFailureReason: 'bot_not_found';
  readonly refusalReason: never;
}

/**
 * An account reaches a supergroup as a member. As TDLib's `can_delete_channel_message` allows, it
 * deletes the messages it wrote, and, as the owner or an administrator with the
 * `can_delete_messages` right, any message; a member cannot delete a service message recording
 * its own change.
 */
export interface AccountSupergroupDeletionTypes {
  readonly address: SupergroupChatAddress;
  readonly reached: { readonly key: SupergroupChatKey; readonly membership: ChatMembership };
  readonly message: SupergroupMessage;
  readonly lookupFailureReason: 'chat_not_found' | 'not_a_member';
  readonly refusalReason: 'message_not_deletable';
}

export type BotDeletionResult<Types extends DeletionTargetingTypes> =
  | {
    readonly deleted: true;
    /** How many of the IDs identified a message of the chat, each deleted once. */
    readonly deletedMessageCount: number;
  }
  | {
    readonly deleted: false;
    readonly reason: 'bot_not_found' | Types['lookupFailureReason'] | Types['refusalReason'];
  };

export type AccountDeletionResult<Types extends DeletionTargetingTypes> =
  | { readonly deleted: true }
  | {
    readonly deleted: false;
    readonly reason:
      | 'account_not_found'
      | Types['lookupFailureReason']
      | 'message_not_found'
      | Types['refusalReason'];
  };

interface AccountLookup {
  getById(accountId: number): VirtualAccount | undefined;
}

interface BotLookup {
  getById(botId: number): VirtualBot | undefined;
}

interface DeletedMessageStore {
  deleteMessage(messageId: CanonicalMessageId): void;
}

/** The message whose reply interface an account's client shows in its private chat with a bot. */
interface PrivateReplyInterfaceStore {
  getReplyInterfaceMessageId(key: PrivateConversationKey): CanonicalMessageId | undefined;
  setReplyInterfaceMessageId(
    key: PrivateConversationKey,
    messageId: CanonicalMessageId | undefined,
  ): void;
}

/** The private chat policy's rules that deletion asks for. */
type PrivateChatDeletionPolicy =
  & PrivateChatIdentityPolicy
  & Pick<PrivateChatAccessPredicates, 'isConversationStarted'>
  & ChatMessageLookup<PrivateChatKey, PrivateMessage>;

/** The supergroup policy's rules that deletion asks for. */
type SupergroupDeletionPolicy =
  & SupergroupIdentityPolicy
  & SupergroupAccessPredicates
  & ChatMessageLookup<SupergroupChatKey, SupergroupMessage>;

interface MessageDeletionDependencies {
  readonly accounts: AccountLookup;
  readonly bots: BotLookup;
  readonly privateChats: PrivateChatDeletionPolicy;
  readonly supergroups: SupergroupDeletionPolicy;
  readonly messages: DeletedMessageStore;
  readonly privateReplyInterfaces: PrivateReplyInterfaceStore;
}

/**
 * Deletes messages of every chat type for everyone, as Telegram does. As on Telegram, no bot
 * receives an update for a deletion, and the emulator does not age messages, so Telegram's 48-hour
 * deletion limit never applies. A deleted message keeps its ID in each message box, because
 * Telegram never reuses message IDs.
 *
 * Each sender and chat type has its own entry point, which reports exactly the failures its chat
 * type can produce, in Telegram's order.
 */
export class MessageDeletionService {
  readonly #accounts: AccountLookup;
  readonly #bots: BotLookup;
  readonly #botPrivateChatTargeting: DeletionTargeting<BotPrivateChatDeletionTypes>;
  readonly #botSupergroupTargeting: DeletionTargeting<BotSupergroupDeletionTypes>;
  readonly #accountPrivateChatTargeting: DeletionTargeting<AccountPrivateChatDeletionTypes>;
  readonly #accountSupergroupTargeting: DeletionTargeting<AccountSupergroupDeletionTypes>;

  constructor(
    { accounts, bots, privateChats, supergroups, messages, privateReplyInterfaces }:
      MessageDeletionDependencies,
  ) {
    this.#accounts = accounts;
    this.#bots = bots;
    const privateChatMessages = createPrivateChatMessageDeletion(
      privateChats,
      messages,
      privateReplyInterfaces,
    );
    const supergroupMessages = createSupergroupMessageDeletion(supergroups, messages);
    this.#botPrivateChatTargeting = {
      ...privateChatMessages,
      reachChat: (botId, chat) => {
        const identification = privateChats.identifyChatForBot(botId, chat);
        if (!identification.identified) {
          return { reached: false, reason: identification.reason };
        }
        return privateChats.isConversationStarted(identification.key)
          ? { reached: true, key: identification.key }
          : { reached: false, reason: 'conversation_not_started' };
      },
      findRefusal: () => undefined,
    };
    this.#botSupergroupTargeting = {
      ...supergroupMessages,
      reachChat: (botId, chat) => {
        const identification = supergroups.identifyChatForBot(botId, chat);
        if (!identification.identified) {
          return { reached: false, reason: identification.reason };
        }
        const membership = supergroups.resolveBotMembership(botId, identification.supergroup);
        return membership.member
          ? { reached: true, key: identification.key, membership: membership.membership }
          : { reached: false, reason: membership.reason };
      },
      findRefusal: ({ membership }, botId, message) =>
        (message.sender.kind === 'bot' && message.sender.botId === botId) ||
          holdsSupergroupAdministratorRight(membership, 'can_delete_messages')
          ? undefined
          : 'message_not_deletable',
    };
    this.#accountPrivateChatTargeting = {
      ...privateChatMessages,
      reachChat: (accountId, chat) => {
        const identification = privateChats.identifyChatForAccount(accountId, chat);
        return identification.identified
          ? { reached: true, key: identification.key }
          : { reached: false, reason: identification.reason };
      },
      findRefusal: () => undefined,
    };
    this.#accountSupergroupTargeting = {
      ...supergroupMessages,
      reachChat: (accountId, chat) => {
        const identification = supergroups.identifyChatForAccount(accountId, chat);
        if (!identification.identified) {
          return { reached: false, reason: identification.reason };
        }
        const membership = supergroups.resolveAccountMembership(
          accountId,
          identification.supergroup,
        );
        return membership.member
          ? { reached: true, key: identification.key, membership: membership.membership }
          : { reached: false, reason: membership.reason };
      },
      findRefusal: ({ membership }, accountId, message) =>
        (isSupergroupContentMessage(message) && message.sender.kind === 'account' &&
            message.sender.accountId === accountId) ||
          holdsSupergroupAdministratorRight(membership, 'can_delete_messages')
          ? undefined
          : 'message_not_deletable',
    };
  }

  /**
   * Deletes messages of the bot's private chat, of either participant. IDs that identify no
   * message of the chat, including messages already deleted, are skipped.
   */
  deletePrivateChatMessages(
    input: BotPrivateChatMessagesDeletion,
  ): BotDeletionResult<BotPrivateChatDeletionTypes> {
    return this.#deleteMessagesByBot(this.#botPrivateChatTargeting, input);
  }

  /**
   * Deletes messages of a supergroup, as in a private chat, once the bot may delete every message
   * it finds; otherwise it deletes none.
   */
  deleteSupergroupMessages(
    input: BotSupergroupMessagesDeletion,
  ): BotDeletionResult<BotSupergroupDeletionTypes> {
    return this.#deleteMessagesByBot(this.#botSupergroupTargeting, input);
  }

  /**
   * Deletes a message of an account's private chat with a bot for both participants, as the
   * account's client does when it deletes a message for everyone.
   */
  deleteAccountPrivateChatMessage(
    input: AccountPrivateChatMessageDeletion,
  ): AccountDeletionResult<AccountPrivateChatDeletionTypes> {
    return this.#deleteAccountMessage(this.#accountPrivateChatTargeting, input);
  }

  /** Deletes a message of a supergroup for every member, as an account does from its client. */
  deleteAccountSupergroupMessage(
    input: AccountSupergroupMessageDeletion,
  ): AccountDeletionResult<AccountSupergroupDeletionTypes> {
    return this.#deleteAccountMessage(this.#accountSupergroupTargeting, input);
  }

  #deleteMessagesByBot<Types extends DeletionTargetingTypes>(
    targeting: DeletionTargeting<Types>,
    { fromBotId, chat, messageIds }: {
      readonly fromBotId: number;
      readonly chat: Types['address'];
      readonly messageIds: readonly number[];
    },
  ): BotDeletionResult<Types> {
    if (this.#bots.getById(fromBotId) === undefined) {
      return { deleted: false, reason: 'bot_not_found' };
    }
    const reach = targeting.reachChat(fromBotId, chat);
    if (!reach.reached) {
      return { deleted: false, reason: reach.reason };
    }

    // An ID repeated, or naming a message already found, deletes that message once.
    const messages = new Map<CanonicalMessageId, Types['message']>();
    for (const messageId of messageIds) {
      const message = targeting.findMessage(reach, messageId);
      if (message === undefined) {
        continue;
      }
      const refusal = targeting.findRefusal(reach, fromBotId, message);
      if (refusal !== undefined) {
        return { deleted: false, reason: refusal };
      }
      messages.set(message.id, message);
    }
    for (const message of messages.values()) {
      targeting.deleteMessage(reach, message);
    }
    return { deleted: true, deletedMessageCount: messages.size };
  }

  #deleteAccountMessage<Types extends DeletionTargetingTypes>(
    targeting: DeletionTargeting<Types>,
    { fromAccountId, chat, messageId }: {
      readonly fromAccountId: number;
      readonly chat: Types['address'];
      readonly messageId: number;
    },
  ): AccountDeletionResult<Types> {
    if (this.#accounts.getById(fromAccountId) === undefined) {
      return { deleted: false, reason: 'account_not_found' };
    }
    const reach = targeting.reachChat(fromAccountId, chat);
    if (!reach.reached) {
      return { deleted: false, reason: reach.reason };
    }
    const message = targeting.findMessage(reach, messageId);
    if (message === undefined) {
      return { deleted: false, reason: 'message_not_found' };
    }
    const refusal = targeting.findRefusal(reach, fromAccountId, message);
    if (refusal !== undefined) {
      return { deleted: false, reason: refusal };
    }
    targeting.deleteMessage(reach, message);
    return { deleted: true };
  }
}

/**
 * How a private chat's messages are found and deleted, whoever deletes them. As TDLib does,
 * deleting the message whose reply interface the account's client shows removes the interface.
 */
function createPrivateChatMessageDeletion(
  privateChats: PrivateChatDeletionPolicy,
  messages: DeletedMessageStore,
  privateReplyInterfaces: PrivateReplyInterfaceStore,
): Pick<
  DeletionTargeting<BotPrivateChatDeletionTypes | AccountPrivateChatDeletionTypes>,
  'findMessage' | 'deleteMessage'
> {
  return {
    findMessage: ({ key }, messageId) => privateChats.findMessageByChatMessageId(key, messageId),
    deleteMessage: ({ key: { conversation } }, message) => {
      if (privateReplyInterfaces.getReplyInterfaceMessageId(conversation) === message.id) {
        privateReplyInterfaces.setReplyInterfaceMessageId(conversation, undefined);
      }
      messages.deleteMessage(message.id);
    },
  };
}

/**
 * How a supergroup's messages are found and deleted, whoever deletes them. A member's client
 * stops showing the reply interface of a deleted message once it no longer finds the message.
 */
function createSupergroupMessageDeletion(
  supergroups: SupergroupDeletionPolicy,
  messages: DeletedMessageStore,
): Pick<
  DeletionTargeting<BotSupergroupDeletionTypes | AccountSupergroupDeletionTypes>,
  'findMessage' | 'deleteMessage'
> {
  return {
    findMessage: ({ key }, messageId) => supergroups.findMessageByChatMessageId(key, messageId),
    deleteMessage: (_reached, message) => messages.deleteMessage(message.id),
  };
}
