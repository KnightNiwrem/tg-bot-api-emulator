import { type ChangeStaging, UNSTAGED_CHANGES } from '../transactions/staging/change_staging.ts';
import { TransactionalMap } from '../transactions/staging/transactional_collections.ts';
import type { BotCommand, BotCommandScope } from '../types/bot_command.ts';
import type { BotLanguageCode } from '../types/bot_language_code.ts';

/** Identifies one command list of a bot: its scope and language. */
export interface BotCommandListKey {
  readonly botId: number;
  readonly scope: BotCommandScope;
  readonly languageCode: BotLanguageCode;
}

/**
 * Stores each bot's command lists by scope and language. A list is stored only while it has
 * commands, as Telegram treats an empty list as no list.
 */
export class BotCommandRepository {
  readonly #staging: ChangeStaging;
  readonly #commandListsByBotId: TransactionalMap<
    number,
    TransactionalMap<string, readonly BotCommand[]>
  >;

  /** `staging` decides how the repository's writes take part in its session's transactions. */
  constructor(staging: ChangeStaging = UNSTAGED_CHANGES) {
    this.#staging = staging;
    this.#commandListsByBotId = new TransactionalMap(staging);
  }

  /** Replaces a command list; an empty list removes it. */
  setCommands(key: BotCommandListKey, commands: readonly BotCommand[]): void {
    const commandListsByKey = this.#commandListsByBotId.get(key.botId) ??
      new TransactionalMap<string, readonly BotCommand[]>(this.#staging);
    const listKey = serializeListKey(key);
    if (commands.length === 0) {
      commandListsByKey.delete(listKey);
    } else {
      commandListsByKey.set(listKey, commands.map((command) => ({ ...command })));
    }
    this.#commandListsByBotId.set(key.botId, commandListsByKey);
  }

  /** Returns a stored command list, or `undefined` if the scope and language have none. */
  getCommands(key: BotCommandListKey): readonly BotCommand[] | undefined {
    return this.#commandListsByBotId.get(key.botId)?.get(serializeListKey(key));
  }
}

function serializeListKey({ scope, languageCode }: BotCommandListKey): string {
  switch (scope.type) {
    case 'default':
    case 'all_private_chats':
    case 'all_group_chats':
    case 'all_chat_administrators':
      return `${scope.type}|${languageCode}`;
    case 'chat':
    case 'chat_administrators':
      return `${scope.type}:${scope.chatId}|${languageCode}`;
    case 'chat_member':
      return `${scope.type}:${scope.chatId}:${scope.userId}|${languageCode}`;
    default: {
      const unhandledScope: never = scope;
      throw new Error(`Unhandled bot command scope: ${JSON.stringify(unhandledScope)}`);
    }
  }
}
