import type { EmulationSession } from '../../../../types/emulation_session.ts';
import type { BotApiMethodAnswer } from '../method_call.ts';
import { BOT_API_ERRORS } from './error_catalogue.ts';
import { type FixedBotApiError, presentFixedBotApiError } from './error_template.ts';

/** Why `getFile` prepared no file for the bot to download. */
type FilePreparationFailure = Extract<
  ReturnType<EmulationSession['botApi']['getFile']>,
  { readonly found: false }
>;

/** Telegram's errors for the failures of the file family, by reason. */
const FILE_ERRORS = {
  file_id_invalid: BOT_API_ERRORS.getFileIdInvalid,
  file_too_big: BOT_API_ERRORS.downloadedFileTooBig,
} as const satisfies Readonly<Record<string, FixedBotApiError>>;

/** Telegram's error for a file `getFile` cannot prepare for download. */
export function presentFilePreparationFailure(failure: FilePreparationFailure): BotApiMethodAnswer {
  return presentFixedBotApiError(FILE_ERRORS[failure.reason]);
}
