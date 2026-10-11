/** The range of Telegram's signed 64-bit identifiers, such as poll and draft IDs. */
const MIN_INT64 = -(2n ** 63n);
const MAX_INT64 = 2n ** 63n - 1n;

/** Decimal integer text, with an optional `-`. */
const DECIMAL_INTEGER_PATTERN = /^-?[0-9]+$/;

/**
 * Whether decimal integer text names a signed 64-bit integer: from -2^63 to 2^63 - 1. Text of
 * any other form is not one, and only decimal integer text is parsed as a number.
 */
export function isInt64DecimalText(text: string): boolean {
  if (!DECIMAL_INTEGER_PATTERN.test(text)) {
    return false;
  }
  const value = BigInt(text);
  return value >= MIN_INT64 && value <= MAX_INT64;
}
