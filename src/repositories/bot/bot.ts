import type { VirtualBot } from '../../types/virtual_bot.ts';

export class BotRepository {
  readonly #botsById = new Map<number, VirtualBot>();
  readonly #botsByToken = new Map<string, VirtualBot>();

  add(bot: VirtualBot): boolean {
    if (this.#botsById.has(bot.profile.id) || this.#botsByToken.has(bot.token)) {
      return false;
    }
    this.#botsById.set(bot.profile.id, bot);
    this.#botsByToken.set(bot.token, bot);
    return true;
  }

  getById(id: number): VirtualBot | undefined {
    return this.#botsById.get(id);
  }

  getByToken(token: string): VirtualBot | undefined {
    return this.#botsByToken.get(token);
  }
}
