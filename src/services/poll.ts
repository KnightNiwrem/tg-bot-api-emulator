import type { ChatDomainEvent } from '../types/chat_domain_event.ts';
import {
  checkPollAnswer,
  getVoterAnswer,
  type Poll,
  type PollAnswerFailureReason,
  type PollId,
  toChosenOptionPositions,
} from '../types/poll.ts';
import type { VirtualAccount } from '../types/virtual_account.ts';
import {
  canAccountEditMessage,
  canBotEditMessage,
  type ChatMessage,
} from '../types/virtual_message.ts';
import {
  type AccountChatMessageLookupFailureReason,
  type AccountChatMessageLookups,
  type AccountMessageChat,
  findAccountChatMessage,
} from './account_chat_message.ts';

/** The chat of a poll message, as an account addresses it. */
export type PollMessageChat = AccountMessageChat;

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
  | AccountChatMessageLookupFailureReason
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

/**
 * The result of a poll's closing time arriving: the closed poll, or why it cannot close that way:
 * no such poll, a poll without a closing time, which stays open until it is stopped, or a poll
 * that is already closed.
 */
export type ExpirePollResult =
  | { readonly expired: true; readonly poll: Poll }
  | {
    readonly expired: false;
    readonly reason: 'poll_not_found' | 'poll_without_closing_time' | 'poll_already_closed';
  };

/**
 * Why an account cannot stop the poll of a message it found: the account did not send the
 * message, as `canAccountEditMessage` decides, or the poll is already closed.
 */
export type AccountPollStopFailureReason = 'poll_not_stoppable' | 'poll_already_closed';

export type StopAccountPollResult =
  | { readonly stopped: true; readonly poll: Poll; readonly message: ChatMessage }
  | {
    readonly stopped: false;
    readonly reason: PollMessageLookupFailureReason | AccountPollStopFailureReason;
  };

export type SetAccountPollAnswerResult =
  | ({ readonly answered: true } & AccountPollAnswer)
  | {
    readonly answered: false;
    readonly reason: PollMessageLookupFailureReason | PollAnswerFailureReason;
  };

interface AccountLookup {
  getById(accountId: number): VirtualAccount | undefined;
}

interface PollStore {
  getPoll(pollId: PollId): Poll | undefined;
  setVoterAnswer(pollId: PollId, voterId: number, chosenOptionPositions: readonly number[]): Poll;
  closePoll(pollId: PollId): Poll;
}

interface ChatDomainEventSink {
  publish(event: ChatDomainEvent): void;
}

interface PollServiceDependencies extends AccountChatMessageLookups {
  readonly accounts: AccountLookup;
  readonly polls: PollStore;
  readonly events: ChatDomainEventSink;
}

type PollMessageResolution =
  | { readonly resolved: true; readonly message: ChatMessage; readonly poll: Poll }
  | { readonly resolved: false; readonly reason: PollMessageLookupFailureReason };

/**
 * Carries out accounts' votes in polls, as TDLib's `setPollAnswer` does for a user: an account
 * answers a poll shown by a message of its private chat with a bot or of a supergroup it is a
 * member of, changes its answer, or retracts it, as the poll allows. A forward shows the same
 * poll as the message it repeats, so a vote through either counts once in that poll. Each changed
 * answer is published, for a bot that sent the poll to observe. An account also stops the polls it
 * sent, as TDLib's `stopPoll` does for a user.
 */
export class PollService {
  readonly #accounts: AccountLookup;
  readonly #chatMessageLookups: AccountChatMessageLookups;
  readonly #polls: PollStore;
  readonly #events: ChatDomainEventSink;

  constructor(
    {
      accounts,
      bots,
      privateConversations,
      privateMessages,
      sharedChats,
      supergroupMessages,
      polls,
      events,
    }: PollServiceDependencies,
  ) {
    this.#accounts = accounts;
    this.#chatMessageLookups = {
      bots,
      privateConversations,
      privateMessages,
      sharedChats,
      supergroupMessages,
    };
    this.#polls = polls;
    this.#events = events;
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
   * `checkPollAnswer` makes; no options retract the answer. A changed answer is published for the
   * bot that sent the poll. In a poll that allows revoting, an answer that chooses the options the
   * account already chose leaves the poll as it is and publishes nothing; a poll that disallows
   * revoting refuses any answer from an account that has answered.
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

    const answeredPoll = this.#polls.setVoterAnswer(
      poll.id,
      input.accountId,
      chosenOptionPositions,
    );
    this.#events.publish({
      type: 'poll_answer_changed',
      poll: answeredPoll,
      voterId: input.accountId,
      chosenOptionPositions,
    });
    return { answered: true, poll: answeredPoll, message, chosenOptionPositions };
  }

  /**
   * Stops the poll a message shows, as TDLib's `stop_poll` does for a user once
   * `get_message_poll_id` has found the poll: the account must be able to edit the message, which
   * only the account that sent it can, and not through a forward, and the poll must be open. The
   * poll keeps its votes and accepts no more answers; the message keeps its content and gains no
   * edit date. The closure is published as a bot's stop is; no bot observes an account's poll.
   */
  stopAccountPoll(key: AccountPollMessageKey): StopAccountPollResult {
    const resolution = this.#resolvePollMessage(key);
    if (!resolution.resolved) {
      return { stopped: false, reason: resolution.reason };
    }
    const { message, poll } = resolution;
    if (!canAccountEditMessage(message, key.accountId)) {
      return { stopped: false, reason: 'poll_not_stoppable' };
    }
    if (poll.isClosed) {
      return { stopped: false, reason: 'poll_already_closed' };
    }
    const closedPoll = this.#polls.closePoll(poll.id);
    this.#events.publish({ type: 'poll_closed', poll: closedPoll });
    return { stopped: true, poll: closedPoll, message };
  }

  /**
   * Closes a poll as its `close_date` arriving does, which tests choose to happen now: the emulator
   * does not close polls as time passes. The poll keeps its votes, and the bot that sent it
   * observes its closure, as Telegram's servers report a poll that closed by itself.
   */
  expirePoll(pollId: PollId): ExpirePollResult {
    const poll = this.#polls.getPoll(pollId);
    if (poll === undefined) {
      return { expired: false, reason: 'poll_not_found' };
    }
    if (poll.isClosed) {
      return { expired: false, reason: 'poll_already_closed' };
    }
    if (poll.closingTime === undefined) {
      return { expired: false, reason: 'poll_without_closing_time' };
    }
    const closedPoll = this.#polls.closePoll(pollId);
    this.#events.publish({ type: 'poll_closed', poll: closedPoll });
    return { expired: true, poll: closedPoll };
  }

  /**
   * Finds a message of a chat the account can reach, by `findAccountChatMessage` as for a callback
   * button, and the poll it shows, as TDLib's `get_message_poll_id` does.
   */
  #resolvePollMessage(
    { accountId, chat, messageId }: AccountPollMessageKey,
  ): PollMessageResolution {
    if (this.#accounts.getById(accountId) === undefined) {
      return { resolved: false, reason: 'account_not_found' };
    }
    const lookup = findAccountChatMessage(this.#chatMessageLookups, accountId, chat, messageId);
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
}

/**
 * Why a bot cannot stop the poll of a message it found: the message shows no poll, the bot cannot
 * edit the message, or the poll is already closed.
 */
export type PollStopFailureReason =
  | 'message_has_no_poll'
  | 'poll_not_stoppable'
  | 'poll_already_closed';

interface PollLookup {
  getPoll(pollId: PollId): Poll | undefined;
}

/**
 * Finds the poll a bot stops through a message, as TDLib's `get_message_poll_id` and `stop_poll`
 * check it once the Bot API server has found the message: the message must show a poll, the bot
 * must be able to edit the message, as `canBotEditMessage` decides, and the poll must be open.
 * Only the bot that sent a poll can edit its message, so only it stops the poll; a forward of the
 * poll cannot be edited.
 */
export function findStoppablePoll(
  message: ChatMessage,
  botId: number,
  polls: PollLookup,
):
  | { readonly found: true; readonly poll: Poll }
  | { readonly found: false; readonly reason: PollStopFailureReason } {
  if (message.content.kind !== 'poll') {
    return { found: false, reason: 'message_has_no_poll' };
  }
  if (!canBotEditMessage(message, botId)) {
    return { found: false, reason: 'poll_not_stoppable' };
  }
  const poll = polls.getPoll(message.content.pollId);
  if (poll === undefined) {
    throw new Error(`Poll ${message.content.pollId} of message ${message.id} does not exist`);
  }
  return poll.isClosed ? { found: false, reason: 'poll_already_closed' } : { found: true, poll };
}

function areSameOptionPositions(
  first: readonly number[],
  second: readonly number[],
): boolean {
  return first.length === second.length &&
    first.every((optionPosition, index) => optionPosition === second[index]);
}
