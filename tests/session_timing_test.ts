import type { WallClock } from '../src/timing/session/session_timing.ts';
import type { EmulationSession } from '../src/session/emulation_session.ts';
import type { VirtualBotProfile } from '../src/types/virtual_bot.ts';
import { ControlledScheduler } from './support/scheduler.ts';
import { buildSessionServices } from './support/session_services.ts';
import { createVirtualAccount, createVirtualBot } from './support/virtual_users.ts';

Deno.test('A session dates Telegram messages by its own wall clock', async () => {
  const wallClock = new JumpingWallClock(1_234_567_890, 0);
  using session = buildSessionServices({ wallClock, scheduler: new ControlledScheduler() });
  const { accountId, bot } = createAccountAndBot(session);

  session.messageSending.sendAccountPrivateChatMessage({
    fromAccountId: accountId,
    chat: { type: 'private', peerId: bot.id },
    content: { kind: 'text', text: '/start' },
  });

  const result = await session.botApi.getUpdates(bot, { limit: 100, timeoutSeconds: 0 });
  const [update] = result.retrieved ? result.updates : [];
  if (update === undefined || !('message' in update) || update.message.date !== 1_234_567_890) {
    throw new Error(
      `Expected the message dated by the session's clock, saw ${JSON.stringify(result)}`,
    );
  }
});

Deno.test('A session times long polls and activity reads by its scheduler alone', async () => {
  // Calendar time jumps back an hour each time it is read, which must not move any deadline.
  const wallClock = new JumpingWallClock(1_700_000_000, -3_600);
  const scheduler = new ControlledScheduler();
  using session = buildSessionServices({ wallClock, scheduler });
  const { accountId, bot } = createAccountAndBot(session);
  session.messageSending.sendAccountPrivateChatMessage({
    fromAccountId: accountId,
    chat: { type: 'private', peerId: bot.id },
    content: { kind: 'text', text: '/start' },
  });
  await session.botApi.getUpdates(bot, { offset: 2, limit: 100, timeoutSeconds: 0 });

  let longPollAnswered = false;
  const longPoll = session.botApi.getUpdates(bot, { offset: 2, limit: 100, timeoutSeconds: 30 })
    .finally(() => {
      longPollAnswered = true;
    });
  let readAnswered = false;
  const read = session.botActivity.readEntries({
    after: session.botActivity.getHeadPosition(),
    filter: { kind: 'bot_api_call' },
    limit: 100,
    waitMilliseconds: 10_000,
  }).finally(() => {
    readAnswered = true;
  });
  await new Promise((resolve) => setTimeout(resolve, 0));

  const [longPollDeadline, readDeadline] = scheduler.deadlines;
  if (
    scheduler.deadlines.length !== 2 || longPollDeadline.delayMilliseconds !== 30_000 ||
    readDeadline.delayMilliseconds !== 10_000 || longPollAnswered || readAnswered
  ) {
    throw new Error(
      `Expected both waits held on deadlines of 30 and 10 seconds, saw ${
        JSON.stringify(scheduler.deadlines.map((deadline) => deadline.delayMilliseconds))
      }`,
    );
  }

  longPollDeadline.arrive();
  readDeadline.arrive();
  const [longPollResult, readResult] = await Promise.all([longPoll, read]);
  if (
    !longPollResult.retrieved || longPollResult.updates.length !== 0 || !readResult.read ||
    readResult.entries.length !== 0
  ) {
    throw new Error('Expected both waits to be answered with nothing once their deadlines arrived');
  }
  if (!longPollDeadline.lifetime.aborted || !readDeadline.lifetime.aborted) {
    throw new Error('Expected each answered wait to release its deadline');
  }
});

/** A wall clock that changes by `jumpSeconds` each time it is read. */
class JumpingWallClock implements WallClock {
  #unixTimeSeconds: number;
  readonly #jumpSeconds: number;

  constructor(unixTimeSeconds: number, jumpSeconds: number) {
    this.#unixTimeSeconds = unixTimeSeconds;
    this.#jumpSeconds = jumpSeconds;
  }

  currentUnixTimeSeconds(): number {
    const unixTimeSeconds = this.#unixTimeSeconds;
    this.#unixTimeSeconds += this.#jumpSeconds;
    return unixTimeSeconds;
  }
}

/** Creates Ada and a bot that Ada can write to. */
function createAccountAndBot(session: EmulationSession): {
  readonly accountId: number;
  readonly bot: VirtualBotProfile;
} {
  return {
    accountId: createVirtualAccount(session.virtualUsers, { first_name: 'Ada' }).profile.id,
    bot: createVirtualBot(session.virtualUsers, { first_name: 'Test Bot', username: 'test_bot' })
      .profile,
  };
}
