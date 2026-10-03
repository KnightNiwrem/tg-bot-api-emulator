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

/** The Bot API's documented limit on an administrator's custom title. */
export const MAX_CUSTOM_TITLE_LENGTH = 16;

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

/** A supergroup administrator's standing. */
export interface AdministratorMembership {
  readonly status: 'administrator';
  readonly rights: SupergroupAdministratorRights;
  /**
   * The owner or administrator that last set the administrator's rights, as Telegram records it
   * in `channelParticipantAdmin.promoted_by`. It decides who may edit the administrator, as
   * `canEditSupergroupAdministrator` tells.
   */
  readonly promotedById: number;
  readonly customTitle?: string;
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
 * having promoted every administrator. The chain follows each administrator's `promotedById`,
 * which is all Telegram records of a promotion, through current administrators only: once a
 * promoter in it is no longer an administrator, only the owner stands above the administrators
 * it promoted.
 */
export function isAdministratorPromotedBy(
  readMembership: SupergroupMembershipReader,
  ancestorId: number,
  administrator: AdministratorMembership,
): boolean {
  const ancestor = readMembership(ancestorId);
  if (ancestor?.status === 'owner') {
    return true;
  }
  if (ancestor?.status !== 'administrator') {
    return false;
  }
  const visitedPromoterIds = new Set<number>();
  let promoterId = administrator.promotedById;
  while (promoterId !== ancestorId) {
    if (visitedPromoterIds.has(promoterId)) {
      throw new Error(`Administrators were promoted in a cycle through user ${promoterId}`);
    }
    visitedPromoterIds.add(promoterId);
    const promoter = readMembership(promoterId);
    if (promoter?.status !== 'administrator') {
      return false;
    }
    promoterId = promoter.promotedById;
  }
  return true;
}

/**
 * Whether a member may change an administrator's rights or demote it, which the Bot API shows as
 * `can_be_edited`: as TDLib's `promote_channel_participant` requires, the member holds
 * `can_promote_members`, which the owner holds, and, as the Bot API documents that right, it
 * promoted the administrator, directly or indirectly, as `isAdministratorPromotedBy` decides. No
 * administrator may edit itself.
 */
export function canEditSupergroupAdministrator(
  readMembership: SupergroupMembershipReader,
  editorId: number,
  administrator: AdministratorMembership,
): boolean {
  return holdsSupergroupAdministratorRight(readMembership(editorId), 'can_promote_members') &&
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
        first.rights.size === second.rights.size &&
        [...first.rights].every((right) => second.rights.has(right));
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
