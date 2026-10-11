import { assertEquals } from '@std/assert';
import type { VirtualUserService } from '../src/services/domain/virtual_user.ts';
import { buildSessionServices } from './support/session_services.ts';
import { createVirtualBot } from './support/virtual_users.ts';

Deno.test('BotRateLimitService answers the next matching calls in queue order', () => {
  using session = buildSessionServices();
  const { virtualUsers, botRateLimits } = session;
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
  assertEquals(
    [retryAfterSeconds, botRateLimits.listRateLimitResponses(botId)],
    [[undefined, 3, 7, undefined, 3], { found: true, responses: [] }],
    'Expected each call to take the earliest matching answer, and none once all were taken',
  );
});

Deno.test('BotRateLimitService lists remaining answers and refuses unknown bots', () => {
  using session = buildSessionServices();
  const { virtualUsers, botRateLimits } = session;
  const botId = createBot(virtualUsers, 'test_bot');
  botRateLimits.queueRateLimitResponses(botId, {
    methodName: 'sendPhoto',
    retryAfterSeconds: 2,
    remainingCount: 3,
  });
  botRateLimits.takeRateLimitResponse(botId, 'sendPhoto');

  const unknownBotQueueing = botRateLimits.queueRateLimitResponses(999, {
    retryAfterSeconds: 1,
    remainingCount: 1,
  });
  assertEquals(
    [
      botRateLimits.listRateLimitResponses(botId),
      unknownBotQueueing,
      botRateLimits.listRateLimitResponses(999),
    ],
    [
      {
        found: true,
        responses: [{ methodName: 'sendPhoto', retryAfterSeconds: 2, remainingCount: 2 }],
      },
      { queued: false, reason: 'bot_not_found' },
      { found: false, reason: 'bot_not_found' },
    ],
    'Expected the remaining answers, and unknown bots refused',
  );
});

function createBot(virtualUsers: VirtualUserService, username: string): number {
  return createVirtualBot(virtualUsers, { first_name: 'Test Bot', username }).profile.id;
}
