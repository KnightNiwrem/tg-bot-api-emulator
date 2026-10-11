import type { ChatDomainEvent } from '../types/chat_domain_event.ts';
import type { VirtualAccount } from '../types/virtual_account.ts';
import type { VirtualBot } from '../types/virtual_bot.ts';
import type { PrivateConversationKey } from '../types/virtual_chat.ts';

export type ChangeBotBlockResult =
  | { readonly applied: true }
  | { readonly applied: false; readonly reason: 'account_not_found' | 'bot_not_found' };

interface AccountLookup {
  getById(accountId: number): VirtualAccount | undefined;
}

interface BotLookup {
  getById(botId: number): VirtualBot | undefined;
}

interface BlockList {
  block(accountId: number, userId: number): boolean;
  unblock(accountId: number, userId: number): boolean;
}

/** The session's transactions: each change of a block runs in one, and emits its event into it. */
interface BotBlockingTransactions {
  /** Runs a command in the transaction of the command executing, or in one of its own. */
  withinTransaction<Result>(command: () => Result): Result;
  emit(event: ChatDomainEvent): void;
}

interface BotBlockingServiceDependencies {
  readonly accounts: AccountLookup;
  readonly bots: BotLookup;
  readonly blockedUsers: BlockList;
  /** Runs each change of a block as one transaction, which receives the change's event. */
  readonly transactions: BotBlockingTransactions;
  readonly currentUnixTimeSeconds: () => number;
}

/**
 * Lets an account block and unblock a bot, which Telegram calls stopping and restarting it. An
 * account may block a bot it never wrote to.
 *
 * Only a change is published, because Telegram notifies the bot only when the block changes;
 * blocking a blocked bot, or unblocking a bot that is not blocked, succeeds without effect.
 *
 * Each change runs as one transaction: the block list and the update the bot receives are
 * published together, or, should any step fail, not at all.
 */
export class BotBlockingService {
  readonly #accounts: AccountLookup;
  readonly #bots: BotLookup;
  readonly #blockedUsers: BlockList;
  readonly #transactions: BotBlockingTransactions;
  readonly #currentUnixTimeSeconds: () => number;

  constructor(
    { accounts, bots, blockedUsers, transactions, currentUnixTimeSeconds }:
      BotBlockingServiceDependencies,
  ) {
    this.#accounts = accounts;
    this.#bots = bots;
    this.#blockedUsers = blockedUsers;
    this.#transactions = transactions;
    this.#currentUnixTimeSeconds = currentUnixTimeSeconds;
  }

  blockBot(key: PrivateConversationKey): ChangeBotBlockResult {
    return this.#changeBotBlock(key, true);
  }

  unblockBot(key: PrivateConversationKey): ChangeBotBlockResult {
    return this.#changeBotBlock(key, false);
  }

  #changeBotBlock(
    { accountId, botId }: PrivateConversationKey,
    isBlocked: boolean,
  ): ChangeBotBlockResult {
    return this.#transactions.withinTransaction(() => {
      if (this.#accounts.getById(accountId) === undefined) {
        return { applied: false, reason: 'account_not_found' };
      }
      if (this.#bots.getById(botId) === undefined) {
        return { applied: false, reason: 'bot_not_found' };
      }

      const changed = isBlocked
        ? this.#blockedUsers.block(accountId, botId)
        : this.#blockedUsers.unblock(accountId, botId);
      if (changed) {
        this.#transactions.emit({
          type: 'bot_block_changed',
          accountId,
          botId,
          isBlocked,
          changedAtUnixSeconds: this.#currentUnixTimeSeconds(),
        });
      }
      return { applied: true };
    });
  }
}
