/**
 * Wire facts of rich messages, which bots lay out in blocks, as the Bot API's `RichMessage`,
 * `RichBlock` and `RichText` show them. Rich text and blocks nest without bound, so their types
 * are declared beside their schemas, which they annotate, as zod infers no recursive type.
 */
import { z } from 'zod';

import { accountProfileSchema } from './accounts.ts';
import { messageSenderBotSchema } from './bots.ts';
import {
  inlineButtonSchemas,
  type InlineKeyboardButton,
  type KeyboardButtonFace,
} from './keyboard_buttons.ts';
import {
  type Document,
  documentSchema,
  type Location,
  type PhotoSize,
  photoSizeSchema,
  type Video,
  videoSchema,
  type Voice,
  voiceSchema,
} from './message_media.ts';
import type { ReadonlySnapshot } from './readonly_snapshot.ts';

/** A user a rich text mentions: an account or a bot. */
type MentionedUser =
  | ReadonlySnapshot<z.output<typeof accountProfileSchema>>
  | ReadonlySnapshot<z.output<typeof messageSenderBotSchema>>;

/**
 * Text of a rich message: plain text as a string, texts one after another as an array, or an
 * object of a type.
 */
export type RichText = string | readonly RichText[] | RichTextObject;

/** Rich text of a type, as the Bot API's `RichText` shows it. */
export type RichTextObject =
  | {
    readonly type:
      | 'bold'
      | 'italic'
      | 'underline'
      | 'strikethrough'
      | 'spoiler'
      | 'subscript'
      | 'superscript'
      | 'marked'
      | 'code';
    readonly text: RichText;
  }
  | {
    readonly type: 'date_time';
    readonly text: RichText;
    readonly unix_time: number;
    /** As a `date_time` entity's `date_time_format`. */
    readonly date_time_format: string;
  }
  /** Entities Telegram detects in the text, each showing the text it covers. */
  | { readonly type: 'mention'; readonly text: RichText; readonly username: string }
  | { readonly type: 'hashtag'; readonly text: RichText; readonly hashtag: string }
  | { readonly type: 'cashtag'; readonly text: RichText; readonly cashtag: string }
  | { readonly type: 'bot_command'; readonly text: RichText; readonly bot_command: string }
  | {
    readonly type: 'bank_card_number';
    readonly text: RichText;
    readonly bank_card_number: string;
  }
  | {
    readonly type: 'text_mention';
    readonly text: RichText;
    readonly user: MentionedUser;
  }
  | { readonly type: 'url'; readonly text: RichText; readonly url: string }
  | { readonly type: 'email_address'; readonly text: RichText; readonly email_address: string }
  | { readonly type: 'phone_number'; readonly text: RichText; readonly phone_number: string }
  | {
    readonly type: 'custom_emoji';
    readonly custom_emoji_id: string;
    readonly alternative_text: string;
  }
  | { readonly type: 'mathematical_expression'; readonly expression: string }
  | { readonly type: 'reference'; readonly text: RichText; readonly name: string }
  | { readonly type: 'reference_link'; readonly text: RichText; readonly reference_name: string }
  | { readonly type: 'anchor'; readonly name: string }
  /** A link to an anchor of the message; an empty name links to its top. */
  | { readonly type: 'anchor_link'; readonly text: RichText; readonly anchor_name: string }
  | { readonly type: 'button'; readonly button: RichMessageButton };

/** Removes properties from each member of a union, which keeps the union's alternatives apart. */
type OmitFromEach<Type, Key extends PropertyKey> = Type extends unknown ? Omit<Type, Key> : never;

/**
 * A button of a rich message, which acts as an inline keyboard button of the same kind. An
 * account presses a callback button by its callback data.
 */
export type RichMessageButton =
  & {
    readonly text: RichText;
    /** Omitted for the client's default style; `link` shows the button as a link. */
    readonly style?: 'primary' | 'danger' | 'success' | 'link';
  }
  & OmitFromEach<InlineKeyboardButton, keyof KeyboardButtonFace>;

export type HorizontalAlignment = 'left' | 'center' | 'right';

/** The caption of a block with media or a map. */
export interface RichBlockCaption {
  readonly text: RichText;
  readonly credit?: RichText;
}

export interface RichBlockListItem {
  /** `•` for an item of an unordered list, otherwise its number as its type shows it. */
  readonly label: string;
  readonly blocks: readonly RichBlock[];
  readonly has_checkbox?: true;
  readonly is_checked?: true;
  /** Present for an item of an ordered list: letters, Roman numerals, or decimal numbers. */
  readonly type?: 'a' | 'A' | 'i' | 'I' | '1';
  readonly value?: number;
}

export interface RichBlockTableCell {
  /** Omitted for an invisible cell. */
  readonly text?: RichText;
  readonly is_header?: true;
  /** Omitted for a cell that spans one column. */
  readonly colspan?: number;
  /** Omitted for a cell that spans one row. */
  readonly rowspan?: number;
  readonly align: HorizontalAlignment;
  readonly valign: 'top' | 'middle' | 'bottom';
}

/** A block of a rich message, as the Bot API's `RichBlock` shows it. */
export type RichBlock =
  | { readonly type: 'paragraph' | 'footer'; readonly text: RichText }
  | { readonly type: 'heading'; readonly text: RichText; readonly size: number }
  | { readonly type: 'pre'; readonly text: RichText; readonly language?: string }
  | { readonly type: 'divider' }
  | { readonly type: 'mathematical_expression'; readonly expression: string }
  | { readonly type: 'anchor'; readonly name: string }
  | { readonly type: 'list'; readonly items: readonly RichBlockListItem[] }
  | {
    readonly type: 'blockquote';
    readonly blocks: readonly RichBlock[];
    readonly credit?: RichText;
  }
  | {
    readonly type: 'expandable_blockquote' | 'pullquote';
    readonly text: RichText;
    readonly credit?: RichText;
  }
  | {
    readonly type: 'collage' | 'slideshow';
    readonly blocks: readonly RichBlock[];
    readonly caption?: RichBlockCaption;
  }
  | {
    readonly type: 'table';
    readonly cells: readonly (readonly RichBlockTableCell[])[];
    readonly caption?: RichText;
    readonly is_bordered?: true;
    readonly is_striped?: true;
    readonly is_compact?: true;
  }
  | {
    readonly type: 'details';
    readonly summary: RichText;
    readonly blocks: readonly RichBlock[];
    readonly is_open?: true;
  }
  | {
    readonly type: 'map';
    readonly location: Location;
    readonly zoom: number;
    /** 0, as is the height, when the bot chose no dimensions. */
    readonly width: number;
    readonly height: number;
    readonly caption?: RichBlockCaption;
  }
  | {
    readonly type: 'buttons';
    readonly buttons: readonly RichMessageButton[];
    readonly align?: HorizontalAlignment;
  }
  | {
    readonly type: 'photo';
    readonly photo: readonly PhotoSize[];
    readonly caption?: RichBlockCaption;
    readonly has_spoiler?: true;
  }
  | { readonly type: 'document'; readonly document: Document; readonly caption?: RichBlockCaption }
  | {
    readonly type: 'video';
    /** The video; a block keeps no start, so it never shows a `start_timestamp`. */
    readonly video: Omit<Video, 'start_timestamp'>;
    readonly caption?: RichBlockCaption;
    readonly has_spoiler?: true;
  }
  | {
    readonly type: 'voice_note';
    readonly voice_note: Voice;
    readonly caption?: RichBlockCaption;
  };

/** A message a bot laid out in blocks. */
export interface RichMessage {
  readonly blocks: readonly RichBlock[];
  /** Present when clients show the message right-to-left. */
  readonly is_rtl?: true;
}

const richTextSchema: z.ZodType<RichText> = z.lazy(() =>
  z.union([z.string(), z.array(richTextSchema), richTextObjectSchema])
);

const richMessageButtonSchema: z.ZodType<RichMessageButton> = z.lazy(() =>
  z.union(inlineButtonSchemas({
    text: richTextSchema,
    style: z.enum(['primary', 'danger', 'success', 'link']).optional(),
  }))
);

const richTextObjectSchema: z.ZodType<RichTextObject> = z.lazy(() =>
  z.union([
    z.strictObject({
      type: z.enum([
        'bold',
        'italic',
        'underline',
        'strikethrough',
        'spoiler',
        'subscript',
        'superscript',
        'marked',
        'code',
      ]),
      text: richTextSchema,
    }),
    z.strictObject({
      type: z.literal('date_time'),
      text: richTextSchema,
      unix_time: z.int().positive(),
      date_time_format: z.string().regex(/^(r|w?[dD]?[tT]?)$/),
    }),
    z.strictObject({ type: z.literal('mention'), text: richTextSchema, username: z.string() }),
    z.strictObject({ type: z.literal('hashtag'), text: richTextSchema, hashtag: z.string() }),
    z.strictObject({ type: z.literal('cashtag'), text: richTextSchema, cashtag: z.string() }),
    z.strictObject({
      type: z.literal('bot_command'),
      text: richTextSchema,
      bot_command: z.string(),
    }),
    z.strictObject({
      type: z.literal('bank_card_number'),
      text: richTextSchema,
      bank_card_number: z.string(),
    }),
    z.strictObject({
      type: z.literal('text_mention'),
      text: richTextSchema,
      user: z.union([accountProfileSchema, messageSenderBotSchema]),
    }),
    z.strictObject({ type: z.literal('url'), text: richTextSchema, url: z.string() }),
    z.strictObject({
      type: z.literal('email_address'),
      text: richTextSchema,
      email_address: z.string(),
    }),
    z.strictObject({
      type: z.literal('phone_number'),
      text: richTextSchema,
      phone_number: z.string(),
    }),
    z.strictObject({
      type: z.literal('custom_emoji'),
      custom_emoji_id: z.string().regex(/^-?[1-9]\d*$/),
      alternative_text: z.string(),
    }),
    z.strictObject({ type: z.literal('mathematical_expression'), expression: z.string() }),
    z.strictObject({ type: z.literal('reference'), text: richTextSchema, name: z.string() }),
    z.strictObject({
      type: z.literal('reference_link'),
      text: richTextSchema,
      reference_name: z.string(),
    }),
    z.strictObject({ type: z.literal('anchor'), name: z.string() }),
    z.strictObject({
      type: z.literal('anchor_link'),
      text: richTextSchema,
      anchor_name: z.string(),
    }),
    z.strictObject({ type: z.literal('button'), button: richMessageButtonSchema }),
  ])
);

const horizontalAlignmentSchema = z.enum(['left', 'center', 'right']);

const richBlockCaptionSchema = z.strictObject({
  text: richTextSchema,
  credit: richTextSchema.optional(),
});

const richBlockSchema: z.ZodType<RichBlock> = z.lazy(() =>
  z.union([
    z.strictObject({ type: z.enum(['paragraph', 'footer']), text: richTextSchema }),
    z.strictObject({
      type: z.literal('heading'),
      text: richTextSchema,
      size: z.int().min(1).max(6),
    }),
    z.strictObject({
      type: z.literal('pre'),
      text: richTextSchema,
      language: z.string().min(1).optional(),
    }),
    z.strictObject({ type: z.literal('divider') }),
    z.strictObject({ type: z.literal('mathematical_expression'), expression: z.string() }),
    z.strictObject({ type: z.literal('anchor'), name: z.string() }),
    z.strictObject({
      type: z.literal('list'),
      items: z.array(z.strictObject({
        label: z.string().min(1),
        blocks: z.array(richBlockSchema).min(1),
        has_checkbox: z.literal(true).optional(),
        is_checked: z.literal(true).optional(),
        type: z.enum(['a', 'A', 'i', 'I', '1']).optional(),
        value: z.int().optional(),
      })).min(1),
    }),
    z.strictObject({
      type: z.literal('blockquote'),
      blocks: z.array(richBlockSchema),
      credit: richTextSchema.optional(),
    }),
    z.strictObject({
      type: z.enum(['expandable_blockquote', 'pullquote']),
      text: richTextSchema,
      credit: richTextSchema.optional(),
    }),
    z.strictObject({
      type: z.enum(['collage', 'slideshow']),
      blocks: z.array(richBlockSchema),
      caption: richBlockCaptionSchema.optional(),
    }),
    z.strictObject({
      type: z.literal('table'),
      cells: z.array(z.array(z.strictObject({
        text: richTextSchema.optional(),
        is_header: z.literal(true).optional(),
        colspan: z.int().min(2).optional(),
        rowspan: z.int().min(2).optional(),
        align: horizontalAlignmentSchema,
        valign: z.enum(['top', 'middle', 'bottom']),
      }))),
      caption: richTextSchema.optional(),
      is_bordered: z.literal(true).optional(),
      is_striped: z.literal(true).optional(),
      is_compact: z.literal(true).optional(),
    }),
    z.strictObject({
      type: z.literal('details'),
      summary: richTextSchema,
      blocks: z.array(richBlockSchema),
      is_open: z.literal(true).optional(),
    }),
    z.strictObject({
      type: z.literal('map'),
      location: z.strictObject({
        latitude: z.number(),
        longitude: z.number(),
        horizontal_accuracy: z.number().positive().optional(),
      }),
      zoom: z.int().min(0).max(24),
      width: z.int().nonnegative(),
      height: z.int().nonnegative(),
      caption: richBlockCaptionSchema.optional(),
    }),
    z.strictObject({
      type: z.literal('buttons'),
      buttons: z.array(richMessageButtonSchema).min(1),
      align: horizontalAlignmentSchema.optional(),
    }),
    z.strictObject({
      type: z.literal('photo'),
      photo: z.array(photoSizeSchema).min(1),
      caption: richBlockCaptionSchema.optional(),
      has_spoiler: z.literal(true).optional(),
    }),
    z.strictObject({
      type: z.literal('document'),
      document: documentSchema,
      caption: richBlockCaptionSchema.optional(),
    }),
    z.strictObject({
      type: z.literal('video'),
      video: videoSchema.omit({ start_timestamp: true }),
      caption: richBlockCaptionSchema.optional(),
      has_spoiler: z.literal(true).optional(),
    }),
    z.strictObject({
      type: z.literal('voice_note'),
      voice_note: voiceSchema,
      caption: richBlockCaptionSchema.optional(),
    }),
  ])
);

/** A message a bot laid out in at least one block, which only bots send. */
export const richMessageSchema: z.ZodType<RichMessage> = z.strictObject({
  blocks: z.array(richBlockSchema).min(1),
  is_rtl: z.literal(true).optional(),
});
