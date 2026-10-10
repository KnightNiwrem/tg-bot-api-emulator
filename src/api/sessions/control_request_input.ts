import type { z } from 'zod';

import type {
  ControlRequestIssue,
  ControlRequestIssueCode,
  ControlRequestIssueSource,
} from '../control_error_response.ts';

/** A control request's input read as its operation's contract describes it, or why it is not. */
export type ControlRequestInputReading<Value> =
  | { readonly valid: true; readonly value: Value }
  | { readonly valid: false; readonly issues: readonly ControlRequestIssue[] };

type ZodIssue = z.core.$ZodIssue;
type IssuePath = readonly (string | number)[];

/** Reads a route's path parameters, such as `{ accountId: '42' }`, as `schema` describes them. */
export function readPathParameters<Schema extends z.ZodType>(
  schema: Schema,
  pathParameters: Readonly<Record<string, string>>,
): ControlRequestInputReading<z.output<Schema>> {
  return readControlRequestInput(schema, pathParameters, 'path');
}

/** Reads one part of a control request as `schema` describes it, normalizing what it rejects. */
export function readControlRequestInput<Schema extends z.ZodType>(
  schema: Schema,
  input: unknown,
  source: ControlRequestIssueSource,
): ControlRequestInputReading<z.output<Schema>> {
  const parsedInput = schema.safeParse(input);
  return parsedInput.success
    ? { valid: true, value: parsedInput.data }
    : { valid: false, issues: toControlRequestIssues(parsedInput.error.issues, source, []) };
}

/**
 * Describes what a schema rejected in the emulator's own issue vocabulary, so that neither the
 * validation library's issue format nor any input value is published. Paths are made absolute
 * from the part's root.
 */
function toControlRequestIssues(
  zodIssues: readonly ZodIssue[],
  source: ControlRequestIssueSource,
  basePath: IssuePath,
): ControlRequestIssue[] {
  return zodIssues.flatMap((zodIssue) => {
    const path = [...basePath, ...zodIssue.path.map(toIssuePathSegment)];
    switch (zodIssue.code) {
      case 'unrecognized_keys':
        return zodIssue.keys.map((key) => ({
          source,
          path: [...path, key],
          code: 'unknown_field' as const,
          message: source === 'query'
            ? 'The operation takes no query parameter of this name'
            : 'The operation takes no field of this name',
        }));
      case 'invalid_union':
        return toUnionIssues(zodIssue, source, path);
      default:
        return [{ source, path, code: toIssueCode(zodIssue.code), message: zodIssue.message }];
    }
  });
}

/**
 * Describes a value that matches none of a union's alternatives. When exactly one alternative
 * accepts the value's type and every field it has, the value was meant as that alternative, so
 * its issues are the ones reported. Otherwise the value is reported as matching no alternative,
 * or, for a union told apart by a field, as having an unknown value there.
 */
function toUnionIssues(
  zodIssue: Extract<ZodIssue, { readonly code: 'invalid_union' }>,
  source: ControlRequestIssueSource,
  path: IssuePath,
): ControlRequestIssue[] {
  // The issue of a union told apart by a field is already at that field.
  if (zodIssue.discriminator !== undefined) {
    return [{
      source,
      path,
      code: 'invalid_value',
      message: 'The value names none of the accepted variants',
    }];
  }
  const intendedAlternatives = zodIssue.errors.filter((alternativeIssues) =>
    !alternativeIssues.some(rejectsValueShape)
  );
  const [intendedAlternative] = intendedAlternatives;
  if (intendedAlternatives.length === 1 && intendedAlternative !== undefined) {
    return toControlRequestIssues(intendedAlternative, source, path);
  }
  return [{
    source,
    path,
    code: 'no_matching_variant',
    message: 'The value matches none of the accepted variants',
  }];
}

/** Whether an alternative's issue rejects the value as a whole: its type, or a field it has. */
function rejectsValueShape(zodIssue: ZodIssue): boolean {
  return zodIssue.path.length === 0 &&
    (zodIssue.code === 'invalid_type' || zodIssue.code === 'unrecognized_keys');
}

function toIssueCode(
  zodIssueCode: Exclude<ZodIssue['code'], 'unrecognized_keys' | 'invalid_union'>,
): ControlRequestIssueCode {
  switch (zodIssueCode) {
    case 'invalid_type':
    case 'too_small':
    case 'too_big':
    case 'invalid_format':
    case 'invalid_value':
      return zodIssueCode;
    case 'not_multiple_of':
    case 'invalid_key':
    case 'invalid_element':
    case 'custom':
      return 'invalid_value';
    default: {
      const unhandledCode: never = zodIssueCode;
      throw new Error(`Unhandled validation issue code: ${unhandledCode}`);
    }
  }
}

/** A path segment of request input: a field name or a list index, as no input has symbol keys. */
function toIssuePathSegment(segment: PropertyKey): string | number {
  if (typeof segment === 'symbol') {
    throw new Error(`Unexpected symbol in a validation issue path: ${String(segment)}`);
  }
  return segment;
}
