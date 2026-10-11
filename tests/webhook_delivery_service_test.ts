import { assertEquals } from '@std/assert';
import { WEBHOOK_ATTEMPT_TIMEOUT_MILLISECONDS } from '../src/services/webhook_delivery/webhook_attempt_scheduler.ts';
import type { Scheduler } from '../src/timing/session/session_timing.ts';
import type { BotActivityEntry, BotActivityFilter } from '../src/types/bot_activity.ts';
import { assertEqualsInFieldOrder } from './support/field_order_assertion.ts';
import { TEST_UNIX_TIME_SECONDS } from './support/fixed_wall_clock.ts';
import {
  ControlledScheduler,
  createRealTimeScheduler,
  createRetryScheduler,
} from './support/scheduler.ts';
import {
  createWebhookSession,
  respondOnlyByAborting,
  waitForAbort,
  waitUntil,
  WEBHOOK_URL,
  type WebhookSession,
} from './support/webhook_delivery.ts';

Deno.test('Webhook delivery sets, keeps, replaces, and deletes webhooks as Telegram does', () => {
  using webhookSession = createWebhookSession(() => new Response(null));
  const { session, bot, setWebhook, getWebhookInfo } = webhookSession;

  const outcomes = [
    setWebhook({ url: '' }),
    setWebhook({}),
    setWebhook({}),
    setWebhook({ secretToken: 'other_secret' }),
    setWebhook({ secretToken: 'other_secret', dropPendingUpdates: true }),
    setWebhook({ url: '' }),
    setWebhook({ url: '' }),
  ].map((result) => result.accepted ? result.outcome : result.reason);
  assertEquals(
    outcomes,
    [
      'webhook_already_deleted',
      'webhook_set',
      'webhook_already_set',
      'webhook_set',
      'webhook_set',
      'webhook_deleted',
      'webhook_already_deleted',
    ],
    "Expected Telegram's setWebhook outcomes",
  );

  setWebhook({});
  assertEquals(
    [
      session.botUpdateConsumers.deleteWebhook(bot.id, { dropPendingUpdates: false }),
      session.botUpdateConsumers.deleteWebhook(bot.id, { dropPendingUpdates: true }),
    ],
    ['webhook_deleted', 'webhook_already_deleted'],
    'Expected deleteWebhook to delete once',
  );

  // A URL without a scheme is an HTTPS URL, and is reported as the bot specified it.
  setWebhook({ url: 'bot.example/webhook' });
  assertEquals(
    getWebhookInfo().url,
    'bot.example/webhook',
    'Expected a URL without a scheme to be accepted and reported unchanged',
  );
});

Deno.test('Webhook delivery rejects invalid URLs and secret tokens without changing the webhook', () => {
  using webhookSession = createWebhookSession(() => new Response(null));
  const { setWebhook, getWebhookInfo } = webhookSession;

  setWebhook();
  const rejections = [
    { url: 'https://bot example/webhook' },
    { url: 'ftp://bot.example/webhook' },
    { secretToken: 'a'.repeat(257) },
    { secretToken: 'not allowed!' },
  ].map((request) => {
    const result = setWebhook(request);
    return result.accepted ? result.outcome : result.reason;
  });
  assertEquals(
    rejections,
    ['url_invalid', 'url_invalid', 'secret_token_too_long', 'secret_token_invalid'],
    "Expected Telegram's setWebhook rejections",
  );
  assertEquals(
    getWebhookInfo().url,
    WEBHOOK_URL,
    'Expected a rejected request to keep the current webhook',
  );

  const longestSecretToken = setWebhook({ secretToken: 'a'.repeat(256) });
  assertEquals(
    longestSecretToken.accepted,
    true,
    'Expected a secret token of 256 characters to be accepted',
  );
});

Deno.test('Webhook delivery posts pending updates in order and confirms accepted ones', async () => {
  using webhookSession = createWebhookSession(() => new Response('ignored body'));
  const { adaId, receivedRequests, sendAccountMessage, setWebhook, getWebhookInfo } =
    webhookSession;

  sendAccountMessage(adaId);
  sendAccountMessage(adaId);
  setWebhook({ url: 'https://user:pass@bot.example/webhook?token=1', secretToken: 'secret_1' });
  await webhookSession.waitForRequestCount(2);
  sendAccountMessage(adaId);
  await webhookSession.waitForRequestCount(3);

  assertEquals(
    receivedRequests.map(({ updateId }) => updateId),
    [1, 2, 3],
    'Expected each pending update to be posted once, in order',
  );
  const [firstRequest] = receivedRequests;
  assertEquals(
    [
      firstRequest.method,
      firstRequest.url,
      firstRequest.headers.get('Content-Type'),
      firstRequest.headers.get('X-Telegram-Bot-Api-Secret-Token'),
      firstRequest.headers.get('Authorization'),
      firstRequest.redirect,
    ],
    [
      'POST',
      'https://bot.example/webhook?token=1',
      'application/json',
      'secret_1',
      `Basic ${btoa('user:pass')}`,
      'manual',
    ],
    'Expected a JSON POST with the secret token and URL credentials as headers',
  );
  // Only the update in flight is still pending.
  assertEquals(
    getWebhookInfo().pending_update_count,
    1,
    'Expected accepted updates to be confirmed',
  );
});

Deno.test('Webhook delivery retries a failed update and reports the latest failure', async () => {
  using webhookSession = createWebhookSession((_request, requestIndex) =>
    requestIndex === 0
      ? new Response(null, { status: 500, statusText: 'Internal Server Error' })
      : new Response(null)
  );
  const { adaId, receivedRequests, sendAccountMessage, setWebhook, getWebhookInfo } =
    webhookSession;

  sendAccountMessage(adaId);
  setWebhook();
  await webhookSession.waitForRequestCount(2);
  sendAccountMessage(adaId);
  await webhookSession.waitForRequestCount(3);

  assertEquals(
    receivedRequests.map(({ updateId }) => updateId),
    [1, 1, 2],
    'Expected a failed update to be sent again at once, before later ones',
  );
  const webhookInfo = getWebhookInfo();
  assertEquals(
    [webhookInfo.last_error_date, webhookInfo.last_error_message],
    [TEST_UNIX_TIME_SECONDS, 'Wrong response from the webhook: 500 Internal Server Error'],
    'Expected the failure to be reported after later successes',
  );

  setWebhook({ url: `${WEBHOOK_URL}/new` });
  assertEquals(
    'last_error_message' in getWebhookInfo(),
    false,
    'Expected a new webhook to forget the failure of the previous one',
  );
});

Deno.test('Webhook delivery records each attempt as a delivery, a failure as such, and the acceptance as a confirmation', async () => {
  using webhookSession = createWebhookSession((_request, requestIndex) =>
    requestIndex === 0
      ? new Response(null, { status: 500, statusText: 'Internal Server Error' })
      : new Response(null)
  );
  const { bot, adaId, sendAccountMessage, setWebhook, getWebhookInfo } = webhookSession;

  sendAccountMessage(adaId);
  setWebhook();
  await webhookSession.waitForRequestCount(2);
  await waitUntil(() => getWebhookInfo().pending_update_count === 0);

  const recorded = await readEntries(webhookSession, {});
  assertEquals(
    recorded.map((entry) => [
      entry.kind,
      entry.botId,
      entry.chatId,
      entry.kind === 'bot_api_call' ? undefined : entry.webhookAttemptId,
    ]),
    [
      ['update_delivered', bot.id, adaId, 1],
      ['webhook_attempt_failed', bot.id, adaId, 1],
      ['update_delivered', bot.id, adaId, 2],
      ['update_confirmed', bot.id, adaId, 2],
    ],
    "Expected two attempts, the first one's failure, and the second one's confirmation",
  );
  const [, failure] = recorded;
  assertEquals(
    failure?.kind === 'webhook_attempt_failed' &&
      [failure.failure, failure.retryDelaySeconds, failure.updateId],
    [
      {
        reason: 'http_error',
        statusCode: 500,
        errorMessage: 'Wrong response from the webhook: 500 Internal Server Error',
      },
      0,
      1,
    ],
    'Expected the failure and its immediate retry',
  );
});

Deno.test('Webhook delivery keeps delivering other chats while one chat keeps failing', async () => {
  // Update 1 always fails, and its retry waits until delivery ends.
  let receivedUpdateIds: () => readonly number[] = () => [];
  using webhookSession = createWebhookSession(
    (_request, requestIndex) =>
      receivedUpdateIds()[requestIndex] === 1
        ? new Response(null, { status: 500, statusText: 'Internal Server Error' })
        : new Response(null),
    { scheduler: createRetryScheduler((_delaySeconds, signal) => waitForAbort(signal)) },
  );
  const { adaId, graceId, receivedRequests, sendAccountMessage, setWebhook, getWebhookInfo } =
    webhookSession;
  receivedUpdateIds = () => receivedRequests.map(({ updateId }) => updateId);

  sendAccountMessage(adaId);
  sendAccountMessage(adaId);
  sendAccountMessage(graceId);
  setWebhook();
  await webhookSession.waitForRequestCount(2);
  sendAccountMessage(graceId);
  await webhookSession.waitForRequestCount(3);
  await waitUntil(() => getWebhookInfo().pending_update_count === 2);

  // Ada's update 2 waits behind her failing update 1, while Grace's updates are delivered.
  assertEquals(
    receivedUpdateIds().toSorted(),
    [1, 3, 4],
    "Expected only Ada's chat to wait for its failing update",
  );
});

Deno.test('Webhook delivery sends at most max_connections updates at once, one per chat', async () => {
  const responses: Array<(response: Response) => void> = [];
  using webhookSession = createWebhookSession(() =>
    new Promise<Response>((resolve) => responses.push(resolve))
  );
  const { adaId, graceId, linusId, receivedRequests, sendAccountMessage, setWebhook } =
    webhookSession;

  sendAccountMessage(adaId);
  sendAccountMessage(graceId);
  sendAccountMessage(linusId);
  sendAccountMessage(adaId);
  setWebhook({ maxConnections: 2 });
  await webhookSession.waitForRequestCount(2);
  await new Promise((resolve) => setTimeout(resolve, 10));
  const inFlightAtFirst = receivedRequests.map(({ updateId }) => updateId);

  // Ada's first update frees a connection for Linus, and Ada's next update waits its turn.
  responses[0](new Response(null));
  await webhookSession.waitForRequestCount(3);
  responses[1](new Response(null));
  await webhookSession.waitForRequestCount(4);
  assertEquals(
    { inFlightAtFirst, sentUpdateIds: receivedRequests.map(({ updateId }) => updateId) },
    { inFlightAtFirst: [1, 2], sentUpdateIds: [1, 2, 3, 4] },
    'Expected two connections shared by chats in turn',
  );
});

Deno.test('Webhook delivery waits as long as a failed response asks with Retry-After', async () => {
  // Each failed response asks for a wait as Telegram reads its header, or for none.
  const failedResponseRetryAfters = [
    undefined,
    '5',
    undefined,
    '99999',
    'Wed, 21 Oct 2026 07:28:00 GMT',
    '-3',
    '2147483648',
  ];
  const requestedDelaysSeconds: number[] = [];
  using webhookSession = createWebhookSession(
    (_request, requestIndex) => {
      const retryAfter = failedResponseRetryAfters[requestIndex];
      if (requestIndex >= failedResponseRetryAfters.length) {
        return new Response(null, { headers: { 'Retry-After': '30' } });
      }
      return new Response(null, {
        status: 503,
        statusText: 'Service Unavailable',
        headers: retryAfter === undefined ? {} : { 'Retry-After': retryAfter },
      });
    },
    {
      scheduler: createRetryScheduler((delaySeconds) => {
        requestedDelaysSeconds.push(delaySeconds);
        return Promise.resolve();
      }),
    },
  );
  const { adaId, sendAccountMessage, setWebhook, getWebhookInfo } = webhookSession;

  sendAccountMessage(adaId);
  setWebhook();
  await webhookSession.waitForRequestCount(failedResponseRetryAfters.length + 1);
  await waitUntil(() => getWebhookInfo().pending_update_count === 0);

  // A requested wait, capped at an hour, replaces the backoff delay without doubling it.
  assertEquals(
    requestedDelaysSeconds,
    [0, 5, 2, 3600, 4, 8, 16],
    'Expected Retry-After to set the waits it asks for',
  );
});

Deno.test('Webhook delivery reports a webhook it cannot connect to', async () => {
  using webhookSession = createWebhookSession(() => {
    throw new TypeError('fetch failed');
  });
  const { adaId, receivedRequests, sendAccountMessage, setWebhook, getWebhookInfo } =
    webhookSession;

  sendAccountMessage(adaId);
  setWebhook();
  // The first failure is retried at once; the second waits 2 seconds.
  await webhookSession.waitForRequestCount(2);

  const webhookInfo = getWebhookInfo();
  assertEquals(
    [
      receivedRequests.map(({ updateId }) => updateId),
      webhookInfo.last_error_message,
      webhookInfo.pending_update_count,
    ],
    [[1, 1], "Can't connect to the webhook", 1],
    "Expected Telegram's connection failure and the update to stay pending",
  );
});

Deno.test('Webhook delivery fails an attempt that outlasts its timeout and retries the update', async () => {
  const { scheduler, deadlines } = createSchedulerWithControlledDeadlines();
  using webhookSession = createWebhookSession(
    // The first request ignores its abort, as a sender might; the second hangs until aborted.
    (request, requestIndex) =>
      requestIndex === 0 ? new Promise<Response>(() => {}) : respondOnlyByAborting(request),
    { scheduler },
  );
  const { adaId, receivedRequests, sendAccountMessage, setWebhook, getWebhookInfo } =
    webhookSession;

  sendAccountMessage(adaId);
  sendAccountMessage(adaId);
  setWebhook();
  // The first timeout is retried at once; the second waits 2 seconds.
  await webhookSession.waitForRequestCount(1);
  deadlines[0].arrive();
  await webhookSession.waitForRequestCount(2);
  deadlines[1].arrive();
  await waitUntil(() => receivedRequests.every(({ signal }) => signal.aborted));
  await waitUntil(() => getWebhookInfo().last_error_message !== undefined);

  const webhookInfo = getWebhookInfo();
  assertEquals(
    [
      deadlines.map(({ delayMilliseconds }) => delayMilliseconds),
      receivedRequests.map(({ updateId }) => updateId),
      webhookInfo.last_error_message,
      webhookInfo.pending_update_count,
    ],
    [
      [WEBHOOK_ATTEMPT_TIMEOUT_MILLISECONDS, WEBHOOK_ATTEMPT_TIMEOUT_MILLISECONDS],
      [1, 1],
      'Read timeout expired',
      2,
    ],
    "Expected timed-out attempts to be aborted and retried, each timed by Telegram's timeout",
  );
});

Deno.test('Webhook delivery runs the reply of an accepted update only', async () => {
  let replyBody = '';
  using webhookSession = createWebhookSession((_request, requestIndex) =>
    requestIndex === 0
      ? new Response(replyBody, { status: 500, statusText: 'Internal Server Error' })
      : new Response(replyBody, { headers: { 'Content-Type': 'application/json' } })
  );
  const { adaId, sendAccountMessage, setWebhook } = webhookSession;
  replyBody = JSON.stringify({ method: 'sendMessage', chat_id: adaId, text: 'Hi' });

  sendAccountMessage(adaId);
  setWebhook();
  await webhookSession.waitForRequestCount(2);

  assertEquals(
    await readReplyCalls(webhookSession, 1),
    [['sendMessage', adaId, true]],
    "Expected only the accepted update's reply to run",
  );
});

Deno.test('Webhook delivery retries an accepted update whose response is cut short', async () => {
  let replyBody = '';
  using webhookSession = createWebhookSession((_request, requestIndex) =>
    new Response(
      requestIndex === 0
        ? new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(replyBody.slice(0, 10)));
            controller.error(new Error('The connection closed'));
          },
        })
        : replyBody,
      { headers: { 'Content-Type': 'application/json' } },
    )
  );
  const { adaId, receivedRequests, sendAccountMessage, setWebhook, getWebhookInfo } =
    webhookSession;
  replyBody = JSON.stringify({ method: 'sendMessage', chat_id: adaId, text: 'Hi' });

  sendAccountMessage(adaId);
  setWebhook();
  await webhookSession.waitForRequestCount(2);
  await waitUntil(() => getWebhookInfo().pending_update_count === 0);

  assertEquals(
    [receivedRequests.map(({ updateId }) => updateId), await readReplyCalls(webhookSession, 1)],
    [[1, 1], [['sendMessage', adaId, true]]],
    'Expected an incomplete response to leave its update pending, unreplied',
  );
  assertEquals(
    'last_error_message' in getWebhookInfo(),
    false,
    'Expected a closed connection to be retried without a reported error',
  );
});

Deno.test('Webhook delivery fails an accepted update whose response body outlasts its timeout', async () => {
  const { scheduler, deadlines } = createSchedulerWithControlledDeadlines();
  let replyBody = '';
  using webhookSession = createWebhookSession(
    (_request, requestIndex) =>
      requestIndex === 0
        ? new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new TextEncoder().encode(replyBody.slice(0, 10)));
            },
          }),
          { headers: { 'Content-Type': 'application/json' } },
        )
        : new Response(replyBody, { headers: { 'Content-Type': 'application/json' } }),
    { scheduler },
  );
  const { adaId, sendAccountMessage, setWebhook, getWebhookInfo } = webhookSession;
  replyBody = JSON.stringify({ method: 'sendMessage', chat_id: adaId, text: 'Hi' });

  sendAccountMessage(adaId);
  setWebhook();
  await webhookSession.waitForRequestCount(1);
  deadlines[0].arrive();
  await webhookSession.waitForRequestCount(2);
  await waitUntil(() => getWebhookInfo().pending_update_count === 0);

  assertEquals(
    [getWebhookInfo().last_error_message, await readReplyCalls(webhookSession, 1)],
    ['Read timeout expired', [['sendMessage', adaId, true]]],
    'Expected a stalled response body to time out, unreplied, and its retry to be replied',
  );
});

Deno.test('Webhook delivery ends delivery and keeps the update in flight pending', async () => {
  using webhookSession = createWebhookSession(respondOnlyByAborting);
  const { session, adaId, receivedRequests, sendAccountMessage, setWebhook, getWebhookInfo } =
    webhookSession;

  sendAccountMessage(adaId);
  setWebhook();
  await webhookSession.waitForRequestCount(1);
  // The second update waits in Ada's queue behind the one in flight.
  sendAccountMessage(adaId);
  session.end();
  setWebhook({ url: `${WEBHOOK_URL}/new` });
  await new Promise((resolve) => setTimeout(resolve, 10));

  assertEquals(
    receivedRequests.length,
    1,
    'Expected no delivery after delivery ended',
  );
  const webhookInfo = getWebhookInfo();
  assertEquals(
    [webhookInfo.pending_update_count, 'last_error_message' in webhookInfo],
    [2, false],
    'Expected the interrupted update to stay pending without a failure',
  );
});

Deno.test('Webhook delivery reports getWebhookInfo fields in Telegram order', () => {
  using webhookSession = createWebhookSession(respondOnlyByAborting);
  const { adaId, sendAccountMessage, setWebhook, getWebhookInfo } = webhookSession;

  assertEqualsInFieldOrder(
    getWebhookInfo(),
    { url: '', has_custom_certificate: false, pending_update_count: 0 },
    'Expected only the URL, certificate, and pending count without a webhook',
  );

  sendAccountMessage(adaId);
  sendAccountMessage(adaId);
  setWebhook({ allowedUpdates: ['CALLBACK_QUERY', 'message', 'custom_event'] });
  assertEqualsInFieldOrder(
    getWebhookInfo(),
    {
      url: WEBHOOK_URL,
      has_custom_certificate: false,
      pending_update_count: 2,
      max_connections: 40,
      allowed_updates: ['message', 'callback_query'],
    },
    'Expected the webhook, its pending updates, and the listed subscription',
  );

  // A request that changes no webhook still changes the subscription.
  const unchanged = setWebhook({ allowedUpdates: ['message'] });
  const dropping = setWebhook({ dropPendingUpdates: true });
  const webhookInfo = getWebhookInfo();
  assertEquals(
    [unchanged, dropping, webhookInfo.allowed_updates, webhookInfo.pending_update_count],
    [
      { accepted: true, outcome: 'webhook_already_set' },
      { accepted: true, outcome: 'webhook_set' },
      ['message'],
      0,
    ],
    'Expected allowed updates to apply and dropped updates to be discarded',
  );
});

/**
 * A scheduler that sleeps in real time, and whose deadlines, such as each webhook attempt's
 * timeout, arrive only when the test says so.
 */
function createSchedulerWithControlledDeadlines() {
  const controlledScheduler = new ControlledScheduler();
  const realTimeScheduler = createRealTimeScheduler();
  const scheduler: Scheduler = {
    deadline: (delayMilliseconds, lifetime) =>
      controlledScheduler.deadline(delayMilliseconds, lifetime),
    sleep: (delayMilliseconds, signal) => realTimeScheduler.sleep(delayMilliseconds, signal),
  };
  return { scheduler, deadlines: controlledScheduler.deadlines };
}

/** Reads the session's bot activity entries that match `filter`, without waiting. */
async function readEntries(
  { session }: WebhookSession,
  filter: BotActivityFilter,
): Promise<readonly BotActivityEntry[]> {
  const result = await session.botActivity.readEntries({
    after: 0,
    filter,
    limit: 100,
    waitMilliseconds: 0,
  });
  if (!result.read) {
    throw new Error(`Expected the bot activity to be read: ${result.reason}`);
  }
  return result.entries;
}

/**
 * Waits until the bot's webhook replies have made `count` calls, and answers with each one's
 * method, chat, and success.
 */
async function readReplyCalls(
  webhookSession: WebhookSession,
  count: number,
): Promise<readonly unknown[]> {
  const readCalls = async () =>
    (await readEntries(webhookSession, { kind: 'bot_api_call' })).flatMap((entry) =>
      entry.kind === 'bot_api_call' && entry.via === 'webhook_reply'
        ? [[entry.method, entry.chatId, entry.answer.ok]]
        : []
    );
  const deadline = Date.now() + 1_000;
  let calls = await readCalls();
  while (calls.length < count && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 5));
    calls = await readCalls();
  }
  return calls;
}
