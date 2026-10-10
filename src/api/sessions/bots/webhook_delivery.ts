import { Hono } from 'hono';
import { z } from 'zod';

import { WEBHOOK_SCHEDULINGS } from '../../../types/bot_webhook.ts';
import {
  controlErrorResponse,
  invalidControlRequestResponse,
} from '../../control_error_response.ts';
import { readJsonRequestBody } from '../json_request_body.ts';
import type { SessionRouteContextTypes } from '../session_route_context_types.ts';
import { presentWebhookAttempt } from '../webhook_attempt_presentation.ts';
import {
  BOT_ID_PARAMETER,
  BOT_NOT_FOUND_REASON,
  botIdPathParameterSchema,
} from './bot_id_path_parameter.ts';

const WEBHOOK_ATTEMPT_ID_PARAMETER = 'webhookAttemptId';
const WEBHOOK_DELIVERY_PATH = `/:${BOT_ID_PARAMETER}/webhook-delivery` as const;
const WEBHOOK_ATTEMPTS_PATH = `/:${BOT_ID_PARAMETER}/webhook-attempts` as const;
const WEBHOOK_ATTEMPT_PATH = `${WEBHOOK_ATTEMPTS_PATH}/:${WEBHOOK_ATTEMPT_ID_PARAMETER}` as const;
const WEBHOOK_RETRY_RELEASE_PATH = `${WEBHOOK_ATTEMPT_PATH}/retry-release` as const;
const WEBHOOK_ATTEMPT_EXPIRY_PATH = `${WEBHOOK_ATTEMPT_PATH}/expiry` as const;

/** The reason for an attempt the bot does not have, as the service names it. */
const WEBHOOK_ATTEMPT_NOT_FOUND_REASON = 'attempt_not_found';

const webhookAttemptIdPathParameterSchema = z.coerce.number().pipe(
  z.int().min(1).max(Number.MAX_SAFE_INTEGER),
);

const webhookDeliveryRequestSchema = z.strictObject({
  scheduling: z.enum(WEBHOOK_SCHEDULINGS),
});

/**
 * Routes that let a test decide when a bot's webhook delivery attempts time out and when their
 * retries are sent, and inspect each attempt. These are emulator controls, not Telegram behavior.
 */
export function createWebhookDeliveryRoutes(): Hono<SessionRouteContextTypes> {
  const webhookDeliveryRoutes = new Hono<SessionRouteContextTypes>();

  webhookDeliveryRoutes.get(WEBHOOK_DELIVERY_PATH, (context) => {
    const botId = botIdPathParameterSchema.safeParse(context.req.param(BOT_ID_PARAMETER));
    if (!botId.success) {
      return controlErrorResponse(context, 404, BOT_NOT_FOUND_REASON);
    }
    const result = context.get('emulationSession').webhookAttempts.getScheduling(botId.data);
    return result.found
      ? context.json({ scheduling: result.scheduling })
      : controlErrorResponse(context, 404, result.reason);
  });

  webhookDeliveryRoutes.put(WEBHOOK_DELIVERY_PATH, async (context) => {
    const botId = botIdPathParameterSchema.safeParse(context.req.param(BOT_ID_PARAMETER));
    if (!botId.success) {
      return controlErrorResponse(context, 404, BOT_NOT_FOUND_REASON);
    }
    const requestBodyReading = await readJsonRequestBody(context.req, webhookDeliveryRequestSchema);
    if (!requestBodyReading.valid) {
      return invalidControlRequestResponse(context, requestBodyReading.issues);
    }
    const requestBody = requestBodyReading.value;
    const result = context.get('emulationSession').webhookAttempts.setScheduling(
      botId.data,
      requestBody.scheduling,
    );
    return result.found
      ? context.json({ scheduling: result.scheduling })
      : controlErrorResponse(context, 404, result.reason);
  });

  webhookDeliveryRoutes.get(WEBHOOK_ATTEMPTS_PATH, (context) => {
    const botId = botIdPathParameterSchema.safeParse(context.req.param(BOT_ID_PARAMETER));
    if (!botId.success) {
      return controlErrorResponse(context, 404, BOT_NOT_FOUND_REASON);
    }
    const result = context.get('emulationSession').webhookAttempts.listAttempts(botId.data);
    return result.found
      ? context.json({ webhook_attempts: result.attempts.map(presentWebhookAttempt) })
      : controlErrorResponse(context, 404, result.reason);
  });

  webhookDeliveryRoutes.post(WEBHOOK_RETRY_RELEASE_PATH, (context) => {
    const botId = botIdPathParameterSchema.safeParse(context.req.param(BOT_ID_PARAMETER));
    const attemptId = webhookAttemptIdPathParameterSchema.safeParse(
      context.req.param(WEBHOOK_ATTEMPT_ID_PARAMETER),
    );
    if (!botId.success) {
      return controlErrorResponse(context, 404, BOT_NOT_FOUND_REASON);
    }
    if (!attemptId.success) {
      return controlErrorResponse(context, 404, WEBHOOK_ATTEMPT_NOT_FOUND_REASON);
    }
    const result = context.get('emulationSession').webhookAttempts.releaseRetry(
      botId.data,
      attemptId.data,
    );
    if (!result.released) {
      return controlErrorResponse(
        context,
        result.reason === 'retry_not_waiting' ? 409 : 404,
        result.reason,
      );
    }
    return context.json(presentWebhookAttempt(result.attempt));
  });

  webhookDeliveryRoutes.post(WEBHOOK_ATTEMPT_EXPIRY_PATH, async (context) => {
    const botId = botIdPathParameterSchema.safeParse(context.req.param(BOT_ID_PARAMETER));
    const attemptId = webhookAttemptIdPathParameterSchema.safeParse(
      context.req.param(WEBHOOK_ATTEMPT_ID_PARAMETER),
    );
    if (!botId.success) {
      return controlErrorResponse(context, 404, BOT_NOT_FOUND_REASON);
    }
    if (!attemptId.success) {
      return controlErrorResponse(context, 404, WEBHOOK_ATTEMPT_NOT_FOUND_REASON);
    }
    const result = await context.get('emulationSession').webhookAttempts.expireAttempt(
      botId.data,
      attemptId.data,
    );
    if (!result.expired) {
      return controlErrorResponse(
        context,
        result.reason === 'attempt_not_in_flight' ? 409 : 404,
        result.reason,
      );
    }
    return context.json(presentWebhookAttempt(result.attempt));
  });

  return webhookDeliveryRoutes;
}
