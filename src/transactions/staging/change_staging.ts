/**
 * How a repository's writes take part in its session's transactions.
 *
 * A command's transaction stages its writes in the session's repositories themselves. Each write
 * applies at once, so the command, and the projections of the events it emits, read the state the
 * command has produced so far; while a transaction is open, the write also records how to revert
 * it. Nothing outside the command reads that state before the transaction is published: a command
 * executes synchronously, and the notifications that wake the session's consumers wait for
 * publication. A transaction that aborts reverts its writes, newest first, which leaves the session
 * exactly as it was before the command, and drops its notifications.
 *
 * Outside a transaction a write is final once it applies, and its notification runs at once.
 */
export interface ChangeStaging {
  /** Whether a transaction is open, whose writes must record how to revert themselves. */
  readonly isStaging: boolean;
  /**
   * Records how to revert a write that was just applied, should its transaction abort. It must
   * restore exactly what the write replaced, and cannot fail. Outside a transaction it does
   * nothing.
   */
  recordRevert(revert: () => void): void;
  /**
   * Runs `notify` once the write that asks for it is published: when its transaction is published,
   * or at once outside a transaction. It never runs for a transaction that aborts.
   */
  notifyAfterPublication(notify: () => void): void;
}

/**
 * The staging of a repository that no session's transactions cover, such as one a unit test
 * creates on its own: every write is final, and every notification runs at once.
 */
export const UNSTAGED_CHANGES: ChangeStaging = {
  isStaging: false,
  recordRevert: () => {},
  notifyAfterPublication: (notify) => notify(),
};

interface OpenTransaction {
  /** How to revert each write of the transaction, oldest first. */
  readonly reverts: (() => void)[];
  /** The notifications its writes asked for, in the order they asked. */
  readonly notifications: (() => void)[];
}

interface SessionChangeJournalDependencies {
  /**
   * Receives the error of a notification that threw. Nothing can undo the change it followed, and
   * the remaining notifications still run.
   */
  readonly reportNotificationFailure: (error: unknown) => void;
}

/**
 * Stages the writes of one session's transactions, as `ChangeStaging` describes, one transaction
 * at a time: transactions do not nest.
 */
export class SessionChangeJournal implements ChangeStaging {
  readonly #reportNotificationFailure: (error: unknown) => void;
  #openTransaction: OpenTransaction | undefined;

  constructor({ reportNotificationFailure }: SessionChangeJournalDependencies) {
    this.#reportNotificationFailure = reportNotificationFailure;
  }

  get isStaging(): boolean {
    return this.#openTransaction !== undefined;
  }

  recordRevert(revert: () => void): void {
    this.#openTransaction?.reverts.push(revert);
  }

  notifyAfterPublication(notify: () => void): void {
    if (this.#openTransaction === undefined) {
      this.#runNotification(notify);
    } else {
      this.#openTransaction.notifications.push(notify);
    }
  }

  /** Opens a transaction, which stages every later write until it is published or aborted. */
  begin(): void {
    if (this.#openTransaction !== undefined) {
      throw new Error('A transaction is already open; transactions do not nest');
    }
    this.#openTransaction = { reverts: [], notifications: [] };
  }

  /**
   * Publishes the open transaction: its writes become final in one step, which cannot fail. Then
   * the notifications its writes asked for run, in order, outside any transaction. A notification
   * that throws is reported and stops neither the others nor the publication.
   */
  publish(): void {
    const { notifications } = this.#closeTransaction();
    for (const notify of notifications) {
      this.#runNotification(notify);
    }
  }

  /** Reverts every write of the open transaction, newest first, and drops its notifications. */
  abort(): void {
    const { reverts } = this.#closeTransaction();
    for (let index = reverts.length - 1; index >= 0; index--) {
      reverts[index]();
    }
  }

  #closeTransaction(): OpenTransaction {
    const transaction = this.#openTransaction;
    if (transaction === undefined) {
      throw new Error('No transaction is open');
    }
    this.#openTransaction = undefined;
    return transaction;
  }

  #runNotification(notify: () => void): void {
    try {
      notify();
    } catch (error) {
      this.#reportNotificationFailure(error);
    }
  }
}
