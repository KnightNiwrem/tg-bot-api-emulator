import {
  type ChatAdministratorRightName,
  type DefaultAdministratorRights,
  type DefaultAdministratorRightsChatKind,
  normalizeDefaultAdministratorRights,
} from '../../types/bot_default_administrator_rights.ts';
import type { VirtualBot } from '../../types/virtual_bot.ts';

/** Addresses the default administrator rights a bot asks for in one kind of chat. */
export interface BotDefaultAdministratorRightsTarget {
  readonly botId: number;
  readonly kind: DefaultAdministratorRightsChatKind;
}

export interface SetBotDefaultAdministratorRightsInput extends BotDefaultAdministratorRightsTarget {
  /** The rights as the bot requested them; none to remove its default rights. */
  readonly requestedRights: Iterable<ChatAdministratorRightName>;
}

export type SetBotDefaultAdministratorRightsResult =
  | { readonly set: true }
  | { readonly set: false; readonly reason: 'bot_not_found' };

export type GetBotDefaultAdministratorRightsResult =
  | { readonly found: true; readonly rights: DefaultAdministratorRights }
  | { readonly found: false; readonly reason: 'bot_not_found' };

interface BotLookup {
  getById(botId: number): VirtualBot | undefined;
}

interface BotDefaultAdministratorRightsStore {
  setRights(key: BotDefaultAdministratorRightsTarget, rights: DefaultAdministratorRights): void;
  getRights(key: BotDefaultAdministratorRightsTarget): DefaultAdministratorRights | undefined;
}

interface BotDefaultAdministratorRightsServiceDependencies {
  readonly bots: BotLookup;
  readonly defaultAdministratorRights: BotDefaultAdministratorRightsStore;
}

/**
 * Keeps the rights each bot asks for by default when it is added to a group or channel as an
 * administrator, as `setMyDefaultAdministratorRights` and `getMyDefaultAdministratorRights` manage
 * them. The emulator has no workflow that grants them; bots and tests read them back.
 */
export class BotDefaultAdministratorRightsService {
  readonly #bots: BotLookup;
  readonly #defaultAdministratorRights: BotDefaultAdministratorRightsStore;

  constructor(
    { bots, defaultAdministratorRights }: BotDefaultAdministratorRightsServiceDependencies,
  ) {
    this.#bots = bots;
    this.#defaultAdministratorRights = defaultAdministratorRights;
  }

  /**
   * Replaces the bot's default rights for a kind of chat with the requested ones, normalized as
   * TDLib normalizes them for supergroups or channels.
   */
  setDefaultAdministratorRights(
    { requestedRights, ...target }: SetBotDefaultAdministratorRightsInput,
  ): SetBotDefaultAdministratorRightsResult {
    if (this.#bots.getById(target.botId) === undefined) {
      return { set: false, reason: 'bot_not_found' };
    }
    this.#defaultAdministratorRights.setRights(
      target,
      normalizeDefaultAdministratorRights(target.kind, requestedRights),
    );
    return { set: true };
  }

  /** Returns the bot's default rights for a kind of chat; none if it set none. */
  getDefaultAdministratorRights(
    target: BotDefaultAdministratorRightsTarget,
  ): GetBotDefaultAdministratorRightsResult {
    if (this.#bots.getById(target.botId) === undefined) {
      return { found: false, reason: 'bot_not_found' };
    }
    return {
      found: true,
      rights: this.#defaultAdministratorRights.getRights(target) ?? new Set(),
    };
  }
}
