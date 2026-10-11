import { z } from 'zod';

import { BOT_API_ERRORS } from './errors/error_catalogue.ts';
import { presentFixedBotApiError } from './errors/error_template.ts';
import { answerWith, type BotApiStepResult, proceedWith } from './method_steps.ts';
import { jsonParameter } from './request_parameters.ts';

/** Telegram's descriptions for a list of message identifiers it rejects. */
export const MESSAGE_IDENTIFIERS_NOT_SPECIFIED_DESCRIPTION = BOT_API_ERRORS
  .messageIdentifiersNotSpecified.description();
export const TOO_MANY_MESSAGE_IDENTIFIERS_DESCRIPTION = BOT_API_ERRORS.tooManyMessageIdentifiers
  .description();
export const INVALID_MESSAGE_IDENTIFIER_DESCRIPTION = BOT_API_ERRORS.messageIdentifierInvalid
  .description();

/** Telegram reads a missing or non-positive `message_id` as 0, which identifies no message. */
export const NO_MESSAGE_ID = 0;

/** Telegram names at most 100 messages by `message_ids` in one call. */
const MAX_MESSAGE_IDENTIFIER_COUNT = 100;

/** The message a `message_id` parameter identifies, as Telegram reads a missing or non-positive one. */
export function messageIdOrNone(messageId: number | undefined): number {
  return messageId === undefined || messageId <= 0 ? NO_MESSAGE_ID : messageId;
}

/**
 * A `message_ids` parameter: a JSON array of message identifiers, read as the official Bot API
 * server's `get_message_ids` reads it. Empty text names no messages, and text it cannot read as
 * JSON is refused with its description. Telegram also reads identifiers written as strings;
 * rejecting them instead surfaces the bot's mistake in tests.
 */
export function messageIdentifiersParameter() {
  return jsonParameter(z.array(z.int()).optional(), {
    unparsableJsonDescription: "Bad Request: can't parse message_ids JSON object",
    emptyText: { readAs: undefined },
  });
}

/** A call's parameters once a step has read the messages they name by `message_ids`. */
export type WithMessageIdentifiers<
  Parameters extends { readonly message_ids?: readonly number[] },
> = Omit<Parameters, 'message_ids'> & { readonly message_ids: readonly number[] };

/**
 * The step that reads the messages a call names by `message_ids`, as `get_message_ids` checks
 * them: they must be given, at most 100, and each identifier positive.
 */
export function requireMessageIdentifiers<
  Parameters extends { readonly message_ids?: readonly number[] },
>(parameters: Parameters): BotApiStepResult<WithMessageIdentifiers<Parameters>> {
  const { message_ids: messageIds } = parameters;
  if (messageIds === undefined) {
    return answerWith(presentFixedBotApiError(BOT_API_ERRORS.messageIdentifiersNotSpecified));
  }
  if (messageIds.length > MAX_MESSAGE_IDENTIFIER_COUNT) {
    return answerWith(presentFixedBotApiError(BOT_API_ERRORS.tooManyMessageIdentifiers));
  }
  if (messageIds.some((messageId) => messageId <= 0)) {
    return answerWith(presentFixedBotApiError(BOT_API_ERRORS.messageIdentifierInvalid));
  }
  return proceedWith({ ...parameters, message_ids: messageIds });
}
