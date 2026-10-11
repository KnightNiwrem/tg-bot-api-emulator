/**
 * The contracts of the message draft a bot streams to its private chat with an account: reading
 * it, pressing its Stop button, and the test control that expires it, as Telegram's clients remove
 * a draft 30 seconds after the bot's last write.
 */
import { z } from 'zod';

import { accountPrivateChatPathSchema } from './accounts.ts';
import { controlRefusalSchema, controlValidationErrorSchema } from './control_errors.ts';
import { messageEntitySchema } from './message_entities.ts';
import { defineControlOperation } from './operation_contract.ts';

/**
 * A draft's 64-bit identifier in Telegram's decimal text form, without leading zeros: a nonzero
 * integer. A request's identifier must also lie within the 64-bit range, which the server checks
 * and reports as an `invalid_value` issue.
 */
const draftIdSchema = z.string().regex(/^-?[1-9][0-9]*$/);

/** The draft of a message a bot is generating, as the account's client shows it. */
const messageDraftSchema = z.strictObject({
  /**
   * The draft's 64-bit ID as the bot chose it, in Telegram's decimal text form, as the
   * `stopped_message_generation` update of the official Bot API server writes it.
   */
  draft_id: draftIdSchema,
  /** The draft's text; empty while the client shows a "Thinking…" placeholder. */
  text: z.string(),
  /** The text's entities, as a text message shows them; omitted for none. */
  entities: z.array(messageEntitySchema).min(1).optional(),
  /** Whether the bot asked for a Stop button, which pressing Stop presses. */
  can_stop: z.boolean(),
  /** Whether the draft stays shown once the account presses Stop. */
  keep_on_stop: z.boolean(),
  /** Whether the account pressed Stop; the client then shows no Stop button. */
  is_stopped: z.boolean(),
});

/** The draft an action applies to: the one the private chat shows, as the test expects it. */
const shownDraftActionRequestSchema = z.strictObject({
  /**
   * The draft the test expects the chat to show; omitted to act on whichever draft it shows. It
   * guards which draft the action applies to, not which write to it.
   */
  draft_id: draftIdSchema.optional(),
});

/** A missing session, account, or bot, or a chat that shows no draft. */
const draftNotFoundSchema = controlRefusalSchema([
  'account_not_found',
  'bot_not_found',
  'draft_not_found',
  'session_not_found',
]);

/** Returns the draft the bot streams to its private chat with the account, or `null` for none. */
export const getPrivateMessageDraftContract = defineControlOperation({
  operationId: 'getPrivateMessageDraft',
  method: 'GET',
  path: '/sessions/{sessionId}/accounts/{accountId}/conversations/private/{botId}/message-draft',
  params: accountPrivateChatPathSchema,
  success: {
    status: 200,
    body: {
      kind: 'json',
      schema: z.strictObject({ message_draft: z.union([messageDraftSchema, z.null()]) }),
    },
  },
  refusals: {
    400: controlValidationErrorSchema,
    404: controlRefusalSchema(['account_not_found', 'bot_not_found', 'session_not_found']),
  },
});

/**
 * Expires the draft the private chat shows, as Telegram's clients remove it 30 seconds after the
 * bot's last write. The body may be left out.
 */
export const expirePrivateMessageDraftContract = defineControlOperation({
  operationId: 'expirePrivateMessageDraft',
  method: 'POST',
  path:
    '/sessions/{sessionId}/accounts/{accountId}/conversations/private/{botId}/message-draft/expiration',
  params: accountPrivateChatPathSchema,
  body: { required: false, schema: shownDraftActionRequestSchema },
  success: { status: 204, body: { kind: 'empty' }, actionReceipt: 'before_action' },
  refusals: {
    400: controlValidationErrorSchema,
    404: draftNotFoundSchema,
    409: controlRefusalSchema(['draft_id_mismatch']),
  },
});

/**
 * Presses the Stop button of the draft the private chat shows, as the account. The body may be
 * left out.
 */
export const stopPrivateMessageDraftContract = defineControlOperation({
  operationId: 'stopPrivateMessageDraft',
  method: 'POST',
  path:
    '/sessions/{sessionId}/accounts/{accountId}/conversations/private/{botId}/message-draft/stop',
  params: accountPrivateChatPathSchema,
  body: { required: false, schema: shownDraftActionRequestSchema },
  success: { status: 204, body: { kind: 'empty' }, actionReceipt: 'before_action' },
  refusals: {
    400: controlValidationErrorSchema,
    403: controlRefusalSchema(['draft_not_stoppable']),
    404: draftNotFoundSchema,
    409: controlRefusalSchema(['draft_already_stopped', 'draft_id_mismatch']),
  },
});
