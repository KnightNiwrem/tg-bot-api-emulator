/**
 * Helpers for tests of webhook delivery that answer webhook requests in place of the network,
 * whether through a root-backed session whose webhook transport the test supplies, or through a
 * delivery a component test composes around its own fakes.
 */
import type { SetWebhookRequest } from '../../src/services/update_consumers/bot_update_consumer.ts';
import type { WebhookTransport } from '../../src/services/webhook_delivery/webhook_delivery.ts';
import type { Scheduler } from '../../src/timing/session/session_timing.ts';
import type { BotApiPrivateMessage } from '../../src/types/bot_api.ts';
import type { VirtualBotProfile } from '../../src/types/virtual_bot.ts';
import { buildSessionServices, type SessionServices } from './session_services.ts';
import { createVirtualAccount, createVirtualBot } from './virtual_users.ts';

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

/** What a webhook received in one request: the update it was sent, and how it was sent. */
export interface ReceivedWebhookRequest {
  readonly method: string;
  readonly url: string;
  readonly headers: Headers;
  readonly redirect: RequestRedirect;
  readonly signal: AbortSignal;
  readonly updateId: number;
}

/** Answers the webhook request numbered `requestIndex`, counting from 0, as a webhook would. */
export type WebhookResponder = (
  request: Request,
  requestIndex: number,
) => Response | Promise<Response>;

/** What a test supplies to a session whose webhook requests it answers. */
export interface WebhookSessionOptions {
  /** The session's ID; `webhook-session` when omitted. */
  readonly id?: string;
  /** The session's scheduler; real time when omitted. */
  readonly scheduler?: Scheduler;
}

/**
 * A root-backed session with one bot, `webhook_bot`, and three accounts, whose webhook requests a
 * test answers in place of the network. Disposing of it ends the session.
 */
export interface WebhookSession extends Disposable {
  readonly session: SessionServices;
  readonly bot: VirtualBotProfile;
  readonly adaId: number;
  readonly graceId: number;
  readonly linusId: number;
  /** Every webhook request the session has sent, in the order it sent them. */
  readonly receivedRequests: readonly ReceivedWebhookRequest[];
  /** Resolves once the session has sent `count` webhook requests, failing after a second. */
  waitForRequestCount(count: number): Promise<void>;
  /**
   * Sends a text message from the account to its private chat with the bot, failing the test if
   * it is not sent, which gives the bot one update.
   */
  sendAccountMessage(accountId: number, text?: string): void;
  /** Sets the bot's webhook as `webhookRequest()` does, with the changes `request` makes. */
  setWebhook(
    request?: Partial<SetWebhookRequest>,
  ): ReturnType<SessionServices['botApi']['setWebhook']>;
  getWebhookInfo(): ReturnType<SessionServices['botApi']['getWebhookInfo']>;
}

/**
 * Builds a session through the production composition root whose webhook requests `respond`
 * answers, recording each request before it is answered.
 */
export function createWebhookSession(
  respond: WebhookResponder,
  { id = 'webhook-session', scheduler }: WebhookSessionOptions = {},
): WebhookSession {
  const receivedRequests: ReceivedWebhookRequest[] = [];
  const requestCounter = new ReceivedRequestCounter();
  const webhookTransport: WebhookTransport = async (request) => {
    const { method, url, headers, redirect, signal } = request;
    const { update_id: updateId } = await request.json();
    receivedRequests.push({ method, url, headers, redirect, signal, updateId });
    requestCounter.countRequest();
    return await respond(request, receivedRequests.length - 1);
  };
  const session = buildSessionServices({ id, scheduler, webhookTransport });
  const bot = createVirtualBot(session.virtualUsers, {
    first_name: 'Webhook Bot',
    username: 'webhook_bot',
  }).profile;
  const [adaId, graceId, linusId] = ['Ada', 'Grace', 'Linus'].map((first_name) =>
    createVirtualAccount(session.virtualUsers, { first_name }).profile.id
  );

  return {
    session,
    bot,
    adaId,
    graceId,
    linusId,
    receivedRequests,
    waitForRequestCount: (count) => requestCounter.waitForCount(count),
    sendAccountMessage: (accountId, text = 'Hello') => {
      const sending = session.messageSending.sendAccountPrivateChatMessage({
        fromAccountId: accountId,
        chat: { type: 'private', peerId: bot.id },
        content: { kind: 'text', text },
      });
      if (!sending.sent) {
        throw new Error(`Expected account ${accountId}'s message to be sent: ${sending.reason}`);
      }
    },
    setWebhook: (request = {}) =>
      session.botApi.setWebhook(bot, { ...webhookRequest(), ...request }),
    getWebhookInfo: () => session.botApi.getWebhookInfo(bot),
    [Symbol.dispose]: () => session[Symbol.dispose](),
  };
}
