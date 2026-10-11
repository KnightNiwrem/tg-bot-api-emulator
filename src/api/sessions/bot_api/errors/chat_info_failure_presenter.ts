import type { EmulationSession } from '../../../../session/emulation_session.ts';
import { BOT_CHAT_ACCESS_ERRORS } from '../chat_access.ts';
import type { BotApiMethodAnswer } from '../method_call.ts';
import { BOT_API_ERRORS } from './error_catalogue.ts';
import { type FixedBotApiError, presentFixedBotApiError } from './error_template.ts';

type BotApi = EmulationSession['botApi'];

/** Why `setChatTitle` changed no title. */
type ChatTitleChangeFailure = Extract<ReturnType<BotApi['setChatTitle']>, { readonly set: false }>;

/** Why `setChatDescription` changed no description. */
type ChatDescriptionChangeFailure = Extract<
  ReturnType<BotApi['setChatDescription']>,
  { readonly set: false }
>;

/** Why `setChatPermissions` changed no default permissions. */
type ChatPermissionsChangeFailure = Extract<
  ReturnType<BotApi['setChatPermissions']>,
  { readonly set: false }
>;

/** The change of a chat's information that failed: its title, description or permissions. */
type ChatInfoChangeOperation =
  | 'chat_title_change'
  | 'chat_description_change'
  | 'chat_permissions_change';

/** TDLib's errors for a bot without the right to change what the operation changes. */
const NOT_ENOUGH_RIGHTS_ERRORS = {
  chat_title_change: BOT_API_ERRORS.notEnoughRightsToChangeChatTitle,
  chat_description_change: BOT_API_ERRORS.notEnoughRightsToSetChatDescription,
  chat_permissions_change: BOT_API_ERRORS.notEnoughRightsToChangeChatPermissions,
} as const satisfies Readonly<Record<ChatInfoChangeOperation, FixedBotApiError>>;

/** TDLib's errors for a private chat, which has none of what the operation changes. */
const PRIVATE_CHAT_UNCHANGEABLE_ERRORS = {
  chat_title_change: BOT_API_ERRORS.privateChatTitleUnchangeable,
  chat_description_change: BOT_API_ERRORS.privateChatDescriptionUnchangeable,
  chat_permissions_change: BOT_API_ERRORS.privateChatPermissionsUnchangeable,
} as const satisfies Readonly<Record<ChatInfoChangeOperation, FixedBotApiError>>;

/** Telegram's errors for the other failures of the family, by reason. */
const FIXED_CHAT_INFO_ERRORS = {
  ...BOT_CHAT_ACCESS_ERRORS,
  text_encoding_invalid: BOT_API_ERRORS.stringsNotUtf8,
  title_empty: BOT_API_ERRORS.chatTitleEmpty,
  description_not_modified: BOT_API_ERRORS.chatDescriptionNotModified,
} as const satisfies Readonly<Record<string, FixedBotApiError>>;

/** Telegram's error for a failed change of a chat's information, in the context of its operation. */
export function presentChatInfoChangeFailure(
  operation: 'chat_title_change',
  failure: ChatTitleChangeFailure,
): BotApiMethodAnswer;
export function presentChatInfoChangeFailure(
  operation: 'chat_description_change',
  failure: ChatDescriptionChangeFailure,
): BotApiMethodAnswer;
export function presentChatInfoChangeFailure(
  operation: 'chat_permissions_change',
  failure: ChatPermissionsChangeFailure,
): BotApiMethodAnswer;
export function presentChatInfoChangeFailure(
  operation: ChatInfoChangeOperation,
  failure: ChatTitleChangeFailure | ChatDescriptionChangeFailure | ChatPermissionsChangeFailure,
): BotApiMethodAnswer {
  switch (failure.reason) {
    case 'not_enough_rights':
      return presentFixedBotApiError(NOT_ENOUGH_RIGHTS_ERRORS[operation]);
    case 'private_chat_info_unchangeable':
    case 'private_chat_permissions_unchangeable':
      return presentFixedBotApiError(PRIVATE_CHAT_UNCHANGEABLE_ERRORS[operation]);
    default:
      return presentFixedBotApiError(FIXED_CHAT_INFO_ERRORS[failure.reason]);
  }
}
