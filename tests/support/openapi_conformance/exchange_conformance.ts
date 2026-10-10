/**
 * Checks one HTTP exchange with the emulation API against the OpenAPI document: which operation
 * the request addresses, whether the document allows the request, and whether the response is one
 * the document says that operation answers with.
 */
import { type DocumentSchemas, JsonSchemaValidator } from './json_schema_validator.ts';
import { OperationMatcher } from './operation_matcher.ts';
import { type OpenApiDocument, readOpenApiDocument } from './openapi_document.ts';
import {
  apiSurfaceOf,
  type ExchangeRecord,
  type RequestClassification,
} from './exchange_record.ts';
import { classifyRequest } from './request_classification.ts';
import {
  findDocumentedResponse,
  findResponseViolations,
  type SerializedResponse,
} from './response_conformance.ts';
import { findUndocumentedRouteAllowance } from './undocumented_route_allowances.ts';

export interface CheckedRequest {
  readonly method: string;
  readonly url: URL;
  readonly headers: Headers;
  readonly body: Uint8Array;
}

/**
 * Bot API requests stay unclassified: Telegram's conventions for their parameters, such as text
 * for any value and parameters in the query string, are more than the document's JSON Schemas
 * model.
 */
const BOT_API_REQUEST_CLASSIFICATION: RequestClassification = {
  validity: 'unclassified',
  reason: "Bot API parameters follow Telegram's conventions, which the document's schemas do not " +
    'model',
};

export class OpenApiConformanceChecker {
  readonly #document: OpenApiDocument;
  readonly #matcher: OperationMatcher;
  readonly #validator: JsonSchemaValidator;

  constructor(document: OpenApiDocument) {
    this.#document = document;
    this.#matcher = new OperationMatcher(document);
    this.#validator = new JsonSchemaValidator(document.schemaFiles);
  }

  checkExchange(request: CheckedRequest, response: SerializedResponse): ExchangeRecord {
    const path = request.url.pathname;
    const recordedRequest = { method: request.method, path, query: request.url.search };
    const match = this.#matcher.match(request.method, path);
    if (match.kind !== 'operation') {
      const pathTemplate = match.kind === 'undocumented-operation' ? match.pathTemplate : undefined;
      const allowance = findUndocumentedRouteAllowance({ path, pathTemplate });
      if (allowance !== undefined) {
        return {
          request: recordedRequest,
          status: response.status,
          route: { kind: 'allowed-undocumented', allowanceReason: allowance.reason },
          violations: [],
        };
      }
      return {
        request: recordedRequest,
        status: response.status,
        route: { kind: 'undocumented' },
        violations: [
          pathTemplate === undefined
            ? 'the document lists no path that matches the request'
            : `the document describes no ${request.method} operation on ${pathTemplate}`,
        ],
      };
    }
    const { operation } = match;
    const surface = apiSurfaceOf(operation.pathTemplate);
    const schemas: DocumentSchemas = {
      validator: this.#validator,
      schemaFiles: this.#document.schemaFiles,
    };
    return {
      request: recordedRequest,
      status: response.status,
      route: {
        kind: 'documented',
        surface,
        operationId: operation.operationId,
        method: operation.method,
        pathTemplate: operation.pathTemplate,
        statusKey: findDocumentedResponse(operation, response.status)?.statusKey,
        requestClassification: surface === 'bot-api'
          ? BOT_API_REQUEST_CLASSIFICATION
          : classifyRequest(
            operation,
            { ...request, pathParameters: match.pathParameters },
            schemas,
          ),
      },
      violations: findResponseViolations(operation, response, schemas),
    };
  }
}

let repositoryChecker: OpenApiConformanceChecker | undefined;

/** The checker for the repository's OpenAPI document, read when it is first needed. */
export function repositoryConformanceChecker(): OpenApiConformanceChecker {
  repositoryChecker ??= new OpenApiConformanceChecker(readOpenApiDocument());
  return repositoryChecker;
}
