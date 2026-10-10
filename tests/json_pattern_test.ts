/**
 * The structural matching of JSON values against patterns that bot activity's `parameters_json`
 * filter uses: each rule for primitives, numbers, `null`, missing members and arrays, written out
 * by hand as JSON text.
 */
import {
  type JsonValue,
  matchesJsonPattern,
  MAX_JSON_NESTING_DEPTH,
  readJsonText,
} from '../src/types/json_pattern.ts';

function parse(text: string): JsonValue {
  const reading = readJsonText(text);
  if (!reading.read) {
    throw new Error(`Expected JSON within the nesting limit: ${text}`);
  }
  return reading.value;
}

const RECORDED_TEXT = JSON.stringify({
  number: 1,
  text: '1',
  flag: true,
  nothing: null,
  list: [1, [2, 3], { name: 'g', count: 0 }],
  nested: { inner: { leaf: 'l' } },
});

const CASES: ReadonlyArray<readonly [string, string, boolean]> = [
  ['a number matches the same number', '{"number":1}', true],
  ['a number does not match its text', '{"number":"1"}', false],
  ['text does not match the number it spells', '{"text":1}', false],
  ['text matches the same text', '{"text":"1"}', true],
  ['true matches true', '{"flag":true}', true],
  ['true does not match its text', '{"flag":"true"}', false],
  ['true does not match 1', '{"flag":1}', false],
  ['null matches null', '{"nothing":null}', true],
  ['null does not match a missing member', '{"absent":null}', false],
  ['null does not match a number', '{"number":null}', false],
  ['a member the value lacks does not match', '{"absent":1}', false],
  ['an empty object matches any object', '{}', true],
  ['an object ignores members it does not name', '{"nested":{"inner":{}}}', true],
  ['an object compares nested members', '{"nested":{"inner":{"leaf":"m"}}}', false],
  ['an object does not match an array', '{"list":{}}', false],
  ['an array does not match an object', '{"nested":[]}', false],
  ['a number does not match an object', '{"nested":1}', false],
  ['an object does not match a number', '{"number":{}}', false],
  ['an array matches elementwise', '{"list":[1,[2,3],{}]}', true],
  ['objects in an array may have more members', '{"list":[1,[2,3],{"name":"g"}]}', true],
  ['member order does not matter', '{"list":[1,[2,3],{"count":0,"name":"g"}]}', true],
  ['an array must have the same length', '{"list":[1,[2,3]]}', false],
  ['an array is not matched by a longer one', '{"list":[1,[2,3],{},4]}', false],
  ['an array matches in order', '{"list":[[2,3],1,{}]}', false],
  ['a nested array matches in order', '{"list":[1,[3,2],{}]}', false],
  ['a nested array must have the same length', '{"list":[1,[2],{}]}', false],
];

for (const [rule, pattern, expected] of CASES) {
  Deno.test(`matchesJsonPattern: ${rule}`, () => {
    if (matchesJsonPattern(parse(RECORDED_TEXT), parse(pattern)) !== expected) {
      throw new Error(`Expected ${pattern} ${expected ? '' : 'not '}to match`);
    }
  });
}

Deno.test('matchesJsonPattern compares numbers by the exact decimal value their text spells', () => {
  const cases: ReadonlyArray<readonly [string, string, boolean]> = [
    ['1', '1.0', true],
    ['100', '1e2', true],
    ['100', '1E+2', true],
    ['0.015', '15e-3', true],
    ['-1.50', '-15e-1', true],
    ['0', '-0', true],
    ['0.0e7', '-0', true],
    ['1', '-1', false],
    ['1e500', '1e400', false],
    ['1e400', '1e400', true],
    ['-1e500', '-1e400', false],
    ['-1e400', '1e400', false],
    ['-1e400', '-1e400', true],
    ['9007199254740993', '9007199254740992', false],
    ['9007199254740993', '9007199254740993', true],
    ['0.30000000000000001', '0.3', false],
    ['1e-400', '0', false],
    [`1${'0'.repeat(400)}`, '1e400', true],
  ];
  for (const [recorded, pattern, expected] of cases) {
    if (matchesJsonPattern(parse(`[${recorded}]`), parse(`[${pattern}]`)) !== expected) {
      throw new Error(`Expected ${pattern} ${expected ? '' : 'not '}to match ${recorded}`);
    }
  }
});

Deno.test('matchesJsonPattern compares top-level values by the same rules', () => {
  const cases: ReadonlyArray<readonly [string, string, boolean]> = [
    ['[]', '[]', true],
    ['[1]', '[]', false],
    ['null', '{}', false],
    ['{}', 'null', false],
    ['""', '""', true],
  ];
  for (const [value, pattern, expected] of cases) {
    if (matchesJsonPattern(parse(value), parse(pattern)) !== expected) {
      throw new Error(`Expected ${pattern} ${expected ? '' : 'not '}to match ${value}`);
    }
  }
});

Deno.test('readJsonText reads members of any name as own members and refuses other text', () => {
  const value = parse('{"__proto__":{"x":1}}');
  if (!matchesJsonPattern(value, parse('{"__proto__":{"x":1}}'))) {
    throw new Error('Expected a member named __proto__ to be matched as a member');
  }
  if (
    matchesJsonPattern(parse('{}'), parse('{"constructor":{}}')) ||
    matchesJsonPattern(parse('{}'), parse('{"toString":{}}'))
  ) {
    throw new Error('Expected inherited properties not to count as members');
  }
  for (const text of ['', '{', 'NaN', 'Infinity', "{'a':1}", '01', '1.', '.5', '+1']) {
    const reading = readJsonText(text);
    if (reading.read || reading.reason !== 'not_json') {
      throw new Error(`Expected ${JSON.stringify(text)} not to be read as JSON`);
    }
  }
});

Deno.test('readJsonText refuses JSON nested beyond the limit, however deep', () => {
  const nestedArrays = (depth: number) => `${'['.repeat(depth)}${']'.repeat(depth)}`;
  if (!readJsonText(nestedArrays(MAX_JSON_NESTING_DEPTH)).read) {
    throw new Error('Expected JSON at the limit to be read');
  }
  // Brackets in strings, even after an escaped quote, are text, not nesting.
  if (!readJsonText(`["\\"${'['.repeat(1_000)}"]`).read) {
    throw new Error('Expected brackets in a string not to count');
  }
  for (const depth of [MAX_JSON_NESTING_DEPTH + 1, 500_000]) {
    const reading = readJsonText(nestedArrays(depth));
    if (reading.read || reading.reason !== 'too_deep') {
      throw new Error(`Expected JSON nested ${depth} levels to be refused as too deep`);
    }
  }
});

Deno.test('matchesJsonPattern compares values nested deeper than the call stack', () => {
  const depth = 100_000;
  // Read without the nesting limit, which only `readJsonText` applies.
  const nested: JsonValue = JSON.parse(`${'['.repeat(depth)}${']'.repeat(depth)}`);
  if (!matchesJsonPattern(nested, nested)) {
    throw new Error('Expected a deeply nested value to match itself');
  }
});

Deno.test('readJsonText reads numbers with long digit runs in linear time', () => {
  // A trailing-zero pattern such as /0+$/ would backtrack over this run of zeros.
  const longNumber = `1${'0'.repeat(200_000)}1`;
  const startedAt = performance.now();
  const value = parse(`[${longNumber}]`);
  const elapsedMilliseconds = performance.now() - startedAt;
  if (!matchesJsonPattern(value, parse(`[${longNumber}e0]`))) {
    throw new Error('Expected the long number to match itself');
  }
  if (elapsedMilliseconds > 2_000) {
    throw new Error("Expected reading to take time linear in the number's length");
  }
});
