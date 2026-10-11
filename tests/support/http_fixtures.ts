/**
 * Builders of the sessions, bots, accounts and supergroups that HTTP tests start from. Each one
 * sets up its state through the control API of a fresh in-process emulation API, so that every
 * test exercises the same routes a client would. A fixture that creates an emulator owns it:
 * disposing of the fixture, as `await using` does, disposes of the emulator.
 */
import {
  createTestSession,
  type EmulationApi,
  jsonRequest,
  type SessionSettings,
} from './emulation_api.ts';
import {
  isCreatedAccountResponse,
  isCreatedBotResponse,
  isSentMessageResponse,
} from './http_response_guards.ts';

/** Creates a session holding a bot and an account that can message it. */
export async function createPrivateConversationFixture(sessionSettings?: SessionSettings) {
  await using disposalOnFailure = new AsyncDisposableStack();
  const { api, sessionPath } = disposalOnFailure.use(await createTestSession(sessionSettings));
  const { botApiPath, ...createdBot } = await createBot(api, sessionPath, 'test_bot');
  const createdAccount = { account: await createAccount(api, sessionPath, 'Ada') };

  const sendText = async (text: string) => {
    const response = await api.request(
      `${sessionPath}/accounts/${createdAccount.account.id}/messages`,
      jsonRequest('POST', { to: { type: 'private', botId: createdBot.bot.id }, text }),
    );
    if (response.status !== 201) {
      throw new Error(`Expected "${text}" to be accepted, received ${response.status}`);
    }
  };

  const emulatorDisposal = disposalOnFailure.move();
  return {
    api,
    sessionPath,
    botApiPath,
    createdBot,
    createdAccount,
    sendText,
    [Symbol.asyncDispose]: () => emulatorDisposal.disposeAsync(),
  };
}

/**
 * Creates a session with a supergroup that its owner, Ada, created, and to which Ada added Grace,
 * a bot in privacy mode, and a bot that reads all group messages.
 */
export async function createSupergroupFixture() {
  await using disposalOnFailure = new AsyncDisposableStack();
  const { api, sessionPath } = disposalOnFailure.use(await createTestSession());
  const owner = await createAccount(api, sessionPath, 'Ada');
  const member = await createAccount(api, sessionPath, 'Grace');
  const bot = await createBot(api, sessionPath, 'test_bot');
  const readerBot = await createBot(api, sessionPath, 'reader_bot', {
    can_read_all_group_messages: true,
  });

  const createResponse = await api.request(
    `${sessionPath}/accounts/${owner.id}/supergroups`,
    jsonRequest('POST', { title: 'Team' }),
  );
  if (createResponse.status !== 201) {
    throw new Error(`Expected the supergroup to be created, received ${createResponse.status}`);
  }
  const { supergroup } = await createResponse.json() as {
    supergroup: { id: number; type: string; title: string };
  };
  const supergroupPath = (accountId: number) =>
    `${sessionPath}/accounts/${accountId}/conversations/supergroup/${supergroup.id}`;
  for (const userId of [member.id, bot.bot.id, readerBot.bot.id]) {
    const response = await api.request(`${supergroupPath(owner.id)}/members/${userId}`, {
      method: 'PUT',
    });
    if (response.status !== 204) {
      throw new Error(`Expected member ${userId} to be added, received ${response.status}`);
    }
  }

  const sendSupergroupText = async (accountId: number, text: string, replyToMessageId?: number) => {
    const response = await api.request(
      `${sessionPath}/accounts/${accountId}/messages`,
      jsonRequest('POST', {
        to: { type: 'supergroup', chatId: supergroup.id },
        text,
        ...(replyToMessageId === undefined ? {} : { reply_to_message_id: replyToMessageId }),
      }),
    );
    const body: unknown = await response.json();
    if (response.status !== 201 || !isSentMessageResponse(body)) {
      throw new Error(`Expected "${text}" to be accepted, received ${response.status}`);
    }
    return body.message;
  };

  const emulatorDisposal = disposalOnFailure.move();
  return {
    api,
    sessionPath,
    owner,
    member,
    bot,
    readerBot,
    supergroup,
    supergroupPath,
    sendSupergroupText,
    [Symbol.asyncDispose]: () => emulatorDisposal.disposeAsync(),
  };
}

/**
 * Creates the account `firstName` through `POST accounts` with the rest of its `profile`, returning
 * its user profile.
 */
export async function createAccount(
  api: EmulationApi,
  sessionPath: string,
  firstName: string,
  profile: {
    last_name?: string;
    username?: string;
    phone_number?: string;
    has_private_forwards?: boolean;
  } = {},
) {
  const response = await api.request(
    `${sessionPath}/accounts`,
    jsonRequest('POST', { first_name: firstName, ...profile }),
  );
  const body: unknown = await response.json();
  if (!isCreatedAccountResponse(body)) {
    throw new Error(`Expected account ${firstName} to be created, received ${response.status}`);
  }
  return body.account;
}

/**
 * Creates the bot `username` through `POST bots` with the given settings, named `Test Bot` unless
 * they give its `first_name`, returning its profile and token with the path of its Bot API.
 */
export async function createBot(
  api: EmulationApi,
  sessionPath: string,
  username: string,
  settings: {
    first_name?: string;
    can_read_all_group_messages?: boolean;
    supports_inline_queries?: boolean;
    receives_chosen_inline_results?: boolean;
    requests_inline_location?: boolean;
  } = {},
) {
  const response = await api.request(
    `${sessionPath}/bots`,
    jsonRequest('POST', { first_name: 'Test Bot', username, ...settings }),
  );
  const body: unknown = await response.json();
  if (!isCreatedBotResponse(body)) {
    throw new Error(`Expected bot ${username} to be created, received ${response.status}`);
  }
  return { ...body, botApiPath: `${sessionPath}/bot-api/bot${body.token}` };
}
