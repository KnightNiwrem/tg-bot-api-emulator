import { assertEquals } from '@std/assert';
import { WEBHOOK_ATTEMPT_TIMEOUT_MILLISECONDS } from '../src/services/webhook_attempt_scheduler.ts';
import type { WebhookAttemptFailure } from '../src/types/bot_webhook.ts';
import { ControlledScheduler } from './support/scheduler.ts';
import { buildSessionServices } from './support/session_services.ts';
import { createVirtualBot } from './support/virtual_users.ts';
import { createPrivateMessage } from './support/webhook_delivery.ts';

const HTTP_FAILURE: WebhookAttemptFailure = {
  reason: 'http_error',
  statusCode: 500,
  errorMessage: 'Wrong response from the webhook: 500 Internal Server Error',
};

Deno.test("Only an automatic bot's attempts are timed by the session's scheduler", async () => {
  const scheduler = new ControlledScheduler();
  using session = buildSessionServices({ scheduler });
  const { webhookAttempts } = session;
  const [automaticBotId, manualBotId] = ['automatic_bot', 'manual_bot'].map((username) =>
    createVirtualBot(session.virtualUsers, { first_name: 'Webhook Bot', username }).profile.id
  );
  webhookAttempts.setScheduling(manualBotId, 'manual');
  const delivery = new AbortController();

  try {
    const automaticAttempt = webhookAttempts.beginAttempt({
      botId: automaticBotId,
      update: { update_id: 1, message: createPrivateMessage(1) },
      deliverySignal: delivery.signal,
    });
    const manualAttempt = webhookAttempts.beginAttempt({
      botId: manualBotId,
      update: { update_id: 1, message: createPrivateMessage(1) },
      deliverySignal: delivery.signal,
    });
    // Choosing another scheduling now affects only later attempts.
    webhookAttempts.setScheduling(manualBotId, 'automatic');

    const [automaticDeadline] = scheduler.deadlines;
    if (
      scheduler.deadlines.length !== 1 ||
      automaticDeadline.delayMilliseconds !== WEBHOOK_ATTEMPT_TIMEOUT_MILLISECONDS
    ) {
      throw new Error('Expected a deadline for the automatic attempt alone');
    }
    automaticDeadline.arrive();
    if (!automaticAttempt.deadlineSignal.aborted || manualAttempt.deadlineSignal.aborted) {
      throw new Error("Expected the scheduler's deadline to reach only the automatic attempt");
    }

    let manualRetryReleased = false;
    const automaticRetry = automaticAttempt.failAndAwaitRetry(HTTP_FAILURE, 2);
    const manualRetry = manualAttempt.failAndAwaitRetry(HTTP_FAILURE, 2).finally(() => {
      manualRetryReleased = true;
    });
    assertEquals(
      [automaticDeadline.lifetime.aborted, scheduler.sleepDelaysMilliseconds],
      [true, [2_000]],
      "Expected the settled attempt's deadline released and one automatic retry sleep",
    );
    await Promise.resolve();
    if (manualRetryReleased) {
      throw new Error('Expected the manual retry to wait for the test');
    }

    const release = webhookAttempts.releaseRetry(manualBotId, manualAttempt.id);
    await manualRetry;
    if (!release.released) {
      throw new Error(`Expected the manual retry to be released, saw ${release.reason}`);
    }
    delivery.abort();
    await automaticRetry;
  } finally {
    delivery.abort();
  }
});
