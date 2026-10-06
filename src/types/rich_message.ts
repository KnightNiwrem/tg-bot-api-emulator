import type { ButtonAppearance, ButtonStyle } from './button_appearance.ts';
import type { GeoLocation } from './geo_location.ts';
import type { InlineKeyboardButton } from './inline_keyboard.ts';
import type { StoredFileId } from './stored_file.ts';
import type { DateTimeFormat } from './virtual_message.ts';

/**
 * A rich message: text laid out in blocks, such as paragraphs, lists, tables, and media, as
 * TDLib's `RichMessage` holds a message a bot sends as blocks. Rich text in the blocks keeps the
 * structure that TDLib's `RichText` gives it, from which the Bot API's `RichMessage` is shown.
 */
export interface RichMessage<Files extends RichMessageFileTypes = StoredRichMessageFileTypes> {
  readonly blocks: readonly RichBlock<Files>[];
  /** Whether clients show the message right-to-left. */
  readonly isRightToLeft: boolean;
}

/**
 * How the media blocks of a rich message refer to their files, by the kind of file each block
 * shows, which changes as the message is sent: from the files a request names, to files ready to
 * store, to stored files.
 */
export interface RichMessageFileTypes {
  readonly photo: unknown;
  readonly document: unknown;
  readonly video: unknown;
  readonly voice: unknown;
}

/** The files of a rich message that a message holds. */
export interface StoredRichMessageFileTypes {
  readonly photo: StoredFileId;
  readonly document: StoredFileId;
  readonly video: StoredFileId;
  readonly voice: StoredFileId;
}

/** Formatting that shows rich text differently without attaching anything to it. */
export type RichTextStyle =
  | 'bold'
  | 'italic'
  | 'underline'
  | 'strikethrough'
  | 'spoiler'
  | 'subscript'
  | 'superscript'
  | 'marked'
  /** Monowidth text, which TDLib calls fixed. */
  | 'code';

/**
 * The entities Telegram marks in rich text by itself. Each shows what the text it covers says: a
 * mention of a username, a hashtag, a cashtag, a bot command, a URL, an email address, or a bank
 * card number.
 */
export type DetectedRichTextEntityType =
  | 'mention'
  | 'hashtag'
  | 'cashtag'
  | 'bot_command'
  | 'url'
  | 'email_address'
  | 'bank_card_number';

/** Unformatted text; empty text shows nothing. */
export interface PlainRichText {
  readonly kind: 'plain';
  readonly text: string;
}

/** Rich texts shown one after another. */
export interface RichTextConcatenation {
  readonly kind: 'concatenation';
  readonly texts: readonly RichText[];
}

export interface StyledRichText {
  readonly kind: 'styled';
  readonly style: RichTextStyle;
  readonly text: RichText;
}

/** A date and time that clients show in each reader's time zone. */
export interface DateTimeRichText {
  readonly kind: 'date_time';
  readonly text: RichText;
  /** The shown moment in Unix seconds, which Telegram requires to be positive. */
  readonly unixTime: number;
  /** Omitted when the sender chose no format. */
  readonly format?: DateTimeFormat;
}

/** A mention of a user by ID. */
export interface TextMentionRichText {
  readonly kind: 'text_mention';
  readonly text: RichText;
  readonly userId: number;
}

/**
 * Text that opens a URL. The Bot API shows a URL of `#` and the name of an anchor or a reference of
 * the message as a link to it.
 */
export interface LinkRichText {
  readonly kind: 'link';
  readonly text: RichText;
  readonly url: string;
}

/**
 * Text that links to an anchor or a reference of the message by its name, which TDLib keeps as the
 * link of the URL that `getRichMessageAnchorLinkUrl` gives. Whether it links to an anchor or a
 * reference, or to neither, depends on the message.
 */
export interface AnchorLinkRichText {
  readonly kind: 'anchor_link';
  readonly text: RichText;
  /** The name of the anchor or reference; empty for the top of the message. */
  readonly targetName: string;
}

export interface EmailAddressRichText {
  readonly kind: 'email_address';
  readonly text: RichText;
  readonly emailAddress: string;
}

export interface PhoneNumberRichText {
  readonly kind: 'phone_number';
  readonly text: RichText;
  readonly phoneNumber: string;
}

export interface CustomEmojiRichText {
  readonly kind: 'custom_emoji';
  /** Telegram's decimal text form of the custom emoji's 64-bit identifier. */
  readonly customEmojiId: string;
  /** The emoji clients show in place of the custom emoji. */
  readonly alternativeText: string;
}

export interface MathematicalExpressionRichText {
  readonly kind: 'mathematical_expression';
  /** The expression in LaTeX. */
  readonly expression: string;
}

/** An invisible target of anchor links. */
export interface AnchorRichText {
  readonly kind: 'anchor';
  readonly name: string;
}

/** Text that is the target of reference links, such as a footnote. Its text is never empty. */
export interface ReferenceRichText {
  readonly kind: 'reference';
  readonly name: string;
  readonly text: RichText;
}

/** Text in which Telegram detected an entity. */
export interface DetectedEntityRichText {
  readonly kind: 'detected_entity';
  readonly entityType: DetectedRichTextEntityType;
  readonly text: RichText;
}

export interface ButtonRichText {
  readonly kind: 'button';
  readonly button: RichMessageButton;
}

/** Text of a rich message, which may nest formatting, links, and buttons. */
export type RichText =
  | PlainRichText
  | RichTextConcatenation
  | StyledRichText
  | DateTimeRichText
  | TextMentionRichText
  | LinkRichText
  | AnchorLinkRichText
  | EmailAddressRichText
  | PhoneNumberRichText
  | CustomEmojiRichText
  | MathematicalExpressionRichText
  | AnchorRichText
  | ReferenceRichText
  | DetectedEntityRichText
  | ButtonRichText;

/** The empty text that TDLib reads for rich text a sender leaves out. */
export const EMPTY_RICH_TEXT: PlainRichText = { kind: 'plain', text: '' };

/** Whether rich text is the empty text, which TDLib's `RichText::empty` checks. */
export function isEmptyRichText(text: RichText): boolean {
  return text.kind === 'plain' && text.text.length === 0;
}

/** Removes properties from each member of a union, which keeps the union's alternatives apart. */
type OmitFromEach<Type, Key extends PropertyKey> = Type extends unknown ? Omit<Type, Key> : never;

/** What a button of a rich message does, as an inline keyboard button of the same kind does it. */
export type RichMessageButtonAction = OmitFromEach<
  InlineKeyboardButton,
  'text' | keyof ButtonAppearance
>;

/**
 * A button color that clients show instead of their default one, or `link`, which shows the
 * button as a link without borders.
 */
export type RichMessageButtonStyle = ButtonStyle | 'link';

/** A button of a rich message, in a row of buttons or in its text. */
export interface RichMessageButton {
  readonly text: RichText;
  /** Omitted for the client's default style. */
  readonly style?: RichMessageButtonStyle;
  readonly action: RichMessageButtonAction;
}

export type HorizontalAlignment = 'left' | 'center' | 'right';

export type VerticalAlignment = 'top' | 'middle' | 'bottom';

/** A caption of a block with media or a map. Its text and credit are not both empty. */
export interface RichBlockCaption {
  readonly text: RichText;
  /** Omitted for no credit. */
  readonly credit?: RichText;
}

/** The labels of the items of an ordered list: letters, Roman numerals, or decimal numbers. */
export type OrderedListItemLabelType = 'a' | 'A' | 'i' | 'I' | '1';

/** The number an item of an ordered list shows, in the type of label it shows it as. */
export interface OrderedListItemNumber {
  readonly value: number;
  readonly labelType: OrderedListItemLabelType;
}

export interface RichListItem<Files extends RichMessageFileTypes = StoredRichMessageFileTypes> {
  /**
   * Never empty: as TDLib does for an item Telegram sends without content, an item without blocks
   * holds an empty paragraph.
   */
  readonly blocks: readonly RichBlock<Files>[];
  readonly hasCheckbox: boolean;
  /** Whether the item's checkbox is checked; only an item with a checkbox is. */
  readonly isChecked: boolean;
  /** Omitted for an item of an unordered list. */
  readonly number?: OrderedListItemNumber;
}

export interface RichTableCell {
  /** Omitted for an invisible cell. */
  readonly text?: RichText;
  readonly isHeader: boolean;
  /** How many columns the cell spans; at least 1. */
  readonly columnSpan: number;
  /** How many rows the cell spans; at least 1. */
  readonly rowSpan: number;
  readonly alignment: HorizontalAlignment;
  readonly verticalAlignment: VerticalAlignment;
}

export interface RichParagraphBlock {
  readonly kind: 'paragraph';
  readonly text: RichText;
}

export interface RichHeadingBlock {
  readonly kind: 'heading';
  readonly text: RichText;
  /** The relative font size, from 1, the largest, to 6. */
  readonly size: number;
}

export interface RichPreformattedBlock {
  readonly kind: 'preformatted';
  readonly text: RichText;
  /** The programming language of the text; omitted for none. */
  readonly language?: string;
}

export interface RichFooterBlock {
  readonly kind: 'footer';
  readonly text: RichText;
}

export interface RichDividerBlock {
  readonly kind: 'divider';
}

export interface RichMathematicalExpressionBlock {
  readonly kind: 'mathematical_expression';
  /** The expression in LaTeX. */
  readonly expression: string;
}

/** An invisible target of anchor links. */
export interface RichAnchorBlock {
  readonly kind: 'anchor';
  readonly name: string;
}

/** A list whose items are all ordered, or all unordered. */
export interface RichListBlock<Files extends RichMessageFileTypes = StoredRichMessageFileTypes> {
  readonly kind: 'list';
  /** At least one item. */
  readonly items: readonly RichListItem<Files>[];
}

export interface RichBlockQuotationBlock<
  Files extends RichMessageFileTypes = StoredRichMessageFileTypes,
> {
  readonly kind: 'blockquote';
  readonly blocks: readonly RichBlock<Files>[];
  /** Omitted for no credit. */
  readonly credit?: RichText;
}

export interface RichExpandableBlockQuotationBlock {
  readonly kind: 'expandable_blockquote';
  readonly text: RichText;
  /** Omitted for no credit. */
  readonly credit?: RichText;
}

/** A quotation with centered text. */
export interface RichPullQuotationBlock {
  readonly kind: 'pullquote';
  readonly text: RichText;
  /** Omitted for no credit. */
  readonly credit?: RichText;
}

/** Blocks shown together as a collage or one after another as a slideshow. */
export interface RichMediaGroupBlock<
  Files extends RichMessageFileTypes = StoredRichMessageFileTypes,
> {
  readonly kind: 'collage' | 'slideshow';
  readonly blocks: readonly RichBlock<Files>[];
  /** Omitted for no caption. */
  readonly caption?: RichBlockCaption;
}

export interface RichTableBlock {
  readonly kind: 'table';
  readonly rows: readonly (readonly RichTableCell[])[];
  /** Omitted for no caption. */
  readonly caption?: RichText;
  readonly isBordered: boolean;
  readonly isStriped: boolean;
  /** Whether the cells have smaller indents. */
  readonly isCompact: boolean;
}

/** Blocks that clients show below an always visible summary once the user expands them. */
export interface RichDetailsBlock<Files extends RichMessageFileTypes = StoredRichMessageFileTypes> {
  readonly kind: 'details';
  readonly summary: RichText;
  readonly blocks: readonly RichBlock<Files>[];
  /** Whether the blocks are visible before the user expands them. */
  readonly isOpen: boolean;
}

/** A map centered on a location. */
export interface RichMapBlock {
  readonly kind: 'map';
  readonly location: GeoLocation;
  /** From 0 to 24. */
  readonly zoom: number;
  /** The width and height clients show the map in, both 0 when the sender chose none. */
  readonly width: number;
  readonly height: number;
  /** Omitted for no caption. */
  readonly caption?: RichBlockCaption;
}

/** A row of buttons. */
export interface RichButtonRowBlock {
  readonly kind: 'buttons';
  /** At least one button. */
  readonly buttons: readonly RichMessageButton[];
  /** Omitted for the client's default alignment. */
  readonly alignment?: HorizontalAlignment;
}

export interface RichPhotoBlock<Files extends RichMessageFileTypes = StoredRichMessageFileTypes> {
  readonly kind: 'photo';
  readonly photo: Files['photo'];
  /** Whether clients cover the photo until the user reveals it. */
  readonly hasSpoiler: boolean;
  /** Omitted for no caption. */
  readonly caption?: RichBlockCaption;
}

export interface RichDocumentBlock<
  Files extends RichMessageFileTypes = StoredRichMessageFileTypes,
> {
  readonly kind: 'document';
  readonly document: Files['document'];
  /** Omitted for no caption. */
  readonly caption?: RichBlockCaption;
}

/**
 * A video block. As TDLib's `WebPageBlockVideo` keeps it, the block holds only the video: the
 * start timestamp of the sender's media is dropped, and clients neither play it automatically nor
 * loop it.
 */
export interface RichVideoBlock<Files extends RichMessageFileTypes = StoredRichMessageFileTypes> {
  readonly kind: 'video';
  readonly video: Files['video'];
  /** Whether clients cover the video until the user reveals it. */
  readonly hasSpoiler: boolean;
  /** Omitted for no caption. */
  readonly caption?: RichBlockCaption;
}

export interface RichVoiceNoteBlock<
  Files extends RichMessageFileTypes = StoredRichMessageFileTypes,
> {
  readonly kind: 'voice_note';
  readonly voiceNote: Files['voice'];
  /** Omitted for no caption. */
  readonly caption?: RichBlockCaption;
}

/** A block of a rich message. */
export type RichBlock<Files extends RichMessageFileTypes = StoredRichMessageFileTypes> =
  | RichParagraphBlock
  | RichHeadingBlock
  | RichPreformattedBlock
  | RichFooterBlock
  | RichDividerBlock
  | RichMathematicalExpressionBlock
  | RichAnchorBlock
  | RichListBlock<Files>
  | RichBlockQuotationBlock<Files>
  | RichExpandableBlockQuotationBlock
  | RichPullQuotationBlock
  | RichMediaGroupBlock<Files>
  | RichTableBlock
  | RichDetailsBlock<Files>
  | RichMapBlock
  | RichButtonRowBlock
  | RichPhotoBlock<Files>
  | RichDocumentBlock<Files>
  | RichVideoBlock<Files>
  | RichVoiceNoteBlock<Files>;

/** A file of a rich message's media block, with the kind of file the block shows. */
export type RichMessageFile<Files extends RichMessageFileTypes = StoredRichMessageFileTypes> =
  | { readonly kind: 'photo'; readonly file: Files['photo'] }
  | { readonly kind: 'document'; readonly file: Files['document'] }
  | { readonly kind: 'video'; readonly file: Files['video'] }
  | { readonly kind: 'voice'; readonly file: Files['voice'] };

/** Lists the files of a rich message's media blocks in the order the message shows them. */
export function listRichMessageFiles<Files extends RichMessageFileTypes>(
  richMessage: RichMessage<Files>,
): RichMessageFile<Files>[] {
  const files: RichMessageFile<Files>[] = [];
  const visitBlocks = (blocks: readonly RichBlock<Files>[]): void => {
    for (const block of blocks) {
      switch (block.kind) {
        case 'photo':
          files.push({ kind: 'photo', file: block.photo });
          break;
        case 'document':
          files.push({ kind: 'document', file: block.document });
          break;
        case 'video':
          files.push({ kind: 'video', file: block.video });
          break;
        case 'voice_note':
          files.push({ kind: 'voice', file: block.voiceNote });
          break;
        default:
          forEachNestedBlockList(block, visitBlocks);
      }
    }
  };
  visitBlocks(richMessage.blocks);
  return files;
}

/** Converts the files of a rich message's media blocks, keeping everything else. */
export interface RichMessageFileConversion<
  From extends RichMessageFileTypes,
  To extends RichMessageFileTypes,
> {
  photo(file: From['photo']): To['photo'];
  document(file: From['document']): To['document'];
  video(file: From['video']): To['video'];
  voice(file: From['voice']): To['voice'];
}

/** Returns a rich message whose media blocks hold converted files. */
export function convertRichMessageFiles<
  From extends RichMessageFileTypes,
  To extends RichMessageFileTypes,
>(
  richMessage: RichMessage<From>,
  conversion: RichMessageFileConversion<From, To>,
): RichMessage<To> {
  const convertBlocks = (blocks: readonly RichBlock<From>[]): RichBlock<To>[] =>
    blocks.map((block): RichBlock<To> => {
      switch (block.kind) {
        case 'photo':
          return { ...block, photo: conversion.photo(block.photo) };
        case 'document':
          return { ...block, document: conversion.document(block.document) };
        case 'video':
          return { ...block, video: conversion.video(block.video) };
        case 'voice_note':
          return { ...block, voiceNote: conversion.voice(block.voiceNote) };
        case 'list':
          return {
            ...block,
            items: block.items.map((item) => ({ ...item, blocks: convertBlocks(item.blocks) })),
          };
        case 'blockquote':
        case 'collage':
        case 'slideshow':
        case 'details':
          return { ...block, blocks: convertBlocks(block.blocks) };
        default:
          return block;
      }
    });
  return { ...richMessage, blocks: convertBlocks(richMessage.blocks) };
}

/**
 * Returns a rich message whose blocks, nested ones included, are replaced by `replaceBlock`, which
 * receives each block after the blocks it holds were replaced.
 */
export function mapRichBlocks<Files extends RichMessageFileTypes>(
  richMessage: RichMessage<Files>,
  replaceBlock: (block: RichBlock<Files>) => RichBlock<Files>,
): RichMessage<Files> {
  const mapBlocks = (blocks: readonly RichBlock<Files>[]): RichBlock<Files>[] =>
    blocks.map((block) => {
      switch (block.kind) {
        case 'list':
          return replaceBlock({
            ...block,
            items: block.items.map((item) => ({ ...item, blocks: mapBlocks(item.blocks) })),
          });
        case 'blockquote':
        case 'collage':
        case 'slideshow':
        case 'details':
          return replaceBlock({ ...block, blocks: mapBlocks(block.blocks) });
        default:
          return replaceBlock(block);
      }
    });
  return { ...richMessage, blocks: mapBlocks(richMessage.blocks) };
}

/**
 * Where a rich text of a rich message is shown: in the text of a preformatted block, as the text
 * of a button in a row of buttons, or anywhere else.
 */
export type RichTextPlacement = 'preformatted_block' | 'button_row' | 'other';

/**
 * Returns a rich message whose rich texts are replaced by `replaceText`, which each top-level rich
 * text of a block, caption, cell, or button of a row passes through with where it is shown;
 * `replaceText` handles nested text.
 */
export function mapRichMessageTexts<Files extends RichMessageFileTypes>(
  richMessage: RichMessage<Files>,
  replaceText: (text: RichText, placement: RichTextPlacement) => RichText,
): RichMessage<Files> {
  const mapText = (text: RichText) => replaceText(text, 'other');
  const mapCaption = (caption: RichBlockCaption): RichBlockCaption => ({
    text: mapText(caption.text),
    ...(caption.credit === undefined ? {} : { credit: mapText(caption.credit) }),
  });
  const mapBlocks = (blocks: readonly RichBlock<Files>[]): RichBlock<Files>[] =>
    blocks.map((block): RichBlock<Files> => {
      switch (block.kind) {
        case 'paragraph':
        case 'heading':
        case 'footer':
          return { ...block, text: mapText(block.text) };
        case 'preformatted':
          return { ...block, text: replaceText(block.text, 'preformatted_block') };
        case 'expandable_blockquote':
        case 'pullquote':
          return {
            ...block,
            text: mapText(block.text),
            ...(block.credit === undefined ? {} : { credit: mapText(block.credit) }),
          };
        case 'list':
          return {
            ...block,
            items: block.items.map((item) => ({ ...item, blocks: mapBlocks(item.blocks) })),
          };
        case 'blockquote':
          return {
            ...block,
            blocks: mapBlocks(block.blocks),
            ...(block.credit === undefined ? {} : { credit: mapText(block.credit) }),
          };
        case 'collage':
        case 'slideshow':
          return {
            ...block,
            blocks: mapBlocks(block.blocks),
            ...(block.caption === undefined ? {} : { caption: mapCaption(block.caption) }),
          };
        case 'table':
          return {
            ...block,
            rows: block.rows.map((row) =>
              row.map((cell) =>
                cell.text === undefined ? cell : { ...cell, text: mapText(cell.text) }
              )
            ),
            ...(block.caption === undefined ? {} : { caption: mapText(block.caption) }),
          };
        case 'details':
          return { ...block, summary: mapText(block.summary), blocks: mapBlocks(block.blocks) };
        case 'map':
        case 'photo':
        case 'document':
        case 'video':
        case 'voice_note':
          return block.caption === undefined
            ? block
            : { ...block, caption: mapCaption(block.caption) };
        case 'buttons':
          return {
            ...block,
            buttons: block.buttons.map((button) => ({
              ...button,
              text: replaceText(button.text, 'button_row'),
            })),
          };
        case 'divider':
        case 'mathematical_expression':
        case 'anchor':
          return block;
        default: {
          const unhandledBlock: never = block;
          throw new Error(`Unhandled rich block: ${JSON.stringify(unhandledBlock)}`);
        }
      }
    });
  return { ...richMessage, blocks: mapBlocks(richMessage.blocks) };
}

/**
 * Calls `visit` with every rich text of a rich message and every text nested in it, parents before
 * their parts, in the order the message shows them.
 */
export function forEachRichText<Files extends RichMessageFileTypes>(
  richMessage: RichMessage<Files>,
  visit: (text: RichText) => void,
): void {
  const visitText = (text: RichText): RichText => {
    visit(text);
    forEachNestedRichText(text, visitText);
    return text;
  };
  mapRichMessageTexts(richMessage, visitText);
}

/** Calls `visit` with the texts a rich text directly holds, including a button's text. */
function forEachNestedRichText(text: RichText, visit: (nestedText: RichText) => void): void {
  switch (text.kind) {
    case 'concatenation':
      text.texts.forEach(visit);
      break;
    case 'styled':
    case 'date_time':
    case 'text_mention':
    case 'link':
    case 'anchor_link':
    case 'email_address':
    case 'phone_number':
    case 'reference':
    case 'detected_entity':
      visit(text.text);
      break;
    case 'button':
      visit(text.button.text);
      break;
    case 'plain':
    case 'custom_emoji':
    case 'mathematical_expression':
    case 'anchor':
      break;
    default: {
      const unhandledText: never = text;
      throw new Error(`Unhandled rich text: ${JSON.stringify(unhandledText)}`);
    }
  }
}

/** Lists the buttons of a rich message: those of button rows and those in its text. */
export function listRichMessageButtons<Files extends RichMessageFileTypes>(
  richMessage: RichMessage<Files>,
): RichMessageButton[] {
  const buttons: RichMessageButton[] = [];
  const visitBlocks = (blocks: readonly RichBlock<Files>[]): void => {
    for (const block of blocks) {
      if (block.kind === 'buttons') {
        buttons.push(...block.buttons);
      }
      forEachNestedBlockList(block, visitBlocks);
    }
  };
  visitBlocks(richMessage.blocks);
  forEachRichText(richMessage, (text) => {
    if (text.kind === 'button') {
      buttons.push(text.button);
    }
  });
  return buttons;
}

/** Returns a rich message whose buttons, in rows and in its text, are replaced by `replace`. */
export function mapRichMessageButtons<Files extends RichMessageFileTypes>(
  richMessage: RichMessage<Files>,
  replace: (button: RichMessageButton) => RichMessageButton,
): RichMessage<Files> {
  const replaceInText = (text: RichText): RichText =>
    text.kind === 'button'
      ? {
        kind: 'button',
        button: replace({ ...text.button, text: replaceInText(text.button.text) }),
      }
      : mapRichTextParts(text, replaceInText);
  const withReplacedRows = mapRichBlocks(
    richMessage,
    (block) => block.kind === 'buttons' ? { ...block, buttons: block.buttons.map(replace) } : block,
  );
  return mapRichMessageTexts(withReplacedRows, replaceInText);
}

/**
 * Returns a rich text whose directly held texts are replaced by `mapText`; a button's text is left
 * to the caller, which decides how buttons change.
 */
export function mapRichTextParts(text: RichText, mapText: (text: RichText) => RichText): RichText {
  switch (text.kind) {
    case 'concatenation':
      return { ...text, texts: text.texts.map(mapText) };
    case 'styled':
    case 'date_time':
    case 'text_mention':
    case 'link':
    case 'anchor_link':
    case 'email_address':
    case 'phone_number':
    case 'reference':
    case 'detected_entity':
      return { ...text, text: mapText(text.text) };
    case 'plain':
    case 'custom_emoji':
    case 'mathematical_expression':
    case 'anchor':
    case 'button':
      return text;
    default: {
      const unhandledText: never = text;
      throw new Error(`Unhandled rich text: ${JSON.stringify(unhandledText)}`);
    }
  }
}

/**
 * The text a rich text shows, as TDLib's `RichText::get_full_text` joins it: plain text, the
 * source of mathematical expressions, and the alternative text of custom emoji.
 */
export function getRichTextFullText(text: RichText): string {
  switch (text.kind) {
    case 'plain':
      return text.text;
    case 'mathematical_expression':
      return text.expression;
    case 'custom_emoji':
      return text.alternativeText;
    default: {
      let fullText = '';
      forEachNestedRichText(text, (nestedText) => {
        fullText += getRichTextFullText(nestedText);
      });
      return fullText;
    }
  }
}

/**
 * The URL of a link to an anchor or a reference of a rich message, as TDLib's `RichText` keeps
 * it: `#` followed by the name, URL-encoded as TDLib's `url_encode` does.
 */
export function getRichMessageAnchorLinkUrl(anchorName: string): string {
  let url = '#';
  for (const byte of new TextEncoder().encode(anchorName)) {
    const character = String.fromCharCode(byte);
    url += /^[A-Za-z0-9\-._~]$/.test(character)
      ? character
      : `%${byte.toString(16).toUpperCase().padStart(2, '0')}`;
  }
  return url;
}

/** The users that a rich message's text mentions by ID, in the order the message shows them. */
export function getRichMessageMentionedUserIds(richMessage: RichMessage): number[] {
  const userIds: number[] = [];
  forEachRichText(richMessage, (text) => {
    if (text.kind === 'text_mention') {
      userIds.push(text.userId);
    }
  });
  return userIds;
}

/**
 * Whether a rich message's text mentions a user: by a text mention of the user, or by a detected
 * mention of the user's username, ignoring letter case.
 */
export function richMessageMentionsUser(
  richMessage: RichMessage,
  user: { readonly id: number; readonly username?: string },
): boolean {
  const username = user.username?.toLowerCase();
  let mentionsUser = false;
  forEachRichText(richMessage, (text) => {
    if (text.kind === 'text_mention' && text.userId === user.id) {
      mentionsUser = true;
    } else if (
      text.kind === 'detected_entity' && text.entityType === 'mention' && username !== undefined &&
      getRichTextFullText(text.text).slice(1).toLowerCase() === username
    ) {
      mentionsUser = true;
    }
  });
  return mentionsUser;
}

/** How a message is repeated: forwarded with its origin, or copied as a new message. */
export type MessageRepetition = 'forward' | 'copy';

/**
 * The rich message that a forward or copy of it shows, as TDLib's `InlineKeyboardButton::clone`
 * decides for a rich message's buttons: URL and copy-text buttons keep working, and so does a
 * login button in a forward, which shows its forward text instead of its text when it has one. A
 * copy's login button becomes a URL button that opens its URL without authorizing the user. Every
 * other button keeps its text and style but does nothing. The emulator's rich messages are never
 * sent through an inline bot, whose switch-inline buttons forwards would keep.
 */
export function repeatRichMessage(
  richMessage: RichMessage,
  repetition: MessageRepetition,
): RichMessage {
  return mapRichMessageButtons(richMessage, (button) => {
    const { action } = button;
    switch (action.kind) {
      case 'url':
      case 'copy_text':
        return button;
      case 'login_url': {
        if (repetition === 'copy') {
          return { ...button, action: { kind: 'url', url: action.url } };
        }
        const { forwardText, ...forwardedAction } = action;
        return {
          ...button,
          ...(forwardText === undefined ? {} : { text: { kind: 'plain', text: forwardText } }),
          action: forwardedAction,
        };
      }
      case 'callback':
      case 'switch_inline_query':
      case 'web_app':
      case 'disabled':
        return { ...button, action: { kind: 'disabled' } };
      default: {
        const unhandledAction: never = action;
        throw new Error(`Unhandled rich message button: ${JSON.stringify(unhandledAction)}`);
      }
    }
  });
}

/** Calls `visit` with each list of blocks that a block holds. */
function forEachNestedBlockList<Files extends RichMessageFileTypes>(
  block: RichBlock<Files>,
  visit: (blocks: readonly RichBlock<Files>[]) => void,
): void {
  switch (block.kind) {
    case 'list':
      block.items.forEach((item) => visit(item.blocks));
      break;
    case 'blockquote':
    case 'collage':
    case 'slideshow':
    case 'details':
      visit(block.blocks);
      break;
    default:
      break;
  }
}

/**
 * Whether two rich messages are the same, which an edit that changes nothing is refused for. The
 * messages are plain data, compared field by field whatever the order of their fields.
 */
export function areRichMessagesEqual(first: RichMessage, second: RichMessage): boolean {
  return isSameData(first, second);
}

function isSameData(first: unknown, second: unknown): boolean {
  if (first === second) {
    return true;
  }
  if (Array.isArray(first) || Array.isArray(second)) {
    return Array.isArray(first) && Array.isArray(second) && first.length === second.length &&
      first.every((element, index) => isSameData(element, second[index]));
  }
  if (!isDataObject(first) || !isDataObject(second)) {
    return false;
  }
  const firstKeys = Object.keys(first);
  return firstKeys.length === Object.keys(second).length &&
    firstKeys.every((key) => Object.hasOwn(second, key) && isSameData(first[key], second[key]));
}

function isDataObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}
