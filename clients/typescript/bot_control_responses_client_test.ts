/**
 * The client refuses bot control responses that break what the contracts promise: queued answers
 * that name an empty method, and webhook attempts whose failure and retry do not match their
 * status.
 */
import { assertEquals, assertRejects } from '@std/assert';

import {
  queueRateLimitResponsesContract,
  queueServerErrorResponsesContract,
} from '../../src/api/contracts/queued_bot_api_answers.ts';
import { listWebhookAttemptsContract } from '../../src/api/contracts/webhook_attempts.ts';
import {
  callJsonAction,
  callJsonOperation,
  type ControlOperationTransport,
} from './control_operation_caller.ts';
import { EmulationClientError } from './emulation_client_error.ts';
import { TEST_ACTION_RECEIPT_HEADERS } from './test_support/action_receipt_headers.ts';

function transportAnswering(status: number, body: unknown): ControlOperationTransport {
  return {
    serverRoot: new URL('http://emulator.example/'),
    fetch: () =>
      Promise.resolve(Response.json(body, { status, headers: TEST_ACTION_RECEIPT_HEADERS })),
  };
}

const botPath = { sessionId: 'session', botId: 1 };

Deno.test('Queued answers that name an empty method are refused', async () => {
  const queueRateLimits = async (body: unknown) =>
    (await callJsonAction(transportAnswering(201, body), queueRateLimitResponsesContract, {
      params: botPath,
      body: { retry_after: 1 },
    })).result;
  const queueServerErrors = async (body: unknown) =>
    (await callJsonAction(transportAnswering(201, body), queueServerErrorResponsesContract, {
      params: botPath,
      body: { error_code: 500 },
    })).result;

  await assertRejects(
    () => queueRateLimits({ method: '', retry_after: 1, remaining_count: 1 }),
    EmulationClientError,
    'does not match its contract',
  );
  await assertRejects(
    () => queueServerErrors({ method: '', error_code: 500, remaining_count: 1 }),
    EmulationClientError,
    'does not match its contract',
  );
  assertEquals(
    [
      await queueRateLimits({ method: 'getMe', retry_after: 1, remaining_count: 1 }),
      await queueServerErrors({ error_code: 503, remaining_count: 2 }),
    ],
    [
      { method: 'getMe', retry_after: 1, remaining_count: 1 },
      { error_code: 503, remaining_count: 2 },
    ],
    'Expected answers within their bounds read',
  );
});

Deno.test('A webhook attempt whose failure and retry do not match its status is refused', async () => {
  const listAttempts = (attempt: Record<string, unknown>) =>
    callJsonOperation(
      transportAnswering(200, { webhook_attempts: [attempt] }),
      listWebhookAttemptsContract,
      { params: botPath },
    );
  const attempt = { id: 1, update_id: 1, scheduling: 'manual', status: 'in_flight' };
  const failure = { reason: 'timed_out', error_message: 'Read timeout expired' };
  const retry = { delay_seconds: 1, status: 'waiting' };

  for (
    const refused of [
      { ...attempt, failure, retry },
      { ...attempt, status: 'accepted', retry },
      { ...attempt, status: 'failed' },
      { ...attempt, status: 'failed', failure },
      { ...attempt, status: 'failed', retry },
    ]
  ) {
    await assertRejects(
      () => listAttempts(refused),
      EmulationClientError,
      'does not match its contract',
    );
  }
  const failedAttempt = { ...attempt, status: 'failed', failure, retry };
  const listings = [await listAttempts(attempt), await listAttempts(failedAttempt)];
  assertEquals(
    listings.map(({ webhook_attempts }) => webhook_attempts),
    [[attempt], [failedAttempt]],
    'Expected attempts that match their status read',
  );
});
