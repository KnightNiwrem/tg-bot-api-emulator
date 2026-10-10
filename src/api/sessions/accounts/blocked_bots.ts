import { Hono } from 'hono';

import {
  controlErrorResponse,
  invalidControlRequestResponse,
} from '../../control_error_response.ts';
import { readPathParameters } from '../control_request_input.ts';
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
    const conversationPath = readPathParameters(privateConversationPathSchema, context.req.param());
    if (!conversationPath.valid) {
      return invalidControlRequestResponse(context, conversationPath.issues);
    }
    const { accountId, botId } = conversationPath.value;

    const result = context.get('emulationSession').botBlocking.blockBot({
      accountId,
      botId,
    });
    return result.applied
      ? context.body(null, 204)
      : controlErrorResponse(context, 404, result.reason);
  });

  accountRoutes.delete(BLOCKED_BOT_PATH, (context) => {
    const conversationPath = readPathParameters(privateConversationPathSchema, context.req.param());
    if (!conversationPath.valid) {
      return invalidControlRequestResponse(context, conversationPath.issues);
    }
    const { accountId, botId } = conversationPath.value;

    const result = context.get('emulationSession').botBlocking.unblockBot({
      accountId,
      botId,
    });
    return result.applied
      ? context.body(null, 204)
      : controlErrorResponse(context, 404, result.reason);
  });

  return accountRoutes;
}
