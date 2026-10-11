/**
 * Scenarios that HTTP tests run once per chat type, to compare how a private chat and a supergroup
 * answer the same calls: a chat where an account and a bot each wrote a message, a private chat
 * that a join request's contact grant opens, and calls described as comparable outcomes.
 */
import { callBotApi, createUpdateReader } from './bot_api_requests.ts';
import { createTestSession, type EmulationApi, jsonRequest, requestJson } from './emulation_api.ts';
import { createAccount, createBot } from './http_fixtures.ts';

export type ChatType = 'private' | 'supergroup';

export const CHAT_TYPES: readonly ChatType[] = ['private', 'supergroup'];

export type CreatedBot = Awaited<ReturnType<typeof createBot>>;

/** A Bot API call's outcome as `[HTTP status, result or error description]`. */
export type CallOutcome = readonly [status: number, resultOrDescription: unknown];

/**
 * A session with Ada and the bot in a chat of the given type, where Ada wrote "Hello" and the bot
 * answered "Menu" with a keyboard. In a supergroup, which Ada owns, Grace is a member too, and the
 * bot reads every message.
 */
export async function createChatScenario(chatType: ChatType) {
  const { api, sessionPath } = await createTestSession();
  const ada = await createAccount(api, sessionPath, 'Ada');
  const grace = await createAccount(api, sessionPath, 'Grace');
  const bot = await createBot(api, sessionPath, 'test_bot', { can_read_all_group_messages: true });
  const readUpdates = createUpdateReader(api);

  let chatId: number;
  /** The path of the account's messages in the chat, as the control API addresses them. */
  let accountMessagesPath: (accountId: number) => string;
  if (chatType === 'private') {
    chatId = ada.id;
    accountMessagesPath = (accountId) =>
      `${sessionPath}/accounts/${accountId}/conversations/private/${bot.bot.id}/messages`;
  } else {
    const { body: { supergroup } } = await requestJson<{ supergroup: { id: number } }>(
      api,
      'POST',
      `${sessionPath}/accounts/${ada.id}/supergroups`,
      { title: 'Team' },
    );
    chatId = supergroup.id;
    accountMessagesPath = (accountId) =>
      `${sessionPath}/accounts/${accountId}/conversations/supergroup/${chatId}/messages`;
    for (const memberId of [grace.id, bot.bot.id]) {
      await expectStatus(
        api,
        `${sessionPath}/accounts/${ada.id}/conversations/supergroup/${chatId}/members/${memberId}`,
        { method: 'PUT' },
        204,
      );
    }
  }
  const to = chatType === 'private'
    ? { type: 'private', botId: bot.bot.id }
    : { type: 'supergroup', chatId };
  const sendAccountText = async (accountId: number, text: string) => {
    const { status, body } = await requestJson<{ message: { message_id: number } }>(
      api,
      'POST',
      `${sessionPath}/accounts/${accountId}/messages`,
      { to, text },
    );
    if (status !== 201) {
      throw new Error(`Expected "${text}" to be sent, received ${status}`);
    }
    return body.message.message_id;
  };
  const accountMessageId = await sendAccountText(ada.id, 'Hello');
  const botMessageId = await sendBotMessage(api, bot, {
    chat_id: chatId,
    text: 'Menu',
    reply_markup: { inline_keyboard: [[{ text: 'Go', callback_data: 'go' }]] },
  });
  await readUpdates(bot.botApiPath);

  return {
    api,
    sessionPath,
    ada,
    grace,
    bot,
    chatId,
    accountMessageId,
    botMessageId,
    accountMessagesPath,
    sendAccountText,
    readUpdates,
  };
}

/**
 * A session where Grace asked to join Ada's supergroup through a link of the inviter bot, an
 * administrator that may invite users, whose pending request lets the bot write to Grace, who
 * never started a chat with it.
 */
export async function createJoinRequesterChatScenario() {
  const { api, sessionPath } = await createTestSession();
  const ada = await createAccount(api, sessionPath, 'Ada');
  const grace = await createAccount(api, sessionPath, 'Grace');
  const bot = await createBot(api, sessionPath, 'inviter_bot');
  const { body: { supergroup } } = await requestJson<{ supergroup: { id: number } }>(
    api,
    'POST',
    `${sessionPath}/accounts/${ada.id}/supergroups`,
    { title: 'Team' },
  );
  const ownerPath = `${sessionPath}/accounts/${ada.id}/conversations/supergroup/${supergroup.id}`;
  await expectStatus(api, `${ownerPath}/members/${bot.bot.id}`, { method: 'PUT' }, 204);
  await expectStatus(
    api,
    `${ownerPath}/administrators/${bot.bot.id}`,
    jsonRequest('PUT', { can_invite_users: true }),
    204,
  );
  const [, link] = await describeCall(api, bot, 'createChatInviteLink', {
    chat_id: supergroup.id,
    creates_join_request: true,
  });
  await requestJson(api, 'POST', `${sessionPath}/accounts/${grace.id}/chat-joins`, {
    invite_link: (link as { invite_link: string }).invite_link,
  });
  return { api, sessionPath, grace, bot };
}

/** Sends a bot's message with a Bot API send method and returns its ID in the bot's chat. */
export async function sendBotMessage(
  api: EmulationApi,
  bot: CreatedBot,
  parameters: Record<string, unknown>,
  method = 'sendMessage',
): Promise<number> {
  const { status, body } = await callBotApi(api, `${bot.botApiPath}/${method}`, parameters);
  const messageId = (body as { result?: { message_id?: number } }).result?.message_id;
  if (status !== 200 || messageId === undefined) {
    throw new Error(`Expected ${method} to succeed, received ${status} ${JSON.stringify(body)}`);
  }
  return messageId;
}

/** Calls a Bot API method and describes its outcome as a `CallOutcome`. */
export async function describeCall(
  api: EmulationApi,
  bot: CreatedBot,
  method: string,
  parameters: Record<string, unknown>,
): Promise<CallOutcome> {
  const { status, body } = await callBotApi(api, `${bot.botApiPath}/${method}`, parameters);
  const { result, description } = body as { result?: unknown; description?: string };
  return [status, status === 200 ? result : description];
}

export async function expectStatus(
  api: EmulationApi,
  path: string,
  init: RequestInit,
  expectedStatus: number,
): Promise<void> {
  const response = await api.request(path, init);
  await response.body?.cancel();
  if (response.status !== expectedStatus) {
    throw new Error(`Expected ${path} to answer ${expectedStatus}, received ${response.status}`);
  }
}
