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

Deno.test('an answer whose record fails leaves its query unanswered', async () => {
  const fixture = await createQueryFixture();
  const callbackQuery = fixture.pressButton();
  const inlineQuery = fixture.sendInlineQuery();
  const readAnswers = () => ({
    callbackQuery: fixture.session.callbackQueries.getAccountCallbackQuery({
      accountId: fixture.adaId,
      callbackQueryId: callbackQuery.id,
    })?.state,
    inlineQuery: fixture.session.inlineQueries.getAccountInlineQuery({
      accountId: fixture.adaId,
      inlineQueryId: inlineQuery.id,
    })?.state,
  });
  const answers = [
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
 * Ada's private chat with Alpha, an inline bot, where Alpha sent a message with a callback button.
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
    /** The queries Alpha has been sent and the call records, through reads that record nothing. */
    readState: () => ({
      callbackQuery: session.callbackQueries.getAccountCallbackQuery({
        accountId: adaId,
        callbackQueryId: '1',
      }) ?? null,
      inlineQuery: session.inlineQueries.getAccountInlineQuery({
        accountId: adaId,
        inlineQueryId: '1',
      }) ?? null,
      pendingUpdates: harness.countPendingUpdates([alpha]),
      activityHead: session.botActivity.getHeadPosition(),
    }),
  };
}
