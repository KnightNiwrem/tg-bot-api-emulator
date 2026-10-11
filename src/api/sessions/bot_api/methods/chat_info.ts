import { z } from 'zod';

import { botChatAccessFailureAnswer, CHAT_ID_EMPTY_DESCRIPTION } from '../chat_access.ts';
import { readChatPermissionsParameter } from '../chat_permissions_parameter.ts';
import { presentChatInfoChangeFailure } from '../errors/chat_info_failure_presenter.ts';
import {
  botApiError,
  type BotApiMethod,
  type BotApiMethodAnswer,
  type BotApiMethodContext,
  botApiResult,
} from '../method_call.ts';
import {
  booleanParameter,
  type BotApiRequestParameters,
  integerParameter,
} from '../request_parameters.ts';

/** The methods that read a chat, or change its title, description or permissions. */
export const CHAT_INFO_METHODS: readonly BotApiMethod[] = [
  { name: 'getChat', recordsActivity: true, handler: handleGetChat },
  { name: 'setChatDescription', recordsActivity: true, handler: handleSetChatDescription },
  { name: 'setChatPermissions', recordsActivity: true, handler: handleSetChatPermissions },
  { name: 'setChatTitle', recordsActivity: true, handler: handleSetChatTitle },
];

// Telegram reads a missing title or description as empty text.
const setChatTitleParametersSchema = z.strictObject({
  chat_id: integerParameter(z.int()).optional(),
  title: z.string().default(''),
});

const setChatDescriptionParametersSchema = z.strictObject({
  chat_id: integerParameter(z.int()).optional(),
  description: z.string().default(''),
});

// As for restrictChatMember, the deprecated permissions given as separate parameters are refused.
const setChatPermissionsParametersSchema = z.strictObject({
  chat_id: integerParameter(z.int()).optional(),
  permissions: z.string().optional(),
  use_independent_chat_permissions: booleanParameter().default(false),
});

const getChatParametersSchema = z.strictObject({
  chat_id: integerParameter(z.int()).optional(),
});

function handleSetChatTitle(
  context: BotApiMethodContext,
  parameters: BotApiRequestParameters,
): BotApiMethodAnswer {
  const parsedParameters = setChatTitleParametersSchema.safeParse(parameters);
  if (!parsedParameters.success) {
    return botApiError(400, 'Bad Request: invalid setChatTitle parameters');
  }
  const { chat_id: chatId, title } = parsedParameters.data;
  if (chatId === undefined) {
    return botApiError(400, CHAT_ID_EMPTY_DESCRIPTION);
  }
  const result = context.session.botApi.setChatTitle(context.bot, { chatId, title });
  return result.set
    ? botApiResult(true)
    : presentChatInfoChangeFailure('chat_title_change', result);
}

function handleSetChatDescription(
  context: BotApiMethodContext,
  parameters: BotApiRequestParameters,
): BotApiMethodAnswer {
  const parsedParameters = setChatDescriptionParametersSchema.safeParse(parameters);
  if (!parsedParameters.success) {
    return botApiError(400, 'Bad Request: invalid setChatDescription parameters');
  }
  const { chat_id: chatId, description } = parsedParameters.data;
  if (chatId === undefined) {
    return botApiError(400, CHAT_ID_EMPTY_DESCRIPTION);
  }
  const result = context.session.botApi.setChatDescription(context.bot, { chatId, description });
  return result.set
    ? botApiResult(true)
    : presentChatInfoChangeFailure('chat_description_change', result);
}

function handleSetChatPermissions(
  context: BotApiMethodContext,
  parameters: BotApiRequestParameters,
): BotApiMethodAnswer {
  const invalidParametersDescription = 'Bad Request: invalid setChatPermissions parameters';
  const parsedParameters = setChatPermissionsParametersSchema.safeParse(parameters);
  if (!parsedParameters.success) {
    return botApiError(400, invalidParametersDescription);
  }
  const { data } = parsedParameters;
  // Telegram reads the permissions before it looks at the chat.
  const permissionsReading = readChatPermissionsParameter(data.permissions, {
    usesIndependentChatPermissions: data.use_independent_chat_permissions,
    invalidParametersDescription,
  });
  if (!permissionsReading.read) {
    return botApiError(400, permissionsReading.description);
  }
  if (data.chat_id === undefined) {
    return botApiError(400, CHAT_ID_EMPTY_DESCRIPTION);
  }
  const result = context.session.botApi.setChatPermissions(context.bot, {
    chatId: data.chat_id,
    permissions: permissionsReading.permissions,
  });
  return result.set
    ? botApiResult(true)
    : presentChatInfoChangeFailure('chat_permissions_change', result);
}

function handleGetChat(
  context: BotApiMethodContext,
  parameters: BotApiRequestParameters,
): BotApiMethodAnswer {
  const parsedParameters = getChatParametersSchema.safeParse(parameters);
  if (!parsedParameters.success) {
    return botApiError(400, 'Bad Request: invalid getChat parameters');
  }
  const { chat_id: chatId } = parsedParameters.data;
  if (chatId === undefined) {
    return botApiError(400, CHAT_ID_EMPTY_DESCRIPTION);
  }

  const result = context.session.botApi.getChat(context.bot, { chatId });
  return result.found ? botApiResult(result.chat) : botChatAccessFailureAnswer(result.reason);
}
