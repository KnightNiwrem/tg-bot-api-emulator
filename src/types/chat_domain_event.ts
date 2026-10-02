import type { CallbackQuery } from './callback_query.ts';
import type { ChatMemberStatus } from './chat_membership.ts';
import type { InlineQuery } from './inline_query.ts';
import type { Poll } from './poll.ts';
import type { SharedChat } from './virtual_chat.ts';
import type { ChatMessage } from './virtual_message.ts';

/** A canonical message was stored and numbered in the message boxes that hold it. */
export interface MessageCreatedEvent {
  readonly type: 'message_created';
  readonly message: ChatMessage;
}

/** The author of a stored message edited it. */
export interface MessageEditedEvent {
  readonly type: 'message_edited';
  /** The message as the edit left it. */
  readonly message: ChatMessage;
}

/** An account pressed a callback button on a message from the bot. */
export interface CallbackQueryCreatedEvent {
  readonly type: 'callback_query_created';
  readonly callbackQuery: CallbackQuery;
  /** The message carrying the pressed button, as it was when the button was pressed. */
  readonly message: ChatMessage;
}

/** An account answered a poll, changed its answer, or retracted it. */
export interface PollAnswerChangedEvent {
  readonly type: 'poll_answer_changed';
  /** The poll as the answer left it. */
  readonly poll: Poll;
  readonly voterId: number;
  /** The options the voter chose, as positions in increasing order; none for a retraction. */
  readonly chosenOptionPositions: readonly number[];
}

/** The bot that owns a poll stopped it. */
export interface PollStoppedEvent {
  readonly type: 'poll_stopped';
  /** The poll as stopping it left it: closed, with its votes. */
  readonly poll: Poll;
}

/** An account typed an inline query for a bot. */
export interface InlineQueryCreatedEvent {
  readonly type: 'inline_query_created';
  readonly inlineQuery: InlineQuery;
}

/** An account sent a result of the bot's answer to an inline query, as a message of its chat. */
export interface InlineQueryResultChosenEvent {
  readonly type: 'inline_query_result_chosen';
  /** The answered query that offered the result. */
  readonly inlineQuery: InlineQuery;
  readonly resultId: string;
  /** The message that sending the result created. */
  readonly message: ChatMessage;
}

/** An account blocked a bot, which Telegram calls stopping it, or unblocked it. */
export interface BotBlockChangedEvent {
  readonly type: 'bot_block_changed';
  readonly accountId: number;
  readonly botId: number;
  /** Whether the account blocks the bot after the change. */
  readonly isBlocked: boolean;
  readonly changedAtUnixSeconds: number;
}

/**
 * A user's standing in a shared chat changed: it joined, left, or was removed, promoted, demoted,
 * banned, or unbanned.
 */
export interface ChatMemberStatusChangedEvent {
  readonly type: 'chat_member_status_changed';
  readonly chat: SharedChat;
  /**
   * The user that made the change: the account or bot that added, removed, promoted, demoted,
   * banned, or unbanned the member, or the member itself when it left.
   */
  readonly actorId: number;
  /** The account or bot whose standing changed. */
  readonly memberId: number;
  readonly oldStatus: ChatMemberStatus;
  readonly newStatus: ChatMemberStatus;
  readonly changedAtUnixSeconds: number;
}

/** A state change produced by a chat command, published in the order it happened. */
export type ChatDomainEvent =
  | MessageCreatedEvent
  | MessageEditedEvent
  | CallbackQueryCreatedEvent
  | PollAnswerChangedEvent
  | PollStoppedEvent
  | InlineQueryCreatedEvent
  | InlineQueryResultChosenEvent
  | BotBlockChangedEvent
  | ChatMemberStatusChangedEvent;
