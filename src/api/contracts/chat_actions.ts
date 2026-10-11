/**
 * The contracts of the chat actions, such as typing, that bots show an account in its private chat
 * with a bot, and of the test control that expires one, as Telegram's clients stop showing an
 * action 5.5 seconds after the bot last sent it.
 */
import { z } from 'zod';

import { accountPrivateChatPathSchema } from './accounts.ts';
import { controlRefusalSchema, controlValidationErrorSchema } from './control_errors.ts';
import { defineControlOperation } from './operation_contract.ts';
import { telegramUserIdSchema } from './wire_fields.ts';

/** The actions a bot shows, by their lowercase Bot API names; `cancel` shows none. */
export const SHOWN_CHAT_ACTIONS = [
  'typing',
  'record_video',
  'upload_video',
  'record_voice',
  'upload_voice',
  'upload_photo',
  'upload_document',
  'choose_sticker',
  'find_location',
  'record_video_note',
  'upload_video_note',
] as const;

/** What a bot shows it is doing in a chat, by the Bot API's lowercase action name. */
const chatActionSchema = z.strictObject({
  bot_id: telegramUserIdSchema,
  action: z.enum(SHOWN_CHAT_ACTIONS),
});

/** The chat actions bots show in a chat of the account. */
export const chatActionsResponseSchema = z.strictObject({
  chat_actions: z.array(chatActionSchema),
});

/** Returns the chat action the bot shows in its private chat with the account, if any. */
export const getPrivateChatActionsContract = defineControlOperation({
  operationId: 'getPrivateChatActions',
  method: 'GET',
  path: '/sessions/{sessionId}/accounts/{accountId}/conversations/private/{botId}/chat-actions',
  params: accountPrivateChatPathSchema,
  success: {
    status: 200,
    body: { kind: 'json', schema: chatActionsResponseSchema },
  },
  refusals: {
    400: controlValidationErrorSchema,
    404: controlRefusalSchema([
      'account_not_found',
      'bot_not_found',
      'chat_not_found',
      'session_not_found',
    ]),
  },
});

/** Stops showing the chat action the bot shows in its private chat with the account. */
export const expirePrivateChatActionContract = defineControlOperation({
  operationId: 'expirePrivateChatAction',
  method: 'POST',
  path:
    '/sessions/{sessionId}/accounts/{accountId}/conversations/private/{botId}/chat-actions/expiry',
  params: accountPrivateChatPathSchema,
  success: { status: 204, body: { kind: 'empty' }, actionReceipt: 'before_action' },
  refusals: {
    400: controlValidationErrorSchema,
    404: controlRefusalSchema([
      'account_not_found',
      'bot_not_found',
      'chat_action_not_found',
      'chat_not_found',
      'session_not_found',
    ]),
  },
});
