import { Hono } from 'hono';

import {
  expirePrivateChatActionContract,
  expireSupergroupChatActionContract,
  getPrivateChatActionsContract,
  getSupergroupChatActionsContract,
} from '../../contracts/chat_actions.ts';
import type { VisibleChatAction } from '../../../types/virtual_chat.ts';
import { registerControlOperation } from '../../control_operation_route.ts';
import type { SessionRouteContextTypes } from '../session_route_context_types.ts';

/** Where the account routes are mounted within the server, as a contract path template. */
const ACCOUNT_COLLECTION_MOUNT_PATH = '/sessions/{sessionId}/accounts';

/**
 * Routes through which an account reads the chat actions, such as typing, that bots show in its
 * private chat with a bot or in a supergroup, and through which a test expires one, as Telegram's
 * clients stop showing an action 5.5 seconds after the bot last sent it.
 */
export function createChatActionRoutes(): Hono<SessionRouteContextTypes> {
  const accountRoutes = new Hono<SessionRouteContextTypes>();

  registerControlOperation(
    accountRoutes,
    ACCOUNT_COLLECTION_MOUNT_PATH,
    getPrivateChatActionsContract,
    ({ params: { accountId, botId } }, context) => {
      const result = context.get('emulationSession').chatActions.getPrivateChatActions({
        accountId,
        botId,
      });
      if (result.found) {
        return {
          status: 200,
          body: { chat_actions: result.chatActions.map(presentChatActionForAccount) },
        };
      }
      // Only a supergroup has members; a private chat never refuses an account as one.
      if (result.reason === 'not_a_member') {
        throw new Error(`A private chat refused its chat actions as ${result.reason}`);
      }
      return { status: 404, body: { reason: result.reason } };
    },
  );

  registerControlOperation(
    accountRoutes,
    ACCOUNT_COLLECTION_MOUNT_PATH,
    expirePrivateChatActionContract,
    ({ params: { accountId, botId } }, context) => {
      const result = context.get('emulationSession').chatActions.expirePrivateChatAction({
        accountId,
        botId,
      });
      if (result.expired) {
        return { status: 204 };
      }
      if (result.reason === 'not_a_member') {
        throw new Error(`A private chat refused a chat action expiry as ${result.reason}`);
      }
      return { status: 404, body: { reason: result.reason } };
    },
  );

  // A supergroup the account is not a member of is forbidden; an unknown account, bot or chat, or
  // a bot that shows no action, is not found.
  registerControlOperation(
    accountRoutes,
    ACCOUNT_COLLECTION_MOUNT_PATH,
    getSupergroupChatActionsContract,
    ({ params: { accountId, chatId } }, context) => {
      const result = context.get('emulationSession').chatActions.getSupergroupChatActions({
        accountId,
        chatId,
      });
      if (result.found) {
        return {
          status: 200,
          body: { chat_actions: result.chatActions.map(presentChatActionForAccount) },
        };
      }
      return result.reason === 'not_a_member'
        ? { status: 403, body: { reason: result.reason } }
        : { status: 404, body: { reason: result.reason } };
    },
  );

  registerControlOperation(
    accountRoutes,
    ACCOUNT_COLLECTION_MOUNT_PATH,
    expireSupergroupChatActionContract,
    ({ params: { accountId, chatId, botId } }, context) => {
      const result = context.get('emulationSession').chatActions.expireSupergroupChatAction({
        accountId,
        chatId,
        botId,
      });
      if (result.expired) {
        return { status: 204 };
      }
      return result.reason === 'not_a_member'
        ? { status: 403, body: { reason: result.reason } }
        : { status: 404, body: { reason: result.reason } };
    },
  );

  return accountRoutes;
}

/** Shows a chat action as the account's client shows it: the bot and what it is doing. */
function presentChatActionForAccount({ botId, action }: VisibleChatAction) {
  return { bot_id: botId, action };
}
