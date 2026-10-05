import type { QueuedRateLimitResponses } from '../types/bot_rate_limit.ts';
import type { VirtualBot } from '../types/virtual_bot.ts';

interface BotLookup {
  getById(botId: number): VirtualBot | undefined;
}

interface RateLimitResponseQueues {
  enqueue(botId: number, responses: QueuedRateLimitResponses): void;
  list(botId: number): readonly QueuedRateLimitResponses[];
  take(botId: number, methodName: string): QueuedRateLimitResponses | undefined;
}

interface BotRateLimitServiceDependencies {
  readonly bots: BotLookup;
  readonly rateLimitResponses: RateLimitResponseQueues;
}

export type QueueRateLimitResponsesResult =
  | { readonly queued: true; readonly responses: QueuedRateLimitResponses }
  | { readonly queued: false; readonly reason: 'bot_not_found' };

export type ListRateLimitResponsesResult =
  | { readonly found: true; readonly responses: readonly QueuedRateLimitResponses[] }
  | { readonly found: false; readonly reason: 'bot_not_found' };

/**
 * Answers a bot's Bot API calls with `429 Too Many Requests` when a test asks for it. Telegram
 * limits requests by traffic thresholds that it does not publish; the emulator reproduces none of
 * them, so tests choose exactly which calls are limited instead. Queued answers apply to the next
 * matching calls in the order they were queued, whatever the calls' parameters.
 */
export class BotRateLimitService {
  readonly #bots: BotLookup;
  readonly #rateLimitResponses: RateLimitResponseQueues;

  constructor({ bots, rateLimitResponses }: BotRateLimitServiceDependencies) {
    this.#bots = bots;
    this.#rateLimitResponses = rateLimitResponses;
  }

  /** Queues answers for the bot's next calls of a method, or of any method without one. */
  queueRateLimitResponses(
    botId: number,
    responses: QueuedRateLimitResponses,
  ): QueueRateLimitResponsesResult {
    if (this.#bots.getById(botId) === undefined) {
      return { queued: false, reason: 'bot_not_found' };
    }
    this.#rateLimitResponses.enqueue(botId, responses);
    return { queued: true, responses };
  }

  /** Lists the answers still queued for the bot, earliest first. */
  listRateLimitResponses(botId: number): ListRateLimitResponsesResult {
    if (this.#bots.getById(botId) === undefined) {
      return { found: false, reason: 'bot_not_found' };
    }
    return { found: true, responses: this.#rateLimitResponses.list(botId) };
  }

  /**
   * Takes the answer queued for the bot's call of a method, by the method's current name; returns
   * its `retry_after` in seconds, or `undefined` to run the call.
   */
  takeRateLimitResponse(botId: number, methodName: string): number | undefined {
    return this.#rateLimitResponses.take(botId, methodName)?.retryAfterSeconds;
  }
}
