import {
  fixFormattedText,
  type FormattedTextFixingContext,
} from '../text_entities/formatted_text.ts';
import {
  MAX_POLL_OPTION_COUNT,
  MAX_POLL_OPTION_TEXT_LENGTH,
  MAX_POLL_QUESTION_LENGTH,
  type NewPoll,
} from '../types/poll.ts';
import {
  countTextCharacters,
  type FormattedText,
  type TextEntity,
} from '../types/virtual_message.ts';

// Telegram's rules for the polls bots send, which apply alike in every chat type.

/** Text of a poll as its sender specified it, before Telegram's normalization. */
export interface SpecifiedPollText {
  readonly text: string;
  /** Formatting the sender specified; omitted for none. */
  readonly entities?: readonly TextEntity[];
}

/** A poll as the bot that sends it specified it, before Telegram's normalization. */
export type SpecifiedPoll = Omit<NewPoll, 'question' | 'optionTexts'> & {
  readonly question: SpecifiedPollText;
  readonly options: readonly SpecifiedPollText[];
};

/**
 * Why Telegram refuses a poll whose text it accepts: the question or an option is too long, or the
 * poll has no options, or more than it allows.
 */
export interface PollLimitFailure {
  readonly reason:
    | 'poll_question_too_long'
    | 'poll_options_missing'
    | 'poll_has_too_many_options'
    | 'poll_option_too_long';
}

/**
 * Why Telegram refuses a poll: TDLib refused the text or entities of its question or of an option,
 * with its own description, or the poll exceeds a limit.
 */
export type PollNormalizationFailure =
  | {
    readonly reason: 'text_invalid';
    /** TDLib's description of the text it refuses. */
    readonly textError: string;
  }
  | PollLimitFailure;

export type PollNormalization =
  | { readonly normalized: true; readonly poll: NewPoll }
  | { readonly normalized: false; readonly failure: PollNormalizationFailure };

/**
 * Checks a poll a bot sends as TDLib does before creating it, in its order: the question is
 * normalized as `get_formatted_text` normalizes nonempty text and must be at most 300 characters;
 * the poll needs 1 to 12 options, each normalized likewise and at most 100 characters. As TDLib's
 * `create_poll` and `PollOption` keep them, only custom emoji remain of the question's and the
 * options' entities.
 */
export function normalizeNewPoll(
  specifiedPoll: SpecifiedPoll,
  context: FormattedTextFixingContext,
): PollNormalization {
  const { question: specifiedQuestion, options: specifiedOptions, ...settings } = specifiedPoll;
  const questionNormalization = normalizePollText(
    specifiedQuestion,
    MAX_POLL_QUESTION_LENGTH,
    'poll_question_too_long',
    context,
  );
  if (!questionNormalization.normalized) {
    return questionNormalization;
  }
  if (specifiedOptions.length === 0) {
    return { normalized: false, failure: { reason: 'poll_options_missing' } };
  }
  if (specifiedOptions.length > MAX_POLL_OPTION_COUNT) {
    return { normalized: false, failure: { reason: 'poll_has_too_many_options' } };
  }
  const optionTexts: FormattedText[] = [];
  for (const specifiedOption of specifiedOptions) {
    const optionNormalization = normalizePollText(
      specifiedOption,
      MAX_POLL_OPTION_TEXT_LENGTH,
      'poll_option_too_long',
      context,
    );
    if (!optionNormalization.normalized) {
      return optionNormalization;
    }
    optionTexts.push(optionNormalization.text);
  }
  return {
    normalized: true,
    poll: { ...settings, question: questionNormalization.text, optionTexts },
  };
}

type PollTextNormalization =
  | { readonly normalized: true; readonly text: FormattedText }
  | { readonly normalized: false; readonly failure: PollNormalizationFailure };

/**
 * Normalizes nonempty text of a poll as TDLib's `get_formatted_text` does, checks its length, and
 * keeps only its custom emoji entities.
 */
function normalizePollText(
  { text, entities }: SpecifiedPollText,
  maxLength: number,
  tooLongReason: 'poll_question_too_long' | 'poll_option_too_long',
  context: FormattedTextFixingContext,
): PollTextNormalization {
  const fixing = fixFormattedText(text, entities ?? [], context);
  if (!fixing.fixed) {
    return { normalized: false, failure: { reason: 'text_invalid', textError: fixing.error } };
  }
  const { formattedText } = fixing;
  if (countTextCharacters(formattedText.text) > maxLength) {
    return { normalized: false, failure: { reason: tooLongReason } };
  }
  return {
    normalized: true,
    text: {
      text: formattedText.text,
      entities: formattedText.entities.filter(({ type }) => type === 'custom_emoji'),
    },
  };
}
