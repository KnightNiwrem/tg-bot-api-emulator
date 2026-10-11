import type { BotApiUpdate } from '../types/bot_api.ts';
import {
  type BotWebhook,
  getWebhookUpdateQueueKey,
  parseWebhookUrl,
  type WebhookAttemptFailure,
  type WebhookDeliveryError,
} from '../types/bot_webhook.ts';
import type {
  BeginWebhookAttemptInput,
  WebhookAttemptHandle,
} from './webhook_attempt_scheduler.ts';

/** The header that carries a webhook's secret token, as Telegram names it. */
const SECRET_TOKEN_HEADER = 'X-Telegram-Bot-Api-Secret-Token';

/**
 * The longest wait before an update is sent again. Telegram caps it at a random value between 60
 * and 120 seconds; the emulator always caps it at 60, so that retries are timed the same way in
 * every test run.
 */
const MAX_RETRY_DELAY_SECONDS = 60;

/** The longest wait a webhook's `Retry-After` header can ask for, as Telegram limits it. */
const MAX_RETRY_AFTER_SECONDS = 3_600;

/**
 * The text of a `Retry-After` header that TDLib's `HttpQuery::get_retry_after` reads as a positive
 * number of seconds: a whole number written without a sign or leading zeros.
 */
const POSITIVE_RETRY_AFTER_PATTERN = /^[1-9]\d*$/;

/** The largest number TDLib reads from a `Retry-After` header, which is the largest `int`. */
const MAX_READABLE_RETRY_AFTER_SECONDS = 2 ** 31 - 1;

/** Telegram's description of a webhook that answered nothing in time. */
const READ_TIMEOUT_ERROR_MESSAGE = 'Read timeout expired';

/**
 * Sends a webhook request and answers with the webhook's response, as `fetch` does over the
 * network. A sender fails by rejecting, as `fetch` does when it cannot connect.
 */
export type WebhookTransport = (request: Request) => Promise<Response>;

interface PendingUpdateQueue {
  readPendingUpdates(botId: number): readonly BotApiUpdate[];
  confirmPendingUpdate(botId: number, updateId: number): void;
  getNextUpdateId(botId: number): number;
  waitForUpdate(
    botId: number,
    input: { readonly awaitedUpdateId: number; readonly signal: AbortSignal },
  ): Promise<unknown>;
}

/** Keeps the latest error delivering to each bot's webhook, which `getWebhookInfo` reports. */
interface WebhookDeliveryErrorStore {
  recordDeliveryError(botId: number, error: WebhookDeliveryError): void;
}

/** Records each attempt to deliver an update to a webhook, and its outcome, as bot activity. */
interface UpdateActivityRecorder {
  recordWebhookUpdateDelivery(botId: number, update: BotApiUpdate, webhookAttemptId: number): void;
  recordWebhookUpdateConfirmation(
    botId: number,
    update: BotApiUpdate,
    webhookAttemptId: number,
  ): void;
  recordWebhookAttemptFailure(input: {
    readonly botId: number;
    readonly update: BotApiUpdate;
    readonly webhookAttemptId: number;
    readonly failure: WebhookAttemptFailure;
    readonly retryDelaySeconds: number;
  }): void;
}

/** Records each attempt to deliver an update, and decides when its deadline and retry come. */
interface WebhookAttemptTracker {
  beginAttempt(input: BeginWebhookAttemptInput): WebhookAttemptHandle;
}

/** How a command of the session's transactions ended: executed, or refused once the session ended. */
type CommandExecution<Result> =
  | { readonly executed: true; readonly result: Result }
  | { readonly executed: false; readonly reason: 'session_ended' };

/** The session's transactions, which execute each change a delivery makes, unless it has ended. */
interface WebhookDeliveryTransactions {
  execute<Result>(command: () => Result): CommandExecution<Result>;
}

interface WebhookDeliveryServiceDependencies {
  readonly pendingUpdates: PendingUpdateQueue;
  readonly deliveryErrors: WebhookDeliveryErrorStore;
  readonly updateActivity: UpdateActivityRecorder;
  readonly sendWebhookRequest: WebhookTransport;
  /**
   * Starts running the Bot API method, if any, that the bot's webhook names in its complete
   * successful response to an update, as work of the session apart from the delivery: nothing
   * awaits it, the attempt's deadline does not bound it, and a replaced or deleted webhook does not
   * stop it. The session's end stops it from changing anything. The work is under way when this
   * returns.
   */
  readonly startWebhookReply: (botId: number, reply: Response) => void;
  readonly attempts: WebhookAttemptTracker;
  /**
   * Executes each change of a delivery as one command: an attempt's start, its acceptance, and its
   * failure.
   */
  readonly transactions: WebhookDeliveryTransactions;
  readonly currentUnixTimeSeconds: () => number;
}

/**
 * The delivery to one webhook a bot registered, from its registration until it is replaced or
 * deleted or the session ends.
 */
export interface WebhookGeneration {
  /**
   * Stops the delivery for good, including a request in flight: an attempt still waiting for its
   * complete response is cancelled and its update stays pending, and a waiting retry is
   * cancelled. Nothing the stopped generation still has running can change the bot's delivery
   * afterwards.
   */
  stop(): void;
}

/** How an attempt to deliver an update to a webhook ended. */
type UpdateDeliveryOutcome =
  | { readonly outcome: 'accepted' }
  | {
    readonly outcome: 'failed';
    readonly failure: WebhookAttemptFailure;
    /** The wait the webhook asked for in its `Retry-After` header, or 0 when it asked for none. */
    readonly retryAfterSeconds: number;
  }
  /** Delivery stopped before the webhook's complete response arrived. */
  | { readonly outcome: 'cancelled' };

/** How the retries of a failing update stand, as `WebhookActor` keeps them for each update. */
interface UpdateRetryBackoff {
  readonly failureCount: number;
  /** Doubles with each later failure that has no `Retry-After`, up to the maximum. */
  readonly delaySeconds: number;
}

/** The backoff of an update that has not failed yet. */
const INITIAL_UPDATE_RETRY_BACKOFF: UpdateRetryBackoff = { failureCount: 0, delaySeconds: 1 };

/**
 * Delivers each bot's pending updates to its webhook, one generation of the webhook at a time.
 *
 * As on Telegram, an update stays pending until its webhook answers it with a 2xx status, and a
 * failed update is sent again after a growing delay, or after the delay the webhook asks for in a
 * `Retry-After` header. As the official Bot API server's `WebhookActor` does, updates wait in
 * queues, which `getWebhookUpdateQueueKey` names: each queue sends one update at a time, in order,
 * so a failing update holds back only the later updates of its queue, and up to `max_connections`
 * queues send at once. Telegram also opens its connections gradually, which the emulator does not.
 *
 * A complete 2xx response accepts the update at once, as `WebhookActor` acknowledges it on receipt:
 * the update is confirmed, and the queue moves on to its next update, while the method the response
 * names runs separately. So the next update of a queue may be sent, and even confirmed, before the
 * previous update's reply method has run. Stopping the generation, and the attempt's deadline, end
 * only attempts still waiting for their complete response.
 *
 * Each update, attempt and retry follows its own state machine. An update is pending until it is
 * confirmed, or discarded by `drop_pending_updates`. An attempt is in flight until it is accepted,
 * fails or is cancelled, and a failed attempt's retry waits until it is released or cancelled; the
 * `attempts` tracker keeps both, and each of their ends is final.
 *
 * An attempt whose deadline arrives fails as Telegram's read timeout does. Telegram times out a
 * connection that receives no data for a while; the emulator bounds each attempt as a whole,
 * whatever the sender of its requests does, so a webhook that never answers cannot stall delivery.
 * `attempts` decides when each attempt's deadline arrives and when each failed update's retry is
 * released.
 *
 * Each change a delivery makes to the session executes as one command of the session's
 * transactions: recording an attempt's start, accepting its update with the confirmation's record,
 * and recording its failure with the webhook's delivery error. None commits once the session has
 * ended, whatever a sender still running then answers.
 */
export class WebhookDeliveryService {
  readonly #pendingUpdates: PendingUpdateQueue;
  readonly #deliveryErrors: WebhookDeliveryErrorStore;
  readonly #updateActivity: UpdateActivityRecorder;
  readonly #sendWebhookRequest: WebhookTransport;
  readonly #startWebhookReply: (botId: number, reply: Response) => void;
  readonly #attempts: WebhookAttemptTracker;
  readonly #transactions: WebhookDeliveryTransactions;
  readonly #currentUnixTimeSeconds: () => number;

  constructor(
    {
      pendingUpdates,
      deliveryErrors,
      updateActivity,
      sendWebhookRequest,
      startWebhookReply,
      attempts,
      transactions,
      currentUnixTimeSeconds,
    }: WebhookDeliveryServiceDependencies,
  ) {
    this.#pendingUpdates = pendingUpdates;
    this.#deliveryErrors = deliveryErrors;
    this.#updateActivity = updateActivity;
    this.#sendWebhookRequest = sendWebhookRequest;
    this.#startWebhookReply = startWebhookReply;
    this.#attempts = attempts;
    this.#transactions = transactions;
    this.#currentUnixTimeSeconds = currentUnixTimeSeconds;
  }

  /** Starts delivering the bot's pending updates to `webhook`, until the generation is stopped. */
  startGeneration(botId: number, webhook: BotWebhook): WebhookGeneration {
    const delivery = new AbortController();
    void this.#deliverPendingUpdates(botId, webhook, delivery.signal);
    return { stop: () => delivery.abort() };
  }

  /**
   * Delivers the bot's pending updates to its webhook until `signal` aborts, sending each queue's
   * updates with its own worker while the queue has any.
   */
  async #deliverPendingUpdates(
    botId: number,
    webhook: BotWebhook,
    signal: AbortSignal,
  ): Promise<void> {
    const connections = new WebhookConnectionLimit(webhook.maxConnections);
    const deliveringQueueKeys = new Set<string>();
    let wakeUp = () => {};
    while (!signal.aborted) {
      const queueEnded = new Promise<void>((resolve) => {
        wakeUp = resolve;
      });
      const nextUpdateId = this.#pendingUpdates.getNextUpdateId(botId);
      for (const update of this.#pendingUpdates.readPendingUpdates(botId)) {
        const queueKey = getWebhookUpdateQueueKey(update);
        if (deliveringQueueKeys.has(queueKey)) {
          continue;
        }
        deliveringQueueKeys.add(queueKey);
        void this.#deliverQueue(botId, webhook, queueKey, connections, signal).finally(() => {
          deliveringQueueKeys.delete(queueKey);
          wakeUp();
        });
      }

      const updateWait = new AbortController();
      await Promise.race([
        this.#pendingUpdates.waitForUpdate(botId, {
          awaitedUpdateId: nextUpdateId,
          signal: AbortSignal.any([signal, updateWait.signal]),
        }),
        queueEnded,
      ]);
      updateWait.abort();
    }
  }

  /**
   * Sends the pending updates of one queue to the webhook one at a time, each over a connection
   * of `connections`, until the queue has none left or `signal` aborts. An update is confirmed, and
   * its confirmation recorded as bot activity, once the webhook accepts it; a failed update is sent
   * again once its retry is released, and the queue uses no connection until then. Aborting before
   * the webhook's complete response cancels the attempt and leaves its update pending; a complete
   * response received first still accepts it.
   */
  async #deliverQueue(
    botId: number,
    webhook: BotWebhook,
    queueKey: string,
    connections: WebhookConnectionLimit,
    signal: AbortSignal,
  ): Promise<void> {
    let failingUpdateId: number | undefined;
    let retryBackoff = INITIAL_UPDATE_RETRY_BACKOFF;
    while (!signal.aborted) {
      const update = this.#pendingUpdates.readPendingUpdates(botId).find((pendingUpdate) =>
        getWebhookUpdateQueueKey(pendingUpdate) === queueKey
      );
      if (update === undefined) {
        return;
      }

      const releaseConnection = await connections.acquire(signal);
      if (releaseConnection === undefined) {
        return;
      }
      if (signal.aborted) {
        releaseConnection();
        return;
      }
      const attempt = this.#attempts.beginAttempt({ botId, update, deliverySignal: signal });
      let outcome: UpdateDeliveryOutcome;
      try {
        outcome = await this.#sendUpdate(botId, webhook, update, {
          attempt,
          deliverySignal: signal,
          acceptUpdate: (reply) => {
            // The reply's work is under way before the confirmation is published, so no reader
            // sees the update confirmed while the method its webhook named has not started.
            this.#startWebhookReply(botId, reply);
            // Once the session has ended, the update stays pending, as it does for a webhook
            // whose delivery the end stopped.
            this.#transactions.execute(() => {
              this.#pendingUpdates.confirmPendingUpdate(botId, update.update_id);
              attempt.accept();
              this.#updateActivity.recordWebhookUpdateConfirmation(botId, update, attempt.id);
            });
          },
        });
      } finally {
        releaseConnection();
      }
      if (outcome.outcome === 'cancelled') {
        attempt.cancel();
        return;
      }
      if (outcome.outcome === 'accepted') {
        continue;
      }

      const { failure } = outcome;
      if (failingUpdateId !== update.update_id) {
        failingUpdateId = update.update_id;
        retryBackoff = INITIAL_UPDATE_RETRY_BACKOFF;
      }
      const retry = scheduleUpdateRetry(retryBackoff, outcome.retryAfterSeconds);
      retryBackoff = retry.backoff;
      const failureRecording = this.#transactions.execute(() => {
        // A failure decided just before the webhook was replaced or deleted belongs to a webhook
        // that is no longer the bot's, so it must not become the current webhook's delivery error.
        if ('errorMessage' in failure && !signal.aborted) {
          this.#deliveryErrors.recordDeliveryError(botId, {
            dateUnixSeconds: this.#currentUnixTimeSeconds(),
            message: failure.errorMessage,
          });
        }
        // The retry is scheduled before the failure is recorded, so a reader of the record finds
        // the retry waiting.
        const retryRelease = attempt.failAndAwaitRetry(failure, retry.delaySeconds);
        this.#updateActivity.recordWebhookAttemptFailure({
          botId,
          update,
          webhookAttemptId: attempt.id,
          failure,
          retryDelaySeconds: retry.delaySeconds,
        });
        return retryRelease;
      });
      // A failure decided as the session ended is not recorded; the end stopped the delivery.
      if (!failureRecording.executed) {
        attempt.cancel();
        return;
      }
      await failureRecording.result;
    }
  }

  /**
   * Posts the update to the webhook as the official Bot API server's `WebhookActor` does, and
   * returns how the attempt ended. The attempt is cancelled when `deliverySignal` aborts, or fails
   * once its deadline arrives, unless the webhook's complete response arrived first.
   *
   * As on Telegram, the webhook answers only once its whole response has arrived, so a response
   * whose body fails or does not arrive in time fails the attempt, whatever its status. A complete
   * successful response accepts the update through `acceptUpdate`, called with the response in the
   * same step as its body arrives, so that nothing done to the webhook meanwhile can overturn the
   * acceptance or have another delivery send the update again.
   *
   * A sender that ignores the attempt's signal cannot hold the attempt: its late response is
   * disposed of, and its late failure observed and ignored.
   *
   * Each attempt is recorded as a delivery of the update in the session's bot activity.
   */
  async #sendUpdate(
    botId: number,
    webhook: BotWebhook,
    update: BotApiUpdate,
    { attempt, deliverySignal, acceptUpdate }: {
      readonly attempt: WebhookAttemptHandle;
      readonly deliverySignal: AbortSignal;
      readonly acceptUpdate: (reply: Response) => void;
    },
  ): Promise<UpdateDeliveryOutcome> {
    const attemptSignal = AbortSignal.any([deliverySignal, attempt.deadlineSignal]);
    const request = createWebhookRequest(webhook, update, attemptSignal);
    const deliveryRecording = this.#transactions.execute(() =>
      this.#updateActivity.recordWebhookUpdateDelivery(botId, update, attempt.id)
    );
    // An update the session's end finds unsent is not sent at all.
    if (!deliveryRecording.executed) {
      return { outcome: 'cancelled' };
    }
    const responseArrival = await settleUnlessAborted(
      this.#sendWebhookRequest(request),
      attemptSignal,
      { disposeLateValue: disposeResponse },
    );
    if (responseArrival.settlement !== 'fulfilled') {
      // Telegram reports other failures to connect without their cause.
      return describeUnfinishedAttempt(responseArrival, deliverySignal, {
        reason: 'connection_failed',
        errorMessage: "Can't connect to the webhook",
      });
    }
    const response = responseArrival.value;
    const { status, statusText, headers } = response;
    const isSuccessful = status >= 200 && status <= 299;
    const bodyArrival = await settleUnlessAborted(response.arrayBuffer(), attemptSignal, {
      onFulfilledFirst: (body) => {
        if (isSuccessful) {
          acceptUpdate(
            new Response(body.byteLength === 0 ? null : body, { status, statusText, headers }),
          );
        }
      },
    });
    if (bodyArrival.settlement !== 'fulfilled') {
      // Telegram reports a response cut short by its connection closing without a description.
      return describeUnfinishedAttempt(bodyArrival, deliverySignal, {
        reason: 'response_interrupted',
      });
    }
    if (!isSuccessful) {
      return {
        outcome: 'failed',
        failure: {
          reason: 'http_error',
          statusCode: response.status,
          errorMessage:
            `Wrong response from the webhook: ${response.status} ${response.statusText}`,
        },
        retryAfterSeconds: readRetryAfterSeconds(response),
      };
    }
    return { outcome: 'accepted' };
  }
}

/**
 * Limits how many updates a webhook is sent at once, as `max_connections` limits the official Bot
 * API server's connections to it. Waiting queues take connections in the order they asked.
 */
class WebhookConnectionLimit {
  #availableConnectionCount: number;
  readonly #waitingAcquirers: Array<() => void> = [];

  constructor(maxConnections: number) {
    this.#availableConnectionCount = maxConnections;
  }

  /**
   * Resolves with the release of a connection once one is available, or with `undefined` when
   * `signal` aborts first.
   */
  acquire(signal: AbortSignal): Promise<(() => void) | undefined> {
    if (signal.aborted) {
      return Promise.resolve(undefined);
    }
    if (this.#availableConnectionCount > 0) {
      this.#availableConnectionCount--;
      return Promise.resolve(this.#createRelease());
    }
    return new Promise((resolve) => {
      const acquireConnection = () => {
        signal.removeEventListener('abort', giveUp);
        resolve(this.#createRelease());
      };
      const giveUp = () => {
        this.#waitingAcquirers.splice(this.#waitingAcquirers.indexOf(acquireConnection), 1);
        resolve(undefined);
      };
      this.#waitingAcquirers.push(acquireConnection);
      signal.addEventListener('abort', giveUp, { once: true });
    });
  }

  /** Creates the release of an acquired connection, which hands it to the longest waiting queue. */
  #createRelease(): () => void {
    let isReleased = false;
    return () => {
      if (isReleased) {
        return;
      }
      isReleased = true;
      const nextAcquirer = this.#waitingAcquirers.shift();
      if (nextAcquirer === undefined) {
        this.#availableConnectionCount++;
      } else {
        nextAcquirer();
      }
    };
  }
}

/**
 * Counts another failure of an update and returns how long to wait before sending it again, as
 * the official Bot API server's `WebhookActor::on_update_error` does. A positive `Retry-After`
 * sets the wait, up to an hour, and leaves the backoff delay as it is. Otherwise the first failure
 * is retried at once, and each later one after twice the previous backoff delay, starting at 2
 * seconds.
 */
function scheduleUpdateRetry(
  backoff: UpdateRetryBackoff,
  retryAfterSeconds: number,
): { readonly delaySeconds: number; readonly backoff: UpdateRetryBackoff } {
  const failureCount = backoff.failureCount + 1;
  if (retryAfterSeconds > 0) {
    return {
      delaySeconds: Math.min(retryAfterSeconds, MAX_RETRY_AFTER_SECONDS),
      backoff: { failureCount, delaySeconds: backoff.delaySeconds },
    };
  }
  if (backoff.failureCount === 0) {
    return { delaySeconds: 0, backoff: { failureCount, delaySeconds: backoff.delaySeconds } };
  }
  const delaySeconds = Math.min(MAX_RETRY_DELAY_SECONDS, backoff.delaySeconds * 2);
  return { delaySeconds, backoff: { failureCount, delaySeconds } };
}

/**
 * Reads the wait, in seconds, that a failed response asks for in its `Retry-After` header, as
 * TDLib's `HttpQuery::get_retry_after` does. Anything but a whole number of seconds, such as an
 * HTTP date, asks for none, which is 0.
 */
function readRetryAfterSeconds(response: Response): number {
  const retryAfter = response.headers.get('Retry-After') ?? '';
  if (!POSITIVE_RETRY_AFTER_PATTERN.test(retryAfter)) {
    return 0;
  }
  const retryAfterSeconds = Number(retryAfter);
  return retryAfterSeconds <= MAX_READABLE_RETRY_AFTER_SECONDS ? retryAfterSeconds : 0;
}

/**
 * Builds the POST request that delivers an update. As on Telegram, credentials in the URL become
 * a Basic `Authorization` header, and redirects are not followed, so they count as failures.
 */
function createWebhookRequest(
  webhook: BotWebhook,
  update: BotApiUpdate,
  signal: AbortSignal,
): Request {
  const url = parseWebhookUrl(webhook.url);
  if (url === undefined) {
    throw new Error(`Webhook URL ${webhook.url} was accepted but cannot be parsed`);
  }
  const headers = new Headers({ 'Content-Type': 'application/json' });
  if (url.username.length > 0 || url.password.length > 0) {
    const userInfo = url.password.length > 0 ? `${url.username}:${url.password}` : url.username;
    headers.set('Authorization', `Basic ${btoa(userInfo)}`);
    url.username = '';
    url.password = '';
  }
  if (webhook.secretToken.length > 0) {
    headers.set(SECRET_TOKEN_HEADER, webhook.secretToken);
  }
  return new Request(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(update),
    redirect: 'manual',
    signal,
  });
}

/** How a step of an attempt settled: with its value, by failing, or by its signal aborting first. */
type AttemptStepSettlement<T> =
  | { readonly settlement: 'fulfilled'; readonly value: T }
  | { readonly settlement: 'rejected' }
  | { readonly settlement: 'aborted'; readonly abortReason: unknown };

/**
 * Settles as `promise` does, unless `signal` aborts first. Whichever happens first decides the
 * settlement, at that moment: a value that arrives first is passed to `onFulfilledFirst` in the
 * same step, before anything else can run, so a later abort cannot overturn what the caller did
 * with it. The promise may keep running: a value it yields after the abort is passed to
 * `disposeLateValue`, and a later failure is observed and ignored.
 */
function settleUnlessAborted<T>(
  promise: Promise<T>,
  signal: AbortSignal,
  { onFulfilledFirst = () => {}, disposeLateValue = () => {} }: {
    readonly onFulfilledFirst?: (value: T) => void;
    readonly disposeLateValue?: (value: T) => void;
  } = {},
): Promise<AttemptStepSettlement<T>> {
  return new Promise((resolve) => {
    let isSettled = false;
    const settle = (settlement: AttemptStepSettlement<T>) => {
      isSettled = true;
      signal.removeEventListener('abort', settleByAbort);
      resolve(settlement);
    };
    const settleByAbort = () => settle({ settlement: 'aborted', abortReason: signal.reason });
    promise.then(
      (value) => {
        if (isSettled) {
          disposeLateValue(value);
        } else {
          settle({ settlement: 'fulfilled', value });
          onFulfilledFirst(value);
        }
      },
      () => {
        if (!isSettled) {
          settle({ settlement: 'rejected' });
        }
      },
    );
    if (signal.aborted) {
      settleByAbort();
    } else {
      signal.addEventListener('abort', settleByAbort, { once: true });
    }
  });
}

/**
 * Describes an attempt that ended before the webhook's complete response: cancelled if delivery
 * stopped first, timed out if its deadline arrived first, and otherwise failed with `failure`.
 */
function describeUnfinishedAttempt(
  settlement: Exclude<AttemptStepSettlement<unknown>, { readonly settlement: 'fulfilled' }>,
  deliverySignal: AbortSignal,
  failure: WebhookAttemptFailure,
): UpdateDeliveryOutcome {
  if (settlement.settlement === 'rejected') {
    return { outcome: 'failed', failure, retryAfterSeconds: 0 };
  }
  // The attempt's signal aborts with the reason of whichever of its signals aborted first.
  if (deliverySignal.aborted && settlement.abortReason === deliverySignal.reason) {
    return { outcome: 'cancelled' };
  }
  return {
    outcome: 'failed',
    failure: { reason: 'timed_out', errorMessage: READ_TIMEOUT_ERROR_MESSAGE },
    retryAfterSeconds: 0,
  };
}

/** Releases a response nobody will read, so that its sender's connection is not left open. */
function disposeResponse(response: Response): void {
  response.body?.cancel().catch(() => {});
}
