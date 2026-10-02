import type { BotApiMessageEntity } from './bot_api.ts';

// The Bot API's `Poll` and the types it holds, in the field order of the official Bot API server's
// `JsonPoll` and `JsonPollOption`.

export interface BotApiPollOption {
  readonly persistent_id: string;
  readonly text: string;
  /** Omitted when the text has no entities, which can only be custom emoji. */
  readonly text_entities?: readonly BotApiMessageEntity[];
  readonly voter_count: number;
}

/**
 * A poll as bots see it. The emulator's polls never restrict who may vote, so `members_only` is
 * false and `country_codes` is omitted.
 */
export interface BotApiPoll {
  readonly id: string;
  readonly question: string;
  /** Omitted when the question has no entities, which can only be custom emoji. */
  readonly question_entities?: readonly BotApiMessageEntity[];
  readonly options: readonly BotApiPollOption[];
  readonly total_voter_count: number;
  readonly is_closed: boolean;
  readonly is_anonymous: boolean;
  readonly allows_multiple_answers: boolean;
  readonly allows_revoting: boolean;
  readonly members_only: false;
  readonly type: 'regular';
}
