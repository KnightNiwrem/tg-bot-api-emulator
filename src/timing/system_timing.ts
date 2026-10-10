import type {
  Deadline,
  MonotonicClock,
  Scheduler,
  SessionTiming,
  WallClock,
} from './session_timing.ts';

/** The host's calendar time. */
const SYSTEM_WALL_CLOCK: WallClock = {
  currentUnixTimeSeconds: () => Math.floor(Date.now() / 1_000),
};

/** The host's elapsed time since the process started. */
export const SYSTEM_MONOTONIC_CLOCK: MonotonicClock = {
  elapsedMilliseconds: () => performance.now(),
};

/**
 * Schedules with the host's timers over a monotonic clock. A host timer may run a little early, so
 * a deadline arrives only once the clock shows that its whole delay has elapsed.
 */
export class TimerScheduler implements Scheduler {
  readonly #clock: MonotonicClock;

  constructor(clock: MonotonicClock) {
    this.#clock = clock;
  }

  sleep(delayMilliseconds: number, signal: AbortSignal): Promise<void> {
    const deadline = this.deadline(delayMilliseconds, signal);
    return new Promise((resolve) => {
      const finish = () => {
        signal.removeEventListener('abort', finish);
        deadline.signal.removeEventListener('abort', finish);
        resolve();
      };
      if (signal.aborted || deadline.signal.aborted) {
        finish();
        return;
      }
      signal.addEventListener('abort', finish, { once: true });
      deadline.signal.addEventListener('abort', finish, { once: true });
    });
  }

  deadline(delayMilliseconds: number, lifetime: AbortSignal): Deadline {
    const arrival = new AbortController();
    const arrivalMilliseconds = this.#clock.elapsedMilliseconds() + delayMilliseconds;
    const arrive = () => arrival.abort(new DOMException('The deadline arrived', 'TimeoutError'));
    if (!lifetime.aborted) {
      this.#runOnArrival(arrivalMilliseconds, lifetime, arrive);
    }
    return {
      signal: arrival.signal,
      remainingMilliseconds: () =>
        arrival.signal.aborted ? 0 : Math.max(this.#millisecondsUntil(arrivalMilliseconds), 0),
    };
  }

  /**
   * Runs `onArrival` once the clock reaches `arrivalMilliseconds`, unless `lifetime` aborts first,
   * which releases the host timer.
   */
  #runOnArrival(arrivalMilliseconds: number, lifetime: AbortSignal, onArrival: () => void): void {
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const cancel = () => {
      clearTimeout(timeoutId);
      lifetime.removeEventListener('abort', cancel);
    };
    const runIfArrived = () => {
      const remainingMilliseconds = this.#millisecondsUntil(arrivalMilliseconds);
      if (remainingMilliseconds > 0) {
        timeoutId = setTimeout(runIfArrived, Math.ceil(remainingMilliseconds));
        return;
      }
      lifetime.removeEventListener('abort', cancel);
      onArrival();
    };
    timeoutId = setTimeout(runIfArrived, Math.ceil(this.#millisecondsUntil(arrivalMilliseconds)));
    lifetime.addEventListener('abort', cancel, { once: true });
    // Starting the host's first timer may run other code, which may have ended `lifetime`.
    if (lifetime.aborted) {
      cancel();
    }
  }

  #millisecondsUntil(arrivalMilliseconds: number): number {
    return arrivalMilliseconds - this.#clock.elapsedMilliseconds();
  }
}

/** Real time, the default for every session. */
export function createSystemSessionTiming(): SessionTiming {
  return {
    wallClock: SYSTEM_WALL_CLOCK,
    scheduler: new TimerScheduler(SYSTEM_MONOTONIC_CLOCK),
  };
}
