/**
 * Puts the OpenAPI conformance check in front of an in-process emulation API, so that every
 * response a test receives through it, by `api.request` or by a `fetch` handed to a client or a
 * bot, is one the document says its operation answers with.
 *
 * Only tests use this; the server never installs it.
 */
import { Hono, type MiddlewareHandler } from 'hono';

import {
  type OpenApiConformanceChecker,
  repositoryConformanceChecker,
} from './exchange_conformance.ts';
import type { ExchangeRecord } from './exchange_record.ts';
import { appendExchangeRecord } from './exchange_record_log.ts';

/** Thrown out of the API's `fetch` for an exchange that departs from the document. */
export class OpenApiConformanceError extends Error {
  readonly record: ExchangeRecord;

  constructor(record: ExchangeRecord) {
    super(
      `${record.request.method} ${record.request.path} answered ${record.status}, which departs ` +
        `from the OpenAPI document:\n${
          record.violations.map((violation) => `- ${violation}`).join('\n')
        }`,
    );
    this.name = 'OpenApiConformanceError';
    this.record = record;
  }
}

export interface ConformanceCheckOptions {
  readonly checker?: OpenApiConformanceChecker;
  /** Receives every checked exchange; by default, a coverage run's record file does. */
  readonly recordExchange?: (record: ExchangeRecord) => void;
}

/**
 * Checks each exchange that passes through it, records it, and throws an
 * {@link OpenApiConformanceError} for one that departs from the document.
 */
function openApiConformanceMiddleware(
  { checker = repositoryConformanceChecker(), recordExchange = appendExchangeRecord }:
    ConformanceCheckOptions = {},
): MiddlewareHandler {
  return async (context, next) => {
    const request = context.req.raw;
    // Nothing here awaits before the request reaches the API, so that requests a test sends one
    // after another reach it in that order, as they would without the check.
    const requestBodyReading = request.clone().arrayBuffer();
    await next();
    const response = context.res;
    const record = checker.checkExchange(
      {
        method: request.method,
        url: new URL(request.url),
        headers: request.headers,
        body: new Uint8Array(await requestBodyReading),
      },
      {
        status: response.status,
        headers: response.headers,
        body: new Uint8Array(await response.clone().arrayBuffer()),
      },
    );
    recordExchange(record);
    if (record.violations.length > 0) {
      throw new OpenApiConformanceError(record);
    }
  };
}

/**
 * An API that answers as `api` does, after checking each exchange with
 * {@link openApiConformanceMiddleware}. A departure rejects the request's promise rather than
 * becoming an error response, so the test that caused it fails.
 */
export function withOpenApiConformanceCheck(api: Hono, options?: ConformanceCheckOptions): Hono {
  const checkedApi = new Hono();
  checkedApi.use(openApiConformanceMiddleware(options));
  checkedApi.all('*', (context) => api.fetch(context.req.raw));
  checkedApi.onError((error) => {
    throw error;
  });
  return checkedApi;
}
