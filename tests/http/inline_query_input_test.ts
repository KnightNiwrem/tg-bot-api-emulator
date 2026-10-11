/**
 * The input of the inline query routes: a query of at most 256 characters counted by code point,
 * a location within Earth's coordinates whose accuracy may be left out, and account IDs written in
 * decimal digits.
 */
import { assertEquals } from '@std/assert';

import type { ControlErrorBody } from '../../clients/typescript/mod.ts';
import { MAX_INLINE_QUERY_LENGTH } from '../../src/types/inline_query.ts';
import { requestJson } from '../support/emulation_api.ts';
import { createBot, createPrivateConversationFixture } from '../support/http_fixtures.ts';

interface SentInlineQuery {
  readonly inline_query: { readonly query: string; readonly location?: unknown };
}

async function createInlineQueryFixture() {
  await using disposalOnFailure = new AsyncDisposableStack();
  const fixture = disposalOnFailure.use(await createPrivateConversationFixture());
  const inlineBot = await createBot(fixture.api, fixture.sessionPath, 'cats_bot', {
    supports_inline_queries: true,
    requests_inline_location: true,
  });
  const accountPath = `${fixture.sessionPath}/accounts/${fixture.createdAccount.account.id}`;
  const sendQuery = (body: Record<string, unknown>) =>
    requestJson<SentInlineQuery & ControlErrorBody>(
      fixture.api,
      'POST',
      `${accountPath}/inline-queries`,
      { bot_id: inlineBot.bot.id, chat: { type: 'private', botId: inlineBot.bot.id }, ...body },
    );
  const emulatorDisposal = disposalOnFailure.move();
  return {
    ...fixture,
    accountPath,
    sendQuery,
    [Symbol.asyncDispose]: () => emulatorDisposal.disposeAsync(),
  };
}

Deno.test('An inline query holds up to 256 characters, counted by code point', async () => {
  await using fixture = await createInlineQueryFixture();
  const { sendQuery } = fixture;

  const longest = await sendQuery({ query: '😀'.repeat(MAX_INLINE_QUERY_LENGTH) });
  const tooLong = await sendQuery({ query: '😀'.repeat(MAX_INLINE_QUERY_LENGTH + 1) });

  assertEquals(
    [longest.status, [...longest.body.inline_query.query].length],
    [201, MAX_INLINE_QUERY_LENGTH],
    'Expected 256 astral characters accepted',
  );
  assertEquals(
    {
      status: tooLong.status,
      issues: tooLong.body.issues?.map(({ source, path, code }) => ({ source, path, code })),
    },
    { status: 400, issues: [{ source: 'body', path: ['query'], code: 'too_big' }] },
    'Expected 257 astral characters reported at the query',
  );
});

Deno.test('A shared location without an accuracy shows none', async () => {
  await using fixture = await createInlineQueryFixture();
  const { sendQuery } = fixture;

  const queries = [
    await sendQuery({ location: { latitude: 51.5, longitude: -0.12 } }),
    await sendQuery({ location: { latitude: 51.5, longitude: -0.12, horizontal_accuracy: 0 } }),
    await sendQuery({ location: { latitude: 51.5, longitude: -0.12, horizontal_accuracy: 2.5 } }),
  ];

  assertEquals(
    queries.map(({ status, body }) => [status, body.inline_query.location]),
    [
      [201, { latitude: 51.5, longitude: -0.12 }],
      [201, { latitude: 51.5, longitude: -0.12 }],
      [201, { latitude: 51.5, longitude: -0.12, horizontal_accuracy: 3 }],
    ],
    'Expected an omitted or zero accuracy unknown, and another rounded up to whole meters',
  );
});

Deno.test('Inline query paths take account IDs written only in decimal digits', async () => {
  await using fixture = await createInlineQueryFixture();
  const { api, sessionPath, createdAccount } = fixture;

  const refusals = [
    await requestJson<ControlErrorBody>(
      api,
      'GET',
      `${sessionPath}/accounts/${createdAccount.account.id}.0/inline-queries/1`,
    ),
    await requestJson<ControlErrorBody>(
      api,
      'POST',
      `${sessionPath}/accounts/0x10/inline-queries`,
      {
        bot_id: 1,
        chat: { type: 'private', botId: 1 },
      },
    ),
  ];

  assertEquals(
    refusals.map(({ status, body }) => ({
      status,
      issues: body.issues?.map(({ source, path, code }) => ({ source, path, code })),
    })),
    [
      { status: 400, issues: [{ source: 'path', path: ['accountId'], code: 'invalid_type' }] },
      { status: 400, issues: [{ source: 'path', path: ['accountId'], code: 'invalid_type' }] },
    ],
    'Expected each account ID that is not decimal digits to be an issue of its path parameter',
  );
});
