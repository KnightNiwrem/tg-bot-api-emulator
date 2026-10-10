import { z } from 'zod';

import { EmulationClientError, EmulationControlError } from './emulation_client_error.ts';
import { controlErrorBodySchema } from './schemas.ts';
import type { ControlErrorBody, ControlRequestIssue, RequestDetails } from './types.ts';

/**
 * A request that is abandoned once its signal aborts: unsent if it has already aborted, and
 * otherwise unanswered or with its response unread. An abandoned request fails with an
 * `EmulationClientError` whose `cause` is the signal's reason, and the transport is told to release
 * it through the signal; a response that a transport still delivers later is cancelled unread.
 */
interface AbortableRequest extends RequestDetails {
  readonly signal?: AbortSignal;
}

interface JsonRequest<T> extends SerializableRequest, AbortableRequest {
  readonly expectedStatus: number;
  readonly responseSchema: z.ZodType<T>;
}

/** A request whose response is read as it is, rather than as JSON. */
interface RawResponseRequest extends RequestDetails {
  readonly expectedStatus: number;
}

interface SerializableRequest extends RequestDetails {
  readonly body?: unknown;
}

/** A request, optionally with a JSON body, whose success response has no content. */
interface EmptyResponseRequest extends SerializableRequest {
  readonly expectedStatus: number;
}

export async function requestJson<T>(
  fetchImplementation: typeof globalThis.fetch,
  request: JsonRequest<T>,
): Promise<T> {
  const response = await sendRequest(fetchImplementation, request);
  const responseBody = await readResponseBody(response, request);
  assertResponseStatus(response, responseBody, request);

  let value: unknown;
  try {
    value = JSON.parse(responseBody);
  } catch (cause) {
    throw new EmulationClientError(
      `${formatRequest(request)} returned invalid JSON`,
      { ...request, status: response.status, responseBody },
      { cause },
    );
  }

  const parsedResponse = request.responseSchema.safeParse(value);
  if (!parsedResponse.success) {
    throw new EmulationClientError(
      `${formatRequest(request)} returned a response that does not match its contract: ${
        z.prettifyError(parsedResponse.error)
      }`,
      { ...request, status: response.status, responseBody },
    );
  }

  return parsedResponse.data;
}

/** Requests binary content, such as a file's, and returns it as bytes. */
export async function requestBytes(
  fetchImplementation: typeof globalThis.fetch,
  request: RawResponseRequest,
): Promise<Uint8Array> {
  const response = await sendRequest(fetchImplementation, request);
  if (response.status !== request.expectedStatus) {
    const responseBody = await readResponseBody(response, request);
    assertResponseStatus(response, responseBody, request);
  }
  try {
    return new Uint8Array(await response.arrayBuffer());
  } catch (cause) {
    throw new EmulationClientError(
      `Could not read the response from ${formatRequest(request)}`,
      { ...request, status: response.status },
      { cause },
    );
  }
}

export async function requestEmptyResponse(
  fetchImplementation: typeof globalThis.fetch,
  request: EmptyResponseRequest,
): Promise<void> {
  const response = await sendRequest(fetchImplementation, request);
  if (response.status === request.expectedStatus) {
    return;
  }

  const responseBody = await readResponseBody(response, request);
  assertResponseStatus(response, responseBody, request);
}

export function normalizeUrlRoot(value: string | URL, parameterName: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch (cause) {
    throw new TypeError(`${parameterName} must be an absolute URL`, { cause });
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new TypeError(`${parameterName} must use the http or https protocol`);
  }
  if (url.search !== '' || url.hash !== '') {
    throw new TypeError(`${parameterName} must not contain a query string or fragment`);
  }
  if (!url.pathname.endsWith('/')) {
    url.pathname += '/';
  }

  return url;
}

async function sendRequest(
  fetchImplementation: typeof globalThis.fetch,
  request: SerializableRequest & AbortableRequest,
): Promise<Response> {
  let serializedRequestBody: string | undefined;
  if (request.body !== undefined) {
    try {
      serializedRequestBody = JSON.stringify(request.body);
    } catch (cause) {
      throw new EmulationClientError(
        `Could not serialize the request body for ${formatRequest(request)}`,
        request,
        { cause },
      );
    }
  }

  const { signal } = request;
  if (signal?.aborted) {
    throw createAbandonedRequestError(request, signal);
  }
  let pendingResponse: Promise<Response> | undefined;
  try {
    pendingResponse = fetchImplementation(request.url, {
      method: request.method,
      headers: serializedRequestBody === undefined
        ? undefined
        : { 'Content-Type': 'application/json' },
      body: serializedRequestBody,
      signal,
    });
    return await settleUnlessAborted(pendingResponse, signal);
  } catch (cause) {
    if (signal?.aborted) {
      // A transport that ignores the signal may still deliver the response, which nobody reads.
      pendingResponse?.then((response) => response.body?.cancel()).catch(() => {});
      throw createAbandonedRequestError(request, signal);
    }
    throw new EmulationClientError(`${formatRequest(request)} failed`, request, { cause });
  }
}

async function readResponseBody(response: Response, request: AbortableRequest): Promise<string> {
  const { signal } = request;
  try {
    return await readResponseText(response, signal);
  } catch (cause) {
    if (signal?.aborted) {
      throw createAbandonedRequestError(request, signal, response.status);
    }
    throw new EmulationClientError(
      `Could not read the response from ${formatRequest(request)}`,
      { ...request, status: response.status },
      { cause },
    );
  }
}

/** Settles as `promise` does, unless `signal` aborts first, which rejects with its reason. */
function settleUnlessAborted<T>(promise: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (signal === undefined) {
    return promise;
  }
  return new Promise<T>((resolve, reject) => {
    const rejectWithReason = () => reject(signal.reason);
    signal.addEventListener('abort', rejectWithReason, { once: true });
    // The signal may have aborted while the promise was being created, as in a transport's call.
    if (signal.aborted) {
      rejectWithReason();
    }
    promise.then(resolve, reject).finally(() =>
      signal.removeEventListener('abort', rejectWithReason)
    );
  });
}

/**
 * Reads a response's body as UTF-8 text, as `Response.text` does, except that a signal that aborts
 * cancels the body, which ends a read that would otherwise wait for a stalled stream.
 */
async function readResponseText(
  response: Response,
  signal: AbortSignal | undefined,
): Promise<string> {
  if (response.body === null) {
    signal?.throwIfAborted();
    return '';
  }
  const reader = response.body.getReader();
  const cancelBody = () => {
    reader.cancel(signal?.reason).catch(() => {});
  };
  signal?.addEventListener('abort', cancelBody, { once: true });
  if (signal?.aborted) {
    cancelBody();
  }
  try {
    const decoder = new TextDecoder();
    let text = '';
    for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
      text += decoder.decode(chunk.value, { stream: true });
    }
    // A cancelled body ends like a complete one, so only the signal tells them apart.
    signal?.throwIfAborted();
    return text + decoder.decode();
  } finally {
    signal?.removeEventListener('abort', cancelBody);
    reader.releaseLock();
  }
}

function createAbandonedRequestError(
  request: RequestDetails,
  signal: AbortSignal,
  status?: number,
): EmulationClientError {
  return new EmulationClientError(
    `${formatRequest(request)} was abandoned before its response was read`,
    { method: request.method, url: request.url, status },
    { cause: signal.reason },
  );
}

/**
 * Throws for a response of another status than the request expects: an `EmulationControlError` for
 * a refusal whose body is the emulator's JSON error body, and otherwise an `EmulationClientError`
 * with the status and the raw body.
 */
function assertResponseStatus(
  response: Response,
  responseBody: string,
  request: JsonRequest<unknown> | RawResponseRequest,
): void {
  if (response.status === request.expectedStatus) {
    return;
  }
  const unexpectedStatus = `${
    formatRequest(request)
  } returned HTTP ${response.status}; expected ${request.expectedStatus}`;
  const errorBody = response.status >= 400 ? readControlErrorBody(responseBody) : undefined;
  if (errorBody === undefined) {
    throw new EmulationClientError(unexpectedStatus, {
      ...request,
      status: response.status,
      responseBody,
    });
  }
  throw new EmulationControlError(`${unexpectedStatus}: ${formatControlErrorBody(errorBody)}`, {
    method: request.method,
    url: request.url,
    status: response.status,
    responseBody,
    body: errorBody,
  });
}

/** Reads a refusal's body as the emulator's JSON error body; `undefined` for any other body. */
function readControlErrorBody(responseBody: string): ControlErrorBody | undefined {
  let value: unknown;
  try {
    value = JSON.parse(responseBody);
  } catch {
    return undefined;
  }
  const errorBody = controlErrorBodySchema.safeParse(value);
  return errorBody.success ? errorBody.data : undefined;
}

/** Describes a refusal by its reason and each issue, as `body.text: invalid_type (…)`. */
function formatControlErrorBody(body: ControlErrorBody): string {
  return body.issues === undefined
    ? body.reason
    : `${body.reason}; ${body.issues.map(formatControlRequestIssue).join('; ')}`;
}

function formatControlRequestIssue({ source, path, code, message }: ControlRequestIssue): string {
  const location = path.reduce<string>(
    (prefix, segment) =>
      typeof segment === 'number' ? `${prefix}[${segment}]` : `${prefix}.${segment}`,
    source,
  );
  return `${location}: ${code} (${message})`;
}

function formatRequest(request: RequestDetails): string {
  return `${request.method} ${request.url}`;
}
