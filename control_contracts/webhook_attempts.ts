/**
 * The contracts of the attempts to deliver updates to a bot's webhook: who ends them and their
 * retry waits, the attempts themselves, and the test controls that end an attempt or a retry wait.
 * These are emulator controls; they do not reproduce Telegram's timing.
 */
import { z } from 'zod';

import { botNotFoundSchema, botPathSchema } from './bots.ts';
import { controlRefusalSchema, controlValidationErrorSchema } from './control_errors.ts';
import { defineControlOperation } from './operation_contract.ts';

/**
 * Who ends a bot's webhook delivery attempts and retry waits: the emulator by its own timing
 * (`automatic`, the default), or only the test, by expiring attempts and releasing retries
 * (`manual`).
 */
export const WEBHOOK_SCHEDULINGS = ['automatic', 'manual'] as const;

const webhookSchedulingSchema = z.enum(WEBHOOK_SCHEDULINGS);

/** How a bot's webhook updates are delivered. */
const webhookDeliverySchema = z.strictObject({
  /** The scheduling of the attempts that begin from now on. */
  scheduling: webhookSchedulingSchema,
});

/**
 * Why an attempt to deliver an update to a webhook failed. `error_message` is the description
 * `getWebhookInfo` reports as `last_error_message`; Telegram describes no `response_interrupted`
 * failure.
 */
export const webhookAttemptFailureSchema = z.discriminatedUnion('reason', [
  /** The webhook answered with a status other than 2xx. */
  z.strictObject({
    reason: z.literal('http_error'),
    status_code: z.int().min(100).max(599),
    error_message: z.string().min(1),
  }),
  /**
   * The webhook could not be reached (`connection_failed`), or did not answer completely before
   * the attempt's deadline arrived (`timed_out`).
   */
  z.strictObject({
    reason: z.enum(['connection_failed', 'timed_out']),
    error_message: z.string().min(1),
  }),
  /** The connection closed before the whole response arrived. */
  z.strictObject({ reason: z.literal('response_interrupted') }),
]);

/** Identifies an attempt to deliver an update to a webhook among every attempt of its session. */
export const webhookAttemptIdSchema = z.int().min(1);

/** The fields every attempt has, whatever its outcome. */
const webhookAttemptIdentityShape = {
  /** Identifies the attempt among every attempt of the session; the first is 1. */
  id: webhookAttemptIdSchema,
  update_id: z.int(),
  /** The scheduling the attempt and its retry follow: the bot's when the attempt began. */
  scheduling: webhookSchedulingSchema,
};

/** The wait that a failed attempt schedules before its update is sent again. */
const webhookRetrySchema = z.strictObject({
  /** The wait, in seconds, that `automatic` scheduling observes; `manual` scheduling ignores it. */
  delay_seconds: z.int().min(0),
  /**
   * `waiting` until the delay passes or the test releases the retry, then `released`; `cancelled`
   * when the webhook was replaced or deleted, or the session ended, during the wait.
   */
  status: z.enum(['waiting', 'released', 'cancelled']),
});

/** One request that delivers an update to a bot's webhook, and its outcome. */
export const webhookAttemptSchema = z.discriminatedUnion('status', [
  z.strictObject({
    ...webhookAttemptIdentityShape,
    /**
     * `in_flight` while the request runs, `accepted` once the webhook accepted the update, or
     * `cancelled` when delivery stopped before an outcome, which leaves the update pending.
     */
    status: z.enum(['in_flight', 'accepted', 'cancelled']),
  }),
  z.strictObject({
    ...webhookAttemptIdentityShape,
    status: z.literal('failed'),
    failure: webhookAttemptFailureSchema,
    retry: webhookRetrySchema,
  }),
]);

/** The path parameters of one attempt of a bot, which a control applies to. */
const webhookAttemptPathSchema = botPathSchema.extend({ webhookAttemptId: webhookAttemptIdSchema });

/** The refusal of a control of an attempt the bot does not have, or of a missing bot or session. */
const webhookAttemptNotFoundSchema = controlRefusalSchema([
  'attempt_not_found',
  'bot_not_found',
  'session_not_found',
]);

export const getWebhookDeliveryContract = defineControlOperation({
  operationId: 'getWebhookDelivery',
  method: 'GET',
  path: '/sessions/{sessionId}/bots/{botId}/webhook-delivery',
  params: botPathSchema,
  success: { status: 200, body: { kind: 'json', schema: webhookDeliverySchema } },
  refusals: { 400: controlValidationErrorSchema, 404: botNotFoundSchema },
});

/**
 * Chooses who ends the bot's webhook delivery attempts and retry waits from now on. An attempt and
 * its retry keep the scheduling they began with.
 */
export const setWebhookDeliveryContract = defineControlOperation({
  operationId: 'setWebhookDelivery',
  method: 'PUT',
  path: '/sessions/{sessionId}/bots/{botId}/webhook-delivery',
  params: botPathSchema,
  body: { required: true, schema: webhookDeliverySchema },
  success: { status: 200, body: { kind: 'json', schema: webhookDeliverySchema } },
  refusals: { 400: controlValidationErrorSchema, 404: botNotFoundSchema },
});

/** Lists every attempt to deliver an update to the bot's webhook, earliest first. */
export const listWebhookAttemptsContract = defineControlOperation({
  operationId: 'listWebhookAttempts',
  method: 'GET',
  path: '/sessions/{sessionId}/bots/{botId}/webhook-attempts',
  params: botPathSchema,
  success: {
    status: 200,
    body: {
      kind: 'json',
      schema: z.strictObject({ webhook_attempts: z.array(webhookAttemptSchema) }),
    },
  },
  refusals: { 400: controlValidationErrorSchema, 404: botNotFoundSchema },
});

/**
 * Ends a failed attempt's retry wait at once, so that its update is sent again. A retry is
 * released once.
 */
export const releaseWebhookRetryContract = defineControlOperation({
  operationId: 'releaseWebhookRetry',
  method: 'POST',
  path: '/sessions/{sessionId}/bots/{botId}/webhook-attempts/{webhookAttemptId}/retry-release',
  params: webhookAttemptPathSchema,
  success: { status: 200, body: { kind: 'json', schema: webhookAttemptSchema } },
  refusals: {
    400: controlValidationErrorSchema,
    404: webhookAttemptNotFoundSchema,
    409: controlRefusalSchema(['retry_not_waiting']),
  },
});

/**
 * Makes an attempt's deadline arrive, as its timeout passing does, and answers once its outcome is
 * decided.
 */
export const expireWebhookAttemptContract = defineControlOperation({
  operationId: 'expireWebhookAttempt',
  method: 'POST',
  path: '/sessions/{sessionId}/bots/{botId}/webhook-attempts/{webhookAttemptId}/expiry',
  params: webhookAttemptPathSchema,
  success: { status: 200, body: { kind: 'json', schema: webhookAttemptSchema } },
  refusals: {
    400: controlValidationErrorSchema,
    404: webhookAttemptNotFoundSchema,
    409: controlRefusalSchema(['attempt_not_in_flight']),
  },
});
