import { assertEquals } from '@std/assert';
import type { VirtualUserService } from '../src/services/domain/virtual_user.ts';
import { buildSessionServices } from './support/session_services.ts';
import { createVirtualBot } from './support/virtual_users.ts';

Deno.test('BotServerErrorService answers the next matching calls in queue order', () => {
  using session = buildSessionServices();
  const { virtualUsers, botServerErrors } = session;
  const botId = createBot(virtualUsers, 'first_bot');
  const otherBotId = createBot(virtualUsers, 'second_bot');

  botServerErrors.queueServerErrorResponses(botId, {
    methodName: 'sendMessage',
    errorCode: 500,
    remainingCount: 2,
  });
  botServerErrors.queueServerErrorResponses(botId, { errorCode: 503, remainingCount: 1 });

  const errorCodes = [
    botServerErrors.takeServerErrorResponse(otherBotId, 'sendMessage'),
    botServerErrors.takeServerErrorResponse(botId, 'sendMessage'),
    botServerErrors.takeServerErrorResponse(botId, 'getMe'),
    botServerErrors.takeServerErrorResponse(botId, 'getMe'),
    botServerErrors.takeServerErrorResponse(botId, 'sendMessage'),
    botServerErrors.takeServerErrorResponse(botId, 'sendMessage'),
  ];
  const remaining = botServerErrors.listServerErrorResponses(botId);
  assertEquals(
    [errorCodes, remaining],
    [[undefined, 500, 503, undefined, 500, undefined], { found: true, responses: [] }],
    'Expected each call to take the earliest matching answer, and none once all were taken',
  );
});

Deno.test('BotServerErrorService lists remaining answers and refuses unknown bots', () => {
  using session = buildSessionServices();
  const { virtualUsers, botServerErrors } = session;
  const botId = createBot(virtualUsers, 'test_bot');
  botServerErrors.queueServerErrorResponses(botId, {
    methodName: 'sendPhoto',
    errorCode: 503,
    remainingCount: 3,
  });
  botServerErrors.takeServerErrorResponse(botId, 'sendPhoto');

  const unknownBotQueueing = botServerErrors.queueServerErrorResponses(999, {
    errorCode: 500,
    remainingCount: 1,
  });
  assertEquals(
    [
      botServerErrors.listServerErrorResponses(botId),
      unknownBotQueueing,
      botServerErrors.listServerErrorResponses(999),
    ],
    [
      { found: true, responses: [{ methodName: 'sendPhoto', errorCode: 503, remainingCount: 2 }] },
      { queued: false, reason: 'bot_not_found' },
      { found: false, reason: 'bot_not_found' },
    ],
    'Expected the remaining answers, and unknown bots refused',
  );
});

Deno.test('BotServerErrorService hands each queued answer to exactly one call', () => {
  using session = buildSessionServices();
  const { virtualUsers, botServerErrors } = session;
  const botId = createBot(virtualUsers, 'test_bot');
  botServerErrors.queueServerErrorResponses(botId, { errorCode: 500, remainingCount: 3 });
  botServerErrors.queueServerErrorResponses(botId, {
    methodName: 'sendMessage',
    errorCode: 503,
    remainingCount: 2,
  });

  const errorCodes = Array.from(
    { length: 8 },
    () => botServerErrors.takeServerErrorResponse(botId, 'sendMessage'),
  );
  assertEquals(
    [errorCodes, botServerErrors.listServerErrorResponses(botId)],
    [
      [500, 500, 500, 503, 503, undefined, undefined, undefined],
      { found: true, responses: [] },
    ],
    'Expected five failures, then calls that run, without the counts going below zero',
  );
});

function createBot(virtualUsers: VirtualUserService, username: string): number {
  return createVirtualBot(virtualUsers, { first_name: 'Test Bot', username }).profile.id;
}
