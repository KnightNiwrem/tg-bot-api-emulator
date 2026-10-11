/**
 * The contract of a press of a button of the reply keyboard that a bot shows an account in its
 * private chat with the bot or in a supergroup it is a member of.
 */
import { z } from 'zod';

import { accountPathSchema } from './accounts.ts';
import { controlRefusalSchema, controlValidationErrorSchema } from './control_errors.ts';
import { accountPollInputSchema, sentChatMessageResponseSchema } from './message_sending.ts';
import { defineControlOperation } from './operation_contract.ts';
import {
  accountLocationInputSchema,
  messageTargetSchema,
  supergroupChatIdSchema,
  telegramUserIdSchema,
} from './wire_fields.ts';

/**
 * A press of a reply keyboard button, by its text, with at most one answer to the button's
 * request, a rule the server checks and refuses as an `invalid_value` issue: the location the
 * account's client reports for a `request_location` button, the users the account chose for a
 * `request_users` button, the supergroup it chose for a `request_chat` button, the poll it created
 * for a `request_poll` button, or the data the Web App of a `web_app` button sends, which must fit
 * in the bytes Telegram allows, which the server checks too. Only a button with that request takes
 * the answer.
 */
const pressReplyKeyboardButtonRequestSchema = z.strictObject({
  chat: messageTargetSchema,
  text: z.string().min(1),
  location: accountLocationInputSchema.optional(),
  shared_user_ids: z.array(telegramUserIdSchema).min(1).optional(),
  shared_chat_id: supergroupChatIdSchema.optional(),
  poll: accountPollInputSchema.optional(),
  web_app_data: z.string().min(1).optional(),
});

/**
 * Presses a button of the reply keyboard the chat shows the account, which sends its text, or what
 * its request asks the client to share, and returns the message it sent as the chat's message
 * history shows it.
 */
export const pressReplyKeyboardButtonContract = defineControlOperation({
  operationId: 'pressReplyKeyboardButton',
  method: 'POST',
  path: '/sessions/{sessionId}/accounts/{accountId}/reply-keyboard-presses',
  params: accountPathSchema,
  body: { required: true, schema: pressReplyKeyboardButtonRequestSchema },
  success: {
    status: 201,
    body: { kind: 'json', schema: sentChatMessageResponseSchema },
    actionReceipt: 'before_action',
  },
  refusals: {
    // A press the keyboard or its request refuses is input the schema accepts but the server
    // refuses.
    400: z.union([
      controlValidationErrorSchema,
      controlRefusalSchema([
        'bot_administrator_rights_missing',
        'bot_not_member',
        'caption_too_long',
        'message_text_empty',
        'message_text_too_long',
        'poll_has_too_many_options',
        'poll_option_too_long',
        'poll_options_missing',
        'poll_question_too_long',
        'quiz_correct_option_not_found',
        'quiz_correct_options_missing',
        'quiz_correct_options_not_increasing',
        'quiz_explanation_has_too_many_line_feeds',
        'quiz_explanation_too_long',
        'reply_keyboard_button_ambiguous',
        'reply_keyboard_button_answer_missing',
        'reply_keyboard_button_answer_not_requested',
        'reply_keyboard_button_not_found',
        'reply_keyboard_button_request_unsupported',
        'reply_message_not_found',
        'requested_poll_type_mismatch',
        'shared_chat_not_created',
        'shared_chat_username_mismatch',
        'shared_user_kind_mismatch',
        'shared_users_duplicated',
        'shared_users_too_few',
        'shared_users_too_many',
        'text_invalid',
        'user_administrator_rights_missing',
      ]),
    ]),
    403: controlRefusalSchema([
      'not_a_member',
      'send_permission_missing',
      'shared_chat_not_joined',
    ]),
    404: controlRefusalSchema([
      'account_not_found',
      'bot_not_found',
      'chat_not_found',
      'session_not_found',
      'shared_chat_not_found',
      'shared_user_not_found',
    ]),
    409: controlRefusalSchema(['account_phone_number_missing', 'bot_blocked']),
  },
});
