import { createEmulationApi } from '../../src/api/mod.ts';
import { createSessionLifecycleService } from '../../src/composition/session_lifecycle.ts';
import { EmulationClientError, TelegramEmulationClient } from './mod.ts';

const PUBLIC_ORIGIN = 'http://emulator.example:9000';

Deno.test('A local webhook that fails twice recovers through the webhook delivery controls', async () => {
  const { api, client } = createInProcessClient();
  const session = await client.createSession();
  // The webhook asks for an hour's wait after its first failure, and never answers its second
  // request, so the update is delivered in time only through the controls.
  const webhook = startLocalWebhook((requestIndex) =>
    requestIndex === 0
      ? new Response(null, {
        status: 503,
        statusText: 'Service Unavailable',
        headers: { 'Retry-After': '3600' },
      })
      : requestIndex === 1
      ? 'hang'
      : new Response(null)
  );

  try {
    const { token, bot } = await session.createBot({ first_name: 'Hook', username: 'hook_bot' });
    const { account } = await session.createAccount({ first_name: 'Ada' });
    const activity = session.botActivity({ bot_id: bot.id });
    const callBotApi = async (method: string, parameters: Record<string, unknown> = {}) =>
      await (await api.request(`/sessions/${session.id}/bot-api/bot${token}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parameters),
      })).json();

    assertJson(
      [
        await session.getWebhookDelivery(bot.id),
        await session.setWebhookDelivery({ bot_id: bot.id, scheduling: 'manual' }),
      ],
      [{ scheduling: 'automatic' }, { scheduling: 'manual' }],
      'Expected automatic scheduling by default, and manual scheduling once chosen',
    );
    await callBotApi('setWebhook', { url: webhook.url });
    const start = await activity.position();
    await account.sendMessage({ to: { type: 'private', botId: bot.id }, text: 'Hello' });

    const firstFailure = await activity.waitFor({ kind: 'webhook_attempt_failed' }, {
      after: start,
    });
    assertJson(
      [firstFailure.failure, firstFailure.retry_delay_seconds],
      [{
        reason: 'http_error',
        status_code: 503,
        error_message: 'Wrong response from the webhook: 503 Service Unavailable',
      }, 3600],
      'Expected the failed response and the wait it asked for',
    );
    const released = await session.releaseWebhookRetry({
      botId: bot.id,
      attemptId: firstFailure.webhook_attempt_id,
    });

    const secondDelivery = await activity.waitFor({ kind: 'update_delivered' }, {
      after: firstFailure,
    });
    await webhook.waitForRequestCount(2);
    const secondAttemptId = secondDelivery.webhook_attempt_id ?? 0;
    const expired = await session.expireWebhookAttempt({
      botId: bot.id,
      attemptId: secondAttemptId,
    });
    await session.releaseWebhookRetry({ botId: bot.id, attemptId: secondAttemptId });

    const confirmed = await activity.waitFor({ kind: 'update_confirmed' }, {
      after: secondDelivery,
    });
    const webhookInfo = await callBotApi('getWebhookInfo');
    assertJson(
      [
        released.status === 'failed' && released.retry,
        expired,
        confirmed.update_id === firstFailure.update_id && confirmed.webhook_attempt_id,
        (await session.getWebhookAttempts(bot.id)).map((attempt) =>
          attempt.status === 'failed'
            ? [attempt.id, attempt.failure.reason, attempt.retry.status]
            : [attempt.id, attempt.status]
        ),
        [webhookInfo.result.pending_update_count, webhookInfo.result.last_error_message],
        webhook.receivedRequestCount(),
        webhook.abortedRequestCount(),
      ],
      [
        { delay_seconds: 3600, status: 'released' },
        {
          id: secondAttemptId,
          update_id: firstFailure.update_id,
          scheduling: 'manual',
          status: 'failed',
          failure: { reason: 'timed_out', error_message: 'Read timeout expired' },
          // A Retry-After wait leaves the backoff as it was, so the second failure waits 2 seconds.
          retry: { delay_seconds: 2, status: 'waiting' },
        },
        3,
        [[1, 'http_error', 'released'], [2, 'timed_out', 'released'], [3, 'accepted']],
        [0, 'Read timeout expired'],
        3,
        1,
      ],
      'Expected the update to recover on its third attempt, each attempt inspectable',
    );
  } finally {
    await session.end();
    await webhook.close();
  }
});

Deno.test('Webhook delivery controls reject what they cannot apply to', async () => {
  const { api, client } = createInProcessClient();
  const session = await client.createSession();
  const otherSession = await client.createSession();
  const webhook = startLocalWebhook(() => new Response(null, { status: 500 }));

  try {
    const { token, bot } = await session.createBot({ first_name: 'Hook', username: 'hook_bot' });
    const { bot: otherBot } = await session.createBot({
      first_name: 'Other',
      username: 'other_bot',
    });
    const { bot: otherSessionBot } = await otherSession.createBot({
      first_name: 'Hook',
      username: 'hook_bot',
    });
    const { account } = await session.createAccount({ first_name: 'Ada' });
    const activity = session.botActivity({ bot_id: bot.id });
    await session.setWebhookDelivery({ bot_id: bot.id, scheduling: 'manual' });
    await api.request(
      `/sessions/${session.id}/bot-api/bot${token}/setWebhook?url=${
        encodeURIComponent(webhook.url)
      }`,
    );
    await account.sendMessage({ to: { type: 'private', botId: bot.id }, text: 'Hello' });
    const failure = await activity.waitFor({ kind: 'webhook_attempt_failed' }, { after: 0 });
    const attemptId = failure.webhook_attempt_id;

    const statuses = [
      // The attempt failed, so it is no longer in flight.
      await failedStatus(session.expireWebhookAttempt({ botId: bot.id, attemptId })),
      // Another bot's controls, and another session's, find no such attempt.
      await failedStatus(session.releaseWebhookRetry({ botId: otherBot.id, attemptId })),
      await failedStatus(session.expireWebhookAttempt({ botId: otherBot.id, attemptId })),
      await failedStatus(
        otherSession.releaseWebhookRetry({ botId: otherSessionBot.id, attemptId }),
      ),
      await failedStatus(session.releaseWebhookRetry({ botId: bot.id, attemptId: attemptId + 1 })),
      await failedStatus(session.getWebhookAttempts(bot.id + otherBot.id)),
      await failedStatus(session.getWebhookDelivery(bot.id + otherBot.id)),
    ];
    assertJson(statuses, [409, 404, 404, 404, 404, 404, 404], 'Expected each control refused');
    assertJson(
      [
        await otherSession.getWebhookAttempts(otherSessionBot.id),
        (await otherSession.getWebhookDelivery(otherSessionBot.id)).scheduling,
      ],
      [[], 'automatic'],
      "Expected another session's bot to have no attempts and its own scheduling",
    );

    const request = (method: string, path: string, body?: string) =>
      api.request(`/sessions/${session.id}/bots/${path}`, {
        method,
        ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body }),
      });
    const httpStatuses = [
      (await request('PUT', `${bot.id}/webhook-delivery`, '{"scheduling":"paused"}')).status,
      (await request('PUT', `${bot.id}/webhook-delivery`, '{"scheduling":"manual","x":1}')).status,
      (await request('PUT', `${bot.id}/webhook-delivery`, '')).status,
      (await request('POST', `${bot.id}/webhook-attempts/0/retry-release`)).status,
      (await request('POST', `${bot.id}/webhook-attempts/one/expiry`)).status,
      (await request('POST', `${bot.id}/webhook-attempts/${attemptId}/retry-release`)).status,
      (await request('POST', `${bot.id}/webhook-attempts/${attemptId}/retry-release`)).status,
    ];
    assertJson(
      httpStatuses,
      [400, 400, 400, 404, 404, 200, 409],
      'Expected malformed requests refused, and a retry released once',
    );
  } finally {
    await session.end();
    await otherSession.end();
    await webhook.close();
  }
});

Deno.test('Ending a session cancels its manual webhook attempts and retries', async () => {
  const { api, client } = createInProcessClient();
  const session = await client.createSession();
  const webhook = startLocalWebhook(() => 'hang');

  try {
    const { token, bot } = await session.createBot({ first_name: 'Hook', username: 'hook_bot' });
    const { account } = await session.createAccount({ first_name: 'Ada' });
    await session.setWebhookDelivery({ bot_id: bot.id, scheduling: 'manual' });
    await api.request(
      `/sessions/${session.id}/bot-api/bot${token}/setWebhook?url=${
        encodeURIComponent(webhook.url)
      }`,
    );
    await account.sendMessage({ to: { type: 'private', botId: bot.id }, text: 'Hello' });
    await webhook.waitForRequestCount(1);
    const [attempt] = await session.getWebhookAttempts(bot.id);

    await session.end();
    await webhook.waitForAbortedRequestCount(1);
    assertJson(
      [attempt.status, await failedStatus(session.getWebhookAttempts(bot.id))],
      ['in_flight', 404],
      'Expected the ended session to abort its attempt in flight and keep no controls',
    );
  } finally {
    await webhook.close();
  }
});

function createInProcessClient() {
  const api = createEmulationApi({
    sessionLifecycle: createSessionLifecycleService(),
    publicOrigin: PUBLIC_ORIGIN,
  });
  const client = new TelegramEmulationClient(PUBLIC_ORIGIN, {
    fetch: async (input, init) => await api.fetch(new Request(input, init)),
  });
  return { api, client };
}

/**
 * Serves a webhook on a local port, answering each request as `respond` says. A request answered
 * with `'hang'` gets no answer until the emulator aborts it, or the webhook closes.
 */
function startLocalWebhook(respond: (requestIndex: number) => Response | 'hang') {
  let receivedRequestCount = 0;
  let abortedRequestCount = 0;
  const listeners = new Set<() => void>();
  const closing = Promise.withResolvers<void>();
  const notify = () => {
    for (const listener of listeners) listener();
  };
  const server = Deno.serve(
    { hostname: '127.0.0.1', port: 0, onListen: () => {} },
    async (request) => {
      await request.arrayBuffer();
      const answer = respond(receivedRequestCount++);
      notify();
      if (answer !== 'hang') {
        return answer;
      }
      const aborted = Promise.withResolvers<void>();
      request.signal.addEventListener('abort', () => aborted.resolve(), { once: true });
      await Promise.race([aborted.promise, closing.promise]);
      if (request.signal.aborted) {
        abortedRequestCount++;
        notify();
      }
      return new Response(null, { status: 504 });
    },
  );
  const waitFor = (condition: () => boolean, description: string): Promise<void> => {
    const { promise, resolve, reject } = Promise.withResolvers<void>();
    const check = () => {
      if (condition()) {
        listeners.delete(check);
        resolve();
      }
    };
    listeners.add(check);
    check();
    const timeoutId = setTimeout(() => reject(new Error(`Expected ${description}`)), 5_000);
    return promise.finally(() => {
      clearTimeout(timeoutId);
      listeners.delete(check);
    });
  };
  return {
    url: `http://127.0.0.1:${server.addr.port}/webhook`,
    receivedRequestCount: () => receivedRequestCount,
    abortedRequestCount: () => abortedRequestCount,
    waitForRequestCount: (count: number) =>
      waitFor(() => receivedRequestCount >= count, `${count} webhook requests`),
    waitForAbortedRequestCount: (count: number) =>
      waitFor(() => abortedRequestCount >= count, `${count} aborted webhook requests`),
    close: async () => {
      closing.resolve();
      await server.shutdown();
    },
  };
}

/** The HTTP status a client call failed with; fails when the call succeeds. */
async function failedStatus(call: Promise<unknown>): Promise<number | undefined> {
  try {
    await call;
  } catch (error) {
    if (error instanceof EmulationClientError) {
      return error.status;
    }
    throw error;
  }
  throw new Error('Expected the client call to fail');
}

function assertJson(actual: unknown, expected: unknown, message: string): void {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  if (actualJson !== expectedJson) {
    throw new Error(`${message}\nExpected: ${expectedJson}\nReceived: ${actualJson}`);
  }
}
