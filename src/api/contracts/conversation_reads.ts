/**
 * The contracts of what an account's client shows of its private chat with a bot, or of a
 * supergroup it is a member of, besides the messages: the bots' commands and the private chat's
 * menu button, the notifications of other participants' messages, and the reply interface a bot
 * asked for.
 */
import { z } from 'zod';

import { accountPrivateChatPathSchema } from './accounts.ts';
import { controlRefusalSchema, controlValidationErrorSchema } from './control_errors.ts';
import { replyKeyboardButtonSchema } from './keyboard_buttons.ts';
import { defineControlOperation } from './operation_contract.ts';
import { accountSupergroupPathSchema } from './supergroups.ts';
import { TELEGRAM_TYPE_ANNOTATION, telegramUserIdSchema } from './wire_fields.ts';

/** A bot command as an account's client lists it. */
const accountBotCommandSchema = z.strictObject({
  /** The command without its leading slash. */
  command: z.string().min(1),
  description: z.string().min(1),
  is_ephemeral: z.boolean(),
});

/**
 * The button an account's client shows next to the message field of a private chat with a bot,
 * as the Bot API's `MenuButton`: the bot's commands, a Web App, or `default` when the bot chose no
 * specific button.
 */
const menuButtonSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('commands') }),
  z.strictObject({
    type: z.literal('web_app'),
    text: z.string().min(1),
    web_app: z.strictObject({ url: z.string() }),
  }),
  z.strictObject({ type: z.literal('default') }),
]).meta({ [TELEGRAM_TYPE_ANNOTATION]: 'MenuButton' });

/** The notification an account's client shows for another participant's message. */
const notificationSchema = z.strictObject({
  /** The notifying message's ID, as the chat's bots see it. */
  message_id: z.int().min(1),
  /** Whether the sender asked for the notification to play no sound, as `disable_notification`. */
  is_silent: z.boolean(),
});

/** Text the input field shows while the reply interface is shown; omitted for none. */
const inputFieldPlaceholderSchema = z.string().min(1).optional();

/** A custom keyboard the account's client shows in place of its letter keyboard. */
const replyKeyboardInterfaceSchema = z.strictObject({
  type: z.literal('keyboard'),
  /** The ID of the bot message that sent the keyboard, as message history shows it. */
  message_id: z.int().min(1),
  keyboard: z.array(z.array(replyKeyboardButtonSchema).min(1)).min(1),
  is_persistent: z.boolean(),
  resize_keyboard: z.boolean(),
  /**
   * Whether clients hide the keyboard once it is used; the keyboard stays available, so its
   * buttons can still be pressed.
   */
  one_time_keyboard: z.boolean(),
  input_field_placeholder: inputFieldPlaceholderSchema,
});

/** A reply interface to a bot message, which the account's client shows as if replying to it. */
const forceReplyInterfaceSchema = z.strictObject({
  type: z.literal('force_reply'),
  /** The ID of the bot message to reply to, as message history shows it. */
  message_id: z.int().min(1),
  input_field_placeholder: inputFieldPlaceholderSchema,
});

/** The notifications an account's client shows for the messages of a chat, in their order. */
export const notificationsResponseSchema = z.strictObject({
  notifications: z.array(notificationSchema),
});

/** What the account's client shows in place of its usual input in a chat; `null` for nothing. */
export const replyInterfaceResponseSchema = z.strictObject({
  reply_interface: z.union([replyKeyboardInterfaceSchema, forceReplyInterfaceSchema, z.null()]),
});

/** A missing session, account, or bot. */
const privateChatParticipantNotFoundSchema = controlRefusalSchema([
  'account_not_found',
  'bot_not_found',
  'session_not_found',
]);

/** Returns the commands the account sees in its private chat with the bot. */
export const getPrivateChatBotCommandsContract = defineControlOperation({
  operationId: 'getPrivateChatBotCommands',
  method: 'GET',
  path: '/sessions/{sessionId}/accounts/{accountId}/conversations/private/{botId}/commands',
  params: accountPrivateChatPathSchema,
  success: {
    status: 200,
    body: { kind: 'json', schema: z.strictObject({ commands: z.array(accountBotCommandSchema) }) },
  },
  refusals: { 400: controlValidationErrorSchema, 404: privateChatParticipantNotFoundSchema },
});

/** Returns the menu button the account sees in its private chat with the bot. */
export const getPrivateChatMenuButtonContract = defineControlOperation({
  operationId: 'getPrivateChatMenuButton',
  method: 'GET',
  path: '/sessions/{sessionId}/accounts/{accountId}/conversations/private/{botId}/menu-button',
  params: accountPrivateChatPathSchema,
  success: {
    status: 200,
    body: { kind: 'json', schema: z.strictObject({ menu_button: menuButtonSchema }) },
  },
  refusals: { 400: controlValidationErrorSchema, 404: privateChatParticipantNotFoundSchema },
});

/**
 * Returns a notification for each message the bot sent to its private chat with the account, in
 * order.
 */
export const getPrivateChatNotificationsContract = defineControlOperation({
  operationId: 'getPrivateChatNotifications',
  method: 'GET',
  path: '/sessions/{sessionId}/accounts/{accountId}/conversations/private/{botId}/notifications',
  params: accountPrivateChatPathSchema,
  success: {
    status: 200,
    body: { kind: 'json', schema: notificationsResponseSchema },
  },
  refusals: { 400: controlValidationErrorSchema, 404: privateChatParticipantNotFoundSchema },
});

/**
 * Returns the reply keyboard or forced reply the account's client shows in its private chat with
 * the bot, or `null` for none.
 */
export const getPrivateChatReplyInterfaceContract = defineControlOperation({
  operationId: 'getPrivateChatReplyInterface',
  method: 'GET',
  path: '/sessions/{sessionId}/accounts/{accountId}/conversations/private/{botId}/reply-interface',
  params: accountPrivateChatPathSchema,
  success: {
    status: 200,
    body: { kind: 'json', schema: replyInterfaceResponseSchema },
  },
  refusals: { 400: controlValidationErrorSchema, 404: privateChatParticipantNotFoundSchema },
});

/** A member that is not one, or a missing session, account, or supergroup. */
const supergroupMemberRefusals = {
  400: controlValidationErrorSchema,
  403: controlRefusalSchema(['not_a_member']),
  404: controlRefusalSchema(['account_not_found', 'chat_not_found', 'session_not_found']),
};

/** Returns the commands the account sees in a supergroup it is a member of, for each bot. */
export const getSupergroupBotCommandsContract = defineControlOperation({
  operationId: 'getSupergroupBotCommands',
  method: 'GET',
  path: '/sessions/{sessionId}/accounts/{accountId}/conversations/supergroup/{chatId}/commands',
  params: accountSupergroupPathSchema,
  success: {
    status: 200,
    body: {
      kind: 'json',
      schema: z.strictObject({
        bot_commands: z.array(z.strictObject({
          bot_id: telegramUserIdSchema,
          commands: z.array(accountBotCommandSchema),
        })),
      }),
    },
  },
  refusals: supergroupMemberRefusals,
});

/**
 * Returns a notification for each other member's message of a supergroup the account is a member
 * of, in order.
 */
export const getSupergroupNotificationsContract = defineControlOperation({
  operationId: 'getSupergroupNotifications',
  method: 'GET',
  path:
    '/sessions/{sessionId}/accounts/{accountId}/conversations/supergroup/{chatId}/notifications',
  params: accountSupergroupPathSchema,
  success: { status: 200, body: { kind: 'json', schema: notificationsResponseSchema } },
  refusals: supergroupMemberRefusals,
});

/**
 * Returns the reply keyboard or forced reply the account's client shows in a supergroup it is a
 * member of, or `null` for none.
 */
export const getSupergroupReplyInterfaceContract = defineControlOperation({
  operationId: 'getSupergroupReplyInterface',
  method: 'GET',
  path:
    '/sessions/{sessionId}/accounts/{accountId}/conversations/supergroup/{chatId}/reply-interface',
  params: accountSupergroupPathSchema,
  success: { status: 200, body: { kind: 'json', schema: replyInterfaceResponseSchema } },
  refusals: supergroupMemberRefusals,
});
