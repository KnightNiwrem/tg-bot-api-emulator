import { Hono } from 'hono';
import { basePath } from 'hono/route';

import { createAccountContract } from '../../contracts/accounts.ts';
import type { ControlOperationResponse } from '../../contracts/operation_contract.ts';
import type { EmulationSession } from '../../../session/emulation_session.ts';
import type { VirtualAccountProfile } from '../../../types/virtual_account.ts';
import { registerControlOperation } from '../../control_operation_route.ts';
import type { SessionRouteContextTypes } from '../session_route_context_types.ts';
import { createBlockedBotRoutes } from './blocked_bots.ts';
import { createCallbackQueryRoutes } from './callback_queries.ts';
import { createChatActionRoutes } from './chat_actions.ts';
import { createCheckoutRoutes } from './checkouts.ts';
import { createConversationReadRoutes } from './conversation_reads.ts';
import { createInlineQueryRoutes } from './inline_queries.ts';
import { createMessageDraftRoutes } from './message_drafts.ts';
import { createMessageReactionRoutes } from './message_reactions.ts';
import { createMessageRoutes } from './messages.ts';
import { createPinnedMessageRoutes } from './pinned_messages.ts';
import { createPollAnswerRoutes } from './poll_answers.ts';
import { createPollClosureRoutes } from './poll_closures.ts';
import { createReplyKeyboardPressRoutes } from './reply_keyboard_presses.ts';
import { createSupergroupAdministrationRoutes } from './supergroup_administration.ts';
import { createSupergroupMembershipRoutes } from './supergroup_membership.ts';

/** Where the account routes are mounted within the server, as a contract path template. */
const ACCOUNT_COLLECTION_MOUNT_PATH = '/sessions/{sessionId}/accounts';

type AccountCreationResponse = ControlOperationResponse<typeof createAccountContract>;

/**
 * Account-facing routes. Private messages they return are shown as the conversation's bot sees
 * them, whichever participant wrote them. Supergroup messages are shown as the requesting account
 * sees them, which differs from what other members see only in the `file_id` of a file and the
 * legacy `new_chat_member` of a service message.
 */
export function createAccountRoutes(): Hono<SessionRouteContextTypes> {
  const accountRoutes = new Hono<SessionRouteContextTypes>();

  registerControlOperation(
    accountRoutes,
    ACCOUNT_COLLECTION_MOUNT_PATH,
    createAccountContract,
    ({ body }, context) => {
      const result = context.get('emulationSession').virtualUsers.createAccount({
        first_name: body.first_name,
        ...(body.last_name === undefined ? {} : { last_name: body.last_name }),
        ...(body.username === undefined ? {} : { username: body.username }),
        ...(body.language_code === undefined ? {} : { language_code: body.language_code }),
        has_private_forwards: body.has_private_forwards,
        ...(body.phone_number === undefined ? {} : { phone_number: body.phone_number }),
      });
      if (!result.created) {
        return refuseAccountCreation(result.reason);
      }
      return {
        status: 201,
        headers: { Location: `${basePath(context)}/${result.account.profile.id}` },
        body: { account: presentAccountProfile(result.account.profile) },
      };
    },
  );

  accountRoutes.route('/', createMessageRoutes());
  accountRoutes.route('/', createSupergroupMembershipRoutes());
  accountRoutes.route('/', createSupergroupAdministrationRoutes());
  accountRoutes.route('/', createConversationReadRoutes());
  accountRoutes.route('/', createChatActionRoutes());
  accountRoutes.route('/', createMessageDraftRoutes());
  accountRoutes.route('/', createPinnedMessageRoutes());
  accountRoutes.route('/', createBlockedBotRoutes());
  accountRoutes.route('/', createReplyKeyboardPressRoutes());
  accountRoutes.route('/', createCallbackQueryRoutes());
  accountRoutes.route('/', createPollAnswerRoutes());
  accountRoutes.route('/', createPollClosureRoutes());
  accountRoutes.route('/', createMessageReactionRoutes());
  accountRoutes.route('/', createInlineQueryRoutes());
  accountRoutes.route('/', createCheckoutRoutes());

  return accountRoutes;
}

/**
 * A name Telegram's cleanup would change rejects the request; a taken username conflicts with the
 * session's usernames; and a session out of user IDs has no room for the account.
 */
function refuseAccountCreation(
  reason: Extract<
    ReturnType<EmulationSession['virtualUsers']['createAccount']>,
    { readonly created: false }
  >['reason'],
): AccountCreationResponse {
  switch (reason) {
    case 'name_invalid':
      return { status: 400, body: { reason } };
    case 'username_taken':
      return { status: 409, body: { reason } };
    case 'identity_limit_reached':
      return { status: 507, body: { reason } };
    default: {
      const unhandledReason: never = reason;
      throw new Error(`Unhandled account creation failure: ${unhandledReason}`);
    }
  }
}

/**
 * An account's profile as the control API shows it, which is how bots see the account, with its
 * fields in the order Bot API objects show them.
 */
function presentAccountProfile(profile: VirtualAccountProfile) {
  return {
    first_name: profile.first_name,
    ...(profile.last_name === undefined ? {} : { last_name: profile.last_name }),
    ...(profile.username === undefined ? {} : { username: profile.username }),
    ...(profile.language_code === undefined ? {} : { language_code: profile.language_code }),
    id: profile.id,
    is_bot: profile.is_bot,
  };
}
