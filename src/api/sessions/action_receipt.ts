/**
 * Captures and writes the action receipts that successful control actions answer with, as
 * `src/api/contracts/action_receipts.ts` describes them.
 */
import type { Context } from 'hono';

import {
  ACTION_RECEIPT_ACTIVITY_POSITION_HEADER,
  ACTION_RECEIPT_SESSION_ID_HEADER,
} from '../contracts/action_receipts.ts';
import type { EmulationSession } from '../../types/emulation_session.ts';
import { sessionNotFoundResponse } from '../control_error_response.ts';
import type { SessionRouteContextTypes } from './session_route_context_types.ts';

/** A session as a receipt reads it: its ID and the head of its bot activity log. */
type ReceiptSession = Pick<EmulationSession, 'id'> & {
  readonly botActivity: Pick<EmulationSession['botActivity'], 'getHeadPosition'>;
};

/** A session's ID and a position of its bot activity log that an action's effects all follow. */
export interface ActionReceipt {
  readonly sessionId: string;
  readonly activityPosition: number;
}

/**
 * The receipt of an action that is about to execute in `session`: the head of its log as it is.
 *
 * Capture it in the same synchronous step as the action executes, before the action changes
 * anything. Nothing can then be recorded in between, so the receipt is the head at the action's
 * start, and every entry the action causes, even one recorded before its response is sent, comes
 * after it. A transaction is never open between synchronous steps, so the head read here holds
 * only published entries.
 */
export function captureActionReceipt(session: ReceiptSession): ActionReceipt {
  return { sessionId: session.id, activityPosition: session.botActivity.getHeadPosition() };
}

/** The receipt of the session an action created, whose log has no entry yet. */
export function createdSessionReceipt(sessionId: string): ActionReceipt {
  return { sessionId, activityPosition: 0 };
}

/** The headers that carry a receipt. */
export function writeActionReceiptHeaders(receipt: ActionReceipt): Record<string, string> {
  return {
    [ACTION_RECEIPT_SESSION_ID_HEADER]: receipt.sessionId,
    [ACTION_RECEIPT_ACTIVITY_POSITION_HEADER]: String(receipt.activityPosition),
  };
}

/**
 * Executes an action of a route that its contract does not register, in the request's session, and
 * answers as `act` does, adding the action's receipt to a successful answer. The receipt is
 * captured just before `act` runs, so call this after the route's last wait, such as reading its
 * request's body, and let `act` validate and execute the action. A refusal carries no receipt.
 *
 * The action executes as a command of its session, at its commit boundary: in the same
 * synchronous step as the session's commit gate is checked, so a session that ended while the
 * request was read refuses it, changes nothing, and answers as one that does not exist. The
 * action's changes, and the views of them its answer shows, are one transaction, published once
 * `act` returns. An action that waits, as one that downloads does, executes only up to its first
 * wait in it, and what it changes after a wait checks the session's gate itself.
 */
export async function answerWithActionReceipt(
  context: Context<SessionRouteContextTypes>,
  act: (session: EmulationSession) => Response | Promise<Response>,
): Promise<Response> {
  const session = context.get('emulationSession');
  const receipt = captureActionReceipt(session);
  const action = session.transactions.execute(() => act(session));
  if (!action.executed) {
    return sessionNotFoundResponse(context);
  }
  const response = await action.result;
  if (response.ok) {
    // `Headers` names each header without regard to letter case, so a receipt header the action
    // happened to give is replaced, not joined.
    for (const [name, value] of Object.entries(writeActionReceiptHeaders(receipt))) {
      response.headers.set(name, value);
    }
  }
  return response;
}
