/**
 * Compares a serialized response with what the OpenAPI document says its operation answers with:
 * the status, the headers it declares, whether there is a body, its media type, and, for JSON, its
 * content.
 */
import type { DocumentSchemas } from './json_schema_validator.ts';
import {
  findDocumentedMediaType,
  isJsonMediaType,
  mediaTypeEssence,
  parseJsonBody,
} from './media_types.ts';
import type { DocumentedOperation, DocumentedResponse } from './openapi_document.ts';
import { coerceTextValue } from './text_value_coercion.ts';

export interface SerializedResponse {
  readonly status: number;
  readonly headers: Headers;
  readonly body: Uint8Array;
}

/** The entry of `operation.responses` that describes `status`, as OpenAPI resolves it. */
export function findDocumentedResponse(
  operation: DocumentedOperation,
  status: number,
): { readonly statusKey: string; readonly response: DocumentedResponse } | undefined {
  const statusKeys = [String(status), `${Math.floor(status / 100)}XX`, 'default'];
  for (const statusKey of statusKeys) {
    const response = operation.responses.get(statusKey);
    if (response !== undefined) return { statusKey, response };
  }
  return undefined;
}

/** Describes each way `response` departs from `operation`'s documentation; none when it conforms. */
export function findResponseViolations(
  operation: DocumentedOperation,
  response: SerializedResponse,
  schemas: DocumentSchemas,
): string[] {
  const documented = findDocumentedResponse(operation, response.status);
  if (documented === undefined) {
    return [
      `status ${response.status} is not documented; the operation documents ${
        [...operation.responses.keys()].join(', ')
      }`,
    ];
  }
  return [
    ...findHeaderViolations(documented.response, response.headers, schemas),
    ...findBodyViolations(documented.response, response, schemas),
  ];
}

function findHeaderViolations(
  documented: DocumentedResponse,
  headers: Headers,
  { validator, schemaFiles }: DocumentSchemas,
): string[] {
  const violations: string[] = [];
  for (const [headerName, header] of documented.headers) {
    const value = headers.get(headerName);
    if (value === null) {
      if (header.required) violations.push(`the required ${headerName} header is missing`);
      continue;
    }
    if (header.schema === undefined) continue;
    const headerValue = coerceTextValue(value, header.schema, schemaFiles);
    for (const violation of validator.findViolations(header.schema, headerValue)) {
      violations.push(`the ${headerName} header ${JSON.stringify(value)}: ${violation}`);
    }
  }
  return violations;
}

function findBodyViolations(
  documented: DocumentedResponse,
  response: SerializedResponse,
  schemas: DocumentSchemas,
): string[] {
  const contentType = response.headers.get('content-type');
  if (documented.content.size === 0) {
    return response.body.length === 0 ? [] : [
      `the response documents no body, but has ${response.body.length} bytes of ${
        contentType ?? 'content without a Content-Type'
      }`,
    ];
  }
  if (contentType === null) {
    return [
      response.body.length === 0
        ? 'the response documents a body, but has none'
        : 'the response has a body without a Content-Type',
    ];
  }
  const mediaType = mediaTypeEssence(contentType);
  const documentedMediaType = findDocumentedMediaType(documented.content, mediaType);
  if (documentedMediaType === undefined) {
    return [
      `the Content-Type ${contentType} is not documented; the response documents ${
        [...documented.content.keys()].join(', ')
      }`,
    ];
  }
  if (!isJsonMediaType(mediaType)) return [];
  const body = parseJsonBody(response.body);
  if (!body.parsed) return [`the ${mediaType} body is not JSON: ${body.reason}`];
  const { schema } = documentedMediaType.mediaType;
  if (schema === undefined) return [];
  return schemas.validator.findViolations(schema, body.value).map((violation) =>
    `the body: ${violation}`
  );
}
