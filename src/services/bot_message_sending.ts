import type { BotApiPrivateMessage, BotApiSupergroupMessage } from '../types/bot_api.ts';
import type { FormerSupergroupMemberFailureReason } from '../types/chat_membership.ts';
import { isForwardable, type PrivateForwardNameLookup } from '../types/message_forward.ts';
import { createExternalReply, type ExternalReplyTarget } from '../types/message_reply.ts';
import { isUserId } from '../types/telegram_identity.ts';
import {
  type ChatActionChat,
  getBotChatActionChat,
  type PrivateConversationKey,
} from '../types/virtual_chat.ts';
import type {
  ChatMessage,
  MediaGroupId,
  MessageForwardInfo,
  PrivateMessage,
  SupergroupMessage,
} from '../types/virtual_message.ts';
import type {
  MessageTarget,
  ReplyTarget,
  SendDeliveryOptions,
  SendDestinationOptions,
  SendMediaGroupRequest,
  SendMediaGroupResult,
  SendRequestOptions,
  SendResult,
} from './bot_api.ts';
import type { MediaContent, OutgoingMessageContent, SpecifiedQuote } from './message_content.ts';
import type {
  GetMessageForBotInput,
  GetMessageForBotResult,
  SendBotAlbumInput,
  SendBotAlbumResult,
  SendBotMessageInput,
  SendBotMessageResult,
} from './private_messaging.ts';
import type {
  GetSupergroupMessageForBotInput,
  GetSupergroupMessageForBotResult,
  SendSupergroupBotAlbumInput,
  SendSupergroupBotAlbumResult,
  SendSupergroupBotMessageInput,
  SendSupergroupBotMessageResult,
} from './supergroup_messaging.ts';

interface PrivateBotMessaging {
  getMessageForBot(input: GetMessageForBotInput): GetMessageForBotResult;
  sendBotMessage(input: SendBotMessageInput): SendBotMessageResult;
  sendBotAlbum(input: SendBotAlbumInput): SendBotAlbumResult;
}

interface SupergroupBotMessaging {
  getMessageForBot(input: GetSupergroupMessageForBotInput): GetSupergroupMessageForBotResult;
  sendBotMessage(input: SendSupergroupBotMessageInput): SendSupergroupBotMessageResult;
  sendBotAlbum(input: SendSupergroupBotAlbumInput): SendSupergroupBotAlbumResult;
  lacksBotSendPermission(input: {
    readonly botId: number;
    readonly chatId: number;
    readonly content: OutgoingMessageContent;
  }): boolean;
}

interface BotMessageViews {
  viewPrivateMessageForBot(message: PrivateMessage): BotApiPrivateMessage;
  viewSupergroupMessage(message: SupergroupMessage, observerId: number): BotApiSupergroupMessage;
}

interface ChatActionEnding {
  endBotChatAction(input: { readonly botId: number; readonly chat: ChatActionChat }): void;
}

interface MessageDraftClearing {
  clearBotDraft(conversation: PrivateConversationKey): void;
}

interface BotMessageSenderDependencies {
  readonly botMessages: PrivateBotMessaging;
  readonly supergroupBotMessages: SupergroupBotMessaging;
  /** Shows the bot the messages it sent, as the Bot API answers with them. */
  readonly botMessageViews: BotMessageViews;
  /** Ends the chat action that a bot's message ends. */
  readonly chatActions: ChatActionEnding;
  /** Removes the message draft that a bot's message removes from a private chat. */
  readonly messageDrafts: MessageDraftClearing;
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
 * bot is no member of it, or the chat has no such message.
 */
type BotChatMessageLookupFailureReason =
  | 'chat_not_found'
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

/**
 * Sends a bot's messages and albums to its private chats and supergroups, each through the
 * messaging service of its chat, and shows the bot what it sent, as the Bot API answers with it.
 *
 * Every Bot API method that sends a message goes through here, so what a message replies to in
 * another chat is resolved alike for all of them, by the same lookup that finds the messages of
 * the bot's chats that forwards and copies repeat.
 */
export class BotMessageSender {
  readonly #botMessages: PrivateBotMessaging;
  readonly #supergroupBotMessages: SupergroupBotMessaging;
  readonly #botMessageViews: BotMessageViews;
  readonly #chatActions: ChatActionEnding;
  readonly #messageDrafts: MessageDraftClearing;
  readonly #getPrivateForwardName: PrivateForwardNameLookup;

  constructor(
    {
      botMessages,
      supergroupBotMessages,
      botMessageViews,
      chatActions,
      messageDrafts,
      getPrivateForwardName,
    }: BotMessageSenderDependencies,
  ) {
    this.#botMessages = botMessages;
    this.#supergroupBotMessages = supergroupBotMessages;
    this.#botMessageViews = botMessageViews;
    this.#chatActions = chatActions;
    this.#messageDrafts = messageDrafts;
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
    { replyTo, ...options }: SendRequestOptions,
    repetitionDetails: RepetitionDetails = {},
  ): SendResult {
    const replyResolution = this.#resolveOutgoingReply(botId, replyTo);
    if (!replyResolution.resolved) {
      return { sent: false, reason: replyResolution.reason };
    }
    const { reply } = replyResolution;
    const result = isUserId(options.chatId)
      ? this.#sendPrivateMessage(botId, content, options, reply, repetitionDetails)
      : this.#sendSupergroupMessage(botId, content, options, reply, repetitionDetails);
    if (result.sent) {
      this.#clearBotPreparationIndicators(botId, options.chatId);
    }
    return result;
  }

  /**
   * Sends media that passed `sendMediaGroup`'s checks to a private chat or a supergroup as an
   * album, each message as a reply to the same message, which is resolved as `send` resolves a
   * reply.
   */
  sendAlbum(
    botId: number,
    contents: readonly MediaContent[],
    { replyTo, ...options }: Omit<SendMediaGroupRequest, 'media'>,
  ): SendMediaGroupResult {
    const replyResolution = this.#resolveOutgoingReply(botId, replyTo);
    if (!replyResolution.resolved) {
      return { sent: false, reason: replyResolution.reason };
    }
    const result = isUserId(options.chatId)
      ? this.#sendPrivateAlbum(botId, contents, options, replyResolution.reply)
      : this.#sendSupergroupAlbum(botId, contents, options, replyResolution.reply);
    if (result.sent) {
      this.#clearBotPreparationIndicators(botId, options.chatId);
    }
    return result;
  }

  /**
   * Finds a message of one of the bot's chats, which the bot may repeat or reply to from another
   * chat. As on Telegram, a chat the bot cannot address is not found.
   */
  findBotChatMessage(botId: number, { chatId, messageId }: MessageTarget): BotChatMessageLookup {
    const lookup = isUserId(chatId)
      ? this.#botMessages.getMessageForBot({ botId, accountId: chatId, botMessageId: messageId })
      : this.#supergroupBotMessages.getMessageForBot({ botId, chatId, messageId });
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
      case 'message_not_found':
        return { found: false, reason };
      case 'account_not_found':
      case 'conversation_not_started':
        return { found: false, reason: 'chat_not_found' };
      case 'bot_not_found':
        throw new Error(`Authenticated bot ${botId} does not exist`);
      default: {
        const unhandledReason: never = reason;
        throw new Error(`Unhandled bot chat message lookup failure: ${unhandledReason}`);
      }
    }
  }

  /**
   * Whether the bot lacks a permission it needs to send content to a supergroup it is a member of,
   * as `SupergroupMessagingService.lacksBotSendPermission` decides; a private chat restricts no
   * content.
   */
  lacksSendPermission(botId: number, chatId: number, content: OutgoingMessageContent): boolean {
    return !isUserId(chatId) &&
      this.#supergroupBotMessages.lacksBotSendPermission({ botId, chatId, content });
  }

  /**
   * Ends what the bot showed in a chat while preparing the message it sent there: as TDLib's
   * `DialogActionManager` does, its chat action, and, as `updatePendingMessage` tells clients to
   * do on any incoming message, its message draft in a private chat.
   */
  #clearBotPreparationIndicators(botId: number, chatId: number): void {
    this.#chatActions.endBotChatAction({ botId, chat: getBotChatActionChat(botId, chatId) });
    if (isUserId(chatId)) {
      this.#messageDrafts.clearBotDraft({ accountId: chatId, botId });
    }
  }

  /**
   * Resolves what a message being sent replies to. The chat's messaging service looks up a message
   * of the chat itself. A message of another chat is resolved here, as the official Bot API
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

  #sendPrivateMessage(
    botId: number,
    content: OutgoingMessageContent,
    { chatId, isContentProtected, isSilent, messageEffectId, ...replyMarkup }:
      SendDestinationOptions,
    { replyTo, externalReply, quote }: OutgoingReply,
    { forwardInfo, mediaGroupId }: RepetitionDetails,
  ): SendResult {
    const result = this.#botMessages.sendBotMessage({
      ...replyMarkup,
      fromBotId: botId,
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
        throw new Error(`Authenticated bot ${botId} does not exist`);
      default: {
        const unhandledFailure: never = result;
        throw new Error(`Unhandled bot message failure: ${JSON.stringify(unhandledFailure)}`);
      }
    }
  }

  #sendSupergroupMessage(
    botId: number,
    content: OutgoingMessageContent,
    { chatId, isContentProtected, isSilent, messageEffectId, ...replyMarkup }:
      SendDestinationOptions,
    { replyTo, externalReply, quote }: OutgoingReply,
    { forwardInfo, mediaGroupId }: RepetitionDetails,
  ): SendResult {
    const result = this.#supergroupBotMessages.sendBotMessage({
      ...replyMarkup,
      fromBotId: botId,
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
        message: this.#botMessageViews.viewSupergroupMessage(result.message, botId),
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
        throw new Error(`Authenticated bot ${botId} does not exist`);
      default: {
        const unhandledFailure: never = result;
        throw new Error(`Unhandled bot message failure: ${JSON.stringify(unhandledFailure)}`);
      }
    }
  }

  #sendPrivateAlbum(
    botId: number,
    contents: readonly MediaContent[],
    { chatId, isContentProtected, isSilent, messageEffectId }: SendDeliveryOptions,
    { replyTo, externalReply, quote }: OutgoingReply,
  ): SendMediaGroupResult {
    const result = this.#botMessages.sendBotAlbum({
      fromBotId: botId,
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
      case 'album_audio_mixed':
        return { sent: false, reason: result.reason };
      // As for a single message, Telegram reports a user who has not started the bot as not found.
      case 'account_not_found':
      case 'conversation_not_started':
        return { sent: false, reason: 'chat_not_found' };
      case 'bot_not_found':
        throw new Error(`Authenticated bot ${botId} does not exist`);
      default: {
        const unhandledFailure: never = result;
        throw new Error(`Unhandled bot album failure: ${JSON.stringify(unhandledFailure)}`);
      }
    }
  }

  #sendSupergroupAlbum(
    botId: number,
    contents: readonly MediaContent[],
    { chatId, isContentProtected, isSilent, messageEffectId }: SendDeliveryOptions,
    { replyTo, externalReply, quote }: OutgoingReply,
  ): SendMediaGroupResult {
    const result = this.#supergroupBotMessages.sendBotAlbum({
      fromBotId: botId,
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
          this.#botMessageViews.viewSupergroupMessage(message, botId)
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
      case 'album_audio_mixed':
        return { sent: false, reason: result.reason };
      case 'bot_not_found':
        throw new Error(`Authenticated bot ${botId} does not exist`);
      default: {
        const unhandledFailure: never = result;
        throw new Error(`Unhandled bot album failure: ${JSON.stringify(unhandledFailure)}`);
      }
    }
  }
}
