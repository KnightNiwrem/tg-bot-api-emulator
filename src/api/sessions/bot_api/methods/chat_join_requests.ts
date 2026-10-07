import { z } from 'zod';

import type { EmulationSession } from '../../../../types/emulation_session.ts';
import { supergroupBotAccessFailureAnswer } from '../chat_access.ts';
import { readChatMemberTarget } from '../chat_member_requests.ts';
import {
  botApiError,
  type BotApiMethod,
  type BotApiMethodAnswer,
  type BotApiMethodContext,
  botApiResult,
} from '../method_call.ts';
import { type BotApiRequestParameters, integerParameter } from '../request_parameters.ts';

/** The methods that decide a user's request to join a chat. */
export const CHAT_JOIN_REQUEST_METHODS: readonly BotApiMethod[] = [
  { name: 'approveChatJoinRequest', handler: handleApproveChatJoinRequest },
  { name: 'declineChatJoinRequest', handler: handleDeclineChatJoinRequest },
];

/** Telegram's descriptions for rejected join request decisions. */
const PRIVATE_CHAT_HAS_NO_JOIN_REQUESTS_DESCRIPTION =
  "Bad Request: the chat can't have join requests";
const NOT_ENOUGH_RIGHTS_TO_MANAGE_JOIN_REQUESTS_DESCRIPTION =
  'Bad Request: not enough rights to manage chat join requests';
/** Telegram's servers' errors for join requests, which the official server passes on. */
const USER_ALREADY_PARTICIPANT_DESCRIPTION = 'Bad Request: USER_ALREADY_PARTICIPANT';
const JOIN_REQUEST_MISSING_DESCRIPTION = 'Bad Request: HIDE_REQUESTER_MISSING';

/** Parameters of approveChatJoinRequest and declineChatJoinRequest, which name one request. */
const chatJoinRequestDecisionParametersSchema = z.strictObject({
  chat_id: integerParameter(z.int()).optional(),
  user_id: integerParameter(z.int()).optional(),
});

function handleApproveChatJoinRequest(
  context: BotApiMethodContext,
  parameters: BotApiRequestParameters,
): BotApiMethodAnswer {
  return answerChatJoinRequestDecision(
    'approveChatJoinRequest',
    parameters,
    (request) => context.session.botApi.approveChatJoinRequest(context.bot, request),
  );
}

function handleDeclineChatJoinRequest(
  context: BotApiMethodContext,
  parameters: BotApiRequestParameters,
): BotApiMethodAnswer {
  return answerChatJoinRequestDecision(
    'declineChatJoinRequest',
    parameters,
    (request) => context.session.botApi.declineChatJoinRequest(context.bot, request),
  );
}

/**
 * Answers `approveChatJoinRequest` or `declineChatJoinRequest`, which the official server's
 * `process_approve_chat_join_request_query` and `process_decline_chat_join_request_query` read
 * alike: the user, then the chat.
 */
function answerChatJoinRequestDecision(
  methodName: 'approveChatJoinRequest' | 'declineChatJoinRequest',
  parameters: BotApiRequestParameters,
  decide: (
    request: { readonly chatId: number; readonly userId: number },
  ) => ReturnType<EmulationSession['botApi']['approveChatJoinRequest']>,
): BotApiMethodAnswer {
  const parsedParameters = chatJoinRequestDecisionParametersSchema.safeParse(parameters);
  if (!parsedParameters.success) {
    return botApiError(400, `Bad Request: invalid ${methodName} parameters`);
  }
  const targetReading = readChatMemberTarget(parsedParameters.data);
  if (!targetReading.read) {
    return targetReading.errorAnswer;
  }

  const result = decide(targetReading.target);
  if (result.decided) {
    return botApiResult(true);
  }
  switch (result.reason) {
    case 'chat_not_found':
    case 'bot_not_a_member':
    case 'bot_kicked':
      return supergroupBotAccessFailureAnswer(result.reason);
    case 'private_chat_has_no_join_requests':
      return botApiError(400, PRIVATE_CHAT_HAS_NO_JOIN_REQUESTS_DESCRIPTION);
    case 'not_enough_rights':
      return botApiError(400, NOT_ENOUGH_RIGHTS_TO_MANAGE_JOIN_REQUESTS_DESCRIPTION);
    case 'already_a_member':
      return botApiError(400, USER_ALREADY_PARTICIPANT_DESCRIPTION);
    case 'join_request_missing':
      return botApiError(400, JOIN_REQUEST_MISSING_DESCRIPTION);
    default: {
      const unhandledReason: never = result.reason;
      throw new Error(`Unhandled ${methodName} failure: ${unhandledReason}`);
    }
  }
}
