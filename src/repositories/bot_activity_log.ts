import type { BotActivityEntry, UnpositionedBotActivityEntry } from '../types/bot_activity.ts';

interface FindEntriesInput {
  /** Only entries after this position are found. */
  readonly after: number;
  /** Only entries before this position are found; omitted for every later entry. */
  readonly before?: number;
  readonly limit: number;
  readonly matches: (entry: BotActivityEntry) => boolean;
}

interface WaitForAppendInput {
  readonly timeoutMilliseconds: number;
  readonly signal: AbortSignal;
}

/**
 * Owns a session's bot activity log: entries in the order they were recorded, never changed or
 * removed. Positions start at 1, so position 0 comes before every entry.
 */
export class BotActivityLogRepository {
  readonly #entries: BotActivityEntry[] = [];
  readonly #appendWaiters = new Set<() => void>();

  append(unpositionedEntry: UnpositionedBotActivityEntry): BotActivityEntry {
    const entry: BotActivityEntry = {
      position: this.#entries.length + 1,
      ...unpositionedEntry,
    };
    this.#entries.push(entry);
    for (const finish of [...this.#appendWaiters]) {
      finish();
    }
    return entry;
  }

  /** The position of the latest entry; 0 while the log is empty. */
  getHeadPosition(): number {
    return this.#entries.length;
  }

  /** Finds the earliest matching entries between the positions, oldest first. */
  findEntries({ after, before, limit, matches }: FindEntriesInput): readonly BotActivityEntry[] {
    const foundEntries: BotActivityEntry[] = [];
    const endIndex = Math.min(before === undefined ? Infinity : before - 1, this.#entries.length);
    for (let index = after; index < endIndex && foundEntries.length < limit; index++) {
      const entry = this.#entries[index];
      if (matches(entry)) {
        foundEntries.push(entry);
      }
    }
    return foundEntries;
  }

  /** Resolves when an entry is appended, the timeout elapses, or `signal` aborts. */
  waitForAppend({ timeoutMilliseconds, signal }: WaitForAppendInput): Promise<void> {
    return new Promise((resolve) => {
      if (signal.aborted) {
        resolve();
        return;
      }
      const finish = () => {
        clearTimeout(timeoutId);
        signal.removeEventListener('abort', finish);
        this.#appendWaiters.delete(finish);
        resolve();
      };
      // Deno loads `setTimeout` on its first use, which may run other code that appends an entry
      // or aborts `signal`, so the waiter is registered only after the timer has started.
      const headPositionBeforeTimer = this.#entries.length;
      const timeoutId = setTimeout(finish, timeoutMilliseconds);
      if (signal.aborted || this.#entries.length !== headPositionBeforeTimer) {
        finish();
        return;
      }
      this.#appendWaiters.add(finish);
      signal.addEventListener('abort', finish, { once: true });
    });
  }
}
