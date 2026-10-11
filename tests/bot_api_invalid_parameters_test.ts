import { assertEquals } from '@std/assert';
import { createTestSession, type EmulationApi } from './support/emulation_api.ts';
import { createBot } from './support/http_fixtures.ts';

const keyboardWithActionlessButton = JSON.stringify({
  inline_keyboard: [[{ text: 'Yes', callback_data: 'yes' }, { text: 'No' }]],
});

Deno.test('the editing methods name the parameter that does not fit their schema', async () => {
  const { api, botApiPath } = await createFixture();
  const cases: readonly [method: string, parameters: object, description: string][] = [
    [
      'editMessageText',
      { chat_id: 1, message_id: 1, text: 'Hi', disable_web_page_preview_now: true },
      'Bad Request: invalid editMessageText parameters: disable_web_page_preview_now',
    ],
    [
      'editMessageText',
      { chat_id: 1, message_id: 1, text: 'Hi', 'odd key': 1, other_key: 2 },
      'Bad Request: invalid editMessageText parameters: ["odd key"]',
    ],
    [
      'editMessageCaption',
      { chat_id: 'secret-chat', message_id: 1, caption: 'Hi' },
      'Bad Request: invalid editMessageCaption parameters: chat_id',
    ],
    [
      'editMessageReplyMarkup',
      { chat_id: 1, message_id: 1, reply_markup: keyboardWithActionlessButton },
      'Bad Request: invalid editMessageReplyMarkup parameters: reply_markup.inline_keyboard[0][1]',
    ],
    [
      'editMessageReplyMarkup',
      { chat_id: 1, message_id: 1, reply_markup: { inline_keyboard: [], resize_keyboard: true } },
      'Bad Request: invalid editMessageReplyMarkup parameters: reply_markup.resize_keyboard',
    ],
    [
      'editMessageMedia',
      { chat_id: 1, message_id: 1, reply_markup: 'not JSON' },
      "Bad Request: can't parse reply keyboard markup JSON object",
    ],
    [
      'stopPoll',
      { chat_id: 1, message_id: 1, open_period: 5 },
      'Bad Request: invalid stopPoll parameters: open_period',
    ],
  ];

  const answers = [];
  for (const [method, parameters] of cases) {
    answers.push(await callBotApi(api, `${botApiPath}/${method}`, parameters));
  }
  assertEquals(
    answers,
    cases.map(([, , description]) => [400, description]),
    'Expected each refusal to name the first offending parameter path, without its value',
  );
});

Deno.test('the forward and copy methods name the parameter that does not fit their schema', async () => {
  const { api, botApiPath } = await createFixture();
  const cases: readonly [method: string, parameters: object, description: string][] = [
    [
      'forwardMessage',
      { chat_id: 1, from_chat_id: 1, message_id: 1, reply_markup: '{}' },
      'Bad Request: invalid forwardMessage parameters: reply_markup',
    ],
    [
      'copyMessage',
      { chat_id: 1, from_chat_id: 'secret-chat', message_id: 1 },
      'Bad Request: invalid copyMessage parameters: from_chat_id',
    ],
    [
      'forwardMessages',
      { chat_id: 1, from_chat_id: 1, message_ids: [1, 'secret'] },
      'Bad Request: invalid forwardMessages parameters: message_ids[1]',
    ],
    [
      'copyMessages',
      { chat_id: 1, from_chat_id: 1, message_ids: [1], remove_caption: 'secret' },
      'Bad Request: invalid copyMessages parameters: remove_caption',
    ],
  ];

  const answers = [];
  for (const [method, parameters] of cases) {
    answers.push(await callBotApi(api, `${botApiPath}/${method}`, parameters));
  }
  assertEquals(
    answers,
    cases.map(([, , description]) => [400, description]),
    'Expected each refusal to name the first offending parameter path, without its value',
  );
});

Deno.test('parameters a reader refuses after the schema keep the description without a path', async () => {
  const { api, botApiPath } = await createFixture();
  // `media` is text to the schema; its reader refuses JSON it cannot read.
  const answer = await callBotApi(api, `${botApiPath}/editMessageMedia`, {
    chat_id: 1,
    message_id: 1,
    media: JSON.stringify({ type: 'document', media: 'attach://file', has_spoiler: true }),
  });
  assertEquals(
    answer,
    [400, 'Bad Request: invalid editMessageMedia parameters'],
    'Expected the reader to keep its description',
  );
  // Caption entities are a list to the schema; their reader refuses an offset written as text.
  const copyAnswer = await callBotApi(api, `${botApiPath}/copyMessage`, {
    chat_id: 1,
    from_chat_id: 1,
    message_id: 1,
    caption: 'Hi',
    caption_entities: [{ type: 'bold', offset: '0', length: 2 }],
  });
  assertEquals(
    copyAnswer,
    [400, 'Bad Request: invalid copyMessage parameters'],
    'Expected the caption reader to keep its description',
  );
});

Deno.test('the chat information methods name the parameter that does not fit their schema', async () => {
  const { api, botApiPath } = await createFixture();
  const cases: readonly [method: string, parameters: object, description: string][] = [
    ['getChat', { chat_id: 'secret-chat' }, 'Bad Request: invalid getChat parameters: chat_id'],
    ['getChat', {}, 'Bad Request: chat_id is empty'],
    [
      'setChatTitle',
      { chat_id: 1, title: 'Team', photo: 'secret' },
      'Bad Request: invalid setChatTitle parameters: photo',
    ],
    ['setChatTitle', { title: 'Team' }, 'Bad Request: chat_id is empty'],
    [
      'setChatDescription',
      { chat_id: 1, description: 'About', 'odd key': 1 },
      'Bad Request: invalid setChatDescription parameters: ["odd key"]',
    ],
    [
      'setChatPermissions',
      { chat_id: 1, use_independent_chat_permissions: 'secret' },
      'Bad Request: invalid setChatPermissions parameters: use_independent_chat_permissions',
    ],
    // The permissions are read before the chat, and a field they do not know has no path.
    [
      'setChatPermissions',
      { permissions: { can_send_stickers: true } },
      'Bad Request: invalid setChatPermissions parameters',
    ],
    ['setChatPermissions', { permissions: {} }, 'Bad Request: chat_id is empty'],
  ];

  const answers = [];
  for (const [method, parameters] of cases) {
    answers.push(await callBotApi(api, `${botApiPath}/${method}`, parameters));
  }
  assertEquals(
    answers,
    cases.map(([, , description]) => [400, description]),
    'Expected each refusal from the first step that refuses, naming a schema path without its value',
  );
});

/** Creates a session holding a bot. */
async function createFixture() {
  const { api, sessionPath } = await createTestSession();
  const { botApiPath } = await createBot(api, sessionPath, 'test_bot');
  return { api, botApiPath };
}

/** Calls a Bot API method with JSON parameters, answering with the status and description. */
async function callBotApi(
  api: EmulationApi,
  path: string,
  parameters: object,
): Promise<readonly [number, string | undefined]> {
  const response = await api.request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(parameters),
  });
  const answer = await response.json() as { readonly description?: string };
  return [response.status, answer.description];
}
