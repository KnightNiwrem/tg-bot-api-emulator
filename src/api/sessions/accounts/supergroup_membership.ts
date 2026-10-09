import { Hono } from 'hono';
import { z } from 'zod';

import type { EmulationSession } from '../../../types/emulation_session.ts';
import { isTelegramUsername } from '../../../types/telegram_identity.ts';
import type { Supergroup } from '../../../types/virtual_chat.ts';
import { presentChatInviteLinkUsage, presentChatJoinRequest } from '../invite_link_presentation.ts';
import { readJsonRequestBody } from '../json_request_body.ts';
import type { SessionRouteContextTypes } from '../session_route_context_types.ts';
import {
  ACCOUNT_ID_PARAMETER,
  accountPathSchema,
  SUPERGROUP_CONVERSATION_PATH,
  supergroupConversationPathSchema,
  supergroupMemberPathSchema,
  USER_ID_PARAMETER,
} from './account_paths.ts';

const SUPERGROUP_COLLECTION_PATH = `/:${ACCOUNT_ID_PARAMETER}/supergroups` as const;
const SUPERGROUP_MEMBER_PATH =
  `${SUPERGROUP_CONVERSATION_PATH}/members/:${USER_ID_PARAMETER}` as const;
const SUPERGROUP_INVITE_LINK_COLLECTION_PATH =
  `${SUPERGROUP_CONVERSATION_PATH}/invite-links` as const;
const SUPERGROUP_JOIN_REQUEST_COLLECTION_PATH =
  `${SUPERGROUP_CONVERSATION_PATH}/join-requests` as const;
const SUPERGROUP_JOIN_REQUEST_DECISION_PATH =
  `${SUPERGROUP_JOIN_REQUEST_COLLECTION_PATH}/:${USER_ID_PARAMETER}/decision` as const;
const CHAT_JOIN_COLLECTION_PATH = `/:${ACCOUNT_ID_PARAMETER}/chat-joins` as const;

/** An invite link the account uses, as the bot that created it received it. */
const joinChatByInviteLinkRequestSchema = z.strictObject({
  invite_link: z.string().min(1),
});

/** Whether the administrator lets the requester in or leaves it outside. */
const decideJoinRequestRequestSchema = z.strictObject({
  decision: z.enum(['approve', 'decline']),
});

const createSupergroupRequestSchema = z.strictObject({
  title: z.string().min(1),
  /** Makes the supergroup public under this username, unique among the session's usernames. */
  username: z.string().refine(isTelegramUsername).optional(),
  description: z.string().min(1).optional(),
});

/**
 * Routes through which an account creates supergroups and changes or inspects who belongs to them:
 * members it adds or removes, chats it joins by invite link, the owner's invite links and join
 * requests, and the join requests an administrator decides.
 */
export function createSupergroupMembershipRoutes(): Hono<SessionRouteContextTypes> {
  const accountRoutes = new Hono<SessionRouteContextTypes>();

  accountRoutes.post(SUPERGROUP_COLLECTION_PATH, async (context) => {
    const accountPath = accountPathSchema.safeParse(context.req.param());
    if (!accountPath.success) {
      return context.body(null, 400);
    }
    const { accountId } = accountPath.data;

    const requestBody = await readJsonRequestBody(context.req, createSupergroupRequestSchema);
    if (requestBody === undefined) {
      return context.body(null, 400);
    }

    const { title, username, description } = requestBody;
    const result = context.get('emulationSession').sharedChatAdministration.createSupergroup({
      creatorAccountId: accountId,
      title,
      ...(username === undefined ? {} : { username }),
      description,
    });
    if (!result.created) {
      switch (result.reason) {
        case 'creator_account_not_found':
          return context.body(null, 404);
        case 'username_taken':
          return context.body(null, 409);
        case 'identity_limit_reached':
          return context.body(null, 507);
        default: {
          const unhandledReason: never = result.reason;
          throw new Error(`Unhandled supergroup creation failure: ${unhandledReason}`);
        }
      }
    }
    return context.json({ supergroup: presentSupergroup(result.supergroup) }, 201);
  });

  // The account joins a public supergroup by itself when it names itself, and otherwise adds the
  // member as the owner.
  accountRoutes.put(SUPERGROUP_MEMBER_PATH, (context) => {
    const memberPath = supergroupMemberPathSchema.safeParse(context.req.param());
    if (!memberPath.success) {
      return context.body(null, 400);
    }
    const { accountId, chatId, userId } = memberPath.data;

    if (userId === accountId) {
      const result = context.get('emulationSession').chatAdmission.joinPublicSupergroup({
        accountId,
        chatId,
      });
      if (result.joined) {
        return context.body(null, 204);
      }
      switch (result.reason) {
        // Joining again changes nothing, as a repeated PUT should.
        case 'already_a_member':
          return context.body(null, 204);
        case 'chat_not_public':
        case 'banned':
          return context.body(null, 403);
        case 'account_not_found':
        case 'chat_not_found':
          return context.body(null, 404);
        default: {
          const unhandledReason: never = result.reason;
          throw new Error(`Unhandled public supergroup joining failure: ${unhandledReason}`);
        }
      }
    }

    const result = context.get('emulationSession').sharedChatAdministration.addChatMember({
      actorAccountId: accountId,
      chatId,
      memberId: userId,
    });
    if (result.added) {
      return context.body(null, 204);
    }
    switch (result.reason) {
      // Adding a member again changes nothing, as a repeated PUT should.
      case 'member_already_present':
        return context.body(null, 204);
      case 'actor_not_authorized':
        return context.body(null, 403);
      case 'actor_account_not_found':
      case 'chat_not_found':
      case 'member_not_found':
        return context.body(null, 404);
      // Only supergroups are addressed here, and they accept bots.
      case 'bot_not_permitted_in_channel':
        throw new Error(`Supergroup ${chatId} refused bot ${userId} as a channel`);
      default: {
        const unhandledReason: never = result.reason;
        throw new Error(`Unhandled chat member addition failure: ${unhandledReason}`);
      }
    }
  });

  // The account leaves when it names itself, and otherwise removes the member as the owner.
  accountRoutes.delete(SUPERGROUP_MEMBER_PATH, (context) => {
    const memberPath = supergroupMemberPathSchema.safeParse(context.req.param());
    if (!memberPath.success) {
      return context.body(null, 400);
    }
    const { accountId, chatId, userId } = memberPath.data;

    const { sharedChatAdministration } = context.get('emulationSession');
    if (userId === accountId) {
      const result = sharedChatAdministration.leaveChat({
        memberId: accountId,
        chatId,
      });
      if (result.left) {
        return context.body(null, 204);
      }
      switch (result.reason) {
        // Leaving again changes nothing, as a repeated DELETE should.
        case 'not_a_member':
          return context.body(null, 204);
        case 'member_not_found':
        case 'chat_not_found':
          return context.body(null, 404);
        case 'owner_cannot_leave':
          return context.body(null, 409);
        default: {
          const unhandledReason: never = result.reason;
          throw new Error(`Unhandled chat leaving failure: ${unhandledReason}`);
        }
      }
    }

    const result = sharedChatAdministration.removeChatMember({
      actorAccountId: accountId,
      chatId,
      memberId: userId,
    });
    if (result.removed) {
      return context.body(null, 204);
    }
    switch (result.reason) {
      // Removing a member again changes nothing, as a repeated DELETE should.
      case 'not_a_member':
        return context.body(null, 204);
      case 'actor_not_authorized':
        return context.body(null, 403);
      case 'actor_account_not_found':
      case 'chat_not_found':
      case 'member_not_found':
        return context.body(null, 404);
      // A chat has one owner, and an owner naming itself leaves instead.
      case 'member_is_owner':
        throw new Error(`Supergroup ${chatId} has an owner besides ${accountId}`);
      default: {
        const unhandledReason: never = result.reason;
        throw new Error(`Unhandled chat member removal failure: ${unhandledReason}`);
      }
    }
  });

  // The account joins the chat an invite link leads to, or requests to join it.
  accountRoutes.post(CHAT_JOIN_COLLECTION_PATH, async (context) => {
    const accountPath = accountPathSchema.safeParse(context.req.param());
    if (!accountPath.success) {
      return context.body(null, 400);
    }
    const requestBody = await readJsonRequestBody(context.req, joinChatByInviteLinkRequestSchema);
    if (requestBody === undefined) {
      return context.body(null, 400);
    }

    const result = context.get('emulationSession').chatAdmission.joinChatByInviteLink({
      accountId: accountPath.data.accountId,
      inviteLinkUrl: requestBody.invite_link,
    });
    if (result.used) {
      return context.json({ chat_id: result.chatId, outcome: result.outcome });
    }
    switch (result.reason) {
      case 'account_not_found':
      case 'invite_link_not_found':
        return context.body(null, 404);
      case 'banned':
        return context.body(null, 403);
      case 'already_a_member':
      case 'join_request_pending':
        return context.body(null, 409);
      // `messages.importChatInvite` documents `INVITE_HASH_EXPIRED` for a link that no longer
      // works, which a revoked link is too, and Telegram's clients show a link whose member limit
      // is reached as expired.
      case 'invite_link_revoked':
      case 'invite_link_expired':
      case 'invite_link_member_limit_reached':
        return context.body(null, 410);
      default: {
        const unhandledReason: never = result.reason;
        throw new Error(`Unhandled invite link joining failure: ${unhandledReason}`);
      }
    }
  });

  // The owner inspects the supergroup's invite links and how many members joined through each.
  accountRoutes.get(SUPERGROUP_INVITE_LINK_COLLECTION_PATH, (context) => {
    const conversationPath = supergroupConversationPathSchema.safeParse(context.req.param());
    if (!conversationPath.success) {
      return context.body(null, 400);
    }
    const { accountId, chatId } = conversationPath.data;

    const result = context.get('emulationSession').chatAdmission.getInviteLinksForAccount({
      accountId,
      chatId,
    });
    if (result.found) {
      return context.json({ invite_links: result.links.map(presentChatInviteLinkUsage) });
    }
    return context.body(null, ownerInspectionFailureStatus(result.reason));
  });

  // The owner inspects the pending requests to join the supergroup.
  accountRoutes.get(SUPERGROUP_JOIN_REQUEST_COLLECTION_PATH, (context) => {
    const conversationPath = supergroupConversationPathSchema.safeParse(context.req.param());
    if (!conversationPath.success) {
      return context.body(null, 400);
    }
    const { accountId, chatId } = conversationPath.data;

    const result = context.get('emulationSession').chatAdmission.getJoinRequestsForAccount({
      accountId,
      chatId,
    });
    if (result.found) {
      return context.json({ join_requests: result.requests.map(presentChatJoinRequest) });
    }
    return context.body(null, ownerInspectionFailureStatus(result.reason));
  });

  // The owner or an administrator with `can_invite_users` approves or declines a pending request.
  accountRoutes.post(SUPERGROUP_JOIN_REQUEST_DECISION_PATH, async (context) => {
    const requestPath = supergroupMemberPathSchema.safeParse(context.req.param());
    if (!requestPath.success) {
      return context.body(null, 400);
    }
    const requestBody = await readJsonRequestBody(context.req, decideJoinRequestRequestSchema);
    if (requestBody === undefined) {
      return context.body(null, 400);
    }
    const { accountId, chatId, userId } = requestPath.data;

    const result = context.get('emulationSession').chatAdmission.decideJoinRequestAsAccount({
      deciderAccountId: accountId,
      chatId,
      userId,
      decision: requestBody.decision,
    });
    if (result.decided) {
      return context.body(null, 204);
    }
    switch (result.reason) {
      // A user without a pending request has no request to decide, including once it was decided.
      case 'account_not_found':
      case 'chat_not_found':
      case 'join_request_missing':
        return context.body(null, 404);
      case 'not_enough_rights':
        return context.body(null, 403);
      // An approved request made its user a member, which no decision changes.
      case 'already_a_member':
        return context.body(null, 409);
      default: {
        const unhandledReason: never = result.reason;
        throw new Error(`Unhandled join request decision failure: ${unhandledReason}`);
      }
    }
  });

  return accountRoutes;
}

/**
 * Only the owner inspects a supergroup's invite links and join requests, which chat admission
 * refuses for the same reasons; a missing account or supergroup is not found.
 */
function ownerInspectionFailureStatus(
  reason: Extract<
    ReturnType<EmulationSession['chatAdmission']['getInviteLinksForAccount']>,
    { readonly found: false }
  >['reason'],
): 403 | 404 {
  switch (reason) {
    case 'account_not_found':
    case 'chat_not_found':
      return 404;
    case 'not_the_owner':
      return 403;
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
