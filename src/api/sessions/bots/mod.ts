import { Hono } from 'hono';
import { basePath } from 'hono/route';
import { z } from 'zod';

import type { QueuedRateLimitResponses } from '../../../types/bot_rate_limit.ts';
import { isTelegramUsername } from '../../../types/telegram_identity.ts';
import { findBotApiMethod } from '../bot_api/method_catalogue.ts';
import { readJsonRequestBody } from '../json_request_body.ts';
import type { SessionRouteContextTypes } from '../session_route_context_types.ts';
import { BOT_ID_PARAMETER, botIdPathParameterSchema } from './bot_id_path_parameter.ts';
import { createServerErrorResponseRoutes } from './server_error_responses.ts';
import { createWebhookDeliveryRoutes } from './webhook_delivery.ts';

const RATE_LIMIT_RESPONSES_PATH = `/:${BOT_ID_PARAMETER}/rate-limit-responses` as const;

const createBotRequestSchema = z.strictObject({
  first_name: z.string().min(1),
  username: z.string().refine(isTelegramUsername),
  /** Turns off privacy mode, so that the bot receives every message of its groups. */
  can_read_all_group_messages: z.boolean().optional(),
  /** Turns on inline mode, so that accounts send the bot inline queries. */
  supports_inline_queries: z.boolean().optional(),
  /** Turns on inline feedback, so that the bot learns which inline query results are sent. */
  receives_chosen_inline_results: z.boolean().optional(),
  /** Asks accounts to share their location with the bot's inline queries. */
  requests_inline_location: z.boolean().optional(),
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
    const requestBody = await readJsonRequestBody(context.req, createBotRequestSchema);
    if (requestBody === undefined) {
      return context.body(null, 400);
    }

    const result = context.get('emulationSession').virtualUsers.createBot(requestBody);
    if (!result.created) {
      return context.body(null, result.reason === 'username_taken' ? 409 : 507);
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
      return context.body(null, 404);
    }
    const requestBody = await readJsonRequestBody(
      context.req,
      queueRateLimitResponsesRequestSchema,
    );
    if (requestBody === undefined) {
      return context.body(null, 400);
    }
    const { method: methodName, retry_after: retryAfterSeconds, count } = requestBody;
    const method = methodName === undefined ? undefined : findBotApiMethod(methodName);
    if (methodName !== undefined && method === undefined) {
      return context.body(null, 400);
    }

    const result = context.get('emulationSession').botRateLimits.queueRateLimitResponses(
      botId.data,
      {
        ...(method === undefined ? {} : { methodName: method.name }),
        retryAfterSeconds,
        remainingCount: count,
      },
    );
    return result.queued
      ? context.json(presentRateLimitResponses(result.responses), 201)
      : context.body(null, 404);
  });

  botRoutes.get(RATE_LIMIT_RESPONSES_PATH, (context) => {
    const botId = botIdPathParameterSchema.safeParse(context.req.param(BOT_ID_PARAMETER));
    if (!botId.success) {
      return context.body(null, 404);
    }
    const result = context.get('emulationSession').botRateLimits.listRateLimitResponses(
      botId.data,
    );
    return result.found
      ? context.json({ rate_limit_responses: result.responses.map(presentRateLimitResponses) })
      : context.body(null, 404);
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
