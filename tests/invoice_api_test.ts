import { assertEquals } from '@std/assert';
import { Bot } from 'https://cdn.jsdelivr.net/gh/grammyjs/grammY@^1.46.0/src/bot.ts';

import { assertEqualsInFieldOrder } from './support/field_order_assertion.ts';
import { createAccount, createBot } from './support/http_fixtures.ts';
import { createUpdateReader, withoutUpdateIds } from './support/bot_api_requests.ts';
import {
  createTestInProcessEmulator,
  createTestSession,
  requestJson,
} from './support/emulation_api.ts';

interface TestInvoice {
  readonly title: string;
  readonly description: string;
  readonly start_parameter: string;
  readonly currency: string;
  readonly total_amount: number;
}

interface TestMessage {
  readonly message_id: number;
  readonly from?: { readonly id: number };
  readonly text?: string;
  readonly invoice?: TestInvoice;
  readonly reply_markup?: unknown;
  readonly reply_to_message?: TestMessage;
  readonly external_reply?: { readonly invoice?: TestInvoice };
  readonly pinned_message?: TestMessage;
}

interface BotApiAnswer {
  readonly ok: boolean;
  readonly result?: unknown;
  readonly error_code?: number;
  readonly description?: string;
}

/** The parameters of a valid invoice, which each test varies. */
const VALID_INVOICE = {
  title: 'Premium access',
  description: 'Unlocks every premium chapter',
  payload: 'order-42',
  currency: 'XTR',
  prices: [{ label: 'Access', amount: 50 }],
} as const;

/**
 * Creates a session where Ada has started a private chat with the shop bot and owns a supergroup
 * the bot is a member of.
 */
async function createInvoiceFixture() {
  await using disposalOnFailure = new AsyncDisposableStack();
  const { api, sessionPath } = disposalOnFailure.use(await createTestSession());
  const ada = await createAccount(api, sessionPath, 'Ada');
  const createdBot = await createBot(api, sessionPath, 'shop_bot', { first_name: 'Shop' });
  const { botApiPath } = createdBot;
  const privateChat = { type: 'private', botId: createdBot.bot.id } as const;
  const accountPath = `${sessionPath}/accounts/${ada.id}`;
  const sendAccountMessage = (body: Record<string, unknown>) =>
    requestJson<{ message?: TestMessage; reason?: string }>(
      api,
      'POST',
      `${accountPath}/messages`,
      body,
    );
  await sendAccountMessage({ to: privateChat, text: '/start' });

  const { body: { supergroup } } = await requestJson<{ supergroup: { id: number } }>(
    api,
    'POST',
    `${accountPath}/supergroups`,
    { title: 'Shop floor' },
  );
  const memberResponse = await api.request(
    `${accountPath}/conversations/supergroup/${supergroup.id}/members/${createdBot.bot.id}`,
    { method: 'PUT' },
  );
  if (memberResponse.status !== 204) {
    throw new Error(`Expected the bot to join the supergroup, received ${memberResponse.status}`);
  }

  const callBot = async (method: string, parameters: Record<string, unknown>) =>
    (await requestJson<BotApiAnswer>(api, 'POST', `${botApiPath}/${method}`, parameters)).body;
  const sendInvoice = (parameters: Record<string, unknown> = {}) =>
    callBot('sendInvoice', { chat_id: ada.id, ...VALID_INVOICE, ...parameters });
  const getHistory = async () =>
    (await requestJson<{ messages: TestMessage[] }>(
      api,
      'GET',
      `${accountPath}/conversations/private/${createdBot.bot.id}/messages`,
    )).body.messages;
  const readBotUpdates = createUpdateReader(api);
  const readUpdates = async () => withoutUpdateIds(await readBotUpdates(botApiPath));
  await readUpdates();

  const emulatorDisposal = disposalOnFailure.move();
  return {
    api,
    sessionPath,
    ada,
    bot: createdBot.bot,
    privateChat,
    supergroupId: supergroup.id,
    accountPath,
    sendAccountMessage,
    callBot,
    sendInvoice,
    getHistory,
    readUpdates,
    [Symbol.asyncDispose]: () => emulatorDisposal.disposeAsync(),
  };
}

/** Sends a valid invoice and returns its message as the bot sees it. */
async function sendValidInvoice(
  fixture: Awaited<ReturnType<typeof createInvoiceFixture>>,
  parameters: Record<string, unknown> = {},
): Promise<TestMessage> {
  const answer = await fixture.sendInvoice(parameters);
  if (!answer.ok) {
    throw new Error(`Expected the invoice to be sent, received ${answer.description}`);
  }
  return answer.result as TestMessage;
}

Deno.test('a bot sends an invoice in Telegram Stars without a start parameter', async () => {
  await using fixture = await createInvoiceFixture();
  const { ada, bot, getHistory, readUpdates } = fixture;
  const sent = await sendValidInvoice(fixture);

  assertEqualsInFieldOrder(
    sent.invoice,
    {
      title: 'Premium access',
      description: 'Unlocks every premium chapter',
      start_parameter: '',
      currency: 'XTR',
      total_amount: 50,
    },
    'Expected the invoice as JsonInvoice shows it, without its payload',
  );
  assertEquals(
    [sent.from?.id, 'reply_markup' in sent, JSON.stringify(sent).includes('order-42')],
    [bot.id, false, false],
    'Expected the bot as sender, no synthesized Pay button, and no payload anywhere',
  );
  const history = await getHistory();
  assertEquals(history.at(-1), sent, 'Expected the conversation to show the invoice alike');
  assertEquals(await readUpdates(), [], 'Expected no update for the bot of its own invoice');
  assertEquals(ada.id > 0, true);
});

Deno.test('an invoice cleans its start parameter and accepts the options Stars ignore', async () => {
  await using fixture = await createInvoiceFixture();
  const cleaned = await sendValidInvoice(fixture, { start_parameter: 'deep\u0007link\rx' });
  const explicitlyEmpty = await sendValidInvoice(fixture, {
    start_parameter: '',
    provider_token: '',
    max_tip_amount: 0,
    suggested_tip_amounts: [],
    need_name: true,
    need_phone_number: true,
    need_email: true,
    need_shipping_address: true,
    send_phone_number_to_provider: true,
    send_email_to_provider: true,
    is_flexible: true,
    reply_markup: { inline_keyboard: [] },
  });
  assertEquals(
    [cleaned.invoice?.start_parameter, explicitlyEmpty.invoice?.start_parameter],
    ['deep linkx', ''],
    'Expected the start parameter cleaned as an input string, and empty when none was given',
  );
  assertEquals('reply_markup' in explicitlyEmpty, false);
  assertEquals(await fixture.readUpdates(), [], 'Expected no shipping query or other update');
});

Deno.test('an invoice is checked against its documented limits by characters and bytes', async () => {
  await using fixture = await createInvoiceFixture();
  const accepted = [
    { title: '😀'.repeat(32) },
    { description: 'd'.repeat(255) },
    // 64 two-byte characters fill the payload's 128 bytes.
    { payload: 'é'.repeat(64) },
    { prices: [{ label: 'Access', amount: 999_999_999_999 }] },
  ];
  for (const parameters of accepted) {
    const answer = await fixture.sendInvoice(parameters);
    assertEquals(answer.ok, true, `Expected ${JSON.stringify(parameters)} to be accepted`);
  }
  const refused: Array<readonly [Record<string, unknown>, string]> = [
    [{ title: '😀'.repeat(33) }, 'Bad Request: invoice title must have 1-32 characters'],
    [{ title: '\r' }, 'Bad Request: invoice title must have 1-32 characters'],
    [
      { description: 'd'.repeat(256) },
      'Bad Request: invoice description must have 1-255 characters',
    ],
    // 43 three-byte characters are 129 bytes.
    [{ payload: '€'.repeat(43) }, 'Bad Request: invoice payload must have 1-128 bytes'],
  ];
  for (const [parameters, description] of refused) {
    assertEquals(
      await fixture.sendInvoice(parameters),
      { ok: false, error_code: 400, description },
      `Expected ${JSON.stringify(parameters)} to be refused`,
    );
  }
});

Deno.test('an invoice with text that is not well-formed Unicode is refused', async () => {
  await using fixture = await createInvoiceFixture();
  const cases: Array<readonly [Record<string, unknown>, string]> = [
    [{ payload: 'order\ud800' }, 'Bad Request: the payload must be encoded in UTF-8'],
    [{ title: 'Premium\ud800' }, 'Bad Request: invoice title must be encoded in UTF-8'],
    [{ description: '\udc00' }, 'Bad Request: invoice description must be encoded in UTF-8'],
    [
      { start_parameter: 'deep\ud800' },
      'Bad Request: invoice bot start parameter must be encoded in UTF-8',
    ],
    [
      { prices: [{ label: 'Access\ud800', amount: 5 }] },
      'Bad Request: price part label must be encoded in UTF-8',
    ],
  ];
  for (const [parameters, description] of cases) {
    assertEquals(
      await fixture.sendInvoice(parameters),
      { ok: false, error_code: 400, description },
      `Expected ${JSON.stringify(parameters)} to be refused`,
    );
  }
});

Deno.test('an invoice in Telegram Stars needs one positive integral price', async () => {
  await using fixture = await createInvoiceFixture();
  const cases: Array<readonly [unknown, string]> = [
    ['[', "Bad Request: can't parse prices JSON object"],
    [{ label: 'Access', amount: 5 }, 'Bad Request: expected an Array of LabeledPrice'],
    [['Access'], "Bad Request: can't parse LabeledPrice: LabeledPrice must be an Object"],
    [[{ amount: 5 }], 'Bad Request: can\'t parse LabeledPrice: Can\'t find field "label"'],
    [
      [{ label: '', amount: 5 }],
      "Bad Request: can't parse LabeledPrice: LabeledPrice label must be non-empty",
    ],
    [[{ label: 'Access' }], 'Bad Request: can\'t parse LabeledPrice: Can\'t find field "amount"'],
    [
      [{ label: 'Access', amount: 1.5 }],
      'Bad Request: can\'t parse LabeledPrice: Field "amount" must be a valid Number',
    ],
    [[], 'Bad Request: there must be at least one price part'],
    [null, 'Bad Request: there must be at least one price part'],
    [[{ label: 'Access', amount: 0 }], 'Bad Request: total price must be positive'],
    [[{ label: 'Access', amount: -5 }], 'Bad Request: total price must be positive'],
    [
      [{ label: 'Access', amount: 1_000_000_000_000 }],
      'Bad Request: too big amount of the currency specified',
    ],
    [
      [{ label: 'Access', amount: 30 }, { label: 'Bonus', amount: 20 }],
      'Bad Request: invoices in Telegram Stars must have exactly one price',
    ],
  ];
  for (const [prices, description] of cases) {
    assertEquals(
      await fixture.sendInvoice({ prices: typeof prices === 'string' ? prices : prices }),
      { ok: false, error_code: 400, description },
      `Expected the prices ${JSON.stringify(prices)} to be refused`,
    );
  }
  assertEquals(
    await fixture.sendInvoice({ prices: undefined }),
    { ok: false, error_code: 400, description: 'Bad Request: parameter "prices" is required' },
  );
});

Deno.test('an invoice option the emulator does not support is refused explicitly', async () => {
  await using fixture = await createInvoiceFixture();
  const { supergroupId } = fixture;
  const cases: Array<readonly [Record<string, unknown>, string]> = [
    [
      { currency: 'USD' },
      'Bad Request: only invoices in Telegram Stars are supported; currency must be XTR',
    ],
    [
      { provider_token: '123:TEST' },
      'Bad Request: payment providers are not supported; invoices in Telegram Stars take an ' +
      'empty provider_token',
    ],
    [{ provider_data: '{}' }, 'Bad Request: payment provider data is not supported'],
    [
      { photo_url: 'https://example.com/a.png' },
      'Bad Request: invoice product photos are not supported',
    ],
    [{ photo_width: 512 }, 'Bad Request: invoice product photos are not supported'],
    [{ max_tip_amount: 5 }, 'Bad Request: tips are not supported for payments in Telegram Stars'],
    [
      { suggested_tip_amounts: [5] },
      'Bad Request: tips are not supported for payments in Telegram Stars',
    ],
    [{ max_tip_amount: -1 }, 'Bad Request: invalid max_tip_amount of the currency specified'],
    [{ max_tip_amount: 'many' }, 'Bad Request: can\'t parse "max_tip_amount" as Number'],
    [
      { reply_markup: { inline_keyboard: [[{ text: 'Terms', url: 'https://example.com/' }]] } },
      'Bad Request: invoice keyboards are not supported; send the invoice without reply_markup ' +
      'to show its Pay button',
    ],
    [
      { reply_markup: { remove_keyboard: true } },
      'Bad Request: invoice keyboards are not supported; send the invoice without reply_markup ' +
      'to show its Pay button',
    ],
    [
      { chat_id: supergroupId },
      'Bad Request: invoices outside private chats are not supported',
    ],
  ];
  for (const [parameters, description] of cases) {
    assertEquals(
      await fixture.sendInvoice(parameters),
      { ok: false, error_code: 400, description },
      `Expected ${JSON.stringify(parameters)} to be refused`,
    );
  }
});

Deno.test('refused invoices change no message or update, and are recorded as failed calls', async () => {
  await using fixture = await createInvoiceFixture();
  const { api, sessionPath, ada, getHistory, readUpdates, callBot } = fixture;
  const historyBefore = await getHistory();
  await fixture.sendInvoice({ title: '' });
  await fixture.sendInvoice({ prices: [] });
  await fixture.sendInvoice({ currency: 'EUR' });
  await callBot('sendInvoice', { ...VALID_INVOICE, chat_id: 999_999_999 });
  assertEquals(await getHistory(), historyBefore, 'Expected no invoice to be stored');
  assertEquals(await readUpdates(), [], 'Expected no update');
  const sent = await sendValidInvoice(fixture);
  assertEquals((await getHistory()).at(-1)?.message_id, sent.message_id);

  const { body: { entries } } = await requestJson<{
    entries: Array<{ readonly method: string; readonly answer: BotApiAnswer }>;
  }>(api, 'GET', `${sessionPath}/bot-activity?kind=bot_api_call&method=sendInvoice`);
  assertEquals(
    entries.map(({ answer }) => answer.description ?? 'ok'),
    [
      'Bad Request: parameter "title" is required',
      'Bad Request: there must be at least one price part',
      'Bad Request: only invoices in Telegram Stars are supported; currency must be XTR',
      'Bad Request: chat not found',
      'ok',
    ],
    'Expected every call recorded with its answer',
  );
  assertEquals(ada.id > 0, true);
});

Deno.test('an invoice to an account that blocks the bot is refused as any message is', async () => {
  await using fixture = await createInvoiceFixture();
  const { api, accountPath, bot, getHistory } = fixture;
  const historyBefore = await getHistory();
  const block = await api.request(`${accountPath}/blocked-bots/${bot.id}`, { method: 'PUT' });
  assertEquals(block.status, 204);
  assertEquals(await fixture.sendInvoice(), {
    ok: false,
    error_code: 403,
    description: 'Forbidden: bot was blocked by the user',
  });
  assertEquals(await getHistory(), historyBefore);
});

Deno.test('an invoice cannot be edited, forwarded or copied, and is neither text nor a poll', async () => {
  await using fixture = await createInvoiceFixture();
  const { ada, callBot, supergroupId, getHistory } = fixture;
  const { message_id: messageId } = await sendValidInvoice(fixture);
  const target = { chat_id: ada.id, message_id: messageId };
  const editingUnsupported = {
    ok: false,
    error_code: 400,
    description: 'Bad Request: editing invoice messages is not supported',
  };
  assertEquals(
    await callBot('editMessageText', { ...target, text: 'Changed' }),
    editingUnsupported,
  );
  assertEquals(
    await callBot('editMessageCaption', { ...target, caption: 'Changed' }),
    editingUnsupported,
  );
  assertEquals(
    await callBot('editMessageReplyMarkup', {
      ...target,
      reply_markup: { inline_keyboard: [[{ text: 'Terms', url: 'https://example.com/' }]] },
    }),
    editingUnsupported,
  );
  assertEquals(await callBot('stopPoll', target), {
    ok: false,
    error_code: 400,
    description: 'Bad Request: message is not a poll',
  });

  const forwardingUnsupported = {
    ok: false,
    error_code: 400,
    description: 'Bad Request: forwarding invoice messages is not supported',
  };
  assertEquals(
    await callBot('forwardMessage', {
      chat_id: supergroupId,
      from_chat_id: ada.id,
      message_id: messageId,
    }),
    forwardingUnsupported,
  );
  const { result: text } = await callBot('sendMessage', { chat_id: ada.id, text: 'Receipt soon' });
  const textId = (text as TestMessage).message_id;
  assertEquals(
    await callBot('forwardMessages', {
      chat_id: supergroupId,
      from_chat_id: ada.id,
      message_ids: [messageId, textId],
    }),
    forwardingUnsupported,
  );
  // TDLib's `can_forward_message_content` copies no invoice, so a copy skips it.
  assertEquals(
    await callBot('copyMessage', {
      chat_id: supergroupId,
      from_chat_id: ada.id,
      message_id: messageId,
    }),
    { ok: false, error_code: 400, description: "Bad Request: the message can't be copied" },
  );
  const copies = await callBot('copyMessages', {
    chat_id: supergroupId,
    from_chat_id: ada.id,
    message_ids: [messageId, textId],
  });
  assertEquals((copies.result as unknown[]).length, 1, 'Expected only the text to be copied');

  const accountForward = await fixture.sendAccountMessage({
    to: { type: 'supergroup', chatId: supergroupId },
    forward: { chat: fixture.privateChat, message_id: messageId },
  });
  assertEquals(
    [accountForward.status, accountForward.body],
    [400, { reason: 'invoice_forwarding_unsupported' }],
  );
  const history = await getHistory();
  assertEquals(
    history.find((message) => message.message_id === messageId)?.invoice?.title,
    'Premium access',
    'Expected the invoice unchanged',
  );
});

Deno.test('an invoice is replied to, pinned and deleted as any message', async () => {
  await using fixture = await createInvoiceFixture();
  const { ada, callBot, supergroupId, getHistory, readUpdates, sendAccountMessage, privateChat } =
    fixture;
  const invoice = await sendValidInvoice(fixture);
  const expectedInvoice = invoice.invoice;

  const accountReply = await sendAccountMessage({
    to: privateChat,
    text: 'Paying soon',
    reply_to_message_id: invoice.message_id,
  });
  assertEquals(accountReply.body.message?.reply_to_message?.invoice, expectedInvoice);
  const [update] = await readUpdates() as Array<{ readonly message: TestMessage }>;
  assertEquals(update.message.reply_to_message?.invoice, expectedInvoice);

  const externalReply = await callBot('sendMessage', {
    chat_id: supergroupId,
    text: 'Ada is buying',
    reply_parameters: { chat_id: ada.id, message_id: invoice.message_id },
  });
  assertEquals(
    (externalReply.result as TestMessage).external_reply?.invoice,
    expectedInvoice,
    'Expected a reply from another chat to show the invoice',
  );

  assertEquals(
    await callBot('pinChatMessage', { chat_id: ada.id, message_id: invoice.message_id }),
    { ok: true, result: true },
  );
  const pin = (await getHistory()).at(-1);
  assertEquals(pin?.pinned_message?.invoice, expectedInvoice);

  assertEquals(
    await callBot('deleteMessage', { chat_id: ada.id, message_id: invoice.message_id }),
    { ok: true, result: true },
  );
  assertEquals(
    (await getHistory()).some((message) => message.message_id === invoice.message_id),
    false,
    'Expected the deleted invoice gone from the conversation',
  );
});

Deno.test('a grammY bot sends an invoice without a start parameter', async () => {
  await using emulator = createTestInProcessEmulator();
  const { fetch } = emulator;
  const { result: session } = await emulator.client.createSession();
  try {
    const { result: shop } = await session.createBot({ first_name: 'Shop', username: 'shop_bot' });
    const { result: { account: ada } } = await session.createAccount({ first_name: 'Ada' });
    await ada.sendMessage({ to: { type: 'private', botId: shop.bot.id }, text: '/start' });
    const bot = new Bot(shop.token, { client: { apiRoot: session.botApiRoot, fetch } });

    const message = await bot.api.sendInvoice(
      ada.id,
      'Premium access',
      'Unlocks every premium chapter',
      'order-42',
      'XTR',
      [{ label: 'Access', amount: 50 }],
    );

    assertEquals(message.invoice, {
      title: 'Premium access',
      description: 'Unlocks every premium chapter',
      start_parameter: '',
      currency: 'XTR',
      total_amount: 50,
    });
  } finally {
    await session.end();
  }
});
