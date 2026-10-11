import { assertEquals } from '@std/assert';
import { AccountRepository } from '../src/repositories/account.ts';
import { BotRepository } from '../src/repositories/bot.ts';
import { TelegramIdentityRepository } from '../src/repositories/telegram_identity.ts';
import { VirtualUserService } from '../src/services/domain/virtual_user.ts';

Deno.test('VirtualUserService creates accounts and complete bots in one user ID sequence', () => {
  const { accounts, bots, virtualUsers } = createVirtualUserState();

  const accountResult = virtualUsers.createAccount({ first_name: 'Ada' });
  const botResult = virtualUsers.createBot({
    first_name: 'Test Bot',
    username: 'test_bot',
  });
  if (!accountResult.created || !botResult.created) {
    throw new Error('Expected account and bot creation to succeed');
  }
  if (
    accounts.getById(accountResult.account.profile.id) !== accountResult.account ||
    bots.getById(botResult.bot.profile.id) !== botResult.bot ||
    bots.getByToken(botResult.bot.token) !== botResult.bot
  ) {
    throw new Error('Expected created users to be stored in their respective repositories');
  }
  const expectedBotProfile = {
    id: 2,
    is_bot: true,
    first_name: 'Test Bot',
    username: 'test_bot',
    can_join_groups: true,
    can_read_all_group_messages: false,
    supports_inline_queries: false,
    can_connect_to_business: false,
    has_main_web_app: false,
    has_topics_enabled: false,
    allows_users_to_create_topics: false,
    can_manage_bots: false,
    supports_join_request_queries: false,
  };
  if (accountResult.account.profile.id !== 1) {
    throw new Error('Expected the next user ID and capability defaults in the bot profile');
  }
  assertEquals(
    botResult.bot.profile,
    expectedBotProfile,
    'Expected the next user ID and capability defaults in the bot profile',
  );
  if (!botResult.bot.token.startsWith(`${botResult.bot.profile.id}:`)) {
    throw new Error('Expected the bot token to be prefixed with its user ID');
  }
});

Deno.test('VirtualUserService reports global username conflicts without storing a user', () => {
  const { accounts, virtualUsers } = createVirtualUserState();

  const botResult = virtualUsers.createBot({
    first_name: 'Test Bot',
    username: 'shared_name',
  });
  if (!botResult.created) {
    throw new Error('Expected initial bot creation to succeed');
  }

  const accountResult = virtualUsers.createAccount({
    first_name: 'Ada',
    username: 'SHARED_NAME',
  });
  if (accountResult.created || accountResult.reason !== 'username_taken') {
    throw new Error('Expected the duplicate username to be rejected case-insensitively');
  }
  if (accounts.getById(2) !== undefined) {
    throw new Error('Expected a rejected account not to be stored');
  }
});

function createVirtualUserState(): {
  accounts: AccountRepository;
  bots: BotRepository;
  virtualUsers: VirtualUserService;
} {
  const identities = new TelegramIdentityRepository();
  const accounts = new AccountRepository();
  const bots = new BotRepository();
  return {
    accounts,
    bots,
    virtualUsers: new VirtualUserService({ identities, accounts, bots }),
  };
}
