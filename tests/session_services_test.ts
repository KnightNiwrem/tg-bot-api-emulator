import { assertEquals, assertRejects } from '@std/assert';
import type { BotApiWebhookInfo } from '../src/types/bot_api.ts';
import type { EmulationSession } from '../src/session/emulation_session.ts';
import { createTestSession } from './support/emulation_api.ts';
import {
  createPrivateConversationFixture,
  createSupergroupFixture,
} from './support/http_fixtures.ts';
import { ControlledScheduler, createRetryScheduler } from './support/scheduler.ts';
import { TEST_UNIX_TIME_SECONDS } from './support/fixed_wall_clock.ts';
import { buildSessionServices } from './support/session_services.ts';
import { createVirtualAccount, createVirtualBot } from './support/virtual_users.ts';
import {
  waitForAbort,
  waitUntil,
  WEBHOOK_URL,
  webhookRequest,
} from './support/webhook_delivery.ts';

Deno.test('a session built for a test dates messages by a fixed clock unless given its own', async () => {
  using fixedClockSession = buildSessionServices();
  using ownClockSession = buildSessionServices({
    wallClock: { currentUnixTimeSeconds: () => 1_234_567_890 },
  });

  assertEquals(
    [await readFirstMessageDate(fixedClockSession), await readFirstMessageDate(ownClockSession)],
    [TEST_UNIX_TIME_SECONDS, 1_234_567_890],
    "Expected each message to be dated by its session's clock",
  );
});

Deno.test('disposing of a session built for a test ends it, answering its held long poll', async () => {
  const scheduler = new ControlledScheduler();
  let endedSession: EmulationSession;
  let heldPoll: Promise<unknown>;
  {
    using session = buildSessionServices({ scheduler });
    const bot = createVirtualBot(session.virtualUsers, {
      first_name: 'Test Bot',
      username: 'test_bot',
    });
    heldPoll = session.botUpdateConsumers.getUpdates(bot.profile.id, {
      limit: 100,
      timeoutSeconds: 30,
    });
    endedSession = session;
  }

  assertEquals(
    [
      await heldPoll,
      endedSession.lifetime.admitsCommits,
      endedSession.transactions.execute(() => 'committed'),
      scheduler.deadlines.map((deadline) => deadline.lifetime.aborted),
    ],
    [
      { retrieved: false, reason: 'session_ended' },
      false,
      { executed: false, reason: 'session_ended' },
      [true],
    ],
    "Expected the session's long poll answered, its commit gate closed and its deadline released",
  );
});

Deno.test('disposing of an HTTP fixture disposes of the emulator it created', async () => {
  const createFixtures = {
    createTestSession,
    createPrivateConversationFixture,
    createSupergroupFixture,
  };
  for (const [name, createFixture] of Object.entries(createFixtures)) {
    let createSession: () => Promise<Response>;
    {
      await using fixture = await createFixture();
      createSession = () => fixture.api.request('/sessions', { method: 'POST' });
      assertEquals(
        (await createSession()).status,
        201,
        `Expected the emulator of ${name} to answer while the fixture is in use`,
      );
    }

    await assertRejects(
      createSession,
      TypeError,
      'disposed of',
      `Expected the emulator of ${name} to refuse requests once the fixture is disposed of`,
    );
  }
});

Deno.test('a session built for a test reaches no webhook over the network unless given a transport', async () => {
  const receivedUrls: string[] = [];
  // A failed delivery is not sent again, so the unreachable webhook is tried once.
  using unreachableSession = buildSessionServices({
    scheduler: createRetryScheduler((_delaySeconds, signal) => waitForAbort(signal)),
  });
  using ownTransportSession = buildSessionServices({
    webhookTransport: (request) => {
      receivedUrls.push(request.url);
      return Promise.resolve(new Response(null));
    },
  });
  const readUnreachableInfo = sendUpdateToWebhook(unreachableSession);
  const readOwnTransportInfo = sendUpdateToWebhook(ownTransportSession);
  await waitUntil(() =>
    readUnreachableInfo().last_error_message !== undefined &&
    readOwnTransportInfo().pending_update_count === 0
  );

  assertEquals(
    [
      readUnreachableInfo().last_error_message,
      readUnreachableInfo().pending_update_count,
      receivedUrls,
    ],
    ["Can't connect to the webhook", 1, [WEBHOOK_URL]],
    "Expected the default transport to fail as an unreachable webhook, and the test's to be used",
  );
});

/**
 * Sets a bot's webhook in `session` and has Ada write to the bot, and answers with a reader of the
 * bot's `getWebhookInfo`.
 */
function sendUpdateToWebhook(session: EmulationSession): () => BotApiWebhookInfo {
  const adaId = createVirtualAccount(session.virtualUsers, { first_name: 'Ada' }).profile.id;
  const bot = createVirtualBot(session.virtualUsers, {
    first_name: 'Test Bot',
    username: 'test_bot',
  }).profile;
  session.botUpdateConsumers.setWebhook(bot.id, webhookRequest());
  session.messageSending.sendAccountPrivateChatMessage({
    fromAccountId: adaId,
    chat: { type: 'private', peerId: bot.id },
    content: { kind: 'text', text: 'Hello' },
  });
  return () => session.botUpdateConsumers.getWebhookInfo(bot.id);
}

/** Ada writes to a bot in `session`, and the date of that message as the bot receives it. */
async function readFirstMessageDate(session: EmulationSession): Promise<number | undefined> {
  const adaId = createVirtualAccount(session.virtualUsers, { first_name: 'Ada' }).profile.id;
  const bot = createVirtualBot(session.virtualUsers, {
    first_name: 'Test Bot',
    username: 'test_bot',
  });
  session.messageSending.sendAccountPrivateChatMessage({
    fromAccountId: adaId,
    chat: { type: 'private', peerId: bot.profile.id },
    content: { kind: 'text', text: 'Hello' },
  });
  const result = await session.botUpdateConsumers.getUpdates(bot.profile.id, {
    limit: 100,
    timeoutSeconds: 0,
  });
  const [update] = result.retrieved ? result.updates : [];
  return update !== undefined && 'message' in update ? update.message.date : undefined;
}
