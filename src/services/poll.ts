import type { ChatMembership } from '../types/chat_membership.ts';
import {
  checkPollAnswer,
  getVoterAnswer,
  type Poll,
  type PollAnswerFailureReason,
  type PollId,
  toChosenOptionPositions,
} from '../types/poll.ts';
import type { VirtualAccount } from '../types/virtual_account.ts';
import type { VirtualBot } from '../types/virtual_bot.ts';
import type {
  PrivateConversation,
  PrivateConversationKey,
  SharedChat,
} from '../types/virtual_chat.ts';
import type { ChatMessage, PrivateMessage, SupergroupMessage } from '../types/virtual_message.ts';

/**
 * The chat of a poll message as an account addresses it: its private chat with a bot, where the
 * bot's message box numbers messages, or a supergroup, which numbers its own messages.
 */
export type PollMessageChat =
  | { readonly type: 'private'; readonly botId: number }
  | { readonly type: 'supergroup'; readonly chatId: number };

/** A message showing a poll, as an account that can read its chat addresses it. */
export interface AccountPollMessageKey {
  readonly accountId: number;
  readonly chat: PollMessageChat;
  /** The ID of the message, as the chat numbers it for its bots. */
  readonly messageId: number;
}

export interface SetAccountPollAnswerInput extends AccountPollMessageKey {
  /**
   * The positions of the chosen options, counted from 0, in any order; a repeated position counts
   * once. None retracts the account's answer.
   */
  readonly optionPositions: readonly number[];
}

/**
 * Why an account cannot find a poll message: the account or bot does not exist, the supergroup
 * does not exist or the account is no member of it, the chat has no such message, or the message
 * shows no poll.
 */
export type PollMessageLookupFailureReason =
  | 'account_not_found'
  | 'bot_not_found'
  | 'chat_not_found'
  | 'not_a_member'
  | 'message_not_found'
  | 'message_has_no_poll';

/** A poll an account found through a message showing it, with the account's own answer. */
export interface AccountPollAnswer {
  readonly poll: Poll;
  readonly message: ChatMessage;
  /** The options the account chose, as positions in increasing order; none without an answer. */
  readonly chosenOptionPositions: readonly number[];
}

export type GetAccountPollAnswerResult =
  | ({ readonly found: true } & AccountPollAnswer)
  | { readonly found: false; readonly reason: PollMessageLookupFailureReason };

export type SetAccountPollAnswerResult =
  | ({ readonly answered: true } & AccountPollAnswer)
  | {
    readonly answered: false;
    readonly reason: PollMessageLookupFailureReason | PollAnswerFailureReason;
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

interface SupergroupLookup {
  getSharedChat(chatId: number): SharedChat | undefined;
  getChatMembership(chatId: number, identityId: number): ChatMembership | undefined;
}

interface SupergroupMessageLookup {
  getMessageByChatMessageId(chatId: number, messageId: number): SupergroupMessage | undefined;
}

interface PollAnswerStore {
  getPoll(pollId: PollId): Poll | undefined;
  setVoterAnswer(pollId: PollId, voterId: number, chosenOptionPositions: readonly number[]): Poll;
}

interface PollServiceDependencies {
  readonly accounts: AccountLookup;
  readonly bots: BotLookup;
  readonly privateConversations: PrivateConversationLookup;
  readonly privateMessages: PrivateMessageLookup;
  readonly sharedChats: SupergroupLookup;
  readonly supergroupMessages: SupergroupMessageLookup;
  readonly polls: PollAnswerStore;
}

type PollMessageResolution =
  | { readonly resolved: true; readonly message: ChatMessage; readonly poll: Poll }
  | { readonly resolved: false; readonly reason: PollMessageLookupFailureReason };

/**
 * Carries out accounts' votes in polls, as TDLib's `setPollAnswer` does for a user: an account
 * answers a poll shown by a message of its private chat with a bot or of a supergroup it is a
 * member of, changes its answer, or retracts it, as the poll allows. A forward shows the same
 * poll as the message it repeats, so a vote through either counts once in that poll.
 */
export class PollService {
  readonly #accounts: AccountLookup;
  readonly #bots: BotLookup;
  readonly #privateConversations: PrivateConversationLookup;
  readonly #privateMessages: PrivateMessageLookup;
  readonly #sharedChats: SupergroupLookup;
  readonly #supergroupMessages: SupergroupMessageLookup;
  readonly #polls: PollAnswerStore;

  constructor(
    {
      accounts,
      bots,
      privateConversations,
      privateMessages,
      sharedChats,
      supergroupMessages,
      polls,
    }: PollServiceDependencies,
  ) {
    this.#accounts = accounts;
    this.#bots = bots;
    this.#privateConversations = privateConversations;
    this.#privateMessages = privateMessages;
    this.#sharedChats = sharedChats;
    this.#supergroupMessages = supergroupMessages;
    this.#polls = polls;
  }

  /** Returns the poll a message shows to an account that can read it, with the account's answer. */
  getAccountPollAnswer(key: AccountPollMessageKey): GetAccountPollAnswerResult {
    const resolution = this.#resolvePollMessage(key);
    if (!resolution.resolved) {
      return { found: false, reason: resolution.reason };
    }
    const { message, poll } = resolution;
    return {
      found: true,
      poll,
      message,
      chosenOptionPositions: getVoterAnswer(poll, key.accountId),
    };
  }

  /**
   * Replaces an account's answer to the poll a message shows, after the poll's checks, which
   * `checkPollAnswer` makes; no options retract the answer. In a poll that allows revoting, an
   * answer that chooses the options the account already chose leaves the poll as it is; a poll
   * that disallows revoting refuses any answer from an account that has answered.
   */
  setAccountPollAnswer(input: SetAccountPollAnswerInput): SetAccountPollAnswerResult {
    const resolution = this.#resolvePollMessage(input);
    if (!resolution.resolved) {
      return { answered: false, reason: resolution.reason };
    }
    const { message, poll } = resolution;
    const chosenOptionPositions = toChosenOptionPositions(input.optionPositions);
    const answerFailure = checkPollAnswer(poll, input.accountId, chosenOptionPositions);
    if (answerFailure !== undefined) {
      return { answered: false, reason: answerFailure };
    }
    const previousOptionPositions = getVoterAnswer(poll, input.accountId);
    if (areSameOptionPositions(previousOptionPositions, chosenOptionPositions)) {
      return { answered: true, poll, message, chosenOptionPositions };
    }

    return {
      answered: true,
      poll: this.#polls.setVoterAnswer(poll.id, input.accountId, chosenOptionPositions),
      message,
      chosenOptionPositions,
    };
  }

  /**
   * Finds a message of a chat the account can read, as TDLib's `get_message_poll_id` does, and
   * the poll it shows. As for a callback button, the account's private chat with a bot is found
   * only once the account has started it.
   */
  #resolvePollMessage(
    { accountId, chat, messageId }: AccountPollMessageKey,
  ): PollMessageResolution {
    if (this.#accounts.getById(accountId) === undefined) {
      return { resolved: false, reason: 'account_not_found' };
    }
    const lookup = chat.type === 'private'
      ? this.#findPrivateMessage(accountId, chat.botId, messageId)
      : this.#findSupergroupMessage(accountId, chat.chatId, messageId);
    if (!lookup.found) {
      return { resolved: false, reason: lookup.reason };
    }
    const { message } = lookup;
    if (message.content.kind !== 'poll') {
      return { resolved: false, reason: 'message_has_no_poll' };
    }
    const poll = this.#polls.getPoll(message.content.pollId);
    if (poll === undefined) {
      throw new Error(`Poll ${message.content.pollId} of message ${message.id} does not exist`);
    }
    return { resolved: true, message, poll };
  }

  #findPrivateMessage(
    accountId: number,
    botId: number,
    botMessageId: number,
  ):
    | { readonly found: true; readonly message: ChatMessage }
    | { readonly found: false; readonly reason: 'bot_not_found' | 'message_not_found' } {
    if (this.#bots.getById(botId) === undefined) {
      return { found: false, reason: 'bot_not_found' };
    }
    const conversation: PrivateConversationKey = { accountId, botId };
    const message = this.#privateConversations.getPrivateConversation(conversation) === undefined
      ? undefined
      : this.#privateMessages.getPrivateMessageByBotMessageId(conversation, botMessageId);
    return message === undefined
      ? { found: false, reason: 'message_not_found' }
      : { found: true, message };
  }

  #findSupergroupMessage(
    accountId: number,
    chatId: number,
    messageId: number,
  ):
    | { readonly found: true; readonly message: ChatMessage }
    | {
      readonly found: false;
      readonly reason: 'chat_not_found' | 'not_a_member' | 'message_not_found';
    } {
    if (this.#sharedChats.getSharedChat(chatId)?.kind !== 'supergroup') {
      return { found: false, reason: 'chat_not_found' };
    }
    if (this.#sharedChats.getChatMembership(chatId, accountId) === undefined) {
      return { found: false, reason: 'not_a_member' };
    }
    const message = this.#supergroupMessages.getMessageByChatMessageId(chatId, messageId);
    return message === undefined
      ? { found: false, reason: 'message_not_found' }
      : { found: true, message };
  }
}

function areSameOptionPositions(
  first: readonly number[],
  second: readonly number[],
): boolean {
  return first.length === second.length &&
    first.every((optionPosition, index) => optionPosition === second[index]);
}
