import { z } from 'zod';

import { CHAT_ID_EMPTY_DESCRIPTION, supergroupBotAccessFailureAnswer } from '../chat_access.ts';
import {
  INVALID_MESSAGE_IDENTIFIER_DESCRIPTION,
  MESSAGE_IDENTIFIERS_NOT_SPECIFIED_DESCRIPTION,
  messageIdOrNone,
  TOO_MANY_MESSAGE_IDENTIFIERS_DESCRIPTION,
} from '../message_identifiers.ts';
import {
  botApiError,
  type BotApiMethod,
  type BotApiMethodAnswer,
  type BotApiMethodContext,
  botApiResult,
} from '../method_call.ts';
import {
  type BotApiRequestParameters,
  integerParameter,
  jsonParameter,
} from '../request_parameters.ts';

/** The methods that delete messages. */
export const MESSAGE_DELETION_METHODS: readonly BotApiMethod[] = [
  { name: 'deleteMessage', recordsActivity: true, handler: handleDeleteMessage },
  { name: 'deleteMessages', recordsActivity: true, handler: handleDeleteMessages },
];

/** Telegram's descriptions for rejected message deletions. */
const MESSAGE_TO_DELETE_NOT_FOUND_DESCRIPTION = 'Bad Request: message to delete not found';
const MESSAGE_NOT_DELETABLE_DESCRIPTION = "Bad Request: message can't be deleted";

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

function handleDeleteMessage(
  context: BotApiMethodContext,
  parameters: BotApiRequestParameters,
): BotApiMethodAnswer {
  const parsedParameters = deleteMessageParametersSchema.safeParse(parameters);
  if (!parsedParameters.success) {
    return botApiError(400, 'Bad Request: invalid deleteMessage parameters');
  }
  const { chat_id: chatId, message_id: messageId } = parsedParameters.data;
  // Telegram looks at the chat before the message.
  if (chatId === undefined) {
    return botApiError(400, CHAT_ID_EMPTY_DESCRIPTION);
  }

  const result = context.session.botApi.deleteMessage(
    context.bot,
    { chatId, messageId: messageIdOrNone(messageId) },
  );
  if (result.deleted) {
    return botApiResult(true);
  }
  switch (result.reason) {
    case 'chat_not_found':
    case 'bot_not_a_member':
    case 'bot_kicked':
      return supergroupBotAccessFailureAnswer(result.reason);
    case 'message_not_found':
      return botApiError(400, MESSAGE_TO_DELETE_NOT_FOUND_DESCRIPTION);
    case 'message_not_deletable':
      return botApiError(400, MESSAGE_NOT_DELETABLE_DESCRIPTION);
    default: {
      const unhandledReason: never = result.reason;
      throw new Error(`Unhandled deleteMessage failure: ${unhandledReason}`);
    }
  }
}

function handleDeleteMessages(
  context: BotApiMethodContext,
  parameters: BotApiRequestParameters,
): BotApiMethodAnswer {
  const parsedParameters = deleteMessagesParametersSchema.safeParse(parameters);
  if (!parsedParameters.success) {
    return botApiError(400, 'Bad Request: invalid deleteMessages parameters');
  }
  const { chat_id: chatId, message_ids: messageIds } = parsedParameters.data;
  // Telegram checks the message identifiers before it looks at the chat.
  if (messageIds === undefined) {
    return botApiError(400, MESSAGE_IDENTIFIERS_NOT_SPECIFIED_DESCRIPTION);
  }
  if (messageIds.length > MAX_DELETE_MESSAGES_COUNT) {
    return botApiError(400, TOO_MANY_MESSAGE_IDENTIFIERS_DESCRIPTION);
  }
  if (messageIds.some((messageId) => messageId <= 0)) {
    return botApiError(400, INVALID_MESSAGE_IDENTIFIER_DESCRIPTION);
  }
  if (chatId === undefined) {
    return botApiError(400, CHAT_ID_EMPTY_DESCRIPTION);
  }

  const result = context.session.botApi.deleteMessages(
    context.bot,
    { chatId, messageIds },
  );
  if (result.deleted) {
    return botApiResult(true);
  }
  switch (result.reason) {
    case 'chat_not_found':
    case 'bot_not_a_member':
    case 'bot_kicked':
      return supergroupBotAccessFailureAnswer(result.reason);
    case 'message_not_deletable':
      return botApiError(400, MESSAGE_NOT_DELETABLE_DESCRIPTION);
    default: {
      const unhandledReason: never = result.reason;
      throw new Error(`Unhandled deleteMessages failure: ${unhandledReason}`);
    }
  }
}
