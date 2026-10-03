import { createBotActivityLog } from './bot_activity_log.ts';
import {
  BotActivityTimeoutError,
  EmulationClientError,
  UnexpectedBotActivityError,
} from './mod.ts';
import type { BotActivityLog, BotApiCallEntry } from './mod.ts';

// These tests answer the client's activity reads from a scripted transport instead of a server, so
// that a read can stall, or be answered only once the client has abandoned it, at a known point.

const ACTIVITY_URL = 'http://emulator.example/sessions/session/bot-activity';
const READ_LIMIT = 1_000;

Deno.test('A wait abandons a read its transport leaves unanswered at the deadline', async () => {
  for (const unanswered of [neverAnswered, rejectedWhenAbandoned]) {
    const transport = createScriptedTransport(unanswered);

    const error = await rejectionOfShortWait(transport);

    const [read] = transport.reads;
    assertTimeoutAbandoning(error, read);
    assert(Number(read.query.get('wait_ms')) > 0, 'Expected a read that holds');
    assert(read.signal?.aborted === true, 'Expected the transport to be told to release the read');
    assert(transport.reads.length === 1, 'Expected no read after the deadline');
  }
});

Deno.test('A wait abandons a response body that stalls at the deadline and cancels it', async () => {
  let cancelledBodies = 0;
  const transport = createScriptedTransport(() =>
    Promise.resolve(
      new Response(new ReadableStream({ cancel: () => void cancelledBodies++ }), { status: 200 }),
    )
  );

  const error = await rejectionOfShortWait(transport);

  assertTimeoutAbandoning(error, transport.reads[0]);
  assert(cancelledBodies === 1, 'Expected the stalled body to be cancelled');
});

Deno.test('A wait does not count an answer received after its deadline', async () => {
  const transport = createScriptedTransport((read) =>
    new Promise((resolve) => {
      // The transport ignores the abandonment, and answers with a match right after it.
      read.signal?.addEventListener('abort', () => resolve(page([sendMessageCall(1, 'late')], 1)));
    })
  );

  const error = await rejectionOfShortWait(transport);

  assertTimeoutAbandoning(error, transport.reads[0]);
});

Deno.test('A wait does not count an answer that kept the event loop busy past its deadline', async () => {
  const timeoutMs = 5;
  const transport = createScriptedTransport(() => {
    // The deadline's timer cannot run while the transport holds the event loop past it.
    const busyUntil = performance.now() + timeoutMs + 20;
    while (performance.now() < busyUntil) {
      // Busy.
    }
    return page([sendMessageCall(1, 'late')], 1);
  });

  const error = await rejectionOf(
    createActivityLog(transport).waitFor({ method: 'sendMessage' }, { after: 0, timeoutMs }),
  );

  assert(error instanceof BotActivityTimeoutError, `Expected a timeout, got ${error}`);
});

Deno.test('A cancelled wait rejects with the reason and releases its read', async () => {
  for (const unanswered of [neverAnswered, rejectedWhenAbandoned]) {
    const readStarted = Promise.withResolvers<void>();
    const transport = createScriptedTransport((read) => {
      readStarted.resolve();
      return unanswered(read);
    });
    const cursor = createActivityLog(transport).cursor({ after: 0 });
    const cancellation = new AbortController();
    const reason = new Error('The test ended');

    const next = rejectionOf(cursor.next({ method: 'sendMessage' }, {
      timeoutMs: 60_000,
      signal: cancellation.signal,
    }));
    await readStarted.promise;
    cancellation.abort(reason);

    assert(await next === reason, 'Expected the wait to reject with the cancellation reason');
    assert(transport.reads[0].signal?.aborted === true, 'Expected the read to be released');
    assert(cursor.position === 0, 'Expected a cancelled wait to leave the cursor in place');
  }
});

Deno.test('A wait longer than a timer can hold keeps waiting', async () => {
  const transport = createScriptedTransport(neverAnswered);
  const cancellation = new AbortController();
  const reason = new Error('The test ended');

  const wait = rejectionOf(
    createActivityLog(transport).waitFor({}, {
      after: 0,
      timeoutMs: 2 ** 31,
      signal: cancellation.signal,
    }),
  );
  // `setTimeout` runs a callback with a longer delay after 1 ms, which this gives time to happen.
  await new Promise((resolve) => setTimeout(resolve, 20));
  cancellation.abort(reason);

  assert(await wait === reason, 'Expected the wait to last until it was cancelled');
});

Deno.test('A wait whose signal has already aborted sends no read', async () => {
  const transport = createScriptedTransport();
  const reason = new Error('Cancelled before the wait');

  const error = await rejectionOf(
    createActivityLog(transport).waitFor({}, { after: 0, signal: AbortSignal.abort(reason) }),
  );

  assert(error === reason, 'Expected the wait to reject with the cancellation reason');
  assert(transport.reads.length === 0, 'Expected no read');
});

Deno.test('A wait of 0 ms reads once what is recorded', async () => {
  const buffered = createScriptedTransport(() => page([sendMessageCall(2, 'A')], 2));
  const entry = await createActivityLog(buffered).waitFor(
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
    createActivityLog(empty).waitFor({ method: 'sendMessage' }, { after: 1, timeoutMs: 0 }),
  );
  assert(
    error instanceof BotActivityTimeoutError && error.cause === undefined,
    `Expected a timeout without an abandoned read, got ${error}`,
  );
  assert(empty.reads.length === 1, 'Expected a single read');
});

Deno.test('A wait of 0 ms abandons its read once the allowance after the deadline is up', async () => {
  const transport = createScriptedTransport(neverAnswered);

  const error = await rejectionOf(
    createActivityLog(transport).waitFor({ method: 'sendMessage' }, { after: 0, timeoutMs: 0 }),
  );

  assertTimeoutAbandoning(error, transport.reads[0]);
  assert(transport.reads[0].query.get('wait_ms') === '0', 'Expected a read that does not hold');
});

Deno.test('A wait checks a full page up to the head it reports, even after the deadline', async () => {
  const transport = createScriptedTransport(
    () => page(skippedCalls(1, READ_LIMIT), READ_LIMIT + 1),
    () => page([sendMessageCall(READ_LIMIT + 1, 'match')], READ_LIMIT + 1),
  );

  const entry = await createActivityLog(transport).waitFor(
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
  const transport = createScriptedTransport(
    () => page([sendMessageCall(1, 'skip')], 3),
    () => page([sendMessageCall(4, 'skip'), sendMessageCall(5, 'match')], 5),
    () => page([sendMessageCall(6, 'match')], 6),
  );
  const cursor = createActivityLog(transport).cursor({ after: 0 });
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
  assert(
    transport.reads.every(({ query }) => Number(query.get('wait_ms')) > 0),
    'Expected reads with time left to hold',
  );
});

Deno.test('assertNone reads a recorded range a page at a time', async () => {
  const transport = createScriptedTransport(
    () => page(skippedCalls(1, READ_LIMIT), READ_LIMIT + 5),
    () => page([sendMessageCall(READ_LIMIT + 2, 'match')], READ_LIMIT + 5),
  );

  const error = await rejectionOf(
    createActivityLog(transport).assertNone(
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

interface ScriptedRead {
  readonly url: string;
  readonly query: URLSearchParams;
  readonly signal?: AbortSignal;
}

type ScriptedAnswer = (read: ScriptedRead) => Promise<Response>;

/** A transport that answers each read with the next scripted answer and records the reads. */
function createScriptedTransport(...answers: ScriptedAnswer[]) {
  const reads: ScriptedRead[] = [];
  const fetch: typeof globalThis.fetch = (input, init) => {
    const url = String(input);
    const read = { url, query: new URL(url).searchParams, signal: init?.signal ?? undefined };
    reads.push(read);
    const answer = answers.shift();
    if (answer === undefined) {
      throw new Error(`Unexpected read: ${read.query}`);
    }
    return answer(read);
  };
  return { fetch, reads };
}

function createActivityLog(transport: { readonly fetch: typeof globalThis.fetch }): BotActivityLog {
  return createBotActivityLog(ACTIVITY_URL, transport.fetch, undefined, {});
}

/** Waits 10 ms for a sendMessage call, and returns the error the wait fails with. */
function rejectionOfShortWait(transport: {
  readonly fetch: typeof globalThis.fetch;
}): Promise<unknown> {
  return rejectionOf(
    createActivityLog(transport).waitFor({ method: 'sendMessage' }, { after: 0, timeoutMs: 10 }),
  );
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

function assertTimeoutAbandoning(error: unknown, read: ScriptedRead): void {
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
