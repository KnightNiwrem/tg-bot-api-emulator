import { z } from 'zod';

import type { EmulationSession } from '../../../../types/emulation_session.ts';
import { readChatMemberTarget } from '../chat_member_requests.ts';
import { presentChatJoinRequestFailure } from '../errors/chat_join_request_failure_presenter.ts';
import {
  answeredPreparation,
  type BotApiCallPreparation,
  botApiError,
  type BotApiMethod,
  type BotApiMethodContext,
  botApiResult,
} from '../method_call.ts';
import { type BotApiRequestParameters, integerParameter } from '../request_parameters.ts';

/**
 * The methods that decide a user's request to join a chat, each executed as a command in its
 * call's transaction.
 */
export const CHAT_JOIN_REQUEST_METHODS: readonly BotApiMethod[] = [
  { name: 'approveChatJoinRequest', recordsActivity: true, prepare: prepareApproveChatJoinRequest },
  { name: 'declineChatJoinRequest', recordsActivity: true, prepare: prepareDeclineChatJoinRequest },
];

/** Parameters of approveChatJoinRequest and declineChatJoinRequest, which name one request. */
const chatJoinRequestDecisionParametersSchema = z.strictObject({
  chat_id: integerParameter(z.int()).optional(),
  user_id: integerParameter(z.int()).optional(),
});

function prepareApproveChatJoinRequest(
  context: BotApiMethodContext,
  parameters: BotApiRequestParameters,
): BotApiCallPreparation {
  return prepareChatJoinRequestDecision(
    'approveChatJoinRequest',
    parameters,
    (request) => context.session.botApi.approveChatJoinRequest(context.bot, request),
  );
}

function prepareDeclineChatJoinRequest(
  context: BotApiMethodContext,
  parameters: BotApiRequestParameters,
): BotApiCallPreparation {
  return prepareChatJoinRequestDecision(
    'declineChatJoinRequest',
    parameters,
    (request) => context.session.botApi.declineChatJoinRequest(context.bot, request),
  );
}

/**
 * Prepares `approveChatJoinRequest` or `declineChatJoinRequest`, which the official server's
 * `process_approve_chat_join_request_query` and `process_decline_chat_join_request_query` read
 * alike: the user, then the chat. Reading them needs no state of the session, so the decision,
 * with every check of the chat, the bot's rights and the request, waits for the call's
 * execution.
 */
function prepareChatJoinRequestDecision(
  methodName: 'approveChatJoinRequest' | 'declineChatJoinRequest',
  parameters: BotApiRequestParameters,
  decide: (
    request: { readonly chatId: number; readonly userId: number },
  ) => ReturnType<EmulationSession['botApi']['approveChatJoinRequest']>,
): BotApiCallPreparation {
  const parsedParameters = chatJoinRequestDecisionParametersSchema.safeParse(parameters);
  if (!parsedParameters.success) {
    return answeredPreparation(botApiError(400, `Bad Request: invalid ${methodName} parameters`));
  }
  const targetReading = readChatMemberTarget(parsedParameters.data);
  if (!targetReading.read) {
    return answeredPreparation(targetReading.errorAnswer);
  }
  const { target } = targetReading;
  return {
    kind: 'command',
    execute: () => {
      const result = decide(target);
      return result.decided ? botApiResult(true) : presentChatJoinRequestFailure(result);
    },
  };
}
