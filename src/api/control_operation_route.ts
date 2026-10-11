/**
 * Registers control routes from their operations' contracts: the route's method and path come from
 * the contract, the request is decoded by its wire schemas, and the handler's response is typed by
 * the responses it declares.
 */
import type { Context, Env, Hono } from 'hono';

import {
  type ControlOperationContract,
  type ControlOperationResponse,
  type DecodedControlRequest,
  readPathPlaceholders,
} from '../../control_contracts/operation_contract.ts';
import { isContentTypeInRange } from '../../control_contracts/media_type.ts';
import { invalidControlRequestResponse } from './control_error_response.ts';
import {
  createPathParameterReader,
  createQueryReader,
  type PathParameterReader,
  type QueryReader,
} from './control_parameter_reading.ts';
import type { ControlRequestInputReading } from './sessions/control_request_input.ts';
import { readJsonRequestBody } from './sessions/json_request_body.ts';

/**
 * Answers a decoded request with one of the responses its operation declares. A route answers
 * the refusals that other parts of the server give, such as a missing session's, only when it
 * finds them itself.
 */
export type ControlOperationHandler<
  Contract extends ControlOperationContract,
  RouteEnv extends Env,
> = (
  request: DecodedControlRequest<Contract>,
  context: Context<RouteEnv>,
) => ControlOperationResponse<Contract> | Promise<ControlOperationResponse<Contract>>;

/** A response as the route serializes it, whichever operation's it is. */
interface SerializableResponse {
  readonly status: number;
  readonly headers?: Readonly<Record<string, unknown>>;
  readonly body?: unknown;
  readonly mediaType?: string;
}

/** The media type of a JSON body, as control routes answer with it. */
const JSON_MEDIA_TYPE = 'application/json';

/**
 * Registers `contract`'s operation on `routes`, which serve the path template `mountPath` within
 * the server, such as `/sessions/{sessionId}/bots`. A request whose path parameters, query, or
 * body break the contract is answered with `400` and its issues, before `handle` is called.
 *
 * @throws {Error} when the contract's path is not within `mountPath`, or a path or query parameter
 * takes a value that no parameter text writes.
 */
export function registerControlOperation<
  Contract extends ControlOperationContract,
  RouteEnv extends Env,
>(
  routes: Hono<RouteEnv>,
  mountPath: string,
  contract: Contract,
  handle: NoInfer<ControlOperationHandler<Contract, RouteEnv>>,
): void {
  const parameterReaders: ParameterReaders = {
    path: contract.params === undefined
      ? undefined
      : createPathParameterReader(contract, contract.params),
    query: contract.query === undefined ? undefined : createQueryReader(contract, contract.query),
  };
  routes.on(contract.method, toRoutePath(contract, mountPath), async (context) => {
    const request = await decodeControlRequest(contract, parameterReaders, context);
    if (!request.valid) {
      return invalidControlRequestResponse(context, request.issues);
    }
    const response: SerializableResponse = await handle(request.value, context);
    return serializeControlResponse(contract, response);
  });
}

/** The Hono path of the operation within its mount: `/:sessionId` for `/sessions/{sessionId}`. */
function toRoutePath(contract: ControlOperationContract, mountPath: string): string {
  if (contract.path !== mountPath && !contract.path.startsWith(`${mountPath}/`)) {
    throw new Error(`${contract.operationId}'s path ${contract.path} is not within ${mountPath}`);
  }
  let routePath = contract.path.slice(mountPath.length);
  for (const name of readPathPlaceholders(routePath)) {
    routePath = routePath.replace(`{${name}}`, `:${name}`);
  }
  return routePath === '' ? '/' : routePath;
}

/** The readers of an operation's path parameters and query, for the parts it reads. */
interface ParameterReaders {
  readonly path: PathParameterReader | undefined;
  readonly query: QueryReader | undefined;
}

/**
 * Reads each part of the request the operation reads with the contract's wire schema, reporting
 * the issues of every part that breaks it.
 */
async function decodeControlRequest<Contract extends ControlOperationContract>(
  contract: Contract,
  parameterReaders: ParameterReaders,
  context: Context,
): Promise<ControlRequestInputReading<DecodedControlRequest<Contract>>> {
  const readings: [part: string, reading: ControlRequestInputReading<unknown>][] = [];
  if (parameterReaders.path !== undefined) {
    readings.push(['params', parameterReaders.path(context.req.param())]);
  }
  if (parameterReaders.query !== undefined) {
    readings.push(['query', parameterReaders.query(new URL(context.req.url).searchParams)]);
  }
  if (contract.body !== undefined) {
    readings.push([
      'body',
      await readJsonRequestBody(context.req, contract.body.schema, {
        allowsEmptyBody: !contract.body.required,
      }),
    ]);
  }

  const issues = readings.flatMap(([, reading]) => reading.valid ? [] : reading.issues);
  if (issues.length > 0) {
    return { valid: false, issues };
  }
  const decodedRequest = Object.fromEntries(
    readings.map(([part, reading]) => [part, reading.valid ? reading.value : undefined]),
  );
  // Each part is the output of the contract's own schema for it, and a part the contract does not
  // read is absent, which is what `DecodedControlRequest` describes; TypeScript cannot relate the
  // contract's generic schemas to that conditional type.
  return { valid: true, value: decodedRequest as DecodedControlRequest<Contract> };
}

/**
 * Writes a handler's response as its operation declares it: a refusal or a JSON success as JSON,
 * an empty success without content, and a bytes success as its media type.
 *
 * @throws {Error} when the handler gave a status the operation does not declare, or a bytes body
 * that is not bytes, which only a handler its types do not describe can give, or bytes of a media
 * type outside the contract's range.
 */
function serializeControlResponse(
  contract: ControlOperationContract,
  response: SerializableResponse,
): Response {
  const { status, body, mediaType } = response;
  const headers = toHeaderValues(contract, response.headers ?? {});
  if (status !== contract.success.status) {
    if (!Object.hasOwn(contract.refusals, status)) {
      throw new Error(`${contract.operationId} does not declare a ${status} response`);
    }
    return jsonResponse(status, headers, body);
  }
  const successBody = contract.success.body;
  switch (successBody.kind) {
    case 'json':
      return jsonResponse(status, headers, body);
    case 'empty':
      return new Response(null, { status, headers });
    case 'bytes':
      if (!(body instanceof Uint8Array) || mediaType === undefined) {
        throw new Error(`${contract.operationId} answered without bytes and their media type`);
      }
      if (!isContentTypeInRange(mediaType, successBody.mediaTypeRange)) {
        throw new Error(
          `${contract.operationId} answered with bytes outside ${successBody.mediaTypeRange}`,
        );
      }
      return new Response(toArrayBufferBytes(body), {
        status,
        headers: { ...headers, 'Content-Type': mediaType },
      });
    default: {
      const unhandledBody: never = successBody;
      throw new Error(`Unhandled response body: ${JSON.stringify(unhandledBody)}`);
    }
  }
}

/**
 * The response's headers as text, leaving out an optional header the response does not carry.
 *
 * @throws {Error} when a header's value is not text, which only a contract whose header schema
 * gives another type can make.
 */
function toHeaderValues(
  contract: ControlOperationContract,
  headers: Readonly<Record<string, unknown>>,
): Record<string, string> {
  const headerValues: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined) continue;
    if (typeof value !== 'string') {
      throw new Error(`${contract.operationId} gave its ${name} header a value that is not text`);
    }
    headerValues[name] = value;
  }
  return headerValues;
}

/** The same bytes over an `ArrayBuffer`, which a response body needs, copying only shared memory. */
function toArrayBufferBytes(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  return bytes.buffer instanceof ArrayBuffer
    ? new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    : new Uint8Array(bytes);
}

function jsonResponse(
  status: number,
  headers: Readonly<Record<string, string>>,
  body: unknown,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, 'Content-Type': JSON_MEDIA_TYPE },
  });
}
