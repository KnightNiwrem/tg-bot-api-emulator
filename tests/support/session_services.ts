/**
 * Root-backed session services for integration tests that reach into a session's services rather
 * than its HTTP routes. The session is the one the production composition root builds, so its
 * wiring, transactions and lifetime are the real ones; only its time sources and its webhook
 * transport are the test's.
 *
 * Unit tests that isolate a service behind small explicit fakes keep constructing that service
 * directly instead.
 */
import { createEmulationSession } from '../../src/composition/emulation_session.ts';
import type { WebhookTransport } from '../../src/services/webhook_delivery.ts';
import type { Scheduler, WallClock } from '../../src/timing/session_timing.ts';
import type { EmulationSession } from '../../src/types/emulation_session.ts';
import type { UploadProfile } from '../../src/types/upload_profile.ts';
import { FIXED_WALL_CLOCK } from './fixed_wall_clock.ts';
import { createRealTimeScheduler } from './scheduler.ts';

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
  /**
   * Answers the session's webhook requests in place of the network. When omitted, every request
   * fails as a webhook the session cannot connect to does, so that no test reaches the network.
   */
  readonly webhookTransport?: WebhookTransport;
}

/** Fails every webhook request, as `fetch` fails to connect, without reaching the network. */
const UNREACHABLE_WEBHOOK_TRANSPORT: WebhookTransport = () =>
  Promise.reject(new TypeError('The test session sends no webhook requests over the network'));

/**
 * A session composed for a test. Disposing of it, as `using` does, ends the session: its commit
 * gate closes, its long polls and activity reads are answered, and its webhooks and their
 * deadlines stop.
 */
export type SessionServices = EmulationSession & Disposable;

/**
 * Builds a fresh session through the production composition root, with the test's time sources and
 * webhook transport in place of the host's.
 */
export function buildSessionServices(
  {
    id = 'test-session',
    uploadProfile = 'cloud',
    wallClock = FIXED_WALL_CLOCK,
    scheduler = createRealTimeScheduler(),
    webhookTransport = UNREACHABLE_WEBHOOK_TRANSPORT,
  }: SessionServicesOptions = {},
): SessionServices {
  const session = createEmulationSession(
    id,
    { uploadProfile },
    { wallClock, scheduler },
    webhookTransport,
  );
  return { ...session, [Symbol.dispose]: () => session.end() };
}
