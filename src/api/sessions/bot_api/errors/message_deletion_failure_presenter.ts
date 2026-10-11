import type { FormerSupergroupMemberFailureReason } from '../../../../types/chat_membership.ts';
import { BOT_CHAT_ACCESS_ERRORS } from '../chat_access.ts';
import type { BotApiMethodAnswer } from '../method_call.ts';
import { BOT_API_ERRORS } from './error_catalogue.ts';
import { type FixedBotApiError, presentFixedBotApiError } from './error_template.ts';

/**
 * Why a bot cannot delete messages of a chat: it cannot address the chat, or a message is not one
 * it may delete.
 */
type MessageDeletionFailureReason =
  | 'chat_not_found'
  /** The account of the bot's private chat does not exist, or never started the chat. */
  | 'account_not_found'
  | 'conversation_not_started'
  | FormerSupergroupMemberFailureReason
  | 'message_not_deletable';

/** Why `deleteMessages` deleted nothing; it skips identifiers that name no message. */
export interface MessageListDeletionFailure {
  readonly deleted: false;
  readonly reason: MessageDeletionFailureReason;
}

/** Why `deleteMessage` deleted nothing, which also fails for a message it does not find. */
export interface SingleMessageDeletionFailure {
  readonly deleted: false;
  readonly reason: MessageDeletionFailureReason | 'message_not_found';
}

/** Telegram's errors for the failures of the message deletion family, by reason. */
const MESSAGE_DELETION_ERRORS = {
  ...BOT_CHAT_ACCESS_ERRORS,
  message_not_found: BOT_API_ERRORS.messageToDeleteNotFound,
  message_not_deletable: BOT_API_ERRORS.messageNotDeletable,
} as const satisfies Readonly<Record<string, FixedBotApiError>>;

/**
 * Telegram's error for a deletion that deleted nothing. Its failures read alike for both methods,
 * of which only `deleteMessage` fails for a message it does not find.
 */
export function presentMessageDeletionFailure(
  failure: SingleMessageDeletionFailure | MessageListDeletionFailure,
): BotApiMethodAnswer {
  return presentFixedBotApiError(MESSAGE_DELETION_ERRORS[failure.reason]);
}
