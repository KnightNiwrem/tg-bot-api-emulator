import type { EmulationSession } from '../../../../types/emulation_session.ts';
import { BOT_CHAT_ACCESS_ERRORS } from '../chat_access.ts';
import type { BotApiMethodAnswer } from '../method_call.ts';
import { BOT_API_ERRORS } from './error_catalogue.ts';
import { type FixedBotApiError, presentFixedBotApiError } from './error_template.ts';

/** Why `setMessageReaction` changed no reaction. */
type MessageReactionFailure = Extract<
  ReturnType<EmulationSession['botApi']['setMessageReaction']>,
  { readonly set: false }
>;

/**
 * Telegram's errors for the failures of the message reaction family, by reason. Telegram's servers
 * check the reactions themselves, with the errors `messages.sendReaction` documents.
 */
const MESSAGE_REACTION_ERRORS = {
  ...BOT_CHAT_ACCESS_ERRORS,
  private_chat_reactions_unsupported: BOT_API_ERRORS.privateChatReactionsUnsupported,
  message_not_found: BOT_API_ERRORS.messageToReactNotFound,
  message_not_reactable: BOT_API_ERRORS.reactionInvalid,
  reaction_emoji_unsupported: BOT_API_ERRORS.reactionInvalid,
  reaction_not_permitted: BOT_API_ERRORS.reactionNotPermitted,
  too_many_reactions: BOT_API_ERRORS.reactionsTooMany,
  too_many_distinct_reactions: BOT_API_ERRORS.reactionsTooMany,
} as const satisfies Readonly<Record<string, FixedBotApiError>>;

/** Telegram's error for a reaction change that changed nothing. */
export function presentMessageReactionFailure(failure: MessageReactionFailure): BotApiMethodAnswer {
  return presentFixedBotApiError(MESSAGE_REACTION_ERRORS[failure.reason]);
}
