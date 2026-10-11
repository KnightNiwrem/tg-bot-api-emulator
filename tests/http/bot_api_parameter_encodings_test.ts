/**
 * Bot API parameters sent in each request encoding: JSON written the same way is read and
 * recorded as the same text whether it arrives as a JSON body's member, a JSON body's string, a
 * form field, a multipart field or the query string, nested numbers included.
 */
import { type EmulationApi, requestJson } from '../support/emulation_api.ts';
import { botApiResult } from '../support/bot_api_requests.ts';
import { assertEqualsInFieldOrder } from '../support/field_order_assertion.ts';
import { createPrivateConversationFixture } from '../support/http_fixtures.ts';

/** A parameter as the bot spells it: JSON source text, or plain text such as a message's text. */
interface ParameterSpelling {
  readonly text: string;
  readonly isJson: boolean;
}

type ParameterSpellings = Readonly<Record<string, ParameterSpelling>>;

const REQUEST_ENCODINGS = [
  'JSON body members',
  'JSON body strings',
  'URL-encoded form',
  'multipart form',
  'query string',
] as const;

type RequestEncoding = typeof REQUEST_ENCODINGS[number];

interface BotApiCallEntryBody {
  readonly position: number;
  readonly parameters: Readonly<Record<string, string>>;
}

Deno.test('sendMessage reads reply_parameters and reply_markup alike in every encoding', async () => {
  await using fixture = await createPrivateConversationFixture();
  const { api, sessionPath, botApiPath, createdAccount, sendText } = fixture;
  await sendText('/start');
  const chatId = json(String(createdAccount.account.id));
  const question = await callInEncoding(api, `${botApiPath}/sendMessage`, 'JSON body members', {
    chat_id: chatId,
    text: plain('Continue?'),
  });
  const questionId = botApiResult(question.body)?.message_id;
  if (typeof questionId !== 'number') {
    throw new Error(`Expected the question to be sent, received ${JSON.stringify(question)}`);
  }
  const replyParameters = `{"message_id": ${questionId}, "allow_sending_without_reply": false}`;
  const inlineKeyboard = [
    [{ text: 'Yes', callback_data: 'yes' }],
    [{ text: 'Docs', url: 'https://grammy.dev/' }],
  ];
  const replyMarkup = '{"inline_keyboard": [[{"text": "Yes", "callback_data": "yes"}], ' +
    '[{"text": "Docs", "url": "https://grammy.dev/"}]]}';

  for (const encoding of REQUEST_ENCODINGS) {
    const { status, body } = await callInEncoding(api, `${botApiPath}/sendMessage`, encoding, {
      chat_id: chatId,
      text: plain(`Yes, in ${encoding}`),
      reply_parameters: json(replyParameters),
      reply_markup: json(replyMarkup),
    });
    const sentMessage = botApiResult(body);
    const repliedMessage = sentMessage?.reply_to_message as Record<string, unknown> | undefined;
    if (
      status !== 200 ||
      repliedMessage?.message_id !== questionId
    ) {
      throw new Error(
        `Expected a reply with the keyboard from ${encoding}, received ${status} ` +
          JSON.stringify(body),
      );
    }
    assertEqualsInFieldOrder(
      sentMessage?.reply_markup,
      { inline_keyboard: inlineKeyboard },
      `Expected a reply with the keyboard from ${encoding}, received ${status} ` +
        JSON.stringify(body),
    );
  }

  const recordedReplies = (await readCallEntries(api, sessionPath, 'sendMessage')).slice(1);
  if (recordedReplies.length !== REQUEST_ENCODINGS.length) {
    throw new Error(`Expected a recorded reply per encoding, found ${recordedReplies.length}`);
  }
  for (const { parameters } of recordedReplies) {
    if (
      parameters.reply_parameters !== replyParameters || parameters.reply_markup !== replyMarkup
    ) {
      throw new Error(
        `Expected the JSON as the bot spelled it, received ${JSON.stringify(parameters)}`,
      );
    }
  }
});

Deno.test('A nested number too large to be finite fails alike in every encoding', async () => {
  await using fixture = await createPrivateConversationFixture();
  const { api, sessionPath, botApiPath, createdAccount, sendText } = fixture;
  await sendText('/start');
  const replyParameters = '{"message_id": 1e500}';

  const answers = new Set<string>();
  for (const encoding of REQUEST_ENCODINGS) {
    const { status, body } = await callInEncoding(api, `${botApiPath}/sendMessage`, encoding, {
      chat_id: json(String(createdAccount.account.id)),
      text: plain('Unsent'),
      reply_parameters: json(replyParameters),
    });
    answers.add(JSON.stringify([status, body]));
  }
  const [answer] = answers;
  if (answers.size !== 1 || !answer.startsWith('[400,')) {
    throw new Error(`Expected one Bad Request answer, received ${[...answers].join(' and ')}`);
  }

  const recordedParameters = (await readCallEntries(api, sessionPath, 'sendMessage')).map((
    { parameters },
  ) => parameters.reply_parameters);
  assertEqualsInFieldOrder(
    recordedParameters,
    REQUEST_ENCODINGS.map(() => replyParameters),
    'Expected 1e500 recorded as sent',
  );
});

Deno.test('Bot activity finds nested numbers a JSON body sent by their exact value', async () => {
  await using fixture = await createPrivateConversationFixture();
  const { api, sessionPath, botApiPath } = fixture;
  const exactPoint = '{"x": 1.0, "big": 1e500, "id": 9007199254740993}';
  await callInEncoding(api, `${botApiPath}/recordParameters`, 'JSON body members', {
    point: json(exactPoint),
  });
  await callInEncoding(api, `${botApiPath}/recordParameters`, 'JSON body members', {
    point: json('{"x": 1, "big": 1e400, "id": 9007199254740992}'),
  });

  const activityPath = `${sessionPath}/bot-activity`;
  const cases: ReadonlyArray<readonly [string, readonly number[]]> = [
    [`parameters[point]=${encodeURIComponent(exactPoint)}`, [1]],
    [patternQuery('{"point":{"x":1}}'), [1, 2]],
    [patternQuery('{"point":{"big":1e500}}'), [1]],
    [patternQuery('{"point":{"big":1e400}}'), [2]],
    [patternQuery('{"point":{"id":9007199254740993}}'), [1]],
    [patternQuery('{"point":{"id":9007199254740992}}'), [2]],
  ];
  for (const [query, expected] of cases) {
    const { status, body } = await requestJson<{ entries: BotApiCallEntryBody[] }>(
      api,
      'GET',
      `${activityPath}?kind=bot_api_call&${query}`,
    );
    const positions = status === 200 ? body.entries.map(({ position }) => position) : status;
    assertEqualsInFieldOrder(
      positions,
      expected,
      `Expected ${query} to find ${expected}, found ${JSON.stringify(positions)}`,
    );
  }
});

function json(text: string): ParameterSpelling {
  return { text, isJson: true };
}

function plain(text: string): ParameterSpelling {
  return { text, isJson: false };
}

function patternQuery(patterns: string): string {
  return `parameters_json=${encodeURIComponent(patterns)}`;
}

/** Calls a Bot API method with its parameters in the encoding, and answers its status and body. */
async function callInEncoding(
  api: EmulationApi,
  methodPath: string,
  encoding: RequestEncoding,
  spellings: ParameterSpellings,
): Promise<{ status: number; body: unknown }> {
  const texts = Object.fromEntries(
    Object.entries(spellings).map(([name, { text }]) => [name, text]),
  );
  const response = await api.request(...botApiRequest(methodPath, encoding, spellings, texts));
  return { status: response.status, body: await response.json() };
}

function botApiRequest(
  methodPath: string,
  encoding: RequestEncoding,
  spellings: ParameterSpellings,
  texts: Readonly<Record<string, string>>,
): [string, RequestInit] {
  switch (encoding) {
    case 'JSON body members': {
      const members = Object.entries(spellings).map(([name, { text, isJson }]) =>
        `${JSON.stringify(name)}: ${isJson ? text : JSON.stringify(text)}`
      );
      return [methodPath, jsonBodyRequest(`{${members.join(', ')}}`)];
    }
    case 'JSON body strings':
      return [methodPath, jsonBodyRequest(JSON.stringify(texts))];
    case 'URL-encoded form':
      return [methodPath, { method: 'POST', body: new URLSearchParams(texts) }];
    case 'multipart form': {
      const body = new FormData();
      for (const [name, text] of Object.entries(texts)) {
        body.append(name, text);
      }
      return [methodPath, { method: 'POST', body }];
    }
    case 'query string':
      return [`${methodPath}?${new URLSearchParams(texts)}`, { method: 'GET' }];
  }
}

function jsonBodyRequest(body: string): RequestInit {
  return { method: 'POST', headers: { 'Content-Type': 'application/json' }, body };
}

async function readCallEntries(
  api: EmulationApi,
  sessionPath: string,
  method: string,
): Promise<readonly BotApiCallEntryBody[]> {
  const { status, body } = await requestJson<{ entries: BotApiCallEntryBody[] }>(
    api,
    'GET',
    `${sessionPath}/bot-activity?kind=bot_api_call&method=${method}`,
  );
  if (status !== 200) {
    throw new Error(`Expected to read the ${method} calls, received ${status}`);
  }
  return body.entries;
}
