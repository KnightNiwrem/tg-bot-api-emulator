import type { BotApiChatInviteLink, BotApiUser } from '../types/bot_api.ts';
import { type ChatInviteLink, hideInviteLinkHash } from '../types/chat_invite_link.ts';

export interface ChatInviteLinkProjectionInput {
  readonly link: ChatInviteLink;
  /** The administrator that created the link. */
  readonly creator: BotApiUser;
  /** The user that sees the link, which shows the whole link only to its creator. */
  readonly observerId: number;
  /** How many pending join requests were sent through the link. */
  readonly pendingJoinRequestCount: number;
}

/**
 * Projects an invite link as the official Bot API server's `JsonChatInviteLink` shows it, omitting
 * a missing name, expiry date, and member limit, and a count of no pending join requests. As the
 * Bot API documents, a link that another administrator created hides the second part of its hash.
 */
export function projectChatInviteLink(
  { link, creator, observerId, pendingJoinRequestCount }: ChatInviteLinkProjectionInput,
): BotApiChatInviteLink {
  return {
    invite_link: observerId === link.creatorId ? link.url : hideInviteLinkHash(link),
    ...(link.name === undefined ? {} : { name: link.name }),
    creator,
    ...(link.expiresAtUnixSeconds === undefined ? {} : { expire_date: link.expiresAtUnixSeconds }),
    ...(link.memberLimit === undefined ? {} : { member_limit: link.memberLimit }),
    ...(pendingJoinRequestCount === 0
      ? {}
      : { pending_join_request_count: pendingJoinRequestCount }),
    creates_join_request: link.createsJoinRequest,
    is_primary: link.isPrimary,
    is_revoked: link.isRevoked,
  };
}
