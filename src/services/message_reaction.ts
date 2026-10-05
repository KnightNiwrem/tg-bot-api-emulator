import type { ChatDomainEvent } from '../types/chat_domain_event.ts';
import {
  type ChatMembership,
  getEffectiveChatPermissions,
  resolveSupergroupBotMembership,
  type SupergroupBotAccessFailureReason,
  type SupergroupMembershipLookup,
} from '../types/chat_membership.ts';
import {
  isReactionEmoji,
  isSameReactionEmojis,
  type ReactionEmoji,
  type UserReaction,
} from '../types/message_reaction.ts';
import type { VirtualAccount } from '../types/virtual_account.ts';
import type { VirtualBot } from '../types/virtual_bot.ts';
import type { Supergroup } from '../types/virtual_chat.ts';
import {
  type CanonicalMessageId,
  isSupergroupContentMessage,
  type SupergroupMessage,
} from '../types/virtual_message.ts';

/**
 * The most reactions one user may choose for a message: Telegram's `reactions_user_max_default`
 * client option for users without Premium, which emulated accounts and bots never have. The Bot
 * API documents the same limit for bots: "as non-premium users, bots can set up to one reaction
 * per message".
 */
const MAX_REACTIONS_PER_USER = 1;

/**
 * The most distinct reactions a message may show: Telegram's `reactions_uniq_max` client option,
 * which also bounds a chat's `max_reaction_count`. Once a message shows this many, only reactions
 * it already shows can be chosen, as TDLib's `get_message_available_reactions` allows.
 */
export const MAX_DISTINCT_REACTIONS_PER_MESSAGE = 11;

/** A supergroup message, as an account that is a member of the supergroup addresses it. */
export interface AccountReactionMessageKey {
  readonly accountId: number;
  readonly chatId: number;
  /** The ID of the message, as the supergroup numbers it for its members. */
  readonly messageId: number;
}

export interface SetAccountMessageReactionInput extends AccountReactionMessageKey {
  /** The emoji the account chooses, in order; none removes its reactions. */
  readonly emojis: readonly string[];
}

export interface SetBotMessageReactionInput {
  readonly botId: number;
  readonly chatId: number;
  /** The ID of the message, as the supergroup numbers it for its members. */
  readonly messageId: number;
  /** The emoji the bot chooses, in order; none removes its reactions. */
  readonly emojis: readonly string[];
}

/** Why an account cannot find a message to react to or inspect. */
export type AccountReactionMessageLookupFailureReason =
  | 'account_not_found'
  | 'chat_not_found'
  | 'not_a_member'
  | 'message_not_found';

/**
 * Why a member cannot choose reactions for a message it found:
 *
 * - `message_not_reactable`: the message is a service message. Telegram's servers decide per
 *   message whether a service message accepts reactions; the emulator accepts them only on content.
 * - `reaction_not_permitted`: the member lacks the `can_react_to_messages` permission.
 * - `reaction_emoji_unsupported`: an emoji is not one of `REACTION_EMOJIS`.
 * - `too_many_reactions`: more than `MAX_REACTIONS_PER_USER` reactions.
 * - `too_many_distinct_reactions`: the message already shows `MAX_DISTINCT_REACTIONS_PER_MESSAGE`
 *   distinct reactions, and an emoji is not among them.
 */
export type ReactionChoiceFailureReason =
  | 'message_not_reactable'
  | 'reaction_not_permitted'
  | 'reaction_emoji_unsupported'
  | 'too_many_reactions'
  | 'too_many_distinct_reactions';

/** A message's reactions, as found through any message of its album. */
export interface MessageReactions {
  /** The message that holds the reactions: for an album, its first message that is not deleted. */
  readonly message: SupergroupMessage;
  /** One entry per reacting user, in the order the users last changed their reactions. */
  readonly reactions: readonly UserReaction[];
}

export type GetAccountMessageReactionsResult =
  | ({ readonly found: true } & MessageReactions)
  | { readonly found: false; readonly reason: AccountReactionMessageLookupFailureReason };

export type SetAccountMessageReactionResult =
  | ({ readonly set: true } & MessageReactions)
  | {
    readonly set: false;
    readonly reason: AccountReactionMessageLookupFailureReason | ReactionChoiceFailureReason;
  };

export type SetBotMessageReactionResult =
  | { readonly set: true }
  | {
    readonly set: false;
    readonly reason:
      | 'bot_not_found'
      | SupergroupBotAccessFailureReason
      | 'message_not_found'
      | ReactionChoiceFailureReason;
  };

interface AccountLookup {
  getById(accountId: number): VirtualAccount | undefined;
}

interface BotLookup {
  getById(botId: number): VirtualBot | undefined;
}

interface SupergroupMessageLookup {
  getMessageByChatMessageId(chatId: number, messageId: number): SupergroupMessage | undefined;
}

interface SupergroupMessageReactionStore {
  getSupergroupMessages(chatId: number): readonly SupergroupMessage[];
  setSupergroupMessageReactions(
    messageId: CanonicalMessageId,
    reactions: readonly UserReaction[],
  ): SupergroupMessage;
}

interface ChatDomainEventSink {
  publish(event: ChatDomainEvent): void;
}

interface MessageReactionServiceDependencies {
  readonly accounts: AccountLookup;
  readonly bots: BotLookup;
  readonly sharedChats: SupergroupMembershipLookup;
  readonly supergroupMessages: SupergroupMessageLookup;
  readonly messages: SupergroupMessageReactionStore;
  readonly events: ChatDomainEventSink;
  readonly currentUnixTimeSeconds: () => number;
}

/** A member, its standing, and the supergroup message it chooses reactions for. */
interface ReactionChoiceContext {
  readonly reactorId: number;
  readonly isBot: boolean;
  readonly supergroup: Supergroup;
  readonly membership: ChatMembership;
  /** The message that holds the reactions, as `#findReactionHolder` finds it. */
  readonly message: SupergroupMessage;
}

type ReactionChoiceResult =
  | {
    readonly chosen: true;
    readonly message: SupergroupMessage;
    readonly oldEmojis: readonly ReactionEmoji[];
    readonly newEmojis: readonly ReactionEmoji[];
  }
  | { readonly chosen: false; readonly reason: ReactionChoiceFailureReason };

/**
 * Carries out the ordinary emoji reactions that members of supergroups choose for content
 * messages, as an account's client and the Bot API's `setMessageReaction` choose them, replacing
 * the member's earlier reactions to the message.
 *
 * A message of an album takes no reactions of its own: as the Bot API documents for
 * `setMessageReaction`, they go to the album's first message that is not deleted, which also holds
 * the reactions an inspection shows. Each change of an account's reactions is published for the
 * supergroup's administrator bots to observe; a bot's reactions are stored for inspection but
 * published to no one, as the Bot API documents that `message_reaction` updates are not received
 * for reactions set by bots. A choice that changes nothing publishes nothing.
 */
export class MessageReactionService {
  readonly #accounts: AccountLookup;
  readonly #bots: BotLookup;
  readonly #sharedChats: SupergroupMembershipLookup;
  readonly #supergroupMessages: SupergroupMessageLookup;
  readonly #messages: SupergroupMessageReactionStore;
  readonly #events: ChatDomainEventSink;
  readonly #currentUnixTimeSeconds: () => number;

  constructor(
    {
      accounts,
      bots,
      sharedChats,
      supergroupMessages,
      messages,
      events,
      currentUnixTimeSeconds,
    }: MessageReactionServiceDependencies,
  ) {
    this.#accounts = accounts;
    this.#bots = bots;
    this.#sharedChats = sharedChats;
    this.#supergroupMessages = supergroupMessages;
    this.#messages = messages;
    this.#events = events;
    this.#currentUnixTimeSeconds = currentUnixTimeSeconds;
  }

  /** Returns the reactions of a supergroup message, as a member account sees them. */
  getAccountMessageReactions(key: AccountReactionMessageKey): GetAccountMessageReactionsResult {
    const resolution = this.#resolveAccountReactionContext(key);
    if (!resolution.resolved) {
      return { found: false, reason: resolution.reason };
    }
    const { message } = resolution.context;
    return { found: true, message, reactions: message.reactions ?? [] };
  }

  /**
   * Replaces an account's reactions to a supergroup message, after the checks of
   * `ReactionChoiceFailureReason`; no emoji remove them. A change is published with the account's
   * old and new reactions; choosing the reactions the account already chose changes nothing.
   *
   * A restricted account reacts only as far as its `can_react_to_messages` permission allows.
   * Telegram also lets a user that has not joined a public supergroup react where it could send
   * messages without joining; the emulator requires membership, as for every account action in a
   * supergroup.
   */
  setAccountMessageReaction(
    input: SetAccountMessageReactionInput,
  ): SetAccountMessageReactionResult {
    const resolution = this.#resolveAccountReactionContext(input);
    if (!resolution.resolved) {
      return { set: false, reason: resolution.reason };
    }
    const choice = this.#chooseReactions(resolution.context, input.emojis);
    if (!choice.chosen) {
      return { set: false, reason: choice.reason };
    }
    if (!isSameReactionEmojis(choice.oldEmojis, choice.newEmojis)) {
      this.#events.publish({
        type: 'message_reaction_changed',
        message: choice.message,
        accountId: input.accountId,
        oldEmojis: choice.oldEmojis,
        newEmojis: choice.newEmojis,
        changedAtUnixSeconds: this.#currentUnixTimeSeconds(),
      });
    }
    return { set: true, message: choice.message, reactions: choice.message.reactions ?? [] };
  }

  /**
   * Replaces a bot's reactions to a message of a supergroup it is a member of, as the Bot API's
   * `setMessageReaction` does after the official server's `check_message` found the message, with
   * the checks of `ReactionChoiceFailureReason`. No bot receives an update for it.
   */
  setBotMessageReaction(input: SetBotMessageReactionInput): SetBotMessageReactionResult {
    if (this.#bots.getById(input.botId) === undefined) {
      return { set: false, reason: 'bot_not_found' };
    }
    const botMembership = resolveSupergroupBotMembership(
      this.#sharedChats,
      input.botId,
      input.chatId,
    );
    if (!botMembership.resolved) {
      return { set: false, reason: botMembership.reason };
    }
    const message = this.#supergroupMessages.getMessageByChatMessageId(
      input.chatId,
      input.messageId,
    );
    if (message === undefined) {
      return { set: false, reason: 'message_not_found' };
    }
    const choice = this.#chooseReactions({
      reactorId: input.botId,
      isBot: true,
      supergroup: botMembership.supergroup,
      membership: botMembership.membership,
      message: this.#findReactionHolder(message),
    }, input.emojis);
    return choice.chosen ? { set: true } : { set: false, reason: choice.reason };
  }

  #resolveAccountReactionContext(
    { accountId, chatId, messageId }: AccountReactionMessageKey,
  ):
    | { readonly resolved: true; readonly context: ReactionChoiceContext }
    | { readonly resolved: false; readonly reason: AccountReactionMessageLookupFailureReason } {
    if (this.#accounts.getById(accountId) === undefined) {
      return { resolved: false, reason: 'account_not_found' };
    }
    const supergroup = this.#sharedChats.getSharedChat(chatId);
    if (supergroup?.kind !== 'supergroup') {
      return { resolved: false, reason: 'chat_not_found' };
    }
    const membership = this.#sharedChats.getChatMembership(chatId, accountId);
    if (membership === undefined) {
      return { resolved: false, reason: 'not_a_member' };
    }
    const message = this.#supergroupMessages.getMessageByChatMessageId(chatId, messageId);
    if (message === undefined) {
      return { resolved: false, reason: 'message_not_found' };
    }
    return {
      resolved: true,
      context: {
        reactorId: accountId,
        isBot: false,
        supergroup,
        membership,
        message: this.#findReactionHolder(message),
      },
    };
  }

  /**
   * Checks a member's choice of reactions for a message, as `checkReactionChoice` does, and stores
   * it, unless it changes nothing. The member's entry moves to the end of the message's reactions;
   * no emoji remove it.
   */
  #chooseReactions(
    context: ReactionChoiceContext,
    emojis: readonly string[],
  ): ReactionChoiceResult {
    const check = checkReactionChoice(context, emojis);
    if (!check.allowed) {
      return { chosen: false, reason: check.reason };
    }
    const { reactorId, message } = context;
    const newEmojis = check.emojis;
    const reactions = message.reactions ?? [];
    const oldEmojis = reactions.find((reaction) => reaction.userId === reactorId)?.emojis ?? [];
    if (isSameReactionEmojis(oldEmojis, newEmojis)) {
      return { chosen: true, message, oldEmojis, newEmojis };
    }
    const otherReactions = reactions.filter((reaction) => reaction.userId !== reactorId);
    const changedMessage = this.#messages.setSupergroupMessageReactions(
      message.id,
      newEmojis.length === 0
        ? otherReactions
        : [...otherReactions, { userId: reactorId, emojis: newEmojis }],
    );
    return { chosen: true, message: changedMessage, oldEmojis, newEmojis };
  }

  /**
   * The message that holds the reactions to a message: the message itself, or, for a message of
   * an album, the album's first message that is not deleted, as the Bot API documents it for
   * `setMessageReaction`. Deleting that message deletes the reactions it holds, and the album's
   * next message holds reactions from then on.
   */
  #findReactionHolder(message: SupergroupMessage): SupergroupMessage {
    if (message.mediaGroupId === undefined) {
      return message;
    }
    return this.#messages.getSupergroupMessages(message.chatId).find((chatMessage) =>
      chatMessage.mediaGroupId === message.mediaGroupId
    ) ?? message;
  }
}

/**
 * Checks the reactions a member chose for a message, in the order `ReactionChoiceFailureReason`
 * lists its reasons, and returns them as reaction emoji. Choosing none needs no check, since it
 * adds no reaction.
 */
function checkReactionChoice(
  { isBot, supergroup, membership, message }: Omit<ReactionChoiceContext, 'reactorId'>,
  emojis: readonly string[],
):
  | { readonly allowed: true; readonly emojis: readonly ReactionEmoji[] }
  | { readonly allowed: false; readonly reason: ReactionChoiceFailureReason } {
  if (emojis.length === 0) {
    return { allowed: true, emojis: [] };
  }
  if (!isSupergroupContentMessage(message)) {
    return { allowed: false, reason: 'message_not_reactable' };
  }
  const permissions = getEffectiveChatPermissions(membership, {
    defaultPermissions: supergroup.defaultPermissions,
    isBot,
  });
  if (!permissions.has('can_react_to_messages')) {
    return { allowed: false, reason: 'reaction_not_permitted' };
  }
  if (!emojis.every(isReactionEmoji)) {
    return { allowed: false, reason: 'reaction_emoji_unsupported' };
  }
  if (emojis.length > MAX_REACTIONS_PER_USER) {
    return { allowed: false, reason: 'too_many_reactions' };
  }
  const shownEmojis = new Set((message.reactions ?? []).flatMap((reaction) => reaction.emojis));
  if (
    shownEmojis.size >= MAX_DISTINCT_REACTIONS_PER_MESSAGE &&
    emojis.some((emoji) => !shownEmojis.has(emoji))
  ) {
    return { allowed: false, reason: 'too_many_distinct_reactions' };
  }
  return { allowed: true, emojis };
}
