import { Hono } from 'hono';

import { controlErrorResponse } from '../../control_error_response.ts';
import type { SessionRouteContextTypes } from '../session_route_context_types.ts';

const INLINE_QUERY_ID_PARAMETER = 'inlineQueryId';
const ANSWER_CACHE_EXPIRY_PATH = `/:${INLINE_QUERY_ID_PARAMETER}/answer-cache/expiry` as const;

/**
 * Routes that control the inline answer cache, which the emulator does not expire as time passes:
 * a test chooses when a query's request reaches its bot again. They act on the whole session, as
 * an answer that is not personal is reused for every account.
 */
export function createInlineQueryCacheRoutes(): Hono<SessionRouteContextTypes> {
  const inlineQueryRoutes = new Hono<SessionRouteContextTypes>();

  inlineQueryRoutes.post(ANSWER_CACHE_EXPIRY_PATH, (context) => {
    const result = context.get('emulationSession').inlineQueries.expireAnswerCache(
      context.req.param(INLINE_QUERY_ID_PARAMETER),
    );
    if (!result.expired) {
      return controlErrorResponse(
        context,
        result.reason === 'inline_query_not_found' ? 404 : 409,
        result.reason,
      );
    }
    return context.body(null, 204);
  });

  return inlineQueryRoutes;
}
