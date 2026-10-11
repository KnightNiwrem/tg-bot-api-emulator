/**
 * The contract of a session's settledness read: whether the emulator has work it will do by
 * itself, what each bot's mailbox still holds, and what the session waits on, read together with
 * the head of the bot activity log. It describes the emulator only: a bot that confirmed an update
 * may still be working on it, so asserting that a bot did not do something needs a completion
 * fence.
 */
import { z } from 'zod';

import { defineControlOperation } from './operation_contract.ts';
import { sessionNotFoundSchema } from './sessions.ts';
import { WEBHOOK_SCHEDULINGS, webhookAttemptIdSchema } from './webhook_attempts.ts';
import { sessionIdParameterSchema } from './wire_fields.ts';

/** A pending update of a bot, which the blocker waits on. */
const pendingUpdateShape = { bot_id: z.int(), update_id: z.int() };

/** A webhook attempt of a pending update, which the blocker waits on. */
const webhookAttemptShape = {
  ...pendingUpdateShape,
  webhook_attempt_id: webhookAttemptIdSchema,
  scheduling: z.enum(WEBHOOK_SCHEDULINGS),
};

/**
 * Something the session waits on: work the emulator will do by itself (`runnable`), or a wait for
 * a bot or the test.
 */
const settlednessBlockerSchema = z.discriminatedUnion('kind', [
  /**
   * A bot's call the emulator is preparing or executing, from its admission until it is answered.
   * `method` is omitted for a webhook reply whose body has not named its method yet.
   */
  z.strictObject({
    kind: z.literal('bot_api_call'),
    runnable: z.literal(true),
    bot_id: z.int(),
    via: z.enum(['http', 'webhook_reply']),
    method: z.string().optional(),
  }),
  /**
   * A `getUpdates` call held until an update arrives, its timeout passes, or another ends it:
   * passive while it waits, and runnable once its wait is over, until it is answered.
   */
  z.strictObject({
    kind: z.literal('held_long_poll'),
    runnable: z.boolean(),
    bot_id: z.int(),
  }),
  /** An update waiting for its polling bot to read it. */
  z.strictObject({
    kind: z.literal('undelivered_update'),
    runnable: z.literal(false),
    ...pendingUpdateShape,
  }),
  /** An update a `getUpdates` answer delivered, waiting for an offset to confirm it. */
  z.strictObject({
    kind: z.literal('unconfirmed_delivery'),
    runnable: z.literal(false),
    ...pendingUpdateShape,
  }),
  /**
   * An update sent to the bot's webhook, waiting for the webhook's complete response. Under
   * `automatic` scheduling the attempt's deadline fails it by itself `timeout_seconds` after it
   * began, so it is runnable. Under `manual` scheduling only the test expires it, so it is not,
   * until the step its delivery waits on settles, however it settles, which leaves the
   * delivery to act by itself; `timeout_seconds` is omitted. A stopped attempt stays until then.
   */
  z.strictObject({
    kind: z.literal('webhook_attempt'),
    runnable: z.boolean(),
    ...webhookAttemptShape,
    timeout_seconds: z.int().min(1).optional(),
  }),
  /**
   * A failed update waiting to be sent again: under `automatic` scheduling once its `delay_seconds`
   * pass, by itself, so it is runnable; under `manual` scheduling once the test releases it, so it
   * is not, and `delay_seconds` is omitted.
   */
  z.strictObject({
    kind: z.literal('webhook_retry'),
    runnable: z.boolean(),
    ...webhookAttemptShape,
    delay_seconds: z.int().min(0).optional(),
  }),
  /** An update of the bot's webhook waiting behind its queue's or its webhook's busy connections. */
  z.strictObject({
    kind: z.literal('queued_webhook_update'),
    runnable: z.literal(false),
    ...pendingUpdateShape,
  }),
  /** An update the emulator is about to send to the bot's webhook. */
  z.strictObject({
    kind: z.literal('webhook_delivery_due'),
    runnable: z.literal(true),
    ...pendingUpdateShape,
  }),
]);

/** A session's settledness, read in one step. */
const sessionSettlednessSchema = z.strictObject({
  /** The position of the bot activity log's latest entry at the read; 0 while it is empty. */
  activity_position: z.int().min(0),
  /** Whether the emulator has no runnable work: every blocker waits for a bot or the test. */
  settled: z.boolean(),
  /** Each bot's mailbox, in the order the bots were created. */
  bots: z.array(z.strictObject({
    bot_id: z.int(),
    pending_update_count: z.int().min(0),
    /** Whether no update waits to be delivered to the bot or confirmed by it. */
    drained: z.boolean(),
  })),
  /** What the session waits on, runnable or passive. */
  blockers: z.array(settlednessBlockerSchema),
});

export const readSessionSettlednessContract = defineControlOperation({
  operationId: 'readSessionSettledness',
  method: 'GET',
  path: '/sessions/{sessionId}/settledness',
  params: z.strictObject({ sessionId: sessionIdParameterSchema }),
  success: { status: 200, body: { kind: 'json', schema: sessionSettlednessSchema } },
  refusals: { 404: sessionNotFoundSchema },
});
