import { Hono } from 'hono';

import { INVALID_REQUEST_REASON } from '../../../../control_contracts/control_errors.ts';
import {
  listServerErrorResponsesContract,
  queueServerErrorResponsesContract,
} from '../../../../control_contracts/queued_bot_api_answers.ts';
import type { QueuedServerErrorResponses } from '../../../types/bot_server_error.ts';
import { registerControlOperation } from '../../control_operation_route.ts';
import type { SessionRouteContextTypes } from '../session_route_context_types.ts';
import { readQueuedAnswerMethodName } from './queued_answer_method.ts';

/**
 * Routes that let a test make a bot's next Bot API calls fail with a server error before they run,
 * and list the answers still queued, served within the path template `mountPath`, such as
 * `/sessions/{sessionId}/bots`. These are emulator fault injection controls, not Telegram
 * behavior.
 */
export function createServerErrorResponseRoutes(
  mountPath: string,
): Hono<SessionRouteContextTypes> {
  const serverErrorResponseRoutes = new Hono<SessionRouteContextTypes>();

  registerControlOperation(
    serverErrorResponseRoutes,
    mountPath,
    queueServerErrorResponsesContract,
    ({ params: { botId }, body }, context) => {
      const method = readQueuedAnswerMethodName(body.method);
      if (!method.valid) {
        return { status: 400, body: { reason: INVALID_REQUEST_REASON, issues: [method.issue] } };
      }
      const result = context.get('emulationSession').botServerErrors.queueServerErrorResponses(
        botId,
        {
          ...(method.methodName === undefined ? {} : { methodName: method.methodName }),
          errorCode: body.error_code,
          remainingCount: body.count,
        },
      );
      return result.queued
        ? { status: 201, body: presentServerErrorResponses(result.responses) }
        : { status: 404, body: { reason: result.reason } };
    },
  );

  registerControlOperation(
    serverErrorResponseRoutes,
    mountPath,
    listServerErrorResponsesContract,
    ({ params: { botId } }, context) => {
      const result = context.get('emulationSession').botServerErrors.listServerErrorResponses(
        botId,
      );
      return result.found
        ? {
          status: 200,
          body: { server_error_responses: result.responses.map(presentServerErrorResponses) },
        }
        : { status: 404, body: { reason: result.reason } };
    },
  );

  return serverErrorResponseRoutes;
}

function presentServerErrorResponses(
  { methodName, errorCode, remainingCount }: QueuedServerErrorResponses,
) {
  return {
    ...(methodName === undefined ? {} : { method: methodName }),
    error_code: errorCode,
    remaining_count: remainingCount,
  };
}
