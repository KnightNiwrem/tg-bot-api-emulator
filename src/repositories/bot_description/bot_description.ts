import { type ChangeStaging, UNSTAGED_CHANGES } from '../../transactions/staging/change_staging.ts';
import { TransactionalMap } from '../../transactions/staging/transactional_collections.ts';
import type { BotDescriptionKind } from '../../types/bot_description.ts';
import type { BotLanguageCode } from '../../types/bot_language_code.ts';

/** Identifies one text of a bot's profile: its kind and language. */
export interface BotDescriptionKey {
  readonly botId: number;
  readonly kind: BotDescriptionKind;
  readonly languageCode: BotLanguageCode;
}

/**
 * Stores each bot's descriptions and short descriptions by language. A text is stored only while
 * it is nonempty, as Telegram treats setting an empty text as removing it.
 */
export class BotDescriptionRepository {
  readonly #textsByKey: TransactionalMap<string, string>;

  /** `staging` decides how the repository's writes take part in its session's transactions. */
  constructor(staging: ChangeStaging = UNSTAGED_CHANGES) {
    this.#textsByKey = new TransactionalMap(staging);
  }

  /** Replaces a text; an empty text removes it. */
  setText(key: BotDescriptionKey, text: string): void {
    const serializedKey = serializeKey(key);
    if (text.length === 0) {
      this.#textsByKey.delete(serializedKey);
    } else {
      this.#textsByKey.set(serializedKey, text);
    }
  }

  /** Returns a stored text, or `undefined` if the kind and language have none. */
  getText(key: BotDescriptionKey): string | undefined {
    return this.#textsByKey.get(serializeKey(key));
  }
}

function serializeKey({ botId, kind, languageCode }: BotDescriptionKey): string {
  return `${botId}|${kind}|${languageCode}`;
}
