import type { JsonStructure, JsonValue } from './types.ts';

/**
 * Checks that a parameter pattern is a JSON object or array made only of values JSON text can
 * hold, so that sending it as JSON keeps its meaning: `JSON.stringify` would drop an `undefined`
 * member, turn `NaN` into `null` and a `Date` into text. Fails with a `TypeError` that names
 * `subject` and where in the pattern the first such value is.
 */
export function assertJsonStructure(
  pattern: unknown,
  subject: string,
): asserts pattern is JsonStructure {
  if (!Array.isArray(pattern) && !isPlainObject(pattern)) {
    throw new TypeError(`${subject} must be a JSON object or array`);
  }
  // Values still to check, with where each is in the pattern and the objects and arrays that hold
  // it, by which a cycle is found.
  const pendingValues: Array<
    { readonly value: unknown; readonly path: string; readonly holders: readonly object[] }
  > = [{ value: pattern, path: '', holders: [] }];
  for (let pending = pendingValues.pop(); pending !== undefined; pending = pendingValues.pop()) {
    const { value, path, holders } = pending;
    const location = path === '' ? subject : `${subject} at ${path}`;
    if (
      value === null || typeof value === 'boolean' || typeof value === 'string' ||
      (typeof value === 'number' && Number.isFinite(value))
    ) {
      continue;
    }
    if (!Array.isArray(value) && !isPlainObject(value)) {
      throw new TypeError(`${location} must hold only JSON values, not ${describeValue(value)}`);
    }
    if (holders.includes(value)) {
      throw new TypeError(`${location} must not contain itself`);
    }
    const memberHolders = [...holders, value];
    const members: Array<readonly [string, unknown]> = Array.isArray(value)
      ? Array.from(value, (element, index) => [`[${index}]`, element])
      : Object.entries(value).map(([name, member]) => [`.${name}`, member]);
    for (const [memberPath, member] of members) {
      pendingValues.push({ value: member, path: `${path}${memberPath}`, holders: memberHolders });
    }
  }
}

/**
 * The JSON text of a value with every object's members in one order, so that values that differ
 * only in member order have the same text.
 */
export function canonicalJsonText(value: JsonValue): string {
  if (isJsonArray(value)) {
    return `[${value.map(canonicalJsonText).join(',')}]`;
  }
  if (typeof value === 'object' && value !== null) {
    const members = Object.keys(value).sort().map((name) =>
      `${JSON.stringify(name)}:${canonicalJsonText(value[name])}`
    );
    return `{${members.join(',')}}`;
  }
  return JSON.stringify(value);
}

/** Tells a JSON array apart, which `Array.isArray` does not narrow a readonly array to. */
function isJsonArray(value: JsonValue): value is readonly JsonValue[] {
  return Array.isArray(value);
}

function isPlainObject(value: unknown): value is Readonly<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/** Names a value that JSON text cannot hold, such as `undefined`, `NaN` or a `Date`. */
function describeValue(value: unknown): string {
  if (typeof value === 'undefined' || typeof value === 'number') {
    return String(value);
  }
  if (typeof value === 'object' && value !== null) {
    const constructorName: unknown = value.constructor?.name;
    return typeof constructorName === 'string' && constructorName !== ''
      ? `a ${constructorName}`
      : 'an object of a class';
  }
  return `a ${typeof value}`;
}
