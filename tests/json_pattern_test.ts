/**
 * The structural matching of JSON values against patterns that bot activity's `parameters_json`
 * filter uses: each rule for primitives, `null`, missing members and arrays, written out by hand.
 */
import { type JsonValue, matchesJsonPattern } from '../src/types/json_pattern.ts';

const RECORDED_VALUE: JsonValue = {
  number: 1,
  text: '1',
  flag: true,
  nothing: null,
  list: [1, [2, 3], { name: 'g', count: 0 }],
  nested: { inner: { leaf: 'l' } },
};

const CASES: ReadonlyArray<readonly [string, JsonValue, boolean]> = [
  ['a number matches the same number', { number: 1 }, true],
  ['a number does not match its text', { number: '1' }, false],
  ['text does not match the number it spells', { text: 1 }, false],
  ['text matches the same text', { text: '1' }, true],
  ['true matches true', { flag: true }, true],
  ['true does not match its text', { flag: 'true' }, false],
  ['true does not match 1', { flag: 1 }, false],
  ['null matches null', { nothing: null }, true],
  ['null does not match a missing member', { absent: null }, false],
  ['null does not match a number', { number: null }, false],
  ['a member the value lacks does not match', { absent: 1 }, false],
  ['an empty object matches any object', {}, true],
  ['an object ignores members it does not name', { nested: { inner: {} } }, true],
  ['an object compares nested members', { nested: { inner: { leaf: 'm' } } }, false],
  ['an object does not match an array', { list: {} }, false],
  ['an array does not match an object', { nested: [] }, false],
  ['an array matches elementwise', { list: [1, [2, 3], {}] }, true],
  ['objects in an array may have more members', { list: [1, [2, 3], { name: 'g' }] }, true],
  ['member order does not matter', { list: [1, [2, 3], { count: 0, name: 'g' }] }, true],
  ['an array must have the same length', { list: [1, [2, 3]] }, false],
  ['an array is not matched by a longer one', { list: [1, [2, 3], {}, 4] }, false],
  ['an array matches in order', { list: [[2, 3], 1, {}] }, false],
  ['a nested array matches in order', { list: [1, [3, 2], {}] }, false],
  ['a nested array must have the same length', { list: [1, [2], {}] }, false],
];

for (const [rule, pattern, expected] of CASES) {
  Deno.test(`matchesJsonPattern: ${rule}`, () => {
    if (matchesJsonPattern(RECORDED_VALUE, pattern) !== expected) {
      throw new Error(`Expected ${JSON.stringify(pattern)} to ${expected ? '' : 'not '}match`);
    }
  });
}

Deno.test('matchesJsonPattern compares top-level values by the same rules', () => {
  const cases: ReadonlyArray<readonly [JsonValue, JsonValue, boolean]> = [
    [[], [], true],
    [[1], [], false],
    [null, {}, false],
    [{}, null, false],
    [0, -0, true],
    ['', '', true],
  ];
  for (const [value, pattern, expected] of cases) {
    if (matchesJsonPattern(value, pattern) !== expected) {
      throw new Error(
        `Expected ${JSON.stringify(pattern)} ${expected ? '' : 'not '}to match ${
          JSON.stringify(value)
        }`,
      );
    }
  }
});

Deno.test('matchesJsonPattern finds members only as own members, whatever their names', () => {
  const value: JsonValue = JSON.parse('{"__proto__":{"x":1}}');
  if (!matchesJsonPattern(value, JSON.parse('{"__proto__":{"x":1}}'))) {
    throw new Error('Expected a member named __proto__ to be matched as a member');
  }
  if (matchesJsonPattern({}, { constructor: {} }) || matchesJsonPattern({}, { toString: {} })) {
    throw new Error('Expected inherited properties not to count as members');
  }
});

Deno.test('matchesJsonPattern compares patterns nested deeper than the call stack', () => {
  const depth = 100_000;
  const nested: JsonValue = JSON.parse(`${'['.repeat(depth)}${']'.repeat(depth)}`);
  if (!matchesJsonPattern(nested, nested)) {
    throw new Error('Expected a deeply nested value to match itself');
  }
});
