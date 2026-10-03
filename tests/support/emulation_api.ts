/**
 * The HTTP harness through which tests talk to an in-process emulation API: building the API,
 * creating sessions on it, and exchanging JSON with its routes.
 */
import { createEmulationApi } from '../../src/api/mod.ts';
import { createSessionLifecycleService } from '../../src/composition/session_lifecycle.ts';
import type { UploadProfile } from '../../src/types/upload_profile.ts';

/** An in-process emulation API that tests send requests to without a network. */
export type EmulationApi = ReturnType<typeof createEmulationApi>;

/** The public origin a test API names in the absolute URLs it returns. */
export const TEST_PUBLIC_ORIGIN = 'http://emulator.example:9000';

/** The settings `POST /sessions` accepts. */
export interface SessionSettings {
  readonly upload_profile?: UploadProfile;
}

/** Creates an in-process emulation API with its own, empty set of sessions. */
export function createTestApi(): EmulationApi {
  return createEmulationApi({
    sessionLifecycle: createSessionLifecycleService(),
    publicOrigin: TEST_PUBLIC_ORIGIN,
  });
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

/** Creates an in-process emulation API holding one session, created with `sessionSettings`. */
export async function createTestSession(
  sessionSettings?: SessionSettings,
): Promise<{ api: EmulationApi; sessionPath: string }> {
  const api = createTestApi();
  return { api, sessionPath: await createSession(api, sessionSettings) };
}

/**
 * Sends a request to `api`, with `body` serialized as its JSON body when given, and returns the
 * response status with the parsed JSON body. `Body` is the caller's expectation of the body's shape
 * and is not checked.
 *
 * A response without a body, such as a refusal or a `204`, still yields its status, but reading its
 * `body` throws, naming the request, rather than yielding a value its type does not allow.
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
