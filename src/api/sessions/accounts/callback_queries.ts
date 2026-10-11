import { Hono } from 'hono';
import { basePath } from 'hono/route';

import {
  getCallbackQueryContract,
  pressCallbackButtonContract,
} from '../../../../control_contracts/callback_queries.ts';
import type { ControlOperationRefusal } from '../../../../control_contracts/operation_contract.ts';
import type { CallbackQuery } from '../../../types/callback_query.ts';
import type { EmulationSession } from '../../../types/emulation_session.ts';
import { registerControlOperation } from '../../control_operation_route.ts';
import type { SessionRouteContextTypes } from '../session_route_context_types.ts';

/** Where the account routes are mounted within the server, as a contract path template. */
const ACCOUNT_COLLECTION_MOUNT_PATH = '/sessions/{sessionId}/accounts';

/**
 * Routes through which an account presses inline keyboard callback buttons and reads the callback
 * queries a press creates, with the bot's answer.
 */
export function createCallbackQueryRoutes(): Hono<SessionRouteContextTypes> {
  const accountRoutes = new Hono<SessionRouteContextTypes>();

  registerControlOperation(
    accountRoutes,
    ACCOUNT_COLLECTION_MOUNT_PATH,
    pressCallbackButtonContract,
    ({ params: { accountId }, body }, context) => {
      const result = context.get('emulationSession').callbackQueries.pressCallbackButton({
        fromAccountId: accountId,
        chat: body.chat,
        messageId: body.message_id,
        callbackData: body.callback_data,
        expired: body.expired,
      });
      if (!result.pressed) {
        return refuseCallbackButtonPress(result.reason);
      }
      return {
        status: 201,
        headers: {
          Location: `${basePath(context)}/${accountId}/callback-queries/${result.callbackQuery.id}`,
        },
        body: { callback_query: presentCallbackQueryForAccount(result.callbackQuery) },
      };
    },
  );

  registerControlOperation(
    accountRoutes,
    ACCOUNT_COLLECTION_MOUNT_PATH,
    getCallbackQueryContract,
    ({ params: { accountId, callbackQueryId } }, context) => {
      const callbackQuery = context.get('emulationSession').callbackQueries
        .getAccountCallbackQuery({ accountId, callbackQueryId });
      return callbackQuery === undefined
        ? { status: 404, body: { reason: 'callback_query_not_found' } }
        : { status: 200, body: { callback_query: presentCallbackQueryForAccount(callbackQuery) } };
    },
  );

  return accountRoutes;
}

/**
 * A message without the pressed button rejects the request; a supergroup the account is not a
 * member of is forbidden; a missing account, bot, chat, or message is not found.
 */
function refuseCallbackButtonPress(
  reason: Extract<
    ReturnType<EmulationSession['callbackQueries']['pressCallbackButton']>,
    { readonly pressed: false }
  >['reason'],
): ControlOperationRefusal<typeof pressCallbackButtonContract> {
  switch (reason) {
    case 'callback_button_not_found':
      return { status: 400, body: { reason } };
    case 'not_a_member':
      return { status: 403, body: { reason } };
    case 'account_not_found':
    case 'bot_not_found':
    case 'chat_not_found':
    case 'message_not_found':
      return { status: 404, body: { reason } };
    default: {
      const unhandledReason: never = reason;
      throw new Error(`Unhandled callback button press failure: ${unhandledReason}`);
    }
  }
}

/** Shows a callback query to the account that created it, with the bot's answer once given. */
function presentCallbackQueryForAccount({ id, callbackData, state }: CallbackQuery) {
  return {
    id,
    callback_data: callbackData,
    status: state.status,
    answer: state.status !== 'answered' ? null : {
      ...(state.answer.text === undefined ? {} : { text: state.answer.text }),
      show_alert: state.answer.showAlert,
      ...(state.answer.url === undefined ? {} : { url: state.answer.url }),
      cache_time: state.answer.cacheTimeSeconds,
    },
  };
}
