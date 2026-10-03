import { createTestSession, requestJson } from './support/emulation_api.ts';

interface BotApiResponse {
  readonly ok: boolean;
  readonly result?: unknown;
  readonly description?: string;
}

interface ShownMessage {
  readonly message_id: number;
  readonly from?: { readonly id: number };
  readonly chat?: { readonly id: number };
  readonly date?: number;
  readonly text?: string;
  readonly reply_to_message?: unknown;
  readonly pinned_message?: ShownMessage;
}

interface ShownUpdate {
  readonly message?: ShownMessage;
}

interface CreatedBot {
  readonly id: number;
  readonly botApiPath: string;
}

/**
 * Creates a session where Ada has written to the pinning bot and owns a supergroup with Grace, the
 * pinning bot as an administrator with `can_pin_messages`, and a member bot; both bots are in
 * privacy mode, and an outsider bot is in no chat.
 */
async function createPinFixture() {
  const { api, sessionPath } = await createTestSession();
  const createAccount = async (firstName: string) =>
    (await requestJson<{ account: { id: number } }>(
      api,
      'POST',
      `${sessionPath}/accounts`,
      { first_name: firstName },
    )).body.account.id;
  const createBot = async (username: string): Promise<CreatedBot> => {
    const { body } = await requestJson<{ token: string; bot: { id: number } }>(
      api,
      'POST',
      `${sessionPath}/bots`,
      { first_name: 'Test Bot', username },
    );
    return { id: body.bot.id, botApiPath: `${sessionPath}/bot-api/bot${body.token}` };
  };
  const ada = await createAccount('Ada');
  const grace = await createAccount('Grace');
  const pinningBot = await createBot('pinning_bot');
  const memberBot = await createBot('member_bot');
  const outsiderBot = await createBot('outsider_bot');

  const { body: { supergroup } } = await requestJson<{ supergroup: { id: number } }>(
    api,
    'POST',
    `${sessionPath}/accounts/${ada}/supergroups`,
    { title: 'Team' },
  );
  const accountPath = (accountId: number) => `${sessionPath}/accounts/${accountId}`;
  const privatePath = `${accountPath(ada)}/conversations/private/${pinningBot.id}`;
  const supergroupPath = (accountId: number) =>
    `${accountPath(accountId)}/conversations/supergroup/${supergroup.id}`;
  for (const memberId of [grace, pinningBot.id, memberBot.id]) {
    await api.request(`${supergroupPath(ada)}/members/${memberId}`, { method: 'PUT' });
  }
  await requestJson(api, 'PUT', `${supergroupPath(ada)}/administrators/${pinningBot.id}`, {
    can_pin_messages: true,
  });

  const sendText = async (accountId: number, to: object, text: string) => {
    const { status, body } = await requestJson<{ message: ShownMessage }>(
      api,
      'POST',
      `${accountPath(accountId)}/messages`,
      { to, text },
    );
    expectEqual(status, 201, `message ${JSON.stringify(text)} is sent`);
    return body.message.message_id;
  };
  const callBot = async (bot: CreatedBot, method: string, parameters: object) => {
    const { status, body } = await requestJson<BotApiResponse>(
      api,
      'POST',
      `${bot.botApiPath}/${method}`,
      parameters,
    );
    return [status, body.ok ? body.result : body.description] as const;
  };
  const nextOffsets = new Map<number, number>();
  /** Reads a bot's message updates since the last read, as the given subscription allows. */
  const readMessages = async (bot: CreatedBot, allowedUpdates: readonly string[] = ['message']) => {
    const { body } = await requestJson<{ result: Array<ShownUpdate & { update_id: number }> }>(
      api,
      'POST',
      `${bot.botApiPath}/getUpdates`,
      { offset: nextOffsets.get(bot.id) ?? 0, allowed_updates: allowedUpdates },
    );
    const lastUpdateId = body.result.at(-1)?.update_id;
    if (lastUpdateId !== undefined) {
      nextOffsets.set(bot.id, lastUpdateId + 1);
    }
    return body.result.flatMap(({ message }) => message === undefined ? [] : [message]);
  };
  const getHistory = async (chatPath: string) =>
    (await requestJson<{ messages: ShownMessage[] }>(api, 'GET', `${chatPath}/messages`)).body
      .messages;
  const getNotifications = async (chatPath: string) =>
    (await requestJson<{ notifications: Array<{ message_id: number; is_silent: boolean }> }>(
      api,
      'GET',
      `${chatPath}/notifications`,
    )).body.notifications;

  return {
    api,
    sessionPath,
    ada,
    grace,
    pinningBot,
    memberBot,
    outsiderBot,
    chatId: supergroup.id,
    privatePath,
    supergroupPath,
    sendToPinningBot: (text: string) =>
      sendText(ada, { type: 'private', botId: pinningBot.id }, text),
    sendToSupergroup: (accountId: number, text: string) =>
      sendText(accountId, { type: 'supergroup', chatId: supergroup.id }, text),
    callBot,
    readMessages,
    getHistory,
    getNotifications,
  };
}

/** A message as the pinned message of a service message shows it: its text and whether it replies. */
function describePin(message: ShownMessage) {
  return {
    from: message.from?.id,
    pinned: message.pinned_message?.text,
    pinnedId: message.pinned_message?.message_id,
    nestedReply: message.pinned_message?.reply_to_message !== undefined,
  };
}

Deno.test('a bot pins private messages, receives the service messages, and unpins by default', async () => {
  const {
    ada,
    pinningBot,
    privatePath,
    sendToPinningBot,
    callBot,
    readMessages,
    getNotifications,
  } = await createPinFixture();
  const firstId = await sendToPinningBot('first');
  const secondId = await sendToPinningBot('second');
  await readMessages(pinningBot);

  expectEqual(
    await callBot(pinningBot, 'pinChatMessage', { chat_id: ada, message_id: secondId }),
    [200, true],
    'the newer is pinned',
  );
  expectEqual(
    await callBot(pinningBot, 'pinChatMessage', { chat_id: ada, message_id: firstId }),
    [200, true],
    'the older is pinned',
  );
  const serviceMessages = await readMessages(pinningBot);
  expectEqual(
    serviceMessages.map(describePin),
    [
      { from: pinningBot.id, pinned: 'second', pinnedId: secondId, nestedReply: false },
      { from: pinningBot.id, pinned: 'first', pinnedId: firstId, nestedReply: false },
    ],
    "the bot receives its own pins' service messages",
  );
  expectEqual(
    (await getNotifications(privatePath)).filter(({ message_id }) =>
      serviceMessages.some((message) => message.message_id === message_id)
    ).map(({ is_silent }) => is_silent),
    [true, true],
    'pins notify the account without sound in a private chat',
  );
  const [, chat] = await callBot(pinningBot, 'getChat', { chat_id: ada });
  expectEqual(
    (chat as { pinned_message?: ShownMessage }).pinned_message?.text,
    'second',
    'getChat shows the newest pin',
  );

  expectEqual(
    await callBot(pinningBot, 'pinChatMessage', { chat_id: ada, message_id: firstId }),
    [400, 'Bad Request: CHAT_NOT_MODIFIED'],
    'a repeated pin is refused',
  );
  expectEqual(
    await callBot(pinningBot, 'unpinChatMessage', { chat_id: ada }),
    [200, true],
    'an unpin without a target unpins the newest',
  );
  expectEqual(
    await callBot(pinningBot, 'unpinChatMessage', { chat_id: ada, message_id: secondId }),
    [400, 'Bad Request: CHAT_NOT_MODIFIED'],
    'the newest was the one unpinned',
  );
  expectEqual(
    await callBot(pinningBot, 'unpinChatMessage', { chat_id: ada, message_id: 0 }),
    [200, true],
    'a zero message_id is no target either',
  );
  expectEqual(
    await callBot(pinningBot, 'unpinChatMessage', { chat_id: ada }),
    [400, 'Bad Request: message to unpin not found'],
    'nothing is left to unpin',
  );
  expectEqual(await readMessages(pinningBot), [], 'unpins record no service message');
});

Deno.test('a bot receives the service message of an account pin in its private chat', async () => {
  const { ada, pinningBot, privatePath, api, sendToPinningBot, readMessages } =
    await createPinFixture();
  const messageId = await sendToPinningBot('hello');
  await readMessages(pinningBot);

  await api.request(`${privatePath}/pinned-messages/${messageId}`, { method: 'PUT' });
  const [serviceMessage] = await readMessages(pinningBot);
  expectEqual(
    serviceMessage === undefined ? undefined : describePin(serviceMessage),
    { from: ada, pinned: 'hello', pinnedId: messageId, nestedReply: false },
    'the account authored the service message',
  );
});

Deno.test('supergroup pins need can_pin_messages and reach every bot as a service message', async () => {
  const {
    grace,
    chatId,
    pinningBot,
    memberBot,
    supergroupPath,
    sendToSupergroup,
    callBot,
    readMessages,
    getNotifications,
  } = await createPinFixture();
  const messageId = await sendToSupergroup(grace, 'rules');
  await readMessages(pinningBot);
  await readMessages(memberBot);

  expectEqual(
    await callBot(memberBot, 'pinChatMessage', { chat_id: chatId, message_id: messageId }),
    [400, 'Bad Request: not enough rights to manage pinned messages in the chat'],
    'a member bot gets no pin right from the default permissions',
  );
  expectEqual(
    await callBot(pinningBot, 'pinChatMessage', {
      chat_id: chatId,
      message_id: messageId,
      disable_notification: true,
    }),
    [200, true],
    'an administrator with the right pins',
  );
  for (const bot of [pinningBot, memberBot]) {
    expectEqual(
      (await readMessages(bot)).map(describePin),
      [{ from: pinningBot.id, pinned: 'rules', pinnedId: messageId, nestedReply: false }],
      `bot ${bot.id} receives the service message despite privacy mode`,
    );
  }
  expectEqual(
    (await getNotifications(supergroupPath(grace))).at(-1)?.is_silent,
    true,
    'disable_notification makes the pin silent',
  );
  expectEqual(
    await callBot(memberBot, 'unpinChatMessage', { chat_id: chatId }),
    [400, 'Bad Request: not enough rights to manage pinned messages in the chat'],
    'unpinning needs the right too',
  );
  expectEqual(
    await callBot(pinningBot, 'unpinChatMessage', { chat_id: chatId, message_id: messageId }),
    [200, true],
    'the administrator unpins',
  );
});

Deno.test('pin methods refuse unknown chats and messages, service messages, and bad parameters', async () => {
  const {
    api,
    sessionPath,
    ada,
    grace,
    chatId,
    pinningBot,
    outsiderBot,
    supergroupPath,
    getHistory,
    callBot,
    sendToPinningBot,
  } = await createPinFixture();
  const serviceMessageId = (await getHistory(supergroupPath(ada)))[0].message_id;
  const cases: Array<[CreatedBot, string, object, readonly [number, unknown]]> = [
    [pinningBot, 'pinChatMessage', { message_id: 1 }, [400, 'Bad Request: chat_id is empty']],
    [
      outsiderBot,
      'pinChatMessage',
      { chat_id: chatId, message_id: serviceMessageId },
      [400, 'Bad Request: chat not found'],
    ],
    [
      pinningBot,
      'pinChatMessage',
      { chat_id: grace, message_id: 1 },
      [400, 'Bad Request: chat not found'],
    ],
    [
      pinningBot,
      'pinChatMessage',
      { chat_id: chatId },
      [400, 'Bad Request: message to pin not found'],
    ],
    [
      pinningBot,
      'pinChatMessage',
      { chat_id: chatId, message_id: serviceMessageId + 100 },
      [400, 'Bad Request: message to pin not found'],
    ],
    [
      pinningBot,
      'pinChatMessage',
      { chat_id: chatId, message_id: serviceMessageId },
      [400, "Bad Request: service messages can't be pinned"],
    ],
    [
      pinningBot,
      'unpinChatMessage',
      { chat_id: chatId, message_id: serviceMessageId },
      [400, "Bad Request: service messages can't be pinned"],
    ],
    [
      pinningBot,
      'unpinChatMessage',
      { chat_id: chatId, message_id: -1 },
      [400, 'Bad Request: invalid unpinChatMessage parameters'],
    ],
    [
      pinningBot,
      'pinChatMessage',
      { chat_id: chatId, message_id: serviceMessageId, business_connection_id: 'connection' },
      [400, 'Bad Request: invalid pinChatMessage parameters'],
    ],
  ];
  for (const [bot, method, parameters, expected] of cases) {
    expectEqual(
      await callBot(bot, method, parameters),
      expected,
      `${method} ${JSON.stringify(parameters)}`,
    );
  }

  const privateMessageId = await sendToPinningBot('hello');
  await api.request(`${sessionPath}/accounts/${ada}/blocked-bots/${pinningBot.id}`, {
    method: 'PUT',
  });
  expectEqual(
    await callBot(pinningBot, 'pinChatMessage', { chat_id: ada, message_id: privateMessageId }),
    [403, 'Forbidden: bot was blocked by the user'],
    'a blocked bot cannot pin in the private chat',
  );
  expectEqual(
    await callBot(pinningBot, 'unpinChatMessage', { chat_id: ada }),
    [403, 'Forbidden: bot was blocked by the user'],
    'nor unpin',
  );
  await api.request(`${supergroupPath(ada)}/members/${pinningBot.id}`, { method: 'DELETE' });
  expectEqual(
    await callBot(pinningBot, 'unpinChatMessage', { chat_id: chatId }),
    [403, 'Forbidden: bot was kicked from the supergroup chat'],
    'a removed bot is turned away',
  );
});

Deno.test('a pin service message shows a deleted pinned message as inaccessible', async () => {
  const { ada, chatId, pinningBot, supergroupPath, sendToSupergroup, callBot, api, getHistory } =
    await createPinFixture();
  const messageId = await sendToSupergroup(ada, 'soon gone');
  await callBot(pinningBot, 'pinChatMessage', { chat_id: chatId, message_id: messageId });
  await api.request(`${supergroupPath(ada)}/messages/${messageId}`, { method: 'DELETE' });

  const serviceMessage = (await getHistory(supergroupPath(ada))).at(-1);
  expectEqual(
    serviceMessage?.pinned_message,
    { message_id: messageId, chat: { id: chatId, title: 'Team', type: 'supergroup' }, date: 0 },
    'the pinned message is inaccessible',
  );
  expectEqual(
    await callBot(pinningBot, 'unpinChatMessage', { chat_id: chatId, message_id: messageId }),
    [400, 'Bad Request: message to unpin not found'],
    'a deleted message cannot be unpinned',
  );
});

Deno.test('a bot that excludes message updates still pins, and the call is recorded', async () => {
  const { api, sessionPath, ada, pinningBot, sendToPinningBot, callBot, readMessages } =
    await createPinFixture();
  // Telegram applies a subscription to updates created after it changes.
  await readMessages(pinningBot, ['callback_query']);
  const messageId = await sendToPinningBot('hello');
  expectEqual(await readMessages(pinningBot, ['callback_query']), [], 'messages are excluded');

  expectEqual(
    await callBot(pinningBot, 'pinChatMessage', { chat_id: ada, message_id: messageId }),
    [200, true],
    'the pin succeeds',
  );
  expectEqual(await readMessages(pinningBot, ['message']), [], 'the service message was dropped');
  const { body } = await requestJson<{
    entries: Array<{ method: string; chat_id?: number; answer: { ok: boolean } }>;
  }>(api, 'GET', `${sessionPath}/bot-activity?bot_id=${pinningBot.id}&method=pinChatMessage`);
  expectEqual(
    body.entries.map(({ method, chat_id, answer }) => [method, chat_id, answer.ok]),
    [['pinChatMessage', ada, true]],
    'the activity log records the call with its chat',
  );
});

function expectEqual(actual: unknown, expected: unknown, message: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `${message}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`,
    );
  }
}
