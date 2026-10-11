import { CHAT_ID_EMPTY_DESCRIPTION } from './chat_access.ts';
import { botApiError, type BotApiMethodAnswer } from './method_call.ts';

/** Telegram's description for a request about a chat member that names no valid user. */
export const USER_ID_INVALID_DESCRIPTION = 'Bad Request: invalid user_id specified';

/**
 * Reads the chat and the member a request is about, answering Telegram's error for a missing or
 * non-positive `user_id`, then for a missing `chat_id`.
 */
export function readChatMemberTarget(
  { chat_id: chatId, user_id: userId }: { readonly chat_id?: number; readonly user_id?: number },
):
  | { readonly read: true; readonly target: { readonly chatId: number; readonly userId: number } }
  | { readonly read: false; readonly errorAnswer: BotApiMethodAnswer } {
  if (userId === undefined || userId <= 0) {
    return { read: false, errorAnswer: botApiError(400, USER_ID_INVALID_DESCRIPTION) };
  }
  if (chatId === undefined) {
    return { read: false, errorAnswer: botApiError(400, CHAT_ID_EMPTY_DESCRIPTION) };
  }
  return { read: true, target: { chatId, userId } };
}
