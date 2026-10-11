import { readBotActivityContract } from '../../src/api/contracts/bot_activity.ts';
import type { ControlOperationRequest } from '../../src/api/contracts/operation_contract.ts';
import {
  type BotActivityPage,
  type BotActivityPageReader,
  type BotActivityPageRequest,
  kindsMatchableBy,
} from './bot_activity_log.ts';
import { callJsonOperation, type ControlOperationTransport } from './control_operation_caller.ts';
import { checkJsonPattern } from './json_pattern.ts';
import type { BotActivityCriteria, BotActivityKind, JsonStructure } from './types.ts';

type BotActivityReadQuery = ControlOperationRequest<typeof readBotActivityContract>['query'];

/**
 * Reads the pages of a session's bot activity log from the emulator. A read fails as
 * `requestJson` fails, including when its signal abandons it.
 */
export function createHttpBotActivityPageReader(
  transport: ControlOperationTransport,
  sessionId: string,
): BotActivityPageReader {
  return {
    sessionId,
    async readPage(request, signal) {
      const { entries, head_position } = await callJsonOperation(
        transport,
        readBotActivityContract,
        { params: { sessionId }, query: toReadQuery(request) },
        { signal },
      );
      return { entries, headPosition: head_position } satisfies BotActivityPage;
    },
  };
}

function toReadQuery(
  { after, before, criteria, limit, waitMilliseconds }: BotActivityPageRequest,
): BotActivityReadQuery {
  const { bot_id, method, chat_id, user_id, update_id, ok, parameters, parameters_json } = criteria;
  return {
    after,
    limit,
    before,
    wait_ms: waitMilliseconds,
    bot_id,
    kind: toReadKind(criteria),
    method,
    chat_id,
    user_id,
    update_id,
    ok,
    parameters,
    parameters_json: parameters_json === undefined ? undefined : copyPatterns(parameters_json),
  };
}

/**
 * The kind a read sends: the only kind its criteria can match, if just one. Empty parameter
 * criteria limit a read to calls but put nothing on the wire, which the kind then expresses.
 */
function toReadKind(criteria: BotActivityCriteria): BotActivityKind | undefined {
  const matchableKinds = kindsMatchableBy(criteria);
  return matchableKinds.length === 1 ? matchableKinds[0] : undefined;
}

/**
 * A checked copy of a read's patterns, which the read sends rather than the patterns themselves:
 * the copy has no hook, such as a `toJSON` method or a getter, that could make its JSON text
 * differ from what the check read.
 *
 * @throws {TypeError} when the patterns are not an object of JSON objects or arrays by parameter
 * name, or hold a value that JSON cannot carry unchanged.
 */
function copyPatterns(
  patterns: Readonly<Record<string, JsonStructure>>,
): Readonly<Record<string, JsonStructure>> {
  const { value: copiedPatterns } = checkJsonPattern(patterns, 'parameters_json');
  if (Array.isArray(copiedPatterns)) {
    throw new TypeError('parameters_json must be an object of patterns by parameter name');
  }
  return Object.fromEntries(
    Object.entries(copiedPatterns).map(([name, pattern]) => {
      if (pattern === null || typeof pattern !== 'object') {
        throw new TypeError(
          `The parameters_json pattern for parameter ${name} must be a JSON object or array`,
        );
      }
      return [name, pattern];
    }),
  );
}
