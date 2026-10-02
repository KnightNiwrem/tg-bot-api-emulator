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
