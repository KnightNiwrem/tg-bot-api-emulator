import type { ChatDomainEvent } from '../../types/chat_domain_event.ts';

/** The staging that a session's transactions open, publish and abort. */
interface TransactionJournal {
  readonly isStaging: boolean;
  /** As `ChangeStaging.notifyAfterPublication` describes it. */
  notifyAfterPublication(notify: () => void): void;
  begin(): void;
  publish(): void;
  abort(): void;
}

/** Whether the session still admits commits, which it stops doing for good when it ends. */
interface SessionCommitGate {
  readonly admitsCommits: boolean;
}

/** Turns an event into the Bot API updates of the bots that observe it, and queues them. */
interface ChatDomainEventProjector {
  project(event: ChatDomainEvent): void;
}

interface SessionTransactionsDependencies {
  readonly journal: TransactionJournal;
  readonly lifetime: SessionCommitGate;
  readonly projector: ChatDomainEventProjector;
}

/**
 * How a command's execution ended: executed in a transaction that was published, or refused
 * without running because the session had ended.
 */
export type CommandExecution<Result> =
  | { readonly executed: true; readonly result: Result }
  | { readonly executed: false; readonly reason: 'session_ended' };

/**
 * Runs a session's commands, each in a transaction that stages everything the command and the
 * projections of its events write, as `ChangeStaging` describes, and publishes it in one step once
 * the command returns. A command that throws, in its own checks or in a projection, aborts its
 * transaction, which leaves the session exactly as it was before the command, and the error
 * propagates.
 *
 * Events are emitted into the open transaction and projected at once, in the order they are
 * emitted, against the state the command has staged so far: an update shows the state at its
 * event, as Telegram freezes an update when it creates it. The consumers the updates wake, such as
 * long polls, webhook deliveries and bot activity reads, are notified only after publication.
 */
export class SessionTransactions {
  readonly #journal: TransactionJournal;
  readonly #lifetime: SessionCommitGate;
  readonly #projector: ChatDomainEventProjector;

  constructor({ journal, lifetime, projector }: SessionTransactionsDependencies) {
    this.#journal = journal;
    this.#lifetime = lifetime;
    this.#projector = projector;
  }

  /**
   * Executes a command at its commit boundary, after its preparation: in a transaction of its
   * own, unless the session has ended, in which case the command does not run and nothing
   * changes. The session is checked in the same synchronous step as the commit, so a command
   * whose preparation outlived the session never commits. The command must check every condition
   * that depends on the session's state itself, since preparation may have outlasted it.
   * Commands do not nest.
   */
  execute<Result>(command: () => Result): CommandExecution<Result> {
    if (!this.#lifetime.admitsCommits) {
      return { executed: false, reason: 'session_ended' };
    }
    return { executed: true, result: this.#runTransaction(command) };
  }

  /**
   * Runs a change in the transaction of the command that is executing, or, called outside one,
   * in a transaction of its own that it publishes once the change returns. A service runs each of
   * its commands this way, so that the command is one transaction whether it executes at a Bot
   * API call's commit boundary or for a caller that opens none. Unlike `execute`, it does not
   * check whether the session has ended.
   */
  withinTransaction<Result>(change: () => Result): Result {
    return this.#journal.isStaging ? change() : this.#runTransaction(change);
  }

  /**
   * Emits an event of the executing command, which is projected at once into its transaction.
   * Emitted outside a command, the event is projected in a transaction of its own.
   */
  emit(event: ChatDomainEvent): void {
    this.withinTransaction(() => this.#projector.project(event));
  }

  /**
   * Runs an effect beyond the session's state, such as starting or stopping a webhook delivery or
   * ending a held long poll, once the executing command's transaction is published, or at once
   * outside a command. Effects run among the notifications of the transaction's writes, in the
   * order all of them were asked for. An effect never runs for a transaction that aborts, so the
   * command's effects follow only the changes they belong to; one that throws is reported, and
   * undoes nothing.
   */
  runAfterPublication(effect: () => void): void {
    this.#journal.notifyAfterPublication(effect);
  }

  #runTransaction<Result>(change: () => Result): Result {
    this.#journal.begin();
    let result: Result;
    try {
      result = change();
    } catch (error) {
      this.#journal.abort();
      throw error;
    }
    this.#journal.publish();
    return result;
  }
}
