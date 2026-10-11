import { z } from 'zod';

import { CHAT_ID_EMPTY_DESCRIPTION } from '../chat_access.ts';
import { presentMessageDeletionFailure } from '../errors/message_deletion_failure_presenter.ts';
import {
  INVALID_MESSAGE_IDENTIFIER_DESCRIPTION,
  MESSAGE_IDENTIFIERS_NOT_SPECIFIED_DESCRIPTION,
  messageIdOrNone,
  TOO_MANY_MESSAGE_IDENTIFIERS_DESCRIPTION,
} from '../message_identifiers.ts';
import {
  answeredPreparation,
  type BotApiCallPreparation,
  botApiError,
  type BotApiMethod,
  type BotApiMethodContext,
  botApiResult,
} from '../method_call.ts';
import {
  type BotApiRequestParameters,
  integerParameter,
  jsonParameter,
} from '../request_parameters.ts';

/** The methods that delete messages, each executed as a command in its call's transaction. */
export const MESSAGE_DELETION_METHODS: readonly BotApiMethod[] = [
  { name: 'deleteMessage', recordsActivity: true, prepare: prepareDeleteMessage },
  { name: 'deleteMessages', recordsActivity: true, prepare: prepareDeleteMessages },
];

/** Telegram deletes at most 100 messages in one deleteMessages request. */
const MAX_DELETE_MESSAGES_COUNT = 100;

const deleteMessageParametersSchema = z.strictObject({
  chat_id: integerParameter(z.int()).optional(),
  message_id: integerParameter(z.int()).optional(),
});

// Telegram also accepts message identifiers written as strings; rejecting them instead surfaces
// the bot's mistake in tests.
const deleteMessagesParametersSchema = z.strictObject({
  chat_id: integerParameter(z.int()).optional(),
  message_ids: jsonParameter(z.array(z.int())).optional(),
});

/**
 * Prepares `deleteMessage`: it reads the chat and the message; finding them, and every check of
 * the bot's right to delete, waits for the call's execution.
 */
function prepareDeleteMessage(
  context: BotApiMethodContext,
  parameters: BotApiRequestParameters,
): BotApiCallPreparation {
  const parsedParameters = deleteMessageParametersSchema.safeParse(parameters);
  if (!parsedParameters.success) {
    return answeredPreparation(botApiError(400, 'Bad Request: invalid deleteMessage parameters'));
  }
  const { chat_id: chatId, message_id: messageId } = parsedParameters.data;
  // Telegram looks at the chat before the message.
  if (chatId === undefined) {
    return answeredPreparation(botApiError(400, CHAT_ID_EMPTY_DESCRIPTION));
  }

  return {
    kind: 'command',
    execute: () => {
      const result = context.session.botApi.deleteMessage(
        context.bot,
        { chatId, messageId: messageIdOrNone(messageId) },
      );
      return result.deleted ? botApiResult(true) : presentMessageDeletionFailure(result);
    },
  };
}

/**
 * Prepares `deleteMessages`: it reads the message identifiers and the chat; finding them, and
 * every check of the bot's right to delete, waits for the call's execution, which deletes every
 * message or none.
 */
function prepareDeleteMessages(
  context: BotApiMethodContext,
  parameters: BotApiRequestParameters,
): BotApiCallPreparation {
  const parsedParameters = deleteMessagesParametersSchema.safeParse(parameters);
  if (!parsedParameters.success) {
    return answeredPreparation(botApiError(400, 'Bad Request: invalid deleteMessages parameters'));
  }
  const { chat_id: chatId, message_ids: messageIds } = parsedParameters.data;
  // Telegram checks the message identifiers before it looks at the chat.
  if (messageIds === undefined) {
    return answeredPreparation(botApiError(400, MESSAGE_IDENTIFIERS_NOT_SPECIFIED_DESCRIPTION));
  }
  if (messageIds.length > MAX_DELETE_MESSAGES_COUNT) {
    return answeredPreparation(botApiError(400, TOO_MANY_MESSAGE_IDENTIFIERS_DESCRIPTION));
  }
  if (messageIds.some((messageId) => messageId <= 0)) {
    return answeredPreparation(botApiError(400, INVALID_MESSAGE_IDENTIFIER_DESCRIPTION));
  }
  if (chatId === undefined) {
    return answeredPreparation(botApiError(400, CHAT_ID_EMPTY_DESCRIPTION));
  }

  return {
    kind: 'command',
    execute: () => {
      const result = context.session.botApi.deleteMessages(context.bot, { chatId, messageIds });
      return result.deleted ? botApiResult(true) : presentMessageDeletionFailure(result);
    },
  };
}
