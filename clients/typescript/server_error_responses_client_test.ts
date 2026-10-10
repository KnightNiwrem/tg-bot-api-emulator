import { Bot } from 'https://cdn.jsdelivr.net/gh/grammyjs/grammY@^1.46.0/src/bot.ts';
import { GrammyError } from 'https://cdn.jsdelivr.net/gh/grammyjs/grammY@^1.46.0/src/core/error.ts';
import { autoRetry } from '@grammyjs/auto-retry/mod.ts';

import { createTestApi } from '../../tests/support/emulation_api.ts';
import { EmulationClientError, TelegramEmulationClient } from './mod.ts';

const PUBLIC_ORIGIN = 'http://emulator.example:9000';
/** auto-retry waits 3 seconds before its first retry of a server error. */
const AUTO_RETRY_WAIT_TIMEOUT_MILLISECONDS = 10_000;

Deno.test('A grammY bot with auto-retry recovers from a queued server error', async () => {
  const { client, fetch } = createInProcessClient();
  const session = await client.createSession();
  const { token, bot } = await session.createBot({ first_name: 'Shop', username: 'shop_bot' });
  const { account } = await session.createAccount({ first_name: 'Ada' });
  const grammyBot = new Bot(token, { client: { apiRoot: session.botApiRoot, fetch } });
  grammyBot.api.config.use(autoRetry({ maxRetryAttempts: 2 }));
  grammyBot.command('start', (context) => context.reply('Welcome!'));
  const pollingStarted = Promise.withResolvers<void>();
  const polling = grammyBot.start({ onStart: () => pollingStarted.resolve() });
  polling.catch(() => {});

  try {
    await Promise.race([pollingStarted.promise, polling]);
    const queued = await session.queueServerErrorResponses({
      bot_id: bot.id,
      method: 'sendMessage',
      error_code: 500,
    });
    const activity = session.botActivity({ bot_id: bot.id });
    const start = await activity.position();
    const privateChat = { type: 'private', botId: bot.id } as const;
    await account.sendMessage({ to: privateChat, text: '/start' });

    const reply = { method: 'sendMessage', chat_id: account.id, parameters: { text: 'Welcome!' } };
    const failed = await activity.waitFor({ ...reply, ok: false }, { after: start });
    const recovered = await activity.waitFor({ ...reply, ok: true }, {
      after: failed,
      timeoutMs: AUTO_RETRY_WAIT_TIMEOUT_MILLISECONDS,
    });
    assertJson(
      [
        queued,
        failed.answer,
        recovered.answer.ok,
        (await account.getMessages({ chat: privateChat })).map(({ text }) => text),
        await session.getServerErrorResponses(bot.id),
      ],
      [
        { method: 'sendMessage', error_code: 500, remaining_count: 1 },
        { ok: false, error_code: 500, description: 'Internal Server Error' },
        true,
        ['/start', 'Welcome!'],
        [],
      ],
      'Expected the retried reply to be sent once after the queued failure',
    );
  } finally {
    await grammyBot.stop();
    await polling;
    await session.end();
  }
});

Deno.test('A caller that does not retry sees each queued server error once', async () => {
  const { client, fetch } = createInProcessClient();
  const session = await client.createSession();
  const { token, bot } = await session.createBot({ first_name: 'Shop', username: 'shop_bot' });
  const { account } = await session.createAccount({ first_name: 'Ada' });
  await account.sendMessage({ to: { type: 'private', botId: bot.id }, text: '/start' });
  const grammyBot = new Bot(token, { client: { apiRoot: session.botApiRoot, fetch } });

  try {
    await session.queueServerErrorResponses({ bot_id: bot.id, error_code: 503, count: 2 });
    const outcomes = [
      await callOutcome(grammyBot.api.getMe()),
      await callOutcome(grammyBot.api.sendMessage(account.id, 'Hello')),
      await callOutcome(grammyBot.api.sendMessage(account.id, 'Hello')),
    ];
    assertJson(
      [outcomes, await session.getServerErrorResponses(bot.id)],
      [[[503, 'Service Unavailable'], [503, 'Service Unavailable'], 'ok'], []],
      'Expected two failed calls of any method, then a call that runs',
    );
  } finally {
    await session.end();
  }
});

Deno.test('Server error queue controls reject what they cannot apply to', async () => {
  const { client } = createInProcessClient();
  const session = await client.createSession();
  const otherSession = await client.createSession();
  const { bot } = await session.createBot({ first_name: 'Shop', username: 'shop_bot' });
  const { account } = await session.createAccount({ first_name: 'Ada' });
  const { bot: otherSessionBot } = await otherSession.createBot({
    first_name: 'Shop',
    username: 'shop_bot',
  });

  try {
    const queued = await session.queueServerErrorResponses({
      bot_id: bot.id,
      method: 'getMe',
      error_code: 503,
      count: 2,
    });
    const statuses = [
      await failedStatus(
        session.queueServerErrorResponses({ bot_id: bot.id, method: 'sendDice', error_code: 500 }),
      ),
      await failedStatus(
        session.queueServerErrorResponses({ bot_id: bot.id, error_code: 500, count: 0 }),
      ),
      await failedStatus(
        session.queueServerErrorResponses({ bot_id: account.id, error_code: 500 }),
      ),
      await failedStatus(session.getServerErrorResponses(account.id)),
    ];
    assertJson(
      [
        statuses,
        await session.getServerErrorResponses(bot.id),
        await otherSession.getServerErrorResponses(otherSessionBot.id),
      ],
      [[400, 400, 404, 404], [queued], []],
      "Expected refusals to leave the queue intact, and another session's bot unaffected",
    );

    await session.end();
    assertJson(
      await failedStatus(session.getServerErrorResponses(bot.id)),
      404,
      'Expected the queued answers to end with their session',
    );
  } finally {
    await otherSession.end();
  }
});

function createInProcessClient() {
  const api = createTestApi(PUBLIC_ORIGIN);
  const fetch: typeof globalThis.fetch = async (input, init) =>
    await api.fetch(new Request(input, init));
  return { client: new TelegramEmulationClient(PUBLIC_ORIGIN, { fetch }), fetch };
}

/** `'ok'` for a Bot API call that succeeded, or the error code and description it failed with. */
async function callOutcome(call: Promise<unknown>): Promise<'ok' | [number, string]> {
  try {
    await call;
    return 'ok';
  } catch (error) {
    if (error instanceof GrammyError) {
      return [error.error_code, error.description];
    }
    throw error;
  }
}

/** The HTTP status a client call failed with; fails when the call succeeds. */
async function failedStatus(call: Promise<unknown>): Promise<number | undefined> {
  try {
    await call;
  } catch (error) {
    if (error instanceof EmulationClientError) {
      return error.status;
    }
    throw error;
  }
  throw new Error('Expected the client call to fail');
}

function assertJson(actual: unknown, expected: unknown, message: string): void {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  if (actualJson !== expectedJson) {
    throw new Error(`${message}\nExpected: ${expectedJson}\nReceived: ${actualJson}`);
  }
}
