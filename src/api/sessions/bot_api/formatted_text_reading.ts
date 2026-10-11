import { z } from 'zod';

import { isParseMode, parseMarkup } from '../../../text_entities/parse_mode.ts';
import type { TextEntity } from '../../../types/virtual_message.ts';
import { BOT_API_ERRORS } from './errors/error_catalogue.ts';
import { presentFixedBotApiError } from './errors/error_template.ts';
import type { UnreadFormattedText } from './inline_query_answer_parameters.ts';
import { linkPreviewOptionsParameter } from './link_preview_options_parameter.ts';
import {
  messageEntitiesParameter,
  type MessageEntityError,
  readMessageEntities,
} from './message_entities_parameter.ts';
import { botApiError, type BotApiMethodAnswer } from './method_call.ts';
import { booleanParameter } from './request_parameters.ts';

/**
 * Why the official Bot API server's `get_formatted_text` cannot read text with its formatting:
 * text longer than it reads, a parse mode it does not know, markup that is not well-formed
 * Unicode or that TDLib cannot parse, or an entity it cannot parse.
 */
export type FormattedTextError =
  | { readonly reason: 'text_too_long' | 'parse_mode_unsupported' | 'text_encoding_invalid' }
  | {
    readonly reason: 'markup_invalid';
    /** TDLib's description of the markup error. */
    readonly markupError: string;
  }
  | { readonly reason: 'entity_unparsable'; readonly entityError: MessageEntityError };

/**
 * Text with its formatting as `readFormattedTextWithEntities` reads it, Telegram's error for text
 * or formatting it cannot read, or entities that Telegram would read leniently.
 */
type FormattedTextWithEntitiesReading =
  | { readonly read: true; readonly formattedText: SpecifiedFormattedText }
  | {
    readonly read: false;
    readonly reason: 'text_invalid';
    readonly textError: FormattedTextError;
  }
  | { readonly read: false; readonly reason: 'entities_malformed' };

/**
 * Link preview parameters, which the emulator validates and ignores because it generates no link
 * previews. `disable_web_page_preview` is the older form that Telegram still accepts.
 */
export const linkPreviewParametersShape = {
  link_preview_options: linkPreviewOptionsParameter().optional(),
  disable_web_page_preview: booleanParameter().optional(),
};

/** A caption and its formatting; Telegram treats a missing caption as none. */
export const captionParametersShape = {
  caption: z.string().default(''),
  parse_mode: z.string().optional(),
  caption_entities: messageEntitiesParameter().optional(),
};

/** The most UTF-8 bytes of text the Bot API reads before applying its formatting. */
const MAX_FORMATTED_TEXT_BYTES = 1 << 15;

/** A parse mode that leaves text as it is, as omitting it does. */
const NO_PARSE_MODE = 'none';

/** Formatted text as a bot specified it: entities from `entities` or from parsed markup. */
export interface SpecifiedFormattedText {
  readonly text: string;
  /**
   * Validated and normalized as Telegram does before the message is stored; omitted for plain
   * text.
   */
  readonly entities?: readonly TextEntity[];
}

/** Text with its formatting, or why `readFormattedText` could not read it. */
type FormattedTextReadingResult =
  | { readonly read: true; readonly formattedText: SpecifiedFormattedText }
  | {
    readonly read: false;
    readonly textError: Exclude<FormattedTextError, { readonly reason: 'entity_unparsable' }>;
  };

/** Message text with the entities its bot specified, or the error answer for reading it. */
type SpecifiedFormattedTextReading =
  | Extract<FormattedTextReadingResult, { readonly read: true }>
  | { readonly read: false; readonly errorAnswer: BotApiMethodAnswer };

/** Text with the entities its bot specified, or Telegram's description of why it is unreadable. */
type FormattedTextParametersReading =
  | Extract<FormattedTextReadingResult, { readonly read: true }>
  | { readonly read: false; readonly description: string };

/**
 * Reads nonempty message text with its `parse_mode` or `entities`, answering Telegram's error for
 * text or formatting it cannot read.
 */
export function readSpecifiedFormattedText(
  specifiedText: {
    readonly text: string;
    readonly parseMode: string | undefined;
    readonly entities: readonly unknown[] | undefined;
  },
  invalidParametersDescription: string,
): SpecifiedFormattedTextReading {
  if (specifiedText.text.length === 0) {
    return { read: false, errorAnswer: presentFixedBotApiError(BOT_API_ERRORS.messageTextEmpty) };
  }
  return withErrorAnswer(
    readFormattedTextParameters(specifiedText, invalidParametersDescription),
  );
}

/**
 * Reads a caption with its `parse_mode` or `caption_entities`, as message text is read; an empty
 * caption is none.
 */
export function readSpecifiedCaption(
  { caption, parse_mode: parseMode, caption_entities: captionEntities }: {
    readonly caption: string;
    readonly parse_mode?: string;
    readonly caption_entities?: readonly unknown[];
  },
  invalidParametersDescription: string,
): SpecifiedFormattedTextReading {
  return withErrorAnswer(readFormattedTextParameters(
    { text: caption, parseMode, entities: captionEntities },
    invalidParametersDescription,
  ));
}

function withErrorAnswer(reading: FormattedTextParametersReading): SpecifiedFormattedTextReading {
  return reading.read
    ? reading
    : { read: false, errorAnswer: botApiError(400, reading.description) };
}

/**
 * Reads text with the parse mode or entities that format it, as `readFormattedTextWithEntities`
 * reads them, answering Telegram's error for text or formatting it cannot read, and
 * `invalidParametersDescription` for entities that Telegram would read leniently.
 */
export function readFormattedTextParameters(
  { text, parseMode, entities }: {
    readonly text: string;
    readonly parseMode: string | undefined;
    readonly entities: readonly unknown[] | undefined;
  },
  invalidParametersDescription: string,
): FormattedTextParametersReading {
  const reading = readFormattedTextWithEntities({ text, parseMode, entities });
  if (reading.read) {
    return reading;
  }
  return {
    read: false,
    description: reading.reason === 'text_invalid'
      ? BOT_API_ERRORS.formattedTextInvalid.description(reading.textError)
      : invalidParametersDescription,
  };
}

/**
 * Reads text of an object that a parameter holds as JSON, such as an inline query result, as
 * `readFormattedTextParameters` does. The Bot API server reports text it cannot read as an object
 * it cannot read, which `describeObjectTextError` describes with Telegram's error for the text.
 */
export function readEmbeddedFormattedText(
  { text, parseMode, entities }: UnreadFormattedText,
  invalidParametersDescription: string,
  describeObjectTextError: (textError: FormattedTextError) => string,
): { readonly read: true; readonly formattedText: SpecifiedFormattedText } | {
  readonly read: false;
  readonly description: string;
} {
  const reading = readFormattedTextWithEntities({ text, parseMode, entities });
  if (reading.read) {
    return reading;
  }
  return {
    read: false,
    description: reading.reason === 'text_invalid'
      ? describeObjectTextError(reading.textError)
      : invalidParametersDescription,
  };
}

/**
 * Reads text with the entities that format it, as `readMessageEntities` reads them, and then with
 * its parse mode, as `readFormattedText` does.
 *
 * Entities are decoded even alongside a parse mode, which makes Telegram ignore them, so malformed
 * entities are rejected in either case to surface the bot's mistake in tests.
 */
function readFormattedTextWithEntities(
  { text, parseMode, entities }: {
    readonly text: string;
    readonly parseMode: string | undefined;
    readonly entities: readonly unknown[] | undefined;
  },
): FormattedTextWithEntitiesReading {
  const entitiesReading = readMessageEntities(entities ?? []);
  if (!entitiesReading.read) {
    return entitiesReading.reason === 'entity_unparsable'
      ? {
        read: false,
        reason: 'text_invalid',
        textError: { reason: 'entity_unparsable', entityError: entitiesReading.entityError },
      }
      : { read: false, reason: 'entities_malformed' };
  }
  const reading = readFormattedText({ text, parseMode, entities: entitiesReading.entities });
  return reading.read
    ? reading
    : { read: false, reason: 'text_invalid', textError: reading.textError };
}

/**
 * Reads message text with its `parse_mode` or `entities`, as the official Bot API server's
 * `Client::get_formatted_text` does before it looks at the chat: a parse mode other than `none`
 * turns markup into entities and overrides `entities`. The result still has to pass the checks
 * that sending or editing applies.
 */
function readFormattedText(
  { text, parseMode, entities }: {
    /** Message text or a caption, which may be written in markup. */
    readonly text: string;
    /** The `parse_mode` parameter, matched case-insensitively. */
    readonly parseMode?: string;
    /** The `entities` parameter, which a parse mode overrides. */
    readonly entities: readonly TextEntity[];
  },
): FormattedTextReadingResult {
  if (new TextEncoder().encode(text).length > MAX_FORMATTED_TEXT_BYTES) {
    return { read: false, textError: { reason: 'text_too_long' } };
  }
  const parseModeName = parseMode?.toLowerCase() ?? '';
  if (parseModeName.length === 0 || parseModeName === NO_PARSE_MODE) {
    return { read: true, formattedText: { text, entities } };
  }
  if (!isParseMode(parseModeName)) {
    return { read: false, textError: { reason: 'parse_mode_unsupported' } };
  }
  if (!text.isWellFormed()) {
    return { read: false, textError: { reason: 'text_encoding_invalid' } };
  }

  const parsing = parseMarkup(text, parseModeName);
  if (parsing.parsed) {
    return { read: true, formattedText: { text: parsing.text, entities: parsing.entities } };
  }
  return { read: false, textError: { reason: 'markup_invalid', markupError: parsing.error } };
}
