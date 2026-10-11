/**
 * Account and bot creation through the control API: the limits of names and usernames, counted by
 * code point, and the issues a request breaking them reports.
 */
import { assertEquals } from '@std/assert';
import { createTestSession, requestJson } from './support/emulation_api.ts';

interface CreationResponseBody {
  readonly account?: { readonly first_name: string; readonly last_name?: string };
  readonly reason?: string;
  readonly issues?: readonly { readonly path: readonly unknown[]; readonly code: string }[];
}

/** U+1F600, one code point written as two UTF-16 code units. */
const ASTRAL_CHARACTER = '😀';

Deno.test('An account name has at most 64 code points, however many UTF-16 units they take', async () => {
  const { api, sessionPath } = await createTestSession();
  const longestName = ASTRAL_CHARACTER.repeat(64);

  const created = await requestJson<CreationResponseBody>(api, 'POST', `${sessionPath}/accounts`, {
    first_name: longestName,
    last_name: longestName,
  });
  const tooLong = await requestJson<CreationResponseBody>(api, 'POST', `${sessionPath}/accounts`, {
    first_name: `${longestName}${ASTRAL_CHARACTER}`,
    last_name: `${'a'.repeat(64)}${ASTRAL_CHARACTER}`,
  });

  assertEquals(created.status, 201, 'Expected names of 64 astral characters to be accepted');
  assertEquals(created.body.account?.first_name, longestName, 'Expected the first name kept');
  assertEquals(created.body.account?.last_name, longestName, 'Expected the last name kept');
  assertEquals(tooLong.status, 400, 'Expected names of 65 characters to be refused');
  assertEquals(
    tooLong.body.issues?.map(({ path, code }) => ({ path, code })),
    [
      { path: ['first_name'], code: 'too_big' },
      { path: ['last_name'], code: 'too_big' },
    ],
    'Expected each name over the limit reported as too big',
  );
});

Deno.test('A name within the limit that is not well-formed Unicode is invalid', async () => {
  const { api, sessionPath } = await createTestSession();

  const response = await requestJson<CreationResponseBody>(api, 'POST', `${sessionPath}/accounts`, {
    first_name: `${'a'.repeat(63)}\uD83D`,
  });

  assertEquals(response.status, 400, 'Expected a name that is not well-formed to be refused');
  assertEquals(response.body, { reason: 'name_invalid' }, 'Expected the name refused as invalid');
});

Deno.test('A username has at most 32 characters of Telegram’s syntax', async () => {
  const { api, sessionPath } = await createTestSession();
  const bots = `${sessionPath}/bots`;

  const longest = await requestJson<CreationResponseBody>(api, 'POST', bots, {
    first_name: 'Helper',
    username: `a${'b'.repeat(31)}`,
  });
  const tooLong = await requestJson<CreationResponseBody>(api, 'POST', bots, {
    first_name: 'Helper',
    username: `a${'b'.repeat(32)}`,
  });
  const malformed = await requestJson<CreationResponseBody>(api, 'POST', bots, {
    first_name: 'Helper',
    username: 'helper__bot',
  });
  const empty = await requestJson<CreationResponseBody>(api, 'POST', `${sessionPath}/accounts`, {
    first_name: 'Ada',
    username: '',
  });

  assertEquals(longest.status, 201, 'Expected a username of 32 characters to be accepted');
  assertEquals(
    [tooLong, malformed, empty].map(({ status, body }) => [
      status,
      body.issues?.map(({ path, code }) => ({ path, code })),
    ]),
    [
      [400, [{ path: ['username'], code: 'too_big' }]],
      [400, [{ path: ['username'], code: 'invalid_format' }]],
      [400, [
        { path: ['username'], code: 'too_small' },
        { path: ['username'], code: 'invalid_format' },
      ]],
    ],
    'Expected each refused username reported by what it breaks',
  );
});
