/**
 * The path input of a bot's test controls: bot and webhook attempt IDs written as decimal integers
 * within the range of IDs they can have.
 */
import { assertEquals } from '@std/assert';

import type { ControlErrorBody } from '../../clients/typescript/mod.ts';
import { createTestSession, requestJson } from '../support/emulation_api.ts';
import { createBot } from '../support/http_fixtures.ts';

/** Each bot control, by its method, its path under the bot, and a body it accepts. */
const BOT_CONTROLS:
  readonly (readonly [method: 'GET' | 'POST' | 'PUT', path: string, body?: unknown])[] = [
    ['POST', 'rate-limit-responses', { retry_after: 1 }],
    ['GET', 'rate-limit-responses'],
    ['POST', 'server-error-responses', { error_code: 500 }],
    ['GET', 'server-error-responses'],
    ['PUT', 'webhook-delivery', { scheduling: 'manual' }],
    ['GET', 'webhook-delivery'],
    ['GET', 'webhook-attempts'],
    ['POST', 'webhook-attempts/1/retry-release'],
    ['POST', 'webhook-attempts/1/expiry'],
  ];

interface RefusalDescription {
  readonly status: number;
  readonly issues?: readonly {
    readonly source: string;
    readonly path: readonly (string | number)[];
    readonly code: string;
  }[];
}

/** The status of a refusal, and the source, path and code of each of its issues. */
function describeRefusal(
  { status, body }: { status: number; body: ControlErrorBody },
): RefusalDescription {
  return {
    status,
    issues: body.issues?.map(({ source, path, code }) => ({ source, path, code })),
  };
}

Deno.test('Bot controls take bot IDs written in decimal digits within the user ID range', async () => {
  await using testSession = await createTestSession();
  const { api, sessionPath } = testSession;

  for (
    const [botId, code] of [
      ['not-a-bot', 'invalid_type'],
      ['1e3', 'invalid_type'],
      ['0x10', 'invalid_type'],
      ['5.0', 'invalid_type'],
      ['0', 'too_small'],
      ['1099511627776', 'too_big'],
    ] as const
  ) {
    const refusals = [];
    for (const [method, path, body] of BOT_CONTROLS) {
      refusals.push(
        await requestJson<ControlErrorBody>(
          api,
          method,
          `${sessionPath}/bots/${botId}/${path}`,
          body,
        ),
      );
    }

    assertEquals(
      refusals.map(describeRefusal),
      BOT_CONTROLS.map(() => ({
        status: 400,
        issues: [{ source: 'path', path: ['botId'], code }],
      })),
      `Expected the bot ID ${botId} to be an issue of its path parameter`,
    );
  }
});

Deno.test('Webhook attempt controls take attempt IDs written in decimal digits from 1', async () => {
  await using testSession = await createTestSession();
  const { api, sessionPath } = testSession;
  const { bot } = await createBot(api, sessionPath, 'paths_bot');

  const refusals = [];
  for (
    const [attemptId, control] of [
      ['one', 'retry-release'],
      ['1.0', 'retry-release'],
      ['0', 'retry-release'],
      ['one', 'expiry'],
      ['-1', 'expiry'],
      ['0', 'expiry'],
    ] as const
  ) {
    refusals.push(
      await requestJson<ControlErrorBody>(
        api,
        'POST',
        `${sessionPath}/bots/${bot.id}/webhook-attempts/${attemptId}/${control}`,
      ),
    );
  }

  assertEquals(
    refusals.map(describeRefusal),
    ['invalid_type', 'invalid_type', 'too_small', 'invalid_type', 'too_small', 'too_small'].map(
      (code) => ({ status: 400, issues: [{ source: 'path', path: ['webhookAttemptId'], code }] }),
    ),
    'Expected each attempt ID no attempt can have to be an issue of its path parameter',
  );
  assertEquals(
    describeRefusal(
      await requestJson<ControlErrorBody>(
        api,
        'POST',
        `${sessionPath}/bots/${bot.id}/webhook-attempts/1/expiry`,
      ),
    ),
    { status: 404, issues: undefined },
    'Expected an attempt ID the bot has no attempt of to be refused as missing',
  );
});

Deno.test('A queued answer for a method the emulator does not implement is an issue of its body', async () => {
  await using testSession = await createTestSession();
  const { api, sessionPath } = testSession;
  const { bot } = await createBot(api, sessionPath, 'paths_bot');

  const refusals = [
    await requestJson<ControlErrorBody>(
      api,
      'POST',
      `${sessionPath}/bots/${bot.id}/rate-limit-responses`,
      { method: 'sendTelepathy', retry_after: 1 },
    ),
    await requestJson<ControlErrorBody>(
      api,
      'POST',
      `${sessionPath}/bots/${bot.id}/server-error-responses`,
      { method: '', error_code: 500 },
    ),
  ];

  assertEquals(
    refusals.map(describeRefusal),
    [
      { status: 400, issues: [{ source: 'body', path: ['method'], code: 'invalid_value' }] },
      { status: 400, issues: [{ source: 'body', path: ['method'], code: 'invalid_value' }] },
    ],
    'Expected each name of no implemented method reported at the body field',
  );
});
