/**
 * The work a session has in progress, which its settledness read reports: each Bot API call from
 * its admission until it is answered, however it arrived.
 *
 * @module
 */
import type { BotApiCallTransport } from '../types/bot_activity.ts';

/** A bot's call of a Bot API method that the session admitted and has not answered yet. */
export interface BotApiCallWork {
  readonly kind: 'bot_api_call';
  readonly botId: number;
  readonly via: BotApiCallTransport;
  /**
   * The method's current name, once known: an HTTP call names it in its path, while a webhook
   * reply names it only in its body, until which it is omitted.
   */
  readonly method?: string;
}

/** A call registered as in progress, which names its method once known and ends once answered. */
export interface BotApiCallWorkRegistration {
  /** Records the method the call names, as its webhook reply's body names it. */
  nameMethod(method: string): void;
  /** Ends the call's work; ending it again does nothing. */
  end(): void;
}

/**
 * Registers the work a session has in progress. Work is registered when it is admitted, before it
 * first waits, and ends however it ends, so a synchronous read never misses work that has started
 * and not finished.
 */
export class SessionWorkRegistry {
  /** Each registration, by its own identity, so equal work registered twice is counted twice. */
  readonly #inProgress = new Set<{ work: BotApiCallWork }>();

  /** Registers `work` as in progress. */
  begin(work: BotApiCallWork): BotApiCallWorkRegistration {
    const registration = { work };
    this.#inProgress.add(registration);
    return {
      nameMethod: (method) => {
        registration.work = { ...registration.work, method };
      },
      end: () => {
        this.#inProgress.delete(registration);
      },
    };
  }

  /** The work in progress, in the order it began. */
  listInProgress(): readonly BotApiCallWork[] {
    return [...this.#inProgress].map(({ work }) => work);
  }
}
