import { cleanUploadedFileName } from '../media/document_file.ts';
import { isParseMode, parseMarkup } from '../text_entities/parse_mode.ts';
import { checkLink, getLinkUserId } from '../text_entities/telegram_link.ts';
import type {
  BotApiBotCommand,
  BotApiChatFullInfo,
  BotApiChatMember,
  BotApiDefaultAdministratorRights,
  BotApiDownloadableFile,
  BotApiMenuButton,
  BotApiMessage,
  BotApiPrivateMessage,
  BotApiSupergroupMessage,
  BotApiWebhookInfo,
} from '../types/bot_api.ts';
import type { BotApiPoll } from '../types/bot_api_poll.ts';
import type { BotCommand, BotCommandScope } from '../types/bot_command.ts';
import {
  type ChatAdministratorRightName,
  type DefaultAdministratorRights,
  type DefaultAdministratorRightsChatKind,
  getApplicableAdministratorRightFlags,
} from '../types/bot_default_administrator_rights.ts';
import type { BotDescriptionKind } from '../types/bot_description.ts';
import { type BotMenuButton, toBotApiMenuButton } from '../types/bot_menu_button.ts';
import type { BotLanguageCode } from '../types/bot_language_code.ts';
import type { CallbackQueryId } from '../types/callback_query.ts';
import {
  type ChatMemberStatus,
  type FormerSupergroupMemberFailureReason,
  getSupergroupNonMemberFailureReason,
  type SupergroupAdministratorRights,
} from '../types/chat_membership.ts';
import type { ChatPermissions } from '../types/chat_permissions.ts';
import { createWrittenContact, type WrittenContact } from '../types/contact.ts';
import type { GeoLocation } from '../types/geo_location.ts';
import type { InlineQueryId, InlineQueryResultsButton } from '../types/inline_query.ts';
import {
  MAX_POLL_OPEN_PERIOD_SECONDS,
  MIN_POLL_OPEN_PERIOD_SECONDS,
  type Poll,
  type PollClosingTime,
  type PollId,
  showsQuizSolution,
} from '../types/poll.ts';
import {
  allowsSomeInlineQueryChat,
  type InlineKeyboard,
  type InlineKeyboardButton,
} from '../types/inline_keyboard.ts';
import {
  createMessageForward,
  getRepeatedContent,
  isForwardable,
  type PrivateForwardNameLookup,
  withVideoStartTimestamp,
} from '../types/message_forward.ts';
import {
  type AlbumCompositionFailureReason,
  checkAlbumComposition,
  groupRepeatedAlbums,
  toAlbumMember,
} from '../types/media_album.ts';
import { createExternalReply, type ExternalReplyTarget } from '../types/message_reply.ts';
import {
  type BotMessageReplyMarkup,
  getGroupReplyKeyboardRequestError,
  type ReplyInterfaceMarkup,
  type ReplyKeyboardButton,
} from '../types/reply_interface.ts';
import {
  convertRichMessageFiles,
  listRichMessageFiles,
  mapRichMessageButtons,
  type RichMessage,
  type RichMessageButtonAction,
  type RichMessageFileTypes,
} from '../types/rich_message.ts';
import {
  isWebVoiceNoteSentAsVoiceNote,
  type StoredFile,
  type VideoAttributes,
  type WebFile,
} from '../types/stored_file.ts';
import type { BotUploadTooBigFailure } from '../types/upload_profile.ts';
import { isUserId } from '../types/telegram_identity.ts';
import type { VirtualBot, VirtualBotProfile } from '../types/virtual_bot.ts';
import type { ChatAction, ChatActionChat, Supergroup } from '../types/virtual_chat.ts';
import {
  type CanonicalMessageId,
  type ChatMessage,
  type InlineMessageId,
  isCaptionedMediaContent,
  isContentMessage,
  type MediaGroupId,
  type MessageContent,
  type MessageForwardInfo,
  type PrivateMessage,
  type SupergroupMessage,
  type SupergroupMessageAuthor,
  type TextEntity,
} from '../types/virtual_message.ts';
import type { GetUpdatesRequest, GetUpdatesResult } from './bot_update_polling.ts';
import type {
  DocumentUploadPreparation,
  DocumentUploadRequest,
  PhotoTooBigFailure,
  PhotoUploadPreparation,
  PhotoUploadRequest,
  VideoUploadPreparation,
  VideoUploadRequest,
  VoiceUploadPreparation,
  VoiceUploadRequest,
} from './media_file.ts';
import type {
  DeleteWebhookOutcome,
  DeleteWebhookRequest,
  SetWebhookRequest,
  SetWebhookResult,
} from './bot_webhook.ts';
import type {
  BanChatMemberResult,
  ChangeDefaultPermissionsResult,
  ChangeSupergroupDescriptionResult,
  ChangeSupergroupTitleResult,
  GetChatAdministratorsResult,
  GetChatMemberCountResult,
  GetChatMemberStatusResult,
  GetReadableSupergroupResult,
  LeaveChatResult,
  PromoteChatMemberAsBotFailureReason,
  PromoteChatMemberAsBotResult,
  RestrictChatMemberResult,
  SetCustomTitleAsBotFailureReason,
  SetCustomTitleAsBotResult,
  UnbanChatMemberResult,
} from './shared_chat_administration.ts';
import type {
  AnswerInlineQueryFailureReason,
  AnswerInlineQueryInput,
  AnswerInlineQueryResult,
  SpecifiedInlineQueryResult,
} from './inline_query.ts';
import type {
  CaptionNormalization,
  ContentNormalizationFailure,
  ContentTextNormalizationFailure,
  MediaContent,
  OutgoingCaptionedMedia,
  OutgoingContentOtherThanPoll,
  OutgoingDocument,
  OutgoingMessageContent,
  OutgoingPhoto,
  OutgoingRichMessage,
  OutgoingVideo,
  OutgoingVoice,
  SpecifiedCaption,
  SpecifiedQuote,
  TextInvalidFailure,
  TextMessageReplacement,
} from './message_content.ts';
import type {
  PinMessageInput,
  PinMessageResult,
  PinnedMessagesChat,
  PinningChat,
  UnpinMessageInput,
  UnpinMessageResult,
} from './message_pinning.ts';
import type { PollStopFailureReason } from './poll.ts';
import type { PollLimitFailure } from './poll_normalization.ts';
import type {
  SendBotAlbumInput,
  SendBotAlbumResult,
  StopBotPollInput,
  StopBotPollResult,
} from './private_messaging.ts';
import type {
  SendPermissionMissingFailure,
  SendSupergroupBotAlbumInput,
  SendSupergroupBotAlbumResult,
  StopSupergroupBotPollInput,
  StopSupergroupBotPollResult,
} from './supergroup_messaging.ts';

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
type SendDestinationOptions = BotMessageReplyMarkup & SendDeliveryOptions;

/** Where and how a send method sends its messages, apart from their reply and reply markup. */
interface SendDeliveryOptions {
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

/**
 * What a message being sent replies to: a message of its own chat, which the chat's messaging
 * service looks up, or a resolved message of another chat; neither for a message that replies to
 * none. The messaging service finds the chosen quote in the replied message.
 */
type OutgoingReply =
  & (
    | { readonly replyTo?: ReplyTarget; readonly externalReply?: never }
    | { readonly externalReply: ExternalReplyTarget; readonly replyTo?: never }
  )
  & {
    /** The part of the replied message the bot chose to quote; omitted for none. */
    readonly quote?: SpecifiedQuote;
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

/** The files of a rich message's photo and document blocks, as a request names them. */
export interface BotApiRichMessageFileTypes {
  readonly photo: BotApiInputFile;
  readonly document: BotApiRichMessageDocument;
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

export type SendVoiceRequest = SendRequestOptions & {
  readonly voice: BotApiInputFile;
  /**
   * The duration, in seconds, that the bot specified, which a voice note sent by `file_id` ignores
   * in favor of its own.
   */
  readonly durationSeconds: number;
  /** Empty text for no caption. */
  readonly caption: SpecifiedFormattedText;
};

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

export type SendFailureReason =
  | 'message_text_empty'
  | 'chat_not_found'
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
 * Why the message that a forward or copy repeats cannot be read: its chat is unknown to the bot,
 * or the bot is no member of it, or the chat has no such message.
 */
type RepeatedMessageFailureReason =
  | 'chat_not_found'
  | FormerSupergroupMemberFailureReason
  | 'repeated_message_not_found';

/** A failure of a forward or copy that a send cannot have. */
type RepetitionFailure<NotRepeatableReason extends string> = {
  readonly sent: false;
  readonly reason: 'repeated_message_not_found' | NotRepeatableReason;
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

/** What a message sent by `forwardMessages` or `copyMessages` repeats of the original. */
interface MessageRepetition {
  /** The original's content, or, for a copy of a poll, a new poll like the original's. */
  readonly content: OutgoingMessageContent;
  /** Omitted for a copy, which does not show where it came from. */
  readonly forwardInfo?: MessageForwardInfo;
  /** Omitted when the repetition shows no inline keyboard. */
  readonly inlineKeyboard?: InlineKeyboard;
}

/**
 * What a forward or copy shows beyond its content and reply markup: where a forward's content
 * first appeared, and the new album that a repeated message of an album belongs to.
 */
interface RepetitionDetails {
  /** Omitted for a message that is no forward. */
  readonly forwardInfo?: MessageForwardInfo;
  /** Omitted for a message sent outside any album. */
  readonly mediaGroupId?: MediaGroupId;
}

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
 * document, or a video, uploaded with the request, reused by the `file_id` the bot knows it by,
 * or downloaded from a URL.
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
  | ({ readonly kind: 'video' } & SpecifiedVideo);

/**
 * The photos, videos, or documents that `sendMediaGroup` sends as an album, each specified as
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
   * The message is a voice note or a poll, whose media TDLib's `can_edit_message_media` refuses to
   * edit.
   */
  | 'message_media_not_editable'
  | 'caption_too_long'
  /**
   * The new media is a document for a photo or video of an album, or a photo or video for a
   * document.
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
  | 'inline_message_not_found'
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

interface InlineQueryResultRequestBase {
  /** The bot's identifier of the result. */
  readonly id: string;
  /** Empty for none. */
  readonly description: string;
  /** The keyboard of the sent message; omitted for none. */
  readonly inlineKeyboard?: InlineKeyboard;
}

/**
 * A result of `answerInlineQuery`, as the Bot API specifies it. `messageText` is the text of its
 * `input_message_content`, which a photo or document result sends instead of its own file.
 */
/**
 * What a result's `input_message_content` sends: text, or a rich message, which reuses its files
 * by the `file_id` the bot knows them by.
 */
export type InlineResultMessageContentRequest =
  | { readonly kind: 'text'; readonly text: SpecifiedFormattedText }
  | {
    readonly kind: 'rich_message';
    readonly richMessage: RichMessage<BotApiRichMessageFileTypes>;
    /** Whether Telegram marks the entities it detects in the text. */
    readonly detectsEntities: boolean;
  };

export type InlineQueryResultRequest =
  | (InlineQueryResultRequestBase & {
    readonly kind: 'article';
    readonly title: string;
    /** Empty for none. */
    readonly url: string;
    readonly messageContent: InlineResultMessageContentRequest;
  })
  | (InlineQueryResultRequestBase & {
    readonly kind: 'photo';
    /** The `file_id` the bot knows the photo by. */
    readonly photoFileId: string;
    /** Empty for none. */
    readonly title: string;
    /** Empty text for no caption. */
    readonly caption: SpecifiedFormattedText;
    readonly showsCaptionAboveMedia: boolean;
    readonly messageContent?: InlineResultMessageContentRequest;
  })
  | (InlineQueryResultRequestBase & {
    readonly kind: 'document';
    /** The `file_id` the bot knows the document by. */
    readonly documentFileId: string;
    readonly title: string;
    /** Empty text for no caption. */
    readonly caption: SpecifiedFormattedText;
    readonly messageContent?: InlineResultMessageContentRequest;
  });

export interface AnswerInlineQueryRequest {
  readonly inlineQueryId: InlineQueryId;
  readonly results: readonly InlineQueryResultRequest[];
  readonly cacheTimeSeconds: number;
  readonly isPersonal: boolean;
  /** Empty when there are no more results. */
  readonly nextOffset: string;
  /** Omitted when the client shows no button above the results. */
  readonly button?: InlineQueryResultsButton;
}

export type BotApiAnswerInlineQueryResult =
  | { readonly answered: true }
  | (
    & { readonly answered: false }
    & (
      | {
        readonly reason:
          | AnswerInlineQueryFailureReason
          | 'file_id_invalid'
          | 'inline_message_content_invalid';
      }
      | ContentTextNormalizationFailure
      | FileTypeMismatchFailure
    )
  );

export type GetFileResult =
  | { readonly found: true; readonly file: BotApiDownloadableFile }
  | { readonly found: false; readonly reason: 'file_id_invalid' | 'file_too_big' };

export interface SendChatActionRequest {
  /** The Bot API `chat_id`, as `SendRequestOptions` describes it. */
  readonly chatId: number;
  readonly action: ChatAction;
}

export type SendChatActionResult =
  | { readonly sent: true }
  | {
    readonly sent: false;
    readonly reason: 'chat_not_found' | FormerSupergroupMemberFailureReason | 'bot_blocked';
  };

export interface LeaveChatRequest {
  /** The Bot API `chat_id`, as `SendRequestOptions` describes it. */
  readonly chatId: number;
}

export type BotApiLeaveChatFailureReason =
  | 'chat_not_found'
  | FormerSupergroupMemberFailureReason
  | 'private_chat_not_leavable';

export type BotApiLeaveChatResult =
  | { readonly left: true }
  | { readonly left: false; readonly reason: BotApiLeaveChatFailureReason };

export interface SetChatTitleRequest {
  /** The Bot API `chat_id`, as `SendRequestOptions` describes it. */
  readonly chatId: number;
  /** The title as the bot specified it, before Telegram cleans it. */
  readonly title: string;
}

export interface SetChatDescriptionRequest {
  /** The Bot API `chat_id`, as `SendRequestOptions` describes it. */
  readonly chatId: number;
  /** The description as the bot specified it, before Telegram cleans it; empty removes it. */
  readonly description: string;
}

/** Why a bot cannot change a chat's title or description, in the order Telegram checks them. */
type BotApiChatInfoChangeFailureReason =
  | 'chat_not_found'
  | FormerSupergroupMemberFailureReason
  /** A private chat has no title or description a bot can change. */
  | 'private_chat_info_unchangeable'
  | 'text_encoding_invalid'
  | 'not_enough_rights';

export type BotApiSetChatTitleResult =
  | { readonly set: true }
  | { readonly set: false; readonly reason: BotApiChatInfoChangeFailureReason | 'title_empty' };

export type BotApiSetChatDescriptionResult =
  | { readonly set: true }
  | {
    readonly set: false;
    readonly reason: BotApiChatInfoChangeFailureReason | 'description_not_modified';
  };

export interface SetChatPermissionsRequest {
  /** The Bot API `chat_id`, as `SendRequestOptions` describes it. */
  readonly chatId: number;
  /** What members may do by default, as the Bot API `permissions` grants it. */
  readonly permissions: ChatPermissions;
}

export type BotApiSetChatPermissionsResult =
  | { readonly set: true }
  | {
    readonly set: false;
    readonly reason:
      | 'chat_not_found'
      | FormerSupergroupMemberFailureReason
      /** A private chat has no permissions a bot can change. */
      | 'private_chat_permissions_unchangeable'
      | 'not_enough_rights';
  };

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

export type DeleteMessageRequest = MessageTarget;

export type DeleteMessageResult =
  | { readonly deleted: true }
  | {
    readonly deleted: false;
    readonly reason:
      | 'chat_not_found'
      | FormerSupergroupMemberFailureReason
      | 'message_not_found'
      | 'message_not_deletable';
  };

export interface DeleteMessagesRequest {
  /** The Bot API `chat_id`, as `SendRequestOptions` describes it. */
  readonly chatId: number;
  /** The messages' IDs in the bot's chat. */
  readonly messageIds: readonly number[];
}

export type DeleteMessagesResult =
  | { readonly deleted: true }
  | {
    readonly deleted: false;
    readonly reason:
      | 'chat_not_found'
      | FormerSupergroupMemberFailureReason
      | 'message_not_deletable';
  };

/** Why a bot cannot address a chat whose members it asks about or moderates. */
export type ChatMemberAccessFailureReason = 'chat_not_found' | FormerSupergroupMemberFailureReason;

export interface GetChatMemberRequest {
  /** The Bot API `chat_id`, as `SendRequestOptions` describes it. */
  readonly chatId: number;
  readonly userId: number;
}

export type GetChatMemberResult =
  | { readonly found: true; readonly member: BotApiChatMember }
  | {
    readonly found: false;
    readonly reason: ChatMemberAccessFailureReason | 'member_not_found';
  };

export interface SetChatAdministratorCustomTitleRequest {
  /** The Bot API `chat_id`, as `SendRequestOptions` describes it. */
  readonly chatId: number;
  readonly userId: number;
  /** The new title, before Telegram cleans it; empty removes it. */
  readonly customTitle: string;
}

export type BotApiSetChatAdministratorCustomTitleResult =
  | { readonly set: true }
  | {
    readonly set: false;
    readonly reason:
      | Exclude<SetCustomTitleAsBotFailureReason, 'bot_not_found'>
      | 'method_unavailable_outside_groups';
  };

export interface GetChatAdministratorsRequest {
  /** The Bot API `chat_id`, as `SendRequestOptions` describes it. */
  readonly chatId: number;
  /** The Bot API `return_bots`: whether to include administrators that are other bots. */
  readonly includesOtherBots: boolean;
}

export type BotApiGetChatAdministratorsResult =
  | { readonly found: true; readonly administrators: readonly BotApiChatMember[] }
  | {
    readonly found: false;
    readonly reason: ChatMemberAccessFailureReason | 'private_chat_has_no_administrators';
  };

export interface GetChatRequest {
  /** The Bot API `chat_id`, as `SendRequestOptions` describes it. */
  readonly chatId: number;
}

export type BotApiGetChatResult =
  | { readonly found: true; readonly chat: BotApiChatFullInfo }
  | { readonly found: false; readonly reason: ChatMemberAccessFailureReason };

export interface GetChatMemberCountRequest {
  /** The Bot API `chat_id`, as `SendRequestOptions` describes it. */
  readonly chatId: number;
}

export type BotApiGetChatMemberCountResult =
  | { readonly found: true; readonly memberCount: number }
  | { readonly found: false; readonly reason: ChatMemberAccessFailureReason };

export interface BanChatMemberRequest {
  /** The Bot API `chat_id`, as `SendRequestOptions` describes it. */
  readonly chatId: number;
  readonly userId: number;
  /** The Bot API `until_date`; omitted for a ban that lasts until it is lifted. */
  readonly untilUnixSeconds?: number;
}

/** Why a bot cannot ban a user or lift its ban, as the Bot API reports it. */
export type ChatMemberModerationFailureReason =
  | ChatMemberAccessFailureReason
  | 'member_not_found'
  | 'member_is_owner'
  | 'not_enough_rights'
  | 'member_is_administrator';

export type BotApiBanChatMemberResult =
  | { readonly banned: true }
  | {
    readonly banned: false;
    readonly reason:
      | ChatMemberModerationFailureReason
      | 'cannot_restrict_self'
      | 'private_chat_members_not_bannable';
  };

export interface RestrictChatMemberRequest {
  /** The Bot API `chat_id`, as `SendRequestOptions` describes it. */
  readonly chatId: number;
  readonly userId: number;
  /** The permissions the user keeps, as the Bot API `permissions` grants them. */
  readonly permissions: ChatPermissions;
  /** The Bot API `until_date`; omitted for a restriction that lasts until it is lifted. */
  readonly untilUnixSeconds?: number;
}

export type BotApiRestrictChatMemberResult =
  | { readonly restricted: true }
  | {
    readonly restricted: false;
    readonly reason:
      | ChatMemberModerationFailureReason
      | 'cannot_restrict_self'
      | 'cannot_unrestrict_self'
      | 'not_enough_rights_to_promote'
      | 'method_unavailable_outside_supergroups';
  };

export interface PromoteChatMemberRequest {
  /** The Bot API `chat_id`, as `SendRequestOptions` describes it. */
  readonly chatId: number;
  readonly userId: number;
  /** The supergroup rights the user holds from now on; none demotes an administrator. */
  readonly rights: SupergroupAdministratorRights;
}

export type BotApiPromoteChatMemberResult =
  | { readonly promoted: true }
  | {
    readonly promoted: false;
    readonly reason:
      | Exclude<PromoteChatMemberAsBotFailureReason, 'bot_not_found'>
      | 'method_unavailable_in_private_chats';
  };

export interface UnbanChatMemberRequest {
  /** The Bot API `chat_id`, as `SendRequestOptions` describes it. */
  readonly chatId: number;
  readonly userId: number;
  /** The Bot API `only_if_banned`. */
  readonly onlyIfBanned: boolean;
}

export type BotApiUnbanChatMemberResult =
  | { readonly unbanned: true }
  | {
    readonly unbanned: false;
    readonly reason: ChatMemberModerationFailureReason | 'method_unavailable_in_private_chats';
  };

export interface AnswerCallbackQueryRequest {
  readonly callbackQueryId: CallbackQueryId;
  readonly text?: string;
  readonly showAlert: boolean;
  readonly cacheTimeSeconds: number;
  /** The Bot API `url`; empty or omitted for none. */
  readonly url?: string;
}

export type AnswerCallbackQueryResult =
  | { readonly answered: true }
  | { readonly answered: false; readonly reason: 'query_id_invalid' | 'url_invalid' };

interface BotCredentialLookup {
  getByToken(token: string): VirtualBot | undefined;
}

interface BotUpdatePolling {
  getUpdates(botId: number, request: GetUpdatesRequest): Promise<GetUpdatesResult>;
  terminateLongPollForWebhook(botId: number): void;
}

interface BotWebhooks {
  hasWebhook(botId: number): boolean;
  setWebhook(botId: number, request: SetWebhookRequest): SetWebhookResult;
  deleteWebhook(botId: number, request: DeleteWebhookRequest): DeleteWebhookOutcome;
  getWebhookInfo(botId: number): BotApiWebhookInfo;
}

/** The result of `getUpdates`, which fails while the bot has a webhook. */
export type BotApiGetUpdatesResult =
  | GetUpdatesResult
  | { readonly retrieved: false; readonly reason: 'webhook_active' };

interface BotPrivateChat {
  readonly type: 'private';
  readonly accountId: number;
}

type BotMessageSendingResult =
  | { readonly sent: true; readonly message: PrivateMessage }
  | {
    readonly sent: false;
    readonly reason:
      | 'bot_not_found'
      | 'message_text_empty'
      | 'account_not_found'
      | 'conversation_not_started'
      | 'reply_message_not_found'
      | 'callback_data_invalid'
      | 'quote_invalid'
      | 'bot_blocked';
  }
  | ({ readonly sent: false } & ContentNormalizationFailure);

/** Why an edit of any kind can fail, apart from failures about the new content. */
type BotMessageEditFailureReason =
  | 'bot_not_found'
  | 'account_not_found'
  | 'conversation_not_started'
  | 'message_not_found'
  | 'message_not_editable'
  | 'callback_data_invalid'
  | 'message_not_modified';

type BotMessageEditingResult<FailureReason extends string> =
  | { readonly edited: true; readonly message: PrivateMessage }
  | { readonly edited: false; readonly reason: FailureReason };

/**
 * The message of a private chat that a bot edits: by its ID in the bot's chat, or by the inline
 * message identifier of a message sent through the bot.
 */
type PrivateMessageEditTarget =
  & { readonly fromBotId: number }
  & (
    | { readonly chat: BotPrivateChat; readonly botMessageId: number }
    | { readonly inlineMessageId: InlineMessageId }
  );

/** The supergroup message that a bot edits, addressed as `PrivateMessageEditTarget` describes. */
type SupergroupMessageEditTarget =
  & { readonly fromBotId: number }
  & (
    | { readonly chatId: number; readonly messageId: number }
    | { readonly inlineMessageId: InlineMessageId }
  );

/** A caption edit as the messaging services take it. */
interface CaptionEdit {
  readonly caption: string;
  readonly captionEntities?: readonly TextEntity[];
  readonly showsCaptionAboveMedia: boolean;
  readonly inlineKeyboard?: InlineKeyboard;
}

interface BotMessaging {
  isPrivateConversationStarted(
    key: { readonly accountId: number; readonly botId: number },
  ): boolean;
  getMessageForBot(input: {
    readonly botId: number;
    readonly accountId: number;
    readonly botMessageId: number;
  }):
    | { readonly found: true; readonly message: PrivateMessage }
    | {
      readonly found: false;
      readonly reason:
        | 'bot_not_found'
        | 'account_not_found'
        | 'conversation_not_started'
        | 'message_not_found';
    };
  sendBotMessage(
    input: BotMessageReplyMarkup & {
      readonly fromBotId: number;
      readonly to: BotPrivateChat;
      readonly content: OutgoingMessageContent;
      readonly replyTo?: {
        readonly botMessageId: number;
        readonly allowSendingWithoutReply: boolean;
      };
      readonly externalReply?: ExternalReplyTarget;
      readonly quote?: SpecifiedQuote;
      readonly isContentProtected?: boolean;
      readonly isSilent?: boolean;
      readonly forwardInfo?: MessageForwardInfo;
      readonly mediaGroupId?: MediaGroupId;
      readonly messageEffectId?: string;
    },
  ): BotMessageSendingResult;
  sendBotAlbum(input: SendBotAlbumInput): SendBotAlbumResult;
  editBotMessageText(
    input: PrivateMessageEditTarget & {
      readonly content: TextMessageReplacement;
      readonly inlineKeyboard?: InlineKeyboard;
    },
  ):
    | BotMessageEditingResult<
      | BotMessageEditFailureReason
      | 'message_text_empty'
      | 'message_has_no_text'
      | 'message_text_too_long'
    >
    | ({ readonly edited: false } & TextInvalidFailure);
  editBotMessageCaption(input: CaptionEdit & PrivateMessageEditTarget):
    | BotMessageEditingResult<
      BotMessageEditFailureReason | 'message_has_no_caption' | 'caption_too_long'
    >
    | ({ readonly edited: false } & TextInvalidFailure);
  editBotMessageMedia(
    input: PrivateMessageEditTarget & {
      readonly media: MediaContent;
      readonly inlineKeyboard?: InlineKeyboard;
    },
  ):
    | BotMessageEditingResult<
      | BotMessageEditFailureReason
      | 'message_media_not_editable'
      | 'caption_too_long'
      | 'album_media_kind_changed'
    >
    | ({ readonly edited: false } & TextInvalidFailure);
  editBotMessageInlineKeyboard(
    input: PrivateMessageEditTarget & { readonly inlineKeyboard?: InlineKeyboard },
  ): BotMessageEditingResult<BotMessageEditFailureReason>;
  stopBotPoll(input: StopBotPollInput): StopBotPollResult;
  sendBotChatAction(input: {
    readonly fromBotId: number;
    readonly to: BotPrivateChat;
    readonly action: ChatAction;
  }):
    | { readonly sent: true }
    | {
      readonly sent: false;
      readonly reason:
        | 'bot_not_found'
        | 'account_not_found'
        | 'conversation_not_started'
        | 'bot_blocked';
    };
  deleteMessagesByBot(input: {
    readonly fromBotId: number;
    readonly chat: BotPrivateChat;
    readonly botMessageIds: readonly number[];
  }):
    | { readonly deleted: true; readonly deletedMessageCount: number }
    | {
      readonly deleted: false;
      readonly reason: 'bot_not_found' | 'account_not_found' | 'conversation_not_started';
    };
}

type SupergroupBotMessageEditingResult<FailureReason extends string> =
  | { readonly edited: true; readonly message: SupergroupMessage }
  | { readonly edited: false; readonly reason: FailureReason };

/** Why an edit of any kind can fail in a supergroup, apart from failures about the content. */
type SupergroupBotMessageEditFailureReason =
  | 'bot_not_found'
  | 'chat_not_found'
  | FormerSupergroupMemberFailureReason
  | 'message_not_found'
  | 'message_not_editable'
  | 'callback_data_invalid'
  | 'button_type_invalid'
  | 'message_not_modified';

interface SupergroupBotMessaging {
  getMessageForBot(input: {
    readonly botId: number;
    readonly chatId: number;
    readonly messageId: number;
  }):
    | {
      readonly found: true;
      readonly message: SupergroupMessage;
      readonly supergroup: Supergroup;
    }
    | {
      readonly found: false;
      readonly reason:
        | 'bot_not_found'
        | 'chat_not_found'
        | FormerSupergroupMemberFailureReason
        | 'message_not_found';
    };
  sendBotMessage(
    input: BotMessageReplyMarkup & {
      readonly fromBotId: number;
      readonly chatId: number;
      readonly content: OutgoingMessageContent;
      readonly replyTo?: {
        readonly messageId: number;
        readonly allowSendingWithoutReply: boolean;
      };
      readonly externalReply?: ExternalReplyTarget;
      readonly quote?: SpecifiedQuote;
      readonly isContentProtected?: boolean;
      readonly isSilent?: boolean;
      readonly forwardInfo?: MessageForwardInfo;
      readonly mediaGroupId?: MediaGroupId;
      readonly messageEffectId?: string;
    },
  ):
    | { readonly sent: true; readonly message: SupergroupMessage }
    | {
      readonly sent: false;
      readonly reason:
        | 'bot_not_found'
        | 'message_text_empty'
        | 'chat_not_found'
        | FormerSupergroupMemberFailureReason
        | 'reply_message_not_found'
        | 'message_effect_not_allowed_in_chat'
        | 'callback_data_invalid'
        | 'button_type_invalid'
        | 'quote_invalid';
    }
    | ({ readonly sent: false } & (ContentNormalizationFailure | SendPermissionMissingFailure));
  sendBotAlbum(input: SendSupergroupBotAlbumInput): SendSupergroupBotAlbumResult;
  lacksBotSendPermission(input: {
    readonly botId: number;
    readonly chatId: number;
    readonly content: OutgoingMessageContent;
  }): boolean;
  editBotMessageText(
    input: SupergroupMessageEditTarget & {
      readonly content: TextMessageReplacement;
      readonly inlineKeyboard?: InlineKeyboard;
    },
  ):
    | SupergroupBotMessageEditingResult<
      | SupergroupBotMessageEditFailureReason
      | 'message_text_empty'
      | 'message_has_no_text'
      | 'message_text_too_long'
    >
    | ({ readonly edited: false } & (TextInvalidFailure | SendPermissionMissingFailure));
  editBotMessageCaption(input: CaptionEdit & SupergroupMessageEditTarget):
    | SupergroupBotMessageEditingResult<
      SupergroupBotMessageEditFailureReason | 'message_has_no_caption' | 'caption_too_long'
    >
    | ({ readonly edited: false } & TextInvalidFailure);
  editBotMessageMedia(
    input: SupergroupMessageEditTarget & {
      readonly media: MediaContent;
      readonly inlineKeyboard?: InlineKeyboard;
    },
  ):
    | SupergroupBotMessageEditingResult<
      | SupergroupBotMessageEditFailureReason
      | 'message_media_not_editable'
      | 'caption_too_long'
      | 'album_media_kind_changed'
    >
    | ({ readonly edited: false } & (TextInvalidFailure | SendPermissionMissingFailure));
  editBotMessageInlineKeyboard(
    input: SupergroupMessageEditTarget & { readonly inlineKeyboard?: InlineKeyboard },
  ): SupergroupBotMessageEditingResult<SupergroupBotMessageEditFailureReason>;
  stopBotPoll(input: StopSupergroupBotPollInput): StopSupergroupBotPollResult;
  sendBotChatAction(input: {
    readonly fromBotId: number;
    readonly chatId: number;
    readonly action: ChatAction;
  }):
    | { readonly sent: true }
    | {
      readonly sent: false;
      readonly reason: 'bot_not_found' | 'chat_not_found' | FormerSupergroupMemberFailureReason;
    };
  deleteMessagesByBot(input: {
    readonly fromBotId: number;
    readonly chatId: number;
    readonly messageIds: readonly number[];
  }):
    | { readonly deleted: true; readonly deletedMessageCount: number }
    | {
      readonly deleted: false;
      readonly reason:
        | 'bot_not_found'
        | 'chat_not_found'
        | FormerSupergroupMemberFailureReason
        | 'message_not_deletable';
    };
}

interface ChatMemberships {
  leaveChat(input: { readonly memberId: number; readonly chatId: number }): LeaveChatResult;
  getChatMemberStatus(input: {
    readonly observerBotId: number;
    readonly chatId: number;
    readonly userId: number;
  }): GetChatMemberStatusResult;
  getChatAdministrators(
    input: { readonly observerBotId: number; readonly chatId: number },
  ): GetChatAdministratorsResult;
  getChatMemberCount(
    input: { readonly observerBotId: number; readonly chatId: number },
  ): GetChatMemberCountResult;
  getReadableSupergroup(
    input: { readonly observerBotId: number; readonly chatId: number },
  ): GetReadableSupergroupResult;
  banChatMember(input: {
    readonly actorBotId: number;
    readonly chatId: number;
    readonly memberId: number;
    readonly requestedBanEndUnixSeconds?: number;
  }): BanChatMemberResult;
  restrictChatMember(input: {
    readonly actorBotId: number;
    readonly chatId: number;
    readonly memberId: number;
    readonly permissions: ChatPermissions;
    readonly requestedRestrictionEndUnixSeconds?: number;
  }): RestrictChatMemberResult;
  unbanChatMember(input: {
    readonly actorBotId: number;
    readonly chatId: number;
    readonly memberId: number;
    readonly onlyIfBanned: boolean;
  }): UnbanChatMemberResult;
  promoteChatMemberAsBot(input: {
    readonly actorBotId: number;
    readonly chatId: number;
    readonly memberId: number;
    readonly rights: SupergroupAdministratorRights;
  }): PromoteChatMemberAsBotResult;
  setCustomTitleAsBot(input: {
    readonly actorBotId: number;
    readonly chatId: number;
    readonly memberId: number;
    readonly customTitle: string;
  }): SetCustomTitleAsBotResult;
  changeSupergroupTitle(input: {
    readonly actor: SupergroupMessageAuthor;
    readonly chatId: number;
    readonly title: string;
  }): ChangeSupergroupTitleResult;
  changeSupergroupDescription(input: {
    readonly actor: SupergroupMessageAuthor;
    readonly chatId: number;
    readonly description: string;
  }): ChangeSupergroupDescriptionResult;
  changeDefaultPermissions(input: {
    readonly actor: SupergroupMessageAuthor;
    readonly chatId: number;
    readonly permissions: ChatPermissions;
  }): ChangeDefaultPermissionsResult;
}

interface MediaFiles {
  preparePhotoUpload(request: PhotoUploadRequest): PhotoUploadPreparation;
  prepareDocumentUpload(request: DocumentUploadRequest): DocumentUploadPreparation;
  prepareVideoUpload(request: VideoUploadRequest): VideoUploadPreparation;
  prepareVoiceUpload(request: VoiceUploadRequest): VoiceUploadPreparation;
  findObserverFile(observerId: number, fileId: string): StoredFile | undefined;
  getBotFile(botId: number, fileId: string):
    | {
      readonly found: true;
      readonly downloadableFile: {
        readonly file: StoredFile;
        readonly fileId: string;
        readonly filePath: string;
      };
    }
    | { readonly found: false; readonly reason: 'file_id_invalid' | 'file_too_big' };
  findBotFileByPath(botId: number, filePath: string): StoredFile | undefined;
}

/** A command list of the bot, addressed as the command methods address it. */
export interface MyCommandsTarget {
  readonly scope: BotCommandScope;
  readonly languageCode: BotLanguageCode;
}

export interface SetMyCommandsRequest extends MyCommandsTarget {
  readonly commands: readonly {
    readonly command: string;
    readonly description: string;
    readonly isEphemeral: boolean;
  }[];
}

/** Why a scope or language cannot address one of the bot's command lists. */
export type MyCommandsTargetFailureReason =
  | 'chat_not_found'
  | FormerSupergroupMemberFailureReason
  | 'scope_not_allowed_in_private_chats'
  | 'language_code_invalid';

export type SetMyCommandsFailureReason =
  | MyCommandsTargetFailureReason
  | 'command_not_utf8'
  | 'command_description_not_utf8'
  | 'command_empty'
  | 'command_too_long'
  | 'command_description_empty'
  | 'command_description_too_long'
  | 'too_many_commands'
  | 'command_invalid';

export type SetMyCommandsResult =
  | { readonly set: true }
  | { readonly set: false; readonly reason: SetMyCommandsFailureReason };

export type GetMyCommandsResult =
  | { readonly found: true; readonly commands: readonly BotApiBotCommand[] }
  | { readonly found: false; readonly reason: MyCommandsTargetFailureReason };

export type DeleteMyCommandsResult =
  | { readonly deleted: true }
  | { readonly deleted: false; readonly reason: MyCommandsTargetFailureReason };

interface BotCommandListAddress extends MyCommandsTarget {
  readonly botId: number;
}

type BotCommandListTargetFailure = MyCommandsTargetFailureReason | 'bot_not_found';

interface BotCommandLists {
  setBotCommands(input: BotCommandListAddress & Pick<SetMyCommandsRequest, 'commands'>):
    | { readonly set: true }
    | {
      readonly set: false;
      readonly reason:
        | BotCommandListTargetFailure
        | Exclude<
          SetMyCommandsFailureReason,
          MyCommandsTargetFailureReason
        >;
    };
  getBotCommands(target: BotCommandListAddress):
    | { readonly found: true; readonly commands: readonly BotCommand[] }
    | { readonly found: false; readonly reason: BotCommandListTargetFailure };
  deleteBotCommands(target: BotCommandListAddress):
    | { readonly deleted: true }
    | { readonly deleted: false; readonly reason: BotCommandListTargetFailure };
}

/** A description or short description of the bot, addressed by its kind and language. */
export interface MyDescriptionTarget {
  readonly kind: BotDescriptionKind;
  readonly languageCode: BotLanguageCode;
}

export interface SetMyDescriptionRequest extends MyDescriptionTarget {
  /** Empty to remove the text for the language. */
  readonly text: string;
}

export type SetMyDescriptionResult =
  | { readonly set: true }
  | { readonly set: false; readonly reason: 'text_not_utf8' | 'language_code_invalid' };

export type GetMyDescriptionResult =
  | { readonly found: true; readonly text: string }
  | { readonly found: false; readonly reason: 'language_code_invalid' };

interface BotDescriptions {
  setBotDescription(input: SetMyDescriptionRequest & { readonly botId: number }):
    | { readonly set: true }
    | {
      readonly set: false;
      readonly reason: 'bot_not_found' | 'text_not_utf8' | 'language_code_invalid';
    };
  getBotDescription(target: MyDescriptionTarget & { readonly botId: number }):
    | { readonly found: true; readonly text: string }
    | { readonly found: false; readonly reason: 'bot_not_found' | 'language_code_invalid' };
}

interface BotDefaultAdministratorRightsSettings {
  setDefaultAdministratorRights(input: {
    readonly botId: number;
    readonly kind: DefaultAdministratorRightsChatKind;
    readonly requestedRights: Iterable<ChatAdministratorRightName>;
  }): { readonly set: true } | { readonly set: false; readonly reason: 'bot_not_found' };
  getDefaultAdministratorRights(target: {
    readonly botId: number;
    readonly kind: DefaultAdministratorRightsChatKind;
  }):
    | { readonly found: true; readonly rights: DefaultAdministratorRights }
    | { readonly found: false; readonly reason: 'bot_not_found' };
}

/** Why a user cannot be addressed or a menu button is rejected, in the order Telegram checks. */
export type SetChatMenuButtonFailureReason =
  | 'user_not_found'
  | 'menu_button_text_empty'
  | 'menu_button_text_not_utf8'
  | 'menu_button_url_not_utf8';

export type SetChatMenuButtonResult =
  | { readonly set: true }
  | { readonly set: false; readonly reason: SetChatMenuButtonFailureReason }
  | {
    readonly set: false;
    readonly reason: 'web_app_url_invalid';
    /** TDLib's description of the invalid URL. */
    readonly urlError: string;
  };

export type GetChatMenuButtonResult =
  | { readonly found: true; readonly menuButton: BotApiMenuButton }
  | { readonly found: false; readonly reason: 'user_not_found' };

interface BotMenuButtons {
  setBotMenuButton(input: {
    readonly botId: number;
    readonly userId?: number;
    readonly menuButton: BotMenuButton;
  }):
    | { readonly set: true }
    | {
      readonly set: false;
      readonly reason: SetChatMenuButtonFailureReason | 'bot_not_found';
    }
    | { readonly set: false; readonly reason: 'web_app_url_invalid'; readonly urlError: string };
  getBotMenuButton(target: { readonly botId: number; readonly userId?: number }):
    | { readonly found: true; readonly menuButton: BotMenuButton }
    | { readonly found: false; readonly reason: 'bot_not_found' | 'user_not_found' };
}

interface CallbackQueryAnswering {
  answerCallbackQuery(input: {
    readonly fromBotId: number;
    readonly callbackQueryId: CallbackQueryId;
    readonly text?: string;
    readonly showAlert: boolean;
    readonly cacheTimeSeconds: number;
    readonly url?: string;
  }):
    | { readonly answered: true }
    | {
      readonly answered: false;
      readonly reason: 'callback_query_not_answerable' | 'url_invalid';
    };
}

interface InlineQueryAnswering {
  answerInlineQuery(input: AnswerInlineQueryInput): AnswerInlineQueryResult;
}

interface InlineMessageLookup {
  getMessageByInlineMessageId(inlineMessageId: InlineMessageId): ChatMessage | undefined;
}

interface MediaGroupIdIssuer {
  createMediaGroupId(): MediaGroupId;
}

interface PollLookup {
  getPoll(pollId: PollId): Poll | undefined;
}

interface BotCaptionNormalizer {
  normalizeBotCaption(caption: SpecifiedCaption): CaptionNormalization;
}

interface BotMessageViews {
  viewPollForBot(poll: Poll): BotApiPoll;
  viewPrivateMessageForBot(message: PrivateMessage): BotApiPrivateMessage;
  viewSupergroupMessage(message: SupergroupMessage, observerId: number): BotApiSupergroupMessage;
  viewChatMember(input: {
    readonly chatId: number;
    readonly userId: number;
    readonly status: ChatMemberStatus;
    readonly observerBotId: number;
  }): BotApiChatMember | undefined;
  viewChatFullInfo(input: {
    readonly chatId: number;
    readonly observerBotId: number;
    readonly pinnedMessage: ChatMessage | undefined;
  }): BotApiChatFullInfo | undefined;
}

interface MessagePinning {
  pinMessage(input: PinMessageInput): PinMessageResult;
  unpinMessage(input: UnpinMessageInput): UnpinMessageResult;
  findNewestPinnedMessage(chat: PinnedMessagesChat): ChatMessage | undefined;
}

interface ChatActions {
  recordBotChatAction(input: {
    readonly botId: number;
    readonly chat: ChatActionChat;
    readonly action: ChatAction;
  }): void;
  endBotChatAction(input: { readonly botId: number; readonly chat: ChatActionChat }): void;
}

interface BotApiServiceDependencies {
  readonly bots: BotCredentialLookup;
  readonly updatePolling: BotUpdatePolling;
  readonly webhooks: BotWebhooks;
  readonly botMessages: BotMessaging;
  readonly supergroupBotMessages: SupergroupBotMessaging;
  readonly chatMemberships: ChatMemberships;
  readonly botMessageViews: BotMessageViews;
  /** Pins and unpins messages, and finds the pinned message that `getChat` shows. */
  readonly messagePinning: MessagePinning;
  readonly mediaFiles: MediaFiles;
  readonly callbackQueries: CallbackQueryAnswering;
  readonly inlineQueries: InlineQueryAnswering;
  readonly inlineMessages: InlineMessageLookup;
  /** Issues the identifiers of the albums that forwards and copies of albums form. */
  readonly mediaGroups: MediaGroupIdIssuer;
  /** Finds the polls that copies of poll messages repeat. */
  readonly polls: PollLookup;
  /**
   * Normalizes the captions of an album, which are checked before the album is handed to the
   * messaging services, as they normalize the caption of a bot's media.
   */
  readonly botCaptions: BotCaptionNormalizer;
  readonly botCommands: BotCommandLists;
  readonly botDescriptions: BotDescriptions;
  readonly defaultAdministratorRights: BotDefaultAdministratorRightsSettings;
  readonly menuButtons: BotMenuButtons;
  readonly chatActions: ChatActions;
  readonly publicChats: PublicChatDirectory;
  /** Hides the accounts whose privacy settings keep forwards from linking to them. */
  readonly getPrivateForwardName: PrivateForwardNameLookup;
  /** The time that closing times of polls count from. */
  readonly currentUnixTimeSeconds: () => number;
}

interface PublicChatDirectory {
  findPublicChatId(username: string): number | undefined;
}

/**
 * The application boundary for Bot API methods.
 *
 * Transport authenticates each call with `authenticate` before invoking a method, so that an
 * invalid token is rejected before request parameters are validated, as Telegram does. Invariants
 * that span a bot's configuration and update delivery, such as polling and webhook delivery being
 * mutually exclusive, belong here rather than in route handlers.
 */
export class BotApiService {
  readonly #bots: BotCredentialLookup;
  readonly #updatePolling: BotUpdatePolling;
  readonly #webhooks: BotWebhooks;
  readonly #botMessages: BotMessaging;
  readonly #supergroupBotMessages: SupergroupBotMessaging;
  readonly #chatMemberships: ChatMemberships;
  readonly #botMessageViews: BotMessageViews;
  readonly #messagePinning: MessagePinning;
  readonly #mediaFiles: MediaFiles;
  readonly #callbackQueries: CallbackQueryAnswering;
  readonly #inlineQueries: InlineQueryAnswering;
  readonly #inlineMessages: InlineMessageLookup;
  readonly #mediaGroups: MediaGroupIdIssuer;
  readonly #polls: PollLookup;
  readonly #botCaptions: BotCaptionNormalizer;
  readonly #botCommands: BotCommandLists;
  readonly #botDescriptions: BotDescriptions;
  readonly #defaultAdministratorRights: BotDefaultAdministratorRightsSettings;
  readonly #menuButtons: BotMenuButtons;
  readonly #chatActions: ChatActions;
  readonly #publicChats: PublicChatDirectory;
  readonly #getPrivateForwardName: PrivateForwardNameLookup;
  readonly #currentUnixTimeSeconds: () => number;

  constructor(
    {
      bots,
      updatePolling,
      webhooks,
      botMessages,
      supergroupBotMessages,
      chatMemberships,
      botMessageViews,
      messagePinning,
      mediaFiles,
      callbackQueries,
      inlineQueries,
      inlineMessages,
      mediaGroups,
      polls,
      botCaptions,
      botCommands,
      botDescriptions,
      defaultAdministratorRights,
      menuButtons,
      chatActions,
      publicChats,
      getPrivateForwardName,
      currentUnixTimeSeconds,
    }: BotApiServiceDependencies,
  ) {
    this.#bots = bots;
    this.#updatePolling = updatePolling;
    this.#webhooks = webhooks;
    this.#botMessages = botMessages;
    this.#supergroupBotMessages = supergroupBotMessages;
    this.#chatMemberships = chatMemberships;
    this.#botMessageViews = botMessageViews;
    this.#messagePinning = messagePinning;
    this.#mediaFiles = mediaFiles;
    this.#callbackQueries = callbackQueries;
    this.#inlineQueries = inlineQueries;
    this.#inlineMessages = inlineMessages;
    this.#mediaGroups = mediaGroups;
    this.#polls = polls;
    this.#botCaptions = botCaptions;
    this.#botCommands = botCommands;
    this.#botDescriptions = botDescriptions;
    this.#defaultAdministratorRights = defaultAdministratorRights;
    this.#menuButtons = menuButtons;
    this.#chatActions = chatActions;
    this.#publicChats = publicChats;
    this.#getPrivateForwardName = getPrivateForwardName;
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
   * Polls the authenticated bot's pending updates. As on Telegram, a bot with a webhook cannot
   * poll, and its subscription is left unchanged.
   */
  async getUpdates(
    authenticatedBot: VirtualBotProfile,
    request: GetUpdatesRequest,
  ): Promise<BotApiGetUpdatesResult> {
    if (this.#webhooks.hasWebhook(authenticatedBot.id)) {
      return { retrieved: false, reason: 'webhook_active' };
    }
    return await this.#updatePolling.getUpdates(authenticatedBot.id, request);
  }

  /**
   * Sets the authenticated bot's webhook, or deletes it for an empty URL. As on Telegram, setting
   * a new webhook terminates the bot's held long poll.
   */
  setWebhook(authenticatedBot: VirtualBotProfile, request: SetWebhookRequest): SetWebhookResult {
    const result = this.#webhooks.setWebhook(authenticatedBot.id, request);
    if (result.accepted && result.outcome === 'webhook_set') {
      this.#updatePolling.terminateLongPollForWebhook(authenticatedBot.id);
    }
    return result;
  }

  /** Deletes the authenticated bot's webhook. A held long poll is left running, as on Telegram. */
  deleteWebhook(
    authenticatedBot: VirtualBotProfile,
    request: DeleteWebhookRequest,
  ): DeleteWebhookOutcome {
    return this.#webhooks.deleteWebhook(authenticatedBot.id, request);
  }

  getWebhookInfo(authenticatedBot: VirtualBotProfile): BotApiWebhookInfo {
    return this.#webhooks.getWebhookInfo(authenticatedBot.id);
  }

  /**
   * Reads message text with its `parse_mode` or `entities`, as the official Bot API server's
   * `Client::get_formatted_text` does before it looks at the chat: a parse mode other than `none`
   * turns markup into entities and overrides `entities`. The result still has to pass the checks
   * that sending or editing applies.
   *
   * Date and time entities, which Telegram's markup can produce, are not supported.
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
   * messages and with an inline keyboard. A message to a private chat can instead change the
   * account's reply interface. Telegram also shows a reply interface to chosen members of a group,
   * which the emulator does not support.
   */
  sendMessage(
    authenticatedBot: VirtualBotProfile,
    { text, entities, ...options }: SendMessageRequest,
  ): SendResult {
    return this.#send(authenticatedBot, { kind: 'text', text, entities }, options);
  }

  /**
   * Sends a rich message, laid out in blocks, as `sendMessage` sends text. Its photos and
   * documents are uploaded with the request or reused by the `file_id` the bot knows them by, as
   * `sendPhoto` and `sendDocument` send theirs, and are resolved before the chat, as theirs are.
   */
  sendRichMessage(
    authenticatedBot: VirtualBotProfile,
    { richMessage, detectsEntities, ...options }: SendRichMessageRequest,
  ): SendResult {
    const resolution = this.#resolveRichMessageFiles(authenticatedBot, richMessage);
    if (!resolution.resolved) {
      return { sent: false, ...resolution.failure };
    }
    return this.#send(authenticatedBot, {
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
    const photoResolution = this.#resolvePhoto(authenticatedBot, photo);
    if (!photoResolution.resolved) {
      return { sent: false, ...photoResolution.failure };
    }
    return this.#send(authenticatedBot, {
      kind: 'photo',
      photo: photoResolution.file,
      caption: caption.text,
      captionEntities: caption.entities,
      hasSpoiler,
      showsCaptionAboveMedia,
    }, options);
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
    const documentResolution = this.#resolveDocument(authenticatedBot, document, thumbnail);
    if (!documentResolution.resolved) {
      return { sent: false, ...documentResolution.failure };
    }
    return this.#send(authenticatedBot, {
      kind: 'document',
      document: documentResolution.file,
      caption: caption.text,
      captionEntities: caption.entities,
    }, options);
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
    const resolution = this.#resolveVideoMedia(authenticatedBot, {
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
    return this.#send(authenticatedBot, resolution.file, options);
  }

  /**
   * Sends a voice note with an optional caption, as `sendPhoto` sends a photo. Telegram documents
   * that its clients play OGG/Opus, MP3 and M4A voice notes and that it may send other formats as
   * audio or documents; the emulator inspects no content and always sends a voice note, apart from
   * one sent by URL, which `#resolveVoiceMedia` may send as a document.
   */
  sendVoice(
    authenticatedBot: VirtualBotProfile,
    { voice, durationSeconds, caption, ...options }: SendVoiceRequest,
  ): SendResult {
    const resolution = this.#resolveVoiceMedia(authenticatedBot, voice, durationSeconds, {
      caption: caption.text,
      captionEntities: caption.entities,
    });
    if (!resolution.resolved) {
      return { sent: false, ...resolution.failure };
    }
    return this.#send(authenticatedBot, resolution.file, options);
  }

  /**
   * Sends photos and videos, or documents, to a private chat or a supergroup as an album, as
   * TDLib's `send_message_group` does: each message's file is resolved as `sendPhoto`, `sendVideo`
   * and `sendDocument` resolve theirs, in order, and the album is then checked as
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
      const resolution = this.#resolveMediaReplacement(authenticatedBot, member);
      if (!resolution.resolved && !isRefusedByTelegramServers(resolution.failure)) {
        return { sent: false, ...resolution.failure };
      }
      // As TDLib's `get_input_message_content` does, each message's caption is checked once its
      // file is read, before the next message; the messaging service checks it again when it
      // stores the album.
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

    const replyResolution = this.#resolveOutgoingReply(authenticatedBot, replyTo);
    if (!replyResolution.resolved) {
      return { sent: false, reason: replyResolution.reason };
    }
    const result = isUserId(options.chatId)
      ? this.#sendPrivateAlbum(authenticatedBot, contents, options, replyResolution.reply)
      : this.#sendSupergroupAlbum(authenticatedBot, contents, options, replyResolution.reply);
    if (result.sent) {
      // As for a single message, the album ends the bot's chat action.
      this.#chatActions.endBotChatAction({
        botId: authenticatedBot.id,
        chat: getChatActionChat(authenticatedBot, options.chatId),
      });
    }
    return result;
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
    return this.#send(
      authenticatedBot,
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
    return this.#send(authenticatedBot, { kind: 'location', location }, options);
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
    return this.#send(authenticatedBot, {
      kind: 'poll',
      poll: {
        creatorBotId: authenticatedBot.id,
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
   * Forwards a message of one of the bot's chats to a private chat or a supergroup, as TDLib does:
   * the forward repeats the message's content and shows who first sent it and when. As on Telegram,
   * a message whose sender protected it cannot be forwarded, nor can a service message. A request's
   * video start timestamp replaces that of a forwarded video, as `withVideoStartTimestamp` does. A
   * forward of a poll shows the same poll, whose votes it shares. As TDLib's `forward_messages_impl`
   * skips content the bot may not send to a supergroup, such content cannot be forwarded there.
   *
   * The forwarded message is checked in full before the chat it goes to, while TDLib checks whether
   * it can be forwarded only after that chat; a request that fails both ways fails for the message.
   */
  forwardMessage(
    authenticatedBot: VirtualBotProfile,
    {
      chatId,
      forwardedMessage,
      videoStartTimestampSeconds,
      isContentProtected,
      isSilent,
      messageEffectId,
    }: ForwardMessageRequest,
  ): ForwardMessageResult {
    const lookup = this.#findRepeatedMessage(authenticatedBot, forwardedMessage);
    if (!lookup.found) {
      return { sent: false, reason: lookup.reason };
    }
    if (!isForwardable(lookup.message, lookup.chatProtectsContent)) {
      return { sent: false, reason: 'message_not_forwardable' };
    }
    const { content, forwardInfo, inlineKeyboard } = createMessageForward(
      lookup.message,
      this.#getPrivateForwardName,
    );
    const result = this.#send(
      authenticatedBot,
      {
        kind: 'existing',
        content: videoStartTimestampSeconds === undefined
          ? content
          : withVideoStartTimestamp(content, videoStartTimestampSeconds),
      },
      {
        chatId,
        isContentProtected,
        isSilent,
        messageEffectId,
        ...(inlineKeyboard === undefined ? {} : { inlineKeyboard }),
      },
      { forwardInfo },
    );
    // TDLib's `forward_messages_impl` skips content the bot may not send, which leaves nothing.
    return !result.sent && result.reason === 'send_permission_missing'
      ? { sent: false, reason: 'message_not_forwardable' }
      : result;
  }

  /**
   * Copies a message of one of the bot's chats to a private chat or a supergroup as the bot's own
   * message, which, unlike a forward, does not show where it came from, and which takes the reply
   * and reply markup of the request instead of the original's. A new caption replaces the caption
   * of copied media, while text and rich messages stay as they are, apart from the buttons of a
   * rich message, which change as for a forward, and a video takes the request's start timestamp,
   * if any, as for a forward. A copy of a poll is a new poll, as `#createPollCopy` creates it, which
   * ignores a new caption; a quiz whose solution the bot does not see cannot be copied. As TDLib
   * lets bots do, a bot may copy a message whose sender protected it; a service message cannot be
   * copied, nor can content the bot may not send to a supergroup.
   *
   * As for `forwardMessage`, the copied message is checked in full before the chat it goes to.
   */
  copyMessage(
    authenticatedBot: VirtualBotProfile,
    {
      copiedMessage,
      videoStartTimestampSeconds,
      caption,
      showsCaptionAboveMedia,
      ...options
    }: CopyMessageRequest,
  ): CopyMessageResult {
    const lookup = this.#findRepeatedMessage(authenticatedBot, copiedMessage);
    if (!lookup.found) {
      return { sent: false, reason: lookup.reason };
    }
    if (!isContentMessage(lookup.message)) {
      return { sent: false, reason: 'message_not_copyable' };
    }
    const content = getRepeatedContent(lookup.message.content, 'copy');
    const copiedContent: OutgoingMessageContent | undefined = content.kind === 'poll'
      ? this.#createPollCopy(authenticatedBot, content.pollId)
      : {
        kind: 'existing',
        content: videoStartTimestampSeconds === undefined
          ? content
          : withVideoStartTimestamp(content, videoStartTimestampSeconds),
        ...(caption === undefined ? {} : {
          captionReplacement: {
            caption: caption.text,
            captionEntities: caption.entities,
            showsCaptionAboveMedia,
          },
        }),
      };
    if (copiedContent === undefined) {
      return { sent: false, reason: 'message_not_copyable' };
    }
    const result = this.#send(authenticatedBot, copiedContent, options);
    if (result.sent) {
      return { sent: true, messageId: result.message.message_id };
    }
    // As for `forwardMessage`, TDLib skips content the bot may not send.
    return result.reason === 'send_permission_missing'
      ? { sent: false, reason: 'message_not_copyable' }
      : result;
  }

  /**
   * Forwards up to 100 messages of one of the bot's chats to a private chat or a supergroup, each
   * as `forwardMessage` does, as TDLib's `forward_messages` does. A message that is not found, that
   * cannot be forwarded, or whose content the bot may not send to the chat, is skipped; the request
   * fails only when none is left.
   */
  forwardMessages(
    authenticatedBot: VirtualBotProfile,
    request: RepeatMessagesRequest,
  ): RepeatMessagesResult {
    return this.#repeatMessages(authenticatedBot, request, (message, chatProtectsContent) => {
      if (!isForwardable(message, chatProtectsContent)) {
        return undefined;
      }
      const { content, forwardInfo, inlineKeyboard } = createMessageForward(
        message,
        this.#getPrivateForwardName,
      );
      return {
        content: { kind: 'existing', content },
        forwardInfo,
        ...(inlineKeyboard === undefined ? {} : { inlineKeyboard }),
      };
    });
  }

  /**
   * Copies up to 100 messages of one of the bot's chats to a private chat or a supergroup, as
   * `forwardMessages` forwards them. As TDLib's `dup_reply_markup` does for copies, the copies keep
   * no reply markup; `removesCaptions` sends media without their captions. As for `copyMessage`, a
   * copy of a poll is a new poll.
   */
  copyMessages(
    authenticatedBot: VirtualBotProfile,
    { removesCaptions, ...request }: CopyMessagesRequest,
  ): RepeatMessagesResult {
    return this.#repeatMessages(
      authenticatedBot,
      request,
      (message) => {
        if (!isContentMessage(message)) {
          return undefined;
        }
        const content = getRepeatedContent(message.content, 'copy');
        if (content.kind === 'poll') {
          const pollCopy = this.#createPollCopy(authenticatedBot, content.pollId);
          return pollCopy === undefined ? undefined : { content: pollCopy };
        }
        return {
          content: {
            kind: 'existing',
            content: removesCaptions ? withoutCaption(content) : content,
          },
        };
      },
    );
  }

  /** Returns a file the bot knows by its `file_id`, with the `file_path` to download it from. */
  getFile(authenticatedBot: VirtualBotProfile, fileId: string): GetFileResult {
    const result = this.#mediaFiles.getBotFile(authenticatedBot.id, fileId);
    if (!result.found) {
      return result;
    }
    const { file, filePath } = result.downloadableFile;
    return {
      found: true,
      file: {
        file_id: result.downloadableFile.fileId,
        file_unique_id: file.uniqueId,
        file_size: file.content.length,
        file_path: filePath,
      },
    };
  }

  /** Returns the file at a `file_path` that `getFile` gave the bot, for download. */
  downloadFile(authenticatedBot: VirtualBotProfile, filePath: string): StoredFile | undefined {
    return this.#mediaFiles.findBotFileByPath(authenticatedBot.id, filePath);
  }

  /**
   * Sends the repetitions of messages of one of the bot's chats to a chat, in the order of their
   * IDs, as TDLib's `forward_messages_impl` does: a message that `repeat` cannot repeat is skipped,
   * and a message that replies to an earlier message of the request replies to that message's
   * repetition.
   *
   * As for `forwardMessage`, the messages are checked before the chat they go to; every repetition
   * goes to that chat, so a chat the bot cannot send to fails before any message is sent.
   */
  #repeatMessages(
    authenticatedBot: VirtualBotProfile,
    { chatId, fromChatId, messageIds, isContentProtected, isSilent, messageEffectId }:
      RepeatMessagesRequest,
    repeat: (message: ChatMessage, chatProtectsContent: boolean) => MessageRepetition | undefined,
  ): RepeatMessagesResult {
    const repeatedMessages: Array<{
      readonly messageId: number;
      readonly message: ChatMessage;
      readonly chatProtectsContent: boolean;
    }> = [];
    for (const messageId of messageIds) {
      const lookup = this.#findRepeatedMessage(authenticatedBot, { chatId: fromChatId, messageId });
      if (lookup.found) {
        const { message, chatProtectsContent } = lookup;
        repeatedMessages.push({ messageId, message, chatProtectsContent });
      } else if (lookup.reason !== 'repeated_message_not_found') {
        return { sent: false, reason: lookup.reason };
      }
    }
    if (repeatedMessages.length === 0) {
      return { sent: false, reason: 'repeated_messages_not_found' };
    }
    if (messageEffectId !== undefined) {
      if (!isUserId(chatId)) {
        return { sent: false, reason: 'message_effect_not_allowed_in_chat' };
      }
      if (repeatedMessages.length > 1) {
        return { sent: false, reason: 'message_effect_not_allowed_for_several_messages' };
      }
    }
    if (
      repeatedMessages.some(({ messageId }, index) =>
        index > 0 && messageId <= repeatedMessages[index - 1].messageId
      )
    ) {
      return { sent: false, reason: 'repeated_message_ids_not_increasing' };
    }
    const repetitions = repeatedMessages.flatMap(({ message, chatProtectsContent }) => {
      const repetition = repeat(message, chatProtectsContent);
      return repetition === undefined ||
          this.#lacksSendPermission(authenticatedBot, chatId, repetition.content)
        ? []
        : [{ message, repetition }];
    });
    if (repetitions.length === 0) {
      return { sent: false, reason: 'messages_not_repeatable' };
    }

    const { albumCount, albumIndexes } = groupRepeatedAlbums(
      repetitions.map(({ message }) => message),
    );
    const newMediaGroupIds = Array.from(
      { length: albumCount },
      () => this.#mediaGroups.createMediaGroupId(),
    );
    const sentMessageIdsByRepeatedMessageId = new Map<CanonicalMessageId, number>();
    for (const [repetitionIndex, { message, repetition }] of repetitions.entries()) {
      const repliedMessageId = message.replyToMessageId === undefined
        ? undefined
        : sentMessageIdsByRepeatedMessageId.get(message.replyToMessageId);
      const albumIndex = albumIndexes[repetitionIndex];
      const { content, forwardInfo, inlineKeyboard } = repetition;
      const result = this.#send(
        authenticatedBot,
        content,
        {
          chatId,
          isContentProtected,
          isSilent,
          messageEffectId,
          ...(inlineKeyboard === undefined ? {} : { inlineKeyboard }),
          ...(repliedMessageId === undefined
            ? {}
            : { replyTo: { messageId: repliedMessageId, allowSendingWithoutReply: true } }),
        },
        {
          forwardInfo,
          mediaGroupId: albumIndex === undefined ? undefined : newMediaGroupIds[albumIndex],
        },
      );
      if (!result.sent) {
        return result;
      }
      sentMessageIdsByRepeatedMessageId.set(message.id, result.message.message_id);
    }
    return { sent: true, messageIds: [...sentMessageIdsByRepeatedMessageId.values()] };
  }

  /**
   * Whether the bot lacks a permission it needs to send content to a supergroup it is a member of,
   * as `SupergroupMessagingService.lacksBotSendPermission` decides; a private chat restricts no
   * content.
   */
  #lacksSendPermission(
    authenticatedBot: VirtualBotProfile,
    chatId: number,
    content: OutgoingMessageContent,
  ): boolean {
    return !isUserId(chatId) &&
      this.#supergroupBotMessages.lacksBotSendPermission({
        botId: authenticatedBot.id,
        chatId,
        content,
      });
  }

  /**
   * Creates the content of a copy of a poll, as TDLib's `dup_poll` does: a new poll that the copying
   * bot owns, open and without votes, with the original's question, options, settings, and quiz
   * solution, and the original's open period counted from now. As TDLib's `has_input_media` and
   * the Bot API require, a quiz can be copied only by a bot that sees its solution, as
   * `showsQuizSolution` decides; returns `undefined` for any other quiz.
   */
  #createPollCopy(
    authenticatedBot: VirtualBotProfile,
    pollId: PollId,
  ): OutgoingMessageContent | undefined {
    const poll = this.#polls.getPoll(pollId);
    if (poll === undefined) {
      throw new Error(`Copied poll ${pollId} does not exist`);
    }
    if (poll.type.kind === 'quiz' && !showsQuizSolution(poll, authenticatedBot.id)) {
      return undefined;
    }
    const openPeriodSeconds = poll.closingTime?.openPeriodSeconds;
    return {
      kind: 'poll',
      poll: {
        creatorBotId: authenticatedBot.id,
        question: poll.question,
        options: poll.options.map(({ text }) => text),
        isAnonymous: poll.isAnonymous,
        allowsMultipleAnswers: poll.allowsMultipleAnswers,
        allowsRevoting: poll.allowsRevoting,
        type: poll.type,
        isClosed: false,
        ...(openPeriodSeconds === undefined ? {} : {
          closingTime: {
            openPeriodSeconds,
            closeDateUnixSeconds: this.#currentUnixTimeSeconds() + openPeriodSeconds,
          },
        }),
      },
    };
  }

  /**
   * Finds the message of one of the bot's chats that a forward or copy repeats. As on Telegram, a
   * chat the bot cannot address is not found.
   */
  /**
   * Finds a message of one of the bot's chats for the bot to repeat or reply to, with whether its
   * chat protects all content: only a supergroup can.
   */
  #findRepeatedMessage(
    authenticatedBot: VirtualBotProfile,
    { chatId, messageId }: MessageTarget,
  ):
    | {
      readonly found: true;
      readonly message: ChatMessage;
      readonly chatProtectsContent: boolean;
    }
    | { readonly found: false; readonly reason: RepeatedMessageFailureReason } {
    const lookup = isUserId(chatId)
      ? this.#botMessages.getMessageForBot({
        botId: authenticatedBot.id,
        accountId: chatId,
        botMessageId: messageId,
      })
      : this.#supergroupBotMessages.getMessageForBot({
        botId: authenticatedBot.id,
        chatId,
        messageId,
      });
    if (lookup.found) {
      return {
        found: true,
        message: lookup.message,
        chatProtectsContent: 'supergroup' in lookup && lookup.supergroup.hasProtectedContent,
      };
    }

    const { reason } = lookup;
    switch (reason) {
      case 'chat_not_found':
      case 'bot_not_a_member':
      case 'bot_kicked':
        return { found: false, reason };
      case 'account_not_found':
      case 'conversation_not_started':
        return { found: false, reason: 'chat_not_found' };
      case 'message_not_found':
        return { found: false, reason: 'repeated_message_not_found' };
      case 'bot_not_found':
        throw new Error(`Authenticated bot ${authenticatedBot.id} does not exist`);
      default: {
        const unhandledReason: never = reason;
        throw new Error(`Unhandled repeated message lookup failure: ${unhandledReason}`);
      }
    }
  }

  /**
   * Sends content to a private chat or a supergroup; a forward also shows where it came from, and
   * a repeated message of an album belongs to the album its repetition forms.
   *
   * A reply to a message of another chat is resolved before the chat the message goes to, while
   * Telegram checks that chat and the text first; a request that fails both ways fails for its
   * reply.
   */
  #send(
    authenticatedBot: VirtualBotProfile,
    content: OutgoingMessageContent,
    { replyTo, ...options }: SendRequestOptions,
    repetitionDetails: RepetitionDetails = {},
  ): SendResult {
    const replyResolution = this.#resolveOutgoingReply(authenticatedBot, replyTo);
    if (!replyResolution.resolved) {
      return { sent: false, reason: replyResolution.reason };
    }
    const { reply } = replyResolution;
    const result = isUserId(options.chatId)
      ? this.#sendPrivateMessage(authenticatedBot, content, options, reply, repetitionDetails)
      : this.#sendSupergroupMessage(authenticatedBot, content, options, reply, repetitionDetails);
    if (result.sent) {
      // As TDLib's `DialogActionManager` does, a bot's message ends its chat action.
      this.#chatActions.endBotChatAction({
        botId: authenticatedBot.id,
        chat: getChatActionChat(authenticatedBot, options.chatId),
      });
    }
    return result;
  }

  /**
   * Resolves what a message being sent replies to. The chat's messaging service looks up a message
   * of the chat itself. A message of another chat is resolved here, as the official Bot API
   * server's `check_reply_parameters` does: the bot must be able to read that chat, and a message it
   * does not find fails the send unless the bot allowed sending without a reply. As TDLib's
   * `create_message_input_reply_to` does, a message that cannot be forwarded, such as protected
   * content or a service message, is silently not replied to.
   */
  #resolveOutgoingReply(authenticatedBot: VirtualBotProfile, replyTo: ReplyTarget | undefined):
    | { readonly resolved: true; readonly reply: OutgoingReply }
    | {
      readonly resolved: false;
      readonly reason:
        | 'chat_not_found'
        | FormerSupergroupMemberFailureReason
        | 'reply_message_not_found';
    } {
    if (replyTo?.chatId === undefined) {
      return {
        resolved: true,
        reply: replyTo === undefined ? {} : { replyTo, quote: replyTo.quote },
      };
    }
    const { chatId, messageId, allowSendingWithoutReply, quote } = replyTo;
    const lookup = this.#findRepeatedMessage(authenticatedBot, { chatId, messageId });
    if (!lookup.found) {
      if (lookup.reason !== 'repeated_message_not_found') {
        return { resolved: false, reason: lookup.reason };
      }
      return allowSendingWithoutReply
        ? { resolved: true, reply: {} }
        : { resolved: false, reason: 'reply_message_not_found' };
    }
    return {
      resolved: true,
      reply: isForwardable(lookup.message, lookup.chatProtectsContent)
        ? {
          externalReply: createExternalReply(
            lookup.message,
            messageId,
            this.#getPrivateForwardName,
          ),
          quote,
        }
        : {},
    };
  }

  #sendPrivateMessage(
    authenticatedBot: VirtualBotProfile,
    content: OutgoingMessageContent,
    { chatId, isContentProtected, isSilent, messageEffectId, ...replyMarkup }:
      SendDestinationOptions,
    { replyTo, externalReply, quote }: OutgoingReply,
    { forwardInfo, mediaGroupId }: RepetitionDetails,
  ): SendResult {
    const result = this.#botMessages.sendBotMessage({
      ...replyMarkup,
      fromBotId: authenticatedBot.id,
      to: { type: 'private', accountId: chatId },
      content,
      replyTo: replyTo === undefined ? undefined : {
        botMessageId: replyTo.messageId,
        allowSendingWithoutReply: replyTo.allowSendingWithoutReply,
      },
      externalReply,
      quote,
      isContentProtected,
      isSilent,
      forwardInfo,
      mediaGroupId,
      messageEffectId,
    });
    if (result.sent) {
      return {
        sent: true,
        message: this.#botMessageViews.viewPrivateMessageForBot(result.message),
      };
    }

    switch (result.reason) {
      case 'text_invalid':
        return result;
      case 'message_text_empty':
      case 'reply_message_not_found':
      case 'message_text_too_long':
      case 'caption_too_long':
      case 'callback_data_invalid':
      case 'quote_invalid':
      case 'poll_question_too_long':
      case 'poll_options_missing':
      case 'poll_has_too_many_options':
      case 'poll_option_too_long':
      case 'quiz_correct_options_missing':
      case 'quiz_correct_options_not_increasing':
      case 'quiz_correct_option_not_found':
      case 'quiz_explanation_too_long':
      case 'quiz_explanation_has_too_many_line_feeds':
      case 'bot_blocked':
        return { sent: false, reason: result.reason };
      // A bot can address a user only after the user has written to it. Telegram reports any
      // other user, like an unknown chat, as not found.
      case 'account_not_found':
      case 'conversation_not_started':
        return { sent: false, reason: 'chat_not_found' };
      case 'bot_not_found':
        throw new Error(`Authenticated bot ${authenticatedBot.id} does not exist`);
      default: {
        const unhandledFailure: never = result;
        throw new Error(`Unhandled bot message failure: ${JSON.stringify(unhandledFailure)}`);
      }
    }
  }

  #sendSupergroupMessage(
    authenticatedBot: VirtualBotProfile,
    content: OutgoingMessageContent,
    { chatId, isContentProtected, isSilent, messageEffectId, ...replyMarkup }:
      SendDestinationOptions,
    { replyTo, externalReply, quote }: OutgoingReply,
    { forwardInfo, mediaGroupId }: RepetitionDetails,
  ): SendResult {
    const result = this.#supergroupBotMessages.sendBotMessage({
      ...replyMarkup,
      fromBotId: authenticatedBot.id,
      chatId,
      content,
      replyTo,
      externalReply,
      quote,
      isContentProtected,
      isSilent,
      forwardInfo,
      mediaGroupId,
      messageEffectId,
    });
    if (result.sent) {
      return {
        sent: true,
        message: this.#botMessageViews.viewSupergroupMessage(result.message, authenticatedBot.id),
      };
    }

    switch (result.reason) {
      case 'text_invalid':
      case 'send_permission_missing':
        return result;
      case 'message_text_empty':
      case 'chat_not_found':
      case 'bot_not_a_member':
      case 'bot_kicked':
      case 'reply_message_not_found':
      case 'message_effect_not_allowed_in_chat':
      case 'message_text_too_long':
      case 'caption_too_long':
      case 'callback_data_invalid':
      case 'button_type_invalid':
      case 'quote_invalid':
      case 'poll_question_too_long':
      case 'poll_options_missing':
      case 'poll_has_too_many_options':
      case 'poll_option_too_long':
      case 'quiz_correct_options_missing':
      case 'quiz_correct_options_not_increasing':
      case 'quiz_correct_option_not_found':
      case 'quiz_explanation_too_long':
      case 'quiz_explanation_has_too_many_line_feeds':
        return { sent: false, reason: result.reason };
      case 'bot_not_found':
        throw new Error(`Authenticated bot ${authenticatedBot.id} does not exist`);
      default: {
        const unhandledFailure: never = result;
        throw new Error(`Unhandled bot message failure: ${JSON.stringify(unhandledFailure)}`);
      }
    }
  }

  #sendPrivateAlbum(
    authenticatedBot: VirtualBotProfile,
    contents: readonly MediaContent[],
    { chatId, isContentProtected, isSilent, messageEffectId }: SendDeliveryOptions,
    { replyTo, externalReply, quote }: OutgoingReply,
  ): SendMediaGroupResult {
    const result = this.#botMessages.sendBotAlbum({
      fromBotId: authenticatedBot.id,
      to: { type: 'private', accountId: chatId },
      contents,
      replyTo: replyTo === undefined ? undefined : {
        botMessageId: replyTo.messageId,
        allowSendingWithoutReply: replyTo.allowSendingWithoutReply,
      },
      externalReply,
      quote,
      isContentProtected,
      isSilent,
      messageEffectId,
    });
    if (result.sent) {
      return {
        sent: true,
        messages: result.messages.map((message) =>
          this.#botMessageViews.viewPrivateMessageForBot(message)
        ),
      };
    }

    switch (result.reason) {
      case 'text_invalid':
        return result;
      case 'reply_message_not_found':
      case 'message_text_too_long':
      case 'caption_too_long':
      case 'quote_invalid':
      case 'bot_blocked':
      case 'album_empty':
      case 'album_too_large':
      case 'album_caption_placement_mixed':
      case 'album_documents_mixed':
        return { sent: false, reason: result.reason };
      // As for a single message, Telegram reports a user who has not started the bot as not found.
      case 'account_not_found':
      case 'conversation_not_started':
        return { sent: false, reason: 'chat_not_found' };
      case 'bot_not_found':
        throw new Error(`Authenticated bot ${authenticatedBot.id} does not exist`);
      default: {
        const unhandledFailure: never = result;
        throw new Error(`Unhandled bot album failure: ${JSON.stringify(unhandledFailure)}`);
      }
    }
  }

  #sendSupergroupAlbum(
    authenticatedBot: VirtualBotProfile,
    contents: readonly MediaContent[],
    { chatId, isContentProtected, isSilent, messageEffectId }: SendDeliveryOptions,
    { replyTo, externalReply, quote }: OutgoingReply,
  ): SendMediaGroupResult {
    const result = this.#supergroupBotMessages.sendBotAlbum({
      fromBotId: authenticatedBot.id,
      chatId,
      contents,
      replyTo,
      externalReply,
      quote,
      isContentProtected,
      isSilent,
      messageEffectId,
    });
    if (result.sent) {
      return {
        sent: true,
        messages: result.messages.map((message) =>
          this.#botMessageViews.viewSupergroupMessage(message, authenticatedBot.id)
        ),
      };
    }

    switch (result.reason) {
      case 'text_invalid':
      case 'send_permission_missing':
        return result;
      case 'chat_not_found':
      case 'bot_not_a_member':
      case 'bot_kicked':
      case 'reply_message_not_found':
      case 'message_effect_not_allowed_in_chat':
      case 'message_text_too_long':
      case 'caption_too_long':
      case 'quote_invalid':
      case 'album_empty':
      case 'album_too_large':
      case 'album_caption_placement_mixed':
      case 'album_documents_mixed':
        return { sent: false, reason: result.reason };
      case 'bot_not_found':
        throw new Error(`Authenticated bot ${authenticatedBot.id} does not exist`);
      default: {
        const unhandledFailure: never = result;
        throw new Error(`Unhandled bot album failure: ${JSON.stringify(unhandledFailure)}`);
      }
    }
  }

  /**
   * Resolves the photo a request sends: an upload, a photo the bot knows by `file_id`, or an image
   * downloaded from a URL, which is checked as an upload is.
   */
  #resolvePhoto(authenticatedBot: VirtualBotProfile, input: BotApiInputFile): FileResolution<
    OutgoingPhoto
  > {
    if (input.kind === 'file_id') {
      const file = this.#mediaFiles.findObserverFile(authenticatedBot.id, input.fileId);
      if (file?.type === 'photo') {
        return { resolved: true, file: { kind: 'stored', file } };
      }
      return { resolved: false, failure: fileIdFailure(file, 'photo') };
    }
    const preparation = this.#mediaFiles.preparePhotoUpload(
      input.kind === 'upload'
        ? { content: input.content, source: 'bot_upload' }
        : { content: input.webFile.content, source: 'web_download' },
    );
    return preparation.prepared
      ? { resolved: true, file: { kind: 'upload', upload: preparation.upload } }
      : { resolved: false, failure: uploadPreparationFailure(preparation) };
  }

  /**
   * Resolves the document a request sends: an upload, whose name the Bot API server cleans, with
   * the thumbnail uploaded for it; a document the bot knows by `file_id`, which keeps its own
   * thumbnail; or a file downloaded from a URL, named after the URL and typed as it was served.
   * TDLib sends a URL document as `inputMediaDocumentExternal`, which takes no thumbnail, so an
   * uploaded thumbnail is left out.
   */
  #resolveDocument(
    authenticatedBot: VirtualBotProfile,
    input: BotApiInputFile,
    thumbnailContent: Uint8Array<ArrayBuffer> | undefined,
  ): FileResolution<OutgoingDocument> {
    if (input.kind === 'file_id') {
      const file = this.#mediaFiles.findObserverFile(authenticatedBot.id, input.fileId);
      if (file?.type === 'document') {
        return { resolved: true, file: { kind: 'stored', file } };
      }
      return { resolved: false, failure: fileIdFailure(file, 'document') };
    }
    const preparation = this.#mediaFiles.prepareDocumentUpload(
      input.kind === 'upload'
        ? {
          content: input.content,
          fileName: cleanUploadedFileName(input.fileName),
          ...(thumbnailContent === undefined ? {} : { thumbnailContent }),
          source: 'bot_upload',
        }
        : {
          content: input.webFile.content,
          fileName: cleanUploadedFileName(input.webFile.fileName),
          mimeType: input.webFile.mediaType,
          source: 'web_download',
        },
    );
    return preparation.prepared
      ? { resolved: true, file: { kind: 'upload', upload: preparation.upload } }
      : { resolved: false, failure: uploadPreparationFailure(preparation) };
  }

  /**
   * Resolves the video a request sends, as `#resolveDocument` resolves a document: an upload, whose
   * name the Bot API server cleans, with the duration, dimensions and thumbnail the bot specified;
   * a video the bot knows by `file_id`, which keeps its own; or a file downloaded from a URL, named
   * after the URL's last path segment, if it has one, and typed as it was served. As for a
   * document, TDLib sends a URL video as `inputMediaDocumentExternal`, which takes no thumbnail, so
   * an uploaded thumbnail is left out. That media carries none of the bot's attributes either,
   * which Telegram's servers determine themselves; the emulator, which reads no video content,
   * keeps the ones the bot specified.
   */
  #resolveVideo(
    authenticatedBot: VirtualBotProfile,
    input: BotApiInputFile,
    attributes: VideoAttributes,
    thumbnailContent: Uint8Array<ArrayBuffer> | undefined,
  ): FileResolution<OutgoingVideo> {
    if (input.kind === 'file_id') {
      const file = this.#mediaFiles.findObserverFile(authenticatedBot.id, input.fileId);
      if (file?.type === 'video') {
        return { resolved: true, file: { kind: 'stored', file } };
      }
      return { resolved: false, failure: fileIdFailure(file, 'video') };
    }
    const preparation = this.#mediaFiles.prepareVideoUpload(
      input.kind === 'upload'
        ? {
          content: input.content,
          fileName: cleanUploadedFileName(input.fileName),
          attributes,
          ...(thumbnailContent === undefined ? {} : { thumbnailContent }),
          source: 'bot_upload',
        }
        : {
          content: input.webFile.content,
          ...(input.webFile.fileName.length === 0
            ? {}
            : { fileName: cleanUploadedFileName(input.webFile.fileName) }),
          mimeType: input.webFile.mediaType,
          attributes,
          source: 'web_download',
        },
    );
    return preparation.prepared
      ? { resolved: true, file: { kind: 'upload', upload: preparation.upload } }
      : { resolved: false, failure: uploadPreparationFailure(preparation) };
  }

  /**
   * Resolves the voice note a request sends, as `#resolveVideo` resolves a video: an upload, whose
   * MIME type its file name decides, with the duration the bot specified; a voice note the bot
   * knows by `file_id`, which keeps its own; or a file downloaded from a URL, typed as it was
   * served. As for a video, how Telegram's servers determine the duration of a downloaded voice
   * note is not in the source, so the emulator keeps the one the bot specified.
   */
  #resolveVoice(
    authenticatedBot: VirtualBotProfile,
    input: BotApiInputFile,
    durationSeconds: number,
  ): FileResolution<OutgoingVoice> {
    if (input.kind === 'file_id') {
      const file = this.#mediaFiles.findObserverFile(authenticatedBot.id, input.fileId);
      if (file?.type === 'voice') {
        return { resolved: true, file: { kind: 'stored', file } };
      }
      return { resolved: false, failure: fileIdFailure(file, 'voice') };
    }
    const preparation = this.#mediaFiles.prepareVoiceUpload(
      input.kind === 'upload'
        ? {
          content: input.content,
          fileName: cleanUploadedFileName(input.fileName),
          durationSeconds,
          source: 'bot_upload',
        }
        : {
          content: input.webFile.content,
          mimeType: input.webFile.mediaType,
          durationSeconds,
          source: 'web_download',
        },
    );
    return preparation.prepared
      ? { resolved: true, file: { kind: 'upload', upload: preparation.upload } }
      : { resolved: false, failure: uploadPreparationFailure(preparation) };
  }

  /**
   * Resolves the media that `sendVoice` sends: a voice note, as `#resolveVoice` resolves it, or, as
   * the Bot API documents for a voice note sent by URL that is larger than 1 MB, a document, which
   * `#resolveDocument` resolves from the downloaded file.
   */
  #resolveVoiceMedia(
    authenticatedBot: VirtualBotProfile,
    voice: BotApiInputFile,
    durationSeconds: number,
    caption: SpecifiedCaption,
  ): FileResolution<Extract<OutgoingCaptionedMedia, { readonly kind: 'voice' | 'document' }>> {
    if (voice.kind === 'web_file' && !isWebVoiceNoteSentAsVoiceNote(voice.webFile.content.length)) {
      const resolution = this.#resolveDocument(authenticatedBot, voice, undefined);
      return resolution.resolved
        ? { resolved: true, file: { kind: 'document', document: resolution.file, ...caption } }
        : resolution;
    }
    const resolution = this.#resolveVoice(authenticatedBot, voice, durationSeconds);
    return resolution.resolved
      ? { resolved: true, file: { kind: 'voice', voice: resolution.file, ...caption } }
      : resolution;
  }

  /** Resolves the file of a video a request specifies, as `#resolveVideo` does. */
  #resolveVideoMedia(
    authenticatedBot: VirtualBotProfile,
    { video, attributes, thumbnail, caption, ...presentation }: SpecifiedVideo,
  ): FileResolution<Extract<MediaContent, { readonly kind: 'video' }>> {
    const resolution = this.#resolveVideo(authenticatedBot, video, attributes, thumbnail);
    return resolution.resolved
      ? {
        resolved: true,
        file: {
          kind: 'video',
          video: resolution.file,
          caption: caption.text,
          captionEntities: caption.entities,
          hasSpoiler: presentation.hasSpoiler,
          showsCaptionAboveMedia: presentation.showsCaptionAboveMedia,
          startTimestampSeconds: presentation.startTimestampSeconds,
        },
      }
      : resolution;
  }

  /**
   * Resolves the file of new media, as `#resolvePhoto`, `#resolveDocument` and `#resolveVideo`
   * resolve a photo, a document, and a video.
   */
  #resolveMediaReplacement(
    authenticatedBot: VirtualBotProfile,
    media: MediaReplacementRequest,
  ): FileResolution<MediaContent> {
    const caption = { caption: media.caption.text, captionEntities: media.caption.entities };
    switch (media.kind) {
      case 'photo': {
        const resolution = this.#resolvePhoto(authenticatedBot, media.photo);
        return resolution.resolved
          ? {
            resolved: true,
            file: {
              kind: 'photo',
              photo: resolution.file,
              ...caption,
              hasSpoiler: media.hasSpoiler,
              showsCaptionAboveMedia: media.showsCaptionAboveMedia,
            },
          }
          : resolution;
      }
      case 'document': {
        const resolution = this.#resolveDocument(authenticatedBot, media.document, media.thumbnail);
        return resolution.resolved
          ? { resolved: true, file: { kind: 'document', document: resolution.file, ...caption } }
          : resolution;
      }
      case 'video':
        return this.#resolveVideoMedia(authenticatedBot, media);
      default: {
        const unhandledMedia: never = media;
        throw new Error(`Unhandled media replacement: ${JSON.stringify(unhandledMedia)}`);
      }
    }
  }

  /** Resolves new content of a text or rich message: the files of a rich message. */
  #resolveTextMessageReplacement(
    authenticatedBot: VirtualBotProfile,
    content: TextMessageReplacementRequest,
  ):
    | { readonly resolved: true; readonly content: TextMessageReplacement }
    | { readonly resolved: false; readonly failure: FileResolutionFailure } {
    if (content.kind === 'text') {
      return { resolved: true, content };
    }
    const resolution = this.#resolveRichMessageFiles(authenticatedBot, content.richMessage);
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
   * Resolves the files of a rich message's photo and document blocks, in the order the message
   * shows them, as `#resolvePhoto` and `#resolveDocument` resolve the file of a photo or document.
   */
  #resolveRichMessageFiles(
    authenticatedBot: VirtualBotProfile,
    richMessage: RichMessage<BotApiRichMessageFileTypes>,
  ):
    | { readonly resolved: true; readonly richMessage: OutgoingRichMessage }
    | { readonly resolved: false; readonly failure: FileResolutionFailure } {
    const photos = new Map<BotApiInputFile, OutgoingPhoto>();
    const documents = new Map<BotApiRichMessageDocument, OutgoingDocument>();
    for (const file of listRichMessageFiles(richMessage)) {
      if (file.kind === 'photo') {
        const resolution = this.#resolvePhoto(authenticatedBot, file.file);
        if (!resolution.resolved) {
          return resolution;
        }
        photos.set(file.file, resolution.file);
      } else {
        const { document, thumbnail } = file.file;
        const resolution = this.#resolveDocument(authenticatedBot, document, thumbnail);
        if (!resolution.resolved) {
          return resolution;
        }
        documents.set(file.file, resolution.file);
      }
    }
    return {
      resolved: true,
      richMessage: convertRichMessageFiles(richMessage, {
        photo: (photo) => getResolvedFile(photos, photo),
        document: (document) => getResolvedFile(documents, document),
      }),
    };
  }

  /**
   * Shows a chat action, such as typing, in a private chat or a supergroup, which the chat's
   * accounts see until it expires, is canceled, or the bot sends a message there.
   */
  sendChatAction(
    authenticatedBot: VirtualBotProfile,
    { chatId, action }: SendChatActionRequest,
  ): SendChatActionResult {
    const recordAction = () =>
      this.#chatActions.recordBotChatAction({
        botId: authenticatedBot.id,
        chat: getChatActionChat(authenticatedBot, chatId),
        action,
      });
    if (!isUserId(chatId)) {
      const supergroupResult = this.#supergroupBotMessages.sendBotChatAction({
        fromBotId: authenticatedBot.id,
        chatId,
        action,
      });
      if (supergroupResult.sent) {
        recordAction();
        return supergroupResult;
      }
      if (supergroupResult.reason === 'bot_not_found') {
        throw new Error(`Authenticated bot ${authenticatedBot.id} does not exist`);
      }
      return { sent: false, reason: supergroupResult.reason };
    }
    const result = this.#botMessages.sendBotChatAction({
      fromBotId: authenticatedBot.id,
      to: { type: 'private', accountId: chatId },
      action,
    });
    if (result.sent) {
      recordAction();
      return result;
    }
    switch (result.reason) {
      case 'bot_blocked':
        return { sent: false, reason: result.reason };
      // As for sending, a chat the bot cannot address is not found.
      case 'account_not_found':
      case 'conversation_not_started':
        return { sent: false, reason: 'chat_not_found' };
      case 'bot_not_found':
        throw new Error(`Authenticated bot ${authenticatedBot.id} does not exist`);
      default: {
        const unhandledReason: never = result.reason;
        throw new Error(`Unhandled chat action failure: ${unhandledReason}`);
      }
    }
  }

  /**
   * Changes a supergroup's title as `SharedChatAdministrationService.changeSupergroupTitle`
   * changes it for a bot, which then receives its own service message. As TDLib's
   * `set_dialog_title` refuses, a private chat's title cannot be changed.
   */
  setChatTitle(
    authenticatedBot: VirtualBotProfile,
    { chatId, title }: SetChatTitleRequest,
  ): BotApiSetChatTitleResult {
    if (isUserId(chatId)) {
      return {
        set: false,
        reason: this.#getPrivateChatInfoChangeFailureReason(authenticatedBot, chatId),
      };
    }
    const result = this.#chatMemberships.changeSupergroupTitle({
      actor: { kind: 'bot', botId: authenticatedBot.id },
      chatId,
      title,
    });
    if (result.changed) {
      return { set: true };
    }
    switch (result.reason) {
      // The authenticated bot exists, and a bot is not refused as an account that is no member.
      case 'actor_not_found':
      case 'not_a_member':
        throw new Error(
          `Bot ${authenticatedBot.id} could not act in chat ${chatId}: ${result.reason}`,
        );
      default:
        return { set: false, reason: result.reason };
    }
  }

  /**
   * Changes a supergroup's description as
   * `SharedChatAdministrationService.changeSupergroupDescription` changes it for a bot. As TDLib's
   * `set_dialog_description` refuses, a private chat's description cannot be changed.
   */
  setChatDescription(
    authenticatedBot: VirtualBotProfile,
    { chatId, description }: SetChatDescriptionRequest,
  ): BotApiSetChatDescriptionResult {
    if (isUserId(chatId)) {
      return {
        set: false,
        reason: this.#getPrivateChatInfoChangeFailureReason(authenticatedBot, chatId),
      };
    }
    const result = this.#chatMemberships.changeSupergroupDescription({
      actor: { kind: 'bot', botId: authenticatedBot.id },
      chatId,
      description,
    });
    if (result.changed) {
      return { set: true };
    }
    switch (result.reason) {
      // The authenticated bot exists, and a bot is not refused as an account that is no member.
      case 'actor_not_found':
      case 'not_a_member':
        throw new Error(
          `Bot ${authenticatedBot.id} could not act in chat ${chatId}: ${result.reason}`,
        );
      default:
        return { set: false, reason: result.reason };
    }
  }

  /**
   * Changes what a supergroup's members may do by default, as
   * `SharedChatAdministrationService.changeDefaultPermissions` changes it for a bot. As TDLib's
   * `set_dialog_permissions` refuses, a private chat's permissions cannot be changed.
   */
  setChatPermissions(
    authenticatedBot: VirtualBotProfile,
    { chatId, permissions }: SetChatPermissionsRequest,
  ): BotApiSetChatPermissionsResult {
    if (isUserId(chatId)) {
      return {
        set: false,
        reason: this.#isPrivateChatKnown(authenticatedBot, chatId)
          ? 'private_chat_permissions_unchangeable'
          : 'chat_not_found',
      };
    }
    const result = this.#chatMemberships.changeDefaultPermissions({
      actor: { kind: 'bot', botId: authenticatedBot.id },
      chatId,
      permissions,
    });
    if (result.changed) {
      return { set: true };
    }
    switch (result.reason) {
      // The authenticated bot exists, and a bot is not refused as an account that is no member.
      case 'actor_not_found':
      case 'not_a_member':
        throw new Error(
          `Bot ${authenticatedBot.id} could not act in chat ${chatId}: ${result.reason}`,
        );
      default:
        return { set: false, reason: result.reason };
    }
  }

  /**
   * Why a bot cannot change the information of a private chat: it has none to change, or, as for
   * any method, the bot does not know the chat.
   */
  #getPrivateChatInfoChangeFailureReason(
    authenticatedBot: VirtualBotProfile,
    chatId: number,
  ): 'chat_not_found' | 'private_chat_info_unchangeable' {
    return this.#isPrivateChatKnown(authenticatedBot, chatId)
      ? 'private_chat_info_unchangeable'
      : 'chat_not_found';
  }

  /**
   * Leaves a supergroup, which the bot's own `my_chat_member` update and a service message record.
   * As on Telegram, a private chat cannot be left, and a supergroup the bot already left or was
   * removed from turns it away.
   */
  leaveChat(
    authenticatedBot: VirtualBotProfile,
    { chatId }: LeaveChatRequest,
  ): BotApiLeaveChatResult {
    if (isUserId(chatId)) {
      return {
        left: false,
        reason: this.#isPrivateChatKnown(authenticatedBot, chatId)
          ? 'private_chat_not_leavable'
          : 'chat_not_found',
      };
    }
    const result = this.#chatMemberships.leaveChat({ memberId: authenticatedBot.id, chatId });
    if (result.left) {
      return result;
    }
    switch (result.reason) {
      case 'chat_not_found':
        return { left: false, reason: 'chat_not_found' };
      case 'not_a_member':
        return { left: false, reason: getSupergroupNonMemberFailureReason(result.formerStatus) };
      case 'member_not_found':
        throw new Error(`Authenticated bot ${authenticatedBot.id} does not exist`);
      case 'owner_cannot_leave':
        throw new Error(`Bot ${authenticatedBot.id} owns chat ${chatId}`);
      default: {
        const unhandledReason: never = result.reason;
        throw new Error(`Unhandled leaveChat failure: ${unhandledReason}`);
      }
    }
  }

  /**
   * Returns a user's standing in a chat: in a private chat, either participant is a member; in a
   * supergroup, the bot must be a member, and a user of the session that never joined has `left`.
   */
  getChatMember(
    authenticatedBot: VirtualBotProfile,
    { chatId, userId }: GetChatMemberRequest,
  ): GetChatMemberResult {
    if (isUserId(chatId)) {
      if (!this.#isPrivateChatKnown(authenticatedBot, chatId)) {
        return { found: false, reason: 'chat_not_found' };
      }
      return userId === authenticatedBot.id || userId === chatId
        ? {
          found: true,
          member: this.#viewChatMember(authenticatedBot, {
            chatId,
            userId,
            status: { status: 'member' },
          }),
        }
        : { found: false, reason: 'member_not_found' };
    }
    const result = this.#chatMemberships.getChatMemberStatus({
      observerBotId: authenticatedBot.id,
      chatId,
      userId,
    });
    if (!result.found) {
      return { found: false, reason: excludeMissingBotFailure(authenticatedBot, result.reason) };
    }
    return {
      found: true,
      member: this.#viewChatMember(authenticatedBot, { chatId, userId, status: result.status }),
    };
  }

  /**
   * Sets the custom title of a supergroup administrator the bot may edit, as
   * `SharedChatAdministrationService.setCustomTitleAsBot` does. As the official Bot API server's
   * `process_set_chat_administrator_custom_title_query` refuses, a private chat has none.
   */
  setChatAdministratorCustomTitle(
    authenticatedBot: VirtualBotProfile,
    { chatId, userId, customTitle }: SetChatAdministratorCustomTitleRequest,
  ): BotApiSetChatAdministratorCustomTitleResult {
    if (isUserId(chatId)) {
      return {
        set: false,
        reason: this.#isPrivateChatKnown(authenticatedBot, chatId)
          ? 'method_unavailable_outside_groups'
          : 'chat_not_found',
      };
    }
    const result = this.#chatMemberships.setCustomTitleAsBot({
      actorBotId: authenticatedBot.id,
      chatId,
      memberId: userId,
      customTitle,
    });
    return result.set ? result : {
      set: false,
      reason: excludeMissingBotFailure(authenticatedBot, result.reason),
    };
  }

  /**
   * Returns the owner and administrators of a supergroup the bot is a member of. As on Telegram,
   * administrators that are other bots are left out unless requested; a private chat has none.
   */
  getChatAdministrators(
    authenticatedBot: VirtualBotProfile,
    { chatId, includesOtherBots }: GetChatAdministratorsRequest,
  ): BotApiGetChatAdministratorsResult {
    if (isUserId(chatId)) {
      return {
        found: false,
        reason: this.#isPrivateChatKnown(authenticatedBot, chatId)
          ? 'private_chat_has_no_administrators'
          : 'chat_not_found',
      };
    }
    const result = this.#chatMemberships.getChatAdministrators({
      observerBotId: authenticatedBot.id,
      chatId,
    });
    if (!result.found) {
      return { found: false, reason: excludeMissingBotFailure(authenticatedBot, result.reason) };
    }
    const administrators = result.administrators
      .map(({ userId, status }) =>
        this.#viewChatMember(authenticatedBot, { chatId, userId, status })
      )
      .filter(({ user }) => includesOtherBots || !user.is_bot || user.id === authenticatedBot.id);
    return { found: true, administrators };
  }

  /**
   * Returns everything a bot may learn about a chat: the private chat with an account that started
   * it, or a supergroup the bot may read, which a public one is to bots that are not members. It
   * shows the chat's newest pinned message, as the official Bot API server's `getChat` asks
   * TDLib's `getChatPinnedMessage` for it.
   */
  getChat(authenticatedBot: VirtualBotProfile, { chatId }: GetChatRequest): BotApiGetChatResult {
    let pinnedMessagesChat: PinnedMessagesChat;
    if (isUserId(chatId)) {
      if (!this.#isPrivateChatKnown(authenticatedBot, chatId)) {
        return { found: false, reason: 'chat_not_found' };
      }
      pinnedMessagesChat = {
        type: 'private',
        conversation: { accountId: chatId, botId: authenticatedBot.id },
      };
    } else {
      const result = this.#chatMemberships.getReadableSupergroup({
        observerBotId: authenticatedBot.id,
        chatId,
      });
      if (!result.found) {
        return { found: false, reason: excludeMissingBotFailure(authenticatedBot, result.reason) };
      }
      pinnedMessagesChat = { type: 'supergroup', chatId };
    }
    const chat = this.#botMessageViews.viewChatFullInfo({
      chatId,
      observerBotId: authenticatedBot.id,
      pinnedMessage: this.#messagePinning.findNewestPinnedMessage(pinnedMessagesChat),
    });
    if (chat === undefined) {
      throw new Error(`Chat ${chatId} was found but cannot be shown`);
    }
    return { found: true, chat };
  }

  /** Returns how many members a chat has: both participants of a private chat, or a supergroup's. */
  getChatMemberCount(
    authenticatedBot: VirtualBotProfile,
    { chatId }: GetChatMemberCountRequest,
  ): BotApiGetChatMemberCountResult {
    if (isUserId(chatId)) {
      return this.#isPrivateChatKnown(authenticatedBot, chatId)
        ? { found: true, memberCount: 2 }
        : { found: false, reason: 'chat_not_found' };
    }
    const result = this.#chatMemberships.getChatMemberCount({
      observerBotId: authenticatedBot.id,
      chatId,
    });
    return result.found
      ? result
      : { found: false, reason: excludeMissingBotFailure(authenticatedBot, result.reason) };
  }

  /**
   * Bans a user from a supergroup, removing it if it is a member, as an administrator with the
   * `can_restrict_members` right. A private chat has no members to ban.
   */
  banChatMember(
    authenticatedBot: VirtualBotProfile,
    { chatId, userId, untilUnixSeconds }: BanChatMemberRequest,
  ): BotApiBanChatMemberResult {
    if (isUserId(chatId)) {
      return {
        banned: false,
        reason: this.#isPrivateChatKnown(authenticatedBot, chatId)
          ? 'private_chat_members_not_bannable'
          : 'chat_not_found',
      };
    }
    const result = this.#chatMemberships.banChatMember({
      actorBotId: authenticatedBot.id,
      chatId,
      memberId: userId,
      requestedBanEndUnixSeconds: untilUnixSeconds,
    });
    if (result.banned) {
      return result;
    }
    return { banned: false, reason: excludeMissingBotFailure(authenticatedBot, result.reason) };
  }

  /**
   * Restricts what a user may do in a supergroup, or lifts its restriction, as
   * `SharedChatAdministrationService.restrictChatMember` does. As the official Bot API server's
   * `process_restrict_chat_member_query` refuses, a private chat has no members to restrict.
   */
  restrictChatMember(
    authenticatedBot: VirtualBotProfile,
    { chatId, userId, permissions, untilUnixSeconds }: RestrictChatMemberRequest,
  ): BotApiRestrictChatMemberResult {
    if (isUserId(chatId)) {
      return {
        restricted: false,
        reason: this.#isPrivateChatKnown(authenticatedBot, chatId)
          ? 'method_unavailable_outside_supergroups'
          : 'chat_not_found',
      };
    }
    const result = this.#chatMemberships.restrictChatMember({
      actorBotId: authenticatedBot.id,
      chatId,
      memberId: userId,
      permissions,
      requestedRestrictionEndUnixSeconds: untilUnixSeconds,
    });
    return result.restricted ? result : {
      restricted: false,
      reason: excludeMissingBotFailure(authenticatedBot, result.reason),
    };
  }

  /**
   * Promotes a supergroup member to administrator, changes an administrator's rights, or demotes
   * one, as `SharedChatAdministrationService.promoteChatMemberAsBot` does. As the official Bot API
   * server's `process_promote_chat_member_query` refuses, a private chat has no members to
   * promote.
   */
  promoteChatMember(
    authenticatedBot: VirtualBotProfile,
    { chatId, userId, rights }: PromoteChatMemberRequest,
  ): BotApiPromoteChatMemberResult {
    if (isUserId(chatId)) {
      return {
        promoted: false,
        reason: this.#isPrivateChatKnown(authenticatedBot, chatId)
          ? 'method_unavailable_in_private_chats'
          : 'chat_not_found',
      };
    }
    const result = this.#chatMemberships.promoteChatMemberAsBot({
      actorBotId: authenticatedBot.id,
      chatId,
      memberId: userId,
      rights,
    });
    return result.promoted ? result : {
      promoted: false,
      reason: excludeMissingBotFailure(authenticatedBot, result.reason),
    };
  }

  /**
   * Lifts a user's ban from a supergroup, so that it may join again. Unless only a ban is to be
   * lifted, this removes a member, as on Telegram.
   */
  unbanChatMember(
    authenticatedBot: VirtualBotProfile,
    { chatId, userId, onlyIfBanned }: UnbanChatMemberRequest,
  ): BotApiUnbanChatMemberResult {
    if (isUserId(chatId)) {
      return {
        unbanned: false,
        reason: this.#isPrivateChatKnown(authenticatedBot, chatId)
          ? 'method_unavailable_in_private_chats'
          : 'chat_not_found',
      };
    }
    const result = this.#chatMemberships.unbanChatMember({
      actorBotId: authenticatedBot.id,
      chatId,
      memberId: userId,
      onlyIfBanned,
    });
    return result.unbanned ? result : {
      unbanned: false,
      reason: excludeMissingBotFailure(authenticatedBot, result.reason),
    };
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
    const result = isUserId(chatId)
      ? this.#presentPrivateEdit(this.#botMessages.editBotMessageText({
        fromBotId: authenticatedBot.id,
        chat: { type: 'private', accountId: chatId },
        botMessageId: messageId,
        content: replacement.content,
        inlineKeyboard,
      }))
      : this.#presentSupergroupEdit(
        authenticatedBot,
        this.#supergroupBotMessages.editBotMessageText({
          fromBotId: authenticatedBot.id,
          chatId,
          messageId,
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
      case 'message_text_empty':
      case 'message_has_no_text':
      case 'message_text_too_long':
        return { edited: false, reason: result.reason };
      default:
        return {
          edited: false,
          reason: toEditMessageFailureReason(authenticatedBot, result.reason),
        };
    }
  }

  /**
   * Replaces the caption, its entities, and the inline keyboard of a photo, document, or video
   * the bot sent; empty caption text removes the caption.
   */
  editMessageCaption(
    authenticatedBot: VirtualBotProfile,
    { chatId, messageId, caption, showsCaptionAboveMedia, inlineKeyboard }:
      EditMessageCaptionRequest,
  ): EditMessageCaptionResult {
    const captionEdit: CaptionEdit = {
      caption: caption.text,
      captionEntities: caption.entities,
      showsCaptionAboveMedia,
      inlineKeyboard,
    };
    const result = isUserId(chatId)
      ? this.#presentPrivateEdit(this.#botMessages.editBotMessageCaption({
        ...captionEdit,
        fromBotId: authenticatedBot.id,
        chat: { type: 'private', accountId: chatId },
        botMessageId: messageId,
      }))
      : this.#presentSupergroupEdit(
        authenticatedBot,
        this.#supergroupBotMessages.editBotMessageCaption({
          ...captionEdit,
          fromBotId: authenticatedBot.id,
          chatId,
          messageId,
        }),
      );
    if (result.edited) {
      return result;
    }

    switch (result.reason) {
      case 'text_invalid':
        return result;
      case 'message_has_no_caption':
      case 'caption_too_long':
        return { edited: false, reason: result.reason };
      default:
        return {
          edited: false,
          reason: toEditMessageFailureReason(authenticatedBot, result.reason),
        };
    }
  }

  /**
   * Replaces the content, caption and inline keyboard of a message the bot sent with a new photo,
   * document, or video, as TDLib's `edit_message_media` does; a photo, document, or video message
   * changes its media, and a text or rich message becomes media. As for `sendPhoto`, the file is
   * resolved before the message is found.
   */
  editMessageMedia(
    authenticatedBot: VirtualBotProfile,
    { chatId, messageId, media, inlineKeyboard }: EditMessageMediaRequest,
  ): EditMessageMediaResult {
    const mediaResolution = this.#resolveMediaReplacement(authenticatedBot, media);
    if (!mediaResolution.resolved) {
      return { edited: false, ...mediaResolution.failure };
    }
    const result = isUserId(chatId)
      ? this.#presentPrivateEdit(this.#botMessages.editBotMessageMedia({
        fromBotId: authenticatedBot.id,
        chat: { type: 'private', accountId: chatId },
        botMessageId: messageId,
        media: mediaResolution.file,
        inlineKeyboard,
      }))
      : this.#presentSupergroupEdit(
        authenticatedBot,
        this.#supergroupBotMessages.editBotMessageMedia({
          fromBotId: authenticatedBot.id,
          chatId,
          messageId,
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
      case 'message_media_not_editable':
      case 'caption_too_long':
      case 'album_media_kind_changed':
        return { edited: false, reason: result.reason };
      default:
        return {
          edited: false,
          reason: toEditMessageFailureReason(authenticatedBot, result.reason),
        };
    }
  }

  /** Replaces the inline keyboard of a message the bot sent. */
  editMessageReplyMarkup(
    authenticatedBot: VirtualBotProfile,
    { chatId, messageId, inlineKeyboard }: EditMessageReplyMarkupRequest,
  ): EditMessageResult<EditMessageReplyMarkupFailureReason> {
    const result = isUserId(chatId)
      ? this.#presentPrivateEdit(this.#botMessages.editBotMessageInlineKeyboard({
        fromBotId: authenticatedBot.id,
        chat: { type: 'private', accountId: chatId },
        botMessageId: messageId,
        inlineKeyboard,
      }))
      : this.#presentSupergroupEdit(
        authenticatedBot,
        this.#supergroupBotMessages.editBotMessageInlineKeyboard({
          fromBotId: authenticatedBot.id,
          chatId,
          messageId,
          inlineKeyboard,
        }),
      );
    if (result.edited) {
      return result;
    }
    return { edited: false, reason: toEditMessageFailureReason(authenticatedBot, result.reason) };
  }

  /**
   * Stops a poll the bot sent, as the official Bot API server's `process_stop_poll_query` and
   * TDLib's `stop_poll` do, and answers with the closed poll. The message is found as an edit finds
   * it, then the poll as the messaging services find it; stopping a closed poll fails. The message
   * shows the new keyboard, or none; no bot receives an `edited_message` update for it.
   */
  stopPoll(
    authenticatedBot: VirtualBotProfile,
    { chatId, messageId, inlineKeyboard }: StopPollRequest,
  ): StopPollResult {
    const result = isUserId(chatId)
      ? this.#botMessages.stopBotPoll({
        fromBotId: authenticatedBot.id,
        chat: { type: 'private', accountId: chatId },
        botMessageId: messageId,
        inlineKeyboard,
      })
      : this.#supergroupBotMessages.stopBotPoll({
        fromBotId: authenticatedBot.id,
        chatId,
        messageId,
        inlineKeyboard,
      });
    if (result.stopped) {
      return { stopped: true, poll: this.#botMessageViews.viewPollForBot(result.poll) };
    }
    switch (result.reason) {
      case 'chat_not_found':
      case 'bot_not_a_member':
      case 'bot_kicked':
      case 'message_not_found':
      case 'message_has_no_poll':
      case 'poll_not_stoppable':
      case 'poll_already_closed':
      case 'callback_data_invalid':
      case 'button_type_invalid':
        return { stopped: false, reason: result.reason };
      // As for sending, a chat the bot cannot address is not found.
      case 'account_not_found':
      case 'conversation_not_started':
        return { stopped: false, reason: 'chat_not_found' };
      case 'bot_not_found':
        throw new Error(`Authenticated bot ${authenticatedBot.id} does not exist`);
      default: {
        const unhandledReason: never = result;
        throw new Error(`Unhandled poll stop failure: ${JSON.stringify(unhandledReason)}`);
      }
    }
  }

  /**
   * Pins a message of a bot's chat, as `MessagePinningService.pinMessage` pins it for the bot,
   * which then receives the pin's service message, as the official server's
   * `need_skip_update_message` keeps a bot's own pins.
   */
  pinChatMessage(
    authenticatedBot: VirtualBotProfile,
    { chatId, messageId, isSilent }: PinChatMessageRequest,
  ): BotApiPinChatMessageResult {
    const result = this.#messagePinning.pinMessage({
      pinner: { kind: 'bot', botId: authenticatedBot.id },
      chat: toPinningChat(chatId),
      messageId,
      isSilent,
    });
    return result.pinned
      ? { pinned: true }
      : { pinned: false, reason: excludeAccountPinChangeFailure(authenticatedBot, result.reason) };
  }

  /**
   * Unpins a message of a bot's chat, or, without one, the chat's newest pinned message, as
   * `MessagePinningService.unpinMessage` unpins it for the bot. No service message records it.
   */
  unpinChatMessage(
    authenticatedBot: VirtualBotProfile,
    { chatId, messageId }: UnpinChatMessageRequest,
  ): BotApiUnpinChatMessageResult {
    const result = this.#messagePinning.unpinMessage({
      pinner: { kind: 'bot', botId: authenticatedBot.id },
      chat: toPinningChat(chatId),
      messageId,
    });
    return result.unpinned ? { unpinned: true } : {
      unpinned: false,
      reason: excludeAccountPinChangeFailure(authenticatedBot, result.reason),
    };
  }

  /**
   * Deletes a message of a chat: in a private chat, a message of either participant; in a
   * supergroup, one of the bot's own messages. Unlike `deleteMessages`, it fails when the ID
   * identifies no message of the chat, as on Telegram.
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
   * Answers a callback query that an account created by pressing one of the bot's buttons,
   * optionally with a link that starts the bot, which the account's client opens.
   */
  answerCallbackQuery(
    authenticatedBot: VirtualBotProfile,
    { callbackQueryId, text, showAlert, cacheTimeSeconds, url }: AnswerCallbackQueryRequest,
  ): AnswerCallbackQueryResult {
    const result = this.#callbackQueries.answerCallbackQuery({
      fromBotId: authenticatedBot.id,
      callbackQueryId,
      text,
      showAlert,
      cacheTimeSeconds,
      url,
    });
    if (result.answered) {
      return { answered: true };
    }
    return {
      answered: false,
      reason: result.reason === 'url_invalid' ? 'url_invalid' : 'query_id_invalid',
    };
  }

  /**
   * Answers an inline query that an account sent to the bot, with results whose files the bot
   * knows by `file_id`.
   *
   * Every result's file is resolved before the other checks, while TDLib checks the button and
   * the number of results first and resolves each result's file after its message content.
   */
  answerInlineQuery(
    authenticatedBot: VirtualBotProfile,
    { inlineQueryId, results, cacheTimeSeconds, isPersonal, nextOffset, button }:
      AnswerInlineQueryRequest,
  ): BotApiAnswerInlineQueryResult {
    const specifiedResults: SpecifiedInlineQueryResult[] = [];
    for (const result of results) {
      const resolution = this.#resolveInlineQueryResult(authenticatedBot, result);
      if (!resolution.resolved) {
        return { answered: false, ...resolution.failure };
      }
      specifiedResults.push(resolution.result);
    }
    const answering = this.#inlineQueries.answerInlineQuery({
      fromBotId: authenticatedBot.id,
      inlineQueryId,
      results: specifiedResults,
      cacheTimeSeconds,
      isPersonal,
      nextOffset,
      button,
    });
    return answering.answered ? { answered: true } : answering;
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
    const message = this.#findOwnInlineMessage(authenticatedBot, inlineMessageId);
    if (message === undefined) {
      return { edited: false, reason: 'inline_message_not_found' };
    }
    if (
      content.kind === 'rich_message' &&
      listRichMessageFiles(content.richMessage).some((file) =>
        (file.kind === 'photo' ? file.file : file.file.document).kind === 'upload'
      )
    ) {
      return { edited: false, reason: 'inline_message_upload_unsupported' };
    }
    const replacement = this.#resolveTextMessageReplacement(authenticatedBot, content);
    if (!replacement.resolved) {
      return { edited: false, ...replacement.failure };
    }
    const edit = {
      fromBotId: authenticatedBot.id,
      inlineMessageId,
      content: replacement.content,
      inlineKeyboard,
    };
    const result = message.kind === 'private_message'
      ? this.#botMessages.editBotMessageText(edit)
      : this.#supergroupBotMessages.editBotMessageText(edit);
    if (result.edited) {
      return { edited: true };
    }
    switch (result.reason) {
      case 'text_invalid':
        return result;
      // TDLib checks no permission for a message addressed by its inline message identifier.
      case 'send_permission_missing':
        throw new Error(`Inline message ${inlineMessageId} was refused for a permission`);
      case 'message_text_empty':
      case 'message_has_no_text':
      case 'message_text_too_long':
        return { edited: false, reason: result.reason };
      default:
        return {
          edited: false,
          reason: toEditInlineMessageFailureReason(authenticatedBot, result.reason),
        };
    }
  }

  /**
   * Replaces the caption, its entities, and the inline keyboard of a photo, document, or video
   * sent through the bot; empty caption text removes the caption.
   */
  editInlineMessageCaption(
    authenticatedBot: VirtualBotProfile,
    { inlineMessageId, caption, showsCaptionAboveMedia, inlineKeyboard }:
      EditInlineMessageCaptionRequest,
  ): EditInlineMessageResult<EditInlineMessageCaptionFailureReason> {
    const message = this.#findOwnInlineMessage(authenticatedBot, inlineMessageId);
    if (message === undefined) {
      return { edited: false, reason: 'inline_message_not_found' };
    }
    const edit = {
      fromBotId: authenticatedBot.id,
      inlineMessageId,
      caption: caption.text,
      captionEntities: caption.entities,
      showsCaptionAboveMedia,
      inlineKeyboard,
    };
    const result = message.kind === 'private_message'
      ? this.#botMessages.editBotMessageCaption(edit)
      : this.#supergroupBotMessages.editBotMessageCaption(edit);
    if (result.edited) {
      return { edited: true };
    }
    switch (result.reason) {
      case 'text_invalid':
        return result;
      case 'message_has_no_caption':
      case 'caption_too_long':
        return { edited: false, reason: result.reason };
      default:
        return {
          edited: false,
          reason: toEditInlineMessageFailureReason(authenticatedBot, result.reason),
        };
    }
  }

  /**
   * Replaces the content, caption and inline keyboard of a message sent through the bot with a
   * new photo, document, or video, as `editMessageMedia` replaces them. As TDLib's
   * `edit_inline_message_media` requires, the media may reuse a file by its `file_id` or name one
   * by URL but not upload one.
   */
  editInlineMessageMedia(
    authenticatedBot: VirtualBotProfile,
    { inlineMessageId, media, inlineKeyboard }: EditInlineMessageMediaRequest,
  ): EditInlineMessageMediaResult {
    const message = this.#findOwnInlineMessage(authenticatedBot, inlineMessageId);
    if (message === undefined) {
      return { edited: false, reason: 'inline_message_not_found' };
    }
    if (getMediaReplacementFile(media).kind === 'upload') {
      return { edited: false, reason: 'inline_message_upload_unsupported' };
    }
    const mediaResolution = this.#resolveMediaReplacement(authenticatedBot, media);
    if (!mediaResolution.resolved) {
      return { edited: false, ...mediaResolution.failure };
    }
    const edit = {
      fromBotId: authenticatedBot.id,
      inlineMessageId,
      media: mediaResolution.file,
      inlineKeyboard,
    };
    const result = message.kind === 'private_message'
      ? this.#botMessages.editBotMessageMedia(edit)
      : this.#supergroupBotMessages.editBotMessageMedia(edit);
    if (result.edited) {
      return { edited: true };
    }
    switch (result.reason) {
      case 'text_invalid':
        return result;
      // TDLib checks no permission for a message addressed by its inline message identifier.
      case 'send_permission_missing':
        throw new Error(`Inline message ${inlineMessageId} was refused for a permission`);
      case 'caption_too_long':
        return { edited: false, reason: result.reason };
      case 'album_media_kind_changed':
        throw new Error(`Inline message ${inlineMessageId} belongs to an album`);
      case 'message_media_not_editable':
        throw new Error(`Inline message ${inlineMessageId} is a voice note or shows a poll`);
      default:
        return {
          edited: false,
          reason: toEditInlineMessageFailureReason(authenticatedBot, result.reason),
        };
    }
  }

  /** Replaces the inline keyboard of a message sent through the bot. */
  editInlineMessageReplyMarkup(
    authenticatedBot: VirtualBotProfile,
    { inlineMessageId, inlineKeyboard }: EditInlineMessageReplyMarkupRequest,
  ): EditInlineMessageResult<EditInlineMessageReplyMarkupFailureReason> {
    const message = this.#findOwnInlineMessage(authenticatedBot, inlineMessageId);
    if (message === undefined) {
      return { edited: false, reason: 'inline_message_not_found' };
    }
    const edit = { fromBotId: authenticatedBot.id, inlineMessageId, inlineKeyboard };
    const result = message.kind === 'private_message'
      ? this.#botMessages.editBotMessageInlineKeyboard(edit)
      : this.#supergroupBotMessages.editBotMessageInlineKeyboard(edit);
    return result.edited ? { edited: true } : {
      edited: false,
      reason: toEditInlineMessageFailureReason(authenticatedBot, result.reason),
    };
  }

  /** Replaces the bot's command list for a scope and language; an empty list deletes it. */
  setMyCommands(
    authenticatedBot: VirtualBotProfile,
    { commands, scope, languageCode }: SetMyCommandsRequest,
  ): SetMyCommandsResult {
    const result = this.#botCommands.setBotCommands({
      botId: authenticatedBot.id,
      scope,
      languageCode,
      commands,
    });
    if (result.set) {
      return result;
    }
    if (result.reason === 'bot_not_found') {
      throw new Error(`Authenticated bot ${authenticatedBot.id} does not exist`);
    }
    return { set: false, reason: result.reason };
  }

  /** Returns the bot's command list for exactly this scope and language. */
  getMyCommands(
    authenticatedBot: VirtualBotProfile,
    { scope, languageCode }: MyCommandsTarget,
  ): GetMyCommandsResult {
    const result = this.#botCommands.getBotCommands({
      botId: authenticatedBot.id,
      scope,
      languageCode,
    });
    if (!result.found) {
      if (result.reason === 'bot_not_found') {
        throw new Error(`Authenticated bot ${authenticatedBot.id} does not exist`);
      }
      return { found: false, reason: result.reason };
    }
    return { found: true, commands: result.commands.map(projectBotCommand) };
  }

  /** Deletes the bot's command list for a scope and language. */
  deleteMyCommands(
    authenticatedBot: VirtualBotProfile,
    { scope, languageCode }: MyCommandsTarget,
  ): DeleteMyCommandsResult {
    const result = this.#botCommands.deleteBotCommands({
      botId: authenticatedBot.id,
      scope,
      languageCode,
    });
    if (result.deleted) {
      return result;
    }
    if (result.reason === 'bot_not_found') {
      throw new Error(`Authenticated bot ${authenticatedBot.id} does not exist`);
    }
    return { deleted: false, reason: result.reason };
  }

  /** Replaces the bot's description or short description for a language; empty removes it. */
  setMyDescription(
    authenticatedBot: VirtualBotProfile,
    request: SetMyDescriptionRequest,
  ): SetMyDescriptionResult {
    const result = this.#botDescriptions.setBotDescription({
      botId: authenticatedBot.id,
      ...request,
    });
    if (result.set) {
      return result;
    }
    if (result.reason === 'bot_not_found') {
      throw new Error(`Authenticated bot ${authenticatedBot.id} does not exist`);
    }
    return { set: false, reason: result.reason };
  }

  /** Returns the bot's description or short description for exactly this language. */
  getMyDescription(
    authenticatedBot: VirtualBotProfile,
    target: MyDescriptionTarget,
  ): GetMyDescriptionResult {
    const result = this.#botDescriptions.getBotDescription({
      botId: authenticatedBot.id,
      ...target,
    });
    if (result.found) {
      return result;
    }
    if (result.reason === 'bot_not_found') {
      throw new Error(`Authenticated bot ${authenticatedBot.id} does not exist`);
    }
    return { found: false, reason: result.reason };
  }

  /**
   * Replaces the rights the bot asks for by default as an administrator of groups or channels;
   * none removes them.
   */
  setMyDefaultAdministratorRights(
    authenticatedBot: VirtualBotProfile,
    request: {
      readonly kind: DefaultAdministratorRightsChatKind;
      readonly requestedRights: Iterable<ChatAdministratorRightName>;
    },
  ): void {
    const result = this.#defaultAdministratorRights.setDefaultAdministratorRights({
      botId: authenticatedBot.id,
      ...request,
    });
    if (!result.set) {
      throw new Error(`Authenticated bot ${authenticatedBot.id} does not exist`);
    }
  }

  /**
   * Returns the rights the bot asks for by default as an administrator of groups or channels,
   * showing each right that applies to that kind of chat.
   */
  getMyDefaultAdministratorRights(
    authenticatedBot: VirtualBotProfile,
    kind: DefaultAdministratorRightsChatKind,
  ): BotApiDefaultAdministratorRights {
    const result = this.#defaultAdministratorRights.getDefaultAdministratorRights({
      botId: authenticatedBot.id,
      kind,
    });
    if (!result.found) {
      throw new Error(`Authenticated bot ${authenticatedBot.id} does not exist`);
    }
    return getApplicableAdministratorRightFlags(kind, result.rights);
  }

  /**
   * Replaces the bot's menu button for all its private chats, or for its chat with a user when
   * `userId` is given; the default button removes the choice.
   */
  setChatMenuButton(
    authenticatedBot: VirtualBotProfile,
    request: { readonly userId?: number; readonly menuButton: BotMenuButton },
  ): SetChatMenuButtonResult {
    const result = this.#menuButtons.setBotMenuButton({ botId: authenticatedBot.id, ...request });
    if (result.set || result.reason === 'web_app_url_invalid') {
      return result;
    }
    if (result.reason === 'bot_not_found') {
      throw new Error(`Authenticated bot ${authenticatedBot.id} does not exist`);
    }
    return { set: false, reason: result.reason };
  }

  /**
   * Returns the bot's menu button for all its private chats, or the one its chat with a user
   * shows when `userId` is given.
   */
  getChatMenuButton(
    authenticatedBot: VirtualBotProfile,
    userId: number | undefined,
  ): GetChatMenuButtonResult {
    const result = this.#menuButtons.getBotMenuButton({ botId: authenticatedBot.id, userId });
    if (result.found) {
      return { found: true, menuButton: toBotApiMenuButton(result.menuButton) };
    }
    if (result.reason === 'bot_not_found') {
      throw new Error(`Authenticated bot ${authenticatedBot.id} does not exist`);
    }
    return { found: false, reason: result.reason };
  }

  /**
   * Resolves the files of an inline query result as TDLib's `answer_inline_query` does: its photo
   * or document, and the files of a rich message it sends, which must reuse files by `file_id`
   * because an inline message cannot receive an upload.
   */
  #resolveInlineQueryResult(
    authenticatedBot: VirtualBotProfile,
    result: InlineQueryResultRequest,
  ):
    | { readonly resolved: true; readonly result: SpecifiedInlineQueryResult }
    | {
      readonly resolved: false;
      readonly failure:
        | { readonly reason: 'file_id_invalid' | 'inline_message_content_invalid' }
        | FileTypeMismatchFailure;
    } {
    const shared = {
      id: result.id,
      description: result.description,
      ...(result.inlineKeyboard === undefined ? {} : { inlineKeyboard: result.inlineKeyboard }),
    };
    const contentResolution = result.messageContent === undefined
      ? undefined
      : this.#resolveInlineResultMessageContent(authenticatedBot, result.messageContent);
    if (contentResolution?.resolved === false) {
      return contentResolution;
    }
    const messageContent = contentResolution?.content;
    switch (result.kind) {
      case 'article':
        if (messageContent === undefined) {
          throw new Error('Expected an article result to send its input message content');
        }
        return {
          resolved: true,
          result: {
            ...shared,
            kind: 'article',
            title: result.title,
            url: result.url,
            messageContent,
          },
        };
      case 'photo': {
        const file = this.#mediaFiles.findObserverFile(authenticatedBot.id, result.photoFileId);
        if (file?.type !== 'photo') {
          return { resolved: false, failure: fileIdFailure(file, 'photo') };
        }
        return {
          resolved: true,
          result: {
            ...shared,
            kind: 'photo',
            photo: file,
            title: result.title,
            messageContent: messageContent ?? {
              kind: 'photo',
              photo: { kind: 'stored', file },
              caption: result.caption.text,
              captionEntities: result.caption.entities,
              hasSpoiler: false,
              showsCaptionAboveMedia: result.showsCaptionAboveMedia,
            },
          },
        };
      }
      case 'document': {
        const file = this.#mediaFiles.findObserverFile(authenticatedBot.id, result.documentFileId);
        if (file?.type !== 'document') {
          return { resolved: false, failure: fileIdFailure(file, 'document') };
        }
        return {
          resolved: true,
          result: {
            ...shared,
            kind: 'document',
            document: file,
            title: result.title,
            messageContent: messageContent ?? {
              kind: 'document',
              document: { kind: 'stored', file },
              caption: result.caption.text,
              captionEntities: result.caption.entities,
            },
          },
        };
      }
      default: {
        const unhandledResult: never = result;
        throw new Error(`Unhandled inline query result: ${JSON.stringify(unhandledResult)}`);
      }
    }
  }

  /**
   * Resolves what a result's `input_message_content` sends: its text, or a rich message, whose
   * files must be reused by `file_id`, as TDLib's `get_input_rich_message` requires of an inline
   * message.
   */
  #resolveInlineResultMessageContent(
    authenticatedBot: VirtualBotProfile,
    content: InlineResultMessageContentRequest,
  ):
    | { readonly resolved: true; readonly content: OutgoingContentOtherThanPoll }
    | {
      readonly resolved: false;
      readonly failure:
        | { readonly reason: 'file_id_invalid' | 'inline_message_content_invalid' }
        | FileTypeMismatchFailure;
    } {
    if (content.kind === 'text') {
      return {
        resolved: true,
        content: { kind: 'text', text: content.text.text, entities: content.text.entities },
      };
    }
    if (
      listRichMessageFiles(content.richMessage).some((file) =>
        (file.kind === 'photo' ? file.file : file.file.document).kind === 'upload'
      )
    ) {
      return { resolved: false, failure: { reason: 'inline_message_content_invalid' } };
    }
    const resolution = this.#resolveRichMessageFiles(authenticatedBot, content.richMessage);
    if (resolution.resolved) {
      return {
        resolved: true,
        content: {
          kind: 'rich_message',
          richMessage: resolution.richMessage,
          detectsEntities: content.detectsEntities,
        },
      };
    }
    const { failure } = resolution;
    switch (failure.reason) {
      case 'file_id_invalid':
        return { resolved: false, failure: { reason: failure.reason } };
      case 'file_type_mismatch':
        return { resolved: false, failure };
      default:
        throw new Error(`Expected only reused files, which failed with ${failure.reason}`);
    }
  }

  /**
   * Finds a message sent through the bot's inline mode, whose chat decides which messaging service
   * edits it. Another bot's inline message is not found.
   */
  #findOwnInlineMessage(
    authenticatedBot: VirtualBotProfile,
    inlineMessageId: InlineMessageId,
  ): ChatMessage | undefined {
    const message = this.#inlineMessages.getMessageByInlineMessageId(inlineMessageId);
    return message?.viaBot?.botId === authenticatedBot.id ? message : undefined;
  }

  #deleteChatMessages(
    authenticatedBot: VirtualBotProfile,
    chatId: number,
    messageIds: readonly number[],
  ):
    | { readonly deleted: true; readonly deletedMessageCount: number }
    | {
      readonly deleted: false;
      readonly reason:
        | 'chat_not_found'
        | FormerSupergroupMemberFailureReason
        | 'message_not_deletable';
    } {
    const result = isUserId(chatId)
      ? this.#botMessages.deleteMessagesByBot({
        fromBotId: authenticatedBot.id,
        chat: { type: 'private', accountId: chatId },
        botMessageIds: messageIds,
      })
      : this.#supergroupBotMessages.deleteMessagesByBot({
        fromBotId: authenticatedBot.id,
        chatId,
        messageIds,
      });
    if (result.deleted) {
      return result;
    }

    switch (result.reason) {
      case 'chat_not_found':
      case 'bot_not_a_member':
      case 'bot_kicked':
      case 'message_not_deletable':
        return { deleted: false, reason: result.reason };
      // As for sending, a chat the bot cannot address is not found.
      case 'account_not_found':
      case 'conversation_not_started':
        return { deleted: false, reason: 'chat_not_found' };
      case 'bot_not_found':
        throw new Error(`Authenticated bot ${authenticatedBot.id} does not exist`);
      default: {
        const unhandledFailure: never = result;
        throw new Error(
          `Unhandled bot message deletion failure: ${JSON.stringify(unhandledFailure)}`,
        );
      }
    }
  }

  /** A bot knows a private chat once its account has written to it. */
  #isPrivateChatKnown(authenticatedBot: VirtualBotProfile, accountId: number): boolean {
    return this.#botMessages.isPrivateConversationStarted({
      accountId,
      botId: authenticatedBot.id,
    });
  }

  /**
   * Shows a user of the session, which the caller found, in its standing in a chat, as the
   * authenticated bot observes it.
   */
  #viewChatMember(
    authenticatedBot: VirtualBotProfile,
    { chatId, userId, status }: {
      readonly chatId: number;
      readonly userId: number;
      readonly status: ChatMemberStatus;
    },
  ): BotApiChatMember {
    const member = this.#botMessageViews.viewChatMember({
      chatId,
      userId,
      status,
      observerBotId: authenticatedBot.id,
    });
    if (member === undefined) {
      throw new Error(`Chat member ${userId} does not exist`);
    }
    return member;
  }

  #presentPrivateEdit<Failure extends { readonly edited: false }>(
    result: { readonly edited: true; readonly message: PrivateMessage } | Failure,
  ): { readonly edited: true; readonly message: BotApiMessage } | Failure {
    return result.edited
      ? {
        edited: true,
        message: this.#botMessageViews.viewPrivateMessageForBot(result.message),
      }
      : result;
  }

  #presentSupergroupEdit<Failure extends { readonly edited: false }>(
    authenticatedBot: VirtualBotProfile,
    result: { readonly edited: true; readonly message: SupergroupMessage } | Failure,
  ): { readonly edited: true; readonly message: BotApiMessage } | Failure {
    return result.edited
      ? {
        edited: true,
        message: this.#botMessageViews.viewSupergroupMessage(result.message, authenticatedBot.id),
      }
      : result;
  }
}

/** A file a send method resolved to send, or why it cannot be sent. */
/** Why a file a request sends cannot be used: an upload Telegram refuses, or an unusable `file_id`. */
export type FileResolutionFailure =
  | { readonly reason: 'file_empty' | 'image_invalid' | 'photo_dimensions_invalid' }
  | PhotoTooBigFailure
  | BotUploadTooBigFailure
  | { readonly reason: 'file_id_invalid' }
  | FileTypeMismatchFailure;

type FileResolution<File> =
  | { readonly resolved: true; readonly file: File }
  | { readonly resolved: false; readonly failure: FileResolutionFailure };

/** Why Telegram refuses an uploaded file, as its preparation reports it. */
function uploadPreparationFailure(
  preparation: Extract<
    | PhotoUploadPreparation
    | DocumentUploadPreparation
    | VideoUploadPreparation
    | VoiceUploadPreparation,
    { readonly prepared: false }
  >,
): FileResolutionFailure {
  switch (preparation.reason) {
    case 'photo_too_big':
      return { reason: preparation.reason, fileSizeBytes: preparation.fileSizeBytes };
    case 'bot_upload_too_big': {
      const { reason, uploadProfile, fileSizeBytes, maxFileSizeBytes } = preparation;
      return { reason, uploadProfile, fileSizeBytes, maxFileSizeBytes };
    }
    default:
      return { reason: preparation.reason };
  }
}

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
    default: {
      const unhandledMedia: never = media;
      throw new Error(`Unhandled media replacement: ${JSON.stringify(unhandledMedia)}`);
    }
  }
}

/** Looks up what a file of a request resolved to, which must have been resolved before. */
function getResolvedFile<RequestedFile, ResolvedFile>(
  resolvedFiles: ReadonlyMap<RequestedFile, ResolvedFile>,
  requestedFile: RequestedFile,
): ResolvedFile {
  const resolvedFile = resolvedFiles.get(requestedFile);
  if (resolvedFile === undefined) {
    throw new Error('Expected every file of the rich message to be resolved');
  }
  return resolvedFile;
}

/**
 * Why a `file_id` cannot send a file of the expected type. As on Telegram, an unknown `file_id`,
 * including one another bot knows a file by, identifies no file.
 */
function fileIdFailure(
  file: StoredFile | undefined,
  expectedFileType: StoredFile['type'],
): { readonly reason: 'file_id_invalid' } | FileTypeMismatchFailure {
  return file === undefined
    ? { reason: 'file_id_invalid' }
    : { reason: 'file_type_mismatch', expectedFileType, actualFileType: file.type };
}

/** The chat a Bot API `chat_id` addresses, as chat actions identify it. */
function getChatActionChat(authenticatedBot: VirtualBotProfile, chatId: number): ChatActionChat {
  return isUserId(chatId)
    ? { type: 'private', accountId: chatId, botId: authenticatedBot.id }
    : { type: 'supergroup', chatId };
}

/** Shows a command as the Bot API does, with `is_ephemeral` only when set. */
function projectBotCommand({ command, description, isEphemeral }: BotCommand): BotApiBotCommand {
  return { command, description, ...(isEphemeral ? { is_ephemeral: true as const } : {}) };
}

/**
 * Narrows why a member query or moderation of the authenticated bot failed to the reasons it can
 * meet: the authenticated bot itself always exists.
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
 * The chat a bot pins in, by the Bot API `chat_id`: a user's ID names the bot's private chat with
 * that user, and any other ID a supergroup.
 */
function toPinningChat(chatId: number): PinningChat {
  return isUserId(chatId) ? { type: 'private', peerId: chatId } : { type: 'supergroup', chatId };
}

/**
 * Leaves out the pin failures that only an account meets, which an authenticated bot never does:
 * it exists, and a supergroup refuses it as a former member, not as a non-member account.
 */
function excludeAccountPinChangeFailure<Reason extends string>(
  authenticatedBot: VirtualBotProfile,
  reason: Reason | 'pinner_not_found' | 'not_a_member',
): Reason {
  if (reason === 'pinner_not_found' || reason === 'not_a_member') {
    throw new Error(`Bot ${authenticatedBot.id} could not pin: ${reason}`);
  }
  return reason;
}

/** Translates the edit failures shared by both edit methods into Bot API failures. */
function toEditMessageFailureReason(
  authenticatedBot: VirtualBotProfile,
  reason: BotMessageEditFailureReason | SupergroupBotMessageEditFailureReason,
): EditMessageReplyMarkupFailureReason {
  switch (reason) {
    case 'chat_not_found':
    case 'bot_not_a_member':
    case 'bot_kicked':
    case 'message_not_found':
    case 'message_not_editable':
    case 'callback_data_invalid':
    case 'button_type_invalid':
    case 'message_not_modified':
      return reason;
    // As for sending, a chat the bot cannot address is not found.
    case 'account_not_found':
    case 'conversation_not_started':
      return 'chat_not_found';
    case 'bot_not_found':
      throw new Error(`Authenticated bot ${authenticatedBot.id} does not exist`);
    default: {
      const unhandledReason: never = reason;
      throw new Error(`Unhandled bot message edit failure: ${unhandledReason}`);
    }
  }
}

/**
 * Translates the failures shared by the edit methods for an inline message into Bot API failures.
 * The messaging services check an inline message only by its identifier, so failures about its
 * chat cannot occur.
 */
function toEditInlineMessageFailureReason(
  authenticatedBot: VirtualBotProfile,
  reason: BotMessageEditFailureReason | SupergroupBotMessageEditFailureReason,
): EditInlineMessageReplyMarkupFailureReason {
  switch (reason) {
    case 'callback_data_invalid':
    case 'button_type_invalid':
    case 'message_not_modified':
      return reason;
    case 'message_not_found':
      return 'inline_message_not_found';
    case 'bot_not_found':
      throw new Error(`Authenticated bot ${authenticatedBot.id} does not exist`);
    case 'account_not_found':
    case 'conversation_not_started':
    case 'chat_not_found':
    case 'bot_not_a_member':
    case 'bot_kicked':
    case 'message_not_editable':
      throw new Error(`Inline message edit failed for its chat: ${reason}`);
    default: {
      const unhandledReason: never = reason;
      throw new Error(`Unhandled inline message edit failure: ${unhandledReason}`);
    }
  }
}

/**
 * Captioned media without its caption, as a copy that removes captions sends it; text and rich
 * messages are kept.
 */
function withoutCaption(content: MessageContent): MessageContent {
  return isCaptionedMediaContent(content)
    ? { ...content, caption: { text: '', entities: [] } }
    : content;
}
