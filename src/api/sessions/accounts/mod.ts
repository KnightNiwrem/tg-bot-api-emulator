import { type Context, Hono } from 'hono';
import { basePath } from 'hono/route';
import { z } from 'zod';

import { toBotApiLocation } from '../../../types/bot_api.ts';
import type { CallbackQuery } from '../../../types/callback_query.ts';
import type { EmulationSession } from '../../../types/emulation_session.ts';
import {
  type InlineQuery,
  type InlineQueryResult,
  type InlineQueryResultsButton,
  MAX_INLINE_QUERY_LENGTH,
} from '../../../types/inline_query.ts';
import { MAX_ACCOUNT_NAME_LENGTH } from '../../../types/virtual_account.ts';
import { countTextCharacters } from '../../../types/virtual_message.ts';
import { readJsonRequestBody } from '../json_request_body.ts';
import type { SessionRouteContextTypes } from '../session_route_context_types.ts';
import {
  ACCOUNT_ID_PARAMETER,
  accountPathSchema,
  BOT_ID_PARAMETER,
  MESSAGE_ID_PARAMETER,
  PRIVATE_CONVERSATION_PATH,
  PRIVATE_MESSAGE_PATH,
  privateConversationPathSchema,
  privateMessagePathSchema,
  SUPERGROUP_CONVERSATION_PATH,
  SUPERGROUP_MESSAGE_PATH,
  supergroupConversationPathSchema,
  supergroupMessagePathSchema,
} from './account_paths.ts';
import { viewChatMessageForAccount } from './chat_message_view.ts';
import { createConversationReadRoutes } from './conversation_reads.ts';
import { createMessageRoutes } from './messages.ts';
import {
  accountMessageFailureStatus,
  supergroupMemberFailureStatus,
} from './messaging_failure_statuses.ts';
import { accountLocationSchema, chatSchema, telegramUserIdSchema } from './request_fields.ts';
import { createSupergroupAdministrationRoutes } from './supergroup_administration.ts';
import { createSupergroupMembershipRoutes } from './supergroup_membership.ts';

const PRIVATE_MESSAGE_POLL_ANSWER_PATH = `${PRIVATE_MESSAGE_PATH}/poll-answer` as const;
const BLOCKED_BOT_PATH = `/:${ACCOUNT_ID_PARAMETER}/blocked-bots/:${BOT_ID_PARAMETER}` as const;
const PRIVATE_PINNED_MESSAGE_COLLECTION_PATH =
  `${PRIVATE_CONVERSATION_PATH}/pinned-messages` as const;
const PRIVATE_PINNED_MESSAGE_PATH =
  `${PRIVATE_PINNED_MESSAGE_COLLECTION_PATH}/:${MESSAGE_ID_PARAMETER}` as const;
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
const SUPERGROUP_MESSAGE_POLL_ANSWER_PATH = `${SUPERGROUP_MESSAGE_PATH}/poll-answer` as const;
const SUPERGROUP_PINNED_MESSAGE_COLLECTION_PATH =
  `${SUPERGROUP_CONVERSATION_PATH}/pinned-messages` as const;
const SUPERGROUP_PINNED_MESSAGE_PATH =
  `${SUPERGROUP_PINNED_MESSAGE_COLLECTION_PATH}/:${MESSAGE_ID_PARAMETER}` as const;

/** An E.164 phone number's digits: a country code that never starts with 0, and at most 15 digits. */
const ACCOUNT_PHONE_NUMBER_PATTERN = /^[1-9][0-9]{0,14}$/;

/** An account's first or last name, of at most as many characters as Telegram's servers allow. */
const accountNameSchema = z.string().min(1).refine(
  (name) => countTextCharacters(name) <= MAX_ACCOUNT_NAME_LENGTH,
  { message: `A name must have at most ${MAX_ACCOUNT_NAME_LENGTH} characters` },
);

const createAccountRequestSchema = z.strictObject({
  first_name: accountNameSchema,
  last_name: accountNameSchema.optional(),
  username: z.string().min(1).optional(),
  language_code: z.string().min(1).optional(),
  /** Keeps forwards of the account's messages from linking to it; they show only its name. */
  has_private_forwards: z.boolean().optional(),
  /**
   * The number the account signed up with, which it shares as its own contact: the digits of an
   * E.164 number without its `+`, as Telegram's `user.phone` holds it.
   */
  phone_number: z.string().regex(ACCOUNT_PHONE_NUMBER_PATTERN).optional(),
});

/**
 * A press of a reply keyboard button, by its text. A `request_location` button needs the location
 * the account's client reports, which no other button takes.
 */
const pressReplyKeyboardButtonRequestSchema = z.strictObject({
  chat: chatSchema,
  text: z.string().min(1),
  location: accountLocationSchema.optional(),
});

const pressCallbackButtonRequestSchema = z.strictObject({
  chat: chatSchema,
  /** The message's ID as the chat's bots see it, which is how these routes show messages. */
  message_id: z.int().positive(),
  callback_data: z.string().min(1),
  expired: z.boolean().default(false),
});

/**
 * The options an account chooses in a poll, by their positions counted from 0, as the Bot API's
 * `option_ids` numbers them; a repeated position counts once. Retracting an answer chooses none.
 */
const setPollAnswerRequestSchema = z.strictObject({
  option_ids: z.array(z.int().nonnegative()).min(1),
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
  location: accountLocationSchema.optional(),
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
      return context.body(null, accountCreationFailureStatus(result.reason));
    }

    const accountPath = `${basePath(context)}/${result.account.profile.id}`;
    return context.json(
      { account: result.account.profile },
      201,
      { Location: accountPath },
    );
  });

  accountRoutes.route('/', createMessageRoutes());

  accountRoutes.route('/', createSupergroupMembershipRoutes());

  accountRoutes.route('/', createSupergroupAdministrationRoutes());

  accountRoutes.route('/', createConversationReadRoutes());

  // The account reads the messages its private chat with the bot pins, newest first.
  accountRoutes.get(PRIVATE_PINNED_MESSAGE_COLLECTION_PATH, (context) => {
    const conversationPath = privateConversationPathSchema.safeParse(context.req.param());
    if (!conversationPath.success) {
      return context.body(null, 400);
    }
    const { accountId, botId } = conversationPath.data;
    return answerPinnedMessages(context, accountId, { type: 'private', peerId: botId });
  });

  // Either participant of a private chat pins and unpins any of its messages.
  accountRoutes.put(PRIVATE_PINNED_MESSAGE_PATH, (context) => {
    const messagePath = privateMessagePathSchema.safeParse(context.req.param());
    if (!messagePath.success) {
      return context.body(null, 400);
    }
    const { accountId, botId, messageId } = messagePath.data;
    return answerPinChange(context, 'pin', {
      accountId,
      chat: { type: 'private', peerId: botId },
      messageId,
    });
  });
  accountRoutes.delete(PRIVATE_PINNED_MESSAGE_PATH, (context) => {
    const messagePath = privateMessagePathSchema.safeParse(context.req.param());
    if (!messagePath.success) {
      return context.body(null, 400);
    }
    const { accountId, botId, messageId } = messagePath.data;
    return answerPinChange(context, 'unpin', {
      accountId,
      chat: { type: 'private', peerId: botId },
      messageId,
    });
  });

  // A member reads the messages the supergroup pins, newest first.
  accountRoutes.get(SUPERGROUP_PINNED_MESSAGE_COLLECTION_PATH, (context) => {
    const conversationPath = supergroupConversationPathSchema.safeParse(context.req.param());
    if (!conversationPath.success) {
      return context.body(null, 400);
    }
    const { accountId, chatId } = conversationPath.data;
    return answerPinnedMessages(context, accountId, { type: 'supergroup', chatId });
  });

  // A member with the `can_pin_messages` permission pins and unpins the supergroup's messages.
  accountRoutes.put(SUPERGROUP_PINNED_MESSAGE_PATH, (context) => {
    const messagePath = supergroupMessagePathSchema.safeParse(context.req.param());
    if (!messagePath.success) {
      return context.body(null, 400);
    }
    const { accountId, chatId, messageId } = messagePath.data;
    return answerPinChange(context, 'pin', {
      accountId,
      chat: { type: 'supergroup', chatId },
      messageId,
    });
  });
  accountRoutes.delete(SUPERGROUP_PINNED_MESSAGE_PATH, (context) => {
    const messagePath = supergroupMessagePathSchema.safeParse(context.req.param());
    if (!messagePath.success) {
      return context.body(null, 400);
    }
    const { accountId, chatId, messageId } = messagePath.data;
    return answerPinChange(context, 'unpin', {
      accountId,
      chat: { type: 'supergroup', chatId },
      messageId,
    });
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
    const { chat, text, location } = requestBody;
    if (chat.type === 'supergroup') {
      // Only private chats show buttons with a request, so no supergroup button takes a location.
      if (location !== undefined) {
        return context.body(null, 400);
      }
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
      ...(location === undefined ? {} : { location }),
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
        case 'account_not_found':
        case 'bot_not_found':
        case 'chat_not_found':
        case 'message_not_found':
          return context.body(null, 404);
        default: {
          const unhandledReason: never = result.reason;
          throw new Error(`Unhandled callback button press failure: ${unhandledReason}`);
        }
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

  for (
    const [pollAnswerPath, chatType] of [
      [PRIVATE_MESSAGE_POLL_ANSWER_PATH, 'private'],
      [SUPERGROUP_MESSAGE_POLL_ANSWER_PATH, 'supergroup'],
    ] as const
  ) {
    accountRoutes.get(pollAnswerPath, (context) => {
      const pollMessage = readPollMessageKey(context.req.param(), chatType);
      if (pollMessage === undefined) {
        return context.body(null, 400);
      }
      const { polls, botMessageViews } = context.get('emulationSession');
      const result = polls.getAccountPollAnswer(pollMessage);
      if (!result.found) {
        return context.body(null, pollAnswerFailureStatus(result.reason));
      }
      return context.json(presentPollAnswerForAccount(botMessageViews, result, pollMessage));
    });

    accountRoutes.put(pollAnswerPath, async (context) => {
      const pollMessage = readPollMessageKey(context.req.param(), chatType);
      if (pollMessage === undefined) {
        return context.body(null, 400);
      }
      const requestBody = await readJsonRequestBody(context.req, setPollAnswerRequestSchema);
      if (requestBody === undefined) {
        return context.body(null, 400);
      }
      const { polls, botMessageViews } = context.get('emulationSession');
      const result = polls.setAccountPollAnswer({
        ...pollMessage,
        optionPositions: requestBody.option_ids,
      });
      if (!result.answered) {
        return context.body(null, pollAnswerFailureStatus(result.reason));
      }
      return context.json(presentPollAnswerForAccount(botMessageViews, result, pollMessage));
    });

    // Retracting chooses no options, as TDLib's `setPollAnswer` does with none.
    accountRoutes.delete(pollAnswerPath, (context) => {
      const pollMessage = readPollMessageKey(context.req.param(), chatType);
      if (pollMessage === undefined) {
        return context.body(null, 400);
      }
      const result = context.get('emulationSession').polls.setAccountPollAnswer({
        ...pollMessage,
        optionPositions: [],
      });
      return result.answered
        ? context.body(null, 204)
        : context.body(null, pollAnswerFailureStatus(result.reason));
    });
  }

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
        case 'account_not_found':
        case 'bot_not_found':
        case 'chat_not_found':
          return context.body(null, 404);
        default: {
          const unhandledReason: never = result.reason;
          throw new Error(`Unhandled inline query send failure: ${unhandledReason}`);
        }
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
    const result = await inlineQueries.chooseInlineQueryResult({
      accountId,
      inlineQueryId: context.req.param(INLINE_QUERY_ID_PARAMETER),
      resultId: requestBody.result_id,
      signal: context.req.raw.signal,
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

/**
 * A name Telegram's cleanup would empty or refuse rejects the request; a taken username conflicts
 * with the session's usernames; and a session out of user IDs has no room for the account.
 */
function accountCreationFailureStatus(
  reason: Extract<
    ReturnType<EmulationSession['virtualUsers']['createAccount']>,
    { readonly created: false }
  >['reason'],
): 400 | 409 | 507 {
  switch (reason) {
    case 'name_invalid':
      return 400;
    case 'username_taken':
      return 409;
    case 'identity_limit_reached':
      return 507;
    default: {
      const unhandledReason: never = reason;
      throw new Error(`Unhandled account creation failure: ${unhandledReason}`);
    }
  }
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
    return context.body(null, result.reason === 'not_a_member' ? 403 : 404);
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
    return context.body(null, result.pinned ? 204 : pinChangeFailureStatus(result.reason));
  }
  const result = messagePinning.unpinMessage(input);
  return context.body(null, result.unpinned ? 204 : pinChangeFailureStatus(result.reason));
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

/** A message showing a poll, as an account addresses it. */
type AccountPollMessageKey = Parameters<EmulationSession['polls']['getAccountPollAnswer']>[0];

/** A poll an account found, with its own answer. */
type AccountPollAnswer = Omit<
  Extract<
    ReturnType<EmulationSession['polls']['getAccountPollAnswer']>,
    { readonly found: true }
  >,
  'found'
>;

/**
 * Reads the message of a poll answer route, in an account's private chat with a bot or in a
 * supergroup; `undefined` for path parameters that identify none.
 */
function readPollMessageKey(
  pathParameters: Record<string, string>,
  chatType: AccountPollMessageKey['chat']['type'],
): AccountPollMessageKey | undefined {
  if (chatType === 'private') {
    const messagePath = privateMessagePathSchema.safeParse(pathParameters);
    return messagePath.success
      ? {
        accountId: messagePath.data.accountId,
        chat: { type: 'private', botId: messagePath.data.botId },
        messageId: messagePath.data.messageId,
      }
      : undefined;
  }
  const messagePath = supergroupMessagePathSchema.safeParse(pathParameters);
  return messagePath.success
    ? {
      accountId: messagePath.data.accountId,
      chat: { type: 'supergroup', chatId: messagePath.data.chatId },
      messageId: messagePath.data.messageId,
    }
    : undefined;
}

/**
 * Shows an account's answer to a poll, with the message showing the poll as these routes show
 * messages. Options are identified by position, as `option_ids` of the Bot API's `PollAnswer`
 * numbers them, and by their persistent identifiers.
 */
function presentPollAnswerForAccount(
  botMessageViews: EmulationSession['botMessageViews'],
  { poll, message, chosenOptionPositions }: AccountPollAnswer,
  { accountId }: AccountPollMessageKey,
) {
  return {
    poll_answer: {
      poll_id: poll.id,
      option_ids: chosenOptionPositions,
      option_persistent_ids: chosenOptionPositions.map((optionPosition) =>
        poll.options[optionPosition].persistentId
      ),
    },
    message: viewChatMessageForAccount(botMessageViews, message, accountId),
  };
}

/**
 * A chat or message the account cannot find, or one without a poll, is not found; a chat the
 * account is no member of forbids voting; an answer the poll cannot accept is rejected; and an
 * answer the poll's state or settings forbid, such as a change of an answer that cannot be
 * changed, conflicts with it.
 */
function pollAnswerFailureStatus(
  reason: Extract<
    ReturnType<EmulationSession['polls']['setAccountPollAnswer']>,
    { readonly answered: false }
  >['reason'],
): 400 | 403 | 404 | 409 {
  switch (reason) {
    case 'account_not_found':
    case 'bot_not_found':
    case 'chat_not_found':
    case 'message_not_found':
    case 'message_has_no_poll':
      return 404;
    case 'not_a_member':
      return 403;
    case 'multiple_answers_not_allowed':
    case 'poll_option_not_found':
      return 400;
    case 'poll_closed':
    case 'answer_retraction_not_allowed':
    case 'answer_change_not_allowed':
      return 409;
    default: {
      const unhandledReason: never = reason;
      throw new Error(`Unhandled poll answer failure: ${unhandledReason}`);
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
 * A missing query is not found; a result the answer does not hold rejects the request; an account
 * no longer a member of the supergroup, or one that may not use inline bots or send the result's
 * content there, is forbidden; a query without an answer, or a bot the account blocks, conflicts
 * with sending it; and media the result names by URL that the emulated web does not serve fails as
 * a bad gateway, while media it serves that is not of the result's kind cannot be processed.
 */
function chosenInlineResultFailureStatus(
  reason: Extract<
    Awaited<ReturnType<EmulationSession['inlineQueries']['chooseInlineQueryResult']>>,
    { readonly chosen: false }
  >['reason'],
): 400 | 403 | 404 | 409 | 422 | 502 {
  switch (reason) {
    case 'inline_query_not_found':
      return 404;
    case 'result_not_found':
      return 400;
    case 'not_a_member':
    case 'inline_bots_not_permitted':
    case 'send_permission_missing':
      return 403;
    case 'inline_query_not_answered':
    case 'bot_blocked':
      return 409;
    case 'web_media_invalid':
      return 422;
    case 'web_media_unavailable':
      return 502;
    default: {
      const unhandledReason: never = reason;
      throw new Error(`Unhandled inline query result choice failure: ${unhandledReason}`);
    }
  }
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
    // A voice note result has no description.
    ...('description' in result && result.description !== undefined
      ? { description: result.description }
      : {}),
    ...(result.kind === 'article' && result.url !== undefined ? { url: result.url } : {}),
  };
}

/** Shows the button above the results as the Bot API specifies it. */
function presentInlineQueryResultsButton(button: InlineQueryResultsButton) {
  return button.kind === 'start_bot'
    ? { text: button.text, start_parameter: button.startParameter }
    : { text: button.text, web_app: { url: button.url } };
}
