/**
 * Settledness: what the emulator itself still has to do in a session, and what each bot's mailbox
 * still holds, read in one synchronous step together with the head of the session's bot activity
 * log.
 *
 * The read describes the emulator only. A bot can confirm an update while its own work for it goes
 * on, so a settled, drained session does not mean that a bot has finished; asserting that a bot
 * did not do something still needs a completion fence.
 *
 * @module
 */
import type { BotApiUpdate } from '../types/bot_api.ts';
import type { BotActivityEntry, BotApiCallTransport } from '../types/bot_activity.ts';
import {
  type BotWebhook,
  getWebhookUpdateQueueKey,
  type WebhookAttempt,
} from '../types/bot_webhook.ts';
import type { VirtualBot } from '../types/virtual_bot.ts';
import type { BotApiCallWork } from './session_work.ts';

/**
 * Something the session is waiting on, which keeps it from being settled when the emulator will
 * act on it by itself (`runnable`), or which waits passively for a bot or the test.
 */
export type SettlednessBlocker =
  /** A bot's call that the emulator is preparing or executing. */
  | {
    readonly kind: 'bot_api_call';
    readonly runnable: true;
    readonly botId: number;
    readonly via: BotApiCallTransport;
    /** Omitted for a webhook reply whose body has not named its method yet. */
    readonly method?: string;
  }
  /**
   * A `getUpdates` call held until an update arrives, its timeout passes, or another ends it. Its
   * timeout answers the call with no updates and changes nothing in the session, which confirmed
   * and recorded everything when the call arrived, so it waits passively.
   */
  | { readonly kind: 'held_long_poll'; readonly runnable: false; readonly botId: number }
  /** An update waiting for its polling bot to read it. */
  | {
    readonly kind: 'undelivered_update';
    readonly runnable: false;
    readonly botId: number;
    readonly updateId: number;
  }
  /** An update a `getUpdates` answer delivered, waiting for an offset to confirm it. */
  | {
    readonly kind: 'unconfirmed_delivery';
    readonly runnable: false;
    readonly botId: number;
    readonly updateId: number;
  }
  /**
   * An update sent to the bot's webhook, waiting for the webhook's complete response. Under
   * automatic scheduling the attempt's deadline fails it by itself once `timeoutSeconds` pass after
   * it began, and schedules its retry, so it is runnable; under manual scheduling only the test
   * expires it, so it waits passively.
   */
  | WebhookAttemptIdentity
    & (
      | {
        readonly kind: 'webhook_attempt';
        readonly runnable: true;
        readonly scheduling: 'automatic';
        readonly timeoutSeconds: number;
      }
      | {
        readonly kind: 'webhook_attempt';
        readonly runnable: false;
        readonly scheduling: 'manual';
      }
    )
  /**
   * A failed update waiting to be sent again: under automatic scheduling once its retry's
   * `delaySeconds` pass, which the emulator does by itself, so it is runnable; under manual
   * scheduling once the test releases it, so it waits passively.
   */
  | WebhookAttemptIdentity
    & (
      | {
        readonly kind: 'webhook_retry';
        readonly runnable: true;
        readonly scheduling: 'automatic';
        readonly delaySeconds: number;
      }
      | { readonly kind: 'webhook_retry'; readonly runnable: false; readonly scheduling: 'manual' }
    )
  /**
   * An update of the bot's webhook whose queue, or whose webhook's connections, are taken by other
   * updates, so it waits for them.
   */
  | {
    readonly kind: 'queued_webhook_update';
    readonly runnable: false;
    readonly botId: number;
    readonly updateId: number;
  }
  /** An update the emulator is about to send to the bot's webhook. */
  | {
    readonly kind: 'webhook_delivery_due';
    readonly runnable: true;
    readonly botId: number;
    readonly updateId: number;
  };

/** The webhook attempt of a pending update that a blocker waits on. */
interface WebhookAttemptIdentity {
  readonly botId: number;
  readonly updateId: number;
  readonly webhookAttemptId: number;
}

/** Whether a bot's mailbox holds no pending update. */
export interface BotMailboxSettledness {
  readonly botId: number;
  readonly pendingUpdateCount: number;
  /** Whether no update is pending: none waits to be delivered or confirmed. */
  readonly drained: boolean;
}

export interface SessionSettledness {
  /** The head of the session's bot activity log when the read was made. */
  readonly activityPosition: number;
  /** Whether the emulator has no runnable work: every blocker waits passively. */
  readonly settled: boolean;
  /** Each bot's mailbox, in the order the bots were created. */
  readonly bots: readonly BotMailboxSettledness[];
  /** What the session waits on, runnable or passive. */
  readonly blockers: readonly SettlednessBlocker[];
}

interface BotListing {
  listBots(): readonly VirtualBot[];
}

interface WorkInProgress {
  listInProgress(): readonly BotApiCallWork[];
}

interface HeldLongPolls {
  listHeldLongPollBotIds(): readonly number[];
}

interface PendingUpdates {
  readPendingUpdates(botId: number): readonly BotApiUpdate[];
}

interface WebhookRegistrations {
  get(botId: number): { readonly webhook: BotWebhook } | undefined;
}

interface WebhookAttempts {
  listAttempts(
    botId: number,
  ):
    | { readonly found: true; readonly attempts: readonly WebhookAttempt[] }
    | { readonly found: false };
}

/** The session's bot activity log, which records the updates `getUpdates` answers deliver. */
interface ActivityLog {
  getHeadPosition(): number;
  findEntries(input: {
    readonly after: number;
    readonly limit: number;
    readonly matches: (entry: BotActivityEntry) => boolean;
  }): readonly BotActivityEntry[];
}

interface SessionSettlednessServiceDependencies {
  readonly bots: BotListing;
  readonly work: WorkInProgress;
  readonly heldLongPolls: HeldLongPolls;
  readonly pendingUpdates: PendingUpdates;
  readonly webhooks: WebhookRegistrations;
  readonly webhookAttempts: WebhookAttempts;
  readonly activityLog: ActivityLog;
  /** How long an automatic webhook attempt waits for its complete response before it fails. */
  readonly attemptTimeoutMilliseconds: number;
}

/** The `getUpdates` method's name, whose held calls wait passively. */
const GET_UPDATES_METHOD_NAME = 'getUpdates';

/**
 * Reads a session's settledness, in one synchronous step, so that no change can fall between the
 * parts of a read. A change and what it starts are published together, so the read never sees a
 * change without the work it started: an accepted webhook update's reply, for one, is in progress
 * as soon as the update is confirmed.
 */
export class SessionSettlednessService {
  readonly #bots: BotListing;
  readonly #work: WorkInProgress;
  readonly #heldLongPolls: HeldLongPolls;
  readonly #pendingUpdates: PendingUpdates;
  readonly #webhooks: WebhookRegistrations;
  readonly #webhookAttempts: WebhookAttempts;
  readonly #activityLog: ActivityLog;
  readonly #attemptTimeoutMilliseconds: number;

  constructor(
    {
      bots,
      work,
      heldLongPolls,
      pendingUpdates,
      webhooks,
      webhookAttempts,
      activityLog,
      attemptTimeoutMilliseconds,
    }: SessionSettlednessServiceDependencies,
  ) {
    this.#bots = bots;
    this.#work = work;
    this.#heldLongPolls = heldLongPolls;
    this.#pendingUpdates = pendingUpdates;
    this.#webhooks = webhooks;
    this.#webhookAttempts = webhookAttempts;
    this.#activityLog = activityLog;
    this.#attemptTimeoutMilliseconds = attemptTimeoutMilliseconds;
  }

  readSettledness(): SessionSettledness {
    const blockers: SettlednessBlocker[] = this.#findCallBlockers();
    const bots: BotMailboxSettledness[] = [];
    for (const { profile: { id: botId } } of this.#bots.listBots()) {
      const pendingUpdates = this.#pendingUpdates.readPendingUpdates(botId);
      bots.push({
        botId,
        pendingUpdateCount: pendingUpdates.length,
        drained: pendingUpdates.length === 0,
      });
      const registration = this.#webhooks.get(botId);
      blockers.push(
        ...(registration === undefined
          ? this.#findPollingUpdateBlockers(botId, pendingUpdates)
          : this.#findWebhookUpdateBlockers(botId, registration.webhook, pendingUpdates)),
      );
    }
    return {
      activityPosition: this.#activityLog.getHeadPosition(),
      settled: blockers.every((blocker) => !blocker.runnable),
      bots,
      blockers,
    };
  }

  /**
   * The calls in progress, each runnable but one `getUpdates` call of each bot whose long poll is
   * held, which waits passively: a held long poll is a call in progress, of its bot and method.
   */
  #findCallBlockers(): SettlednessBlocker[] {
    const heldLongPollBotIds = new Set(this.#heldLongPolls.listHeldLongPollBotIds());
    const blockers: SettlednessBlocker[] = [];
    for (const { botId, via, method } of this.#work.listInProgress()) {
      if (method === GET_UPDATES_METHOD_NAME && heldLongPollBotIds.delete(botId)) {
        blockers.push({ kind: 'held_long_poll', runnable: false, botId });
      } else {
        blockers.push({
          kind: 'bot_api_call',
          runnable: true,
          botId,
          via,
          ...(method === undefined ? {} : { method }),
        });
      }
    }
    // A long poll held by a call the session did not admit through its routes, as a test that
    // calls a method directly does, still waits passively.
    for (const botId of heldLongPollBotIds) {
      blockers.push({ kind: 'held_long_poll', runnable: false, botId });
    }
    return blockers;
  }

  /** A polling bot's pending updates wait for the bot to read or confirm them. */
  #findPollingUpdateBlockers(
    botId: number,
    pendingUpdates: readonly BotApiUpdate[],
  ): SettlednessBlocker[] {
    if (pendingUpdates.length === 0) {
      return [];
    }
    const pendingUpdateIds = new Set(pendingUpdates.map(({ update_id }) => update_id));
    const deliveredUpdateIds = new Set(
      this.#activityLog.findEntries({
        after: 0,
        limit: Infinity,
        matches: (entry) =>
          entry.kind === 'update_delivered' && entry.botId === botId && entry.via === 'polling' &&
          pendingUpdateIds.has(entry.update.update_id),
      }).flatMap((entry) => entry.kind === 'update_delivered' ? [entry.update.update_id] : []),
    );
    return pendingUpdates.map(({ update_id: updateId }) => ({
      kind: deliveredUpdateIds.has(updateId) ? 'unconfirmed_delivery' : 'undelivered_update',
      runnable: false,
      botId,
      updateId,
    }));
  }

  /**
   * A webhook bot's pending updates, each as its latest attempt stands: in flight, waiting for its
   * retry, or due to be sent, unless its queue or the webhook's connections are taken.
   */
  #findWebhookUpdateBlockers(
    botId: number,
    webhook: BotWebhook,
    pendingUpdates: readonly BotApiUpdate[],
  ): SettlednessBlocker[] {
    const listing = this.#webhookAttempts.listAttempts(botId);
    const latestAttemptsByUpdateId = new Map<number, WebhookAttempt>();
    for (const attempt of listing.found ? listing.attempts : []) {
      latestAttemptsByUpdateId.set(attempt.updateId, attempt);
    }
    const blockers: SettlednessBlocker[] = [];
    const busyQueueKeys = new Set<string>();
    let connectionsInUse = 0;
    const dueUpdates: BotApiUpdate[] = [];
    for (const update of pendingUpdates) {
      const updateId = update.update_id;
      const attempt = latestAttemptsByUpdateId.get(updateId);
      if (attempt?.status === 'in_flight') {
        busyQueueKeys.add(getWebhookUpdateQueueKey(update));
        connectionsInUse++;
        const identity = { botId, updateId, webhookAttemptId: attempt.id };
        blockers.push(
          attempt.scheduling === 'automatic'
            ? {
              ...identity,
              kind: 'webhook_attempt',
              runnable: true,
              scheduling: 'automatic',
              timeoutSeconds: this.#attemptTimeoutMilliseconds / 1_000,
            }
            : { ...identity, kind: 'webhook_attempt', runnable: false, scheduling: 'manual' },
        );
      } else if (attempt?.status === 'failed' && attempt.retry.status === 'waiting') {
        busyQueueKeys.add(getWebhookUpdateQueueKey(update));
        const identity = { botId, updateId, webhookAttemptId: attempt.id };
        blockers.push(
          attempt.scheduling === 'automatic'
            ? {
              ...identity,
              kind: 'webhook_retry',
              runnable: true,
              scheduling: 'automatic',
              delaySeconds: attempt.retry.delaySeconds,
            }
            : { ...identity, kind: 'webhook_retry', runnable: false, scheduling: 'manual' },
        );
      } else {
        dueUpdates.push(update);
      }
    }
    for (const update of dueUpdates) {
      const queueKey = getWebhookUpdateQueueKey(update);
      const isWaiting = busyQueueKeys.has(queueKey) || connectionsInUse >= webhook.maxConnections;
      // Only a queue's first update is sent, over a connection of its own; later ones wait.
      busyQueueKeys.add(queueKey);
      if (!isWaiting) {
        connectionsInUse++;
      }
      blockers.push(
        isWaiting
          ? { kind: 'queued_webhook_update', runnable: false, botId, updateId: update.update_id }
          : { kind: 'webhook_delivery_due', runnable: true, botId, updateId: update.update_id },
      );
    }
    return blockers;
  }
}
