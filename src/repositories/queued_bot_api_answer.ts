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
  readonly #queuedAnswersByBotId = new Map<number, TQueuedAnswers[]>();

  enqueue(botId: number, answers: TQueuedAnswers): void {
    const queue = this.#queuedAnswersByBotId.get(botId) ?? [];
    queue.push({ ...answers });
    this.#queuedAnswersByBotId.set(botId, queue);
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
    if (takenFrom.remainingCount === 1) {
      queue.splice(index, 1);
    } else {
      queue[index] = { ...takenFrom, remainingCount: takenFrom.remainingCount - 1 };
    }
    return { ...takenFrom };
  }
}
