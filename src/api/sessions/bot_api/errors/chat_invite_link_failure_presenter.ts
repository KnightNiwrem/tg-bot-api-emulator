import type { EmulationSession } from '../../../../types/emulation_session.ts';
import { BOT_CHAT_ACCESS_ERRORS } from '../chat_access.ts';
import type { BotApiMethodAnswer } from '../method_call.ts';
import { BOT_API_ERRORS } from './error_catalogue.ts';
import { type FixedBotApiError, presentFixedBotApiError } from './error_template.ts';

type BotApi = EmulationSession['botApi'];

/** Why a bot could not export, create, edit or revoke an invite link. */
type ChatInviteLinkFailure =
  | Extract<ReturnType<BotApi['exportChatInviteLink']>, { readonly exported: false }>
  | Extract<ReturnType<BotApi['createChatInviteLink']>, { readonly created: false }>
  | Extract<ReturnType<BotApi['editChatInviteLink']>, { readonly edited: false }>
  | Extract<ReturnType<BotApi['revokeChatInviteLink']>, { readonly revoked: false }>;

/**
 * Telegram's errors for the failures of the invite link family, by reason: TDLib's checks of the
 * chat and the bot's rights, and Telegram's servers' errors for the link itself.
 */
const CHAT_INVITE_LINK_ERRORS = {
  ...BOT_CHAT_ACCESS_ERRORS,
  private_chat_has_no_invite_links: BOT_API_ERRORS.privateChatHasNoInviteLinks,
  not_enough_rights: BOT_API_ERRORS.notEnoughRightsToManageInviteLinks,
  text_encoding_invalid: BOT_API_ERRORS.stringsNotUtf8,
  member_limit_with_join_request: BOT_API_ERRORS.inviteLinkMemberLimitWithJoinRequest,
  invite_link_empty: BOT_API_ERRORS.inviteLinkEmpty,
  expiry_date_invalid: BOT_API_ERRORS.inviteLinkExpiryDateInvalid,
  member_limit_invalid: BOT_API_ERRORS.inviteLinkMemberLimitInvalid,
  invite_link_not_found: BOT_API_ERRORS.inviteLinkUnavailable,
  invite_link_revoked: BOT_API_ERRORS.inviteLinkUnavailable,
  not_the_link_creator: BOT_API_ERRORS.inviteLinkOfAnotherAdministrator,
  primary_invite_link_not_editable: BOT_API_ERRORS.primaryInviteLinkNotEditable,
} as const satisfies Readonly<Record<string, FixedBotApiError>>;

/** Telegram's error for a refused invite link method; its failures read alike for each method. */
export function presentChatInviteLinkFailure(failure: ChatInviteLinkFailure): BotApiMethodAnswer {
  return presentFixedBotApiError(CHAT_INVITE_LINK_ERRORS[failure.reason]);
}
