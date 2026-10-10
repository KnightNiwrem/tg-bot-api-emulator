import type { EmulationSession } from '../../types/emulation_session.ts';

/** An invite link with how many current members joined through it, as the emulation API shows it. */
type ChatInviteLinkUsage = Extract<
  ReturnType<EmulationSession['chatAdmission']['getInviteLinksForAccount']>,
  { readonly found: true }
>['links'][number];

/** A pending request to join a supergroup with the bots that may contact its user. */
type ChatJoinRequest = Extract<
  ReturnType<EmulationSession['chatAdmission']['getJoinRequestsForAccount']>,
  { readonly found: true }
>['requests'][number];

/**
 * Shows an invite link as the supergroup's owner inspects it, with the whole link, the Bot API's
 * field names, how many members joined through it and still are, how many pending join requests
 * were sent through it, whether it is its creator's primary link, whether a test made its expiry
 * date arrive, and whether it was revoked.
 */
export function presentChatInviteLinkUsage(
  { link, memberCount, pendingJoinRequestCount }: ChatInviteLinkUsage,
) {
  return {
    invite_link: link.url,
    ...(link.name === undefined ? {} : { name: link.name }),
    creator_user_id: link.creatorId,
    ...(link.expiresAtUnixSeconds === undefined ? {} : { expire_date: link.expiresAtUnixSeconds }),
    ...(link.memberLimit === undefined ? {} : { member_limit: link.memberLimit }),
    member_count: memberCount,
    pending_join_request_count: pendingJoinRequestCount,
    creates_join_request: link.createsJoinRequest,
    is_primary: link.isPrimary,
    is_expired: link.hasExpired,
    is_revoked: link.isRevoked,
  };
}

/**
 * Shows a pending join request as the supergroup's owner inspects it, with the state of its
 * requester contact and the bots that may write to the user under it.
 */
export function presentChatJoinRequest(
  { request: { userId, inviteLinkUrl, requestedAtUnixSeconds, requesterContact }, contactBotIds }:
    ChatJoinRequest,
) {
  return {
    user_id: userId,
    invite_link: inviteLinkUrl,
    date: requestedAtUnixSeconds,
    requester_contact: { status: requesterContact.status, bot_ids: contactBotIds },
  };
}
