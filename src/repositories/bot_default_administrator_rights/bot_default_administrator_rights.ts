import { type ChangeStaging, UNSTAGED_CHANGES } from '../../transactions/staging/change_staging.ts';
import { TransactionalMap } from '../../transactions/staging/transactional_collections.ts';
import type {
  DefaultAdministratorRights,
  DefaultAdministratorRightsChatKind,
} from '../../types/bot_default_administrator_rights.ts';

/** Identifies the default administrator rights a bot asks for in one kind of chat. */
export interface BotDefaultAdministratorRightsKey {
  readonly botId: number;
  readonly kind: DefaultAdministratorRightsChatKind;
}

/**
 * Stores the rights each bot asks for by default in groups and channels. Rights are stored only
 * while there are some, as Telegram treats no rights as none set.
 */
export class BotDefaultAdministratorRightsRepository {
  readonly #rightsByKey: TransactionalMap<string, DefaultAdministratorRights>;

  /** `staging` decides how the repository's writes take part in its session's transactions. */
  constructor(staging: ChangeStaging = UNSTAGED_CHANGES) {
    this.#rightsByKey = new TransactionalMap(staging);
  }

  /** Replaces the rights; no rights removes them. */
  setRights(key: BotDefaultAdministratorRightsKey, rights: DefaultAdministratorRights): void {
    const serializedKey = serializeKey(key);
    if (rights.size === 0) {
      this.#rightsByKey.delete(serializedKey);
    } else {
      this.#rightsByKey.set(serializedKey, new Set(rights));
    }
  }

  /** Returns the stored rights, or `undefined` if the bot set none for the kind of chat. */
  getRights(key: BotDefaultAdministratorRightsKey): DefaultAdministratorRights | undefined {
    return this.#rightsByKey.get(serializeKey(key));
  }
}

function serializeKey({ botId, kind }: BotDefaultAdministratorRightsKey): string {
  return `${botId}|${kind}`;
}
