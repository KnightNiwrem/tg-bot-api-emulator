import { Hono } from 'hono';

import type { SessionRouteContextTypes } from '../session_route_context_types.ts';
import {
  ACCOUNT_ID_PARAMETER,
  BOT_ID_PARAMETER,
  privateConversationPathSchema,
} from './account_paths.ts';

const BLOCKED_BOT_PATH = `/:${ACCOUNT_ID_PARAMETER}/blocked-bots/:${BOT_ID_PARAMETER}` as const;

/** Routes through which an account blocks and unblocks bots. */
export function createBlockedBotRoutes(): Hono<SessionRouteContextTypes> {
  const accountRoutes = new Hono<SessionRouteContextTypes>();

  accountRoutes.put(BLOCKED_BOT_PATH, (context) => {
    const conversationPath = privateConversationPathSchema.safeParse(context.req.param());
    if (!conversationPath.success) {
      return context.body(null, 400);
    }
    const { accountId, botId } = conversationPath.data;

    const result = context.get('emulationSession').botBlocking.blockBot({
      accountId,
      botId,
    });
    return context.body(null, result.applied ? 204 : 404);
  });

  accountRoutes.delete(BLOCKED_BOT_PATH, (context) => {
    const conversationPath = privateConversationPathSchema.safeParse(context.req.param());
    if (!conversationPath.success) {
      return context.body(null, 400);
    }
    const { accountId, botId } = conversationPath.data;

    const result = context.get('emulationSession').botBlocking.unblockBot({
      accountId,
      botId,
    });
    return context.body(null, result.applied ? 204 : 404);
  });

  return accountRoutes;
}
