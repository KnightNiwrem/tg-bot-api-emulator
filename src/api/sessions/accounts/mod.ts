import { Hono } from 'hono';
import { basePath } from 'hono/route';
import { z } from 'zod';

import type { EmulationSession } from '../../../types/emulation_session.ts';
import { isTelegramUsername } from '../../../types/telegram_identity.ts';
import { MAX_ACCOUNT_NAME_LENGTH } from '../../../types/virtual_account.ts';
import { countTextCharacters } from '../../../types/virtual_message.ts';
import { readJsonRequestBody } from '../json_request_body.ts';
import type { SessionRouteContextTypes } from '../session_route_context_types.ts';
import { createBlockedBotRoutes } from './blocked_bots.ts';
import { createCallbackQueryRoutes } from './callback_queries.ts';
import { createConversationReadRoutes } from './conversation_reads.ts';
import { createInlineQueryRoutes } from './inline_queries.ts';
import { createMessageReactionRoutes } from './message_reactions.ts';
import { createMessageRoutes } from './messages.ts';
import { createPinnedMessageRoutes } from './pinned_messages.ts';
import { createPollAnswerRoutes } from './poll_answers.ts';
import { createPollClosureRoutes } from './poll_closures.ts';
import { createReplyKeyboardPressRoutes } from './reply_keyboard_presses.ts';
import { createSupergroupAdministrationRoutes } from './supergroup_administration.ts';
import { createSupergroupMembershipRoutes } from './supergroup_membership.ts';

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
  username: z.string().refine(isTelegramUsername).optional(),
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
  accountRoutes.route('/', createPollClosureRoutes());
  accountRoutes.route('/', createMessageReactionRoutes());
  accountRoutes.route('/', createInlineQueryRoutes());

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
