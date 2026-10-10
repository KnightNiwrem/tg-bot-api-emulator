import { Bot } from 'https://cdn.jsdelivr.net/gh/grammyjs/grammY@^1.46.0/src/bot.ts';
import { GrammyError } from 'https://cdn.jsdelivr.net/gh/grammyjs/grammY@^1.46.0/src/core/error.ts';

import {
  createTestApi,
  createTestSession,
  jsonRequest,
  TEST_PUBLIC_ORIGIN,
} from '../support/emulation_api.ts';
import { expectSettlementWithin } from '../support/settlement.ts';
import { createInProcessFetch } from '../support/in_process_fetch.ts';
import {
  isCreatedAccountResponse,
  isCreatedBotResponse,
  isGetUpdatesResponse,
  isNotFoundResponse,
  isUserProfile,
} from '../support/http_response_guards.ts';
import { callBotApi } from '../support/bot_api_requests.ts';
import { createAccount, createPrivateConversationFixture } from '../support/http_fixtures.ts';

Deno.test('POST /sessions creates a session and returns its API locations', async () => {
  const api = createTestApi();

  const response = await api.request('/sessions', { method: 'POST' });
  const body: unknown = await response.json();

  if (response.status !== 201) {
    throw new Error(`Expected status 201, received ${response.status}`);
  }
  if (!isSessionResponse(body)) {
    throw new Error('Expected a session response with an ID and Bot API root');
  }

  const sessionPath = `/sessions/${body.id}`;
  if (response.headers.get('Location') !== sessionPath) {
    throw new Error('Expected Location to identify the created session');
  }
  if (body.botApiRoot !== `${TEST_PUBLIC_ORIGIN}${sessionPath}/bot-api`) {
    throw new Error('Expected botApiRoot to identify the session Bot API');
  }
  if (body.uploadProfile !== 'cloud') {
    throw new Error(`Expected the cloud upload profile by default, received ${body.uploadProfile}`);
  }
});

Deno.test('POST /sessions creates a session with the upload profile it names', async () => {
  const api = createTestApi();

  for (const uploadProfile of ['cloud', 'local']) {
    const response = await api.request('/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ upload_profile: uploadProfile }),
    });
    const body: unknown = await response.json();
    if (response.status !== 201 || !isSessionResponse(body)) {
      throw new Error(`Expected a created ${uploadProfile} session, received ${response.status}`);
    }
    if (body.uploadProfile !== uploadProfile) {
      throw new Error(`Expected upload profile ${uploadProfile}, received ${body.uploadProfile}`);
    }
  }
});

Deno.test('POST /sessions rejects unknown or invalid session settings', async () => {
  const api = createTestApi();

  for (const body of ['{"upload_profile":"premium"}', '{"mode":"local"}', '[]', 'local']) {
    const response = await api.request('/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
    if (response.status !== 400) {
      throw new Error(`Expected ${body} to be rejected, received ${response.status}`);
    }
  }
});

Deno.test('DELETE /sessions/:sessionId ends the session and answers its held long polls', async () => {
  const { api, sessionPath, botApiPath } = await createPrivateConversationFixture();
  const heldPoll = api.request(`${botApiPath}/getUpdates`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ timeout: 50 }),
  });

  const deleteResponse = await api.request(sessionPath, { method: 'DELETE' });
  if (deleteResponse.status !== 204) {
    throw new Error(`Expected status 204, received ${deleteResponse.status}`);
  }
  const heldPollResponse = await expectSettlementWithin(
    Promise.resolve(heldPoll),
    1_000,
    'Expected ending the session to answer its held long poll at once',
  );
  const heldPollBody: unknown = await heldPollResponse.json();
  if (
    heldPollResponse.status !== 200 || !isGetUpdatesResponse(heldPollBody) ||
    heldPollBody.result.length !== 0
  ) {
    throw new Error(
      `Expected the held long poll to end without updates, received ${heldPollResponse.status}`,
    );
  }

  const laterPollResponse = await api.request(`${botApiPath}/getUpdates`);
  if (laterPollResponse.status !== 404) {
    throw new Error(`Expected the ended session to be gone, received ${laterPollResponse.status}`);
  }
});

Deno.test('POST bots and accounts create virtual users in one ID namespace', async () => {
  const { api, sessionPath } = await createTestSession();

  const botResponse = await api.request(`${sessionPath}/bots`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ first_name: 'Test Bot', username: 'test_bot' }),
  });
  const botBody: unknown = await botResponse.json();
  if (botResponse.status !== 201 || !isCreatedBotResponse(botBody)) {
    throw new Error(`Expected a created bot response, received ${botResponse.status}`);
  }
  if (
    botResponse.headers.get('Location') !== `${sessionPath}/bots/${botBody.bot.id}` ||
    !botBody.token.startsWith(`${botBody.bot.id}:`) ||
    botBody.bot.is_bot !== true ||
    botBody.bot.first_name !== 'Test Bot' ||
    botBody.bot.username !== 'test_bot'
  ) {
    throw new Error('Expected the bot Location, a token prefixed with its ID, and its profile');
  }

  const accountResponse = await api.request(`${sessionPath}/accounts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      first_name: 'Ada',
      last_name: 'Lovelace',
      username: 'ada',
      language_code: 'en',
    }),
  });
  const accountBody: unknown = await accountResponse.json();
  if (accountResponse.status !== 201 || !isCreatedAccountResponse(accountBody)) {
    throw new Error(`Expected a created account response, received ${accountResponse.status}`);
  }
  if (
    accountResponse.headers.get('Location') !==
      `${sessionPath}/accounts/${accountBody.account.id}` ||
    accountBody.account.id !== botBody.bot.id + 1 ||
    accountBody.account.is_bot !== false ||
    accountBody.account.first_name !== 'Ada' ||
    accountBody.account.last_name !== 'Lovelace' ||
    accountBody.account.username !== 'ada' ||
    accountBody.account.language_code !== 'en'
  ) {
    throw new Error('Expected the account Location, the next user ID, and its profile');
  }
});

Deno.test('POST bots, accounts, and supergroups accept only Telegram-valid usernames', async () => {
  const { api, sessionPath } = await createTestSession();
  const owner = await createAccount(api, sessionPath, 'Ada');
  const creationRoutes = [
    { path: `${sessionPath}/bots`, body: { first_name: 'Test Bot' } },
    { path: `${sessionPath}/accounts`, body: { first_name: 'Grace' } },
    { path: `${sessionPath}/accounts/${owner.id}/supergroups`, body: { title: 'Team' } },
  ];
  const invalidUsernames = ['', 'not a username', '_team', 'team_', 'team__chat', 'équipe'];
  for (const { path, body } of creationRoutes) {
    for (const username of invalidUsernames) {
      const response = await api.request(path, jsonRequest('POST', { ...body, username }));
      if (response.status !== 400) {
        throw new Error(
          `Expected ${
            JSON.stringify(username)
          } to be refused by ${path}, received ${response.status}`,
        );
      }
    }
  }

  const validUsernames = ['Test_Bot2', 'g', 'team_chat'];
  for (const [index, { path, body }] of creationRoutes.entries()) {
    const response = await api.request(
      path,
      jsonRequest('POST', { ...body, username: validUsernames[index] }),
    );
    if (response.status !== 201) {
      throw new Error(
        `Expected ${validUsernames[index]} to be accepted by ${path}, received ${response.status}`,
      );
    }
  }
});

Deno.test('emulator routes reject request bodies that are not JSON or not as specified', async () => {
  const { api, sessionPath, createdBot, createdAccount } = await createPrivateConversationFixture();
  const accountMessagesPath = `${sessionPath}/accounts/${createdAccount.account.id}/messages`;
  const requests = [
    { path: accountMessagesPath, body: '{"to":' },
    { path: accountMessagesPath, body: JSON.stringify({ to: { type: 'private' }, text: 'Hi' }) },
    { path: `${sessionPath}/bots`, body: 'not JSON' },
    { path: `${sessionPath}/bots`, body: JSON.stringify({ first_name: 'Nameless Bot' }) },
  ];
  for (const { path, body } of requests) {
    const response = await api.request(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
    if (response.status !== 400) {
      throw new Error(`Expected ${body} for ${path} to be rejected, received ${response.status}`);
    }
  }

  const validResponse = await api.request(accountMessagesPath, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ to: { type: 'private', botId: createdBot.bot.id }, text: 'Hi' }),
  });
  if (validResponse.status !== 201) {
    throw new Error(`Expected a specified message to be sent, received ${validResponse.status}`);
  }
});

Deno.test('Bot API rejects unknown tokens before resolving methods or parameters', async () => {
  const { api, sessionPath } = await createTestSession();
  const botApiPath = `${sessionPath}/bot-api/bot123:unknown`;

  const responses = [
    await api.request(`${botApiPath}/getMe`, { method: 'POST' }),
    await api.request(`${botApiPath}/getUpdates`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{not json',
    }),
    await api.request(`${botApiPath}/unsupportedMethod`, { method: 'POST' }),
  ];

  for (const response of responses) {
    const body: unknown = await response.json();
    if (response.status !== 401 || !isUnauthorizedResponse(body)) {
      throw new Error(`Expected an unknown token to be unauthorized, received ${response.status}`);
    }
  }
});

Deno.test('Bot API resolves method names case-insensitively over GET and POST', async () => {
  const { api, botApiPath, createdBot } = await createPrivateConversationFixture();

  const responses = [
    await api.request(`${botApiPath}/getMe`),
    await api.request(`${botApiPath}/GETME`, { method: 'POST' }),
    await api.request(`${botApiPath}/getme`),
  ];

  for (const response of responses) {
    const body: unknown = await response.json();
    if (
      response.status !== 200 || !isGetMeResponse(body) ||
      JSON.stringify(body.result) !== JSON.stringify(createdBot.bot)
    ) {
      throw new Error(`Expected ${response.url} to return the bot profile`);
    }
  }
});

Deno.test("Bot API answers unknown methods and paths with Telegram's not-found errors", async () => {
  const { api, sessionPath, botApiPath } = await createPrivateConversationFixture();
  const botApiRootPath = `${sessionPath}/bot-api`;
  const expectNotFound = async (response: Response, expectedDescription: string) => {
    const body: unknown = await response.json();
    if (response.status !== 404 || !isNotFoundResponse(body, expectedDescription)) {
      throw new Error(
        `Expected ${response.url} to be ${expectedDescription}, received ${response.status}`,
      );
    }
  };

  for (
    const response of [
      await api.request(`${botApiPath}/unknownMethod`, { method: 'POST' }),
      await api.request(`${botApiPath}/getMe/extra`),
      await api.request(`${botApiPath}/`),
      // The method is resolved before the body is decoded.
      await api.request(`${botApiPath}/unknownMethod`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{not json',
      }),
    ]
  ) {
    await expectNotFound(response, 'Not Found: method not found');
  }
  // A path without a method is not found before its token is checked.
  for (
    const response of [
      await api.request(botApiPath),
      await api.request(`${botApiRootPath}/bot123:unknown`),
      await api.request(`${botApiRootPath}/getMe`),
      await api.request(botApiRootPath),
    ]
  ) {
    await expectNotFound(response, 'Not Found');
  }
});

Deno.test('tests queue rate limit answers for the next Bot API calls of a bot', async () => {
  const { api, sessionPath, botApiPath, createdBot, createdAccount, sendText } =
    await createPrivateConversationFixture();
  await sendText('/start');
  const rateLimitsPath = `${sessionPath}/bots/${createdBot.bot.id}/rate-limit-responses`;
  const queueResponses = (body: unknown) => api.request(rateLimitsPath, jsonRequest('POST', body));

  const queuing = await queueResponses({ method: 'SENDMESSAGE', retry_after: 3, count: 2 });
  const legacyQueuing = await queueResponses({ method: 'kickChatMember', retry_after: 5 });
  if (
    queuing.status !== 201 ||
    JSON.stringify(await queuing.json()) !==
      JSON.stringify({ method: 'sendMessage', retry_after: 3, remaining_count: 2 }) ||
    JSON.stringify(await legacyQueuing.json()) !==
      JSON.stringify({ method: 'banChatMember', retry_after: 5, remaining_count: 1 })
  ) {
    throw new Error("Expected the queued answers under the methods' current names");
  }
  const refusals = await Promise.all([
    queueResponses({ method: 'sendDice', retry_after: 3 }),
    queueResponses({ retry_after: 0 }),
    api.request(
      `${sessionPath}/bots/${createdAccount.account.id}/rate-limit-responses`,
      jsonRequest('POST', { retry_after: 3 }),
    ),
  ]);
  if (JSON.stringify(refusals.map(({ status }) => status)) !== JSON.stringify([400, 400, 404])) {
    throw new Error('Expected unknown methods, invalid waits and unknown bots to be refused');
  }

  const limitedResponse = await api.request(
    `${botApiPath}/sendMessage`,
    jsonRequest('POST', { chat_id: createdAccount.account.id, text: 'Hello' }),
  );
  const limitedBody = await limitedResponse.json();
  const expectedLimitedBody = {
    ok: false,
    error_code: 429,
    description: 'Too Many Requests: retry after 3',
    parameters: { retry_after: 3 },
  };
  if (
    limitedResponse.status !== 429 || limitedResponse.headers.get('Retry-After') !== '3' ||
    JSON.stringify(limitedBody) !== JSON.stringify(expectedLimitedBody)
  ) {
    throw new Error(
      `Expected Telegram's rate limit answer, received ${JSON.stringify(limitedBody)}`,
    );
  }

  const getMe = await callBotApi(api, `${botApiPath}/getMe`, {});
  const grammyBot = new Bot(createdBot.token, {
    client: {
      apiRoot: `${TEST_PUBLIC_ORIGIN}${sessionPath}/bot-api`,
      fetch: createInProcessFetch(api.fetch),
    },
  });
  const grammyFailure = await grammyBot.api.sendMessage(createdAccount.account.id, 'Hello')
    .catch((error: unknown) => error);
  const delivered = await callBotApi(api, `${botApiPath}/sendMessage`, {
    chat_id: createdAccount.account.id,
    text: 'Hello',
  });
  if (
    getMe.status !== 200 ||
    !(grammyFailure instanceof GrammyError) || grammyFailure.error_code !== 429 ||
    grammyFailure.parameters.retry_after !== 3 || delivered.status !== 200
  ) {
    throw new Error('Expected only the queued sendMessage calls to be limited');
  }

  const remaining = await (await api.request(rateLimitsPath)).json();
  if (
    JSON.stringify(remaining) !== JSON.stringify({
      rate_limit_responses: [{ method: 'banChatMember', retry_after: 5, remaining_count: 1 }],
    })
  ) {
    throw new Error(`Expected the unused answer to remain, received ${JSON.stringify(remaining)}`);
  }
});

function isSessionResponse(
  value: unknown,
): value is { id: string; botApiRoot: string; uploadProfile: string } {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const { id, botApiRoot, uploadProfile } = value as Record<string, unknown>;
  return typeof id === 'string' && id.length > 0 && typeof botApiRoot === 'string' &&
    typeof uploadProfile === 'string';
}

function isGetMeResponse(value: unknown): value is {
  ok: true;
  result: { id: number; is_bot: boolean; first_name: string; username: string };
} {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const { ok, result } = value as Record<string, unknown>;
  return ok === true && isUserProfile(result) && typeof result.username === 'string';
}

function isUnauthorizedResponse(value: unknown): value is {
  ok: false;
  error_code: 401;
  description: 'Unauthorized';
} {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const { ok, error_code, description } = value as Record<string, unknown>;
  return ok === false && error_code === 401 && description === 'Unauthorized';
}
