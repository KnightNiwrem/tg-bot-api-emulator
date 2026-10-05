import { Hono } from 'hono';

import type { EmulationSession } from '../../../types/emulation_session.ts';
import type { SessionRouteContextTypes } from '../session_route_context_types.ts';
import { PRIVATE_MESSAGE_PATH, SUPERGROUP_MESSAGE_PATH } from './account_paths.ts';
import { viewChatMessageForAccount } from './chat_message_view.ts';
import { readPollMessageKey } from './poll_message_key.ts';

const PRIVATE_MESSAGE_POLL_CLOSURE_PATH = `${PRIVATE_MESSAGE_PATH}/poll-closure` as const;
const SUPERGROUP_MESSAGE_POLL_CLOSURE_PATH = `${SUPERGROUP_MESSAGE_PATH}/poll-closure` as const;

/**
 * Routes through which an account stops the poll it sent in a message of its private chat with a
 * bot or of a supergroup, as TDLib's `stopPoll` does for a user. Each answers with the message,
 * whose poll is now closed.
 */
export function createPollClosureRoutes(): Hono<SessionRouteContextTypes> {
  const accountRoutes = new Hono<SessionRouteContextTypes>();

  for (
    const [pollClosurePath, chatType] of [
      [PRIVATE_MESSAGE_POLL_CLOSURE_PATH, 'private'],
      [SUPERGROUP_MESSAGE_POLL_CLOSURE_PATH, 'supergroup'],
    ] as const
  ) {
    accountRoutes.post(pollClosurePath, (context) => {
      const pollMessage = readPollMessageKey(context.req.param(), chatType);
      if (pollMessage === undefined) {
        return context.body(null, 400);
      }
      const { polls, botMessageViews } = context.get('emulationSession');
      const result = polls.stopAccountPoll(pollMessage);
      if (!result.stopped) {
        return context.body(null, pollClosureFailureStatus(result.reason));
      }
      return context.json({
        message: viewChatMessageForAccount(botMessageViews, result.message, pollMessage.accountId),
      });
    });
  }

  return accountRoutes;
}

/**
 * A chat or message the account cannot find, or one without a poll, is not found; a chat the
 * account is no member of, or a poll it did not send through that message, forbids stopping it;
 * and a closed poll conflicts with stopping it again.
 */
function pollClosureFailureStatus(
  reason: Extract<
    ReturnType<EmulationSession['polls']['stopAccountPoll']>,
    { readonly stopped: false }
  >['reason'],
): 403 | 404 | 409 {
  switch (reason) {
    case 'account_not_found':
    case 'bot_not_found':
    case 'chat_not_found':
    case 'message_not_found':
    case 'message_has_no_poll':
      return 404;
    case 'not_a_member':
    case 'poll_not_stoppable':
      return 403;
    case 'poll_already_closed':
      return 409;
    default: {
      const unhandledReason: never = reason;
      throw new Error(`Unhandled poll closure failure: ${unhandledReason}`);
    }
  }
}
