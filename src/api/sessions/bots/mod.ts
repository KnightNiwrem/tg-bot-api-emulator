import { Hono } from 'hono';
import { basePath } from 'hono/route';
import { z } from 'zod';

import type { QueuedRateLimitResponses } from '../../../types/bot_rate_limit.ts';
import {
  controlErrorResponse,
  invalidControlRequestResponse,
} from '../../control_error_response.ts';
import { telegramUsernameSchema } from '../accounts/request_fields.ts';
import { readJsonRequestBody } from '../json_request_body.ts';
import type { SessionRouteContextTypes } from '../session_route_context_types.ts';
import {
  BOT_ID_PARAMETER,
  BOT_NOT_FOUND_REASON,
  botIdPathParameterSchema,
} from './bot_id_path_parameter.ts';
import { readQueuedAnswerMethodName } from './queued_answer_method.ts';
import { createServerErrorResponseRoutes } from './server_error_responses.ts';
import { createWebhookDeliveryRoutes } from './webhook_delivery.ts';

const RATE_LIMIT_RESPONSES_PATH = `/:${BOT_ID_PARAMETER}/rate-limit-responses` as const;

const createBotRequestSchema = z.strictObject({
  first_name: z.string().min(1),
  username: telegramUsernameSchema,
  /** Turns off privacy mode, so that the bot receives every message of its groups. */
  can_read_all_group_messages: z.boolean().optional(),
  /** Turns on inline mode, so that accounts send the bot inline queries. */
  supports_inline_queries: z.boolean().optional(),
  /** Turns on inline feedback, so that the bot learns which inline query results are sent. */
  receives_chosen_inline_results: z.boolean().optional(),
  /** Asks accounts to share their location with the bot's inline queries. */
  requests_inline_location: z.boolean().optional(),
  /**
   * Turns on Bot-to-Bot Communication Mode, so that the bot's supergroup messages reach the bots
   * they address, and the messages other bots address to it reach it.
   */
  enables_bot_to_bot_communication: z.boolean().optional(),
});

const queueRateLimitResponsesRequestSchema = z.strictObject({
  /** The method whose calls are limited, by any name Telegram accepts; omitted for every method. */
  method: z.string().optional(),
  retry_after: z.int().min(1),
  count: z.int().min(1).default(1),
});

export function createBotRoutes(): Hono<SessionRouteContextTypes> {
  const botRoutes = new Hono<SessionRouteContextTypes>();

  botRoutes.post('/', async (context) => {
    const requestBodyReading = await readJsonRequestBody(context.req, createBotRequestSchema);
    if (!requestBodyReading.valid) {
      return invalidControlRequestResponse(context, requestBodyReading.issues);
    }
    const requestBody = requestBodyReading.value;

    const result = context.get('emulationSession').virtualUsers.createBot(requestBody);
    if (!result.created) {
      return controlErrorResponse(
        context,
        result.reason === 'username_taken' ? 409 : 507,
        result.reason,
      );
    }

    const botPath = `${basePath(context)}/${result.bot.profile.id}`;
    return context.json(
      {
        token: result.bot.token,
        bot: result.bot.profile,
      },
      201,
      { Location: botPath },
    );
  });

  botRoutes.post(RATE_LIMIT_RESPONSES_PATH, async (context) => {
    const botId = botIdPathParameterSchema.safeParse(context.req.param(BOT_ID_PARAMETER));
    if (!botId.success) {
      return controlErrorResponse(context, 404, BOT_NOT_FOUND_REASON);
    }
    const requestBodyReading = await readJsonRequestBody(
      context.req,
      queueRateLimitResponsesRequestSchema,
    );
    if (!requestBodyReading.valid) {
      return invalidControlRequestResponse(context, requestBodyReading.issues);
    }
    const requestBody = requestBodyReading.value;
    const methodName = readQueuedAnswerMethodName(requestBody.method);
    if (!methodName.valid) {
      return invalidControlRequestResponse(context, methodName.issues);
    }

    const result = context.get('emulationSession').botRateLimits.queueRateLimitResponses(
      botId.data,
      {
        ...(methodName.value === undefined ? {} : { methodName: methodName.value }),
        retryAfterSeconds: requestBody.retry_after,
        remainingCount: requestBody.count,
      },
    );
    return result.queued
      ? context.json(presentRateLimitResponses(result.responses), 201)
      : controlErrorResponse(context, 404, result.reason);
  });

  botRoutes.get(RATE_LIMIT_RESPONSES_PATH, (context) => {
    const botId = botIdPathParameterSchema.safeParse(context.req.param(BOT_ID_PARAMETER));
    if (!botId.success) {
      return controlErrorResponse(context, 404, BOT_NOT_FOUND_REASON);
    }
    const result = context.get('emulationSession').botRateLimits.listRateLimitResponses(
      botId.data,
    );
    return result.found
      ? context.json({ rate_limit_responses: result.responses.map(presentRateLimitResponses) })
      : controlErrorResponse(context, 404, result.reason);
  });

  botRoutes.route('/', createServerErrorResponseRoutes());
  botRoutes.route('/', createWebhookDeliveryRoutes());

  return botRoutes;
}

function presentRateLimitResponses(
  { methodName, retryAfterSeconds, remainingCount }: QueuedRateLimitResponses,
) {
  return {
    ...(methodName === undefined ? {} : { method: methodName }),
    retry_after: retryAfterSeconds,
    remaining_count: remainingCount,
  };
}
