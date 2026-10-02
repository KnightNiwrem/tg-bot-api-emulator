import type { BotApiMessageEntity } from './bot_api.ts';
import type { VirtualAccountProfile } from './virtual_account.ts';

// The Bot API's `Poll`, the types it holds, and `PollAnswer`, in the field order of the official
// Bot API server's `JsonPoll`, `JsonPollOption`, and `JsonPollAnswer`.

export interface BotApiPollOption {
  readonly persistent_id: string;
  readonly text: string;
  /** Omitted when the text has no entities, which can only be custom emoji. */
  readonly text_entities?: readonly BotApiMessageEntity[];
  readonly voter_count: number;
}

/**
 * A poll as bots see it. The emulator's polls never restrict who may vote, so `members_only` is
 * false and `country_codes` is omitted; they have no description or media.
 */
export interface BotApiPoll {
  readonly id: string;
  readonly question: string;
  /** Omitted when the question has no entities, which can only be custom emoji. */
  readonly question_entities?: readonly BotApiMessageEntity[];
  readonly options: readonly BotApiPollOption[];
  readonly total_voter_count: number;
  /** Present, with `close_date`, only for an open poll that closes by itself. */
  readonly open_period?: number;
  readonly close_date?: number;
  readonly is_closed: boolean;
  readonly is_anonymous: boolean;
  readonly allows_multiple_answers: boolean;
  readonly allows_revoting: boolean;
  readonly members_only: false;
  readonly type: 'regular' | 'quiz';
  /** Present for a quiz with one correct option, to an observer that sees its solution. */
  readonly correct_option_id?: number;
  /** Present for a quiz, to an observer that sees its solution. */
  readonly correct_option_ids?: readonly number[];
  /** Present for a quiz with an explanation, to an observer that sees its solution. */
  readonly explanation?: string;
  /** Present with the explanation, even without entities, as the official server writes it. */
  readonly explanation_entities?: readonly BotApiMessageEntity[];
}

/**
 * An account's answer to a non-anonymous poll, as the bot that owns the poll receives it. Only
 * accounts vote, so the voter is always a `user`.
 */
export interface BotApiPollAnswer {
  readonly poll_id: string;
  readonly user: VirtualAccountProfile;
  /** The chosen options' positions, counted from 0; empty for a retracted answer. */
  readonly option_ids: readonly number[];
  readonly option_persistent_ids: readonly string[];
}
