/** A value JSON text can hold, as `JSON.parse` reads it. */
export type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | { readonly [member: string]: JsonValue };

/** A JSON object or array: the values a Bot API parameter holds as JSON text. */
export type JsonStructure = readonly JsonValue[] | { readonly [member: string]: JsonValue };

/**
 * Whether `value` matches `pattern`, a JSON value that describes what the value must hold:
 *
 * - a string, number or boolean matches the same value of the same type, so `5` matches neither
 *   `"5"` nor `true`; numbers are compared as JavaScript reads them, so `1` matches `1.0`;
 * - `null` matches only `null`, not a missing member;
 * - an object matches an object, not an array or `null`, that has every member the pattern names
 *   and whose value there matches the pattern's; members the pattern does not name are not
 *   compared, so a pattern cannot require a member to be missing;
 * - an array matches an array of the same length whose elements match the pattern's, in order.
 *
 * Member order never matters, and patterns nested in arrays follow the same rules, so the objects
 * in an array may have members the pattern does not name.
 */
export function matchesJsonPattern(value: JsonValue, pattern: JsonValue): boolean {
  // Pairs still to compare; a stack rather than recursion, so that no nesting depth can overflow
  // the call stack.
  const pendingComparisons: Array<readonly [JsonValue, JsonValue]> = [[value, pattern]];
  for (
    let comparison = pendingComparisons.pop();
    comparison !== undefined;
    comparison = pendingComparisons.pop()
  ) {
    const [comparedValue, comparedPattern] = comparison;
    if (Array.isArray(comparedPattern)) {
      if (!Array.isArray(comparedValue) || comparedValue.length !== comparedPattern.length) {
        return false;
      }
      comparedPattern.forEach((elementPattern, index) =>
        pendingComparisons.push([comparedValue[index], elementPattern])
      );
    } else if (isJsonObject(comparedPattern)) {
      if (!isJsonObject(comparedValue)) {
        return false;
      }
      for (const [member, memberPattern] of Object.entries(comparedPattern)) {
        if (!Object.hasOwn(comparedValue, member)) {
          return false;
        }
        pendingComparisons.push([comparedValue[member], memberPattern]);
      }
    } else if (comparedValue !== comparedPattern) {
      return false;
    }
  }
  return true;
}

/** Whether a JSON value is an object, which neither an array nor `null` is. */
export function isJsonObject(
  value: JsonValue,
): value is { readonly [member: string]: JsonValue } {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
