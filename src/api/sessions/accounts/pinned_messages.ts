import { type Context, Hono } from 'hono';

import {
  getPrivatePinnedMessagesContract,
  pinPrivateMessageContract,
  unpinPrivateMessageContract,
} from '../../contracts/pinned_messages.ts';
import type { EmulationSession } from '../../../session/emulation_session.ts';
import {
  controlErrorResponse,
  invalidControlRequestResponse,
} from '../../control_error_response.ts';
import { registerControlOperation } from '../../control_operation_route.ts';
import { answerWithActionReceipt } from '../action_receipt.ts';
import { readPathParameters } from '../control_request_input.ts';
import type { SessionRouteContextTypes } from '../session_route_context_types.ts';
import {
  MESSAGE_ID_PARAMETER,
  SUPERGROUP_CONVERSATION_PATH,
  supergroupConversationPathSchema,
  supergroupMessagePathSchema,
} from './account_paths.ts';
import { viewChatMessageForAccount, viewPrivateChatMessageForBot } from './chat_message_view.ts';

/** Where the account routes are mounted within the server, as a contract path template. */
const ACCOUNT_COLLECTION_MOUNT_PATH = '/sessions/{sessionId}/accounts';

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
  registerControlOperation(
    accountRoutes,
    ACCOUNT_COLLECTION_MOUNT_PATH,
    getPrivatePinnedMessagesContract,
    ({ params: { accountId, botId } }, context) => {
      const { messagePinning, botMessageViews } = context.get('emulationSession');
      const result = messagePinning.getPinnedMessages({
        accountId,
        chat: { type: 'private', peerId: botId },
      });
      if (result.found) {
        return {
          status: 200,
          body: {
            messages: result.messages.map((message) =>
              viewPrivateChatMessageForBot(botMessageViews, message)
            ),
          },
        };
      }
      // Only a supergroup has members; a private chat never refuses an account as one.
      if (result.reason === 'not_a_member') {
        throw new Error(`A private chat refused its pinned messages as ${result.reason}`);
      }
      return { status: 404, body: { reason: result.reason } };
    },
  );

  // Either participant of a private chat pins and unpins any of its messages.
  registerControlOperation(
    accountRoutes,
    ACCOUNT_COLLECTION_MOUNT_PATH,
    pinPrivateMessageContract,
    ({ params: { accountId, botId, messageId } }, context) => {
      // Accounts pin as Telegram's clients do by default.
      const result = context.get('emulationSession').messagePinning.pinMessageByAccount({
        fromAccountId: accountId,
        chat: { type: 'private', peerId: botId },
        messageId,
        isSilent: false,
      });
      return result.pinned ? { status: 204 } : refusePrivatePin(result.reason);
    },
  );
  registerControlOperation(
    accountRoutes,
    ACCOUNT_COLLECTION_MOUNT_PATH,
    unpinPrivateMessageContract,
    ({ params: { accountId, botId, messageId } }, context) => {
      const result = context.get('emulationSession').messagePinning.unpinMessageByAccount({
        fromAccountId: accountId,
        chat: { type: 'private', peerId: botId },
        messageId,
      });
      return result.unpinned ? { status: 204 } : refusePrivateUnpin(result.reason);
    },
  );

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

type PinningChat = Parameters<MessagePinning['pinMessageByAccount']>[0]['chat'];

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
): Promise<Response> {
  return answerWithActionReceipt(context, ({ messagePinning }) => {
    const input = { fromAccountId: accountId, chat, messageId };
    if (change === 'pin') {
      // Accounts pin as Telegram's clients do by default, notifying the members of a supergroup.
      const result = messagePinning.pinMessageByAccount({ ...input, isSilent: false });
      return result.pinned
        ? context.body(null, 204)
        : controlErrorResponse(context, pinChangeFailureStatus(result.reason), result.reason);
    }
    const result = messagePinning.unpinMessageByAccount(input);
    return result.unpinned
      ? context.body(null, 204)
      : controlErrorResponse(context, pinChangeFailureStatus(result.reason), result.reason);
  });
}

/** Why an account's pin of a message was refused. */
type PinFailureReason = Extract<
  ReturnType<MessagePinning['pinMessageByAccount']>,
  { readonly pinned: false }
>['reason'];

/** Why an account's unpin of a message was refused. */
type UnpinFailureReason = Extract<
  ReturnType<MessagePinning['unpinMessageByAccount']>,
  { readonly unpinned: false }
>['reason'];

/** Why an account's pin or unpin of a message was refused. */
type PinChangeFailureReason = PinFailureReason | UnpinFailureReason;

/**
 * Refuses a pin in a private chat with the status `pinChangeFailureStatus` gives.
 *
 * @throws {Error} for a refusal only a supergroup gives: an account that is not a member, or may
 * not pin there.
 */
function refusePrivatePin(reason: PinFailureReason) {
  switch (reason) {
    case 'pinner_not_found':
    case 'chat_not_found':
    case 'message_not_found':
      return { status: 404, body: { reason } } as const;
    case 'service_message_not_pinnable':
      return { status: 400, body: { reason } } as const;
    case 'message_already_pinned':
    case 'bot_blocked':
      return { status: 409, body: { reason } } as const;
    case 'not_a_member':
    case 'not_enough_rights':
      throw new Error(`A private chat refused a pin as ${reason}`);
    default: {
      const unhandledReason: never = reason;
      throw new Error(`Unhandled pin failure: ${unhandledReason}`);
    }
  }
}

/** Refuses an unpin in a private chat, as `refusePrivatePin` refuses a pin. */
function refusePrivateUnpin(reason: UnpinFailureReason) {
  switch (reason) {
    case 'pinner_not_found':
    case 'chat_not_found':
    case 'message_not_found':
      return { status: 404, body: { reason } } as const;
    case 'service_message_not_pinnable':
      return { status: 400, body: { reason } } as const;
    case 'message_not_pinned':
    case 'bot_blocked':
      return { status: 409, body: { reason } } as const;
    case 'not_a_member':
    case 'not_enough_rights':
      throw new Error(`A private chat refused an unpin as ${reason}`);
    default: {
      const unhandledReason: never = reason;
      throw new Error(`Unhandled unpin failure: ${unhandledReason}`);
    }
  }
}

/**
 * A missing account, chat, or message is not found; an account that is not a member of the
 * supergroup, or may not pin there, is forbidden from it; a service message cannot be pinned; and
 * pinning a pinned message, or unpinning one that is not, conflicts with its state, as Telegram
 * refuses it, as does a block of the private chat's bot.
 */
function pinChangeFailureStatus(reason: PinChangeFailureReason): 400 | 403 | 404 | 409 {
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
    default: {
      const unhandledReason: never = reason;
      throw new Error(`Unhandled pin change failure: ${unhandledReason}`);
    }
  }
}

type MessagePinning = EmulationSession['messagePinning'];
