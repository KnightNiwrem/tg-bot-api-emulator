import { z } from 'zod';

import { CHAT_ID_EMPTY_DESCRIPTION } from '../chat_access.ts';
import { BOT_API_ERRORS } from '../errors/error_catalogue.ts';
import { presentFixedBotApiError } from '../errors/error_template.ts';
import { presentMessageReactionFailure } from '../errors/message_reaction_failure_presenter.ts';
import { messageIdOrNone } from '../message_identifiers.ts';
import {
  answeredPreparation,
  type BotApiCallPreparation,
  botApiError,
  type BotApiMethod,
  type BotApiMethodContext,
  botApiResult,
} from '../method_call.ts';
import { readReactionTypesParameter } from '../reaction_type_parameter.ts';
import {
  booleanParameter,
  type BotApiRequestParameters,
  integerParameter,
} from '../request_parameters.ts';

/**
 * The methods that set the bot's reactions to a message, each executed as a command in its call's
 * transaction.
 */
export const MESSAGE_REACTION_METHODS: readonly BotApiMethod[] = [
  { name: 'setMessageReaction', recordsActivity: true, prepare: prepareSetMessageReaction },
];

/** The emulator's description for setMessageReaction parameters it cannot read. */
const SET_MESSAGE_REACTION_PARAMETERS_INVALID_DESCRIPTION =
  'Bad Request: invalid setMessageReaction parameters';

// Business connections are not supported. `is_big` changes only how clients animate the reaction.
const setMessageReactionParametersSchema = z.strictObject({
  chat_id: integerParameter(z.int()).optional(),
  message_id: integerParameter(z.int()).optional(),
  reaction: z.string().optional(),
  is_big: booleanParameter().default(false),
});

/**
 * Sets the bot's reactions to a supergroup message, checking in the official server's order: the
 * `reaction` parameter is read first, then the chat and the message, as `check_message` finds them,
 * and Telegram's servers check the reactions last. A custom emoji is refused right after reading,
 * since no emulated chat allows one. Preparing it reads the parameters; finding the chat and the
 * message, and checking the reactions, wait for the call's execution.
 */
function prepareSetMessageReaction(
  context: BotApiMethodContext,
  parameters: BotApiRequestParameters,
): BotApiCallPreparation {
  const parsedParameters = setMessageReactionParametersSchema.safeParse(parameters);
  if (!parsedParameters.success) {
    return answeredPreparation(
      botApiError(400, SET_MESSAGE_REACTION_PARAMETERS_INVALID_DESCRIPTION),
    );
  }
  const { chat_id: chatId, message_id: messageId, reaction } = parsedParameters.data;
  const reactionTypes = readReactionTypesParameter(
    reaction,
    SET_MESSAGE_REACTION_PARAMETERS_INVALID_DESCRIPTION,
  );
  if (!reactionTypes.read) {
    return answeredPreparation(botApiError(400, reactionTypes.description));
  }
  if (reactionTypes.hasCustomEmoji) {
    return answeredPreparation(presentFixedBotApiError(BOT_API_ERRORS.reactionInvalid));
  }
  if (chatId === undefined) {
    return answeredPreparation(botApiError(400, CHAT_ID_EMPTY_DESCRIPTION));
  }

  const { emojis } = reactionTypes;
  return {
    kind: 'command',
    execute: () => {
      const result = context.session.botApi.setMessageReaction(context.bot, {
        chatId,
        messageId: messageIdOrNone(messageId),
        emojis,
      });
      return result.set ? botApiResult(true) : presentMessageReactionFailure(result);
    },
  };
}
