import type { FormattedTextFixingContext } from '../../text_entities/formatted_text.ts';
import { findDetectedEntities } from '../../text_entities/detected_entities.ts';
import { cleanInputString } from '../../text_entities/input_string.ts';
import {
  type DetectedRichTextEntityType,
  forEachRichText,
  mapRichBlocks,
  mapRichMessageTexts,
  mapRichTextParts,
  type RichMessage,
  type RichMessageFileTypes,
  type RichText,
} from '../../types/rich_message.ts';
import type { TextEntity } from '../../types/virtual_message.ts';

// Telegram's rules for the text of rich messages, which apply alike in every chat type.

export type RichMessageNormalization<Files extends RichMessageFileTypes> =
  | { readonly normalized: true; readonly richMessage: RichMessage<Files> }
  | {
    readonly normalized: false;
    readonly reason: 'text_invalid';
    /** TDLib's description of the text it refuses. */
    readonly textError: string;
  };

/**
 * Checks and completes a rich message a bot sends, as Telegram does before storing it. Its strings
 * are cleaned as TDLib's `RichText::get_rich_text` and `get_web_page_blocks` clean them, which
 * refuse text that is not well-formed Unicode; a text mention must name a user the message can
 * mention; and Telegram marks the entities it detects in the message's text unless the bot turned
 * detection off.
 *
 * TDLib sends a rich message's blocks to Telegram's servers, which mark the entities; the
 * open-source code does not show their rules for rich text. The emulator applies the rules of
 * message text, which `findDetectedEntities` implements, to each plain text of the message on its
 * own, so an entity split across differently formatted parts is not found. As in message text,
 * none are detected in code, preformatted blocks, links, text mentions, dates, or buttons.
 */
export function normalizeRichMessage<Files extends RichMessageFileTypes>(
  richMessage: RichMessage<Files>,
  detectsEntities: boolean,
  context: FormattedTextFixingContext,
): RichMessageNormalization<Files> {
  const cleaning = cleanRichMessageStrings(richMessage);
  if (!cleaning.cleaned) {
    return { normalized: false, reason: 'text_invalid', textError: cleaning.error };
  }
  let mentionsUnknownUser = false;
  forEachRichText(cleaning.richMessage, (text) => {
    if (text.kind === 'text_mention' && !context.isMentionableUser(text.userId)) {
      mentionsUnknownUser = true;
    }
  });
  if (mentionsUnknownUser) {
    return { normalized: false, reason: 'text_invalid', textError: 'User not found' };
  }
  return {
    normalized: true,
    richMessage: detectsEntities
      ? mapRichMessageTexts(
        cleaning.richMessage,
        (text, placement) => placement === 'other' ? markDetectedEntities(text) : text,
      )
      : cleaning.richMessage,
  };
}

/**
 * Cleans every string of a rich message as TDLib's `clean_input_string` does, failing with TDLib's
 * description of the first string that is not well-formed Unicode.
 */
function cleanRichMessageStrings<Files extends RichMessageFileTypes>(
  richMessage: RichMessage<Files>,
):
  | { readonly cleaned: true; readonly richMessage: RichMessage<Files> }
  | { readonly cleaned: false; readonly error: string } {
  let error: string | undefined;
  const clean = (value: string, errorDescription: string): string => {
    const cleanedValue = cleanInputString(value);
    if (cleanedValue === undefined) {
      error ??= errorDescription;
      return value;
    }
    return cleanedValue;
  };
  const cleanText = (text: RichText): RichText => {
    switch (text.kind) {
      case 'plain':
        return { ...text, text: clean(text.text, 'Rich text must be encoded in UTF-8') };
      case 'link':
        return {
          ...text,
          text: cleanText(text.text),
          url: clean(text.url, 'Rich text URL must be encoded in UTF-8'),
        };
      case 'anchor_link':
        return {
          ...text,
          text: cleanText(text.text),
          targetName: clean(text.targetName, 'Anchor name must be encoded in UTF-8'),
        };
      case 'email_address':
        return {
          ...text,
          text: cleanText(text.text),
          emailAddress: clean(
            text.emailAddress,
            'Rich text email address must be encoded in UTF-8',
          ),
        };
      case 'phone_number':
        return {
          ...text,
          text: cleanText(text.text),
          phoneNumber: clean(text.phoneNumber, 'Rich text phone number must be encoded in UTF-8'),
        };
      case 'custom_emoji':
        return {
          ...text,
          alternativeText: clean(
            text.alternativeText,
            'Custom emoji alternative text must be encoded in UTF-8',
          ),
        };
      case 'mathematical_expression':
        return {
          ...text,
          expression: clean(text.expression, 'Mathematical expression must be encoded in UTF-8'),
        };
      case 'anchor':
        return { ...text, name: clean(text.name, 'Anchor name must be encoded in UTF-8') };
      case 'reference':
        return {
          ...text,
          text: cleanText(text.text),
          name: clean(text.name, 'Reference name must be encoded in UTF-8'),
        };
      case 'button':
        return { kind: 'button', button: { ...text.button, text: cleanText(text.button.text) } };
      default:
        return mapRichTextParts(text, cleanText);
    }
  };
  const cleanedRichMessage = mapRichBlocks(
    mapRichMessageTexts(richMessage, cleanText),
    (block) => {
      switch (block.kind) {
        case 'preformatted': {
          const { language, ...preformattedBlock } = block;
          const cleanedLanguage = language === undefined
            ? ''
            : clean(language, 'Language must be encoded in UTF-8');
          return cleanedLanguage.length === 0
            ? preformattedBlock
            : { ...preformattedBlock, language: cleanedLanguage };
        }
        case 'mathematical_expression':
          return {
            ...block,
            expression: clean(block.expression, 'Mathematical expression must be encoded in UTF-8'),
          };
        case 'anchor':
          return { ...block, name: clean(block.name, 'Anchor name must be encoded in UTF-8') };
        default:
          return block;
      }
    },
  );
  return error === undefined
    ? { cleaned: true, richMessage: cleanedRichMessage }
    : { cleaned: false, error };
}

/**
 * Marks the entities Telegram detects in the plain texts of rich text, splitting each plain text
 * into its detected entities and the text between them. The parts of a plain text in a
 * concatenation join that concatenation.
 */
function markDetectedEntities(text: RichText): RichText {
  switch (text.kind) {
    case 'plain': {
      const parts = splitDetectedEntities(text.text);
      return parts.length === 1 ? parts[0] : { kind: 'concatenation', texts: parts };
    }
    case 'concatenation':
      return {
        kind: 'concatenation',
        texts: text.texts.flatMap((part) =>
          part.kind === 'plain' ? splitDetectedEntities(part.text) : [markDetectedEntities(part)]
        ),
      };
    case 'styled':
      return text.style === 'code' ? text : mapRichTextParts(text, markDetectedEntities);
    case 'reference':
      return mapRichTextParts(text, markDetectedEntities);
    case 'date_time':
    case 'text_mention':
    case 'link':
    case 'anchor_link':
    case 'email_address':
    case 'phone_number':
    case 'detected_entity':
    case 'button':
    case 'custom_emoji':
    case 'mathematical_expression':
    case 'anchor':
      return text;
    default: {
      const unhandledText: never = text;
      throw new Error(`Unhandled rich text: ${JSON.stringify(unhandledText)}`);
    }
  }
}

/**
 * Splits plain text into the entities Telegram detects in it and the nonempty text between them;
 * text without entities stays whole.
 */
function splitDetectedEntities(text: string): RichText[] {
  const entities = findDetectedEntities(text);
  if (entities.length === 0) {
    return [{ kind: 'plain', text }];
  }
  const parts: RichText[] = [];
  let position = 0;
  for (const entity of entities) {
    if (entity.offset > position) {
      parts.push({ kind: 'plain', text: text.slice(position, entity.offset) });
    }
    const entityEnd = entity.offset + entity.length;
    parts.push({
      kind: 'detected_entity',
      entityType: toDetectedRichTextEntityType(entity.type),
      text: { kind: 'plain', text: text.slice(entity.offset, entityEnd) },
    });
    position = entityEnd;
  }
  if (position < text.length) {
    parts.push({ kind: 'plain', text: text.slice(position) });
  }
  return parts;
}

function toDetectedRichTextEntityType(type: TextEntity['type']): DetectedRichTextEntityType {
  switch (type) {
    case 'mention':
    case 'hashtag':
    case 'cashtag':
    case 'bot_command':
    case 'url':
    case 'bank_card_number':
      return type;
    case 'email':
      return 'email_address';
    default:
      throw new Error(`Entity type ${type} is not detected in text`);
  }
}
