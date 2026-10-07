import type { ContentfulStatusCode } from 'hono/utils/http-status';

import type { BotApiCallTransport } from '../../../types/bot_activity.ts';
import type { EmulationSession } from '../../../types/emulation_session.ts';
import type { VirtualBotProfile } from '../../../types/virtual_bot.ts';
import type { BotApiRequestParameters, BotApiUploadedFiles } from './request_parameters.ts';

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

/** Runs a method with a call's parameters and uploaded files, and answers the call. */
export type BotApiMethodHandler = (
  context: BotApiMethodContext,
  parameters: BotApiRequestParameters,
  uploadedFiles: BotApiUploadedFiles,
) => BotApiMethodAnswer | Promise<BotApiMethodAnswer>;

/** A Bot API method the emulator implements, under its current name. */
export interface BotApiMethod {
  readonly name: string;
  readonly handler: BotApiMethodHandler;
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

/** The prefix of Telegram's descriptions of bad requests. */
export const BAD_REQUEST_PREFIX = 'Bad Request: ';

/** TDLib's description of text that is not well-formed Unicode, which it rejects first. */
export const STRINGS_NOT_UTF8_DESCRIPTION = 'Bad Request: strings must be encoded in UTF-8';

/**
 * Words a TDLib error message as the Bot API server's `fail_query_with_error` does for a bad
 * request: prefixed, with its first letter lowercased unless it begins an error code or acronym.
 */
export function badRequestDescription(tdlibErrorMessage: string): string {
  const secondCharacter = tdlibErrorMessage[1] ?? '';
  const keepsCase = secondCharacter === '_' || /[A-Z]/.test(secondCharacter);
  const message = keepsCase
    ? tdlibErrorMessage
    : tdlibErrorMessage.charAt(0).toLowerCase() + tdlibErrorMessage.slice(1);
  return `${BAD_REQUEST_PREFIX}${message}`;
}
