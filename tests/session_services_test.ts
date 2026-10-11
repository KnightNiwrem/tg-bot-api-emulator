import { assertEquals, assertRejects } from '@std/assert';
import type { EmulationSession } from '../src/types/emulation_session.ts';
import { createTestSession } from './support/emulation_api.ts';
import {
  createPrivateConversationFixture,
  createSupergroupFixture,
} from './support/http_fixtures.ts';
import { ControlledScheduler } from './support/scheduler.ts';
import { buildSessionServices, TEST_UNIX_TIME_SECONDS } from './support/session_services.ts';
import { createVirtualAccount, createVirtualBot } from './support/virtual_users.ts';

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
    heldPoll = session.botApi.getUpdates(bot.profile, { limit: 100, timeoutSeconds: 30 });
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

/** Ada writes to a bot in `session`, and the date of that message as the bot receives it. */
async function readFirstMessageDate(session: EmulationSession): Promise<number | undefined> {
  const adaId = createVirtualAccount(session.virtualUsers, { first_name: 'Ada' }).profile.id;
  const bot = createVirtualBot(session.virtualUsers, {
    first_name: 'Test Bot',
    username: 'test_bot',
  });
  session.privateMessaging.sendAccountMessage({
    fromAccountId: adaId,
    to: { type: 'private', botId: bot.profile.id },
    content: { kind: 'text', text: 'Hello' },
  });
  const result = await session.botApi.getUpdates(bot.profile, { limit: 100, timeoutSeconds: 0 });
  const [update] = result.retrieved ? result.updates : [];
  return update !== undefined && 'message' in update ? update.message.date : undefined;
}
