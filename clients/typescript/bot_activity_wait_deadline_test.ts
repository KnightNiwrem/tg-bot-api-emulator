import { type BotActivityWaitClock, createBotActivityLog } from './bot_activity_log.ts';
import {
  BotActivityTimeoutError,
  EmulationClientError,
  UnexpectedBotActivityError,
} from './mod.ts';
import type { BotActivityEntry, BotActivityLog, BotApiCallEntry } from './mod.ts';

// These tests answer the client's activity reads from a scripted transport instead of a server, so
// that a read can stall, or be answered only once the client has abandoned it, at a known point.
// Waits measure their time on a manual clock, which moves only when a test advances it, so a read
// settles at a known time whatever the test runner's speed.

const ACTIVITY_URL = 'http://emulator.example/sessions/session/bot-activity';
const READ_LIMIT = 1_000;
const RECORDED_READ_ALLOWANCE_MILLISECONDS = 1_000;
const MAX_TIMER_DELAY_MILLISECONDS = 2 ** 31 - 1;
const SHORT_TIMEOUT_MILLISECONDS = 10;

Deno.test('A wait abandons a read its transport leaves unanswered at the deadline', async () => {
  for (const unanswered of [neverAnswered, rejectedWhenAbandoned]) {
    const clock = new ManualWaitClock();
    const transport = createScriptedTransport(unanswered);

    const wait = startShortWait(transport, clock);
    await transport.untilReadsSent(1);
    endShortWait(clock);
    const error = await wait;

    const [read] = transport.reads;
    assertTimeoutAbandoning(error, read);
    assert(
      read.query.get('wait_ms') === String(SHORT_TIMEOUT_MILLISECONDS),
      'Expected a read that holds for the whole wait',
    );
    assert(read.signal?.aborted === true, 'Expected the transport to be told to release the read');
    assert(transport.reads.length === 1, 'Expected no read after the deadline');
    assert(clock.pendingCallbackCount === 0, "Expected the wait's timers to be stopped");
  }
});

Deno.test('A wait abandons a response body that stalls at the deadline and cancels it', async () => {
  const bodyCancellations = [() => {}, () => new Promise<void>(() => {})];
  for (const cancelBody of bodyCancellations) {
    const clock = new ManualWaitClock();
    const bodyReadStarted = Promise.withResolvers<void>();
    let cancelledBodies = 0;
    const stalledBody = new ReadableStream({
      pull: () => {
        bodyReadStarted.resolve();
        return new Promise<void>(() => {});
      },
      cancel: () => {
        cancelledBodies++;
        return cancelBody();
      },
    }, { highWaterMark: 0 });
    const transport = createScriptedTransport(() =>
      Promise.resolve(new Response(stalledBody, { status: 200 }))
    );

    const wait = startShortWait(transport, clock);
    await bodyReadStarted.promise;
    endShortWait(clock);
    const error = await wait;

    assertTimeoutAbandoning(error, transport.reads[0]);
    assert(cancelledBodies === 1, 'Expected the stalled body to be cancelled');
  }
});

Deno.test('A wait does not count an answer received after its deadline, and cancels its body', async () => {
  const clock = new ManualWaitClock();
  const lateBodyCancelled = Promise.withResolvers<void>();
  const transport = createScriptedTransport((read) =>
    new Promise((resolve) => {
      // The transport ignores the abandonment, and answers with a match right after it.
      read.signal?.addEventListener('abort', () => {
        const lateBody = new ReadableStream({
          start: (controller) => {
            const answer = { entries: [sendMessageCall(1, 'late')], head_position: 1 };
            controller.enqueue(new TextEncoder().encode(JSON.stringify(answer)));
          },
          cancel: () => lateBodyCancelled.resolve(),
        });
        resolve(new Response(lateBody, { status: 200 }));
      });
    })
  );

  const wait = startShortWait(transport, clock);
  await transport.untilReadsSent(1);
  endShortWait(clock);
  const error = await wait;

  assertTimeoutAbandoning(error, transport.reads[0]);
  await lateBodyCancelled.promise;
});

Deno.test('A wait counts a holding read only if it settles before the deadline, by the clock', async () => {
  const timeoutMs = 100;
  const lateAnswers = [
    { answer: () => page([sendMessageCall(1, 'match')], 1), failedStatus: undefined },
    { answer: () => Promise.resolve(new Response(null, { status: 500 })), failedStatus: 500 },
  ];
  // The transport moves the clock without delivering timers, as one that blocks the event loop
  // keeps the deadline's timer from running until it settles.
  for (const { answer, failedStatus } of lateAnswers) {
    for (const elapsedMilliseconds of [timeoutMs - 1, timeoutMs, timeoutMs + 20]) {
      const clock = new ManualWaitClock();
      const transport = createScriptedTransport(() => {
        clock.advance(elapsedMilliseconds);
        return answer();
      });

      const outcome = await outcomeOf(
        createActivityLog(transport, clock).waitFor({ method: 'sendMessage' }, {
          after: 0,
          timeoutMs,
        }),
      );

      const scenario = `${
        failedStatus === undefined ? 'a match' : `HTTP ${failedStatus}`
      } after ${elapsedMilliseconds} ms`;
      assert(
        transport.reads[0].query.get('wait_ms') === String(timeoutMs),
        `Expected a read that holds, for ${scenario}`,
      );
      if (elapsedMilliseconds >= timeoutMs) {
        assertTimeoutFromLateRead(outcome, failedStatus, scenario);
      } else if (failedStatus === undefined) {
        assert(
          'entry' in outcome && outcome.entry.position === 1,
          `Expected the match, for ${scenario}, got ${describeOutcome(outcome)}`,
        );
      } else {
        assert(
          'error' in outcome && outcome.error instanceof EmulationClientError &&
            outcome.error.status === failedStatus,
          `Expected the read's failure, for ${scenario}, got ${describeOutcome(outcome)}`,
        );
      }
    }
  }
});

Deno.test('A wait counts recorded reads only if they settle within one allowance after the deadline', async () => {
  const filter = {
    method: 'sendMessage',
    where: (call: BotApiCallEntry) => call.parameters.text === 'match',
  };
  const scripts = [
    // The single read of a wait of 0 ms.
    (clock: ManualWaitClock, elapsedMilliseconds: number) => [() => {
      clock.advance(elapsedMilliseconds);
      return page([sendMessageCall(1, 'match')], 1);
    }],
    // The read of the entries after a full page, which shares the allowance with the full page.
    (clock: ManualWaitClock, elapsedMilliseconds: number) => [
      () => {
        clock.advance(elapsedMilliseconds / 2);
        return page(skippedCalls(1, READ_LIMIT), READ_LIMIT + 1);
      },
      () => {
        clock.advance(elapsedMilliseconds / 2);
        return page([sendMessageCall(READ_LIMIT + 1, 'match')], READ_LIMIT + 1);
      },
    ],
  ];
  const allowance = RECORDED_READ_ALLOWANCE_MILLISECONDS;
  for (const [scriptIndex, script] of scripts.entries()) {
    for (const elapsedMilliseconds of [allowance - 2, allowance, allowance + 20]) {
      const clock = new ManualWaitClock();
      const transport = createScriptedTransport(...script(clock, elapsedMilliseconds));

      const outcome = await outcomeOf(
        createActivityLog(transport, clock).waitFor(filter, { after: 0, timeoutMs: 0 }),
      );

      const scenario = `script ${scriptIndex} after ${elapsedMilliseconds} ms`;
      if (elapsedMilliseconds >= allowance) {
        assertTimeoutFromLateRead(outcome, undefined, scenario);
      } else {
        assert(
          'entry' in outcome,
          `Expected the match, for ${scenario}, got ${describeOutcome(outcome)}`,
        );
      }
    }
  }
});

Deno.test('A cancelled wait rejects with the reason and releases its read', async () => {
  for (const unanswered of [neverAnswered, rejectedWhenAbandoned]) {
    const clock = new ManualWaitClock();
    const transport = createScriptedTransport(unanswered);
    const cursor = createActivityLog(transport, clock).cursor({ after: 0 });
    const cancellation = new AbortController();
    const reason = new Error('The test ended');

    const next = rejectionOf(cursor.next({ method: 'sendMessage' }, {
      timeoutMs: 60_000,
      signal: cancellation.signal,
    }));
    await transport.untilReadsSent(1);
    cancellation.abort(reason);

    assert(await next === reason, 'Expected the wait to reject with the cancellation reason');
    assert(transport.reads[0].signal?.aborted === true, 'Expected the read to be released');
    assert(cursor.position === 0, 'Expected a cancelled wait to leave the cursor in place');
    assert(clock.pendingCallbackCount === 0, "Expected the wait's timers to be stopped");
  }
});

Deno.test('A wait cancelled by its where predicate rejects with the reason', async () => {
  const scenarios = [
    {
      description: 'accepting an entry',
      abortingText: 'match',
      answers: [() => page([sendMessageCall(1, 'match')], 1)],
    },
    {
      description: 'rejecting an entry before a match',
      abortingText: 'skip',
      answers: [() => page([sendMessageCall(1, 'skip'), sendMessageCall(2, 'match')], 2)],
    },
    {
      description: 'accepting an entry on the page after a full one',
      abortingText: 'match',
      answers: [
        () => page(skippedCalls(1, READ_LIMIT), READ_LIMIT + 1),
        () => page([sendMessageCall(READ_LIMIT + 1, 'match')], READ_LIMIT + 1),
      ],
    },
  ];
  for (const { description, abortingText, answers } of scenarios) {
    for (const waiter of ['waitFor', 'cursor'] as const) {
      const clock = new ManualWaitClock();
      const transport = createScriptedTransport(...answers);
      const activity = createActivityLog(transport, clock);
      const cursor = activity.cursor({ after: 0 });
      const cancellation = new AbortController();
      const reason = new Error('Cancelled while inspecting an entry');
      let entriesInspectedAfterCancellation = 0;
      const filter = {
        method: 'sendMessage',
        where: (call: BotApiCallEntry) => {
          if (cancellation.signal.aborted) {
            entriesInspectedAfterCancellation++;
          } else if (call.parameters.text === abortingText) {
            cancellation.abort(reason);
          }
          return call.parameters.text === 'match';
        },
      };
      const options = { timeoutMs: 60_000, signal: cancellation.signal };

      const outcome = await outcomeOf(
        waiter === 'cursor'
          ? cursor.next(filter, options)
          : activity.waitFor(filter, { ...options, after: 0 }),
      );

      const scenario = `${description}, with ${waiter}`;
      assert(
        'error' in outcome && outcome.error === reason,
        `Expected the cancellation reason, ${scenario}, got ${describeOutcome(outcome)}`,
      );
      assert(entriesInspectedAfterCancellation === 0, `Expected no entry inspected, ${scenario}`);
      assert(transport.reads.length === answers.length, `Expected no further read, ${scenario}`);
      assert(cursor.position === 0, `Expected the cursor to stay in place, ${scenario}`);
      assert(clock.pendingCallbackCount === 0, `Expected the timers to be stopped, ${scenario}`);
    }
  }
});

Deno.test("A wait cancelled by its view's where predicate runs no other predicate", async () => {
  const clock = new ManualWaitClock();
  const transport = createScriptedTransport(() => page([sendMessageCall(1, 'match')], 1));
  const cancellation = new AbortController();
  const reason = new Error('Cancelled while inspecting an entry');
  const activity = createBotActivityLog(
    ACTIVITY_URL,
    transport.fetch,
    {
      where: () => {
        cancellation.abort(reason);
        return true;
      },
    },
    {},
    clock,
  );
  let readPredicateCalls = 0;

  const outcome = await outcomeOf(activity.waitFor({
    method: 'sendMessage',
    where: () => {
      readPredicateCalls++;
      throw new Error('Inspected after cancellation');
    },
  }, { after: 0, timeoutMs: 60_000, signal: cancellation.signal }));

  assert(
    'error' in outcome && outcome.error === reason,
    `Expected the cancellation reason, got ${describeOutcome(outcome)}`,
  );
  assert(readPredicateCalls === 0, "Expected the read's predicate not to run");
  assert(clock.pendingCallbackCount === 0, "Expected the wait's timers to be stopped");
});

Deno.test('A read outlasts a timer that runs before its cutoff', async () => {
  const cases = [
    { kind: 'holding', timeoutMs: 10.9, cutoffMilliseconds: 10.9 },
    { kind: 'recorded', timeoutMs: 0, cutoffMilliseconds: RECORDED_READ_ALLOWANCE_MILLISECONDS },
  ];
  for (const { kind, timeoutMs, cutoffMilliseconds } of cases) {
    const clock = new ManualWaitClock();
    const transport = createScriptedTransport(neverAnswered);

    const wait = rejectionOf(
      createActivityLog(transport, clock).waitFor({ method: 'sendMessage' }, {
        after: 0,
        timeoutMs,
      }),
    );
    await transport.untilReadsSent(1);
    // A native timer set for a fractional delay runs once its whole milliseconds are up.
    clock.advance(cutoffMilliseconds - 0.5);
    clock.runCallbacksEarly();

    const [read] = transport.reads;
    assert(read.signal?.aborted === false, `Expected the ${kind} read to hold until its cutoff`);
    // The timer that replaced it is due a whole millisecond later, but one that runs exactly at the
    // cutoff ends the read.
    clock.advance(0.5);
    clock.runCallbacksEarly();
    assertTimeoutAbandoning(await wait, read);
    assert(clock.pendingCallbackCount === 0, "Expected the wait's timers to be stopped");
  }
});

Deno.test('A wait rounds the delays of its timers up to whole milliseconds', async () => {
  const clock = new ManualWaitClock();
  const transport = createScriptedTransport(neverAnswered);
  const cancellation = new AbortController();

  const wait = rejectionOf(
    createActivityLog(transport, clock).waitFor({ method: 'sendMessage' }, {
      after: 0,
      timeoutMs: 10.9,
      signal: cancellation.signal,
    }),
  );
  await transport.untilReadsSent(1);
  clock.advance(10.5);
  clock.runCallbacksEarly();
  cancellation.abort(new Error('The test ended'));
  await wait;

  // The deadline's and the allowance's, then again for the time each had left.
  assert(
    clock.scheduledDelays.join() === '11,1011,1,1001',
    `Expected delays rounded up, got ${clock.scheduledDelays}`,
  );
});

Deno.test('A wait cancelled after its timers ran early stops the timers that replaced them', async () => {
  const clock = new ManualWaitClock();
  const transport = createScriptedTransport(rejectedWhenAbandoned);
  const cancellation = new AbortController();
  const reason = new Error('The test ended');

  const wait = rejectionOf(
    createActivityLog(transport, clock).waitFor({ method: 'sendMessage' }, {
      after: 0,
      timeoutMs: 10,
      signal: cancellation.signal,
    }),
  );
  await transport.untilReadsSent(1);
  clock.advance(5);
  clock.runCallbacksEarly();
  const replacementTimerCount = clock.pendingCallbackCount;
  cancellation.abort(reason);

  assert(await wait === reason, 'Expected the wait to reject with the cancellation reason');
  assert(replacementTimerCount === 2, 'Expected the timers that ran early to be replaced');
  assert(clock.pendingCallbackCount === 0, 'Expected the replacement timers to be stopped');
});

Deno.test('A wait longer than a timer can hold lasts until its deadline', async () => {
  const clock = new ManualWaitClock();
  const transport = createScriptedTransport(neverAnswered);
  const timeoutMs = 2 ** 31;

  const wait = rejectionOf(
    createActivityLog(transport, clock).waitFor({}, { after: 0, timeoutMs }),
  );
  await transport.untilReadsSent(1);
  clock.advance(MAX_TIMER_DELAY_MILLISECONDS);
  clock.runDueCallbacks();

  const [read] = transport.reads;
  assert(read.signal?.aborted === false, 'Expected the read to hold past the longest timer');
  assert(
    clock.scheduledDelays.every((delay) => delay <= MAX_TIMER_DELAY_MILLISECONDS),
    `Expected delays a timer keeps, got ${clock.scheduledDelays}`,
  );
  clock.advance(timeoutMs - MAX_TIMER_DELAY_MILLISECONDS);
  clock.runDueCallbacks();
  assertTimeoutAbandoning(await wait, read);
});

Deno.test('A wait whose signal has already aborted sends no read', async () => {
  const clock = new ManualWaitClock();
  const transport = createScriptedTransport();
  const reason = new Error('Cancelled before the wait');

  const error = await rejectionOf(
    createActivityLog(transport, clock).waitFor({}, {
      after: 0,
      signal: AbortSignal.abort(reason),
    }),
  );

  assert(error === reason, 'Expected the wait to reject with the cancellation reason');
  assert(transport.reads.length === 0, 'Expected no read');
  assert(clock.pendingCallbackCount === 0, "Expected the wait's timers to be stopped");
});

Deno.test('Concurrent waits on one log end at their own deadlines', async () => {
  const clock = new ManualWaitClock();
  const transport = createScriptedTransport(rejectedWhenAbandoned, rejectedWhenAbandoned);
  const activity = createActivityLog(transport, clock);

  const shortWait = rejectionOf(
    activity.waitFor({ method: 'sendMessage' }, { after: 0, timeoutMs: 10 }),
  );
  const longWait = rejectionOf(
    activity.waitFor({ method: 'sendMessage' }, { after: 0, timeoutMs: 20 }),
  );
  await transport.untilReadsSent(2);
  clock.advance(10);
  clock.runDueCallbacks();

  const [shortRead, longRead] = transport.reads;
  assert(shortRead.signal?.aborted === true, "Expected the short wait's read to be released");
  assert(longRead.signal?.aborted === false, "Expected the long wait's read to keep holding");
  const shortError = await shortWait;
  assertTimeoutAbandoning(shortError, shortRead);

  clock.advance(10);
  clock.runDueCallbacks();
  const longError = await longWait;
  assertTimeoutAbandoning(longError, longRead);
  assert(
    shortError.timeoutMs === 10 && longError.timeoutMs === 20,
    'Expected each timeout to report its own wait',
  );
});

Deno.test('A wait with the system clock abandons an unanswered read only once its time is up', async () => {
  const timeoutMs = 10.9;
  let abandonedAt: number | undefined;
  const transport = createScriptedTransport((read) => {
    read.signal?.addEventListener('abort', () => abandonedAt = performance.now());
    return neverAnswered();
  });

  const waitStart = performance.now();
  const error = await rejectionOf(
    createBotActivityLog(ACTIVITY_URL, transport.fetch, undefined, {}).waitFor(
      { method: 'sendMessage' },
      { after: 0, timeoutMs },
    ),
  );

  // Whether the read holds depends on how long the runner takes to send it, so either kind is
  // abandoned, no sooner than the deadline.
  assertTimeoutAbandoning(error, transport.reads[0]);
  assert(
    abandonedAt !== undefined && abandonedAt - waitStart >= timeoutMs,
    `Expected the read to be abandoned no sooner than ${timeoutMs} ms, got ${
      abandonedAt === undefined ? 'none' : abandonedAt - waitStart
    }`,
  );
});

Deno.test('A wait of 0 ms reads once what is recorded', async () => {
  const buffered = createScriptedTransport(() => page([sendMessageCall(2, 'A')], 2));
  const entry = await createActivityLog(buffered, new ManualWaitClock()).waitFor(
    { method: 'sendMessage' },
    { after: 1, timeoutMs: 0 },
  );
  assert(entry.position === 2, 'Expected the recorded entry');
  assert(
    buffered.reads[0].query.get('after') === '1' && buffered.reads[0].query.get('wait_ms') === '0',
    'Expected a read that does not hold',
  );

  const empty = createScriptedTransport(() => page([], 1));
  const error = await rejectionOf(
    createActivityLog(empty, new ManualWaitClock()).waitFor({ method: 'sendMessage' }, {
      after: 1,
      timeoutMs: 0,
    }),
  );
  assert(
    error instanceof BotActivityTimeoutError && error.cause === undefined,
    `Expected a timeout without an abandoned read, got ${error}`,
  );
  assert(empty.reads.length === 1, 'Expected a single read');
});

Deno.test('A wait of 0 ms abandons its read once the allowance after the deadline is up', async () => {
  const clock = new ManualWaitClock();
  const transport = createScriptedTransport(neverAnswered);

  const wait = rejectionOf(
    createActivityLog(transport, clock).waitFor({ method: 'sendMessage' }, {
      after: 0,
      timeoutMs: 0,
    }),
  );
  await transport.untilReadsSent(1);
  // The deadline's timer runs at once, and leaves a read of entries already recorded holding.
  clock.runDueCallbacks();
  assert(transport.reads[0].signal?.aborted === false, 'Expected the read to outlast the deadline');
  clock.advance(RECORDED_READ_ALLOWANCE_MILLISECONDS);
  clock.runDueCallbacks();
  const error = await wait;

  assertTimeoutAbandoning(error, transport.reads[0]);
  assert(transport.reads[0].query.get('wait_ms') === '0', 'Expected a read that does not hold');
});

Deno.test('A wait checks a full page up to the head it reports, even after the deadline', async () => {
  const transport = createScriptedTransport(
    () => page(skippedCalls(1, READ_LIMIT), READ_LIMIT + 1),
    () => page([sendMessageCall(READ_LIMIT + 1, 'match')], READ_LIMIT + 1),
  );

  const entry = await createActivityLog(transport, new ManualWaitClock()).waitFor(
    { method: 'sendMessage', where: (call) => call.parameters.text === 'match' },
    { after: 0, timeoutMs: 0 },
  );

  assert(entry.position === READ_LIMIT + 1, 'Expected the match on the second page');
  const rest = transport.reads[1].query;
  assert(
    rest.get('after') === String(READ_LIMIT) && rest.get('before') === String(READ_LIMIT + 2) &&
      !rest.has('wait_ms'),
    `Expected the rest of the page to be read up to the head, got ${rest}`,
  );
});

Deno.test('A wait skips rejected entries, holds again from the head, and moves a cursor', async () => {
  const clock = new ManualWaitClock();
  const transport = createScriptedTransport(
    () => {
      clock.advance(1_000.4);
      return page([sendMessageCall(1, 'skip')], 3);
    },
    () => page([sendMessageCall(4, 'skip'), sendMessageCall(5, 'match')], 5),
    () => page([sendMessageCall(6, 'match')], 6),
  );
  const cursor = createActivityLog(transport, clock).cursor({ after: 0 });
  const filter = {
    method: 'sendMessage',
    where: (call: BotApiCallEntry) => call.parameters.text === 'match',
  };

  const first = await cursor.next(filter);
  const second = await cursor.next(filter);

  assert(first.position === 5 && second.position === 6, 'Expected the matches in order');
  assert(cursor.position === 6, 'Expected the cursor to move to the last match');
  const [afterStart, afterHead, afterFirst] = transport.reads.map(({ query }) => query);
  assert(
    afterStart.get('after') === '0' && afterHead.get('after') === '3' &&
      afterFirst.get('after') === '5',
    'Expected each read to start after the head or the cursor',
  );
  // The read from the head holds for the whole milliseconds left of the first wait, rounded up.
  const waitMilliseconds = transport.reads.map(({ query }) => query.get('wait_ms'));
  assert(
    waitMilliseconds.join() === '5000,4000,5000',
    `Expected each read to hold for the time its wait has left, got ${waitMilliseconds}`,
  );
});

Deno.test('assertNone reads a recorded range a page at a time', async () => {
  const transport = createScriptedTransport(
    () => page(skippedCalls(1, READ_LIMIT), READ_LIMIT + 5),
    () => page([sendMessageCall(READ_LIMIT + 2, 'match')], READ_LIMIT + 5),
  );

  const error = await rejectionOf(
    createActivityLog(transport, new ManualWaitClock()).assertNone(
      { method: 'sendMessage', where: (call) => call.parameters.text === 'match' },
      { after: 0, before: READ_LIMIT + 3 },
    ),
  );

  assert(
    error instanceof UnexpectedBotActivityError && error.entries.length === 1 &&
      error.entries[0].position === READ_LIMIT + 2,
    `Expected the match on the second page, got ${error}`,
  );
  const rest = transport.reads[1].query;
  assert(
    rest.get('after') === String(READ_LIMIT) && rest.get('before') === String(READ_LIMIT + 3),
    `Expected the second page to continue the range, got ${rest}`,
  );
});

interface ScheduledCallback {
  readonly dueAt: number;
  readonly callback: () => void;
}

/**
 * A wait clock whose time moves only when a test advances it, and whose callbacks run only when the
 * test delivers them, as a busy event loop keeps native timers from running when they are due.
 */
class ManualWaitClock implements BotActivityWaitClock {
  #now = 0;
  readonly #pendingCallbacks = new Set<ScheduledCallback>();
  /** The delay of each callback scheduled, in order. */
  readonly scheduledDelays: number[] = [];

  now(): number {
    return this.#now;
  }

  schedule(callback: () => void, delayMilliseconds: number): () => void {
    this.scheduledDelays.push(delayMilliseconds);
    const scheduled = { dueAt: this.#now + delayMilliseconds, callback };
    this.#pendingCallbacks.add(scheduled);
    return () => void this.#pendingCallbacks.delete(scheduled);
  }

  get pendingCallbackCount(): number {
    return this.#pendingCallbacks.size;
  }

  /** Moves time forward without running the callbacks that come due. */
  advance(milliseconds: number): void {
    this.#now += milliseconds;
  }

  /**
   * Runs every pending callback, even one not yet due, as a native timer may run before the time
   * it was set for. Callbacks they schedule stay pending.
   */
  runCallbacksEarly(): void {
    const pendingCallbacks = [...this.#pendingCallbacks];
    this.#pendingCallbacks.clear();
    for (const { callback } of pendingCallbacks) {
      callback();
    }
  }

  /** Runs the callbacks that are due, earliest first. */
  runDueCallbacks(): void {
    for (;;) {
      const [earliestDue] = [...this.#pendingCallbacks]
        .filter(({ dueAt }) => dueAt <= this.#now)
        .sort((first, second) => first.dueAt - second.dueAt);
      if (earliestDue === undefined) {
        return;
      }
      this.#pendingCallbacks.delete(earliestDue);
      earliestDue.callback();
    }
  }
}

interface ScriptedRead {
  readonly url: string;
  readonly query: URLSearchParams;
  readonly signal?: AbortSignal;
}

type ScriptedAnswer = (read: ScriptedRead) => Promise<Response>;

interface ScriptedTransport {
  readonly fetch: typeof globalThis.fetch;
  readonly reads: readonly ScriptedRead[];
  /** Settles once the client has sent `count` reads, each already given its answer. */
  untilReadsSent(count: number): Promise<void>;
}

/** A transport that answers each read with the next scripted answer and records the reads. */
function createScriptedTransport(...answers: ScriptedAnswer[]): ScriptedTransport {
  const reads: ScriptedRead[] = [];
  const readCountWaiters: { readonly count: number; readonly resolve: () => void }[] = [];
  const fetch: typeof globalThis.fetch = (input, init) => {
    const url = String(input);
    const read = { url, query: new URL(url).searchParams, signal: init?.signal ?? undefined };
    reads.push(read);
    for (const waiter of readCountWaiters.filter(({ count }) => count <= reads.length)) {
      waiter.resolve();
    }
    const answer = answers.shift();
    if (answer === undefined) {
      throw new Error(`Unexpected read: ${read.query}`);
    }
    return answer(read);
  };
  const untilReadsSent = (count: number) => {
    if (count <= reads.length) {
      return Promise.resolve();
    }
    const { promise, resolve } = Promise.withResolvers<void>();
    readCountWaiters.push({ count, resolve });
    return promise;
  };
  return { fetch, reads, untilReadsSent };
}

function createActivityLog(
  transport: ScriptedTransport,
  clock: BotActivityWaitClock,
): BotActivityLog {
  return createBotActivityLog(ACTIVITY_URL, transport.fetch, undefined, {}, clock);
}

/** Starts a short wait for a sendMessage call, and returns the error the wait fails with. */
function startShortWait(transport: ScriptedTransport, clock: ManualWaitClock): Promise<unknown> {
  return rejectionOf(
    createActivityLog(transport, clock).waitFor({ method: 'sendMessage' }, {
      after: 0,
      timeoutMs: SHORT_TIMEOUT_MILLISECONDS,
    }),
  );
}

/** Moves the clock to a short wait's deadline, and runs the timer that ends it. */
function endShortWait(clock: ManualWaitClock): void {
  clock.advance(SHORT_TIMEOUT_MILLISECONDS);
  clock.runDueCallbacks();
}

/** A transport that never answers, whatever its signal does. */
function neverAnswered(): Promise<Response> {
  return new Promise(() => {});
}

/** A transport that answers only by failing once the client abandons the read, as `fetch` does. */
function rejectedWhenAbandoned(read: ScriptedRead): Promise<Response> {
  return new Promise((_resolve, reject) => {
    read.signal?.addEventListener('abort', () => reject(read.signal?.reason));
  });
}

function page(entries: readonly BotApiCallEntry[], headPosition: number): Promise<Response> {
  return Promise.resolve(Response.json({ entries, head_position: headPosition }));
}

function sendMessageCall(position: number, text: string): BotApiCallEntry {
  return {
    position,
    kind: 'bot_api_call',
    bot_id: 1001,
    method: 'sendMessage',
    requested_method: 'sendMessage',
    via: 'http',
    parameters: { text },
    uploaded_files: [],
    chat_id: 2002,
    answer: { ok: true, result: true },
  };
}

function skippedCalls(firstPosition: number, count: number): BotApiCallEntry[] {
  return Array.from(
    { length: count },
    (_, index) => sendMessageCall(firstPosition + index, 'skip'),
  );
}

function assertTimeoutAbandoning(
  error: unknown,
  read: ScriptedRead,
): asserts error is BotActivityTimeoutError {
  assert(error instanceof BotActivityTimeoutError, `Expected a timeout, got ${error}`);
  const abandonedRead = error.cause;
  assert(
    abandonedRead instanceof EmulationClientError && abandonedRead.method === 'GET' &&
      abandonedRead.url === read.url,
    `Expected the timeout to name the abandoned read, got ${abandonedRead}`,
  );
  assert(
    abandonedRead.cause instanceof DOMException && abandonedRead.cause.name === 'TimeoutError',
    `Expected the read to be abandoned for the wait's time, got ${abandonedRead.cause}`,
  );
}

/**
 * Checks that a wait timed out because a read settled after its cutoff: one answered, with no
 * cause, or one that failed with the status, as the cause.
 */
function assertTimeoutFromLateRead(
  outcome: WaitOutcome,
  failedStatus: number | undefined,
  scenario: string,
): void {
  assert(
    'error' in outcome && outcome.error instanceof BotActivityTimeoutError,
    `Expected a timeout, for ${scenario}, got ${describeOutcome(outcome)}`,
  );
  const lateRead = outcome.error.cause;
  assert(
    failedStatus === undefined
      ? lateRead === undefined
      : lateRead instanceof EmulationClientError && lateRead.status === failedStatus,
    `Expected the timeout to name only a failed read, for ${scenario}, got ${lateRead}`,
  );
}

/** The entry a wait found, or the error it failed with. */
type WaitOutcome = { readonly entry: BotActivityEntry } | { readonly error: unknown };

async function outcomeOf(wait: Promise<BotActivityEntry>): Promise<WaitOutcome> {
  try {
    return { entry: await wait };
  } catch (error) {
    return { error };
  }
}

function describeOutcome(outcome: WaitOutcome): string {
  return 'entry' in outcome ? `entry ${outcome.entry.position}` : String(outcome.error);
}

async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('Expected a rejection');
}

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}
