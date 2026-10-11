/**
 * Converts a contract's wire schema to JSON Schema, refusing any schema whose conversion would
 * not say everything the schema checks.
 *
 * A Telegram object, which a schema annotates with its Telegram type's name, is the document's to
 * describe, so it converts to that annotation alone, as the canonical form compares it; its own
 * schema, which may nest without bound, as a rich message's blocks do, is neither checked nor
 * converted.
 */
import { z } from 'zod';

import { TELEGRAM_TYPE_ANNOTATION } from '../../../src/api/contracts/wire_fields.ts';
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
  'record',
  'optional',
  'default',
  'readonly',
  'array',
  'tuple',
  'union',
  'enum',
  'literal',
  'string',
  'number',
  'boolean',
  'null',
  'unknown',
]);

/**
 * Describes a wire schema as JSON Schema 2020-12, as a request reads it or a response is written.
 *
 * @throws {Error} when the schema has a refinement, which conversion would silently drop, or a
 * kind of schema that is not a wire fact, such as a transform; when zod cannot represent part of
 * it; or when it refers to itself outside a Telegram object.
 */
export function readWireJsonSchema(schema: z.ZodType, semantics: WireSchemaSemantics): JsonSchema {
  assertRepresentable(schema, '');
  const jsonSchema: { [keyword: string]: unknown } = {
    ...z.toJSONSchema(schema, {
      io: semantics,
      target: 'draft-2020-12',
      unrepresentable: 'throw',
      cycles: 'ref',
      reused: 'inline',
    }),
  };
  // Zod defines each schema that refers to itself once, and refers to the definition. Naming a
  // Telegram object leaves out every reference within it, so any reference left is a schema that
  // refers to itself outside one.
  delete jsonSchema.$defs;
  const wireJsonSchema = nameTelegramObjects(jsonSchema);
  if (JSON.stringify(wireJsonSchema).includes('"$ref"')) {
    throw new Error('The wire schema refers to itself outside a Telegram object');
  }
  return wireJsonSchema;
}

/** The schema with each Telegram object it holds converted to the name of its Telegram type. */
function nameTelegramObjects(schema: JsonSchema): JsonSchema {
  return JSON.parse(JSON.stringify(schema), (_key, value: unknown) => {
    if (value === null || typeof value !== 'object' || !(TELEGRAM_TYPE_ANNOTATION in value)) {
      return value;
    }
    return { [TELEGRAM_TYPE_ANNOTATION]: value[TELEGRAM_TYPE_ANNOTATION] };
  });
}

function assertRepresentable(schema: z.core.$ZodType, location: string): void {
  if (z.globalRegistry.get(schema)?.[TELEGRAM_TYPE_ANNOTATION] !== undefined) {
    return;
  }
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
  if (schema instanceof z.core.$ZodRecord) {
    return [['(keys)', schema._zod.def.keyType], ['(members)', schema._zod.def.valueType]];
  }
  if (
    schema instanceof z.core.$ZodOptional || schema instanceof z.core.$ZodDefault ||
    schema instanceof z.core.$ZodReadonly
  ) {
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
