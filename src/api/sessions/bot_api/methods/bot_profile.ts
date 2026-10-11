import { z } from 'zod';

import type {
  BotApiBotCommand,
  BotApiBotDescription,
  BotApiBotShortDescription,
} from '../../../../types/bot_api.ts';
import type { BotCommand } from '../../../../types/bot_command.ts';
import { getApplicableAdministratorRightFlags } from '../../../../types/bot_default_administrator_rights.ts';
import { toBotApiMenuButton } from '../../../../types/bot_menu_button.ts';
import type { EmulationSession } from '../../../../session/emulation_session.ts';
import {
  excludeMissingBotFailure,
  missingAuthenticatedBotError,
} from '../authenticated_bot_failures.ts';
import {
  botCommandScopeParameter,
  botCommandsParameter,
  readBotCommandScopeParameter,
} from '../bot_command_parameters.ts';
import { resolveChatIdentifier } from '../chat_access.ts';
import { readChatAdministratorRightsParameter } from '../chat_administrator_rights_parameter.ts';
import { presentBotProfileFailure } from '../errors/bot_profile_failure_presenter.ts';
import { BOT_API_ERRORS } from '../errors/error_catalogue.ts';
import { presentFixedBotApiError } from '../errors/error_template.ts';
import { readMenuButtonParameter } from '../menu_button_parameter.ts';
import { type BotApiFamilyContext, type BotApiMethod, botApiResult } from '../method_call.ts';
import {
  answerWith,
  answerWithBadRequest,
  type BotApiStepCall,
  type BotApiStepResult,
  commandMethodOfSteps,
  handledMethodOfSteps,
  proceedWith,
  startSteps,
} from '../method_steps.ts';
import { booleanParameter, integerParameter } from '../request_parameters.ts';

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

/**
 * What the bot profile methods use: the services that keep the bot's command lists, descriptions,
 * default administrator rights and menu buttons.
 */
type BotProfileContext = BotApiFamilyContext<
  'botCommands' | 'botDescriptions' | 'botDefaultAdministratorRights' | 'botMenuButtons'
>;

/** The scope and language that address one of the bot's command lists. */
type MyCommandsTarget = Omit<
  Parameters<EmulationSession['botCommands']['getBotCommands']>[0],
  'botId'
>;

/**
 * The methods that read or change how the bot presents itself: its identity, commands, default
 * administrator rights, menu button and descriptions. Each change is executed as a command in its
 * call's transaction; the reads change nothing, and answer from their handlers.
 */
export const BOT_PROFILE_METHODS: readonly BotApiMethod[] = [
  handledMethodOfSteps({
    name: 'getMe',
    recordsActivity: true,
    parameters: getMeParametersSchema,
    steps: ({ parameters }) => startSteps(parameters),
    execute: (context) => botApiResult(context.bot),
  }),

  // As the official server's `process_set_my_commands_query` reads them: the commands, then the
  // scope and its chat.
  commandMethodOfSteps({
    name: 'setMyCommands',
    recordsActivity: true,
    parameters: setMyCommandsParametersSchema,
    steps: (call) =>
      startSteps(call.parameters).andThen(({ commands, ...target }) => {
        const targetReading = readMyCommandsTarget(call, target);
        return targetReading.proceeds
          ? proceedWith({ commands, ...targetReading.value })
          : targetReading;
      }),
    execute: (context: BotProfileContext, request) => {
      const result = context.session.botCommands.setBotCommands({
        botId: context.bot.id,
        ...request,
      });
      return result.set ? botApiResult(true) : presentBotProfileFailure({
        set: false,
        reason: excludeMissingBotFailure(context.bot, result.reason),
      });
    },
  }),
  handledMethodOfSteps({
    name: 'getMyCommands',
    recordsActivity: true,
    parameters: myCommandsTargetParametersSchema,
    steps: (call) =>
      startSteps(call.parameters).andThen((target) => readMyCommandsTarget(call, target)),
    execute: (context: BotProfileContext, target) => {
      const result = context.session.botCommands.getBotCommands({
        botId: context.bot.id,
        ...target,
      });
      return result.found
        ? botApiResult(result.commands.map(viewBotCommand))
        : presentBotProfileFailure({
          found: false,
          reason: excludeMissingBotFailure(context.bot, result.reason),
        });
    },
  }),
  commandMethodOfSteps({
    name: 'deleteMyCommands',
    recordsActivity: true,
    parameters: myCommandsTargetParametersSchema,
    steps: (call) =>
      startSteps(call.parameters).andThen((target) => readMyCommandsTarget(call, target)),
    execute: (context: BotProfileContext, target) => {
      const result = context.session.botCommands.deleteBotCommands({
        botId: context.bot.id,
        ...target,
      });
      return result.deleted ? botApiResult(true) : presentBotProfileFailure({
        deleted: false,
        reason: excludeMissingBotFailure(context.bot, result.reason),
      });
    },
  }),

  commandMethodOfSteps({
    name: 'setMyDefaultAdministratorRights',
    recordsActivity: true,
    parameters: setMyDefaultAdministratorRightsParametersSchema,
    steps: ({ parameters, invalidParametersDescription }) =>
      startSteps(parameters).andThen(({ rights, for_channels: forChannels }) => {
        const rightsReading = readChatAdministratorRightsParameter(
          rights,
          invalidParametersDescription,
        );
        return rightsReading.read
          ? proceedWith({
            kind: forChannels ? 'channel' as const : 'group' as const,
            requestedRights: rightsReading.requestedRights,
          })
          : answerWithBadRequest(rightsReading.description);
      }),
    execute: (context: BotProfileContext, request) => {
      const result = context.session.botDefaultAdministratorRights.setDefaultAdministratorRights({
        botId: context.bot.id,
        ...request,
      });
      if (!result.set) {
        throw missingAuthenticatedBotError(context.bot);
      }
      return botApiResult(true);
    },
  }),
  handledMethodOfSteps({
    name: 'getMyDefaultAdministratorRights',
    recordsActivity: true,
    parameters: getMyDefaultAdministratorRightsParametersSchema,
    steps: ({ parameters }) => startSteps(parameters),
    execute: (context: BotProfileContext, { for_channels: forChannels }) => {
      const kind = forChannels ? 'channel' : 'group';
      const result = context.session.botDefaultAdministratorRights.getDefaultAdministratorRights({
        botId: context.bot.id,
        kind,
      });
      if (!result.found) {
        throw missingAuthenticatedBotError(context.bot);
      }
      return botApiResult(getApplicableAdministratorRightFlags(kind, result.rights));
    },
  }),

  // Sets the bot's menu button for all its private chats, or with `chat_id` for its chat with that
  // user. The button is read before the chat, as the official server's
  // `process_set_chat_menu_button_query` does.
  commandMethodOfSteps({
    name: 'setChatMenuButton',
    recordsActivity: true,
    parameters: setChatMenuButtonParametersSchema,
    steps: ({ parameters, invalidParametersDescription }) =>
      startSteps(parameters)
        .andThen(({ menu_button: menuButtonText, chat_id: chatId }) => {
          const menuButtonReading = readMenuButtonParameter(
            menuButtonText,
            invalidParametersDescription,
          );
          return menuButtonReading.read
            ? proceedWith({ menuButton: menuButtonReading.menuButton, chatId })
            : answerWithBadRequest(menuButtonReading.description);
        })
        .andThen(({ menuButton, chatId }) => {
          const userReading = readMenuButtonUserId(chatId);
          return userReading.proceeds
            ? proceedWith({ menuButton, userId: userReading.value })
            : userReading;
        }),
    execute: (context: BotProfileContext, request) => {
      const result = context.session.botMenuButtons.setBotMenuButton({
        botId: context.bot.id,
        ...request,
      });
      if (result.set) {
        return botApiResult(true);
      }
      return result.reason === 'web_app_url_invalid'
        ? presentBotProfileFailure(result)
        : presentBotProfileFailure({
          set: false,
          reason: excludeMissingBotFailure(context.bot, result.reason),
        });
    },
  }),
  handledMethodOfSteps({
    name: 'getChatMenuButton',
    recordsActivity: true,
    parameters: getChatMenuButtonParametersSchema,
    steps: ({ parameters }) =>
      startSteps(parameters).andThen(({ chat_id: chatId }) => readMenuButtonUserId(chatId)),
    execute: (context: BotProfileContext, userId) => {
      const result = context.session.botMenuButtons.getBotMenuButton({
        botId: context.bot.id,
        userId,
      });
      return result.found
        ? botApiResult(toBotApiMenuButton(result.menuButton))
        : presentBotProfileFailure({
          found: false,
          reason: excludeMissingBotFailure(context.bot, result.reason),
        });
    },
  }),

  commandMethodOfSteps({
    name: 'setMyDescription',
    recordsActivity: true,
    parameters: setMyDescriptionParametersSchema,
    steps: ({ parameters }) => startSteps(parameters),
    execute: (context: BotProfileContext, { description, language_code: languageCode }) =>
      setMyDescription(context, { kind: 'description', text: description, languageCode }),
  }),
  commandMethodOfSteps({
    name: 'setMyShortDescription',
    recordsActivity: true,
    parameters: setMyShortDescriptionParametersSchema,
    steps: ({ parameters }) => startSteps(parameters),
    execute: (
      context: BotProfileContext,
      { short_description: shortDescription, language_code: languageCode },
    ) =>
      setMyDescription(context, {
        kind: 'short_description',
        text: shortDescription,
        languageCode,
      }),
  }),
  handledMethodOfSteps({
    name: 'getMyDescription',
    recordsActivity: true,
    parameters: myDescriptionTargetParametersSchema,
    steps: ({ parameters }) => startSteps(parameters),
    execute: (context: BotProfileContext, { language_code: languageCode }) => {
      const result = context.session.botDescriptions.getBotDescription({
        botId: context.bot.id,
        kind: 'description',
        languageCode,
      });
      return result.found
        ? botApiResult({ description: result.text } satisfies BotApiBotDescription)
        : presentBotProfileFailure({
          found: false,
          reason: excludeMissingBotFailure(context.bot, result.reason),
        });
    },
  }),
  handledMethodOfSteps({
    name: 'getMyShortDescription',
    recordsActivity: true,
    parameters: myDescriptionTargetParametersSchema,
    steps: ({ parameters }) => startSteps(parameters),
    execute: (context: BotProfileContext, { language_code: languageCode }) => {
      const result = context.session.botDescriptions.getBotDescription({
        botId: context.bot.id,
        kind: 'short_description',
        languageCode,
      });
      return result.found
        ? botApiResult({ short_description: result.text } satisfies BotApiBotShortDescription)
        : presentBotProfileFailure({
          found: false,
          reason: excludeMissingBotFailure(context.bot, result.reason),
        });
    },
  }),
];

/**
 * The step that reads the scope and language that address one of the bot's command lists, as the
 * official server's `get_bot_command_scope` and `check_bot_command_scope` read the scope.
 */
function readMyCommandsTarget(
  { context, invalidParametersDescription }: BotApiStepCall<unknown>,
  { scope, language_code: languageCode }: {
    readonly scope?: unknown;
    readonly language_code: string;
  },
): BotApiStepResult<MyCommandsTarget> {
  const scopeReading = readBotCommandScopeParameter(
    scope,
    invalidParametersDescription,
    (chatIdentifier) => resolveChatIdentifier(context, chatIdentifier),
  );
  return scopeReading.read
    ? proceedWith({ scope: scopeReading.scope, languageCode })
    : answerWithBadRequest(scopeReading.description);
}

/**
 * The step that reads the user whose private chat a menu button `chat_id` names, if any, refusing
 * one that names no user, as the official server's `get_user_id` does for it.
 */
function readMenuButtonUserId(chatId: number | undefined): BotApiStepResult<number | undefined> {
  return chatId !== undefined && chatId <= 0
    ? answerWith(presentFixedBotApiError(BOT_API_ERRORS.userChatIdInvalid))
    : proceedWith(chatId);
}

/** Sets one of the bot's descriptions, as `setMyDescription` asks for it. */
function setMyDescription(
  context: BotProfileContext,
  request: Omit<Parameters<EmulationSession['botDescriptions']['setBotDescription']>[0], 'botId'>,
) {
  const result = context.session.botDescriptions.setBotDescription({
    botId: context.bot.id,
    ...request,
  });
  return result.set ? botApiResult(true) : presentBotProfileFailure({
    set: false,
    reason: excludeMissingBotFailure(context.bot, result.reason),
  });
}

/** Shows a command as the Bot API does, with `is_ephemeral` only when set. */
function viewBotCommand({ command, description, isEphemeral }: BotCommand): BotApiBotCommand {
  return { command, description, ...(isEphemeral ? { is_ephemeral: true as const } : {}) };
}
