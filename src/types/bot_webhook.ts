import type { BotApiUpdate } from './bot_api.ts';

/** The longest `secret_token` Telegram accepts. */
export const MAX_WEBHOOK_SECRET_TOKEN_LENGTH = 256;

/** The characters of a `secret_token`, which TDLib's `is_base64url_characters` allows. */
const WEBHOOK_SECRET_TOKEN_PATTERN = /^[A-Za-z0-9_-]*$/;

/** Telegram reads a webhook URL without a scheme as an HTTPS URL. */
const DEFAULT_WEBHOOK_URL_SCHEME = 'https://';
const WEBHOOK_URL_SCHEME_PATTERN = /^[^:/?#]*:\/\//;
const WEBHOOK_URL_PROTOCOLS: readonly string[] = ['http:', 'https:'];

/** Where and how a bot's updates are delivered while its webhook is set. */
export interface BotWebhook {
  /** The URL as the bot specified it, which `getWebhookInfo` reports unchanged. */
  readonly url: string;
  /** Sent in the `X-Telegram-Bot-Api-Secret-Token` header; empty sends no header. */
  readonly secretToken: string;
  /** How many updates, each of a different queue, are delivered at once. */
  readonly maxConnections: number;
}

/** The latest failure to deliver an update to a webhook, which `getWebhookInfo` reports. */
export interface WebhookDeliveryError {
  readonly dateUnixSeconds: number;
  readonly message: string;
}

/**
 * Who ends a bot's webhook delivery attempts and retry waits. With `automatic` scheduling the
 * emulator does, by its own timing: an attempt fails once its timeout passes, and a failed update
 * is sent again once its retry delay passes. With `manual` scheduling only a test does, by expiring
 * attempts and releasing retries, so that a test reaches each state without waiting.
 */
export const WEBHOOK_SCHEDULINGS = ['automatic', 'manual'] as const;

export type WebhookScheduling = typeof WEBHOOK_SCHEDULINGS[number];

/**
 * Why an attempt to deliver an update to a webhook failed, with Telegram's description of the
 * failure, which `getWebhookInfo` reports.
 */
export type WebhookAttemptFailure =
  | {
    /** The webhook answered with a status other than 2xx. */
    readonly reason: 'http_error';
    readonly statusCode: number;
    readonly errorMessage: string;
  }
  | {
    /** The webhook could not be reached, or did not answer completely before the deadline. */
    readonly reason: 'connection_failed' | 'timed_out';
    readonly errorMessage: string;
  }
  | {
    /** The connection closed before the whole response arrived, which Telegram does not describe. */
    readonly reason: 'response_interrupted';
  };

/**
 * How the wait before an update is sent again stands: `waiting` until the delay passes or a test
 * releases the retry, then `released`; `cancelled` when delivery stopped during the wait, because
 * the webhook was replaced or deleted or the session ended.
 */
export type WebhookRetryStatus = 'waiting' | 'released' | 'cancelled';

/** The wait that a failed attempt schedules before its update is sent again. */
export interface WebhookRetry {
  /** The wait, in seconds, that `automatic` scheduling observes; `manual` scheduling ignores it. */
  readonly delaySeconds: number;
  readonly status: WebhookRetryStatus;
}

interface WebhookAttemptIdentity {
  /** Identifies the attempt among every attempt of the session; the first is 1. */
  readonly id: number;
  readonly botId: number;
  readonly updateId: number;
  /** The scheduling the attempt and its retry follow: the bot's when the attempt began. */
  readonly scheduling: WebhookScheduling;
}

/**
 * One request that delivers an update to a bot's webhook, and its outcome. An update is attempted
 * until its webhook accepts it, each attempt after the previous one's retry.
 */
export type WebhookAttempt =
  | WebhookAttemptIdentity & {
    /**
     * `in_flight` while the request runs, `accepted` once the webhook accepted the update, or
     * `cancelled` when delivery stopped before an outcome, which leaves the update pending.
     */
    readonly status: 'in_flight' | 'accepted' | 'cancelled';
  }
  | WebhookAttemptIdentity & {
    readonly status: 'failed';
    readonly failure: WebhookAttemptFailure;
    readonly retry: WebhookRetry;
  };

/**
 * Reads a webhook URL as TDLib's `parse_url` does: `http` and `https` URLs, with a missing scheme
 * meaning `https`. Returns `undefined` for any other text.
 *
 * Unlike Telegram, which delivers only to HTTPS URLs on ports 80, 88, 443, and 8443, the emulator
 * accepts any port and plain HTTP, so that tests can deliver to a bot on their own machine.
 */
export function parseWebhookUrl(url: string): URL | undefined {
  const absoluteUrl = WEBHOOK_URL_SCHEME_PATTERN.test(url)
    ? url
    : `${DEFAULT_WEBHOOK_URL_SCHEME}${url}`;
  const parsedUrl = URL.parse(absoluteUrl);
  return parsedUrl !== null && WEBHOOK_URL_PROTOCOLS.includes(parsedUrl.protocol)
    ? parsedUrl
    : undefined;
}

export function hasOnlyWebhookSecretTokenCharacters(secretToken: string): boolean {
  return WEBHOOK_SECRET_TOKEN_PATTERN.test(secretToken);
}

/**
 * Names the queue of a bot's webhook updates that an update joins, as the official Bot API
 * server's `Client::add_update` calls choose its webhook queue: messages and their edits by chat,
 * inline queries, chosen inline results, and callback queries by the user who sent them, a poll's
 * new states and answers by the poll, membership changes by chat for the bot's own and by user
 * for other members', join requests by their requester, and reaction changes by chat. A queue's
 * updates are delivered one at a time, in order, while different queues are delivered at once.
 */
export function getWebhookUpdateQueueKey(update: BotApiUpdate): string {
  if ('message' in update) {
    return `chat:${update.message.chat.id}`;
  }
  if ('edited_message' in update) {
    return `chat:${update.edited_message.chat.id}`;
  }
  if ('inline_query' in update) {
    return `inline_query:${update.inline_query.from.id}`;
  }
  if ('chosen_inline_result' in update) {
    return `chosen_inline_result:${update.chosen_inline_result.from.id}`;
  }
  if ('callback_query' in update) {
    return `callback_query:${update.callback_query.from.id}`;
  }
  if ('poll' in update) {
    return `poll:${update.poll.id}`;
  }
  if ('poll_answer' in update) {
    return `poll:${update.poll_answer.poll_id}`;
  }
  if ('my_chat_member' in update) {
    return `my_chat_member:${update.my_chat_member.chat.id}`;
  }
  if ('chat_join_request' in update) {
    return `chat_join_request:${update.chat_join_request.from.id}`;
  }
  if ('message_reaction' in update) {
    return `message_reaction:${update.message_reaction.chat.id}`;
  }
  return `chat_member:${update.chat_member.new_chat_member.user.id}`;
}
