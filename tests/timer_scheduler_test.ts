import type { MonotonicClock } from '../src/timing/session_timing.ts';
import { SYSTEM_MONOTONIC_CLOCK, TimerScheduler } from '../src/timing/system_timing.ts';
import { waitForAbort } from './support/webhook_delivery.ts';

Deno.test('TimerScheduler measures what remains of a deadline on its monotonic clock', () => {
  const clock = new SettableMonotonicClock(100);
  const scheduler = new TimerScheduler(clock);
  const lifetime = new AbortController();
  try {
    const deadline = scheduler.deadline(50, lifetime.signal);
    clock.elapsed = 120;
    const remainingAfter20 = deadline.remainingMilliseconds();
    clock.elapsed = 200;
    const remainingAfter100 = deadline.remainingMilliseconds();
    if (remainingAfter20 !== 30 || remainingAfter100 !== 0 || deadline.signal.aborted) {
      throw new Error(
        `Expected 30 then 0 milliseconds left, saw ${remainingAfter20} and ${remainingAfter100}`,
      );
    }
  } finally {
    lifetime.abort();
  }
});

Deno.test('TimerScheduler lets a deadline arrive only once its clock shows the delay elapsed', async () => {
  // The clock stands still while host timers run, as if they had run early.
  const clock = new SettableMonotonicClock(0);
  const scheduler = new TimerScheduler(clock);
  const lifetime = new AbortController();
  try {
    const deadline = scheduler.deadline(5, lifetime.signal);
    await delay(30);
    if (deadline.signal.aborted) {
      throw new Error('Expected the deadline to wait for its clock');
    }

    clock.elapsed = 5;
    await waitForAbort(deadline.signal);
    if (
      !(deadline.signal.reason instanceof DOMException) ||
      deadline.signal.reason.name !== 'TimeoutError'
    ) {
      throw new Error('Expected the deadline to arrive with a TimeoutError');
    }
    if (deadline.remainingMilliseconds() !== 0) {
      throw new Error('Expected nothing to remain of an arrived deadline');
    }
  } finally {
    lifetime.abort();
  }
});

Deno.test('TimerScheduler never lets a deadline arrive once its lifetime ends', async () => {
  const scheduler = new TimerScheduler(SYSTEM_MONOTONIC_CLOCK);
  const lifetime = new AbortController();
  const deadline = scheduler.deadline(10, lifetime.signal);
  lifetime.abort();
  await delay(30);
  // The test's sanitizer also fails it if the cancelled deadline kept its timer.
  if (deadline.signal.aborted) {
    throw new Error('Expected a cancelled deadline never to arrive');
  }

  const deadlineOfEndedLifetime = scheduler.deadline(10, lifetime.signal);
  await delay(30);
  if (deadlineOfEndedLifetime.signal.aborted) {
    throw new Error('Expected a deadline started after its lifetime ended never to arrive');
  }
});

Deno.test('TimerScheduler arrives a deadline asynchronously, even without a delay', async () => {
  const scheduler = new TimerScheduler(SYSTEM_MONOTONIC_CLOCK);
  const lifetime = new AbortController();
  try {
    const deadline = scheduler.deadline(0, lifetime.signal);
    if (deadline.signal.aborted || deadline.remainingMilliseconds() !== 0) {
      throw new Error('Expected a deadline without a delay to arrive only after starting');
    }
    await waitForAbort(deadline.signal);
  } finally {
    lifetime.abort();
  }
});

Deno.test('TimerScheduler sleeps for its delay, or until its signal aborts', async () => {
  const scheduler = new TimerScheduler(SYSTEM_MONOTONIC_CLOCK);
  const neverAborted = new AbortController().signal;
  const startedAt = performance.now();
  await scheduler.sleep(20, neverAborted);
  if (performance.now() - startedAt < 20) {
    throw new Error('Expected the sleep to last its whole delay');
  }

  const sleepEnd = new AbortController();
  const interruptedSleep = scheduler.sleep(10_000, sleepEnd.signal);
  sleepEnd.abort();
  // The test's sanitizer also fails it if the interrupted sleep kept its timer.
  await interruptedSleep;
  await scheduler.sleep(10_000, sleepEnd.signal);
});

/** A monotonic clock that reads whatever the test sets. */
class SettableMonotonicClock implements MonotonicClock {
  elapsed: number;

  constructor(elapsed: number) {
    this.elapsed = elapsed;
  }

  elapsedMilliseconds(): number {
    return this.elapsed;
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
