import { Hono } from 'hono';

import {
  blockBotContract,
  unblockBotContract,
} from '../../../../control_contracts/blocked_bots.ts';
import { registerControlOperation } from '../../control_operation_route.ts';
import type { SessionRouteContextTypes } from '../session_route_context_types.ts';

/** Where the account routes are mounted within the server, as a contract path template. */
const ACCOUNT_COLLECTION_MOUNT_PATH = '/sessions/{sessionId}/accounts';

/** Routes through which an account blocks and unblocks bots. */
export function createBlockedBotRoutes(): Hono<SessionRouteContextTypes> {
  const accountRoutes = new Hono<SessionRouteContextTypes>();

  registerControlOperation(
    accountRoutes,
    ACCOUNT_COLLECTION_MOUNT_PATH,
    blockBotContract,
    ({ params: { accountId, botId } }, context) => {
      const result = context.get('emulationSession').botBlocking.blockBot({ accountId, botId });
      return result.applied ? { status: 204 } : { status: 404, body: { reason: result.reason } };
    },
  );

  registerControlOperation(
    accountRoutes,
    ACCOUNT_COLLECTION_MOUNT_PATH,
    unblockBotContract,
    ({ params: { accountId, botId } }, context) => {
      const result = context.get('emulationSession').botBlocking.unblockBot({ accountId, botId });
      return result.applied ? { status: 204 } : { status: 404, body: { reason: result.reason } };
    },
  );

  return accountRoutes;
}
