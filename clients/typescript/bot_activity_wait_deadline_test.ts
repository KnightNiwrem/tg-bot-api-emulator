import {
  type BotActivityPage,
  type BotActivityPageReader,
  type BotActivityPageRequest,
  type BotActivityWaitClock,
  createBotActivityLog,
} from './bot_activity_log.ts';
import {
  BotActivityTimeoutError,
  EmulationClientError,
  UnexpectedBotActivityError,
} from './mod.ts';
import type { BotActivityEntry, BotActivityLog, BotApiCallEntry } from './mod.ts';
import {
  assert,
  ManualWaitClock,
  rejectionOf,
  sendMessageCall,
} from './test_support/bot_activity_waits.ts';

// These tests answer a wait's page reads from a scripted page reader instead of the emulator, so
// that a read can hold, settle late, or fail at a known point. Waits measure their time on a
// manual clock, which moves only when a test advances it, so a read settles at a known time
// whatever the test runner's speed. How the HTTP page reader abandons a read its transport leaves
// unanswered is tested with it.

const READ_LIMIT = 1_000;
const RECORDED_READ_ALLOWANCE_MILLISECONDS = 1_000;
const MAX_TIMER_DELAY_MILLISECONDS = 2 ** 31 - 1;
const SHORT_TIMEOUT_MILLISECONDS = 10;
/** The URL the scripted reader's errors name, as an HTTP page reader's name the read's. */
const READ_URL = 'http://emulator.example/sessions/session/bot-activity';

Deno.test('A wait abandons a read that holds at its deadline', async () => {
  const clock = new ManualWaitClock();
  const pageReader = createScriptedPageReader(heldUntilAbandoned);

  const wait = rejectionOf(
    createActivityLog(pageReader, clock).waitFor({ method: 'sendMessage' }, {
      after: 0,
      timeoutMs: SHORT_TIMEOUT_MILLISECONDS,
    }),
  );
  await pageReader.untilReadsSent(1);
  clock.advance(SHORT_TIMEOUT_MILLISECONDS);
  clock.runDueCallbacks();
  const error = await wait;

  const [read] = pageReader.reads;
  assertTimeoutAbandoning(error, read);
  assert(
    read.request.waitMilliseconds === SHORT_TIMEOUT_MILLISECONDS,
    'Expected a read that holds for the whole wait',
  );
  assert(pageReader.reads.length === 1, 'Expected no read after the deadline');
  assert(clock.pendingCallbackCount === 0, "Expected the wait's timers to be stopped");
});

Deno.test('A wait counts a holding read only if it settles before the deadline, by the clock', async () => {
  const timeoutMs = 100;
  const lateAnswers = [
    { answer: () => page([sendMessageCall(1, 'match')], 1), failedStatus: undefined },
    { answer: () => failedRead(500), failedStatus: 500 },
  ];
  // The reader moves the clock without delivering timers, as one that blocks the event loop keeps
  // the deadline's timer from running until it settles.
  for (const { answer, failedStatus } of lateAnswers) {
    for (const elapsedMilliseconds of [timeoutMs - 1, timeoutMs, timeoutMs + 20]) {
      const clock = new ManualWaitClock();
      const pageReader = createScriptedPageReader(() => {
        clock.advance(elapsedMilliseconds);
        return answer();
      });

      const outcome = await outcomeOf(
        createActivityLog(pageReader, clock).waitFor({ method: 'sendMessage' }, {
          after: 0,
          timeoutMs,
        }),
      );

      const scenario = `${
        failedStatus === undefined ? 'a match' : `HTTP ${failedStatus}`
      } after ${elapsedMilliseconds} ms`;
      assert(
        pageReader.reads[0].request.waitMilliseconds === timeoutMs,
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
      const pageReader = createScriptedPageReader(...script(clock, elapsedMilliseconds));

      const outcome = await outcomeOf(
        createActivityLog(pageReader, clock).waitFor(filter, { after: 0, timeoutMs: 0 }),
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
  const clock = new ManualWaitClock();
  const pageReader = createScriptedPageReader(heldUntilAbandoned);
  const cursor = createActivityLog(pageReader, clock).cursor({ after: 0 });
  const cancellation = new AbortController();
  const reason = new Error('The test ended');

  const next = rejectionOf(cursor.next({ method: 'sendMessage' }, {
    timeoutMs: 60_000,
    signal: cancellation.signal,
  }));
  await pageReader.untilReadsSent(1);
  cancellation.abort(reason);

  assert(await next === reason, 'Expected the wait to reject with the cancellation reason');
  assert(pageReader.reads[0].signal?.aborted === true, 'Expected the read to be released');
  assert(cursor.position === 0, 'Expected a cancelled wait to leave the cursor in place');
  assert(clock.pendingCallbackCount === 0, "Expected the wait's timers to be stopped");
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
      const pageReader = createScriptedPageReader(...answers);
      const activity = createActivityLog(pageReader, clock);
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
      assert(pageReader.reads.length === answers.length, `Expected no further read, ${scenario}`);
      assert(cursor.position === 0, `Expected the cursor to stay in place, ${scenario}`);
      assert(clock.pendingCallbackCount === 0, `Expected the timers to be stopped, ${scenario}`);
    }
  }
});

Deno.test("A wait cancelled by its view's where predicate runs no other predicate", async () => {
  const clock = new ManualWaitClock();
  const pageReader = createScriptedPageReader(() => page([sendMessageCall(1, 'match')], 1));
  const cancellation = new AbortController();
  const reason = new Error('Cancelled while inspecting an entry');
  const activity = createBotActivityLog(
    pageReader,
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

Deno.test('A wait cancelled by a where predicate that then throws rejects with the reason', async () => {
  const clock = new ManualWaitClock();
  const pageReader = createScriptedPageReader(() => page([sendMessageCall(1, 'match')], 1));
  const cancellation = new AbortController();
  const reason = new Error('Cancelled while inspecting an entry');

  const outcome = await outcomeOf(
    createActivityLog(pageReader, clock).waitFor({
      method: 'sendMessage',
      where: () => {
        cancellation.abort(reason);
        throw new Error('Failed after cancelling');
      },
    }, { after: 0, timeoutMs: 60_000, signal: cancellation.signal }),
  );

  assert(
    'error' in outcome && outcome.error === reason,
    `Expected the cancellation reason, got ${describeOutcome(outcome)}`,
  );
  assert(clock.pendingCallbackCount === 0, "Expected the wait's timers to be stopped");
});

Deno.test('A read outlasts a timer that runs before its cutoff', async () => {
  const cases = [
    { kind: 'holding', timeoutMs: 10.9, cutoffMilliseconds: 10.9 },
    { kind: 'recorded', timeoutMs: 0, cutoffMilliseconds: RECORDED_READ_ALLOWANCE_MILLISECONDS },
  ];
  for (const { kind, timeoutMs, cutoffMilliseconds } of cases) {
    const clock = new ManualWaitClock();
    const pageReader = createScriptedPageReader(heldUntilAbandoned);

    const wait = rejectionOf(
      createActivityLog(pageReader, clock).waitFor({ method: 'sendMessage' }, {
        after: 0,
        timeoutMs,
      }),
    );
    await pageReader.untilReadsSent(1);
    // A native timer set for a fractional delay runs once its whole milliseconds are up.
    clock.advance(cutoffMilliseconds - 0.5);
    clock.runCallbacksEarly();

    const [read] = pageReader.reads;
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
  const pageReader = createScriptedPageReader(heldUntilAbandoned);
  const cancellation = new AbortController();

  const wait = rejectionOf(
    createActivityLog(pageReader, clock).waitFor({ method: 'sendMessage' }, {
      after: 0,
      timeoutMs: 10.9,
      signal: cancellation.signal,
    }),
  );
  await pageReader.untilReadsSent(1);
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
  const pageReader = createScriptedPageReader(heldUntilAbandoned);
  const cancellation = new AbortController();
  const reason = new Error('The test ended');

  const wait = rejectionOf(
    createActivityLog(pageReader, clock).waitFor({ method: 'sendMessage' }, {
      after: 0,
      timeoutMs: 10,
      signal: cancellation.signal,
    }),
  );
  await pageReader.untilReadsSent(1);
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
  const pageReader = createScriptedPageReader(heldUntilAbandoned);
  const timeoutMs = 2 ** 31;

  const wait = rejectionOf(
    createActivityLog(pageReader, clock).waitFor({}, { after: 0, timeoutMs }),
  );
  await pageReader.untilReadsSent(1);
  clock.advance(MAX_TIMER_DELAY_MILLISECONDS);
  clock.runDueCallbacks();

  const [read] = pageReader.reads;
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
  const pageReader = createScriptedPageReader();
  const reason = new Error('Cancelled before the wait');

  const error = await rejectionOf(
    createActivityLog(pageReader, clock).waitFor({}, {
      after: 0,
      signal: AbortSignal.abort(reason),
    }),
  );

  assert(error === reason, 'Expected the wait to reject with the cancellation reason');
  assert(pageReader.reads.length === 0, 'Expected no read');
  assert(clock.pendingCallbackCount === 0, "Expected the wait's timers to be stopped");
});

Deno.test('Concurrent waits on one log end at their own deadlines', async () => {
  const clock = new ManualWaitClock();
  const pageReader = createScriptedPageReader(heldUntilAbandoned, heldUntilAbandoned);
  const activity = createActivityLog(pageReader, clock);

  const shortWait = rejectionOf(
    activity.waitFor({ method: 'sendMessage' }, { after: 0, timeoutMs: 10 }),
  );
  const longWait = rejectionOf(
    activity.waitFor({ method: 'sendMessage' }, { after: 0, timeoutMs: 20 }),
  );
  await pageReader.untilReadsSent(2);
  clock.advance(10);
  clock.runDueCallbacks();

  const [shortRead, longRead] = pageReader.reads;
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

Deno.test('A wait with the system clock abandons a holding read only once its time is up', async () => {
  const timeoutMs = 10.9;
  let abandonedAt: number | undefined;
  const pageReader = createScriptedPageReader((read) => {
    read.signal?.addEventListener('abort', () => abandonedAt = performance.now());
    return heldUntilAbandoned(read);
  });

  const waitStart = performance.now();
  const error = await rejectionOf(
    createBotActivityLog(pageReader, undefined, {}).waitFor(
      { method: 'sendMessage' },
      { after: 0, timeoutMs },
    ),
  );

  // Whether the read holds depends on how long the runner takes to send it, so either kind is
  // abandoned, no sooner than the deadline.
  assertTimeoutAbandoning(error, pageReader.reads[0]);
  assert(
    abandonedAt !== undefined && abandonedAt - waitStart >= timeoutMs,
    `Expected the read to be abandoned no sooner than ${timeoutMs} ms, got ${
      abandonedAt === undefined ? 'none' : abandonedAt - waitStart
    }`,
  );
});

Deno.test('A wait of 0 ms reads once what is recorded', async () => {
  const buffered = createScriptedPageReader(() => page([sendMessageCall(2, 'A')], 2));
  const entry = await createActivityLog(buffered, new ManualWaitClock()).waitFor(
    { method: 'sendMessage' },
    { after: 1, timeoutMs: 0 },
  );
  assert(entry.position === 2, 'Expected the recorded entry');
  const { request } = buffered.reads[0];
  assert(
    request.after === 1 && request.waitMilliseconds === 0,
    'Expected a read that does not hold',
  );

  const empty = createScriptedPageReader(() => page([], 1));
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
  const pageReader = createScriptedPageReader(heldUntilAbandoned);

  const wait = rejectionOf(
    createActivityLog(pageReader, clock).waitFor({ method: 'sendMessage' }, {
      after: 0,
      timeoutMs: 0,
    }),
  );
  await pageReader.untilReadsSent(1);
  // The deadline's timer runs at once, and leaves a read of entries already recorded holding.
  clock.runDueCallbacks();
  const [read] = pageReader.reads;
  assert(read.signal?.aborted === false, 'Expected the read to outlast the deadline');
  clock.advance(RECORDED_READ_ALLOWANCE_MILLISECONDS);
  clock.runDueCallbacks();
  const error = await wait;

  assertTimeoutAbandoning(error, read);
  assert(read.request.waitMilliseconds === 0, 'Expected a read that does not hold');
});

Deno.test('A wait checks a full page up to the head it reports, even after the deadline', async () => {
  const pageReader = createScriptedPageReader(
    () => page(skippedCalls(1, READ_LIMIT), READ_LIMIT + 1),
    () => page([sendMessageCall(READ_LIMIT + 1, 'match')], READ_LIMIT + 1),
  );

  const entry = await createActivityLog(pageReader, new ManualWaitClock()).waitFor(
    { method: 'sendMessage', where: (call) => call.parameters.text === 'match' },
    { after: 0, timeoutMs: 0 },
  );

  assert(entry.position === READ_LIMIT + 1, 'Expected the match on the second page');
  const rest = pageReader.reads[1].request;
  assert(
    rest.after === READ_LIMIT && rest.before === READ_LIMIT + 2 &&
      rest.waitMilliseconds === undefined,
    `Expected the rest of the page to be read up to the head, got ${JSON.stringify(rest)}`,
  );
});

Deno.test('A wait skips rejected entries, holds again from the head, and moves a cursor', async () => {
  const clock = new ManualWaitClock();
  const pageReader = createScriptedPageReader(
    () => {
      clock.advance(1_000.4);
      return page([sendMessageCall(1, 'skip')], 3);
    },
    () => page([sendMessageCall(4, 'skip'), sendMessageCall(5, 'match')], 5),
    () => page([sendMessageCall(6, 'match')], 6),
  );
  const cursor = createActivityLog(pageReader, clock).cursor({ after: 0 });
  const filter = {
    method: 'sendMessage',
    where: (call: BotApiCallEntry) => call.parameters.text === 'match',
  };

  const first = await cursor.next(filter);
  const second = await cursor.next(filter);

  assert(first.position === 5 && second.position === 6, 'Expected the matches in order');
  assert(cursor.position === 6, 'Expected the cursor to move to the last match');
  const requests = pageReader.reads.map(({ request }) => request);
  assert(
    requests.map(({ after }) => after).join() === '0,3,5',
    'Expected each read to start after the head or the cursor',
  );
  // The read from the head holds for the whole milliseconds left of the first wait, rounded up.
  const waitMilliseconds = requests.map((request) => request.waitMilliseconds);
  assert(
    waitMilliseconds.join() === '5000,4000,5000',
    `Expected each read to hold for the time its wait has left, got ${waitMilliseconds}`,
  );
});

Deno.test('Reads take the criteria of a filter but not its where predicate', async () => {
  const filter = {
    method: 'sendMessage',
    where: (call: BotApiCallEntry) => call.parameters.text === 'match',
  };
  const pageReader = createScriptedPageReader(
    () => page(skippedCalls(1, READ_LIMIT), READ_LIMIT + 1),
    () => page([sendMessageCall(READ_LIMIT + 1, 'match')], READ_LIMIT + 1),
    () => page([], READ_LIMIT + 1),
  );
  const activity = createActivityLog(pageReader, new ManualWaitClock());

  await activity.waitFor(filter, { after: 0, timeoutMs: 0 });
  await activity.assertNone(filter, { after: READ_LIMIT + 1, before: READ_LIMIT + 2 });

  // A request a reader may clone or serialize holds no function.
  const requests = pageReader.reads.map(({ request }) => structuredClone(request));
  assert(
    requests.length === 3 &&
      requests.every(({ criteria }) => criteria.method === 'sendMessage' && !('where' in criteria)),
    `Expected criteria without a predicate, got ${JSON.stringify(requests)}`,
  );
});

Deno.test('assertNone reads a recorded range a page at a time', async () => {
  const pageReader = createScriptedPageReader(
    () => page(skippedCalls(1, READ_LIMIT), READ_LIMIT + 5),
    () => page([sendMessageCall(READ_LIMIT + 2, 'match')], READ_LIMIT + 5),
  );

  const error = await rejectionOf(
    createActivityLog(pageReader, new ManualWaitClock()).assertNone(
      { method: 'sendMessage', where: (call) => call.parameters.text === 'match' },
      { after: 0, before: READ_LIMIT + 3 },
    ),
  );

  assert(
    error instanceof UnexpectedBotActivityError && error.entries.length === 1 &&
      error.entries[0].position === READ_LIMIT + 2,
    `Expected the match on the second page, got ${error}`,
  );
  const rest = pageReader.reads[1].request;
  assert(
    rest.after === READ_LIMIT && rest.before === READ_LIMIT + 3,
    `Expected the second page to continue the range, got ${JSON.stringify(rest)}`,
  );
});

interface ScriptedRead {
  readonly request: BotActivityPageRequest;
  readonly signal?: AbortSignal;
}

type ScriptedAnswer = (read: ScriptedRead) => Promise<BotActivityPage>;

interface ScriptedPageReader extends BotActivityPageReader {
  readonly reads: readonly ScriptedRead[];
  /** Settles once the log has sent `count` reads, each already given its answer. */
  untilReadsSent(count: number): Promise<void>;
}

/** A page reader that answers each read with the next scripted answer and records the reads. */
function createScriptedPageReader(...answers: ScriptedAnswer[]): ScriptedPageReader {
  const reads: ScriptedRead[] = [];
  const readCountWaiters: { readonly count: number; readonly resolve: () => void }[] = [];
  const readPage = (request: BotActivityPageRequest, signal?: AbortSignal) => {
    const read = { request, signal };
    reads.push(read);
    for (const waiter of readCountWaiters.filter(({ count }) => count <= reads.length)) {
      waiter.resolve();
    }
    const answer = answers.shift();
    if (answer === undefined) {
      return Promise.reject(new Error(`Unexpected read: ${JSON.stringify(request)}`));
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
  return { readPage, reads, untilReadsSent };
}

function createActivityLog(
  pageReader: BotActivityPageReader,
  clock: BotActivityWaitClock,
): BotActivityLog {
  return createBotActivityLog(pageReader, undefined, {}, clock);
}

/**
 * A read that holds until the log abandons it, then fails as a page reader's abandoned read does:
 * with an `EmulationClientError` whose `cause` is the reason it was abandoned.
 */
function heldUntilAbandoned(read: ScriptedRead): Promise<BotActivityPage> {
  return new Promise((_resolve, reject) => {
    read.signal?.addEventListener('abort', () =>
      reject(
        new EmulationClientError('GET bot activity was abandoned', {
          method: 'GET',
          url: READ_URL,
        }, { cause: read.signal?.reason }),
      ));
  });
}

function failedRead(status: number): Promise<BotActivityPage> {
  return Promise.reject(
    new EmulationClientError(`GET bot activity returned ${status}`, {
      method: 'GET',
      url: READ_URL,
      status,
    }),
  );
}

function page(
  entries: readonly BotActivityEntry[],
  headPosition: number,
): Promise<BotActivityPage> {
  return Promise.resolve({ entries, headPosition });
}

function skippedCalls(firstPosition: number, count: number): BotApiCallEntry[] {
  return Array.from(
    { length: count },
    (_, index) => sendMessageCall(firstPosition + index, 'skip'),
  );
}

/** Checks that a wait timed out naming the read it abandoned for the wait's time. */
function assertTimeoutAbandoning(
  error: unknown,
  read: ScriptedRead,
): asserts error is BotActivityTimeoutError {
  assert(error instanceof BotActivityTimeoutError, `Expected a timeout, got ${error}`);
  const abandonedRead = error.cause;
  assert(
    abandonedRead instanceof EmulationClientError && read.signal?.aborted === true &&
      abandonedRead.cause === read.signal.reason,
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
