/**
 * The deployment of the official Bot API server whose upload limits a session's bots meet:
 * `cloud` for the server Telegram hosts at `api.telegram.org`, `local` for a self-hosted server
 * started with `--local`. The profile changes only upload limits; every other behavior stays that
 * of the cloud server.
 */
export type UploadProfile = 'cloud' | 'local';

/** Settings of a new session, which stay fixed for its lifetime. */
export interface CreateSessionInput {
  /** Defaults to `cloud`. */
  readonly upload_profile?: UploadProfile;
}

/** The server-assigned identity, Bot API location, and settings of an emulation session. */
export interface EmulationSession {
  readonly id: string;
  readonly botApiRoot: string;
  readonly uploadProfile: UploadProfile;
}

export interface CreateVirtualBotInput {
  readonly first_name: string;
  readonly username: string;
  /**
   * Turns off the bot's privacy mode, so that it receives every message of its groups. Defaults to
   * `false`: the bot receives only commands, replies to its messages, and mentions of it.
   */
  readonly can_read_all_group_messages?: boolean;
  /**
   * Turns on inline mode, so that accounts send the bot inline queries. Defaults to `false`, as
   * for a new Telegram bot.
   */
  readonly supports_inline_queries?: boolean;
  /**
   * Turns on inline feedback, so that the bot receives a `chosen_inline_result` update for each
   * result of its inline queries that an account sends. Defaults to `false`.
   */
  readonly receives_chosen_inline_results?: boolean;
  /**
   * Asks accounts to share their location with the bot's inline queries. Defaults to `false`, in
   * which case accounts cannot share it.
   */
  readonly requests_inline_location?: boolean;
}

export interface VirtualBotProfile {
  readonly id: number;
  readonly is_bot: true;
  readonly first_name: string;
  readonly username: string;
  readonly can_join_groups: boolean;
  readonly can_read_all_group_messages: boolean;
  readonly supports_guest_queries?: boolean;
  readonly supports_inline_queries: boolean;
  readonly can_connect_to_business: boolean;
  readonly has_main_web_app: boolean;
  readonly has_topics_enabled: boolean;
  readonly allows_users_to_create_topics: boolean;
  readonly can_manage_bots: boolean;
  readonly supports_join_request_queries: boolean;
}

export interface CreatedVirtualBot {
  readonly token: string;
  readonly bot: VirtualBotProfile;
}

/**
 * `429 Too Many Requests` answers queued for a bot's next Bot API calls, which receive them
 * instead of running.
 */
export interface RateLimitResponses {
  /** The method whose calls receive the answers, by its current name; omitted for every method. */
  readonly method?: string;
  /** The `retry_after`, in seconds, of every answer. */
  readonly retry_after: number;
  /** How many of the bot's next matching calls still receive an answer. */
  readonly remaining_count: number;
}

/**
 * What a URL of the session's emulated web serves. Telegram downloads the files bots send by URL;
 * the emulator downloads them from these resources and never from the network.
 */
export interface RegisterWebResourceInput {
  /** An HTTP or HTTPS URL, matched as Telegram reads the URL a bot sends. */
  readonly url: string;
  /** The HTTP status, from 200 to 599. Defaults to 200. */
  readonly status?: number;
  /**
   * The `Content-Type` header. Telegram sends a URL photo served as an image, and a URL document
   * served as `application/pdf` or `application/zip`.
   */
  readonly content_type?: string;
  /** The `Location` header of a redirect, relative to `url` or absolute. */
  readonly location?: string;
  /** The response body. Defaults to none. */
  readonly content?: Uint8Array;
}

/** A registered web resource, without the content the test supplied. */
export interface WebResource {
  /** The URL in the canonical form Telegram reads it in. */
  readonly url: string;
  readonly status: number;
  readonly content_type?: string;
  readonly location?: string;
  readonly content_length: number;
}

export interface QueueRateLimitResponsesInput {
  readonly bot_id: number;
  /** An implemented Bot API method, by any name Telegram accepts; omit it for every method. */
  readonly method?: string;
  /** The `retry_after`, in seconds, of every answer; at least 1. */
  readonly retry_after: number;
  /** How many of the bot's next matching calls receive an answer. Defaults to 1. */
  readonly count?: number;
}

export interface CreateVirtualAccountInput {
  readonly first_name: string;
  readonly last_name?: string;
  readonly username?: string;
  readonly language_code?: string;
  /**
   * Keeps forwards of the account's messages, and replies to them from other chats, from linking
   * to the account: their origin is a hidden user that shows only its name. Defaults to `false`.
   */
  readonly has_private_forwards?: boolean;
}

export interface VirtualAccountProfile {
  readonly id: number;
  readonly is_bot: false;
  readonly first_name: string;
  readonly last_name?: string;
  readonly username?: string;
  readonly language_code?: string;
}

export interface PrivateMessageTarget {
  readonly type: 'private';
  readonly botId: number;
}

/** A supergroup the account is a member of. */
export interface SupergroupMessageTarget {
  readonly type: 'supergroup';
  readonly chatId: number;
}

/** A chat an account writes to: its private chat with a bot, or a supergroup. */
export type MessageTarget = PrivateMessageTarget | SupergroupMessageTarget;

/** The messages a chat holds: private messages for a private chat, or supergroup messages. */
export type MessageIn<Target extends MessageTarget> = Target extends SupergroupMessageTarget
  ? SupergroupMessage
  : PrivateMessage;

export interface AccountSendMessageInput<Target extends MessageTarget = MessageTarget> {
  readonly to: Target;
  readonly text: string;
  /** Formatting of the text; entity types Telegram detects by itself are ignored. */
  readonly entities?: readonly MessageEntityInput[];
  /** The ID of the chat's message to reply to, as message history shows it. */
  readonly reply_to_message_id?: number;
}

export interface AccountSendPhotoInput<Target extends MessageTarget = MessageTarget> {
  readonly to: Target;
  /** A JPEG, PNG, GIF, WebP, or BMP image of at most 10 × 1024 × 1024 bytes. */
  readonly photo: Uint8Array;
  /** Omitted or empty for no caption. */
  readonly caption?: string;
  /** Formatting of the caption; entity types Telegram detects by itself are ignored. */
  readonly caption_entities?: readonly MessageEntityInput[];
  /** The ID of the chat's message to reply to, as message history shows it. */
  readonly reply_to_message_id?: number;
}

export interface AccountSendDocumentInput<Target extends MessageTarget = MessageTarget> {
  readonly to: Target;
  readonly document: Uint8Array;
  /** The file name, whose extension decides the document's MIME type. */
  readonly file_name: string;
  /** Omitted or empty for no caption. */
  readonly caption?: string;
  /** Formatting of the caption; entity types Telegram detects by itself are ignored. */
  readonly caption_entities?: readonly MessageEntityInput[];
  /** The ID of the chat's message to reply to, as message history shows it. */
  readonly reply_to_message_id?: number;
}

/** A photo or document of an album an account sends, with an optional caption. */
export type AccountMediaGroupItem =
  | {
    /** As `AccountSendPhotoInput` describes it. */
    readonly photo: Uint8Array;
    /** Omitted or empty for no caption. */
    readonly caption?: string;
    /** Formatting of the caption; entity types Telegram detects by itself are ignored. */
    readonly caption_entities?: readonly MessageEntityInput[];
  }
  | {
    readonly document: Uint8Array;
    /** The file name, whose extension decides the document's MIME type. */
    readonly file_name: string;
    /** Omitted or empty for no caption. */
    readonly caption?: string;
    /** Formatting of the caption; entity types Telegram detects by itself are ignored. */
    readonly caption_entities?: readonly MessageEntityInput[];
  };

export interface AccountSendMediaGroupInput<Target extends MessageTarget = MessageTarget> {
  readonly to: Target;
  /**
   * The album's photos or documents, in the order the chat shows them: at most 10, and documents
   * only among documents. A single item is sent as a message outside any album.
   */
  readonly media: readonly AccountMediaGroupItem[];
  /** The ID of the chat's message that every message of the album replies to. */
  readonly reply_to_message_id?: number;
}

export interface AccountForwardMessageInput<Target extends MessageTarget = MessageTarget> {
  /** The chat of the message to forward. */
  readonly from: MessageTarget;
  /** The ID of the message to forward, as message history shows it. */
  readonly message_id: number;
  readonly to: Target;
}

export interface CreateSupergroupInput {
  readonly title: string;
  /**
   * Makes the supergroup public under this username, unique among the session's usernames, so
   * that bots can address it as `@username`; omitted for a private supergroup.
   */
  readonly username?: string;
  readonly description?: string;
}

/** A supergroup as its creator sees it once created. */
export interface Supergroup {
  /** The Bot API `chat_id` of the supergroup, a negative number. */
  readonly id: number;
  readonly type: 'supergroup';
  readonly title: string;
  /** Omitted for a private supergroup. */
  readonly username?: string;
  readonly description?: string;
}

export interface AddChatMemberInput {
  readonly chat: SupergroupMessageTarget;
  /** The account or bot to add. */
  readonly userId: number;
}

export interface RemoveChatMemberInput {
  readonly chat: SupergroupMessageTarget;
  /** The account or bot to remove. */
  readonly userId: number;
}

export interface LeaveChatInput {
  readonly chat: SupergroupMessageTarget;
}

/**
 * A supergroup administrator right, by the Bot API's name. Any right includes `can_manage_chat`,
 * as on Telegram.
 */
export type SupergroupAdministratorRight =
  | 'can_manage_chat'
  | 'can_change_info'
  | 'can_delete_messages'
  | 'can_invite_users'
  | 'can_restrict_members'
  | 'can_pin_messages'
  | 'can_manage_topics'
  | 'can_promote_members'
  | 'can_manage_video_chats'
  | 'can_post_stories'
  | 'can_edit_stories'
  | 'can_delete_stories'
  | 'can_manage_tags'
  | 'can_send_welcome_messages';

export interface PromoteChatMemberInput {
  readonly chat: SupergroupMessageTarget;
  /** The member, account or bot, to promote. */
  readonly userId: number;
  /** The rights the administrator holds from now on; a right set to `true` is held. */
  readonly rights: Readonly<Partial<Record<SupergroupAdministratorRight, boolean>>>;
}

export interface DemoteChatMemberInput {
  readonly chat: SupergroupMessageTarget;
  /** The administrator, account or bot, to demote. */
  readonly userId: number;
}

export interface SetContentProtectionInput {
  readonly chat: SupergroupMessageTarget;
  readonly hasProtectedContent: boolean;
}

export interface ChangeSupergroupTitleInput {
  readonly chat: SupergroupMessageTarget;
  /** The new title, which Telegram cleans; one that cleans to nothing is refused. */
  readonly title: string;
}

export interface ChangeSupergroupDescriptionInput {
  readonly chat: SupergroupMessageTarget;
  /** The new description, which Telegram cleans; empty removes it. */
  readonly description: string;
}

export interface SetCustomTitleInput {
  readonly chat: SupergroupMessageTarget;
  /** The owner itself or an administrator, account or bot. */
  readonly userId: number;
  /** At most 16 characters without emoji; empty removes the title. */
  readonly customTitle: string;
}

export interface AccountEditMessageInput<Target extends MessageTarget = MessageTarget> {
  readonly chat: Target;
  /** The ID of the account's message to edit, as message history shows it. */
  readonly message_id: number;
  /** The new text, which must differ from the message's current text. */
  readonly text: string;
  /** Formatting of the new text; entity types Telegram detects by itself are ignored. */
  readonly entities?: readonly MessageEntityInput[];
}

export interface AccountDeleteMessageInput {
  readonly chat: MessageTarget;
  /** The ID of the message to delete, as message history shows it. */
  readonly message_id: number;
}

export interface AccountEditMessageCaptionInput<Target extends MessageTarget = MessageTarget> {
  readonly chat: Target;
  /** The ID of the account's photo or document to edit, as message history shows it. */
  readonly message_id: number;
  /** The new caption, which must differ from the current one; empty removes the caption. */
  readonly caption: string;
  /** Formatting of the new caption; entity types Telegram detects by itself are ignored. */
  readonly caption_entities?: readonly MessageEntityInput[];
}

export interface BotBlockInput {
  readonly botId: number;
}

export interface AccountMessageHistoryInput<Target extends MessageTarget = MessageTarget> {
  readonly chat: Target;
}

export interface PressCallbackButtonInput {
  readonly chat: MessageTarget;
  /** The ID of the message carrying the button, as message history shows it. */
  readonly message_id: number;
  /** The callback data of the button to press, in the inline keyboard or the rich message. */
  readonly callback_data: string;
  /**
   * Creates the query already expired: the bot still receives it but cannot answer it, as when a
   * bot that was offline catches up on queries whose answer deadline has passed.
   */
  readonly expired?: boolean;
}

export interface PressButtonInput {
  readonly chat: MessageTarget;
  /** The ID of the message carrying the button, as message history shows it. */
  readonly message_id: number;
  /** Selects exactly one button of the message, which must be a callback button. */
  readonly button: ButtonSelector;
  /** As for `pressCallbackButton`, creates the query already expired. */
  readonly expired?: boolean;
}

/** The parts of a message that show buttons: its rich message and its inline keyboard. */
export interface MessageWithButtons {
  readonly rich_message?: RichMessage;
  readonly reply_markup?: InlineKeyboardMarkup;
}

/**
 * A button of a message as the account's client shows it: a button of the rich message, in a row
 * or in text, or of the inline keyboard below it.
 */
export interface MessageButton {
  /** The button's text as plain text, with custom emoji shown by their alternative text. */
  readonly label: string;
  readonly button: InlineKeyboardButton | RichMessageButton;
  /** Where the button is in the message, such as `reply_markup.inline_keyboard[0][1]`. */
  readonly path: string;
  /** The parts of the message that enclose the button, outermost first. */
  readonly containers: readonly ButtonContainer[];
}

/** A block of a rich message that encloses a button. */
export interface RichBlockButtonContainer {
  readonly kind: 'block';
  readonly block: RichBlock;
  /** The block list that holds the block, which gives its neighbors. */
  readonly siblingBlocks: readonly RichBlock[];
  /** The block's index in `siblingBlocks`. */
  readonly index: number;
  /** Everything the block shows as plain text, including button labels. */
  readonly text: string;
  readonly path: string;
}

/** A list item, table row, or inline keyboard row that encloses a button. */
export interface ButtonRowContainer {
  readonly kind: 'list_item' | 'table_row' | 'inline_keyboard_row';
  /** Everything the item or row shows as plain text, including button labels. */
  readonly text: string;
  readonly path: string;
}

export type ButtonContainer = RichBlockButtonContainer | ButtonRowContainer;

/**
 * Selects a button by its label, optionally within a part of the message. `within` names the
 * innermost parts whose text contains the string or matches the pattern, so that `within: 'Potion'`
 * selects the table row that mentions Potion rather than the whole table.
 */
export interface ButtonLabelSelector {
  /** The whole label, or a pattern the label matches. */
  readonly label: string | RegExp;
  readonly within?: string | RegExp;
}

/** A label selector, or a predicate that inspects each button's label, path, and containers. */
export type ButtonSelector = ButtonLabelSelector | ((button: MessageButton) => boolean);

export interface PrivateChat {
  readonly id: number;
  readonly type: 'private';
  readonly first_name: string;
  readonly last_name?: string;
  readonly username?: string;
}

export interface SupergroupChat {
  readonly id: number;
  readonly title: string;
  /** Omitted for a private supergroup. */
  readonly username?: string;
  readonly type: 'supergroup';
}

/** Offsets and lengths count UTF-16 code units. */
interface MessageEntitySpan {
  readonly offset: number;
  readonly length: number;
}

/**
 * Entity types that carry nothing beyond their span. Telegram detects mentions, hashtags,
 * cashtags, bot commands, URLs, email addresses and bank card numbers in text by itself.
 */
export type PlainMessageEntityType =
  | 'mention'
  | 'hashtag'
  | 'cashtag'
  | 'bot_command'
  | 'url'
  | 'email'
  | 'bank_card_number'
  | 'bold'
  | 'italic'
  | 'underline'
  | 'strikethrough'
  | 'spoiler'
  | 'code'
  | 'blockquote'
  | 'expandable_blockquote';

/** An entity Telegram detected in a message's text, or formatting its sender applied. */
export type MessageEntity =
  | (MessageEntitySpan & { readonly type: PlainMessageEntityType })
  | (MessageEntitySpan & { readonly type: 'pre'; readonly language?: string })
  | (MessageEntitySpan & { readonly type: 'text_link'; readonly url: string })
  | (MessageEntitySpan & {
    readonly type: 'text_mention';
    readonly user: VirtualAccountProfile | MessageSenderBot;
  })
  | (MessageEntitySpan & { readonly type: 'custom_emoji'; readonly custom_emoji_id: string })
  | (MessageEntitySpan & {
    readonly type: 'date_time';
    readonly unix_time: number;
    /**
     * `r` for relative time, otherwise `w` for the day of the week, `d` or `D` for a short or
     * long date, then `t` or `T` for a short or long time; empty when the bot chose no format.
     */
    readonly date_time_format: string;
  });

/**
 * Formatting an account applies to its text or caption, as bots specify it; a text mention names
 * its user by ID alone. Entities of received messages can be sent back as they are.
 */
export type MessageEntityInput =
  | Exclude<MessageEntity, { readonly type: 'text_mention' }>
  | (MessageEntitySpan & { readonly type: 'text_mention'; readonly user: { readonly id: number } });

/** A bot as a message sender, without the capabilities that only getMe reports. */
export interface MessageSenderBot {
  readonly id: number;
  readonly is_bot: true;
  readonly first_name: string;
  readonly last_name?: string;
  readonly username: string;
}

/** A button's text and how Telegram clients draw it. */
export interface KeyboardButtonFace {
  readonly text: string;
  /** The custom emoji shown before the text; omitted for none. */
  readonly icon_custom_emoji_id?: string;
  /** Omitted for the client's default style. */
  readonly style?: 'primary' | 'danger' | 'success';
}

export interface CallbackInlineKeyboardButton extends KeyboardButtonFace {
  readonly callback_data: string;
}

/** A button that opens a link, including a login button, which the emulator shows by its URL. */
export interface UrlInlineKeyboardButton extends KeyboardButtonFace {
  readonly url: string;
}

/** A button that copies text to the clipboard. */
export interface CopyTextInlineKeyboardButton extends KeyboardButtonFace {
  readonly copy_text: { readonly text: string };
}

/**
 * A button that puts the bot's username and a query into the input field of a chat the user
 * chooses; tests send the inline query itself.
 */
export interface SwitchInlineQueryInlineKeyboardButton extends KeyboardButtonFace {
  readonly switch_inline_query: string;
}

/** A button that puts the bot's username and a query into the message's own chat. */
export interface SwitchInlineQueryCurrentChatInlineKeyboardButton extends KeyboardButtonFace {
  readonly switch_inline_query_current_chat: string;
}

/** A switch-inline button that lets the user choose only some kinds of chats. */
export interface SwitchInlineQueryChosenChatInlineKeyboardButton extends KeyboardButtonFace {
  readonly switch_inline_query_chosen_chat: {
    readonly query: string;
    readonly allow_user_chats: boolean;
    readonly allow_bot_chats: boolean;
    readonly allow_group_chats: boolean;
    readonly allow_channel_chats: boolean;
  };
}

/** A button that opens a Web App of the message's bot. */
export interface WebAppInlineKeyboardButton extends KeyboardButtonFace {
  readonly web_app: { readonly url: string };
}

/** A button that does nothing. */
export interface DisabledInlineKeyboardButton extends KeyboardButtonFace {
  readonly disabled: Record<string, never>;
}

export type InlineKeyboardButton =
  | CallbackInlineKeyboardButton
  | UrlInlineKeyboardButton
  | CopyTextInlineKeyboardButton
  | SwitchInlineQueryInlineKeyboardButton
  | SwitchInlineQueryCurrentChatInlineKeyboardButton
  | SwitchInlineQueryChosenChatInlineKeyboardButton
  | WebAppInlineKeyboardButton
  | DisabledInlineKeyboardButton;

export interface InlineKeyboardMarkup {
  readonly inline_keyboard: readonly (readonly InlineKeyboardButton[])[];
}

/** A file of a message: a photo size or a document. */
interface MessageFile {
  /**
   * The identifier by which the message's observer knows the file. As on Telegram, each user
   * knows a file by a `file_id` of its own.
   */
  readonly file_id: string;
  /** The same for every user; `downloadFile` reads the file by it. */
  readonly file_unique_id: string;
  readonly file_size: number;
}

/** A photo in one size. The emulator keeps a photo in the one size it was sent in. */
export interface PhotoSize extends MessageFile {
  readonly width: number;
  readonly height: number;
}

export interface Document extends MessageFile {
  readonly file_name: string;
  readonly mime_type: string;
  /** The preview image the sender uploaded with the document; omitted for none. */
  readonly thumbnail?: PhotoSize;
  /** Legacy copy of `thumbnail`, which the Bot API still shows. */
  readonly thumb?: PhotoSize;
}

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
    readonly user: VirtualAccountProfile | MessageSenderBot;
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
  | { readonly type: 'document'; readonly document: Document; readonly caption?: RichBlockCaption };

/** A message a bot laid out in blocks. */
export interface RichMessage {
  readonly blocks: readonly RichBlock[];
  /** Present when clients show the message right-to-left. */
  readonly is_rtl?: true;
}

/**
 * The fields that show what a message is: text, a photo, a document, or a rich message. Each kind
 * declares the others' fields absent, so that any of them can be read from a message of unknown
 * kind.
 */
export type MessageContent =
  | {
    readonly text: string;
    readonly entities?: readonly MessageEntity[];
    readonly photo?: never;
    readonly document?: never;
    readonly caption?: never;
    readonly caption_entities?: never;
    readonly rich_message?: never;
  }
  | {
    readonly text?: never;
    readonly entities?: never;
    /** The photo's sizes, smallest first. */
    readonly photo: readonly PhotoSize[];
    readonly document?: never;
    /** Omitted for a photo without a caption. */
    readonly caption?: string;
    readonly caption_entities?: readonly MessageEntity[];
    /** Present when clients show the caption above the photo. */
    readonly show_caption_above_media?: true;
    /** Present when clients cover the photo until the user reveals it. */
    readonly has_media_spoiler?: true;
    readonly rich_message?: never;
  }
  | {
    readonly text?: never;
    readonly entities?: never;
    readonly photo?: never;
    readonly document: Document;
    /** Omitted for a document without a caption. */
    readonly caption?: string;
    readonly caption_entities?: readonly MessageEntity[];
    readonly rich_message?: never;
  }
  | {
    readonly text?: never;
    readonly entities?: never;
    readonly photo?: never;
    readonly document?: never;
    readonly caption?: never;
    readonly caption_entities?: never;
    /** A message a bot laid out in blocks, which only bots send. */
    readonly rich_message: RichMessage;
  };

/** The fields of a change of a supergroup's members or title, which content never has. */
interface NoSupergroupChange {
  readonly new_chat_participant?: never;
  readonly new_chat_member?: never;
  readonly new_chat_members?: never;
  readonly left_chat_participant?: never;
  readonly left_chat_member?: never;
  readonly new_chat_title?: never;
}

/** The fields of content, which a service message never has. */
interface NoContent {
  readonly text?: never;
  readonly entities?: never;
  readonly photo?: never;
  readonly document?: never;
  readonly caption?: never;
  readonly caption_entities?: never;
  readonly rich_message?: never;
}

/**
 * The fields of a service message about members joining or leaving a supergroup, which take the
 * place of content. As Telegram does, each change also carries its legacy fields.
 */
export type MembershipChangeContent =
  | (NoContent & {
    readonly new_chat_title?: never;
    /** Legacy alias of `new_chat_member`. */
    readonly new_chat_participant: VirtualAccountProfile | MessageSenderBot;
    /** Legacy: the requesting account if it joined, otherwise the first new member. */
    readonly new_chat_member: VirtualAccountProfile | MessageSenderBot;
    readonly new_chat_members: readonly (VirtualAccountProfile | MessageSenderBot)[];
    readonly left_chat_participant?: never;
    readonly left_chat_member?: never;
  })
  | (NoContent & {
    readonly new_chat_title?: never;
    readonly new_chat_participant?: never;
    readonly new_chat_member?: never;
    readonly new_chat_members?: never;
    /** Legacy alias of `left_chat_member`. */
    readonly left_chat_participant: VirtualAccountProfile | MessageSenderBot;
    /** The member that left or was removed. */
    readonly left_chat_member: VirtualAccountProfile | MessageSenderBot;
  });

/** The field of a service message about a supergroup's new title. */
export type TitleChangeContent =
  & NoContent
  & Omit<NoSupergroupChange, 'new_chat_title'>
  & { readonly new_chat_title: string };

/** What a supergroup message shows: content, or a change of the supergroup's members or title. */
export type SupergroupMessageContent =
  | (MessageContent & NoSupergroupChange)
  | MembershipChangeContent
  | TitleChangeContent;

/** Who first sent a forwarded message, and when. */
export interface MessageOriginUser {
  readonly type: 'user';
  readonly sender_user: VirtualAccountProfile | MessageSenderBot;
  readonly date: number;
}

/** The name of an account with private forwards that first sent a forwarded message, and when. */
export interface MessageOriginHiddenUser {
  readonly type: 'hidden_user';
  readonly sender_user_name: string;
  readonly date: number;
}

/** Where a forwarded message, or the message of another chat a reply shows, first appeared. */
export type MessageOrigin = MessageOriginUser | MessageOriginHiddenUser;

/**
 * A message of another chat that a message replies to: who first wrote it and when, the
 * supergroup message it is, and its media, whose caption the reply's quote shows instead.
 */
export type ExternalReplyInfo =
  & {
    readonly origin: MessageOrigin;
    /** The replied message's supergroup; absent for a message of a private chat. */
    readonly chat?: SupergroupChat;
    /** The replied message's ID in its supergroup; absent for a message of a private chat. */
    readonly message_id?: number;
  }
  & (
    | { readonly photo?: never; readonly has_media_spoiler?: never; readonly document?: never }
    | { readonly photo: readonly PhotoSize[]; readonly has_media_spoiler?: true }
    | { readonly document: Document }
  );

/** The quoted part of the text or caption of a replied message. */
export interface TextQuote {
  readonly text: string;
  readonly entities?: readonly MessageEntity[];
  /** Where the quote starts in the replied text, in UTF-16 code units. */
  readonly position: number;
  /** Present when the sender chose the quote, rather than Telegram quoting the message. */
  readonly is_manual?: true;
}

/** How a message replies to a message of another chat, and what it quotes of a replied message. */
interface MessageReplyInfo {
  /** Present for a reply to a message of another chat. */
  readonly external_reply?: ExternalReplyInfo;
  /** Present for a reply that quotes the replied message. */
  readonly quote?: TextQuote;
}

/** The album a message belongs to, which follows its reply and precedes its content. */
interface MessageAlbumInfo {
  /** The identifier the messages of an album share; present only for a message of an album. */
  readonly media_group_id?: string;
}

/** The fields that precede a message's reply and content. */
interface MessageHeader<Chat> {
  readonly message_id: number;
  readonly from: VirtualAccountProfile | MessageSenderBot;
  readonly chat: Chat;
  readonly date: number;
  /** Present once the message's author has edited its text or caption. */
  readonly edit_date?: number;
  /** Present for a forward. */
  readonly forward_origin?: MessageOrigin;
  /** Telegram's legacy form of the origin's sender, present for a forward of a user's message. */
  readonly forward_from?: VirtualAccountProfile | MessageSenderBot;
  /** Telegram's legacy form of the origin's name, present for a forward of a hidden user. */
  readonly forward_sender_name?: string;
  /** Telegram's legacy form of the origin's date, present for a forward. */
  readonly forward_date?: number;
}

/** The fields that follow a message's content. */
interface MessageTrailer {
  /** The inline keyboard a bot attached to its message, or to a message sent through it. */
  readonly reply_markup?: InlineKeyboardMarkup;
  /** The bot through whose inline mode an account sent the message. */
  readonly via_bot?: MessageSenderBot;
  /** Present when the bot protected its message from forwarding and saving. */
  readonly has_protected_content?: true;
  /** The message effect a bot sent a private message with. */
  readonly effect_id?: string;
}

/** A message as a reply shows it, without its own reply. */
export type RepliedPrivateMessage =
  & MessageHeader<PrivateChat>
  & MessageReplyInfo
  & MessageAlbumInfo
  & MessageContent
  & MessageTrailer;

/**
 * A private-chat message as the conversation's bot sees it: numbered in the bot's message box,
 * with the account as its chat, whichever participant wrote it.
 */
export type PrivateMessage =
  & MessageHeader<PrivateChat>
  & {
    /** The message this one replies to, unless it was deleted; it never shows its own reply. */
    readonly reply_to_message?: RepliedPrivateMessage;
  }
  & MessageReplyInfo
  & MessageAlbumInfo
  & MessageContent
  & MessageTrailer;

/** A message as a reply shows it, without its own reply. */
export type RepliedSupergroupMessage =
  & MessageHeader<SupergroupChat>
  & MessageReplyInfo
  & MessageAlbumInfo
  & SupergroupMessageContent
  & MessageTrailer;

/**
 * A supergroup message as the requesting account sees it: numbered once by the supergroup, and
 * written by an account or a bot, or a service message about members joining or leaving, from the
 * member who made the change. Members see the same message, apart from the `file_id` of its file
 * and the legacy `new_chat_member` of a service message.
 */
export type SupergroupMessage =
  & MessageHeader<SupergroupChat>
  & {
    /** The message this one replies to, unless it was deleted; it never shows its own reply. */
    readonly reply_to_message?: RepliedSupergroupMessage;
  }
  & MessageReplyInfo
  & MessageAlbumInfo
  & SupergroupMessageContent
  & MessageTrailer;

/**
 * Administrator rights that a chat request requires: every right that applies to the requested
 * kind of chat, by its Bot API name, required or not.
 */
export type RequiredChatAdministratorRights = Readonly<Record<string, boolean>>;

/**
 * What a reply keyboard button asks the client to share instead of sending its text, in the
 * fields of a Bot API `KeyboardButton`. The emulator cannot answer these requests, so such
 * buttons cannot be pressed.
 */
export type ReplyKeyboardButtonRequest =
  | { readonly request_contact: true }
  | { readonly request_location: true }
  | { readonly request_poll: { readonly type?: 'quiz' | 'regular' } }
  | { readonly web_app: { readonly url: string } }
  | {
    readonly request_users: {
      readonly request_id: number;
      readonly user_is_bot?: boolean;
      readonly user_is_premium?: boolean;
      readonly max_quantity: number;
      readonly request_name: boolean;
      readonly request_username: boolean;
      readonly request_photo: boolean;
    };
  }
  | {
    readonly request_chat: {
      readonly request_id: number;
      readonly chat_is_channel: boolean;
      readonly chat_is_forum?: boolean;
      readonly chat_has_username?: boolean;
      readonly chat_is_created: boolean;
      readonly user_administrator_rights?: RequiredChatAdministratorRights;
      readonly bot_administrator_rights?: RequiredChatAdministratorRights;
      readonly bot_is_member: boolean;
      readonly request_title: boolean;
      readonly request_username: boolean;
      readonly request_photo: boolean;
    };
  };

/**
 * A reply keyboard button, which sends its text to the chat when pressed, or asks the client to
 * share what its request describes.
 */
export type ReplyKeyboardButton =
  | KeyboardButtonFace
  | (KeyboardButtonFace & ReplyKeyboardButtonRequest);

/** A custom keyboard the account's client shows in place of its letter keyboard. */
export interface ReplyKeyboardInterface {
  readonly type: 'keyboard';
  /** The ID of the bot message that sent the keyboard, as message history shows it. */
  readonly message_id: number;
  readonly keyboard: readonly (readonly ReplyKeyboardButton[])[];
  readonly is_persistent: boolean;
  readonly resize_keyboard: boolean;
  /**
   * Whether clients hide the keyboard once it is used; the keyboard stays available, so its
   * buttons can still be pressed.
   */
  readonly one_time_keyboard: boolean;
  readonly input_field_placeholder?: string;
}

/** A reply interface to a bot message, which the account's client shows as if replying to it. */
export interface ForceReplyInterface {
  readonly type: 'force_reply';
  /** The ID of the bot message to reply to, as message history shows it. */
  readonly message_id: number;
  readonly input_field_placeholder?: string;
}

/** What the account's client shows in place of its usual input in a chat with a bot. */
export type ReplyInterface = ReplyKeyboardInterface | ForceReplyInterface;

export interface PressReplyKeyboardButtonInput<Target extends MessageTarget = MessageTarget> {
  readonly chat: Target;
  /** The text of the button to press, which the account then sends to the chat. */
  readonly text: string;
}

export interface AccountReplyInterfaceInput {
  readonly chat: MessageTarget;
}

/** A bot command as an account's client lists it. */
export interface BotCommand {
  /** The command without its leading slash. */
  readonly command: string;
  readonly description: string;
  readonly is_ephemeral: boolean;
}

/**
 * The button an account's client shows next to the message field of a private chat with a bot:
 * the bot's commands, a Web App, or `default` when the bot chose no specific button.
 */
export type MenuButton =
  | { readonly type: 'commands' }
  | { readonly type: 'web_app'; readonly text: string; readonly web_app: { readonly url: string } }
  | { readonly type: 'default' };

/** The notification an account's client shows for another participant's message. */
export interface Notification {
  /** The notifying message's ID, as the chat's bots see it. */
  readonly message_id: number;
  /** Whether the sender asked for the notification to play no sound, as `disable_notification`. */
  readonly is_silent: boolean;
}

/** What a bot shows it is doing in a chat, by the Bot API's lowercase action name. */
export interface ChatAction {
  readonly bot_id: number;
  readonly action:
    | 'typing'
    | 'record_video'
    | 'upload_video'
    | 'record_voice'
    | 'upload_voice'
    | 'upload_photo'
    | 'upload_document'
    | 'choose_sticker'
    | 'find_location'
    | 'record_video_note'
    | 'upload_video_note';
}

/** The commands one bot of a supergroup suggests to an account. */
export interface SupergroupBotCommands {
  readonly bot_id: number;
  readonly commands: readonly BotCommand[];
}

export interface CallbackQueryAnswer {
  /** Omitted when the answer shows no notification. */
  readonly text?: string;
  readonly show_alert: boolean;
  /** The link that starts the bot, which the client opens; omitted when the answer has none. */
  readonly url?: string;
  readonly cache_time: number;
}

/** Whether the bot can still answer a callback query, and if not, why. */
export type CallbackQueryStatus = 'awaiting_answer' | 'answered' | 'expired';

/** A callback button press by an account, with the bot's answer once it has answered. */
export interface CallbackQuery {
  readonly id: string;
  readonly callback_data: string;
  readonly status: CallbackQueryStatus;
  /** The bot's answer when `status` is `answered`, and `null` otherwise. */
  readonly answer: CallbackQueryAnswer | null;
}

export interface SendInlineQueryInput {
  /** The inline bot, whose username the account types before the query. */
  readonly bot_id: number;
  /** The chat where the account types the query, to which a chosen result is sent. */
  readonly chat: MessageTarget;
  /** Up to 256 characters; omitted or empty when the account types only the bot's username. */
  readonly query?: string;
  /** The `next_offset` of an earlier answer, requesting more results; omitted for the first. */
  readonly offset?: string;
  /**
   * Where the account is, shared only with a bot created with `requests_inline_location`;
   * omitted to share no location.
   */
  readonly location?: LocationInput;
}

/** A point on Earth an account shares. */
export interface LocationInput {
  /** From -90 to 90 degrees. */
  readonly latitude: number;
  /** From -180 to 180 degrees. */
  readonly longitude: number;
  /** The radius of uncertainty, from 0 to 1500 meters; omitted or 0 when unknown. */
  readonly horizontal_accuracy?: number;
}

/** A point on Earth, as Telegram shows it. */
export interface Location {
  readonly latitude: number;
  readonly longitude: number;
  /** The radius of uncertainty in whole meters; omitted when unknown. */
  readonly horizontal_accuracy?: number;
}

/** A result of an answer as the account's client lists it. */
export interface InlineQueryResultListing {
  readonly type: 'article' | 'photo' | 'document';
  readonly id: string;
  readonly title?: string;
  readonly description?: string;
  /** The URL an article shows. */
  readonly url?: string;
}

/** The button the account's client shows above the results. */
export type InlineQueryResultsButton =
  | { readonly text: string; readonly start_parameter: string }
  | { readonly text: string; readonly web_app: { readonly url: string } };

export interface InlineQueryAnswer {
  readonly results: readonly InlineQueryResultListing[];
  readonly cache_time: number;
  readonly is_personal: boolean;
  /** Empty when there are no more results. */
  readonly next_offset: string;
  readonly button?: InlineQueryResultsButton;
}

/** Whether the bot has answered an inline query. */
export type InlineQueryStatus = 'awaiting_answer' | 'answered';

/** An inline query an account sent, with the bot's answer once it has answered. */
export interface InlineQuery {
  readonly id: string;
  readonly bot_id: number;
  readonly chat: MessageTarget;
  readonly query: string;
  readonly offset: string;
  /** The location the account shared with the bot; omitted for none. */
  readonly location?: Location;
  readonly status: InlineQueryStatus;
  /** The bot's answer when `status` is `answered`, and `null` otherwise. */
  readonly answer: InlineQueryAnswer | null;
}

export interface ChooseInlineQueryResultInput {
  readonly inline_query_id: string;
  /** The identifier of a result of the bot's answer. */
  readonly result_id: string;
}

export interface VirtualAccountClient extends VirtualAccountProfile {
  /**
   * Sends a message as this virtual Telegram account, to a bot or to a supergroup this account is
   * a member of. In a supergroup, bots in privacy mode receive only commands, replies to their
   * messages, and mentions of them.
   */
  sendMessage<Target extends MessageTarget>(
    input: AccountSendMessageInput<Target>,
  ): Promise<MessageIn<Target>>;
  /**
   * Sends a photo, with an optional caption, as this account, as `sendMessage` sends text. The
   * emulator reads the image's dimensions and rejects content that is not an image.
   */
  sendPhoto<Target extends MessageTarget>(
    input: AccountSendPhotoInput<Target>,
  ): Promise<MessageIn<Target>>;
  /** Sends a file as a document, with an optional caption, as `sendMessage` sends text. */
  sendDocument<Target extends MessageTarget>(
    input: AccountSendDocumentInput<Target>,
  ): Promise<MessageIn<Target>>;
  /**
   * Sends photos or documents as an album, as `sendPhoto` and `sendDocument` send one, and returns
   * the album's messages in order, which share a `media_group_id`. The chat's bots receive each
   * message as a separate update, in the album's order.
   */
  sendMediaGroup<Target extends MessageTarget>(
    input: AccountSendMediaGroupInput<Target>,
  ): Promise<readonly MessageIn<Target>[]>;
  /**
   * Forwards a message of one of this account's chats to a chat it can write to, as the account's
   * message, which shows who first sent it. The chat's bots receive it as `sendMessage` describes.
   * Messages protected from forwarding and service messages cannot be forwarded.
   */
  forwardMessage<Target extends MessageTarget>(
    input: AccountForwardMessageInput<Target>,
  ): Promise<MessageIn<Target>>;
  /**
   * Edits the text of a message this account sent, which sends the chat's bots an
   * `edited_message` update as they received the message. Returns the edited message.
   */
  editMessage<Target extends MessageTarget>(
    input: AccountEditMessageInput<Target>,
  ): Promise<MessageIn<Target>>;
  /** Edits the caption of a photo or document this account sent, as `editMessage` edits text. */
  editMessageCaption<Target extends MessageTarget>(
    input: AccountEditMessageCaptionInput<Target>,
  ): Promise<MessageIn<Target>>;
  /**
   * Deletes a message for every participant of the chat, as Telegram's clients do; the chat's
   * bots receive no update for it. In a private chat, the account deletes either participant's
   * messages. In a supergroup, it deletes its own messages, and any message as the owner or as an
   * administrator with the `can_delete_messages` right.
   */
  deleteMessage(input: AccountDeleteMessageInput): Promise<void>;
  /** Creates a supergroup that this account owns. */
  createSupergroup(input: CreateSupergroupInput): Promise<Supergroup>;
  /**
   * Adds an account or a bot to a supergroup this account owns, which a `new_chat_members`
   * service message records. An added bot first receives a `my_chat_member` update. Adding a
   * removed member lifts its ban; adding a member again has no effect.
   */
  addChatMember(input: AddChatMemberInput): Promise<void>;
  /**
   * Removes an account or a bot from a supergroup this account owns, which bans it until it is
   * added again, and which a `left_chat_member` service message records. A removed bot receives a
   * `my_chat_member` update showing it as `kicked` and the service message, and its later
   * requests there fail with `403 Forbidden: bot was kicked from the supergroup chat`. Removing a
   * non-member has no effect.
   */
  removeChatMember(input: RemoveChatMemberInput): Promise<void>;
  /**
   * Leaves a supergroup, which a `left_chat_member` service message records. The owner cannot
   * leave. Leaving a supergroup this account is not a member of has no effect.
   */
  leaveChat(input: LeaveChatInput): Promise<void>;
  /**
   * Promotes a member of a supergroup this account owns to administrator with the given rights,
   * which must include at least one, or replaces an administrator's rights. A promoted bot
   * receives a `my_chat_member` update showing it as `administrator`, receives every message of
   * the supergroup, and uses its rights: `can_delete_messages` lets it delete any message there,
   * and `can_restrict_members` lets it ban and unban members.
   */
  promoteChatMember(input: PromoteChatMemberInput): Promise<void>;
  /**
   * Demotes an administrator of a supergroup this account owns to a member. A demoted bot
   * receives a `my_chat_member` update showing it as `member`. Demoting a member that is no
   * administrator has no effect.
   */
  demoteChatMember(input: DemoteChatMemberInput): Promise<void>;
  /**
   * Sets this account's own custom title in a supergroup it owns, or an administrator's, which
   * bots see as `custom_title` in its chat member. An administrator keeps its title when its
   * rights change, and loses it when demoted.
   */
  setCustomTitle(input: SetCustomTitleInput): Promise<void>;
  /**
   * Protects all content of a supergroup this account owns from forwarding and saving, as
   * Telegram's "Restrict saving content" setting does, or lifts that protection with
   * `hasProtectedContent: false`. Every message of the supergroup then shows
   * `has_protected_content`, and only bots can copy them.
   */
  setContentProtection(input: SetContentProtectionInput): Promise<void>;
  /**
   * Changes the title of a supergroup this account is a member of, which Telegram cleans. Bots of
   * the supergroup receive a service message with `new_chat_title`; a title the supergroup has
   * changes nothing.
   */
  changeSupergroupTitle(input: ChangeSupergroupTitleInput): Promise<void>;
  /**
   * Changes the description of a supergroup this account is a member of, which Telegram cleans;
   * no service message records it. Telegram refuses the description the supergroup has.
   */
  changeSupergroupDescription(input: ChangeSupergroupDescriptionInput): Promise<void>;
  /**
   * Blocks a bot, which Telegram calls stopping it. The bot receives a `my_chat_member` update
   * showing it as `kicked`, its messages to this account fail with `403 Forbidden: bot was
   * blocked by the user`, and this account cannot write to it until it unblocks the bot. Blocking
   * a blocked bot has no effect.
   */
  blockBot(input: BotBlockInput): Promise<void>;
  /**
   * Unblocks a bot, which receives a `my_chat_member` update showing it as a `member` again.
   * Unblocking a bot that is not blocked has no effect.
   */
  unblockBot(input: BotBlockInput): Promise<void>;
  /**
   * Returns the messages of a private conversation or of a supergroup this account is a member
   * of, whoever wrote them, oldest first.
   */
  getMessages<Target extends MessageTarget>(
    input: AccountMessageHistoryInput<Target>,
  ): Promise<readonly MessageIn<Target>[]>;
  /**
   * Returns the chat actions, such as typing, that this account's client shows in its private
   * chat with a bot or in a supergroup it is a member of. A bot's action lasts 5.5 seconds unless
   * the bot sends it again, and ends when the bot cancels it or sends a message to the chat.
   */
  getChatActions(input: AccountChatActionsInput): Promise<readonly ChatAction[]>;
  /**
   * Returns the notifications this account's client shows for the messages other participants
   * sent to its private chat with a bot or to a supergroup it is a member of, oldest first. A
   * notification is silent when a bot sent its message with `disable_notification`.
   */
  getNotifications(input: AccountNotificationsInput): Promise<readonly Notification[]>;
  /**
   * Presses a callback button on a bot's message, in a private chat or a supergroup, which sends
   * the bot a callback query. The bot answers asynchronously; read the answer with
   * `getCallbackQuery`.
   */
  pressCallbackButton(input: PressCallbackButtonInput): Promise<CallbackQuery>;
  /**
   * Presses the callback button a selector picks on a message as the account's history shows it
   * now, as `pressCallbackButton` presses it by its callback data. Throws a `ButtonSelectionError`
   * listing the candidates unless exactly one button matches and it is a callback button.
   */
  pressButton(input: PressButtonInput): Promise<CallbackQuery>;
  /** Returns a callback query this account created, with the bot's answer once given. */
  getCallbackQuery(callbackQueryId: string): Promise<CallbackQuery>;
  /**
   * Types an inline query for a bot with inline mode turned on, in a chat this account can write
   * to, which sends the bot an `inline_query` update. The bot answers asynchronously; read the
   * answer with `getInlineQuery`.
   */
  sendInlineQuery(input: SendInlineQueryInput): Promise<InlineQuery>;
  /** Returns an inline query this account sent, with the bot's answer once given. */
  getInlineQuery(inlineQueryId: string): Promise<InlineQuery>;
  /**
   * Sends a result of the bot's answer to the chat where the query was typed, as this account's
   * message with `via_bot`. The chat's bots receive it as any message of this account, and a bot
   * with inline feedback receives a `chosen_inline_result` update. Presses of the message's
   * callback buttons reach the inline bot, which edits the message by its `inline_message_id`.
   */
  chooseInlineQueryResult(
    input: ChooseInlineQueryResultInput,
  ): Promise<PrivateMessage | SupergroupMessage>;
  /**
   * Returns the commands this account's client suggests in its private chat with a bot: the
   * bot's list for the chat, for all private chats, or by default, in the account's language if
   * the bot has one.
   */
  getBotCommands(input: AccountBotCommandsInput): Promise<readonly BotCommand[]>;
  /**
   * Returns the menu button this account's client shows in its private chat with a bot: the
   * bot's button for this account, or else for all its private chats.
   */
  getMenuButton(input: AccountMenuButtonInput): Promise<MenuButton>;
  /**
   * Returns the commands this account's client suggests in a supergroup it is a member of, for
   * each bot of the supergroup that has any: the bot's list for the account as a member, for the
   * supergroup's administrators, for the supergroup, for all groups' administrators, for all
   * groups, or by default, where administrator lists apply only to administrators, in the
   * account's language if the bot has one.
   */
  getSupergroupBotCommands(
    input: AccountSupergroupBotCommandsInput,
  ): Promise<readonly SupergroupBotCommands[]>;
  /**
   * Returns the reply keyboard or forced reply this account's client shows in its private chat
   * with a bot or in a supergroup it is a member of, or `null` when it shows its usual input. In a
   * supergroup, a bot's selective markup reaches only the members its message mentions and the
   * sender of the message it replies to.
   */
  getReplyInterface(input: AccountReplyInterfaceInput): Promise<ReplyInterface | null>;
  /**
   * Presses a button of the reply keyboard the chat shows, which sends the button's text as this
   * account's message; in a supergroup, the message replies to the keyboard's message, as
   * Telegram's clients send it. Fails when the chat shows no keyboard with such a button.
   */
  pressReplyKeyboardButton<Target extends MessageTarget>(
    input: PressReplyKeyboardButtonInput<Target>,
  ): Promise<MessageIn<Target>>;
}

export interface AccountChatActionsInput {
  readonly chat: MessageTarget;
}

export interface AccountNotificationsInput {
  readonly chat: MessageTarget;
}

export interface AccountBotCommandsInput {
  readonly chat: PrivateMessageTarget;
}

export interface AccountMenuButtonInput {
  readonly chat: PrivateMessageTarget;
}

export interface AccountSupergroupBotCommandsInput {
  readonly chat: SupergroupMessageTarget;
}

export interface CreatedVirtualAccount {
  readonly account: VirtualAccountClient;
}

export type BotActivityKind = BotActivityEntry['kind'];

/** A file a call uploaded, described without its content. */
export interface UploadedFileDescription {
  /** The multipart field that carried the file. */
  readonly field_name: string;
  readonly file_name: string;
  readonly size_bytes: number;
}

/** The Bot API answer a bot received to a call. */
export type BotApiCallAnswer =
  | { readonly ok: true; readonly result: unknown; readonly description?: string }
  | {
    readonly ok: false;
    readonly error_code: number;
    readonly description: string;
    readonly parameters?: { readonly retry_after: number };
  };

/**
 * A bot's call of a Bot API method, whether it ran, failed, or is not implemented. `getUpdates`
 * calls are not recorded; the updates they deliver and confirm are.
 */
export interface BotApiCallEntry {
  /** Where the entry stands in the session's log; each entry's is 1 greater than the last. */
  readonly position: number;
  readonly kind: 'bot_api_call';
  readonly bot_id: number;
  /**
   * The method's current name, whichever name the bot called it by; the name as called for a
   * method the emulator does not implement.
   */
  readonly method: string;
  /** The method name as the bot called it. */
  readonly requested_method: string;
  /** Whether the call was an HTTP request or a webhook's response to an update. */
  readonly via: 'http' | 'webhook_reply';
  /**
   * The parameters as the bot sent them, as text: `chat_id: 1` is recorded as `"1"`, and structured
   * parameters such as `reply_markup` as JSON text. Empty when the request could not be decoded.
   */
  readonly parameters: Readonly<Record<string, string>>;
  readonly uploaded_files: readonly UploadedFileDescription[];
  /** The chat `chat_id` names, with a public username resolved; omitted when it names none. */
  readonly chat_id?: number;
  readonly answer: BotApiCallAnswer;
}

/** A Bot API update, such as grammY's `Update` describes. */
export interface BotApiUpdate {
  readonly update_id: number;
  readonly [updateType: string]: unknown;
}

/**
 * An update handed to a bot, in a `getUpdates` answer or in a request to its webhook; an update
 * handed over again is recorded each time.
 */
export interface UpdateDeliveredEntry {
  readonly position: number;
  readonly kind: 'update_delivered';
  readonly bot_id: number;
  readonly via: 'polling' | 'webhook';
  readonly update: BotApiUpdate;
  /** The chat the update happened in, as grammY's `ctx.chat` finds it; omitted when it has none. */
  readonly chat_id?: number;
  /** The user whose action caused the update, as grammY's `ctx.from` finds it. */
  readonly user_id: number;
}

/**
 * An update the bot confirmed: by a `getUpdates` offset beyond it, or by its webhook's successful
 * answer to it, after any method the answer names has run.
 */
export interface UpdateConfirmedEntry {
  readonly position: number;
  readonly kind: 'update_confirmed';
  readonly bot_id: number;
  readonly via: 'polling' | 'webhook';
  readonly update_id: number;
  readonly chat_id?: number;
  readonly user_id: number;
}

/**
 * An entry of a session's bot activity log. Entries are positioned in the order the emulator
 * decided each outcome, which agrees with every order a bot enforces.
 */
export type BotActivityEntry = BotApiCallEntry | UpdateDeliveredEntry | UpdateConfirmedEntry;

/** A position in the bot activity log, or an entry, which stands at its position. */
export type BotActivityPosition = number | { readonly position: number };

/**
 * Which entries to look for, which the server applies; an entry must satisfy every criterion
 * given. Criteria that only calls have, `method`, `ok` and `parameters`, match no update entry, and
 * criteria that only updates have, `user_id` and `update_id`, match no call.
 */
export interface BotActivityCriteria {
  readonly bot_id?: number;
  readonly kind?: BotActivityKind;
  /** A method name, compared without regard to case; an older name finds its calls too. */
  readonly method?: string;
  readonly chat_id?: number;
  readonly user_id?: number;
  /**
   * The ID of the update delivered or confirmed. Each bot numbers its updates independently, so
   * an ID names one update only together with `bot_id`.
   */
  readonly update_id?: number;
  /** Whether the call's answer was successful. */
  readonly ok?: boolean;
  /** Parameter text the call must have sent, by parameter name, compared exactly. */
  readonly parameters?: Readonly<Record<string, string>>;
}

/** Criteria, and a predicate the client checks on the entries that satisfy them. */
export interface BotActivityFilter<Entry extends BotActivityEntry = BotActivityEntry>
  extends BotActivityCriteria {
  readonly where?: (entry: Entry) => boolean;
}

/**
 * A filter whose `where` predicate receives only the entries its criteria can match, such as a
 * `BotApiCallEntry` for criteria that name a `method`.
 *
 * The criteria are spelled as a mapped type so that TypeScript infers them from an object literal
 * whose `where` predicate leaves its parameter untyped; it infers nothing from a plain intersection
 * with such a literal. It infers them from one filter only, so a union of different filters needs
 * a declared type, such as `BotActivityCriteria`.
 */
export type BotActivityFilterFor<Criteria extends BotActivityCriteria> =
  & { readonly [Name in keyof Criteria]: Criteria[Name] }
  & BotActivityFilter<BotActivityEntryMatching<NoInfer<Criteria>>>;

/** The entries criteria can match, judged from the criteria they give. */
export type BotActivityEntryMatching<Criteria extends BotActivityCriteria> = Criteria extends
  { readonly kind: infer Kind extends BotActivityKind } ? Extract<BotActivityEntry, { kind: Kind }>
  : Criteria extends
    | { readonly method: string }
    | { readonly ok: boolean }
    | { readonly parameters: Readonly<Record<string, string>> } ? BotApiCallEntry
  : Criteria extends { readonly user_id: number } | { readonly update_id: number }
    ? UpdateDeliveredEntry | UpdateConfirmedEntry
  : BotActivityEntry;

export interface BotActivityLogOptions {
  /** How long `waitFor` and `next` wait for a matching entry by default. Defaults to 5000. */
  readonly timeoutMs?: number;
}

export interface WaitForBotActivityOptions {
  /** Only entries after this position match. */
  readonly after: BotActivityPosition;
  /** How long to wait for a matching entry; defaults to the log's timeout. */
  readonly timeoutMs?: number;
}

export interface BotActivityRange {
  /** Only entries after this position are checked. */
  readonly after: BotActivityPosition;
  /** Only entries before this position are checked; it must already be recorded. */
  readonly before: BotActivityPosition;
}

/**
 * A view of a session's bot activity log, whose base filter applies to every read in addition to
 * the filter each read gives.
 *
 * Positions are values, so any number of waits can start from the same position: waiting for B
 * after A and for C after A asserts that both follow A, whichever of them comes first.
 */
export interface BotActivityLog {
  /** The position of the latest entry; 0 while the log is empty. */
  position(): Promise<number>;
  /**
   * Returns the first matching entry after `after`, waiting for one to be recorded, and fails
   * with `BotActivityTimeoutError` when none is recorded in time.
   */
  waitFor<const Criteria extends BotActivityCriteria>(
    filter: BotActivityFilterFor<Criteria>,
    options: WaitForBotActivityOptions,
  ): Promise<BotActivityEntryMatching<Criteria>>;
  /**
   * Checks that no entry between the positions matches, without waiting, and fails with
   * `UnexpectedBotActivityError` listing the entries that do.
   */
  assertNone<const Criteria extends BotActivityCriteria>(
    filter: BotActivityFilterFor<Criteria>,
    range: BotActivityRange,
  ): Promise<void>;
  /** A cursor that starts after `after` and moves past each entry it finds. */
  cursor(options: { readonly after: BotActivityPosition }): BotActivityCursor;
}

/** A position that moves forward past each entry it finds; other cursors are unaffected. */
export interface BotActivityCursor {
  /** The position the next search starts after. */
  readonly position: number;
  /** Waits for the first matching entry after the cursor, and moves the cursor to it. */
  next<const Criteria extends BotActivityCriteria>(
    filter: BotActivityFilterFor<Criteria>,
    options?: { readonly timeoutMs?: number },
  ): Promise<BotActivityEntryMatching<Criteria>>;
}

export type HttpMethod = 'DELETE' | 'GET' | 'PATCH' | 'POST' | 'PUT';

export interface RequestDetails {
  readonly method: HttpMethod;
  readonly url: string;
}
