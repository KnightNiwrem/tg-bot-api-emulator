import type { ChatDomainEvent } from '../types/chat_domain_event.ts';
import type { InlineKeyboard } from '../types/inline_keyboard.ts';
import type { Poll, PollId } from '../types/poll.ts';
import { type AlbumCompositionFailureReason, formsAlbum } from '../types/media_album.ts';
import type { ExternalReplyTarget } from '../types/message_reply.ts';
import type { MessageForward } from '../types/message_forward.ts';
import {
  type BotMessageReplyMarkup,
  findReplyKeyboardButton,
  isRequestedPollType,
  type ReplyInterface,
  type ReplyInterfaceMarkup,
  type ReplyKeyboardRequestAnswer,
} from '../types/reply_interface.ts';
import type { VirtualAccount } from '../types/virtual_account.ts';
import type { VirtualBot } from '../types/virtual_bot.ts';
import type {
  ChatAction,
  PrivateConversation,
  PrivateConversationKey,
  PrivateConversationRole,
} from '../types/virtual_chat.ts';
import {
  canBotEditMessage,
  type CanonicalMessageId,
  type ChatMessage,
  type ExternalReply,
  type InlineMessageId,
  isPrivateContentMessage,
  type MediaGroupId,
  type MessageContent,
  type MessageForwardInfo,
  type MessagePinnedContent,
  type PrivateContentMessage,
  type PrivateMessage,
  type PrivateMessageContent,
  type TextQuote,
} from '../types/virtual_message.ts';
import type { FormattedTextFixingContext } from '../text_entities/formatted_text.ts';
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
import {
  resolveSharedChat,
  resolveSharedUsers,
  type SharedChatFailureReason,
  type SharedChatResolution,
  type SharedPeerLookups,
  type SharedUsersFailureReason,
  type SharedUsersResolution,
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
  readonly to: {
    readonly type: 'private';
    readonly botId: number;
  };
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
  readonly to: {
    readonly type: 'private';
    readonly botId: number;
  };
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
  readonly to: {
    readonly type: 'private';
    readonly botId: number;
  };
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
  readonly to: {
    readonly type: 'private';
    readonly botId: number;
  };
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

/**
 * The message a bot edits: one it sent to one of its private chats, or one an account sent to a
 * private chat through the bot's inline mode, which the bot addresses without being in the chat.
 */
type EditBotMessageTarget =
  | {
    readonly fromBotId: number;
    readonly chat: BotPrivateChat;
    /** The message's ID in the bot's message box. */
    readonly botMessageId: number;
  }
  | {
    readonly fromBotId: number;
    readonly inlineMessageId: InlineMessageId;
  };

export type EditBotMessageTextInput = EditBotMessageTarget & {
  /**
   * New text with the formatting the bot specified, which Telegram validates and normalizes, or a
   * new rich message.
   */
  readonly content: TextMessageReplacement;
  /** The keyboard the edited message shows; omitting it removes the message's keyboard. */
  readonly inlineKeyboard?: InlineKeyboard;
};

export type EditBotMessageCaptionInput = EditBotMessageTarget & SpecifiedCaption & {
  /** Whether a photo or video shows its caption above itself; a document ignores it. */
  readonly showsCaptionAboveMedia: boolean;
  /** The keyboard the edited message shows; omitting it removes the message's keyboard. */
  readonly inlineKeyboard?: InlineKeyboard;
};

export type EditBotMessageMediaInput = EditBotMessageTarget & {
  /** The new media and its caption with the formatting the bot specified. */
  readonly media: MediaContent;
  /** The keyboard the edited message shows; omitting it removes the message's keyboard. */
  readonly inlineKeyboard?: InlineKeyboard;
};

export type EditBotMessageInlineKeyboardInput = EditBotMessageTarget & {
  /** The keyboard the edited message shows; omitting it removes the message's keyboard. */
  readonly inlineKeyboard?: InlineKeyboard;
};

export type EditBotMessageInlineKeyboardFailureReason =
  | 'bot_not_found'
  | 'account_not_found'
  | 'conversation_not_started'
  | 'message_not_found'
  | 'message_not_editable'
  | 'callback_data_invalid'
  | 'message_not_modified';

/** A poll a bot stops through its message in one of its private chats. */
export interface StopBotPollInput {
  readonly fromBotId: number;
  readonly chat: BotPrivateChat;
  /** The ID of the poll's message in the bot's message box. */
  readonly botMessageId: number;
  /** The keyboard the poll's message shows once stopped; omitting it removes the keyboard. */
  readonly inlineKeyboard?: InlineKeyboard;
}

export type StopBotPollResult =
  | { readonly stopped: true; readonly message: PrivateMessage; readonly poll: Poll }
  | {
    readonly stopped: false;
    readonly reason:
      | 'bot_not_found'
      | 'account_not_found'
      | 'conversation_not_started'
      | 'message_not_found'
      | PollStopFailureReason
      | 'callback_data_invalid';
  };

export type EditBotMessageTextFailureReason =
  | EditBotMessageInlineKeyboardFailureReason
  | 'message_text_empty'
  | 'message_has_no_text'
  | 'message_text_too_long';

export type EditBotMessageCaptionFailureReason =
  | EditBotMessageInlineKeyboardFailureReason
  | 'message_has_no_caption'
  | 'caption_too_long';

export type EditBotMessageMediaFailureReason =
  | EditBotMessageInlineKeyboardFailureReason
  /** The message is a voice note, whose media TDLib does not let anyone edit. */
  | 'message_media_not_editable'
  | 'caption_too_long'
  | 'album_media_kind_changed'
  | 'message_media_not_editable';

export type PrivateMessageEditResult<FailureReason extends string> =
  | {
    readonly edited: true;
    readonly message: PrivateMessage;
  }
  | {
    readonly edited: false;
    readonly reason: FailureReason;
  };

export type EditBotMessageTextResult =
  | PrivateMessageEditResult<EditBotMessageTextFailureReason>
  | ({ readonly edited: false } & TextInvalidFailure);

export type EditBotMessageCaptionResult =
  | PrivateMessageEditResult<EditBotMessageCaptionFailureReason>
  | ({ readonly edited: false } & TextInvalidFailure);

export type EditBotMessageMediaResult =
  | PrivateMessageEditResult<EditBotMessageMediaFailureReason>
  | ({ readonly edited: false } & TextInvalidFailure);

export interface EditAccountMessageInput {
  readonly fromAccountId: number;
  readonly chat: {
    readonly type: 'private';
    readonly botId: number;
  };
  /** The message's ID in the bot's message box. */
  readonly botMessageId: number;
  readonly edit: AccountMessageEdit;
}

export type EditAccountMessageFailureReason =
  | 'account_not_found'
  | 'bot_not_found'
  | 'message_not_found'
  | 'message_not_editable'
  | 'message_text_empty'
  | 'message_has_no_text'
  | 'message_text_too_long'
  | 'message_has_no_caption'
  | 'caption_too_long'
  | 'message_not_modified';

export type EditAccountMessageResult =
  | PrivateMessageEditResult<EditAccountMessageFailureReason>
  | ({ readonly edited: false } & TextInvalidFailure);

export interface DeleteMessagesByBotInput {
  readonly fromBotId: number;
  readonly chat: BotPrivateChat;
  /** The messages' IDs in the bot's message box. */
  readonly botMessageIds: readonly number[];
}

export type DeleteMessagesByBotFailureReason =
  | 'bot_not_found'
  | 'account_not_found'
  | 'conversation_not_started';

export type DeleteMessagesByBotResult =
  | {
    readonly deleted: true;
    /** How many of the IDs identified a message of the chat, each deleted once. */
    readonly deletedMessageCount: number;
  }
  | {
    readonly deleted: false;
    readonly reason: DeleteMessagesByBotFailureReason;
  };

export interface DeleteAccountMessageInput {
  readonly fromAccountId: number;
  readonly botId: number;
  /** The message's ID in the bot's message box. */
  readonly botMessageId: number;
}

export type DeleteAccountMessageResult =
  | { readonly deleted: true }
  | {
    readonly deleted: false;
    readonly reason: 'account_not_found' | 'bot_not_found' | 'message_not_found';
  };

export interface SendBotChatActionInput {
  readonly fromBotId: number;
  readonly to: BotPrivateChat;
  readonly action: ChatAction;
}

export type SendBotChatActionResult =
  | { readonly sent: true }
  | {
    readonly sent: false;
    readonly reason:
      | 'bot_not_found'
      | 'account_not_found'
      | 'conversation_not_started'
      | 'bot_blocked';
  };

/** The message whose reply interface an account's client shows, with that interface. */
export interface ShownReplyInterface {
  readonly message: PrivateMessage;
  readonly replyInterface: ReplyInterface;
}

export type GetPrivateChatReplyInterfaceResult =
  | {
    readonly found: true;
    /** Omitted when the client shows its usual input. */
    readonly shownReplyInterface?: ShownReplyInterface;
  }
  | { readonly found: false; readonly reason: 'account_not_found' | 'bot_not_found' };

export interface PressReplyKeyboardButtonInput {
  readonly fromAccountId: number;
  readonly chat: {
    readonly type: 'private';
    readonly botId: number;
  };
  /** The text of the button to press. */
  readonly text: string;
  /**
   * What the account's client answers the button's request with, which only a button with a
   * request of the same kind takes and requires; omitted for any other button.
   */
  readonly answer?: ReplyKeyboardRequestAnswer;
}

export type PressReplyKeyboardButtonResult =
  | SendAccountMessageResult
  | {
    readonly sent: false;
    readonly reason:
      | 'reply_keyboard_button_not_found'
      | 'reply_keyboard_button_request_unsupported'
      | 'reply_keyboard_button_answer_missing'
      | 'reply_keyboard_button_answer_not_requested'
      | 'requested_poll_type_mismatch'
      | SharedUsersFailureReason
      | SharedChatFailureReason;
  };

export interface RecordPrivateServiceMessageInput {
  readonly conversation: PrivateConversationKey;
  /** The participant who made the change: the one who pinned a message. */
  readonly authorRole: PrivateConversationRole;
  /**
   * The pin, the one change a caller records; users and chats an account shares are recorded
   * only through `pressReplyKeyboardButton`, which validates them.
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

export interface GetMessageForAccountInput {
  readonly accountId: number;
  /** The bot at the other end of the account's private chat. */
  readonly botId: number;
  /** The message's ID in the bot's message box, which is how accounts address messages. */
  readonly botMessageId: number;
}

export type GetMessageForAccountResult =
  | { readonly found: true; readonly message: PrivateMessage }
  | {
    readonly found: false;
    readonly reason: 'account_not_found' | 'bot_not_found' | 'message_not_found';
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
  addPrivateMessage(input: {
    readonly conversation: PrivateConversationKey;
    readonly authorRole: PrivateConversationRole;
    readonly sentAtUnixSeconds: number;
    readonly content: PrivateMessageContent;
    readonly replyToMessageId?: CanonicalMessageId;
    readonly externalReply?: ExternalReply;
    readonly quote?: TextQuote;
    readonly mediaGroupId?: MediaGroupId;
    readonly inlineKeyboard?: InlineKeyboard;
    readonly replyInterfaceMarkup?: ReplyInterfaceMarkup;
    readonly viaBotId?: number;
    readonly forwardInfo?: MessageForwardInfo;
    readonly isContentProtected?: boolean;
    readonly isSilent?: boolean;
    readonly messageEffectId?: string;
  }): PrivateMessage;
  getPrivateMessage(messageId: CanonicalMessageId): PrivateMessage | undefined;
  getMessageByInlineMessageId(inlineMessageId: InlineMessageId): ChatMessage | undefined;
  editPrivateMessage(messageId: CanonicalMessageId, edit: {
    readonly content: MessageContent;
    readonly inlineKeyboard: InlineKeyboard | undefined;
    readonly contentEditedAtUnixSeconds: number | undefined;
  }): PrivateMessage;
  deletePrivateMessage(messageId: CanonicalMessageId): void;
  getPrivateConversationMessages(
    conversation: PrivateConversationKey,
  ): readonly PrivateMessage[];
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

interface BlockedUserLookup {
  isBlocked(accountId: number, userId: number): boolean;
}

interface ChatDomainEventSink {
  publish(event: ChatDomainEvent): void;
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
  /** The supergroups and memberships an account's chat sharing reads. */
  readonly sharedChats: SharedPeerLookups['sharedChats'];
  readonly privateConversations: PrivateConversationStore;
  readonly messages: PrivateMessageStore;
  readonly files: FileUploadStore;
  readonly polls: PollStore;
  readonly messageBoxes: MessageBoxStore;
  readonly blockedUsers: BlockedUserLookup;
  readonly joinRequesterContacts: JoinRequesterContactGrants;
  readonly events: ChatDomainEventSink;
  readonly currentUnixTimeSeconds: () => number;
}

/**
 * What lets a bot write to an account: the conversation the account started, or a pending join
 * request's contact grant.
 */
type BotRecipientAccess = 'started_conversation' | 'join_request_contact';

/**
 * A message of an existing private conversation to store, written by one of its participants,
 * whose file the caller stored.
 */
interface NewPrivateMessage {
  readonly account: VirtualAccount;
  readonly bot: VirtualBot;
  readonly authorRole: PrivateConversationRole;
  readonly content: PrivateMessageContent;
  readonly replyToMessageId?: CanonicalMessageId;
  readonly externalReply?: ExternalReply;
  readonly quote?: TextQuote;
  readonly mediaGroupId?: MediaGroupId;
  readonly inlineKeyboard?: InlineKeyboard;
  readonly replyInterfaceMarkup?: ReplyInterfaceMarkup;
  readonly viaBotId?: number;
  readonly forwardInfo?: MessageForwardInfo;
  readonly isContentProtected?: boolean;
  readonly isSilent?: boolean;
  readonly messageEffectId?: string;
}

/**
 * Carries out exchanges of text, captioned media, and media albums between an
 * account and a bot in their private conversation, including forwards by either and copies by the
 * bot, and commits each accepted message: its upload stored, the message stored, numbered for both
 * participants, then published. Bots can attach inline keyboards to their messages, edit them afterward, and delete
 * messages of their chats. A bot's message can also change the reply interface the account's
 * client shows, such as a reply keyboard whose buttons the account presses. An account edits the text or caption of its messages, and sends inline
 * query results through inline bots, which edit the messages sent through them.
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
  readonly #sharedPeers: SharedPeerLookups;
  readonly #textFixingContext: FormattedTextFixingContext;
  readonly #privateConversations: PrivateConversationStore;
  readonly #messages: PrivateMessageStore;
  readonly #files: FileUploadStore;
  readonly #polls: PollStore;
  readonly #messageBoxes: MessageBoxStore;
  readonly #blockedUsers: BlockedUserLookup;
  readonly #joinRequesterContacts: JoinRequesterContactGrants;
  readonly #events: ChatDomainEventSink;
  readonly #currentUnixTimeSeconds: () => number;

  constructor(
    {
      accounts,
      bots,
      sharedChats,
      privateConversations,
      messages,
      files,
      polls,
      messageBoxes,
      blockedUsers,
      joinRequesterContacts,
      events,
      currentUnixTimeSeconds,
    }: PrivateMessagingServiceDependencies,
  ) {
    this.#accounts = accounts;
    this.#bots = bots;
    this.#sharedPeers = { accounts, bots, sharedChats };
    this.#textFixingContext = createSessionUserMentionContext({ accounts, bots });
    this.#privateConversations = privateConversations;
    this.#messages = messages;
    this.#files = files;
    this.#polls = polls;
    this.#messageBoxes = messageBoxes;
    this.#blockedUsers = blockedUsers;
    this.#joinRequesterContacts = joinRequesterContacts;
    this.#events = events;
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
        authorRole: 'account',
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
        authorRole: 'account',
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
        authorRole: 'bot',
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
        authorRole: 'bot',
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
   * Replaces the text, entities, and inline keyboard of a text or rich message the bot sent, or
   * that was sent through its inline mode, with new text or a rich message, which may change the
   * message's kind. Only changed content dates the edit. As on Telegram, the bot receives no update
   * for its own message's edit; an edit of an account's message sent through the bot reaches the
   * chat's bot as the account's edited message.
   *
   * Checks follow Telegram's order: text is checked for emptiness before the message is resolved;
   * the content is then normalized, and text is checked for length.
   */
  editBotMessageText(input: EditBotMessageTextInput): EditBotMessageTextResult {
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
  editBotMessageCaption(input: EditBotMessageCaptionInput): EditBotMessageCaptionResult {
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
  editBotMessageMedia(input: EditBotMessageMediaInput): EditBotMessageMediaResult {
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
   * mode, leaving its content and edit date as they are. Updates follow `editBotMessageText`.
   */
  editBotMessageInlineKeyboard(
    input: EditBotMessageInlineKeyboardInput,
  ): PrivateMessageEditResult<EditBotMessageInlineKeyboardFailureReason> {
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
   * Stops a poll the bot sent to one of its private chats, as TDLib's `stop_poll` does: once the
   * message is found, the poll is found as `findStoppablePoll` finds it, and the new keyboard's
   * callback data must fit. The poll then accepts no more answers and keeps its votes, the message
   * shows the new keyboard, and the bot that sent the poll learns of its closure.
   */
  stopBotPoll(input: StopBotPollInput): StopBotPollResult {
    if (this.#bots.getById(input.fromBotId) === undefined) {
      return { stopped: false, reason: 'bot_not_found' };
    }
    const lookup = this.#findBotEditTarget(input);
    if (!lookup.resolved) {
      return { stopped: false, reason: lookup.reason };
    }
    const pollMessage = lookup.message;
    // A service message shows no poll.
    if (!isPrivateContentMessage(pollMessage)) {
      return { stopped: false, reason: 'message_has_no_poll' };
    }
    const pollLookup = findStoppablePoll(pollMessage, input.fromBotId, this.#polls);
    if (!pollLookup.found) {
      return { stopped: false, reason: pollLookup.reason };
    }
    if (input.inlineKeyboard !== undefined && !hasOnlyValidCallbackData(input.inlineKeyboard)) {
      return { stopped: false, reason: 'callback_data_invalid' };
    }

    const stoppedPoll = this.#polls.closePoll(pollLookup.poll.id);
    const message = this.#messages.editPrivateMessage(pollMessage.id, {
      content: pollMessage.content,
      inlineKeyboard: input.inlineKeyboard,
      contentEditedAtUnixSeconds: pollMessage.contentEditedAtUnixSeconds,
    });
    this.#events.publish({ type: 'poll_closed', poll: stoppedPoll });
    return { stopped: true, message, poll: stoppedPoll };
  }

  /**
   * Replaces the text or caption of a message the account wrote to the bot, other than one sent
   * through an inline bot, which, unlike a bot's own edit, sends the bot an `edited_message` update. As when sending, the text is normalized as
   * a Telegram client does, which marks bot commands again.
   */
  editAccountMessage(input: EditAccountMessageInput): EditAccountMessageResult {
    if (this.#accounts.getById(input.fromAccountId) === undefined) {
      return { edited: false, reason: 'account_not_found' };
    }
    if (this.#bots.getById(input.chat.botId) === undefined) {
      return { edited: false, reason: 'bot_not_found' };
    }
    const message = this.getPrivateMessageByBotMessageId(
      { accountId: input.fromAccountId, botId: input.chat.botId },
      input.botMessageId,
    );
    if (message === undefined) {
      return { edited: false, reason: 'message_not_found' };
    }
    // As in TDLib, only the inline bot edits a message sent through it, and no one edits a forward
    // or a service message.
    if (
      !isPrivateContentMessage(message) || message.authorRole !== 'account' ||
      message.viaBot !== undefined || message.forwardInfo !== undefined
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

    const editedMessage = this.#messages.editPrivateMessage(message.id, {
      content,
      inlineKeyboard: message.inlineKeyboard,
      contentEditedAtUnixSeconds: this.#currentUnixTimeSeconds(),
    });
    this.#events.publish({ type: 'message_edited', message: editedMessage });
    return { edited: true, message: editedMessage };
  }

  /**
   * Deletes messages of the bot's private chat for both participants. As on Telegram, a bot can
   * delete messages either participant wrote, and receives no update for the deletion. IDs that
   * identify no message of the chat, including messages already deleted, are skipped.
   *
   * A deleted message keeps its ID in each message box, because Telegram never reuses message IDs.
   * The emulator does not age messages, so Telegram's 48-hour deletion limit never applies.
   */
  deleteMessagesByBot(input: DeleteMessagesByBotInput): DeleteMessagesByBotResult {
    if (this.#bots.getById(input.fromBotId) === undefined) {
      return { deleted: false, reason: 'bot_not_found' };
    }
    if (this.#accounts.getById(input.chat.accountId) === undefined) {
      return { deleted: false, reason: 'account_not_found' };
    }
    const conversation: PrivateConversationKey = {
      accountId: input.chat.accountId,
      botId: input.fromBotId,
    };
    if (!this.#privateConversations.isPrivateConversationStarted(conversation)) {
      return { deleted: false, reason: 'conversation_not_started' };
    }

    let deletedMessageCount = 0;
    for (const botMessageId of input.botMessageIds) {
      const message = this.getPrivateMessageByBotMessageId(conversation, botMessageId);
      if (message === undefined) {
        continue;
      }
      this.#deleteMessage(conversation, message);
      deletedMessageCount++;
    }
    return { deleted: true, deletedMessageCount };
  }

  /**
   * Deletes a message of an account's private chat with a bot for both participants, as the
   * account's client does when it deletes a message for everyone. As TDLib's `can_revoke_message`
   * allows users in private chats, the account deletes the messages either participant wrote,
   * without a time limit. As for a bot's deletion, the bot receives no update for it.
   */
  deleteAccountMessage(
    { fromAccountId, botId, botMessageId }: DeleteAccountMessageInput,
  ): DeleteAccountMessageResult {
    if (this.#accounts.getById(fromAccountId) === undefined) {
      return { deleted: false, reason: 'account_not_found' };
    }
    if (this.#bots.getById(botId) === undefined) {
      return { deleted: false, reason: 'bot_not_found' };
    }
    const conversation: PrivateConversationKey = { accountId: fromAccountId, botId };
    const message = this.getPrivateMessageByBotMessageId(conversation, botMessageId);
    if (message === undefined) {
      return { deleted: false, reason: 'message_not_found' };
    }
    this.#deleteMessage(conversation, message);
    return { deleted: true };
  }

  /**
   * Deletes a message of a conversation. As TDLib does, deleting the message whose reply interface
   * the client shows removes the interface.
   */
  #deleteMessage(conversation: PrivateConversationKey, message: PrivateMessage): void {
    if (this.#privateConversations.getReplyInterfaceMessageId(conversation) === message.id) {
      this.#privateConversations.setReplyInterfaceMessageId(conversation, undefined);
    }
    this.#messages.deletePrivateMessage(message.id);
  }

  /**
   * Shows a chat action, such as typing, from a bot to an account. As for messages, the account
   * must have started a conversation with the bot and not block it. This checks only that the bot
   * may send it; the caller records the action the account's client shows.
   */
  sendBotChatAction({ fromBotId, to }: SendBotChatActionInput): SendBotChatActionResult {
    if (this.#bots.getById(fromBotId) === undefined) {
      return { sent: false, reason: 'bot_not_found' };
    }
    if (this.#accounts.getById(to.accountId) === undefined) {
      return { sent: false, reason: 'account_not_found' };
    }
    if (
      !this.#privateConversations.isPrivateConversationStarted({
        accountId: to.accountId,
        botId: fromBotId,
      })
    ) {
      return { sent: false, reason: 'conversation_not_started' };
    }
    return this.#blockedUsers.isBlocked(to.accountId, fromBotId)
      ? { sent: false, reason: 'bot_blocked' }
      : { sent: true };
  }

  /**
   * Records a change of a private conversation, which the caller has made, as a service message of
   * the participant who made it. As on Telegram, the service message is numbered like any message,
   * for both participants.
   */
  recordServiceMessage(
    { conversation, authorRole, content, isSilent }: RecordPrivateServiceMessageInput,
  ): PrivateMessage {
    const account = this.#accounts.getById(conversation.accountId);
    const bot = this.#bots.getById(conversation.botId);
    if (account === undefined || bot === undefined) {
      throw new Error(
        `Participants of conversation ${JSON.stringify(conversation)} do not exist`,
      );
    }
    return this.#storePrivateMessage({ account, bot, authorRole, content, isSilent });
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
    const message = canonicalMessageId === undefined
      ? undefined
      : this.#messages.getPrivateMessage(canonicalMessageId);
    if (
      message === undefined ||
      message.conversation.accountId !== conversation.accountId ||
      message.conversation.botId !== conversation.botId
    ) {
      return undefined;
    }
    return message;
  }

  /**
   * Returns the reply interface the account's client shows in its private chat with the bot: the
   * one the latest message that set it asked for, unless a later message removed it or that
   * message was deleted.
   */
  getPrivateChatReplyInterface(
    { accountId, botId }: PrivateConversationKey,
  ): GetPrivateChatReplyInterfaceResult {
    if (this.#accounts.getById(accountId) === undefined) {
      return { found: false, reason: 'account_not_found' };
    }
    if (this.#bots.getById(botId) === undefined) {
      return { found: false, reason: 'bot_not_found' };
    }
    const shownReplyInterface = this.#findShownReplyInterface({ accountId, botId });
    return shownReplyInterface === undefined
      ? { found: true }
      : { found: true, shownReplyInterface };
  }

  /**
   * Presses a button of the reply keyboard the account's client shows, which, as on Telegram,
   * sends the button's text to the bot as the account's message. The keyboard stays shown, even a
   * one-time keyboard, which Telegram clients only hide until the user shows it again.
   *
   * A button that requests the user's contact instead shares the account's own contact, as
   * `sendAccountMessage` sends it, in reply to the keyboard's message, as Telegram Desktop's
   * `ActivateBotCommand` and Telegram for Android's `shareMyContact` do once the user confirms.
   * A button that requests the user's location likewise shares the location the press answers
   * with, as Telegram for Android's `sendLocation` replies with the device's location. The bot
   * receives an ordinary contact or location message, which only its reply ties to the keyboard.
   *
   * A button that requests users or a chat shares those the press answers with, as
   * `resolveSharedUsers` and `resolveSharedChat` accept them, in a service message of the account
   * that carries the request's ID and replies to nothing, as TDLib shows it. A button that requests
   * a poll sends the poll the press answers with, as `sendAccountMessage` sends one, if it is of
   * the requested type; it replies to nothing, as Telegram Desktop's `ActivateBotCommand` opens
   * poll creation without a reply. Buttons with other requests cannot be pressed, which the
   * emulator does not model. A press that fails changes nothing.
   */
  pressReplyKeyboardButton(input: PressReplyKeyboardButtonInput): PressReplyKeyboardButtonResult {
    if (this.#accounts.getById(input.fromAccountId) === undefined) {
      return { sent: false, reason: 'account_not_found' };
    }
    if (this.#bots.getById(input.chat.botId) === undefined) {
      return { sent: false, reason: 'bot_not_found' };
    }
    const shownReplyInterface = this.#findShownReplyInterface({
      accountId: input.fromAccountId,
      botId: input.chat.botId,
    });
    const replyInterface = shownReplyInterface?.replyInterface;
    const button = replyInterface?.kind === 'reply_keyboard'
      ? findReplyKeyboardButton(replyInterface, input.text)
      : undefined;
    if (shownReplyInterface === undefined || button === undefined) {
      return { sent: false, reason: 'reply_keyboard_button_not_found' };
    }
    const { request } = button;
    const { answer } = input;
    if (answer !== undefined && answer.kind !== request?.kind) {
      return { sent: false, reason: 'reply_keyboard_button_answer_not_requested' };
    }

    switch (request?.kind) {
      case undefined:
        return this.sendAccountMessage({
          fromAccountId: input.fromAccountId,
          to: input.chat,
          content: { kind: 'text', text: input.text },
        });
      case 'contact':
        return this.sendAccountMessage({
          fromAccountId: input.fromAccountId,
          to: input.chat,
          content: { kind: 'own_contact' },
          replyToBotMessageId: this.#getBotMessageId(
            input.chat.botId,
            shownReplyInterface.message,
          ),
        });
      case 'location':
        if (answer?.kind !== 'location') {
          return { sent: false, reason: 'reply_keyboard_button_answer_missing' };
        }
        return this.sendAccountMessage({
          fromAccountId: input.fromAccountId,
          to: input.chat,
          content: { kind: 'location', location: answer.location },
          replyToBotMessageId: this.#getBotMessageId(
            input.chat.botId,
            shownReplyInterface.message,
          ),
        });
      case 'users':
        if (answer?.kind !== 'users') {
          return { sent: false, reason: 'reply_keyboard_button_answer_missing' };
        }
        return this.#sharePeers(
          input,
          () => resolveSharedUsers(request, answer.userIds, this.#sharedPeers),
        );
      case 'chat':
        if (answer?.kind !== 'chat') {
          return { sent: false, reason: 'reply_keyboard_button_answer_missing' };
        }
        return this.#sharePeers(
          input,
          (conversation) =>
            resolveSharedChat(request, answer.chatId, conversation, this.#sharedPeers),
        );
      case 'poll':
        if (answer?.kind !== 'poll') {
          return { sent: false, reason: 'reply_keyboard_button_answer_missing' };
        }
        if (!isRequestedPollType(request, answer.poll)) {
          return { sent: false, reason: 'requested_poll_type_mismatch' };
        }
        return this.sendAccountMessage({
          fromAccountId: input.fromAccountId,
          to: input.chat,
          content: { kind: 'poll', poll: answer.poll },
        });
      default:
        return { sent: false, reason: 'reply_keyboard_button_request_unsupported' };
    }
  }

  /**
   * Shares the users or chat an account chose with the bot of its private chat, as a service
   * message of the account that starts the chat, once the account may write to the bot and the
   * choice is resolved.
   */
  #sharePeers(
    { fromAccountId, chat }: PressReplyKeyboardButtonInput,
    resolve: (
      conversation: PrivateConversationKey,
    ) => SharedUsersResolution | SharedChatResolution,
  ): PressReplyKeyboardButtonResult {
    const senderResolution = this.#resolveAccountSender(fromAccountId, chat.botId);
    if (!senderResolution.resolved) {
      return { sent: false, reason: senderResolution.reason };
    }
    const { account, bot } = senderResolution;
    const conversation: PrivateConversationKey = {
      accountId: account.profile.id,
      botId: bot.profile.id,
    };
    const resolution = resolve(conversation);
    if (!resolution.resolved) {
      return { sent: false, reason: resolution.reason };
    }
    // As any message the account writes does, sharing starts a chat the bot only opened.
    this.#privateConversations.startPrivateConversation(conversation);
    return {
      sent: true,
      message: this.#storePrivateMessage({
        account,
        bot,
        authorRole: 'account',
        content: resolution.content,
      }),
    };
  }

  /** The ID by which a bot sees a message of its private chat, which its message box holds. */
  #getBotMessageId(botId: number, message: PrivateMessage): number {
    const botMessageId = this.#messageBoxes.getMessageId(botId, message.id);
    if (botMessageId === undefined) {
      throw new Error(`Message ${message.id} is missing from the message box of bot ${botId}`);
    }
    return botMessageId;
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

  /**
   * Finds a message of the account's private chat with a bot, as the account addresses a message
   * it forwards: by the message's ID in the bot's message box.
   */
  getMessageForAccount(
    { accountId, botId, botMessageId }: GetMessageForAccountInput,
  ): GetMessageForAccountResult {
    if (this.#accounts.getById(accountId) === undefined) {
      return { found: false, reason: 'account_not_found' };
    }
    if (this.#bots.getById(botId) === undefined) {
      return { found: false, reason: 'bot_not_found' };
    }
    const message = this.getPrivateMessageByBotMessageId({ accountId, botId }, botMessageId);
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

    return { found: true, messages: this.#messages.getPrivateConversationMessages(input) };
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

  #findShownReplyInterface(conversation: PrivateConversationKey): ShownReplyInterface | undefined {
    const messageId = this.#privateConversations.getReplyInterfaceMessageId(conversation);
    if (messageId === undefined) {
      return undefined;
    }
    const message = this.#messages.getPrivateMessage(messageId);
    const replyInterface = message?.replyInterfaceMarkup;
    if (
      message === undefined || replyInterface === undefined ||
      replyInterface.kind === 'reply_keyboard_removal'
    ) {
      throw new Error(`Reply interface message ${messageId} has no stored reply interface`);
    }
    return { message, replyInterface };
  }

  /**
   * Resolves the message an edit targets, found as `#findBotEditTarget` does, which the bot must
   * be allowed to edit. A service message has no content to edit.
   */
  #resolveEditableBotMessage(
    target: EditBotMessageTarget,
  ):
    | { readonly resolved: true; readonly message: PrivateContentMessage }
    | {
      readonly resolved: false;
      readonly reason:
        | 'account_not_found'
        | 'conversation_not_started'
        | 'message_not_found'
        | 'message_not_editable';
    } {
    const lookup = this.#findBotEditTarget(target);
    if (!lookup.resolved) {
      return lookup;
    }
    const { message } = lookup;
    return isPrivateContentMessage(message) && canBotEditMessage(message, target.fromBotId)
      ? { resolved: true, message }
      : { resolved: false, reason: 'message_not_editable' };
  }

  /**
   * Finds the message an edit targets: a message of one of the bot's private chats, or a message
   * sent through the bot's inline mode, which only that bot finds by its inline message identifier.
   */
  #findBotEditTarget(
    target: EditBotMessageTarget,
  ):
    | { readonly resolved: true; readonly message: PrivateMessage }
    | {
      readonly resolved: false;
      readonly reason: 'account_not_found' | 'conversation_not_started' | 'message_not_found';
    } {
    if ('inlineMessageId' in target) {
      const message = this.#findInlineMessage(target.inlineMessageId);
      return message?.viaBot?.botId === target.fromBotId
        ? { resolved: true, message }
        : { resolved: false, reason: 'message_not_found' };
    }
    const { fromBotId, chat, botMessageId } = target;
    if (this.#accounts.getById(chat.accountId) === undefined) {
      return { resolved: false, reason: 'account_not_found' };
    }
    const conversation: PrivateConversationKey = { accountId: chat.accountId, botId: fromBotId };
    if (!this.#privateConversations.isPrivateConversationStarted(conversation)) {
      return { resolved: false, reason: 'conversation_not_started' };
    }
    const message = this.getPrivateMessageByBotMessageId(conversation, botMessageId);
    return message === undefined
      ? { resolved: false, reason: 'message_not_found' }
      : { resolved: true, message };
  }

  /**
   * Applies a bot's replacement of its message's content with the given keyboard; only changed
   * content dates the edit.
   */
  #editBotMessageContent<FailureReason extends string>(
    message: PrivateContentMessage,
    replacement: ContentReplacement<FailureReason>,
    inlineKeyboard: InlineKeyboard | undefined,
  ):
    | PrivateMessageEditResult<FailureReason | 'callback_data_invalid' | 'message_not_modified'>
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
   * Validates, stores, and publishes a bot's edit of its message, which must change the message.
   * The new content's upload is stored only once the edit passes its checks.
   */
  #editBotMessage(
    message: PrivateContentMessage,
    { content, ...edit }: {
      readonly content: NormalizedOutgoingContent;
      readonly inlineKeyboard: InlineKeyboard | undefined;
      readonly contentEditedAtUnixSeconds: number | undefined;
    },
  ): PrivateMessageEditResult<'callback_data_invalid' | 'message_not_modified'> {
    const editFailure = checkBotMessageEdit(message, { content, ...edit });
    if (editFailure !== undefined) {
      return { edited: false, reason: editFailure };
    }

    const editedMessage = this.#messages.editPrivateMessage(message.id, {
      ...edit,
      content: storeOutgoingContent(content, this.#files, this.#polls),
    });
    this.#events.publish({ type: 'message_edited', message: editedMessage });
    return { edited: true, message: editedMessage };
  }

  /** Finds a private message sent through a bot's inline mode by its inline message identifier. */
  #findInlineMessage(inlineMessageId: InlineMessageId): PrivateMessage | undefined {
    const message = this.#messages.getMessageByInlineMessageId(inlineMessageId);
    return message?.kind === 'private_message' ? message : undefined;
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
        authorRole: 'account',
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
    message: Omit<NewPrivateMessage, 'content' | 'mediaGroupId'>,
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
  #storePrivateMessage(
    {
      account,
      bot,
      authorRole,
      content,
      replyToMessageId,
      externalReply,
      quote,
      mediaGroupId,
      inlineKeyboard,
      replyInterfaceMarkup,
      viaBotId,
      forwardInfo,
      isContentProtected,
      isSilent,
      messageEffectId,
    }: NewPrivateMessage,
  ): PrivateMessage {
    const conversation: PrivateConversationKey = {
      accountId: account.profile.id,
      botId: bot.profile.id,
    };
    const storedMessage = this.#messages.addPrivateMessage({
      conversation,
      authorRole,
      sentAtUnixSeconds: this.#currentUnixTimeSeconds(),
      content,
      replyToMessageId,
      externalReply,
      quote,
      mediaGroupId,
      inlineKeyboard,
      replyInterfaceMarkup,
      viaBotId,
      forwardInfo,
      isContentProtected,
      isSilent,
      messageEffectId,
    });
    // Telegram numbers a private message in each participant's message box. Only the bot's
    // numbering is projected today; the account's keeps the stored model faithful to Telegram.
    this.#messageBoxes.assignMessageId(account.profile.id, storedMessage.id);
    this.#messageBoxes.assignMessageId(bot.profile.id, storedMessage.id);
    // As TDLib does for a private chat: a keyboard or forced reply replaces what the client shows,
    // and a removal clears it.
    if (replyInterfaceMarkup !== undefined) {
      this.#privateConversations.setReplyInterfaceMessageId(
        conversation,
        replyInterfaceMarkup.kind === 'reply_keyboard_removal' ? undefined : storedMessage.id,
      );
    }
    this.#events.publish({ type: 'message_created', message: storedMessage });

    return storedMessage;
  }
}
