/**
 * Wire facts of the messages the account routes show: a private message as the conversation's bot
 * sees it, and a supergroup message as the requesting account sees it. Both are Telegram's
 * `Message`, so their schemas carry its name, which the OpenAPI document's descriptions of them
 * carry too.
 *
 * Each type is declared beside its schema, which it annotates: readers read any kind's fields
 * from a message of unknown kind, as each kind declares the others' fields absent, and a message's
 * rich message nests without bound, neither of which zod infers.
 */
import { z } from 'zod';

import { accountProfileSchema } from './accounts.ts';
import { messageSenderBotSchema } from './bots.ts';
import type {
  AbsentFields,
  ExclusiveAlternatives,
  FieldNameOfAnyKind,
} from './exclusive_alternatives.ts';
import {
  type Invoice,
  invoiceSchema,
  type SuccessfulPayment,
  successfulPaymentSchema,
} from './invoices.ts';
import { type InlineKeyboardMarkup, inlineKeyboardMarkupSchema } from './keyboard_buttons.ts';
import { messageEntitySchema } from './message_entities.ts';
import {
  type Audio,
  audioSchema,
  type Contact,
  contactSchema,
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
import { pollSchema } from './polls.ts';
import type { ReadonlySnapshot } from './readonly_snapshot.ts';
import { type RichMessage, richMessageSchema } from './rich_messages.ts';
import {
  sharedLocationSchema,
  supergroupChatIdSchema,
  TELEGRAM_TYPE_ANNOTATION,
  telegramUserIdSchema,
} from './wire_fields.ts';

/** A user as a message shows it: an account, as bots see it, or a bot. */
type MessageUser =
  | ReadonlySnapshot<z.output<typeof accountProfileSchema>>
  | ReadonlySnapshot<z.output<typeof messageSenderBotSchema>>;

/** A bot as a message sender, without the capabilities that only getMe reports. */
type MessageSenderBot = ReadonlySnapshot<z.output<typeof messageSenderBotSchema>>;

/** An entity Telegram detected in a message's text, or formatting its sender applied. */
type MessageEntity = ReadonlySnapshot<z.output<typeof messageEntitySchema>>;

/** A regular poll or a quiz a bot or an account sent, with its votes as they are now. */
type Poll = ReadonlySnapshot<z.output<typeof pollSchema>>;

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

/** The fields that show each kind of message content. */
interface MessageContentFields {
  readonly text: {
    readonly text: string;
    readonly entities?: readonly MessageEntity[];
  };
  readonly photo: {
    /** The photo's sizes, smallest first. */
    readonly photo: readonly PhotoSize[];
    /** Omitted for a photo without a caption. */
    readonly caption?: string;
    readonly caption_entities?: readonly MessageEntity[];
    /** Present when clients show the caption above the photo. */
    readonly show_caption_above_media?: true;
    /** Present when clients cover the photo until the user reveals it. */
    readonly has_media_spoiler?: true;
  };
  readonly document: {
    readonly document: Document;
    /** Omitted for a document without a caption. */
    readonly caption?: string;
    readonly caption_entities?: readonly MessageEntity[];
  };
  readonly video: {
    readonly video: Video;
    /** Omitted for a video without a caption. */
    readonly caption?: string;
    readonly caption_entities?: readonly MessageEntity[];
    /** Present when clients show the caption above the video. */
    readonly show_caption_above_media?: true;
    /** Present when clients cover the video until the user reveals it. */
    readonly has_media_spoiler?: true;
  };
  readonly voice: {
    readonly voice: Voice;
    /** Omitted for a voice note without a caption. */
    readonly caption?: string;
    readonly caption_entities?: readonly MessageEntity[];
  };
  readonly audio: {
    readonly audio: Audio;
    /** Omitted for an audio file without a caption. */
    readonly caption?: string;
    readonly caption_entities?: readonly MessageEntity[];
  };
  readonly rich_message: {
    /** A message a bot laid out in blocks, which only bots send. */
    readonly rich_message: RichMessage;
  };
  readonly poll: {
    /** A poll a bot or an account sent, with its votes as they are now. */
    readonly poll: Poll;
  };
  readonly contact: { readonly contact: Contact };
  readonly location: {
    /** A static location, whose accuracy Telegram keeps in whole meters. */
    readonly location: Location;
  };
}

/**
 * The fields that show what a message is: text, a photo, a document, a video, a voice note, an audio
 * file, a rich message, a poll, a contact, or a location. Each kind declares the others' fields absent, so that
 * any of them can be read from a message of unknown kind.
 */
export type MessageContent = ExclusiveAlternatives<MessageContentFields>;

/** The fields that show what a private message's sender wrote: content, or a bot's invoice. */
interface PrivateWrittenContentFields extends MessageContentFields {
  readonly invoice: {
    /** An invoice the conversation's bot sent, payable in Telegram Stars. */
    readonly invoice: Invoice;
  };
}

/**
 * The fields that show what a private message's sender wrote: any kind of `MessageContent`, or an
 * invoice, which only a private chat's bot sends. Each kind declares the others' fields absent.
 */
export type PrivateWrittenContent = ExclusiveAlternatives<PrivateWrittenContentFields>;

/** The fields of a service message's change of its chat, which content never has. */
interface NoServiceChange {
  readonly new_chat_participant?: never;
  readonly new_chat_member?: never;
  readonly new_chat_members?: never;
  readonly left_chat_participant?: never;
  readonly left_chat_member?: never;
  readonly new_chat_title?: never;
  readonly pinned_message?: never;
}

/** The fields of content, which a service message never has. */
type NoContent = AbsentFields<FieldNameOfAnyKind<MessageContentFields>>;

/** The field of an invoice, which a private service message never has. */
type NoInvoice = AbsentFields<'invoice'>;

/**
 * The fields of a service message about members joining or leaving a supergroup, which take the
 * place of content. As Telegram does, each change also carries its legacy fields.
 */
export type MembershipChangeContent =
  | (NoContent & {
    readonly new_chat_title?: never;
    readonly pinned_message?: never;
    /** Legacy alias of `new_chat_member`. */
    readonly new_chat_participant: MessageUser;
    /** Legacy: the requesting account if it joined, otherwise the first new member. */
    readonly new_chat_member: MessageUser;
    readonly new_chat_members: readonly MessageUser[];
    readonly left_chat_participant?: never;
    readonly left_chat_member?: never;
  })
  | (NoContent & {
    readonly new_chat_title?: never;
    readonly pinned_message?: never;
    readonly new_chat_participant?: never;
    readonly new_chat_member?: never;
    readonly new_chat_members?: never;
    /** Legacy alias of `left_chat_member`. */
    readonly left_chat_participant: MessageUser;
    /** The member that left or was removed. */
    readonly left_chat_member: MessageUser;
  });

/** The field of a service message about a supergroup's new title. */
export type TitleChangeContent =
  & NoContent
  & Omit<NoServiceChange, 'new_chat_title'>
  & { readonly new_chat_title: string };

/** A deleted message, which a pin's service message shows in place of the pinned message. */
export interface InaccessibleMessage<Chat> {
  readonly message_id: number;
  readonly chat: Chat;
  /** Always 0, which tells an inaccessible message apart from a message. */
  readonly date: 0;
}

/**
 * The field of a service message about a pin, which takes the place of content: the pinned
 * message as a reply shows it, or, once deleted, inaccessible.
 */
export type PinContent<Chat, PinnedMessage> =
  & NoContent
  & Omit<NoServiceChange, 'pinned_message'>
  & { readonly pinned_message: PinnedMessage | InaccessibleMessage<Chat> };

/**
 * The field of a service message about a pin as a replied message shows it, which leaves out a
 * deleted pinned message rather than show it inaccessible.
 */
export type RepliedPinContent<PinnedMessage> =
  & NoContent
  & Omit<NoServiceChange, 'pinned_message'>
  & { readonly pinned_message?: PinnedMessage };

/**
 * The fields of a service message about what an account sent a bot from its client, the users or
 * chat it shared, the data a Web App sent or its payment, which other private messages never have.
 */
interface NoAccountServiceContent {
  readonly user_shared?: never;
  readonly users_shared?: never;
  readonly chat_shared?: never;
  readonly web_app_data?: never;
  readonly successful_payment?: never;
}

/**
 * A user an account shared with a bot: the details the bot's request asked for, as they were when
 * the account shared it, each omitted when the user lacks it.
 */
export interface SharedUser {
  readonly user_id: number;
  readonly first_name?: string;
  readonly last_name?: string;
  readonly username?: string;
}

/**
 * The fields of a service message about users an account shared in answer to a `request_users`
 * button, which take the place of content. As Telegram does, a single shared user also shows as
 * the legacy `user_shared`, and `users_shared` keeps the legacy `user_ids`.
 */
export type UsersSharedContent =
  & NoContent
  & NoServiceChange
  & {
    /** Legacy form of a single shared user; omitted when several were shared. */
    readonly user_shared?: { readonly user_id: number; readonly request_id: number };
    readonly users_shared: {
      /** Legacy: the IDs of `users`. */
      readonly user_ids: readonly number[];
      /** The shared users, in the order the account chose them. */
      readonly users: readonly SharedUser[];
      /** The `request_id` of the button's request. */
      readonly request_id: number;
    };
    readonly chat_shared?: never;
    readonly web_app_data?: never;
    readonly successful_payment?: never;
  };

/**
 * The field of a service message about a supergroup an account shared in answer to a
 * `request_chat` button, which takes the place of content: the details the request asked for, as
 * they were when the account shared it, each omitted when the chat lacks it.
 */
export type ChatSharedContent =
  & NoContent
  & NoServiceChange
  & {
    readonly user_shared?: never;
    readonly users_shared?: never;
    readonly chat_shared: {
      readonly chat_id: number;
      readonly title?: string;
      readonly username?: string;
      /** The `request_id` of the button's request. */
      readonly request_id: number;
    };
    readonly web_app_data?: never;
    readonly successful_payment?: never;
  };

/**
 * The field of a service message about data that the Web App of a `web_app` reply keyboard button
 * sent the bot, which takes the place of content. Telegram does not vouch for either value: a
 * client may send any data with any button text.
 */
export type WebAppDataContent =
  & NoContent
  & NoServiceChange
  & {
    readonly user_shared?: never;
    readonly users_shared?: never;
    readonly chat_shared?: never;
    readonly web_app_data: {
      /** The text of the button that opened the Web App. */
      readonly button_text: string;
      /** The data the Web App sent, as it sent it. */
      readonly data: string;
    };
    readonly successful_payment?: never;
  };

/**
 * The field of a service message about an account's payment of the bot's invoice, which takes the
 * place of content.
 */
export type SuccessfulPaymentContent =
  & NoContent
  & NoServiceChange
  & {
    readonly user_shared?: never;
    readonly users_shared?: never;
    readonly chat_shared?: never;
    readonly web_app_data?: never;
    readonly successful_payment: SuccessfulPayment;
  };

/**
 * What a private message shows: content, a bot's invoice, a pin, the users or chat an account
 * shared, the data a Web App sent, or an account's payment of the bot's invoice.
 */
export type PrivateMessageContent =
  | (PrivateWrittenContent & NoServiceChange & NoAccountServiceContent)
  | (PinContent<PrivateChat, PinnedPrivateMessage> & NoAccountServiceContent & NoInvoice)
  | (UsersSharedContent & NoInvoice)
  | (ChatSharedContent & NoInvoice)
  | (WebAppDataContent & NoInvoice)
  | (SuccessfulPaymentContent & NoInvoice);

/**
 * What a private message shows as a replied message, as `RepliedPinContent` shows a pin, or the
 * users or chat an account shared, the data a Web App sent, or an account's payment.
 */
export type RepliedPrivateMessageContent =
  | (PrivateWrittenContent & NoServiceChange & NoAccountServiceContent)
  | (RepliedPinContent<PinnedPrivateMessage> & NoAccountServiceContent & NoInvoice)
  | (UsersSharedContent & NoInvoice)
  | (ChatSharedContent & NoInvoice)
  | (WebAppDataContent & NoInvoice)
  | (SuccessfulPaymentContent & NoInvoice);

/**
 * What a supergroup message shows: content, or a change of the supergroup's members or title, or
 * a pin.
 */
export type SupergroupMessageContent =
  | (MessageContent & NoServiceChange)
  | MembershipChangeContent
  | TitleChangeContent
  | PinContent<SupergroupChat, PinnedSupergroupMessage>;

/** What a supergroup message shows as a replied message, as `RepliedPinContent` shows a pin. */
export type RepliedSupergroupMessageContent =
  | (MessageContent & NoServiceChange)
  | MembershipChangeContent
  | TitleChangeContent
  | RepliedPinContent<PinnedSupergroupMessage>;

/** Who first sent a forwarded message, and when. */
export interface MessageOriginUser {
  readonly type: 'user';
  readonly sender_user: MessageUser;
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
 * The fields that show each kind of media of a message of another chat that a message replies to.
 */
interface ExternalReplyMediaFields {
  readonly poll: { readonly poll: Poll };
  readonly photo: {
    readonly photo: readonly PhotoSize[];
    /** Present when clients cover the photo until the user reveals it. */
    readonly has_media_spoiler?: true;
  };
  readonly document: { readonly document: Document };
  readonly video: {
    readonly video: Video;
    /** Present when clients cover the video until the user reveals it. */
    readonly has_media_spoiler?: true;
  };
  readonly voice: { readonly voice: Voice };
  readonly audio: { readonly audio: Audio };
  readonly contact: { readonly contact: Contact };
  readonly location: { readonly location: Location };
  readonly invoice: { readonly invoice: Invoice };
}

/**
 * A message of another chat that a message replies to: who first wrote it and when, the
 * supergroup message it is, and its media, if any, whose caption the reply's quote shows instead,
 * its poll as it is now, or its contact, location, or invoice.
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
    | AbsentFields<FieldNameOfAnyKind<ExternalReplyMediaFields>>
    | ExclusiveAlternatives<ExternalReplyMediaFields>
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
  readonly from: MessageUser;
  readonly chat: Chat;
  readonly date: number;
  /** Present once the message's author has edited its text or caption. */
  readonly edit_date?: number;
  /** Present for a forward. */
  readonly forward_origin?: MessageOrigin;
  /** Telegram's legacy form of the origin's sender, present for a forward of a user's message. */
  readonly forward_from?: MessageUser;
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

/** A pinned message, which is never a service message, as a reply shows a message. */
export type PinnedPrivateMessage =
  & MessageHeader<PrivateChat>
  & MessageReplyInfo
  & MessageAlbumInfo
  & PrivateWrittenContent
  & NoServiceChange
  & MessageTrailer;

/** A message as a reply shows it, without its own reply. */
export type RepliedPrivateMessage =
  & MessageHeader<PrivateChat>
  & MessageReplyInfo
  & MessageAlbumInfo
  & RepliedPrivateMessageContent
  & MessageTrailer;

/**
 * A private-chat message as the conversation's bot sees it: numbered in the bot's message box,
 * with the account as its chat, whichever participant wrote it, or a service message about a pin,
 * from the participant who pinned.
 */
export type PrivateMessage =
  & MessageHeader<PrivateChat>
  & {
    /** The message this one replies to, unless it was deleted; it never shows its own reply. */
    readonly reply_to_message?: RepliedPrivateMessage;
  }
  & MessageReplyInfo
  & MessageAlbumInfo
  & PrivateMessageContent
  & MessageTrailer;

/** A pinned supergroup message, which is never a service message, as a reply shows a message. */
export type PinnedSupergroupMessage =
  & MessageHeader<SupergroupChat>
  & MessageReplyInfo
  & MessageAlbumInfo
  & MessageContent
  & NoServiceChange
  & MessageTrailer;

/** A message as a reply shows it, without its own reply. */
export type RepliedSupergroupMessage =
  & MessageHeader<SupergroupChat>
  & MessageReplyInfo
  & MessageAlbumInfo
  & RepliedSupergroupMessageContent
  & MessageTrailer;

/**
 * A supergroup message as the requesting account sees it: numbered once by the supergroup, and
 * written by an account or a bot, or a service message about members joining or leaving, a new
 * title, or a pin, from the member who made the change. Members see the same message, apart from
 * the `file_id` of its file, whether a quiz shows its solution, and the legacy `new_chat_member`
 * of a service message.
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

const privateChatSchema = z.strictObject({
  id: telegramUserIdSchema,
  type: z.literal('private'),
  first_name: z.string(),
  last_name: z.string().optional(),
  username: z.string().optional(),
});

const supergroupChatSchema = z.strictObject({
  id: supergroupChatIdSchema,
  title: z.string(),
  username: z.string().min(1).optional(),
  type: z.literal('supergroup'),
});

const messageUserSchema = z.union([accountProfileSchema, messageSenderBotSchema]);

/** Where a forward, or the message of another chat a reply shows, first appeared. */
const messageOriginSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('user'),
    sender_user: messageUserSchema,
    date: z.int().nonnegative(),
  }),
  z.strictObject({
    type: z.literal('hidden_user'),
    sender_user_name: z.string().min(1),
    date: z.int().nonnegative(),
  }),
]);

/** The fields that precede a message's reply, for a chat of the given schema. */
function messageHeaderShape<Chat extends z.ZodType>(chat: Chat) {
  return {
    message_id: z.int().positive(),
    from: messageUserSchema,
    chat,
    date: z.int().nonnegative(),
    edit_date: z.int().nonnegative().optional(),
    forward_origin: messageOriginSchema.optional(),
    forward_from: messageUserSchema.optional(),
    forward_sender_name: z.string().min(1).optional(),
    forward_date: z.int().nonnegative().optional(),
  };
}

const captionShape = {
  caption: z.string().min(1).optional(),
  caption_entities: z.array(messageEntitySchema).min(1).optional(),
};

const textContentShape = {
  text: z.string(),
  entities: z.array(messageEntitySchema).min(1).optional(),
};

const photoContentShape = {
  photo: z.array(photoSizeSchema).min(1),
  ...captionShape,
  show_caption_above_media: z.literal(true).optional(),
  has_media_spoiler: z.literal(true).optional(),
};

const documentContentShape = { document: documentSchema, ...captionShape };

const videoContentShape = {
  video: videoSchema,
  ...captionShape,
  show_caption_above_media: z.literal(true).optional(),
  has_media_spoiler: z.literal(true).optional(),
};

const voiceContentShape = { voice: voiceSchema, ...captionShape };

const audioContentShape = { audio: audioSchema, ...captionShape };

const externalReplyShape = {
  origin: messageOriginSchema,
  chat: supergroupChatSchema.optional(),
  message_id: z.int().positive().optional(),
};

/** How a message replies to a message of another chat, and what it quotes of a replied message. */
const messageReplyInfoShape = {
  // The replied message's media, which only a photo, document, video, voice, or audio message has,
  // or its poll, contact, location, or invoice.
  external_reply: z.union([
    z.strictObject(externalReplyShape),
    z.strictObject({ ...externalReplyShape, poll: pollSchema }),
    z.strictObject({
      ...externalReplyShape,
      photo: z.array(photoSizeSchema).min(1),
      has_media_spoiler: z.literal(true).optional(),
    }),
    z.strictObject({ ...externalReplyShape, document: documentSchema }),
    z.strictObject({
      ...externalReplyShape,
      video: videoSchema,
      has_media_spoiler: z.literal(true).optional(),
    }),
    z.strictObject({ ...externalReplyShape, voice: voiceSchema }),
    z.strictObject({ ...externalReplyShape, audio: audioSchema }),
    z.strictObject({ ...externalReplyShape, contact: contactSchema }),
    z.strictObject({ ...externalReplyShape, location: sharedLocationSchema }),
    z.strictObject({ ...externalReplyShape, invoice: invoiceSchema }),
  ]).optional(),
  quote: z.strictObject({
    text: z.string().min(1),
    entities: z.array(messageEntitySchema).min(1).optional(),
    position: z.int().nonnegative(),
    is_manual: z.literal(true).optional(),
  }).optional(),
};

/** The album a message belongs to, which follows its reply and precedes its content. */
const messageAlbumInfoShape = {
  media_group_id: z.string().regex(/^[1-9]\d*$/).optional(),
};

const messageTrailerShape = {
  reply_markup: inlineKeyboardMarkupSchema.optional(),
  via_bot: messageSenderBotSchema.optional(),
  has_protected_content: z.literal(true).optional(),
  effect_id: z.string().regex(/^-?\d+$/).optional(),
};

/** The members a service message records joining a supergroup, with the legacy fields first. */
const membersJoinedContentShape = {
  new_chat_participant: messageUserSchema,
  new_chat_member: messageUserSchema,
  new_chat_members: z.array(messageUserSchema).min(1),
};

/** The member a service message records leaving a supergroup, with the legacy field first. */
const memberLeftContentShape = {
  left_chat_participant: messageUserSchema,
  left_chat_member: messageUserSchema,
};

/**
 * A message with the given fields before its content, of each content kind, with fields in the
 * order the server sends them.
 */
function contentMessageSchemas<Header extends z.ZodRawShape>(header: Header) {
  return [
    z.strictObject({ ...header, ...textContentShape, ...messageTrailerShape }),
    z.strictObject({ ...header, ...photoContentShape, ...messageTrailerShape }),
    z.strictObject({ ...header, ...documentContentShape, ...messageTrailerShape }),
    z.strictObject({ ...header, ...videoContentShape, ...messageTrailerShape }),
    z.strictObject({ ...header, ...voiceContentShape, ...messageTrailerShape }),
    z.strictObject({ ...header, ...audioContentShape, ...messageTrailerShape }),
    z.strictObject({ ...header, rich_message: richMessageSchema, ...messageTrailerShape }),
    z.strictObject({ ...header, poll: pollSchema, ...messageTrailerShape }),
    z.strictObject({ ...header, contact: contactSchema, ...messageTrailerShape }),
    z.strictObject({ ...header, location: sharedLocationSchema, ...messageTrailerShape }),
  ] as const;
}

/**
 * A private message with the given fields before its content, of each kind of content its sender
 * writes: as `contentMessageSchemas` reads them, or a bot's invoice.
 */
function privateWrittenMessageSchemas<Header extends z.ZodRawShape>(header: Header) {
  return [
    ...contentMessageSchemas(header),
    z.strictObject({ ...header, invoice: invoiceSchema, ...messageTrailerShape }),
  ] as const;
}

/**
 * A service message about a pin, with fields as the pinned message's schemas read them: the pinned
 * message, which is never a service message, as a reply shows it, or, once deleted, inaccessible.
 */
function pinServiceMessageSchema<
  Header extends z.ZodRawShape,
  PinnedMessageSchemas extends readonly z.ZodType[],
  ChatSchema extends z.ZodType,
>(header: Header, pinnedMessageSchemas: PinnedMessageSchemas, chatSchema: ChatSchema) {
  return z.strictObject({
    ...header,
    pinned_message: z.union([
      ...pinnedMessageSchemas,
      z.strictObject({
        message_id: z.int().positive(),
        chat: chatSchema,
        date: z.literal(0),
      }),
    ]),
    ...messageTrailerShape,
  });
}

/**
 * A service message about a pin as a replied message shows it, as `pinServiceMessageSchema` reads
 * it, but without a deleted pinned message, which the server leaves out there.
 */
function repliedPinServiceMessageSchema<
  Header extends z.ZodRawShape,
  PinnedMessageSchemas extends readonly z.ZodType[],
>(header: Header, pinnedMessageSchemas: PinnedMessageSchemas) {
  return z.strictObject({
    ...header,
    pinned_message: z.union(pinnedMessageSchemas).optional(),
    ...messageTrailerShape,
  });
}

/**
 * A service message about members joining or leaving, or about a new title, as
 * `contentMessageSchemas` reads others.
 */
function supergroupChangeMessageSchemas<Header extends z.ZodRawShape>(header: Header) {
  return [
    z.strictObject({ ...header, ...membersJoinedContentShape, ...messageTrailerShape }),
    z.strictObject({ ...header, ...memberLeftContentShape, ...messageTrailerShape }),
    z.strictObject({ ...header, new_chat_title: z.string().min(1), ...messageTrailerShape }),
  ] as const;
}

const sharedUserSchema = z.strictObject({
  user_id: z.int().positive(),
  first_name: z.string().min(1).optional(),
  last_name: z.string().min(1).optional(),
  username: z.string().min(1).optional(),
});

/**
 * A service message about what an account sent the bot from its client, as
 * `contentMessageSchemas` reads others: the users or the supergroup it shared, a single shared user
 * also showing as the legacy `user_shared`, the data a Web App sent, or its payment of the bot's
 * invoice.
 */
function accountServiceMessageSchemas<Header extends z.ZodRawShape>(header: Header) {
  return [
    z.strictObject({
      ...header,
      user_shared: z.strictObject({
        user_id: z.int().positive(),
        request_id: z.int(),
      }).optional(),
      users_shared: z.strictObject({
        user_ids: z.array(z.int().positive()).min(1),
        users: z.array(sharedUserSchema).min(1),
        request_id: z.int(),
      }),
      ...messageTrailerShape,
    }),
    z.strictObject({
      ...header,
      chat_shared: z.strictObject({
        chat_id: z.int().negative(),
        title: z.string().min(1).optional(),
        username: z.string().min(1).optional(),
        request_id: z.int(),
      }),
      ...messageTrailerShape,
    }),
    z.strictObject({
      ...header,
      web_app_data: z.strictObject({
        button_text: z.string().min(1),
        data: z.string().min(1),
      }),
      ...messageTrailerShape,
    }),
    z.strictObject({
      ...header,
      successful_payment: successfulPaymentSchema,
      ...messageTrailerShape,
    }),
  ] as const;
}

// A reply, which shows no reply of its own, comes between a message's header and content, as does
// a reply to another chat or a quote, which a replied message still shows.
const privateMessageHeader = {
  ...messageHeaderShape(privateChatSchema),
  ...messageReplyInfoShape,
  ...messageAlbumInfoShape,
};

const supergroupMessageHeader = {
  ...messageHeaderShape(supergroupChatSchema),
  ...messageReplyInfoShape,
  ...messageAlbumInfoShape,
};

/** The message a private message replies to, which never shows its own reply. */
function repliedPrivateMessage() {
  return z.union([
    ...privateWrittenMessageSchemas(privateMessageHeader),
    repliedPinServiceMessageSchema(
      privateMessageHeader,
      privateWrittenMessageSchemas(privateMessageHeader),
    ),
    ...accountServiceMessageSchemas(privateMessageHeader),
  ]).optional();
}

/** The message a supergroup message replies to, which never shows its own reply. */
function repliedSupergroupMessage() {
  return z.union([
    ...contentMessageSchemas(supergroupMessageHeader),
    ...supergroupChangeMessageSchemas(supergroupMessageHeader),
    repliedPinServiceMessageSchema(
      supergroupMessageHeader,
      contentMessageSchemas(supergroupMessageHeader),
    ),
  ]).optional();
}

/**
 * A private message, which may be a bot's invoice, or a service message about a pin, about users
 * or a chat an account shared, about data a Web App sent or about an account's payment, with its
 * replied message, which may be one too.
 */
export const privateMessageSchema: z.ZodType<PrivateMessage> = z.union([
  ...privateWrittenMessageSchemas({
    ...privateMessageHeader,
    reply_to_message: repliedPrivateMessage(),
  }),
  pinServiceMessageSchema(
    { ...privateMessageHeader, reply_to_message: repliedPrivateMessage() },
    privateWrittenMessageSchemas(privateMessageHeader),
    privateChatSchema,
  ),
  ...accountServiceMessageSchemas({
    ...privateMessageHeader,
    reply_to_message: repliedPrivateMessage(),
  }),
]).meta({ [TELEGRAM_TYPE_ANNOTATION]: 'Message' });

/**
 * A supergroup message, which service messages about changes of the supergroup and pins are among,
 * with its replied message, which may be one too.
 */
export const supergroupMessageSchema: z.ZodType<SupergroupMessage> = z.union([
  ...contentMessageSchemas({
    ...supergroupMessageHeader,
    reply_to_message: repliedSupergroupMessage(),
  }),
  ...supergroupChangeMessageSchemas({
    ...supergroupMessageHeader,
    reply_to_message: repliedSupergroupMessage(),
  }),
  pinServiceMessageSchema(
    { ...supergroupMessageHeader, reply_to_message: repliedSupergroupMessage() },
    contentMessageSchemas(supergroupMessageHeader),
    supergroupChatSchema,
  ),
]).meta({ [TELEGRAM_TYPE_ANNOTATION]: 'Message' });
