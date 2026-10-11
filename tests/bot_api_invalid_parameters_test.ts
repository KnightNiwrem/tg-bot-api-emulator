import { assertEquals } from '@std/assert';
import { createTestSession, type EmulationApi } from './support/emulation_api.ts';
import { createBot } from './support/http_fixtures.ts';

const keyboardWithActionlessButton = JSON.stringify({
  inline_keyboard: [[{ text: 'Yes', callback_data: 'yes' }, { text: 'No' }]],
});

Deno.test('the editing methods name the parameter that does not fit their schema', async () => {
  await using fixture = await createFixture();
  const { api, botApiPath } = fixture;
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
  await using fixture = await createFixture();
  const { api, botApiPath } = fixture;
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

Deno.test('the forward and copy methods give the official server descriptions for JSON parameters', async () => {
  const { api, botApiPath } = await createFixture();
  const notSpecified = 'Bad Request: message identifiers are not specified';
  const cases: readonly [method: string, parameters: object, description: string][] = [
    [
      'forwardMessages',
      { chat_id: 1, from_chat_id: 1, message_ids: 'not JSON' },
      "Bad Request: can't parse message_ids JSON object",
    ],
    [
      'copyMessages',
      { chat_id: 1, from_chat_id: 1, message_ids: `${'['.repeat(101)}1${']'.repeat(101)}` },
      "Bad Request: can't parse message_ids JSON object",
    ],
    // Empty text names no messages, as the official server reads it, and so does an empty list.
    ['forwardMessages', { chat_id: 1, from_chat_id: 1, message_ids: '' }, notSpecified],
    ['copyMessages', { chat_id: 1, from_chat_id: 1, message_ids: [] }, notSpecified],
    [
      'copyMessage',
      { chat_id: 1, from_chat_id: 1, message_id: 1, reply_parameters: 'not JSON' },
      "Bad Request: can't parse reply parameters JSON object",
    ],
    // Empty text is no reply, as the official server reads it, so the chat is read next.
    [
      'copyMessage',
      { from_chat_id: 1, message_id: 1, reply_parameters: '' },
      'Bad Request: chat_id is empty',
    ],
  ];

  const answers = [];
  for (const [method, parameters] of cases) {
    answers.push(await callBotApi(api, `${botApiPath}/${method}`, parameters));
  }
  assertEquals(
    answers,
    cases.map(([, , description]) => [400, description]),
    "Expected Telegram's description for JSON it cannot read, and empty text read as none",
  );
});

Deno.test('parameters a reader refuses after the schema keep the description without a path', async () => {
  await using fixture = await createFixture();
  const { api, botApiPath } = fixture;
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
  await using fixture = await createFixture();
  const { api, botApiPath } = fixture;
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

Deno.test('getFile names the parameter that does not fit its schema, then requires a file', async () => {
  await using fixture = await createFixture();
  const { api, botApiPath } = fixture;
  const cases: readonly [parameters: object, description: string][] = [
    [
      { file_id: 'secret', file_path: 'secret' },
      'Bad Request: invalid getFile parameters: file_path',
    ],
    [{}, 'Bad Request: file_id not specified'],
    [{ file_id: '' }, 'Bad Request: file_id not specified'],
  ];

  const answers = [];
  for (const [parameters] of cases) {
    answers.push(await callBotApi(api, `${botApiPath}/getFile`, parameters));
  }
  assertEquals(
    answers,
    cases.map(([, description]) => [400, description]),
    'Expected the schema to be read before the file is required',
  );
});

Deno.test('the update delivery methods name the parameter that does not fit their schema', async () => {
  await using fixture = await createFixture();
  const { api, botApiPath } = fixture;
  const cases: readonly [method: string, parameters: object, description: string][] = [
    ['getUpdates', { limit: 101 }, 'Bad Request: invalid getUpdates parameters: limit'],
    [
      'getUpdates',
      { allowed_updates: ['message', 1] },
      'Bad Request: invalid getUpdates parameters: allowed_updates[1]',
    ],
    ['getWebhookInfo', { url: 'secret' }, 'Bad Request: invalid getWebhookInfo parameters: url'],
    [
      'deleteWebhook',
      { drop_pending_updates: 'secret' },
      'Bad Request: invalid deleteWebhook parameters: drop_pending_updates',
    ],
    [
      'setWebhook',
      { url: 'https://bot.example/webhook', allowed_updates: 'secret' },
      'Bad Request: invalid setWebhook parameters: allowed_updates',
    ],
    // An IP address is refused before a certificate, and both before the webhook's URL is read.
    [
      'setWebhook',
      { url: 'ftp://bot.example', ip_address: '203.0.113.1', certificate: 'attach://file' },
      'Bad Request: webhook IP addresses are not supported',
    ],
    [
      'setWebhook',
      { url: 'ftp://bot.example', certificate: 'attach://file' },
      'Bad Request: custom webhook certificates are not supported',
    ],
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

Deno.test('the bot settings methods name the parameter that does not fit their schema', async () => {
  await using fixture = await createFixture();
  const { api, botApiPath } = fixture;
  const cases: readonly [method: string, parameters: object, description: string][] = [
    ['getMe', { secret: 1 }, 'Bad Request: invalid getMe parameters: secret'],
    [
      'getMyDefaultAdministratorRights',
      { for_channels: 'secret' },
      'Bad Request: invalid getMyDefaultAdministratorRights parameters: for_channels',
    ],
    [
      'setMyShortDescription',
      { short_description: 'Hi', description: 'Hi' },
      'Bad Request: invalid setMyShortDescription parameters: description',
    ],
    [
      'setChatMenuButton',
      { chat_id: 'secret', menu_button: { type: 'commands' } },
      'Bad Request: invalid setChatMenuButton parameters: chat_id',
    ],
    // A scope's chat ID written as text is refused by the scope's reader, without a path.
    [
      'getMyCommands',
      { scope: { type: 'chat', chat_id: '1' } },
      'Bad Request: invalid getMyCommands parameters',
    ],
  ];

  const answers = [];
  for (const [method, parameters] of cases) {
    answers.push(await callBotApi(api, `${botApiPath}/${method}`, parameters));
  }
  assertEquals(
    answers,
    cases.map(([, , description]) => [400, description]),
    'Expected a schema refusal to name its path, and a reader refusal to keep its description',
  );
});

Deno.test('the query answer methods name the parameter that does not fit their schema', async () => {
  await using fixture = await createFixture();
  const { api, botApiPath } = fixture;
  const unparsableButton = "Bad Request: can't parse inline query results button JSON object";
  const cases: readonly [method: string, parameters: object, description: string][] = [
    [
      'answerCallbackQuery',
      { callback_query_id: '1', text: 'x'.repeat(201) },
      'Bad Request: invalid answerCallbackQuery parameters: text',
    ],
    [
      'answerInlineQuery',
      { inline_query_id: '1', results: [], is_personal: 'secret' },
      'Bad Request: invalid answerInlineQuery parameters: is_personal',
    ],
    ['answerInlineQuery', { inline_query_id: '1', button: 'not JSON' }, unparsableButton],
    [
      'answerInlineQuery',
      { inline_query_id: '1', button: `${'['.repeat(101)}1${']'.repeat(101)}` },
      unparsableButton,
    ],
    // The official server reads the button before the results.
    [
      'answerInlineQuery',
      { inline_query_id: '1', button: 'not JSON', results: 'not JSON' },
      unparsableButton,
    ],
    [
      'answerInlineQuery',
      { inline_query_id: '1', button: { text: 'Go' } },
      'Bad Request: invalid answerInlineQuery parameters: button',
    ],
    // Empty text is no button, as the official server reads it, so the results are read next.
    [
      'answerInlineQuery',
      { inline_query_id: '1', button: '', results: 'not JSON' },
      'Bad Request: invalid answerInlineQuery parameters: results',
    ],
  ];

  const answers = [];
  for (const [method, parameters] of cases) {
    answers.push(await callBotApi(api, `${botApiPath}/${method}`, parameters));
  }
  assertEquals(
    answers,
    cases.map(([, , description]) => [400, description]),
    "Expected a schema refusal to name its path, or to give Telegram's own description",
  );
});

Deno.test('the deletion and reaction methods name the parameter that does not fit their schema', async () => {
  const { api, botApiPath } = await createFixture();
  const unparsableMessageIds = "Bad Request: can't parse message_ids JSON object";
  const cases: readonly [method: string, parameters: object, description: string][] = [
    [
      'deleteMessage',
      { chat_id: 1, message_id: 'secret' },
      'Bad Request: invalid deleteMessage parameters: message_id',
    ],
    [
      'deleteMessages',
      { chat_id: 'secret-chat', message_ids: [1] },
      'Bad Request: invalid deleteMessages parameters: chat_id',
    ],
    ['deleteMessages', { chat_id: 1, message_ids: 'not JSON' }, unparsableMessageIds],
    [
      'deleteMessages',
      { chat_id: 1, message_ids: `${'['.repeat(101)}1${']'.repeat(101)}` },
      unparsableMessageIds,
    ],
    // Empty text names no messages, as the official server reads it.
    [
      'deleteMessages',
      { chat_id: 1, message_ids: '' },
      'Bad Request: message identifiers are not specified',
    ],
    [
      'setMessageReaction',
      { chat_id: 1, message_id: 1, is_big: 'secret' },
      'Bad Request: invalid setMessageReaction parameters: is_big',
    ],
  ];

  const answers = [];
  for (const [method, parameters] of cases) {
    answers.push(await callBotApi(api, `${botApiPath}/${method}`, parameters));
  }
  assertEquals(
    answers,
    cases.map(([, , description]) => [400, description]),
    "Expected a schema refusal to name its path, or to give Telegram's own description",
  );
});

Deno.test('link_preview_options that is not JSON gets the official server description', async () => {
  const { api, botApiPath } = await createFixture();
  const unparsableOptions = "Bad Request: can't parse link preview options JSON object";
  const cases: readonly [method: string, parameters: object, description: string][] = [
    [
      'editMessageText',
      { chat_id: 1, message_id: 1, text: 'Hi', link_preview_options: 'not JSON' },
      unparsableOptions,
    ],
    [
      'editMessageText',
      {
        chat_id: 1,
        message_id: 1,
        text: 'Hi',
        link_preview_options: `${'['.repeat(101)}1${']'.repeat(101)}`,
      },
      unparsableOptions,
    ],
    [
      'sendMessage',
      { chat_id: 1, text: 'Hi', link_preview_options: 'not JSON' },
      unparsableOptions,
    ],
    // Empty text is no options, as the official server reads it, so the message is read next.
    [
      'editMessageText',
      { message_id: 1, text: 'Hi', link_preview_options: '' },
      'Bad Request: chat_id is empty',
    ],
  ];

  const answers = [];
  for (const [method, parameters] of cases) {
    answers.push(await callBotApi(api, `${botApiPath}/${method}`, parameters));
  }
  assertEquals(
    answers,
    cases.map(([, , description]) => [400, description]),
    "Expected Telegram's description for options it cannot read, and empty text read as none",
  );
});

Deno.test('the sending methods name the parameter that does not fit their schema', async () => {
  const { api, botApiPath } = await createFixture();
  const cases: readonly [method: string, parameters: object, description: string][] = [
    [
      'sendMessage',
      { chat_id: 1, text: 'Hi', disable_notification: 'secret' },
      'Bad Request: invalid sendMessage parameters: disable_notification',
    ],
    [
      'sendPhoto',
      { chat_id: 1, photo: 'file-id', show_caption_above_media: 'secret' },
      'Bad Request: invalid sendPhoto parameters: show_caption_above_media',
    ],
    [
      'sendMediaGroup',
      { chat_id: 1, media: '[]', protect_content: 'secret' },
      'Bad Request: invalid sendMediaGroup parameters: protect_content',
    ],
    [
      'sendChatAction',
      { chat_id: 'secret-chat', action: 'typing' },
      'Bad Request: invalid sendChatAction parameters: chat_id',
    ],
    [
      'sendMessageDraft',
      { chat_id: 1, draft_id: 1, can_stop: 'secret' },
      'Bad Request: invalid sendMessageDraft parameters: can_stop',
    ],
    // The step-level checks keep Telegram's descriptions.
    [
      'sendContact',
      { chat_id: 1, first_name: 'Ada' },
      'Bad Request: parameter "phone_number" is required',
    ],
    ['sendLocation', { chat_id: 1, longitude: 2 }, 'Bad Request: latitude is empty'],
    ['sendVoice', { chat_id: 1 }, 'Bad Request: there is no voice in the request'],
  ];

  const answers = [];
  for (const [method, parameters] of cases) {
    answers.push(await callBotApi(api, `${botApiPath}/${method}`, parameters));
  }
  assertEquals(
    answers,
    cases.map(([, , description]) => [400, description]),
    "Expected a schema refusal to name its path, and a step's refusal to keep Telegram's words",
  );
});

Deno.test('the member administration methods name the parameter that does not fit their schema', async () => {
  await using fixture = await createFixture();
  const { api, botApiPath } = fixture;
  const cases: readonly [method: string, parameters: object, description: string][] = [
    [
      'banChatMember',
      { chat_id: 1, user_id: 2, until_date: 'tomorrow' },
      'Bad Request: invalid banChatMember parameters: until_date',
    ],
    [
      'unbanChatMember',
      { chat_id: 1, user_id: 2, only_if_banned: 'secret' },
      'Bad Request: invalid unbanChatMember parameters: only_if_banned',
    ],
    ['leaveChat', { chat_id: 'secret' }, 'Bad Request: invalid leaveChat parameters: chat_id'],
    ['leaveChat', {}, 'Bad Request: chat_id is empty'],
    [
      'getChatMember',
      { chat_id: 1, user_id: 'secret' },
      'Bad Request: invalid getChatMember parameters: user_id',
    ],
    ['getChatMember', { chat_id: 1 }, 'Bad Request: invalid user_id specified'],
    ['getChatAdministrators', {}, 'Bad Request: chat_id is empty'],
    [
      'getChatMemberCount',
      { secret: 1 },
      'Bad Request: invalid getChatMemberCount parameters: secret',
    ],
    [
      'setChatAdministratorCustomTitle',
      { user_id: 2, custom_title: 'Lead' },
      'Bad Request: chat_id is empty',
    ],
    // The user is read before the anonymity the emulator refuses.
    [
      'promoteChatMember',
      { chat_id: 1, is_anonymous: true },
      'Bad Request: invalid user_id specified',
    ],
    [
      'promoteChatMember',
      { chat_id: 1, user_id: 2, is_anonymous: true },
      'Bad Request: anonymous administrators are not supported',
    ],
    // The user is read first, then the permissions, then the chat.
    ['restrictChatMember', { permissions: 'not JSON' }, 'Bad Request: invalid user_id specified'],
    [
      'restrictChatMember',
      { user_id: 2, permissions: 'not JSON' },
      "Bad Request: can't parse permissions JSON object",
    ],
    ['restrictChatMember', { user_id: 2, permissions: {} }, 'Bad Request: chat_id is empty'],
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

/** Creates a session holding a bot, on an emulator that disposing of the fixture disposes of. */
async function createFixture() {
  await using disposalOnFailure = new AsyncDisposableStack();
  const { api, sessionPath } = disposalOnFailure.use(await createTestSession());
  const { botApiPath } = await createBot(api, sessionPath, 'test_bot');
  const emulatorDisposal = disposalOnFailure.move();
  return { api, botApiPath, [Symbol.asyncDispose]: () => emulatorDisposal.disposeAsync() };
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
