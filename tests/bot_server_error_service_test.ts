import { AccountRepository } from '../src/repositories/account.ts';
import { BotRepository } from '../src/repositories/bot.ts';
import { QueuedBotApiAnswerRepository } from '../src/repositories/queued_bot_api_answer.ts';
import { TelegramIdentityRepository } from '../src/repositories/telegram_identity.ts';
import { BotServerErrorService } from '../src/services/bot_server_error.ts';
import { VirtualUserService } from '../src/services/virtual_user.ts';

Deno.test('BotServerErrorService answers the next matching calls in queue order', () => {
  const { virtualUsers, botServerErrors } = createBotServerErrorFixture();
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
  assertJson(
    [errorCodes, remaining],
    [[undefined, 500, 503, undefined, 500, undefined], { found: true, responses: [] }],
    'Expected each call to take the earliest matching answer, and none once all were taken',
  );
});

Deno.test('BotServerErrorService lists remaining answers and refuses unknown bots', () => {
  const { virtualUsers, botServerErrors } = createBotServerErrorFixture();
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
  assertJson(
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
  const { virtualUsers, botServerErrors } = createBotServerErrorFixture();
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
  assertJson(
    [errorCodes, botServerErrors.listServerErrorResponses(botId)],
    [
      [500, 500, 500, 503, 503, undefined, undefined, undefined],
      { found: true, responses: [] },
    ],
    'Expected five failures, then calls that run, without the counts going below zero',
  );
});

function createBotServerErrorFixture() {
  const bots = new BotRepository();
  return {
    virtualUsers: new VirtualUserService({
      identities: new TelegramIdentityRepository(),
      accounts: new AccountRepository(),
      bots,
    }),
    botServerErrors: new BotServerErrorService({
      bots,
      serverErrorResponses: new QueuedBotApiAnswerRepository(),
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

function assertJson(actual: unknown, expected: unknown, message: string): void {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  if (actualJson !== expectedJson) {
    throw new Error(`${message}\nExpected: ${expectedJson}\nReceived: ${actualJson}`);
  }
}
