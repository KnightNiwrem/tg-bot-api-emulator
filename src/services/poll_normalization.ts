import {
  fixFormattedText,
  type FormattedTextFixingContext,
} from '../text_entities/formatted_text.ts';
import {
  MAX_ACCOUNT_POLL_QUESTION_LENGTH,
  MAX_POLL_OPTION_COUNT,
  MAX_POLL_OPTION_TEXT_LENGTH,
  MAX_POLL_QUESTION_LENGTH,
  MAX_QUIZ_EXPLANATION_LENGTH,
  MAX_QUIZ_EXPLANATION_LINE_FEEDS,
  type NewPoll,
  type PollType,
  type SpecifiedPoll,
  type SpecifiedPollText,
  type SpecifiedPollType,
} from '../types/poll.ts';
import { countTextCharacters, type FormattedText } from '../types/virtual_message.ts';

// Telegram's rules for the polls accounts and bots send, which apply alike in every chat type.

/**
 * Why Telegram refuses a poll whose text it accepts: the question or an option is too long, or the
 * poll has no options, or more than it allows; or a quiz lists no correct option, lists them out
 * of order, lists one the poll lacks, or has an explanation over its limits.
 */
export interface PollLimitFailure {
  readonly reason:
    | 'poll_question_too_long'
    | 'poll_options_missing'
    | 'poll_has_too_many_options'
    | 'poll_option_too_long'
    | 'quiz_correct_options_missing'
    | 'quiz_correct_options_not_increasing'
    | 'quiz_correct_option_not_found'
    | 'quiz_explanation_too_long'
    | 'quiz_explanation_has_too_many_line_feeds';
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
 * Checks a poll an account or a bot sends as TDLib does before creating it, in its order: the
 * question is normalized as `get_formatted_text` normalizes nonempty text and must be at most 300
 * characters from a bot, or 255 from an account; the poll needs 1 to 12 options, each normalized
 * likewise and at most 100 characters. As TDLib's `create_poll` and `PollOption` keep them, only
 * custom emoji remain of the question's and the options' entities. A quiz's type is then checked
 * as `normalizeQuizType` checks it.
 */
export function normalizeNewPoll(
  specifiedPoll: SpecifiedPoll,
  context: FormattedTextFixingContext,
): PollNormalization {
  const {
    question: specifiedQuestion,
    options: specifiedOptions,
    type: specifiedType,
    ...settings
  } = specifiedPoll;
  const questionNormalization = normalizePollText(
    specifiedQuestion,
    settings.creator.kind === 'account'
      ? MAX_ACCOUNT_POLL_QUESTION_LENGTH
      : MAX_POLL_QUESTION_LENGTH,
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
  const typeNormalization = normalizeQuizType(specifiedType, optionTexts.length, context);
  if (!typeNormalization.normalized) {
    return typeNormalization;
  }
  return {
    normalized: true,
    poll: {
      ...settings,
      question: questionNormalization.text,
      optionTexts,
      type: typeNormalization.type,
    },
  };
}

/**
 * Checks a quiz's correct options as TDLib's `check_quiz_correct_option_ids` does: at least one,
 * in increasing order, each an option of the poll. The explanation is then normalized as TDLib's
 * `get_formatted_text` normalizes text that may be empty, keeping all its entities; the Bot API
 * documents its limits of 200 characters and 2 line feeds, which Telegram's servers enforce. A
 * regular poll has nothing to check.
 */
function normalizeQuizType(
  specifiedType: SpecifiedPollType,
  optionCount: number,
  context: FormattedTextFixingContext,
):
  | { readonly normalized: true; readonly type: PollType }
  | { readonly normalized: false; readonly failure: PollNormalizationFailure } {
  if (specifiedType.kind === 'regular') {
    return { normalized: true, type: specifiedType };
  }
  const { correctOptionPositions, explanation } = specifiedType;
  const failure = (reason: PollLimitFailure['reason']) =>
    ({ normalized: false, failure: { reason } }) as const;
  if (correctOptionPositions.length === 0) {
    return failure('quiz_correct_options_missing');
  }
  if (
    correctOptionPositions.some((position, index) =>
      index > 0 && position <= correctOptionPositions[index - 1]
    )
  ) {
    return failure('quiz_correct_options_not_increasing');
  }
  if (correctOptionPositions.some((position) => position < 0 || position >= optionCount)) {
    return failure('quiz_correct_option_not_found');
  }
  const fixing = fixFormattedText(explanation.text, explanation.entities ?? [], context, 'clear');
  if (!fixing.fixed) {
    return { normalized: false, failure: { reason: 'text_invalid', textError: fixing.error } };
  }
  const { formattedText } = fixing;
  if (countTextCharacters(formattedText.text) > MAX_QUIZ_EXPLANATION_LENGTH) {
    return failure('quiz_explanation_too_long');
  }
  if (formattedText.text.split('\n').length - 1 > MAX_QUIZ_EXPLANATION_LINE_FEEDS) {
    return failure('quiz_explanation_has_too_many_line_feeds');
  }
  return {
    normalized: true,
    type: { kind: 'quiz', correctOptionPositions, explanation: formattedText },
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
