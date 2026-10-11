import { assertEquals, assertRejects, assertThrows } from '@std/assert';

import type { VirtualBotProfile } from '../src/types/virtual_bot.ts';
import {
  createBotApiCommandSession,
  FAILED_RECORDING_MESSAGE,
} from './support/bot_api_command_session.ts';
import { createStagedSessionFixture, FAILED_VIEW_MESSAGE } from './support/staged_session.ts';

const REPORT_URL = 'https://files.example/report.pdf';
const APPENDIX_URL = 'https://files.example/appendix.pdf';

Deno.test("a bot's message whose answer fails to be viewed commits nothing", async () => {
  using fixture = createSendingFixture();
  const { alpha, chatId } = fixture;
  const lastMessageId = await fixture.sendAlphaText('Morning');
  const stateBefore = fixture.readSupergroup();
  const sendText = () =>
    fixture.callMethod(alpha, 'sendMessage', { chat_id: String(chatId), text: 'Agenda' });

  // The message is committed, and its file IDs granted, before Alpha's view of it, which answers
  // the call, fails.
  const restoreViews = fixture.failSupergroupViewsFor(alpha.id);
  await assertRejects(sendText, Error, FAILED_VIEW_MESSAGE);
  restoreViews();
  const stateAfterFailure = fixture.readSupergroup();

  assertEquals(stateAfterFailure, stateBefore);
  // The message ID the failed send would have used is the next send's.
  assertEquals(readMessageId(await fixture.expectResult(sendText())), lastMessageId + 1);
});

Deno.test("a bot's album whose second message fails to be viewed commits none of its messages", async () => {
  using fixture = createSendingFixture();
  const { alpha, chatId } = fixture;
  const lastMessageId = await fixture.sendAlphaText('Morning');
  const stateBefore = fixture.readSupergroup();
  const sendAlbum = () =>
    fixture.callMethod(alpha, 'sendMediaGroup', {
      chat_id: String(chatId),
      media: JSON.stringify([
        { type: 'document', media: REPORT_URL },
        { type: 'document', media: APPENDIX_URL },
      ]),
    });

  // Both messages are committed, with their downloaded files, before Alpha's view of the second
  // fails.
  const restoreViews = fixture.failSupergroupViewsFor(alpha.id, { failingViewNumber: 2 });
  await assertRejects(sendAlbum, Error, FAILED_VIEW_MESSAGE);
  restoreViews();

  assertEquals(fixture.readSupergroup(), stateBefore);
  const album = await fixture.expectResult(sendAlbum());
  assertEquals(
    Array.isArray(album) ? album.map(readMessageId) : album,
    [lastMessageId + 1, lastMessageId + 2],
  );
});

Deno.test('a private message whose record fails leaves the chat as its account saw it', async () => {
  using fixture = createSendingFixture();
  const { alpha, adaId } = fixture;
  await fixture.expectResult(
    fixture.callMethod(alpha, 'sendMessageDraft', {
      chat_id: String(adaId),
      draft_id: '7',
      text: 'Thinking',
    }),
  );
  await fixture.expectResult(
    fixture.callMethod(alpha, 'sendChatAction', { chat_id: String(adaId), action: 'typing' }),
  );
  const stateBefore = fixture.readPrivateChat();
  const sendKeyboard = () =>
    fixture.callMethod(alpha, 'sendMessage', {
      chat_id: String(adaId),
      text: 'Choose',
      reply_markup: JSON.stringify({ keyboard: [[{ text: 'Yes' }]] }),
    });

  // The message, its keyboard, and the draft and chat action it ends are staged before the record
  // fails.
  const restoreRecording = fixture.failCallRecording();
  await assertRejects(sendKeyboard, Error, FAILED_RECORDING_MESSAGE);
  restoreRecording();
  const stateAfterFailure = fixture.readPrivateChat();
  await fixture.expectResult(sendKeyboard());
  const { shown } = fixture.readPrivateChat();

  assertEquals(stateAfterFailure, stateBefore);
  assertEquals(
    [stateBefore.shown, shown],
    [
      { messageCount: 1, showsReplyKeyboard: false, chatActionCount: 1, showsDraft: true },
      { messageCount: 2, showsReplyKeyboard: true, chatActionCount: 0, showsDraft: false },
    ],
  );
});

Deno.test('a forward of several messages whose record fails forwards none of them', async () => {
  using fixture = createSendingFixture();
  const { alpha, adaId, chatId } = fixture;
  const messageIds = [await fixture.sendAlphaText('First'), await fixture.sendAlphaText('Second')];
  const stateBefore = fixture.readPrivateChat();
  const forwardMessages = () =>
    fixture.callMethod(alpha, 'forwardMessages', {
      chat_id: String(adaId),
      from_chat_id: String(chatId),
      message_ids: JSON.stringify(messageIds),
    });

  const restoreRecording = fixture.failCallRecording();
  await assertRejects(forwardMessages, Error, FAILED_RECORDING_MESSAGE);
  restoreRecording();
  const stateAfterFailure = fixture.readPrivateChat();
  await fixture.expectResult(forwardMessages());

  assertEquals(stateAfterFailure, stateBefore);
  assertEquals(
    fixture.readPrivateChat().shown.messageCount,
    Number(stateBefore.shown.messageCount) + 2,
  );
});

Deno.test("an account's message sent outside any command is reverted whole when its projection fails", async () => {
  using fixture = createSendingFixture();
  const { session, adaId, chatId, beta } = fixture;
  const lastBetaUpdateId = await fixture.confirmUpdates(beta);
  const stateBefore = fixture.readSupergroup();
  // As a control route does, the send opens no transaction of its own.
  const sendAdaText = () =>
    session.messageSending.sendAccountSupergroupMessage({
      fromAccountId: adaId,
      chat: { type: 'supergroup', chatId },
      content: { kind: 'text', text: 'Lunch?' },
    });

  // Alpha's update is staged before Beta's view fails.
  const restoreViews = fixture.failSupergroupViewsFor(beta.id);
  assertThrows(sendAdaText, Error, FAILED_VIEW_MESSAGE);
  restoreViews();
  const stateAfterFailure = fixture.readSupergroup();

  assertEquals(stateAfterFailure, stateBefore);
  assertEquals(sendAdaText().sent, true);
  assertEquals(await fixture.confirmUpdates(beta), lastBetaUpdateId + 1);
});

Deno.test("an account's poll whose projection fails stores no poll", () => {
  const fixture = createStagedSessionFixture({ privacyMode: false });
  const { adaId, chatId, beta } = fixture;
  const stateBefore = fixture.readState();
  fixture.views.failingObserverId = beta;

  // Alpha's view of the poll, which shows its ID, succeeds before Beta's fails.
  assertThrows(
    () =>
      fixture.messageSending.sendAccountSupergroupMessage({
        fromAccountId: adaId,
        chat: { type: 'supergroup', chatId },
        content: {
          kind: 'poll',
          poll: {
            question: { text: 'Lunch?' },
            options: [{ text: 'Yes' }, { text: 'No' }],
            isAnonymous: false,
            allowsMultipleAnswers: false,
            allowsRevoting: true,
            type: { kind: 'regular' },
          },
        },
      }),
    Error,
    FAILED_VIEW_MESSAGE,
  );
  const [alphaView] = fixture.views.messageViewsSeen;
  const stagedPollId = alphaView !== undefined && 'poll' in alphaView
    ? alphaView.poll.id
    : undefined;

  assertEquals(
    {
      state: fixture.readState(),
      stagedPollStored: stagedPollId === undefined
        ? 'not viewed'
        : fixture.polls.getPoll(stagedPollId) !== undefined,
    },
    { state: stateBefore, stagedPollStored: false },
  );
});

Deno.test("an account's album whose second message fails to project commits none of its messages", () => {
  const fixture = createStagedSessionFixture({ privacyMode: false });
  const stateBefore = fixture.readState();
  fixture.views.failingObserverId = fixture.beta;
  fixture.views.failingMessageViewNumber = 2;

  // Outside any command, every update of the first message is staged before Beta's view of the
  // second fails.
  assertThrows(() => fixture.sendAccountAlbum(['First', 'Second']), Error, FAILED_VIEW_MESSAGE);

  assertEquals(fixture.readState(), stateBefore);
});

Deno.test('a chosen inline result whose news to its bot fails to project is not sent', async () => {
  using fixture = createSendingFixture();
  const { session, adaId, alpha } = fixture;
  const inlineQuery = await fixture.answerInlineQuery();
  const stateBefore = fixture.readPrivateChat();
  const chooseResult = () =>
    session.inlineQueries.chooseInlineQueryResult({
      accountId: adaId,
      inlineQueryId: inlineQuery.id,
      resultId: 'a',
    });
  const views = session.botMessageViews;
  const viewChosenInlineResult = views.viewChosenInlineResultForBot.bind(views);
  // The result's message, and Alpha's update for it, are staged before the choice's view fails.
  views.viewChosenInlineResultForBot = () => {
    throw new Error(FAILED_VIEW_MESSAGE);
  };

  await assertRejects(chooseResult, Error, FAILED_VIEW_MESSAGE);
  views.viewChosenInlineResultForBot = viewChosenInlineResult;
  const stateAfterFailure = fixture.readPrivateChat();
  const choice = await chooseResult();

  assertEquals(stateAfterFailure, stateBefore);
  assertEquals(choice.chosen, true);
  assertEquals(fixture.countPendingUpdates([alpha]), [stateBefore.pendingUpdates[0] + 2]);
});

Deno.test('a reply keyboard press whose projection fails sends nothing', async () => {
  using fixture = createSendingFixture();
  const { session, adaId, alpha } = fixture;
  await fixture.expectResult(
    fixture.callMethod(alpha, 'sendMessage', {
      chat_id: String(adaId),
      text: 'Choose',
      reply_markup: JSON.stringify({ keyboard: [[{ text: 'Yes' }]] }),
    }),
  );
  const stateBefore = fixture.readPrivateChat();
  const press = () =>
    session.replyInterfaces.pressPrivateChatReplyKeyboardButton({
      fromAccountId: adaId,
      chat: { type: 'private', peerId: alpha.id },
      text: 'Yes',
    });
  const views = session.botMessageViews;
  const viewPrivateMessage = views.viewPrivateMessageForBot.bind(views);
  views.viewPrivateMessageForBot = () => {
    throw new Error(FAILED_VIEW_MESSAGE);
  };

  assertThrows(press, Error, FAILED_VIEW_MESSAGE);
  views.viewPrivateMessageForBot = viewPrivateMessage;
  const stateAfterFailure = fixture.readPrivateChat();

  assertEquals(stateAfterFailure, stateBefore);
  assertEquals(press().sent, true);
});

Deno.test('a message prepared before its bot was removed from the supergroup is not sent', async () => {
  using fixture = createSendingFixture();
  const { session, alpha, adaId, chatId } = fixture;
  const reply = fixture.holdWebhookReply(alpha, {
    method: 'sendMessage',
    chat_id: String(chatId),
    text: 'Agenda',
  });

  // Ada removes Alpha while the reply is still being read.
  const removal = session.sharedChatAdministration.removeChatMember({
    actorAccountId: adaId,
    chatId,
    memberId: alpha.id,
  });
  assertEquals(removal.removed, true);
  const stateBeforeRelease = fixture.readSupergroup();
  await reply.release();

  assertEquals(fixture.readSupergroup(), {
    ...stateBeforeRelease,
    activityHead: stateBeforeRelease.activityHead + 1,
  });
  assertEquals(await fixture.lastRecordedAnswer(), {
    ok: false,
    error_code: 403,
    description: 'Forbidden: bot was kicked from the supergroup chat',
  });
});

Deno.test('a message prepared before its account blocked the bot is not sent', async () => {
  using fixture = createSendingFixture();
  const { session, alpha, adaId } = fixture;
  const reply = fixture.holdWebhookReply(alpha, {
    method: 'sendMessage',
    chat_id: String(adaId),
    text: 'Reminder',
  });

  // Ada blocks Alpha while the reply is still being read.
  assertEquals(session.botBlocking.blockBot({ accountId: adaId, botId: alpha.id }).applied, true);
  const stateBeforeRelease = fixture.readPrivateChat();
  await reply.release();

  assertEquals(fixture.readPrivateChat(), {
    ...stateBeforeRelease,
    activityHead: stateBeforeRelease.activityHead + 1,
  });
  assertEquals(await fixture.lastRecordedAnswer(), {
    ok: false,
    error_code: 403,
    description: 'Forbidden: bot was blocked by the user',
  });
});

Deno.test('a copy prepared before its message was deleted is not sent', async () => {
  using fixture = createSendingFixture();
  const { session, alpha, adaId, chatId } = fixture;
  const adaMessageId = fixture.sendAdaText('Notes');
  const reply = fixture.holdWebhookReply(alpha, {
    method: 'copyMessage',
    chat_id: String(adaId),
    from_chat_id: String(chatId),
    message_id: String(adaMessageId),
  });

  // Ada deletes her message while the reply is still being read.
  const deletion = session.messageDeletion.deleteAccountSupergroupMessage({
    fromAccountId: adaId,
    chat: { type: 'supergroup', chatId },
    messageId: adaMessageId,
  });
  assertEquals(deletion, { deleted: true });
  const stateBeforeRelease = fixture.readPrivateChat();
  await reply.release();

  assertEquals(fixture.readPrivateChat(), {
    ...stateBeforeRelease,
    activityHead: stateBeforeRelease.activityHead + 1,
  });
  assertEquals(await fixture.lastRecordedAnswer(), {
    ok: false,
    error_code: 400,
    description: 'Bad Request: message to copy not found',
  });
});

Deno.test('sends prepared before their session ended change nothing', async () => {
  using fixture = createSendingFixture();
  const { alpha, adaId, chatId } = fixture;
  const messageId = await fixture.sendAlphaText('Morning');
  const replyParameters: readonly Readonly<Record<string, string>>[] = [
    { method: 'sendMessage', chat_id: String(chatId), text: 'Agenda' },
    {
      method: 'sendMediaGroup',
      chat_id: String(chatId),
      media: JSON.stringify([
        { type: 'document', media: REPORT_URL },
        { type: 'document', media: APPENDIX_URL },
      ]),
    },
    {
      method: 'sendPoll',
      chat_id: String(chatId),
      question: 'Lunch?',
      options: JSON.stringify(['Yes', 'No']),
    },
    {
      method: 'forwardMessage',
      chat_id: String(adaId),
      from_chat_id: String(chatId),
      message_id: String(messageId),
    },
  ];
  const replies = replyParameters.map((parameters) => fixture.holdWebhookReply(alpha, parameters));
  const stateBefore = [fixture.readSupergroup(), fixture.readPrivateChat()];

  fixture.session.end();
  for (const reply of replies) {
    await reply.release();
  }

  assertEquals([fixture.readSupergroup(), fixture.readPrivateChat()], stateBefore);
});

/**
 * A supergroup of Ada's with Alpha and Beta, bots that read every message, and Ada's
 * private chat with Alpha, an inline bot told of chosen results, which Ada started. Two PDF
 * documents are served on the session's web.
 */
function createSendingFixture() {
  const harness = createBotApiCommandSession('message-sending-transactions');
  const { session } = harness;
  const adaId = harness.createAccount('Ada');
  const alphaCreation = session.virtualUsers.createBot({
    first_name: 'alpha_bot',
    username: 'alpha_bot',
    can_read_all_group_messages: true,
    supports_inline_queries: true,
    receives_chosen_inline_results: true,
  });
  if (!alphaCreation.created) {
    throw new Error(`Expected Alpha to be created: ${alphaCreation.reason}`);
  }
  const alpha = alphaCreation.bot.profile;
  const beta = harness.createBot('beta_bot');
  const creation = session.sharedChatAdministration.createSupergroup({
    title: 'Team',
    creatorAccountId: adaId,
  });
  if (!creation.created) {
    throw new Error(`Expected the supergroup to be created: ${creation.reason}`);
  }
  const chatId = creation.supergroup.id;
  for (const bot of [alpha, beta]) {
    session.sharedChatAdministration.addChatMember({
      actorAccountId: adaId,
      chatId,
      memberId: bot.id,
    });
  }
  const start = session.messageSending.sendAccountPrivateChatMessage({
    fromAccountId: adaId,
    chat: { type: 'private', peerId: alpha.id },
    content: { kind: 'text', text: '/start' },
  });
  if (!start.sent) {
    throw new Error(`Expected Ada to start her chat: ${JSON.stringify(start)}`);
  }
  for (const url of [REPORT_URL, APPENDIX_URL]) {
    const registration = session.webResources.registerWebResource({
      url,
      status: 200,
      contentType: 'application/pdf',
      content: new TextEncoder().encode('%PDF-1.7'),
    });
    if (!registration.registered) {
      throw new Error(`Expected ${url} to be served`);
    }
  }
  const conversation = { accountId: adaId, botId: alpha.id };

  /** The result of a call that must succeed. */
  const expectResult = async (call: ReturnType<typeof harness.callMethod>): Promise<unknown> => {
    const outcome = await call;
    if (!outcome.answered || !outcome.answer.body.ok) {
      throw new Error(`Expected the call to succeed: ${JSON.stringify(outcome)}`);
    }
    return outcome.answer.body.result;
  };

  return {
    ...harness,
    adaId,
    alpha,
    beta,
    chatId,
    expectResult,
    /** Sends Alpha's text to the supergroup, and returns the message's ID. */
    sendAlphaText: async (text: string): Promise<number> =>
      readMessageId(
        await expectResult(
          harness.callMethod(alpha, 'sendMessage', { chat_id: String(chatId), text }),
        ),
      ),
    /** Sends Ada's text to the supergroup, and returns the message's ID. */
    sendAdaText: (text: string): number => {
      const sending = session.messageSending.sendAccountSupergroupMessage({
        fromAccountId: adaId,
        chat: { type: 'supergroup', chatId },
        content: { kind: 'text', text },
      });
      if (!sending.sent) {
        throw new Error(`Expected Ada's message to be sent: ${JSON.stringify(sending)}`);
      }
      return session.botMessageViews.viewSupergroupMessage(sending.message, adaId).message_id;
    },
    /** Sends Ada an inline query, which Alpha answers with one article, and returns the query. */
    answerInlineQuery: async () => {
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
      await expectResult(harness.callMethod(alpha, 'answerInlineQuery', {
        inline_query_id: sending.inlineQuery.id,
        results: JSON.stringify([{
          type: 'article',
          id: 'a',
          title: 'A',
          input_message_content: { message_text: 'A' },
        }]),
      }));
      return sending.inlineQuery;
    },
    /** Confirms every update waiting for the bot, and returns the ID of the last one. */
    confirmUpdates: async (bot: VirtualBotProfile): Promise<number> => {
      const updates = await harness.callMethodExpectingResult(bot, 'getUpdates', {});
      const lastUpdate = Array.isArray(updates) ? updates.at(-1) : undefined;
      if (
        typeof lastUpdate !== 'object' || lastUpdate === null || !('update_id' in lastUpdate) ||
        typeof lastUpdate.update_id !== 'number'
      ) {
        throw new Error(
          `Expected updates for ${bot.username}, received ${JSON.stringify(updates)}`,
        );
      }
      await harness.callMethodExpectingResult(bot, 'getUpdates', {
        offset: String(lastUpdate.update_id + 1),
      });
      return lastUpdate.update_id;
    },
    /**
     * Makes the session's views of supergroup messages fail for one observer, as a projector that
     * breaks an invariant would, at the observer's `failingViewNumber`th view, counted from 1,
     * until the returned function is called.
     */
    failSupergroupViewsFor: (
      observerId: number,
      { failingViewNumber = 1 }: { readonly failingViewNumber?: number } = {},
    ): () => void => {
      const views = session.botMessageViews;
      const viewSupergroupMessage = views.viewSupergroupMessage.bind(views);
      let observerViewCount = 0;
      views.viewSupergroupMessage = (message, viewerId) => {
        if (viewerId === observerId && ++observerViewCount === failingViewNumber) {
          throw new Error(FAILED_VIEW_MESSAGE);
        }
        return viewSupergroupMessage(message, viewerId);
      };
      return () => {
        views.viewSupergroupMessage = viewSupergroupMessage;
      };
    },
    /** The supergroup as its readers see it, through reads that record nothing. */
    readSupergroup: () => {
      const history = session.supergroupMessaging.getMessageHistory({ accountId: adaId, chatId });
      return {
        messages: history.found
          ? history.messages.map((message) => message.content)
          : history.reason,
        pendingUpdates: harness.countPendingUpdates([alpha, beta]),
        activityHead: session.botActivity.getHeadPosition(),
      };
    },
    /** Ada's private chat with Alpha as both see it, through reads that record nothing. */
    readPrivateChat: () => {
      const history = session.privateMessaging.getPrivateMessageHistory(conversation);
      const replyInterface = session.replyInterfaces.getPrivateChatReplyInterface({
        accountId: adaId,
        chat: { type: 'private', peerId: alpha.id },
      });
      const chatActions = session.chatActions.getPrivateChatActions(conversation);
      const draft = session.messageDrafts.getPrivateMessageDraft(conversation);
      return {
        shown: {
          messageCount: history.found ? history.messages.length : history.reason,
          showsReplyKeyboard: replyInterface.found
            ? replyInterface.shownReplyInterface !== undefined
            : replyInterface.reason,
          chatActionCount: chatActions.found ? chatActions.chatActions.length : chatActions.reason,
          showsDraft: draft.found ? draft.draft !== undefined : draft.reason,
        },
        pendingUpdates: harness.countPendingUpdates([alpha]),
        activityHead: session.botActivity.getHeadPosition(),
      };
    },
  };
}

function readMessageId(message: unknown): number {
  if (
    typeof message !== 'object' || message === null || !('message_id' in message) ||
    typeof message.message_id !== 'number'
  ) {
    throw new Error(`Expected a message, received ${JSON.stringify(message)}`);
  }
  return message.message_id;
}
