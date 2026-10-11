import { assertEquals } from '@std/assert';
import { AccountRepository } from '../src/repositories/account.ts';
import { BlockedUserRepository } from '../src/repositories/blocked_user.ts';
import { BotRepository } from '../src/repositories/bot.ts';
import { TelegramIdentityRepository } from '../src/repositories/telegram_identity.ts';
import { BotBlockingService } from '../src/services/bot_blocking.ts';
import { VirtualUserService } from '../src/services/virtual_user.ts';
import type { ChatDomainEvent } from '../src/types/chat_domain_event.ts';
import { createVirtualAccount, createVirtualBot } from './support/virtual_users.ts';

Deno.test('BotBlockingService publishes only changes of a block', () => {
  const { virtualUsers, blockedUsers, publishedEvents, botBlocking, advanceClockSeconds } =
    createBotBlockingFixture();
  const account = createAccount(virtualUsers);
  const bot = createBot(virtualUsers);
  const key = { accountId: account.profile.id, botId: bot.profile.id };

  const results = [botBlocking.blockBot(key), botBlocking.blockBot(key)];
  if (!blockedUsers.isBlocked(account.profile.id, bot.profile.id)) {
    throw new Error('Expected the bot to be on the account block list');
  }
  advanceClockSeconds(9);
  results.push(botBlocking.unblockBot(key), botBlocking.unblockBot(key));

  if (results.some((result) => !result.applied)) {
    throw new Error(`Expected every change to apply, received ${JSON.stringify(results)}`);
  }
  assertEquals(
    publishedEvents,
    [
      { type: 'bot_block_changed', ...key, isBlocked: true, changedAtUnixSeconds: 1_700_000_000 },
      { type: 'bot_block_changed', ...key, isBlocked: false, changedAtUnixSeconds: 1_700_000_009 },
    ],
    'Expected one event per change',
  );
});

Deno.test('BotBlockingService blocks only bots, for known accounts', () => {
  const { virtualUsers, publishedEvents, botBlocking } = createBotBlockingFixture();
  const account = createAccount(virtualUsers);
  const otherAccount = createAccount(virtualUsers);
  const bot = createBot(virtualUsers);

  const cases = [
    [botBlocking.blockBot({ accountId: 999, botId: bot.profile.id }), 'account_not_found'],
    [botBlocking.unblockBot({ accountId: account.profile.id, botId: 999 }), 'bot_not_found'],
    [
      botBlocking.blockBot({ accountId: account.profile.id, botId: otherAccount.profile.id }),
      'bot_not_found',
    ],
  ] as const;
  for (const [result, expectedReason] of cases) {
    if (result.applied || result.reason !== expectedReason) {
      throw new Error(`Expected ${expectedReason}, received ${JSON.stringify(result)}`);
    }
  }
  if (publishedEvents.length !== 0) {
    throw new Error('Expected rejected changes not to be published');
  }
});

function createBotBlockingFixture() {
  const identities = new TelegramIdentityRepository();
  const accounts = new AccountRepository();
  const bots = new BotRepository();
  const blockedUsers = new BlockedUserRepository();
  const publishedEvents: ChatDomainEvent[] = [];
  let currentUnixTimeSeconds = 1_700_000_000;
  const botBlocking = new BotBlockingService({
    accounts,
    bots,
    blockedUsers,
    // The repositories are not staged, so each change runs as it is called.
    transactions: {
      withinTransaction: (command) => command(),
      emit: (event) => publishedEvents.push(event),
    },
    currentUnixTimeSeconds: () => currentUnixTimeSeconds,
  });
  return {
    virtualUsers: new VirtualUserService({ identities, accounts, bots }),
    blockedUsers,
    publishedEvents,
    botBlocking,
    advanceClockSeconds: (seconds: number) => {
      currentUnixTimeSeconds += seconds;
    },
  };
}

function createAccount(virtualUsers: VirtualUserService) {
  return createVirtualAccount(virtualUsers, { first_name: 'Ada' });
}

function createBot(virtualUsers: VirtualUserService) {
  return createVirtualBot(virtualUsers, { first_name: 'Test Bot', username: 'test_bot' });
}
