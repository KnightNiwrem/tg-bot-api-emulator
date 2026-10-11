/**
 * The contracts of the inline queries accounts type for inline bots: sending one, reading it with
 * the bot's answer, and the test control that makes a cached answer's `cache_time` pass.
 */
import { z } from 'zod';

import { accountPathSchema } from './accounts.ts';
import { controlRefusalSchema, controlValidationErrorSchema } from './control_errors.ts';
import { defineControlOperation } from './operation_contract.ts';
import {
  accountLocationInputSchema,
  createdResourceHeadersSchema,
  messageTargetSchema,
  sessionIdParameterSchema,
  sharedLocationSchema,
  telegramUserIdSchema,
} from './wire_fields.ts';

/** The most characters of an inline query, counted by code point, as zod counts them. */
export const MAX_INLINE_QUERY_LENGTH = 256;

/** The most results an answer holds. */
const MAX_INLINE_QUERY_RESULT_COUNT = 50;

/** The longest `cache_time` an answer keeps, in seconds: a day. */
const MAX_INLINE_QUERY_CACHE_TIME_SECONDS = 86_400;

/** The most characters of a start parameter, as `answerInlineQuery`'s button takes it. */
const MAX_START_PARAMETER_LENGTH = 64;

/** The kinds of result an account's client lists, by the Bot API's `type` names. */
export const ACCOUNT_INLINE_QUERY_RESULT_TYPES = [
  'article',
  'contact',
  'location',
  'photo',
  'document',
  'video',
  'voice',
  'audio',
] as const;

/** The identifier of an inline query, unique in its session. */
const inlineQueryIdSchema = z.string().min(1);

/** The path parameters of an inline query an account sent. */
const accountInlineQueryPathSchema = accountPathSchema.extend({
  inlineQueryId: z.string(),
});

/** An inline query typed in a chat, for the inline bot whose username precedes it. */
const sendInlineQueryRequestSchema = z.strictObject({
  /** The inline bot, whose username the account types before the query. */
  bot_id: telegramUserIdSchema,
  /** The chat where the account types the query, to which a chosen result is sent. */
  chat: messageTargetSchema,
  /**
   * Up to 256 characters, counted by code point; omitted or empty when the account types only
   * the bot's username.
   */
  query: z.string().max(MAX_INLINE_QUERY_LENGTH).default(''),
  /** The `next_offset` of an earlier answer, requesting more results; omitted for the first. */
  offset: z.string().default(''),
  /**
   * Where the account is, shared only with a bot created with `requests_inline_location`;
   * omitted to share no location.
   */
  location: accountLocationInputSchema.optional(),
});

/**
 * A result of an answer as the account's client lists it, by its type, identifier, and texts.
 * What sending it writes shows in the sent message.
 */
const inlineQueryResultListingSchema = z.strictObject({
  type: z.enum(ACCOUNT_INLINE_QUERY_RESULT_TYPES),
  id: z.string().min(1),
  title: z.string().min(1).optional(),
  description: z.string().min(1).optional(),
  /** The URL an article shows. */
  url: z.string().min(1).optional(),
});

/**
 * An HTTPS URL, whose scheme is matched without case, as URI schemes are; the rest of the URL is
 * checked as a URL.
 */
const httpsUrlSchema = z.string().regex(/^[Hh][Tt][Tt][Pp][Ss]:\/\//).check(z.url());

/**
 * The button the account's client shows above the results: it opens the bot's private chat with
 * a start parameter, or a Web App.
 */
const inlineQueryResultsButtonSchema = z.union([
  z.strictObject({
    text: z.string(),
    start_parameter: z.string().min(1).max(MAX_START_PARAMETER_LENGTH).regex(/^[A-Za-z0-9_-]+$/),
  }),
  z.strictObject({ text: z.string(), web_app: z.strictObject({ url: httpsUrlSchema }) }),
]);

/** The bot's answer to an inline query. */
const inlineQueryAnswerSchema = z.strictObject({
  results: z.array(inlineQueryResultListingSchema).max(MAX_INLINE_QUERY_RESULT_COUNT),
  cache_time: z.int().min(0).max(MAX_INLINE_QUERY_CACHE_TIME_SECONDS),
  is_personal: z.boolean(),
  /** Empty when there are no more results. */
  next_offset: z.string(),
  button: inlineQueryResultsButtonSchema.optional(),
});

/** An inline query an account sent, with the bot's answer once it has answered. */
const inlineQuerySchema = z.strictObject({
  /** The identifier the bot receives in its `inline_query` update. */
  id: inlineQueryIdSchema,
  bot_id: telegramUserIdSchema,
  chat: messageTargetSchema,
  query: z.string(),
  offset: z.string(),
  /** The location the account shared with the bot; omitted for none. */
  location: sharedLocationSchema.optional(),
  /** Whether the bot has answered the query; the bot answers a query once. */
  status: z.enum(['awaiting_answer', 'answered']),
  /** The bot's answer when `status` is `answered`, and `null` otherwise. */
  answer: z.union([inlineQueryAnswerSchema, z.null()]),
});

const inlineQueryResponseSchema = z.strictObject({ inline_query: inlineQuerySchema });

/**
 * Sends an inline query, as typing the bot's username followed by the query does, from the
 * account's private chat with a bot or from a supergroup the account is a member of.
 */
export const sendInlineQueryContract = defineControlOperation({
  operationId: 'sendInlineQuery',
  method: 'POST',
  path: '/sessions/{sessionId}/accounts/{accountId}/inline-queries',
  params: accountPathSchema,
  body: { required: true, schema: sendInlineQueryRequestSchema },
  success: {
    status: 201,
    headers: createdResourceHeadersSchema,
    body: { kind: 'json', schema: inlineQueryResponseSchema },
    actionReceipt: 'before_action',
  },
  refusals: {
    400: controlValidationErrorSchema,
    403: controlRefusalSchema(['not_a_member']),
    404: controlRefusalSchema([
      'account_not_found',
      'bot_not_found',
      'chat_not_found',
      'session_not_found',
    ]),
    409: controlRefusalSchema(['inline_location_not_requested', 'inline_mode_disabled']),
  },
});

/** Returns an inline query the account sent, with the bot's answer once given. */
export const getInlineQueryContract = defineControlOperation({
  operationId: 'getInlineQuery',
  method: 'GET',
  path: '/sessions/{sessionId}/accounts/{accountId}/inline-queries/{inlineQueryId}',
  params: accountInlineQueryPathSchema,
  success: { status: 200, body: { kind: 'json', schema: inlineQueryResponseSchema } },
  refusals: {
    400: controlValidationErrorSchema,
    404: controlRefusalSchema(['inline_query_not_found', 'session_not_found']),
  },
});

/**
 * Makes every cached answer to the request of an inline query expire, as its `cache_time`
 * passing does, so that the next such query from any account reaches the bot.
 */
export const expireInlineAnswerCacheContract = defineControlOperation({
  operationId: 'expireInlineAnswerCache',
  method: 'POST',
  path: '/sessions/{sessionId}/inline-queries/{inlineQueryId}/answer-cache/expiry',
  params: z.strictObject({ sessionId: sessionIdParameterSchema, inlineQueryId: z.string() }),
  success: { status: 204, body: { kind: 'empty' }, actionReceipt: 'before_action' },
  refusals: {
    404: controlRefusalSchema(['inline_query_not_found', 'session_not_found']),
    409: controlRefusalSchema(['answer_not_cached']),
  },
});
