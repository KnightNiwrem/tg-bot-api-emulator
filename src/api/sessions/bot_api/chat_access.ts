import type { SupergroupBotAccessFailureReason } from '../../../types/chat_membership.ts';
import { botApiError, type BotApiMethodAnswer, type BotApiMethodContext } from './method_call.ts';
import { CHAT_USERNAME_PREFIX, type ChatIdentifier } from './request_parameters.ts';

/** Telegram's error for a call that names no chat the bot may address. */
export const CHAT_NOT_FOUND_DESCRIPTION = 'Bad Request: chat not found';

/** Telegram's error for a call that names no chat at all. */
export const CHAT_ID_EMPTY_DESCRIPTION = 'Bad Request: chat_id is empty';

/** Telegram's description for a message or chat action to a user who blocked the bot. */
export const BOT_BLOCKED_DESCRIPTION = 'Forbidden: bot was blocked by the user';

/** Telegram's descriptions for a request to a supergroup that the bot left or was removed from. */
export const BOT_NOT_SUPERGROUP_MEMBER_DESCRIPTION =
  'Forbidden: bot is not a member of the supergroup chat';
export const BOT_KICKED_FROM_SUPERGROUP_DESCRIPTION =
  'Forbidden: bot was kicked from the supergroup chat';

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

/**
 * Telegram's error for a request to a chat the bot cannot reach as a supergroup member, whichever
 * method made it.
 */
export function supergroupBotAccessFailureAnswer(
  reason: SupergroupBotAccessFailureReason,
): BotApiMethodAnswer {
  switch (reason) {
    case 'chat_not_found':
      return botApiError(400, CHAT_NOT_FOUND_DESCRIPTION);
    case 'bot_not_a_member':
      return botApiError(403, BOT_NOT_SUPERGROUP_MEMBER_DESCRIPTION);
    case 'bot_kicked':
      return botApiError(403, BOT_KICKED_FROM_SUPERGROUP_DESCRIPTION);
    default: {
      const unhandledReason: never = reason;
      throw new Error(`Unhandled supergroup bot access failure: ${unhandledReason}`);
    }
  }
}
