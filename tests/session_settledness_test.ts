import { assertEquals } from '@std/assert';

import type { BotActivityEntry, BotActivityFilter } from '../src/types/bot_activity.ts';
import { createPrivateConversationFixture } from './support/http_fixtures.ts';
import { jsonRequest } from './support/emulation_api.ts';
import {
  createWebhookSession,
  respondOnlyByAborting,
  waitUntil,
  type WebhookResponder,
} from './support/webhook_delivery.ts';

Deno.test('a polling bot waits passively for its updates, their confirmation, and its held poll', async () => {
  await using fixture = await createPrivateConversationFixture();
  const { api, sessionPath, botApiPath, createdBot } = fixture;
  const botId = createdBot.bot.id;
  const readSettledness = async () => {
    const response = await api.request(`${sessionPath}/settledness`);
    return await response.json();
  };
  const fresh = await readSettledness();

  await fixture.sendText('/start');
  const withUndeliveredUpdate = await readSettledness();
  const updates = await (await api.request(`${botApiPath}/getUpdates`)).json();
  const withUnconfirmedDelivery = await readSettledness();
  const updateId = updates.result[0].update_id;
  // The poll confirms the update and is held, as no other update waits.
  const heldPoll = api.request(
    `${botApiPath}/getUpdates`,
    jsonRequest('POST', { offset: updateId + 1, timeout: 30 }),
  );
  let whileHeld = await readSettledness();
  for (let reads = 1; reads < 100 && whileHeld.blockers[0]?.kind !== 'held_long_poll'; reads++) {
    whileHeld = await readSettledness();
  }
  await fixture.sendText('Hello');
  await (await heldPoll).body?.cancel();

  assertEquals(
    [fresh, withUndeliveredUpdate, withUnconfirmedDelivery, whileHeld].map(
      ({ settled, bots, blockers }) => ({ settled, bots, blockers }),
    ),
    [
      { settled: true, bots: [mailbox(botId, 0)], blockers: [] },
      {
        settled: true,
        bots: [mailbox(botId, 1)],
        blockers: [
          { kind: 'undelivered_update', runnable: false, bot_id: botId, update_id: updateId },
        ],
      },
      {
        settled: true,
        bots: [mailbox(botId, 1)],
        blockers: [
          { kind: 'unconfirmed_delivery', runnable: false, bot_id: botId, update_id: updateId },
        ],
      },
      {
        settled: true,
        bots: [mailbox(botId, 0)],
        blockers: [{ kind: 'held_long_poll', runnable: false, bot_id: botId }],
      },
    ],
  );
  assertEquals(
    withUnconfirmedDelivery.activity_position > withUndeliveredUpdate.activity_position,
    true,
    'Expected the read to sample the activity log with the work state',
  );
});

Deno.test('a manual retry waits passively for the test, and is not sent until released', async () => {
  using fixture = createWebhookFixture(() => new Response(null, { status: 500 }));
  const { session, bot, adaId, webhookAttempts } = fixture;
  webhookAttempts.setScheduling(bot.id, 'manual');
  fixture.sendAccountMessage(adaId);
  fixture.setWebhook();
  await fixture.waitForEntry({ kind: 'webhook_attempt_failed' });

  // Nothing the emulator does by itself is left: the retry waits for the test.
  assertEquals(session.settledness.readSettledness().settled, true);
  assertEquals(fixture.receivedRequests.length, 1);
  assertEquals(fixture.readBlockers(), [{
    kind: 'webhook_retry',
    runnable: false,
    botId: bot.id,
    updateId: 1,
    webhookAttemptId: 1,
    scheduling: 'manual',
  }]);
});

Deno.test('an automatic retry is work the emulator will do by itself', async () => {
  using fixture = createWebhookFixture(() => new Response(null, { status: 500 }));
  const { session, bot, adaId } = fixture;
  fixture.sendAccountMessage(adaId);
  fixture.setWebhook();
  await fixture.waitForEntry({ kind: 'webhook_attempt_failed' });

  assertEquals(
    [session.settledness.readSettledness().settled, fixture.readBlockers()],
    [false, [{
      kind: 'webhook_retry',
      runnable: true,
      botId: bot.id,
      updateId: 1,
      webhookAttemptId: 1,
      scheduling: 'automatic',
    }]],
  );
});

Deno.test('an update is due to its webhook until sent, then waits for the webhook', async () => {
  using fixture = createWebhookFixture(respondOnlyByAborting);
  const { session, bot, adaId } = fixture;
  fixture.sendAccountMessage(adaId);
  fixture.setWebhook();
  const beforeSending = session.settledness.readSettledness();
  await fixture.waitForEntry({ kind: 'update_delivered' });

  assertEquals(
    [
      { settled: beforeSending.settled, blockers: beforeSending.blockers },
      { settled: session.settledness.readSettledness().settled, blockers: fixture.readBlockers() },
    ],
    [
      {
        settled: false,
        blockers: [{ kind: 'webhook_delivery_due', runnable: true, botId: bot.id, updateId: 1 }],
      },
      {
        settled: true,
        blockers: [{
          kind: 'webhook_attempt',
          runnable: false,
          botId: bot.id,
          updateId: 1,
          webhookAttemptId: 1,
          scheduling: 'automatic',
        }],
      },
    ],
  );
});

Deno.test("an accepted update's reply is in progress whenever its confirmation can be read", async () => {
  using fixture = createWebhookFixture(() =>
    Response.json({ method: 'sendMessage', chat_id: fixture.adaId, text: 'Thanks' })
  );
  const { session, adaId } = fixture;
  const order: string[] = [];
  const begin = session.work.begin.bind(session.work);
  session.work.begin = (work) => {
    order.push(`${work.via} registered`);
    return begin(work);
  };
  fixture.sendAccountMessage(adaId, '/start');
  fixture.setWebhook();

  // The earliest a reader can learn of the confirmation is when the log wakes it.
  await fixture.waitForEntry({ kind: 'update_confirmed' });
  order.push('confirmation read');
  const atConfirmation = session.settledness.readSettledness();
  const replyRecorded = (await fixture.readEntries({ kind: 'bot_api_call' })).length > 0;

  assertEquals(order, ['webhook_reply registered', 'confirmation read']);
  assertEquals(
    replyRecorded ||
      atConfirmation.blockers.some((blocker) =>
        blocker.kind === 'bot_api_call' && blocker.via === 'webhook_reply'
      ),
    true,
    'Expected the reply to be in progress, or done, when the confirmation could be read',
  );
  assertEquals(atConfirmation.settled && atConfirmation.bots[0].drained && !replyRecorded, false);
});

Deno.test('a bot that confirms an update while its own work goes on is reported settled', async () => {
  // The webhook answers at once, as a bot that confirms an update before it handles it does, and
  // handles it later, outside the webhook's exchange.
  let isBotHandlingUpdate = false;
  using fixture = createWebhookFixture(() => {
    isBotHandlingUpdate = true;
    return new Response(null, { status: 200 });
  });
  const { session, bot, adaId } = fixture;
  fixture.sendAccountMessage(adaId);
  fixture.setWebhook();
  await fixture.waitForEntry({ kind: 'update_confirmed' });
  // The empty response's reply runs nothing, once the emulator has read it.
  await waitUntil(() => session.settledness.readSettledness().settled);

  const whileBotWorks = session.settledness.readSettledness();

  // The read describes the emulator only: it cannot tell that the bot is still working.
  assertEquals(isBotHandlingUpdate, true);
  assertEquals(
    { settled: whileBotWorks.settled, bots: whileBotWorks.bots, blockers: whileBotWorks.blockers },
    {
      settled: true,
      bots: [{ botId: bot.id, pendingUpdateCount: 0, drained: true }],
      blockers: [],
    },
  );
});

function mailbox(botId: number, pendingUpdateCount: number) {
  return {
    bot_id: botId,
    pending_update_count: pendingUpdateCount,
    drained: pendingUpdateCount === 0,
  };
}

/** A root-backed session whose bot's webhook requests `respond` answers. */
function createWebhookFixture(respond: WebhookResponder) {
  const webhookSession = createWebhookSession(respond, { id: 'session-settledness' });
  const { session, bot } = webhookSession;
  const readEntries = async (filter: BotActivityFilter): Promise<readonly BotActivityEntry[]> => {
    const reading = await session.botActivity.readEntries({
      after: 0,
      filter: { ...filter, botId: bot.id },
      limit: 100,
      waitMilliseconds: 0,
    });
    return reading.read ? reading.entries : [];
  };
  return {
    ...webhookSession,
    webhookAttempts: session.webhookAttempts,
    readEntries,
    /** Resolves with the first matching entry of the bot, waiting up to a second for one. */
    waitForEntry: async (filter: BotActivityFilter): Promise<BotActivityEntry> => {
      const reading = await session.botActivity.readEntries({
        after: 0,
        filter: { ...filter, botId: bot.id },
        limit: 1,
        waitMilliseconds: 1_000,
      });
      const [entry] = reading.read ? reading.entries : [];
      if (entry === undefined) {
        throw new Error(`Expected an entry matching ${JSON.stringify(filter)} within a second`);
      }
      return entry;
    },
    readBlockers: () => session.settledness.readSettledness().blockers,
  };
}
