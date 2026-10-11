import { type ChangeStaging, UNSTAGED_CHANGES } from '../transactions/staging/change_staging.ts';
import { TransactionalMap } from '../transactions/staging/transactional_collections.ts';
import type { BotWebhook, WebhookDeliveryError } from '../types/bot_webhook.ts';

/** A bot's webhook and the latest failure to deliver to it, which setting a webhook forgets. */
export interface BotWebhookRegistration {
  readonly webhook: BotWebhook;
  readonly lastDeliveryError?: WebhookDeliveryError;
}

/** Owns the webhook of each bot that has one. */
export class BotWebhookRepository {
  readonly #registrationsByBotId: TransactionalMap<number, BotWebhookRegistration>;

  /** `staging` decides how the repository's writes take part in its session's transactions. */
  constructor(staging: ChangeStaging = UNSTAGED_CHANGES) {
    this.#registrationsByBotId = new TransactionalMap(staging);
  }

  get(botId: number): BotWebhookRegistration | undefined {
    return this.#registrationsByBotId.get(botId);
  }

  /** Sets the bot's webhook, replacing any earlier one along with its delivery error. */
  set(botId: number, webhook: BotWebhook): void {
    this.#registrationsByBotId.set(botId, { webhook });
  }

  delete(botId: number): void {
    this.#registrationsByBotId.delete(botId);
  }

  /** Records a failure to deliver to the bot's current webhook; ignored when it has none. */
  recordDeliveryError(botId: number, error: WebhookDeliveryError): void {
    const registration = this.#registrationsByBotId.get(botId);
    if (registration !== undefined) {
      this.#registrationsByBotId.set(botId, { ...registration, lastDeliveryError: error });
    }
  }
}
