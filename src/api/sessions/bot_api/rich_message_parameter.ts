import { z } from 'zod';

import type { EmulationSession } from '../../../types/emulation_session.ts';
import {
  createGeoLocation,
  isPointOnEarth,
  MAX_HORIZONTAL_ACCURACY_METERS,
} from '../../../types/geo_location.ts';
import {
  EMPTY_RICH_TEXT,
  type HorizontalAlignment,
  isEmptyRichText,
  type OrderedListItemLabelType,
  type RichBlock,
  type RichBlockCaption,
  type RichListItem,
  type RichMessage,
  type RichMessageButton,
  type RichMessageButtonStyle,
  type RichTableCell,
  type RichText,
  type RichTextStyle,
  type VerticalAlignment,
} from '../../../types/rich_message.ts';
import { MAX_MEDIA_DURATION_SECONDS, MAX_VIDEO_SIDE_LENGTH } from '../../../types/stored_file.ts';
import { readInputFileParameter, readThumbnailParameter } from './input_file_parameter.ts';
import { clampedIntegerField } from './input_media_parameter.ts';
import { readDateTimeFormat } from './message_entities_parameter.ts';
import { buttonSchema } from './reply_markup_parameter.ts';
import type { BotApiUploadedFiles } from './request_parameters.ts';
import type { RequestedRichMessageFileTypes } from './web_file_parameter.ts';

/** A rich message as a bot specified it, with the files it names. */
type SpecifiedRichMessage =
  & Pick<Parameters<EmulationSession['botApi']['sendRichMessage']>[1], 'detectsEntities'>
  & { readonly richMessage: RichMessage<SpecifiedRichMessageFileTypes> };

type SpecifiedRichMessageFileTypes = RequestedRichMessageFileTypes;

type SpecifiedRichBlock = RichBlock<SpecifiedRichMessageFileTypes>;

export type RichMessageParameterReading =
  | ({ readonly read: true } & SpecifiedRichMessage)
  | { readonly read: false; readonly description: string };

/** Telegram's descriptions for a `rich_message` it cannot read. */
const RICH_MESSAGE_EMPTY_DESCRIPTION = 'Bad Request: rich message must be non-empty';
const RICH_MESSAGE_JSON_INVALID_DESCRIPTION = "Bad Request: can't parse rich message JSON object";
const RICH_MESSAGE_NOT_OBJECT_DESCRIPTION = 'Bad Request: object expected as rich message';
const BLOCK_NOT_OBJECT_DESCRIPTION = 'Bad Request: object expected as InputRichMessageBlock';
const LIST_ITEM_NOT_OBJECT_DESCRIPTION = 'Bad Request: object expected as InputRichBlockListItem';
const CAPTION_NOT_OBJECT_DESCRIPTION = 'Bad Request: richBlockCaption must be an object';
const TABLE_CELL_NOT_OBJECT_DESCRIPTION = 'Bad Request: richBlockTableCell must be an object';
const BUTTON_NOT_OBJECT_DESCRIPTION = 'Bad Request: inlineButton must be an Object';
const RICH_TEXT_INVALID_DESCRIPTION = 'Bad Request: invalid rich text specified';
const RICH_TEXT_TYPE_UNSUPPORTED_DESCRIPTION = 'Bad Request: unsupported rich text type';
const DATE_TIME_FORMAT_INVALID_DESCRIPTION = 'Bad Request: invalid date-time format specified';
const DATE_INVALID_DESCRIPTION = 'Bad Request: invalid date specified';
const CUSTOM_EMOJI_ID_INVALID_DESCRIPTION =
  'Bad Request: invalid custom emoji identifier specified';
const BUTTON_STYLE_INVALID_DESCRIPTION = 'Bad Request: invalid button style specified';
const HORIZONTAL_ALIGNMENT_INVALID_DESCRIPTION =
  'Bad Request: invalid horizontal alignment specified';
const VERTICAL_ALIGNMENT_INVALID_DESCRIPTION = 'Bad Request: invalid vertical alignment specified';
const HEADING_SIZE_INVALID_DESCRIPTION = 'Bad Request: invalid section heading size specified';
const LIST_EMPTY_DESCRIPTION = 'Bad Request: list must be non-empty';
const LIST_MIXED_DESCRIPTION = 'Bad Request: list must be either ordered or unordered';
const LIST_ITEM_TYPE_INVALID_DESCRIPTION = 'Bad Request: invalid list item type specified';
const TABLE_CELL_COLUMN_SPAN_INVALID_DESCRIPTION =
  'Bad Request: invalid table cell colspan specified';
const TABLE_CELL_ROW_SPAN_INVALID_DESCRIPTION = 'Bad Request: invalid table cell rowspan specified';
/** TDLib's description of coordinates that name no point on Earth, as `isPointOnEarth` decides. */
export const LOCATION_INVALID_DESCRIPTION = 'Bad Request: invalid location specified';
const MAP_PROPERTIES_INVALID_DESCRIPTION = 'Bad Request: invalid map properties specified';
const BUTTON_ROW_EMPTY_DESCRIPTION = 'Bad Request: button row must be non-empty';
const MEDIA_NOT_FOUND_DESCRIPTION = 'Bad Request: media not found';

/**
 * The emulator's descriptions for rich messages it does not support: messages written in HTML or
 * Markdown, which Telegram's servers parse by rules the open-source code does not contain, and
 * blocks with media the emulator lacks.
 */
const MARKUP_RICH_MESSAGE_UNSUPPORTED_DESCRIPTION =
  'Bad Request: rich messages written in HTML or Markdown are not supported';
const MEDIA_BLOCK_UNSUPPORTED_DESCRIPTION =
  'Bad Request: rich message blocks with an animation or an audio file are not supported';

/**
 * The emulator's descriptions for rich messages that break rules the Bot API documents and
 * Telegram's servers check by rules the open-source code does not contain.
 */
const THINKING_BLOCK_NOT_ALLOWED_DESCRIPTION =
  'Bad Request: thinking blocks can be used only in rich message drafts';
const BUTTON_ROW_TOO_LONG_DESCRIPTION = 'Bad Request: a button row can have at most 8 buttons';
const LINK_BUTTON_STYLE_NOT_ALLOWED_DESCRIPTION =
  'Bad Request: only callback buttons can have the link style';
const BUTTON_TEXT_FORMATTING_NOT_ALLOWED_DESCRIPTION =
  'Bad Request: button text can have only custom emoji and dates';

/** The Bot API's documented limit on the buttons of a row of a rich message. */
const MAX_BUTTON_ROW_LENGTH = 8;

/** TDLib's limits on a map's zoom and dimensions, from `get_web_page_blocks`. */
const MAX_MAP_ZOOM = 24;
const MAX_MAP_DIMENSION = 10_000;
const MAX_MAP_ASPECT_RATIO = 20;

/** Rich text types that only format the text they hold. */
const RICH_TEXT_STYLES: ReadonlyMap<string, RichTextStyle> = new Map([
  ['bold', 'bold'],
  ['italic', 'italic'],
  ['underline', 'underline'],
  ['strikethrough', 'strikethrough'],
  ['spoiler', 'spoiler'],
  ['subscript', 'subscript'],
  ['superscript', 'superscript'],
  ['marked', 'marked'],
  ['code', 'code'],
]);

const MEDIA_BLOCK_TYPES_UNSUPPORTED = ['animation', 'audio'] as const;

const ORDERED_LIST_ITEM_LABEL_TYPES = [
  'a',
  'A',
  'i',
  'I',
  '1',
] as const satisfies readonly OrderedListItemLabelType[];

/** A description with which reading a `rich_message` fails; only this module throws it. */
class RichMessageParameterError extends Error {
  readonly description: string;

  constructor(description: string) {
    super(description);
    this.description = description;
  }
}

/**
 * Reads a `rich_message` parameter as the official Bot API server's `get_input_rich_message`
 * reads it and TDLib's `RichMessage::get_rich_message` checks it, failing with Telegram's
 * description of the first fault. Only a message of blocks is supported.
 *
 * `invalidParametersDescription` answers JSON that Telegram would read leniently, such as unknown
 * fields, missing documented fields, or values of the wrong JSON type, which are rejected instead
 * to surface the bot's mistake in tests. The strings of the message are cleaned, and the entities
 * Telegram detects in its text are marked, when the message is sent.
 *
 * TDLib checks the blocks when it sends the message, after the Bot API server looks at the chat;
 * the emulator reads them in full first, so a request that also names an unknown chat fails for
 * its blocks.
 */
export function readRichMessageParameter(
  richMessageParameter: string | undefined,
  uploadedFiles: BotApiUploadedFiles,
  invalidParametersDescription: string,
): RichMessageParameterReading {
  try {
    const reader = new RichMessageReader(uploadedFiles, invalidParametersDescription);
    return { read: true, ...reader.readRichMessage(richMessageParameter ?? '') };
  } catch (error) {
    if (error instanceof RichMessageParameterError) {
      return { read: false, description: error.description };
    }
    throw error;
  }
}

const richMessageSchema = z.strictObject({
  blocks: z.array(z.unknown()).optional(),
  html: z.string().optional(),
  markdown: z.string().optional(),
  media: z.array(z.unknown()).optional(),
  is_rtl: z.boolean().default(false),
  skip_entity_detection: z.boolean().default(false),
});

const blockTypeSchema = z.looseObject({ type: z.string() });

// TDLib reads a missing `text` as empty text, as Telegram reads a missing field of most types;
// the emulator requires the fields the Bot API documents as required.
const textBlockSchema = z.strictObject({ type: z.string(), text: z.unknown() });
const headingBlockSchema = z.strictObject({ type: z.string(), text: z.unknown(), size: z.int() });
const preformattedBlockSchema = z.strictObject({
  type: z.string(),
  text: z.unknown(),
  language: z.string().default(''),
});
const dividerBlockSchema = z.strictObject({ type: z.string() });
const mathematicalExpressionBlockSchema = z.strictObject({
  type: z.string(),
  expression: z.string(),
});
const anchorBlockSchema = z.strictObject({ type: z.string(), name: z.string() });
const listBlockSchema = z.strictObject({ type: z.string(), items: z.array(z.unknown()) });
const listItemSchema = z.strictObject({
  blocks: z.array(z.unknown()),
  has_checkbox: z.boolean().default(false),
  is_checked: z.boolean().default(false),
  value: z.int().default(0),
  type: z.string().default(''),
});
const blockQuotationBlockSchema = z.strictObject({
  type: z.string(),
  blocks: z.array(z.unknown()),
  credit: z.unknown().optional(),
});
const quotationBlockSchema = z.strictObject({
  type: z.string(),
  text: z.unknown(),
  credit: z.unknown().optional(),
});
const mediaGroupBlockSchema = z.strictObject({
  type: z.string(),
  blocks: z.array(z.unknown()),
  caption: z.unknown().optional(),
});
const captionSchema = z.strictObject({ text: z.unknown(), credit: z.unknown().optional() });
const tableBlockSchema = z.strictObject({
  type: z.string(),
  cells: z.array(z.array(z.unknown())),
  caption: z.unknown().optional(),
  is_bordered: z.boolean().default(false),
  is_striped: z.boolean().default(false),
  is_compact: z.boolean().default(false),
});
const tableCellSchema = z.strictObject({
  text: z.unknown().optional(),
  is_header: z.boolean().default(false),
  colspan: z.int().default(0),
  rowspan: z.int().default(0),
  align: z.string().default(''),
  valign: z.string().default(''),
});
const detailsBlockSchema = z.strictObject({
  type: z.string(),
  summary: z.unknown(),
  blocks: z.array(z.unknown()),
  is_open: z.boolean().default(false),
});
// Telegram reads only the coordinates and accuracy of a `Location`.
const mapBlockSchema = z.strictObject({
  type: z.string(),
  location: z.strictObject({
    latitude: z.number(),
    longitude: z.number(),
    horizontal_accuracy: z.number().default(0),
  }),
  zoom: z.int().default(0),
  width: z.int().default(0),
  height: z.int().default(0),
  caption: z.unknown().optional(),
});
const buttonRowBlockSchema = z.strictObject({
  type: z.string(),
  buttons: z.array(z.unknown()),
  align: z.string().default(''),
});
// Telegram ignores the caption of a block's media, which the emulator validates and ignores too.
const inputMediaCaptionShape = {
  caption: z.string().optional(),
  parse_mode: z.string().optional(),
  caption_entities: z.array(z.unknown()).optional(),
};
const photoBlockSchema = z.strictObject({
  type: z.string(),
  photo: z.strictObject({
    type: z.string(),
    media: z.string().default(''),
    ...inputMediaCaptionShape,
    show_caption_above_media: z.boolean().optional(),
    has_spoiler: z.boolean().default(false),
  }),
  caption: z.unknown().optional(),
});
// The emulator never detects other media types in documents, so
// `disable_content_type_detection` is validated and ignored.
const documentBlockSchema = z.strictObject({
  type: z.string(),
  document: z.strictObject({
    type: z.string(),
    media: z.string().default(''),
    thumbnail: z.string().optional(),
    thumb: z.string().optional(),
    ...inputMediaCaptionShape,
    disable_content_type_detection: z.boolean().optional(),
  }),
  caption: z.unknown().optional(),
});
// As for `sendVideo`, `supports_streaming` is validated and ignored, and a cover is not supported.
// TDLib's `WebPageBlockVideo` keeps only the video, so the start timestamp is validated and
// ignored as well.
const videoBlockSchema = z.strictObject({
  type: z.string(),
  video: z.strictObject({
    type: z.string(),
    media: z.string().default(''),
    thumbnail: z.string().optional(),
    thumb: z.string().optional(),
    start_timestamp: z.int().optional(),
    ...inputMediaCaptionShape,
    show_caption_above_media: z.boolean().optional(),
    width: clampedIntegerField(0, MAX_VIDEO_SIDE_LENGTH),
    height: clampedIntegerField(0, MAX_VIDEO_SIDE_LENGTH),
    duration: clampedIntegerField(0, MAX_MEDIA_DURATION_SECONDS),
    supports_streaming: z.boolean().optional(),
    has_spoiler: z.boolean().default(false),
  }),
  caption: z.unknown().optional(),
});
const voiceNoteBlockSchema = z.strictObject({
  type: z.string(),
  voice_note: z.strictObject({
    type: z.string(),
    media: z.string().default(''),
    ...inputMediaCaptionShape,
    duration: clampedIntegerField(0, MAX_MEDIA_DURATION_SECONDS),
  }),
  caption: z.unknown().optional(),
});

const styledTextSchema = z.strictObject({ type: z.string(), text: z.unknown() });
// Telegram reads the Unix time as a 32-bit integer.
const dateTimeTextSchema = z.strictObject({
  type: z.string(),
  text: z.unknown(),
  unix_time: z.int().min(-(2 ** 31)).max(2 ** 31 - 1),
  date_time_format: z.string().default(''),
});
// Telegram reads only the mentioned user's ID, so a full user from a received message is accepted.
const textMentionTextSchema = z.strictObject({
  type: z.string(),
  text: z.unknown(),
  user: z.looseObject({ id: z.int() }),
});
/**
 * Rich text of the entities that Telegram detects by itself, with the field that shows what each
 * entity says. As TDLib's `RichText::get_rich_text` does, a sender's entity of these types keeps
 * only its text, in which Telegram detects entities again, so rich text received in a message can
 * be sent back.
 */
const DETECTED_ENTITY_TEXT_SCHEMAS: ReadonlyMap<string, z.ZodType<{ readonly text: unknown }>> =
  new Map<string, z.ZodType<{ readonly text: unknown }>>([
    [
      'mention',
      z.strictObject({ type: z.string(), text: z.unknown(), username: z.string().optional() }),
    ],
    [
      'hashtag',
      z.strictObject({ type: z.string(), text: z.unknown(), hashtag: z.string().optional() }),
    ],
    [
      'cashtag',
      z.strictObject({ type: z.string(), text: z.unknown(), cashtag: z.string().optional() }),
    ],
    [
      'bot_command',
      z.strictObject({ type: z.string(), text: z.unknown(), bot_command: z.string().optional() }),
    ],
    [
      'bank_card_number',
      z.strictObject({
        type: z.string(),
        text: z.unknown(),
        bank_card_number: z.string().optional(),
      }),
    ],
  ]);
const urlTextSchema = z.strictObject({ type: z.string(), text: z.unknown(), url: z.string() });
const emailAddressTextSchema = z.strictObject({
  type: z.string(),
  text: z.unknown(),
  email_address: z.string(),
});
const phoneNumberTextSchema = z.strictObject({
  type: z.string(),
  text: z.unknown(),
  phone_number: z.string(),
});
const referenceTextSchema = z.strictObject({
  type: z.string(),
  text: z.unknown(),
  name: z.string(),
});
const referenceLinkTextSchema = z.strictObject({
  type: z.string(),
  text: z.unknown(),
  reference_name: z.string(),
});
const anchorLinkTextSchema = z.strictObject({
  type: z.string(),
  text: z.unknown(),
  anchor_name: z.string(),
});
const buttonTextSchema = z.strictObject({ type: z.string(), button: z.unknown() });
const customEmojiTextSchema = z.strictObject({
  type: z.string(),
  custom_emoji_id: z.string(),
  alternative_text: z.string(),
});

const richMessageButtonSchema = buttonSchema({
  text: z.unknown(),
  style: z.string().optional(),
});

/** Reads the parts of one `rich_message` parameter, throwing `RichMessageParameterError`. */
class RichMessageReader {
  readonly #uploadedFiles: BotApiUploadedFiles;
  readonly #invalidParametersDescription: string;

  constructor(uploadedFiles: BotApiUploadedFiles, invalidParametersDescription: string) {
    this.#uploadedFiles = uploadedFiles;
    this.#invalidParametersDescription = invalidParametersDescription;
  }

  /**
   * Reads the JSON object of an `InputRichMessage`. Telegram reads the first of `blocks`,
   * `markdown`, and `html` it finds; the emulator requires exactly one, as the Bot API documents.
   * TDLib accepts a message without blocks, which the emulator refuses as a message without a
   * source, since Telegram's servers decide whether an empty message can be sent.
   */
  readRichMessage(parameter: string): SpecifiedRichMessage {
    if (parameter.length === 0) {
      throw new RichMessageParameterError(RICH_MESSAGE_EMPTY_DESCRIPTION);
    }
    let value: unknown;
    try {
      value = JSON.parse(parameter);
    } catch {
      throw new RichMessageParameterError(RICH_MESSAGE_JSON_INVALID_DESCRIPTION);
    }
    if (!isJsonObject(value)) {
      throw new RichMessageParameterError(RICH_MESSAGE_NOT_OBJECT_DESCRIPTION);
    }
    const { blocks, html, markdown, media, is_rtl, skip_entity_detection } = this.#parse(
      richMessageSchema,
      value,
    );
    if (blocks === undefined) {
      throw new RichMessageParameterError(
        html === undefined && markdown === undefined
          ? RICH_MESSAGE_EMPTY_DESCRIPTION
          : MARKUP_RICH_MESSAGE_UNSUPPORTED_DESCRIPTION,
      );
    }
    if (html !== undefined || markdown !== undefined || media !== undefined) {
      throw new RichMessageParameterError(this.#invalidParametersDescription);
    }
    if (blocks.length === 0) {
      throw new RichMessageParameterError(RICH_MESSAGE_EMPTY_DESCRIPTION);
    }
    return {
      richMessage: { blocks: this.#readBlocks(blocks), isRightToLeft: is_rtl },
      detectsEntities: !skip_entity_detection,
    };
  }

  #readBlocks(values: readonly unknown[]): SpecifiedRichBlock[] {
    return values.map((value) => this.#readBlock(value));
  }

  /** Reads an `InputRichBlock` as the Bot API server's `get_input_page_block` reads it. */
  #readBlock(value: unknown): SpecifiedRichBlock {
    if (!isJsonObject(value)) {
      throw new RichMessageParameterError(BLOCK_NOT_OBJECT_DESCRIPTION);
    }
    const { type } = this.#parse(blockTypeSchema, value);
    switch (type) {
      case 'paragraph':
      case 'footer':
        return { kind: type, text: this.#readRichText(this.#parse(textBlockSchema, value).text) };
      case 'heading': {
        const block = this.#parse(headingBlockSchema, value);
        const text = this.#readRichText(block.text);
        if (block.size < 1 || block.size > 6) {
          throw new RichMessageParameterError(HEADING_SIZE_INVALID_DESCRIPTION);
        }
        return { kind: 'heading', text, size: block.size };
      }
      case 'pre': {
        const block = this.#parse(preformattedBlockSchema, value);
        return {
          kind: 'preformatted',
          text: this.#readRichText(block.text),
          ...(block.language.length === 0 ? {} : { language: block.language }),
        };
      }
      case 'divider':
        this.#parse(dividerBlockSchema, value);
        return { kind: 'divider' };
      case 'mathematical_expression':
        return {
          kind: 'mathematical_expression',
          expression: this.#parse(mathematicalExpressionBlockSchema, value).expression,
        };
      case 'anchor':
        return { kind: 'anchor', name: this.#parse(anchorBlockSchema, value).name };
      case 'list':
        return this.#readList(this.#parse(listBlockSchema, value).items);
      case 'blockquote': {
        const block = this.#parse(blockQuotationBlockSchema, value);
        return {
          kind: 'blockquote',
          blocks: this.#readBlocks(block.blocks),
          ...this.#readCredit(block.credit),
        };
      }
      case 'expandable_blockquote':
      case 'pullquote': {
        const block = this.#parse(quotationBlockSchema, value);
        return {
          kind: type,
          text: this.#readRichText(block.text),
          ...this.#readCredit(block.credit),
        };
      }
      case 'collage':
      case 'slideshow': {
        const block = this.#parse(mediaGroupBlockSchema, value);
        return {
          kind: type,
          blocks: this.#readBlocks(block.blocks),
          ...this.#readCaption(block.caption),
        };
      }
      case 'table':
        return this.#readTable(this.#parse(tableBlockSchema, value));
      case 'details': {
        const block = this.#parse(detailsBlockSchema, value);
        return {
          kind: 'details',
          summary: this.#readRichText(block.summary),
          blocks: this.#readBlocks(block.blocks),
          isOpen: block.is_open,
        };
      }
      case 'map':
        return this.#readMap(this.#parse(mapBlockSchema, value));
      case 'buttons':
        return this.#readButtonRow(this.#parse(buttonRowBlockSchema, value));
      case 'photo':
        return this.#readPhotoBlock(this.#parse(photoBlockSchema, value));
      case 'document':
        return this.#readDocumentBlock(this.#parse(documentBlockSchema, value));
      case 'video':
        return this.#readVideoBlock(this.#parse(videoBlockSchema, value));
      case 'voice_note':
        return this.#readVoiceNoteBlock(this.#parse(voiceNoteBlockSchema, value));
      case 'thinking':
        throw new RichMessageParameterError(THINKING_BLOCK_NOT_ALLOWED_DESCRIPTION);
      default:
        throw new RichMessageParameterError(
          isOneOf(type, MEDIA_BLOCK_TYPES_UNSUPPORTED)
            ? MEDIA_BLOCK_UNSUPPORTED_DESCRIPTION
            : `Bad Request: type "${type}" is unsupported`,
        );
    }
  }

  /**
   * Reads a list as TDLib's `WebPageBlockList::Item::get_item` reads its items: an item with a
   * label type is ordered, and a list must not mix ordered and unordered items. An item without
   * blocks holds an empty paragraph, as TDLib shows an item Telegram sends without content.
   */
  #readList(itemValues: readonly unknown[]): SpecifiedRichBlock {
    const items = itemValues.map((itemValue): RichListItem<SpecifiedRichMessageFileTypes> => {
      if (!isJsonObject(itemValue)) {
        throw new RichMessageParameterError(LIST_ITEM_NOT_OBJECT_DESCRIPTION);
      }
      const item = this.#parse(listItemSchema, itemValue);
      const blocks = this.#readBlocks(item.blocks);
      if (item.type.length > 0 && !isOneOf(item.type, ORDERED_LIST_ITEM_LABEL_TYPES)) {
        throw new RichMessageParameterError(LIST_ITEM_TYPE_INVALID_DESCRIPTION);
      }
      return {
        blocks: blocks.length === 0 ? [{ kind: 'paragraph', text: EMPTY_RICH_TEXT }] : blocks,
        hasCheckbox: item.has_checkbox,
        isChecked: item.has_checkbox && item.is_checked,
        ...(isOneOf(item.type, ORDERED_LIST_ITEM_LABEL_TYPES)
          ? { number: { value: item.value, labelType: item.type } }
          : {}),
      };
    });
    if (items.length === 0) {
      throw new RichMessageParameterError(LIST_EMPTY_DESCRIPTION);
    }
    const isOrdered = items[0].number !== undefined;
    if (items.some((item) => (item.number !== undefined) !== isOrdered)) {
      throw new RichMessageParameterError(LIST_MIXED_DESCRIPTION);
    }
    return { kind: 'list', items };
  }

  /**
   * Reads a table as the Bot API server's `get_page_block_table_cell` and TDLib's
   * `get_web_page_block_table_cell` read its cells: a cell is aligned left, or centered as a
   * header, and to the middle unless it says otherwise, and spans at least one column and row.
   */
  #readTable(block: z.output<typeof tableBlockSchema>): SpecifiedRichBlock {
    const rows = block.cells.map((row) =>
      row.map((cellValue): RichTableCell => {
        if (!isJsonObject(cellValue)) {
          throw new RichMessageParameterError(TABLE_CELL_NOT_OBJECT_DESCRIPTION);
        }
        const cell = this.#parse(tableCellSchema, cellValue);
        const text = cell.text === undefined ? EMPTY_RICH_TEXT : this.#readRichText(cell.text);
        const alignment = readHorizontalAlignment(
          cell.align.length === 0 ? (cell.is_header ? 'center' : 'left') : cell.align,
        );
        if (alignment === undefined) {
          throw new RichMessageParameterError(HORIZONTAL_ALIGNMENT_INVALID_DESCRIPTION);
        }
        const verticalAlignment = readVerticalAlignment(
          cell.valign.length === 0 ? 'middle' : cell.valign,
        );
        if (verticalAlignment === undefined) {
          throw new RichMessageParameterError(VERTICAL_ALIGNMENT_INVALID_DESCRIPTION);
        }
        if (cell.colspan < 0) {
          throw new RichMessageParameterError(TABLE_CELL_COLUMN_SPAN_INVALID_DESCRIPTION);
        }
        if (cell.rowspan < 0) {
          throw new RichMessageParameterError(TABLE_CELL_ROW_SPAN_INVALID_DESCRIPTION);
        }
        return {
          ...(isEmptyRichText(text) ? {} : { text }),
          isHeader: cell.is_header,
          columnSpan: Math.max(cell.colspan, 1),
          rowSpan: Math.max(cell.rowspan, 1),
          alignment,
          verticalAlignment,
        };
      })
    );
    const caption = block.caption === undefined
      ? EMPTY_RICH_TEXT
      : this.#readRichText(block.caption);
    return {
      kind: 'table',
      rows,
      ...(isEmptyRichText(caption) ? {} : { caption }),
      isBordered: block.is_bordered,
      isStriped: block.is_striped,
      isCompact: block.is_compact,
    };
  }

  /**
   * Reads a map as TDLib's `get_web_page_blocks` checks it: the location must be on Earth, the
   * zoom from 0 to 24, and the dimensions at most 10,000 together with neither more than 20 times
   * the other. As TDLib's `get_dimensions` does, a zero dimension clears both.
   */
  #readMap(block: z.output<typeof mapBlockSchema>): SpecifiedRichBlock {
    const caption = this.#readCaption(block.caption);
    const { latitude, longitude, horizontal_accuracy } = block.location;
    if (!isPointOnEarth(latitude, longitude)) {
      throw new RichMessageParameterError(LOCATION_INVALID_DESCRIPTION);
    }
    const { zoom, width, height } = block;
    if (
      zoom < 0 || zoom > MAX_MAP_ZOOM || width < 0 || width > MAX_MAP_DIMENSION || height < 0 ||
      height > MAX_MAP_DIMENSION || width + height > MAX_MAP_DIMENSION ||
      width > height * MAX_MAP_ASPECT_RATIO || height > width * MAX_MAP_ASPECT_RATIO
    ) {
      throw new RichMessageParameterError(MAP_PROPERTIES_INVALID_DESCRIPTION);
    }
    const hasDimensions = width > 0 && height > 0;
    return {
      kind: 'map',
      // As TDLib's `Location::fix_accuracy` does, an accuracy is at most 1500 meters.
      location: createGeoLocation(
        latitude,
        longitude,
        Math.min(Math.max(horizontal_accuracy, 0), MAX_HORIZONTAL_ACCURACY_METERS),
      ),
      zoom,
      width: hasDimensions ? width : 0,
      height: hasDimensions ? height : 0,
      ...caption,
    };
  }

  #readButtonRow(block: z.output<typeof buttonRowBlockSchema>): SpecifiedRichBlock {
    const alignment = block.align.length === 0 ? undefined : readHorizontalAlignment(block.align);
    const buttons = block.buttons.map((buttonValue) => this.#readButton(buttonValue));
    if (block.align.length > 0 && alignment === undefined) {
      throw new RichMessageParameterError(HORIZONTAL_ALIGNMENT_INVALID_DESCRIPTION);
    }
    if (buttons.length === 0) {
      throw new RichMessageParameterError(BUTTON_ROW_EMPTY_DESCRIPTION);
    }
    if (buttons.length > MAX_BUTTON_ROW_LENGTH) {
      throw new RichMessageParameterError(BUTTON_ROW_TOO_LONG_DESCRIPTION);
    }
    return {
      kind: 'buttons',
      buttons,
      ...(alignment === undefined ? {} : { alignment }),
    };
  }

  /**
   * Reads a `RichMessageButton` as the Bot API server's `get_inline_button` reads it: its style as
   * `get_button_style` reads a rich message's, and its action as an inline keyboard button's. As
   * the Bot API documents, only a callback button may look like a link, and its text may hold
   * only custom emoji and dates.
   */
  #readButton(value: unknown): RichMessageButton {
    if (!isJsonObject(value)) {
      throw new RichMessageParameterError(BUTTON_NOT_OBJECT_DESCRIPTION);
    }
    const { face, action } = this.#parse(richMessageButtonSchema, value);
    const text = this.#readRichText(face.text);
    const style = readRichMessageButtonStyle(face.style ?? '');
    if (style === null) {
      throw new RichMessageParameterError(BUTTON_STYLE_INVALID_DESCRIPTION);
    }
    if (style === 'link' && action.kind !== 'callback') {
      throw new RichMessageParameterError(LINK_BUTTON_STYLE_NOT_ALLOWED_DESCRIPTION);
    }
    if (!isButtonText(text)) {
      throw new RichMessageParameterError(BUTTON_TEXT_FORMATTING_NOT_ALLOWED_DESCRIPTION);
    }
    return { text, ...(style === undefined ? {} : { style }), action };
  }

  #readPhotoBlock(block: z.output<typeof photoBlockSchema>): SpecifiedRichBlock {
    const { photo } = block;
    checkMediaType(photo.type, 'photo');
    const photoFile = this.#readMediaFile(photo.media);
    return {
      kind: 'photo',
      photo: photoFile,
      hasSpoiler: photo.has_spoiler,
      ...this.#readCaption(block.caption),
    };
  }

  #readDocumentBlock(block: z.output<typeof documentBlockSchema>): SpecifiedRichBlock {
    const { document } = block;
    checkMediaType(document.type, 'document');
    const documentFile = this.#readMediaFile(document.media);
    const thumbnail = readThumbnailParameter(document, this.#uploadedFiles);
    return {
      kind: 'document',
      document: {
        document: documentFile,
        ...(thumbnail === undefined ? {} : { thumbnail }),
      },
      ...this.#readCaption(block.caption),
    };
  }

  /**
   * Reads a video block as the Bot API server's `get_input_video` reads its media: the duration and
   * dimensions are clamped, and the thumbnail is read as for `sendVideo`.
   */
  #readVideoBlock(block: z.output<typeof videoBlockSchema>): SpecifiedRichBlock {
    const { video } = block;
    checkMediaType(video.type, 'video');
    const videoFile = this.#readMediaFile(video.media);
    const thumbnail = readThumbnailParameter(video, this.#uploadedFiles);
    return {
      kind: 'video',
      video: {
        video: videoFile,
        attributes: { durationSeconds: video.duration, width: video.width, height: video.height },
        ...(thumbnail === undefined ? {} : { thumbnail }),
      },
      hasSpoiler: video.has_spoiler,
      ...this.#readCaption(block.caption),
    };
  }

  /**
   * Reads a voice note block as the Bot API server's `get_input_voice_note` reads its media, whose
   * duration is clamped.
   */
  #readVoiceNoteBlock(block: z.output<typeof voiceNoteBlockSchema>): SpecifiedRichBlock {
    const { voice_note: voiceNote } = block;
    checkMediaType(voiceNote.type, 'voice_note');
    const voiceFile = this.#readMediaFile(voiceNote.media);
    return {
      kind: 'voice_note',
      voiceNote: { voice: voiceFile, durationSeconds: voiceNote.duration },
      ...this.#readCaption(block.caption),
    };
  }

  /**
   * Reads the file of a block's media as the Bot API server's `get_input_media` does: a part named
   * by `attach://<name>`, a `file_id`, or an HTTP URL, which is downloaded once the message is
   * read.
   */
  #readMediaFile(media: string) {
    const reading = readInputFileParameter('', media, this.#uploadedFiles);
    if (!reading.read) {
      throw new RichMessageParameterError(MEDIA_NOT_FOUND_DESCRIPTION);
    }
    return reading.inputFile;
  }

  /**
   * Reads a `RichBlockCaption` as the Bot API server's `get_page_block_caption` does; a caption
   * whose text and credit are both empty is none, as TDLib shows it.
   */
  #readCaption(value: unknown): { readonly caption?: RichBlockCaption } {
    if (value === undefined) {
      return {};
    }
    if (!isJsonObject(value)) {
      throw new RichMessageParameterError(CAPTION_NOT_OBJECT_DESCRIPTION);
    }
    const caption = this.#parse(captionSchema, value);
    const text = this.#readRichText(caption.text);
    const { credit } = this.#readCredit(caption.credit);
    return isEmptyRichText(text) && credit === undefined
      ? {}
      : { caption: { text, ...(credit === undefined ? {} : { credit }) } };
  }

  /** Reads an optional credit; an empty credit is none, as TDLib shows it. */
  #readCredit(value: unknown): { readonly credit?: RichText } {
    if (value === undefined) {
      return {};
    }
    const credit = this.#readRichText(value);
    return isEmptyRichText(credit) ? {} : { credit };
  }

  /**
   * Reads `RichText` as the Bot API server's `get_rich_text` reads it and TDLib's
   * `RichText::get_rich_text` keeps it: a string is plain text, an array the texts one after
   * another, and an object a text of its type.
   */
  #readRichText(value: unknown): RichText {
    if (typeof value === 'string') {
      return { kind: 'plain', text: value };
    }
    if (Array.isArray(value)) {
      // TDLib keeps an empty array as empty text.
      return value.length === 0
        ? EMPTY_RICH_TEXT
        : { kind: 'concatenation', texts: value.map((part) => this.#readRichText(part)) };
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
      throw new RichMessageParameterError(RICH_TEXT_INVALID_DESCRIPTION);
    }
    if (!isJsonObject(value)) {
      throw new RichMessageParameterError(this.#invalidParametersDescription);
    }
    const { type } = this.#parse(blockTypeSchema, value);
    const style = RICH_TEXT_STYLES.get(type);
    if (style !== undefined) {
      return { kind: 'styled', style, text: this.#readTextField(styledTextSchema, value) };
    }
    const detectedEntityTextSchema = DETECTED_ENTITY_TEXT_SCHEMAS.get(type);
    if (detectedEntityTextSchema !== undefined) {
      return this.#readTextField(detectedEntityTextSchema, value);
    }
    switch (type) {
      case 'date_time':
        return this.#readDateTime(value);
      case 'text_mention': {
        const text = this.#parse(textMentionTextSchema, value);
        return { kind: 'text_mention', text: this.#readRichText(text.text), userId: text.user.id };
      }
      case 'url': {
        const link = this.#parse(urlTextSchema, value);
        return { kind: 'link', text: this.#readRichText(link.text), url: link.url };
      }
      case 'email_address': {
        const emailAddress = this.#parse(emailAddressTextSchema, value);
        return {
          kind: 'email_address',
          text: this.#readRichText(emailAddress.text),
          emailAddress: emailAddress.email_address,
        };
      }
      case 'phone_number': {
        const phoneNumber = this.#parse(phoneNumberTextSchema, value);
        return {
          kind: 'phone_number',
          text: this.#readRichText(phoneNumber.text),
          phoneNumber: phoneNumber.phone_number,
        };
      }
      // TDLib keeps links to a reference and to an anchor alike, as links to `#` and the name.
      case 'reference_link': {
        const link = this.#parse(referenceLinkTextSchema, value);
        return {
          kind: 'anchor_link',
          text: this.#readRichText(link.text),
          targetName: link.reference_name,
        };
      }
      case 'anchor_link': {
        const link = this.#parse(anchorLinkTextSchema, value);
        return {
          kind: 'anchor_link',
          text: this.#readRichText(link.text),
          targetName: link.anchor_name,
        };
      }
      case 'reference': {
        const reference = this.#parse(referenceTextSchema, value);
        const text = this.#readRichText(reference.text);
        // TDLib keeps a reference without text as an anchor.
        return isEmptyRichText(text)
          ? { kind: 'anchor', name: reference.name }
          : { kind: 'reference', name: reference.name, text };
      }
      case 'custom_emoji': {
        const customEmoji = this.#parse(customEmojiTextSchema, value);
        if (!/^-?[1-9]\d*$/.test(customEmoji.custom_emoji_id)) {
          throw new RichMessageParameterError(CUSTOM_EMOJI_ID_INVALID_DESCRIPTION);
        }
        return {
          kind: 'custom_emoji',
          customEmojiId: customEmoji.custom_emoji_id,
          alternativeText: customEmoji.alternative_text,
        };
      }
      case 'mathematical_expression':
        return {
          kind: 'mathematical_expression',
          expression: this.#parse(mathematicalExpressionBlockSchema, value).expression,
        };
      case 'anchor':
        return { kind: 'anchor', name: this.#parse(anchorBlockSchema, value).name };
      case 'button':
        return {
          kind: 'button',
          button: this.#readButton(this.#parse(buttonTextSchema, value).button),
        };
      default:
        throw new RichMessageParameterError(RICH_TEXT_TYPE_UNSUPPORTED_DESCRIPTION);
    }
  }

  /** Reads the `text` field of rich text that holds nothing else the emulator keeps. */
  #readTextField(
    schema: z.ZodType<{ readonly text: unknown }>,
    value: Readonly<Record<string, unknown>>,
  ): RichText {
    return this.#readRichText(this.#parse(schema, value).text);
  }

  /**
   * Reads a date and time as the Bot API server's `get_date_time_formatting_type` reads its format
   * and TDLib's `FormattedDate::get_formatted_date` checks its time, which must be positive.
   */
  #readDateTime(value: Readonly<Record<string, unknown>>): RichText {
    const dateTime = this.#parse(dateTimeTextSchema, value);
    const text = this.#readRichText(dateTime.text);
    const formatReading = readDateTimeFormat(dateTime.date_time_format);
    if (!formatReading.valid) {
      throw new RichMessageParameterError(DATE_TIME_FORMAT_INVALID_DESCRIPTION);
    }
    if (dateTime.unix_time <= 0) {
      throw new RichMessageParameterError(DATE_INVALID_DESCRIPTION);
    }
    const { format } = formatReading;
    return {
      kind: 'date_time',
      text,
      unixTime: dateTime.unix_time,
      ...(format === undefined ? {} : { format }),
    };
  }

  /** Parses a JSON value, failing as for invalid parameters when it does not match. */
  #parse<Output>(schema: z.ZodType<Output>, value: unknown): Output {
    const parsing = schema.safeParse(value);
    if (!parsing.success) {
      throw new RichMessageParameterError(this.#invalidParametersDescription);
    }
    return parsing.data;
  }
}

/**
 * Checks that a block's media is of the block's type, as the Bot API server's
 * `get_input_page_block` does.
 */
function checkMediaType(
  mediaType: string,
  blockType: 'photo' | 'document' | 'video' | 'voice_note',
): void {
  if (mediaType !== blockType) {
    throw new RichMessageParameterError(
      `Bad Request: unexpected media type "${mediaType}" for block "${blockType}"`,
    );
  }
}

/**
 * Reads a rich message button's style as the official Bot API server's `get_button_style` does,
 * in any ASCII letter case: `undefined` for the default style, `null` for an unknown one.
 */
function readRichMessageButtonStyle(style: string): RichMessageButtonStyle | undefined | null {
  const styleName = style.replace(/[A-Z]/g, (letter) => letter.toLowerCase());
  switch (styleName) {
    case '':
    case 'default':
      return undefined;
    case 'primary':
    case 'danger':
    case 'success':
    case 'link':
      return styleName;
    default:
      return null;
  }
}

/** Whether rich text holds only what a button's text may: plain text, custom emoji, and dates. */
function isButtonText(text: RichText): boolean {
  switch (text.kind) {
    case 'plain':
    case 'custom_emoji':
      return true;
    case 'concatenation':
      return text.texts.every(isButtonText);
    case 'date_time':
      return isButtonText(text.text);
    default:
      return false;
  }
}

function readHorizontalAlignment(alignment: string): HorizontalAlignment | undefined {
  return alignment === 'left' || alignment === 'center' || alignment === 'right'
    ? alignment
    : undefined;
}

function readVerticalAlignment(alignment: string): VerticalAlignment | undefined {
  return alignment === 'top' || alignment === 'middle' || alignment === 'bottom'
    ? alignment
    : undefined;
}

function isJsonObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isOneOf<Value extends string>(value: string, values: readonly Value[]): value is Value {
  return (values as readonly string[]).includes(value);
}
