import { Hono } from 'hono';
import { z } from 'zod';

import type { EmulationSession } from '../../../types/emulation_session.ts';
import {
  controlErrorResponse,
  invalidControlRequestResponse,
} from '../../control_error_response.ts';
import { type ControlRequestInputReading, readPathParameters } from '../control_request_input.ts';
import { readJsonRequestBody } from '../json_request_body.ts';
import type { SessionRouteContextTypes } from '../session_route_context_types.ts';
import { SUPERGROUP_MESSAGE_PATH, supergroupMessagePathSchema } from './account_paths.ts';
import { viewChatMessageForAccount } from './chat_message_view.ts';

const SUPERGROUP_MESSAGE_REACTIONS_PATH = `${SUPERGROUP_MESSAGE_PATH}/reactions` as const;

/** An ordinary emoji reaction, as the Bot API's `ReactionTypeEmoji` writes it. */
const reactionTypeEmojiSchema = z.strictObject({
  type: z.literal('emoji'),
  emoji: z.string(),
});

/**
 * The reactions an account chooses, as the Bot API's `reaction` lists them. Removing them is a
 * `DELETE` of the same path.
 */
const setMessageReactionRequestSchema = z.strictObject({
  reaction: z.array(reactionTypeEmojiSchema).min(1),
});

/**
 * Routes through which an account reads the reactions to a supergroup message, and sets or removes
 * its own reactions to it.
 */
export function createMessageReactionRoutes(): Hono<SessionRouteContextTypes> {
  const accountRoutes = new Hono<SessionRouteContextTypes>();

  accountRoutes.get(SUPERGROUP_MESSAGE_REACTIONS_PATH, (context) => {
    const messageKeyReading = readReactionMessageKey(context.req.param());
    if (!messageKeyReading.valid) {
      return invalidControlRequestResponse(context, messageKeyReading.issues);
    }
    const messageKey = messageKeyReading.value;
    const { messageReactions, botMessageViews } = context.get('emulationSession');
    const result = messageReactions.getAccountMessageReactions(messageKey);
    if (!result.found) {
      return controlErrorResponse(
        context,
        messageReactionFailureStatus(result.reason),
        result.reason,
      );
    }
    return context.json(presentMessageReactions(botMessageViews, result, messageKey));
  });

  accountRoutes.put(SUPERGROUP_MESSAGE_REACTIONS_PATH, async (context) => {
    const messageKeyReading = readReactionMessageKey(context.req.param());
    if (!messageKeyReading.valid) {
      return invalidControlRequestResponse(context, messageKeyReading.issues);
    }
    const messageKey = messageKeyReading.value;
    const requestBodyReading = await readJsonRequestBody(
      context.req,
      setMessageReactionRequestSchema,
    );
    if (!requestBodyReading.valid) {
      return invalidControlRequestResponse(context, requestBodyReading.issues);
    }
    const requestBody = requestBodyReading.value;
    const { messageReactions, botMessageViews } = context.get('emulationSession');
    const result = messageReactions.setAccountMessageReaction({
      ...messageKey,
      emojis: requestBody.reaction.map(({ emoji }) => emoji),
    });
    if (!result.set) {
      return controlErrorResponse(
        context,
        messageReactionFailureStatus(result.reason),
        result.reason,
      );
    }
    return context.json(presentMessageReactions(botMessageViews, result, messageKey));
  });

  accountRoutes.delete(SUPERGROUP_MESSAGE_REACTIONS_PATH, (context) => {
    const messageKeyReading = readReactionMessageKey(context.req.param());
    if (!messageKeyReading.valid) {
      return invalidControlRequestResponse(context, messageKeyReading.issues);
    }
    const messageKey = messageKeyReading.value;
    const result = context.get('emulationSession').messageReactions.setAccountMessageReaction({
      ...messageKey,
      emojis: [],
    });
    return result.set
      ? context.body(null, 204)
      : controlErrorResponse(context, messageReactionFailureStatus(result.reason), result.reason);
  });

  return accountRoutes;
}

/** A supergroup message, as an account addresses it. */
type AccountReactionMessageKey = Parameters<
  EmulationSession['messageReactions']['getAccountMessageReactions']
>[0];

/** A message's reactions, with the message that holds them. */
type MessageReactions = Omit<
  Extract<
    ReturnType<EmulationSession['messageReactions']['getAccountMessageReactions']>,
    { readonly found: true }
  >,
  'found'
>;

/** Reads the message of a reaction route from its path parameters. */
function readReactionMessageKey(
  pathParameters: Record<string, string>,
): ControlRequestInputReading<AccountReactionMessageKey> {
  const messagePath = readPathParameters(supergroupMessagePathSchema, pathParameters);
  if (!messagePath.valid) {
    return messagePath;
  }
  const { accountId, chatId, messageId } = messagePath.value;
  return { valid: true, value: { accountId, chatId, messageId } };
}

/**
 * Shows the reactions to a message, each user's as the Bot API's `MessageReactionUpdated` lists a
 * user's reactions, with the message that holds them as the account's history shows it.
 */
function presentMessageReactions(
  botMessageViews: EmulationSession['botMessageViews'],
  { message, reactions }: MessageReactions,
  { accountId }: AccountReactionMessageKey,
) {
  return {
    message: viewChatMessageForAccount(botMessageViews, message, accountId),
    reactions: reactions.map(({ userId, emojis }) => ({
      user_id: userId,
      reaction: emojis.map((emoji) => ({ type: 'emoji', emoji })),
    })),
  };
}

/**
 * A supergroup, account or message that cannot be found is not found; a supergroup the account is
 * no member of, or a reaction its permissions withhold, is forbidden; reactions that no message
 * accepts are rejected; and a new reaction to a message that shows as many distinct reactions as
 * it may conflicts with it.
 */
function messageReactionFailureStatus(
  reason: Extract<
    ReturnType<EmulationSession['messageReactions']['setAccountMessageReaction']>,
    { readonly set: false }
  >['reason'],
): 400 | 403 | 404 | 409 {
  switch (reason) {
    case 'account_not_found':
    case 'chat_not_found':
    case 'message_not_found':
      return 404;
    case 'not_a_member':
    case 'reaction_not_permitted':
      return 403;
    case 'message_not_reactable':
    case 'reaction_emoji_unsupported':
    case 'too_many_reactions':
      return 400;
    case 'too_many_distinct_reactions':
      return 409;
    default: {
      const unhandledReason: never = reason;
      throw new Error(`Unhandled message reaction failure: ${unhandledReason}`);
    }
  }
}
