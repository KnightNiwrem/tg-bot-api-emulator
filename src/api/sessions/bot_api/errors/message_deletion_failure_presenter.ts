import type { EmulationSession } from '../../../../types/emulation_session.ts';
import { BOT_CHAT_ACCESS_ERRORS } from '../chat_access.ts';
import type { BotApiMethodAnswer } from '../method_call.ts';
import { BOT_API_ERRORS } from './error_catalogue.ts';
import { type FixedBotApiError, presentFixedBotApiError } from './error_template.ts';

type BotApi = EmulationSession['botApi'];

/** Why `deleteMessage` or `deleteMessages` deleted nothing. */
type MessageDeletionFailure = Extract<
  ReturnType<BotApi['deleteMessage'] | BotApi['deleteMessages']>,
  { readonly deleted: false }
>;

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
export function presentMessageDeletionFailure(failure: MessageDeletionFailure): BotApiMethodAnswer {
  return presentFixedBotApiError(MESSAGE_DELETION_ERRORS[failure.reason]);
}
