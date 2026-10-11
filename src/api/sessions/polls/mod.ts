import { Hono } from 'hono';

import { INVALID_REQUEST_REASON } from '../../contracts/control_errors.ts';
import { expirePollContract } from '../../contracts/polls.ts';
import { isInt64DecimalText } from '../../../types/telegram_int64.ts';
import { registerControlOperation } from '../../control_operation_route.ts';
import { presentPoll } from '../poll_presentation.ts';
import type { SessionRouteContextTypes } from '../session_route_context_types.ts';

/** Where the poll routes are mounted within the server, as a contract path template. */
const POLL_COLLECTION_MOUNT_PATH = '/sessions/{sessionId}/polls';

/**
 * Routes that control polls' time, which the emulator does not let pass by itself: a test makes a
 * poll's closing time arrive when it chooses.
 */
export function createPollRoutes(): Hono<SessionRouteContextTypes> {
  const pollRoutes = new Hono<SessionRouteContextTypes>();

  registerControlOperation(
    pollRoutes,
    POLL_COLLECTION_MOUNT_PATH,
    expirePollContract,
    ({ params: { pollId } }, context) => {
      // The contract states the ID's form and length; its range is a rule JSON Schema cannot state.
      if (!isInt64DecimalText(pollId)) {
        return {
          status: 400,
          body: {
            reason: INVALID_REQUEST_REASON,
            issues: [{
              source: 'path',
              path: ['pollId'],
              code: 'invalid_value',
              message: 'A poll ID is at most the largest signed 64-bit integer',
            }],
          },
        };
      }
      const { polls, botMessageViews } = context.get('emulationSession');
      const result = polls.expirePoll(pollId);
      if (result.expired) {
        return {
          status: 200,
          body: { poll: presentPoll(botMessageViews.viewPollForCreator(result.poll)) },
        };
      }
      return result.reason === 'poll_not_found'
        ? { status: 404, body: { reason: result.reason } }
        : { status: 409, body: { reason: result.reason } };
    },
  );

  return pollRoutes;
}
