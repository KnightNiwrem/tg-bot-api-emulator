import { type ChangeStaging, UNSTAGED_CHANGES } from '../transactions/change_staging.ts';
import { TransactionalMap } from '../transactions/transactional_collections.ts';

/**
 * The bot that last sent a content message to each supergroup, which alone of the supergroup's bots
 * in privacy mode receives commands without a username there, as Telegram's Bot FAQ describes.
 * Only bots' own new content messages count: not their edits, an account's message sent through an
 * inline bot, nor a service message a bot causes.
 */
export class LastMessageSendingBotRepository {
  readonly #botIdsBySupergroupId: TransactionalMap<number, number>;

  /** `staging` decides how the repository's writes take part in its session's transactions. */
  constructor(staging: ChangeStaging = UNSTAGED_CHANGES) {
    this.#botIdsBySupergroupId = new TransactionalMap(staging);
  }

  /** Records the bot as the last one to send a content message to the supergroup. */
  recordMessageSendingBot(supergroupId: number, botId: number): void {
    this.#botIdsBySupergroupId.set(supergroupId, botId);
  }

  /** Returns `undefined` while no bot has sent a content message to the supergroup. */
  getLastMessageSendingBotId(supergroupId: number): number | undefined {
    return this.#botIdsBySupergroupId.get(supergroupId);
  }
}
