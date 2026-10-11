/**
 * An assertion for values whose field order is part of what the emulator reproduces: the Telegram
 * objects it serializes in the field order of the official Bot API server.
 */
import { assertEquals } from '@std/assert';

/**
 * Asserts that `actual` deeply equals `expected`, as `assertEquals` does, and that each object in
 * `actual`, at every depth, lists its fields in the order the matching object in `expected` does.
 * `assertEquals` alone accepts the same fields in any order.
 */
export function assertEqualsInFieldOrder(
  actual: unknown,
  expected: unknown,
  message?: string,
): void {
  assertEquals(actual, expected, message);
  assertEquals(
    fieldPaths(actual),
    fieldPaths(expected),
    `${message ?? 'Expected the same fields'}, in the same field order`,
  );
}

/** The path of each field of `value`, at every depth, in the order the fields are listed. */
function fieldPaths(value: unknown, path = '$'): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => fieldPaths(item, `${path}[${index}]`));
  }
  if (typeof value !== 'object' || value === null) {
    return [];
  }
  return Object.entries(value).flatMap(([key, field]) => {
    const fieldPath = `${path}.${key}`;
    return [fieldPath, ...fieldPaths(field, fieldPath)];
  });
}
