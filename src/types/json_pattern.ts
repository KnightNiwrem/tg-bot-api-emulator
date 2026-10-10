/**
 * A number in JSON text, kept as the exact decimal value its text spells rather than as the nearest
 * JavaScript number. `JSON.parse` would read `1e400` and `1e500` alike as `Infinity`, and
 * `9007199254740993` as `9007199254740992`, so comparing JavaScript numbers would match values the
 * texts tell apart.
 */
export class JsonDecimal {
  /**
   * The value in one spelling for each number: `0`, or a sign, the significant digits without
   * leading or trailing zeros, and a decimal exponent, such as `-15e-1` for `-1.50`.
   */
  readonly exactValue: string;

  constructor(numberText: string) {
    const parts = JSON_NUMBER_PATTERN.exec(numberText);
    if (parts === null) {
      throw new RangeError(`Not a JSON number: ${numberText}`);
    }
    const [, sign, integerDigits, fractionDigits = '', exponentDigits = '0'] = parts;
    const allDigits = `${integerDigits}${fractionDigits}`;
    const significantStart = allDigits.search(/[1-9]/);
    if (significantStart === -1) {
      // Zero has no sign: `-0` and `0.0` are both 0.
      this.exactValue = '0';
      return;
    }
    // Found by a loop rather than a pattern such as /0+$/, which backtracks over every run of
    // zeros that does not end the text.
    let significantEnd = allDigits.length;
    while (allDigits[significantEnd - 1] === '0') {
      significantEnd--;
    }
    const significantDigits = allDigits.slice(significantStart, significantEnd);
    const trailingZeroCount = allDigits.length - significantEnd;
    const exponent = BigInt(exponentDigits) - BigInt(fractionDigits.length) +
      BigInt(trailingZeroCount);
    this.exactValue = `${sign}${significantDigits}e${exponent}`;
  }
}

/** JSON's number grammar: a sign, an integer part, an optional fraction and exponent. */
const JSON_NUMBER_PATTERN = /^(-?)(0|[1-9]\d*)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/;

/** A value JSON text can hold, as `readJsonText` reads it, with numbers exact. */
export type JsonValue =
  | null
  | boolean
  | JsonDecimal
  | string
  | readonly JsonValue[]
  | { readonly [member: string]: JsonValue };

/** A JSON object or array: the values a Bot API parameter holds as JSON text. */
export type JsonStructure = readonly JsonValue[] | { readonly [member: string]: JsonValue };

/**
 * The most levels of objects and arrays JSON text read as a pattern or a matched value may nest.
 * The JSON of a Bot API parameter nests a few levels, such as an inline keyboard's four. The limit
 * keeps the reading of a number's source text, which `JSON.parse` does by recursion, within the
 * call stack, and bounds the path of each issue reported about a pattern.
 */
export const MAX_JSON_NESTING_DEPTH = 100;

export type JsonTextReading =
  | { readonly read: true; readonly value: JsonValue }
  | {
    readonly read: false;
    /** `not_json` for text that is not JSON; `too_deep` for JSON nested beyond the limit. */
    readonly reason: 'not_json' | 'too_deep';
  };

/**
 * Reads JSON text that nests at most `MAX_JSON_NESTING_DEPTH` levels, keeping each number as the
 * exact value its text spells. Members are own properties whatever their names, `__proto__`
 * included, as `JSON.parse` defines them.
 */
export function readJsonText(text: string): JsonTextReading {
  // Checked first by `JSON.parse` alone, which reads any depth, so that only text known to be JSON
  // within the limit is read again with the source text of its numbers.
  try {
    JSON.parse(text);
  } catch {
    return { read: false, reason: 'not_json' };
  }
  if (nestingDepthExceeds(text, MAX_JSON_NESTING_DEPTH)) {
    return { read: false, reason: 'too_deep' };
  }
  const value: JsonValue = JSON.parse(
    text,
    (_key: string, parsedValue: unknown, context?: { readonly source?: string }) => {
      if (typeof parsedValue !== 'number') {
        return parsedValue;
      }
      if (context?.source === undefined) {
        throw new Error('JSON.parse did not report the source text of a number');
      }
      return new JsonDecimal(context.source);
    },
  );
  return { read: true, value };
}

/** Whether JSON text nests objects and arrays more than `maxDepth` levels, outside its strings. */
function nestingDepthExceeds(jsonText: string, maxDepth: number): boolean {
  let depth = 0;
  for (let index = 0; index < jsonText.length; index++) {
    switch (jsonText[index]) {
      case '{':
      case '[':
        depth++;
        if (depth > maxDepth) {
          return true;
        }
        break;
      case '}':
      case ']':
        depth--;
        break;
      case '"':
        // Skips the string, whose brackets are text.
        for (index++; jsonText[index] !== '"'; index++) {
          if (jsonText[index] === '\\') {
            index++;
          }
        }
        break;
    }
  }
  return false;
}

/**
 * Whether `value` matches `pattern`, a JSON value that describes what the value must hold:
 *
 * - a string, number or boolean matches the same value of the same type, so `5` matches neither
 *   `"5"` nor `true`. Numbers compare by the exact decimal value their text spells, so `1`
 *   matches `1.0`, `1e2` and `100`, and `-0` matches `0`, but `9007199254740993` does not match
 *   `9007199254740992`, nor `1e400` match `1e500`, though JavaScript reads each pair as one number;
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
    if (comparedPattern instanceof JsonDecimal) {
      if (
        !(comparedValue instanceof JsonDecimal) ||
        comparedValue.exactValue !== comparedPattern.exactValue
      ) {
        return false;
      }
    } else if (Array.isArray(comparedPattern)) {
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

/** Whether a JSON value is an object, which neither an array, a number nor `null` is. */
export function isJsonObject(
  value: JsonValue,
): value is { readonly [member: string]: JsonValue } {
  return typeof value === 'object' && value !== null && !Array.isArray(value) &&
    !(value instanceof JsonDecimal);
}
