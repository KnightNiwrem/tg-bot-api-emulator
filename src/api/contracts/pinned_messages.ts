/**
 * The contracts of the pinned messages of an account's private chat with a bot: reading them as
 * the bot sees them, and pinning and unpinning a message as the account.
 */
import { z } from 'zod';

import { accountPrivateChatPathSchema, accountPrivateMessagePathSchema } from './accounts.ts';
import { privateMessageSchema } from './chat_messages.ts';
import { controlRefusalSchema, controlValidationErrorSchema } from './control_errors.ts';
import { defineControlOperation } from './operation_contract.ts';

/** A service message, which no chat pins, or a request that breaks its contract. */
const pinChangeRejectionSchema = z.union([
  controlValidationErrorSchema,
  controlRefusalSchema(['service_message_not_pinnable']),
]);

/** A missing session, account, bot, or message of their private chat. */
const pinnedPrivateMessageNotFoundSchema = controlRefusalSchema([
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
    404: pinnedPrivateMessageNotFoundSchema,
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
    404: pinnedPrivateMessageNotFoundSchema,
    409: controlRefusalSchema(['bot_blocked', 'message_not_pinned']),
  },
});
