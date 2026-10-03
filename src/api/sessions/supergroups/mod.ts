import { Hono } from 'hono';
import { z } from 'zod';

import { INVITE_LINK_PREFIX, isInviteLinkHash } from '../../../types/chat_invite_link.ts';
import {
  MAX_SUPERGROUP_OR_CHANNEL_ID,
  MAX_TELEGRAM_USER_ID,
  MIN_SUPERGROUP_OR_CHANNEL_ID,
  MIN_TELEGRAM_USER_ID,
} from '../../../types/telegram_identity.ts';
import { presentChatInviteLinkUsage } from '../invite_link_presentation.ts';
import type { SessionRouteContextTypes } from '../session_route_context_types.ts';

const CHAT_ID_PARAMETER = 'chatId';
const USER_ID_PARAMETER = 'userId';
const INVITE_LINK_HASH_PARAMETER = 'inviteLinkHash';
const RESTRICTION_EXPIRY_PATH =
  `/:${CHAT_ID_PARAMETER}/restrictions/:${USER_ID_PARAMETER}/expiry` as const;
const INVITE_LINK_EXPIRY_PATH =
  `/:${CHAT_ID_PARAMETER}/invite-links/:${INVITE_LINK_HASH_PARAMETER}/expiry` as const;

const supergroupChatIdPathParameterSchema = z.coerce.number().pipe(
  z.int().min(MIN_SUPERGROUP_OR_CHANNEL_ID).max(MAX_SUPERGROUP_OR_CHANNEL_ID),
);

/** The path parameters of a supergroup user's restriction. */
const restrictionPathSchema = z.object({
  [CHAT_ID_PARAMETER]: supergroupChatIdPathParameterSchema,
  [USER_ID_PARAMETER]: z.coerce.number().pipe(
    z.int().min(MIN_TELEGRAM_USER_ID).max(MAX_TELEGRAM_USER_ID),
  ),
});

/** The path parameters of a supergroup's invite link, named by its hash. */
const inviteLinkPathSchema = z.object({
  [CHAT_ID_PARAMETER]: supergroupChatIdPathParameterSchema,
  [INVITE_LINK_HASH_PARAMETER]: z.string().refine(isInviteLinkHash),
});

/**
 * Routes that control supergroups' time, which the emulator does not let pass by itself: a test
 * makes a temporary restriction's end, or an invite link's expiry date, arrive when it chooses.
 */
export function createSupergroupRoutes(): Hono<SessionRouteContextTypes> {
  const supergroupRoutes = new Hono<SessionRouteContextTypes>();

  supergroupRoutes.post(RESTRICTION_EXPIRY_PATH, (context) => {
    const restrictionPath = restrictionPathSchema.safeParse(context.req.param());
    if (!restrictionPath.success) {
      return context.body(null, 400);
    }
    const { chatId, userId } = restrictionPath.data;

    const { sharedChatAdministration, botMessageViews } = context.get('emulationSession');
    const result = sharedChatAdministration.expireRestriction({ chatId, memberId: userId });
    if (!result.expired) {
      return context.body(null, result.reason === 'restriction_not_temporary' ? 409 : 404);
    }
    const chatMember = botMessageViews.viewChatMember({ chatId, userId, status: result.status });
    if (chatMember === undefined) {
      throw new Error(`User ${userId} whose restriction expired does not exist`);
    }
    return context.json({ chat_member: chatMember });
  });

  supergroupRoutes.post(INVITE_LINK_EXPIRY_PATH, (context) => {
    const inviteLinkPath = inviteLinkPathSchema.safeParse(context.req.param());
    if (!inviteLinkPath.success) {
      return context.body(null, 400);
    }
    const { chatId, inviteLinkHash } = inviteLinkPath.data;

    const result = context.get('emulationSession').chatAdmission.expireInviteLink({
      chatId,
      inviteLinkUrl: `${INVITE_LINK_PREFIX}${inviteLinkHash}`,
    });
    if (!result.expired) {
      return context.body(null, result.reason === 'invite_link_not_expirable' ? 409 : 404);
    }
    return context.json({ invite_link: presentChatInviteLinkUsage(result.link) });
  });

  return supergroupRoutes;
}
