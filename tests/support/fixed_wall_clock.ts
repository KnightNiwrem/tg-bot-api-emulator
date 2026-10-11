/**
 * A calendar time that stands still, for tests that compare the dates of messages and updates
 * created by separate requests: under real time, two such dates differ whenever the requests fall
 * either side of a second.
 */
import type { WallClock } from '../../src/timing/session_timing.ts';

/** The Unix time, in seconds, that a fixed test clock tells. */
export const TEST_UNIX_TIME_SECONDS = 1_700_000_000;

/** A wall clock that always tells `TEST_UNIX_TIME_SECONDS`. */
export const FIXED_WALL_CLOCK: WallClock = { currentUnixTimeSeconds: () => TEST_UNIX_TIME_SECONDS };
