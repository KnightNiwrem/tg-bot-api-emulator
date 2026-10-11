/** The contracts of a session's virtual bots, and the profile they show. */
import { z } from 'zod';

import { controlRefusalSchema, controlValidationErrorSchema } from './control_errors.ts';
import { defineControlOperation } from './operation_contract.ts';
import { sessionNotFoundSchema } from './sessions.ts';
import {
  createdResourceHeadersSchema,
  sessionIdParameterSchema,
  telegramUserIdSchema,
  telegramUsernameSchema,
} from './wire_fields.ts';

/** The path parameters of a bot, as a session's bot controls address it. */
export const botPathSchema = z.strictObject({
  sessionId: sessionIdParameterSchema,
  botId: telegramUserIdSchema,
});

/**
 * The refusal of a request to a bot the session does not have, or under a session that does not
 * exist or has ended.
 */
export const botNotFoundSchema = controlRefusalSchema(['bot_not_found', 'session_not_found']);

/** A bot's profile, as `getMe` returns it. */
export const botProfileSchema = z.strictObject({
  id: telegramUserIdSchema,
  is_bot: z.literal(true),
  first_name: z.string(),
  username: z.string(),
  can_join_groups: z.boolean(),
  can_read_all_group_messages: z.boolean(),
  supports_guest_queries: z.boolean().optional(),
  /** Whether the bot was created with inline mode turned on. */
  supports_inline_queries: z.boolean(),
  can_connect_to_business: z.boolean(),
  has_main_web_app: z.boolean(),
  has_topics_enabled: z.boolean(),
  allows_users_to_create_topics: z.boolean(),
  can_manage_bots: z.boolean(),
  supports_join_request_queries: z.boolean(),
});

/** A bot as a message sender, without the capabilities that only `getMe` reports. */
export const messageSenderBotSchema = z.strictObject({
  id: telegramUserIdSchema,
  is_bot: z.literal(true),
  first_name: z.string(),
  last_name: z.string().optional(),
  username: z.string(),
});

/** A bot's profile and the settings its owner would choose with BotFather, each off by default. */
const createBotRequestSchema = z.strictObject({
  first_name: z.string().min(1),
  /**
   * From 1 to 32 ASCII letters, digits, and underscores, beginning with a letter, without a
   * trailing or doubled underscore, as Telegram's username syntax allows; unique among the
   * session's usernames, compared without case.
   */
  username: telegramUsernameSchema,
  /**
   * Turns off the bot's privacy mode, so that it receives every message of its groups. Defaults to
   * `false`: the bot receives only commands, replies to its messages, and mentions of it.
   */
  can_read_all_group_messages: z.boolean().default(false),
  /**
   * Turns on inline mode, so that accounts send the bot inline queries. Defaults to `false`, as
   * for a new Telegram bot.
   */
  supports_inline_queries: z.boolean().default(false),
  /**
   * Turns on inline feedback, so that the bot receives a `chosen_inline_result` update for each
   * result of its inline queries that an account sends. Defaults to `false`.
   */
  receives_chosen_inline_results: z.boolean().default(false),
  /**
   * Asks accounts to share their location with the bot's inline queries. Defaults to `false`, in
   * which case accounts cannot share it.
   */
  requests_inline_location: z.boolean().default(false),
  /**
   * Turns on Bot-to-Bot Communication Mode. A bot's supergroup message then reaches another bot
   * it addresses, through a leading command naming that bot or a direct reply to one of that
   * bot's messages, when either of the two bots turned the mode on. Defaults to `false`.
   */
  enables_bot_to_bot_communication: z.boolean().default(false),
});

/** A created bot: the token that authenticates its Bot API calls, and its profile. */
const createdBotSchema = z.strictObject({
  token: z.string().min(1),
  bot: botProfileSchema,
});

export const createBotContract = defineControlOperation({
  operationId: 'createBot',
  method: 'POST',
  path: '/sessions/{sessionId}/bots',
  params: z.strictObject({ sessionId: sessionIdParameterSchema }),
  body: { required: true, schema: createBotRequestSchema },
  success: {
    status: 201,
    headers: createdResourceHeadersSchema,
    body: { kind: 'json', schema: createdBotSchema },
    actionReceipt: 'before_action',
  },
  refusals: {
    400: controlValidationErrorSchema,
    404: sessionNotFoundSchema,
    409: controlRefusalSchema(['username_taken']),
    507: controlRefusalSchema(['identity_limit_reached']),
  },
});
