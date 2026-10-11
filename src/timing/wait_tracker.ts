/**
 * Tracks whether a piece of work is waiting, for a reader that must tell work that waits from work
 * whose wait is over but whose continuation has not run yet.
 *
 * @module
 */

/**
 * Starts the promise a wait awaits. `endWait` ends the wait at once, for code that settles the
 * promise itself and so knows the wait is over before the promise's reactions run.
 */
export type WaitStart<Value> = (endWait: () => void) => Promise<Value>;

/**
 * Whether a piece of work waits on a promise, which it does from `waitOn` until that promise
 * settles. The work is awake whenever it is not waiting: before its first wait, between waits, and
 * from the moment a wait is over until its continuation starts the next one or the work ends.
 *
 * A wait is over once its promise settles, whatever settled it, resolved or rejected: a handler
 * attached as the wait starts marks it, so no way of ending a wait is missed. Code that settles the
 * promise itself ends the wait as it does, so a reader in the same synchronous step already sees
 * the work awake.
 */
export class WaitTracker {
  /** The wait in progress; `undefined` while the work is not waiting. */
  #currentWait: object | undefined;

  /** Whether the work is awake: not waiting on a promise that has not settled. */
  get isAwake(): boolean {
    return this.#currentWait === undefined;
  }

  /** Waits on the promise `start` starts, and returns it, for the work to await. */
  waitOn<Value>(start: WaitStart<Value>): Promise<Value> {
    const wait = {};
    this.#currentWait = wait;
    const endThisWait = () => {
      if (this.#currentWait === wait) {
        this.#currentWait = undefined;
      }
    };
    const promise = start(endThisWait);
    promise.then(endThisWait, endThisWait);
    return promise;
  }
}
