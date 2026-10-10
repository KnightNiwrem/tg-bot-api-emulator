/**
 * Validates JSON values against the OpenAPI document's schemas, which are JSON Schema 2020-12 as
 * OpenAPI 3.1 uses it.
 */
import { Ajv2020, type ErrorObject, type ValidateFunction } from 'ajv/dist/2020.js';
import ajvFormats from 'ajv-formats';

import type { JsonSchema } from './openapi_document.ts';

/**
 * OpenAPI's `discriminator` only annotates: it names the property that tells a `oneOf`'s
 * alternatives apart, which the `oneOf` itself already decides.
 */
const OPENAPI_DISCRIMINATOR_KEYWORD = 'discriminator';

/** The document's schemas: a validator for them, and the schema files their `$ref`s name. */
export interface DocumentSchemas {
  readonly validator: JsonSchemaValidator;
  /** By absolute URL. */
  readonly schemaFiles: ReadonlyMap<string, JsonSchema>;
}

export class JsonSchemaValidator {
  readonly #ajv: Ajv2020;
  readonly #compiledValidators = new WeakMap<object, ValidateFunction>();

  /** `schemaFiles` are the schemas other schemas reference, by absolute URL. */
  constructor(schemaFiles: ReadonlyMap<string, JsonSchema>) {
    // `strictSchema` makes an unknown keyword or format fail compilation instead of being ignored,
    // so a misspelled constraint cannot pass silently. Ajv's other strict checks reject valid JSON
    // Schema idioms the document uses, so they stay off: `allOf` and `oneOf` branches that constrain
    // or require properties the enclosing schema types and defines, and arrays whose first items
    // `prefixItems` describes while `items` describes the rest.
    this.#ajv = new Ajv2020({
      strictSchema: true,
      strictNumbers: true,
      strictTuples: false,
      strictTypes: false,
      strictRequired: false,
      allErrors: true,
    });
    ajvFormats.default(this.#ajv);
    // `iri` is an absolute IRI; WHATWG URL parsing accepts exactly the absolute ones with any
    // Unicode, which is what the document means by it.
    this.#ajv.addFormat('iri', (value: string) => URL.canParse(value));
    this.#ajv.addKeyword(OPENAPI_DISCRIMINATOR_KEYWORD);
    for (const [schemaFileUrl, schema] of schemaFiles) this.#ajv.addSchema(schema, schemaFileUrl);
  }

  /** Describes each way `value` fails `schema`; none when it conforms. */
  findViolations(schema: JsonSchema, value: unknown): string[] {
    if (typeof schema === 'boolean') return schema ? [] : ['the schema accepts no value'];
    const validate = this.#compiledValidator(schema);
    if (validate(value)) return [];
    return (validate.errors ?? []).map(describeSchemaError);
  }

  #compiledValidator(schema: { readonly [keyword: string]: unknown }): ValidateFunction {
    const cached = this.#compiledValidators.get(schema);
    if (cached !== undefined) return cached;
    const compiled = this.#ajv.compile(schema);
    this.#compiledValidators.set(schema, compiled);
    return compiled;
  }
}

function describeSchemaError(error: ErrorObject): string {
  const location = error.instancePath === '' ? 'the value' : error.instancePath;
  return `${location} ${error.message ?? 'is invalid'} (${error.schemaPath} ${
    JSON.stringify(error.params)
  })`;
}
