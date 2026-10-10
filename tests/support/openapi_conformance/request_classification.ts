/**
 * Classifies a request as one its operation's documentation allows or not: its path parameters,
 * its query string and its body. Tests send invalid requests on purpose, so a classification is
 * recorded, never enforced.
 */
import type { RequestClassification } from './exchange_record.ts';
import type { DocumentSchemas } from './json_schema_validator.ts';
import {
  findDocumentedMediaType,
  isJsonMediaType,
  mediaTypeEssence,
  parseJsonBody,
} from './media_types.ts';
import type { DocumentedOperation, DocumentedParameter } from './openapi_document.ts';
import { coerceTextValue } from './text_value_coercion.ts';

export interface SerializedRequest {
  readonly url: URL;
  readonly headers: Headers;
  readonly body: Uint8Array;
  /** Percent-decoded path parameters, by name, as the request's path gives them. */
  readonly pathParameters: ReadonlyMap<string, string>;
}

/** A query parameter name in OpenAPI's `deepObject` style: `parameters[callback_query_id]`. */
const DEEP_OBJECT_QUERY_NAME_PATTERN = /^([^[\]]+)\[([^[\]]+)\]$/;

export function classifyRequest(
  operation: DocumentedOperation,
  request: SerializedRequest,
  schemas: DocumentSchemas,
): RequestClassification {
  const reasons = [
    ...findPathParameterViolations(operation, request, schemas),
    ...findQueryViolations(operation, request.url.searchParams, schemas),
  ];
  const body = classifyBody(operation, request, schemas);
  if (body.validity === 'unclassified') return body;
  if (body.validity === 'invalid') reasons.push(...body.reasons);
  return reasons.length === 0 ? { validity: 'valid' } : { validity: 'invalid', reasons };
}

function findPathParameterViolations(
  operation: DocumentedOperation,
  request: SerializedRequest,
  schemas: DocumentSchemas,
): string[] {
  return operation.parameters
    .filter((parameter) => parameter.location === 'path')
    .flatMap((parameter) => {
      const text = request.pathParameters.get(parameter.name);
      if (text === undefined) return [`the path parameter ${parameter.name} is missing`];
      return findParameterValueViolations(
        parameter,
        coerceTextValue(text, parameter.schema, schemas.schemaFiles),
        schemas,
      );
    });
}

function findQueryViolations(
  operation: DocumentedOperation,
  searchParameters: URLSearchParams,
  schemas: DocumentSchemas,
): string[] {
  const queryParameters = new Map(
    operation.parameters
      .filter((parameter) => parameter.location === 'query')
      .map((parameter) => [parameter.name, parameter]),
  );
  const violations: string[] = [];
  const formValues = new Map<string, string[]>();
  const deepObjectValues = new Map<string, Map<string, string>>();
  for (const [name, value] of searchParameters) {
    const formParameter = queryParameters.get(name);
    if (formParameter !== undefined && formParameter.style === 'form') {
      formValues.set(name, [...(formValues.get(name) ?? []), value]);
      continue;
    }
    const deepObjectName = DEEP_OBJECT_QUERY_NAME_PATTERN.exec(name);
    const deepObjectParameter = deepObjectName === null
      ? undefined
      : queryParameters.get(deepObjectName[1]);
    if (deepObjectName === null || deepObjectParameter?.style !== 'deepObject') {
      violations.push(`the query parameter ${name} is not documented`);
      continue;
    }
    const properties = deepObjectValues.get(deepObjectName[1]) ?? new Map<string, string>();
    if (properties.has(deepObjectName[2])) {
      violations.push(`the query parameter ${name} is repeated`);
    }
    properties.set(deepObjectName[2], value);
    deepObjectValues.set(deepObjectName[1], properties);
  }
  for (const parameter of queryParameters.values()) {
    const value = queryParameterValue(parameter, formValues, deepObjectValues, schemas);
    if (value.kind === 'absent') {
      if (parameter.required) {
        violations.push(`the required query parameter ${parameter.name} is missing`);
      }
    } else if (value.kind === 'repeated') {
      violations.push(`the query parameter ${parameter.name} is repeated`);
    } else {
      violations.push(...findParameterValueViolations(parameter, value.value, schemas));
    }
  }
  return violations;
}

type QueryParameterValue =
  | { readonly kind: 'absent' }
  | { readonly kind: 'repeated' }
  | { readonly kind: 'present'; readonly value: unknown };

function queryParameterValue(
  parameter: DocumentedParameter,
  formValues: ReadonlyMap<string, readonly string[]>,
  deepObjectValues: ReadonlyMap<string, ReadonlyMap<string, string>>,
  { schemaFiles }: DocumentSchemas,
): QueryParameterValue {
  if (parameter.style === 'deepObject') {
    const properties = deepObjectValues.get(parameter.name);
    return properties === undefined
      ? { kind: 'absent' }
      : { kind: 'present', value: Object.fromEntries(properties) };
  }
  const values = formValues.get(parameter.name);
  if (values === undefined) return { kind: 'absent' };
  // The document has no array-valued query parameter, so a repeated one is always a mistake.
  if (values.length > 1) return { kind: 'repeated' };
  return { kind: 'present', value: coerceTextValue(values[0], parameter.schema, schemaFiles) };
}

function findParameterValueViolations(
  parameter: DocumentedParameter,
  value: unknown,
  { validator }: DocumentSchemas,
): string[] {
  if (parameter.schema === undefined) return [];
  return validator.findViolations(parameter.schema, value).map((violation) =>
    `the ${parameter.location} parameter ${parameter.name}: ${violation}`
  );
}

function classifyBody(
  operation: DocumentedOperation,
  request: SerializedRequest,
  { validator }: DocumentSchemas,
): RequestClassification {
  const { requestBody } = operation;
  if (requestBody === undefined) {
    return request.body.length === 0 ? { validity: 'valid' } : {
      validity: 'invalid',
      reasons: ['the operation documents no request body, but one was sent'],
    };
  }
  if (request.body.length === 0) {
    return requestBody.required
      ? { validity: 'invalid', reasons: ['the required request body is missing'] }
      : { validity: 'valid' };
  }
  const contentType = request.headers.get('content-type');
  if (contentType === null) {
    return { validity: 'invalid', reasons: ['the request body has no Content-Type'] };
  }
  const mediaType = mediaTypeEssence(contentType);
  const documentedMediaType = findDocumentedMediaType(requestBody.content, mediaType);
  if (documentedMediaType === undefined) {
    return {
      validity: 'invalid',
      reasons: [`the request body's Content-Type ${contentType} is not documented`],
    };
  }
  if (!isJsonMediaType(mediaType)) {
    return {
      validity: 'unclassified',
      reason: `only JSON request bodies are classified, and this one is ${mediaType}`,
    };
  }
  const body = parseJsonBody(request.body);
  if (!body.parsed) {
    return { validity: 'invalid', reasons: [`the request body is not JSON: ${body.reason}`] };
  }
  const { schema } = documentedMediaType.mediaType;
  const reasons = schema === undefined ? [] : validator.findViolations(schema, body.value).map(
    (violation) => `the request body: ${violation}`,
  );
  return reasons.length === 0 ? { validity: 'valid' } : { validity: 'invalid', reasons };
}
