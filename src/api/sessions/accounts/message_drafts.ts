import { Hono } from 'hono';

import { INVALID_REQUEST_REASON } from '../../contracts/control_errors.ts';
import {
  expirePrivateMessageDraftContract,
  getPrivateMessageDraftContract,
  stopPrivateMessageDraftContract,
} from '../../contracts/message_drafts.ts';
import type { ControlOperationRefusal } from '../../contracts/operation_contract.ts';
import type { EmulationSession } from '../../../session/emulation_session.ts';
import { isInt64DecimalText } from '../../../types/telegram_int64.ts';
import { registerControlOperation } from '../../control_operation_route.ts';
import type { SessionRouteContextTypes } from '../session_route_context_types.ts';

/** Where the account routes are mounted within the server, as a contract path template. */
const ACCOUNT_COLLECTION_MOUNT_PATH = '/sessions/{sessionId}/accounts';

type MessageDrafts = EmulationSession['messageDrafts'];

/** Why the draft an action applies to was not found as the test expects it. */
type ShownDraftLookupFailureReason = Extract<
  ReturnType<MessageDrafts['expirePrivateMessageDraft']>,
  { expired: false }
>['reason'];

/** Why pressing the Stop button of the draft a private chat shows was refused. */
type DraftStopFailureReason = Extract<
  ReturnType<MessageDrafts['stopPrivateMessageDraft']>,
  { stopped: false }
>['reason'];

/**
 * Routes through which an account reads the message draft a bot streams to its private chat and
 * presses its Stop button, and through which a test expires it, as Telegram's clients remove a
 * draft 30 seconds after the bot's last write.
 */
export function createMessageDraftRoutes(): Hono<SessionRouteContextTypes> {
  const accountRoutes = new Hono<SessionRouteContextTypes>();

  registerControlOperation(
    accountRoutes,
    ACCOUNT_COLLECTION_MOUNT_PATH,
    getPrivateMessageDraftContract,
    ({ params: { accountId, botId } }, context) => {
      const { messageDrafts, botMessageViews } = context.get('emulationSession');
      const result = messageDrafts.getPrivateMessageDraft({ accountId, botId });
      if (!result.found) {
        return { status: 404, body: { reason: result.reason } };
      }
      const { draft } = result;
      if (draft === undefined) {
        return { status: 200, body: { message_draft: null } };
      }
      const { text, entities } = botMessageViews.viewMessageText(draft.text);
      return {
        status: 200,
        body: {
          message_draft: {
            draft_id: draft.draftId,
            text,
            ...(entities === undefined ? {} : { entities: [...entities] }),
            can_stop: draft.canStop,
            keep_on_stop: draft.keepOnStop,
            is_stopped: draft.isStopped,
          },
        },
      };
    },
  );

  registerControlOperation(
    accountRoutes,
    ACCOUNT_COLLECTION_MOUNT_PATH,
    expirePrivateMessageDraftContract,
    ({ params: { accountId, botId }, body: { draft_id: expectedDraftId } }, context) => {
      if (expectedDraftId !== undefined && !isInt64DecimalText(expectedDraftId)) {
        return refuseDraftIdOutOfRange();
      }
      const result = context.get('emulationSession').messageDrafts.expirePrivateMessageDraft({
        accountId,
        botId,
        expectedDraftId,
      });
      if (result.expired) {
        return { status: 204 };
      }
      return refuseShownDraftLookup(result.reason);
    },
  );

  registerControlOperation(
    accountRoutes,
    ACCOUNT_COLLECTION_MOUNT_PATH,
    stopPrivateMessageDraftContract,
    ({ params: { accountId, botId }, body: { draft_id: expectedDraftId } }, context) => {
      if (expectedDraftId !== undefined && !isInt64DecimalText(expectedDraftId)) {
        return refuseDraftIdOutOfRange();
      }
      const result = context.get('emulationSession').messageDrafts.stopPrivateMessageDraft({
        accountId,
        botId,
        expectedDraftId,
      });
      return result.stopped ? { status: 204 } : refuseDraftStop(result.reason);
    },
  );

  return accountRoutes;
}

/**
 * The refusal of a `draft_id` outside the signed 64-bit range, a rule its contract's pattern
 * cannot state.
 */
function refuseDraftIdOutOfRange(): ControlOperationRefusal<
  typeof expirePrivateMessageDraftContract
> {
  return {
    status: 400,
    body: {
      reason: INVALID_REQUEST_REASON,
      issues: [{
        source: 'body',
        path: ['draft_id'],
        code: 'invalid_value',
        message: 'A draft ID is a signed 64-bit integer',
      }],
    },
  };
}

/**
 * An unknown account or bot, or a chat that shows no draft, is not found; and a draft other than
 * the one the test expects conflicts with the action.
 */
function refuseShownDraftLookup(reason: ShownDraftLookupFailureReason) {
  switch (reason) {
    case 'account_not_found':
    case 'bot_not_found':
    case 'draft_not_found':
      return { status: 404, body: { reason } } as const;
    case 'draft_id_mismatch':
      return { status: 409, body: { reason } } as const;
    default: {
      const unhandledReason: never = reason;
      throw new Error(`Unhandled message draft lookup failure: ${unhandledReason}`);
    }
  }
}

/**
 * Besides the refusals of finding the draft, a draft without a Stop button forbids stopping it,
 * and a draft already stopped conflicts with stopping it again.
 */
function refuseDraftStop(reason: DraftStopFailureReason) {
  switch (reason) {
    case 'draft_not_stoppable':
      return { status: 403, body: { reason } } as const;
    case 'draft_already_stopped':
      return { status: 409, body: { reason } } as const;
    default:
      return refuseShownDraftLookup(reason);
  }
}
