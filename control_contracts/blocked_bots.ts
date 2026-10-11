/**
 * The contracts of the bots an account blocks: Telegram calls blocking a bot stopping it. While
 * the account blocks the bot, the bot's messages and chat actions to the account fail, and the
 * account cannot write to the bot.
 */
import { accountPrivateChatPathSchema } from './accounts.ts';
import { controlRefusalSchema, controlValidationErrorSchema } from './control_errors.ts';
import { defineControlOperation } from './operation_contract.ts';

/** A missing session, account, or bot. */
const blockedBotRefusals = {
  400: controlValidationErrorSchema,
  404: controlRefusalSchema(['account_not_found', 'bot_not_found', 'session_not_found']),
};

/**
 * Blocks the bot as the account; the bot receives a `my_chat_member` update in which its
 * membership changes from `member` to `kicked`. Blocking a blocked bot changes nothing.
 */
export const blockBotContract = defineControlOperation({
  operationId: 'blockBot',
  method: 'PUT',
  path: '/sessions/{sessionId}/accounts/{accountId}/blocked-bots/{botId}',
  params: accountPrivateChatPathSchema,
  success: { status: 204, body: { kind: 'empty' }, actionReceipt: 'before_action' },
  refusals: blockedBotRefusals,
});

/**
 * Unblocks the bot as the account; the bot receives a `my_chat_member` update in which its
 * membership changes from `kicked` back to `member`. Unblocking a bot that is not blocked changes
 * nothing.
 */
export const unblockBotContract = defineControlOperation({
  operationId: 'unblockBot',
  method: 'DELETE',
  path: '/sessions/{sessionId}/accounts/{accountId}/blocked-bots/{botId}',
  params: accountPrivateChatPathSchema,
  success: { status: 204, body: { kind: 'empty' }, actionReceipt: 'before_action' },
  refusals: blockedBotRefusals,
});
