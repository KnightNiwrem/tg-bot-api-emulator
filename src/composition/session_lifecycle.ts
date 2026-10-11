import { SessionRepository } from '../repositories/session.ts';
import { SessionLifecycleService } from '../services/session_lifecycle.ts';
import type { SessionTiming } from '../timing/session_timing.ts';
import { createSystemSessionTiming } from '../timing/system_timing.ts';
import { createEmulationSession } from './emulation_session.ts';

/** Gives each new session its own time sources. */
export type SessionTimingSource = () => SessionTiming;

/**
 * Composes the sessions' lifecycle. Every session keeps real time unless `createSessionTiming`
 * gives it other time sources, as tests do to fix the calendar time.
 */
export function createSessionLifecycleService(
  createSessionTiming: SessionTimingSource = createSystemSessionTiming,
): SessionLifecycleService {
  return new SessionLifecycleService({
    sessionRepository: new SessionRepository(),
    createEmulationSession: (sessionId, options) =>
      createEmulationSession(sessionId, options, createSessionTiming()),
    generateSessionId: () => crypto.randomUUID(),
  });
}
