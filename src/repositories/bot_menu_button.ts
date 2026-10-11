import { type ChangeStaging, UNSTAGED_CHANGES } from '../transactions/change_staging.ts';
import { TransactionalMap } from '../transactions/transactional_collections.ts';
import type { BotMenuButton } from '../types/bot_menu_button.ts';

/**
 * Identifies a menu button of a bot: the one for all its private chats, or the one for its private
 * chat with a user.
 */
export interface BotMenuButtonKey {
  readonly botId: number;
  /** Omitted for the button of all the bot's private chats. */
  readonly userId?: number;
}

/**
 * Stores each bot's chosen menu buttons. A button is stored only while it is a specific choice,
 * as choosing the default button removes the choice.
 */
export class BotMenuButtonRepository {
  readonly #menuButtonsByKey: TransactionalMap<string, BotMenuButton>;

  /** `staging` decides how the repository's writes take part in its session's transactions. */
  constructor(staging: ChangeStaging = UNSTAGED_CHANGES) {
    this.#menuButtonsByKey = new TransactionalMap(staging);
  }

  /** Replaces a menu button; the default button removes the choice. */
  setMenuButton(key: BotMenuButtonKey, menuButton: BotMenuButton): void {
    const serializedKey = serializeKey(key);
    if (menuButton.kind === 'default') {
      this.#menuButtonsByKey.delete(serializedKey);
    } else {
      this.#menuButtonsByKey.set(serializedKey, menuButton);
    }
  }

  /** Returns a chosen menu button, or `undefined` if none is chosen. */
  getMenuButton(key: BotMenuButtonKey): BotMenuButton | undefined {
    return this.#menuButtonsByKey.get(serializeKey(key));
  }
}

function serializeKey({ botId, userId }: BotMenuButtonKey): string {
  return userId === undefined ? `${botId}` : `${botId}|${userId}`;
}
