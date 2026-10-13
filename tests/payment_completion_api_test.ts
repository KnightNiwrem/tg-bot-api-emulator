/**
 * Accounts complete the checkouts bots approved: completion pays the invoice for good and sends the
 * bot the payer's `successful_payment` service message in an ordinary `message` update. Nothing
 * else pays an invoice, and a paid invoice is never checked out again.
 */
import { assertEquals } from '@std/assert';
import { Bot } from 'https://cdn.jsdelivr.net/gh/grammyjs/grammY@^1.46.0/src/bot.ts';
import type { Context } from 'https://cdn.jsdelivr.net/gh/grammyjs/grammY@^1.46.0/src/context.ts';
import { webhookCallback } from 'https://cdn.jsdelivr.net/gh/grammyjs/grammY@^1.46.0/src/convenience/webhook.ts';

import type { CheckoutAttemptIn } from '../clients/typescript/types.ts';
import {
  createCheckoutFixture,
  expectRefusal,
  QUERY_INVALID,
  SHOWN_INVOICE,
  startPolling,
} from './support/checkout_fixture.ts';
import { assertEqualsInFieldOrder } from './support/field_order_assertion.ts';

/** The payment of the fixture's invoice, as the bot receives it, charged for its first attempt. */
const FIRST_ATTEMPT_PAYMENT = {
  currency: 'XTR',
  total_amount: 50,
  invoice_payload: 'order-42',
  telegram_payment_charge_id: 'emulator_telegram_charge_1',
  provider_payment_charge_id: 'emulator_provider_charge_1',
} as const;

type CheckoutFixture = Awaited<ReturnType<typeof createCheckoutFixture>>;

/** Starts Ada's checkout of the fixture's invoice, which Shop approves. */
async function approveAdaCheckout(fixture: CheckoutFixture) {
  const attempt = await fixture.submitAdaCheckout();
  const approval = await fixture.answer(attempt.id, { ok: true });
  if (!approval.ok) {
    throw new Error(`Expected the checkout to be approved, received ${approval.description}`);
  }
  return attempt;
}

/** Ada's checkout of the fixture's invoice, which Shop approved and Ada completed. */
async function completeAdaCheckout(
  fixture: CheckoutFixture,
): Promise<CheckoutAttemptIn<'completed'>> {
  const attempt = await approveAdaCheckout(fixture);
  return (await fixture.ada.completeCheckoutAttempt(attempt.id)).result;
}

Deno.test("completing an approved attempt sends the bot the payer's receipt", async () => {
  await using fixture = await createCheckoutFixture();
  const { ada, shop, shopChat, invoiceMessageId } = fixture;
  const attempt = await approveAdaCheckout(fixture);
  await shop.readUpdates();

  const { result: completed } = await ada.completeCheckoutAttempt(attempt.id);

  const receiptMessageId = completed.payment.receipt_message_id;
  assertEquals(completed, {
    id: attempt.id,
    chat: shopChat,
    message_id: invoiceMessageId,
    invoice: SHOWN_INVOICE,
    status: 'completed',
    payment: {
      receipt_message_id: receiptMessageId,
      telegram_payment_charge_id: 'emulator_telegram_charge_1',
      provider_payment_charge_id: 'emulator_provider_charge_1',
    },
  });
  const [update, ...otherUpdates] = await shop.readUpdates();
  assertEquals(otherUpdates, [], 'Expected the receipt alone');
  const receipt = (update as { readonly message: { readonly date: number } }).message;
  assertEqualsInFieldOrder(update, {
    message: {
      message_id: receiptMessageId,
      from: { first_name: 'Ada', id: ada.id, is_bot: false },
      chat: { id: ada.id, type: 'private', first_name: 'Ada' },
      date: receipt.date,
      successful_payment: FIRST_ATTEMPT_PAYMENT,
    },
  });
  assertEquals(await ada.getCheckoutAttempt(attempt.id), completed);
  const history = await ada.getMessages({ chat: shopChat });
  assertEquals(history.at(-1), receipt, 'Expected history to show the receipt as the bot does');
  assertEquals(
    history.find((message) => message.message_id === invoiceMessageId)?.invoice,
    SHOWN_INVOICE,
    'Expected the invoice to show no receipt',
  );
});

Deno.test('only an approved attempt completes, once', async () => {
  await using fixture = await createCheckoutFixture();
  const { emulator, ada, ben, shop, shopChat } = fixture;
  const historyBefore = await ada.getMessages({ chat: shopChat });

  const pending = await fixture.submitAdaCheckout();
  await expectRefusal(
    () => ada.completeCheckoutAttempt(pending.id),
    409,
    'checkout_attempt_not_approved',
  );
  await fixture.answer(pending.id, { ok: false, error_message: 'Sold out' });
  await expectRefusal(
    () => ada.completeCheckoutAttempt(pending.id),
    409,
    'checkout_attempt_not_approved',
  );

  const abandoned = await approveAdaCheckout(fixture);
  await ada.abandonCheckoutAttempt(abandoned.id);
  await expectRefusal(
    () => ada.completeCheckoutAttempt(abandoned.id),
    409,
    'checkout_attempt_not_approved',
  );

  const expired = await fixture.submitAdaCheckout();
  await ada.expireCheckoutAttempt(expired.id);
  await fixture.answer(expired.id, { ok: true });
  await expectRefusal(
    () => ada.completeCheckoutAttempt(expired.id),
    409,
    'checkout_attempt_not_approved',
  );

  const approved = await approveAdaCheckout(fixture);
  await expectRefusal(
    () => ben.completeCheckoutAttempt(approved.id),
    404,
    'checkout_attempt_not_found',
  );
  await expectRefusal(() => ada.completeCheckoutAttempt('999'), 404, 'checkout_attempt_not_found');
  // Another session's account knows no attempt of this one, whatever its ID.
  const { result: otherSession } = await emulator.client.createSession();
  try {
    const { result: { account: stranger } } = await otherSession.createAccount({
      first_name: 'Ada',
    });
    await expectRefusal(
      () => stranger.completeCheckoutAttempt(approved.id),
      404,
      'checkout_attempt_not_found',
    );
  } finally {
    await otherSession.end();
  }
  assertEquals(
    await ada.getMessages({ chat: shopChat }),
    historyBefore,
    'Expected no attempt but the approved one to pay',
  );
  await shop.readUpdates();

  const { result: completed } = await ada.completeCheckoutAttempt(approved.id);
  await expectRefusal(
    () => ada.completeCheckoutAttempt(approved.id),
    409,
    'checkout_attempt_not_approved',
  );
  assertEquals(
    (await shop.readUpdates()).map((update) => Object.keys(update)),
    [['message']],
    'Expected one receipt',
  );
  assertEquals(
    [
      (await ada.getCheckoutAttempt(pending.id)).status,
      (await ada.getCheckoutAttempt(abandoned.id)).status,
      (await ada.getCheckoutAttempt(expired.id)).status,
      await ada.getCheckoutAttempt(approved.id),
    ],
    ['refused', 'abandoned', 'expired', completed],
  );
  assertEquals(
    completed.payment.telegram_payment_charge_id,
    `emulator_telegram_charge_${approved.id}`,
    "Expected the charge to be named after the attempt's query",
  );
});

Deno.test('a paid invoice is never checked out again, even once its receipt is deleted', async () => {
  await using fixture = await createCheckoutFixture();
  const { ada, shop, shopChat, invoiceMessageId } = fixture;
  const completed = await completeAdaCheckout(fixture);
  const checkOutAgain = () => ada.submitCheckout({ chat: shopChat, message_id: invoiceMessageId });

  await expectRefusal(checkOutAgain, 409, 'invoice_already_paid');
  assertEquals(await fixture.answer(completed.id, { ok: true }), QUERY_INVALID);
  await expectRefusal(
    () => ada.abandonCheckoutAttempt(completed.id),
    409,
    'checkout_attempt_ended',
  );
  await expectRefusal(
    () => ada.expireCheckoutAttempt(completed.id),
    409,
    'checkout_attempt_not_pending',
  );

  await ada.deleteMessage({ chat: shopChat, message_id: completed.payment.receipt_message_id });
  await expectRefusal(checkOutAgain, 409, 'invoice_already_paid');
  assertEquals(
    await ada.getCheckoutAttempt(completed.id),
    completed,
    'Expected the attempt to keep its payment once the receipt is deleted',
  );

  assertEquals(
    await shop.call('deleteMessage', { chat_id: ada.id, message_id: invoiceMessageId }),
    { ok: true, result: true },
  );
  await expectRefusal(checkOutAgain, 404, 'message_not_found');
  assertEquals(await ada.getCheckoutAttempt(completed.id), completed);
});

Deno.test('completion needs the invoice and an unblocked chat, and leaves the attempt approved without them', async () => {
  await using fixture = await createCheckoutFixture();
  const { ada, shop, shopChat, invoiceMessageId } = fixture;
  const blocked = await approveAdaCheckout(fixture);
  await shop.readUpdates();

  await ada.blockBot({ botId: shop.id });
  await expectRefusal(() => ada.completeCheckoutAttempt(blocked.id), 409, 'bot_blocked');
  assertEquals(await ada.getCheckoutAttempt(blocked.id), { ...blocked, status: 'approved' });
  await ada.unblockBot({ botId: shop.id });
  assertEquals(
    (await ada.abandonCheckoutAttempt(blocked.id)).result.status,
    'abandoned',
    'Expected the approved attempt to stay abandonable',
  );

  const deleted = await approveAdaCheckout(fixture);
  await ada.deleteMessage({ chat: shopChat, message_id: invoiceMessageId });
  await expectRefusal(
    () => ada.completeCheckoutAttempt(deleted.id),
    409,
    'invoice_message_deleted',
  );
  assertEquals(await ada.getCheckoutAttempt(deleted.id), { ...deleted, status: 'approved' });
  assertEquals((await ada.abandonCheckoutAttempt(deleted.id)).result.status, 'abandoned');

  assertEquals(
    (await shop.readUpdates()).filter((update) => 'message' in update),
    [],
    'Expected no receipt',
  );
});

Deno.test('a receipt cannot be edited, forwarded or copied, and is replied to and deleted as any message', async () => {
  await using fixture = await createCheckoutFixture();
  const { ada, shop, shopChat } = fixture;
  const completed = await completeAdaCheckout(fixture);
  const receiptMessageId = completed.payment.receipt_message_id;
  const target = { chat_id: ada.id, message_id: receiptMessageId };
  const { result: supergroup } = await ada.createSupergroup({ title: 'Readers' });
  await ada.addChatMember({ chat: { type: 'supergroup', chatId: supergroup.id }, userId: shop.id });
  await shop.readUpdates();

  for (
    const [method, parameters] of [
      ['editMessageText', { ...target, text: 'Changed' }],
      ['editMessageCaption', { ...target, caption: 'Changed' }],
      ['editMessageReplyMarkup', {
        ...target,
        reply_markup: { inline_keyboard: [[{ text: 'Terms', url: 'https://example.com/' }]] },
      }],
    ] as const
  ) {
    assertEquals(
      await shop.call(method, parameters),
      { ok: false, error_code: 400, description: "Bad Request: message can't be edited" },
      method,
    );
  }
  const repetition = { chat_id: supergroup.id, from_chat_id: ada.id, message_id: receiptMessageId };
  assertEquals(await shop.call('forwardMessage', repetition), {
    ok: false,
    error_code: 400,
    description: "Bad Request: the message can't be forwarded",
  });
  assertEquals(await shop.call('copyMessage', repetition), {
    ok: false,
    error_code: 400,
    description: "Bad Request: the message can't be copied",
  });
  await expectRefusal(
    () =>
      ada.forwardMessage({
        from: shopChat,
        message_id: receiptMessageId,
        to: { type: 'supergroup', chatId: supergroup.id },
      }),
    400,
    'message_not_forwardable',
  );
  await expectRefusal(
    () => ada.editMessage({ chat: shopChat, message_id: receiptMessageId, text: 'Paid twice' }),
    400,
    'message_not_editable',
  );
  assertEquals(
    (await shop.readUpdates()).filter((update) => !('my_chat_member' in update)),
    [],
    'Expected nothing sent in place of the receipt',
  );

  const reply = await shop.call('sendMessage', {
    chat_id: ada.id,
    text: 'Thanks!',
    reply_parameters: { message_id: receiptMessageId },
  });
  const repliedMessage = (reply.result as { readonly reply_to_message?: Record<string, unknown> })
    .reply_to_message;
  const { result: accountReply } = await ada.sendMessage({
    to: shopChat,
    text: 'Did it work?',
    reply_to_message_id: receiptMessageId,
  });
  assertEquals(
    [repliedMessage?.successful_payment, accountReply.reply_to_message?.successful_payment],
    [FIRST_ATTEMPT_PAYMENT, FIRST_ATTEMPT_PAYMENT],
  );

  assertEquals(await shop.call('deleteMessage', target), { ok: true, result: true });
  assertEquals(
    (await ada.getMessages({ chat: shopChat })).some(({ message_id }) =>
      message_id === receiptMessageId
    ),
    false,
    'Expected the receipt to leave the conversation',
  );
});

Deno.test('a bot receives receipts and pre-checkout queries as it subscribes to them', async () => {
  await using fixture = await createCheckoutFixture();
  const { ada, shop } = fixture;

  await shop.call('getUpdates', { allowed_updates: ['pre_checkout_query'] });
  const unsubscribed = await completeAdaCheckout(fixture);
  assertEquals(
    (await shop.readUpdates()).map((update) => Object.keys(update)),
    [['pre_checkout_query']],
    'Expected the query alone',
  );

  await shop.call('getUpdates', { allowed_updates: ['message'] });
  const { result: invoice } = await shop.call('sendInvoice', {
    chat_id: ada.id,
    title: 'Bonus chapter',
    description: 'One more chapter',
    payload: 'order-43',
    currency: 'XTR',
    prices: [{ label: 'Chapter', amount: 5 }],
  }) as { readonly result: { readonly message_id: number } };
  const { result: attempt } = await ada.submitCheckout({
    chat: fixture.shopChat,
    message_id: invoice.message_id,
  });
  await fixture.answer(attempt.id, { ok: true });
  const { result: subscribed } = await ada.completeCheckoutAttempt(attempt.id);
  const updates = await shop.readUpdates();
  assertEquals(
    updates.map((update) =>
      (update as { readonly message?: { readonly successful_payment?: unknown } }).message
        ?.successful_payment
    ),
    [{
      currency: 'XTR',
      total_amount: 5,
      invoice_payload: 'order-43',
      telegram_payment_charge_id: subscribed.payment.telegram_payment_charge_id,
      provider_payment_charge_id: subscribed.payment.provider_payment_charge_id,
    }],
    'Expected the receipt alone',
  );
  assertEquals(unsubscribed.status, 'completed');
});

/**
 * A grammY shop that sells premium access by an invoice without a start parameter, and grants it
 * only once a `successful_payment` arrives. It answers `/premium` with whether access is unlocked,
 * and acknowledges each payment, each as a reply that a test correlates with the message it
 * answers.
 */
function createPremiumShop(token: string, client: ConstructorParameters<typeof Bot>[1]) {
  const bot = new Bot(token, client);
  const premiumUsers = new Set<number>();
  const shop = {
    bot,
    /** Whether the shop approves checkouts; it refuses them while out of stock. */
    inStock: false,
  };
  const replyTo = (context: Context, text: string) =>
    context.reply(text, { reply_parameters: { message_id: context.msg!.message_id } });
  bot.command(
    'buy',
    (context) =>
      context.replyWithInvoice('Premium access', 'Every premium chapter', 'premium', 'XTR', [
        { label: 'Premium', amount: 50 },
      ]),
  );
  bot.command(
    'premium',
    (context) =>
      replyTo(context, premiumUsers.has(context.from!.id) ? 'Premium unlocked' : 'Premium locked'),
  );
  bot.on(
    'pre_checkout_query',
    (context) =>
      shop.inStock
        ? context.answerPreCheckoutQuery(true)
        : context.answerPreCheckoutQuery(false, { error_message: 'Sold out' }),
  );
  bot.on('message:successful_payment', (context) => {
    if (context.message.successful_payment.invoice_payload === 'premium') {
      premiumUsers.add(context.from.id);
    }
    return replyTo(context, 'Thanks for your payment');
  });
  return shop;
}

Deno.test('only a successful payment unlocks what a grammY bot sells', async () => {
  await using fixture = await createCheckoutFixture();
  const { emulator, session, ada, shop, shopChat } = fixture;
  const activity = session.botActivity({ bot_id: shop.id });
  const premiumShop = createPremiumShop(shop.token, {
    client: { apiRoot: session.botApiRoot, fetch: emulator.fetch },
  });
  /** Asks the shop about premium access, and reads its reply once its handler sent it. */
  const askForPremium = async () => {
    const { result: question, receipt } = await ada.sendMessage({ to: shopChat, text: '/premium' });
    const answer = await activity.waitFor({
      method: 'sendMessage',
      ok: true,
      parameters_json: { reply_parameters: { message_id: question.message_id } },
    }, { after: receipt });
    return answer.parameters.text;
  };
  /** Checks out the invoice, and reads the attempt once the shop's handler answered its query. */
  const checkOut = async (invoiceMessageId: number) => {
    const { result: attempt, receipt } = await ada.submitCheckout({
      chat: shopChat,
      message_id: invoiceMessageId,
    });
    await activity.waitFor({
      method: 'answerPreCheckoutQuery',
      ok: true,
      parameters: { pre_checkout_query_id: attempt.id },
    }, { after: receipt });
    return await ada.getCheckoutAttempt(attempt.id);
  };
  const polling = startPolling(premiumShop.bot);
  try {
    await polling.started;
    assertEquals(await askForPremium(), 'Premium locked', 'Expected access locked before checkout');

    const { receipt: beforeBuying } = await ada.sendMessage({ to: shopChat, text: '/buy' });
    const invoiceSending = await activity.waitFor(
      { method: 'sendInvoice', chat_id: ada.id, ok: true },
      { after: beforeBuying },
    );
    assertEquals('start_parameter' in invoiceSending.parameters, false);
    const invoice = (invoiceSending.answer as {
      readonly result: { readonly message_id: number; readonly invoice: unknown };
    }).result;
    assertEquals(invoice.invoice, {
      title: 'Premium access',
      description: 'Every premium chapter',
      start_parameter: '',
      currency: 'XTR',
      total_amount: 50,
    });

    const refused = await checkOut(invoice.message_id);
    assertEquals([refused.status, await askForPremium()], ['refused', 'Premium locked']);

    premiumShop.inStock = true;
    const abandoned = await checkOut(invoice.message_id);
    assertEquals(
      [abandoned.status, await askForPremium()],
      ['approved', 'Premium locked'],
      'Expected access locked while the approved checkout awaits completion',
    );
    await ada.abandonCheckoutAttempt(abandoned.id);
    assertEquals(await askForPremium(), 'Premium locked', 'Expected access locked once abandoned');

    const paid = await checkOut(invoice.message_id);
    assertEquals(paid.status, 'approved');
    const { result: completed, receipt: beforeCompletion } = await ada.completeCheckoutAttempt(
      paid.id,
    );
    await activity.waitFor({
      method: 'sendMessage',
      ok: true,
      parameters_json: {
        reply_parameters: { message_id: completed.payment.receipt_message_id },
      },
    }, { after: beforeCompletion });
    assertEquals(await askForPremium(), 'Premium unlocked');
  } finally {
    await polling.stop();
  }
});

Deno.test('a grammY bot approves through its webhook response and acknowledges the payment it receives', async () => {
  await using fixture = await createCheckoutFixture();
  const { emulator, session, ada, shop, shopChat, invoiceMessageId } = fixture;
  const activity = session.botActivity({ bot_id: shop.id });
  const premiumShop = createPremiumShop(shop.token, {
    client: {
      apiRoot: session.botApiRoot,
      fetch: emulator.fetch,
      canUseWebhookReply: (method) => method === 'answerPreCheckoutQuery',
    },
  });
  premiumShop.inStock = true;
  const handleWebhookRequest = webhookCallback(premiumShop.bot, 'std/http');
  const webhookServer = Deno.serve(
    { hostname: '127.0.0.1', port: 0, onListen: () => {} },
    (request) => handleWebhookRequest(request),
  );
  try {
    await premiumShop.bot.api.setWebhook(`http://127.0.0.1:${webhookServer.addr.port}/webhook`);
    const { result: attempt, receipt: beforeCheckout } = await ada.submitCheckout({
      chat: shopChat,
      message_id: invoiceMessageId,
    });
    const approval = await activity.waitFor({
      method: 'answerPreCheckoutQuery',
      parameters: { pre_checkout_query_id: attempt.id },
    }, { after: beforeCheckout });
    assertEquals([approval.via, approval.answer], ['webhook_reply', { ok: true, result: true }]);

    const { result: completed, receipt: beforeCompletion } = await ada.completeCheckoutAttempt(
      attempt.id,
    );
    const acknowledgement = await activity.waitFor({
      method: 'sendMessage',
      ok: true,
      parameters_json: {
        reply_parameters: { message_id: completed.payment.receipt_message_id },
      },
    }, { after: beforeCompletion });
    assertEquals(acknowledgement.parameters.text, 'Thanks for your payment');
  } finally {
    await session.end();
    await webhookServer.shutdown();
  }
});
