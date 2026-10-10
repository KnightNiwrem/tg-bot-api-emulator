/**
 * Reads the committed OpenAPI document, following its references across files, into the
 * operations that a conformance check compares HTTP exchanges against.
 *
 * Only the parts of the document a check needs are read: each operation's parameters, request body
 * and responses. Schemas are kept as JSON Schema, with every `$ref` made absolute so that each one
 * compiles on its own, independently of the file it is written in.
 */
import { parse as parseYaml } from '@std/yaml';
import { z } from 'zod';

/** The HTTP methods an OpenAPI path item can describe operations for, as the document spells them. */
export const DOCUMENTED_HTTP_METHODS = ['get', 'put', 'post', 'delete', 'patch'] as const;
export type DocumentedHttpMethod = typeof DOCUMENTED_HTTP_METHODS[number];

/** A JSON Schema whose `$ref`s are absolute URLs. */
export type JsonSchema = boolean | { readonly [keyword: string]: unknown };

export type ParameterLocation = 'path' | 'query' | 'header' | 'cookie';

export interface DocumentedParameter {
  readonly name: string;
  readonly location: ParameterLocation;
  readonly required: boolean;
  /** The serialization style, defaulted as OpenAPI defaults it for the parameter's location. */
  readonly style: string;
  readonly schema: JsonSchema | undefined;
}

export interface DocumentedMediaType {
  readonly schema: JsonSchema | undefined;
}

export interface DocumentedHeader {
  readonly required: boolean;
  readonly schema: JsonSchema | undefined;
}

export interface DocumentedResponse {
  /** By lowercase header name. */
  readonly headers: ReadonlyMap<string, DocumentedHeader>;
  /** By media type or media type range; empty when the response has no body. */
  readonly content: ReadonlyMap<string, DocumentedMediaType>;
}

export interface DocumentedRequestBody {
  readonly required: boolean;
  readonly content: ReadonlyMap<string, DocumentedMediaType>;
}

export interface DocumentedOperation {
  readonly operationId: string;
  readonly method: DocumentedHttpMethod;
  /** The path as the document's `paths` object keys it, such as `/sessions/{sessionId}`. */
  readonly pathTemplate: string;
  /** Path-level parameters merged with the operation's own, which override them. */
  readonly parameters: readonly DocumentedParameter[];
  readonly requestBody: DocumentedRequestBody | undefined;
  /** By status code, status range such as `4XX`, or `default`. */
  readonly responses: ReadonlyMap<string, DocumentedResponse>;
}

export interface OpenApiDocument {
  readonly operations: readonly DocumentedOperation[];
  /** Every path the document lists, including those that describe no operation. */
  readonly pathTemplates: readonly string[];
  /** Every schema file the operations reference, directly or transitively, by its absolute URL. */
  readonly schemaFiles: ReadonlyMap<string, JsonSchema>;
}

/** The OpenAPI document committed in this repository. */
const REPOSITORY_OPENAPI_DOCUMENT_URL = new URL(
  '../../../openapi/openapi.yaml',
  import.meta.url,
);

const referenceObjectSchema = z.looseObject({ $ref: z.string() });

const rootDocumentSchema = z.looseObject({
  openapi: z.string().startsWith('3.1.'),
  paths: z.record(z.string().startsWith('/'), z.unknown()),
});

const parameterSchema = z.looseObject({
  name: z.string().min(1),
  in: z.enum(['path', 'query', 'header', 'cookie']),
  required: z.boolean().optional(),
  style: z.string().optional(),
  schema: z.unknown().optional(),
});

const mediaTypesSchema = z.record(z.string(), z.looseObject({ schema: z.unknown().optional() }));

const requestBodySchema = z.looseObject({
  required: z.boolean().optional(),
  content: mediaTypesSchema,
});

const headerSchema = z.looseObject({
  required: z.boolean().optional(),
  schema: z.unknown().optional(),
});

const responseSchema = z.looseObject({
  headers: z.record(z.string(), z.unknown()).optional(),
  content: mediaTypesSchema.optional(),
});

const operationSchema = z.looseObject({
  operationId: z.string().min(1),
  parameters: z.array(z.unknown()).optional(),
  requestBody: z.unknown().optional(),
  responses: z.record(z.string().regex(/^(?:[1-5](?:\d\d|XX)|default)$/), z.unknown()),
});

const pathItemSchema = z.looseObject({
  parameters: z.array(z.unknown()).optional(),
  get: z.unknown().optional(),
  put: z.unknown().optional(),
  post: z.unknown().optional(),
  delete: z.unknown().optional(),
  patch: z.unknown().optional(),
});

/** OpenAPI's default `style` for a parameter in each location. */
const DEFAULT_PARAMETER_STYLES: Readonly<Record<ParameterLocation, string>> = {
  path: 'simple',
  query: 'form',
  header: 'simple',
  cookie: 'form',
};

/** A value read from the document together with the file it was read from. */
interface LocatedValue {
  readonly value: unknown;
  readonly fileUrl: URL;
}

/**
 * Reads the OpenAPI 3.1 document at `rootUrl` and every file it references.
 *
 * Throws when a file cannot be read or parsed, a reference does not resolve, or a part the check
 * relies on does not have the shape OpenAPI gives it.
 */
export function readOpenApiDocument(
  rootUrl: URL = REPOSITORY_OPENAPI_DOCUMENT_URL,
): OpenApiDocument {
  const reader = new OpenApiFileReader();
  const root = parseAt(rootDocumentSchema, reader.readFile(rootUrl), rootUrl.href);
  const operations: DocumentedOperation[] = [];
  for (const [pathTemplate, pathItemNode] of Object.entries(root.paths)) {
    const pathItem = reader.dereference({ value: pathItemNode, fileUrl: rootUrl });
    operations.push(...readPathItemOperations(reader, pathTemplate, pathItem));
  }
  return {
    operations,
    pathTemplates: Object.keys(root.paths),
    schemaFiles: reader.readReferencedSchemaFiles(),
  };
}

function readPathItemOperations(
  reader: OpenApiFileReader,
  pathTemplate: string,
  pathItemNode: LocatedValue,
): DocumentedOperation[] {
  const location = `path ${pathTemplate}`;
  const pathItem = parseAt(pathItemSchema, pathItemNode.value, location);
  const pathParameters = readParameters(
    reader,
    pathItem.parameters,
    pathItemNode.fileUrl,
    location,
  );
  const operations: DocumentedOperation[] = [];
  for (const method of DOCUMENTED_HTTP_METHODS) {
    const operationNode = pathItem[method];
    if (operationNode === undefined) continue;
    const operationLocation = `${method.toUpperCase()} ${pathTemplate}`;
    const operation = parseAt(operationSchema, operationNode, operationLocation);
    const ownParameters = readParameters(
      reader,
      operation.parameters,
      pathItemNode.fileUrl,
      operationLocation,
    );
    operations.push({
      operationId: operation.operationId,
      method,
      pathTemplate,
      parameters: mergeParameters(pathParameters, ownParameters),
      requestBody: operation.requestBody === undefined ? undefined : readRequestBody(
        reader,
        reader.dereference({ value: operation.requestBody, fileUrl: pathItemNode.fileUrl }),
        operationLocation,
      ),
      responses: new Map(
        Object.entries(operation.responses).map(([statusKey, responseNode]) => [
          statusKey,
          readResponse(
            reader,
            reader.dereference({ value: responseNode, fileUrl: pathItemNode.fileUrl }),
            `${operationLocation} ${statusKey}`,
          ),
        ]),
      ),
    });
  }
  return operations;
}

function readParameters(
  reader: OpenApiFileReader,
  parameterNodes: readonly unknown[] | undefined,
  fileUrl: URL,
  location: string,
): DocumentedParameter[] {
  return (parameterNodes ?? []).map((parameterNode) => {
    const located = reader.dereference({ value: parameterNode, fileUrl });
    const parameter = parseAt(parameterSchema, located.value, `${location} parameter`);
    return {
      name: parameter.name,
      location: parameter.in,
      required: parameter.required ?? false,
      style: parameter.style ?? DEFAULT_PARAMETER_STYLES[parameter.in],
      schema: reader.readSchema(parameter.schema, located.fileUrl, `${location} ${parameter.name}`),
    };
  });
}

/** Merges path-level parameters with an operation's own, which override them by name and location. */
function mergeParameters(
  pathParameters: readonly DocumentedParameter[],
  operationParameters: readonly DocumentedParameter[],
): DocumentedParameter[] {
  const parameterKey = (parameter: DocumentedParameter) =>
    `${parameter.location}:${parameter.name}`;
  const overridden = new Set(operationParameters.map(parameterKey));
  return [
    ...pathParameters.filter((parameter) => !overridden.has(parameterKey(parameter))),
    ...operationParameters,
  ];
}

function readRequestBody(
  reader: OpenApiFileReader,
  requestBodyNode: LocatedValue,
  location: string,
): DocumentedRequestBody {
  const requestBody = parseAt(requestBodySchema, requestBodyNode.value, `${location} request body`);
  return {
    required: requestBody.required ?? false,
    content: readMediaTypes(reader, requestBody.content, requestBodyNode.fileUrl, location),
  };
}

function readResponse(
  reader: OpenApiFileReader,
  responseNode: LocatedValue,
  location: string,
): DocumentedResponse {
  const response = parseAt(responseSchema, responseNode.value, location);
  const headers = new Map<string, DocumentedHeader>();
  for (const [headerName, headerNode] of Object.entries(response.headers ?? {})) {
    const located = reader.dereference({ value: headerNode, fileUrl: responseNode.fileUrl });
    const header = parseAt(headerSchema, located.value, `${location} header ${headerName}`);
    headers.set(headerName.toLowerCase(), {
      required: header.required ?? false,
      schema: reader.readSchema(header.schema, located.fileUrl, `${location} header ${headerName}`),
    });
  }
  return {
    headers,
    content: readMediaTypes(reader, response.content ?? {}, responseNode.fileUrl, location),
  };
}

function readMediaTypes(
  reader: OpenApiFileReader,
  mediaTypes: z.infer<typeof mediaTypesSchema>,
  fileUrl: URL,
  location: string,
): ReadonlyMap<string, DocumentedMediaType> {
  return new Map(
    Object.entries(mediaTypes).map(([mediaType, mediaTypeObject]) => [
      mediaType.toLowerCase(),
      { schema: reader.readSchema(mediaTypeObject.schema, fileUrl, `${location} ${mediaType}`) },
    ]),
  );
}

/** Reads and caches the document's files, and collects the schema files its schemas reference. */
class OpenApiFileReader {
  readonly #parsedFiles = new Map<string, unknown>();
  readonly #referencedSchemaFileUrls = new Set<string>();

  readFile(fileUrl: URL): unknown {
    const key = withoutFragment(fileUrl);
    if (!this.#parsedFiles.has(key)) {
      this.#parsedFiles.set(key, parseYaml(Deno.readTextFileSync(new URL(key))));
    }
    return this.#parsedFiles.get(key);
  }

  /** Follows `$ref`s, from the file each was written in, until reaching a value that is not one. */
  dereference(node: LocatedValue): LocatedValue {
    const visited = new Set<string>();
    let current = node;
    while (true) {
      const reference = referenceObjectSchema.safeParse(current.value);
      if (!reference.success) return current;
      const targetUrl = new URL(reference.data.$ref, current.fileUrl);
      if (visited.has(targetUrl.href)) {
        throw new Error(`The OpenAPI reference ${targetUrl.href} refers to itself`);
      }
      visited.add(targetUrl.href);
      current = {
        value: resolveJsonPointer(this.readFile(targetUrl), targetUrl),
        fileUrl: new URL(withoutFragment(targetUrl)),
      };
    }
  }

  /**
   * Reads a schema written in `fileUrl`, making its `$ref`s absolute and noting the schema files
   * they reference. `undefined` stays undefined: the document leaves that schema unconstrained.
   */
  readSchema(schemaNode: unknown, fileUrl: URL, location: string): JsonSchema | undefined {
    if (schemaNode === undefined) return undefined;
    return toJsonSchema(this.#absolutizeReferences(schemaNode, fileUrl), location);
  }

  /** Reads every schema file referenced so far, and every file those reference in turn. */
  readReferencedSchemaFiles(): ReadonlyMap<string, JsonSchema> {
    const schemaFiles = new Map<string, JsonSchema>();
    // Iterating a set visits what is added to it meanwhile, so the files the read ones reference
    // are read too.
    for (const schemaFileUrl of this.#referencedSchemaFileUrls) {
      const schema = this.readSchema(
        this.readFile(new URL(schemaFileUrl)),
        new URL(schemaFileUrl),
        schemaFileUrl,
      );
      if (schema === undefined) throw new Error(`The schema file ${schemaFileUrl} is empty`);
      schemaFiles.set(
        schemaFileUrl,
        typeof schema === 'boolean' ? schema : { ...schema, $id: schemaFileUrl },
      );
    }
    return schemaFiles;
  }

  #absolutizeReferences(node: unknown, fileUrl: URL): unknown {
    if (Array.isArray(node)) return node.map((item) => this.#absolutizeReferences(item, fileUrl));
    if (node === null || typeof node !== 'object') return node;
    return Object.fromEntries(
      Object.entries(node).map(([key, value]) => {
        if (key === '$ref' && typeof value === 'string') {
          const targetUrl = new URL(value, fileUrl);
          this.#referencedSchemaFileUrls.add(withoutFragment(targetUrl));
          return [key, targetUrl.href];
        }
        return [key, this.#absolutizeReferences(value, fileUrl)];
      }),
    );
  }
}

function toJsonSchema(value: unknown, location: string): JsonSchema {
  if (typeof value === 'boolean' || isJsonObject(value)) return value;
  throw new Error(`Expected a JSON Schema at ${location}`);
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function resolveJsonPointer(fileContent: unknown, targetUrl: URL): unknown {
  if (targetUrl.hash === '' || targetUrl.hash === '#') return fileContent;
  const pointer = decodeURIComponent(targetUrl.hash.slice(1));
  if (!pointer.startsWith('/')) {
    throw new Error(`The OpenAPI reference ${targetUrl.href} has no JSON pointer fragment`);
  }
  let current = fileContent;
  for (const token of pointer.slice(1).split('/')) {
    const key = token.replaceAll('~1', '/').replaceAll('~0', '~');
    if (!isJsonObject(current) || !Object.hasOwn(current, key)) {
      throw new Error(`The OpenAPI reference ${targetUrl.href} does not resolve`);
    }
    current = current[key];
  }
  return current;
}

function withoutFragment(url: URL): string {
  const copy = new URL(url);
  copy.hash = '';
  return copy.href;
}

function parseAt<Schema extends z.ZodType>(
  schema: Schema,
  value: unknown,
  location: string,
): z.output<Schema> {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new Error(`Unexpected OpenAPI shape at ${location}: ${z.prettifyError(result.error)}`);
  }
  return result.data;
}
