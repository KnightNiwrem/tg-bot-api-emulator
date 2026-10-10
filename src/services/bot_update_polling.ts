import type { BotApiUpdate } from '../types/bot_api.ts';
import type { Deadline, Scheduler } from '../timing/session_timing.ts';

export interface GetUpdatesRequest {
  readonly offset?: number;
  readonly limit: number;
  readonly timeoutSeconds: number;
  readonly signal?: AbortSignal;
}

/** Why a held long poll ended without reading updates. */
type LongPollTerminationReason = 'terminated_by_other_long_poll' | 'terminated_by_webhook';

export type GetUpdatesResult =
  | { readonly retrieved: true; readonly updates: readonly BotApiUpdate[] }
  | {
    readonly retrieved: false;
    /**
     * `session_ended` when the session ended before the request arrived, or while it was held:
     * the request read, confirmed and recorded nothing.
     */
    readonly reason: LongPollTerminationReason | 'session_ended';
  };

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

/** The session's end, which stops held long polls, and its commit gate. */
interface SessionCommitGate {
  readonly endSignal: AbortSignal;
  readonly admitsCommits: boolean;
}

interface BotUpdatePollingServiceDependencies {
  readonly botUpdates: PendingUpdateQueue;
  readonly updateActivity: UpdateActivityRecorder;
  /** Measures how long a long poll is held. */
  readonly scheduler: Pick<Scheduler, 'deadline'>;
  readonly sessionLifetime: SessionCommitGate;
}

/**
 * Answers each bot's `getUpdates` requests from its pending update queue, and confirms the updates
 * their offsets acknowledge, including request cancellation, competing held requests, and the end
 * of the session. Whether a bot may poll, and its subscription, are `BotUpdateConsumerService`'s.
 */
export class BotUpdatePollingService {
  readonly #botUpdates: PendingUpdateQueue;
  readonly #updateActivity: UpdateActivityRecorder;
  readonly #scheduler: Pick<Scheduler, 'deadline'>;
  /**
   * Kept apart from the held long poll controllers, so that the session's end is never reported as
   * a conflict with another long poll.
   */
  readonly #sessionLifetime: SessionCommitGate;
  readonly #heldLongPollsByBotId = new Map<number, HeldLongPoll>();

  constructor(
    { botUpdates, updateActivity, scheduler, sessionLifetime }: BotUpdatePollingServiceDependencies,
  ) {
    this.#botUpdates = botUpdates;
    this.#updateActivity = updateActivity;
    this.#scheduler = scheduler;
    this.#sessionLifetime = sessionLifetime;
  }

  /**
   * Reads the bot's pending updates, after confirming those before the request's offset. A request
   * that finds no updates and has a timeout is held until an update arrives. Like
   * Telegram, a bot has at most one held request: holding a new one terminates the previous one.
   * Requests answered immediately never terminate a held one.
   *
   * The updates the offset confirms and the updates the answer delivers are recorded as bot
   * activity, confirmations first.
   *
   * The request changes the session twice: once when it arrives, and once more if it was held,
   * when its wait ends. Once the session has ended, neither happens: the request reads, confirms
   * and records nothing, and a held one ends at once.
   */
  async getUpdates(
    botId: number,
    { offset, limit, timeoutSeconds, signal }: GetUpdatesRequest,
  ): Promise<GetUpdatesResult> {
    if (!this.#sessionLifetime.admitsCommits) {
      return { retrieved: false, reason: 'session_ended' };
    }

    // Telegram resolves a negative offset once, when the request arrives, so updates enqueued while
    // this request waits are not cut from the tail again.
    const firstUnconfirmedUpdateId = this.#botUpdates.resolveFirstUnconfirmedUpdateId(
      botId,
      offset,
    );
    const nextUpdateId = this.#botUpdates.getNextUpdateId(botId);
    const updates = this.#confirmAndReadPendingUpdates(botId, firstUnconfirmedUpdateId, limit);
    if (updates.length > 0 || timeoutSeconds === 0 || signal?.aborted === true) {
      return this.#deliverUpdates(botId, updates);
    }

    const heldLongPoll = this.#holdLongPoll(botId);
    const waitEndingSignals = [heldLongPoll.controller.signal, this.#sessionLifetime.endSignal];
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

    // A poll that a conflict terminated but that is answered only after the session ended is
    // answered as any other poll the end finds unanswered.
    if (!this.#sessionLifetime.admitsCommits) {
      return { retrieved: false, reason: 'session_ended' };
    }
    if (heldLongPoll.terminationReason !== undefined) {
      return { retrieved: false, reason: heldLongPoll.terminationReason };
    }
    return this.#deliverUpdates(
      botId,
      this.#confirmAndReadPendingUpdates(botId, firstUnconfirmedUpdateId, limit),
    );
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
