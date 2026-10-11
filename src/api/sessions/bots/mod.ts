import { Hono } from 'hono';
import { basePath } from 'hono/route';

import { createBotContract } from '../../../../control_contracts/bots.ts';
import { INVALID_REQUEST_REASON } from '../../../../control_contracts/control_errors.ts';
import {
  listRateLimitResponsesContract,
  queueRateLimitResponsesContract,
} from '../../../../control_contracts/queued_bot_api_answers.ts';
import type { QueuedRateLimitResponses } from '../../../types/bot_rate_limit.ts';
import type { VirtualBotProfile } from '../../../types/virtual_bot.ts';
import { registerControlOperation } from '../../control_operation_route.ts';
import type { SessionRouteContextTypes } from '../session_route_context_types.ts';
import { readQueuedAnswerMethodName } from './queued_answer_method.ts';
import { createServerErrorResponseRoutes } from './server_error_responses.ts';
import { createWebhookDeliveryRoutes } from './webhook_delivery.ts';

/** Where the bot routes are mounted within the server, as a contract path template. */
const BOT_COLLECTION_MOUNT_PATH = '/sessions/{sessionId}/bots';

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

  registerControlOperation(
    botRoutes,
    BOT_COLLECTION_MOUNT_PATH,
    queueRateLimitResponsesContract,
    ({ params: { botId }, body }, context) => {
      const method = readQueuedAnswerMethodName(body.method);
      if (!method.valid) {
        return { status: 400, body: { reason: INVALID_REQUEST_REASON, issues: [method.issue] } };
      }
      const result = context.get('emulationSession').botRateLimits.queueRateLimitResponses(botId, {
        ...(method.methodName === undefined ? {} : { methodName: method.methodName }),
        retryAfterSeconds: body.retry_after,
        remainingCount: body.count,
      });
      return result.queued
        ? { status: 201, body: presentRateLimitResponses(result.responses) }
        : { status: 404, body: { reason: result.reason } };
    },
  );

  registerControlOperation(
    botRoutes,
    BOT_COLLECTION_MOUNT_PATH,
    listRateLimitResponsesContract,
    ({ params: { botId } }, context) => {
      const result = context.get('emulationSession').botRateLimits.listRateLimitResponses(botId);
      return result.found
        ? {
          status: 200,
          body: { rate_limit_responses: result.responses.map(presentRateLimitResponses) },
        }
        : { status: 404, body: { reason: result.reason } };
    },
  );

  botRoutes.route('/', createServerErrorResponseRoutes(BOT_COLLECTION_MOUNT_PATH));
  botRoutes.route('/', createWebhookDeliveryRoutes(BOT_COLLECTION_MOUNT_PATH));

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
