import {
  type BotActivityPage,
  type BotActivityPageReader,
  type BotActivityPageRequest,
  kindsMatchableBy,
} from './bot_activity_log.ts';
import { HTTP_STATUS_OK } from './constants.ts';
import { botActivityReadResponseSchema } from './schemas.ts';
import type { BotActivityCriteria, BotActivityKind } from './types.ts';
import { requestJson } from './utils.ts';

/**
 * Reads the pages of a session's bot activity log from the emulator, at its `bot-activity` URL. A
 * read fails as `requestJson` fails, including when its signal abandons it.
 */
export function createHttpBotActivityPageReader(
  activityUrl: string,
  fetchImplementation: typeof globalThis.fetch,
): BotActivityPageReader {
  return {
    async readPage(request, signal) {
      const { entries, head_position } = await requestJson(fetchImplementation, {
        method: 'GET',
        url: `${activityUrl}?${toReadQuery(request)}`,
        expectedStatus: HTTP_STATUS_OK,
        responseSchema: botActivityReadResponseSchema,
        signal,
      });
      return { entries, headPosition: head_position } satisfies BotActivityPage;
    },
  };
}

function toReadQuery(
  { after, before, criteria, limit, waitMilliseconds }: BotActivityPageRequest,
): URLSearchParams {
  const query = new URLSearchParams({ after: String(after), limit: String(limit) });
  if (before !== undefined) {
    query.set('before', String(before));
  }
  if (waitMilliseconds !== undefined) {
    query.set('wait_ms', String(waitMilliseconds));
  }
  const { bot_id, method, chat_id, user_id, update_id, ok, parameters } = criteria;
  const queryCriteria = {
    bot_id,
    kind: toReadKind(criteria),
    method,
    chat_id,
    user_id,
    update_id,
    ok,
  };
  for (const [name, value] of Object.entries(queryCriteria)) {
    if (value !== undefined) {
      query.set(name, String(value));
    }
  }
  for (const [name, text] of Object.entries(parameters ?? {})) {
    query.set(`parameters[${name}]`, text);
  }
  return query;
}

/**
 * The kind a read sends: the only kind its criteria can match, if just one. Empty parameter
 * criteria limit a read to calls but put nothing on the wire, which the kind then expresses.
 */
function toReadKind(criteria: BotActivityCriteria): BotActivityKind | undefined {
  const matchableKinds = kindsMatchableBy(criteria);
  return matchableKinds.length === 1 ? matchableKinds[0] : undefined;
}
