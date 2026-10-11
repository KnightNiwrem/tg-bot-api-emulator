/**
 * The contract of a session's bot activity log: the Bot API calls its bots make, with their
 * answers, and the updates delivered to and confirmed by them.
 */
import { z } from 'zod';

import { controlRefusalSchema, controlValidationErrorSchema } from './control_errors.ts';
import { defineControlOperation } from './operation_contract.ts';
import { sessionNotFoundSchema } from './sessions.ts';
import { webhookAttemptFailureSchema, webhookAttemptIdSchema } from './webhook_attempts.ts';
import {
  sessionIdParameterSchema,
  telegramObjectSchema,
  telegramUserIdSchema,
} from './wire_fields.ts';

/**
 * The kinds of entry the log records: a bot's call, an update handed to a bot, an update a bot
 * confirmed, and a failed attempt to deliver an update to a webhook.
 */
export const BOT_ACTIVITY_KINDS = [
  'bot_api_call',
  'update_delivered',
  'update_confirmed',
  'webhook_attempt_failed',
] as const;

/** The most entries one read answers with. */
const MAX_READ_LIMIT = 1_000;
const DEFAULT_READ_LIMIT = 100;
/** Longer than any sensible test waits, so that a client's wait takes a single request. */
const MAX_WAIT_MILLISECONDS = 600_000;

/**
 * Where an entry stands in the log. The first entry has position 1, and each later entry's position
 * is 1 greater than the one before it.
 */
const botActivityPositionSchema = z.int().min(1);

/** Whether a bot receives updates through `getUpdates` or through its webhook. */
const botUpdateTransportSchema = z.enum(['polling', 'webhook']);

/** A file a call uploaded, described without its content. */
const uploadedFileDescriptionSchema = z.strictObject({
  /** The multipart field that carried the file. */
  field_name: z.string(),
  file_name: z.string(),
  size_bytes: z.int().min(0),
});

/** The Bot API answer a bot received to a call. */
const botApiCallAnswerSchema = z.union([
  z.strictObject({
    ok: z.literal(true),
    /** The method's result. */
    result: z.unknown(),
    description: z.string().optional(),
  }),
  z.strictObject({
    ok: z.literal(false),
    error_code: z.int(),
    description: z.string(),
    /** Present on a `429` rate limit answer. */
    parameters: z.strictObject({
      /** How many seconds the bot should wait before retrying. */
      retry_after: z.int().min(1),
    }).optional(),
  }),
]);

/**
 * A bot's call of a Bot API method, whether it ran, failed, or is not implemented. `getUpdates`
 * calls are not recorded; the updates they deliver and confirm are.
 */
export const botApiCallEntrySchema = z.strictObject({
  /** Where the entry stands in the session's log; each entry's is 1 greater than the last. */
  position: botActivityPositionSchema,
  kind: z.literal('bot_api_call'),
  bot_id: telegramUserIdSchema,
  /**
   * The method's current name, whichever name the bot called it by; the name as called for a
   * method the emulator does not implement.
   */
  method: z.string().min(1),
  /** The method name as the bot called it. */
  requested_method: z.string().min(1),
  /** Whether the call was an HTTP request or a webhook's response to an update. */
  via: z.enum(['http', 'webhook_reply']),
  /**
   * The parameters as the bot sent them, as text: `chat_id: 1` is recorded as `"1"`, and
   * structured parameters such as `reply_markup` as the JSON text the bot wrote, in whichever
   * encoding. Empty when the request could not be decoded. The names are the bot's, passed through
   * unchanged.
   */
  parameters: z.record(z.string(), z.string()),
  uploaded_files: z.array(uploadedFileDescriptionSchema),
  /** The chat `chat_id` names, with a public username resolved; omitted when it names none. */
  chat_id: z.int().optional(),
  answer: botApiCallAnswerSchema,
});

/** A Bot API update, as the Bot API delivers it; its fields other than `update_id` are Telegram's. */
const botApiUpdateSchema = telegramObjectSchema('Update', { update_id: z.int() });

/**
 * An update handed to a bot, in a `getUpdates` answer or in a request to its webhook; an update
 * handed over again is recorded each time.
 */
export const updateDeliveredEntrySchema = z.strictObject({
  position: botActivityPositionSchema,
  kind: z.literal('update_delivered'),
  bot_id: telegramUserIdSchema,
  via: botUpdateTransportSchema,
  update: botApiUpdateSchema,
  /** The chat the update happened in, as grammY's `ctx.chat` finds it; omitted when it has none. */
  chat_id: z.int().optional(),
  /**
   * The user whose action caused the update, as grammY's `ctx.from` finds it; omitted for a
   * poll's new state and a stopped message generation, which name no user.
   */
  user_id: z.int().optional(),
  /** The webhook attempt that handed the update over; present exactly when `via` is `webhook`. */
  webhook_attempt_id: webhookAttemptIdSchema.optional(),
});

/**
 * An update the bot confirmed: by a `getUpdates` offset beyond it, or by its webhook's complete
 * successful answer to it, recorded when the answer arrives, before any method it names runs.
 */
export const updateConfirmedEntrySchema = z.strictObject({
  position: botActivityPositionSchema,
  kind: z.literal('update_confirmed'),
  bot_id: telegramUserIdSchema,
  via: botUpdateTransportSchema,
  update_id: z.int(),
  chat_id: z.int().optional(),
  /** As `UpdateDeliveredEntry` describes it. */
  user_id: z.int().optional(),
  /** The webhook attempt the webhook accepted; present exactly when `via` is `webhook`. */
  webhook_attempt_id: webhookAttemptIdSchema.optional(),
});

/**
 * A failed attempt to deliver an update to a webhook, which leaves the update pending until the
 * attempt's retry is released.
 */
export const webhookAttemptFailedEntrySchema = z.strictObject({
  position: botActivityPositionSchema,
  kind: z.literal('webhook_attempt_failed'),
  bot_id: telegramUserIdSchema,
  update_id: z.int(),
  chat_id: z.int().optional(),
  /** As `UpdateDeliveredEntry` describes it. */
  user_id: z.int().optional(),
  webhook_attempt_id: webhookAttemptIdSchema,
  failure: webhookAttemptFailureSchema,
  /** The wait before the update is sent again that `automatic` scheduling observes. */
  retry_delay_seconds: z.int().min(0),
});

/**
 * An entry of a session's bot activity log. Entries are positioned in the order the emulator
 * decided each outcome, which agrees with every order a bot enforces.
 */
const botActivityEntrySchema = z.discriminatedUnion('kind', [
  botApiCallEntrySchema,
  updateDeliveredEntrySchema,
  updateConfirmedEntrySchema,
  webhookAttemptFailedEntrySchema,
]);

/**
 * The criteria and bounds of a read. Two rules have no JSON Schema form, and the server checks
 * them as `invalid_value` issues: `before` must be greater than `after`, and `wait_ms` is not
 * allowed with `before`.
 */
const readBotActivityQuerySchema = z.strictObject({
  /** Only entries after this position are read; 0, the default, reads from the first entry. */
  after: z.int().min(0).default(0),
  /**
   * Only entries before this position are read. It must be greater than `after` and at most 1
   * greater than the head position.
   */
  before: z.int().min(1).optional(),
  bot_id: z.int().optional(),
  kind: z.enum(BOT_ACTIVITY_KINDS).optional(),
  /** A method name, compared without regard to letter case; an older name finds its calls too. */
  method: z.string().min(1).optional(),
  chat_id: z.int().optional(),
  user_id: z.int().optional(),
  /**
   * The ID of the update delivered, confirmed, or failed to be delivered. Each bot numbers its
   * updates independently, so an ID names one update only together with `bot_id`.
   */
  update_id: z.int().optional(),
  /** Whether the call's answer was successful. */
  ok: z.boolean().optional(),
  /**
   * Parameter text a call must have sent, by parameter name, compared exactly with the text the
   * call sent: `parameters[callback_query_id]=123`.
   */
  parameters: z.record(z.string(), z.string()).optional(),
  /**
   * Patterns, by parameter name, that the JSON a call sent in each named parameter must match,
   * each a JSON object or array: `parameters_json={"reply_parameters":{"message_id":5}}`. The
   * value's numbers are compared by the exact decimal values their text spells.
   */
  parameters_json: z.record(
    z.string(),
    z.union([z.record(z.string(), z.unknown()), z.array(z.unknown()).readonly()]),
  ).optional(),
  /** The most entries to answer with; 0 answers only with the head position. */
  limit: z.int().min(0).max(MAX_READ_LIMIT).default(DEFAULT_READ_LIMIT),
  /** How long, in milliseconds, a read that finds no matching entry is held. */
  wait_ms: z.int().min(0).max(MAX_WAIT_MILLISECONDS).default(0),
});

const botActivityPageSchema = z.strictObject({
  entries: z.array(botActivityEntrySchema),
  /** The position of the latest entry when the read was answered; 0 while the log is empty. */
  head_position: z.int().min(0),
});

export const readBotActivityContract = defineControlOperation({
  operationId: 'readBotActivity',
  method: 'GET',
  path: '/sessions/{sessionId}/bot-activity',
  params: z.strictObject({ sessionId: sessionIdParameterSchema }),
  query: readBotActivityQuerySchema,
  querySerialization: { parameters: 'deepObject', parameters_json: 'json' },
  success: { status: 200, body: { kind: 'json', schema: botActivityPageSchema } },
  refusals: {
    400: z.union([
      controlValidationErrorSchema,
      controlRefusalSchema(['after_beyond_head', 'before_beyond_head']),
    ]),
    404: sessionNotFoundSchema,
  },
});
