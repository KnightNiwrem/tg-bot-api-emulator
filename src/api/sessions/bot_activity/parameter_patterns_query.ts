import {
  isJsonObject,
  type JsonStructure,
  MAX_JSON_NESTING_DEPTH,
  readJsonText,
} from '../../../types/json_pattern.ts';
import type { ControlRequestIssue } from '../../control_error_response.ts';
import type { ControlRequestInputReading } from '../control_request_input.ts';

/**
 * The query parameter holding, as JSON text, the patterns a recorded call's JSON parameters must
 * match, by parameter name: `parameters_json={"reply_parameters":{"message_id":5}}`.
 */
export const PARAMETER_PATTERNS_QUERY_KEY = 'parameters_json';

type JsonPathSegment = string | number;
type JsonPath = readonly JsonPathSegment[];

/**
 * Reads the value of a `parameters_json` query parameter: a JSON object, nested at most
 * `MAX_JSON_NESTING_DEPTH` levels, its own object included, whose members are each a JSON object
 * or array, the pattern for the parameter the member names. Numbers are kept as the exact values
 * their text spells, as recorded parameters are read. A member named twice in any object is
 * reported, as `JSON.parse` would otherwise keep only its last value.
 */
export function readParameterPatterns(
  queryValue: string,
): ControlRequestInputReading<ReadonlyMap<string, JsonStructure>> {
  const reading = readJsonText(queryValue);
  if (!reading.read) {
    return {
      valid: false,
      issues: [
        reading.reason === 'not_json'
          ? {
            source: 'query',
            path: [PARAMETER_PATTERNS_QUERY_KEY],
            code: 'invalid_json',
            message: 'The query parameter is not JSON',
          }
          : {
            source: 'query',
            path: [PARAMETER_PATTERNS_QUERY_KEY],
            code: 'too_big',
            message:
              `The JSON nests objects and arrays more than ${MAX_JSON_NESTING_DEPTH} levels deep`,
          },
      ],
    };
  }
  const patternsByParameterName = reading.value;
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

/**
 * An object or array open at a point of a JSON text, and where the next value in it goes. It
 * records only its own place in the container that holds it, so that opening one costs the same at
 * any depth; a full path is assembled only for a member reported as repeated.
 */
type OpenJsonContainer =
  & {
    /** The container that holds this one; `undefined` for the outermost. */
    readonly holder: OpenJsonContainer | undefined;
    /** This container's member name or index in its holder; `undefined` for the outermost. */
    readonly segment: JsonPathSegment | undefined;
  }
  & (
    | {
      readonly kind: 'object';
      readonly memberNames: Set<string>;
      readonly repeatedMemberNames: Set<string>;
      /** The member whose name has been read and whose value is next; `undefined` before a name. */
      currentMemberName: string | undefined;
    }
    | { readonly kind: 'array'; currentElementIndex: number }
  );

/**
 * The paths of the members that an object in `jsonText`, which must be JSON nested at most
 * `MAX_JSON_NESTING_DEPTH` levels, names more than once, each listed once. The text is scanned
 * rather than parsed, as parsing keeps a single value for each name. The scan takes time and
 * memory in proportion to the text's length, as each reported path is at most the nesting limit
 * long, and it uses no recursion.
 */
function findRepeatedMemberPaths(jsonText: string): JsonPath[] {
  const repeatedMemberPaths: JsonPath[] = [];
  let container: OpenJsonContainer | undefined;
  for (let index = 0; index < jsonText.length; index++) {
    const character = jsonText[index];
    switch (character) {
      case '{':
      case '[': {
        const place = {
          holder: container,
          segment: container?.kind === 'array'
            ? container.currentElementIndex
            : container?.currentMemberName,
        };
        container = character === '{'
          ? {
            ...place,
            kind: 'object',
            memberNames: new Set(),
            repeatedMemberNames: new Set(),
            currentMemberName: undefined,
          }
          : { ...place, kind: 'array', currentElementIndex: 0 };
        break;
      }
      case '}':
      case ']':
        container = container?.holder;
        break;
      case ',':
        if (container?.kind === 'array') {
          container.currentElementIndex++;
        } else if (container?.kind === 'object') {
          container.currentMemberName = undefined;
        }
        break;
      case '"': {
        const closingQuoteIndex = findClosingQuoteIndex(jsonText, index);
        if (container?.kind === 'object' && container.currentMemberName === undefined) {
          const memberName: string = JSON.parse(jsonText.slice(index, closingQuoteIndex + 1));
          container.currentMemberName = memberName;
          if (!container.memberNames.has(memberName)) {
            container.memberNames.add(memberName);
          } else if (!container.repeatedMemberNames.has(memberName)) {
            container.repeatedMemberNames.add(memberName);
            repeatedMemberPaths.push([...pathTo(container), memberName]);
          }
        }
        index = closingQuoteIndex;
        break;
      }
    }
  }
  return repeatedMemberPaths;
}

/** The member names and indexes that lead from the outermost container to `container`. */
function pathTo(container: OpenJsonContainer): JsonPath {
  const segments: JsonPathSegment[] = [];
  for (
    let pathContainer: OpenJsonContainer | undefined = container;
    pathContainer?.segment !== undefined;
    pathContainer = pathContainer.holder
  ) {
    segments.push(pathContainer.segment);
  }
  return segments.reverse();
}

/** The index of the quote that closes the JSON string opening at `openingQuoteIndex`. */
function findClosingQuoteIndex(jsonText: string, openingQuoteIndex: number): number {
  let index = openingQuoteIndex + 1;
  while (jsonText[index] !== '"') {
    index += jsonText[index] === '\\' ? 2 : 1;
  }
  return index;
}
