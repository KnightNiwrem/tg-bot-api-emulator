import { Hono } from 'hono';

import { controlErrorResponse } from './control_error_response.ts';
import { createSessionRoutes, type SessionLifecycle } from './sessions/mod.ts';

export interface EmulationApiDependencies {
  readonly sessionLifecycle: SessionLifecycle;
  readonly publicOrigin: string;
}

/** Composes the HTTP interface for controlling and interacting with emulation sessions. */
export function createEmulationApi(
  { sessionLifecycle, publicOrigin }: EmulationApiDependencies,
): Hono {
  const api = new Hono();

  api.route('/sessions', createSessionRoutes({ sessionLifecycle, publicOrigin }));
  // Every Bot API path under a session's root has a route of its own, so only control requests
  // reach this answer.
  api.notFound((context) => controlErrorResponse(context, 404, 'route_not_found'));

  return api;
}
