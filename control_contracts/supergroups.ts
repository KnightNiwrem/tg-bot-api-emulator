/**
 * The contracts of supergroups' creation and membership: the supergroups accounts create, the
 * members they add, remove, or that join or leave, the invite links accounts join by, and the join
 * requests their owners inspect and decide, with the test controls that make an invite link's or
 * a join request's time arrive.
 */
import { z } from 'zod';

import { accountPathSchema } from './accounts.ts';
import { controlRefusalSchema, controlValidationErrorSchema } from './control_errors.ts';
import { defineControlOperation } from './operation_contract.ts';
import {
  sessionIdParameterSchema,
  supergroupChatIdSchema,
  telegramUserIdSchema,
  telegramUsernameSchema,
} from './wire_fields.ts';

/**
 * The hash of an invite link, which follows `https://t.me/+` in the link: 16 characters of the
 * `base64url` alphabet, as TDLib's `is_base64url_characters` accepts them.
 */
const inviteLinkHashSchema = z.string().regex(/^[A-Za-z0-9_-]{16}$/);

/** The path parameters of a supergroup as an account addresses it. */
export const accountSupergroupPathSchema = accountPathSchema.extend({
  chatId: supergroupChatIdSchema,
});

/** The path parameters of a user of a supergroup, such as a member, as an account addresses it. */
export const accountSupergroupUserPathSchema = accountSupergroupPathSchema.extend({
  userId: telegramUserIdSchema,
});

/** The path parameters of a user of a supergroup, as a session's test controls address it. */
export const supergroupUserPathSchema = z.strictObject({
  sessionId: sessionIdParameterSchema,
  chatId: supergroupChatIdSchema,
  userId: telegramUserIdSchema,
});

/** A supergroup as the Bot API shows a chat, with its description when it has one. */
const supergroupSchema = z.strictObject({
  /** The Bot API `chat_id` of the supergroup, a negative number. */
  id: supergroupChatIdSchema,
  type: z.literal('supergroup'),
  title: z.string().min(1),
  /** The username of a public supergroup; omitted for a private one. */
  username: z.string().min(1).optional(),
  description: z.string().min(1).optional(),
});

const createSupergroupRequestSchema = z.strictObject({
  title: z.string().min(1),
  /**
   * Makes the supergroup public under this username, which must be unique among the session's
   * usernames, compared without case, so that bots can address it as `@username`; omitted for a
   * private supergroup. It has the syntax of a bot's or account's username.
   */
  username: telegramUsernameSchema.optional(),
  description: z.string().min(1).optional(),
});

export const createSupergroupContract = defineControlOperation({
  operationId: 'createSupergroup',
  method: 'POST',
  path: '/sessions/{sessionId}/accounts/{accountId}/supergroups',
  params: accountPathSchema,
  body: { required: true, schema: createSupergroupRequestSchema },
  success: {
    status: 201,
    body: { kind: 'json', schema: z.strictObject({ supergroup: supergroupSchema }) },
  },
  refusals: {
    400: controlValidationErrorSchema,
    404: controlRefusalSchema(['creator_account_not_found', 'session_not_found']),
    409: controlRefusalSchema(['username_taken']),
    507: controlRefusalSchema(['identity_limit_reached']),
  },
});

/**
 * Adds the user as a member of a supergroup the account owns, or, when the user is the account
 * itself, joins a public supergroup. Adding a member again changes nothing.
 */
export const addSupergroupMemberContract = defineControlOperation({
  operationId: 'addSupergroupMember',
  method: 'PUT',
  path:
    '/sessions/{sessionId}/accounts/{accountId}/conversations/supergroup/{chatId}/members/{userId}',
  params: accountSupergroupUserPathSchema,
  success: { status: 204, body: { kind: 'empty' } },
  refusals: {
    400: controlValidationErrorSchema,
    403: controlRefusalSchema(['actor_not_authorized', 'banned', 'chat_not_public']),
    404: controlRefusalSchema([
      'account_not_found',
      'actor_account_not_found',
      'chat_not_found',
      'member_not_found',
      'session_not_found',
    ]),
  },
});

/**
 * Removes the user from a supergroup the account owns, or, when the user is the account itself,
 * leaves the supergroup. Leaving or removing a user that is not a member changes nothing.
 */
export const removeSupergroupMemberContract = defineControlOperation({
  operationId: 'removeSupergroupMember',
  method: 'DELETE',
  path:
    '/sessions/{sessionId}/accounts/{accountId}/conversations/supergroup/{chatId}/members/{userId}',
  params: accountSupergroupUserPathSchema,
  success: { status: 204, body: { kind: 'empty' } },
  refusals: {
    400: controlValidationErrorSchema,
    403: controlRefusalSchema(['actor_not_authorized']),
    404: controlRefusalSchema([
      'actor_account_not_found',
      'chat_not_found',
      'member_not_found',
      'session_not_found',
    ]),
    409: controlRefusalSchema(['owner_cannot_leave']),
  },
});

const joinChatByInviteLinkRequestSchema = z.strictObject({
  /** The whole link, as the bot that created it received it. */
  invite_link: z.string().min(1),
});

const chatJoinSchema = z.strictObject({
  /** The supergroup the link leads to. */
  chat_id: supergroupChatIdSchema,
  /**
   * `joined` when the account joined the supergroup; `join_request_sent` when the link creates
   * join requests, which leaves the account outside with a pending request.
   */
  outcome: z.enum(['joined', 'join_request_sent']),
});

export const joinChatByInviteLinkContract = defineControlOperation({
  operationId: 'joinChatByInviteLink',
  method: 'POST',
  path: '/sessions/{sessionId}/accounts/{accountId}/chat-joins',
  params: accountPathSchema,
  body: { required: true, schema: joinChatByInviteLinkRequestSchema },
  success: { status: 200, body: { kind: 'json', schema: chatJoinSchema } },
  refusals: {
    400: controlValidationErrorSchema,
    403: controlRefusalSchema(['banned']),
    404: controlRefusalSchema(['account_not_found', 'invite_link_not_found', 'session_not_found']),
    409: controlRefusalSchema(['already_a_member', 'join_request_pending']),
    410: controlRefusalSchema([
      'invite_link_expired',
      'invite_link_member_limit_reached',
      'invite_link_revoked',
    ]),
  },
});

/** An invite link of a supergroup, as Telegram shows it to its creator. */
const inviteLinkUrlSchema = z.string().regex(/^https:\/\/t\.me\/\+[A-Za-z0-9_-]{16}$/);

/**
 * An invite link of a supergroup as its owner inspects it: the whole link, its settings by the Bot
 * API's names, and how it is used.
 */
const supergroupInviteLinkSchema = z.strictObject({
  /** The whole link, `https://t.me/+` and its hash. */
  invite_link: inviteLinkUrlSchema,
  /** The link's name; omitted for none. */
  name: z.string().min(1).max(32).optional(),
  /** The administrator bot that created the link. */
  creator_user_id: telegramUserIdSchema,
  /** When the link stops working, as a Unix time in seconds; omitted for no expiry date. */
  expire_date: z.int().min(1).optional(),
  /** How many users that joined through the link may be members at once; omitted for no limit. */
  member_limit: z.int().min(1).max(99_999).optional(),
  /** How many members joined through the link and still are, which its member limit counts. */
  member_count: z.int().min(0),
  /** How many pending join requests were sent through the link. */
  pending_join_request_count: z.int().min(0),
  /** Whether users who use the link send a join request instead of joining. */
  creates_join_request: z.boolean(),
  /**
   * Whether the link is its creator's primary link, from `exportChatInviteLink` or the
   * replacement that revoking the previous one created, rather than an additional link. Each
   * administrator bot has at most one primary link that is not revoked.
   */
  is_primary: z.boolean(),
  /**
   * Whether a test made the link's current expiry date arrive, which ended its use until its
   * creator edits it; an edit that gives the link another expiry date, or none, makes it false
   * again.
   */
  is_expired: z.boolean(),
  /**
   * Whether the bot that created the link revoked it, for good: with `revokeChatInviteLink`, or,
   * for a primary link, by exporting a new one with `exportChatInviteLink`. Its members and pending
   * join requests stay.
   */
  is_revoked: z.boolean(),
});

/** A pending request to join a supergroup, as the supergroup's owner inspects it. */
const supergroupJoinRequestSchema = z.strictObject({
  /** The account that wants to join. */
  user_id: telegramUserIdSchema,
  /** The whole invite link the request was sent through. */
  invite_link: inviteLinkUrlSchema,
  /** When the request was sent, as a Unix time in seconds. */
  date: z.int().min(0),
  /**
   * Which bots may write to the user before it starts a private chat with them: the temporary
   * permission the Bot API documents for `user_chat_id`. It ends with the request; the emulator
   * never lets its five minutes pass by themselves, so a test ends it.
   */
  requester_contact: z.strictObject({
    /**
     * `open` while every bot that received the request may write; `claimed` once one of them
     * wrote, after which only that bot may; `expired` once a test ended the contact window.
     */
    status: z.enum(['open', 'claimed', 'expired']),
    /**
     * The bots that may write to the user now: while open, the bots that received the request,
     * and once claimed, the bot that claimed it, as long as they hold `can_invite_users`.
     */
    bot_ids: z.array(telegramUserIdSchema),
  }),
});

/**
 * The refusals of an inspection of a supergroup's invite links or join requests, which only its
 * owner makes.
 */
const ownerInspectionRefusals = {
  400: controlValidationErrorSchema,
  403: controlRefusalSchema(['not_the_owner']),
  404: controlRefusalSchema(['account_not_found', 'chat_not_found', 'session_not_found']),
} as const;

export const getSupergroupInviteLinksContract = defineControlOperation({
  operationId: 'getSupergroupInviteLinks',
  method: 'GET',
  path: '/sessions/{sessionId}/accounts/{accountId}/conversations/supergroup/{chatId}/invite-links',
  params: accountSupergroupPathSchema,
  success: {
    status: 200,
    body: {
      kind: 'json',
      schema: z.strictObject({
        /** The supergroup's invite links, in the order they were created. */
        invite_links: z.array(supergroupInviteLinkSchema),
      }),
    },
  },
  refusals: ownerInspectionRefusals,
});

export const getSupergroupJoinRequestsContract = defineControlOperation({
  operationId: 'getSupergroupJoinRequests',
  method: 'GET',
  path:
    '/sessions/{sessionId}/accounts/{accountId}/conversations/supergroup/{chatId}/join-requests',
  params: accountSupergroupPathSchema,
  success: {
    status: 200,
    body: {
      kind: 'json',
      schema: z.strictObject({
        /** The supergroup's pending join requests, in the order they were sent. */
        join_requests: z.array(supergroupJoinRequestSchema),
      }),
    },
  },
  refusals: ownerInspectionRefusals,
});

const decideJoinRequestRequestSchema = z.strictObject({
  /**
   * `approve` lets the requester in through the link it sent the request through; `decline`
   * leaves it outside.
   */
  decision: z.enum(['approve', 'decline']),
});

export const decideSupergroupJoinRequestContract = defineControlOperation({
  operationId: 'decideSupergroupJoinRequest',
  method: 'POST',
  path:
    '/sessions/{sessionId}/accounts/{accountId}/conversations/supergroup/{chatId}/join-requests/{userId}/decision',
  params: accountSupergroupUserPathSchema,
  body: { required: true, schema: decideJoinRequestRequestSchema },
  success: { status: 204, body: { kind: 'empty' } },
  refusals: {
    400: controlValidationErrorSchema,
    403: controlRefusalSchema(['not_enough_rights']),
    404: controlRefusalSchema([
      'account_not_found',
      'chat_not_found',
      'join_request_missing',
      'session_not_found',
    ]),
    409: controlRefusalSchema(['already_a_member']),
  },
});

/** Makes an invite link's `expire_date` arrive, and answers with the link as its owner sees it. */
export const expireChatInviteLinkContract = defineControlOperation({
  operationId: 'expireChatInviteLink',
  method: 'POST',
  path: '/sessions/{sessionId}/supergroups/{chatId}/invite-links/{inviteLinkHash}/expiry',
  params: z.strictObject({
    sessionId: sessionIdParameterSchema,
    chatId: supergroupChatIdSchema,
    inviteLinkHash: inviteLinkHashSchema,
  }),
  success: {
    status: 200,
    body: { kind: 'json', schema: z.strictObject({ invite_link: supergroupInviteLinkSchema }) },
  },
  refusals: {
    400: controlValidationErrorSchema,
    404: controlRefusalSchema(['chat_not_found', 'invite_link_not_found', 'session_not_found']),
    409: controlRefusalSchema(['invite_link_not_expirable']),
  },
});

/**
 * Ends a pending join request's contact window, and answers with the request as the supergroup's
 * owner sees it.
 */
export const expireJoinRequesterContactContract = defineControlOperation({
  operationId: 'expireJoinRequesterContact',
  method: 'POST',
  path:
    '/sessions/{sessionId}/supergroups/{chatId}/join-requests/{userId}/requester-contact/expiry',
  params: supergroupUserPathSchema,
  success: {
    status: 200,
    body: { kind: 'json', schema: z.strictObject({ join_request: supergroupJoinRequestSchema }) },
  },
  refusals: {
    400: controlValidationErrorSchema,
    404: controlRefusalSchema(['chat_not_found', 'join_request_not_found', 'session_not_found']),
    409: controlRefusalSchema(['requester_contact_already_expired']),
  },
});
