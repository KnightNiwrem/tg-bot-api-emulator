import { toBotApiLocation } from '../types/bot_api.ts';
import type { BotApiUser } from '../types/bot_api.ts';
import type {
  BotApiRichBlock,
  BotApiRichBlockCaption,
  BotApiRichBlockListItem,
  BotApiRichBlockTableCell,
  BotApiRichMessage,
  BotApiRichMessageButton,
  BotApiRichText,
  BotApiRichTextObject,
} from '../types/bot_api_rich_message.ts';
import {
  type DetectedRichTextEntityType,
  forEachRichBlockAndText,
  getRichMessageAnchorLinkUrl,
  getRichTextFullText,
  type OrderedListItemNumber,
  type RichBlock,
  type RichBlockCaption,
  type RichListItem,
  type RichMessage,
  type RichMessageButton,
  type RichTableCell,
  type RichText,
} from '../types/rich_message.ts';
import type { StoredFileId } from '../types/stored_file.ts';
import { writeDateTimeFormat } from './bot_api_date_time_format.ts';
import {
  type ObservedFile,
  projectDocument,
  projectPhotoSize,
  projectVideo,
  projectVoice,
} from './bot_api_file.ts';
import { projectInlineButtonAction } from './bot_api_inline_keyboard.ts';

/** What a rich message's projection shows beyond the message itself, resolved for the observer. */
export interface RichMessageProjectionContext {
  /** Every user the message's text mentions, by ID. */
  readonly mentionedUsers: ReadonlyMap<number, BotApiUser>;
  /** The files of the message's media blocks, as the observer knows them. */
  readonly files: ReadonlyMap<StoredFileId, ObservedFile>;
}

/** The label clients show for an item of an unordered list, as TDLib's `pageBlockListItem` has it. */
const UNORDERED_LIST_ITEM_LABEL = '•';

/** The URL prefix of links to an anchor or a reference of the rich message itself. */
const ANCHOR_LINK_URL_PREFIX = '#';

/**
 * The name that a link to `#` alone gives: the top of the rich message, unless an anchor or a
 * reference of the message has that name.
 */
const MESSAGE_TOP_ANCHOR_NAME = '';

/** What an anchor name of a rich message marks: an invisible anchor, or a reference's text. */
type AnchorTarget = 'anchor' | 'reference';

/**
 * Projects a rich message as the official Bot API server's `JsonRichMessage` shows the message
 * TDLib's `RichMessage::get_rich_message_object` gives it.
 *
 * A link to `#` and the name of one of the message's anchor targets, raw or URL-decoded, is shown
 * as a link to that anchor or reference; `#` alone links back to the top of the message. Other
 * links, including those to names the message lacks, stay URLs.
 */
export function projectRichMessage(
  richMessage: RichMessage,
  context: RichMessageProjectionContext,
): BotApiRichMessage {
  return {
    blocks: new RichMessageProjection(context, collectAnchorTargets(richMessage)).projectBlocks(
      richMessage.blocks,
    ),
    ...(richMessage.isRightToLeft ? { is_rtl: true as const } : {}),
  };
}

/**
 * The targets that links to a rich message itself can name, as TDLib's `get_page_blocks_object`
 * collects them before it shows any link: the first anchor block, anchor, or reference of each
 * name in the order the message shows them, and the top of the message.
 */
function collectAnchorTargets(richMessage: RichMessage): ReadonlyMap<string, AnchorTarget> {
  const anchorTargets = new Map<string, AnchorTarget>();
  const addFirstAnchorTarget = (name: string, target: AnchorTarget): void => {
    if (!anchorTargets.has(name)) {
      anchorTargets.set(name, target);
    }
  };
  forEachRichBlockAndText(richMessage, {
    visitBlock: (block) => {
      if (block.kind === 'anchor') {
        addFirstAnchorTarget(block.name, 'anchor');
      }
    },
    visitText: (text) => {
      if (text.kind === 'anchor' || text.kind === 'reference') {
        addFirstAnchorTarget(text.name, text.kind);
      }
    },
  });
  addFirstAnchorTarget(MESSAGE_TOP_ANCHOR_NAME, 'anchor');
  return anchorTargets;
}

/** Projects the blocks of a rich message, showing links with the message's anchor targets. */
class RichMessageProjection {
  readonly #context: RichMessageProjectionContext;
  readonly #anchorTargets: ReadonlyMap<string, AnchorTarget>;

  constructor(
    context: RichMessageProjectionContext,
    anchorTargets: ReadonlyMap<string, AnchorTarget>,
  ) {
    this.#context = context;
    this.#anchorTargets = anchorTargets;
  }

  projectBlocks(blocks: readonly RichBlock[]): BotApiRichBlock[] {
    return blocks.map((block) => this.#projectBlock(block));
  }

  /** Shows a block as the official Bot API server's `JsonRichBlock` does. */
  #projectBlock(block: RichBlock): BotApiRichBlock {
    switch (block.kind) {
      case 'paragraph':
      case 'footer':
        return { type: block.kind, text: this.#projectText(block.text) };
      case 'heading':
        return { type: 'heading', text: this.#projectText(block.text), size: block.size };
      case 'preformatted':
        return {
          type: 'pre',
          text: this.#projectText(block.text),
          ...(block.language === undefined ? {} : { language: block.language }),
        };
      case 'divider':
        return { type: 'divider' };
      case 'mathematical_expression':
        return { type: 'mathematical_expression', expression: block.expression };
      case 'anchor':
        return { type: 'anchor', name: block.name };
      case 'list':
        return { type: 'list', items: block.items.map((item) => this.#projectListItem(item)) };
      case 'blockquote':
        return {
          type: 'blockquote',
          blocks: this.projectBlocks(block.blocks),
          ...this.#projectCredit(block.credit),
        };
      case 'expandable_blockquote':
      case 'pullquote':
        return {
          type: block.kind,
          text: this.#projectText(block.text),
          ...this.#projectCredit(block.credit),
        };
      case 'collage':
      case 'slideshow':
        return {
          type: block.kind,
          blocks: this.projectBlocks(block.blocks),
          ...this.#projectCaption(block.caption),
        };
      case 'table':
        return {
          type: 'table',
          cells: block.rows.map((row) => row.map((cell) => this.#projectTableCell(cell))),
          ...(block.caption === undefined ? {} : { caption: this.#projectText(block.caption) }),
          ...(block.isBordered ? { is_bordered: true as const } : {}),
          ...(block.isStriped ? { is_striped: true as const } : {}),
          ...(block.isCompact ? { is_compact: true as const } : {}),
        };
      case 'details':
        return {
          type: 'details',
          summary: this.#projectText(block.summary),
          blocks: this.projectBlocks(block.blocks),
          ...(block.isOpen ? { is_open: true as const } : {}),
        };
      case 'map':
        return {
          type: 'map',
          location: toBotApiLocation(block.location),
          zoom: block.zoom,
          width: block.width,
          height: block.height,
          ...this.#projectCaption(block.caption),
        };
      case 'buttons':
        return {
          type: 'buttons',
          buttons: block.buttons.map((button) => this.#projectButton(button)),
          ...(block.alignment === undefined ? {} : { align: block.alignment }),
        };
      case 'photo':
        return {
          type: 'photo',
          photo: [projectPhotoSize(this.#context.files.get(block.photo))],
          ...this.#projectCaption(block.caption),
          ...(block.hasSpoiler ? { has_spoiler: true as const } : {}),
        };
      case 'document':
        return {
          type: 'document',
          document: projectDocument(this.#context.files.get(block.document)),
          ...this.#projectCaption(block.caption),
        };
      // TDLib's `WebPageBlockVideo` neither plays a sent video automatically nor loops it, so the
      // server's `need_autoplay` and `is_looped` are never shown.
      case 'video':
        return {
          type: 'video',
          video: projectVideo(this.#context.files.get(block.video), 0),
          ...this.#projectCaption(block.caption),
          ...(block.hasSpoiler ? { has_spoiler: true as const } : {}),
        };
      case 'voice_note':
        return {
          type: 'voice_note',
          voice_note: projectVoice(this.#context.files.get(block.voiceNote)),
          ...this.#projectCaption(block.caption),
        };
      default: {
        const unhandledBlock: never = block;
        throw new Error(`Unhandled rich block: ${JSON.stringify(unhandledBlock)}`);
      }
    }
  }

  /**
   * Shows a list item as the official Bot API server's `JsonRichBlockListItem` does, with the label
   * TDLib gives it.
   */
  #projectListItem(
    { blocks, hasCheckbox, isChecked, number }: RichListItem,
  ): BotApiRichBlockListItem {
    return {
      label: number === undefined ? UNORDERED_LIST_ITEM_LABEL : getOrderedListItemLabel(number),
      blocks: this.projectBlocks(blocks),
      ...(hasCheckbox ? { has_checkbox: true as const } : {}),
      ...(isChecked ? { is_checked: true as const } : {}),
      ...(number === undefined ? {} : { type: number.labelType, value: number.value }),
    };
  }

  #projectTableCell(cell: RichTableCell): BotApiRichBlockTableCell {
    return {
      ...(cell.text === undefined ? {} : { text: this.#projectText(cell.text) }),
      ...(cell.isHeader ? { is_header: true as const } : {}),
      ...(cell.columnSpan > 1 ? { colspan: cell.columnSpan } : {}),
      ...(cell.rowSpan > 1 ? { rowspan: cell.rowSpan } : {}),
      align: cell.alignment,
      valign: cell.verticalAlignment,
    };
  }

  #projectCaption(
    caption: RichBlockCaption | undefined,
  ): { readonly caption?: BotApiRichBlockCaption } {
    return caption === undefined ? {} : {
      caption: {
        text: this.#projectText(caption.text),
        ...this.#projectCredit(caption.credit),
      },
    };
  }

  #projectCredit(credit: RichText | undefined): { readonly credit?: BotApiRichText } {
    return credit === undefined ? {} : { credit: this.#projectText(credit) };
  }

  #projectButton({ text, style, action }: RichMessageButton): BotApiRichMessageButton {
    return {
      text: this.#projectText(text),
      ...(style === undefined ? {} : { style }),
      ...projectInlineButtonAction(action),
    };
  }

  /** Shows rich text as the official Bot API server's `JsonRichText` does. */
  #projectText(text: RichText): BotApiRichText {
    switch (text.kind) {
      case 'plain':
        return text.text;
      case 'concatenation':
        return text.texts.map((part) => this.#projectText(part));
      default:
        return this.#projectTextObject(text);
    }
  }

  #projectTextObject(
    text: Exclude<RichText, { readonly kind: 'plain' | 'concatenation' }>,
  ): BotApiRichTextObject {
    switch (text.kind) {
      case 'styled':
        return { type: text.style, text: this.#projectText(text.text) };
      case 'date_time':
        return {
          type: 'date_time',
          text: this.#projectText(text.text),
          unix_time: text.unixTime,
          date_time_format: writeDateTimeFormat(text.format),
        };
      case 'text_mention': {
        const user = this.#context.mentionedUsers.get(text.userId);
        if (user === undefined) {
          throw new Error(`Mentioned user ${text.userId} was not provided`);
        }
        return { type: 'text_mention', text: this.#projectText(text.text), user };
      }
      case 'link':
        return this.#projectLink(text.text, text.url);
      case 'anchor_link':
        return this.#projectLink(text.text, getRichMessageAnchorLinkUrl(text.targetName));
      case 'email_address':
        return {
          type: 'email_address',
          text: this.#projectText(text.text),
          email_address: text.emailAddress,
        };
      case 'phone_number':
        return {
          type: 'phone_number',
          text: this.#projectText(text.text),
          phone_number: text.phoneNumber,
        };
      case 'custom_emoji':
        return {
          type: 'custom_emoji',
          custom_emoji_id: text.customEmojiId,
          alternative_text: text.alternativeText,
        };
      case 'mathematical_expression':
        return { type: 'mathematical_expression', expression: text.expression };
      case 'anchor':
        return { type: 'anchor', name: text.name };
      case 'reference':
        return { type: 'reference', text: this.#projectText(text.text), name: text.name };
      case 'detected_entity':
        return this.#projectDetectedEntity(text.entityType, text.text);
      case 'button':
        return { type: 'button', button: this.#projectButton(text.button) };
      default: {
        const unhandledText: never = text;
        throw new Error(`Unhandled rich text: ${JSON.stringify(unhandledText)}`);
      }
    }
  }

  /**
   * Shows a detected entity as TDLib's `RichText::get_rich_text_object` does: its data is the text
   * it covers, without the leading `@`, `#`, `$`, or `/` of a mention, hashtag, cashtag, or bot
   * command.
   */
  #projectDetectedEntity(
    entityType: DetectedRichTextEntityType,
    coveredText: RichText,
  ): BotApiRichTextObject {
    const text = this.#projectText(coveredText);
    const fullText = getRichTextFullText(coveredText);
    switch (entityType) {
      case 'mention':
        return { type: 'mention', text, username: removeFirstCharacter(fullText, '@') };
      case 'hashtag':
        return { type: 'hashtag', text, hashtag: removeFirstCharacter(fullText, '#') };
      case 'cashtag':
        return { type: 'cashtag', text, cashtag: removeFirstCharacter(fullText, '$') };
      case 'bot_command':
        return { type: 'bot_command', text, bot_command: removeFirstCharacter(fullText, '/') };
      case 'url':
        return { type: 'url', text, url: fullText };
      case 'email_address':
        return { type: 'email_address', text, email_address: fullText };
      case 'bank_card_number':
        return { type: 'bank_card_number', text, bank_card_number: fullText };
      default: {
        const unhandledEntityType: never = entityType;
        throw new Error(`Unhandled detected entity type: ${unhandledEntityType}`);
      }
    }
  }

  /** Shows a link, which links to an anchor or a reference of the message when it names one. */
  #projectLink(linkText: RichText, url: string): BotApiRichTextObject {
    const text = this.#projectText(linkText);
    if (url.startsWith(ANCHOR_LINK_URL_PREFIX)) {
      const encodedName = url.slice(ANCHOR_LINK_URL_PREFIX.length);
      for (const name of [encodedName, decodeTdlibUrl(encodedName)]) {
        switch (this.#anchorTargets.get(name)) {
          case 'anchor':
            return { type: 'anchor_link', text, anchor_name: name };
          case 'reference':
            return { type: 'reference_link', text, reference_name: name };
          case undefined:
            break;
        }
      }
    }
    return { type: 'url', text, url };
  }
}

/** Removes a leading character, as TDLib's `trim_first` does. */
function removeFirstCharacter(text: string, character: string): string {
  return text.startsWith(character) ? text.slice(character.length) : text;
}

/**
 * Decodes `%` and two hexadecimal digits into a byte, as TDLib's `url_decode` does without
 * decoding `+`, and reads the bytes as UTF-8.
 */
function decodeTdlibUrl(url: string): string {
  const encodedBytes = new TextEncoder().encode(url);
  const decodedBytes: number[] = [];
  for (let index = 0; index < encodedBytes.length; index++) {
    const byte = encodedBytes[index];
    if (byte === 0x25 && index + 2 < encodedBytes.length) {
      const high = hexDigitValue(encodedBytes[index + 1]);
      const low = hexDigitValue(encodedBytes[index + 2]);
      if (high !== undefined && low !== undefined) {
        decodedBytes.push(high * 16 + low);
        index += 2;
        continue;
      }
    }
    decodedBytes.push(byte);
  }
  return new TextDecoder().decode(new Uint8Array(decodedBytes));
}

function hexDigitValue(byte: number): number | undefined {
  const digit = parseInt(String.fromCharCode(byte), 16);
  return Number.isNaN(digit) ? undefined : digit;
}

/**
 * The label TDLib's `get_ordered_list_label` gives an item of an ordered list: letters for a
 * positive number shown as letters, Roman numerals for one from 1 to 3999 shown as numerals, and
 * otherwise the decimal number; each followed by a dot.
 */
function getOrderedListItemLabel({ value, labelType }: OrderedListItemNumber): string {
  if ((labelType === 'a' || labelType === 'A') && value > 0) {
    // Bijective base 26: A to Z, then AA.
    let letters = '';
    let remaining = value;
    while (remaining > 0) {
      const letterIndex = (remaining - 1) % 26;
      letters = String.fromCharCode(0x41 + letterIndex) + letters;
      remaining = (remaining - 1 - letterIndex) / 26;
    }
    return `${labelType === 'a' ? letters.toLowerCase() : letters}.`;
  }
  if ((labelType === 'i' || labelType === 'I') && value > 0 && value < 4000) {
    const numerals = toRomanNumerals(value);
    return `${labelType === 'i' ? numerals.toLowerCase() : numerals}.`;
  }
  return `${value}.`;
}

const ROMAN_NUMERAL_VALUES: ReadonlyArray<readonly [string, number]> = [
  ['M', 1000],
  ['CM', 900],
  ['D', 500],
  ['CD', 400],
  ['C', 100],
  ['XC', 90],
  ['L', 50],
  ['XL', 40],
  ['X', 10],
  ['IX', 9],
  ['V', 5],
  ['IV', 4],
  ['I', 1],
];

function toRomanNumerals(value: number): string {
  let numerals = '';
  let remaining = value;
  for (const [numeral, numeralValue] of ROMAN_NUMERAL_VALUES) {
    while (remaining >= numeralValue) {
      numerals += numeral;
      remaining -= numeralValue;
    }
  }
  return numerals;
}
