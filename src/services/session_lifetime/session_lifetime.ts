/**
 * The lifetime of one emulation session, as the work that runs in it sees it: a signal that aborts
 * when the session ends, and a commit gate that closes at the same moment.
 *
 * Ending is final. Waits, downloads and other preparation follow `endSignal`, so they stop when the
 * session ends. Work can still outlive the end, because a sender or download that ignores its
 * signal settles late, so work that changes the session checks `admitsCommits` in the same
 * synchronous step as the change, after its last wait: once the session has ended, it changes
 * nothing.
 */
export class SessionLifetime {
  readonly #endSignal: AbortSignal;

  /** `endSignal` aborts when the session ends, and never otherwise. */
  constructor(endSignal: AbortSignal) {
    this.#endSignal = endSignal;
  }

  /** Aborts when the session ends. */
  get endSignal(): AbortSignal {
    return this.#endSignal;
  }

  /** Whether work may still change the session: true until the session ends, false from then on. */
  get admitsCommits(): boolean {
    return !this.#endSignal.aborted;
  }

  /** A signal that aborts when `callerSignal` does or the session ends, whichever comes first. */
  bind(callerSignal: AbortSignal): AbortSignal {
    return AbortSignal.any([callerSignal, this.#endSignal]);
  }
}
