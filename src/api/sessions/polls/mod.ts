import { Hono } from 'hono';

import { controlErrorResponse } from '../../control_error_response.ts';
import type { SessionRouteContextTypes } from '../session_route_context_types.ts';

const POLL_ID_PARAMETER = 'pollId';
const POLL_EXPIRY_PATH = `/:${POLL_ID_PARAMETER}/expiry` as const;

/**
 * Routes that control polls' time, which the emulator does not let pass by itself: a test makes a
 * poll's closing time arrive when it chooses.
 */
export function createPollRoutes(): Hono<SessionRouteContextTypes> {
  const pollRoutes = new Hono<SessionRouteContextTypes>();

  pollRoutes.post(POLL_EXPIRY_PATH, (context) => {
    const { polls, botMessageViews } = context.get('emulationSession');
    const result = polls.expirePoll(context.req.param(POLL_ID_PARAMETER));
    if (!result.expired) {
      return controlErrorResponse(
        context,
        result.reason === 'poll_not_found' ? 404 : 409,
        result.reason,
      );
    }
    return context.json({ poll: botMessageViews.viewPollForCreator(result.poll) });
  });

  return pollRoutes;
}
