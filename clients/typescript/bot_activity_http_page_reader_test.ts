import { createHttpBotActivityPageReader } from './bot_activity_http_page_reader.ts';
import { type BotActivityWaitClock, createBotActivityLog } from './bot_activity_log.ts';
import { BotActivityTimeoutError, EmulationClientError } from './mod.ts';
import type { BotActivityCriteria, BotActivityLog } from './mod.ts';
import {
  assert,
  ManualWaitClock,
  rejectionOf,
  sendMessageCall,
} from './test_support/bot_activity_waits.ts';

// These tests answer the HTTP page reader's requests from a scripted transport instead of a
// server, so that a request can stall, or be answered only once the wait has abandoned it.

const ACTIVITY_URL = 'http://emulator.example/sessions/session/bot-activity';
const SHORT_TIMEOUT_MILLISECONDS = 10;

Deno.test('The HTTP page reader sends a read as query parameters and reads the page answered', async () => {
  const entry = sendMessageCall(4, 'hello');
  const transport = createScriptedTransport(() =>
    Promise.resolve(Response.json({ entries: [entry], head_position: 7 }))
  );

  const page = await createHttpBotActivityPageReader(ACTIVITY_URL, transport.fetch).readPage({
    after: 3,
    before: 9,
    criteria: {
      bot_id: 1001,
      method: 'sendMessage',
      chat_id: 2002,
      ok: true,
      parameters: { text: 'hello', parse_mode: 'HTML' },
    },
    limit: 10,
    waitMilliseconds: 20,
  });

  const [read] = transport.reads;
  assert(read.url.startsWith(`${ACTIVITY_URL}?`), `Expected the activity URL, got ${read.url}`);
  assert(
    [...read.query].join('&') === [
      'after,3',
      'limit,10',
      'before,9',
      'wait_ms,20',
      'bot_id,1001',
      'kind,bot_api_call',
      'method,sendMessage',
      'chat_id,2002',
      'ok,true',
      'parameters[text],hello',
      'parameters[parse_mode],HTML',
    ].join('&'),
    `Expected the read's bounds and criteria, got ${read.query}`,
  );
  assert(
    page.headPosition === 7 && page.entries.length === 1 && page.entries[0].position === 4,
    `Expected the page answered, got ${JSON.stringify(page)}`,
  );
});

Deno.test('The HTTP page reader sends the kind only when the criteria can match one kind alone', async () => {
  const cases: readonly { readonly criteria: BotActivityCriteria; readonly kind: string | null }[] =
    [
      { criteria: {}, kind: null },
      { criteria: { bot_id: 1001 }, kind: null },
      { criteria: { parameters: {} }, kind: 'bot_api_call' },
      { criteria: { kind: 'update_delivered', user_id: 3003 }, kind: 'update_delivered' },
    ];
  for (const { criteria, kind } of cases) {
    const transport = createScriptedTransport(() =>
      Promise.resolve(Response.json({ entries: [], head_position: 0 }))
    );

    await createHttpBotActivityPageReader(ACTIVITY_URL, transport.fetch).readPage({
      after: 0,
      criteria,
      limit: 1,
    });

    const { query } = transport.reads[0];
    assert(
      query.get('kind') === kind && ![...query.keys()].some((name) => name.startsWith('param')),
      `Expected kind ${kind} for ${JSON.stringify(criteria)}, got ${query}`,
    );
  }
});

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
    assert(read.signal?.aborted === true, 'Expected the transport to be told to release the read');
    assert(transport.reads.length === 1, 'Expected no read after the deadline');
    assert(clock.pendingCallbackCount === 0, "Expected the wait's timers to be stopped");
  }
});

Deno.test('A cancelled wait abandons a read its transport leaves unanswered', async () => {
  for (const unanswered of [neverAnswered, rejectedWhenAbandoned]) {
    const clock = new ManualWaitClock();
    const transport = createScriptedTransport(unanswered);
    const cancellation = new AbortController();
    const reason = new Error('The test ended');

    const wait = rejectionOf(
      createActivityLog(transport, clock).waitFor({ method: 'sendMessage' }, {
        after: 0,
        timeoutMs: 60_000,
        signal: cancellation.signal,
      }),
    );
    await transport.untilReadsSent(1);
    cancellation.abort(reason);

    assert(await wait === reason, 'Expected the wait to reject with the cancellation reason');
    assert(transport.reads[0].signal?.aborted === true, 'Expected the read to be released');
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

interface ScriptedRequest {
  readonly url: string;
  readonly query: URLSearchParams;
  readonly signal?: AbortSignal;
}

type ScriptedResponse = (read: ScriptedRequest) => Promise<Response>;

interface ScriptedTransport {
  readonly fetch: typeof globalThis.fetch;
  readonly reads: readonly ScriptedRequest[];
  /** Settles once the reader has sent `count` requests, each already given its response. */
  untilReadsSent(count: number): Promise<void>;
}

/** A transport that answers each request with the next scripted response and records them. */
function createScriptedTransport(...responses: ScriptedResponse[]): ScriptedTransport {
  const reads: ScriptedRequest[] = [];
  const readCountWaiters: { readonly count: number; readonly resolve: () => void }[] = [];
  const fetch: typeof globalThis.fetch = (input, init) => {
    const url = String(input);
    const read = { url, query: new URL(url).searchParams, signal: init?.signal ?? undefined };
    reads.push(read);
    for (const waiter of readCountWaiters.filter(({ count }) => count <= reads.length)) {
      waiter.resolve();
    }
    const response = responses.shift();
    if (response === undefined) {
      throw new Error(`Unexpected read: ${read.query}`);
    }
    return response(read);
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
  const pageReader = createHttpBotActivityPageReader(ACTIVITY_URL, transport.fetch);
  return createBotActivityLog(pageReader, undefined, {}, clock);
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
function rejectedWhenAbandoned(read: ScriptedRequest): Promise<Response> {
  return new Promise((_resolve, reject) => {
    read.signal?.addEventListener('abort', () => reject(read.signal?.reason));
  });
}

/** Checks that a wait timed out naming the request it abandoned for the wait's time. */
function assertTimeoutAbandoning(
  error: unknown,
  read: ScriptedRequest,
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
