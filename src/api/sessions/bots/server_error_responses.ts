import { Hono } from 'hono';
import { z } from 'zod';

import {
  QUEUEABLE_SERVER_ERROR_CODES,
  type QueuedServerErrorResponses,
} from '../../../types/bot_server_error.ts';
import { findBotApiMethod } from '../bot_api/method_catalogue.ts';
import { readJsonRequestBody } from '../json_request_body.ts';
import type { SessionRouteContextTypes } from '../session_route_context_types.ts';
import { BOT_ID_PARAMETER, botIdPathParameterSchema } from './bot_id_path_parameter.ts';

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
      return context.body(null, 404);
    }
    const requestBody = await readJsonRequestBody(
      context.req,
      queueServerErrorResponsesRequestSchema,
    );
    if (requestBody === undefined) {
      return context.body(null, 400);
    }
    const { method: methodName, error_code: errorCode, count } = requestBody;
    const method = methodName === undefined ? undefined : findBotApiMethod(methodName);
    if (methodName !== undefined && method === undefined) {
      return context.body(null, 400);
    }

    const result = context.get('emulationSession').botServerErrors.queueServerErrorResponses(
      botId.data,
      {
        ...(method === undefined ? {} : { methodName: method.name }),
        errorCode,
        remainingCount: count,
      },
    );
    return result.queued
      ? context.json(presentServerErrorResponses(result.responses), 201)
      : context.body(null, 404);
  });

  serverErrorResponseRoutes.get(SERVER_ERROR_RESPONSES_PATH, (context) => {
    const botId = botIdPathParameterSchema.safeParse(context.req.param(BOT_ID_PARAMETER));
    if (!botId.success) {
      return context.body(null, 404);
    }
    const result = context.get('emulationSession').botServerErrors.listServerErrorResponses(
      botId.data,
    );
    return result.found
      ? context.json({ server_error_responses: result.responses.map(presentServerErrorResponses) })
      : context.body(null, 404);
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
