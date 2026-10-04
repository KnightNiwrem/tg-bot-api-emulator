import {
  ALL_CHAT_PERMISSIONS,
  CHAT_PERMISSIONS,
  type ChatPermissions,
  isAdministratorRightPermission,
  isSameChatPermissions,
} from './chat_permissions.ts';
import type { SharedChat, Supergroup } from './virtual_chat.ts';

/**
 * The rights a supergroup's owner can grant an administrator, by the Bot API's names and in the
 * order the Bot API shows them. Anonymous administrators and the rights of channel administrators
 * are not supported.
 */
export const SUPERGROUP_ADMINISTRATOR_RIGHTS = [
  'can_manage_chat',
  'can_change_info',
  'can_delete_messages',
  'can_invite_users',
  'can_restrict_members',
  'can_pin_messages',
  'can_manage_topics',
  'can_promote_members',
  'can_manage_video_chats',
  'can_post_stories',
  'can_edit_stories',
  'can_delete_stories',
  'can_manage_tags',
  'can_send_welcome_messages',
] as const;

export type SupergroupAdministratorRight = typeof SUPERGROUP_ADMINISTRATOR_RIGHTS[number];

/** The rights a supergroup administrator holds, which always include `can_manage_chat`. */
export type SupergroupAdministratorRights = ReadonlySet<SupergroupAdministratorRight>;

/**
 * Collects the rights granted to an administrator. As TDLib does, any right includes
 * `can_manage_chat`, so granting no right grants none at all.
 */
export function grantSupergroupAdministratorRights(
  grantedRights: Iterable<SupergroupAdministratorRight>,
): SupergroupAdministratorRights {
  const rights = new Set(grantedRights);
  if (rights.size > 0) {
    rights.add('can_manage_chat');
  }
  return rights;
}

/** Whether two sets of administrator rights hold the same rights. */
export function isSameSupergroupAdministratorRights(
  first: SupergroupAdministratorRights,
  second: SupergroupAdministratorRights,
): boolean {
  return first.size === second.size && [...first].every((right) => second.has(right));
}

/**
 * The most characters of a custom title, counted by code point: the Bot API documents 0-16
 * characters, and TDLib keeps at most 16 of a title it receives.
 */
export const MAX_CUSTOM_TITLE_LENGTH = 16;

/** Why Telegram's servers refuse a custom title. */
export type CustomTitleViolation = 'too_long' | 'contains_emoji';

/**
 * Finds an emoji in a custom title. Telegram does not publish which characters its servers count
 * as emoji in a title, so this follows Telegram Desktop, the official client that keeps emoji out
 * of one: its `EditTagControl` strips every emoji of its emoji list with
 * `TextUtilities::RemoveEmoji`. That list holds every character with Unicode's `Emoji` property and
 * no other pictograph, so symbols such as ★, ⎈ and ♪ are accepted. The pattern matches:
 *
 * - a character with the `Emoji` property other than digits, `#` and `*`, which are emoji only as
 *   the base of a keycap, and ©, ® and ™;
 * - ©, ® and ™ followed by the emoji presentation selector U+FE0F, which Telegram Desktop requires
 *   of these three alone;
 * - the combining keycap U+20E3, which ends a keycap;
 * - an `Extended_Pictographic` code point that the runtime's Unicode data leaves unassigned, which
 *   Unicode reserves for emoji, so that emoji newer than the runtime are found too.
 *
 * Every other emoji sequence starts with a character the first alternative matches. A regional
 * indicator letter alone, which Telegram Desktop keeps as it lists only pairs of them as flags, is
 * refused too, so the emulator is stricter there.
 */
const EMOJI_PATTERN =
  /(?![0-9#*\xA9\xAE\u{2122}])\p{Emoji}|[\xA9\xAE\u{2122}]\u{FE0F}|\u{20E3}|(?=\p{Cn})\p{Extended_Pictographic}/u;

/**
 * Finds what Telegram's servers refuse in a custom title, which the Bot API documents as "0-16
 * characters, emoji are not allowed": more than `MAX_CUSTOM_TITLE_LENGTH` characters, or an emoji.
 * Returns `undefined` for a title they accept.
 */
export function findCustomTitleViolation(title: string): CustomTitleViolation | undefined {
  if ([...title].length > MAX_CUSTOM_TITLE_LENGTH) {
    return 'too_long';
  }
  return EMOJI_PATTERN.test(title) ? 'contains_emoji' : undefined;
}

/**
 * What a supergroup user may still do while restricted, as far as the supergroup's default
 * permissions allow it too. The restriction lasts while the user leaves and joins again, as
 * Telegram keeps it, until it is lifted, or the user is banned or promoted.
 */
export interface ChatMemberRestriction {
  /**
   * The permissions the user keeps, which never include every permission: TDLib's
   * `DialogParticipantStatus::Restricted` treats a user that keeps them all as unrestricted.
   */
  readonly permissions: ChatPermissions;
  /**
   * When the restriction ends; omitted for one that lasts until it is lifted. The emulator never
   * lifts a restriction on its own when this time passes.
   */
  readonly restrictedUntilUnixSeconds?: number;
}

/**
 * A restricted user's standing, by the Bot API's status name, whether it is a member or not, as
 * the Bot API's `ChatMemberRestricted.is_member` tells.
 */
export type RestrictedChatMemberStatus<IsMember extends boolean = boolean> =
  & { readonly status: 'restricted'; readonly isMember: IsMember }
  & ChatMemberRestriction;

/**
 * A supergroup administrator's standing. Its delegation link, `promotedById` together with
 * `promoterTenureId`, ties it to the tenure of the administrator that set its rights; it decides
 * who may edit the administrator, as `canEditSupergroupAdministrator` tells.
 */
export interface AdministratorMembership {
  readonly status: 'administrator';
  readonly rights: SupergroupAdministratorRights;
  /**
   * Identifies this administrator tenure: the time from the user's promotion until it stops being
   * an administrator. Changes of its rights or title keep it; a later promotion starts a new one.
   */
  readonly tenureId: AdministratorTenureId;
  /**
   * The owner or administrator that last set the administrator's rights, as Telegram records and
   * shows it as `promoted_by` in `channelParticipantAdmin`, even after that promoter's tenure ends.
   */
  readonly promotedById: number;
  /**
   * The tenure in which the promoter set the rights; omitted when the owner did, whose standing
   * never ends. The delegation link counts only while that tenure lasts.
   */
  readonly promoterTenureId?: AdministratorTenureId;
  readonly customTitle?: string;
}

/** Identifies one administrator tenure in a session, issued in increasing order. */
export type AdministratorTenureId = number;

/** An administrator and its standing, as delegation decides whether someone may edit it. */
export interface SupergroupAdministrator {
  readonly userId: number;
  readonly membership: AdministratorMembership;
}

/**
 * A current member's standing in a shared chat. Only supergroups have administrators and
 * restricted members. The owner and administrators may carry a custom title that clients show
 * instead of their role; it is omitted for none.
 */
export type ChatMembership =
  | { readonly status: 'owner'; readonly customTitle?: string }
  | AdministratorMembership
  | { readonly status: 'member' }
  | RestrictedChatMemberStatus<true>;

/**
 * How a former member's membership ended, by the Bot API's status names: the member `left`, or it
 * was removed, which in a supergroup bans it as `kicked` until the ban is lifted. A restricted
 * member that leaves stays `restricted`, and so does a user restricted before it joins.
 */
export type FormerChatMemberStatus =
  | { readonly status: 'left' }
  | {
    readonly status: 'kicked';
    /**
     * When the ban ends; omitted for a ban that lasts until an administrator lifts it. The
     * emulator never lifts a ban on its own when this time passes.
     */
    readonly bannedUntilUnixSeconds?: number;
  }
  | RestrictedChatMemberStatus<false>;

/**
 * A user's standing in a shared chat, whether it is a member or not. A user that never joined the
 * chat has `left` it, unless it was banned or restricted before it could join.
 */
export type ChatMemberStatus = ChatMembership | FormerChatMemberStatus;

/** A user that left a chat, or never joined it. */
export const LEFT_CHAT_MEMBER_STATUS: FormerChatMemberStatus = { status: 'left' };

/**
 * The standing that restricting a user gives it, as TDLib's `DialogParticipantStatus::Restricted`
 * makes it: the user stays a member or not, and one that keeps every permission is not restricted,
 * so it is a member or has left.
 */
export function createRestrictedStatus(
  isMember: boolean,
  { permissions, restrictedUntilUnixSeconds }: ChatMemberRestriction,
): ChatMemberStatus {
  if (isSameChatPermissions(permissions, ALL_CHAT_PERMISSIONS)) {
    return isMember ? { status: 'member' } : LEFT_CHAT_MEMBER_STATUS;
  }
  return {
    status: 'restricted',
    isMember,
    permissions,
    ...(restrictedUntilUnixSeconds === undefined ? {} : { restrictedUntilUnixSeconds }),
  };
}

/** Whether a user's standing makes it a current member of the chat. */
export function isChatMember(status: ChatMemberStatus): status is ChatMembership {
  switch (status.status) {
    case 'owner':
    case 'administrator':
    case 'member':
      return true;
    case 'restricted':
      return status.isMember;
    case 'left':
    case 'kicked':
      return false;
    default: {
      const unhandledStatus: never = status;
      throw new Error(`Unhandled chat member status: ${JSON.stringify(unhandledStatus)}`);
    }
  }
}

/** Whether a member administers a chat: it owns the chat, or it was promoted. */
export function isChatAdministrator(membership: ChatMembership): boolean {
  return membership.status === 'owner' || membership.status === 'administrator';
}

/** Whether a supergroup member holds an administrator right; the owner holds every right. */
export function holdsSupergroupAdministratorRight(
  membership: ChatMembership | undefined,
  right: SupergroupAdministratorRight,
): boolean {
  switch (membership?.status) {
    case 'owner':
      return true;
    case 'administrator':
      return membership.rights.has(right);
    case 'member':
    case 'restricted':
    case undefined:
      return false;
    default: {
      const unhandledMembership: never = membership;
      throw new Error(`Unhandled chat membership: ${JSON.stringify(unhandledMembership)}`);
    }
  }
}

/** Finds the standing of a current member of one supergroup; `undefined` for a non-member. */
export type SupergroupMembershipReader = (userId: number) => ChatMembership | undefined;

/**
 * Whether an administrator was promoted by a member, directly or through administrators the
 * member promoted in turn, as the Bot API describes `can_promote_members`; the owner counts as
 * having promoted every administrator, and nobody counts as having promoted itself.
 *
 * The chain follows delegation links, each of which counts only while the tenure of the promoter
 * that made it lasts: once a promoter stops being an administrator, the administrators it promoted
 * are left to the owner, even if it is promoted again later. A promotion that starts a tenure thus
 * links to a tenure that started earlier, and a change of rights links to an editor the
 * administrator already descends from, so counting links never form a cycle. The walk still stops
 * at a user it met before, so that no state can make it fail.
 */
export function isAdministratorPromotedBy(
  readMembership: SupergroupMembershipReader,
  ancestorId: number,
  { userId: administratorId, membership: administrator }: SupergroupAdministrator,
): boolean {
  if (ancestorId === administratorId) {
    return false;
  }
  const ancestor = readMembership(ancestorId);
  if (ancestor?.status === 'owner') {
    return true;
  }
  if (ancestor?.status !== 'administrator') {
    return false;
  }
  const visitedUserIds = new Set([administratorId]);
  let link: AdministratorMembership = administrator;
  while (!visitedUserIds.has(link.promotedById)) {
    const promoter = readMembership(link.promotedById);
    if (promoter?.status !== 'administrator' || promoter.tenureId !== link.promoterTenureId) {
      return false;
    }
    if (link.promotedById === ancestorId) {
      return true;
    }
    visitedUserIds.add(link.promotedById);
    link = promoter;
  }
  return false;
}

/**
 * Whether a member may change an administrator's rights or demote it, which the Bot API shows as
 * `can_be_edited`: as TDLib's `promote_channel_participant` requires, the member holds
 * `can_promote_members`, which the owner holds, and, as the Bot API documents that right, it
 * promoted the administrator, directly or indirectly, as `isAdministratorPromotedBy` decides. No
 * member may edit itself.
 */
export function canEditSupergroupAdministrator(
  readMembership: SupergroupMembershipReader,
  editorId: number,
  administrator: SupergroupAdministrator,
): boolean {
  return editorId !== administrator.userId &&
    holdsSupergroupAdministratorRight(readMembership(editorId), 'can_promote_members') &&
    isAdministratorPromotedBy(readMembership, editorId, administrator);
}

/**
 * What a supergroup member may do, as TDLib's `DialogParticipantStatus::apply_restrictions` decides
 * from its standing and the supergroup's default permissions:
 *
 * - The owner may do everything.
 * - An administrator may send anything, and holds the permissions that are also administrator
 *   rights as far as it holds those rights; an administrator that is an account also holds them
 *   as far as the default permissions grant them.
 * - Any other member holds the default permissions, as far as its restriction, if any, lets it.
 *   As for administrators, the default permissions never grant a bot the permissions that are also
 *   administrator rights.
 */
export function getEffectiveChatPermissions(
  membership: ChatMembership,
  { defaultPermissions, isBot }: {
    readonly defaultPermissions: ChatPermissions;
    readonly isBot: boolean;
  },
): ChatPermissions {
  switch (membership.status) {
    case 'owner':
      return new Set(ALL_CHAT_PERMISSIONS);
    case 'administrator':
      return new Set(
        CHAT_PERMISSIONS.filter((permission) =>
          !isAdministratorRightPermission(permission) || membership.rights.has(permission) ||
          (!isBot && defaultPermissions.has(permission))
        ),
      );
    case 'member':
    case 'restricted':
      return new Set(
        CHAT_PERMISSIONS.filter((permission) =>
          defaultPermissions.has(permission) &&
          (membership.status === 'member' || membership.permissions.has(permission)) &&
          !(isBot && isAdministratorRightPermission(permission))
        ),
      );
    default: {
      const unhandledMembership: never = membership;
      throw new Error(`Unhandled chat membership: ${JSON.stringify(unhandledMembership)}`);
    }
  }
}

/**
 * Whether two standings in a chat are the same, rights, custom title, restriction and ban end
 * included. Who promoted an administrator is not compared: setting the rights an administrator
 * holds changes nothing, as TDLib's `set_channel_participant_status_impl` skips such a change.
 */
export function isSameChatMemberStatus(
  first: ChatMemberStatus,
  second: ChatMemberStatus,
): boolean {
  switch (first.status) {
    case 'owner':
      return second.status === 'owner' && first.customTitle === second.customTitle;
    case 'member':
    case 'left':
      return first.status === second.status;
    case 'administrator':
      return second.status === 'administrator' && first.customTitle === second.customTitle &&
        isSameSupergroupAdministratorRights(first.rights, second.rights);
    case 'kicked':
      return second.status === 'kicked' &&
        first.bannedUntilUnixSeconds === second.bannedUntilUnixSeconds;
    case 'restricted':
      return second.status === 'restricted' && first.isMember === second.isMember &&
        first.restrictedUntilUnixSeconds === second.restrictedUntilUnixSeconds &&
        isSameChatPermissions(first.permissions, second.permissions);
    default: {
      const unhandledStatus: never = first;
      throw new Error(`Unhandled chat member status: ${JSON.stringify(unhandledStatus)}`);
    }
  }
}

/** Why a bot cannot act in a supergroup it left, or was removed from and so banned from. */
export type FormerSupergroupMemberFailureReason = 'bot_not_a_member' | 'bot_kicked';

/**
 * Why a bot cannot act in a supergroup: one it never joined is unknown to it, as on Telegram,
 * whereas one it left or was removed from turns it away.
 */
export type SupergroupBotAccessFailureReason =
  | 'chat_not_found'
  | FormerSupergroupMemberFailureReason;

export interface SupergroupMembershipLookup {
  getSharedChat(chatId: number): SharedChat | undefined;
  getChatMembership(chatId: number, identityId: number): ChatMembership | undefined;
  getFormerMemberStatus(chatId: number, identityId: number): FormerChatMemberStatus | undefined;
}

/**
 * Checks that a bot is a member of a supergroup, which it needs to act there, and returns the
 * supergroup with the bot's membership, or why the bot cannot act there.
 */
export function resolveSupergroupBotMembership(
  memberships: SupergroupMembershipLookup,
  botId: number,
  chatId: number,
):
  | {
    readonly resolved: true;
    readonly supergroup: Supergroup;
    readonly membership: ChatMembership;
  }
  | { readonly resolved: false; readonly reason: SupergroupBotAccessFailureReason } {
  const supergroup = memberships.getSharedChat(chatId);
  if (supergroup?.kind !== 'supergroup') {
    return { resolved: false, reason: 'chat_not_found' };
  }
  const membership = memberships.getChatMembership(chatId, botId);
  return membership === undefined
    ? {
      resolved: false,
      reason: getSupergroupNonMemberFailureReason(
        memberships.getFormerMemberStatus(chatId, botId),
      ),
    }
    : { resolved: true, supergroup, membership };
}

/**
 * Why a bot that is not a member of a supergroup cannot act there, given how its membership ended:
 * as on Telegram, a supergroup it never joined is unknown to it, whereas one it left or was removed
 * from turns it away.
 */
export function getSupergroupNonMemberFailureReason(
  formerStatus: FormerChatMemberStatus | undefined,
): 'chat_not_found' | FormerSupergroupMemberFailureReason {
  switch (formerStatus?.status) {
    case undefined:
      return 'chat_not_found';
    case 'left':
    case 'restricted':
      return 'bot_not_a_member';
    case 'kicked':
      return 'bot_kicked';
    default: {
      const unhandledStatus: never = formerStatus;
      throw new Error(`Unhandled former member status: ${JSON.stringify(unhandledStatus)}`);
    }
  }
}
