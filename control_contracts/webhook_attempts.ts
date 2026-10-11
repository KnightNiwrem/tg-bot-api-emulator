/** Wire facts of the attempts to deliver updates to a bot's webhook. */
import { z } from 'zod';

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
    error_message: z.string(),
  }),
  /**
   * The webhook could not be reached (`connection_failed`), or did not answer completely before
   * the attempt's deadline arrived (`timed_out`).
   */
  z.strictObject({
    reason: z.enum(['connection_failed', 'timed_out']),
    error_message: z.string(),
  }),
  /** The connection closed before the whole response arrived. */
  z.strictObject({ reason: z.literal('response_interrupted') }),
]);

/** Identifies an attempt to deliver an update to a webhook among every attempt of its session. */
export const webhookAttemptIdSchema = z.int().min(1);
