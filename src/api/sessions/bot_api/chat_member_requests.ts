import { BOT_API_ERRORS } from './errors/error_catalogue.ts';
import { presentFixedBotApiError } from './errors/error_template.ts';
import { answerWith, type BotApiStepResult, proceedWith } from './method_steps.ts';

/** The chat and the member a request is about. */
export interface ChatMemberTarget {
  readonly chatId: number;
  readonly userId: number;
}

/**
 * The step that requires the member a request is about, refusing a missing or non-positive
 * `user_id`, as the official server's `get_user_id` does.
 */
export function requireValidUserId<Parameters extends { readonly user_id?: number }>(
  parameters: Parameters,
): BotApiStepResult<Parameters> {
  const { user_id: userId } = parameters;
  return userId === undefined || userId <= 0
    ? answerWith(presentFixedBotApiError(BOT_API_ERRORS.userIdInvalid))
    : proceedWith(parameters);
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
