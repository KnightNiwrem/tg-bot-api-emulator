import { assertEquals, assertNotEquals, assertRejects, assertThrows } from '@std/assert';

import {
  createBotApiCommandSession,
  FAILED_RECORDING_MESSAGE,
} from './support/bot_api_command_session.ts';

const FAILED_VIEW_MESSAGE = 'The view failed';

Deno.test('a chat action or a draft whose record fails shows nothing', async () => {
  const fixture = createDraftFixture();
  const changes = [
    ['sendChatAction', { chat_id: String(fixture.adaId), action: 'typing' }],
    ['sendMessageDraft', { chat_id: String(fixture.adaId), draft_id: '7', text: 'Thinking' }],
  ] as const;

  for (const [methodName, parameters] of changes) {
    const stateBefore = fixture.readState();
    const restoreRecording = fixture.failCallRecording();
    await assertRejects(
      () => fixture.callMethod(fixture.alpha, methodName, parameters),
      Error,
      FAILED_RECORDING_MESSAGE,
    );
    restoreRecording();
    assertEquals(fixture.readState(), stateBefore, `${methodName} left a change behind`);

    // The same call shows its action or draft once its record succeeds.
    await fixture.callMethodExpectingResult(fixture.alpha, methodName, parameters);
    assertNotEquals(
      fixture.readState().shown,
      stateBefore.shown,
      `${methodName} showed nothing`,
    );
  }
});

Deno.test('a stop of a draft whose projection fails leaves the draft shown', async () => {
  const fixture = createDraftFixture();
  const { session } = fixture;
  await fixture.callMethodExpectingResult(fixture.alpha, 'sendMessageDraft', {
    chat_id: String(fixture.adaId),
    draft_id: '7',
    text: 'Thinking',
    can_stop: 'true',
  });
  const views = session.botMessageViews;
  const viewMessageGenerationStop = views.viewMessageGenerationStopForBot.bind(views);
  views.viewMessageGenerationStopForBot = () => {
    throw new Error(FAILED_VIEW_MESSAGE);
  };
  const stateBefore = fixture.readState();
  const stop = () =>
    session.messageDrafts.stopPrivateMessageDraft({
      accountId: fixture.adaId,
      botId: fixture.alpha.id,
    });

  assertThrows(stop, Error, FAILED_VIEW_MESSAGE);
  views.viewMessageGenerationStopForBot = viewMessageGenerationStop;
  const stateAfterFailure = fixture.readState();
  assertEquals(stop(), { stopped: true });

  assertEquals(stateAfterFailure, stateBefore);
  assertEquals(fixture.readState().pendingUpdates, [stateBefore.pendingUpdates[0] + 1]);
});

Deno.test('a chat action prepared before the account blocked the bot is not shown', async () => {
  const fixture = createDraftFixture();
  const reply = fixture.holdWebhookReply(fixture.alpha, {
    method: 'sendChatAction',
    chat_id: String(fixture.adaId),
    action: 'typing',
  });

  // Ada blocks Alpha while its reply is still being read.
  assertEquals(
    fixture.session.botBlocking.blockBot({ accountId: fixture.adaId, botId: fixture.alpha.id }),
    { applied: true },
  );
  const stateBeforeRelease = fixture.readState();
  await reply.release();

  assertEquals(fixture.readState(), {
    ...stateBeforeRelease,
    activityHead: stateBeforeRelease.activityHead + 1,
  });
  assertEquals(await fixture.lastRecordedAnswer(), {
    ok: false,
    error_code: 403,
    description: 'Forbidden: bot was blocked by the user',
  });
});

Deno.test('a chat action or a draft prepared before its session ended shows nothing', async () => {
  const fixture = createDraftFixture();
  const replies = [
    fixture.holdWebhookReply(fixture.alpha, {
      method: 'sendChatAction',
      chat_id: String(fixture.adaId),
      action: 'typing',
    }),
    fixture.holdWebhookReply(fixture.alpha, {
      method: 'sendMessageDraft',
      chat_id: String(fixture.adaId),
      draft_id: '7',
      text: 'Thinking',
    }),
  ];
  const stateBefore = fixture.readState();

  fixture.session.end();
  for (const reply of replies) {
    await reply.release();
  }

  assertEquals(fixture.readState(), stateBefore);
});

/** Ada's private chat with Alpha, which Ada started, showing no chat action and no draft. */
function createDraftFixture() {
  const harness = createBotApiCommandSession('draft-and-chat-action-transactions');
  const { session } = harness;
  const adaId = harness.createAccount('Ada');
  const alpha = harness.createBot('alpha_bot');
  const start = session.privateMessaging.sendAccountMessage({
    fromAccountId: adaId,
    to: { type: 'private', botId: alpha.id },
    content: { kind: 'text', text: '/start' },
  });
  if (!start.sent) {
    throw new Error(`Expected Ada to start her chat: ${JSON.stringify(start)}`);
  }
  const conversation = { accountId: adaId, botId: alpha.id };

  return {
    ...harness,
    adaId,
    alpha,
    /** What Ada's client shows, and Alpha's updates and calls, through reads that record nothing. */
    readState: () => {
      const chatActions = session.chatActions.getPrivateChatActions(conversation);
      const draft = session.messageDrafts.getPrivateMessageDraft(conversation);
      return {
        shown: {
          chatActions: chatActions.found ? chatActions.chatActions : chatActions.reason,
          draft: draft.found ? draft.draft ?? null : draft.reason,
        },
        pendingUpdates: harness.countPendingUpdates([alpha]),
        activityHead: session.botActivity.getHeadPosition(),
      };
    },
  };
}
