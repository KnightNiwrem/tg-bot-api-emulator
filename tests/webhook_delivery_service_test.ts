import { BotActivityLogRepository } from '../src/repositories/bot_activity_log.ts';
import { BotUpdateRepository } from '../src/repositories/bot_update.ts';
import { BotActivityService } from '../src/services/bot_activity.ts';
import type { SetWebhookRequest } from '../src/services/bot_update_consumer.ts';
import {
  WEBHOOK_ATTEMPT_TIMEOUT_MILLISECONDS,
  WebhookAttemptScheduler,
} from '../src/services/webhook_attempt_scheduler.ts';
import { createRealTimeScheduler, createRetryScheduler } from './support/scheduler.ts';
import {
  ADA_ID,
  createPrivateMessage,
  createUpdateConsumers,
  NOW_UNIX_SECONDS,
  ReceivedRequestCounter,
  respondOnlyByAborting,
  waitForAbort,
  waitUntil,
  WEBHOOK_URL,
  webhookRequest,
} from './support/webhook_delivery.ts';

const BOT_ID = 10;
const GRACE_ID = 2;
const LINUS_ID = 3;

Deno.test('Webhook delivery sets, keeps, replaces, and deletes webhooks as Telegram does', () => {
  const { updateConsumers, endSession } = createWebhookFixture(() => new Response(null));
  const setWebhook = (request: Partial<SetWebhookRequest>) =>
    updateConsumers.setWebhook(BOT_ID, { ...webhookRequest(), ...request });

  try {
    const outcomes = [
      setWebhook({ url: '' }),
      setWebhook({}),
      setWebhook({}),
      setWebhook({ secretToken: 'other_secret' }),
      setWebhook({ secretToken: 'other_secret', dropPendingUpdates: true }),
      setWebhook({ url: '' }),
      setWebhook({ url: '' }),
    ].map((result) => result.accepted ? result.outcome : result.reason);
    const expectedOutcomes = [
      'webhook_already_deleted',
      'webhook_set',
      'webhook_already_set',
      'webhook_set',
      'webhook_set',
      'webhook_deleted',
      'webhook_already_deleted',
    ];
    if (JSON.stringify(outcomes) !== JSON.stringify(expectedOutcomes)) {
      throw new Error(`Expected Telegram's setWebhook outcomes, received ${outcomes}`);
    }

    setWebhook({});
    const deleteOutcomes = [
      updateConsumers.deleteWebhook(BOT_ID, { dropPendingUpdates: false }),
      updateConsumers.deleteWebhook(BOT_ID, { dropPendingUpdates: true }),
    ];
    if (
      JSON.stringify(deleteOutcomes) !==
        JSON.stringify(['webhook_deleted', 'webhook_already_deleted'])
    ) {
      throw new Error(`Expected deleteWebhook to delete once, received ${deleteOutcomes}`);
    }

    // A URL without a scheme is an HTTPS URL, and is reported as the bot specified it.
    setWebhook({ url: 'bot.example/webhook' });
    if (updateConsumers.getWebhookInfo(BOT_ID).url !== 'bot.example/webhook') {
      throw new Error('Expected a URL without a scheme to be accepted and reported unchanged');
    }
  } finally {
    endSession();
  }
});

Deno.test('Webhook delivery rejects invalid URLs and secret tokens without changing the webhook', () => {
  const { updateConsumers, endSession } = createWebhookFixture(() => new Response(null));

  try {
    updateConsumers.setWebhook(BOT_ID, webhookRequest());
    const rejections = [
      { url: 'https://bot example/webhook' },
      { url: 'ftp://bot.example/webhook' },
      { secretToken: 'a'.repeat(257) },
      { secretToken: 'not allowed!' },
    ].map((request) => {
      const result = updateConsumers.setWebhook(BOT_ID, { ...webhookRequest(), ...request });
      return result.accepted ? result.outcome : result.reason;
    });
    if (
      JSON.stringify(rejections) !==
        JSON.stringify([
          'url_invalid',
          'url_invalid',
          'secret_token_too_long',
          'secret_token_invalid',
        ])
    ) {
      throw new Error(`Expected Telegram's setWebhook rejections, received ${rejections}`);
    }
    if (updateConsumers.getWebhookInfo(BOT_ID).url !== WEBHOOK_URL) {
      throw new Error('Expected a rejected request to keep the current webhook');
    }

    const longestSecretToken = updateConsumers.setWebhook(BOT_ID, {
      ...webhookRequest(),
      secretToken: 'a'.repeat(256),
    });
    if (!longestSecretToken.accepted) {
      throw new Error('Expected a secret token of 256 characters to be accepted');
    }
  } finally {
    endSession();
  }
});

Deno.test('Webhook delivery posts pending updates in order and confirms accepted ones', async () => {
  const { botUpdates, updateConsumers, receivedRequests, waitForRequestCount, endSession } =
    createWebhookFixture(
      () => new Response('ignored body'),
    );

  try {
    botUpdates.enqueueMessageUpdate(BOT_ID, createPrivateMessage(1));
    botUpdates.enqueueMessageUpdate(BOT_ID, createPrivateMessage(2));
    updateConsumers.setWebhook(BOT_ID, {
      ...webhookRequest(),
      url: 'https://user:pass@bot.example/webhook?token=1',
      secretToken: 'secret_1',
    });
    await waitForRequestCount(2);
    botUpdates.enqueueMessageUpdate(BOT_ID, createPrivateMessage(3));
    await waitForRequestCount(3);

    if (
      JSON.stringify(receivedRequests.map(({ body }) => body.update_id)) !==
        JSON.stringify([1, 2, 3])
    ) {
      throw new Error('Expected each pending update to be posted once, in order');
    }
    const [firstRequest] = receivedRequests;
    if (
      firstRequest.method !== 'POST' ||
      firstRequest.url !== 'https://bot.example/webhook?token=1' ||
      firstRequest.headers.get('Content-Type') !== 'application/json' ||
      firstRequest.headers.get('X-Telegram-Bot-Api-Secret-Token') !== 'secret_1' ||
      firstRequest.headers.get('Authorization') !== `Basic ${btoa('user:pass')}` ||
      firstRequest.redirect !== 'manual'
    ) {
      throw new Error('Expected a JSON POST with the secret token and URL credentials as headers');
    }
    // Only the update in flight is still pending.
    if (updateConsumers.getWebhookInfo(BOT_ID).pending_update_count !== 1) {
      throw new Error('Expected accepted updates to be confirmed');
    }
  } finally {
    endSession();
  }
});

Deno.test('Webhook delivery retries a failed update and reports the latest failure', async () => {
  const { botUpdates, updateConsumers, receivedRequests, waitForRequestCount, endSession } =
    createWebhookFixture(
      (_request, requestIndex) =>
        requestIndex === 0
          ? new Response(null, { status: 500, statusText: 'Internal Server Error' })
          : new Response(null),
    );

  try {
    botUpdates.enqueueMessageUpdate(BOT_ID, createPrivateMessage(1));
    updateConsumers.setWebhook(BOT_ID, webhookRequest());
    await waitForRequestCount(2);
    botUpdates.enqueueMessageUpdate(BOT_ID, createPrivateMessage(2));
    await waitForRequestCount(3);

    if (
      JSON.stringify(receivedRequests.map(({ body }) => body.update_id)) !==
        JSON.stringify([1, 1, 2])
    ) {
      throw new Error('Expected a failed update to be sent again at once, before later ones');
    }
    const webhookInfo = updateConsumers.getWebhookInfo(BOT_ID);
    if (
      webhookInfo.last_error_date !== NOW_UNIX_SECONDS ||
      webhookInfo.last_error_message !==
        'Wrong response from the webhook: 500 Internal Server Error'
    ) {
      throw new Error('Expected the failure to be reported after later successes');
    }

    updateConsumers.setWebhook(BOT_ID, { ...webhookRequest(), url: `${WEBHOOK_URL}/new` });
    if ('last_error_message' in updateConsumers.getWebhookInfo(BOT_ID)) {
      throw new Error('Expected a new webhook to forget the failure of the previous one');
    }
  } finally {
    endSession();
  }
});

Deno.test('Webhook delivery records each attempt as a delivery, a failure as such, and the acceptance as a confirmation', async () => {
  const { botUpdates, botActivity, updateConsumers, waitForRequestCount, endSession } =
    createWebhookFixture(
      (_request, requestIndex) =>
        requestIndex === 0
          ? new Response(null, { status: 500, statusText: 'Internal Server Error' })
          : new Response(null),
    );

  try {
    botUpdates.enqueueMessageUpdate(BOT_ID, createPrivateMessage(1));
    updateConsumers.setWebhook(BOT_ID, webhookRequest());
    await waitForRequestCount(2);
    await waitUntil(() => updateConsumers.getWebhookInfo(BOT_ID).pending_update_count === 0);

    const recorded = await botActivity.readEntries({
      after: 0,
      filter: {},
      limit: 100,
      waitMilliseconds: 0,
    });
    const summary = recorded.read
      ? recorded.entries.map((entry) => [
        entry.kind,
        entry.botId,
        entry.chatId,
        entry.kind === 'bot_api_call' ? undefined : entry.webhookAttemptId,
      ])
      : [];
    if (
      JSON.stringify(summary) !== JSON.stringify([
        ['update_delivered', BOT_ID, ADA_ID, 1],
        ['webhook_attempt_failed', BOT_ID, ADA_ID, 1],
        ['update_delivered', BOT_ID, ADA_ID, 2],
        ['update_confirmed', BOT_ID, ADA_ID, 2],
      ])
    ) {
      throw new Error(
        `Expected two attempts, the first one's failure, and the second one's confirmation, received ${
          JSON.stringify(summary)
        }`,
      );
    }
    const [, failure] = recorded.read ? recorded.entries : [];
    if (
      failure?.kind !== 'webhook_attempt_failed' ||
      JSON.stringify(failure.failure) !== JSON.stringify({
          reason: 'http_error',
          statusCode: 500,
          errorMessage: 'Wrong response from the webhook: 500 Internal Server Error',
        }) ||
      failure.retryDelaySeconds !== 0 || failure.updateId !== 1
    ) {
      throw new Error(`Expected the failure and its immediate retry, received ${failure}`);
    }
  } finally {
    endSession();
  }
});

Deno.test('Webhook delivery keeps delivering other chats while one chat keeps failing', async () => {
  // Update 1 always fails, and its retry waits until delivery ends.
  let receivedRequests: readonly ReceivedWebhookRequest[] = [];
  const fixture = createWebhookFixture(
    (_request, requestIndex) =>
      receivedRequests[requestIndex].body.update_id === 1
        ? new Response(null, { status: 500, statusText: 'Internal Server Error' })
        : new Response(null),
    { waitBeforeRetry: (_delaySeconds, signal) => waitForAbort(signal) },
  );
  const { botUpdates, updateConsumers, waitForRequestCount, endSession } = fixture;
  receivedRequests = fixture.receivedRequests;

  try {
    botUpdates.enqueueMessageUpdate(BOT_ID, createPrivateMessage(1, ADA_ID));
    botUpdates.enqueueMessageUpdate(BOT_ID, createPrivateMessage(2, ADA_ID));
    botUpdates.enqueueMessageUpdate(BOT_ID, createPrivateMessage(3, GRACE_ID));
    updateConsumers.setWebhook(BOT_ID, webhookRequest());
    await waitForRequestCount(2);
    botUpdates.enqueueMessageUpdate(BOT_ID, createPrivateMessage(4, GRACE_ID));
    await waitForRequestCount(3);
    await waitUntil(() => updateConsumers.getWebhookInfo(BOT_ID).pending_update_count === 2);

    // Ada's update 2 waits behind her failing update 1, while Grace's updates are delivered.
    const sentUpdateIds = receivedRequests.map(({ body }) => body.update_id);
    if (JSON.stringify(sentUpdateIds.toSorted()) !== JSON.stringify([1, 3, 4])) {
      throw new Error(
        `Expected only Ada's chat to wait for its failing update, received ${sentUpdateIds}`,
      );
    }
  } finally {
    endSession();
  }
});

Deno.test('Webhook delivery sends at most max_connections updates at once, one per chat', async () => {
  const responses: Array<(response: Response) => void> = [];
  const { botUpdates, updateConsumers, receivedRequests, waitForRequestCount, endSession } =
    createWebhookFixture(
      () => new Promise<Response>((resolve) => responses.push(resolve)),
    );

  try {
    botUpdates.enqueueMessageUpdate(BOT_ID, createPrivateMessage(1, ADA_ID));
    botUpdates.enqueueMessageUpdate(BOT_ID, createPrivateMessage(2, GRACE_ID));
    botUpdates.enqueueMessageUpdate(BOT_ID, createPrivateMessage(3, LINUS_ID));
    botUpdates.enqueueMessageUpdate(BOT_ID, createPrivateMessage(4, ADA_ID));
    updateConsumers.setWebhook(BOT_ID, { ...webhookRequest(), maxConnections: 2 });
    await waitForRequestCount(2);
    await new Promise((resolve) => setTimeout(resolve, 10));
    const inFlightAtFirst = receivedRequests.map(({ body }) => body.update_id);

    // Ada's first update frees a connection for Linus, and Ada's next update waits its turn.
    responses[0](new Response(null));
    await waitForRequestCount(3);
    responses[1](new Response(null));
    await waitForRequestCount(4);
    const sentUpdateIds = receivedRequests.map(({ body }) => body.update_id);
    if (
      JSON.stringify(inFlightAtFirst) !== JSON.stringify([1, 2]) ||
      JSON.stringify(sentUpdateIds) !== JSON.stringify([1, 2, 3, 4])
    ) {
      throw new Error(
        `Expected two connections shared by chats in turn, received ${
          JSON.stringify({ inFlightAtFirst, sentUpdateIds })
        }`,
      );
    }
  } finally {
    endSession();
  }
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
  const { botUpdates, updateConsumers, waitForRequestCount, endSession } = createWebhookFixture(
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
      waitBeforeRetry: (delaySeconds) => {
        requestedDelaysSeconds.push(delaySeconds);
        return Promise.resolve();
      },
    },
  );

  try {
    botUpdates.enqueueMessageUpdate(BOT_ID, createPrivateMessage(1));
    updateConsumers.setWebhook(BOT_ID, webhookRequest());
    await waitForRequestCount(failedResponseRetryAfters.length + 1);
    await waitUntil(() => updateConsumers.getWebhookInfo(BOT_ID).pending_update_count === 0);

    // A requested wait, capped at an hour, replaces the backoff delay without doubling it.
    if (JSON.stringify(requestedDelaysSeconds) !== JSON.stringify([0, 5, 2, 3600, 4, 8, 16])) {
      throw new Error(
        `Expected Retry-After to set the waits it asks for, received ${
          JSON.stringify(requestedDelaysSeconds)
        }`,
      );
    }
  } finally {
    endSession();
  }
});

Deno.test('Webhook delivery reports a webhook it cannot connect to', async () => {
  const { botUpdates, updateConsumers, receivedRequests, waitForRequestCount, endSession } =
    createWebhookFixture(
      () => {
        throw new TypeError('fetch failed');
      },
    );

  try {
    botUpdates.enqueueMessageUpdate(BOT_ID, createPrivateMessage(1));
    updateConsumers.setWebhook(BOT_ID, webhookRequest());
    // The first failure is retried at once; the second waits 2 seconds.
    await waitForRequestCount(2);

    if (receivedRequests.some(({ body }) => body.update_id !== 1)) {
      throw new Error('Expected the failed update to be sent again');
    }
    const webhookInfo = updateConsumers.getWebhookInfo(BOT_ID);
    if (
      webhookInfo.last_error_message !== "Can't connect to the webhook" ||
      webhookInfo.pending_update_count !== 1
    ) {
      throw new Error("Expected Telegram's connection failure and the update to stay pending");
    }
  } finally {
    endSession();
  }
});

Deno.test('Webhook delivery fails an attempt that outlasts its timeout and retries the update', async () => {
  const {
    botUpdates,
    updateConsumers,
    receivedRequests,
    receivedSignals,
    waitForRequestCount,
    endSession,
  } = createWebhookFixture(
    // The first request ignores its abort, as a sender might; the second hangs until aborted.
    (request, requestIndex) =>
      requestIndex === 0 ? new Promise<Response>(() => {}) : respondOnlyByAborting(request),
    { attemptTimeoutMilliseconds: 20 },
  );

  try {
    botUpdates.enqueueMessageUpdate(BOT_ID, createPrivateMessage(1));
    botUpdates.enqueueMessageUpdate(BOT_ID, createPrivateMessage(2));
    updateConsumers.setWebhook(BOT_ID, webhookRequest());
    // The first failure is retried at once; the second waits 2 seconds.
    await waitForRequestCount(2);
    await new Promise((resolve) => setTimeout(resolve, 40));

    const webhookInfo = updateConsumers.getWebhookInfo(BOT_ID);
    if (
      JSON.stringify(receivedRequests.map(({ body }) => body.update_id)) !==
        JSON.stringify([1, 1]) ||
      !receivedSignals.every((signal) => signal.aborted) ||
      webhookInfo.last_error_message !== 'Read timeout expired' ||
      webhookInfo.pending_update_count !== 2
    ) {
      throw new Error(
        `Expected timed-out attempts to be aborted and retried, received ${
          JSON.stringify({ receivedRequests, webhookInfo })
        }`,
      );
    }
  } finally {
    endSession();
  }
});

Deno.test('Webhook delivery runs the reply of an accepted update only', async () => {
  const replyBody = JSON.stringify({ method: 'sendMessage', chat_id: 1, text: 'Hi' });
  const { botUpdates, updateConsumers, receivedReplies, waitForRequestCount, endSession } =
    createWebhookFixture(
      (_request, requestIndex) =>
        requestIndex === 0
          ? new Response(replyBody, { status: 500, statusText: 'Internal Server Error' })
          : new Response(replyBody, { headers: { 'Content-Type': 'application/json' } }),
    );

  try {
    botUpdates.enqueueMessageUpdate(BOT_ID, createPrivateMessage(1));
    updateConsumers.setWebhook(BOT_ID, webhookRequest());
    await waitForRequestCount(2);
    await waitUntil(() => receivedReplies.length > 0);

    if (JSON.stringify(receivedReplies) !== JSON.stringify([{ botId: BOT_ID, body: replyBody }])) {
      throw new Error(
        `Expected only the accepted update's reply to run, received ${
          JSON.stringify(receivedReplies)
        }`,
      );
    }
  } finally {
    endSession();
  }
});

Deno.test('Webhook delivery confirms an accepted update whose reply never finishes', async () => {
  const { botUpdates, updateConsumers, receivedRequests, waitForRequestCount, endSession } =
    createWebhookFixture(
      () =>
        new Response('{"method":"sendMessage"}', {
          headers: { 'Content-Type': 'application/json' },
        }),
      // The reply's method is started and left running; nothing waits for it.
      { startWebhookReply: () => {} },
    );

  try {
    botUpdates.enqueueMessageUpdate(BOT_ID, createPrivateMessage(1));
    botUpdates.enqueueMessageUpdate(BOT_ID, createPrivateMessage(2));
    updateConsumers.setWebhook(BOT_ID, webhookRequest());
    await waitForRequestCount(2);
    await waitUntil(() => updateConsumers.getWebhookInfo(BOT_ID).pending_update_count === 0);

    const webhookInfo = updateConsumers.getWebhookInfo(BOT_ID);
    if (
      JSON.stringify(receivedRequests.map(({ body }) => body.update_id)) !==
        JSON.stringify([1, 2]) ||
      'last_error_message' in webhookInfo
    ) {
      throw new Error('Expected a running reply to leave its update delivered without an error');
    }
  } finally {
    endSession();
  }
});

Deno.test('Webhook delivery retries an accepted update whose response is cut short', async () => {
  const replyBody = '{"method":"sendMessage","chat_id":1,"text":"Hi"}';
  const {
    botUpdates,
    updateConsumers,
    receivedRequests,
    receivedReplies,
    waitForRequestCount,
    endSession,
  } = createWebhookFixture(
    (_request, requestIndex) =>
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
      ),
  );

  try {
    botUpdates.enqueueMessageUpdate(BOT_ID, createPrivateMessage(1));
    updateConsumers.setWebhook(BOT_ID, webhookRequest());
    await waitForRequestCount(2);
    await waitUntil(() => updateConsumers.getWebhookInfo(BOT_ID).pending_update_count === 0);

    if (
      JSON.stringify(receivedRequests.map(({ body }) => body.update_id)) !==
        JSON.stringify([1, 1]) ||
      JSON.stringify(receivedReplies) !== JSON.stringify([{ botId: BOT_ID, body: replyBody }])
    ) {
      throw new Error('Expected an incomplete response to leave its update pending, unreplied');
    }
    if ('last_error_message' in updateConsumers.getWebhookInfo(BOT_ID)) {
      throw new Error('Expected a closed connection to be retried without a reported error');
    }
  } finally {
    endSession();
  }
});

Deno.test('Webhook delivery fails an accepted update whose response body outlasts its timeout', async () => {
  const { botUpdates, updateConsumers, receivedReplies, waitForRequestCount, endSession } =
    createWebhookFixture(
      (_request, requestIndex) =>
        requestIndex === 0
          ? new Response(
            new ReadableStream<Uint8Array>({
              start(controller) {
                controller.enqueue(new TextEncoder().encode('{"method":'));
              },
            }),
            { headers: { 'Content-Type': 'application/json' } },
          )
          : new Response(null),
      { attemptTimeoutMilliseconds: 20 },
    );

  try {
    botUpdates.enqueueMessageUpdate(BOT_ID, createPrivateMessage(1));
    updateConsumers.setWebhook(BOT_ID, webhookRequest());
    await waitForRequestCount(2);
    await waitUntil(() => updateConsumers.getWebhookInfo(BOT_ID).pending_update_count === 0);

    const webhookInfo = updateConsumers.getWebhookInfo(BOT_ID);
    if (
      webhookInfo.last_error_message !== 'Read timeout expired' ||
      JSON.stringify(receivedReplies) !== JSON.stringify([{ botId: BOT_ID, body: '' }])
    ) {
      throw new Error(
        `Expected a stalled response body to time out and be retried, received ${
          JSON.stringify({ webhookInfo, receivedReplies })
        }`,
      );
    }
  } finally {
    endSession();
  }
});

Deno.test('Webhook delivery ends delivery and keeps the update in flight pending', async () => {
  const { botUpdates, updateConsumers, receivedRequests, waitForRequestCount, endSession } =
    createWebhookFixture(
      respondOnlyByAborting,
    );

  botUpdates.enqueueMessageUpdate(BOT_ID, createPrivateMessage(1));
  updateConsumers.setWebhook(BOT_ID, webhookRequest());
  await waitForRequestCount(1);
  endSession();
  updateConsumers.setWebhook(BOT_ID, { ...webhookRequest(), url: `${WEBHOOK_URL}/new` });
  botUpdates.enqueueMessageUpdate(BOT_ID, createPrivateMessage(2));
  await new Promise((resolve) => setTimeout(resolve, 10));

  if (receivedRequests.length !== 1) {
    throw new Error('Expected no delivery after delivery ended');
  }
  const webhookInfo = updateConsumers.getWebhookInfo(BOT_ID);
  if (webhookInfo.pending_update_count !== 2 || 'last_error_message' in webhookInfo) {
    throw new Error('Expected the interrupted update to stay pending without a failure');
  }
});

Deno.test('Webhook delivery reports getWebhookInfo fields in Telegram order', () => {
  const { botUpdates, updateConsumers, endSession } = createWebhookFixture(respondOnlyByAborting);

  try {
    if (
      JSON.stringify(updateConsumers.getWebhookInfo(BOT_ID)) !==
        JSON.stringify({ url: '', has_custom_certificate: false, pending_update_count: 0 })
    ) {
      throw new Error('Expected only the URL, certificate, and pending count without a webhook');
    }

    botUpdates.enqueueMessageUpdate(BOT_ID, createPrivateMessage(1));
    botUpdates.enqueueMessageUpdate(BOT_ID, createPrivateMessage(2));
    updateConsumers.setWebhook(BOT_ID, {
      ...webhookRequest(),
      allowedUpdates: ['CALLBACK_QUERY', 'message', 'custom_event'],
    });
    const expectedInfo = {
      url: WEBHOOK_URL,
      has_custom_certificate: false,
      pending_update_count: 2,
      max_connections: 40,
      allowed_updates: ['message', 'callback_query'],
    };
    if (JSON.stringify(updateConsumers.getWebhookInfo(BOT_ID)) !== JSON.stringify(expectedInfo)) {
      throw new Error('Expected the webhook, its pending updates, and the listed subscription');
    }

    // A request that changes no webhook still changes the subscription.
    const unchanged = updateConsumers.setWebhook(BOT_ID, {
      ...webhookRequest(),
      allowedUpdates: ['message'],
    });
    const dropping = updateConsumers.setWebhook(BOT_ID, {
      ...webhookRequest(),
      dropPendingUpdates: true,
    });
    const webhookInfo = updateConsumers.getWebhookInfo(BOT_ID);
    if (
      !unchanged.accepted || unchanged.outcome !== 'webhook_already_set' ||
      !dropping.accepted || dropping.outcome !== 'webhook_set' ||
      JSON.stringify(webhookInfo.allowed_updates) !== JSON.stringify(['message']) ||
      webhookInfo.pending_update_count !== 0
    ) {
      throw new Error('Expected allowed updates to apply and dropped updates to be discarded');
    }
  } finally {
    endSession();
  }
});

interface ReceivedWebhookRequest {
  readonly method: string;
  readonly url: string;
  readonly headers: Headers;
  readonly redirect: RequestRedirect;
  readonly body: { readonly update_id: number };
}

/**
 * Creates a webhook service whose requests `respond` answers in place of the network, and which
 * records each request it receives.
 */
function createWebhookFixture(
  respond: (request: Request, requestIndex: number) => Response | Promise<Response>,
  options: {
    readonly attemptTimeoutMilliseconds?: number;
    /** Waits for real when omitted. */
    readonly waitBeforeRetry?: (delaySeconds: number, signal: AbortSignal) => Promise<void>;
    /** Records each reply's body when omitted. */
    readonly startWebhookReply?: (botId: number, reply: Response) => void;
  } = {},
) {
  const receivedReplies: Array<{ readonly botId: number; readonly body: string }> = [];
  const startWebhookReply = options.startWebhookReply ?? ((botId: number, reply: Response) => {
    void reply.text().then((body) => receivedReplies.push({ botId, body }));
  });
  const botUpdates = new BotUpdateRepository();
  const receivedRequests: ReceivedWebhookRequest[] = [];
  const receivedSignals: AbortSignal[] = [];
  const requestCounter = new ReceivedRequestCounter();
  const botActivity = new BotActivityService({
    log: new BotActivityLogRepository(),
    scheduler: createRealTimeScheduler(),
  });
  const { updateConsumers, endSession } = createUpdateConsumers({
    botUpdates,
    updateActivity: botActivity,
    sendWebhookRequest: async (request) => {
      receivedSignals.push(request.signal);
      const { method, url, headers, redirect } = request;
      receivedRequests.push({ method, url, headers, redirect, body: await request.json() });
      requestCounter.countRequest();
      return await respond(request, receivedRequests.length - 1);
    },
    startWebhookReply,
    attempts: new WebhookAttemptScheduler({
      // These tests control no attempt, so they need no bot.
      bots: { getById: () => undefined },
      attemptTimeoutMilliseconds: options.attemptTimeoutMilliseconds ??
        WEBHOOK_ATTEMPT_TIMEOUT_MILLISECONDS,
      scheduler: createRetryScheduler(options.waitBeforeRetry),
    }),
  });

  return {
    botUpdates,
    botActivity,
    updateConsumers,
    endSession,
    receivedRequests,
    receivedSignals,
    receivedReplies,
    /** Resolves once the webhook has received `count` requests, failing after a second. */
    waitForRequestCount: (count: number) => requestCounter.waitForCount(count),
  };
}
