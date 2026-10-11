import { z } from 'zod';

import type { EmulationSession } from '../../../../session/emulation_session.ts';
import { excludeMissingBotFailure } from '../authenticated_bot_failures.ts';
import { findPrivateChatRefusal } from '../chat_access.ts';
import { readChatMemberTargetStep } from '../chat_member_requests.ts';
import { presentChatJoinRequestFailure } from '../errors/chat_join_request_failure_presenter.ts';
import { type BotApiFamilyContext, type BotApiMethod, botApiResult } from '../method_call.ts';
import { commandMethodOfSteps, startSteps } from '../method_steps.ts';
import { integerParameter } from '../request_parameters.ts';

/** Parameters of approveChatJoinRequest and declineChatJoinRequest, which name one request. */
const chatJoinRequestDecisionParametersSchema = z.strictObject({
  chat_id: integerParameter(z.int()).optional(),
  user_id: integerParameter(z.int()).optional(),
});

/**
 * What the join request methods use: the service that admits accounts to chats, and the private
 * chats the bot knows, which have no join requests.
 */
type ChatJoinRequestContext = BotApiFamilyContext<'chatAdmission' | 'privateMessaging'>;

type ChatAdmission = EmulationSession['chatAdmission'];

/** A decision on a join request, as `ChatAdmissionService` takes it for a bot. */
type JoinRequestDecision = ChatAdmission['approveJoinRequestAsBot'];

/**
 * The methods that decide a user's request to join a chat, each executed as a command in its
 * call's transaction.
 */
export const CHAT_JOIN_REQUEST_METHODS: readonly BotApiMethod[] = [
  chatJoinRequestDecisionMethod(
    'approveChatJoinRequest',
    (context, input) => context.session.chatAdmission.approveJoinRequestAsBot(input),
  ),
  chatJoinRequestDecisionMethod(
    'declineChatJoinRequest',
    (context, input) => context.session.chatAdmission.declineJoinRequestAsBot(input),
  ),
];

/**
 * `approveChatJoinRequest` or `declineChatJoinRequest`, which the official server's
 * `process_approve_chat_join_request_query` and `process_decline_chat_join_request_query` read
 * alike: the user, then the chat. Reading them needs no state of the session, so the decision,
 * with every check of the chat, the bot's rights and the request, waits for the call's
 * execution. As TDLib's `can_manage_dialog_join_requests` refuses, a private chat has no join
 * requests.
 */
function chatJoinRequestDecisionMethod(
  name: 'approveChatJoinRequest' | 'declineChatJoinRequest',
  decide: (
    context: ChatJoinRequestContext,
    input: Parameters<JoinRequestDecision>[0],
  ) => ReturnType<JoinRequestDecision>,
): BotApiMethod {
  return commandMethodOfSteps({
    name,
    recordsActivity: true,
    parameters: chatJoinRequestDecisionParametersSchema,
    steps: ({ parameters }) => startSteps(parameters).andThen(readChatMemberTargetStep),
    execute: (context: ChatJoinRequestContext, { chatId, userId }) => {
      const privateChatRefusal = findPrivateChatRefusal(
        context,
        chatId,
        'private_chat_has_no_join_requests',
      );
      if (privateChatRefusal !== undefined) {
        return presentChatJoinRequestFailure({ decided: false, reason: privateChatRefusal });
      }
      const result = decide(context, { deciderBotId: context.bot.id, chatId, userId });
      return result.decided ? botApiResult(true) : presentChatJoinRequestFailure({
        decided: false,
        reason: excludeMissingBotFailure(context.bot, result.reason),
      });
    },
  });
}
