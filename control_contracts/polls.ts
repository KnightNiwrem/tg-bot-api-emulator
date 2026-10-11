/**
 * The contracts of polls: the poll as the Bot API shows it, the test control that makes a poll's
 * closing time arrive, and an account's retraction of its answer.
 */
import { z } from 'zod';

import { accountPathSchema } from './accounts.ts';
import { controlRefusalSchema, controlValidationErrorSchema } from './control_errors.ts';
import { customEmojiEntitySchema, messageEntitySchema } from './message_entities.ts';
import { defineControlOperation } from './operation_contract.ts';
import { accountSupergroupPathSchema } from './supergroups.ts';
import { sessionIdParameterSchema, telegramUserIdSchema } from './wire_fields.ts';

/** The most options a poll has. */
export const MAX_POLL_OPTION_COUNT = 12;

/** The shortest and longest a poll sent with `open_period` stays open, in seconds. */
export const MIN_POLL_OPEN_PERIOD_SECONDS = 5;
export const MAX_POLL_OPEN_PERIOD_SECONDS = 2_628_000;

/** The most characters of a quiz's explanation, counted by code point. */
export const MAX_QUIZ_EXPLANATION_LENGTH = 200;

/**
 * The identifier of a poll: the decimal text of a positive signed 64-bit integer, at most
 * 9223372036854775807. JSON Schema states its form and length; a poll path's server also checks
 * its range, reporting a larger ID as an `invalid_value` issue.
 */
export const pollIdSchema = z.string().regex(/^[1-9]\d*$/).max(19);

/** An answer option of a poll, as the official Bot API server's `JsonPollOption` shows it. */
const pollOptionSchema = z.strictObject({
  /** The option's identifier, which stays the same however options change. */
  persistent_id: z.string().min(1),
  text: z.string().min(1),
  /** Present when the text has custom emoji, its only entities. */
  text_entities: z.array(customEmojiEntitySchema).min(1).optional(),
  /** How many accounts chose the option. */
  voter_count: z.int().min(0),
});

/**
 * A regular poll or a quiz as the official Bot API server's `JsonPoll` shows it, with its votes
 * as they are now. The emulator's polls never restrict who may vote.
 */
export const pollSchema = z.strictObject({
  id: pollIdSchema,
  question: z.string().min(1),
  /** Present when the question has custom emoji, its only entities. */
  question_entities: z.array(customEmojiEntitySchema).min(1).optional(),
  options: z.array(pollOptionSchema).min(1).max(MAX_POLL_OPTION_COUNT),
  /** How many accounts chose any option, each counted once. */
  total_voter_count: z.int().min(0),
  /** Present, with `close_date`, only while a poll that closes by itself is open. */
  open_period: z.int().min(MIN_POLL_OPEN_PERIOD_SECONDS).max(MAX_POLL_OPEN_PERIOD_SECONDS)
    .optional(),
  /** When the poll closes by itself, as a Unix time; present only with `open_period`. */
  close_date: z.int().min(1).optional(),
  is_closed: z.boolean(),
  is_anonymous: z.boolean(),
  allows_multiple_answers: z.boolean(),
  /** Whether a voter may change or retract its answer. */
  allows_revoting: z.boolean(),
  members_only: z.literal(false),
  type: z.enum(['regular', 'quiz']),
  /** The correct option of a quiz with exactly one, to an observer that sees its solution. */
  correct_option_id: z.int().min(0).optional(),
  /** The correct options of a quiz, in increasing order, to an observer that sees its solution. */
  correct_option_ids: z.array(z.int().min(0)).min(1).optional(),
  /** A quiz's explanation, to an observer that sees its solution. */
  explanation: z.string().min(1).max(MAX_QUIZ_EXPLANATION_LENGTH).optional(),
  /** Present with the explanation, even without entities, as the official server writes it. */
  explanation_entities: z.array(messageEntitySchema).optional(),
});

/**
 * Closes a poll as the arrival of its closing time does, through every message showing it. The
 * bot that sent the poll receives a `poll` update with the closed poll.
 */
export const expirePollContract = defineControlOperation({
  operationId: 'expirePoll',
  method: 'POST',
  path: '/sessions/{sessionId}/polls/{pollId}/expiry',
  params: z.strictObject({ sessionId: sessionIdParameterSchema, pollId: pollIdSchema }),
  success: {
    status: 200,
    body: { kind: 'json', schema: z.strictObject({ poll: pollSchema }) },
    actionReceipt: 'before_action',
  },
  refusals: {
    400: controlValidationErrorSchema,
    404: controlRefusalSchema(['poll_not_found', 'session_not_found']),
    409: controlRefusalSchema(['poll_already_closed', 'poll_without_closing_time']),
  },
});

/** A message's ID as the chat's bots see it, which is how the account routes show messages. */
const messageIdParameterSchema = z.int().min(1);

/** The path parameters of a message of an account's private chat with a bot. */
const accountPrivateMessagePathSchema = accountPathSchema.extend({
  botId: telegramUserIdSchema,
  messageId: messageIdParameterSchema,
});

/** The path parameters of a supergroup message as an account addresses it. */
const accountSupergroupMessagePathSchema = accountSupergroupPathSchema.extend({
  messageId: messageIdParameterSchema,
});

/** A refusal of an answer the poll cannot accept, or of a request that breaks its contract. */
const pollAnswerRejectionSchema = z.union([
  controlValidationErrorSchema,
  controlRefusalSchema(['multiple_answers_not_allowed', 'poll_option_not_found']),
]);

/** A missing session, account, bot, chat, or message, or a message that shows no poll. */
const pollMessageNotFoundSchema = controlRefusalSchema([
  'account_not_found',
  'bot_not_found',
  'chat_not_found',
  'message_has_no_poll',
  'message_not_found',
  'session_not_found',
]);

/** A closed poll, or one that disallows revoting. */
const pollAnswerConflictSchema = controlRefusalSchema([
  'answer_change_not_allowed',
  'answer_retraction_not_allowed',
  'poll_closed',
]);

/**
 * Retracts the account's answer to the poll a message of its private chat with a bot shows, as
 * TDLib's `setPollAnswer` does without options. A poll that disallows revoting refuses the
 * retraction even without an answer; otherwise retracting without an answer changes nothing.
 */
export const retractAccountPollAnswerContract = defineControlOperation({
  operationId: 'retractAccountPollAnswer',
  method: 'DELETE',
  path:
    '/sessions/{sessionId}/accounts/{accountId}/conversations/private/{botId}/messages/{messageId}/poll-answer',
  params: accountPrivateMessagePathSchema,
  success: { status: 204, body: { kind: 'empty' }, actionReceipt: 'before_action' },
  refusals: {
    400: pollAnswerRejectionSchema,
    404: pollMessageNotFoundSchema,
    409: pollAnswerConflictSchema,
  },
});

/** Retracts the account's answer to the poll a supergroup message shows, as for a private chat. */
export const retractSupergroupAccountPollAnswerContract = defineControlOperation({
  operationId: 'retractSupergroupAccountPollAnswer',
  method: 'DELETE',
  path:
    '/sessions/{sessionId}/accounts/{accountId}/conversations/supergroup/{chatId}/messages/{messageId}/poll-answer',
  params: accountSupergroupMessagePathSchema,
  success: { status: 204, body: { kind: 'empty' }, actionReceipt: 'before_action' },
  refusals: {
    400: pollAnswerRejectionSchema,
    403: controlRefusalSchema(['not_a_member']),
    404: pollMessageNotFoundSchema,
    409: pollAnswerConflictSchema,
  },
});
