import type { SupergroupBotAccessFailureReason } from '../../../types/chat_membership.ts';
import { BOT_API_ERRORS } from './errors/error_catalogue.ts';
import { type FixedBotApiError, presentFixedBotApiError } from './errors/error_template.ts';
import type { BotApiMethodAnswer, BotApiMethodContext } from './method_call.ts';
import { CHAT_USERNAME_PREFIX, type ChatIdentifier } from './request_parameters.ts';

/** Telegram's error for a call that names no chat at all. */
export const CHAT_ID_EMPTY_DESCRIPTION = 'Bad Request: chat_id is empty';

/**
 * Why a bot cannot address a chat: a supergroup it cannot reach as a member, or, in a private
 * chat, an account that does not exist or never started the bot.
 */
export type BotChatAccessFailureReason =
  | SupergroupBotAccessFailureReason
  | 'account_not_found'
  | 'conversation_not_started';

/**
 * Telegram's errors for a chat the bot cannot address, whichever method addresses it. A bot can
 * reach a user only after the user has written to it, so the official server's `check_chat`
 * reports any other user, like an unknown chat, as not found.
 */
export const BOT_CHAT_ACCESS_ERRORS = {
  chat_not_found: BOT_API_ERRORS.chatNotFound,
  account_not_found: BOT_API_ERRORS.chatNotFound,
  conversation_not_started: BOT_API_ERRORS.chatNotFound,
  bot_not_a_member: BOT_API_ERRORS.botNotSupergroupMember,
  bot_kicked: BOT_API_ERRORS.botKickedFromSupergroup,
} as const satisfies Readonly<Record<BotChatAccessFailureReason, FixedBotApiError>>;

/**
 * Finds the ID of the chat a JSON field names by its ID or by a public username after `@`, as
 * `check_chat` does; `undefined` for a username that names no chat a bot may address.
 */
export function resolveChatIdentifier(
  context: BotApiMethodContext,
  chatIdentifier: ChatIdentifier,
): number | undefined {
  return typeof chatIdentifier === 'number'
    ? chatIdentifier
    : context.session.botApi.findPublicChatId(chatIdentifier.slice(CHAT_USERNAME_PREFIX.length));
}

/** Telegram's error for a request to a chat the bot cannot address, whichever method made it. */
export function botChatAccessFailureAnswer(
  reason: BotChatAccessFailureReason,
): BotApiMethodAnswer {
  return presentFixedBotApiError(BOT_CHAT_ACCESS_ERRORS[reason]);
}
