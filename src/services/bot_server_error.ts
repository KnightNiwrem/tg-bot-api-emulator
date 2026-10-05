import type {
  QueueableServerErrorCode,
  QueuedServerErrorResponses,
} from '../types/bot_server_error.ts';
import type { VirtualBot } from '../types/virtual_bot.ts';

interface BotLookup {
  getById(botId: number): VirtualBot | undefined;
}

interface ServerErrorResponseQueues {
  enqueue(botId: number, responses: QueuedServerErrorResponses): void;
  list(botId: number): readonly QueuedServerErrorResponses[];
  take(botId: number, methodName: string): QueuedServerErrorResponses | undefined;
}

interface BotServerErrorServiceDependencies {
  readonly bots: BotLookup;
  readonly serverErrorResponses: ServerErrorResponseQueues;
}

export type QueueServerErrorResponsesResult =
  | { readonly queued: true; readonly responses: QueuedServerErrorResponses }
  | { readonly queued: false; readonly reason: 'bot_not_found' };

export type ListServerErrorResponsesResult =
  | { readonly found: true; readonly responses: readonly QueuedServerErrorResponses[] }
  | { readonly found: false; readonly reason: 'bot_not_found' };

/**
 * Answers a bot's Bot API calls with a server error when a test asks for it, before the calls run,
 * so that a test can drive the bot's retries and fallbacks without a failing proxy. This is fault
 * injection: the emulator never fails calls by itself. Queued answers apply to the next matching
 * calls in the order they were queued, whatever the calls' parameters.
 */
export class BotServerErrorService {
  readonly #bots: BotLookup;
  readonly #serverErrorResponses: ServerErrorResponseQueues;

  constructor({ bots, serverErrorResponses }: BotServerErrorServiceDependencies) {
    this.#bots = bots;
    this.#serverErrorResponses = serverErrorResponses;
  }

  /** Queues answers for the bot's next calls of a method, or of any method without one. */
  queueServerErrorResponses(
    botId: number,
    responses: QueuedServerErrorResponses,
  ): QueueServerErrorResponsesResult {
    if (this.#bots.getById(botId) === undefined) {
      return { queued: false, reason: 'bot_not_found' };
    }
    this.#serverErrorResponses.enqueue(botId, responses);
    return { queued: true, responses };
  }

  /** Lists the answers still queued for the bot, earliest first. */
  listServerErrorResponses(botId: number): ListServerErrorResponsesResult {
    if (this.#bots.getById(botId) === undefined) {
      return { found: false, reason: 'bot_not_found' };
    }
    return { found: true, responses: this.#serverErrorResponses.list(botId) };
  }

  /**
   * Takes the answer queued for the bot's call of a method, by the method's current name; returns
   * its error code, or `undefined` to run the call.
   */
  takeServerErrorResponse(botId: number, methodName: string): QueueableServerErrorCode | undefined {
    return this.#serverErrorResponses.take(botId, methodName)?.errorCode;
  }
}
