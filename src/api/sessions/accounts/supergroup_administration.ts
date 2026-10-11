import { Hono } from 'hono';

import type {
  ControlOperationResponse,
  ControlOperationResult,
} from '../../contracts/operation_contract.ts';
import {
  changeSupergroupDescriptionContract,
  changeSupergroupTitleContract,
  demoteSupergroupMemberContract,
  getSupergroupAdministratorsContract,
  liftSupergroupMemberRestrictionContract,
  promoteSupergroupMemberContract,
  protectSupergroupContentContract,
  restrictSupergroupMemberContract,
  setSupergroupCustomTitleContract,
  setSupergroupDefaultPermissionsContract,
  unprotectSupergroupContentContract,
} from '../../contracts/supergroup_administration.ts';
import {
  grantSupergroupAdministratorRights,
  SUPERGROUP_ADMINISTRATOR_RIGHTS,
} from '../../../types/chat_membership.ts';
import { CHAT_PERMISSIONS, type ChatPermission } from '../../../types/chat_permissions.ts';
import type { EmulationSession } from '../../../types/emulation_session.ts';
import { registerControlOperation } from '../../control_operation_route.ts';
import type { SessionRouteContextTypes } from '../session_route_context_types.ts';

/** Where the account routes are mounted within the server, as a contract path template. */
const ACCOUNT_COLLECTION_MOUNT_PATH = '/sessions/{sessionId}/accounts';

type SupergroupAdministration = EmulationSession['sharedChatAdministration'];

/**
 * Routes through which an account administers a supergroup: its administrators and their rights and
 * custom titles, restrictions of users, its title, description and default permissions, and the
 * protection of its content.
 */
export function createSupergroupAdministrationRoutes(): Hono<SessionRouteContextTypes> {
  const accountRoutes = new Hono<SessionRouteContextTypes>();

  // A member inspects the owner and administrators, who promoted each, and whom it may edit.
  registerControlOperation(
    accountRoutes,
    ACCOUNT_COLLECTION_MOUNT_PATH,
    getSupergroupAdministratorsContract,
    ({ params: { accountId, chatId } }, context) => {
      const result = context.get('emulationSession').sharedChatAdministration
        .getAdministratorsForAccount({ observerAccountId: accountId, chatId });
      if (result.found) {
        return {
          status: 200,
          body: { administrators: presentAdministratorsForAccount(result.administrators) },
        };
      }
      switch (result.reason) {
        case 'account_not_found':
        case 'chat_not_found':
          return { status: 404, body: { reason: result.reason } };
        case 'not_a_member':
          return { status: 403, body: { reason: result.reason } };
        default: {
          const unhandledReason: never = result.reason;
          throw new Error(`Unhandled administrator inspection failure: ${unhandledReason}`);
        }
      }
    },
  );

  // The owner or an administrator that may promote makes a member an administrator, or changes
  // the rights of an administrator it may edit.
  registerControlOperation(
    accountRoutes,
    ACCOUNT_COLLECTION_MOUNT_PATH,
    promoteSupergroupMemberContract,
    ({ params: { accountId, chatId, userId }, body }, context) => {
      const result = context.get('emulationSession').sharedChatAdministration.promoteChatMember({
        actorAccountId: accountId,
        chatId,
        memberId: userId,
        rights: grantSupergroupAdministratorRights(
          SUPERGROUP_ADMINISTRATOR_RIGHTS.filter((right) => body[right]),
        ),
      });
      if (result.promoted) {
        return { status: 204 };
      }
      // An administrator without rights would be a member; DELETE demotes one instead.
      return result.reason === 'no_rights_granted'
        ? { status: 400, body: { reason: result.reason } }
        : refusePromotion(result.reason);
    },
  );

  // The owner or an administrator that may edit an administrator demotes it to a member;
  // demoting a member changes nothing.
  registerControlOperation(
    accountRoutes,
    ACCOUNT_COLLECTION_MOUNT_PATH,
    demoteSupergroupMemberContract,
    ({ params: { accountId, chatId, userId } }, context) => {
      const result = context.get('emulationSession').sharedChatAdministration.demoteChatMember({
        actorAccountId: accountId,
        chatId,
        memberId: userId,
      });
      return result.demoted ? { status: 204 } : refuseDemotion(result.reason);
    },
  );

  // The owner or an administrator that may restrict members restricts a user, member or not, or
  // changes its restriction.
  registerControlOperation(
    accountRoutes,
    ACCOUNT_COLLECTION_MOUNT_PATH,
    restrictSupergroupMemberContract,
    ({ params: { accountId, chatId, userId }, body }, context) => {
      const result = context.get('emulationSession').sharedChatAdministration
        .restrictChatMemberAsAccount({
          actorAccountId: accountId,
          chatId,
          memberId: userId,
          permissions: toGrantedPermissions(body.permissions),
          requestedRestrictionEndUnixSeconds: body.until_date,
        });
      return result.changed ? { status: 204 } : refuseRestriction(result.reason);
    },
  );

  // The owner or an administrator that may restrict members lifts a user's restriction; lifting
  // none changes nothing.
  registerControlOperation(
    accountRoutes,
    ACCOUNT_COLLECTION_MOUNT_PATH,
    liftSupergroupMemberRestrictionContract,
    ({ params: { accountId, chatId, userId } }, context) => {
      const result = context.get('emulationSession').sharedChatAdministration
        .liftRestrictionAsAccount({ actorAccountId: accountId, chatId, memberId: userId });
      return result.changed ? { status: 204 } : refuseRestriction(result.reason);
    },
  );

  // The owner sets its own custom title or an administrator's; an empty title removes it.
  registerControlOperation(
    accountRoutes,
    ACCOUNT_COLLECTION_MOUNT_PATH,
    setSupergroupCustomTitleContract,
    ({ params: { accountId, chatId, userId }, body }, context) => {
      const result = context.get('emulationSession').sharedChatAdministration.setCustomTitle({
        actorAccountId: accountId,
        chatId,
        memberId: userId,
        customTitle: body.custom_title,
      });
      if (result.set) {
        return { status: 204 };
      }
      switch (result.reason) {
        case 'actor_account_not_found':
        case 'chat_not_found':
        case 'member_not_found':
          return { status: 404, body: { reason: result.reason } };
        case 'actor_not_authorized':
          return { status: 403, body: { reason: result.reason } };
        case 'not_a_member':
        case 'not_an_administrator':
          return { status: 409, body: { reason: result.reason } };
        case 'text_encoding_invalid':
        case 'custom_title_too_long':
        case 'custom_title_contains_emoji':
          return { status: 400, body: { reason: result.reason } };
        default: {
          const unhandledReason: never = result.reason;
          throw new Error(`Unhandled custom title failure: ${unhandledReason}`);
        }
      }
    },
  );

  // A member changes the supergroup's title, which a service message records.
  registerControlOperation(
    accountRoutes,
    ACCOUNT_COLLECTION_MOUNT_PATH,
    changeSupergroupTitleContract,
    ({ params: { accountId, chatId }, body }, context) => {
      const result = context.get('emulationSession').sharedChatAdministration
        .changeSupergroupTitle({
          actor: { kind: 'account', accountId },
          chatId,
          title: body.title,
        });
      if (result.changed) {
        return { status: 204 };
      }
      switch (result.reason) {
        case 'text_encoding_invalid':
        case 'title_empty':
          return { status: 400, body: { reason: result.reason } };
        default:
          return refuseSupergroupChange(result.reason);
      }
    },
  );

  // A member changes the supergroup's description, which no service message records.
  registerControlOperation(
    accountRoutes,
    ACCOUNT_COLLECTION_MOUNT_PATH,
    changeSupergroupDescriptionContract,
    ({ params: { accountId, chatId }, body }, context) => {
      const result = context.get('emulationSession').sharedChatAdministration
        .changeSupergroupDescription({
          actor: { kind: 'account', accountId },
          chatId,
          description: body.description,
        });
      if (result.changed) {
        return { status: 204 };
      }
      switch (result.reason) {
        case 'text_encoding_invalid':
          return { status: 400, body: { reason: result.reason } };
        // Telegram refuses a description the supergroup already has.
        case 'description_not_modified':
          return { status: 409, body: { reason: result.reason } };
        default:
          return refuseSupergroupChange(result.reason);
      }
    },
  );

  // A member with the right to restrict members changes what members may do by default.
  registerControlOperation(
    accountRoutes,
    ACCOUNT_COLLECTION_MOUNT_PATH,
    setSupergroupDefaultPermissionsContract,
    ({ params: { accountId, chatId }, body }, context) => {
      const result = context.get('emulationSession').sharedChatAdministration
        .changeDefaultPermissions({
          actor: { kind: 'account', accountId },
          chatId,
          permissions: toGrantedPermissions(body.permissions),
        });
      return result.changed ? { status: 204 } : refuseSupergroupChange(result.reason);
    },
  );

  // The owner protects all content of the supergroup from forwarding and saving, or lifts that.
  for (
    const [contract, hasProtectedContent] of [
      [protectSupergroupContentContract, true],
      [unprotectSupergroupContentContract, false],
    ] as const
  ) {
    registerControlOperation(
      accountRoutes,
      ACCOUNT_COLLECTION_MOUNT_PATH,
      contract,
      ({ params: { accountId, chatId } }, context) => {
        const result = context.get('emulationSession').sharedChatAdministration
          .setContentProtection({ actorAccountId: accountId, chatId, hasProtectedContent });
        if (result.set) {
          return { status: 204 };
        }
        return result.reason === 'actor_not_authorized'
          ? { status: 403, body: { reason: result.reason } }
          : { status: 404, body: { reason: result.reason } };
      },
    );
  }

  return accountRoutes;
}

/** The permissions a request grants: those it sets to `true`; no permission implies another. */
function toGrantedPermissions(
  permissions: Readonly<Partial<Record<ChatPermission, boolean>>>,
): ReadonlySet<ChatPermission> {
  return new Set(CHAT_PERMISSIONS.filter((permission) => permissions[permission] === true));
}

/**
 * A missing account, supergroup, or user is not found; an account that is not a member, lacks the
 * right, would grant a right it lacks, or acts on itself or on an administrator it did not promote
 * is forbidden; the owner, and a user that is not a member, conflict with a change of role. A
 * promotion that grants no right is answered beside the route.
 */
function refusePromotion(
  reason: Exclude<
    Extract<
      ReturnType<SupergroupAdministration['promoteChatMember']>,
      { readonly promoted: false }
    >['reason'],
    'no_rights_granted'
  >,
): ControlOperationResponse<typeof promoteSupergroupMemberContract> {
  switch (reason) {
    case 'actor_account_not_found':
    case 'chat_not_found':
    case 'member_not_found':
      return { status: 404, body: { reason } };
    case 'actor_not_a_member':
    case 'cannot_manage_self':
    case 'not_enough_rights':
    case 'administrator_not_promoted_by_actor':
    case 'rights_not_held':
      return { status: 403, body: { reason } };
    case 'not_a_member':
    case 'member_is_owner':
      return { status: 409, body: { reason } };
    default: {
      const unhandledReason: never = reason;
      throw new Error(`Unhandled promotion failure: ${unhandledReason}`);
    }
  }
}

/** As `refusePromotion` answers, for a demotion, which grants no right. */
function refuseDemotion(
  reason: Extract<
    ReturnType<SupergroupAdministration['demoteChatMember']>,
    { readonly demoted: false }
  >['reason'],
): ControlOperationResponse<typeof demoteSupergroupMemberContract> {
  switch (reason) {
    case 'actor_account_not_found':
    case 'chat_not_found':
    case 'member_not_found':
      return { status: 404, body: { reason } };
    case 'actor_not_a_member':
    case 'cannot_manage_self':
    case 'not_enough_rights':
    case 'administrator_not_promoted_by_actor':
      return { status: 403, body: { reason } };
    case 'not_a_member':
    case 'member_is_owner':
      return { status: 409, body: { reason } };
    default: {
      const unhandledReason: never = reason;
      throw new Error(`Unhandled demotion failure: ${unhandledReason}`);
    }
  }
}

/**
 * A missing account, supergroup, or user is not found; an account that is not a member, lacks the
 * right, or acts on itself or on an administrator it did not promote is forbidden; the owner
 * conflicts with a restriction.
 */
function refuseRestriction(
  reason: Extract<
    ReturnType<SupergroupAdministration['restrictChatMemberAsAccount']>,
    { readonly changed: false }
  >['reason'],
): ControlOperationResponse<typeof restrictSupergroupMemberContract> {
  switch (reason) {
    case 'actor_account_not_found':
    case 'chat_not_found':
    case 'member_not_found':
      return { status: 404, body: { reason } };
    case 'actor_not_a_member':
    case 'cannot_manage_self':
    case 'not_enough_rights':
    case 'not_enough_rights_to_promote':
    case 'administrator_not_promoted_by_actor':
      return { status: 403, body: { reason } };
    case 'member_is_owner':
      return { status: 409, body: { reason } };
    default: {
      const unhandledReason: never = reason;
      throw new Error(`Unhandled restriction failure: ${unhandledReason}`);
    }
  }
}

/**
 * A missing account or supergroup is not found, and an account that is not a member, or may not
 * make the change, is forbidden from it. Only bots are refused for their former membership.
 */
function refuseSupergroupChange(
  reason:
    | 'actor_not_found'
    | 'chat_not_found'
    | 'not_a_member'
    | 'not_enough_rights'
    | 'bot_not_a_member'
    | 'bot_kicked',
): ControlOperationResponse<typeof setSupergroupDefaultPermissionsContract> {
  switch (reason) {
    case 'actor_not_found':
    case 'chat_not_found':
      return { status: 404, body: { reason } };
    case 'not_a_member':
    case 'not_enough_rights':
      return { status: 403, body: { reason } };
    case 'bot_not_a_member':
    case 'bot_kicked':
      throw new Error(`Account refused as a bot: ${reason}`);
    default: {
      const unhandledReason: never = reason;
      throw new Error(`Unhandled supergroup change failure: ${unhandledReason}`);
    }
  }
}

/** The owner or an administrator of a supergroup, as a member account inspects it. */
type AdministratorStandingForAccount = Extract<
  ReturnType<SupergroupAdministration['getAdministratorsForAccount']>,
  { readonly found: true }
>['administrators'][number];

/**
 * Shows the owner and administrators of a supergroup as a member account inspects them: the
 * owner first, then each administrator with every supergroup right, held or not, the user that
 * last set its rights, and whether the account may edit it.
 *
 * @throws {Error} when the list does not start with the supergroup's one owner, which a supergroup
 * always has.
 */
function presentAdministratorsForAccount(
  administrators: readonly AdministratorStandingForAccount[],
): ControlOperationResult<typeof getSupergroupAdministratorsContract>['administrators'] {
  const [owner, ...others] = administrators;
  if (owner?.status.status !== 'owner') {
    throw new Error('A supergroup lists its administrators without its owner first');
  }
  return [
    {
      user_id: owner.userId,
      status: 'owner' as const,
      ...presentCustomTitle(owner.status.customTitle),
    },
    ...others.map(({ userId, status, canBeEdited }) => {
      if (status.status === 'owner') {
        throw new Error(`Supergroup administrator ${userId} is a second owner`);
      }
      return {
        user_id: userId,
        status: 'administrator' as const,
        rights: presentAdministratorRights(status.rights),
        ...presentCustomTitle(status.customTitle),
        promoted_by_user_id: status.promotedById,
        can_be_edited: canBeEdited,
      };
    }),
  ];
}

function presentCustomTitle(customTitle: string | undefined) {
  return customTitle === undefined ? {} : { custom_title: customTitle };
}

/** Every supergroup right by its Bot API name, held or not, in the Bot API's order. */
function presentAdministratorRights(rights: ReadonlySet<string>) {
  return {
    can_manage_chat: rights.has('can_manage_chat'),
    can_change_info: rights.has('can_change_info'),
    can_delete_messages: rights.has('can_delete_messages'),
    can_invite_users: rights.has('can_invite_users'),
    can_restrict_members: rights.has('can_restrict_members'),
    can_pin_messages: rights.has('can_pin_messages'),
    can_manage_topics: rights.has('can_manage_topics'),
    can_promote_members: rights.has('can_promote_members'),
    can_manage_video_chats: rights.has('can_manage_video_chats'),
    can_post_stories: rights.has('can_post_stories'),
    can_edit_stories: rights.has('can_edit_stories'),
    can_delete_stories: rights.has('can_delete_stories'),
    can_manage_tags: rights.has('can_manage_tags'),
    can_send_welcome_messages: rights.has('can_send_welcome_messages'),
  };
}
