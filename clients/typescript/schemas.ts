import { z } from 'zod';

import { botProfileSchema } from '../../src/api/contracts/bots.ts';
import {
  privateMessageSchema,
  supergroupMessageSchema,
} from '../../src/api/contracts/chat_messages.ts';
import { controlValidationErrorSchema } from '../../src/api/contracts/control_errors.ts';
import { CONTROL_REFUSAL_REASONS } from './control_refusal_reasons.ts';
import type { ControlErrorBody } from './types.ts';

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
