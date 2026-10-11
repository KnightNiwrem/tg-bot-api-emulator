/**
 * The input of an account's messaging controls of a supergroup: path IDs written as decimal
 * integers, entities written as the Bot API writes them, and reactions whose emoji the server, not
 * the wire schema, refuses as unsupported.
 */
import { assertEquals } from '@std/assert';

import type { ControlErrorBody } from '../../clients/typescript/mod.ts';
import { requestJson } from '../support/emulation_api.ts';
import { createSupergroupFixture } from '../support/http_fixtures.ts';

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

Deno.test('Supergroup messaging controls take path IDs written only in decimal digits', async () => {
  await using fixture = await createSupergroupFixture();
  const { api, sessionPath, owner, bot, supergroupPath, sendSupergroupText } = fixture;
  const chatPath = supergroupPath(owner.id);
  const message = await sendSupergroupText(owner.id, 'Hello');
  const chatsPath = `${sessionPath}/accounts/${owner.id}/conversations/supergroup`;

  const refusals = [
    await requestJson<ControlErrorBody>(api, 'GET', `${chatsPath}/-1e12/messages`),
    await requestJson<ControlErrorBody>(api, 'GET', `${chatsPath}/-1/commands`),
    await requestJson<ControlErrorBody>(api, 'PUT', `${chatPath}/pinned-messages/1.0`),
    await requestJson<ControlErrorBody>(api, 'DELETE', `${chatPath}/messages/0`),
    await requestJson<ControlErrorBody>(api, 'GET', `${chatPath}/messages/0x1/reactions`),
    await requestJson<ControlErrorBody>(api, 'POST', `${chatPath}/chat-actions/1e3/expiry`),
    await requestJson<ControlErrorBody>(
      api,
      'POST',
      `${chatPath}/messages/+${message.message_id}/poll-closure`,
    ),
  ];
  const unknownAction = await requestJson<ControlErrorBody>(
    api,
    'POST',
    `${chatPath}/chat-actions/${bot.bot.id}/expiry`,
  );

  assertEquals(
    refusals.map(describeRefusal),
    [
      invalidRequest('path', ['chatId'], 'invalid_type'),
      invalidRequest('path', ['chatId'], 'too_big'),
      invalidRequest('path', ['messageId'], 'invalid_type'),
      invalidRequest('path', ['messageId'], 'too_small'),
      invalidRequest('path', ['messageId'], 'invalid_type'),
      invalidRequest('path', ['botId'], 'invalid_type'),
      invalidRequest('path', ['messageId'], 'invalid_type'),
    ],
    'Expected each malformed ID reported at its path parameter',
  );
  assertEquals(
    describeRefusal(unknownAction),
    { status: 404, reason: 'chat_action_not_found', issues: undefined },
    'Expected a well-formed bot ID that shows no action not found',
  );
});

Deno.test('An edit of a supergroup message takes entities as the Bot API writes them', async () => {
  await using fixture = await createSupergroupFixture();
  const { api, owner, supergroupPath, sendSupergroupText } = fixture;
  const message = await sendSupergroupText(owner.id, 'Hello');
  const messagePath = `${supergroupPath(owner.id)}/messages/${message.message_id}`;
  const edit = (body: unknown) => requestJson<ControlErrorBody>(api, 'PATCH', messagePath, body);

  const refusals = [
    await edit({ text: '😀'.repeat(4097) }),
    await edit({ text: 'Bold', entities: [{ type: 'bold', offset: '0', length: 4 }] }),
    await edit({ text: 'Bold', entities: [{ type: '', offset: 0, length: 4 }] }),
  ];

  assertEquals(
    refusals.map(describeRefusal),
    [
      invalidRequest('body', ['text'], 'too_big'),
      invalidRequest('body', ['entities', 0, 'offset'], 'invalid_type'),
      invalidRequest('body', ['entities'], 'invalid_value'),
    ],
    'Expected each refusal reported at its body field',
  );
});

Deno.test('A reaction with an emoji the Bot API does not list is refused as unsupported', async () => {
  await using fixture = await createSupergroupFixture();
  const { api, owner, supergroupPath, sendSupergroupText } = fixture;
  const message = await sendSupergroupText(owner.id, 'Hello');
  const reactionsPath = `${supergroupPath(owner.id)}/messages/${message.message_id}/reactions`;

  const refusal = await requestJson<ControlErrorBody>(api, 'PUT', reactionsPath, {
    reaction: [{ type: 'emoji', emoji: '❤️' }],
  });
  const reactions = await requestJson<{ reactions: readonly unknown[] }>(
    api,
    'PUT',
    reactionsPath,
    { reaction: [{ type: 'emoji', emoji: '❤' }] },
  );

  assertEquals(
    describeRefusal(refusal),
    { status: 400, reason: 'reaction_emoji_unsupported', issues: undefined },
    'Expected the heart with a variation selector refused by the server',
  );
  assertEquals(
    { status: reactions.status, reactions: reactions.body.reactions },
    { status: 200, reactions: [{ user_id: owner.id, reaction: [{ type: 'emoji', emoji: '❤' }] }] },
    'Expected the listed heart accepted',
  );
});
