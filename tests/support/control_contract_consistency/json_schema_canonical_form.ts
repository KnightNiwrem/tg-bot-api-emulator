/**
 * Brings a JSON Schema into a canonical form, so that two schemas that accept the same values in
 * the ways the control API's schemas are written compare equal, whichever of them a hand-written
 * document or zod's converter wrote.
 *
 * It follows `$ref`s, drops annotations, merges `allOf` branches, and rewrites a few equivalent
 * spellings into one. A construct it cannot reason about, such as an `allOf` whose branches give
 * one keyword different values, makes it throw instead of guessing, so a comparison never passes
 * by ignoring part of a schema.
 */
import { z } from 'zod';

import { TELEGRAM_TYPE_ANNOTATION } from '../../../src/api/contracts/wire_fields.ts';
import type { JsonSchemaValidator } from '../openapi_conformance/json_schema_validator.ts';
import type { JsonSchema } from '../openapi_conformance/openapi_document.ts';

/** A schema in canonical form: never a reference, and never `true` or `false` written as `{}`. */
export type CanonicalJsonSchema = boolean | { readonly [keyword: string]: unknown };

type SchemaObject = { [keyword: string]: unknown };

/**
 * Keywords that annotate rather than constrain. `default` is not among them: it is a wire fact
 * both sides state, of what the server assumes for an omitted field.
 */
const ANNOTATION_KEYWORDS = new Set([
  '$schema',
  '$id',
  '$comment',
  'title',
  'description',
  'examples',
  'deprecated',
  'readOnly',
  'writeOnly',
  // OpenAPI's `discriminator` names the property that tells a `oneOf`'s alternatives apart, which
  // the alternatives themselves already decide.
  'discriminator',
]);

/** The keywords whose value is one subschema. */
const SUBSCHEMA_KEYWORDS = ['items', 'not', 'additionalProperties'] as const;
/** The keywords whose value is a list of subschemas. */
const SUBSCHEMA_LIST_KEYWORDS = ['prefixItems', 'anyOf', 'oneOf', 'allOf'] as const;

/**
 * The keywords a `const` or an `enum` makes redundant when each of its values meets them: they
 * cannot reject a value the schema accepts.
 */
const CONST_SUBSUMED_KEYWORDS = [
  'type',
  'enum',
  'pattern',
  'format',
  'minLength',
  'maxLength',
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'multipleOf',
  'not',
] as const;

/**
 * The patterns zod writes beside the formats it checks with its own expression, which say no more
 * than the format does. Derived from zod itself, so that they follow its version.
 */
const ZOD_FORMAT_PATTERNS: ReadonlyMap<string, unknown> = new Map(
  [z.uuid()].map((schema) => {
    const { format, pattern } = z.toJSONSchema(schema) as SchemaObject;
    return [String(format), pattern];
  }),
);

export class JsonSchemaCanonicalizer {
  readonly #schemaFiles: ReadonlyMap<string, JsonSchema>;
  readonly #validator: JsonSchemaValidator;

  /**
   * `schemaFiles` are the files `$ref`s name, by absolute URL; `validator` checks whether a
   * `const` meets the keywords beside it.
   */
  constructor(schemaFiles: ReadonlyMap<string, JsonSchema>, validator: JsonSchemaValidator) {
    this.#schemaFiles = schemaFiles;
    this.#validator = validator;
  }

  canonicalize(schema: JsonSchema): CanonicalJsonSchema {
    if (typeof schema === 'boolean') return schema;
    // A Telegram object is the document's to describe; both sides need only name its type.
    const telegramTypeName = schema[TELEGRAM_TYPE_ANNOTATION];
    if (telegramTypeName !== undefined) return { [TELEGRAM_TYPE_ANNOTATION]: telegramTypeName };
    const node: SchemaObject = {};
    for (const [keyword, value] of Object.entries(schema)) {
      if (ANNOTATION_KEYWORDS.has(keyword) || keyword.startsWith('x-')) continue;
      node[keyword] = value;
    }

    if (typeof node.$ref === 'string') {
      const target = this.#resolveReference(node.$ref);
      delete node.$ref;
      // A reference beside other keywords applies both, as an `allOf` would.
      node.allOf = [target, ...asSchemaList(node.allOf)];
    }
    if (node.properties !== undefined) {
      node.properties = Object.fromEntries(
        Object.entries(asSchemaRecord(node.properties)).map(([name, property]) => [
          name,
          this.canonicalize(property),
        ]),
      );
    }
    for (const keyword of SUBSCHEMA_KEYWORDS) {
      if (node[keyword] !== undefined) node[keyword] = this.canonicalize(asSchema(node[keyword]));
    }
    for (const keyword of SUBSCHEMA_LIST_KEYWORDS) {
      if (node[keyword] !== undefined) {
        node[keyword] = asSchemaList(node[keyword]).map((part) => this.canonicalize(part));
      }
    }
    // The control API's alternatives never overlap, so `oneOf` accepts what `anyOf` does; zod
    // writes every union as `anyOf`.
    if (node.oneOf !== undefined) {
      if (node.anyOf !== undefined) throw new Error('A schema with both oneOf and anyOf');
      node.anyOf = node.oneOf;
      delete node.oneOf;
    }

    const parts = node.allOf === undefined ? [] : asSchemaList(node.allOf);
    delete node.allOf;
    return parts.reduce<CanonicalJsonSchema>(
      (merged, part) => this.#merge(merged, part),
      this.#finalize(node),
    );
  }

  #resolveReference(reference: string): JsonSchema {
    const url = new URL(reference);
    const fragment = url.hash;
    url.hash = '';
    const file = this.#schemaFiles.get(url.href);
    if (file === undefined) throw new Error(`No schema file for the reference ${reference}`);
    if (fragment === '' || fragment === '#') return file;
    let current: unknown = file;
    for (const token of decodeURIComponent(fragment.slice(2)).split('/')) {
      const key = token.replaceAll('~1', '/').replaceAll('~0', '~');
      if (!isSchemaObject(current) || !Object.hasOwn(current, key)) {
        throw new Error(`The reference ${reference} does not resolve`);
      }
      current = current[key];
    }
    return asSchema(current);
  }

  /** Both schemas at once, as `allOf` applies them, for the keyword combinations it can merge. */
  #merge(left: CanonicalJsonSchema, right: CanonicalJsonSchema): CanonicalJsonSchema {
    if (left === true) return right;
    if (right === true) return left;
    if (left === false || right === false) return false;
    const merged: SchemaObject = { ...left };
    for (const [keyword, value] of Object.entries(right)) {
      if (!Object.hasOwn(merged, keyword) || isDeepEqual(merged[keyword], value)) {
        merged[keyword] = value;
        continue;
      }
      merged[keyword] = this.#mergeKeyword(keyword, merged[keyword], value, merged, right);
    }
    for (const [closed, other] of [[left, right], [right, left]] as const) {
      if (closed.additionalProperties !== false) continue;
      const allowed = Object.keys(asSchemaRecord(closed.properties ?? {}));
      const extra = Object.keys(asSchemaRecord(other.properties ?? {})).filter((name) =>
        !allowed.includes(name)
      );
      if (extra.length > 0) {
        throw new Error(`An allOf branch closes its properties to others' ${extra.join(', ')}`);
      }
    }
    return this.#finalize(merged);
  }

  #mergeKeyword(
    keyword: string,
    left: unknown,
    right: unknown,
    leftSchema: SchemaObject,
    rightSchema: SchemaObject,
  ): unknown {
    switch (keyword) {
      case 'properties': {
        const properties = { ...asSchemaRecord(left) };
        for (const [name, property] of Object.entries(asSchemaRecord(right))) {
          properties[name] = Object.hasOwn(properties, name)
            ? this.#merge(properties[name], property)
            : property;
        }
        return properties;
      }
      case 'required':
        return [...new Set([...asStringList(left), ...asStringList(right)])];
      case 'enum':
        return asList(left).filter((value) =>
          asList(right).some((other) => isDeepEqual(value, other))
        );
      case 'additionalProperties':
        if (left === false || right === false) return false;
        break;
      case 'type':
        if (left === 'integer' && right === 'number') return 'integer';
        if (left === 'number' && right === 'integer') return 'integer';
        break;
    }
    throw new Error(
      `Cannot merge the ${keyword} keywords ${JSON.stringify(leftSchema[keyword])} and ${
        JSON.stringify(rightSchema[keyword])
      }`,
    );
  }

  /** Rewrites a schema's equivalent spellings into one, once its subschemas are canonical. */
  #finalize(schema: SchemaObject): CanonicalJsonSchema {
    const node: SchemaObject = { ...schema };
    // Keywords that accept every value say nothing: any member or item, and JSON's member names,
    // which are always text.
    for (const keyword of ['additionalProperties', 'items'] as const) {
      if (node[keyword] === true || isDeepEqual(node[keyword], {})) delete node[keyword];
    }
    if (isDeepEqual(node.propertyNames, { type: 'string' })) delete node.propertyNames;
    // A list of types accepts a value of any of them, as alternatives of one type each do.
    if (Array.isArray(node.type)) {
      if (Object.keys(node).length !== 1) {
        throw new Error(`A list of types beside other keywords: ${JSON.stringify(node)}`);
      }
      return this.#finalize({ anyOf: node.type.map((type: unknown) => ({ type })) });
    }
    if (Array.isArray(node.enum)) {
      // An enum is a set of values, in whichever order it lists them.
      const values = [...node.enum].sort((left, right) =>
        compareText(stableStringify(left), stableStringify(right))
      );
      if (values.length === 1) {
        node.const = values[0];
        delete node.enum;
      } else {
        node.enum = values;
      }
    }
    // The keywords beside a `const` or an `enum` that each of its values meets reject nothing more.
    const allowedValues = Object.hasOwn(node, 'const')
      ? [node.const]
      : Array.isArray(node.enum)
      ? node.enum
      : undefined;
    if (allowedValues !== undefined) {
      const subsumed = Object.fromEntries(
        CONST_SUBSUMED_KEYWORDS.filter((keyword) =>
          keyword !== 'enum' || Object.hasOwn(node, 'const')
        ).filter((keyword) => Object.hasOwn(node, keyword)).map((keyword) => [
          keyword,
          node[keyword],
        ]),
      );
      if (
        allowedValues.every((value) => this.#validator.findViolations(subsumed, value).length === 0)
      ) {
        for (const keyword of Object.keys(subsumed)) delete node[keyword];
      }
    }
    // zod bounds every integer to the safe range, which JSON integers beyond cannot be read in.
    if (node.type === 'integer') {
      if (node.minimum === -Number.MAX_SAFE_INTEGER) delete node.minimum;
      if (node.maximum === Number.MAX_SAFE_INTEGER) delete node.maximum;
    }
    if (
      typeof node.format === 'string' &&
      node.pattern !== undefined &&
      isDeepEqual(ZOD_FORMAT_PATTERNS.get(node.format), node.pattern)
    ) {
      delete node.pattern;
    }
    // A tuple whose items all have the type of its rest is a list of at least as many items.
    if (
      Array.isArray(node.prefixItems) &&
      node.prefixItems.every((item) => isDeepEqual(item, node.items)) &&
      typeof node.minItems === 'number' && node.minItems >= node.prefixItems.length
    ) {
      delete node.prefixItems;
    }
    if (Array.isArray(node.required)) node.required = [...asStringList(node.required)].sort();
    if (Array.isArray(node.anyOf)) {
      const alternatives = [
        ...new Map(node.anyOf.map((part) => [stableStringify(part), part])).entries(),
      ].sort(([left], [right]) => compareText(left, right)).map(([, part]) => asSchema(part));
      delete node.anyOf;
      if (alternatives.length === 1) return this.#merge(node, alternatives[0]);
      node.anyOf = alternatives;
    }
    return node;
  }
}

/**
 * Describes each place where two canonical schemas differ, as a JSON pointer into them and the
 * value each side has there; none when they are equal.
 */
export function describeSchemaDifferences(
  contractSchema: unknown,
  documentedSchema: unknown,
  pointer = '',
): string[] {
  if (isDeepEqual(contractSchema, documentedSchema)) return [];
  if (
    isSchemaObject(contractSchema) && isSchemaObject(documentedSchema) &&
    !Array.isArray(contractSchema) && !Array.isArray(documentedSchema)
  ) {
    const keys = [...new Set([...Object.keys(contractSchema), ...Object.keys(documentedSchema)])];
    return keys.sort().flatMap((key) =>
      describeSchemaDifferences(
        contractSchema[key],
        documentedSchema[key],
        `${pointer}/${key.replaceAll('~', '~0').replaceAll('/', '~1')}`,
      )
    );
  }
  return [
    `${pointer || '/'}: the contract has ${describeValue(contractSchema)}, the document has ${
      describeValue(documentedSchema)
    }`,
  ];
}

function describeValue(value: unknown): string {
  return value === undefined ? 'nothing' : JSON.stringify(value);
}

function isSchemaObject(value: unknown): value is SchemaObject {
  return value !== null && typeof value === 'object';
}

function asSchema(value: unknown): JsonSchema {
  if (typeof value === 'boolean' || (isSchemaObject(value) && !Array.isArray(value))) {
    return value;
  }
  throw new Error(`Expected a JSON Schema, found ${JSON.stringify(value)}`);
}

function asList(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error(`Expected a list, found ${JSON.stringify(value)}`);
  return value;
}

function asSchemaList(value: unknown): JsonSchema[] {
  return value === undefined ? [] : asList(value).map(asSchema);
}

function asStringList(value: unknown): string[] {
  return asList(value).map((item) => {
    if (typeof item !== 'string') throw new Error(`Expected a name, found ${JSON.stringify(item)}`);
    return item;
  });
}

function asSchemaRecord(value: unknown): Record<string, JsonSchema> {
  if (!isSchemaObject(value) || Array.isArray(value)) {
    throw new Error(`Expected properties, found ${JSON.stringify(value)}`);
  }
  return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, asSchema(item)]));
}

function isDeepEqual(left: unknown, right: unknown): boolean {
  return stableStringify(left) === stableStringify(right);
}

/** JSON text with every object's keys sorted, so that equal values have equal text. */
function stableStringify(value: unknown): string {
  if (value === undefined) return 'undefined';
  return JSON.stringify(
    value,
    (_key, item: unknown) =>
      isSchemaObject(item) && !Array.isArray(item)
        ? Object.fromEntries(
          Object.entries(item).sort(([left], [right]) => compareText(left, right)),
        )
        : item,
  );
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
