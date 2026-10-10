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
  // A depth-first walk of the pattern: each step checks a value, or leaves the object or array
  // entered last. The objects and arrays entered and not yet left hold the value being checked, so
  // meeting one of them again is a cycle.
  const steps: PatternCheckStep[] = [{ kind: 'check', value: pattern, segment: '' }];
  const enteredContainers = new Set<object>();
  const enteredContainerStack: object[] = [];
  const enteredSegments: string[] = [];
  for (let step = steps.pop(); step !== undefined; step = steps.pop()) {
    if (step.kind === 'leave') {
      const leftContainer = enteredContainerStack.pop();
      if (leftContainer !== undefined) {
        enteredContainers.delete(leftContainer);
      }
      enteredSegments.pop();
      continue;
    }
    const { value, segment } = step;
    if (
      value === null || typeof value === 'boolean' || typeof value === 'string' ||
      (typeof value === 'number' && Number.isFinite(value))
    ) {
      continue;
    }
    // Assembled only for a fault, so that checking a value costs the same at any depth.
    const location = () => {
      const path = `${enteredSegments.join('')}${segment}`;
      return path === '' ? subject : `${subject} at ${path}`;
    };
    if (!Array.isArray(value) && !isPlainObject(value)) {
      throw new TypeError(`${location()} must hold only JSON values, not ${describeValue(value)}`);
    }
    if (enteredContainers.has(value)) {
      throw new TypeError(`${location()} must not contain itself`);
    }
    enteredContainers.add(value);
    enteredContainerStack.push(value);
    enteredSegments.push(segment);
    steps.push({ kind: 'leave' });
    const members: Array<readonly [string, unknown]> = Array.isArray(value)
      ? Array.from(value, (element, index) => [`[${index}]`, element])
      : Object.entries(value).map(([name, member]) => [`.${name}`, member]);
    // Pushed last first, so that members are checked in order and the first fault is reported.
    for (const [memberSegment, member] of members.reverse()) {
      steps.push({ kind: 'check', value: member, segment: memberSegment });
    }
  }
}

/** A step of `assertJsonStructure`'s walk of a pattern. */
type PatternCheckStep =
  | {
    readonly kind: 'check';
    readonly value: unknown;
    /** Where the value is in the object or array entered last, such as `.name` or `[0]`. */
    readonly segment: string;
  }
  | { readonly kind: 'leave' };

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
