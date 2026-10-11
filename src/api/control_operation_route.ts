/**
 * Registers control routes from their operations' contracts: the route's method and path come from
 * the contract, the request is decoded by its wire schemas, the handler's response is typed by the
 * responses it declares, and a success carries the action receipt the contract declares.
 */
import type { Context, Hono } from 'hono';

import {
  type ControlOperationContract,
  type ControlOperationResponse,
  type DecodedControlRequest,
  readPathPlaceholders,
} from './contracts/operation_contract.ts';
import { isContentTypeInRange } from './http_grammar/media_type.ts';
import type { EmulationSession } from '../types/emulation_session.ts';
import {
  invalidControlRequestResponse,
  sessionNotFoundResponse,
} from './control_error_response.ts';
import {
  type ActionReceipt,
  captureActionReceipt,
  createdSessionReceipt,
  writeActionReceiptHeaders,
} from './sessions/action_receipt.ts';
import {
  createPathParameterReader,
  createQueryReader,
  type PathParameterReader,
  type QueryReader,
} from './control_parameter_reading.ts';
import type { ControlRequestInputReading } from './sessions/control_request_input.ts';
import { readJsonRequestBody } from './sessions/json_request_body.ts';
import type { SessionRouteContextTypes } from './sessions/session_route_context_types.ts';

/**
 * Answers a decoded request with one of the responses its operation declares. A route answers
 * the refusals that other parts of the server give, such as a missing session's, only when it
 * finds them itself.
 */
export type ControlOperationHandler<Contract extends ControlOperationContract> = (
  request: DecodedControlRequest<Contract>,
  context: Context<SessionRouteContextTypes>,
) => ControlOperationResponse<Contract> | Promise<ControlOperationResponse<Contract>>;

/** A response as the route serializes it, whichever operation's it is. */
interface SerializableResponse {
  readonly status: number;
  readonly headers?: Readonly<Record<string, unknown>>;
  readonly body?: unknown;
  readonly mediaType?: string;
  /** The session a success created, which its receipt names when the contract says so. */
  readonly createdSessionId?: string;
}

/** The media type of a JSON body, as control routes answer with it. */
const JSON_MEDIA_TYPE = 'application/json';

/**
 * Registers `contract`'s operation on `routes`, which serve the path template `mountPath` within
 * the server, such as `/sessions/{sessionId}/bots`. A request whose path parameters, query, or
 * body break the contract is answered with `400` and its issues, before `handle` is called.
 *
 * A receipt captured `before_action` is the head of the request's session's bot activity log just
 * before `handle` is called, in the same synchronous step, so a handler that executes its action
 * before it first waits gives its effects no chance to be recorded before the receipt. A handler
 * that waits first still answers with a receipt that its effects follow, only an earlier one.
 *
 * Such an acting operation's handler executes as a command of its session, as
 * `answerWithActionReceipt` describes, and a session that ended while the request was decoded
 * answers as one that does not exist.
 *
 * @throws {Error} when the contract's path is not within `mountPath`, or a path or query parameter
 * takes a value that no parameter text writes.
 */
export function registerControlOperation<Contract extends ControlOperationContract>(
  routes: Hono<SessionRouteContextTypes>,
  mountPath: string,
  contract: Contract,
  handle: NoInfer<ControlOperationHandler<Contract>>,
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
    if (contract.success.actionReceipt !== 'before_action') {
      const response: SerializableResponse = await handle(request.value, context);
      return serializeControlResponse(contract, response, undefined);
    }
    const session = readActionSession(contract, context);
    const receiptBeforeAction = captureActionReceipt(session);
    // The action executes as a command of its session, as `answerWithActionReceipt` describes.
    const action = session.transactions.execute(() => handle(request.value, context));
    if (!action.executed) {
      return sessionNotFoundResponse(context);
    }
    const response: SerializableResponse = await action.result;
    return serializeControlResponse(contract, response, receiptBeforeAction);
  });
}

/**
 * The session the request names, whose log a receipt captured before the action is in.
 *
 * @throws {Error} when the route is not served within a session, which only a contract that
 * declares such a receipt for a route outside one can make.
 */
function readActionSession(
  contract: ControlOperationContract,
  context: Context<SessionRouteContextTypes>,
): EmulationSession {
  // The session routes' middleware sets the session for every route within one; Hono's types
  // cannot tell that a route outside one, such as the session collection's, has none.
  const session: EmulationSession | undefined = context.get('emulationSession');
  if (session === undefined) {
    throw new Error(`${contract.operationId} captures a receipt outside a session`);
  }
  return session;
}

/**
 * The receipt a success carries: the one captured before its action, or the one of the session it
 * created; `undefined` for an operation that declares none.
 *
 * @throws {Error} when a success that names a created session's receipt names no session.
 */
function readSuccessReceipt(
  contract: ControlOperationContract,
  response: SerializableResponse,
  receiptBeforeAction: ActionReceipt | undefined,
): ActionReceipt | undefined {
  switch (contract.success.actionReceipt) {
    case undefined:
      return undefined;
    case 'before_action':
      return receiptBeforeAction;
    case 'session_creation':
      if (response.createdSessionId === undefined) {
        throw new Error(`${contract.operationId} answered without the session it created`);
      }
      return createdSessionReceipt(response.createdSessionId);
    default: {
      const unhandledSource: never = contract.success.actionReceipt;
      throw new Error(`Unhandled action receipt source: ${unhandledSource}`);
    }
  }
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
 * an empty success without content, and a bytes success as its media type. A success carries the
 * action receipt its operation declares; a refusal carries none.
 *
 * @throws {Error} when the handler gave a status the operation does not declare, or a bytes body
 * that is not bytes, which only a handler its types do not describe can give, or bytes of a media
 * type outside the contract's range.
 */
function serializeControlResponse(
  contract: ControlOperationContract,
  response: SerializableResponse,
  receiptBeforeAction: ActionReceipt | undefined,
): Response {
  const { status, body, mediaType } = response;
  const headers = toHeaders(contract, response.headers ?? {});
  if (status !== contract.success.status) {
    if (!Object.hasOwn(contract.refusals, status)) {
      throw new Error(`${contract.operationId} does not declare a ${status} response`);
    }
    return jsonResponse(status, headers, body);
  }
  const receipt = readSuccessReceipt(contract, response, receiptBeforeAction);
  if (receipt !== undefined) {
    setHeaders(headers, writeActionReceiptHeaders(receipt));
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
      headers.set('Content-Type', mediaType);
      return new Response(toArrayBufferBytes(body), { status, headers });
    default: {
      const unhandledBody: never = successBody;
      throw new Error(`Unhandled response body: ${JSON.stringify(unhandledBody)}`);
    }
  }
}

/**
 * The headers a handler gave its response, leaving out an optional header the response does not
 * carry. They are kept as `Headers`, which name each header without regard to letter case, so
 * that a header the route writes later replaces any the handler gave rather than joining it.
 *
 * @throws {Error} when a header's value is not text, which only a contract whose header schema
 * gives another type can make.
 */
function toHeaders(
  contract: ControlOperationContract,
  handlerHeaders: Readonly<Record<string, unknown>>,
): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(handlerHeaders)) {
    if (value === undefined) continue;
    if (typeof value !== 'string') {
      throw new Error(`${contract.operationId} gave its ${name} header a value that is not text`);
    }
    headers.set(name, value);
  }
  return headers;
}

/** Sets each of the headers by name, replacing a header of that name in any letter case. */
function setHeaders(headers: Headers, values: Readonly<Record<string, string>>): void {
  for (const [name, value] of Object.entries(values)) {
    headers.set(name, value);
  }
}

/** The same bytes over an `ArrayBuffer`, which a response body needs, copying only shared memory. */
function toArrayBufferBytes(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  return bytes.buffer instanceof ArrayBuffer
    ? new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    : new Uint8Array(bytes);
}

function jsonResponse(status: number, headers: Headers, body: unknown): Response {
  headers.set('Content-Type', JSON_MEDIA_TYPE);
  return new Response(JSON.stringify(body), { status, headers });
}
