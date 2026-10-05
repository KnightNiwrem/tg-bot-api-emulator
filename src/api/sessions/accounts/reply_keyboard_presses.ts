import { Hono } from 'hono';
import { z } from 'zod';

import type { ReplyKeyboardRequestAnswer } from '../../../types/reply_interface.ts';
import { readJsonRequestBody } from '../json_request_body.ts';
import type { SessionRouteContextTypes } from '../session_route_context_types.ts';
import { ACCOUNT_ID_PARAMETER, accountPathSchema } from './account_paths.ts';
import {
  accountMessageFailureStatus,
  supergroupMemberFailureStatus,
} from './messaging_failure_statuses.ts';
import {
  accountLocationSchema,
  accountPollSchema,
  chatSchema,
  supergroupChatIdSchema,
  telegramUserIdSchema,
} from './request_fields.ts';

const REPLY_KEYBOARD_PRESS_COLLECTION_PATH =
  `/:${ACCOUNT_ID_PARAMETER}/reply-keyboard-presses` as const;

/**
 * A press of a reply keyboard button, by its text, with at most one answer to the button's
 * request: the location the account's client reports for a `request_location` button, the users
 * the account chose for a `request_users` button, the supergroup it chose for a `request_chat`
 * button, or the poll it created for a `request_poll` button. Only a button with that request
 * takes the answer.
 */
const pressReplyKeyboardButtonRequestSchema = z.strictObject({
  chat: chatSchema,
  text: z.string().min(1),
  location: accountLocationSchema.optional(),
  shared_user_ids: z.array(telegramUserIdSchema).min(1).optional(),
  shared_chat_id: supergroupChatIdSchema.optional(),
  poll: accountPollSchema.optional(),
}).transform(({ chat, text, location, shared_user_ids, shared_chat_id, poll }, context) => {
  const answers: ReplyKeyboardRequestAnswer[] = [
    ...(location === undefined ? [] : [{ kind: 'location' as const, location }]),
    ...(shared_user_ids === undefined
      ? []
      : [{ kind: 'users' as const, userIds: shared_user_ids }]),
    ...(shared_chat_id === undefined ? [] : [{ kind: 'chat' as const, chatId: shared_chat_id }]),
    ...(poll === undefined ? [] : [{ kind: 'poll' as const, poll }]),
  ];
  if (answers.length > 1) {
    context.addIssue({ code: 'custom', message: 'A press answers at most one request' });
    return z.NEVER;
  }
  const [answer] = answers;
  return { chat, text, ...(answer === undefined ? {} : { answer }) };
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
    const { chat, text, answer } = requestBody;
    if (chat.type === 'supergroup') {
      // Only private chats show buttons with a request, so no supergroup button takes an answer.
      if (answer !== undefined) {
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
      ...(answer === undefined ? {} : { answer }),
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
