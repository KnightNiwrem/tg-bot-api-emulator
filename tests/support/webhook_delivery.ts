/**
 * Helpers for tests of webhook delivery that answer webhook requests in place of the network.
 */
import { BotUpdateRepository } from '../../src/repositories/bot_update.ts';
import { BotUpdateSubscriptionRepository } from '../../src/repositories/bot_update_subscription.ts';
import { BotWebhookRepository } from '../../src/repositories/bot_webhook.ts';
import {
  BotUpdateConsumerService,
  type SetWebhookRequest,
} from '../../src/services/bot_update_consumer.ts';
import { BotUpdatePollingService } from '../../src/services/bot_update_polling.ts';
import { SessionLifetime } from '../../src/services/session_lifetime.ts';
import type { WebhookAttemptScheduler } from '../../src/services/webhook_attempt_scheduler.ts';
import { WebhookDeliveryService } from '../../src/services/webhook_delivery.ts';
import type { BotApiPrivateMessage } from '../../src/types/bot_api.ts';
import { createRealTimeScheduler } from './scheduler.ts';

export const WEBHOOK_URL = 'https://bot.example/webhook';
/** The time the tests' clocks tell, and the date of their messages. */
export const NOW_UNIX_SECONDS = 1_700_000_000;
/** The account that sends messages by default. */
export const ADA_ID = 1;

/** A request that sets a webhook at `WEBHOOK_URL` with Telegram's defaults. */
export function webhookRequest(): SetWebhookRequest {
  return { url: WEBHOOK_URL, secretToken: '', maxConnections: 40, dropPendingUpdates: false };
}

/** A text message of the private chat of the account `authorId`, which is Ada's by default. */
export function createPrivateMessage(messageId: number, authorId = ADA_ID): BotApiPrivateMessage {
  const author = { id: authorId, is_bot: false as const, first_name: 'Ada' };
  return {
    message_id: messageId,
    from: author,
    chat: { id: author.id, type: 'private', first_name: author.first_name },
    date: NOW_UNIX_SECONDS,
    text: 'Hello',
  };
}

/** Leaves the webhook request unanswered until it is aborted, as a hanging webhook would. */
export function respondOnlyByAborting(request: Request): Promise<Response> {
  return new Promise((_resolve, reject) => {
    request.signal.addEventListener('abort', () => reject(request.signal.reason));
  });
}

/** Resolves once `signal` aborts. */
export function waitForAbort(signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    signal.addEventListener('abort', () => resolve(), { once: true });
  });
}

/** Resolves once `condition` holds, checking every few milliseconds and failing after a second. */
export async function waitUntil(condition: () => boolean): Promise<void> {
  const deadline = Date.now() + 1_000;
  while (!condition()) {
    if (Date.now() > deadline) {
      throw new Error('Expected the condition to hold within a second');
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

/**
 * Counts the requests a webhook receives, and resolves waits for a number of them, each failing
 * after a second.
 */
export class ReceivedRequestCounter {
  #count = 0;
  readonly #listeners = new Set<() => void>();

  get count(): number {
    return this.#count;
  }

  /** Counts a received request, resolving the waits it completes. */
  countRequest(): void {
    this.#count++;
    for (const notify of [...this.#listeners]) {
      notify();
    }
  }

  waitForCount(count: number): Promise<void> {
    const received = new Promise<void>((resolve) => {
      const check = () => {
        if (this.#count >= count) {
          this.#listeners.delete(check);
          resolve();
        }
      };
      this.#listeners.add(check);
      check();
    });
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timeoutId = setTimeout(
        () => reject(new Error(`Expected ${count} webhook requests, received ${this.#count}`)),
        1_000,
      );
    });
    return Promise.race([received, timeout]).finally(() => clearTimeout(timeoutId));
  }
}

/** What a test supplies to deliver a session's updates to webhooks in place of the network. */
export interface UpdateConsumersOptions {
  readonly botUpdates: BotUpdateRepository;
  /** Records what polling and webhook delivery observe, as the session's bot activity does. */
  readonly updateActivity:
    & ConstructorParameters<typeof BotUpdatePollingService>[0]['updateActivity']
    & ConstructorParameters<typeof WebhookDeliveryService>[0]['updateActivity'];
  readonly attempts: WebhookAttemptScheduler;
  readonly sendWebhookRequest: (request: Request) => Promise<Response>;
  readonly startWebhookReply: (botId: number, reply: Response) => void;
  /** A fresh subscription repository when omitted. */
  readonly updateSubscriptions?: BotUpdateSubscriptionRepository;
}

/**
 * Creates the delivery owner of a session's bots, with polling and webhook delivery, and the end
 * of its session, which stops every webhook generation as `session.end()` does.
 */
export function createUpdateConsumers(
  {
    botUpdates,
    updateActivity,
    attempts,
    sendWebhookRequest,
    startWebhookReply,
    updateSubscriptions = new BotUpdateSubscriptionRepository(),
  }: UpdateConsumersOptions,
): { readonly updateConsumers: BotUpdateConsumerService; readonly endSession: () => void } {
  const sessionEnd = new AbortController();
  const sessionLifetime = new SessionLifetime(sessionEnd.signal);
  const webhooks = new BotWebhookRepository();
  const updateConsumers = new BotUpdateConsumerService({
    webhooks,
    pendingUpdates: botUpdates,
    updateSubscriptions,
    polling: new BotUpdatePollingService({
      botUpdates,
      updateActivity,
      scheduler: createRealTimeScheduler(),
      sessionLifetime,
    }),
    webhookDelivery: new WebhookDeliveryService({
      pendingUpdates: botUpdates,
      deliveryErrors: webhooks,
      updateActivity,
      sendWebhookRequest,
      startWebhookReply,
      attempts,
      currentUnixTimeSeconds: () => NOW_UNIX_SECONDS,
    }),
    sessionLifetime,
  });
  return { updateConsumers, endSession: () => sessionEnd.abort() };
}
