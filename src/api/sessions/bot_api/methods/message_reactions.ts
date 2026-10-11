import { z } from 'zod';

import { requireSpecifiedChatId } from '../chat_access.ts';
import { BOT_API_ERRORS } from '../errors/error_catalogue.ts';
import { presentFixedBotApiError } from '../errors/error_template.ts';
import { presentMessageReactionFailure } from '../errors/message_reaction_failure_presenter.ts';
import { messageIdOrNone } from '../message_identifiers.ts';
import { type BotApiMethod, botApiResult } from '../method_call.ts';
import {
  answerWith,
  answerWithBadRequest,
  type BotApiStepCall,
  type BotApiStepResult,
  commandMethodOfSteps,
  proceedWith,
  startSteps,
} from '../method_steps.ts';
import { readReactionTypesParameter } from '../reaction_type_parameter.ts';
import { booleanParameter, integerParameter } from '../request_parameters.ts';

// Business connections are not supported. `is_big` changes only how clients animate the reaction.
const setMessageReactionParametersSchema = z.strictObject({
  chat_id: integerParameter(z.int()).optional(),
  message_id: integerParameter(z.int()).optional(),
  reaction: z.string().optional(),
  is_big: booleanParameter().default(false),
});

type SetMessageReactionParameters = z.output<typeof setMessageReactionParametersSchema>;

/**
 * The methods that set the bot's reactions to a message, each executed as a command in its call's
 * transaction.
 */
export const MESSAGE_REACTION_METHODS: readonly BotApiMethod[] = [
  // Checked in the official server's order: the `reaction` parameter is read first, then the chat
  // and the message, as `check_message` finds them, and Telegram's servers check the reactions
  // last, once the call executes.
  commandMethodOfSteps({
    name: 'setMessageReaction',
    recordsActivity: true,
    parameters: setMessageReactionParametersSchema,
    steps: (call) =>
      startSteps(call.parameters)
        .andThen((parameters) => readReactionEmojis(call, parameters))
        .andThen(requireSpecifiedChatId),
    execute: (context, { chat_id: chatId, message_id: messageId, emojis }) => {
      const result = context.session.botApi.setMessageReaction(context.bot, {
        chatId,
        messageId: messageIdOrNone(messageId),
        emojis,
      });
      return result.set ? botApiResult(true) : presentMessageReactionFailure(result);
    },
  }),
];

/**
 * The step that reads the `reaction` parameter as `readReactionTypesParameter` does. A custom
 * emoji is refused right after reading, since no emulated chat allows one.
 */
function readReactionEmojis(
  { invalidParametersDescription }: BotApiStepCall<unknown>,
  parameters: SetMessageReactionParameters,
): BotApiStepResult<SetMessageReactionParameters & { readonly emojis: readonly string[] }> {
  const reactionTypes = readReactionTypesParameter(
    parameters.reaction,
    invalidParametersDescription,
  );
  if (!reactionTypes.read) {
    return answerWithBadRequest(reactionTypes.description);
  }
  if (reactionTypes.hasCustomEmoji) {
    return answerWith(presentFixedBotApiError(BOT_API_ERRORS.reactionInvalid));
  }
  return proceedWith({ ...parameters, emojis: reactionTypes.emojis });
}
