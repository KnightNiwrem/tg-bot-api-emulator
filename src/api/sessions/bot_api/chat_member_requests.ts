import { BOT_API_ERRORS } from './errors/error_catalogue.ts';
import { presentFixedBotApiError } from './errors/error_template.ts';
import type { BotApiMethodAnswer } from './method_call.ts';
import { answerWith, type BotApiStepResult, proceedWith } from './method_steps.ts';

/** Telegram's description for a request about a chat member that names no valid user. */
export const USER_ID_INVALID_DESCRIPTION = BOT_API_ERRORS.userIdInvalid.description();

/** The chat and the member a request is about. */
export interface ChatMemberTarget {
  readonly chatId: number;
  readonly userId: number;
}

/**
 * The step that reads the chat and the member a request is about, answering Telegram's error for a
 * missing or non-positive `user_id`, then for a missing `chat_id`, as the official server's
 * `get_user_id` and then `check_chat` do.
 */
export function readChatMemberTargetStep(
  { chat_id: chatId, user_id: userId }: { readonly chat_id?: number; readonly user_id?: number },
): BotApiStepResult<ChatMemberTarget> {
  if (userId === undefined || userId <= 0) {
    return answerWith(presentFixedBotApiError(BOT_API_ERRORS.userIdInvalid));
  }
  if (chatId === undefined) {
    return answerWith(presentFixedBotApiError(BOT_API_ERRORS.chatIdEmpty));
  }
  return proceedWith({ chatId, userId });
}

/**
 * Reads the chat and the member a request is about as `readChatMemberTargetStep` does, for a
 * method whose handler is not composed of steps.
 */
export function readChatMemberTarget(
  parameters: { readonly chat_id?: number; readonly user_id?: number },
):
  | { readonly read: true; readonly target: ChatMemberTarget }
  | { readonly read: false; readonly errorAnswer: BotApiMethodAnswer } {
  const result = readChatMemberTargetStep(parameters);
  return result.proceeds
    ? { read: true, target: result.value }
    : { read: false, errorAnswer: result.answer };
}
