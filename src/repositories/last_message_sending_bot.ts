/**
 * The bot that last sent a content message to each supergroup, which alone of the supergroup's bots
 * in privacy mode receives commands without a username there, as Telegram's Bot FAQ describes.
 * Only bots' own new content messages count: not their edits, an account's message sent through an
 * inline bot, nor a service message a bot causes.
 */
export class LastMessageSendingBotRepository {
  readonly #botIdsBySupergroupId = new Map<number, number>();

  /** Records the bot as the last one to send a content message to the supergroup. */
  recordMessageSendingBot(supergroupId: number, botId: number): void {
    this.#botIdsBySupergroupId.set(supergroupId, botId);
  }

  /** Returns `undefined` while no bot has sent a content message to the supergroup. */
  getLastMessageSendingBotId(supergroupId: number): number | undefined {
    return this.#botIdsBySupergroupId.get(supergroupId);
  }
}
