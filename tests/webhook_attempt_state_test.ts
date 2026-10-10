import {
  endWebhookAttempt,
  endWebhookRetry,
  type WebhookAttempt,
  type WebhookAttemptEnd,
} from '../src/types/bot_webhook.ts';

const IN_FLIGHT: WebhookAttempt = {
  id: 1,
  botId: 10,
  updateId: 7,
  scheduling: 'manual',
  status: 'in_flight',
};

const FAILURE_END: WebhookAttemptEnd = {
  status: 'failed',
  failure: { reason: 'connection_failed', errorMessage: "Can't connect to the webhook" },
  retryDelaySeconds: 2,
};

Deno.test('an attempt in flight ends once, as accepted, failed or cancelled', () => {
  const ends: readonly WebhookAttemptEnd[] = [
    { status: 'accepted' },
    { status: 'cancelled' },
    FAILURE_END,
  ];
  const endedAttempts = ends.map((end) => endWebhookAttempt(IN_FLIGHT, end));
  assertJson(
    endedAttempts.map((attempt) =>
      attempt?.status === 'failed' ? [attempt.status, attempt.retry] : attempt?.status
    ),
    ['accepted', 'cancelled', ['failed', { delaySeconds: 2, status: 'waiting' }]],
    'Expected each end to be reached from in flight, a failure with its retry waiting',
  );
  assertJson(
    endedAttempts.flatMap((endedAttempt) =>
      ends.map((end) =>
        endedAttempt === undefined ? 'missing' : endWebhookAttempt(endedAttempt, end)
      )
    ),
    Array(9).fill(undefined),
    'Expected an ended attempt to have no further transition',
  );
});

Deno.test("a failed attempt's waiting retry ends once, as released or cancelled", () => {
  const failed = endWebhookAttempt(IN_FLIGHT, FAILURE_END);
  if (failed === undefined) {
    throw new Error('Expected the attempt to fail');
  }
  const released = endWebhookRetry(failed, 'released');
  const cancelled = endWebhookRetry(failed, 'cancelled');
  assertJson(
    [
      released?.status === 'failed' && released.retry.status,
      cancelled?.status === 'failed' && cancelled.retry.status,
      released === undefined ? 'missing' : endWebhookRetry(released, 'cancelled'),
      cancelled === undefined ? 'missing' : endWebhookRetry(cancelled, 'released'),
      endWebhookRetry(IN_FLIGHT, 'released'),
    ],
    ['released', 'cancelled', undefined, undefined, undefined],
    'Expected only a waiting retry to end, and only once',
  );
});

function assertJson(actual: unknown, expected: unknown, message: string): void {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  if (actualJson !== expectedJson) {
    throw new Error(`${message}\nExpected: ${expectedJson}\nReceived: ${actualJson}`);
  }
}
