import { type NotificationWaitEnd, waitForNotification } from '../timing/notification_wait.ts';
import type { Deadline } from '../timing/session_timing.ts';
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
  /** The head position the caller last read; an entry after it ends the wait at once. */
  readonly afterPosition: number;
  readonly deadline: Deadline;
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
    for (const notify of [...this.#appendWaiters]) {
      notify();
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

  /**
   * Resolves once the log holds an entry after `afterPosition`, at once if it already does, or
   * when the deadline arrives or `signal` aborts.
   */
  waitForAppend(
    { afterPosition, deadline, signal }: WaitForAppendInput,
  ): Promise<NotificationWaitEnd> {
    return waitForNotification({
      subscribe: (notify) => {
        this.#appendWaiters.add(notify);
        return () => {
          this.#appendWaiters.delete(notify);
        };
      },
      hasChanged: () => this.#entries.length > afterPosition,
      deadline,
      signal,
    });
  }
}
