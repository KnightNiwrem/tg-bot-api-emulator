import type { BotApiPoll, BotApiPollOption } from '../../types/bot_api_poll.ts';

/**
 * Presents a poll as the Bot API shows it, in the poll's field order, with its lists as the plain
 * arrays the control contracts' wire types describe.
 */
export function presentPoll(poll: BotApiPoll) {
  return {
    id: poll.id,
    question: poll.question,
    ...(poll.question_entities === undefined
      ? {}
      : { question_entities: [...poll.question_entities] }),
    options: poll.options.map(presentPollOption),
    total_voter_count: poll.total_voter_count,
    ...(poll.open_period === undefined ? {} : { open_period: poll.open_period }),
    ...(poll.close_date === undefined ? {} : { close_date: poll.close_date }),
    is_closed: poll.is_closed,
    is_anonymous: poll.is_anonymous,
    allows_multiple_answers: poll.allows_multiple_answers,
    allows_revoting: poll.allows_revoting,
    members_only: poll.members_only,
    type: poll.type,
    ...(poll.correct_option_id === undefined ? {} : { correct_option_id: poll.correct_option_id }),
    ...(poll.correct_option_ids === undefined
      ? {}
      : { correct_option_ids: [...poll.correct_option_ids] }),
    ...(poll.explanation === undefined ? {} : { explanation: poll.explanation }),
    ...(poll.explanation_entities === undefined
      ? {}
      : { explanation_entities: [...poll.explanation_entities] }),
  };
}

function presentPollOption(option: BotApiPollOption) {
  return {
    persistent_id: option.persistent_id,
    text: option.text,
    ...(option.text_entities === undefined ? {} : { text_entities: [...option.text_entities] }),
    voter_count: option.voter_count,
  };
}
