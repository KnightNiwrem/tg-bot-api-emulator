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

/** How a call of an operation whose success response is JSON is made. */
export interface JsonOperationCallOptions {
  /**
   * Abandons the call when it aborts, as `requestJson` describes, such as a bot activity read that
   * a wait no longer needs.
   */
  readonly signal?: AbortSignal;
}

/** Calls an operation whose success response is JSON, and returns it as the contract reads it. */
export function callJsonOperation<Contract extends JsonSuccessContract>(
  transport: ControlOperationTransport,
  contract: Contract,
  request: ControlOperationRequest<Contract>,
  { signal }: JsonOperationCallOptions = {},
): Promise<z.output<Contract['success']['body']['schema']>> {
  return requestJson<Contract['success']['body']['schema']>(transport.fetch, {
    method: contract.method,
    url: buildOperationUrl(transport.serverRoot, contract, request),
    expectedStatus: contract.success.status,
    responseSchema: contract.success.body.schema,
    body: request.body,
    ...(signal === undefined ? {} : { signal }),
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
 * A single-valued parameter is written as its text, an integer in decimal digits, or a boolean as
 * `true` or `false`; a `deepObject` one as a `name[member]=text` pair per member; and a `json` one
 * as the text `JSON.stringify` writes, which runs any `toJSON` hook its value has.
 *
 * @throws {TypeError} when a parameter's value is not one its serialization writes, which only a
 * value its type does not describe can be.
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
      encodeURIComponent(writeParameterText(contract, name, parameterValues.get(name))),
    );
  }
  const url = new URL(path.slice(1), serverRoot);
  for (const [name, value] of Object.entries(query ?? {})) {
    if (value === undefined) continue;
    const serialization = contract.querySerialization?.[name];
    switch (serialization) {
      case undefined:
        url.searchParams.append(name, writeParameterText(contract, name, value));
        break;
      case 'deepObject':
        for (const [member, memberValue] of readObjectMembers(contract, name, value)) {
          url.searchParams.append(
            `${name}[${member}]`,
            writeParameterText(contract, `${name}[${member}]`, memberValue),
          );
        }
        break;
      case 'json':
        url.searchParams.append(name, JSON.stringify(value));
        break;
      default: {
        const unhandledSerialization: never = serialization;
        throw new Error(`Unhandled query parameter serialization: ${unhandledSerialization}`);
      }
    }
  }
  return url.href;
}

/** The text of a single-valued parameter: text as it is, or a finite number's or boolean's. */
function writeParameterText(
  contract: ControlOperationContract,
  name: string,
  value: unknown,
): string {
  if (typeof value === 'string') return value;
  if ((typeof value === 'number' && Number.isFinite(value)) || typeof value === 'boolean') {
    return String(value);
  }
  throw new TypeError(
    `${contract.operationId} takes its ${name} parameter as text, a number, or a boolean`,
  );
}

function readObjectMembers(
  contract: ControlOperationContract,
  name: string,
  value: unknown,
): [member: string, value: unknown][] {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${contract.operationId} takes its ${name} parameter as an object`);
  }
  return Object.entries(value);
}
