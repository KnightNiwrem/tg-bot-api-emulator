/**
 * The reading of a JSON query parameter's text, such as `parameters_json`'s: its nesting limit, and
 * the cost of scanning it, which must stay in proportion to the text's length however the value
 * nests or repeats members.
 */
import { assertEquals } from '@std/assert';

import { readJsonQueryParameter } from '../src/api/json_query_parameter.ts';
import { MAX_JSON_NESTING_DEPTH } from '../src/types/json_pattern.ts';

/**
 * Far longer than reading the values below takes, a few tens of milliseconds, and far shorter than
 * a scan that copies each container's path takes for them, which is minutes.
 */
const LINEAR_SCAN_BUDGET_MILLISECONDS = 2_000;

/** A `parameters_json` value whose one pattern nests arrays so that the whole is `depth` deep. */
function nestedArrayPatterns(depth: number): string {
  const patternDepth = depth - 1;
  return `{"p":${'['.repeat(patternDepth)}${']'.repeat(patternDepth)}}`;
}

Deno.test('parameters_json may nest objects and arrays up to the limit', () => {
  const atLimit = readParameterPatterns(nestedArrayPatterns(MAX_JSON_NESTING_DEPTH));
  if (atLimit.value === undefined || atLimit.issues.length > 0) {
    throw new Error(`Expected a value at the limit to be read: ${JSON.stringify(atLimit.issues)}`);
  }

  const beyondLimit = readParameterPatterns(
    nestedArrayPatterns(MAX_JSON_NESTING_DEPTH + 1),
  );
  assertEquals(
    beyondLimit.issues.map(({ source, path, code }) => ({ source, path, code })),
    [{ source: 'query', path: ['parameters_json'], code: 'too_big' }],
    'Expected one too_big issue beyond the limit',
  );
});

Deno.test('A parameters_json nested far beyond the limit is refused in linear time', () => {
  const deeplyNested = nestedArrayPatterns(500_000);

  const startedAt = performance.now();
  const reading = readParameterPatterns(deeplyNested);
  const elapsedMilliseconds = performance.now() - startedAt;

  if (
    reading.value !== undefined || reading.issues.length !== 1 ||
    reading.issues[0].code !== 'too_big'
  ) {
    throw new Error('Expected the nesting to be refused as too deep');
  }
  if (elapsedMilliseconds > LINEAR_SCAN_BUDGET_MILLISECONDS) {
    throw new Error("Expected the scan to take time linear in the value's length");
  }
});

Deno.test('Members repeated at the deepest level are each reported once, at their path', () => {
  const holderDepth = MAX_JSON_NESTING_DEPTH - 1;
  const repeatCount = 20_000;
  const members = Array.from(
    { length: repeatCount },
    (_, index) => `"m${index}":1,"m${index}":2,"m${index}":3`,
  );
  const value = `${'{"a":'.repeat(holderDepth)}{${members.join(',')}}${'}'.repeat(holderDepth)}`;

  const startedAt = performance.now();
  const reading = readParameterPatterns(value);
  const elapsedMilliseconds = performance.now() - startedAt;

  const { issues } = reading;
  const expectedPathLength = 1 + holderDepth + 1;
  if (
    issues.length !== repeatCount ||
    issues.some(({ code, path }) =>
      code !== 'duplicate_field' || path.length !== expectedPathLength
    )
  ) {
    throw new Error('Expected one duplicate_field issue per repeated name, at its full path');
  }
  const lastPath = issues[repeatCount - 1].path;
  if (lastPath[0] !== 'parameters_json' || lastPath.at(-1) !== `m${repeatCount - 1}`) {
    throw new Error(`Expected the path to lead to the repeated member: ${lastPath.join('.')}`);
  }
  if (elapsedMilliseconds > LINEAR_SCAN_BUDGET_MILLISECONDS) {
    throw new Error("Expected the scan to take time linear in the value's length");
  }
});

function readParameterPatterns(text: string) {
  return readJsonQueryParameter('parameters_json', text);
}
