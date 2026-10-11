/**
 * The client refuses a callback query that breaks what its contract promises: a non-empty ID,
 * one of the statuses a query has, and an answer whose link is not empty.
 */
import { assertEquals, assertRejects } from '@std/assert';

import { getCallbackQueryContract } from '../../control_contracts/callback_queries.ts';
import { callJsonOperation, type ControlOperationTransport } from './control_operation_caller.ts';
import { EmulationClientError } from './emulation_client_error.ts';

function transportAnswering(status: number, body: unknown): ControlOperationTransport {
  return {
    serverRoot: new URL('http://emulator.example/'),
    fetch: () => Promise.resolve(Response.json(body, { status })),
  };
}

const callbackQuery = { id: '1', callback_data: 'go', status: 'awaiting_answer', answer: null };
const answer = { show_alert: false, cache_time: 0 };

const readCallbackQuery = (query: Record<string, unknown>) =>
  callJsonOperation(
    transportAnswering(200, { callback_query: query }),
    getCallbackQueryContract,
    { params: { sessionId: 'session', accountId: 1, callbackQueryId: '1' } },
  );

Deno.test('A callback query that breaks its contract is refused', async () => {
  const answered = { ...callbackQuery, status: 'answered' };
  for (
    const refused of [
      { ...callbackQuery, id: '' },
      { ...callbackQuery, status: 'cancelled' },
      { ...answered, answer: { ...answer, url: '' } },
      { ...answered, answer: { ...answer, cache_time: -1 } },
      { ...answered, answer: { show_alert: false } },
    ]
  ) {
    await assertRejects(
      () => readCallbackQuery(refused),
      EmulationClientError,
      'does not match its contract',
    );
  }
});

Deno.test('A callback query within its contract is read', async () => {
  const answered = {
    ...callbackQuery,
    status: 'answered',
    answer: { text: 'Done', show_alert: true, url: 't.me/answer_bot?start=go', cache_time: 30 },
  };

  assertEquals(
    [await readCallbackQuery(callbackQuery), await readCallbackQuery(answered)],
    [{ callback_query: callbackQuery }, { callback_query: answered }],
    'Expected unanswered and answered queries read as they are',
  );
});
