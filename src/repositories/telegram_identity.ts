import { type ChangeStaging, UNSTAGED_CHANGES } from '../transactions/staging/change_staging.ts';
import { TransactionalMap } from '../transactions/staging/transactional_collections.ts';
import {
  MAX_SUPERGROUP_OR_CHANNEL_ID,
  MAX_TELEGRAM_USER_ID,
  MIN_SUPERGROUP_OR_CHANNEL_ID,
  MIN_TELEGRAM_USER_ID,
} from '../types/telegram_identity.ts';

const LOWEST_BASIC_GROUP_ID = -999_999_999_999;
const HIGHEST_BASIC_GROUP_ID = -1;

export type TelegramIdentity =
  | {
    readonly kind: 'account';
    readonly id: number;
    readonly username?: string;
  }
  | {
    readonly kind: 'bot';
    readonly id: number;
    readonly username: string;
  }
  | {
    readonly kind: 'basic_group';
    readonly id: number;
  }
  | {
    readonly kind: 'supergroup';
    readonly id: number;
    readonly username?: string;
  }
  | {
    readonly kind: 'channel';
    readonly id: number;
    readonly username?: string;
  };

export type IdentityReservationInput =
  | {
    readonly kind: 'account';
    readonly username?: string;
  }
  | {
    readonly kind: 'bot';
    readonly username: string;
  }
  | {
    readonly kind: 'basic_group';
  }
  | {
    readonly kind: 'supergroup';
    readonly username?: string;
  }
  | {
    readonly kind: 'channel';
    readonly username?: string;
  };

export type IdentityReservationFailureReason =
  | 'username_taken'
  | 'identity_limit_reached';

export type IdentityReservationResult =
  | {
    readonly reserved: true;
    readonly identity: TelegramIdentity;
  }
  | {
    readonly reserved: false;
    readonly reason: IdentityReservationFailureReason;
  };

/**
 * Reserves the IDs and usernames of a session's users and chats. A reservation that a transaction
 * aborts frees its username and its ID, which the next reservation of its kind takes.
 */
export class TelegramIdentityRepository {
  readonly #staging: ChangeStaging;
  readonly #identitiesById: TransactionalMap<number, TelegramIdentity>;
  readonly #identitiesByNormalizedUsername: TransactionalMap<string, TelegramIdentity>;
  #nextUserId = MIN_TELEGRAM_USER_ID;
  #nextBasicGroupId = HIGHEST_BASIC_GROUP_ID;
  #nextSupergroupOrChannelId = MAX_SUPERGROUP_OR_CHANNEL_ID;

  /** `staging` decides how the repository's writes take part in its session's transactions. */
  constructor(staging: ChangeStaging = UNSTAGED_CHANGES) {
    this.#staging = staging;
    this.#identitiesById = new TransactionalMap(staging);
    this.#identitiesByNormalizedUsername = new TransactionalMap(staging);
  }

  reserveIdentity(input: IdentityReservationInput): IdentityReservationResult {
    const username = 'username' in input ? input.username : undefined;
    const normalizedUsername = username?.toLowerCase();
    if (
      normalizedUsername !== undefined &&
      this.#identitiesByNormalizedUsername.has(normalizedUsername)
    ) {
      return { reserved: false, reason: 'username_taken' };
    }
    const id = this.#allocateId(input.kind);
    if (id === undefined) {
      return { reserved: false, reason: 'identity_limit_reached' };
    }

    const identity: TelegramIdentity = { id, ...input };
    this.#identitiesById.set(id, identity);
    if (normalizedUsername !== undefined) {
      this.#identitiesByNormalizedUsername.set(normalizedUsername, identity);
    }

    return { reserved: true, identity };
  }

  getById(identityId: number): TelegramIdentity | undefined {
    return this.#identitiesById.get(identityId);
  }

  getByUsername(username: string): TelegramIdentity | undefined {
    return this.#identitiesByNormalizedUsername.get(username.toLowerCase());
  }

  #allocateId(kind: TelegramIdentity['kind']): number | undefined {
    switch (kind) {
      case 'account':
      case 'bot': {
        if (this.#nextUserId > MAX_TELEGRAM_USER_ID) {
          return undefined;
        }
        const id = this.#nextUserId++;
        this.#staging.recordRevert(() => {
          this.#nextUserId = id;
        });
        return id;
      }
      case 'basic_group': {
        if (this.#nextBasicGroupId < LOWEST_BASIC_GROUP_ID) {
          return undefined;
        }
        const id = this.#nextBasicGroupId--;
        this.#staging.recordRevert(() => {
          this.#nextBasicGroupId = id;
        });
        return id;
      }
      case 'supergroup':
      case 'channel': {
        if (this.#nextSupergroupOrChannelId < MIN_SUPERGROUP_OR_CHANNEL_ID) {
          return undefined;
        }
        const id = this.#nextSupergroupOrChannelId--;
        this.#staging.recordRevert(() => {
          this.#nextSupergroupOrChannelId = id;
        });
        return id;
      }
    }
  }
}
