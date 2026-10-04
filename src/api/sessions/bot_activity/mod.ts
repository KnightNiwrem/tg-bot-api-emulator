import { Hono } from 'hono';
import { z } from 'zod';

import type { BotActivityEntry, BotActivityFilter } from '../../../types/bot_activity.ts';
import { BOT_ACTIVITY_KINDS } from '../../../types/bot_activity_kind.ts';
import { toCurrentBotApiMethodName } from '../../../types/bot_api_method_name.ts';
import { integerParameter } from '../bot_api/request_parameters.ts';
import type { SessionRouteContextTypes } from '../session_route_context_types.ts';

/**
 * The wrapper of a query parameter naming, in OpenAPI's `deepObject` style, a parameter that a
 * recorded call must have sent: `parameters[text]=Hello`.
 */
const PARAMETER_FILTER_KEY_PREFIX = 'parameters[';
const PARAMETER_FILTER_KEY_SUFFIX = ']';

const DEFAULT_READ_LIMIT = 100;
const MAX_READ_LIMIT = 1_000;
/** Longer than any sensible test waits, so that a client's wait takes a single request. */
const MAX_WAIT_MILLISECONDS = 600_000;

const readBotActivityQuerySchema = z.strictObject({
  after: integerParameter(z.int().min(0)).default(0),
  before: integerParameter(z.int().min(1)).optional(),
  bot_id: integerParameter(z.int()).optional(),
  kind: z.enum(BOT_ACTIVITY_KINDS).optional(),
  method: z.string().min(1).optional(),
  chat_id: integerParameter(z.int()).optional(),
  user_id: integerParameter(z.int()).optional(),
  update_id: integerParameter(z.int()).optional(),
  ok: z.enum(['true', 'false']).transform((text) => text === 'true').optional(),
  limit: integerParameter(z.int().min(0).max(MAX_READ_LIMIT)).default(DEFAULT_READ_LIMIT),
  wait_ms: integerParameter(z.int().min(0).max(MAX_WAIT_MILLISECONDS)).default(0),
}).refine(({ after, before }) => before === undefined || before > after)
  .refine(({ before, wait_ms }) => before === undefined || wait_ms === 0);

type ReadBotActivityQuery = z.output<typeof readBotActivityQuerySchema> & {
  readonly parameters: Readonly<Record<string, string>>;
};

export function createBotActivityRoutes(): Hono<SessionRouteContextTypes> {
  const botActivityRoutes = new Hono<SessionRouteContextTypes>();

  botActivityRoutes.get('/', async (context) => {
    const query = readBotActivityQuery(new URL(context.req.url).searchParams);
    if (query === undefined) {
      return context.body(null, 400);
    }

    const result = await context.get('emulationSession').botActivity.readEntries({
      after: query.after,
      before: query.before,
      filter: toBotActivityFilter(query),
      limit: query.limit,
      waitMilliseconds: query.wait_ms,
      signal: context.req.raw.signal,
    });
    if (!result.read) {
      return context.body(null, 400);
    }
    return context.json({
      entries: result.entries.map(presentBotActivityEntry),
      head_position: result.headPosition,
    });
  });

  return botActivityRoutes;
}

/**
 * Reads the query of a bot activity read; `undefined` for an unknown or repeated parameter, or a
 * value the schema rejects.
 */
function readBotActivityQuery(searchParams: URLSearchParams): ReadBotActivityQuery | undefined {
  const queryValues: Record<string, string> = {};
  const parameters: Record<string, string> = {};
  for (const [name, value] of searchParams) {
    const parameterName = readParameterFilterName(name);
    const values = parameterName === undefined ? queryValues : parameters;
    const key = parameterName ?? name;
    if (Object.hasOwn(values, key)) {
      return undefined;
    }
    values[key] = value;
  }
  const parsedQuery = readBotActivityQuerySchema.safeParse(queryValues);
  return parsedQuery.success ? { ...parsedQuery.data, parameters } : undefined;
}

/**
 * The parameter name a `parameters[name]` query key filters by; `undefined` for any other key,
 * including one that names no parameter. A name may hold any character, line breaks included.
 */
function readParameterFilterName(queryKey: string): string | undefined {
  if (
    !queryKey.startsWith(PARAMETER_FILTER_KEY_PREFIX) ||
    !queryKey.endsWith(PARAMETER_FILTER_KEY_SUFFIX)
  ) {
    return undefined;
  }
  const parameterName = queryKey.slice(
    PARAMETER_FILTER_KEY_PREFIX.length,
    -PARAMETER_FILTER_KEY_SUFFIX.length,
  );
  return parameterName === '' ? undefined : parameterName;
}

function toBotActivityFilter(query: ReadBotActivityQuery): BotActivityFilter {
  return {
    ...(query.bot_id === undefined ? {} : { botId: query.bot_id }),
    ...(query.kind === undefined ? {} : { kind: query.kind }),
    // A method is recorded by its current name, so an older name finds its calls too.
    ...(query.method === undefined ? {} : { method: toCurrentBotApiMethodName(query.method) }),
    ...(query.chat_id === undefined ? {} : { chatId: query.chat_id }),
    ...(query.user_id === undefined ? {} : { userId: query.user_id }),
    ...(query.update_id === undefined ? {} : { updateId: query.update_id }),
    ...(query.ok === undefined ? {} : { ok: query.ok }),
    ...(Object.keys(query.parameters).length === 0 ? {} : { parameters: query.parameters }),
  };
}

function presentBotActivityEntry(entry: BotActivityEntry) {
  const chatIdField = entry.chatId === undefined ? {} : { chat_id: entry.chatId };
  switch (entry.kind) {
    case 'bot_api_call':
      return {
        position: entry.position,
        kind: entry.kind,
        bot_id: entry.botId,
        method: entry.method,
        requested_method: entry.requestedMethod,
        via: entry.via,
        parameters: entry.parameters,
        uploaded_files: entry.uploadedFiles.map(({ fieldName, fileName, sizeBytes }) => ({
          field_name: fieldName,
          file_name: fileName,
          size_bytes: sizeBytes,
        })),
        ...chatIdField,
        answer: entry.answer,
      };
    case 'update_delivered':
      return {
        position: entry.position,
        kind: entry.kind,
        bot_id: entry.botId,
        via: entry.via,
        update: entry.update,
        ...chatIdField,
        ...(entry.userId === undefined ? {} : { user_id: entry.userId }),
      };
    case 'update_confirmed':
      return {
        position: entry.position,
        kind: entry.kind,
        bot_id: entry.botId,
        via: entry.via,
        update_id: entry.updateId,
        ...chatIdField,
        ...(entry.userId === undefined ? {} : { user_id: entry.userId }),
      };
    default: {
      const unhandledEntry: never = entry;
      throw new Error(`Unhandled bot activity entry: ${JSON.stringify(unhandledEntry)}`);
    }
  }
}
