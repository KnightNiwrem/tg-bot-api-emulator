import type { EmulationSession } from '../../../../session/emulation_session.ts';
import type { AuthenticatedBotFailure } from '../authenticated_bot_failures.ts';
import { BOT_CHAT_ACCESS_ERRORS } from '../chat_access.ts';
import type { BotApiMethodAnswer } from '../method_call.ts';
import { BOT_API_ERRORS } from './error_catalogue.ts';
import { type FixedBotApiError, presentFixedBotApiError } from './error_template.ts';

type ChatAdmission = EmulationSession['chatAdmission'];

/**
 * A private chat, as `findPrivateChatRefusal` refuses it: one the bot knows has no invite links,
 * and one it does not know is not found.
 */
interface PrivateChatInviteLinkRefusal {
  readonly reason: 'private_chat_has_no_invite_links' | 'chat_not_found';
}

/** Why `exportChatInviteLink` exported no link. */
export type InviteLinkExportFailure =
  | AuthenticatedBotFailure<
    Extract<ReturnType<ChatAdmission['exportPrimaryInviteLinkAsBot']>, { readonly exported: false }>
  >
  | ({ readonly exported: false } & PrivateChatInviteLinkRefusal);

/** Why `createChatInviteLink` created no link. */
export type InviteLinkCreationFailure =
  | AuthenticatedBotFailure<
    Extract<ReturnType<ChatAdmission['createInviteLinkAsBot']>, { readonly created: false }>
  >
  | ({ readonly created: false } & PrivateChatInviteLinkRefusal);

/** Why `editChatInviteLink` edited no link. */
export type InviteLinkEditFailure =
  | AuthenticatedBotFailure<
    Extract<ReturnType<ChatAdmission['editInviteLinkAsBot']>, { readonly edited: false }>
  >
  | ({ readonly edited: false } & PrivateChatInviteLinkRefusal);

/** Why `revokeChatInviteLink` revoked no link. */
export type InviteLinkRevocationFailure =
  | AuthenticatedBotFailure<
    Extract<ReturnType<ChatAdmission['revokeInviteLinkAsBot']>, { readonly revoked: false }>
  >
  | ({ readonly revoked: false } & PrivateChatInviteLinkRefusal);

/** Why a bot could not export, create, edit or revoke an invite link. */
type ChatInviteLinkFailure =
  | InviteLinkExportFailure
  | InviteLinkCreationFailure
  | InviteLinkEditFailure
  | InviteLinkRevocationFailure;

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
