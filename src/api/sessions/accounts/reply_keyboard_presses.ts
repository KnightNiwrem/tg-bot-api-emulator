import { Hono } from 'hono';

import { INVALID_REQUEST_REASON } from '../../contracts/control_errors.ts';
import type {
  ControlOperationRefusal,
  DecodedControlRequest,
} from '../../contracts/operation_contract.ts';
import { pressReplyKeyboardButtonContract } from '../../contracts/reply_keyboard_presses.ts';
import type { EmulationSession } from '../../../session/emulation_session.ts';
import {
  isSendableWebAppData,
  type ReplyKeyboardRequestAnswer,
} from '../../../types/reply_interface.ts';
import { registerControlOperation } from '../../control_operation_route.ts';
import type { SessionRouteContextTypes } from '../session_route_context_types.ts';
import {
  type AccountInputReading,
  readAccountLocation,
  readAccountPoll,
} from './account_message_input.ts';

/** Where the account routes are mounted within the server, as a contract path template. */
const ACCOUNT_COLLECTION_MOUNT_PATH = '/sessions/{sessionId}/accounts';

type ReplyInterfaces = EmulationSession['replyInterfaces'];
type PressRequest = DecodedControlRequest<typeof pressReplyKeyboardButtonContract>['body'];
type PressRefusal = ControlOperationRefusal<typeof pressReplyKeyboardButtonContract>;

/** Routes through which an account presses the buttons of the reply keyboard a bot shows it. */
export function createReplyKeyboardPressRoutes(): Hono<SessionRouteContextTypes> {
  const accountRoutes = new Hono<SessionRouteContextTypes>();

  registerControlOperation(
    accountRoutes,
    ACCOUNT_COLLECTION_MOUNT_PATH,
    pressReplyKeyboardButtonContract,
    ({ params: { accountId }, body }, context) => {
      const answerReading = readPressAnswer(body);
      if (!answerReading.read) {
        return {
          status: 400,
          body: { reason: INVALID_REQUEST_REASON, issues: answerReading.issues },
        };
      }
      const answer = answerReading.value;
      const { chat, text } = body;
      const { replyInterfaces, botMessageViews } = context.get('emulationSession');
      if (chat.type === 'supergroup') {
        // Only private chats show buttons with a request, so no supergroup button takes an answer.
        if (answer !== undefined) {
          return { status: 400, body: { reason: 'reply_keyboard_button_answer_not_requested' } };
        }
        const result = replyInterfaces.pressSupergroupReplyKeyboardButton({
          fromAccountId: accountId,
          chat,
          text,
        });
        return result.sent
          ? {
            status: 201,
            body: { message: botMessageViews.viewSupergroupMessage(result.message, accountId) },
          }
          : refuseSupergroupPress(result.reason);
      }
      const result = replyInterfaces.pressPrivateChatReplyKeyboardButton({
        fromAccountId: accountId,
        chat: { type: 'private', peerId: chat.botId },
        text,
        ...(answer === undefined ? {} : { answer }),
      });
      return result.sent
        ? {
          status: 201,
          body: { message: botMessageViews.viewPrivateMessageForBot(result.message) },
        }
        : refusePrivatePress(result.reason);
    },
  );

  return accountRoutes;
}

/**
 * Reads the answer a press gives to the button's request: the location the account's client
 * reports, the users or supergroup the account chose, the poll it created, or the data the Web App
 * sends, which must fit in the bytes Telegram allows; `undefined` for none. A press answers at
 * most one request.
 */
function readPressAnswer(
  { location, shared_user_ids, shared_chat_id, poll, web_app_data }: PressRequest,
): AccountInputReading<ReplyKeyboardRequestAnswer | undefined> {
  if (web_app_data !== undefined && !isSendableWebAppData(web_app_data)) {
    return refuseAnswer(
      ['web_app_data'],
      'Web App data must be nonempty and fit in the bytes Telegram allows',
    );
  }
  const pollReading = poll === undefined ? undefined : readAccountPoll(poll, ['poll']);
  if (pollReading !== undefined && !pollReading.read) {
    return pollReading;
  }
  const answers: ReplyKeyboardRequestAnswer[] = [
    ...(location === undefined
      ? []
      : [{ kind: 'location' as const, location: readAccountLocation(location) }]),
    ...(shared_user_ids === undefined
      ? []
      : [{ kind: 'users' as const, userIds: shared_user_ids }]),
    ...(shared_chat_id === undefined ? [] : [{ kind: 'chat' as const, chatId: shared_chat_id }]),
    ...(pollReading === undefined ? [] : [{ kind: 'poll' as const, poll: pollReading.value }]),
    ...(web_app_data === undefined ? [] : [{ kind: 'web_app' as const, data: web_app_data }]),
  ];
  if (answers.length > 1) {
    return refuseAnswer([], 'A press answers at most one request');
  }
  const [answer] = answers;
  return { read: true, value: answer };
}

/** The refusal of a press whose answer breaks a rule at the body field at `path`. */
function refuseAnswer(
  path: (string | number)[],
  message: string,
): AccountInputReading<never> {
  return { read: false, issues: [{ source: 'body', path, code: 'invalid_value', message }] };
}

/**
 * A missing participant, or a missing user or supergroup to share, is not found; a supergroup the
 * account is not a member of is forbidden to share; a block conflicts with writing to the bot, and
 * an account without a phone number conflicts with sharing its own contact; any other failure
 * rejects the press.
 */
function refusePrivatePress(
  reason: Extract<
    ReturnType<ReplyInterfaces['pressPrivateChatReplyKeyboardButton']>,
    { readonly sent: false }
  >['reason'],
): PressRefusal {
  switch (reason) {
    case 'account_not_found':
    case 'bot_not_found':
    case 'shared_user_not_found':
    case 'shared_chat_not_found':
      return { status: 404, body: { reason } };
    case 'shared_chat_not_joined':
      return { status: 403, body: { reason } };
    case 'bot_blocked':
    case 'account_phone_number_missing':
      return { status: 409, body: { reason } };
    default:
      return { status: 400, body: { reason } };
  }
}

/**
 * A missing account or supergroup is not found, and an account that is not a member of the
 * supergroup, or may not send the content, is forbidden from it; an account without a phone number
 * conflicts with sharing its own contact; any other failure rejects the press.
 */
function refuseSupergroupPress(
  reason: Extract<
    ReturnType<ReplyInterfaces['pressSupergroupReplyKeyboardButton']>,
    { readonly sent: false }
  >['reason'],
): PressRefusal {
  switch (reason) {
    case 'account_not_found':
    case 'chat_not_found':
      return { status: 404, body: { reason } };
    case 'not_a_member':
    case 'send_permission_missing':
      return { status: 403, body: { reason } };
    case 'account_phone_number_missing':
      return { status: 409, body: { reason } };
    default:
      return { status: 400, body: { reason } };
  }
}
