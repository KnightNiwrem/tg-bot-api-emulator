import { Hono } from 'hono';
import { basePath } from 'hono/route';
import { z } from 'zod';

import type { CallbackQuery } from '../../../types/callback_query.ts';
import type { EmulationSession } from '../../../types/emulation_session.ts';
import {
  controlErrorResponse,
  invalidControlRequestResponse,
} from '../../control_error_response.ts';
import { readPathParameters } from '../control_request_input.ts';
import { readJsonRequestBody } from '../json_request_body.ts';
import type { SessionRouteContextTypes } from '../session_route_context_types.ts';
import { ACCOUNT_ID_PARAMETER, accountPathSchema } from './account_paths.ts';
import { chatSchema } from './request_fields.ts';

const CALLBACK_QUERY_ID_PARAMETER = 'callbackQueryId';
const CALLBACK_QUERY_COLLECTION_PATH = `/:${ACCOUNT_ID_PARAMETER}/callback-queries` as const;
const CALLBACK_QUERY_PATH =
  `${CALLBACK_QUERY_COLLECTION_PATH}/:${CALLBACK_QUERY_ID_PARAMETER}` as const;

const pressCallbackButtonRequestSchema = z.strictObject({
  chat: chatSchema,
  /** The message's ID as the chat's bots see it, which is how these routes show messages. */
  message_id: z.int().positive(),
  callback_data: z.string().min(1),
  expired: z.boolean().default(false),
});

/**
 * Routes through which an account presses inline keyboard callback buttons and reads the callback
 * queries a press creates, with the bot's answer.
 */
export function createCallbackQueryRoutes(): Hono<SessionRouteContextTypes> {
  const accountRoutes = new Hono<SessionRouteContextTypes>();

  accountRoutes.post(CALLBACK_QUERY_COLLECTION_PATH, async (context) => {
    const accountPath = readPathParameters(accountPathSchema, context.req.param());
    if (!accountPath.valid) {
      return invalidControlRequestResponse(context, accountPath.issues);
    }
    const { accountId } = accountPath.value;

    const requestBodyReading = await readJsonRequestBody(
      context.req,
      pressCallbackButtonRequestSchema,
    );
    if (!requestBodyReading.valid) {
      return invalidControlRequestResponse(context, requestBodyReading.issues);
    }
    const requestBody = requestBodyReading.value;

    const result = context.get('emulationSession').callbackQueries.pressCallbackButton({
      fromAccountId: accountId,
      chat: requestBody.chat,
      messageId: requestBody.message_id,
      callbackData: requestBody.callback_data,
      expired: requestBody.expired,
    });
    if (!result.pressed) {
      return controlErrorResponse(
        context,
        callbackButtonPressFailureStatus(result.reason),
        result.reason,
      );
    }

    const callbackQueryPath = `${
      basePath(context)
    }/${accountId}/callback-queries/${result.callbackQuery.id}`;
    return context.json(
      { callback_query: presentCallbackQueryForAccount(result.callbackQuery) },
      201,
      { Location: callbackQueryPath },
    );
  });

  accountRoutes.get(CALLBACK_QUERY_PATH, (context) => {
    const accountPath = readPathParameters(accountPathSchema, context.req.param());
    if (!accountPath.valid) {
      return invalidControlRequestResponse(context, accountPath.issues);
    }
    const { accountId } = accountPath.value;

    const callbackQuery = context.get('emulationSession').callbackQueries.getAccountCallbackQuery({
      accountId,
      callbackQueryId: context.req.param(CALLBACK_QUERY_ID_PARAMETER),
    });
    if (callbackQuery === undefined) {
      return controlErrorResponse(context, 404, 'callback_query_not_found');
    }
    return context.json({ callback_query: presentCallbackQueryForAccount(callbackQuery) });
  });

  return accountRoutes;
}

/**
 * A message without the pressed button rejects the request; a supergroup the account is not a
 * member of is forbidden; a missing account, bot, chat, or message is not found.
 */
function callbackButtonPressFailureStatus(
  reason: Extract<
    ReturnType<EmulationSession['callbackQueries']['pressCallbackButton']>,
    { readonly pressed: false }
  >['reason'],
): 400 | 403 | 404 {
  switch (reason) {
    case 'callback_button_not_found':
      return 400;
    case 'not_a_member':
      return 403;
    case 'account_not_found':
    case 'bot_not_found':
    case 'chat_not_found':
    case 'message_not_found':
      return 404;
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
