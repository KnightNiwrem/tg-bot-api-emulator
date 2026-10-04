import {
  type MarkupDateTimeFormatReading,
  readMarkupDateTimeFormat,
} from '../src/text_entities/date_time_format.ts';

// Expected results follow TDLib's `FormattedDate::get_date_flags` and
// `FormattedDate::get_date_time_formatting_type_object` in `td/telegram/FormattedDate.cpp`.

Deno.test('readMarkupDateTimeFormat shows the day of week for either letter case', () => {
  assertFormatReading('w', { valid: true, format: { kind: 'absolute', showsDayOfWeek: true } });
  assertFormatReading('W', { valid: true, format: { kind: 'absolute', showsDayOfWeek: true } });
  assertFormatReading('wWw', { valid: true, format: { kind: 'absolute', showsDayOfWeek: true } });
  assertFormatReading('tDW', {
    valid: true,
    format: {
      kind: 'absolute',
      timePrecision: 'short',
      datePrecision: 'long',
      showsDayOfWeek: true,
    },
  });
  assertFormatReading('Td', {
    valid: true,
    format: {
      kind: 'absolute',
      timePrecision: 'long',
      datePrecision: 'short',
      showsDayOfWeek: false,
    },
  });
});

Deno.test('readMarkupDateTimeFormat reads empty and relative formats', () => {
  assertFormatReading('', { valid: true });
  assertFormatReading('r', { valid: true, format: { kind: 'relative' } });
  assertFormatReading('R', { valid: true, format: { kind: 'relative' } });
});

Deno.test('readMarkupDateTimeFormat shows the short form of a part given both ways', () => {
  assertFormatReading('TtTDdw', {
    valid: true,
    format: {
      kind: 'absolute',
      timePrecision: 'short',
      datePrecision: 'short',
      showsDayOfWeek: true,
    },
  });
  assertFormatReading('TT', {
    valid: true,
    format: { kind: 'absolute', timePrecision: 'long', showsDayOfWeek: false },
  });
});

Deno.test('readMarkupDateTimeFormat rejects letters outside the format alphabet', () => {
  for (const format of ['rw', 'wr', 'rr', 'x', 'w ', 'ẁ', 'Ww\u0000']) {
    assertFormatReading(format, { valid: false });
  }
});

function assertFormatReading(format: string, expected: MarkupDateTimeFormatReading): void {
  const reading = readMarkupDateTimeFormat(format);
  if (JSON.stringify(reading) !== JSON.stringify(expected)) {
    throw new Error(
      `Expected ${JSON.stringify(format)} to read as ${JSON.stringify(expected)}, received ${
        JSON.stringify(reading)
      }`,
    );
  }
}
