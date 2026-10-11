/**
 * Facts the client shares with the emulator. The client keeps its own copies, so that it does not
 * depend on the emulator's source; `server_definitions_test.ts` checks that they agree.
 */
import type { BotActivityKind } from './types.ts';

export const MIN_TELEGRAM_USER_ID = 1;
export const MAX_TELEGRAM_USER_ID = 0xff_ffff_ffff;

/** Supergroups and channels share one range of chat IDs, which Bot API marks with a `-100` prefix. */
export const MIN_SUPERGROUP_OR_CHANNEL_ID = -1_997_852_516_352;
export const MAX_SUPERGROUP_OR_CHANNEL_ID = -1_000_000_000_001;

/** Every kind of entry the bot activity log records. */
export const BOT_ACTIVITY_KINDS = [
  'bot_api_call',
  'update_delivered',
  'update_confirmed',
  'webhook_attempt_failed',
] as const satisfies readonly BotActivityKind[];

export const HTTP_STATUS_OK = 200;
export const HTTP_STATUS_CREATED = 201;
