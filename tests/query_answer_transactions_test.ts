import { assertEquals, assertNotEquals, assertRejects, assertThrows } from '@std/assert';

import {
  createBotApiCommandSession,
  FAILED_RECORDING_MESSAGE,
} from './support/bot_api_command_session.ts';

const FAILED_VIEW_MESSAGE = 'The view failed';

Deno.test('a press whose projection fails creates no callback query', async () => {
  const fixture = await createQueryFixture();
  const { session } = fixture;
  const views = session.botMessageViews;
  const viewCallbackQuery = views.viewCallbackQueryForBot.bind(views);
  views.viewCallbackQueryForBot = () => {
    throw new Error(FAILED_VIEW_MESSAGE);
  };
  const stateBefore = fixture.readState();

  assertThrows(() => fixture.pressButton(), Error, FAILED_VIEW_MESSAGE);
  views.viewCallbackQueryForBot = viewCallbackQuery;
  const stateAfterFailure = fixture.readState();

  assertEquals(stateAfterFailure, stateBefore);
  // The query the failed press would have created is the next press's, whose ID it did not use.
  assertEquals(fixture.pressButton().id, '1');
});

Deno.test('an inline query whose projection fails is not sent', async () => {
  const fixture = await createQueryFixture();
  const { session } = fixture;
  const views = session.botMessageViews;
  const viewInlineQuery = views.viewInlineQueryForBot.bind(views);
  views.viewInlineQueryForBot = () => {
    throw new Error(FAILED_VIEW_MESSAGE);
  };
  const stateBefore = fixture.readState();

  assertThrows(() => fixture.sendInlineQuery(), Error, FAILED_VIEW_MESSAGE);
  views.viewInlineQueryForBot = viewInlineQuery;

  assertEquals(fixture.readState(), stateBefore);
  assertEquals(fixture.sendInlineQuery().id, '1');
});

Deno.test('a checkout whose projection fails starts no attempt', async () => {
  const fixture = await createQueryFixture();
  const { session } = fixture;
  const views = session.botMessageViews;
  const viewPreCheckoutQuery = views.viewPreCheckoutQueryForBot.bind(views);
  views.viewPreCheckoutQueryForBot = () => {
    throw new Error(FAILED_VIEW_MESSAGE);
  };
  const stateBefore = fixture.readState();

  assertThrows(() => fixture.submitCheckout(), Error, FAILED_VIEW_MESSAGE);
  views.viewPreCheckoutQueryForBot = viewPreCheckoutQuery;

  assertEquals(fixture.readState(), stateBefore);
  // The invoice has no active attempt left behind, and the query ID was not used.
  assertEquals(fixture.submitCheckout().id, '1');
});

Deno.test("a completion whose receipt's projection fails pays nothing", async () => {
  const fixture = await createQueryFixture();
  const { session } = fixture;
  const attempt = await fixture.approveCheckout();
  const views = session.botMessageViews;
  const viewPrivateMessage = views.viewPrivateMessageForBot.bind(views);
  views.viewPrivateMessageForBot = () => {
    throw new Error(FAILED_VIEW_MESSAGE);
  };
  const stateBefore = fixture.readState();

  assertThrows(() => fixture.completeCheckout(attempt.id), Error, FAILED_VIEW_MESSAGE);
  views.viewPrivateMessageForBot = viewPrivateMessage;

  assertEquals(fixture.readState(), stateBefore, 'Expected the attempt still approved');
  // The invoice is not paid, and the receipt's message ID was not used.
  const { state } = fixture.completeCheckout(attempt.id);
  assertEquals(
    state.status === 'completed' ? state.payment.receiptChatMessageId : state.status,
    fixture.invoiceMessageId + 1,
  );
});

Deno.test('a completion after its session ended pays nothing', async () => {
  const fixture = await createQueryFixture();
  const { session } = fixture;
  const attempt = await fixture.approveCheckout();
  const stateBefore = fixture.readState();

  session.end();
  const execution = session.transactions.execute(() => fixture.completeCheckout(attempt.id));

  assertEquals(execution, { executed: false, reason: 'session_ended' });
  assertEquals(fixture.readState(), stateBefore);
});

Deno.test('an answer whose record fails leaves its query unanswered', async () => {
  const fixture = await createQueryFixture();
  const callbackQuery = fixture.pressButton();
  const inlineQuery = fixture.sendInlineQuery();
  const checkoutAttempt = fixture.submitCheckout();
  const readAnswers = () => ({
    callbackQuery: fixture.session.callbackQueries.getAccountCallbackQuery({
      accountId: fixture.adaId,
      callbackQueryId: callbackQuery.id,
    })?.state,
    inlineQuery: fixture.session.inlineQueries.getAccountInlineQuery({
      accountId: fixture.adaId,
      inlineQueryId: inlineQuery.id,
    })?.state,
    checkoutAttempt: fixture.readCheckoutAttempt(checkoutAttempt.id)?.state,
  });
  const answers = [
    ['answerPreCheckoutQuery', { pre_checkout_query_id: checkoutAttempt.id, ok: 'true' }],
    ['answerCallbackQuery', { callback_query_id: callbackQuery.id, text: 'Done' }],
    ['answerInlineQuery', {
      inline_query_id: inlineQuery.id,
      cache_time: '60',
      results: JSON.stringify([{
        type: 'article',
        id: 'a',
        title: 'A',
        input_message_content: { message_text: 'A' },
      }]),
    }],
  ] as const;

  for (const [methodName, parameters] of answers) {
    const answersBefore = readAnswers();
    const stateBefore = fixture.readState();
    const restoreRecording = fixture.failCallRecording();
    await assertRejects(
      () => fixture.callMethod(fixture.alpha, methodName, parameters),
      Error,
      FAILED_RECORDING_MESSAGE,
    );
    restoreRecording();
    assertEquals(readAnswers(), answersBefore, `${methodName} left an answer behind`);
    assertEquals(fixture.readState(), stateBefore);

    // The same answer is recorded once its call's record succeeds.
    await fixture.callMethodExpectingResult(fixture.alpha, methodName, parameters);
    assertNotEquals(readAnswers(), answersBefore, `${methodName} answered nothing`);
  }
});

Deno.test('an answer prepared before its query was answered is not recorded again', async () => {
  const fixture = await createQueryFixture();
  const callbackQuery = fixture.pressButton();
  const reply = fixture.holdWebhookReply(fixture.alpha, {
    method: 'answerCallbackQuery',
    callback_query_id: callbackQuery.id,
    text: 'Late',
  });

  // Alpha answers the query over HTTP while its webhook reply is still being read.
  await fixture.callMethodExpectingResult(fixture.alpha, 'answerCallbackQuery', {
    callback_query_id: callbackQuery.id,
    text: 'First',
  });
  await reply.release();

  assertEquals(
    fixture.session.callbackQueries.getAccountCallbackQuery({
      accountId: fixture.adaId,
      callbackQueryId: callbackQuery.id,
    })?.state,
    { status: 'answered', answer: { text: 'First', showAlert: false, cacheTimeSeconds: 0 } },
  );
  assertEquals(await fixture.lastRecordedAnswer(), {
    ok: false,
    error_code: 400,
    description:
      'Bad Request: query is too old and response timeout expired or query ID is invalid',
  });
});

Deno.test('a pre-checkout answer prepared before its query was answered is not recorded again', async () => {
  const fixture = await createQueryFixture();
  const attempt = fixture.submitCheckout();
  const reply = fixture.holdWebhookReply(fixture.alpha, {
    method: 'answerPreCheckoutQuery',
    pre_checkout_query_id: attempt.id,
    ok: 'false',
    error_message: 'Late',
  });

  // Alpha approves the checkout over HTTP while its webhook reply is still being read.
  await fixture.callMethodExpectingResult(fixture.alpha, 'answerPreCheckoutQuery', {
    pre_checkout_query_id: attempt.id,
    ok: 'true',
  });
  await reply.release();

  assertEquals(fixture.readCheckoutAttempt(attempt.id)?.state, { status: 'approved' });
  assertEquals(await fixture.lastRecordedAnswer(), {
    ok: false,
    error_code: 400,
    description:
      'Bad Request: query is too old and response timeout expired or query ID is invalid',
  });
});

Deno.test('a pre-checkout answer prepared before its session ended records nothing', async () => {
  const fixture = await createQueryFixture();
  const attempt = fixture.submitCheckout();
  const reply = fixture.holdWebhookReply(fixture.alpha, {
    method: 'answerPreCheckoutQuery',
    pre_checkout_query_id: attempt.id,
    ok: 'true',
  });
  const stateBefore = fixture.readState();

  fixture.session.end();
  await reply.release();

  assertEquals(fixture.readState(), stateBefore);
  assertEquals(fixture.readCheckoutAttempt(attempt.id)?.state, { status: 'pending' });
});

Deno.test('an answer prepared before its session ended records nothing', async () => {
  const fixture = await createQueryFixture();
  const callbackQuery = fixture.pressButton();
  const reply = fixture.holdWebhookReply(fixture.alpha, {
    method: 'answerCallbackQuery',
    callback_query_id: callbackQuery.id,
  });
  const stateBefore = fixture.readState();

  fixture.session.end();
  await reply.release();

  assertEquals(fixture.readState(), stateBefore);
  assertEquals(
    fixture.session.callbackQueries.getAccountCallbackQuery({
      accountId: fixture.adaId,
      callbackQueryId: callbackQuery.id,
    })?.state,
    { status: 'awaiting_answer' },
  );
});

/**
 * Ada's private chat with Alpha, an inline bot, where Alpha sent a message with a callback button
 * and an invoice.
 */
async function createQueryFixture() {
  const harness = createBotApiCommandSession('query-answer-transactions');
  const { session } = harness;
  const adaId = harness.createAccount('Ada');
  const creation = session.virtualUsers.createBot({
    first_name: 'Alpha',
    username: 'alpha_bot',
    supports_inline_queries: true,
  });
  if (!creation.created) {
    throw new Error(`Expected Alpha to be created: ${creation.reason}`);
  }
  const alpha = creation.bot.profile;
  const start = session.messageSending.sendAccountPrivateChatMessage({
    fromAccountId: adaId,
    chat: { type: 'private', peerId: alpha.id },
    content: { kind: 'text', text: '/start' },
  });
  if (!start.sent) {
    throw new Error(`Expected Ada to start her chat: ${JSON.stringify(start)}`);
  }
  const keyboardMessage = await harness.callMethodExpectingResult(alpha, 'sendMessage', {
    chat_id: String(adaId),
    text: 'Choose',
    reply_markup: JSON.stringify({ inline_keyboard: [[{ text: 'Yes', callback_data: 'yes' }]] }),
  });
  if (
    typeof keyboardMessage !== 'object' || keyboardMessage === null ||
    !('message_id' in keyboardMessage) || typeof keyboardMessage.message_id !== 'number'
  ) {
    throw new Error(`Expected a message, received ${JSON.stringify(keyboardMessage)}`);
  }
  const keyboardMessageId = keyboardMessage.message_id;
  const invoiceMessage = await harness.callMethodExpectingResult(alpha, 'sendInvoice', {
    chat_id: String(adaId),
    title: 'Premium access',
    description: 'Unlocks every premium chapter',
    payload: 'order-42',
    currency: 'XTR',
    prices: JSON.stringify([{ label: 'Access', amount: 50 }]),
  });
  if (
    typeof invoiceMessage !== 'object' || invoiceMessage === null ||
    !('message_id' in invoiceMessage) || typeof invoiceMessage.message_id !== 'number'
  ) {
    throw new Error(`Expected an invoice, received ${JSON.stringify(invoiceMessage)}`);
  }
  const invoiceMessageId = invoiceMessage.message_id;
  const readCheckoutAttempt = (attemptId: string) =>
    session.checkouts.getAccountCheckoutAttempt({ accountId: adaId, attemptId });

  return {
    ...harness,
    adaId,
    alpha,
    pressButton: () => {
      const press = session.callbackQueries.pressCallbackButton({
        fromAccountId: adaId,
        chat: { type: 'private', botId: alpha.id },
        messageId: keyboardMessageId,
        callbackData: 'yes',
        expired: false,
      });
      if (!press.pressed) {
        throw new Error(`Expected the button to be pressed: ${press.reason}`);
      }
      return press.callbackQuery;
    },
    sendInlineQuery: () => {
      const sending = session.inlineQueries.sendInlineQuery({
        fromAccountId: adaId,
        botId: alpha.id,
        chat: { type: 'private', botId: alpha.id },
        query: 'a',
        offset: '',
      });
      if (!sending.sent) {
        throw new Error(`Expected the inline query to be sent: ${sending.reason}`);
      }
      return sending.inlineQuery;
    },
    submitCheckout: () => {
      const submission = session.checkouts.submitCheckout({
        payerAccountId: adaId,
        botId: alpha.id,
        invoiceChatMessageId: invoiceMessageId,
      });
      if (!submission.submitted) {
        throw new Error(`Expected the checkout to be submitted: ${submission.reason}`);
      }
      return submission.attempt;
    },
    /** Starts Ada's checkout of the invoice, which Alpha approves. */
    approveCheckout: async () => {
      const submission = session.checkouts.submitCheckout({
        payerAccountId: adaId,
        botId: alpha.id,
        invoiceChatMessageId: invoiceMessageId,
      });
      if (!submission.submitted) {
        throw new Error(`Expected the checkout to be submitted: ${submission.reason}`);
      }
      await harness.callMethodExpectingResult(alpha, 'answerPreCheckoutQuery', {
        pre_checkout_query_id: submission.attempt.id,
        ok: 'true',
      });
      return submission.attempt;
    },
    completeCheckout: (attemptId: string) => {
      const completion = session.checkouts.completeCheckoutAttempt({
        accountId: adaId,
        attemptId,
      });
      if (!completion.completed) {
        throw new Error(`Expected the checkout to be completed: ${completion.reason}`);
      }
      return completion.attempt;
    },
    invoiceMessageId,
    readCheckoutAttempt,
    /** The queries Alpha has been sent and the call records, through reads that record nothing. */
    readState: () => ({
      checkoutAttempt: readCheckoutAttempt('1') ?? null,
      callbackQuery: session.callbackQueries.getAccountCallbackQuery({
        accountId: adaId,
        callbackQueryId: '1',
      }) ?? null,
      inlineQuery: session.inlineQueries.getAccountInlineQuery({
        accountId: adaId,
        inlineQueryId: '1',
      }) ?? null,
      messageIds: (() => {
        const history = session.privateMessaging.getPrivateMessageHistory({
          accountId: adaId,
          botId: alpha.id,
        });
        return history.found ? history.messages.map(({ id }) => id) : history.reason;
      })(),
      pendingUpdates: harness.countPendingUpdates([alpha]),
      activityHead: session.botActivity.getHeadPosition(),
    }),
  };
}
