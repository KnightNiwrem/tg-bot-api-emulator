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
 * new states and answers by the poll, and membership changes by chat for the bot's own and by user
 * for other members'. A queue's updates
 * are delivered one at a time, in order, while different queues are delivered at once.
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
  return `chat_member:${update.chat_member.new_chat_member.user.id}`;
}
