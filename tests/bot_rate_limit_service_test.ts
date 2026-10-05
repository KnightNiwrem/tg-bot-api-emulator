import { AccountRepository } from '../src/repositories/account.ts';
import { BotRepository } from '../src/repositories/bot.ts';
import { QueuedBotApiAnswerRepository } from '../src/repositories/queued_bot_api_answer.ts';
import { TelegramIdentityRepository } from '../src/repositories/telegram_identity.ts';
import { BotRateLimitService } from '../src/services/bot_rate_limit.ts';
import { VirtualUserService } from '../src/services/virtual_user.ts';

Deno.test('BotRateLimitService answers the next matching calls in queue order', () => {
  const { virtualUsers, botRateLimits } = createBotRateLimitFixture();
  const botId = createBot(virtualUsers, 'first_bot');
  const otherBotId = createBot(virtualUsers, 'second_bot');

  botRateLimits.queueRateLimitResponses(botId, {
    methodName: 'sendMessage',
    retryAfterSeconds: 3,
    remainingCount: 2,
  });
  botRateLimits.queueRateLimitResponses(botId, { retryAfterSeconds: 7, remainingCount: 1 });

  const retryAfterSeconds = [
    botRateLimits.takeRateLimitResponse(otherBotId, 'sendMessage'),
    botRateLimits.takeRateLimitResponse(botId, 'sendMessage'),
    botRateLimits.takeRateLimitResponse(botId, 'getMe'),
    botRateLimits.takeRateLimitResponse(botId, 'getMe'),
    botRateLimits.takeRateLimitResponse(botId, 'sendMessage'),
  ];
  const remaining = botRateLimits.listRateLimitResponses(botId);
  if (
    JSON.stringify(retryAfterSeconds) !== JSON.stringify([undefined, 3, 7, undefined, 3]) ||
    !remaining.found || remaining.responses.length !== 0
  ) {
    throw new Error(
      `Expected each call to take the earliest matching answer, received ${
        JSON.stringify(retryAfterSeconds)
      } and ${JSON.stringify(remaining)}`,
    );
  }
});

Deno.test('BotRateLimitService lists remaining answers and refuses unknown bots', () => {
  const { virtualUsers, botRateLimits } = createBotRateLimitFixture();
  const botId = createBot(virtualUsers, 'test_bot');
  botRateLimits.queueRateLimitResponses(botId, {
    methodName: 'sendPhoto',
    retryAfterSeconds: 2,
    remainingCount: 3,
  });
  botRateLimits.takeRateLimitResponse(botId, 'sendPhoto');

  const listing = botRateLimits.listRateLimitResponses(botId);
  const unknownBotQueueing = botRateLimits.queueRateLimitResponses(999, {
    retryAfterSeconds: 1,
    remainingCount: 1,
  });
  if (
    !listing.found ||
    JSON.stringify(listing.responses) !==
      JSON.stringify([{ methodName: 'sendPhoto', retryAfterSeconds: 2, remainingCount: 2 }]) ||
    unknownBotQueueing.queued || botRateLimits.listRateLimitResponses(999).found
  ) {
    throw new Error(`Expected the remaining answers, received ${JSON.stringify(listing)}`);
  }
});

function createBotRateLimitFixture() {
  const bots = new BotRepository();
  return {
    virtualUsers: new VirtualUserService({
      identities: new TelegramIdentityRepository(),
      accounts: new AccountRepository(),
      bots,
    }),
    botRateLimits: new BotRateLimitService({
      bots,
      rateLimitResponses: new QueuedBotApiAnswerRepository(),
    }),
  };
}

function createBot(virtualUsers: VirtualUserService, username: string): number {
  const result = virtualUsers.createBot({ first_name: 'Test Bot', username });
  if (!result.created) {
    throw new Error(`Expected bot creation to succeed, received ${result.reason}`);
  }
  return result.bot.profile.id;
}
