import {
  type BotActivityEntry,
  type BotActivityFilter,
  type BotApiCallEntry,
  type BotUpdateTransport,
  matchesBotActivityFilter,
  type UnpositionedBotActivityEntry,
} from '../types/bot_activity.ts';
import {
  type BotApiUpdate,
  getBotApiUpdateChatId,
  getBotApiUpdateUserId,
} from '../types/bot_api.ts';

interface BotActivityLog {
  append(entry: UnpositionedBotActivityEntry): BotActivityEntry;
  getHeadPosition(): number;
  findEntries(input: {
    readonly after: number;
    readonly before?: number;
    readonly limit: number;
    readonly matches: (entry: BotActivityEntry) => boolean;
  }): readonly BotActivityEntry[];
  waitForAppend(input: {
    readonly timeoutMilliseconds: number;
    readonly signal: AbortSignal;
  }): Promise<void>;
}

interface BotActivityServiceDependencies {
  readonly log: BotActivityLog;
}

/** A call as it is recorded, before the log assigns its position. */
export type RecordedBotApiCall = Omit<BotApiCallEntry, 'position' | 'kind'>;

export interface ReadBotActivityRequest {
  /** Only entries after this position are read; 0 reads from the first entry. */
  readonly after: number;
  /**
   * Only entries before this position are read, which makes the range complete: such a read never
   * waits. Omitted to read every later entry.
   */
  readonly before?: number;
  readonly filter: BotActivityFilter;
  /** The most entries to read; 0 reads only the head position. */
  readonly limit: number;
  /**
   * How long a read without `before` that finds no matching entry waits for one to be recorded;
   * 0 answers at once.
   */
  readonly waitMilliseconds: number;
  /** Aborts when the reader stops waiting for the answer, as a closed HTTP request does. */
  readonly signal?: AbortSignal;
}

export type ReadBotActivityResult =
  | {
    readonly read: true;
    /** The earliest matching entries in the range, oldest first. */
    readonly entries: readonly BotActivityEntry[];
    /** The position of the latest entry when the read was answered. */
    readonly headPosition: number;
  }
  | {
    readonly read: false;
    /** Positions come only from the log, so one beyond its head is a reader's mistake. */
    readonly reason: 'after_beyond_head' | 'before_beyond_head';
  };

/**
 * Records what passes between the emulator and a session's bots, and lets tests read the record,
 * waiting for entries that have not been recorded yet.
 */
export class BotActivityService {
  readonly #log: BotActivityLog;
  /** Aborted when the session ends, which answers waiting reads and stops later ones waiting. */
  readonly #readingEnd = new AbortController();

  constructor({ log }: BotActivityServiceDependencies) {
    this.#log = log;
  }

  recordBotApiCall(call: RecordedBotApiCall): void {
    this.#log.append({ kind: 'bot_api_call', ...call });
  }

  recordUpdateDeliveries(
    botId: number,
    updates: readonly BotApiUpdate[],
    via: BotUpdateTransport,
  ): void {
    for (const update of updates) {
      this.#log.append({
        kind: 'update_delivered',
        botId,
        via,
        update,
        ...describeUpdateOrigin(update),
      });
    }
  }

  recordUpdateConfirmations(
    botId: number,
    updates: readonly BotApiUpdate[],
    via: BotUpdateTransport,
  ): void {
    for (const update of updates) {
      this.#log.append({
        kind: 'update_confirmed',
        botId,
        via,
        updateId: update.update_id,
        ...describeUpdateOrigin(update),
      });
    }
  }

  getHeadPosition(): number {
    return this.#log.getHeadPosition();
  }

  /**
   * Reads the earliest matching entries in the range. A read without `before` that finds none
   * waits for a matching entry to be recorded, until its wait elapses, `signal` aborts, or the
   * session ends, and then answers with what it found.
   */
  async readEntries(
    { after, before, filter, limit, waitMilliseconds, signal }: ReadBotActivityRequest,
  ): Promise<ReadBotActivityResult> {
    const initialHeadPosition = this.#log.getHeadPosition();
    if (after > initialHeadPosition) {
      return { read: false, reason: 'after_beyond_head' };
    }
    if (before !== undefined && before > initialHeadPosition + 1) {
      return { read: false, reason: 'before_beyond_head' };
    }

    const matches = (entry: BotActivityEntry) => matchesBotActivityFilter(entry, filter);
    // A range that ends before a position is already complete, and a read of no entries has
    // nothing to wait for.
    const mayWait = before === undefined && limit > 0;
    const waitEndingSignal = signal === undefined
      ? this.#readingEnd.signal
      : AbortSignal.any([signal, this.#readingEnd.signal]);
    const waitDeadline = performance.now() + waitMilliseconds;
    let unreadAfter = after;
    while (true) {
      const headPosition = this.#log.getHeadPosition();
      const entries = this.#log.findEntries({ after: unreadAfter, before, limit, matches });
      const remainingWaitMilliseconds = waitDeadline - performance.now();
      if (
        entries.length > 0 || !mayWait || remainingWaitMilliseconds <= 0 ||
        waitEndingSignal.aborted
      ) {
        return { read: true, entries, headPosition };
      }
      unreadAfter = headPosition;
      await this.#log.waitForAppend({
        timeoutMilliseconds: remainingWaitMilliseconds,
        signal: waitEndingSignal,
      });
    }
  }

  /** Answers every waiting read with what it found, and stops later reads from waiting. */
  endReading(): void {
    this.#readingEnd.abort();
  }
}

function describeUpdateOrigin(
  update: BotApiUpdate,
): { readonly chatId?: number; readonly userId?: number } {
  const chatId = getBotApiUpdateChatId(update);
  const userId = getBotApiUpdateUserId(update);
  return {
    ...(chatId === undefined ? {} : { chatId }),
    ...(userId === undefined ? {} : { userId }),
  };
}
