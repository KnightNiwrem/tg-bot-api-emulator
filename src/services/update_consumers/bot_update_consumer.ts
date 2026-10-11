import {
  BOT_API_UPDATE_TYPES,
  type BotApiUpdateType,
  type BotApiWebhookInfo,
  DEFAULT_ALLOWED_UPDATE_TYPES,
  isListedUpdateType,
  resolveAllowedUpdateTypes,
} from '../../types/bot_api.ts';
import {
  type BotWebhook,
  hasOnlyWebhookSecretTokenCharacters,
  MAX_WEBHOOK_SECRET_TOKEN_LENGTH,
  parseWebhookUrl,
  type WebhookDeliveryError,
} from '../../types/bot_webhook.ts';
import type {
  GetUpdatesRequest as PollRequest,
  GetUpdatesResult as PollResult,
} from '../update_polling/bot_update_polling.ts';
import type { WebhookGeneration } from '../webhook_delivery/webhook_delivery.ts';

export interface SetWebhookRequest {
  /** Where to deliver updates; empty deletes the webhook. */
  readonly url: string;
  /** Ignored when `url` is empty. */
  readonly secretToken: string;
  /** Ignored when `url` is empty. */
  readonly maxConnections: number;
  /** Requested update type names; omitting them keeps the bot's current subscription. */
  readonly allowedUpdates?: readonly string[];
  readonly dropPendingUpdates: boolean;
}

export type SetWebhookResult =
  | {
    readonly accepted: true;
    readonly outcome:
      | 'webhook_set'
      | 'webhook_already_set'
      | 'webhook_deleted'
      | 'webhook_already_deleted';
  }
  | {
    readonly accepted: false;
    readonly reason: 'url_invalid' | 'secret_token_too_long' | 'secret_token_invalid';
  };

export interface DeleteWebhookRequest {
  readonly dropPendingUpdates: boolean;
}

export type DeleteWebhookOutcome = 'webhook_deleted' | 'webhook_already_deleted';

export interface GetUpdatesRequest extends PollRequest {
  /** Requested update type names; omitting them keeps the bot's current subscription. */
  readonly allowedUpdates?: readonly string[];
}

/** The result of `getUpdates`, which fails while the bot has a webhook. */
export type GetUpdatesResult =
  | PollResult
  | { readonly retrieved: false; readonly reason: 'webhook_active' };

interface WebhookRegistration {
  readonly webhook: BotWebhook;
  readonly lastDeliveryError?: WebhookDeliveryError;
}

interface BotWebhookStore {
  get(botId: number): WebhookRegistration | undefined;
  set(botId: number, webhook: BotWebhook): void;
  delete(botId: number): void;
}

interface PendingUpdateCounter {
  countPendingUpdates(botId: number): number;
  discardPendingUpdates(botId: number): void;
}

interface BotUpdateSubscriptionStore {
  getAllowedUpdateTypes(botId: number): ReadonlySet<BotApiUpdateType>;
  setAllowedUpdateTypes(botId: number, allowedUpdateTypes: ReadonlySet<BotApiUpdateType>): void;
}

/** Answers `getUpdates` requests, holding at most one long poll per bot. */
interface UpdatePolling {
  /** `changeOnArrival` runs in the transaction of the request's arrival. */
  getUpdates(
    botId: number,
    request: PollRequest,
    changeOnArrival: () => void,
  ): Promise<PollResult>;
  terminateLongPollForWebhook(botId: number): void;
}

/**
 * The session's transactions: each change of a bot's delivery runs in one, and what it starts or
 * stops beyond the session's state waits for its publication.
 */
interface UpdateConsumerTransactions {
  /** Runs a command in the transaction of the command executing, or in one of its own. */
  withinTransaction<Result>(command: () => Result): Result;
  runAfterPublication(effect: () => void): void;
}

/** Delivers a bot's pending updates to one webhook generation at a time. */
interface WebhookDelivery {
  startGeneration(botId: number, webhook: BotWebhook): WebhookGeneration;
}

/** The session's end, which stops every webhook generation, and its commit gate. */
interface SessionCommitGate {
  readonly endSignal: AbortSignal;
  readonly admitsCommits: boolean;
}

interface BotUpdateConsumerServiceDependencies {
  readonly webhooks: BotWebhookStore;
  readonly pendingUpdates: PendingUpdateCounter;
  readonly updateSubscriptions: BotUpdateSubscriptionStore;
  readonly polling: UpdatePolling;
  readonly webhookDelivery: WebhookDelivery;
  readonly sessionLifetime: SessionCommitGate;
  /** Runs each webhook change as one transaction, and its delivery's start or stop after it. */
  readonly transactions: UpdateConsumerTransactions;
}

/**
 * Owns how each bot receives its updates: its subscription, whether it polls with `getUpdates` or
 * has a webhook, and switching between the two, as the official Bot API server's `Client` decides
 * them for each bot.
 *
 * A bot with a webhook cannot poll. Setting a new webhook terminates the bot's held long poll and
 * starts a new generation of webhook delivery, stopping the previous one; deleting the webhook
 * stops its generation and leaves a held long poll running. Updates are confirmed by the consumer
 * that received them: a `getUpdates` offset, or the webhook's complete 2xx response. When the
 * session ends, every webhook generation stops, and nothing changes the bot's delivery again.
 */
export class BotUpdateConsumerService {
  readonly #webhooks: BotWebhookStore;
  readonly #pendingUpdates: PendingUpdateCounter;
  readonly #updateSubscriptions: BotUpdateSubscriptionStore;
  readonly #polling: UpdatePolling;
  readonly #webhookDelivery: WebhookDelivery;
  readonly #sessionLifetime: SessionCommitGate;
  readonly #transactions: UpdateConsumerTransactions;
  /** The running generation of each bot that has a webhook. */
  readonly #webhookGenerationsByBotId = new Map<number, WebhookGeneration>();

  constructor(
    {
      webhooks,
      pendingUpdates,
      updateSubscriptions,
      polling,
      webhookDelivery,
      sessionLifetime,
      transactions,
    }: BotUpdateConsumerServiceDependencies,
  ) {
    this.#webhooks = webhooks;
    this.#pendingUpdates = pendingUpdates;
    this.#updateSubscriptions = updateSubscriptions;
    this.#polling = polling;
    this.#webhookDelivery = webhookDelivery;
    this.#sessionLifetime = sessionLifetime;
    this.#transactions = transactions;
    sessionLifetime.endSignal.addEventListener('abort', () => this.#stopEveryWebhookGeneration(), {
      once: true,
    });
  }

  /**
   * Polls the bot's pending updates. As on Telegram, a bot with a webhook cannot poll, and its
   * subscription is left unchanged; otherwise the request changes the bot's subscription before
   * reading its queue, in the transaction of its arrival. The new subscription applies only to
   * updates created afterward; pending updates are still returned. Once the session has ended,
   * nothing changes.
   */
  async getUpdates(
    botId: number,
    { allowedUpdates, ...pollRequest }: GetUpdatesRequest,
  ): Promise<GetUpdatesResult> {
    if (!this.#sessionLifetime.admitsCommits) {
      return { retrieved: false, reason: 'session_ended' };
    }
    if (this.#webhooks.get(botId) !== undefined) {
      return { retrieved: false, reason: 'webhook_active' };
    }
    return await this.#polling.getUpdates(
      botId,
      pollRequest,
      () => this.#updateSubscription(botId, allowedUpdates),
    );
  }

  /**
   * Sets, replaces, or, with an empty URL, deletes the bot's webhook, as the official Bot API
   * server's `process_set_webhook_query` does. A request that changes nothing keeps the webhook
   * and its delivery error, and only changes the subscription. Otherwise a new generation of
   * delivery starts, the previous webhook's delivery error is forgotten, and the bot's held long
   * poll is terminated.
   *
   * Telegram validates the URL and secret token only after it has removed the previous webhook
   * and dropped pending updates; the emulator rejects them before changing anything.
   *
   * The change is one transaction. The generations it stops and starts, and the long poll it
   * terminates, follow its publication, so a change that aborts leaves delivery as it was.
   */
  setWebhook(botId: number, request: SetWebhookRequest): SetWebhookResult {
    return this.#transactions.withinTransaction(() => this.#setWebhook(botId, request));
  }

  /**
   * Deletes the bot's webhook, as `setWebhook` with an empty URL does, in one transaction. A held
   * long poll is left running, as on Telegram.
   */
  deleteWebhook(botId: number, { dropPendingUpdates }: DeleteWebhookRequest): DeleteWebhookOutcome {
    return this.#transactions.withinTransaction(() =>
      this.#removeWebhook(botId, { dropPendingUpdates })
    );
  }

  #setWebhook(botId: number, request: SetWebhookRequest): SetWebhookResult {
    if (request.url.length === 0) {
      return { accepted: true, outcome: this.#removeWebhook(botId, request) };
    }
    const requestedWebhook: BotWebhook = {
      url: request.url,
      secretToken: request.secretToken,
      maxConnections: request.maxConnections,
    };
    const rejectionReason = findWebhookRejectionReason(requestedWebhook);
    if (rejectionReason !== undefined) {
      return { accepted: false, reason: rejectionReason };
    }

    const currentWebhook = this.#webhooks.get(botId)?.webhook;
    if (
      currentWebhook !== undefined && isSameWebhook(currentWebhook, requestedWebhook) &&
      !request.dropPendingUpdates
    ) {
      this.#updateSubscription(botId, request.allowedUpdates);
      return { accepted: true, outcome: 'webhook_already_set' };
    }

    this.#transactions.runAfterPublication(() => this.#stopWebhookGeneration(botId));
    if (request.dropPendingUpdates) {
      this.#pendingUpdates.discardPendingUpdates(botId);
    }
    this.#webhooks.set(botId, requestedWebhook);
    this.#updateSubscription(botId, request.allowedUpdates);
    this.#transactions.runAfterPublication(() => {
      this.#startWebhookGeneration(botId, requestedWebhook);
      this.#polling.terminateLongPollForWebhook(botId);
    });
    return { accepted: true, outcome: 'webhook_set' };
  }

  getWebhookInfo(botId: number): BotApiWebhookInfo {
    const registration = this.#webhooks.get(botId);
    const allowedUpdateTypes = this.#updateSubscriptions.getAllowedUpdateTypes(botId);
    return {
      url: registration?.webhook.url ?? '',
      has_custom_certificate: false,
      pending_update_count: this.#pendingUpdates.countPendingUpdates(botId),
      ...(registration?.lastDeliveryError === undefined ? {} : {
        last_error_date: registration.lastDeliveryError.dateUnixSeconds,
        last_error_message: registration.lastDeliveryError.message,
      }),
      ...(registration === undefined
        ? {}
        : { max_connections: registration.webhook.maxConnections }),
      ...(isDefaultSubscription(allowedUpdateTypes) ? {} : {
        allowed_updates: BOT_API_UPDATE_TYPES.filter(isListedUpdateType).filter((updateType) =>
          allowedUpdateTypes.has(updateType)
        ),
      }),
    };
  }

  #removeWebhook(
    botId: number,
    { allowedUpdates, dropPendingUpdates }: {
      readonly allowedUpdates?: readonly string[];
      readonly dropPendingUpdates: boolean;
    },
  ): DeleteWebhookOutcome {
    const hadWebhook = this.#webhooks.get(botId) !== undefined;
    if (!hadWebhook && !dropPendingUpdates) {
      // Like any request that changes no webhook, this one changes the subscription on Telegram.
      this.#updateSubscription(botId, allowedUpdates);
      return 'webhook_already_deleted';
    }

    this.#transactions.runAfterPublication(() => this.#stopWebhookGeneration(botId));
    if (dropPendingUpdates) {
      this.#pendingUpdates.discardPendingUpdates(botId);
    }
    this.#webhooks.delete(botId);
    return hadWebhook ? 'webhook_deleted' : 'webhook_already_deleted';
  }

  #updateSubscription(botId: number, allowedUpdates: readonly string[] | undefined): void {
    if (allowedUpdates !== undefined) {
      this.#updateSubscriptions.setAllowedUpdateTypes(
        botId,
        resolveAllowedUpdateTypes(allowedUpdates),
      );
    }
  }

  /** Starts delivering to the bot's new webhook, unless the session has ended. */
  #startWebhookGeneration(botId: number, webhook: BotWebhook): void {
    if (this.#sessionLifetime.endSignal.aborted) {
      return;
    }
    this.#webhookGenerationsByBotId.set(
      botId,
      this.#webhookDelivery.startGeneration(botId, webhook),
    );
  }

  #stopWebhookGeneration(botId: number): void {
    this.#webhookGenerationsByBotId.get(botId)?.stop();
    this.#webhookGenerationsByBotId.delete(botId);
  }

  #stopEveryWebhookGeneration(): void {
    for (const botId of [...this.#webhookGenerationsByBotId.keys()]) {
      this.#stopWebhookGeneration(botId);
    }
  }
}

function findWebhookRejectionReason(
  webhook: BotWebhook,
): Extract<SetWebhookResult, { readonly accepted: false }>['reason'] | undefined {
  if (parseWebhookUrl(webhook.url) === undefined) {
    return 'url_invalid';
  }
  if (webhook.secretToken.length > MAX_WEBHOOK_SECRET_TOKEN_LENGTH) {
    return 'secret_token_too_long';
  }
  if (!hasOnlyWebhookSecretTokenCharacters(webhook.secretToken)) {
    return 'secret_token_invalid';
  }
  return undefined;
}

function isSameWebhook(first: BotWebhook, second: BotWebhook): boolean {
  return first.url === second.url && first.secretToken === second.secretToken &&
    first.maxConnections === second.maxConnections;
}

function isDefaultSubscription(allowedUpdateTypes: ReadonlySet<BotApiUpdateType>): boolean {
  return allowedUpdateTypes.size === DEFAULT_ALLOWED_UPDATE_TYPES.size &&
    [...allowedUpdateTypes].every((updateType) => DEFAULT_ALLOWED_UPDATE_TYPES.has(updateType));
}
