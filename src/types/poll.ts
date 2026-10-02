import type { FormattedText } from './virtual_message.ts';

/**
 * Telegram's poll `id`: the decimal text of the positive 64-bit identifier of a poll. Every
 * forward of a poll's message shows the same poll, while a copy creates a new one.
 */
export type PollId = string;

/** The most characters of a poll question that Telegram accepts from bots, as TDLib limits it. */
export const MAX_POLL_QUESTION_LENGTH = 300;

/** The most characters of a poll option's text, as TDLib's `PollOption::get_poll_option` limits. */
export const MAX_POLL_OPTION_TEXT_LENGTH = 100;

/**
 * The most options a poll has, TDLib's default of the `poll_answer_count_max` option, which the
 * Bot API documents as 1–12 options.
 */
export const MAX_POLL_OPTION_COUNT = 12;

/**
 * The most characters of a quiz's explanation, as the Bot API documents it; Telegram's servers
 * enforce it, not TDLib.
 */
export const MAX_QUIZ_EXPLANATION_LENGTH = 200;

/** The most line feeds a quiz's explanation holds, as the Bot API documents it. */
export const MAX_QUIZ_EXPLANATION_LINE_FEEDS = 2;

/** The shortest time a poll stays open when it closes by itself, as the Bot API documents it. */
export const MIN_POLL_OPEN_PERIOD_SECONDS = 5;

/** The longest time a poll stays open when it closes by itself, as the Bot API documents it. */
export const MAX_POLL_OPEN_PERIOD_SECONDS = 2_628_000;

/**
 * What kind of poll it is: a regular poll, or a quiz, whose correct options and explanation only
 * some observers see, as `showsQuizSolution` decides.
 */
export type PollType =
  | { readonly kind: 'regular' }
  | {
    readonly kind: 'quiz';
    /** The positions of the correct options, in increasing order; at least one. */
    readonly correctOptionPositions: readonly number[];
    /** What clients show a voter who chose a wrong option; empty for none. */
    readonly explanation: FormattedText;
  };

/** When a poll closes by itself, as the Bot API shows it with `open_period` and `close_date`. */
export interface PollClosingTime {
  /** How long the poll stays open after it is sent. */
  readonly openPeriodSeconds: number;
  readonly closeDateUnixSeconds: number;
}

/** An answer option of a poll. */
export interface PollOption {
  /**
   * The Bot API's `persistent_id`, which keeps identifying the option however options are added
   * or deleted. Telegram's servers choose these identifiers; the emulator uses the decimal text of
   * the option's position when the poll was created.
   */
  readonly persistentId: string;
  /** The option's text, whose only entities are custom emoji, as TDLib keeps them. */
  readonly text: FormattedText;
}

/** A poll to create, whose question and options Telegram has normalized. */
export interface NewPoll {
  /**
   * The bot that sends the poll, which owns it: only it may stop the poll, and only it receives
   * the poll's updates.
   */
  readonly creatorBotId: number;
  /** The question, whose only entities are custom emoji, as TDLib's `create_poll` keeps them. */
  readonly question: FormattedText;
  /** The options' texts in the order clients show them, at least one and at most 12. */
  readonly optionTexts: readonly FormattedText[];
  /** Whether the poll hides who voted for what: then no bot learns any voter's identity. */
  readonly isAnonymous: boolean;
  readonly allowsMultipleAnswers: boolean;
  /** Whether a voter may change or retract its answer, which TDLib calls revoting. */
  readonly allowsRevoting: boolean;
  readonly type: PollType;
  /** Whether the poll is created closed, as a bot's preview of a poll is. */
  readonly isClosed: boolean;
  /** When the poll closes by itself; omitted for a poll that stays open until it is stopped. */
  readonly closingTime?: PollClosingTime;
}

/**
 * A poll and its votes. Only accounts vote; the poll keeps each voter's answer, from which its
 * counts follow, so the counts always agree with the answers.
 */
export interface Poll {
  readonly id: PollId;
  /** As `NewPoll` describes it. */
  readonly creatorBotId: number;
  readonly question: FormattedText;
  readonly options: readonly PollOption[];
  readonly isAnonymous: boolean;
  readonly allowsMultipleAnswers: boolean;
  readonly allowsRevoting: boolean;
  readonly type: PollType;
  /**
   * Whether the poll no longer accepts answers: it was created closed, its owner stopped it, or
   * its closing time arrived.
   */
  readonly isClosed: boolean;
  /** As `NewPoll` describes it; kept after the poll closes. */
  readonly closingTime?: PollClosingTime;
  /**
   * Each voter's chosen options, by the voting account's ID, as option positions in increasing
   * order. A voter who never answered, or who retracted its answer, has no entry.
   */
  readonly answersByVoterId: ReadonlyMap<number, readonly number[]>;
}

/** How many accounts voted for each option of a poll, and how many voted at all. */
export interface PollVoterCounts {
  /** The voters of each option, in the order of the poll's options. */
  readonly optionVoterCounts: readonly number[];
  /** The accounts that chose any option, each counted once. */
  readonly totalVoterCount: number;
}

/** Counts a poll's voters from the answers it keeps. */
export function countPollVoters(poll: Poll): PollVoterCounts {
  const optionVoterCounts = poll.options.map(() => 0);
  for (const chosenOptionPositions of poll.answersByVoterId.values()) {
    for (const optionPosition of chosenOptionPositions) {
      optionVoterCounts[optionPosition]++;
    }
  }
  return { optionVoterCounts, totalVoterCount: poll.answersByVoterId.size };
}

/**
 * The options a voter chose in a poll, as option positions in increasing order; none for a voter
 * without an answer.
 */
export function getVoterAnswer(poll: Poll, voterId: number): readonly number[] {
  return poll.answersByVoterId.get(voterId) ?? [];
}

/**
 * Whether an observer sees which options of a quiz are correct, and its explanation: once the quiz
 * is closed, as the bot that sent it, or as an account that answered it, as Telegram's servers
 * give them to TDLib. A regular poll has neither.
 */
export function showsQuizSolution(poll: Poll, observerId: number): boolean {
  return poll.type.kind === 'quiz' &&
    (poll.isClosed || poll.creatorBotId === observerId || poll.answersByVoterId.has(observerId));
}

/**
 * Why an account cannot give an answer to a poll: the poll is closed; the answer chooses several
 * options of a poll that allows one; it retracts, or changes, an answer of a poll that allows
 * neither; or it names an option the poll lacks.
 */
export type PollAnswerFailureReason =
  | 'poll_closed'
  | 'multiple_answers_not_allowed'
  | 'answer_retraction_not_allowed'
  | 'poll_option_not_found'
  | 'answer_change_not_allowed';

/**
 * Orders the option positions an answer chooses and drops repeated ones, as TDLib's
 * `set_poll_answer` does before it checks the answer.
 */
export function toChosenOptionPositions(optionPositions: readonly number[]): readonly number[] {
  return [...new Set(optionPositions)].sort((first, second) => first - second);
}

/**
 * Checks a voter's new answer to a poll, given as `toChosenOptionPositions` returns it, in the
 * order of TDLib's `set_poll_answer`: the poll must be open; a poll that allows one answer accepts
 * at most one option; a poll that disallows revoting accepts no retraction, even from a voter who
 * has not answered; every option must exist; and such a poll accepts no answer from a voter who has
 * answered. An empty answer retracts the voter's answer. Returns `undefined` for an answer the poll
 * accepts.
 */
export function checkPollAnswer(
  poll: Poll,
  voterId: number,
  chosenOptionPositions: readonly number[],
): PollAnswerFailureReason | undefined {
  if (poll.isClosed) {
    return 'poll_closed';
  }
  if (!poll.allowsMultipleAnswers && chosenOptionPositions.length > 1) {
    return 'multiple_answers_not_allowed';
  }
  if (!poll.allowsRevoting && chosenOptionPositions.length === 0) {
    return 'answer_retraction_not_allowed';
  }
  if (
    chosenOptionPositions.some((optionPosition) =>
      !Number.isInteger(optionPosition) || optionPosition < 0 ||
      optionPosition >= poll.options.length
    )
  ) {
    return 'poll_option_not_found';
  }
  if (!poll.allowsRevoting && poll.answersByVoterId.has(voterId)) {
    return 'answer_change_not_allowed';
  }
  return undefined;
}
