import type { EmulationSession } from '../../types/emulation_session.ts';

/** An invite link with how many current members joined through it, as the emulation API shows it. */
type ChatInviteLinkUsage = Extract<
  ReturnType<EmulationSession['chatAdmission']['getInviteLinksForAccount']>,
  { readonly found: true }
>['links'][number];

/**
 * Shows an invite link as the supergroup's owner inspects it, with the whole link, the Bot API's
 * field names, how many members joined through it and still are, and whether a test made its
 * expiry date arrive.
 */
export function presentChatInviteLinkUsage({ link, memberCount }: ChatInviteLinkUsage) {
  return {
    invite_link: link.url,
    ...(link.name === undefined ? {} : { name: link.name }),
    creator_user_id: link.creatorId,
    ...(link.expiresAtUnixSeconds === undefined ? {} : { expire_date: link.expiresAtUnixSeconds }),
    ...(link.memberLimit === undefined ? {} : { member_limit: link.memberLimit }),
    member_count: memberCount,
    creates_join_request: link.createsJoinRequest,
    is_expired: link.hasExpired,
  };
}
