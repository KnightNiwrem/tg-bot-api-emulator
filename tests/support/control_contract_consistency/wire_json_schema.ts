/**
 * Converts a contract's wire schema to JSON Schema, refusing any schema whose conversion would
 * not say everything the schema checks.
 */
import { z } from 'zod';

import type { JsonSchema } from '../openapi_conformance/openapi_document.ts';

/**
 * Which side of a schema to describe: a request's `input`, before defaults apply, or a
 * response's `output`.
 */
export type WireSchemaSemantics = 'input' | 'output';

/**
 * The zod schema kinds a wire schema is made of, each of which converts to JSON Schema exactly.
 * Transforms, pipes, coercions and custom kinds are absent: a wire schema holds no codec.
 */
const REPRESENTABLE_SCHEMA_TYPES = new Set([
  'object',
  'optional',
  'default',
  'array',
  'tuple',
  'union',
  'enum',
  'literal',
  'string',
  'number',
  'boolean',
  'null',
]);

/**
 * Describes a wire schema as JSON Schema 2020-12, as a request reads it or a response is written.
 *
 * @throws {Error} when the schema has a refinement, which conversion would silently drop, or a
 * kind of schema that is not a wire fact, such as a transform; or when zod cannot represent part
 * of it.
 */
export function readWireJsonSchema(schema: z.ZodType, semantics: WireSchemaSemantics): JsonSchema {
  assertRepresentable(schema, '');
  const jsonSchema: { readonly [keyword: string]: unknown } = {
    ...z.toJSONSchema(schema, {
      io: semantics,
      target: 'draft-2020-12',
      unrepresentable: 'throw',
      cycles: 'throw',
      reused: 'inline',
    }),
  };
  return jsonSchema;
}

function assertRepresentable(schema: z.core.$ZodType, location: string): void {
  const definition: z.core.$ZodTypeDef = schema._zod.def;
  if (!REPRESENTABLE_SCHEMA_TYPES.has(definition.type)) {
    throw new Error(`The wire schema at ${location || '/'} is a ${definition.type}`);
  }
  if ('coerce' in definition && definition.coerce === true) {
    throw new Error(`The wire schema at ${location || '/'} coerces its input`);
  }
  for (const check of definition.checks ?? []) {
    if (check._zod.def.check === 'custom') {
      throw new Error(
        `The wire schema at ${location || '/'} has a refinement, which JSON Schema would drop`,
      );
    }
  }
  for (const [name, child] of readChildSchemas(schema)) {
    assertRepresentable(child, `${location}/${name}`);
  }
}

/** The schemas a schema is made of, by where they sit in it. */
function readChildSchemas(schema: z.core.$ZodType): [name: string, child: z.core.$ZodType][] {
  if (schema instanceof z.core.$ZodObject) return Object.entries(schema._zod.def.shape);
  if (schema instanceof z.core.$ZodOptional || schema instanceof z.core.$ZodDefault) {
    return [['(inner)', schema._zod.def.innerType]];
  }
  if (schema instanceof z.core.$ZodArray) return [['(items)', schema._zod.def.element]];
  if (schema instanceof z.core.$ZodTuple) {
    const { items, rest } = schema._zod.def;
    const children = items.map((item, index): [string, z.core.$ZodType] => [String(index), item]);
    return rest === null ? children : [...children, ['(rest)', rest]];
  }
  if (schema instanceof z.core.$ZodUnion) {
    return schema._zod.def.options.map((option, index): [string, z.core.$ZodType] => [
      `(${index})`,
      option,
    ]);
  }
  return [];
}
