import type { BotApiPoll, BotApiPollAnswer } from './bot_api_poll.ts';
import type { BotApiRichMessage } from './bot_api_rich_message.ts';
import type { ChatAdministratorRightName } from './bot_default_administrator_rights.ts';
import type { ButtonStyle } from './button_appearance.ts';
import type { SupergroupAdministratorRight } from './chat_membership.ts';
import type { Contact } from './contact.ts';
import type { GeoLocation } from './geo_location.ts';
import type { VirtualAccountProfile } from './virtual_account.ts';
import type { PlainTextEntityType } from './virtual_message.ts';

export interface BotApiPrivateChat {
  readonly id: number;
  readonly type: 'private';
  readonly first_name: string;
  readonly last_name?: string;
  readonly username?: string;
}

/** A basic group, which the Bot API calls a group. */
export interface BotApiBasicGroupChat {
  readonly id: number;
  readonly title: string;
  readonly type: 'group';
}

export interface BotApiSupergroupChat {
  readonly id: number;
  readonly title: string;
  /** Present only for a public supergroup. */
  readonly username?: string;
  readonly type: 'supergroup';
}

/** A chat of several members that a bot can join. */
export type BotApiGroupChat = BotApiBasicGroupChat | BotApiSupergroupChat;

/** Which kinds of gifts a user or chat accepts, as `getChat` shows them. */
export interface BotApiAcceptedGiftTypes {
  readonly unlimited_gifts: boolean;
  readonly limited_gifts: boolean;
  readonly unique_gifts: boolean;
  readonly premium_subscription: boolean;
  readonly gifts_from_channels: boolean;
}

/**
 * What members of a group may do by default, or the permissions a member's restriction leaves it,
 * which the group's default permissions narrow further.
 */
export interface BotApiChatPermissions {
  readonly can_send_messages: boolean;
  readonly can_send_media_messages: boolean;
  readonly can_send_audios: boolean;
  readonly can_send_documents: boolean;
  readonly can_send_photos: boolean;
  readonly can_send_videos: boolean;
  readonly can_send_video_notes: boolean;
  readonly can_send_voice_notes: boolean;
  readonly can_send_polls: boolean;
  readonly can_send_other_messages: boolean;
  readonly can_add_web_page_previews: boolean;
  readonly can_react_to_messages: boolean;
  readonly can_edit_tag: boolean;
  readonly can_change_info: boolean;
  readonly can_invite_users: boolean;
  readonly can_pin_messages: boolean;
  readonly can_manage_topics: boolean;
}

/** The fields of `getChat`'s `ChatFullInfo` that every chat has. */
interface BotApiChatFullInfoBase {
  readonly accepted_gift_types: BotApiAcceptedGiftTypes;
  readonly max_reaction_count: number;
  readonly accent_color_id: number;
  /** Present only when true. */
  readonly has_protected_content?: true;
}

/** A private chat with a user, as `getChat` shows it; fields for unset profile data are omitted. */
export interface BotApiPrivateChatFullInfo extends BotApiPrivateChat, BotApiChatFullInfoBase {
  /** Present for users other than bots. */
  readonly can_send_gift?: true;
  /** Present with the username. */
  readonly active_usernames?: readonly string[];
  /** Present only when true. */
  readonly has_private_forwards?: true;
  /** The newest pinned message, as a reply shows a message; omitted when none is pinned. */
  readonly pinned_message?: BotApiPinnedPrivateMessage;
}

/** A supergroup, as `getChat` shows it; fields for unset settings are omitted. */
export interface BotApiSupergroupChatFullInfo extends BotApiSupergroupChat, BotApiChatFullInfoBase {
  /** Present with the username. */
  readonly active_usernames?: readonly string[];
  /** Omitted when empty. */
  readonly description?: string;
  /** Present only when true. */
  readonly has_visible_history?: true;
  readonly permissions: BotApiChatPermissions;
  /** Present only when true. */
  readonly join_to_send_messages?: true;
  /** The newest pinned message, as a reply shows a message; omitted when none is pinned. */
  readonly pinned_message?: BotApiPinnedSupergroupMessage;
}

/** A chat with everything `getChat` tells a bot about it. */
export type BotApiChatFullInfo = BotApiPrivateChatFullInfo | BotApiSupergroupChatFullInfo;

/** A bot as a message shows it, without the capabilities that only `getMe` reports. */
export interface BotApiBotUser {
  readonly id: number;
  readonly is_bot: true;
  readonly first_name: string;
  readonly last_name?: string;
  readonly username: string;
}

/** A user as a message shows it: its sender or a user it mentions. */
export type BotApiUser = VirtualAccountProfile | BotApiBotUser;

/** Offsets and lengths count UTF-16 code units. */
interface BotApiTextSpan {
  readonly offset: number;
  readonly length: number;
}

export type BotApiMessageEntity =
  | (BotApiTextSpan & { readonly type: PlainTextEntityType })
  | (BotApiTextSpan & { readonly type: 'pre'; readonly language?: string })
  | (BotApiTextSpan & { readonly type: 'text_link'; readonly url: string })
  | (BotApiTextSpan & { readonly type: 'text_mention'; readonly user: BotApiUser })
  | (BotApiTextSpan & { readonly type: 'custom_emoji'; readonly custom_emoji_id: string })
  | (BotApiTextSpan & {
    readonly type: 'date_time';
    readonly unix_time: number;
    /** Empty when the sender chose no format, which Telegram reports all the same. */
    readonly date_time_format: string;
  });

/** A button's text and appearance, in the field order Telegram uses. */
export interface BotApiKeyboardButtonFace {
  readonly text: string;
  readonly icon_custom_emoji_id?: string;
  /** Omitted for the client's default style. */
  readonly style?: ButtonStyle;
}

export interface BotApiCallbackInlineKeyboardButton extends BotApiKeyboardButtonFace {
  readonly callback_data: string;
}

export interface BotApiUrlInlineKeyboardButton extends BotApiKeyboardButtonFace {
  readonly url: string;
}

export interface BotApiCopyTextInlineKeyboardButton extends BotApiKeyboardButtonFace {
  readonly copy_text: { readonly text: string };
}

export interface BotApiSwitchInlineQueryInlineKeyboardButton extends BotApiKeyboardButtonFace {
  readonly switch_inline_query: string;
}

export interface BotApiSwitchInlineQueryCurrentChatInlineKeyboardButton
  extends BotApiKeyboardButtonFace {
  readonly switch_inline_query_current_chat: string;
}

export interface BotApiSwitchInlineQueryChosenChatInlineKeyboardButton
  extends BotApiKeyboardButtonFace {
  readonly switch_inline_query_chosen_chat: {
    readonly query: string;
    readonly allow_user_chats: boolean;
    readonly allow_bot_chats: boolean;
    readonly allow_group_chats: boolean;
    readonly allow_channel_chats: boolean;
  };
}

export interface BotApiWebAppInlineKeyboardButton extends BotApiKeyboardButtonFace {
  readonly web_app: { readonly url: string };
}

export interface BotApiDisabledInlineKeyboardButton extends BotApiKeyboardButtonFace {
  readonly disabled: Record<string, never>;
}

export type BotApiInlineKeyboardButton =
  | BotApiCallbackInlineKeyboardButton
  | BotApiUrlInlineKeyboardButton
  | BotApiCopyTextInlineKeyboardButton
  | BotApiSwitchInlineQueryInlineKeyboardButton
  | BotApiSwitchInlineQueryCurrentChatInlineKeyboardButton
  | BotApiSwitchInlineQueryChosenChatInlineKeyboardButton
  | BotApiWebAppInlineKeyboardButton
  | BotApiDisabledInlineKeyboardButton;

export interface BotApiInlineKeyboardMarkup {
  readonly inline_keyboard: readonly (readonly BotApiInlineKeyboardButton[])[];
}

/** A file as the Bot API shows it, in the field order Telegram uses. */
export interface BotApiFile {
  /** The observing user's own identifier of the file, which it can send and download. */
  readonly file_id: string;
  /** The same for every user; it can neither send nor download the file. */
  readonly file_unique_id: string;
  readonly file_size: number;
}

/** A file whose download path `getFile` reported. */
export interface BotApiDownloadableFile extends BotApiFile {
  readonly file_path: string;
}

export interface BotApiPhotoSize extends BotApiFile {
  readonly width: number;
  readonly height: number;
}

/**
 * A document as the Bot API shows it: its name and type, then its thumbnail, precede its file
 * fields.
 */
export interface BotApiDocument extends BotApiFile {
  readonly file_name: string;
  readonly mime_type: string;
  /** Omitted for a document without a thumbnail. */
  readonly thumbnail?: BotApiPhotoSize;
  /** Legacy copy of `thumbnail`, which the Bot API still shows. */
  readonly thumb?: BotApiPhotoSize;
}

/**
 * A video as the official Bot API server's `JsonVideo` shows it: its duration, dimensions, name and
 * type, then its start timestamp and thumbnail, precede its file fields. Telegram's cover and
 * alternative qualities are not modeled, so they are never shown.
 */
export interface BotApiVideo extends BotApiFile {
  /** In seconds, as the sender defined it. */
  readonly duration: number;
  readonly width: number;
  readonly height: number;
  /** Omitted for a video sent without a file name. */
  readonly file_name?: string;
  readonly mime_type: string;
  /** Present only for a video that clients play from past its beginning. */
  readonly start_timestamp?: number;
  /** Omitted for a video without a thumbnail. */
  readonly thumbnail?: BotApiPhotoSize;
  /** Legacy copy of `thumbnail`, which the Bot API still shows. */
  readonly thumb?: BotApiPhotoSize;
}

/** A voice note as the official Bot API server's `JsonVoiceNote` shows it. */
export interface BotApiVoice extends BotApiFile {
  /** In seconds, as the sender defined it. */
  readonly duration: number;
  readonly mime_type: string;
}

/** A caption's fields, which Telegram omits for a media message without a caption. */
interface BotApiCaption {
  readonly caption?: string;
  /** Omitted when the caption has no entities. */
  readonly caption_entities?: readonly BotApiMessageEntity[];
}

/**
 * The fields of media that a message shows with a caption: a photo, a document, a video, or a
 * voice note.
 */
type BotApiCaptionedMediaContent =
  & BotApiCaption
  & (
    | {
      /** The photo's sizes, smallest first; the emulator keeps a single size. */
      readonly photo: readonly BotApiPhotoSize[];
      /** Present only for a caption that clients show above the photo. */
      readonly show_caption_above_media?: true;
      /** Present only for a photo that clients cover until the user reveals it. */
      readonly has_media_spoiler?: true;
    }
    | { readonly document: BotApiDocument }
    | {
      readonly video: BotApiVideo;
      /** Present only for a caption that clients show above the video. */
      readonly show_caption_above_media?: true;
      /** Present only for a video that clients cover until the user reveals it. */
      readonly has_media_spoiler?: true;
    }
    | { readonly voice: BotApiVoice }
  );

/** The fields that show what a message is, which follow its reply. */
export type BotApiMessageContent =
  | {
    readonly text: string;
    /** Omitted when the text has no entities, as Telegram does. */
    readonly entities?: readonly BotApiMessageEntity[];
  }
  | BotApiCaptionedMediaContent
  | { readonly rich_message: BotApiRichMessage }
  | { readonly poll: BotApiPoll }
  | { readonly contact: BotApiContact }
  | { readonly location: BotApiLocation };

/**
 * The fields of a service message about a membership change, which take the place of content.
 * Telegram still sends each change's legacy fields before its current ones.
 */
export type BotApiMembershipServiceContent =
  | {
    /** Legacy alias of `new_chat_member`. */
    readonly new_chat_participant: BotApiUser;
    /** Legacy: the observing bot if it joined, otherwise the first new member. */
    readonly new_chat_member: BotApiUser;
    readonly new_chat_members: readonly BotApiUser[];
  }
  | {
    /** Legacy alias of `left_chat_member`. */
    readonly left_chat_participant: BotApiUser;
    readonly left_chat_member: BotApiUser;
  };

/** The field of a service message about a title change, which takes the place of content. */
export interface BotApiTitleChangeServiceContent {
  readonly new_chat_title: string;
}

/**
 * A deleted message, as the Bot API's `InaccessibleMessage` shows it in place of the message:
 * only its chat and ID, with a `date` of 0.
 */
export interface BotApiInaccessibleMessage<Chat> {
  readonly message_id: number;
  readonly chat: Chat;
  readonly date: 0;
}

/**
 * The field of a service message about a pin, which takes the place of content: the pinned
 * message, or, once deleted, inaccessible.
 */
export interface BotApiPinServiceContent<PinnedMessage, Chat> {
  readonly pinned_message: PinnedMessage | BotApiInaccessibleMessage<Chat>;
}

/**
 * The field of a service message about a pin where the service message is itself shown as a
 * replied message, which leaves out a deleted pinned message, as the official server does there.
 */
export interface BotApiRepliedPinServiceContent<PinnedMessage> {
  readonly pinned_message?: PinnedMessage;
}

/** What a private message shows: content, or a pin. */
export type BotApiPrivateMessageContent =
  | BotApiMessageContent
  | BotApiPinServiceContent<BotApiPinnedPrivateMessage, BotApiPrivateChat>;

/** What a private message shows as a replied message: content, or a pin. */
export type BotApiRepliedPrivateMessageContent =
  | BotApiMessageContent
  | BotApiRepliedPinServiceContent<BotApiPinnedPrivateMessage>;

/** What a supergroup message shows: content, or a change of the supergroup. */
export type BotApiSupergroupMessageContent =
  | BotApiMessageContent
  | BotApiMembershipServiceContent
  | BotApiTitleChangeServiceContent
  | BotApiPinServiceContent<BotApiPinnedSupergroupMessage, BotApiSupergroupChat>;

/** What a supergroup message shows as a replied message: content, or a change of the supergroup. */
export type BotApiRepliedSupergroupMessageContent =
  | BotApiMessageContent
  | BotApiMembershipServiceContent
  | BotApiTitleChangeServiceContent
  | BotApiRepliedPinServiceContent<BotApiPinnedSupergroupMessage>;

/** Where a forward first appeared: a user, because the emulator's senders are users. */
export interface BotApiMessageOriginUser {
  readonly type: 'user';
  readonly sender_user: BotApiUser;
  /** When the original message was sent. */
  readonly date: number;
}

/** Where a forward of a user whose privacy settings keep forwards from linking to it appeared. */
export interface BotApiMessageOriginHiddenUser {
  readonly type: 'hidden_user';
  /** The name the user's forwards show instead. */
  readonly sender_user_name: string;
  /** When the original message was sent. */
  readonly date: number;
}

export type BotApiMessageOrigin = BotApiMessageOriginUser | BotApiMessageOriginHiddenUser;

/**
 * The media of a message of another chat that a message replies to, whose caption shows as the
 * reply's quote instead, or its poll, contact, or location: nothing for text.
 */
export type BotApiExternalReplyMedia =
  | Record<never, never>
  | { readonly poll: BotApiPoll }
  | {
    readonly photo: readonly BotApiPhotoSize[];
    /** Present only for a photo that clients cover until the user reveals it. */
    readonly has_media_spoiler?: true;
  }
  | { readonly document: BotApiDocument }
  | {
    readonly video: BotApiVideo;
    /** Present only for a video that clients cover until the user reveals it. */
    readonly has_media_spoiler?: true;
  }
  | { readonly voice: BotApiVoice }
  | { readonly contact: BotApiContact }
  | { readonly location: BotApiLocation };

/** A message of another chat that a message replies to, as Telegram's `ExternalReplyInfo`. */
export type BotApiExternalReplyInfo =
  & {
    readonly origin: BotApiMessageOrigin;
    /** The replied message's supergroup; omitted for a message of a private chat. */
    readonly chat?: BotApiSupergroupChat;
    /** The replied message's ID in its supergroup; omitted for a message of a private chat. */
    readonly message_id?: number;
  }
  & BotApiExternalReplyMedia;

/** The quoted part of a replied message, as Telegram's `TextQuote`. */
export interface BotApiTextQuote {
  readonly text: string;
  /** Omitted when the quote has no entities. */
  readonly entities?: readonly BotApiMessageEntity[];
  /** Where the quote starts in the replied text, in UTF-16 code units. */
  readonly position: number;
  /** Present only for a quote the sender chose. */
  readonly is_manual?: true;
}

/** How a message replies to a message outside its chat, or with a quote; before its content. */
interface BotApiMessageReplyInfo {
  /** Present only for a reply to a message of another chat. */
  readonly external_reply?: BotApiExternalReplyInfo;
  /** Present only for a reply that quotes the replied message. */
  readonly quote?: BotApiTextQuote;
}

/** The album a message belongs to, which follows its reply and precedes its content. */
interface BotApiMessageAlbumInfo {
  /** Present only for a message of an album. */
  readonly media_group_id?: string;
}

interface BotApiMessageHeader<Chat> {
  readonly message_id: number;
  readonly from: BotApiUser;
  readonly chat: Chat;
  readonly date: number;
  /** Omitted for a message whose content was never edited. */
  readonly edit_date?: number;
  /** Present only for a forward. */
  readonly forward_origin?: BotApiMessageOrigin;
  /** Legacy form of the origin's sender; present only for a forward of a user's message. */
  readonly forward_from?: BotApiUser;
  /** Legacy form of the origin's name; present only for a forward of a hidden user's message. */
  readonly forward_sender_name?: string;
  /** Legacy form of the origin's date; present only for a forward. */
  readonly forward_date?: number;
}

interface BotApiMessageTrailer {
  /** Omitted when the message has no inline keyboard. */
  readonly reply_markup?: BotApiInlineKeyboardMarkup;
  /** The bot through whose inline mode the message was sent; omitted for other messages. */
  readonly via_bot?: BotApiBotUser;
  /** Present only for a message its sender protected from forwarding and saving. */
  readonly has_protected_content?: true;
  /** The message effect a bot sent a private message with; omitted for other messages. */
  readonly effect_id?: string;
}

/**
 * A message as a reply shows it: Telegram never nests the replied message's own reply, though it
 * shows the message's reply to another chat and its quote.
 */
type BotApiRepliedMessageInChat<Chat, Content> =
  & BotApiMessageHeader<Chat>
  & BotApiMessageReplyInfo
  & BotApiMessageAlbumInfo
  & Content
  & BotApiMessageTrailer;

/**
 * A message in a chat of the given type, with what it shows as a message and as a replied message,
 * in the field order Telegram uses.
 */
type BotApiMessageInChat<Chat, Content, RepliedContent> =
  & BotApiMessageHeader<Chat>
  & {
    /**
     * The replied message, without its own reply; omitted when the message is no reply or the
     * replied message was deleted.
     */
    readonly reply_to_message?: BotApiRepliedMessageInChat<Chat, RepliedContent>;
  }
  & BotApiMessageReplyInfo
  & BotApiMessageAlbumInfo
  & Content
  & BotApiMessageTrailer;

export type BotApiPrivateMessage = BotApiMessageInChat<
  BotApiPrivateChat,
  BotApiPrivateMessageContent,
  BotApiRepliedPrivateMessageContent
>;

export type BotApiSupergroupMessage = BotApiMessageInChat<
  BotApiSupergroupChat,
  BotApiSupergroupMessageContent,
  BotApiRepliedSupergroupMessageContent
>;

export type BotApiMessage = BotApiPrivateMessage | BotApiSupergroupMessage;

export type BotApiRepliedPrivateMessage = BotApiRepliedMessageInChat<
  BotApiPrivateChat,
  BotApiRepliedPrivateMessageContent
>;

export type BotApiRepliedSupergroupMessage = BotApiRepliedMessageInChat<
  BotApiSupergroupChat,
  BotApiRepliedSupergroupMessageContent
>;

/**
 * A pinned message as a pin's service message and `getChat` show it: as a reply shows a message,
 * with content, since service messages are never pinned.
 */
export type BotApiPinnedPrivateMessage = BotApiRepliedMessageInChat<
  BotApiPrivateChat,
  BotApiMessageContent
>;

/** A pinned supergroup message, as `BotApiPinnedPrivateMessage` describes a private one. */
export type BotApiPinnedSupergroupMessage = BotApiRepliedMessageInChat<
  BotApiSupergroupChat,
  BotApiMessageContent
>;

/** A bot command as the Bot API shows it. */
/**
 * The rights a bot asks for by default as an administrator of a kind of chat: every right that
 * applies to the kind, held or not, in the order the Bot API shows them.
 */
export type BotApiDefaultAdministratorRights = {
  readonly [Right in ChatAdministratorRightName]?: boolean;
};

/** The menu button of a bot's private chats, as the official server's `JsonBotMenuButton` shows it. */
export type BotApiMenuButton =
  | { readonly type: 'commands' }
  | { readonly type: 'web_app'; readonly text: string; readonly web_app: { readonly url: string } }
  | { readonly type: 'default' };

export interface BotApiBotCommand {
  readonly command: string;
  readonly description: string;
  /** Present only when set. */
  readonly is_ephemeral?: true;
}

/**
 * A press of a callback button, in the field order Telegram uses: on a message of the bot's chat,
 * which it carries, or on a message sent through the bot's inline mode, which the bot knows only by
 * its `inline_message_id`.
 */
export type BotApiCallbackQuery =
  | {
    readonly id: string;
    readonly from: VirtualAccountProfile;
    readonly message: BotApiMessage;
    readonly chat_instance: string;
    readonly data: string;
  }
  | {
    readonly id: string;
    readonly from: VirtualAccountProfile;
    readonly inline_message_id: string;
    readonly chat_instance: string;
    readonly data: string;
  };

/** A phone contact, in the field order of the official Bot API server's `JsonContact`. */
export interface BotApiContact {
  readonly phone_number: string;
  readonly first_name: string;
  /** Omitted when the contact has no last name. */
  readonly last_name?: string;
  /** Omitted when the contact has no vCard. */
  readonly vcard?: string;
  /** Omitted when the contact's Telegram user is unknown. */
  readonly user_id?: number;
}

/** Shows a contact as the official Bot API server's `JsonContact` does, omitting empty fields. */
export function toBotApiContact(
  { phoneNumber, firstName, lastName, vcard, userId }: Contact,
): BotApiContact {
  return {
    phone_number: phoneNumber,
    first_name: firstName,
    ...(lastName.length === 0 ? {} : { last_name: lastName }),
    ...(vcard.length === 0 ? {} : { vcard }),
    ...(userId === undefined ? {} : { user_id: userId }),
  };
}

/** A location, in the field order of the official Bot API server's `JsonLocation`. */
export interface BotApiLocation {
  readonly latitude: number;
  readonly longitude: number;
  /** Omitted when unknown. */
  readonly horizontal_accuracy?: number;
}

/** Shows a location as the official Bot API server's `JsonLocation` does. */
export function toBotApiLocation(
  { latitude, longitude, horizontalAccuracyMeters }: GeoLocation,
): BotApiLocation {
  return {
    latitude,
    longitude,
    ...(horizontalAccuracyMeters === undefined
      ? {}
      : { horizontal_accuracy: horizontalAccuracyMeters }),
  };
}

export interface BotApiInlineQuery {
  readonly id: string;
  readonly from: VirtualAccountProfile;
  /** Present only when the account shared its location with a bot that requests it. */
  readonly location?: BotApiLocation;
  /** `sender` for the private chat between the account and the inline bot itself. */
  readonly chat_type: 'sender' | 'private' | 'supergroup';
  readonly query: string;
  readonly offset: string;
}

/** An inline query result an account sent, in the field order Telegram uses. */
export interface BotApiChosenInlineResult {
  readonly from: VirtualAccountProfile;
  /** The location the account shared with the query, if any. */
  readonly location?: BotApiLocation;
  /** Present only when the sent message has an inline keyboard. */
  readonly inline_message_id?: string;
  readonly query: string;
  readonly result_id: string;
}

/** The bot's membership in a private chat: `kicked` while the account blocks the bot. */
export type BotApiPrivateChatBotMember =
  | { readonly user: BotApiBotUser; readonly status: 'member' }
  | { readonly user: BotApiBotUser; readonly status: 'kicked'; readonly until_date: 0 };

/**
 * A supergroup administrator's rights, in the order the Bot API shows them. Anonymous
 * administrators are not supported.
 */
export type BotApiSupergroupAdministratorRights =
  & { readonly [Right in SupergroupAdministratorRight]: boolean }
  & { readonly is_anonymous: false };

/**
 * A user's standing in a group, in the field order Telegram uses. Custom titles and member tags
 * are not supported.
 */
export type BotApiChatMember<User extends BotApiUser = BotApiUser> =
  | {
    readonly user: User;
    readonly status: 'creator';
    /** Omitted for none. */
    readonly custom_title?: string;
    readonly is_anonymous: false;
  }
  | (
    & {
      readonly user: User;
      readonly status: 'administrator';
      /** Whether the observing bot may change the administrator's rights. */
      readonly can_be_edited: boolean;
    }
    & BotApiSupergroupAdministratorRights
    & {
      /** Legacy alias of `can_manage_video_chats`. */
      readonly can_manage_voice_chats: boolean;
      /** Omitted for none. */
      readonly custom_title?: string;
    }
  )
  | { readonly user: User; readonly status: 'member' }
  | (
    & {
      readonly user: User;
      readonly status: 'restricted';
      /** When the restriction ends; 0 for one that lasts until it is lifted. */
      readonly until_date: number;
    }
    & BotApiChatPermissions
    & { readonly is_member: boolean }
  )
  | { readonly user: User; readonly status: 'left' }
  | {
    readonly user: User;
    readonly status: 'kicked';
    /** When the ban ends; 0 for a ban that lasts until it is lifted. */
    readonly until_date: number;
  };

/**
 * The bot's membership in a group: `left` before it joins and after it leaves, `kicked` while it is
 * banned, and `administrator` while the owner grants it rights. A bot never owns a group.
 */
export type BotApiGroupChatBotMember = Exclude<
  BotApiChatMember<BotApiBotUser>,
  { readonly status: 'creator' }
>;

/**
 * An invite link of a chat, in the field order of the official Bot API server's
 * `JsonChatInviteLink`. Primary, revoked, and subscription links are not supported.
 */
export interface BotApiChatInviteLink {
  /**
   * The link; one that another administrator created shows only the first part of its hash,
   * followed by `...`.
   */
  readonly invite_link: string;
  /** Omitted for none. */
  readonly name?: string;
  readonly creator: BotApiUser;
  /** Omitted for a link without an expiry date. */
  readonly expire_date?: number;
  /** Omitted for a link without a member limit. */
  readonly member_limit?: number;
  /** How many pending join requests were sent through the link; omitted for none. */
  readonly pending_join_request_count?: number;
  readonly creates_join_request: boolean;
  readonly is_primary: false;
  readonly is_revoked: false;
}

/** A change of a user's membership in a chat, in the field order Telegram uses. */
interface BotApiChatMemberUpdatedInChat<Chat, ChatMember> {
  readonly chat: Chat;
  /**
   * The user who changed the membership: in a private chat, the account at its other end; in a
   * group, the account or bot that added, removed, promoted, demoted, banned, or unbanned the
   * member, or the member itself when it left.
   */
  readonly from: BotApiUser;
  readonly date: number;
  readonly old_chat_member: ChatMember;
  readonly new_chat_member: ChatMember;
}

/** A change of the bot's own membership in a chat. */
export type BotApiMyChatMemberUpdated =
  | BotApiChatMemberUpdatedInChat<BotApiPrivateChat, BotApiPrivateChatBotMember>
  | BotApiChatMemberUpdatedInChat<BotApiGroupChat, BotApiGroupChatBotMember>;

/** A change of another user's standing in a group, which administrator bots may subscribe to. */
export type BotApiChatMemberUpdated =
  & BotApiChatMemberUpdatedInChat<BotApiGroupChat, BotApiChatMember>
  & {
    /** The invite link the member joined through; omitted for every other change. */
    readonly invite_link?: BotApiChatInviteLink;
  };

/**
 * A request to join a supergroup, in the field order of the official Bot API server's
 * `JsonChatJoinRequest`. Bios and join request queries are not supported.
 */
export interface BotApiChatJoinRequest {
  readonly chat: BotApiSupergroupChat;
  readonly from: VirtualAccountProfile;
  /** The requester's private chat with the bot, whose ID is the requester's. */
  readonly user_chat_id: number;
  readonly date: number;
  /** The invite link the request was sent through, as the observing bot sees it. */
  readonly invite_link: BotApiChatInviteLink;
}

export interface BotApiMessageUpdate {
  readonly update_id: number;
  readonly message: BotApiMessage;
}

export interface BotApiEditedMessageUpdate {
  readonly update_id: number;
  readonly edited_message: BotApiMessage;
}

export interface BotApiCallbackQueryUpdate {
  readonly update_id: number;
  readonly callback_query: BotApiCallbackQuery;
}

export interface BotApiInlineQueryUpdate {
  readonly update_id: number;
  readonly inline_query: BotApiInlineQuery;
}

export interface BotApiChosenInlineResultUpdate {
  readonly update_id: number;
  readonly chosen_inline_result: BotApiChosenInlineResult;
}

/** A new state of a poll the bot sent: new counts, or its closure. */
export interface BotApiPollUpdate {
  readonly update_id: number;
  readonly poll: BotApiPoll;
}

/** A changed answer to a non-anonymous poll the bot sent. */
export interface BotApiPollAnswerUpdate {
  readonly update_id: number;
  readonly poll_answer: BotApiPollAnswer;
}

export interface BotApiMyChatMemberUpdate {
  readonly update_id: number;
  readonly my_chat_member: BotApiMyChatMemberUpdated;
}

export interface BotApiChatMemberUpdate {
  readonly update_id: number;
  readonly chat_member: BotApiChatMemberUpdated;
}

export interface BotApiChatJoinRequestUpdate {
  readonly update_id: number;
  readonly chat_join_request: BotApiChatJoinRequest;
}

export type BotApiUpdate =
  | BotApiMessageUpdate
  | BotApiEditedMessageUpdate
  | BotApiInlineQueryUpdate
  | BotApiChosenInlineResultUpdate
  | BotApiCallbackQueryUpdate
  | BotApiPollUpdate
  | BotApiPollAnswerUpdate
  | BotApiMyChatMemberUpdate
  | BotApiChatMemberUpdate
  | BotApiChatJoinRequestUpdate;

/**
 * The ID of the chat an update happened in, as grammY's `ctx.chat` finds it; `undefined` for an
 * inline query, a chosen inline result, a press of a button on a message sent through inline mode,
 * or a poll or poll answer, which the bot knows no chat of.
 */
export function getBotApiUpdateChatId(update: BotApiUpdate): number | undefined {
  if ('message' in update) {
    return update.message.chat.id;
  }
  if ('edited_message' in update) {
    return update.edited_message.chat.id;
  }
  if ('callback_query' in update) {
    return 'message' in update.callback_query ? update.callback_query.message.chat.id : undefined;
  }
  if ('my_chat_member' in update) {
    return update.my_chat_member.chat.id;
  }
  if ('chat_member' in update) {
    return update.chat_member.chat.id;
  }
  if ('chat_join_request' in update) {
    return update.chat_join_request.chat.id;
  }
  return undefined;
}

/**
 * The ID of the user whose action caused an update, as grammY's `ctx.from` finds it; `undefined`
 * for a poll's new state, which names no user.
 */
export function getBotApiUpdateUserId(update: BotApiUpdate): number | undefined {
  if ('message' in update) {
    return update.message.from.id;
  }
  if ('edited_message' in update) {
    return update.edited_message.from.id;
  }
  if ('callback_query' in update) {
    return update.callback_query.from.id;
  }
  if ('inline_query' in update) {
    return update.inline_query.from.id;
  }
  if ('chosen_inline_result' in update) {
    return update.chosen_inline_result.from.id;
  }
  if ('poll' in update) {
    return undefined;
  }
  if ('poll_answer' in update) {
    return update.poll_answer.user.id;
  }
  if ('my_chat_member' in update) {
    return update.my_chat_member.from.id;
  }
  if ('chat_join_request' in update) {
    return update.chat_join_request.from.id;
  }
  return update.chat_member.from.id;
}

/**
 * Every update type name the official Bot API server recognizes in `allowed_updates`, including
 * types the emulator never produces. Mirrors `get_update_type_name` in `telegram-bot-api/Client.cpp`
 * at commit e3e9dd8e5b3d7ab8537cd5a10dc31d5ffa8f82d1.
 */
export const BOT_API_UPDATE_TYPES = [
  'message',
  'edited_message',
  'channel_post',
  'edited_channel_post',
  'inline_query',
  'chosen_inline_result',
  'callback_query',
  'custom_event',
  'custom_query',
  'shipping_query',
  'pre_checkout_query',
  'poll',
  'poll_answer',
  'my_chat_member',
  'chat_member',
  'chat_join_request',
  'chat_boost',
  'removed_chat_boost',
  'message_reaction',
  'message_reaction_count',
  'business_connection',
  'business_message',
  'edited_business_message',
  'deleted_business_messages',
  'purchased_paid_media',
  'managed_bot',
  'guest_message',
  'subscription',
  'stopped_message_generation',
] as const;

export type BotApiUpdateType = typeof BOT_API_UPDATE_TYPES[number];

/** Update types a bot receives only after requesting them explicitly in `allowed_updates`. */
const OPT_IN_UPDATE_TYPES: readonly BotApiUpdateType[] = [
  'chat_member',
  'message_reaction',
  'message_reaction_count',
];

/** The subscription of a bot that has not chosen one, or that requested no recognized type. */
export const DEFAULT_ALLOWED_UPDATE_TYPES: ReadonlySet<BotApiUpdateType> = new Set(
  BOT_API_UPDATE_TYPES.filter((updateType) => !OPT_IN_UPDATE_TYPES.includes(updateType)),
);

/**
 * Interprets `allowed_updates` as Telegram's `get_allowed_update_types` does: names match
 * case-insensitively, unrecognized names are ignored, and a list with no recognized name selects
 * the default subscription.
 */
export function resolveAllowedUpdateTypes(
  requestedUpdateTypeNames: readonly string[],
): ReadonlySet<BotApiUpdateType> {
  const requestedNames = new Set(requestedUpdateTypeNames.map((name) => name.toLowerCase()));
  const allowedUpdateTypes = new Set(
    BOT_API_UPDATE_TYPES.filter((updateType) => requestedNames.has(updateType)),
  );
  return allowedUpdateTypes.size === 0 ? DEFAULT_ALLOWED_UPDATE_TYPES : allowedUpdateTypes;
}

/**
 * A bot's webhook as `getWebhookInfo` reports it, with fields in the official Bot API server's
 * order. Telegram also reports the IP address it resolved the webhook host to, which the emulator
 * does not resolve. The emulator accepts no custom certificate, so it never reports one.
 */
export interface BotApiWebhookInfo {
  /** Empty when the bot has no webhook. */
  readonly url: string;
  readonly has_custom_certificate: false;
  readonly pending_update_count: number;
  readonly last_error_date?: number;
  readonly last_error_message?: string;
  /** Reported only while a webhook is set. */
  readonly max_connections?: number;
  /** Reported only for a subscription other than the default. */
  readonly allowed_updates?: readonly BotApiUpdateType[];
}
