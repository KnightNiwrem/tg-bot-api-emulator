/**
 * The deployment of the official Bot API server whose upload limits a session's bots meet:
 * `cloud` for the server Telegram hosts at `api.telegram.org`, and `local` for a self-hosted server
 * started with `--local`.
 *
 * The profile changes only upload limits. Every other behavior, such as `getFile`'s download limit
 * and the file sources a bot may name, stays that of the cloud server.
 */
export type UploadProfile = typeof UPLOAD_PROFILES[number];

export const UPLOAD_PROFILES = ['cloud', 'local'] as const;

/** The profile of a session created without one. */
export const DEFAULT_UPLOAD_PROFILE: UploadProfile = 'cloud';

/**
 * The largest file, in bytes, that a bot may upload with `multipart/form-data` under each profile,
 * whatever its kind; a photo must also meet TDLib's smaller photo limit. Telegram documents 50 MB
 * for its own server and 2000 MB for a local one without naming the unit. The emulator reads both
 * in binary megabytes, the unit of the photo and download limits that TDLib and the Bot API server
 * enforce in their source, where 2000 MB is also TDLib's 4000 upload parts of 512 KB each.
 */
export const MAX_BOT_UPLOAD_BYTES: Readonly<Record<UploadProfile, number>> = {
  cloud: 50 * 1024 * 1024,
  local: 2000 * 1024 * 1024,
};

/**
 * Whether a profile's upload limit refuses a file before TDLib checks it. `api.telegram.org`
 * refuses an oversized request before its Bot API server reads it, while Telegram enforces a local
 * server's limit after TDLib's own checks, such as its photo limit.
 */
export const IS_BOT_UPLOAD_LIMIT_CHECKED_BEFORE_TDLIB: Readonly<Record<UploadProfile, boolean>> = {
  cloud: true,
  local: false,
};

/** A file a bot uploaded is larger than its session's upload profile allows. */
export interface BotUploadTooBigFailure {
  readonly reason: 'bot_upload_too_big';
  readonly uploadProfile: UploadProfile;
  readonly fileSizeBytes: number;
  readonly maxFileSizeBytes: number;
}

/**
 * Checks the size of a file a bot uploads against its session's upload profile, returning the
 * failure for a file that is too big and `undefined` for one that fits.
 */
export function checkBotUploadSize(
  uploadProfile: UploadProfile,
  fileSizeBytes: number,
): BotUploadTooBigFailure | undefined {
  const maxFileSizeBytes = MAX_BOT_UPLOAD_BYTES[uploadProfile];
  return fileSizeBytes > maxFileSizeBytes
    ? { reason: 'bot_upload_too_big', uploadProfile, fileSizeBytes, maxFileSizeBytes }
    : undefined;
}
