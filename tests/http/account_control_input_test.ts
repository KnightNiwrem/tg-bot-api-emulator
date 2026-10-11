/**
 * The input of an account's draft, callback and blocking controls: IDs written as decimal
 * integers, and draft IDs as Telegram's decimal text of a nonzero signed 64-bit integer.
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

function invalidRequest(source: string, path: string, code: string): RefusalDescription {
  return { status: 400, reason: 'invalid_request', issues: [{ source, path: [path], code }] };
}

async function createAccountFixture() {
  const { api, sessionPath } = await createTestSession();
  const account = await createAccount(api, sessionPath, 'Ada');
  const { bot } = await createBot(api, sessionPath, 'answer_bot');
  return { api, accountPath: `${sessionPath}/accounts/${account.id}`, bot };
}

Deno.test('A draft ID is the decimal text of a nonzero signed 64-bit integer', async () => {
  const { api, accountPath, bot } = await createAccountFixture();
  const draftPath = `${accountPath}/conversations/private/${bot.id}/message-draft`;

  const cases: readonly [action: string, draftId: string, refusal: RefusalDescription][] = [
    ['expiration', '05', invalidRequest('body', 'draft_id', 'invalid_format')],
    ['stop', '0', invalidRequest('body', 'draft_id', 'invalid_format')],
    // 2^63 and -2^63 - 1, just beyond the signed 64-bit range.
    ['expiration', '9223372036854775808', invalidRequest('body', 'draft_id', 'invalid_value')],
    ['stop', '-9223372036854775809', invalidRequest('body', 'draft_id', 'invalid_value')],
    // 2^63 - 1 and -2^63, the bounds of the range, which no draft of the chat has.
    ['expiration', '9223372036854775807', {
      status: 404,
      reason: 'draft_not_found',
      issues: undefined,
    }],
    ['stop', '-9223372036854775808', { status: 404, reason: 'draft_not_found', issues: undefined }],
  ];

  const refusals = [];
  for (const [action, draftId] of cases) {
    refusals.push(
      await requestJson<ControlErrorBody>(api, 'POST', `${draftPath}/${action}`, {
        draft_id: draftId,
      }),
    );
  }

  assertEquals(
    refusals.map(describeRefusal),
    cases.map(([, , refusal]) => refusal),
    'Expected malformed and out-of-range draft IDs reported at the body field',
  );
});

Deno.test('Account controls take path IDs written only in decimal digits', async () => {
  const { api, accountPath, bot } = await createAccountFixture();

  const refusals = [
    await requestJson<ControlErrorBody>(api, 'PUT', `${accountPath}/blocked-bots/${bot.id}.0`),
    await requestJson<ControlErrorBody>(api, 'DELETE', `${accountPath}/blocked-bots/0`),
    await requestJson<ControlErrorBody>(
      api,
      'GET',
      `${accountPath}/conversations/private/1e3/message-draft`,
    ),
    await requestJson<ControlErrorBody>(api, 'GET', `${accountPath}x/callback-queries/1`),
  ];

  assertEquals(
    refusals.map(describeRefusal),
    [
      invalidRequest('path', 'botId', 'invalid_type'),
      invalidRequest('path', 'botId', 'too_small'),
      invalidRequest('path', 'botId', 'invalid_type'),
      invalidRequest('path', 'accountId', 'invalid_type'),
    ],
    'Expected each malformed ID reported at its path parameter',
  );
});

Deno.test('A callback button press names a message by an ID from 1', async () => {
  const { api, accountPath, bot } = await createAccountFixture();

  const refusal = await requestJson<ControlErrorBody>(
    api,
    'POST',
    `${accountPath}/callback-queries`,
    {
      chat: { type: 'private', botId: bot.id },
      message_id: 0,
      callback_data: 'go',
    },
  );

  assertEquals(
    describeRefusal(refusal),
    invalidRequest('body', 'message_id', 'too_small'),
    'Expected a message ID of 0 reported at the body field',
  );
});
