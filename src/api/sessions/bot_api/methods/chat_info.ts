import { z } from 'zod';

import type { SupergroupBotAccessFailureReason } from '../../../../types/chat_membership.ts';
import { CHAT_ID_EMPTY_DESCRIPTION, supergroupBotAccessFailureAnswer } from '../chat_access.ts';
import { chatMemberFailureAnswer } from '../chat_member_requests.ts';
import { readChatPermissionsParameter } from '../chat_permissions_parameter.ts';
import {
  botApiError,
  type BotApiMethod,
  type BotApiMethodAnswer,
  type BotApiMethodContext,
  botApiResult,
  STRINGS_NOT_UTF8_DESCRIPTION,
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

/** TDLib's descriptions for a chat whose title or description a bot cannot change. */
const CHAT_TITLE_EMPTY_DESCRIPTION = 'Bad Request: title must be non-empty';
const NOT_ENOUGH_RIGHTS_TO_CHANGE_TITLE_DESCRIPTION =
  'Bad Request: not enough rights to change chat title';
const NOT_ENOUGH_RIGHTS_TO_SET_DESCRIPTION_DESCRIPTION =
  'Bad Request: not enough rights to set chat description';
const PRIVATE_CHAT_TITLE_UNCHANGEABLE_DESCRIPTION = "Bad Request: can't change private chat title";
const PRIVATE_CHAT_DESCRIPTION_UNCHANGEABLE_DESCRIPTION =
  "Bad Request: can't change private chat description";
const NOT_ENOUGH_RIGHTS_TO_CHANGE_PERMISSIONS_DESCRIPTION =
  'Bad Request: not enough rights to change chat permissions';
const PRIVATE_CHAT_PERMISSIONS_UNCHANGEABLE_DESCRIPTION =
  "Bad Request: can't change private chat permissions";
/** The official server's description of Telegram's refusal of an unchanged description. */
const CHAT_DESCRIPTION_NOT_MODIFIED_DESCRIPTION = 'Bad Request: chat description is not modified';

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
  if (result.set) {
    return botApiResult(true);
  }
  switch (result.reason) {
    case 'title_empty':
      return botApiError(400, CHAT_TITLE_EMPTY_DESCRIPTION);
    case 'not_enough_rights':
      return botApiError(400, NOT_ENOUGH_RIGHTS_TO_CHANGE_TITLE_DESCRIPTION);
    case 'private_chat_info_unchangeable':
      return botApiError(400, PRIVATE_CHAT_TITLE_UNCHANGEABLE_DESCRIPTION);
    default:
      return chatInfoChangeFailureAnswer(result.reason);
  }
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
  if (result.set) {
    return botApiResult(true);
  }
  switch (result.reason) {
    case 'description_not_modified':
      return botApiError(400, CHAT_DESCRIPTION_NOT_MODIFIED_DESCRIPTION);
    case 'not_enough_rights':
      return botApiError(400, NOT_ENOUGH_RIGHTS_TO_SET_DESCRIPTION_DESCRIPTION);
    case 'private_chat_info_unchangeable':
      return botApiError(400, PRIVATE_CHAT_DESCRIPTION_UNCHANGEABLE_DESCRIPTION);
    default:
      return chatInfoChangeFailureAnswer(result.reason);
  }
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
  if (result.set) {
    return botApiResult(true);
  }
  switch (result.reason) {
    case 'not_enough_rights':
      return botApiError(400, NOT_ENOUGH_RIGHTS_TO_CHANGE_PERMISSIONS_DESCRIPTION);
    case 'private_chat_permissions_unchangeable':
      return botApiError(400, PRIVATE_CHAT_PERMISSIONS_UNCHANGEABLE_DESCRIPTION);
    default:
      return chatInfoChangeFailureAnswer(result.reason);
  }
}

/** Telegram's error for a chat whose information a bot cannot reach, or text it cannot read. */
function chatInfoChangeFailureAnswer(
  reason: SupergroupBotAccessFailureReason | 'text_encoding_invalid',
): BotApiMethodAnswer {
  switch (reason) {
    case 'chat_not_found':
    case 'bot_not_a_member':
    case 'bot_kicked':
      return supergroupBotAccessFailureAnswer(reason);
    case 'text_encoding_invalid':
      return botApiError(400, STRINGS_NOT_UTF8_DESCRIPTION);
    default: {
      const unhandledReason: never = reason;
      throw new Error(`Unhandled chat information failure: ${unhandledReason}`);
    }
  }
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
  return result.found ? botApiResult(result.chat) : chatMemberFailureAnswer(result.reason);
}
