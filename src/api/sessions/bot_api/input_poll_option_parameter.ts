import { z } from 'zod';

import type { UnreadFormattedText } from './inline_query_answer_parameters.ts';

export type InputPollOptionsParameterReading =
  | { readonly read: true; readonly options: readonly UnreadFormattedText[] }
  | { readonly read: false; readonly description: string };

const BAD_REQUEST_PREFIX = 'Bad Request: ';

/** How the official Bot API server prefixes its description of an option it cannot read. */
const INPUT_POLL_OPTION_ERROR_PREFIX = "Bad Request: can't parse InputPollOption: ";

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
  let value: unknown;
  try {
    value = JSON.parse(text ?? '');
  } catch {
    return failure("Bad Request: can't parse options JSON object");
  }
  if (value === null) {
    return { read: true, options: [] };
  }
  if (!Array.isArray(value)) {
    return failure('Bad Request: expected an Array of InputPollOption');
  }
  const options: UnreadFormattedText[] = [];
  for (const optionValue of value) {
    if (typeof optionValue === 'string') {
      options.push({ text: optionValue });
      continue;
    }
    if (typeof optionValue !== 'object' || optionValue === null || Array.isArray(optionValue)) {
      return failure(`${INPUT_POLL_OPTION_ERROR_PREFIX}Expected InputPollOption to be an Object`);
    }
    if (!('text' in optionValue)) {
      return failure(`${INPUT_POLL_OPTION_ERROR_PREFIX}Can't find field "text"`);
    }
    if ('media' in optionValue) {
      return failure('Bad Request: media of poll options is not supported');
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
 * Describes text of an option that cannot be read as the official Bot API server does, which
 * prefixes TDLib's description of the text with the option it parses. `textDescription` is the
 * description of the same text outside an option.
 */
export function describeInputPollOptionTextError(textDescription: string): string {
  if (!textDescription.startsWith(BAD_REQUEST_PREFIX)) {
    throw new Error(`Expected a Bad Request description, received ${textDescription}`);
  }
  const tdlibDescription = textDescription.slice(BAD_REQUEST_PREFIX.length);
  return `${INPUT_POLL_OPTION_ERROR_PREFIX}${tdlibDescription.charAt(0).toUpperCase()}${
    tdlibDescription.slice(1)
  }`;
}
