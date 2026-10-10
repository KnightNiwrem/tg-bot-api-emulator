import { z } from 'zod';

import { CHAT_ID_EMPTY_DESCRIPTION, supergroupBotAccessFailureAnswer } from '../chat_access.ts';
import { messageIdOrNone } from '../message_identifiers.ts';
import {
  botApiError,
  type BotApiMethod,
  type BotApiMethodAnswer,
  type BotApiMethodContext,
  botApiResult,
} from '../method_call.ts';
import { readReactionTypesParameter } from '../reaction_type_parameter.ts';
import {
  booleanParameter,
  type BotApiRequestParameters,
  integerParameter,
} from '../request_parameters.ts';

/** The methods that set the bot's reactions to a message. */
export const MESSAGE_REACTION_METHODS: readonly BotApiMethod[] = [
  { name: 'setMessageReaction', recordsActivity: true, handler: handleSetMessageReaction },
];

/** Telegram's descriptions for rejected setMessageReaction requests. */
const SET_MESSAGE_REACTION_PARAMETERS_INVALID_DESCRIPTION =
  'Bad Request: invalid setMessageReaction parameters';
const MESSAGE_TO_REACT_NOT_FOUND_DESCRIPTION = 'Bad Request: message to react not found';
/**
 * Telegram's servers refuse reactions as `messages.sendReaction` documents its errors, which the
 * official server reports under these names: a reaction that is not allowed on the message, more
 * reactions than a user may choose or than a message may show, and a member that may not react.
 */
const REACTION_INVALID_DESCRIPTION = 'Bad Request: REACTION_INVALID';
const REACTIONS_TOO_MANY_DESCRIPTION = 'Bad Request: REACTIONS_TOO_MANY';
const REACTION_NOT_PERMITTED_DESCRIPTION = 'Forbidden: CHAT_WRITE_FORBIDDEN';
const PRIVATE_CHAT_REACTIONS_UNSUPPORTED_DESCRIPTION =
  'Bad Request: reactions in private chats are not supported';

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
 * since no emulated chat allows one.
 */
function handleSetMessageReaction(
  context: BotApiMethodContext,
  parameters: BotApiRequestParameters,
): BotApiMethodAnswer {
  const parsedParameters = setMessageReactionParametersSchema.safeParse(parameters);
  if (!parsedParameters.success) {
    return botApiError(400, SET_MESSAGE_REACTION_PARAMETERS_INVALID_DESCRIPTION);
  }
  const { chat_id: chatId, message_id: messageId, reaction } = parsedParameters.data;
  const reactionTypes = readReactionTypesParameter(
    reaction,
    SET_MESSAGE_REACTION_PARAMETERS_INVALID_DESCRIPTION,
  );
  if (!reactionTypes.read) {
    return botApiError(400, reactionTypes.description);
  }
  if (reactionTypes.hasCustomEmoji) {
    return botApiError(400, REACTION_INVALID_DESCRIPTION);
  }
  if (chatId === undefined) {
    return botApiError(400, CHAT_ID_EMPTY_DESCRIPTION);
  }

  const result = context.session.botApi.setMessageReaction(context.bot, {
    chatId,
    messageId: messageIdOrNone(messageId),
    emojis: reactionTypes.emojis,
  });
  if (result.set) {
    return botApiResult(true);
  }
  switch (result.reason) {
    case 'chat_not_found':
    case 'bot_not_a_member':
    case 'bot_kicked':
      return supergroupBotAccessFailureAnswer(result.reason);
    case 'private_chat_reactions_unsupported':
      return botApiError(400, PRIVATE_CHAT_REACTIONS_UNSUPPORTED_DESCRIPTION);
    case 'message_not_found':
      return botApiError(400, MESSAGE_TO_REACT_NOT_FOUND_DESCRIPTION);
    case 'message_not_reactable':
    case 'reaction_emoji_unsupported':
      return botApiError(400, REACTION_INVALID_DESCRIPTION);
    case 'reaction_not_permitted':
      return botApiError(403, REACTION_NOT_PERMITTED_DESCRIPTION);
    case 'too_many_reactions':
    case 'too_many_distinct_reactions':
      return botApiError(400, REACTIONS_TOO_MANY_DESCRIPTION);
    default: {
      const unhandledReason: never = result.reason;
      throw new Error(`Unhandled setMessageReaction failure: ${unhandledReason}`);
    }
  }
}
