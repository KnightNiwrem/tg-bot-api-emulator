import type { ChatDomainEvent } from '../types/chat_domain_event.ts';
import {
  holdsSupergroupAdministratorRight,
  resolveSupergroupBotMembership,
  type SupergroupBotAccessFailureReason,
  type SupergroupMembershipLookup,
} from '../types/chat_membership.ts';
import type { InlineKeyboard } from '../types/inline_keyboard.ts';
import type { Poll, PollId } from '../types/poll.ts';
import { type AlbumCompositionFailureReason, formsAlbum } from '../types/media_album.ts';
import type { ExternalReplyTarget } from '../types/message_reply.ts';
import type { MessageForward } from '../types/message_forward.ts';
import {
  appliesReplyInterfaceTo,
  type BotMessageReplyMarkup,
  findReplyKeyboardButton,
  type ReplyInterface,
  type ReplyInterfaceMarkup,
} from '../types/reply_interface.ts';
import type { VirtualAccount } from '../types/virtual_account.ts';
import type { VirtualBot } from '../types/virtual_bot.ts';
import type { ChatAction, Supergroup } from '../types/virtual_chat.ts';
import {
  canBotEditMessage,
  type CanonicalMessageId,
  type ChatMessage,
  type ExternalReply,
  getMessageAuthorId,
  type InlineMessageId,
  isSupergroupContentMessage,
  type MediaGroupId,
  mentionsUser,
  type MessageContent,
  type MessageForwardInfo,
  type SupergroupContentMessage,
  type SupergroupMessage,
  type SupergroupMessageAuthor,
  type SupergroupMessageContent,
  type SupergroupServiceContent,
  type TextQuote,
} from '../types/virtual_message.ts';
import {
  type AccountAlbumMediaContent,
  type AccountMessageContent,
  type AccountMessageEdit,
  checkBotMessageEdit,
  type ContentNormalizationFailure,
  type ContentReplacement,
  type ContentTextNormalizationFailure,
  type FileUploadStore,
  getReplyQuoteSource,
  hasOnlyValidButtonCallbackData,
  hasOnlyValidCallbackData,
  hasWebAppButton,
  isSameMessageContent,
  isUnchangedContent,
  type MediaContent,
  type NewPollStore,
  type NormalizedOutgoingContent,
  normalizeOutgoingAlbum,
  normalizeOutgoingContent,
  type OutgoingContentNormalization,
  type OutgoingMessageContent,
  replaceAccountMessageContent,
  replaceMessageCaption,
  replaceMessageMedia,
  replaceMessageText,
  resolveReplyQuote,
  type SpecifiedCaption,
  type SpecifiedQuote,
  storeOutgoingContent,
  type TextInvalidFailure,
  type TextMessageReplacement,
  toContentOfStoredFile,
  toOutgoingAccountContent,
  toOutgoingAccountMedia,
} from './message_content.ts';
import { findStoppablePoll, type PollStopFailureReason } from './poll.ts';

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
  | 'reply_message_not_found';

export type SendSupergroupAccountMessageResult =
  | { readonly sent: true; readonly message: SupergroupMessage }
  | (
    & { readonly sent: false }
    & ({ readonly reason: SendSupergroupAccountMessageFailureReason } | ContentNormalizationFailure)
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
          | Exclude<SendSupergroupAccountMessageFailureReason, 'message_text_empty'>
          | AlbumCompositionFailureReason;
      }
      | ContentTextNormalizationFailure
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
  /** Content the inline bot's answer holds, which Telegram checked when the bot answered. */
  readonly content: MessageContent;
  /** Omitted when the result sends no inline keyboard. */
  readonly inlineKeyboard?: InlineKeyboard;
}

export type SendSupergroupAccountInlineResultResult =
  | { readonly sent: true; readonly message: SupergroupMessage }
  | {
    readonly sent: false;
    readonly reason: 'account_not_found' | 'chat_not_found' | 'not_a_member';
  };

/** A forward that an account sends to a supergroup it is a member of. */
export interface SendSupergroupAccountForwardInput {
  readonly fromAccountId: number;
  readonly chatId: number;
  readonly forward: MessageForward;
}

export type SendSupergroupAccountForwardResult = SendSupergroupAccountInlineResultResult;

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
    & ({ readonly reason: SendSupergroupBotMessageFailureReason } | ContentNormalizationFailure)
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
  | { readonly sent: false; readonly reason: 'reply_keyboard_button_not_found' };

/**
 * The message a bot edits: one it sent to a supergroup, or one an account sent to a supergroup
 * through the bot's inline mode, which the bot addresses without being a member.
 */
type EditSupergroupBotMessageTarget =
  | {
    readonly fromBotId: number;
    readonly chatId: number;
    /** The supergroup's ID of the message. */
    readonly messageId: number;
  }
  | {
    readonly fromBotId: number;
    readonly inlineMessageId: InlineMessageId;
  };

export type EditSupergroupBotMessageTextInput = EditSupergroupBotMessageTarget & {
  /**
   * New text with the formatting the bot specified, which Telegram validates and normalizes, or a
   * new rich message.
   */
  readonly content: TextMessageReplacement;
  /** The keyboard the edited message shows; omitting it removes the message's keyboard. */
  readonly inlineKeyboard?: InlineKeyboard;
};

export type EditSupergroupBotMessageCaptionInput =
  & EditSupergroupBotMessageTarget
  & SpecifiedCaption
  & {
    /** Whether a photo or video shows its caption above itself; a document ignores it. */
    readonly showsCaptionAboveMedia: boolean;
    /** The keyboard the edited message shows; omitting it removes the message's keyboard. */
    readonly inlineKeyboard?: InlineKeyboard;
  };

export type EditSupergroupBotMessageMediaInput = EditSupergroupBotMessageTarget & {
  /** The new media and its caption with the formatting the bot specified. */
  readonly media: MediaContent;
  /** The keyboard the edited message shows; omitting it removes the message's keyboard. */
  readonly inlineKeyboard?: InlineKeyboard;
};

export type EditSupergroupBotMessageInlineKeyboardInput = EditSupergroupBotMessageTarget & {
  /** The keyboard the edited message shows; omitting it removes the message's keyboard. */
  readonly inlineKeyboard?: InlineKeyboard;
};

export type EditSupergroupBotMessageInlineKeyboardFailureReason =
  | 'bot_not_found'
  | SupergroupBotAccessFailureReason
  | 'message_not_found'
  | 'message_not_editable'
  | 'callback_data_invalid'
  | 'button_type_invalid'
  | 'message_not_modified';

/** A poll a bot stops through its message in a supergroup. */
export interface StopSupergroupBotPollInput {
  readonly fromBotId: number;
  readonly chatId: number;
  /** The supergroup's ID of the poll's message. */
  readonly messageId: number;
  /** The keyboard the poll's message shows once stopped; omitting it removes the keyboard. */
  readonly inlineKeyboard?: InlineKeyboard;
}

export type StopSupergroupBotPollResult =
  | { readonly stopped: true; readonly message: SupergroupMessage; readonly poll: Poll }
  | {
    readonly stopped: false;
    readonly reason:
      | 'bot_not_found'
      | SupergroupBotAccessFailureReason
      | 'message_not_found'
      | PollStopFailureReason
      | 'button_type_invalid'
      | 'callback_data_invalid';
  };

export type EditSupergroupBotMessageTextFailureReason =
  | EditSupergroupBotMessageInlineKeyboardFailureReason
  | 'message_text_empty'
  | 'message_has_no_text'
  | 'message_text_too_long';

export type EditSupergroupBotMessageCaptionFailureReason =
  | EditSupergroupBotMessageInlineKeyboardFailureReason
  | 'message_has_no_caption'
  | 'caption_too_long';

export type EditSupergroupBotMessageMediaFailureReason =
  | EditSupergroupBotMessageInlineKeyboardFailureReason
  /** As `EditBotMessageMediaFailureReason` describes it. */
  | 'message_media_not_editable'
  | 'caption_too_long'
  | 'album_media_kind_changed'
  | 'message_media_not_editable';

export type SupergroupMessageEditResult<FailureReason extends string> =
  | { readonly edited: true; readonly message: SupergroupMessage }
  | { readonly edited: false; readonly reason: FailureReason };

export type EditSupergroupBotMessageTextResult =
  | SupergroupMessageEditResult<EditSupergroupBotMessageTextFailureReason>
  | ({ readonly edited: false } & TextInvalidFailure);

export type EditSupergroupBotMessageCaptionResult =
  | SupergroupMessageEditResult<EditSupergroupBotMessageCaptionFailureReason>
  | ({ readonly edited: false } & TextInvalidFailure);

export type EditSupergroupBotMessageMediaResult =
  | SupergroupMessageEditResult<EditSupergroupBotMessageMediaFailureReason>
  | ({ readonly edited: false } & TextInvalidFailure);

export interface EditSupergroupAccountMessageInput {
  readonly fromAccountId: number;
  readonly chatId: number;
  /** The supergroup's ID of the message. */
  readonly messageId: number;
  readonly edit: AccountMessageEdit;
}

export type EditSupergroupAccountMessageFailureReason =
  | 'account_not_found'
  | 'chat_not_found'
  | 'not_a_member'
  | 'message_not_found'
  | 'message_not_editable'
  | 'message_text_empty'
  | 'message_has_no_text'
  | 'message_text_too_long'
  | 'message_has_no_caption'
  | 'caption_too_long'
  | 'message_not_modified';

export type EditSupergroupAccountMessageResult =
  | SupergroupMessageEditResult<EditSupergroupAccountMessageFailureReason>
  | ({ readonly edited: false } & TextInvalidFailure);

export interface DeleteSupergroupMessagesByBotInput {
  readonly fromBotId: number;
  readonly chatId: number;
  /** The supergroup's IDs of the messages. */
  readonly messageIds: readonly number[];
}

export type DeleteSupergroupMessagesByBotResult =
  | {
    readonly deleted: true;
    /** How many of the IDs identified a message of the supergroup, each deleted once. */
    readonly deletedMessageCount: number;
  }
  | {
    readonly deleted: false;
    readonly reason: 'bot_not_found' | SupergroupBotAccessFailureReason | 'message_not_deletable';
  };

export interface DeleteSupergroupAccountMessageInput {
  readonly fromAccountId: number;
  readonly chatId: number;
  /** The supergroup's ID of the message. */
  readonly messageId: number;
}

export type DeleteSupergroupAccountMessageResult =
  | { readonly deleted: true }
  | {
    readonly deleted: false;
    readonly reason:
      | 'account_not_found'
      | 'chat_not_found'
      | 'not_a_member'
      | 'message_not_found'
      | 'message_not_deletable';
  };

export interface SendSupergroupBotChatActionInput {
  readonly fromBotId: number;
  readonly chatId: number;
  readonly action: ChatAction;
}

export type SendSupergroupBotChatActionResult =
  | { readonly sent: true }
  | { readonly sent: false; readonly reason: 'bot_not_found' | SupergroupBotAccessFailureReason };

export interface RecordSupergroupServiceMessageInput {
  readonly chatId: number;
  /**
   * The member who made the change: the one who added members, left, removed a member, or changed
   * the title.
   */
  readonly author: SupergroupMessageAuthor;
  readonly content: SupergroupServiceContent;
  readonly changedAtUnixSeconds: number;
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

export interface GetSupergroupMessageForAccountInput {
  readonly accountId: number;
  readonly chatId: number;
  /** The supergroup's ID of the message. */
  readonly messageId: number;
}

export type GetSupergroupMessageForAccountResult =
  | { readonly found: true; readonly message: SupergroupMessage; readonly supergroup: Supergroup }
  | {
    readonly found: false;
    readonly reason: 'account_not_found' | 'chat_not_found' | 'not_a_member' | 'message_not_found';
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

/** A message to store, before the store gives it an identity. */
interface NewSupergroupMessage {
  readonly chatId: number;
  readonly author: SupergroupMessageAuthor;
  readonly sentAtUnixSeconds: number;
  readonly content: SupergroupMessageContent;
  readonly replyToMessageId?: CanonicalMessageId;
  readonly externalReply?: ExternalReply;
  readonly quote?: TextQuote;
  readonly mediaGroupId?: MediaGroupId;
  readonly inlineKeyboard?: InlineKeyboard;
  readonly viaBotId?: number;
  readonly forwardInfo?: MessageForwardInfo;
  readonly replyInterfaceMarkup?: ReplyInterfaceMarkup;
  readonly isContentProtected?: boolean;
  readonly isSilent?: boolean;
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
  addSupergroupMessage(input: NewSupergroupMessage): SupergroupMessage;
  getSupergroupMessage(messageId: CanonicalMessageId): SupergroupMessage | undefined;
  getMessageByInlineMessageId(inlineMessageId: InlineMessageId): ChatMessage | undefined;
  editSupergroupMessage(messageId: CanonicalMessageId, edit: {
    readonly content: MessageContent;
    readonly inlineKeyboard: InlineKeyboard | undefined;
    readonly contentEditedAtUnixSeconds: number | undefined;
  }): SupergroupMessage;
  deleteSupergroupMessage(messageId: CanonicalMessageId): void;
  getSupergroupMessages(chatId: number): readonly SupergroupMessage[];
}

/** Stores the polls bots send and closes the polls they stop. */
interface PollStore extends NewPollStore {
  getPoll(pollId: PollId): Poll | undefined;
  closePoll(pollId: PollId): Poll;
}

interface MessageBoxStore {
  assignMessageId(ownerId: number, canonicalMessageId: CanonicalMessageId): number;
  getMessageId(ownerId: number, canonicalMessageId: CanonicalMessageId): number | undefined;
  getCanonicalMessageId(ownerId: number, messageId: number): CanonicalMessageId | undefined;
}

interface ChatDomainEventSink {
  publish(event: ChatDomainEvent): void;
}

interface SupergroupMessagingServiceDependencies {
  readonly accounts: AccountLookup;
  readonly bots: BotLookup;
  readonly sharedChats: SupergroupMemberStore;
  readonly messages: SupergroupMessageStore;
  readonly files: FileUploadStore;
  readonly polls: PollStore;
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
 * Bots attach inline keyboards, edit their own messages, and delete them; as on Telegram, only an
 * administrator bot with the right to delete messages deletes other members'. Bots also show reply
 * keyboards and forced replies to all members or to chosen ones, which account members press or
 * answer. Accounts edit the text or caption of their own messages, and send inline query results
 * through inline bots, which edit the messages sent through them without being members.
 *
 * Results carry canonical messages; presenting them to an observer is left to the caller.
 */
export class SupergroupMessagingService {
  readonly #accounts: AccountLookup;
  readonly #bots: BotLookup;
  readonly #sharedChats: SupergroupMemberStore;
  readonly #messages: SupergroupMessageStore;
  readonly #files: FileUploadStore;
  readonly #polls: PollStore;
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
    this.#sharedChats = sharedChats;
    this.#messages = messages;
    this.#files = files;
    this.#polls = polls;
    this.#messageBoxes = messageBoxes;
    this.#events = events;
    this.#currentUnixTimeSeconds = currentUnixTimeSeconds;
  }

  /**
   * Sends text or captioned media from an account to a supergroup it is a member of. As a
   * Telegram client does, the text or caption is normalized, which marks bot commands.
   */
  sendAccountMessage(input: SendSupergroupAccountMessageInput): SendSupergroupAccountMessageResult {
    const memberResolution = this.#resolveAccountMember(input.fromAccountId, input.chatId);
    if (!memberResolution.resolved) {
      return { sent: false, reason: memberResolution.reason };
    }
    if (input.content.kind === 'text' && input.content.text.length === 0) {
      return { sent: false, reason: 'message_text_empty' };
    }
    const contentNormalization = this.#normalizeContent(
      toOutgoingAccountContent(input.content),
      'account',
    );
    if (!contentNormalization.normalized) {
      return { sent: false, ...contentNormalization.failure };
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
        chatId: input.chatId,
        author: { kind: 'account', accountId: input.fromAccountId },
        content: contentNormalization.content,
        replyToMessageId: repliedMessage?.id,
      }),
    };
  }

  /**
   * Sends a media album from an account to a supergroup it is a member of, as
   * `sendAccountMessage` sends one message. Every message of the album is checked before any is
   * stored, as `normalizeOutgoingAlbum` checks them, and every message replies to the same message.
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
    const repliedMessage = input.replyToMessageId === undefined
      ? undefined
      : this.getMessageByChatMessageId(input.chatId, input.replyToMessageId);
    if (input.replyToMessageId !== undefined && repliedMessage === undefined) {
      return { sent: false, reason: 'reply_message_not_found' };
    }

    return {
      sent: true,
      messages: this.#storeAlbum(albumNormalization.contents, {
        chatId: input.chatId,
        author: { kind: 'account', accountId: input.fromAccountId },
        replyToMessageId: repliedMessage?.id,
      }, repliedMessage),
    };
  }

  /**
   * Sends an inline query result from an account to a supergroup it is a member of, as the
   * account's message sent through the inline bot.
   */
  sendAccountInlineResult(
    input: SendSupergroupAccountInlineResultInput,
  ): SendSupergroupAccountInlineResultResult {
    const memberResolution = this.#resolveAccountMember(input.fromAccountId, input.chatId);
    if (!memberResolution.resolved) {
      return { sent: false, reason: memberResolution.reason };
    }
    return {
      sent: true,
      message: this.#commitMessage({
        chatId: input.chatId,
        author: { kind: 'account', accountId: input.fromAccountId },
        sentAtUnixSeconds: this.#currentUnixTimeSeconds(),
        content: input.content,
        inlineKeyboard: input.inlineKeyboard,
        viaBotId: input.viaBotId,
      }),
    };
  }

  /**
   * Sends a forward from an account to a supergroup it is a member of, as the account's message.
   */
  sendAccountForward(
    { fromAccountId, chatId, forward }: SendSupergroupAccountForwardInput,
  ): SendSupergroupAccountForwardResult {
    const memberResolution = this.#resolveAccountMember(fromAccountId, chatId);
    if (!memberResolution.resolved) {
      return { sent: false, reason: memberResolution.reason };
    }
    return {
      sent: true,
      message: this.#commitMessage({
        ...forward,
        chatId,
        author: { kind: 'account', accountId: fromAccountId },
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
   * caption is normalized with its entities next, and the result is checked for length. Callback
   * data is checked next, and a quote last, as Telegram's servers check it.
   */
  sendBotMessage(input: SendSupergroupBotMessageInput): SendSupergroupBotMessageResult {
    if (this.#bots.getById(input.fromBotId) === undefined) {
      return { sent: false, reason: 'bot_not_found' };
    }
    if (input.content.kind === 'text' && input.content.text.length === 0) {
      return { sent: false, reason: 'message_text_empty' };
    }
    const accessFailure = this.#checkBotAccess(input.fromBotId, input.chatId);
    if (accessFailure !== undefined) {
      return { sent: false, reason: accessFailure };
    }
    const repliedMessage = input.replyTo === undefined
      ? undefined
      : this.getMessageByChatMessageId(input.chatId, input.replyTo.messageId);
    if (
      input.replyTo !== undefined && repliedMessage === undefined &&
      !input.replyTo.allowSendingWithoutReply
    ) {
      return { sent: false, reason: 'reply_message_not_found' };
    }
    if (input.messageEffectId !== undefined) {
      return { sent: false, reason: 'message_effect_not_allowed_in_chat' };
    }
    const contentNormalization = this.#normalizeContent(input.content, 'bot');
    if (!contentNormalization.normalized) {
      return { sent: false, ...contentNormalization.failure };
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
        chatId: input.chatId,
        author: { kind: 'bot', botId: input.fromBotId },
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
   * Sends a media album from a bot to a supergroup it is a member of, as
   * `sendBotMessage` sends one message and in its order of checks, checking every message of the
   * album before any is stored: each caption is normalized, and the album is checked, as
   * `normalizeOutgoingAlbum` does. Every message replies to the same message, with the same quote.
   */
  sendBotAlbum(input: SendSupergroupBotAlbumInput): SendSupergroupBotAlbumResult {
    if (this.#bots.getById(input.fromBotId) === undefined) {
      return { sent: false, reason: 'bot_not_found' };
    }
    const accessFailure = this.#checkBotAccess(input.fromBotId, input.chatId);
    if (accessFailure !== undefined) {
      return { sent: false, reason: accessFailure };
    }
    const repliedMessage = input.replyTo === undefined
      ? undefined
      : this.getMessageByChatMessageId(input.chatId, input.replyTo.messageId);
    if (
      input.replyTo !== undefined && repliedMessage === undefined &&
      !input.replyTo.allowSendingWithoutReply
    ) {
      return { sent: false, reason: 'reply_message_not_found' };
    }
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
        chatId: input.chatId,
        author: { kind: 'bot', botId: input.fromBotId },
        replyToMessageId: repliedMessage?.id,
        externalReply: input.externalReply?.externalReply,
        quote: quoteResolution.quote,
        isContentProtected: input.isContentProtected,
        isSilent: input.isSilent,
      }, repliedMessage),
    };
  }

  /**
   * Replaces the text, entities, and inline keyboard of a text or rich message the bot sent, or
   * that was sent through its inline mode, with new text or a rich message, which may change the
   * message's kind. Only changed content dates the edit. As on Telegram, no bot receives an update
   * for a bot's message's edit; an edit of an account's message sent through a bot reaches the
   * supergroup's bots as the account's edited message.
   */
  editBotMessageText(input: EditSupergroupBotMessageTextInput): EditSupergroupBotMessageTextResult {
    if (this.#bots.getById(input.fromBotId) === undefined) {
      return { edited: false, reason: 'bot_not_found' };
    }
    if (input.content.kind === 'text' && input.content.text.length === 0) {
      return { edited: false, reason: 'message_text_empty' };
    }
    const resolution = this.#resolveEditableBotMessage(input);
    if (!resolution.resolved) {
      return { edited: false, reason: resolution.reason };
    }
    const { message } = resolution;
    return this.#editBotMessageContent(
      message,
      replaceMessageText(message.content, input.content, this.#textFixingContext),
      input.inlineKeyboard,
    );
  }

  /**
   * Replaces the caption, its entities, and the inline keyboard of captioned media the bot
   * sent, or that was sent through its inline mode; an empty caption removes it. Only a changed
   * caption dates the edit. Updates follow `editBotMessageText`.
   */
  editBotMessageCaption(
    input: EditSupergroupBotMessageCaptionInput,
  ): EditSupergroupBotMessageCaptionResult {
    if (this.#bots.getById(input.fromBotId) === undefined) {
      return { edited: false, reason: 'bot_not_found' };
    }
    const resolution = this.#resolveEditableBotMessage(input);
    if (!resolution.resolved) {
      return { edited: false, reason: resolution.reason };
    }
    const { message } = resolution;
    return this.#editBotMessageContent(
      message,
      replaceMessageCaption(message.content, input, 'bot', this.#textFixingContext),
      input.inlineKeyboard,
    );
  }

  /**
   * Replaces the content, with its caption, and the inline keyboard of a message the bot sent, or
   * that was sent through its inline mode, with new media, as `replaceMessageMedia` replaces it.
   * Only changed content dates the edit. Updates follow `editBotMessageText`.
   */
  editBotMessageMedia(
    input: EditSupergroupBotMessageMediaInput,
  ): EditSupergroupBotMessageMediaResult {
    if (this.#bots.getById(input.fromBotId) === undefined) {
      return { edited: false, reason: 'bot_not_found' };
    }
    const resolution = this.#resolveEditableBotMessage(input);
    if (!resolution.resolved) {
      return { edited: false, reason: resolution.reason };
    }
    const { message } = resolution;
    return this.#editBotMessageContent(
      message,
      replaceMessageMedia(message, input.media, this.#textFixingContext),
      input.inlineKeyboard,
    );
  }

  /**
   * Replaces the inline keyboard of a message the bot sent, or that was sent through its inline
   * mode, leaving its content as it is.
   */
  editBotMessageInlineKeyboard(
    input: EditSupergroupBotMessageInlineKeyboardInput,
  ): SupergroupMessageEditResult<EditSupergroupBotMessageInlineKeyboardFailureReason> {
    if (this.#bots.getById(input.fromBotId) === undefined) {
      return { edited: false, reason: 'bot_not_found' };
    }
    const resolution = this.#resolveEditableBotMessage(input);
    if (!resolution.resolved) {
      return { edited: false, reason: resolution.reason };
    }

    const { message } = resolution;
    return this.#editBotMessage(message, {
      content: { kind: 'existing', content: message.content },
      inlineKeyboard: input.inlineKeyboard,
      contentEditedAtUnixSeconds: message.contentEditedAtUnixSeconds,
    });
  }

  /**
   * Stops a poll the bot sent to a supergroup it is a member of, as for a private chat. As for
   * other edits in a supergroup, the new keyboard has no Web App button, which Telegram allows only
   * in private chats.
   */
  stopBotPoll(input: StopSupergroupBotPollInput): StopSupergroupBotPollResult {
    if (this.#bots.getById(input.fromBotId) === undefined) {
      return { stopped: false, reason: 'bot_not_found' };
    }
    const lookup = this.#findBotEditTarget(input);
    if (!lookup.resolved) {
      return { stopped: false, reason: lookup.reason };
    }
    const { message } = lookup;
    const pollLookup = findStoppablePoll(message, input.fromBotId, this.#polls);
    if (!pollLookup.found) {
      return { stopped: false, reason: pollLookup.reason };
    }
    if (!isSupergroupContentMessage(message)) {
      throw new Error(`Service message ${message.id} shows poll ${pollLookup.poll.id}`);
    }
    const { inlineKeyboard } = input;
    if (inlineKeyboard !== undefined) {
      if (hasWebAppButton(inlineKeyboard, { kind: 'existing', content: message.content })) {
        return { stopped: false, reason: 'button_type_invalid' };
      }
      if (!hasOnlyValidCallbackData(inlineKeyboard)) {
        return { stopped: false, reason: 'callback_data_invalid' };
      }
    }

    const stoppedPoll = this.#polls.closePoll(pollLookup.poll.id);
    const editedMessage = this.#messages.editSupergroupMessage(message.id, {
      content: message.content,
      inlineKeyboard,
      contentEditedAtUnixSeconds: message.contentEditedAtUnixSeconds,
    });
    this.#events.publish({ type: 'poll_stopped', poll: stoppedPoll });
    return { stopped: true, message: editedMessage, poll: stoppedPoll };
  }

  /**
   * Replaces the text or caption of a message the account wrote to the supergroup, which the
   * supergroup's bots may receive as an `edited_message` update. As when sending, the text is
   * normalized as a Telegram client does.
   */
  editAccountMessage(input: EditSupergroupAccountMessageInput): EditSupergroupAccountMessageResult {
    const memberResolution = this.#resolveAccountMember(input.fromAccountId, input.chatId);
    if (!memberResolution.resolved) {
      return { edited: false, reason: memberResolution.reason };
    }
    const message = this.getMessageByChatMessageId(input.chatId, input.messageId);
    if (message === undefined) {
      return { edited: false, reason: 'message_not_found' };
    }
    // As in TDLib, only the inline bot edits a message sent through it, and no one edits a forward.
    if (
      !isSupergroupContentMessage(message) || message.author.kind !== 'account' ||
      message.author.accountId !== input.fromAccountId || message.viaBot !== undefined ||
      message.forwardInfo !== undefined
    ) {
      return { edited: false, reason: 'message_not_editable' };
    }
    const replacement = replaceAccountMessageContent(
      message.content,
      input.edit,
      this.#textFixingContext,
    );
    if (!replacement.replaced) {
      return { edited: false, ...replacement.failure };
    }
    // An account edits only the text or caption of its message, which uploads no file.
    const content = toContentOfStoredFile(replacement.content);
    if (isSameMessageContent(content, message.content)) {
      return { edited: false, reason: 'message_not_modified' };
    }

    const editedMessage = this.#messages.editSupergroupMessage(message.id, {
      content,
      inlineKeyboard: message.inlineKeyboard,
      contentEditedAtUnixSeconds: this.#currentUnixTimeSeconds(),
    });
    this.#events.publish({ type: 'message_edited', message: editedMessage });
    return { edited: true, message: editedMessage };
  }

  /**
   * Deletes messages of a supergroup for every member. IDs that identify no message of the
   * supergroup, including messages already deleted, are skipped. As on Telegram, a bot deletes its
   * own messages, and any message, service messages included, as an administrator with the
   * `can_delete_messages` right; otherwise a message of another member cannot be deleted, and then
   * none is.
   */
  deleteMessagesByBot(
    input: DeleteSupergroupMessagesByBotInput,
  ): DeleteSupergroupMessagesByBotResult {
    if (this.#bots.getById(input.fromBotId) === undefined) {
      return { deleted: false, reason: 'bot_not_found' };
    }
    const botMembership = resolveSupergroupBotMembership(
      this.#sharedChats,
      input.fromBotId,
      input.chatId,
    );
    if (!botMembership.resolved) {
      return { deleted: false, reason: botMembership.reason };
    }
    const deletesAnyMessage = holdsSupergroupAdministratorRight(
      botMembership.membership,
      'can_delete_messages',
    );

    const messages = new Map<CanonicalMessageId, SupergroupMessage>();
    for (const messageId of input.messageIds) {
      const message = this.getMessageByChatMessageId(input.chatId, messageId);
      if (message === undefined) {
        continue;
      }
      const isOwnMessage = message.author.kind === 'bot' &&
        message.author.botId === input.fromBotId;
      if (!isOwnMessage && !deletesAnyMessage) {
        return { deleted: false, reason: 'message_not_deletable' };
      }
      messages.set(message.id, message);
    }
    for (const messageId of messages.keys()) {
      this.#messages.deleteSupergroupMessage(messageId);
    }
    return { deleted: true, deletedMessageCount: messages.size };
  }

  /**
   * Deletes a message of a supergroup for every member, as an account does from its client. As
   * TDLib's `can_delete_channel_message` allows, an account deletes the messages it wrote, and the
   * owner or an administrator with the `can_delete_messages` right deletes any message; a member
   * cannot delete a service message recording its own change. As for a bot's deletion, no bot
   * receives an update for it.
   */
  deleteAccountMessage(
    { fromAccountId, chatId, messageId }: DeleteSupergroupAccountMessageInput,
  ): DeleteSupergroupAccountMessageResult {
    const memberResolution = this.#resolveAccountMember(fromAccountId, chatId);
    if (!memberResolution.resolved) {
      return { deleted: false, reason: memberResolution.reason };
    }
    const message = this.getMessageByChatMessageId(chatId, messageId);
    if (message === undefined) {
      return { deleted: false, reason: 'message_not_found' };
    }
    const deletesAnyMessage = holdsSupergroupAdministratorRight(
      this.#sharedChats.getChatMembership(chatId, fromAccountId),
      'can_delete_messages',
    );
    const isOwnContentMessage = isSupergroupContentMessage(message) &&
      message.author.kind === 'account' && message.author.accountId === fromAccountId;
    if (!isOwnContentMessage && !deletesAnyMessage) {
      return { deleted: false, reason: 'message_not_deletable' };
    }
    this.#messages.deleteSupergroupMessage(message.id);
    return { deleted: true };
  }

  /**
   * Shows a chat action, such as typing, from a bot to a supergroup it is a member of. This checks
   * only that the bot may send it; the caller records the action members' clients show.
   */
  sendBotChatAction(
    { fromBotId, chatId }: SendSupergroupBotChatActionInput,
  ): SendSupergroupBotChatActionResult {
    if (this.#bots.getById(fromBotId) === undefined) {
      return { sent: false, reason: 'bot_not_found' };
    }
    const accessFailure = this.#checkBotAccess(fromBotId, chatId);
    return accessFailure === undefined ? { sent: true } : { sent: false, reason: accessFailure };
  }

  /**
   * Records a change of a supergroup, which the caller has made, as a service message of the member
   * who made it. As on Telegram, the service message is numbered like any message.
   */
  recordServiceMessage(
    { chatId, author, content, changedAtUnixSeconds }: RecordSupergroupServiceMessageInput,
  ): SupergroupMessage {
    return this.#commitMessage({
      chatId,
      author,
      sentAtUnixSeconds: changedAtUnixSeconds,
      content,
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
   * receives it even in privacy mode. The keyboard stays shown, as in a private chat.
   */
  pressReplyKeyboardButton(
    { fromAccountId, chatId, text }: PressSupergroupReplyKeyboardButtonInput,
  ): PressSupergroupReplyKeyboardButtonResult {
    const memberResolution = this.#resolveAccountMember(fromAccountId, chatId);
    if (!memberResolution.resolved) {
      return { sent: false, reason: memberResolution.reason };
    }
    const shownReplyInterface = this.#findShownReplyInterface(chatId, fromAccountId);
    if (
      shownReplyInterface?.replyInterface.kind !== 'reply_keyboard' ||
      findReplyKeyboardButton(shownReplyInterface.replyInterface, text) === undefined
    ) {
      return { sent: false, reason: 'reply_keyboard_button_not_found' };
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
    return { found: true, messages: this.#messages.getSupergroupMessages(chatId) };
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

  /**
   * Finds a message of a supergroup the account is a member of, as the account addresses a message
   * it forwards.
   */
  getMessageForAccount(
    { accountId, chatId, messageId }: GetSupergroupMessageForAccountInput,
  ): GetSupergroupMessageForAccountResult {
    const memberResolution = this.#resolveAccountMember(accountId, chatId);
    if (!memberResolution.resolved) {
      return { found: false, reason: memberResolution.reason };
    }
    const message = this.getMessageByChatMessageId(chatId, messageId);
    return message === undefined
      ? { found: false, reason: 'message_not_found' }
      : { found: true, message, supergroup: memberResolution.supergroup };
  }

  /** Finds a message of a supergroup by the ID the supergroup's message box gave it. */
  getMessageByChatMessageId(
    chatId: number,
    messageId: number,
  ): SupergroupMessage | undefined {
    const canonicalMessageId = this.#messageBoxes.getCanonicalMessageId(chatId, messageId);
    return canonicalMessageId === undefined
      ? undefined
      : this.#messages.getSupergroupMessage(canonicalMessageId);
  }

  #resolveAccountMember(
    accountId: number,
    chatId: number,
  ):
    | { readonly resolved: true; readonly supergroup: Supergroup }
    | {
      readonly resolved: false;
      readonly reason: 'account_not_found' | 'chat_not_found' | 'not_a_member';
    } {
    if (this.#accounts.getById(accountId) === undefined) {
      return { resolved: false, reason: 'account_not_found' };
    }
    const chat = this.#sharedChats.getSharedChat(chatId);
    if (chat?.kind !== 'supergroup') {
      return { resolved: false, reason: 'chat_not_found' };
    }
    if (this.#sharedChats.getChatMembership(chatId, accountId) === undefined) {
      return { resolved: false, reason: 'not_a_member' };
    }
    return { resolved: true, supergroup: chat };
  }

  /** Checks that the bot is a member of the supergroup, which it needs to act there. */
  #checkBotAccess(botId: number, chatId: number): SupergroupBotAccessFailureReason | undefined {
    const resolution = resolveSupergroupBotMembership(this.#sharedChats, botId, chatId);
    return resolution.resolved ? undefined : resolution.reason;
  }

  /**
   * Resolves the message an edit targets, found as `#findBotEditTarget` does, which the bot must
   * be allowed to edit. A service message has no content to edit.
   */
  #resolveEditableBotMessage(
    target: EditSupergroupBotMessageTarget,
  ):
    | { readonly resolved: true; readonly message: SupergroupContentMessage }
    | {
      readonly resolved: false;
      readonly reason:
        | SupergroupBotAccessFailureReason
        | 'message_not_found'
        | 'message_not_editable';
    } {
    const lookup = this.#findBotEditTarget(target);
    if (!lookup.resolved) {
      return lookup;
    }
    const { message } = lookup;
    return isSupergroupContentMessage(message) && canBotEditMessage(message, target.fromBotId)
      ? { resolved: true, message }
      : { resolved: false, reason: 'message_not_editable' };
  }

  /**
   * Finds the message an edit targets: a message of a supergroup the bot is a member of, or a
   * message sent through the bot's inline mode, which only that bot finds by its inline message
   * identifier, even outside its chats.
   */
  #findBotEditTarget(
    target: EditSupergroupBotMessageTarget,
  ):
    | { readonly resolved: true; readonly message: SupergroupMessage }
    | {
      readonly resolved: false;
      readonly reason: SupergroupBotAccessFailureReason | 'message_not_found';
    } {
    if ('inlineMessageId' in target) {
      const message = this.#messages.getMessageByInlineMessageId(target.inlineMessageId);
      return message?.kind === 'supergroup_message' && message.viaBot?.botId === target.fromBotId
        ? { resolved: true, message }
        : { resolved: false, reason: 'message_not_found' };
    }
    const { fromBotId, chatId, messageId } = target;
    const accessFailure = this.#checkBotAccess(fromBotId, chatId);
    if (accessFailure !== undefined) {
      return { resolved: false, reason: accessFailure };
    }
    const message = this.getMessageByChatMessageId(chatId, messageId);
    return message === undefined
      ? { resolved: false, reason: 'message_not_found' }
      : { resolved: true, message };
  }

  /**
   * Applies a bot's replacement of its message's content with the given keyboard; only changed
   * content dates the edit.
   */
  #editBotMessageContent<FailureReason extends string>(
    message: SupergroupContentMessage,
    replacement: ContentReplacement<FailureReason>,
    inlineKeyboard: InlineKeyboard | undefined,
  ):
    | SupergroupMessageEditResult<
      FailureReason | 'callback_data_invalid' | 'button_type_invalid' | 'message_not_modified'
    >
    | ({ readonly edited: false } & TextInvalidFailure) {
    if (!replacement.replaced) {
      return { edited: false, ...replacement.failure };
    }
    return this.#editBotMessage(message, {
      content: replacement.content,
      inlineKeyboard,
      contentEditedAtUnixSeconds: isUnchangedContent(replacement.content, message.content)
        ? message.contentEditedAtUnixSeconds
        : this.#currentUnixTimeSeconds(),
    });
  }

  /**
   * Validates, stores, and publishes a bot's edit of its message, which must change it. The new
   * content's upload is stored only once the edit passes its checks.
   */
  #editBotMessage(
    message: SupergroupContentMessage,
    { content, ...edit }: {
      readonly content: NormalizedOutgoingContent;
      readonly inlineKeyboard: InlineKeyboard | undefined;
      readonly contentEditedAtUnixSeconds: number | undefined;
    },
  ): SupergroupMessageEditResult<
    'callback_data_invalid' | 'button_type_invalid' | 'message_not_modified'
  > {
    if (hasWebAppButton(edit.inlineKeyboard, content)) {
      return { edited: false, reason: 'button_type_invalid' };
    }
    const editFailure = checkBotMessageEdit(message, { content, ...edit });
    if (editFailure !== undefined) {
      return { edited: false, reason: editFailure };
    }

    const editedMessage = this.#messages.editSupergroupMessage(message.id, {
      ...edit,
      content: storeOutgoingContent(content, this.#files, this.#polls),
    });
    this.#events.publish({ type: 'message_edited', message: editedMessage });
    return { edited: true, message: editedMessage };
  }

  /** A text mention may name any user of the session. */
  get #textFixingContext() {
    return {
      isMentionableUser: (userId: number) =>
        this.#accounts.getById(userId) !== undefined || this.#bots.getById(userId) !== undefined,
    };
  }

  /**
   * Normalizes the text or caption of new content, with the entities its sender specified, as
   * Telegram does, and checks its length.
   */
  #normalizeContent(
    content: OutgoingMessageContent,
    sender: SupergroupMessageAuthor['kind'],
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
    const storedMessage = this.#messages.addSupergroupMessage(message);
    this.#messageBoxes.assignMessageId(message.chatId, storedMessage.id);
    this.#events.publish({ type: 'message_created', message: storedMessage });
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
    for (const memberId of this.#sharedChats.getChatMemberIds(message.chatId)) {
      const account = this.#accounts.getById(memberId);
      // Bots' clients show no reply interface.
      if (account === undefined) {
        continue;
      }
      if (message.content.kind === 'member_left') {
        this.#removeReplyInterfaceSetBy(message.chatId, memberId, message.content.memberId);
        continue;
      }
      if (
        markup === undefined || !appliesReplyInterfaceTo(markup, {
          mentionsMember: mentionsUser(message.content, account.profile),
          repliesToMember: repliedMessage !== undefined &&
            getMessageAuthorId(repliedMessage) === memberId,
        })
      ) {
        continue;
      }
      if (markup.kind === 'reply_keyboard_removal') {
        this.#removeReplyInterfaceSetBy(message.chatId, memberId, getMessageAuthorId(message));
      } else {
        this.#sharedChats.setReplyInterfaceMessageId(message.chatId, memberId, message.id);
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
    const shownMessage = this.#messages.getSupergroupMessage(shownMessageId);
    if (shownMessage === undefined || getMessageAuthorId(shownMessage) === setterId) {
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
      : this.#messages.getSupergroupMessage(messageId);
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
