/**
 * The shape of a control API operation's contract: one declaration of its HTTP wire facts, which
 * the server registers its route from and the TypeScript client infers its types from.
 *
 * A contract holds wire schemas only. They describe JSON as it crosses the wire, with no
 * transforms, so that a request schema's input type is what a client sends and its output type is
 * what the server decodes, defaults applied. Turning wire values into domain commands, and domain
 * results into wire values, is the job of codecs beside each route.
 */
import type { z } from 'zod';

import { isMediaRange } from '../http_grammar/media_type.ts';

export type ControlHttpMethod = 'DELETE' | 'GET' | 'PATCH' | 'POST' | 'PUT';

/** A JSON request body, which the operation may let a request leave out. */
export interface RequestBodyContract {
  /** Whether a request must send the body; one without it is read as an empty object. */
  readonly required: boolean;
  readonly schema: z.ZodType;
}

/** A success response's JSON body. */
export interface JsonResponseBodyContract<Schema extends z.ZodType = z.ZodType> {
  readonly kind: 'json';
  readonly schema: Schema;
}

/** A success response without content, such as a `204`. */
export interface EmptyResponseBodyContract {
  readonly kind: 'empty';
}

/** A success response whose content is bytes of a media type the response names, such as a file. */
export interface BytesResponseBodyContract {
  readonly kind: 'bytes';
  /**
   * The media type of the bytes, or the range of media types they may have, such as `image/*` or
   * the range of every media type; the response's `Content-Type` names the exact one.
   */
  readonly mediaTypeRange: string;
}

export type ResponseBodyContract =
  | JsonResponseBodyContract
  | EmptyResponseBodyContract
  | BytesResponseBodyContract;

/**
 * How a query parameter is written in a URL, other than as one `name=value` pair, which OpenAPI's
 * default `form` style writes for text, an integer, or a boolean:
 *
 * - `deepObject`: an object of text, one `name[member]=value` pair per member, as OpenAPI's
 *   `deepObject` style writes it;
 * - `json`: a JSON value, written as its JSON text in one `name=value` pair, as OpenAPI's
 *   `content: application/json` describes it.
 */
export type QueryParameterSerialization = 'deepObject' | 'json';

/** The response of an operation that succeeds. */
export interface SuccessResponseContract {
  readonly status: number;
  /** The headers the response carries, by name; an optional field is a header it may leave out. */
  readonly headers?: z.ZodObject;
  readonly body: ResponseBodyContract;
}

/**
 * One control API operation: its route, the parts of a request it reads, and its responses.
 *
 * `path` is an OpenAPI path template from the server root, such as `/sessions/{sessionId}`, and
 * `params` names exactly its placeholders. Path and query parameters arrive as text, and their
 * schemas describe the values that text stands for, as OpenAPI's parameter schemas do: text, an
 * integer written in decimal digits, or a boolean written `true` or `false`; or, for a query
 * parameter that `querySerialization` names, the object or JSON value it writes. A refusal always
 * answers with a JSON error body, so `refusals` gives the body schema of each status the
 * operation refuses a request with, whichever part of the server answers it.
 */
export interface ControlOperationContract {
  /** The OpenAPI document's `operationId` for the operation. */
  readonly operationId: string;
  readonly method: ControlHttpMethod;
  readonly path: `/${string}`;
  readonly params?: z.ZodObject;
  readonly query?: z.ZodObject;
  /** How each query parameter that is not one `name=value` pair is written, by its name. */
  readonly querySerialization?: { readonly [name: string]: QueryParameterSerialization };
  readonly body?: RequestBodyContract;
  readonly success: SuccessResponseContract;
  readonly refusals: { readonly [status: number]: z.ZodType };
}

/** Matches each `{name}` placeholder of a path template. */
const PATH_PLACEHOLDER_PATTERN = /\{([^{}]+)\}/g;

/**
 * Declares an operation's contract, keeping its literal types for the server and client to infer
 * from.
 *
 * @throws {Error} when `params` does not name exactly the placeholders of `path`,
 * `querySerialization` names a parameter that `query` does not, a bytes success declares text that
 * is no media range, or a refusal status is not an error status.
 */
export function defineControlOperation<const Contract extends ControlOperationContract>(
  contract: Contract,
): Contract {
  const placeholders = readPathPlaceholders(contract.path);
  const parameterNames = Object.keys(contract.params?.shape ?? {});
  if (
    placeholders.length !== parameterNames.length ||
    placeholders.some((placeholder) => !parameterNames.includes(placeholder))
  ) {
    throw new Error(
      `The params of ${contract.operationId} must name exactly the placeholders of ${contract.path}`,
    );
  }
  const queryParameterNames = Object.keys(contract.query?.shape ?? {});
  for (const name of Object.keys(contract.querySerialization ?? {})) {
    if (!queryParameterNames.includes(name)) {
      throw new Error(`${contract.operationId} serializes ${name}, which is no query parameter`);
    }
  }
  const successBody = contract.success.body;
  if (successBody.kind === 'bytes' && !isMediaRange(successBody.mediaTypeRange)) {
    throw new Error(
      `${contract.operationId} declares ${successBody.mediaTypeRange}, which is no media range`,
    );
  }
  for (const status of Object.keys(contract.refusals).map(Number)) {
    if (!Number.isInteger(status) || status < 400 || status > 599) {
      throw new Error(`${contract.operationId} refuses with ${status}, which is no error status`);
    }
  }
  return contract;
}

/** The names of a path template's placeholders, in order: `['sessionId']` for `/sessions/{sessionId}`. */
export function readPathPlaceholders(pathTemplate: string): string[] {
  return [...pathTemplate.matchAll(PATH_PLACEHOLDER_PATTERN)].map(([, name]) => name);
}

/**
 * What a client sends for an operation, in input semantics: a field the server defaults is
 * optional. A part the operation does not read is absent, and an optional body may be left out.
 */
export type ControlOperationRequest<Contract extends ControlOperationContract> =
  & (Contract['params'] extends z.ZodObject ? { readonly params: z.input<Contract['params']> }
    : { readonly params?: never })
  & (Contract['query'] extends z.ZodObject ? { readonly query: z.input<Contract['query']> }
    : { readonly query?: never })
  & (Contract['body'] extends RequestBodyContract
    ? Contract['body']['required'] extends true
      ? { readonly body: z.input<Contract['body']['schema']> }
    : { readonly body?: z.input<Contract['body']['schema']> }
    : { readonly body?: never });

/**
 * A request as the server decodes it, in output semantics: every default applied. A part the
 * operation does not read is absent.
 */
export type DecodedControlRequest<Contract extends ControlOperationContract> =
  & (Contract['params'] extends z.ZodObject ? { readonly params: z.output<Contract['params']> }
    : unknown)
  & (Contract['query'] extends z.ZodObject ? { readonly query: z.output<Contract['query']> }
    : unknown)
  & (Contract['body'] extends RequestBodyContract
    ? { readonly body: z.output<Contract['body']['schema']> }
    : unknown);

/** The body a success response carries: its JSON value, its bytes, or nothing. */
type SuccessBodyFields<Body extends ResponseBodyContract> = Body extends
  JsonResponseBodyContract<infer Schema> ? { readonly body: z.output<Schema> }
  : Body extends BytesResponseBodyContract
    ? { readonly body: Uint8Array; readonly mediaType: string }
  : { readonly body?: never };

type SuccessHeaderFields<Success extends SuccessResponseContract> = Success['headers'] extends
  z.ZodObject ? { readonly headers: z.output<Success['headers']> }
  : { readonly headers?: never };

/** A success response as a route gives it, in output semantics. */
export type ControlOperationSuccess<Contract extends ControlOperationContract> =
  & { readonly status: Contract['success']['status'] }
  & SuccessHeaderFields<Contract['success']>
  & SuccessBodyFields<Contract['success']['body']>;

/** A refusal as a route gives it: one of the operation's refusal statuses with its JSON body. */
export type ControlOperationRefusal<Contract extends ControlOperationContract> = {
  readonly [Status in keyof Contract['refusals'] & number]: {
    readonly status: Status;
    readonly body: z.output<Contract['refusals'][Status]>;
  };
}[keyof Contract['refusals'] & number];

/** Any response the operation declares, as a route gives it. */
export type ControlOperationResponse<Contract extends ControlOperationContract> =
  | ControlOperationSuccess<Contract>
  | ControlOperationRefusal<Contract>;

/** A contract whose success response has a JSON body. */
export type JsonSuccessContract = ControlOperationContract & {
  readonly success: { readonly body: JsonResponseBodyContract };
};

/** A contract whose success response has no content. */
export type EmptySuccessContract = ControlOperationContract & {
  readonly success: { readonly body: EmptyResponseBodyContract };
};

/** A contract whose success response is bytes. */
export type BytesSuccessContract = ControlOperationContract & {
  readonly success: { readonly body: BytesResponseBodyContract };
};

/** The JSON value of a success response, as a client reads it, in output semantics. */
export type ControlOperationResult<Contract extends JsonSuccessContract> = z.output<
  Contract['success']['body']['schema']
>;
