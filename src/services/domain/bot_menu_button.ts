import { cleanInputString } from '../../text_entities/input_string.ts';
import { checkLink } from '../../text_entities/telegram_link.ts';
import { type BotMenuButton, DEFAULT_BOT_MENU_BUTTON } from '../../types/bot_menu_button.ts';
import type { VirtualAccount } from '../../types/virtual_account.ts';
import type { VirtualBot } from '../../types/virtual_bot.ts';
import type { PrivateConversationKey } from '../../types/virtual_chat.ts';

/** Addresses a bot's menu button for all its private chats, or for its chat with one user. */
export interface BotMenuButtonTarget {
  readonly botId: number;
  /** Omitted for the button of all the bot's private chats. */
  readonly userId?: number;
}

export interface SetBotMenuButtonInput extends BotMenuButtonTarget {
  /** The button as the bot specified it, before Telegram cleans and checks it. */
  readonly menuButton: BotMenuButton;
}

/** Why a user cannot be addressed or a button is rejected, in the order Telegram checks them. */
export type SetBotMenuButtonFailureReason =
  | 'bot_not_found'
  | 'user_not_found'
  | 'menu_button_text_empty'
  | 'menu_button_text_not_utf8'
  | 'menu_button_url_not_utf8'
  | 'web_app_url_invalid';

export type SetBotMenuButtonResult =
  | { readonly set: true }
  | {
    readonly set: false;
    readonly reason: Exclude<SetBotMenuButtonFailureReason, 'web_app_url_invalid'>;
  }
  | {
    readonly set: false;
    readonly reason: 'web_app_url_invalid';
    /** TDLib's description of the invalid URL. */
    readonly urlError: string;
  };

export type GetBotMenuButtonResult =
  | { readonly found: true; readonly menuButton: BotMenuButton }
  | { readonly found: false; readonly reason: 'bot_not_found' | 'user_not_found' };

export type GetPrivateChatMenuButtonResult =
  | { readonly found: true; readonly menuButton: BotMenuButton }
  | { readonly found: false; readonly reason: 'account_not_found' | 'bot_not_found' };

interface AccountLookup {
  getById(accountId: number): VirtualAccount | undefined;
}

interface BotLookup {
  getById(botId: number): VirtualBot | undefined;
}

interface BotMenuButtonStore {
  setMenuButton(key: BotMenuButtonTarget, menuButton: BotMenuButton): void;
  getMenuButton(key: BotMenuButtonTarget): BotMenuButton | undefined;
}

interface BotMenuButtonServiceDependencies {
  readonly accounts: AccountLookup;
  readonly bots: BotLookup;
  readonly menuButtons: BotMenuButtonStore;
}

/**
 * Keeps the menu buttons each bot chooses for all its private chats and for its chats with
 * particular users, as `setChatMenuButton` and `getChatMenuButton` manage them, and resolves the
 * button an account's client shows in its private chat with the bot.
 *
 * A bot addresses a user by the account's ID; bots are not addressable users.
 */
export class BotMenuButtonService {
  readonly #accounts: AccountLookup;
  readonly #bots: BotLookup;
  readonly #menuButtons: BotMenuButtonStore;

  constructor({ accounts, bots, menuButtons }: BotMenuButtonServiceDependencies) {
    this.#accounts = accounts;
    this.#bots = bots;
    this.#menuButtons = menuButtons;
  }

  /**
   * Replaces the bot's menu button for all its private chats or for its chat with a user; the
   * default button removes the choice. A Web App button's text and URL are cleaned, and its URL
   * must be a valid HTTPS link, which is stored normalized, as TDLib's `set_menu_button` checks
   * them.
   */
  setBotMenuButton({ menuButton, ...target }: SetBotMenuButtonInput): SetBotMenuButtonResult {
    const targetFailure = this.#checkTarget(target);
    if (targetFailure !== undefined) {
      return { set: false, reason: targetFailure };
    }
    const normalization = normalizeMenuButton(menuButton);
    if (!normalization.normalized) {
      return { set: false, ...normalization.failure };
    }
    this.#menuButtons.setMenuButton(target, normalization.menuButton);
    return { set: true };
  }

  /**
   * Returns the bot's menu button for all its private chats, or the one for its chat with a user,
   * which is the button for all chats unless the bot chose one for that chat.
   */
  getBotMenuButton(target: BotMenuButtonTarget): GetBotMenuButtonResult {
    const targetFailure = this.#checkTarget(target);
    if (targetFailure !== undefined) {
      return { found: false, reason: targetFailure };
    }
    return { found: true, menuButton: this.#findMenuButton(target) };
  }

  /** Returns the menu button an account's client shows in its private chat with the bot. */
  getPrivateChatMenuButton(
    { accountId, botId }: PrivateConversationKey,
  ): GetPrivateChatMenuButtonResult {
    if (this.#accounts.getById(accountId) === undefined) {
      return { found: false, reason: 'account_not_found' };
    }
    if (this.#bots.getById(botId) === undefined) {
      return { found: false, reason: 'bot_not_found' };
    }
    return { found: true, menuButton: this.#findMenuButton({ botId, userId: accountId }) };
  }

  #findMenuButton({ botId, userId }: BotMenuButtonTarget): BotMenuButton {
    return (userId === undefined
      ? undefined
      : this.#menuButtons.getMenuButton({ botId, userId })) ??
      this.#menuButtons.getMenuButton({ botId }) ?? DEFAULT_BOT_MENU_BUTTON;
  }

  #checkTarget(
    { botId, userId }: BotMenuButtonTarget,
  ): 'bot_not_found' | 'user_not_found' | undefined {
    if (this.#bots.getById(botId) === undefined) {
      return 'bot_not_found';
    }
    if (userId !== undefined && this.#accounts.getById(userId) === undefined) {
      return 'user_not_found';
    }
    return undefined;
  }
}

type MenuButtonNormalization =
  | { readonly normalized: true; readonly menuButton: BotMenuButton }
  | {
    readonly normalized: false;
    readonly failure:
      | { readonly reason: Exclude<SetBotMenuButtonFailureReason, 'web_app_url_invalid'> }
      | { readonly reason: 'web_app_url_invalid'; readonly urlError: string };
  };

/** Cleans and checks a menu button as TDLib's `set_menu_button` does. */
function normalizeMenuButton(menuButton: BotMenuButton): MenuButtonNormalization {
  if (menuButton.kind !== 'web_app') {
    return { normalized: true, menuButton };
  }
  // TDLib represents the default button as a Web App button without text whose URL is "default",
  // so a Web App button specified that way is the default button.
  if (menuButton.text.length === 0) {
    return menuButton.url === 'default'
      ? { normalized: true, menuButton: DEFAULT_BOT_MENU_BUTTON }
      : { normalized: false, failure: { reason: 'menu_button_text_empty' } };
  }
  const text = cleanInputString(menuButton.text);
  if (text === undefined) {
    return { normalized: false, failure: { reason: 'menu_button_text_not_utf8' } };
  }
  const url = cleanInputString(menuButton.url);
  if (url === undefined) {
    return { normalized: false, failure: { reason: 'menu_button_url_not_utf8' } };
  }
  const urlCheck = checkLink(url, { httpsOnly: true });
  if (!urlCheck.valid) {
    return {
      normalized: false,
      failure: { reason: 'web_app_url_invalid', urlError: urlCheck.error },
    };
  }
  return { normalized: true, menuButton: { kind: 'web_app', text, url: urlCheck.url } };
}
