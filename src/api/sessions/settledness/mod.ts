import { Hono } from 'hono';

import { readSessionSettlednessContract } from '../../../../control_contracts/session_settledness.ts';
import type { ControlOperationResponse } from '../../../../control_contracts/operation_contract.ts';
import type { EmulationSession } from '../../../types/emulation_session.ts';
import { registerControlOperation } from '../../control_operation_route.ts';
import type { SessionRouteContextTypes } from '../session_route_context_types.ts';

/** Where the settledness route is mounted within the server, as a contract path template. */
const SETTLEDNESS_MOUNT_PATH = '/sessions/{sessionId}/settledness';

type SettlednessResponse = ControlOperationResponse<typeof readSessionSettlednessContract>;

/** Something the session waits on, as the settledness read finds it. */
type SettlednessBlocker = ReturnType<
  EmulationSession['settledness']['readSettledness']
>['blockers'][number];

/** The blocker as the read's answer shows it. */
type PresentedBlocker = Extract<
  SettlednessResponse,
  { readonly status: 200 }
>['body']['blockers'][number];

export function createSettlednessRoutes(): Hono<SessionRouteContextTypes> {
  const settlednessRoutes = new Hono<SessionRouteContextTypes>();

  registerControlOperation(
    settlednessRoutes,
    SETTLEDNESS_MOUNT_PATH,
    readSessionSettlednessContract,
    (_request, context): SettlednessResponse => {
      const { activityPosition, settled, bots, blockers } = context.get('emulationSession')
        .settledness.readSettledness();
      return {
        status: 200,
        body: {
          activity_position: activityPosition,
          settled,
          bots: bots.map(({ botId, pendingUpdateCount, drained }) => ({
            bot_id: botId,
            pending_update_count: pendingUpdateCount,
            drained,
          })),
          blockers: blockers.map(presentBlocker),
        },
      };
    },
  );

  return settlednessRoutes;
}

function presentBlocker(blocker: SettlednessBlocker): PresentedBlocker {
  switch (blocker.kind) {
    case 'bot_api_call':
      return {
        kind: blocker.kind,
        runnable: blocker.runnable,
        bot_id: blocker.botId,
        via: blocker.via,
        ...(blocker.method === undefined ? {} : { method: blocker.method }),
      };
    case 'held_long_poll':
      return { kind: blocker.kind, runnable: blocker.runnable, bot_id: blocker.botId };
    case 'undelivered_update':
      return { ...presentPendingUpdate(blocker), kind: blocker.kind, runnable: blocker.runnable };
    case 'unconfirmed_delivery':
      return { ...presentPendingUpdate(blocker), kind: blocker.kind, runnable: blocker.runnable };
    case 'queued_webhook_update':
      return { ...presentPendingUpdate(blocker), kind: blocker.kind, runnable: blocker.runnable };
    case 'webhook_delivery_due':
      return { ...presentPendingUpdate(blocker), kind: blocker.kind, runnable: blocker.runnable };
    case 'webhook_attempt':
      return {
        ...presentWebhookAttempt(blocker),
        kind: blocker.kind,
        runnable: blocker.runnable,
        ...(blocker.scheduling === 'automatic' ? { timeout_seconds: blocker.timeoutSeconds } : {}),
      };
    case 'webhook_retry':
      return {
        ...presentWebhookAttempt(blocker),
        kind: blocker.kind,
        runnable: blocker.runnable,
        ...(blocker.scheduling === 'automatic' ? { delay_seconds: blocker.delaySeconds } : {}),
      };
    default: {
      const unhandledBlocker: never = blocker;
      throw new Error(`Unhandled settledness blocker: ${JSON.stringify(unhandledBlocker)}`);
    }
  }
}

/** The pending update a blocker waits on. */
function presentPendingUpdate(
  { botId, updateId }: { readonly botId: number; readonly updateId: number },
) {
  return { bot_id: botId, update_id: updateId };
}

/** The webhook attempt of a pending update that a blocker waits on. */
function presentWebhookAttempt(
  blocker: Extract<SettlednessBlocker, { readonly kind: 'webhook_attempt' | 'webhook_retry' }>,
) {
  return {
    ...presentPendingUpdate(blocker),
    webhook_attempt_id: blocker.webhookAttemptId,
    scheduling: blocker.scheduling,
  };
}
