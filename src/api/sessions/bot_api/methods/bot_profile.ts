import { z } from 'zod';

import {
  MAX_BOT_COMMAND_DESCRIPTION_LENGTH,
  MAX_BOT_COMMAND_LENGTH,
} from '../../../../types/bot_command.ts';
import type { EmulationSession } from '../../../../types/emulation_session.ts';
import {
  botCommandScopeParameter,
  botCommandsParameter,
  readBotCommandScopeParameter,
} from '../bot_command_parameters.ts';
import { resolveChatIdentifier, supergroupBotAccessFailureAnswer } from '../chat_access.ts';
import { readChatAdministratorRightsParameter } from '../chat_administrator_rights_parameter.ts';
import { readMenuButtonParameter } from '../menu_button_parameter.ts';
import {
  BAD_REQUEST_PREFIX,
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

/** The methods that read or change how the bot presents itself: its identity, commands, default administrator rights, menu button and descriptions. */
export const BOT_PROFILE_METHODS: readonly BotApiMethod[] = [
  { name: 'deleteMyCommands', handler: handleDeleteMyCommands },
  { name: 'getChatMenuButton', handler: handleGetChatMenuButton },
  { name: 'getMe', handler: handleGetMe },
  { name: 'getMyCommands', handler: handleGetMyCommands },
  { name: 'getMyDefaultAdministratorRights', handler: handleGetMyDefaultAdministratorRights },
  { name: 'getMyDescription', handler: handleGetMyDescription },
  { name: 'getMyShortDescription', handler: handleGetMyShortDescription },
  { name: 'setChatMenuButton', handler: handleSetChatMenuButton },
  { name: 'setMyCommands', handler: handleSetMyCommands },
  { name: 'setMyDefaultAdministratorRights', handler: handleSetMyDefaultAdministratorRights },
  { name: 'setMyDescription', handler: handleSetMyDescription },
  { name: 'setMyShortDescription', handler: handleSetMyShortDescription },
];

/** Telegram's descriptions for rejected command list changes. */
const SCOPE_NOT_ALLOWED_IN_PRIVATE_CHATS_DESCRIPTION =
  "Bad Request: can't use specified scope in private chats";
const LANGUAGE_CODE_INVALID_DESCRIPTION = 'Bad Request: invalid language code specified';
const BOT_COMMAND_FAILURE_DESCRIPTIONS = {
  command_not_utf8: 'Bad Request: command must be encoded in UTF-8',
  command_description_not_utf8: 'Bad Request: command description must be encoded in UTF-8',
  command_empty: 'Bad Request: command must be non-empty',
  command_too_long: `Bad Request: command length must not exceed ${MAX_BOT_COMMAND_LENGTH}`,
  command_description_empty: 'Bad Request: command description must be non-empty',
  command_description_too_long:
    `Bad Request: command description length must not exceed ${MAX_BOT_COMMAND_DESCRIPTION_LENGTH}`,
  too_many_commands: 'Bad Request: BOT_COMMANDS_TOO_MUCH',
  command_invalid: 'Bad Request: BOT_COMMAND_INVALID',
} as const;

/** Telegram's descriptions for rejected menu buttons and the users they are for. */
const CHAT_ID_INVALID_DESCRIPTION = 'Bad Request: invalid chat_id specified';
const USER_NOT_FOUND_DESCRIPTION = 'Bad Request: user not found';
const MENU_BUTTON_FAILURE_DESCRIPTIONS = {
  user_not_found: USER_NOT_FOUND_DESCRIPTION,
  menu_button_text_empty: 'Bad Request: menu button text must be non-empty',
  menu_button_text_not_utf8: 'Bad Request: menu button text must be encoded in UTF-8',
  menu_button_url_not_utf8: 'Bad Request: menu button URL must be encoded in UTF-8',
} as const;

const getMeParametersSchema = z.strictObject({});

// Telegram treats a missing commands parameter as an empty list, which deletes the list.
const setMyCommandsParametersSchema = z.strictObject({
  commands: botCommandsParameter().default([]),
  scope: botCommandScopeParameter().optional(),
  language_code: z.string().default(''),
});

/** Parameters of getMyCommands and deleteMyCommands, which address one command list. */
const myCommandsTargetParametersSchema = z.strictObject({
  scope: botCommandScopeParameter().optional(),
  language_code: z.string().default(''),
});

const setMyDescriptionParametersSchema = z.strictObject({
  description: z.string().default(''),
  language_code: z.string().default(''),
});

const setMyShortDescriptionParametersSchema = z.strictObject({
  short_description: z.string().default(''),
  language_code: z.string().default(''),
});

/** Parameters of getMyDescription and getMyShortDescription, which address one language. */
const myDescriptionTargetParametersSchema = z.strictObject({
  language_code: z.string().default(''),
});

const setMyDefaultAdministratorRightsParametersSchema = z.strictObject({
  rights: z.string().optional(),
  for_channels: booleanParameter().default(false),
});

const getMyDefaultAdministratorRightsParametersSchema = z.strictObject({
  for_channels: booleanParameter().default(false),
});

// `chat_id` names a private chat by its user's ID. Telegram answers `@username` there as an invalid
// chat_id; the emulator resolves every method's usernames first, so such a request fails as for the
// chat the username names instead.
const setChatMenuButtonParametersSchema = z.strictObject({
  chat_id: integerParameter(z.int()).optional(),
  menu_button: z.string().optional(),
});

const getChatMenuButtonParametersSchema = z.strictObject({
  chat_id: integerParameter(z.int()).optional(),
});

type MyCommandsTarget = Parameters<EmulationSession['botApi']['getMyCommands']>[1];

type MyCommandsTargetFailureReason = Extract<
  ReturnType<EmulationSession['botApi']['getMyCommands']>,
  { readonly found: false }
>['reason'];

function handleGetMe(
  context: BotApiMethodContext,
  parameters: BotApiRequestParameters,
): BotApiMethodAnswer {
  if (!getMeParametersSchema.safeParse(parameters).success) {
    return botApiError(400, 'Bad Request: invalid getMe parameters');
  }
  return botApiResult(context.bot);
}

function handleSetMyCommands(
  context: BotApiMethodContext,
  parameters: BotApiRequestParameters,
): BotApiMethodAnswer {
  const invalidParametersDescription = 'Bad Request: invalid setMyCommands parameters';
  const parsedParameters = setMyCommandsParametersSchema.safeParse(parameters);
  if (!parsedParameters.success) {
    return botApiError(400, invalidParametersDescription);
  }
  const { commands, scope, language_code: languageCode } = parsedParameters.data;
  const targetReading = readMyCommandsTarget(
    context,
    { scope, languageCode },
    invalidParametersDescription,
  );
  if (!targetReading.read) {
    return targetReading.errorAnswer;
  }

  const result = context.session.botApi.setMyCommands(
    context.bot,
    { commands, ...targetReading.target },
  );
  if (result.set) {
    return botApiResult(true);
  }
  switch (result.reason) {
    case 'chat_not_found':
    case 'bot_not_a_member':
    case 'bot_kicked':
    case 'scope_not_allowed_in_private_chats':
    case 'language_code_invalid':
      return myCommandsTargetError(result.reason);
    default:
      return botApiError(400, BOT_COMMAND_FAILURE_DESCRIPTIONS[result.reason]);
  }
}

function handleGetMyCommands(
  context: BotApiMethodContext,
  parameters: BotApiRequestParameters,
): BotApiMethodAnswer {
  const invalidParametersDescription = 'Bad Request: invalid getMyCommands parameters';
  const parsedParameters = myCommandsTargetParametersSchema.safeParse(parameters);
  if (!parsedParameters.success) {
    return botApiError(400, invalidParametersDescription);
  }
  const targetReading = readMyCommandsTarget(context, {
    scope: parsedParameters.data.scope,
    languageCode: parsedParameters.data.language_code,
  }, invalidParametersDescription);
  if (!targetReading.read) {
    return targetReading.errorAnswer;
  }

  const result = context.session.botApi.getMyCommands(
    context.bot,
    targetReading.target,
  );
  return result.found ? botApiResult(result.commands) : myCommandsTargetError(result.reason);
}

function handleDeleteMyCommands(
  context: BotApiMethodContext,
  parameters: BotApiRequestParameters,
): BotApiMethodAnswer {
  const invalidParametersDescription = 'Bad Request: invalid deleteMyCommands parameters';
  const parsedParameters = myCommandsTargetParametersSchema.safeParse(parameters);
  if (!parsedParameters.success) {
    return botApiError(400, invalidParametersDescription);
  }
  const targetReading = readMyCommandsTarget(context, {
    scope: parsedParameters.data.scope,
    languageCode: parsedParameters.data.language_code,
  }, invalidParametersDescription);
  if (!targetReading.read) {
    return targetReading.errorAnswer;
  }

  const result = context.session.botApi.deleteMyCommands(
    context.bot,
    targetReading.target,
  );
  return result.deleted ? botApiResult(true) : myCommandsTargetError(result.reason);
}

/** Reads the scope and language that address one of the bot's command lists. */
function readMyCommandsTarget(
  context: BotApiMethodContext,
  { scope, languageCode }: { readonly scope: unknown; readonly languageCode: string },
  invalidParametersDescription: string,
):
  | { readonly read: true; readonly target: MyCommandsTarget }
  | { readonly read: false; readonly errorAnswer: BotApiMethodAnswer } {
  const scopeReading = readBotCommandScopeParameter(
    scope,
    invalidParametersDescription,
    (chatIdentifier) => resolveChatIdentifier(context, chatIdentifier),
  );
  if (!scopeReading.read) {
    return { read: false, errorAnswer: botApiError(400, scopeReading.description) };
  }
  return { read: true, target: { scope: scopeReading.scope, languageCode } };
}

function myCommandsTargetError(reason: MyCommandsTargetFailureReason): BotApiMethodAnswer {
  switch (reason) {
    case 'chat_not_found':
    case 'bot_not_a_member':
    case 'bot_kicked':
      return supergroupBotAccessFailureAnswer(reason);
    case 'scope_not_allowed_in_private_chats':
      return botApiError(400, SCOPE_NOT_ALLOWED_IN_PRIVATE_CHATS_DESCRIPTION);
    case 'language_code_invalid':
      return botApiError(400, LANGUAGE_CODE_INVALID_DESCRIPTION);
    default: {
      const unhandledReason: never = reason;
      throw new Error(`Unhandled command list failure: ${unhandledReason}`);
    }
  }
}

function handleSetMyDefaultAdministratorRights(
  context: BotApiMethodContext,
  parameters: BotApiRequestParameters,
): BotApiMethodAnswer {
  const invalidParametersDescription =
    'Bad Request: invalid setMyDefaultAdministratorRights parameters';
  const parsedParameters = setMyDefaultAdministratorRightsParametersSchema.safeParse(parameters);
  if (!parsedParameters.success) {
    return botApiError(400, invalidParametersDescription);
  }
  const rightsReading = readChatAdministratorRightsParameter(
    parsedParameters.data.rights,
    invalidParametersDescription,
  );
  if (!rightsReading.read) {
    return botApiError(400, rightsReading.description);
  }
  context.session.botApi.setMyDefaultAdministratorRights(context.bot, {
    kind: parsedParameters.data.for_channels ? 'channel' : 'group',
    requestedRights: rightsReading.requestedRights,
  });
  return botApiResult(true);
}

function handleGetMyDefaultAdministratorRights(
  context: BotApiMethodContext,
  parameters: BotApiRequestParameters,
): BotApiMethodAnswer {
  const parsedParameters = getMyDefaultAdministratorRightsParametersSchema.safeParse(parameters);
  if (!parsedParameters.success) {
    return botApiError(400, 'Bad Request: invalid getMyDefaultAdministratorRights parameters');
  }
  return botApiResult(
    context.session.botApi.getMyDefaultAdministratorRights(
      context.bot,
      parsedParameters.data.for_channels ? 'channel' : 'group',
    ),
  );
}

/**
 * Sets the bot's menu button for all its private chats, or with `chat_id` for its chat with that
 * user. The button is read before the chat, as the official server's
 * `process_set_chat_menu_button_query` does.
 */
function handleSetChatMenuButton(
  context: BotApiMethodContext,
  parameters: BotApiRequestParameters,
): BotApiMethodAnswer {
  const invalidParametersDescription = 'Bad Request: invalid setChatMenuButton parameters';
  const parsedParameters = setChatMenuButtonParametersSchema.safeParse(parameters);
  if (!parsedParameters.success) {
    return botApiError(400, invalidParametersDescription);
  }
  const menuButtonReading = readMenuButtonParameter(
    parsedParameters.data.menu_button,
    invalidParametersDescription,
  );
  if (!menuButtonReading.read) {
    return botApiError(400, menuButtonReading.description);
  }
  const { chat_id: userId } = parsedParameters.data;
  if (userId !== undefined && userId <= 0) {
    return botApiError(400, CHAT_ID_INVALID_DESCRIPTION);
  }

  const result = context.session.botApi.setChatMenuButton(context.bot, {
    userId,
    menuButton: menuButtonReading.menuButton,
  });
  if (result.set) {
    return botApiResult(true);
  }
  return result.reason === 'web_app_url_invalid'
    ? botApiError(400, `${BAD_REQUEST_PREFIX}menu button Web App ${result.urlError}`)
    : botApiError(400, MENU_BUTTON_FAILURE_DESCRIPTIONS[result.reason]);
}

function handleGetChatMenuButton(
  context: BotApiMethodContext,
  parameters: BotApiRequestParameters,
): BotApiMethodAnswer {
  const parsedParameters = getChatMenuButtonParametersSchema.safeParse(parameters);
  if (!parsedParameters.success) {
    return botApiError(400, 'Bad Request: invalid getChatMenuButton parameters');
  }
  const { chat_id: userId } = parsedParameters.data;
  if (userId !== undefined && userId <= 0) {
    return botApiError(400, CHAT_ID_INVALID_DESCRIPTION);
  }
  const result = context.session.botApi.getChatMenuButton(context.bot, userId);
  return result.found
    ? botApiResult(result.menuButton)
    : botApiError(400, USER_NOT_FOUND_DESCRIPTION);
}

function handleSetMyDescription(
  context: BotApiMethodContext,
  parameters: BotApiRequestParameters,
): BotApiMethodAnswer {
  const parsedParameters = setMyDescriptionParametersSchema.safeParse(parameters);
  if (!parsedParameters.success) {
    return botApiError(400, 'Bad Request: invalid setMyDescription parameters');
  }
  return setMyDescription(context, {
    kind: 'description',
    text: parsedParameters.data.description,
    languageCode: parsedParameters.data.language_code,
  });
}

function handleSetMyShortDescription(
  context: BotApiMethodContext,
  parameters: BotApiRequestParameters,
): BotApiMethodAnswer {
  const parsedParameters = setMyShortDescriptionParametersSchema.safeParse(parameters);
  if (!parsedParameters.success) {
    return botApiError(400, 'Bad Request: invalid setMyShortDescription parameters');
  }
  return setMyDescription(context, {
    kind: 'short_description',
    text: parsedParameters.data.short_description,
    languageCode: parsedParameters.data.language_code,
  });
}

function setMyDescription(
  context: BotApiMethodContext,
  request: Parameters<EmulationSession['botApi']['setMyDescription']>[1],
): BotApiMethodAnswer {
  const result = context.session.botApi.setMyDescription(context.bot, request);
  if (result.set) {
    return botApiResult(true);
  }
  switch (result.reason) {
    case 'text_not_utf8':
      return botApiError(400, STRINGS_NOT_UTF8_DESCRIPTION);
    case 'language_code_invalid':
      return botApiError(400, LANGUAGE_CODE_INVALID_DESCRIPTION);
    default: {
      const unhandledReason: never = result.reason;
      throw new Error(`Unhandled description failure: ${unhandledReason}`);
    }
  }
}

function handleGetMyDescription(
  context: BotApiMethodContext,
  parameters: BotApiRequestParameters,
): BotApiMethodAnswer {
  const parsedParameters = myDescriptionTargetParametersSchema.safeParse(parameters);
  if (!parsedParameters.success) {
    return botApiError(400, 'Bad Request: invalid getMyDescription parameters');
  }
  const result = context.session.botApi.getMyDescription(context.bot, {
    kind: 'description',
    languageCode: parsedParameters.data.language_code,
  });
  return result.found
    ? botApiResult({ description: result.text })
    : botApiError(400, LANGUAGE_CODE_INVALID_DESCRIPTION);
}

function handleGetMyShortDescription(
  context: BotApiMethodContext,
  parameters: BotApiRequestParameters,
): BotApiMethodAnswer {
  const parsedParameters = myDescriptionTargetParametersSchema.safeParse(parameters);
  if (!parsedParameters.success) {
    return botApiError(400, 'Bad Request: invalid getMyShortDescription parameters');
  }
  const result = context.session.botApi.getMyDescription(context.bot, {
    kind: 'short_description',
    languageCode: parsedParameters.data.language_code,
  });
  return result.found
    ? botApiResult({ short_description: result.text })
    : botApiError(400, LANGUAGE_CODE_INVALID_DESCRIPTION);
}
