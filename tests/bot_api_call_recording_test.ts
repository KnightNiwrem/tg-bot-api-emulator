import { createTestSession, type EmulationApi, requestJson } from './support/emulation_api.ts';

interface BotApiCallActivityEntry {
  readonly kind: string;
  readonly method: string;
  readonly requested_method: string;
  readonly via: string;
  readonly parameters: Record<string, string>;
  readonly answer: { readonly ok: boolean; readonly error_code?: number };
}

Deno.test('getUpdates calls are not recorded, whatever they are answered', async () => {
  const { api, sessionPath, botApiPath, bot } = await createFixture();
  await requestJson(api, 'POST', `${sessionPath}/bots/${bot.id}/server-error-responses`, {
    method: 'GETUPDATES',
    error_code: 500,
  });

  const statuses = [
    await postBotApi(api, `${botApiPath}/getUpdates`, '{}'),
    await postBotApi(api, `${botApiPath}/GETUPDATES`, '{}'),
    await postBotApi(api, `${botApiPath}/getUpdates`, '{'),
    await postBotApi(api, `${botApiPath}/getUpdates`, '{"limit":"many"}'),
    // A get method is recorded over HTTP, and so is an unknown name that resembles getUpdates.
    await postBotApi(api, `${botApiPath}/getWebhookInfo`, '{}'),
    await postBotApi(api, `${botApiPath}/getUpdate`, '{}'),
  ];
  assertJson(
    [statuses, await readRecordedCalls(api, sessionPath)],
    [
      [500, 200, 400, 400, 200, 404],
      [
        ['getWebhookInfo', 'getWebhookInfo', 'http', {}, 200],
        ['getUpdate', 'getUpdate', 'http', {}, 404],
      ],
    ],
    'Expected every getUpdates call to be answered and none to be recorded',
  );
});

Deno.test('Bot API HTTP admission answers and records rejected calls in its order', async () => {
  const { api, sessionPath, botApiPath } = await createFixture();
  const unknownTokenPath = `${sessionPath}/bot-api/bot0:unknown`;

  const answers = [
    // A path without a method segment is rejected before its token is checked.
    await postBotApiForAnswer(api, unknownTokenPath, '{}'),
    // An unknown token is rejected before the method is looked up or the request decoded.
    await postBotApiForAnswer(api, `${unknownTokenPath}/notAMethod`, '{'),
    await postBotApiForAnswer(api, `${unknownTokenPath}/sendMessage`, '{'),
    // An unknown method is rejected even when its request cannot be decoded.
    await postBotApiForAnswer(api, `${botApiPath}/notAMethod`, '{'),
    // An implemented method, under any name it is called by, rejects an undecodable request.
    await postBotApiForAnswer(api, `${botApiPath}/SendMessage`, '{'),
    await postBotApiForAnswer(api, `${botApiPath}/kickChatMember`, '{'),
  ];
  assertJson(
    answers.map(({ status, error_code, description }) => [
      status,
      error_code,
      status === 400 ? undefined : description,
    ]),
    [
      [404, 404, 'Not Found'],
      [401, 401, 'Unauthorized'],
      [401, 401, 'Unauthorized'],
      [404, 404, 'Not Found: method not found'],
      [400, 400, undefined],
      [400, 400, undefined],
    ],
    'Expected each call to be rejected by the first check it fails',
  );
  assertJson(
    await readRecordedCalls(api, sessionPath),
    [
      ['notAMethod', 'notAMethod', 'http', {}, 404],
      ['sendMessage', 'SendMessage', 'http', {}, 400],
      ['banChatMember', 'kickChatMember', 'http', {}, 400],
    ],
    "Expected only the authenticated bot's calls to be recorded, without parameters",
  );
});

/** Creates a session holding a bot. */
async function createFixture() {
  const { api, sessionPath } = await createTestSession();
  const { body: createdBot } = await requestJson<{ token: string; bot: { id: number } }>(
    api,
    'POST',
    `${sessionPath}/bots`,
    { first_name: 'Test Bot', username: 'test_bot' },
  );
  return {
    api,
    sessionPath,
    botApiPath: `${sessionPath}/bot-api/bot${createdBot.token}`,
    bot: createdBot.bot,
  };
}

async function postBotApi(api: EmulationApi, path: string, body: string): Promise<number> {
  return (await postBotApiForAnswer(api, path, body)).status;
}

async function postBotApiForAnswer(
  api: EmulationApi,
  path: string,
  body: string,
): Promise<{ status: number; error_code?: number; description?: string }> {
  const response = await api.request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  });
  const answer = await response.json() as { error_code?: number; description?: string };
  return { status: response.status, ...answer };
}

/** Reads the session's recorded Bot API calls, each as its names, transport, parameters, status. */
async function readRecordedCalls(api: EmulationApi, sessionPath: string): Promise<unknown[]> {
  const { status, body } = await requestJson<{ entries: BotApiCallActivityEntry[] }>(
    api,
    'GET',
    `${sessionPath}/bot-activity?kind=bot_api_call`,
  );
  if (status !== 200) {
    throw new Error(`Expected the bot activity to be read, received ${status}`);
  }
  return body.entries.map(({ method, requested_method, via, parameters, answer }) => [
    method,
    requested_method,
    via,
    parameters,
    answer.ok ? 200 : answer.error_code,
  ]);
}

function assertJson(actual: unknown, expected: unknown, message: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${message}: received ${JSON.stringify(actual)}`);
  }
}
