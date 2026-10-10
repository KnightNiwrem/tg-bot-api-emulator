import { Hono } from 'hono';
import { z } from 'zod';

import {
  QUEUEABLE_SERVER_ERROR_CODES,
  type QueuedServerErrorResponses,
} from '../../../types/bot_server_error.ts';
import {
  controlErrorResponse,
  invalidControlRequestResponse,
} from '../../control_error_response.ts';
import { readJsonRequestBody } from '../json_request_body.ts';
import type { SessionRouteContextTypes } from '../session_route_context_types.ts';
import {
  BOT_ID_PARAMETER,
  BOT_NOT_FOUND_REASON,
  botIdPathParameterSchema,
} from './bot_id_path_parameter.ts';
import { readQueuedAnswerMethodName } from './queued_answer_method.ts';

const SERVER_ERROR_RESPONSES_PATH = `/:${BOT_ID_PARAMETER}/server-error-responses` as const;

const queueServerErrorResponsesRequestSchema = z.strictObject({
  /** The method whose calls fail, by any name Telegram accepts; omitted for every method. */
  method: z.string().optional(),
  error_code: z.literal(QUEUEABLE_SERVER_ERROR_CODES),
  count: z.int().min(1).default(1),
});

/**
 * Routes that let a test make a bot's next Bot API calls fail with a server error before they run,
 * and list the answers still queued. These are emulator fault injection controls, not Telegram
 * behavior.
 */
export function createServerErrorResponseRoutes(): Hono<SessionRouteContextTypes> {
  const serverErrorResponseRoutes = new Hono<SessionRouteContextTypes>();

  serverErrorResponseRoutes.post(SERVER_ERROR_RESPONSES_PATH, async (context) => {
    const botId = botIdPathParameterSchema.safeParse(context.req.param(BOT_ID_PARAMETER));
    if (!botId.success) {
      return controlErrorResponse(context, 404, BOT_NOT_FOUND_REASON);
    }
    const requestBodyReading = await readJsonRequestBody(
      context.req,
      queueServerErrorResponsesRequestSchema,
    );
    if (!requestBodyReading.valid) {
      return invalidControlRequestResponse(context, requestBodyReading.issues);
    }
    const requestBody = requestBodyReading.value;
    const methodName = readQueuedAnswerMethodName(requestBody.method);
    if (!methodName.valid) {
      return invalidControlRequestResponse(context, methodName.issues);
    }

    const result = context.get('emulationSession').botServerErrors.queueServerErrorResponses(
      botId.data,
      {
        ...(methodName.value === undefined ? {} : { methodName: methodName.value }),
        errorCode: requestBody.error_code,
        remainingCount: requestBody.count,
      },
    );
    return result.queued
      ? context.json(presentServerErrorResponses(result.responses), 201)
      : controlErrorResponse(context, 404, result.reason);
  });

  serverErrorResponseRoutes.get(SERVER_ERROR_RESPONSES_PATH, (context) => {
    const botId = botIdPathParameterSchema.safeParse(context.req.param(BOT_ID_PARAMETER));
    if (!botId.success) {
      return controlErrorResponse(context, 404, BOT_NOT_FOUND_REASON);
    }
    const result = context.get('emulationSession').botServerErrors.listServerErrorResponses(
      botId.data,
    );
    return result.found
      ? context.json({ server_error_responses: result.responses.map(presentServerErrorResponses) })
      : controlErrorResponse(context, 404, result.reason);
  });

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
