/**
 * Reads parameter and header text as the JSON value OpenAPI's serialization styles give it: a
 * primitive schema's `type` decides whether `"42"` is the number 42 or the string "42".
 */
import type { JsonSchema } from './openapi_document.ts';

const JSON_NUMBER_PATTERN = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][-+]?\d+)?$/;

/**
 * The value `text` stands for under `schema`: a number for an `integer` or `number` schema, a
 * boolean for a `boolean` one, and the text itself otherwise, or when it does not spell a value of
 * that type, so that validation reports the mismatch. A `$ref` at the top of `schema` is followed
 * through `schemaFiles`, the document's schema files by absolute URL.
 */
export function coerceTextValue(
  text: string,
  schema: JsonSchema | undefined,
  schemaFiles: ReadonlyMap<string, JsonSchema>,
): unknown {
  const types = declaredTypes(schema, schemaFiles);
  if ((types.has('integer') || types.has('number')) && JSON_NUMBER_PATTERN.test(text)) {
    return Number(text);
  }
  if (types.has('boolean') && (text === 'true' || text === 'false')) return text === 'true';
  return text;
}

function declaredTypes(
  schema: JsonSchema | undefined,
  schemaFiles: ReadonlyMap<string, JsonSchema>,
): ReadonlySet<string> {
  const visited = new Set<string>();
  let current = schema;
  while (current !== undefined && typeof current !== 'boolean') {
    const { type, $ref } = current;
    if (typeof type === 'string') return new Set([type]);
    if (Array.isArray(type)) return new Set(type.filter((item) => typeof item === 'string'));
    if (typeof $ref !== 'string' || visited.has($ref)) break;
    visited.add($ref);
    current = schemaFiles.get($ref);
  }
  return new Set();
}
