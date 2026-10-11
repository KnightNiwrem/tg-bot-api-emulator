/**
 * The input of an account's controls of its private chat with a bot: path IDs written as decimal
 * integers, message text limited by code point, and entities written as the Bot API writes them,
 * which Telegram must then be able to read.
 */
import { assertEquals } from '@std/assert';

import type { ControlErrorBody } from '../../clients/typescript/mod.ts';
import { requestJson } from '../support/emulation_api.ts';
import { createPrivateConversationFixture } from '../support/http_fixtures.ts';

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

function invalidRequest(
  source: string,
  path: readonly (string | number)[],
  code: string,
): RefusalDescription {
  return { status: 400, reason: 'invalid_request', issues: [{ source, path, code }] };
}

async function createChatFixture() {
  await using disposalOnFailure = new AsyncDisposableStack();
  const fixture = disposalOnFailure.use(await createPrivateConversationFixture());
  const { api, sessionPath, createdBot, createdAccount } = fixture;
  const accountPath = `${sessionPath}/accounts/${createdAccount.account.id}`;
  const chatPath = `${accountPath}/conversations/private/${createdBot.bot.id}`;
  const sending = await requestJson<{ message: { message_id: number } }>(
    api,
    'POST',
    `${accountPath}/messages`,
    { to: { type: 'private', botId: createdBot.bot.id }, text: 'Hello' },
  );
  const emulatorDisposal = disposalOnFailure.move();
  return {
    api,
    accountPath,
    chatPath,
    messagePath: `${chatPath}/messages/${sending.body.message.message_id}`,
    [Symbol.asyncDispose]: () => emulatorDisposal.disposeAsync(),
  };
}

Deno.test('Private chat controls take path IDs written only in decimal digits', async () => {
  await using fixture = await createChatFixture();
  const { api, accountPath, chatPath } = fixture;
  const chatsPath = `${accountPath}/conversations/private`;

  const refusals = [
    await requestJson<ControlErrorBody>(api, 'GET', `${chatsPath}/1e3/messages`),
    await requestJson<ControlErrorBody>(api, 'GET', `${chatsPath}/0x10/commands`),
    await requestJson<ControlErrorBody>(api, 'GET', `${chatsPath}/0/notifications`),
    await requestJson<ControlErrorBody>(api, 'PUT', `${chatPath}/pinned-messages/1.0`),
    await requestJson<ControlErrorBody>(api, 'DELETE', `${chatPath}/messages/0`),
    await requestJson<ControlErrorBody>(api, 'POST', `${chatPath}/messages/+1/poll-closure`),
    await requestJson<ControlErrorBody>(
      api,
      'POST',
      `${accountPath}x/conversations/private/1/chat-actions/expiry`,
    ),
  ];

  assertEquals(
    refusals.map(describeRefusal),
    [
      invalidRequest('path', ['botId'], 'invalid_type'),
      invalidRequest('path', ['botId'], 'invalid_type'),
      invalidRequest('path', ['botId'], 'too_small'),
      invalidRequest('path', ['messageId'], 'invalid_type'),
      invalidRequest('path', ['messageId'], 'too_small'),
      invalidRequest('path', ['messageId'], 'invalid_type'),
      invalidRequest('path', ['accountId'], 'invalid_type'),
    ],
    'Expected each malformed ID reported at its path parameter',
  );
});

Deno.test('An edit of a private message takes text of at most 4096 characters', async () => {
  await using fixture = await createChatFixture();
  const { api, messagePath } = fixture;

  const refusal = await requestJson<ControlErrorBody>(api, 'PATCH', messagePath, {
    text: '😀'.repeat(4097),
  });
  const edit = await requestJson<{ message: { text: string } }>(api, 'PATCH', messagePath, {
    text: '😀'.repeat(4096),
  });

  assertEquals(
    describeRefusal(refusal),
    invalidRequest('body', ['text'], 'too_big'),
    'Expected text beyond the limit reported at the body field',
  );
  assertEquals(
    { status: edit.status, text: edit.body.message.text },
    { status: 200, text: '😀'.repeat(4096) },
    'Expected text at the limit, counted by code point, to edit the message',
  );
});

Deno.test('An edit of a private message takes entities as the Bot API writes them', async () => {
  await using fixture = await createChatFixture();
  const { api, messagePath } = fixture;
  const edit = (body: unknown) => requestJson<ControlErrorBody>(api, 'PATCH', messagePath, body);

  const refusals = [
    await edit({ text: 'Bold', entities: [{ type: 'bold', offset: '0', length: 4 }] }),
    await edit({ text: 'Bold', entities: [{ type: 'bold', offset: 0, length: 4, weight: 700 }] }),
    await edit({ text: 'Bold', entities: [{ type: '', offset: 0, length: 4 }] }),
    await edit({ caption: 'Bold', caption_entities: [{ type: 'bold', offset: 0 }] }),
  ];

  assertEquals(
    refusals.map(describeRefusal),
    [
      invalidRequest('body', ['entities', 0, 'offset'], 'invalid_type'),
      invalidRequest('body', ['entities', 0, 'weight'], 'unknown_field'),
      invalidRequest('body', ['entities'], 'invalid_value'),
      invalidRequest('body', ['caption_entities', 0, 'length'], 'invalid_type'),
    ],
    'Expected entities the wire schema refuses at their field, and those Telegram cannot read at the list',
  );
  assertEquals(
    refusals[2].body.issues?.[0]?.message,
    "Bad Request: can't parse MessageEntity: Type is not specified",
    "Expected Telegram's description of an entity it cannot read",
  );
});
