import { Bot } from 'https://cdn.jsdelivr.net/gh/grammyjs/grammY@^1.46.0/src/bot.ts';
import { webhookCallback } from 'https://cdn.jsdelivr.net/gh/grammyjs/grammY@^1.46.0/src/convenience/webhook.ts';
import {
  createSession,
  createTestSession,
  type EmulationApi,
  requestJson,
  TEST_PUBLIC_ORIGIN,
} from './support/emulation_api.ts';

interface TestMessage {
  readonly message_id: number;
  readonly text?: string;
  readonly contact?: Record<string, unknown>;
  readonly location?: Record<string, unknown>;
  readonly via_bot?: { readonly id: number };
}

interface TestInlineQuery {
  readonly id: string;
  readonly status: string;
  readonly answer: { readonly results: readonly Record<string, unknown>[] } | null;
}

/**
 * Creates a session where Ada owns a supergroup with Grace and has started a private chat with the
 * inline bot, which receives chosen results.
 */
async function createInlineContentFixture() {
  const { api, sessionPath } = await createTestSession();
  const createAccount = async (firstName: string) =>
    (await requestJson<{ account: { id: number } }>(api, 'POST', `${sessionPath}/accounts`, {
      first_name: firstName,
    })).body.account;
  const ada = await createAccount('Ada');
  const grace = await createAccount('Grace');
  const { body: createdBot } = await requestJson<{ token: string; bot: { id: number } }>(
    api,
    'POST',
    `${sessionPath}/bots`,
    {
      first_name: 'Places Bot',
      username: 'places_bot',
      supports_inline_queries: true,
      receives_chosen_inline_results: true,
    },
  );
  const bot = createdBot.bot;
  const botApiPath = `${sessionPath}/bot-api/bot${createdBot.token}`;
  const accountPath = (accountId: number) => `${sessionPath}/accounts/${accountId}`;
  const privateChat = { type: 'private', botId: bot.id } as const;
  await requestJson(api, 'POST', `${accountPath(ada.id)}/messages`, {
    to: privateChat,
    text: '/start',
  });
  const { body: { supergroup } } = await requestJson<{ supergroup: { id: number } }>(
    api,
    'POST',
    `${accountPath(ada.id)}/supergroups`,
    { title: 'Team' },
  );
  const supergroupChat = { type: 'supergroup', chatId: supergroup.id } as const;
  await api.request(
    `${accountPath(ada.id)}/conversations/supergroup/${supergroup.id}/members/${grace.id}`,
    { method: 'PUT' },
  );

  const callBot = (method: string, parameters: Record<string, unknown>) =>
    requestJson<{ ok: boolean; result?: unknown; description?: string }>(
      api,
      'POST',
      `${botApiPath}/${method}`,
      parameters,
    );
  const sendQuery = async (
    accountId: number,
    chat: typeof privateChat | typeof supergroupChat = privateChat,
  ) =>
    (await requestJson<{ inline_query: TestInlineQuery }>(
      api,
      'POST',
      `${accountPath(accountId)}/inline-queries`,
      { bot_id: bot.id, chat, query: `places ${crypto.randomUUID()}` },
    )).body.inline_query;
  const getInlineQuery = async (accountId: number, inlineQueryId: string) =>
    (await requestJson<{ inline_query: TestInlineQuery }>(
      api,
      'GET',
      `${accountPath(accountId)}/inline-queries/${inlineQueryId}`,
    )).body.inline_query;
  const answer = (inlineQueryId: string, results: readonly Record<string, unknown>[]) =>
    callBot('answerInlineQuery', { inline_query_id: inlineQueryId, results });
  const choose = (accountId: number, inlineQueryId: string, resultId: string) =>
    requestJson<{ message: TestMessage } | undefined>(
      api,
      'POST',
      `${accountPath(accountId)}/inline-queries/${inlineQueryId}/chosen-results`,
      { result_id: resultId },
    );
  const readUpdates = createUpdateReader(api, botApiPath);
  await readUpdates();

  return {
    api,
    ada,
    grace,
    bot,
    privateChat,
    supergroupChat,
    sessionPath,
    botToken: createdBot.token,
    accountPath,
    callBot,
    sendQuery,
    getInlineQuery,
    answer,
    choose,
    readUpdates,
  };
}

/** Returns a reader of the bot's updates since the reader last read them. */
function createUpdateReader(api: EmulationApi, botApiPath: string) {
  let nextOffset = 0;
  return async (): Promise<Array<Record<string, unknown>>> => {
    const { body } = await requestJson<{ result: Array<Record<string, unknown>> }>(
      api,
      'POST',
      `${botApiPath}/getUpdates`,
      { offset: nextOffset },
    );
    const lastUpdateId = body.result.at(-1)?.update_id;
    if (typeof lastUpdateId === 'number') {
      nextOffset = lastUpdateId + 1;
    }
    return body.result.map(({ update_id: _updateId, ...update }) => update);
  };
}

function expectEqual(actual: unknown, expected: unknown, message: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `${message}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`,
    );
  }
}

const contactResult = {
  type: 'contact',
  id: 'grace',
  phone_number: '+1 555 0100',
  first_name: 'Grace',
  last_name: 'Hopper',
  vcard: 'BEGIN:VCARD\nVERSION:3.0\nFN:Grace Hopper\nEND:VCARD',
};

const locationResult = {
  type: 'location',
  id: 'london',
  title: 'London',
  latitude: 51.5,
  longitude: -0.1275,
  horizontal_accuracy: 10.2,
};

Deno.test('an account sends the contacts and locations that inline results list', async () => {
  const { ada, bot, sendQuery, getInlineQuery, answer, choose, readUpdates } =
    await createInlineContentFixture();
  const inlineQuery = await sendQuery(ada.id);
  const answered = await answer(inlineQuery.id, [
    {
      ...contactResult,
      reply_markup: { inline_keyboard: [[{ text: 'Call', callback_data: 'c' }]] },
    },
    locationResult,
    { ...contactResult, id: 'first-name-only', phone_number: ' 555 ', last_name: undefined },
    { ...locationResult, id: 'untitled', title: '', latitude: -33.8568, longitude: 151.2153 },
    {
      ...contactResult,
      id: 'cleaned',
      phone_number: '+1\r555',
      first_name: 'Gr\race',
      last_name: 'B\tH',
    },
    { ...locationResult, id: 'cleaned-title', title: 'Lon\rdon\u2028' },
  ]);
  expectEqual(answered.body, { ok: true, result: true }, 'Expected the answer to be accepted');
  expectEqual(
    (await getInlineQuery(ada.id, inlineQuery.id)).answer?.results,
    [
      { type: 'contact', id: 'grace', title: 'Grace Hopper', description: '+1 555 0100' },
      { type: 'location', id: 'london', title: 'London', description: '51.500000 -0.127500' },
      { type: 'contact', id: 'first-name-only', title: 'Grace', description: '555' },
      { type: 'location', id: 'untitled', description: '-33.856800 151.215300' },
      { type: 'contact', id: 'cleaned', title: 'Grace B H', description: '+1555' },
      {
        type: 'location',
        id: 'cleaned-title',
        title: 'London',
        description: '51.500000 -0.127500',
      },
    ],
    'Expected TDLib descriptions of the contacts and the locations, with their texts cleaned',
  );

  const chosenContact = await choose(ada.id, inlineQuery.id, 'grace');
  const chosenLocation = await choose(ada.id, inlineQuery.id, 'london');
  expectEqual(
    [
      chosenContact.status,
      chosenContact.body?.message.contact,
      chosenContact.body?.message.via_bot?.id,
      chosenLocation.status,
      chosenLocation.body?.message.location,
      chosenLocation.body?.message.via_bot?.id,
    ],
    [
      201,
      {
        phone_number: '+1 555 0100',
        first_name: 'Grace',
        last_name: 'Hopper',
        vcard: 'BEGIN:VCARD\nVERSION:3.0\nFN:Grace Hopper\nEND:VCARD',
      },
      bot.id,
      201,
      { latitude: 51.5, longitude: -0.1275, horizontal_accuracy: 11 },
      bot.id,
    ],
    'Expected the contact and the location sent through the bot',
  );
  const chosenResults = (await readUpdates()).flatMap((update) =>
    update.chosen_inline_result === undefined ? [] : [update.chosen_inline_result]
  ) as Array<{ result_id: string; inline_message_id?: string }>;
  expectEqual(
    chosenResults.map(({ result_id, inline_message_id }) => [result_id, typeof inline_message_id]),
    [['grace', 'string'], ['london', 'undefined']],
    'Expected both choices, with an inline message ID for the result with a keyboard',
  );
});

Deno.test('input_message_content replaces what a result sends with a contact or location', async () => {
  const { ada, sendQuery, answer, choose } = await createInlineContentFixture();
  const contactContent = { phone_number: '+44 20 7946 0000', first_name: 'Ada', last_name: '' };
  const locationContent = { latitude: -33.8568, longitude: 151.2153 };
  const inlineQuery = await sendQuery(ada.id);
  const answered = await answer(inlineQuery.id, [
    { type: 'article', id: 'article', title: 'Ada', input_message_content: contactContent },
    { ...contactResult, input_message_content: locationContent },
    { ...locationResult, input_message_content: { message_text: 'See you in London' } },
    { ...locationResult, id: 'sydney', input_message_content: locationContent },
  ]);
  const sent = [];
  for (const resultId of ['article', 'grace', 'london', 'sydney']) {
    const chosen = await choose(ada.id, inlineQuery.id, resultId);
    const { message } = chosen.body ?? {};
    sent.push([chosen.status, message?.contact ?? message?.location ?? message?.text]);
  }
  expectEqual(
    [answered.body, sent],
    [
      { ok: true, result: true },
      [
        [201, { phone_number: '+44 20 7946 0000', first_name: 'Ada' }],
        [201, { latitude: -33.8568, longitude: 151.2153 }],
        [201, 'See you in London'],
        [201, { latitude: -33.8568, longitude: 151.2153 }],
      ],
    ],
    'Expected each result to send its input_message_content',
  );
});

Deno.test('answerInlineQuery checks contacts and locations and records no part of a refused answer', async () => {
  const { ada, sendQuery, getInlineQuery, answer } = await createInlineContentFixture();
  const inlineQuery = await sendQuery(ada.id);
  const article = (inputMessageContent: Record<string, unknown>) => ({
    type: 'article',
    id: 'article',
    title: 'Article',
    input_message_content: inputMessageContent,
  });
  const refusals = [
    [contactResult, { ...contactResult, id: 'blank-phone', phone_number: ' \n ' }],
    [{ ...contactResult, first_name: '  ' }],
    [{ ...contactResult, first_name: 'G'.repeat(65) }],
    [{ ...contactResult, phone_number: undefined }],
    [{ ...contactResult, last_name: '\ud800' }],
    [{ ...contactResult, phone_number: '\u2028', input_message_content: { message_text: 'Hi' } }],
    [{
      ...contactResult,
      first_name: '\u2028',
      last_name: '',
      input_message_content: { message_text: 'Hi' },
    }],
    [{ ...locationResult, title: '\udc00' }],
    [article({ phone_number: '+1 555 0100', first_name: '\r' })],
    [article({ phone_number: '+1 555 0100' })],
    [{ ...locationResult, latitude: 91 }],
    [article({ latitude: 0, longitude: 181 })],
    [{ ...locationResult, horizontal_accuracy: 1501 }],
    [{ ...locationResult, live_period: 60 }],
    [article({ latitude: 0, longitude: 0, live_period: 60 })],
    [article({ latitude: 0, longitude: 0, title: 'Cafe', address: 'Main St' })],
    [article({ payload: 'order-1' })],
  ];
  const descriptions = [];
  for (const results of refusals) {
    descriptions.push((await answer(inlineQuery.id, results)).body.description);
  }
  expectEqual(
    descriptions,
    [
      'Bad Request: field "phone_number" must contain a valid phone number',
      'Bad Request: field "first_name" must be non-empty',
      'Bad Request: invalid answerInlineQuery parameters',
      'Bad Request: invalid answerInlineQuery parameters',
      'Bad Request: strings must be encoded in UTF-8',
      'Bad Request: field "phone_number" must contain a valid phone number',
      'Bad Request: field "first_name" must be non-empty',
      'Bad Request: strings must be encoded in UTF-8',
      'Bad Request: first name must be non-empty',
      'Bad Request: invalid answerInlineQuery parameters',
      'Bad Request: invalid location specified',
      'Bad Request: invalid location specified',
      'Bad Request: invalid answerInlineQuery parameters',
      'Bad Request: invalid answerInlineQuery parameters',
      'Bad Request: invalid answerInlineQuery parameters',
      'Bad Request: inline query results sending a venue or invoice are not supported',
      'Bad Request: inline query results sending a venue or invoice are not supported',
    ],
    "Expected Telegram's and the emulator's errors",
  );
  expectEqual(
    (await getInlineQuery(ada.id, inlineQuery.id)).status,
    'awaiting_answer',
    'Expected refused answers to leave the query unanswered',
  );
});

Deno.test('contact and location results follow chat access and inline edits', async () => {
  const {
    api,
    ada,
    grace,
    bot,
    supergroupChat,
    sessionPath,
    accountPath,
    callBot,
    sendQuery,
    answer,
    choose,
    readUpdates,
  } = await createInlineContentFixture();
  const keyboard = { inline_keyboard: [[{ text: 'Open', callback_data: 'open' }]] };
  const groupQuery = await sendQuery(grace.id, supergroupChat);
  await answer(groupQuery.id, [
    { ...contactResult, reply_markup: keyboard },
    { ...locationResult, reply_markup: keyboard },
  ]);
  const sentToGroup = [
    await choose(grace.id, groupQuery.id, 'grace'),
    await choose(grace.id, groupQuery.id, 'london'),
  ];
  expectEqual(
    sentToGroup.map(({ status, body }) => [status, body?.message.via_bot?.id]),
    [[201, bot.id], [201, bot.id]],
    'Expected both results in the supergroup',
  );

  // The emulated web serves the new media, which the edit downloads before it finds the message.
  const gifImage = new Uint8Array(13);
  gifImage.set(new TextEncoder().encode('GIF89a'));
  gifImage.set([4, 0, 3, 0], 6);
  await requestJson(api, 'POST', `${sessionPath}/web-resources`, {
    url: 'https://cdn.example.com/map.gif',
    content_type: 'image/gif',
    content_base64: gifImage.toBase64(),
  });
  const [contactMessageId, locationMessageId] = (await readUpdates()).flatMap((update) =>
    update.chosen_inline_result === undefined
      ? []
      : [(update.chosen_inline_result as { inline_message_id: string }).inline_message_id]
  );
  const edits = [
    await callBot('editMessageReplyMarkup', {
      inline_message_id: contactMessageId,
      reply_markup: { inline_keyboard: [[{ text: 'Closed', callback_data: 'closed' }]] },
    }),
    await callBot('editMessageText', { inline_message_id: contactMessageId, text: 'Grace' }),
    await callBot('editMessageCaption', { inline_message_id: locationMessageId, caption: 'Here' }),
    await callBot('editMessageMedia', {
      inline_message_id: locationMessageId,
      media: { type: 'photo', media: 'https://cdn.example.com/map.gif' },
    }),
  ].map(({ body }) => body.ok ? body.result : body.description);
  expectEqual(
    edits,
    [
      true,
      'Bad Request: there is no text in the message to edit',
      'Bad Request: there is no caption in the message to edit',
      "Bad Request: message media can't be edited",
    ],
    'Expected only the keyboard of a contact or location to change',
  );

  await requestJson(api, 'PUT', `${accountPath(ada.id)}/blocked-bots/${bot.id}`);
  const privateQuery = await sendQuery(ada.id);
  await answer(privateQuery.id, [contactResult]);
  expectEqual(
    (await choose(ada.id, privateQuery.id, 'grace')).status,
    409,
    'Expected a blocked bot to refuse the result',
  );
});

Deno.test('a grammY bot answers through its webhook with a location an account sends, as the activity log records', async () => {
  const { api, ada, sessionPath, botToken, accountPath, sendQuery, choose, readUpdates } =
    await createInlineContentFixture();
  // Confirms Ada's `/start`, which the fixture read, so that the webhook receives only new updates.
  await readUpdates();
  const grammyBot = new Bot(botToken, {
    client: {
      apiRoot: `${TEST_PUBLIC_ORIGIN}${sessionPath}/bot-api`,
      fetch: async (input, init) => await api.fetch(new Request(input, init)),
    },
  });
  grammyBot.on(
    'inline_query',
    (context) =>
      context.answerInlineQuery([{ ...locationResult, type: 'location' }], { cache_time: 0 }),
  );
  const chosenResultIds: string[] = [];
  grammyBot.on('chosen_inline_result', (context) => {
    chosenResultIds.push(context.chosenInlineResult.result_id);
  });
  const handleWebhookRequest = webhookCallback(grammyBot, 'std/http');
  const webhookServer = Deno.serve(
    { hostname: '127.0.0.1', port: 0, onListen: () => {} },
    (request) => handleWebhookRequest(request),
  );
  const activityPath = `${sessionPath}/bot-activity`;
  const readActivity = async (query: string) =>
    (await requestJson<{ entries: Array<Record<string, unknown>>; head_position: number }>(
      api,
      'GET',
      `${activityPath}?${query}`,
    )).body;

  try {
    await grammyBot.init();
    await grammyBot.api.setWebhook(`http://127.0.0.1:${webhookServer.addr.port}/webhook`);
    const { head_position: start } = await readActivity('limit=0');
    const inlineQuery = await sendQuery(ada.id);
    await readActivity(`after=${start}&method=answerInlineQuery&wait_ms=5000`);
    const chosen = await choose(ada.id, inlineQuery.id, 'london');
    // The webhook confirms the inline query, the account's message, and the chosen result.
    let confirmationCount = 0;
    for (let attempt = 0; confirmationCount < 3 && attempt < 250; attempt++) {
      if (attempt > 0) {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      confirmationCount =
        (await readActivity(`after=${start}&kind=update_confirmed`)).entries.length;
    }

    const { entries } = await readActivity(`after=${start}`);
    const deliveredUpdateTypes = entries.flatMap(({ kind, update }) =>
      kind === 'update_delivered'
        ? Object.keys(update as object).filter((key) => key !== 'update_id')
        : []
    );
    expectEqual(
      [
        chosen.status,
        chosen.body?.message.location,
        confirmationCount,
        chosenResultIds,
        entries.flatMap(({ kind, via, method }) => kind === 'bot_api_call' ? [[via, method]] : []),
        entries.every(({ kind, via }) => kind === 'bot_api_call' || via === 'webhook'),
        deliveredUpdateTypes.toSorted(),
      ],
      [
        201,
        { latitude: 51.5, longitude: -0.1275, horizontal_accuracy: 11 },
        3,
        ['london'],
        [['http', 'answerInlineQuery']],
        true,
        ['chosen_inline_result', 'inline_query', 'message'],
      ],
      'Expected the query, the answer, and the chosen location through the webhook',
    );

    // Another session does not know the account's query.
    const otherSessionPath = await createSession(api);
    const elsewhere = await api.request(
      `${otherSessionPath}/accounts/${ada.id}/inline-queries/${inlineQuery.id}`,
    );
    const ownQuery = await api.request(`${accountPath(ada.id)}/inline-queries/${inlineQuery.id}`);
    expectEqual(
      [elsewhere.status, ownQuery.status],
      [404, 200],
      'Expected the query to belong to its session only',
    );
    await elsewhere.body?.cancel();
    await ownQuery.body?.cancel();
  } finally {
    await api.request(sessionPath, { method: 'DELETE' });
    await webhookServer.shutdown();
  }
});
