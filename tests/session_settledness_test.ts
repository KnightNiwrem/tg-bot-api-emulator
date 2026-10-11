import { assertEquals } from '@std/assert';

import type { BotActivityEntry, BotActivityFilter } from '../src/types/bot_activity.ts';
import { createBotApiCommandSession } from './support/bot_api_command_session.ts';
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
      delaySeconds: 0,
    }]],
  );
});

Deno.test('an update is due to its webhook until sent, then its automatic attempt runs under its deadline', async () => {
  using fixture = createWebhookFixture(respondOnlyByAborting);
  const { session, bot, adaId } = fixture;
  fixture.sendAccountMessage(adaId);
  fixture.setWebhook();
  const beforeSending = session.settledness.readSettledness();
  await fixture.waitForEntry({ kind: 'update_delivered' });

  // The attempt's deadline would fail it by itself, so the session is not settled.
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
        settled: false,
        blockers: [{
          kind: 'webhook_attempt',
          runnable: true,
          botId: bot.id,
          updateId: 1,
          webhookAttemptId: 1,
          scheduling: 'automatic',
          timeoutSeconds: 60,
        }],
      },
    ],
  );
});

Deno.test('a manual attempt waits passively for the webhook or the test', async () => {
  using fixture = createWebhookFixture(respondOnlyByAborting);
  const { session, bot, adaId, webhookAttempts } = fixture;
  webhookAttempts.setScheduling(bot.id, 'manual');
  fixture.sendAccountMessage(adaId);
  fixture.setWebhook();
  await fixture.waitForEntry({ kind: 'update_delivered' });

  assertEquals(
    [session.settledness.readSettledness().settled, fixture.readBlockers()],
    [true, [{
      kind: 'webhook_attempt',
      runnable: false,
      botId: bot.id,
      updateId: 1,
      webhookAttemptId: 1,
      scheduling: 'manual',
    }]],
  );
});

Deno.test('a manual attempt the test expires is runnable until its delivery acts on it', async () => {
  using fixture = createWebhookFixture(respondOnlyByAborting);
  const { session, bot, adaId, webhookAttempts } = fixture;
  webhookAttempts.setScheduling(bot.id, 'manual');
  fixture.sendAccountMessage(adaId);
  fixture.setWebhook();
  await fixture.waitForEntry({ kind: 'update_delivered' });

  // The expiry ends the attempt's wait at once; its failure is recorded by the delivery later.
  const expiry = webhookAttempts.expireAttempt(bot.id, 1);
  const atExpiry = session.settledness.readSettledness();
  await expiry;

  assertEquals(
    [atExpiry.settled, atExpiry.blockers[0]],
    [false, {
      kind: 'webhook_attempt',
      runnable: true,
      botId: bot.id,
      updateId: 1,
      webhookAttemptId: 1,
      scheduling: 'manual',
    }],
  );
});

Deno.test('a manual attempt is runnable once its request or its response body fails, before the failure is recorded', async () => {
  for (const failingStep of ['request', 'response body'] as const) {
    const failure = Promise.withResolvers<never>();
    let isBodyRequested = false;
    using fixture = createWebhookFixture(() => {
      if (failingStep === 'request') {
        return failure.promise;
      }
      // The response's headers arrive; its body fails to.
      const response = new Response(null, { status: 200 });
      response.arrayBuffer = () => {
        isBodyRequested = true;
        return failure.promise;
      };
      return response;
    });
    const { session, bot, adaId, webhookAttempts } = fixture;
    webhookAttempts.setScheduling(bot.id, 'manual');
    fixture.sendAccountMessage(adaId);
    fixture.setWebhook();
    await fixture.waitForEntry({ kind: 'update_delivered' });
    // The body is read once the headers' arrival is acted on.
    if (failingStep === 'response body') {
      await waitUntil(() => isBodyRequested && !session.webhookAttempts.isAttemptAwake(1));
    }
    const whileWaiting = fixture.readBlockers();

    failure.reject(new Error('The connection failed'));
    // The read runs as soon as a reader can learn of the failure, before the delivery records it.
    await failure.promise.catch(() => {});
    const onceFailed = session.settledness.readSettledness();
    const failureRecorded = (await fixture.readEntries({ kind: 'webhook_attempt_failed' })).length;

    assertEquals(
      [failingStep, whileWaiting[0].runnable, onceFailed.settled, onceFailed.blockers[0]],
      [failingStep, false, false, {
        kind: 'webhook_attempt',
        runnable: true,
        botId: bot.id,
        updateId: 1,
        webhookAttemptId: 1,
        scheduling: 'manual',
      }],
    );
    assertEquals(failureRecorded, 0);
    await fixture.waitForEntry({ kind: 'webhook_attempt_failed' });
  }
});

Deno.test('deleting a webhook leaves its stopped attempt runnable until its delivery cancels it', async () => {
  using fixture = createWebhookFixture(respondOnlyByAborting);
  const { session, bot, adaId, webhookAttempts } = fixture;
  webhookAttempts.setScheduling(bot.id, 'manual');
  fixture.sendAccountMessage(adaId);
  fixture.setWebhook();
  await fixture.waitForEntry({ kind: 'update_delivered' });

  // The bot polls from now on, but its attempt in flight is stopped, not yet cancelled.
  session.botApi.deleteWebhook(bot, { dropPendingUpdates: false });
  const atDeletion = session.settledness.readSettledness();
  await waitUntil(() => session.settledness.readSettledness().settled);

  assertEquals(
    [atDeletion.settled, atDeletion.blockers, fixture.readBlockers()],
    [
      false,
      [{
        kind: 'webhook_attempt',
        runnable: true,
        botId: bot.id,
        updateId: 1,
        webhookAttemptId: 1,
        scheduling: 'manual',
      }],
      [{ kind: 'undelivered_update', runnable: false, botId: bot.id, updateId: 1 }],
    ],
  );
});

Deno.test('a held long poll is runnable as soon as an update it awaits is published', async () => {
  using fixture = createBotApiCommandSession('session-settledness-woken-poll');
  const { session } = fixture;
  const adaId = fixture.createAccount('Ada');
  const alpha = fixture.createBot('alpha_bot');
  const heldPoll = fixture.callMethod(alpha, 'getUpdates', { timeout: '30' });
  await waitUntil(() =>
    session.settledness.readSettledness().blockers.some(({ kind }) => kind === 'held_long_poll')
  );
  const whileHeld = session.settledness.readSettledness();

  // In the same step as the update is published, before the poll's continuation runs.
  const start = session.messageSending.sendAccountPrivateChatMessage({
    fromAccountId: adaId,
    chat: { type: 'private', peerId: alpha.id },
    content: { kind: 'text', text: '/start' },
  });
  const atPublication = session.settledness.readSettledness();
  const poll = await heldPoll;

  assertEquals(start.sent, true);
  assertEquals(
    [
      { settled: whileHeld.settled, blockers: whileHeld.blockers },
      { settled: atPublication.settled, blockers: atPublication.blockers },
    ],
    [
      {
        settled: true,
        blockers: [{ kind: 'held_long_poll', runnable: false, botId: alpha.id }],
      },
      {
        settled: false,
        blockers: [
          { kind: 'held_long_poll', runnable: true, botId: alpha.id },
          { kind: 'undelivered_update', runnable: false, botId: alpha.id, updateId: 1 },
        ],
      },
    ],
  );
  assertEquals(poll.answered && poll.answer.body.ok, true);
});

Deno.test("a webhook reply's call names its method once its body is read, until it is answered", async () => {
  const replyDownload = Promise.withResolvers<void>();
  using fixture = createWebhookFixture(() =>
    Response.json({ method: 'sendDocument', chat_id: fixture.adaId, document: DOCUMENT_URL })
  );
  const { bot, adaId } = fixture;
  fixture.registerHeldDocument(replyDownload.promise);
  fixture.sendAccountMessage(adaId, '/start');
  fixture.setWebhook();
  await fixture.waitForEntry({ kind: 'update_confirmed' });
  // The reply's method waits for its document's download.
  await waitUntil(() => fixture.downloadRequestCount() === 1);
  const whileDownloading = fixture.readBlockers();
  replyDownload.resolve();
  await fixture.waitForEntry({ kind: 'bot_api_call', method: 'sendDocument' });

  assertEquals(whileDownloading, [{
    kind: 'bot_api_call',
    runnable: true,
    botId: bot.id,
    via: 'webhook_reply',
    method: 'sendDocument',
  }]);
  // Once answered, the reply's call is no longer in progress.
  await waitUntil(() => fixture.readBlockers().length === 0);
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

const DOCUMENT_URL = 'https://files.example/report.pdf';

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
  let downloadRequestCount = 0;
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
    /** Serves a PDF at `DOCUMENT_URL`, whose downloads wait for `release`. */
    registerHeldDocument: (release: Promise<void>) => {
      const registration = session.webResources.registerWebResource({
        url: DOCUMENT_URL,
        status: 200,
        contentType: 'application/pdf',
        content: new TextEncoder().encode('%PDF-1.7'),
      });
      if (!registration.registered) {
        throw new Error('Expected the document to be served');
      }
      const webResources = session.webResources;
      const fetchWebResource = webResources.fetchWebResource.bind(webResources);
      webResources.fetchWebResource = async (request) => {
        downloadRequestCount++;
        await release;
        return await fetchWebResource(request);
      };
    },
    /** How many downloads from the session's web have started. */
    downloadRequestCount: () => downloadRequestCount,
  };
}
