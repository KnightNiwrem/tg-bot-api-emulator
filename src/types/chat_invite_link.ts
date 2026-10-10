/**
 * The start of every invite link, as TDLib's `LinkManager::get_dialog_invite_link` writes one: the
 * `t.me` URL, then `+` and the link's hash.
 */
export const INVITE_LINK_PREFIX = 'https://t.me/+';

/**
 * The most characters of an invite link's name, which TDLib's `MAX_INVITE_LINK_TITLE_LENGTH`
 * keeps as Telegram's servers limit it.
 */
export const MAX_INVITE_LINK_NAME_LENGTH = 32;

/**
 * The greatest member limit of an invite link, which TDLib's `createChatInviteLink` documents as
 * 0-99999 and the Bot API as 1-99999.
 */
export const MAX_INVITE_LINK_MEMBER_LIMIT = 99_999;

/** How many characters a link's hash has, as long as the hashes of Telegram's links. */
const INVITE_LINK_HASH_LENGTH = 16;

/** The characters of `base64url`, which TDLib's `is_base64url_characters` accepts in a hash. */
const BASE64URL_CHARACTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/**
 * The settings of an invite link that its creator chooses when it creates the link, and replaces
 * as a whole when it edits the link.
 */
export interface ChatInviteLinkSettings {
  /** A name only administrators see; omitted for none. */
  readonly name?: string;
  /** When the link stops working; omitted for a link that works until it is revoked. */
  readonly expiresAtUnixSeconds?: number;
  /**
   * How many users that joined through the link may be members of the chat at once; omitted for
   * no limit. A member that leaves frees its place.
   */
  readonly memberLimit?: number;
  /** Whether using the link sends a join request for administrators to approve, never joining. */
  readonly createsJoinRequest: boolean;
}

/**
 * An invite link of a supergroup. Its creator stays its owner, and only it edits or revokes the
 * link. A link stays usable until its expiry date arrives, which happens only when a test makes it
 * arrive, or until it is revoked. Subscription links are not supported.
 *
 * Each administrator has at most one primary link of a chat that is not revoked: replacing it
 * revokes the previous one. A primary link has no name, expiry date or member limit, never
 * creates join requests, and cannot be edited. Every other link is an additional link.
 */
export interface ChatInviteLink extends ChatInviteLinkSettings {
  /** The link as Telegram shows it to its creator: `INVITE_LINK_PREFIX` and the link's hash. */
  readonly url: string;
  readonly chatId: number;
  /** The administrator that created the link, who alone sees the whole link in updates. */
  readonly creatorId: number;
  readonly createdAtUnixSeconds: number;
  /** Whether the link is its creator's primary link of the chat rather than an additional one. */
  readonly isPrimary: boolean;
  /**
   * Whether a test made the link's current expiry date arrive, which ends its use until an edit
   * gives the link another expiry date or none.
   */
  readonly hasExpired: boolean;
  /** Whether the link's creator revoked it, which ends its use for good. */
  readonly isRevoked: boolean;
}

/** Creates a random hash for a new invite link, as long as the hashes of Telegram's links. */
export function createInviteLinkHash(): string {
  return [...crypto.getRandomValues(new Uint8Array(INVITE_LINK_HASH_LENGTH))]
    .map((byte) => BASE64URL_CHARACTERS[byte % BASE64URL_CHARACTERS.length])
    .join('');
}

/**
 * Whether a text has the form of the hash of an invite link the emulator creates:
 * `INVITE_LINK_HASH_LENGTH` characters from the alphabet `createInviteLinkHash` draws from.
 */
export function isInviteLinkHash(text: string): boolean {
  return text.length === INVITE_LINK_HASH_LENGTH &&
    [...text].every((character) => BASE64URL_CHARACTERS.includes(character));
}

/** The hash that identifies an invite link, after `INVITE_LINK_PREFIX`. */
function getInviteLinkHash(link: ChatInviteLink): string {
  return link.url.slice(INVITE_LINK_PREFIX.length);
}

/**
 * The invite link as a user other than its creator sees it: as the Bot API documents, "the second
 * part of the link will be replaced", which TDLib's `DialogInviteLink::is_valid_invite_link`
 * expects as a link truncated with `...`. The emulator keeps the first half of the hash.
 */
export function hideInviteLinkHash(link: ChatInviteLink): string {
  const hash = getInviteLinkHash(link);
  return `${INVITE_LINK_PREFIX}${hash.slice(0, Math.ceil(hash.length / 2))}...`;
}
