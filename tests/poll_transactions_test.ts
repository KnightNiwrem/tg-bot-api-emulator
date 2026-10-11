import { assertEquals, assertRejects, assertThrows } from '@std/assert';

import { sendPoll } from '../src/api/sessions/bot_api/message_sends.ts';
import {
  createBotApiCommandSession,
  FAILED_RECORDING_MESSAGE,
} from './support/bot_api_command_session.ts';

const FAILED_VIEW_MESSAGE = 'The view failed';

Deno.test('a vote whose projection fails after its poll answer is staged changes no answer', () => {
  using fixture = createPollFixture();
  const stateBefore = fixture.readState();
  const vote = () => fixture.vote([1]);

  // Alpha's `poll_answer` update is staged before its view of the poll's new counts fails.
  const restoreViews = fixture.failPollViews();
  assertThrows(vote, Error, FAILED_VIEW_MESSAGE);
  restoreViews();
  const stateAfterFailure = fixture.readState();

  assertEquals(stateAfterFailure, stateBefore);
  assertEquals(vote().answered, true);
  assertEquals(fixture.readState(), {
    ...stateBefore,
    chosenOptionPositions: [1],
    pendingUpdates: [stateBefore.pendingUpdates[0] + 2],
  });
});

Deno.test("a poll's expiry whose projection fails leaves the poll open", () => {
  using fixture = createPollFixture();
  const stateBefore = fixture.readState();
  const expire = () => fixture.session.polls.expirePoll(fixture.pollId);

  const restoreViews = fixture.failPollViews();
  assertThrows(expire, Error, FAILED_VIEW_MESSAGE);
  restoreViews();
  const stateAfterFailure = fixture.readState();

  assertEquals(stateAfterFailure, stateBefore);
  assertEquals(expire().expired, true);
  assertEquals(fixture.readState().isClosed, true);
});

Deno.test('a stopPoll whose record fails leaves the poll open and its keyboard as it was', async () => {
  using fixture = createPollFixture();
  const stateBefore = fixture.readState();
  const stopPoll = () =>
    fixture.callMethod(fixture.alpha, 'stopPoll', {
      chat_id: String(fixture.adaId),
      message_id: String(fixture.pollMessageId),
      reply_markup: JSON.stringify({ inline_keyboard: [[{ text: 'Results', url: RESULTS_URL }]] }),
    });

  // The closure, the message's new keyboard and the poll's update are staged before the record
  // fails.
  const restoreRecording = fixture.failCallRecording();
  await assertRejects(stopPoll, Error, FAILED_RECORDING_MESSAGE);
  restoreRecording();
  const stateAfterFailure = fixture.readState();
  const stop = await stopPoll();

  assertEquals(stateAfterFailure, stateBefore);
  assertEquals(stop.answered && stop.answer.body.ok, true);
  assertEquals(
    [fixture.readState().isClosed, fixture.readState().keyboardUrls],
    [true, [RESULTS_URL]],
  );
});

Deno.test('a stopPoll prepared before its poll expired is refused', async () => {
  using fixture = createPollFixture();
  const reply = fixture.holdWebhookReply(fixture.alpha, {
    method: 'stopPoll',
    chat_id: String(fixture.adaId),
    message_id: String(fixture.pollMessageId),
  });

  // The poll's closing time arrives while the reply is still being read.
  assertEquals(fixture.session.polls.expirePoll(fixture.pollId).expired, true);
  const stateBeforeRelease = fixture.readState();
  await reply.release();

  assertEquals(fixture.readState(), {
    ...stateBeforeRelease,
    activityHead: stateBeforeRelease.activityHead + 1,
  });
  assertEquals(await fixture.lastRecordedAnswer(), {
    ok: false,
    error_code: 400,
    description: 'Bad Request: poll has already been closed',
  });
});

Deno.test('a stopPoll prepared before its session ended changes nothing', async () => {
  using fixture = createPollFixture();
  const reply = fixture.holdWebhookReply(fixture.alpha, {
    method: 'stopPoll',
    chat_id: String(fixture.adaId),
    message_id: String(fixture.pollMessageId),
  });
  const stateBefore = fixture.readState();

  fixture.session.end();
  await reply.release();

  assertEquals(fixture.readState(), stateBefore);
});

const RESULTS_URL = 'https://example.com/results';

/**
 * Ada's private chat with Alpha, which Ada started, where Alpha sent a poll that is not anonymous
 * and closes after a minute.
 */
function createPollFixture() {
  const harness = createBotApiCommandSession('poll-transactions');
  const { session } = harness;
  const adaId = harness.createAccount('Ada');
  const alpha = harness.createBot('alpha_bot');
  const start = session.messageSending.sendAccountPrivateChatMessage({
    fromAccountId: adaId,
    chat: { type: 'private', peerId: alpha.id },
    content: { kind: 'text', text: '/start' },
  });
  if (!start.sent) {
    throw new Error(`Expected Ada to start her chat: ${JSON.stringify(start)}`);
  }
  const pollMessage = sendPoll({ session, bot: alpha, signal: session.lifetime.endSignal }, {
    chatId: adaId,
    question: { text: 'Lunch?', entities: [] },
    pollOptions: [{ text: 'Yes', entities: [] }, { text: 'No', entities: [] }],
    isAnonymous: false,
    allowsMultipleAnswers: false,
    allowsRevoting: true,
    type: { kind: 'regular' },
    isClosed: false,
    closingTime: { kind: 'open_period', openPeriodSeconds: 60 },
  });
  if (!pollMessage.sent || !('poll' in pollMessage.message)) {
    throw new Error(`Expected Alpha's poll to be sent: ${JSON.stringify(pollMessage)}`);
  }
  const pollMessageId = pollMessage.message.message_id;
  const pollMessageKey = {
    accountId: adaId,
    chat: { type: 'private', botId: alpha.id },
    messageId: pollMessageId,
  } as const;

  return {
    ...harness,
    adaId,
    alpha,
    pollId: pollMessage.message.poll.id,
    pollMessageId,
    vote: (optionPositions: readonly number[]) =>
      session.polls.setAccountPollAnswer({ ...pollMessageKey, optionPositions }),
    /**
     * Makes the session's views of a poll for the bot that sent it fail, as a projector that
     * breaks an invariant would, until the returned function is called.
     */
    failPollViews: (): () => void => {
      const views = session.botMessageViews;
      const viewPollForCreator = views.viewPollForCreator.bind(views);
      views.viewPollForCreator = () => {
        throw new Error(FAILED_VIEW_MESSAGE);
      };
      return () => {
        views.viewPollForCreator = viewPollForCreator;
      };
    },
    /** The poll and its message as Ada sees them, and Alpha's updates and calls. */
    readState: () => {
      const answer = session.polls.getAccountPollAnswer(pollMessageKey);
      if (!answer.found) {
        throw new Error(`Expected Ada to find the poll: ${answer.reason}`);
      }
      const { message, poll } = answer;
      return {
        isClosed: poll.isClosed,
        chosenOptionPositions: answer.chosenOptionPositions,
        keyboardUrls: 'inlineKeyboard' in message
          ? (message.inlineKeyboard ?? []).flat().map((button) =>
            'url' in button ? button.url : null
          )
          : [],
        pendingUpdates: harness.countPendingUpdates([alpha]),
        activityHead: session.botActivity.getHeadPosition(),
      };
    },
  };
}
