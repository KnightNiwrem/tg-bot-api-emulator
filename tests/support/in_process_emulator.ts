/**
 * The in-process emulator tests use: the supported entry point's emulator, with the OpenAPI
 * conformance check in front of its HTTP handler.
 */
import { createEmulationApi } from '../../src/api/mod.ts';
import {
  createInProcessEmulatorWithHandler,
  type InProcessEmulator,
} from '../../in_process/in_process_emulator.ts';
import { TEST_PUBLIC_ORIGIN } from './emulation_api.ts';
import { withOpenApiConformanceCheck } from './openapi_conformance/conformance_middleware.ts';

export interface TestInProcessEmulator extends InProcessEmulator {
  /** Sends a request to `path`, resolved against the emulator's public origin, through `fetch`. */
  request(path: string, init?: RequestInit): Promise<Response>;
}

/**
 * Creates an in-process emulator naming `publicOrigin` in the URLs it returns. Every response it
 * gives is checked against `openapi/openapi.yaml`: one that departs from it rejects the request
 * with an `OpenApiConformanceError` instead of reaching the test.
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
