import { cleanInputString } from '../../text_entities/input_string.ts';
import type { BotDescriptionKind } from '../../types/bot_description.ts';
import { type BotLanguageCode, isBotLanguageCode } from '../../types/bot_language_code.ts';
import type { VirtualBot } from '../../types/virtual_bot.ts';

/** Addresses one text of a bot's profile: a description or short description in a language. */
export interface BotDescriptionTarget {
  readonly botId: number;
  readonly kind: BotDescriptionKind;
  readonly languageCode: BotLanguageCode;
}

export interface SetBotDescriptionInput extends BotDescriptionTarget {
  /** The text as the bot specified it; empty to remove the text for the language. */
  readonly text: string;
}

/** Why a text is rejected, in the order Telegram checks it. */
export type SetBotDescriptionFailureReason =
  | 'bot_not_found'
  | 'text_not_utf8'
  | 'language_code_invalid';

export type SetBotDescriptionResult =
  | { readonly set: true }
  | { readonly set: false; readonly reason: SetBotDescriptionFailureReason };

export type GetBotDescriptionResult =
  | { readonly found: true; readonly text: string }
  | { readonly found: false; readonly reason: 'bot_not_found' | 'language_code_invalid' };

interface BotLookup {
  getById(botId: number): VirtualBot | undefined;
}

interface BotDescriptionStore {
  setText(key: BotDescriptionTarget, text: string): void;
  getText(key: BotDescriptionTarget): string | undefined;
}

interface BotDescriptionServiceDependencies {
  readonly bots: BotLookup;
  readonly botDescriptions: BotDescriptionStore;
}

/**
 * Keeps each bot's description and short description by language, as `setMyDescription`,
 * `getMyDescription`, `setMyShortDescription`, and `getMyShortDescription` manage them.
 */
export class BotDescriptionService {
  readonly #bots: BotLookup;
  readonly #botDescriptions: BotDescriptionStore;

  constructor({ bots, botDescriptions }: BotDescriptionServiceDependencies) {
    this.#bots = bots;
    this.#botDescriptions = botDescriptions;
  }

  /**
   * Replaces the bot's text of a kind for a language; an empty text removes it. The text is
   * cleaned of control characters but not trimmed, and checked before the language, as TDLib's
   * `setBotInfoDescription` and `setBotInfoShortDescription` requests do. Telegram's server then
   * limits the text's length.
   */
  setBotDescription({ text, ...target }: SetBotDescriptionInput): SetBotDescriptionResult {
    if (this.#bots.getById(target.botId) === undefined) {
      return { set: false, reason: 'bot_not_found' };
    }
    const cleanedText = cleanInputString(text);
    if (cleanedText === undefined) {
      return { set: false, reason: 'text_not_utf8' };
    }
    if (!isBotLanguageCode(target.languageCode)) {
      return { set: false, reason: 'language_code_invalid' };
    }
    this.#botDescriptions.setText(target, cleanedText);
    return { set: true };
  }

  /**
   * Returns the bot's text of a kind for exactly this language, without falling back to the text
   * for users without a dedicated one; empty if the language has none.
   */
  getBotDescription(target: BotDescriptionTarget): GetBotDescriptionResult {
    if (this.#bots.getById(target.botId) === undefined) {
      return { found: false, reason: 'bot_not_found' };
    }
    if (!isBotLanguageCode(target.languageCode)) {
      return { found: false, reason: 'language_code_invalid' };
    }
    return { found: true, text: this.#botDescriptions.getText(target) ?? '' };
  }
}
