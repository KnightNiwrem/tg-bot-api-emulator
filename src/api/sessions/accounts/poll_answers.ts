import { Hono } from 'hono';
import { z } from 'zod';

import type { EmulationSession } from '../../../types/emulation_session.ts';
import { readJsonRequestBody } from '../json_request_body.ts';
import type { SessionRouteContextTypes } from '../session_route_context_types.ts';
import {
  PRIVATE_MESSAGE_PATH,
  privateMessagePathSchema,
  SUPERGROUP_MESSAGE_PATH,
  supergroupMessagePathSchema,
} from './account_paths.ts';
import { viewChatMessageForAccount } from './chat_message_view.ts';

const PRIVATE_MESSAGE_POLL_ANSWER_PATH = `${PRIVATE_MESSAGE_PATH}/poll-answer` as const;
const SUPERGROUP_MESSAGE_POLL_ANSWER_PATH = `${SUPERGROUP_MESSAGE_PATH}/poll-answer` as const;

/**
 * The options an account chooses in a poll, by their positions counted from 0, as the Bot API's
 * `option_ids` numbers them; a repeated position counts once. Retracting an answer chooses none.
 */
const setPollAnswerRequestSchema = z.strictObject({
  option_ids: z.array(z.int().nonnegative()).min(1),
});

/**
 * Routes through which an account reads, sets and retracts its answer to the poll of a message in
 * its private chat with a bot or in a supergroup.
 */
export function createPollAnswerRoutes(): Hono<SessionRouteContextTypes> {
  const accountRoutes = new Hono<SessionRouteContextTypes>();

  for (
    const [pollAnswerPath, chatType] of [
      [PRIVATE_MESSAGE_POLL_ANSWER_PATH, 'private'],
      [SUPERGROUP_MESSAGE_POLL_ANSWER_PATH, 'supergroup'],
    ] as const
  ) {
    accountRoutes.get(pollAnswerPath, (context) => {
      const pollMessage = readPollMessageKey(context.req.param(), chatType);
      if (pollMessage === undefined) {
        return context.body(null, 400);
      }
      const { polls, botMessageViews } = context.get('emulationSession');
      const result = polls.getAccountPollAnswer(pollMessage);
      if (!result.found) {
        return context.body(null, pollAnswerFailureStatus(result.reason));
      }
      return context.json(presentPollAnswerForAccount(botMessageViews, result, pollMessage));
    });

    accountRoutes.put(pollAnswerPath, async (context) => {
      const pollMessage = readPollMessageKey(context.req.param(), chatType);
      if (pollMessage === undefined) {
        return context.body(null, 400);
      }
      const requestBody = await readJsonRequestBody(context.req, setPollAnswerRequestSchema);
      if (requestBody === undefined) {
        return context.body(null, 400);
      }
      const { polls, botMessageViews } = context.get('emulationSession');
      const result = polls.setAccountPollAnswer({
        ...pollMessage,
        optionPositions: requestBody.option_ids,
      });
      if (!result.answered) {
        return context.body(null, pollAnswerFailureStatus(result.reason));
      }
      return context.json(presentPollAnswerForAccount(botMessageViews, result, pollMessage));
    });

    // Retracting chooses no options, as TDLib's `setPollAnswer` does with none.
    accountRoutes.delete(pollAnswerPath, (context) => {
      const pollMessage = readPollMessageKey(context.req.param(), chatType);
      if (pollMessage === undefined) {
        return context.body(null, 400);
      }
      const result = context.get('emulationSession').polls.setAccountPollAnswer({
        ...pollMessage,
        optionPositions: [],
      });
      return result.answered
        ? context.body(null, 204)
        : context.body(null, pollAnswerFailureStatus(result.reason));
    });
  }

  return accountRoutes;
}

/** A message showing a poll, as an account addresses it. */
type AccountPollMessageKey = Parameters<EmulationSession['polls']['getAccountPollAnswer']>[0];

/** A poll an account found, with its own answer. */
type AccountPollAnswer = Omit<
  Extract<
    ReturnType<EmulationSession['polls']['getAccountPollAnswer']>,
    { readonly found: true }
  >,
  'found'
>;

/**
 * Reads the message of a poll answer route, in an account's private chat with a bot or in a
 * supergroup; `undefined` for path parameters that identify none.
 */
function readPollMessageKey(
  pathParameters: Record<string, string>,
  chatType: AccountPollMessageKey['chat']['type'],
): AccountPollMessageKey | undefined {
  if (chatType === 'private') {
    const messagePath = privateMessagePathSchema.safeParse(pathParameters);
    return messagePath.success
      ? {
        accountId: messagePath.data.accountId,
        chat: { type: 'private', botId: messagePath.data.botId },
        messageId: messagePath.data.messageId,
      }
      : undefined;
  }
  const messagePath = supergroupMessagePathSchema.safeParse(pathParameters);
  return messagePath.success
    ? {
      accountId: messagePath.data.accountId,
      chat: { type: 'supergroup', chatId: messagePath.data.chatId },
      messageId: messagePath.data.messageId,
    }
    : undefined;
}

/**
 * Shows an account's answer to a poll, with the message showing the poll as these routes show
 * messages. Options are identified by position, as `option_ids` of the Bot API's `PollAnswer`
 * numbers them, and by their persistent identifiers.
 */
function presentPollAnswerForAccount(
  botMessageViews: EmulationSession['botMessageViews'],
  { poll, message, chosenOptionPositions }: AccountPollAnswer,
  { accountId }: AccountPollMessageKey,
) {
  return {
    poll_answer: {
      poll_id: poll.id,
      option_ids: chosenOptionPositions,
      option_persistent_ids: chosenOptionPositions.map((optionPosition) =>
        poll.options[optionPosition].persistentId
      ),
    },
    message: viewChatMessageForAccount(botMessageViews, message, accountId),
  };
}

/**
 * A chat or message the account cannot find, or one without a poll, is not found; a chat the
 * account is no member of forbids voting; an answer the poll cannot accept is rejected; and an
 * answer the poll's state or settings forbid, such as a change of an answer that cannot be
 * changed, conflicts with it.
 */
function pollAnswerFailureStatus(
  reason: Extract<
    ReturnType<EmulationSession['polls']['setAccountPollAnswer']>,
    { readonly answered: false }
  >['reason'],
): 400 | 403 | 404 | 409 {
  switch (reason) {
    case 'account_not_found':
    case 'bot_not_found':
    case 'chat_not_found':
    case 'message_not_found':
    case 'message_has_no_poll':
      return 404;
    case 'not_a_member':
      return 403;
    case 'multiple_answers_not_allowed':
    case 'poll_option_not_found':
      return 400;
    case 'poll_closed':
    case 'answer_retraction_not_allowed':
    case 'answer_change_not_allowed':
      return 409;
    default: {
      const unhandledReason: never = reason;
      throw new Error(`Unhandled poll answer failure: ${unhandledReason}`);
    }
  }
}
