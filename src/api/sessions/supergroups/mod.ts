import { Hono } from 'hono';

import { expireSupergroupMemberRestrictionContract } from '../../../../control_contracts/supergroup_administration.ts';
import {
  expireChatInviteLinkContract,
  expireJoinRequesterContactContract,
} from '../../../../control_contracts/supergroups.ts';
import { INVITE_LINK_PREFIX } from '../../../types/chat_invite_link.ts';
import { registerControlOperation } from '../../control_operation_route.ts';
import { presentChatInviteLinkUsage, presentChatJoinRequest } from '../invite_link_presentation.ts';
import type { SessionRouteContextTypes } from '../session_route_context_types.ts';

/** Where the supergroup routes are mounted within the server, as a contract path template. */
const SUPERGROUP_COLLECTION_MOUNT_PATH = '/sessions/{sessionId}/supergroups';

/**
 * Routes that control supergroups' time, which the emulator does not let pass by itself: a test
 * makes a temporary restriction's end, an invite link's expiry date, or the end of a join
 * request's contact window arrive when it chooses.
 */
export function createSupergroupRoutes(): Hono<SessionRouteContextTypes> {
  const supergroupRoutes = new Hono<SessionRouteContextTypes>();

  registerControlOperation(
    supergroupRoutes,
    SUPERGROUP_COLLECTION_MOUNT_PATH,
    expireSupergroupMemberRestrictionContract,
    ({ params: { chatId, userId } }, context) => {
      const { sharedChatAdministration, botMessageViews } = context.get('emulationSession');
      const result = sharedChatAdministration.expireRestriction({ chatId, memberId: userId });
      if (!result.expired) {
        return result.reason === 'restriction_not_temporary'
          ? { status: 409, body: { reason: result.reason } }
          : { status: 404, body: { reason: result.reason } };
      }
      const chatMember = botMessageViews.viewChatMember({ chatId, userId, status: result.status });
      if (chatMember === undefined) {
        throw new Error(`User ${userId} whose restriction expired does not exist`);
      }
      // A restriction that ends leaves a member a member, and a user outside the supergroup left.
      const { status } = chatMember;
      if (status !== 'member' && status !== 'left') {
        throw new Error(`User ${userId} whose restriction expired is ${status}`);
      }
      // A shallow copy, whose plain object type the contract's open Telegram object describes.
      return { status: 200, body: { chat_member: { ...chatMember, status } } };
    },
  );

  registerControlOperation(
    supergroupRoutes,
    SUPERGROUP_COLLECTION_MOUNT_PATH,
    expireChatInviteLinkContract,
    ({ params: { chatId, inviteLinkHash } }, context) => {
      const result = context.get('emulationSession').chatAdmission.expireInviteLink({
        chatId,
        inviteLinkUrl: `${INVITE_LINK_PREFIX}${inviteLinkHash}`,
      });
      if (result.expired) {
        return { status: 200, body: { invite_link: presentChatInviteLinkUsage(result.link) } };
      }
      return result.reason === 'invite_link_not_expirable'
        ? { status: 409, body: { reason: result.reason } }
        : { status: 404, body: { reason: result.reason } };
    },
  );

  registerControlOperation(
    supergroupRoutes,
    SUPERGROUP_COLLECTION_MOUNT_PATH,
    expireJoinRequesterContactContract,
    ({ params: { chatId, userId } }, context) => {
      const result = context.get('emulationSession').chatAdmission.expireJoinRequesterContact({
        chatId,
        userId,
      });
      if (result.expired) {
        return { status: 200, body: { join_request: presentChatJoinRequest(result.request) } };
      }
      return result.reason === 'requester_contact_already_expired'
        ? { status: 409, body: { reason: result.reason } }
        : { status: 404, body: { reason: result.reason } };
    },
  );

  return supergroupRoutes;
}
