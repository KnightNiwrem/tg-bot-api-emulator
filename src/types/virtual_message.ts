import type { Contact } from './contact.ts';
import type { GeoLocation } from './geo_location.ts';
import type { InlineKeyboard } from './inline_keyboard.ts';
import type { UserReaction } from './message_reaction.ts';
import type { PollId } from './poll.ts';
import type { ReplyInterfaceMarkup } from './reply_interface.ts';
import { type RichMessage, richMessageMentionsUser } from './rich_message.ts';
import type { StoredFileId } from './stored_file.ts';
import type { PrivateConversationKey, PrivateConversationRole } from './virtual_chat.ts';

/** The most characters of message text that Telegram accepts, as `countTextCharacters` counts them. */
export const MAX_TEXT_MESSAGE_LENGTH = 4_096;

/**
 * Emulator-internal identity of a canonical message.
 *
 * It is never a Telegram `message_id`: Telegram numbers the same message differently for each
 * observer, so Bot API projections resolve `message_id` from the observer's message box instead.
 */
export type CanonicalMessageId = string;

/**
 * Telegram's `inline_message_id`: an opaque identifier of a message an account sent through a
 * bot's inline mode, by which that bot edits the message without being a member of its chat.
 */
export type InlineMessageId = string;

/**
 * Telegram's `media_group_id`: the decimal text of the positive 64-bit identifier that the
 * messages of one album share. Each album sent, forwarded, or copied as a whole gets a new one.
 */
export type MediaGroupId = string;

/** The bot through whose inline mode an account sent a message, as Telegram's `via_bot` shows. */
export interface ViaBot {
  readonly botId: number;
  /** How the inline bot addresses the message. */
  readonly inlineMessageId: InlineMessageId;
}

/**
 * Who wrote the original of a forward, as the forward shows it: the account or bot itself, or, as
 * Telegram's origin of a hidden user does, only the name of an account whose privacy settings keep
 * forwards from linking to it.
 */
export type MessageOriginSender =
  | { readonly kind: 'user'; readonly userId: number }
  | { readonly kind: 'hidden_user'; readonly name: string };

/**
 * Where a forwarded message first appeared, which the forward shows as Telegram's origin of a user
 * or of a hidden user. Forwarding a forward keeps its origin.
 */
export interface MessageForwardInfo {
  /** Who wrote the original message, as the forward shows it. */
  readonly originalSender: MessageOriginSender;
  readonly originalSentAtUnixSeconds: number;
  /**
   * The inline bot the original message was sent through, which the forward still shows; omitted
   * for none. Unlike the original's inline bot, it cannot edit the forward.
   */
  readonly viaBotId?: number;
}

/** A span of message text. Offsets and lengths count UTF-16 code units, as Telegram's do. */
interface TextSpan {
  readonly offset: number;
  readonly length: number;
}

/**
 * Entity types that carry nothing beyond their span. Telegram detects mentions, hashtags,
 * cashtags, bot commands, URLs, email addresses and bank card numbers in text by itself.
 */
export type PlainTextEntityType =
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

export interface PlainTextEntity extends TextSpan {
  readonly type: PlainTextEntityType;
}

/** Preformatted text, optionally naming the programming language of its code. */
export interface PreTextEntity extends TextSpan {
  readonly type: 'pre';
  /** Omitted for a block without a language. */
  readonly language?: string;
}

export interface TextLinkEntity extends TextSpan {
  readonly type: 'text_link';
  /** The link as Telegram normalized it. */
  readonly url: string;
}

/** A mention of a user by ID, for users without a username. */
export interface TextMentionEntity extends TextSpan {
  readonly type: 'text_mention';
  readonly userId: number;
}

export interface CustomEmojiEntity extends TextSpan {
  readonly type: 'custom_emoji';
  /** Telegram's decimal text form of the custom emoji's 64-bit identifier. */
  readonly customEmojiId: string;
}

/** How precisely clients show the time or the date of a date and time entity. */
export type DateTimePartPrecision = 'short' | 'long';

/**
 * How clients show a date and time entity, as TDLib's `FormattedDate` flags describe it: relative
 * to the present, or with the chosen parts.
 */
export type DateTimeFormat =
  | { readonly kind: 'relative' }
  | {
    readonly kind: 'absolute';
    /** Omitted to show no time. */
    readonly timePrecision?: DateTimePartPrecision;
    /** Omitted to show no date. */
    readonly datePrecision?: DateTimePartPrecision;
    readonly showsDayOfWeek: boolean;
  };

/** A date and time that clients show in each reader's time zone. */
export interface DateTimeEntity extends TextSpan {
  readonly type: 'date_time';
  /** The shown moment in Unix seconds, which Telegram requires to be positive. */
  readonly unixTime: number;
  /** Omitted when the sender chose no format. */
  readonly format?: DateTimeFormat;
}

/** A marked span of message text: formatting, a link, or an entity Telegram detected. */
export type TextEntity =
  | PlainTextEntity
  | PreTextEntity
  | TextLinkEntity
  | TextMentionEntity
  | CustomEmojiEntity
  | DateTimeEntity;

/** Text with the entities that mark spans of it. */
export interface FormattedText {
  readonly text: string;
  readonly entities: readonly TextEntity[];
}

/**
 * The most characters of a caption that Telegram accepts from bots and non-premium users, as
 * `countTextCharacters` counts them.
 */
export const MAX_CAPTION_LENGTH = 1_024;

/**
 * Counts the characters of message text or a caption as Telegram's length limits do: TDLib counts
 * Unicode code points, whereas entity offsets and lengths count UTF-16 code units.
 */
export function countTextCharacters(text: string): number {
  return [...text].length;
}

export interface TextMessageContent extends FormattedText {
  readonly kind: 'text';
}

export interface PhotoMessageContent {
  readonly kind: 'photo';
  readonly fileId: StoredFileId;
  /** Empty for a photo without a caption. */
  readonly caption: FormattedText;
  /** Whether clients cover the photo until the user reveals it. */
  readonly hasSpoiler: boolean;
  /** Whether clients show the caption above the photo, which matters only with a caption. */
  readonly showsCaptionAboveMedia: boolean;
}

export interface DocumentMessageContent {
  readonly kind: 'document';
  readonly fileId: StoredFileId;
  /** Empty for a document without a caption. */
  readonly caption: FormattedText;
}

export interface VideoMessageContent {
  readonly kind: 'video';
  readonly fileId: StoredFileId;
  /** Empty for a video without a caption. */
  readonly caption: FormattedText;
  /** Whether clients cover the video until the user reveals it. */
  readonly hasSpoiler: boolean;
  /** Whether clients show the caption above the video, which matters only with a caption. */
  readonly showsCaptionAboveMedia: boolean;
  /**
   * The second of the video from which clients play it in the message, which TDLib keeps with the
   * message rather than the file; 0 to play it from its start.
   */
  readonly startTimestampSeconds: number;
}

/** A voice note, which, unlike other captioned media, never forms albums or replaces media. */
export interface VoiceMessageContent {
  readonly kind: 'voice';
  readonly fileId: StoredFileId;
  /** Empty for a voice note without a caption. */
  readonly caption: FormattedText;
}

/**
 * An audio file, such as a music track, which clients play in their audio player. Unlike a voice
 * note, it forms albums with other audio files and replaces media.
 */
export interface AudioMessageContent {
  readonly kind: 'audio';
  readonly fileId: StoredFileId;
  /** Empty for an audio file without a caption. */
  readonly caption: FormattedText;
}

/** A message laid out in blocks, which only bots send. It has no text or caption. */
export interface RichMessageContent extends RichMessage {
  readonly kind: 'rich_message';
}

/**
 * Media that a message shows with a caption: a photo, a document, a video, a voice note, or an
 * audio file. Each carries the one stored file it shows, and a caption that is empty when it has
 * none.
 */
export type CaptionedMediaContent =
  | PhotoMessageContent
  | DocumentMessageContent
  | VideoMessageContent
  | VoiceMessageContent
  | AudioMessageContent;

/**
 * A poll, which the account or bot that sent it created. The message shows the poll by its
 * identifier: the question, options, votes, and state belong to the poll, which every forward of
 * the message shows alike.
 */
export interface PollMessageContent {
  readonly kind: 'poll';
  readonly pollId: PollId;
}

/** A phone contact, which carries no text or caption. */
export interface ContactMessageContent {
  readonly kind: 'contact';
  readonly contact: Contact;
}

/**
 * A static location, which carries no text or caption. Live locations, which their sender keeps
 * updating, are not supported.
 */
export interface LocationMessageContent {
  readonly kind: 'location';
  readonly location: GeoLocation;
}

/** What a message shows: text, captioned media, a rich message, a poll, a contact, or a location. */
export type MessageContent =
  | TextMessageContent
  | CaptionedMediaContent
  | RichMessageContent
  | PollMessageContent
  | ContactMessageContent
  | LocationMessageContent;

/** A service message's record that accounts or bots joined a supergroup. */
export interface MembersJoinedMessageContent {
  readonly kind: 'members_joined';
  /** The accounts and bots that joined. */
  readonly memberIds: readonly number[];
}

/** A service message's record that a member left a supergroup or was removed from it. */
export interface MemberLeftMessageContent {
  readonly kind: 'member_left';
  readonly memberId: number;
}

/** A change of a supergroup's members, which Telegram records as a service message. */
export type MembershipServiceContent = MembersJoinedMessageContent | MemberLeftMessageContent;

/** A service message's record that a supergroup's title changed. */
export interface TitleChangedMessageContent {
  readonly kind: 'title_changed';
  /** The new title. */
  readonly title: string;
}

/**
 * A service message's record that a message of its chat was pinned, which Telegram records as a
 * message of whoever pinned it, in private chats and supergroups alike. Unpinning records nothing.
 */
export interface MessagePinnedContent {
  readonly kind: 'message_pinned';
  /** The pinned message of the same chat, which may since have been deleted. */
  readonly pinnedMessageId: CanonicalMessageId;
}

/**
 * What a service message shows instead of content: a change of the supergroup's members or of its
 * title, or a pin, which Telegram records as a message of whoever made the change.
 */
export type SupergroupServiceContent =
  | MembershipServiceContent
  | TitleChangedMessageContent
  | MessagePinnedContent;

/** What a supergroup message shows: content its author wrote, or a change of the supergroup. */
export type SupergroupMessageContent = MessageContent | SupergroupServiceContent;

/**
 * A user an account shared with a bot, with the details of the user that the bot's request asked
 * for, as they were when the account shared it. A detail the request did not ask for, or that the
 * user lacks, is omitted.
 */
export interface SharedUser {
  readonly userId: number;
  readonly firstName?: string;
  readonly lastName?: string;
  readonly username?: string;
}

/**
 * A service message's record that an account shared users with the bot of its private chat, in
 * answer to a reply keyboard button's `request_users`.
 */
export interface UsersSharedMessageContent {
  readonly kind: 'users_shared';
  /** The `request_id` of the button's request. */
  readonly requestId: number;
  /** The shared users, in the order the account chose them; never empty. */
  readonly users: readonly SharedUser[];
}

/**
 * A service message's record that an account shared a chat with the bot of its private chat, in
 * answer to a reply keyboard button's `request_chat`, with the details of the chat that the
 * request asked for, as they were when the account shared it. A detail the request did not ask
 * for, or that the chat lacks, is omitted.
 */
export interface ChatSharedMessageContent {
  readonly kind: 'chat_shared';
  /** The `request_id` of the button's request. */
  readonly requestId: number;
  readonly chatId: number;
  readonly title?: string;
  readonly username?: string;
}

/**
 * What a private service message shows instead of content: a pin, or the users or chat an account
 * shared with the bot.
 */
export type PrivateServiceContent =
  | MessagePinnedContent
  | UsersSharedMessageContent
  | ChatSharedMessageContent;

/** What a private message shows: content its author wrote, or a service message's record. */
export type PrivateMessageContent = MessageContent | PrivateServiceContent;

/** What a message of any chat shows: content its author wrote, or a service message's record. */
export type ChatMessageContent = SupergroupMessageContent | PrivateMessageContent;

/**
 * Whether a message's content records a change of its chat, or what an account shared, as a
 * service message, rather than content its author wrote.
 */
function isServiceContent(
  content: ChatMessageContent,
): content is SupergroupServiceContent | PrivateServiceContent {
  switch (content.kind) {
    case 'members_joined':
    case 'member_left':
    case 'title_changed':
    case 'message_pinned':
    case 'users_shared':
    case 'chat_shared':
      return true;
    case 'text':
    case 'photo':
    case 'document':
    case 'video':
    case 'voice':
    case 'audio':
    case 'rich_message':
    case 'poll':
    case 'contact':
    case 'location':
      return false;
    default: {
      const unhandledContent: never = content;
      throw new Error(`Unhandled message content: ${JSON.stringify(unhandledContent)}`);
    }
  }
}

/**
 * Whether a message's content is captioned media, rather than text, a rich message, a poll, a
 * contact, a location, or a service message.
 */
export function isCaptionedMediaContent(
  content: ChatMessageContent,
): content is CaptionedMediaContent {
  switch (content.kind) {
    case 'photo':
    case 'document':
    case 'video':
    case 'voice':
    case 'audio':
      return true;
    case 'text':
    case 'rich_message':
    case 'poll':
    case 'contact':
    case 'location':
    case 'members_joined':
    case 'member_left':
    case 'title_changed':
    case 'message_pinned':
    case 'users_shared':
    case 'chat_shared':
      return false;
    default: {
      const unhandledContent: never = content;
      throw new Error(`Unhandled message content: ${JSON.stringify(unhandledContent)}`);
    }
  }
}

/**
 * The text a message's content carries: the text of a text message, or the caption of captioned
 * media, which is empty when it has none. As TDLib's `get_message_content_text` has none for
 * them, a rich message, a contact, a location, and a service message carry no text; it reads only
 * the description of a poll, which the emulator does not support, so a poll carries none either.
 */
export function getContentText(content: ChatMessageContent): FormattedText {
  if (isCaptionedMediaContent(content)) {
    return content.caption;
  }
  switch (content.kind) {
    case 'text':
      return content;
    case 'rich_message':
    case 'poll':
    case 'contact':
    case 'location':
    case 'members_joined':
    case 'member_left':
    case 'title_changed':
    case 'message_pinned':
    case 'users_shared':
    case 'chat_shared':
      return { text: '', entities: [] };
    default: {
      const unhandledContent: never = content;
      throw new Error(`Unhandled message content: ${JSON.stringify(unhandledContent)}`);
    }
  }
}

/**
 * Whether a message's text, caption, or rich message mentions a user: by a text mention of the
 * user, or by a mention of the user's username, ignoring letter case. Mentions are the entities
 * Telegram detects in stored text, so an `@username` that runs into further letters or digits, or
 * lies in code, a link, or a URL, is none.
 */
export function mentionsUser(
  content: SupergroupMessageContent,
  user: { readonly id: number; readonly username?: string },
): boolean {
  if (content.kind === 'rich_message') {
    return richMessageMentionsUser(content, user);
  }
  const { text, entities } = getContentText(content);
  // Usernames and the mentions Telegram detects consist of ASCII letters, digits and underscores.
  const username = user.username?.toLowerCase();
  return entities.some((entity) => {
    switch (entity.type) {
      case 'text_mention':
        return entity.userId === user.id;
      case 'mention':
        return username !== undefined &&
          text.slice(entity.offset + 1, entity.offset + entity.length).toLowerCase() === username;
      default:
        return false;
    }
  });
}

/**
 * A quoted part of the text or caption of the message a message replies to, as Telegram shows it
 * with the reply.
 */
export interface TextQuote {
  /** The quoted text, which keeps only the entities Telegram allows in quotes. */
  readonly text: FormattedText;
  /** Where the quote starts in the replied text, in UTF-16 code units. */
  readonly position: number;
  /** Whether the sender chose the quote, rather than Telegram quoting the replied message. */
  readonly isManual: boolean;
}

/** A supergroup message, as other chats refer to it: by its chat and its ID there. */
export interface SupergroupMessageReference {
  readonly chatId: number;
  /** The supergroup's ID of the message, which every member sees. */
  readonly messageId: number;
}

/**
 * The message of another chat that a message replies to, as the reply keeps it when it is sent:
 * who first wrote it and when, the supergroup message it is, and its media. The replied text or
 * caption is instead shown as the reply's quote.
 */
export interface ExternalReply {
  /** Where the replied message first appeared, as a forward of it would show. */
  readonly origin: MessageForwardInfo;
  /**
   * The replied message when it is a supergroup message; omitted for a private message, whose
   * chat and ID Telegram does not show in other chats.
   */
  readonly supergroupMessage?: SupergroupMessageReference;
  /** What the reply shows of the replied content besides its text; omitted for none. */
  readonly media?: ExternalReplyMedia;
}

/**
 * What a reply to a message of another chat shows of the replied content besides its text: media
 * without its caption, a poll as it is now, a contact, or a location. TDLib's
 * `is_supported_reply_message_content` lists them all, and the Bot API's `ExternalReplyInfo` has a
 * field for each.
 */
export type ExternalReplyMedia =
  | CaptionedMediaContent
  | PollMessageContent
  | ContactMessageContent
  | LocationMessageContent;

/**
 * A canonical message of a private conversation: one either participant wrote, or a service
 * message recording a pin that either participant made, or the users or chat the account shared.
 */
export interface PrivateMessage {
  readonly kind: 'private_message';
  readonly id: CanonicalMessageId;
  readonly conversation: PrivateConversationKey;
  readonly authorRole: PrivateConversationRole;
  readonly sentAtUnixSeconds: number;
  readonly content: PrivateMessageContent;
  /** The message of the same conversation this one replies to; omitted when it is no reply. */
  readonly replyToMessageId?: CanonicalMessageId;
  /** The message of another chat this one replies to; omitted when it replies to none. */
  readonly externalReply?: ExternalReply;
  /** The quoted part of the replied message; omitted for a reply without one, or no reply. */
  readonly quote?: TextQuote;
  /** The album the message belongs to; omitted for a message outside albums. */
  readonly mediaGroupId?: MediaGroupId;
  /**
   * Omitted when the message has no inline keyboard. Bots attach inline keyboards to their messages,
   * and inline bots to messages sent through them.
   */
  readonly inlineKeyboard?: InlineKeyboard;
  /** Omitted for a message not sent through a bot's inline mode. Only accounts send them. */
  readonly viaBot?: ViaBot;
  /** Omitted for a message that is no forward. */
  readonly forwardInfo?: MessageForwardInfo;
  /**
   * The change of the account client's reply interface the message carries: a reply keyboard or
   * forced reply to show, or the removal of a reply keyboard; omitted for none. Only bots send
   * one, and never with an inline keyboard. It stays with the message after the client stops
   * showing the interface, since, as in TDLib, it makes the message impossible to edit.
   */
  readonly replyInterfaceMarkup?: ReplyInterfaceMarkup;
  /**
   * When the text or caption was last edited; omitted for a message whose content was never
   * edited.
   */
  readonly contentEditedAtUnixSeconds?: number;
  /** Whether the sender protected the message from forwarding and saving. Only bots protect. */
  readonly isContentProtected: boolean;
  /** As `SupergroupMessage` describes it. */
  readonly isSilent: boolean;
  /** As `SupergroupMessage` describes it. */
  readonly isPinned: boolean;
  /**
   * The decimal text of the 64-bit identifier of the message effect clients play with the
   * message; omitted for none. Only bots add effects, which Telegram allows only in private chats.
   */
  readonly messageEffectId?: string;
}

/**
 * The member of a supergroup who wrote a message there, or made the change a service message
 * records: an account or a bot.
 */
export type SupergroupMessageAuthor =
  | { readonly kind: 'account'; readonly accountId: number }
  | { readonly kind: 'bot'; readonly botId: number };

/**
 * A canonical message of a supergroup: one that a member wrote, or a service message recording a
 * change of the supergroup or a pin, which its author made.
 */
export interface SupergroupMessage {
  readonly kind: 'supergroup_message';
  readonly id: CanonicalMessageId;
  readonly chatId: number;
  readonly author: SupergroupMessageAuthor;
  readonly sentAtUnixSeconds: number;
  readonly content: SupergroupMessageContent;
  /** The message of the same supergroup this one replies to; omitted when it is no reply. */
  readonly replyToMessageId?: CanonicalMessageId;
  /** The message of another chat this one replies to; omitted when it replies to none. */
  readonly externalReply?: ExternalReply;
  /** The quoted part of the replied message; omitted for a reply without one, or no reply. */
  readonly quote?: TextQuote;
  /** The album the message belongs to; omitted for a message outside albums. */
  readonly mediaGroupId?: MediaGroupId;
  /**
   * Omitted when the message has no inline keyboard. Bots attach inline keyboards to their messages,
   * and inline bots to messages sent through them.
   */
  readonly inlineKeyboard?: InlineKeyboard;
  /** Omitted for a message not sent through a bot's inline mode. Only accounts send them. */
  readonly viaBot?: ViaBot;
  /** Omitted for a message that is no forward. */
  readonly forwardInfo?: MessageForwardInfo;
  /**
   * The change of the reply interface of the members' clients that the message carries, as
   * `PrivateMessage` describes it; its selectivity chooses the members it applies to.
   */
  readonly replyInterfaceMarkup?: ReplyInterfaceMarkup;
  /**
   * When the text or caption was last edited; omitted for a message whose content was never
   * edited.
   */
  readonly contentEditedAtUnixSeconds?: number;
  /** Whether the sender protected the message from forwarding and saving. Only bots protect. */
  readonly isContentProtected: boolean;
  /**
   * Whether the sender asked for the message to notify its recipients without sound, as the Bot
   * API's `disable_notification` does. Only bots send silently.
   */
  readonly isSilent: boolean;
  /**
   * Whether the message is one of its chat's pinned messages, as Telegram's `pinned` flag of a
   * message shows it. A chat pins any number of messages; deleting a message unpins it.
   */
  readonly isPinned: boolean;
  /**
   * The members' reactions to the message, one entry per reacting user, in the order the users
   * last changed them; omitted while nobody reacts. Edits keep them, and deleting the message
   * deletes them.
   */
  readonly reactions?: readonly UserReaction[];
}

/** A canonical message of any chat the emulator supports. */
export type ChatMessage = PrivateMessage | SupergroupMessage;

/**
 * The bot whose buttons a message carries, which receives the callback queries of their presses:
 * the inline bot of a message sent through one, otherwise the bot that wrote the message. Returns
 * `undefined` for an account's own message, which carries no buttons.
 */
export function getInlineKeyboardOwnerId(message: ChatMessage): number | undefined {
  if (message.viaBot !== undefined) {
    return message.viaBot.botId;
  }
  switch (message.kind) {
    case 'private_message':
      return message.authorRole === 'bot' ? message.conversation.botId : undefined;
    case 'supergroup_message':
      return message.author.kind === 'bot' ? message.author.botId : undefined;
    default: {
      const unhandledMessage: never = message;
      throw new Error(`Unhandled message: ${JSON.stringify(unhandledMessage)}`);
    }
  }
}

/**
 * Whether a bot may edit a message it has found, by its chat or by its inline message identifier,
 * as TDLib's `can_edit_message` decides for bots. The inline bot edits a message sent through it,
 * whoever sent it, and no other bot does; otherwise, a bot edits only its own messages. No one
 * edits a forward, or a message whose reply markup is not an inline keyboard, such as a keyboard
 * removal or a keyboard the client no longer shows.
 */
export function canBotEditMessage(message: ChatMessage, botId: number): boolean {
  if (message.forwardInfo !== undefined || message.replyInterfaceMarkup !== undefined) {
    return false;
  }
  if (message.viaBot !== undefined) {
    return message.viaBot.botId === botId;
  }
  switch (message.kind) {
    case 'private_message':
      return message.authorRole === 'bot' && message.conversation.botId === botId;
    case 'supergroup_message':
      return message.author.kind === 'bot' && message.author.botId === botId;
    default: {
      const unhandledMessage: never = message;
      throw new Error(`Unhandled message: ${JSON.stringify(unhandledMessage)}`);
    }
  }
}

/**
 * Whether an account may edit a message it has found, as TDLib's `can_edit_message` decides for a
 * user: only a message the account wrote, other than a service message, a forward, or a message
 * sent through an inline bot, which only that bot edits.
 */
export function canAccountEditMessage(message: ChatMessage, accountId: number): boolean {
  if (
    !isContentMessage(message) || message.forwardInfo !== undefined ||
    message.viaBot !== undefined
  ) {
    return false;
  }
  switch (message.kind) {
    case 'private_message':
      return message.authorRole === 'account' && message.conversation.accountId === accountId;
    case 'supergroup_message':
      return message.author.kind === 'account' && message.author.accountId === accountId;
    default: {
      const unhandledMessage: never = message;
      throw new Error(`Unhandled message: ${JSON.stringify(unhandledMessage)}`);
    }
  }
}

/** The account or bot that wrote a message, or made the change a service message records. */
export function getMessageAuthorId(message: ChatMessage): number {
  switch (message.kind) {
    case 'private_message':
      return message.authorRole === 'account'
        ? message.conversation.accountId
        : message.conversation.botId;
    case 'supergroup_message':
      return message.author.kind === 'account' ? message.author.accountId : message.author.botId;
    default: {
      const unhandledMessage: never = message;
      throw new Error(`Unhandled message: ${JSON.stringify(unhandledMessage)}`);
    }
  }
}

/** The notification an account's client shows for a message, as TDLib's `notification` does. */
export interface MessageNotification {
  /** Whether the notification plays no sound, which the message's sender asked for. */
  readonly isSilent: boolean;
}

/**
 * The notification a message of its chat gives an account, as TDLib notifies of new messages:
 * every message another participant sent notifies, silently when its sender asked for that.
 * Returns `undefined` for the account's own message. Accounts have no notification settings, such
 * as muted chats, and read messages keep their notifications.
 */
export function getMessageNotification(
  message: ChatMessage,
  accountId: number,
): MessageNotification | undefined {
  return getMessageAuthorId(message) === accountId ? undefined : { isSilent: message.isSilent };
}

/** A supergroup message that shows content its author wrote, rather than a service message. */
export type SupergroupContentMessage = SupergroupMessage & { readonly content: MessageContent };

/** Whether a supergroup message shows content its author wrote, which only such a message has. */
export function isSupergroupContentMessage(
  message: SupergroupMessage,
): message is SupergroupContentMessage {
  return !isServiceContent(message.content);
}

/** A private message that shows content its author wrote, rather than a service message. */
export type PrivateContentMessage = PrivateMessage & { readonly content: MessageContent };

/** Whether a private message shows content its author wrote, which only such a message has. */
export function isPrivateContentMessage(
  message: PrivateMessage,
): message is PrivateContentMessage {
  return !isServiceContent(message.content);
}

/** A message of any chat that shows content its author wrote, rather than a service message. */
export type ContentMessage = PrivateContentMessage | SupergroupContentMessage;

/** Whether a message of any chat shows content its author wrote. */
export function isContentMessage(message: ChatMessage): message is ContentMessage {
  return message.kind === 'private_message'
    ? isPrivateContentMessage(message)
    : isSupergroupContentMessage(message);
}

/**
 * Whether a message's content is protected from forwarding and saving, as TDLib's
 * `get_message_has_protected_content` decides: its sender protected it, or its chat protects all
 * content, which only a supergroup's owner can make it do.
 */
export function hasProtectedContent(message: ChatMessage, chatProtectsContent: boolean): boolean {
  return message.isContentProtected || chatProtectsContent;
}
