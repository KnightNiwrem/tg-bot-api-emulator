/**
 * The path input of the poll controls: poll IDs written as the decimal text of a positive 64-bit
 * integer, and account, bot, chat and message IDs written as decimal integers.
 */
import { assertEquals } from '@std/assert';

import type { ControlErrorBody } from '../../clients/typescript/mod.ts';
import { isInt64DecimalText } from '../../src/types/telegram_int64.ts';
import { createTestSession, requestJson } from '../support/emulation_api.ts';
import { createAccount, createBot } from '../support/http_fixtures.ts';

interface RefusalDescription {
  readonly status: number;
  readonly reason: string;
  readonly issues?: readonly {
    readonly source: string;
    readonly path: readonly (string | number)[];
    readonly code: string;
  }[];
}

/** The status and reason of a refusal, and the source, path and code of each of its issues. */
function describeRefusal(
  { status, body }: { status: number; body: ControlErrorBody },
): RefusalDescription {
  return {
    status,
    reason: body.reason,
    issues: body.issues?.map(({ source, path, code }) => ({ source, path, code })),
  };
}

Deno.test('A poll expiry takes a poll ID only as the decimal text of a positive integer', async () => {
  const { api, sessionPath } = await createTestSession();
  const expire = (pollId: string) =>
    requestJson<ControlErrorBody>(api, 'POST', `${sessionPath}/polls/${pollId}/expiry`);

  const cases: readonly [pollId: string, code: string][] = [
    ['first', 'invalid_format'],
    ['0', 'invalid_format'],
    ['01', 'invalid_format'],
    ['1'.repeat(20), 'too_big'],
    // 2^63, one more than the largest signed 64-bit integer.
    ['9223372036854775808', 'invalid_value'],
    ['9'.repeat(19), 'invalid_value'],
  ];
  const refusals = [];
  for (const [pollId] of cases) refusals.push(await expire(pollId));
  // 2^63 - 1, the largest poll ID, and a small one: well formed, but naming no poll.
  const unknownPolls = [await expire('9223372036854775807'), await expire('1')];

  assertEquals(
    refusals.map(describeRefusal),
    cases.map(([, code]) => ({
      status: 400,
      reason: 'invalid_request',
      issues: [{ source: 'path', path: ['pollId'], code }],
    })),
    'Expected each malformed or out-of-range poll ID reported at its parameter',
  );
  assertEquals(
    unknownPolls.map(describeRefusal),
    [1, 2].map(() => ({ status: 404, reason: 'poll_not_found', issues: undefined })),
    'Expected IDs within the range that name no poll not found',
  );
});

Deno.test('Decimal text is a signed 64-bit integer exactly within its range', () => {
  assertEquals(
    [
      '9223372036854775807',
      '-9223372036854775808',
      '9223372036854775808',
      '-9223372036854775809',
      '1e3',
      '',
    ].map(isInt64DecimalText),
    [true, true, false, false, false, false],
    'Expected the bounds of the signed 64-bit range accepted, and the values just beyond refused',
  );
});

Deno.test('A poll answer retraction takes IDs written only in decimal digits', async () => {
  const { api, sessionPath } = await createTestSession();
  const account = await createAccount(api, sessionPath, 'Ada');
  const { bot } = await createBot(api, sessionPath, 'poll_bot');
  const accountPath = `${sessionPath}/accounts/${account.id}`;
  const retract = (path: string) =>
    requestJson<ControlErrorBody>(api, 'DELETE', `${accountPath}/conversations/${path}`);

  const refusals = [
    await retract(`private/${bot.id}/messages/1.0/poll-answer`),
    await retract(`private/0x${bot.id.toString(16)}/messages/1/poll-answer`),
    await retract('supergroup/-1000000000001/messages/0/poll-answer'),
    await retract('supergroup/-1e12/messages/1/poll-answer'),
  ];

  assertEquals(
    refusals.map(describeRefusal),
    [
      ['messageId', 'invalid_type'],
      ['botId', 'invalid_type'],
      ['messageId', 'too_small'],
      ['chatId', 'invalid_type'],
    ].map(([parameter, code]) => ({
      status: 400,
      reason: 'invalid_request',
      issues: [{ source: 'path', path: [parameter], code }],
    })),
    'Expected each malformed ID reported at its path parameter',
  );
});
