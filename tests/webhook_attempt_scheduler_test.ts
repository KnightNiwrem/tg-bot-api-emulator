import { assertEquals } from '@std/assert';
import type { WebhookAttemptScheduler } from '../src/services/webhook_delivery/webhook_attempt_scheduler.ts';
import type { BotActivityEntry, BotActivityFilter } from '../src/types/bot_activity.ts';
import type { WebhookAttempt } from '../src/types/bot_webhook.ts';
import { createRetryScheduler } from './support/scheduler.ts';
import { createVirtualBot } from './support/virtual_users.ts';
import {
  createWebhookSession,
  respondOnlyByAborting,
  WEBHOOK_URL,
  type WebhookResponder,
} from './support/webhook_delivery.ts';

const READ_TIMEOUT = 'Read timeout expired';

Deno.test('Manual scheduling waits for a test to release each retry and expire each attempt', async () => {
  // The webhook fails the first attempt, never answers the second, and accepts the third.
  using fixture = createSchedulerFixture((request, requestIndex) => {
    if (requestIndex === 0) {
      return new Response(null, { status: 500, statusText: 'Internal Server Error' });
    }
    return requestIndex === 1 ? respondOnlyByAborting(request) : new Response(null);
  });
  const {
    botId,
    webhookAttempts,
    receivedRequests,
    adaId,
    sendAccountMessage,
    setWebhook,
    getWebhookInfo,
  } = fixture;

  webhookAttempts.setScheduling(botId, 'manual');
  sendAccountMessage(adaId);
  setWebhook();

  const firstFailure = await fixture.waitForEntry({ kind: 'webhook_attempt_failed' });
  // Telegram would send the update again at once; manual scheduling waits for the test.
  await new Promise((resolve) => setTimeout(resolve, 20));
  assertEquals(
    [receivedRequests.length, listAttempts(webhookAttempts, botId)],
    [1, [{
      id: 1,
      botId,
      updateId: 1,
      scheduling: 'manual',
      status: 'failed',
      failure: {
        reason: 'http_error',
        statusCode: 500,
        errorMessage: 'Wrong response from the webhook: 500 Internal Server Error',
      },
      retry: { delaySeconds: 0, status: 'waiting' },
    }]],
    'Expected the failed attempt to wait for its retry to be released',
  );
  assertEquals(
    firstFailure.kind === 'webhook_attempt_failed' &&
      [firstFailure.webhookAttemptId, firstFailure.retryDelaySeconds],
    [1, 0],
    'Expected the failure entry to name the attempt and its retry delay',
  );

  const release = webhookAttempts.releaseRetry(botId, 1);
  const repeatedRelease = webhookAttempts.releaseRetry(botId, 1);
  assertEquals(
    [
      release.released && release.attempt.status === 'failed' && release.attempt.retry,
      repeatedRelease,
    ],
    [
      { delaySeconds: 0, status: 'released' },
      { released: false, reason: 'retry_not_waiting' },
    ],
    'Expected a retry to be released once',
  );

  await fixture.waitForRequestCount(2);
  // The webhook's 60-second timeout would end the attempt; manual scheduling waits for the test.
  const [expiry, concurrentExpiry] = await Promise.all([
    webhookAttempts.expireAttempt(botId, 2),
    webhookAttempts.expireAttempt(botId, 2),
  ]);
  assertEquals(
    [expiry, concurrentExpiry, await webhookAttempts.expireAttempt(botId, 1)],
    [
      {
        expired: true,
        attempt: {
          id: 2,
          botId,
          updateId: 1,
          scheduling: 'manual',
          status: 'failed',
          failure: { reason: 'timed_out', errorMessage: READ_TIMEOUT },
          retry: { delaySeconds: 2, status: 'waiting' },
        },
      },
      { expired: false, reason: 'attempt_not_in_flight' },
      { expired: false, reason: 'attempt_not_in_flight' },
    ],
    'Expected the attempt in flight to time out once, and to back off as Telegram does',
  );
  assertEquals(
    [
      receivedRequests[1].signal.aborted,
      getWebhookInfo().last_error_message,
      getWebhookInfo().pending_update_count,
    ],
    [true, READ_TIMEOUT, 1],
    'Expected the expired request to be aborted and the update to stay pending',
  );

  webhookAttempts.releaseRetry(botId, 2);
  await fixture.waitForEntry({ kind: 'update_confirmed' });
  assertEquals(
    [
      listAttempts(webhookAttempts, botId).map(({ status }) => status),
      getWebhookInfo().pending_update_count,
      webhookAttempts.releaseRetry(botId, 3),
      await webhookAttempts.expireAttempt(botId, 3),
      (await fixture.readEntries({})).map((entry) =>
        entry.kind === 'bot_api_call' ? entry.kind : [entry.kind, entry.webhookAttemptId]
      ),
    ],
    [
      ['failed', 'failed', 'accepted'],
      0,
      { released: false, reason: 'retry_not_waiting' },
      { expired: false, reason: 'attempt_not_in_flight' },
      [
        ['update_delivered', 1],
        ['webhook_attempt_failed', 1],
        ['update_delivered', 2],
        ['webhook_attempt_failed', 2],
        ['update_delivered', 3],
        ['update_confirmed', 3],
      ],
    ],
    'Expected the recovered update to be confirmed once, and its attempts to need no control',
  );
});

Deno.test('Webhook attempt controls apply only to the attempts of the bot they name', async () => {
  using fixture = createSchedulerFixture(
    () => new Response(null, { status: 502, statusText: 'Bad Gateway' }),
  );
  const {
    botId,
    otherBotId,
    webhookAttempts,
    adaId,
    sendAccountMessage,
    setWebhook,
  } = fixture;
  const unknownBotId = Math.max(botId, otherBotId) + 1;

  webhookAttempts.setScheduling(botId, 'manual');
  sendAccountMessage(adaId);
  setWebhook();
  await fixture.waitForEntry({ kind: 'webhook_attempt_failed' });

  assertEquals(
    [
      webhookAttempts.getScheduling(otherBotId),
      webhookAttempts.releaseRetry(otherBotId, 1),
      await webhookAttempts.expireAttempt(otherBotId, 1),
      webhookAttempts.listAttempts(otherBotId),
      webhookAttempts.releaseRetry(botId, 2),
      webhookAttempts.getScheduling(unknownBotId),
      webhookAttempts.setScheduling(unknownBotId, 'manual'),
      webhookAttempts.listAttempts(unknownBotId),
      webhookAttempts.releaseRetry(unknownBotId, 1),
      await webhookAttempts.expireAttempt(unknownBotId, 1),
    ],
    [
      { found: true, scheduling: 'automatic' },
      { released: false, reason: 'attempt_not_found' },
      { expired: false, reason: 'attempt_not_found' },
      { found: true, attempts: [] },
      { released: false, reason: 'attempt_not_found' },
      { found: false, reason: 'bot_not_found' },
      { found: false, reason: 'bot_not_found' },
      { found: false, reason: 'bot_not_found' },
      { released: false, reason: 'bot_not_found' },
      { expired: false, reason: 'bot_not_found' },
    ],
    "Expected another bot's controls to find none of the bot's attempts",
  );
  const [attempt] = listAttempts(webhookAttempts, botId);
  assertEquals(
    attempt.status === 'failed' && attempt.retry.status,
    'waiting',
    "Expected the bot's retry to keep waiting",
  );
});

Deno.test('Replacing or deleting a webhook and ending delivery cancel its attempts and retries', async () => {
  // The first webhook never answers; the second fails every update; the third never answers.
  using fixture = createSchedulerFixture((request) =>
    request.url.endsWith('/second')
      ? new Response(null, { status: 500, statusText: 'Internal Server Error' })
      : respondOnlyByAborting(request)
  );
  const {
    botId,
    webhookAttempts,
    receivedRequests,
    session,
    bot,
    adaId,
    sendAccountMessage,
    setWebhook,
    getWebhookInfo,
  } = fixture;

  sendAccountMessage(adaId);
  webhookAttempts.setScheduling(botId, 'manual');
  setWebhook();
  await fixture.waitForRequestCount(1);

  setWebhook({ url: `${WEBHOOK_URL}/second` });
  await fixture.waitForEntry({ kind: 'webhook_attempt_failed' });
  assertEquals(
    [
      receivedRequests[0].signal.aborted,
      await webhookAttempts.expireAttempt(botId, 1),
      listAttempts(webhookAttempts, botId).map(describeAttemptState),
    ],
    [
      true,
      { expired: false, reason: 'attempt_not_in_flight' },
      ['cancelled', 'failed: waiting'],
    ],
    "Expected the replaced webhook's attempt to be cancelled and unable to time out",
  );

  session.botApi.deleteWebhook(bot, { dropPendingUpdates: false });
  assertEquals(
    [
      webhookAttempts.releaseRetry(botId, 2),
      listAttempts(webhookAttempts, botId).map(describeAttemptState),
      getWebhookInfo().pending_update_count,
    ],
    [
      { released: false, reason: 'retry_not_waiting' },
      ['cancelled', 'failed: cancelled'],
      1,
    ],
    "Expected the deleted webhook's retry to be cancelled, leaving the update pending",
  );

  setWebhook({ url: `${WEBHOOK_URL}/third` });
  await fixture.waitForRequestCount(3);
  fixture.session.end();
  await new Promise((resolve) => setTimeout(resolve, 10));
  assertEquals(
    [
      receivedRequests.length,
      receivedRequests.every(({ signal }) => signal.aborted),
      listAttempts(webhookAttempts, botId).map(describeAttemptState),
      await webhookAttempts.expireAttempt(botId, 3),
    ],
    [
      3,
      true,
      ['cancelled', 'failed: cancelled', 'cancelled'],
      { expired: false, reason: 'attempt_not_in_flight' },
    ],
    'Expected ending delivery to cancel the attempt in flight and start no other',
  );
});

Deno.test('Manual scheduling holds back only the queue of the failing update', async () => {
  // Every first attempt of an update to Ada fails; Grace's updates are accepted.
  using fixture = createSchedulerFixture((_request, requestIndex) =>
    requestIndex === 0
      ? new Response(null, { status: 500, statusText: 'Internal Server Error' })
      : new Response(null)
  );
  const {
    botId,
    webhookAttempts,
    receivedRequests,
    adaId,
    graceId,
    sendAccountMessage,
    setWebhook,
  } = fixture;

  webhookAttempts.setScheduling(botId, 'manual');
  sendAccountMessage(adaId);
  sendAccountMessage(adaId);
  sendAccountMessage(graceId);
  setWebhook();
  await fixture.waitForEntry({ kind: 'update_confirmed', updateId: 3 });
  await fixture.waitForEntry({ kind: 'webhook_attempt_failed', updateId: 1 });
  const sentBeforeRelease = receivedRequests.map(({ updateId }) => updateId).toSorted();

  const failedAttempt = listAttempts(webhookAttempts, botId).find(({ status }) =>
    status === 'failed'
  );
  webhookAttempts.releaseRetry(botId, failedAttempt?.id ?? 0);
  await fixture.waitForEntry({ kind: 'update_confirmed', updateId: 2 });
  assertEquals(
    [sentBeforeRelease, receivedRequests.slice(2).map(({ updateId }) => updateId)],
    [[1, 3], [1, 2]],
    "Expected Ada's later update to wait for her failing one, while Grace's was delivered",
  );
});

Deno.test('An attempt and its retry follow the scheduling of their bot when the attempt began', async () => {
  const retryDelaysSeconds: number[] = [];
  using fixture = createSchedulerFixture(
    (_request, requestIndex) =>
      requestIndex < 2
        ? new Response(null, { status: 500, statusText: 'Internal Server Error' })
        : new Response(null),
    {
      waitBeforeRetry: (delaySeconds) => {
        retryDelaysSeconds.push(delaySeconds);
        return Promise.resolve();
      },
    },
  );
  const {
    botId,
    webhookAttempts,
    receivedRequests,
    adaId,
    sendAccountMessage,
    setWebhook,
  } = fixture;

  webhookAttempts.setScheduling(botId, 'manual');
  sendAccountMessage(adaId);
  setWebhook();
  await fixture.waitForEntry({ kind: 'webhook_attempt_failed' });

  // The manual attempt's retry still waits for the test after scheduling turns automatic.
  webhookAttempts.setScheduling(botId, 'automatic');
  await new Promise((resolve) => setTimeout(resolve, 20));
  const sentBeforeRelease = receivedRequests.length;
  webhookAttempts.releaseRetry(botId, 1);
  await fixture.waitForEntry({ kind: 'update_confirmed' });

  assertEquals(
    [
      sentBeforeRelease,
      listAttempts(webhookAttempts, botId).map(({ scheduling }) => scheduling),
      retryDelaysSeconds,
    ],
    [1, ['manual', 'automatic', 'automatic'], [2]],
    'Expected only attempts that began under automatic scheduling to retry by themselves',
  );
});

Deno.test('Automatic scheduling lets a test expire an attempt and release a retry early', async () => {
  // The webhook never answers the first attempt, fails the second, and accepts the third.
  using fixture = createSchedulerFixture((request, requestIndex) => {
    if (requestIndex === 0) {
      return respondOnlyByAborting(request);
    }
    return requestIndex === 1
      ? new Response(null, { status: 503, statusText: 'Service Unavailable' })
      : new Response(null);
  });
  const {
    botId,
    webhookAttempts,
    adaId,
    sendAccountMessage,
    setWebhook,
  } = fixture;

  sendAccountMessage(adaId);
  setWebhook();
  await fixture.waitForRequestCount(1);
  const expiry = await webhookAttempts.expireAttempt(botId, 1);

  // The timeout is retried at once; the 503 waits 2 seconds unless the test releases it.
  await fixture.waitForEntry({ kind: 'webhook_attempt_failed', webhookAttemptId: 2 });
  const release = webhookAttempts.releaseRetry(botId, 2);
  await fixture.waitForEntry({ kind: 'update_confirmed' });
  assertEquals(
    [
      expiry.expired && describeAttemptState(expiry.attempt),
      release.released && describeAttemptState(release.attempt),
      listAttempts(webhookAttempts, botId).map(describeAttemptState),
    ],
    // The expired attempt's immediate retry was still waiting when its outcome was decided.
    ['failed: waiting', 'failed: released', [
      'failed: released',
      'failed: released',
      'accepted',
    ]],
    'Expected the controls to end the timeout and the backoff without waiting for them',
  );
});

/**
 * Creates a root-backed session with two bots, whose webhook requests `respond` answers in place of
 * the network, for the attempts of the first bot.
 */
function createSchedulerFixture(
  respond: WebhookResponder,
  options: {
    /** Waits for real when omitted. */
    readonly waitBeforeRetry?: (delaySeconds: number, signal: AbortSignal) => Promise<void>;
  } = {},
) {
  const webhookSession = createWebhookSession(respond, {
    id: 'webhook-attempt-scheduler',
    scheduler: createRetryScheduler(options.waitBeforeRetry),
  });
  const { session, bot } = webhookSession;
  const otherBotId =
    createVirtualBot(session.virtualUsers, { first_name: 'Webhook Bot', username: 'other_bot' })
      .profile.id;

  const readEntries = async (filter: BotActivityFilter) => {
    const result = await session.botActivity.readEntries({
      after: 0,
      filter,
      limit: 100,
      waitMilliseconds: 0,
    });
    return result.read ? result.entries : [];
  };

  /** Resolves with the first matching entry, waiting up to a second for one to be recorded. */
  const waitForEntry = async (
    filter: BotActivityFilter & { readonly webhookAttemptId?: number },
  ): Promise<BotActivityEntry> => {
    const { webhookAttemptId, ...criteria } = filter;
    const deadline = Date.now() + 1_000;
    for (let after = 0;;) {
      const result = await session.botActivity.readEntries({
        after,
        filter: { ...criteria, botId: bot.id },
        limit: 100,
        waitMilliseconds: Math.max(deadline - Date.now(), 0),
      });
      if (!result.read) {
        throw new Error(`Expected bot activity to be readable, received ${result.reason}`);
      }
      const entry = result.entries.find((candidate) =>
        webhookAttemptId === undefined ||
        (candidate.kind !== 'bot_api_call' && candidate.webhookAttemptId === webhookAttemptId)
      );
      if (entry !== undefined) {
        return entry;
      }
      if (Date.now() >= deadline) {
        throw new Error(`Expected an entry matching ${JSON.stringify(filter)} within a second`);
      }
      after = result.entries.at(-1)?.position ?? result.headPosition;
    }
  };

  return {
    ...webhookSession,
    botId: bot.id,
    otherBotId,
    webhookAttempts: session.webhookAttempts,
    readEntries,
    waitForEntry,
  };
}

function listAttempts(
  webhookAttempts: WebhookAttemptScheduler,
  botId: number,
): readonly WebhookAttempt[] {
  const result = webhookAttempts.listAttempts(botId);
  if (!result.found) {
    throw new Error(`Expected the bot's attempts to be listed, received ${result.reason}`);
  }
  return result.attempts;
}

/** The attempt's status, followed by its retry's for a failed attempt. */
function describeAttemptState(attempt: WebhookAttempt): string {
  return attempt.status === 'failed' ? `failed: ${attempt.retry.status}` : attempt.status;
}
