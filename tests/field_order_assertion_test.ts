import { assertEquals, AssertionError, assertStringIncludes, assertThrows } from '@std/assert';
import { assertEqualsInFieldOrder } from './support/field_order_assertion.ts';

Deno.test('assertEqualsInFieldOrder accepts equal values whose fields share their order', () => {
  assertEqualsInFieldOrder(
    { ok: true, result: [{ message_id: 1, chat: { id: 2, type: 'private' } }] },
    { ok: true, result: [{ message_id: 1, chat: { id: 2, type: 'private' } }] },
  );
  assertEqualsInFieldOrder([1, 'two', null], [1, 'two', null]);
});

Deno.test('assertEqualsInFieldOrder refuses equal fields listed in another order, at any depth', () => {
  for (
    const [actual, expected] of [
      [{ error_code: 400, ok: false }, { ok: false, error_code: 400 }],
      [{ result: { chat: { type: 'private', id: 2 } } }, {
        result: { chat: { id: 2, type: 'private' } },
      }],
      [[{ id: 1 }, { type: 'private', id: 2 }], [{ id: 1 }, { id: 2, type: 'private' }]],
    ]
  ) {
    assertEquals(actual, expected, 'Expected assertEquals to accept the reordered fields');
    const error = assertThrows(
      () => assertEqualsInFieldOrder(actual, expected, 'Expected the Bot API order'),
      AssertionError,
    );
    assertStringIncludes(error.message, 'Expected the Bot API order, in the same field order');
  }
});

Deno.test('assertEqualsInFieldOrder refuses unequal values as assertEquals does', () => {
  for (
    const [actual, expected] of [
      [{ ok: true }, { ok: false }],
      [{ ok: true, result: undefined }, { ok: true }],
      [[1, 2], [2, 1]],
    ]
  ) {
    assertThrows(() => assertEqualsInFieldOrder(actual, expected), AssertionError);
  }
});
