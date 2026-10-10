import { type Context, Hono } from 'hono';
import { z } from 'zod';

import type { EmulationSession } from '../../../types/emulation_session.ts';
import {
  controlErrorResponse,
  invalidControlRequestResponse,
} from '../../control_error_response.ts';
import { type ControlRequestInputReading, readPathParameters } from '../control_request_input.ts';
import { readJsonRequestBody } from '../json_request_body.ts';
import type { SessionRouteContextTypes } from '../session_route_context_types.ts';
import { PRIVATE_CONVERSATION_PATH, privateConversationPathSchema } from './account_paths.ts';

const PRIVATE_MESSAGE_DRAFT_PATH = `${PRIVATE_CONVERSATION_PATH}/message-draft` as const;
const PRIVATE_MESSAGE_DRAFT_EXPIRATION_PATH = `${PRIVATE_MESSAGE_DRAFT_PATH}/expiration` as const;
const PRIVATE_MESSAGE_DRAFT_STOP_PATH = `${PRIVATE_MESSAGE_DRAFT_PATH}/stop` as const;

/** Telegram's decimal text form of a nonzero 64-bit integer, without leading zeros. */
const NONZERO_DECIMAL_INTEGER_PATTERN = /^-?[1-9][0-9]*$/;

/** The range of Telegram's 64-bit identifiers. */
const MIN_INT64 = -(2n ** 63n);
const MAX_INT64 = 2n ** 63n - 1n;

/** A draft ID in Telegram's decimal text form, which a draft action compares as written. */
const draftIdSchema = z.string().refine(isDraftIdText, {
  message: 'Expected a nonzero 64-bit integer in decimal text',
});

const shownDraftActionRequestSchema = z.strictObject({
  /** The draft the test expects the chat to show; omitted to act on whichever draft it shows. */
  draft_id: draftIdSchema.optional(),
});

type MessageDrafts = EmulationSession['messageDrafts'];

/** The draft an action applies to: the one a private chat shows, as the test expects it. */
type ShownMessageDraftTarget = Parameters<MessageDrafts['stopPrivateMessageDraft']>[0];

/**
 * Routes through which an account reads the message draft a bot streams to its private chat and
 * presses its Stop button, and through which a test expires it, as Telegram's clients remove a
 * draft 30 seconds after the bot's last write.
 */
export function createMessageDraftRoutes(): Hono<SessionRouteContextTypes> {
  const accountRoutes = new Hono<SessionRouteContextTypes>();

  accountRoutes.get(PRIVATE_MESSAGE_DRAFT_PATH, (context) => {
    const conversationPath = readPathParameters(privateConversationPathSchema, context.req.param());
    if (!conversationPath.valid) {
      return invalidControlRequestResponse(context, conversationPath.issues);
    }
    const { messageDrafts, botMessageViews } = context.get('emulationSession');
    const result = messageDrafts.getPrivateMessageDraft(conversationPath.value);
    if (!result.found) {
      return controlErrorResponse(context, 404, result.reason);
    }
    const { draft } = result;
    return context.json({
      message_draft: draft === undefined ? null : {
        draft_id: draft.draftId,
        ...botMessageViews.viewMessageText(draft.text),
        can_stop: draft.canStop,
        keep_on_stop: draft.keepOnStop,
        is_stopped: draft.isStopped,
      },
    });
  });

  accountRoutes.post(PRIVATE_MESSAGE_DRAFT_EXPIRATION_PATH, async (context) => {
    const target = await readShownDraftTarget(context);
    if (!target.valid) {
      return invalidControlRequestResponse(context, target.issues);
    }
    const result = context.get('emulationSession').messageDrafts.expirePrivateMessageDraft(
      target.value,
    );
    return result.expired
      ? context.body(null, 204)
      : controlErrorResponse(context, draftActionFailureStatus(result.reason), result.reason);
  });

  accountRoutes.post(PRIVATE_MESSAGE_DRAFT_STOP_PATH, async (context) => {
    const target = await readShownDraftTarget(context);
    if (!target.valid) {
      return invalidControlRequestResponse(context, target.issues);
    }
    const result = context.get('emulationSession').messageDrafts.stopPrivateMessageDraft(
      target.value,
    );
    return result.stopped
      ? context.body(null, 204)
      : controlErrorResponse(context, draftActionFailureStatus(result.reason), result.reason);
  });

  return accountRoutes;
}

/**
 * Reads the draft an action applies to: the private chat's from the path, guarded by the
 * `draft_id` of a body, which may be empty.
 */
async function readShownDraftTarget(
  context: Context<SessionRouteContextTypes>,
): Promise<ControlRequestInputReading<ShownMessageDraftTarget>> {
  const conversationPath = readPathParameters(privateConversationPathSchema, context.req.param());
  if (!conversationPath.valid) {
    return conversationPath;
  }
  const requestBody = await readJsonRequestBody(context.req, shownDraftActionRequestSchema, {
    allowsEmptyBody: true,
  });
  return requestBody.valid
    ? {
      valid: true,
      value: { ...conversationPath.value, expectedDraftId: requestBody.value.draft_id },
    }
    : requestBody;
}

/**
 * An unknown account or bot, or a chat that shows no draft, is not found; a draft without a Stop
 * button forbids stopping it; and a draft other than the one the test expects, or one already
 * stopped, conflicts with the action.
 */
function draftActionFailureStatus(
  reason:
    | Extract<ReturnType<MessageDrafts['expirePrivateMessageDraft']>, { expired: false }>['reason']
    | Extract<ReturnType<MessageDrafts['stopPrivateMessageDraft']>, { stopped: false }>['reason'],
): 403 | 404 | 409 {
  switch (reason) {
    case 'account_not_found':
    case 'bot_not_found':
    case 'draft_not_found':
      return 404;
    case 'draft_not_stoppable':
      return 403;
    case 'draft_id_mismatch':
    case 'draft_already_stopped':
      return 409;
    default: {
      const unhandledReason: never = reason;
      throw new Error(`Unhandled message draft action failure: ${unhandledReason}`);
    }
  }
}

/**
 * Whether text is a nonzero 64-bit draft ID in Telegram's decimal text form. Only text of that
 * form is parsed as a number, so other text is refused without throwing.
 */
function isDraftIdText(text: string): boolean {
  if (!NONZERO_DECIMAL_INTEGER_PATTERN.test(text)) {
    return false;
  }
  const draftId = BigInt(text);
  return draftId >= MIN_INT64 && draftId <= MAX_INT64;
}
