import { z } from 'zod';

import { supergroupChatIdSchema, telegramUserIdSchema } from './request_fields.ts';

export const ACCOUNT_ID_PARAMETER = 'accountId';
export const BOT_ID_PARAMETER = 'botId';
export const MESSAGE_ID_PARAMETER = 'messageId';
const CHAT_ID_PARAMETER = 'chatId';
export const SUPERGROUP_CONVERSATION_PATH =
  `/:${ACCOUNT_ID_PARAMETER}/conversations/supergroup/:${CHAT_ID_PARAMETER}` as const;
export const SUPERGROUP_MESSAGE_HISTORY_PATH = `${SUPERGROUP_CONVERSATION_PATH}/messages` as const;
export const SUPERGROUP_MESSAGE_PATH =
  `${SUPERGROUP_MESSAGE_HISTORY_PATH}/:${MESSAGE_ID_PARAMETER}` as const;

const telegramUserIdPathParameterSchema = z.coerce.number().pipe(telegramUserIdSchema);
const supergroupChatIdPathParameterSchema = z.coerce.number().pipe(supergroupChatIdSchema);
/** A message's ID as the chat's bots see it, which is how the account routes show messages. */
const messageIdPathParameterSchema = z.coerce.number().pipe(z.int().positive());

/** The path parameters of the account a route acts as. */
export const accountPathSchema = z.object({
  [ACCOUNT_ID_PARAMETER]: telegramUserIdPathParameterSchema,
});
/** The path parameters of a supergroup as an account addresses it. */
export const supergroupConversationPathSchema = accountPathSchema.extend({
  [CHAT_ID_PARAMETER]: supergroupChatIdPathParameterSchema,
});
/** The path parameters of a supergroup message as an account addresses it. */
export const supergroupMessagePathSchema = supergroupConversationPathSchema.extend({
  [MESSAGE_ID_PARAMETER]: messageIdPathParameterSchema,
});
/** The path parameters of a bot in a supergroup as an account addresses it. */
export const supergroupBotPathSchema = supergroupConversationPathSchema.extend({
  [BOT_ID_PARAMETER]: telegramUserIdPathParameterSchema,
});
