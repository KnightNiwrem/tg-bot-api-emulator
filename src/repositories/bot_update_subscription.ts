import { type ChangeStaging, UNSTAGED_CHANGES } from '../transactions/staging/change_staging.ts';
import { TransactionalMap } from '../transactions/staging/transactional_collections.ts';
import { type BotApiUpdateType, DEFAULT_ALLOWED_UPDATE_TYPES } from '../types/bot_api.ts';

/** Owns the update types each bot has subscribed to through `allowed_updates`. */
export class BotUpdateSubscriptionRepository {
  readonly #allowedUpdateTypesByBotId: TransactionalMap<number, ReadonlySet<BotApiUpdateType>>;

  /** `staging` decides how the repository's writes take part in its session's transactions. */
  constructor(staging: ChangeStaging = UNSTAGED_CHANGES) {
    this.#allowedUpdateTypesByBotId = new TransactionalMap(staging);
  }

  /** Returns the default subscription for a bot that has never chosen one. */
  getAllowedUpdateTypes(botId: number): ReadonlySet<BotApiUpdateType> {
    return this.#allowedUpdateTypesByBotId.get(botId) ?? DEFAULT_ALLOWED_UPDATE_TYPES;
  }

  setAllowedUpdateTypes(botId: number, allowedUpdateTypes: ReadonlySet<BotApiUpdateType>): void {
    this.#allowedUpdateTypesByBotId.set(botId, allowedUpdateTypes);
  }
}
