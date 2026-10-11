/**
 * Action receipts: every successful control action answers with its session and the head of the
 * session's bot activity log before the action, so that reading the log after the receipt finds
 * everything the action caused, however soon a bot reacts.
 */
import { assert, assertEquals, assertGreater, assertLessOrEqual } from '@std/assert';

import { callBotApi } from '../support/bot_api_requests.ts';
import { type EmulationApi, jsonRequest, requestJson } from '../support/emulation_api.ts';
import {
  createAccount,
  createBot,
  createPrivateConversationFixture,
} from '../support/http_fixtures.ts';

/** A receipt as its headers carry it. */
interface ActionReceipt {
  readonly sessionId: string;
  readonly activityPosition: number;
}

/** An entry of a bot activity read, with the fields these tests look at. */
interface ActivityEntry {
  readonly position: number;
  readonly kind: string;
  readonly method?: string;
  readonly user_id?: number;
  readonly chat_id?: number;
  readonly webhook_attempt_id?: number;
}

/** The receipt a response carries, or `undefined` when it carries neither of its headers. */
function readReceipt(response: Response): ActionReceipt | undefined {
  const sessionId = response.headers.get('Action-Receipt-Session-Id');
  const activityPosition = response.headers.get('Action-Receipt-Activity-Position');
  if (sessionId === null && activityPosition === null) {
    return undefined;
  }
  assert(sessionId !== null && activityPosition !== null, 'Expected both receipt headers');
  assert(/^(0|[1-9][0-9]*)$/.test(activityPosition), 'Expected a position in decimal digits');
  return { sessionId, activityPosition: Number(activityPosition) };
}

/** Sends a request whose answer must succeed with a receipt, and returns the receipt. */
async function act(
  api: EmulationApi,
  path: string,
  init: RequestInit,
  expectedStatus: number,
): Promise<ActionReceipt> {
  const response = await api.request(path, init);
  await response.body?.cancel();
  assertEquals(response.status, expectedStatus, `Expected ${init.method} ${path} to succeed`);
  const receipt = readReceipt(response);
  assert(receipt !== undefined, `Expected ${init.method} ${path} to answer with a receipt`);
  return receipt;
}

/** Reads the session's bot activity log after `after`, holding for an entry for `waitMs`. */
async function readActivity(
  api: EmulationApi,
  sessionPath: string,
  { after, waitMs = 0, kind }: { after: number; waitMs?: number; kind?: string },
): Promise<{ entries: ActivityEntry[]; head_position: number }> {
  const query = new URLSearchParams({
    after: String(after),
    wait_ms: String(waitMs),
    ...(kind === undefined ? {} : { kind }),
  });
  const { status, body } = await requestJson<{ entries: ActivityEntry[]; head_position: number }>(
    api,
    'GET',
    `${sessionPath}/bot-activity?${query}`,
  );
  assertEquals(status, 200, 'Expected the bot activity log to be read');
  return body;
}

function sessionIdOf(sessionPath: string): string {
  const sessionId = sessionPath.split('/').at(-1);
  assert(sessionId !== undefined, 'Expected a session path');
  return sessionId;
}

/**
 * Plays a polling bot that answers each account's text with `Echo: <text>` as soon as its
 * `getUpdates` hands the message over, until it has answered `replyCount` messages.
 */
async function echoMessages(api: EmulationApi, botApiPath: string, replyCount: number) {
  let offset = 0;
  for (let replied = 0; replied < replyCount;) {
    const { body } = await callBotApi(api, `${botApiPath}/getUpdates`, { offset, timeout: 5 });
    const updates = (body as {
      result: { update_id: number; message?: { chat: { id: number }; text?: string } }[];
    }).result;
    for (const { update_id, message } of updates) {
      offset = update_id + 1;
      if (message?.text === undefined) continue;
      await callBotApi(api, `${botApiPath}/sendMessage`, {
        chat_id: message.chat.id,
        text: `Echo: ${message.text}`,
      });
      replied++;
    }
  }
}

Deno.test('A control action answers with its session and the log head before it', async () => {
  await using fixture = await createPrivateConversationFixture();
  const { api, sessionPath, botApiPath, createdBot, createdAccount } = fixture;
  const accountPath = `${sessionPath}/accounts/${createdAccount.account.id}`;
  await callBotApi(api, `${botApiPath}/getMe`, {});
  await callBotApi(api, `${botApiPath}/getMe`, {});

  const receipts = [
    // A route its contract registers, which answers with JSON.
    await act(
      api,
      `${sessionPath}/bots`,
      jsonRequest('POST', { first_name: 'B', username: 'b_bot' }),
      201,
    ),
    // A route registered by hand, which answers with JSON.
    await act(
      api,
      `${accountPath}/messages`,
      jsonRequest('POST', { to: { type: 'private', botId: createdBot.bot.id }, text: 'Hi' }),
      201,
    ),
    // A route registered by hand, which answers without content.
    await act(api, `${accountPath}/blocked-bots/${createdBot.bot.id}`, { method: 'PUT' }, 204),
  ];

  const sessionId = sessionIdOf(sessionPath);
  assertEquals(
    receipts,
    [0, 1, 2].map(() => ({ sessionId, activityPosition: 2 })),
    'Expected each action to name its session and the head, as no bot acted in between',
  );
});

Deno.test('A refused control action answers without a receipt', async () => {
  await using fixture = await createPrivateConversationFixture();
  const { api, sessionPath, createdBot, createdAccount } = fixture;
  const accountPath = `${sessionPath}/accounts/${createdAccount.account.id}`;
  const refusals = [
    await api.request(`${accountPath}/blocked-bots/999`, { method: 'PUT' }),
    await api.request(`${sessionPath}/accounts/0/blocked-bots/${createdBot.bot.id}`, {
      method: 'PUT',
    }),
    await api.request(
      `${accountPath}/messages`,
      jsonRequest('POST', { to: { type: 'private', botId: createdBot.bot.id }, text: '' }),
    ),
    await api.request(`${sessionPath}/bots`, jsonRequest('POST', { first_name: 'B' })),
    // A route its contract registers, for a supergroup that does not exist.
    await api.request(
      `${accountPath}/conversations/supergroup/-1000000000001/members/${createdBot.bot.id}`,
      { method: 'PUT' },
    ),
  ];

  for (const response of refusals) await response.body?.cancel();
  assertEquals(
    refusals.map((response) => [response.status, readReceipt(response)]),
    [[404, undefined], [400, undefined], [400, undefined], [400, undefined], [404, undefined]],
    'Expected every refusal without a receipt',
  );
});

Deno.test('A control action that changes nothing answers with the head as it is', async () => {
  await using fixture = await createPrivateConversationFixture();
  const { api, sessionPath, botApiPath, createdBot, createdAccount } = fixture;
  const blockPath =
    `${sessionPath}/accounts/${createdAccount.account.id}/blocked-bots/${createdBot.bot.id}`;

  const blockReceipt = await act(api, blockPath, { method: 'PUT' }, 204);
  await callBotApi(api, `${botApiPath}/getMe`, {});
  const repeatedBlockReceipt = await act(api, blockPath, { method: 'PUT' }, 204);

  assertEquals(
    [blockReceipt.activityPosition, repeatedBlockReceipt.activityPosition],
    [0, 1],
    "Expected blocking a blocked bot to answer with the head after the bot's call",
  );
});

Deno.test('Creating a session answers with its receipt, and ending one with none', async () => {
  await using fixture = await createPrivateConversationFixture();
  const { api, sessionPath } = fixture;

  const createResponse = await api.request('/sessions', { method: 'POST' });
  const created = await createResponse.json() as { id: string };
  const endResponse = await api.request(`/sessions/${created.id}`, { method: 'DELETE' });

  assertEquals(
    [readReceipt(createResponse), endResponse.status, readReceipt(endResponse)],
    [{ sessionId: created.id, activityPosition: 0 }, 204, undefined],
    'Expected the new session at position 0, and no receipt for ending it',
  );
  assert(created.id !== sessionIdOf(sessionPath), 'Expected another session');
});

Deno.test('A bot reply sent as soon as an action is delivered follows its receipt', async () => {
  await using fixture = await createPrivateConversationFixture();
  const { api, sessionPath, botApiPath, createdBot, createdAccount } = fixture;
  const accountId = createdAccount.account.id;
  // The bot's poll is held before the action, so the update is handed over the moment the action
  // publishes it, and the bot replies at once.
  const bot = echoMessages(api, botApiPath, 1);

  const receipt = await act(
    api,
    `${sessionPath}/accounts/${accountId}/messages`,
    jsonRequest('POST', { to: { type: 'private', botId: createdBot.bot.id }, text: 'Ping' }),
    201,
  );
  await bot;
  const { entries } = await readActivity(api, sessionPath, { after: receipt.activityPosition });

  assertEquals(
    entries.map(({ kind, method }) => method ?? kind),
    ['update_delivered', 'sendMessage'],
    'Expected the delivery and the reply after the receipt',
  );
  const { entries: allEntries } = await readActivity(api, sessionPath, { after: 0 });
  assertEquals(
    allEntries.filter((entry) => entry.position <= receipt.activityPosition),
    [],
    'Expected nothing the action caused at or before its receipt',
  );
});

Deno.test('An update a contract route hands over at once follows its receipt', async () => {
  await using fixture = await createPrivateConversationFixture();
  const { api, sessionPath, botApiPath, createdBot, createdAccount } = fixture;
  const { body: { supergroup } } = await requestJson<{ supergroup: { id: number } }>(
    api,
    'POST',
    `${sessionPath}/accounts/${createdAccount.account.id}/supergroups`,
    { title: 'Team' },
  );
  const heldPoll = callBotApi(api, `${botApiPath}/getUpdates`, { timeout: 5 });

  const receipt = await act(
    api,
    `${sessionPath}/accounts/${createdAccount.account.id}/conversations/supergroup/${supergroup.id}/members/${createdBot.bot.id}`,
    { method: 'PUT' },
    204,
  );
  await heldPoll;
  const { entries } = await readActivity(api, sessionPath, { after: 0 });

  // The bot learns of its membership and sees the service message of its joining.
  assertEquals(
    entries.map(({ kind, position }) => [kind, position > receipt.activityPosition]),
    [['update_delivered', true], ['update_delivered', true]],
    "Expected the updates of the bot's joining delivered after the receipt",
  );
});

Deno.test('Overlapping actions each precede what they cause, among unrelated activity', async () => {
  await using fixture = await createPrivateConversationFixture();
  const { api, sessionPath, botApiPath, createdBot, createdAccount } = fixture;
  const grace = await createAccount(api, sessionPath, 'Grace');
  const otherBot = await createBot(api, sessionPath, 'other_bot');
  const senders = [createdAccount.account.id, grace.id];
  const bot = echoMessages(api, botApiPath, senders.length);

  // The unrelated bot calls throughout, so its calls interleave with the actions and replies.
  let actionsSettled = false;
  const unrelatedCalls = (async () => {
    while (!actionsSettled) {
      await callBotApi(api, `${otherBot.botApiPath}/getMe`, {});
    }
  })();
  const receipts = await Promise.all(
    senders.map((accountId) =>
      act(
        api,
        `${sessionPath}/accounts/${accountId}/messages`,
        jsonRequest('POST', {
          to: { type: 'private', botId: createdBot.bot.id },
          text: `From ${accountId}`,
        }),
        201,
      )
    ),
  );
  await bot;
  actionsSettled = true;
  await unrelatedCalls;
  const { entries } = await readActivity(api, sessionPath, { after: 0 });

  for (const [index, accountId] of senders.entries()) {
    const caused = entries.filter((entry) =>
      (entry.kind === 'update_delivered' && entry.user_id === accountId) ||
      (entry.method === 'sendMessage' && entry.chat_id === accountId)
    );
    assertEquals(caused.length, 2, `Expected the delivery of ${accountId}'s message and a reply`);
    for (const entry of caused) {
      assertGreater(
        entry.position,
        receipts[index].activityPosition,
        `Expected what ${accountId}'s action caused after its receipt`,
      );
    }
  }
});

Deno.test('An effect recorded before an action answers still follows its receipt', async () => {
  await using fixture = await createPrivateConversationFixture();
  const { api, sessionPath, botApiPath, createdBot, sendText } = fixture;
  const botId = createdBot.bot.id;
  // The webhook never answers, so its attempt stays in flight until the test expires it.
  const closing = Promise.withResolvers<void>();
  const webhook = Deno.serve(
    { hostname: '127.0.0.1', port: 0, onListen: () => {} },
    (request) =>
      new Promise<Response>((resolve) => {
        const answer = () => resolve(new Response(null, { status: 504 }));
        request.signal.addEventListener('abort', answer, { once: true });
        closing.promise.then(answer);
      }),
  );
  try {
    await act(
      api,
      `${sessionPath}/bots/${botId}/webhook-delivery`,
      jsonRequest('PUT', { scheduling: 'manual' }),
      200,
    );
    await callBotApi(api, `${botApiPath}/setWebhook`, {
      url: `http://127.0.0.1:${webhook.addr.port}/webhook`,
    });
    await sendText('Hello');
    const { entries: [delivery] } = await readActivity(api, sessionPath, {
      after: 0,
      waitMs: 5_000,
      kind: 'update_delivered',
    });
    assert(delivery?.webhook_attempt_id !== undefined, 'Expected the update sent to the webhook');

    // Expiring the attempt fails it, and the failure is recorded before the expiry answers.
    const receipt = await act(
      api,
      `${sessionPath}/bots/${botId}/webhook-attempts/${delivery.webhook_attempt_id}/expiry`,
      { method: 'POST' },
      200,
    );
    const { entries, head_position } = await readActivity(api, sessionPath, {
      after: receipt.activityPosition,
    });

    const failure = entries.find((entry) => entry.kind === 'webhook_attempt_failed');
    assert(failure !== undefined, 'Expected the failed attempt after the receipt');
    assertLessOrEqual(
      failure.position,
      head_position,
      'Expected the failure recorded by the time the expiry answered',
    );
  } finally {
    await api.request(sessionPath, { method: 'DELETE' });
    closing.resolve();
    await webhook.shutdown();
  }
});
