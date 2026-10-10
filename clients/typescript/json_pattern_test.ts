/**
 * The client's check that a parameter pattern is JSON: where it reports a fault, how it tells a
 * cycle from a value used twice, and its cost for deeply nested patterns.
 */
import { assertJsonStructure } from './json_pattern.ts';

/**
 * Far longer than checking the pattern below takes, a few tens of milliseconds, and far shorter
 * than a check that copies each value's path or holders takes for it, which is minutes.
 */
const LINEAR_CHECK_BUDGET_MILLISECONDS = 2_000;

Deno.test('assertJsonStructure names where in the pattern the first fault is', () => {
  const cases: ReadonlyArray<readonly [unknown, string]> = [
    [[[{ ok: 1, date: new Date(0) }]], 'The pattern at [0][0].date must hold only JSON values'],
    [{ a: [1, Number.NaN], b: undefined }, 'The pattern at .a[1] must hold only JSON values'],
    ['text', 'The pattern must be a JSON object or array'],
  ];
  for (const [pattern, expectedMessage] of cases) {
    try {
      assertJsonStructure(pattern, 'The pattern');
    } catch (error) {
      if (error instanceof TypeError && error.message.startsWith(expectedMessage)) {
        continue;
      }
      throw error;
    }
    throw new Error(`Expected ${expectedMessage}`);
  }
});

Deno.test('assertJsonStructure refuses a cycle but accepts a value used in several places', () => {
  const shared = { message_id: 1 };
  assertJsonStructure({ first: shared, second: [shared, shared] }, 'The pattern');

  const cyclic: { readonly list: unknown[] } = { list: [] };
  cyclic.list.push({ back: cyclic });
  try {
    assertJsonStructure(cyclic, 'The pattern');
  } catch (error) {
    if (
      error instanceof TypeError && error.message === 'The pattern at .list[0].back must not ' +
          'contain itself'
    ) {
      return;
    }
    throw error;
  }
  throw new Error('Expected the cycle to be refused');
});

Deno.test('assertJsonStructure checks a deeply nested pattern in linear time', () => {
  const depth = 100_000;
  const nested: unknown = JSON.parse(`${'[{"a":'.repeat(depth)}1${'}]'.repeat(depth)}`);

  const startedAt = performance.now();
  assertJsonStructure(nested, 'The pattern');
  const elapsedMilliseconds = performance.now() - startedAt;

  if (elapsedMilliseconds > LINEAR_CHECK_BUDGET_MILLISECONDS) {
    throw new Error("Expected the check to take time linear in the pattern's size");
  }
});
