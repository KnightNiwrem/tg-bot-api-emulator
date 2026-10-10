import { BotActivityLogRepository } from '../src/repositories/bot_activity_log.ts';
import { BotRepository } from '../src/repositories/bot.ts';
import { BotUpdateRepository } from '../src/repositories/bot_update.ts';
import { BotUpdateSubscriptionRepository } from '../src/repositories/bot_update_subscription.ts';
import { BotActivityService } from '../src/services/bot_activity.ts';
import {
  WEBHOOK_ATTEMPT_TIMEOUT_MILLISECONDS,
  WebhookAttemptScheduler,
} from '../src/services/webhook_attempt_scheduler.ts';
import { createRealTimeScheduler } from './support/scheduler.ts';
import {
  createPrivateMessage,
  createUpdateConsumers,
  ReceivedRequestCounter,
  webhookRequest,
} from './support/webhook_delivery.ts';

const BOT_ID = 10;

Deno.test('BotUpdateConsumerService lets a bot poll or use its webhook, never both', async () => {
  const { botUpdates, updateConsumers, updateSubscriptions, endSession } = createConsumerFixture();

  try {
    const heldBeforeWebhook = updateConsumers.getUpdates(BOT_ID, {
      limit: 100,
      timeoutSeconds: 50,
    });
    updateConsumers.setWebhook(BOT_ID, webhookRequest());
    const pollWithWebhook = await updateConsumers.getUpdates(BOT_ID, {
      limit: 100,
      timeoutSeconds: 0,
      allowedUpdates: ['callback_query'],
    });

    updateConsumers.deleteWebhook(BOT_ID, { dropPendingUpdates: false });
    const heldAfterDeletion = updateConsumers.getUpdates(BOT_ID, {
      limit: 100,
      timeoutSeconds: 50,
    });
    // Deleting the webhook again leaves the held poll waiting; an update then answers it.
    updateConsumers.deleteWebhook(BOT_ID, { dropPendingUpdates: false });
    botUpdates.enqueueMessageUpdate(BOT_ID, createPrivateMessage(1));

    assertJson(
      [
        await heldBeforeWebhook,
        pollWithWebhook,
        updateSubscriptions.getAllowedUpdateTypes(BOT_ID).has('message'),
        (await heldAfterDeletion).retrieved,
      ],
      [
        { retrieved: false, reason: 'terminated_by_webhook' },
        { retrieved: false, reason: 'webhook_active' },
        true,
        true,
      ],
      'Expected a webhook to end and refuse polls, and its deletion to leave a later poll held',
    );
  } finally {
    endSession();
  }
});

Deno.test('BotUpdateConsumerService stops every webhook generation when the session ends', async () => {
  const { botUpdates, updateConsumers, receivedRequests, endSession } = createConsumerFixture();

  updateConsumers.setWebhook(BOT_ID, webhookRequest());
  botUpdates.enqueueMessageUpdate(BOT_ID, createPrivateMessage(1));
  await receivedRequests.waitForCount(1);
  endSession();

  // Neither the stopped generation nor a webhook set afterwards delivers anything more.
  botUpdates.enqueueMessageUpdate(BOT_ID, createPrivateMessage(2));
  updateConsumers.setWebhook(BOT_ID, { ...webhookRequest(), url: 'https://bot.example/later' });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assertJson(
    [receivedRequests.count, updateConsumers.getWebhookInfo(BOT_ID).pending_update_count],
    [1, 1],
    'Expected only the update sent before the end to have been delivered',
  );
});

/** Creates the delivery owner of one bot, whose webhook accepts every update it receives. */
function createConsumerFixture() {
  const botUpdates = new BotUpdateRepository();
  const updateSubscriptions = new BotUpdateSubscriptionRepository();
  const receivedRequests = new ReceivedRequestCounter();
  const { updateConsumers, endSession } = createUpdateConsumers({
    botUpdates,
    updateSubscriptions,
    updateActivity: new BotActivityService({
      log: new BotActivityLogRepository(),
      scheduler: createRealTimeScheduler(),
    }),
    sendWebhookRequest: async (request) => {
      await request.arrayBuffer();
      receivedRequests.countRequest();
      return new Response(null);
    },
    startWebhookReply: () => {},
    attempts: new WebhookAttemptScheduler({
      bots: new BotRepository(),
      attemptTimeoutMilliseconds: WEBHOOK_ATTEMPT_TIMEOUT_MILLISECONDS,
      scheduler: createRealTimeScheduler(),
    }),
  });
  return { botUpdates, updateConsumers, updateSubscriptions, receivedRequests, endSession };
}

function assertJson(actual: unknown, expected: unknown, message: string): void {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  if (actualJson !== expectedJson) {
    throw new Error(`${message}\nExpected: ${expectedJson}\nReceived: ${actualJson}`);
  }
}
