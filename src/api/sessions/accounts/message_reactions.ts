import { Hono } from 'hono';

import {
  getSupergroupMessageReactionsContract,
  removeSupergroupAccountMessageReactionContract,
  setSupergroupAccountMessageReactionContract,
} from '../../contracts/message_reactions.ts';
import type { EmulationSession } from '../../../session/emulation_session.ts';
import { registerControlOperation } from '../../control_operation_route.ts';
import type { SessionRouteContextTypes } from '../session_route_context_types.ts';
import { viewSupergroupChatMessageForAccount } from './chat_message_view.ts';

/** Where the account routes are mounted within the server, as a contract path template. */
const ACCOUNT_COLLECTION_MOUNT_PATH = '/sessions/{sessionId}/accounts';

type MessageReactions = EmulationSession['messageReactions'];

/**
 * Routes through which an account reads the reactions to a supergroup message, and sets or removes
 * its own reactions to it.
 */
export function createMessageReactionRoutes(): Hono<SessionRouteContextTypes> {
  const accountRoutes = new Hono<SessionRouteContextTypes>();

  registerControlOperation(
    accountRoutes,
    ACCOUNT_COLLECTION_MOUNT_PATH,
    getSupergroupMessageReactionsContract,
    ({ params: { accountId, chatId, messageId } }, context) => {
      const { messageReactions, botMessageViews } = context.get('emulationSession');
      const result = messageReactions.getAccountMessageReactions({ accountId, chatId, messageId });
      if (!result.found) {
        return result.reason === 'not_a_member'
          ? { status: 403, body: { reason: result.reason } }
          : { status: 404, body: { reason: result.reason } };
      }
      return {
        status: 200,
        body: presentMessageReactions(botMessageViews, result, accountId),
      };
    },
  );

  registerControlOperation(
    accountRoutes,
    ACCOUNT_COLLECTION_MOUNT_PATH,
    setSupergroupAccountMessageReactionContract,
    ({ params: { accountId, chatId, messageId }, body: { reaction } }, context) => {
      const { messageReactions, botMessageViews } = context.get('emulationSession');
      const result = messageReactions.setAccountMessageReaction({
        accountId,
        chatId,
        messageId,
        emojis: reaction.map(({ emoji }) => emoji),
      });
      if (!result.set) {
        return refuseMessageReaction(result.reason);
      }
      return {
        status: 200,
        body: presentMessageReactions(botMessageViews, result, accountId),
      };
    },
  );

  registerControlOperation(
    accountRoutes,
    ACCOUNT_COLLECTION_MOUNT_PATH,
    removeSupergroupAccountMessageReactionContract,
    ({ params: { accountId, chatId, messageId } }, context) => {
      const result = context.get('emulationSession').messageReactions.setAccountMessageReaction({
        accountId,
        chatId,
        messageId,
        emojis: [],
      });
      if (result.set) {
        return { status: 204 };
      }
      const refusal = refuseMessageReaction(result.reason);
      // Choosing no reactions never adds a distinct reaction to the message.
      if (refusal.status === 409) {
        throw new Error(`Removing reactions was refused as ${refusal.body.reason}`);
      }
      return refusal;
    },
  );

  return accountRoutes;
}

/** A message's reactions, with the message that holds them. */
type FoundMessageReactions = Omit<
  Extract<ReturnType<MessageReactions['getAccountMessageReactions']>, { readonly found: true }>,
  'found'
>;

/**
 * Shows the reactions to a message, each user's as the Bot API's `MessageReactionUpdated` lists a
 * user's reactions, with the message that holds them as the account's history shows it.
 */
function presentMessageReactions(
  botMessageViews: EmulationSession['botMessageViews'],
  { message, reactions }: FoundMessageReactions,
  accountId: number,
) {
  return {
    message: viewSupergroupChatMessageForAccount(botMessageViews, message, accountId),
    reactions: reactions.map(({ userId, emojis }) => ({
      user_id: userId,
      reaction: emojis.map((emoji) => ({ type: 'emoji' as const, emoji })),
    })),
  };
}

/**
 * A supergroup, account or message that cannot be found is not found; a supergroup the account is
 * no member of, or a reaction its permissions withhold, is forbidden; reactions that no message
 * accepts are rejected; and a new reaction to a message that shows as many distinct reactions as
 * it may conflicts with it.
 */
function refuseMessageReaction(
  reason: Extract<
    ReturnType<MessageReactions['setAccountMessageReaction']>,
    { readonly set: false }
  >['reason'],
) {
  switch (reason) {
    case 'account_not_found':
    case 'chat_not_found':
    case 'message_not_found':
      return { status: 404, body: { reason } } as const;
    case 'not_a_member':
    case 'reaction_not_permitted':
      return { status: 403, body: { reason } } as const;
    case 'message_not_reactable':
    case 'reaction_emoji_unsupported':
    case 'too_many_reactions':
      return { status: 400, body: { reason } } as const;
    case 'too_many_distinct_reactions':
      return { status: 409, body: { reason } } as const;
    default: {
      const unhandledReason: never = reason;
      throw new Error(`Unhandled message reaction failure: ${unhandledReason}`);
    }
  }
}
