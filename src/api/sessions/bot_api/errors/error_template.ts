import type { ContentfulStatusCode } from 'hono/utils/http-status';

import { botApiError, type BotApiMethodAnswer } from '../method_call.ts';

/** The TDLib commit that the emulator's references to TDLib's source are pinned to. */
const TDLIB_SOURCE_ROOT =
  'https://github.com/tdlib/td/blob/bc9c263e2bfee06aaab41e82db51a103376030bc/';

/** The official Bot API server commit that the emulator's references to its source are pinned to. */
const BOT_API_SERVER_SOURCE_ROOT =
  'https://github.com/tdlib/telegram-bot-api/blob/e3e9dd8e5b3d7ab8537cd5a10dc31d5ffa8f82d1/';

/** Telegram's documentation of the MTProto methods, which lists the errors its servers return. */
const TELEGRAM_API_METHOD_DOCUMENTATION_ROOT = 'https://core.telegram.org/method/';

/**
 * What an error's status and description rest on, so that a reader can tell a description copied
 * from Telegram from one the emulator chose:
 * - `tdlib_source` and `bot_api_server_source`: the open-source code that writes it, by a link to
 *   the pinned commit;
 * - `documented_remote_behavior`: an error of Telegram's servers, which the open-source code passes
 *   through, as Telegram documents it;
 * - `observed_behavior`: what Telegram answers bots, which neither the source nor the documentation
 *   records;
 * - `emulator_inference`: the emulator's own wording, for a check Telegram makes without a known
 *   description or one the emulator adds.
 */
export type BotApiErrorProvenance =
  | { readonly basis: 'tdlib_source'; readonly reference: string }
  | { readonly basis: 'bot_api_server_source'; readonly reference: string }
  | { readonly basis: 'documented_remote_behavior'; readonly reference: string }
  | { readonly basis: 'observed_behavior'; readonly observation: string }
  | { readonly basis: 'emulator_inference'; readonly rationale: string };

/**
 * A Bot API error as a template over the details of one failure: its HTTP status, its description
 * and its provenance may each vary with the details, as an upload's limit does with the session's
 * Bot API server.
 */
export interface BotApiErrorTemplate<Details> {
  readonly status: (details: Details) => ContentfulStatusCode;
  readonly description: (details: Details) => string;
  readonly provenance: (details: Details) => BotApiErrorProvenance;
}

/** An error whose status, description and provenance never vary. */
export type FixedBotApiError = BotApiErrorTemplate<void>;

export function fixedBotApiError(
  status: ContentfulStatusCode,
  description: string,
  provenance: BotApiErrorProvenance,
): FixedBotApiError {
  return {
    status: () => status,
    description: () => description,
    provenance: () => provenance,
  };
}

/** Telegram's answer with an error of the catalogue, for a failure with these details. */
export function presentBotApiError<Details>(
  template: BotApiErrorTemplate<Details>,
  details: Details,
): BotApiMethodAnswer {
  return botApiError(template.status(details), template.description(details));
}

/** Telegram's answer with an error of the catalogue whose status and description never vary. */
export function presentFixedBotApiError(template: FixedBotApiError): BotApiMethodAnswer {
  return presentBotApiError(template, undefined);
}

/** A description TDLib writes, at a path and line anchor of its pinned source. */
export function tdlibSource(pathWithLineAnchor: string): BotApiErrorProvenance {
  return { basis: 'tdlib_source', reference: `${TDLIB_SOURCE_ROOT}${pathWithLineAnchor}` };
}

/** A description the official Bot API server writes, at a path and line anchor of its source. */
export function botApiServerSource(pathWithLineAnchor: string): BotApiErrorProvenance {
  return {
    basis: 'bot_api_server_source',
    reference: `${BOT_API_SERVER_SOURCE_ROOT}${pathWithLineAnchor}`,
  };
}

/** An error of Telegram's servers, as the documentation of an MTProto method lists it. */
export function telegramApiDocumentation(mtprotoMethodName: string): BotApiErrorProvenance {
  return {
    basis: 'documented_remote_behavior',
    reference: `${TELEGRAM_API_METHOD_DOCUMENTATION_ROOT}${mtprotoMethodName}`,
  };
}

export function observedBehavior(observation: string): BotApiErrorProvenance {
  return { basis: 'observed_behavior', observation };
}

export function emulatorInference(rationale: string): BotApiErrorProvenance {
  return { basis: 'emulator_inference', rationale };
}
