import type { BotApiMessage } from '../../types/bot_api.ts';
import type { FormerSupergroupMemberFailureReason } from '../../types/chat_membership.ts';
import { isForwardable, type PrivateForwardNameLookup } from '../../types/message_forward.ts';
import { createExternalReply, type ExternalReplyTarget } from '../../types/message_reply.ts';
import { type ChatKey, getBotApiChatAddress, getBotChatKey } from '../../types/virtual_chat.ts';
import type {
  ChatMessage,
  FormattedText,
  MediaGroupId,
  MessageForwardInfo,
} from '../../types/virtual_message.ts';
import type { AlbumCompositionFailureReason } from '../../types/media_album.ts';
import type { BotMessageReplyMarkup } from '../../types/reply_interface.ts';
import type { BotUploadTooBigFailure } from '../../types/upload_profile.ts';
import type { FileTypeMismatchFailure, PhotoTooBigFailure } from '../domain/media_file.ts';
import type {
  CaptionNormalization,
  MediaContent,
  MessageTextNormalization,
  OutgoingMessageContent,
  SpecifiedCaption,
  SpecifiedQuote,
  TextInvalidFailure,
} from '../domain/message_content.ts';
import type { SpecifiedStarsInvoice } from '../domain/invoice_normalization.ts';
import { type InvoiceRefusal, isInvoiceRefusal } from '../../types/invoice.ts';
import type { PollLimitFailure } from '../domain/poll_normalization.ts';
import type {
  MessageSendingService,
  SendPermissionMissingFailure,
} from '../domain/message_sending.ts';
import type { GetMessageForBotInput, GetMessageForBotResult } from '../domain/private_messaging.ts';
import type {
  GetSupergroupMessageForBotInput,
  GetSupergroupMessageForBotResult,
} from '../domain/supergroup_messaging.ts';

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
/**
 * Where and how `sendInvoice` sends an invoice, and what it replies to. An invoice carries no reply
 * markup: Telegram's clients show their own Pay button on it.
 */
export type SendInvoiceOptions = SendDeliveryOptions & {
  /** Omitted for an invoice that replies to no message. */
  readonly replyTo?: ReplyTarget;
};

/**
 * An invoice a bot sent, as the bot sees it, or why it was not sent: as for any message, or because
 * it is an invoice that Telegram refuses, or one to a chat other than a private chat, where the
 * emulator does not send invoices.
 */
export type SendInvoiceResult =
  | SendResult
  | ({ readonly sent: false } & InvoiceRefusal)
  | { readonly sent: false; readonly reason: 'invoice_chat_not_private' };

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

interface PrivateChatMessageReading {
  getMessageForBot(input: GetMessageForBotInput): GetMessageForBotResult;
}

interface SupergroupMessageReading {
  getMessageForBot(input: GetSupergroupMessageForBotInput): GetSupergroupMessageForBotResult;
}

/** The sending that a bot's messages and albums go through, by the address of their chat. */
type BotMessageSending = Pick<
  MessageSendingService,
  'sendChatMessage' | 'sendChatAlbum' | 'sendBotPrivateChatInvoice' | 'lacksSendPermission'
>;

interface BotMessageViews {
  viewMessageForBot(message: ChatMessage, botId: number): BotApiMessage;
}

interface ChatActionEnding {
  endBotChatAction(input: { readonly botId: number; readonly chat: ChatKey }): void;
}

interface BotMessageSenderDependencies {
  /** Finds the messages of the bot's private chats, which the bot repeats or replies to. */
  readonly privateChatMessages: PrivateChatMessageReading;
  /** Finds the messages of the bot's supergroups, which the bot repeats or replies to. */
  readonly supergroupMessages: SupergroupMessageReading;
  readonly messageSending: BotMessageSending;
  /** Shows the bot the messages it sent, as the Bot API answers with them. */
  readonly botMessageViews: BotMessageViews;
  /** Ends the chat action that a bot's message ends. */
  readonly chatActions: ChatActionEnding;
  /** Hides the accounts whose privacy settings keep external replies from linking to them. */
  readonly getPrivateForwardName: PrivateForwardNameLookup;
}

/**
 * What a forward or copy shows beyond its content and reply markup: where a forward's content
 * first appeared, and the new album that a repeated message of an album belongs to.
 */
export interface RepetitionDetails {
  /** Omitted for a message that is no forward. */
  readonly forwardInfo?: MessageForwardInfo;
  /** Omitted for a message sent outside any album. */
  readonly mediaGroupId?: MediaGroupId;
}

/**
 * Why a message of one of the bot's chats cannot be read: its chat is unknown to the bot, or the
 * bot cannot address it, or the chat has no such message.
 */
type BotChatMessageLookupFailureReason =
  | 'chat_not_found'
  | BotPrivateChatAccessFailureReason
  | FormerSupergroupMemberFailureReason
  | 'message_not_found';

/** A message of one of the bot's chats, with whether its chat protects all content. */
export type BotChatMessageLookup =
  | {
    readonly found: true;
    readonly message: ChatMessage;
    /** Only a supergroup can protect all its content. */
    readonly chatProtectsContent: boolean;
  }
  | { readonly found: false; readonly reason: BotChatMessageLookupFailureReason };

/**
 * What a message being sent replies to: a message of its own chat, which sending looks up, or a
 * resolved message of another chat; neither for a message that replies to none. Sending finds the
 * chosen quote in the replied message.
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

/**
 * Sends a bot's messages and albums to its private chats and supergroups, each to the chat its
 * Bot API `chat_id` addresses, and shows the bot what it sent, as the Bot API answers with it.
 *
 * Every Bot API method that sends a message goes through here, so what a message replies to in
 * another chat is resolved alike for all of them, by the same lookup that finds the messages of
 * the bot's chats that forwards and copies repeat.
 */
/**
 * Where and how an album is sent: every message of it alike, each replying to the same message;
 * none has reply markup, which the Bot API does not read for albums.
 */
export type SendAlbumOptions = SendDeliveryOptions & {
  /** Omitted for an album that replies to no message. */
  readonly replyTo?: ReplyTarget;
};

/**
 * What the Bot API's sending methods use beyond the session's other services: the sender of the
 * bot's messages, the session's normalization of the text a bot sends, which they apply before
 * they send an album or show a draft, and the clock that poll closing dates count from.
 */
export interface BotMessageSendingWorkflows {
  readonly sender: BotMessageSender;
  /** Normalizes a caption of an album, which is checked before the album is handed to sending. */
  readonly normalizeBotCaption: (caption: SpecifiedCaption) => CaptionNormalization;
  /** Normalizes a draft's text as TDLib does before a draft is shown. */
  readonly normalizeBotDraftText: (text: FormattedText) => MessageTextNormalization;
  /** The time that closing times of polls count from. */
  readonly currentUnixTimeSeconds: () => number;
}

export class BotMessageSender {
  readonly #privateChatMessages: PrivateChatMessageReading;
  readonly #supergroupMessages: SupergroupMessageReading;
  readonly #messageSending: BotMessageSending;
  readonly #botMessageViews: BotMessageViews;
  readonly #chatActions: ChatActionEnding;
  readonly #getPrivateForwardName: PrivateForwardNameLookup;

  constructor(
    {
      privateChatMessages,
      supergroupMessages,
      messageSending,
      botMessageViews,
      chatActions,
      getPrivateForwardName,
    }: BotMessageSenderDependencies,
  ) {
    this.#privateChatMessages = privateChatMessages;
    this.#supergroupMessages = supergroupMessages;
    this.#messageSending = messageSending;
    this.#botMessageViews = botMessageViews;
    this.#chatActions = chatActions;
    this.#getPrivateForwardName = getPrivateForwardName;
  }

  /**
   * Sends content to a private chat or a supergroup; a forward also shows where it came from, and
   * a repeated message of an album belongs to the album its repetition forms.
   *
   * A reply to a message of another chat is resolved before the chat the message goes to, while
   * Telegram checks that chat and the text first; a request that fails both ways fails for its
   * reply.
   */
  send(
    botId: number,
    content: OutgoingMessageContent,
    { replyTo, chatId, isContentProtected, isSilent, messageEffectId, ...replyMarkup }:
      SendRequestOptions,
    { forwardInfo, mediaGroupId }: RepetitionDetails = {},
  ): SendResult {
    const replyResolution = this.#resolveOutgoingReply(botId, replyTo);
    if (!replyResolution.resolved) {
      return { sent: false, reason: replyResolution.reason };
    }
    const chat = getBotApiChatAddress(chatId);
    const result = this.#messageSending.sendChatMessage({
      ...replyMarkup,
      fromBotId: botId,
      chat,
      content,
      ...replyResolution.reply,
      isContentProtected,
      isSilent,
      forwardInfo,
      mediaGroupId,
      messageEffectId,
    });
    if (!result.sent) {
      return result.reason === 'text_invalid' || result.reason === 'send_permission_missing'
        ? result
        : { sent: false, reason: excludeMissingSenderFailure(botId, result.reason) };
    }
    const message = this.#botMessageViews.viewMessageForBot(result.message, botId);
    // As TDLib's `DialogActionManager` does, a bot's message ends its chat action.
    this.#chatActions.endBotChatAction({ botId, chat: getBotChatKey(botId, chat) });
    return { sent: true, message };
  }

  /**
   * Sends media that passed `sendMediaGroup`'s checks to a private chat or a supergroup as an
   * album, each message as a reply to the same message, which is resolved as `send` resolves a
   * reply.
   */
  sendAlbum(
    botId: number,
    contents: readonly MediaContent[],
    { replyTo, chatId, isContentProtected, isSilent, messageEffectId }: SendAlbumOptions,
  ): SendMediaGroupResult {
    const replyResolution = this.#resolveOutgoingReply(botId, replyTo);
    if (!replyResolution.resolved) {
      return { sent: false, reason: replyResolution.reason };
    }
    const chat = getBotApiChatAddress(chatId);
    const result = this.#messageSending.sendChatAlbum({
      fromBotId: botId,
      chat,
      contents,
      ...replyResolution.reply,
      isContentProtected,
      isSilent,
      messageEffectId,
    });
    if (!result.sent) {
      return result.reason === 'text_invalid' || result.reason === 'send_permission_missing'
        ? result
        : { sent: false, reason: excludeMissingSenderFailure(botId, result.reason) };
    }
    const messages = result.messages.map((message) =>
      this.#botMessageViews.viewMessageForBot(message, botId)
    );
    // As for a single message, the album ends the bot's chat action.
    this.#chatActions.endBotChatAction({ botId, chat: getBotChatKey(botId, chat) });
    return { sent: true, messages };
  }

  /**
   * Sends an invoice for payment in Telegram Stars to the bot's private chat with an account, which
   * replies as `send` resolves a reply. The emulator sends invoices only to private chats, and
   * refuses another chat before anything else.
   */
  sendInvoice(
    botId: number,
    invoice: SpecifiedStarsInvoice,
    { replyTo, chatId, isContentProtected, isSilent, messageEffectId }: SendInvoiceOptions,
  ): SendInvoiceResult {
    const chat = getBotApiChatAddress(chatId);
    if (chat.type !== 'private') {
      return { sent: false, reason: 'invoice_chat_not_private' };
    }
    const replyResolution = this.#resolveOutgoingReply(botId, replyTo);
    if (!replyResolution.resolved) {
      return { sent: false, reason: replyResolution.reason };
    }
    const result = this.#messageSending.sendBotPrivateChatInvoice({
      fromBotId: botId,
      chat,
      invoice,
      ...replyResolution.reply,
      isContentProtected,
      isSilent,
      messageEffectId,
    });
    if (!result.sent) {
      return isInvoiceRefusal(result)
        ? result
        : { sent: false, reason: excludeMissingSenderFailure(botId, result.reason) };
    }
    const message = this.#botMessageViews.viewMessageForBot(result.message, botId);
    // As for any message, the invoice ends the bot's chat action.
    this.#chatActions.endBotChatAction({ botId, chat: getBotChatKey(botId, chat) });
    return { sent: true, message };
  }

  /** Finds a message of one of the bot's chats, which the bot may repeat or reply to from another chat. */
  findBotChatMessage(botId: number, { chatId, messageId }: MessageTarget): BotChatMessageLookup {
    const chat = getBotApiChatAddress(chatId);
    if (chat.type === 'private') {
      const lookup = this.#privateChatMessages.getMessageForBot({ botId, chat, messageId });
      return lookup.found
        ? { found: true, message: lookup.message, chatProtectsContent: false }
        : { found: false, reason: excludeMissingSenderFailure(botId, lookup.reason) };
    }
    const lookup = this.#supergroupMessages.getMessageForBot({ botId, chat, messageId });
    return lookup.found
      ? {
        found: true,
        message: lookup.message,
        chatProtectsContent: lookup.supergroup.hasProtectedContent,
      }
      : { found: false, reason: excludeMissingSenderFailure(botId, lookup.reason) };
  }

  /**
   * Whether the bot lacks a permission it needs to send content to a chat, as
   * `MessageSendingService.lacksSendPermission` decides: only a supergroup restricts content.
   */
  lacksSendPermission(botId: number, chatId: number, content: OutgoingMessageContent): boolean {
    return this.#messageSending.lacksSendPermission({
      botId,
      chat: getBotApiChatAddress(chatId),
      content,
    });
  }

  /**
   * Resolves what a message being sent replies to. Sending looks up a message of the chat itself. A message of another chat is resolved here, as the official Bot API
   * server's `check_reply_parameters` does: the bot must be able to read that chat, and a message it
   * does not find fails the send unless the bot allowed sending without a reply. As TDLib's
   * `create_message_input_reply_to` does, a message that cannot be forwarded, such as protected
   * content or a service message, is silently not replied to.
   */
  #resolveOutgoingReply(botId: number, replyTo: ReplyTarget | undefined):
    | { readonly resolved: true; readonly reply: OutgoingReply }
    | {
      readonly resolved: false;
      readonly reason:
        | 'chat_not_found'
        | BotPrivateChatAccessFailureReason
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
    const lookup = this.findBotChatMessage(botId, { chatId, messageId });
    if (!lookup.found) {
      if (lookup.reason !== 'message_not_found') {
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
}

/**
 * Leaves out the failure a sending bot never meets: the bot the Bot API authenticated exists. A
 * bot's other failures stay as sending reports them, for the Bot API to present.
 */
function excludeMissingSenderFailure<Reason extends string>(
  botId: number,
  reason: Reason | 'bot_not_found',
): Reason {
  if (reason === 'bot_not_found') {
    throw new Error(`Authenticated bot ${botId} does not exist`);
  }
  return reason;
}
