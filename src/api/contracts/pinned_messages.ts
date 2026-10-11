/**
 * The contracts of the pinned messages of an account's private chat with a bot, or of a
 * supergroup it is a member of: reading them as its message history shows them, and pinning and
 * unpinning a message as the account.
 */
import { z } from 'zod';

import { accountPrivateChatPathSchema, accountPrivateMessagePathSchema } from './accounts.ts';
import { privateMessageSchema, supergroupMessageSchema } from './chat_messages.ts';
import { controlRefusalSchema, controlValidationErrorSchema } from './control_errors.ts';
import { defineControlOperation } from './operation_contract.ts';
import { accountSupergroupMessagePathSchema, accountSupergroupPathSchema } from './supergroups.ts';

/** A service message, which no chat pins, or a request that breaks its contract. */
const pinChangeRejectionSchema = z.union([
  controlValidationErrorSchema,
  controlRefusalSchema(['service_message_not_pinnable']),
]);

/** A missing session, account, chat, or message of the chat. */
const pinnedMessageNotFoundSchema = controlRefusalSchema([
  'chat_not_found',
  'message_not_found',
  'pinner_not_found',
  'session_not_found',
]);

/**
 * Returns the messages either participant of the account's private chat with a bot pinned,
 * newest first by sending date, as the bot sees them.
 */
export const getPrivatePinnedMessagesContract = defineControlOperation({
  operationId: 'getPrivatePinnedMessages',
  method: 'GET',
  path: '/sessions/{sessionId}/accounts/{accountId}/conversations/private/{botId}/pinned-messages',
  params: accountPrivateChatPathSchema,
  success: {
    status: 200,
    body: { kind: 'json', schema: z.strictObject({ messages: z.array(privateMessageSchema) }) },
  },
  refusals: {
    400: controlValidationErrorSchema,
    404: controlRefusalSchema(['chat_not_found', 'pinner_not_found', 'session_not_found']),
  },
});

/** Pins a message of the account's private chat with a bot, as the account. */
export const pinPrivateMessageContract = defineControlOperation({
  operationId: 'pinPrivateMessage',
  method: 'PUT',
  path:
    '/sessions/{sessionId}/accounts/{accountId}/conversations/private/{botId}/pinned-messages/{messageId}',
  params: accountPrivateMessagePathSchema,
  success: { status: 204, body: { kind: 'empty' }, actionReceipt: 'before_action' },
  refusals: {
    400: pinChangeRejectionSchema,
    404: pinnedMessageNotFoundSchema,
    409: controlRefusalSchema(['bot_blocked', 'message_already_pinned']),
  },
});

/** Unpins a pinned message of the account's private chat with a bot, as the account. */
export const unpinPrivateMessageContract = defineControlOperation({
  operationId: 'unpinPrivateMessage',
  method: 'DELETE',
  path:
    '/sessions/{sessionId}/accounts/{accountId}/conversations/private/{botId}/pinned-messages/{messageId}',
  params: accountPrivateMessagePathSchema,
  success: { status: 204, body: { kind: 'empty' }, actionReceipt: 'before_action' },
  refusals: {
    400: pinChangeRejectionSchema,
    404: pinnedMessageNotFoundSchema,
    409: controlRefusalSchema(['bot_blocked', 'message_not_pinned']),
  },
});

/** An account that is not a member of the supergroup, or may not pin there. */
const supergroupPinForbiddenSchema = controlRefusalSchema(['not_a_member', 'not_enough_rights']);

/**
 * Returns the messages the supergroup pins, newest first by sending date, as the account, a
 * member, sees them.
 */
export const getSupergroupPinnedMessagesContract = defineControlOperation({
  operationId: 'getSupergroupPinnedMessages',
  method: 'GET',
  path:
    '/sessions/{sessionId}/accounts/{accountId}/conversations/supergroup/{chatId}/pinned-messages',
  params: accountSupergroupPathSchema,
  success: {
    status: 200,
    body: { kind: 'json', schema: z.strictObject({ messages: z.array(supergroupMessageSchema) }) },
  },
  refusals: {
    400: controlValidationErrorSchema,
    403: controlRefusalSchema(['not_a_member']),
    404: controlRefusalSchema(['chat_not_found', 'pinner_not_found', 'session_not_found']),
  },
});

/** Pins a message of a supergroup, as a member with the `can_pin_messages` permission. */
export const pinSupergroupMessageContract = defineControlOperation({
  operationId: 'pinSupergroupMessage',
  method: 'PUT',
  path:
    '/sessions/{sessionId}/accounts/{accountId}/conversations/supergroup/{chatId}/pinned-messages/{messageId}',
  params: accountSupergroupMessagePathSchema,
  success: { status: 204, body: { kind: 'empty' }, actionReceipt: 'before_action' },
  refusals: {
    400: pinChangeRejectionSchema,
    403: supergroupPinForbiddenSchema,
    404: pinnedMessageNotFoundSchema,
    409: controlRefusalSchema(['bot_blocked', 'message_already_pinned']),
  },
});

/** Unpins a pinned message of a supergroup, as a member with the `can_pin_messages` permission. */
export const unpinSupergroupMessageContract = defineControlOperation({
  operationId: 'unpinSupergroupMessage',
  method: 'DELETE',
  path:
    '/sessions/{sessionId}/accounts/{accountId}/conversations/supergroup/{chatId}/pinned-messages/{messageId}',
  params: accountSupergroupMessagePathSchema,
  success: { status: 204, body: { kind: 'empty' }, actionReceipt: 'before_action' },
  refusals: {
    400: pinChangeRejectionSchema,
    403: supergroupPinForbiddenSchema,
    404: pinnedMessageNotFoundSchema,
    409: controlRefusalSchema(['bot_blocked', 'message_not_pinned']),
  },
});
