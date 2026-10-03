import { Hono } from 'hono';
import { z } from 'zod';

import { readJsonRequestBody } from '../json_request_body.ts';
import type { SessionRouteContextTypes } from '../session_route_context_types.ts';
import { ACCOUNT_ID_PARAMETER, accountPathSchema } from './account_paths.ts';
import {
  accountMessageFailureStatus,
  supergroupMemberFailureStatus,
} from './messaging_failure_statuses.ts';
import { accountLocationSchema, chatSchema } from './request_fields.ts';

const REPLY_KEYBOARD_PRESS_COLLECTION_PATH =
  `/:${ACCOUNT_ID_PARAMETER}/reply-keyboard-presses` as const;

/**
 * A press of a reply keyboard button, by its text. A `request_location` button needs the location
 * the account's client reports, which no other button takes.
 */
const pressReplyKeyboardButtonRequestSchema = z.strictObject({
  chat: chatSchema,
  text: z.string().min(1),
  location: accountLocationSchema.optional(),
});

/** Routes through which an account presses the buttons of the reply keyboard a bot shows it. */
export function createReplyKeyboardPressRoutes(): Hono<SessionRouteContextTypes> {
  const accountRoutes = new Hono<SessionRouteContextTypes>();

  accountRoutes.post(REPLY_KEYBOARD_PRESS_COLLECTION_PATH, async (context) => {
    const accountPath = accountPathSchema.safeParse(context.req.param());
    if (!accountPath.success) {
      return context.body(null, 400);
    }
    const { accountId } = accountPath.data;

    const requestBody = await readJsonRequestBody(
      context.req,
      pressReplyKeyboardButtonRequestSchema,
    );
    if (requestBody === undefined) {
      return context.body(null, 400);
    }

    const { privateMessaging, supergroupMessaging, botMessageViews } = context.get(
      'emulationSession',
    );
    const { chat, text, location } = requestBody;
    if (chat.type === 'supergroup') {
      // Only private chats show buttons with a request, so no supergroup button takes a location.
      if (location !== undefined) {
        return context.body(null, 400);
      }
      const result = supergroupMessaging.pressReplyKeyboardButton({
        fromAccountId: accountId,
        chatId: chat.chatId,
        text,
      });
      if (!result.sent) {
        return context.body(null, supergroupMemberFailureStatus(result.reason));
      }
      return context.json(
        { message: botMessageViews.viewSupergroupMessage(result.message, accountId) },
        201,
      );
    }
    const result = privateMessaging.pressReplyKeyboardButton({
      fromAccountId: accountId,
      chat,
      text,
      ...(location === undefined ? {} : { location }),
    });
    if (!result.sent) {
      return context.body(null, accountMessageFailureStatus(result.reason));
    }
    return context.json(
      { message: botMessageViews.viewPrivateMessageForBot(result.message) },
      201,
    );
  });

  return accountRoutes;
}
