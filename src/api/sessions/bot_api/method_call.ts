import type { ContentfulStatusCode } from 'hono/utils/http-status';

import type { BotApiCallTransport } from '../../../types/bot_activity.ts';
import type { EmulationSession } from '../../../session/emulation_session.ts';
import type { VirtualBotProfile } from '../../../types/virtual_bot.ts';
import type { BotApiRequestParameters, BotApiUploadedFiles } from './request_parameters.ts';

/**
 * Who calls a Bot API method, and the session services a method may use to answer.
 *
 * A method that waits, as a download does, checks the session's commit gate as soon as each wait
 * ends, in the function that awaited, before it acts on the wait's result, and returns
 * `SESSION_ENDED` once the session has ended. The last check falls in the same synchronous step as
 * the change it guards, so a method never changes an ended session, and no later wait starts.
 */
export interface BotApiMethodContext {
  /**
   * The feature services and workflows that methods call, the files that methods download from the
   * web, and the session's lifetime, whose commit gate closes when the session ends.
   */
  readonly session: Pick<
    EmulationSession,
    | 'mediaFiles'
    | 'botUpdateConsumers'
    | 'botCommands'
    | 'botDescriptions'
    | 'botDefaultAdministratorRights'
    | 'botMenuButtons'
    | 'callbackQueries'
    | 'checkouts'
    | 'inlineQueries'
    | 'botMediaResolver'
    | 'privateMessaging'
    | 'supergroupMessaging'
    | 'sharedChatAdministration'
    | 'chatAdmission'
    | 'botMessageViews'
    | 'messagePinning'
    | 'messageDeletion'
    | 'messageReactions'
    | 'messageEditing'
    | 'botMessageSending'
    | 'botMessageRepeater'
    | 'chatActions'
    | 'messageDrafts'
    | 'lifetime'
  >;
  /** The bot whose token authenticated the call. */
  readonly bot: VirtualBotProfile;
  /**
   * Aborts when the caller stops waiting for the answer, as a closed HTTP request does, or when
   * the session ends.
   */
  readonly signal: AbortSignal;
}

/**
 * The part of a method's context that one family of methods uses: the calling bot and the call's
 * signal, and of the session only the services the family names. A family's `execute` functions
 * take it, so each family states the services it depends on and reaches no others.
 */
export interface BotApiFamilyContext<
  SessionService extends keyof BotApiMethodContext['session'],
> {
  readonly session: Pick<BotApiMethodContext['session'], SessionService>;
  readonly bot: BotApiMethodContext['bot'];
  readonly signal: BotApiMethodContext['signal'];
}

/**
 * A bot's call of a Bot API method, whichever way the call arrived: as an HTTP request, or in a
 * webhook's response to an update. Running the call also takes the answers tests queued for it and
 * records it as bot activity, in a transaction of the session, which methods themselves cannot
 * reach.
 */
export interface BotApiCallContext extends BotApiMethodContext {
  readonly session:
    & BotApiMethodContext['session']
    & Pick<EmulationSession, 'botRateLimits' | 'botServerErrors' | 'botActivity' | 'transactions'>;
  readonly via: BotApiCallTransport;
}

/**
 * What a method returns instead of an answer when its session ended before the method could change
 * it: the method changed nothing, and nobody receives an answer from an ended session.
 */
export const SESSION_ENDED: unique symbol = Symbol('session ended');

/** How a method ends: with its answer, or refused by its ended session. */
export type BotApiMethodOutcome = BotApiMethodAnswer | typeof SESSION_ENDED;

/**
 * Runs a method with a call's parameters and uploaded files, and answers the call, committing the
 * method's changes as it makes them.
 */
export type BotApiMethodHandler = (
  context: BotApiMethodContext,
  parameters: BotApiRequestParameters,
  uploadedFiles: BotApiUploadedFiles,
) => BotApiMethodOutcome | Promise<BotApiMethodOutcome>;

/**
 * What preparing a call produced: the command that the call's transaction executes at its commit
 * boundary, or the call's answer, when preparation already decided it, as for parameters that
 * cannot be read.
 */
export type BotApiCallPreparation =
  | {
    readonly kind: 'command';
    /**
     * Checks every condition that depends on the session's state, since preparation may have
     * outlasted it, then changes the session and answers the call. It runs synchronously, in the
     * call's transaction, which a failure aborts.
     */
    readonly execute: () => BotApiMethodAnswer;
  }
  | { readonly kind: 'answered'; readonly answer: BotApiMethodAnswer };

/** The preparation of a call that preparing already answered, as one whose parameters are invalid. */
export function answeredPreparation(answer: BotApiMethodAnswer): BotApiCallPreparation {
  return { kind: 'answered', answer };
}

/**
 * The preparation of a call that preparing already answered with `outcome`, or `SESSION_ENDED` when
 * the outcome is the refusal of an ended session.
 */
export function answeredPreparationUnlessEnded(
  outcome: BotApiMethodOutcome,
): BotApiCallPreparation | typeof SESSION_ENDED {
  return outcome === SESSION_ENDED ? SESSION_ENDED : answeredPreparation(outcome);
}

/**
 * Prepares a call of a method that executes as a command: it reads the call's parameters and
 * waits for what they name, such as downloads, producing plain values without changing the
 * session. Read-only checks of the session's state that the method's error precedence puts first
 * stay here, in their order. A preparation that waits returns `SESSION_ENDED` once the session
 * ended during the wait.
 */
export type BotApiCommandPreparer = (
  context: BotApiMethodContext,
  parameters: BotApiRequestParameters,
  uploadedFiles: BotApiUploadedFiles,
) =>
  | BotApiCallPreparation
  | typeof SESSION_ENDED
  | Promise<BotApiCallPreparation | typeof SESSION_ENDED>;

/**
 * How a call ends, however it arrived: answered, or refused because its session had ended before
 * the call could change it or be recorded.
 */
export type BotApiCallOutcome =
  | { readonly answered: true; readonly answer: BotApiMethodAnswer }
  | { readonly answered: false; readonly reason: 'session_ended' };

interface BotApiMethodRecord {
  readonly name: string;
  /**
   * Whether the session's bot activity records the method's calls, however they arrived and
   * whatever they were answered: `getUpdates` calls are not, since the updates they deliver are.
   */
  readonly recordsActivity: boolean;
  /**
   * The answer a call receives instead of running when its session has ended before the call
   * could change anything, for a method whose callers wait on it: a long poll finds no updates.
   * A call of any other method is then refused without an answer.
   */
  readonly answerOnceSessionEnded?: BotApiMethodAnswer;
}

/**
 * A method whose handler answers each call and commits its own changes; only the call's activity
 * record is committed in the call's transaction. Methods move from handlers to commands family by
 * family.
 */
interface BotApiHandledMethod extends BotApiMethodRecord {
  readonly handler: BotApiMethodHandler;
}

/**
 * A method whose calls are prepared first, then executed as a command in the call's transaction,
 * together with their activity record, so a call commits all of its changes or none.
 */
interface BotApiCommandMethod extends BotApiMethodRecord {
  readonly prepare: BotApiCommandPreparer;
}

/** A Bot API method the emulator implements, under its current name. */
export type BotApiMethod = BotApiHandledMethod | BotApiCommandMethod;

/** Telegram's JSON answer to a Bot API method, with the HTTP status that carries it. */
export type BotApiMethodAnswer =
  | {
    readonly status: 200;
    readonly body: {
      readonly ok: true;
      readonly result: unknown;
      /** Telegram describes the outcome of a few methods, such as `setWebhook`. */
      readonly description?: string;
    };
  }
  | {
    readonly status: ContentfulStatusCode;
    readonly body: {
      readonly ok: false;
      readonly error_code: ContentfulStatusCode;
      readonly description: string;
      /** Telegram tells a rate-limited bot how many seconds to wait before retrying. */
      readonly parameters?: { readonly retry_after: number };
    };
  };

export function botApiResult(result: unknown, description?: string): BotApiMethodAnswer {
  return {
    status: 200,
    body: { ok: true, result, ...(description === undefined ? {} : { description }) },
  };
}

export function botApiError(
  errorCode: ContentfulStatusCode,
  description: string,
): BotApiMethodAnswer {
  return { status: errorCode, body: { ok: false, error_code: errorCode, description } };
}

/**
 * Telegram's answer to a rate-limited call, as the official Bot API server's
 * `Query::set_retry_after_error` writes it; the HTTP response also carries the wait in its
 * `Retry-After` header.
 */
export function botApiRetryAfterError(retryAfterSeconds: number): BotApiMethodAnswer {
  return {
    status: 429,
    body: {
      ok: false,
      error_code: 429,
      description: `Too Many Requests: retry after ${retryAfterSeconds}`,
      parameters: { retry_after: retryAfterSeconds },
    },
  };
}
