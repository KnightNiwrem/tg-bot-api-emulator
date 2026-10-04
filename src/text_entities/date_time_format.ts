import type { DateTimeFormat, DateTimePartPrecision } from '../types/virtual_message.ts';

export type MarkupDateTimeFormatReading =
  | { readonly valid: true; readonly format?: DateTimeFormat }
  | { readonly valid: false };

/**
 * Reads the format of a date and time written in markup, as TDLib's `FormattedDate::get_date_flags`
 * does: exactly `r` or `R` for relative time, or any combination of `t` and `T` for a short or
 * long time, `d` and `D` for a short or long date, and `w` or `W` for the day of the week. Empty
 * text chooses no format.
 *
 * TDLib keeps every letter as a flag, and clients show the short form of a part given both ways,
 * as the Bot API server reports it.
 */
export function readMarkupDateTimeFormat(format: string): MarkupDateTimeFormatReading {
  if (format === 'r' || format === 'R') {
    return { valid: true, format: { kind: 'relative' } };
  }
  if (!/^[tTdDwW]*$/.test(format)) {
    return { valid: false };
  }
  if (format.length === 0) {
    return { valid: true };
  }
  const timePrecision = readPrecision(format, 't', 'T');
  const datePrecision = readPrecision(format, 'd', 'D');
  return {
    valid: true,
    format: {
      kind: 'absolute',
      ...(timePrecision === undefined ? {} : { timePrecision }),
      ...(datePrecision === undefined ? {} : { datePrecision }),
      showsDayOfWeek: format.includes('w') || format.includes('W'),
    },
  };
}

/** The short precision when its letter is present, otherwise the long one when its letter is. */
function readPrecision(
  format: string,
  shortLetter: string,
  longLetter: string,
): DateTimePartPrecision | undefined {
  if (format.includes(shortLetter)) {
    return 'short';
  }
  return format.includes(longLetter) ? 'long' : undefined;
}
