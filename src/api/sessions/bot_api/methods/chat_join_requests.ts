import { z } from 'zod';

import type { EmulationSession } from '../../../../session/emulation_session.ts';
import { readChatMemberTargetStep } from '../chat_member_requests.ts';
import { presentChatJoinRequestFailure } from '../errors/chat_join_request_failure_presenter.ts';
import { type BotApiMethod, type BotApiMethodContext, botApiResult } from '../method_call.ts';
import { commandMethodOfSteps, startSteps } from '../method_steps.ts';
import { integerParameter } from '../request_parameters.ts';

/** Parameters of approveChatJoinRequest and declineChatJoinRequest, which name one request. */
const chatJoinRequestDecisionParametersSchema = z.strictObject({
  chat_id: integerParameter(z.int()).optional(),
  user_id: integerParameter(z.int()).optional(),
});

/**
 * The methods that decide a user's request to join a chat, each executed as a command in its
 * call's transaction.
 */
export const CHAT_JOIN_REQUEST_METHODS: readonly BotApiMethod[] = [
  chatJoinRequestDecisionMethod(
    'approveChatJoinRequest',
    (context, request) => context.session.botApi.approveChatJoinRequest(context.bot, request),
  ),
  chatJoinRequestDecisionMethod(
    'declineChatJoinRequest',
    (context, request) => context.session.botApi.declineChatJoinRequest(context.bot, request),
  ),
];

/**
 * `approveChatJoinRequest` or `declineChatJoinRequest`, which the official server's
 * `process_approve_chat_join_request_query` and `process_decline_chat_join_request_query` read
 * alike: the user, then the chat. Reading them needs no state of the session, so the decision,
 * with every check of the chat, the bot's rights and the request, waits for the call's
 * execution.
 */
function chatJoinRequestDecisionMethod(
  name: 'approveChatJoinRequest' | 'declineChatJoinRequest',
  decide: (
    context: BotApiMethodContext,
    request: { readonly chatId: number; readonly userId: number },
  ) => ReturnType<EmulationSession['botApi']['approveChatJoinRequest']>,
): BotApiMethod {
  return commandMethodOfSteps({
    name,
    recordsActivity: true,
    parameters: chatJoinRequestDecisionParametersSchema,
    steps: ({ parameters }) => startSteps(parameters).andThen(readChatMemberTargetStep),
    execute: (context, target) => {
      const result = decide(context, target);
      return result.decided ? botApiResult(true) : presentChatJoinRequestFailure(result);
    },
  });
}
