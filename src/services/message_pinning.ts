/**
 * Pinning messages, written once for every chat type: bots and accounts pin and unpin messages of
 * their chats, and accounts read which messages a chat pins. The pinning mechanics are shared;
 * what differs per pinner and chat type is how the pinner reaches the chat, which its chat type's
 * policy decides, whether it holds the right to pin there, and how its pin is recorded.
 *
 * @module
 */
import {
  type ChatMembership,
  getEffectiveChatPermissions,
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
  ChatActor,
  ChatAddress,
  ChatKey,
  ChatKeyOfType,
  ChatType,
  PrivateChatAddress,
  PrivateChatKey,
  PrivateConversationKey,
  PrivateConversationRole,
  Supergroup,
  SupergroupChatAddress,
  SupergroupChatKey,
} from '../types/virtual_chat.ts';
import {
  type CanonicalMessageId,
  type ChatMessage,
  type ChatMessageOfType,
  isContentMessage,
  type MessagePinnedContent,
  type PrivateMessage,
  type SupergroupMessage,
  type SupergroupMessageSender,
} from '../types/virtual_message.ts';

/** A bot's pin of a message of one of its chats. */
export interface BotMessagePin {
  readonly fromBotId: number;
  /** The chat as the bot addresses it. */
  readonly chat: ChatAddress;
  /**
   * The message's chat message ID: in a private chat, its ID in the bot's message box; in a
   * supergroup, the supergroup's ID.
   */
  readonly messageId: number;
  /**
   * Whether the pin's service message notifies a supergroup's members without sound, as the Bot
   * API's `disable_notification` asks. A private chat's pins always notify without sound.
   */
  readonly isSilent: boolean;
}

/** A bot's unpin of a message of one of its chats. */
export interface BotMessageUnpin {
  readonly fromBotId: number;
  readonly chat: ChatAddress;
  /**
   * The message's chat message ID, as `BotMessagePin` describes it; omitted to unpin the newest
   * pinned message, as the Bot API's `unpinChatMessage` does without a `message_id`.
   */
  readonly messageId?: number;
}

/** A bot's unpin of every pinned message of one of its chats. */
export interface BotChatMessagesUnpin {
  readonly fromBotId: number;
  readonly chat: ChatAddress;
}

/** An account's pin of a message of its private chat with a bot, or of a supergroup. */
export interface AccountMessagePin {
  readonly fromAccountId: number;
  /** The chat as the account addresses it. */
  readonly chat: ChatAddress;
  /**
   * The message's chat message ID: in a private chat, its ID in the bot's message box, by which
   * accounts address private messages; in a supergroup, the supergroup's ID.
   */
  readonly messageId: number;
  /** As for `BotMessagePin`. */
  readonly isSilent: boolean;
}

/** An account's unpin of a message of its private chat with a bot, or of a supergroup. */
export interface AccountMessageUnpin {
  readonly fromAccountId: number;
  readonly chat: ChatAddress;
  /** As for `BotMessageUnpin`, by the ID `AccountMessagePin` describes. */
  readonly messageId?: number;
}

/** An account's unpin of every pinned message of its private chat with a bot, or of a supergroup. */
export interface AccountChatMessagesUnpin {
  readonly fromAccountId: number;
  readonly chat: ChatAddress;
}

export interface GetPinnedMessagesInput {
  readonly accountId: number;
  readonly chat: ChatAddress;
}

/**
 * The types by which one pinner's pins in a chat of one type differ from the others, which the
 * pinning operations report precisely: how the chat is addressed, what reaching it finds, and why
 * the chat is not reached or its pins may not be changed.
 */
interface PinningTargetingTypes {
  readonly address: ChatAddress;
  /** The chat reached to change its pins, with what deciding about them needs to know. */
  readonly reached: { readonly key: ChatKey };
  /** Why the pinner does not reach the chat to change its pins. */
  readonly accessFailureReason: string;
  /** Why the pinner, having reached the chat, may not change its pins. */
  readonly rightFailureReason: string;
}

/**
 * How one pinner reaches a chat of one type to change its pins, whether it may, and how its pin
 * is recorded. Every change reaches the chat first, then finds the message, then checks the right
 * to pin, as TDLib's `pin_dialog_message` orders them.
 */
interface PinningTargeting<Types extends PinningTargetingTypes> {
  /** Reaches the chat to change its pins, checking the pinner's access in the chat's order. */
  reachChatToChangePins(
    pinnerId: number,
    chat: Types['address'],
  ):
    | ({ readonly reached: true } & Types['reached'])
    | { readonly reached: false; readonly reason: Types['accessFailureReason'] };
  /** Finds a message of the reached chat by its chat message ID. */
  findMessage(reached: Types['reached'], messageId: number): ChatMessage | undefined;
  /** Why the pinner may not change the reached chat's pins; `undefined` when it may. */
  findRightRefusal(reached: Types['reached']): Types['rightFailureReason'] | undefined;
  /** Records the pin as the pinner's service message of the chat. */
  recordPin(
    reached: Types['reached'],
    pinnerId: number,
    pinnedMessageId: CanonicalMessageId,
    isSilent: boolean,
  ): void;
}

/** A supergroup a pinner reached as a member, with whether it may pin there. */
interface ReachedSupergroupForPins {
  readonly key: SupergroupChatKey;
  /** Whether the pinner holds the `can_pin_messages` permission there. */
  readonly canPinMessages: boolean;
}

/**
 * A bot reaches its private chat once the account exists and has started the chat, and may then
 * change its pins unless the account blocks the bot: a join request's contact grant lets the bot
 * write there, but not pin. Either participant pins any of the chat's messages.
 */
export interface BotPrivateChatPinningTypes {
  readonly address: PrivateChatAddress;
  readonly reached: { readonly key: PrivateChatKey };
  readonly accessFailureReason: 'account_not_found' | 'conversation_not_started' | 'bot_blocked';
  readonly rightFailureReason: never;
}

/**
 * A bot reaches a supergroup as a member, as the official Bot API server's `check_chat` requires,
 * and changes its pins with the `can_pin_messages` permission.
 */
export interface BotSupergroupPinningTypes {
  readonly address: SupergroupChatAddress;
  readonly reached: ReachedSupergroupForPins;
  readonly accessFailureReason: SupergroupBotAccessFailureReason;
  readonly rightFailureReason: 'not_enough_rights';
}

/**
 * An account reaches its private chat with an existing bot, started or not, and changes its pins
 * unless it blocks the bot: as for their messages, neither participant then writes there. It
 * reads the chat's pins either way.
 */
export interface AccountPrivateChatPinningTypes {
  readonly address: PrivateChatAddress;
  readonly reached: { readonly key: PrivateChatKey };
  /** `chat_not_found`: no such bot exists. */
  readonly accessFailureReason: 'chat_not_found' | 'bot_blocked';
  readonly rightFailureReason: never;
}

/**
 * An account reaches a supergroup as a member, to read its pins or to change them with the
 * `can_pin_messages` permission.
 */
export interface AccountSupergroupPinningTypes {
  readonly address: SupergroupChatAddress;
  readonly reached: ReachedSupergroupForPins;
  readonly accessFailureReason: 'chat_not_found' | 'not_a_member';
  readonly rightFailureReason: 'not_enough_rights';
}

/** Why a pin or an unpin of a message changed nothing, in the order Telegram checks. */
type PinChangeFailureReason<Types extends PinningTargetingTypes, PinnerFailureReason> =
  | PinnerFailureReason
  | Types['accessFailureReason']
  /** No such message is in the chat; for an unpin without a target, no message is pinned. */
  | 'message_not_found'
  | Types['rightFailureReason']
  /** The message records a change of its chat, which TDLib's `can_pin_message` refuses. */
  | 'service_message_not_pinnable';

export type MessagePinResult<Types extends PinningTargetingTypes, PinnerFailureReason> =
  | { readonly pinned: true }
  | {
    readonly pinned: false;
    /** `message_already_pinned`: Telegram's servers refuse a pin that changes nothing. */
    readonly reason:
      | PinChangeFailureReason<Types, PinnerFailureReason>
      | 'message_already_pinned';
  };

export type MessageUnpinResult<Types extends PinningTargetingTypes, PinnerFailureReason> =
  | { readonly unpinned: true }
  | {
    readonly unpinned: false;
    /** `message_not_pinned`: Telegram's servers refuse an unpin that changes nothing. */
    readonly reason: PinChangeFailureReason<Types, PinnerFailureReason> | 'message_not_pinned';
  };

export type ChatMessagesUnpinResult<Types extends PinningTargetingTypes, PinnerFailureReason> =
  /** The chat pins nothing now, including when it pinned nothing before. */
  | { readonly unpinned: true }
  | {
    readonly unpinned: false;
    /** As for a single unpin, except that no message is looked up. */
    readonly reason:
      | PinnerFailureReason
      | Types['accessFailureReason']
      | Types['rightFailureReason'];
  };

/** The pinning types of a bot's chats, of either type. */
type BotPinningTypes = BotPrivateChatPinningTypes | BotSupergroupPinningTypes;

/** The pinning types of an account's chats, of either type. */
type AccountPinningTypes = AccountPrivateChatPinningTypes | AccountSupergroupPinningTypes;

/** The failure of a bot whose identity no longer exists. */
type BotNotFoundReason = 'bot_not_found';

/** The failure of an account whose identity does not exist. */
type PinnerNotFoundReason = 'pinner_not_found';

export type BotMessagePinResult = MessagePinResult<BotPinningTypes, BotNotFoundReason>;
export type BotMessageUnpinResult = MessageUnpinResult<BotPinningTypes, BotNotFoundReason>;
export type BotChatMessagesUnpinResult = ChatMessagesUnpinResult<
  BotPinningTypes,
  BotNotFoundReason
>;
export type AccountMessagePinResult = MessagePinResult<AccountPinningTypes, PinnerNotFoundReason>;
export type AccountMessageUnpinResult = MessageUnpinResult<
  AccountPinningTypes,
  PinnerNotFoundReason
>;
export type AccountChatMessagesUnpinResult = ChatMessagesUnpinResult<
  AccountPinningTypes,
  PinnerNotFoundReason
>;

export type GetPinnedMessagesResult =
  | {
    readonly found: true;
    /** The chat's pinned messages, newest first. */
    readonly messages: readonly ChatMessage[];
  }
  | {
    readonly found: false;
    /** As for an account's pin, except that blocking the bot keeps no account from reading. */
    readonly reason: PinnerNotFoundReason | 'chat_not_found' | 'not_a_member';
  };

interface AccountLookup {
  getById(accountId: number): VirtualAccount | undefined;
}

interface BotLookup {
  getById(botId: number): VirtualBot | undefined;
}

interface PrivatePinServiceMessages {
  recordServiceMessage(input: {
    readonly conversation: PrivateConversationKey;
    readonly sender: PrivateConversationRole;
    readonly content: MessagePinnedContent;
    readonly isSilent: boolean;
  }): PrivateMessage;
}

interface SupergroupPinServiceMessages {
  recordServiceMessage(input: {
    readonly chatId: number;
    readonly sender: SupergroupMessageSender;
    readonly content: MessagePinnedContent;
    readonly changedAtUnixSeconds: number;
    readonly isSilent: boolean;
  }): SupergroupMessage;
}

interface PinnedMessageStore {
  getChatMessages<Type extends ChatType>(
    chat: ChatKeyOfType<Type>,
  ): readonly ChatMessageOfType<Type>[];
  setMessagePinned(messageId: CanonicalMessageId, isPinned: boolean): ChatMessage;
}

/** The private chat policy's rules that pinning asks for. */
type PrivateChatPinningPolicy =
  & PrivateChatIdentityPolicy
  & Pick<PrivateChatAccessPredicates, 'isConversationStarted' | 'isBotBlocked'>
  & ChatMessageLookup<PrivateChatKey, PrivateMessage>;

/** The supergroup policy's rules that pinning asks for. */
type SupergroupPinningPolicy =
  & SupergroupIdentityPolicy
  & SupergroupAccessPredicates
  & ChatMessageLookup<SupergroupChatKey, SupergroupMessage>;

interface MessagePinningServiceDependencies {
  readonly accounts: AccountLookup;
  readonly bots: BotLookup;
  readonly privateChats: PrivateChatPinningPolicy;
  readonly supergroups: SupergroupPinningPolicy;
  /** Records the service messages of pins in private chats. */
  readonly privateMessages: PrivatePinServiceMessages;
  /** Records the service messages of pins in supergroups. */
  readonly supergroupMessages: SupergroupPinServiceMessages;
  readonly messages: PinnedMessageStore;
  readonly currentUnixTimeSeconds: () => number;
}

/**
 * Pins and unpins messages of private chats and supergroups, for accounts and bots alike, and
 * reads which messages a chat pins.
 *
 * As on Telegram, a chat pins any number of its messages, each marked as pinned, so the pinned
 * messages are those of the chat's current history that carry the mark; deleting a message
 * unpins it. Either participant of a private chat pins and unpins any of its messages; in a
 * supergroup, the pinner needs the `can_pin_messages` permission, as `canPinSupergroupMessages`
 * decides it. Service messages are never pinned. Each pin is recorded as a service message of the
 * pinner, which the chat's bots receive; an unpin records nothing, as Telegram has no service
 * message for it.
 *
 * Each pinner has its own entry points, which select the chat type's targeting by the address and
 * report exactly the failures that pinner can meet, in Telegram's order.
 */
export class MessagePinningService {
  readonly #accounts: AccountLookup;
  readonly #bots: BotLookup;
  readonly #messages: PinnedMessageStore;
  readonly #botPrivateChatTargeting: PinningTargeting<BotPrivateChatPinningTypes>;
  readonly #botSupergroupTargeting: PinningTargeting<BotSupergroupPinningTypes>;
  readonly #accountPrivateChatTargeting: PinningTargeting<AccountPrivateChatPinningTypes>;
  readonly #accountSupergroupTargeting: PinningTargeting<AccountSupergroupPinningTypes>;
  readonly #privateChats: PrivateChatPinningPolicy;
  readonly #supergroups: SupergroupPinningPolicy;

  constructor(
    {
      accounts,
      bots,
      privateChats,
      supergroups,
      privateMessages,
      supergroupMessages,
      messages,
      currentUnixTimeSeconds,
    }: MessagePinningServiceDependencies,
  ) {
    this.#accounts = accounts;
    this.#bots = bots;
    this.#messages = messages;
    this.#privateChats = privateChats;
    this.#supergroups = supergroups;
    this.#botPrivateChatTargeting = {
      ...createPrivateChatPinning(privateChats, privateMessages, 'bot'),
      reachChatToChangePins: (botId, chat) => {
        const identification = privateChats.identifyChatForBot(botId, chat);
        if (!identification.identified) {
          return { reached: false, reason: identification.reason };
        }
        const { key } = identification;
        if (!privateChats.isConversationStarted(key)) {
          return { reached: false, reason: 'conversation_not_started' };
        }
        return privateChats.isBotBlocked(key)
          ? { reached: false, reason: 'bot_blocked' }
          : { reached: true, key };
      },
    };
    this.#botSupergroupTargeting = {
      ...createSupergroupPinning(
        supergroups,
        supergroupMessages,
        currentUnixTimeSeconds,
        (botId) => ({ kind: 'bot', botId }),
      ),
      reachChatToChangePins: (botId, chat) => {
        const identification = supergroups.identifyChatForBot(botId, chat);
        if (!identification.identified) {
          return { reached: false, reason: identification.reason };
        }
        const membership = supergroups.resolveBotMembership(botId, identification.supergroup);
        return membership.member
          ? {
            reached: true,
            key: identification.key,
            canPinMessages: canPinSupergroupMessages(
              identification.supergroup,
              membership.membership,
              { isBot: true },
            ),
          }
          : { reached: false, reason: membership.reason };
      },
    };
    this.#accountPrivateChatTargeting = {
      ...createPrivateChatPinning(privateChats, privateMessages, 'account'),
      reachChatToChangePins: (accountId, chat) => {
        const identification = privateChats.identifyChatForAccount(accountId, chat);
        if (!identification.identified) {
          return { reached: false, reason: 'chat_not_found' };
        }
        return privateChats.isBotBlocked(identification.key)
          ? { reached: false, reason: 'bot_blocked' }
          : { reached: true, key: identification.key };
      },
    };
    this.#accountSupergroupTargeting = {
      ...createSupergroupPinning(
        supergroups,
        supergroupMessages,
        currentUnixTimeSeconds,
        (accountId) => ({ kind: 'account', accountId }),
      ),
      reachChatToChangePins: (accountId, chat) => {
        const reach = reachSupergroupAsMember(supergroups, accountId, chat);
        return reach.reached
          ? {
            reached: true,
            key: reach.key,
            canPinMessages: canPinSupergroupMessages(reach.supergroup, reach.membership, {
              isBot: false,
            }),
          }
          : reach;
      },
    };
  }

  /**
   * Adds a message of a bot's chat to the chat's pinned messages, as `#pinMessage` checks it. The
   * bot receives the pin's service message, as the official server's `need_skip_update_message`
   * keeps a bot's own pins.
   */
  pinMessageByBot({ fromBotId, chat, ...pin }: BotMessagePin): BotMessagePinResult {
    if (this.#bots.getById(fromBotId) === undefined) {
      return { pinned: false, reason: 'bot_not_found' };
    }
    return chat.type === 'private'
      ? this.#pinMessage(this.#botPrivateChatTargeting, { pinnerId: fromBotId, chat, ...pin })
      : this.#pinMessage(this.#botSupergroupTargeting, { pinnerId: fromBotId, chat, ...pin });
  }

  /** Adds a message of an account's chat to the chat's pinned messages, as `#pinMessage` checks it. */
  pinMessageByAccount(
    { fromAccountId, chat, ...pin }: AccountMessagePin,
  ): AccountMessagePinResult {
    if (this.#accounts.getById(fromAccountId) === undefined) {
      return { pinned: false, reason: 'pinner_not_found' };
    }
    return chat.type === 'private'
      ? this.#pinMessage(this.#accountPrivateChatTargeting, {
        pinnerId: fromAccountId,
        chat,
        ...pin,
      })
      : this.#pinMessage(this.#accountSupergroupTargeting, {
        pinnerId: fromAccountId,
        chat,
        ...pin,
      });
  }

  /** Removes a message of a bot's chat from its pinned messages, as `#unpinMessage` checks it. */
  unpinMessageByBot({ fromBotId, chat, messageId }: BotMessageUnpin): BotMessageUnpinResult {
    if (this.#bots.getById(fromBotId) === undefined) {
      return { unpinned: false, reason: 'bot_not_found' };
    }
    return chat.type === 'private'
      ? this.#unpinMessage(this.#botPrivateChatTargeting, fromBotId, chat, messageId)
      : this.#unpinMessage(this.#botSupergroupTargeting, fromBotId, chat, messageId);
  }

  /** Removes a message of an account's chat from its pinned messages, as `#unpinMessage` checks it. */
  unpinMessageByAccount(
    { fromAccountId, chat, messageId }: AccountMessageUnpin,
  ): AccountMessageUnpinResult {
    if (this.#accounts.getById(fromAccountId) === undefined) {
      return { unpinned: false, reason: 'pinner_not_found' };
    }
    return chat.type === 'private'
      ? this.#unpinMessage(this.#accountPrivateChatTargeting, fromAccountId, chat, messageId)
      : this.#unpinMessage(this.#accountSupergroupTargeting, fromAccountId, chat, messageId);
  }

  /** Removes every message of a bot's chat from its pinned messages, as `#unpinAllMessages` does. */
  unpinAllMessagesByBot({ fromBotId, chat }: BotChatMessagesUnpin): BotChatMessagesUnpinResult {
    if (this.#bots.getById(fromBotId) === undefined) {
      return { unpinned: false, reason: 'bot_not_found' };
    }
    return chat.type === 'private'
      ? this.#unpinAllMessages(this.#botPrivateChatTargeting, fromBotId, chat)
      : this.#unpinAllMessages(this.#botSupergroupTargeting, fromBotId, chat);
  }

  /**
   * Removes every message of an account's chat from its pinned messages, as `#unpinAllMessages`
   * does.
   */
  unpinAllMessagesByAccount(
    { fromAccountId, chat }: AccountChatMessagesUnpin,
  ): AccountChatMessagesUnpinResult {
    if (this.#accounts.getById(fromAccountId) === undefined) {
      return { unpinned: false, reason: 'pinner_not_found' };
    }
    return chat.type === 'private'
      ? this.#unpinAllMessages(this.#accountPrivateChatTargeting, fromAccountId, chat)
      : this.#unpinAllMessages(this.#accountSupergroupTargeting, fromAccountId, chat);
  }

  /**
   * Returns the pinned messages of an account's private chat with a bot, or of a supergroup the
   * account is a member of, newest first, as Telegram's search for pinned messages lists them. An
   * account that blocks the bot still reads its private chat's pins.
   */
  getPinnedMessages({ accountId, chat }: GetPinnedMessagesInput): GetPinnedMessagesResult {
    if (this.#accounts.getById(accountId) === undefined) {
      return { found: false, reason: 'pinner_not_found' };
    }
    const reach = this.#reachChatToReadPins(accountId, chat);
    return reach.reached
      ? { found: true, messages: this.#listPinnedMessages(reach.key) }
      : { found: false, reason: reach.reason };
  }

  /**
   * Returns a chat's newest pinned message, which the Bot API's `getChat` shows as the most recent
   * pinned message by sending date, as TDLib's `last_pinned_message_id` is the greatest pinned
   * message ID; `undefined` when the chat pins none. The caller checks the reader's access.
   */
  findNewestPinnedMessage(chat: ChatKey): ChatMessage | undefined {
    return this.#listPinnedMessages(chat)[0];
  }

  /**
   * Reaches an account's chat to read its pins: its private chat with an existing bot, blocked or
   * not, or a supergroup it is a member of.
   */
  #reachChatToReadPins(
    accountId: number,
    chat: ChatAddress,
  ):
    | { readonly reached: true; readonly key: ChatKey }
    | { readonly reached: false; readonly reason: 'chat_not_found' | 'not_a_member' } {
    if (chat.type === 'private') {
      const identification = this.#privateChats.identifyChatForAccount(accountId, chat);
      return identification.identified
        ? { reached: true, key: identification.key }
        : { reached: false, reason: 'chat_not_found' };
    }
    const reach = reachSupergroupAsMember(this.#supergroups, accountId, chat);
    return reach.reached ? { reached: true, key: reach.key } : reach;
  }

  /**
   * Pins a message, as TDLib's `pin_dialog_message` checks it: the pinner must reach the chat and
   * find the message there, then hold the right to pin, and the message must not be a service
   * message. Telegram's servers refuse to pin a pinned message. The pin is recorded as the
   * pinner's service message, which in a private chat notifies without sound, as the Bot API
   * documents notifications there to be always disabled.
   */
  #pinMessage<Types extends PinningTargetingTypes>(
    targeting: PinningTargeting<Types>,
    { pinnerId, chat, messageId, isSilent }: {
      readonly pinnerId: number;
      readonly chat: Types['address'];
      readonly messageId: number;
      readonly isSilent: boolean;
    },
  ): MessagePinResult<Types, never> {
    const reach = targeting.reachChatToChangePins(pinnerId, chat);
    if (!reach.reached) {
      return { pinned: false, reason: reach.reason };
    }
    const message = targeting.findMessage(reach, messageId);
    if (message === undefined) {
      return { pinned: false, reason: 'message_not_found' };
    }
    const refusal = findPinChangeRefusal(targeting, reach, message);
    if (refusal !== undefined) {
      return { pinned: false, reason: refusal };
    }
    if (message.isPinned) {
      return { pinned: false, reason: 'message_already_pinned' };
    }
    const pinnedMessage = this.#messages.setMessagePinned(message.id, true);
    targeting.recordPin(reach, pinnerId, pinnedMessage.id, isSilent);
    return { pinned: true };
  }

  /**
   * Unpins a message, as TDLib's `pin_dialog_message` checks an unpin: as for a pin, so a service
   * message is refused even though it is never pinned. Without a target, the newest pinned
   * message is unpinned, as the official Bot API server finds it with `getChatPinnedMessage`.
   * Telegram's servers refuse to unpin a message that is not pinned.
   */
  #unpinMessage<Types extends PinningTargetingTypes>(
    targeting: PinningTargeting<Types>,
    pinnerId: number,
    chat: Types['address'],
    messageId: number | undefined,
  ): MessageUnpinResult<Types, never> {
    const reach = targeting.reachChatToChangePins(pinnerId, chat);
    if (!reach.reached) {
      return { unpinned: false, reason: reach.reason };
    }
    const message = messageId === undefined
      ? this.#listPinnedMessages(reach.key)[0]
      : targeting.findMessage(reach, messageId);
    if (message === undefined) {
      return { unpinned: false, reason: 'message_not_found' };
    }
    const refusal = findPinChangeRefusal(targeting, reach, message);
    if (refusal !== undefined) {
      return { unpinned: false, reason: refusal };
    }
    if (!message.isPinned) {
      return { unpinned: false, reason: 'message_not_pinned' };
    }
    this.#messages.setMessagePinned(message.id, false);
    return { unpinned: true };
  }

  /**
   * Unpins every message of a chat, whoever wrote or pinned it, as TDLib's
   * `unpin_all_dialog_messages` checks it: the pinner must reach the chat and hold the right to
   * pin, both checked before any pin changes, whether the chat pins messages or none. A chat that
   * pins nothing is left as it is and the call succeeds, an emulator policy: Telegram's answer
   * there is not established, and a bot that resets a chat's pins need not know whether any are
   * left. As for a single unpin, no service message records it.
   */
  #unpinAllMessages<Types extends PinningTargetingTypes>(
    targeting: PinningTargeting<Types>,
    pinnerId: number,
    chat: Types['address'],
  ): ChatMessagesUnpinResult<Types, never> {
    const reach = targeting.reachChatToChangePins(pinnerId, chat);
    if (!reach.reached) {
      return { unpinned: false, reason: reach.reason };
    }
    const refusal = targeting.findRightRefusal(reach);
    if (refusal !== undefined) {
      return { unpinned: false, reason: refusal };
    }
    for (const message of this.#listPinnedMessages(reach.key)) {
      this.#messages.setMessagePinned(message.id, false);
    }
    return { unpinned: true };
  }

  /** A chat's pinned messages, newest first: its history lists messages oldest first. */
  #listPinnedMessages(chat: ChatKey): readonly ChatMessage[] {
    return this.#messages.getChatMessages(chat).filter((message) => message.isPinned).reverse();
  }
}

/**
 * How a private chat's messages are found and its pins recorded, for a pinner in the given role.
 * Either participant may change the chat's pins, and every pin notifies without sound.
 */
function createPrivateChatPinning(
  privateChats: PrivateChatPinningPolicy,
  privateMessages: PrivatePinServiceMessages,
  pinnerRole: PrivateConversationRole,
): Pick<
  PinningTargeting<BotPrivateChatPinningTypes | AccountPrivateChatPinningTypes>,
  'findMessage' | 'findRightRefusal' | 'recordPin'
> {
  return {
    findMessage: ({ key }, messageId) => privateChats.findMessageByChatMessageId(key, messageId),
    findRightRefusal: () => undefined,
    recordPin: ({ key }, _pinnerId, pinnedMessageId) => {
      privateMessages.recordServiceMessage({
        conversation: key.conversation,
        sender: pinnerRole,
        content: { kind: 'message_pinned', pinnedMessageId },
        isSilent: true,
      });
    },
  };
}

/**
 * How a supergroup's messages are found and its pins recorded, for a pinner of one kind, whose ID
 * `toPinner` makes the actor that authors the pin. A member changes the supergroup's pins with the
 * `can_pin_messages` permission, and its pin notifies the members without sound when it asks.
 */
function createSupergroupPinning(
  supergroups: SupergroupPinningPolicy,
  supergroupMessages: SupergroupPinServiceMessages,
  currentUnixTimeSeconds: () => number,
  toPinner: (pinnerId: number) => ChatActor,
): Pick<
  PinningTargeting<BotSupergroupPinningTypes | AccountSupergroupPinningTypes>,
  'findMessage' | 'findRightRefusal' | 'recordPin'
> {
  return {
    findMessage: ({ key }, messageId) => supergroups.findMessageByChatMessageId(key, messageId),
    findRightRefusal: ({ canPinMessages }) => canPinMessages ? undefined : 'not_enough_rights',
    recordPin: ({ key }, pinnerId, pinnedMessageId, isSilent) => {
      supergroupMessages.recordServiceMessage({
        chatId: key.chatId,
        sender: toPinner(pinnerId),
        content: { kind: 'message_pinned', pinnedMessageId },
        changedAtUnixSeconds: currentUnixTimeSeconds(),
        isSilent,
      });
    },
  };
}

/** Reaches a supergroup as an account that is a member, with its standing there. */
function reachSupergroupAsMember(
  supergroups: SupergroupPinningPolicy,
  accountId: number,
  chat: SupergroupChatAddress,
):
  | {
    readonly reached: true;
    readonly key: SupergroupChatKey;
    readonly supergroup: Supergroup;
    readonly membership: ChatMembership;
  }
  | { readonly reached: false; readonly reason: 'chat_not_found' | 'not_a_member' } {
  const identification = supergroups.identifyChatForAccount(accountId, chat);
  if (!identification.identified) {
    return { reached: false, reason: identification.reason };
  }
  const { key, supergroup } = identification;
  const membership = supergroups.resolveAccountMembership(accountId, supergroup);
  return membership.member
    ? { reached: true, key, supergroup, membership: membership.membership }
    : { reached: false, reason: membership.reason };
}

/**
 * Whether a member may pin and unpin a supergroup's messages: as `getEffectiveChatPermissions`
 * decides `can_pin_messages`, except that, as the Bot API documents for that permission, a public
 * supergroup ignores its default permissions, so only the owner and administrators with the right
 * pin there.
 */
function canPinSupergroupMessages(
  supergroup: Supergroup,
  membership: ChatMembership,
  { isBot }: { readonly isBot: boolean },
): boolean {
  if (supergroup.username !== undefined) {
    return holdsSupergroupAdministratorRight(membership, 'can_pin_messages');
  }
  return getEffectiveChatPermissions(membership, {
    defaultPermissions: supergroup.defaultPermissions,
    isBot,
  }).has('can_pin_messages');
}

/**
 * Why a pinner that found a message may not pin or unpin it, in the order of TDLib's
 * `can_pin_message`: the right to pin comes first, then the message must not be a service message.
 */
function findPinChangeRefusal<Types extends PinningTargetingTypes>(
  targeting: PinningTargeting<Types>,
  reached: Types['reached'],
  message: ChatMessage,
): Types['rightFailureReason'] | 'service_message_not_pinnable' | undefined {
  return targeting.findRightRefusal(reached) ??
    (isContentMessage(message) ? undefined : 'service_message_not_pinnable');
}
