import { PollRepository } from '../src/repositories/poll.ts';
import { normalizeNewPoll } from '../src/services/poll_normalization.ts';
import {
  checkPollAnswer,
  countPollVoters,
  getVoterAnswer,
  type NewPoll,
  type Poll,
  showsQuizSolution,
  type SpecifiedPoll,
  toChosenOptionPositions,
} from '../src/types/poll.ts';
import type { PrivateMessage, SupergroupMessage } from '../src/types/virtual_message.ts';

const NO_MENTIONABLE_USERS = { isMentionableUser: () => false };

const NEW_POLL: NewPoll = {
  creator: { kind: 'bot', botId: 1 },
  question: { text: 'Lunch?', entities: [] },
  optionTexts: [{ text: 'Pizza', entities: [] }, { text: 'Pasta', entities: [] }, {
    text: 'Soup',
    entities: [],
  }],
  isAnonymous: false,
  allowsMultipleAnswers: false,
  allowsRevoting: true,
  type: { kind: 'regular' },
  isClosed: false,
};

const SPECIFIED_POLL: SpecifiedPoll = {
  creator: { kind: 'bot', botId: 1 },
  question: { text: 'Lunch?' },
  options: [{ text: 'Pizza' }, { text: 'Pasta' }],
  isAnonymous: true,
  allowsMultipleAnswers: false,
  allowsRevoting: true,
  type: { kind: 'regular' },
  isClosed: false,
};

/** A stored poll with the given settings and answers. */
function createPoll(
  settings: Partial<Pick<Poll, 'allowsMultipleAnswers' | 'allowsRevoting' | 'isClosed'>>,
  answers: ReadonlyArray<readonly [number, readonly number[]]> = [],
): Poll {
  const polls = new PollRepository();
  let poll = polls.addPoll({ ...NEW_POLL, ...settings });
  for (const [voterId, optionPositions] of answers) {
    poll = polls.setVoterAnswer(poll.id, voterId, optionPositions);
  }
  return poll;
}

Deno.test('toChosenOptionPositions orders options and counts each once, as TDLib does', () => {
  if (JSON.stringify(toChosenOptionPositions([2, 0, 2, 1, 0])) !== JSON.stringify([0, 1, 2])) {
    throw new Error('Expected repeated positions to count once, in increasing order');
  }
});

Deno.test('checkPollAnswer applies the checks of TDLib set_poll_answer in its order', () => {
  const cases: ReadonlyArray<{
    readonly poll: Poll;
    readonly answer: readonly number[];
    readonly expected: ReturnType<typeof checkPollAnswer>;
  }> = [
    { poll: createPoll({}), answer: [1], expected: undefined },
    { poll: createPoll({}, [[7, [0]]]), answer: [1], expected: undefined },
    { poll: createPoll({}, [[7, [0]]]), answer: [], expected: undefined },
    { poll: createPoll({ allowsMultipleAnswers: true }), answer: [0, 2], expected: undefined },
    // A closed poll refuses even an answer that would fail for other reasons.
    { poll: createPoll({ isClosed: true }), answer: [0, 1, 9], expected: 'poll_closed' },
    { poll: createPoll({}), answer: [0, 9], expected: 'multiple_answers_not_allowed' },
    {
      poll: createPoll({ allowsRevoting: false }),
      answer: [],
      expected: 'answer_retraction_not_allowed',
    },
    { poll: createPoll({}), answer: [3], expected: 'poll_option_not_found' },
    {
      poll: createPoll({ allowsRevoting: false }, [[7, [0]]]),
      answer: [9],
      expected: 'poll_option_not_found',
    },
    {
      poll: createPoll({ allowsRevoting: false }, [[7, [0]]]),
      answer: [0],
      expected: 'answer_change_not_allowed',
    },
    { poll: createPoll({ allowsRevoting: false }, [[8, [0]]]), answer: [0], expected: undefined },
  ];
  for (const { poll, answer, expected } of cases) {
    const actual = checkPollAnswer(poll, 7, answer);
    if (actual !== expected) {
      throw new Error(`Expected ${expected} for answer ${JSON.stringify(answer)}, got ${actual}`);
    }
  }
});

Deno.test('PollRepository keeps each voter answer, from which the counts follow', () => {
  const polls = new PollRepository();
  const poll = polls.addPoll({ ...NEW_POLL, allowsMultipleAnswers: true });
  const otherPoll = polls.addPoll(NEW_POLL);
  if (poll.id === otherPoll.id || !/^[1-9]\d*$/.test(poll.id)) {
    throw new Error('Expected distinct positive decimal poll identifiers');
  }
  if (
    JSON.stringify(poll.options.map(({ persistentId }) => persistentId)) !==
      JSON.stringify(['0', '1', '2']) || poll.isClosed
  ) {
    throw new Error('Expected an open poll whose options are identified by position');
  }

  polls.setVoterAnswer(poll.id, 7, [0, 2]);
  polls.setVoterAnswer(poll.id, 8, [2]);
  const answered = polls.setVoterAnswer(poll.id, 9, [1]);
  const retracted = polls.setVoterAnswer(poll.id, 9, []);
  const counts = countPollVoters(answered);
  const countsAfterRetraction = countPollVoters(retracted);
  if (
    JSON.stringify(counts) !==
      JSON.stringify({ optionVoterCounts: [1, 1, 2], totalVoterCount: 3 }) ||
    JSON.stringify(countsAfterRetraction) !==
      JSON.stringify({ optionVoterCounts: [1, 0, 2], totalVoterCount: 2 })
  ) {
    throw new Error(`Expected counts from the answers, got ${JSON.stringify(counts)}`);
  }
  if (
    getVoterAnswer(retracted, 9).length !== 0 ||
    JSON.stringify(getVoterAnswer(retracted, 7)) !== JSON.stringify([0, 2]) ||
    polls.getPoll(poll.id) !== retracted || countPollVoters(otherPoll).totalVoterCount !== 0
  ) {
    throw new Error('Expected the retraction to remove only the voter answer');
  }
});

Deno.test('normalizeNewPoll checks a poll as TDLib does and keeps only custom emoji', () => {
  const customEmoji = { type: 'custom_emoji' as const, customEmojiId: '5368324170671202286' };
  const normalization = normalizeNewPoll({
    ...SPECIFIED_POLL,
    question: {
      text: '  🍕 Lunch? ',
      entities: [
        { ...customEmoji, offset: 2, length: 2 },
        { type: 'bold', offset: 5, length: 5 },
      ],
    },
    options: [{ text: '/pizza 🍕', entities: [{ ...customEmoji, offset: 7, length: 2 }] }, {
      text: 'Pasta',
      entities: [{ type: 'italic', offset: 0, length: 5 }],
    }],
  }, NO_MENTIONABLE_USERS);
  if (!normalization.normalized) {
    throw new Error(`Expected the poll to be accepted, got ${JSON.stringify(normalization)}`);
  }
  const { poll } = normalization;
  if (
    JSON.stringify(poll.question) !==
      JSON.stringify({ text: '🍕 Lunch?', entities: [{ ...customEmoji, offset: 0, length: 2 }] }) ||
    JSON.stringify(poll.optionTexts) !== JSON.stringify([
        { text: '/pizza 🍕', entities: [{ ...customEmoji, offset: 7, length: 2 }] },
        { text: 'Pasta', entities: [] },
      ]) ||
    JSON.stringify(poll.creator) !== JSON.stringify({ kind: 'bot', botId: 1 }) ||
    !poll.isAnonymous
  ) {
    throw new Error(`Expected trimmed text with only custom emoji, got ${JSON.stringify(poll)}`);
  }
});

Deno.test('normalizeNewPoll refuses polls in the order TDLib checks them', () => {
  const options = (count: number, text = 'Option') =>
    Array.from({ length: count }, (_, index) => ({ text: `${text} ${index}` }));
  const cases: ReadonlyArray<{
    readonly poll: Partial<SpecifiedPoll>;
    readonly expected: string;
  }> = [
    { poll: { question: { text: ' \n ' }, options: [] }, expected: 'text_invalid' },
    {
      poll: { question: { text: '?'.repeat(301) }, options: [] },
      expected: 'poll_question_too_long',
    },
    { poll: { options: [] }, expected: 'poll_options_missing' },
    { poll: { options: options(13, '') }, expected: 'poll_has_too_many_options' },
    { poll: { options: [{ text: 'Fine' }, { text: '  ' }] }, expected: 'text_invalid' },
    {
      poll: { options: [{ text: 'x'.repeat(101) }, { text: '' }] },
      expected: 'poll_option_too_long',
    },
  ];
  for (const { poll, expected } of cases) {
    const normalization = normalizeNewPoll({ ...SPECIFIED_POLL, ...poll }, NO_MENTIONABLE_USERS);
    if (normalization.normalized || normalization.failure.reason !== expected) {
      throw new Error(`Expected ${expected}, got ${JSON.stringify(normalization)}`);
    }
  }
  const atLimits = normalizeNewPoll({
    ...SPECIFIED_POLL,
    question: { text: '🍕'.repeat(300) },
    options: [{ text: 'x'.repeat(100) }, ...options(11)],
  }, NO_MENTIONABLE_USERS);
  if (!atLimits.normalized) {
    throw new Error('Expected a question of 300 characters and 12 options to be accepted');
  }
});

Deno.test('normalizeNewPoll limits an account question to 255 characters, as TDLib does', () => {
  const accountPoll = (questionLength: number) =>
    normalizeNewPoll({
      ...SPECIFIED_POLL,
      creator: { kind: 'account', accountId: 7 },
      question: { text: '?'.repeat(questionLength) },
    }, NO_MENTIONABLE_USERS);
  const atLimit = accountPoll(255);
  const overLimit = accountPoll(256);
  if (
    !atLimit.normalized ||
    JSON.stringify(atLimit.poll.creator) !== JSON.stringify({ kind: 'account', accountId: 7 }) ||
    overLimit.normalized || overLimit.failure.reason !== 'poll_question_too_long'
  ) {
    throw new Error(`Unexpected account question limit: ${JSON.stringify([atLimit, overLimit])}`);
  }
});

Deno.test('normalizeNewPoll checks quizzes as TDLib checks them, then the documented limits', () => {
  const quiz = (correctOptionPositions: readonly number[], explanation = '') =>
    normalizeNewPoll({
      ...SPECIFIED_POLL,
      options: [{ text: 'A' }, { text: 'B' }, { text: 'C' }],
      type: { kind: 'quiz', correctOptionPositions, explanation: { text: explanation } },
    }, NO_MENTIONABLE_USERS);
  const cases: ReadonlyArray<readonly [ReturnType<typeof quiz>, string]> = [
    [quiz([]), 'quiz_correct_options_missing'],
    [quiz([2, 1]), 'quiz_correct_options_not_increasing'],
    [quiz([1, 1]), 'quiz_correct_options_not_increasing'],
    [quiz([0, 3]), 'quiz_correct_option_not_found'],
    [quiz([-1]), 'quiz_correct_option_not_found'],
    [quiz([0], 'x'.repeat(201)), 'quiz_explanation_too_long'],
    [quiz([0], 'a\nb\nc\nd'), 'quiz_explanation_has_too_many_line_feeds'],
  ];
  for (const [normalization, expected] of cases) {
    if (normalization.normalized || normalization.failure.reason !== expected) {
      throw new Error(`Expected ${expected}, got ${JSON.stringify(normalization)}`);
    }
  }

  const accepted = quiz([0, 2], '  Pizza is round.\n/start  ');
  const blank = quiz([1], ' \n ');
  if (!accepted.normalized || !blank.normalized) {
    throw new Error('Expected quizzes within the limits to be accepted');
  }
  expectQuizType(accepted.poll, {
    kind: 'quiz',
    correctOptionPositions: [0, 2],
    explanation: {
      text: 'Pizza is round.\n/start',
      entities: [{ type: 'bot_command', offset: 16, length: 6 }],
    },
  });
  expectQuizType(blank.poll, {
    kind: 'quiz',
    correctOptionPositions: [1],
    explanation: { text: '', entities: [] },
  });
});

Deno.test('showsQuizSolution shows a quiz solution to its bot, its voters, and once closed', () => {
  // A voter that retracts its answer to a quiz that allows revoting no longer sees the solution.
  const polls = new PollRepository();
  const quiz = polls.addPoll({
    ...NEW_POLL,
    type: {
      kind: 'quiz',
      correctOptionPositions: [1],
      explanation: { text: 'Pasta', entities: [] },
    },
  });
  const answered = polls.setVoterAnswer(quiz.id, 7, [0]);
  polls.setVoterAnswer(quiz.id, 8, [1]);
  const retracted = polls.setVoterAnswer(quiz.id, 8, []);
  const closed = polls.closePoll(quiz.id);
  const regular = polls.addPoll(NEW_POLL);
  const observers = [1, 7, 8];
  const visibility = [quiz, answered, retracted, closed, regular].map((poll) =>
    observers.map((observerId) => showsQuizSolution(poll, { observerId }))
  );
  if (
    JSON.stringify(visibility) !== JSON.stringify([
      [true, false, false],
      [true, true, false],
      [true, true, false],
      [true, true, true],
      [false, false, false],
    ])
  ) {
    throw new Error(`Unexpected quiz solution visibility: ${JSON.stringify(visibility)}`);
  }
});

Deno.test('showsQuizSolution shows an account quiz to the bot of the private chat it was sent to', () => {
  const polls = new PollRepository();
  const quiz = polls.addPoll({
    ...NEW_POLL,
    creator: { kind: 'account', accountId: 7 },
    type: {
      kind: 'quiz',
      correctOptionPositions: [1],
      explanation: { text: '', entities: [] },
    },
  });
  const privateMessage: PrivateMessage = {
    kind: 'private_message',
    id: 'message-1',
    conversation: { accountId: 7, botId: 1 },
    authorRole: 'account',
    sentAtUnixSeconds: 0,
    content: { kind: 'poll', pollId: quiz.id },
    isContentProtected: false,
    isSilent: false,
    isPinned: false,
  };
  const forward: PrivateMessage = {
    ...privateMessage,
    id: 'message-2',
    conversation: { accountId: 8, botId: 2 },
    forwardInfo: {
      originalSender: { kind: 'user', userId: 7 },
      originalSentAtUnixSeconds: 0,
    },
  };
  const supergroupMessage: SupergroupMessage = {
    kind: 'supergroup_message',
    id: 'message-3',
    chatId: -1_000_000_000_001,
    author: { kind: 'account', accountId: 7 },
    sentAtUnixSeconds: 0,
    content: { kind: 'poll', pollId: quiz.id },
    isContentProtected: false,
    isSilent: false,
    isPinned: false,
  };
  const visibility = [
    showsQuizSolution(quiz, { observerId: 7 }),
    showsQuizSolution(quiz, { observerId: 1, pollMessage: privateMessage }),
    showsQuizSolution(quiz, { observerId: 1 }),
    showsQuizSolution(quiz, { observerId: 2, pollMessage: forward }),
    showsQuizSolution(quiz, { observerId: 1, pollMessage: supergroupMessage }),
    showsQuizSolution(quiz, { observerId: 8, pollMessage: privateMessage }),
  ];
  if (JSON.stringify(visibility) !== JSON.stringify([true, true, false, false, false, false])) {
    throw new Error(`Unexpected account quiz solution visibility: ${JSON.stringify(visibility)}`);
  }
});

function expectQuizType(poll: NewPoll, expected: NewPoll['type']): void {
  if (JSON.stringify(poll.type) !== JSON.stringify(expected)) {
    throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(poll.type)}`);
  }
}
