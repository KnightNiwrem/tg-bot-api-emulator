import { Hono } from 'hono';

import type { BotCommand } from '../../../types/bot_command.ts';
import { getApplicableAdministratorRightFlags } from '../../../types/bot_default_administrator_rights.ts';
import { toBotApiMenuButton } from '../../../types/bot_menu_button.ts';
import type {
  ReplyInterface,
  ReplyKeyboardButton,
  ReplyKeyboardButtonRequest,
} from '../../../types/reply_interface.ts';
import { type ChatMessage, getMessageNotification } from '../../../types/virtual_message.ts';
import type { SessionRouteContextTypes } from '../session_route_context_types.ts';
import {
  PRIVATE_CONVERSATION_PATH,
  PRIVATE_MESSAGE_HISTORY_PATH,
  privateConversationPathSchema,
  SUPERGROUP_CONVERSATION_PATH,
  SUPERGROUP_MESSAGE_HISTORY_PATH,
  supergroupConversationPathSchema,
} from './account_paths.ts';
import { supergroupMemberFailureStatus } from './messaging_failure_statuses.ts';

const PRIVATE_CHAT_COMMANDS_PATH = `${PRIVATE_CONVERSATION_PATH}/commands` as const;
const PRIVATE_CHAT_MENU_BUTTON_PATH = `${PRIVATE_CONVERSATION_PATH}/menu-button` as const;
const PRIVATE_CHAT_REPLY_INTERFACE_PATH = `${PRIVATE_CONVERSATION_PATH}/reply-interface` as const;
const PRIVATE_CHAT_NOTIFICATIONS_PATH = `${PRIVATE_CONVERSATION_PATH}/notifications` as const;
const SUPERGROUP_COMMANDS_PATH = `${SUPERGROUP_CONVERSATION_PATH}/commands` as const;
const SUPERGROUP_NOTIFICATIONS_PATH = `${SUPERGROUP_CONVERSATION_PATH}/notifications` as const;
const SUPERGROUP_REPLY_INTERFACE_PATH = `${SUPERGROUP_CONVERSATION_PATH}/reply-interface` as const;

/**
 * Routes through which an account reads what its client shows of a private chat or supergroup: the
 * messages and their notifications, the bots' commands and menu button, and the reply interface a
 * bot asked for.
 */
export function createConversationReadRoutes(): Hono<SessionRouteContextTypes> {
  const accountRoutes = new Hono<SessionRouteContextTypes>();

  accountRoutes.get(SUPERGROUP_MESSAGE_HISTORY_PATH, (context) => {
    const conversationPath = supergroupConversationPathSchema.safeParse(context.req.param());
    if (!conversationPath.success) {
      return context.body(null, 400);
    }
    const { accountId, chatId } = conversationPath.data;

    const { supergroupMessaging, botMessageViews } = context.get('emulationSession');
    const result = supergroupMessaging.getMessageHistory({
      accountId,
      chatId,
    });
    if (!result.found) {
      return context.body(null, supergroupMemberFailureStatus(result.reason));
    }
    return context.json({
      messages: result.messages.map((message) =>
        botMessageViews.viewSupergroupMessage(message, accountId)
      ),
    });
  });

  accountRoutes.get(SUPERGROUP_COMMANDS_PATH, (context) => {
    const conversationPath = supergroupConversationPathSchema.safeParse(context.req.param());
    if (!conversationPath.success) {
      return context.body(null, 400);
    }
    const { accountId, chatId } = conversationPath.data;

    const result = context.get('emulationSession').botCommands.getSupergroupCommands({
      accountId,
      chatId,
    });
    if (!result.found) {
      return context.body(null, supergroupMemberFailureStatus(result.reason));
    }
    return context.json({
      bot_commands: result.botCommands.map(({ botId, commands }) => ({
        bot_id: botId,
        commands: commands.map(presentBotCommandForAccount),
      })),
    });
  });

  accountRoutes.get(SUPERGROUP_NOTIFICATIONS_PATH, (context) => {
    const conversationPath = supergroupConversationPathSchema.safeParse(context.req.param());
    if (!conversationPath.success) {
      return context.body(null, 400);
    }
    const { accountId, chatId } = conversationPath.data;

    const { supergroupMessaging, botMessageViews } = context.get('emulationSession');
    const result = supergroupMessaging.getMessageHistory({
      accountId,
      chatId,
    });
    if (!result.found) {
      return context.body(null, supergroupMemberFailureStatus(result.reason));
    }
    return context.json({
      notifications: presentNotificationsForAccount(
        result.messages,
        accountId,
        (message) => botMessageViews.viewSupergroupMessage(message, accountId).message_id,
      ),
    });
  });

  accountRoutes.get(SUPERGROUP_REPLY_INTERFACE_PATH, (context) => {
    const conversationPath = supergroupConversationPathSchema.safeParse(context.req.param());
    if (!conversationPath.success) {
      return context.body(null, 400);
    }
    const { accountId, chatId } = conversationPath.data;

    const { supergroupMessaging, botMessageViews } = context.get('emulationSession');
    const result = supergroupMessaging.getReplyInterface({
      accountId,
      chatId,
    });
    if (!result.found) {
      return context.body(null, supergroupMemberFailureStatus(result.reason));
    }
    const { shownReplyInterface } = result;
    return context.json({
      reply_interface: shownReplyInterface === undefined ? null : presentReplyInterfaceForAccount(
        botMessageViews.viewSupergroupMessage(shownReplyInterface.message, accountId)
          .message_id,
        shownReplyInterface.replyInterface,
      ),
    });
  });

  accountRoutes.get(PRIVATE_MESSAGE_HISTORY_PATH, (context) => {
    const conversationPath = privateConversationPathSchema.safeParse(context.req.param());
    if (!conversationPath.success) {
      return context.body(null, 400);
    }
    const { accountId, botId } = conversationPath.data;

    const { privateMessaging, botMessageViews } = context.get('emulationSession');
    const result = privateMessaging.getPrivateMessageHistory({
      accountId,
      botId,
    });
    if (!result.found) {
      return context.body(null, 404);
    }

    return context.json({
      messages: result.messages.map((message) => botMessageViews.viewPrivateMessageForBot(message)),
    });
  });

  accountRoutes.get(PRIVATE_CHAT_COMMANDS_PATH, (context) => {
    const conversationPath = privateConversationPathSchema.safeParse(context.req.param());
    if (!conversationPath.success) {
      return context.body(null, 400);
    }
    const { accountId, botId } = conversationPath.data;

    const result = context.get('emulationSession').botCommands.getPrivateChatCommands({
      accountId,
      botId,
    });
    if (!result.found) {
      return context.body(null, 404);
    }
    return context.json({ commands: result.commands.map(presentBotCommandForAccount) });
  });

  accountRoutes.get(PRIVATE_CHAT_MENU_BUTTON_PATH, (context) => {
    const conversationPath = privateConversationPathSchema.safeParse(context.req.param());
    if (!conversationPath.success) {
      return context.body(null, 400);
    }
    const { accountId, botId } = conversationPath.data;

    const result = context.get('emulationSession').botMenuButtons.getPrivateChatMenuButton({
      accountId,
      botId,
    });
    if (!result.found) {
      return context.body(null, 404);
    }
    return context.json({ menu_button: toBotApiMenuButton(result.menuButton) });
  });

  accountRoutes.get(PRIVATE_CHAT_NOTIFICATIONS_PATH, (context) => {
    const conversationPath = privateConversationPathSchema.safeParse(context.req.param());
    if (!conversationPath.success) {
      return context.body(null, 400);
    }
    const { accountId, botId } = conversationPath.data;

    const { privateMessaging, botMessageViews } = context.get('emulationSession');
    const result = privateMessaging.getPrivateMessageHistory({
      accountId,
      botId,
    });
    if (!result.found) {
      return context.body(null, 404);
    }
    return context.json({
      notifications: presentNotificationsForAccount(
        result.messages,
        accountId,
        (message) => botMessageViews.viewPrivateMessageForBot(message).message_id,
      ),
    });
  });

  accountRoutes.get(PRIVATE_CHAT_REPLY_INTERFACE_PATH, (context) => {
    const conversationPath = privateConversationPathSchema.safeParse(context.req.param());
    if (!conversationPath.success) {
      return context.body(null, 400);
    }
    const { accountId, botId } = conversationPath.data;

    const { privateMessaging, botMessageViews } = context.get('emulationSession');
    const result = privateMessaging.getPrivateChatReplyInterface({
      accountId,
      botId,
    });
    if (!result.found) {
      return context.body(null, 404);
    }
    const { shownReplyInterface } = result;
    return context.json({
      reply_interface: shownReplyInterface === undefined ? null : presentReplyInterfaceForAccount(
        botMessageViews.viewPrivateMessageForBot(shownReplyInterface.message).message_id,
        shownReplyInterface.replyInterface,
      ),
    });
  });

  return accountRoutes;
}

/**
 * Shows the notifications an account's client shows for the messages of a chat, in the order of
 * the messages, each with the ID by which the chat's bots see its message.
 */
function presentNotificationsForAccount<Message extends ChatMessage>(
  messages: readonly Message[],
  accountId: number,
  getBotMessageId: (message: Message) => number,
) {
  return messages.flatMap((message) => {
    const notification = getMessageNotification(message, accountId);
    return notification === undefined
      ? []
      : [{ message_id: getBotMessageId(message), is_silent: notification.isSilent }];
  });
}

/** Shows a command as the account's client lists it. */
function presentBotCommandForAccount({ command, description, isEphemeral }: BotCommand) {
  return { command, description, is_ephemeral: isEphemeral };
}

/**
 * Shows the reply interface the account's client shows, with the ID, as the bot sees it, of the
 * message that asked for it.
 */
function presentReplyInterfaceForAccount(messageId: number, replyInterface: ReplyInterface) {
  const placeholder = replyInterface.inputFieldPlaceholder === undefined
    ? {}
    : { input_field_placeholder: replyInterface.inputFieldPlaceholder };
  switch (replyInterface.kind) {
    case 'reply_keyboard':
      return {
        type: 'keyboard' as const,
        message_id: messageId,
        keyboard: replyInterface.rows.map((row) => row.map(presentReplyKeyboardButtonForAccount)),
        is_persistent: replyInterface.isPersistent,
        resize_keyboard: replyInterface.resizesToFit,
        one_time_keyboard: replyInterface.isOneTime,
        ...placeholder,
      };
    case 'forced_reply':
      return { type: 'force_reply' as const, message_id: messageId, ...placeholder };
    default: {
      const unhandledReplyInterface: never = replyInterface;
      throw new Error(`Unhandled reply interface: ${JSON.stringify(unhandledReplyInterface)}`);
    }
  }
}

/**
 * Shows a reply keyboard button's text, appearance and request, as the Bot API writes a
 * `KeyboardButton`.
 */
function presentReplyKeyboardButtonForAccount(
  { text, style, iconCustomEmojiId, request }: ReplyKeyboardButton,
) {
  return {
    text,
    ...(iconCustomEmojiId === undefined ? {} : { icon_custom_emoji_id: iconCustomEmojiId }),
    ...(style === undefined ? {} : { style }),
    ...(request === undefined ? {} : presentReplyKeyboardButtonRequest(request)),
  };
}

/** Shows what a reply keyboard button requests, in the fields of a Bot API `KeyboardButton`. */
function presentReplyKeyboardButtonRequest(request: ReplyKeyboardButtonRequest) {
  switch (request.kind) {
    case 'contact':
      return { request_contact: true };
    case 'location':
      return { request_location: true };
    case 'poll':
      return { request_poll: request.pollType === undefined ? {} : { type: request.pollType } };
    case 'web_app':
      return { web_app: { url: request.url } };
    case 'users':
      return {
        request_users: {
          request_id: request.requestId,
          ...(request.userIsBot === undefined ? {} : { user_is_bot: request.userIsBot }),
          ...(request.userIsPremium === undefined
            ? {}
            : { user_is_premium: request.userIsPremium }),
          max_quantity: request.maxQuantity,
          request_name: request.requestsName,
          request_username: request.requestsUsername,
          request_photo: request.requestsPhoto,
        },
      };
    case 'chat': {
      const chatKind = request.chatIsChannel ? 'channel' : 'group';
      return {
        request_chat: {
          request_id: request.requestId,
          chat_is_channel: request.chatIsChannel,
          ...(request.chatIsForum === undefined ? {} : { chat_is_forum: request.chatIsForum }),
          ...(request.chatHasUsername === undefined
            ? {}
            : { chat_has_username: request.chatHasUsername }),
          chat_is_created: request.chatIsCreated,
          ...(request.userAdministratorRights === undefined ? {} : {
            user_administrator_rights: getApplicableAdministratorRightFlags(
              chatKind,
              request.userAdministratorRights,
            ),
          }),
          ...(request.botAdministratorRights === undefined ? {} : {
            bot_administrator_rights: getApplicableAdministratorRightFlags(
              chatKind,
              request.botAdministratorRights,
            ),
          }),
          bot_is_member: request.botIsMember,
          request_title: request.requestsTitle,
          request_username: request.requestsUsername,
          request_photo: request.requestsPhoto,
        },
      };
    }
    default: {
      const unhandledRequest: never = request;
      throw new Error(`Unhandled reply keyboard request: ${JSON.stringify(unhandledRequest)}`);
    }
  }
}
