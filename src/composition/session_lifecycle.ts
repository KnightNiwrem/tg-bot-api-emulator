import { SessionRepository } from '../repositories/session/session.ts';
import { SessionLifecycleService } from '../services/application/session_lifecycle.ts';
import type { WebhookTransport } from '../services/webhook_delivery/webhook_delivery.ts';
import type { SessionTiming } from '../timing/session/session_timing.ts';
import { createSystemSessionTiming } from '../timing/system/system_timing.ts';
import { createEmulationSession } from './emulation_session.ts';

/** Sends every session's webhook requests over the network. */
const NETWORK_WEBHOOK_TRANSPORT: WebhookTransport = (request) => fetch(request);

/** Gives each new session its own time sources. */
export type SessionTimingSource = () => SessionTiming;

/**
 * Composes the sessions' lifecycle. Every session keeps real time unless `createSessionTiming`
 * gives it other time sources, as tests do to fix the calendar time, and sends its webhook
 * requests over the network.
 */
export function createSessionLifecycleService(
  createSessionTiming: SessionTimingSource = createSystemSessionTiming,
): SessionLifecycleService {
  return new SessionLifecycleService({
    sessionRepository: new SessionRepository(),
    createEmulationSession: (sessionId, options) =>
      createEmulationSession(
        sessionId,
        options,
        createSessionTiming(),
        NETWORK_WEBHOOK_TRANSPORT,
      ),
    generateSessionId: () => crypto.randomUUID(),
  });
}
