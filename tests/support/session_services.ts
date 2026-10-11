/**
 * Root-backed session services for integration tests that reach into a session's services rather
 * than its HTTP routes. The session is the one the production composition root builds, so its
 * wiring, transactions and lifetime are the real ones; only its time sources are the test's.
 *
 * Unit tests that isolate a service behind small explicit fakes keep constructing that service
 * directly instead.
 */
import { createEmulationSession } from '../../src/composition/emulation_session.ts';
import type { Scheduler, WallClock } from '../../src/timing/session_timing.ts';
import type { EmulationSession } from '../../src/types/emulation_session.ts';
import type { UploadProfile } from '../../src/types/upload_profile.ts';
import { createRealTimeScheduler } from './scheduler.ts';

/** The calendar time a session built for a test tells unless the test gives it a wall clock. */
export const TEST_UNIX_TIME_SECONDS = 1_700_000_000;

/** A wall clock that always tells `TEST_UNIX_TIME_SECONDS`, so that message dates are known. */
const TEST_WALL_CLOCK: WallClock = { currentUnixTimeSeconds: () => TEST_UNIX_TIME_SECONDS };

export interface SessionServicesOptions {
  /** The session's ID; `test-session` when omitted. */
  readonly id?: string;
  /** The session's upload profile; `cloud` when omitted. */
  readonly uploadProfile?: UploadProfile;
  /**
   * The calendar time the session dates its messages by; fixed at `TEST_UNIX_TIME_SECONDS` when
   * omitted.
   */
  readonly wallClock?: WallClock;
  /**
   * The scheduler the session's deadlines and delays run on, such as a `ControlledScheduler` whose
   * deadlines arrive only when the test says so; real time when omitted.
   */
  readonly scheduler?: Scheduler;
}

/**
 * A session composed for a test. Disposing of it, as `using` does, ends the session: its commit
 * gate closes, its long polls and activity reads are answered, and its webhooks and their
 * deadlines stop.
 */
export type SessionServices = EmulationSession & Disposable;

/**
 * Builds a fresh session through the production composition root, with the test's time sources in
 * place of the host's.
 */
export function buildSessionServices(
  {
    id = 'test-session',
    uploadProfile = 'cloud',
    wallClock = TEST_WALL_CLOCK,
    scheduler = createRealTimeScheduler(),
  }: SessionServicesOptions = {},
): SessionServices {
  const session = createEmulationSession(id, { uploadProfile }, { wallClock, scheduler });
  return { ...session, [Symbol.dispose]: () => session.end() };
}
