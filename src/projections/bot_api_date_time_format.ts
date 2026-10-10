import type { BotApiDateTimeFormat } from '../types/bot_api.ts';
import type { DateTimeFormat, DateTimePartPrecision } from '../types/virtual_message.ts';

/** The letters of Bot API date and time formats that choose each part's precision. */
const DATE_PRECISION_LETTERS: Readonly<Record<DateTimePartPrecision, 'd' | 'D'>> = {
  short: 'd',
  long: 'D',
};
const TIME_PRECISION_LETTERS: Readonly<Record<DateTimePartPrecision, 't' | 'T'>> = {
  short: 't',
  long: 'T',
};

/**
 * Writes a date and time format as the official Bot API server's `get_date_time_format` does:
 * `r` for relative time, otherwise `w` for the day of the week, then `d` or `D` for the date and
 * `t` or `T` for the time, each shown in that order; empty for no format.
 */
export function writeDateTimeFormat(format: DateTimeFormat | undefined): BotApiDateTimeFormat {
  if (format === undefined) {
    return '';
  }
  if (format.kind === 'relative') {
    return 'r';
  }
  const { showsDayOfWeek, datePrecision, timePrecision } = format;
  const dayOfWeekLetter = showsDayOfWeek ? 'w' : '';
  const dateLetter = datePrecision === undefined ? '' : DATE_PRECISION_LETTERS[datePrecision];
  const timeLetter = timePrecision === undefined ? '' : TIME_PRECISION_LETTERS[timePrecision];
  return `${dayOfWeekLetter}${dateLetter}${timeLetter}`;
}
