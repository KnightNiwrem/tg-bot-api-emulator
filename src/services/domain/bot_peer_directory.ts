import type { VirtualBot } from '../../types/virtual_bot.ts';

interface PublicChatLookup {
  findPublicChatId(username: string): number | undefined;
}

interface BotLookup {
  getById(botId: number): VirtualBot | undefined;
}

interface KnownBotPeerStore {
  addKnownPeer(botId: number, peerBotId: number): void;
  knowsPeer(botId: number, peerBotId: number): boolean;
}

interface BotPeerDirectoryTransactions {
  /** Runs a command in the transaction of the command executing, or in one of its own. */
  withinTransaction<Result>(command: () => Result): Result;
}

interface BotPeerDirectoryDependencies {
  readonly publicChats: PublicChatLookup;
  readonly bots: BotLookup;
  readonly knownBotPeers: KnownBotPeerStore;
  readonly transactions: BotPeerDirectoryTransactions;
}

/**
 * Resolves the public usernames a bot names chats by, and tells which other bots a bot knows, as
 * `KnownBotPeerRepository` describes knowing them.
 */
export class BotPeerDirectory {
  readonly #publicChats: PublicChatLookup;
  readonly #bots: BotLookup;
  readonly #knownBotPeers: KnownBotPeerStore;
  readonly #transactions: BotPeerDirectoryTransactions;

  constructor({ publicChats, bots, knownBotPeers, transactions }: BotPeerDirectoryDependencies) {
    this.#publicChats = publicChats;
    this.#bots = bots;
    this.#knownBotPeers = knownBotPeers;
    this.#transactions = transactions;
  }

  /**
   * Finds the ID of the chat a public username names for a bot, as the official server's
   * `check_chat` finds it with `searchPublicChat`: a public supergroup, or the private chat with a
   * bot. Resolving another bot's username lets the bot know that bot, as TDLib learns a user it
   * resolves, whatever the request then does with the chat. `undefined` for any other username.
   */
  resolvePublicChatId(botId: number, username: string): number | undefined {
    const chatId = this.#publicChats.findPublicChatId(username);
    if (chatId !== undefined && chatId !== botId && this.#bots.getById(chatId) !== undefined) {
      this.#transactions.withinTransaction(() => this.#knownBotPeers.addKnownPeer(botId, chatId));
    }
    return chatId;
  }

  /** Whether the bot knows the other bot, which it may then address by ID. */
  knowsPeer(botId: number, peerBotId: number): boolean {
    return this.#knownBotPeers.knowsPeer(botId, peerBotId);
  }
}
