import { Bot } from 'https://cdn.jsdelivr.net/gh/grammyjs/grammY@^1.46.0/src/bot.ts';
import { webhookCallback } from 'https://cdn.jsdelivr.net/gh/grammyjs/grammY@^1.46.0/src/convenience/webhook.ts';
import {
  createTestSession,
  type EmulationApi,
  TEST_PUBLIC_ORIGIN,
} from './support/emulation_api.ts';

interface BotActivityReadBody {
  readonly entries: ReadonlyArray<Record<string, unknown>>;
  readonly head_position: number;
}

Deno.test('GET bot-activity records calls with their answers, apart from getUpdates', async () => {
  const { api, activityPath, botApiPath, bot, account, sendText } = await createFixture();
  await sendText('/start');
  await callBotApi(api, `${botApiPath}/getUpdates`, {});
  await callBotApi(api, `${botApiPath}/SENDMESSAGE`, { chat_id: account.id, text: 'Hello' });
  await callBotApi(api, `${botApiPath}/sendMessage`, { chat_id: account.id, text: '' });
  await callBotApi(api, `${botApiPath}/notAMethod`, { chat_id: account.id });
  await api.request(`${botApiPath}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{',
  });
  const upload = new FormData();
  upload.append('chat_id', String(account.id));
  upload.append('document', new File(['report'], 'report.txt'));
  await api.request(`${botApiPath}/sendDocument`, { method: 'POST', body: upload });

  const { entries } = await readActivity(api, `${activityPath}?kind=bot_api_call`);
  const summary = entries.map((entry) => [
    entry.bot_id,
    entry.method,
    entry.requested_method,
    entry.via,
    entry.parameters,
    entry.uploaded_files,
    entry.chat_id,
    (entry.answer as { ok: boolean; error_code?: number }).error_code ?? 200,
  ]);
  assertJson(summary, [
    [
      bot.id,
      'sendMessage',
      'SENDMESSAGE',
      'http',
      {
        chat_id: String(account.id),
        text: 'Hello',
      },
      [],
      account.id,
      200,
    ],
    [
      bot.id,
      'sendMessage',
      'sendMessage',
      'http',
      {
        chat_id: String(account.id),
        text: '',
      },
      [],
      account.id,
      400,
    ],
    [
      bot.id,
      'notAMethod',
      'notAMethod',
      'http',
      {
        chat_id: String(account.id),
      },
      [],
      account.id,
      404,
    ],
    [bot.id, 'sendMessage', 'sendMessage', 'http', {}, [], undefined, 400],
    [
      bot.id,
      'sendDocument',
      'sendDocument',
      'http',
      { chat_id: String(account.id) },
      [{
        field_name: 'document',
        file_name: 'report.txt',
        size_bytes: 6,
      }],
      account.id,
      200,
    ],
  ], 'Expected every call but getUpdates to be recorded with its answer');

  const reply = entries[0].answer as { ok: boolean; result: { text: string } };
  if (!reply.ok || reply.result.text !== 'Hello') {
    throw new Error('Expected a call to be recorded with the result the bot received');
  }
});

Deno.test('GET bot-activity records deliveries and confirmations of polled updates', async () => {
  const { api, activityPath, botApiPath, bot, account, sendText } = await createFixture();
  await sendText('/start');
  const { body } = await callBotApi(api, `${botApiPath}/getUpdates`, {});
  const updateId = (body as { result: Array<{ update_id: number }> }).result[0].update_id;
  await callBotApi(api, `${botApiPath}/getUpdates`, { offset: updateId + 1 });

  const { entries } = await readActivity(api, activityPath);
  assertJson(
    entries.map(({ position, kind, bot_id, via, chat_id, user_id }) => [
      position,
      kind,
      bot_id,
      via,
      chat_id,
      user_id,
    ]),
    [
      [1, 'update_delivered', bot.id, 'polling', account.id, account.id],
      [2, 'update_confirmed', bot.id, 'polling', account.id, account.id],
    ],
    'Expected the polled update to be delivered, then confirmed',
  );
  const delivered = entries[0].update as { update_id: number; message: { text: string } };
  if (
    delivered.update_id !== updateId || delivered.message.text !== '/start' ||
    entries[1].update_id !== updateId
  ) {
    throw new Error('Expected the entries to carry the update and its ID');
  }
});

Deno.test('GET bot-activity filters entries by query parameters', async () => {
  const { api, activityPath, botApiPath, account, sendText } = await createFixture();
  await sendText('/start');
  await callBotApi(api, `${botApiPath}/getUpdates`, {});
  await callBotApi(api, `${botApiPath}/sendMessage`, { chat_id: account.id, text: 'One' });
  await callBotApi(api, `${botApiPath}/sendMessage`, { chat_id: account.id, text: 'Two' });
  await callBotApi(api, `${botApiPath}/sendMessage`, { chat_id: 1, text: 'Nobody' });

  const cases = [
    { query: 'method=SendMessage', expected: [2, 3, 4] },
    { query: 'method=sendMessage&parameters[text]=Two', expected: [3] },
    { query: `chat_id=${account.id}`, expected: [1, 2, 3] },
    { query: `user_id=${account.id}`, expected: [1] },
    { query: 'update_id=1', expected: [1] },
    { query: 'update_id=2', expected: [] },
    { query: 'ok=false', expected: [4] },
    { query: 'kind=update_delivered', expected: [1] },
    { query: 'after=1&before=4', expected: [2, 3] },
    { query: 'after=1&limit=1', expected: [2] },
    { query: `bot_id=${account.id}`, expected: [] },
  ];
  for (const { query, expected } of cases) {
    const { entries, head_position } = await readActivity(api, `${activityPath}?${query}`);
    assertJson(
      entries.map(({ position }) => position),
      expected,
      `Expected ${query} to find ${JSON.stringify(expected)}`,
    );
    if (head_position !== 4) {
      throw new Error(`Expected ${query} to report head position 4`);
    }
  }
});

Deno.test('GET bot-activity finds calls of a method by an older name of it', async () => {
  const { api, activityPath, botApiPath } = await createFixture();
  await callBotApi(api, `${botApiPath}/getChatMembersCount`, { chat_id: 1 });

  const { entries } = await readActivity(api, `${activityPath}?method=getChatMemberCount`);
  const legacyEntries = await readActivity(api, `${activityPath}?method=getChatMembersCount`);
  if (
    entries.length !== 1 || legacyEntries.entries.length !== 1 ||
    entries[0].method !== 'getChatMemberCount' ||
    entries[0].requested_method !== 'getChatMembersCount'
  ) {
    throw new Error('Expected a call by an older name to be found by either name');
  }
});

Deno.test('GET bot-activity rejects malformed queries and positions beyond the head', async () => {
  const { api, activityPath } = await createFixture();
  const cases = [
    'unknown=1',
    'after=0&after=1',
    'parameters[text]=a&parameters[text]=b',
    'parameters[]=a',
    'parameters=a',
    'after=-1',
    'after=1',
    'before=2',
    'after=0&before=0',
    'before=1&wait_ms=10',
    'wait_ms=600001',
    'limit=1001',
    'ok=yes',
    'update_id=first',
    'kind=update',
    'method=',
  ];
  for (const query of cases) {
    const response = await api.request(`${activityPath}?${query}`);
    if (response.status !== 400) {
      throw new Error(`Expected ${query} to be rejected, received ${response.status}`);
    }
  }
  const emptyRange = await api.request(`${activityPath}?after=0&before=1`);
  if (emptyRange.status !== 200) {
    throw new Error('Expected a range ending just after the head to be read');
  }
});

Deno.test('GET bot-activity holds a read until a matching entry is recorded', async () => {
  const { api, activityPath, botApiPath, account, sendText } = await createFixture();
  const heldRead = readActivity(api, `${activityPath}?method=sendMessage&wait_ms=10000`);

  await sendText('/start');
  await callBotApi(api, `${botApiPath}/sendMessage`, { chat_id: account.id, text: 'Hello' });

  const { entries } = await expectSettlementWithin(
    heldRead,
    1_000,
    'Expected the held read to be answered once the call was recorded',
  );
  if (entries.length !== 1 || entries[0].method !== 'sendMessage') {
    throw new Error('Expected the held read to find the call');
  }
});

Deno.test('DELETE /sessions/:sessionId answers held bot activity reads', async () => {
  const { api, sessionPath, activityPath } = await createFixture();
  const heldRead = readActivity(api, `${activityPath}?wait_ms=600000`);

  await api.request(sessionPath, { method: 'DELETE' });
  const { entries } = await expectSettlementWithin(
    heldRead,
    1_000,
    'Expected ending the session to answer the held read at once',
  );
  if (entries.length !== 0) {
    throw new Error('Expected the held read to find nothing');
  }
});

Deno.test('GET bot-activity records a webhook reply before the confirmation of its update', async () => {
  const { api, sessionPath, activityPath, createdBot, account, sendText } = await createFixture();
  const grammyBot = new Bot(createdBot.token, {
    client: {
      apiRoot: `${TEST_PUBLIC_ORIGIN}${sessionPath}/bot-api`,
      fetch: createInProcessFetch(api.fetch),
      canUseWebhookReply: (method) => method === 'sendMessage',
    },
  });
  grammyBot.command('start', (context) => context.reply('Hello through the webhook reply!'));
  const handleWebhookRequest = webhookCallback(grammyBot, 'std/http');
  const webhookServer = Deno.serve(
    { hostname: '127.0.0.1', port: 0, onListen: () => {} },
    (request) => handleWebhookRequest(request),
  );

  try {
    await grammyBot.init();
    await grammyBot.api.setWebhook(`http://127.0.0.1:${webhookServer.addr.port}/webhook`);
    const { head_position: start } = await readActivity(api, `${activityPath}?limit=0`);
    await sendText('/start');
    await expectSettlementWithin(
      readActivity(api, `${activityPath}?after=${start}&kind=update_confirmed&wait_ms=5000`),
      5_000,
      'Expected the webhook to accept the update',
    );

    const { entries } = await readActivity(api, `${activityPath}?after=${start}`);
    assertJson(
      entries.map(({ kind, via, method, chat_id }) => [kind, via, method, chat_id]),
      [
        ['update_delivered', 'webhook', undefined, account.id],
        ['bot_api_call', 'webhook_reply', 'sendMessage', account.id],
        ['update_confirmed', 'webhook', undefined, account.id],
      ],
      'Expected the reply to be recorded between the delivery and the confirmation',
    );
  } finally {
    await api.request(sessionPath, { method: 'DELETE' });
    await webhookServer.shutdown();
  }
});

/** Creates a session holding a bot and an account that can message it. */
async function createFixture() {
  const { api, sessionPath } = await createTestSession();
  const createdBot = await postJson(api, `${sessionPath}/bots`, {
    first_name: 'Test Bot',
    username: 'test_bot',
  }) as { token: string; bot: { id: number } };
  const { account } = await postJson(api, `${sessionPath}/accounts`, {
    first_name: 'Ada',
  }) as { account: { id: number } };

  const sendText = async (text: string) => {
    await postJson(api, `${sessionPath}/accounts/${account.id}/messages`, {
      to: { type: 'private', botId: createdBot.bot.id },
      text,
    });
  };

  return {
    api,
    sessionPath,
    activityPath: `${sessionPath}/bot-activity`,
    botApiPath: `${sessionPath}/bot-api/bot${createdBot.token}`,
    createdBot,
    bot: createdBot.bot,
    account,
    sendText,
  };
}

async function postJson(api: EmulationApi, path: string, body: unknown): Promise<unknown> {
  const response = await api.request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (response.status !== 201) {
    throw new Error(`Expected POST ${path} to create a resource, received ${response.status}`);
  }
  return await response.json();
}

async function callBotApi(
  api: EmulationApi,
  methodPath: string,
  parameters: Record<string, unknown>,
): Promise<{ status: number; body: unknown }> {
  const response = await api.request(methodPath, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(parameters),
  });
  return { status: response.status, body: await response.json() };
}

async function readActivity(api: EmulationApi, path: string): Promise<BotActivityReadBody> {
  const response = await api.request(path);
  if (response.status !== 200) {
    throw new Error(`Expected GET ${path} to succeed, received ${response.status}`);
  }
  return await response.json() as BotActivityReadBody;
}

function assertJson(actual: unknown, expected: unknown, message: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${message}: received ${JSON.stringify(actual)}`);
  }
}

async function expectSettlementWithin<T>(
  pending: Promise<T>,
  milliseconds: number,
  failureMessage: string,
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timeoutId = setTimeout(() => reject(new Error(failureMessage)), milliseconds);
  });
  try {
    return await Promise.race([pending, timeout]);
  } finally {
    clearTimeout(timeoutId);
  }
}

function createInProcessFetch(
  handler: (request: Request) => Response | Promise<Response>,
): typeof globalThis.fetch {
  return async (input, init) => await handler(new Request(input, init));
}
