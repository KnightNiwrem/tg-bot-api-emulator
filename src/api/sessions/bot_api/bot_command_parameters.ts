import { z } from 'zod';

import type { BotCommandScope } from '../../../types/bot_command.ts';
import { BOT_API_ERRORS } from './errors/error_catalogue.ts';
import { type ChatIdentifier, chatIdentifierSchema, jsonParameter } from './request_parameters.ts';

const botCommandParameterSchema = z.strictObject({
  command: z.string(),
  description: z.string(),
  is_ephemeral: z.boolean().default(false),
}).transform(({ command, description, is_ephemeral }) => ({
  command,
  description,
  isEphemeral: is_ephemeral,
}));

/**
 * A `commands` parameter: a JSON array of Bot API `BotCommand` objects. Telegram also reads a
 * number where text is expected; rejecting it instead surfaces the bot's mistake in tests.
 */
export function botCommandsParameter() {
  return jsonParameter(z.array(botCommandParameterSchema));
}

/** A `scope` parameter: a JSON value that `readBotCommandScopeParameter` reads. */
export function botCommandScopeParameter() {
  return jsonParameter(z.unknown());
}

export type BotCommandScopeParameterReading =
  | { readonly read: true; readonly scope: BotCommandScope }
  | { readonly read: false; readonly description: string };

const scopeTypeSchema = z.looseObject({ type: z.string() });
const chatlessScopeSchema = z.strictObject({
  type: z.enum(['default', 'all_private_chats', 'all_group_chats', 'all_chat_administrators']),
});
const chatScopeSchema = z.strictObject({
  type: z.enum(['chat', 'chat_administrators']),
  chat_id: chatIdentifierSchema,
});
const chatMemberScopeSchema = z.strictObject({
  type: z.literal('chat_member'),
  chat_id: chatIdentifierSchema,
  user_id: z.int(),
});

/** The description Telegram gives for a scope whose `@username` names no chat. */
const CHAT_NOT_FOUND_DESCRIPTION = BOT_API_ERRORS.chatNotFound.description();

/**
 * Reads a `scope` parameter as the official Bot API server's `get_bot_command_scope` does, with
 * Telegram's descriptions for a scope of an unsupported type or with an invalid user. A missing
 * scope is the default scope.
 *
 * `invalidParametersDescription` answers scopes that Telegram would read leniently, such as chat
 * IDs written as strings, which are rejected instead to surface the bot's mistake in tests. A
 * chat named by a public username is found with `findChatId`, as `check_chat` finds it.
 */
export function readBotCommandScopeParameter(
  value: unknown,
  invalidParametersDescription: string,
  findChatId: (chatIdentifier: ChatIdentifier) => number | undefined,
): BotCommandScopeParameterReading {
  const scopeError = (error: string): BotCommandScopeParameterReading => ({
    read: false,
    description: `Bad Request: can't parse BotCommandScope: ${error}`,
  });
  const malformedScope: BotCommandScopeParameterReading = {
    read: false,
    description: invalidParametersDescription,
  };
  if (value === undefined) {
    return { read: true, scope: { type: 'default' } };
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return scopeError('BotCommandScope must be an Object');
  }
  const scopeType = scopeTypeSchema.safeParse(value);
  if (!scopeType.success) {
    return malformedScope;
  }

  switch (scopeType.data.type) {
    case 'default':
    case 'all_private_chats':
    case 'all_group_chats':
    case 'all_chat_administrators': {
      const scope = chatlessScopeSchema.safeParse(value);
      return scope.success ? { read: true, scope: scope.data } : malformedScope;
    }
    case 'chat':
    case 'chat_administrators': {
      const scope = chatScopeSchema.safeParse(value);
      if (!scope.success) {
        return malformedScope;
      }
      const chatId = findChatId(scope.data.chat_id);
      return chatId === undefined
        ? { read: false, description: CHAT_NOT_FOUND_DESCRIPTION }
        : { read: true, scope: { type: scope.data.type, chatId } };
    }
    case 'chat_member': {
      const scope = chatMemberScopeSchema.safeParse(value);
      if (!scope.success) {
        return malformedScope;
      }
      const { chat_id: chatIdentifier, user_id: userId } = scope.data;
      if (userId <= 0) {
        return scopeError('Invalid user_id specified');
      }
      const chatId = findChatId(chatIdentifier);
      return chatId === undefined
        ? { read: false, description: CHAT_NOT_FOUND_DESCRIPTION }
        : { read: true, scope: { type: 'chat_member', chatId, userId } };
    }
    default:
      return scopeError('Unsupported type specified');
  }
}
