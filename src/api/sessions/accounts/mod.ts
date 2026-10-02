import { type Context, Hono } from 'hono';
import { basePath } from 'hono/route';
import { z } from 'zod';

import { toBotApiLocation } from '../../../types/bot_api.ts';
import type { BotCommand } from '../../../types/bot_command.ts';
import { getApplicableAdministratorRightFlags } from '../../../types/bot_default_administrator_rights.ts';
import { toBotApiMenuButton } from '../../../types/bot_menu_button.ts';
import type { CallbackQuery } from '../../../types/callback_query.ts';
import {
  grantSupergroupAdministratorRights,
  MAX_CUSTOM_TITLE_LENGTH,
  SUPERGROUP_ADMINISTRATOR_RIGHTS,
} from '../../../types/chat_membership.ts';
import type { EmulationSession } from '../../../types/emulation_session.ts';
import { createGeoLocation, MAX_HORIZONTAL_ACCURACY_METERS } from '../../../types/geo_location.ts';
import {
  type InlineQuery,
  type InlineQueryResult,
  type InlineQueryResultsButton,
  MAX_INLINE_QUERY_LENGTH,
} from '../../../types/inline_query.ts';
import type {
  ReplyInterface,
  ReplyKeyboardButton,
  ReplyKeyboardButtonRequest,
} from '../../../types/reply_interface.ts';
import {
  MAX_SUPERGROUP_OR_CHANNEL_ID,
  MAX_TELEGRAM_USER_ID,
  MIN_SUPERGROUP_OR_CHANNEL_ID,
  MIN_TELEGRAM_USER_ID,
} from '../../../types/telegram_identity.ts';
import type { Supergroup, VisibleChatAction } from '../../../types/virtual_chat.ts';
import {
  type ChatMessage,
  countTextCharacters,
  getMessageNotification,
  MAX_TEXT_MESSAGE_LENGTH,
} from '../../../types/virtual_message.ts';
import { base64ContentSchema } from '../base64_content.ts';
import { readMessageEntitiesParameter } from '../bot_api/message_entities_parameter.ts';
import { readJsonRequestBody } from '../json_request_body.ts';
import type { SessionRouteContextTypes } from '../session_route_context_types.ts';

const ACCOUNT_ID_PARAMETER = 'accountId';
const BOT_ID_PARAMETER = 'botId';
const ACCOUNT_MESSAGE_COLLECTION_PATH = `/:${ACCOUNT_ID_PARAMETER}/messages` as const;
const PRIVATE_CONVERSATION_PATH =
  `/:${ACCOUNT_ID_PARAMETER}/conversations/private/:${BOT_ID_PARAMETER}` as const;
const PRIVATE_MESSAGE_HISTORY_PATH = `${PRIVATE_CONVERSATION_PATH}/messages` as const;
const MESSAGE_ID_PARAMETER = 'messageId';
const PRIVATE_MESSAGE_PATH = `${PRIVATE_MESSAGE_HISTORY_PATH}/:${MESSAGE_ID_PARAMETER}` as const;
const BLOCKED_BOT_PATH = `/:${ACCOUNT_ID_PARAMETER}/blocked-bots/:${BOT_ID_PARAMETER}` as const;
const PRIVATE_CHAT_COMMANDS_PATH = `${PRIVATE_CONVERSATION_PATH}/commands` as const;
const PRIVATE_CHAT_MENU_BUTTON_PATH = `${PRIVATE_CONVERSATION_PATH}/menu-button` as const;
const PRIVATE_CHAT_REPLY_INTERFACE_PATH = `${PRIVATE_CONVERSATION_PATH}/reply-interface` as const;
const PRIVATE_CHAT_ACTIONS_PATH = `${PRIVATE_CONVERSATION_PATH}/chat-actions` as const;
const PRIVATE_CHAT_NOTIFICATIONS_PATH = `${PRIVATE_CONVERSATION_PATH}/notifications` as const;
const REPLY_KEYBOARD_PRESS_COLLECTION_PATH =
  `/:${ACCOUNT_ID_PARAMETER}/reply-keyboard-presses` as const;
const CALLBACK_QUERY_ID_PARAMETER = 'callbackQueryId';
const CALLBACK_QUERY_COLLECTION_PATH = `/:${ACCOUNT_ID_PARAMETER}/callback-queries` as const;
const CALLBACK_QUERY_PATH =
  `${CALLBACK_QUERY_COLLECTION_PATH}/:${CALLBACK_QUERY_ID_PARAMETER}` as const;
const INLINE_QUERY_ID_PARAMETER = 'inlineQueryId';
const INLINE_QUERY_COLLECTION_PATH = `/:${ACCOUNT_ID_PARAMETER}/inline-queries` as const;
const INLINE_QUERY_PATH = `${INLINE_QUERY_COLLECTION_PATH}/:${INLINE_QUERY_ID_PARAMETER}` as const;
const CHOSEN_INLINE_RESULT_COLLECTION_PATH = `${INLINE_QUERY_PATH}/chosen-results` as const;
const SUPERGROUP_COLLECTION_PATH = `/:${ACCOUNT_ID_PARAMETER}/supergroups` as const;
const CHAT_ID_PARAMETER = 'chatId';
const SUPERGROUP_CONVERSATION_PATH =
  `/:${ACCOUNT_ID_PARAMETER}/conversations/supergroup/:${CHAT_ID_PARAMETER}` as const;
const SUPERGROUP_MESSAGE_HISTORY_PATH = `${SUPERGROUP_CONVERSATION_PATH}/messages` as const;
const SUPERGROUP_COMMANDS_PATH = `${SUPERGROUP_CONVERSATION_PATH}/commands` as const;
const SUPERGROUP_CHAT_ACTIONS_PATH = `${SUPERGROUP_CONVERSATION_PATH}/chat-actions` as const;
const SUPERGROUP_NOTIFICATIONS_PATH = `${SUPERGROUP_CONVERSATION_PATH}/notifications` as const;
const SUPERGROUP_REPLY_INTERFACE_PATH = `${SUPERGROUP_CONVERSATION_PATH}/reply-interface` as const;
const SUPERGROUP_MESSAGE_PATH =
  `${SUPERGROUP_MESSAGE_HISTORY_PATH}/:${MESSAGE_ID_PARAMETER}` as const;
const USER_ID_PARAMETER = 'userId';
const SUPERGROUP_MEMBER_PATH =
  `${SUPERGROUP_CONVERSATION_PATH}/members/:${USER_ID_PARAMETER}` as const;
const SUPERGROUP_ADMINISTRATOR_PATH =
  `${SUPERGROUP_CONVERSATION_PATH}/administrators/:${USER_ID_PARAMETER}` as const;
const SUPERGROUP_CUSTOM_TITLE_PATH = `${SUPERGROUP_ADMINISTRATOR_PATH}/custom-title` as const;
const SUPERGROUP_CONTENT_PROTECTION_PATH =
  `${SUPERGROUP_CONVERSATION_PATH}/content-protection` as const;
const SUPERGROUP_TITLE_PATH = `${SUPERGROUP_CONVERSATION_PATH}/title` as const;
const SUPERGROUP_DESCRIPTION_PATH = `${SUPERGROUP_CONVERSATION_PATH}/description` as const;

const telegramUserIdSchema = z.number().int()
  .min(MIN_TELEGRAM_USER_ID)
  .max(MAX_TELEGRAM_USER_ID);
const telegramUserIdPathParameterSchema = z.coerce.number().pipe(telegramUserIdSchema);
const supergroupChatIdSchema = z.number().int()
  .min(MIN_SUPERGROUP_OR_CHANNEL_ID)
  .max(MAX_SUPERGROUP_OR_CHANNEL_ID);
const supergroupChatIdPathParameterSchema = z.coerce.number().pipe(supergroupChatIdSchema);
/** A message's ID as the chat's bots see it, which is how these routes show messages. */
const messageIdPathParameterSchema = z.coerce.number().pipe(z.int().positive());

/** The path parameters of the account a route acts as. */
const accountPathSchema = z.object({
  [ACCOUNT_ID_PARAMETER]: telegramUserIdPathParameterSchema,
});
/** The path parameters of an account's private chat with a bot. */
const privateConversationPathSchema = accountPathSchema.extend({
  [BOT_ID_PARAMETER]: telegramUserIdPathParameterSchema,
});
/** The path parameters of a message of an account's private chat with a bot. */
const privateMessagePathSchema = privateConversationPathSchema.extend({
  [MESSAGE_ID_PARAMETER]: messageIdPathParameterSchema,
});
/** The path parameters of a supergroup as an account addresses it. */
const supergroupConversationPathSchema = accountPathSchema.extend({
  [CHAT_ID_PARAMETER]: supergroupChatIdPathParameterSchema,
});
/** The path parameters of a supergroup message as an account addresses it. */
const supergroupMessagePathSchema = supergroupConversationPathSchema.extend({
  [MESSAGE_ID_PARAMETER]: messageIdPathParameterSchema,
});
/** The path parameters of a supergroup member as an account addresses it. */
const supergroupMemberPathSchema = supergroupConversationPathSchema.extend({
  [USER_ID_PARAMETER]: telegramUserIdPathParameterSchema,
});

/**
 * The chat a message goes to or a button is on: a private chat with a bot, or a supergroup the
 * account is a member of.
 */
const chatSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('private'), botId: telegramUserIdSchema }),
  z.strictObject({ type: z.literal('supergroup'), chatId: supergroupChatIdSchema }),
]);

const createAccountRequestSchema = z.strictObject({
  first_name: z.string().min(1),
  last_name: z.string().min(1).optional(),
  username: z.string().min(1).optional(),
  language_code: z.string().min(1).optional(),
  /** Keeps forwards of the account's messages from linking to it; they show only its name. */
  has_private_forwards: z.boolean().optional(),
});

/** A file's content, which JSON carries as base64 text. */
const sentMessageTargetShape = {
  to: chatSchema,
  /** The replied message's ID as the chat's bots see it, which is how these routes show messages. */
  reply_to_message_id: z.int().positive().optional(),
};

/** A caption, which Telegram's service limits, so its length is checked when sending. */
const captionSchema = z.string().default('');

/**
 * Formatting an account specifies for its text or caption, as the Bot API's `MessageEntity`
 * objects, which are read as for bots: entity types Telegram detects by itself are ignored.
 */
const messageEntitiesSchema = z.array(z.unknown()).transform((entityValues, context) => {
  const reading = readMessageEntitiesParameter(entityValues, 'Invalid message entities');
  if (!reading.read) {
    context.issues.push({ code: 'custom', message: reading.description, input: entityValues });
    return z.NEVER;
  }
  return reading.entities;
}).optional();

/** Message text, whose length counts characters as Telegram's limit does, not UTF-16 code units. */
const messageTextSchema = z.string().min(1).refine(
  (text) => countTextCharacters(text) <= MAX_TEXT_MESSAGE_LENGTH,
  { message: `Text must have at most ${MAX_TEXT_MESSAGE_LENGTH} characters` },
);

/**
 * A text message, a photo, or a document, each with an optional caption; or a forward of a message
 * of one of the account's chats, which, as in Telegram's clients, replies to none.
 */
const sendMessageRequestSchema = z.union([
  z.strictObject({
    to: chatSchema,
    forward: z.strictObject({
      chat: chatSchema,
      /** The message's ID as the chat's bots see it, which is how these routes show messages. */
      message_id: z.int().positive(),
    }),
  }),
  z.strictObject({
    ...sentMessageTargetShape,
    text: messageTextSchema,
    entities: messageEntitiesSchema,
  }),
  z.strictObject({
    ...sentMessageTargetShape,
    photo: z.strictObject({ content_base64: base64ContentSchema }),
    caption: captionSchema,
    caption_entities: messageEntitiesSchema,
  }),
  z.strictObject({
    ...sentMessageTargetShape,
    document: z.strictObject({
      content_base64: base64ContentSchema,
      file_name: z.string().min(1),
    }),
    caption: captionSchema,
    caption_entities: messageEntitiesSchema,
  }),
]);

/** The rights an administrator holds, by the Bot API's names; an omitted right is not held. */
const promoteChatMemberRequestSchema = z.partialRecord(
  z.enum(SUPERGROUP_ADMINISTRATOR_RIGHTS),
  z.boolean(),
);

/**
 * A custom title of at most 16 characters, counted by code point, without emoji, as the Bot API
 * documents it; empty removes the title.
 */
const setCustomTitleRequestSchema = z.strictObject({
  custom_title: z.string()
    .refine((title) => [...title].length <= MAX_CUSTOM_TITLE_LENGTH)
    .refine((title) => !/\p{Extended_Pictographic}/u.test(title)),
});

/** A supergroup's new title, which Telegram cleans; one that cleans to nothing is refused. */
const changeSupergroupTitleRequestSchema = z.strictObject({ title: z.string() });

/** A supergroup's new description, which Telegram cleans; empty removes it. */
const changeSupergroupDescriptionRequestSchema = z.strictObject({ description: z.string() });

const createSupergroupRequestSchema = z.strictObject({
  title: z.string().min(1),
  /** Makes the supergroup public under this username, unique among the session's usernames. */
  username: z.string().min(1).optional(),
  description: z.string().min(1).optional(),
});

/** New text for a text message, or a new caption for a photo or document; empty removes it. */
const editMessageRequestSchema = z.union([
  z.strictObject({ text: messageTextSchema, entities: messageEntitiesSchema }),
  z.strictObject({ caption: z.string(), caption_entities: messageEntitiesSchema }),
]);

const pressReplyKeyboardButtonRequestSchema = z.strictObject({
  chat: chatSchema,
  text: z.string().min(1),
});

const pressCallbackButtonRequestSchema = z.strictObject({
  chat: chatSchema,
  /** The message's ID as the chat's bots see it, which is how these routes show messages. */
  message_id: z.int().positive(),
  callback_data: z.string().min(1),
  expired: z.boolean().default(false),
});

/**
 * An inline query typed in a chat, for the inline bot whose username precedes it. The query holds
 * up to 256 characters, counted by code point.
 */
const sendInlineQueryRequestSchema = z.strictObject({
  bot_id: telegramUserIdSchema,
  chat: chatSchema,
  query: z.string().default('').refine((query) => [...query].length <= MAX_INLINE_QUERY_LENGTH),
  /** The `next_offset` of an earlier answer, requesting more results; empty for the first. */
  offset: z.string().default(''),
  /** Where the account is, shared with a bot that requests it. */
  location: z.strictObject({
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    horizontal_accuracy: z.number().min(0).max(MAX_HORIZONTAL_ACCURACY_METERS).default(0),
  }).transform(({ latitude, longitude, horizontal_accuracy }) =>
    createGeoLocation(latitude, longitude, horizontal_accuracy)
  ).optional(),
});

const chooseInlineQueryResultRequestSchema = z.strictObject({
  result_id: z.string().min(1),
});

/**
 * Account-facing routes. Private messages they return are shown as the conversation's bot sees
 * them, whichever participant wrote them. Supergroup messages are shown as the requesting account
 * sees them, which differs from what other members see only in the `file_id` of a file and the
 * legacy `new_chat_member` of a service message.
 */
export function createAccountRoutes(): Hono<SessionRouteContextTypes> {
  const accountRoutes = new Hono<SessionRouteContextTypes>();

  accountRoutes.post('/', async (context) => {
    const requestBody = await readJsonRequestBody(context.req, createAccountRequestSchema);
    if (requestBody === undefined) {
      return context.body(null, 400);
    }

    const result = context.get('emulationSession').virtualUsers.createAccount(requestBody);
    if (!result.created) {
      return context.body(null, result.reason === 'username_taken' ? 409 : 507);
    }

    const accountPath = `${basePath(context)}/${result.account.profile.id}`;
    return context.json(
      { account: result.account.profile },
      201,
      { Location: accountPath },
    );
  });

  accountRoutes.post(ACCOUNT_MESSAGE_COLLECTION_PATH, async (context) => {
    const accountPath = accountPathSchema.safeParse(context.req.param());
    if (!accountPath.success) {
      return context.body(null, 400);
    }
    const { accountId } = accountPath.data;

    const requestBody = await readJsonRequestBody(context.req, sendMessageRequestSchema);
    if (requestBody === undefined) {
      return context.body(null, 400);
    }

    const {
      privateMessaging,
      supergroupMessaging,
      messageForwarding,
      botMessageViews,
      mediaFiles,
    } = context.get('emulationSession');
    if ('forward' in requestBody) {
      const { to, forward } = requestBody;
      const result = messageForwarding.forwardAccountMessage({
        fromAccountId: accountId,
        fromChat: forward.chat,
        messageId: forward.message_id,
        toChat: to,
      });
      if (!result.forwarded) {
        return context.body(null, forwardFailureStatus(result.reason));
      }
      return context.json(
        { message: viewChatMessageForAccount(botMessageViews, result.message, accountId) },
        201,
      );
    }
    const content = readAccountMessageContent(requestBody, mediaFiles);
    if (content === undefined) {
      return context.body(null, 400);
    }
    const { to, reply_to_message_id: replyToMessageId } = requestBody;
    if (to.type === 'supergroup') {
      const result = supergroupMessaging.sendAccountMessage({
        fromAccountId: accountId,
        chatId: to.chatId,
        content,
        replyToMessageId,
      });
      if (!result.sent) {
        return context.body(null, supergroupMemberFailureStatus(result.reason));
      }
      return context.json(
        { message: botMessageViews.viewSupergroupMessage(result.message, accountId) },
        201,
      );
    }

    const result = privateMessaging.sendAccountMessage({
      fromAccountId: accountId,
      to,
      content,
      replyToBotMessageId: replyToMessageId,
    });
    if (!result.sent) {
      return context.body(null, accountMessageFailureStatus(result.reason));
    }

    return context.json(
      { message: botMessageViews.viewPrivateMessageForBot(result.message) },
      201,
    );
  });

  accountRoutes.post(SUPERGROUP_COLLECTION_PATH, async (context) => {
    const accountPath = accountPathSchema.safeParse(context.req.param());
    if (!accountPath.success) {
      return context.body(null, 400);
    }
    const { accountId } = accountPath.data;

    const requestBody = await readJsonRequestBody(context.req, createSupergroupRequestSchema);
    if (requestBody === undefined) {
      return context.body(null, 400);
    }

    const { title, username, description } = requestBody;
    const result = context.get('emulationSession').sharedChatAdministration.createSupergroup({
      creatorAccountId: accountId,
      title,
      ...(username === undefined ? {} : { username }),
      description,
    });
    if (!result.created) {
      switch (result.reason) {
        case 'creator_account_not_found':
          return context.body(null, 404);
        case 'username_taken':
          return context.body(null, 409);
        case 'identity_limit_reached':
          return context.body(null, 507);
        default: {
          const unhandledReason: never = result.reason;
          throw new Error(`Unhandled supergroup creation failure: ${unhandledReason}`);
        }
      }
    }
    return context.json({ supergroup: presentSupergroup(result.supergroup) }, 201);
  });

  accountRoutes.put(SUPERGROUP_MEMBER_PATH, (context) => {
    const memberPath = supergroupMemberPathSchema.safeParse(context.req.param());
    if (!memberPath.success) {
      return context.body(null, 400);
    }
    const { accountId, chatId, userId } = memberPath.data;

    const result = context.get('emulationSession').sharedChatAdministration.addChatMember({
      actorAccountId: accountId,
      chatId,
      memberId: userId,
    });
    if (result.added) {
      return context.body(null, 204);
    }
    switch (result.reason) {
      // Adding a member again changes nothing, as a repeated PUT should.
      case 'member_already_present':
        return context.body(null, 204);
      case 'actor_not_authorized':
        return context.body(null, 403);
      case 'actor_account_not_found':
      case 'chat_not_found':
      case 'member_not_found':
        return context.body(null, 404);
      // Only supergroups are addressed here, and they accept bots.
      case 'bot_not_permitted_in_channel':
        throw new Error(`Supergroup ${chatId} refused bot ${userId} as a channel`);
      default: {
        const unhandledReason: never = result.reason;
        throw new Error(`Unhandled chat member addition failure: ${unhandledReason}`);
      }
    }
  });

  // The account leaves when it names itself, and otherwise removes the member as the owner.
  accountRoutes.delete(SUPERGROUP_MEMBER_PATH, (context) => {
    const memberPath = supergroupMemberPathSchema.safeParse(context.req.param());
    if (!memberPath.success) {
      return context.body(null, 400);
    }
    const { accountId, chatId, userId } = memberPath.data;

    const { sharedChatAdministration } = context.get('emulationSession');
    if (userId === accountId) {
      const result = sharedChatAdministration.leaveChat({
        memberId: accountId,
        chatId,
      });
      if (result.left) {
        return context.body(null, 204);
      }
      switch (result.reason) {
        // Leaving again changes nothing, as a repeated DELETE should.
        case 'not_a_member':
          return context.body(null, 204);
        case 'member_not_found':
        case 'chat_not_found':
          return context.body(null, 404);
        case 'owner_cannot_leave':
          return context.body(null, 409);
        default: {
          const unhandledReason: never = result.reason;
          throw new Error(`Unhandled chat leaving failure: ${unhandledReason}`);
        }
      }
    }

    const result = sharedChatAdministration.removeChatMember({
      actorAccountId: accountId,
      chatId,
      memberId: userId,
    });
    if (result.removed) {
      return context.body(null, 204);
    }
    switch (result.reason) {
      // Removing a member again changes nothing, as a repeated DELETE should.
      case 'not_a_member':
        return context.body(null, 204);
      case 'actor_not_authorized':
        return context.body(null, 403);
      case 'actor_account_not_found':
      case 'chat_not_found':
      case 'member_not_found':
        return context.body(null, 404);
      // A chat has one owner, and an owner naming itself leaves instead.
      case 'member_is_owner':
        throw new Error(`Supergroup ${chatId} has an owner besides ${accountId}`);
      default: {
        const unhandledReason: never = result.reason;
        throw new Error(`Unhandled chat member removal failure: ${unhandledReason}`);
      }
    }
  });

  // The owner promotes a member to administrator, or changes an administrator's rights.
  accountRoutes.put(SUPERGROUP_ADMINISTRATOR_PATH, async (context) => {
    const memberPath = supergroupMemberPathSchema.safeParse(context.req.param());
    if (!memberPath.success) {
      return context.body(null, 400);
    }
    const requestBody = await readJsonRequestBody(context.req, promoteChatMemberRequestSchema);
    if (requestBody === undefined) {
      return context.body(null, 400);
    }
    const { accountId, chatId, userId } = memberPath.data;

    const result = context.get('emulationSession').sharedChatAdministration.promoteChatMember({
      actorAccountId: accountId,
      chatId,
      memberId: userId,
      rights: grantSupergroupAdministratorRights(
        SUPERGROUP_ADMINISTRATOR_RIGHTS.filter((right) => requestBody[right] === true),
      ),
    });
    if (result.promoted) {
      return context.body(null, 204);
    }
    // An administrator without rights would be a member; DELETE demotes one instead.
    return result.reason === 'no_rights_granted'
      ? context.body(null, 400)
      : context.body(null, memberRoleChangeFailureStatus(result.reason));
  });

  // The owner sets its own custom title or an administrator's; an empty title removes it.
  accountRoutes.put(SUPERGROUP_CUSTOM_TITLE_PATH, async (context) => {
    const memberPath = supergroupMemberPathSchema.safeParse(context.req.param());
    if (!memberPath.success) {
      return context.body(null, 400);
    }
    const requestBody = await readJsonRequestBody(context.req, setCustomTitleRequestSchema);
    if (requestBody === undefined) {
      return context.body(null, 400);
    }
    const { accountId, chatId, userId } = memberPath.data;

    const result = context.get('emulationSession').sharedChatAdministration.setCustomTitle({
      actorAccountId: accountId,
      chatId,
      memberId: userId,
      customTitle: requestBody.custom_title,
    });
    if (result.set) {
      return context.body(null, 204);
    }
    switch (result.reason) {
      case 'actor_account_not_found':
      case 'chat_not_found':
      case 'member_not_found':
        return context.body(null, 404);
      case 'actor_not_authorized':
        return context.body(null, 403);
      case 'not_a_member':
      case 'not_an_administrator':
        return context.body(null, 409);
      default: {
        const unhandledReason: never = result.reason;
        throw new Error(`Unhandled custom title failure: ${unhandledReason}`);
      }
    }
  });

  // A member changes the supergroup's title, which a service message records.
  accountRoutes.put(SUPERGROUP_TITLE_PATH, async (context) => {
    const conversationPath = supergroupConversationPathSchema.safeParse(context.req.param());
    if (!conversationPath.success) {
      return context.body(null, 400);
    }
    const requestBody = await readJsonRequestBody(
      context.req,
      changeSupergroupTitleRequestSchema,
    );
    if (requestBody === undefined) {
      return context.body(null, 400);
    }
    const { accountId, chatId } = conversationPath.data;

    const result = context.get('emulationSession').sharedChatAdministration
      .changeSupergroupTitle({
        actor: { kind: 'account', accountId },
        chatId,
        title: requestBody.title,
      });
    return result.changed
      ? context.body(null, 204)
      : context.body(null, supergroupInfoChangeFailureStatus(result.reason));
  });

  // A member changes the supergroup's description, which no service message records.
  accountRoutes.put(SUPERGROUP_DESCRIPTION_PATH, async (context) => {
    const conversationPath = supergroupConversationPathSchema.safeParse(context.req.param());
    if (!conversationPath.success) {
      return context.body(null, 400);
    }
    const requestBody = await readJsonRequestBody(
      context.req,
      changeSupergroupDescriptionRequestSchema,
    );
    if (requestBody === undefined) {
      return context.body(null, 400);
    }
    const { accountId, chatId } = conversationPath.data;

    const result = context.get('emulationSession').sharedChatAdministration
      .changeSupergroupDescription({
        actor: { kind: 'account', accountId },
        chatId,
        description: requestBody.description,
      });
    return result.changed
      ? context.body(null, 204)
      : context.body(null, supergroupInfoChangeFailureStatus(result.reason));
  });

  // The owner protects all content of the supergroup from forwarding and saving, or lifts that.
  accountRoutes.put(
    SUPERGROUP_CONTENT_PROTECTION_PATH,
    (context) => setSupergroupContentProtection(context, true),
  );
  accountRoutes.delete(
    SUPERGROUP_CONTENT_PROTECTION_PATH,
    (context) => setSupergroupContentProtection(context, false),
  );

  // The owner demotes an administrator to a member; demoting a member changes nothing.
  accountRoutes.delete(SUPERGROUP_ADMINISTRATOR_PATH, (context) => {
    const memberPath = supergroupMemberPathSchema.safeParse(context.req.param());
    if (!memberPath.success) {
      return context.body(null, 400);
    }
    const { accountId, chatId, userId } = memberPath.data;

    const result = context.get('emulationSession').sharedChatAdministration.demoteChatMember({
      actorAccountId: accountId,
      chatId,
      memberId: userId,
    });
    return result.demoted
      ? context.body(null, 204)
      : context.body(null, memberRoleChangeFailureStatus(result.reason));
  });

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

  accountRoutes.get(SUPERGROUP_CHAT_ACTIONS_PATH, (context) => {
    const conversationPath = supergroupConversationPathSchema.safeParse(context.req.param());
    if (!conversationPath.success) {
      return context.body(null, 400);
    }
    const { accountId, chatId } = conversationPath.data;

    const result = context.get('emulationSession').chatActions.getSupergroupChatActions({
      accountId,
      chatId,
    });
    if (!result.found) {
      return context.body(null, result.reason === 'not_a_member' ? 403 : 404);
    }
    return context.json({ chat_actions: result.chatActions.map(presentChatActionForAccount) });
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

  accountRoutes.patch(SUPERGROUP_MESSAGE_PATH, async (context) => {
    const messagePath = supergroupMessagePathSchema.safeParse(context.req.param());
    if (!messagePath.success) {
      return context.body(null, 400);
    }
    const { accountId, chatId, messageId } = messagePath.data;

    const requestBody = await readJsonRequestBody(context.req, editMessageRequestSchema);
    if (requestBody === undefined) {
      return context.body(null, 400);
    }

    const { supergroupMessaging, botMessageViews } = context.get('emulationSession');
    const result = supergroupMessaging.editAccountMessage({
      fromAccountId: accountId,
      chatId,
      messageId,
      edit: readAccountMessageEdit(requestBody),
    });
    if (!result.edited) {
      return context.body(null, supergroupMemberFailureStatus(result.reason));
    }
    return context.json({
      message: botMessageViews.viewSupergroupMessage(result.message, accountId),
    });
  });

  // The account deletes the message for every member, as Telegram's clients do.
  accountRoutes.delete(SUPERGROUP_MESSAGE_PATH, (context) => {
    const messagePath = supergroupMessagePathSchema.safeParse(context.req.param());
    if (!messagePath.success) {
      return context.body(null, 400);
    }
    const { accountId, chatId, messageId } = messagePath.data;

    const result = context.get('emulationSession').supergroupMessaging.deleteAccountMessage({
      fromAccountId: accountId,
      chatId,
      messageId,
    });
    if (result.deleted) {
      return context.body(null, 204);
    }
    return context.body(
      null,
      result.reason === 'message_not_deletable'
        ? 403
        : supergroupMemberFailureStatus(result.reason),
    );
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

  accountRoutes.patch(PRIVATE_MESSAGE_PATH, async (context) => {
    const messagePath = privateMessagePathSchema.safeParse(context.req.param());
    if (!messagePath.success) {
      return context.body(null, 400);
    }
    const { accountId, botId, messageId } = messagePath.data;

    const requestBody = await readJsonRequestBody(context.req, editMessageRequestSchema);
    if (requestBody === undefined) {
      return context.body(null, 400);
    }

    const { privateMessaging, botMessageViews } = context.get('emulationSession');
    const result = privateMessaging.editAccountMessage({
      fromAccountId: accountId,
      chat: { type: 'private', botId },
      botMessageId: messageId,
      edit: readAccountMessageEdit(requestBody),
    });
    if (!result.edited) {
      const isNotFound = result.reason === 'account_not_found' ||
        result.reason === 'bot_not_found' || result.reason === 'message_not_found';
      return context.body(null, isNotFound ? 404 : 400);
    }
    return context.json({ message: botMessageViews.viewPrivateMessageForBot(result.message) });
  });

  // The account deletes the message for both participants, as Telegram's clients can.
  accountRoutes.delete(PRIVATE_MESSAGE_PATH, (context) => {
    const messagePath = privateMessagePathSchema.safeParse(context.req.param());
    if (!messagePath.success) {
      return context.body(null, 400);
    }
    const { accountId, botId, messageId } = messagePath.data;

    const result = context.get('emulationSession').privateMessaging.deleteAccountMessage({
      fromAccountId: accountId,
      botId,
      botMessageId: messageId,
    });
    return context.body(null, result.deleted ? 204 : 404);
  });

  accountRoutes.put(BLOCKED_BOT_PATH, (context) => {
    const conversationPath = privateConversationPathSchema.safeParse(context.req.param());
    if (!conversationPath.success) {
      return context.body(null, 400);
    }
    const { accountId, botId } = conversationPath.data;

    const result = context.get('emulationSession').botBlocking.blockBot({
      accountId,
      botId,
    });
    return context.body(null, result.applied ? 204 : 404);
  });

  accountRoutes.delete(BLOCKED_BOT_PATH, (context) => {
    const conversationPath = privateConversationPathSchema.safeParse(context.req.param());
    if (!conversationPath.success) {
      return context.body(null, 400);
    }
    const { accountId, botId } = conversationPath.data;

    const result = context.get('emulationSession').botBlocking.unblockBot({
      accountId,
      botId,
    });
    return context.body(null, result.applied ? 204 : 404);
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

  accountRoutes.get(PRIVATE_CHAT_ACTIONS_PATH, (context) => {
    const conversationPath = privateConversationPathSchema.safeParse(context.req.param());
    if (!conversationPath.success) {
      return context.body(null, 400);
    }
    const { accountId, botId } = conversationPath.data;

    const result = context.get('emulationSession').chatActions.getPrivateChatActions({
      accountId,
      botId,
    });
    if (!result.found) {
      return context.body(null, 404);
    }
    return context.json({ chat_actions: result.chatActions.map(presentChatActionForAccount) });
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

  accountRoutes.post(REPLY_KEYBOARD_PRESS_COLLECTION_PATH, async (context) => {
    const accountPath = accountPathSchema.safeParse(context.req.param());
    if (!accountPath.success) {
      return context.body(null, 400);
    }
    const { accountId } = accountPath.data;

    const requestBody = await readJsonRequestBody(
      context.req,
      pressReplyKeyboardButtonRequestSchema,
    );
    if (requestBody === undefined) {
      return context.body(null, 400);
    }

    const { privateMessaging, supergroupMessaging, botMessageViews } = context.get(
      'emulationSession',
    );
    const { chat, text } = requestBody;
    if (chat.type === 'supergroup') {
      const result = supergroupMessaging.pressReplyKeyboardButton({
        fromAccountId: accountId,
        chatId: chat.chatId,
        text,
      });
      if (!result.sent) {
        return context.body(null, supergroupMemberFailureStatus(result.reason));
      }
      return context.json(
        { message: botMessageViews.viewSupergroupMessage(result.message, accountId) },
        201,
      );
    }
    const result = privateMessaging.pressReplyKeyboardButton({
      fromAccountId: accountId,
      chat,
      text,
    });
    if (!result.sent) {
      return context.body(null, accountMessageFailureStatus(result.reason));
    }
    return context.json(
      { message: botMessageViews.viewPrivateMessageForBot(result.message) },
      201,
    );
  });

  accountRoutes.post(CALLBACK_QUERY_COLLECTION_PATH, async (context) => {
    const accountPath = accountPathSchema.safeParse(context.req.param());
    if (!accountPath.success) {
      return context.body(null, 400);
    }
    const { accountId } = accountPath.data;

    const requestBody = await readJsonRequestBody(context.req, pressCallbackButtonRequestSchema);
    if (requestBody === undefined) {
      return context.body(null, 400);
    }

    const result = context.get('emulationSession').callbackQueries.pressCallbackButton({
      fromAccountId: accountId,
      chat: requestBody.chat,
      messageId: requestBody.message_id,
      callbackData: requestBody.callback_data,
      expired: requestBody.expired,
    });
    if (!result.pressed) {
      switch (result.reason) {
        case 'callback_button_not_found':
          return context.body(null, 400);
        case 'not_a_member':
          return context.body(null, 403);
        default:
          return context.body(null, 404);
      }
    }

    const callbackQueryPath = `${
      basePath(context)
    }/${accountId}/callback-queries/${result.callbackQuery.id}`;
    return context.json(
      { callback_query: presentCallbackQueryForAccount(result.callbackQuery) },
      201,
      { Location: callbackQueryPath },
    );
  });

  accountRoutes.get(CALLBACK_QUERY_PATH, (context) => {
    const accountPath = accountPathSchema.safeParse(context.req.param());
    if (!accountPath.success) {
      return context.body(null, 400);
    }
    const { accountId } = accountPath.data;

    const callbackQuery = context.get('emulationSession').callbackQueries.getAccountCallbackQuery({
      accountId,
      callbackQueryId: context.req.param(CALLBACK_QUERY_ID_PARAMETER),
    });
    if (callbackQuery === undefined) {
      return context.body(null, 404);
    }
    return context.json({ callback_query: presentCallbackQueryForAccount(callbackQuery) });
  });

  accountRoutes.post(INLINE_QUERY_COLLECTION_PATH, async (context) => {
    const accountPath = accountPathSchema.safeParse(context.req.param());
    if (!accountPath.success) {
      return context.body(null, 400);
    }
    const { accountId } = accountPath.data;

    const requestBody = await readJsonRequestBody(context.req, sendInlineQueryRequestSchema);
    if (requestBody === undefined) {
      return context.body(null, 400);
    }

    const result = context.get('emulationSession').inlineQueries.sendInlineQuery({
      fromAccountId: accountId,
      botId: requestBody.bot_id,
      chat: requestBody.chat,
      query: requestBody.query,
      offset: requestBody.offset,
      ...(requestBody.location === undefined ? {} : { userLocation: requestBody.location }),
    });
    if (!result.sent) {
      switch (result.reason) {
        case 'not_a_member':
          return context.body(null, 403);
        case 'inline_mode_disabled':
        case 'inline_location_not_requested':
          return context.body(null, 409);
        default:
          return context.body(null, 404);
      }
    }

    const inlineQueryPath = `${
      basePath(context)
    }/${accountId}/inline-queries/${result.inlineQuery.id}`;
    return context.json(
      { inline_query: presentInlineQueryForAccount(result.inlineQuery) },
      201,
      { Location: inlineQueryPath },
    );
  });

  accountRoutes.get(INLINE_QUERY_PATH, (context) => {
    const accountPath = accountPathSchema.safeParse(context.req.param());
    if (!accountPath.success) {
      return context.body(null, 400);
    }
    const { accountId } = accountPath.data;

    const inlineQuery = context.get('emulationSession').inlineQueries.getAccountInlineQuery({
      accountId,
      inlineQueryId: context.req.param(INLINE_QUERY_ID_PARAMETER),
    });
    if (inlineQuery === undefined) {
      return context.body(null, 404);
    }
    return context.json({ inline_query: presentInlineQueryForAccount(inlineQuery) });
  });

  accountRoutes.post(CHOSEN_INLINE_RESULT_COLLECTION_PATH, async (context) => {
    const accountPath = accountPathSchema.safeParse(context.req.param());
    if (!accountPath.success) {
      return context.body(null, 400);
    }
    const { accountId } = accountPath.data;

    const requestBody = await readJsonRequestBody(
      context.req,
      chooseInlineQueryResultRequestSchema,
    );
    if (requestBody === undefined) {
      return context.body(null, 400);
    }

    const { inlineQueries, botMessageViews } = context.get('emulationSession');
    const result = inlineQueries.chooseInlineQueryResult({
      accountId,
      inlineQueryId: context.req.param(INLINE_QUERY_ID_PARAMETER),
      resultId: requestBody.result_id,
    });
    if (!result.chosen) {
      return context.body(null, chosenInlineResultFailureStatus(result.reason));
    }
    return context.json(
      { message: viewChatMessageForAccount(botMessageViews, result.message, accountId) },
      201,
    );
  });

  return accountRoutes;
}

type AccountMessageContent = Parameters<
  EmulationSession['privateMessaging']['sendAccountMessage']
>[0]['content'];

/**
 * Reads the content of an account's message, checking an uploaded photo as Telegram does; returns
 * `undefined` for a file Telegram would not send.
 */
function readAccountMessageContent(
  request: Exclude<z.infer<typeof sendMessageRequestSchema>, { readonly forward: unknown }>,
  mediaFiles: EmulationSession['mediaFiles'],
): AccountMessageContent | undefined {
  if ('text' in request) {
    return { kind: 'text', text: request.text, entities: request.entities };
  }
  const preparation = 'photo' in request
    ? mediaFiles.preparePhotoUpload({
      content: request.photo.content_base64,
      source: 'account_upload',
    })
    : mediaFiles.prepareDocumentUpload({
      content: request.document.content_base64,
      fileName: request.document.file_name,
      source: 'account_upload',
    });
  return preparation.prepared
    ? {
      kind: 'media',
      upload: preparation.upload,
      caption: request.caption,
      captionEntities: request.caption_entities,
    }
    : undefined;
}

type AccountMessageEdit = Parameters<
  EmulationSession['privateMessaging']['editAccountMessage']
>[0]['edit'];

function readAccountMessageEdit(
  request: z.infer<typeof editMessageRequestSchema>,
): AccountMessageEdit {
  return 'text' in request
    ? { kind: 'text', text: request.text, entities: request.entities }
    : { kind: 'caption', caption: request.caption, captionEntities: request.caption_entities };
}

/** Why an account's message, sent directly or by pressing a reply keyboard button, failed. */
type AccountMessageFailureReason = Extract<
  ReturnType<EmulationSession['privateMessaging']['pressReplyKeyboardButton']>,
  { readonly sent: false }
>['reason'];

/** A missing participant is not found, and a block conflicts with writing to the bot. */
function accountMessageFailureStatus(reason: AccountMessageFailureReason): 400 | 404 | 409 {
  switch (reason) {
    case 'account_not_found':
    case 'bot_not_found':
      return 404;
    case 'bot_blocked':
      return 409;
    default:
      return 400;
  }
}

type SupergroupMessaging = EmulationSession['supergroupMessaging'];

/** Why an account's message, edit, or history request in a supergroup failed. */
type SupergroupAccountFailureReason =
  | Extract<ReturnType<SupergroupMessaging['sendAccountMessage']>, { sent: false }>['reason']
  | Extract<
    ReturnType<SupergroupMessaging['pressReplyKeyboardButton']>,
    { sent: false }
  >['reason']
  | Extract<ReturnType<SupergroupMessaging['editAccountMessage']>, { edited: false }>['reason']
  | Extract<ReturnType<SupergroupMessaging['getMessageHistory']>, { found: false }>['reason'];

/**
 * A missing account, supergroup, or message is not found, and an account that is not a member of
 * the supergroup is forbidden from it; other failures reject the request.
 */
function supergroupMemberFailureStatus(reason: SupergroupAccountFailureReason): 400 | 403 | 404 {
  switch (reason) {
    case 'account_not_found':
    case 'chat_not_found':
    case 'message_not_found':
      return 404;
    case 'not_a_member':
      return 403;
    default:
      return 400;
  }
}

/**
 * A missing account, bot, supergroup, or message is not found, and an account that is not a member
 * of a supergroup is forbidden from it. A message that cannot be forwarded rejects the request,
 * and a block conflicts with writing to the bot.
 */
function forwardFailureStatus(
  reason: Extract<
    ReturnType<EmulationSession['messageForwarding']['forwardAccountMessage']>,
    { readonly forwarded: false }
  >['reason'],
): 400 | 403 | 404 | 409 {
  switch (reason) {
    case 'account_not_found':
    case 'bot_not_found':
    case 'chat_not_found':
    case 'message_not_found':
      return 404;
    case 'not_a_member':
      return 403;
    case 'message_not_forwardable':
      return 400;
    case 'bot_blocked':
      return 409;
    default: {
      const unhandledReason: never = reason;
      throw new Error(`Unhandled account forward failure: ${unhandledReason}`);
    }
  }
}

/**
 * Only the owner changes a member's role, and only a current member other than the owner has a
 * role to change.
 */
function memberRoleChangeFailureStatus(
  reason: Extract<
    ReturnType<EmulationSession['sharedChatAdministration']['demoteChatMember']>,
    { readonly demoted: false }
  >['reason'],
): 403 | 404 | 409 {
  switch (reason) {
    case 'actor_account_not_found':
    case 'chat_not_found':
    case 'member_not_found':
      return 404;
    case 'actor_not_authorized':
      return 403;
    case 'not_a_member':
    case 'member_is_owner':
      return 409;
    default: {
      const unhandledReason: never = reason;
      throw new Error(`Unhandled member role change failure: ${unhandledReason}`);
    }
  }
}

/** Answers the owner's request to protect a supergroup's content, or to lift that protection. */
function setSupergroupContentProtection(
  context: Context<SessionRouteContextTypes>,
  hasProtectedContent: boolean,
): Response {
  const conversationPath = supergroupConversationPathSchema.safeParse(context.req.param());
  if (!conversationPath.success) {
    return context.body(null, 400);
  }
  const { accountId, chatId } = conversationPath.data;

  const result = context.get('emulationSession').sharedChatAdministration.setContentProtection({
    actorAccountId: accountId,
    chatId,
    hasProtectedContent,
  });
  if (result.set) {
    return context.body(null, 204);
  }
  return context.body(null, result.reason === 'actor_not_authorized' ? 403 : 404);
}

/**
 * A missing account or supergroup is not found; an account that is not a member, or may not
 * change the supergroup's information, is forbidden from it; a description the supergroup has
 * conflicts with it, as Telegram refuses it; text Telegram cannot use rejects the request.
 */
function supergroupInfoChangeFailureStatus(
  reason: Extract<
    | ReturnType<SupergroupAdministration['changeSupergroupTitle']>
    | ReturnType<SupergroupAdministration['changeSupergroupDescription']>,
    { readonly changed: false }
  >['reason'],
): 400 | 403 | 404 | 409 {
  switch (reason) {
    case 'actor_not_found':
    case 'chat_not_found':
      return 404;
    case 'not_a_member':
    case 'not_enough_rights':
      return 403;
    case 'description_not_modified':
      return 409;
    case 'text_encoding_invalid':
    case 'title_empty':
      return 400;
    // Only bots are refused for their former membership.
    case 'bot_not_a_member':
    case 'bot_kicked':
      throw new Error(`Account refused as a bot: ${reason}`);
    default: {
      const unhandledReason: never = reason;
      throw new Error(`Unhandled supergroup information failure: ${unhandledReason}`);
    }
  }
}

type SupergroupAdministration = EmulationSession['sharedChatAdministration'];

/** Shows a supergroup as the Bot API shows a chat, with its description when it has one. */
function presentSupergroup({ id, title, username, description }: Supergroup) {
  return {
    id,
    type: 'supergroup' as const,
    title,
    ...(username === undefined ? {} : { username }),
    ...(description === undefined ? {} : { description }),
  };
}

/** Shows a chat action as the account's client shows it: the bot and what it is doing. */
function presentChatActionForAccount({ botId, action }: VisibleChatAction) {
  return { bot_id: botId, action };
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

/** Shows a callback query to the account that created it, with the bot's answer once given. */
function presentCallbackQueryForAccount({ id, callbackData, state }: CallbackQuery) {
  return {
    id,
    callback_data: callbackData,
    status: state.status,
    answer: state.status !== 'answered' ? null : {
      ...(state.answer.text === undefined ? {} : { text: state.answer.text }),
      show_alert: state.answer.showAlert,
      ...(state.answer.url === undefined ? {} : { url: state.answer.url }),
      cache_time: state.answer.cacheTimeSeconds,
    },
  };
}

/**
 * A missing query is not found; a result the answer does not hold rejects the request; a query
 * without an answer, or a chat the account can no longer write to, conflicts with sending it.
 */
function chosenInlineResultFailureStatus(
  reason: Extract<
    ReturnType<EmulationSession['inlineQueries']['chooseInlineQueryResult']>,
    { readonly chosen: false }
  >['reason'],
): 400 | 403 | 404 | 409 {
  switch (reason) {
    case 'inline_query_not_found':
      return 404;
    case 'result_not_found':
      return 400;
    case 'not_a_member':
      return 403;
    case 'inline_query_not_answered':
    case 'bot_blocked':
      return 409;
    default: {
      const unhandledReason: never = reason;
      throw new Error(`Unhandled inline query result choice failure: ${unhandledReason}`);
    }
  }
}

/**
 * Shows a message as these routes show messages: a private message as the conversation's bot sees
 * it, and a supergroup message as the requesting account sees it.
 */
function viewChatMessageForAccount(
  botMessageViews: EmulationSession['botMessageViews'],
  message: ChatMessage,
  accountId: number,
) {
  return message.kind === 'private_message'
    ? botMessageViews.viewPrivateMessageForBot(message)
    : botMessageViews.viewSupergroupMessage(message, accountId);
}

/** Shows an inline query to the account that sent it, with the bot's answer once given. */
function presentInlineQueryForAccount(
  { id, botId, chat, query, offset, userLocation, state }: InlineQuery,
) {
  return {
    id,
    bot_id: botId,
    chat,
    query,
    offset,
    ...(userLocation === undefined ? {} : { location: toBotApiLocation(userLocation) }),
    status: state.status,
    answer: state.status !== 'answered' ? null : {
      results: state.answer.results.map(presentInlineQueryResultForAccount),
      cache_time: state.answer.cacheTimeSeconds,
      is_personal: state.answer.isPersonal,
      next_offset: state.answer.nextOffset,
      ...(state.answer.button === undefined
        ? {}
        : { button: presentInlineQueryResultsButton(state.answer.button) }),
    },
  };
}

/**
 * Shows a result as the account's client lists it, by its type, identifier, and texts. What
 * sending it writes shows in the sent message.
 */
function presentInlineQueryResultForAccount(result: InlineQueryResult) {
  return {
    type: result.kind,
    id: result.id,
    ...(result.title === undefined ? {} : { title: result.title }),
    ...(result.description === undefined ? {} : { description: result.description }),
    ...(result.kind === 'article' && result.url !== undefined ? { url: result.url } : {}),
  };
}

/** Shows the button above the results as the Bot API specifies it. */
function presentInlineQueryResultsButton(button: InlineQueryResultsButton) {
  return button.kind === 'start_bot'
    ? { text: button.text, start_parameter: button.startParameter }
    : { text: button.text, web_app: { url: button.url } };
}
