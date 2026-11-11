import { type ChangeStaging, UNSTAGED_CHANGES } from '../../transactions/staging/change_staging.ts';
import { TransactionalSet } from '../../transactions/staging/transactional_collections.ts';

/**
 * The other bots each bot knows, which it may address by their IDs. A bot gets to know another
 * bot by resolving its username or by receiving a message from it. Knowing is one-way: a bot that
 * another bot knows need not know that bot.
 */
export class KnownBotPeerRepository {
  /** The pairs of a bot and a peer bot it knows, each as `getKnownPeerKey` writes it. */
  readonly #knownPeerKeys: TransactionalSet<string>;

  /** `staging` decides how the repository's writes take part in its session's transactions. */
  constructor(staging: ChangeStaging = UNSTAGED_CHANGES) {
    this.#knownPeerKeys = new TransactionalSet(staging);
  }

  /** Records that the bot knows the peer bot, which it may already know. */
  addKnownPeer(botId: number, peerBotId: number): void {
    this.#knownPeerKeys.add(getKnownPeerKey(botId, peerBotId));
  }

  knowsPeer(botId: number, peerBotId: number): boolean {
    return this.#knownPeerKeys.has(getKnownPeerKey(botId, peerBotId));
  }
}

function getKnownPeerKey(botId: number, peerBotId: number): string {
  return `${botId}:${peerBotId}`;
}
