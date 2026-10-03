import { createEmulationApi } from '../src/api/mod.ts';
import { createSessionLifecycleService } from '../src/composition/session_lifecycle.ts';

type EmulationApi = ReturnType<typeof createEmulationApi>;

/** A user ID that no account or bot of a fixture has. */
const UNKNOWN_USER_ID = 999_999;

interface ShownMessage {
  readonly message_id: number;
  readonly text?: string;
  readonly reply_to_message?: unknown;
}

/**
 * Creates a session where Ada has written to a bot and owns a supergroup with Grace, the bot, and
 * Linus, an administrator account without the right to pin.
 */
async function createPinnedMessagesFixture(api: EmulationApi = createApi()) {
  const sessionPath = (await api.request('/sessions', { method: 'POST' })).headers.get('Location');
  if (sessionPath === null) {
    throw new Error('Expected the created session to have a Location');
  }
  const createAccount = async (firstName: string) =>
    (await requestJson<{ account: { id: number } }>(
      api,
      'POST',
      `${sessionPath}/accounts`,
      { first_name: firstName },
    )).body.account.id;
  const ada = await createAccount('Ada');
  const grace = await createAccount('Grace');
  const linus = await createAccount('Linus');
  const { body: createdBot } = await requestJson<{ token: string; bot: { id: number } }>(
    api,
    'POST',
    `${sessionPath}/bots`,
    { first_name: 'Test Bot', username: 'test_bot' },
  );
  const botId = createdBot.bot.id;
  const botApiPath = `${sessionPath}/bot-api/bot${createdBot.token}`;

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
    expectEqual(status, 201, `message ${JSON.stringify(message)} is sent`);
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
    expectEqual(status, 200, `pinned messages of ${chatPath} are listed`);
    return body.messages.map((message) => message.text);
  };
  const changePin = async (method: 'PUT' | 'DELETE', chatPath: string, messageId: number) =>
    (await api.request(`${chatPath}/pinned-messages/${messageId}`, { method })).status;

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
  };
}

function createApi(): EmulationApi {
  return createEmulationApi({
    sessionLifecycle: createSessionLifecycleService(),
    publicOrigin: 'http://emulator.example:9000',
  });
}

Deno.test('an account pins private messages, which getChat shows the newest of', async () => {
  const { ada, privatePath, sendToBot, getChat, pinnedTexts, changePin } =
    await createPinnedMessagesFixture();
  const firstId = await sendToBot('first');
  const secondId = await sendToBot('second');
  expectEqual((await getChat(ada)).pinned_message, undefined, 'no message is pinned at first');

  expectEqual(await changePin('PUT', privatePath(ada), secondId), 204, 'the newer is pinned');
  expectEqual(await changePin('PUT', privatePath(ada), firstId), 204, 'the older is pinned');
  expectEqual(await pinnedTexts(privatePath(ada)), ['second', 'first'], 'pins are newest first');
  const pinnedMessage = (await getChat(ada)).pinned_message;
  expectEqual(
    [pinnedMessage?.message_id, pinnedMessage?.text],
    [secondId, 'second'],
    'getChat shows the newest by sending order, not the latest pinned',
  );

  expectEqual(await changePin('PUT', privatePath(ada), secondId), 409, 'a repeated pin conflicts');
  expectEqual(await changePin('DELETE', privatePath(ada), secondId), 204, 'the newest is unpinned');
  expectEqual(
    await changePin('DELETE', privatePath(ada), secondId),
    409,
    'a repeat unpin conflicts',
  );
  expectEqual((await getChat(ada)).pinned_message?.text, 'first', 'getChat shows the next newest');
  expectEqual(await changePin('PUT', privatePath(ada), secondId + 50), 404, 'unknown messages');
});

Deno.test('getChat shows a pinned reply without the message it replies to', async () => {
  const { chatId, ada, supergroupPath, sendToSupergroup, getChat, changePin } =
    await createPinnedMessagesFixture();
  const question = await sendToSupergroup(ada, 'question');
  const answer = await sendToSupergroup(ada, 'answer', question.message_id);
  expectEqual(answer.reply_to_message === undefined, false, 'the answer is a reply');
  expectEqual(await changePin('PUT', supergroupPath(ada), answer.message_id), 204, 'pinned');

  const pinnedMessage = (await getChat(chatId)).pinned_message;
  expectEqual(pinnedMessage?.text, 'answer', 'getChat shows the pinned reply');
  expectEqual(pinnedMessage?.reply_to_message, undefined, 'without its replied message');
});

Deno.test('supergroup members pin with can_pin_messages and the same pinned messages', async () => {
  const { api, ada, grace, linus, chatId, supergroupPath, sendToSupergroup, getChat, changePin } =
    await createPinnedMessagesFixture();
  const messageId = (await sendToSupergroup(grace, 'rules')).message_id;

  expectEqual(await changePin('PUT', supergroupPath(grace), messageId), 204, 'defaults allow pins');
  expectEqual((await getChat(chatId)).pinned_message?.text, 'rules', 'getChat shows the pin');
  const shownToLinus = await requestJson<{ messages: ShownMessage[] }>(
    api,
    'GET',
    `${supergroupPath(linus)}/pinned-messages`,
  );
  expectEqual(
    shownToLinus.body.messages.map((message) => message.message_id),
    [messageId],
    'every member sees the same pinned messages',
  );

  await requestJson(api, 'PUT', `${supergroupPath(ada)}/permissions`, {
    permissions: { can_send_messages: true },
  });
  expectEqual(await changePin('DELETE', supergroupPath(grace), messageId), 403, 'members refused');
  expectEqual(await changePin('DELETE', supergroupPath(linus), messageId), 403, 'so is Linus');
  expectEqual(await changePin('DELETE', supergroupPath(ada), messageId), 204, 'the owner unpins');
  expectEqual((await getChat(chatId)).pinned_message, undefined, 'nothing is pinned any more');
});

Deno.test('pin routes refuse service messages, non-members, and unknown chats', async () => {
  const { api, sessionPath, ada, botId, supergroupPath, privatePath, changePin } =
    await createPinnedMessagesFixture();
  const { body } = await requestJson<{ messages: ShownMessage[] }>(
    api,
    'GET',
    `${supergroupPath(ada)}/messages`,
  );
  const serviceMessageId = body.messages[0].message_id;
  expectEqual(
    await changePin('PUT', supergroupPath(ada), serviceMessageId),
    400,
    'a service message cannot be pinned',
  );

  const outsider = (await requestJson<{ account: { id: number } }>(
    api,
    'POST',
    `${sessionPath}/accounts`,
    { first_name: 'Eve' },
  )).body.account.id;
  expectEqual(
    (await api.request(`${supergroupPath(outsider)}/pinned-messages`)).status,
    403,
    'a non-member cannot read the pins',
  );
  expectEqual(
    await changePin('PUT', supergroupPath(outsider), serviceMessageId),
    403,
    'nor pin',
  );
  expectEqual(
    (await api.request(
      `${sessionPath}/accounts/${ada}/conversations/private/${UNKNOWN_USER_ID}/pinned-messages`,
    ))
      .status,
    404,
    'an unknown bot has no chat',
  );
  expectEqual(
    (await api.request(
      `${sessionPath}/accounts/${UNKNOWN_USER_ID}/conversations/private/${botId}/pinned-messages`,
    ))
      .status,
    404,
    'an unknown account has no chat',
  );
  expectEqual(await changePin('PUT', privatePath(ada), 1), 404, 'an empty chat has no messages');
  expectEqual(
    (await api.request(`${supergroupPath(ada)}/pinned-messages/0`, { method: 'PUT' })).status,
    400,
    'a message ID must be positive',
  );
});

Deno.test('an account that blocks the bot cannot pin in their private chat, but reads pins', async () => {
  const { api, sessionPath, ada, botId, privatePath, sendToBot, pinnedTexts, changePin } =
    await createPinnedMessagesFixture();
  const messageId = await sendToBot('before the block');
  expectEqual(await changePin('PUT', privatePath(ada), messageId), 204, 'pinned before the block');
  await api.request(`${sessionPath}/accounts/${ada}/blocked-bots/${botId}`, { method: 'PUT' });

  expectEqual(
    await changePin('DELETE', privatePath(ada), messageId),
    409,
    'no unpin while blocked',
  );
  expectEqual(await pinnedTexts(privatePath(ada)), ['before the block'], 'the pins stay readable');
});

Deno.test('pinned messages of one session stay out of another', async () => {
  const api = createApi();
  const first = await createPinnedMessagesFixture(api);
  const second = await createPinnedMessagesFixture(api);
  const messageId = await first.sendToBot('first session');
  await second.sendToBot('second session');

  expectEqual(await first.changePin('PUT', first.privatePath(first.ada), messageId), 204, 'pinned');
  expectEqual(await second.pinnedTexts(second.privatePath(second.ada)), [], 'not in the other');
  expectEqual((await second.getChat(second.ada)).pinned_message, undefined, 'nor its getChat');
});

async function requestJson<Body>(
  api: EmulationApi,
  method: 'DELETE' | 'GET' | 'POST' | 'PUT',
  path: string,
  body?: unknown,
): Promise<{ status: number; body: Body }> {
  const response = await api.request(path, {
    method,
    ...(body === undefined
      ? {}
      : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  });
  const text = await response.text();
  return {
    status: response.status,
    body: (text.length === 0 ? undefined : JSON.parse(text)) as Body,
  };
}

function expectEqual(actual: unknown, expected: unknown, message: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `${message}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`,
    );
  }
}
