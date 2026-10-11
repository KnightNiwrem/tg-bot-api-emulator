import { Hono } from 'hono';

import { stopAccountPollContract } from '../../contracts/poll_answers.ts';
import type { EmulationSession } from '../../../session/emulation_session.ts';
import {
  controlErrorResponse,
  invalidControlRequestResponse,
} from '../../control_error_response.ts';
import { registerControlOperation } from '../../control_operation_route.ts';
import { answerWithActionReceipt } from '../action_receipt.ts';
import type { SessionRouteContextTypes } from '../session_route_context_types.ts';
import { SUPERGROUP_MESSAGE_PATH } from './account_paths.ts';
import { viewChatMessageForAccount, viewPrivateChatMessageForBot } from './chat_message_view.ts';
import { readSupergroupPollMessageKey } from './poll_message_key.ts';

const SUPERGROUP_MESSAGE_POLL_CLOSURE_PATH = `${SUPERGROUP_MESSAGE_PATH}/poll-closure` as const;

/** Where the account routes are mounted within the server, as a contract path template. */
const ACCOUNT_COLLECTION_MOUNT_PATH = '/sessions/{sessionId}/accounts';

/**
 * Routes through which an account stops the poll it sent in a message of its private chat with a
 * bot or of a supergroup, as TDLib's `stopPoll` does for a user. Each answers with the message,
 * whose poll is now closed.
 */
export function createPollClosureRoutes(): Hono<SessionRouteContextTypes> {
  const accountRoutes = new Hono<SessionRouteContextTypes>();

  registerControlOperation(
    accountRoutes,
    ACCOUNT_COLLECTION_MOUNT_PATH,
    stopAccountPollContract,
    ({ params: { accountId, botId, messageId } }, context) => {
      const { polls, botMessageViews } = context.get('emulationSession');
      const result = polls.stopAccountPoll({
        accountId,
        chat: { type: 'private', botId },
        messageId,
      });
      if (!result.stopped) {
        return refusePollClosure(result.reason);
      }
      return {
        status: 200,
        body: { message: viewPrivateChatMessageForBot(botMessageViews, result.message) },
      };
    },
  );

  accountRoutes.post(SUPERGROUP_MESSAGE_POLL_CLOSURE_PATH, (context) => {
    const pollMessageReading = readSupergroupPollMessageKey(context.req.param());
    if (!pollMessageReading.valid) {
      return invalidControlRequestResponse(context, pollMessageReading.issues);
    }
    const pollMessage = pollMessageReading.value;
    return answerWithActionReceipt(context, ({ polls, botMessageViews }) => {
      const result = polls.stopAccountPoll(pollMessage);
      if (!result.stopped) {
        const { status, body } = refusePollClosure(result.reason);
        return controlErrorResponse(context, status, body.reason);
      }
      return context.json({
        message: viewChatMessageForAccount(
          botMessageViews,
          result.message,
          pollMessage.accountId,
        ),
      });
    });
  });

  return accountRoutes;
}

/**
 * A chat or message the account cannot find, or one without a poll, is not found; a chat the
 * account is no member of, or a poll it did not send through that message, forbids stopping it;
 * and a closed poll conflicts with stopping it again.
 */
function refusePollClosure(
  reason: Extract<
    ReturnType<EmulationSession['polls']['stopAccountPoll']>,
    { readonly stopped: false }
  >['reason'],
) {
  switch (reason) {
    case 'account_not_found':
    case 'bot_not_found':
    case 'chat_not_found':
    case 'message_not_found':
    case 'message_has_no_poll':
      return { status: 404, body: { reason } } as const;
    case 'not_a_member':
    case 'poll_not_stoppable':
      return { status: 403, body: { reason } } as const;
    case 'poll_already_closed':
      return { status: 409, body: { reason } } as const;
    default: {
      const unhandledReason: never = reason;
      throw new Error(`Unhandled poll closure failure: ${unhandledReason}`);
    }
  }
}
