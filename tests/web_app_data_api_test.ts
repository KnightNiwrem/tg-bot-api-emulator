import { Bot, Keyboard, webhookCallback } from 'grammy';
import { run } from '@grammyjs/runner';

import {
  EmulationClientError,
  type EmulationSessionClient,
  type PrivateMessage,
  type PrivateMessageTarget,
  TelegramEmulationClient,
  type VirtualAccountClient,
} from '../clients/typescript/mod.ts';
import {
  createTestApi,
  type EmulationApi,
  requestJson,
  TEST_PUBLIC_ORIGIN,
} from './support/emulation_api.ts';

const DATES_APP_URL = 'https://hotel.example/dates';

/** The largest data `Telegram.WebApp.sendData` sends, in UTF-8 bytes. */
const MAX_WEB_APP_DATA_BYTES = 4_096;

Deno.test('a grammY bot answers the dates its keyboard Web App sends', async () => {
  const { session, fetch, bot, ada, privateChat } = await createWebAppFixture();
  const grammyBot = new Bot(bot.token, { client: { apiRoot: session.botApiRoot, fetch } });
  grammyBot.command('book', (context) =>
    context.reply('When do you arrive?', {
      reply_markup: new Keyboard().webApp('Choose dates', DATES_APP_URL).oneTime(),
    }));
  grammyBot.on('message:web_app_data', (context) => {
    const { button_text, data } = context.msg.web_app_data;
    const { from, nights } = JSON.parse(data) as { from: string; nights: number };
    return context.reply(`${button_text}: ${nights} nights from ${from}`, {
      reply_parameters: { message_id: context.msg.message_id },
      reply_markup: { remove_keyboard: true },
    });
  });
  const activity = session.botActivity({ bot_id: bot.id });
  const start = await activity.position();
  const runner = run(grammyBot);

  try {
    await ada.sendMessage({ to: privateChat, text: '/book' });
    await activity.waitFor({
      method: 'sendMessage',
      chat_id: ada.id,
      parameters: { text: 'When do you arrive?' },
    }, { after: start });

    const beforeSubmission = await activity.position();
    const data = '{"from":"2026-12-24","nights":3}';
    const submitted = await ada.pressReplyKeyboardButton({
      chat: privateChat,
      text: 'Choose dates',
      web_app_data: data,
    });
    expectEqual(
      [submitted.web_app_data, submitted.from.id, submitted.chat.id],
      [{ button_text: 'Choose dates', data }, ada.id, ada.id],
      "Expected a service message of Ada's in her chat with the bot",
    );
    if (submitted.text !== undefined || submitted.reply_to_message !== undefined) {
      throw new Error(`Expected only the Web App data, received ${JSON.stringify(submitted)}`);
    }
    const reply = await activity.waitFor({
      method: 'sendMessage',
      chat_id: ada.id,
      parameters: { text: 'Choose dates: 3 nights from 2026-12-24' },
    }, { after: beforeSubmission });

    const delivered = await activity.waitFor({
      kind: 'update_delivered',
      user_id: ada.id,
      where: (entry) => entry.position < reply.position,
    }, { after: beforeSubmission });
    expectEqual(
      Object.keys(delivered.update).sort(),
      ['message', 'update_id'],
      'Expected the bot to receive the Web App data as a message update',
    );
    expectEqual(
      (delivered.update.message as PrivateMessage).web_app_data,
      { button_text: 'Choose dates', data },
      'Expected the delivered update to carry the Web App data',
    );
    await activity.assertNone(
      {
        kind: 'update_delivered',
        where: (entry) => entry.update.update_id !== delivered.update.update_id,
      },
      { after: beforeSubmission, before: reply.position },
    );

    const history = await ada.getMessages({ chat: privateChat });
    const [submission, answer] = history.slice(-2);
    expectEqual(
      [submission?.message_id, submission?.web_app_data, answer?.from.id],
      [submitted.message_id, submitted.web_app_data, bot.id],
      'Expected the history to end with the submission and the reply',
    );
    expectEqual(
      answer?.reply_to_message?.web_app_data,
      submitted.web_app_data,
      'Expected the reply to show the service message it replies to',
    );
  } finally {
    await runner.stop();
    await session.end();
  }
});

Deno.test('a grammY bot receives Web App data through its webhook', async () => {
  const { api, session, fetch, bot, ada, privateChat } = await createWebAppFixture();
  const grammyBot = new Bot(bot.token, { client: { apiRoot: session.botApiRoot, fetch } });
  const received = Promise.withResolvers<string>();
  grammyBot.on('message:web_app_data', (context) => {
    received.resolve(context.msg.web_app_data.data);
    return context.reply('Dates saved');
  });
  const handleWebhookRequest = webhookCallback(grammyBot, 'std/http');
  const webhookServer = Deno.serve(
    { hostname: '127.0.0.1', port: 0, onListen: () => {} },
    (request) => handleWebhookRequest(request),
  );
  const activity = session.botActivity({ bot_id: bot.id });

  try {
    await grammyBot.api.setWebhook(`http://127.0.0.1:${webhookServer.addr.port}/webhook`, {
      drop_pending_updates: true,
    });
    await grammyBot.api.sendMessage(ada.id, 'When do you arrive?', {
      reply_markup: new Keyboard().webApp('Choose dates', DATES_APP_URL),
    });
    const beforeSubmission = await activity.position();
    await ada.pressReplyKeyboardButton({
      chat: privateChat,
      text: 'Choose dates',
      web_app_data: 'tomorrow',
    });
    await activity.waitFor({
      method: 'sendMessage',
      chat_id: ada.id,
      parameters: { text: 'Dates saved' },
    }, { after: beforeSubmission });
    expectEqual(await received.promise, 'tomorrow', 'Expected the webhook to receive the data');
    await activity.waitFor(
      { kind: 'update_delivered', user_id: ada.id, where: (entry) => entry.via === 'webhook' },
      { after: beforeSubmission },
    );
  } finally {
    await requestJson(api, 'DELETE', `/sessions/${session.id}`);
    await webhookServer.shutdown();
  }
});

Deno.test('Web App data reaches the bot exactly as sent, up to 4096 UTF-8 bytes', async () => {
  const { session, ada, privateChat, callBot } = await createWebAppFixture();
  await showDatesKeyboard(callBot, ada.id);
  // The euro sign takes 3 bytes in UTF-8 but 1 UTF-16 code unit, and an emoji 4 bytes but 2.
  const sendableData = [
    '  \n\t ',
    'Grüße, 世界 👋',
    '{"from": "2026-12-24", "nights": ',
    'a'.repeat(MAX_WEB_APP_DATA_BYTES),
    `${'€'.repeat(1_365)}a`,
    '👋'.repeat(MAX_WEB_APP_DATA_BYTES / 4),
  ];
  const unsendableData = [
    '',
    'a'.repeat(MAX_WEB_APP_DATA_BYTES + 1),
    '€'.repeat(1_366),
    `${'👋'.repeat(MAX_WEB_APP_DATA_BYTES / 4)}a`,
  ];
  const offset = await readUpdatesOffset(callBot);

  for (const data of unsendableData) {
    await expectRefused(
      ada.pressReplyKeyboardButton({ chat: privateChat, text: 'Choose dates', web_app_data: data }),
      400,
      `data of ${new TextEncoder().encode(data).length} bytes`,
    );
  }
  for (const data of sendableData) {
    await ada.pressReplyKeyboardButton({
      chat: privateChat,
      text: 'Choose dates',
      web_app_data: data,
    });
  }

  const updates = await callBot('getUpdates', { offset });
  expectEqual(
    (updates.result as Array<{ message?: PrivateMessage }>).map(({ message }) =>
      message?.web_app_data?.data
    ),
    sendableData,
    'Expected one update for each sendable data, carrying it unchanged',
  );
  expectEqual(
    (await ada.getMessages({ chat: privateChat }))
      .filter((message) => message.web_app_data !== undefined)
      .map((message) => message.web_app_data?.data),
    sendableData,
    'Expected the history to show each sendable data unchanged',
  );
  await session.end();
});

Deno.test('refused Web App submissions change nothing', async () => {
  const fixture = await createWebAppFixture();
  const { api, session, bot, ada, privateChat, callBot } = fixture;
  const team = await ada.createSupergroup({ title: 'Team' });
  await ada.addChatMember({ chat: { type: 'supergroup', chatId: team.id }, userId: bot.id });
  await callBot('sendMessage', {
    chat_id: team.id,
    text: 'Vote',
    reply_markup: { keyboard: [[{ text: 'Choose dates' }]] },
  });
  await callBot('sendMessage', {
    chat_id: ada.id,
    text: 'When do you arrive?',
    reply_markup: {
      keyboard: [
        [{ text: 'Choose dates', web_app: { url: DATES_APP_URL } }],
        [{ text: 'Here', request_location: true }, { text: 'Plain' }],
        [
          { text: 'Two apps', web_app: { url: DATES_APP_URL } },
          { text: 'Two apps', web_app: { url: 'https://hotel.example/rooms' } },
        ],
      ],
    },
  });
  const offset = await readUpdatesOffset(callBot);
  const historyBefore = await ada.getMessages({ chat: privateChat });
  const replyInterfaceBefore = await ada.getReplyInterface({ chat: privateChat });
  const pressPath = (accountId: number) =>
    `/sessions/${session.id}/accounts/${accountId}/reply-keyboard-presses`;
  const press = (body: Record<string, unknown>, accountId = ada.id) =>
    requestJson(api, 'POST', pressPath(accountId), { chat: privateChat, ...body });

  const refusals: Array<[string, Promise<{ status: number }>, number]> = [
    ['a missing answer', press({ text: 'Choose dates' }), 400],
    ['a number', press({ text: 'Choose dates', web_app_data: 42 }), 400],
    ['null', press({ text: 'Choose dates', web_app_data: null }), 400],
    ['an object', press({ text: 'Choose dates', web_app_data: { from: 'today' } }), 400],
    [
      'a second answer',
      press({
        text: 'Choose dates',
        web_app_data: 'today',
        location: { latitude: 0, longitude: 0 },
      }),
      400,
    ],
    ['a plain button', press({ text: 'Plain', web_app_data: 'today' }), 400],
    ['a location button', press({ text: 'Here', web_app_data: 'today' }), 400],
    ['a button not shown', press({ text: 'Choose a room', web_app_data: 'today' }), 400],
    [
      'Web Apps at different URLs under one label',
      press({ text: 'Two apps', web_app_data: 'today' }),
      400,
    ],
    [
      'a supergroup',
      press({
        chat: { type: 'supergroup', chatId: team.id },
        text: 'Choose dates',
        web_app_data: 'today',
      }),
      400,
    ],
    [
      'an unknown bot',
      press({ chat: { type: 'private', botId: 999_999 }, text: 'Choose dates', web_app_data: 'x' }),
      404,
    ],
    ['an unknown account', press({ text: 'Choose dates', web_app_data: 'x' }, 999_999), 404],
    [
      'an unknown session',
      requestJson(api, 'POST', `/sessions/unknown/accounts/${ada.id}/reply-keyboard-presses`, {
        chat: privateChat,
        text: 'Choose dates',
        web_app_data: 'today',
      }),
      404,
    ],
  ];
  for (const [description, refusal, expectedStatus] of refusals) {
    const { status } = await refusal;
    if (status !== expectedStatus) {
      throw new Error(`Expected ${description} to be refused with ${expectedStatus}: ${status}`);
    }
  }
  const malformed = await api.request(pressPath(ada.id), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{"chat":',
  });
  if (malformed.status !== 400) {
    throw new Error(`Expected a malformed body to be refused: ${malformed.status}`);
  }

  await ada.blockBot({ botId: bot.id });
  await expectRefused(
    ada.pressReplyKeyboardButton({
      chat: privateChat,
      text: 'Choose dates',
      web_app_data: 'today',
    }),
    409,
    'a submission to a blocked bot',
  );
  await ada.unblockBot({ botId: bot.id });

  expectEqual(
    await ada.getMessages({ chat: privateChat }),
    historyBefore,
    'Expected refused submissions to leave the history unchanged',
  );
  expectEqual(
    await ada.getReplyInterface({ chat: privateChat }),
    replyInterfaceBefore,
    'Expected refused submissions to leave the keyboard shown',
  );
  // Blocking and unblocking the bot enqueue its my_chat_member updates, but no message.
  expectEqual(
    ((await callBot('getUpdates', { offset })).result as Array<Record<string, unknown>>)
      .map((update) => Object.keys(update).filter((key) => key !== 'update_id')),
    [['my_chat_member'], ['my_chat_member']],
    'Expected refused submissions to enqueue no message update',
  );
  await session.end();
});

Deno.test('a submission answers the keyboard shown when it is sent', async () => {
  const { session, ada, privateChat, callBot } = await createWebAppFixture();
  await callBot('sendMessage', {
    chat_id: ada.id,
    text: 'When do you arrive?',
    reply_markup: {
      keyboard: [[{ text: 'Choose dates', web_app: { url: DATES_APP_URL } }]],
      one_time_keyboard: true,
    },
  });
  const datesKeyboard = await ada.getReplyInterface({ chat: privateChat });
  await ada.pressReplyKeyboardButton({
    chat: privateChat,
    text: 'Choose dates',
    web_app_data: 'first',
  });
  expectEqual(
    await ada.getReplyInterface({ chat: privateChat }),
    datesKeyboard,
    'Expected a one-time keyboard to stay available, as after any press',
  );

  await callBot('sendMessage', {
    chat_id: ada.id,
    text: 'Which room?',
    reply_markup: { keyboard: [[{ text: 'Choose a room', web_app: { url: DATES_APP_URL } }]] },
  });
  await expectRefused(
    ada.pressReplyKeyboardButton({
      chat: privateChat,
      text: 'Choose dates',
      web_app_data: 'second',
    }),
    400,
    'a button of a replaced keyboard',
  );
  const room = await ada.pressReplyKeyboardButton({
    chat: privateChat,
    text: 'Choose a room',
    web_app_data: 'second',
  });
  expectEqual(
    room.web_app_data,
    { button_text: 'Choose a room', data: 'second' },
    'Expected the current button to name the submission',
  );

  await callBot('sendMessage', {
    chat_id: ada.id,
    text: 'Thanks',
    reply_markup: { remove_keyboard: true },
  });
  await expectRefused(
    ada.pressReplyKeyboardButton({
      chat: privateChat,
      text: 'Choose a room',
      web_app_data: 'third',
    }),
    400,
    'a button of a removed keyboard',
  );
  await session.end();
});

Deno.test('a submission selects the Web App button among buttons that share its label', async () => {
  const plainButton = { text: 'Duplicate' };
  const webAppButton = { text: 'Duplicate', web_app: { url: DATES_APP_URL } };
  const keyboards: Array<[string, unknown[][]]> = [
    ['the plain button first', [[plainButton, webAppButton]]],
    ['the Web App button first', [[webAppButton, plainButton]]],
    ['the plain button a row above', [[plainButton], [webAppButton]]],
    ['the Web App button a row above', [[webAppButton], [plainButton]]],
  ];
  for (const [arrangement, keyboard] of keyboards) {
    const { session, ada, privateChat, callBot } = await createWebAppFixture();
    const shown = await callBot('sendMessage', {
      chat_id: ada.id,
      text: 'Which?',
      reply_markup: { keyboard, one_time_keyboard: true },
    });
    if (!shown.ok) {
      throw new Error(`Expected the keyboard with ${arrangement}: ${shown.description}`);
    }
    const offset = await readUpdatesOffset(callBot);
    const historyLength = (await ada.getMessages({ chat: privateChat })).length;
    const replyInterface = await ada.getReplyInterface({ chat: privateChat });

    const submitted = await ada.pressReplyKeyboardButton({
      chat: privateChat,
      text: 'Duplicate',
      web_app_data: 'payload',
    });
    expectEqual(
      [submitted.web_app_data, submitted.text],
      [{ button_text: 'Duplicate', data: 'payload' }, undefined],
      `Expected the Web App data with ${arrangement}`,
    );
    const submissionUpdates = (await callBot('getUpdates', { offset })).result as Array<
      { update_id: number; message?: PrivateMessage }
    >;
    expectEqual(
      [
        submissionUpdates.map(({ message }) => message?.web_app_data),
        (await ada.getMessages({ chat: privateChat })).length,
        await ada.getReplyInterface({ chat: privateChat }),
      ],
      [[{ button_text: 'Duplicate', data: 'payload' }], historyLength + 1, replyInterface],
      `Expected one message and one update, with the keyboard still shown, with ${arrangement}`,
    );

    const pressed = await ada.pressReplyKeyboardButton({ chat: privateChat, text: 'Duplicate' });
    expectEqual(
      [pressed.text, pressed.web_app_data],
      ['Duplicate', undefined],
      `Expected a press without data to send the plain button's text with ${arrangement}`,
    );
    await session.end();
  }
});

Deno.test('a submission is stored but not delivered when the bot excludes message updates', async () => {
  const { session, ada, privateChat, callBot } = await createWebAppFixture();
  await showDatesKeyboard(callBot, ada.id);
  const offset = await readUpdatesOffset(callBot);
  await callBot('getUpdates', { offset, allowed_updates: ['callback_query'] });

  const submitted = await ada.pressReplyKeyboardButton({
    chat: privateChat,
    text: 'Choose dates',
    web_app_data: 'today',
  });
  expectEqual(
    [
      (await callBot('getUpdates', { offset })).result,
      (await ada.getMessages({
        chat: privateChat,
      })).at(-1)?.message_id,
    ],
    [[], submitted.message_id],
    'Expected the submission in the history without an update',
  );
  await session.end();
});

Deno.test('Web App submissions stay within their session', async () => {
  const api = createTestApi();
  const first = await createWebAppFixture(api);
  const second = await createWebAppFixture(api);
  await showDatesKeyboard(first.callBot, first.ada.id);

  await expectRefused(
    second.ada.pressReplyKeyboardButton({
      chat: second.privateChat,
      text: 'Choose dates',
      web_app_data: 'today',
    }),
    400,
    'a keyboard of another session',
  );
  await first.ada.pressReplyKeyboardButton({
    chat: first.privateChat,
    text: 'Choose dates',
    web_app_data: 'today',
  });
  expectEqual(
    (await second.ada.getMessages({ chat: second.privateChat })).filter((message) =>
      message.web_app_data !== undefined
    ),
    [],
    'Expected a submission in one session to leave the other untouched',
  );
  await first.session.end();
  await second.session.end();
});

interface WebAppFixture {
  readonly api: EmulationApi;
  readonly session: EmulationSessionClient;
  readonly fetch: typeof globalThis.fetch;
  readonly bot: { readonly id: number; readonly token: string };
  readonly ada: VirtualAccountClient;
  readonly privateChat: PrivateMessageTarget;
  readonly callBot: BotApiCaller;
}

type BotApiCaller = (
  method: string,
  parameters: Record<string, unknown>,
) => Promise<{ ok: boolean; result?: unknown; description?: string }>;

/** Creates a session whose bot Ada has started a private chat with. */
async function createWebAppFixture(api = createTestApi()): Promise<WebAppFixture> {
  const fetch: typeof globalThis.fetch = async (input, init) =>
    await api.fetch(new Request(input, init));
  const session = await new TelegramEmulationClient(TEST_PUBLIC_ORIGIN, { fetch }).createSession();
  const createdBot = await session.createBot({ first_name: 'Hotel Bot', username: 'hotel_bot' });
  const { account: ada } = await session.createAccount({ first_name: 'Ada' });
  const privateChat: PrivateMessageTarget = { type: 'private', botId: createdBot.bot.id };
  await ada.sendMessage({ to: privateChat, text: '/start' });
  const callBot: BotApiCaller = async (method, parameters) => {
    const response = await fetch(`${session.botApiRoot}/bot${createdBot.token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(parameters),
    });
    return await response.json() as { ok: boolean; result?: unknown; description?: string };
  };
  return {
    api,
    session,
    fetch,
    bot: { id: createdBot.bot.id, token: createdBot.token },
    ada,
    privateChat,
    callBot,
  };
}

/** Shows the account a keyboard whose one button opens the dates Web App. */
async function showDatesKeyboard(callBot: BotApiCaller, accountId: number): Promise<void> {
  const sent = await callBot('sendMessage', {
    chat_id: accountId,
    text: 'When do you arrive?',
    reply_markup: { keyboard: [[{ text: 'Choose dates', web_app: { url: DATES_APP_URL } }]] },
  });
  if (!sent.ok) {
    throw new Error(`Expected the keyboard to be sent: ${sent.description}`);
  }
}

/** The `getUpdates` offset that skips every update pending so far. */
async function readUpdatesOffset(callBot: BotApiCaller): Promise<number> {
  const pending = (await callBot('getUpdates', {})).result as Array<{ update_id: number }>;
  return (pending.at(-1)?.update_id ?? 0) + 1;
}

async function expectRefused(
  press: Promise<unknown>,
  expectedStatus: number,
  description: string,
): Promise<void> {
  try {
    await press;
  } catch (error) {
    if (error instanceof EmulationClientError && error.status === expectedStatus) {
      return;
    }
    throw new Error(`Expected ${description} to be refused with ${expectedStatus}`, {
      cause: error,
    });
  }
  throw new Error(`Expected ${description} to be refused with ${expectedStatus}`);
}

function expectEqual(actual: unknown, expected: unknown, message: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `${message}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`,
    );
  }
}
