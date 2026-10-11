import { z } from 'zod';

import { BOT_API_ERRORS } from './errors/error_catalogue.ts';
import type { FormattedTextError } from './formatted_text_reading.ts';
import type { UnreadFormattedText } from './inline_query_answer_parameters.ts';
import { type JsonObjectFieldError, parseBotApiJsonParameter } from './request_parameters.ts';

export type InputPollOptionsParameterReading =
  | { readonly read: true; readonly options: readonly UnreadFormattedText[] }
  | { readonly read: false; readonly description: string };

/**
 * Why the official Bot API server's `get_input_poll_options` cannot read an option: it is neither
 * a string nor an object, it has no `text`, or Telegram cannot read its text with its formatting.
 */
export type PollOptionError =
  | { readonly reason: 'option_not_object' }
  | Extract<JsonObjectFieldError, { readonly reason: 'field_missing' }>
  | { readonly reason: 'option_text_invalid'; readonly textError: FormattedTextError };

const inputPollOptionSchema = z.strictObject({
  text: z.string(),
  text_parse_mode: z.string().optional(),
  text_entities: z.array(z.unknown()).optional(),
});

/**
 * Reads the `options` parameter of `sendPoll`, a JSON array of `InputPollOption`, as the official
 * Bot API server's `get_input_poll_options` reads it: each option is a string, its text, or an
 * object with `text` and the `text_parse_mode` or `text_entities` that format it. As that server
 * reads `null`, it holds no options; how many a poll needs is left to the service. Media of options
 * are not supported and are rejected with the emulator's own description.
 * `invalidParametersDescription` answers fields of the wrong JSON type, which Telegram reads
 * leniently; rejecting them instead surfaces the bot's mistake in tests.
 */
export function readInputPollOptionsParameter(
  text: string | undefined,
  invalidParametersDescription: string,
): InputPollOptionsParameterReading {
  const failure = (description: string): InputPollOptionsParameterReading => ({
    read: false,
    description,
  });
  const parsedParameter = parseBotApiJsonParameter(text ?? '');
  if (parsedParameter === undefined) {
    return failure(BOT_API_ERRORS.pollOptionsJsonInvalid.description());
  }
  const { value } = parsedParameter;
  if (value === null) {
    return { read: true, options: [] };
  }
  if (!Array.isArray(value)) {
    return failure(BOT_API_ERRORS.pollOptionsNotArray.description());
  }
  const options: UnreadFormattedText[] = [];
  for (const optionValue of value) {
    if (typeof optionValue === 'string') {
      options.push({ text: optionValue });
      continue;
    }
    if (typeof optionValue !== 'object' || optionValue === null || Array.isArray(optionValue)) {
      return failure(
        BOT_API_ERRORS.pollOptionInvalid.description({ reason: 'option_not_object' }),
      );
    }
    if (!('text' in optionValue)) {
      return failure(
        BOT_API_ERRORS.pollOptionInvalid.description({
          reason: 'field_missing',
          fieldName: 'text',
        }),
      );
    }
    if ('media' in optionValue) {
      return failure(BOT_API_ERRORS.pollOptionMediaUnsupported.description());
    }
    const option = inputPollOptionSchema.safeParse(optionValue);
    if (!option.success) {
      return failure(invalidParametersDescription);
    }
    const { text: optionText, text_parse_mode: parseMode, text_entities: entities } = option.data;
    options.push({
      text: optionText,
      ...(parseMode === undefined ? {} : { parseMode }),
      ...(entities === undefined ? {} : { entities }),
    });
  }
  return { read: true, options };
}

/**
 * Describes text of an option that Telegram cannot read with its formatting, as the official Bot
 * API server does: as an option it cannot parse.
 */
export function describePollOptionTextError(textError: FormattedTextError): string {
  return BOT_API_ERRORS.pollOptionInvalid.description({ reason: 'option_text_invalid', textError });
}
