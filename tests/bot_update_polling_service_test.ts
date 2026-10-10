import { BotActivityLogRepository } from '../src/repositories/bot_activity_log.ts';
import { BotUpdateRepository } from '../src/repositories/bot_update.ts';
import { BotUpdateSubscriptionRepository } from '../src/repositories/bot_update_subscription.ts';
import { BotActivityService } from '../src/services/bot_activity.ts';
import {
  BotUpdatePollingService,
  type GetUpdatesResult,
} from '../src/services/bot_update_polling.ts';
import {
  type BotApiMessage,
  type BotApiPrivateMessage,
  type BotApiUpdate,
  type BotApiUpdateType,
  DEFAULT_ALLOWED_UPDATE_TYPES,
} from '../src/types/bot_api.ts';
import { createRealTimeScheduler } from './support/scheduler.ts';

const BOT_ID = 10;
const OTHER_BOT_ID = 20;

Deno.test('BotUpdatePollingService resolves and keeps allowed updates per bot as Telegram does', async () => {
  const { updateSubscriptions, botUpdatePolling } = createPollingFixture();
  const cases: { allowedUpdates: string[]; expected: readonly BotApiUpdateType[] }[] = [
    { allowedUpdates: ['MESSAGE', 'not_an_update_type'], expected: ['message'] },
    { allowedUpdates: ['chat_member'], expected: ['chat_member'] },
    { allowedUpdates: ['not_an_update_type'], expected: [...DEFAULT_ALLOWED_UPDATE_TYPES] },
    { allowedUpdates: ['message'], expected: ['message'] },
    { allowedUpdates: [], expected: [...DEFAULT_ALLOWED_UPDATE_TYPES] },
  ];

  for (const { allowedUpdates, expected } of cases) {
    await botUpdatePolling.getUpdates(BOT_ID, { limit: 100, timeoutSeconds: 0, allowedUpdates });
    assertAllowedUpdateTypes(updateSubscriptions.getAllowedUpdateTypes(BOT_ID), expected);
  }
  // A request without allowed updates keeps the subscription, which is kept per bot.
  await botUpdatePolling.getUpdates(BOT_ID, {
    limit: 100,
    timeoutSeconds: 0,
    allowedUpdates: ['callback_query'],
  });
  await botUpdatePolling.getUpdates(BOT_ID, { limit: 100, timeoutSeconds: 0 });
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

Deno.test('BotUpdatePollingService answers held and later long polls at once when polling ends', async () => {
  const { botUpdates, botUpdatePolling } = createPollingFixture();
  const heldResults = [BOT_ID, OTHER_BOT_ID].map((botId) =>
    botUpdatePolling.getUpdates(botId, { limit: 100, timeoutSeconds: 50 })
  );

  botUpdatePolling.endLongPolling();
  const results = await expectSettlementWithin(
    Promise.all(heldResults),
    1_000,
    'Expected ending long polling to answer every held long poll at once',
  );
  if (!results.every((result) => expectRetrievedUpdates(result).length === 0)) {
    throw new Error('Expected each held long poll to end without a conflict or updates');
  }

  const emptyResult = await expectSettlementWithin(
    botUpdatePolling.getUpdates(BOT_ID, { limit: 100, timeoutSeconds: 50 }),
    1_000,
    'Expected a long poll after polling ended not to be held',
  );
  if (expectRetrievedUpdates(emptyResult).length !== 0) {
    throw new Error('Expected the unheld long poll to find no updates');
  }

  botUpdates.enqueueMessageUpdate(BOT_ID, createPrivateMessage(1));
  const pendingUpdates = expectRetrievedUpdates(
    await botUpdatePolling.getUpdates(BOT_ID, { limit: 100, timeoutSeconds: 50 }),
  );
  if (pendingUpdates.length !== 1) {
    throw new Error('Expected pending updates to remain readable after polling ended');
  }
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
  const botUpdatePolling = new BotUpdatePollingService({
    botUpdates,
    updateSubscriptions,
    updateActivity: botActivity,
    scheduler: createRealTimeScheduler(),
  });
  return { botUpdates, updateSubscriptions, botActivity, botUpdatePolling };
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

/** Returns what `pending` settles to, failing if it is still pending after `milliseconds`. */
async function expectSettlementWithin<T>(
  pending: Promise<T>,
  milliseconds: number,
  failureMessage: string,
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timeoutId = setTimeout(() => reject(new Error(failureMessage)), milliseconds);
  });
  try {
    return await Promise.race([pending, timeout]);
  } finally {
    clearTimeout(timeoutId);
  }
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
