/**
 * Reads calendar time, which Telegram's Unix timestamps record. Calendar time may jump, so it never
 * measures how long something takes.
 */
export interface WallClock {
  currentUnixTimeSeconds(): number;
}

/**
 * Reads elapsed time, which deadlines and delays are measured in. It never goes backwards and is
 * unaffected by changes of calendar time; its origin is arbitrary, so only differences between its
 * readings mean anything.
 */
export interface MonotonicClock {
  elapsedMilliseconds(): number;
}

/** A point on a scheduler's monotonic clock after which an operation stops waiting. */
export interface Deadline {
  /** Aborts, with a `TimeoutError` `DOMException`, once the deadline arrives. */
  readonly signal: AbortSignal;
  /** The milliseconds left before the deadline arrives; 0 once it has arrived. */
  remainingMilliseconds(): number;
}

/**
 * Measures protocol and transport timing, such as long-poll timeouts and webhook retry delays, on
 * a monotonic clock. Domain state never expires by a scheduler: tests trigger such expiry
 * explicitly.
 */
export interface Scheduler {
  /**
   * Resolves once `delayMilliseconds` have elapsed, or as soon as `signal` aborts, whichever comes
   * first, and releases its timer either way.
   */
  sleep(delayMilliseconds: number, signal: AbortSignal): Promise<void>;
  /**
   * Starts a deadline that arrives once `delayMilliseconds` have elapsed, and never before this
   * returns. Aborting `lifetime` cancels the deadline, which then never arrives and releases its
   * timer, so a caller aborts it on every exit once it no longer needs the deadline.
   */
  deadline(delayMilliseconds: number, lifetime: AbortSignal): Deadline;
}

/**
 * The time sources of one session: calendar time for Telegram's timestamps, and a scheduler over a
 * monotonic clock for deadlines and delays. They are separate so that a change of calendar time
 * never moves a deadline.
 */
export interface SessionTiming {
  readonly wallClock: WallClock;
  readonly scheduler: Scheduler;
}
