import { Hono } from 'hono';

import { expireInlineAnswerCacheContract } from '../../../../control_contracts/inline_queries.ts';
import { registerControlOperation } from '../../control_operation_route.ts';
import type { SessionRouteContextTypes } from '../session_route_context_types.ts';

/** Where the inline query routes are mounted within the server, as a contract path template. */
const INLINE_QUERY_COLLECTION_MOUNT_PATH = '/sessions/{sessionId}/inline-queries';

/**
 * Routes that control the inline answer cache, which the emulator does not expire as time passes:
 * a test chooses when a query's request reaches its bot again. They act on the whole session, as
 * an answer that is not personal is reused for every account.
 */
export function createInlineQueryCacheRoutes(): Hono<SessionRouteContextTypes> {
  const inlineQueryRoutes = new Hono<SessionRouteContextTypes>();

  registerControlOperation(
    inlineQueryRoutes,
    INLINE_QUERY_COLLECTION_MOUNT_PATH,
    expireInlineAnswerCacheContract,
    ({ params: { inlineQueryId } }, context) => {
      const result = context.get('emulationSession').inlineQueries.expireAnswerCache(
        inlineQueryId,
      );
      if (result.expired) {
        return { status: 204 };
      }
      return result.reason === 'inline_query_not_found'
        ? { status: 404, body: { reason: result.reason } }
        : { status: 409, body: { reason: result.reason } };
    },
  );

  return inlineQueryRoutes;
}
