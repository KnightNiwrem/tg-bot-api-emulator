import { z } from 'zod';

import { controlErrorBodySchema } from './schemas.ts';
import type { ControlErrorBody, HttpMethod, RequestDetails } from './types.ts';

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

/** A refusal from the emulator's control API: the request, the response, and its parsed body. */
export interface EmulationControlErrorDetails extends RequestDetails {
  readonly status: number;
  readonly responseBody: string;
  readonly body: ControlErrorBody;
}

/**
 * The emulator refused a control request, answering with its JSON error body. `reason` is the
 * refusal's stable code, such as `bot_blocked`, `session_not_found`, or, for input that breaks the
 * operation's contract, `invalid_request`. Only that body has `issues`, which say what is wrong and
 * where, so `error.body.issues !== undefined` narrows `body` to a `ControlValidationErrorBody`.
 */
export class EmulationControlError extends EmulationClientError {
  override readonly name: string = 'EmulationControlError';
  override readonly status: number;
  override readonly responseBody: string;
  readonly body: ControlErrorBody;

  /**
   * @throws {TypeError} when `body` is not a control error body: a validation failure without
   * issues, or a reason that is `invalid_request` or not a snake_case code.
   */
  constructor(message: string, details: EmulationControlErrorDetails) {
    const body = controlErrorBodySchema.safeParse(details.body);
    if (!body.success) {
      throw new TypeError(`Not a control error body: ${z.prettifyError(body.error)}`);
    }
    super(message, details);
    this.status = details.status;
    this.responseBody = details.responseBody;
    this.body = body.data;
  }

  /** The refusal's stable code. */
  get reason(): string {
    return this.body.reason;
  }
}
