import { BOT_ACTIVITY_KINDS } from '../../src/types/bot_activity_kind.ts';
import { toCurrentBotApiMethodName } from '../../src/types/bot_api_method_name.ts';
import { HTTP_STATUS_OK } from './constants.ts';
import { botActivityReadResponseSchema } from './schemas.ts';
import type {
  BotActivityCriteria,
  BotActivityCursor,
  BotActivityEntry,
  BotActivityEntryMatching,
  BotActivityFilter,
  BotActivityFilterFor,
  BotActivityKind,
  BotActivityLog,
  BotActivityLogOptions,
  BotActivityPosition,
  BotActivityRange,
  WaitForBotActivityOptions,
} from './types.ts';
import { requestJson } from './utils.ts';

const DEFAULT_TIMEOUT_MILLISECONDS = 5_000;
/** The most entries the server answers a read with. */
const READ_LIMIT = 1_000;

/** Returns the latest of the positions, such as the later of two entries. */
export function latest(
  firstPosition: BotActivityPosition,
  ...otherPositions: readonly BotActivityPosition[]
): number {
  return Math.max(...[firstPosition, ...otherPositions].map(toPositionNumber));
}

/** No entry matching a filter was recorded after a position before the wait ended. */
export class BotActivityTimeoutError extends Error {
  override readonly name = 'BotActivityTimeoutError';
  readonly filter: BotActivityFilter;
  readonly after: number;
  readonly timeoutMs: number;

  constructor(filter: BotActivityFilter, after: number, timeoutMs: number) {
    super(
      `No bot activity matching ${describeFilter(filter)} was recorded after position ${after} ` +
        `within ${timeoutMs} ms`,
    );
    this.filter = filter;
    this.after = after;
    this.timeoutMs = timeoutMs;
  }
}

/** Entries matching a filter were recorded in a range that should hold none. */
export class UnexpectedBotActivityError extends Error {
  override readonly name = 'UnexpectedBotActivityError';
  readonly filter: BotActivityFilter;
  readonly after: number;
  readonly before: number;
  readonly entries: readonly BotActivityEntry[];

  constructor(
    filter: BotActivityFilter,
    after: number,
    before: number,
    entries: readonly BotActivityEntry[],
  ) {
    super(
      `Expected no bot activity matching ${describeFilter(filter)} after position ${after} ` +
        `and before position ${before}, found ${entries.length} entries: ${
          JSON.stringify(entries)
        }`,
    );
    this.filter = filter;
    this.after = after;
    this.before = before;
    this.entries = entries;
  }
}

export function createBotActivityLog<Criteria extends BotActivityCriteria>(
  activityUrl: string,
  fetchImplementation: typeof globalThis.fetch,
  baseFilter: BotActivityFilterFor<Criteria> | undefined,
  { timeoutMs = DEFAULT_TIMEOUT_MILLISECONDS }: BotActivityLogOptions,
): BotActivityLog {
  validateTimeout(timeoutMs);
  return new HttpBotActivityLog(
    activityUrl,
    fetchImplementation,
    baseFilter === undefined ? {} : acceptingAnyEntry(baseFilter),
    timeoutMs,
  );
}

interface BotActivityRead {
  readonly after: number;
  readonly before?: number;
  readonly filter: BotActivityFilter;
  readonly limit: number;
  readonly waitMilliseconds?: number;
}

class HttpBotActivityLog implements BotActivityLog {
  readonly #activityUrl: string;
  readonly #fetch: typeof globalThis.fetch;
  readonly #baseFilter: BotActivityFilter;
  readonly #defaultTimeoutMilliseconds: number;

  constructor(
    activityUrl: string,
    fetchImplementation: typeof globalThis.fetch,
    baseFilter: BotActivityFilter,
    defaultTimeoutMilliseconds: number,
  ) {
    this.#activityUrl = activityUrl;
    this.#fetch = fetchImplementation;
    this.#baseFilter = baseFilter;
    this.#defaultTimeoutMilliseconds = defaultTimeoutMilliseconds;
  }

  async position(): Promise<number> {
    const { head_position } = await this.#read({ after: 0, filter: {}, limit: 0 });
    return head_position;
  }

  async waitFor<const Criteria extends BotActivityCriteria>(
    filter: BotActivityFilterFor<Criteria>,
    { after, timeoutMs = this.#defaultTimeoutMilliseconds }: WaitForBotActivityOptions,
  ): Promise<BotActivityEntryMatching<Criteria>> {
    validateTimeout(timeoutMs);
    const combinedFilter = combineFilters(this.#baseFilter, acceptingAnyEntry(filter));
    const afterPosition = toPositionNumber(after);
    const deadline = performance.now() + timeoutMs;
    let unreadAfter = afterPosition;
    for (;;) {
      const remainingMilliseconds = Math.max(0, Math.ceil(deadline - performance.now()));
      const { entries, head_position } = await this.#read({
        after: unreadAfter,
        filter: combinedFilter,
        limit: READ_LIMIT,
        waitMilliseconds: remainingMilliseconds,
      });
      const match = entries.find((entry) => combinedFilter.where?.(entry) ?? true);
      if (match !== undefined) {
        assertEntryMatching(match, filter);
        return match;
      }
      // A read that filled its limit may have left later entries unread, which are checked even
      // after the wait ends; any other read read every entry up to the head.
      const leftEntriesUnread = entries.length === READ_LIMIT;
      if (!leftEntriesUnread && remainingMilliseconds === 0) {
        throw new BotActivityTimeoutError(combinedFilter, afterPosition, timeoutMs);
      }
      unreadAfter = leftEntriesUnread
        ? entries[entries.length - 1].position
        : Math.max(unreadAfter, head_position);
    }
  }

  async assertNone<const Criteria extends BotActivityCriteria>(
    filter: BotActivityFilterFor<Criteria>,
    { after, before }: BotActivityRange,
  ): Promise<void> {
    const combinedFilter = combineFilters(this.#baseFilter, acceptingAnyEntry(filter));
    const afterPosition = toPositionNumber(after);
    const beforePosition = toPositionNumber(before);
    const matchingEntries: BotActivityEntry[] = [];
    let unreadAfter = afterPosition;
    for (;;) {
      const { entries } = await this.#read({
        after: unreadAfter,
        before: beforePosition,
        filter: combinedFilter,
        limit: READ_LIMIT,
      });
      matchingEntries.push(
        ...entries.filter((entry) => combinedFilter.where?.(entry) ?? true),
      );
      if (entries.length < READ_LIMIT) {
        break;
      }
      unreadAfter = entries[entries.length - 1].position;
    }
    if (matchingEntries.length > 0) {
      throw new UnexpectedBotActivityError(
        combinedFilter,
        afterPosition,
        beforePosition,
        matchingEntries,
      );
    }
  }

  cursor({ after }: { readonly after: BotActivityPosition }): BotActivityCursor {
    let position = toPositionNumber(after);
    const waitFor = this.waitFor.bind(this);
    return {
      get position() {
        return position;
      },
      async next<const Criteria extends BotActivityCriteria>(
        filter: BotActivityFilterFor<Criteria>,
        options: { readonly timeoutMs?: number } = {},
      ): Promise<BotActivityEntryMatching<Criteria>> {
        const entry = await waitFor(filter, { after: position, ...options });
        position = entry.position;
        return entry;
      },
    };
  }

  #read({ after, before, filter, limit, waitMilliseconds }: BotActivityRead) {
    const query = new URLSearchParams({ after: String(after), limit: String(limit) });
    if (before !== undefined) {
      query.set('before', String(before));
    }
    if (waitMilliseconds !== undefined) {
      query.set('wait_ms', String(waitMilliseconds));
    }
    const { bot_id, method, chat_id, user_id, update_id, ok, parameters } = filter;
    const criteria = { bot_id, kind: toReadKind(filter), method, chat_id, user_id, update_id, ok };
    for (const [name, value] of Object.entries(criteria)) {
      if (value !== undefined) {
        query.set(name, String(value));
      }
    }
    for (const [name, text] of Object.entries(parameters ?? {})) {
      query.set(`parameters[${name}]`, text);
    }
    return requestJson(this.#fetch, {
      method: 'GET',
      url: `${this.#activityUrl}?${query}`,
      expectedStatus: HTTP_STATUS_OK,
      responseSchema: botActivityReadResponseSchema,
    });
  }
}

/**
 * Combines the log's filter with a read's into one that an entry satisfies only by satisfying
 * both. Two different values for one criterion, or criteria only calls have together with criteria
 * only updates have, could match no entry, so they are rejected as a mistake.
 */
function combineFilters(
  logFilter: BotActivityFilter,
  readFilter: BotActivityFilter,
): BotActivityFilter {
  const parameters = combineParameters(logFilter.parameters, readFilter.parameters);
  const { where: logWhere } = logFilter;
  const { where: readWhere } = readFilter;
  const combinedFilter: BotActivityFilter = {
    bot_id: combineCriterion('bot_id', logFilter.bot_id, readFilter.bot_id),
    kind: combineCriterion('kind', logFilter.kind, readFilter.kind),
    method: combineCriterion(
      'method',
      logFilter.method,
      readFilter.method,
      // The server reads a method by its current name and without regard to case.
      (method) => toCurrentBotApiMethodName(method).toLowerCase(),
    ),
    chat_id: combineCriterion('chat_id', logFilter.chat_id, readFilter.chat_id),
    user_id: combineCriterion('user_id', logFilter.user_id, readFilter.user_id),
    update_id: combineCriterion('update_id', logFilter.update_id, readFilter.update_id),
    ok: combineCriterion('ok', logFilter.ok, readFilter.ok),
    ...(parameters === undefined ? {} : { parameters }),
    ...(logWhere === undefined || readWhere === undefined
      ? { where: logWhere ?? readWhere }
      : { where: (entry: BotActivityEntry) => logWhere(entry) && readWhere(entry) }),
  };
  if (kindsMatchableBy(combinedFilter).length === 0) {
    throw new TypeError(
      `No bot activity entry can match ${describeFilter(combinedFilter)}, ` +
        'whose criteria include some that only calls have and some that only updates have',
    );
  }
  return combinedFilter;
}

/**
 * Combines parameter criteria. An empty map is kept, as it still matches only calls, unlike
 * absent parameter criteria, which match every entry.
 */
function combineParameters(
  logParameters: Readonly<Record<string, string>> | undefined,
  readParameters: Readonly<Record<string, string>> | undefined,
): Readonly<Record<string, string>> | undefined {
  if (logParameters === undefined && readParameters === undefined) {
    return undefined;
  }
  const parameters = new Map(Object.entries(logParameters ?? {}));
  for (const [name, text] of Object.entries(readParameters ?? {})) {
    assertCompatibleCriteria(`parameter ${name}`, parameters.get(name), text);
    parameters.set(name, text);
  }
  return Object.fromEntries(parameters);
}

function combineCriterion<Value>(
  name: string,
  logValue: Value | undefined,
  readValue: Value | undefined,
  normalize?: (value: Value) => unknown,
): Value | undefined {
  assertCompatibleCriteria(name, logValue, readValue, normalize);
  return readValue ?? logValue;
}

function assertCompatibleCriteria<Value>(
  name: string,
  logValue: Value | undefined,
  readValue: Value | undefined,
  normalize: (value: Value) => unknown = (value) => value,
): void {
  if (
    logValue !== undefined && readValue !== undefined &&
    normalize(logValue) !== normalize(readValue)
  ) {
    throw new TypeError(
      `The read's ${name} ${JSON.stringify(readValue)} conflicts with the log's ${
        JSON.stringify(logValue)
      }`,
    );
  }
}

/**
 * Adapts a filter whose `where` predicate expects only the entries its criteria can match to one
 * that checks any entry. It is applied to entries the server matched against the criteria, so an
 * entry of another kind means the server broke its answer's contract.
 */
function acceptingAnyEntry<Criteria extends BotActivityCriteria>(
  filter: BotActivityFilterFor<Criteria>,
): BotActivityFilter {
  const { where } = filter;
  return {
    ...filter,
    where: where === undefined ? undefined : (entry) => {
      assertEntryMatching(entry, filter);
      return where(entry);
    },
  };
}

/** Checks that an entry the server matched is of a kind the criteria can match. */
function assertEntryMatching<Criteria extends BotActivityCriteria>(
  entry: BotActivityEntry,
  criteria: Criteria,
): asserts entry is BotActivityEntryMatching<Criteria> {
  if (!isEntryMatching(entry, criteria)) {
    throw new TypeError(
      `The emulator answered a read for ${describeFilter(criteria)} with an entry of kind ` +
        entry.kind,
    );
  }
}

function isEntryMatching(entry: BotActivityEntry, criteria: BotActivityCriteria): boolean {
  return kindsMatchableBy(criteria).includes(entry.kind);
}

/**
 * The kinds of entry criteria can match: the kind they name, if any, narrowed by the criteria
 * that only calls have, `method`, `ok` and `parameters`, even an empty map, and those that only
 * updates have, `user_id` and `update_id`.
 */
function kindsMatchableBy(criteria: BotActivityCriteria): readonly BotActivityKind[] {
  const hasCallCriteria = criteria.method !== undefined || criteria.ok !== undefined ||
    criteria.parameters !== undefined;
  const hasUpdateCriteria = criteria.user_id !== undefined || criteria.update_id !== undefined;
  return BOT_ACTIVITY_KINDS.filter((kind) =>
    (criteria.kind === undefined || kind === criteria.kind) &&
    (kind === 'bot_api_call' ? !hasUpdateCriteria : !hasCallCriteria)
  );
}

/**
 * The kind a read sends: the only kind its criteria can match, if just one. Empty parameter
 * criteria limit a read to calls but put nothing on the wire, which the kind then expresses.
 */
function toReadKind(criteria: BotActivityCriteria): BotActivityKind | undefined {
  const matchableKinds = kindsMatchableBy(criteria);
  return matchableKinds.length === 1 ? matchableKinds[0] : undefined;
}

function toPositionNumber(position: BotActivityPosition): number {
  const positionNumber = typeof position === 'number' ? position : position.position;
  if (!Number.isInteger(positionNumber) || positionNumber < 0) {
    throw new TypeError(`A bot activity position must be a nonnegative integer: ${positionNumber}`);
  }
  return positionNumber;
}

function validateTimeout(timeoutMs: number): void {
  if (!Number.isFinite(timeoutMs) || timeoutMs < 0) {
    throw new TypeError(`A bot activity timeout must be a nonnegative number: ${timeoutMs}`);
  }
}

function describeFilter(filter: BotActivityCriteria & { readonly where?: unknown }): string {
  const { where, ...criteria } = filter;
  return `${JSON.stringify(criteria)}${where === undefined ? '' : ' and its where predicate'}`;
}
