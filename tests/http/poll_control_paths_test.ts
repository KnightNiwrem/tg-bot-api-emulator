/**
 * The path input of the poll controls: poll IDs written as the decimal text of a positive 64-bit
 * integer, and account, bot, chat and message IDs written as decimal integers.
 */
import { assertEquals } from '@std/assert';

import type { ControlErrorBody } from '../../clients/typescript/mod.ts';
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

  const refusals = [
    await expire('first'),
    await expire('0'),
    await expire('01'),
    await expire('1'.repeat(20)),
    await expire('1'),
  ];

  assertEquals(
    refusals.map(describeRefusal),
    [
      ...['invalid_format', 'invalid_format', 'invalid_format', 'too_big'].map((code) => ({
        status: 400,
        reason: 'invalid_request',
        issues: [{ source: 'path', path: ['pollId'], code }],
      })),
      { status: 404, reason: 'poll_not_found', issues: undefined },
    ],
    'Expected each malformed poll ID reported at its parameter, and an unknown one not found',
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
