/**
 * Calls control API operations as their contracts declare them: the method, the path with its
 * parameters, the query and the JSON body come from the contract, and the success response is read
 * by its kind, as JSON the contract's schema checks, as no content, or as bytes.
 */
import type { z } from 'zod';

import {
  type BytesSuccessContract,
  type ControlOperationContract,
  type ControlOperationRequest,
  type EmptySuccessContract,
  type JsonSuccessContract,
  readPathPlaceholders,
} from '../../control_contracts/operation_contract.ts';
import { requestBytes, requestEmptyResponse, requestJson } from './utils.ts';

/** Where and how a client sends control requests. */
export interface ControlOperationTransport {
  /** The emulator's root URL, ending in `/`, which contract paths are relative to. */
  readonly serverRoot: URL;
  readonly fetch: typeof globalThis.fetch;
}

/** Calls an operation whose success response is JSON, and returns it as the contract reads it. */
export function callJsonOperation<Contract extends JsonSuccessContract>(
  transport: ControlOperationTransport,
  contract: Contract,
  request: ControlOperationRequest<Contract>,
): Promise<z.output<Contract['success']['body']['schema']>> {
  return requestJson<Contract['success']['body']['schema']>(transport.fetch, {
    method: contract.method,
    url: buildOperationUrl(transport.serverRoot, contract, request),
    expectedStatus: contract.success.status,
    responseSchema: contract.success.body.schema,
    body: request.body,
  });
}

/** Calls an operation whose success response has no content. */
export function callEmptyOperation<Contract extends EmptySuccessContract>(
  transport: ControlOperationTransport,
  contract: Contract,
  request: ControlOperationRequest<Contract>,
): Promise<void> {
  return requestEmptyResponse(transport.fetch, {
    method: contract.method,
    url: buildOperationUrl(transport.serverRoot, contract, request),
    expectedStatus: contract.success.status,
    body: request.body,
  });
}

/** Calls an operation whose success response is bytes, and returns them. */
export function callBytesOperation<Contract extends BytesSuccessContract>(
  transport: ControlOperationTransport,
  contract: Contract,
  request: ControlOperationRequest<Contract>,
): Promise<Uint8Array> {
  return requestBytes(transport.fetch, {
    method: contract.method,
    url: buildOperationUrl(transport.serverRoot, contract, request),
    expectedStatus: contract.success.status,
    body: request.body,
  });
}

/**
 * The absolute URL of a request: the contract's path with each placeholder replaced by its
 * encoded parameter, and the query's parameters, which an omitted optional one is left out of.
 *
 * @throws {TypeError} when a path or query parameter is not text, which only a value its type does
 * not describe can be.
 */
function buildOperationUrl(
  serverRoot: URL,
  contract: ControlOperationContract,
  { params, query }: { readonly params?: object; readonly query?: object },
): string {
  const parameterValues = new Map(Object.entries(params ?? {}));
  let path: string = contract.path;
  for (const name of readPathPlaceholders(contract.path)) {
    path = path.replace(
      `{${name}}`,
      encodeURIComponent(readTextParameter(contract, name, parameterValues.get(name))),
    );
  }
  const url = new URL(path.slice(1), serverRoot);
  for (const [name, value] of Object.entries(query ?? {})) {
    if (value !== undefined) {
      url.searchParams.append(name, readTextParameter(contract, name, value));
    }
  }
  return url.href;
}

function readTextParameter(
  contract: ControlOperationContract,
  name: string,
  value: unknown,
): string {
  if (typeof value !== 'string') {
    throw new TypeError(`${contract.operationId} takes its ${name} parameter as text`);
  }
  return value;
}
