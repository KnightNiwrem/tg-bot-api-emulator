import { createEmulationApi } from '../src/api/mod.ts';
import { createSessionLifecycleService } from '../src/composition/session_lifecycle.ts';

type EmulationApi = ReturnType<typeof createEmulationApi>;

interface BotApiResponse {
  readonly ok: boolean;
  readonly result?: unknown;
  readonly description?: string;
}

interface ShownMessage {
  readonly message_id: number;
  readonly chat?: { readonly id: number };
  readonly date?: number;
  readonly text?: string;
  readonly edit_date?: number;
  readonly reply_to_message?: ShownMessage;
  readonly pinned_message?: ShownMessage;
}

interface CreatedBot {
  readonly id: number;
  readonly botApiPath: string;
}

/**
 * Creates a session where Ada has written to a bot and owns a supergroup with Grace, that bot as an
 * administrator with `can_pin_messages`, and an observer bot in privacy mode.
 */
async function createReconciliationFixture() {
  const api = createEmulationApi({
    sessionLifecycle: createSessionLifecycleService(),
    publicOrigin: 'http://emulator.example:9000',
  });
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
  const observerBot = await createBot('observer_bot');

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
  for (const memberId of [grace, pinningBot.id, observerBot.id]) {
    await api.request(`${supergroupPath(ada)}/members/${memberId}`, { method: 'PUT' });
  }
  await requestJson(api, 'PUT', `${supergroupPath(ada)}/administrators/${pinningBot.id}`, {
    can_pin_messages: true,
  });

  const send = async (accountId: number, message: object) => {
    const { status, body } = await requestJson<{ message: ShownMessage }>(
      api,
      'POST',
      `${accountPath(accountId)}/messages`,
      message,
    );
    expectEqual(status, 201, `message ${JSON.stringify(message)} is sent`);
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
  /** Reads a bot's new and edited messages since the last read. */
  const readUpdates = async (bot: CreatedBot) => {
    const { body } = await requestJson<{
      result: Array<{ update_id: number; message?: ShownMessage; edited_message?: ShownMessage }>;
    }>(api, 'POST', `${bot.botApiPath}/getUpdates`, {
      offset: nextOffsets.get(bot.id) ?? 0,
      allowed_updates: ['message', 'edited_message'],
    });
    const lastUpdateId = body.result.at(-1)?.update_id;
    if (lastUpdateId !== undefined) {
      nextOffsets.set(bot.id, lastUpdateId + 1);
    }
    return body.result.map(({ update_id: _updateId, ...update }) => update);
  };
  const getHistory = async (chatPath: string) =>
    (await requestJson<{ messages: ShownMessage[] }>(api, 'GET', `${chatPath}/messages`)).body
      .messages;
  const getPinnedIds = async (chatPath: string) =>
    (await requestJson<{ messages: ShownMessage[] }>(api, 'GET', `${chatPath}/pinned-messages`))
      .body.messages.map(({ message_id }) => message_id);
  const getChatPinnedMessage = async (bot: CreatedBot, chatId: number) => {
    const [status, chat] = await callBot(bot, 'getChat', { chat_id: chatId });
    if (status !== 200) {
      throw new Error(`getChat for ${chatId} failed with ${status}: ${chat}`);
    }
    return (chat as { pinned_message?: ShownMessage }).pinned_message;
  };

  return {
    api,
    ada,
    grace,
    pinningBot,
    observerBot,
    chatId: supergroup.id,
    privatePath,
    supergroupPath,
    sendToPinningBot: (text: string, replyToMessageId?: number) =>
      send(ada, {
        to: { type: 'private', botId: pinningBot.id },
        text,
        ...(replyToMessageId === undefined ? {} : { reply_to_message_id: replyToMessageId }),
      }),
    sendToSupergroup: (accountId: number, text: string) =>
      send(accountId, { to: { type: 'supergroup', chatId: supergroup.id }, text }),
    callBot,
    readUpdates,
    getHistory,
    getPinnedIds,
    getChatPinnedMessage,
  };
}

Deno.test('an edited pinned message stays pinned and shows its edit wherever it is pinned', async () => {
  const {
    api,
    grace,
    chatId,
    pinningBot,
    observerBot,
    supergroupPath,
    sendToSupergroup,
    callBot,
    readUpdates,
    getHistory,
    getChatPinnedMessage,
  } = await createReconciliationFixture();
  const messageId = await sendToSupergroup(grace, 'draft');
  await callBot(pinningBot, 'pinChatMessage', { chat_id: chatId, message_id: messageId });
  await readUpdates(pinningBot);
  await readUpdates(observerBot);

  await requestJson(api, 'PATCH', `${supergroupPath(grace)}/messages/${messageId}`, {
    text: 'final',
  });
  expectEqual(
    (await readUpdates(pinningBot)).map((update) => Object.keys(update)),
    [['edited_message']],
    'the edit reaches the administrator bot as an edit, with no further pin update',
  );
  expectEqual(
    await readUpdates(observerBot),
    [],
    'the observer in privacy mode receives neither the edit nor a pin update',
  );
  for (const bot of [pinningBot, observerBot]) {
    const pinnedMessage = await getChatPinnedMessage(bot, chatId);
    expectEqual(
      [pinnedMessage?.text, typeof pinnedMessage?.edit_date],
      ['final', 'number'],
      `getChat shows bot ${bot.id} the edited pin`,
    );
  }
  const serviceMessage = (await getHistory(supergroupPath(grace))).at(-1);
  expectEqual(
    serviceMessage?.pinned_message?.text,
    'final',
    'the service message shows the pinned message as it is now',
  );
});

Deno.test('deleting a pinned message unpins it, and getChat shows the next newest', async () => {
  const {
    api,
    ada,
    pinningBot,
    privatePath,
    sendToPinningBot,
    callBot,
    getPinnedIds,
    getChatPinnedMessage,
  } = await createReconciliationFixture();
  const olderId = await sendToPinningBot('older');
  const newerId = await sendToPinningBot('newer');
  for (const messageId of [olderId, newerId]) {
    await callBot(pinningBot, 'pinChatMessage', { chat_id: ada, message_id: messageId });
  }

  expectEqual(
    await callBot(pinningBot, 'deleteMessage', { chat_id: ada, message_id: newerId }),
    [200, true],
    'the bot deletes the newest pin',
  );
  expectEqual(await getPinnedIds(privatePath), [olderId], 'the deleted message is unpinned');
  expectEqual(
    (await getChatPinnedMessage(pinningBot, ada))?.message_id,
    olderId,
    'getChat shows the next newest pin',
  );
  expectEqual(
    await callBot(pinningBot, 'pinChatMessage', { chat_id: ada, message_id: newerId }),
    [400, 'Bad Request: message to pin not found'],
    'a deleted message cannot be pinned again',
  );
  await api.request(`${privatePath}/messages/${olderId}`, { method: 'DELETE' });
  expectEqual(await getPinnedIds(privatePath), [], 'an account deletion unpins too');
  expectEqual(await getChatPinnedMessage(pinningBot, ada), undefined, 'getChat shows no pin');
  expectEqual(
    await callBot(pinningBot, 'unpinChatMessage', { chat_id: ada }),
    [400, 'Bad Request: message to unpin not found'],
    'nothing is left to unpin',
  );
});

Deno.test('deleting a pin service message leaves the message pinned', async () => {
  const { ada, pinningBot, privatePath, sendToPinningBot, callBot, getHistory, getPinnedIds } =
    await createReconciliationFixture();
  const messageId = await sendToPinningBot('keep');
  await callBot(pinningBot, 'pinChatMessage', { chat_id: ada, message_id: messageId });
  const serviceMessageId = (await getHistory(privatePath)).at(-1)?.message_id;

  expectEqual(
    await callBot(pinningBot, 'deleteMessage', { chat_id: ada, message_id: serviceMessageId }),
    [200, true],
    'the bot deletes its pin service message',
  );
  expectEqual(await getPinnedIds(privatePath), [messageId], 'the message stays pinned');
  expectEqual(
    (await getHistory(privatePath)).map(({ message_id }) => message_id),
    [messageId],
    'the history no longer shows the service message',
  );
});

Deno.test('pinning again after an unpin records another service message', async () => {
  const { ada, pinningBot, privatePath, sendToPinningBot, callBot, getHistory, readUpdates } =
    await createReconciliationFixture();
  const messageId = await sendToPinningBot('again');
  await readUpdates(pinningBot);
  await callBot(pinningBot, 'pinChatMessage', { chat_id: ada, message_id: messageId });
  await callBot(pinningBot, 'unpinChatMessage', { chat_id: ada, message_id: messageId });
  await callBot(pinningBot, 'pinChatMessage', { chat_id: ada, message_id: messageId });

  expectEqual(
    (await readUpdates(pinningBot)).map(({ message }) => message?.pinned_message?.message_id),
    [messageId, messageId],
    'each pin is its own service message, and the unpin none',
  );
  expectEqual(
    (await getHistory(privatePath)).filter(({ pinned_message }) => pinned_message !== undefined)
      .length,
    2,
    'the history shows both pins',
  );
});

Deno.test('a reply to a pin service message shows its pin, and nothing once the pin is deleted', async () => {
  const { ada, pinningBot, privatePath, sendToPinningBot, callBot, api, getHistory } =
    await createReconciliationFixture();
  const pinnedId = await sendToPinningBot('pinned');
  await callBot(pinningBot, 'pinChatMessage', { chat_id: ada, message_id: pinnedId });
  const serviceMessageId = (await getHistory(privatePath)).at(-1)?.message_id;
  const replyId = await sendToPinningBot('about that pin', serviceMessageId);

  const replyBefore = (await getHistory(privatePath)).find(({ message_id }) =>
    message_id === replyId
  );
  expectEqual(
    [
      replyBefore?.reply_to_message?.message_id,
      replyBefore?.reply_to_message?.pinned_message?.text,
    ],
    [serviceMessageId, 'pinned'],
    'the replied service message shows the pinned message',
  );
  await api.request(`${privatePath}/messages/${pinnedId}`, { method: 'DELETE' });
  const history = await getHistory(privatePath);
  const replyAfter = history.find(({ message_id }) => message_id === replyId);
  expectEqual(
    replyAfter?.reply_to_message === undefined
      ? 'no reply'
      : 'pinned_message' in replyAfter.reply_to_message,
    false,
    'a replied service message shows nothing for a deleted pin',
  );
  const serviceMessage = history.find(({ message_id }) => message_id === serviceMessageId);
  expectEqual(
    serviceMessage?.pinned_message,
    { message_id: pinnedId, chat: serviceMessage?.chat, date: 0 },
    'the service message itself shows the pin as inaccessible',
  );
});

Deno.test('pin service messages cannot be edited, forwarded, or copied, and copies are not pinned', async () => {
  const {
    ada,
    chatId,
    pinningBot,
    privatePath,
    sendToPinningBot,
    callBot,
    getHistory,
    getPinnedIds,
  } = await createReconciliationFixture();
  const messageId = await sendToPinningBot('original');
  await callBot(pinningBot, 'pinChatMessage', { chat_id: ada, message_id: messageId });
  const serviceMessageId = (await getHistory(privatePath)).at(-1)?.message_id;

  expectEqual(
    await callBot(pinningBot, 'editMessageText', {
      chat_id: ada,
      message_id: serviceMessageId,
      text: 'edited',
    }),
    [400, "Bad Request: message can't be edited"],
    'the bot cannot edit its pin service message',
  );
  expectEqual(
    await callBot(pinningBot, 'copyMessage', {
      chat_id: chatId,
      from_chat_id: ada,
      message_id: serviceMessageId,
    }),
    [400, "Bad Request: the message can't be copied"],
    'a pin service message cannot be copied',
  );
  expectEqual(
    await callBot(pinningBot, 'forwardMessage', {
      chat_id: chatId,
      from_chat_id: ada,
      message_id: serviceMessageId,
    }),
    [400, "Bad Request: the message can't be forwarded"],
    'nor forwarded',
  );
  const [copyStatus, copy] = await callBot(pinningBot, 'copyMessage', {
    chat_id: ada,
    from_chat_id: ada,
    message_id: messageId,
  });
  expectEqual(copyStatus, 200, 'a pinned message can be copied');
  const copyId = (copy as { message_id: number }).message_id;
  expectEqual(copyId > messageId, true, 'the copy is a new message');
  expectEqual(await getPinnedIds(privatePath), [messageId], 'only the original is pinned');
});

async function requestJson<Body>(
  api: EmulationApi,
  method: 'DELETE' | 'GET' | 'PATCH' | 'POST' | 'PUT',
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
