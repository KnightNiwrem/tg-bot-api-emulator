import type { ChatDomainEvent } from '../types/chat_domain_event.ts';
import { privateChatMessagePolicy } from '../types/chat_policy.ts';
import type { InlineKeyboard } from '../types/inline_keyboard.ts';
import { type AlbumCompositionFailureReason, formsAlbum } from '../types/media_album.ts';
import type { ExternalReplyTarget } from '../types/message_reply.ts';
import type { MessageForward } from '../types/message_forward.ts';
import type { BotMessageReplyMarkup } from '../types/reply_interface.ts';
import type { VirtualAccount } from '../types/virtual_account.ts';
import type { VirtualBot } from '../types/virtual_bot.ts';
import type {
  AccountPrivateChatAddress,
  PrivateChatKey,
  PrivateConversation,
  PrivateConversationKey,
  PrivateConversationRole,
} from '../types/virtual_chat.ts';
import {
  type CanonicalMessageId,
  type MediaGroupId,
  type MessageForwardInfo,
  type MessagePinnedContent,
  type NewPrivateMessage,
  type PrivateMessage,
  type WebAppDataMessageContent,
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
import type {
  SharedChatFailureReason,
  SharedChatResolution,
  SharedUsersFailureReason,
  SharedUsersResolution,
} from './requested_peer_sharing.ts';
import { createSessionUserMentionContext } from './session_user_mention.ts';

export type PrivateConversationActivationFailureReason =
  | 'account_not_found'
  | 'bot_not_found';

export type PrivateConversationActivationResult =
  | {
    readonly activated: true;
    readonly conversation: PrivateConversation;
  }
  | {
    readonly activated: false;
    readonly reason: PrivateConversationActivationFailureReason;
  };

export interface SendAccountMessageInput {
  readonly fromAccountId: number;
  readonly to: AccountPrivateChatAddress;
  readonly content: AccountMessageContent;
  /** The ID, in the bot's message box, of the chat's message to reply to; omitted for no reply. */
  readonly replyToBotMessageId?: number;
}

export type SendAccountMessageFailureReason =
  | 'account_not_found'
  | 'bot_not_found'
  | 'bot_blocked'
  | 'message_text_empty'
  | 'account_phone_number_missing'
  | 'reply_message_not_found';

export type SendAccountMessageResult =
  | {
    readonly sent: true;
    readonly message: PrivateMessage;
  }
  | (
    & { readonly sent: false }
    & (
      | { readonly reason: SendAccountMessageFailureReason }
      | ContentNormalizationFailure
    )
  );

/** An album an account sends to its private chat with a bot. */
export interface SendAccountAlbumInput {
  readonly fromAccountId: number;
  readonly to: AccountPrivateChatAddress;
  /** The album's media in the order the chat shows them, each with its caption. */
  readonly contents: readonly AccountAlbumMediaContent[];
  /** As `SendAccountMessageInput` describes it; every message of the album replies to it. */
  readonly replyToBotMessageId?: number;
}

export type SendAccountAlbumResult =
  | { readonly sent: true; readonly messages: readonly PrivateMessage[] }
  | (
    & { readonly sent: false }
    & (
      | {
        readonly reason:
          | Exclude<
            SendAccountMessageFailureReason,
            'message_text_empty' | 'account_phone_number_missing'
          >
          | AlbumCompositionFailureReason;
      }
      | ContentTextNormalizationFailure
    )
  );

/**
 * An inline query result that an account sends to its private chat with a bot, through the inline
 * bot that offered it.
 */
export interface SendAccountInlineResultInput {
  readonly fromAccountId: number;
  readonly to: AccountPrivateChatAddress;
  readonly viaBotId: number;
  /**
   * What the result sends, which Telegram checked when the bot answered: content the answer holds,
   * as `existing` content, or media downloaded from a URL, whose upload is stored with the message.
   */
  readonly content: Exclude<NormalizedOutgoingContent, { readonly kind: 'poll' }>;
  /** Omitted when the result sends no inline keyboard. */
  readonly inlineKeyboard?: InlineKeyboard;
}

export type SendAccountInlineResultResult =
  | { readonly sent: true; readonly message: PrivateMessage }
  | {
    readonly sent: false;
    readonly reason: 'account_not_found' | 'bot_not_found' | 'bot_blocked';
  };

/** A forward that an account sends to its private chat with a bot. */
export interface SendAccountForwardInput {
  readonly fromAccountId: number;
  readonly to: AccountPrivateChatAddress;
  readonly forward: MessageForward;
}

export type SendAccountForwardResult = SendAccountInlineResultResult;

/** A bot's private chat, identified by the account at its other end. */
export interface BotPrivateChat {
  readonly type: 'private';
  readonly accountId: number;
}

/** The message of the chat that a bot's message replies to. */
export interface BotMessageReplyTarget {
  /** The message's ID in the bot's message box. */
  readonly botMessageId: number;
  /** Sends the message as no reply, rather than failing, when the target is not found. */
  readonly allowSendingWithoutReply: boolean;
}

export type SendBotMessageInput = BotMessageReplyMarkup & {
  readonly fromBotId: number;
  readonly to: BotPrivateChat;
  readonly content: OutgoingMessageContent;
  /** The message of the chat it replies to; omitted for a message that replies to none. */
  readonly replyTo?: BotMessageReplyTarget;
  /**
   * The message of another chat it replies to, which the caller resolved; omitted for a message
   * that replies to none there.
   */
  readonly externalReply?: ExternalReplyTarget;
  /** The quote the bot chose from the message it replies to; omitted for none. */
  readonly quote?: SpecifiedQuote;
  /** Protects the message from forwarding and saving; omitted for an unprotected message. */
  readonly isContentProtected?: boolean;
  /** Notifies the account without sound; omitted for a message that notifies with sound. */
  readonly isSilent?: boolean;
  /** Where the content first appeared, for a forward; omitted for other messages. */
  readonly forwardInfo?: MessageForwardInfo;
  /**
   * The album the message belongs to, as a forward or copy of an album's message, which the
   * caller issued; omitted outside albums.
   */
  readonly mediaGroupId?: MediaGroupId;
  /** The message effect clients play with the message; omitted for none. */
  readonly messageEffectId?: string;
};

export type SendBotMessageFailureReason =
  | 'bot_not_found'
  | 'message_text_empty'
  | 'account_not_found'
  | 'conversation_not_started'
  | 'reply_message_not_found'
  | 'callback_data_invalid'
  | 'quote_invalid'
  | 'bot_blocked';

export type SendBotMessageResult =
  | {
    readonly sent: true;
    readonly message: PrivateMessage;
  }
  | (
    & { readonly sent: false }
    & (
      | { readonly reason: SendBotMessageFailureReason }
      | ContentNormalizationFailure
    )
  );

/**
 * An album a bot sends to one of its private chats. Every message of the album replies alike and
 * shares the album's protection, notification, and message effect; an album carries no reply
 * markup.
 */
export interface SendBotAlbumInput {
  readonly fromBotId: number;
  readonly to: BotPrivateChat;
  /** The album's media in the order the chat shows them, each with its caption. */
  readonly contents: readonly MediaContent[];
  /** As `SendBotMessageInput` describes it. */
  readonly replyTo?: BotMessageReplyTarget;
  /** As `SendBotMessageInput` describes it. */
  readonly externalReply?: ExternalReplyTarget;
  /** As `SendBotMessageInput` describes it. */
  readonly quote?: SpecifiedQuote;
  /** As `SendBotMessageInput` describes it. */
  readonly isContentProtected?: boolean;
  /** As `SendBotMessageInput` describes it. */
  readonly isSilent?: boolean;
  /** As `SendBotMessageInput` describes it. */
  readonly messageEffectId?: string;
}

export type SendBotAlbumResult =
  | { readonly sent: true; readonly messages: readonly PrivateMessage[] }
  | (
    & { readonly sent: false }
    & (
      | {
        readonly reason:
          | Exclude<SendBotMessageFailureReason, 'message_text_empty' | 'callback_data_invalid'>
          | AlbumCompositionFailureReason;
      }
      | ContentTextNormalizationFailure
    )
  );

export interface CheckBotChatActionAccessInput {
  readonly fromBotId: number;
  readonly to: BotPrivateChat;
}

export type CheckBotChatActionAccessResult =
  | { readonly allowed: true }
  | {
    readonly allowed: false;
    readonly reason:
      | 'bot_not_found'
      | 'account_not_found'
      | 'conversation_not_started'
      | 'bot_blocked';
  };

/**
 * The service message content that an account's answer to a reply keyboard button's request
 * resolves to, or why the answer is refused.
 */
export type AccountServiceContentResolution =
  | SharedUsersResolution
  | SharedChatResolution
  | { readonly resolved: true; readonly content: WebAppDataMessageContent };

export type SendAccountServiceMessageResult =
  | { readonly sent: true; readonly message: PrivateMessage }
  | {
    readonly sent: false;
    readonly reason:
      | 'account_not_found'
      | 'bot_not_found'
      | 'bot_blocked'
      | SharedUsersFailureReason
      | SharedChatFailureReason;
  };

export interface RecordPrivateServiceMessageInput {
  readonly conversation: PrivateConversationKey;
  /** The participant shown as having made the change: the one who pinned a message. */
  readonly sender: PrivateConversationRole;
  /**
   * The pin, the one change a caller records; users and chats an account shares, and data a Web
   * App sends, are recorded only through `sendAccountServiceMessage`, whose caller validates them.
   */
  readonly content: MessagePinnedContent;
  /** Whether the service message notifies the other participant without sound. */
  readonly isSilent: boolean;
}

export interface GetMessageForBotInput {
  readonly botId: number;
  /** The account at the other end of the bot's private chat. */
  readonly accountId: number;
  /** The message's ID in the bot's message box. */
  readonly botMessageId: number;
}

export type GetMessageForBotResult =
  | { readonly found: true; readonly message: PrivateMessage }
  | {
    readonly found: false;
    readonly reason:
      | 'bot_not_found'
      | 'account_not_found'
      | 'conversation_not_started'
      | 'message_not_found';
  };

export interface GetPrivateMessageHistoryInput {
  readonly accountId: number;
  readonly botId: number;
}

export type GetPrivateMessageHistoryResult =
  | {
    readonly found: true;
    readonly messages: readonly PrivateMessage[];
  }
  | {
    readonly found: false;
    readonly reason: 'account_not_found' | 'bot_not_found';
  };

interface AccountLookup {
  getById(accountId: number): VirtualAccount | undefined;
}

interface BotLookup {
  getById(botId: number): VirtualBot | undefined;
}

interface PrivateConversationStore {
  startPrivateConversation(key: PrivateConversationKey): PrivateConversation;
  openPrivateConversation(key: PrivateConversationKey): PrivateConversation;
  isPrivateConversationStarted(key: PrivateConversationKey): boolean;
  getReplyInterfaceMessageId(key: PrivateConversationKey): CanonicalMessageId | undefined;
  setReplyInterfaceMessageId(
    key: PrivateConversationKey,
    messageId: CanonicalMessageId | undefined,
  ): void;
}

interface PrivateMessageStore {
  createMediaGroupId(): MediaGroupId;
  addMessage(message: NewPrivateMessage): PrivateMessage;
  findChatMessage(chat: PrivateChatKey, messageId: CanonicalMessageId): PrivateMessage | undefined;
  getChatMessages(chat: PrivateChatKey): readonly PrivateMessage[];
}

interface MessageBoxStore {
  assignMessageId(ownerId: number, canonicalMessageId: CanonicalMessageId): number;
  getMessageId(ownerId: number, canonicalMessageId: CanonicalMessageId): number | undefined;
  getCanonicalMessageId(ownerId: number, messageId: number): CanonicalMessageId | undefined;
}

interface BlockedUserLookup {
  isBlocked(accountId: number, userId: number): boolean;
}

/** Takes each event into the transaction of the command that caused it. */
interface ChatDomainEventSink {
  emit(event: ChatDomainEvent): void;
}

interface MessageDraftClearing {
  clearBotDraft(conversation: PrivateConversationKey): void;
}

/**
 * Decides whether a pending join request lets a bot write to an account that has not started a
 * private conversation with it, which chat admission grants to the bots that receive the request.
 */
interface JoinRequesterContactGrants {
  mayContactJoinRequester(botId: number, accountId: number): boolean;
  /** Records that the bot wrote to the account under a grant that `mayContactJoinRequester` found. */
  claimJoinRequesterContact(botId: number, accountId: number): void;
}

interface PrivateMessagingServiceDependencies {
  readonly accounts: AccountLookup;
  readonly bots: BotLookup;
  readonly privateConversations: PrivateConversationStore;
  readonly messages: PrivateMessageStore;
  readonly files: FileUploadStore;
  readonly polls: NewPollStore;
  readonly messageBoxes: MessageBoxStore;
  readonly blockedUsers: BlockedUserLookup;
  readonly joinRequesterContacts: JoinRequesterContactGrants;
  readonly events: ChatDomainEventSink;
  /** Removes the message draft that any message from the bot removes from the chat. */
  readonly messageDrafts: MessageDraftClearing;
  readonly currentUnixTimeSeconds: () => number;
}

/**
 * What lets a bot write to an account: the conversation the account started, or a pending join
 * request's contact grant.
 */
type BotRecipientAccess = 'started_conversation' | 'join_request_contact';

/**
 * A message of an existing private conversation to store, sent by one of its participants, whose
 * file the caller stored. The participants name its chat, and it is sent when it is stored.
 */
interface ParticipantMessage extends Omit<NewPrivateMessage, 'chat' | 'sentAtUnixSeconds'> {
  readonly account: VirtualAccount;
  readonly bot: VirtualBot;
}

/**
 * Carries out exchanges of text, captioned media, and media albums between an
 * account and a bot in their private conversation, including forwards by either and copies by the
 * bot, and commits each accepted message: its upload stored, the message stored, numbered for both
 * participants, then published. Bots can attach inline keyboards to their messages. A bot's
 * message can also change the reply interface the account's client shows, such as a reply
 * keyboard, whose buttons `ReplyInterfaceService` presses. An account sends inline query results
 * through inline bots. `MessageEditingService` edits, and `MessageDeletionService` deletes, the
 * messages of private chats, as they do those of every chat type.
 *
 * While an account blocks a bot, neither can write to the other, as on Telegram, where the bot's
 * sends fail and a client asks the user to unblock the bot before writing to it.
 *
 * Results carry canonical messages; presenting them to an observer, such as through the Bot API,
 * is left to the caller.
 */
export class PrivateMessagingService {
  readonly #accounts: AccountLookup;
  readonly #bots: BotLookup;
  readonly #textFixingContext: FormattedTextFixingContext;
  readonly #privateConversations: PrivateConversationStore;
  readonly #messages: PrivateMessageStore;
  readonly #files: FileUploadStore;
  readonly #polls: NewPollStore;
  readonly #messageBoxes: MessageBoxStore;
  readonly #blockedUsers: BlockedUserLookup;
  readonly #joinRequesterContacts: JoinRequesterContactGrants;
  readonly #events: ChatDomainEventSink;
  readonly #messageDrafts: MessageDraftClearing;
  readonly #currentUnixTimeSeconds: () => number;

  constructor(
    {
      accounts,
      bots,
      privateConversations,
      messages,
      files,
      polls,
      messageBoxes,
      blockedUsers,
      joinRequesterContacts,
      events,
      messageDrafts,
      currentUnixTimeSeconds,
    }: PrivateMessagingServiceDependencies,
  ) {
    this.#accounts = accounts;
    this.#bots = bots;
    this.#textFixingContext = createSessionUserMentionContext({ accounts, bots });
    this.#privateConversations = privateConversations;
    this.#messages = messages;
    this.#files = files;
    this.#polls = polls;
    this.#messageBoxes = messageBoxes;
    this.#blockedUsers = blockedUsers;
    this.#joinRequesterContacts = joinRequesterContacts;
    this.#events = events;
    this.#messageDrafts = messageDrafts;
    this.#currentUnixTimeSeconds = currentUnixTimeSeconds;
  }

  activatePrivateConversation(
    input: PrivateConversationKey,
  ): PrivateConversationActivationResult {
    if (this.#accounts.getById(input.accountId) === undefined) {
      return { activated: false, reason: 'account_not_found' };
    }
    if (this.#bots.getById(input.botId) === undefined) {
      return { activated: false, reason: 'bot_not_found' };
    }

    return {
      activated: true,
      conversation: this.#privateConversations.startPrivateConversation(input),
    };
  }

  /**
   * Whether the account has started a private conversation with the bot, which makes the private
   * chat known to the bot.
   */
  isPrivateConversationStarted(key: PrivateConversationKey): boolean {
    return this.#privateConversations.isPrivateConversationStarted(key);
  }

  /**
   * Sends text, captioned media, a contact, a location, or a new poll from an account to its
   * private chat with a bot. As a Telegram client does, the text or caption is normalized, which
   * marks bot commands, and a poll is checked as `normalizeNewPoll` checks it. The account's own
   * contact needs the phone number the account was created with.
   */
  sendAccountMessage(input: SendAccountMessageInput): SendAccountMessageResult {
    const senderResolution = this.#resolveAccountSender(input.fromAccountId, input.to.botId);
    if (!senderResolution.resolved) {
      return { sent: false, reason: senderResolution.reason };
    }
    const { account, bot } = senderResolution;
    if (input.content.kind === 'text' && input.content.text.length === 0) {
      return { sent: false, reason: 'message_text_empty' };
    }
    const outgoingContent = toOutgoingAccountContent(input.content, account);
    if (outgoingContent === undefined) {
      return { sent: false, reason: 'account_phone_number_missing' };
    }
    const contentNormalization = this.#normalizeContent(outgoingContent, 'account');
    if (!contentNormalization.normalized) {
      return { sent: false, ...contentNormalization.failure };
    }
    const conversation: PrivateConversationKey = {
      accountId: account.profile.id,
      botId: bot.profile.id,
    };
    const repliedMessage = input.replyToBotMessageId === undefined
      ? undefined
      : this.getPrivateMessageByBotMessageId(conversation, input.replyToBotMessageId);
    if (input.replyToBotMessageId !== undefined && repliedMessage === undefined) {
      return { sent: false, reason: 'reply_message_not_found' };
    }

    this.#privateConversations.startPrivateConversation(conversation);
    return {
      sent: true,
      message: this.#storePrivateMessage({
        account,
        bot,
        sender: 'account',
        content: storeOutgoingContent(contentNormalization.content, this.#files, this.#polls),
        replyToMessageId: repliedMessage?.id,
      }),
    };
  }

  /**
   * Sends a media album from an account to its private chat with a bot, as
   * `sendAccountMessage` sends one message. Every message of the album is checked before any is
   * stored, as `normalizeOutgoingAlbum` checks them, and every message replies to the same message.
   * The bot receives each message in the album's order.
   */
  sendAccountAlbum(input: SendAccountAlbumInput): SendAccountAlbumResult {
    const senderResolution = this.#resolveAccountSender(input.fromAccountId, input.to.botId);
    if (!senderResolution.resolved) {
      return { sent: false, reason: senderResolution.reason };
    }
    const { account, bot } = senderResolution;
    const albumNormalization = normalizeOutgoingAlbum(
      input.contents.map((content) => toOutgoingAccountMedia(content)),
      'account',
      this.#textFixingContext,
    );
    if (!albumNormalization.normalized) {
      return { sent: false, ...albumNormalization.failure };
    }
    const conversation: PrivateConversationKey = {
      accountId: account.profile.id,
      botId: bot.profile.id,
    };
    const repliedMessage = input.replyToBotMessageId === undefined
      ? undefined
      : this.getPrivateMessageByBotMessageId(conversation, input.replyToBotMessageId);
    if (input.replyToBotMessageId !== undefined && repliedMessage === undefined) {
      return { sent: false, reason: 'reply_message_not_found' };
    }

    this.#privateConversations.startPrivateConversation(conversation);
    return {
      sent: true,
      messages: this.#storePrivateAlbum(albumNormalization.contents, {
        account,
        bot,
        sender: 'account',
        replyToMessageId: repliedMessage?.id,
      }),
    };
  }

  /**
   * Sends an inline query result from an account to its private chat with a bot, which receives
   * it as the account's message sent through the inline bot. As for any message, the account must
   * not block the chat's bot.
   */
  sendAccountInlineResult(input: SendAccountInlineResultInput): SendAccountInlineResultResult {
    return this.#sendAccountPreparedMessage(input.fromAccountId, input.to.botId, {
      content: input.content,
      inlineKeyboard: input.inlineKeyboard,
      viaBotId: input.viaBotId,
    });
  }

  /**
   * Sends a forward from an account to its private chat with a bot, which receives it as the
   * account's message. As for any message, the account must not block the chat's bot.
   */
  sendAccountForward(
    { fromAccountId, to, forward }: SendAccountForwardInput,
  ): SendAccountForwardResult {
    return this.#sendAccountPreparedMessage(fromAccountId, to.botId, {
      ...forward,
      content: { kind: 'existing', content: forward.content },
    });
  }

  /**
   * Sends text or captioned media from a bot to an account, or the content of an existing
   * message as a forward or copy of it. As on Telegram, a bot cannot initiate a private
   * conversation, so the account must have started one with the bot, unless a pending join request
   * of the account lets the bot contact it, as `#findBotRecipient` finds.
   *
   * Checks follow Telegram's order: text is checked for emptiness before the recipient is
   * resolved, and the replied message is looked up after it; the text or caption is then
   * normalized with its entities, and the result is checked for length. Callback data is checked
   * next. A quote and a block by the account are checked last, as Telegram's servers refuse the
   * message only after the Bot API server has checked everything it can.
   */
  sendBotMessage(input: SendBotMessageInput): SendBotMessageResult {
    const bot = this.#bots.getById(input.fromBotId);
    if (bot === undefined) {
      return { sent: false, reason: 'bot_not_found' };
    }
    if (input.content.kind === 'text' && input.content.text.length === 0) {
      return { sent: false, reason: 'message_text_empty' };
    }
    const recipient = this.#findBotRecipient(bot, input.to);
    if (!recipient.found) {
      return { sent: false, reason: recipient.reason };
    }
    const { account, conversation, access } = recipient;
    const replyResolution = this.#resolveBotMessageReplyTarget(conversation, input.replyTo);
    if (!replyResolution.resolved) {
      return { sent: false, reason: 'reply_message_not_found' };
    }
    const contentNormalization = this.#normalizeContent(input.content, 'bot');
    if (!contentNormalization.normalized) {
      return { sent: false, ...contentNormalization.failure };
    }
    if (!hasOnlyValidButtonCallbackData(input.inlineKeyboard, contentNormalization.content)) {
      return { sent: false, reason: 'callback_data_invalid' };
    }
    const quoteResolution = resolveReplyQuote(
      getReplyQuoteSource(replyResolution.repliedMessage, input.externalReply),
      input.quote,
      this.#textFixingContext,
    );
    if (!quoteResolution.resolved) {
      return { sent: false, reason: quoteResolution.reason };
    }
    if (this.#blockedUsers.isBlocked(account.profile.id, bot.profile.id)) {
      return { sent: false, reason: 'bot_blocked' };
    }

    this.#admitBotMessage(conversation, access);
    return {
      sent: true,
      message: this.#storePrivateMessage({
        account,
        bot,
        sender: 'bot',
        content: storeOutgoingContent(contentNormalization.content, this.#files, this.#polls),
        replyToMessageId: replyResolution.repliedMessage?.id,
        externalReply: input.externalReply?.externalReply,
        quote: quoteResolution.quote,
        inlineKeyboard: input.inlineKeyboard,
        replyInterfaceMarkup: input.replyInterfaceMarkup,
        forwardInfo: input.forwardInfo,
        mediaGroupId: input.mediaGroupId,
        isContentProtected: input.isContentProtected,
        isSilent: input.isSilent,
        messageEffectId: input.messageEffectId,
      }),
    };
  }

  /**
   * Sends a media album from a bot to an account, as `sendBotMessage` sends one
   * message and in its order of checks, checking every message of the album before any is stored:
   * each caption is normalized, and the album is checked, as `normalizeOutgoingAlbum` does. Every
   * message replies to the same message, with the same quote.
   */
  sendBotAlbum(input: SendBotAlbumInput): SendBotAlbumResult {
    const bot = this.#bots.getById(input.fromBotId);
    if (bot === undefined) {
      return { sent: false, reason: 'bot_not_found' };
    }
    const recipient = this.#findBotRecipient(bot, input.to);
    if (!recipient.found) {
      return { sent: false, reason: recipient.reason };
    }
    const { account, conversation, access } = recipient;
    const replyResolution = this.#resolveBotMessageReplyTarget(conversation, input.replyTo);
    if (!replyResolution.resolved) {
      return { sent: false, reason: 'reply_message_not_found' };
    }
    const albumNormalization = normalizeOutgoingAlbum(
      input.contents,
      'bot',
      this.#textFixingContext,
    );
    if (!albumNormalization.normalized) {
      return { sent: false, ...albumNormalization.failure };
    }
    const quoteResolution = resolveReplyQuote(
      getReplyQuoteSource(replyResolution.repliedMessage, input.externalReply),
      input.quote,
      this.#textFixingContext,
    );
    if (!quoteResolution.resolved) {
      return { sent: false, reason: quoteResolution.reason };
    }
    if (this.#blockedUsers.isBlocked(account.profile.id, bot.profile.id)) {
      return { sent: false, reason: 'bot_blocked' };
    }

    this.#admitBotMessage(conversation, access);
    return {
      sent: true,
      messages: this.#storePrivateAlbum(albumNormalization.contents, {
        account,
        bot,
        sender: 'bot',
        replyToMessageId: replyResolution.repliedMessage?.id,
        externalReply: input.externalReply?.externalReply,
        quote: quoteResolution.quote,
        isContentProtected: input.isContentProtected,
        isSilent: input.isSilent,
        messageEffectId: input.messageEffectId,
      }),
    };
  }

  /**
   * Checks that a bot may show a chat action, such as typing, to an account. As for messages, the
   * account must have started a conversation with the bot and not block it. TDLib sends a bot's
   * message drafts as chat actions too, so they need the same access. The caller records what the
   * account's client shows.
   */
  checkBotChatActionAccess(
    { fromBotId, to }: CheckBotChatActionAccessInput,
  ): CheckBotChatActionAccessResult {
    if (this.#bots.getById(fromBotId) === undefined) {
      return { allowed: false, reason: 'bot_not_found' };
    }
    if (this.#accounts.getById(to.accountId) === undefined) {
      return { allowed: false, reason: 'account_not_found' };
    }
    if (
      !this.#privateConversations.isPrivateConversationStarted({
        accountId: to.accountId,
        botId: fromBotId,
      })
    ) {
      return { allowed: false, reason: 'conversation_not_started' };
    }
    return this.#blockedUsers.isBlocked(to.accountId, fromBotId)
      ? { allowed: false, reason: 'bot_blocked' }
      : { allowed: true };
  }

  /**
   * Records a change of a private conversation, which the caller has made, as a service message of
   * the participant who made it. As on Telegram, the service message is numbered like any message,
   * for both participants.
   */
  recordServiceMessage(
    { conversation, sender, content, isSilent }: RecordPrivateServiceMessageInput,
  ): PrivateMessage {
    const account = this.#accounts.getById(conversation.accountId);
    const bot = this.#bots.getById(conversation.botId);
    if (account === undefined || bot === undefined) {
      throw new Error(
        `Participants of conversation ${JSON.stringify(conversation)} do not exist`,
      );
    }
    return this.#storePrivateMessage({ account, bot, sender, content, isSilent });
  }

  /**
   * Finds a message of a private conversation by its ID in the bot's message box. A bot numbers
   * the messages of all its chats in one box, so an ID from another chat finds nothing.
   */
  getPrivateMessageByBotMessageId(
    conversation: PrivateConversationKey,
    botMessageId: number,
  ): PrivateMessage | undefined {
    const canonicalMessageId = this.#messageBoxes.getCanonicalMessageId(
      conversation.botId,
      botMessageId,
    );
    return canonicalMessageId === undefined
      ? undefined
      : this.#messages.findChatMessage({ type: 'private', conversation }, canonicalMessageId);
  }

  /**
   * Sends what an account's client answered a reply keyboard button's request with to the bot of
   * its private chat, as a service message of the account that starts the chat, once the account
   * may write to the bot and `resolveContent` resolved the answer, which the caller validates.
   */
  sendAccountServiceMessage(
    { fromAccountId, botId }: { readonly fromAccountId: number; readonly botId: number },
    resolveContent: (conversation: PrivateConversationKey) => AccountServiceContentResolution,
  ): SendAccountServiceMessageResult {
    const senderResolution = this.#resolveAccountSender(fromAccountId, botId);
    if (!senderResolution.resolved) {
      return { sent: false, reason: senderResolution.reason };
    }
    const { account, bot } = senderResolution;
    const conversation: PrivateConversationKey = {
      accountId: account.profile.id,
      botId: bot.profile.id,
    };
    const resolution = resolveContent(conversation);
    if (!resolution.resolved) {
      return { sent: false, reason: resolution.reason };
    }
    // As any message the account writes does, the service message starts a chat the bot only
    // opened.
    this.#privateConversations.startPrivateConversation(conversation);
    return {
      sent: true,
      message: this.#storePrivateMessage({
        account,
        bot,
        sender: 'account',
        content: resolution.content,
      }),
    };
  }

  /**
   * Finds a message of the bot's private chat with an account by its ID in the bot's message box,
   * as the bot addresses a message it forwards or copies. The chat is known to the bot only once
   * the account has started a conversation with it.
   */
  getMessageForBot(
    { botId, accountId, botMessageId }: GetMessageForBotInput,
  ): GetMessageForBotResult {
    if (this.#bots.getById(botId) === undefined) {
      return { found: false, reason: 'bot_not_found' };
    }
    if (this.#accounts.getById(accountId) === undefined) {
      return { found: false, reason: 'account_not_found' };
    }
    const conversation: PrivateConversationKey = { accountId, botId };
    if (!this.#privateConversations.isPrivateConversationStarted(conversation)) {
      return { found: false, reason: 'conversation_not_started' };
    }
    const message = this.getPrivateMessageByBotMessageId(conversation, botMessageId);
    return message === undefined
      ? { found: false, reason: 'message_not_found' }
      : { found: true, message };
  }

  getPrivateMessageHistory(
    input: GetPrivateMessageHistoryInput,
  ): GetPrivateMessageHistoryResult {
    const account = this.#accounts.getById(input.accountId);
    if (account === undefined) {
      return { found: false, reason: 'account_not_found' };
    }
    const bot = this.#bots.getById(input.botId);
    if (bot === undefined) {
      return { found: false, reason: 'bot_not_found' };
    }

    return {
      found: true,
      messages: this.#messages.getChatMessages({ type: 'private', conversation: input }),
    };
  }

  /**
   * Finds the account that sends a message to its private chat with a bot, and the bot. As on
   * Telegram, an account that blocked the bot cannot send it messages.
   */
  #resolveAccountSender(accountId: number, botId: number):
    | { readonly resolved: true; readonly account: VirtualAccount; readonly bot: VirtualBot }
    | {
      readonly resolved: false;
      readonly reason: 'account_not_found' | 'bot_not_found' | 'bot_blocked';
    } {
    const account = this.#accounts.getById(accountId);
    if (account === undefined) {
      return { resolved: false, reason: 'account_not_found' };
    }
    const bot = this.#bots.getById(botId);
    if (bot === undefined) {
      return { resolved: false, reason: 'bot_not_found' };
    }
    if (this.#blockedUsers.isBlocked(account.profile.id, bot.profile.id)) {
      return { resolved: false, reason: 'bot_blocked' };
    }
    return { resolved: true, account, bot };
  }

  /**
   * Finds the account a bot sends a message to, their conversation, and what lets the bot write to
   * it. As on Telegram, a bot cannot initiate a private conversation, so the account must have
   * started one with the bot. Otherwise, as the Bot API documents for a join request's
   * `user_chat_id`, a pending join request of the account may let the bot contact it: such a
   * message claims the contact but starts no conversation, so the bot's access ends with the grant
   * unless the account writes to the bot. The grant covers sending messages only.
   */
  #findBotRecipient(bot: VirtualBot, to: BotPrivateChat):
    | {
      readonly found: true;
      readonly account: VirtualAccount;
      readonly conversation: PrivateConversationKey;
      readonly access: BotRecipientAccess;
    }
    | { readonly found: false; readonly reason: 'account_not_found' | 'conversation_not_started' } {
    const account = this.#accounts.getById(to.accountId);
    if (account === undefined) {
      return { found: false, reason: 'account_not_found' };
    }
    const conversation: PrivateConversationKey = {
      accountId: account.profile.id,
      botId: bot.profile.id,
    };
    if (this.#privateConversations.isPrivateConversationStarted(conversation)) {
      return { found: true, account, conversation, access: 'started_conversation' };
    }
    return this.#joinRequesterContacts.mayContactJoinRequester(bot.profile.id, account.profile.id)
      ? { found: true, account, conversation, access: 'join_request_contact' }
      : { found: false, reason: 'conversation_not_started' };
  }

  /**
   * Prepares the conversation for a bot's message that passed its checks: a message under a join
   * request's contact grant claims the contact and opens the conversation, which stays unstarted.
   */
  #admitBotMessage(conversation: PrivateConversationKey, access: BotRecipientAccess): void {
    if (access === 'join_request_contact') {
      this.#joinRequesterContacts.claimJoinRequesterContact(
        conversation.botId,
        conversation.accountId,
      );
      this.#privateConversations.openPrivateConversation(conversation);
    }
  }

  /**
   * Finds the message a bot's message replies to. As on Telegram, a target that is not found,
   * such as a deleted message, fails the send unless the bot allowed sending without a reply.
   */
  #resolveBotMessageReplyTarget(
    conversation: PrivateConversationKey,
    replyTo: BotMessageReplyTarget | undefined,
  ):
    | { readonly resolved: true; readonly repliedMessage?: PrivateMessage }
    | { readonly resolved: false } {
    if (replyTo === undefined) {
      return { resolved: true };
    }
    const repliedMessage = this.getPrivateMessageByBotMessageId(
      conversation,
      replyTo.botMessageId,
    );
    if (repliedMessage !== undefined) {
      return { resolved: true, repliedMessage };
    }
    return replyTo.allowSendingWithoutReply ? { resolved: true } : { resolved: false };
  }

  /**
   * Normalizes the text or caption of new content, with the entities its sender specified, as
   * Telegram does, and checks its length.
   */
  #normalizeContent(
    content: OutgoingMessageContent,
    sender: PrivateConversationRole,
  ): OutgoingContentNormalization {
    return normalizeOutgoingContent(content, sender, this.#textFixingContext);
  }

  /**
   * Sends content that passed its checks, such as an inline query result or a forward, from an
   * account to its private chat with a bot, which the account must not block. Its upload, if any,
   * is stored with the message.
   */
  #sendAccountPreparedMessage(
    fromAccountId: number,
    botId: number,
    { content, ...preparedMessage }: {
      readonly content: Exclude<NormalizedOutgoingContent, { readonly kind: 'poll' }>;
      readonly inlineKeyboard?: InlineKeyboard;
      readonly viaBotId?: number;
      readonly forwardInfo?: MessageForwardInfo;
    },
  ): SendAccountInlineResultResult {
    const senderResolution = this.#resolveAccountSender(fromAccountId, botId);
    if (!senderResolution.resolved) {
      return { sent: false, reason: senderResolution.reason };
    }
    const { account, bot } = senderResolution;

    this.#privateConversations.startPrivateConversation({
      accountId: account.profile.id,
      botId: bot.profile.id,
    });
    return {
      sent: true,
      message: this.#storePrivateMessage({
        ...preparedMessage,
        content: storeOutgoingContent(content, this.#files, this.#polls),
        account,
        bot,
        sender: 'account',
      }),
    };
  }

  /**
   * Stores the normalized contents of an album, with their uploads, as messages of an existing
   * private conversation that `#storePrivateMessage` stores one by one in order, sharing a new
   * album identifier unless the album holds a single message. Call it only once every message of
   * the album passed its checks.
   */
  #storePrivateAlbum(
    contents: readonly NormalizedOutgoingContent[],
    message: Omit<ParticipantMessage, 'content' | 'mediaGroupId'>,
  ): readonly PrivateMessage[] {
    const mediaGroupId = formsAlbum(contents.length)
      ? this.#messages.createMediaGroupId()
      : undefined;
    return contents.map((content) =>
      this.#storePrivateMessage({
        ...message,
        content: storeOutgoingContent(content, this.#files, this.#polls),
        mediaGroupId,
      })
    );
  }

  /**
   * Stores a message of an existing private conversation, numbers it in both participants' message
   * boxes, applies its change of the account's reply interface, and publishes its creation.
   */
  #storePrivateMessage({ account, bot, ...message }: ParticipantMessage): PrivateMessage {
    const conversation: PrivateConversationKey = {
      accountId: account.profile.id,
      botId: bot.profile.id,
    };
    const chat: PrivateChatKey = { type: 'private', conversation };
    const storedMessage = this.#messages.addMessage({
      ...message,
      chat,
      sentAtUnixSeconds: this.#currentUnixTimeSeconds(),
    });
    const { replyInterfaceMarkup } = storedMessage;
    // Only the bot's numbering is projected today; the account's keeps the stored model faithful
    // to Telegram.
    for (const boxOwnerId of privateChatMessagePolicy.getNumberingBoxOwnerIds(chat)) {
      this.#messageBoxes.assignMessageId(boxOwnerId, storedMessage.id);
    }
    // As TDLib does for a private chat: a keyboard or forced reply replaces what the client shows,
    // and a removal clears it.
    if (replyInterfaceMarkup !== undefined) {
      this.#privateConversations.setReplyInterfaceMessageId(
        conversation,
        replyInterfaceMarkup.kind === 'reply_keyboard_removal' ? undefined : storedMessage.id,
      );
    }
    // As TDLib's `updatePendingMessage` tells clients, any incoming message removes the bot's
    // draft: a sent, forwarded or copied message, an album's, or a service message of its pin.
    if (storedMessage.sender === 'bot') {
      this.#messageDrafts.clearBotDraft(conversation);
    }
    this.#events.emit({ type: 'message_created', message: storedMessage });

    return storedMessage;
  }
}
