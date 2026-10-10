import { AccountRepository } from '../src/repositories/account.ts';
import { BotRepository } from '../src/repositories/bot.ts';
import { TelegramIdentityRepository } from '../src/repositories/telegram_identity.ts';
import { VirtualUserService } from '../src/services/virtual_user.ts';
import {
  WEBHOOK_ATTEMPT_TIMEOUT_MILLISECONDS,
  WebhookAttemptScheduler,
} from '../src/services/webhook_attempt_scheduler.ts';
import type { WebhookAttemptFailure } from '../src/types/bot_webhook.ts';
import { ControlledScheduler } from './support/scheduler.ts';
import { createPrivateMessage } from './support/webhook_delivery.ts';

const HTTP_FAILURE: WebhookAttemptFailure = {
  reason: 'http_error',
  statusCode: 500,
  errorMessage: 'Wrong response from the webhook: 500 Internal Server Error',
};

Deno.test("Only an automatic bot's attempts are timed by the session's scheduler", async () => {
  const { scheduler, webhookAttempts, automaticBotId, manualBotId } = createTimingFixture();
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
    if (
      !automaticDeadline.lifetime.aborted ||
      JSON.stringify(scheduler.sleepDelaysMilliseconds) !== JSON.stringify([2_000])
    ) {
      throw new Error(
        `Expected the settled attempt's deadline released and one automatic retry sleep, saw ${
          JSON.stringify(scheduler.sleepDelaysMilliseconds)
        }`,
      );
    }
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

function createTimingFixture() {
  const bots = new BotRepository();
  const virtualUsers = new VirtualUserService({
    identities: new TelegramIdentityRepository(),
    accounts: new AccountRepository(),
    bots,
  });
  const scheduler = new ControlledScheduler();
  const webhookAttempts = new WebhookAttemptScheduler({
    bots,
    attemptTimeoutMilliseconds: WEBHOOK_ATTEMPT_TIMEOUT_MILLISECONDS,
    scheduler,
  });
  return {
    scheduler,
    webhookAttempts,
    automaticBotId: createBot(virtualUsers, 'automatic_bot'),
    manualBotId: createBot(virtualUsers, 'manual_bot'),
  };
}

function createBot(virtualUsers: VirtualUserService, username: string): number {
  const result = virtualUsers.createBot({ first_name: 'Webhook Bot', username });
  if (!result.created) {
    throw new Error(`Expected bot creation to succeed, received ${result.reason}`);
  }
  return result.bot.profile.id;
}
