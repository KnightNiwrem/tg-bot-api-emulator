import { Hono } from 'hono';
import { z } from 'zod';

import {
  MAX_SUPERGROUP_OR_CHANNEL_ID,
  MAX_TELEGRAM_USER_ID,
  MIN_SUPERGROUP_OR_CHANNEL_ID,
  MIN_TELEGRAM_USER_ID,
} from '../../../types/telegram_identity.ts';
import type { SessionRouteContextTypes } from '../session_route_context_types.ts';

const CHAT_ID_PARAMETER = 'chatId';
const USER_ID_PARAMETER = 'userId';
const RESTRICTION_EXPIRY_PATH =
  `/:${CHAT_ID_PARAMETER}/restrictions/:${USER_ID_PARAMETER}/expiry` as const;

/** The path parameters of a supergroup user's restriction. */
const restrictionPathSchema = z.object({
  [CHAT_ID_PARAMETER]: z.coerce.number().pipe(
    z.int().min(MIN_SUPERGROUP_OR_CHANNEL_ID).max(MAX_SUPERGROUP_OR_CHANNEL_ID),
  ),
  [USER_ID_PARAMETER]: z.coerce.number().pipe(
    z.int().min(MIN_TELEGRAM_USER_ID).max(MAX_TELEGRAM_USER_ID),
  ),
});

/**
 * Routes that control supergroups' time, which the emulator does not let pass by itself: a test
 * makes a temporary restriction's end arrive when it chooses.
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
    const chatMember = botMessageViews.viewChatMember(userId, result.status);
    if (chatMember === undefined) {
      throw new Error(`User ${userId} whose restriction expired does not exist`);
    }
    return context.json({ chat_member: chatMember });
  });

  return supergroupRoutes;
}
