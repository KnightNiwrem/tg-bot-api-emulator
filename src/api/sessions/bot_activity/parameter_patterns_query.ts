import { isJsonObject, type JsonStructure, type JsonValue } from '../../../types/json_pattern.ts';
import type { ControlRequestIssue } from '../../control_error_response.ts';
import type { ControlRequestInputReading } from '../control_request_input.ts';

/**
 * The query parameter holding, as JSON text, the patterns a recorded call's JSON parameters must
 * match, by parameter name: `parameters_json={"reply_parameters":{"message_id":5}}`.
 */
export const PARAMETER_PATTERNS_QUERY_KEY = 'parameters_json';

type JsonPath = readonly (string | number)[];

/**
 * Reads the value of a `parameters_json` query parameter: a JSON object whose members are each a
 * JSON object or array, the pattern for the parameter the member names. A member named twice in
 * any object is reported, as `JSON.parse` would otherwise keep only its last value.
 */
export function readParameterPatterns(
  queryValue: string,
): ControlRequestInputReading<ReadonlyMap<string, JsonStructure>> {
  let patternsByParameterName: JsonValue;
  try {
    patternsByParameterName = JSON.parse(queryValue);
  } catch {
    return {
      valid: false,
      issues: [{
        source: 'query',
        path: [PARAMETER_PATTERNS_QUERY_KEY],
        code: 'invalid_json',
        message: 'The query parameter is not JSON',
      }],
    };
  }
  const issues: ControlRequestIssue[] = findRepeatedMemberPaths(queryValue).map((path) => ({
    source: 'query',
    path: [PARAMETER_PATTERNS_QUERY_KEY, ...path],
    code: 'duplicate_field',
    message: 'The JSON object names this member more than once',
  }));
  if (!isJsonObject(patternsByParameterName)) {
    issues.push({
      source: 'query',
      path: [PARAMETER_PATTERNS_QUERY_KEY],
      code: 'invalid_type',
      message: 'Expected a JSON object of patterns by parameter name',
    });
    return { valid: false, issues };
  }
  // Parameter names are the client's, so they are kept in a map, where no name such as
  // `__proto__` has a special meaning.
  const patterns = new Map<string, JsonStructure>();
  for (const [parameterName, pattern] of Object.entries(patternsByParameterName)) {
    if (isJsonObject(pattern) || Array.isArray(pattern)) {
      patterns.set(parameterName, pattern);
    } else {
      issues.push({
        source: 'query',
        path: [PARAMETER_PATTERNS_QUERY_KEY, parameterName],
        code: 'invalid_type',
        message: 'Expected a JSON object or array; parameters[name] matches other parameter text',
      });
    }
  }
  return issues.length === 0 ? { valid: true, value: patterns } : { valid: false, issues };
}

/** An object or array open at a point of a JSON text, and where the next value in it goes. */
type OpenJsonContainer =
  | {
    readonly kind: 'object';
    readonly path: JsonPath;
    readonly memberNames: Set<string>;
    readonly repeatedMemberNames: Set<string>;
    /** The member whose name has been read and whose value is next; `undefined` before a name. */
    currentMemberPath: JsonPath | undefined;
  }
  | { readonly kind: 'array'; readonly path: JsonPath; currentElementIndex: number };

/**
 * The paths of the members that an object in `jsonText`, which must be valid JSON, names more than
 * once, each listed once. The text is scanned rather than parsed, as parsing keeps a single value
 * for each name. It is scanned without recursion, so no nesting depth can overflow the call stack.
 */
function findRepeatedMemberPaths(jsonText: string): JsonPath[] {
  const repeatedMemberPaths: JsonPath[] = [];
  const openContainers: OpenJsonContainer[] = [];
  const nextValuePath = (): JsonPath => {
    const container = openContainers.at(-1);
    if (container === undefined) {
      return [];
    }
    return container.kind === 'array'
      ? [...container.path, container.currentElementIndex]
      : container.currentMemberPath ?? container.path;
  };
  for (let index = 0; index < jsonText.length; index++) {
    const container = openContainers.at(-1);
    switch (jsonText[index]) {
      case '{':
        openContainers.push({
          kind: 'object',
          path: nextValuePath(),
          memberNames: new Set(),
          repeatedMemberNames: new Set(),
          currentMemberPath: undefined,
        });
        break;
      case '[':
        openContainers.push({ kind: 'array', path: nextValuePath(), currentElementIndex: 0 });
        break;
      case '}':
      case ']':
        openContainers.pop();
        break;
      case ',':
        if (container?.kind === 'array') {
          container.currentElementIndex++;
        } else if (container?.kind === 'object') {
          container.currentMemberPath = undefined;
        }
        break;
      case '"': {
        const closingQuoteIndex = findClosingQuoteIndex(jsonText, index);
        if (container?.kind === 'object' && container.currentMemberPath === undefined) {
          const memberName: string = JSON.parse(jsonText.slice(index, closingQuoteIndex + 1));
          container.currentMemberPath = [...container.path, memberName];
          if (!container.memberNames.has(memberName)) {
            container.memberNames.add(memberName);
          } else if (!container.repeatedMemberNames.has(memberName)) {
            container.repeatedMemberNames.add(memberName);
            repeatedMemberPaths.push(container.currentMemberPath);
          }
        }
        index = closingQuoteIndex;
        break;
      }
    }
  }
  return repeatedMemberPaths;
}

/** The index of the quote that closes the JSON string opening at `openingQuoteIndex`. */
function findClosingQuoteIndex(jsonText: string, openingQuoteIndex: number): number {
  let index = openingQuoteIndex + 1;
  while (jsonText[index] !== '"') {
    index += jsonText[index] === '\\' ? 2 : 1;
  }
  return index;
}
