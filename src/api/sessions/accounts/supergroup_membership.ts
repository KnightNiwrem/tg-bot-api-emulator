import { Hono } from 'hono';

import type {
  ControlOperationRefusal,
  ControlOperationResponse,
} from '../../../../control_contracts/operation_contract.ts';
import {
  addSupergroupMemberContract,
  createSupergroupContract,
  decideSupergroupJoinRequestContract,
  getSupergroupInviteLinksContract,
  getSupergroupJoinRequestsContract,
  joinChatByInviteLinkContract,
  removeSupergroupMemberContract,
} from '../../../../control_contracts/supergroups.ts';
import type { EmulationSession } from '../../../types/emulation_session.ts';
import type { Supergroup } from '../../../types/virtual_chat.ts';
import { registerControlOperation } from '../../control_operation_route.ts';
import { presentChatInviteLinkUsage, presentChatJoinRequest } from '../invite_link_presentation.ts';
import type { SessionRouteContextTypes } from '../session_route_context_types.ts';

/** Where the account routes are mounted within the server, as a contract path template. */
const ACCOUNT_COLLECTION_MOUNT_PATH = '/sessions/{sessionId}/accounts';

type ChatAdmission = EmulationSession['chatAdmission'];
type SharedChatAdministration = EmulationSession['sharedChatAdministration'];

/**
 * Routes through which an account creates supergroups and changes or inspects who belongs to them:
 * members it adds or removes, chats it joins by invite link, the owner's invite links and join
 * requests, and the join requests an administrator decides.
 */
export function createSupergroupMembershipRoutes(): Hono<SessionRouteContextTypes> {
  const accountRoutes = new Hono<SessionRouteContextTypes>();

  registerControlOperation(
    accountRoutes,
    ACCOUNT_COLLECTION_MOUNT_PATH,
    createSupergroupContract,
    ({ params, body }, context) => {
      const result = context.get('emulationSession').sharedChatAdministration.createSupergroup({
        creatorAccountId: params.accountId,
        title: body.title,
        ...(body.username === undefined ? {} : { username: body.username }),
        description: body.description,
      });
      if (result.created) {
        return { status: 201, body: { supergroup: presentSupergroup(result.supergroup) } };
      }
      switch (result.reason) {
        case 'creator_account_not_found':
          return { status: 404, body: { reason: result.reason } };
        case 'username_taken':
          return { status: 409, body: { reason: result.reason } };
        case 'identity_limit_reached':
          return { status: 507, body: { reason: result.reason } };
        default: {
          const unhandledReason: never = result.reason;
          throw new Error(`Unhandled supergroup creation failure: ${unhandledReason}`);
        }
      }
    },
  );

  // The account joins a public supergroup by itself when it names itself, and otherwise adds the
  // member as the owner.
  registerControlOperation(
    accountRoutes,
    ACCOUNT_COLLECTION_MOUNT_PATH,
    addSupergroupMemberContract,
    ({ params: { accountId, chatId, userId } }, context) => {
      const { chatAdmission, sharedChatAdministration } = context.get('emulationSession');
      return userId === accountId
        ? joinPublicSupergroup(chatAdmission, accountId, chatId)
        : addChatMember(sharedChatAdministration, accountId, chatId, userId);
    },
  );

  // The account leaves when it names itself, and otherwise removes the member as the owner.
  registerControlOperation(
    accountRoutes,
    ACCOUNT_COLLECTION_MOUNT_PATH,
    removeSupergroupMemberContract,
    ({ params: { accountId, chatId, userId } }, context) => {
      const { sharedChatAdministration } = context.get('emulationSession');
      return userId === accountId
        ? leaveChat(sharedChatAdministration, accountId, chatId)
        : removeChatMember(sharedChatAdministration, accountId, chatId, userId);
    },
  );

  // The account joins the chat an invite link leads to, or requests to join it.
  registerControlOperation(
    accountRoutes,
    ACCOUNT_COLLECTION_MOUNT_PATH,
    joinChatByInviteLinkContract,
    ({ params, body }, context) => {
      const result = context.get('emulationSession').chatAdmission.joinChatByInviteLink({
        accountId: params.accountId,
        inviteLinkUrl: body.invite_link,
      });
      if (result.used) {
        return { status: 200, body: { chat_id: result.chatId, outcome: result.outcome } };
      }
      switch (result.reason) {
        case 'account_not_found':
        case 'invite_link_not_found':
          return { status: 404, body: { reason: result.reason } };
        case 'banned':
          return { status: 403, body: { reason: result.reason } };
        case 'already_a_member':
        case 'join_request_pending':
          return { status: 409, body: { reason: result.reason } };
        // `messages.importChatInvite` documents `INVITE_HASH_EXPIRED` for a link that no longer
        // works, which a revoked link is too, and Telegram's clients show a link whose member limit
        // is reached as expired.
        case 'invite_link_revoked':
        case 'invite_link_expired':
        case 'invite_link_member_limit_reached':
          return { status: 410, body: { reason: result.reason } };
        default: {
          const unhandledReason: never = result.reason;
          throw new Error(`Unhandled invite link joining failure: ${unhandledReason}`);
        }
      }
    },
  );

  // The owner inspects the supergroup's invite links and how many members joined through each.
  registerControlOperation(
    accountRoutes,
    ACCOUNT_COLLECTION_MOUNT_PATH,
    getSupergroupInviteLinksContract,
    ({ params: { accountId, chatId } }, context) => {
      const result = context.get('emulationSession').chatAdmission.getInviteLinksForAccount({
        accountId,
        chatId,
      });
      return result.found
        ? { status: 200, body: { invite_links: result.links.map(presentChatInviteLinkUsage) } }
        : refuseOwnerInspection(result.reason);
    },
  );

  // The owner inspects the pending requests to join the supergroup.
  registerControlOperation(
    accountRoutes,
    ACCOUNT_COLLECTION_MOUNT_PATH,
    getSupergroupJoinRequestsContract,
    ({ params: { accountId, chatId } }, context) => {
      const result = context.get('emulationSession').chatAdmission.getJoinRequestsForAccount({
        accountId,
        chatId,
      });
      return result.found
        ? { status: 200, body: { join_requests: result.requests.map(presentChatJoinRequest) } }
        : refuseOwnerInspection(result.reason);
    },
  );

  // The owner or an administrator with `can_invite_users` approves or declines a pending request.
  registerControlOperation(
    accountRoutes,
    ACCOUNT_COLLECTION_MOUNT_PATH,
    decideSupergroupJoinRequestContract,
    ({ params: { accountId, chatId, userId }, body }, context) => {
      const result = context.get('emulationSession').chatAdmission.decideJoinRequestAsAccount({
        deciderAccountId: accountId,
        chatId,
        userId,
        decision: body.decision,
      });
      if (result.decided) {
        return { status: 204 };
      }
      switch (result.reason) {
        // A user without a pending request has no request to decide, including once it was
        // decided.
        case 'account_not_found':
        case 'chat_not_found':
        case 'join_request_missing':
          return { status: 404, body: { reason: result.reason } };
        case 'not_enough_rights':
          return { status: 403, body: { reason: result.reason } };
        // An approved request made its user a member, which no decision changes.
        case 'already_a_member':
          return { status: 409, body: { reason: result.reason } };
        default: {
          const unhandledReason: never = result.reason;
          throw new Error(`Unhandled join request decision failure: ${unhandledReason}`);
        }
      }
    },
  );

  return accountRoutes;
}

function joinPublicSupergroup(
  chatAdmission: ChatAdmission,
  accountId: number,
  chatId: number,
): ControlOperationResponse<typeof addSupergroupMemberContract> {
  const result = chatAdmission.joinPublicSupergroup({ accountId, chatId });
  if (result.joined) {
    return { status: 204 };
  }
  switch (result.reason) {
    // Joining again changes nothing, as a repeated PUT should.
    case 'already_a_member':
      return { status: 204 };
    case 'chat_not_public':
    case 'banned':
      return { status: 403, body: { reason: result.reason } };
    case 'account_not_found':
    case 'chat_not_found':
      return { status: 404, body: { reason: result.reason } };
    default: {
      const unhandledReason: never = result.reason;
      throw new Error(`Unhandled public supergroup joining failure: ${unhandledReason}`);
    }
  }
}

function addChatMember(
  sharedChatAdministration: SharedChatAdministration,
  accountId: number,
  chatId: number,
  userId: number,
): ControlOperationResponse<typeof addSupergroupMemberContract> {
  const result = sharedChatAdministration.addChatMember({
    actorAccountId: accountId,
    chatId,
    memberId: userId,
  });
  if (result.added) {
    return { status: 204 };
  }
  switch (result.reason) {
    // Adding a member again changes nothing, as a repeated PUT should.
    case 'member_already_present':
      return { status: 204 };
    case 'actor_not_authorized':
      return { status: 403, body: { reason: result.reason } };
    case 'actor_account_not_found':
    case 'chat_not_found':
    case 'member_not_found':
      return { status: 404, body: { reason: result.reason } };
    // Only supergroups are addressed here, and they accept bots.
    case 'bot_not_permitted_in_channel':
      throw new Error(`Supergroup ${chatId} refused bot ${userId} as a channel`);
    default: {
      const unhandledReason: never = result.reason;
      throw new Error(`Unhandled chat member addition failure: ${unhandledReason}`);
    }
  }
}

function leaveChat(
  sharedChatAdministration: SharedChatAdministration,
  accountId: number,
  chatId: number,
): ControlOperationResponse<typeof removeSupergroupMemberContract> {
  const result = sharedChatAdministration.leaveChat({ memberId: accountId, chatId });
  if (result.left) {
    return { status: 204 };
  }
  switch (result.reason) {
    // Leaving again changes nothing, as a repeated DELETE should.
    case 'not_a_member':
      return { status: 204 };
    case 'member_not_found':
    case 'chat_not_found':
      return { status: 404, body: { reason: result.reason } };
    case 'owner_cannot_leave':
      return { status: 409, body: { reason: result.reason } };
    default: {
      const unhandledReason: never = result.reason;
      throw new Error(`Unhandled chat leaving failure: ${unhandledReason}`);
    }
  }
}

function removeChatMember(
  sharedChatAdministration: SharedChatAdministration,
  accountId: number,
  chatId: number,
  userId: number,
): ControlOperationResponse<typeof removeSupergroupMemberContract> {
  const result = sharedChatAdministration.removeChatMember({
    actorAccountId: accountId,
    chatId,
    memberId: userId,
  });
  if (result.removed) {
    return { status: 204 };
  }
  switch (result.reason) {
    // Removing a member again changes nothing, as a repeated DELETE should.
    case 'not_a_member':
      return { status: 204 };
    case 'actor_not_authorized':
      return { status: 403, body: { reason: result.reason } };
    case 'actor_account_not_found':
    case 'chat_not_found':
    case 'member_not_found':
      return { status: 404, body: { reason: result.reason } };
    // A chat has one owner, and an owner naming itself leaves instead.
    case 'member_is_owner':
      throw new Error(`Supergroup ${chatId} has an owner besides ${accountId}`);
    default: {
      const unhandledReason: never = result.reason;
      throw new Error(`Unhandled chat member removal failure: ${unhandledReason}`);
    }
  }
}

/**
 * Only the owner inspects a supergroup's invite links and join requests, which chat admission
 * refuses for the same reasons; a missing account or supergroup is not found.
 */
function refuseOwnerInspection(
  reason: Extract<
    ReturnType<ChatAdmission['getInviteLinksForAccount']>,
    { readonly found: false }
  >['reason'],
): Exclude<
  ControlOperationRefusal<typeof getSupergroupInviteLinksContract>,
  { readonly status: 400 }
> {
  switch (reason) {
    case 'account_not_found':
    case 'chat_not_found':
      return { status: 404, body: { reason } };
    case 'not_the_owner':
      return { status: 403, body: { reason } };
    default: {
      const unhandledReason: never = reason;
      throw new Error(`Unhandled owner inspection failure: ${unhandledReason}`);
    }
  }
}

/** Shows a supergroup as the Bot API shows a chat, with its description when it has one. */
function presentSupergroup({ id, title, username, description }: Supergroup) {
  return {
    id,
    type: 'supergroup' as const,
    title,
    ...(username === undefined ? {} : { username }),
    ...(description === undefined ? {} : { description }),
  };
}
