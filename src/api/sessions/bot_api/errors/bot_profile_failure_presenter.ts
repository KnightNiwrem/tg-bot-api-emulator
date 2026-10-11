import type { EmulationSession } from '../../../../types/emulation_session.ts';
import { BOT_CHAT_ACCESS_ERRORS } from '../chat_access.ts';
import type { BotApiMethodAnswer } from '../method_call.ts';
import { BOT_API_ERRORS } from './error_catalogue.ts';
import {
  type FixedBotApiError,
  presentBotApiError,
  presentFixedBotApiError,
} from './error_template.ts';

type BotApi = EmulationSession['botApi'];

/** Why the bot could not set, read or delete one of its command lists. */
type BotCommandListFailure =
  | Extract<ReturnType<BotApi['setMyCommands']>, { readonly set: false }>
  | Extract<ReturnType<BotApi['getMyCommands']>, { readonly found: false }>
  | Extract<ReturnType<BotApi['deleteMyCommands']>, { readonly deleted: false }>;

/** Why the bot could not set or read its description or short description. */
type BotDescriptionFailure =
  | Extract<ReturnType<BotApi['setMyDescription']>, { readonly set: false }>
  | Extract<ReturnType<BotApi['getMyDescription']>, { readonly found: false }>;

/** Why the bot could not set or read a menu button. */
type BotMenuButtonFailure =
  | Extract<ReturnType<BotApi['setChatMenuButton']>, { readonly set: false }>
  | Extract<ReturnType<BotApi['getChatMenuButton']>, { readonly found: false }>;

/** Telegram's errors for the failures of the family that carry no details, by reason. */
const FIXED_BOT_PROFILE_ERRORS = {
  ...BOT_CHAT_ACCESS_ERRORS,
  scope_not_allowed_in_private_chats: BOT_API_ERRORS.botCommandScopeNotAllowedInPrivateChats,
  language_code_invalid: BOT_API_ERRORS.languageCodeInvalid,
  command_not_utf8: BOT_API_ERRORS.botCommandNotUtf8,
  command_description_not_utf8: BOT_API_ERRORS.botCommandDescriptionNotUtf8,
  command_empty: BOT_API_ERRORS.botCommandEmpty,
  command_too_long: BOT_API_ERRORS.botCommandTooLong,
  command_description_empty: BOT_API_ERRORS.botCommandDescriptionEmpty,
  command_description_too_long: BOT_API_ERRORS.botCommandDescriptionTooLong,
  too_many_commands: BOT_API_ERRORS.tooManyBotCommands,
  command_invalid: BOT_API_ERRORS.botCommandInvalid,
  text_not_utf8: BOT_API_ERRORS.stringsNotUtf8,
  user_not_found: BOT_API_ERRORS.userNotFound,
  menu_button_text_empty: BOT_API_ERRORS.menuButtonTextEmpty,
  menu_button_text_not_utf8: BOT_API_ERRORS.menuButtonTextNotUtf8,
  menu_button_url_not_utf8: BOT_API_ERRORS.menuButtonUrlNotUtf8,
} as const satisfies Readonly<Record<string, FixedBotApiError>>;

/**
 * Telegram's error for a failed change or read of how the bot presents itself: its command lists,
 * descriptions and menu buttons, whose failures read alike in every method that meets them.
 */
export function presentBotProfileFailure(
  failure: BotCommandListFailure | BotDescriptionFailure | BotMenuButtonFailure,
): BotApiMethodAnswer {
  return failure.reason === 'web_app_url_invalid'
    ? presentBotApiError(BOT_API_ERRORS.menuButtonWebAppUrlInvalid, failure)
    : presentFixedBotApiError(FIXED_BOT_PROFILE_ERRORS[failure.reason]);
}
