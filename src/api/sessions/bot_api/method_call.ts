import type { ContentfulStatusCode } from 'hono/utils/http-status';

import type { BotApiCallTransport } from '../../../types/bot_activity.ts';
import type { EmulationSession } from '../../../types/emulation_session.ts';
import type { VirtualBotProfile } from '../../../types/virtual_bot.ts';

/**
 * Who calls a Bot API method, whichever way the call arrived: as an HTTP request, or in a
 * webhook's response to an update.
 */
export interface BotApiMethodContext {
  readonly session: EmulationSession;
  /** The bot whose token authenticated the call. */
  readonly bot: VirtualBotProfile;
  /** Aborts when the caller stops waiting for the answer, as a closed HTTP request does. */
  readonly signal: AbortSignal;
  readonly via: BotApiCallTransport;
}

/** Telegram's JSON answer to a Bot API method, with the HTTP status that carries it. */
export type BotApiMethodAnswer =
  | {
    readonly status: 200;
    readonly body: {
      readonly ok: true;
      readonly result: unknown;
      /** Telegram describes the outcome of a few methods, such as `setWebhook`. */
      readonly description?: string;
    };
  }
  | {
    readonly status: ContentfulStatusCode;
    readonly body: {
      readonly ok: false;
      readonly error_code: ContentfulStatusCode;
      readonly description: string;
      /** Telegram tells a rate-limited bot how many seconds to wait before retrying. */
      readonly parameters?: { readonly retry_after: number };
    };
  };

export function botApiResult(result: unknown, description?: string): BotApiMethodAnswer {
  return {
    status: 200,
    body: { ok: true, result, ...(description === undefined ? {} : { description }) },
  };
}

export function botApiError(
  errorCode: ContentfulStatusCode,
  description: string,
): BotApiMethodAnswer {
  return { status: errorCode, body: { ok: false, error_code: errorCode, description } };
}

/**
 * Telegram's answer to a rate-limited call, as the official Bot API server's
 * `Query::set_retry_after_error` writes it; the HTTP response also carries the wait in its
 * `Retry-After` header.
 */
export function botApiRetryAfterError(retryAfterSeconds: number): BotApiMethodAnswer {
  return {
    status: 429,
    body: {
      ok: false,
      error_code: 429,
      description: `Too Many Requests: retry after ${retryAfterSeconds}`,
      parameters: { retry_after: retryAfterSeconds },
    },
  };
}

/**
 * Telegram's answer to an album whose message Telegram's servers refused once the album was sent,
 * as the official Bot API server's `on_message_send_failed` writes it: the first such message's
 * position in the album, counted from 1, and the error Telegram's servers gave, which, unlike the
 * error of a single message, the server does not reword.
 */
export function albumMessageNotSentError(
  memberPosition: number,
  telegramError: string,
): BotApiMethodAnswer {
  return botApiError(
    400,
    `Bad Request: failed to send message #${memberPosition} with the error message "${telegramError}"`,
  );
}
