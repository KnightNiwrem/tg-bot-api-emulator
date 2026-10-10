export const MIN_TELEGRAM_USER_ID = 1;
export const MAX_TELEGRAM_USER_ID = 0xff_ffff_ffff;

/** Supergroups and channels share one range of chat IDs, which Bot API marks with a `-100` prefix. */
export const MIN_SUPERGROUP_OR_CHANNEL_ID = -1_997_852_516_352;
export const MAX_SUPERGROUP_OR_CHANNEL_ID = -1_000_000_000_001;

/**
 * Whether a Bot API `chat_id` identifies a user, whose private chat it addresses. Telegram's user
 * IDs are positive, and the IDs of groups and channels negative.
 */
export function isUserId(chatId: number): boolean {
  return chatId > 0;
}
