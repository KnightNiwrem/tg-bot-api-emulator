import type { BotApiUpdate } from '../types/bot_api.ts';
import type {
  WebhookAttempt,
  WebhookAttemptFailure,
  WebhookRetryStatus,
  WebhookScheduling,
} from '../types/bot_webhook.ts';
import type { VirtualBot } from '../types/virtual_bot.ts';
import type { Scheduler } from '../timing/session_timing.ts';

/**
 * How long a webhook may take to answer an update under automatic scheduling. Telegram's webhook
 * connections give up after 60 seconds without data from the webhook.
 */
export const WEBHOOK_ATTEMPT_TIMEOUT_MILLISECONDS = 60_000;

/** The scheduling of a bot whose test has not chosen one. */
const DEFAULT_WEBHOOK_SCHEDULING: WebhookScheduling = 'automatic';

interface BotLookup {
  getById(botId: number): VirtualBot | undefined;
}

interface WebhookAttemptSchedulerDependencies {
  readonly bots: BotLookup;
  /**
   * How long an automatically scheduled attempt may take before its deadline arrives, which is
   * `WEBHOOK_ATTEMPT_TIMEOUT_MILLISECONDS` outside tests.
   */
  readonly attemptTimeoutMilliseconds: number;
  /**
   * Times automatically scheduled attempts: each attempt's deadline, and the delay before each
   * failed attempt's retry.
   */
  readonly scheduler: Scheduler;
}

export interface BeginWebhookAttemptInput {
  readonly botId: number;
  readonly update: BotApiUpdate;
  /** Aborts when delivery to the webhook stops, which cancels the attempt or its retry wait. */
  readonly deliverySignal: AbortSignal;
}

/** The delivery's side of an attempt: its deadline, and the recording of its outcome. */
export interface WebhookAttemptHandle {
  readonly id: number;
  /**
   * Aborts when the attempt's deadline arrives: once its timeout passes under automatic
   * scheduling, or when a test expires it.
   */
  readonly deadlineSignal: AbortSignal;
  /** Records that the webhook accepted the update; ignored once the attempt is no longer in flight. */
  accept(): void;
  /**
   * Records the failure and schedules the retry, then resolves once the retry is released, or once
   * delivery stops, which cancels it. Resolves at once when the attempt is no longer in flight.
   */
  failAndAwaitRetry(failure: WebhookAttemptFailure, retryDelaySeconds: number): Promise<void>;
}

export type WebhookSchedulingResult =
  | { readonly found: true; readonly scheduling: WebhookScheduling }
  | { readonly found: false; readonly reason: 'bot_not_found' };

export type ListWebhookAttemptsResult =
  | { readonly found: true; readonly attempts: readonly WebhookAttempt[] }
  | { readonly found: false; readonly reason: 'bot_not_found' };

export type ReleaseWebhookRetryResult =
  | { readonly released: true; readonly attempt: WebhookAttempt }
  | {
    readonly released: false;
    readonly reason: 'bot_not_found' | 'attempt_not_found' | 'retry_not_waiting';
  };

export type ExpireWebhookAttemptResult =
  | {
    readonly expired: true;
    /** The attempt once its outcome is decided. */
    readonly attempt: WebhookAttempt;
  }
  | {
    readonly expired: false;
    readonly reason: 'bot_not_found' | 'attempt_not_found' | 'attempt_not_in_flight';
  };

/** The controls of an attempt whose request is in flight or whose retry is waiting. */
interface OpenWebhookAttempt {
  /** Aborted when the attempt's deadline arrives. */
  readonly deadline: AbortController;
  /** Aborted when a test releases the attempt's retry. */
  readonly retryRelease: AbortController;
  /** Resolves once the attempt is no longer in flight. */
  readonly settled: PromiseWithResolvers<void>;
}

/**
 * Keeps a record of every attempt to deliver an update to a session's webhooks, and decides when
 * each attempt's deadline arrives and each failed attempt's retry is released.
 *
 * Under a bot's `automatic` scheduling, the default, the emulator decides by its own timing, as
 * Telegram does: an attempt's deadline arrives once its timeout passes, and a retry is released
 * once its delay passes, as the session's scheduler measures them. Under `manual` scheduling, nothing ends by itself: a test expires attempts
 * and releases retries, so that it reaches each delivery state without waiting. These are emulator
 * controls; they do not reproduce Telegram's timing. Either way, a test may expire an attempt in
 * flight or release a waiting retry early. An attempt and its retry follow the scheduling of their
 * bot when the attempt began.
 *
 * Each control applies to one attempt of one bot, once: an attempt that is no longer in flight
 * cannot be expired, and a retry that is no longer waiting cannot be released. When delivery stops,
 * because the webhook is replaced or deleted or the session ends, the attempt in flight is
 * cancelled, and so is a waiting retry, along with their timers.
 */
export class WebhookAttemptScheduler {
  readonly #bots: BotLookup;
  readonly #attemptTimeoutMilliseconds: number;
  readonly #scheduler: Scheduler;
  readonly #schedulingByBotId = new Map<number, WebhookScheduling>();
  /** Every attempt of the session, in the order they began, which is also the order of their IDs. */
  readonly #attemptsById = new Map<number, WebhookAttempt>();
  readonly #openAttemptsById = new Map<number, OpenWebhookAttempt>();
  #lastAttemptId = 0;

  constructor(
    { bots, attemptTimeoutMilliseconds, scheduler }: WebhookAttemptSchedulerDependencies,
  ) {
    this.#bots = bots;
    this.#attemptTimeoutMilliseconds = attemptTimeoutMilliseconds;
    this.#scheduler = scheduler;
  }

  getScheduling(botId: number): WebhookSchedulingResult {
    if (this.#bots.getById(botId) === undefined) {
      return { found: false, reason: 'bot_not_found' };
    }
    return { found: true, scheduling: this.#getSchedulingOf(botId) };
  }

  /** Sets the scheduling of the bot's attempts that begin from now on. */
  setScheduling(botId: number, scheduling: WebhookScheduling): WebhookSchedulingResult {
    if (this.#bots.getById(botId) === undefined) {
      return { found: false, reason: 'bot_not_found' };
    }
    this.#schedulingByBotId.set(botId, scheduling);
    return { found: true, scheduling };
  }

  /** Lists the bot's attempts, earliest first. */
  listAttempts(botId: number): ListWebhookAttemptsResult {
    if (this.#bots.getById(botId) === undefined) {
      return { found: false, reason: 'bot_not_found' };
    }
    return {
      found: true,
      attempts: [...this.#attemptsById.values()].filter((attempt) => attempt.botId === botId),
    };
  }

  /** Sends the update of the bot's failed attempt again without waiting for the retry's delay. */
  releaseRetry(botId: number, attemptId: number): ReleaseWebhookRetryResult {
    if (this.#bots.getById(botId) === undefined) {
      return { released: false, reason: 'bot_not_found' };
    }
    const attempt = this.#findAttempt(botId, attemptId);
    if (attempt === undefined) {
      return { released: false, reason: 'attempt_not_found' };
    }
    const openAttempt = this.#openAttemptsById.get(attemptId);
    if (
      attempt.status !== 'failed' || attempt.retry.status !== 'waiting' ||
      openAttempt === undefined
    ) {
      return { released: false, reason: 'retry_not_waiting' };
    }
    this.#setRetryStatus(attemptId, 'released');
    openAttempt.retryRelease.abort();
    return { released: true, attempt: this.#getAttempt(attemptId) };
  }

  /**
   * Makes the deadline of the bot's attempt in flight arrive, as its timeout passing does, and
   * resolves with the attempt once its outcome is decided. An attempt whose webhook has already
   * answered completely is still accepted.
   */
  async expireAttempt(botId: number, attemptId: number): Promise<ExpireWebhookAttemptResult> {
    if (this.#bots.getById(botId) === undefined) {
      return { expired: false, reason: 'bot_not_found' };
    }
    const attempt = this.#findAttempt(botId, attemptId);
    if (attempt === undefined) {
      return { expired: false, reason: 'attempt_not_found' };
    }
    const openAttempt = this.#openAttemptsById.get(attemptId);
    // An attempt whose deadline has already arrived is about to fail, so it is no longer expired.
    if (
      attempt.status !== 'in_flight' || openAttempt === undefined ||
      openAttempt.deadline.signal.aborted
    ) {
      return { expired: false, reason: 'attempt_not_in_flight' };
    }
    openAttempt.deadline.abort();
    await openAttempt.settled.promise;
    return { expired: true, attempt: this.#getAttempt(attemptId) };
  }

  /**
   * Records an attempt in flight under its bot's current scheduling, and starts its timeout when
   * that is automatic.
   */
  beginAttempt({ botId, update, deliverySignal }: BeginWebhookAttemptInput): WebhookAttemptHandle {
    const identity = {
      id: ++this.#lastAttemptId,
      botId,
      updateId: update.update_id,
      scheduling: this.#getSchedulingOf(botId),
    };
    const openAttempt: OpenWebhookAttempt = {
      deadline: new AbortController(),
      retryRelease: new AbortController(),
      settled: Promise.withResolvers(),
    };
    this.#attemptsById.set(identity.id, { ...identity, status: 'in_flight' });
    this.#openAttemptsById.set(identity.id, openAttempt);
    // An automatic attempt's timeout lasts until the attempt settles.
    const attemptSettlement = new AbortController();
    if (identity.scheduling === 'automatic') {
      const timeout = this.#scheduler.deadline(
        this.#attemptTimeoutMilliseconds,
        attemptSettlement.signal,
      );
      timeout.signal.addEventListener('abort', () => openAttempt.deadline.abort(), { once: true });
    }

    const isInFlight = () => this.#getAttempt(identity.id).status === 'in_flight';
    const settle = (attempt: WebhookAttempt) => {
      attemptSettlement.abort();
      this.#attemptsById.set(identity.id, attempt);
      openAttempt.settled.resolve();
    };
    const close = () => {
      deliverySignal.removeEventListener('abort', cancel);
      this.#openAttemptsById.delete(identity.id);
    };
    const cancel = () => {
      const attempt = this.#getAttempt(identity.id);
      if (attempt.status === 'in_flight') {
        settle({ ...identity, status: 'cancelled' });
        close();
      } else if (attempt.status === 'failed' && attempt.retry.status === 'waiting') {
        // The retry wait also ends with delivery, and closes the attempt once it has.
        this.#setRetryStatus(identity.id, 'cancelled');
      }
    };
    if (deliverySignal.aborted) {
      cancel();
    } else {
      deliverySignal.addEventListener('abort', cancel, { once: true });
    }

    return {
      id: identity.id,
      deadlineSignal: openAttempt.deadline.signal,
      accept: () => {
        if (isInFlight()) {
          settle({ ...identity, status: 'accepted' });
          close();
        }
      },
      failAndAwaitRetry: async (failure, retryDelaySeconds) => {
        if (!isInFlight()) {
          return;
        }
        settle({
          ...identity,
          status: 'failed',
          failure,
          retry: { delaySeconds: retryDelaySeconds, status: 'waiting' },
        });
        const retryEnd = AbortSignal.any([deliverySignal, openAttempt.retryRelease.signal]);
        try {
          await (identity.scheduling === 'automatic'
            ? this.#scheduler.sleep(retryDelaySeconds * 1_000, retryEnd)
            : waitForAbort(retryEnd));
        } finally {
          const attempt = this.#getAttempt(identity.id);
          if (attempt.status === 'failed' && attempt.retry.status === 'waiting') {
            this.#setRetryStatus(identity.id, deliverySignal.aborted ? 'cancelled' : 'released');
          }
          close();
        }
      },
    };
  }

  #getSchedulingOf(botId: number): WebhookScheduling {
    return this.#schedulingByBotId.get(botId) ?? DEFAULT_WEBHOOK_SCHEDULING;
  }

  /** Finds an attempt of the bot; another bot's attempt is not found. */
  #findAttempt(botId: number, attemptId: number): WebhookAttempt | undefined {
    const attempt = this.#attemptsById.get(attemptId);
    return attempt?.botId === botId ? attempt : undefined;
  }

  #getAttempt(attemptId: number): WebhookAttempt {
    const attempt = this.#attemptsById.get(attemptId);
    if (attempt === undefined) {
      throw new Error(`Webhook attempt ${attemptId} was begun but is not recorded`);
    }
    return attempt;
  }

  #setRetryStatus(attemptId: number, status: WebhookRetryStatus): void {
    const attempt = this.#getAttempt(attemptId);
    if (attempt.status !== 'failed') {
      throw new Error(`Webhook attempt ${attemptId} has no retry, as it has not failed`);
    }
    this.#attemptsById.set(attemptId, { ...attempt, retry: { ...attempt.retry, status } });
  }
}

/** Resolves once `signal` aborts. */
function waitForAbort(signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    signal.addEventListener('abort', () => resolve(), { once: true });
  });
}
