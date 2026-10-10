/**
 * The kinds of entry a session's bot-activity log records: a bot's call, an update handed to a bot,
 * an update a bot confirmed, and a failed attempt to deliver an update to a webhook.
 */
export const BOT_ACTIVITY_KINDS = [
  'bot_api_call',
  'update_delivered',
  'update_confirmed',
  'webhook_attempt_failed',
] as const;
