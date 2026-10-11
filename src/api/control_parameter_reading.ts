/**
 * Reads a control request's path and query parameters, which arrive as text, into the values their
 * operation's contract describes, as OpenAPI's parameter serialization writes them: text as it is,
 * an integer from its decimal digits, a boolean from `true` or `false`, and the object or JSON value
 * of a query parameter the contract serializes otherwise.
 */
import { z } from 'zod';

import type {
  ControlOperationContract,
  QueryParameterSerialization,
} from '../../control_contracts/operation_contract.ts';
import type { ControlRequestIssue } from './control_error_response.ts';
import { readJsonQueryParameter } from './json_query_parameter.ts';
import {
  type ControlRequestInputReading,
  readControlRequestInput,
} from './sessions/control_request_input.ts';

/** How the text of a single-valued parameter is read: as it is, or as the value it writes. */
type ParameterTextForm = 'text' | 'integer' | 'boolean';

/** An integer as a parameter writes it: decimal digits, after a `-` for a negative one. */
const DECIMAL_INTEGER_PATTERN = /^-?\d+$/;

/** The key under which zod's records neither check nor keep a member. */
const PROTOTYPE_KEY = '__proto__';

/** Reads a route's path parameters, such as `{ accountId: '42' }`, as their contract describes. */
export type PathParameterReader = (
  pathParameters: Readonly<Record<string, string>>,
) => ControlRequestInputReading<unknown>;

/** Reads a request's query as its contract describes it. */
export type QueryReader = (searchParams: URLSearchParams) => ControlRequestInputReading<unknown>;

/**
 * Creates the reader of an operation's path parameters. A text that does not write the integer or
 * boolean a parameter takes is checked as the text it is, so its schema reports it as of the wrong
 * type.
 *
 * @throws {Error} when a parameter's schema takes a value that no parameter text writes.
 */
export function createPathParameterReader(
  contract: ControlOperationContract,
  schema: z.ZodObject,
): PathParameterReader {
  const textForms = readTextForms(contract, schema, {});
  return (pathParameters) =>
    readControlRequestInput(
      schema,
      Object.fromEntries(
        Object.entries(pathParameters).map(([name, text]) => [
          name,
          readParameterText(textForms.get(name), text),
        ]),
      ),
      'path',
    );
}

/**
 * Creates the reader of an operation's query. Each single-valued parameter is read as a path
 * parameter is, a `deepObject` one from its `name[member]` keys, and a `json` one from its JSON
 * text. Every key the request repeats is reported by the key it sent, and each problem with a
 * JSON parameter's text at its place within the JSON.
 *
 * The object of a `deepObject` parameter and the value of a `json` one are the reader's own, which
 * its schema checked: zod's records leave out a `__proto__` member, which is a key like any other
 * on the wire, and the value of a `json` parameter keeps its numbers exact.
 *
 * @throws {Error} when a single-valued parameter's schema takes a value that no text writes.
 */
export function createQueryReader(
  contract: ControlOperationContract,
  schema: z.ZodObject,
): QueryReader {
  const serialization: { readonly [name: string]: QueryParameterSerialization } =
    contract.querySerialization ?? {};
  const textForms = readTextForms(contract, schema, serialization);
  const deepObjectNames = Object.keys(serialization).filter((name) =>
    serialization[name] === 'deepObject'
  );

  return (searchParams) => {
    // Query keys are the client's, so they are collected in maps and made own properties with
    // `Object.fromEntries`, which no key such as `__proto__` can turn into a prototype change.
    const singleTexts = new Map<string, string>();
    const objectMembers = new Map<string, Map<string, string>>();
    const repeatedKeys = new Set<string>();
    for (const [key, text] of searchParams) {
      const deepObjectKey = readDeepObjectKey(key, deepObjectNames);
      const [texts, textKey] = deepObjectKey === undefined
        ? [singleTexts, key]
        : [getOrCreateMembers(objectMembers, deepObjectKey.name), deepObjectKey.member];
      if (texts.has(textKey)) {
        repeatedKeys.add(key);
      } else {
        texts.set(textKey, text);
      }
    }

    const input = new Map<string, unknown>();
    const readerValues = new Map<string, unknown>();
    const jsonTextIssues = new Map<string, readonly ControlRequestIssue[]>();
    for (const [key, text] of singleTexts) {
      if (serialization[key] !== 'json') {
        input.set(key, readParameterText(textForms.get(key), text));
        continue;
      }
      const reading = readJsonQueryParameter(key, text);
      jsonTextIssues.set(key, reading.issues);
      if (reading.value !== undefined) {
        input.set(key, reading.value.parsedValue);
        readerValues.set(key, reading.value.exactValue);
      }
    }
    for (const [name, members] of objectMembers) {
      // A parameter also sent as one `name=value` pair is checked as that text, which it refuses.
      if (input.has(name)) continue;
      const object = Object.fromEntries(members);
      input.set(name, object);
      readerValues.set(name, object);
    }

    const query = readControlRequestInput(schema, Object.fromEntries(input), 'query');
    const schemaIssues = [
      ...(query.valid ? [] : query.issues),
      ...[...readerValues.keys()].flatMap((name) =>
        readPrototypeKeyMemberIssues(schema.shape[name], input.get(name), name)
      ),
    ];
    // Each JSON parameter's issues follow the others, its text's first, in the order it was sent.
    const isJsonParameterIssue = ({ path: [name] }: ControlRequestIssue) =>
      typeof name === 'string' && jsonTextIssues.has(name);
    const issues = [
      ...[...repeatedKeys].map((key): ControlRequestIssue => ({
        source: 'query',
        path: [key],
        code: 'duplicate_field',
        message: 'The query parameter is repeated',
      })),
      ...schemaIssues.filter((issue) => !isJsonParameterIssue(issue)),
      ...[...jsonTextIssues].flatMap(([name, textIssues]) => [
        ...textIssues,
        ...schemaIssues.filter(({ path: [issueName] }) => issueName === name),
      ]),
    ];
    if (!query.valid || issues.length > 0) {
      return { valid: false, issues };
    }
    return { valid: true, value: { ...query.value, ...Object.fromEntries(readerValues) } };
  };
}

/**
 * How each single-valued parameter of `schema` is read, by its name: from the type its JSON
 * Schema gives, as OpenAPI reads a parameter's text by its schema.
 *
 * @throws {Error} when a parameter's schema is not of text, an integer, or a boolean.
 */
function readTextForms(
  contract: ControlOperationContract,
  schema: z.ZodObject,
  serialization: { readonly [name: string]: QueryParameterSerialization },
): ReadonlyMap<string, ParameterTextForm> {
  const textForms = new Map<string, ParameterTextForm>();
  for (const [name, parameterSchema] of Object.entries(schema.shape)) {
    if (Object.hasOwn(serialization, name)) continue;
    const { type } = z.toJSONSchema(parameterSchema, { io: 'input' });
    switch (type) {
      case 'string':
        textForms.set(name, 'text');
        break;
      case 'integer':
      case 'boolean':
        textForms.set(name, type);
        break;
      default:
        throw new Error(
          `${contract.operationId}'s parameter ${name} takes a value no parameter text writes`,
        );
    }
  }
  return textForms;
}

/** The value a parameter's text writes, or the text itself, which its schema then refuses. */
function readParameterText(textForm: ParameterTextForm | undefined, text: string): unknown {
  switch (textForm) {
    case 'integer':
      return DECIMAL_INTEGER_PATTERN.test(text) ? Number(text) : text;
    case 'boolean':
      return text === 'true' ? true : text === 'false' ? false : text;
    case 'text':
    case undefined:
      return text;
    default: {
      const unhandledTextForm: never = textForm;
      throw new Error(`Unhandled parameter text form: ${unhandledTextForm}`);
    }
  }
}

/**
 * The parameter and member that a `name[member]` query key names, for a `deepObject` parameter of
 * one of `names`; `undefined` for any other key, including one that names no member. A member may
 * hold any character, line breaks included.
 */
function readDeepObjectKey(
  key: string,
  names: readonly string[],
): { readonly name: string; readonly member: string } | undefined {
  for (const name of names) {
    const prefix = `${name}[`;
    if (key.length > prefix.length + 1 && key.startsWith(prefix) && key.endsWith(']')) {
      return { name, member: key.slice(prefix.length, -1) };
    }
  }
  return undefined;
}

function getOrCreateMembers(
  objectMembers: Map<string, Map<string, string>>,
  name: string,
): Map<string, string> {
  const members = objectMembers.get(name) ?? new Map<string, string>();
  objectMembers.set(name, members);
  return members;
}

/**
 * The issues of a record's `__proto__` member, which zod's records skip, so that the reader checks
 * it against the record's member schema itself; none when the parameter is no record or has no
 * such member.
 */
function readPrototypeKeyMemberIssues(
  parameterSchema: unknown,
  value: unknown,
  name: string,
): ControlRequestIssue[] {
  let recordSchema = parameterSchema;
  while (recordSchema instanceof z.ZodOptional || recordSchema instanceof z.ZodDefault) {
    recordSchema = recordSchema.unwrap();
  }
  if (
    !(recordSchema instanceof z.ZodRecord) ||
    value === null || typeof value !== 'object' || !Object.hasOwn(value, PROTOTYPE_KEY)
  ) {
    return [];
  }
  const memberReading = readControlRequestInput(
    recordSchema.valueType,
    Object.getOwnPropertyDescriptor(value, PROTOTYPE_KEY)?.value,
    'query',
  );
  return memberReading.valid ? [] : memberReading.issues.map((issue) => ({
    ...issue,
    path: [name, PROTOTYPE_KEY, ...issue.path],
  }));
}
