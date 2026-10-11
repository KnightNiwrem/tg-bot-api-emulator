/**
 * The contracts of the reactions to a message of a supergroup an account is a member of: reading
 * them, and setting or removing the account's own.
 */
import { z } from 'zod';

import { supergroupMessageSchema } from './chat_messages.ts';
import { controlRefusalSchema, controlValidationErrorSchema } from './control_errors.ts';
import { defineControlOperation } from './operation_contract.ts';
import { accountSupergroupMessagePathSchema } from './supergroups.ts';
import { telegramUserIdSchema } from './wire_fields.ts';

/**
 * The ordinary emoji that users and bots may react with, exactly as the Bot API documents
 * `ReactionTypeEmoji.emoji`, in its order. Several are written without the variation selector
 * U+FE0F that keyboards often add, such as "❤" and "☃", and Telegram matches them exactly.
 */
export const REACTION_EMOJIS = [
  '❤',
  '👍',
  '👎',
  '🔥',
  '🥰',
  '👏',
  '😁',
  '🤔',
  '🤯',
  '😱',
  '🤬',
  '😢',
  '🎉',
  '🤩',
  '🤮',
  '💩',
  '🙏',
  '👌',
  '🕊',
  '🤡',
  '🥱',
  '🥴',
  '😍',
  '🐳',
  '❤‍🔥',
  '🌚',
  '🌭',
  '💯',
  '🤣',
  '⚡',
  '🍌',
  '🏆',
  '💔',
  '🤨',
  '😐',
  '🍓',
  '🍾',
  '💋',
  '🖕',
  '😈',
  '😴',
  '😭',
  '🤓',
  '👻',
  '👨‍💻',
  '👀',
  '🎃',
  '🙈',
  '😇',
  '😨',
  '🤝',
  '✍',
  '🤗',
  '🫡',
  '🎅',
  '🎄',
  '☃',
  '💅',
  '🤪',
  '🗿',
  '🆒',
  '💘',
  '🙉',
  '🦄',
  '😘',
  '💊',
  '🙊',
  '😎',
  '👾',
  '🤷‍♂',
  '🤷',
  '🤷‍♀',
  '😡',
] as const;

/**
 * An ordinary emoji reaction an account chooses, as the Bot API's `ReactionTypeEmoji` writes it.
 * An emoji the Bot API does not list for it is refused as `reaction_emoji_unsupported`.
 */
const reactionTypeEmojiInputSchema = z.strictObject({
  type: z.literal('emoji'),
  emoji: z.string(),
});

/** An ordinary emoji reaction, as the Bot API's `ReactionTypeEmoji` shows it. */
const reactionTypeEmojiSchema = z.strictObject({
  type: z.literal('emoji'),
  emoji: z.enum(REACTION_EMOJIS),
});

/**
 * The reactions to a supergroup message, with the message that holds them as the account sees
 * it: for a message of an album, the album's first message that is not deleted.
 */
const messageReactionsResponseSchema = z.strictObject({
  message: supergroupMessageSchema,
  /** One entry per reacting member, in the order they last changed their reactions. */
  reactions: z.array(z.strictObject({
    user_id: telegramUserIdSchema,
    /** The member's reactions; one, as members choose one reaction per message. */
    reaction: z.array(reactionTypeEmojiSchema).length(1),
  })),
});

/**
 * The reactions an account chooses, which replace its earlier ones, as the Bot API's `reaction`
 * lists them. Removing them is a `DELETE` of the same path.
 */
const setMessageReactionRequestSchema = z.strictObject({
  reaction: z.array(reactionTypeEmojiInputSchema).min(1),
});

/** Reactions that no message accepts, or a request that breaks its contract. */
const reactionRejectionSchema = z.union([
  controlValidationErrorSchema,
  controlRefusalSchema([
    'message_not_reactable',
    'reaction_emoji_unsupported',
    'too_many_reactions',
  ]),
]);

/** A member that is not one, or a reaction the member's permissions withhold. */
const reactionForbiddenSchema = controlRefusalSchema(['not_a_member', 'reaction_not_permitted']);

/** A missing session, account, supergroup, or message of the supergroup. */
const reactionMessageNotFoundSchema = controlRefusalSchema([
  'account_not_found',
  'chat_not_found',
  'message_not_found',
  'session_not_found',
]);

/** Returns the reactions to a message of a supergroup the account is a member of. */
export const getSupergroupMessageReactionsContract = defineControlOperation({
  operationId: 'getSupergroupMessageReactions',
  method: 'GET',
  path:
    '/sessions/{sessionId}/accounts/{accountId}/conversations/supergroup/{chatId}/messages/{messageId}/reactions',
  params: accountSupergroupMessagePathSchema,
  success: { status: 200, body: { kind: 'json', schema: messageReactionsResponseSchema } },
  refusals: {
    400: controlValidationErrorSchema,
    403: controlRefusalSchema(['not_a_member']),
    404: reactionMessageNotFoundSchema,
  },
});

/** Sets the account's reactions to a supergroup message, replacing its earlier ones. */
export const setSupergroupAccountMessageReactionContract = defineControlOperation({
  operationId: 'setSupergroupAccountMessageReaction',
  method: 'PUT',
  path:
    '/sessions/{sessionId}/accounts/{accountId}/conversations/supergroup/{chatId}/messages/{messageId}/reactions',
  params: accountSupergroupMessagePathSchema,
  body: { required: true, schema: setMessageReactionRequestSchema },
  success: {
    status: 200,
    body: { kind: 'json', schema: messageReactionsResponseSchema },
    actionReceipt: 'before_action',
  },
  refusals: {
    400: reactionRejectionSchema,
    403: reactionForbiddenSchema,
    404: reactionMessageNotFoundSchema,
    409: controlRefusalSchema(['too_many_distinct_reactions']),
  },
});

/** Removes the account's reactions to a supergroup message. */
export const removeSupergroupAccountMessageReactionContract = defineControlOperation({
  operationId: 'removeSupergroupAccountMessageReaction',
  method: 'DELETE',
  path:
    '/sessions/{sessionId}/accounts/{accountId}/conversations/supergroup/{chatId}/messages/{messageId}/reactions',
  params: accountSupergroupMessagePathSchema,
  success: { status: 204, body: { kind: 'empty' }, actionReceipt: 'before_action' },
  refusals: {
    400: reactionRejectionSchema,
    403: reactionForbiddenSchema,
    404: reactionMessageNotFoundSchema,
  },
});
