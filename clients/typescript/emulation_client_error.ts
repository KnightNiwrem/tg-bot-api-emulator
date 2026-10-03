import type { HttpMethod, RequestDetails } from './types.ts';

export interface EmulationClientErrorDetails extends RequestDetails {
  readonly status?: number;
  readonly responseBody?: string;
}

/**
 * An HTTP, transport, response-contract, or abandoned-request failure reported by the emulation
 * client. A request is abandoned when, for example, a bot activity read is still pending at its
 * wait's deadline; the error's `cause` is then the reason it was abandoned.
 */
export class EmulationClientError extends Error {
  override readonly name = 'EmulationClientError';
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
