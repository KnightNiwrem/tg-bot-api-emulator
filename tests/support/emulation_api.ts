/**
 * The HTTP harness through which tests talk to an emulator running in the test's own process:
 * building the emulator, creating sessions on it, and exchanging JSON with its routes.
 */
import { createEmulationApi } from '../../src/api/mod.ts';
import type { UploadProfile } from '../../src/types/upload_profile.ts';
import {
  createInProcessEmulatorWithHandler,
  type InProcessEmulator,
} from '../../in_process/in_process_emulator.ts';
import { withOpenApiConformanceCheck } from './openapi_conformance/conformance_middleware.ts';

/** The public origin a test emulator names in the absolute URLs it returns. */
export const TEST_PUBLIC_ORIGIN = 'http://emulator.example:9000';

/** An emulation API that tests send requests to by path, without a network. */
export interface EmulationApi {
  /** Sends a request to `path`, an absolute path on the emulation API. */
  request(path: string, init?: RequestInit): Response | Promise<Response>;
}

/** The in-process emulator tests use, which they also reach by path. */
export interface TestInProcessEmulator extends InProcessEmulator, EmulationApi {
  /** Sends a request to `path`, resolved against the emulator's public origin, through `fetch`. */
  request(path: string, init?: RequestInit): Promise<Response>;
}

/** The settings `POST /sessions` accepts. */
export interface SessionSettings {
  readonly upload_profile?: UploadProfile;
}

/**
 * Creates an in-process emulator with its own, empty set of sessions, naming `publicOrigin` in the
 * absolute URLs it returns. It is the supported entry point's emulator with the OpenAPI conformance
 * check in front of its HTTP handler: a response that departs from `openapi/openapi.yaml` rejects
 * the request with an `OpenApiConformanceError` instead of reaching the test.
 */
export function createTestInProcessEmulator(
  publicOrigin: string = TEST_PUBLIC_ORIGIN,
): TestInProcessEmulator {
  const emulator = createInProcessEmulatorWithHandler(
    (dependencies) => withOpenApiConformanceCheck(createEmulationApi(dependencies)).fetch,
    { publicOrigin },
  );
  return {
    client: emulator.client,
    fetch: emulator.fetch,
    request: (path, init) => emulator.fetch(new URL(path, publicOrigin), init),
    [Symbol.asyncDispose]: () => emulator[Symbol.asyncDispose](),
  };
}

/**
 * Creates a session on `api` through `POST /sessions`, sending `sessionSettings` as its JSON body
 * when given, and returns the session's path from the response's `Location`.
 */
export async function createSession(
  api: EmulationApi,
  sessionSettings?: SessionSettings,
): Promise<string> {
  const response = await api.request(
    '/sessions',
    sessionSettings === undefined ? { method: 'POST' } : {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(sessionSettings),
    },
  );
  const sessionPath = response.headers.get('Location');
  if (sessionPath === null) {
    throw new Error('Expected the created session to have a Location');
  }
  return sessionPath;
}

/** Creates an in-process test emulator holding one session, created with `sessionSettings`. */
export async function createTestSession(
  sessionSettings?: SessionSettings,
): Promise<{ api: TestInProcessEmulator; sessionPath: string }> {
  const api = createTestInProcessEmulator();
  return { api, sessionPath: await createSession(api, sessionSettings) };
}

/**
 * Sends a request to `api`, with `body` serialized as its JSON body when given, and returns the
 * response status with the parsed JSON body. `Body` is the caller's expectation of the body's shape
 * and is not checked.
 *
 * A response without a body, such as a `204`, still yields its status, but reading its `body`
 * throws, naming the request, rather than yielding a value its type does not allow.
 */
export async function requestJson<Body>(
  api: EmulationApi,
  method: 'DELETE' | 'GET' | 'PATCH' | 'POST' | 'PUT',
  path: string,
  body?: unknown,
): Promise<{ status: number; body: Body }> {
  const response = await api.request(path, {
    method,
    ...(body === undefined
      ? {}
      : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  });
  const text = await response.text();
  if (text.length > 0) {
    return { status: response.status, body: JSON.parse(text) as Body };
  }
  return {
    status: response.status,
    get body(): Body {
      throw new Error(
        `Expected ${method} ${path} to answer with a JSON body, but its ${response.status} response had none`,
      );
    },
  };
}

/** The `RequestInit` of a `method` request carrying `body` as its JSON body. */
export function jsonRequest(method: 'PATCH' | 'POST' | 'PUT', body: unknown): RequestInit {
  return { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}
