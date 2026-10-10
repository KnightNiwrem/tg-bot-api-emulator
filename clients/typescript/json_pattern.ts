import type { JsonStructure, JsonValue } from './types.ts';

/** A pattern as the client read it: a copy of the values it checked, and that copy's JSON text. */
export interface CheckedJsonPattern {
  /**
   * A frozen copy, whose objects have no prototype, of the values read from the pattern; no hook
   * of the original, such as a `toJSON` method or a getter, can run on it.
   */
  readonly value: JsonStructure;
  /**
   * The JSON text of `value`, built from the values the check read rather than by `JSON.stringify`
   * on the original. Each object's members are in the order of their names' UTF-16 code units, so
   * patterns that differ only in member order have the same text.
   */
  readonly text: string;
}

/**
 * Reads a parameter pattern, which must be a JSON object or array, in one pass that checks each
 * value, copies it and writes its JSON text, so that the text sent is exactly what was checked.
 *
 * Only what JSON text holds is accepted: `null`, booleans, strings, finite numbers, arrays without
 * holes and objects whose prototype is `Object.prototype` or `null`. An object or array that has a
 * `toJSON` property, its own or inherited, or a member defined by a getter or setter, is refused,
 * as `JSON.stringify` would send what that code returns rather than what the check saw. Members
 * that are not enumerable, or are named by symbols, are left out, as `JSON.stringify` leaves them
 * out. Each member is read once, from its property descriptor, so even a proxy cannot make the
 * text differ from the copy.
 *
 * Fails with a `TypeError` that names `subject` and where in the pattern the first fault is. The
 * pass uses no recursion and builds a location only for the fault it reports, so it takes time in
 * proportion to the pattern's size at any depth.
 */
export function checkJsonPattern(pattern: unknown, subject: string): CheckedJsonPattern {
  const textParts: string[] = [];
  // A depth-first walk: each step reads a value, or closes the object or array opened last. The
  // objects and arrays opened and not yet closed hold the value being read, so meeting one of them
  // again is a cycle.
  const steps: PatternReadingStep[] = [];
  const openContainers = new Set<object>();
  const openContainerStack: object[] = [];
  const openSegments: string[] = [];
  const locationOf = (segment: string) => {
    const path = `${openSegments.join('')}${segment}`;
    return path === '' ? subject : `${subject} at ${path}`;
  };

  /**
   * Checks an object or array, writes its opening, and schedules reading its members and closing
   * it; returns its copy, which its members' copies fill as they are read.
   */
  const openContainer = (container: object, segment: string): JsonStructure => {
    if (openContainers.has(container)) {
      throw new TypeError(`${locationOf(segment)} must not contain itself`);
    }
    if ('toJSON' in container) {
      throw new TypeError(`${locationOf(segment)} must not have a toJSON property`);
    }
    const isArray = Array.isArray(container);
    const memberSegment = (name: string) => isArray ? `[${name}]` : `.${name}`;
    const members = readMembers(
      container,
      (name) => locationOf(`${segment}${memberSegment(name)}`),
    );
    openContainers.add(container);
    openContainerStack.push(container);
    openSegments.push(segment);
    const copy: JsonValue[] | Record<string, JsonValue> = isArray ? [] : Object.create(null);
    textParts.push(isArray ? '[' : '{');
    steps.push({ kind: 'close', closingText: isArray ? ']' : '}', copy });
    if (!isArray) {
      members.sort(([first], [second]) => first < second ? -1 : first > second ? 1 : 0);
    }
    // Scheduled last first, so that members are read, and written, in order.
    for (let index = members.length - 1; index >= 0; index--) {
      const [name, member] = members[index];
      const separator = index === 0 ? '' : ',';
      steps.push({
        kind: 'read',
        value: member,
        segment: memberSegment(name),
        textPrefix: isArray ? separator : `${separator}${JSON.stringify(name)}:`,
        // The object copy has no prototype, so no name, `__proto__` included, is special to it.
        store: (memberCopy) => Reflect.set(copy, name, memberCopy),
      });
    }
    return copy;
  };

  if (!Array.isArray(pattern) && !isPlainObject(pattern)) {
    throw new TypeError(`${subject} must be a JSON object or array`);
  }
  const copiedPattern = openContainer(pattern, '');
  for (let step = steps.pop(); step !== undefined; step = steps.pop()) {
    if (step.kind === 'close') {
      textParts.push(step.closingText);
      Object.freeze(step.copy);
      const closedContainer = openContainerStack.pop();
      if (closedContainer !== undefined) {
        openContainers.delete(closedContainer);
      }
      openSegments.pop();
      continue;
    }
    const { value, segment, textPrefix, store } = step;
    textParts.push(textPrefix);
    if (
      value === null || typeof value === 'boolean' || typeof value === 'string' ||
      (typeof value === 'number' && Number.isFinite(value))
    ) {
      // `JSON.stringify` runs no hook on a primitive.
      textParts.push(JSON.stringify(value));
      store(value);
    } else if (Array.isArray(value) || isPlainObject(value)) {
      store(openContainer(value, segment));
    } else {
      throw new TypeError(
        `${locationOf(segment)} must hold only JSON values, not ${describeValue(value)}`,
      );
    }
  }
  return { value: copiedPattern, text: textParts.join('') };
}

/** A step of `checkJsonPattern`'s walk of a pattern. */
type PatternReadingStep =
  | {
    readonly kind: 'read';
    readonly value: unknown;
    /** Where the value is in the object or array opened last, such as `.name` or `[0]`. */
    readonly segment: string;
    /** The text that comes before the value's: a comma, and an object member's name. */
    readonly textPrefix: string;
    /** Puts the value's copy where the value is in its holder's copy. */
    readonly store: (copy: JsonValue) => void;
  }
  | {
    readonly kind: 'close';
    readonly closingText: '}' | ']';
    readonly copy: object;
  };

/**
 * The members `JSON.stringify` would write of an object or array, each read once from its property
 * descriptor: an array's elements, and an object's enumerable members named by strings. Refuses a
 * hole in an array and a member defined by a getter or setter.
 */
function readMembers(
  container: object,
  memberLocation: (name: string) => string,
): Array<readonly [string, unknown]> {
  const names = Array.isArray(container)
    ? Array.from({ length: container.length }, (_, index) => String(index))
    : Object.keys(container);
  return names.map((name) => {
    const descriptor = Object.getOwnPropertyDescriptor(container, name);
    if (descriptor === undefined) {
      throw new TypeError(`${memberLocation(name)} must hold a value`);
    }
    if (!('value' in descriptor)) {
      throw new TypeError(`${memberLocation(name)} must hold data, not a getter or setter`);
    }
    return [name, descriptor.value];
  });
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
