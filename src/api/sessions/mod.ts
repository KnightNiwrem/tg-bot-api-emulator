import { type Context, Hono, type MiddlewareHandler } from 'hono';
import { basePath, matchedRoutes } from 'hono/route';
import { z } from 'zod';

import type { EmulationSession, EmulationSessionOptions } from '../../types/emulation_session.ts';
import { DEFAULT_UPLOAD_PROFILE, UPLOAD_PROFILES } from '../../types/upload_profile.ts';
import { controlErrorResponse, invalidControlRequestResponse } from '../control_error_response.ts';
import { createAccountRoutes } from './accounts/mod.ts';
import { createBotActivityRoutes } from './bot_activity/mod.ts';
import { createBotApiRoutes } from './bot_api/mod.ts';
import { createBotRoutes } from './bots/mod.ts';
import { createFileRoutes } from './files/mod.ts';
import { createInlineQueryCacheRoutes } from './inline_queries/mod.ts';
import { readJsonRequestBody } from './json_request_body.ts';
import { createPollRoutes } from './polls/mod.ts';
import type { SessionRouteContextTypes } from './session_route_context_types.ts';
import { createSupergroupRoutes } from './supergroups/mod.ts';
import { createWebResourceRoutes } from './web_resources/mod.ts';

const SESSION_ID_PARAMETER = 'sessionId';
const SESSION_PATH = `/:${SESSION_ID_PARAMETER}` as const;
const ACCOUNT_COLLECTION_PATH = `${SESSION_PATH}/accounts` as const;
const BOT_COLLECTION_PATH = `${SESSION_PATH}/bots` as const;
const BOT_API_PATH = `${SESSION_PATH}/bot-api` as const;
const BOT_ACTIVITY_PATH = `${SESSION_PATH}/bot-activity` as const;
const FILE_COLLECTION_PATH = `${SESSION_PATH}/files` as const;
const WEB_RESOURCE_COLLECTION_PATH = `${SESSION_PATH}/web-resources` as const;
const POLL_COLLECTION_PATH = `${SESSION_PATH}/polls` as const;
const INLINE_QUERY_COLLECTION_PATH = `${SESSION_PATH}/inline-queries` as const;
const SUPERGROUP_COLLECTION_PATH = `${SESSION_PATH}/supergroups` as const;

/** The method Hono records for middleware, which `use` registers for every method. */
const MIDDLEWARE_METHOD = 'ALL';

/** The reason a control route gives for a session that does not exist or has ended. */
const SESSION_NOT_FOUND_REASON = 'session_not_found';

const createSessionRequestSchema = z.strictObject({
  upload_profile: z.enum(UPLOAD_PROFILES).default(DEFAULT_UPLOAD_PROFILE),
});

export interface SessionLifecycle {
  createSession(options: EmulationSessionOptions): EmulationSession;
  endSession(sessionId: string): boolean;
  getSessionById(sessionId: string): EmulationSession | undefined;
}

interface SessionRouteDependencies {
  readonly sessionLifecycle: SessionLifecycle;
  readonly publicOrigin: string;
}

export function createSessionRoutes(
  { sessionLifecycle, publicOrigin }: SessionRouteDependencies,
): Hono<SessionRouteContextTypes> {
  const sessionRoutes = new Hono<SessionRouteContextTypes>();

  sessionRoutes.post('/', async (context) => {
    // The body is optional: without one, every setting has its default.
    const requestBody = await readJsonRequestBody(context.req, createSessionRequestSchema, {
      allowsEmptyBody: true,
    });
    if (!requestBody.valid) {
      return invalidControlRequestResponse(context, requestBody.issues);
    }
    const session = sessionLifecycle.createSession({
      uploadProfile: requestBody.value.upload_profile,
    });
    const sessionPath = `${basePath(context)}/${session.id}`;

    return context.json(
      {
        id: session.id,
        botApiRoot: new URL(`${sessionPath}/bot-api`, publicOrigin).href,
        uploadProfile: session.uploadProfile,
      },
      201,
      { Location: sessionPath },
    );
  });

  sessionRoutes.delete(SESSION_PATH, (context) => {
    const sessionWasDeleted = sessionLifecycle.endSession(
      context.req.param(SESSION_ID_PARAMETER),
    );
    return sessionWasDeleted
      ? context.body(null, 204)
      : controlErrorResponse(context, 404, SESSION_NOT_FOUND_REASON);
  });

  // The Bot API's responses are Telegram's, so a bot of an unknown session gets a 404 without the
  // control API's error body, and without a Bot API envelope, as no bot is authenticated yet.
  const requireBotApiSession = createSessionRequirement(
    sessionLifecycle,
    (context) => context.body(null, 404),
  );
  const requireControlSession = createSessionRequirement(
    sessionLifecycle,
    (context) => controlErrorResponse(context, 404, SESSION_NOT_FOUND_REASON),
  );
  sessionRoutes.use(`${BOT_API_PATH}/*`, requireBotApiSession);
  sessionRoutes.route(BOT_API_PATH, createBotApiRoutes());

  const controlSubresourceRoutes: readonly (readonly [
    path: string,
    routes: Hono<SessionRouteContextTypes>,
  ])[] = [
    [ACCOUNT_COLLECTION_PATH, createAccountRoutes()],
    [BOT_COLLECTION_PATH, createBotRoutes()],
    [BOT_ACTIVITY_PATH, createBotActivityRoutes()],
    [FILE_COLLECTION_PATH, createFileRoutes()],
    [WEB_RESOURCE_COLLECTION_PATH, createWebResourceRoutes()],
    [POLL_COLLECTION_PATH, createPollRoutes()],
    [INLINE_QUERY_COLLECTION_PATH, createInlineQueryCacheRoutes()],
    [SUPERGROUP_COLLECTION_PATH, createSupergroupRoutes()],
  ];
  for (const [path, routes] of controlSubresourceRoutes) {
    // A method or path that no control route serves reaches `route_not_found` whether or not its
    // session exists; only a request a route serves needs the session.
    sessionRoutes.use(
      `${path}/*`,
      (context, next) => isServedByRoute(context) ? requireControlSession(context, next) : next(),
    );
    sessionRoutes.route(path, routes);
  }

  return sessionRoutes;
}

/**
 * Whether a route registered for the request's method and path serves it, rather than only
 * middleware such as this module's, which Hono registers for every method as `ALL`.
 */
function isServedByRoute(context: Context): boolean {
  return matchedRoutes(context).some(({ method }) => method !== MIDDLEWARE_METHOD);
}

/**
 * Creates middleware that resolves the session a route's path names, answering a request for an
 * unknown session as `answerUnknownSession` does.
 */
function createSessionRequirement(
  sessionLifecycle: SessionLifecycle,
  answerUnknownSession: (context: Context) => Response,
): MiddlewareHandler<SessionRouteContextTypes> {
  return async (context, next) => {
    const sessionId = context.req.param(SESSION_ID_PARAMETER);
    const session = sessionId === undefined
      ? undefined
      : sessionLifecycle.getSessionById(sessionId);
    if (session === undefined) {
      return answerUnknownSession(context);
    }

    context.set('emulationSession', session);
    await next();
  };
}
