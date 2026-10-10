import type { Context } from 'hono';
import type { ClientErrorStatusCode, ServerErrorStatusCode } from 'hono/utils/http-status';

import {
  type CONTROL_REQUEST_ISSUE_CODES,
  type CONTROL_REQUEST_ISSUE_SOURCES,
  INVALID_REQUEST_REASON,
} from '../../control_contracts/control_errors.ts';

/** The status of a control route's refusal: the request's fault, or the session's state. */
type ControlErrorStatus = ClientErrorStatusCode | ServerErrorStatusCode;

/** The part of a control request an input issue is in. */
export type ControlRequestIssueSource = typeof CONTROL_REQUEST_ISSUE_SOURCES[number];

/** What is wrong with one input value, as `CONTROL_REQUEST_ISSUE_CODES` describes each code. */
export type ControlRequestIssueCode = typeof CONTROL_REQUEST_ISSUE_CODES[number];

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
