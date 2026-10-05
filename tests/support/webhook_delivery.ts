/**
 * Helpers for tests of webhook delivery that answer webhook requests in place of the network.
 */
import type { SetWebhookRequest } from '../../src/services/bot_webhook.ts';
import type { BotApiPrivateMessage } from '../../src/types/bot_api.ts';

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
