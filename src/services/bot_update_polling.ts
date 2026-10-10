import {
  type BotApiUpdate,
  type BotApiUpdateType,
  resolveAllowedUpdateTypes,
} from '../types/bot_api.ts';
import type { Deadline, Scheduler } from '../timing/session_timing.ts';

export interface GetUpdatesRequest {
  readonly offset?: number;
  readonly limit: number;
  readonly timeoutSeconds: number;
  /** Requested update type names; omitting them keeps the bot's current subscription. */
  readonly allowedUpdates?: readonly string[];
  readonly signal?: AbortSignal;
}

/** Why a held long poll ended without reading updates. */
type LongPollTerminationReason = 'terminated_by_other_long_poll' | 'terminated_by_webhook';

export type GetUpdatesResult =
  | { readonly retrieved: true; readonly updates: readonly BotApiUpdate[] }
  | { readonly retrieved: false; readonly reason: LongPollTerminationReason };

interface PendingUpdateQueue {
  resolveFirstUnconfirmedUpdateId(botId: number, offset: number | undefined): number | undefined;
  confirmUpdatesBefore(
    botId: number,
    firstUnconfirmedUpdateId: number | undefined,
  ): readonly BotApiUpdate[];
  readPendingUpdates(botId: number): readonly BotApiUpdate[];
  getNextUpdateId(botId: number): number;
  waitForUpdate(
    botId: number,
    input: {
      readonly awaitedUpdateId: number;
      readonly deadline: Deadline;
      readonly signal: AbortSignal;
    },
  ): Promise<unknown>;
}

interface BotUpdateSubscriptionStore {
  setAllowedUpdateTypes(botId: number, allowedUpdateTypes: ReadonlySet<BotApiUpdateType>): void;
}

interface HeldLongPoll {
  /** Aborted to terminate the long poll. */
  readonly controller: AbortController;
  terminationReason?: LongPollTerminationReason;
}

/** Records the updates `getUpdates` answers deliver and confirm in the session's bot activity. */
interface UpdateActivityRecorder {
  recordUpdateDeliveries(botId: number, updates: readonly BotApiUpdate[], via: 'polling'): void;
  recordUpdateConfirmations(botId: number, updates: readonly BotApiUpdate[], via: 'polling'): void;
}

interface BotUpdatePollingServiceDependencies {
  readonly botUpdates: PendingUpdateQueue;
  readonly updateSubscriptions: BotUpdateSubscriptionStore;
  readonly updateActivity: UpdateActivityRecorder;
  /** Measures how long a long poll is held. */
  readonly scheduler: Pick<Scheduler, 'deadline'>;
}

/**
 * Coordinates each bot's `getUpdates` requests against its subscription and pending update queue,
 * including request cancellation, competing held requests, and the end of long polling.
 */
export class BotUpdatePollingService {
  readonly #botUpdates: PendingUpdateQueue;
  readonly #updateSubscriptions: BotUpdateSubscriptionStore;
  readonly #updateActivity: UpdateActivityRecorder;
  readonly #scheduler: Pick<Scheduler, 'deadline'>;
  readonly #heldLongPollsByBotId = new Map<number, HeldLongPoll>();
  /**
   * Aborted when long polling ends. Kept apart from the held long poll controllers so that the end
   * of polling is never reported as a conflict with another long poll.
   */
  readonly #longPollingEnd = new AbortController();

  constructor(
    { botUpdates, updateSubscriptions, updateActivity, scheduler }:
      BotUpdatePollingServiceDependencies,
  ) {
    this.#botUpdates = botUpdates;
    this.#updateSubscriptions = updateSubscriptions;
    this.#updateActivity = updateActivity;
    this.#scheduler = scheduler;
  }

  /**
   * Changes the bot's subscription before reading its queue, as Telegram does. The new
   * subscription applies only to updates created afterward; pending updates are still returned.
   *
   * A request that finds no updates and has a timeout is held until an update arrives. Like
   * Telegram, a bot has at most one held request: holding a new one terminates the previous one.
   * Requests answered immediately never terminate a held one. Once long polling has ended, no
   * request is held.
   *
   * The updates the offset confirms and the updates the answer delivers are recorded as bot
   * activity, confirmations first.
   */
  async getUpdates(
    botId: number,
    { offset, limit, timeoutSeconds, allowedUpdates, signal }: GetUpdatesRequest,
  ): Promise<GetUpdatesResult> {
    if (allowedUpdates !== undefined) {
      this.#updateSubscriptions.setAllowedUpdateTypes(
        botId,
        resolveAllowedUpdateTypes(allowedUpdates),
      );
    }

    // Telegram resolves a negative offset once, when the request arrives, so updates enqueued while
    // this request waits are not cut from the tail again.
    const firstUnconfirmedUpdateId = this.#botUpdates.resolveFirstUnconfirmedUpdateId(
      botId,
      offset,
    );
    const nextUpdateId = this.#botUpdates.getNextUpdateId(botId);
    const updates = this.#confirmAndReadPendingUpdates(botId, firstUnconfirmedUpdateId, limit);
    if (
      updates.length > 0 || timeoutSeconds === 0 || signal?.aborted === true ||
      this.#longPollingEnd.signal.aborted
    ) {
      return this.#deliverUpdates(botId, updates);
    }

    const heldLongPoll = this.#holdLongPoll(botId);
    const waitEndingSignals = [heldLongPoll.controller.signal, this.#longPollingEnd.signal];
    if (signal !== undefined) {
      waitEndingSignals.push(signal);
    }
    const longPollEnd = new AbortController();
    try {
      await this.#botUpdates.waitForUpdate(botId, {
        awaitedUpdateId: nextUpdateId,
        deadline: this.#scheduler.deadline(timeoutSeconds * 1_000, longPollEnd.signal),
        signal: AbortSignal.any(waitEndingSignals),
      });
    } finally {
      longPollEnd.abort();
      if (this.#heldLongPollsByBotId.get(botId) === heldLongPoll) {
        this.#heldLongPollsByBotId.delete(botId);
      }
    }

    if (heldLongPoll.terminationReason !== undefined) {
      return { retrieved: false, reason: heldLongPoll.terminationReason };
    }
    return this.#deliverUpdates(
      botId,
      this.#confirmAndReadPendingUpdates(botId, firstUnconfirmedUpdateId, limit),
    );
  }

  /**
   * Answers every held long poll with the updates it can read, as its timeout would, and stops
   * holding later ones, which are answered at once with the updates they can read.
   */
  endLongPolling(): void {
    this.#longPollingEnd.abort();
  }

  /** Terminates the bot's held long poll, as setting a webhook does on Telegram. */
  terminateLongPollForWebhook(botId: number): void {
    this.#terminateHeldLongPoll(botId, 'terminated_by_webhook');
  }

  #confirmAndReadPendingUpdates(
    botId: number,
    firstUnconfirmedUpdateId: number | undefined,
    limit: number,
  ): readonly BotApiUpdate[] {
    this.#updateActivity.recordUpdateConfirmations(
      botId,
      this.#botUpdates.confirmUpdatesBefore(botId, firstUnconfirmedUpdateId),
      'polling',
    );
    return this.#botUpdates.readPendingUpdates(botId).slice(0, limit);
  }

  #deliverUpdates(botId: number, updates: readonly BotApiUpdate[]): GetUpdatesResult {
    this.#updateActivity.recordUpdateDeliveries(botId, updates, 'polling');
    return { retrieved: true, updates };
  }

  /** Terminates the bot's previously held long poll and makes the returned one current. */
  #holdLongPoll(botId: number): HeldLongPoll {
    this.#terminateHeldLongPoll(botId, 'terminated_by_other_long_poll');
    const heldLongPoll: HeldLongPoll = { controller: new AbortController() };
    this.#heldLongPollsByBotId.set(botId, heldLongPoll);
    return heldLongPoll;
  }

  #terminateHeldLongPoll(botId: number, reason: LongPollTerminationReason): void {
    const heldLongPoll = this.#heldLongPollsByBotId.get(botId);
    if (heldLongPoll !== undefined) {
      heldLongPoll.terminationReason = reason;
      heldLongPoll.controller.abort();
      this.#heldLongPollsByBotId.delete(botId);
    }
  }
}
