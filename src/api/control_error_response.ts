import type { Context } from 'hono';
import type { ClientErrorStatusCode, ServerErrorStatusCode } from 'hono/utils/http-status';

/** The status of a control route's refusal: the request's fault, or the session's state. */
type ControlErrorStatus = ClientErrorStatusCode | ServerErrorStatusCode;

/** The reason a control route gives when its request breaks the operation's input contract. */
const INVALID_REQUEST_REASON = 'invalid_request';

/** The part of a control request an input issue is in. */
export type ControlRequestIssueSource = 'body' | 'path' | 'query';

/**
 * What is wrong with one input value. The codes are the emulator's own, so that they stay stable
 * across validation libraries:
 *
 * - `invalid_json`: the body is not JSON;
 * - `invalid_type`: a value is missing or of the wrong type;
 * - `too_small` / `too_big`: a number, text, or list is outside its bounds;
 * - `invalid_format`: text does not have the required form;
 * - `invalid_value`: a value is not one of those allowed, or breaks a rule its field states;
 * - `unknown_field`: the operation takes no field or query parameter of that name;
 * - `duplicate_field`: a query parameter is repeated;
 * - `no_matching_variant`: a value that takes one of several forms matches none of them.
 */
export type ControlRequestIssueCode =
  | 'invalid_json'
  | 'invalid_type'
  | 'too_small'
  | 'too_big'
  | 'invalid_format'
  | 'invalid_value'
  | 'unknown_field'
  | 'duplicate_field'
  | 'no_matching_variant';

/**
 * One problem with a control request's input: where it is, as the field names and list indexes
 * from the part's root, what kind of problem it is, and an explanation that names no input value.
 */
export interface ControlRequestIssue {
  readonly source: ControlRequestIssueSource;
  readonly path: readonly (string | number)[];
  readonly code: ControlRequestIssueCode;
  readonly message: string;
}

/**
 * Answers a control request the emulator refuses with a JSON body naming the refusal's stable
 * reason, such as `bot_blocked` or `session_not_found`.
 */
export function controlErrorResponse(
  context: Context,
  status: ControlErrorStatus,
  reason: string,
): Response {
  return context.json({ reason }, status);
}

/** Answers a control request whose input breaks the operation's contract, listing every issue. */
export function invalidControlRequestResponse(
  context: Context,
  issues: readonly ControlRequestIssue[],
): Response {
  return context.json({ reason: INVALID_REQUEST_REASON, issues }, 400);
}
