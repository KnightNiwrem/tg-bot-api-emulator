import type { QueueableServerErrorCode } from '../../../types/bot_server_error.ts';
import {
  botApiError,
  type BotApiMethodAnswer,
  type BotApiMethodContext,
  botApiRetryAfterError,
} from './method_call.ts';

/**
 * The description of each server error answer. The official Bot API server's
 * `Client::fail_query_with_error` describes a `500` without details as `Internal Server Error`;
 * the server never writes a `503` itself, so its answer follows the same envelope with the
 * status's reason phrase.
 */
const SERVER_ERROR_DESCRIPTIONS: Readonly<Record<QueueableServerErrorCode, string>> = {
  500: 'Internal Server Error',
  503: 'Service Unavailable',
};

/**
 * Takes the answer that a test queued for a bot's call of a method, by the method's current name,
 * which the call receives instead of running; `undefined` to run the call.
 *
 * A call takes at most one queued answer. Queued rate limit answers apply before queued server
 * error answers, whichever were queued first, so a call that both apply to is rate-limited and
 * leaves the server error answer for a later call.
 */
export function takeQueuedAnswer(
  { session, bot }: BotApiMethodContext,
  methodName: string,
): BotApiMethodAnswer | undefined {
  const retryAfterSeconds = session.botRateLimits.takeRateLimitResponse(bot.id, methodName);
  if (retryAfterSeconds !== undefined) {
    return botApiRetryAfterError(retryAfterSeconds);
  }
  const errorCode = session.botServerErrors.takeServerErrorResponse(bot.id, methodName);
  return errorCode === undefined
    ? undefined
    : botApiError(errorCode, SERVER_ERROR_DESCRIPTIONS[errorCode]);
}
