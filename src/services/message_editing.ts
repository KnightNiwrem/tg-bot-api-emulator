/**
 * Editing messages, written once for every chat type: bots edit the text, caption, media and
 * inline keyboard of their messages and stop their polls, and accounts edit the text or caption of
 * theirs. The edit mechanics are shared; what differs per chat type is how a sender reaches the
 * message, which its chat type's policy decides, and the few rules only some chats apply.
 *
 * @module
 */
import type { FormattedTextFixingContext } from '../text_entities/formatted_text.ts';
import type { ChatMembership, SupergroupBotAccessFailureReason } from '../types/chat_membership.ts';
import type {
  ChatMessageLookup,
  PrivateChatAccessPredicates,
  PrivateChatIdentityPolicy,
  SupergroupAccessPredicates,
  SupergroupIdentityPolicy,
} from '../types/chat_policy.ts';
import type { ChatDomainEvent } from '../types/chat_domain_event.ts';
import type { InlineKeyboard } from '../types/inline_keyboard.ts';
import type { Poll, PollId } from '../types/poll.ts';
import type { VirtualAccount } from '../types/virtual_account.ts';
import type { VirtualBot } from '../types/virtual_bot.ts';
import type {
  ChatKeyOfType,
  ChatType,
  PrivateChatAddress,
  PrivateChatKey,
  Supergroup,
  SupergroupChatAddress,
  SupergroupChatKey,
} from '../types/virtual_chat.ts';
import {
  canAccountEditMessage,
  canBotEditMessage,
  type CanonicalMessageId,
  type ChatMessage,
  type ChatMessageOfType,
  type ContentMessage,
  type InlineMessageId,
  isContentMessage,
  type MessageEdit,
  type PrivateMessage,
  type SupergroupMessage,
} from '../types/virtual_message.ts';
import {
  type AccountMessageEdit,
  checkBotMessageEdit,
  type ContentReplacement,
  type FileUploadStore,
  hasOnlyValidCallbackData,
  hasWebAppButton,
  isSameMessageContent,
  isUnchangedContent,
  type MediaContent,
  type NewPollStore,
  type NormalizedOutgoingContent,
  replaceAccountMessageContent,
  replaceMessageCaption,
  replaceMessageMedia,
  replaceMessageText,
  type SpecifiedCaption,
  storeOutgoingContent,
  type TextInvalidFailure,
  type TextMessageReplacement,
  toContentOfStoredFile,
} from './message_content.ts';
import { findStoppablePoll, type PollStopFailureReason } from './poll.ts';
import { createSessionUserMentionContext } from './session_user_mention.ts';
import {
  findMissingSendPermission,
  type SendPermissionMissingFailure,
} from './supergroup_messaging.ts';

/** A message of the bot's private chat with an account, which the bot edits. */
export interface BotPrivateChatMessageTarget {
  readonly fromBotId: number;
  /** The bot's private chat, by the account it is with. */
  readonly chat: PrivateChatAddress;
  /** The message's ID in the bot's message box. */
  readonly messageId: number;
}

/** A message of a supergroup, which a bot edits as a member. */
export interface BotSupergroupMessageTarget {
  readonly fromBotId: number;
  readonly chat: SupergroupChatAddress;
  /** The supergroup's ID of the message. */
  readonly messageId: number;
}

/**
 * A message an account sent through the bot's inline mode, which the bot edits by its inline
 * message identifier, in any chat, whether or not the bot is in it.
 */
export interface BotInlineMessageTarget {
  readonly fromBotId: number;
  readonly inlineMessageId: InlineMessageId;
}

/** A bot's new text, or rich message, for a text or rich message. */
export interface BotTextEdit {
  /**
   * New text with the formatting the bot specified, which Telegram validates and normalizes, or a
   * new rich message.
   */
  readonly content: TextMessageReplacement;
  /** The keyboard the edited message shows; omitting it removes the message's keyboard. */
  readonly inlineKeyboard?: InlineKeyboard;
}

/** A bot's new caption for captioned media; an empty caption removes it. */
export type BotCaptionEdit = SpecifiedCaption & {
  /** Whether a photo or video shows its caption above itself; other media ignores it. */
  readonly showsCaptionAboveMedia: boolean;
  /** The keyboard the edited message shows; omitting it removes the message's keyboard. */
  readonly inlineKeyboard?: InlineKeyboard;
};

/** A bot's new media, with its caption, for a message. */
export interface BotMediaEdit {
  /** The new media and its caption with the formatting the bot specified. */
  readonly media: MediaContent;
  /** The keyboard the edited message shows; omitting it removes the message's keyboard. */
  readonly inlineKeyboard?: InlineKeyboard;
}

/** A bot's new inline keyboard for a message, whose content stays as it is. */
export interface BotKeyboardEdit {
  /** The keyboard the edited message shows; omitting it removes the message's keyboard. */
  readonly inlineKeyboard?: InlineKeyboard;
}

/** A bot's stop of the poll of a message, which then shows the new keyboard. */
export interface BotPollStop {
  /** The keyboard the poll's message shows once stopped; omitting it removes the keyboard. */
  readonly inlineKeyboard?: InlineKeyboard;
}

/** An account's edit of the text or caption of its message in a private chat with a bot. */
export interface AccountPrivateChatMessageEdit {
  readonly fromAccountId: number;
  /** The account's private chat, by the bot it is with. */
  readonly chat: PrivateChatAddress;
  /** The message's ID in the bot's message box, by which accounts address private messages. */
  readonly messageId: number;
  readonly edit: AccountMessageEdit;
}

/** An account's edit of the text or caption of its message in a supergroup. */
export interface AccountSupergroupMessageEdit {
  readonly fromAccountId: number;
  readonly chat: SupergroupChatAddress;
  /** The supergroup's ID of the message. */
  readonly messageId: number;
  readonly edit: AccountMessageEdit;
}

/**
 * The types by which one way of reaching the message a bot edits differs from the others, which
 * the edit operations report precisely: what addresses the message, what reaching it finds, and
 * the failures only some ways produce.
 */
interface BotEditTargetingTypes {
  readonly target: { readonly fromBotId: number };
  /** The message reached, as its chat type's message, with what later checks need of its chat. */
  readonly reached: { readonly message: ChatMessage };
  /** Why the message is not reached: its chat cannot be, or it is not there. */
  readonly lookupFailureReason: string;
  /** Why the chat refuses the buttons of the edited message. */
  readonly buttonFailureReason: string;
  /** Why the bot may not show the new content in the chat. */
  readonly permissionFailure: { readonly reason: string };
}

/** A message the bot reached to edit, or why it did not. */
type BotEditTargetReach<Types extends BotEditTargetingTypes> =
  | ({ readonly reached: true } & Types['reached'])
  | { readonly reached: false; readonly reason: Types['lookupFailureReason'] };

/**
 * How a bot reaches the message it edits through one kind of target, and the rules of the chat it
 * reaches that only some chats apply. Every edit operation reaches the message first, decides
 * whether the bot may edit it, reads the new content, asks for the bot's right to show new rich or
 * media content, and checks the edited message's buttons before it changes anything.
 */
interface BotEditTargeting<Types extends BotEditTargetingTypes> {
  /** Finds the targeted message, checking the bot's access to its chat in the chat's order. */
  reachMessage(target: Types['target']): BotEditTargetReach<Types>;
  /**
   * The right the bot lacks to show new rich or media content in the reached chat, which TDLib's
   * `can_send_message_content` decides; `undefined` when it lacks none.
   */
  findMissingContentPermission(
    reached: Types['reached'],
    botId: number,
    content: NormalizedOutgoingContent,
  ): Types['permissionFailure'] | undefined;
  /** Why the message's chat refuses the buttons of the edited message; `undefined` when none. */
  findButtonFailure(
    message: Types['reached']['message'],
    inlineKeyboard: InlineKeyboard | undefined,
    content: NormalizedOutgoingContent,
  ): Types['buttonFailureReason'] | undefined;
  /** Stores the edit of the reached message and returns the message as the edit left it. */
  storeEdit(
    message: Types['reached']['message'],
    edit: MessageEdit,
  ): Types['reached']['message'];
}

/** A bot reaches a message of its private chat with an account by the bot's message box. */
export interface BotPrivateChatEditTypes {
  readonly target: BotPrivateChatMessageTarget;
  readonly reached: { readonly message: PrivateMessage };
  /**
   * The account does not exist, or never started the conversation: a join request's contact
   * grant lets the bot send messages there, but not edit them.
   */
  readonly lookupFailureReason:
    | 'account_not_found'
    | 'conversation_not_started'
    | 'message_not_found';
  readonly buttonFailureReason: never;
  readonly permissionFailure: never;
}

/**
 * A bot reaches a message of a supergroup as a member, whose membership decides the rights it
 * needs for new rich or media content. A supergroup refuses Web App buttons.
 */
export interface BotSupergroupEditTypes {
  readonly target: BotSupergroupMessageTarget;
  readonly reached: {
    readonly message: SupergroupMessage;
    readonly supergroup: Supergroup;
    readonly membership: ChatMembership;
  };
  readonly lookupFailureReason: SupergroupBotAccessFailureReason | 'message_not_found';
  readonly buttonFailureReason: 'button_type_invalid';
  readonly permissionFailure: SendPermissionMissingFailure;
}

/**
 * A bot reaches an inline message by its identifier alone, in a chat of any type: TDLib checks no
 * right for a message it has no chat to check in, and the message's chat decides its buttons.
 */
export interface BotInlineMessageEditTypes {
  readonly target: BotInlineMessageTarget;
  readonly reached: { readonly message: ChatMessage };
  /** The identifier names no message, a deleted one, or another bot's inline message. */
  readonly lookupFailureReason: 'message_not_found';
  readonly buttonFailureReason: 'button_type_invalid';
  readonly permissionFailure: never;
}

/** The edited message, or why the edit failed. */
type MessageEditOutcome<Edited extends ChatMessage, Failure extends { readonly reason: string }> =
  | { readonly edited: true; readonly message: Edited }
  | ({ readonly edited: false } & Failure);

/** Why a bot's edit fails before its new content is read: the bot, or the message it targets. */
type BotEditTargetFailureReason<Types extends BotEditTargetingTypes> =
  | 'bot_not_found'
  | Types['lookupFailureReason']
  | 'message_not_editable';

/** Why a bot's edited message is refused as a whole: its buttons, or because nothing changes. */
type BotEditedMessageFailureReason<Types extends BotEditTargetingTypes> =
  | Types['buttonFailureReason']
  | 'callback_data_invalid'
  | 'message_not_modified';

export type BotKeyboardEditResult<Types extends BotEditTargetingTypes> = MessageEditOutcome<
  Types['reached']['message'],
  { readonly reason: BotEditTargetFailureReason<Types> | BotEditedMessageFailureReason<Types> }
>;

export type BotTextEditResult<Types extends BotEditTargetingTypes> = MessageEditOutcome<
  Types['reached']['message'],
  | {
    readonly reason:
      | BotEditTargetFailureReason<Types>
      | 'message_text_empty'
      | 'message_has_no_text'
      | 'message_text_too_long'
      | BotEditedMessageFailureReason<Types>;
  }
  | TextInvalidFailure
  | Types['permissionFailure']
>;

export type BotCaptionEditResult<Types extends BotEditTargetingTypes> = MessageEditOutcome<
  Types['reached']['message'],
  | {
    readonly reason:
      | BotEditTargetFailureReason<Types>
      | 'message_has_no_caption'
      | 'caption_too_long'
      | BotEditedMessageFailureReason<Types>;
  }
  | TextInvalidFailure
>;

export type BotMediaEditResult<Types extends BotEditTargetingTypes> = MessageEditOutcome<
  Types['reached']['message'],
  | {
    readonly reason:
      | BotEditTargetFailureReason<Types>
      /**
       * The message is a voice note, a poll, a contact, or a location, whose media TDLib does not
       * let anyone edit.
       */
      | 'message_media_not_editable'
      | 'caption_too_long'
      /**
       * The message belongs to an album, and either it or the new media is a document or an audio
       * file, which an album keeps to its own kind.
       */
      | 'album_media_kind_changed'
      | BotEditedMessageFailureReason<Types>;
  }
  | TextInvalidFailure
  | Types['permissionFailure']
>;

export type BotPollStopResult<Types extends BotEditTargetingTypes> =
  | {
    readonly stopped: true;
    readonly message: Types['reached']['message'];
    readonly poll: Poll;
  }
  | {
    readonly stopped: false;
    readonly reason:
      | 'bot_not_found'
      | Types['lookupFailureReason']
      | PollStopFailureReason
      | Types['buttonFailureReason']
      | 'callback_data_invalid';
  };

/**
 * The types by which an account reaches its message in a chat of one type: the message, and why
 * it is not reached.
 */
interface AccountEditTargetingTypes {
  readonly target: { readonly fromAccountId: number; readonly messageId: number };
  readonly message: ChatMessage;
  readonly lookupFailureReason: string;
}

/** How an account reaches its message in a chat of one type, and stores its edit there. */
interface AccountEditTargeting<Types extends AccountEditTargetingTypes> {
  /**
   * Finds the message of an existing account, checking the account's access to its chat in the
   * chat's order.
   */
  reachMessage(
    target: Types['target'],
  ):
    | { readonly reached: true; readonly message: Types['message'] }
    | { readonly reached: false; readonly reason: Types['lookupFailureReason'] };
  storeEdit(message: Types['message'], edit: MessageEdit): Types['message'];
}

/** An account reaches its private chat with a bot by the bot's ID, without starting it. */
export interface AccountPrivateChatEditTypes {
  readonly target: AccountPrivateChatMessageEdit;
  readonly message: PrivateMessage;
  readonly lookupFailureReason: 'bot_not_found' | 'message_not_found';
}

/** An account reaches a supergroup as a member. */
export interface AccountSupergroupEditTypes {
  readonly target: AccountSupergroupMessageEdit;
  readonly message: SupergroupMessage;
  readonly lookupFailureReason: 'chat_not_found' | 'not_a_member' | 'message_not_found';
}

export type AccountEditResult<Types extends AccountEditTargetingTypes> = MessageEditOutcome<
  Types['message'],
  | {
    readonly reason:
      | 'account_not_found'
      | Types['lookupFailureReason']
      | 'message_not_editable'
      | 'message_text_empty'
      | 'message_has_no_text'
      | 'message_text_too_long'
      | 'message_has_no_caption'
      | 'caption_too_long'
      | 'message_not_modified';
  }
  | TextInvalidFailure
>;

interface AccountLookup {
  getById(accountId: number): VirtualAccount | undefined;
}

interface BotLookup {
  getById(botId: number): VirtualBot | undefined;
}

/** Finds and stores edited messages, each by its chat, and finds inline messages. */
interface EditedMessageStore {
  getMessageByInlineMessageId(inlineMessageId: InlineMessageId): ChatMessage | undefined;
  editMessage<Type extends ChatType>(
    chat: ChatKeyOfType<Type>,
    messageId: CanonicalMessageId,
    edit: MessageEdit,
  ): ChatMessageOfType<Type>;
}

/** Stores the polls of new content and closes the polls bots stop. */
interface PollStore extends NewPollStore {
  getPoll(pollId: PollId): Poll | undefined;
  closePoll(pollId: PollId): Poll;
}

/** Takes each event into the transaction of the command that caused it. */
interface ChatDomainEventSink {
  emit(event: ChatDomainEvent): void;
}

interface MessageEditingDependencies {
  readonly accounts: AccountLookup;
  readonly bots: BotLookup;
  readonly privateChats: PrivateChatEditingPolicy;
  readonly supergroups: SupergroupEditingPolicy;
  readonly messages: EditedMessageStore;
  readonly files: FileUploadStore;
  readonly polls: PollStore;
  readonly events: ChatDomainEventSink;
  readonly currentUnixTimeSeconds: () => number;
}

/**
 * Edits messages of every chat type, as Telegram does. A bot edits its own messages, and the
 * messages accounts sent through its inline mode, which it addresses by their inline message
 * identifiers in any chat; it stops its own polls. An account edits the text or caption of its own
 * messages, other than those sent through an inline bot, which only that bot edits.
 *
 * Each sender and target has its own entry point, which reports exactly the failures its chat type
 * can produce, in Telegram's order. Only changed content dates an edit. As on Telegram, no bot
 * receives an update for a bot's edit; an edit of an account's message, sent directly or through
 * an inline bot, reaches the chat's bots as the account's edited message.
 */
export class MessageEditingService {
  readonly #accounts: AccountLookup;
  readonly #bots: BotLookup;
  readonly #messages: EditedMessageStore;
  readonly #textFixingContext: FormattedTextFixingContext;
  readonly #files: FileUploadStore;
  readonly #polls: PollStore;
  readonly #events: ChatDomainEventSink;
  readonly #currentUnixTimeSeconds: () => number;
  readonly #privateChatTargeting: BotEditTargeting<BotPrivateChatEditTypes>;
  readonly #supergroupTargeting: BotEditTargeting<BotSupergroupEditTypes>;
  readonly #inlineMessageTargeting: BotEditTargeting<BotInlineMessageEditTypes>;
  readonly #accountPrivateChatTargeting: AccountEditTargeting<AccountPrivateChatEditTypes>;
  readonly #accountSupergroupTargeting: AccountEditTargeting<AccountSupergroupEditTypes>;

  constructor(
    {
      accounts,
      bots,
      privateChats,
      supergroups,
      messages,
      files,
      polls,
      events,
      currentUnixTimeSeconds,
    }: MessageEditingDependencies,
  ) {
    this.#accounts = accounts;
    this.#bots = bots;
    this.#textFixingContext = createSessionUserMentionContext({ accounts, bots });
    this.#messages = messages;
    this.#files = files;
    this.#polls = polls;
    this.#events = events;
    this.#currentUnixTimeSeconds = currentUnixTimeSeconds;

    this.#privateChatTargeting = createBotPrivateChatTargeting(privateChats, messages);
    this.#supergroupTargeting = createBotSupergroupTargeting(supergroups, messages);
    this.#inlineMessageTargeting = createBotInlineMessageTargeting(messages);
    this.#accountPrivateChatTargeting = createAccountPrivateChatTargeting(privateChats, messages);
    this.#accountSupergroupTargeting = createAccountSupergroupTargeting(supergroups, messages);
  }

  /**
   * Finds a message sent through the bot's inline mode by its inline message identifier, in any
   * chat; another bot's inline message is not found.
   */
  findBotInlineMessage(botId: number, inlineMessageId: InlineMessageId): ChatMessage | undefined {
    return findBotInlineMessage(this.#messages, botId, inlineMessageId);
  }

  /**
   * Replaces the text, entities, and inline keyboard of a text or rich message of the bot's
   * private chat with new text or a rich message, which may change the message's kind.
   *
   * Checks follow Telegram's order: text is checked for emptiness before the message is found;
   * the content is then normalized, and text is checked for length.
   */
  editPrivateChatMessageText(
    input: BotPrivateChatMessageTarget & BotTextEdit,
  ): BotTextEditResult<BotPrivateChatEditTypes> {
    return this.#editText(this.#privateChatTargeting, input);
  }

  /**
   * Replaces the text of a text or rich message of a supergroup, as in a private chat. As TDLib's
   * `edit_message_text` does, only a rich message is checked as new content, against the bot's
   * rights in the supergroup.
   */
  editSupergroupMessageText(
    input: BotSupergroupMessageTarget & BotTextEdit,
  ): BotTextEditResult<BotSupergroupEditTypes> {
    return this.#editText(this.#supergroupTargeting, input);
  }

  /** Replaces the text of an inline message sent through the bot, as in its chat. */
  editInlineMessageText(
    input: BotInlineMessageTarget & BotTextEdit,
  ): BotTextEditResult<BotInlineMessageEditTypes> {
    return this.#editText(this.#inlineMessageTargeting, input);
  }

  /**
   * Replaces the caption, its entities, and the inline keyboard of captioned media of the bot's
   * private chat; an empty caption removes it. Only a changed caption dates the edit.
   */
  editPrivateChatMessageCaption(
    input: BotPrivateChatMessageTarget & BotCaptionEdit,
  ): BotCaptionEditResult<BotPrivateChatEditTypes> {
    return this.#editCaption(this.#privateChatTargeting, input);
  }

  /** Replaces the caption of captioned media of a supergroup, as in a private chat. */
  editSupergroupMessageCaption(
    input: BotSupergroupMessageTarget & BotCaptionEdit,
  ): BotCaptionEditResult<BotSupergroupEditTypes> {
    return this.#editCaption(this.#supergroupTargeting, input);
  }

  /** Replaces the caption of captioned media sent through the bot, as in its chat. */
  editInlineMessageCaption(
    input: BotInlineMessageTarget & BotCaptionEdit,
  ): BotCaptionEditResult<BotInlineMessageEditTypes> {
    return this.#editCaption(this.#inlineMessageTargeting, input);
  }

  /**
   * Replaces the content, with its caption, and the inline keyboard of a message of the bot's
   * private chat with new media, as `replaceMessageMedia` replaces it.
   */
  editPrivateChatMessageMedia(
    input: BotPrivateChatMessageTarget & BotMediaEdit,
  ): BotMediaEditResult<BotPrivateChatEditTypes> {
    return this.#editMedia(this.#privateChatTargeting, input);
  }

  /**
   * Replaces the media of a message of a supergroup, as in a private chat. As TDLib's
   * `edit_message_media` does, the new media is checked against the bot's rights there.
   */
  editSupergroupMessageMedia(
    input: BotSupergroupMessageTarget & BotMediaEdit,
  ): BotMediaEditResult<BotSupergroupEditTypes> {
    return this.#editMedia(this.#supergroupTargeting, input);
  }

  /** Replaces the media of a message sent through the bot, as in its chat. */
  editInlineMessageMedia(
    input: BotInlineMessageTarget & BotMediaEdit,
  ): BotMediaEditResult<BotInlineMessageEditTypes> {
    return this.#editMedia(this.#inlineMessageTargeting, input);
  }

  /**
   * Replaces the inline keyboard of a message of the bot's private chat, leaving its content and
   * edit date as they are.
   */
  editPrivateChatMessageKeyboard(
    input: BotPrivateChatMessageTarget & BotKeyboardEdit,
  ): BotKeyboardEditResult<BotPrivateChatEditTypes> {
    return this.#editKeyboard(this.#privateChatTargeting, input);
  }

  /** Replaces the inline keyboard of a message of a supergroup, as in a private chat. */
  editSupergroupMessageKeyboard(
    input: BotSupergroupMessageTarget & BotKeyboardEdit,
  ): BotKeyboardEditResult<BotSupergroupEditTypes> {
    return this.#editKeyboard(this.#supergroupTargeting, input);
  }

  /** Replaces the inline keyboard of a message sent through the bot, as in its chat. */
  editInlineMessageKeyboard(
    input: BotInlineMessageTarget & BotKeyboardEdit,
  ): BotKeyboardEditResult<BotInlineMessageEditTypes> {
    return this.#editKeyboard(this.#inlineMessageTargeting, input);
  }

  /**
   * Stops a poll the bot sent to its private chat, as TDLib's `stop_poll` does: once the message
   * is found, the poll is found as `findStoppablePoll` finds it, and the new keyboard's callback
   * data must fit. The poll then accepts no more answers and keeps its votes, the message shows
   * the new keyboard, and the bot that sent the poll learns of its closure.
   */
  stopPrivateChatPoll(
    input: BotPrivateChatMessageTarget & BotPollStop,
  ): BotPollStopResult<BotPrivateChatEditTypes> {
    return this.#stopPoll(this.#privateChatTargeting, input);
  }

  /**
   * Stops a poll the bot sent to a supergroup it is a member of, as in a private chat; as for its
   * edits, the new keyboard has no Web App button.
   */
  stopSupergroupPoll(
    input: BotSupergroupMessageTarget & BotPollStop,
  ): BotPollStopResult<BotSupergroupEditTypes> {
    return this.#stopPoll(this.#supergroupTargeting, input);
  }

  /**
   * Replaces the text or caption of a message the account wrote to the bot, which, unlike a bot's
   * own edit, sends the bot an `edited_message` update. As when sending, the text is normalized as
   * a Telegram client does, which marks bot commands again.
   */
  editAccountPrivateChatMessage(
    input: AccountPrivateChatMessageEdit,
  ): AccountEditResult<AccountPrivateChatEditTypes> {
    return this.#editAccountMessage(this.#accountPrivateChatTargeting, input);
  }

  /**
   * Replaces the text or caption of a message the account wrote to a supergroup it is a member
   * of, which the supergroup's bots may receive as an `edited_message` update.
   */
  editAccountSupergroupMessage(
    input: AccountSupergroupMessageEdit,
  ): AccountEditResult<AccountSupergroupEditTypes> {
    return this.#editAccountMessage(this.#accountSupergroupTargeting, input);
  }

  #editText<Types extends BotEditTargetingTypes>(
    targeting: BotEditTargeting<Types>,
    input: Types['target'] & BotTextEdit,
  ): BotTextEditResult<Types> {
    if (this.#bots.getById(input.fromBotId) === undefined) {
      return { edited: false, reason: 'bot_not_found' };
    }
    if (input.content.kind === 'text' && input.content.text.length === 0) {
      return { edited: false, reason: 'message_text_empty' };
    }
    const target = this.#reachEditableMessage(targeting, input);
    if (!target.found) {
      return { edited: false, reason: target.reason };
    }
    const { reached, message } = target;
    const replacement = replaceMessageText(message.content, input.content, this.#textFixingContext);
    // As TDLib's `edit_message_text` does, only a rich message is checked as new content.
    const permissionFailure = replacement.replaced && replacement.content.kind === 'rich_message'
      ? targeting.findMissingContentPermission(reached, input.fromBotId, replacement.content)
      : undefined;
    if (permissionFailure !== undefined) {
      return { edited: false, ...permissionFailure };
    }
    return this.#applyContentReplacement(targeting, message, replacement, input.inlineKeyboard);
  }

  #editCaption<Types extends BotEditTargetingTypes>(
    targeting: BotEditTargeting<Types>,
    input: Types['target'] & BotCaptionEdit,
  ): BotCaptionEditResult<Types> {
    if (this.#bots.getById(input.fromBotId) === undefined) {
      return { edited: false, reason: 'bot_not_found' };
    }
    const target = this.#reachEditableMessage(targeting, input);
    if (!target.found) {
      return { edited: false, reason: target.reason };
    }
    const { message } = target;
    return this.#applyContentReplacement(
      targeting,
      message,
      replaceMessageCaption(message.content, input, 'bot', this.#textFixingContext),
      input.inlineKeyboard,
    );
  }

  #editMedia<Types extends BotEditTargetingTypes>(
    targeting: BotEditTargeting<Types>,
    input: Types['target'] & BotMediaEdit,
  ): BotMediaEditResult<Types> {
    if (this.#bots.getById(input.fromBotId) === undefined) {
      return { edited: false, reason: 'bot_not_found' };
    }
    const target = this.#reachEditableMessage(targeting, input);
    if (!target.found) {
      return { edited: false, reason: target.reason };
    }
    const { reached, message } = target;
    const replacement = replaceMessageMedia(message, input.media, this.#textFixingContext);
    const permissionFailure = replacement.replaced
      ? targeting.findMissingContentPermission(reached, input.fromBotId, replacement.content)
      : undefined;
    if (permissionFailure !== undefined) {
      return { edited: false, ...permissionFailure };
    }
    return this.#applyContentReplacement(targeting, message, replacement, input.inlineKeyboard);
  }

  #editKeyboard<Types extends BotEditTargetingTypes>(
    targeting: BotEditTargeting<Types>,
    input: Types['target'] & BotKeyboardEdit,
  ): BotKeyboardEditResult<Types> {
    if (this.#bots.getById(input.fromBotId) === undefined) {
      return { edited: false, reason: 'bot_not_found' };
    }
    const target = this.#reachEditableMessage(targeting, input);
    if (!target.found) {
      return { edited: false, reason: target.reason };
    }
    const { message } = target;
    return this.#commitBotEdit(targeting, message, {
      content: { kind: 'existing', content: message.content },
      inlineKeyboard: input.inlineKeyboard,
      contentEditedAtUnixSeconds: message.contentEditedAtUnixSeconds,
    });
  }

  #stopPoll<Types extends BotEditTargetingTypes>(
    targeting: BotEditTargeting<Types>,
    input: Types['target'] & BotPollStop,
  ): BotPollStopResult<Types> {
    if (this.#bots.getById(input.fromBotId) === undefined) {
      return { stopped: false, reason: 'bot_not_found' };
    }
    const target = targeting.reachMessage(input);
    if (!target.reached) {
      return { stopped: false, reason: target.reason };
    }
    const { message } = target;
    // A service message shows no poll.
    if (!isContentMessage(message)) {
      return { stopped: false, reason: 'message_has_no_poll' };
    }
    const pollLookup = findStoppablePoll(message, input.fromBotId, this.#polls);
    if (!pollLookup.found) {
      return { stopped: false, reason: pollLookup.reason };
    }
    const { inlineKeyboard } = input;
    const buttonFailure = targeting.findButtonFailure(message, inlineKeyboard, {
      kind: 'existing',
      content: message.content,
    });
    if (buttonFailure !== undefined) {
      return { stopped: false, reason: buttonFailure };
    }
    if (inlineKeyboard !== undefined && !hasOnlyValidCallbackData(inlineKeyboard)) {
      return { stopped: false, reason: 'callback_data_invalid' };
    }

    const stoppedPoll = this.#polls.closePoll(pollLookup.poll.id);
    const stoppedMessage = targeting.storeEdit(message, {
      content: message.content,
      inlineKeyboard,
      contentEditedAtUnixSeconds: message.contentEditedAtUnixSeconds,
    });
    this.#events.emit({ type: 'poll_closed', poll: stoppedPoll });
    return { stopped: true, message: stoppedMessage, poll: stoppedPoll };
  }

  #editAccountMessage<Types extends AccountEditTargetingTypes>(
    targeting: AccountEditTargeting<Types>,
    input: Types['target'] & { readonly edit: AccountMessageEdit },
  ): AccountEditResult<Types> {
    if (this.#accounts.getById(input.fromAccountId) === undefined) {
      return { edited: false, reason: 'account_not_found' };
    }
    const target = targeting.reachMessage(input);
    if (!target.reached) {
      return { edited: false, reason: target.reason };
    }
    const { message } = target;
    // As in TDLib, only the inline bot edits a message sent through it, and no one edits a forward
    // or a service message.
    if (!isContentMessage(message) || !canAccountEditMessage(message, input.fromAccountId)) {
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

    const editedMessage = targeting.storeEdit(message, {
      content,
      inlineKeyboard: message.inlineKeyboard,
      contentEditedAtUnixSeconds: this.#currentUnixTimeSeconds(),
    });
    this.#events.emit({ type: 'message_edited', message: editedMessage });
    return { edited: true, message: editedMessage };
  }

  /**
   * Reaches the message a bot's edit targets, which the bot must be allowed to edit, as
   * `canBotEditMessage` decides. A service message has no content to edit.
   */
  #reachEditableMessage<Types extends BotEditTargetingTypes>(
    targeting: BotEditTargeting<Types>,
    target: Types['target'],
  ):
    | {
      readonly found: true;
      readonly reached: Types['reached'];
      readonly message: Types['reached']['message'] & ContentMessage;
    }
    | {
      readonly found: false;
      readonly reason: Types['lookupFailureReason'] | 'message_not_editable';
    } {
    const reach = targeting.reachMessage(target);
    if (!reach.reached) {
      return { found: false, reason: reach.reason };
    }
    const { message } = reach;
    return isContentMessage(message) && canBotEditMessage(message, target.fromBotId)
      ? { found: true, reached: reach, message }
      : { found: false, reason: 'message_not_editable' };
  }

  /**
   * Applies a bot's replacement of its message's content with the given keyboard; only changed
   * content dates the edit.
   */
  #applyContentReplacement<Types extends BotEditTargetingTypes, FailureReason extends string>(
    targeting: BotEditTargeting<Types>,
    message: Types['reached']['message'] & ContentMessage,
    replacement: ContentReplacement<FailureReason>,
    inlineKeyboard: InlineKeyboard | undefined,
  ): MessageEditOutcome<
    Types['reached']['message'],
    { readonly reason: FailureReason | BotEditedMessageFailureReason<Types> } | TextInvalidFailure
  > {
    if (!replacement.replaced) {
      return { edited: false, ...replacement.failure };
    }
    return this.#commitBotEdit(targeting, message, {
      content: replacement.content,
      inlineKeyboard,
      contentEditedAtUnixSeconds: isUnchangedContent(replacement.content, message.content)
        ? message.contentEditedAtUnixSeconds
        : this.#currentUnixTimeSeconds(),
    });
  }

  /**
   * Checks, stores, and publishes a bot's edit of its message, which must change the message. The
   * new content's upload is stored only once the edit passes its checks.
   */
  #commitBotEdit<Types extends BotEditTargetingTypes>(
    targeting: BotEditTargeting<Types>,
    message: Types['reached']['message'] & ContentMessage,
    { content, ...edit }: {
      readonly content: NormalizedOutgoingContent;
      readonly inlineKeyboard: InlineKeyboard | undefined;
      readonly contentEditedAtUnixSeconds: number | undefined;
    },
  ): MessageEditOutcome<
    Types['reached']['message'],
    { readonly reason: BotEditedMessageFailureReason<Types> }
  > {
    const buttonFailure = targeting.findButtonFailure(message, edit.inlineKeyboard, content);
    if (buttonFailure !== undefined) {
      return { edited: false, reason: buttonFailure };
    }
    const editFailure = checkBotMessageEdit(message, { content, ...edit });
    if (editFailure !== undefined) {
      return { edited: false, reason: editFailure };
    }

    const editedMessage = targeting.storeEdit(message, {
      ...edit,
      content: storeOutgoingContent(content, this.#files, this.#polls),
    });
    this.#events.emit({ type: 'message_edited', message: editedMessage });
    return { edited: true, message: editedMessage };
  }
}

/** The private chat policy's rules that editing asks for. */
type PrivateChatEditingPolicy =
  & PrivateChatIdentityPolicy
  & Pick<PrivateChatAccessPredicates, 'isConversationStarted'>
  & ChatMessageLookup<PrivateChatKey, PrivateMessage>;

/** The supergroup policy's rules that editing asks for. */
type SupergroupEditingPolicy =
  & SupergroupIdentityPolicy
  & SupergroupAccessPredicates
  & ChatMessageLookup<SupergroupChatKey, SupergroupMessage>;

/**
 * A bot reaches a message of its private chat once the account exists and has started the chat,
 * by the message's ID in the bot's message box. A private chat checks no right for new content and
 * allows every button.
 */
function createBotPrivateChatTargeting(
  privateChats: PrivateChatEditingPolicy,
  messages: EditedMessageStore,
): BotEditTargeting<BotPrivateChatEditTypes> {
  return {
    reachMessage: ({ fromBotId, chat, messageId }) => {
      const identification = privateChats.identifyChatForBot(fromBotId, chat);
      if (!identification.identified) {
        return { reached: false, reason: identification.reason };
      }
      // A join request's contact grant lets the bot write to an unstarted chat, not edit there.
      if (!privateChats.isConversationStarted(identification.key)) {
        return { reached: false, reason: 'conversation_not_started' };
      }
      const message = privateChats.findMessageByChatMessageId(identification.key, messageId);
      return message === undefined
        ? { reached: false, reason: 'message_not_found' }
        : { reached: true, message };
    },
    findMissingContentPermission: () => undefined,
    findButtonFailure: () => undefined,
    storeEdit: (message, edit) => messages.editMessage(message.chat, message.id, edit),
  };
}

/**
 * A bot reaches a message of a supergroup as a member, whose membership decides its rights to new
 * rich or media content, by the supergroup's ID of the message.
 */
function createBotSupergroupTargeting(
  supergroups: SupergroupEditingPolicy,
  messages: EditedMessageStore,
): BotEditTargeting<BotSupergroupEditTypes> {
  return {
    reachMessage: ({ fromBotId, chat, messageId }) => {
      const identification = supergroups.identifyChatForBot(fromBotId, chat);
      if (!identification.identified) {
        return { reached: false, reason: identification.reason };
      }
      const { key, supergroup } = identification;
      const membership = supergroups.resolveBotMembership(fromBotId, supergroup);
      if (!membership.member) {
        return { reached: false, reason: membership.reason };
      }
      const message = supergroups.findMessageByChatMessageId(key, messageId);
      return message === undefined
        ? { reached: false, reason: 'message_not_found' }
        : { reached: true, message, supergroup, membership: membership.membership };
    },
    findMissingContentPermission: (standing, botId, content) =>
      findMissingSendPermission(standing, { kind: 'bot', botId }, [content]),
    findButtonFailure: (_message, inlineKeyboard, content) =>
      findSupergroupButtonFailure(inlineKeyboard, content),
    storeEdit: (message, edit) => messages.editMessage(message.chat, message.id, edit),
  };
}

/**
 * A bot reaches an inline message by its identifier alone, whichever chat holds it. TDLib checks
 * no right for it, and its own chat decides which buttons it may show, as it names no chat.
 */
function createBotInlineMessageTargeting(
  messages: EditedMessageStore,
): BotEditTargeting<BotInlineMessageEditTypes> {
  return {
    reachMessage: ({ fromBotId, inlineMessageId }) => {
      const message = findBotInlineMessage(messages, fromBotId, inlineMessageId);
      return message === undefined
        ? { reached: false, reason: 'message_not_found' }
        : { reached: true, message };
    },
    findMissingContentPermission: () => undefined,
    findButtonFailure: (message, inlineKeyboard, content) =>
      message.kind === 'supergroup_message'
        ? findSupergroupButtonFailure(inlineKeyboard, content)
        : undefined,
    storeEdit: (message, edit) => messages.editMessage(message.chat, message.id, edit),
  };
}

/**
 * An account reaches a message of its private chat with an existing bot, started or not, by the
 * message's ID in the bot's message box.
 */
function createAccountPrivateChatTargeting(
  privateChats: PrivateChatEditingPolicy,
  messages: EditedMessageStore,
): AccountEditTargeting<AccountPrivateChatEditTypes> {
  return {
    reachMessage: ({ fromAccountId, chat, messageId }) => {
      const identification = privateChats.identifyChatForAccount(fromAccountId, chat);
      if (!identification.identified) {
        return { reached: false, reason: identification.reason };
      }
      const message = privateChats.findMessageByChatMessageId(identification.key, messageId);
      return message === undefined
        ? { reached: false, reason: 'message_not_found' }
        : { reached: true, message };
    },
    storeEdit: (message, edit) => messages.editMessage(message.chat, message.id, edit),
  };
}

/** An account reaches a message of a supergroup as a member, by the supergroup's ID of it. */
function createAccountSupergroupTargeting(
  supergroups: SupergroupEditingPolicy,
  messages: EditedMessageStore,
): AccountEditTargeting<AccountSupergroupEditTypes> {
  return {
    reachMessage: ({ fromAccountId, chat, messageId }) => {
      const identification = supergroups.identifyChatForAccount(fromAccountId, chat);
      if (!identification.identified) {
        return { reached: false, reason: identification.reason };
      }
      const { key, supergroup } = identification;
      const membership = supergroups.resolveAccountMembership(fromAccountId, supergroup);
      if (!membership.member) {
        return { reached: false, reason: membership.reason };
      }
      const message = supergroups.findMessageByChatMessageId(key, messageId);
      return message === undefined
        ? { reached: false, reason: 'message_not_found' }
        : { reached: true, message };
    },
    storeEdit: (message, edit) => messages.editMessage(message.chat, message.id, edit),
  };
}

/**
 * Finds a message sent through the bot's inline mode by its inline message identifier, in any
 * chat; another bot's inline message is not found.
 */
function findBotInlineMessage(
  messages: EditedMessageStore,
  botId: number,
  inlineMessageId: InlineMessageId,
): ChatMessage | undefined {
  const message = messages.getMessageByInlineMessageId(inlineMessageId);
  return message?.viaBot?.botId === botId ? message : undefined;
}

/**
 * Why a supergroup refuses the buttons of an edited message: the Bot API reference allows Web App
 * buttons only in private chats between a user and the bot, and Telegram's servers refuse them
 * elsewhere.
 */
function findSupergroupButtonFailure(
  inlineKeyboard: InlineKeyboard | undefined,
  content: NormalizedOutgoingContent,
): 'button_type_invalid' | undefined {
  return hasWebAppButton(inlineKeyboard, content) ? 'button_type_invalid' : undefined;
}
