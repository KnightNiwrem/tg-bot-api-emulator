import { assertEquals } from '@std/assert';
import {
  createSession,
  createTestInProcessEmulator,
  type EmulationApi,
  requestJson,
} from './support/emulation_api.ts';
import {
  createAccount as createSessionAccount,
  createBot as createSessionBot,
} from './support/http_fixtures.ts';

/** A user ID that no account or bot of a fixture has. */
const UNKNOWN_USER_ID = 999_999;

interface ShownMessage {
  readonly message_id: number;
  readonly text?: string;
  readonly reply_to_message?: unknown;
}

/**
 * Creates a session where Ada has written to a bot and owns a supergroup with Grace, the bot, and
 * Linus, an administrator account without the right to pin. The session is created on
 * `existingApi` when given, or on an emulator of its own, which disposing of the fixture disposes
 * of.
 */
async function createPinnedMessagesFixture(existingApi?: EmulationApi) {
  await using disposalOnFailure = new AsyncDisposableStack();
  const api = existingApi ?? disposalOnFailure.use(createTestInProcessEmulator());
  const sessionPath = await createSession(api);
  const createAccount = async (firstName: string) =>
    (await createSessionAccount(api, sessionPath, firstName)).id;
  const ada = await createAccount('Ada');
  const grace = await createAccount('Grace');
  const linus = await createAccount('Linus');
  const { bot: { id: botId }, botApiPath } = await createSessionBot(api, sessionPath, 'test_bot');

  const { body: { supergroup } } = await requestJson<{ supergroup: { id: number } }>(
    api,
    'POST',
    `${sessionPath}/accounts/${ada}/supergroups`,
    { title: 'Team' },
  );
  const accountPath = (accountId: number) => `${sessionPath}/accounts/${accountId}`;
  const privatePath = (accountId: number) =>
    `${accountPath(accountId)}/conversations/private/${botId}`;
  const supergroupPath = (accountId: number) =>
    `${accountPath(accountId)}/conversations/supergroup/${supergroup.id}`;
  for (const memberId of [grace, linus, botId]) {
    await api.request(`${supergroupPath(ada)}/members/${memberId}`, { method: 'PUT' });
  }
  await requestJson(api, 'PUT', `${supergroupPath(ada)}/administrators/${linus}`, {
    can_delete_messages: true,
  });

  const sendText = async (accountId: number, message: object) => {
    const { status, body } = await requestJson<{ message: ShownMessage }>(
      api,
      'POST',
      `${accountPath(accountId)}/messages`,
      message,
    );
    assertEquals(status, 201, `message ${JSON.stringify(message)} is sent`);
    return body.message;
  };
  const sendToBot = async (text: string) =>
    (await sendText(ada, { to: { type: 'private', botId }, text })).message_id;
  const sendToSupergroup = (accountId: number, text: string, replyToMessageId?: number) =>
    sendText(accountId, {
      to: { type: 'supergroup', chatId: supergroup.id },
      text,
      ...(replyToMessageId === undefined ? {} : { reply_to_message_id: replyToMessageId }),
    });
  const getChat = async (chatId: number) => {
    const { body } = await requestJson<{ result: { pinned_message?: ShownMessage } }>(
      api,
      'POST',
      `${botApiPath}/getChat`,
      { chat_id: chatId },
    );
    return body.result;
  };
  const pinnedTexts = async (chatPath: string) => {
    const { status, body } = await requestJson<{ messages: ShownMessage[] }>(
      api,
      'GET',
      `${chatPath}/pinned-messages`,
    );
    assertEquals(status, 200, `pinned messages of ${chatPath} are listed`);
    return body.messages.map((message) => message.text);
  };
  const changePin = async (method: 'PUT' | 'DELETE', chatPath: string, messageId: number) =>
    (await api.request(`${chatPath}/pinned-messages/${messageId}`, { method })).status;

  const emulatorDisposal = disposalOnFailure.move();
  return {
    api,
    sessionPath,
    ada,
    grace,
    linus,
    botId,
    chatId: supergroup.id,
    privatePath,
    supergroupPath,
    sendToBot,
    sendToSupergroup,
    getChat,
    pinnedTexts,
    changePin,
    [Symbol.asyncDispose]: () => emulatorDisposal.disposeAsync(),
  };
}

Deno.test('an account pins private messages, which getChat shows the newest of', async () => {
  await using fixture = await createPinnedMessagesFixture();
  const { ada, privatePath, sendToBot, getChat, pinnedTexts, changePin } = fixture;
  const firstId = await sendToBot('first');
  const secondId = await sendToBot('second');
  assertEquals((await getChat(ada)).pinned_message, undefined, 'no message is pinned at first');

  assertEquals(await changePin('PUT', privatePath(ada), secondId), 204, 'the newer is pinned');
  assertEquals(await changePin('PUT', privatePath(ada), firstId), 204, 'the older is pinned');
  assertEquals(await pinnedTexts(privatePath(ada)), ['second', 'first'], 'pins are newest first');
  const pinnedMessage = (await getChat(ada)).pinned_message;
  assertEquals(
    [pinnedMessage?.message_id, pinnedMessage?.text],
    [secondId, 'second'],
    'getChat shows the newest by sending order, not the latest pinned',
  );

  assertEquals(await changePin('PUT', privatePath(ada), secondId), 409, 'a repeated pin conflicts');
  assertEquals(
    await changePin('DELETE', privatePath(ada), secondId),
    204,
    'the newest is unpinned',
  );
  assertEquals(
    await changePin('DELETE', privatePath(ada), secondId),
    409,
    'a repeat unpin conflicts',
  );
  assertEquals((await getChat(ada)).pinned_message?.text, 'first', 'getChat shows the next newest');
  assertEquals(await changePin('PUT', privatePath(ada), secondId + 50), 404, 'unknown messages');
});

Deno.test('getChat shows a pinned reply without the message it replies to', async () => {
  await using fixture = await createPinnedMessagesFixture();
  const { chatId, ada, supergroupPath, sendToSupergroup, getChat, changePin } = fixture;
  const question = await sendToSupergroup(ada, 'question');
  const answer = await sendToSupergroup(ada, 'answer', question.message_id);
  assertEquals(answer.reply_to_message === undefined, false, 'the answer is a reply');
  assertEquals(await changePin('PUT', supergroupPath(ada), answer.message_id), 204, 'pinned');

  const pinnedMessage = (await getChat(chatId)).pinned_message;
  assertEquals(pinnedMessage?.text, 'answer', 'getChat shows the pinned reply');
  assertEquals(pinnedMessage?.reply_to_message, undefined, 'without its replied message');
});

Deno.test('supergroup members pin with can_pin_messages and the same pinned messages', async () => {
  await using fixture = await createPinnedMessagesFixture();
  const { api, ada, grace, linus, chatId, supergroupPath, sendToSupergroup, getChat, changePin } =
    fixture;
  const messageId = (await sendToSupergroup(grace, 'rules')).message_id;

  assertEquals(
    await changePin('PUT', supergroupPath(grace), messageId),
    204,
    'defaults allow pins',
  );
  assertEquals((await getChat(chatId)).pinned_message?.text, 'rules', 'getChat shows the pin');
  const shownToLinus = await requestJson<{ messages: ShownMessage[] }>(
    api,
    'GET',
    `${supergroupPath(linus)}/pinned-messages`,
  );
  assertEquals(
    shownToLinus.body.messages.map((message) => message.message_id),
    [messageId],
    'every member sees the same pinned messages',
  );

  await requestJson(api, 'PUT', `${supergroupPath(ada)}/permissions`, {
    permissions: { can_send_messages: true },
  });
  assertEquals(await changePin('DELETE', supergroupPath(grace), messageId), 403, 'members refused');
  assertEquals(await changePin('DELETE', supergroupPath(linus), messageId), 403, 'so is Linus');
  assertEquals(await changePin('DELETE', supergroupPath(ada), messageId), 204, 'the owner unpins');
  assertEquals((await getChat(chatId)).pinned_message, undefined, 'nothing is pinned any more');
});

Deno.test('pin routes refuse service messages, non-members, and unknown chats', async () => {
  await using fixture = await createPinnedMessagesFixture();
  const { api, sessionPath, ada, botId, supergroupPath, privatePath, changePin } = fixture;
  const { body } = await requestJson<{ messages: ShownMessage[] }>(
    api,
    'GET',
    `${supergroupPath(ada)}/messages`,
  );
  const serviceMessageId = body.messages[0].message_id;
  assertEquals(
    await changePin('PUT', supergroupPath(ada), serviceMessageId),
    400,
    'a service message cannot be pinned',
  );

  const outsider = (await createSessionAccount(api, sessionPath, 'Eve')).id;
  assertEquals(
    (await api.request(`${supergroupPath(outsider)}/pinned-messages`)).status,
    403,
    'a non-member cannot read the pins',
  );
  assertEquals(
    await changePin('PUT', supergroupPath(outsider), serviceMessageId),
    403,
    'nor pin',
  );
  assertEquals(
    (await api.request(
      `${sessionPath}/accounts/${ada}/conversations/private/${UNKNOWN_USER_ID}/pinned-messages`,
    ))
      .status,
    404,
    'an unknown bot has no chat',
  );
  assertEquals(
    (await api.request(
      `${sessionPath}/accounts/${UNKNOWN_USER_ID}/conversations/private/${botId}/pinned-messages`,
    ))
      .status,
    404,
    'an unknown account has no chat',
  );
  assertEquals(await changePin('PUT', privatePath(ada), 1), 404, 'an empty chat has no messages');
  assertEquals(
    (await api.request(`${supergroupPath(ada)}/pinned-messages/0`, { method: 'PUT' })).status,
    400,
    'a message ID must be positive',
  );
});

Deno.test('an account that blocks the bot cannot pin in their private chat, but reads pins', async () => {
  await using fixture = await createPinnedMessagesFixture();
  const { api, sessionPath, ada, botId, privatePath, sendToBot, pinnedTexts, changePin } = fixture;
  const messageId = await sendToBot('before the block');
  const otherId = await sendToBot('second');
  assertEquals(await changePin('PUT', privatePath(ada), messageId), 204, 'pinned before the block');
  await api.request(`${sessionPath}/accounts/${ada}/blocked-bots/${botId}`, { method: 'PUT' });

  assertEquals(await changePin('PUT', privatePath(ada), otherId), 409, 'no pin while blocked');
  assertEquals(
    await changePin('DELETE', privatePath(ada), messageId),
    409,
    'no unpin while blocked',
  );
  assertEquals(await pinnedTexts(privatePath(ada)), ['before the block'], 'the pins stay readable');
});

Deno.test('pinned messages of one session stay out of another', async () => {
  await using api = createTestInProcessEmulator();
  await using first = await createPinnedMessagesFixture(api);
  await using second = await createPinnedMessagesFixture(api);
  const messageId = await first.sendToBot('first session');
  await second.sendToBot('second session');

  assertEquals(
    await first.changePin('PUT', first.privatePath(first.ada), messageId),
    204,
    'pinned',
  );
  assertEquals(await second.pinnedTexts(second.privatePath(second.ada)), [], 'not in the other');
  assertEquals((await second.getChat(second.ada)).pinned_message, undefined, 'nor its getChat');
});
