import type { Deadline, Scheduler } from '../../src/timing/session_timing.ts';
import { SYSTEM_MONOTONIC_CLOCK, TimerScheduler } from '../../src/timing/system_timing.ts';

/** Schedules in real time, as every session does by default. */
export function createRealTimeScheduler(): Scheduler {
  return new TimerScheduler(SYSTEM_MONOTONIC_CLOCK);
}

/**
 * Schedules in real time, except that the delays before automatic webhook retries are waited for
 * by `waitBeforeRetry`, in seconds, when it is given, so that a test can observe or control them
 * without waiting.
 */
export function createRetryScheduler(
  waitBeforeRetry?: (delaySeconds: number, signal: AbortSignal) => Promise<void>,
): Scheduler {
  const realTimeScheduler = createRealTimeScheduler();
  if (waitBeforeRetry === undefined) {
    return realTimeScheduler;
  }
  return {
    sleep: (delayMilliseconds, signal) => waitBeforeRetry(delayMilliseconds / 1_000, signal),
    deadline: (delayMilliseconds, lifetime) =>
      realTimeScheduler.deadline(delayMilliseconds, lifetime),
  };
}

/** A deadline that arrives only when the test says so. */
export class ControlledDeadline implements Deadline {
  readonly #arrival = new AbortController();
  readonly signal = this.#arrival.signal;
  readonly delayMilliseconds: number;
  readonly lifetime: AbortSignal;

  constructor(delayMilliseconds: number, lifetime: AbortSignal) {
    this.delayMilliseconds = delayMilliseconds;
    this.lifetime = lifetime;
  }

  remainingMilliseconds(): number {
    return this.signal.aborted ? 0 : this.delayMilliseconds;
  }

  arrive(): void {
    this.#arrival.abort(new DOMException('The deadline arrived', 'TimeoutError'));
  }
}

/** A scheduler whose deadlines and sleeps only the test ends, recording each one requested. */
export class ControlledScheduler implements Scheduler {
  readonly deadlines: ControlledDeadline[] = [];
  readonly sleepDelaysMilliseconds: number[] = [];
  /** Called as each deadline starts, before it is returned. */
  onDeadlineStart: () => void = () => {};

  deadline(delayMilliseconds: number, lifetime: AbortSignal): Deadline {
    const deadline = new ControlledDeadline(delayMilliseconds, lifetime);
    this.deadlines.push(deadline);
    this.onDeadlineStart();
    return deadline;
  }

  sleep(delayMilliseconds: number, signal: AbortSignal): Promise<void> {
    this.sleepDelaysMilliseconds.push(delayMilliseconds);
    return new Promise((resolve) => {
      if (signal.aborted) {
        resolve();
        return;
      }
      signal.addEventListener('abort', () => resolve(), { once: true });
    });
  }
}
