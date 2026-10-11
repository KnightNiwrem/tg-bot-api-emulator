import type { EmulationSession } from '../../../../session/emulation_session.ts';
import type { AuthenticatedBotFailure } from '../authenticated_bot_failures.ts';
import { BOT_CHAT_ACCESS_ERRORS } from '../chat_access.ts';
import type { BotApiMethodAnswer } from '../method_call.ts';
import { BOT_API_ERRORS } from './error_catalogue.ts';
import { type FixedBotApiError, presentFixedBotApiError } from './error_template.ts';

type ChatAdmission = EmulationSession['chatAdmission'];

/** Why `approveChatJoinRequest` or `declineChatJoinRequest` decided nothing. */
export type ChatJoinRequestDecisionFailure =
  | AuthenticatedBotFailure<
    Extract<
      ReturnType<
        ChatAdmission['approveJoinRequestAsBot'] | ChatAdmission['declineJoinRequestAsBot']
      >,
      { readonly decided: false }
    >
  >
  // A private chat, as `findPrivateChatRefusal` refuses it.
  | {
    readonly decided: false;
    readonly reason: 'private_chat_has_no_join_requests' | 'chat_not_found';
  };

/**
 * Telegram's errors for the failures of the join request family, by reason: TDLib's checks of the
 * chat and the bot's rights, and Telegram's servers' errors for the request itself.
 */
const CHAT_JOIN_REQUEST_ERRORS = {
  ...BOT_CHAT_ACCESS_ERRORS,
  private_chat_has_no_join_requests: BOT_API_ERRORS.privateChatHasNoJoinRequests,
  not_enough_rights: BOT_API_ERRORS.notEnoughRightsToManageJoinRequests,
  already_a_member: BOT_API_ERRORS.joinRequesterAlreadyMember,
  join_request_missing: BOT_API_ERRORS.joinRequestMissing,
} as const satisfies Readonly<Record<string, FixedBotApiError>>;

/** Telegram's error for a refused decision on a join request; approvals and declines read alike. */
export function presentChatJoinRequestFailure(
  failure: ChatJoinRequestDecisionFailure,
): BotApiMethodAnswer {
  return presentFixedBotApiError(CHAT_JOIN_REQUEST_ERRORS[failure.reason]);
}
