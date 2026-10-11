/**
 * The contracts of the callback queries an account creates by pressing callback buttons, and that
 * it reads with the bot's answer.
 */
import { z } from 'zod';

import { accountPathSchema } from './accounts.ts';
import { controlRefusalSchema, controlValidationErrorSchema } from './control_errors.ts';
import { defineControlOperation } from './operation_contract.ts';
import { createdResourceHeadersSchema, messageTargetSchema } from './wire_fields.ts';

/** The callback button to press, on a bot message of a chat of the account. */
const pressCallbackButtonRequestSchema = z.strictObject({
  chat: messageTargetSchema,
  /** The ID of the message carrying the button, as message history shows it. */
  message_id: z.int().min(1),
  /** The callback data of the button to press, in the inline keyboard or the rich message. */
  callback_data: z.string().min(1),
  /**
   * Creates the query already expired: the bot still receives it but cannot answer it, as when a
   * bot that was offline catches up on queries whose answer deadline has passed. Defaults to
   * `false`.
   */
  expired: z.boolean().default(false),
});

/** The bot's answer to a callback query. */
const callbackQueryAnswerSchema = z.strictObject({
  /** Omitted when the answer shows no notification. */
  text: z.string().optional(),
  show_alert: z.boolean(),
  /** The link that starts the bot, which the client opens; omitted when the answer has none. */
  url: z.string().min(1).optional(),
  cache_time: z.int().min(0),
});

/** A callback button press by an account, with the bot's answer once it has answered. */
const callbackQuerySchema = z.strictObject({
  /** The identifier the bot receives in its `callback_query` update. */
  id: z.string().min(1),
  callback_data: z.string(),
  /**
   * Whether the bot can still answer the query: a query is created awaiting an answer or already
   * expired, and the bot's accepted answer moves an awaiting query to answered.
   */
  status: z.enum(['awaiting_answer', 'answered', 'expired']),
  /** The bot's answer when `status` is `answered`, and `null` otherwise. */
  answer: z.union([callbackQueryAnswerSchema, z.null()]),
});

const callbackQueryResponseSchema = z.strictObject({ callback_query: callbackQuerySchema });

/**
 * Presses the callback button with the given data on a bot message of the account's private chat
 * with the bot, or of a supergroup the account is a member of, creating a callback query.
 */
export const pressCallbackButtonContract = defineControlOperation({
  operationId: 'pressCallbackButton',
  method: 'POST',
  path: '/sessions/{sessionId}/accounts/{accountId}/callback-queries',
  params: accountPathSchema,
  body: { required: true, schema: pressCallbackButtonRequestSchema },
  success: {
    status: 201,
    headers: createdResourceHeadersSchema,
    body: { kind: 'json', schema: callbackQueryResponseSchema },
    actionReceipt: 'before_action',
  },
  refusals: {
    // A message without the pressed button is input the schema accepts but the server refuses.
    400: z.union([
      controlValidationErrorSchema,
      controlRefusalSchema(['callback_button_not_found']),
    ]),
    403: controlRefusalSchema(['not_a_member']),
    404: controlRefusalSchema([
      'account_not_found',
      'bot_not_found',
      'chat_not_found',
      'message_not_found',
      'session_not_found',
    ]),
  },
});

/** Returns a callback query the account created, with the bot's answer once given. */
export const getCallbackQueryContract = defineControlOperation({
  operationId: 'getCallbackQuery',
  method: 'GET',
  path: '/sessions/{sessionId}/accounts/{accountId}/callback-queries/{callbackQueryId}',
  params: accountPathSchema.extend({ callbackQueryId: z.string() }),
  success: { status: 200, body: { kind: 'json', schema: callbackQueryResponseSchema } },
  refusals: {
    400: controlValidationErrorSchema,
    404: controlRefusalSchema(['callback_query_not_found', 'session_not_found']),
  },
});
