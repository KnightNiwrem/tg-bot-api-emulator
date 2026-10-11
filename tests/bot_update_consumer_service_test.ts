import { assertEquals } from '@std/assert';
import {
  createWebhookSession,
  respondOnlyByAborting,
  WEBHOOK_URL,
} from './support/webhook_delivery.ts';

Deno.test('BotUpdateConsumerService lets a bot poll or use its webhook, never both', async () => {
  using webhookSession = createWebhookSession(() => new Response(null));
  const { session, bot, adaId, sendAccountMessage, setWebhook } = webhookSession;

  const heldBeforeWebhook = session.botApi.getUpdates(bot, { limit: 100, timeoutSeconds: 50 });
  setWebhook();
  const pollWithWebhook = await session.botApi.getUpdates(bot, {
    limit: 100,
    timeoutSeconds: 0,
    allowedUpdates: ['callback_query'],
  });

  session.botApi.deleteWebhook(bot, { dropPendingUpdates: false });
  const heldAfterDeletion = session.botApi.getUpdates(bot, { limit: 100, timeoutSeconds: 50 });
  // Deleting the webhook again leaves the held poll waiting. Ada's message then answers it, which
  // it reaches only because the refused poll left the bot subscribed to messages.
  session.botApi.deleteWebhook(bot, { dropPendingUpdates: false });
  sendAccountMessage(adaId);
  const afterDeletion = await heldAfterDeletion;

  assertEquals(
    [
      await heldBeforeWebhook,
      pollWithWebhook,
      afterDeletion.retrieved && afterDeletion.updates.map(({ update_id }) => update_id),
    ],
    [
      { retrieved: false, reason: 'terminated_by_webhook' },
      { retrieved: false, reason: 'webhook_active' },
      [1],
    ],
    'Expected a webhook to end and refuse polls, and its deletion to leave a later poll held',
  );
});

Deno.test('BotUpdateConsumerService stops every webhook generation when the session ends', async () => {
  // The webhook accepts the first update and leaves every later one unanswered.
  using webhookSession = createWebhookSession((request, requestIndex) =>
    requestIndex === 0 ? new Response(null) : respondOnlyByAborting(request)
  );
  const { session, adaId, receivedRequests, sendAccountMessage, setWebhook, getWebhookInfo } =
    webhookSession;

  setWebhook();
  sendAccountMessage(adaId);
  sendAccountMessage(adaId);
  await webhookSession.waitForRequestCount(2);
  session.end();

  // Neither the stopped generation nor a webhook set afterwards delivers anything more.
  setWebhook({ url: `${WEBHOOK_URL}/later` });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assertEquals(
    [
      receivedRequests.map(({ updateId }) => updateId),
      receivedRequests[1].signal.aborted,
      getWebhookInfo().pending_update_count,
    ],
    [[1, 2], true, 1],
    'Expected the update in flight at the end to be stopped, kept pending, and not sent again',
  );
});
