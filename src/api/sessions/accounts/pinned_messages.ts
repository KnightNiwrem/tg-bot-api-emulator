import { type Context, Hono } from 'hono';

import type { EmulationSession } from '../../../types/emulation_session.ts';
import {
  controlErrorResponse,
  invalidControlRequestResponse,
} from '../../control_error_response.ts';
import { readPathParameters } from '../control_request_input.ts';
import type { SessionRouteContextTypes } from '../session_route_context_types.ts';
import {
  MESSAGE_ID_PARAMETER,
  PRIVATE_CONVERSATION_PATH,
  privateConversationPathSchema,
  privateMessagePathSchema,
  SUPERGROUP_CONVERSATION_PATH,
  supergroupConversationPathSchema,
  supergroupMessagePathSchema,
} from './account_paths.ts';
import { viewChatMessageForAccount } from './chat_message_view.ts';

const PRIVATE_PINNED_MESSAGE_COLLECTION_PATH =
  `${PRIVATE_CONVERSATION_PATH}/pinned-messages` as const;
const PRIVATE_PINNED_MESSAGE_PATH =
  `${PRIVATE_PINNED_MESSAGE_COLLECTION_PATH}/:${MESSAGE_ID_PARAMETER}` as const;
const SUPERGROUP_PINNED_MESSAGE_COLLECTION_PATH =
  `${SUPERGROUP_CONVERSATION_PATH}/pinned-messages` as const;
const SUPERGROUP_PINNED_MESSAGE_PATH =
  `${SUPERGROUP_PINNED_MESSAGE_COLLECTION_PATH}/:${MESSAGE_ID_PARAMETER}` as const;

/**
 * Routes through which an account reads the pinned messages of its private chat with a bot or of a
 * supergroup, and pins and unpins their messages.
 */
export function createPinnedMessageRoutes(): Hono<SessionRouteContextTypes> {
  const accountRoutes = new Hono<SessionRouteContextTypes>();

  // The account reads the messages its private chat with the bot pins, newest first.
  accountRoutes.get(PRIVATE_PINNED_MESSAGE_COLLECTION_PATH, (context) => {
    const conversationPath = readPathParameters(privateConversationPathSchema, context.req.param());
    if (!conversationPath.valid) {
      return invalidControlRequestResponse(context, conversationPath.issues);
    }
    const { accountId, botId } = conversationPath.value;
    return answerPinnedMessages(context, accountId, { type: 'private', peerId: botId });
  });

  // Either participant of a private chat pins and unpins any of its messages.
  accountRoutes.put(PRIVATE_PINNED_MESSAGE_PATH, (context) => {
    const messagePath = readPathParameters(privateMessagePathSchema, context.req.param());
    if (!messagePath.valid) {
      return invalidControlRequestResponse(context, messagePath.issues);
    }
    const { accountId, botId, messageId } = messagePath.value;
    return answerPinChange(context, 'pin', {
      accountId,
      chat: { type: 'private', peerId: botId },
      messageId,
    });
  });
  accountRoutes.delete(PRIVATE_PINNED_MESSAGE_PATH, (context) => {
    const messagePath = readPathParameters(privateMessagePathSchema, context.req.param());
    if (!messagePath.valid) {
      return invalidControlRequestResponse(context, messagePath.issues);
    }
    const { accountId, botId, messageId } = messagePath.value;
    return answerPinChange(context, 'unpin', {
      accountId,
      chat: { type: 'private', peerId: botId },
      messageId,
    });
  });

  // A member reads the messages the supergroup pins, newest first.
  accountRoutes.get(SUPERGROUP_PINNED_MESSAGE_COLLECTION_PATH, (context) => {
    const conversationPath = readPathParameters(
      supergroupConversationPathSchema,
      context.req.param(),
    );
    if (!conversationPath.valid) {
      return invalidControlRequestResponse(context, conversationPath.issues);
    }
    const { accountId, chatId } = conversationPath.value;
    return answerPinnedMessages(context, accountId, { type: 'supergroup', chatId });
  });

  // A member with the `can_pin_messages` permission pins and unpins the supergroup's messages.
  accountRoutes.put(SUPERGROUP_PINNED_MESSAGE_PATH, (context) => {
    const messagePath = readPathParameters(supergroupMessagePathSchema, context.req.param());
    if (!messagePath.valid) {
      return invalidControlRequestResponse(context, messagePath.issues);
    }
    const { accountId, chatId, messageId } = messagePath.value;
    return answerPinChange(context, 'pin', {
      accountId,
      chat: { type: 'supergroup', chatId },
      messageId,
    });
  });
  accountRoutes.delete(SUPERGROUP_PINNED_MESSAGE_PATH, (context) => {
    const messagePath = readPathParameters(supergroupMessagePathSchema, context.req.param());
    if (!messagePath.valid) {
      return invalidControlRequestResponse(context, messagePath.issues);
    }
    const { accountId, chatId, messageId } = messagePath.value;
    return answerPinChange(context, 'unpin', {
      accountId,
      chat: { type: 'supergroup', chatId },
      messageId,
    });
  });

  return accountRoutes;
}

type PinningChat = Parameters<EmulationSession['messagePinning']['pinMessage']>[0]['chat'];

/** Answers an account's request for the pinned messages of its chat, shown as its history shows. */
function answerPinnedMessages(
  context: Context<SessionRouteContextTypes>,
  accountId: number,
  chat: PinningChat,
): Response {
  const { messagePinning, botMessageViews } = context.get('emulationSession');
  const result = messagePinning.getPinnedMessages({ accountId, chat });
  if (!result.found) {
    return controlErrorResponse(
      context,
      result.reason === 'not_a_member' ? 403 : 404,
      result.reason,
    );
  }
  return context.json({
    messages: result.messages.map((message) =>
      viewChatMessageForAccount(botMessageViews, message, accountId)
    ),
  });
}

/** Answers an account's request to pin or unpin a message of its chat. */
function answerPinChange(
  context: Context<SessionRouteContextTypes>,
  change: 'pin' | 'unpin',
  { accountId, chat, messageId }: {
    readonly accountId: number;
    readonly chat: PinningChat;
    readonly messageId: number;
  },
): Response {
  const { messagePinning } = context.get('emulationSession');
  const input = { pinner: { kind: 'account', accountId } as const, chat, messageId };
  if (change === 'pin') {
    // Accounts pin as Telegram's clients do by default, notifying the members of a supergroup.
    const result = messagePinning.pinMessage({ ...input, isSilent: false });
    return result.pinned
      ? context.body(null, 204)
      : controlErrorResponse(context, pinChangeFailureStatus(result.reason), result.reason);
  }
  const result = messagePinning.unpinMessage(input);
  return result.unpinned
    ? context.body(null, 204)
    : controlErrorResponse(context, pinChangeFailureStatus(result.reason), result.reason);
}

/**
 * A missing account, chat, or message is not found; an account that is not a member of the
 * supergroup, or may not pin there, is forbidden from it; a service message cannot be pinned; and
 * pinning a pinned message, or unpinning one that is not, conflicts with its state, as Telegram
 * refuses it, as does a block of the private chat's bot.
 */
function pinChangeFailureStatus(
  reason:
    | Extract<ReturnType<MessagePinning['pinMessage']>, { readonly pinned: false }>['reason']
    | Extract<ReturnType<MessagePinning['unpinMessage']>, { readonly unpinned: false }>['reason'],
): 400 | 403 | 404 | 409 {
  switch (reason) {
    case 'pinner_not_found':
    case 'chat_not_found':
    case 'message_not_found':
      return 404;
    case 'not_a_member':
    case 'not_enough_rights':
      return 403;
    case 'service_message_not_pinnable':
      return 400;
    case 'message_already_pinned':
    case 'message_not_pinned':
      return 409;
    // As for an account's messages, a block conflicts with writing to the bot.
    case 'bot_blocked':
      return 409;
    // Only bots are refused for their former membership.
    case 'bot_not_a_member':
    case 'bot_kicked':
      throw new Error(`Account refused as a bot: ${reason}`);
    default: {
      const unhandledReason: never = reason;
      throw new Error(`Unhandled pin change failure: ${unhandledReason}`);
    }
  }
}

type MessagePinning = EmulationSession['messagePinning'];
