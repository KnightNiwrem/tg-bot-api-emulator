/**
 * Service-level setup of accounts and bots, for tests that create them through a
 * `VirtualUserService`, whether a root-backed session's or one a unit test constructs.
 */
import type {
  CreateVirtualAccountInput,
  CreateVirtualBotInput,
  VirtualUserService,
} from '../../src/services/domain/virtual_user.ts';
import type { VirtualAccount } from '../../src/types/virtual_account.ts';
import type { VirtualBot } from '../../src/types/virtual_bot.ts';

/**
 * Creates the account `input` describes, failing the test if `virtualUsers` refuses it, and
 * returns the created account.
 */
export function createVirtualAccount(
  virtualUsers: Pick<VirtualUserService, 'createAccount'>,
  input: CreateVirtualAccountInput,
): VirtualAccount {
  const creation = virtualUsers.createAccount(input);
  if (!creation.created) {
    throw new Error(`Expected account ${input.first_name} to be created: ${creation.reason}`);
  }
  return creation.account;
}

/**
 * Creates the bot `input` describes, failing the test if `virtualUsers` refuses it, and returns
 * the created bot.
 */
export function createVirtualBot(
  virtualUsers: Pick<VirtualUserService, 'createBot'>,
  input: CreateVirtualBotInput,
): VirtualBot {
  const creation = virtualUsers.createBot(input);
  if (!creation.created) {
    throw new Error(`Expected bot ${input.username} to be created: ${creation.reason}`);
  }
  return creation.bot;
}
