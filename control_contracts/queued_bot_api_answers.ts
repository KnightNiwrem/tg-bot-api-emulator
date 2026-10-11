/**
 * The contracts of the answers a test queues for a bot's next Bot API calls, which take them
 * instead of running: `429 Too Many Requests` rate limit answers, and server error answers. These
 * are emulator fault injection controls, not Telegram behavior.
 */
import { z } from 'zod';

import { botNotFoundSchema, botPathSchema } from './bots.ts';
import { controlValidationErrorSchema } from './control_errors.ts';
import { defineControlOperation } from './operation_contract.ts';

/**
 * The HTTP statuses of the server error answers a test can queue: `500 Internal Server Error` and
 * `503 Service Unavailable`.
 */
export const QUEUEABLE_SERVER_ERROR_CODES = [500, 503] as const;

/** The HTTP status and `error_code` of every server error answer. */
const serverErrorCodeSchema = z.literal(QUEUEABLE_SERVER_ERROR_CODES);

/**
 * The method whose calls a request's answers apply to: an implemented Bot API method, by any name
 * Telegram accepts, which the server checks and reports as an `invalid_value` issue.
 */
const requestedMethodSchema = z.string();

/** How many of the bot's next matching calls receive an answer. */
const requestedCountSchema = z.int().min(1);

/** The method whose calls queued answers apply to, by its current name. */
const queuedMethodSchema = z.string().min(1);

/** How many of the bot's next matching calls still receive an answer. */
const remainingCountSchema = z.int().min(1);

/** `429 Too Many Requests` answers queued for a bot's next calls. */
const rateLimitResponsesSchema = z.strictObject({
  /** The method whose calls receive the answers, by its current name; omitted for every method. */
  method: queuedMethodSchema.optional(),
  /** The `retry_after`, in seconds, of every answer. */
  retry_after: z.int().min(1),
  /** How many of the bot's next matching calls still receive an answer. */
  remaining_count: remainingCountSchema,
});

/** Server error answers queued for a bot's next calls. */
const serverErrorResponsesSchema = z.strictObject({
  /** The method whose calls receive the answers, by its current name; omitted for every method. */
  method: queuedMethodSchema.optional(),
  /** The HTTP status and `error_code` of every answer. */
  error_code: serverErrorCodeSchema,
  /** How many of the bot's next matching calls still receive an answer. */
  remaining_count: remainingCountSchema,
});

/** A request whose bot is not the session's, or whose path or body breaks the contract. */
const queuedAnswerRefusals = {
  400: controlValidationErrorSchema,
  404: botNotFoundSchema,
};

export const queueRateLimitResponsesContract = defineControlOperation({
  operationId: 'queueRateLimitResponses',
  method: 'POST',
  path: '/sessions/{sessionId}/bots/{botId}/rate-limit-responses',
  params: botPathSchema,
  body: {
    required: true,
    schema: z.strictObject({
      /** An implemented Bot API method, by any name Telegram accepts; omit it for every method. */
      method: requestedMethodSchema.optional(),
      /** The `retry_after`, in seconds, of every answer; at least 1. */
      retry_after: z.int().min(1),
      /** How many of the bot's next matching calls receive an answer. Defaults to 1. */
      count: requestedCountSchema.default(1),
    }),
  },
  success: { status: 201, body: { kind: 'json', schema: rateLimitResponsesSchema } },
  refusals: queuedAnswerRefusals,
});

/** Lists the rate limit answers still queued for the bot, earliest first. */
export const listRateLimitResponsesContract = defineControlOperation({
  operationId: 'listRateLimitResponses',
  method: 'GET',
  path: '/sessions/{sessionId}/bots/{botId}/rate-limit-responses',
  params: botPathSchema,
  success: {
    status: 200,
    body: {
      kind: 'json',
      schema: z.strictObject({ rate_limit_responses: z.array(rateLimitResponsesSchema) }),
    },
  },
  refusals: queuedAnswerRefusals,
});

export const queueServerErrorResponsesContract = defineControlOperation({
  operationId: 'queueServerErrorResponses',
  method: 'POST',
  path: '/sessions/{sessionId}/bots/{botId}/server-error-responses',
  params: botPathSchema,
  body: {
    required: true,
    schema: z.strictObject({
      /** An implemented Bot API method, by any name Telegram accepts; omit it for every method. */
      method: requestedMethodSchema.optional(),
      /** The HTTP status and `error_code` of every answer. */
      error_code: serverErrorCodeSchema,
      /** How many of the bot's next matching calls receive an answer. Defaults to 1. */
      count: requestedCountSchema.default(1),
    }),
  },
  success: { status: 201, body: { kind: 'json', schema: serverErrorResponsesSchema } },
  refusals: queuedAnswerRefusals,
});

/** Lists the server error answers still queued for the bot, earliest first. */
export const listServerErrorResponsesContract = defineControlOperation({
  operationId: 'listServerErrorResponses',
  method: 'GET',
  path: '/sessions/{sessionId}/bots/{botId}/server-error-responses',
  params: botPathSchema,
  success: {
    status: 200,
    body: {
      kind: 'json',
      schema: z.strictObject({ server_error_responses: z.array(serverErrorResponsesSchema) }),
    },
  },
  refusals: queuedAnswerRefusals,
});
