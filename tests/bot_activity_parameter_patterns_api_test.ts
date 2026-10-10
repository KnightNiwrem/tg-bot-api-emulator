/**
 * Reading bot activity by `parameters_json`: structural patterns for the JSON a call sent in its
 * parameters, beside exact `parameters[name]` text, and the issues a malformed pattern reports.
 */
import { createTestSession, type EmulationApi, requestJson } from './support/emulation_api.ts';

interface BotActivityReadBody {
  readonly entries: ReadonlyArray<{ readonly position: number; readonly kind: string }>;
}

interface ControlValidationErrorBody {
  readonly reason: string;
  readonly issues: ReadonlyArray<{
    readonly source: string;
    readonly path: readonly (string | number)[];
    readonly code: string;
  }>;
}

Deno.test('parameters_json matches JSON sent as a body object or as form text, in any member order', async () => {
  const { api, activityPath, botApiPath, account } = await createFixture();
  const replyParameters = { message_id: 7, allow_sending_without_reply: true };
  await callBotApiWithJson(api, `${botApiPath}/sendMessage`, {
    chat_id: account.id,
    text: 'As JSON',
    reply_parameters: replyParameters,
  });
  await callBotApiWithForm(api, `${botApiPath}/sendMessage`, {
    chat_id: String(account.id),
    text: 'As form text',
    reply_parameters: '{"allow_sending_without_reply": true, "message_id": 7}',
  });
  await callBotApiWithJson(api, `${botApiPath}/sendMessage`, {
    chat_id: account.id,
    text: 'Another reply',
    reply_parameters: { message_id: 8, allow_sending_without_reply: true },
  });

  await assertPositions(
    api,
    `${activityPath}?${patternQuery({ reply_parameters: { message_id: 7 } })}`,
    [1, 2],
    'Expected a pattern naming one member to find both spellings of the same JSON',
  );
  await assertPositions(
    api,
    `${activityPath}?${
      patternQuery({ reply_parameters: { allow_sending_without_reply: true, message_id: 7 } })
    }`,
    [1, 2],
    'Expected member order not to matter',
  );
  await assertPositions(
    api,
    `${activityPath}?parameters[reply_parameters]=${
      encodeURIComponent(JSON.stringify(replyParameters))
    }`,
    [1],
    'Expected parameters[name] to keep comparing the exact text sent',
  );
  await assertPositions(
    api,
    `${activityPath}?method=sendMessage&parameters[text]=${encodeURIComponent('As form text')}&${
      patternQuery({ reply_parameters: { message_id: 7 } })
    }`,
    [2],
    'Expected a pattern to combine with the other filters',
  );
});

Deno.test('parameters_json applies its rules to nested values and arrays', async () => {
  const { api, activityPath, botApiPath } = await createFixture();
  await callBotApiWithJson(api, `${botApiPath}/recordShapes`, {
    reply_markup: {
      inline_keyboard: [
        [{ text: 'Yes', callback_data: 'yes' }, { text: 'No', callback_data: 'no' }],
        [{ text: 'Help', url: 'https://example.com/help' }],
      ],
    },
    options: [{ text: 'a', note: null }, { text: 'b' }],
    plain: 'not JSON',
    scalar: '5',
  });

  const cases: ReadonlyArray<readonly [string, string, readonly number[]]> = [
    [
      'objects in arrays may have more members',
      JSON.stringify({
        reply_markup: { inline_keyboard: [[{ text: 'Yes' }, { text: 'No' }], [{}]] },
      }),
      [1],
    ],
    [
      'nested arrays must have the same length',
      JSON.stringify({ reply_markup: { inline_keyboard: [[{ text: 'Yes' }]] } }),
      [],
    ],
    [
      'nested arrays match in order',
      JSON.stringify({
        reply_markup: { inline_keyboard: [[{ text: 'No' }, { text: 'Yes' }], [{}]] },
      }),
      [],
    ],
    ['null matches null', JSON.stringify({ options: [{ note: null }, {}] }), [1]],
    ['null does not match a missing member', JSON.stringify({ options: [{}, { note: null }] }), []],
    ['an object does not match an array', JSON.stringify({ options: {} }), []],
    ['an array does not match an object', JSON.stringify({ reply_markup: [] }), []],
    ['a parameter that is not JSON matches no pattern', JSON.stringify({ plain: {} }), []],
    ['a parameter the call did not send matches no pattern', JSON.stringify({ absent: {} }), []],
    ['text does not match a number', JSON.stringify({ options: [{ text: 1 }, {}] }), []],
  ];
  for (const [rule, patterns, expected] of cases) {
    await assertPositions(
      api,
      `${activityPath}?parameters_json=${encodeURIComponent(patterns)}`,
      expected,
      `Expected that ${rule}`,
    );
  }
});

Deno.test('parameters_json compares numbers by the exact decimal value their text spells', async () => {
  const { api, activityPath, botApiPath } = await createFixture();
  // Sent as form text, which is recorded as it is, so that the numbers keep spellings JavaScript
  // would not keep.
  await callBotApiWithForm(api, `${botApiPath}/recordShapes`, {
    point:
      '{"x":1,"y":-0,"big":1e500,"small":-1e500,"id":9007199254740993,"ratio":0.30000000000000001}',
  });
  await callBotApiWithForm(api, `${botApiPath}/recordShapes`, {
    point: '{"big":1e400,"small":-1e400,"id":9007199254740992,"ratio":0.3}',
  });

  const cases: ReadonlyArray<readonly [string, readonly number[]]> = [
    ['{"point":{"x":1.0,"y":0}}', [1]],
    ['{"point":{"x":1e0,"y":-0.0}}', [1]],
    ['{"point":{"big":1e500}}', [1]],
    ['{"point":{"big":1e400}}', [2]],
    ['{"point":{"big":10e399}}', [2]],
    ['{"point":{"small":-1e400}}', [2]],
    ['{"point":{"small":1e400}}', []],
    ['{"point":{"id":9007199254740993}}', [1]],
    ['{"point":{"id":9007199254740992}}', [2]],
    ['{"point":{"ratio":0.3}}', [2]],
    ['{"point":{"ratio":0.30000000000000001}}', [1]],
  ];
  for (const [patterns, expected] of cases) {
    await assertPositions(
      api,
      `${activityPath}?parameters_json=${encodeURIComponent(patterns)}`,
      expected,
      `Expected ${patterns} to find ${JSON.stringify(expected)}`,
    );
  }
});

Deno.test('A parameter nested beyond the limit matches no pattern', async () => {
  const { api, activityPath, botApiPath } = await createFixture();
  const depth = 100_000;
  await callBotApiWithRawJsonBody(
    api,
    `${botApiPath}/recordShapes`,
    `{"deep":${'['.repeat(depth)}${']'.repeat(depth)}}`,
  );

  await assertPositions(
    api,
    `${activityPath}?parameters_json=${encodeURIComponent('{"deep":[[]]}')}`,
    [],
    'Expected a parameter nested beyond the limit to match no pattern',
  );
});

Deno.test('Text that looks like JSON is compared as text unless parameters_json asks', async () => {
  const { api, activityPath, botApiPath } = await createFixture();
  await callBotApiWithJson(api, `${botApiPath}/recordShapes`, { text: '{"a": 1}' });

  await assertPositions(
    api,
    `${activityPath}?parameters[text]=${encodeURIComponent('{"a":1}')}`,
    [],
    'Expected parameters[name] not to read text as JSON',
  );
  await assertPositions(
    api,
    `${activityPath}?parameters[text]=${encodeURIComponent('{"a": 1}')}`,
    [1],
    'Expected parameters[name] to match the exact text',
  );
  await assertPositions(
    api,
    `${activityPath}?${patternQuery({ text: { a: 1 } })}`,
    [1],
    'Expected parameters_json to read the parameter as JSON because it says so',
  );
});

Deno.test('parameters_json names parameters and members of any name as own members', async () => {
  const { api, activityPath, botApiPath } = await createFixture();
  await callBotApiWithRawJsonBody(
    api,
    `${botApiPath}/recordShapes`,
    '{"__proto__":{"constructor":1},"shape":{"__proto__":{"x":1}}}',
  );
  await callBotApiWithJson(api, `${botApiPath}/recordShapes`, { shape: {} });

  const cases: ReadonlyArray<readonly [string, readonly number[]]> = [
    ['{"__proto__":{"constructor":1}}', [1]],
    ['{"shape":{"__proto__":{"x":1}}}', [1]],
    ['{"shape":{"__proto__":{}}}', [1]],
    ['{"shape":{"constructor":{}}}', []],
    ['{"shape":{"toString":{}}}', []],
  ];
  for (const [patterns, expected] of cases) {
    await assertPositions(
      api,
      `${activityPath}?parameters_json=${encodeURIComponent(patterns)}`,
      expected,
      `Expected ${patterns} to find ${JSON.stringify(expected)}`,
    );
  }
});

Deno.test('parameters_json, even empty, matches only calls', async () => {
  const { api, activityPath, botApiPath, sendText } = await createFixture();
  await sendText('/start');
  await callBotApiWithJson(api, `${botApiPath}/getUpdates`, {});
  await callBotApiWithJson(api, `${botApiPath}/recordShapes`, { shape: {} });

  const { body } = await requestJson<BotActivityReadBody>(
    api,
    'GET',
    `${activityPath}?parameters_json=${encodeURIComponent('{}')}`,
  );
  if (body.entries.length !== 1 || body.entries[0].kind !== 'bot_api_call') {
    throw new Error(`Expected only the call to match: ${JSON.stringify(body.entries)}`);
  }
});

Deno.test('A malformed parameters_json is an issue at its place in the JSON', async () => {
  const { api, activityPath } = await createFixture();
  const cases: ReadonlyArray<
    readonly [string, ReadonlyArray<readonly [readonly (string | number)[], string]>]
  > = [
    ['{', [[['parameters_json'], 'invalid_json']]],
    // 101 levels: the outer object and 100 arrays, one more than the limit.
    [`{"p":${'['.repeat(100)}${']'.repeat(100)}}`, [[['parameters_json'], 'too_big']]],
    [`{"p":${'['.repeat(99)}${']'.repeat(99)}}`, []],
    ['', [[['parameters_json'], 'invalid_json']]],
    ['[]', [[['parameters_json'], 'invalid_type']]],
    ['null', [[['parameters_json'], 'invalid_type']]],
    ['"text"', [[['parameters_json'], 'invalid_type']]],
    ['{"text":"Hello"}', [[['parameters_json', 'text'], 'invalid_type']]],
    [
      '{"chat_id":5,"flag":true,"none":null,"ok":{}}',
      [
        [['parameters_json', 'chat_id'], 'invalid_type'],
        [['parameters_json', 'flag'], 'invalid_type'],
        [['parameters_json', 'none'], 'invalid_type'],
      ],
    ],
    ['{"a":{},"a":[]}', [[['parameters_json', 'a'], 'duplicate_field']]],
    ['{"a":{},"a":{},"a":{}}', [[['parameters_json', 'a'], 'duplicate_field']]],
    ['{"a":{"b":1,"b":2}}', [[['parameters_json', 'a', 'b'], 'duplicate_field']]],
    ['{"a":{"b":1,"\\u0062":2}}', [[['parameters_json', 'a', 'b'], 'duplicate_field']]],
    [
      '{"a":[{"b":1},[0,{"c":1,"c":2}]]}',
      [[['parameters_json', 'a', 1, 1, 'c'], 'duplicate_field']],
    ],
    ['{"a":{"x":"}\\"{,","x":1}}', [[['parameters_json', 'a', 'x'], 'duplicate_field']]],
    ['{"a":{"b":{},"c":{"b":1}}}', []],
    ['{"__proto__":{},"__proto__":{}}', [[['parameters_json', '__proto__'], 'duplicate_field']]],
    [
      '{"a":{},"a":{},"b":"text"}',
      [[['parameters_json', 'a'], 'duplicate_field'], [['parameters_json', 'b'], 'invalid_type']],
    ],
  ];
  for (const [patterns, expected] of cases) {
    await assertIssues(
      api,
      `${activityPath}?parameters_json=${encodeURIComponent(patterns)}`,
      expected,
    );
  }
});

Deno.test('A parameters_json issue is reported with the other issues of the query', async () => {
  const { api, activityPath } = await createFixture();

  await assertIssues(api, `${activityPath}?limit=-1&parameters_json=${encodeURIComponent('[')}`, [
    [['limit'], 'too_small'],
    [['parameters_json'], 'invalid_json'],
  ]);
  await assertIssues(api, `${activityPath}?parameters_json={}&parameters_json={}`, [
    [['parameters_json'], 'duplicate_field'],
  ]);
});

/** Creates a session holding a bot and an account that can message it. */
async function createFixture() {
  const { api, sessionPath } = await createTestSession();
  const createdBot = await requestJson<{ token: string; bot: { id: number } }>(
    api,
    'POST',
    `${sessionPath}/bots`,
    { first_name: 'Test Bot', username: 'test_bot' },
  );
  const createdAccount = await requestJson<{ account: { id: number } }>(
    api,
    'POST',
    `${sessionPath}/accounts`,
    { first_name: 'Ada' },
  );
  const account = createdAccount.body.account;
  const sendText = async (text: string) => {
    await requestJson(api, 'POST', `${sessionPath}/accounts/${account.id}/messages`, {
      to: { type: 'private', botId: createdBot.body.bot.id },
      text,
    });
  };
  return {
    api,
    activityPath: `${sessionPath}/bot-activity`,
    botApiPath: `${sessionPath}/bot-api/bot${createdBot.body.token}`,
    account,
    sendText,
  };
}

function patternQuery(patterns: Readonly<Record<string, unknown>>): string {
  return `parameters_json=${encodeURIComponent(JSON.stringify(patterns))}`;
}

async function callBotApiWithJson(
  api: EmulationApi,
  methodPath: string,
  parameters: Readonly<Record<string, unknown>>,
): Promise<void> {
  await callBotApiWithRawJsonBody(api, methodPath, JSON.stringify(parameters));
}

async function callBotApiWithRawJsonBody(
  api: EmulationApi,
  methodPath: string,
  body: string,
): Promise<void> {
  const response = await api.request(methodPath, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  });
  await response.body?.cancel();
}

async function callBotApiWithForm(
  api: EmulationApi,
  methodPath: string,
  parameters: Readonly<Record<string, string>>,
): Promise<void> {
  const response = await api.request(methodPath, {
    method: 'POST',
    body: new URLSearchParams(parameters),
  });
  await response.body?.cancel();
}

async function assertPositions(
  api: EmulationApi,
  path: string,
  expected: readonly number[],
  message: string,
): Promise<void> {
  const { status, body } = await requestJson<BotActivityReadBody>(api, 'GET', path);
  const positions = status === 200 ? body.entries.map(({ position }) => position) : status;
  if (JSON.stringify(positions) !== JSON.stringify(expected)) {
    throw new Error(`${message}: GET ${path} found ${JSON.stringify(positions)}`);
  }
}

/** Checks that a read is refused with exactly these issues of the query, or succeeds for none. */
async function assertIssues(
  api: EmulationApi,
  path: string,
  expected: ReadonlyArray<readonly [readonly (string | number)[], string]>,
): Promise<void> {
  const { status, body } = await requestJson<ControlValidationErrorBody>(api, 'GET', path);
  if (expected.length === 0) {
    if (status !== 200) {
      throw new Error(`Expected GET ${path} to succeed, received ${status}`);
    }
    return;
  }
  const issues = status === 400 && body.reason === 'invalid_request'
    ? body.issues.map(({ source, path, code }) => [source, path, code])
    : status;
  const expectedIssues = expected.map(([issuePath, code]) => ['query', issuePath, code]);
  if (JSON.stringify(issues) !== JSON.stringify(expectedIssues)) {
    throw new Error(
      `Expected GET ${path} to report ${JSON.stringify(expectedIssues)}, received ${
        JSON.stringify(issues)
      }`,
    );
  }
}
