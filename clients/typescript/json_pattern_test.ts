/**
 * The client's reading of a parameter pattern: what it refuses and where it reports it, that the
 * text it writes is exactly what it checked whatever hooks the pattern carries, and its cost for
 * deeply nested patterns.
 */
import { checkJsonPattern } from './json_pattern.ts';

/**
 * Far longer than reading the pattern below takes, a few tens of milliseconds, and far shorter
 * than a reading that copies each value's path or holders takes for it, which is minutes.
 */
const LINEAR_CHECK_BUDGET_MILLISECONDS = 2_000;

function withHiddenToJson<Value extends object>(value: Value): Value {
  return Object.defineProperty(value, 'toJSON', {
    value: () => ({ message_id: 999 }),
    enumerable: false,
  });
}

function assertRefused(pattern: unknown, expectedMessage: string): void {
  try {
    checkJsonPattern(pattern, 'The pattern');
  } catch (error) {
    if (error instanceof TypeError && error.message.startsWith(expectedMessage)) {
      return;
    }
    throw error;
  }
  throw new Error(`Expected "${expectedMessage}"`);
}

Deno.test('checkJsonPattern refuses values JSON text cannot hold, naming where they are', () => {
  const cases: ReadonlyArray<readonly [unknown, string]> = [
    [[[{ ok: 1, date: new Date(0) }]], 'The pattern at [0][0].date must hold only JSON values'],
    [{ a: [1, Number.NaN], b: undefined }, 'The pattern at .a[1] must hold only JSON values'],
    [{ id: 1n }, 'The pattern at .id must hold only JSON values'],
    [new Date(0), 'The pattern must be a JSON object or array'],
    ['text', 'The pattern must be a JSON object or array'],
    [{ list: [1, , 3] }, 'The pattern at .list[1] must hold a value'],
  ];
  for (const [pattern, expectedMessage] of cases) {
    assertRefused(pattern, expectedMessage);
  }
});

Deno.test('checkJsonPattern refuses a toJSON hook on the pattern or any object or array in it', () => {
  assertRefused(
    withHiddenToJson({ message_id: 1 }),
    'The pattern must not have a toJSON property',
  );
  assertRefused(
    { reply: withHiddenToJson({ message_id: 1 }) },
    'The pattern at .reply must not have a toJSON property',
  );
  assertRefused(
    { rows: [withHiddenToJson([1])] },
    'The pattern at .rows[0] must not have a toJSON property',
  );
  const inheritedHook = Object.create(withHiddenToJson(Object.create(null)));
  assertRefused({ reply: inheritedHook }, 'The pattern at .reply must hold only JSON values');
  assertRefused({ toJSON: () => ({}) }, 'The pattern must not have a toJSON property');
});

Deno.test('checkJsonPattern refuses members a getter or setter defines', () => {
  let reads = 0;
  const withGetter = Object.defineProperty({}, 'message_id', {
    get: () => ++reads,
    enumerable: true,
  });
  assertRefused({ reply: withGetter }, 'The pattern at .reply.message_id must hold data');
  const elementGetter = Object.defineProperty([0], 0, { get: () => 1, enumerable: true });
  assertRefused(elementGetter, 'The pattern at [0] must hold data');
  if (reads !== 0) {
    throw new Error('Expected no getter to run');
  }
});

Deno.test('checkJsonPattern writes the text of exactly the values it read, even from a proxy', () => {
  let reads = 0;
  // A proxy that answers each read of `message_id` differently.
  const shifting = new Proxy({ message_id: 0 }, {
    getOwnPropertyDescriptor: (target, name) => ({
      ...Reflect.getOwnPropertyDescriptor(target, name),
      value: ++reads,
    }),
    get: () => 1_000,
  });

  const checked = checkJsonPattern({ reply: shifting }, 'The pattern');

  const sentMessageId = JSON.parse(checked.text).reply.message_id;
  const copiedMessageId = (checked.value as { reply: { message_id: number } }).reply.message_id;
  if (sentMessageId !== copiedMessageId || sentMessageId === 1_000 || reads === 0) {
    throw new Error(`Expected the text to hold the value the check read: ${checked.text}`);
  }
  // Reading the copy again runs no trap of the proxy.
  const readsBefore = reads;
  checkJsonPattern(checked.value, 'The copy');
  if (reads !== readsBefore) {
    throw new Error('Expected the copy to be independent of the proxy');
  }
});

Deno.test('checkJsonPattern copies the pattern into frozen objects without prototypes', () => {
  const checked = checkJsonPattern(
    JSON.parse('{"z":[{"b":1,"a":2}],"__proto__":{"x":null}}'),
    'The pattern',
  );

  if (checked.text !== '{"__proto__":{"x":null},"z":[{"a":2,"b":1}]}') {
    throw new Error(`Expected members in the order of their names: ${checked.text}`);
  }
  const copy = checked.value as Record<string, unknown>;
  if (
    !Object.isFrozen(copy) || Object.getPrototypeOf(copy) !== null ||
    !Object.hasOwn(copy, '__proto__') || !Object.isFrozen(copy.z)
  ) {
    throw new Error('Expected a frozen copy whose members are its own');
  }
});

Deno.test('checkJsonPattern refuses a cycle but accepts a value used in several places', () => {
  const shared = { message_id: 1 };
  const checked = checkJsonPattern({ first: shared, second: [shared, shared] }, 'The pattern');
  if (checked.text !== '{"first":{"message_id":1},"second":[{"message_id":1},{"message_id":1}]}') {
    throw new Error(`Expected the shared value written each time: ${checked.text}`);
  }

  const cyclic: { readonly list: unknown[] } = { list: [] };
  cyclic.list.push({ back: cyclic });
  assertRefused(cyclic, 'The pattern at .list[0].back must not contain itself');
});

Deno.test('checkJsonPattern reads a deeply nested pattern in linear time', () => {
  const depth = 100_000;
  const nestedText = `${'[{"a":'.repeat(depth)}1${'}]'.repeat(depth)}`;
  const nested: unknown = JSON.parse(nestedText);

  const startedAt = performance.now();
  const checked = checkJsonPattern(nested, 'The pattern');
  const elapsedMilliseconds = performance.now() - startedAt;

  if (checked.text !== nestedText) {
    throw new Error('Expected the nested pattern to be written as it is');
  }
  if (elapsedMilliseconds > LINEAR_CHECK_BUDGET_MILLISECONDS) {
    throw new Error("Expected the check to take time linear in the pattern's size");
  }
});
