import { Hono } from 'hono';
import { basePath } from 'hono/route';
import { z } from 'zod';

import { toBotApiLocation } from '../../../types/bot_api.ts';
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
import { ACCOUNT_ID_PARAMETER, accountPathSchema } from './account_paths.ts';
import { createBlockedBotRoutes } from './blocked_bots.ts';
import { createCallbackQueryRoutes } from './callback_queries.ts';
import { viewChatMessageForAccount } from './chat_message_view.ts';
import { createConversationReadRoutes } from './conversation_reads.ts';
import { createMessageRoutes } from './messages.ts';
import { createPinnedMessageRoutes } from './pinned_messages.ts';
import { createPollAnswerRoutes } from './poll_answers.ts';
import { createReplyKeyboardPressRoutes } from './reply_keyboard_presses.ts';
import { accountLocationSchema, chatSchema, telegramUserIdSchema } from './request_fields.ts';
import { createSupergroupAdministrationRoutes } from './supergroup_administration.ts';
import { createSupergroupMembershipRoutes } from './supergroup_membership.ts';

const INLINE_QUERY_ID_PARAMETER = 'inlineQueryId';
const INLINE_QUERY_COLLECTION_PATH = `/:${ACCOUNT_ID_PARAMETER}/inline-queries` as const;
const INLINE_QUERY_PATH = `${INLINE_QUERY_COLLECTION_PATH}/:${INLINE_QUERY_ID_PARAMETER}` as const;
const CHOSEN_INLINE_RESULT_COLLECTION_PATH = `${INLINE_QUERY_PATH}/chosen-results` as const;

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

  accountRoutes.route('/', createPinnedMessageRoutes());

  accountRoutes.route('/', createBlockedBotRoutes());

  accountRoutes.route('/', createReplyKeyboardPressRoutes());

  accountRoutes.route('/', createCallbackQueryRoutes());

  accountRoutes.route('/', createPollAnswerRoutes());

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
