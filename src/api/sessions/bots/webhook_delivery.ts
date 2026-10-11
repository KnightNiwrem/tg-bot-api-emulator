import { Hono } from 'hono';

import {
  expireWebhookAttemptContract,
  getWebhookDeliveryContract,
  listWebhookAttemptsContract,
  releaseWebhookRetryContract,
  setWebhookDeliveryContract,
} from '../../../../control_contracts/webhook_attempts.ts';
import { registerControlOperation } from '../../control_operation_route.ts';
import type { SessionRouteContextTypes } from '../session_route_context_types.ts';
import { presentWebhookAttempt } from '../webhook_attempt_presentation.ts';

/**
 * Routes that let a test decide when a bot's webhook delivery attempts time out and when their
 * retries are sent, and inspect each attempt, served within the path template `mountPath`, such as
 * `/sessions/{sessionId}/bots`. These are emulator controls, not Telegram behavior.
 */
export function createWebhookDeliveryRoutes(mountPath: string): Hono<SessionRouteContextTypes> {
  const webhookDeliveryRoutes = new Hono<SessionRouteContextTypes>();

  registerControlOperation(
    webhookDeliveryRoutes,
    mountPath,
    getWebhookDeliveryContract,
    ({ params: { botId } }, context) => {
      const result = context.get('emulationSession').webhookAttempts.getScheduling(botId);
      return result.found
        ? { status: 200, body: { scheduling: result.scheduling } }
        : { status: 404, body: { reason: result.reason } };
    },
  );

  registerControlOperation(
    webhookDeliveryRoutes,
    mountPath,
    setWebhookDeliveryContract,
    ({ params: { botId }, body }, context) => {
      const result = context.get('emulationSession').webhookAttempts.setScheduling(
        botId,
        body.scheduling,
      );
      return result.found
        ? { status: 200, body: { scheduling: result.scheduling } }
        : { status: 404, body: { reason: result.reason } };
    },
  );

  registerControlOperation(
    webhookDeliveryRoutes,
    mountPath,
    listWebhookAttemptsContract,
    ({ params: { botId } }, context) => {
      const result = context.get('emulationSession').webhookAttempts.listAttempts(botId);
      return result.found
        ? { status: 200, body: { webhook_attempts: result.attempts.map(presentWebhookAttempt) } }
        : { status: 404, body: { reason: result.reason } };
    },
  );

  registerControlOperation(
    webhookDeliveryRoutes,
    mountPath,
    releaseWebhookRetryContract,
    ({ params: { botId, webhookAttemptId } }, context) => {
      const result = context.get('emulationSession').webhookAttempts.releaseRetry(
        botId,
        webhookAttemptId,
      );
      if (result.released) {
        return { status: 200, body: presentWebhookAttempt(result.attempt) };
      }
      return result.reason === 'retry_not_waiting'
        ? { status: 409, body: { reason: result.reason } }
        : { status: 404, body: { reason: result.reason } };
    },
  );

  registerControlOperation(
    webhookDeliveryRoutes,
    mountPath,
    expireWebhookAttemptContract,
    async ({ params: { botId, webhookAttemptId } }, context) => {
      const result = await context.get('emulationSession').webhookAttempts.expireAttempt(
        botId,
        webhookAttemptId,
      );
      if (result.expired) {
        return { status: 200, body: presentWebhookAttempt(result.attempt) };
      }
      return result.reason === 'attempt_not_in_flight'
        ? { status: 409, body: { reason: result.reason } }
        : { status: 404, body: { reason: result.reason } };
    },
  );

  return webhookDeliveryRoutes;
}
