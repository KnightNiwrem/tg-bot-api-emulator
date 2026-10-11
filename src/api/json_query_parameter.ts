/**
 * Reads a control query parameter that holds JSON text, such as bot activity's `parameters_json`,
 * reporting the problems with its text that its schema cannot see.
 */
import { type JsonValue, MAX_JSON_NESTING_DEPTH, readJsonText } from '../types/json_pattern.ts';
import type { ControlRequestIssue } from './control_error_response.ts';

type JsonPathSegment = string | number;
type JsonPath = readonly JsonPathSegment[];

/**
 * A JSON query parameter's value, read twice: as the emulator's JSON values, whose numbers keep
 * the exact decimal values their text spells, and as `JSON.parse` reads it, which a schema checks.
 */
export interface JsonQueryParameterValue {
  readonly exactValue: JsonValue;
  readonly parsedValue: unknown;
}

/**
 * What reading a JSON query parameter found: its value, when its text is JSON within the nesting
 * limit, and its issues. A member that an object names more than once is an issue that leaves the
 * value readable, so that its schema can still report the value's other issues.
 */
export interface JsonQueryParameterReading {
  readonly value: JsonQueryParameterValue | undefined;
  readonly issues: readonly ControlRequestIssue[];
}

/**
 * Reads the text of the query parameter `name`, which must be JSON nested at most
 * `MAX_JSON_NESTING_DEPTH` levels, its own object or array included. A member named twice in any
 * object is reported at its path, which continues from `name` into the JSON, as `JSON.parse` would
 * otherwise keep only its last value.
 */
export function readJsonQueryParameter(name: string, text: string): JsonQueryParameterReading {
  const reading = readJsonText(text);
  if (!reading.read) {
    return {
      value: undefined,
      issues: [
        reading.reason === 'not_json'
          ? {
            source: 'query',
            path: [name],
            code: 'invalid_json',
            message: 'The query parameter is not JSON',
          }
          : {
            source: 'query',
            path: [name],
            code: 'too_big',
            message:
              `The JSON nests objects and arrays more than ${MAX_JSON_NESTING_DEPTH} levels deep`,
          },
      ],
    };
  }
  return {
    // `readJsonText` read the text, so `JSON.parse` reads it too.
    value: { exactValue: reading.value, parsedValue: JSON.parse(text) },
    issues: findRepeatedMemberPaths(text).map((path) => ({
      source: 'query',
      path: [name, ...path],
      code: 'duplicate_field',
      message: 'The JSON object names this member more than once',
    })),
  };
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
