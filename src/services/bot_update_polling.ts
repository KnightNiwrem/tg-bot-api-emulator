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
  /** Whether the poll's wait is over, though the poll has not been answered yet. */
  isAwake: () => boolean;
}

/** Records the updates `getUpdates` answers deliver and confirm in the session's bot activity. */
interface UpdateActivityRecorder {
  recordUpdateDeliveries(botId: number, updates: readonly BotApiUpdate[], via: 'polling'): void;
  recordUpdateConfirmations(botId: number, updates: readonly BotApiUpdate[], via: 'polling'): void;
}

/** The session's end, which stops held long polls. */
interface SessionEnd {
  readonly endSignal: AbortSignal;
}

/** How a command of the session's transactions ended: executed, or refused once the session ended. */
type CommandExecution<Result> =
  | { readonly executed: true; readonly result: Result }
  | { readonly executed: false; readonly reason: 'session_ended' };

/** The session's transactions, which execute each change a request makes, unless it has ended. */
interface PollingTransactions {
  execute<Result>(command: () => Result): CommandExecution<Result>;
}

/** What a request's arrival decided: its answer, or the wait it is held for, and what it reads. */
type PollArrival =
  | { readonly held: false; readonly result: GetUpdatesResult }
  | {
    readonly held: true;
    readonly firstUnconfirmedUpdateId: number | undefined;
    readonly nextUpdateId: number;
  };

interface BotUpdatePollingServiceDependencies {
  readonly botUpdates: PendingUpdateQueue;
  readonly updateActivity: UpdateActivityRecorder;
  /** Measures how long a long poll is held. */
  readonly scheduler: Pick<Scheduler, 'deadline'>;
  readonly sessionLifetime: SessionEnd;
  /** Executes a request's arrival, and the end of its wait, each as one command. */
  readonly transactions: PollingTransactions;
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
  readonly #sessionLifetime: SessionEnd;
  readonly #transactions: PollingTransactions;
  readonly #heldLongPollsByBotId = new Map<number, HeldLongPoll>();

  constructor(
    { botUpdates, updateActivity, scheduler, sessionLifetime, transactions }:
      BotUpdatePollingServiceDependencies,
  ) {
    this.#botUpdates = botUpdates;
    this.#updateActivity = updateActivity;
    this.#scheduler = scheduler;
    this.#sessionLifetime = sessionLifetime;
    this.#transactions = transactions;
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
   * The request changes the session twice, each time as one command of the session's
   * transactions: once when it arrives, together with `changeOnArrival`, and once more if it was
   * held, when its wait ends. The wait itself runs outside any transaction. Once the session has
   * ended, neither command runs: the request reads, confirms and records nothing, and a held one
   * ends at once.
   */
  async getUpdates(
    botId: number,
    { offset, limit, timeoutSeconds, signal }: GetUpdatesRequest,
    changeOnArrival: () => void = () => {},
  ): Promise<GetUpdatesResult> {
    const arrival = this.#transactions.execute((): PollArrival => {
      changeOnArrival();
      // Telegram resolves a negative offset once, when the request arrives, so updates enqueued
      // while this request waits are not cut from the tail again.
      const firstUnconfirmedUpdateId = this.#botUpdates.resolveFirstUnconfirmedUpdateId(
        botId,
        offset,
      );
      const nextUpdateId = this.#botUpdates.getNextUpdateId(botId);
      const updates = this.#confirmAndReadPendingUpdates(botId, firstUnconfirmedUpdateId, limit);
      return updates.length > 0 || timeoutSeconds === 0 || signal?.aborted === true
        ? { held: false, result: this.#deliverUpdates(botId, updates) }
        : { held: true, firstUnconfirmedUpdateId, nextUpdateId };
    });
    if (!arrival.executed) {
      return { retrieved: false, reason: 'session_ended' };
    }
    if (!arrival.result.held) {
      return arrival.result.result;
    }
    const { firstUnconfirmedUpdateId, nextUpdateId } = arrival.result;

    const heldLongPoll = this.#holdLongPoll(botId);
    const waitEndingSignals = [heldLongPoll.controller.signal, this.#sessionLifetime.endSignal];
    if (signal !== undefined) {
      waitEndingSignals.push(signal);
    }
    const longPollEnd = new AbortController();
    const deadline = this.#scheduler.deadline(timeoutSeconds * 1_000, longPollEnd.signal);
    const waitEnd = AbortSignal.any(waitEndingSignals);
    // The wait is over as soon as an update it awaits is published, its deadline arrives, or a
    // signal ends it, before the continuation that answers the poll runs.
    heldLongPoll.isAwake = () =>
      this.#botUpdates.getNextUpdateId(botId) > nextUpdateId || deadline.signal.aborted ||
      waitEnd.aborted;
    try {
      await this.#botUpdates.waitForUpdate(botId, {
        awaitedUpdateId: nextUpdateId,
        deadline,
        signal: waitEnd,
      });
    } finally {
      longPollEnd.abort();
      if (this.#heldLongPollsByBotId.get(botId) === heldLongPoll) {
        this.#heldLongPollsByBotId.delete(botId);
      }
    }

    // A poll that a conflict terminated but that is answered only after the session ended is
    // answered as any other poll the end finds unanswered.
    const answer = this.#transactions.execute((): GetUpdatesResult => {
      const { terminationReason } = heldLongPoll;
      if (terminationReason !== undefined) {
        return { retrieved: false, reason: terminationReason };
      }
      return this.#deliverUpdates(
        botId,
        this.#confirmAndReadPendingUpdates(botId, firstUnconfirmedUpdateId, limit),
      );
    });
    return answer.executed ? answer.result : { retrieved: false, reason: 'session_ended' };
  }

  /** Terminates the bot's held long poll, as setting a webhook does on Telegram. */
  terminateLongPollForWebhook(botId: number): void {
    this.#terminateHeldLongPoll(botId, 'terminated_by_webhook');
  }

  /**
   * The bots' held long polls, each waiting passively for an update, or `awake` once its wait is
   * over and until the poll is answered.
   */
  listHeldLongPolls(): readonly { readonly botId: number; readonly isAwake: boolean }[] {
    return [...this.#heldLongPollsByBotId].map(([botId, heldLongPoll]) => ({
      botId,
      isAwake: heldLongPoll.isAwake(),
    }));
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
    const heldLongPoll: HeldLongPoll = { controller: new AbortController(), isAwake: () => false };
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
