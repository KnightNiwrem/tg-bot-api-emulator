import { Hono } from 'hono';
import { z } from 'zod';

import type { EmulationSession } from '../../../types/emulation_session.ts';
import { readJsonRequestBody } from '../json_request_body.ts';
import type { SessionRouteContextTypes } from '../session_route_context_types.ts';
import { PRIVATE_CONVERSATION_PATH, privateConversationPathSchema } from './account_paths.ts';

const PRIVATE_MESSAGE_DRAFT_PATH = `${PRIVATE_CONVERSATION_PATH}/message-draft` as const;
const PRIVATE_MESSAGE_DRAFT_EXPIRATION_PATH = `${PRIVATE_MESSAGE_DRAFT_PATH}/expiration` as const;

/** Telegram's decimal text form of a nonzero 64-bit draft ID, without leading zeros. */
const draftIdSchema = z.string()
  .regex(/^-?[1-9][0-9]*$/)
  .refine((draftId) => BigInt(draftId) >= -(2n ** 63n) && BigInt(draftId) < 2n ** 63n);

const draftExpirationRequestSchema = z.strictObject({
  /** The draft the test expects the chat to show; omitted to expire whichever draft it shows. */
  draft_id: draftIdSchema.optional(),
});

/**
 * Routes through which an account reads the message draft a bot streams to its private chat,
 * and through which a test expires it, as Telegram's clients remove a draft 30 seconds after the
 * bot's last write.
 */
export function createMessageDraftRoutes(): Hono<SessionRouteContextTypes> {
  const accountRoutes = new Hono<SessionRouteContextTypes>();

  accountRoutes.get(PRIVATE_MESSAGE_DRAFT_PATH, (context) => {
    const conversationPath = privateConversationPathSchema.safeParse(context.req.param());
    if (!conversationPath.success) {
      return context.body(null, 400);
    }
    const { messageDrafts, botMessageViews } = context.get('emulationSession');
    const result = messageDrafts.getPrivateMessageDraft(conversationPath.data);
    if (!result.found) {
      return context.body(null, 404);
    }
    const { draft } = result;
    return context.json({
      message_draft: draft === undefined
        ? null
        : { draft_id: draft.draftId, ...botMessageViews.viewMessageText(draft.text) },
    });
  });

  accountRoutes.post(PRIVATE_MESSAGE_DRAFT_EXPIRATION_PATH, async (context) => {
    const conversationPath = privateConversationPathSchema.safeParse(context.req.param());
    if (!conversationPath.success) {
      return context.body(null, 400);
    }
    const requestBody = await readJsonRequestBody(context.req, draftExpirationRequestSchema, {
      allowsEmptyBody: true,
    });
    if (requestBody === undefined) {
      return context.body(null, 400);
    }
    const result = context.get('emulationSession').messageDrafts.expirePrivateMessageDraft({
      ...conversationPath.data,
      expectedDraftId: requestBody.draft_id,
    });
    return context.body(null, result.expired ? 204 : draftExpirationFailureStatus(result.reason));
  });

  return accountRoutes;
}

/**
 * An unknown account or bot, or a chat that shows no draft, is not found; a draft other than the
 * one the test expects conflicts with expiring it.
 */
function draftExpirationFailureStatus(
  reason: Extract<
    ReturnType<EmulationSession['messageDrafts']['expirePrivateMessageDraft']>,
    { readonly expired: false }
  >['reason'],
): 404 | 409 {
  switch (reason) {
    case 'account_not_found':
    case 'bot_not_found':
    case 'draft_not_found':
      return 404;
    case 'draft_id_mismatch':
      return 409;
    default: {
      const unhandledReason: never = reason;
      throw new Error(`Unhandled message draft expiration failure: ${unhandledReason}`);
    }
  }
}
