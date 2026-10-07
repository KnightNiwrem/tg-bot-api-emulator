/**
 * What tests of bot activity waits share: a clock that moves only when a test advances it, the
 * entries the tests answer reads with, and small assertions.
 */
import type { BotActivityWaitClock } from '../bot_activity_log.ts';
import type { BotApiCallEntry } from '../mod.ts';

interface ScheduledCallback {
  readonly dueAt: number;
  readonly callback: () => void;
}

/**
 * A wait clock whose time moves only when a test advances it, and whose callbacks run only when the
 * test delivers them, as a busy event loop keeps native timers from running when they are due.
 */
export class ManualWaitClock implements BotActivityWaitClock {
  #now = 0;
  readonly #pendingCallbacks = new Set<ScheduledCallback>();
  /** The delay of each callback scheduled, in order. */
  readonly scheduledDelays: number[] = [];

  now(): number {
    return this.#now;
  }

  schedule(callback: () => void, delayMilliseconds: number): () => void {
    this.scheduledDelays.push(delayMilliseconds);
    const scheduled = { dueAt: this.#now + delayMilliseconds, callback };
    this.#pendingCallbacks.add(scheduled);
    return () => void this.#pendingCallbacks.delete(scheduled);
  }

  get pendingCallbackCount(): number {
    return this.#pendingCallbacks.size;
  }

  /** Moves time forward without running the callbacks that come due. */
  advance(milliseconds: number): void {
    this.#now += milliseconds;
  }

  /**
   * Runs every pending callback, even one not yet due, as a native timer may run before the time
   * it was set for. Callbacks they schedule stay pending.
   */
  runCallbacksEarly(): void {
    const pendingCallbacks = [...this.#pendingCallbacks];
    this.#pendingCallbacks.clear();
    for (const { callback } of pendingCallbacks) {
      callback();
    }
  }

  /** Runs the callbacks that are due, earliest first. */
  runDueCallbacks(): void {
    for (;;) {
      const [earliestDue] = [...this.#pendingCallbacks]
        .filter(({ dueAt }) => dueAt <= this.#now)
        .sort((first, second) => first.dueAt - second.dueAt);
      if (earliestDue === undefined) {
        return;
      }
      this.#pendingCallbacks.delete(earliestDue);
      earliestDue.callback();
    }
  }
}

export function sendMessageCall(position: number, text: string): BotApiCallEntry {
  return {
    position,
    kind: 'bot_api_call',
    bot_id: 1001,
    method: 'sendMessage',
    requested_method: 'sendMessage',
    via: 'http',
    parameters: { text },
    uploaded_files: [],
    chat_id: 2002,
    answer: { ok: true, result: true },
  };
}

export async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('Expected a rejection');
}

export function assert(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}
