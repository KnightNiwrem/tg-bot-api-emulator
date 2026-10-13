/**
 * Accounts check out the invoices bots send to their private chats: a checkout reaches the bot as
 * a `pre_checkout_query`, which the bot approves or refuses once with `answerPreCheckoutQuery`, and
 * the account abandons an attempt, or a test expires a pending one. Answering creates no payment.
 */
import { assertEquals, assertRejects } from '@std/assert';
import { Bot } from 'https://cdn.jsdelivr.net/gh/grammyjs/grammY@^1.46.0/src/bot.ts';
import { webhookCallback } from 'https://cdn.jsdelivr.net/gh/grammyjs/grammY@^1.46.0/src/convenience/webhook.ts';

import { EmulationControlError } from '../clients/typescript/emulation_client_error.ts';
import type { EmulationSessionClient } from '../clients/typescript/emulation_session_client.ts';
import type { ActionReceipt } from '../clients/typescript/types.ts';
import {
  createTestInProcessEmulator,
  type TestInProcessEmulator,
} from './support/emulation_api.ts';
import { assertEqualsInFieldOrder } from './support/field_order_assertion.ts';

interface BotApiAnswer {
  readonly ok: boolean;
  readonly result?: unknown;
  readonly error_code?: number;
  readonly description?: string;
}

/** The parameters of a valid invoice, without a start parameter, as typical Stars bots send it. */
const VALID_INVOICE = {
  title: 'Premium access',
  description: 'Unlocks every premium chapter',
  payload: 'order-42',
  currency: 'XTR',
  prices: [{ label: 'Access', amount: 50 }],
} as const;

/** The invoice as the account's checkout attempt shows it. */
const SHOWN_INVOICE = {
  title: 'Premium access',
  description: 'Unlocks every premium chapter',
  start_parameter: '',
  currency: 'XTR',
  total_amount: 50,
} as const;

const QUERY_INVALID = {
  ok: false,
  error_code: 400,
  description: 'Bad Request: query is too old and response timeout expired or query ID is invalid',
} as const;

/** A bot of a session, which a test calls through the Bot API by its token. */
interface FixtureBot {
  readonly id: number;
  readonly token: string;
  call(method: string, parameters?: Record<string, unknown>): Promise<BotApiAnswer>;
  /** Reads the bot's updates since the last read, without their IDs, confirming earlier ones. */
  readUpdates(): Promise<readonly Record<string, unknown>[]>;
}

/**
 * A session where Ada and Ben have started their private chats with Shop, whose updates are read,
 * and Ada's chat holds an invoice from Shop. Ben's chat holds a text message.
 */
async function createCheckoutFixture() {
  await using disposalOnFailure = new AsyncDisposableStack();
  const emulator = disposalOnFailure.use(createTestInProcessEmulator());
  const { result: session } = await emulator.client.createSession();
  const shop = await createFixtureBot(emulator, session, 'shop_bot');
  const { result: { account: ada } } = await session.createAccount({ first_name: 'Ada' });
  const { result: { account: ben } } = await session.createAccount({ first_name: 'Ben' });
  const shopChat = { type: 'private', botId: shop.id } as const;
  await ada.sendMessage({ to: shopChat, text: '/start' });
  await ben.sendMessage({ to: shopChat, text: '/start' });
  const invoice = await shop.call('sendInvoice', { chat_id: ada.id, ...VALID_INVOICE });
  if (!invoice.ok) {
    throw new Error(`Expected the invoice to be sent, received ${invoice.description}`);
  }
  const invoiceMessageId = (invoice.result as { readonly message_id: number }).message_id;
  await shop.readUpdates();

  const emulatorDisposal = disposalOnFailure.move();
  return {
    emulator,
    session,
    shop,
    ada,
    ben,
    shopChat,
    invoiceMessageId,
    submitAdaCheckout: async () =>
      (await ada.submitCheckout({ chat: shopChat, message_id: invoiceMessageId })).result,
    answer: (preCheckoutQueryId: string, answer: Record<string, unknown>) =>
      shop.call('answerPreCheckoutQuery', { pre_checkout_query_id: preCheckoutQueryId, ...answer }),
    [Symbol.asyncDispose]: () => emulatorDisposal.disposeAsync(),
  };
}

async function createFixtureBot(
  emulator: TestInProcessEmulator,
  session: EmulationSessionClient,
  username: string,
): Promise<FixtureBot> {
  const { result: { token, bot } } = await session.createBot({ first_name: 'Shop', username });
  const call = async (method: string, parameters: Record<string, unknown> = {}) => {
    const response = await emulator.fetch(`${session.botApiRoot}/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(parameters),
    });
    return await response.json() as BotApiAnswer;
  };
  let nextOffset = 0;
  return {
    id: bot.id,
    token,
    call,
    readUpdates: async () => {
      const { result } = await call('getUpdates', { offset: nextOffset });
      const updates = result as readonly { readonly update_id: number }[];
      nextOffset = (updates.at(-1)?.update_id ?? nextOffset - 1) + 1;
      return updates.map(({ update_id: _updateId, ...update }) => update);
    },
  };
}

/** Expects a control call to be refused with the status and reason. */
async function expectRefusal(
  call: () => Promise<unknown>,
  status: number,
  reason: string,
): Promise<void> {
  const error = await assertRejects(call, EmulationControlError);
  assertEquals([error.status, error.body.reason], [status, reason]);
}

Deno.test("an account's checkout reaches the bot as a pre-checkout query from the payer", async () => {
  await using fixture = await createCheckoutFixture();
  const { ada, shop, shopChat, invoiceMessageId } = fixture;

  const { result: attempt, receipt } = await ada.submitCheckout({
    chat: shopChat,
    message_id: invoiceMessageId,
  });

  assertEquals(attempt, {
    id: attempt.id,
    chat: shopChat,
    message_id: invoiceMessageId,
    invoice: SHOWN_INVOICE,
    status: 'pending',
  });
  const [update, ...otherUpdates] = await shop.readUpdates();
  assertEquals(otherUpdates, [], 'Expected the query alone');
  assertEqualsInFieldOrder(update, {
    pre_checkout_query: {
      id: attempt.id,
      from: { first_name: 'Ada', id: ada.id, is_bot: false },
      currency: 'XTR',
      total_amount: 50,
      invoice_payload: 'order-42',
    },
  });
  assertEquals(await ada.getCheckoutAttempt(attempt.id), attempt);
  const delivery = await fixture.session.botActivity({ bot_id: shop.id }).waitFor(
    { kind: 'update_delivered' },
    { after: receipt },
  );
  assertEquals(
    [delivery.user_id, delivery.chat_id],
    [ada.id, undefined],
    'Expected the delivery to name the payer and no chat',
  );
});

Deno.test('an approval answers true and creates no payment', async () => {
  await using fixture = await createCheckoutFixture();
  const { ada, shop, shopChat } = fixture;
  const attempt = await fixture.submitAdaCheckout();
  await shop.readUpdates();
  const historyBefore = await ada.getMessages({ chat: shopChat });

  // An approval ignores the error message.
  assertEquals(
    await fixture.answer(attempt.id, { ok: true, error_message: 'ignored' }),
    { ok: true, result: true },
  );

  assertEquals(await ada.getCheckoutAttempt(attempt.id), { ...attempt, status: 'approved' });
  assertEquals(await ada.getMessages({ chat: shopChat }), historyBefore, 'Expected no payment');
  assertEquals(await shop.readUpdates(), [], 'Expected no update for the bot');
});

Deno.test('a refusal needs an error message, which the account reads on its attempt', async () => {
  await using fixture = await createCheckoutFixture();
  const { ada } = fixture;
  const attempt = await fixture.submitAdaCheckout();

  for (const answer of [{ ok: false }, { ok: false, error_message: '' }, {}]) {
    assertEquals(await fixture.answer(attempt.id, answer), {
      ok: false,
      error_code: 400,
      description: 'Bad Request: parameter "error_message" is required',
    });
  }
  assertEquals(await ada.getCheckoutAttempt(attempt.id), attempt, 'Expected it still pending');

  assertEquals(
    await fixture.answer(attempt.id, { ok: false, error_message: 'Sold out' }),
    { ok: true, result: true },
  );
  assertEquals(await ada.getCheckoutAttempt(attempt.id), {
    ...attempt,
    status: 'refused',
    error_message: 'Sold out',
  });
});

Deno.test('a query accepts one answer, and none once its attempt has ended', async () => {
  await using fixture = await createCheckoutFixture();
  const { ada } = fixture;

  const approved = await fixture.submitAdaCheckout();
  await fixture.answer(approved.id, { ok: true });
  assertEquals(await fixture.answer(approved.id, { ok: true }), QUERY_INVALID);
  assertEquals(
    await fixture.answer(approved.id, { ok: false, error_message: 'Changed my mind' }),
    QUERY_INVALID,
  );
  assertEquals((await ada.getCheckoutAttempt(approved.id)).status, 'approved');
  await ada.abandonCheckoutAttempt(approved.id);

  const refused = await fixture.submitAdaCheckout();
  await fixture.answer(refused.id, { ok: false, error_message: 'Sold out' });
  assertEquals(await fixture.answer(refused.id, { ok: true }), QUERY_INVALID);
  assertEquals(await ada.getCheckoutAttempt(refused.id), {
    ...refused,
    status: 'refused',
    error_message: 'Sold out',
  });

  const abandoned = await fixture.submitAdaCheckout();
  await ada.abandonCheckoutAttempt(abandoned.id);
  assertEquals(await fixture.answer(abandoned.id, { ok: true }), QUERY_INVALID);

  const expired = await fixture.submitAdaCheckout();
  await ada.expireCheckoutAttempt(expired.id);
  assertEquals(await fixture.answer(expired.id, { ok: true }), QUERY_INVALID);

  assertEquals(
    [approved.id, refused.id, abandoned.id, expired.id],
    ['1', '2', '3', '4'],
    'Expected each new attempt of the unpaid invoice to have a fresh query ID',
  );
  assertEquals(
    [
      (await ada.getCheckoutAttempt(abandoned.id)).status,
      (await ada.getCheckoutAttempt(expired.id)).status,
    ],
    ['abandoned', 'expired'],
  );
});

Deno.test('abandonment and expiry end attempts without telling the bot', async () => {
  await using fixture = await createCheckoutFixture();
  const { ada, shop } = fixture;

  const pending = await fixture.submitAdaCheckout();
  const { result: abandoned } = await ada.abandonCheckoutAttempt(pending.id);
  assertEquals(abandoned, { ...pending, status: 'abandoned' });

  const approved = await fixture.submitAdaCheckout();
  await fixture.answer(approved.id, { ok: true });
  assertEquals(
    (await ada.abandonCheckoutAttempt(approved.id)).result,
    { ...approved, status: 'abandoned' },
    'Expected an approved attempt abandoned',
  );

  const expiring = await fixture.submitAdaCheckout();
  const { result: expired } = await ada.expireCheckoutAttempt(expiring.id);
  assertEquals(expired, { ...expiring, status: 'expired' });

  // Each query stays queued; no update tells the bot of an attempt's end.
  assertEquals(
    (await shop.readUpdates()).map((update) => Object.keys(update)),
    [['pre_checkout_query'], ['pre_checkout_query'], ['pre_checkout_query']],
  );
});

Deno.test('ended and answered attempts refuse the controls that do not apply', async () => {
  await using fixture = await createCheckoutFixture();
  const { ada } = fixture;

  const approved = await fixture.submitAdaCheckout();
  await fixture.answer(approved.id, { ok: true });
  await expectRefusal(
    () => ada.expireCheckoutAttempt(approved.id),
    409,
    'checkout_attempt_not_pending',
  );
  await ada.abandonCheckoutAttempt(approved.id);
  await expectRefusal(() => ada.abandonCheckoutAttempt(approved.id), 409, 'checkout_attempt_ended');

  const refused = await fixture.submitAdaCheckout();
  await fixture.answer(refused.id, { ok: false, error_message: 'Sold out' });
  await expectRefusal(() => ada.abandonCheckoutAttempt(refused.id), 409, 'checkout_attempt_ended');
  await expectRefusal(
    () => ada.expireCheckoutAttempt(refused.id),
    409,
    'checkout_attempt_not_pending',
  );

  const expired = await fixture.submitAdaCheckout();
  await ada.expireCheckoutAttempt(expired.id);
  await expectRefusal(() => ada.abandonCheckoutAttempt(expired.id), 409, 'checkout_attempt_ended');
  await expectRefusal(
    () => ada.expireCheckoutAttempt(expired.id),
    409,
    'checkout_attempt_not_pending',
  );

  assertEquals(
    [
      (await ada.getCheckoutAttempt(approved.id)).status,
      (await ada.getCheckoutAttempt(refused.id)).status,
      (await ada.getCheckoutAttempt(expired.id)).status,
    ],
    ['abandoned', 'refused', 'expired'],
    'Expected the refused controls to change nothing',
  );
});

Deno.test('an invoice has one active attempt at a time', async () => {
  await using fixture = await createCheckoutFixture();
  const { ada, shop, shopChat, invoiceMessageId } = fixture;
  const pending = await fixture.submitAdaCheckout();
  await shop.readUpdates();

  await expectRefusal(
    () => ada.submitCheckout({ chat: shopChat, message_id: invoiceMessageId }),
    409,
    'checkout_attempt_active',
  );
  await fixture.answer(pending.id, { ok: true });
  await expectRefusal(
    () => ada.submitCheckout({ chat: shopChat, message_id: invoiceMessageId }),
    409,
    'checkout_attempt_active',
  );

  assertEquals(await shop.readUpdates(), [], 'Expected no query for a refused checkout');
  await ada.abandonCheckoutAttempt(pending.id);
  assertEquals(
    (await fixture.submitAdaCheckout()).id,
    '2',
    'Expected the refused checkouts to use no query ID',
  );
});

Deno.test('a checkout is refused before it starts an attempt', async () => {
  await using fixture = await createCheckoutFixture();
  const { session, ada, ben, shop, shopChat, invoiceMessageId } = fixture;
  const { result: textMessage } = await ada.sendMessage({ to: shopChat, text: 'Hi' });
  await shop.readUpdates();
  const { result: other } = await session.createBot({ first_name: 'Other', username: 'other_bot' });

  await expectRefusal(
    () => ada.submitCheckout({ chat: shopChat, message_id: textMessage.message_id }),
    400,
    'message_not_invoice',
  );
  await expectRefusal(
    () => ada.submitCheckout({ chat: shopChat, message_id: invoiceMessageId + 100 }),
    404,
    'message_not_found',
  );
  await expectRefusal(
    () => ada.submitCheckout({ chat: { type: 'private', botId: other.bot.id }, message_id: 1 }),
    404,
    'message_not_found',
  );
  await expectRefusal(
    () => ada.submitCheckout({ chat: { type: 'private', botId: 999_999 }, message_id: 1 }),
    404,
    'bot_not_found',
  );
  // Ben's chat with Shop numbers its own messages: the ID of Ada's invoice is Ben's text there.
  await expectRefusal(
    () => ben.submitCheckout({ chat: shopChat, message_id: invoiceMessageId }),
    404,
    'message_not_found',
  );
  await ada.blockBot({ botId: shop.id });
  await shop.readUpdates();
  await expectRefusal(
    () => ada.submitCheckout({ chat: shopChat, message_id: invoiceMessageId }),
    409,
    'bot_blocked',
  );
  const invalid = await fixture.emulator.request(
    `/sessions/${session.id}/accounts/${ada.id}/checkout-attempts`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat: { type: 'supergroup', chatId: -1001 }, message_id: 1 }),
    },
  );
  assertEquals(
    [invalid.status, ((await invalid.json()) as { reason: string }).reason],
    [400, 'invalid_request'],
  );

  assertEquals(await shop.readUpdates(), [], 'Expected no query');
  await ada.unblockBot({ botId: shop.id });
  assertEquals(
    (await fixture.submitAdaCheckout()).id,
    '1',
    'Expected the refused checkouts to use no query ID',
  );
});

Deno.test("only the payer controls an attempt, and only the invoice's bot answers it", async () => {
  await using fixture = await createCheckoutFixture();
  const { emulator, session, ada, ben } = fixture;
  const attempt = await fixture.submitAdaCheckout();
  const other = await createFixtureBot(emulator, session, 'other_bot');

  await expectRefusal(() => ben.getCheckoutAttempt(attempt.id), 404, 'checkout_attempt_not_found');
  await expectRefusal(
    () => ben.abandonCheckoutAttempt(attempt.id),
    404,
    'checkout_attempt_not_found',
  );
  await expectRefusal(
    () => ben.expireCheckoutAttempt(attempt.id),
    404,
    'checkout_attempt_not_found',
  );
  await expectRefusal(() => ada.getCheckoutAttempt('999'), 404, 'checkout_attempt_not_found');
  assertEquals(
    await other.call('answerPreCheckoutQuery', { pre_checkout_query_id: attempt.id, ok: true }),
    QUERY_INVALID,
  );
  assertEquals(await fixture.answer('999', { ok: true }), QUERY_INVALID);

  // Another session's bot knows no query of this one, whatever its ID.
  const { result: otherSession } = await emulator.client.createSession();
  try {
    const stranger = await createFixtureBot(emulator, otherSession, 'shop_bot');
    assertEquals(
      await stranger.call('answerPreCheckoutQuery', {
        pre_checkout_query_id: attempt.id,
        ok: true,
      }),
      QUERY_INVALID,
    );
  } finally {
    await otherSession.end();
  }

  assertEquals(await ada.getCheckoutAttempt(attempt.id), attempt, 'Expected it still pending');
  assertEquals(await fixture.answer(attempt.id, { ok: true }), { ok: true, result: true });
});

Deno.test('the bot answers from the attempt once the invoice is deleted and the bot blocked', async () => {
  await using fixture = await createCheckoutFixture();
  const { ada, shop, shopChat, invoiceMessageId } = fixture;
  const attempt = await fixture.submitAdaCheckout();

  assertEquals(
    await shop.call('deleteMessage', { chat_id: ada.id, message_id: invoiceMessageId }),
    { ok: true, result: true },
  );
  await ada.blockBot({ botId: shop.id });

  assertEquals(await fixture.answer(attempt.id, { ok: true }), { ok: true, result: true });
  assertEquals(
    await ada.getCheckoutAttempt(attempt.id),
    { ...attempt, status: 'approved' },
    'Expected the attempt to keep the invoice as Ada confirmed it',
  );
  await ada.abandonCheckoutAttempt(attempt.id);
  await ada.unblockBot({ botId: shop.id });
  await expectRefusal(
    () => ada.submitCheckout({ chat: shopChat, message_id: invoiceMessageId }),
    404,
    'message_not_found',
  );
});

Deno.test('a bot receives pre-checkout queries and messages as it subscribes to them', async () => {
  await using fixture = await createCheckoutFixture();
  const { ada, shop, shopChat } = fixture;

  await shop.call('getUpdates', { allowed_updates: ['message'] });
  const unsubscribed = await fixture.submitAdaCheckout();
  await ada.sendMessage({ to: shopChat, text: 'Paid?' });
  assertEquals(
    (await shop.readUpdates()).map((update) => Object.keys(update)),
    [['message']],
    'Expected the message alone',
  );
  // The bot can still answer a query it never received.
  assertEquals(await fixture.answer(unsubscribed.id, { ok: true }), { ok: true, result: true });
  await ada.abandonCheckoutAttempt(unsubscribed.id);

  await shop.call('getUpdates', { allowed_updates: ['pre_checkout_query'] });
  const subscribed = await fixture.submitAdaCheckout();
  await ada.sendMessage({ to: shopChat, text: 'Again' });
  assertEquals(
    await shop.readUpdates(),
    [{
      pre_checkout_query: {
        id: subscribed.id,
        from: { id: ada.id, is_bot: false, first_name: 'Ada' },
        currency: 'XTR',
        total_amount: 50,
        invoice_payload: 'order-42',
      },
    }],
    'Expected the query alone',
  );
});

Deno.test('a failed answer is recorded as bot activity and changes nothing', async () => {
  await using fixture = await createCheckoutFixture();
  const { session, ada, shop } = fixture;
  const attempt = await fixture.submitAdaCheckout();
  const activity = session.botActivity({ bot_id: shop.id });
  const before = await activity.position();

  assertEquals(await fixture.answer(attempt.id, { ok: false }), {
    ok: false,
    error_code: 400,
    description: 'Bad Request: parameter "error_message" is required',
  });
  assertEquals(await fixture.answer('999', { ok: true }), QUERY_INVALID);
  assertEquals(
    await shop.call('answerPreCheckoutQuery', {
      pre_checkout_query_id: attempt.id,
      ok: true,
      shipping_options: '[]',
    }),
    {
      ok: false,
      error_code: 400,
      description: 'Bad Request: invalid answerPreCheckoutQuery parameters: shipping_options',
    },
  );

  const missingMessage = await activity.waitFor(
    { method: 'answerPreCheckoutQuery', parameters: { pre_checkout_query_id: attempt.id } },
    { after: before },
  );
  const unknownQuery = await activity.waitFor(
    { method: 'answerPreCheckoutQuery', parameters: { pre_checkout_query_id: '999' } },
    { after: missingMessage.position },
  );
  assertEquals(
    [missingMessage.answer, unknownQuery.answer],
    [
      {
        ok: false,
        error_code: 400,
        description: 'Bad Request: parameter "error_message" is required',
      },
      QUERY_INVALID,
    ],
  );
  assertEquals(await ada.getCheckoutAttempt(attempt.id), attempt, 'Expected it still pending');
});

Deno.test('a grammY bot polling for updates refuses a checkout, which keeps access locked', async () => {
  await using fixture = await createCheckoutFixture();
  const { emulator, session, ada, shop } = fixture;
  const grammyBot = new Bot(shop.token, {
    client: { apiRoot: session.botApiRoot, fetch: emulator.fetch },
  });
  const unlockedPayers = new Set<number>();
  grammyBot.on(
    'pre_checkout_query',
    (context) => context.answerPreCheckoutQuery(false, { error_message: 'Sold out' }),
  );
  grammyBot.on('message:successful_payment', (context) => {
    unlockedPayers.add(context.from.id);
  });
  const polling = startPolling(grammyBot);
  try {
    await polling.started;
    const { result: attempt, receipt } = await ada.submitCheckout({
      chat: fixture.shopChat,
      message_id: fixture.invoiceMessageId,
    });
    await waitForAnswer(session, shop.id, attempt.id, receipt);

    assertEquals(
      [await ada.getCheckoutAttempt(attempt.id), unlockedPayers.has(ada.id)],
      [{ ...attempt, status: 'refused', error_message: 'Sold out' }, false],
    );
  } finally {
    await polling.stop();
  }
});

Deno.test('a grammY bot approves a checkout in its webhook response', async () => {
  await using fixture = await createCheckoutFixture();
  const { emulator, session, ada, shop } = fixture;
  const grammyBot = new Bot(shop.token, {
    client: {
      apiRoot: session.botApiRoot,
      fetch: emulator.fetch,
      canUseWebhookReply: (method) => method === 'answerPreCheckoutQuery',
    },
  });
  const unlockedPayers = new Set<number>();
  grammyBot.on('pre_checkout_query', (context) => context.answerPreCheckoutQuery(true));
  grammyBot.on('message:successful_payment', (context) => {
    unlockedPayers.add(context.from.id);
  });
  const handleWebhookRequest = webhookCallback(grammyBot, 'std/http');
  const webhookServer = Deno.serve(
    { hostname: '127.0.0.1', port: 0, onListen: () => {} },
    (request) => handleWebhookRequest(request),
  );
  try {
    await grammyBot.api.setWebhook(`http://127.0.0.1:${webhookServer.addr.port}/webhook`);
    const { result: attempt, receipt } = await ada.submitCheckout({
      chat: fixture.shopChat,
      message_id: fixture.invoiceMessageId,
    });
    const answer = await waitForAnswer(session, shop.id, attempt.id, receipt);

    assertEquals(
      [answer.via, answer.answer, await ada.getCheckoutAttempt(attempt.id)],
      ['webhook_reply', { ok: true, result: true }, { ...attempt, status: 'approved' }],
    );
    // Approval alone creates no payment, so the bot grants nothing.
    const { result: abandoned } = await ada.abandonCheckoutAttempt(attempt.id);
    assertEquals([abandoned.status, unlockedPayers.has(ada.id)], ['abandoned', false]);
  } finally {
    await session.end();
    await webhookServer.shutdown();
  }
});

/** Waits for the bot's answer to the query, which its handler sends after the checkout. */
function waitForAnswer(
  session: EmulationSessionClient,
  botId: number,
  preCheckoutQueryId: string,
  after: ActionReceipt,
) {
  return session.botActivity({ bot_id: botId }).waitFor(
    { method: 'answerPreCheckoutQuery', parameters: { pre_checkout_query_id: preCheckoutQueryId } },
    { after },
  );
}

/** Starts a grammY bot's polling, which `stop` ends and awaits. */
function startPolling(bot: Bot) {
  const started = Promise.withResolvers<void>();
  const polling = bot.start({ onStart: () => started.resolve() });
  // `stop` reports an error the bot stops with; until then, it is not unhandled.
  polling.catch(() => {});
  return {
    started: Promise.race([started.promise, polling]),
    stop: async () => {
      await bot.stop();
      await polling;
    },
  };
}
