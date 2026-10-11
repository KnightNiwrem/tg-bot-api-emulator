import { assertEquals } from '@std/assert';
import { BotActivityLogRepository } from '../src/repositories/bot_activity_log.ts';
import { BotUpdateRepository } from '../src/repositories/bot_update.ts';
import { BotUpdateSubscriptionRepository } from '../src/repositories/bot_update_subscription.ts';
import { BotActivityService } from '../src/services/bot_activity.ts';
import {
  BotUpdatePollingService,
  type GetUpdatesResult,
} from '../src/services/bot_update_polling.ts';
import { BotUpdateConsumerService } from '../src/services/bot_update_consumer.ts';
import { BotWebhookRepository } from '../src/repositories/bot_webhook.ts';
import { SessionLifetime } from '../src/services/session_lifetime.ts';
import {
  type BotApiMessage,
  type BotApiPrivateMessage,
  type BotApiUpdate,
  type BotApiUpdateType,
  DEFAULT_ALLOWED_UPDATE_TYPES,
} from '../src/types/bot_api.ts';
import { createRealTimeScheduler } from './support/scheduler.ts';
import { createUnprojectedTransactions } from './support/unprojected_transactions.ts';
import { expectSettlementWithin } from './support/settlement.ts';

const BOT_ID = 10;
const OTHER_BOT_ID = 20;

Deno.test('BotUpdateConsumerService resolves and keeps allowed updates per bot as Telegram does', async () => {
  const { updateSubscriptions, updateConsumers } = createPollingFixture();
  const cases: { allowedUpdates: string[]; expected: readonly BotApiUpdateType[] }[] = [
    { allowedUpdates: ['MESSAGE', 'not_an_update_type'], expected: ['message'] },
    { allowedUpdates: ['chat_member'], expected: ['chat_member'] },
    { allowedUpdates: ['not_an_update_type'], expected: [...DEFAULT_ALLOWED_UPDATE_TYPES] },
    { allowedUpdates: ['message'], expected: ['message'] },
    { allowedUpdates: [], expected: [...DEFAULT_ALLOWED_UPDATE_TYPES] },
  ];

  for (const { allowedUpdates, expected } of cases) {
    await updateConsumers.getUpdates(BOT_ID, { limit: 100, timeoutSeconds: 0, allowedUpdates });
    assertAllowedUpdateTypes(updateSubscriptions.getAllowedUpdateTypes(BOT_ID), expected);
  }
  // A request without allowed updates keeps the subscription, which is kept per bot.
  await updateConsumers.getUpdates(BOT_ID, {
    limit: 100,
    timeoutSeconds: 0,
    allowedUpdates: ['callback_query'],
  });
  await updateConsumers.getUpdates(BOT_ID, { limit: 100, timeoutSeconds: 0 });
  assertAllowedUpdateTypes(updateSubscriptions.getAllowedUpdateTypes(BOT_ID), ['callback_query']);
  assertAllowedUpdateTypes(
    updateSubscriptions.getAllowedUpdateTypes(OTHER_BOT_ID),
    [...DEFAULT_ALLOWED_UPDATE_TYPES],
  );
  const optInUpdateTypes: BotApiUpdateType[] = [
    'chat_member',
    'message_reaction',
    'message_reaction_count',
  ];
  for (const optInUpdateType of optInUpdateTypes) {
    if (DEFAULT_ALLOWED_UPDATE_TYPES.has(optInUpdateType)) {
      throw new Error(`Expected the default subscription to exclude ${optInUpdateType}`);
    }
  }
});

Deno.test('BotUpdatePollingService keeps updates that arrive during a negative offset long poll', async () => {
  const { botUpdates, botUpdatePolling } = createPollingFixture();
  const pendingResult = botUpdatePolling.getUpdates(BOT_ID, {
    offset: -1,
    limit: 100,
    timeoutSeconds: 1,
  });

  queueMicrotask(() => {
    for (const messageId of [1, 2, 3]) {
      botUpdates.enqueueMessageUpdate(BOT_ID, createPrivateMessage(messageId));
    }
  });

  const updates = expectRetrievedUpdates(await pendingResult);
  if (updates.map((update) => update.update_id).join() !== '1,2,3') {
    throw new Error('Expected the long poll to return every update that arrived while waiting');
  }
  const remainingUpdates = botUpdates.confirmAndReadPendingUpdates(BOT_ID, { limit: 100 });
  if (remainingUpdates.map((update) => update.update_id).join() !== '1,2,3') {
    throw new Error('Expected updates that arrived while waiting to remain pending');
  }
});

Deno.test('BotUpdatePollingService does not terminate a held long poll for an immediate answer', async () => {
  const { botUpdates, botUpdatePolling } = createPollingFixture();
  const heldResult = botUpdatePolling.getUpdates(BOT_ID, { limit: 100, timeoutSeconds: 50 });

  const immediateUpdates = expectRetrievedUpdates(
    await botUpdatePolling.getUpdates(BOT_ID, { limit: 100, timeoutSeconds: 0 }),
  );
  if (immediateUpdates.length !== 0) {
    throw new Error('Expected the immediate request to find no updates');
  }

  botUpdates.enqueueMessageUpdate(BOT_ID, createPrivateMessage(1));
  if (expectRetrievedUpdates(await heldResult).length !== 1) {
    throw new Error('Expected the held long poll to survive a request answered immediately');
  }
});

Deno.test('BotUpdatePollingService terminates only the held long poll of a bot setting a webhook', async () => {
  const { botUpdates, botUpdatePolling } = createPollingFixture();
  const heldResult = botUpdatePolling.getUpdates(BOT_ID, { limit: 100, timeoutSeconds: 50 });
  const otherBotResult = botUpdatePolling.getUpdates(OTHER_BOT_ID, {
    limit: 100,
    timeoutSeconds: 50,
  });

  botUpdatePolling.terminateLongPollForWebhook(BOT_ID);
  const terminatedResult = await heldResult;
  if (terminatedResult.retrieved || terminatedResult.reason !== 'terminated_by_webhook') {
    throw new Error('Expected the held long poll to be terminated by the webhook');
  }

  botUpdates.enqueueMessageUpdate(OTHER_BOT_ID, createPrivateMessage(1));
  if (expectRetrievedUpdates(await otherBotResult).length !== 1) {
    throw new Error("Expected another bot's held long poll to keep waiting");
  }
});

Deno.test('BotUpdatePollingService holds long polls for different bots independently', async () => {
  const { botUpdates, botUpdatePolling } = createPollingFixture();
  const firstResult = botUpdatePolling.getUpdates(BOT_ID, { limit: 100, timeoutSeconds: 50 });
  const secondResult = botUpdatePolling.getUpdates(OTHER_BOT_ID, {
    limit: 100,
    timeoutSeconds: 50,
  });

  botUpdates.enqueueMessageUpdate(BOT_ID, createPrivateMessage(1));
  botUpdates.enqueueMessageUpdate(OTHER_BOT_ID, createPrivateMessage(2));

  if (messageFromUpdate(expectRetrievedUpdates(await firstResult)[0])?.message_id !== 1) {
    throw new Error("Expected the first bot's long poll to receive its update");
  }
  if (messageFromUpdate(expectRetrievedUpdates(await secondResult)[0])?.message_id !== 2) {
    throw new Error("Expected the second bot's long poll to receive its update");
  }
});

Deno.test('BotUpdatePollingService ends a cancelled long poll without terminating it', async () => {
  const { botUpdates, botUpdatePolling } = createPollingFixture();
  const abortController = new AbortController();
  const cancelledResult = botUpdatePolling.getUpdates(BOT_ID, {
    limit: 100,
    timeoutSeconds: 50,
    signal: abortController.signal,
  });

  abortController.abort();
  if (expectRetrievedUpdates(await cancelledResult).length !== 0) {
    throw new Error('Expected a cancelled long poll to end without updates');
  }

  const laterResult = botUpdatePolling.getUpdates(BOT_ID, { limit: 100, timeoutSeconds: 50 });
  botUpdates.enqueueMessageUpdate(BOT_ID, createPrivateMessage(1));
  if (expectRetrievedUpdates(await laterResult).length !== 1) {
    throw new Error('Expected a long poll after cancellation to receive the next update');
  }
});

Deno.test('BotUpdatePollingService ends held long polls and changes nothing once the session ends', async () => {
  const {
    botUpdates,
    updateSubscriptions,
    botActivity,
    botUpdatePolling,
    updateConsumers,
    endSession,
  } = createPollingFixture();
  botUpdates.enqueueMessageUpdate(BOT_ID, createPrivateMessage(1));
  const heldResults = [BOT_ID, OTHER_BOT_ID].map((botId) =>
    botUpdatePolling.getUpdates(botId, {
      offset: botId === BOT_ID ? 2 : undefined,
      limit: 100,
      timeoutSeconds: 50,
    })
  );
  const headBeforeEnd = botActivity.getHeadPosition();

  endSession();
  // An update enqueued as the session ends would wake the held poll; it reads nothing.
  botUpdates.enqueueMessageUpdate(BOT_ID, createPrivateMessage(2));
  const results = await expectSettlementWithin(
    Promise.all(heldResults),
    1_000,
    'Expected the end of the session to end every held long poll at once',
  );
  const laterResult = await updateConsumers.getUpdates(BOT_ID, {
    limit: 100,
    timeoutSeconds: 50,
    allowedUpdates: ['callback_query'],
  });
  assertEquals(
    [
      results,
      laterResult,
      botActivity.getHeadPosition() - headBeforeEnd,
      botUpdates.readPendingUpdates(BOT_ID).map(({ update_id: updateId }) => updateId),
      // The later request asked for callback queries alone; the bot still receives messages.
      updateSubscriptions.getAllowedUpdateTypes(BOT_ID).has('message'),
    ],
    [
      [
        { retrieved: false, reason: 'session_ended' },
        { retrieved: false, reason: 'session_ended' },
      ],
      { retrieved: false, reason: 'session_ended' },
      0,
      [2],
      true,
    ],
    'Expected no long poll to read, confirm, record or subscribe after the session ended',
  );
});

Deno.test('BotUpdatePollingService answers a terminated long poll the session end finds unanswered as ended', async () => {
  const { botUpdatePolling, endSession } = createPollingFixture();
  const pollTerminatedByWebhook = botUpdatePolling.getUpdates(BOT_ID, {
    limit: 100,
    timeoutSeconds: 50,
  });
  const pollTerminatedByOtherPoll = botUpdatePolling.getUpdates(OTHER_BOT_ID, {
    limit: 100,
    timeoutSeconds: 50,
  });

  // Both polls are terminated, and the session ends before either is answered.
  botUpdatePolling.terminateLongPollForWebhook(BOT_ID);
  const terminatingPoll = botUpdatePolling.getUpdates(OTHER_BOT_ID, {
    limit: 100,
    timeoutSeconds: 50,
  });
  endSession();

  assertEquals(
    await Promise.all([pollTerminatedByWebhook, pollTerminatedByOtherPoll, terminatingPoll]),
    [
      { retrieved: false, reason: 'session_ended' },
      { retrieved: false, reason: 'session_ended' },
      { retrieved: false, reason: 'session_ended' },
    ],
    'Expected every poll still unanswered at the end to be answered as ended, not as a conflict',
  );
});

Deno.test('BotUpdatePollingService records the updates each answer confirms and delivers', async () => {
  const { botUpdates, botActivity, botUpdatePolling } = createPollingFixture();
  botUpdates.enqueueMessageUpdate(BOT_ID, createPrivateMessage(1));
  botUpdates.enqueueMessageUpdate(BOT_ID, createPrivateMessage(2));

  await botUpdatePolling.getUpdates(BOT_ID, { limit: 100, timeoutSeconds: 0 });
  await botUpdatePolling.getUpdates(BOT_ID, { offset: 2, limit: 1, timeoutSeconds: 0 });
  const heldResult = botUpdatePolling.getUpdates(BOT_ID, {
    offset: 3,
    limit: 100,
    timeoutSeconds: 50,
  });
  botUpdates.enqueueMessageUpdate(BOT_ID, createPrivateMessage(3));
  await heldResult;

  const recorded = await botActivity.readEntries({
    after: 0,
    filter: {},
    limit: 100,
    waitMilliseconds: 0,
  });
  if (!recorded.read) {
    throw new Error('Expected the bot activity to be readable');
  }
  const summary = recorded.entries.map((entry) => {
    switch (entry.kind) {
      case 'update_delivered':
        return ['delivered', entry.update.update_id, entry.via];
      case 'update_confirmed':
        return ['confirmed', entry.updateId, entry.via];
      default:
        return [entry.kind];
    }
  });
  if (
    JSON.stringify(summary) !== JSON.stringify([
      ['delivered', 1, 'polling'],
      ['delivered', 2, 'polling'],
      ['confirmed', 1, 'polling'],
      ['delivered', 2, 'polling'],
      ['confirmed', 2, 'polling'],
      ['delivered', 3, 'polling'],
    ])
  ) {
    throw new Error(
      `Expected confirmations before the deliveries of each answer, received ${
        JSON.stringify(summary)
      }`,
    );
  }
});

function createPollingFixture() {
  const botUpdates = new BotUpdateRepository();
  const updateSubscriptions = new BotUpdateSubscriptionRepository();
  const botActivity = new BotActivityService({
    log: new BotActivityLogRepository(),
    scheduler: createRealTimeScheduler(),
  });
  const sessionEnd = new AbortController();
  const sessionLifetime = new SessionLifetime(sessionEnd.signal);
  const transactions = createUnprojectedTransactions(sessionLifetime);
  const botUpdatePolling = new BotUpdatePollingService({
    botUpdates,
    updateActivity: botActivity,
    scheduler: createRealTimeScheduler(),
    sessionLifetime,
    transactions,
  });
  // The bots poll and set no webhook, so their subscriptions change only through getUpdates.
  const updateConsumers = new BotUpdateConsumerService({
    webhooks: new BotWebhookRepository(),
    pendingUpdates: botUpdates,
    updateSubscriptions,
    polling: botUpdatePolling,
    webhookDelivery: {
      startGeneration: () => {
        throw new Error('Unexpected webhook delivery');
      },
    },
    sessionLifetime,
    transactions,
  });
  return {
    botUpdates,
    updateSubscriptions,
    botActivity,
    botUpdatePolling,
    updateConsumers,
    endSession: () => sessionEnd.abort(),
  };
}

function createPrivateMessage(messageId: number): BotApiPrivateMessage {
  const author = { id: 1, is_bot: false as const, first_name: 'Ada' };
  return {
    message_id: messageId,
    from: author,
    chat: { id: author.id, type: 'private', first_name: author.first_name },
    date: 1_700_000_000,
    text: 'Hello',
  };
}

function expectRetrievedUpdates(result: GetUpdatesResult): readonly BotApiUpdate[] {
  if (!result.retrieved) {
    throw new Error(`Expected getUpdates to retrieve updates, received ${result.reason}`);
  }
  return result.updates;
}

function assertAllowedUpdateTypes(
  actual: ReadonlySet<BotApiUpdateType>,
  expected: readonly BotApiUpdateType[],
): void {
  if (actual.size !== expected.length || !expected.every((updateType) => actual.has(updateType))) {
    throw new Error(
      `Expected allowed update types ${JSON.stringify(expected)}, received ${
        JSON.stringify([...actual])
      }`,
    );
  }
}

function messageFromUpdate(update: BotApiUpdate | undefined): BotApiMessage | undefined {
  return update !== undefined && 'message' in update ? update.message : undefined;
}
