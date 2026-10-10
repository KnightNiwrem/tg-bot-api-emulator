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

/**
 * The most characters of a username of the syntax TDLib's `is_valid_username` admits, whose
 * characters `TELEGRAM_USERNAME_PATTERN` describes.
 *
 * Telegram's further rules for choosing a new username, such as its minimum of 5 characters, the
 * `bot` ending of a bot's username, and reserved prefixes, are not checked: older usernames, such
 * as `@gif`'s, break them and still name real chats.
 */
export const MAX_TELEGRAM_USERNAME_LENGTH = 32;

/**
 * An ASCII letter, then ASCII letters and digits, each of which may follow a single underscore, so
 * that an underscore is never last nor doubled.
 */
export const TELEGRAM_USERNAME_PATTERN = /^[A-Za-z](?:_?[A-Za-z0-9])*$/;
