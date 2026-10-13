import { Hono } from 'hono';

import {
  deleteAccountMessageContract,
  deleteSupergroupAccountMessageContract,
  editAccountMessageContract,
  editSupergroupAccountMessageContract,
} from '../../contracts/account_messages.ts';
import { INVALID_REQUEST_REASON } from '../../contracts/control_errors.ts';
import {
  sendAccountMediaGroupContract,
  sendAccountMessageContract,
} from '../../contracts/message_sending.ts';
import type {
  ControlOperationRefusal,
  DecodedControlRequest,
} from '../../contracts/operation_contract.ts';
import type { EmulationSession } from '../../../session/emulation_session.ts';
import { registerControlOperation } from '../../control_operation_route.ts';
import type { SessionRouteContextTypes } from '../session_route_context_types.ts';
import {
  type AccountMessageEntitiesReading,
  readAccountMessageEntities,
} from './account_message_entities.ts';
import {
  type AccountAlbumMediaContent,
  prepareAccountAlbumMediaContent,
  prepareAccountMessageContent,
  readAccountAlbumDrafts,
  readAccountMessageDraft,
} from './account_message_input.ts';

/** Where the account routes are mounted within the server, as a contract path template. */
const ACCOUNT_COLLECTION_MOUNT_PATH = '/sessions/{sessionId}/accounts';

type MessageSending = EmulationSession['messageSending'];

/**
 * Routes through which an account sends messages and albums to its chats, forwards messages, and
 * edits and deletes its messages.
 */
export function createMessageRoutes(): Hono<SessionRouteContextTypes> {
  const accountRoutes = new Hono<SessionRouteContextTypes>();

  registerControlOperation(
    accountRoutes,
    ACCOUNT_COLLECTION_MOUNT_PATH,
    sendAccountMessageContract,
    ({ params: { accountId }, body }, context) => {
      const { messageSending, messageForwarding, botMessageViews, mediaFiles } = context.get(
        'emulationSession',
      );
      if ('forward' in body) {
        const { to, forward } = body;
        const result = messageForwarding.forwardAccountMessage({
          fromAccountId: accountId,
          fromChat: forward.chat,
          messageId: forward.message_id,
          toChat: to,
        });
        if (!result.forwarded) {
          return refuseForward(result.reason);
        }
        const { message } = result;
        return message.kind === 'private_message'
          ? { status: 201, body: { message: botMessageViews.viewPrivateMessageForBot(message) } }
          : {
            status: 201,
            body: { message: botMessageViews.viewSupergroupMessage(message, accountId) },
          };
      }
      const draftReading = readAccountMessageDraft(body);
      if (!draftReading.read) {
        return {
          status: 400,
          body: { reason: INVALID_REQUEST_REASON, issues: draftReading.issues },
        };
      }
      const preparation = prepareAccountMessageContent(draftReading.value, mediaFiles);
      if (!preparation.prepared) {
        return { status: 400, body: { reason: preparation.reason } };
      }
      const { content } = preparation;
      const { to, reply_to_message_id: replyToMessageId } = body;
      if (to.type === 'supergroup') {
        const result = messageSending.sendAccountSupergroupMessage({
          fromAccountId: accountId,
          chat: to,
          content,
          replyToMessageId,
        });
        return result.sent
          ? {
            status: 201,
            body: { message: botMessageViews.viewSupergroupMessage(result.message, accountId) },
          }
          : refuseSupergroupSending(result.reason);
      }
      const result = messageSending.sendAccountPrivateChatMessage({
        fromAccountId: accountId,
        chat: { type: 'private', peerId: to.botId },
        content,
        replyToMessageId,
      });
      return result.sent
        ? {
          status: 201,
          body: { message: botMessageViews.viewPrivateMessageForBot(result.message) },
        }
        : refusePrivateSending(result.reason);
    },
  );

  registerControlOperation(
    accountRoutes,
    ACCOUNT_COLLECTION_MOUNT_PATH,
    sendAccountMediaGroupContract,
    ({ params: { accountId }, body }, context) => {
      const { messageSending, botMessageViews, mediaFiles } = context.get('emulationSession');
      const draftsReading = readAccountAlbumDrafts(body);
      if (!draftsReading.read) {
        return {
          status: 400,
          body: { reason: INVALID_REQUEST_REASON, issues: draftsReading.issues },
        };
      }
      const contents: AccountAlbumMediaContent[] = [];
      for (const draft of draftsReading.value) {
        const preparation = prepareAccountAlbumMediaContent(draft, mediaFiles);
        if (!preparation.prepared) {
          return { status: 400, body: { reason: preparation.reason } };
        }
        contents.push(preparation.content);
      }
      const { to, reply_to_message_id: replyToMessageId } = body;
      if (to.type === 'supergroup') {
        const result = messageSending.sendAccountSupergroupAlbum({
          fromAccountId: accountId,
          chat: to,
          contents,
          replyToMessageId,
        });
        return result.sent
          ? {
            status: 201,
            body: {
              messages: result.messages.map((message) =>
                botMessageViews.viewSupergroupMessage(message, accountId)
              ),
            },
          }
          : refuseSupergroupAlbum(result.reason);
      }
      const result = messageSending.sendAccountPrivateChatAlbum({
        fromAccountId: accountId,
        chat: { type: 'private', peerId: to.botId },
        contents,
        replyToMessageId,
      });
      return result.sent
        ? {
          status: 201,
          body: {
            messages: result.messages.map((message) =>
              botMessageViews.viewPrivateMessageForBot(message)
            ),
          },
        }
        : refusePrivateAlbum(result.reason);
    },
  );

  registerControlOperation(
    accountRoutes,
    ACCOUNT_COLLECTION_MOUNT_PATH,
    editSupergroupAccountMessageContract,
    ({ params: { accountId, chatId, messageId }, body }, context) => {
      const editReading = readMessageEditRequest(body);
      if (!editReading.read) {
        return {
          status: 400,
          body: { reason: INVALID_REQUEST_REASON, issues: [editReading.issue] },
        };
      }
      const { messageEditing, botMessageViews } = context.get('emulationSession');
      const result = messageEditing.editAccountSupergroupMessage({
        fromAccountId: accountId,
        chat: { type: 'supergroup', chatId },
        messageId,
        edit: editReading.edit,
      });
      if (!result.edited) {
        return refuseSupergroupMessageEdit(result.reason);
      }
      return {
        status: 200,
        body: { message: botMessageViews.viewSupergroupMessage(result.message, accountId) },
      };
    },
  );

  // The account deletes the message for every member, as Telegram's clients do.
  registerControlOperation(
    accountRoutes,
    ACCOUNT_COLLECTION_MOUNT_PATH,
    deleteSupergroupAccountMessageContract,
    ({ params: { accountId, chatId, messageId } }, context) => {
      const result = context.get('emulationSession').messageDeletion
        .deleteAccountSupergroupMessage({
          fromAccountId: accountId,
          chat: { type: 'supergroup', chatId },
          messageId,
        });
      if (result.deleted) {
        return { status: 204 };
      }
      switch (result.reason) {
        case 'message_not_deletable':
        case 'not_a_member':
          return { status: 403, body: { reason: result.reason } };
        default:
          return { status: 404, body: { reason: result.reason } };
      }
    },
  );

  registerControlOperation(
    accountRoutes,
    ACCOUNT_COLLECTION_MOUNT_PATH,
    editAccountMessageContract,
    ({ params: { accountId, botId, messageId }, body }, context) => {
      const editReading = readMessageEditRequest(body);
      if (!editReading.read) {
        return {
          status: 400,
          body: { reason: INVALID_REQUEST_REASON, issues: [editReading.issue] },
        };
      }
      const { messageEditing, botMessageViews } = context.get('emulationSession');
      const result = messageEditing.editAccountPrivateChatMessage({
        fromAccountId: accountId,
        chat: { type: 'private', peerId: botId },
        messageId,
        edit: editReading.edit,
      });
      if (!result.edited) {
        return refusePrivateMessageEdit(result.reason);
      }
      return {
        status: 200,
        body: { message: botMessageViews.viewPrivateMessageForBot(result.message) },
      };
    },
  );

  // The account deletes the message for both participants, as Telegram's clients can.
  registerControlOperation(
    accountRoutes,
    ACCOUNT_COLLECTION_MOUNT_PATH,
    deleteAccountMessageContract,
    ({ params: { accountId, botId, messageId } }, context) => {
      const result = context.get('emulationSession').messageDeletion
        .deleteAccountPrivateChatMessage({
          fromAccountId: accountId,
          chat: { type: 'private', peerId: botId },
          messageId,
        });
      return result.deleted ? { status: 204 } : { status: 404, body: { reason: result.reason } };
    },
  );

  return accountRoutes;
}

type AccountMessageEdit = Parameters<
  EmulationSession['messageEditing']['editAccountPrivateChatMessage']
>[0]['edit'];

/** An edit of an account's message, as the domain reads it, or the issue with its entities. */
type MessageEditReading =
  | { readonly read: true; readonly edit: AccountMessageEdit }
  | Extract<AccountMessageEntitiesReading, { readonly read: false }>;

/** Reads an edit of an account's message from its request, with the entities Telegram reads. */
function readMessageEditRequest(
  request: DecodedControlRequest<typeof editAccountMessageContract>['body'],
): MessageEditReading {
  if ('text' in request) {
    const entitiesReading = readAccountMessageEntities(request.entities, ['entities']);
    return entitiesReading.read
      ? {
        read: true,
        edit: { kind: 'text', text: request.text, entities: entitiesReading.entities },
      }
      : entitiesReading;
  }
  const captionEntitiesReading = readAccountMessageEntities(
    request.caption_entities,
    ['caption_entities'],
  );
  return captionEntitiesReading.read
    ? {
      read: true,
      edit: {
        kind: 'caption',
        caption: request.caption,
        captionEntities: captionEntitiesReading.entities,
      },
    }
    : captionEntitiesReading;
}

/** A missing account, bot, or message is not found; any other failure rejects the edit. */
function refusePrivateMessageEdit(
  reason: Extract<
    ReturnType<EmulationSession['messageEditing']['editAccountPrivateChatMessage']>,
    { readonly edited: false }
  >['reason'],
): ControlOperationRefusal<typeof editAccountMessageContract> {
  switch (reason) {
    case 'account_not_found':
    case 'bot_not_found':
    case 'message_not_found':
      return { status: 404, body: { reason } };
    default:
      return { status: 400, body: { reason } };
  }
}

/**
 * A missing account, supergroup, or message is not found; an account that is not a member is
 * forbidden from the supergroup; any other failure rejects the edit.
 */
function refuseSupergroupMessageEdit(
  reason: Extract<
    ReturnType<EmulationSession['messageEditing']['editAccountSupergroupMessage']>,
    { readonly edited: false }
  >['reason'],
): ControlOperationRefusal<typeof editSupergroupAccountMessageContract> {
  switch (reason) {
    case 'account_not_found':
    case 'chat_not_found':
    case 'message_not_found':
      return { status: 404, body: { reason } };
    case 'not_a_member':
      return { status: 403, body: { reason } };
    default:
      return { status: 400, body: { reason } };
  }
}

type SendMessageRefusal = ControlOperationRefusal<typeof sendAccountMessageContract>;
type SendAlbumRefusal = ControlOperationRefusal<typeof sendAccountMediaGroupContract>;

/**
 * A missing account or bot is not found; a block conflicts with writing to the bot, and an account
 * without a phone number conflicts with sharing its own contact; content Telegram refuses rejects
 * the request.
 */
function refusePrivateSending(
  reason: Extract<
    ReturnType<MessageSending['sendAccountPrivateChatMessage']>,
    { readonly sent: false }
  >['reason'],
): SendMessageRefusal {
  switch (reason) {
    case 'account_not_found':
    case 'bot_not_found':
      return { status: 404, body: { reason } };
    case 'bot_blocked':
    case 'account_phone_number_missing':
      return { status: 409, body: { reason } };
    default:
      return { status: 400, body: { reason } };
  }
}

/**
 * A missing account or supergroup is not found, and an account that is not a member of the
 * supergroup, or may not send the content, is forbidden from it; an account without a phone
 * number conflicts with sharing its own contact; content Telegram refuses rejects the request.
 */
function refuseSupergroupSending(
  reason: Extract<
    ReturnType<MessageSending['sendAccountSupergroupMessage']>,
    { readonly sent: false }
  >['reason'],
): SendMessageRefusal {
  switch (reason) {
    case 'account_not_found':
    case 'chat_not_found':
      return { status: 404, body: { reason } };
    case 'not_a_member':
    case 'send_permission_missing':
      return { status: 403, body: { reason } };
    case 'account_phone_number_missing':
      return { status: 409, body: { reason } };
    default:
      return { status: 400, body: { reason } };
  }
}

/** Refuses an album to a private chat as `refusePrivateSending` refuses a message. */
function refusePrivateAlbum(
  reason: Extract<
    ReturnType<MessageSending['sendAccountPrivateChatAlbum']>,
    { readonly sent: false }
  >['reason'],
): SendAlbumRefusal {
  switch (reason) {
    case 'account_not_found':
    case 'bot_not_found':
      return { status: 404, body: { reason } };
    case 'bot_blocked':
      return { status: 409, body: { reason } };
    default:
      return { status: 400, body: { reason } };
  }
}

/** Refuses an album to a supergroup as `refuseSupergroupSending` refuses a message. */
function refuseSupergroupAlbum(
  reason: Extract<
    ReturnType<MessageSending['sendAccountSupergroupAlbum']>,
    { readonly sent: false }
  >['reason'],
): SendAlbumRefusal {
  switch (reason) {
    case 'account_not_found':
    case 'chat_not_found':
      return { status: 404, body: { reason } };
    case 'not_a_member':
    case 'send_permission_missing':
      return { status: 403, body: { reason } };
    default:
      return { status: 400, body: { reason } };
  }
}

/**
 * A missing account, bot, supergroup, or message is not found, and an account that is not a member
 * of a supergroup, or may not send the message's content there, is forbidden from it. A message
 * that cannot be forwarded rejects the request, and a block conflicts with writing to the bot.
 */
function refuseForward(
  reason: Extract<
    ReturnType<EmulationSession['messageForwarding']['forwardAccountMessage']>,
    { readonly forwarded: false }
  >['reason'],
): SendMessageRefusal {
  switch (reason) {
    case 'account_not_found':
    case 'bot_not_found':
    case 'chat_not_found':
    case 'message_not_found':
      return { status: 404, body: { reason } };
    case 'not_a_member':
    case 'send_permission_missing':
      return { status: 403, body: { reason } };
    case 'message_not_forwardable':
    case 'invoice_forwarding_unsupported':
      return { status: 400, body: { reason } };
    case 'bot_blocked':
      return { status: 409, body: { reason } };
    default: {
      const unhandledReason: never = reason;
      throw new Error(`Unhandled account forward failure: ${unhandledReason}`);
    }
  }
}
