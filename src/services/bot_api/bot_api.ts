import { isParseMode, parseMarkup } from '../../text_entities/parse_mode.ts';
import { checkLink, getLinkUserId } from '../../text_entities/telegram_link.ts';
import type {
  BotApiChatFullInfo,
  BotApiChatInviteLink,
  BotApiChatMember,
  BotApiMessage,
} from '../../types/bot_api.ts';
import type { BotApiPoll } from '../../types/bot_api_poll.ts';
import type { ChatInviteLink } from '../../types/chat_invite_link.ts';
import {
  type ChatMemberStatus,
  type FormerSupergroupMemberFailureReason,
  type SupergroupBotAccessFailureReason,
} from '../../types/chat_membership.ts';
import { createWrittenContact, type WrittenContact } from '../../types/contact.ts';
import type { GeoLocation } from '../../types/geo_location.ts';
import {
  MAX_POLL_OPEN_PERIOD_SECONDS,
  MIN_POLL_OPEN_PERIOD_SECONDS,
  type Poll,
  type PollClosingTime,
} from '../../types/poll.ts';
import {
  allowsSomeInlineQueryChat,
  type InlineKeyboard,
  type InlineKeyboardButton,
} from '../../types/inline_keyboard.ts';
import {
  type AlbumCompositionFailureReason,
  checkAlbumComposition,
  toAlbumMember,
} from '../../types/media_album.ts';
import {
  type BotMessageReplyMarkup,
  getGroupReplyKeyboardRequestError,
  type ReplyInterfaceMarkup,
  type ReplyKeyboardButton,
} from '../../types/reply_interface.ts';
import {
  listRichMessageFiles,
  mapRichMessageButtons,
  type RichMessage,
  type RichMessageButtonAction,
  type RichMessageFile,
  type RichMessageFileTypes,
} from '../../types/rich_message.ts';
import {
  type AudioAttributes,
  type StoredFile,
  type VideoAttributes,
  type WebFile,
} from '../../types/stored_file.ts';
import type { BotUploadTooBigFailure } from '../../types/upload_profile.ts';
import { isUserId } from '../../types/telegram_identity.ts';
import type { VirtualBot, VirtualBotProfile } from '../../types/virtual_bot.ts';
import type { WrittenMessageDraft } from '../../types/message_draft.ts';
import {
  type ChatAction,
  type ChatAddress,
  type ChatKey,
  getBotApiChatAddress,
  getBotChatKey,
  type PrivateChatAddress,
  type PrivateConversationKey,
  type SupergroupChatAddress,
} from '../../types/virtual_chat.ts';
import {
  type ChatMessage,
  type FormattedText,
  type InlineMessageId,
  type PrivateMessage,
  type SupergroupMessage,
  type TextEntity,
} from '../../types/virtual_message.ts';
import type { PhotoTooBigFailure } from '../domain/media_file.ts';
import type {
  CaptionNormalization,
  MediaContent,
  MessageTextNormalization,
  OutgoingCaptionedMedia,
  OutgoingMessageContent,
  OutgoingRichMessage,
  SpecifiedCaption,
  SpecifiedQuote,
  TextInvalidFailure,
  TextMessageReplacement,
} from '../domain/message_content.ts';
import type { MessageDeletionService } from '../domain/message_deletion.ts';
import type { BotChatMessageTarget, MessageEditingService } from '../domain/message_editing.ts';
import type { MessagePinningService } from '../domain/message_pinning.ts';
import type {
  ReactionChoiceFailureReason,
  SetBotMessageReactionInput,
  SetBotMessageReactionResult,
} from '../domain/message_reaction.ts';
import type { PollStopFailureReason } from '../domain/poll.ts';
import type { PollLimitFailure } from '../domain/poll_normalization.ts';
import type { SendPermissionMissingFailure } from '../domain/message_sending.ts';

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

export interface ReadFormattedTextRequest {
  /** Message text or a caption, which may be written in markup. */
  readonly text: string;
  /** The `parse_mode` parameter, matched case-insensitively. */
  readonly parseMode?: string;
  /** The `entities` parameter, which a parse mode overrides. */
  readonly entities: readonly TextEntity[];
}

export type ReadFormattedTextFailureReason =
  | 'text_too_long'
  | 'parse_mode_unsupported'
  | 'text_encoding_invalid';

export type ReadFormattedTextResult =
  | { readonly read: true; readonly formattedText: SpecifiedFormattedText }
  | { readonly read: false; readonly reason: ReadFormattedTextFailureReason }
  | {
    readonly read: false;
    readonly reason: 'markup_invalid';
    /** TDLib's description of the markup error. */
    readonly markupError: string;
  };

export type ReadInlineKeyboardResult =
  | { readonly read: true; readonly inlineKeyboard: InlineKeyboard }
  | {
    readonly read: false;
    /** TDLib's description of the button it cannot read. */
    readonly keyboardError: string;
  };

export type ReadReplyInterfaceMarkupResult =
  | { readonly read: true; readonly replyInterfaceMarkup: ReplyInterfaceMarkup }
  | {
    readonly read: false;
    /** TDLib's description of the button it cannot read. */
    readonly keyboardError: string;
  };

export type ReadRichMessageButtonsResult<Files extends RichMessageFileTypes> =
  | { readonly read: true; readonly richMessage: RichMessage<Files> }
  | {
    readonly read: false;
    /** TDLib's description of the button it cannot read. */
    readonly keyboardError: string;
  };

/** The message that a sent message replies to, as `reply_parameters` specify it. */
export interface ReplyTarget {
  /** The message's ID in its chat, as the bot knows it. */
  readonly messageId: number;
  /**
   * The Bot API `chat_id` of the replied message's chat when it is another chat than the one the
   * message is sent to; omitted for that chat.
   */
  readonly chatId?: number;
  /** Sends the message as no reply, rather than failing, when the target is not found. */
  readonly allowSendingWithoutReply: boolean;
  /** The part of the replied message the bot chose to quote; omitted for none. */
  readonly quote?: SpecifiedQuote;
}

/**
 * Where and how a send method sends its message, apart from what it replies to. The reply markup
 * is an inline keyboard or a change of the reply interface.
 */
export type SendDestinationOptions = BotMessageReplyMarkup & SendDeliveryOptions;

/** Where and how a send method sends its messages, apart from their reply and reply markup. */
export interface SendDeliveryOptions {
  /**
   * The Bot API `chat_id`: for a private chat, the other user's ID, which is positive; for a
   * supergroup, its negative chat ID.
   */
  readonly chatId: number;
  /** The Bot API `protect_content`; omitted for an unprotected message. */
  readonly isContentProtected?: boolean;
  /** The Bot API `disable_notification`; omitted for a message that notifies with sound. */
  readonly isSilent?: boolean;
  /**
   * The Bot API `message_effect_id`, as the decimal text of a nonzero 64-bit identifier; omitted
   * for none. The emulator has no catalogue of Telegram's effects, so any identifier is accepted.
   */
  readonly messageEffectId?: string;
}

/** Where and how every send method sends its message. */
export type SendRequestOptions = SendDestinationOptions & {
  /** Omitted for a message that replies to none. */
  readonly replyTo?: ReplyTarget;
};

export type SendMessageRequest = SpecifiedFormattedText & SendRequestOptions;

/**
 * A file a request sends: one the bot knows by its `file_id`, a file uploaded with the request
 * under the name its sender gave it, or a file Telegram downloaded from the URL the bot sent.
 */
export type BotApiInputFile =
  | { readonly kind: 'file_id'; readonly fileId: string }
  | {
    readonly kind: 'upload';
    readonly fileName: string;
    readonly content: Uint8Array<ArrayBuffer>;
  }
  | { readonly kind: 'web_file'; readonly webFile: WebFile };

export type SendPhotoRequest = SendRequestOptions & {
  readonly photo: BotApiInputFile;
  /** Empty text for no caption. */
  readonly caption: SpecifiedFormattedText;
  /** The Bot API `has_spoiler`. */
  readonly hasSpoiler: boolean;
  /** The Bot API `show_caption_above_media`. */
  readonly showsCaptionAboveMedia: boolean;
};

/** A document a request sends in a rich message, with the thumbnail uploaded for it. */
export interface BotApiRichMessageDocument {
  readonly document: BotApiInputFile;
  /** As `SendDocumentRequest` describes it. */
  readonly thumbnail?: Uint8Array<ArrayBuffer>;
}

/** A video a request sends in a rich message, with the attributes the bot specified for it. */
export interface BotApiRichMessageVideo {
  readonly video: BotApiInputFile;
  /** As `SpecifiedVideo` describes them. */
  readonly attributes: VideoAttributes;
  /** As `SpecifiedVideo` describes it. */
  readonly thumbnail?: Uint8Array<ArrayBuffer>;
}

/** A voice note a request sends in a rich message, with the duration the bot specified for it. */
export interface BotApiRichMessageVoiceNote {
  readonly voice: BotApiInputFile;
  /** As `SendVoiceRequest` describes it. */
  readonly durationSeconds: number;
}

/** The files of a rich message's media blocks, as a request names them. */
export interface BotApiRichMessageFileTypes {
  readonly photo: BotApiInputFile;
  readonly document: BotApiRichMessageDocument;
  readonly video: BotApiRichMessageVideo;
  readonly voice: BotApiRichMessageVoiceNote;
}

/** A rich message as a bot specified it. */
export interface SpecifiedRichMessage {
  /** The message, whose buttons `readRichMessageButtons` has read. */
  readonly richMessage: RichMessage<BotApiRichMessageFileTypes>;
  /**
   * Whether Telegram marks the entities it detects in the text; the Bot API's
   * `skip_entity_detection` turns it off.
   */
  readonly detectsEntities: boolean;
}

export type SendRichMessageRequest = SendRequestOptions & SpecifiedRichMessage;

/** A poll's type as `sendPoll` specifies it: regular, or a quiz with its solution. */
export type PollTypeRequest =
  | { readonly kind: 'regular' }
  | {
    readonly kind: 'quiz';
    /** The Bot API `correct_option_ids`, or the legacy `correct_option_id` as one position. */
    readonly correctOptionPositions: readonly number[];
    /** The Bot API `explanation`; empty text for none. */
    readonly explanation: SpecifiedFormattedText;
  };

/** When a poll closes by itself, as `sendPoll` specifies it with one of two parameters. */
export type PollClosingTimeRequest =
  | { readonly kind: 'open_period'; readonly openPeriodSeconds: number }
  | { readonly kind: 'close_date'; readonly closeDateUnixSeconds: number };

/**
 * A regular poll or a quiz as `sendPoll` specifies it. Restrictions on who may vote, added
 * options, media, descriptions, and shuffled or hidden results are not supported.
 */
export type SendPollRequest = SendRequestOptions & {
  readonly question: SpecifiedFormattedText;
  /** The answer options' texts, in the order clients show them. */
  readonly pollOptions: readonly SpecifiedFormattedText[];
  /** The Bot API `is_anonymous`. */
  readonly isAnonymous: boolean;
  /** The Bot API `allows_multiple_answers`. */
  readonly allowsMultipleAnswers: boolean;
  /** The Bot API `allows_revoting`. */
  readonly allowsRevoting: boolean;
  readonly type: PollTypeRequest;
  /** The Bot API `is_closed`, which sends the poll closed, as a preview. */
  readonly isClosed: boolean;
  /** Omitted for a poll that stays open until it is stopped. */
  readonly closingTime?: PollClosingTimeRequest;
};

/** New content of a text or rich message: text with its formatting, or a rich message. */
export type TextMessageReplacementRequest =
  | ({ readonly kind: 'text' } & SpecifiedFormattedText)
  | ({ readonly kind: 'rich_message' } & SpecifiedRichMessage);

export type SendDocumentRequest = SendRequestOptions & {
  readonly document: BotApiInputFile;
  /**
   * The content of the thumbnail uploaded for the document; omitted for none. Telegram ignores it
   * for a document sent by `file_id`, which keeps its own thumbnail.
   */
  readonly thumbnail?: Uint8Array<ArrayBuffer>;
  /** Empty text for no caption. */
  readonly caption: SpecifiedFormattedText;
};

/** A video and how its message shows it, as `sendVideo` and `InputMediaVideo` specify them. */
export interface SpecifiedVideo {
  readonly video: BotApiInputFile;
  /**
   * The duration and dimensions the bot specified, which a video sent by `file_id` ignores in
   * favor of its own.
   */
  readonly attributes: VideoAttributes;
  /** As `SendDocumentRequest` describes it; a video sent by `file_id` keeps its own. */
  readonly thumbnail?: Uint8Array<ArrayBuffer>;
  /** The Bot API `start_timestamp`, as `VideoMessageContent` describes it. */
  readonly startTimestampSeconds: number;
  /** Empty text for no caption. */
  readonly caption: SpecifiedFormattedText;
  /** The Bot API `has_spoiler`. */
  readonly hasSpoiler: boolean;
  /** The Bot API `show_caption_above_media`. */
  readonly showsCaptionAboveMedia: boolean;
}

export type SendVideoRequest = SendRequestOptions & SpecifiedVideo;

/** A voice note and its caption, as `sendVoice` specifies them. */
export interface SpecifiedVoice {
  readonly voice: BotApiInputFile;
  /**
   * The duration, in seconds, that the bot specified, which a voice note sent by `file_id` ignores
   * in favor of its own.
   */
  readonly durationSeconds: number;
  /** Empty text for no caption. */
  readonly caption: SpecifiedFormattedText;
}

export type SendVoiceRequest = SendRequestOptions & SpecifiedVoice;

/** An audio file and its caption, as `sendAudio` and `InputMediaAudio` specify them. */
export interface SpecifiedAudio {
  readonly audio: BotApiInputFile;
  /**
   * The duration, performer and title the bot specified, which an audio file sent by `file_id`
   * ignores in favor of its own.
   */
  readonly attributes: AudioAttributes;
  /**
   * As `SendDocumentRequest` describes it, such as the cover of the audio file's album; an audio
   * file sent by `file_id` keeps its own.
   */
  readonly thumbnail?: Uint8Array<ArrayBuffer>;
  /** Empty text for no caption. */
  readonly caption: SpecifiedFormattedText;
}

export type SendAudioRequest = SendRequestOptions & SpecifiedAudio;

/**
 * A contact as `sendContact` specifies it. Like the official Bot API server, a bot names no
 * Telegram user, so the contact's user stays unknown.
 */
export type SendContactRequest = SendRequestOptions & {
  readonly contact: WrittenContact;
};

/**
 * A static location as `sendLocation` specifies it, which its reader has checked to be on Earth,
 * as `isPointOnEarth` requires.
 */
export type SendLocationRequest = SendRequestOptions & { readonly location: GeoLocation };

/**
 * Why a bot cannot address a private chat: the account does not exist, or it never started the
 * bot. Telegram reports both as an unknown chat; the domain keeps them apart.
 */
export type BotPrivateChatAccessFailureReason = 'account_not_found' | 'conversation_not_started';

export type SendFailureReason =
  | 'message_text_empty'
  | 'chat_not_found'
  | BotPrivateChatAccessFailureReason
  | FormerSupergroupMemberFailureReason
  | 'reply_message_not_found'
  | 'message_effect_not_allowed_in_chat'
  | 'message_text_too_long'
  | 'caption_too_long'
  | 'callback_data_invalid'
  | 'button_type_invalid'
  | 'quote_invalid'
  | PollLimitFailure['reason']
  | 'poll_open_period_invalid'
  | 'poll_close_date_invalid'
  | 'bot_blocked'
  | 'file_empty'
  | 'image_invalid'
  | 'photo_dimensions_invalid'
  | 'file_id_invalid';

/** The file a `file_id` identifies is of another type than the method sends. */
export interface FileTypeMismatchFailure {
  readonly reason: 'file_type_mismatch';
  readonly expectedFileType: StoredFile['type'];
  readonly actualFileType: StoredFile['type'];
}

export type SendResult =
  | { readonly sent: true; readonly message: BotApiMessage }
  | (
    & { readonly sent: false }
    & (
      | { readonly reason: SendFailureReason }
      | TextInvalidFailure
      | FileTypeMismatchFailure
      | PhotoTooBigFailure
      | BotUploadTooBigFailure
      | SendPermissionMissingFailure
    )
  );

/** A message of one of the bot's chats, as Bot API methods address it. */
export interface MessageTarget {
  /** The Bot API `chat_id`, as `SendRequestOptions` describes it. */
  readonly chatId: number;
  /** The message's ID in the bot's chat. */
  readonly messageId: number;
}

export interface ForwardMessageRequest {
  /** The Bot API `chat_id` of the chat to forward the message to. */
  readonly chatId: number;
  /** The forwarded message: the Bot API `from_chat_id` and `message_id`. */
  readonly forwardedMessage: MessageTarget;
  /**
   * The Bot API `video_start_timestamp`: the second from which a forwarded video plays, which
   * other content ignores; omitted to keep the video's own.
   */
  readonly videoStartTimestampSeconds?: number;
  /** The Bot API `protect_content`; omitted for an unprotected message. */
  readonly isContentProtected?: boolean;
  /** As `SendRequestOptions` describes it. */
  readonly isSilent?: boolean;
  /** As `SendRequestOptions` describes it. */
  readonly messageEffectId?: string;
}

/**
 * A failure of a forward or copy that a send cannot have: the repeated message is not found, or it
 * cannot be repeated.
 */
type RepetitionFailure<NotRepeatableReason extends string> = {
  readonly sent: false;
  readonly reason: 'message_not_found' | NotRepeatableReason;
};

export type ForwardMessageResult = SendResult | RepetitionFailure<'message_not_forwardable'>;

export type CopyMessageRequest = SendRequestOptions & {
  /** The copied message: the Bot API `from_chat_id` and `message_id`. */
  readonly copiedMessage: MessageTarget;
  /** As `ForwardMessageRequest` describes it, for the copied video. */
  readonly videoStartTimestampSeconds?: number;
  /** A caption that replaces the caption of copied media; omitted to keep it. */
  readonly caption?: SpecifiedFormattedText;
  /**
   * The Bot API `show_caption_above_media`, which applies only with a new caption of a photo or
   * video.
   */
  readonly showsCaptionAboveMedia: boolean;
};

/** A copy that `copyMessage` sent, with the new message, or why it was not sent. */
export type CopyMessageSendResult = SendResult | RepetitionFailure<'message_not_copyable'>;

/** The Bot API answers a copy with the new message's ID rather than the message. */
export type CopyMessageResult =
  | { readonly sent: true; readonly messageId: number }
  | Extract<SendResult, { readonly sent: false }>
  | RepetitionFailure<'message_not_copyable'>;

/** Messages of one of the bot's chats that `forwardMessages` or `copyMessages` repeats at once. */
export interface RepeatMessagesRequest {
  /** The Bot API `chat_id` of the chat the messages go to. */
  readonly chatId: number;
  /** The Bot API `from_chat_id` of the chat of the repeated messages. */
  readonly fromChatId: number;
  /** The repeated messages' IDs in the bot's chat, in strictly increasing order. */
  readonly messageIds: readonly number[];
  /** The Bot API `protect_content`; omitted for unprotected messages. */
  readonly isContentProtected?: boolean;
  /** As `SendRequestOptions` describes it. */
  readonly isSilent?: boolean;
  /**
   * As `SendRequestOptions` describes it. As TDLib's `forward_messages` allows, only a request
   * that finds a single message may add an effect to it.
   */
  readonly messageEffectId?: string;
}

export type CopyMessagesRequest = RepeatMessagesRequest & {
  /** The Bot API `remove_caption`, which sends media without their captions. */
  readonly removesCaptions: boolean;
};

/**
 * The Bot API answers `forwardMessages` and `copyMessages` with the new messages' IDs, in the
 * order of the repeated messages. As TDLib does, a request fails only when no message is left to
 * repeat: identifiers of no message are skipped, and so are messages that cannot be repeated.
 */
export type RepeatMessagesResult =
  | { readonly sent: true; readonly messageIds: readonly number[] }
  | Extract<SendResult, { readonly sent: false }>
  | {
    readonly sent: false;
    readonly reason:
      | 'repeated_messages_not_found'
      | 'message_effect_not_allowed_for_several_messages'
      | 'repeated_message_ids_not_increasing'
      | 'messages_not_repeatable';
  };

export interface EditMessageTextRequest extends MessageTarget {
  readonly content: TextMessageReplacementRequest;
  /** Omitting the keyboard removes the message's keyboard, as on Telegram. */
  readonly inlineKeyboard?: InlineKeyboard;
}

export interface EditMessageCaptionRequest extends MessageTarget {
  /** Empty text removes the caption. */
  readonly caption: SpecifiedFormattedText;
  /** The Bot API `show_caption_above_media`, which only a photo or video honors. */
  readonly showsCaptionAboveMedia: boolean;
  /** Omitting the keyboard removes the message's keyboard, as on Telegram. */
  readonly inlineKeyboard?: InlineKeyboard;
}

/**
 * New media of a message and its caption, as `editMessageMedia` specifies them: a photo, a
 * document, a video, or an audio file, uploaded with the request, reused by the `file_id` the bot
 * knows it by, or downloaded from a URL.
 */
export type MediaReplacementRequest =
  | {
    readonly kind: 'photo';
    readonly photo: BotApiInputFile;
    /** Empty text for no caption. */
    readonly caption: SpecifiedFormattedText;
    /** The Bot API `has_spoiler`. */
    readonly hasSpoiler: boolean;
    /** The Bot API `show_caption_above_media`. */
    readonly showsCaptionAboveMedia: boolean;
  }
  | {
    readonly kind: 'document';
    readonly document: BotApiInputFile;
    /** The content of the thumbnail uploaded for the document; omitted for none. */
    readonly thumbnail?: Uint8Array<ArrayBuffer>;
    /** Empty text for no caption. */
    readonly caption: SpecifiedFormattedText;
  }
  | ({ readonly kind: 'video' } & SpecifiedVideo)
  | ({ readonly kind: 'audio' } & SpecifiedAudio);

/**
 * The photos, videos, documents, or audio files that `sendMediaGroup` sends as an album, each
 * specified as
 * `editMessageMedia` specifies new media, in the order the chat shows them. Every message of the
 * album is sent alike, and none has reply markup, which the Bot API does not read for albums.
 */
export type SendMediaGroupRequest = SendDeliveryOptions & {
  /** Every message of the album replies to this message; omitted for an album that replies to none. */
  readonly replyTo?: ReplyTarget;
  readonly media: readonly MediaReplacementRequest[];
};

/**
 * An upload of an album's message that Telegram's servers refuse once the album is sent: content
 * they cannot process as a photo, or a file larger than a local Bot API server lets bots upload.
 */
export type ServerRefusedUploadFailure =
  | { readonly reason: 'image_invalid' | 'photo_dimensions_invalid' }
  | (BotUploadTooBigFailure & { readonly uploadProfile: 'local' });

/**
 * The Bot API answers `sendMediaGroup` with the album's messages in order. As the official server's
 * `on_message_send_failed` does, an upload Telegram's servers refuse fails the album with the
 * position of the first message whose upload they refuse, counted from 1.
 */
export type SendMediaGroupResult =
  | { readonly sent: true; readonly messages: readonly BotApiMessage[] }
  | Extract<SendResult, { readonly sent: false }>
  | { readonly sent: false; readonly reason: AlbumCompositionFailureReason }
  | {
    readonly sent: false;
    readonly reason: 'media_group_member_not_sent';
    readonly memberPosition: number;
    readonly failure: ServerRefusedUploadFailure;
  };

export interface EditMessageMediaRequest extends MessageTarget {
  readonly media: MediaReplacementRequest;
  /** Omitting the keyboard removes the message's keyboard, as on Telegram. */
  readonly inlineKeyboard?: InlineKeyboard;
}

export interface EditMessageReplyMarkupRequest extends MessageTarget {
  /** Omitting the keyboard removes the message's keyboard, as on Telegram. */
  readonly inlineKeyboard?: InlineKeyboard;
}

/** The message of a poll the bot sent, which `stopPoll` stops. */
export interface StopPollRequest extends MessageTarget {
  /** The keyboard the message shows once stopped; omitting it removes the keyboard, as an edit does. */
  readonly inlineKeyboard?: InlineKeyboard;
}

export type StopPollFailureReason =
  | 'chat_not_found'
  | BotPrivateChatAccessFailureReason
  | FormerSupergroupMemberFailureReason
  | 'message_not_found'
  | PollStopFailureReason
  | 'callback_data_invalid'
  | 'button_type_invalid';

/** The Bot API answers `stopPoll` with the stopped poll rather than its message. */
export type StopPollResult =
  | { readonly stopped: true; readonly poll: BotApiPoll }
  | { readonly stopped: false; readonly reason: StopPollFailureReason };

export type EditMessageReplyMarkupFailureReason =
  | 'chat_not_found'
  | BotPrivateChatAccessFailureReason
  | FormerSupergroupMemberFailureReason
  | 'message_not_found'
  | 'message_not_editable'
  | 'callback_data_invalid'
  | 'button_type_invalid'
  | 'message_not_modified';

export type EditMessageTextFailureReason =
  | EditMessageReplyMarkupFailureReason
  | 'message_text_empty'
  | 'message_has_no_text'
  | 'message_text_too_long';

export type EditMessageCaptionFailureReason =
  | EditMessageReplyMarkupFailureReason
  | 'message_has_no_caption'
  | 'caption_too_long';

export type EditMessageMediaFailureReason =
  | EditMessageReplyMarkupFailureReason
  /**
   * The message is a voice note, a poll, a contact, or a location, whose media TDLib's
   * `can_edit_message_media` refuses to edit.
   */
  | 'message_media_not_editable'
  | 'caption_too_long'
  /**
   * The message belongs to an album, and either it or the new media is a document or an audio
   * file, which an album keeps to its own kind.
   */
  | 'album_media_kind_changed';

export type EditMessageResult<FailureReason extends string> =
  | { readonly edited: true; readonly message: BotApiMessage }
  | { readonly edited: false; readonly reason: FailureReason };

export type EditMessageTextResult =
  | EditMessageResult<EditMessageTextFailureReason>
  | (
    & { readonly edited: false }
    & (TextInvalidFailure | FileResolutionFailure | SendPermissionMissingFailure)
  );

export type EditMessageCaptionResult =
  | EditMessageResult<EditMessageCaptionFailureReason>
  | ({ readonly edited: false } & TextInvalidFailure);

export type EditMessageMediaResult =
  | EditMessageResult<EditMessageMediaFailureReason>
  | (
    & { readonly edited: false }
    & (TextInvalidFailure | FileResolutionFailure | SendPermissionMissingFailure)
  );

/** A message sent through the bot's inline mode, as the Bot API addresses it. */
interface InlineMessageTarget {
  /** The Bot API `inline_message_id`. */
  readonly inlineMessageId: InlineMessageId;
}

export interface EditInlineMessageTextRequest extends InlineMessageTarget {
  readonly content: TextMessageReplacementRequest;
  /** Omitting the keyboard removes the message's keyboard, as on Telegram. */
  readonly inlineKeyboard?: InlineKeyboard;
}

export interface EditInlineMessageCaptionRequest extends InlineMessageTarget {
  /** Empty text removes the caption. */
  readonly caption: SpecifiedFormattedText;
  /** The Bot API `show_caption_above_media`, which only a photo or video honors. */
  readonly showsCaptionAboveMedia: boolean;
  /** Omitting the keyboard removes the message's keyboard, as on Telegram. */
  readonly inlineKeyboard?: InlineKeyboard;
}

export interface EditInlineMessageMediaRequest extends InlineMessageTarget {
  readonly media: MediaReplacementRequest;
  /** Omitting the keyboard removes the message's keyboard, as on Telegram. */
  readonly inlineKeyboard?: InlineKeyboard;
}

export interface EditInlineMessageReplyMarkupRequest extends InlineMessageTarget {
  /** Omitting the keyboard removes the message's keyboard, as on Telegram. */
  readonly inlineKeyboard?: InlineKeyboard;
}

/**
 * Why an edit of an inline message can fail, apart from failures about the new content. An
 * identifier of no message, of a deleted one, or of another bot's inline message finds none.
 */
export type EditInlineMessageReplyMarkupFailureReason =
  | 'message_not_found'
  | 'callback_data_invalid'
  | 'button_type_invalid'
  | 'message_not_modified';

export type EditInlineMessageTextFailureReason =
  | EditInlineMessageReplyMarkupFailureReason
  | 'message_text_empty'
  | 'message_has_no_text'
  | 'message_text_too_long'
  /** A rich message uploads a file, which an inline message cannot receive. */
  | 'inline_message_upload_unsupported';

export type EditInlineMessageCaptionFailureReason =
  | EditInlineMessageReplyMarkupFailureReason
  | 'message_has_no_caption'
  | 'caption_too_long';

export type EditInlineMessageMediaFailureReason =
  | EditInlineMessageReplyMarkupFailureReason
  | 'caption_too_long'
  /**
   * The message is a voice note, a contact, or a location, which an inline query result can send
   * but no edit replaces.
   */
  | 'message_media_not_editable'
  /** The new media is uploaded, which an inline message cannot receive. */
  | 'inline_message_upload_unsupported';

/** The Bot API answers an edit of an inline message with `true` rather than the message. */
export type EditInlineMessageResult<FailureReason extends string> =
  | { readonly edited: true }
  | { readonly edited: false; readonly reason: FailureReason }
  | ({ readonly edited: false } & TextInvalidFailure);

export type EditInlineMessageTextResult =
  | EditInlineMessageResult<EditInlineMessageTextFailureReason>
  | ({ readonly edited: false } & FileResolutionFailure);

export type EditInlineMessageMediaResult =
  | EditInlineMessageResult<EditInlineMessageMediaFailureReason>
  | ({ readonly edited: false } & FileResolutionFailure);

export interface SendChatActionRequest {
  /** The Bot API `chat_id`, as `SendRequestOptions` describes it. */
  readonly chatId: number;
  readonly action: ChatAction;
}

export type SendChatActionResult =
  | { readonly sent: true }
  | { readonly sent: false; readonly reason: BotChatActionAccessFailureReason };

/** Why a bot cannot show a chat action or a message draft in a chat. */
type BotChatActionAccessFailureReason =
  | 'chat_not_found'
  | BotPrivateChatAccessFailureReason
  | FormerSupergroupMemberFailureReason
  | 'bot_blocked';

export interface SendMessageDraftRequest {
  /** The Bot API `chat_id`, as `SendRequestOptions` describes it. */
  readonly chatId: number;
  /**
   * Telegram's decimal text form of the draft's 64-bit identifier; omitted for none, which a 0
   * also means and Telegram refuses.
   */
  readonly draftId?: string;
  /** The draft's text as the bot specified it, not yet normalized. */
  readonly text: SpecifiedFormattedText;
  /** Whether the account's client shows a Stop button, which asks the bot to stop. */
  readonly canStop: boolean;
  /** Whether the draft stays shown once the account presses Stop. */
  readonly keepOnStop: boolean;
}

export type SendMessageDraftResult =
  | { readonly sent: true }
  | (
    & { readonly sent: false }
    & (
      | TextInvalidFailure
      | {
        readonly reason:
          | BotChatActionAccessFailureReason
          | 'draft_chat_not_private'
          | 'draft_id_missing'
          | 'message_text_too_long';
      }
    )
  );

export interface PinChatMessageRequest {
  /** The Bot API `chat_id`, as `SendRequestOptions` describes it. */
  readonly chatId: number;
  /** The message's ID in the bot's chat. */
  readonly messageId: number;
  /** Notifies the supergroup's members of the pin without sound, as `disable_notification` asks. */
  readonly isSilent: boolean;
}

export interface UnpinChatMessageRequest {
  /** The Bot API `chat_id`, as `SendRequestOptions` describes it. */
  readonly chatId: number;
  /** The message's ID in the bot's chat; omitted to unpin the chat's newest pinned message. */
  readonly messageId?: number;
}

/** Why a bot cannot pin or unpin a message, in the order the official server and TDLib check. */
type BotPinChangeFailureReason =
  | 'chat_not_found'
  /** The account of the bot's private chat does not exist, or never started the chat. */
  | 'account_not_found'
  | 'conversation_not_started'
  | FormerSupergroupMemberFailureReason
  /** The account of the bot's private chat blocks the bot. */
  | 'bot_blocked'
  /** No such message is in the chat; for an unpin without a target, no message is pinned. */
  | 'message_not_found'
  /** The bot lacks the `can_pin_messages` administrator right in a supergroup. */
  | 'not_enough_rights'
  | 'service_message_not_pinnable';

export type BotApiPinChatMessageResult =
  | { readonly pinned: true }
  | {
    readonly pinned: false;
    /** `message_already_pinned`: Telegram's servers refuse a pin that changes nothing. */
    readonly reason: BotPinChangeFailureReason | 'message_already_pinned';
  };

export type BotApiUnpinChatMessageResult =
  | { readonly unpinned: true }
  | {
    readonly unpinned: false;
    /** `message_not_pinned`: Telegram's servers refuse an unpin that changes nothing. */
    readonly reason: BotPinChangeFailureReason | 'message_not_pinned';
  };

export interface UnpinAllChatMessagesRequest {
  /** The Bot API `chat_id`, as `SendRequestOptions` describes it. */
  readonly chatId: number;
}

export type BotApiUnpinAllChatMessagesResult =
  /** The chat pins nothing now, including when it pinned nothing before. */
  | { readonly unpinned: true }
  | {
    readonly unpinned: false;
    /** As for a single unpin, except that no message is looked up. */
    readonly reason: Exclude<
      BotPinChangeFailureReason,
      'message_not_found' | 'service_message_not_pinnable'
    >;
  };

export interface SetMessageReactionRequest {
  /** The Bot API `chat_id`, as `SendRequestOptions` describes it. */
  readonly chatId: number;
  /** The message's ID in the bot's chat. */
  readonly messageId: number;
  /** The emoji of the Bot API `reaction`, in order; none removes the bot's reactions. */
  readonly emojis: readonly string[];
}

export type BotApiSetMessageReactionResult =
  | { readonly set: true }
  | {
    readonly set: false;
    readonly reason:
      | SupergroupBotAccessFailureReason
      | 'message_not_found'
      | ReactionChoiceFailureReason
      /** The emulator supports reactions in supergroups only. */
      | 'private_chat_reactions_unsupported';
  };

export type DeleteMessageRequest = MessageTarget;

/**
 * Why a bot cannot delete messages of a chat: it cannot address the chat, or a message is not
 * one it may delete.
 */
type MessageDeletionFailureReason =
  | 'chat_not_found'
  | BotPrivateChatAccessFailureReason
  | FormerSupergroupMemberFailureReason
  | 'message_not_deletable';

export type DeleteMessageResult =
  | { readonly deleted: true }
  | {
    readonly deleted: false;
    readonly reason: MessageDeletionFailureReason | 'message_not_found';
  };

export interface DeleteMessagesRequest {
  /** The Bot API `chat_id`, as `SendRequestOptions` describes it. */
  readonly chatId: number;
  /** The messages' IDs in the bot's chat. */
  readonly messageIds: readonly number[];
}

export type DeleteMessagesResult =
  | { readonly deleted: true }
  | { readonly deleted: false; readonly reason: MessageDeletionFailureReason };

/** Why a bot cannot address a chat whose members it asks about or moderates. */
interface BotCredentialLookup {
  getByToken(token: string): VirtualBot | undefined;
}

interface BotMessaging {
  checkBotChatActionAccess(input: {
    readonly fromBotId: number;
    readonly chat: PrivateChatAddress;
  }):
    | { readonly allowed: true }
    | {
      readonly allowed: false;
      readonly reason:
        | 'bot_not_found'
        | 'account_not_found'
        | 'conversation_not_started'
        | 'bot_blocked';
    };
}

interface SupergroupBotMessaging {
  checkBotChatActionAccess(input: {
    readonly fromBotId: number;
    readonly chat: SupergroupChatAddress;
  }):
    | { readonly allowed: true }
    | {
      readonly allowed: false;
      readonly reason: 'bot_not_found' | 'chat_not_found' | FormerSupergroupMemberFailureReason;
    };
}

/** The message deletion that `deleteMessage` and `deleteMessages` carry out, by the chat's address. */
type BotMessageDeletion = Pick<MessageDeletionService, 'deleteChatMessages'>;

/**
 * The message editing that the edit methods and `stopPoll` carry out, by the target each addresses:
 * a message of one of the bot's chats, by the chat's address, or an inline message.
 */
type BotMessageEditing = Pick<
  MessageEditingService,
  | 'findBotInlineMessage'
  | 'editChatMessageText'
  | 'editInlineMessageText'
  | 'editChatMessageCaption'
  | 'editInlineMessageCaption'
  | 'editChatMessageMedia'
  | 'editInlineMessageMedia'
  | 'editChatMessageKeyboard'
  | 'editInlineMessageKeyboard'
  | 'stopPoll'
>;

interface BotMessageSending {
  send(botId: number, content: OutgoingMessageContent, options: SendRequestOptions): SendResult;
  sendAlbum(
    botId: number,
    contents: readonly MediaContent[],
    options: Omit<SendMediaGroupRequest, 'media'>,
  ): SendMediaGroupResult;
}

interface BotMessageRepetition {
  forwardMessage(botId: number, request: ForwardMessageRequest): ForwardMessageResult;
  copyMessage(botId: number, request: CopyMessageRequest): CopyMessageSendResult;
  forwardMessages(botId: number, request: RepeatMessagesRequest): RepeatMessagesResult;
  copyMessages(botId: number, request: CopyMessagesRequest): RepeatMessagesResult;
}

interface BotMediaResolution {
  resolveMediaContent(botId: number, media: MediaReplacementRequest): FileResolution<MediaContent>;
  resolveVoiceMedia(
    botId: number,
    voice: SpecifiedVoice,
  ): FileResolution<Extract<OutgoingCaptionedMedia, { readonly kind: 'voice' | 'document' }>>;
  resolveRichMessageFiles(
    botId: number,
    richMessage: RichMessage<BotApiRichMessageFileTypes>,
  ): RichMessageFilesResolution;
}

interface BotCaptionNormalizer {
  normalizeBotCaption(caption: SpecifiedCaption): CaptionNormalization;
}

interface BotDraftTextNormalizer {
  normalizeBotDraftText(text: FormattedText): MessageTextNormalization;
}

interface BotMessageViews {
  viewPollForCreator(poll: Poll): BotApiPoll;
  viewMessageForBot(message: ChatMessage, botId: number): BotApiMessage;
  viewChatMember(input: {
    readonly chatId: number;
    readonly userId: number;
    readonly status: ChatMemberStatus;
    readonly observerBotId: number;
  }): BotApiChatMember | undefined;
  viewPrivateChatFullInfo(input: {
    readonly accountId: number;
    readonly pinnedMessage: PrivateMessage | undefined;
  }): BotApiChatFullInfo | undefined;
  viewSupergroupChatFullInfo(input: {
    readonly chatId: number;
    readonly observerBotId: number;
    readonly pinnedMessage: SupergroupMessage | undefined;
    readonly primaryInviteLink: ChatInviteLink | undefined;
  }): BotApiChatFullInfo | undefined;
  viewChatInviteLink(link: ChatInviteLink, observerId: number): BotApiChatInviteLink;
}

type MessagePinning = Pick<
  MessagePinningService,
  'pinMessageByBot' | 'unpinMessageByBot' | 'unpinAllMessagesByBot'
>;

interface MessageReactions {
  setBotMessageReaction(input: SetBotMessageReactionInput): SetBotMessageReactionResult;
}

interface ChatActions {
  recordBotChatAction(input: {
    readonly botId: number;
    readonly chat: ChatKey;
    readonly action: ChatAction;
  }): void;
}

interface MessageDrafts {
  showBotDraft(conversation: PrivateConversationKey, draft: WrittenMessageDraft): void;
}

interface BotApiServiceDependencies {
  readonly bots: BotCredentialLookup;
  readonly botMessages: BotMessaging;
  readonly supergroupBotMessages: SupergroupBotMessaging;
  /**
   * Edits the bot's messages and the messages sent through its inline mode, and stops its polls.
   */
  readonly messageEditing: BotMessageEditing;
  /** Deletes messages of the bot's chats. */
  readonly messageDeletion: BotMessageDeletion;
  /**
   * Sends the bot's messages and albums to its chats, as every send method sends them, resolving
   * what they reply to in other chats.
   */
  readonly messageSender: BotMessageSending;
  /** Forwards and copies messages of the bot's chats, one or many at once. */
  readonly messageRepeater: BotMessageRepetition;
  readonly botMessageViews: BotMessageViews;
  /** Pins and unpins messages. */
  readonly messagePinning: MessagePinning;
  /** Sets the bot's reactions to supergroup messages. */
  readonly messageReactions: MessageReactions;
  /**
   * Turns the files that requests send, by `file_id`, upload or URL, into the files of the
   * messages they send, without storing any.
   */
  readonly botMedia: BotMediaResolution;
  /**
   * Normalizes the captions of an album, which are checked before the album is handed to
   * sending, as it normalizes the caption of a bot's media.
   */
  readonly botCaptions: BotCaptionNormalizer;
  readonly chatActions: ChatActions;
  /** Shows the message drafts bots stream to accounts' private chats. */
  readonly messageDrafts: MessageDrafts;
  /** Normalizes a draft's text as TDLib does before a draft is shown. */
  readonly botDraftTexts: BotDraftTextNormalizer;
  readonly publicChats: PublicChatDirectory;
  /** The time that closing times of polls count from. */
  readonly currentUnixTimeSeconds: () => number;
}

interface PublicChatDirectory {
  findPublicChatId(username: string): number | undefined;
}

/**
 * The application boundary between Bot API methods and the feature services they use, for the
 * method families that have no `BotApiFamilyContext` of their own, through which a family calls its
 * services directly.
 *
 * Transport authenticates each call with `authenticate` before invoking a method, so that an
 * invalid token is rejected before request parameters are validated, as Telegram does.
 */
export class BotApiService {
  readonly #bots: BotCredentialLookup;
  readonly #botMessages: BotMessaging;
  readonly #supergroupBotMessages: SupergroupBotMessaging;
  readonly #messageEditing: BotMessageEditing;
  readonly #messageDeletion: BotMessageDeletion;
  readonly #messageSender: BotMessageSending;
  readonly #messageRepeater: BotMessageRepetition;
  readonly #botMessageViews: BotMessageViews;
  readonly #messagePinning: MessagePinning;
  readonly #messageReactions: MessageReactions;
  readonly #botMedia: BotMediaResolution;
  readonly #botCaptions: BotCaptionNormalizer;
  readonly #chatActions: ChatActions;
  readonly #messageDrafts: MessageDrafts;
  readonly #botDraftTexts: BotDraftTextNormalizer;
  readonly #publicChats: PublicChatDirectory;
  readonly #currentUnixTimeSeconds: () => number;

  constructor(
    {
      bots,
      botMessages,
      supergroupBotMessages,
      messageEditing,
      messageDeletion,
      messageSender,
      messageRepeater,
      botMessageViews,
      messagePinning,
      messageReactions,
      botMedia,
      botCaptions,
      chatActions,
      messageDrafts,
      botDraftTexts,
      publicChats,
      currentUnixTimeSeconds,
    }: BotApiServiceDependencies,
  ) {
    this.#bots = bots;
    this.#botMessages = botMessages;
    this.#supergroupBotMessages = supergroupBotMessages;
    this.#messageEditing = messageEditing;
    this.#messageDeletion = messageDeletion;
    this.#messageSender = messageSender;
    this.#messageRepeater = messageRepeater;
    this.#botMessageViews = botMessageViews;
    this.#messagePinning = messagePinning;
    this.#messageReactions = messageReactions;
    this.#botMedia = botMedia;
    this.#botCaptions = botCaptions;
    this.#chatActions = chatActions;
    this.#messageDrafts = messageDrafts;
    this.#botDraftTexts = botDraftTexts;
    this.#publicChats = publicChats;
    this.#currentUnixTimeSeconds = currentUnixTimeSeconds;
  }

  /**
   * Finds the chat that a bot addresses by a public username, as the official Bot API server's
   * `check_chat` finds it: a public supergroup, or the private chat with a bot. Returns
   * `undefined` for any other username, which Telegram answers as a chat it cannot find.
   */
  findPublicChatId(username: string): number | undefined {
    return this.#publicChats.findPublicChatId(username);
  }

  /** Returns the profile of the bot that owns `token`, or `undefined` if no bot does. */
  authenticate(token: string): VirtualBotProfile | undefined {
    return this.#bots.getByToken(token)?.profile;
  }

  /**
   * Reads message text with its `parse_mode` or `entities`, as the official Bot API server's
   * `Client::get_formatted_text` does before it looks at the chat: a parse mode other than `none`
   * turns markup into entities and overrides `entities`. The result still has to pass the checks
   * that sending or editing applies.
   */
  readFormattedText(
    { text, parseMode, entities }: ReadFormattedTextRequest,
  ): ReadFormattedTextResult {
    if (new TextEncoder().encode(text).length > MAX_FORMATTED_TEXT_BYTES) {
      return { read: false, reason: 'text_too_long' };
    }
    const parseModeName = parseMode?.toLowerCase() ?? '';
    if (parseModeName.length === 0 || parseModeName === NO_PARSE_MODE) {
      return { read: true, formattedText: { text, entities } };
    }
    if (!isParseMode(parseModeName)) {
      return { read: false, reason: 'parse_mode_unsupported' };
    }
    if (!text.isWellFormed()) {
      return { read: false, reason: 'text_encoding_invalid' };
    }

    const parsing = parseMarkup(text, parseModeName);
    if (parsing.parsed) {
      return { read: true, formattedText: { text: parsing.text, entities: parsing.entities } };
    }
    return { read: false, reason: 'markup_invalid', markupError: parsing.error };
  }

  /**
   * Reads an inline keyboard as TDLib's `get_inline_keyboard_button` does for a keyboard being
   * sent, with each button's action read as `#readButtonAction` reads it. The keyboard still has
   * to pass the checks that sending or editing applies.
   */
  readInlineKeyboard(inlineKeyboard: InlineKeyboard): ReadInlineKeyboardResult {
    const readRows: InlineKeyboardButton[][] = [];
    for (const row of inlineKeyboard) {
      const readRow: InlineKeyboardButton[] = [];
      for (const button of row) {
        const actionReading = this.#readButtonAction(button, 'inline_keyboard');
        if (!actionReading.read) {
          return actionReading;
        }
        readRow.push(
          actionReading.url === undefined || !hasButtonLink(button)
            ? button
            : { ...button, url: actionReading.url },
        );
      }
      readRows.push(readRow);
    }
    return { read: true, inlineKeyboard: readRows };
  }

  /**
   * Reads reply interface markup as TDLib's `KeyboardButton::get_keyboard_button` reads the
   * buttons of a reply keyboard being sent. As TDLib does, only a private chat allows buttons with
   * a request, and a Web App button needs an HTTPS link, which cannot open a profile. The
   * keyboard keeps the link as `check_link` normalizes it, which is how the user's client shows
   * it.
   */
  readReplyInterfaceMarkup(
    replyInterfaceMarkup: ReplyInterfaceMarkup,
    { allowsRequestButtons }: { readonly allowsRequestButtons: boolean },
  ): ReadReplyInterfaceMarkupResult {
    if (replyInterfaceMarkup.kind !== 'reply_keyboard') {
      return { read: true, replyInterfaceMarkup };
    }
    const readRows: ReplyKeyboardButton[][] = [];
    for (const row of replyInterfaceMarkup.rows) {
      const readRow: ReplyKeyboardButton[] = [];
      for (const button of row) {
        const { request } = button;
        if (request !== undefined && !allowsRequestButtons) {
          return { read: false, keyboardError: getGroupReplyKeyboardRequestError(request) };
        }
        if (request?.kind !== 'web_app') {
          readRow.push(button);
          continue;
        }
        const urlReading = readHttpsButtonUrl(request.url, 'Keyboard button Web App');
        if (!urlReading.read) {
          return urlReading;
        }
        readRow.push({ ...button, request: { ...request, url: urlReading.url } });
      }
      readRows.push(readRow);
    }
    return { read: true, replyInterfaceMarkup: { ...replyInterfaceMarkup, rows: readRows } };
  }

  /**
   * Reads the buttons of a rich message, in rows and in its text, as TDLib's
   * `get_inline_keyboard_button` reads them for a rich message: as `readInlineKeyboard` reads the
   * buttons of an inline keyboard.
   */
  readRichMessageButtons<Files extends RichMessageFileTypes>(
    richMessage: RichMessage<Files>,
  ): ReadRichMessageButtonsResult<Files> {
    let keyboardError: string | undefined;
    const readRichMessage = mapRichMessageButtons(richMessage, (button) => {
      const { action } = button;
      if (keyboardError !== undefined) {
        return button;
      }
      const actionReading = this.#readButtonAction(action, 'rich_message');
      if (!actionReading.read) {
        keyboardError = actionReading.keyboardError;
        return button;
      }
      return actionReading.url === undefined || !hasButtonLink(action)
        ? button
        : { ...button, action: { ...action, url: actionReading.url } };
    });
    return keyboardError === undefined
      ? { read: true, richMessage: readRichMessage }
      : { read: false, keyboardError };
  }

  /**
   * Reads a button's action as TDLib's `get_inline_keyboard_button` does, answering the link it
   * opens, normalized, for a button with one. A switch-inline button for a chosen chat must allow
   * at least one kind of chat. Of URL buttons' links, a `tg://user?id=` link opens the user's
   * profile and is kept in that canonical form, and any other link must pass `check_link`, which
   * normalizes it, so that `grammy.dev` opens `http://grammy.dev/`. Telegram's servers decide
   * whether the user of a profile link may be shown, which the emulator does not check. Login and
   * Web App buttons need an HTTPS link, which cannot open a profile.
   *
   * As the official Bot API server reads a login button, its bot's username consists of letters,
   * digits and underscores, and must name a bot; the button of a rich message cannot name one.
   */
  #readButtonAction(
    action: RichMessageButtonAction,
    buttonLocation: 'inline_keyboard' | 'rich_message',
  ): ButtonActionReading {
    switch (action.kind) {
      case 'url':
        return readInlineButtonUrl(action.url);
      case 'login_url': {
        const { authorizingBotUsername } = action;
        if (authorizingBotUsername !== undefined) {
          if (buttonLocation === 'rich_message') {
            return {
              read: false,
              keyboardError: 'Bot username must be empty for login_url buttons in rich messages',
            };
          }
          if (!/^[A-Za-z0-9_]+$/.test(authorizingBotUsername)) {
            return { read: false, keyboardError: 'LoginUrl bot username is invalid' };
          }
          const botId = this.#publicChats.findPublicChatId(authorizingBotUsername);
          if (botId === undefined || !isUserId(botId)) {
            return { read: false, keyboardError: `bot "${authorizingBotUsername}" not found` };
          }
        }
        return readHttpsButtonUrl(action.url, 'Inline keyboard button login');
      }
      case 'web_app':
        return readHttpsButtonUrl(action.url, 'Inline keyboard button Web App');
      case 'switch_inline_query':
        return action.target.kind === 'chosen_chat' &&
            !allowsSomeInlineQueryChat(action.target.chatTypes)
          ? { read: false, keyboardError: 'At least one chat type must be allowed' }
          : { read: true };
      case 'callback':
      case 'copy_text':
      case 'disabled':
        return { read: true };
      default: {
        const unhandledAction: never = action;
        throw new Error(`Unhandled button action: ${JSON.stringify(unhandledAction)}`);
      }
    }
  }

  /**
   * Sends text to a private chat or a supergroup, optionally as a reply to one of the chat's
   * messages and with an inline keyboard. A message can instead change the reply interface the
   * account of a private chat sees, or the one the chosen members of a supergroup see.
   */
  sendMessage(
    authenticatedBot: VirtualBotProfile,
    { text, entities, ...options }: SendMessageRequest,
  ): SendResult {
    return this.#messageSender.send(authenticatedBot.id, { kind: 'text', text, entities }, options);
  }

  /**
   * Sends a rich message, laid out in blocks, as `sendMessage` sends text. The files of its media
   * blocks are uploaded with the request or reused by the `file_id` the bot knows them by, as
   * `sendPhoto`, `sendDocument`, `sendVideo` and `sendVoice` send theirs, and are resolved before
   * the chat, as theirs are.
   */
  sendRichMessage(
    authenticatedBot: VirtualBotProfile,
    { richMessage, detectsEntities, ...options }: SendRichMessageRequest,
  ): SendResult {
    const resolution = this.#botMedia.resolveRichMessageFiles(authenticatedBot.id, richMessage);
    if (!resolution.resolved) {
      return { sent: false, ...resolution.failure };
    }
    return this.#messageSender.send(authenticatedBot.id, {
      kind: 'rich_message',
      richMessage: resolution.richMessage,
      detectsEntities,
    }, options);
  }

  /**
   * Sends a photo with an optional caption, as `sendMessage` sends text. The photo is uploaded
   * with the request or reused by the `file_id` the bot knows it by.
   *
   * The file is resolved before the chat, while Telegram looks at the chat first; a request with
   * both an unknown chat and an unusable file fails for its file.
   */
  sendPhoto(
    authenticatedBot: VirtualBotProfile,
    { photo, caption, hasSpoiler, showsCaptionAboveMedia, ...options }: SendPhotoRequest,
  ): SendResult {
    const resolution = this.#botMedia.resolveMediaContent(authenticatedBot.id, {
      kind: 'photo',
      photo,
      caption,
      hasSpoiler,
      showsCaptionAboveMedia,
    });
    if (!resolution.resolved) {
      return { sent: false, ...resolution.failure };
    }
    return this.#messageSender.send(authenticatedBot.id, resolution.file, options);
  }

  /**
   * Sends a file as a document with an optional caption, as `sendPhoto` sends a photo. Telegram
   * sends some files, such as videos and GIF animations, as other media unless the request
   * disables content type detection; the emulator always sends a document.
   */
  sendDocument(
    authenticatedBot: VirtualBotProfile,
    { document, thumbnail, caption, ...options }: SendDocumentRequest,
  ): SendResult {
    const resolution = this.#botMedia.resolveMediaContent(authenticatedBot.id, {
      kind: 'document',
      document,
      ...(thumbnail === undefined ? {} : { thumbnail }),
      caption,
    });
    if (!resolution.resolved) {
      return { sent: false, ...resolution.failure };
    }
    return this.#messageSender.send(authenticatedBot.id, resolution.file, options);
  }

  /**
   * Sends a video with an optional caption, as `sendPhoto` sends a photo. Telegram's clients play
   * MPEG-4 videos and Telegram may send other formats as documents; the emulator inspects no
   * content and always sends a video.
   */
  sendVideo(
    authenticatedBot: VirtualBotProfile,
    {
      video,
      attributes,
      thumbnail,
      startTimestampSeconds,
      caption,
      hasSpoiler,
      showsCaptionAboveMedia,
      ...options
    }: SendVideoRequest,
  ): SendResult {
    const resolution = this.#botMedia.resolveMediaContent(authenticatedBot.id, {
      kind: 'video',
      video,
      attributes,
      ...(thumbnail === undefined ? {} : { thumbnail }),
      startTimestampSeconds,
      caption,
      hasSpoiler,
      showsCaptionAboveMedia,
    });
    if (!resolution.resolved) {
      return { sent: false, ...resolution.failure };
    }
    return this.#messageSender.send(authenticatedBot.id, resolution.file, options);
  }

  /**
   * Sends a voice note with an optional caption, as `sendPhoto` sends a photo. Telegram documents
   * that its clients play OGG/Opus, MP3 and M4A voice notes and that it may send other formats as
   * audio or documents; the emulator inspects no content and always sends a voice note, apart from
   * one sent by URL, which the bot media resolver's `resolveVoiceMedia` may send as a document.
   */
  sendVoice(
    authenticatedBot: VirtualBotProfile,
    { voice, durationSeconds, caption, ...options }: SendVoiceRequest,
  ): SendResult {
    const resolution = this.#botMedia.resolveVoiceMedia(authenticatedBot.id, {
      voice,
      durationSeconds,
      caption,
    });
    if (!resolution.resolved) {
      return { sent: false, ...resolution.failure };
    }
    return this.#messageSender.send(authenticatedBot.id, resolution.file, options);
  }

  /**
   * Sends an audio file, such as a music track, with an optional caption, as `sendPhoto` sends a
   * photo. Telegram documents that its clients play MP3 and M4A audio; the emulator inspects no
   * content, reads no tags, and always sends an audio file.
   */
  sendAudio(
    authenticatedBot: VirtualBotProfile,
    { audio, attributes, thumbnail, caption, ...options }: SendAudioRequest,
  ): SendResult {
    const resolution = this.#botMedia.resolveMediaContent(authenticatedBot.id, {
      kind: 'audio',
      audio,
      attributes,
      ...(thumbnail === undefined ? {} : { thumbnail }),
      caption,
    });
    if (!resolution.resolved) {
      return { sent: false, ...resolution.failure };
    }
    return this.#messageSender.send(authenticatedBot.id, resolution.file, options);
  }

  /**
   * Sends photos and videos, documents, or audio files to a private chat or a supergroup as an
   * album, as TDLib's `send_message_group` does: each message's file is resolved as `sendPhoto`,
   * `sendVideo`, `sendDocument` and `sendAudio` resolve theirs, in order, and the album is then checked as
   * `checkAlbumComposition` does. An upload that only Telegram's servers refuse fails after those
   * checks, as TDLib learns of it only when the album is sent. Every check passes before any
   * message is sent; the messages are then sent in order, each as a reply to the same message, and
   * share a new `media_group_id` unless there is just one.
   *
   * As for `sendPhoto`, files are resolved before the chat, while Telegram looks at the chat
   * first; a request with both an unknown chat and an unusable file fails for its file.
   */
  sendMediaGroup(
    authenticatedBot: VirtualBotProfile,
    { media, replyTo, ...options }: SendMediaGroupRequest,
  ): SendMediaGroupResult {
    const contents: MediaContent[] = [];
    let firstRefusedUpload:
      | { readonly memberPosition: number; readonly failure: ServerRefusedUploadFailure }
      | undefined;
    for (const [memberIndex, member] of media.entries()) {
      const resolution = this.#botMedia.resolveMediaContent(authenticatedBot.id, member);
      if (!resolution.resolved && !isRefusedByTelegramServers(resolution.failure)) {
        return { sent: false, ...resolution.failure };
      }
      // As TDLib's `get_input_message_content` does, each message's caption is checked once its
      // file is read, before the next message; sending checks it again when it stores the
      // album.
      const captionNormalization = this.#botCaptions.normalizeBotCaption({
        caption: member.caption.text,
        captionEntities: member.caption.entities,
      });
      if (!captionNormalization.normalized) {
        return { sent: false, ...captionNormalization.failure };
      }
      if (resolution.resolved) {
        contents.push(resolution.file);
      } else if (isRefusedByTelegramServers(resolution.failure)) {
        firstRefusedUpload ??= { memberPosition: memberIndex + 1, failure: resolution.failure };
      }
    }
    const compositionFailure = checkAlbumComposition(media.map(toAlbumMember));
    if (compositionFailure !== undefined) {
      return { sent: false, reason: compositionFailure };
    }
    if (firstRefusedUpload !== undefined) {
      return { sent: false, reason: 'media_group_member_not_sent', ...firstRefusedUpload };
    }

    return this.#messageSender.sendAlbum(authenticatedBot.id, contents, { replyTo, ...options });
  }

  /**
   * Sends a contact to a private chat or a supergroup, as `sendMessage` sends text. Its texts are
   * cleaned as `normalizeOutgoingContent` cleans a contact, where `sendMessage` normalizes text.
   * As the official Bot API server's `process_send_contact_query` names no user, and the emulator
   * never looks users up by phone number, the contact shows no user.
   */
  sendContact(
    authenticatedBot: VirtualBotProfile,
    { contact, ...options }: SendContactRequest,
  ): SendResult {
    return this.#messageSender.send(
      authenticatedBot.id,
      { kind: 'contact', contact: createWrittenContact(contact) },
      options,
    );
  }

  /**
   * Sends a static location to a private chat or a supergroup, as `sendMessage` sends text. The
   * caller reads the location as `isPointOnEarth` requires, as the Bot API handler does, since
   * TDLib refuses other coordinates while reading the request; a location carries no text to
   * normalize.
   */
  sendLocation(
    authenticatedBot: VirtualBotProfile,
    { location, ...options }: SendLocationRequest,
  ): SendResult {
    return this.#messageSender.send(authenticatedBot.id, { kind: 'location', location }, options);
  }

  /**
   * Sends a regular poll or a quiz to a private chat or a supergroup, as `sendMessage` sends text.
   * Its question, options, and quiz settings are checked as `normalizeNewPoll` checks them, where
   * `sendMessage` checks its text. The bot owns the poll; the accounts of the chat vote in it.
   *
   * A closing time is checked first, as `#resolvePollClosingTime` checks it, while Telegram's
   * servers check it only once the poll is sent; a request that also fails otherwise fails for its
   * closing time.
   */
  sendPoll(
    authenticatedBot: VirtualBotProfile,
    {
      question,
      pollOptions,
      isAnonymous,
      allowsMultipleAnswers,
      allowsRevoting,
      type,
      isClosed,
      closingTime,
      ...options
    }: SendPollRequest,
  ): SendResult {
    const closingTimeResolution = closingTime === undefined
      ? undefined
      : this.#resolvePollClosingTime(closingTime);
    if (closingTimeResolution?.resolved === false) {
      return { sent: false, reason: closingTimeResolution.reason };
    }
    return this.#messageSender.send(authenticatedBot.id, {
      kind: 'poll',
      poll: {
        creator: { kind: 'bot', botId: authenticatedBot.id },
        question,
        options: pollOptions,
        isAnonymous,
        allowsMultipleAnswers,
        allowsRevoting,
        type,
        isClosed,
        ...(closingTimeResolution === undefined
          ? {}
          : { closingTime: closingTimeResolution.closingTime }),
      },
    }, options);
  }

  /**
   * Resolves when a poll sent now closes by itself, as Telegram shows it: an open period of 5 to
   * 2628000 seconds closes the poll that long after now, and a close date at least 5 and at most
   * 2628000 seconds after now leaves the poll open until then. The Bot API documents these
   * limits, which Telegram's servers enforce.
   */
  #resolvePollClosingTime(closingTime: PollClosingTimeRequest):
    | { readonly resolved: true; readonly closingTime: PollClosingTime }
    | {
      readonly resolved: false;
      readonly reason: 'poll_open_period_invalid' | 'poll_close_date_invalid';
    } {
    const now = this.#currentUnixTimeSeconds();
    const openPeriodSeconds = closingTime.kind === 'open_period'
      ? closingTime.openPeriodSeconds
      : closingTime.closeDateUnixSeconds - now;
    if (
      !Number.isSafeInteger(openPeriodSeconds) ||
      openPeriodSeconds < MIN_POLL_OPEN_PERIOD_SECONDS ||
      openPeriodSeconds > MAX_POLL_OPEN_PERIOD_SECONDS
    ) {
      return {
        resolved: false,
        reason: closingTime.kind === 'open_period'
          ? 'poll_open_period_invalid'
          : 'poll_close_date_invalid',
      };
    }
    return {
      resolved: true,
      closingTime: { openPeriodSeconds, closeDateUnixSeconds: now + openPeriodSeconds },
    };
  }

  /**
   * Forwards a message of one of the bot's chats to a private chat or a supergroup, as the bot
   * message repeater's `forwardMessage` does.
   */
  forwardMessage(
    authenticatedBot: VirtualBotProfile,
    request: ForwardMessageRequest,
  ): ForwardMessageResult {
    return this.#messageRepeater.forwardMessage(authenticatedBot.id, request);
  }

  /**
   * Copies a message of one of the bot's chats to a private chat or a supergroup, as the bot
   * message repeater's `copyMessage` does. The Bot API answers with the new message's ID.
   */
  copyMessage(
    authenticatedBot: VirtualBotProfile,
    request: CopyMessageRequest,
  ): CopyMessageResult {
    const result = this.#messageRepeater.copyMessage(authenticatedBot.id, request);
    return result.sent ? { sent: true, messageId: result.message.message_id } : result;
  }

  /**
   * Forwards up to 100 messages of one of the bot's chats to a private chat or a supergroup, as the
   * bot message repeater's `forwardMessages` does.
   */
  forwardMessages(
    authenticatedBot: VirtualBotProfile,
    request: RepeatMessagesRequest,
  ): RepeatMessagesResult {
    return this.#messageRepeater.forwardMessages(authenticatedBot.id, request);
  }

  /**
   * Copies up to 100 messages of one of the bot's chats to a private chat or a supergroup, as the
   * bot message repeater's `copyMessages` does.
   */
  copyMessages(
    authenticatedBot: VirtualBotProfile,
    request: CopyMessagesRequest,
  ): RepeatMessagesResult {
    return this.#messageRepeater.copyMessages(authenticatedBot.id, request);
  }

  /**
   * Resolves new content of a text or rich message: the files of a rich message, as
   * `resolveRichMessageFiles` resolves them.
   */
  #resolveTextMessageReplacement(
    authenticatedBot: VirtualBotProfile,
    content: TextMessageReplacementRequest,
  ):
    | { readonly resolved: true; readonly content: TextMessageReplacement }
    | { readonly resolved: false; readonly failure: FileResolutionFailure } {
    if (content.kind === 'text') {
      return { resolved: true, content };
    }
    const resolution = this.#botMedia.resolveRichMessageFiles(
      authenticatedBot.id,
      content.richMessage,
    );
    return resolution.resolved
      ? {
        resolved: true,
        content: {
          kind: 'rich_message',
          richMessage: resolution.richMessage,
          detectsEntities: content.detectsEntities,
        },
      }
      : resolution;
  }

  /**
   * Shows a chat action, such as typing, in a private chat or a supergroup, which the chat's
   * accounts see until it expires, is canceled, or the bot sends a message there.
   */
  sendChatAction(
    authenticatedBot: VirtualBotProfile,
    { chatId, action }: SendChatActionRequest,
  ): SendChatActionResult {
    const chat = getBotApiChatAddress(chatId);
    const access = this.#checkBotChatActionAccess(authenticatedBot.id, chat);
    if (!access.allowed) {
      return { sent: false, reason: access.reason };
    }
    this.#chatActions.recordBotChatAction({
      botId: authenticatedBot.id,
      chat: getBotChatKey(authenticatedBot.id, chat),
      action,
    });
    return { sent: true };
  }

  /**
   * Shows a draft of a message the bot is generating in its private chat with an account, as
   * `MessageDraft` describes it, until the bot sends a message there or a test expires it.
   *
   * As the official Bot API server and TDLib check a draft, the bot must be able to address the
   * chat before TDLib normalizes the text, which, like a bot's caption, may be empty. Telegram's
   * servers then refuse a chat that is not private, a bot the account blocks, a missing draft ID,
   * and text too long for a message; the emulator checks those in that order, which Telegram does
   * not document.
   */
  sendMessageDraft(
    authenticatedBot: VirtualBotProfile,
    { chatId, draftId, text, canStop, keepOnStop }: SendMessageDraftRequest,
  ): SendMessageDraftResult {
    const chat = getBotApiChatAddress(chatId);
    const access = this.#checkBotChatActionAccess(authenticatedBot.id, chat);
    if (!access.allowed && access.reason !== 'bot_blocked') {
      return { sent: false, reason: access.reason };
    }
    const textNormalization = this.#botDraftTexts.normalizeBotDraftText({
      text: text.text,
      entities: text.entities ?? [],
    });
    if (!textNormalization.normalized && textNormalization.failure.reason === 'text_invalid') {
      return { sent: false, ...textNormalization.failure };
    }
    if (chat.type !== 'private') {
      return { sent: false, reason: 'draft_chat_not_private' };
    }
    if (!access.allowed) {
      return { sent: false, reason: access.reason };
    }
    if (draftId === undefined) {
      return { sent: false, reason: 'draft_id_missing' };
    }
    if (!textNormalization.normalized) {
      return { sent: false, ...textNormalization.failure };
    }
    this.#messageDrafts.showBotDraft(
      { accountId: chat.peerId, botId: authenticatedBot.id },
      { draftId, text: textNormalization.formattedText, canStop, keepOnStop },
    );
    return { sent: true };
  }

  /**
   * Checks that the bot may show a chat action, or a message draft, which TDLib sends as one, in a
   * private chat or a supergroup.
   */
  #checkBotChatActionAccess(
    botId: number,
    chat: ChatAddress,
  ):
    | { readonly allowed: true }
    | { readonly allowed: false; readonly reason: BotChatActionAccessFailureReason } {
    const access = chat.type === 'private'
      ? this.#botMessages.checkBotChatActionAccess({ fromBotId: botId, chat })
      : this.#supergroupBotMessages.checkBotChatActionAccess({ fromBotId: botId, chat });
    if (access.allowed) {
      return access;
    }
    if (access.reason === 'bot_not_found') {
      throw new Error(`Authenticated bot ${botId} does not exist`);
    }
    return { allowed: false, reason: access.reason };
  }

  /**
   * Replaces the content and inline keyboard of a text or rich message the bot sent with new text
   * and its entities, or with a rich message, which may change the message's kind. As for
   * `sendRichMessage`, the files of a rich message are resolved before the message is found.
   */
  editMessageText(
    authenticatedBot: VirtualBotProfile,
    { chatId, messageId, content, inlineKeyboard }: EditMessageTextRequest,
  ): EditMessageTextResult {
    const replacement = this.#resolveTextMessageReplacement(authenticatedBot, content);
    if (!replacement.resolved) {
      return { edited: false, ...replacement.failure };
    }
    const result = this.#presentChatMessageEdit(
      authenticatedBot,
      this.#messageEditing.editChatMessageText({
        ...this.#chatMessageTarget(authenticatedBot, chatId, messageId),
        content: replacement.content,
        inlineKeyboard,
      }),
    );
    if (result.edited) {
      return result;
    }

    switch (result.reason) {
      case 'text_invalid':
      case 'send_permission_missing':
        return result;
      default:
        return { edited: false, reason: excludeMissingBotFailure(authenticatedBot, result.reason) };
    }
  }

  /**
   * Replaces the caption, its entities, and the inline keyboard of captioned media the bot sent;
   * empty caption text removes the caption.
   */
  editMessageCaption(
    authenticatedBot: VirtualBotProfile,
    { chatId, messageId, caption, showsCaptionAboveMedia, inlineKeyboard }:
      EditMessageCaptionRequest,
  ): EditMessageCaptionResult {
    const result = this.#presentChatMessageEdit(
      authenticatedBot,
      this.#messageEditing.editChatMessageCaption({
        ...this.#chatMessageTarget(authenticatedBot, chatId, messageId),
        caption: caption.text,
        captionEntities: caption.entities,
        showsCaptionAboveMedia,
        inlineKeyboard,
      }),
    );
    if (result.edited) {
      return result;
    }

    switch (result.reason) {
      case 'text_invalid':
        return result;
      default:
        return { edited: false, reason: excludeMissingBotFailure(authenticatedBot, result.reason) };
    }
  }

  /**
   * Replaces the content, caption and inline keyboard of a message the bot sent with a new photo,
   * document, video, or audio file, as TDLib's `edit_message_media` does; a photo, document,
   * video, or audio message changes its media, and a text or rich message becomes media. As for `sendPhoto`, the file is
   * resolved before the message is found.
   */
  editMessageMedia(
    authenticatedBot: VirtualBotProfile,
    { chatId, messageId, media, inlineKeyboard }: EditMessageMediaRequest,
  ): EditMessageMediaResult {
    const mediaResolution = this.#botMedia.resolveMediaContent(authenticatedBot.id, media);
    if (!mediaResolution.resolved) {
      return { edited: false, ...mediaResolution.failure };
    }
    const result = this.#presentChatMessageEdit(
      authenticatedBot,
      this.#messageEditing.editChatMessageMedia({
        ...this.#chatMessageTarget(authenticatedBot, chatId, messageId),
        media: mediaResolution.file,
        inlineKeyboard,
      }),
    );
    if (result.edited) {
      return result;
    }

    switch (result.reason) {
      case 'text_invalid':
      case 'send_permission_missing':
        return result;
      default:
        return { edited: false, reason: excludeMissingBotFailure(authenticatedBot, result.reason) };
    }
  }

  /** Replaces the inline keyboard of a message the bot sent. */
  editMessageReplyMarkup(
    authenticatedBot: VirtualBotProfile,
    { chatId, messageId, inlineKeyboard }: EditMessageReplyMarkupRequest,
  ): EditMessageResult<EditMessageReplyMarkupFailureReason> {
    const result = this.#presentChatMessageEdit(
      authenticatedBot,
      this.#messageEditing.editChatMessageKeyboard({
        ...this.#chatMessageTarget(authenticatedBot, chatId, messageId),
        inlineKeyboard,
      }),
    );
    if (result.edited) {
      return result;
    }
    return { edited: false, reason: excludeMissingBotFailure(authenticatedBot, result.reason) };
  }

  /**
   * Stops a poll the bot sent, as the official Bot API server's `process_stop_poll_query` and
   * TDLib's `stop_poll` do, and answers with the closed poll. The message is found as an edit finds
   * it, then the poll as `findStoppablePoll` finds it; stopping a closed poll fails. The message
   * shows the new keyboard, or none; no bot receives an `edited_message` update for it.
   */
  stopPoll(
    authenticatedBot: VirtualBotProfile,
    { chatId, messageId, inlineKeyboard }: StopPollRequest,
  ): StopPollResult {
    const result = this.#messageEditing.stopPoll({
      ...this.#chatMessageTarget(authenticatedBot, chatId, messageId),
      inlineKeyboard,
    });
    if (result.stopped) {
      return { stopped: true, poll: this.#botMessageViews.viewPollForCreator(result.poll) };
    }
    return { stopped: false, reason: excludeMissingBotFailure(authenticatedBot, result.reason) };
  }

  /**
   * Pins a message of a bot's chat, as `MessagePinningService.pinMessageByBot` pins it,
   * which then receives the pin's service message, as the official server's
   * `need_skip_update_message` keeps a bot's own pins.
   */
  pinChatMessage(
    authenticatedBot: VirtualBotProfile,
    { chatId, messageId, isSilent }: PinChatMessageRequest,
  ): BotApiPinChatMessageResult {
    const result = this.#messagePinning.pinMessageByBot({
      fromBotId: authenticatedBot.id,
      chat: getBotApiChatAddress(chatId),
      messageId,
      isSilent,
    });
    return result.pinned
      ? { pinned: true }
      : { pinned: false, reason: excludeMissingBotFailure(authenticatedBot, result.reason) };
  }

  /**
   * Unpins a message of a bot's chat, or, without one, the chat's newest pinned message, as
   * `MessagePinningService.unpinMessageByBot` unpins it. No service message records it.
   */
  unpinChatMessage(
    authenticatedBot: VirtualBotProfile,
    { chatId, messageId }: UnpinChatMessageRequest,
  ): BotApiUnpinChatMessageResult {
    const result = this.#messagePinning.unpinMessageByBot({
      fromBotId: authenticatedBot.id,
      chat: getBotApiChatAddress(chatId),
      messageId,
    });
    return result.unpinned
      ? { unpinned: true }
      : { unpinned: false, reason: excludeMissingBotFailure(authenticatedBot, result.reason) };
  }

  /**
   * Unpins every message of a bot's chat, as `MessagePinningService.unpinAllMessagesByBot` unpins
   * them. No service message records it.
   */
  unpinAllChatMessages(
    authenticatedBot: VirtualBotProfile,
    { chatId }: UnpinAllChatMessagesRequest,
  ): BotApiUnpinAllChatMessagesResult {
    const result = this.#messagePinning.unpinAllMessagesByBot({
      fromBotId: authenticatedBot.id,
      chat: getBotApiChatAddress(chatId),
    });
    return result.unpinned
      ? { unpinned: true }
      : { unpinned: false, reason: excludeMissingBotFailure(authenticatedBot, result.reason) };
  }

  /**
   * Replaces the bot's reactions to a message of a supergroup it is a member of, as
   * `MessageReactionService.setBotMessageReaction` replaces them. Reactions in private chats are
   * not supported.
   */
  setMessageReaction(
    authenticatedBot: VirtualBotProfile,
    { chatId, messageId, emojis }: SetMessageReactionRequest,
  ): BotApiSetMessageReactionResult {
    if (getBotApiChatAddress(chatId).type === 'private') {
      return { set: false, reason: 'private_chat_reactions_unsupported' };
    }
    const result = this.#messageReactions.setBotMessageReaction({
      botId: authenticatedBot.id,
      chatId,
      messageId,
      emojis,
    });
    if (result.set) {
      return result;
    }
    if (result.reason === 'bot_not_found') {
      throw new Error(`Authenticated bot ${authenticatedBot.id} does not exist`);
    }
    return { set: false, reason: result.reason };
  }

  /**
   * Deletes a message of a chat: in a private chat, a message of either participant; in a
   * supergroup, one of the bot's own messages, or any message as an administrator with the
   * `can_delete_messages` right. Unlike `deleteMessages`, it fails when the ID identifies no
   * message of the chat, as on Telegram.
   */
  deleteMessage(
    authenticatedBot: VirtualBotProfile,
    { chatId, messageId }: DeleteMessageRequest,
  ): DeleteMessageResult {
    const result = this.#deleteChatMessages(authenticatedBot, chatId, [messageId]);
    if (!result.deleted) {
      return result;
    }
    return result.deletedMessageCount === 0
      ? { deleted: false, reason: 'message_not_found' }
      : { deleted: true };
  }

  /**
   * Deletes messages of a chat, as `deleteMessage` does. As on Telegram, IDs that identify no
   * message of the chat are skipped.
   */
  deleteMessages(
    authenticatedBot: VirtualBotProfile,
    { chatId, messageIds }: DeleteMessagesRequest,
  ): DeleteMessagesResult {
    const result = this.#deleteChatMessages(authenticatedBot, chatId, messageIds);
    return result.deleted ? { deleted: true } : result;
  }

  /**
   * Replaces the content and inline keyboard of a text or rich message sent through the bot, as
   * `editMessageText` replaces them. As TDLib's `edit_inline_message_text` requires, a rich
   * message may reuse files by their `file_id` but upload none.
   */
  editInlineMessageText(
    authenticatedBot: VirtualBotProfile,
    { inlineMessageId, content, inlineKeyboard }: EditInlineMessageTextRequest,
  ): EditInlineMessageTextResult {
    if (!this.#isOwnInlineMessage(authenticatedBot, inlineMessageId)) {
      return { edited: false, reason: 'message_not_found' };
    }
    if (
      content.kind === 'rich_message' &&
      richMessageUploadsFile(content.richMessage)
    ) {
      return { edited: false, reason: 'inline_message_upload_unsupported' };
    }
    const replacement = this.#resolveTextMessageReplacement(authenticatedBot, content);
    if (!replacement.resolved) {
      return { edited: false, ...replacement.failure };
    }
    const result = this.#messageEditing.editInlineMessageText({
      fromBotId: authenticatedBot.id,
      inlineMessageId,
      content: replacement.content,
      inlineKeyboard,
    });
    if (result.edited) {
      return { edited: true };
    }
    switch (result.reason) {
      case 'text_invalid':
        return result;
      default:
        return {
          edited: false,
          reason: excludeInlineMessageEditabilityFailure(authenticatedBot, result.reason),
        };
    }
  }

  /**
   * Replaces the caption, its entities, and the inline keyboard of captioned media sent through the
   * bot; empty caption text removes the caption.
   */
  editInlineMessageCaption(
    authenticatedBot: VirtualBotProfile,
    { inlineMessageId, caption, showsCaptionAboveMedia, inlineKeyboard }:
      EditInlineMessageCaptionRequest,
  ): EditInlineMessageResult<EditInlineMessageCaptionFailureReason> {
    if (!this.#isOwnInlineMessage(authenticatedBot, inlineMessageId)) {
      return { edited: false, reason: 'message_not_found' };
    }
    const result = this.#messageEditing.editInlineMessageCaption({
      fromBotId: authenticatedBot.id,
      inlineMessageId,
      caption: caption.text,
      captionEntities: caption.entities,
      showsCaptionAboveMedia,
      inlineKeyboard,
    });
    if (result.edited) {
      return { edited: true };
    }
    switch (result.reason) {
      case 'text_invalid':
        return result;
      default:
        return {
          edited: false,
          reason: excludeInlineMessageEditabilityFailure(authenticatedBot, result.reason),
        };
    }
  }

  /**
   * Replaces the content, caption and inline keyboard of a message sent through the bot with a
   * new photo, document, video, or audio file, as `editMessageMedia` replaces them. As TDLib's
   * `edit_inline_message_media` requires, the media may reuse a file by its `file_id` or name one
   * by URL but not upload one. A voice note that an inline query result sent keeps its media, as
   * any voice note does.
   */
  editInlineMessageMedia(
    authenticatedBot: VirtualBotProfile,
    { inlineMessageId, media, inlineKeyboard }: EditInlineMessageMediaRequest,
  ): EditInlineMessageMediaResult {
    if (!this.#isOwnInlineMessage(authenticatedBot, inlineMessageId)) {
      return { edited: false, reason: 'message_not_found' };
    }
    if (getMediaReplacementFile(media).kind === 'upload') {
      return { edited: false, reason: 'inline_message_upload_unsupported' };
    }
    const mediaResolution = this.#botMedia.resolveMediaContent(authenticatedBot.id, media);
    if (!mediaResolution.resolved) {
      return { edited: false, ...mediaResolution.failure };
    }
    const result = this.#messageEditing.editInlineMessageMedia({
      fromBotId: authenticatedBot.id,
      inlineMessageId,
      media: mediaResolution.file,
      inlineKeyboard,
    });
    if (result.edited) {
      return { edited: true };
    }
    switch (result.reason) {
      case 'text_invalid':
        return result;
      case 'album_media_kind_changed':
        throw new Error(`Inline message ${inlineMessageId} belongs to an album`);
      default:
        return {
          edited: false,
          reason: excludeInlineMessageEditabilityFailure(authenticatedBot, result.reason),
        };
    }
  }

  /** Replaces the inline keyboard of a message sent through the bot. */
  editInlineMessageReplyMarkup(
    authenticatedBot: VirtualBotProfile,
    { inlineMessageId, inlineKeyboard }: EditInlineMessageReplyMarkupRequest,
  ): EditInlineMessageResult<EditInlineMessageReplyMarkupFailureReason> {
    if (!this.#isOwnInlineMessage(authenticatedBot, inlineMessageId)) {
      return { edited: false, reason: 'message_not_found' };
    }
    const result = this.#messageEditing.editInlineMessageKeyboard({
      fromBotId: authenticatedBot.id,
      inlineMessageId,
      inlineKeyboard,
    });
    return result.edited ? { edited: true } : {
      edited: false,
      reason: excludeInlineMessageEditabilityFailure(authenticatedBot, result.reason),
    };
  }

  /**
   * Whether an inline message identifier names a message sent through the bot's inline mode, which
   * an inline edit checks before it reads the new content. Another bot's inline message is not the
   * bot's own.
   */
  #isOwnInlineMessage(
    authenticatedBot: VirtualBotProfile,
    inlineMessageId: InlineMessageId,
  ): boolean {
    return this.#messageEditing.findBotInlineMessage(authenticatedBot.id, inlineMessageId) !==
      undefined;
  }

  /**
   * The message of one of the bot's chats that a chat message edit addresses, by the chat its
   * `chat_id` names and the ID by which that chat's messages are addressed.
   */
  #chatMessageTarget(
    authenticatedBot: VirtualBotProfile,
    chatId: number,
    messageId: number,
  ): BotChatMessageTarget {
    return { fromBotId: authenticatedBot.id, chat: getBotApiChatAddress(chatId), messageId };
  }

  #deleteChatMessages(
    authenticatedBot: VirtualBotProfile,
    chatId: number,
    messageIds: readonly number[],
  ):
    | { readonly deleted: true; readonly deletedMessageCount: number }
    | { readonly deleted: false; readonly reason: MessageDeletionFailureReason } {
    const result = this.#messageDeletion.deleteChatMessages({
      fromBotId: authenticatedBot.id,
      chat: getBotApiChatAddress(chatId),
      messageIds,
    });
    if (result.deleted) {
      return result;
    }

    switch (result.reason) {
      case 'chat_not_found':
      case 'account_not_found':
      case 'conversation_not_started':
      case 'bot_not_a_member':
      case 'bot_kicked':
      case 'message_not_deletable':
        return { deleted: false, reason: result.reason };
      case 'bot_not_found':
        throw new Error(`Authenticated bot ${authenticatedBot.id} does not exist`);
      default: {
        const unhandledReason: never = result.reason;
        throw new Error(`Unhandled bot message deletion failure: ${unhandledReason}`);
      }
    }
  }

  /** Shows the bot the message its edit of a chat message left, as the bot sees its chat. */
  #presentChatMessageEdit<Failure extends { readonly edited: false }>(
    authenticatedBot: VirtualBotProfile,
    result: { readonly edited: true; readonly message: ChatMessage } | Failure,
  ): { readonly edited: true; readonly message: BotApiMessage } | Failure {
    return result.edited
      ? {
        edited: true,
        message: this.#botMessageViews.viewMessageForBot(result.message, authenticatedBot.id),
      }
      : result;
  }
}

/**
 * Why a `file_id` cannot send a file of the expected type: it identifies no file the bot knows, or
 * a file of another type.
 */
export type FileIdFailure = { readonly reason: 'file_id_invalid' } | FileTypeMismatchFailure;

/** Why a file a request sends cannot be used: an upload Telegram refuses, or an unusable `file_id`. */
export type FileResolutionFailure =
  | { readonly reason: 'file_empty' | 'image_invalid' | 'photo_dimensions_invalid' }
  | PhotoTooBigFailure
  | BotUploadTooBigFailure
  | FileIdFailure;

/** A file a send method resolved to send, or why it cannot be sent. */
export type FileResolution<File> =
  | { readonly resolved: true; readonly file: File }
  | { readonly resolved: false; readonly failure: FileResolutionFailure };

/** The files of a rich message's media blocks, resolved to send, or why one cannot be sent. */
export type RichMessageFilesResolution =
  | { readonly resolved: true; readonly richMessage: OutgoingRichMessage }
  | { readonly resolved: false; readonly failure: FileResolutionFailure };

/**
 * Whether only Telegram's servers refuse a file, once they receive the message that sends it,
 * rather than TDLib as it reads the file: content they cannot process as a photo, or a file larger
 * than a local Bot API server lets bots upload. `api.telegram.org` refuses an oversized upload
 * with the whole request, and TDLib checks emptiness, the photo size limit, and `file_id` values
 * itself.
 */
function isRefusedByTelegramServers(
  failure: FileResolutionFailure,
): failure is ServerRefusedUploadFailure {
  switch (failure.reason) {
    case 'image_invalid':
    case 'photo_dimensions_invalid':
      return true;
    case 'bot_upload_too_big':
      return failure.uploadProfile === 'local';
    default:
      return false;
  }
}

/**
 * A button action's link as TDLib reads it: normalized, for a button that opens one, or TDLib's
 * description of the button it cannot read.
 */
type ButtonActionReading =
  | { readonly read: true; readonly url?: string }
  | { readonly read: false; readonly keyboardError: string };

/** Whether a button opens a link, which reading it normalizes. */
function hasButtonLink<Action extends RichMessageButtonAction>(
  action: Action,
): action is Extract<Action, { readonly url: string }> {
  return action.kind === 'url' || action.kind === 'login_url' || action.kind === 'web_app';
}

/**
 * Reads a URL button's link as TDLib's `get_inline_keyboard_button` does: a `tg://user?id=` link
 * opens the user's profile and is kept in that canonical form, and any other link must pass
 * `check_link`, which normalizes it.
 */
function readInlineButtonUrl(url: string): ButtonActionReading {
  const userId = getLinkUserId(url);
  if (userId !== undefined) {
    return { read: true, url: `tg://user?id=${userId}` };
  }
  const linkCheck = checkLink(url);
  return linkCheck.valid
    ? { read: true, url: linkCheck.url }
    : { read: false, keyboardError: `Inline keyboard button ${linkCheck.error}` };
}

/**
 * Reads the link of a login or Web App button, as TDLib does: an HTTPS link, as `check_link`
 * normalizes it, which cannot open a user's profile. TDLib names the button in its errors, as
 * `Inline keyboard button login` or `Keyboard button Web App`.
 */
function readHttpsButtonUrl(
  url: string,
  buttonDescription:
    | 'Inline keyboard button login'
    | 'Inline keyboard button Web App'
    | 'Keyboard button Web App',
): { readonly read: true; readonly url: string } | {
  readonly read: false;
  readonly keyboardError: string;
} {
  if (getLinkUserId(url) !== undefined) {
    const buttonKind = buttonDescription === 'Inline keyboard button login'
      ? 'login URL'
      : 'Web App URL';
    return { read: false, keyboardError: `Link to a user can't be used in ${buttonKind} buttons` };
  }
  const linkCheck = checkLink(url, { httpsOnly: true });
  return linkCheck.valid
    ? { read: true, url: linkCheck.url }
    : { read: false, keyboardError: `${buttonDescription} ${linkCheck.error}` };
}

/** The file that new media names, as its request specifies it. */
function getMediaReplacementFile(media: MediaReplacementRequest): BotApiInputFile {
  switch (media.kind) {
    case 'photo':
      return media.photo;
    case 'document':
      return media.document;
    case 'video':
      return media.video;
    case 'audio':
      return media.audio;
    default: {
      const unhandledMedia: never = media;
      throw new Error(`Unhandled media replacement: ${JSON.stringify(unhandledMedia)}`);
    }
  }
}

/** Whether a rich message a request specifies uploads a file for one of its media blocks. */
function richMessageUploadsFile(richMessage: RichMessage<BotApiRichMessageFileTypes>): boolean {
  return listRichMessageFiles(richMessage).some((file) =>
    getRichMessageInputFile(file).kind === 'upload'
  );
}

/** The file that a media block of a rich message a request specifies sends, as the request names it. */
function getRichMessageInputFile(
  file: RichMessageFile<BotApiRichMessageFileTypes>,
): BotApiInputFile {
  switch (file.kind) {
    case 'photo':
      return file.file;
    case 'document':
      return file.file.document;
    case 'video':
      return file.file.video;
    case 'voice':
      return file.file.voice;
    default: {
      const unhandledFile: never = file;
      throw new Error(`Unhandled rich message file: ${JSON.stringify(unhandledFile)}`);
    }
  }
}

/**
 * Narrows why an operation of the authenticated bot failed to the reasons it can meet: the
 * authenticated bot itself always exists. The other reasons stay as precise as the domain reports
 * them, for the Bot API's presenters to word.
 */
function excludeMissingBotFailure<Reason extends string>(
  authenticatedBot: VirtualBotProfile,
  reason: Reason | 'bot_not_found',
): Reason {
  if (reason === 'bot_not_found') {
    throw new Error(`Authenticated bot ${authenticatedBot.id} does not exist`);
  }
  return reason;
}

/**
 * Leaves out the failures of an edit of an inline message that cannot occur: the authenticated bot
 * exists, and the bot may edit any message sent through its inline mode, which is neither a
 * forward nor a message with a reply keyboard.
 */
function excludeInlineMessageEditabilityFailure<Reason extends string>(
  authenticatedBot: VirtualBotProfile,
  reason: Reason | 'bot_not_found' | 'message_not_editable',
): Reason {
  switch (reason) {
    case 'bot_not_found':
      throw new Error(`Authenticated bot ${authenticatedBot.id} does not exist`);
    case 'message_not_editable':
      throw new Error(`Bot ${authenticatedBot.id} may not edit its own inline message`);
    default:
      return reason;
  }
}
