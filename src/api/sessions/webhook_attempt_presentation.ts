import type { WebhookAttempt, WebhookAttemptFailure } from '../../types/bot_webhook.ts';

/** Presents an attempt to deliver an update to a webhook, as the emulation API shows it. */
export function presentWebhookAttempt(attempt: WebhookAttempt) {
  return {
    id: attempt.id,
    update_id: attempt.updateId,
    scheduling: attempt.scheduling,
    status: attempt.status,
    ...(attempt.status === 'failed'
      ? {
        failure: presentWebhookAttemptFailure(attempt.failure),
        retry: { delay_seconds: attempt.retry.delaySeconds, status: attempt.retry.status },
      }
      : {}),
  };
}

/** Presents why an attempt failed, with the description `getWebhookInfo` reports, if any. */
export function presentWebhookAttemptFailure(failure: WebhookAttemptFailure) {
  switch (failure.reason) {
    case 'http_error':
      return {
        reason: failure.reason,
        status_code: failure.statusCode,
        error_message: failure.errorMessage,
      };
    case 'connection_failed':
    case 'timed_out':
      return { reason: failure.reason, error_message: failure.errorMessage };
    case 'response_interrupted':
      return { reason: failure.reason };
    default: {
      const unhandledFailure: never = failure;
      throw new Error(`Unhandled webhook attempt failure: ${JSON.stringify(unhandledFailure)}`);
    }
  }
}
