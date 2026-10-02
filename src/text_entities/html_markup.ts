import type { TextEntity } from '../types/virtual_message.ts';
import {
  asciiCode,
  isAsciiDigit,
  isAsciiHexDigit,
  isAsciiLetter,
  isTdlibSpace,
  isUtf8FirstCodeUnit,
  markupInvalid,
  type MarkupParsing,
  utf16LengthOfUtf8Character,
  Utf8MarkupInput,
  Utf8MarkupOutput,
} from './markup_input.ts';
import { readMarkupDateTimeFormat } from './date_time_format.ts';
import { toAsciiLowerCase } from '../types/http_url.ts';
import { getCheckedLink, getLinkUserId, parseCustomEmojiId } from './telegram_link.ts';
import { compareTextEntities } from './text_entity_order.ts';

const AMPERSAND = asciiCode('&');
const LESS_THAN = asciiCode('<');
const GREATER_THAN = asciiCode('>');
const SLASH = asciiCode('/');
const EQUALS = asciiCode('=');
const DOUBLE_QUOTE = asciiCode('"');
const SINGLE_QUOTE = asciiCode("'");
const SEMICOLON = asciiCode(';');
const HASH = asciiCode('#');
const LOWER_X = asciiCode('x');
const DOT = asciiCode('.');
const HYPHEN = asciiCode('-');

const SUPPORTED_TAG_NAMES: ReadonlySet<string> = new Set([
  'a',
  'b',
  'strong',
  'i',
  'em',
  's',
  'strike',
  'del',
  'u',
  'ins',
  'tg-spoiler',
  'tg-emoji',
  'tg-time',
  'span',
  'pre',
  'code',
  'blockquote',
]);

const NAMED_CHARACTER_REFERENCES: ReadonlyMap<string, number> = new Map([
  ['lt', asciiCode('<')],
  ['gt', asciiCode('>')],
  ['amp', asciiCode('&')],
  ['quot', asciiCode('"')],
]);

interface OpenTag {
  readonly tagName: string;
  readonly argument: string;
  /** The Unix time a `tg-time` tag shows. */
  readonly unixTime: number;
  /** Where the tag's content begins, in UTF-16 code units of the output text. */
  readonly entityOffset: number;
  /** Where the tag's content begins, in bytes of the output text. */
  readonly entityBeginPosition: number;
}

/** An entity being read; a code entity keeps its language until a `pre` tag around it claims it. */
interface HtmlEntity {
  entity: TextEntity;
  codeLanguage: string;
}

/**
 * Reads Telegram's HTML parse mode, mirroring `parse_html` in TDLib's
 * `td/telegram/MessageEntity.cpp`.
 */
export function parseHtmlMarkup(text: string): MarkupParsing {
  const input = new Utf8MarkupInput(text);
  const output = new Utf8MarkupOutput();
  const htmlEntities: HtmlEntity[] = [];
  const openTags: OpenTag[] = [];
  let utf16Offset = 0;
  let hasDecodedSurrogate = false;

  for (let index = 0; index < input.size; index++) {
    const byte = input.at(index);
    if (byte === AMPERSAND) {
      const reference = decodeCharacterReference(input, index);
      if (reference !== undefined) {
        index = reference.end - 1;
        utf16Offset += reference.codePoint > 0xffff ? 2 : 1;
        if (reference.codePoint >= 0xd800 && reference.codePoint <= 0xdfff) {
          hasDecodedSurrogate = true;
        }
        output.pushCodePoint(reference.codePoint);
        continue;
      }
    }
    if (byte !== LESS_THAN) {
      if (isUtf8FirstCodeUnit(byte)) {
        utf16Offset += utf16LengthOfUtf8Character(byte);
      }
      output.push(byte);
      continue;
    }

    const tagBeginPosition = index++;
    if (input.at(index) !== SLASH) {
      while (!isTdlibSpace(input.at(index)) && input.at(index) !== GREATER_THAN) {
        index++;
      }
      if (input.at(index) === 0) {
        return markupInvalid(`Unclosed start tag at byte offset ${tagBeginPosition}`);
      }

      const tagName = toAsciiLowerCase(input.decode(tagBeginPosition + 1, index));
      if (!SUPPORTED_TAG_NAMES.has(tagName)) {
        return markupInvalid(
          `Unsupported start tag "${tagName}" at byte offset ${tagBeginPosition}`,
        );
      }

      let argument = '';
      let unixTime = 0;
      while (input.at(index) !== GREATER_THAN) {
        while (input.at(index) !== 0 && isTdlibSpace(input.at(index))) {
          index++;
        }
        if (input.at(index) === GREATER_THAN) {
          break;
        }
        const attributeBeginPosition = index;
        while (!isAttributeNameTerminator(input.at(index))) {
          index++;
        }
        const attributeName = input.decode(attributeBeginPosition, index);
        if (attributeName.length === 0) {
          return markupInvalid(
            `Empty attribute name in the tag "${tagName}" at byte offset ${tagBeginPosition}`,
          );
        }
        while (input.at(index) !== 0 && isTdlibSpace(input.at(index))) {
          index++;
        }
        if (input.at(index) !== EQUALS) {
          if (input.at(index) === 0) {
            return markupInvalid(
              `Unclosed start tag "${tagName}" at byte offset ${tagBeginPosition}`,
            );
          }
          if (tagName === 'blockquote' && attributeName === 'expandable') {
            argument = '1';
          }
          continue;
        }
        index++;
        while (input.at(index) !== 0 && isTdlibSpace(input.at(index))) {
          index++;
        }
        if (input.at(index) === 0) {
          return markupInvalid(
            `Unclosed start tag "${tagName}" at byte offset ${tagBeginPosition}`,
          );
        }

        let attributeValue: string;
        if (input.at(index) !== SINGLE_QUOTE && input.at(index) !== DOUBLE_QUOTE) {
          // A name token: letters, digits, periods, or hyphens, compared case-insensitively.
          const tokenBeginPosition = index;
          while (isNameTokenByte(input.at(index))) {
            index++;
          }
          attributeValue = toAsciiLowerCase(input.decode(tokenBeginPosition, index));
          if (!isTdlibSpace(input.at(index)) && input.at(index) !== GREATER_THAN) {
            return markupInvalid(
              `Unexpected end of name token at byte offset ${tokenBeginPosition}`,
            );
          }
        } else {
          const quote = input.at(index++);
          const valueOutput = new Utf8MarkupOutput();
          while (input.at(index) !== quote && input.at(index) !== 0) {
            if (input.at(index) === AMPERSAND) {
              const reference = decodeCharacterReference(input, index);
              if (reference !== undefined) {
                valueOutput.pushCodePoint(reference.codePoint);
                index = reference.end;
                continue;
              }
            }
            valueOutput.push(input.at(index++));
          }
          if (input.at(index) === quote) {
            index++;
          }
          attributeValue = valueOutput.decode();
        }
        if (input.at(index) === 0) {
          return markupInvalid(`Unclosed start tag at byte offset ${tagBeginPosition}`);
        }

        if (tagName === 'tg-time' && attributeName === 'unix') {
          unixTime = readLeadingInteger(attributeValue);
        }
        argument = readTagArgument(tagName, attributeName, attributeValue) ?? argument;
      }

      if (tagName === 'span' && argument !== 'spoiler') {
        return markupInvalid(
          `Tag "span" must have class "tg-spoiler" at byte offset ${tagBeginPosition}`,
        );
      }
      openTags.push({
        tagName,
        argument,
        unixTime,
        entityOffset: utf16Offset,
        entityBeginPosition: output.size,
      });
      continue;
    }

    const openTag = openTags.at(-1);
    if (openTag === undefined) {
      return markupInvalid(`Unexpected end tag at byte offset ${tagBeginPosition}`);
    }
    while (!isTdlibSpace(input.at(index)) && input.at(index) !== GREATER_THAN) {
      index++;
    }
    const endTagName = toAsciiLowerCase(input.decode(tagBeginPosition + 2, index));
    while (isTdlibSpace(input.at(index)) && input.at(index) !== 0) {
      index++;
    }
    if (input.at(index) !== GREATER_THAN) {
      return markupInvalid(`Unclosed end tag at byte offset ${tagBeginPosition}`);
    }
    if (endTagName.length > 0 && endTagName !== openTag.tagName) {
      return markupInvalid(
        `Unmatched end tag at byte offset ${tagBeginPosition}, expected "</${openTag.tagName}>", found "</${endTagName}>"`,
      );
    }

    if (utf16Offset > openTag.entityOffset) {
      const closing = closeTag(openTag, utf16Offset - openTag.entityOffset, htmlEntities, output);
      if (closing !== undefined) {
        return closing;
      }
    }
    openTags.pop();
  }

  const unclosedTag = openTags.at(-1);
  if (unclosedTag !== undefined) {
    return markupInvalid(
      `Can't find end tag corresponding to start tag "${unclosedTag.tagName}"`,
    );
  }
  if (hasDecodedSurrogate) {
    return markupInvalid(
      'Text contains invalid Unicode characters after decoding HTML entities, check for unmatched surrogate code units',
    );
  }

  return {
    parsed: true,
    text: output.decode(),
    entities: htmlEntities.map(({ entity }) => entity).sort(compareTextEntities),
  };
}

/**
 * Records the entity a closed tag with content produces, or returns the failure its argument
 * causes. A link whose URL Telegram rejects produces no entity, and neither does a `tg-time` tag
 * without a positive Unix time.
 */
function closeTag(
  { tagName, argument, unixTime, entityOffset: offset, entityBeginPosition }: OpenTag,
  length: number,
  htmlEntities: HtmlEntity[],
  output: Utf8MarkupOutput,
): MarkupParsing | undefined {
  const addEntity = (entity: TextEntity) => htmlEntities.push({ entity, codeLanguage: '' });
  const previous = htmlEntities.at(-1);
  const previousHasSameSpan = previous !== undefined && previous.entity.offset === offset &&
    previous.entity.length === length;

  switch (tagName) {
    case 'i':
    case 'em':
      addEntity({ type: 'italic', offset, length });
      return undefined;
    case 'b':
    case 'strong':
      addEntity({ type: 'bold', offset, length });
      return undefined;
    case 's':
    case 'strike':
    case 'del':
      addEntity({ type: 'strikethrough', offset, length });
      return undefined;
    case 'u':
    case 'ins':
      addEntity({ type: 'underline', offset, length });
      return undefined;
    case 'tg-spoiler':
    case 'span':
      addEntity({ type: 'spoiler', offset, length });
      return undefined;
    case 'tg-emoji': {
      const customEmojiId = parseCustomEmojiId(argument);
      if (customEmojiId === undefined) {
        return markupInvalid('Invalid custom emoji identifier specified');
      }
      addEntity({ type: 'custom_emoji', offset, length, customEmojiId });
      return undefined;
    }
    case 'tg-time': {
      const formatReading = readMarkupDateTimeFormat(argument);
      if (!formatReading.valid) {
        return markupInvalid('Invalid date format used');
      }
      if (unixTime > 0) {
        const { format } = formatReading;
        addEntity({
          type: 'date_time',
          offset,
          length,
          unixTime,
          ...(format === undefined ? {} : { format }),
        });
      }
      return undefined;
    }
    case 'a': {
      const url = argument.length > 0 ? argument : output.decode(entityBeginPosition);
      const userId = getLinkUserId(url);
      if (userId !== undefined) {
        addEntity({ type: 'text_mention', offset, length, userId });
        return undefined;
      }
      const checkedUrl = getCheckedLink(url);
      if (checkedUrl !== undefined) {
        addEntity({ type: 'text_link', offset, length, url: checkedUrl });
      }
      return undefined;
    }
    case 'pre':
      // `<pre><code class="language-…">` marks a code block in that language.
      if (
        previousHasSameSpan && previous.entity.type === 'code' && previous.codeLanguage.length > 0
      ) {
        previous.entity = { type: 'pre', offset, length, language: previous.codeLanguage };
      } else {
        addEntity({ type: 'pre', offset, length });
      }
      return undefined;
    case 'code':
      if (
        previousHasSameSpan && previous.entity.type === 'pre' &&
        previous.entity.language === undefined && argument.length > 0
      ) {
        previous.entity = { type: 'pre', offset, length, language: argument };
      } else {
        htmlEntities.push({ entity: { type: 'code', offset, length }, codeLanguage: argument });
      }
      return undefined;
    case 'blockquote':
      addEntity({
        type: argument.length > 0 ? 'expandable_blockquote' : 'blockquote',
        offset,
        length,
      });
      return undefined;
    default:
      throw new Error(`Unhandled HTML tag: ${tagName}`);
  }
}

/** Returns the argument an attribute gives its tag, or `undefined` if the tag ignores it. */
function readTagArgument(
  tagName: string,
  attributeName: string,
  attributeValue: string,
): string | undefined {
  if (tagName === 'a' && attributeName === 'href') {
    return attributeValue;
  }
  if (tagName === 'code' && attributeName === 'class' && attributeValue.startsWith('language-')) {
    return attributeValue.slice('language-'.length);
  }
  if (tagName === 'span' && attributeName === 'class' && attributeValue.startsWith('tg-')) {
    return attributeValue.slice('tg-'.length);
  }
  if (tagName === 'tg-emoji' && attributeName === 'emoji-id') {
    return attributeValue;
  }
  if (tagName === 'tg-time' && attributeName === 'format') {
    return attributeValue;
  }
  if (tagName === 'blockquote' && attributeName === 'expandable') {
    return '1';
  }
  return undefined;
}

/**
 * Decodes the character reference at `start`, mirroring TDLib's `decode_html_entity`: `&lt;`,
 * `&gt;`, `&amp;`, `&quot;`, and numeric references, with an optional closing semicolon. Returns
 * `undefined` for text that stays literal.
 */
function decodeCharacterReference(
  input: Utf8MarkupInput,
  start: number,
): { readonly codePoint: number; readonly end: number } | undefined {
  let end = start + 1;
  let codePoint = 0;
  if (input.at(start + 1) === HASH) {
    end++;
    if (input.at(start + 2) === LOWER_X) {
      end++;
      while (isAsciiHexDigit(input.at(end))) {
        codePoint = codePoint * 16 + parseInt(String.fromCharCode(input.at(end++)), 16);
      }
    } else {
      while (isAsciiDigit(input.at(end))) {
        codePoint = codePoint * 10 + input.at(end++) - asciiCode('0');
      }
    }
    if (codePoint === 0 || codePoint >= 0x10ffff || end - start >= 10) {
      return undefined;
    }
  } else {
    while (isAsciiLetter(input.at(end))) {
      end++;
    }
    const namedCodePoint = NAMED_CHARACTER_REFERENCES.get(input.decode(start + 1, end));
    if (namedCodePoint === undefined) {
      return undefined;
    }
    codePoint = namedCodePoint;
  }

  return { codePoint, end: input.at(end) === SEMICOLON ? end + 1 : end };
}

/**
 * Reads the integer that text begins with, or 0 without one, as TDLib's lenient `to_integer`
 * does.
 */
function readLeadingInteger(text: string): number {
  const integerText = /^-?\d+/.exec(text)?.[0];
  return integerText === undefined ? 0 : Number(integerText);
}

function isAttributeNameTerminator(byte: number): boolean {
  return isTdlibSpace(byte) || byte === EQUALS || byte === GREATER_THAN || byte === SLASH ||
    byte === DOUBLE_QUOTE || byte === SINGLE_QUOTE;
}

function isNameTokenByte(byte: number): boolean {
  return isAsciiLetter(byte) || isAsciiDigit(byte) || byte === DOT || byte === HYPHEN;
}
