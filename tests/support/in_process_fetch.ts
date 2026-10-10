/**
 * Returns a `fetch` that hands each request to `handler` in process, such as an emulation API's
 * `fetch`, so that a grammY bot reaches the emulator without opening a network connection.
 */
export function createInProcessFetch(
  handler: (request: Request) => Response | Promise<Response>,
): typeof globalThis.fetch {
  return async (input, init) => await handler(new Request(input, init));
}
