/**
 * JSON nested beyond the official Bot API server's 100-level limit, which TDLib's `do_json_skip`
 * applies to a JSON body's members and its `json_decode` to every JSON-typed parameter: a value
 * may sit within at most 100 arrays and objects, and an empty array or object one level deeper
 * still passes.
 */
import { assertEquals } from '@std/assert';

import { type EmulationApi, requestJson } from '../support/emulation_api.ts';
import { createPrivateConversationFixture } from '../support/http_fixtures.ts';

const TOO_BIG_OBJECT_DEPTH_DESCRIPTION =
  "Bad Request: can't parse parameter value: Too big object depth";
const UNPARSABLE_REPLY_MARKUP_DESCRIPTION =
  "Bad Request: can't parse reply keyboard markup JSON object";

/** JSON text that holds `innermost` within `depth` nested arrays. */
function nestedArrays(depth: number, innermost = '1'): string {
  return `${'['.repeat(depth)}${innermost}${']'.repeat(depth)}`;
}

/** JSON text that holds `innermost` within `depth` nested objects, each with one member. */
function nestedObjects(depth: number, innermost = '1'): string {
  return `${'{"a":'.repeat(depth)}${innermost}${'}'.repeat(depth)}`;
}

interface BotApiAnswer {
  readonly status: number;
  readonly description?: string;
}

interface RecordedCall {
  readonly method: string;
  readonly parameters: Readonly<Record<string, string>>;
  readonly answer: { readonly ok: boolean; readonly error_code?: number };
}

Deno.test('a JSON body member nested beyond 100 levels is refused, at the exact boundary', async () => {
  await using fixture = await createPrivateConversationFixture();
  const { api, botApiPath, createdAccount, sendText } = fixture;
  await sendText('/start');
  const chatId = createdAccount.account.id;
  // `text` is plain text to `sendMessage`, which sends a member's source text as it is.
  const cases: ReadonlyArray<readonly [label: string, text: string, expected: BotApiAnswer]> = [
    ['a scalar within 100 arrays', nestedArrays(100), { status: 200 }],
    ['a scalar within 101 arrays', nestedArrays(101), refusedAsTooDeep()],
    ['an empty array within 100 arrays', nestedArrays(100, '[]'), { status: 200 }],
    ['a scalar within 100 objects', nestedObjects(100), { status: 200 }],
    ['a scalar within 101 objects', nestedObjects(101), refusedAsTooDeep()],
    ['an empty object within 100 objects', nestedObjects(100, '{}'), { status: 200 }],
    ['an empty object within 100 arrays', nestedArrays(100, '{}'), { status: 200 }],
    [
      'a scalar within 101 mixed containers',
      nestedArrays(51, nestedObjects(50)),
      refusedAsTooDeep(),
    ],
    ['a string within 101 arrays', nestedArrays(101, '"deep"'), refusedAsTooDeep()],
    ['a scalar within 100,000 arrays', nestedArrays(100_000), refusedAsTooDeep()],
  ];

  const answers = [];
  for (const [, text] of cases) {
    answers.push(
      await postJsonBody(api, `${botApiPath}/sendMessage`, {
        chat_id: String(chatId),
        text,
      }),
    );
  }
  assertEquals(
    answers,
    cases.map(([, , expected]) => expected),
    `Expected each member to be read or refused by its depth: ${cases.map(([label]) => label)}`,
  );
});

Deno.test('a JSON body string member is not limited by the depth of the JSON it holds', async () => {
  await using fixture = await createPrivateConversationFixture();
  const { api, botApiPath, createdAccount, sendText } = fixture;
  await sendText('/start');
  const text = nestedArrays(101);
  const answer = await postJsonBody(api, `${botApiPath}/sendMessage`, {
    chat_id: String(createdAccount.account.id),
    text: JSON.stringify(text),
  });
  assertEquals(answer, { status: 200 }, 'Expected the string to be sent as its content');
});

Deno.test('a JSON body refused for its depth is recorded without parameters', async () => {
  await using fixture = await createPrivateConversationFixture();
  const { api, sessionPath, botApiPath, createdAccount, sendText } = fixture;
  await sendText('/start');
  const answer = await postJsonBody(api, `${botApiPath}/sendMessage`, {
    chat_id: String(createdAccount.account.id),
    text: nestedObjects(101),
  });

  assertEquals(
    [answer, await readRecordedCalls(api, sessionPath)],
    [
      refusedAsTooDeep(),
      [{ method: 'sendMessage', parameters: {}, answer: { ok: false, error_code: 400 } }],
    ],
    'Expected the refused call to be recorded like any other undecodable call',
  );
});

Deno.test('reply_markup nested beyond 100 levels is refused in every encoding', async () => {
  await using fixture = await createPrivateConversationFixture();
  const { api, botApiPath, createdAccount, sendText } = fixture;
  await sendText('/start');
  const chatId = String(createdAccount.account.id);
  const methodPath = `${botApiPath}/sendMessage`;
  // Within the limit, the markup is JSON that is no keyboard, so the method's schema refuses it.
  const cases: ReadonlyArray<readonly [replyMarkup: string, description: string]> = [
    [nestedArrays(100), 'Bad Request: invalid sendMessage parameters'],
    [nestedArrays(101), UNPARSABLE_REPLY_MARKUP_DESCRIPTION],
    [nestedObjects(101), UNPARSABLE_REPLY_MARKUP_DESCRIPTION],
    ['not JSON', UNPARSABLE_REPLY_MARKUP_DESCRIPTION],
  ];

  const answers = [];
  const expectedAnswers = [];
  for (const [replyMarkup, description] of cases) {
    const parameters = { chat_id: chatId, text: 'Unsent', reply_markup: replyMarkup };
    answers.push(
      await postJsonBody(api, methodPath, {
        chat_id: chatId,
        text: JSON.stringify('Unsent'),
        reply_markup: JSON.stringify(replyMarkup),
      }),
      await postForm(api, methodPath, parameters),
      await postMultipart(api, methodPath, parameters),
      await getWithQuery(api, methodPath, parameters),
    );
    expectedAnswers.push(...Array.from({ length: 4 }, () => ({ status: 400, description })));
  }
  assertEquals(
    answers,
    expectedAnswers,
    'Expected a JSON body string, a form field, a multipart field and the query string alike',
  );

  // As a JSON body's array member, the markup is refused before the method reads it.
  assertEquals(
    [
      await postJsonBody(api, methodPath, {
        chat_id: chatId,
        text: JSON.stringify('Unsent'),
        reply_markup: nestedArrays(100),
      }),
      await postJsonBody(api, methodPath, {
        chat_id: chatId,
        text: JSON.stringify('Unsent'),
        reply_markup: nestedArrays(101),
      }),
    ],
    [
      { status: 400, description: 'Bad Request: invalid sendMessage parameters' },
      refusedAsTooDeep(),
    ],
    'Expected the body member beyond the limit to be refused as the body',
  );
});

Deno.test("reply_markup of an edit nested beyond 100 levels gets Telegram's description", async () => {
  await using fixture = await createPrivateConversationFixture();
  const { api, botApiPath, createdAccount, sendText } = fixture;
  await sendText('/start');
  const parameters = { chat_id: String(createdAccount.account.id), message_id: '1' };
  const methodPath = `${botApiPath}/editMessageReplyMarkup`;

  assertEquals(
    [
      await postForm(api, methodPath, { ...parameters, reply_markup: nestedArrays(100) }),
      await postForm(api, methodPath, { ...parameters, reply_markup: nestedArrays(101) }),
    ],
    [
      {
        status: 400,
        description: 'Bad Request: invalid editMessageReplyMarkup parameters: reply_markup',
      },
      { status: 400, description: UNPARSABLE_REPLY_MARKUP_DESCRIPTION },
    ],
    'Expected only the markup beyond the limit to be refused as unparsable',
  );
});

Deno.test('each JSON-typed parameter reader refuses JSON nested beyond 100 levels', async () => {
  await using fixture = await createPrivateConversationFixture();
  const { api, botApiPath, createdAccount, sendText } = fixture;
  await sendText('/start');
  const chatId = String(createdAccount.account.id);
  const tooDeep = nestedArrays(101);
  const cases: ReadonlyArray<
    readonly [method: string, parameters: Readonly<Record<string, string>>, description: string]
  > = [
    [
      'setChatMenuButton',
      { menu_button: tooDeep },
      "Bad Request: can't parse menu button JSON object",
    ],
    [
      'setMyDefaultAdministratorRights',
      { rights: tooDeep },
      "Bad Request: can't parse ChatAdministratorRights JSON object",
    ],
    [
      'setMessageReaction',
      { chat_id: chatId, message_id: '1', reaction: tooDeep },
      "Bad Request: can't parse reaction types JSON object",
    ],
    [
      'sendMediaGroup',
      { chat_id: chatId, media: tooDeep },
      "Bad Request: can't parse media JSON object",
    ],
    [
      'editMessageMedia',
      { chat_id: chatId, message_id: '1', media: tooDeep },
      "Bad Request: can't parse input media JSON object",
    ],
    [
      'sendPoll',
      { chat_id: chatId, question: 'Which?', options: tooDeep },
      "Bad Request: can't parse options JSON object",
    ],
    [
      'sendPoll',
      {
        chat_id: chatId,
        question: 'Which?',
        options: '["A", "B"]',
        type: 'quiz',
        correct_option_ids: tooDeep,
      },
      "Bad Request: can't parse correct option identifiers JSON object",
    ],
    [
      'sendRichMessage',
      { chat_id: chatId, rich_message: tooDeep },
      "Bad Request: can't parse rich message JSON object",
    ],
  ];

  const answers = [];
  for (const [method, parameters] of cases) {
    answers.push(await postForm(api, `${botApiPath}/${method}`, parameters));
  }
  assertEquals(
    answers,
    cases.map(([, , description]) => ({ status: 400, description })),
    'Expected each reader to refuse the JSON with its own description',
  );
});

function refusedAsTooDeep(): BotApiAnswer {
  return { status: 400, description: TOO_BIG_OBJECT_DEPTH_DESCRIPTION };
}

/**
 * Posts a JSON body whose members are written as given: a parameter's text is its member's source
 * text, so `chat_id: '1'` is the number 1 and `text: '"Hi"'` the string `Hi`.
 */
function postJsonBody(
  api: EmulationApi,
  methodPath: string,
  memberSources: Readonly<Record<string, string>>,
): Promise<BotApiAnswer> {
  const members = Object.entries(memberSources).map(([name, source]) =>
    `${JSON.stringify(name)}:${source}`
  );
  return readAnswer(api.request(methodPath, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: `{${members.join(',')}}`,
  }));
}

function postForm(
  api: EmulationApi,
  methodPath: string,
  parameters: Readonly<Record<string, string>>,
): Promise<BotApiAnswer> {
  return readAnswer(
    api.request(methodPath, { method: 'POST', body: new URLSearchParams(parameters) }),
  );
}

function postMultipart(
  api: EmulationApi,
  methodPath: string,
  parameters: Readonly<Record<string, string>>,
): Promise<BotApiAnswer> {
  const body = new FormData();
  for (const [name, text] of Object.entries(parameters)) {
    body.append(name, text);
  }
  return readAnswer(api.request(methodPath, { method: 'POST', body }));
}

function getWithQuery(
  api: EmulationApi,
  methodPath: string,
  parameters: Readonly<Record<string, string>>,
): Promise<BotApiAnswer> {
  return readAnswer(api.request(`${methodPath}?${new URLSearchParams(parameters)}`));
}

/** The status of a Bot API answer, with its description if it is an error. */
async function readAnswer(responsePromise: Response | Promise<Response>): Promise<BotApiAnswer> {
  const response = await responsePromise;
  const body = await response.json() as { readonly ok: boolean; readonly description?: string };
  return body.ok
    ? { status: response.status }
    : { status: response.status, description: body.description };
}

async function readRecordedCalls(
  api: EmulationApi,
  sessionPath: string,
): Promise<readonly RecordedCall[]> {
  const { status, body } = await requestJson<{ entries: RecordedCall[] }>(
    api,
    'GET',
    `${sessionPath}/bot-activity?kind=bot_api_call`,
  );
  if (status !== 200) {
    throw new Error(`Expected the bot activity to be read, received ${status}`);
  }
  return body.entries.map(({ method, parameters, answer }) => ({
    method,
    parameters,
    answer: { ok: answer.ok, error_code: answer.error_code },
  }));
}
