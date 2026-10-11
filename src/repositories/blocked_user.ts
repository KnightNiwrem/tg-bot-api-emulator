import { type ChangeStaging, UNSTAGED_CHANGES } from '../transactions/staging/change_staging.ts';
import {
  TransactionalMap,
  TransactionalSet,
} from '../transactions/staging/transactional_collections.ts';

/** Each account's block list: the users, such as bots, whose messages it refuses. */
export class BlockedUserRepository {
  readonly #staging: ChangeStaging;
  readonly #blockedUserIdsByAccountId: TransactionalMap<number, TransactionalSet<number>>;

  /** `staging` decides how the repository's writes take part in its session's transactions. */
  constructor(staging: ChangeStaging = UNSTAGED_CHANGES) {
    this.#staging = staging;
    this.#blockedUserIdsByAccountId = new TransactionalMap(staging);
  }

  /** Adds the user to the account's block list; returns whether the account did not block it. */
  block(accountId: number, userId: number): boolean {
    const blockedUserIds = this.#blockedUserIdsByAccountId.get(accountId) ??
      new TransactionalSet<number>(this.#staging);
    if (blockedUserIds.has(userId)) {
      return false;
    }
    blockedUserIds.add(userId);
    this.#blockedUserIdsByAccountId.set(accountId, blockedUserIds);
    return true;
  }

  /** Removes the user from the account's block list; returns whether the account blocked it. */
  unblock(accountId: number, userId: number): boolean {
    return this.#blockedUserIdsByAccountId.get(accountId)?.delete(userId) ?? false;
  }

  isBlocked(accountId: number, userId: number): boolean {
    return this.#blockedUserIdsByAccountId.get(accountId)?.has(userId) ?? false;
  }
}
