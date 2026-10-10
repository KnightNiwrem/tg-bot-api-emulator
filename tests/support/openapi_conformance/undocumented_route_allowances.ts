/**
 * The requests tests send on purpose to routes the OpenAPI document describes no operation for.
 * Any other request to such a route fails the conformance check, because either the document
 * lacks an operation the server has, or the test calls one the server does not have by mistake.
 */

export interface UndocumentedRouteAllowance {
  /** Why tests send these requests. */
  readonly reason: string;
  readonly allows: (request: UndocumentedRouteRequest) => boolean;
}

export interface UndocumentedRouteRequest {
  /** The request URL's path, still percent-encoded. */
  readonly path: string;
  /** The listed path the request matches, when the document lists it without the request's method. */
  readonly pathTemplate: string | undefined;
}

/** Lists a Bot API method name only as a path parameter, describing no operation for it. */
const BOT_API_ANY_METHOD_PATH_TEMPLATE = '/sessions/{sessionId}/bot-api/bot{token}/{method}';

/** A path under a session's Bot API root, as every Bot API request has. */
const BOT_API_ROOT_PATH_PATTERN = /^\/sessions\/[^/]+\/bot-api(?:\/.*)?$/;

const UNDOCUMENTED_ROUTE_ALLOWANCES: readonly UndocumentedRouteAllowance[] = [
  {
    reason:
      "Tests call Bot API methods the emulator does not implement, which answer with Telegram's " +
      '404, as the document states.',
    allows: ({ pathTemplate }) => pathTemplate === BOT_API_ANY_METHOD_PATH_TEMPLATE,
  },
  {
    reason:
      'Tests send requests under a Bot API root whose path is not `bot<token>/<method>`: one ' +
      "without a token or a method, or with segments after the method. Each answers with Telegram's " +
      '404.',
    allows: ({ path, pathTemplate }) =>
      pathTemplate === undefined && BOT_API_ROOT_PATH_PATTERN.test(path),
  },
];

/** The allowance that covers `request`, if any. */
export function findUndocumentedRouteAllowance(
  request: UndocumentedRouteRequest,
): UndocumentedRouteAllowance | undefined {
  return UNDOCUMENTED_ROUTE_ALLOWANCES.find((allowance) => allowance.allows(request));
}
