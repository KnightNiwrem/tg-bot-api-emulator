/**
 * Runs the emulator inside the test's own process: the server and the TypeScript client, joined by
 * a `fetch` that hands each request to the emulator's HTTP handler instead of a socket.
 *
 * This module depends on both the server and the client, so that the client itself stays
 * independent of the server's source.
 */
import { createEmulationApi, type EmulationApiDependencies } from '../src/api/mod.ts';
import { createSessionLifecycleService } from '../src/composition/session_lifecycle.ts';
import type { HttpRequestHandler } from '../src/server.ts';
import { TelegramEmulationClient } from '../clients/typescript/mod.ts';

/** The origin an in-process emulator names in the URLs it returns, unless told otherwise. */
const DEFAULT_IN_PROCESS_PUBLIC_ORIGIN = 'http://emulator.invalid';

export interface InProcessEmulatorOptions {
  /**
   * The `http` or `https` origin the emulator names in the absolute URLs it returns, such as a
   * session's `botApiRoot`. No listener serves it: requests reach the emulator only through the
   * emulator's `fetch`. By default it is `http://emulator.invalid`, which no network resolves.
   */
  readonly publicOrigin?: string;
}

/**
 * An emulator running in the current process, which owns every session created on it.
 *
 * Disposing of it, as `await using` does, ends each session still open on it, waits for the
 * requests it is already answering to finish, and then refuses every later request. Stop the bot
 * under test first: a bot that keeps polling afterwards only receives refusals.
 */
export interface InProcessEmulator extends AsyncDisposable {
  /** The control client, already pointed at this emulator. */
  readonly client: TelegramEmulationClient;
  /**
   * Sends a request to this emulator, for the bot under test's Bot API client. Like the network
   * `fetch`, it serializes the request, rejects with the signal's reason once the request's signal
   * aborts, and rejects with a `TypeError` once the emulator is disposed of. The emulator answers
   * any origin, so the URLs it returns, such as a session's `botApiRoot`, work as they are.
   */
  readonly fetch: typeof globalThis.fetch;
}

/**
 * Creates an emulator in the current process, with its own, empty set of sessions. Requests go
 * through the same HTTP handler as the standalone server's, so they are validated, answered and
 * refused exactly as over the network; only the socket is skipped.
 */
export function createInProcessEmulator(options: InProcessEmulatorOptions = {}): InProcessEmulator {
  return createInProcessEmulatorWithHandler(
    (dependencies) => createEmulationApi(dependencies).fetch,
    options,
  );
}

/** Composes the HTTP handler an in-process emulator answers with, over the emulator's sessions. */
export type InProcessRequestHandlerComposer = (
  dependencies: EmulationApiDependencies,
) => HttpRequestHandler;

/**
 * Creates an in-process emulator that answers with the handler `composeRequestHandler` builds
 * from the emulator's own session lifecycle and public origin. {@link createInProcessEmulator}
 * builds the emulation API itself; tests put checks in front of it.
 */
export function createInProcessEmulatorWithHandler(
  composeRequestHandler: InProcessRequestHandlerComposer,
  { publicOrigin = DEFAULT_IN_PROCESS_PUBLIC_ORIGIN }: InProcessEmulatorOptions = {},
): InProcessEmulator {
  const origin = parsePublicOrigin(publicOrigin);
  const sessionLifecycle = createSessionLifecycleService();
  const handleRequest = composeRequestHandler({ sessionLifecycle, publicOrigin: origin });
  const requestsBeingAnswered = new Set<Promise<Response>>();
  let disposal: Promise<void> | undefined;

  const fetch: typeof globalThis.fetch = (input, init) => {
    if (disposal !== undefined) {
      return Promise.reject(new TypeError('The in-process emulator has been disposed of'));
    }
    let request: Request;
    try {
      request = new Request(input, withPlatformAbortSignal(init));
    } catch (error) {
      return Promise.reject(error);
    }
    const { signal } = request;
    if (signal.aborted) {
      return Promise.reject(signal.reason);
    }

    // The handler starts at once, so requests sent one after another reach it in that order.
    const answering = (async () => await handleRequest(request))();
    requestsBeingAnswered.add(answering);
    const forget = () => requestsBeingAnswered.delete(answering);
    answering.then(forget, forget);
    return answerUnlessAborted(answering, signal);
  };

  const dispose = async (): Promise<void> => {
    sessionLifecycle.endAllSessions();
    await Promise.allSettled(requestsBeingAnswered);
    // A request that was already being answered may have created a session meanwhile.
    sessionLifecycle.endAllSessions();
  };

  return {
    client: new TelegramEmulationClient(origin, { fetch }),
    fetch,
    [Symbol.asyncDispose]: () => {
      disposal ??= dispose();
      return disposal;
    },
  };
}

/**
 * The response `answering` gives, unless `signal` aborts first: then a rejection with the signal's
 * reason, as the network `fetch` gives, and the late response's body is cancelled unread.
 */
function answerUnlessAborted(
  answering: Promise<Response>,
  signal: AbortSignal,
): Promise<Response> {
  return new Promise((resolve, reject) => {
    const rejectWithAbortReason = () => reject(signal.reason);
    signal.addEventListener('abort', rejectWithAbortReason, { once: true });
    answering.then(
      (response) => {
        signal.removeEventListener('abort', rejectWithAbortReason);
        if (signal.aborted) {
          response.body?.cancel().catch(() => {});
          return;
        }
        resolve(response);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', rejectWithAbortReason);
        reject(error);
      },
    );
  });
}

/**
 * Signals that only resemble an `AbortSignal`: Bot API clients built for Node.js, such as grammY's
 * npm package, pass `fetch` the signal of an `AbortController` polyfill, which `Request` refuses.
 */
interface AbortSignalLike {
  readonly aborted: boolean;
  readonly reason?: unknown;
  addEventListener(type: 'abort', listener: () => void, options?: { once?: boolean }): void;
}

/**
 * `init` with its signal as a platform `AbortSignal` that aborts when the given signal does, so
 * that a polyfilled signal still cancels the request. Any other signal is left for `Request` to
 * accept or refuse.
 */
function withPlatformAbortSignal(init: RequestInit | undefined): RequestInit | undefined {
  const signal: unknown = init?.signal;
  if (signal instanceof AbortSignal || !isAbortSignalLike(signal)) {
    return init;
  }
  const abortController = new AbortController();
  const abort = () =>
    abortController.abort(
      signal.reason ?? new DOMException('The request was aborted', 'AbortError'),
    );
  if (signal.aborted) {
    abort();
  } else {
    signal.addEventListener('abort', abort, { once: true });
  }
  return { ...init, signal: abortController.signal };
}

function isAbortSignalLike(value: unknown): value is AbortSignalLike {
  return typeof value === 'object' && value !== null && 'aborted' in value &&
    typeof value.aborted === 'boolean' && 'addEventListener' in value &&
    typeof value.addEventListener === 'function';
}

function parsePublicOrigin(publicOrigin: string): string {
  let url: URL;
  try {
    url = new URL(publicOrigin);
  } catch (cause) {
    throw new TypeError(`publicOrigin must be an absolute URL: ${publicOrigin}`, { cause });
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new TypeError(`publicOrigin must use the http or https protocol: ${publicOrigin}`);
  }
  if (
    url.username !== '' || url.password !== '' || url.pathname !== '/' || url.search !== '' ||
    url.hash !== ''
  ) {
    throw new TypeError(`publicOrigin must be an origin, without a path or query: ${publicOrigin}`);
  }
  return url.origin;
}
