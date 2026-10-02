import type { EmulationSession, EmulationSessionOptions } from '../types/emulation_session.ts';

const MAX_SESSION_ID_GENERATION_ATTEMPTS = 10;

interface SessionStore {
  add(session: EmulationSession): boolean;
  deleteById(sessionId: string): boolean;
  getById(sessionId: string): EmulationSession | undefined;
}

interface SessionLifecycleServiceDependencies {
  readonly sessionRepository: SessionStore;
  readonly createEmulationSession: (
    sessionId: string,
    options: EmulationSessionOptions,
  ) => EmulationSession;
  readonly generateSessionId: () => string;
}

export class SessionLifecycleService {
  readonly #sessionRepository: SessionStore;
  readonly #createEmulationSession: SessionLifecycleServiceDependencies['createEmulationSession'];
  readonly #generateSessionId: () => string;

  constructor(
    {
      sessionRepository,
      createEmulationSession,
      generateSessionId,
    }: SessionLifecycleServiceDependencies,
  ) {
    this.#sessionRepository = sessionRepository;
    this.#createEmulationSession = createEmulationSession;
    this.#generateSessionId = generateSessionId;
  }

  createSession(options: EmulationSessionOptions): EmulationSession {
    for (let attempt = 0; attempt < MAX_SESSION_ID_GENERATION_ATTEMPTS; attempt++) {
      const sessionId = this.#generateSessionId();
      if (this.#sessionRepository.getById(sessionId) !== undefined) {
        continue;
      }

      const session = this.#createEmulationSession(sessionId, options);
      if (session.id !== sessionId) {
        throw new Error(
          `Session factory returned ID ${session.id} for requested ID ${sessionId}`,
        );
      }
      if (this.#sessionRepository.add(session)) {
        return session;
      }
    }

    throw new Error(
      `Unable to generate a unique session ID after ${MAX_SESSION_ID_GENERATION_ATTEMPTS} attempts`,
    );
  }

  /** Unregisters the session before ending it, so no new request can reach an ended session. */
  endSession(sessionId: string): boolean {
    const session = this.#sessionRepository.getById(sessionId);
    if (session === undefined || !this.#sessionRepository.deleteById(sessionId)) {
      return false;
    }

    session.end();
    return true;
  }

  getSessionById(sessionId: string): EmulationSession | undefined {
    return this.#sessionRepository.getById(sessionId);
  }
}
