import { z } from 'zod';

import { botProfileSchema } from '../../src/api/contracts/bots.ts';
import {
  privateMessageSchema,
  supergroupMessageSchema,
} from '../../src/api/contracts/chat_messages.ts';
import { controlValidationErrorSchema } from '../../src/api/contracts/control_errors.ts';
import { accountBotCommandSchema } from '../../src/api/contracts/conversation_reads.ts';
import { pollAnswerSchema } from '../../src/api/contracts/poll_answers.ts';
import { telegramUserIdSchema } from '../../src/api/contracts/wire_fields.ts';
import { CONTROL_REFUSAL_REASONS } from './control_refusal_reasons.ts';
import type {
  ControlErrorBody,
  MessageReactions,
  ReactionTypeEmoji,
  UserReaction,
} from './types.ts';

export const getMeResponseSchema = z.strictObject({
  ok: z.literal(true),
  result: botProfileSchema,
});

export const sentMessageResponseSchema = z.strictObject({
  message: privateMessageSchema,
});

export const sentSupergroupMessageResponseSchema = z.strictObject({
  message: supergroupMessageSchema,
});

export const sentMediaGroupResponseSchema = z.strictObject({
  messages: z.array(privateMessageSchema),
});

export const sentSupergroupMediaGroupResponseSchema = z.strictObject({
  messages: z.array(supergroupMessageSchema),
});

export const supergroupMessageHistoryResponseSchema = z.strictObject({
  messages: z.array(supergroupMessageSchema),
});

export const supergroupPollAnswerResponseSchema = z.strictObject({
  poll_answer: pollAnswerSchema,
  message: supergroupMessageSchema,
});

const reactionTypeEmojiSchema: z.ZodType<ReactionTypeEmoji> = z.strictObject({
  type: z.literal('emoji'),
  emoji: z.string().min(1),
});

const userReactionSchema: z.ZodType<UserReaction> = z.strictObject({
  user_id: telegramUserIdSchema,
  reaction: z.array(reactionTypeEmojiSchema).length(1),
});

export const messageReactionsResponseSchema: z.ZodType<MessageReactions> = z.strictObject({
  message: supergroupMessageSchema,
  reactions: z.array(userReactionSchema),
});

export const supergroupBotCommandsResponseSchema = z.strictObject({
  bot_commands: z.array(z.strictObject({
    bot_id: z.number().int().positive(),
    commands: z.array(accountBotCommandSchema),
  })),
});

/** A message sent from an inline query's answer, to the private chat or supergroup of the query. */
export const chosenInlineResultResponseSchema = z.strictObject({
  message: z.union([privateMessageSchema, supergroupMessageSchema]),
});

/**
 * A control error body: input that breaks an operation's contract, with at least one issue, or
 * another refusal, which names only its reason.
 */
export const controlErrorBodySchema: z.ZodType<ControlErrorBody> = z.union([
  controlValidationErrorSchema,
  z.strictObject({
    reason: z.enum(CONTROL_REFUSAL_REASONS),
  }),
]);
