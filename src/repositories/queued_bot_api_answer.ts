import { type ChangeStaging, UNSTAGED_CHANGES } from '../transactions/change_staging.ts';
import { TransactionalMap } from '../transactions/transactional_collections.ts';

/**
 * Answers of one kind that a test queues for a bot's next Bot API calls, so that the calls receive
 * them instead of running.
 */
export interface QueuedBotApiAnswers {
  /**
   * The Bot API method whose calls receive the answers, by its current name; omitted for calls of
   * any method.
   */
  readonly methodName?: string;
  /** How many of the next matching calls still receive an answer; always positive. */
  readonly remainingCount: number;
}

/**
 * Stores the answers of one kind queued for each bot, in the order they were queued, and hands
 * them out to the bot's calls one at a time.
 */
export class QueuedBotApiAnswerRepository<TQueuedAnswers extends QueuedBotApiAnswers> {
  /** Each bot's queue, replaced whole on every change so that a staged change reverts exactly. */
  readonly #queuedAnswersByBotId: TransactionalMap<number, readonly TQueuedAnswers[]>;

  /** `staging` decides how the repository's writes take part in its session's transactions. */
  constructor(staging: ChangeStaging = UNSTAGED_CHANGES) {
    this.#queuedAnswersByBotId = new TransactionalMap(staging);
  }

  enqueue(botId: number, answers: TQueuedAnswers): void {
    const queue = this.#queuedAnswersByBotId.get(botId) ?? [];
    this.#queuedAnswersByBotId.set(botId, [...queue, { ...answers }]);
  }

  /** Returns the bot's queued answers, earliest first. */
  list(botId: number): readonly TQueuedAnswers[] {
    return (this.#queuedAnswersByBotId.get(botId) ?? []).map((answers) => ({ ...answers }));
  }

  /**
   * Takes one answer for a call of the method from the earliest queued answers that apply to it,
   * forgetting them once none remain. Returns those answers as they were before the call took one,
   * or `undefined` if none apply.
   */
  take(botId: number, methodName: string): TQueuedAnswers | undefined {
    const queue = this.#queuedAnswersByBotId.get(botId) ?? [];
    const index = queue.findIndex((answers) =>
      answers.methodName === undefined || answers.methodName === methodName
    );
    if (index === -1) {
      return undefined;
    }
    const takenFrom = queue[index];
    const remainingQueue = takenFrom.remainingCount === 1
      ? queue.toSpliced(index, 1)
      : queue.with(index, { ...takenFrom, remainingCount: takenFrom.remainingCount - 1 });
    if (remainingQueue.length === 0) {
      this.#queuedAnswersByBotId.delete(botId);
    } else {
      this.#queuedAnswersByBotId.set(botId, remainingQueue);
    }
    return { ...takenFrom };
  }
}
