import type { VirtualAccount } from '../../types/virtual_account.ts';

export class AccountRepository {
  readonly #accountsById = new Map<number, VirtualAccount>();

  add(account: VirtualAccount): boolean {
    if (this.#accountsById.has(account.profile.id)) {
      return false;
    }
    this.#accountsById.set(account.profile.id, account);
    return true;
  }

  getById(id: number): VirtualAccount | undefined {
    return this.#accountsById.get(id);
  }
}
