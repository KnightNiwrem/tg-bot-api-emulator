import { Hono } from 'hono';

import {
  getPrivatePinnedMessagesContract,
  getSupergroupPinnedMessagesContract,
  pinPrivateMessageContract,
  pinSupergroupMessageContract,
  unpinPrivateMessageContract,
  unpinSupergroupMessageContract,
} from '../../contracts/pinned_messages.ts';
import type { EmulationSession } from '../../../session/emulation_session.ts';
import { registerControlOperation } from '../../control_operation_route.ts';
import type { SessionRouteContextTypes } from '../session_route_context_types.ts';
import {
  viewPrivateChatMessageForBot,
  viewSupergroupChatMessageForAccount,
} from './chat_message_view.ts';

/** Where the account routes are mounted within the server, as a contract path template. */
const ACCOUNT_COLLECTION_MOUNT_PATH = '/sessions/{sessionId}/accounts';

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
  registerControlOperation(
    accountRoutes,
    ACCOUNT_COLLECTION_MOUNT_PATH,
    getSupergroupPinnedMessagesContract,
    ({ params: { accountId, chatId } }, context) => {
      const { messagePinning, botMessageViews } = context.get('emulationSession');
      const result = messagePinning.getPinnedMessages({
        accountId,
        chat: { type: 'supergroup', chatId },
      });
      if (!result.found) {
        return result.reason === 'not_a_member'
          ? { status: 403, body: { reason: result.reason } }
          : { status: 404, body: { reason: result.reason } };
      }
      return {
        status: 200,
        body: {
          messages: result.messages.map((message) =>
            viewSupergroupChatMessageForAccount(botMessageViews, message, accountId)
          ),
        },
      };
    },
  );

  // A member with the `can_pin_messages` permission pins and unpins the supergroup's messages.
  registerControlOperation(
    accountRoutes,
    ACCOUNT_COLLECTION_MOUNT_PATH,
    pinSupergroupMessageContract,
    ({ params: { accountId, chatId, messageId } }, context) => {
      // Accounts pin as Telegram's clients do by default, notifying the members of a supergroup.
      const result = context.get('emulationSession').messagePinning.pinMessageByAccount({
        fromAccountId: accountId,
        chat: { type: 'supergroup', chatId },
        messageId,
        isSilent: false,
      });
      return result.pinned ? { status: 204 } : refusePin(result.reason);
    },
  );
  registerControlOperation(
    accountRoutes,
    ACCOUNT_COLLECTION_MOUNT_PATH,
    unpinSupergroupMessageContract,
    ({ params: { accountId, chatId, messageId } }, context) => {
      const result = context.get('emulationSession').messagePinning.unpinMessageByAccount({
        fromAccountId: accountId,
        chat: { type: 'supergroup', chatId },
        messageId,
      });
      return result.unpinned ? { status: 204 } : refuseUnpin(result.reason);
    },
  );

  return accountRoutes;
}

type MessagePinning = EmulationSession['messagePinning'];

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

/**
 * A missing account, chat, or message is not found; an account that is not a member of the
 * supergroup, or may not pin there, is forbidden from it; a service message cannot be pinned; and
 * pinning a pinned message conflicts with its state, as Telegram refuses it, as does a block of
 * the private chat's bot, which conflicts with writing to the bot as for an account's messages.
 */
function refusePin(reason: PinFailureReason) {
  switch (reason) {
    case 'pinner_not_found':
    case 'chat_not_found':
    case 'message_not_found':
      return { status: 404, body: { reason } } as const;
    case 'not_a_member':
    case 'not_enough_rights':
      return { status: 403, body: { reason } } as const;
    case 'service_message_not_pinnable':
      return { status: 400, body: { reason } } as const;
    case 'message_already_pinned':
    case 'bot_blocked':
      return { status: 409, body: { reason } } as const;
    default: {
      const unhandledReason: never = reason;
      throw new Error(`Unhandled pin failure: ${unhandledReason}`);
    }
  }
}

/** Refuses an unpin as `refusePin` refuses a pin; unpinning a message that is not conflicts. */
function refuseUnpin(reason: UnpinFailureReason) {
  switch (reason) {
    case 'pinner_not_found':
    case 'chat_not_found':
    case 'message_not_found':
      return { status: 404, body: { reason } } as const;
    case 'not_a_member':
    case 'not_enough_rights':
      return { status: 403, body: { reason } } as const;
    case 'service_message_not_pinnable':
      return { status: 400, body: { reason } } as const;
    case 'message_not_pinned':
    case 'bot_blocked':
      return { status: 409, body: { reason } } as const;
    default: {
      const unhandledReason: never = reason;
      throw new Error(`Unhandled unpin failure: ${unhandledReason}`);
    }
  }
}

/**
 * Refuses a pin in a private chat as `refusePin` does.
 *
 * @throws {Error} for a refusal only a supergroup gives: an account that is not a member, or may
 * not pin there.
 */
function refusePrivatePin(reason: PinFailureReason) {
  const refusal = refusePin(reason);
  if (refusal.status === 403) {
    throw new Error(`A private chat refused a pin as ${refusal.body.reason}`);
  }
  return refusal;
}

/** Refuses an unpin in a private chat, as `refusePrivatePin` refuses a pin. */
function refusePrivateUnpin(reason: UnpinFailureReason) {
  const refusal = refuseUnpin(reason);
  if (refusal.status === 403) {
    throw new Error(`A private chat refused an unpin as ${refusal.body.reason}`);
  }
  return refusal;
}
