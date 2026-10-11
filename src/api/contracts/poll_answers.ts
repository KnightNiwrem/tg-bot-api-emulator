/**
 * The contracts of an account's part in the polls its chats show: reading, setting and retracting
 * its answer, and stopping a poll it sent.
 */
import { z } from 'zod';

import { accountPrivateMessagePathSchema } from './accounts.ts';
import { privateMessageSchema } from './chat_messages.ts';
import { controlRefusalSchema, controlValidationErrorSchema } from './control_errors.ts';
import { defineControlOperation } from './operation_contract.ts';
import { pollIdSchema } from './polls.ts';
import { accountSupergroupMessagePathSchema } from './supergroups.ts';

/**
 * The options an account chose in a poll, as the Bot API's `PollAnswer` names them; both lists
 * are empty while the account has no answer.
 */
export const pollAnswerSchema = z.strictObject({
  poll_id: pollIdSchema,
  /** The chosen options' positions, counted from 0, in increasing order. */
  option_ids: z.array(z.int().min(0)),
  /** The chosen options' `persistent_id`, in the same order. */
  option_persistent_ids: z.array(z.string().min(1)),
});

/**
 * An account's answer to a poll of its private chat with a bot, with the message showing the poll
 * as the conversation's bot sees it.
 */
const privatePollAnswerResponseSchema = z.strictObject({
  poll_answer: pollAnswerSchema,
  message: privateMessageSchema,
});

/**
 * The options an account chooses in a poll, by their positions counted from 0, as the Bot API's
 * `option_ids` numbers them; a repeated position counts once. Retracting an answer chooses none.
 */
const setPollAnswerRequestSchema = z.strictObject({
  option_ids: z.array(z.int().min(0)).min(1),
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

/** Returns the account's answer to the poll a message of its private chat with a bot shows. */
export const getAccountPollAnswerContract = defineControlOperation({
  operationId: 'getAccountPollAnswer',
  method: 'GET',
  path:
    '/sessions/{sessionId}/accounts/{accountId}/conversations/private/{botId}/messages/{messageId}/poll-answer',
  params: accountPrivateMessagePathSchema,
  success: { status: 200, body: { kind: 'json', schema: privatePollAnswerResponseSchema } },
  refusals: { 400: controlValidationErrorSchema, 404: pollMessageNotFoundSchema },
});

/**
 * Replaces the account's answer to the poll a message of its private chat with a bot shows, as
 * TDLib's `setPollAnswer` does for a user.
 */
export const answerAccountPollContract = defineControlOperation({
  operationId: 'answerAccountPoll',
  method: 'PUT',
  path:
    '/sessions/{sessionId}/accounts/{accountId}/conversations/private/{botId}/messages/{messageId}/poll-answer',
  params: accountPrivateMessagePathSchema,
  body: { required: true, schema: setPollAnswerRequestSchema },
  success: {
    status: 200,
    body: { kind: 'json', schema: privatePollAnswerResponseSchema },
    actionReceipt: 'before_action',
  },
  refusals: {
    400: pollAnswerRejectionSchema,
    404: pollMessageNotFoundSchema,
    409: pollAnswerConflictSchema,
  },
});

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

/**
 * Stops the poll the account sent in a message of its private chat with a bot, as TDLib's
 * `stopPoll` does for a user, and returns the message, whose poll is now closed.
 */
export const stopAccountPollContract = defineControlOperation({
  operationId: 'stopAccountPoll',
  method: 'POST',
  path:
    '/sessions/{sessionId}/accounts/{accountId}/conversations/private/{botId}/messages/{messageId}/poll-closure',
  params: accountPrivateMessagePathSchema,
  success: {
    status: 200,
    body: { kind: 'json', schema: z.strictObject({ message: privateMessageSchema }) },
    actionReceipt: 'before_action',
  },
  refusals: {
    400: controlValidationErrorSchema,
    403: controlRefusalSchema(['not_a_member', 'poll_not_stoppable']),
    404: pollMessageNotFoundSchema,
    409: controlRefusalSchema(['poll_already_closed']),
  },
});
