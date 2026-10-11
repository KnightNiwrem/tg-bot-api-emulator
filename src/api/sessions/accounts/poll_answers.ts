import { type Context, Hono } from 'hono';
import { z } from 'zod';

import {
  answerAccountPollContract,
  getAccountPollAnswerContract,
  retractAccountPollAnswerContract,
  retractSupergroupAccountPollAnswerContract,
} from '../../contracts/poll_answers.ts';
import type { EmulationSession } from '../../../session/emulation_session.ts';
import {
  controlErrorResponse,
  invalidControlRequestResponse,
} from '../../control_error_response.ts';
import { registerControlOperation } from '../../control_operation_route.ts';
import { answerWithActionReceipt } from '../action_receipt.ts';
import { readJsonRequestBody } from '../json_request_body.ts';
import type { SessionRouteContextTypes } from '../session_route_context_types.ts';
import { SUPERGROUP_MESSAGE_PATH } from './account_paths.ts';
import { viewChatMessageForAccount, viewPrivateChatMessageForBot } from './chat_message_view.ts';
import { readSupergroupPollMessageKey } from './poll_message_key.ts';

const SUPERGROUP_MESSAGE_POLL_ANSWER_PATH = `${SUPERGROUP_MESSAGE_PATH}/poll-answer` as const;

/** Where the account routes are mounted within the server, as a contract path template. */
const ACCOUNT_COLLECTION_MOUNT_PATH = '/sessions/{sessionId}/accounts';

/**
 * The options an account chooses in a poll, by their positions counted from 0, as the Bot API's
 * `option_ids` numbers them; a repeated position counts once. Retracting an answer chooses none.
 */
const setPollAnswerRequestSchema = z.strictObject({
  option_ids: z.array(z.int().nonnegative()).min(1),
});

type Polls = EmulationSession['polls'];

/**
 * Routes through which an account reads, sets and retracts its answer to the poll of a message in
 * its private chat with a bot or in a supergroup.
 */
export function createPollAnswerRoutes(): Hono<SessionRouteContextTypes> {
  const accountRoutes = new Hono<SessionRouteContextTypes>();

  registerControlOperation(
    accountRoutes,
    ACCOUNT_COLLECTION_MOUNT_PATH,
    getAccountPollAnswerContract,
    ({ params: { accountId, botId, messageId } }, context) => {
      const { polls, botMessageViews } = context.get('emulationSession');
      const result = polls.getAccountPollAnswer({
        accountId,
        chat: { type: 'private', botId },
        messageId,
      });
      if (!result.found) {
        // Only a supergroup has members; a private chat never refuses an account as one.
        if (result.reason === 'not_a_member') {
          throw new Error(`A private chat refused a poll answer's lookup as ${result.reason}`);
        }
        return { status: 404, body: { reason: result.reason } };
      }
      return {
        status: 200,
        body: {
          poll_answer: presentPollAnswer(result),
          message: viewPrivateChatMessageForBot(botMessageViews, result.message),
        },
      };
    },
  );

  registerControlOperation(
    accountRoutes,
    ACCOUNT_COLLECTION_MOUNT_PATH,
    answerAccountPollContract,
    ({ params: { accountId, botId, messageId }, body: { option_ids } }, context) => {
      const { polls, botMessageViews } = context.get('emulationSession');
      const result = polls.setAccountPollAnswer({
        accountId,
        chat: { type: 'private', botId },
        messageId,
        optionPositions: option_ids,
      });
      if (!result.answered) {
        return refusePrivatePollAnswer(result.reason);
      }
      return {
        status: 200,
        body: {
          poll_answer: presentPollAnswer(result),
          message: viewPrivateChatMessageForBot(botMessageViews, result.message),
        },
      };
    },
  );

  accountRoutes.get(SUPERGROUP_MESSAGE_POLL_ANSWER_PATH, (context) => {
    const pollMessageReading = readSupergroupPollMessageKey(context.req.param());
    if (!pollMessageReading.valid) {
      return invalidControlRequestResponse(context, pollMessageReading.issues);
    }
    const pollMessage = pollMessageReading.value;
    const { polls, botMessageViews } = context.get('emulationSession');
    const result = polls.getAccountPollAnswer(pollMessage);
    if (!result.found) {
      return pollAnswerRefusalResponse(context, result.reason);
    }
    return context.json({
      poll_answer: presentPollAnswer(result),
      message: viewChatMessageForAccount(botMessageViews, result.message, pollMessage.accountId),
    });
  });

  accountRoutes.put(SUPERGROUP_MESSAGE_POLL_ANSWER_PATH, async (context) => {
    const pollMessageReading = readSupergroupPollMessageKey(context.req.param());
    if (!pollMessageReading.valid) {
      return invalidControlRequestResponse(context, pollMessageReading.issues);
    }
    const pollMessage = pollMessageReading.value;
    const requestBodyReading = await readJsonRequestBody(context.req, setPollAnswerRequestSchema);
    if (!requestBodyReading.valid) {
      return invalidControlRequestResponse(context, requestBodyReading.issues);
    }
    const requestBody = requestBodyReading.value;
    return answerWithActionReceipt(context, ({ polls, botMessageViews }) => {
      const result = polls.setAccountPollAnswer({
        ...pollMessage,
        optionPositions: requestBody.option_ids,
      });
      if (!result.answered) {
        return pollAnswerRefusalResponse(context, result.reason);
      }
      return context.json({
        poll_answer: presentPollAnswer(result),
        message: viewChatMessageForAccount(botMessageViews, result.message, pollMessage.accountId),
      });
    });
  });

  // Retracting chooses no options, as TDLib's `setPollAnswer` does with none.
  registerControlOperation(
    accountRoutes,
    ACCOUNT_COLLECTION_MOUNT_PATH,
    retractAccountPollAnswerContract,
    ({ params: { accountId, botId, messageId } }, context) => {
      const result = context.get('emulationSession').polls.setAccountPollAnswer({
        accountId,
        chat: { type: 'private', botId },
        messageId,
        optionPositions: [],
      });
      return result.answered ? { status: 204 } : refusePrivatePollAnswer(result.reason);
    },
  );

  registerControlOperation(
    accountRoutes,
    ACCOUNT_COLLECTION_MOUNT_PATH,
    retractSupergroupAccountPollAnswerContract,
    ({ params: { accountId, chatId, messageId } }, context) => {
      const result = context.get('emulationSession').polls.setAccountPollAnswer({
        accountId,
        chat: { type: 'supergroup', chatId },
        messageId,
        optionPositions: [],
      });
      if (result.answered) {
        return { status: 204 };
      }
      return refusePollAnswer(result.reason);
    },
  );

  return accountRoutes;
}

/** A poll an account found, with its own answer. */
type AccountPollAnswer = Omit<
  Extract<ReturnType<Polls['getAccountPollAnswer']>, { readonly found: true }>,
  'found'
>;

/**
 * Shows an account's answer to a poll. Options are identified by position, as `option_ids` of the
 * Bot API's `PollAnswer` numbers them, and by their persistent identifiers.
 */
function presentPollAnswer({ poll, chosenOptionPositions }: AccountPollAnswer) {
  return {
    poll_id: poll.id,
    option_ids: [...chosenOptionPositions],
    option_persistent_ids: chosenOptionPositions.map((optionPosition) =>
      poll.options[optionPosition].persistentId
    ),
  };
}

/** Why an account's poll answer was refused. */
type PollAnswerFailureReason = Extract<
  ReturnType<Polls['setAccountPollAnswer']>,
  { readonly answered: false }
>['reason'];

/** A refused poll answer's status, with the body naming its reason. */
type PollAnswerRefusal =
  | {
    readonly status: 400;
    readonly body: { readonly reason: 'multiple_answers_not_allowed' | 'poll_option_not_found' };
  }
  | { readonly status: 403; readonly body: { readonly reason: 'not_a_member' } }
  | {
    readonly status: 404;
    readonly body: {
      readonly reason:
        | 'account_not_found'
        | 'bot_not_found'
        | 'chat_not_found'
        | 'message_not_found'
        | 'message_has_no_poll';
    };
  }
  | {
    readonly status: 409;
    readonly body: {
      readonly reason:
        | 'poll_closed'
        | 'answer_retraction_not_allowed'
        | 'answer_change_not_allowed';
    };
  };

/**
 * A chat or message the account cannot find, or one without a poll, is not found; a chat the
 * account is no member of forbids voting; an answer the poll cannot accept is rejected; and an
 * answer the poll's state or settings forbid, such as a change of an answer that cannot be
 * changed, conflicts with it.
 */
function refusePollAnswer(reason: PollAnswerFailureReason): PollAnswerRefusal {
  switch (reason) {
    case 'account_not_found':
    case 'bot_not_found':
    case 'chat_not_found':
    case 'message_not_found':
    case 'message_has_no_poll':
      return { status: 404, body: { reason } };
    case 'not_a_member':
      return { status: 403, body: { reason } };
    case 'multiple_answers_not_allowed':
    case 'poll_option_not_found':
      return { status: 400, body: { reason } };
    case 'poll_closed':
    case 'answer_retraction_not_allowed':
    case 'answer_change_not_allowed':
      return { status: 409, body: { reason } };
    default: {
      const unhandledReason: never = reason;
      throw new Error(`Unhandled poll answer failure: ${unhandledReason}`);
    }
  }
}

/**
 * Refuses a poll answer in a private chat as `refusePollAnswer` does.
 *
 * @throws {Error} for an account that is not a member, which only a supergroup can refuse.
 */
function refusePrivatePollAnswer(
  reason: PollAnswerFailureReason,
): Exclude<PollAnswerRefusal, { readonly status: 403 }> {
  const refusal = refusePollAnswer(reason);
  // Only a supergroup has members; a private chat never refuses an answer as `not_a_member`.
  if (refusal.status === 403) {
    throw new Error(`A private chat refused a poll answer as ${refusal.body.reason}`);
  }
  return refusal;
}

/** Answers a refused poll answer of a route that is not registered from a contract. */
function pollAnswerRefusalResponse(context: Context, reason: PollAnswerFailureReason): Response {
  const { status, body } = refusePollAnswer(reason);
  return controlErrorResponse(context, status, body.reason);
}
