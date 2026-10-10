import { BotActivityLogRepository } from '../src/repositories/bot_activity_log.ts';
import { BotUpdateRepository } from '../src/repositories/bot_update.ts';
import { BotUpdateSubscriptionRepository } from '../src/repositories/bot_update_subscription.ts';
import { BotActivityService } from '../src/services/bot_activity.ts';
import { BotUpdatePollingService } from '../src/services/bot_update_polling.ts';
import type { BotApiUpdate } from '../src/types/bot_api.ts';
import { ControlledDeadline, ControlledScheduler } from './support/scheduler.ts';
import { createPrivateMessage } from './support/webhook_delivery.ts';

const BOT_ID = 10;
const OTHER_BOT_ID = 20;

Deno.test('BotActivityLogRepository ends a wait at once for an entry already after its position', async () => {
  const log = new BotActivityLogRepository();
  log.append(updateDeliveredEntry(1));
  const deadline = createDeadline();

  const waitEnd = await log.waitForAppend({
    afterPosition: 0,
    deadline,
    signal: new AbortController().signal,
  });
  if (waitEnd !== 'notified') {
    throw new Error(`Expected the recorded entry to end the wait, saw ${waitEnd}`);
  }

  const laterWait = log.waitForAppend({
    afterPosition: 1,
    deadline,
    signal: new AbortController().signal,
  });
  log.append(updateDeliveredEntry(2));
  if (await laterWait !== 'notified') {
    throw new Error('Expected a later entry to end the wait');
  }
});

Deno.test("BotUpdateRepository ends a wait once the bot's awaited update is enqueued", async () => {
  const botUpdates = new BotUpdateRepository();
  const awaitedUpdateId = botUpdates.getNextUpdateId(BOT_ID);
  const deadline = createDeadline();
  let hasEnded = false;
  const wait = botUpdates.waitForUpdate(BOT_ID, { awaitedUpdateId, deadline }).finally(() => {
    hasEnded = true;
  });

  botUpdates.enqueueMessageUpdate(OTHER_BOT_ID, createPrivateMessage(1));
  await Promise.resolve();
  if (hasEnded) {
    throw new Error("Expected another bot's update to leave the wait held");
  }
  botUpdates.enqueueMessageUpdate(BOT_ID, createPrivateMessage(2));
  if (await wait !== 'notified') {
    throw new Error("Expected the bot's update to end the wait");
  }

  // A wait for an update that was enqueued since the caller looked ends at once.
  const missedWait = botUpdates.waitForUpdate(BOT_ID, { awaitedUpdateId, deadline });
  if (await missedWait !== 'notified') {
    throw new Error('Expected the already enqueued update to end the wait at once');
  }
});

Deno.test('BotActivityService answers a read with an entry recorded as its deadline starts', async () => {
  // Starting a host timer may run other code, as Deno's first `setTimeout` does.
  const scheduler = new ControlledScheduler();
  const botActivity = new BotActivityService({ log: new BotActivityLogRepository(), scheduler });
  scheduler.onDeadlineStart = () => {
    botActivity.recordUpdateDeliveries(BOT_ID, [messageUpdate(1)], 'polling');
  };

  const result = await botActivity.readEntries({
    after: 0,
    filter: {},
    limit: 100,
    waitMilliseconds: 10_000,
  });
  if (!result.read || result.entries.length !== 1) {
    throw new Error(`Expected the read to find the entry at once, saw ${JSON.stringify(result)}`);
  }
  if (!scheduler.deadlines.every((deadline) => deadline.lifetime.aborted)) {
    throw new Error('Expected the answered read to release its deadline');
  }
});

Deno.test('BotUpdatePollingService answers a long poll with an update enqueued as its deadline starts', async () => {
  const scheduler = new ControlledScheduler();
  const botUpdates = new BotUpdateRepository();
  const botUpdatePolling = new BotUpdatePollingService({
    botUpdates,
    updateSubscriptions: new BotUpdateSubscriptionRepository(),
    updateActivity: new BotActivityService({ log: new BotActivityLogRepository(), scheduler }),
    scheduler,
  });
  scheduler.onDeadlineStart = () => {
    botUpdates.enqueueMessageUpdate(BOT_ID, createPrivateMessage(1));
  };

  const result = await botUpdatePolling.getUpdates(BOT_ID, { limit: 100, timeoutSeconds: 30 });
  if (!result.retrieved || result.updates.length !== 1) {
    throw new Error(`Expected the long poll to return the update, saw ${JSON.stringify(result)}`);
  }
  if (!scheduler.deadlines.every((deadline) => deadline.lifetime.aborted)) {
    throw new Error('Expected the answered long poll to release its deadline');
  }
});

function createDeadline(): ControlledDeadline {
  return new ControlledDeadline(Infinity, new AbortController().signal);
}

function messageUpdate(updateId: number): BotApiUpdate {
  return { update_id: updateId, message: createPrivateMessage(updateId) };
}

function updateDeliveredEntry(updateId: number) {
  return {
    kind: 'update_delivered',
    botId: BOT_ID,
    via: 'polling',
    update: messageUpdate(updateId),
  } as const;
}
