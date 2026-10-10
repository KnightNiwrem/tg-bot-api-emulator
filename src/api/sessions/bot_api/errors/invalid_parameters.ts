import type { z } from 'zod';

import type { BotApiMethodAnswer } from '../method_call.ts';
import { BOT_API_ERRORS } from './error_catalogue.ts';
import { presentBotApiError } from './error_template.ts';

/** A parameter name or nested key that reads unambiguously after a `.` in a path. */
const PLAIN_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * The emulator's description of parameters that do not fit a method's schema, without the path of
 * the offending parameter, for a reader that rejects a parameter's value outside the schema.
 */
export function describeInvalidMethodParameters(methodName: string): string {
  return BOT_API_ERRORS.invalidMethodParameters.description({ methodName });
}

/**
 * The emulator's answer to parameters that do not fit a method's schema, naming the path of the
 * first problem the schema reports, such as `reply_markup.inline_keyboard[0][1]`. An unknown key
 * is named by its own path, and a value no alternative of a union accepts by the union's path. The
 * path never includes a parameter's value, so the description does not echo the bot's data.
 */
export function invalidMethodParametersAnswer(
  methodName: string,
  error: z.ZodError,
): BotApiMethodAnswer {
  return presentBotApiError(BOT_API_ERRORS.invalidMethodParameters, {
    methodName,
    parameterPath: describeFirstIssuePath(error),
  });
}

/** The path of the first issue the schema reports, or `undefined` for one at the top level. */
function describeFirstIssuePath(error: z.ZodError): string | undefined {
  const [issue] = error.issues;
  if (issue === undefined) {
    return undefined;
  }
  const path = issue.code === 'unrecognized_keys' && issue.keys[0] !== undefined
    ? [...issue.path, issue.keys[0]]
    : issue.path;
  return path.length === 0 ? undefined : formatParameterPath(path);
}

/**
 * Writes a path as a reader of the method's documentation would: `.` before a name, `[n]` for an
 * array position, and a JSON string in brackets for a key that is not a plain name.
 */
function formatParameterPath(path: readonly PropertyKey[]): string {
  return path.map((segment, index) => {
    if (typeof segment === 'number') {
      return `[${segment}]`;
    }
    const key = String(segment);
    if (!PLAIN_KEY_PATTERN.test(key)) {
      return `[${JSON.stringify(key)}]`;
    }
    return index === 0 ? key : `.${key}`;
  }).join('');
}
