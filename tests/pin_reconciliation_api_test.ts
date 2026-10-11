import { assertEquals } from '@std/assert';
import { assertEqualsInFieldOrder } from './support/field_order_assertion.ts';
import { createUpdateReader, withoutUpdateIds } from './support/bot_api_requests.ts';
import { createTestSession, requestJson } from './support/emulation_api.ts';
import {
  createAccount as createSessionAccount,
  createBot as createSessionBot,
} from './support/http_fixtures.ts';

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
  const { api, sessionPath } = await createTestSession();
  const createAccount = async (firstName: string) =>
    (await createSessionAccount(api, sessionPath, firstName)).id;
  const createBot = async (username: string): Promise<CreatedBot> => {
    const { bot, botApiPath } = await createSessionBot(api, sessionPath, username);
    return { id: bot.id, botApiPath };
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
    assertEquals(status, 201, `message ${JSON.stringify(message)} is sent`);
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
  const readBotUpdates = createUpdateReader(api);
  /** Reads a bot's new and edited messages since the last read. */
  const readUpdates = async (bot: CreatedBot) =>
    withoutUpdateIds(
      await readBotUpdates(bot.botApiPath, ['message', 'edited_message']),
    ) as Array<{ message?: ShownMessage; edited_message?: ShownMessage }>;
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
  const editUpdates = await readUpdates(pinningBot);
  const editDate = editUpdates[0]?.edited_message?.edit_date;
  assertEquals(
    editUpdates.map((update) => Object.keys(update)),
    [['edited_message']],
    'the edit reaches the administrator bot as an edit, with no further pin update',
  );
  assertEquals(
    await readUpdates(observerBot),
    [],
    'the observer in privacy mode receives neither the edit nor a pin update',
  );
  for (const bot of [pinningBot, observerBot]) {
    const pinnedMessage = await getChatPinnedMessage(bot, chatId);
    assertEquals(
      [pinnedMessage?.text, typeof pinnedMessage?.edit_date],
      ['final', 'number'],
      `getChat shows bot ${bot.id} the edited pin`,
    );
  }
  const serviceMessage = (await getHistory(supergroupPath(grace))).at(-1);
  assertEquals(
    [serviceMessage?.pinned_message?.text, serviceMessage?.pinned_message?.edit_date],
    ['final', editDate],
    'the service message shows the pinned message as it is now, with its edit date',
  );
  assertEquals(typeof editDate, 'number', 'the edit is dated');
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

  assertEquals(
    await callBot(pinningBot, 'deleteMessage', { chat_id: ada, message_id: newerId }),
    [200, true],
    'the bot deletes the newest pin',
  );
  assertEquals(await getPinnedIds(privatePath), [olderId], 'the deleted message is unpinned');
  assertEquals(
    (await getChatPinnedMessage(pinningBot, ada))?.message_id,
    olderId,
    'getChat shows the next newest pin',
  );
  assertEquals(
    await callBot(pinningBot, 'pinChatMessage', { chat_id: ada, message_id: newerId }),
    [400, 'Bad Request: message to pin not found'],
    'a deleted message cannot be pinned again',
  );
  await api.request(`${privatePath}/messages/${olderId}`, { method: 'DELETE' });
  assertEquals(await getPinnedIds(privatePath), [], 'an account deletion unpins too');
  assertEquals(await getChatPinnedMessage(pinningBot, ada), undefined, 'getChat shows no pin');
  assertEquals(
    await callBot(pinningBot, 'unpinChatMessage', { chat_id: ada }),
    [400, 'Bad Request: message to unpin not found'],
    'nothing is left to unpin',
  );
});

Deno.test('a queued pin update keeps the pinned message as it was when it was created', async () => {
  const { ada, pinningBot, privatePath, api, sendToPinningBot, callBot, readUpdates } =
    await createReconciliationFixture();
  const messageId = await sendToPinningBot('soon gone');
  await readUpdates(pinningBot);
  await callBot(pinningBot, 'pinChatMessage', { chat_id: ada, message_id: messageId });
  const deletion = await api.request(`${privatePath}/messages/${messageId}`, { method: 'DELETE' });
  assertEquals(deletion.status, 204, 'the account deletes the pinned message');

  const [pinUpdate] = await readUpdates(pinningBot);
  assertEquals(
    [pinUpdate?.message?.pinned_message?.message_id, pinUpdate?.message?.pinned_message?.text],
    [messageId, 'soon gone'],
    'the pending update shows the pinned message from before its deletion',
  );
});

Deno.test('deleting a pin service message leaves the message pinned', async () => {
  const { ada, pinningBot, privatePath, sendToPinningBot, callBot, getHistory, getPinnedIds } =
    await createReconciliationFixture();
  const messageId = await sendToPinningBot('keep');
  await callBot(pinningBot, 'pinChatMessage', { chat_id: ada, message_id: messageId });
  const serviceMessageId = (await getHistory(privatePath)).at(-1)?.message_id;

  assertEquals(
    await callBot(pinningBot, 'deleteMessage', { chat_id: ada, message_id: serviceMessageId }),
    [200, true],
    'the bot deletes its pin service message',
  );
  assertEquals(await getPinnedIds(privatePath), [messageId], 'the message stays pinned');
  assertEquals(
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

  assertEquals(
    (await readUpdates(pinningBot)).map(({ message }) => message?.pinned_message?.message_id),
    [messageId, messageId],
    'each pin is its own service message, and the unpin none',
  );
  assertEquals(
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
  assertEquals(
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
  assertEquals(
    replyAfter?.reply_to_message === undefined
      ? 'no reply'
      : 'pinned_message' in replyAfter.reply_to_message,
    false,
    'a replied service message shows nothing for a deleted pin',
  );
  const serviceMessage = history.find(({ message_id }) => message_id === serviceMessageId);
  assertEqualsInFieldOrder(
    serviceMessage?.pinned_message,
    { message_id: pinnedId, chat: { id: ada, type: 'private', first_name: 'Ada' }, date: 0 },
    'the service message itself shows the pin as inaccessible',
  );
});

Deno.test('pin service messages cannot be edited, forwarded, or copied, and copies and forwards of a pin are not pinned', async () => {
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

  assertEquals(
    await callBot(pinningBot, 'editMessageText', {
      chat_id: ada,
      message_id: serviceMessageId,
      text: 'edited',
    }),
    [400, "Bad Request: message can't be edited"],
    'the bot cannot edit its pin service message',
  );
  assertEquals(
    await callBot(pinningBot, 'copyMessage', {
      chat_id: chatId,
      from_chat_id: ada,
      message_id: serviceMessageId,
    }),
    [400, "Bad Request: the message can't be copied"],
    'a pin service message cannot be copied',
  );
  assertEquals(
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
  assertEquals(copyStatus, 200, 'a pinned message can be copied');
  const copyId = (copy as { message_id: number }).message_id;
  assertEquals(copyId > messageId, true, 'the copy is a new message');
  const [forwardStatus, forward] = await callBot(pinningBot, 'forwardMessage', {
    chat_id: ada,
    from_chat_id: ada,
    message_id: messageId,
  });
  assertEquals(forwardStatus, 200, 'a pinned message can be forwarded');
  const forwardId = (forward as { message_id: number }).message_id;
  assertEquals(forwardId > copyId, true, 'the forward is a new message');
  assertEquals(
    await getPinnedIds(privatePath),
    [messageId],
    'only the original is pinned, not its copy or forward',
  );
});
