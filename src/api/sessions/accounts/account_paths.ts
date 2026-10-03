import { z } from 'zod';

import { supergroupChatIdSchema, telegramUserIdSchema } from './request_fields.ts';

export const ACCOUNT_ID_PARAMETER = 'accountId';
export const BOT_ID_PARAMETER = 'botId';
export const PRIVATE_CONVERSATION_PATH =
  `/:${ACCOUNT_ID_PARAMETER}/conversations/private/:${BOT_ID_PARAMETER}` as const;
export const PRIVATE_MESSAGE_HISTORY_PATH = `${PRIVATE_CONVERSATION_PATH}/messages` as const;
export const MESSAGE_ID_PARAMETER = 'messageId';
export const PRIVATE_MESSAGE_PATH =
  `${PRIVATE_MESSAGE_HISTORY_PATH}/:${MESSAGE_ID_PARAMETER}` as const;
const CHAT_ID_PARAMETER = 'chatId';
export const SUPERGROUP_CONVERSATION_PATH =
  `/:${ACCOUNT_ID_PARAMETER}/conversations/supergroup/:${CHAT_ID_PARAMETER}` as const;
export const SUPERGROUP_MESSAGE_HISTORY_PATH = `${SUPERGROUP_CONVERSATION_PATH}/messages` as const;
export const SUPERGROUP_MESSAGE_PATH =
  `${SUPERGROUP_MESSAGE_HISTORY_PATH}/:${MESSAGE_ID_PARAMETER}` as const;
export const USER_ID_PARAMETER = 'userId';

const telegramUserIdPathParameterSchema = z.coerce.number().pipe(telegramUserIdSchema);
const supergroupChatIdPathParameterSchema = z.coerce.number().pipe(supergroupChatIdSchema);
/** A message's ID as the chat's bots see it, which is how these routes show messages. */
const messageIdPathParameterSchema = z.coerce.number().pipe(z.int().positive());

/** The path parameters of the account a route acts as. */
export const accountPathSchema = z.object({
  [ACCOUNT_ID_PARAMETER]: telegramUserIdPathParameterSchema,
});
/** The path parameters of an account's private chat with a bot. */
export const privateConversationPathSchema = accountPathSchema.extend({
  [BOT_ID_PARAMETER]: telegramUserIdPathParameterSchema,
});
/** The path parameters of a message of an account's private chat with a bot. */
export const privateMessagePathSchema = privateConversationPathSchema.extend({
  [MESSAGE_ID_PARAMETER]: messageIdPathParameterSchema,
});
/** The path parameters of a supergroup as an account addresses it. */
export const supergroupConversationPathSchema = accountPathSchema.extend({
  [CHAT_ID_PARAMETER]: supergroupChatIdPathParameterSchema,
});
/** The path parameters of a supergroup message as an account addresses it. */
export const supergroupMessagePathSchema = supergroupConversationPathSchema.extend({
  [MESSAGE_ID_PARAMETER]: messageIdPathParameterSchema,
});
/** The path parameters of a supergroup member as an account addresses it. */
export const supergroupMemberPathSchema = supergroupConversationPathSchema.extend({
  [USER_ID_PARAMETER]: telegramUserIdPathParameterSchema,
});
