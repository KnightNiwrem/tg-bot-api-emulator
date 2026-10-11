/**
 * The contracts of supergroups' administration: their administrators and their rights and custom
 * titles, restrictions of users and the test control that ends one, the supergroup's title,
 * description and default permissions, and the protection of its content.
 */
import { z } from 'zod';

import { controlRefusalSchema, controlValidationErrorSchema } from './control_errors.ts';
import { defineControlOperation } from './operation_contract.ts';
import {
  accountSupergroupPathSchema,
  accountSupergroupUserPathSchema,
  supergroupUserPathSchema,
} from './supergroups.ts';
import { telegramObjectSchema } from './wire_fields.ts';

/**
 * A supergroup administrator right, by the Bot API's name. Any right includes `can_manage_chat`,
 * as on Telegram.
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

/**
 * A permission a supergroup grants its members, by the Bot API's `ChatPermissions` name.
 * `can_send_media_messages`, which the Bot API derives from the media permissions, is none.
 */
export const CHAT_PERMISSIONS = [
  'can_send_messages',
  'can_send_audios',
  'can_send_documents',
  'can_send_photos',
  'can_send_videos',
  'can_send_video_notes',
  'can_send_voice_notes',
  'can_send_polls',
  'can_send_other_messages',
  'can_add_web_page_previews',
  'can_react_to_messages',
  'can_edit_tag',
  'can_change_info',
  'can_invite_users',
  'can_pin_messages',
  'can_manage_topics',
] as const;

/** An object with a member of `schema` for each name. */
function shapeOf<const Name extends string, Schema extends z.ZodType>(
  names: readonly Name[],
  schema: Schema,
): { [Member in Name]: Schema } {
  // `Object.fromEntries` types its keys as any text; it holds a member for each name by
  // construction.
  return Object.fromEntries(names.map((name) => [name, schema])) as { [Member in Name]: Schema };
}

/**
 * The title that clients show for the owner or an administrator in place of its role, of 1 to 16
 * characters, counted by code point.
 */
const customTitleSchema = z.string().min(1).max(16);

/** The supergroup's owner, as a member account inspects it. */
const ownerSchema = z.strictObject({
  user_id: z.int(),
  status: z.literal('owner'),
  custom_title: customTitleSchema.optional(),
});

/** An administrator of a supergroup, as a member account inspects it. */
const administratorSchema = z.strictObject({
  user_id: z.int(),
  status: z.literal('administrator'),
  /** Every supergroup right by its Bot API name, held or not. */
  rights: z.strictObject(shapeOf(SUPERGROUP_ADMINISTRATOR_RIGHTS, z.boolean())),
  custom_title: customTitleSchema.optional(),
  /**
   * The owner or administrator that last set the administrator's rights, as Telegram records it
   * in `promoted_by`, even once that promoter's tenure has ended.
   */
  promoted_by_user_id: z.int(),
  /**
   * Whether this account may change the administrator's rights or demote it: it owns the
   * supergroup, or it holds `can_promote_members` and promoted the administrator, directly or
   * through administrators it promoted, during administrator tenures that still last. No account
   * may edit itself.
   */
  can_be_edited: z.boolean(),
});

/** The permissions by the Bot API's names; an omitted permission is withheld. */
const chatPermissionsSchema = z.strictObject(
  shapeOf(CHAT_PERMISSIONS, z.boolean().optional()),
);

/** The refusals of an account that administers members of a supergroup. */
const memberAdministrationRefusals = {
  404: controlRefusalSchema([
    'actor_account_not_found',
    'chat_not_found',
    'member_not_found',
    'session_not_found',
  ]),
} as const;

export const getSupergroupAdministratorsContract = defineControlOperation({
  operationId: 'getSupergroupAdministrators',
  method: 'GET',
  path:
    '/sessions/{sessionId}/accounts/{accountId}/conversations/supergroup/{chatId}/administrators',
  params: accountSupergroupPathSchema,
  success: {
    status: 200,
    body: {
      kind: 'json',
      schema: z.strictObject({
        /** The owner, then the administrators in the order they joined. */
        administrators: z.tuple([ownerSchema], administratorSchema),
      }),
    },
  },
  refusals: {
    400: controlValidationErrorSchema,
    403: controlRefusalSchema(['not_a_member']),
    404: controlRefusalSchema(['account_not_found', 'chat_not_found', 'session_not_found']),
  },
});

/**
 * The rights the administrator holds, by the Bot API's names, of which at least one must be
 * `true`, which the server checks as `no_rights_granted`; an omitted right is not held.
 */
const promoteSupergroupMemberRequestSchema = z.strictObject(
  shapeOf(SUPERGROUP_ADMINISTRATOR_RIGHTS, z.boolean().default(false)),
);

export const promoteSupergroupMemberContract = defineControlOperation({
  operationId: 'promoteSupergroupMember',
  method: 'PUT',
  path:
    '/sessions/{sessionId}/accounts/{accountId}/conversations/supergroup/{chatId}/administrators/{userId}',
  params: accountSupergroupUserPathSchema,
  body: { required: true, schema: promoteSupergroupMemberRequestSchema },
  success: { status: 204, body: { kind: 'empty' } },
  refusals: {
    400: z.union([controlValidationErrorSchema, controlRefusalSchema(['no_rights_granted'])]),
    403: controlRefusalSchema([
      'actor_not_a_member',
      'administrator_not_promoted_by_actor',
      'cannot_manage_self',
      'not_enough_rights',
      'rights_not_held',
    ]),
    ...memberAdministrationRefusals,
    409: controlRefusalSchema(['member_is_owner', 'not_a_member']),
  },
});

export const demoteSupergroupMemberContract = defineControlOperation({
  operationId: 'demoteSupergroupMember',
  method: 'DELETE',
  path:
    '/sessions/{sessionId}/accounts/{accountId}/conversations/supergroup/{chatId}/administrators/{userId}',
  params: accountSupergroupUserPathSchema,
  success: { status: 204, body: { kind: 'empty' } },
  refusals: {
    400: controlValidationErrorSchema,
    403: controlRefusalSchema([
      'actor_not_a_member',
      'administrator_not_promoted_by_actor',
      'cannot_manage_self',
      'not_enough_rights',
    ]),
    ...memberAdministrationRefusals,
    409: controlRefusalSchema(['member_is_owner', 'not_a_member']),
  },
});

const setCustomTitleRequestSchema = z.strictObject({
  /**
   * The new title, of at most 16 characters counted as Unicode code points and without emoji, as
   * the Bot API documents it; empty removes the title. Telegram cleans it first, so the server
   * checks the limits, as `custom_title_too_long` and `custom_title_contains_emoji`.
   */
  custom_title: z.string(),
});

export const setSupergroupCustomTitleContract = defineControlOperation({
  operationId: 'setSupergroupCustomTitle',
  method: 'PUT',
  path:
    '/sessions/{sessionId}/accounts/{accountId}/conversations/supergroup/{chatId}/administrators/{userId}/custom-title',
  params: accountSupergroupUserPathSchema,
  body: { required: true, schema: setCustomTitleRequestSchema },
  success: { status: 204, body: { kind: 'empty' } },
  refusals: {
    400: z.union([
      controlValidationErrorSchema,
      controlRefusalSchema([
        'custom_title_contains_emoji',
        'custom_title_too_long',
        'text_encoding_invalid',
      ]),
    ]),
    403: controlRefusalSchema(['actor_not_authorized']),
    ...memberAdministrationRefusals,
    409: controlRefusalSchema(['not_a_member', 'not_an_administrator']),
  },
});

/** The refusals of an account that restricts a user of a supergroup or lifts its restriction. */
const restrictionRefusals = {
  400: controlValidationErrorSchema,
  403: controlRefusalSchema([
    'actor_not_a_member',
    'administrator_not_promoted_by_actor',
    'cannot_manage_self',
    'not_enough_rights',
    'not_enough_rights_to_promote',
  ]),
  ...memberAdministrationRefusals,
  409: controlRefusalSchema(['member_is_owner']),
} as const;

const restrictSupergroupMemberRequestSchema = z.strictObject({
  /**
   * The permissions the user keeps; a permission set to `true` is kept, and, unlike in the Bot
   * API, none implies another. Keeping every permission lifts the restriction.
   */
  permissions: chatPermissionsSchema,
  /**
   * When the restriction ends, as a Unix time in seconds; omitted, or less than 30 seconds or more
   * than 366 days away, for one that lasts until it is lifted. The emulator never lifts it as time
   * passes: a test makes its end arrive.
   */
  until_date: z.int().optional(),
});

export const restrictSupergroupMemberContract = defineControlOperation({
  operationId: 'restrictSupergroupMember',
  method: 'PUT',
  path:
    '/sessions/{sessionId}/accounts/{accountId}/conversations/supergroup/{chatId}/restrictions/{userId}',
  params: accountSupergroupUserPathSchema,
  body: { required: true, schema: restrictSupergroupMemberRequestSchema },
  success: { status: 204, body: { kind: 'empty' } },
  refusals: restrictionRefusals,
});

export const liftSupergroupMemberRestrictionContract = defineControlOperation({
  operationId: 'liftSupergroupMemberRestriction',
  method: 'DELETE',
  path:
    '/sessions/{sessionId}/accounts/{accountId}/conversations/supergroup/{chatId}/restrictions/{userId}',
  params: accountSupergroupUserPathSchema,
  success: { status: 204, body: { kind: 'empty' } },
  refusals: restrictionRefusals,
});

/** The refusals of a member that changes a supergroup's information or default permissions. */
const supergroupChangeRefusals = {
  403: controlRefusalSchema(['not_a_member', 'not_enough_rights']),
  404: controlRefusalSchema(['actor_not_found', 'chat_not_found', 'session_not_found']),
} as const;

export const setSupergroupDefaultPermissionsContract = defineControlOperation({
  operationId: 'setSupergroupDefaultPermissions',
  method: 'PUT',
  path: '/sessions/{sessionId}/accounts/{accountId}/conversations/supergroup/{chatId}/permissions',
  params: accountSupergroupPathSchema,
  body: {
    required: true,
    schema: z.strictObject({
      /**
       * What members may do by default; a permission set to `true` is granted, and, unlike in the
       * Bot API, none implies another.
       */
      permissions: chatPermissionsSchema,
    }),
  },
  success: { status: 204, body: { kind: 'empty' } },
  refusals: { 400: controlValidationErrorSchema, ...supergroupChangeRefusals },
});

/** The refusals of the owner protecting a supergroup's content, or lifting that protection. */
const contentProtectionRefusals = {
  400: controlValidationErrorSchema,
  403: controlRefusalSchema(['actor_not_authorized']),
  404: controlRefusalSchema(['actor_account_not_found', 'chat_not_found', 'session_not_found']),
} as const;

export const protectSupergroupContentContract = defineControlOperation({
  operationId: 'protectSupergroupContent',
  method: 'PUT',
  path:
    '/sessions/{sessionId}/accounts/{accountId}/conversations/supergroup/{chatId}/content-protection',
  params: accountSupergroupPathSchema,
  success: { status: 204, body: { kind: 'empty' } },
  refusals: contentProtectionRefusals,
});

export const unprotectSupergroupContentContract = defineControlOperation({
  operationId: 'unprotectSupergroupContent',
  method: 'DELETE',
  path:
    '/sessions/{sessionId}/accounts/{accountId}/conversations/supergroup/{chatId}/content-protection',
  params: accountSupergroupPathSchema,
  success: { status: 204, body: { kind: 'empty' } },
  refusals: contentProtectionRefusals,
});

export const changeSupergroupTitleContract = defineControlOperation({
  operationId: 'changeSupergroupTitle',
  method: 'PUT',
  path: '/sessions/{sessionId}/accounts/{accountId}/conversations/supergroup/{chatId}/title',
  params: accountSupergroupPathSchema,
  body: {
    required: true,
    schema: z.strictObject({
      /** The new title, which Telegram cleans; one that cleans to nothing is `title_empty`. */
      title: z.string(),
    }),
  },
  success: { status: 204, body: { kind: 'empty' } },
  refusals: {
    400: z.union([
      controlValidationErrorSchema,
      controlRefusalSchema(['text_encoding_invalid', 'title_empty']),
    ]),
    ...supergroupChangeRefusals,
  },
});

export const changeSupergroupDescriptionContract = defineControlOperation({
  operationId: 'changeSupergroupDescription',
  method: 'PUT',
  path: '/sessions/{sessionId}/accounts/{accountId}/conversations/supergroup/{chatId}/description',
  params: accountSupergroupPathSchema,
  body: {
    required: true,
    schema: z.strictObject({
      /** The new description, which Telegram cleans; empty removes it. */
      description: z.string(),
    }),
  },
  success: { status: 204, body: { kind: 'empty' } },
  refusals: {
    400: z.union([controlValidationErrorSchema, controlRefusalSchema(['text_encoding_invalid'])]),
    ...supergroupChangeRefusals,
    409: controlRefusalSchema(['description_not_modified']),
  },
});

/**
 * Ends a user's temporary restriction as its `until_date` arriving does, and answers with the
 * user's standing after it, as the Bot API's `ChatMember` shows it: `member`, or `left` for a user
 * that is not a member.
 */
export const expireSupergroupMemberRestrictionContract = defineControlOperation({
  operationId: 'expireSupergroupMemberRestriction',
  method: 'POST',
  path: '/sessions/{sessionId}/supergroups/{chatId}/restrictions/{userId}/expiry',
  params: supergroupUserPathSchema,
  success: {
    status: 200,
    body: {
      kind: 'json',
      schema: z.strictObject({
        chat_member: telegramObjectSchema('ChatMember', { status: z.enum(['member', 'left']) }),
      }),
    },
  },
  refusals: {
    400: controlValidationErrorSchema,
    404: controlRefusalSchema(['chat_not_found', 'member_not_found', 'session_not_found']),
    409: controlRefusalSchema(['restriction_not_temporary']),
  },
});
