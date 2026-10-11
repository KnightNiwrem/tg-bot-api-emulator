/**
 * The client refuses a poll that breaks what its contract promises: custom emoji alone in its
 * question and options, entities of each kind with exactly their fields, and the Bot API's limits.
 */
import { assertEquals, assertRejects } from '@std/assert';

import { expirePollContract } from '../../control_contracts/polls.ts';
import { callJsonAction, type ControlOperationTransport } from './control_operation_caller.ts';
import { EmulationClientError } from './emulation_client_error.ts';
import { TEST_ACTION_RECEIPT_HEADERS } from './test_support/action_receipt_headers.ts';

function transportAnswering(status: number, body: unknown): ControlOperationTransport {
  return {
    serverRoot: new URL('http://emulator.example/'),
    fetch: () =>
      Promise.resolve(Response.json(body, { status, headers: TEST_ACTION_RECEIPT_HEADERS })),
  };
}

const option = { persistent_id: '0', text: 'Pizza', voter_count: 0 };

const poll = {
  id: '1',
  question: 'Lunch?',
  options: [option],
  total_voter_count: 0,
  is_closed: true,
  is_anonymous: true,
  allows_multiple_answers: false,
  allows_revoting: true,
  members_only: false,
  type: 'regular',
};

const customEmoji = {
  type: 'custom_emoji',
  offset: 0,
  length: 2,
  custom_emoji_id: '5368324170671202286',
};

const expirePoll = async (expiredPoll: Record<string, unknown>) =>
  (await callJsonAction(transportAnswering(200, { poll: expiredPoll }), expirePollContract, {
    params: { sessionId: 'session', pollId: '1' },
  })).result;

Deno.test('A poll that breaks its contract is refused', async () => {
  const quiz = { ...poll, type: 'quiz', correct_option_ids: [0], explanation: 'Because' };
  for (
    const refused of [
      { ...poll, id: '01' },
      { ...poll, question_entities: [{ type: 'bold', offset: 0, length: 5 }] },
      {
        ...poll,
        options: [{ ...option, text_entities: [{ ...customEmoji, custom_emoji_id: 'x' }] }],
      },
      {
        ...poll,
        options: Array.from(
          { length: 13 },
          (_, index) => ({ ...option, persistent_id: `${index}` }),
        ),
      },
      { ...poll, open_period: 4, close_date: 1_700_000_000 },
      { ...poll, open_period: 600, close_date: 0 },
      { ...quiz, explanation: 'a'.repeat(201), explanation_entities: [] },
      { ...quiz, explanation_entities: [{ type: 'text_link', offset: 0, length: 3 }] },
      {
        ...quiz,
        explanation_entities: [{ type: 'bold', offset: 0, length: 3, url: 'https://t.me' }],
      },
      { ...quiz, explanation_entities: [{ type: 'pre', offset: 0, length: 3, language: '' }] },
    ]
  ) {
    await assertRejects(
      () => expirePoll(refused),
      EmulationClientError,
      'does not match its contract',
    );
  }
});

Deno.test('A poll within its contract is read', async () => {
  const quiz = {
    ...poll,
    question_entities: [customEmoji],
    options: [{ ...option, text_entities: [customEmoji] }],
    type: 'quiz',
    correct_option_id: 0,
    correct_option_ids: [0],
    explanation: '😀'.repeat(200),
    explanation_entities: [
      { type: 'bold', offset: 0, length: 2 },
      { type: 'text_link', offset: 2, length: 2, url: 'https://t.me/' },
      { type: 'date_time', offset: 4, length: 2, unix_time: 1_700_000_000, date_time_format: '' },
    ],
  };

  assertEquals(
    [await expirePoll(poll), await expirePoll(quiz)],
    [{ poll }, { poll: quiz }],
    'Expected a regular poll and a quiz read as they are',
  );
});
