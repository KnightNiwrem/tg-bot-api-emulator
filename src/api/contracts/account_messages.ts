/**
 * The contracts of the messages of an account's private chat with a bot: reading them as the bot
 * sees them, and editing and deleting them as the account.
 */
import { z } from 'zod';

import { accountPrivateChatPathSchema, accountPrivateMessagePathSchema } from './accounts.ts';
import { privateMessageSchema } from './chat_messages.ts';
import { controlRefusalSchema, controlValidationErrorSchema } from './control_errors.ts';
import { defineControlOperation } from './operation_contract.ts';

/** The most characters of a text message, counted by code point, as Telegram limits them. */
export const MAX_MESSAGE_TEXT_LENGTH = 4096;

/**
 * An entity an account specifies, as a Bot API `MessageEntity` a bot specifies, with the fields
 * any type of entity has. The server reads it as the official Bot API server's `get_text_entity`
 * does, refusing one Telegram cannot read as an `invalid_value` issue, and ignores the types
 * Telegram detects by itself, so that entities of a received message can be sent back. A text
 * mention's user is read by its ID alone, which must name a user of the session.
 */
export const messageEntityInputSchema = z.strictObject({
  type: z.string(),
  offset: z.int(),
  length: z.int(),
  language: z.string().optional(),
  url: z.string().optional(),
  user: z.looseObject({ id: z.int() }).optional(),
  custom_emoji_id: z.string().optional(),
  unix_time: z.int().optional(),
  date_time_format: z.string().optional(),
});

/**
 * New text for the account's text message, or a new caption for its captioned media, which must
 * differ from the current one once normalized; an empty caption removes it.
 */
const editAccountMessageRequestSchema = z.union([
  z.strictObject({
    text: z.string().min(1).max(MAX_MESSAGE_TEXT_LENGTH),
    entities: z.array(messageEntityInputSchema).optional(),
  }),
  z.strictObject({
    caption: z.string(),
    caption_entities: z.array(messageEntityInputSchema).optional(),
  }),
]);

/** A missing session, account, bot, or message of their private chat. */
const privateMessageNotFoundSchema = controlRefusalSchema([
  'account_not_found',
  'bot_not_found',
  'message_not_found',
  'session_not_found',
]);

/**
 * Returns the messages either participant of the account's private chat with a bot wrote, oldest
 * first, as the bot sees them.
 */
export const getPrivateMessageHistoryContract = defineControlOperation({
  operationId: 'getPrivateMessageHistory',
  method: 'GET',
  path: '/sessions/{sessionId}/accounts/{accountId}/conversations/private/{botId}/messages',
  params: accountPrivateChatPathSchema,
  success: {
    status: 200,
    body: { kind: 'json', schema: z.strictObject({ messages: z.array(privateMessageSchema) }) },
  },
  refusals: {
    400: controlValidationErrorSchema,
    404: controlRefusalSchema(['account_not_found', 'bot_not_found', 'session_not_found']),
  },
});

/**
 * Replaces the text of the account's text message, or the caption of its captioned media, of its
 * private chat with a bot, and returns the edited message as the bot sees it.
 */
export const editAccountMessageContract = defineControlOperation({
  operationId: 'editAccountMessage',
  method: 'PATCH',
  path:
    '/sessions/{sessionId}/accounts/{accountId}/conversations/private/{botId}/messages/{messageId}',
  params: accountPrivateMessagePathSchema,
  body: { required: true, schema: editAccountMessageRequestSchema },
  success: {
    status: 200,
    body: { kind: 'json', schema: z.strictObject({ message: privateMessageSchema }) },
    actionReceipt: 'before_action',
  },
  refusals: {
    // Text Telegram's normalization refuses, or an edit the message does not take, is input the
    // schema accepts but the server refuses.
    400: z.union([
      controlValidationErrorSchema,
      controlRefusalSchema([
        'caption_too_long',
        'message_has_no_caption',
        'message_has_no_text',
        'message_not_editable',
        'message_not_modified',
        'message_text_empty',
        'message_text_too_long',
        'text_invalid',
      ]),
    ]),
    404: privateMessageNotFoundSchema,
  },
});

/** Deletes a message of the account's private chat with a bot for both participants. */
export const deleteAccountMessageContract = defineControlOperation({
  operationId: 'deleteAccountMessage',
  method: 'DELETE',
  path:
    '/sessions/{sessionId}/accounts/{accountId}/conversations/private/{botId}/messages/{messageId}',
  params: accountPrivateMessagePathSchema,
  success: { status: 204, body: { kind: 'empty' }, actionReceipt: 'before_action' },
  refusals: { 400: controlValidationErrorSchema, 404: privateMessageNotFoundSchema },
});
