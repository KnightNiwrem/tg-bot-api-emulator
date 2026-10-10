import { SessionRepository } from '../repositories/session.ts';
import { SessionLifecycleService } from '../services/session_lifecycle.ts';
import { createSystemSessionTiming } from '../timing/system_timing.ts';
import { createEmulationSession } from './emulation_session.ts';

export function createSessionLifecycleService(): SessionLifecycleService {
  return new SessionLifecycleService({
    sessionRepository: new SessionRepository(),
    // Every session keeps real time.
    createEmulationSession: (sessionId, options) =>
      createEmulationSession(sessionId, options, createSystemSessionTiming()),
    generateSessionId: () => crypto.randomUUID(),
  });
}
