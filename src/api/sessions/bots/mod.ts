import { Hono } from 'hono';
import { basePath } from 'hono/route';
import { z } from 'zod';

import { createBotContract } from '../../../../control_contracts/bots.ts';
import type { QueuedRateLimitResponses } from '../../../types/bot_rate_limit.ts';
import type { VirtualBotProfile } from '../../../types/virtual_bot.ts';
import {
  controlErrorResponse,
  invalidControlRequestResponse,
} from '../../control_error_response.ts';
import { registerControlOperation } from '../../control_operation_route.ts';
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

/** Where the bot routes are mounted within the server, as a contract path template. */
const BOT_COLLECTION_MOUNT_PATH = '/sessions/{sessionId}/bots';

const queueRateLimitResponsesRequestSchema = z.strictObject({
  /** The method whose calls are limited, by any name Telegram accepts; omitted for every method. */
  method: z.string().optional(),
  retry_after: z.int().min(1),
  count: z.int().min(1).default(1),
});

export function createBotRoutes(): Hono<SessionRouteContextTypes> {
  const botRoutes = new Hono<SessionRouteContextTypes>();

  registerControlOperation(
    botRoutes,
    BOT_COLLECTION_MOUNT_PATH,
    createBotContract,
    ({ body }, context) => {
      const result = context.get('emulationSession').virtualUsers.createBot({
        first_name: body.first_name,
        username: body.username,
        can_read_all_group_messages: body.can_read_all_group_messages,
        supports_inline_queries: body.supports_inline_queries,
        receives_chosen_inline_results: body.receives_chosen_inline_results,
        requests_inline_location: body.requests_inline_location,
        enables_bot_to_bot_communication: body.enables_bot_to_bot_communication,
      });
      if (!result.created) {
        return result.reason === 'username_taken'
          ? { status: 409, body: { reason: result.reason } }
          : { status: 507, body: { reason: result.reason } };
      }
      return {
        status: 201,
        headers: { Location: `${basePath(context)}/${result.bot.profile.id}` },
        body: { token: result.bot.token, bot: presentBotProfile(result.bot.profile) },
      };
    },
  );

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

/** A bot's profile as the control API shows it, which is how `getMe` returns it. */
function presentBotProfile(profile: VirtualBotProfile) {
  return {
    id: profile.id,
    is_bot: profile.is_bot,
    first_name: profile.first_name,
    username: profile.username,
    can_join_groups: profile.can_join_groups,
    can_read_all_group_messages: profile.can_read_all_group_messages,
    ...(profile.supports_guest_queries === undefined
      ? {}
      : { supports_guest_queries: profile.supports_guest_queries }),
    supports_inline_queries: profile.supports_inline_queries,
    can_connect_to_business: profile.can_connect_to_business,
    has_main_web_app: profile.has_main_web_app,
    has_topics_enabled: profile.has_topics_enabled,
    allows_users_to_create_topics: profile.allows_users_to_create_topics,
    can_manage_bots: profile.can_manage_bots,
    supports_join_request_queries: profile.supports_join_request_queries,
  };
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
