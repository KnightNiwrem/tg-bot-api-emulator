import type { EmulationSession } from '../../../types/emulation_session.ts';
import type { UnreadFormattedText } from './inline_query_answer_parameters.ts';
import { readMessageEntitiesParameter } from './message_entities_parameter.ts';
import { BAD_REQUEST_PREFIX, type BotApiMethodContext } from './method_call.ts';

/** Telegram's descriptions for message text or formatting it cannot read. */
const FORMATTED_TEXT_TOO_LONG_DESCRIPTION = 'Bad Request: text is too long';
const PARSE_MODE_UNSUPPORTED_DESCRIPTION = 'Bad Request: unsupported parse_mode';
const TEXT_ENCODING_INVALID_DESCRIPTION = 'Bad Request: text must be encoded in UTF-8';

/** Formatted text as a bot specified it, the result of reading its parse mode or entities. */
export type SpecifiedFormattedText = Extract<
  FormattedTextReadingResult,
  { readonly read: true }
>['formattedText'];

export type FormattedTextReadingResult = ReturnType<
  EmulationSession['botApi']['readFormattedText']
>;

/** Text with the entities its bot specified, or Telegram's description of why it is unreadable. */
export type FormattedTextParametersReading =
  | Extract<FormattedTextReadingResult, { readonly read: true }>
  | { readonly read: false; readonly description: string };

/**
 * Reads text with the parse mode or entities that format it, answering Telegram's error for text
 * or formatting it cannot read.
 *
 * Entities are decoded even alongside a parse mode, which makes Telegram ignore them, so malformed
 * entities are rejected in either case to surface the bot's mistake in tests.
 */
export function readFormattedTextParameters(
  context: BotApiMethodContext,
  { text, parseMode, entities }: {
    readonly text: string;
    readonly parseMode: string | undefined;
    readonly entities: readonly unknown[] | undefined;
  },
  invalidParametersDescription: string,
): FormattedTextParametersReading {
  const failure = (description: string): FormattedTextParametersReading => ({
    read: false,
    description,
  });
  const entitiesReading = readMessageEntitiesParameter(
    entities ?? [],
    invalidParametersDescription,
  );
  if (!entitiesReading.read) {
    return failure(entitiesReading.description);
  }

  const result = context.session.botApi.readFormattedText({
    text,
    parseMode,
    entities: entitiesReading.entities,
  });
  if (result.read) {
    return result;
  }
  switch (result.reason) {
    case 'text_too_long':
      return failure(FORMATTED_TEXT_TOO_LONG_DESCRIPTION);
    case 'parse_mode_unsupported':
      return failure(PARSE_MODE_UNSUPPORTED_DESCRIPTION);
    case 'text_encoding_invalid':
      return failure(TEXT_ENCODING_INVALID_DESCRIPTION);
    case 'markup_invalid':
      return failure(`Bad Request: can't parse entities: ${result.markupError}`);
    default: {
      const unhandledFailure: never = result;
      throw new Error(`Unhandled text reading failure: ${JSON.stringify(unhandledFailure)}`);
    }
  }
}

/**
 * Reads text of an object that a parameter holds as JSON, such as an inline query result, as
 * `readFormattedTextParameters` does. The Bot API server reports text it cannot read as an object
 * it cannot read, prefixing Telegram's own description with `objectErrorPrefix`.
 */
export function readEmbeddedFormattedText(
  context: BotApiMethodContext,
  { text, parseMode, entities }: UnreadFormattedText,
  invalidParametersDescription: string,
  objectErrorPrefix: string,
): { readonly read: true; readonly formattedText: SpecifiedFormattedText } | {
  readonly read: false;
  readonly description: string;
} {
  const reading = readFormattedTextParameters(
    context,
    { text, parseMode, entities },
    invalidParametersDescription,
  );
  if (reading.read || reading.description === invalidParametersDescription) {
    return reading;
  }
  // Telegram's descriptions begin with a capital letter, which `badRequestDescription` lowered.
  const telegramError = reading.description.slice(BAD_REQUEST_PREFIX.length);
  return {
    read: false,
    description: `${BAD_REQUEST_PREFIX}${objectErrorPrefix}${
      telegramError.charAt(0).toUpperCase()
    }${telegramError.slice(1)}`,
  };
}
