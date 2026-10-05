import type {
  BotApiDocument,
  BotApiInlineKeyboardButton,
  BotApiKeyboardButtonFace,
  BotApiLocation,
  BotApiPhotoSize,
  BotApiUser,
  BotApiVideo,
  BotApiVoice,
} from './bot_api.ts';
import type {
  HorizontalAlignment,
  OrderedListItemLabelType,
  RichMessageButtonStyle,
  RichTextStyle,
  VerticalAlignment,
} from './rich_message.ts';

// The Bot API's `RichMessage` and the types it holds, in the field order of the official Bot API
// server's `JsonRichMessage` and the classes it uses.

export interface BotApiRichMessage {
  readonly blocks: readonly BotApiRichBlock[];
  /** Present only for a message that clients show right-to-left. */
  readonly is_rtl?: true;
}

/** Plain text as a string, rich texts one after another as an array, or an object of a type. */
export type BotApiRichText = string | readonly BotApiRichText[] | BotApiRichTextObject;

export type BotApiRichTextObject =
  | { readonly type: RichTextStyle; readonly text: BotApiRichText }
  | {
    readonly type: 'date_time';
    readonly text: BotApiRichText;
    readonly unix_time: number;
    /** Empty when the sender chose no format, which Telegram reports all the same. */
    readonly date_time_format: string;
  }
  | { readonly type: 'mention'; readonly text: BotApiRichText; readonly username: string }
  | { readonly type: 'hashtag'; readonly text: BotApiRichText; readonly hashtag: string }
  | { readonly type: 'cashtag'; readonly text: BotApiRichText; readonly cashtag: string }
  | { readonly type: 'bot_command'; readonly text: BotApiRichText; readonly bot_command: string }
  | { readonly type: 'text_mention'; readonly text: BotApiRichText; readonly user: BotApiUser }
  | { readonly type: 'url'; readonly text: BotApiRichText; readonly url: string }
  | {
    readonly type: 'email_address';
    readonly text: BotApiRichText;
    readonly email_address: string;
  }
  | {
    readonly type: 'bank_card_number';
    readonly text: BotApiRichText;
    readonly bank_card_number: string;
  }
  | { readonly type: 'phone_number'; readonly text: BotApiRichText; readonly phone_number: string }
  | {
    readonly type: 'custom_emoji';
    readonly custom_emoji_id: string;
    readonly alternative_text: string;
  }
  | { readonly type: 'mathematical_expression'; readonly expression: string }
  | { readonly type: 'reference'; readonly text: BotApiRichText; readonly name: string }
  | {
    readonly type: 'reference_link';
    readonly text: BotApiRichText;
    readonly reference_name: string;
  }
  | { readonly type: 'anchor'; readonly name: string }
  | { readonly type: 'anchor_link'; readonly text: BotApiRichText; readonly anchor_name: string }
  | { readonly type: 'button'; readonly button: BotApiRichMessageButton };

/** Removes properties from each member of a union, which keeps the union's alternatives apart. */
type OmitFromEach<Type, Key extends PropertyKey> = Type extends unknown ? Omit<Type, Key> : never;

/** What a button does, in the fields that show it on an inline keyboard button. */
export type BotApiInlineButtonAction = OmitFromEach<
  BotApiInlineKeyboardButton,
  keyof BotApiKeyboardButtonFace
>;

export type BotApiRichMessageButton =
  & {
    readonly text: BotApiRichText;
    /** Omitted for the client's default style. */
    readonly style?: RichMessageButtonStyle;
  }
  & BotApiInlineButtonAction;

export interface BotApiRichBlockCaption {
  readonly text: BotApiRichText;
  /** Omitted for no credit. */
  readonly credit?: BotApiRichText;
}

export interface BotApiRichBlockListItem {
  /** `•` for an item of an unordered list. */
  readonly label: string;
  readonly blocks: readonly BotApiRichBlock[];
  readonly has_checkbox?: true;
  /** Present only for a checked checkbox. */
  readonly is_checked?: true;
  /** Present only for an item of an ordered list, with `value`. */
  readonly type?: OrderedListItemLabelType;
  readonly value?: number;
}

export interface BotApiRichBlockTableCell {
  /** Omitted for an invisible cell. */
  readonly text?: BotApiRichText;
  readonly is_header?: true;
  /** Omitted for a cell that spans one column. */
  readonly colspan?: number;
  /** Omitted for a cell that spans one row. */
  readonly rowspan?: number;
  readonly align: HorizontalAlignment;
  readonly valign: VerticalAlignment;
}

export type BotApiRichBlock =
  | {
    readonly type: 'paragraph' | 'footer';
    readonly text: BotApiRichText;
  }
  | { readonly type: 'heading'; readonly text: BotApiRichText; readonly size: number }
  | { readonly type: 'pre'; readonly text: BotApiRichText; readonly language?: string }
  | { readonly type: 'divider' }
  | { readonly type: 'mathematical_expression'; readonly expression: string }
  | { readonly type: 'anchor'; readonly name: string }
  | { readonly type: 'list'; readonly items: readonly BotApiRichBlockListItem[] }
  | {
    readonly type: 'blockquote';
    readonly blocks: readonly BotApiRichBlock[];
    readonly credit?: BotApiRichText;
  }
  | {
    readonly type: 'expandable_blockquote' | 'pullquote';
    readonly text: BotApiRichText;
    readonly credit?: BotApiRichText;
  }
  | {
    readonly type: 'collage' | 'slideshow';
    readonly blocks: readonly BotApiRichBlock[];
    readonly caption?: BotApiRichBlockCaption;
  }
  | {
    readonly type: 'table';
    readonly cells: readonly (readonly BotApiRichBlockTableCell[])[];
    readonly caption?: BotApiRichText;
    readonly is_bordered?: true;
    readonly is_striped?: true;
    readonly is_compact?: true;
  }
  | {
    readonly type: 'details';
    readonly summary: BotApiRichText;
    readonly blocks: readonly BotApiRichBlock[];
    readonly is_open?: true;
  }
  | {
    readonly type: 'map';
    readonly location: BotApiLocation;
    readonly zoom: number;
    readonly width: number;
    readonly height: number;
    readonly caption?: BotApiRichBlockCaption;
  }
  | {
    readonly type: 'buttons';
    readonly buttons: readonly BotApiRichMessageButton[];
    readonly align?: HorizontalAlignment;
  }
  | {
    readonly type: 'photo';
    /** The photo's sizes; the emulator keeps a single size. */
    readonly photo: readonly BotApiPhotoSize[];
    readonly caption?: BotApiRichBlockCaption;
    readonly has_spoiler?: true;
  }
  | {
    readonly type: 'document';
    readonly document: BotApiDocument;
    readonly caption?: BotApiRichBlockCaption;
  }
  | {
    readonly type: 'video';
    /** The video without a cover or start timestamp, which the block does not keep. */
    readonly video: BotApiVideo;
    readonly caption?: BotApiRichBlockCaption;
    readonly has_spoiler?: true;
  }
  | {
    readonly type: 'voice_note';
    readonly voice_note: BotApiVoice;
    readonly caption?: BotApiRichBlockCaption;
  };
