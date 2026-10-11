import type { ChatDomainEvent } from '../types/chat_domain_event.ts';
import {
  type ChatMembership,
  getEffectiveChatPermissions,
  resolveSupergroupBotMembership,
  type SupergroupBotAccessFailureReason,
  type SupergroupMembershipLookup,
} from '../types/chat_membership.ts';
import { supergroupMessagePolicy } from '../types/chat_policy.ts';
import {
  type ChatPermissions,
  getContentSendPermissions,
  type PermissionGovernedContent,
} from '../types/chat_permissions.ts';
import type { InlineKeyboard } from '../types/inline_keyboard.ts';
import { type AlbumCompositionFailureReason, formsAlbum } from '../types/media_album.ts';
import type { ExternalReplyTarget } from '../types/message_reply.ts';
import type { MessageForward } from '../types/message_forward.ts';
import {
  appliesReplyInterfaceTo,
  type BotMessageReplyMarkup,
  type ReplyInterface,
  type ReplyKeyboardButtonSelectionFailureReason,
  selectReplyKeyboardButton,
} from '../types/reply_interface.ts';
import type { VirtualAccount } from '../types/virtual_account.ts';
import type { VirtualBot } from '../types/virtual_bot.ts';
import type { ChatActor, Supergroup, SupergroupChatKey } from '../types/virtual_chat.ts';
import {
  type CanonicalMessageId,
  getMessageSenderId,
  type MediaGroupId,
  mentionsUser,
  type MessageContent,
  type MessageForwardInfo,
  type NewSupergroupMessage,
  type SupergroupMessage,
  type SupergroupMessageSender,
  type SupergroupServiceContent,
} from '../types/virtual_message.ts';
import type { FormattedTextFixingContext } from '../text_entities/formatted_text.ts';
import {
  type AccountAlbumMediaContent,
  type AccountMessageContent,
  type ContentNormalizationFailure,
  type ContentTextNormalizationFailure,
  type FileUploadStore,
  getReplyQuoteSource,
  hasOnlyValidButtonCallbackData,
  hasWebAppButton,
  type MediaContent,
  type NewPollStore,
  type NormalizedOutgoingContent,
  normalizeOutgoingAlbum,
  normalizeOutgoingContent,
  type OutgoingContentNormalization,
  type OutgoingMessageContent,
  resolveReplyQuote,
  type SpecifiedQuote,
  storeOutgoingContent,
  toOutgoingAccountContent,
  toOutgoingAccountMedia,
} from './message_content.ts';
import { createSessionUserMentionContext } from './session_user_mention.ts';

/**
 * Why a member cannot send content: it lacks a permission the content needs, as
 * `getContentSendPermissions` lists them, which Telegram reports by the kind of content.
 */
export interface SendPermissionMissingFailure {
  readonly reason: 'send_permission_missing';
  readonly contentKind: PermissionGovernedContent['kind'];
}

export interface SendSupergroupAccountMessageInput {
  readonly fromAccountId: number;
  readonly chatId: number;
  readonly content: AccountMessageContent;
  /** The supergroup's ID of the message to reply to; omitted for no reply. */
  readonly replyToMessageId?: number;
}

export type SendSupergroupAccountMessageFailureReason =
  | 'account_not_found'
  | 'chat_not_found'
  | 'not_a_member'
  | 'message_text_empty'
  | 'account_phone_number_missing'
  | 'reply_message_not_found';

export type SendSupergroupAccountMessageResult =
  | { readonly sent: true; readonly message: SupergroupMessage }
  | (
    & { readonly sent: false }
    & (
      | { readonly reason: SendSupergroupAccountMessageFailureReason }
      | ContentNormalizationFailure
      | SendPermissionMissingFailure
    )
  );

/** An album an account sends to a supergroup it is a member of. */
export interface SendSupergroupAccountAlbumInput {
  readonly fromAccountId: number;
  readonly chatId: number;
  /** The album's media in the order the supergroup shows them, each with its caption. */
  readonly contents: readonly AccountAlbumMediaContent[];
  /** As `SendSupergroupAccountMessageInput` describes it; every message of the album replies to it. */
  readonly replyToMessageId?: number;
}

export type SendSupergroupAccountAlbumResult =
  | { readonly sent: true; readonly messages: readonly SupergroupMessage[] }
  | (
    & { readonly sent: false }
    & (
      | {
        readonly reason:
          | Exclude<
            SendSupergroupAccountMessageFailureReason,
            'message_text_empty' | 'account_phone_number_missing'
          >
          | AlbumCompositionFailureReason;
      }
      | ContentTextNormalizationFailure
      | SendPermissionMissingFailure
    )
  );

/**
 * An inline query result that an account sends to a supergroup it is a member of, through the
 * inline bot that offered it, which need not be a member.
 */
export interface SendSupergroupAccountInlineResultInput {
  readonly fromAccountId: number;
  readonly chatId: number;
  readonly viaBotId: number;
  /**
   * What the result sends, which Telegram checked when the bot answered: content the answer holds,
   * as `existing` content, or media downloaded from a URL, whose upload is stored with the message.
   */
  readonly content: Exclude<NormalizedOutgoingContent, { readonly kind: 'poll' }>;
  /** Omitted when the result sends no inline keyboard. */
  readonly inlineKeyboard?: InlineKeyboard;
}

export type SendSupergroupAccountInlineResultResult =
  | { readonly sent: true; readonly message: SupergroupMessage }
  | (
    & { readonly sent: false }
    & (
      | {
        readonly reason:
          | 'account_not_found'
          | 'chat_not_found'
          | 'not_a_member'
          /** The account may not send other messages, which inline bots' results count as. */
          | 'inline_bots_not_permitted';
      }
      | SendPermissionMissingFailure
    )
  );

/** A forward that an account sends to a supergroup it is a member of. */
export interface SendSupergroupAccountForwardInput {
  readonly fromAccountId: number;
  readonly chatId: number;
  readonly forward: MessageForward;
}

export type SendSupergroupAccountForwardResult =
  | { readonly sent: true; readonly message: SupergroupMessage }
  | (
    & { readonly sent: false }
    & (
      | { readonly reason: 'account_not_found' | 'chat_not_found' | 'not_a_member' }
      | SendPermissionMissingFailure
    )
  );

/** The message of the supergroup that a bot's message replies to. */
export interface SupergroupBotMessageReplyTarget {
  /** The supergroup's ID of the message. */
  readonly messageId: number;
  /** Sends the message as no reply, rather than failing, when the target is not found. */
  readonly allowSendingWithoutReply: boolean;
}

export type SendSupergroupBotMessageInput = BotMessageReplyMarkup & {
  readonly fromBotId: number;
  readonly chatId: number;
  readonly content: OutgoingMessageContent;
  /** The message of the supergroup it replies to; omitted for a message that replies to none. */
  readonly replyTo?: SupergroupBotMessageReplyTarget;
  /**
   * The message of another chat it replies to, which the caller resolved; omitted for a message
   * that replies to none there.
   */
  readonly externalReply?: ExternalReplyTarget;
  /** The quote the bot chose from the message it replies to; omitted for none. */
  readonly quote?: SpecifiedQuote;
  /** Protects the message from forwarding and saving; omitted for an unprotected message. */
  readonly isContentProtected?: boolean;
  /** Notifies the members without sound; omitted for a message that notifies with sound. */
  readonly isSilent?: boolean;
  /** Where the content first appeared, for a forward; omitted for other messages. */
  readonly forwardInfo?: MessageForwardInfo;
  /**
   * The album the message belongs to, as a forward or copy of an album's message, which the
   * caller issued; omitted outside albums.
   */
  readonly mediaGroupId?: MediaGroupId;
  /**
   * The message effect the bot asks for; omitted for none. Telegram allows message effects only in
   * private chats, so a message with one is not sent.
   */
  readonly messageEffectId?: string;
};

export type SendSupergroupBotMessageFailureReason =
  | 'bot_not_found'
  | 'message_text_empty'
  | SupergroupBotAccessFailureReason
  | 'reply_message_not_found'
  | 'message_effect_not_allowed_in_chat'
  | 'callback_data_invalid'
  | 'button_type_invalid'
  | 'quote_invalid';

export type SendSupergroupBotMessageResult =
  | { readonly sent: true; readonly message: SupergroupMessage }
  | (
    & { readonly sent: false }
    & (
      | { readonly reason: SendSupergroupBotMessageFailureReason }
      | ContentNormalizationFailure
      | SendPermissionMissingFailure
    )
  );

/**
 * An album a bot sends to a supergroup it is a member of. Every message of the album replies alike
 * and shares the album's protection and notification; an album carries no reply markup.
 */
export interface SendSupergroupBotAlbumInput {
  readonly fromBotId: number;
  readonly chatId: number;
  /** The album's media in the order the supergroup shows them, each with its caption. */
  readonly contents: readonly MediaContent[];
  /** As `SendSupergroupBotMessageInput` describes it. */
  readonly replyTo?: SupergroupBotMessageReplyTarget;
  /** As `SendSupergroupBotMessageInput` describes it. */
  readonly externalReply?: ExternalReplyTarget;
  /** As `SendSupergroupBotMessageInput` describes it. */
  readonly quote?: SpecifiedQuote;
  /** As `SendSupergroupBotMessageInput` describes it. */
  readonly isContentProtected?: boolean;
  /** As `SendSupergroupBotMessageInput` describes it. */
  readonly isSilent?: boolean;
  /** As `SendSupergroupBotMessageInput` describes it: an album with one is not sent. */
  readonly messageEffectId?: string;
}

export type SendSupergroupBotAlbumResult =
  | { readonly sent: true; readonly messages: readonly SupergroupMessage[] }
  | (
    & { readonly sent: false }
    & (
      | {
        readonly reason:
          | Exclude<
            SendSupergroupBotMessageFailureReason,
            'message_text_empty' | 'callback_data_invalid' | 'button_type_invalid'
          >
          | AlbumCompositionFailureReason;
      }
      | ContentTextNormalizationFailure
      | SendPermissionMissingFailure
    )
  );

/** The reply interface a member's client shows in a supergroup, with the message that set it. */
export interface ShownSupergroupReplyInterface {
  readonly message: SupergroupMessage;
  readonly replyInterface: ReplyInterface;
}

export interface GetSupergroupReplyInterfaceInput {
  readonly accountId: number;
  readonly chatId: number;
}

export type GetSupergroupReplyInterfaceResult =
  | {
    readonly found: true;
    /** Omitted when the client shows its usual input. */
    readonly shownReplyInterface?: ShownSupergroupReplyInterface;
  }
  | {
    readonly found: false;
    readonly reason: 'account_not_found' | 'chat_not_found' | 'not_a_member';
  };

export interface PressSupergroupReplyKeyboardButtonInput {
  readonly fromAccountId: number;
  readonly chatId: number;
  /** The text of the button to press. */
  readonly text: string;
}

export type PressSupergroupReplyKeyboardButtonResult =
  | SendSupergroupAccountMessageResult
  | { readonly sent: false; readonly reason: ReplyKeyboardButtonSelectionFailureReason };

export interface CheckSupergroupBotChatActionAccessInput {
  readonly fromBotId: number;
  readonly chatId: number;
}

export type CheckSupergroupBotChatActionAccessResult =
  | { readonly allowed: true }
  | {
    readonly allowed: false;
    readonly reason: 'bot_not_found' | SupergroupBotAccessFailureReason;
  };

export interface RecordSupergroupServiceMessageInput {
  readonly chatId: number;
  /**
   * The member shown as having made the change: the one who added members, left, removed a
   * member, changed the title, or pinned a message.
   */
  readonly sender: SupergroupMessageSender;
  readonly content: SupergroupServiceContent;
  readonly changedAtUnixSeconds: number;
  /** Notifies the members without sound; omitted for a service message that notifies with sound. */
  readonly isSilent?: boolean;
}

export interface GetSupergroupMessageForBotInput {
  readonly botId: number;
  readonly chatId: number;
  /** The supergroup's ID of the message. */
  readonly messageId: number;
}

export type GetSupergroupMessageForBotResult =
  | { readonly found: true; readonly message: SupergroupMessage; readonly supergroup: Supergroup }
  | {
    readonly found: false;
    readonly reason: 'bot_not_found' | SupergroupBotAccessFailureReason | 'message_not_found';
  };

export interface GetSupergroupMessageHistoryInput {
  readonly accountId: number;
  readonly chatId: number;
}

export type GetSupergroupMessageHistoryResult =
  | { readonly found: true; readonly messages: readonly SupergroupMessage[] }
  | {
    readonly found: false;
    readonly reason: 'account_not_found' | 'chat_not_found' | 'not_a_member';
  };

interface AccountLookup {
  getById(accountId: number): VirtualAccount | undefined;
}

interface BotLookup {
  getById(botId: number): VirtualBot | undefined;
}

/**
 * The members of supergroups, and the reply interface each account member's client shows there,
 * which the store records by the message that set it.
 */
interface SupergroupMemberStore extends SupergroupMembershipLookup {
  getChatMemberIds(chatId: number): readonly number[];
  getReplyInterfaceMessageId(chatId: number, accountId: number): CanonicalMessageId | undefined;
  setReplyInterfaceMessageId(
    chatId: number,
    accountId: number,
    messageId: CanonicalMessageId | undefined,
  ): void;
}

interface SupergroupMessageStore {
  createMediaGroupId(): MediaGroupId;
  addMessage(message: NewSupergroupMessage): SupergroupMessage;
  findChatMessage(
    chat: SupergroupChatKey,
    messageId: CanonicalMessageId,
  ): SupergroupMessage | undefined;
  getChatMessages(chat: SupergroupChatKey): readonly SupergroupMessage[];
}

interface MessageBoxStore {
  assignMessageId(ownerId: number, canonicalMessageId: CanonicalMessageId): number;
  getMessageId(ownerId: number, canonicalMessageId: CanonicalMessageId): number | undefined;
  getCanonicalMessageId(ownerId: number, messageId: number): CanonicalMessageId | undefined;
}

/** Takes each event into the transaction of the command that caused it. */
interface ChatDomainEventSink {
  emit(event: ChatDomainEvent): void;
}

interface SupergroupMessagingServiceDependencies {
  readonly accounts: AccountLookup;
  readonly bots: BotLookup;
  readonly sharedChats: SupergroupMemberStore;
  readonly messages: SupergroupMessageStore;
  readonly files: FileUploadStore;
  readonly polls: NewPollStore;
  readonly messageBoxes: MessageBoxStore;
  readonly events: ChatDomainEventSink;
  readonly currentUnixTimeSeconds: () => number;
}

/**
 * Carries out exchanges of text, captioned media, and media albums among the
 * members of a supergroup, accounts and bots alike, including forwards by members and copies by
 * bots, and commits each accepted message: its upload stored, the message stored, numbered once in
 * the supergroup's own message box, then published. Only members write to a supergroup or read its
 * messages.
 *
 * Bots attach inline keyboards to their messages, and show reply keyboards and forced replies to
 * all members or to chosen ones, which account members press or answer. Accounts send inline query
 * results through inline bots. `MessageEditingService` edits, and `MessageDeletionService`
 * deletes, the messages of supergroups, as they do those of every chat type.
 *
 * Results carry canonical messages; presenting them to an observer is left to the caller.
 */
export class SupergroupMessagingService {
  readonly #accounts: AccountLookup;
  readonly #bots: BotLookup;
  readonly #textFixingContext: FormattedTextFixingContext;
  readonly #sharedChats: SupergroupMemberStore;
  readonly #messages: SupergroupMessageStore;
  readonly #files: FileUploadStore;
  readonly #polls: NewPollStore;
  readonly #messageBoxes: MessageBoxStore;
  readonly #events: ChatDomainEventSink;
  readonly #currentUnixTimeSeconds: () => number;

  constructor(
    {
      accounts,
      bots,
      sharedChats,
      messages,
      files,
      polls,
      messageBoxes,
      events,
      currentUnixTimeSeconds,
    }: SupergroupMessagingServiceDependencies,
  ) {
    this.#accounts = accounts;
    this.#bots = bots;
    this.#textFixingContext = createSessionUserMentionContext({ accounts, bots });
    this.#sharedChats = sharedChats;
    this.#messages = messages;
    this.#files = files;
    this.#polls = polls;
    this.#messageBoxes = messageBoxes;
    this.#events = events;
    this.#currentUnixTimeSeconds = currentUnixTimeSeconds;
  }

  /**
   * Sends text, captioned media, a contact, a location, or a new poll from an account to a
   * supergroup it is a member of. As a Telegram client does, the text or caption is normalized,
   * which marks bot commands, and a poll is checked as `normalizeNewPoll` checks it; then the
   * account must be allowed to send the content, as `findMissingSendPermission` decides.
   * The account's own contact needs the phone number the account was created with.
   */
  sendAccountMessage(input: SendSupergroupAccountMessageInput): SendSupergroupAccountMessageResult {
    const memberResolution = this.#resolveAccountMember(input.fromAccountId, input.chatId);
    if (!memberResolution.resolved) {
      return { sent: false, reason: memberResolution.reason };
    }
    if (input.content.kind === 'text' && input.content.text.length === 0) {
      return { sent: false, reason: 'message_text_empty' };
    }
    const outgoingContent = toOutgoingAccountContent(input.content, memberResolution.account);
    if (outgoingContent === undefined) {
      return { sent: false, reason: 'account_phone_number_missing' };
    }
    const contentNormalization = this.#normalizeContent(outgoingContent, 'account');
    if (!contentNormalization.normalized) {
      return { sent: false, ...contentNormalization.failure };
    }
    const permissionFailure = findMissingSendPermission(
      memberResolution,
      { kind: 'account', accountId: input.fromAccountId },
      [contentNormalization.content],
    );
    if (permissionFailure !== undefined) {
      return { sent: false, ...permissionFailure };
    }
    const repliedMessage = input.replyToMessageId === undefined
      ? undefined
      : this.getMessageByChatMessageId(input.chatId, input.replyToMessageId);
    if (input.replyToMessageId !== undefined && repliedMessage === undefined) {
      return { sent: false, reason: 'reply_message_not_found' };
    }

    return {
      sent: true,
      message: this.#storeMessage({
        chat: { type: 'supergroup', chatId: input.chatId },
        sender: { kind: 'account', accountId: input.fromAccountId },
        content: contentNormalization.content,
        replyToMessageId: repliedMessage?.id,
      }),
    };
  }

  /**
   * Sends a media album from an account to a supergroup it is a member of, as
   * `sendAccountMessage` sends one message. Every message of the album is checked before any is
   * stored, as `normalizeOutgoingAlbum` checks them and then the account's permissions, and every
   * message replies to the same message.
   * The supergroup's bots receive each message they would receive alone, in the album's order.
   */
  sendAccountAlbum(input: SendSupergroupAccountAlbumInput): SendSupergroupAccountAlbumResult {
    const memberResolution = this.#resolveAccountMember(input.fromAccountId, input.chatId);
    if (!memberResolution.resolved) {
      return { sent: false, reason: memberResolution.reason };
    }
    const albumNormalization = normalizeOutgoingAlbum(
      input.contents.map((content) => toOutgoingAccountMedia(content)),
      'account',
      this.#textFixingContext,
    );
    if (!albumNormalization.normalized) {
      return { sent: false, ...albumNormalization.failure };
    }
    const permissionFailure = findMissingSendPermission(
      memberResolution,
      { kind: 'account', accountId: input.fromAccountId },
      albumNormalization.contents,
    );
    if (permissionFailure !== undefined) {
      return { sent: false, ...permissionFailure };
    }
    const repliedMessage = input.replyToMessageId === undefined
      ? undefined
      : this.getMessageByChatMessageId(input.chatId, input.replyToMessageId);
    if (input.replyToMessageId !== undefined && repliedMessage === undefined) {
      return { sent: false, reason: 'reply_message_not_found' };
    }

    return {
      sent: true,
      messages: this.#storeAlbum(albumNormalization.contents, {
        chat: { type: 'supergroup', chatId: input.chatId },
        sender: { kind: 'account', accountId: input.fromAccountId },
        replyToMessageId: repliedMessage?.id,
      }, repliedMessage),
    };
  }

  /**
   * Sends an inline query result from an account to a supergroup it is a member of, as the
   * account's message sent through the inline bot. As TDLib's `send_inline_query_result_message`
   * requires, the account must be allowed to use inline bots, which `can_send_other_messages`
   * allows, and then to send the result's content.
   */
  sendAccountInlineResult(
    input: SendSupergroupAccountInlineResultInput,
  ): SendSupergroupAccountInlineResultResult {
    const memberResolution = this.#resolveAccountMember(input.fromAccountId, input.chatId);
    if (!memberResolution.resolved) {
      return { sent: false, reason: memberResolution.reason };
    }
    const actor: ChatActor = { kind: 'account', accountId: input.fromAccountId };
    if (!getMemberPermissions(memberResolution, actor).has('can_send_other_messages')) {
      return { sent: false, reason: 'inline_bots_not_permitted' };
    }
    const permissionFailure = findMissingSendPermission(memberResolution, actor, [
      input.content,
    ]);
    if (permissionFailure !== undefined) {
      return { sent: false, ...permissionFailure };
    }
    return {
      sent: true,
      message: this.#storeMessage({
        chat: { type: 'supergroup', chatId: input.chatId },
        sender: actor,
        content: input.content,
        inlineKeyboard: input.inlineKeyboard,
        viaBotId: input.viaBotId,
      }),
    };
  }

  /**
   * Sends a forward from an account to a supergroup it is a member of, as the account's message,
   * which it must be allowed to send.
   */
  sendAccountForward(
    { fromAccountId, chatId, forward }: SendSupergroupAccountForwardInput,
  ): SendSupergroupAccountForwardResult {
    const memberResolution = this.#resolveAccountMember(fromAccountId, chatId);
    if (!memberResolution.resolved) {
      return { sent: false, reason: memberResolution.reason };
    }
    const permissionFailure = findMissingSendPermission(
      memberResolution,
      { kind: 'account', accountId: fromAccountId },
      [{ kind: 'existing', content: forward.content }],
    );
    if (permissionFailure !== undefined) {
      return { sent: false, ...permissionFailure };
    }
    return {
      sent: true,
      message: this.#commitMessage({
        ...forward,
        chat: { type: 'supergroup', chatId },
        sender: { kind: 'account', accountId: fromAccountId },
        sentAtUnixSeconds: this.#currentUnixTimeSeconds(),
      }),
    };
  }

  /**
   * Sends text or captioned media from a bot to a supergroup it is a member of, or the content
   * of an existing message as a forward or copy of it. A supergroup the bot is not a member of is
   * unknown to it, as on Telegram.
   *
   * Checks follow Telegram's order: text is checked for emptiness before the chat is resolved, and
   * the replied message is looked up after it; a message effect is then refused, as TDLib's
   * `MessageSendOptions::get_message_send_options` refuses it outside private chats. The text or
   * caption is normalized with its entities next, and the result is checked for length. The bot
   * must then be allowed to send the content, as `findMissingSendPermission` decides. Callback
   * data is checked next, and a quote last, as Telegram's servers check it.
   */
  sendBotMessage(input: SendSupergroupBotMessageInput): SendSupergroupBotMessageResult {
    if (this.#bots.getById(input.fromBotId) === undefined) {
      return { sent: false, reason: 'bot_not_found' };
    }
    if (input.content.kind === 'text' && input.content.text.length === 0) {
      return { sent: false, reason: 'message_text_empty' };
    }
    const botMembership = resolveSupergroupBotMembership(
      this.#sharedChats,
      input.fromBotId,
      input.chatId,
    );
    if (!botMembership.resolved) {
      return { sent: false, reason: botMembership.reason };
    }
    const replyResolution = this.#resolveBotMessageReplyTarget(input.chatId, input.replyTo);
    if (!replyResolution.resolved) {
      return { sent: false, reason: 'reply_message_not_found' };
    }
    const { repliedMessage } = replyResolution;
    if (input.messageEffectId !== undefined) {
      return { sent: false, reason: 'message_effect_not_allowed_in_chat' };
    }
    const contentNormalization = this.#normalizeContent(input.content, 'bot');
    if (!contentNormalization.normalized) {
      return { sent: false, ...contentNormalization.failure };
    }
    const permissionFailure = findMissingSendPermission(
      botMembership,
      { kind: 'bot', botId: input.fromBotId },
      [contentNormalization.content],
    );
    if (permissionFailure !== undefined) {
      return { sent: false, ...permissionFailure };
    }
    if (!hasOnlyValidButtonCallbackData(input.inlineKeyboard, contentNormalization.content)) {
      return { sent: false, reason: 'callback_data_invalid' };
    }
    if (hasWebAppButton(input.inlineKeyboard, contentNormalization.content)) {
      return { sent: false, reason: 'button_type_invalid' };
    }
    const quoteResolution = resolveReplyQuote(
      getReplyQuoteSource(repliedMessage, input.externalReply),
      input.quote,
      this.#textFixingContext,
    );
    if (!quoteResolution.resolved) {
      return { sent: false, reason: quoteResolution.reason };
    }

    return {
      sent: true,
      message: this.#storeMessage({
        chat: { type: 'supergroup', chatId: input.chatId },
        sender: { kind: 'bot', botId: input.fromBotId },
        content: contentNormalization.content,
        replyToMessageId: repliedMessage?.id,
        externalReply: input.externalReply?.externalReply,
        quote: quoteResolution.quote,
        inlineKeyboard: input.inlineKeyboard,
        replyInterfaceMarkup: input.replyInterfaceMarkup,
        forwardInfo: input.forwardInfo,
        mediaGroupId: input.mediaGroupId,
        isContentProtected: input.isContentProtected,
        isSilent: input.isSilent,
      }, repliedMessage),
    };
  }

  /**
   * Whether a bot that is a member of a supergroup lacks a permission it needs to send content
   * there, as `sendBotMessage` checks it; false for a bot that is not a member, whose sending fails
   * for that instead.
   */
  lacksBotSendPermission(
    { botId, chatId, content }: {
      readonly botId: number;
      readonly chatId: number;
      readonly content: OutgoingMessageContent;
    },
  ): boolean {
    const botMembership = resolveSupergroupBotMembership(this.#sharedChats, botId, chatId);
    return botMembership.resolved &&
      findMissingSendPermission(botMembership, { kind: 'bot', botId }, [content]) !==
        undefined;
  }

  /**
   * Sends a media album from a bot to a supergroup it is a member of, as
   * `sendBotMessage` sends one message and in its order of checks, checking every message of the
   * album before any is stored: each caption is normalized, and the album is checked, as
   * `normalizeOutgoingAlbum` does, before the bot's permissions are. Every message replies to the
   * same message, with the same quote.
   */
  sendBotAlbum(input: SendSupergroupBotAlbumInput): SendSupergroupBotAlbumResult {
    if (this.#bots.getById(input.fromBotId) === undefined) {
      return { sent: false, reason: 'bot_not_found' };
    }
    const botMembership = resolveSupergroupBotMembership(
      this.#sharedChats,
      input.fromBotId,
      input.chatId,
    );
    if (!botMembership.resolved) {
      return { sent: false, reason: botMembership.reason };
    }
    const replyResolution = this.#resolveBotMessageReplyTarget(input.chatId, input.replyTo);
    if (!replyResolution.resolved) {
      return { sent: false, reason: 'reply_message_not_found' };
    }
    const { repliedMessage } = replyResolution;
    if (input.messageEffectId !== undefined) {
      return { sent: false, reason: 'message_effect_not_allowed_in_chat' };
    }
    const albumNormalization = normalizeOutgoingAlbum(
      input.contents,
      'bot',
      this.#textFixingContext,
    );
    if (!albumNormalization.normalized) {
      return { sent: false, ...albumNormalization.failure };
    }
    const permissionFailure = findMissingSendPermission(
      botMembership,
      { kind: 'bot', botId: input.fromBotId },
      albumNormalization.contents,
    );
    if (permissionFailure !== undefined) {
      return { sent: false, ...permissionFailure };
    }
    const quoteResolution = resolveReplyQuote(
      getReplyQuoteSource(repliedMessage, input.externalReply),
      input.quote,
      this.#textFixingContext,
    );
    if (!quoteResolution.resolved) {
      return { sent: false, reason: quoteResolution.reason };
    }

    return {
      sent: true,
      messages: this.#storeAlbum(albumNormalization.contents, {
        chat: { type: 'supergroup', chatId: input.chatId },
        sender: { kind: 'bot', botId: input.fromBotId },
        replyToMessageId: repliedMessage?.id,
        externalReply: input.externalReply?.externalReply,
        quote: quoteResolution.quote,
        isContentProtected: input.isContentProtected,
        isSilent: input.isSilent,
      }, repliedMessage),
    };
  }

  /**
   * Checks that a bot may show a chat action, such as typing, to a supergroup: it must be a member.
   * The caller records the action members' clients show.
   */
  checkBotChatActionAccess(
    { fromBotId, chatId }: CheckSupergroupBotChatActionAccessInput,
  ): CheckSupergroupBotChatActionAccessResult {
    if (this.#bots.getById(fromBotId) === undefined) {
      return { allowed: false, reason: 'bot_not_found' };
    }
    const accessFailure = this.#checkBotAccess(fromBotId, chatId);
    return accessFailure === undefined
      ? { allowed: true }
      : { allowed: false, reason: accessFailure };
  }

  /**
   * Records a change of a supergroup, which the caller has made, as a service message of the member
   * who made it. As on Telegram, the service message is numbered like any message.
   */
  recordServiceMessage(
    { chatId, sender, content, changedAtUnixSeconds, isSilent }:
      RecordSupergroupServiceMessageInput,
  ): SupergroupMessage {
    return this.#commitMessage({
      chat: { type: 'supergroup', chatId },
      sender,
      sentAtUnixSeconds: changedAtUnixSeconds,
      content,
      isSilent,
    });
  }

  /** Returns the reply interface a member's client shows in the supergroup. */
  getReplyInterface(
    { accountId, chatId }: GetSupergroupReplyInterfaceInput,
  ): GetSupergroupReplyInterfaceResult {
    const memberResolution = this.#resolveAccountMember(accountId, chatId);
    if (!memberResolution.resolved) {
      return { found: false, reason: memberResolution.reason };
    }
    const shownReplyInterface = this.#findShownReplyInterface(chatId, accountId);
    return shownReplyInterface === undefined
      ? { found: true }
      : { found: true, shownReplyInterface };
  }

  /**
   * Presses a button of the reply keyboard a member's client shows, which sends the button's text
   * as the member's message. As Telegram Desktop's `HistoryWidget::sendBotCommand` does outside
   * private chats, the message replies to the keyboard's message, so that the bot that sent it
   * receives it even in privacy mode. The keyboard stays shown, as in a private chat. The press
   * answers no request, as only private chats show buttons with one, and selects its button as a
   * private chat's press does.
   */
  pressReplyKeyboardButton(
    { fromAccountId, chatId, text }: PressSupergroupReplyKeyboardButtonInput,
  ): PressSupergroupReplyKeyboardButtonResult {
    const memberResolution = this.#resolveAccountMember(fromAccountId, chatId);
    if (!memberResolution.resolved) {
      return { sent: false, reason: memberResolution.reason };
    }
    const shownReplyInterface = this.#findShownReplyInterface(chatId, fromAccountId);
    if (shownReplyInterface?.replyInterface.kind !== 'reply_keyboard') {
      return { sent: false, reason: 'reply_keyboard_button_not_found' };
    }
    const selection = selectReplyKeyboardButton(
      shownReplyInterface.replyInterface,
      text,
      undefined,
    );
    if (!selection.selected) {
      return { sent: false, reason: selection.reason };
    }
    return this.sendAccountMessage({
      fromAccountId,
      chatId,
      content: { kind: 'text', text },
      replyToMessageId: this.#messageBoxes.getMessageId(chatId, shownReplyInterface.message.id),
    });
  }

  /** Returns the supergroup's messages, oldest first, to an account that is a member of it. */
  getMessageHistory(
    { accountId, chatId }: GetSupergroupMessageHistoryInput,
  ): GetSupergroupMessageHistoryResult {
    const memberResolution = this.#resolveAccountMember(accountId, chatId);
    if (!memberResolution.resolved) {
      return { found: false, reason: memberResolution.reason };
    }
    return {
      found: true,
      messages: this.#messages.getChatMessages({ type: 'supergroup', chatId }),
    };
  }

  /**
   * Finds a message of a supergroup the bot is a member of, as the bot addresses a message it
   * forwards or copies.
   */
  getMessageForBot(
    { botId, chatId, messageId }: GetSupergroupMessageForBotInput,
  ): GetSupergroupMessageForBotResult {
    if (this.#bots.getById(botId) === undefined) {
      return { found: false, reason: 'bot_not_found' };
    }
    const access = resolveSupergroupBotMembership(this.#sharedChats, botId, chatId);
    if (!access.resolved) {
      return { found: false, reason: access.reason };
    }
    const message = this.getMessageByChatMessageId(chatId, messageId);
    return message === undefined
      ? { found: false, reason: 'message_not_found' }
      : { found: true, message, supergroup: access.supergroup };
  }

  /** Finds a message of a supergroup by the ID the supergroup's message box gave it. */
  getMessageByChatMessageId(
    chatId: number,
    messageId: number,
  ): SupergroupMessage | undefined {
    const canonicalMessageId = this.#messageBoxes.getCanonicalMessageId(chatId, messageId);
    return canonicalMessageId === undefined
      ? undefined
      : this.#messages.findChatMessage({ type: 'supergroup', chatId }, canonicalMessageId);
  }

  /**
   * Finds the message a bot's message replies to. As on Telegram, a target that is not found,
   * such as a deleted message, fails the send unless the bot allowed sending without a reply.
   */
  #resolveBotMessageReplyTarget(
    chatId: number,
    replyTo: SupergroupBotMessageReplyTarget | undefined,
  ):
    | { readonly resolved: true; readonly repliedMessage?: SupergroupMessage }
    | { readonly resolved: false } {
    if (replyTo === undefined) {
      return { resolved: true };
    }
    const repliedMessage = this.getMessageByChatMessageId(chatId, replyTo.messageId);
    if (repliedMessage !== undefined) {
      return { resolved: true, repliedMessage };
    }
    return replyTo.allowSendingWithoutReply ? { resolved: true } : { resolved: false };
  }

  #resolveAccountMember(
    accountId: number,
    chatId: number,
  ):
    | {
      readonly resolved: true;
      readonly account: VirtualAccount;
      readonly supergroup: Supergroup;
      readonly membership: ChatMembership;
    }
    | {
      readonly resolved: false;
      readonly reason: 'account_not_found' | 'chat_not_found' | 'not_a_member';
    } {
    const account = this.#accounts.getById(accountId);
    if (account === undefined) {
      return { resolved: false, reason: 'account_not_found' };
    }
    const chat = this.#sharedChats.getSharedChat(chatId);
    if (chat?.kind !== 'supergroup') {
      return { resolved: false, reason: 'chat_not_found' };
    }
    const membership = this.#sharedChats.getChatMembership(chatId, accountId);
    if (membership === undefined) {
      return { resolved: false, reason: 'not_a_member' };
    }
    return { resolved: true, account, supergroup: chat, membership };
  }

  /** Checks that the bot is a member of the supergroup, which it needs to act there. */
  #checkBotAccess(botId: number, chatId: number): SupergroupBotAccessFailureReason | undefined {
    const resolution = resolveSupergroupBotMembership(this.#sharedChats, botId, chatId);
    return resolution.resolved ? undefined : resolution.reason;
  }

  /**
   * Normalizes the text or caption of new content, with the entities its sender specified, as
   * Telegram does, and checks its length.
   */
  #normalizeContent(
    content: OutgoingMessageContent,
    sender: ChatActor['kind'],
  ): OutgoingContentNormalization {
    return normalizeOutgoingContent(content, sender, this.#textFixingContext);
  }

  /**
   * Stores normalized content with its upload, numbers the message in the supergroup's box, and
   * publishes it.
   */
  #storeMessage(
    { content, ...message }: Omit<NewSupergroupMessage, 'sentAtUnixSeconds' | 'content'> & {
      readonly content: NormalizedOutgoingContent;
    },
    repliedMessage?: SupergroupMessage,
  ): SupergroupMessage {
    return this.#commitMessage({
      ...message,
      sentAtUnixSeconds: this.#currentUnixTimeSeconds(),
      content: storeOutgoingContent(content, this.#files, this.#polls),
    }, repliedMessage);
  }

  /**
   * Stores the normalized contents of an album, with their uploads, as `#storeMessage` stores each
   * in order, sharing a new album identifier unless the album holds a single message. Call it only
   * once every message of the album passed its checks.
   */
  #storeAlbum(
    contents: readonly NormalizedOutgoingContent[],
    message: Omit<NewSupergroupMessage, 'sentAtUnixSeconds' | 'content' | 'mediaGroupId'>,
    repliedMessage: SupergroupMessage | undefined,
  ): readonly SupergroupMessage[] {
    const mediaGroupId = formsAlbum(contents.length)
      ? this.#messages.createMediaGroupId()
      : undefined;
    return contents.map((content) =>
      this.#storeMessage({ ...message, content, mediaGroupId }, repliedMessage)
    );
  }

  /**
   * Stores a message, numbers it in the supergroup's box, publishes it, and then changes the reply
   * interface of the members' clients as it asks, which TDLib does after announcing the message.
   * `repliedMessage` is the message of the supergroup it replies to.
   */
  #commitMessage(
    message: NewSupergroupMessage,
    repliedMessage?: SupergroupMessage,
  ): SupergroupMessage {
    const storedMessage = this.#messages.addMessage(message);
    for (const boxOwnerId of supergroupMessagePolicy.getNumberingBoxOwnerIds(message.chat)) {
      this.#messageBoxes.assignMessageId(boxOwnerId, storedMessage.id);
    }
    this.#events.emit({ type: 'message_created', message: storedMessage });
    this.#updateMemberReplyInterfaces(storedMessage, repliedMessage);
    return storedMessage;
  }

  /**
   * Changes the reply interface each account member's client shows, as TDLib does for a received
   * message. Markup applies to the members `appliesReplyInterfaceTo` chooses: a keyboard or forced
   * reply replaces what a member's client shows, and a keyboard removal removes an interface that
   * the same bot set. As TDLib's `add_message_to_dialog` does, a service message recording that a
   * member left removes the interfaces that member set.
   */
  #updateMemberReplyInterfaces(
    message: SupergroupMessage,
    repliedMessage: SupergroupMessage | undefined,
  ): void {
    const { replyInterfaceMarkup: markup } = message;
    if (markup === undefined && message.content.kind !== 'member_left') {
      return;
    }
    const { chatId } = message.chat;
    for (const memberId of this.#sharedChats.getChatMemberIds(chatId)) {
      const account = this.#accounts.getById(memberId);
      // Bots' clients show no reply interface.
      if (account === undefined) {
        continue;
      }
      if (message.content.kind === 'member_left') {
        this.#removeReplyInterfaceSetBy(chatId, memberId, message.content.memberId);
        continue;
      }
      if (
        markup === undefined || !appliesReplyInterfaceTo(markup, {
          mentionsMember: mentionsUser(message.content, account.profile),
          repliesToMember: repliedMessage !== undefined &&
            getMessageSenderId(repliedMessage) === memberId,
        })
      ) {
        continue;
      }
      if (markup.kind === 'reply_keyboard_removal') {
        this.#removeReplyInterfaceSetBy(chatId, memberId, getMessageSenderId(message));
      } else {
        this.#sharedChats.setReplyInterfaceMessageId(chatId, memberId, message.id);
      }
    }
  }

  /**
   * Removes the reply interface a member's client shows when the given member set it, or when its
   * message was deleted.
   */
  #removeReplyInterfaceSetBy(chatId: number, accountId: number, setterId: number): void {
    const shownMessageId = this.#sharedChats.getReplyInterfaceMessageId(chatId, accountId);
    if (shownMessageId === undefined) {
      return;
    }
    const shownMessage = this.#messages.findChatMessage(
      { type: 'supergroup', chatId },
      shownMessageId,
    );
    if (shownMessage === undefined || getMessageSenderId(shownMessage) === setterId) {
      this.#sharedChats.setReplyInterfaceMessageId(chatId, accountId, undefined);
    }
  }

  /**
   * Finds the reply interface a member's client shows: the one the latest message that set it
   * asked for, unless a later message removed it or that message was deleted.
   */
  #findShownReplyInterface(
    chatId: number,
    accountId: number,
  ): ShownSupergroupReplyInterface | undefined {
    const messageId = this.#sharedChats.getReplyInterfaceMessageId(chatId, accountId);
    const message = messageId === undefined
      ? undefined
      : this.#messages.findChatMessage({ type: 'supergroup', chatId }, messageId);
    const replyInterface = message?.replyInterfaceMarkup;
    if (
      message === undefined || replyInterface === undefined ||
      replyInterface.kind === 'reply_keyboard_removal'
    ) {
      return undefined;
    }
    return { message, replyInterface };
  }
}

/** A member's standing in its supergroup, which decides what it may send there. */
interface SupergroupMemberStanding {
  readonly supergroup: Supergroup;
  readonly membership: ChatMembership;
}

/** What a member may do in its supergroup, as `getEffectiveChatPermissions` decides. */
function getMemberPermissions(
  { supergroup, membership }: SupergroupMemberStanding,
  member: ChatActor,
): ChatPermissions {
  return getEffectiveChatPermissions(membership, {
    defaultPermissions: supergroup.defaultPermissions,
    isBot: member.kind === 'bot',
  });
}

/**
 * Finds the first content, in order, that a member may not send, as TDLib's
 * `can_send_message_content` checks each message, and reports its kind; `undefined` when the
 * member may send them all.
 */
export function findMissingSendPermission(
  standing: SupergroupMemberStanding,
  member: ChatActor,
  contents: readonly (OutgoingMessageContent | NormalizedOutgoingContent)[],
): SendPermissionMissingFailure | undefined {
  const permissions = getMemberPermissions(standing, member);
  for (const content of contents) {
    const governedContent = toPermissionGovernedContent(content);
    if (
      !getContentSendPermissions(governedContent).every((permission) => permissions.has(permission))
    ) {
      return { reason: 'send_permission_missing', contentKind: governedContent.kind };
    }
  }
  return undefined;
}

/** The content whose sending permissions govern, of new content or of an existing message. */
function toPermissionGovernedContent(
  content: OutgoingMessageContent | NormalizedOutgoingContent | MessageContent,
): PermissionGovernedContent {
  switch (content.kind) {
    case 'existing':
      return toPermissionGovernedContent(content.content);
    case 'rich_message':
      return {
        kind: 'rich_message',
        richMessage: 'richMessage' in content ? content.richMessage : content,
      };
    default:
      return { kind: content.kind };
  }
}
