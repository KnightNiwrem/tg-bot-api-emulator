import { AccountRepository } from '../src/repositories/account/account.ts';
import type { VirtualAccount } from '../src/types/virtual_account.ts';

Deno.test('AccountRepository adds and retrieves an account without overwriting its ID', () => {
  const accounts = new AccountRepository();
  const account: VirtualAccount = {
    profile: {
      id: 1,
      is_bot: false,
      first_name: 'Ada',
    },
    hasPrivateForwards: false,
  };

  if (!accounts.add(account)) {
    throw new Error('Expected the account to be added');
  }
  if (accounts.getById(account.profile.id) !== account) {
    throw new Error('Expected ID lookup to return the added account');
  }
  if (accounts.add(account)) {
    throw new Error('Expected a duplicate account ID not to overwrite the stored account');
  }
});
