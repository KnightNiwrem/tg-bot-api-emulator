/**
 * The client refuses an inline query that breaks what its contract promises: a non-empty ID, a
 * shared location's accuracy in whole meters, and an answer within the Bot API's limits.
 */
import { assertEquals, assertRejects } from '@std/assert';

import { getInlineQueryContract } from '../../src/api/contracts/inline_queries.ts';
import { callJsonOperation, type ControlOperationTransport } from './control_operation_caller.ts';
import { EmulationClientError } from './emulation_client_error.ts';

function transportAnswering(status: number, body: unknown): ControlOperationTransport {
  return {
    serverRoot: new URL('http://emulator.example/'),
    fetch: () => Promise.resolve(Response.json(body, { status })),
  };
}

const inlineQuery = {
  id: '1',
  bot_id: 1,
  chat: { type: 'private', botId: 1 },
  query: 'cats',
  offset: '',
  status: 'awaiting_answer',
  answer: null,
};

const answer = { results: [], cache_time: 300, is_personal: false, next_offset: '' };

const readInlineQuery = (query: Record<string, unknown>) =>
  callJsonOperation(transportAnswering(200, { inline_query: query }), getInlineQueryContract, {
    params: { sessionId: 'session', accountId: 1, inlineQueryId: '1' },
  });

Deno.test('An inline query that breaks its contract is refused', async () => {
  const answered = { ...inlineQuery, status: 'answered' };
  for (
    const refused of [
      { ...inlineQuery, id: '' },
      { ...inlineQuery, location: { latitude: 0, longitude: 0, horizontal_accuracy: 0 } },
      { ...inlineQuery, location: { latitude: 0, longitude: 0, horizontal_accuracy: 1.5 } },
      { ...answered, answer: { ...answer, cache_time: 86_401 } },
      { ...answered, answer: { ...answer, results: [{ type: 'article', id: '' }] } },
      {
        ...answered,
        answer: {
          ...answer,
          results: Array.from({ length: 51 }, (_, index) => ({ type: 'photo', id: `${index}` })),
        },
      },
      { ...answered, answer: { ...answer, button: { text: 'Open', start_parameter: 'a b' } } },
      {
        ...answered,
        answer: { ...answer, button: { text: 'Open', web_app: { url: 'http://example.com/' } } },
      },
    ]
  ) {
    await assertRejects(
      () => readInlineQuery(refused),
      EmulationClientError,
      'does not match its contract',
    );
  }
});

Deno.test('An inline query within its contract is read', async () => {
  const answered = {
    ...inlineQuery,
    location: { latitude: 51.5, longitude: -0.12, horizontal_accuracy: 3 },
    status: 'answered',
    answer: {
      ...answer,
      results: [{ type: 'article', id: 'a', title: 'Cats' }],
      button: { text: 'Open', web_app: { url: 'HTTPS://example.com/app' } },
    },
  };

  assertEquals(
    [await readInlineQuery(inlineQuery), await readInlineQuery(answered)],
    [{ inline_query: inlineQuery }, { inline_query: answered }],
    'Expected unanswered and answered queries read as they are',
  );
});
