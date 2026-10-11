import { assertEquals, assertRejects, assertThrows } from '@std/assert';

import { QueuedBotApiAnswerRepository } from '../src/repositories/queued_bot_api_answer.ts';
import { SessionLifetime } from '../src/services/session_lifetime.ts';
import { SessionChangeJournal } from '../src/transactions/change_staging.ts';
import type { QueuedRateLimitResponses } from '../src/types/bot_rate_limit.ts';
import {
  createBotApiCommandSession,
  FAILED_RECORDING_MESSAGE,
} from './support/bot_api_command_session.ts';
import { createUnprojectedTransactions } from './support/unprojected_transactions.ts';

const WEBHOOK_URL = 'https://bot.example/webhook';

Deno.test('a setWebhook whose record fails sets no webhook and leaves its long poll held', async () => {
  using fixture = createDeliveryFixture();
  const { alpha } = fixture;
  await fixture.confirmEveryUpdate();
  const heldPoll = fixture.callMethod(alpha, 'getUpdates', { timeout: '30' });
  const setWebhook = () => fixture.callMethod(alpha, 'setWebhook', { url: WEBHOOK_URL });

  // The webhook is staged before the record fails; starting its delivery and ending the held
  // long poll wait for the publication that never comes.
  const restoreRecording = fixture.failCallRecording();
  await assertRejects(setWebhook, Error, FAILED_RECORDING_MESSAGE);
  restoreRecording();
  const webhookAfterFailure = fixture.session.botApi.getWebhookInfo(alpha).url;
  fixture.sendAdaText('Hello');
  const poll = await heldPoll;

  assertEquals(webhookAfterFailure, '');
  // The long poll is answered with Ada's message, not ended as a webhook's setting ends it.
  assertEquals(
    poll.answered && poll.answer.body.ok && Array.isArray(poll.answer.body.result)
      ? poll.answer.body.result.length
      : poll,
    1,
  );
  assertEquals(fixture.webhookRequests.length, 0);
  // Once the record works, the same call sets the webhook.
  await fixture.expectResult(setWebhook());
  assertEquals(fixture.session.botApi.getWebhookInfo(alpha).url, WEBHOOK_URL);
});

Deno.test('a deleteWebhook dropping pending updates whose record fails keeps both', async () => {
  using fixture = createDeliveryFixture();
  const { alpha, session } = fixture;
  await fixture.callMethodExpectingResult(alpha, 'setWebhook', { url: WEBHOOK_URL });
  const webhookBefore = session.botApi.getWebhookInfo(alpha);

  const restoreRecording = fixture.failCallRecording();
  await assertRejects(
    () => fixture.callMethod(alpha, 'deleteWebhook', { drop_pending_updates: 'true' }),
    Error,
    FAILED_RECORDING_MESSAGE,
  );
  restoreRecording();

  assertEquals(webhookBefore.pending_update_count, 1);
  assertEquals(session.botApi.getWebhookInfo(alpha), webhookBefore);
});

Deno.test("a getUpdates whose confirmations fail to be recorded confirms nothing and keeps the bot's subscription", async () => {
  using fixture = createDeliveryFixture();
  const { alpha, session } = fixture;
  const [update] = await fixture.readUpdates();
  const pollPastUpdate = () =>
    fixture.callMethod(alpha, 'getUpdates', {
      offset: String(update.update_id + 1),
      allowed_updates: JSON.stringify(['callback_query']),
    });
  const webhookInfoBefore = session.botApi.getWebhookInfo(alpha);
  const activity = session.botActivity;
  const recordUpdateConfirmations = activity.recordUpdateConfirmations.bind(activity);
  // The subscription and the confirmation are staged before the confirmation's record fails.
  activity.recordUpdateConfirmations = () => {
    throw new Error(FAILED_RECORDING_MESSAGE);
  };

  await assertRejects(pollPastUpdate, Error, FAILED_RECORDING_MESSAGE);
  activity.recordUpdateConfirmations = recordUpdateConfirmations;
  const webhookInfoAfterFailure = session.botApi.getWebhookInfo(alpha);
  await fixture.expectResult(pollPastUpdate());

  assertEquals(webhookInfoAfterFailure, webhookInfoBefore);
  assertEquals(webhookInfoBefore.pending_update_count, 1);
  assertEquals(session.botApi.getWebhookInfo(alpha), {
    ...webhookInfoBefore,
    pending_update_count: 0,
    allowed_updates: ['callback_query'],
  });
});

Deno.test('a queued answer whose record fails stays queued for the next call', async () => {
  using fixture = createDeliveryFixture();
  const { alpha, adaId, session } = fixture;
  session.botRateLimits.queueRateLimitResponses(alpha.id, {
    retryAfterSeconds: 5,
    remainingCount: 1,
  });
  const sendText = () =>
    fixture.callMethod(alpha, 'sendMessage', { chat_id: String(adaId), text: 'Reminder' });

  const restoreRecording = fixture.failCallRecording();
  await assertRejects(sendText, Error, FAILED_RECORDING_MESSAGE);
  restoreRecording();
  const queuedAfterFailure = session.botRateLimits.listRateLimitResponses(alpha.id);
  const answer = await sendText();

  assertEquals(queuedAfterFailure, {
    found: true,
    responses: [{ retryAfterSeconds: 5, remainingCount: 1 }],
  });
  assertEquals(answer.answered && answer.answer.status, 429);
  assertEquals(session.botRateLimits.listRateLimitResponses(alpha.id), {
    found: true,
    responses: [],
  });
});

Deno.test('effects run once their command is published, in order, and never for one that aborts', () => {
  const transactions = createUnprojectedTransactions(
    new SessionLifetime(new AbortController().signal),
  );
  const effects: string[] = [];

  assertThrows(
    () =>
      transactions.execute(() => {
        transactions.runAfterPublication(() => effects.push('aborted'));
        throw new Error('The command failed');
      }),
    Error,
    'The command failed',
  );
  transactions.execute(() => {
    transactions.runAfterPublication(() => effects.push('first'));
    transactions.runAfterPublication(() => effects.push('second'));
    effects.push('command');
  });
  transactions.runAfterPublication(() => effects.push('outside a command'));

  assertEquals(effects, ['command', 'first', 'second', 'outside a command']);
});

Deno.test('a queued answer taken in a transaction that aborts stays queued', () => {
  const journal = new SessionChangeJournal({ reportNotificationFailure: () => {} });
  const answers = new QueuedBotApiAnswerRepository<QueuedRateLimitResponses>(journal);
  answers.enqueue(1, { retryAfterSeconds: 5, remainingCount: 2 });
  answers.enqueue(1, { methodName: 'sendMessage', retryAfterSeconds: 7, remainingCount: 1 });
  const queuedBefore = answers.list(1);

  journal.begin();
  answers.take(1, 'sendMessage');
  answers.take(1, 'sendMessage');
  answers.take(1, 'sendMessage');
  journal.abort();

  assertEquals(answers.list(1), queuedBefore);
});

/**
 * Ada's private chat with Alpha, which Ada started, so that Alpha has her message pending, in a
 * session whose webhook requests are recorded and never answered.
 */
function createDeliveryFixture() {
  const webhookRequests: Request[] = [];
  const harness = createBotApiCommandSession('update-delivery-transactions', {
    webhookTransport: (request) => {
      webhookRequests.push(request);
      return new Promise(() => {});
    },
  });
  const { session } = harness;
  const adaId = harness.createAccount('Ada');
  const alpha = harness.createBot('alpha_bot');
  const sendAdaText = (text: string) => {
    const sending = session.messageSending.sendAccountPrivateChatMessage({
      fromAccountId: adaId,
      chat: { type: 'private', peerId: alpha.id },
      content: { kind: 'text', text },
    });
    if (!sending.sent) {
      throw new Error(`Expected Ada's message to be sent: ${JSON.stringify(sending)}`);
    }
  };
  sendAdaText('/start');

  /** The result of a call that must succeed. */
  const expectResult = async (call: ReturnType<typeof harness.callMethod>): Promise<unknown> => {
    const outcome = await call;
    if (!outcome.answered || !outcome.answer.body.ok) {
      throw new Error(`Expected the call to succeed: ${JSON.stringify(outcome)}`);
    }
    return outcome.answer.body.result;
  };
  /** Reads Alpha's pending updates without confirming any. */
  const readUpdates = async (): Promise<readonly { readonly update_id: number }[]> => {
    const updates = await expectResult(harness.callMethod(alpha, 'getUpdates', {}));
    if (!Array.isArray(updates)) {
      throw new Error(`Expected updates, received ${JSON.stringify(updates)}`);
    }
    return updates;
  };

  return {
    ...harness,
    adaId,
    alpha,
    webhookRequests,
    sendAdaText,
    expectResult,
    readUpdates,
    /** Confirms every update waiting for Alpha. */
    confirmEveryUpdate: async () => {
      const lastUpdate = (await readUpdates()).at(-1);
      if (lastUpdate !== undefined) {
        await expectResult(
          harness.callMethod(alpha, 'getUpdates', { offset: String(lastUpdate.update_id + 1) }),
        );
      }
    },
  };
}
