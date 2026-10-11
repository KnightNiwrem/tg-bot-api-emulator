import { z } from 'zod';

import type { EmulationSession } from '../../../../types/emulation_session.ts';
import { readChatMemberTarget } from '../chat_member_requests.ts';
import { presentChatJoinRequestFailure } from '../errors/chat_join_request_failure_presenter.ts';
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
  { name: 'approveChatJoinRequest', recordsActivity: true, handler: handleApproveChatJoinRequest },
  { name: 'declineChatJoinRequest', recordsActivity: true, handler: handleDeclineChatJoinRequest },
];

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
  return result.decided ? botApiResult(true) : presentChatJoinRequestFailure(result);
}
