import type { ControlErrorBody, ControlRequestIssue, HttpMethod, RequestDetails } from './types.ts';

export interface EmulationClientErrorDetails extends RequestDetails {
  readonly status?: number;
  readonly responseBody?: string;
}

/**
 * An HTTP, transport, response-contract, or abandoned-request failure reported by the emulation
 * client. A request is abandoned when, for example, a bot activity read is still pending at its
 * wait's deadline; the error's `cause` is then the reason it was abandoned. A refusal whose
 * response is the emulator's JSON error body is an `EmulationControlError`; any other unexpected
 * status keeps the raw `responseBody`.
 */
export class EmulationClientError extends Error {
  override readonly name: string = 'EmulationClientError';
  readonly method: HttpMethod;
  readonly url: string;
  readonly status?: number;
  readonly responseBody?: string;

  constructor(
    message: string,
    details: EmulationClientErrorDetails,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.method = details.method;
    this.url = details.url;
    this.status = details.status;
    this.responseBody = details.responseBody;
  }
}

/** A refusal from the emulator's control API, with the reason and issues its JSON body gives. */
export interface EmulationControlErrorDetails extends RequestDetails {
  readonly status: number;
  readonly responseBody: string;
  readonly body: ControlErrorBody;
}

/**
 * The emulator refused a control request, answering with its JSON error body. `reason` is the
 * refusal's stable code, such as `bot_blocked`, `session_not_found`, or, for input that breaks the
 * operation's contract, `invalid_request`, whose `issues` say what is wrong and where.
 */
export class EmulationControlError extends EmulationClientError {
  override readonly name: string = 'EmulationControlError';
  override readonly status: number;
  override readonly responseBody: string;
  readonly reason: string;
  /** What is wrong with the request's input; empty unless `reason` is `invalid_request`. */
  readonly issues: readonly ControlRequestIssue[];

  constructor(message: string, details: EmulationControlErrorDetails) {
    super(message, details);
    this.status = details.status;
    this.responseBody = details.responseBody;
    this.reason = details.body.reason;
    this.issues = details.body.issues ?? [];
  }
}
