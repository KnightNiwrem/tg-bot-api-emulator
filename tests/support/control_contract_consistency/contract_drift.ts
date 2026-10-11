/**
 * Compares a control operation's contract with the hand-written OpenAPI document's entry for the
 * same operation, in both directions: whatever one declares, the other must declare alike. Each
 * difference is drift, which one of the two has to be corrected for.
 */
import type { z } from 'zod';

import type {
  ControlOperationContract,
  QueryParameterSerialization,
} from '../../../control_contracts/operation_contract.ts';
import type {
  DocumentedHeader,
  DocumentedMediaType,
  DocumentedOperation,
  JsonSchema,
  ParameterLocation,
} from '../openapi_conformance/openapi_document.ts';
import {
  describeSchemaDifferences,
  type JsonSchemaCanonicalizer,
} from './json_schema_canonical_form.ts';
import { readWireJsonSchema, type WireSchemaSemantics } from './wire_json_schema.ts';

const JSON_MEDIA_TYPE = 'application/json';

/** Compares a contract with the document's entry by its `operationId`; none when they agree. */
export function findContractDrift(
  contract: ControlOperationContract,
  operations: readonly DocumentedOperation[],
  canonicalizer: JsonSchemaCanonicalizer,
): string[] {
  const operation = operations.find(({ operationId }) => operationId === contract.operationId);
  if (operation === undefined) {
    return [`the document has no operation ${contract.operationId}`];
  }
  const compare = new SchemaComparison(canonicalizer);
  const drift: string[] = [];
  if (operation.method.toUpperCase() !== contract.method) {
    drift.push(`method: the contract has ${contract.method}, the document has ${operation.method}`);
  }
  if (operation.pathTemplate !== contract.path) {
    drift.push(
      `path: the contract has ${contract.path}, the document has ${operation.pathTemplate}`,
    );
  }
  drift.push(
    ...findParameterDrift(operation, 'path', contract.params, {}, compare),
    ...findParameterDrift(
      operation,
      'query',
      contract.query,
      contract.querySerialization ?? {},
      compare,
    ),
  );
  for (const location of ['header', 'cookie'] as const) {
    for (const parameter of operation.parameters.filter((item) => item.location === location)) {
      drift.push(`${location} parameter ${parameter.name}: only the document has it`);
    }
  }
  drift.push(...findRequestBodyDrift(contract, operation, compare));
  drift.push(...findResponseDrift(contract, operation, compare));
  return drift;
}

/** Converts both sides of a comparison to canonical JSON Schema and describes their differences. */
class SchemaComparison {
  readonly #canonicalizer: JsonSchemaCanonicalizer;

  constructor(canonicalizer: JsonSchemaCanonicalizer) {
    this.#canonicalizer = canonicalizer;
  }

  describe(
    location: string,
    wireSchema: z.ZodType,
    semantics: WireSchemaSemantics,
    documentedSchema: JsonSchema | undefined,
  ): string[] {
    if (documentedSchema === undefined) return [`${location}: the document gives no schema`];
    return describeSchemaDifferences(
      this.#canonicalizer.canonicalize(readWireJsonSchema(wireSchema, semantics)),
      this.#canonicalizer.canonicalize(documentedSchema),
    ).map((difference) => `${location} ${difference}`);
  }
}

function findParameterDrift(
  operation: DocumentedOperation,
  location: Extract<ParameterLocation, 'path' | 'query'>,
  contractParameters: z.ZodObject | undefined,
  serialization: { readonly [name: string]: QueryParameterSerialization },
  compare: SchemaComparison,
): string[] {
  const documented = new Map(
    operation.parameters.filter((parameter) => parameter.location === location).map((
      parameter,
    ) => [parameter.name, parameter]),
  );
  const shape = contractParameters?.shape ?? {};
  // A parameter is required when its object's input requires it; path parameters always are.
  const requiredNames = new Set(
    contractParameters === undefined
      ? []
      : readRequiredNames(readWireJsonSchema(contractParameters, 'input')),
  );
  const drift: string[] = [];
  for (const name of documented.keys()) {
    if (!Object.hasOwn(shape, name)) {
      drift.push(`${location} parameter ${name}: only the document has it`);
    }
  }
  for (const [name, schema] of Object.entries(shape)) {
    const parameter = documented.get(name);
    const label = `${location} parameter ${name}`;
    if (parameter === undefined) {
      drift.push(`${label}: only the contract has it`);
      continue;
    }
    if (parameter.required !== requiredNames.has(name)) {
      drift.push(
        `${label}: the contract ${requiredNames.has(name) ? 'requires' : 'does not require'} it`,
      );
    }
    // The server reads a path parameter as OpenAPI's `simple` style writes it, and a query
    // parameter as its default `form` style does unless the contract serializes it otherwise.
    const contractSerialization = location === 'path' ? 'simple' : serialization[name] ?? 'form';
    const documentedSerialization = parameter.contentMediaType === JSON_MEDIA_TYPE
      ? 'json'
      : parameter.contentMediaType ?? parameter.style;
    if (documentedSerialization !== contractSerialization) {
      drift.push(
        `${label}: the document serializes it as ${documentedSerialization}, not ${contractSerialization}`,
      );
    }
    drift.push(...compare.describe(label, schema, 'input', parameter.schema));
  }
  return drift;
}

function findRequestBodyDrift(
  contract: ControlOperationContract,
  operation: DocumentedOperation,
  compare: SchemaComparison,
): string[] {
  const documented = operation.requestBody;
  if (contract.body === undefined) {
    return documented === undefined ? [] : ['request body: only the document has one'];
  }
  if (documented === undefined) return ['request body: only the contract has one'];
  const drift: string[] = [];
  if (documented.required !== contract.body.required) {
    drift.push(
      `request body: the contract ${contract.body.required ? 'requires' : 'does not require'} it`,
    );
  }
  drift.push(
    ...findJsonContentDrift(
      'request body',
      documented.content,
      contract.body.schema,
      'input',
      compare,
    ),
  );
  return drift;
}

function findResponseDrift(
  contract: ControlOperationContract,
  operation: DocumentedOperation,
  compare: SchemaComparison,
): string[] {
  const contractStatuses = [
    String(contract.success.status),
    ...Object.keys(contract.refusals),
  ];
  const drift: string[] = [];
  for (const statusKey of operation.responses.keys()) {
    if (!contractStatuses.includes(statusKey)) {
      drift.push(`response ${statusKey}: only the document has it`);
    }
  }
  for (const statusKey of contractStatuses) {
    if (!operation.responses.has(statusKey)) {
      drift.push(`response ${statusKey}: only the contract has it`);
    }
  }

  const success = operation.responses.get(String(contract.success.status));
  if (success !== undefined) {
    const label = `response ${contract.success.status}`;
    drift.push(...findHeaderDrift(label, contract.success.headers, success.headers, compare));
    const body = contract.success.body;
    switch (body.kind) {
      case 'json':
        drift.push(...findJsonContentDrift(label, success.content, body.schema, 'output', compare));
        break;
      case 'empty':
        if (success.content.size > 0) drift.push(`${label}: only the document has content`);
        break;
      case 'bytes':
        if (success.content.size === 0 || success.content.has(JSON_MEDIA_TYPE)) {
          drift.push(`${label}: the document does not describe bytes of a non-JSON media type`);
        }
        break;
      default: {
        const unhandledBody: never = body;
        throw new Error(`Unhandled response body: ${JSON.stringify(unhandledBody)}`);
      }
    }
  }
  for (const [status, schema] of Object.entries(contract.refusals)) {
    const refusal = operation.responses.get(status);
    if (refusal === undefined) continue;
    const label = `response ${status}`;
    if (refusal.headers.size > 0) drift.push(`${label}: only the document has headers`);
    drift.push(...findJsonContentDrift(label, refusal.content, schema, 'output', compare));
  }
  return drift;
}

function findHeaderDrift(
  label: string,
  contractHeaders: z.ZodObject | undefined,
  documentedHeaders: ReadonlyMap<string, DocumentedHeader>,
  compare: SchemaComparison,
): string[] {
  const shape = contractHeaders?.shape ?? {};
  const requiredNames = new Set(
    contractHeaders === undefined
      ? []
      : readRequiredNames(readWireJsonSchema(contractHeaders, 'output')).map((name) =>
        name.toLowerCase()
      ),
  );
  const contractNames = new Map(
    Object.entries(shape).map(([name, schema]) => [name.toLowerCase(), schema]),
  );
  const drift: string[] = [];
  for (const name of documentedHeaders.keys()) {
    if (!contractNames.has(name)) drift.push(`${label} header ${name}: only the document has it`);
  }
  for (const [name, schema] of contractNames) {
    const header = documentedHeaders.get(name);
    if (header === undefined) {
      drift.push(`${label} header ${name}: only the contract has it`);
      continue;
    }
    if (header.required !== requiredNames.has(name)) {
      drift.push(
        `${label} header ${name}: the contract ${
          requiredNames.has(name) ? 'requires' : 'does not require'
        } it`,
      );
    }
    drift.push(...compare.describe(`${label} header ${name}`, schema, 'output', header.schema));
  }
  return drift;
}

function findJsonContentDrift(
  label: string,
  content: ReadonlyMap<string, DocumentedMediaType>,
  schema: z.ZodType,
  semantics: WireSchemaSemantics,
  compare: SchemaComparison,
): string[] {
  const mediaTypes = [...content.keys()];
  if (mediaTypes.length !== 1 || mediaTypes[0] !== JSON_MEDIA_TYPE) {
    return [`${label}: the document gives ${mediaTypes.join(', ') || 'no'} content, not JSON`];
  }
  return compare.describe(label, schema, semantics, content.get(JSON_MEDIA_TYPE)?.schema);
}

function readRequiredNames(objectSchema: JsonSchema): string[] {
  if (typeof objectSchema === 'boolean') return [];
  const { required } = objectSchema;
  return Array.isArray(required) ? required.filter((name) => typeof name === 'string') : [];
}
