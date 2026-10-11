import { Hono } from 'hono';

import {
  expirePrivateChatActionContract,
  getPrivateChatActionsContract,
} from '../../contracts/chat_actions.ts';
import type { EmulationSession } from '../../../session/emulation_session.ts';
import type { VisibleChatAction } from '../../../types/virtual_chat.ts';
import {
  controlErrorResponse,
  invalidControlRequestResponse,
} from '../../control_error_response.ts';
import { registerControlOperation } from '../../control_operation_route.ts';
import { answerWithActionReceipt } from '../action_receipt.ts';
import { readPathParameters } from '../control_request_input.ts';
import type { SessionRouteContextTypes } from '../session_route_context_types.ts';
import {
  BOT_ID_PARAMETER,
  SUPERGROUP_CONVERSATION_PATH,
  supergroupBotPathSchema,
  supergroupConversationPathSchema,
} from './account_paths.ts';

/** Where the account routes are mounted within the server, as a contract path template. */
const ACCOUNT_COLLECTION_MOUNT_PATH = '/sessions/{sessionId}/accounts';

const SUPERGROUP_CHAT_ACTIONS_PATH = `${SUPERGROUP_CONVERSATION_PATH}/chat-actions` as const;
const SUPERGROUP_CHAT_ACTION_EXPIRY_PATH =
  `${SUPERGROUP_CHAT_ACTIONS_PATH}/:${BOT_ID_PARAMETER}/expiry` as const;

type ChatActions = EmulationSession['chatActions'];

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

  accountRoutes.get(SUPERGROUP_CHAT_ACTIONS_PATH, (context) => {
    const conversationPath = readPathParameters(
      supergroupConversationPathSchema,
      context.req.param(),
    );
    if (!conversationPath.valid) {
      return invalidControlRequestResponse(context, conversationPath.issues);
    }
    const result = context.get('emulationSession').chatActions.getSupergroupChatActions(
      conversationPath.value,
    );
    return result.found
      ? context.json({ chat_actions: result.chatActions.map(presentChatActionForAccount) })
      : controlErrorResponse(context, chatActionFailureStatus(result.reason), result.reason);
  });

  accountRoutes.post(SUPERGROUP_CHAT_ACTION_EXPIRY_PATH, (context) => {
    const botPath = readPathParameters(supergroupBotPathSchema, context.req.param());
    if (!botPath.valid) {
      return invalidControlRequestResponse(context, botPath.issues);
    }
    return answerWithActionReceipt(context, ({ chatActions }) => {
      const result = chatActions.expireSupergroupChatAction(
        botPath.value,
      );
      return result.expired
        ? context.body(null, 204)
        : controlErrorResponse(context, chatActionFailureStatus(result.reason), result.reason);
    });
  });

  return accountRoutes;
}

/** Shows a chat action as the account's client shows it: the bot and what it is doing. */
function presentChatActionForAccount({ botId, action }: VisibleChatAction) {
  return { bot_id: botId, action };
}

/**
 * A supergroup the account is not a member of is forbidden; an unknown account, bot or chat, or a
 * bot that shows no action, is not found.
 */
function chatActionFailureStatus(
  reason:
    | Extract<ReturnType<ChatActions['getSupergroupChatActions']>, { found: false }>['reason']
    | Extract<ReturnType<ChatActions['expireSupergroupChatAction']>, { expired: false }>['reason'],
): 403 | 404 {
  switch (reason) {
    case 'not_a_member':
      return 403;
    case 'account_not_found':
    case 'bot_not_found':
    case 'chat_not_found':
    case 'chat_action_not_found':
      return 404;
    default: {
      const unhandledReason: never = reason;
      throw new Error(`Unhandled chat action failure: ${unhandledReason}`);
    }
  }
}
