import { z } from 'zod';

import { botChatAccessFailureAnswer, requireSpecifiedChatId } from '../chat_access.ts';
import { readChatPermissionsParameter } from '../chat_permissions_parameter.ts';
import { presentChatInfoChangeFailure } from '../errors/chat_info_failure_presenter.ts';
import { type BotApiMethod, botApiResult } from '../method_call.ts';
import {
  answerWithBadRequest,
  commandMethodOfSteps,
  handledMethodOfSteps,
  proceedWith,
  startSteps,
} from '../method_steps.ts';
import { booleanParameter, integerParameter } from '../request_parameters.ts';

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

/**
 * The methods that read a chat, or change its title, description or permissions. Each change is
 * executed as a command in its call's transaction; `getChat` changes nothing, and answers from its
 * handler.
 */
export const CHAT_INFO_METHODS: readonly BotApiMethod[] = [
  handledMethodOfSteps({
    name: 'getChat',
    recordsActivity: true,
    parameters: getChatParametersSchema,
    steps: ({ parameters }) => startSteps(parameters).andThen(requireSpecifiedChatId),
    execute: (context, { chat_id: chatId }) => {
      const result = context.session.botApi.getChat(context.bot, { chatId });
      return result.found ? botApiResult(result.chat) : botChatAccessFailureAnswer(result.reason);
    },
  }),
  commandMethodOfSteps({
    name: 'setChatDescription',
    recordsActivity: true,
    parameters: setChatDescriptionParametersSchema,
    steps: ({ parameters }) => startSteps(parameters).andThen(requireSpecifiedChatId),
    execute: (context, { chat_id: chatId, description }) => {
      const result = context.session.botApi.setChatDescription(context.bot, {
        chatId,
        description,
      });
      return result.set
        ? botApiResult(true)
        : presentChatInfoChangeFailure('chat_description_change', result);
    },
  }),
  // Telegram reads the permissions before it looks at the chat.
  commandMethodOfSteps({
    name: 'setChatPermissions',
    recordsActivity: true,
    parameters: setChatPermissionsParametersSchema,
    steps: ({ parameters, invalidParametersDescription }) =>
      startSteps(parameters)
        .andThen(({ permissions, use_independent_chat_permissions, ...otherParameters }) => {
          const permissionsReading = readChatPermissionsParameter(permissions, {
            usesIndependentChatPermissions: use_independent_chat_permissions,
            invalidParametersDescription,
          });
          return permissionsReading.read
            ? proceedWith({ ...otherParameters, permissions: permissionsReading.permissions })
            : answerWithBadRequest(permissionsReading.description);
        })
        .andThen(requireSpecifiedChatId),
    execute: (context, { chat_id: chatId, permissions }) => {
      const result = context.session.botApi.setChatPermissions(context.bot, {
        chatId,
        permissions,
      });
      return result.set
        ? botApiResult(true)
        : presentChatInfoChangeFailure('chat_permissions_change', result);
    },
  }),
  commandMethodOfSteps({
    name: 'setChatTitle',
    recordsActivity: true,
    parameters: setChatTitleParametersSchema,
    steps: ({ parameters }) => startSteps(parameters).andThen(requireSpecifiedChatId),
    execute: (context, { chat_id: chatId, title }) => {
      const result = context.session.botApi.setChatTitle(context.bot, { chatId, title });
      return result.set
        ? botApiResult(true)
        : presentChatInfoChangeFailure('chat_title_change', result);
    },
  }),
];
