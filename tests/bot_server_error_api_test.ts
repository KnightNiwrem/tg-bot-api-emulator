import { Bot } from 'https://cdn.jsdelivr.net/gh/grammyjs/grammY@^1.46.0/src/bot.ts';
import { GrammyError } from 'https://cdn.jsdelivr.net/gh/grammyjs/grammY@^1.46.0/src/core/error.ts';
import { webhookCallback } from 'https://cdn.jsdelivr.net/gh/grammyjs/grammY@^1.46.0/src/convenience/webhook.ts';

import {
  createSession,
  createTestSession,
  type EmulationApi,
  requestJson,
  TEST_PUBLIC_ORIGIN,
} from './support/emulation_api.ts';

interface BotApiBody {
  readonly ok: boolean;
  readonly error_code?: number;
  readonly description?: string;
  readonly parameters?: unknown;
  readonly result?: unknown;
}

interface ActivityEntry {
  readonly kind: string;
  readonly via?: string;
  readonly method?: string;
  readonly answer?: BotApiBody;
}

Deno.test('queued server errors answer the next matching calls before they run', async () => {
  const { api, sessionPath, botApiPath, bot, account, sendText, readMessageTexts } =
    await createFixture();
  await sendText('/start');
  const serverErrorsPath = `${sessionPath}/bots/${bot.id}/server-error-responses`;

  const queuings = [
    await requestJson(api, 'POST', serverErrorsPath, {
      method: 'SENDMESSAGE',
      error_code: 500,
      count: 2,
    }),
    await requestJson(api, 'POST', serverErrorsPath, { method: 'kickChatMember', error_code: 503 }),
  ];
  assertJson(
    queuings.map(({ status, body }) => [status, body]),
    [
      [201, { method: 'sendMessage', error_code: 500, remaining_count: 2 }],
      [201, { method: 'banChatMember', error_code: 503, remaining_count: 1 }],
    ],
    "Expected the queued answers under the methods' current names",
  );

  const failedResponse = await api.request(`${botApiPath}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: account.id, text: 'Hello' }),
  });
  assertJson(
    [
      failedResponse.status,
      failedResponse.headers.get('Retry-After'),
      await failedResponse.json(),
      await readMessageTexts(),
      (await requestJson(api, 'GET', serverErrorsPath)).body,
    ],
    [
      500,
      null,
      { ok: false, error_code: 500, description: 'Internal Server Error' },
      ['/start'],
      {
        server_error_responses: [
          { method: 'sendMessage', error_code: 500, remaining_count: 1 },
          { method: 'banChatMember', error_code: 503, remaining_count: 1 },
        ],
      },
    ],
    "Expected Telegram's error envelope, no message, and one answer left",
  );

  // A caller that does not retry sees the failure; the call after the queued answers runs.
  const grammyBot = createGrammyBot(api, sessionPath, bot.token);
  const grammyFailure = await grammyBot.api.sendMessage(account.id, 'Hello')
    .catch((error: unknown) => error);
  const delivered = await grammyBot.api.sendMessage(account.id, 'Hello');
  if (!(grammyFailure instanceof GrammyError) || grammyFailure.error_code !== 500) {
    throw new Error(`Expected grammY to reject the call, received ${grammyFailure}`);
  }

  // The answer applies before the parameters are read, which still decide the call after it.
  const kickChatMember = (parameters: Record<string, unknown>) =>
    requestJson<BotApiBody>(api, 'POST', `${botApiPath}/kickChatMember`, parameters);
  const kicks = [await kickChatMember({}), await kickChatMember({})];
  assertJson(
    [
      delivered.text,
      await readMessageTexts(),
      kicks.map(({ status, body }) => [status, body.description]),
      (await requestJson(api, 'GET', serverErrorsPath)).body,
    ],
    [
      'Hello',
      ['/start', 'Hello'],
      [[503, 'Service Unavailable'], [400, 'Bad Request: invalid user_id specified']],
      { server_error_responses: [] },
    ],
    'Expected each queued answer used once and later calls to run',
  );

  const activity = await readActivity(api, `${sessionPath}/bot-activity?kind=bot_api_call`);
  assertJson(
    activity.map(({ method, via, answer }) => [method, via, answer?.error_code ?? answer?.ok]),
    [
      ['sendMessage', 'http', 500],
      ['sendMessage', 'http', 500],
      ['sendMessage', 'http', true],
      ['banChatMember', 'http', 503],
      ['banChatMember', 'http', 400],
    ],
    'Expected the activity log to record the answer each call received',
  );
});

Deno.test('rejected server error queue requests leave the queued answers intact', async () => {
  const { api, sessionPath, bot, account } = await createFixture();
  const serverErrorsPath = `${sessionPath}/bots/${bot.id}/server-error-responses`;
  const queued = await requestJson(api, 'POST', serverErrorsPath, {
    method: 'getMe',
    error_code: 503,
    count: 2,
  });

  const rawPost = (path: string, body: string) =>
    api.request(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
  const refusals = [
    await rawPost(serverErrorsPath, JSON.stringify({ error_code: 502 })),
    await rawPost(serverErrorsPath, JSON.stringify({ error_code: 429 })),
    await rawPost(serverErrorsPath, JSON.stringify({ error_code: '500' })),
    await rawPost(serverErrorsPath, JSON.stringify({ method: 'getMe' })),
    await rawPost(serverErrorsPath, JSON.stringify({ error_code: 500, count: 0 })),
    await rawPost(serverErrorsPath, JSON.stringify({ error_code: 500, count: 1.5 })),
    await rawPost(serverErrorsPath, JSON.stringify({ method: 'sendDice', error_code: 500 })),
    await rawPost(serverErrorsPath, JSON.stringify({ error_code: 500, description: 'Oops' })),
    await rawPost(serverErrorsPath, '{"error_code":500'),
    await rawPost(
      `${sessionPath}/bots/${account.id}/server-error-responses`,
      JSON.stringify({ error_code: 500 }),
    ),
    await rawPost(`${sessionPath}/bots/0/server-error-responses`, JSON.stringify({})),
    await rawPost(
      `/sessions/unknown-session/bots/${bot.id}/server-error-responses`,
      JSON.stringify({ error_code: 500 }),
    ),
  ];
  const listings = [
    await requestJson(api, 'GET', serverErrorsPath),
    await requestJson(api, 'GET', `${sessionPath}/bots/${account.id}/server-error-responses`),
  ];
  assertJson(
    [
      queued.status,
      refusals.map(({ status }) => status),
      listings[0].body,
      listings[1].status,
    ],
    [
      201,
      [400, 400, 400, 400, 400, 400, 400, 400, 400, 404, 404, 404],
      { server_error_responses: [{ method: 'getMe', error_code: 503, remaining_count: 2 }] },
      404,
    ],
    'Expected malformed requests and unknown bots refused, and the queue unchanged',
  );
});

Deno.test('concurrent calls take each queued server error exactly once', async () => {
  const { api, sessionPath, botApiPath, bot, account, sendText, readMessageTexts } =
    await createFixture();
  await sendText('/start');
  const serverErrorsPath = `${sessionPath}/bots/${bot.id}/server-error-responses`;
  await requestJson(api, 'POST', serverErrorsPath, {
    method: 'sendMessage',
    error_code: 503,
    count: 3,
  });

  const texts = Array.from({ length: 10 }, (_, index) => `Message ${index}`);
  const answers = await Promise.all(
    texts.map((text) =>
      requestJson<BotApiBody>(api, 'POST', `${botApiPath}/sendMessage`, {
        chat_id: account.id,
        text,
      })
    ),
  );
  const failedTexts = texts.filter((_, index) => answers[index].status === 503);
  const deliveredTexts = texts.filter((_, index) => answers[index].status === 200);
  const failedEntries = await readActivity(
    api,
    `${sessionPath}/bot-activity?method=sendMessage&ok=false`,
  );
  assertJson(
    [
      failedTexts.length,
      deliveredTexts.length,
      (await readMessageTexts()).slice(1).sort(),
      failedEntries.length,
      (await requestJson(api, 'GET', serverErrorsPath)).body,
    ],
    [3, 7, deliveredTexts.sort(), 3, { server_error_responses: [] }],
    'Expected exactly three calls to fail and the other seven to deliver their messages',
  );
});

Deno.test('queued rate limit answers apply before queued server errors', async () => {
  const { api, sessionPath, botApiPath, bot } = await createFixture();
  const botPath = `${sessionPath}/bots/${bot.id}`;
  // Queued first, the server error still waits for the rate limit answer.
  await requestJson(api, 'POST', `${botPath}/server-error-responses`, { error_code: 500 });
  await requestJson(api, 'POST', `${botPath}/rate-limit-responses`, {
    method: 'getMe',
    retry_after: 2,
  });

  const getMe = () => requestJson<BotApiBody>(api, 'POST', `${botApiPath}/getMe`, {});
  const answers = [await getMe(), await getMe(), await getMe()];
  assertJson(
    [
      answers.map(({ status, body }) => [status, body.description ?? body.ok]),
      (await requestJson(api, 'GET', `${botPath}/rate-limit-responses`)).body,
      (await requestJson(api, 'GET', `${botPath}/server-error-responses`)).body,
    ],
    [
      [[429, 'Too Many Requests: retry after 2'], [500, 'Internal Server Error'], [200, true]],
      { rate_limit_responses: [] },
      { server_error_responses: [] },
    ],
    'Expected one queued answer per call, rate limits first',
  );
});

Deno.test('calls that never reach a method leave queued server errors for later calls', async () => {
  const { api, sessionPath, botApiPath, bot } = await createFixture();
  const serverErrorsPath = `${sessionPath}/bots/${bot.id}/server-error-responses`;
  await requestJson(api, 'POST', serverErrorsPath, { error_code: 500 });

  const unknownMethod = await requestJson<BotApiBody>(api, 'POST', `${botApiPath}/sendDice`, {});
  const undecodable = await api.request(`${botApiPath}/getMe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{',
  });
  const invalidToken = await requestJson<BotApiBody>(
    api,
    'POST',
    `${sessionPath}/bot-api/bot${bot.id}:wrong/getMe`,
    {},
  );
  const remaining = await requestJson(api, 'GET', serverErrorsPath);
  const getMe = await requestJson<BotApiBody>(api, 'POST', `${botApiPath}/getMe`, {});
  assertJson(
    [
      [unknownMethod.status, unknownMethod.body.description],
      undecodable.status,
      invalidToken.status,
      remaining.body,
      getMe.status,
    ],
    [
      [404, 'Not Found: method not found'],
      400,
      401,
      { server_error_responses: [{ error_code: 500, remaining_count: 1 }] },
      500,
    ],
    'Expected only the call of an implemented method to take the queued answer',
  );
});

Deno.test('a polling bot keeps its updates through a queued getUpdates failure', async () => {
  const { api, sessionPath, botApiPath, bot, sendText } = await createFixture();
  await requestJson(api, 'POST', `${sessionPath}/bots/${bot.id}/server-error-responses`, {
    method: 'getUpdates',
    error_code: 503,
  });
  await sendText('/start');

  const getUpdates = () =>
    requestJson<BotApiBody>(api, 'POST', `${botApiPath}/getUpdates`, { timeout: 0 });
  const failed = await getUpdates();
  const recovered = await getUpdates();
  const updates = recovered.body.result as Array<{ message: { text: string } }>;
  assertJson(
    [failed.status, failed.body.description, updates.map(({ message }) => message.text)],
    [503, 'Service Unavailable', ['/start']],
    'Expected the failed poll to leave the update for the next one',
  );
});

Deno.test('a webhook reply takes the queued server error and changes nothing', async () => {
  const { api, sessionPath, bot, sendText, readMessageTexts } = await createFixture();
  const grammyBot = createGrammyBot(api, sessionPath, bot.token, {
    canUseWebhookReply: (method) => method === 'sendMessage',
  });
  grammyBot.command('start', (context) => context.reply('Welcome!'));
  const handleWebhookRequest = webhookCallback(grammyBot, 'std/http');
  const webhookServer = Deno.serve(
    { hostname: '127.0.0.1', port: 0, onListen: () => {} },
    (request) => handleWebhookRequest(request),
  );

  try {
    await grammyBot.init();
    await grammyBot.api.setWebhook(`http://127.0.0.1:${webhookServer.addr.port}/webhook`);
    await requestJson(api, 'POST', `${sessionPath}/bots/${bot.id}/server-error-responses`, {
      method: 'sendMessage',
      error_code: 500,
    });

    const activityPath = `${sessionPath}/bot-activity`;
    for (const _attempt of ['failed', 'recovered']) {
      const start = (await readActivityHead(api, activityPath)).head_position;
      await sendText('/start');
      await readActivity(
        api,
        `${activityPath}?after=${start}&kind=update_confirmed&wait_ms=5000`,
      );
    }
    const replies = await readActivity(api, `${activityPath}?method=sendMessage`);
    assertJson(
      [
        replies.map(({ via, answer }) => [via, answer?.error_code ?? answer?.ok]),
        await readMessageTexts(),
      ],
      [
        [['webhook_reply', 500], ['webhook_reply', true]],
        ['/start', '/start', 'Welcome!'],
      ],
      'Expected the first reply to fail without a message and the second to be sent',
    );
  } finally {
    await api.request(sessionPath, { method: 'DELETE' });
    await webhookServer.shutdown();
  }
});

Deno.test('queued server errors stay within their session and end with it', async () => {
  const { api, sessionPath, botApiPath, bot } = await createFixture();
  const otherSessionPath = await createSession(api);
  const otherBot = await createBot(api, otherSessionPath);
  await requestJson(api, 'POST', `${sessionPath}/bots/${bot.id}/server-error-responses`, {
    error_code: 500,
    count: 5,
  });

  const otherGetMe = await requestJson(
    api,
    'POST',
    `${otherSessionPath}/bot-api/bot${otherBot.token}/getMe`,
    {},
  );
  const otherListing = await requestJson(
    api,
    'GET',
    `${otherSessionPath}/bots/${otherBot.id}/server-error-responses`,
  );
  const getMe = await requestJson(api, 'POST', `${botApiPath}/getMe`, {});
  await api.request(sessionPath, { method: 'DELETE' });
  const endedListing = await api.request(`${sessionPath}/bots/${bot.id}/server-error-responses`);
  assertJson(
    [otherGetMe.status, otherListing.body, getMe.status, endedListing.status],
    [200, { server_error_responses: [] }, 500, 404],
    "Expected another session's bot unaffected, and the queue gone with its session",
  );
});

/** Creates a session holding a bot and an account that can message it. */
async function createFixture() {
  const { api, sessionPath } = await createTestSession();
  const bot = await createBot(api, sessionPath);
  const createdAccount = await requestJson<{ account: { id: number } }>(
    api,
    'POST',
    `${sessionPath}/accounts`,
    { first_name: 'Ada' },
  );
  const account = createdAccount.body.account;
  const conversationPath =
    `${sessionPath}/accounts/${account.id}/conversations/private/${bot.id}/messages`;

  return {
    api,
    sessionPath,
    botApiPath: `${sessionPath}/bot-api/bot${bot.token}`,
    bot,
    account,
    sendText: async (text: string) => {
      const sent = await requestJson(
        api,
        'POST',
        `${sessionPath}/accounts/${account.id}/messages`,
        {
          to: { type: 'private', botId: bot.id },
          text,
        },
      );
      if (sent.status !== 201) {
        throw new Error(`Expected "${text}" to be sent, received ${sent.status}`);
      }
    },
    readMessageTexts: async () => {
      const history = await requestJson<{ messages: Array<{ text: string }> }>(
        api,
        'GET',
        conversationPath,
      );
      return history.body.messages.map(({ text }) => text);
    },
  };
}

async function createBot(
  api: EmulationApi,
  sessionPath: string,
): Promise<{ id: number; token: string }> {
  const created = await requestJson<{ token: string; bot: { id: number } }>(
    api,
    'POST',
    `${sessionPath}/bots`,
    { first_name: 'Test Bot', username: 'test_bot' },
  );
  return { id: created.body.bot.id, token: created.body.token };
}

function createGrammyBot(
  api: EmulationApi,
  sessionPath: string,
  token: string,
  clientOptions: { canUseWebhookReply?: (method: string) => boolean } = {},
): Bot {
  return new Bot(token, {
    client: {
      apiRoot: `${TEST_PUBLIC_ORIGIN}${sessionPath}/bot-api`,
      fetch: async (input, init) => await api.fetch(new Request(input, init)),
      ...clientOptions,
    },
  });
}

async function readActivityHead(
  api: EmulationApi,
  activityPath: string,
): Promise<{ head_position: number }> {
  return (await requestJson<{ head_position: number }>(api, 'GET', `${activityPath}?limit=0`))
    .body;
}

async function readActivity(api: EmulationApi, path: string): Promise<readonly ActivityEntry[]> {
  const read = await requestJson<{ entries: ActivityEntry[] }>(api, 'GET', path);
  if (read.status !== 200) {
    throw new Error(`Expected GET ${path} to succeed, received ${read.status}`);
  }
  return read.body.entries;
}

function assertJson(actual: unknown, expected: unknown, message: string): void {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  if (actualJson !== expectedJson) {
    throw new Error(`${message}\nExpected: ${expectedJson}\nReceived: ${actualJson}`);
  }
}
