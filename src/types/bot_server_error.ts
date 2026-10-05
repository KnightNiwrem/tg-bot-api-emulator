/**
 * The HTTP statuses of the server error answers a test can queue: `500 Internal Server Error`, as
 * the official Bot API server answers a call that failed on its side, and
 * `503 Service Unavailable`, as a server that cannot take calls for a while answers.
 */
export const QUEUEABLE_SERVER_ERROR_CODES = [500, 503] as const;

export type QueueableServerErrorCode = (typeof QUEUEABLE_SERVER_ERROR_CODES)[number];

/**
 * Server error answers that a test queues for a bot's next Bot API calls, so that the bot's
 * handling of failed calls, such as retrying them, can be tested deterministically. They inject
 * faults; they do not reproduce when Telegram fails calls.
 */
export interface QueuedServerErrorResponses {
  /**
   * The Bot API method whose calls receive the answers, by its current name; omitted for calls of
   * any method.
   */
  readonly methodName?: string;
  /** The HTTP status and `error_code` of every answer. */
  readonly errorCode: QueueableServerErrorCode;
  /** How many of the next matching calls still receive an answer; always positive. */
  readonly remainingCount: number;
}
