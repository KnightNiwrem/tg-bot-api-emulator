import type { BotApiMethodContext } from './method_call.ts';
import { CHAT_USERNAME_PREFIX, type ChatIdentifier } from './request_parameters.ts';

/** Telegram's error for a call that names no chat the bot may address. */
export const CHAT_NOT_FOUND_DESCRIPTION = 'Bad Request: chat not found';

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
