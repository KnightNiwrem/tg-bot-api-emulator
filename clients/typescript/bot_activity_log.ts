import type { z } from 'zod';

import { BOT_ACTIVITY_KINDS } from '../../src/types/bot_activity_kind.ts';
import { toCurrentBotApiMethodName } from '../../src/types/bot_api_method_name.ts';
import { HTTP_STATUS_OK } from './constants.ts';
import { EmulationClientError } from './emulation_client_error.ts';
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
/**
 * How long after its deadline a wait's reads of entries already recorded may take: those after a
 * page that filled the read limit, up to the head it reported, and the one read of a wait with no
 * time to wait.
 */
const RECORDED_READ_ALLOWANCE_MILLISECONDS = 1_000;
/** The most entries the server answers a read with. */
const READ_LIMIT = 1_000;

/** Returns the latest of the positions, such as the later of two entries. */
export function latest(
  firstPosition: BotActivityPosition,
  ...otherPositions: readonly BotActivityPosition[]
): number {
  return Math.max(...[firstPosition, ...otherPositions].map(toPositionNumber));
}

/**
 * No entry matching a filter was found after a position before the wait ended. When a read the
 * wait sent was abandoned unanswered, or failed, once the time it had was over, `cause` is the
 * `EmulationClientError` for that read.
 */
export class BotActivityTimeoutError extends Error {
  override readonly name = 'BotActivityTimeoutError';
  readonly filter: BotActivityFilter;
  readonly after: number;
  readonly timeoutMs: number;

  constructor(
    filter: BotActivityFilter,
    after: number,
    timeoutMs: number,
    options?: { readonly cause: EmulationClientError },
  ) {
    super(
      `No bot activity matching ${describeFilter(filter)} was found after position ${after} ` +
        `within ${timeoutMs} ms`,
      options,
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
  /** Abandons the read, unanswered or with its response unread, when it aborts. */
  readonly signal?: AbortSignal;
}

type BotActivityReadAnswer = z.output<typeof botActivityReadResponseSchema>;

/**
 * A wait's reads: one that holds until an entry is recorded, which must settle by the deadline, or
 * one of entries already recorded, which gets the allowance after it.
 */
type BotActivityWaitReadKind = 'holding' | 'recorded';

/**
 * Ends a wait's search once a read settled, or was abandoned, after the time its kind of read has;
 * `waitFor` reports it as a `BotActivityTimeoutError`. A read that failed or was abandoned is kept
 * to explain the timeout.
 */
class BotActivityWaitTimeUp extends Error {
  override readonly name = 'BotActivityWaitTimeUp';
  readonly lateRead?: EmulationClientError;

  constructor(lateRead?: EmulationClientError) {
    super('The wait for bot activity ran out of time');
    this.lateRead = lateRead;
  }
}

/** A range of the log whose entries are all recorded, read a page at a time. */
interface RecordedRange {
  readonly after: number;
  readonly before: number;
  readonly filter: BotActivityFilter;
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
    { after, timeoutMs = this.#defaultTimeoutMilliseconds, signal }: WaitForBotActivityOptions,
  ): Promise<BotActivityEntryMatching<Criteria>> {
    validateTimeout(timeoutMs);
    const combinedFilter = combineFilters(this.#baseFilter, acceptingAnyEntry(filter));
    const afterPosition = toPositionNumber(after);
    const waitTime = new BotActivityWaitTime(timeoutMs, signal);
    let match: BotActivityEntry | undefined;
    try {
      match = await this.#findFirstMatch(combinedFilter, afterPosition, waitTime);
    } catch (error) {
      if (error instanceof BotActivityWaitTimeUp) {
        throw new BotActivityTimeoutError(
          combinedFilter,
          afterPosition,
          timeoutMs,
          error.lateRead === undefined ? undefined : { cause: error.lateRead },
        );
      }
      if (error instanceof EmulationClientError && waitTime.isCancellationReason(error.cause)) {
        throw error.cause;
      }
      throw error;
    } finally {
      waitTime.end();
    }
    if (match === undefined) {
      throw new BotActivityTimeoutError(combinedFilter, afterPosition, timeoutMs);
    }
    assertEntryMatching(match, filter);
    return match;
  }

  /**
   * Finds the first entry after a position that the filter's `where` predicate accepts, among the
   * entries the emulator reports in the wait's time, or `undefined` once the deadline has passed.
   */
  async #findFirstMatch(
    filter: BotActivityFilter,
    after: number,
    waitTime: BotActivityWaitTime,
  ): Promise<BotActivityEntry | undefined> {
    const isMatch = (entry: BotActivityEntry) => filter.where?.(entry) ?? true;
    const readRecorded = (read: BotActivityRead) => this.#readForWait(read, 'recorded', waitTime);
    let unreadAfter = after;
    let remainingMilliseconds = waitTime.remainingMilliseconds();
    for (;;) {
      // A read with time left holds until an entry is recorded; one without, as in a wait of 0 ms,
      // takes what is recorded.
      const { entries, head_position } = await this.#readForWait(
        { after: unreadAfter, filter, limit: READ_LIMIT, waitMilliseconds: remainingMilliseconds },
        remainingMilliseconds > 0 ? 'holding' : 'recorded',
        waitTime,
      );
      let match = entries.find(isMatch);
      if (match === undefined && entries.length === READ_LIMIT) {
        // A full page may have left entries unread up to the head it reports, which were recorded
        // before it was answered and are checked even after the deadline.
        const unreadRange = {
          after: entries[entries.length - 1].position,
          before: head_position + 1,
          filter,
        };
        for await (const recordedEntries of this.#readRecordedPages(unreadRange, readRecorded)) {
          match = recordedEntries.find(isMatch);
          if (match !== undefined) {
            break;
          }
        }
      }
      if (match !== undefined) {
        return match;
      }
      remainingMilliseconds = waitTime.remainingMilliseconds();
      if (remainingMilliseconds === 0) {
        return undefined;
      }
      unreadAfter = Math.max(unreadAfter, head_position);
    }
  }

  /**
   * Makes one of a wait's reads, and throws `BotActivityWaitTimeUp` unless it settles in the time
   * its kind of read has. The timers that abandon a read run only once the event loop is free, so
   * the clock decides too whether a read settled in time, whether it was answered or failed.
   */
  async #readForWait(
    read: BotActivityRead,
    kind: BotActivityWaitReadKind,
    waitTime: BotActivityWaitTime,
  ): Promise<BotActivityReadAnswer> {
    let answer: BotActivityReadAnswer;
    try {
      answer = await this.#read({ ...read, signal: waitTime.signalFor(kind) });
    } catch (error) {
      if (
        error instanceof EmulationClientError && !waitTime.isCancellationReason(error.cause) &&
        (waitTime.isExpiryReason(error.cause) || waitTime.isOverFor(kind))
      ) {
        throw new BotActivityWaitTimeUp(error);
      }
      throw error;
    }
    if (waitTime.isOverFor(kind)) {
      throw new BotActivityWaitTimeUp();
    }
    return answer;
  }

  async assertNone<const Criteria extends BotActivityCriteria>(
    filter: BotActivityFilterFor<Criteria>,
    { after, before }: BotActivityRange,
  ): Promise<void> {
    const combinedFilter = combineFilters(this.#baseFilter, acceptingAnyEntry(filter));
    const afterPosition = toPositionNumber(after);
    const beforePosition = toPositionNumber(before);
    const matchingEntries: BotActivityEntry[] = [];
    const range = { after: afterPosition, before: beforePosition, filter: combinedFilter };
    for await (const entries of this.#readRecordedPages(range, (read) => this.#read(read))) {
      matchingEntries.push(...entries.filter((entry) => combinedFilter.where?.(entry) ?? true));
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
        options: Omit<WaitForBotActivityOptions, 'after'> = {},
      ): Promise<BotActivityEntryMatching<Criteria>> {
        const entry = await waitFor(filter, { ...options, after: position });
        position = entry.position;
        return entry;
      },
    };
  }

  /** Reads the entries in a range that is already recorded, a page at a time, with `readPage`. */
  async *#readRecordedPages(
    { after, before, filter }: RecordedRange,
    readPage: (read: BotActivityRead) => Promise<BotActivityReadAnswer>,
  ): AsyncGenerator<readonly BotActivityEntry[]> {
    let unreadAfter = after;
    for (;;) {
      const { entries } = await readPage({ after: unreadAfter, before, filter, limit: READ_LIMIT });
      yield entries;
      if (entries.length < READ_LIMIT) {
        return;
      }
      unreadAfter = entries[entries.length - 1].position;
    }
  }

  #read(
    { after, before, filter, limit, waitMilliseconds, signal }: BotActivityRead,
  ): Promise<BotActivityReadAnswer> {
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
      signal,
    });
  }
}

/**
 * The time a wait has. Until its deadline, `timeoutMs` after it starts, it waits for entries to be
 * recorded, and abandons a read that holds for one if the emulator has not answered by then, so
 * that an answer received later never counts. Reads of entries already recorded get
 * `RECORDED_READ_ALLOWANCE_MILLISECONDS` more. The caller's signal abandons every read at once.
 */
class BotActivityWaitTime {
  /** Aborts at the deadline, or when the caller cancels the wait. */
  readonly holdingReadSignal: AbortSignal;
  /** Aborts once the allowance after the deadline is used up, or when the caller cancels. */
  readonly recordedReadSignal: AbortSignal;
  readonly #cancellationSignal: AbortSignal | undefined;
  readonly #deadline: number;
  readonly #deadlineController = new AbortController();
  readonly #allowanceController = new AbortController();
  readonly #timerIds: readonly ReturnType<typeof setTimeout>[];

  constructor(timeoutMs: number, cancellationSignal: AbortSignal | undefined) {
    this.#cancellationSignal = cancellationSignal;
    this.#deadline = performance.now() + timeoutMs;
    this.#timerIds = [
      abortLater(
        this.#deadlineController,
        timeoutMs,
        new DOMException(`The wait's ${timeoutMs} ms are up`, 'TimeoutError'),
      ),
      abortLater(
        this.#allowanceController,
        timeoutMs + RECORDED_READ_ALLOWANCE_MILLISECONDS,
        new DOMException(
          `The ${RECORDED_READ_ALLOWANCE_MILLISECONDS} ms to read recorded entries after the ` +
            `wait's ${timeoutMs} ms are up`,
          'TimeoutError',
        ),
      ),
    ];
    const cancellationSignals = cancellationSignal === undefined ? [] : [cancellationSignal];
    this.holdingReadSignal = AbortSignal.any([
      ...cancellationSignals,
      this.#deadlineController.signal,
    ]);
    this.recordedReadSignal = AbortSignal.any([
      ...cancellationSignals,
      this.#allowanceController.signal,
    ]);
  }

  /** The signal that abandons a read of the kind. */
  signalFor(kind: BotActivityWaitReadKind): AbortSignal {
    return kind === 'holding' ? this.holdingReadSignal : this.recordedReadSignal;
  }

  /** Whether, by the clock, the time a read of the kind has is over. */
  isOverFor(kind: BotActivityWaitReadKind): boolean {
    const allowanceMilliseconds = kind === 'holding' ? 0 : RECORDED_READ_ALLOWANCE_MILLISECONDS;
    return performance.now() >= this.#deadline + allowanceMilliseconds;
  }

  /** The whole milliseconds left before the deadline, rounded up; 0 once it has passed. */
  remainingMilliseconds(): number {
    return Math.max(0, Math.ceil(this.#deadline - performance.now()));
  }

  /** Whether a read was abandoned because the caller cancelled the wait. */
  isCancellationReason(reason: unknown): boolean {
    return this.#cancellationSignal?.aborted === true && this.#cancellationSignal.reason === reason;
  }

  /** Whether a read was abandoned because the wait's time was up, rather than cancelled. */
  isExpiryReason(reason: unknown): boolean {
    return [this.#deadlineController.signal, this.#allowanceController.signal].some((signal) =>
      signal.aborted && signal.reason === reason
    );
  }

  /** Stops the timers once the wait has ended. */
  end(): void {
    for (const timerId of this.#timerIds) {
      clearTimeout(timerId);
    }
  }
}

/** The longest delay `setTimeout` keeps; it runs a callback with a longer one at once. */
const MAX_TIMER_DELAY_MILLISECONDS = 2 ** 31 - 1;

function abortLater(
  controller: AbortController,
  delayMilliseconds: number,
  reason: DOMException,
): ReturnType<typeof setTimeout> {
  return setTimeout(
    () => controller.abort(reason),
    Math.min(delayMilliseconds, MAX_TIMER_DELAY_MILLISECONDS),
  );
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
