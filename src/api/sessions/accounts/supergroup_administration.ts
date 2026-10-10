import { type Context, Hono } from 'hono';
import { z } from 'zod';

import {
  grantSupergroupAdministratorRights,
  SUPERGROUP_ADMINISTRATOR_RIGHTS,
} from '../../../types/chat_membership.ts';
import { CHAT_PERMISSIONS } from '../../../types/chat_permissions.ts';
import type { EmulationSession } from '../../../types/emulation_session.ts';
import {
  controlErrorResponse,
  invalidControlRequestResponse,
} from '../../control_error_response.ts';
import { readPathParameters } from '../control_request_input.ts';
import { readJsonRequestBody } from '../json_request_body.ts';
import type { SessionRouteContextTypes } from '../session_route_context_types.ts';
import {
  SUPERGROUP_CONVERSATION_PATH,
  supergroupConversationPathSchema,
  supergroupMemberPathSchema,
  USER_ID_PARAMETER,
} from './account_paths.ts';
import { supergroupMemberFailureStatus } from './messaging_failure_statuses.ts';

const SUPERGROUP_ADMINISTRATOR_COLLECTION_PATH =
  `${SUPERGROUP_CONVERSATION_PATH}/administrators` as const;
const SUPERGROUP_ADMINISTRATOR_PATH =
  `${SUPERGROUP_ADMINISTRATOR_COLLECTION_PATH}/:${USER_ID_PARAMETER}` as const;
const SUPERGROUP_CUSTOM_TITLE_PATH = `${SUPERGROUP_ADMINISTRATOR_PATH}/custom-title` as const;
const SUPERGROUP_RESTRICTION_PATH =
  `${SUPERGROUP_CONVERSATION_PATH}/restrictions/:${USER_ID_PARAMETER}` as const;
const SUPERGROUP_CONTENT_PROTECTION_PATH =
  `${SUPERGROUP_CONVERSATION_PATH}/content-protection` as const;
const SUPERGROUP_TITLE_PATH = `${SUPERGROUP_CONVERSATION_PATH}/title` as const;
const SUPERGROUP_DEFAULT_PERMISSIONS_PATH = `${SUPERGROUP_CONVERSATION_PATH}/permissions` as const;
const SUPERGROUP_DESCRIPTION_PATH = `${SUPERGROUP_CONVERSATION_PATH}/description` as const;

/** The rights an administrator holds, by the Bot API's names; an omitted right is not held. */
const promoteChatMemberRequestSchema = z.partialRecord(
  z.enum(SUPERGROUP_ADMINISTRATOR_RIGHTS),
  z.boolean(),
);

/**
 * Permissions by the Bot API's names, where an omitted permission is withheld and, unlike in the
 * Bot API, no permission implies another.
 */
const chatPermissionsSchema = z.partialRecord(z.enum(CHAT_PERMISSIONS), z.boolean())
  .transform((permissions) =>
    new Set(CHAT_PERMISSIONS.filter((permission) => permissions[permission] === true))
  );

/** What a supergroup's members may do by default, which a member with the right changes. */
const changeDefaultPermissionsRequestSchema = z.strictObject({
  permissions: chatPermissionsSchema,
});

/**
 * A restriction an account applies: the permissions the user keeps, and when it ends, as a Unix
 * time Telegram normalizes, or never when omitted.
 */
const restrictChatMemberRequestSchema = z.strictObject({
  permissions: chatPermissionsSchema,
  until_date: z.int().optional(),
});

/**
 * A custom title, which Telegram cleans and refuses beyond 16 characters or with emoji; empty
 * removes the title.
 */
const setCustomTitleRequestSchema = z.strictObject({ custom_title: z.string() });

/** A supergroup's new title, which Telegram cleans; one that cleans to nothing is refused. */
const changeSupergroupTitleRequestSchema = z.strictObject({ title: z.string() });

/** A supergroup's new description, which Telegram cleans; empty removes it. */
const changeSupergroupDescriptionRequestSchema = z.strictObject({ description: z.string() });

/**
 * Routes through which an account administers a supergroup: its administrators and their rights and
 * custom titles, restrictions of users, its title, description and default permissions, and the
 * protection of its content.
 */
export function createSupergroupAdministrationRoutes(): Hono<SessionRouteContextTypes> {
  const accountRoutes = new Hono<SessionRouteContextTypes>();

  // A member inspects the owner and administrators, who promoted each, and whom it may edit.
  accountRoutes.get(SUPERGROUP_ADMINISTRATOR_COLLECTION_PATH, (context) => {
    const conversationPath = readPathParameters(
      supergroupConversationPathSchema,
      context.req.param(),
    );
    if (!conversationPath.valid) {
      return invalidControlRequestResponse(context, conversationPath.issues);
    }
    const { accountId, chatId } = conversationPath.value;

    const result = context.get('emulationSession').sharedChatAdministration
      .getAdministratorsForAccount({ observerAccountId: accountId, chatId });
    if (!result.found) {
      return controlErrorResponse(
        context,
        supergroupMemberFailureStatus(result.reason),
        result.reason,
      );
    }
    return context.json({
      administrators: result.administrators.map(presentAdministratorForAccount),
    });
  });

  // The owner or an administrator that may promote makes a member an administrator, or changes
  // the rights of an administrator it may edit.
  accountRoutes.put(SUPERGROUP_ADMINISTRATOR_PATH, async (context) => {
    const memberPath = readPathParameters(supergroupMemberPathSchema, context.req.param());
    if (!memberPath.valid) {
      return invalidControlRequestResponse(context, memberPath.issues);
    }
    const requestBodyReading = await readJsonRequestBody(
      context.req,
      promoteChatMemberRequestSchema,
    );
    if (!requestBodyReading.valid) {
      return invalidControlRequestResponse(context, requestBodyReading.issues);
    }
    const requestBody = requestBodyReading.value;
    const { accountId, chatId, userId } = memberPath.value;

    const result = context.get('emulationSession').sharedChatAdministration.promoteChatMember({
      actorAccountId: accountId,
      chatId,
      memberId: userId,
      rights: grantSupergroupAdministratorRights(
        SUPERGROUP_ADMINISTRATOR_RIGHTS.filter((right) => requestBody[right] === true),
      ),
    });
    if (result.promoted) {
      return context.body(null, 204);
    }
    // An administrator without rights would be a member; DELETE demotes one instead.
    return controlErrorResponse(
      context,
      result.reason === 'no_rights_granted'
        ? 400
        : accountAdministrationFailureStatus(result.reason),
      result.reason,
    );
  });

  // The owner or an administrator that may restrict members restricts a user, member or not, or
  // changes its restriction.
  accountRoutes.put(SUPERGROUP_RESTRICTION_PATH, async (context) => {
    const memberPath = readPathParameters(supergroupMemberPathSchema, context.req.param());
    if (!memberPath.valid) {
      return invalidControlRequestResponse(context, memberPath.issues);
    }
    const requestBodyReading = await readJsonRequestBody(
      context.req,
      restrictChatMemberRequestSchema,
    );
    if (!requestBodyReading.valid) {
      return invalidControlRequestResponse(context, requestBodyReading.issues);
    }
    const requestBody = requestBodyReading.value;
    const { accountId, chatId, userId } = memberPath.value;

    const result = context.get('emulationSession').sharedChatAdministration
      .restrictChatMemberAsAccount({
        actorAccountId: accountId,
        chatId,
        memberId: userId,
        permissions: requestBody.permissions,
        requestedRestrictionEndUnixSeconds: requestBody.until_date,
      });
    return result.changed ? context.body(null, 204) : controlErrorResponse(
      context,
      accountAdministrationFailureStatus(result.reason),
      result.reason,
    );
  });

  // The owner or an administrator that may restrict members lifts a user's restriction; lifting
  // none changes nothing.
  accountRoutes.delete(SUPERGROUP_RESTRICTION_PATH, (context) => {
    const memberPath = readPathParameters(supergroupMemberPathSchema, context.req.param());
    if (!memberPath.valid) {
      return invalidControlRequestResponse(context, memberPath.issues);
    }
    const { accountId, chatId, userId } = memberPath.value;

    const result = context.get('emulationSession').sharedChatAdministration
      .liftRestrictionAsAccount({ actorAccountId: accountId, chatId, memberId: userId });
    return result.changed ? context.body(null, 204) : controlErrorResponse(
      context,
      accountAdministrationFailureStatus(result.reason),
      result.reason,
    );
  });

  // The owner sets its own custom title or an administrator's; an empty title removes it.
  accountRoutes.put(SUPERGROUP_CUSTOM_TITLE_PATH, async (context) => {
    const memberPath = readPathParameters(supergroupMemberPathSchema, context.req.param());
    if (!memberPath.valid) {
      return invalidControlRequestResponse(context, memberPath.issues);
    }
    const requestBodyReading = await readJsonRequestBody(context.req, setCustomTitleRequestSchema);
    if (!requestBodyReading.valid) {
      return invalidControlRequestResponse(context, requestBodyReading.issues);
    }
    const requestBody = requestBodyReading.value;
    const { accountId, chatId, userId } = memberPath.value;

    const result = context.get('emulationSession').sharedChatAdministration.setCustomTitle({
      actorAccountId: accountId,
      chatId,
      memberId: userId,
      customTitle: requestBody.custom_title,
    });
    if (result.set) {
      return context.body(null, 204);
    }
    switch (result.reason) {
      case 'actor_account_not_found':
      case 'chat_not_found':
      case 'member_not_found':
        return controlErrorResponse(context, 404, result.reason);
      case 'actor_not_authorized':
        return controlErrorResponse(context, 403, result.reason);
      case 'not_a_member':
      case 'not_an_administrator':
        return controlErrorResponse(context, 409, result.reason);
      case 'text_encoding_invalid':
      case 'custom_title_too_long':
      case 'custom_title_contains_emoji':
        return controlErrorResponse(context, 400, result.reason);
      default: {
        const unhandledReason: never = result.reason;
        throw new Error(`Unhandled custom title failure: ${unhandledReason}`);
      }
    }
  });

  // A member changes the supergroup's title, which a service message records.
  accountRoutes.put(SUPERGROUP_TITLE_PATH, async (context) => {
    const conversationPath = readPathParameters(
      supergroupConversationPathSchema,
      context.req.param(),
    );
    if (!conversationPath.valid) {
      return invalidControlRequestResponse(context, conversationPath.issues);
    }
    const requestBodyReading = await readJsonRequestBody(
      context.req,
      changeSupergroupTitleRequestSchema,
    );
    if (!requestBodyReading.valid) {
      return invalidControlRequestResponse(context, requestBodyReading.issues);
    }
    const requestBody = requestBodyReading.value;
    const { accountId, chatId } = conversationPath.value;

    const result = context.get('emulationSession').sharedChatAdministration
      .changeSupergroupTitle({
        actor: { kind: 'account', accountId },
        chatId,
        title: requestBody.title,
      });
    return result.changed ? context.body(null, 204) : controlErrorResponse(
      context,
      supergroupInfoChangeFailureStatus(result.reason),
      result.reason,
    );
  });

  // A member changes the supergroup's description, which no service message records.
  accountRoutes.put(SUPERGROUP_DESCRIPTION_PATH, async (context) => {
    const conversationPath = readPathParameters(
      supergroupConversationPathSchema,
      context.req.param(),
    );
    if (!conversationPath.valid) {
      return invalidControlRequestResponse(context, conversationPath.issues);
    }
    const requestBodyReading = await readJsonRequestBody(
      context.req,
      changeSupergroupDescriptionRequestSchema,
    );
    if (!requestBodyReading.valid) {
      return invalidControlRequestResponse(context, requestBodyReading.issues);
    }
    const requestBody = requestBodyReading.value;
    const { accountId, chatId } = conversationPath.value;

    const result = context.get('emulationSession').sharedChatAdministration
      .changeSupergroupDescription({
        actor: { kind: 'account', accountId },
        chatId,
        description: requestBody.description,
      });
    return result.changed ? context.body(null, 204) : controlErrorResponse(
      context,
      supergroupInfoChangeFailureStatus(result.reason),
      result.reason,
    );
  });

  // A member with the right to restrict members changes what members may do by default.
  accountRoutes.put(SUPERGROUP_DEFAULT_PERMISSIONS_PATH, async (context) => {
    const conversationPath = readPathParameters(
      supergroupConversationPathSchema,
      context.req.param(),
    );
    if (!conversationPath.valid) {
      return invalidControlRequestResponse(context, conversationPath.issues);
    }
    const requestBodyReading = await readJsonRequestBody(
      context.req,
      changeDefaultPermissionsRequestSchema,
    );
    if (!requestBodyReading.valid) {
      return invalidControlRequestResponse(context, requestBodyReading.issues);
    }
    const requestBody = requestBodyReading.value;
    const { accountId, chatId } = conversationPath.value;

    const result = context.get('emulationSession').sharedChatAdministration
      .changeDefaultPermissions({
        actor: { kind: 'account', accountId },
        chatId,
        permissions: requestBody.permissions,
      });
    if (result.changed) {
      return context.body(null, 204);
    }
    switch (result.reason) {
      case 'actor_not_found':
      case 'chat_not_found':
        return controlErrorResponse(context, 404, result.reason);
      case 'not_a_member':
      case 'not_enough_rights':
        return controlErrorResponse(context, 403, result.reason);
      // Only bots are refused for their former membership.
      case 'bot_not_a_member':
      case 'bot_kicked':
        throw new Error(`Account ${accountId} refused as a bot: ${result.reason}`);
      default: {
        const unhandledReason: never = result.reason;
        throw new Error(`Unhandled default permissions failure: ${unhandledReason}`);
      }
    }
  });

  // The owner protects all content of the supergroup from forwarding and saving, or lifts that.
  accountRoutes.put(
    SUPERGROUP_CONTENT_PROTECTION_PATH,
    (context) => setSupergroupContentProtection(context, true),
  );
  accountRoutes.delete(
    SUPERGROUP_CONTENT_PROTECTION_PATH,
    (context) => setSupergroupContentProtection(context, false),
  );

  // The owner or an administrator that may edit an administrator demotes it to a member;
  // demoting a member changes nothing.
  accountRoutes.delete(SUPERGROUP_ADMINISTRATOR_PATH, (context) => {
    const memberPath = readPathParameters(supergroupMemberPathSchema, context.req.param());
    if (!memberPath.valid) {
      return invalidControlRequestResponse(context, memberPath.issues);
    }
    const { accountId, chatId, userId } = memberPath.value;

    const result = context.get('emulationSession').sharedChatAdministration.demoteChatMember({
      actorAccountId: accountId,
      chatId,
      memberId: userId,
    });
    return result.demoted ? context.body(null, 204) : controlErrorResponse(
      context,
      accountAdministrationFailureStatus(result.reason),
      result.reason,
    );
  });

  return accountRoutes;
}

/**
 * Why an account cannot promote, demote, restrict, or lift the restriction of a supergroup user,
 * other than a promotion granting no right.
 */
type AccountAdministrationFailureReason =
  | Exclude<
    Extract<
      ReturnType<SupergroupAdministration['promoteChatMember']>,
      { readonly promoted: false }
    >[
      'reason'
    ],
    'no_rights_granted'
  >
  | Extract<
    ReturnType<SupergroupAdministration['restrictChatMemberAsAccount']>,
    { readonly changed: false }
  >['reason'];

/**
 * A missing account, supergroup, or user is not found; an account that is not a member, lacks the
 * right, would grant a right it lacks, or acts on itself or on an administrator it did not promote
 * is forbidden; the owner, and a user that is not a member for a change of role, conflict with the
 * change.
 */
function accountAdministrationFailureStatus(
  reason: AccountAdministrationFailureReason,
): 403 | 404 | 409 {
  switch (reason) {
    case 'actor_account_not_found':
    case 'chat_not_found':
    case 'member_not_found':
      return 404;
    case 'actor_not_a_member':
    case 'cannot_manage_self':
    case 'not_enough_rights':
    case 'not_enough_rights_to_promote':
    case 'administrator_not_promoted_by_actor':
    case 'rights_not_held':
      return 403;
    case 'not_a_member':
    case 'member_is_owner':
      return 409;
    default: {
      const unhandledReason: never = reason;
      throw new Error(`Unhandled account administration failure: ${unhandledReason}`);
    }
  }
}

/** Answers the owner's request to protect a supergroup's content, or to lift that protection. */
function setSupergroupContentProtection(
  context: Context<SessionRouteContextTypes>,
  hasProtectedContent: boolean,
): Response {
  const conversationPath = readPathParameters(
    supergroupConversationPathSchema,
    context.req.param(),
  );
  if (!conversationPath.valid) {
    return invalidControlRequestResponse(context, conversationPath.issues);
  }
  const { accountId, chatId } = conversationPath.value;

  const result = context.get('emulationSession').sharedChatAdministration.setContentProtection({
    actorAccountId: accountId,
    chatId,
    hasProtectedContent,
  });
  if (result.set) {
    return context.body(null, 204);
  }
  return controlErrorResponse(
    context,
    result.reason === 'actor_not_authorized' ? 403 : 404,
    result.reason,
  );
}

/**
 * A missing account or supergroup is not found; an account that is not a member, or may not
 * change the supergroup's information, is forbidden from it; a description the supergroup has
 * conflicts with it, as Telegram refuses it; text Telegram cannot use rejects the request.
 */
function supergroupInfoChangeFailureStatus(
  reason: Extract<
    | ReturnType<SupergroupAdministration['changeSupergroupTitle']>
    | ReturnType<SupergroupAdministration['changeSupergroupDescription']>,
    { readonly changed: false }
  >['reason'],
): 400 | 403 | 404 | 409 {
  switch (reason) {
    case 'actor_not_found':
    case 'chat_not_found':
      return 404;
    case 'not_a_member':
    case 'not_enough_rights':
      return 403;
    case 'description_not_modified':
      return 409;
    case 'text_encoding_invalid':
    case 'title_empty':
      return 400;
    // Only bots are refused for their former membership.
    case 'bot_not_a_member':
    case 'bot_kicked':
      throw new Error(`Account refused as a bot: ${reason}`);
    default: {
      const unhandledReason: never = reason;
      throw new Error(`Unhandled supergroup information failure: ${unhandledReason}`);
    }
  }
}

type SupergroupAdministration = EmulationSession['sharedChatAdministration'];

/** The owner or an administrator of a supergroup, as a member account inspects it. */
type AdministratorStandingForAccount = Extract<
  ReturnType<EmulationSession['sharedChatAdministration']['getAdministratorsForAccount']>,
  { readonly found: true }
>['administrators'][number];

/**
 * Shows the owner or an administrator of a supergroup as a member account inspects it: an
 * administrator with every supergroup right, held or not, the user that last set its rights, and
 * whether the account may edit it.
 */
function presentAdministratorForAccount(
  { userId, status, canBeEdited }: AdministratorStandingForAccount,
) {
  const customTitle = status.customTitle === undefined ? {} : { custom_title: status.customTitle };
  if (status.status === 'owner') {
    return { user_id: userId, status: 'owner' as const, ...customTitle };
  }
  return {
    user_id: userId,
    status: 'administrator' as const,
    rights: Object.fromEntries(
      SUPERGROUP_ADMINISTRATOR_RIGHTS.map((right) => [right, status.rights.has(right)]),
    ),
    ...customTitle,
    promoted_by_user_id: status.promotedById,
    can_be_edited: canBeEdited,
  };
}
