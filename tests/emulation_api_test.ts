import { Bot } from 'https://cdn.jsdelivr.net/gh/grammyjs/grammY@^1.46.0/src/bot.ts';
import {
  InlineKeyboard,
  Keyboard,
} from 'https://cdn.jsdelivr.net/gh/grammyjs/grammY@^1.46.0/src/convenience/keyboard.ts';
import { InputFile } from 'https://cdn.jsdelivr.net/gh/grammyjs/grammY@^1.46.0/src/types.ts';
import { GrammyError } from 'https://cdn.jsdelivr.net/gh/grammyjs/grammY@^1.46.0/src/core/error.ts';
import { webhookCallback } from 'https://cdn.jsdelivr.net/gh/grammyjs/grammY@^1.46.0/src/convenience/webhook.ts';

import { createEmulationApi } from '../src/api/mod.ts';
import { createSessionLifecycleService } from '../src/composition/session_lifecycle.ts';
import { MAX_TELEGRAM_USER_ID } from '../src/types/telegram_identity.ts';

Deno.test('POST /sessions creates a session and returns its API locations', async () => {
  const publicOrigin = 'http://emulator.example:9000';
  const api = createEmulationApi({
    sessionLifecycle: createSessionLifecycleService(),
    publicOrigin,
  });

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
  if (body.botApiRoot !== `${publicOrigin}${sessionPath}/bot-api`) {
    throw new Error('Expected botApiRoot to identify the session Bot API');
  }
  if (body.uploadProfile !== 'cloud') {
    throw new Error(`Expected the cloud upload profile by default, received ${body.uploadProfile}`);
  }
});

Deno.test('POST /sessions creates a session with the upload profile it names', async () => {
  const api = createEmulationApi({
    sessionLifecycle: createSessionLifecycleService(),
    publicOrigin: 'http://emulator.example:9000',
  });

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
  const api = createEmulationApi({
    sessionLifecycle: createSessionLifecycleService(),
    publicOrigin: 'http://emulator.example:9000',
  });

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
  const api = createEmulationApi({
    sessionLifecycle: createSessionLifecycleService(),
    publicOrigin: 'http://emulator.example:9000',
  });
  const createSessionResponse = await api.request('/sessions', { method: 'POST' });
  const sessionPath = createSessionResponse.headers.get('Location');
  if (sessionPath === null) {
    throw new Error('Expected the created session to have a Location');
  }

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
  const api = createEmulationApi({
    sessionLifecycle: createSessionLifecycleService(),
    publicOrigin: 'http://emulator.example:9000',
  });
  const createSessionResponse = await api.request('/sessions', { method: 'POST' });
  const sessionPath = createSessionResponse.headers.get('Location');
  if (sessionPath === null) {
    throw new Error('Expected the created session to have a Location');
  }
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

Deno.test('private account messages are stored and delivered through getUpdates', async () => {
  const { api, sessionPath, createdBot, createdAccount } = await createPrivateConversationFixture();

  const sendResponse = await api.request(
    `${sessionPath}/accounts/${createdAccount.account.id}/messages`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        to: { type: 'private', botId: createdBot.bot.id },
        text: 'Hello from Ada',
      }),
    },
  );
  const sentBody: unknown = await sendResponse.json();
  if (sendResponse.status !== 201 || !isSentMessageResponse(sentBody)) {
    throw new Error('Expected the account message to be accepted');
  }
  if (
    sentBody.message.text !== 'Hello from Ada' ||
    sentBody.message.from.id !== createdAccount.account.id ||
    sentBody.message.chat.id !== createdAccount.account.id ||
    sentBody.message.chat.type !== 'private'
  ) {
    throw new Error('Expected a Telegram-shaped private message response');
  }

  const historyResponse = await api.request(
    `${sessionPath}/accounts/${createdAccount.account.id}/conversations/private/${createdBot.bot.id}/messages`,
  );
  const historyBody: unknown = await historyResponse.json();
  if (
    historyResponse.status !== 200 ||
    !isMessageHistoryResponse(historyBody) ||
    historyBody.messages.length !== 1 ||
    historyBody.messages[0].message_id !== sentBody.message.message_id
  ) {
    throw new Error('Expected the sent message to be directly available in conversation history');
  }

  const getUpdatesPath = `${sessionPath}/bot-api/bot${createdBot.token}/getUpdates`;
  const grammyBot = new Bot(createdBot.token, {
    client: {
      apiRoot: `http://emulator.example:9000${sessionPath}/bot-api`,
      fetch: createInProcessFetch(api.fetch),
    },
  });
  const grammyUpdates = await grammyBot.api.getUpdates();
  if (
    grammyUpdates.length !== 1 ||
    grammyUpdates[0].message?.message_id !== sentBody.message.message_id
  ) {
    throw new Error('Expected grammY to receive the emulated message update');
  }

  const updatesResponse = await api.request(getUpdatesPath, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ limit: 100, timeout: 0 }),
  });
  const updatesBody: unknown = await updatesResponse.json();
  if (
    updatesResponse.status !== 200 ||
    !isGetUpdatesResponse(updatesBody) ||
    updatesBody.result.length !== 1 ||
    updatesBody.result[0].update_id !== 1 ||
    updatesBody.result[0].message.message_id !== sentBody.message.message_id
  ) {
    throw new Error('Expected getUpdates to deliver the account message update');
  }

  const confirmationResponse = await api.request(getUpdatesPath, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ offset: 2 }),
  });
  const confirmationBody: unknown = await confirmationResponse.json();
  if (
    !isGetUpdatesResponse(confirmationBody) ||
    confirmationBody.result.length !== 0
  ) {
    throw new Error('Expected a higher offset to confirm the delivered update');
  }
});

Deno.test('getUpdates allowed_updates filters only updates created afterward', async () => {
  const { api, sessionPath, botApiPath, createdBot, createdAccount, sendText } =
    await createPrivateConversationFixture();
  const getUpdatedTexts = async (parameters: Record<string, unknown>) => {
    const response = await api.request(`${botApiPath}/getUpdates`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(parameters),
    });
    const body: unknown = await response.json();
    if (response.status !== 200 || !isGetUpdatesResponse(body)) {
      throw new Error(`Expected a successful getUpdates response, received ${response.status}`);
    }
    return body.result.map((update) => update.message.text);
  };

  await sendText('queued before unsubscribing');
  const updatesQueuedBeforeChange = await getUpdatedTexts({ allowed_updates: ['callback_query'] });
  if (
    JSON.stringify(updatesQueuedBeforeChange) !== JSON.stringify(['queued before unsubscribing'])
  ) {
    throw new Error('Expected a subscription change not to remove an already queued update');
  }

  await sendText('sent while unsubscribed');
  if ((await getUpdatedTexts({ offset: 2 })).length !== 0) {
    throw new Error('Expected an omitted allowed_updates to keep excluding message updates');
  }
  const historyResponse = await api.request(
    `${sessionPath}/accounts/${createdAccount.account.id}/conversations/private/${createdBot.bot.id}/messages`,
  );
  const historyBody: unknown = await historyResponse.json();
  if (
    !isMessageHistoryResponse(historyBody) ||
    historyBody.messages.at(-1)?.text !== 'sent while unsubscribed'
  ) {
    throw new Error('Expected an undelivered message to remain in conversation history');
  }

  await getUpdatedTexts({ allowed_updates: [] });
  await sendText('sent after restoring the default');
  const updatesAfterRestore = await getUpdatedTexts({});
  if (
    JSON.stringify(updatesAfterRestore) !== JSON.stringify(['sent after restoring the default'])
  ) {
    throw new Error('Expected an empty allowed_updates to restore message updates');
  }
});

Deno.test('getUpdates answers a displaced long poll with a Telegram conflict', async () => {
  const { api, botApiPath, sendText } = await createPrivateConversationFixture();
  const holdLongPoll = () =>
    api.request(`${botApiPath}/getUpdates`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ timeout: 50 }),
    });

  // Whichever request is held second displaces the other, so the first to finish is the conflict.
  const pendingPolls = [holdLongPoll(), holdLongPoll()].map((pendingResponse, pollIndex) =>
    Promise.resolve(pendingResponse).then((response) => ({ pollIndex, response }))
  );
  const displacedPoll = await Promise.race(pendingPolls);
  const displacedBody: unknown = await displacedPoll.response.json();
  if (
    displacedPoll.response.status !== 409 || !isTerminatedByOtherLongPollResponse(displacedBody)
  ) {
    throw new Error(
      `Expected a displaced long poll conflict, received ${displacedPoll.response.status}`,
    );
  }

  await sendText('Hello');
  const replacementPoll = await pendingPolls[1 - displacedPoll.pollIndex];
  const replacementBody: unknown = await replacementPoll.response.json();
  if (
    replacementPoll.response.status !== 200 ||
    !isGetUpdatesResponse(replacementBody) ||
    replacementBody.result.map((update) => update.message.text).join() !== 'Hello'
  ) {
    throw new Error('Expected the replacement long poll to receive the account message');
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

Deno.test('getUpdates applies parameters from every supported request encoding', async () => {
  const { api, botApiPath, sendText } = await createPrivateConversationFixture();
  const multipartBody = (parameters: Record<string, string>) => {
    const formData = new FormData();
    for (const [name, value] of Object.entries(parameters)) {
      formData.set(name, value);
    }
    return formData;
  };
  const requestsByEncoding: Record<string, (offset: number) => Response | Promise<Response>> = {
    'query string without a body': (offset) =>
      api.request(`${botApiPath}/getUpdates?offset=${offset}&allowed_updates=["message"]`, {
        method: 'POST',
      }),
    'GET query string': (offset) =>
      api.request(`${botApiPath}/getUpdates?offset=${offset}&allowed_updates=["message"]`),
    'URL-encoded form': (offset) =>
      api.request(`${botApiPath}/getUpdates`, {
        method: 'POST',
        body: new URLSearchParams({ offset: `${offset}`, allowed_updates: '["message"]' }),
      }),
    'multipart form': (offset) =>
      api.request(`${botApiPath}/getUpdates`, {
        method: 'POST',
        body: multipartBody({ offset: `${offset}`, allowed_updates: '["message"]' }),
      }),
    'JSON with textual values': (offset) =>
      api.request(`${botApiPath}/getUpdates`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ offset: `${offset}`, allowed_updates: '["message"]' }),
      }),
  };

  await sendText('first');
  let expectedUpdateId = 1;
  for (const [encoding, requestUpdates] of Object.entries(requestsByEncoding)) {
    expectedUpdateId += 1;
    await sendText(`received through ${encoding}`);

    // The offset confirms the update still pending from the previous iteration.
    const response = await requestUpdates(expectedUpdateId);
    const body: unknown = await response.json();
    if (
      response.status !== 200 || !isGetUpdatesResponse(body) ||
      JSON.stringify(body.result.map((update) => update.update_id)) !==
        JSON.stringify([expectedUpdateId])
    ) {
      throw new Error(`Expected the ${encoding} offset to confirm earlier updates`);
    }
  }

  const remainingResponse = await api.request(`${botApiPath}/getUpdates`, { method: 'POST' });
  const remainingBody: unknown = await remainingResponse.json();
  if (
    !isGetUpdatesResponse(remainingBody) ||
    JSON.stringify(remainingBody.result.map((update) => update.update_id)) !==
      JSON.stringify([expectedUpdateId])
  ) {
    throw new Error('Expected only the last update to remain unconfirmed');
  }
});

Deno.test('getUpdates rejects malformed parameters with a Bot API error', async () => {
  const { api, botApiPath } = await createPrivateConversationFixture();

  const responses = [
    await api.request(`${botApiPath}/getUpdates?offset=two`),
    await api.request(`${botApiPath}/getUpdates?allowed_updates=message`),
    await api.request(`${botApiPath}/getUpdates`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: '{"offset":2}',
    }),
    await api.request(`${botApiPath}/getUpdates`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '[2]',
    }),
  ];

  for (const response of responses) {
    const body: unknown = await response.json();
    if (response.status !== 400 || !isBadRequestResponse(body)) {
      throw new Error(`Expected a Bot API bad request, received ${response.status}`);
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

Deno.test('grammY command handlers match account-sent bot commands', async () => {
  const { api, sessionPath, createdBot, sendText } = await createPrivateConversationFixture();

  for (const text of ['/start', '/start@test_bot payload', 'hello /start']) {
    await sendText(text);
  }

  const grammyBot = new Bot(createdBot.token, {
    client: {
      apiRoot: `http://emulator.example:9000${sessionPath}/bot-api`,
      fetch: createInProcessFetch(api.fetch),
    },
  });
  const startCommandPayloads: string[] = [];
  grammyBot.command('start', (context) => {
    startCommandPayloads.push(context.match);
  });
  await grammyBot.init();
  for (const update of await grammyBot.api.getUpdates()) {
    await grammyBot.handleUpdate(update);
  }

  // A command that does not start the message is marked, but grammY only handles leading commands.
  if (JSON.stringify(startCommandPayloads) !== JSON.stringify(['', 'payload'])) {
    throw new Error(
      `Expected the start handler to run for leading commands, received ${
        JSON.stringify(startCommandPayloads)
      }`,
    );
  }
});

Deno.test('deleteWebhook answers as Telegram does for a bot without a webhook', async () => {
  const { api, botApiPath, sendText } = await createPrivateConversationFixture();
  const deleteWebhook = async (parameters: Record<string, unknown>) => {
    const response = await api.request(`${botApiPath}/deleteWebhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(parameters),
    });
    return { status: response.status, body: await response.json() };
  };
  const getPendingTexts = async () => {
    const response = await api.request(`${botApiPath}/getUpdates`);
    const body: unknown = await response.json();
    if (!isGetUpdatesResponse(body)) {
      throw new Error('Expected a getUpdates response');
    }
    return body.result.map((update) => update.message.text);
  };
  const expectedAnswer = { ok: true, result: true, description: 'Webhook is already deleted' };

  await sendText('kept');
  const keepingAnswer = await deleteWebhook({});
  if (
    keepingAnswer.status !== 200 ||
    JSON.stringify(keepingAnswer.body) !== JSON.stringify(expectedAnswer) ||
    JSON.stringify(await getPendingTexts()) !== JSON.stringify(['kept'])
  ) {
    throw new Error('Expected deleteWebhook to succeed without discarding pending updates');
  }

  const droppingAnswer = await deleteWebhook({ drop_pending_updates: true });
  if (
    droppingAnswer.status !== 200 ||
    JSON.stringify(droppingAnswer.body) !== JSON.stringify(expectedAnswer) ||
    (await getPendingTexts()).length !== 0
  ) {
    throw new Error('Expected drop_pending_updates to discard pending updates');
  }

  const malformedAnswer = await deleteWebhook({ drop_pending_updates: 'maybe' });
  if (malformedAnswer.status !== 400 || !isBadRequestResponse(malformedAnswer.body)) {
    throw new Error('Expected a malformed drop_pending_updates to be rejected');
  }
});

Deno.test('setWebhook, getWebhookInfo, and deleteWebhook follow Telegram checks', async () => {
  const { api, sessionPath, botApiPath } = await createPrivateConversationFixture();
  const webhookUrl = 'https://bot.example/webhook';
  const expectAnswer = (
    answer: { status: number; body: unknown },
    expected: { status: number; body: unknown },
    failureMessage: string,
  ) => {
    if (JSON.stringify(answer) !== JSON.stringify(expected)) {
      throw new Error(`${failureMessage}, received ${JSON.stringify(answer)}`);
    }
  };
  const success = (description: string) => ({
    status: 200,
    body: { ok: true, result: true, description },
  });
  const failure = (status: number, description: string) => ({
    status,
    body: { ok: false, error_code: status, description },
  });

  try {
    const heldPoll = callBotApi(api, `${botApiPath}/getUpdates`, { timeout: 50 });
    expectAnswer(
      await callBotApi(api, `${botApiPath}/setWebhook`, {
        url: webhookUrl,
        secret_token: 'webhook_secret',
        allowed_updates: ['message'],
      }),
      success('Webhook was set'),
      'Expected setWebhook to set the webhook',
    );
    expectAnswer(
      await heldPoll,
      failure(409, 'Conflict: terminated by setWebhook request'),
      'Expected setWebhook to terminate the held long poll',
    );
    expectAnswer(
      await callBotApi(api, `${botApiPath}/getUpdates`, {}),
      failure(
        409,
        "Conflict: can't use getUpdates method while webhook is active; use deleteWebhook to delete the webhook first",
      ),
      'Expected getUpdates to fail while the webhook is set',
    );
    expectAnswer(
      await callBotApi(api, `${botApiPath}/setWebhook`, {
        url: webhookUrl,
        secret_token: 'webhook_secret',
      }),
      success('Webhook is already set'),
      'Expected an unchanged webhook to be already set',
    );
    expectAnswer(
      await callBotApi(api, `${botApiPath}/getWebhookInfo`, {}),
      {
        status: 200,
        body: {
          ok: true,
          result: {
            url: webhookUrl,
            has_custom_certificate: false,
            pending_update_count: 0,
            max_connections: 40,
            allowed_updates: ['message'],
          },
        },
      },
      'Expected getWebhookInfo to report the webhook and its subscription',
    );

    const rejections: Array<[Record<string, unknown>, string]> = [
      [{ url: 'ftp://bot.example/webhook' }, 'Bad Request: invalid webhook URL specified'],
      [
        { url: webhookUrl, secret_token: 'not allowed' },
        'Bad Request: secret token contains illegal characters',
      ],
      [
        { url: webhookUrl, ip_address: '203.0.113.1' },
        'Bad Request: webhook IP addresses are not supported',
      ],
      [{ url: webhookUrl, max_connections: 'many' }, 'Bad Request: invalid setWebhook parameters'],
    ];
    for (const [parameters, description] of rejections) {
      expectAnswer(
        await callBotApi(api, `${botApiPath}/setWebhook`, parameters),
        failure(400, description),
        `Expected setWebhook to reject ${JSON.stringify(parameters)}`,
      );
    }
    expectAnswer(
      await callBotApiWithFiles(api, `${botApiPath}/setWebhook`, { url: webhookUrl }, {
        certificate: new File(['certificate'], 'certificate.pem'),
      }),
      failure(400, 'Bad Request: custom webhook certificates are not supported'),
      'Expected setWebhook to reject a custom certificate',
    );

    // Telegram clamps max_connections to its range.
    await callBotApi(api, `${botApiPath}/setWebhook`, { url: webhookUrl, max_connections: 1000 });
    const { body: clampedInfo } = await callBotApi(api, `${botApiPath}/getWebhookInfo`, {});
    if (botApiResult(clampedInfo)?.max_connections !== 100) {
      throw new Error('Expected max_connections to be clamped to 100');
    }

    expectAnswer(
      await callBotApi(api, `${botApiPath}/deleteWebhook`, {}),
      success('Webhook was deleted'),
      'Expected deleteWebhook to delete the webhook',
    );
    expectAnswer(
      await callBotApi(api, `${botApiPath}/deleteWebhook`, {}),
      success('Webhook is already deleted'),
      'Expected a second deleteWebhook to find no webhook',
    );
    const { status: pollingStatus } = await callBotApi(api, `${botApiPath}/getUpdates`, {});
    if (pollingStatus !== 200) {
      throw new Error(`Expected getUpdates to work after deleteWebhook, received ${pollingStatus}`);
    }
  } finally {
    await api.request(sessionPath, { method: 'DELETE' });
  }
});

Deno.test('a grammY bot receives updates through its webhook and replies', async () => {
  const { api, sessionPath, createdBot, createdAccount, sendText } =
    await createPrivateConversationFixture();
  const grammyBot = new Bot(createdBot.token, {
    client: {
      apiRoot: `http://emulator.example:9000${sessionPath}/bot-api`,
      fetch: createInProcessFetch(api.fetch),
    },
  });
  const firstReply = Promise.withResolvers<void>();
  grammyBot.command('start', async (context) => {
    await context.reply(`Hello, ${context.from?.first_name}!`);
    firstReply.resolve();
  });
  const handleWebhookRequest = webhookCallback(grammyBot, 'std/http', {
    secretToken: 'webhook_secret',
  });
  // Deno.serve passes no request to a handler that declares no parameter, as grammY's does.
  const webhookServer = Deno.serve(
    { hostname: '127.0.0.1', port: 0, onListen: () => {} },
    (request) => handleWebhookRequest(request),
  );
  const webhookUrl = `http://127.0.0.1:${webhookServer.addr.port}/webhook`;

  try {
    await grammyBot.api.setWebhook(webhookUrl, { secret_token: 'webhook_secret' });
    await sendText('/start');
    await expectSettlementWithin(
      firstReply.promise,
      5_000,
      'Expected the bot to reply to a command delivered to its webhook',
    );
    const historyBody: unknown = await (await api.request(
      `${sessionPath}/accounts/${createdAccount.account.id}/conversations/private/${createdBot.bot.id}/messages`,
    )).json();
    if (
      !isMessageHistoryResponse(historyBody) ||
      JSON.stringify(historyBody.messages.map(({ text }) => text)) !==
        JSON.stringify(['/start', 'Hello, Ada!'])
    ) {
      throw new Error('Expected history to hold the command and the bot reply');
    }

    // The bot rejects updates without its secret token, which the test reads from getWebhookInfo.
    await grammyBot.api.setWebhook(webhookUrl, { secret_token: 'other_secret' });
    await sendText('/start again');
    const lastErrorMessage = await expectSettlementWithin(
      (async () => {
        for (;;) {
          const { last_error_message } = await grammyBot.api.getWebhookInfo();
          if (last_error_message !== undefined) {
            return last_error_message;
          }
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
      })(),
      1_000,
      'Expected the rejected update to be reported',
    );
    if (lastErrorMessage !== 'Wrong response from the webhook: 401 Unauthorized') {
      throw new Error(`Expected the bot to reject the wrong secret, received ${lastErrorMessage}`);
    }
  } finally {
    await api.request(sessionPath, { method: 'DELETE' });
    await webhookServer.shutdown();
  }
});

Deno.test('a webhook runs a Bot API method by naming it in its response', async () => {
  const { api, sessionPath, botApiPath, createdBot, createdAccount, sendText } =
    await createPrivateConversationFixture();
  const accountId = createdAccount.account.id;
  const replies = [
    Response.json({ method: 'sendMessage', chat_id: accountId, text: 'JSON reply' }),
    // A reply cannot change the webhook.
    Response.json({ method: 'setWebhook', url: '' }),
    new Response(
      new URLSearchParams({
        method: 'SENDMESSAGE',
        chat_id: String(accountId),
        text: 'Form reply',
      }),
    ),
    new Response('ok'),
    // A failing method changes nothing, and the update still counts as delivered.
    Response.json({ method: 'sendMessage', chat_id: 999, text: 'Lost reply' }),
  ];
  let requestCount = 0;
  const webhookServer = Deno.serve(
    { hostname: '127.0.0.1', port: 0, onListen: () => {} },
    () => replies[requestCount++] ?? new Response(null),
  );
  const readHistory = async () =>
    ((await (await api.request(
      `${sessionPath}/accounts/${accountId}/conversations/private/${createdBot.bot.id}/messages`,
    )).json()) as { messages: Array<{ text?: string }> }).messages.map(({ text }) => text);
  const readWebhookInfo = async () =>
    (await callBotApi(api, `${botApiPath}/getWebhookInfo`, {})).body as {
      result: { url: string; pending_update_count: number; last_error_message?: string };
    };

  try {
    await callBotApi(api, `${botApiPath}/setWebhook`, {
      url: `http://127.0.0.1:${webhookServer.addr.port}/webhook`,
    });
    for (const [index, text] of ['one', 'two', 'three', 'four', 'five'].entries()) {
      await sendText(text);
      await expectSettlementWithin(
        (async () => {
          while (
            requestCount <= index || (await readWebhookInfo()).result.pending_update_count > 0
          ) {
            await new Promise((resolve) => setTimeout(resolve, 5));
          }
        })(),
        1_000,
        `Expected the webhook to accept the update of "${text}"`,
      );
    }

    const history = await readHistory();
    const { result: webhookInfo } = await readWebhookInfo();
    if (
      JSON.stringify(history) !==
        JSON.stringify(['one', 'JSON reply', 'two', 'three', 'Form reply', 'four', 'five']) ||
      webhookInfo.url.length === 0 || webhookInfo.last_error_message !== undefined
    ) {
      throw new Error(
        `Expected the webhook's replies to run, received ${
          JSON.stringify({ history, webhookInfo })
        }`,
      );
    }
  } finally {
    await api.request(sessionPath, { method: 'DELETE' });
    await webhookServer.shutdown();
  }
});

Deno.test('a grammY bot replies through its webhook response', async () => {
  const { api, sessionPath, createdBot, createdAccount, sendText } =
    await createPrivateConversationFixture();
  const grammyBot = new Bot(createdBot.token, {
    client: {
      apiRoot: `http://emulator.example:9000${sessionPath}/bot-api`,
      fetch: createInProcessFetch(api.fetch),
      canUseWebhookReply: (method) => method === 'sendMessage',
    },
  });
  grammyBot.command('start', (context) => context.reply('Hello through the webhook reply!'));
  const handleWebhookRequest = webhookCallback(grammyBot, 'std/http');
  const webhookServer = Deno.serve(
    { hostname: '127.0.0.1', port: 0, onListen: () => {} },
    (request) => handleWebhookRequest(request),
  );
  const historyPath =
    `${sessionPath}/accounts/${createdAccount.account.id}/conversations/private/${createdBot.bot.id}/messages`;

  try {
    await grammyBot.api.setWebhook(`http://127.0.0.1:${webhookServer.addr.port}/webhook`);
    await sendText('/start');
    const history = await expectSettlementWithin(
      (async () => {
        for (;;) {
          const { messages } = await (await api.request(historyPath)).json() as {
            messages: Array<{ text?: string }>;
          };
          if (messages.length > 1) {
            return messages.map(({ text }) => text);
          }
          await new Promise((resolve) => setTimeout(resolve, 5));
        }
      })(),
      5_000,
      'Expected the bot to reply in its webhook response',
    );
    if (
      JSON.stringify(history) !== JSON.stringify(['/start', 'Hello through the webhook reply!'])
    ) {
      throw new Error(`Expected the reply in history, received ${JSON.stringify(history)}`);
    }
  } finally {
    await api.request(sessionPath, { method: 'DELETE' });
    await webhookServer.shutdown();
  }
});

Deno.test('sendMessage replies only in private chats the account has started', async () => {
  const { api, botApiPath, createdBot, createdAccount, sendText } =
    await createPrivateConversationFixture();
  const sendMessage = async (parameters: Record<string, unknown>) => {
    const response = await api.request(`${botApiPath}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(parameters),
    });
    return { status: response.status, body: (await response.json()) as unknown };
  };
  const expectBadRequest = async (
    parameters: Record<string, unknown>,
    expectedDescription?: string,
  ) => {
    const { status, body } = await sendMessage(parameters);
    if (
      status !== 400 || !isBadRequestResponse(body) ||
      (expectedDescription !== undefined && body.description !== expectedDescription)
    ) {
      throw new Error(
        `Expected ${JSON.stringify(parameters)} to be rejected with ${
          expectedDescription ?? 'a bad request'
        }, received ${status} ${JSON.stringify(body)}`,
      );
    }
  };
  const accountId = createdAccount.account.id;

  await expectBadRequest({ chat_id: accountId, text: 'Hello' }, 'Bad Request: chat not found');
  await sendText('Hi');

  const { status, body } = await sendMessage({ chat_id: accountId, text: 'Try /help' });
  if (
    status !== 200 ||
    typeof body !== 'object' || body === null ||
    !('ok' in body) || body.ok !== true ||
    !('result' in body) || !isPrivateMessage(body.result)
  ) {
    throw new Error(`Expected sendMessage to succeed, received ${status}`);
  }
  const reply = body.result;
  if (
    reply.message_id !== 2 ||
    reply.chat.id !== accountId ||
    JSON.stringify(reply.from) !==
      JSON.stringify({
        id: createdBot.bot.id,
        is_bot: true,
        first_name: 'Test Bot',
        username: 'test_bot',
      }) ||
    reply.text !== 'Try /help'
  ) {
    throw new Error("Expected the sent message in the bot's private chat with the account");
  }

  await expectBadRequest({ text: '' }, 'Bad Request: message text is empty');
  await expectBadRequest({ text: 'Hello' }, 'Bad Request: chat_id is empty');
  await expectBadRequest({ chat_id: accountId }, 'Bad Request: message text is empty');
  await expectBadRequest({ chat_id: 999, text: 'Hello' }, 'Bad Request: chat not found');
  await expectBadRequest(
    { chat_id: createdBot.bot.id, text: 'Hello' },
    'Bad Request: chat not found',
  );
  await expectBadRequest({ chat_id: -1, text: 'Hello' }, 'Bad Request: chat not found');
  await expectBadRequest(
    { chat_id: accountId, text: 'x'.repeat(4_097) },
    'Bad Request: message is too long',
  );
  await expectBadRequest({ chat_id: '@ada', text: 'Hello' });
  await expectBadRequest({ chat_id: accountId, text: 'Hello', message_thread_id: '1' });

  const updatesResponse = await api.request(`${botApiPath}/getUpdates`);
  const updatesBody: unknown = await updatesResponse.json();
  if (
    !isGetUpdatesResponse(updatesBody) ||
    JSON.stringify(updatesBody.result.map((update) => update.message.text)) !==
      JSON.stringify(['Hi'])
  ) {
    throw new Error('Expected the bot to receive no update for its own message');
  }
});

Deno.test('a grammY bot starts polling, replies to a command, and resumes after a restart', async () => {
  const { api, sessionPath, createdBot, createdAccount, sendText } =
    await createPrivateConversationFixture();
  const startGrammyBot = () => {
    const grammyBot = new Bot(createdBot.token, {
      client: {
        apiRoot: `http://emulator.example:9000${sessionPath}/bot-api`,
        fetch: createInProcessFetch(api.fetch),
      },
    });
    const handledCommandTexts: string[] = [];
    const firstReply = Promise.withResolvers<void>();
    grammyBot.command('start', async (context) => {
      handledCommandTexts.push(context.msg.text ?? '');
      await context.reply(`Hello, ${context.from?.first_name}!`);
      firstReply.resolve();
    });
    const polling = grammyBot.start();
    const stopAfterFirstReply = async () => {
      // Polling ends only when stopped, so settling first means startup failed.
      await Promise.race([firstReply.promise, polling]);
      await grammyBot.stop();
      await polling;
    };
    return { handledCommandTexts, stopAfterFirstReply };
  };

  await sendText('/start');
  const firstRun = startGrammyBot();
  await firstRun.stopAfterFirstReply();

  const historyPath =
    `${sessionPath}/accounts/${createdAccount.account.id}/conversations/private/${createdBot.bot.id}/messages`;
  const historyBody: unknown = await (await api.request(historyPath)).json();
  if (
    !isMessageHistoryResponse(historyBody) ||
    JSON.stringify(
        historyBody.messages.map(({ from, chat, text }) => [from.id, chat.id, text]),
      ) !==
      JSON.stringify([
        [createdAccount.account.id, createdAccount.account.id, '/start'],
        [createdBot.bot.id, createdAccount.account.id, 'Hello, Ada!'],
      ])
  ) {
    throw new Error('Expected history to hold the command and the bot reply');
  }

  const secondRun = startGrammyBot();
  await sendText('/start again');
  await secondRun.stopAfterFirstReply();
  if (
    JSON.stringify(firstRun.handledCommandTexts) !== JSON.stringify(['/start']) ||
    JSON.stringify(secondRun.handledCommandTexts) !== JSON.stringify(['/start again'])
  ) {
    throw new Error(
      `Expected a restarted bot to handle only new updates, received ${
        JSON.stringify([firstRun.handledCommandTexts, secondRun.handledCommandTexts])
      }`,
    );
  }
});

Deno.test('sendMessage attaches an inline keyboard from every request encoding', async () => {
  const { api, sessionPath, botApiPath, createdBot, createdAccount, sendText } =
    await createPrivateConversationFixture();
  await sendText('/start');
  const accountId = createdAccount.account.id;
  const inlineKeyboard = [
    [{ text: 'Yes', callback_data: 'yes' }, { text: 'No', callback_data: 'no' }],
    [{ text: 'Docs', url: 'https://grammy.dev/' }],
  ];

  const jsonReply = await callBotApi(api, `${botApiPath}/sendMessage`, {
    chat_id: accountId,
    text: 'Continue?',
    reply_markup: { inline_keyboard: inlineKeyboard },
  });
  const formReply = await api.request(`${botApiPath}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      chat_id: String(accountId),
      text: 'Again?',
      reply_markup: JSON.stringify({ inline_keyboard: inlineKeyboard }),
    }),
  });
  const emptyKeyboardReply = await callBotApi(api, `${botApiPath}/sendMessage`, {
    chat_id: accountId,
    text: 'No buttons',
    reply_markup: { inline_keyboard: [] },
  });
  const expectedMarkup = JSON.stringify({ inline_keyboard: inlineKeyboard });
  if (
    jsonReply.status !== 200 ||
    JSON.stringify(botApiResult(jsonReply.body)?.reply_markup) !== expectedMarkup ||
    formReply.status !== 200 ||
    JSON.stringify(botApiResult(await formReply.json())?.reply_markup) !== expectedMarkup ||
    emptyKeyboardReply.status !== 200 ||
    botApiResult(emptyKeyboardReply.body)?.reply_markup !== undefined
  ) {
    throw new Error('Expected the keyboard in replies, and no keyboard for an empty one');
  }
  const historyBody: unknown = await (await api.request(
    `${sessionPath}/accounts/${accountId}/conversations/private/${createdBot.bot.id}/messages`,
  )).json();
  if (
    !isMessageHistoryResponse(historyBody) ||
    JSON.stringify(historyBody.messages[1].reply_markup) !==
      expectedMarkup
  ) {
    throw new Error('Expected history to show the inline keyboard');
  }

  const invalidMarkups: unknown[] = [
    { inline_keyboard: [[{ text: 'Plain' }]] },
    { inline_keyboard: [[{ text: 'Empty', callback_data: '' }]] },
    { inline_keyboard: [[{ text: 'Both', callback_data: 'yes', url: 'https://grammy.dev' }]] },
    { inline_keyboard: [[{ text: 'Pay', pay: true }]] },
    { inline_keyboard: [[]] },
    'not JSON',
  ];
  for (const replyMarkup of invalidMarkups) {
    const { status, body } = await callBotApi(api, `${botApiPath}/sendMessage`, {
      chat_id: accountId,
      text: 'Hello',
      reply_markup: replyMarkup,
    });
    if (
      status !== 400 || !isBadRequestResponse(body) ||
      body.description !== 'Bad Request: invalid sendMessage parameters'
    ) {
      throw new Error(`Expected ${JSON.stringify(replyMarkup)} to be rejected`);
    }
  }
  const oversizedCallbackData = await callBotApi(api, `${botApiPath}/sendMessage`, {
    chat_id: accountId,
    text: 'Hello',
    reply_markup: { inline_keyboard: [[{ text: 'Big', callback_data: 'x'.repeat(65) }]] },
  });
  if (
    !isBadRequestResponse(oversizedCallbackData.body) ||
    oversizedCallbackData.body.description !== 'Bad Request: BUTTON_DATA_INVALID'
  ) {
    throw new Error('Expected callback data over 64 bytes to be rejected as Telegram does');
  }
});

Deno.test('URL buttons follow Telegram link rules', async () => {
  const { api, botApiPath, createdAccount, sendText } = await createPrivateConversationFixture();
  await sendText('/start');
  const accountId = createdAccount.account.id;
  const sendUrlButtons = (urls: readonly string[]) =>
    callBotApi(api, `${botApiPath}/sendMessage`, {
      chat_id: accountId,
      text: 'Links',
      reply_markup: { inline_keyboard: [urls.map((url) => ({ text: 'Open', url }))] },
    });

  const reply = await sendUrlButtons([
    'grammy.dev',
    'HTTPS://Grammy.dev/Docs?page=1',
    'tg://resolve?domain=grammy_bot',
    'TG://user?id=' + accountId,
  ]);
  const sentMessage = botApiResult(reply.body);
  const expectedUrls = [
    'http://grammy.dev/',
    'https://grammy.dev/Docs?page=1',
    'tg://resolve?domain=grammy_bot',
    `tg://user?id=${accountId}`,
  ];
  const sentUrls =
    (sentMessage?.reply_markup as { inline_keyboard: { url: string }[][] } | undefined)
      ?.inline_keyboard[0].map(({ url }) => url);
  if (reply.status !== 200 || JSON.stringify(sentUrls) !== JSON.stringify(expectedUrls)) {
    throw new Error(`Expected Telegram's normalized links, received ${JSON.stringify(sentUrls)}`);
  }

  const invalidLinks = [
    ['grammy', "Bad Request: inline keyboard button URL 'grammy' is invalid: Wrong HTTP URL"],
    [
      'ftp://grammy.dev',
      "Bad Request: inline keyboard button URL 'ftp://grammy.dev' is invalid: Unsupported URL protocol",
    ],
    [
      'tg://resolve:80?domain=grammy_bot',
      "Bad Request: inline keyboard button URL 'tg://resolve:80?domain=grammy_bot' is invalid: Wrong tg URL",
    ],
  ] as const;
  for (const [url, expectedDescription] of invalidLinks) {
    const { status, body } = await sendUrlButtons([url]);
    if (
      status !== 400 || !isBadRequestResponse(body) || body.description !== expectedDescription
    ) {
      throw new Error(`Expected ${url} to be refused, received ${JSON.stringify(body)}`);
    }
  }

  const invalidEdit = await callBotApi(api, `${botApiPath}/editMessageReplyMarkup`, {
    chat_id: accountId,
    message_id: sentMessage?.message_id,
    reply_markup: { inline_keyboard: [[{ text: 'Open', url: 'grammy' }]] },
  });
  if (
    !isBadRequestResponse(invalidEdit.body) ||
    invalidEdit.body.description !== invalidLinks[0][1]
  ) {
    throw new Error('Expected an edit to read the keyboard links as sending does');
  }
});

Deno.test('copy-text, switch-inline and disabled buttons follow Telegram rules', async () => {
  const { api, sessionPath, botApiPath, createdBot, createdAccount, sendText } =
    await createPrivateConversationFixture();
  await sendText('/start');
  const accountId = createdAccount.account.id;
  const sendButtons = (buttons: readonly unknown[]) =>
    callBotApi(api, `${botApiPath}/sendMessage`, {
      chat_id: accountId,
      text: 'Share',
      reply_markup: { inline_keyboard: [buttons] },
    });

  const reply = await sendButtons([
    { text: 'Copy', copy_text: { text: 'PROMO-2026' } },
    { text: 'Share', switch_inline_query: '' },
    { text: 'Search here', switch_inline_query_current_chat: 'cats' },
    {
      text: 'Everywhere',
      switch_inline_query_chosen_chat: {
        query: 'dogs',
        allow_user_chats: true,
        allow_bot_chats: true,
        allow_group_chats: true,
        allow_channel_chats: true,
      },
    },
    { text: 'Groups', switch_inline_query_chosen_chat: { allow_group_chats: true } },
    { text: 'Sold out', disabled: {} },
  ]);
  const sentMessage = botApiResult(reply.body);
  const expectedButtons = [
    { text: 'Copy', copy_text: { text: 'PROMO-2026' } },
    { text: 'Share', switch_inline_query: '' },
    { text: 'Search here', switch_inline_query_current_chat: 'cats' },
    { text: 'Everywhere', switch_inline_query: 'dogs' },
    {
      text: 'Groups',
      switch_inline_query_chosen_chat: {
        query: '',
        allow_user_chats: false,
        allow_bot_chats: false,
        allow_group_chats: true,
        allow_channel_chats: false,
      },
    },
    { text: 'Sold out', disabled: {} },
  ];
  if (
    reply.status !== 200 ||
    JSON.stringify(sentMessage?.reply_markup) !==
      JSON.stringify({ inline_keyboard: [expectedButtons] })
  ) {
    throw new Error(
      `Expected the buttons as Telegram shows them, received ${JSON.stringify(reply)}`,
    );
  }

  const history = await (await api.request(
    `${sessionPath}/accounts/${accountId}/conversations/private/${createdBot.bot.id}/messages`,
  )).json() as { messages: Array<{ message_id: number; reply_markup?: unknown }> };
  const accountView = history.messages.find(({ message_id }) =>
    message_id === sentMessage?.message_id
  );
  if (
    JSON.stringify(accountView?.reply_markup) !==
      JSON.stringify({ inline_keyboard: [expectedButtons] })
  ) {
    throw new Error(`Expected the account to see the buttons, received ${JSON.stringify(history)}`);
  }

  const edit = (buttons: readonly unknown[]) =>
    callBotApi(api, `${botApiPath}/editMessageReplyMarkup`, {
      chat_id: accountId,
      message_id: sentMessage?.message_id,
      reply_markup: { inline_keyboard: [buttons] },
    });
  const unchangedEdit = await edit(expectedButtons);
  const changedEdit = await edit([
    { text: 'Copy', copy_text: { text: 'PROMO-2027' } },
    ...expectedButtons.slice(1),
  ]);
  if (
    !isBadRequestResponse(unchangedEdit.body) ||
    unchangedEdit.body.description !==
      'Bad Request: message is not modified: specified new message content and reply markup are exactly the same as a current content and reply markup of the message' ||
    changedEdit.status !== 200
  ) {
    throw new Error(
      `Expected only a changed copied text to modify the keyboard, received ${
        JSON.stringify([unchangedEdit, changedEdit])
      }`,
    );
  }

  const noChatType = await sendButtons([
    { text: 'Nowhere', switch_inline_query_chosen_chat: { query: 'cats' } },
  ]);
  if (
    !isBadRequestResponse(noChatType.body) ||
    noChatType.body.description !== 'Bad Request: at least one chat type must be allowed'
  ) {
    throw new Error(`Expected TDLib's chat type error, received ${JSON.stringify(noChatType)}`);
  }
  const invalidButtons: unknown[] = [
    { text: 'Copy', copy_text: { text: '' } },
    { text: 'Copy', copy_text: { text: 'x'.repeat(257) } },
    { text: 'Copy', copy_text: 'PROMO' },
    { text: 'Share', switch_inline_query: 1 },
    { text: 'Off', disabled: true },
  ];
  for (const button of invalidButtons) {
    const { status } = await sendButtons([button]);
    if (status !== 400) {
      throw new Error(`Expected ${JSON.stringify(button)} to be rejected, received ${status}`);
    }
  }
});

Deno.test('login and Web App buttons follow Telegram rules', async () => {
  const { api, botApiPath, createdAccount, sendText } = await createPrivateConversationFixture();
  await sendText('/start');
  const accountId = createdAccount.account.id;
  const sendButtons = (buttons: readonly unknown[]) =>
    callBotApi(api, `${botApiPath}/sendMessage`, {
      chat_id: accountId,
      text: 'Welcome',
      reply_markup: { inline_keyboard: [buttons] },
    });
  const loginButton = {
    text: 'Log in',
    login_url: {
      url: 'https://grammy.dev/login',
      forward_text: 'Log in to grammY',
      bot_username: '@Test_Bot',
      request_write_access: true,
    },
  };

  const reply = await sendButtons([
    loginButton,
    { text: 'Open', web_app: { url: 'HTTPS://grammy.dev/app' } },
  ]);
  const sentMessage = botApiResult(reply.body);
  if (
    JSON.stringify(sentMessage?.reply_markup) !== JSON.stringify({
      inline_keyboard: [[
        { text: 'Log in', url: 'https://grammy.dev/login' },
        { text: 'Open', web_app: { url: 'https://grammy.dev/app' } },
      ]],
    })
  ) {
    throw new Error(`Expected a login button shown by its URL, received ${JSON.stringify(reply)}`);
  }

  const editLoginButton = (loginUrl: Record<string, unknown>) =>
    callBotApi(api, `${botApiPath}/editMessageReplyMarkup`, {
      chat_id: accountId,
      message_id: sentMessage?.message_id,
      reply_markup: { inline_keyboard: [[{ text: 'Log in', login_url: loginUrl }]] },
    });
  const firstEdit = await editLoginButton(loginButton.login_url);
  const unchangedEdit = await editLoginButton({
    ...loginButton.login_url,
    bot_username: 'test_bot',
  });
  const changedEdit = await editLoginButton({ ...loginButton.login_url, forward_text: 'Sign in' });
  if (
    firstEdit.status !== 200 || !isBadRequestResponse(unchangedEdit.body) ||
    !unchangedEdit.body.description.startsWith('Bad Request: message is not modified') ||
    changedEdit.status !== 200
  ) {
    throw new Error(
      `Expected only a changed forward text to modify the button, received ${
        JSON.stringify([firstEdit, unchangedEdit, changedEdit])
      }`,
    );
  }

  const forward = async (messageId: unknown) =>
    botApiResult(
      (await callBotApi(api, `${botApiPath}/forwardMessage`, {
        chat_id: accountId,
        from_chat_id: accountId,
        message_id: messageId,
      })).body,
    )?.reply_markup;
  const webAppMessage = botApiResult(
    (await sendButtons([{ text: 'Open', web_app: { url: 'https://grammy.dev/app' } }])).body,
  );
  const forwardedMarkups = [
    await forward(sentMessage?.message_id),
    await forward(webAppMessage?.message_id),
  ];
  if (
    JSON.stringify(forwardedMarkups) !== JSON.stringify([
      { inline_keyboard: [[{ text: 'Sign in', url: 'https://grammy.dev/login' }]] },
      undefined,
    ])
  ) {
    throw new Error(
      `Expected forwards to keep only login buttons, with their forward text, received ${
        JSON.stringify(forwardedMarkups)
      }`,
    );
  }

  const refusedButtons: Array<[unknown, string]> = [
    [
      { text: 'Log in', login_url: { url: 'http://grammy.dev/login' } },
      "Bad Request: inline keyboard button login URL 'http://grammy.dev/login' is invalid: " +
      'Only HTTPS links are allowed',
    ],
    [
      { text: 'Log in', login_url: { url: 'tg://user?id=1' } },
      "Bad Request: link to a user can't be used in login URL buttons",
    ],
    [
      { text: 'Log in', login_url: { url: 'https://grammy.dev', bot_username: 'no_such_bot' } },
      'Bad Request: bot "no_such_bot" not found',
    ],
    [
      { text: 'Log in', login_url: { url: 'https://grammy.dev', bot_username: 'test-bot' } },
      'Bad Request: loginUrl bot username is invalid',
    ],
    [
      { text: 'Open', web_app: { url: 'grammy.dev' } },
      "Bad Request: inline keyboard button Web App URL 'grammy.dev' is invalid: " +
      'Only HTTPS links are allowed',
    ],
  ];
  for (const [button, expectedDescription] of refusedButtons) {
    const refusal = await sendButtons([button]);
    if (
      !isBadRequestResponse(refusal.body) || refusal.body.description !== expectedDescription
    ) {
      throw new Error(
        `Expected ${JSON.stringify(button)} to fail with ${expectedDescription}, received ${
          JSON.stringify(refusal)
        }`,
      );
    }
  }
  for (const button of [{ text: 'Open', web_app: {} }, { text: 'Log in', login_url: 'x' }]) {
    const { status } = await sendButtons([button]);
    if (status !== 400) {
      throw new Error(`Expected ${JSON.stringify(button)} to be rejected, received ${status}`);
    }
  }
});

Deno.test('Web App buttons work only in private chats', async () => {
  const { api, owner, bot, supergroup, supergroupPath } = await createSupergroupFixture();
  const webAppKeyboard = {
    inline_keyboard: [[{ text: 'Open', web_app: { url: 'https://a.io' } }]],
  };
  const webAppSend = await callBotApi(api, `${bot.botApiPath}/sendMessage`, {
    chat_id: supergroup.id,
    text: 'Play',
    reply_markup: webAppKeyboard,
  });
  const loginSend = await callBotApi(api, `${bot.botApiPath}/sendMessage`, {
    chat_id: supergroup.id,
    text: 'Play',
    reply_markup: { inline_keyboard: [[{ text: 'Log in', login_url: { url: 'https://a.io' } }]] },
  });
  const webAppEdit = await callBotApi(api, `${bot.botApiPath}/editMessageReplyMarkup`, {
    chat_id: supergroup.id,
    message_id: botApiResult(loginSend.body)?.message_id,
    reply_markup: webAppKeyboard,
  });
  const richWebAppSend = await callBotApi(api, `${bot.botApiPath}/sendRichMessage`, {
    chat_id: supergroup.id,
    rich_message: {
      blocks: [{ type: 'buttons', buttons: [{ text: 'Open', web_app: { url: 'https://a.io' } }] }],
    },
  });
  const richLoginSend = await callBotApi(api, `${bot.botApiPath}/sendRichMessage`, {
    chat_id: supergroup.id,
    rich_message: {
      blocks: [{
        type: 'buttons',
        buttons: [{ text: 'Log in', login_url: { url: 'https://a.io', bot_username: 'test_bot' } }],
      }],
    },
  });
  const history = await (await api.request(`${supergroupPath(owner.id)}/messages`)).json() as {
    messages: Array<{ text?: string }>;
  };
  const descriptions = [webAppSend, webAppEdit, richWebAppSend, richLoginSend].map(({ body }) =>
    isBadRequestResponse(body) ? body.description : undefined
  );
  if (
    loginSend.status !== 200 ||
    JSON.stringify(descriptions) !== JSON.stringify([
        'Bad Request: BUTTON_TYPE_INVALID',
        'Bad Request: BUTTON_TYPE_INVALID',
        'Bad Request: BUTTON_TYPE_INVALID',
        'Bad Request: bot username must be empty for login_url buttons in rich messages',
      ]) ||
    history.messages.filter(({ text }) => text === 'Play').length !== 1
  ) {
    throw new Error(
      `Expected only the login button in the supergroup, received ${
        JSON.stringify([loginSend, descriptions, history])
      }`,
    );
  }
});

Deno.test('forwards keep switch-inline buttons only of messages sent through an inline bot', async () => {
  const api = createEmulationApi({
    sessionLifecycle: createSessionLifecycleService(),
    publicOrigin: 'http://emulator.example:9000',
  });
  const sessionPath = (await api.request('/sessions', { method: 'POST' })).headers.get('Location');
  if (sessionPath === null) {
    throw new Error('Expected the created session to have a Location');
  }
  const account = await createAccount(api, sessionPath, 'Ada');
  const inlineBot = await createBot(api, sessionPath, 'cats_bot', {
    supports_inline_queries: true,
  });
  const accountPath = `${sessionPath}/accounts/${account.id}`;
  const chat = { type: 'private', botId: inlineBot.bot.id };
  await api.request(`${accountPath}/messages`, jsonRequest('POST', { to: chat, text: '/start' }));

  const queryResponse = await api.request(
    `${accountPath}/inline-queries`,
    jsonRequest('POST', { bot_id: inlineBot.bot.id, chat, query: 'cats' }),
  );
  const { inline_query: inlineQuery } = await queryResponse.json() as {
    inline_query: { id: string };
  };
  const switchKeyboard = [[
    { text: 'More here', switch_inline_query_current_chat: 'more cats' },
    { text: 'Copy', copy_text: { text: 'cats' } },
  ]];
  await callBotApi(api, `${inlineBot.botApiPath}/answerInlineQuery`, {
    inline_query_id: inlineQuery.id,
    results: [{
      type: 'article',
      id: 'cats',
      title: 'Cats',
      input_message_content: { message_text: 'Cats' },
      reply_markup: { inline_keyboard: switchKeyboard },
    }],
  });
  const chooseResponse = await api.request(
    `${accountPath}/inline-queries/${inlineQuery.id}/chosen-results`,
    jsonRequest('POST', { result_id: 'cats' }),
  );
  const { message: viaBotMessage } = await chooseResponse.json() as {
    message: { message_id: number };
  };
  const botMessage = botApiResult(
    (await callBotApi(api, `${inlineBot.botApiPath}/sendMessage`, {
      chat_id: account.id,
      text: 'Cats',
      reply_markup: { inline_keyboard: switchKeyboard },
    })).body,
  );

  const forwardedMarkups = [];
  for (const messageId of [viaBotMessage.message_id, botMessage?.message_id]) {
    forwardedMarkups.push(
      botApiResult(
        (await callBotApi(api, `${inlineBot.botApiPath}/forwardMessage`, {
          chat_id: account.id,
          from_chat_id: account.id,
          message_id: messageId,
        })).body,
      )?.reply_markup,
    );
  }
  const expectedMarkups = [
    {
      inline_keyboard: [[
        { text: 'More here', switch_inline_query: 'more cats' },
        { text: 'Copy', copy_text: { text: 'cats' } },
      ]],
    },
    undefined,
  ];
  if (JSON.stringify(forwardedMarkups) !== JSON.stringify(expectedMarkups)) {
    throw new Error(
      `Expected a switch to any chat only on the inline message's forward, received ${
        JSON.stringify(forwardedMarkups)
      }`,
    );
  }
});

Deno.test('messages carry the entities Telegram detects in their text', async () => {
  const { api, sessionPath, botApiPath, createdBot, createdAccount } =
    await createPrivateConversationFixture();
  const accountId = createdAccount.account.id;
  const grammyBot = new Bot(createdBot.token, {
    client: {
      apiRoot: `http://emulator.example:9000${sessionPath}/bot-api`,
      fetch: createInProcessFetch(api.fetch),
    },
  });
  const linkReceived = Promise.withResolvers<readonly string[]>();
  grammyBot.on('message::url', (context) => {
    linkReceived.resolve(context.entities('url').map(({ text }) => text));
  });
  const polling = grammyBot.start();
  try {
    await api.request(
      `${sessionPath}/accounts/${accountId}/messages`,
      jsonRequest('POST', {
        to: { type: 'private', botId: createdBot.bot.id },
        text: 'Docs at https://grammy.dev/guide and grammy.dev #help',
      }),
    );
    const receivedLinks = await Promise.race([linkReceived.promise, polling.then(() => [])]);
    if (
      JSON.stringify(receivedLinks) !== JSON.stringify(['https://grammy.dev/guide', 'grammy.dev'])
    ) {
      throw new Error(`Expected the bot to receive both links, received ${receivedLinks}`);
    }
  } finally {
    await grammyBot.stop();
    await polling;
  }

  const reply = await callBotApi(api, `${botApiPath}/sendMessage`, {
    chat_id: accountId,
    text: 'Write to @grammy_team or support@grammy.dev',
    entities: [{ type: 'url', offset: 0, length: 5 }],
  });
  const expectedEntities = [
    { type: 'mention', offset: 9, length: 12 },
    { type: 'email', offset: 25, length: 18 },
  ];
  if (
    JSON.stringify(botApiResult(reply.body)?.entities) !== JSON.stringify(expectedEntities)
  ) {
    throw new Error(
      `Expected detected entities instead of the supplied one, received ${
        JSON.stringify(reply.body)
      }`,
    );
  }
});

Deno.test('accounts send and edit text and captions with the formatting they choose', async () => {
  const { api, sessionPath, botApiPath, createdBot, createdAccount } =
    await createPrivateConversationFixture();
  const grace = await createAccount(api, sessionPath, 'Grace');
  const accountPath = `${sessionPath}/accounts/${createdAccount.account.id}`;
  const historyPath = `${accountPath}/conversations/private/${createdBot.bot.id}/messages`;
  const to = { type: 'private', botId: createdBot.bot.id };
  const sendAccountMessage = async (body: unknown) => {
    const response = await api.request(`${accountPath}/messages`, jsonRequest('POST', body));
    return { status: response.status, body: response.ok ? await response.json() : null };
  };
  const readEntities = (message: Record<string, unknown> | undefined) =>
    ((message?.entities ?? message?.caption_entities) as
      | Array<Record<string, unknown> & { user?: { id: number } }>
      | undefined)
      ?.map(({ user, ...entity }) => user === undefined ? entity : { ...entity, userId: user.id });

  // Offsets count UTF-16 code units, and formatting splits around detected entities.
  const sentText = await sendAccountMessage({
    to,
    text: '👋 Hi Grace, see docs and #news',
    entities: [
      { type: 'bold', offset: 3, length: 2 },
      { type: 'text_mention', offset: 6, length: 5, user: { id: grace.id } },
      { type: 'text_link', offset: 17, length: 4, url: 'https://grammy.dev' },
      { type: 'italic', offset: 22, length: 9 },
      { type: 'mention', offset: 0, length: 2 },
    ],
  });
  const sentPhoto = await sendAccountMessage({
    to,
    photo: { content_base64: gifImage(1, 1).toBase64() },
    caption: 'Look',
    caption_entities: [{ type: 'spoiler', offset: 0, length: 4 }],
  });
  const expectedTextEntities = [
    { type: 'bold', offset: 3, length: 2 },
    { type: 'text_mention', offset: 6, length: 5, userId: grace.id },
    { type: 'text_link', offset: 17, length: 4, url: 'https://grammy.dev/' },
    { type: 'italic', offset: 22, length: 4 },
    { type: 'hashtag', offset: 26, length: 5 },
    { type: 'italic', offset: 26, length: 5 },
  ];
  const expectedCaptionEntities = [{ type: 'spoiler', offset: 0, length: 4 }];
  const deliveredMessages = updateMessages(
    (await callBotApi(api, `${botApiPath}/getUpdates`, {})).body,
  );
  const formattingSeen = [
    readEntities(sentText.body?.message),
    readEntities(deliveredMessages[0]),
    readEntities(sentPhoto.body?.message),
    readEntities(deliveredMessages[1]),
  ];
  if (
    JSON.stringify(formattingSeen) !== JSON.stringify([
      expectedTextEntities,
      expectedTextEntities,
      expectedCaptionEntities,
      expectedCaptionEntities,
    ])
  ) {
    throw new Error(`Expected the chosen formatting, received ${JSON.stringify(formattingSeen)}`);
  }

  const textEdit = await api.request(
    `${historyPath}/${sentText.body?.message.message_id}`,
    jsonRequest('PATCH', {
      text: 'Hi again',
      entities: [{ type: 'underline', offset: 3, length: 5 }],
    }),
  );
  const captionEdit = await api.request(
    `${historyPath}/${sentPhoto.body?.message.message_id}`,
    jsonRequest('PATCH', {
      caption: 'Look closer',
      caption_entities: [{ type: 'code', offset: 5, length: 6 }],
    }),
  );
  const editedMessages = updateMessages(
    (await callBotApi(api, `${botApiPath}/getUpdates`, {})).body,
  ).slice(-2);
  const editedFormatting = [
    readEntities((await textEdit.json()).message),
    readEntities(editedMessages[0]),
    readEntities((await captionEdit.json()).message),
    readEntities(editedMessages[1]),
  ];
  const expectedEditedText = [{ type: 'underline', offset: 3, length: 5 }];
  const expectedEditedCaption = [{ type: 'code', offset: 5, length: 6 }];
  if (
    JSON.stringify(editedFormatting) !== JSON.stringify([
      expectedEditedText,
      expectedEditedText,
      expectedEditedCaption,
      expectedEditedCaption,
    ])
  ) {
    throw new Error(`Expected the edited formatting, received ${JSON.stringify(editedFormatting)}`);
  }

  // Formatting Telegram cannot parse or apply stores no message.
  const rejectedStatuses = await Promise.all([
    { to, text: 'Hi', entities: [{ type: 'text_mention', offset: 0, length: 2, user: { id: 9 } }] },
    { to, text: 'Hi', entities: [{ type: 'bold', offset: '0', length: 2 }] },
    { to, text: 'Hi', entities: [{ type: 'glow', offset: 0, length: 2 }] },
    { to, text: 'Hi', entities: { type: 'bold', offset: 0, length: 2 } },
    { to, text: 'Hi', caption_entities: [] },
    {
      to,
      photo: { content_base64: gifImage(1, 1).toBase64() },
      caption: 'Look',
      entities: [{ type: 'bold', offset: 0, length: 4 }],
    },
  ].map(async (body) => (await sendAccountMessage(body)).status));
  const history = await (await api.request(historyPath)).json() as { messages: unknown[] };
  if (
    JSON.stringify(rejectedStatuses) !== JSON.stringify([400, 400, 400, 400, 400, 400]) ||
    history.messages.length !== 2
  ) {
    throw new Error(
      `Expected rejected formatting to store nothing, received ${
        JSON.stringify({ rejectedStatuses, stored: history.messages.length })
      }`,
    );
  }
});

Deno.test('keyboard buttons keep their style and custom emoji icon', async () => {
  const { api, sessionPath, botApiPath, createdBot, createdAccount, sendText } =
    await createPrivateConversationFixture();
  await sendText('/start');
  const accountId = createdAccount.account.id;
  const iconId = '5368324170671202286';

  const styledReply = await callBotApi(api, `${botApiPath}/sendMessage`, {
    chat_id: accountId,
    text: 'Buy?',
    reply_markup: {
      inline_keyboard: [[
        { text: 'Buy', callback_data: 'buy', style: 'Primary', icon_custom_emoji_id: iconId },
        { text: 'Cancel', callback_data: 'cancel', style: 'default', icon_custom_emoji_id: '0' },
        { text: 'Docs', url: 'https://grammy.dev/', style: 'DANGER' },
      ]],
    },
  });
  const styledMessage = botApiResult(styledReply.body);
  const expectedMarkup = {
    inline_keyboard: [[
      { text: 'Buy', icon_custom_emoji_id: iconId, style: 'primary', callback_data: 'buy' },
      { text: 'Cancel', callback_data: 'cancel' },
      { text: 'Docs', style: 'danger', url: 'https://grammy.dev/' },
    ]],
  };
  if (
    styledReply.status !== 200 ||
    JSON.stringify(styledMessage?.reply_markup) !== JSON.stringify(expectedMarkup)
  ) {
    throw new Error(`Expected the buttons' appearance, received ${JSON.stringify(styledMessage)}`);
  }

  const restyle = await callBotApi(api, `${botApiPath}/editMessageReplyMarkup`, {
    chat_id: accountId,
    message_id: styledMessage?.message_id,
    reply_markup: {
      inline_keyboard: [[
        { text: 'Buy', callback_data: 'buy', style: 'success', icon_custom_emoji_id: iconId },
        { text: 'Cancel', callback_data: 'cancel' },
        { text: 'Docs', url: 'https://grammy.dev/', style: 'danger' },
      ]],
    },
  });
  if (
    restyle.status !== 200 ||
    (botApiResult(restyle.body)?.reply_markup as typeof expectedMarkup | undefined)
        ?.inline_keyboard[0][0].style !== 'success'
  ) {
    throw new Error('Expected a changed style alone to modify the keyboard');
  }

  const keyboardReply = await callBotApi(api, `${botApiPath}/sendMessage`, {
    chat_id: accountId,
    text: 'Pick',
    reply_markup: {
      keyboard: [['Plain', { text: 'Stop', style: 'danger', icon_custom_emoji_id: iconId }]],
    },
  });
  const replyInterfaceBody = await (await api.request(
    `${sessionPath}/accounts/${accountId}/conversations/private/${createdBot.bot.id}/reply-interface`,
  )).json() as { reply_interface: { keyboard?: unknown } | null };
  if (
    keyboardReply.status !== 200 ||
    JSON.stringify(replyInterfaceBody.reply_interface?.keyboard) !==
      JSON.stringify([[
        { text: 'Plain' },
        { text: 'Stop', icon_custom_emoji_id: iconId, style: 'danger' },
      ]])
  ) {
    throw new Error(
      `Expected the account to see the reply buttons' appearance, received ${
        JSON.stringify(replyInterfaceBody)
      }`,
    );
  }

  const invalidButtons: unknown[] = [
    { text: 'Link', callback_data: 'x', style: 'link' },
    { text: 'Blue', callback_data: 'x', style: 'blue' },
    { text: 'Icon', callback_data: 'x', icon_custom_emoji_id: 'smile' },
    { text: 'Number', callback_data: 'x', icon_custom_emoji_id: 5368324170671202 },
  ];
  for (const button of invalidButtons) {
    const { status } = await callBotApi(api, `${botApiPath}/sendMessage`, {
      chat_id: accountId,
      text: 'Hello',
      reply_markup: { inline_keyboard: [[button]] },
    });
    if (status !== 400) {
      throw new Error(`Expected ${JSON.stringify(button)} to be rejected`);
    }
  }
});

Deno.test('an account presses a callback button and reads the bot answer', async () => {
  const { api, sessionPath, botApiPath, createdBot, createdAccount, sendText } =
    await createPrivateConversationFixture();
  await sendText('/start');
  const accountId = createdAccount.account.id;
  const reply = await callBotApi(api, `${botApiPath}/sendMessage`, {
    chat_id: accountId,
    text: 'Continue?',
    reply_markup: { inline_keyboard: [[{ text: 'Yes', callback_data: 'yes' }]] },
  });
  const replyMessageId = botApiResult(reply.body)?.message_id;
  const callbackQueriesPath = `${sessionPath}/accounts/${accountId}/callback-queries`;
  const pressButton = (body: unknown) =>
    api.request(callbackQueriesPath, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

  const pressResponse = await pressButton({
    chat: { type: 'private', botId: createdBot.bot.id },
    message_id: replyMessageId,
    callback_data: 'yes',
  });
  const pressBody: unknown = await pressResponse.json();
  if (
    pressResponse.status !== 201 || !isCallbackQueryResponse(pressBody) ||
    pressBody.callback_query.callback_data !== 'yes' ||
    pressBody.callback_query.status !== 'awaiting_answer' ||
    pressBody.callback_query.answer !== null ||
    pressResponse.headers.get('Location') !==
      `${callbackQueriesPath}/${pressBody.callback_query.id}`
  ) {
    throw new Error(`Expected the press to create an unanswered callback query`);
  }
  const callbackQueryId = pressBody.callback_query.id;

  const updatesBody: unknown = await (await api.request(`${botApiPath}/getUpdates`)).json();
  const updates = (updatesBody as { result?: unknown }).result;
  const callbackQuery = Array.isArray(updates)
    ? updates.at(-1)?.callback_query as Record<string, unknown> | undefined
    : undefined;
  const callbackMessage = callbackQuery?.message as Record<string, unknown> | undefined;
  if (
    callbackQuery?.id !== callbackQueryId ||
    JSON.stringify(callbackQuery.from) !== JSON.stringify(createdAccount.account) ||
    typeof callbackQuery.chat_instance !== 'string' ||
    callbackQuery.data !== 'yes' ||
    callbackMessage?.message_id !== replyMessageId ||
    callbackMessage?.text !== 'Continue?'
  ) {
    throw new Error(`Expected a callback_query update, received ${JSON.stringify(updatesBody)}`);
  }

  const startLink = `https://t.me/${createdBot.bot.username}?start=saved`;
  const answerResponse = await callBotApi(api, `${botApiPath}/answerCallbackQuery`, {
    callback_query_id: callbackQueryId,
    text: 'Saved',
    show_alert: true,
    url: startLink,
  });
  if (JSON.stringify(answerResponse.body) !== JSON.stringify({ ok: true, result: true })) {
    throw new Error(`Expected the answer to be accepted, received ${answerResponse.status}`);
  }
  const answeredBody: unknown = await (await api.request(
    `${callbackQueriesPath}/${callbackQueryId}`,
  )).json();
  if (
    !isCallbackQueryResponse(answeredBody) ||
    JSON.stringify(answeredBody.callback_query.answer) !==
      JSON.stringify({ text: 'Saved', show_alert: true, url: startLink, cache_time: 0 })
  ) {
    throw new Error(
      `Expected the account to see the answer, received ${JSON.stringify(answeredBody)}`,
    );
  }

  const queryIdInvalid =
    'Bad Request: query is too old and response timeout expired or query ID is invalid';
  for (
    const parameters of [{ callback_query_id: callbackQueryId }, { callback_query_id: '999' }, {}]
  ) {
    const { body } = await callBotApi(api, `${botApiPath}/answerCallbackQuery`, parameters);
    if (!isBadRequestResponse(body) || body.description !== queryIdInvalid) {
      throw new Error(`Expected ${JSON.stringify(parameters)} to be an invalid query ID`);
    }
  }

  const pressFailures = await Promise.all([
    pressButton({
      chat: { type: 'private', botId: 999 },
      message_id: replyMessageId,
      callback_data: 'yes',
    }),
    pressButton({
      chat: { type: 'private', botId: createdBot.bot.id },
      message_id: 999,
      callback_data: 'yes',
    }),
    pressButton({
      chat: { type: 'private', botId: createdBot.bot.id },
      message_id: replyMessageId,
      callback_data: 'no',
    }),
    pressButton({
      chat: { type: 'private', botId: createdBot.bot.id },
      message_id: replyMessageId,
    }),
    api.request(`${sessionPath}/accounts/${createdBot.bot.id}/callback-queries/${callbackQueryId}`),
    api.request(`${callbackQueriesPath}/999`),
  ]);
  if (
    JSON.stringify(pressFailures.map((response) => response.status)) !==
      JSON.stringify([404, 404, 400, 400, 404, 404])
  ) {
    throw new Error(
      `Expected missing resources and bad presses to be rejected, received ${
        pressFailures.map((response) => response.status).join()
      }`,
    );
  }
});

Deno.test('a callback query created expired reaches the bot but refuses its answer', async () => {
  const { api, sessionPath, botApiPath, createdBot, createdAccount, sendText } =
    await createPrivateConversationFixture();
  await sendText('/start');
  const accountId = createdAccount.account.id;
  const reply = await callBotApi(api, `${botApiPath}/sendMessage`, {
    chat_id: accountId,
    text: 'Continue?',
    reply_markup: { inline_keyboard: [[{ text: 'Yes', callback_data: 'yes' }]] },
  });
  const callbackQueriesPath = `${sessionPath}/accounts/${accountId}/callback-queries`;
  const pressButton = (expired: unknown) =>
    api.request(callbackQueriesPath, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat: { type: 'private', botId: createdBot.bot.id },
        message_id: botApiResult(reply.body)?.message_id,
        callback_data: 'yes',
        expired,
      }),
    });

  const pressResponse = await pressButton(true);
  const pressBody: unknown = await pressResponse.json();
  if (
    pressResponse.status !== 201 || !isCallbackQueryResponse(pressBody) ||
    pressBody.callback_query.status !== 'expired' || pressBody.callback_query.answer !== null
  ) {
    throw new Error('Expected the press to create an expired callback query');
  }
  const callbackQueryId = pressBody.callback_query.id;
  const updatesBody = (await (await api.request(`${botApiPath}/getUpdates`)).json()) as {
    result?: Array<{ callback_query?: { id?: string } }>;
  };
  if (updatesBody.result?.at(-1)?.callback_query?.id !== callbackQueryId) {
    throw new Error('Expected the bot to receive the expired callback query');
  }

  const { status, body } = await callBotApi(api, `${botApiPath}/answerCallbackQuery`, {
    callback_query_id: callbackQueryId,
    text: 'Saved',
  });
  if (
    status !== 400 || !isBadRequestResponse(body) ||
    body.description !==
      'Bad Request: query is too old and response timeout expired or query ID is invalid'
  ) {
    throw new Error('Expected the answer to the expired query to be rejected');
  }
  const queryBody: unknown = await (await api.request(`${callbackQueriesPath}/${callbackQueryId}`))
    .json();
  if (!isCallbackQueryResponse(queryBody) || queryBody.callback_query.status !== 'expired') {
    throw new Error('Expected the rejected answer to leave the query expired');
  }

  if ((await pressButton('yes')).status !== 400) {
    throw new Error('Expected a non-boolean expired flag to be rejected');
  }
});

Deno.test('editMessageText and editMessageReplyMarkup follow Telegram checks', async () => {
  const { api, botApiPath, createdAccount, sendText } = await createPrivateConversationFixture();
  await sendText('/start');
  const accountId = createdAccount.account.id;
  const keyboard = { inline_keyboard: [[{ text: 'Yes', callback_data: 'yes' }]] };
  const reply = await callBotApi(api, `${botApiPath}/sendMessage`, {
    chat_id: accountId,
    text: 'Continue?',
    reply_markup: keyboard,
  });
  const messageId = botApiResult(reply.body)?.message_id;
  const expectEditFailure = async (
    method: string,
    parameters: Record<string, unknown>,
    expectedDescription: string,
  ) => {
    const { status, body } = await callBotApi(api, `${botApiPath}/${method}`, parameters);
    if (status !== 400 || !isBadRequestResponse(body) || body.description !== expectedDescription) {
      throw new Error(
        `Expected ${method} ${JSON.stringify(parameters)} to fail with ${expectedDescription}, ` +
          `received ${status} ${JSON.stringify(body)}`,
      );
    }
  };

  await expectEditFailure('editMessageText', {}, 'Bad Request: message text is empty');
  await expectEditFailure(
    'editMessageText',
    { text: 'Done' },
    'Bad Request: message identifier is not specified',
  );
  await expectEditFailure(
    'editMessageText',
    { message_id: messageId, text: 'Done' },
    'Bad Request: chat_id is empty',
  );
  await expectEditFailure(
    'editMessageText',
    { chat_id: 999, message_id: messageId, text: 'Done' },
    'Bad Request: chat not found',
  );
  await expectEditFailure(
    'editMessageText',
    { chat_id: accountId, text: 'Done' },
    'Bad Request: message to edit not found',
  );
  await expectEditFailure(
    'editMessageText',
    { chat_id: accountId, message_id: 1, text: 'Done' },
    "Bad Request: message can't be edited",
  );
  await expectEditFailure(
    'editMessageText',
    { chat_id: accountId, message_id: messageId, text: 'Continue?', reply_markup: keyboard },
    'Bad Request: message is not modified: specified new message content and reply markup are exactly the same as a current content and reply markup of the message',
  );
  await expectEditFailure(
    'editMessageText',
    { inline_message_id: 'inline', text: 'Done' },
    'Bad Request: MESSAGE_ID_INVALID',
  );
  await expectEditFailure(
    'editMessageReplyMarkup',
    {},
    'Bad Request: message identifier is not specified',
  );
  await expectEditFailure(
    'editMessageReplyMarkup',
    { chat_id: accountId, message_id: messageId, reply_markup: keyboard },
    'Bad Request: message is not modified: specified new message content and reply markup are exactly the same as a current content and reply markup of the message',
  );

  const keyboardEdit = await callBotApi(api, `${botApiPath}/editMessageReplyMarkup`, {
    chat_id: accountId,
    message_id: messageId,
  });
  const keyboardEditResult = botApiResult(keyboardEdit.body);
  if (
    keyboardEdit.status !== 200 || keyboardEditResult === undefined ||
    keyboardEditResult.message_id !== messageId || 'reply_markup' in keyboardEditResult ||
    'edit_date' in keyboardEditResult
  ) {
    throw new Error('Expected editMessageReplyMarkup without markup to remove the keyboard');
  }
  const textEdit = await callBotApi(api, `${botApiPath}/editMessageText`, {
    chat_id: accountId,
    message_id: messageId,
    text: 'Done',
    reply_markup: keyboard,
  });
  const textEditResult = botApiResult(textEdit.body);
  if (
    textEdit.status !== 200 || textEditResult?.text !== 'Done' ||
    typeof textEditResult.edit_date !== 'number' ||
    JSON.stringify(textEditResult.reply_markup) !== JSON.stringify(keyboard)
  ) {
    throw new Error('Expected editMessageText to replace the text and keyboard with an edit date');
  }
});

Deno.test('a grammY bot answers an inline keyboard press and edits its message', async () => {
  const { api, sessionPath, createdBot, createdAccount, sendText } =
    await createPrivateConversationFixture();
  const accountId = createdAccount.account.id;
  const grammyBot = new Bot(createdBot.token, {
    client: {
      apiRoot: `http://emulator.example:9000${sessionPath}/bot-api`,
      fetch: createInProcessFetch(api.fetch),
    },
  });
  const menuSent = Promise.withResolvers<number>();
  const choiceHandled = Promise.withResolvers<void>();
  grammyBot.command('start', async (context) => {
    const menu = await context.reply('Continue?', {
      reply_markup: new InlineKeyboard().text('Yes', 'choice:yes').text('No', 'choice:no'),
    });
    menuSent.resolve(menu.message_id);
  });
  grammyBot.callbackQuery(/^choice:(.+)$/, async (context) => {
    await context.answerCallbackQuery({ text: `You chose ${context.match[1]}` });
    await context.editMessageText(`Chosen: ${context.match[1]}`);
    choiceHandled.resolve();
  });
  const polling = grammyBot.start();

  try {
    await sendText('/start');
    // Polling ends only when stopped, so settling first means startup failed.
    const menuMessageId = await Promise.race([menuSent.promise, polling.then(() => undefined)]);
    const pressResponse = await api.request(
      `${sessionPath}/accounts/${accountId}/callback-queries`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat: { type: 'private', botId: createdBot.bot.id },
          message_id: menuMessageId,
          callback_data: 'choice:no',
        }),
      },
    );
    const callbackQueryPath = pressResponse.headers.get('Location');
    if (pressResponse.status !== 201 || callbackQueryPath === null) {
      throw new Error(`Expected the button press to be accepted, received ${pressResponse.status}`);
    }
    await expectSettlementWithin(
      choiceHandled.promise,
      5_000,
      'Expected the bot to handle the button press',
    );

    const answeredBody: unknown = await (await api.request(callbackQueryPath)).json();
    if (
      !isCallbackQueryResponse(answeredBody) ||
      answeredBody.callback_query.answer?.text !== 'You chose no'
    ) {
      throw new Error(`Expected the bot's answer, received ${JSON.stringify(answeredBody)}`);
    }
    const historyBody: unknown = await (await api.request(
      `${sessionPath}/accounts/${accountId}/conversations/private/${createdBot.bot.id}/messages`,
    )).json();
    const menuMessage = isMessageHistoryResponse(historyBody)
      ? historyBody.messages.find((message) => message.message_id === menuMessageId)
      : undefined;
    if (
      menuMessage?.text !== 'Chosen: no' ||
      menuMessage.reply_markup !== undefined
    ) {
      throw new Error(
        `Expected the edited menu without buttons, received ${JSON.stringify(menuMessage)}`,
      );
    }
  } finally {
    await grammyBot.stop();
    await polling;
  }
});

Deno.test('deleteMessage and deleteMessages follow Telegram checks', async () => {
  const { api, sessionPath, botApiPath, createdBot, createdAccount, sendText } =
    await createPrivateConversationFixture();
  await sendText('/start');
  const accountId = createdAccount.account.id;
  const sendReply = async (text: string) => {
    const reply = await callBotApi(api, `${botApiPath}/sendMessage`, { chat_id: accountId, text });
    const messageId = botApiResult(reply.body)?.message_id;
    if (typeof messageId !== 'number') {
      throw new Error(`Expected "${text}" to be sent, received ${JSON.stringify(reply.body)}`);
    }
    return messageId;
  };
  const firstReplyId = await sendReply('First');
  const secondReplyId = await sendReply('Second');
  const expectDeletionFailure = async (
    method: string,
    parameters: Record<string, unknown>,
    expectedDescription: string,
  ) => {
    const { status, body } = await callBotApi(api, `${botApiPath}/${method}`, parameters);
    if (status !== 400 || !isBadRequestResponse(body) || body.description !== expectedDescription) {
      throw new Error(
        `Expected ${method} ${JSON.stringify(parameters)} to fail with ${expectedDescription}, ` +
          `received ${status} ${JSON.stringify(body)}`,
      );
    }
  };
  const expectDeletion = async (method: string, parameters: Record<string, unknown>) => {
    const { status, body } = await callBotApi(api, `${botApiPath}/${method}`, parameters);
    if (status !== 200 || JSON.stringify(body) !== JSON.stringify({ ok: true, result: true })) {
      throw new Error(
        `Expected ${method} ${JSON.stringify(parameters)} to succeed, ` +
          `received ${status} ${JSON.stringify(body)}`,
      );
    }
  };
  const expectHistoryTexts = async (expectedTexts: readonly string[]) => {
    const historyBody: unknown = await (await api.request(
      `${sessionPath}/accounts/${accountId}/conversations/private/${createdBot.bot.id}/messages`,
    )).json();
    const texts = isMessageHistoryResponse(historyBody)
      ? historyBody.messages.map((message) => message.text)
      : [];
    if (JSON.stringify(texts) !== JSON.stringify(expectedTexts)) {
      throw new Error(`Expected history ${JSON.stringify(expectedTexts)}, received ${texts}`);
    }
  };

  await expectDeletionFailure(
    'deleteMessage',
    { message_id: firstReplyId },
    'Bad Request: chat_id is empty',
  );
  await expectDeletionFailure('deleteMessage', { chat_id: 999 }, 'Bad Request: chat not found');
  await expectDeletionFailure(
    'deleteMessage',
    { chat_id: accountId },
    'Bad Request: message to delete not found',
  );
  await expectDeletionFailure(
    'deleteMessage',
    { chat_id: accountId, message_id: 999 },
    'Bad Request: message to delete not found',
  );
  await expectDeletionFailure(
    'deleteMessage',
    { chat_id: accountId, message_id: 'first' },
    'Bad Request: invalid deleteMessage parameters',
  );
  await expectDeletionFailure(
    'deleteMessages',
    { chat_id: 999 },
    'Bad Request: message identifiers are not specified',
  );
  await expectDeletionFailure(
    'deleteMessages',
    { chat_id: 999, message_ids: Array.from({ length: 101 }, (_, index) => index + 1) },
    'Bad Request: too many message identifiers specified',
  );
  await expectDeletionFailure(
    'deleteMessages',
    { chat_id: 999, message_ids: [firstReplyId, 0] },
    'Bad Request: invalid message identifier specified',
  );
  await expectDeletionFailure(
    'deleteMessages',
    { message_ids: [firstReplyId] },
    'Bad Request: chat_id is empty',
  );
  await expectDeletionFailure(
    'deleteMessages',
    { chat_id: 999, message_ids: [firstReplyId] },
    'Bad Request: chat not found',
  );
  await expectDeletionFailure(
    'deleteMessages',
    { chat_id: accountId, message_ids: ['1'] },
    'Bad Request: invalid deleteMessages parameters',
  );
  await expectHistoryTexts(['/start', 'First', 'Second']);

  // A bot can delete the account's messages in their private chat, not only its own.
  await expectDeletion('deleteMessage', { chat_id: accountId, message_id: 1 });
  await expectHistoryTexts(['First', 'Second']);
  await expectDeletion('deleteMessages', {
    chat_id: accountId,
    message_ids: [1, firstReplyId, 999],
  });
  await expectHistoryTexts(['Second']);
  await expectDeletionFailure(
    'deleteMessage',
    { chat_id: accountId, message_id: firstReplyId },
    'Bad Request: message to delete not found',
  );
  await expectDeletionFailure(
    'editMessageText',
    { chat_id: accountId, message_id: firstReplyId, text: 'Edited' },
    'Bad Request: message to edit not found',
  );

  const formEncodedDeletion = await api.request(`${botApiPath}/deleteMessages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      chat_id: String(accountId),
      message_ids: JSON.stringify([secondReplyId]),
    }),
  });
  if (formEncodedDeletion.status !== 200) {
    throw new Error(
      `Expected a form-encoded deleteMessages to succeed, received ${formEncodedDeletion.status}`,
    );
  }
  await expectHistoryTexts([]);
});

Deno.test('a grammY bot deletes an incoming secret and its menu after a button press', async () => {
  const { api, sessionPath, createdBot, createdAccount, sendText } =
    await createPrivateConversationFixture();
  const accountId = createdAccount.account.id;
  const historyPath =
    `${sessionPath}/accounts/${accountId}/conversations/private/${createdBot.bot.id}/messages`;
  const grammyBot = new Bot(createdBot.token, {
    client: {
      apiRoot: `http://emulator.example:9000${sessionPath}/bot-api`,
      fetch: createInProcessFetch(api.fetch),
    },
  });
  const menuSent = Promise.withResolvers<number>();
  const choiceHandled = Promise.withResolvers<void>();
  grammyBot.command('password', async (context) => {
    await context.deleteMessage();
    const menu = await context.reply('Password stored. Keep it?', {
      reply_markup: new InlineKeyboard().text('Keep', 'keep').text('Forget', 'forget'),
    });
    menuSent.resolve(menu.message_id);
  });
  grammyBot.callbackQuery('forget', async (context) => {
    await context.answerCallbackQuery({ text: 'Forgotten' });
    await context.deleteMessage();
    await context.reply('Password forgotten.');
    choiceHandled.resolve();
  });
  const polling = grammyBot.start();

  try {
    await sendText('/password hunter2');
    // Polling ends only when stopped, so settling first means startup failed.
    const menuMessageId = await Promise.race([menuSent.promise, polling.then(() => undefined)]);
    const pressForget = () =>
      api.request(`${sessionPath}/accounts/${accountId}/callback-queries`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat: { type: 'private', botId: createdBot.bot.id },
          message_id: menuMessageId,
          callback_data: 'forget',
        }),
      });
    const pressResponse = await pressForget();
    if (pressResponse.status !== 201) {
      throw new Error(`Expected the button press to be accepted, received ${pressResponse.status}`);
    }
    await expectSettlementWithin(
      choiceHandled.promise,
      5_000,
      'Expected the bot to handle the button press',
    );

    const historyBody: unknown = await (await api.request(historyPath)).json();
    const texts = isMessageHistoryResponse(historyBody)
      ? historyBody.messages.map((message) => message.text)
      : undefined;
    if (JSON.stringify(texts) !== JSON.stringify(['Password forgotten.'])) {
      throw new Error(
        `Expected only the final reply to remain, received ${JSON.stringify(historyBody)}`,
      );
    }
    const pressOnDeletedMenu = await pressForget();
    if (pressOnDeletedMenu.status !== 404) {
      throw new Error(
        `Expected a press on the deleted menu to find no message, received ${pressOnDeletedMenu.status}`,
      );
    }
  } finally {
    await grammyBot.stop();
    await polling;
  }
});

Deno.test('private message routes validate participants and request bodies', async () => {
  const api = createEmulationApi({
    sessionLifecycle: createSessionLifecycleService(),
    publicOrigin: 'http://emulator.example:9000',
  });
  const createSessionResponse = await api.request('/sessions', { method: 'POST' });
  const sessionPath = createSessionResponse.headers.get('Location');
  if (sessionPath === null) {
    throw new Error('Expected the created session to have a Location');
  }
  const createAccountResponse = await api.request(`${sessionPath}/accounts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ first_name: 'Ada' }),
  });
  const createdAccount: unknown = await createAccountResponse.json();
  if (!isCreatedAccountResponse(createdAccount)) {
    throw new Error('Expected a created account response');
  }

  const missingBotResponse = await api.request(
    `${sessionPath}/accounts/${createdAccount.account.id}/messages`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: { type: 'private', botId: 999 }, text: 'Hello' }),
    },
  );
  const emptyTextResponse = await api.request(
    `${sessionPath}/accounts/${createdAccount.account.id}/messages`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: { type: 'private', botId: 999 }, text: '' }),
    },
  );
  // The text limit counts characters, so 4,096 emoji fit though they take 8,192 UTF-16 code units.
  const sendEmojiText = (emojiCount: number) =>
    api.request(`${sessionPath}/accounts/${createdAccount.account.id}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: { type: 'private', botId: 999 }, text: '😀'.repeat(emojiCount) }),
    });
  const longestEmojiTextResponse = await sendEmojiText(4_096);
  const tooLongEmojiTextResponse = await sendEmojiText(4_097);
  const highestValidAccountIdResponse = await api.request(
    `${sessionPath}/accounts/${MAX_TELEGRAM_USER_ID}/messages`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        to: { type: 'private', botId: MAX_TELEGRAM_USER_ID },
        text: 'Hello',
      }),
    },
  );
  const excessiveAccountIdResponse = await api.request(
    `${sessionPath}/accounts/${MAX_TELEGRAM_USER_ID + 1}/messages`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: { type: 'private', botId: 999 }, text: 'Hello' }),
    },
  );
  const excessiveBotIdResponse = await api.request(
    `${sessionPath}/accounts/${createdAccount.account.id}/messages`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        to: { type: 'private', botId: MAX_TELEGRAM_USER_ID + 1 },
        text: 'Hello',
      }),
    },
  );

  if (
    missingBotResponse.status !== 404 ||
    emptyTextResponse.status !== 400 ||
    longestEmojiTextResponse.status !== 404 ||
    tooLongEmojiTextResponse.status !== 400 ||
    highestValidAccountIdResponse.status !== 404 ||
    excessiveAccountIdResponse.status !== 400 ||
    excessiveBotIdResponse.status !== 400
  ) {
    throw new Error('Expected message routes to distinguish missing participants from bad input');
  }
});

Deno.test('sendMessage and editMessageText format text from parse_mode or entities', async () => {
  const { api, sessionPath, botApiPath, createdBot, createdAccount, sendText } =
    await createPrivateConversationFixture();
  const accountId = createdAccount.account.id;
  await sendText('Hi');
  const expectBadRequest = async (
    methodName: string,
    parameters: Record<string, unknown>,
    expectedDescription: string,
  ) => {
    const { status, body } = await callBotApi(api, `${botApiPath}/${methodName}`, parameters);
    if (status !== 400 || !isBadRequestResponse(body) || body.description !== expectedDescription) {
      throw new Error(
        `Expected ${methodName} ${
          JSON.stringify(parameters)
        } to fail with ${expectedDescription}, received ${status} ${JSON.stringify(body)}`,
      );
    }
  };

  const htmlResponse = await callBotApi(api, `${botApiPath}/sendMessage`, {
    chat_id: accountId,
    text:
      `<b>Hello</b>, <a href="tg://user?id=${accountId}">Ada</a>! <a href="grammy.dev">Docs</a>\n<pre><code class="language-ts">bot.start();</code></pre>`,
    parse_mode: 'HTML',
  });
  const htmlMessage = botApiResult(htmlResponse.body);
  const expectedHtmlEntities = [
    { type: 'bold', offset: 0, length: 5 },
    { type: 'text_mention', offset: 7, length: 3, user: createdAccount.account },
    { type: 'text_link', offset: 12, length: 4, url: 'http://grammy.dev/' },
    { type: 'pre', offset: 17, length: 12, language: 'ts' },
  ];
  if (
    htmlMessage?.text !== 'Hello, Ada! Docs\nbot.start();' ||
    JSON.stringify(htmlMessage.entities) !== JSON.stringify(expectedHtmlEntities)
  ) {
    throw new Error(
      `Expected the HTML to be parsed, received ${JSON.stringify(htmlResponse.body)}`,
    );
  }

  // A form-encoded request sends entities as JSON text; types Telegram detects itself are ignored.
  const entitiesResponse = await api.request(`${botApiPath}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      chat_id: String(accountId),
      text: 'Tap /start now',
      entities: JSON.stringify([
        { type: 'italic', offset: 9, length: 3 },
        { type: 'bot_command', offset: 0, length: 3 },
      ]),
    }),
  });
  const entitiesMessage = botApiResult(await entitiesResponse.json());
  if (
    JSON.stringify(entitiesMessage?.entities) !== JSON.stringify([
      { type: 'bot_command', offset: 4, length: 6 },
      { type: 'italic', offset: 9, length: 1 },
      { type: 'italic', offset: 10, length: 2 },
    ])
  ) {
    throw new Error(
      `Expected specified and detected entities, received ${JSON.stringify(entitiesMessage)}`,
    );
  }

  const markdownV2Error =
    "Bad Request: can't parse entities: Character '.' is reserved and must be escaped with the preceding '\\'";
  // Telegram parses markup before it looks at the chat, but validates entities after it.
  await expectBadRequest('sendMessage', {
    chat_id: 999,
    text: 'Version 1.0',
    parse_mode: 'MarkdownV2',
  }, markdownV2Error);
  await expectBadRequest('sendMessage', {
    chat_id: 999,
    text: 'x',
    entities: [{ type: 'text_link', offset: 0, length: 1, url: 'localhost' }],
  }, 'Bad Request: chat not found');
  await expectBadRequest('sendMessage', {
    chat_id: accountId,
    text: 'x',
    entities: [{ type: 'text_link', offset: 0, length: 1, url: 'localhost' }],
  }, "Bad Request: entity URL 'localhost' is invalid: Wrong HTTP URL");
  await expectBadRequest('sendMessage', {
    chat_id: accountId,
    text: '*unclosed',
    parse_mode: 'markdown',
  }, "Bad Request: can't parse entities: Can't find end of the entity starting at byte offset 0");
  await expectBadRequest('sendMessage', {
    chat_id: accountId,
    text: 'Hi',
    parse_mode: 'XML',
  }, 'Bad Request: unsupported parse_mode');
  await expectBadRequest('sendMessage', {
    chat_id: accountId,
    text: 'Hi',
    entities: [{ type: 'shiny', offset: 0, length: 2 }],
  }, "Bad Request: can't parse MessageEntity: Unsupported type specified");
  await expectBadRequest('sendMessage', {
    chat_id: accountId,
    text: 'Hi',
    entities: [{ type: 'bold', offset: '0', length: 2 }],
  }, 'Bad Request: invalid sendMessage parameters');
  await expectBadRequest('sendMessage', {
    chat_id: accountId,
    text: 'Hi',
    entities: [{ type: 'text_mention', offset: 0, length: 2, user: { id: 999 } }],
  }, 'Bad Request: user not found');
  await expectBadRequest(
    'sendMessage',
    { chat_id: accountId, text: ' \n ' },
    'Bad Request: text must be non-empty',
  );

  const plainResponse = await callBotApi(api, `${botApiPath}/sendMessage`, {
    chat_id: accountId,
    text: 'Plain *text*',
    parse_mode: 'none',
  });
  const plainMessage = botApiResult(plainResponse.body);
  if (plainMessage?.text !== 'Plain *text*' || typeof plainMessage.message_id !== 'number') {
    throw new Error(
      `Expected parse_mode none to keep the text, received ${JSON.stringify(plainResponse.body)}`,
    );
  }
  const editParameters = {
    chat_id: accountId,
    message_id: plainMessage.message_id,
    text: 'Plain *text*',
    parse_mode: 'MarkdownV2',
  };
  const editResponse = await callBotApi(api, `${botApiPath}/editMessageText`, editParameters);
  const editedMessage = botApiResult(editResponse.body);
  if (
    editedMessage?.text !== 'Plain text' ||
    JSON.stringify(editedMessage.entities) !==
      JSON.stringify([{ type: 'bold', offset: 6, length: 4 }]) ||
    typeof editedMessage.edit_date !== 'number'
  ) {
    throw new Error(
      `Expected the edit to apply formatting, received ${JSON.stringify(editResponse.body)}`,
    );
  }
  await expectBadRequest(
    'editMessageText',
    editParameters,
    'Bad Request: message is not modified: specified new message content and reply markup are exactly the same as a current content and reply markup of the message',
  );

  const historyBody: unknown = await (await api.request(
    `${sessionPath}/accounts/${accountId}/conversations/private/${createdBot.bot.id}/messages`,
  )).json();
  const storedEdit = isMessageHistoryResponse(historyBody)
    ? historyBody.messages.find((message) => message.message_id === plainMessage.message_id)
    : undefined;
  if (JSON.stringify(storedEdit?.entities) !== JSON.stringify(editedMessage.entities)) {
    throw new Error(
      `Expected history to show the formatted edit, received ${JSON.stringify(historyBody)}`,
    );
  }
});

Deno.test('sendMessage reads and reports date and time entities as Telegram does', async () => {
  const { api, botApiPath, createdAccount, sendText } = await createPrivateConversationFixture();
  const accountId = createdAccount.account.id;
  await sendText('Hi');
  const sendMessage = async (parameters: Record<string, unknown>) =>
    await callBotApi(api, `${botApiPath}/sendMessage`, { chat_id: accountId, ...parameters });

  // A date holds no formatting, so bold text around it is split.
  const htmlMessage = botApiResult(
    (await sendMessage({
      text: '<b>Due <tg-time unix="1700000000" format="Wtd">tomorrow</tg-time></b>',
      parse_mode: 'HTML',
    })).body,
  );
  const expectedHtmlEntities = [
    { type: 'bold', offset: 0, length: 4 },
    { type: 'date_time', offset: 4, length: 8, unix_time: 1700000000, date_time_format: 'wdt' },
  ];
  if (JSON.stringify(htmlMessage?.entities) !== JSON.stringify(expectedHtmlEntities)) {
    throw new Error(`Expected a date entity, received ${JSON.stringify(htmlMessage)}`);
  }

  // The last letter for a part decides its precision, and a date without a format reports an
  // empty one.
  const dateTimeEntity = (offset: number, format?: string) => ({
    type: 'date_time',
    offset,
    length: 1,
    unix_time: 1,
    ...(format === undefined ? {} : { date_time_format: format }),
  });
  const entitiesMessage = botApiResult(
    (await sendMessage({
      text: 'a b c d',
      entities: [
        dateTimeEntity(0, 'tT'),
        dateTimeEntity(2, 'Ww'),
        dateTimeEntity(4),
        dateTimeEntity(6, 'R'),
      ],
    })).body,
  );
  const reportedFormats = (entitiesMessage?.entities as Array<{ date_time_format?: string }>)
    ?.map(({ date_time_format }) => date_time_format);
  if (JSON.stringify(reportedFormats) !== JSON.stringify(['T', 'w', '', 'r'])) {
    throw new Error(`Expected normalized formats, received ${JSON.stringify(entitiesMessage)}`);
  }

  const failures = [
    [
      { text: 'a', entities: [dateTimeEntity(0, 'rt')] },
      "Bad Request: can't parse MessageEntity: Invalid date-time format specified",
    ],
    [
      { text: 'a', entities: [{ ...dateTimeEntity(0), unix_time: 0 }] },
      'Bad Request: invalid date specified',
    ],
    [
      { text: '![a](tg://time?unix=0)', parse_mode: 'MarkdownV2' },
      "Bad Request: can't parse entities: Invalid tg://emoji or tg://time URL specified",
    ],
  ] as const;
  for (const [parameters, expectedDescription] of failures) {
    const { status, body } = await sendMessage(parameters);
    if (status !== 400 || (body as { description?: unknown }).description !== expectedDescription) {
      throw new Error(
        `Expected ${JSON.stringify(parameters)} to fail with ${expectedDescription}, received ${
          JSON.stringify(body)
        }`,
      );
    }
  }
});

Deno.test('a grammY bot replies with HTML and receives Telegram errors for bad MarkdownV2', async () => {
  const { api, sessionPath, createdBot, createdAccount, sendText } =
    await createPrivateConversationFixture();
  const grammyBot = new Bot(createdBot.token, {
    client: {
      apiRoot: `http://emulator.example:9000${sessionPath}/bot-api`,
      fetch: createInProcessFetch(api.fetch),
    },
  });
  const markdownV2Failure = Promise.withResolvers<unknown>();
  grammyBot.command('start', async (context) => {
    await context.reply(`<b>Welcome</b>, ${context.from?.first_name}!`, { parse_mode: 'HTML' });
    try {
      await context.reply('Version 2.0 is out!', { parse_mode: 'MarkdownV2' });
      markdownV2Failure.resolve(undefined);
    } catch (error) {
      markdownV2Failure.resolve(error);
    }
  });
  const polling = grammyBot.start();

  try {
    await sendText('/start');
    // Polling ends only when stopped, so settling first means startup failed.
    const failure = await Promise.race([markdownV2Failure.promise, polling.then(() => undefined)]);
    if (
      !(failure instanceof GrammyError) || failure.error_code !== 400 ||
      failure.description !==
        "Bad Request: can't parse entities: Character '.' is reserved and must be escaped with the preceding '\\'"
    ) {
      throw new Error(`Expected grammY to report the MarkdownV2 error, received ${failure}`);
    }

    const historyBody: unknown = await (await api.request(
      `${sessionPath}/accounts/${createdAccount.account.id}/conversations/private/${createdBot.bot.id}/messages`,
    )).json();
    const reply = isMessageHistoryResponse(historyBody) ? historyBody.messages.at(-1) : undefined;
    if (
      reply?.text !== 'Welcome, Ada!' ||
      JSON.stringify(reply.entities) !== JSON.stringify([{ type: 'bold', offset: 0, length: 7 }])
    ) {
      throw new Error(
        `Expected the formatted welcome as the last message, received ${JSON.stringify(reply)}`,
      );
    }
  } finally {
    await grammyBot.stop();
    await polling;
  }
});

Deno.test('sendRichMessage sends blocks that accounts see and press as the bot sent them', async () => {
  const { api, sessionPath, botApiPath, createdBot, createdAccount, sendText } =
    await createPrivateConversationFixture();
  await sendText('/start');
  const accountId = createdAccount.account.id;
  const richMessage = {
    blocks: [
      { type: 'heading', text: 'Release plan', size: 2 },
      {
        type: 'paragraph',
        text: ['Ship ', { type: 'bold', text: 'today' }, ', see #plans and example.com'],
      },
      { type: 'anchor', name: 'steps' },
      {
        type: 'list',
        items: [
          {
            blocks: [{ type: 'paragraph', text: 'Build' }],
            has_checkbox: true,
            is_checked: true,
            type: 'i',
            value: 4,
          },
          { blocks: [], type: 'I', value: 27 },
        ],
      },
      {
        type: 'table',
        cells: [
          [{ text: 'Step', is_header: true }, { text: 'Owner', is_header: true, align: 'right' }],
          [{ text: 'Build', colspan: 2, valign: 'top' }, {}],
        ],
        caption: 'Owners',
        is_bordered: true,
      },
      { type: 'pre', text: 'deno task test\u0001', language: 'sh' },
      {
        type: 'photo',
        photo: { type: 'photo', media: 'attach://cover', has_spoiler: true },
        caption: { text: 'Cover', credit: '' },
      },
      {
        type: 'paragraph',
        text: [
          { type: 'reference_link', text: 'note', reference_name: 'n 1' },
          ' and ',
          { type: 'anchor_link', text: 'steps', anchor_name: 'steps' },
          ' and ',
          { type: 'anchor_link', text: 'top', anchor_name: '' },
          ' and ',
          { type: 'anchor_link', text: 'nowhere', anchor_name: 'missing' },
        ],
      },
      { type: 'footer', text: [{ type: 'reference', name: 'n 1', text: 'By @ada_writer' }] },
      {
        type: 'buttons',
        buttons: [
          { text: 'Done', style: 'link', callback_data: 'done' },
          { text: 'Docs', url: 'grammy.dev' },
        ],
        align: 'center',
      },
    ],
    is_rtl: true,
  };

  const sent = await callBotApiWithFiles(api, `${botApiPath}/sendRichMessage`, {
    chat_id: String(accountId),
    rich_message: JSON.stringify(richMessage),
  }, { cover: new File([gifImage(16, 9)], 'cover.gif') });
  const message = botApiResult(sent.body);
  const sentBlocks = (message?.rich_message as { blocks?: Array<Record<string, unknown>> })
    ?.blocks;
  const coverSize = (sentBlocks?.[6]?.photo as Array<Record<string, unknown>> | undefined)?.[0];
  const expectedRichMessage = {
    blocks: [
      { type: 'heading', text: 'Release plan', size: 2 },
      {
        type: 'paragraph',
        text: [
          'Ship ',
          { type: 'bold', text: 'today' },
          ', see ',
          { type: 'hashtag', text: '#plans', hashtag: 'plans' },
          ' and ',
          { type: 'url', text: 'example.com', url: 'example.com' },
        ],
      },
      { type: 'anchor', name: 'steps' },
      {
        type: 'list',
        items: [
          {
            label: 'iv.',
            blocks: [{ type: 'paragraph', text: 'Build' }],
            has_checkbox: true,
            is_checked: true,
            type: 'i',
            value: 4,
          },
          {
            label: 'XXVII.',
            blocks: [{ type: 'paragraph', text: '' }],
            type: 'I',
            value: 27,
          },
        ],
      },
      {
        type: 'table',
        cells: [
          [
            { text: 'Step', is_header: true, align: 'center', valign: 'middle' },
            { text: 'Owner', is_header: true, align: 'right', valign: 'middle' },
          ],
          [
            { text: 'Build', colspan: 2, align: 'left', valign: 'top' },
            { align: 'left', valign: 'middle' },
          ],
        ],
        caption: 'Owners',
        is_bordered: true,
      },
      { type: 'pre', text: 'deno task test ', language: 'sh' },
      {
        type: 'photo',
        photo: [{
          file_id: coverSize?.file_id,
          file_unique_id: coverSize?.file_unique_id,
          file_size: 13,
          width: 16,
          height: 9,
        }],
        caption: { text: 'Cover' },
        has_spoiler: true,
      },
      {
        type: 'paragraph',
        text: [
          { type: 'reference_link', text: 'note', reference_name: 'n 1' },
          ' and ',
          { type: 'anchor_link', text: 'steps', anchor_name: 'steps' },
          ' and ',
          { type: 'anchor_link', text: 'top', anchor_name: '' },
          ' and ',
          { type: 'url', text: 'nowhere', url: '#missing' },
        ],
      },
      {
        type: 'footer',
        text: [{
          type: 'reference',
          text: ['By ', { type: 'mention', text: '@ada_writer', username: 'ada_writer' }],
          name: 'n 1',
        }],
      },
      {
        type: 'buttons',
        buttons: [
          { text: 'Done', style: 'link', callback_data: 'done' },
          { text: 'Docs', url: 'http://grammy.dev/' },
        ],
        align: 'center',
      },
    ],
    is_rtl: true,
  };
  if (
    sent.status !== 200 || typeof coverSize?.file_id !== 'string' ||
    JSON.stringify(message?.rich_message) !== JSON.stringify(expectedRichMessage) ||
    message !== undefined && 'text' in message
  ) {
    throw new Error(`Expected the sent rich message, received ${JSON.stringify(sent.body)}`);
  }

  const historyResponse = await api.request(
    `${sessionPath}/accounts/${accountId}/conversations/private/${createdBot.bot.id}/messages`,
  );
  const history = await historyResponse.json() as { messages: unknown[] };
  if (JSON.stringify(history.messages.at(-1)) !== JSON.stringify(message)) {
    throw new Error(`Expected the account to see the rich message, received ${history}`);
  }

  const readUpdates = createUpdateReader(api);
  await readUpdates(botApiPath);
  const pressResponse = await api.request(
    `${sessionPath}/accounts/${accountId}/callback-queries`,
    jsonRequest('POST', {
      chat: { type: 'private', botId: createdBot.bot.id },
      message_id: message?.message_id,
      callback_data: 'done',
    }),
  );
  const [pressUpdate] = await readUpdates(botApiPath);
  const pressedMessage = (pressUpdate?.callback_query as Record<string, unknown> | undefined)
    ?.message as Record<string, unknown> | undefined;
  if (
    pressResponse.status !== 201 ||
    (pressUpdate?.callback_query as Record<string, unknown> | undefined)?.data !== 'done' ||
    JSON.stringify(pressedMessage?.rich_message) !== JSON.stringify(expectedRichMessage)
  ) {
    throw new Error(
      `Expected the press of a rich message button, received ${pressResponse.status}`,
    );
  }

  // Forwards and copies keep URL buttons, while other buttons keep their look but do nothing.
  const repeatedButtons = {
    type: 'buttons',
    buttons: [
      { text: 'Done', style: 'link', disabled: {} },
      { text: 'Docs', url: 'http://grammy.dev/' },
    ],
    align: 'center',
  };
  const forward = await callBotApi(api, `${botApiPath}/forwardMessage`, {
    chat_id: accountId,
    from_chat_id: accountId,
    message_id: message?.message_id,
  });
  const forwardedBlocks = (botApiResult(forward.body)?.rich_message as {
    blocks?: unknown[];
  } | undefined)?.blocks;
  const copy = await callBotApi(api, `${botApiPath}/copyMessage`, {
    chat_id: accountId,
    from_chat_id: accountId,
    message_id: message?.message_id,
    caption: 'Ignored',
  });
  const copyHistory = await (await api.request(
    `${sessionPath}/accounts/${accountId}/conversations/private/${createdBot.bot.id}/messages`,
  )).json() as { messages: Array<Record<string, unknown>> };
  const copiedMessage = copyHistory.messages.at(-1);
  const copiedBlocks = (copiedMessage?.rich_message as { blocks?: unknown[] } | undefined)?.blocks;
  if (
    JSON.stringify(forwardedBlocks?.at(-1)) !== JSON.stringify(repeatedButtons) ||
    JSON.stringify(copiedBlocks?.at(-1)) !== JSON.stringify(repeatedButtons) ||
    copiedMessage?.message_id !== botApiResult(copy.body)?.message_id ||
    copiedMessage !== undefined && 'caption' in copiedMessage
  ) {
    throw new Error(
      `Expected forwards and copies to disable callback buttons, received ${
        JSON.stringify([forward.body, copiedMessage])
      }`,
    );
  }
  const pressOfCopy = await api.request(
    `${sessionPath}/accounts/${accountId}/callback-queries`,
    jsonRequest('POST', {
      chat: { type: 'private', botId: createdBot.bot.id },
      message_id: copiedMessage?.message_id,
      callback_data: 'done',
    }),
  );
  if (pressOfCopy.status !== 400) {
    throw new Error(`Expected a copy to have no callback button, received ${pressOfCopy.status}`);
  }
});

Deno.test('editMessageText turns text into a rich message and back', async () => {
  const { api, botApiPath, createdAccount, sendText } = await createPrivateConversationFixture();
  await sendText('/start');
  const chatId = createdAccount.account.id;
  const sent = await callBotApi(api, `${botApiPath}/sendMessage`, {
    chat_id: chatId,
    text: 'Draft',
  });
  const messageId = botApiResult(sent.body)?.message_id;
  const richMessage = {
    blocks: [{ type: 'paragraph', text: 'Final for @ada_writer' }],
    skip_entity_detection: true,
  };

  // A rich message replaces the text, which is ignored.
  const toRich = await callBotApi(api, `${botApiPath}/editMessageText`, {
    chat_id: chatId,
    message_id: messageId,
    text: 'Ignored',
    rich_message: richMessage,
  });
  const richResult = botApiResult(toRich.body);
  if (
    JSON.stringify(richResult?.rich_message) !==
      JSON.stringify({ blocks: [{ type: 'paragraph', text: 'Final for @ada_writer' }] }) ||
    richResult !== undefined && 'text' in richResult || typeof richResult?.edit_date !== 'number'
  ) {
    throw new Error(`Expected the text to become rich, received ${JSON.stringify(toRich.body)}`);
  }

  const unchanged = await callBotApi(api, `${botApiPath}/editMessageText`, {
    chat_id: chatId,
    message_id: messageId,
    rich_message: richMessage,
  });
  const captionEdit = await callBotApi(api, `${botApiPath}/editMessageCaption`, {
    chat_id: chatId,
    message_id: messageId,
    caption: 'Caption',
  });
  const emptyRichMessage = await callBotApi(api, `${botApiPath}/editMessageText`, {
    chat_id: chatId,
    message_id: messageId,
    text: 'Plain',
    rich_message: '',
  });
  const failures = [unchanged, captionEdit, emptyRichMessage].map(({ body }) =>
    isBadRequestResponse(body) ? body.description : JSON.stringify(body)
  );
  if (
    JSON.stringify(failures) !== JSON.stringify([
      'Bad Request: message is not modified: specified new message content and reply markup are exactly the same as a current content and reply markup of the message',
      'Bad Request: there is no caption in the message to edit',
      'Bad Request: rich message must be non-empty',
    ])
  ) {
    throw new Error(`Expected Telegram's refusals of the edits, received ${failures.join()}`);
  }

  const withPhoto = await callBotApiWithFiles(api, `${botApiPath}/editMessageText`, {
    chat_id: String(chatId),
    message_id: String(messageId),
    rich_message: JSON.stringify({
      blocks: [{ type: 'photo', photo: { type: 'photo', media: 'attach://chart' } }],
    }),
  }, { chart: new File([gifImage(4, 3)], 'chart.gif') });
  const photoBlock = (botApiResult(withPhoto.body)?.rich_message as {
    blocks?: Array<{ type?: string; photo?: Array<Record<string, unknown>> }>;
  } | undefined)?.blocks?.[0];
  if (photoBlock?.type !== 'photo' || photoBlock.photo?.[0]?.width !== 4) {
    throw new Error(
      `Expected an edit to upload a photo, received ${JSON.stringify(withPhoto.body)}`,
    );
  }

  const toText = await callBotApi(api, `${botApiPath}/editMessageText`, {
    chat_id: chatId,
    message_id: messageId,
    text: 'Plain again',
  });
  const textResult = botApiResult(toText.body);
  if (
    textResult?.text !== 'Plain again' || textResult !== undefined && 'rich_message' in textResult
  ) {
    throw new Error(
      `Expected the rich message to become text, received ${JSON.stringify(toText.body)}`,
    );
  }
});

Deno.test('sendRichMessage refuses rich messages as Telegram does', async () => {
  const { api, botApiPath, createdAccount, sendText } = await createPrivateConversationFixture();
  const chatId = createdAccount.account.id;
  const paragraph = (text: unknown) => ({ blocks: [{ type: 'paragraph', text }] });
  const buttonRow = (buttons: unknown[]) => ({ blocks: [{ type: 'buttons', buttons }] });
  const photoBlock = (photo: unknown) => ({ blocks: [{ type: 'photo', photo }] });
  const cases: Array<readonly [unknown, string]> = [
    [undefined, 'Bad Request: rich message must be non-empty'],
    ['not JSON', "Bad Request: can't parse rich message JSON object"],
    [[], 'Bad Request: object expected as rich message'],
    [
      { html: '<b>Hi</b>' },
      'Bad Request: rich messages written in HTML or Markdown are not supported',
    ],
    [{ blocks: [] }, 'Bad Request: rich message must be non-empty'],
    [{ blocks: [1] }, 'Bad Request: object expected as InputRichMessageBlock'],
    [{ blocks: [{ type: 'marquee' }] }, 'Bad Request: type "marquee" is unsupported'],
    [
      { blocks: [{ type: 'video', video: { type: 'video', media: 'attach://clip' } }] },
      'Bad Request: rich message blocks with an animation, audio, video, or voice note are not supported',
    ],
    [
      { blocks: [{ type: 'thinking', text: 'Thinking' }] },
      'Bad Request: thinking blocks can be used only in rich message drafts',
    ],
    [
      { blocks: [{ type: 'paragraph', text: 'Hi', size: 1 }] },
      'Bad Request: invalid sendRichMessage parameters',
    ],
    [
      { blocks: [{ type: 'heading', text: 'Hi', size: 7 }] },
      'Bad Request: invalid section heading size specified',
    ],
    [paragraph({ type: 'blink', text: 'Hi' }), 'Bad Request: unsupported rich text type'],
    [paragraph(5), 'Bad Request: invalid rich text specified'],
    [paragraph('\uD800'), 'Bad Request: rich text must be encoded in UTF-8'],
    [
      paragraph({ type: 'date_time', text: 'Soon', unix_time: 0 }),
      'Bad Request: invalid date specified',
    ],
    [
      paragraph({ type: 'date_time', text: 'Soon', unix_time: 1, date_time_format: 'x' }),
      'Bad Request: invalid date-time format specified',
    ],
    [
      paragraph({ type: 'custom_emoji', custom_emoji_id: 'smile', alternative_text: '🙂' }),
      'Bad Request: invalid custom emoji identifier specified',
    ],
    [
      paragraph({ type: 'text_mention', text: 'Nobody', user: { id: 999 } }),
      'Bad Request: user not found',
    ],
    [{ blocks: [{ type: 'list', items: [] }] }, 'Bad Request: list must be non-empty'],
    [
      {
        blocks: [{
          type: 'list',
          items: [{ blocks: [], type: '1', value: 1 }, { blocks: [] }],
        }],
      },
      'Bad Request: list must be either ordered or unordered',
    ],
    [
      { blocks: [{ type: 'list', items: [{ blocks: [], type: 'x' }] }] },
      'Bad Request: invalid list item type specified',
    ],
    [
      { blocks: [{ type: 'table', cells: [[{ text: 'A', align: 'justify' }]] }] },
      'Bad Request: invalid horizontal alignment specified',
    ],
    [
      { blocks: [{ type: 'table', cells: [[{ text: 'A', colspan: -1 }]] }] },
      'Bad Request: invalid table cell colspan specified',
    ],
    [
      { blocks: [{ type: 'map', location: { latitude: 100, longitude: 0 } }] },
      'Bad Request: invalid location specified',
    ],
    [
      { blocks: [{ type: 'map', location: { latitude: 52, longitude: 13 }, zoom: 25 }] },
      'Bad Request: invalid map properties specified',
    ],
    [buttonRow([]), 'Bad Request: button row must be non-empty'],
    [
      buttonRow(
        Array.from({ length: 9 }, (_, index) => ({ text: 'Go', callback_data: `${index}` })),
      ),
      'Bad Request: a button row can have at most 8 buttons',
    ],
    [
      buttonRow([{ text: 'Go', style: 'glow', callback_data: 'go' }]),
      'Bad Request: invalid button style specified',
    ],
    [
      buttonRow([{ text: 'Go', style: 'link', url: 'https://grammy.dev' }]),
      'Bad Request: only callback buttons can have the link style',
    ],
    [
      buttonRow([{ text: { type: 'bold', text: 'Go' }, callback_data: 'go' }]),
      'Bad Request: button text can have only custom emoji and dates',
    ],
    [
      buttonRow([{ text: 'Go', url: 'grammy' }]),
      "Bad Request: inline keyboard button URL 'grammy' is invalid: Wrong HTTP URL",
    ],
    [
      buttonRow([{ text: 'Go', callback_data: 'x'.repeat(65) }]),
      'Bad Request: BUTTON_DATA_INVALID',
    ],
    [
      photoBlock({ type: 'photo', media: 'attach://missing' }),
      'Bad Request: media not found',
    ],
    [
      photoBlock({ type: 'photo', media: 'https://grammy.dev/logo.png' }),
      'Bad Request: failed to get HTTP URL content',
    ],
    [
      photoBlock({ type: 'document', media: 'attach://missing' }),
      'Bad Request: unexpected media type "document" for block "photo"',
    ],
    [
      photoBlock({ type: 'photo', media: 'unknown-file-id' }),
      'Bad Request: wrong file identifier/HTTP URL specified',
    ],
  ];

  // The blocks are read before the chat, which the account has not started yet.
  const unstartedChat = await callBotApi(api, `${botApiPath}/sendRichMessage`, {
    chat_id: chatId,
    rich_message: paragraph('Hello'),
  });
  if (
    !isBadRequestResponse(unstartedChat.body) ||
    unstartedChat.body.description !== 'Bad Request: chat not found'
  ) {
    throw new Error(`Expected an unstarted chat, received ${JSON.stringify(unstartedChat.body)}`);
  }
  await sendText('/start');
  for (const [richMessage, description] of cases) {
    const { body } = await callBotApi(api, `${botApiPath}/sendRichMessage`, {
      chat_id: chatId,
      ...(richMessage === undefined ? {} : { rich_message: richMessage }),
    });
    if (!isBadRequestResponse(body) || body.description !== description) {
      throw new Error(
        `Expected ${JSON.stringify(richMessage)} to fail with "${description}", received ${
          JSON.stringify(body)
        }`,
      );
    }
  }
});

Deno.test('bots send and edit rich messages in supergroups and inline messages', async () => {
  const { api, sessionPath, owner, bot, supergroup, supergroupPath } =
    await createSupergroupFixture();
  const sent = await callBotApi(api, `${bot.botApiPath}/sendRichMessage`, {
    chat_id: supergroup.id,
    rich_message: { blocks: [{ type: 'paragraph', text: 'Hi @ada_writer' }] },
  });
  const history = await (await api.request(`${supergroupPath(owner.id)}/messages`)).json() as {
    messages: Array<Record<string, unknown>>;
  };
  const expectedRichMessage = {
    blocks: [{
      type: 'paragraph',
      text: ['Hi ', { type: 'mention', text: '@ada_writer', username: 'ada_writer' }],
    }],
  };
  if (
    JSON.stringify(botApiResult(sent.body)?.rich_message) !==
      JSON.stringify(expectedRichMessage) ||
    JSON.stringify(history.messages.at(-1)?.rich_message) !== JSON.stringify(expectedRichMessage)
  ) {
    throw new Error(
      `Expected the supergroup's rich message, received ${JSON.stringify(sent.body)}`,
    );
  }

  const inlineBot = await createBot(api, sessionPath, 'cats_bot', {
    supports_inline_queries: true,
    receives_chosen_inline_results: true,
  });
  const readUpdates = createUpdateReader(api);
  const accountPath = `${sessionPath}/accounts/${owner.id}`;
  const queryResponse = await api.request(
    `${accountPath}/inline-queries`,
    jsonRequest('POST', {
      bot_id: inlineBot.bot.id,
      chat: { type: 'private', botId: inlineBot.bot.id },
      query: 'cats',
    }),
  );
  const { inline_query: inlineQuery } = await queryResponse.json() as {
    inline_query: { id: string };
  };
  await callBotApi(api, `${inlineBot.botApiPath}/answerInlineQuery`, {
    inline_query_id: inlineQuery.id,
    results: [{
      type: 'article',
      id: 'fact',
      title: 'Cat fact',
      input_message_content: { message_text: 'Cats sleep a lot' },
      reply_markup: { inline_keyboard: [[{ text: 'More', callback_data: 'more' }]] },
    }],
  });
  await api.request(
    `${accountPath}/inline-queries/${inlineQuery.id}/chosen-results`,
    jsonRequest('POST', { result_id: 'fact' }),
  );
  const chosenResult = (await readUpdates(inlineBot.botApiPath))
    .find((update) => update.chosen_inline_result !== undefined)
    ?.chosen_inline_result as Record<string, unknown> | undefined;
  const inlineMessageId = chosenResult?.inline_message_id;

  const richEdit = await callBotApi(api, `${inlineBot.botApiPath}/editMessageText`, {
    inline_message_id: inlineMessageId,
    rich_message: { blocks: [{ type: 'heading', text: 'Cats', size: 1 }] },
  });
  const uploadEdit = await callBotApiWithFiles(api, `${inlineBot.botApiPath}/editMessageText`, {
    inline_message_id: String(inlineMessageId),
    rich_message: JSON.stringify({
      blocks: [{ type: 'photo', photo: { type: 'photo', media: 'attach://cat' } }],
    }),
  }, { cat: new File([gifImage(2, 2)], 'cat.gif') });
  const inlineHistory = await (await api.request(
    `${accountPath}/conversations/private/${inlineBot.bot.id}/messages`,
  )).json() as { messages: Array<Record<string, unknown>> };
  if (
    JSON.stringify(richEdit.body) !== JSON.stringify({ ok: true, result: true }) ||
    !isBadRequestResponse(uploadEdit.body) ||
    uploadEdit.body.description !== 'Bad Request: invalid message content specified' ||
    JSON.stringify(inlineHistory.messages.at(-1)?.rich_message) !==
      JSON.stringify({ blocks: [{ type: 'heading', text: 'Cats', size: 1 }] })
  ) {
    throw new Error(
      `Expected an inline message to become rich without uploads, received ${
        JSON.stringify([richEdit.body, uploadEdit.body])
      }`,
    );
  }
});

Deno.test('a grammY bot sends a rich message with an uploaded photo', async () => {
  const { api, sessionPath, createdBot, createdAccount, sendText } =
    await createPrivateConversationFixture();
  await sendText('/start');
  const grammyBot = new Bot(createdBot.token, {
    client: {
      apiRoot: `http://emulator.example:9000${sessionPath}/bot-api`,
      fetch: createInProcessFetch(api.fetch),
    },
  });

  const message = await grammyBot.api.sendRichMessage(createdAccount.account.id, {
    blocks: [
      { type: 'paragraph', text: ['Our ', { type: 'italic', text: 'new' }, ' logo'] },
      {
        type: 'photo',
        photo: { type: 'photo', media: new InputFile(gifImage(32, 32), 'logo.gif') },
      },
    ],
  });
  const [paragraph, photo] = message.rich_message?.blocks ?? [];
  if (
    JSON.stringify(paragraph) !==
      JSON.stringify({
        type: 'paragraph',
        text: ['Our ', { type: 'italic', text: 'new' }, ' logo'],
      }) ||
    photo?.type !== 'photo' || photo.photo[0]?.width !== 32
  ) {
    throw new Error(`Expected grammY's rich message, received ${JSON.stringify(message)}`);
  }
});

Deno.test('setMyCommands, getMyCommands, and deleteMyCommands follow Telegram checks', async () => {
  const { api, sessionPath, botApiPath, createdBot, createdAccount, sendText } =
    await createPrivateConversationFixture();
  const accountId = createdAccount.account.id;
  const expectBadRequest = async (
    methodName: string,
    parameters: Record<string, unknown>,
    expectedDescription: string,
  ) => {
    const { status, body } = await callBotApi(api, `${botApiPath}/${methodName}`, parameters);
    if (status !== 400 || !isBadRequestResponse(body) || body.description !== expectedDescription) {
      throw new Error(
        `Expected ${methodName} ${
          JSON.stringify(parameters)
        } to fail with ${expectedDescription}, received ${status} ${JSON.stringify(body)}`,
      );
    }
  };
  const getCommands = async (parameters: Record<string, unknown>) => {
    const { status, body } = await callBotApi(api, `${botApiPath}/getMyCommands`, parameters);
    if (status !== 200 || typeof body !== 'object' || body === null || !('result' in body)) {
      throw new Error(
        `Expected getMyCommands to succeed, received ${status} ${JSON.stringify(body)}`,
      );
    }
    return body.result;
  };

  const setResponse = await api.request(`${botApiPath}/setMyCommands`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      commands: JSON.stringify([
        { command: '/start', description: 'Start over' },
        { command: 'help', description: 'Show help', is_ephemeral: true },
      ]),
      language_code: 'en',
    }),
  });
  const setBody: unknown = await setResponse.json();
  if (
    setResponse.status !== 200 ||
    JSON.stringify(setBody) !== JSON.stringify({ ok: true, result: true })
  ) {
    throw new Error(`Expected setMyCommands to succeed, received ${JSON.stringify(setBody)}`);
  }
  const englishCommands = [
    { command: 'start', description: 'Start over' },
    { command: 'help', description: 'Show help', is_ephemeral: true },
  ];
  if (
    JSON.stringify(await getCommands({ language_code: 'en' })) !==
      JSON.stringify(englishCommands) ||
    JSON.stringify(await getCommands({})) !== JSON.stringify([])
  ) {
    throw new Error('Expected getMyCommands to return exactly the list of its scope and language');
  }

  await expectBadRequest('setMyCommands', {
    commands: [{ command: 'Start', description: 'Go' }],
  }, 'Bad Request: BOT_COMMAND_INVALID');
  await expectBadRequest('setMyCommands', {
    commands: [{ command: 'start', description: ' ' }],
  }, 'Bad Request: command description must be non-empty');
  await expectBadRequest('setMyCommands', {
    commands: [{ command: 'c'.repeat(33), description: 'Go' }],
  }, 'Bad Request: command length must not exceed 32');
  await expectBadRequest(
    'setMyCommands',
    { commands: [], language_code: 'english' },
    'Bad Request: invalid language code specified',
  );
  await expectBadRequest(
    'getMyCommands',
    { scope: { type: 'chat', chat_id: accountId } },
    'Bad Request: chat not found',
  );
  await expectBadRequest(
    'deleteMyCommands',
    { scope: { type: 'everyone' } },
    "Bad Request: can't parse BotCommandScope: Unsupported type specified",
  );
  await expectBadRequest(
    'getMyCommands',
    { scope: { type: 'chat_member', chat_id: accountId, user_id: 0 } },
    "Bad Request: can't parse BotCommandScope: Invalid user_id specified",
  );
  await expectBadRequest(
    'setMyCommands',
    { commands: [{ command: 'start' }] },
    'Bad Request: invalid setMyCommands parameters',
  );

  await sendText('Hi');
  await expectBadRequest(
    'getMyCommands',
    { scope: { type: 'chat_administrators', chat_id: accountId } },
    "Bad Request: can't use specified scope in private chats",
  );
  const chatScope = { type: 'chat', chat_id: accountId };
  const chatSetResult = await callBotApi(api, `${botApiPath}/setMyCommands`, {
    commands: [{ command: 'order', description: 'Order again' }],
    scope: chatScope,
  });
  if (chatSetResult.status !== 200) {
    throw new Error(
      `Expected chat commands to be set, received ${JSON.stringify(chatSetResult.body)}`,
    );
  }
  const commandsPath =
    `${sessionPath}/accounts/${accountId}/conversations/private/${createdBot.bot.id}/commands`;
  const chatCommandsBody: unknown = await (await api.request(commandsPath)).json();
  if (
    JSON.stringify(chatCommandsBody) !== JSON.stringify({
      commands: [{ command: 'order', description: 'Order again', is_ephemeral: false }],
    })
  ) {
    throw new Error(
      `Expected the account to see its chat's commands, received ${
        JSON.stringify(chatCommandsBody)
      }`,
    );
  }

  const deleteResult = await callBotApi(api, `${botApiPath}/deleteMyCommands`, {
    scope: chatScope,
  });
  const fallbackBody: unknown = await (await api.request(commandsPath)).json();
  if (
    deleteResult.status !== 200 ||
    JSON.stringify(fallbackBody) !== JSON.stringify({ commands: [] }) ||
    JSON.stringify(await getCommands({ scope: chatScope })) !== JSON.stringify([])
  ) {
    throw new Error(
      `Expected the chat's commands to be deleted, received ${JSON.stringify(fallbackBody)}`,
    );
  }
  const unknownBotResponse = await api.request(
    `${sessionPath}/accounts/${accountId}/conversations/private/999/commands`,
  );
  if (unknownBotResponse.status !== 404) {
    throw new Error(
      `Expected an unknown bot to be reported, received ${unknownBotResponse.status}`,
    );
  }
});

Deno.test('bots set and read their descriptions and short descriptions by language', async () => {
  const { api, botApiPath } = await createPrivateConversationFixture();
  const callBot = async (methodName: string, parameters: Record<string, unknown>) =>
    await callBotApi(api, `${botApiPath}/${methodName}`, parameters);
  const expectResult = async (
    methodName: string,
    parameters: Record<string, unknown>,
    expectedResult: unknown,
  ) => {
    const { status, body } = await callBot(methodName, parameters);
    if (
      status !== 200 ||
      JSON.stringify(body) !== JSON.stringify({ ok: true, result: expectedResult })
    ) {
      throw new Error(
        `Expected ${methodName} ${JSON.stringify(parameters)} to return ${
          JSON.stringify(expectedResult)
        }, received ${status} ${JSON.stringify(body)}`,
      );
    }
  };

  await expectResult('getMyDescription', {}, { description: '' });
  await expectResult('setMyDescription', { description: 'Orders\tpizza ' }, true);
  await expectResult('setMyShortDescription', {
    short_description: 'Bestellt Pizza',
    language_code: 'de',
  }, true);
  await expectResult('getMyDescription', {}, { description: 'Orders pizza ' });
  await expectResult('getMyDescription', { language_code: 'de' }, { description: '' });
  await expectResult('getMyShortDescription', { language_code: 'de' }, {
    short_description: 'Bestellt Pizza',
  });
  await expectResult('getMyShortDescription', {}, { short_description: '' });

  // A missing text removes the text for the language, as an empty one does.
  await expectResult('setMyDescription', {}, true);
  await expectResult('getMyDescription', {}, { description: '' });

  const failures = [
    [
      'setMyDescription',
      { description: 'Hi', language_code: 'en-US' },
      'Bad Request: invalid language code specified',
    ],
    [
      'getMyShortDescription',
      { language_code: 'EN' },
      'Bad Request: invalid language code specified',
    ],
    [
      'setMyShortDescription',
      { short_description: '\ud800', language_code: 'EN' },
      'Bad Request: strings must be encoded in UTF-8',
    ],
    [
      'setMyDescription',
      { description: 'Hi', short_description: 'Hi' },
      'Bad Request: invalid setMyDescription parameters',
    ],
  ] as const;
  for (const [methodName, parameters, expectedDescription] of failures) {
    const { status, body } = await callBot(methodName, parameters);
    if (status !== 400 || !isBadRequestResponse(body) || body.description !== expectedDescription) {
      throw new Error(
        `Expected ${methodName} ${
          JSON.stringify(parameters)
        } to fail with ${expectedDescription}, received ${status} ${JSON.stringify(body)}`,
      );
    }
  }
});

Deno.test('bots set and read the administrator rights they ask for by default', async () => {
  const { api, botApiPath } = await createPrivateConversationFixture();
  const callBot = async (methodName: string, parameters: Record<string, unknown>) =>
    await callBotApi(api, `${botApiPath}/${methodName}`, parameters);
  const noGroupRights = {
    can_manage_chat: false,
    can_change_info: false,
    can_delete_messages: false,
    can_invite_users: false,
    can_restrict_members: false,
    can_pin_messages: false,
    can_manage_topics: false,
    can_promote_members: false,
    can_manage_video_chats: false,
    can_post_stories: false,
    can_edit_stories: false,
    can_delete_stories: false,
    can_manage_tags: false,
    can_send_welcome_messages: false,
    is_anonymous: false,
  };
  const noChannelRights = {
    can_manage_chat: false,
    can_change_info: false,
    can_post_messages: false,
    can_edit_messages: false,
    can_delete_messages: false,
    can_invite_users: false,
    can_restrict_members: false,
    can_promote_members: false,
    can_manage_video_chats: false,
    can_post_stories: false,
    can_edit_stories: false,
    can_delete_stories: false,
    can_manage_direct_messages: false,
    can_send_welcome_messages: false,
    is_anonymous: false,
  };
  const expectResult = async (
    methodName: string,
    parameters: Record<string, unknown>,
    expectedResult: unknown,
  ) => {
    const { status, body } = await callBot(methodName, parameters);
    if (
      status !== 200 ||
      JSON.stringify(body) !== JSON.stringify({ ok: true, result: expectedResult })
    ) {
      throw new Error(
        `Expected ${methodName} ${JSON.stringify(parameters)} to return ${
          JSON.stringify(expectedResult)
        }, received ${status} ${JSON.stringify(body)}`,
      );
    }
  };

  await expectResult('getMyDefaultAdministratorRights', {}, noGroupRights);
  await expectResult('setMyDefaultAdministratorRights', {
    rights: { can_delete_messages: true, can_post_messages: true, is_anonymous: true },
  }, true);
  await expectResult('setMyDefaultAdministratorRights', {
    rights: { can_post_messages: true, is_anonymous: true },
    for_channels: true,
  }, true);
  await expectResult('getMyDefaultAdministratorRights', {}, {
    ...noGroupRights,
    can_manage_chat: true,
    can_delete_messages: true,
    is_anonymous: true,
  });
  await expectResult('getMyDefaultAdministratorRights', { for_channels: true }, {
    ...noChannelRights,
    can_manage_chat: true,
    can_post_messages: true,
  });

  // Missing rights remove the group defaults and leave the channel defaults.
  await expectResult('setMyDefaultAdministratorRights', {}, true);
  await expectResult('getMyDefaultAdministratorRights', { for_channels: false }, noGroupRights);
  await expectResult('getMyDefaultAdministratorRights', { for_channels: true }, {
    ...noChannelRights,
    can_manage_chat: true,
    can_post_messages: true,
  });

  const failures = [
    [{ rights: 'not json' }, "Bad Request: can't parse ChatAdministratorRights JSON object"],
    [
      { rights: [] },
      "Bad Request: can't parse ChatAdministratorRights: ChatAdministratorRights must be an Object",
    ],
    [
      { rights: { can_manage_chat: true, can_invite_users: 'true' } },
      'Bad Request: can\'t parse ChatAdministratorRights: Field "can_invite_users" must be of type Boolean',
    ],
    [
      { rights: { can_fly: true } },
      'Bad Request: invalid setMyDefaultAdministratorRights parameters',
    ],
  ] as const;
  for (const [parameters, expectedDescription] of failures) {
    const { status, body } = await callBot('setMyDefaultAdministratorRights', parameters);
    if (status !== 400 || !isBadRequestResponse(body) || body.description !== expectedDescription) {
      throw new Error(
        `Expected ${
          JSON.stringify(parameters)
        } to fail with ${expectedDescription}, received ${status} ${JSON.stringify(body)}`,
      );
    }
  }
});

Deno.test('bots choose the menu button accounts see in their private chats', async () => {
  const { api, sessionPath, botApiPath, createdBot, createdAccount } =
    await createPrivateConversationFixture();
  const accountId = createdAccount.account.id;
  const callBot = async (methodName: string, parameters: Record<string, unknown>) =>
    await callBotApi(api, `${botApiPath}/${methodName}`, parameters);
  const expectResult = async (
    methodName: string,
    parameters: Record<string, unknown>,
    expectedResult: unknown,
  ) => {
    const { status, body } = await callBot(methodName, parameters);
    if (
      status !== 200 ||
      JSON.stringify(body) !== JSON.stringify({ ok: true, result: expectedResult })
    ) {
      throw new Error(
        `Expected ${methodName} ${JSON.stringify(parameters)} to return ${
          JSON.stringify(expectedResult)
        }, received ${status} ${JSON.stringify(body)}`,
      );
    }
  };
  const accountMenuButton = async () => {
    const response = await api.request(
      `${sessionPath}/accounts/${accountId}/conversations/private/${createdBot.bot.id}/menu-button`,
    );
    return await response.json();
  };
  const shopButton = { type: 'web_app', text: 'Shop', web_app: { url: 'https://shop.example/' } };

  await expectResult('getChatMenuButton', {}, { type: 'default' });
  await expectResult('setChatMenuButton', { menu_button: { type: 'commands' } }, true);
  await expectResult('setChatMenuButton', {
    chat_id: accountId,
    menu_button: { type: 'web_app', text: 'Shop', web_app: { url: 'https://Shop.example' } },
  }, true);
  await expectResult('getChatMenuButton', {}, { type: 'commands' });
  await expectResult('getChatMenuButton', { chat_id: accountId }, shopButton);
  if (JSON.stringify(await accountMenuButton()) !== JSON.stringify({ menu_button: shopButton })) {
    throw new Error('Expected the account to see the menu button chosen for its chat');
  }

  // A missing button is the default one, which removes the chat's own choice.
  await expectResult('setChatMenuButton', { chat_id: accountId }, true);
  await expectResult('getChatMenuButton', { chat_id: accountId }, { type: 'commands' });
  if (
    JSON.stringify(await accountMenuButton()) !==
      JSON.stringify({ menu_button: { type: 'commands' } })
  ) {
    throw new Error('Expected the account to see the menu button for all chats');
  }

  const failures = [
    [
      'setChatMenuButton',
      { menu_button: 'not json' },
      "Bad Request: can't parse menu button JSON object",
    ],
    [
      'setChatMenuButton',
      { menu_button: [] },
      "Bad Request: can't parse menu button: MenuButton must be an Object",
    ],
    [
      'setChatMenuButton',
      { menu_button: {} },
      'Bad Request: can\'t parse menu button: Can\'t find field "type"',
    ],
    [
      'setChatMenuButton',
      { menu_button: { type: 'mini_app' } },
      "Bad Request: can't parse menu button: MenuButton has unsupported type",
    ],
    [
      'setChatMenuButton',
      { menu_button: { type: 'web_app', text: 'Shop' } },
      'Bad Request: can\'t parse menu button: Can\'t find field "web_app"',
    ],
    ['setChatMenuButton', {
      menu_button: { type: 'web_app', text: 'Shop', web_app: 'https://shop.example' },
    }, 'Bad Request: can\'t parse menu button: Field "web_app" must be of type Object'],
    ['setChatMenuButton', {
      menu_button: { type: 'web_app', text: '', web_app: { url: 'https://shop.example' } },
    }, 'Bad Request: menu button text must be non-empty'],
    [
      'setChatMenuButton',
      { menu_button: { type: 'web_app', text: 'Shop', web_app: { url: 'http://shop.example' } } },
      "Bad Request: menu button Web App URL 'http://shop.example' is invalid: Only HTTPS links are allowed",
    ],
    [
      'setChatMenuButton',
      { menu_button: { type: 'commands', text: 'Menu' } },
      'Bad Request: invalid setChatMenuButton parameters',
    ],
    // The button is read before the chat.
    [
      'setChatMenuButton',
      { chat_id: -1, menu_button: { type: 'mini_app' } },
      "Bad Request: can't parse menu button: MenuButton has unsupported type",
    ],
    ['setChatMenuButton', { chat_id: -1 }, 'Bad Request: invalid chat_id specified'],
    ['getChatMenuButton', { chat_id: createdBot.bot.id }, 'Bad Request: user not found'],
    ['getChatMenuButton', { chat_id: 'Ada' }, 'Bad Request: invalid getChatMenuButton parameters'],
  ] as const;
  for (const [methodName, parameters, expectedDescription] of failures) {
    const { status, body } = await callBot(methodName, parameters);
    if (status !== 400 || !isBadRequestResponse(body) || body.description !== expectedDescription) {
      throw new Error(
        `Expected ${methodName} ${
          JSON.stringify(parameters)
        } to fail with ${expectedDescription}, received ${status} ${JSON.stringify(body)}`,
      );
    }
  }
});

Deno.test('accounts see the chat action a bot shows until its next message', async () => {
  const { api, sessionPath, botApiPath, createdBot, createdAccount, sendText } =
    await createPrivateConversationFixture();
  const accountId = createdAccount.account.id;
  const chatActionsPath =
    `${sessionPath}/accounts/${accountId}/conversations/private/${createdBot.bot.id}/chat-actions`;
  const shownActions = async () => (await api.request(chatActionsPath)).json();
  await sendText('Hi');

  const actionResponse = await callBotApi(api, `${botApiPath}/sendChatAction`, {
    chat_id: accountId,
    action: 'UPLOAD_PHOTO',
  });
  const whileUploading = await shownActions();
  await callBotApi(api, `${botApiPath}/sendMessage`, { chat_id: accountId, text: 'Done' });
  const afterMessage = await shownActions();
  const unknownBotResponse = await api.request(
    `${sessionPath}/accounts/${accountId}/conversations/private/999/chat-actions`,
  );
  if (
    actionResponse.status !== 200 ||
    JSON.stringify(whileUploading) !==
      JSON.stringify({ chat_actions: [{ bot_id: createdBot.bot.id, action: 'upload_photo' }] }) ||
    JSON.stringify(afterMessage) !== JSON.stringify({ chat_actions: [] }) ||
    unknownBotResponse.status !== 404
  ) {
    throw new Error(
      `Expected the action until the bot's message, received ${
        JSON.stringify([whileUploading, afterMessage])
      }`,
    );
  }
});

Deno.test('accounts see which bot messages notify them silently', async () => {
  const { api, sessionPath, owner, member, bot, supergroup, supergroupPath, sendSupergroupText } =
    await createSupergroupFixture();
  await api.request(
    `${sessionPath}/accounts/${owner.id}/messages`,
    jsonRequest('POST', { to: { type: 'private', botId: bot.bot.id }, text: '/start' }),
  );
  const call = async (method: string, parameters: Record<string, unknown>) =>
    await callBotApi(api, `${bot.botApiPath}/${method}`, parameters);
  const loud = botApiResult((await call('sendMessage', { chat_id: owner.id, text: 'Loud' })).body);
  const quiet = botApiResult(
    (await call('sendMessage', {
      chat_id: owner.id,
      text: 'Quiet',
      disable_notification: true,
    })).body,
  );
  const quietCopies = botApiResult(
    (await call('copyMessages', {
      chat_id: owner.id,
      from_chat_id: owner.id,
      message_ids: [loud?.message_id],
      disable_notification: true,
    })).body,
  ) as unknown as Array<{ message_id: number }> | undefined;
  const memberMessage = await sendSupergroupText(member.id, 'Hi');
  const quietForward = botApiResult(
    (await call('forwardMessage', {
      chat_id: supergroup.id,
      from_chat_id: supergroup.id,
      message_id: memberMessage.message_id,
      disable_notification: 'true',
    })).body,
  );
  const invalid = await call('sendMessage', {
    chat_id: owner.id,
    text: 'Maybe',
    disable_notification: 'maybe',
  });

  const privateNotifications = await (await api.request(
    `${sessionPath}/accounts/${owner.id}/conversations/private/${bot.bot.id}/notifications`,
  )).json();
  const memberNotifications = await (await api.request(
    `${supergroupPath(member.id)}/notifications`,
  )).json() as { notifications: Array<{ message_id: number; is_silent: boolean }> };
  const outsider = await createAccount(api, sessionPath, 'Linus');
  const outsiderResponse = await api.request(`${supergroupPath(outsider.id)}/notifications`);
  if (
    invalid.status !== 400 || outsiderResponse.status !== 403 ||
    JSON.stringify(privateNotifications) !== JSON.stringify({
        notifications: [
          { message_id: loud?.message_id, is_silent: false },
          { message_id: quiet?.message_id, is_silent: true },
          { message_id: quietCopies?.[0]?.message_id, is_silent: true },
        ],
      }) ||
    // The member's own message gives it no notification.
    JSON.stringify(memberNotifications.notifications.slice(-1)) !==
      JSON.stringify([{ message_id: quietForward?.message_id, is_silent: true }]) ||
    memberNotifications.notifications.some(({ message_id }) =>
      message_id === memberMessage.message_id
    )
  ) {
    throw new Error(
      `Expected silent notifications for silent messages only, received ${
        JSON.stringify({
          invalidStatus: invalid.status,
          outsiderStatus: outsiderResponse.status,
          privateNotifications,
          memberNotifications,
        })
      }`,
    );
  }
});

Deno.test('sendChatAction accepts Telegram actions in started private chats', async () => {
  const { api, botApiPath, createdAccount, sendText } = await createPrivateConversationFixture();
  const accountId = createdAccount.account.id;
  const sendChatAction = (parameters: Record<string, unknown>) =>
    callBotApi(api, `${botApiPath}/sendChatAction`, parameters);
  const expectDescription = async (parameters: Record<string, unknown>, expected: string) => {
    const { status, body } = await sendChatAction(parameters);
    if (status !== 400 || !isBadRequestResponse(body) || body.description !== expected) {
      throw new Error(
        `Expected ${JSON.stringify(parameters)} to fail with ${expected}, received ${
          JSON.stringify(body)
        }`,
      );
    }
  };

  await expectDescription({ chat_id: accountId, action: 'typing' }, 'Bad Request: chat not found');
  await sendText('Hi');
  for (const action of ['typing', 'UPLOAD_PHOTO', 'record_audio', 'cancel']) {
    const { status, body } = await sendChatAction({ chat_id: accountId, action });
    if (status !== 200 || JSON.stringify(body) !== JSON.stringify({ ok: true, result: true })) {
      throw new Error(
        `Expected ${action} to be accepted, received ${status} ${JSON.stringify(body)}`,
      );
    }
  }
  // Telegram reads the action before the chat.
  await expectDescription({ action: 'dancing' }, 'Bad Request: wrong parameter action in request');
  await expectDescription({ chat_id: accountId }, 'Bad Request: wrong parameter action in request');
  await expectDescription({ action: 'typing' }, 'Bad Request: chat_id is empty');
  await expectDescription(
    { chat_id: accountId, action: 'typing', message_thread_id: 1 },
    'Bad Request: invalid sendChatAction parameters',
  );
});

/** Returns what `pending` settles to, failing if it is still pending after `milliseconds`. */
Deno.test('sendMessage replies to messages of the chat and accepts Telegram message options', async () => {
  const { api, sessionPath, botApiPath, createdBot, createdAccount, sendText } =
    await createPrivateConversationFixture();
  const accountId = createdAccount.account.id;
  await sendText('Question?');
  const sendMessage = (parameters: Record<string, unknown>) =>
    callBotApi(api, `${botApiPath}/sendMessage`, {
      chat_id: accountId,
      text: 'Answer',
      ...parameters,
    });
  const repliedMessageIdOf = (body: unknown) => {
    const replyToMessage = botApiResult(body)?.reply_to_message;
    return typeof replyToMessage === 'object' && replyToMessage !== null
      ? (replyToMessage as Record<string, unknown>).message_id
      : undefined;
  };

  const reply = await sendMessage({
    reply_parameters: { message_id: 1, chat_id: accountId },
    protect_content: true,
    disable_notification: true,
    link_preview_options: { is_disabled: true },
  });
  const replyResult = botApiResult(reply.body);
  if (
    reply.status !== 200 || repliedMessageIdOf(reply.body) !== 1 ||
    (replyResult?.reply_to_message as Record<string, unknown>).text !== 'Question?' ||
    replyResult?.has_protected_content !== true || 'link_preview_options' in replyResult
  ) {
    throw new Error(
      `Expected a protected reply to the question, received ${JSON.stringify(reply)}`,
    );
  }
  const olderFormReply = await api.request(`${botApiPath}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      chat_id: String(accountId),
      text: 'Answer',
      reply_to_message_id: '1',
      disable_web_page_preview: 'true',
    }),
  });
  if (repliedMessageIdOf(await olderFormReply.json()) !== 1) {
    throw new Error('Expected reply_to_message_id to reply as Telegram still allows');
  }
  const replyParametersWithoutReply = await sendMessage({
    reply_parameters: {},
    reply_to_message_id: 1,
  });
  const replyToMissingMessageWithoutReply = await sendMessage({
    reply_parameters: { message_id: 99, allow_sending_without_reply: true },
  });
  if (
    replyParametersWithoutReply.status !== 200 ||
    repliedMessageIdOf(replyParametersWithoutReply.body) !== undefined ||
    replyToMissingMessageWithoutReply.status !== 200 ||
    repliedMessageIdOf(replyToMissingMessageWithoutReply.body) !== undefined
  ) {
    throw new Error('Expected reply_parameters to override the older form and allow no reply');
  }

  const quotedReply = await sendMessage({
    reply_parameters: {
      message_id: 1,
      quote: 'Question',
      quote_parse_mode: 'HTML',
      quote_position: 3,
    },
  });
  const quoteResult = botApiResult(quotedReply.body)?.quote;
  if (
    quotedReply.status !== 200 || repliedMessageIdOf(quotedReply.body) !== 1 ||
    JSON.stringify(quoteResult) !==
      JSON.stringify({ text: 'Question', position: 0, is_manual: true })
  ) {
    throw new Error(
      `Expected a reply with a chosen quote, received ${JSON.stringify(quotedReply)}`,
    );
  }

  const rejections: [Record<string, unknown>, string][] = [
    [{ reply_parameters: { message_id: 99 } }, 'Bad Request: message to be replied not found'],
    // The chat is checked before the replied message.
    [
      { chat_id: 999, reply_parameters: { message_id: 99 } },
      'Bad Request: chat not found',
    ],
    // The replied message's chat must be one the bot can read.
    [
      { reply_parameters: { message_id: 1, chat_id: createdBot.bot.id } },
      'Bad Request: chat not found',
    ],
    // A quote must be an exact part of the replied text.
    [
      { reply_parameters: { message_id: 1, quote: 'question' } },
      'Bad Request: QUOTE_TEXT_INVALID',
    ],
    // Its formatting is read before the chat.
    [
      {
        chat_id: 999,
        reply_parameters: { message_id: 1, quote: '*x', quote_parse_mode: 'Markdown' },
      },
      "Bad Request: can't parse entities: Can't find end of the entity starting at byte offset 0",
    ],
    [
      { reply_parameters: { message_id: 1, checklist_task_id: 1 } },
      'Bad Request: invalid sendMessage parameters',
    ],
    [
      { link_preview_options: { is_disabled: 'yes' } },
      'Bad Request: invalid sendMessage parameters',
    ],
  ];
  for (const [parameters, expectedDescription] of rejections) {
    const { status, body } = await sendMessage(parameters);
    if (status !== 400 || !isBadRequestResponse(body) || body.description !== expectedDescription) {
      throw new Error(
        `Expected ${JSON.stringify(parameters)} to fail with ${expectedDescription}, received ${
          JSON.stringify(body)
        }`,
      );
    }
  }

  const accountMessagesPath = `${sessionPath}/accounts/${accountId}/messages`;
  const sendAccountReply = (replyToMessageId: number) =>
    api.request(accountMessagesPath, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        to: { type: 'private', botId: createdBot.bot.id },
        text: 'Thanks',
        reply_to_message_id: replyToMessageId,
      }),
    });
  // The replied message never shows its own reply.
  const { reply_to_message: _, ...repliedBotMessage } = replyResult;
  const accountReply = await sendAccountReply(2);
  const accountReplyBody: unknown = await accountReply.json();
  const missingReplyTarget = await sendAccountReply(99);
  if (
    accountReply.status !== 201 || !isSentMessageResponse(accountReplyBody) ||
    JSON.stringify(accountReplyBody.message) !==
      JSON.stringify({ ...accountReplyBody.message, reply_to_message: repliedBotMessage }) ||
    missingReplyTarget.status !== 400
  ) {
    throw new Error("Expected the account to reply only to its chat's messages");
  }
  const updatesBody: unknown = await (await api.request(`${botApiPath}/getUpdates`)).json();
  const updatedMessage = isGetUpdatesResponse(updatesBody)
    ? updatesBody.result.at(-1)?.message
    : undefined;
  if (JSON.stringify(updatedMessage) !== JSON.stringify(accountReplyBody.message)) {
    throw new Error('Expected the bot to receive the account reply with the replied message');
  }
});

Deno.test('a grammY bot asks a question in a reply and reads the account reply to it', async () => {
  const { api, sessionPath, createdBot, createdAccount, sendText } =
    await createPrivateConversationFixture();
  const grammyBot = new Bot(createdBot.token, {
    client: {
      apiRoot: `http://emulator.example:9000${sessionPath}/bot-api`,
      fetch: createInProcessFetch(api.fetch),
    },
  });
  const questionAsked = Promise.withResolvers<number>();
  const greeted = Promise.withResolvers<void>();
  grammyBot.command('start', async (context) => {
    const question = await context.reply('What is your name?', {
      reply_parameters: { message_id: context.msg.message_id },
      link_preview_options: { is_disabled: true },
    });
    questionAsked.resolve(question.message_id);
  });
  grammyBot.on('message:text', async (context) => {
    if (context.msg.reply_to_message?.message_id !== await questionAsked.promise) {
      return;
    }
    await context.reply(`Nice to meet you, ${context.msg.text}!`, { protect_content: true });
    greeted.resolve();
  });
  const polling = grammyBot.start();

  try {
    await sendText('/start');
    // Polling ends only when stopped, so settling first means the bot failed.
    const questionMessageId = await Promise.race([questionAsked.promise, polling]);
    const answer = await api.request(
      `${sessionPath}/accounts/${createdAccount.account.id}/messages`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: { type: 'private', botId: createdBot.bot.id },
          text: 'Ada',
          reply_to_message_id: questionMessageId,
        }),
      },
    );
    if (answer.status !== 201) {
      throw new Error(`Expected the account reply to be accepted, received ${answer.status}`);
    }
    await Promise.race([greeted.promise, polling]);
  } finally {
    await grammyBot.stop();
    await polling;
  }

  const historyBody: unknown = await (await api.request(
    `${sessionPath}/accounts/${createdAccount.account.id}/conversations/private/${createdBot.bot.id}/messages`,
  )).json();
  const history = isMessageHistoryResponse(historyBody)
    ? historyBody.messages.map((message) => {
      const { text, reply_to_message, has_protected_content } = message as
        & TestPrivateMessage
        & {
          reply_to_message?: { text: string };
          has_protected_content?: true;
        };
      return [text, reply_to_message?.text ?? null, has_protected_content ?? false];
    })
    : undefined;
  if (
    JSON.stringify(history) !==
      JSON.stringify([
        ['/start', null, false],
        ['What is your name?', '/start', false],
        ['Ada', 'What is your name?', false],
        ['Nice to meet you, Ada!', null, true],
      ])
  ) {
    throw new Error(
      `Expected the question and answer as replies, received ${JSON.stringify(history)}`,
    );
  }
});

Deno.test("sendMessage changes the reply interface the account's client shows", async () => {
  const { api, sessionPath, botApiPath, createdBot, createdAccount, sendText } =
    await createPrivateConversationFixture();
  const accountId = createdAccount.account.id;
  const accountPath = `${sessionPath}/accounts/${accountId}`;
  const replyInterfacePath =
    `${accountPath}/conversations/private/${createdBot.bot.id}/reply-interface`;
  const readReplyInterface = async () => {
    const response = await api.request(replyInterfacePath);
    const body = await response.json() as { reply_interface: unknown };
    return body.reply_interface;
  };
  const pressButton = (text: string) =>
    api.request(`${accountPath}/reply-keyboard-presses`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat: { type: 'private', botId: createdBot.bot.id }, text }),
    });
  const sendMarkup = (replyMarkup: unknown) =>
    callBotApi(api, `${botApiPath}/sendMessage`, {
      chat_id: accountId,
      text: 'Choose',
      reply_markup: replyMarkup,
    });
  await sendText('/start');
  if (await readReplyInterface() !== null) {
    throw new Error('Expected no reply interface before the bot sends one');
  }

  const keyboardReply = await api.request(`${botApiPath}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      chat_id: String(accountId),
      text: 'Pick a color',
      reply_markup: JSON.stringify({
        keyboard: [['Red', { text: 'Green' }], [{ text: 'Blue' }]],
        resize_keyboard: true,
        one_time_keyboard: true,
        input_field_placeholder: 'Color',
        selective: true,
      }),
    }),
  });
  const keyboardReplyBody: unknown = await keyboardReply.json();
  if (keyboardReply.status !== 200 || botApiResult(keyboardReplyBody)?.reply_markup !== undefined) {
    throw new Error('Expected the sent message not to show its reply keyboard to the bot');
  }
  const expectedKeyboard = {
    type: 'keyboard',
    message_id: 2,
    keyboard: [[{ text: 'Red' }, { text: 'Green' }], [{ text: 'Blue' }]],
    is_persistent: false,
    resize_keyboard: true,
    one_time_keyboard: true,
    input_field_placeholder: 'Color',
  };
  if (JSON.stringify(await readReplyInterface()) !== JSON.stringify(expectedKeyboard)) {
    throw new Error(
      `Expected the keyboard, received ${JSON.stringify(await readReplyInterface())}`,
    );
  }

  const press = await pressButton('Green');
  const pressBody: unknown = await press.json();
  const pressOfMissingButton = await pressButton('Purple');
  if (
    press.status !== 201 || !isSentMessageResponse(pressBody) ||
    pressBody.message.text !== 'Green' || pressBody.message.from.id !== accountId ||
    pressOfMissingButton.status !== 400
  ) {
    throw new Error("Expected only the keyboard's buttons to send their text");
  }
  const updatesBody: unknown = await (await api.request(`${botApiPath}/getUpdates`)).json();
  if (
    !isGetUpdatesResponse(updatesBody) ||
    JSON.stringify(updatesBody.result.at(-1)?.message) !== JSON.stringify(pressBody.message)
  ) {
    throw new Error('Expected the bot to receive the pressed button text as a message');
  }

  await sendMarkup({ force_reply: true, input_field_placeholder: 'Your name' });
  if (
    JSON.stringify(await readReplyInterface()) !==
      JSON.stringify({ type: 'force_reply', message_id: 4, input_field_placeholder: 'Your name' })
  ) {
    throw new Error('Expected a forced reply to replace the keyboard');
  }
  await sendMarkup({ keyboard: [['Red']] });
  await sendMarkup({ remove_keyboard: true });
  if (await readReplyInterface() !== null || (await pressButton('Red')).status !== 400) {
    throw new Error('Expected remove_keyboard to remove the keyboard');
  }
  await sendMarkup({ keyboard: [] });
  if (await readReplyInterface() !== null) {
    throw new Error('Expected a keyboard without rows to show nothing, as on Telegram');
  }

  // As in TDLib, reply markup other than an inline keyboard makes a message impossible to edit.
  for (const messageId of [2, 4, 6]) {
    const { status, body } = await callBotApi(api, `${botApiPath}/editMessageText`, {
      chat_id: accountId,
      message_id: messageId,
      text: 'Chosen',
    });
    if (
      status !== 400 || !isBadRequestResponse(body) ||
      body.description !== "Bad Request: message can't be edited"
    ) {
      throw new Error(`Expected message ${messageId} with reply markup not to be editable`);
    }
  }

  const invalidMarkups: unknown[] = [
    { keyboard: [[]] },
    { keyboard: [['']] },
    { keyboard: [[{ text: 'Share', request_contact: true, request_location: true }]] },
    { keyboard: [[{ text: 'Share phone', request_contact: false }]] },
    { keyboard: [['Red']], input_field_placeholder: 'x'.repeat(65) },
    { keyboard: [['Red']], inline_keyboard: [[{ text: 'Yes', callback_data: 'yes' }]] },
    { remove_keyboard: false },
    { force_reply: true, remove_keyboard: true },
  ];
  for (const replyMarkup of invalidMarkups) {
    const { status, body } = await sendMarkup(replyMarkup);
    if (
      status !== 400 || !isBadRequestResponse(body) ||
      body.description !== 'Bad Request: invalid sendMessage parameters'
    ) {
      throw new Error(`Expected ${JSON.stringify(replyMarkup)} to be rejected`);
    }
  }
  if (
    (await api.request(
        `${sessionPath}/accounts/999/conversations/private/${createdBot.bot.id}/reply-interface`,
      ))
        .status !== 404 ||
    (await api.request(`${accountPath}/conversations/private/999/reply-interface`)).status !== 404
  ) {
    throw new Error('Expected unknown participants to be not found');
  }
});

Deno.test('reply keyboard buttons request data only in private chats', async () => {
  const { api, sessionPath, botApiPath, createdBot, createdAccount, sendText } =
    await createPrivateConversationFixture();
  await sendText('/start');
  const accountId = createdAccount.account.id;
  const accountPath = `${sessionPath}/accounts/${accountId}`;
  const sendKeyboard = (chatId: number, keyboard: unknown, path = botApiPath) =>
    callBotApi(api, `${path}/sendMessage`, {
      chat_id: chatId,
      text: 'Share',
      reply_markup: { keyboard },
    });

  const sent = await sendKeyboard(accountId, [
    [{ text: 'Phone', request_contact: true }, { text: 'Here', request_location: true }],
    [{ text: 'Quiz', request_poll: { type: 'quiz' } }, { text: 'Poll', request_poll: {} }],
    [{ text: 'Shop', web_app: { url: 'HTTPS://shop.example' } }],
    [{ text: 'Friends', request_users: { request_id: 1, user_is_bot: false, max_quantity: 3 } }],
    [{
      text: 'Group',
      request_chat: {
        request_id: 2,
        chat_is_channel: false,
        chat_has_username: true,
        bot_administrator_rights: { can_pin_messages: true, can_post_messages: true },
        request_title: true,
      },
    }],
  ]);
  const replyInterface = (await (await api.request(
    `${accountPath}/conversations/private/${createdBot.bot.id}/reply-interface`,
  )).json() as { reply_interface?: { keyboard?: unknown } }).reply_interface;
  const groupRights = Object.fromEntries(
    [
      'can_manage_chat',
      'can_change_info',
      'can_delete_messages',
      'can_invite_users',
      'can_restrict_members',
      'can_pin_messages',
      'can_manage_topics',
      'can_promote_members',
      'can_manage_video_chats',
      'can_post_stories',
      'can_edit_stories',
      'can_delete_stories',
      'can_manage_tags',
      'can_send_welcome_messages',
      'is_anonymous',
    ].map((right) => [right, right === 'can_manage_chat' || right === 'can_pin_messages']),
  );
  const expectedKeyboard = [
    [{ text: 'Phone', request_contact: true }, { text: 'Here', request_location: true }],
    [{ text: 'Quiz', request_poll: { type: 'quiz' } }, { text: 'Poll', request_poll: {} }],
    [{ text: 'Shop', web_app: { url: 'https://shop.example/' } }],
    [{
      text: 'Friends',
      request_users: {
        request_id: 1,
        user_is_bot: false,
        max_quantity: 3,
        request_name: false,
        request_username: false,
        request_photo: false,
      },
    }],
    [{
      text: 'Group',
      request_chat: {
        request_id: 2,
        chat_is_channel: false,
        chat_has_username: true,
        chat_is_created: false,
        bot_administrator_rights: groupRights,
        bot_is_member: false,
        request_title: true,
        request_username: false,
        request_photo: false,
      },
    }],
  ];
  if (
    sent.status !== 200 ||
    JSON.stringify(replyInterface?.keyboard) !== JSON.stringify(expectedKeyboard)
  ) {
    throw new Error(
      `Expected the account to see every request, received ${
        JSON.stringify([sent, replyInterface])
      }`,
    );
  }

  const press = await api.request(
    `${accountPath}/reply-keyboard-presses`,
    jsonRequest('POST', { chat: { type: 'private', botId: createdBot.bot.id }, text: 'Phone' }),
  );
  if (press.status !== 400) {
    throw new Error(`Expected a request button not to send its text, received ${press.status}`);
  }

  const invalidWebApps: Array<[string, string]> = [
    [
      'http://shop.example',
      "Bad Request: keyboard button Web App URL 'http://shop.example' is invalid: " +
      'Only HTTPS links are allowed',
    ],
    ['tg://user?id=1', "Bad Request: link to a user can't be used in Web App URL buttons"],
  ];
  for (const [url, expectedDescription] of invalidWebApps) {
    const { body } = await sendKeyboard(accountId, [[{ text: 'Shop', web_app: { url } }]]);
    if (!isBadRequestResponse(body) || body.description !== expectedDescription) {
      throw new Error(`Expected ${url} to fail with ${expectedDescription}`);
    }
  }

  const group = await createSupergroupFixture();
  const groupRequests: Array<[unknown, string]> = [
    [{ request_contact: true }, 'phone number can be requested in private chats only'],
    [{ request_location: true }, 'location can be requested in private chats only'],
    [{ request_poll: {} }, 'poll can be requested in private chats only'],
    [
      { web_app: { url: 'http://shop.example' } },
      'web App buttons can be used in private chats only',
    ],
    [{ request_users: { request_id: 1 } }, 'users can be requested in private chats only'],
    [
      { request_chat: { request_id: 2, chat_is_channel: true } },
      'chats can be requested in private chats only',
    ],
  ];
  for (const [request, expectedError] of groupRequests) {
    const { body } = await callBotApi(group.api, `${group.bot.botApiPath}/sendMessage`, {
      chat_id: group.supergroup.id,
      text: 'Share',
      reply_markup: { keyboard: [['Hello', { text: 'Share', ...request as object }]] },
    });
    if (!isBadRequestResponse(body) || body.description !== `Bad Request: ${expectedError}`) {
      throw new Error(
        `Expected ${JSON.stringify(request)} to fail in a supergroup, received ${
          JSON.stringify(body)
        }`,
      );
    }
  }
});

Deno.test('a grammY bot runs a menu on a reply keyboard and asks with a forced reply', async () => {
  const { api, sessionPath, createdBot, createdAccount, sendText } =
    await createPrivateConversationFixture();
  const accountPath = `${sessionPath}/accounts/${createdAccount.account.id}`;
  const grammyBot = new Bot(createdBot.token, {
    client: {
      apiRoot: `http://emulator.example:9000${sessionPath}/bot-api`,
      fetch: createInProcessFetch(api.fetch),
    },
  });
  const handled = { menu: Promise.withResolvers<void>(), question: Promise.withResolvers<void>() };
  const done = Promise.withResolvers<void>();
  grammyBot.command('start', async (context) => {
    await context.reply('What next?', {
      reply_markup: new Keyboard().text('Rename').text('Quit').resized().oneTime(),
    });
    handled.menu.resolve();
  });
  grammyBot.hears('Rename', async (context) => {
    await context.reply('New name?', {
      reply_markup: { force_reply: true, input_field_placeholder: 'Name' },
    });
    handled.question.resolve();
  });
  grammyBot.on('message:text', async (context) => {
    if (context.msg.reply_to_message?.text !== 'New name?') {
      return;
    }
    await context.reply(`Renamed to ${context.msg.text}`, {
      reply_markup: { remove_keyboard: true },
    });
    done.resolve();
  });
  const polling = grammyBot.start();
  const readReplyInterface = async () => {
    const response = await api.request(
      `${accountPath}/conversations/private/${createdBot.bot.id}/reply-interface`,
    );
    return (await response.json() as { reply_interface: Record<string, unknown> | null })
      .reply_interface;
  };

  try {
    await sendText('/start');
    // Polling ends only when stopped, so settling first means the bot failed.
    await Promise.race([handled.menu.promise, polling]);
    const menu = await readReplyInterface();
    if (
      JSON.stringify(menu?.keyboard) !== JSON.stringify([[{ text: 'Rename' }, { text: 'Quit' }]])
    ) {
      throw new Error(`Expected the menu keyboard, received ${JSON.stringify(menu)}`);
    }
    await api.request(`${accountPath}/reply-keyboard-presses`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat: { type: 'private', botId: createdBot.bot.id }, text: 'Rename' }),
    });
    await Promise.race([handled.question.promise, polling]);
    const question = await readReplyInterface();
    if (question?.type !== 'force_reply' || question.input_field_placeholder !== 'Name') {
      throw new Error(`Expected the forced reply, received ${JSON.stringify(question)}`);
    }
    await api.request(`${accountPath}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        to: { type: 'private', botId: createdBot.bot.id },
        text: 'Grace',
        reply_to_message_id: question.message_id,
      }),
    });
    await Promise.race([done.promise, polling]);
  } finally {
    await grammyBot.stop();
    await polling;
  }

  if (await readReplyInterface() !== null) {
    throw new Error('Expected the final message to remove the reply interface');
  }
});

Deno.test('an account blocks a bot, which receives my_chat_member updates and Telegram 403s', async () => {
  const { api, sessionPath, botApiPath, createdBot, createdAccount, sendText } =
    await createPrivateConversationFixture();
  const accountId = createdAccount.account.id;
  const accountPath = `${sessionPath}/accounts/${accountId}`;
  const blockedBotPath = `${accountPath}/blocked-bots/${createdBot.bot.id}`;
  await sendText('/start');
  const keyboardReply = await callBotApi(api, `${botApiPath}/sendMessage`, {
    chat_id: accountId,
    text: 'Menu',
    reply_markup: { keyboard: [['Help']] },
  });
  if (keyboardReply.status !== 200) {
    throw new Error(`Expected the menu to be sent, received ${keyboardReply.status}`);
  }

  for (const _ of [1, 2]) {
    const blockResponse = await api.request(blockedBotPath, { method: 'PUT' });
    if (blockResponse.status !== 204) {
      throw new Error(`Expected blocking to succeed, received ${blockResponse.status}`);
    }
  }
  const blockedDescription = {
    ok: false,
    error_code: 403,
    description: 'Forbidden: bot was blocked by the user',
  };
  for (
    const [method, parameters] of [
      ['sendMessage', { chat_id: accountId, text: 'Still there?' }],
      ['sendChatAction', { chat_id: accountId, action: 'typing' }],
    ] as const
  ) {
    const { status, body } = await callBotApi(api, `${botApiPath}/${method}`, parameters);
    if (status !== 403 || JSON.stringify(body) !== JSON.stringify(blockedDescription)) {
      throw new Error(`Expected ${method} to be forbidden, received ${JSON.stringify(body)}`);
    }
  }
  const accountWrites = [
    await api.request(`${accountPath}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: { type: 'private', botId: createdBot.bot.id }, text: 'Hi' }),
    }),
    await api.request(`${accountPath}/reply-keyboard-presses`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat: { type: 'private', botId: createdBot.bot.id }, text: 'Help' }),
    }),
  ];
  if (accountWrites.some((response) => response.status !== 409)) {
    throw new Error(
      `Expected the account to write only after unblocking, received ${
        accountWrites.map((response) => response.status)
      }`,
    );
  }

  for (const _ of [1, 2]) {
    const unblockResponse = await api.request(blockedBotPath, { method: 'DELETE' });
    if (unblockResponse.status !== 204) {
      throw new Error(`Expected unblocking to succeed, received ${unblockResponse.status}`);
    }
  }
  const welcomeBack = await callBotApi(api, `${botApiPath}/sendMessage`, {
    chat_id: accountId,
    text: 'Welcome back',
  });
  if (welcomeBack.status !== 200) {
    throw new Error(`Expected the bot to write once unblocked, received ${welcomeBack.status}`);
  }

  const { body: updatesBody } = await callBotApi(api, `${botApiPath}/getUpdates`, {});
  const updates = (updatesBody as { result: Array<Record<string, unknown>> }).result;
  const botUser = {
    id: createdBot.bot.id,
    is_bot: true,
    first_name: 'Test Bot',
    username: 'test_bot',
  };
  const memberChanges = updates.slice(1).map(({ my_chat_member }) => {
    const { chat, from, old_chat_member, new_chat_member } = my_chat_member as Record<
      string,
      Record<string, unknown>
    >;
    return [chat.id, from.id, old_chat_member, new_chat_member];
  });
  const member = { user: botUser, status: 'member' };
  const kicked = { user: botUser, status: 'kicked', until_date: 0 };
  if (
    updates.length !== 3 ||
    JSON.stringify(memberChanges) !== JSON.stringify([
        [accountId, accountId, member, kicked],
        [accountId, accountId, kicked, member],
      ])
  ) {
    throw new Error(`Expected one update per block change, received ${JSON.stringify(updates)}`);
  }

  const invalidRequests = [
    [`${accountPath}/blocked-bots/${MAX_TELEGRAM_USER_ID}`, 'PUT', 404],
    [
      `${sessionPath}/accounts/${MAX_TELEGRAM_USER_ID}/blocked-bots/${createdBot.bot.id}`,
      'PUT',
      404,
    ],
    [`${accountPath}/blocked-bots/${accountId}`, 'DELETE', 404],
    [`${accountPath}/blocked-bots/bot`, 'PUT', 400],
  ] as const;
  for (const [path, method, expectedStatus] of invalidRequests) {
    const response = await api.request(path, { method });
    if (response.status !== expectedStatus) {
      throw new Error(
        `Expected ${method} ${path} to answer ${expectedStatus}, received ${response.status}`,
      );
    }
  }
});

Deno.test('accounts delete messages, which bots then no longer find', async () => {
  const { api, sessionPath, owner, member, bot, supergroup, supergroupPath, sendSupergroupText } =
    await createSupergroupFixture();
  const readUpdates = createUpdateReader(api);
  const privatePath = `${sessionPath}/accounts/${owner.id}/conversations/private/${bot.bot.id}`;
  const sent = await api.request(
    `${sessionPath}/accounts/${owner.id}/messages`,
    jsonRequest('POST', { to: { type: 'private', botId: bot.bot.id }, text: 'Hello' }),
  );
  const { message: greeting } = await sent.json() as { message: { message_id: number } };
  const question = botApiResult(
    (await callBotApi(api, `${bot.botApiPath}/sendMessage`, {
      chat_id: owner.id,
      text: 'Your name?',
      reply_markup: { force_reply: true },
    })).body,
  );
  await readUpdates(bot.botApiPath);

  // The account deletes the bot's question and its own greeting for both participants.
  const privateDeletions = [
    (await api.request(`${privatePath}/messages/${question?.message_id}`, { method: 'DELETE' }))
      .status,
    (await api.request(`${privatePath}/messages/${greeting.message_id}`, { method: 'DELETE' }))
      .status,
    (await api.request(`${privatePath}/messages/${greeting.message_id}`, { method: 'DELETE' }))
      .status,
    (await api.request(`${privatePath}/messages/0`, { method: 'DELETE' })).status,
  ];
  const edit = await callBotApi(api, `${bot.botApiPath}/editMessageText`, {
    chat_id: owner.id,
    message_id: question?.message_id,
    text: 'Your full name?',
  });
  const reply = await callBotApi(api, `${bot.botApiPath}/sendMessage`, {
    chat_id: owner.id,
    text: 'Hello to you',
    reply_parameters: { message_id: greeting.message_id },
  });
  const { reply_interface } = await (await api.request(`${privatePath}/reply-interface`))
    .json() as { reply_interface: unknown };
  const { messages: privateHistory } = await (await api.request(`${privatePath}/messages`))
    .json() as { messages: unknown[] };
  if (
    JSON.stringify(privateDeletions) !== JSON.stringify([204, 204, 404, 400]) ||
    JSON.stringify(edit.body) !== JSON.stringify({
        ok: false,
        error_code: 400,
        description: 'Bad Request: message to edit not found',
      }) ||
    (reply.body as { description?: string }).description !==
      'Bad Request: message to be replied not found' ||
    reply_interface !== null || privateHistory.length !== 0 ||
    (await readUpdates(bot.botApiPath)).length !== 0
  ) {
    throw new Error(
      `Expected the account to delete its private messages, received ${
        JSON.stringify({ privateDeletions, edit, reply, reply_interface, privateHistory })
      }`,
    );
  }

  // A member deletes only its own messages; the owner deletes any.
  const memberMessage = await sendSupergroupText(member.id, 'Oops');
  const ownerMessage = await sendSupergroupText(owner.id, 'Welcome');
  const botMessage = botApiResult(
    (await callBotApi(api, `${bot.botApiPath}/sendMessage`, {
      chat_id: supergroup.id,
      text: 'Rules',
    })).body,
  );
  const deleteInSupergroup = async (accountId: number, messageId: unknown) =>
    (await api.request(`${supergroupPath(accountId)}/messages/${messageId}`, {
      method: 'DELETE',
    })).status;
  const outsider = await createAccount(api, sessionPath, 'Linus');
  const supergroupDeletions = [
    await deleteInSupergroup(member.id, ownerMessage.message_id),
    await deleteInSupergroup(member.id, botMessage?.message_id),
    // The service message recording the member joining is the owner's.
    await deleteInSupergroup(member.id, 1),
    await deleteInSupergroup(outsider.id, memberMessage.message_id),
    await deleteInSupergroup(member.id, memberMessage.message_id),
    await deleteInSupergroup(owner.id, botMessage?.message_id),
    await deleteInSupergroup(owner.id, memberMessage.message_id),
  ];
  const { messages: supergroupHistory } = await (await api.request(
    `${supergroupPath(member.id)}/messages`,
  )).json() as { messages: Array<{ message_id: number }> };
  if (
    JSON.stringify(supergroupDeletions) !==
      JSON.stringify([403, 403, 403, 403, 204, 204, 404]) ||
    supergroupHistory.some(({ message_id }) =>
      message_id === memberMessage.message_id || message_id === botMessage?.message_id
    ) ||
    !supergroupHistory.some(({ message_id }) => message_id === ownerMessage.message_id)
  ) {
    throw new Error(
      `Expected members to delete the messages they may delete, received ${
        JSON.stringify({ supergroupDeletions, supergroupHistory })
      }`,
    );
  }
});

Deno.test('PATCH on an account message edits it and sends the bot an edited_message update', async () => {
  const { api, sessionPath, botApiPath, createdBot, createdAccount, sendText } =
    await createPrivateConversationFixture();
  const historyPath =
    `${sessionPath}/accounts/${createdAccount.account.id}/conversations/private/${createdBot.bot.id}/messages`;
  const editMessage = (messageId: number | string, body: unknown) =>
    api.request(`${historyPath}/${messageId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  await sendText('Hello');
  const botReply = await callBotApi(api, `${botApiPath}/sendMessage`, {
    chat_id: createdAccount.account.id,
    text: 'Hi',
  });
  const botMessageId = botApiResult(botReply.body)?.message_id;

  const response = await editMessage(1, { text: 'Hello /help' });
  const responseBody: unknown = await response.json();
  if (response.status !== 200 || !isSentMessageResponse(responseBody)) {
    throw new Error(`Expected the edit to succeed, received ${response.status}`);
  }
  const editedMessage = responseBody.message as TestPrivateMessage & { edit_date?: number };
  if (
    editedMessage.message_id !== 1 || editedMessage.text !== 'Hello /help' ||
    editedMessage.edit_date === undefined ||
    JSON.stringify(editedMessage.entities) !==
      JSON.stringify([{ type: 'bot_command', offset: 6, length: 5 }])
  ) {
    throw new Error(`Expected the edited message, received ${JSON.stringify(editedMessage)}`);
  }

  const { body: updatesBody } = await callBotApi(api, `${botApiPath}/getUpdates`, {});
  const updates = (updatesBody as { result: Array<Record<string, unknown>> }).result;
  if (
    updates.length !== 2 || JSON.stringify(updates[1]) !==
      JSON.stringify({
        update_id: updates[0].update_id as number + 1,
        edited_message: editedMessage,
      })
  ) {
    throw new Error(`Expected an edited_message update, received ${JSON.stringify(updates)}`);
  }

  const invalidEdits = [
    [1, { text: 'Hello /help' }, 400],
    [1, { text: '' }, 400],
    [1, { text: 'Hi', entities: [{ type: 'bold', offset: 0, length: 'all' }] }, 400],
    [botMessageId as number, { text: 'Changed' }, 400],
    [99, { text: 'Changed' }, 404],
    [0, { text: 'Changed' }, 400],
    ['first', { text: 'Changed' }, 400],
  ] as const;
  for (const [messageId, body, expectedStatus] of invalidEdits) {
    const invalidResponse = await editMessage(messageId, body);
    if (invalidResponse.status !== expectedStatus) {
      throw new Error(
        `Expected editing ${messageId} with ${
          JSON.stringify(body)
        } to answer ${expectedStatus}, received ${invalidResponse.status}`,
      );
    }
  }
});

Deno.test('a grammY bot answers an edited message and forgets a user who blocks it', async () => {
  const { api, sessionPath, createdBot, createdAccount, sendText } =
    await createPrivateConversationFixture();
  const accountPath = `${sessionPath}/accounts/${createdAccount.account.id}`;
  const grammyBot = new Bot(createdBot.token, {
    client: {
      apiRoot: `http://emulator.example:9000${sessionPath}/bot-api`,
      fetch: createInProcessFetch(api.fetch),
    },
  });
  const subscribers = new Set<number>();
  const handled = {
    subscription: Promise.withResolvers<void>(),
    edit: Promise.withResolvers<void>(),
    block: Promise.withResolvers<void>(),
  };
  grammyBot.command('subscribe', async (context) => {
    subscribers.add(context.chat.id);
    await context.reply('Subscribed');
    handled.subscription.resolve();
  });
  grammyBot.on('edited_message:text', async (context) => {
    await context.reply(`You changed it to: ${context.editedMessage.text}`);
    handled.edit.resolve();
  });
  grammyBot.on('my_chat_member', (context) => {
    if (context.myChatMember.new_chat_member.status === 'kicked') {
      subscribers.delete(context.chat.id);
      handled.block.resolve();
    }
  });
  const polling = grammyBot.start();

  let broadcastError: unknown;
  try {
    await sendText('/subscribe');
    // Polling ends only when stopped, so settling first means the bot failed.
    await Promise.race([handled.subscription.promise, polling]);
    const helloResponse = await api.request(`${accountPath}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: { type: 'private', botId: createdBot.bot.id }, text: 'Hello' }),
    });
    const helloBody: unknown = await helloResponse.json();
    if (!isSentMessageResponse(helloBody)) {
      throw new Error(`Expected "Hello" to be sent, received ${helloResponse.status}`);
    }
    await api.request(
      `${accountPath}/conversations/private/${createdBot.bot.id}/messages/${helloBody.message.message_id}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: 'Hello there' }),
      },
    );
    await Promise.race([handled.edit.promise, polling]);

    await api.request(`${accountPath}/blocked-bots/${createdBot.bot.id}`, { method: 'PUT' });
    try {
      await grammyBot.api.sendMessage(createdAccount.account.id, 'News');
    } catch (error) {
      broadcastError = error;
    }
    await Promise.race([handled.block.promise, polling]);
  } finally {
    await grammyBot.stop();
    await polling;
  }

  if (
    !(broadcastError instanceof GrammyError) || broadcastError.error_code !== 403 ||
    broadcastError.description !== 'Forbidden: bot was blocked by the user'
  ) {
    throw new Error(`Expected a GrammyError 403, received ${String(broadcastError)}`);
  }
  if (subscribers.size !== 0) {
    throw new Error('Expected the bot to forget the user who blocked it');
  }
  const historyBody: unknown = await (await api.request(
    `${accountPath}/conversations/private/${createdBot.bot.id}/messages`,
  )).json();
  if (
    !isMessageHistoryResponse(historyBody) ||
    JSON.stringify(historyBody.messages.map(({ text }) => text)) !== JSON.stringify([
        '/subscribe',
        'Subscribed',
        'Hello there',
        'You changed it to: Hello there',
      ])
  ) {
    throw new Error('Expected history to hold the edited message and the reply to the edit');
  }
});

Deno.test('an account creates a supergroup and adds a bot, which receives my_chat_member', async () => {
  const { api, sessionPath, owner, member, bot, readerBot, supergroup, supergroupPath } =
    await createSupergroupFixture();
  if (
    supergroup.type !== 'supergroup' || supergroup.title !== 'Team' ||
    supergroup.id > -1_000_000_000_000
  ) {
    throw new Error(`Expected a created supergroup, received ${JSON.stringify(supergroup)}`);
  }

  const { body } = await callBotApi(api, `${bot.botApiPath}/getUpdates`, {});
  const updates = (body as { result: Array<Record<string, unknown>> }).result;
  const botUser = {
    id: bot.bot.id,
    is_bot: true,
    first_name: bot.bot.first_name,
    username: bot.bot.username,
  };
  const expectedChatMemberUpdate = {
    chat: { id: supergroup.id, title: 'Team', type: 'supergroup' },
    from: owner,
    old_chat_member: { user: botUser, status: 'left' },
    new_chat_member: { user: botUser, status: 'member' },
  };
  const myChatMember = updates[0]?.my_chat_member as Record<string, unknown> | undefined;
  const { date, ...myChatMemberWithoutDate } = myChatMember ?? {};
  if (
    typeof date !== 'number' ||
    JSON.stringify(myChatMemberWithoutDate) !== JSON.stringify(expectedChatMemberUpdate)
  ) {
    throw new Error(`Expected a my_chat_member update first, received ${JSON.stringify(updates)}`);
  }
  // The bot then sees the service messages of its own addition and of the next bot's, but not of
  // the account's addition before it joined.
  const joinMessages = updates.slice(1).map((update) => update.message as Record<string, unknown>);
  const readerBotUser = { ...botUser, id: readerBot.bot.id, username: readerBot.bot.username };
  const expectedJoinMessages = [[2, botUser], [3, readerBotUser]].map(([messageId, user]) => ({
    message_id: messageId,
    from: owner,
    chat: expectedChatMemberUpdate.chat,
    date,
    new_chat_participant: user,
    new_chat_member: user,
    new_chat_members: [user],
  }));
  if (JSON.stringify(joinMessages) !== JSON.stringify(expectedJoinMessages)) {
    throw new Error(
      `Expected new_chat_members service messages, received ${JSON.stringify(updates)}`,
    );
  }

  const membersPath =
    `${sessionPath}/accounts/${owner.id}/conversations/supergroup/${supergroup.id}/members`;
  const additionStatuses = await Promise.all([
    api.request(`${membersPath}/${bot.bot.id}`, { method: 'PUT' }),
    api.request(
      `${sessionPath}/accounts/${member.id}/conversations/supergroup/${supergroup.id}/members/${owner.id}`,
      { method: 'PUT' },
    ),
    api.request(`${membersPath}/999`, { method: 'PUT' }),
    api.request(
      `${sessionPath}/accounts/${owner.id}/conversations/supergroup/-1000000009999/members/${bot.bot.id}`,
      { method: 'PUT' },
    ),
    api.request(
      `${sessionPath}/accounts/${owner.id}/conversations/supergroup/-5/members/${bot.bot.id}`,
      { method: 'PUT' },
    ),
  ]).then((responses) => responses.map((response) => response.status));
  if (JSON.stringify(additionStatuses) !== JSON.stringify([204, 403, 404, 404, 400])) {
    throw new Error(`Expected membership checks, received ${additionStatuses.join()}`);
  }
  const repeatedAddition = await callBotApi(api, `${bot.botApiPath}/getUpdates`, {
    offset: (updates.at(-1)?.update_id as number) + 1,
  });
  if ((repeatedAddition.body as { result: unknown[] }).result.length !== 0) {
    throw new Error('Expected adding a member again to send no update');
  }

  const creationFailures = await Promise.all([
    api.request(`${sessionPath}/accounts/999/supergroups`, jsonRequest('POST', { title: 'X' })),
    api.request(`${sessionPath}/accounts/${owner.id}/supergroups`, jsonRequest('POST', {})),
    api.request(
      `${sessionPath}/accounts/${owner.id}/supergroups`,
      jsonRequest('POST', { title: '' }),
    ),
  ]).then((responses) => responses.map((response) => response.status));
  if (JSON.stringify(creationFailures) !== JSON.stringify([404, 400, 400])) {
    throw new Error(`Expected supergroup creation checks, received ${creationFailures.join()}`);
  }

  const readerUpdates = await callBotApi(api, `${readerBot.botApiPath}/getUpdates`, {});
  const readerUpdate = (readerUpdates.body as { result: Array<Record<string, unknown>> }).result;
  if (
    readerUpdate.length !== 2 || readerUpdate[0].my_chat_member === undefined ||
    (readerUpdate[1].message as Record<string, unknown>)?.message_id !== 3
  ) {
    throw new Error(`Expected the second bot to learn it joined, received ${readerUpdate.length}`);
  }
  if (supergroupPath(owner.id) === supergroupPath(member.id)) {
    throw new Error('Expected each account to address the supergroup from its own path');
  }
});

Deno.test('bots set supergroup command scopes that members see in their menus', async () => {
  const { api, sessionPath, owner, member, bot, readerBot, supergroup, supergroupPath } =
    await createSupergroupFixture();
  const setCommands = (botApiPath: string, command: string, scope: Record<string, unknown>) =>
    callBotApi(api, `${botApiPath}/setMyCommands`, {
      commands: [{ command, description: command }],
      scope,
    });

  for (
    const [command, scope] of [
      ['everyone', { type: 'chat', chat_id: supergroup.id }],
      ['moderate', { type: 'chat_administrators', chat_id: supergroup.id }],
      ['mine', { type: 'chat_member', chat_id: supergroup.id, user_id: member.id }],
    ] as const
  ) {
    const { status, body } = await setCommands(bot.botApiPath, command, scope);
    if (status !== 200) {
      throw new Error(
        `Expected ${scope.type} commands to be set, received ${JSON.stringify(body)}`,
      );
    }
  }
  const menuOf = async (accountId: number) => {
    const response = await api.request(`${supergroupPath(accountId)}/commands`);
    const body: unknown = response.status === 200 ? await response.json() : undefined;
    return { status: response.status, body };
  };
  const expectedMenu = (command: string) => ({
    bot_commands: [{
      bot_id: bot.bot.id,
      commands: [{ command, description: command, is_ephemeral: false }],
    }],
  });
  const ownerMenu = await menuOf(owner.id);
  const memberMenu = await menuOf(member.id);
  if (
    JSON.stringify(ownerMenu.body) !== JSON.stringify(expectedMenu('moderate')) ||
    JSON.stringify(memberMenu.body) !== JSON.stringify(expectedMenu('mine'))
  ) {
    throw new Error(
      `Expected each member to see its own menu, received ${
        JSON.stringify([ownerMenu, memberMenu])
      }`,
    );
  }

  const leaveResult = await callBotApi(api, `${readerBot.botApiPath}/leaveChat`, {
    chat_id: supergroup.id,
  });
  const leftBotResult = await setCommands(readerBot.botApiPath, 'read', {
    type: 'chat',
    chat_id: supergroup.id,
  });
  if (
    leaveResult.status !== 200 || leftBotResult.status !== 403 ||
    JSON.stringify(leftBotResult.body) !== JSON.stringify({
        ok: false,
        error_code: 403,
        description: 'Forbidden: bot is not a member of the supergroup chat',
      })
  ) {
    throw new Error(
      `Expected a bot that left to be turned away, received ${JSON.stringify(leftBotResult)}`,
    );
  }

  const stranger = await createAccount(api, sessionPath, 'Linus');
  if ((await menuOf(stranger.id)).status !== 403) {
    throw new Error('Expected a non-member to be forbidden from the supergroup menu');
  }
});

Deno.test('bots reply to messages of their other chats with an external reply', async () => {
  const { api, sessionPath, member, bot, supergroup } = await createSupergroupFixture();
  const sendMessage = async (parameters: Record<string, unknown>) => {
    const { status, body } = await callBotApi(api, `${bot.botApiPath}/sendMessage`, parameters);
    return { status, body, message: botApiResult(body) };
  };
  const accountResponse = await api.request(
    `${sessionPath}/accounts/${member.id}/messages`,
    jsonRequest('POST', { to: { type: 'private', botId: bot.bot.id }, text: 'Hello' }),
  );
  const accountBody: unknown = await accountResponse.json();
  if (accountResponse.status !== 201 || !isSentMessageResponse(accountBody)) {
    throw new Error(`Expected the account to write to the bot, received ${accountResponse.status}`);
  }
  const accountMessage = accountBody.message;
  const announcement = await sendMessage({
    chat_id: supergroup.id,
    text: '<b>Ship</b> it <code>now</code>',
    parse_mode: 'HTML',
  });
  const botUser = announcement.message?.from;
  const announcementId = announcement.message?.message_id;

  const privateReply = await sendMessage({
    chat_id: member.id,
    text: 'Noted',
    reply_parameters: { chat_id: supergroup.id, message_id: announcementId },
  });
  const expectedPrivateReply = {
    origin: { type: 'user', sender_user: botUser, date: announcement.message?.date },
    chat: { id: supergroup.id, title: 'Team', type: 'supergroup' },
    message_id: announcementId,
  };
  if (
    privateReply.status !== 200 || privateReply.message?.reply_to_message !== undefined ||
    JSON.stringify(privateReply.message?.external_reply) !== JSON.stringify(expectedPrivateReply) ||
    JSON.stringify(privateReply.message?.quote) !== JSON.stringify({
        text: 'Ship it now',
        entities: [{ type: 'bold', offset: 0, length: 4 }],
        position: 0,
      })
  ) {
    throw new Error(
      `Expected an external reply to the supergroup message, received ${
        JSON.stringify(privateReply.body)
      }`,
    );
  }

  // A chosen quote replaces the automatic one.
  const quotedPrivateReply = await sendMessage({
    chat_id: member.id,
    text: 'Now?',
    reply_parameters: { chat_id: supergroup.id, message_id: announcementId, quote: 'now' },
  });
  if (
    JSON.stringify(quotedPrivateReply.message?.quote) !==
      JSON.stringify({ text: 'now', position: 8, is_manual: true })
  ) {
    throw new Error(
      `Expected the chosen quote of the supergroup message, received ${
        JSON.stringify(quotedPrivateReply.body)
      }`,
    );
  }

  const supergroupReply = await sendMessage({
    chat_id: supergroup.id,
    text: 'A customer says hello',
    reply_parameters: { chat_id: member.id, message_id: accountMessage.message_id },
  });
  const supergroupHistory = await (await api.request(
    `${sessionPath}/accounts/${member.id}/conversations/supergroup/${supergroup.id}/messages`,
  )).json() as { messages: Array<Record<string, unknown>> };
  const expectedSupergroupReply = {
    external_reply: {
      origin: { type: 'user', sender_user: accountMessage.from, date: accountMessage.date },
    },
    quote: { text: 'Hello', position: 0 },
  };
  const shownReply = supergroupHistory.messages.at(-1);
  if (
    supergroupReply.status !== 200 ||
    JSON.stringify({
        external_reply: supergroupReply.message?.external_reply,
        quote: supergroupReply.message?.quote,
      }) !== JSON.stringify(expectedSupergroupReply) ||
    JSON.stringify({ external_reply: shownReply?.external_reply, quote: shownReply?.quote }) !==
      JSON.stringify(expectedSupergroupReply)
  ) {
    throw new Error(
      `Expected an external reply to the private message without its chat, received ${
        JSON.stringify(supergroupReply.body)
      }`,
    );
  }

  // As TDLib does, a message that cannot be forwarded is silently not replied to.
  const protectedMessage = await sendMessage({
    chat_id: supergroup.id,
    text: 'Secret',
    protect_content: true,
  });
  const replyToProtected = await sendMessage({
    chat_id: member.id,
    text: 'Keep it secret',
    reply_parameters: { chat_id: supergroup.id, message_id: protectedMessage.message?.message_id },
  });
  const replyToMissingAllowed = await sendMessage({
    chat_id: member.id,
    text: 'Anyway',
    reply_parameters: {
      chat_id: supergroup.id,
      message_id: 999,
      allow_sending_without_reply: true,
    },
  });
  for (const reply of [replyToProtected, replyToMissingAllowed]) {
    if (
      reply.status !== 200 || reply.message?.external_reply !== undefined ||
      reply.message?.quote !== undefined
    ) {
      throw new Error(`Expected a message without a reply, received ${JSON.stringify(reply.body)}`);
    }
  }

  const rejections: [Record<string, unknown>, string][] = [
    [{ chat_id: supergroup.id, message_id: 999 }, 'Bad Request: message to be replied not found'],
    [{ chat_id: -1_000_000_000_999, message_id: 1 }, 'Bad Request: chat not found'],
  ];
  for (const [replyParameters, expectedDescription] of rejections) {
    const { status, body } = await sendMessage({
      chat_id: member.id,
      text: 'Reply',
      reply_parameters: replyParameters,
    });
    if (status !== 400 || !isBadRequestResponse(body) || body.description !== expectedDescription) {
      throw new Error(`Expected "${expectedDescription}", received ${JSON.stringify(body)}`);
    }
  }
});

Deno.test('bots show reply keyboards and forced replies to all or chosen supergroup members', async () => {
  const { api, sessionPath, owner, member, bot, readerBot, supergroup, supergroupPath } =
    await createSupergroupFixture();
  const readUpdates = createUpdateReader(api);
  const send = async (botApiPath: string, parameters: Record<string, unknown>) =>
    botApiResult(
      (await callBotApi(api, `${botApiPath}/sendMessage`, {
        chat_id: supergroup.id,
        ...parameters,
      })).body,
    );
  const shownInterface = async (accountId: number) =>
    (await (await api.request(`${supergroupPath(accountId)}/reply-interface`)).json() as {
      reply_interface: { type: string; message_id: number } | null;
    }).reply_interface;
  const press = (accountId: number, text: string) =>
    api.request(
      `${sessionPath}/accounts/${accountId}/reply-keyboard-presses`,
      jsonRequest('POST', { chat: { type: 'supergroup', chatId: supergroup.id }, text }),
    );

  // A keyboard for every member; a press replies to it, so the bot receives it in privacy mode.
  const keyboard = await send(bot.botApiPath, {
    text: 'Pick a color',
    reply_markup: { keyboard: [['Red', 'Green']], one_time_keyboard: true },
  });
  await readUpdates(bot.botApiPath);
  const pressResponse = await press(member.id, 'Red');
  const { message: pressed } = await pressResponse.json() as {
    message: { message_id: number; text: string; reply_to_message?: { message_id: number } };
  };
  const [pressUpdate] = await readUpdates(bot.botApiPath);
  const keyboardEdit = await callBotApi(api, `${bot.botApiPath}/editMessageText`, {
    chat_id: supergroup.id,
    message_id: keyboard?.message_id,
    text: 'Pick another color',
  });
  if (
    (await shownInterface(owner.id))?.message_id !== keyboard?.message_id ||
    pressResponse.status !== 201 || pressed.reply_to_message?.message_id !== keyboard?.message_id ||
    (pressUpdate?.message as { text?: string } | undefined)?.text !== 'Red' ||
    (keyboardEdit.body as { description?: string }).description !==
      "Bad Request: message can't be edited" ||
    (await press(member.id, 'Blue')).status !== 400
  ) {
    throw new Error(
      `Expected every member to see and press the keyboard, received ${
        JSON.stringify({ keyboard, pressed, pressUpdate, keyboardEdit: keyboardEdit.body })
      }`,
    );
  }

  // A selective forced reply reaches only the sender of the replied message, and a selective
  // removal only the mentioned member; another bot's removal leaves this bot's interface.
  const forcedReply = await send(bot.botApiPath, {
    text: 'Why red?',
    reply_parameters: { message_id: pressed.message_id },
    reply_markup: { force_reply: true, selective: true },
  });
  await send(bot.botApiPath, {
    text: 'Ada, done',
    entities: [{ type: 'text_mention', offset: 0, length: 3, user: { id: owner.id } }],
    reply_markup: { remove_keyboard: true, selective: true },
  });
  await send(readerBot.botApiPath, { text: 'Reset', reply_markup: { remove_keyboard: true } });
  const shownAfterSelectiveMarkup = [
    await shownInterface(owner.id),
    await shownInterface(member.id),
  ];
  if (
    JSON.stringify(shownAfterSelectiveMarkup) !== JSON.stringify([
      null,
      { type: 'force_reply', message_id: forcedReply?.message_id },
    ])
  ) {
    throw new Error(
      `Expected selective markup to reach only its targets, received ${
        JSON.stringify(shownAfterSelectiveMarkup)
      }`,
    );
  }

  // Removing the bot removes the interfaces it set.
  await api.request(`${supergroupPath(owner.id)}/members/${bot.bot.id}`, { method: 'DELETE' });
  const outsider = await createAccount(api, sessionPath, 'Linus');
  const outsiderStatus = (await api.request(`${supergroupPath(outsider.id)}/reply-interface`))
    .status;
  if ((await shownInterface(member.id)) !== null || outsiderStatus !== 403) {
    throw new Error(
      `Expected the removed bot's forced reply to disappear, received ${outsiderStatus}`,
    );
  }
});

Deno.test('bots in privacy mode receive only supergroup messages addressed to them', async () => {
  const { api, owner, member, bot, readerBot, supergroup, sendSupergroupText } =
    await createSupergroupFixture();
  const { body: joinBody } = await callBotApi(api, `${bot.botApiPath}/getUpdates`, {});
  const joinUpdates = (joinBody as { result: Array<{ update_id: number }> }).result;
  const { body: readerJoinBody } = await callBotApi(api, `${readerBot.botApiPath}/getUpdates`, {});
  const readerJoinUpdates = (readerJoinBody as { result: Array<{ update_id: number }> }).result;

  const texts = [
    [owner.id, 'Hello team'],
    [member.id, '/start'],
    [member.id, '/help@other_bot'],
    [member.id, '/help@Test_Bot now'],
    [member.id, 'Ask @test_bot about it'],
    [member.id, 'Mail me at me@test_bot.example'],
    [member.id, 'Run /start later'],
  ] as const;
  for (const [accountId, text] of texts) {
    await sendSupergroupText(accountId, text);
  }
  const botQuestion = await callBotApi(api, `${bot.botApiPath}/sendMessage`, {
    chat_id: supergroup.id,
    text: 'Anyone?',
  });
  const botQuestionId = botApiResult(botQuestion.body)?.message_id as number;
  await sendSupergroupText(member.id, 'Me!', botQuestionId);
  await sendSupergroupText(owner.id, 'Replying to Ada', 1);

  const receivedTexts = async (botApiPath: string, afterUpdateId: number) => {
    const { body } = await callBotApi(api, `${botApiPath}/getUpdates`, {
      offset: afterUpdateId + 1,
    });
    return (body as { result: Array<{ message?: { text: string } }> }).result.map((update) =>
      update.message?.text
    );
  };
  const privacyModeTexts = await receivedTexts(
    bot.botApiPath,
    joinUpdates.at(-1)?.update_id as number,
  );
  const readerTexts = await receivedTexts(
    readerBot.botApiPath,
    readerJoinUpdates.at(-1)?.update_id as number,
  );
  const expectedPrivacyModeTexts = [
    '/start',
    '/help@Test_Bot now',
    'Ask @test_bot about it',
    'Me!',
  ];
  if (JSON.stringify(privacyModeTexts) !== JSON.stringify(expectedPrivacyModeTexts)) {
    throw new Error(
      `Expected only addressed messages, received ${JSON.stringify(privacyModeTexts)}`,
    );
  }
  const expectedReaderTexts = [...texts.map(([, text]) => text), 'Me!', 'Replying to Ada'];
  if (JSON.stringify(readerTexts) !== JSON.stringify(expectedReaderTexts)) {
    throw new Error(
      `Expected every account message and no bot message, received ${JSON.stringify(readerTexts)}`,
    );
  }
});

Deno.test('supergroup members see the same message IDs and replies', async () => {
  const { api, sessionPath, owner, member, bot, supergroup, supergroupPath, sendSupergroupText } =
    await createSupergroupFixture();
  const question = await sendSupergroupText(owner.id, '/poll');
  const answer = await callBotApi(api, `${bot.botApiPath}/sendMessage`, {
    chat_id: supergroup.id,
    text: 'Which day?',
    reply_parameters: { message_id: question.message_id },
  });
  const answerMessage = botApiResult(answer.body);
  const reply = await sendSupergroupText(member.id, 'Friday', answerMessage?.message_id as number);

  const expectedChat = { id: supergroup.id, title: 'Team', type: 'supergroup' };
  // The service messages of the fixture's three additions are messages 1 to 3.
  if (
    question.message_id !== 4 || answerMessage?.message_id !== 5 || reply.message_id !== 6 ||
    JSON.stringify(answerMessage.chat) !== JSON.stringify(expectedChat) ||
    JSON.stringify((answerMessage.reply_to_message as Record<string, unknown>)?.text) !==
      JSON.stringify('/poll') ||
    JSON.stringify(
        (reply as unknown as Record<string, Record<string, unknown>>)
          .reply_to_message?.from,
      ) !==
      JSON.stringify({
        id: bot.bot.id,
        is_bot: true,
        first_name: bot.bot.first_name,
        username: bot.bot.username,
      })
  ) {
    throw new Error(`Expected one numbering and replies, received ${JSON.stringify(reply)}`);
  }

  const histories = await Promise.all([owner.id, member.id].map(async (accountId) => {
    const response = await api.request(`${supergroupPath(accountId)}/messages`);
    return await response.json() as { messages: Array<{ message_id: number; text?: string }> };
  }));
  if (
    JSON.stringify(histories[0]) !== JSON.stringify(histories[1]) ||
    JSON.stringify(histories[0].messages.map(({ message_id, text }) => [message_id, text])) !==
      JSON.stringify([
        [1, undefined],
        [2, undefined],
        [3, undefined],
        [4, '/poll'],
        [5, 'Which day?'],
        [6, 'Friday'],
      ])
  ) {
    throw new Error(
      `Expected both members to see one history, received ${JSON.stringify(histories)}`,
    );
  }

  const stranger = await createAccount(api, sessionPath, 'Grace');
  const strangerStatuses = await Promise.all([
    api.request(`${supergroupPath(stranger.id)}/messages`),
    api.request(
      `${sessionPath}/accounts/${stranger.id}/messages`,
      jsonRequest('POST', { to: { type: 'supergroup', chatId: supergroup.id }, text: 'Hi' }),
    ),
    api.request(
      `${sessionPath}/accounts/${owner.id}/messages`,
      jsonRequest('POST', { to: { type: 'supergroup', chatId: -1_000_000_009_999 }, text: 'Hi' }),
    ),
    api.request(
      `${sessionPath}/accounts/${owner.id}/messages`,
      jsonRequest('POST', {
        to: { type: 'supergroup', chatId: supergroup.id },
        text: 'Hi',
        reply_to_message_id: 99,
      }),
    ),
  ]).then((responses) => responses.map((response) => response.status));
  if (JSON.stringify(strangerStatuses) !== JSON.stringify([403, 403, 404, 400])) {
    throw new Error(`Expected member checks, received ${strangerStatuses.join()}`);
  }
});

Deno.test('Bot API methods follow Telegram checks in supergroups', async () => {
  const { api, sessionPath, owner, bot, supergroup, supergroupPath, sendSupergroupText } =
    await createSupergroupFixture();
  const accountMessage = await sendSupergroupText(owner.id, 'Hello');
  const botMessage = botApiResult(
    (await callBotApi(api, `${bot.botApiPath}/sendMessage`, {
      chat_id: supergroup.id,
      text: 'Menu',
      reply_markup: { inline_keyboard: [[{ text: 'Go', callback_data: 'go' }]] },
    })).body,
  );
  const botMessageId = botMessage?.message_id as number;
  const outsider = await createBot(api, sessionPath, 'outsider_bot');

  const expectFailure = async (
    botApiPath: string,
    method: string,
    parameters: Record<string, unknown>,
    description: string,
  ) => {
    const { body } = await callBotApi(api, `${botApiPath}/${method}`, parameters);
    if (!isBadRequestResponse(body) || body.description !== description) {
      throw new Error(
        `Expected ${method} to fail with "${description}", received ${JSON.stringify(body)}`,
      );
    }
  };
  await expectFailure(outsider.botApiPath, 'sendMessage', {
    chat_id: supergroup.id,
    text: 'Hi',
  }, 'Bad Request: chat not found');
  await expectFailure(outsider.botApiPath, 'sendChatAction', {
    chat_id: supergroup.id,
    action: 'typing',
  }, 'Bad Request: chat not found');
  await expectFailure(bot.botApiPath, 'sendMessage', {
    chat_id: supergroup.id,
    text: 'Hi',
    reply_parameters: { message_id: 99 },
  }, 'Bad Request: message to be replied not found');
  await expectFailure(bot.botApiPath, 'editMessageText', {
    chat_id: supergroup.id,
    message_id: accountMessage.message_id,
    text: 'Changed',
  }, "Bad Request: message can't be edited");
  await expectFailure(
    bot.botApiPath,
    'editMessageReplyMarkup',
    {
      chat_id: supergroup.id,
      message_id: botMessageId,
      reply_markup: { inline_keyboard: [[{ text: 'Go', callback_data: 'go' }]] },
    },
    'Bad Request: message is not modified: specified new message content and reply markup are exactly the same as a current content and reply markup of the message',
  );
  await expectFailure(bot.botApiPath, 'deleteMessage', {
    chat_id: supergroup.id,
    message_id: accountMessage.message_id,
  }, "Bad Request: message can't be deleted");
  await expectFailure(bot.botApiPath, 'deleteMessages', {
    chat_id: supergroup.id,
    message_ids: [botMessageId, accountMessage.message_id],
  }, "Bad Request: message can't be deleted");

  const edited = await callBotApi(api, `${bot.botApiPath}/editMessageText`, {
    chat_id: supergroup.id,
    message_id: botMessageId,
    text: '<b>Menu</b>',
    parse_mode: 'HTML',
  });
  const editedMessage = botApiResult(edited.body);
  if (
    editedMessage?.message_id !== botMessageId || typeof editedMessage.edit_date !== 'number' ||
    editedMessage.reply_markup !== undefined ||
    JSON.stringify(editedMessage.entities) !==
      JSON.stringify([{ type: 'bold', offset: 0, length: 4 }])
  ) {
    throw new Error(
      `Expected the bot's own message to be edited, received ${JSON.stringify(edited)}`,
    );
  }
  const chatAction = await callBotApi(api, `${bot.botApiPath}/sendChatAction`, {
    chat_id: supergroup.id,
    action: 'typing',
  });
  const deletion = await callBotApi(api, `${bot.botApiPath}/deleteMessages`, {
    chat_id: supergroup.id,
    message_ids: [botMessageId, 99],
  });
  const successBody = JSON.stringify({ ok: true, result: true });
  if (
    JSON.stringify(chatAction.body) !== successBody || JSON.stringify(deletion.body) !== successBody
  ) {
    throw new Error('Expected a chat action and the deletion of its own message to succeed');
  }
  const history = await (await api.request(`${supergroupPath(owner.id)}/messages`)).json() as {
    messages: Array<{ text?: string }>;
  };
  const texts = history.messages.flatMap(({ text }) => text === undefined ? [] : [text]);
  if (JSON.stringify(texts) !== JSON.stringify(['Hello'])) {
    throw new Error(
      `Expected only the account message to remain, received ${JSON.stringify(history)}`,
    );
  }
});

Deno.test('a grammY bot runs a vote with an inline keyboard in a supergroup', async () => {
  const { api, sessionPath, owner, member, bot, supergroup, supergroupPath, sendSupergroupText } =
    await createSupergroupFixture();
  const grammyBot = new Bot(bot.token, {
    client: {
      apiRoot: `http://emulator.example:9000${sessionPath}/bot-api`,
      fetch: createInProcessFetch(api.fetch),
    },
  });
  const votes = new Map<number, string>();
  const handled = {
    joined: Promise.withResolvers<void>(),
    vote: Promise.withResolvers<void>(),
    press: Promise.withResolvers<void>(),
    edit: Promise.withResolvers<void>(),
  };
  const chatTypes: string[] = [];
  grammyBot.on('my_chat_member', (context) => {
    chatTypes.push(context.chat.type);
    handled.joined.resolve();
  });
  grammyBot.command('vote', async (context) => {
    chatTypes.push(context.chat.type);
    await context.reply(`Vote on: ${context.match}`, {
      reply_markup: new InlineKeyboard().text('Yes', 'yes').text('No', 'no'),
    });
    handled.vote.resolve();
  });
  grammyBot.callbackQuery(['yes', 'no'], async (context) => {
    votes.set(context.from.id, context.callbackQuery.data);
    await context.answerCallbackQuery({ text: `Voted ${context.callbackQuery.data}` });
    await context.editMessageText(`Votes: ${votes.size}`);
    handled.press.resolve();
  });
  grammyBot.on('edited_message:text', (context) => {
    chatTypes.push(`edited ${context.editedMessage.text}`);
    handled.edit.resolve();
  });
  const polling = grammyBot.start();

  let pressedQuery: Record<string, unknown> | undefined;
  try {
    await Promise.race([handled.joined.promise, polling]);
    const command = await sendSupergroupText(member.id, '/vote@test_bot Pizza');
    await Promise.race([handled.vote.promise, polling]);
    const history = await (await api.request(`${supergroupPath(owner.id)}/messages`)).json() as {
      messages: Array<{ message_id: number; text: string }>;
    };
    const voteMessage = history.messages.at(-1);
    const pressResponse = await api.request(
      `${sessionPath}/accounts/${owner.id}/callback-queries`,
      jsonRequest('POST', {
        chat: { type: 'supergroup', chatId: supergroup.id },
        message_id: voteMessage?.message_id,
        callback_data: 'yes',
      }),
    );
    pressedQuery = (await pressResponse.json() as { callback_query: Record<string, unknown> })
      .callback_query;
    await Promise.race([handled.press.promise, polling]);
    await api.request(
      `${supergroupPath(member.id)}/messages/${command.message_id}`,
      jsonRequest('PATCH', { text: '/vote@test_bot Pasta' }),
    );
    await Promise.race([handled.edit.promise, polling]);
  } finally {
    await grammyBot.stop();
    await polling;
  }

  const answered = await (await api.request(
    `${sessionPath}/accounts/${owner.id}/callback-queries/${pressedQuery?.id}`,
  )).json() as { callback_query: { answer: unknown } };
  if (
    JSON.stringify(answered.callback_query.answer) !==
      JSON.stringify({ text: 'Voted yes', show_alert: false, cache_time: 0 })
  ) {
    throw new Error(`Expected the voter to see the answer, received ${JSON.stringify(answered)}`);
  }
  const history = await (await api.request(`${supergroupPath(member.id)}/messages`)).json() as {
    messages: Array<{ text?: string; reply_markup?: unknown }>;
  };
  const textMessages = history.messages.filter(({ text }) => text !== undefined);
  if (
    JSON.stringify(textMessages.map(({ text }) => text)) !==
      JSON.stringify(['/vote@test_bot Pasta', 'Votes: 1']) ||
    textMessages[1].reply_markup !== undefined ||
    JSON.stringify(chatTypes) !==
      JSON.stringify(['supergroup', 'supergroup', 'edited /vote@test_bot Pasta'])
  ) {
    throw new Error(`Expected the vote to run in the group, received ${JSON.stringify(history)}`);
  }
});

Deno.test('members leave or are removed from supergroups, which bots see as service messages', async () => {
  const { api, sessionPath, owner, member, bot, readerBot, supergroup, supergroupPath } =
    await createSupergroupFixture();
  const readNewUpdates = createUpdateReader(api);
  await readNewUpdates(bot.botApiPath);
  await readNewUpdates(readerBot.botApiPath);
  const membersPath = `${supergroupPath(owner.id)}/members`;
  const botUser = (created: typeof bot) => ({
    id: created.bot.id,
    is_bot: true,
    first_name: created.bot.first_name,
    username: created.bot.username,
  });
  const chat = { id: supergroup.id, title: 'Team', type: 'supergroup' };
  // Update IDs and dates vary between runs.
  const withoutDates = (updates: Array<Record<string, unknown>>) =>
    updates.map(({ update_id: _updateId, ...update }) =>
      Object.fromEntries(
        Object.entries(update).map(([type, payload]) => {
          const { date: _date, ...payloadWithoutDate } = payload as Record<string, unknown>;
          return [type, payloadWithoutDate];
        }),
      )
    );

  // An account that leaves is announced to every bot, privacy mode notwithstanding.
  const leaving = await api.request(`${supergroupPath(member.id)}/members/${member.id}`, {
    method: 'DELETE',
  });
  const memberLeftMessage = {
    message_id: 4,
    from: member,
    chat,
    left_chat_participant: member,
    left_chat_member: member,
  };
  const botUpdatesAfterLeaving = withoutDates(await readNewUpdates(bot.botApiPath));
  const readerUpdatesAfterLeaving = withoutDates(await readNewUpdates(readerBot.botApiPath));
  const formerMemberStatuses = await Promise.all([
    api.request(`${supergroupPath(member.id)}/messages`),
    api.request(`${supergroupPath(member.id)}/members/${member.id}`, { method: 'DELETE' }),
  ]).then((responses) => responses.map((response) => response.status));
  if (
    leaving.status !== 204 ||
    JSON.stringify(botUpdatesAfterLeaving) !== JSON.stringify([{ message: memberLeftMessage }]) ||
    JSON.stringify(readerUpdatesAfterLeaving) !== JSON.stringify(botUpdatesAfterLeaving) ||
    JSON.stringify(formerMemberStatuses) !== JSON.stringify([403, 204])
  ) {
    throw new Error(
      `Expected the member to leave, received ${JSON.stringify(botUpdatesAfterLeaving)}`,
    );
  }

  // A bot the owner removes is banned: it learns so, and Telegram turns it away from then on.
  const removal = await api.request(`${membersPath}/${bot.bot.id}`, { method: 'DELETE' });
  const botLeftMessage = {
    message_id: 5,
    from: owner,
    chat,
    left_chat_participant: botUser(bot),
    left_chat_member: botUser(bot),
  };
  const expectedRemovalUpdates = [
    {
      my_chat_member: {
        chat,
        from: owner,
        old_chat_member: { user: botUser(bot), status: 'member' },
        new_chat_member: { user: botUser(bot), status: 'kicked', until_date: 0 },
      },
    },
    { message: botLeftMessage },
  ];
  const removedBotUpdates = withoutDates(await readNewUpdates(bot.botApiPath));
  const readerUpdatesAfterRemoval = withoutDates(await readNewUpdates(readerBot.botApiPath));
  if (
    removal.status !== 204 ||
    JSON.stringify(removedBotUpdates) !== JSON.stringify(expectedRemovalUpdates) ||
    JSON.stringify(readerUpdatesAfterRemoval) !== JSON.stringify([{ message: botLeftMessage }])
  ) {
    throw new Error(
      `Expected the bot to learn it was removed, received ${
        JSON.stringify([removedBotUpdates, readerUpdatesAfterRemoval])
      }`,
    );
  }
  const kickedDescription = 'Forbidden: bot was kicked from the supergroup chat';
  const removedBotResponses = await Promise.all([
    callBotApi(api, `${bot.botApiPath}/sendMessage`, { chat_id: supergroup.id, text: 'Hi' }),
    callBotApi(api, `${bot.botApiPath}/sendChatAction`, {
      chat_id: supergroup.id,
      action: 'typing',
    }),
    callBotApi(api, `${bot.botApiPath}/leaveChat`, { chat_id: supergroup.id }),
  ]);
  if (
    !removedBotResponses.every(({ status, body }) =>
      status === 403 &&
      JSON.stringify(body) ===
        JSON.stringify({ ok: false, error_code: 403, description: kickedDescription })
    )
  ) {
    throw new Error(
      `Expected a removed bot to be turned away, received ${JSON.stringify(removedBotResponses)}`,
    );
  }

  // Adding the bot again lifts its ban.
  await api.request(`${membersPath}/${bot.bot.id}`, { method: 'PUT' });
  const readditionUpdates = withoutDates(await readNewUpdates(bot.botApiPath));
  const readdedChatMember = readditionUpdates[0]?.my_chat_member as Record<string, unknown>;
  if (
    JSON.stringify(readdedChatMember?.old_chat_member) !==
      JSON.stringify({ user: botUser(bot), status: 'kicked', until_date: 0 }) ||
    readditionUpdates.length !== 2
  ) {
    throw new Error(`Expected the bot to rejoin, received ${JSON.stringify(readditionUpdates)}`);
  }
  await readNewUpdates(readerBot.botApiPath);

  // A bot that leaves learns of its own departure. As a service message, it reaches other bots too.
  const readerLeaving = await callBotApi(api, `${readerBot.botApiPath}/leaveChat`, {
    chat_id: supergroup.id,
  });
  const readerLeftMessage = {
    message_id: 7,
    from: botUser(readerBot),
    chat,
    left_chat_participant: botUser(readerBot),
    left_chat_member: botUser(readerBot),
  };
  const expectedLeavingUpdates = [
    {
      my_chat_member: {
        chat,
        from: botUser(readerBot),
        old_chat_member: { user: botUser(readerBot), status: 'member' },
        new_chat_member: { user: botUser(readerBot), status: 'left' },
      },
    },
    { message: readerLeftMessage },
  ];
  const readerLeavingUpdates = withoutDates(await readNewUpdates(readerBot.botApiPath));
  const botUpdatesAfterReaderLeft = withoutDates(await readNewUpdates(bot.botApiPath));
  if (
    JSON.stringify(readerLeaving.body) !== JSON.stringify({ ok: true, result: true }) ||
    JSON.stringify(readerLeavingUpdates) !== JSON.stringify(expectedLeavingUpdates) ||
    JSON.stringify(botUpdatesAfterReaderLeft) !== JSON.stringify([{ message: readerLeftMessage }])
  ) {
    throw new Error(
      `Expected the reader bot to leave, received ${
        JSON.stringify([readerLeaving, readerLeavingUpdates, botUpdatesAfterReaderLeft])
      }`,
    );
  }
  const notMemberDescription = 'Forbidden: bot is not a member of the supergroup chat';
  const leftBotResponses = await Promise.all([
    callBotApi(api, `${readerBot.botApiPath}/sendMessage`, {
      chat_id: supergroup.id,
      text: 'Hi',
    }),
    callBotApi(api, `${readerBot.botApiPath}/leaveChat`, { chat_id: supergroup.id }),
  ]);
  if (
    !leftBotResponses.every(({ status, body }) =>
      status === 403 && (body as { description?: string }).description === notMemberDescription
    )
  ) {
    throw new Error(
      `Expected a bot that left to be turned away, received ${JSON.stringify(leftBotResponses)}`,
    );
  }

  const history = await (await api.request(`${supergroupPath(owner.id)}/messages`)).json() as {
    messages: Array<Record<string, unknown>>;
  };
  const leftMemberIds = history.messages.flatMap((message) =>
    'left_chat_member' in message ? [(message.left_chat_member as { id: number }).id] : []
  );
  if (
    JSON.stringify(leftMemberIds) !==
      JSON.stringify([member.id, bot.bot.id, readerBot.bot.id])
  ) {
    throw new Error(`Expected the departures in the history, received ${JSON.stringify(history)}`);
  }

  const outsider = await createAccount(api, sessionPath, 'Linus');
  const memberRouteStatuses = await Promise.all([
    api.request(`${membersPath}/${owner.id}`, { method: 'DELETE' }),
    api.request(`${supergroupPath(outsider.id)}/members/${bot.bot.id}`, { method: 'DELETE' }),
    api.request(`${membersPath}/${outsider.id}`, { method: 'DELETE' }),
    api.request(`${membersPath}/999`, { method: 'DELETE' }),
    api.request(
      `${sessionPath}/accounts/${owner.id}/conversations/supergroup/-1000000009999/members/${bot.bot.id}`,
      { method: 'DELETE' },
    ),
    api.request(`${sessionPath}/accounts/${owner.id}/conversations/supergroup/-5/members/1`, {
      method: 'DELETE',
    }),
  ]).then((responses) => responses.map((response) => response.status));
  if (JSON.stringify(memberRouteStatuses) !== JSON.stringify([409, 403, 204, 404, 404, 400])) {
    throw new Error(`Expected membership checks, received ${memberRouteStatuses.join()}`);
  }
});

Deno.test('leaveChat follows Telegram checks outside supergroups', async () => {
  const { api, sessionPath, botApiPath, createdAccount, sendText } =
    await createPrivateConversationFixture();
  const stranger = await createAccount(api, sessionPath, 'Grace');
  await sendText('/start');

  const responses = await Promise.all([
    callBotApi(api, `${botApiPath}/leaveChat`, { chat_id: createdAccount.account.id }),
    callBotApi(api, `${botApiPath}/leaveChat`, { chat_id: stranger.id }),
    callBotApi(api, `${botApiPath}/leaveChat`, { chat_id: -1_000_000_009_999 }),
    callBotApi(api, `${botApiPath}/leaveChat`, {}),
  ]);
  const descriptions = responses.map(({ body }) => (body as { description?: string }).description);
  const expectedDescriptions = [
    "Bad Request: can't leave private chats",
    'Bad Request: chat not found',
    'Bad Request: chat not found',
    'Bad Request: chat_id is empty',
  ];
  if (
    JSON.stringify(descriptions) !== JSON.stringify(expectedDescriptions) ||
    !responses.every(({ status }) => status === 400)
  ) {
    throw new Error(`Expected leaveChat checks, received ${JSON.stringify(responses)}`);
  }
});

Deno.test('a grammY bot welcomes new members and learns it was removed', async () => {
  const { api, sessionPath, owner, bot, supergroupPath } = await createSupergroupFixture();
  const newcomer = await createAccount(api, sessionPath, 'Linus');
  const grammyBot = new Bot(bot.token, {
    client: {
      apiRoot: `http://emulator.example:9000${sessionPath}/bot-api`,
      fetch: createInProcessFetch(api.fetch),
    },
  });
  const handled = {
    welcome: Promise.withResolvers<void>(),
    farewell: Promise.withResolvers<void>(),
    removal: Promise.withResolvers<void>(),
  };
  let removalError: unknown;
  grammyBot.on('message:new_chat_members', async (context) => {
    const names = context.message.new_chat_members.map(({ first_name }) => first_name);
    if (names.includes('Linus')) {
      await context.reply(`Welcome, ${names.join(', ')}!`, {
        reply_parameters: { message_id: context.message.message_id },
      });
      handled.welcome.resolve();
    }
  });
  grammyBot.on('message:left_chat_member', async (context) => {
    if (context.message.left_chat_member.id === newcomer.id) {
      await context.reply(`Goodbye, ${context.message.left_chat_member.first_name}.`);
      handled.farewell.resolve();
    }
  });
  grammyBot.on('my_chat_member', async (context) => {
    if (context.myChatMember.new_chat_member.status === 'kicked') {
      removalError = await context.reply('Why?').catch((error: unknown) => error);
      handled.removal.resolve();
    }
  });
  const polling = grammyBot.start();

  try {
    await api.request(`${supergroupPath(owner.id)}/members/${newcomer.id}`, { method: 'PUT' });
    await Promise.race([handled.welcome.promise, polling]);
    await api.request(`${supergroupPath(newcomer.id)}/members/${newcomer.id}`, {
      method: 'DELETE',
    });
    await Promise.race([handled.farewell.promise, polling]);
    await api.request(`${supergroupPath(owner.id)}/members/${bot.bot.id}`, { method: 'DELETE' });
    await Promise.race([handled.removal.promise, polling]);
  } finally {
    await grammyBot.stop();
    await polling;
  }

  const history = await (await api.request(`${supergroupPath(owner.id)}/messages`)).json() as {
    messages: Array<
      { message_id: number; text?: string; reply_to_message?: { message_id: number } }
    >;
  };
  const replies = history.messages.flatMap(({ text, reply_to_message }) =>
    text === undefined ? [] : [[text, reply_to_message?.message_id]]
  );
  if (
    JSON.stringify(replies) !==
      JSON.stringify([['Welcome, Linus!', 4], ['Goodbye, Linus.', undefined]])
  ) {
    throw new Error(`Expected a welcome and a farewell, received ${JSON.stringify(history)}`);
  }
  if (
    !(removalError instanceof GrammyError) || removalError.error_code !== 403 ||
    removalError.description !== 'Forbidden: bot was kicked from the supergroup chat'
  ) {
    throw new Error(`Expected the removed bot to be turned away, received ${removalError}`);
  }
});

Deno.test('the owner promotes administrators, whom bots find with getChatMember and getChatAdministrators', async () => {
  const { api, sessionPath, owner, member, bot, readerBot, supergroup, supergroupPath } =
    await createSupergroupFixture();
  const outsider = await createAccount(api, sessionPath, 'Linus');
  const readNewUpdates = createUpdateReader(api);
  await readNewUpdates(bot.botApiPath);
  const administratorsPath = `${supergroupPath(owner.id)}/administrators`;
  const botUser = (created: typeof bot) => ({
    id: created.bot.id,
    is_bot: true,
    first_name: created.bot.first_name,
    username: created.bot.username,
  });
  const chat = { id: supergroup.id, title: 'Team', type: 'supergroup' };

  const promotionStatuses = await Promise.all([
    api.request(
      `${administratorsPath}/${bot.bot.id}`,
      jsonRequest('PUT', { can_delete_messages: true, can_restrict_members: true }),
    ),
    api.request(
      `${administratorsPath}/${readerBot.bot.id}`,
      jsonRequest('PUT', { can_pin_messages: true }),
    ),
  ]).then((responses) => responses.map((response) => response.status));
  const promotionUpdates = await readNewUpdates(bot.botApiPath);
  const promotedBot = administratorMember(botUser(bot), [
    'can_manage_chat',
    'can_delete_messages',
    'can_restrict_members',
  ]);
  const promotion = promotionUpdates[0]?.my_chat_member as Record<string, unknown> | undefined;
  if (
    JSON.stringify(promotionStatuses) !== JSON.stringify([204, 204]) ||
    promotionUpdates.length !== 1 ||
    JSON.stringify({ ...promotion, date: 0 }) !== JSON.stringify({
        chat,
        from: owner,
        date: 0,
        old_chat_member: { user: botUser(bot), status: 'member' },
        new_chat_member: promotedBot,
      })
  ) {
    throw new Error(
      `Expected the bot to learn of its promotion, received ${JSON.stringify(promotionUpdates)}`,
    );
  }

  const getChatMember = (userId: number) =>
    callBotApi(api, `${bot.botApiPath}/getChatMember`, { chat_id: supergroup.id, user_id: userId })
      .then(({ body }) => (body as { result: unknown }).result);
  const members = await Promise.all(
    [owner.id, member.id, bot.bot.id, outsider.id].map(getChatMember),
  );
  const expectedMembers = [
    { user: owner, status: 'creator', is_anonymous: false },
    { user: member, status: 'member' },
    promotedBot,
    { user: outsider, status: 'left' },
  ];
  if (JSON.stringify(members) !== JSON.stringify(expectedMembers)) {
    throw new Error(`Expected each user's standing, received ${JSON.stringify(members)}`);
  }

  // As on Telegram, administrators that are other bots are listed only when requested.
  const [administrators, administratorsWithBots, memberCount] = await Promise.all([
    callBotApi(api, `${bot.botApiPath}/getChatAdministrators`, { chat_id: supergroup.id }),
    callBotApi(api, `${bot.botApiPath}/getChatAdministrators`, {
      chat_id: supergroup.id,
      return_bots: true,
    }),
    callBotApi(api, `${bot.botApiPath}/getChatMemberCount`, { chat_id: supergroup.id }),
  ]).then((responses) => responses.map(({ body }) => (body as { result: unknown }).result));
  const owningMember = expectedMembers[0];
  const promotedReader = administratorMember(botUser(readerBot), [
    'can_manage_chat',
    'can_pin_messages',
  ]);
  if (
    JSON.stringify(administrators) !== JSON.stringify([owningMember, promotedBot]) ||
    JSON.stringify(administratorsWithBots) !==
      JSON.stringify([owningMember, promotedBot, promotedReader]) ||
    memberCount !== 4
  ) {
    throw new Error(
      `Expected the administrators and member count, received ${
        JSON.stringify([administrators, administratorsWithBots, memberCount])
      }`,
    );
  }

  const failures = await Promise.all([
    callBotApi(api, `${bot.botApiPath}/getChatMember`, { chat_id: supergroup.id }),
    callBotApi(api, `${bot.botApiPath}/getChatMember`, { user_id: owner.id }),
    callBotApi(api, `${bot.botApiPath}/getChatMember`, { chat_id: supergroup.id, user_id: 999 }),
    callBotApi(api, `${bot.botApiPath}/getChatMember`, {
      chat_id: -1_000_000_009_999,
      user_id: owner.id,
    }),
    callBotApi(api, `${bot.botApiPath}/getChatAdministrators`, {}),
  ]);
  const failureDescriptions = failures.map(({ body }) =>
    (body as { description?: string }).description
  );
  if (
    JSON.stringify(failureDescriptions) !== JSON.stringify([
      'Bad Request: invalid user_id specified',
      'Bad Request: chat_id is empty',
      'Bad Request: member not found',
      'Bad Request: chat not found',
      'Bad Request: chat_id is empty',
    ])
  ) {
    throw new Error(`Expected Telegram's checks, received ${JSON.stringify(failures)}`);
  }

  // Only the owner changes roles, only of other members, and a promotion grants some right.
  const routeStatuses = await Promise.all([
    api.request(
      `${supergroupPath(member.id)}/administrators/${bot.bot.id}`,
      jsonRequest('PUT', { can_delete_messages: true }),
    ),
    api.request(
      `${administratorsPath}/${owner.id}`,
      jsonRequest('PUT', { can_delete_messages: true }),
    ),
    api.request(
      `${administratorsPath}/${outsider.id}`,
      jsonRequest('PUT', { can_delete_messages: true }),
    ),
    api.request(`${administratorsPath}/999`, jsonRequest('PUT', { can_delete_messages: true })),
    api.request(`${administratorsPath}/${member.id}`, jsonRequest('PUT', {})),
    api.request(
      `${administratorsPath}/${member.id}`,
      jsonRequest('PUT', { can_delete_messages: false }),
    ),
    api.request(`${administratorsPath}/${member.id}`, jsonRequest('PUT', { can_fly: true })),
  ]).then((responses) => responses.map((response) => response.status));
  if (JSON.stringify(routeStatuses) !== JSON.stringify([403, 409, 409, 404, 400, 400, 400])) {
    throw new Error(`Expected administrator route checks, received ${routeStatuses.join()}`);
  }

  const demotionStatuses = await Promise.all([
    api.request(`${administratorsPath}/${bot.bot.id}`, { method: 'DELETE' }),
    api.request(`${administratorsPath}/${bot.bot.id}`, { method: 'DELETE' }),
  ]).then((responses) => responses.map((response) => response.status));
  const demotionUpdates = await readNewUpdates(bot.botApiPath);
  const demotion = demotionUpdates[0]?.my_chat_member as Record<string, unknown> | undefined;
  if (
    JSON.stringify(demotionStatuses) !== JSON.stringify([204, 204]) ||
    demotionUpdates.length !== 1 ||
    JSON.stringify([demotion?.old_chat_member, demotion?.new_chat_member]) !==
      JSON.stringify([promotedBot, { user: botUser(bot), status: 'member' }])
  ) {
    throw new Error(
      `Expected the bot to be demoted once, received ${JSON.stringify(demotionUpdates)}`,
    );
  }
});

Deno.test('getChat shows private chats and supergroups as the official server does', async () => {
  const { api, sessionPath, owner, bot, readerBot, supergroup, supergroupPath } =
    await createSupergroupFixture();
  const getChat = async (chatId: number | string, botApiPath = bot.botApiPath) => {
    const { status, body } = await callBotApi(api, `${botApiPath}/getChat`, { chat_id: chatId });
    return { status, body: body as { result?: unknown; description?: string } };
  };
  const createdAccountResponse = await api.request(
    `${sessionPath}/accounts`,
    jsonRequest('POST', {
      first_name: 'Linus',
      last_name: 'Torvalds',
      username: 'linus',
      has_private_forwards: true,
    }),
  );
  const { account: linus } = await createdAccountResponse.json() as { account: { id: number } };
  for (const accountId of [owner.id, linus.id]) {
    await api.request(
      `${sessionPath}/accounts/${accountId}/messages`,
      jsonRequest('POST', { to: { type: 'private', botId: bot.bot.id }, text: '/start' }),
    );
  }
  const publicResponse = await api.request(
    `${sessionPath}/accounts/${owner.id}/supergroups`,
    jsonRequest('POST', { title: 'Open', username: 'open_team', description: 'Everyone' }),
  );
  const { supergroup: publicSupergroup } = await publicResponse.json() as {
    supergroup: { id: number };
  };
  await api.request(`${supergroupPath(owner.id)}/content-protection`, { method: 'PUT' });

  // Accent colors default to TDLib's AccentColorId of the user or channel, modulo 7.
  const allGiftTypes = (accepted: boolean) => ({
    unlimited_gifts: accepted,
    limited_gifts: accepted,
    unique_gifts: accepted,
    premium_subscription: accepted,
    gifts_from_channels: accepted,
  });
  const channelAccentColor = (chatId: number) => (-chatId - 1_000_000_000_000) % 7;
  const everyPermission = Object.fromEntries(
    [
      'can_send_messages',
      'can_send_media_messages',
      'can_send_audios',
      'can_send_documents',
      'can_send_photos',
      'can_send_videos',
      'can_send_video_notes',
      'can_send_voice_notes',
      'can_send_polls',
      'can_send_other_messages',
      'can_add_web_page_previews',
      'can_react_to_messages',
      'can_edit_tag',
      'can_change_info',
      'can_invite_users',
      'can_pin_messages',
      'can_manage_topics',
    ].map((permission) => [permission, true]),
  );
  const expectedChats = [
    {
      id: owner.id,
      first_name: 'Ada',
      type: 'private',
      can_send_gift: true,
      accepted_gift_types: allGiftTypes(true),
      max_reaction_count: 11,
      accent_color_id: owner.id % 7,
    },
    {
      id: linus.id,
      first_name: 'Linus',
      last_name: 'Torvalds',
      username: 'linus',
      type: 'private',
      can_send_gift: true,
      active_usernames: ['linus'],
      has_private_forwards: true,
      accepted_gift_types: allGiftTypes(true),
      max_reaction_count: 11,
      accent_color_id: linus.id % 7,
    },
    {
      id: supergroup.id,
      title: 'Team',
      type: 'supergroup',
      has_visible_history: true,
      permissions: everyPermission,
      join_to_send_messages: true,
      accepted_gift_types: allGiftTypes(false),
      max_reaction_count: 11,
      accent_color_id: channelAccentColor(supergroup.id),
      has_protected_content: true,
    },
    {
      id: publicSupergroup.id,
      title: 'Open',
      username: 'open_team',
      type: 'supergroup',
      active_usernames: ['open_team'],
      description: 'Everyone',
      has_visible_history: true,
      permissions: everyPermission,
      join_to_send_messages: true,
      accepted_gift_types: allGiftTypes(false),
      max_reaction_count: 11,
      accent_color_id: channelAccentColor(publicSupergroup.id),
    },
  ];
  // A public supergroup is readable by bots that are not members, also by its username.
  const chats = await Promise.all(
    [owner.id, linus.id, supergroup.id, '@OPEN_TEAM'].map(async (chatId) =>
      (await getChat(chatId)).body.result
    ),
  );
  if (JSON.stringify(chats) !== JSON.stringify(expectedChats)) {
    throw new Error(`Expected full chat information, received ${JSON.stringify(chats)}`);
  }

  // A bot that left a private supergroup is turned away, and a removed bot even from a public one.
  await callBotApi(api, `${readerBot.botApiPath}/leaveChat`, { chat_id: supergroup.id });
  await api.request(`${supergroupPath(owner.id)}/members/${bot.bot.id}`, { method: 'DELETE' });
  const publicMembersPath =
    `${sessionPath}/accounts/${owner.id}/conversations/supergroup/${publicSupergroup.id}/members`;
  await api.request(`${publicMembersPath}/${readerBot.bot.id}`, { method: 'PUT' });
  await api.request(`${publicMembersPath}/${readerBot.bot.id}`, { method: 'DELETE' });
  const failures = await Promise.all([
    getChat(supergroup.id, readerBot.botApiPath),
    getChat(supergroup.id),
    getChat(publicSupergroup.id, readerBot.botApiPath),
    getChat(-1_000_000_009_999),
    getChat(owner.id, readerBot.botApiPath),
    getChat(readerBot.bot.id),
    callBotApi(api, `${bot.botApiPath}/getChat`, {}).then(({ status, body }) => ({
      status,
      body: body as { description?: string },
    })),
  ]);
  const expectedFailures = [
    [403, 'Forbidden: bot is not a member of the supergroup chat'],
    [403, 'Forbidden: bot was kicked from the supergroup chat'],
    [403, 'Forbidden: bot was kicked from the supergroup chat'],
    [400, 'Bad Request: chat not found'],
    [400, 'Bad Request: chat not found'],
    [400, 'Bad Request: chat not found'],
    [400, 'Bad Request: chat_id is empty'],
  ];
  const receivedFailures = failures.map(({ status, body }) => [status, body.description]);
  if (JSON.stringify(receivedFailures) !== JSON.stringify(expectedFailures)) {
    throw new Error(`Expected Telegram's access checks, received ${JSON.stringify(failures)}`);
  }
});

Deno.test('the owner sets custom titles, which bots see but cannot change', async () => {
  const { api, sessionPath, owner, member, bot, readerBot, supergroup, supergroupPath } =
    await createSupergroupFixture();
  const readNewUpdates = createUpdateReader(api);
  const administratorsPath = `${supergroupPath(owner.id)}/administrators`;
  const setCustomTitle = async (userId: number, customTitle: unknown, actorId = owner.id) =>
    (await api.request(
      `${supergroupPath(actorId)}/administrators/${userId}/custom-title`,
      jsonRequest('PUT', { custom_title: customTitle }),
    )).status;
  const getChatMember = (userId: number) =>
    callBotApi(api, `${bot.botApiPath}/getChatMember`, { chat_id: supergroup.id, user_id: userId })
      .then(({ body }) => botApiResult(body));
  const botUser = {
    id: readerBot.bot.id,
    is_bot: true,
    first_name: readerBot.bot.first_name,
    username: readerBot.bot.username,
  };

  await api.request(
    `${administratorsPath}/${bot.bot.id}`,
    jsonRequest('PUT', { can_delete_messages: true }),
  );
  await api.request(
    `${administratorsPath}/${readerBot.bot.id}`,
    jsonRequest('PUT', { can_pin_messages: true }),
  );
  await readNewUpdates(readerBot.botApiPath);
  const titleStatuses = [
    await setCustomTitle(owner.id, 'Founder'),
    await setCustomTitle(readerBot.bot.id, 'Pin keeper'),
  ];
  const [titleUpdate] = await readNewUpdates(readerBot.botApiPath);
  const titledAdministrator = {
    ...administratorMember(botUser, ['can_manage_chat', 'can_pin_messages']),
    custom_title: 'Pin keeper',
  };
  const titleChange = titleUpdate?.my_chat_member as Record<string, unknown> | undefined;
  if (
    JSON.stringify(titleStatuses) !== JSON.stringify([204, 204]) ||
    JSON.stringify(await getChatMember(owner.id)) !== JSON.stringify({
        user: owner,
        status: 'creator',
        custom_title: 'Founder',
        is_anonymous: false,
      }) ||
    JSON.stringify(await getChatMember(readerBot.bot.id)) !== JSON.stringify(titledAdministrator) ||
    JSON.stringify(titleChange?.new_chat_member) !== JSON.stringify(titledAdministrator)
  ) {
    throw new Error(
      `Expected bots to see the custom titles, received ${JSON.stringify(titleUpdate)}`,
    );
  }

  // New rights keep the title, while demotion and an empty title drop it.
  await api.request(
    `${administratorsPath}/${readerBot.bot.id}`,
    jsonRequest('PUT', { can_pin_messages: true, can_invite_users: true }),
  );
  const repromoted = await getChatMember(readerBot.bot.id);
  await api.request(`${administratorsPath}/${readerBot.bot.id}`, { method: 'DELETE' });
  await api.request(
    `${administratorsPath}/${readerBot.bot.id}`,
    jsonRequest('PUT', { can_pin_messages: true }),
  );
  const untitledStatus = await setCustomTitle(owner.id, '');
  const administrators = await callBotApi(api, `${bot.botApiPath}/getChatAdministrators`, {
    chat_id: supergroup.id,
    return_bots: true,
  }).then(({ body }) => botApiResult(body) as unknown as Array<{ custom_title?: string }>);
  if (
    repromoted?.custom_title !== 'Pin keeper' || untitledStatus !== 204 ||
    administrators.some((administrator) => administrator.custom_title !== undefined)
  ) {
    throw new Error(
      `Expected new rights to keep a title and demotion to drop it, received ${
        JSON.stringify([repromoted, administrators])
      }`,
    );
  }

  const failedStatuses = [
    await setCustomTitle(readerBot.bot.id, 'x'.repeat(17)),
    await setCustomTitle(readerBot.bot.id, 'Pin keeper 📌'),
    await setCustomTitle(readerBot.bot.id, 16),
    await setCustomTitle(member.id, 'Guest'),
    await setCustomTitle(readerBot.bot.id, 'Mine', member.id),
  ];
  if (JSON.stringify(failedStatuses) !== JSON.stringify([400, 400, 400, 409, 403])) {
    throw new Error(`Expected invalid titles to be refused, received ${failedStatuses}`);
  }

  const setByBot = async (chatId: number, userId: number) => {
    const { body } = await callBotApi(
      api,
      `${bot.botApiPath}/setChatAdministratorCustomTitle`,
      { chat_id: chatId, user_id: userId, custom_title: 'Helper' },
    );
    return isBadRequestResponse(body) ? body.description : JSON.stringify(body);
  };
  await api.request(
    `${sessionPath}/accounts/${owner.id}/messages`,
    jsonRequest('POST', { to: { type: 'private', botId: bot.bot.id }, text: '/start' }),
  );
  const botFailures = [
    await setByBot(supergroup.id, owner.id),
    await setByBot(supergroup.id, member.id),
    await setByBot(supergroup.id, readerBot.bot.id),
    await setByBot(supergroup.id, bot.bot.id),
    await setByBot(owner.id, owner.id),
  ];
  const expectedFailures = [
    'Bad Request: only the owner can edit their custom title',
    'Bad Request: user is not an administrator',
    'Bad Request: not enough rights to change custom title of the user',
    'Bad Request: not enough rights to change custom title of the user',
    'Bad Request: method is available only in groups and supergroups',
  ];
  if (JSON.stringify(botFailures) !== JSON.stringify(expectedFailures)) {
    throw new Error(`Expected Telegram's custom title errors, received ${botFailures}`);
  }
});

Deno.test('bots with can_change_info change a supergroup title and description', async () => {
  const { api, owner, bot, readerBot, supergroup, supergroupPath } =
    await createSupergroupFixture();
  const readUpdates = createUpdateReader(api);
  const setTitle = (title: string) =>
    callBotApi(api, `${bot.botApiPath}/setChatTitle`, { chat_id: supergroup.id, title });
  const setDescription = (description: string) =>
    callBotApi(api, `${bot.botApiPath}/setChatDescription`, {
      chat_id: supergroup.id,
      description,
    });
  const describe = ({ body }: { body: unknown }) =>
    isBadRequestResponse(body) ? body.description : JSON.stringify(body);
  await readUpdates(bot.botApiPath);
  await readUpdates(readerBot.botApiPath);

  const refusedBeforePromotion = [await setTitle('Team'), await setDescription('About')];
  const promotion = await api.request(
    `${supergroupPath(owner.id)}/administrators/${bot.bot.id}`,
    jsonRequest('PUT', { can_change_info: true }),
  );
  const titleChange = await setTitle('  New\n  Team  ');
  const unchangedTitle = await setTitle('New Team');
  const emptyTitle = await setTitle(' ​\n');
  const descriptionChange = await setDescription('  About us  ');
  const unchangedDescription = await setDescription('About us');
  const chat = botApiResult(
    (await callBotApi(api, `${bot.botApiPath}/getChat`, { chat_id: supergroup.id })).body,
  );
  const descriptionRemoval = await setDescription('');
  const chatWithoutDescription = botApiResult(
    (await callBotApi(api, `${bot.botApiPath}/getChat`, { chat_id: supergroup.id })).body,
  );
  if (
    JSON.stringify(refusedBeforePromotion.map(describe)) !== JSON.stringify([
        'Bad Request: not enough rights to change chat title',
        'Bad Request: not enough rights to set chat description',
      ]) ||
    promotion.status !== 204 ||
    JSON.stringify([titleChange.body, unchangedTitle.body, descriptionChange.body]) !==
      JSON.stringify(Array(3).fill({ ok: true, result: true })) ||
    describe(emptyTitle) !== 'Bad Request: title must be non-empty' ||
    describe(unchangedDescription) !== 'Bad Request: chat description is not modified' ||
    chat?.title !== 'New Team' || chat.description !== 'About us' ||
    descriptionRemoval.status !== 200 || chatWithoutDescription === undefined ||
    'description' in chatWithoutDescription
  ) {
    throw new Error(
      `Expected Telegram's title and description changes, received ${
        JSON.stringify([
          refusedBeforePromotion,
          promotion.status,
          titleChange,
          unchangedTitle,
          emptyTitle,
          descriptionChange,
          unchangedDescription,
          chat,
          chatWithoutDescription,
        ])
      }`,
    );
  }

  const serviceMessages = async (botApiPath: string) =>
    (await readUpdates(botApiPath)).flatMap(({ message }) => {
      const { new_chat_title: newChatTitle, from } = message as {
        new_chat_title?: string;
        from?: { id: number };
      } ?? {};
      return newChatTitle === undefined ? [] : [{ newChatTitle, fromId: from?.id }];
    });
  const expectedServiceMessages = [{ newChatTitle: 'New Team', fromId: bot.bot.id }];
  const history = await (await api.request(`${supergroupPath(owner.id)}/messages`)).json() as {
    messages: Array<{ new_chat_title?: string }>;
  };
  if (
    JSON.stringify(await serviceMessages(bot.botApiPath)) !==
      JSON.stringify(expectedServiceMessages) ||
    JSON.stringify(await serviceMessages(readerBot.botApiPath)) !==
      JSON.stringify(expectedServiceMessages) ||
    history.messages.filter((message) => message.new_chat_title !== undefined).length !== 1
  ) {
    throw new Error('Expected one service message for the changed title, seen by every bot');
  }

  const privateChat = await createPrivateConversationFixture();
  await privateChat.sendText('/start');
  const privateDescription = await callBotApi(
    privateChat.api,
    `${privateChat.botApiPath}/setChatDescription`,
    { chat_id: privateChat.createdAccount.account.id, description: 'Chat' },
  );
  const privateTitle = await callBotApi(
    privateChat.api,
    `${privateChat.botApiPath}/setChatTitle`,
    { chat_id: privateChat.createdAccount.account.id, title: 'Chat' },
  );
  if (
    describe(privateTitle) !== "Bad Request: can't change private chat title" ||
    describe(privateDescription) !== "Bad Request: can't change private chat description"
  ) {
    throw new Error(
      `Expected private chats to have no title to change, received ${
        JSON.stringify([privateTitle, privateDescription])
      }`,
    );
  }
});

Deno.test('accounts change a supergroup title that bots see as a service message', async () => {
  const { api, sessionPath, member, bot, supergroupPath } = await createSupergroupFixture();
  const readUpdates = createUpdateReader(api);
  await readUpdates(bot.botApiPath);
  const outsider = await createAccount(api, sessionPath, 'Linus');
  const put = (accountId: number, path: 'title' | 'description', body: unknown) =>
    api.request(`${supergroupPath(accountId)}/${path}`, jsonRequest('PUT', body));

  const statuses = [
    (await put(member.id, 'title', { title: 'Grace and friends' })).status,
    (await put(member.id, 'title', { title: '⠀' })).status,
    (await put(outsider.id, 'title', { title: 'Mine' })).status,
    (await put(member.id, 'description', { description: 'Hello' })).status,
    (await put(member.id, 'description', { description: 'Hello' })).status,
    (await put(member.id, 'title', { name: 'Grace' })).status,
  ];
  const titleUpdates = (await readUpdates(bot.botApiPath)).flatMap(({ message }) => {
    const { new_chat_title: newChatTitle, from } = message as {
      new_chat_title?: string;
      from?: { id: number };
    } ?? {};
    return newChatTitle === undefined ? [] : [{ newChatTitle, fromId: from?.id }];
  });
  if (
    JSON.stringify(statuses) !== JSON.stringify([204, 400, 403, 204, 409, 400]) ||
    JSON.stringify(titleUpdates) !==
      JSON.stringify([{ newChatTitle: 'Grace and friends', fromId: member.id }])
  ) {
    throw new Error(
      `Expected a member's title change to reach the bot, received ${
        JSON.stringify([statuses, titleUpdates])
      }`,
    );
  }
});

Deno.test('the owner protects all supergroup content from forwarding and saving', async () => {
  const { api, sessionPath, owner, member, bot, supergroup, supergroupPath, sendSupergroupText } =
    await createSupergroupFixture();
  const readUpdates = createUpdateReader(api);
  const contentProtectionPath = (accountId: number) =>
    `${supergroupPath(accountId)}/content-protection`;
  await api.request(
    `${sessionPath}/accounts/${owner.id}/messages`,
    jsonRequest('POST', { to: { type: 'private', botId: bot.bot.id }, text: '/start' }),
  );
  const earlierMessage = await sendSupergroupText(member.id, '/plan before protection');
  await readUpdates(bot.botApiPath);

  const protectionStatuses = [
    (await api.request(contentProtectionPath(member.id), { method: 'PUT' })).status,
    (await api.request(contentProtectionPath(owner.id), { method: 'PUT' })).status,
  ];
  const laterMessage = await sendSupergroupText(member.id, '/plan after protection');
  const [update] = await readUpdates(bot.botApiPath);
  const botMessage = botApiResult(
    (await callBotApi(api, `${bot.botApiPath}/sendMessage`, {
      chat_id: supergroup.id,
      text: 'Noted',
    })).body,
  );
  if (
    JSON.stringify(protectionStatuses) !== JSON.stringify([403, 204]) ||
    (update?.message as Record<string, unknown> | undefined)?.has_protected_content !== true ||
    botMessage?.has_protected_content !== true
  ) {
    throw new Error(
      `Expected the owner alone to protect every message, received ${
        JSON.stringify({ protectionStatuses, update, botMessage })
      }`,
    );
  }

  // Protection covers earlier messages too; bots may still copy them, as TDLib lets bots.
  const repeat = (method: string, parameters: Record<string, unknown>) =>
    callBotApi(api, `${bot.botApiPath}/${method}`, {
      chat_id: owner.id,
      from_chat_id: supergroup.id,
      ...parameters,
    }).then(({ body }) => body);
  const forwardFailure = await repeat('forwardMessage', { message_id: earlierMessage.message_id });
  const forwardsFailure = await repeat('forwardMessages', {
    message_ids: [earlierMessage.message_id, laterMessage.message_id],
  });
  const copy = await repeat('copyMessage', { message_id: earlierMessage.message_id });
  const externalReply = botApiResult(
    (await callBotApi(api, `${bot.botApiPath}/sendMessage`, {
      chat_id: owner.id,
      text: 'About your plan',
      reply_parameters: { chat_id: supergroup.id, message_id: earlierMessage.message_id },
    })).body,
  );
  const accountForward = await api.request(
    `${sessionPath}/accounts/${owner.id}/messages`,
    jsonRequest('POST', {
      to: { type: 'private', botId: bot.bot.id },
      forward: {
        chat: { type: 'supergroup', chatId: supergroup.id },
        message_id: laterMessage.message_id,
      },
    }),
  );
  if (
    !isBadRequestResponse(forwardFailure) ||
    forwardFailure.description !== "Bad Request: the message can't be forwarded" ||
    !isBadRequestResponse(forwardsFailure) ||
    forwardsFailure.description !== "Bad Request: messages can't be forwarded" ||
    botApiResult(copy)?.message_id === undefined ||
    externalReply === undefined || externalReply.external_reply !== undefined ||
    accountForward.status !== 400
  ) {
    throw new Error(
      `Expected protected messages to be copied only, received ${
        JSON.stringify({ forwardFailure, forwardsFailure, copy, status: accountForward.status })
      }`,
    );
  }

  // Lifting the protection lets every message be forwarded again.
  const liftStatus = (await api.request(contentProtectionPath(owner.id), { method: 'DELETE' }))
    .status;
  const forward = await repeat('forwardMessage', { message_id: earlierMessage.message_id });
  const history = await (await api.request(`${supergroupPath(member.id)}/messages`)).json() as {
    messages: Array<{ message_id: number; has_protected_content?: boolean }>;
  };
  if (
    liftStatus !== 204 || botApiResult(forward)?.message_id === undefined ||
    history.messages.some((message) => message.has_protected_content !== undefined)
  ) {
    throw new Error(
      `Expected lifted protection to allow forwards, received ${
        JSON.stringify({ forward, history })
      }`,
    );
  }
});

Deno.test('bots address public supergroups by their usernames', async () => {
  const api = createEmulationApi({
    sessionLifecycle: createSessionLifecycleService(),
    publicOrigin: 'http://emulator.example:9000',
  });
  const sessionPath = (await api.request('/sessions', { method: 'POST' })).headers.get('Location');
  if (sessionPath === null) {
    throw new Error('Expected the created session to have a Location');
  }
  const owner = await createAccount(api, sessionPath, 'Ada');
  await api.request(
    `${sessionPath}/accounts`,
    jsonRequest('POST', { first_name: 'Grace', username: 'grace' }),
  );
  const bot = await createBot(api, sessionPath, 'team_bot');
  const createSupergroup = (body: Record<string, unknown>) =>
    api.request(`${sessionPath}/accounts/${owner.id}/supergroups`, jsonRequest('POST', body));
  const createResponse = await createSupergroup({ title: 'Team', username: 'team_chat' });
  const { supergroup } = await createResponse.json() as {
    supergroup: { id: number; username?: string };
  };
  const duplicateStatuses = [
    (await createSupergroup({ title: 'Copy', username: 'TEAM_CHAT' })).status,
    (await createSupergroup({ title: 'Copy', username: 'grace' })).status,
  ];
  await api.request(
    `${sessionPath}/accounts/${owner.id}/conversations/supergroup/${supergroup.id}/members/${bot.bot.id}`,
    { method: 'PUT' },
  );
  await api.request(
    `${sessionPath}/accounts/${owner.id}/messages`,
    jsonRequest('POST', { to: { type: 'private', botId: bot.bot.id }, text: '/start' }),
  );
  if (
    createResponse.status !== 201 || supergroup.username !== 'team_chat' ||
    JSON.stringify(duplicateStatuses) !== JSON.stringify([409, 409])
  ) {
    throw new Error(
      `Expected a public supergroup with a unique username, received ${
        JSON.stringify({ supergroup, duplicateStatuses })
      }`,
    );
  }

  const callBot = (method: string, parameters: Record<string, unknown>) =>
    callBotApi(api, `${bot.botApiPath}/${method}`, parameters).then(({ body }) => body);
  const sent = botApiResult(await callBot('sendMessage', { chat_id: '@Team_Chat', text: 'Hi' }));
  const forward = botApiResult(
    await callBot('forwardMessage', {
      chat_id: owner.id,
      from_chat_id: '@team_chat',
      message_id: sent?.message_id,
    }),
  );
  const externalReply = botApiResult(
    await callBot('sendMessage', {
      chat_id: owner.id,
      text: 'About that',
      reply_parameters: { chat_id: '@team_chat', message_id: sent?.message_id },
    }),
  );
  const member = botApiResult(
    await callBot('getChatMember', { chat_id: '@team_chat', user_id: owner.id }),
  );
  const commandsSet = await callBot('setMyCommands', {
    commands: [{ command: 'plan', description: 'Plan the week' }],
    scope: { type: 'chat', chat_id: '@team_chat' },
  });
  const commands = botApiResult(
    await callBot('getMyCommands', { scope: { type: 'chat', chat_id: supergroup.id } }),
  ) as unknown;
  const expectedChat = {
    id: supergroup.id,
    title: 'Team',
    username: 'team_chat',
    type: 'supergroup',
  };
  if (
    JSON.stringify(sent?.chat) !== JSON.stringify(expectedChat) ||
    forward?.text !== 'Hi' ||
    (externalReply?.external_reply as { chat?: unknown } | undefined)?.chat === undefined ||
    member?.status !== 'creator' ||
    JSON.stringify(commandsSet) !== JSON.stringify({ ok: true, result: true }) ||
    JSON.stringify(commands) !==
      JSON.stringify([{ command: 'plan', description: 'Plan the week' }])
  ) {
    throw new Error(
      `Expected the username to name the supergroup, received ${
        JSON.stringify({ sent, forward, externalReply, member, commandsSet, commands })
      }`,
    );
  }

  // As Telegram's check_chat does, only public supergroups and bots are found by username.
  const failures = [
    await callBot('sendMessage', { chat_id: '@grace', text: 'Hi' }),
    await callBot('sendMessage', { chat_id: '@nobody', text: 'Hi' }),
    await callBot('sendMessage', { chat_id: '@team_bot', text: 'Hi' }),
    await callBot('copyMessage', { chat_id: owner.id, from_chat_id: '@nobody', message_id: 1 }),
    await callBot('sendMessage', {
      chat_id: owner.id,
      text: 'Hi',
      reply_parameters: { chat_id: '@nobody', message_id: 1 },
    }),
    await callBot('getMyCommands', { scope: { type: 'chat', chat_id: '@nobody' } }),
  ];
  if (
    failures.some((failure) =>
      !isBadRequestResponse(failure) || failure.description !== 'Bad Request: chat not found'
    )
  ) {
    throw new Error(
      `Expected unknown usernames to name no chat, received ${JSON.stringify(failures)}`,
    );
  }
});

Deno.test('administrator bots that request chat_member updates observe members joining', async () => {
  const { api, sessionPath, owner, bot, readerBot, supergroup, supergroupPath } =
    await createSupergroupFixture();
  const outsider = await createAccount(api, sessionPath, 'Linus');
  const promotion = await api.request(
    `${supergroupPath(owner.id)}/administrators/${bot.bot.id}`,
    jsonRequest('PUT', { can_restrict_members: true }),
  );
  // Both bots confirm their earlier updates and request chat_member updates from now on.
  for (const { botApiPath } of [bot, readerBot]) {
    const { body } = await callBotApi(api, `${botApiPath}/getUpdates`, {
      allowed_updates: ['message', 'my_chat_member', 'chat_member'],
    });
    const lastUpdateId = (body as { result: Array<{ update_id: number }> }).result.at(-1)
      ?.update_id;
    await callBotApi(api, `${botApiPath}/getUpdates`, { offset: (lastUpdateId ?? 0) + 1 });
  }
  const addition = await api.request(`${supergroupPath(owner.id)}/members/${outsider.id}`, {
    method: 'PUT',
  });

  const readUpdates = async (botApiPath: string) =>
    ((await callBotApi(api, `${botApiPath}/getUpdates`, {})).body as {
      result: Array<Record<string, unknown>>;
    }).result;
  const [administratorUpdates, readerUpdates] = await Promise.all([
    readUpdates(bot.botApiPath),
    readUpdates(readerBot.botApiPath),
  ]);
  const chatMember = administratorUpdates[0]?.chat_member as Record<string, unknown> | undefined;
  if (
    promotion.status !== 204 || addition.status !== 204 ||
    JSON.stringify(administratorUpdates.map((update) => Object.keys(update)[1])) !==
      JSON.stringify(['chat_member', 'message']) ||
    JSON.stringify({ ...chatMember, date: 0 }) !== JSON.stringify({
        chat: { id: supergroup.id, title: 'Team', type: 'supergroup' },
        from: owner,
        date: 0,
        old_chat_member: { user: outsider, status: 'left' },
        new_chat_member: { user: outsider, status: 'member' },
      }) ||
    JSON.stringify(readerUpdates.map((update) => Object.keys(update)[1])) !==
      JSON.stringify(['message'])
  ) {
    throw new Error(
      `Expected only the administrator bot to observe the join, received ${
        JSON.stringify([administratorUpdates, readerUpdates])
      }`,
    );
  }
});

Deno.test('banChatMember, unbanChatMember, and deleteMessage follow Telegram checks for administrators', async () => {
  const {
    api,
    sessionPath,
    owner,
    member,
    bot,
    readerBot,
    supergroup,
    supergroupPath,
    sendSupergroupText,
  } = await createSupergroupFixture();
  const outsider = await createAccount(api, sessionPath, 'Linus');
  const readNewUpdates = createUpdateReader(api);
  await readNewUpdates(bot.botApiPath);
  await readNewUpdates(readerBot.botApiPath);
  const callBot = (method: string, parameters: Record<string, unknown>) =>
    callBotApi(api, `${bot.botApiPath}/${method}`, parameters);
  const describe = (responses: Array<{ status: number; body: unknown }>) =>
    responses.map(({ status, body }) => {
      const { result, description } = body as { result?: unknown; description?: string };
      return [status, description ?? result];
    });
  const target = (userId: number) => ({ chat_id: supergroup.id, user_id: userId });

  // Without rights, the bot bans nobody; nobody bans the owner or itself.
  const refusals = describe(
    await Promise.all([
      callBot('banChatMember', target(member.id)),
      callBot('unbanChatMember', target(member.id)),
      callBot('banChatMember', target(owner.id)),
      callBot('banChatMember', target(bot.bot.id)),
      callBot('banChatMember', { chat_id: supergroup.id }),
    ]),
  );
  const notEnoughRights = 'Bad Request: not enough rights to restrict/unrestrict chat member';
  if (
    JSON.stringify(refusals) !== JSON.stringify([
      [400, notEnoughRights],
      [400, notEnoughRights],
      [400, "Bad Request: can't remove chat owner"],
      [400, "Bad Request: can't restrict self"],
      [400, 'Bad Request: invalid user_id specified'],
    ])
  ) {
    throw new Error(`Expected refusals without rights, received ${JSON.stringify(refusals)}`);
  }

  const administratorsPath = `${supergroupPath(owner.id)}/administrators`;
  await api.request(
    `${administratorsPath}/${bot.bot.id}`,
    jsonRequest('PUT', { can_restrict_members: true, can_delete_messages: true }),
  );
  await api.request(
    `${administratorsPath}/${readerBot.bot.id}`,
    jsonRequest('PUT', { can_pin_messages: true }),
  );
  await readNewUpdates(bot.botApiPath);
  await readNewUpdates(readerBot.botApiPath);

  // An administrator bot receives every message, deletes any, and bans members, which a service
  // message of the bot records; as bots never see other bots' messages, only the bot receives it.
  const spam = await sendSupergroupText(member.id, 'Buy now!');
  const untilDate = Math.floor(Date.now() / 1_000) + 3_600;
  const moderation = describe(
    await Promise.all([
      callBot('deleteMessage', { chat_id: supergroup.id, message_id: spam.message_id }),
      callBot('banChatMember', { ...target(member.id), until_date: untilDate }),
      callBot('banChatMember', target(readerBot.bot.id)),
      callBot('kickChatMember', target(outsider.id)),
    ]),
  );
  const [bannedMember, preBannedOutsider] = await Promise.all([
    callBot('getChatMember', target(member.id)),
    callBot('getChatMember', target(outsider.id)),
  ]).then((responses) => responses.map(({ body }) => (body as { result: unknown }).result));
  const botUpdates = await readNewUpdates(bot.botApiPath);
  const readerUpdates = await readNewUpdates(readerBot.botApiPath);
  const bannedMemberHistory = await api.request(`${supergroupPath(member.id)}/messages`);
  if (
    JSON.stringify(moderation) !== JSON.stringify([
        [200, true],
        [200, true],
        [400, 'Bad Request: user is an administrator of the chat'],
        [200, true],
      ]) ||
    JSON.stringify(bannedMember) !==
      JSON.stringify({ user: member, status: 'kicked', until_date: untilDate }) ||
    JSON.stringify(preBannedOutsider) !==
      JSON.stringify({ user: outsider, status: 'kicked', until_date: 0 }) ||
    bannedMemberHistory.status !== 403
  ) {
    throw new Error(
      `Expected the bot to delete the spam and ban its sender, received ${
        JSON.stringify([moderation, bannedMember, preBannedOutsider])
      }`,
    );
  }
  const describeUpdates = (updates: Array<Record<string, unknown>>) =>
    updates.map(({ message }) => {
      const { text, from, left_chat_member } = message as {
        text?: string;
        from: { id: number };
        left_chat_member?: { id: number };
      };
      return [from.id, text ?? `left_chat_member ${left_chat_member?.id}`];
    });
  // As a service message, the ban's reaches the reader bot, though another bot made it.
  const expectedUpdates = [[member.id, 'Buy now!'], [bot.bot.id, `left_chat_member ${member.id}`]];
  if (
    JSON.stringify(describeUpdates(botUpdates)) !== JSON.stringify(expectedUpdates) ||
    JSON.stringify(describeUpdates(readerUpdates)) !== JSON.stringify(expectedUpdates)
  ) {
    throw new Error(
      `Expected the spam and the ban's service message, received ${
        JSON.stringify([botUpdates, readerUpdates])
      }`,
    );
  }

  // Lifting only a ban leaves the user free to be added again. Otherwise, as on Telegram,
  // unbanning a member removes it.
  const unbanning = describe(
    await Promise.all([
      callBot('unbanChatMember', { ...target(member.id), only_if_banned: true }),
      callBot('unbanChatMember', { ...target(owner.id), only_if_banned: true }),
    ]),
  );
  const readdition = await api.request(`${supergroupPath(owner.id)}/members/${member.id}`, {
    method: 'PUT',
  });
  const removal = describe([await callBot('unbanChatMember', target(member.id))]);
  const removedMember = await callBot('getChatMember', target(member.id));
  if (
    JSON.stringify([...unbanning, ...removal]) !==
      JSON.stringify([[200, true], [200, true], [200, true]]) ||
    readdition.status !== 204 ||
    JSON.stringify((removedMember.body as { result: unknown }).result) !==
      JSON.stringify({ user: member, status: 'left' })
  ) {
    throw new Error(
      `Expected unbanning to lift the ban and then remove the member, received ${
        JSON.stringify([unbanning, removal, removedMember])
      }`,
    );
  }

  // A private chat has two members and no administrators, and its members cannot be banned.
  await api.request(
    `${sessionPath}/accounts/${owner.id}/messages`,
    jsonRequest('POST', { to: { type: 'private', botId: bot.bot.id }, text: '/start' }),
  );
  const privateChat = { chat_id: owner.id, user_id: owner.id };
  const privateResponses = describe(
    await Promise.all([
      callBot('getChatMember', privateChat),
      callBot('getChatMemberCount', { chat_id: owner.id }),
      callBot('getChatAdministrators', { chat_id: owner.id }),
      callBot('banChatMember', privateChat),
      callBot('unbanChatMember', privateChat),
      callBot('banChatMember', { chat_id: outsider.id, user_id: outsider.id }),
    ]),
  );
  if (
    JSON.stringify(privateResponses) !== JSON.stringify([
      [200, { user: owner, status: 'member' }],
      [200, 2],
      [400, 'Bad Request: there are no administrators in the private chat'],
      [400, "Bad Request: can't ban members in private chats"],
      [400, 'Bad Request: method is available only in supergroup and channel chats'],
      [400, 'Bad Request: chat not found'],
    ])
  ) {
    throw new Error(`Expected private chat checks, received ${JSON.stringify(privateResponses)}`);
  }
});

Deno.test('a grammY bot bans a spammer for an administrator and deletes the spam', async () => {
  const { api, sessionPath, owner, member, bot, supergroupPath, sendSupergroupText } =
    await createSupergroupFixture();
  await api.request(
    `${supergroupPath(owner.id)}/administrators/${bot.bot.id}`,
    jsonRequest('PUT', { can_restrict_members: true, can_delete_messages: true }),
  );
  const grammyBot = new Bot(bot.token, {
    client: {
      apiRoot: `http://emulator.example:9000${sessionPath}/bot-api`,
      fetch: createInProcessFetch(api.fetch),
    },
  });
  const handledCommands: Array<PromiseWithResolvers<void>> = [
    Promise.withResolvers<void>(),
    Promise.withResolvers<void>(),
  ];
  let handledCommandCount = 0;
  grammyBot.command('ban', async (context) => {
    const spam = context.message?.reply_to_message;
    const author = await context.getAuthor();
    if (author.status !== 'creator' && author.status !== 'administrator') {
      await context.reply('Only administrators can ban.');
    } else if (spam?.from !== undefined) {
      await context.banChatMember(spam.from.id);
      await context.api.deleteMessages(context.chat.id, [spam.message_id, context.msgId]);
    }
    handledCommands[handledCommandCount++]?.resolve();
  });
  const polling = grammyBot.start();

  try {
    const spam = await sendSupergroupText(member.id, 'Buy now!');
    await sendSupergroupText(member.id, '/ban', spam.message_id);
    await Promise.race([handledCommands[0].promise, polling]);
    await sendSupergroupText(owner.id, '/ban', spam.message_id);
    await Promise.race([handledCommands[1].promise, polling]);
  } finally {
    await grammyBot.stop();
    await polling;
  }

  const history = await (await api.request(`${supergroupPath(owner.id)}/messages`)).json() as {
    messages: Array<{ from: { id: number }; text?: string; left_chat_member?: { id: number } }>;
  };
  const shownMessages = history.messages.slice(3).map(({ from, text, left_chat_member }) => [
    from.id,
    text ?? `left_chat_member ${left_chat_member?.id}`,
  ]);
  if (
    JSON.stringify(shownMessages) !== JSON.stringify([
      [member.id, '/ban'],
      [bot.bot.id, 'Only administrators can ban.'],
      [bot.bot.id, `left_chat_member ${member.id}`],
    ])
  ) {
    throw new Error(
      `Expected the spam and command to be deleted, received ${JSON.stringify(history)}`,
    );
  }
});

Deno.test('sendPhoto and sendDocument upload files, reuse file IDs, and follow Telegram checks', async () => {
  const { api, botApiPath, createdAccount, sendText } = await createPrivateConversationFixture();
  await sendText('/start');
  const chatId = createdAccount.account.id;

  const uploadedPhoto = await callBotApiWithFiles(api, `${botApiPath}/sendPhoto`, {
    chat_id: String(chatId),
    caption: '<b>Chart</b>',
    parse_mode: 'HTML',
    has_spoiler: 'true',
  }, { photo: new File([gifImage(640, 480)], 'chart.gif') });
  const photo = botApiResult(uploadedPhoto.body);
  const photoSize = Array.isArray(photo?.photo) ? photo.photo[0] : undefined;
  if (
    uploadedPhoto.status !== 200 || photo?.caption !== 'Chart' ||
    JSON.stringify(photo.caption_entities) !==
      JSON.stringify([{ type: 'bold', offset: 0, length: 5 }]) ||
    photo.has_media_spoiler !== true || photoSize?.width !== 640 || photoSize.height !== 480
  ) {
    throw new Error(`Expected an uploaded photo, received ${JSON.stringify(uploadedPhoto.body)}`);
  }

  const uploadedDocument = await callBotApiWithFiles(api, `${botApiPath}/sendDocument`, {
    chat_id: String(chatId),
    document: 'attach://attachment',
  }, { attachment: new File(['a,b\n'], 'folder/report?.csv') });
  const document = botApiResult(uploadedDocument.body)?.document as
    | Record<string, unknown>
    | undefined;
  if (
    uploadedDocument.status !== 200 || document?.file_name !== 'report.csv' ||
    document.mime_type !== 'text/csv' || document.file_size !== 4 ||
    typeof document.file_id !== 'string'
  ) {
    throw new Error(
      `Expected an attached document, received ${JSON.stringify(uploadedDocument.body)}`,
    );
  }

  const reusedPhoto = await callBotApi(api, `${botApiPath}/sendPhoto`, {
    chat_id: chatId,
    photo: photoSize.file_id,
  });
  const reusedPhotoSize = (botApiResult(reusedPhoto.body)?.photo as unknown[] | undefined)?.[0];
  if (
    reusedPhoto.status !== 200 ||
    JSON.stringify(reusedPhotoSize) !== JSON.stringify(photoSize)
  ) {
    throw new Error(`Expected the photo to be sent again, received ${JSON.stringify(reusedPhoto)}`);
  }

  const failures: {
    method: string;
    parameters: Record<string, string | number>;
    files: Record<string, File>;
  }[] = [
    { method: 'sendPhoto', parameters: { chat_id: chatId }, files: {} },
    { method: 'sendPhoto', parameters: { chat_id: chatId, photo: 'attach://missing' }, files: {} },
    { method: 'sendDocument', parameters: { chat_id: chatId }, files: {} },
    {
      method: 'sendPhoto',
      parameters: { chat_id: chatId, photo: 'https://example.com/chart.png' },
      files: {},
    },
    {
      method: 'sendPhoto',
      parameters: { chat_id: chatId },
      files: { photo: new File(['not an image'], 'chart.png') },
    },
    {
      method: 'sendPhoto',
      parameters: { chat_id: chatId },
      files: { photo: new File([gifImage(5_001, 5_000)], 'huge.gif') },
    },
    { method: 'sendPhoto', parameters: { chat_id: chatId }, files: { photo: new File([], 'a') } },
    {
      method: 'sendPhoto',
      parameters: { chat_id: chatId },
      files: {
        photo: new File([gifImage(1_280, 720), new Uint8Array(10 * 1024 * 1024)], 'big.gif'),
      },
    },
    {
      method: 'sendPhoto',
      parameters: { chat_id: chatId, photo: 'AgACAgIAAxkBAAIBdGZ' },
      files: {},
    },
    { method: 'sendPhoto', parameters: { chat_id: chatId, photo: document.file_id }, files: {} },
    {
      method: 'sendDocument',
      parameters: { chat_id: chatId, document: photoSize.file_id },
      files: {},
    },
    {
      method: 'sendPhoto',
      parameters: { chat_id: chatId, photo: photoSize.file_id, caption: 'x'.repeat(1_025) },
      files: {},
    },
    {
      method: 'sendPhoto',
      parameters: {
        chat_id: chatId,
        photo: photoSize.file_id,
        caption: 'Done.',
        parse_mode: 'MarkdownV2',
      },
      files: {},
    },
    { method: 'sendPhoto', parameters: { photo: photoSize.file_id }, files: {} },
  ];
  const descriptions = [];
  for (const { method, parameters, files } of failures) {
    const { status, body } = await callBotApiWithFiles(
      api,
      `${botApiPath}/${method}`,
      Object.fromEntries(Object.entries(parameters).map(([name, value]) => [name, String(value)])),
      files,
    );
    descriptions.push(status === 400 && isBadRequestResponse(body) ? body.description : status);
  }
  const expectedDescriptions = [
    'Bad Request: there is no photo in the request',
    'Bad Request: there is no photo in the request',
    'Bad Request: there is no document in the request',
    'Bad Request: failed to get HTTP URL content',
    'Bad Request: IMAGE_PROCESS_FAILED',
    'Bad Request: PHOTO_INVALID_DIMENSIONS',
    'Bad Request: file must be non-empty',
    `Bad Request: file of size ${
      gifImage(1_280, 720).length + 10 * 1024 * 1024
    } bytes is too big for a photo; the maximum size is 10485760 bytes`,
    'Bad Request: wrong file identifier/HTTP URL specified',
    "Bad Request: can't use file of type Document as Photo",
    "Bad Request: can't use file of type Photo as Document",
    'Bad Request: message caption is too long',
    "Bad Request: can't parse entities: Character '.' is reserved and must be escaped with the preceding '\\'",
    'Bad Request: chat_id is empty',
  ];
  if (JSON.stringify(descriptions) !== JSON.stringify(expectedDescriptions)) {
    throw new Error(
      `Expected Telegram's errors, received ${JSON.stringify(descriptions, null, 2)}`,
    );
  }
});

Deno.test('an account and a bot exchange albums whose messages arrive in order', async () => {
  const { api, sessionPath, botApiPath, createdBot, createdAccount } =
    await createPrivateConversationFixture();
  const chat = { type: 'private', botId: createdBot.bot.id };
  const accountPath = `${sessionPath}/accounts/${createdAccount.account.id}`;

  const accountAlbumResponse = await api.request(
    `${accountPath}/media-groups`,
    jsonRequest('POST', {
      to: chat,
      media: [
        { photo: { content_base64: gifImage(640, 480).toBase64() }, caption: 'Front' },
        { photo: { content_base64: gifImage(480, 640).toBase64() }, caption: 'Back' },
      ],
    }),
  );
  const accountAlbum = (await accountAlbumResponse.json()).messages as Record<string, unknown>[];
  const updates = updateMessages((await callBotApi(api, `${botApiPath}/getUpdates`, {})).body);
  const [front, back] = updates;
  if (
    accountAlbumResponse.status !== 201 || accountAlbum.length !== 2 || updates.length !== 2 ||
    typeof front.media_group_id !== 'string' || back.media_group_id !== front.media_group_id ||
    JSON.stringify(updates.map((message) => [message.message_id, message.caption])) !==
      JSON.stringify([[1, 'Front'], [2, 'Back']]) ||
    JSON.stringify(accountAlbum) !== JSON.stringify(updates)
  ) {
    throw new Error(
      `Expected the bot to receive the album in order, received ${JSON.stringify(updates)}`,
    );
  }

  const reply = await callBotApiWithFiles(api, `${botApiPath}/sendMediaGroup`, {
    chat_id: String(createdAccount.account.id),
    reply_parameters: JSON.stringify({ message_id: back.message_id }),
    media: JSON.stringify([
      {
        type: 'document',
        media: 'attach://summary',
        caption: '*Summary*',
        parse_mode: 'MarkdownV2',
      },
      { type: 'document', media: 'attach://details' },
    ]),
  }, {
    summary: new File(['summary'], 'summary.txt'),
    details: new File(['details'], 'details.csv'),
  });
  const replyMessages = (reply.body as { result?: Record<string, unknown>[] }).result ?? [];
  const [summary, details] = replyMessages;
  if (
    reply.status !== 200 || replyMessages.length !== 2 ||
    JSON.stringify(Object.keys(summary)) !== JSON.stringify([
        'message_id',
        'from',
        'chat',
        'date',
        'reply_to_message',
        'media_group_id',
        'document',
        'caption',
        'caption_entities',
      ]) ||
    summary.message_id !== 3 || details.message_id !== 4 ||
    typeof summary.media_group_id !== 'string' ||
    summary.media_group_id === front.media_group_id ||
    details.media_group_id !== summary.media_group_id ||
    replyMessages.some((message) =>
      (message.reply_to_message as Record<string, unknown>).message_id !== back.message_id
    ) ||
    summary.caption !== 'Summary' || 'caption' in details
  ) {
    throw new Error(`Expected the bot's album as a reply, received ${JSON.stringify(reply.body)}`);
  }
  const botUpdates = await callBotApi(api, `${botApiPath}/getUpdates`, { offset: 3 });
  if (updateMessages(botUpdates.body).length !== 0) {
    throw new Error('Expected the bot to receive no update for its own album');
  }

  const historyResponse = await api.request(
    `${accountPath}/conversations/private/${createdBot.bot.id}/messages`,
  );
  const history = (await historyResponse.json()).messages as Record<string, unknown>[];
  const downloads = await Promise.all(
    history.slice(2).map(async (message) => {
      const { file_unique_id } = message.document as { file_unique_id: string };
      const download = await api.request(`${sessionPath}/files/${file_unique_id}`);
      return new TextDecoder().decode(await download.arrayBuffer());
    }),
  );
  if (
    JSON.stringify(history.map((message) => [message.message_id, message.media_group_id])) !==
      JSON.stringify([
        [1, front.media_group_id],
        [2, front.media_group_id],
        [3, summary.media_group_id],
        [4, summary.media_group_id],
      ]) ||
    JSON.stringify(downloads) !== JSON.stringify(['summary', 'details'])
  ) {
    throw new Error(
      `Expected the history to hold both albums, received ${JSON.stringify(history)}`,
    );
  }
});

Deno.test('sendMediaGroup follows Telegram checks and sends nothing it refuses', async () => {
  const { api, sessionPath, botApiPath, createdBot, createdAccount, sendText } =
    await createPrivateConversationFixture();
  await sendText('/start');
  const chatId = String(createdAccount.account.id);
  const uploadedPhoto = await callBotApiWithFiles(api, `${botApiPath}/sendPhoto`, {
    chat_id: chatId,
  }, { photo: new File([gifImage(4, 3)], 'photo.gif') });
  const photoFileId = photoSizeOf(botApiResult(uploadedPhoto.body))?.file_id;
  const uploadedDocument = await callBotApiWithFiles(api, `${botApiPath}/sendDocument`, {
    chat_id: chatId,
  }, { document: new File(['notes'], 'notes.txt') });
  const documentFileId = (botApiResult(uploadedDocument.body)?.document as
    | { file_id: string }
    | undefined)?.file_id;
  if (photoFileId === undefined || documentFileId === undefined) {
    throw new Error('Expected a photo and a document to reuse');
  }
  const photo = { type: 'photo', media: photoFileId };
  const document = { type: 'document', media: documentFileId };
  const image = new File([gifImage(4, 3)], 'image.gif');
  const historyPath =
    `${sessionPath}/accounts/${chatId}/conversations/private/${createdBot.bot.id}/messages`;
  const historyBefore = await (await api.request(historyPath)).text();

  const failures: { parameters: Record<string, string>; files: Record<string, File> }[] = [
    { parameters: { chat_id: chatId }, files: {} },
    { parameters: { chat_id: chatId, media: '[' }, files: {} },
    { parameters: { chat_id: chatId, media: '{}' }, files: {} },
    { parameters: { chat_id: chatId, media: '[]' }, files: {} },
    { parameters: { chat_id: chatId, media: 'null' }, files: {} },
    { parameters: { chat_id: chatId, media: JSON.stringify(Array(11).fill(photo)) }, files: {} },
    { parameters: { chat_id: chatId, media: JSON.stringify([photo, document]) }, files: {} },
    {
      parameters: {
        chat_id: chatId,
        media: JSON.stringify([photo, { ...photo, show_caption_above_media: true }]),
      },
      files: {},
    },
    {
      parameters: {
        chat_id: chatId,
        media: JSON.stringify([photo, { type: 'photo', media: 'attach://missing' }]),
      },
      files: {},
    },
    {
      parameters: {
        chat_id: chatId,
        media: JSON.stringify([photo, { type: 'video', media: 'x' }]),
      },
      files: {},
    },
    {
      parameters: {
        chat_id: chatId,
        media: JSON.stringify([photo, { ...photo, caption: '*bold', parse_mode: 'MarkdownV2' }]),
      },
      files: {},
    },
    {
      parameters: {
        chat_id: chatId,
        media: JSON.stringify([photo, { ...photo, caption: 'x'.repeat(1_025) }]),
      },
      files: {},
    },
    {
      parameters: {
        chat_id: chatId,
        media: JSON.stringify([photo, { type: 'photo', media: 'attach://text' }]),
      },
      files: { text: new File(['not an image'], 'text.gif') },
    },
    // TDLib reads a file_id before Telegram's servers refuse an earlier upload.
    {
      parameters: {
        chat_id: chatId,
        media: JSON.stringify([{ type: 'photo', media: 'attach://text' }, {
          type: 'photo',
          media: 'AgACAgIAAxkBAAIBdGZ',
        }]),
      },
      files: { text: new File(['not an image'], 'text.gif') },
    },
    {
      parameters: {
        chat_id: chatId,
        media: JSON.stringify([photo, { type: 'photo', media: 'attach://empty' }]),
      },
      files: { empty: new File([], 'empty.gif') },
    },
    {
      parameters: {
        chat_id: chatId,
        media: JSON.stringify([photo, { type: 'photo', media: 'https://example.com/a.gif' }]),
      },
      files: {},
    },
    {
      parameters: {
        chat_id: chatId,
        media: JSON.stringify([photo, { type: 'photo', media: 'attach://image' }]),
        reply_markup: JSON.stringify({ inline_keyboard: [] }),
      },
      files: { image },
    },
    {
      parameters: {
        chat_id: chatId,
        media: JSON.stringify([photo, { type: 'photo', media: 'attach://image' }]),
        reply_parameters: JSON.stringify({ message_id: 999 }),
      },
      files: { image },
    },
    {
      parameters: { media: JSON.stringify([photo, { type: 'photo', media: 'attach://image' }]) },
      files: { image },
    },
  ];
  const descriptions = [];
  for (const { parameters, files } of failures) {
    const { status, body } = await callBotApiWithFiles(
      api,
      `${botApiPath}/sendMediaGroup`,
      parameters,
      files,
    );
    descriptions.push(status === 400 && isBadRequestResponse(body) ? body.description : status);
  }
  const expectedDescriptions = [
    'Bad Request: parameter "media" is required',
    "Bad Request: can't parse media JSON object",
    'Bad Request: expected an Array of InputMedia',
    'Bad Request: there are no messages to send',
    'Bad Request: there are no messages to send',
    'Bad Request: too many messages to send as an album',
    "Bad Request: document can't be mixed with other media types",
    'Bad Request: parameter show_caption_above_media must be the same for all messages',
    "Bad Request: can't parse InputMedia: media not found",
    'Bad Request: InputMedia of type "video" is not supported',
    "Bad Request: can't parse InputMedia: Can't parse entities: Can't find end of Bold entity at byte offset 0",
    'Bad Request: message caption is too long',
    'Bad Request: failed to send message #2 with the error message "IMAGE_PROCESS_FAILED"',
    'Bad Request: wrong file identifier/HTTP URL specified',
    'Bad Request: file must be non-empty',
    'Bad Request: failed to send message #2 with the error message "WEBPAGE_CURL_FAILED"',
    'Bad Request: invalid sendMediaGroup parameters',
    'Bad Request: message to be replied not found',
    'Bad Request: chat_id is empty',
  ];
  if (JSON.stringify(descriptions) !== JSON.stringify(expectedDescriptions)) {
    throw new Error(
      `Expected Telegram's errors, received ${JSON.stringify(descriptions, null, 2)}`,
    );
  }
  if ((await (await api.request(historyPath)).text()) !== historyBefore) {
    throw new Error('Expected refused albums to leave the history as it was');
  }

  const single = await callBotApi(api, `${botApiPath}/sendMediaGroup`, {
    chat_id: chatId,
    media: [document],
  });
  const singleMessages = (single.body as { result?: Record<string, unknown>[] }).result;
  if (
    single.status !== 200 || singleMessages?.length !== 1 || 'media_group_id' in singleMessages[0]
  ) {
    throw new Error(`Expected one message outside any album, received ${JSON.stringify(single)}`);
  }
});

Deno.test('albums reach supergroup bots as their messages would alone', async () => {
  const { api, sessionPath, owner, bot, readerBot, supergroup, supergroupPath } =
    await createSupergroupFixture();
  const readUpdates = createUpdateReader(api);
  const botApiPath = `${sessionPath}/bot-api/bot${bot.token}`;
  const readerBotApiPath = `${sessionPath}/bot-api/bot${readerBot.token}`;
  await readUpdates(botApiPath);
  await readUpdates(readerBotApiPath);

  const albumResponse = await api.request(
    `${sessionPath}/accounts/${owner.id}/media-groups`,
    jsonRequest('POST', {
      to: { type: 'supergroup', chatId: supergroup.id },
      media: [
        { document: { content_base64: 'cGxhbg==', file_name: 'plan.txt' }, caption: '/start' },
        { document: { content_base64: 'bm90ZXM=', file_name: 'notes.txt' }, caption: 'Notes' },
      ],
    }),
  );
  const album = (await albumResponse.json()).messages as Record<string, unknown>[];
  const botMessages = (await readUpdates(botApiPath)).map((update) => update.message) as Record<
    string,
    unknown
  >[];
  const readerMessages = (await readUpdates(readerBotApiPath)).map((update) =>
    update.message
  ) as Record<string, unknown>[];
  if (
    albumResponse.status !== 201 || album.length !== 2 ||
    album[1].media_group_id !== album[0].media_group_id ||
    JSON.stringify(botMessages.map((message) => message.caption)) !== JSON.stringify(['/start']) ||
    JSON.stringify(
        readerMessages.map((message) => [message.message_id, message.media_group_id]),
      ) !==
      JSON.stringify(album.map((message) => [message.message_id, message.media_group_id]))
  ) {
    throw new Error(
      `Expected a bot in privacy mode to receive only the command, received ${
        JSON.stringify({ botMessages, readerMessages })
      }`,
    );
  }

  // Each bot reuses the files by the file_id it received them under.
  const botAlbum = await callBotApi(api, `${readerBotApiPath}/sendMediaGroup`, {
    chat_id: supergroup.id,
    media: readerMessages.map((message) => ({
      type: 'document',
      media: (message.document as { file_id: string }).file_id,
    })),
    protect_content: true,
  });
  const botAlbumMessages = (botAlbum.body as { result?: Record<string, unknown>[] }).result ?? [];
  const history = (await (await api.request(`${supergroupPath(owner.id)}/messages`)).json())
    .messages as Record<string, unknown>[];
  if (
    botAlbum.status !== 200 || botAlbumMessages.length !== 2 ||
    botAlbumMessages.some((message) => message.has_protected_content !== true) ||
    JSON.stringify(history.slice(-2).map((message) => message.media_group_id)) !==
      JSON.stringify(botAlbumMessages.map((message) => message.media_group_id)) ||
    (await readUpdates(botApiPath)).length !== 0
  ) {
    throw new Error(`Expected the bot's album in the history, received ${JSON.stringify(history)}`);
  }
});

Deno.test('a cloud session answers bot uploads over 50 MB with 413 and keeps no trace', async () => {
  const { api, sessionPath, botApiPath, createdBot, createdAccount, sendText } =
    await createPrivateConversationFixture();
  await sendText('/start');
  const chatId = String(createdAccount.account.id);
  const maxUploadBytes = 50 * 1024 * 1024;

  const atLimit = await callBotApiWithFiles(api, `${botApiPath}/sendDocument`, {
    chat_id: chatId,
  }, { document: new File([new Uint8Array(maxUploadBytes)], 'at-limit.bin') });
  const atLimitMessage = botApiResult(atLimit.body);
  const atLimitDocument = atLimitMessage?.document as Record<string, unknown> | undefined;
  if (atLimit.status !== 200 || atLimitDocument?.file_size !== maxUploadBytes) {
    throw new Error(`Expected a document of exactly 50 MB, received ${atLimit.status}`);
  }

  const oversizedFile = new File([new Uint8Array(maxUploadBytes + 1)], 'oversized.bin');
  const oversizedAnswers = [
    await callBotApiWithFiles(api, `${botApiPath}/sendDocument`, { chat_id: chatId }, {
      document: oversizedFile,
    }),
    await callBotApiWithFiles(api, `${botApiPath}/sendPhoto`, { chat_id: chatId }, {
      photo: oversizedFile,
    }),
    await callBotApiWithFiles(api, `${botApiPath}/editMessageMedia`, {
      chat_id: chatId,
      message_id: String(atLimitMessage?.message_id),
      media: JSON.stringify({ type: 'document', media: 'attach://replacement' }),
    }, { replacement: oversizedFile }),
    await callBotApiWithFiles(api, `${botApiPath}/sendRichMessage`, {
      chat_id: chatId,
      rich_message: JSON.stringify({
        blocks: [{ type: 'document', document: { type: 'document', media: 'attach://block' } }],
      }),
    }, { block: oversizedFile }),
  ];
  for (const { status, body } of oversizedAnswers) {
    if (
      status !== 413 || JSON.stringify(body) !==
        JSON.stringify({ ok: false, error_code: 413, description: 'Request Entity Too Large' })
    ) {
      throw new Error(`Expected 413 Request Entity Too Large, received ${JSON.stringify(body)}`);
    }
  }

  const historyResponse = await api.request(
    `${sessionPath}/accounts/${chatId}/conversations/private/${createdBot.bot.id}/messages`,
  );
  const history = await historyResponse.json() as {
    messages: { document?: { file_name: string } }[];
  };
  const documentNames = history.messages.map((message) => message.document?.file_name ?? null);
  if (JSON.stringify(documentNames) !== JSON.stringify([null, 'at-limit.bin'])) {
    throw new Error(`Expected only the document within the limit, received ${documentNames}`);
  }

  const activityResponse = await api.request(
    `${sessionPath}/bot-activity?kind=bot_api_call&bot_id=${createdBot.bot.id}`,
  );
  const activity = await activityResponse.json() as {
    entries: { method: string; answer: { error_code?: number } }[];
  };
  const recordedAnswers = activity.entries.map((entry) => [
    entry.method,
    entry.answer.error_code ?? 200,
  ]);
  if (
    JSON.stringify(recordedAnswers) !== JSON.stringify([
      ['sendDocument', 200],
      ['sendDocument', 413],
      ['sendPhoto', 413],
      ['editMessageMedia', 413],
      ['sendRichMessage', 413],
    ])
  ) {
    throw new Error(`Expected the refused calls to be recorded, received ${recordedAnswers}`);
  }
});

Deno.test('a local session lets bots upload documents over 50 MB that getFile cannot serve', async () => {
  const { api, botApiPath, createdAccount, sendText } = await createPrivateConversationFixture({
    upload_profile: 'local',
  });
  await sendText('/start');
  const fileSizeBytes = 50 * 1024 * 1024 + 1;

  const uploaded = await callBotApiWithFiles(api, `${botApiPath}/sendDocument`, {
    chat_id: String(createdAccount.account.id),
  }, { document: new File([new Uint8Array(fileSizeBytes)], 'large.bin') });
  const document = botApiResult(uploaded.body)?.document as Record<string, unknown> | undefined;
  if (uploaded.status !== 200 || document?.file_size !== fileSizeBytes) {
    throw new Error(`Expected the large document to be sent, received ${uploaded.status}`);
  }

  // The local profile changes only upload limits; downloads keep the cloud server's 20 MB cap.
  const download = await callBotApi(api, `${botApiPath}/getFile`, { file_id: document.file_id });
  if (
    download.status !== 400 || !isBadRequestResponse(download.body) ||
    download.body.description !== 'Bad Request: file is too big'
  ) {
    throw new Error(`Expected getFile to refuse the file, received ${JSON.stringify(download)}`);
  }
});

Deno.test('bots send files by URL, which Telegram downloads from registered web resources', async () => {
  const { api, sessionPath, botApiPath, createdBot, createdAccount, sendText } =
    await createPrivateConversationFixture();
  await sendText('/start');
  const chatId = createdAccount.account.id;
  const pdfContent = new TextEncoder().encode('%PDF-1.7 quarterly report');
  const registerWebResource = (body: Record<string, unknown>) =>
    api.request(`${sessionPath}/web-resources`, jsonRequest('POST', body));

  const pdfRegistration = await registerWebResource({
    url: 'https://CDN.example.com/docs/report.pdf',
    content_type: 'application/pdf',
    content_base64: pdfContent.toBase64(),
  });
  const pdfResource = await pdfRegistration.json();
  if (
    pdfRegistration.status !== 201 || JSON.stringify(pdfResource) !== JSON.stringify({
        url: 'https://cdn.example.com/docs/report.pdf',
        status: 200,
        content_type: 'application/pdf',
        content_length: pdfContent.length,
      })
  ) {
    throw new Error(
      `Expected the resource to be registered, received ${JSON.stringify(pdfResource)}`,
    );
  }
  for (
    const body of [
      {
        url: 'https://cdn.example.com/chart.gif',
        content_type: 'image/gif',
        content_base64: gifImage(64, 32).toBase64(),
      },
      { url: 'https://cdn.example.com/latest.pdf', status: 302, location: '/docs/report.pdf' },
      {
        url: 'https://cdn.example.com/notes.txt',
        content_type: 'text/plain',
        content_base64: btoa('notes'),
      },
    ]
  ) {
    const response = await registerWebResource(body);
    if (response.status !== 201) {
      throw new Error(`Expected ${body.url} to be registered, received ${response.status}`);
    }
  }
  for (
    const body of [
      { url: 'ftp://cdn.example.com/report.pdf' },
      { url: 'https://cdn.example.com/a.pdf', status: 100 },
      { url: 'https://cdn.example.com/a.pdf', content_base64: 'not base64!' },
      { url: 'https://cdn.example.com/a.pdf', headers: {} },
    ]
  ) {
    const response = await registerWebResource(body);
    if (response.status !== 400) {
      throw new Error(
        `Expected ${JSON.stringify(body)} to be refused, received ${response.status}`,
      );
    }
  }

  const photo = await callBotApi(api, `${botApiPath}/sendPhoto`, {
    chat_id: chatId,
    photo: 'https://cdn.example.com/chart.gif',
  });
  const photoSize = (botApiResult(photo.body)?.photo as Record<string, unknown>[] | undefined)?.[0];
  const document = await callBotApi(api, `${botApiPath}/sendDocument`, {
    chat_id: chatId,
    document: 'https://cdn.example.com/latest.pdf',
  });
  const documentMessage = botApiResult(document.body);
  const sentDocument = documentMessage?.document as Record<string, unknown> | undefined;
  if (
    photo.status !== 200 || photoSize?.width !== 64 || photoSize.height !== 32 ||
    document.status !== 200 || sentDocument?.file_name !== 'latest.pdf' ||
    sentDocument.mime_type !== 'application/pdf' || sentDocument.file_size !== pdfContent.length
  ) {
    throw new Error(
      `Expected files sent by URL, received ${JSON.stringify([photo.body, document.body])}`,
    );
  }
  const fileResponse = await callBotApi(api, `${botApiPath}/getFile`, {
    file_id: sentDocument.file_id,
  });
  const download = await api.request(
    `${sessionPath}/bot-api/file/bot${createdBot.token}/${
      botApiResult(fileResponse.body)?.file_path
    }`,
  );
  if ((await download.bytes()).toBase64() !== pdfContent.toBase64()) {
    throw new Error('Expected the bot to download the bytes Telegram fetched');
  }

  const edited = await callBotApi(api, `${botApiPath}/editMessageMedia`, {
    chat_id: chatId,
    message_id: documentMessage?.message_id,
    media: { type: 'photo', media: 'https://cdn.example.com/chart.gif' },
  });
  const richMessage = await callBotApi(api, `${botApiPath}/sendRichMessage`, {
    chat_id: chatId,
    rich_message: {
      blocks: [{
        type: 'document',
        document: { type: 'document', media: 'https://cdn.example.com/docs/report.pdf' },
      }],
    },
  });
  if (
    edited.status !== 200 || !Array.isArray(botApiResult(edited.body)?.photo) ||
    richMessage.status !== 200
  ) {
    throw new Error(
      `Expected an edit and a rich message by URL, received ${
        JSON.stringify([edited, richMessage])
      }`,
    );
  }

  const failures = [
    await callBotApi(api, `${botApiPath}/sendDocument`, {
      chat_id: chatId,
      document: 'https://cdn.example.com/missing.pdf',
    }),
    await callBotApi(api, `${botApiPath}/sendDocument`, {
      chat_id: chatId,
      document: 'https://cdn.example.com/notes.txt',
    }),
    await callBotApi(api, `${botApiPath}/sendPhoto`, {
      chat_id: chatId,
      photo: 'ftp://cdn.example.com/chart.gif',
    }),
  ].map(({ status, body }) =>
    status === 400 && isBadRequestResponse(body) ? body.description : status
  );
  if (
    JSON.stringify(failures) !== JSON.stringify([
      'Bad Request: failed to get HTTP URL content',
      'Bad Request: wrong type of the web page content',
      'Bad Request: invalid file HTTP URL specified: Unsupported URL protocol',
    ])
  ) {
    throw new Error(`Expected Telegram's errors, received ${JSON.stringify(failures)}`);
  }

  const historyResponse = await api.request(
    `${sessionPath}/accounts/${chatId}/conversations/private/${createdBot.bot.id}/messages`,
  );
  const history = await historyResponse.json() as { messages: unknown[] };
  if (history.messages.length !== 4) {
    throw new Error(
      `Expected failed sends to leave no messages, received ${history.messages.length}`,
    );
  }
});

Deno.test('sendDocument keeps every upload a document, whatever its content type detection', async () => {
  const { api, botApiPath, createdAccount, sendText } = await createPrivateConversationFixture();
  await sendText('/start');
  // A complete 1x1 GIF image, and an MP4 file's leading `ftyp` box naming the ISO base media
  // format, which content type detection would recognize as an animation and a video.
  const gif = Uint8Array.fromBase64('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7');
  const mp4 = new Uint8Array([
    ...[0, 0, 0, 24],
    ...new TextEncoder().encode('ftypisom'),
    ...[0, 0, 2, 0],
    ...new TextEncoder().encode('isommp41'),
  ]);
  const sentKinds = [];
  for (const file of [new File([gif], 'loop.gif'), new File([mp4], 'clip.mp4')]) {
    for (const disablesDetection of [undefined, 'false', 'true']) {
      const { status, body } = await callBotApiWithFiles(api, `${botApiPath}/sendDocument`, {
        chat_id: String(createdAccount.account.id),
        ...(disablesDetection === undefined
          ? {}
          : { disable_content_type_detection: disablesDetection }),
      }, { document: file });
      const message = botApiResult(body);
      const document = message?.document as Record<string, unknown> | undefined;
      sentKinds.push(
        status === 200 && message !== undefined &&
          !['animation', 'video', 'audio'].some((kind) => kind in message)
          ? document?.mime_type
          : JSON.stringify(body),
      );
    }
  }
  if (
    JSON.stringify(sentKinds) !== JSON.stringify([
      'image/gif',
      'image/gif',
      'image/gif',
      'video/mp4',
      'video/mp4',
      'video/mp4',
    ])
  ) {
    throw new Error(`Expected documents only, received ${JSON.stringify(sentKinds)}`);
  }
});

Deno.test('sendDocument keeps an uploaded thumbnail that bots and accounts see and download', async () => {
  const { api, sessionPath, botApiPath, createdBot, createdAccount, sendText } =
    await createPrivateConversationFixture();
  await sendText('/start');
  const chatId = String(createdAccount.account.id);
  const sendDocument = async (parameters: Record<string, string>, files: Record<string, File>) => {
    const { status, body } = await callBotApiWithFiles(
      api,
      `${botApiPath}/sendDocument`,
      { chat_id: chatId, ...parameters },
      { document: new File(['a,b\n'], 'report.csv'), ...files },
    );
    const document = botApiResult(body)?.document as Record<string, unknown> | undefined;
    if (status !== 200 || document === undefined) {
      throw new Error(`Expected a document to be sent, received ${status} ${JSON.stringify(body)}`);
    }
    return { message: botApiResult(body), document };
  };

  const { message, document } = await sendDocument(
    { thumbnail: 'attach://preview' },
    { preview: new File([gifImage(90, 60)], 'preview.gif') },
  );
  const thumbnail = document.thumbnail as Record<string, unknown> | undefined;
  if (
    JSON.stringify(Object.keys(document)) !== JSON.stringify([
        'file_name',
        'mime_type',
        'thumbnail',
        'thumb',
        'file_id',
        'file_unique_id',
        'file_size',
      ]) ||
    JSON.stringify(document.thumb) !== JSON.stringify(thumbnail) ||
    thumbnail?.width !== 90 || thumbnail.height !== 60 ||
    thumbnail.file_size !== gifImage(90, 60).length || thumbnail.file_id === document.file_id
  ) {
    throw new Error(`Expected the document's thumbnail, received ${JSON.stringify(document)}`);
  }

  const thumbnailFile = await callBotApi(api, `${botApiPath}/getFile`, {
    file_id: thumbnail.file_id,
  });
  const thumbnailPath = botApiResult(thumbnailFile.body)?.file_path;
  const download = await api.request(
    `${sessionPath}/bot-api/file/bot${createdBot.token}/${thumbnailPath}`,
  );
  if (
    thumbnailPath !== 'thumbnails/file_0.gif' || download.status !== 200 ||
    JSON.stringify([...new Uint8Array(await download.arrayBuffer())]) !==
      JSON.stringify([...gifImage(90, 60)])
  ) {
    throw new Error(`Expected the thumbnail to be downloadable, received ${thumbnailPath}`);
  }

  const history = await (await api.request(
    `${sessionPath}/accounts/${chatId}/conversations/private/${createdBot.bot.id}/messages`,
  )).json() as { messages: Array<{ message_id: number; document?: Record<string, unknown> }> };
  const accountThumbnail = history.messages.find(({ message_id }) =>
    message_id === message?.message_id
  )?.document?.thumbnail as Record<string, unknown> | undefined;
  if (
    accountThumbnail?.file_unique_id !== thumbnail.file_unique_id
  ) {
    throw new Error(
      `Expected the account to see the thumbnail, received ${JSON.stringify(history)}`,
    );
  }

  const reusedDocument = await callBotApi(api, `${botApiPath}/sendDocument`, {
    chat_id: chatId,
    document: document.file_id,
  });
  const legacyThumbnail = await sendDocument({}, {
    thumb: new File([gifImage(40, 40)], 'thumb.gif'),
  });
  const oversizedThumbnail = new Uint8Array(200 * 1024);
  oversizedThumbnail.set(gifImage(90, 60));
  const withoutThumbnail = await sendDocument({ thumbnail: 'https://example.com/preview.jpg' }, {
    thumbnail: new File([oversizedThumbnail], 'preview.gif'),
  });
  const reusedThumbnail = (botApiResult(reusedDocument.body)?.document as
    | Record<string, unknown>
    | undefined)?.thumbnail;
  if (
    JSON.stringify(reusedThumbnail) !== JSON.stringify(thumbnail) ||
    (legacyThumbnail.document.thumbnail as Record<string, unknown> | undefined)?.width !== 40 ||
    'thumbnail' in withoutThumbnail.document || 'thumb' in withoutThumbnail.document
  ) {
    throw new Error('Expected reuse to keep the thumbnail, thumb to work, and a large one ignored');
  }

  const thumbnailAsPhoto = await callBotApi(api, `${botApiPath}/sendPhoto`, {
    chat_id: chatId,
    photo: thumbnail.file_id,
  });
  if (
    thumbnailAsPhoto.status !== 400 || !isBadRequestResponse(thumbnailAsPhoto.body) ||
    thumbnailAsPhoto.body.description !== "Bad Request: can't use file of type Thumbnail as Photo"
  ) {
    throw new Error(
      `Expected a thumbnail not to be sent as a photo, received ${
        JSON.stringify(thumbnailAsPhoto.body)
      }`,
    );
  }
});

Deno.test('a bot downloads the files it knows with getFile, and tests read any by unique ID', async () => {
  const { api, sessionPath, botApiPath, createdBot, createdAccount } =
    await createPrivateConversationFixture();
  const image = gifImage(32, 16);
  const sentResponse = await api.request(
    `${sessionPath}/accounts/${createdAccount.account.id}/messages`,
    jsonRequest('POST', {
      to: { type: 'private', botId: createdBot.bot.id },
      photo: { content_base64: image.toBase64() },
      caption: 'My receipt',
    }),
  );
  const sentPhoto = (await sentResponse.json()).message?.photo?.[0];
  const updates = await callBotApi(api, `${botApiPath}/getUpdates`, {});
  const receivedPhoto = photoSizeOf(updateMessages(updates.body)[0]);
  if (
    sentResponse.status !== 201 || receivedPhoto === undefined ||
    receivedPhoto.file_id !== sentPhoto?.file_id ||
    receivedPhoto.file_unique_id !== sentPhoto.file_unique_id
  ) {
    throw new Error(
      `Expected the bot to receive the account photo, received ${JSON.stringify(updates.body)}`,
    );
  }

  const fileResponse = await callBotApi(api, `${botApiPath}/getFile`, {
    file_id: receivedPhoto.file_id,
  });
  const file = botApiResult(fileResponse.body);
  if (
    JSON.stringify(file) !== JSON.stringify({
      file_id: receivedPhoto.file_id,
      file_unique_id: receivedPhoto.file_unique_id,
      file_size: image.length,
      file_path: 'photos/file_0.gif',
    })
  ) {
    throw new Error(`Expected the file with its path, received ${JSON.stringify(fileResponse)}`);
  }
  const download = await api.request(
    `${sessionPath}/bot-api/file/bot${createdBot.token}/photos/file_0.gif`,
  );
  const downloadedContent = new Uint8Array(await download.arrayBuffer());
  const sessionDownload = await api.request(
    `${sessionPath}/files/${receivedPhoto.file_unique_id}`,
  );
  const sessionDownloadedContent = new Uint8Array(await sessionDownload.arrayBuffer());
  if (
    download.status !== 200 || download.headers.get('Content-Type') !== 'image/gif' ||
    downloadedContent.toBase64() !== image.toBase64() ||
    sessionDownload.status !== 200 || sessionDownloadedContent.toBase64() !== image.toBase64()
  ) {
    throw new Error('Expected both downloads to return the photo as sent');
  }

  const getFileFailures = await Promise.all(
    [{}, { file_id: 'unknown' }].map(async (parameters) => {
      const { status, body } = await callBotApi(api, `${botApiPath}/getFile`, parameters);
      return status === 400 && isBadRequestResponse(body) ? body.description : status;
    }),
  );
  const missingDownloads = await Promise.all([
    api.request(`${sessionPath}/bot-api/file/bot${createdBot.token}/photos/file_1.gif`),
    api.request(`${sessionPath}/bot-api/file/bot123:unknown/photos/file_0.gif`),
  ]);
  const missingSessionDownload = await api.request(`${sessionPath}/files/unknown`);
  if (
    JSON.stringify(getFileFailures) !==
      JSON.stringify(['Bad Request: file_id not specified', 'Bad Request: invalid file_id']) ||
    !(await Promise.all(
      missingDownloads.map(async (response) =>
        response.status === 404 && isNotFoundResponse(await response.json(), 'Not Found')
      ),
    )).every(Boolean) ||
    missingSessionDownload.status !== 404
  ) {
    throw new Error('Expected unknown files to be refused as Telegram does');
  }
});

Deno.test('editMessageCaption follows Telegram checks', async () => {
  const { api, botApiPath, createdAccount, sendText } = await createPrivateConversationFixture();
  await sendText('/start');
  const chatId = createdAccount.account.id;
  const sentPhoto = await callBotApiWithFiles(api, `${botApiPath}/sendPhoto`, {
    chat_id: String(chatId),
    caption: 'Pick one',
    reply_markup: JSON.stringify({ inline_keyboard: [[{ text: 'Yes', callback_data: 'yes' }]] }),
  }, { photo: new File([gifImage(8, 8)], 'menu.gif') });
  const photoMessageId = botApiResult(sentPhoto.body)?.message_id;
  const sentText = await callBotApi(api, `${botApiPath}/sendMessage`, {
    chat_id: chatId,
    text: 'Plain',
  });
  const textMessageId = botApiResult(sentText.body)?.message_id;
  if (typeof photoMessageId !== 'number' || typeof textMessageId !== 'number') {
    throw new Error('Expected the photo and the text to be sent');
  }

  const edit = await callBotApi(api, `${botApiPath}/editMessageCaption`, {
    chat_id: chatId,
    message_id: photoMessageId,
    caption: '*Picked*',
    parse_mode: 'MarkdownV2',
    show_caption_above_media: true,
  });
  const editedPhoto = botApiResult(edit.body);
  if (
    edit.status !== 200 || editedPhoto?.caption !== 'Picked' ||
    editedPhoto.show_caption_above_media !== true || typeof editedPhoto.edit_date !== 'number' ||
    'reply_markup' in editedPhoto
  ) {
    throw new Error(`Expected the caption to be edited, received ${JSON.stringify(edit.body)}`);
  }

  const failures = [
    ['editMessageText', { chat_id: chatId, message_id: photoMessageId, text: 'New' }],
    ['editMessageCaption', { chat_id: chatId, message_id: textMessageId, caption: 'New' }],
    [
      'editMessageCaption',
      {
        chat_id: chatId,
        message_id: photoMessageId,
        caption: 'Picked',
        caption_entities: [{ type: 'bold', offset: 0, length: 6 }],
        show_caption_above_media: true,
      },
    ],
    ['editMessageCaption', { caption: 'New' }],
    ['editMessageCaption', { chat_id: chatId, message_id: 999, caption: 'New' }],
  ] as const;
  const descriptions = [];
  for (const [method, parameters] of failures) {
    const { status, body } = await callBotApi(api, `${botApiPath}/${method}`, parameters);
    descriptions.push(status === 400 && isBadRequestResponse(body) ? body.description : status);
  }
  if (
    JSON.stringify(descriptions) !== JSON.stringify([
      'Bad Request: there is no text in the message to edit',
      'Bad Request: there is no caption in the message to edit',
      'Bad Request: message is not modified: specified new message content and reply markup are exactly the same as a current content and reply markup of the message',
      'Bad Request: message identifier is not specified',
      'Bad Request: message to edit not found',
    ])
  ) {
    throw new Error(`Expected Telegram's errors, received ${JSON.stringify(descriptions)}`);
  }
});

Deno.test('editMessageMedia replaces the media of a message', async () => {
  const { api, sessionPath, botApiPath, createdBot, createdAccount, sendText } =
    await createPrivateConversationFixture();
  await sendText('/start');
  const chatId = createdAccount.account.id;
  const sentPhoto = await callBotApiWithFiles(api, `${botApiPath}/sendPhoto`, {
    chat_id: String(chatId),
    caption: 'Old photo',
  }, { photo: new File([gifImage(8, 8)], 'old.gif') });
  const photoMessage = botApiResult(sentPhoto.body);
  const photoFileId = photoSizeOf(photoMessage)?.file_id;
  const sentText = botApiResult(
    (await callBotApi(api, `${botApiPath}/sendMessage`, { chat_id: chatId, text: 'Soon' })).body,
  );
  const editMedia = (messageId: unknown, media: unknown, files: Record<string, File> = {}) =>
    callBotApiWithFiles(api, `${botApiPath}/editMessageMedia`, {
      chat_id: String(chatId),
      message_id: String(messageId),
      media: JSON.stringify(media),
      reply_markup: JSON.stringify({
        inline_keyboard: [[{ text: 'Open', callback_data: 'open' }]],
      }),
    }, files);

  const documentEdit = await editMedia(photoMessage?.message_id, {
    type: 'document',
    media: 'attach://report',
    caption: '<b>Report</b>',
    parse_mode: 'HTML',
  }, { report: new File(['numbers'], 'report.txt', { type: 'text/plain' }) });
  const editedDocument = botApiResult(documentEdit.body);
  const photoEdit = await editMedia(sentText?.message_id, {
    type: 'photo',
    media: photoFileId,
    has_spoiler: true,
    show_caption_above_media: true,
    caption: 'Now a photo',
  });
  const editedText = botApiResult(photoEdit.body);
  const unchangedEdit = await editMedia(sentText?.message_id, {
    type: 'photo',
    media: photoFileId,
    has_spoiler: true,
    show_caption_above_media: true,
    caption: 'Now a photo',
  });
  const keyboard = { inline_keyboard: [[{ text: 'Open', callback_data: 'open' }]] };
  if (
    documentEdit.status !== 200 || 'photo' in (editedDocument ?? {}) ||
    (editedDocument?.document as { file_name?: string } | undefined)?.file_name !==
      'report.txt' ||
    editedDocument?.caption !== 'Report' ||
    JSON.stringify(editedDocument.caption_entities) !==
      JSON.stringify([{ type: 'bold', offset: 0, length: 6 }]) ||
    JSON.stringify(editedDocument.reply_markup) !== JSON.stringify(keyboard) ||
    typeof editedDocument.edit_date !== 'number' ||
    photoEdit.status !== 200 || 'text' in (editedText ?? {}) ||
    photoSizeOf(editedText)?.file_id !== photoFileId || editedText?.has_media_spoiler !== true ||
    editedText.show_caption_above_media !== true || editedText.caption !== 'Now a photo' ||
    !isBadRequestResponse(unchangedEdit.body) ||
    !unchangedEdit.body.description.startsWith('Bad Request: message is not modified')
  ) {
    throw new Error(
      `Expected the media to be replaced, received ${
        JSON.stringify([documentEdit, photoEdit, unchangedEdit])
      }`,
    );
  }
  const updatesBody: unknown = await (await api.request(`${botApiPath}/getUpdates`)).json();
  if (
    !isGetUpdatesResponse(updatesBody) ||
    updatesBody.result.some((update) => 'edited_message' in update)
  ) {
    throw new Error('Expected the bot to receive no update for editing its own message');
  }

  const refusals: Array<[unknown, string]> = [
    [undefined, 'Bad Request: parameter "media" is required'],
    ['{', "Bad Request: can't parse input media JSON object"],
    [[], "Bad Request: can't parse InputMedia: expected an Object"],
    [{ media: photoFileId }, `Bad Request: can't parse InputMedia: Can't find field "type"`],
    [
      { type: 'sticker', media: photoFileId },
      `Bad Request: can't parse InputMedia: type "sticker" is unsupported`,
    ],
    [
      { type: 'video', media: photoFileId },
      'Bad Request: InputMedia of type "video" is not supported',
    ],
    [
      { type: 'photo', media: 'attach://missing' },
      "Bad Request: can't parse InputMedia: media not found",
    ],
    [
      { type: 'photo', media: 'https://grammy.dev/cat.gif' },
      'Bad Request: failed to get HTTP URL content',
    ],
    [
      { type: 'photo', media: photoFileId, caption: '<b>Bold', parse_mode: 'HTML' },
      "Bad Request: can't parse InputMedia: Can't parse entities: Can't find end tag corresponding to start tag \"b\"",
    ],
    [
      { type: 'document', media: photoFileId },
      "Bad Request: can't use file of type Photo as Document",
    ],
    [
      { type: 'document', media: photoFileId, has_spoiler: true },
      'Bad Request: invalid editMessageMedia parameters',
    ],
  ];
  const descriptions = [];
  for (const [media] of refusals) {
    const { body } = await callBotApiWithFiles(api, `${botApiPath}/editMessageMedia`, {
      chat_id: String(chatId),
      message_id: String(photoMessage?.message_id),
      ...(media === undefined
        ? {}
        : { media: typeof media === 'string' ? media : JSON.stringify(media) }),
    }, {});
    descriptions.push(isBadRequestResponse(body) ? body.description : JSON.stringify(body));
  }
  if (
    JSON.stringify(descriptions) !== JSON.stringify(refusals.map(([, description]) => description))
  ) {
    throw new Error(`Expected Telegram's errors, received ${JSON.stringify(descriptions)}`);
  }

  const inlineBot = await createBot(api, sessionPath, 'cats_bot', {
    supports_inline_queries: true,
    receives_chosen_inline_results: true,
  });
  const accountPath = `${sessionPath}/accounts/${chatId}`;
  const chat = { type: 'private', botId: createdBot.bot.id };
  await api.request(
    `${accountPath}/messages`,
    jsonRequest('POST', { to: { type: 'private', botId: inlineBot.bot.id }, text: '/start' }),
  );
  const queryResponse = await api.request(
    `${accountPath}/inline-queries`,
    jsonRequest('POST', { bot_id: inlineBot.bot.id, chat, query: 'cats' }),
  );
  const { inline_query: inlineQuery } = await queryResponse.json() as {
    inline_query: { id: string };
  };
  await callBotApi(api, `${inlineBot.botApiPath}/answerInlineQuery`, {
    inline_query_id: inlineQuery.id,
    results: [{
      type: 'article',
      id: 'cats',
      title: 'Cats',
      input_message_content: { message_text: 'Cats' },
      reply_markup: { inline_keyboard: [[{ text: 'More', callback_data: 'more' }]] },
    }],
  });
  const chosen = await api.request(
    `${accountPath}/inline-queries/${inlineQuery.id}/chosen-results`,
    jsonRequest('POST', { result_id: 'cats' }),
  );
  const { message: inlineMessage } = await chosen.json() as { message: { message_id: number } };
  const inlineMessageId = await (async () => {
    const updates = await (await api.request(`${inlineBot.botApiPath}/getUpdates`)).json() as {
      result: Array<{ chosen_inline_result?: { inline_message_id?: string } }>;
    };
    return updates.result.find((update) => update.chosen_inline_result !== undefined)
      ?.chosen_inline_result?.inline_message_id;
  })();
  const inlinePhoto = botApiResult(
    (await callBotApiWithFiles(api, `${inlineBot.botApiPath}/sendPhoto`, {
      chat_id: String(chatId),
    }, { photo: new File([gifImage(4, 4)], 'cat.gif') })).body,
  );
  const editInline = (media: unknown, files: Record<string, File> = {}) =>
    callBotApiWithFiles(api, `${inlineBot.botApiPath}/editMessageMedia`, {
      inline_message_id: String(inlineMessageId),
      media: JSON.stringify(media),
    }, files);
  const inlineUpload = await editInline(
    { type: 'photo', media: 'attach://cat' },
    { cat: new File([gifImage(4, 4)], 'cat.gif') },
  );
  const inlineEdit = await editInline({ type: 'photo', media: photoSizeOf(inlinePhoto)?.file_id });
  // A file sent by URL is not an upload, so it may replace an inline message's media.
  await api.request(
    `${sessionPath}/web-resources`,
    jsonRequest('POST', {
      url: 'https://cdn.example.com/cat.gif',
      content_type: 'image/gif',
      content_base64: gifImage(7, 5).toBase64(),
    }),
  );
  const inlineUrlEdit = await editInline({
    type: 'photo',
    media: 'https://cdn.example.com/cat.gif',
  });
  const history = await (await api.request(
    `${accountPath}/conversations/private/${createdBot.bot.id}/messages`,
  )).json() as { messages: Array<Record<string, unknown>> };
  const editedInlineMessage = history.messages.find(({ message_id }) =>
    message_id === inlineMessage.message_id
  );
  if (
    !isBadRequestResponse(inlineUpload.body) ||
    inlineUpload.body.description !== 'Bad Request: invalid message content specified' ||
    JSON.stringify(inlineEdit.body) !== JSON.stringify({ ok: true, result: true }) ||
    JSON.stringify(inlineUrlEdit.body) !== JSON.stringify({ ok: true, result: true }) ||
    (editedInlineMessage?.photo as { width: number }[] | undefined)?.[0]?.width !== 7
  ) {
    throw new Error(
      `Expected an inline message's media to be replaced by file_id or URL, received ${
        JSON.stringify([inlineUpload, inlineEdit, inlineUrlEdit, editedInlineMessage])
      }`,
    );
  }
});

Deno.test('editMessageMedia replaces the media of a supergroup message', async () => {
  const { api, owner, bot, supergroup, supergroupPath } = await createSupergroupFixture();
  const sent = await callBotApiWithFiles(api, `${bot.botApiPath}/sendDocument`, {
    chat_id: String(supergroup.id),
  }, { document: new File(['draft'], 'draft.txt') });
  const edit = await callBotApiWithFiles(api, `${bot.botApiPath}/editMessageMedia`, {
    chat_id: String(supergroup.id),
    message_id: String(botApiResult(sent.body)?.message_id),
    media: JSON.stringify({ type: 'photo', media: 'attach://chart', caption: 'Chart' }),
  }, { chart: new File([gifImage(6, 3)], 'chart.gif') });
  const history = await (await api.request(`${supergroupPath(owner.id)}/messages`)).json() as {
    messages: Array<Record<string, unknown>>;
  };
  const editedMessage = history.messages.at(-1);
  if (
    edit.status !== 200 || editedMessage?.caption !== 'Chart' || 'document' in editedMessage ||
    (photoSizeOf(editedMessage) as { width?: number } | undefined)?.width !== 6
  ) {
    throw new Error(
      `Expected members to see the new photo, received ${JSON.stringify([edit, editedMessage])}`,
    );
  }
});

Deno.test('account message routes send and edit photos and documents', async () => {
  const { api, sessionPath, botApiPath, createdBot, createdAccount } =
    await createPrivateConversationFixture();
  const accountPath = `${sessionPath}/accounts/${createdAccount.account.id}`;
  const to = { type: 'private', botId: createdBot.bot.id };
  const sendAccountMessage = async (body: unknown) => {
    const response = await api.request(`${accountPath}/messages`, jsonRequest('POST', body));
    return {
      status: response.status,
      body: response.status === 201 ? await response.json() : null,
    };
  };

  const sentDocument = await sendAccountMessage({
    to,
    document: { content_base64: new TextEncoder().encode('notes').toBase64(), file_name: 'a.txt' },
  });
  const rejectedStatuses = await Promise.all([
    { to, photo: { content_base64: 'not base64!' } },
    { to, photo: { content_base64: new TextEncoder().encode('text').toBase64() } },
    { to, photo: { content_base64: '' } },
    { to, text: 'Hello', photo: { content_base64: gifImage(1, 1).toBase64() } },
    { to, document: { content_base64: 'AA==', file_name: '' } },
  ].map(async (body) => (await sendAccountMessage(body)).status));
  const documentMessage = sentDocument.body?.message;
  if (
    sentDocument.status !== 201 || documentMessage?.document?.mime_type !== 'text/plain' ||
    'caption' in documentMessage ||
    JSON.stringify(rejectedStatuses) !== JSON.stringify([400, 400, 400, 400, 400])
  ) {
    throw new Error(
      `Expected a document and rejected invalid media, received ${
        JSON.stringify({ sentDocument, rejectedStatuses })
      }`,
    );
  }

  const messagePath =
    `${accountPath}/conversations/private/${createdBot.bot.id}/messages/${documentMessage.message_id}`;
  const textEdit = await api.request(messagePath, jsonRequest('PATCH', { text: 'Notes' }));
  const captionEdit = await api.request(messagePath, jsonRequest('PATCH', { caption: '/help' }));
  const editedDocument = (await captionEdit.json()).message;
  const updates = await callBotApi(api, `${botApiPath}/getUpdates`, {});
  const lastUpdateMessage = updateMessages(updates.body).at(-1);
  if (
    textEdit.status !== 400 || captionEdit.status !== 200 || editedDocument.caption !== '/help' ||
    lastUpdateMessage?.caption !== '/help' ||
    JSON.stringify(lastUpdateMessage.document) !== JSON.stringify(documentMessage.document)
  ) {
    throw new Error(`Expected a caption edit, received ${JSON.stringify(updates.body)}`);
  }
});

Deno.test('a grammY bot downloads a document from an account and replies with a photo', async () => {
  const { api, sessionPath, createdBot, createdAccount } = await createPrivateConversationFixture();
  const csv = 'item,price\ncoffee,3\n';
  const sentResponse = await api.request(
    `${sessionPath}/accounts/${createdAccount.account.id}/messages`,
    jsonRequest('POST', {
      to: { type: 'private', botId: createdBot.bot.id },
      document: { content_base64: new TextEncoder().encode(csv).toBase64(), file_name: 'a.csv' },
      caption: 'Please chart this',
    }),
  );
  if (sentResponse.status !== 201) {
    throw new Error(`Expected the document to be sent, received ${sentResponse.status}`);
  }

  const apiRoot = `http://emulator.example:9000${sessionPath}/bot-api`;
  const fetch = createInProcessFetch(api.fetch);
  const grammyBot = new Bot(createdBot.token, { client: { apiRoot, fetch } });
  const downloadedTexts: string[] = [];
  const replied = Promise.withResolvers<void>();
  grammyBot.on('message:document', async (context) => {
    const file = await context.getFile();
    const download = await fetch(`${apiRoot}/file/bot${createdBot.token}/${file.file_path}`);
    downloadedTexts.push(await download.text());
    await context.replyWithPhoto(new InputFile(gifImage(300, 200), 'chart.gif'), {
      caption: `Chart of ${context.msg.document.file_name}`,
      reply_parameters: { message_id: context.msg.message_id },
    });
    replied.resolve();
  });
  const polling = grammyBot.start();
  await Promise.race([replied.promise, polling]);
  await grammyBot.stop();
  await polling;

  const historyBody = await (await api.request(
    `${sessionPath}/accounts/${createdAccount.account.id}/conversations/private/${createdBot.bot.id}/messages`,
  )).json();
  const reply = historyBody.messages.at(-1);
  if (
    JSON.stringify(downloadedTexts) !== JSON.stringify([csv]) ||
    reply?.caption !== 'Chart of a.csv' || reply.photo?.[0]?.width !== 300 ||
    reply.reply_to_message?.document?.file_name !== 'a.csv'
  ) {
    throw new Error(`Expected the bot to reply with a chart, received ${JSON.stringify(reply)}`);
  }
});

Deno.test('an account sends an inline query, a bot answers, and the account sends a result', async () => {
  const api = createEmulationApi({
    sessionLifecycle: createSessionLifecycleService(),
    publicOrigin: 'http://emulator.example:9000',
  });
  const sessionPath = (await api.request('/sessions', { method: 'POST' })).headers.get('Location');
  if (sessionPath === null) {
    throw new Error('Expected the created session to have a Location');
  }
  const account = await createAccount(api, sessionPath, 'Ada');
  const inlineBot = await createBot(api, sessionPath, 'cats_bot', {
    supports_inline_queries: true,
    receives_chosen_inline_results: true,
  });
  const otherBot = await createBot(api, sessionPath, 'other_bot');
  const readUpdates = createUpdateReader(api);
  const accountPath = `${sessionPath}/accounts/${account.id}`;
  const getMeResponse = await callBotApi(api, `${inlineBot.botApiPath}/getMe`, {});
  if (botApiResult(getMeResponse.body)?.supports_inline_queries !== true) {
    throw new Error('Expected getMe to report inline mode');
  }

  const queryResponse = await api.request(
    `${accountPath}/inline-queries`,
    jsonRequest('POST', {
      bot_id: inlineBot.bot.id,
      chat: { type: 'private', botId: inlineBot.bot.id },
      query: 'cats',
    }),
  );
  const queryBody = await queryResponse.json() as { inline_query: { id: string } };
  const inlineQueryPath = `${accountPath}/inline-queries/${queryBody.inline_query.id}`;
  if (
    queryResponse.status !== 201 || queryResponse.headers.get('Location') !== inlineQueryPath ||
    JSON.stringify(queryBody) !== JSON.stringify({
        inline_query: {
          id: queryBody.inline_query.id,
          bot_id: inlineBot.bot.id,
          chat: { type: 'private', botId: inlineBot.bot.id },
          query: 'cats',
          offset: '',
          status: 'awaiting_answer',
          answer: null,
        },
      })
  ) {
    throw new Error(`Expected an unanswered inline query, received ${JSON.stringify(queryBody)}`);
  }
  const [queryUpdate] = await readUpdates(inlineBot.botApiPath);
  if (
    JSON.stringify(queryUpdate?.inline_query) !== JSON.stringify({
      id: queryBody.inline_query.id,
      from: account,
      chat_type: 'sender',
      query: 'cats',
      offset: '',
    })
  ) {
    throw new Error(`Expected an inline_query update, received ${JSON.stringify(queryUpdate)}`);
  }

  const answerResponse = await callBotApi(api, `${inlineBot.botApiPath}/answerInlineQuery`, {
    inline_query_id: queryBody.inline_query.id,
    results: [{
      type: 'article',
      id: 'fact-1',
      title: 'Cat fact',
      description: 'Cats sleep a lot',
      input_message_content: { message_text: '*Cats* sleep a lot', parse_mode: 'MarkdownV2' },
      reply_markup: { inline_keyboard: [[{ text: 'More', callback_data: 'more' }]] },
    }],
    button: { text: 'Sign in', start_parameter: 'sign-in' },
  });
  if (JSON.stringify(answerResponse.body) !== JSON.stringify({ ok: true, result: true })) {
    throw new Error(`Expected the answer to be accepted, received ${answerResponse.status}`);
  }
  const answeredBody = await (await api.request(inlineQueryPath)).json() as {
    inline_query: { status: string; answer: unknown };
  };
  if (
    answeredBody.inline_query.status !== 'answered' ||
    JSON.stringify(answeredBody.inline_query.answer) !== JSON.stringify({
        results: [
          { type: 'article', id: 'fact-1', title: 'Cat fact', description: 'Cats sleep a lot' },
        ],
        cache_time: 300,
        is_personal: false,
        next_offset: '',
        button: { text: 'Sign in', start_parameter: 'sign-in' },
      })
  ) {
    throw new Error(
      `Expected the account to see the answer, received ${JSON.stringify(answeredBody)}`,
    );
  }

  const chooseResponse = await api.request(
    `${inlineQueryPath}/chosen-results`,
    jsonRequest('POST', { result_id: 'fact-1' }),
  );
  const { message } = await chooseResponse.json() as { message: Record<string, unknown> };
  if (
    chooseResponse.status !== 201 || JSON.stringify(message.from) !== JSON.stringify(account) ||
    message.text !== 'Cats sleep a lot' ||
    JSON.stringify(message.entities) !== JSON.stringify([{ type: 'bold', offset: 0, length: 4 }]) ||
    JSON.stringify(message.via_bot) !== JSON.stringify({
        id: inlineBot.bot.id,
        is_bot: true,
        first_name: 'Test Bot',
        username: 'cats_bot',
      }) ||
    JSON.stringify(Object.keys(message).slice(-2)) !== JSON.stringify(['reply_markup', 'via_bot'])
  ) {
    throw new Error(
      `Expected the account's message through the bot, received ${JSON.stringify(message)}`,
    );
  }
  const [messageUpdate, chosenResultUpdate] = await readUpdates(inlineBot.botApiPath);
  const chosenResult = chosenResultUpdate?.chosen_inline_result as Record<string, unknown>;
  const inlineMessageId = chosenResult?.inline_message_id;
  if (
    JSON.stringify(messageUpdate?.message) !== JSON.stringify(message) ||
    typeof inlineMessageId !== 'string' ||
    JSON.stringify(chosenResult) !== JSON.stringify({
        from: account,
        inline_message_id: inlineMessageId,
        query: 'cats',
        result_id: 'fact-1',
      })
  ) {
    throw new Error('Expected the message and then the chosen result');
  }

  const accountEditResponse = await api.request(
    `${accountPath}/conversations/private/${inlineBot.bot.id}/messages/${message.message_id}`,
    jsonRequest('PATCH', { text: 'Dogs sleep a lot' }),
  );
  if (accountEditResponse.status !== 400) {
    throw new Error('Expected only the inline bot to edit a message sent through it');
  }

  const pressResponse = await api.request(
    `${accountPath}/callback-queries`,
    jsonRequest('POST', {
      chat: { type: 'private', botId: inlineBot.bot.id },
      message_id: message.message_id,
      callback_data: 'more',
    }),
  );
  const [callbackQueryUpdate] = await readUpdates(inlineBot.botApiPath);
  const callbackQuery = callbackQueryUpdate?.callback_query as Record<string, unknown>;
  if (
    pressResponse.status !== 201 ||
    JSON.stringify(Object.keys(callbackQuery ?? {})) !==
      JSON.stringify(['id', 'from', 'inline_message_id', 'chat_instance', 'data']) ||
    callbackQuery.inline_message_id !== inlineMessageId
  ) {
    throw new Error(`Expected an inline callback query, received ${JSON.stringify(callbackQuery)}`);
  }

  const editResponse = await callBotApi(api, `${inlineBot.botApiPath}/editMessageText`, {
    inline_message_id: inlineMessageId,
    text: 'Cats also purr',
  });
  if (JSON.stringify(editResponse.body) !== JSON.stringify({ ok: true, result: true })) {
    throw new Error(`Expected the inline edit to answer true, received ${editResponse.status}`);
  }
  const [editUpdate] = await readUpdates(inlineBot.botApiPath);
  const editedMessage = editUpdate?.edited_message as Record<string, unknown> | undefined;
  if (
    editedMessage?.text !== 'Cats also purr' || editedMessage.reply_markup !== undefined ||
    typeof editedMessage.edit_date !== 'number'
  ) {
    throw new Error(
      `Expected the chat's bot to see the edit, received ${JSON.stringify(editUpdate)}`,
    );
  }

  const failures = await Promise.all([
    callBotApi(api, `${inlineBot.botApiPath}/editMessageText`, {
      inline_message_id: inlineMessageId,
      text: 'Cats also purr',
    }),
    callBotApi(api, `${otherBot.botApiPath}/editMessageText`, {
      inline_message_id: inlineMessageId,
      text: 'Dogs',
    }),
    callBotApi(api, `${inlineBot.botApiPath}/editMessageReplyMarkup`, {
      inline_message_id: 'unknown',
    }),
    callBotApi(api, `${inlineBot.botApiPath}/editMessageCaption`, {
      inline_message_id: inlineMessageId,
      caption: 'A cat',
    }),
    callBotApi(api, `${inlineBot.botApiPath}/editMessageText`, { text: 'Cats' }),
  ]);
  const failureDescriptions = failures.map(({ body }) =>
    isBadRequestResponse(body) ? body.description : JSON.stringify(body)
  );
  if (
    JSON.stringify(failureDescriptions) !== JSON.stringify([
      'Bad Request: message is not modified: specified new message content and reply markup are exactly the same as a current content and reply markup of the message',
      'Bad Request: MESSAGE_ID_INVALID',
      'Bad Request: MESSAGE_ID_INVALID',
      'Bad Request: there is no caption in the message to edit',
      'Bad Request: message identifier is not specified',
    ])
  ) {
    throw new Error(`Expected Telegram's inline edit errors, received ${failureDescriptions}`);
  }

  // As in TDLib, the inline bot also edits the message by its chat, which answers the message.
  const chatEditResponse = await callBotApi(api, `${inlineBot.botApiPath}/editMessageText`, {
    chat_id: account.id,
    message_id: message.message_id,
    text: 'Cats',
  });
  const chatEditResult = botApiResult(chatEditResponse.body);
  if (
    chatEditResponse.status !== 200 || chatEditResult === undefined ||
    chatEditResult.message_id !== message.message_id ||
    chatEditResult.text !== 'Cats' ||
    JSON.stringify(chatEditResult.from) !== JSON.stringify(message.from) ||
    JSON.stringify(chatEditResult.via_bot) !== JSON.stringify(message.via_bot)
  ) {
    throw new Error(
      `Expected the inline bot to edit the message by its chat, received ${
        JSON.stringify(chatEditResponse.body)
      }`,
    );
  }
});

Deno.test('repeated inline queries reuse the answer within its cache time', async () => {
  const api = createEmulationApi({
    sessionLifecycle: createSessionLifecycleService(),
    publicOrigin: 'http://emulator.example:9000',
  });
  const sessionPath = (await api.request('/sessions', { method: 'POST' })).headers.get('Location');
  if (sessionPath === null) {
    throw new Error('Expected the created session to have a Location');
  }
  const ada = await createAccount(api, sessionPath, 'Ada');
  const grace = await createAccount(api, sessionPath, 'Grace');
  const inlineBot = await createBot(api, sessionPath, 'cats_bot', {
    supports_inline_queries: true,
  });
  const readUpdates = createUpdateReader(api);
  const sendQuery = async (accountId: number) => {
    const response = await api.request(
      `${sessionPath}/accounts/${accountId}/inline-queries`,
      jsonRequest('POST', {
        bot_id: inlineBot.bot.id,
        chat: { type: 'private', botId: inlineBot.bot.id },
        query: 'cats',
      }),
    );
    return (await response.json() as {
      inline_query: { id: string; status: string; answer: { results: unknown[] } | null };
    }).inline_query;
  };
  const answer = (inlineQueryId: string, isPersonal: boolean) =>
    callBotApi(api, `${inlineBot.botApiPath}/answerInlineQuery`, {
      inline_query_id: inlineQueryId,
      results: [{
        type: 'article',
        id: 'fact-1',
        title: 'Cat fact',
        input_message_content: { message_text: 'Cats sleep a lot' },
      }],
      is_personal: isPersonal,
    });

  await answer((await sendQuery(ada.id)).id, true);
  const adaRepeat = await sendQuery(ada.id);
  const graceQuery = await sendQuery(grace.id);
  const updates = await readUpdates(inlineBot.botApiPath);
  if (
    adaRepeat.status !== 'answered' || adaRepeat.answer?.results.length !== 1 ||
    graceQuery.status !== 'awaiting_answer' ||
    JSON.stringify(
        updates.map((update) => (update.inline_query as { from: { id: number } }).from.id),
      ) !==
      JSON.stringify([ada.id, grace.id])
  ) {
    throw new Error(
      `Expected the personal answer to be reused only for Ada, received ${JSON.stringify(updates)}`,
    );
  }

  await answer(graceQuery.id, false);
  const reusedForAda = await sendQuery(ada.id);
  const answerToCachedQuery = await answer(reusedForAda.id, false);
  if (
    reusedForAda.status !== 'answered' ||
    (await readUpdates(inlineBot.botApiPath)).length !== 0 ||
    !isBadRequestResponse(answerToCachedQuery.body) ||
    answerToCachedQuery.body.description !==
      'Bad Request: query is too old and response timeout expired or query ID is invalid'
  ) {
    throw new Error('Expected the shared answer to be reused without asking the bot');
  }
});

Deno.test('accounts share their location with inline bots that request it', async () => {
  const api = createEmulationApi({
    sessionLifecycle: createSessionLifecycleService(),
    publicOrigin: 'http://emulator.example:9000',
  });
  const sessionPath = (await api.request('/sessions', { method: 'POST' })).headers.get('Location');
  if (sessionPath === null) {
    throw new Error('Expected the created session to have a Location');
  }
  const account = await createAccount(api, sessionPath, 'Ada');
  const nearbyBot = await createBot(api, sessionPath, 'nearby_bot', {
    supports_inline_queries: true,
    receives_chosen_inline_results: true,
    requests_inline_location: true,
  });
  const plainBot = await createBot(api, sessionPath, 'cats_bot', {
    supports_inline_queries: true,
  });
  const readUpdates = createUpdateReader(api);
  const sendQuery = (botId: number, location?: unknown) =>
    api.request(
      `${sessionPath}/accounts/${account.id}/inline-queries`,
      jsonRequest('POST', {
        bot_id: botId,
        chat: { type: 'private', botId },
        query: 'cafes',
        ...(location === undefined ? {} : { location }),
      }),
    );

  const queryResponse = await sendQuery(nearbyBot.bot.id, {
    latitude: 51.50073,
    longitude: -0.12463,
    horizontal_accuracy: 12.3,
  });
  const { inline_query: inlineQuery } = await queryResponse.json() as {
    inline_query: { id: string; location?: unknown };
  };
  const expectedLocation = { latitude: 51.50073, longitude: -0.12463, horizontal_accuracy: 13 };
  const [queryUpdate] = await readUpdates(nearbyBot.botApiPath);
  if (
    queryResponse.status !== 201 ||
    JSON.stringify(inlineQuery.location) !== JSON.stringify(expectedLocation) ||
    JSON.stringify(queryUpdate?.inline_query) !== JSON.stringify({
        id: inlineQuery.id,
        from: account,
        location: expectedLocation,
        chat_type: 'sender',
        query: 'cafes',
        offset: '',
      })
  ) {
    throw new Error(
      `Expected the bot to receive the account's location, received ${JSON.stringify(queryUpdate)}`,
    );
  }

  await callBotApi(api, `${nearbyBot.botApiPath}/answerInlineQuery`, {
    inline_query_id: inlineQuery.id,
    results: [{
      type: 'article',
      id: 'cafe-1',
      title: 'Corner cafe',
      input_message_content: { message_text: 'Corner cafe' },
    }],
  });
  await api.request(
    `${sessionPath}/accounts/${account.id}/inline-queries/${inlineQuery.id}/chosen-results`,
    jsonRequest('POST', { result_id: 'cafe-1' }),
  );
  const [, chosenResultUpdate] = await readUpdates(nearbyBot.botApiPath);
  if (
    JSON.stringify(chosenResultUpdate?.chosen_inline_result) !== JSON.stringify({
      from: account,
      location: expectedLocation,
      query: 'cafes',
      result_id: 'cafe-1',
    })
  ) {
    throw new Error(
      `Expected the chosen result to carry the location, received ${
        JSON.stringify(chosenResultUpdate)
      }`,
    );
  }

  // As TDLib keys a query's place in ten-thousandths of a degree, a nearby query reuses the
  // answer, while one from elsewhere or without a location reaches the bot.
  const statuses = [];
  for (
    const location of [
      { latitude: 51.500739, longitude: -0.124631 },
      { latitude: 51.5008, longitude: -0.12463 },
      undefined,
    ]
  ) {
    const response = await sendQuery(nearbyBot.bot.id, location);
    statuses.push(
      (await response.json() as { inline_query: { status: string } }).inline_query
        .status,
    );
  }
  if (
    JSON.stringify(statuses) !==
      JSON.stringify(['answered', 'awaiting_answer', 'awaiting_answer']) ||
    (await readUpdates(nearbyBot.botApiPath)).length !== 2
  ) {
    throw new Error(`Expected the answer reused only at the same place, received ${statuses}`);
  }

  const unrequestedLocation = await sendQuery(plainBot.bot.id, { latitude: 0, longitude: 0 });
  const invalidLocations: unknown[] = [
    { latitude: 91, longitude: 0 },
    { latitude: 0, longitude: -181 },
    { latitude: 0, longitude: 0, horizontal_accuracy: 1501 },
    { latitude: '51.5', longitude: 0 },
    { latitude: 0 },
  ];
  const invalidStatuses = [];
  for (const location of invalidLocations) {
    invalidStatuses.push((await sendQuery(nearbyBot.bot.id, location)).status);
  }
  if (
    unrequestedLocation.status !== 409 ||
    invalidStatuses.some((status) => status !== 400)
  ) {
    throw new Error(
      `Expected unrequested and invalid locations to be refused, received ${
        JSON.stringify([unrequestedLocation.status, invalidStatuses])
      }`,
    );
  }
});

Deno.test('answerInlineQuery and the inline query routes follow Telegram checks', async () => {
  const { api, sessionPath, createdBot: plainBot, createdAccount, sendText } =
    await createPrivateConversationFixture();
  const accountPath = `${sessionPath}/accounts/${createdAccount.account.id}`;
  const inlineBot = await createBot(api, sessionPath, 'cats_bot', {
    supports_inline_queries: true,
  });
  const sendQuery = async (body: Record<string, unknown>) =>
    await api.request(`${accountPath}/inline-queries`, jsonRequest('POST', body));
  const privateChat = { type: 'private', botId: inlineBot.bot.id };

  const queryFailures = await Promise.all([
    sendQuery({ bot_id: plainBot.bot.id, chat: privateChat, query: 'cats' }),
    sendQuery({ bot_id: 999, chat: privateChat, query: 'cats' }),
    sendQuery({
      bot_id: inlineBot.bot.id,
      chat: { type: 'supergroup', chatId: -1_000_000_000_999 },
    }),
    sendQuery({ bot_id: inlineBot.bot.id, chat: privateChat, query: 'a'.repeat(257) }),
    api.request(
      `${sessionPath}/accounts/999/inline-queries`,
      jsonRequest('POST', {
        bot_id: inlineBot.bot.id,
        chat: privateChat,
      }),
    ),
  ]);
  if (
    JSON.stringify(queryFailures.map((response) => response.status)) !==
      JSON.stringify([409, 404, 404, 400, 404])
  ) {
    throw new Error(
      `Expected inline queries to be refused, received ${
        queryFailures.map((response) => response.status)
      }`,
    );
  }

  const queryResponse = await sendQuery({ bot_id: inlineBot.bot.id, chat: privateChat, query: '' });
  const inlineQueryId = (await queryResponse.json() as { inline_query: { id: string } })
    .inline_query.id;
  const inlineQueryPath = `${accountPath}/inline-queries/${inlineQueryId}`;
  const choose = async (resultId: string) =>
    (await api.request(
      `${inlineQueryPath}/chosen-results`,
      jsonRequest('POST', { result_id: resultId }),
    )).status;
  if ((await choose('1')) !== 409) {
    throw new Error('Expected an unanswered query to have no result to send');
  }

  const article = (id: string, extra: Record<string, unknown> = {}) => ({
    type: 'article',
    id,
    title: `Result ${id}`,
    input_message_content: { message_text: `Result ${id}` },
    ...extra,
  });
  const answer = async (parameters: Record<string, unknown>) => {
    const { body } = await callBotApi(api, `${inlineBot.botApiPath}/answerInlineQuery`, {
      inline_query_id: inlineQueryId,
      ...parameters,
    });
    return isBadRequestResponse(body) ? body.description : JSON.stringify(body);
  };
  const answerFailures = [
    await answer({ results: [article('1'), article('1')] }),
    await answer({ results: Array.from({ length: 51 }, (_, index) => article(String(index))) }),
    await answer({ results: [{ ...article('1'), type: 'GIF' }] }),
    await answer({ results: [{ ...article('1'), type: 'poll' }] }),
    await answer({ results: [{ ...article('1'), input_message_content: { message_text: '' } }] }),
    await answer({
      results: [article('1', { input_message_content: { latitude: 1, longitude: 2 } })],
    }),
    await answer({
      results: [
        article('1', { input_message_content: { message_text: 'a.b', parse_mode: 'MarkdownV2' } }),
      ],
    }),
    await answer({
      results: [{ type: 'photo', id: '1', photo_url: 'https://example.com/cat.jpg' }],
    }),
    await answer({ results: [{ type: 'photo', id: '1', photo_file_id: 'unknown' }] }),
    await answer({ results: [{ type: 'document', id: '1', title: '', document_file_id: 'x' }] }),
    await answer({ results: [article('1')], button: { text: 'Sign in', start_parameter: 'a b' } }),
    await answer({ results: [article('1')], next_offset: 'a'.repeat(65) }),
    await answer({ results: [article('')] }),
    await answer({
      results: [article('1', { reply_markup: { inline_keyboard: [[{ text: 'Go', url: 'go' }]] } })],
    }),
    await answer({ results: 'not JSON' }),
    await answer({ inline_query_id: '999', results: [article('1')] }),
  ];
  if (
    JSON.stringify(answerFailures) !== JSON.stringify([
      'Bad Request: RESULT_ID_DUPLICATE',
      'Bad Request: too many inline query results specified',
      'Bad Request: inline query results of type "gif" are not supported',
      `Bad Request: can't parse InlineQueryResult: type "poll" is unsupported for the inline query result`,
      "Bad Request: can't parse InlineQueryResult: Input message content is not specified",
      'Bad Request: inline query results sending a location, venue, contact, or invoice are not supported',
      "Bad Request: can't parse InlineQueryResult: Can't parse entities: Character '.' is reserved and must be escaped with the preceding '\\'",
      'Bad Request: sending files by URL is not supported',
      "Bad Request: wrong remote file identifier specified: can't unserialize it",
      "Bad Request: wrong remote file identifier specified: can't unserialize it",
      'Bad Request: unallowed characters in start_parameter are used',
      'Bad Request: NEXT_OFFSET_INVALID',
      'Bad Request: RESULT_ID_EMPTY',
      "Bad Request: inline keyboard button URL 'go' is invalid: Wrong HTTP URL",
      'Bad Request: invalid answerInlineQuery parameters',
      'Bad Request: query is too old and response timeout expired or query ID is invalid',
    ])
  ) {
    throw new Error(`Expected Telegram's answerInlineQuery errors, received ${answerFailures}`);
  }

  if (
    (await answer({ results: [article('1')], cache_time: 100_000, is_personal: true })) !==
      JSON.stringify({ ok: true, result: true }) ||
    (await answer({ results: [article('2')] })) !==
      'Bad Request: query is too old and response timeout expired or query ID is invalid'
  ) {
    throw new Error('Expected the query to be answered only once');
  }
  const answeredBody = await (await api.request(inlineQueryPath)).json() as {
    inline_query: { answer: { cache_time: number; is_personal: boolean } };
  };
  if (
    answeredBody.inline_query.answer.cache_time !== 86_400 ||
    !answeredBody.inline_query.answer.is_personal
  ) {
    throw new Error('Expected cache_time to be clamped to a day');
  }

  await sendText('/start');
  const blockResponse = await api.request(`${accountPath}/blocked-bots/${inlineBot.bot.id}`, {
    method: 'PUT',
  });
  const chooseFailures = [
    await choose('unknown'),
    await choose('1'),
    (await api.request(
      `${accountPath}/inline-queries/999/chosen-results`,
      jsonRequest('POST', { result_id: '1' }),
    )).status,
    (await api.request(
      `${sessionPath}/accounts/${plainBot.bot.id}/inline-queries/${inlineQueryId}`,
    ))
      .status,
  ];
  if (
    blockResponse.status !== 204 ||
    JSON.stringify(chooseFailures) !== JSON.stringify([400, 409, 404, 404])
  ) {
    throw new Error(`Expected results to be refused, received ${chooseFailures}`);
  }
});

Deno.test('inline query results send rich messages that reuse files', async () => {
  const api = createEmulationApi({
    sessionLifecycle: createSessionLifecycleService(),
    publicOrigin: 'http://emulator.example:9000',
  });
  const sessionPath = (await api.request('/sessions', { method: 'POST' })).headers.get('Location');
  if (sessionPath === null) {
    throw new Error('Expected the created session to have a Location');
  }
  const account = await createAccount(api, sessionPath, 'Ada');
  const inlineBot = await createBot(api, sessionPath, 'cats_bot', {
    supports_inline_queries: true,
    receives_chosen_inline_results: true,
  });
  const accountPath = `${sessionPath}/accounts/${account.id}`;
  const chat = { type: 'private', botId: inlineBot.bot.id };
  await api.request(`${accountPath}/messages`, jsonRequest('POST', { to: chat, text: '/start' }));
  const photoFileId = photoSizeOf(botApiResult(
    (await callBotApiWithFiles(api, `${inlineBot.botApiPath}/sendPhoto`, {
      chat_id: String(account.id),
    }, { photo: new File([gifImage(4, 4)], 'cat.gif') })).body,
  ))?.file_id;
  const sendQuery = async () => {
    const response = await api.request(
      `${accountPath}/inline-queries`,
      jsonRequest('POST', { bot_id: inlineBot.bot.id, chat, query: `cats ${crypto.randomUUID()}` }),
    );
    return (await response.json() as { inline_query: { id: string } }).inline_query.id;
  };
  const answer = (inlineQueryId: string, richMessage: unknown, files: Record<string, File> = {}) =>
    callBotApiWithFiles(api, `${inlineBot.botApiPath}/answerInlineQuery`, {
      inline_query_id: inlineQueryId,
      results: JSON.stringify([{
        type: 'article',
        id: 'cats',
        title: 'Cats',
        input_message_content: { rich_message: richMessage },
      }]),
    }, files);

  const inlineQueryId = await sendQuery();
  const answered = await answer(inlineQueryId, {
    blocks: [
      { type: 'paragraph', text: 'Cats at grammy.dev' },
      { type: 'photo', photo: { type: 'photo', media: photoFileId } },
      { type: 'buttons', buttons: [{ text: 'More', callback_data: 'more' }] },
    ],
  });
  const chosen = await api.request(
    `${accountPath}/inline-queries/${inlineQueryId}/chosen-results`,
    jsonRequest('POST', { result_id: 'cats' }),
  );
  const { message } = await chosen.json() as {
    message: { message_id: number; rich_message?: { blocks: unknown[] }; via_bot?: unknown };
  };
  const press = await api.request(
    `${accountPath}/callback-queries`,
    jsonRequest('POST', { chat, message_id: message.message_id, callback_data: 'more' }),
  );
  const pressedUpdates = await (await api.request(`${inlineBot.botApiPath}/getUpdates`)).json() as {
    result: Array<{ callback_query?: { inline_message_id?: string; data?: string } }>;
  };
  const callbackQuery = pressedUpdates.result.find((update) => update.callback_query)
    ?.callback_query;
  if (
    JSON.stringify(answered.body) !== JSON.stringify({ ok: true, result: true }) ||
    message.rich_message?.blocks.length !== 3 || message.via_bot === undefined ||
    !JSON.stringify(message.rich_message).includes('"type":"url"') ||
    press.status !== 201 || callbackQuery?.inline_message_id === undefined ||
    callbackQuery.data !== 'more'
  ) {
    throw new Error(
      `Expected the chosen rich message and its callback, received ${
        JSON.stringify([answered, message, press.status, callbackQuery])
      }`,
    );
  }

  const refusals = [
    await answer(
      await sendQuery(),
      { blocks: [{ type: 'photo', photo: { type: 'photo', media: 'attach://cat' } }] },
      { cat: new File([gifImage(4, 4)], 'cat.gif') },
    ),
    await answer(await sendQuery(), {
      blocks: [{ type: 'buttons', buttons: [{ text: 'More', callback_data: 'x'.repeat(65) }] }],
    }),
    await answer(await sendQuery(), {
      blocks: [{ type: 'photo', photo: { type: 'photo', media: 'unknown' } }],
    }),
    await answer(await sendQuery(), {
      blocks: [{ type: 'photo', photo: { type: 'photo', media: 'https://example.com/cat.gif' } }],
    }),
    await callBotApi(api, `${inlineBot.botApiPath}/answerInlineQuery`, {
      inline_query_id: await sendQuery(),
      results: [{
        type: 'article',
        id: 'cats',
        title: 'Cats',
        input_message_content: {
          message_text: 'Cats',
          rich_message: { blocks: [{ type: 'paragraph', text: 'Cats' }] },
        },
      }],
    }),
  ].map(({ body }) => isBadRequestResponse(body) ? body.description : JSON.stringify(body));
  if (
    JSON.stringify(refusals) !== JSON.stringify([
      'Bad Request: invalid inline message content specified',
      'Bad Request: BUTTON_DATA_INVALID',
      "Bad Request: wrong remote file identifier specified: can't unserialize it",
      'Bad Request: invalid inline message content specified',
      'Bad Request: invalid answerInlineQuery parameters',
    ])
  ) {
    throw new Error(`Expected Telegram's errors, received ${JSON.stringify(refusals)}`);
  }
});

Deno.test('a grammY bot answers inline queries and edits the message it sent to a group', async () => {
  const { api, sessionPath, owner, supergroup, supergroupPath } = await createSupergroupFixture();
  const inlineBot = await createBot(api, sessionPath, 'cats_bot', {
    supports_inline_queries: true,
    receives_chosen_inline_results: true,
  });
  const ownerPath = `${sessionPath}/accounts/${owner.id}`;
  const grammyBot = new Bot(inlineBot.token, {
    client: {
      apiRoot: `http://emulator.example:9000${sessionPath}/bot-api`,
      fetch: createInProcessFetch(api.fetch),
    },
  });
  let catPhotoFileId: string | undefined;
  const photoSent = Promise.withResolvers<void>();
  const resultChosen = Promise.withResolvers<string>();
  const moreHandled = Promise.withResolvers<void>();
  grammyBot.command('start', async (context) => {
    const reply = await context.replyWithPhoto(new InputFile(gifImage(2, 1), 'cat.gif'));
    catPhotoFileId = reply.photo.at(-1)?.file_id;
    photoSent.resolve();
  });
  grammyBot.inlineQuery(/cat/, async (context) => {
    await context.answerInlineQuery([
      {
        type: 'article',
        id: 'fact',
        title: 'Cat fact',
        input_message_content: { message_text: 'Cats sleep a lot' },
        reply_markup: new InlineKeyboard().text('More', 'more'),
      },
      { type: 'photo', id: 'photo', photo_file_id: catPhotoFileId ?? '', caption: 'A cat' },
    ], { cache_time: 0 });
  });
  grammyBot.on('chosen_inline_result', (context) => {
    resultChosen.resolve(context.chosenInlineResult.result_id);
  });
  grammyBot.callbackQuery('more', async (context) => {
    await context.answerCallbackQuery();
    await context.editMessageText('Cats also purr');
    moreHandled.resolve();
  });
  const polling = grammyBot.start();

  try {
    const startResponse = await api.request(
      `${ownerPath}/messages`,
      jsonRequest('POST', { to: { type: 'private', botId: inlineBot.bot.id }, text: '/start' }),
    );
    if (startResponse.status !== 201) {
      throw new Error(`Expected /start to be sent, received ${startResponse.status}`);
    }
    await expectSettlementWithin(photoSent.promise, 5_000, 'Expected the bot to send a photo');

    const queryResponse = await api.request(
      `${ownerPath}/inline-queries`,
      jsonRequest('POST', {
        bot_id: inlineBot.bot.id,
        chat: { type: 'supergroup', chatId: supergroup.id },
        query: 'cat',
      }),
    );
    const inlineQueryPath = queryResponse.headers.get('Location');
    if (queryResponse.status !== 201 || inlineQueryPath === null) {
      throw new Error(`Expected the inline query to be sent, received ${queryResponse.status}`);
    }
    const answer = await expectSettlementWithin(
      (async () => {
        for (;;) {
          const body = await (await api.request(inlineQueryPath)).json() as {
            inline_query: { status: string; answer: { results: { id: string }[] } | null };
          };
          if (body.inline_query.answer !== null) {
            return body.inline_query.answer;
          }
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
      })(),
      5_000,
      'Expected the bot to answer the inline query',
    );
    if (JSON.stringify(answer.results.map(({ id }) => id)) !== JSON.stringify(['fact', 'photo'])) {
      throw new Error(`Expected both results, received ${JSON.stringify(answer)}`);
    }

    const chooseResult = async (resultId: string) => {
      const response = await api.request(
        `${inlineQueryPath}/chosen-results`,
        jsonRequest('POST', { result_id: resultId }),
      );
      if (response.status !== 201) {
        throw new Error(`Expected result ${resultId} to be sent, received ${response.status}`);
      }
      return (await response.json() as { message: Record<string, unknown> }).message;
    };
    const factMessage = await chooseResult('fact');
    if (
      (await expectSettlementWithin(resultChosen.promise, 5_000, 'Expected inline feedback')) !==
        'fact'
    ) {
      throw new Error('Expected the bot to learn which result was chosen');
    }
    const photoMessage = await chooseResult('photo');
    const photoSize = photoSizeOf(photoMessage);
    if (
      photoMessage.caption !== 'A cat' || photoSize === undefined ||
      (photoMessage.via_bot as { id?: number } | undefined)?.id !== inlineBot.bot.id
    ) {
      throw new Error(
        `Expected the cached photo in the group, received ${JSON.stringify(photoMessage)}`,
      );
    }

    const pressResponse = await api.request(
      `${ownerPath}/callback-queries`,
      jsonRequest('POST', {
        chat: { type: 'supergroup', chatId: supergroup.id },
        message_id: factMessage.message_id,
        callback_data: 'more',
      }),
    );
    if (pressResponse.status !== 201) {
      throw new Error(`Expected the button press to be accepted, received ${pressResponse.status}`);
    }
    await expectSettlementWithin(
      moreHandled.promise,
      5_000,
      'Expected the bot to edit the message',
    );

    const historyResponse = await api.request(`${supergroupPath(owner.id)}/messages`);
    const { messages } = await historyResponse.json() as {
      messages: Record<string, unknown>[];
    };
    const editedFact = messages.find(({ message_id }) => message_id === factMessage.message_id);
    if (
      editedFact?.text !== 'Cats also purr' || editedFact.reply_markup !== undefined ||
      (editedFact.via_bot as { id?: number } | undefined)?.id !== inlineBot.bot.id
    ) {
      throw new Error(
        `Expected the edited message in the group, received ${JSON.stringify(editedFact)}`,
      );
    }
  } finally {
    await grammyBot.stop();
    await polling;
  }
});

Deno.test('forwardMessage forwards messages with their origin and follows Telegram checks', async () => {
  const { api, sessionPath, owner, bot, supergroup, supergroupPath } =
    await createSupergroupFixture();
  const privateChat = { type: 'private', botId: bot.bot.id };
  const accountMessageResponse = await api.request(
    `${sessionPath}/accounts/${owner.id}/messages`,
    jsonRequest('POST', { to: privateChat, text: 'Where is my order?' }),
  );
  const { message: accountMessage } = await accountMessageResponse.json() as {
    message: { message_id: number; date: number };
  };
  const forwardMessage = (parameters: Record<string, unknown>) =>
    callBotApi(api, `${bot.botApiPath}/forwardMessage`, parameters);

  const forward = botApiResult(
    (await forwardMessage({
      chat_id: supergroup.id,
      from_chat_id: owner.id,
      message_id: accountMessage.message_id,
    })).body,
  );
  const expectedOrigin = { type: 'user', sender_user: owner, date: accountMessage.date };
  const expectedForwardFields = {
    forward_origin: expectedOrigin,
    forward_from: owner,
    forward_date: accountMessage.date,
    text: 'Where is my order?',
  };
  const { forward_origin, forward_from, forward_date, text } = forward ?? {};
  if (
    forward?.chat === undefined || (forward.from as { id: number }).id !== bot.bot.id ||
    JSON.stringify({ forward_origin, forward_from, forward_date, text }) !==
      JSON.stringify(expectedForwardFields)
  ) {
    throw new Error(
      `Expected the bot's forward to show its origin, received ${JSON.stringify(forward)}`,
    );
  }

  // A forward of a forward keeps the original's origin.
  const forwardOfForward = botApiResult(
    (await forwardMessage({
      chat_id: owner.id,
      from_chat_id: supergroup.id,
      message_id: forward.message_id,
    })).body,
  );
  if (JSON.stringify(forwardOfForward?.forward_origin) !== JSON.stringify(expectedOrigin)) {
    throw new Error(
      `Expected a forward of a forward to keep its origin, received ${
        JSON.stringify(forwardOfForward)
      }`,
    );
  }

  // Only a keyboard of URL buttons stays on a forward.
  const sendMenu = async (inlineKeyboard: unknown) =>
    botApiResult(
      (await callBotApi(api, `${bot.botApiPath}/sendMessage`, {
        chat_id: owner.id,
        text: 'Menu',
        reply_markup: { inline_keyboard: inlineKeyboard },
      })).body,
    )?.message_id;
  const urlKeyboard = [[{ text: 'Track', url: 'https://example.com/track' }]];
  const callbackKeyboard = [[{ text: 'Track', url: 'https://example.com/track' }, {
    text: 'Cancel',
    callback_data: 'cancel',
  }]];
  const forwardedMarkups = [];
  for (const inlineKeyboard of [urlKeyboard, callbackKeyboard]) {
    const messageId = await sendMenu(inlineKeyboard);
    forwardedMarkups.push(
      botApiResult(
        (await forwardMessage({
          chat_id: supergroup.id,
          from_chat_id: owner.id,
          message_id: messageId,
        })).body,
      )?.reply_markup,
    );
  }
  if (
    JSON.stringify(forwardedMarkups) !==
      JSON.stringify([{ inline_keyboard: urlKeyboard }, undefined])
  ) {
    throw new Error(`Expected only URL keyboards on forwards, received ${forwardedMarkups}`);
  }

  // A forward cannot be edited.
  const editOfForward = await callBotApi(api, `${bot.botApiPath}/editMessageText`, {
    chat_id: supergroup.id,
    message_id: forward.message_id,
    text: 'Edited',
  });
  if (
    !isBadRequestResponse(editOfForward.body) ||
    editOfForward.body.description !== "Bad Request: message can't be edited"
  ) {
    throw new Error(
      `Expected a forward to be uneditable, received ${JSON.stringify(editOfForward)}`,
    );
  }

  const protectedMessageId = botApiResult(
    (await callBotApi(api, `${bot.botApiPath}/sendMessage`, {
      chat_id: owner.id,
      text: 'Your code is 1234',
      protect_content: true,
    })).body,
  )?.message_id;
  const history = await (await api.request(`${supergroupPath(owner.id)}/messages`)).json() as {
    messages: Array<{ message_id: number }>;
  };
  const serviceMessageId = history.messages[0].message_id;
  const expectFailure = async (
    parameters: Record<string, unknown>,
    status: number,
    description: string,
  ) => {
    const { status: actualStatus, body } = await forwardMessage(parameters);
    const actualDescription = (body as { description?: unknown }).description;
    if (actualStatus !== status || actualDescription !== description) {
      throw new Error(
        `Expected forwardMessage to fail with "${description}", received ${JSON.stringify(body)}`,
      );
    }
  };
  await expectFailure(
    { chat_id: supergroup.id, message_id: accountMessage.message_id },
    400,
    'Bad Request: parameter "from_chat_id" is required',
  );
  await expectFailure(
    { from_chat_id: owner.id, message_id: accountMessage.message_id },
    400,
    'Bad Request: chat_id is empty',
  );
  await expectFailure(
    { chat_id: supergroup.id, from_chat_id: owner.id + 1_000, message_id: 1 },
    400,
    'Bad Request: chat not found',
  );
  await expectFailure(
    { chat_id: supergroup.id, from_chat_id: owner.id },
    400,
    'Bad Request: message to forward not found',
  );
  await expectFailure(
    { chat_id: supergroup.id, from_chat_id: supergroup.id, message_id: 1_000 },
    400,
    'Bad Request: message to forward not found',
  );
  await expectFailure(
    { chat_id: supergroup.id, from_chat_id: owner.id, message_id: protectedMessageId },
    400,
    "Bad Request: the message can't be forwarded",
  );
  await expectFailure(
    { chat_id: owner.id, from_chat_id: supergroup.id, message_id: serviceMessageId },
    400,
    "Bad Request: the message can't be forwarded",
  );
  // A supergroup the bot never joined is unknown to it.
  const outsider = await createBot(api, sessionPath, 'outsider_bot');
  const { body: outsiderBody } = await callBotApi(api, `${outsider.botApiPath}/forwardMessage`, {
    chat_id: owner.id,
    from_chat_id: supergroup.id,
    message_id: forward.message_id,
  });
  if (
    !isBadRequestResponse(outsiderBody) ||
    outsiderBody.description !== 'Bad Request: chat not found'
  ) {
    throw new Error(
      `Expected a non-member not to find the supergroup, received ${JSON.stringify(outsiderBody)}`,
    );
  }
});

Deno.test('forwardMessages and copyMessages repeat messages that can be repeated, in order', async () => {
  const { api, sessionPath, owner, bot, supergroup, supergroupPath } =
    await createSupergroupFixture();
  const sendAccountMessage = async (message: Record<string, unknown>) => {
    const response = await api.request(
      `${sessionPath}/accounts/${owner.id}/messages`,
      jsonRequest('POST', { to: { type: 'private', botId: bot.bot.id }, ...message }),
    );
    return ((await response.json()) as { message: { message_id: number } }).message.message_id;
  };
  const questionId = await sendAccountMessage({ text: 'Where is my order?' });
  const followUpId = await sendAccountMessage({
    text: 'It was due today',
    reply_to_message_id: questionId,
  });
  const protectedMessageId = botApiResult(
    (await callBotApi(api, `${bot.botApiPath}/sendMessage`, {
      chat_id: owner.id,
      text: 'Your code is 1234',
      protect_content: true,
    })).body,
  )?.message_id as number;
  const receiptId = await sendAccountMessage({
    photo: { content_base64: gifImage(4, 3).toBase64() },
    caption: 'Receipt',
  });
  const repeatMessages = (method: string, parameters: Record<string, unknown>) =>
    callBotApi(api, `${bot.botApiPath}/${method}`, parameters);
  const readSupergroupMessages = async (messageIds: unknown) => {
    const history = await (await api.request(`${supergroupPath(owner.id)}/messages`)).json() as {
      messages: Array<Record<string, unknown>>;
    };
    return (messageIds as Array<{ message_id: number }>).map(({ message_id }) =>
      history.messages.find((message) => message.message_id === message_id)
    );
  };
  const describe = (message: Record<string, unknown> | undefined) => ({
    text: message?.text ?? message?.caption,
    originDate: (message?.forward_origin as { date?: number } | undefined)?.date,
    repliedMessageId: (message?.reply_to_message as { message_id?: number } | undefined)
      ?.message_id,
  });

  // A missing message and a protected message are skipped; replies within the request are kept.
  const forwarded = await repeatMessages('forwardMessages', {
    chat_id: supergroup.id,
    from_chat_id: owner.id,
    message_ids: [questionId, followUpId, 1_000, protectedMessageId, receiptId],
  });
  const forwards = await readSupergroupMessages(botApiResult(forwarded.body));
  const [forwardedQuestion] = forwards;
  const originDate = (forwardedQuestion?.forward_origin as { date?: number } | undefined)?.date;
  if (
    forwarded.status !== 200 || originDate === undefined ||
    JSON.stringify(forwards.map(describe)) !== JSON.stringify([
        { text: 'Where is my order?', originDate },
        {
          text: 'It was due today',
          originDate,
          repliedMessageId: forwardedQuestion?.message_id,
        },
        { text: 'Receipt', originDate },
      ])
  ) {
    throw new Error(
      `Expected the repeatable messages to be forwarded, received ${JSON.stringify(forwarded)}`,
    );
  }

  // A bot may copy a protected message, and captions can be removed.
  const copied = await repeatMessages('copyMessages', {
    chat_id: supergroup.id,
    from_chat_id: owner.id,
    message_ids: [questionId, followUpId, protectedMessageId, receiptId],
    remove_caption: true,
  });
  const copies = await readSupergroupMessages(botApiResult(copied.body));
  if (
    copied.status !== 200 ||
    JSON.stringify(copies.map(describe)) !== JSON.stringify([
        { text: 'Where is my order?' },
        { text: 'It was due today', repliedMessageId: copies[0]?.message_id },
        { text: 'Your code is 1234' },
        {},
      ]) ||
    photoSizeOf(copies[3]) === undefined
  ) {
    throw new Error(`Expected the messages to be copied, received ${JSON.stringify(copied)}`);
  }

  const history = await (await api.request(`${supergroupPath(owner.id)}/messages`)).json() as {
    messages: Array<{ message_id: number }>;
  };
  const serviceMessageId = history.messages[0].message_id;
  const expectFailure = async (
    method: string,
    parameters: Record<string, unknown>,
    description: string,
  ) => {
    const { status, body } = await repeatMessages(method, parameters);
    const actualDescription = (body as { description?: unknown }).description;
    if (status !== 400 || actualDescription !== description) {
      throw new Error(
        `Expected ${method} to fail with "${description}", received ${JSON.stringify(body)}`,
      );
    }
  };
  const target = { chat_id: supergroup.id, from_chat_id: owner.id };
  await expectFailure(
    'forwardMessages',
    { chat_id: supergroup.id, message_ids: [questionId] },
    'Bad Request: parameter "from_chat_id" is required',
  );
  for (const messageIds of [undefined, []]) {
    await expectFailure(
      'copyMessages',
      { ...target, message_ids: messageIds },
      'Bad Request: message identifiers are not specified',
    );
  }
  await expectFailure(
    'forwardMessages',
    { ...target, message_ids: Array.from({ length: 101 }, (_, index) => index + 1) },
    'Bad Request: too many message identifiers specified',
  );
  await expectFailure(
    'forwardMessages',
    { ...target, message_ids: [questionId, 0] },
    'Bad Request: invalid message identifier specified',
  );
  await expectFailure(
    'forwardMessages',
    { from_chat_id: owner.id, message_ids: [questionId] },
    'Bad Request: chat_id is empty',
  );
  await expectFailure(
    'forwardMessages',
    { chat_id: supergroup.id, from_chat_id: owner.id + 1_000, message_ids: [questionId] },
    'Bad Request: chat not found',
  );
  await expectFailure(
    'copyMessages',
    { ...target, message_ids: [followUpId, questionId] },
    'Bad Request: message identifiers must be in a strictly increasing order',
  );
  await expectFailure(
    'forwardMessages',
    { ...target, message_ids: [1_000, 1_001] },
    'Bad Request: there are no messages to forward',
  );
  await expectFailure(
    'forwardMessages',
    { ...target, message_ids: [protectedMessageId] },
    "Bad Request: messages can't be forwarded",
  );
  await expectFailure(
    'copyMessages',
    { chat_id: owner.id, from_chat_id: supergroup.id, message_ids: [serviceMessageId] },
    "Bad Request: messages can't be forwarded",
  );
});

Deno.test('bots add message effects to private messages only, as TDLib allows', async () => {
  const { api, sessionPath, owner, bot, supergroup } = await createSupergroupFixture();
  const effectId = '5104841245755180586';
  const questionResponse = await api.request(
    `${sessionPath}/accounts/${owner.id}/messages`,
    jsonRequest('POST', { to: { type: 'private', botId: bot.bot.id }, text: 'Hi' }),
  );
  const { message: question } = await questionResponse.json() as {
    message: { message_id: number };
  };
  const callMethod = (method: string, parameters: Record<string, unknown>) =>
    callBotApi(api, `${bot.botApiPath}/${method}`, parameters);

  const celebration = botApiResult(
    (await callMethod('sendMessage', {
      chat_id: owner.id,
      text: 'Congratulations!',
      message_effect_id: effectId,
    })).body,
  );
  const edited = botApiResult(
    (await callMethod('editMessageText', {
      chat_id: owner.id,
      message_id: celebration?.message_id,
      text: 'Congratulations again!',
    })).body,
  );
  const forward = botApiResult(
    (await callMethod('forwardMessage', {
      chat_id: owner.id,
      from_chat_id: owner.id,
      message_id: question.message_id,
      message_effect_id: effectId,
    })).body,
  );
  const withoutEffect = botApiResult(
    (await callMethod('sendMessage', { chat_id: owner.id, text: 'Hi', message_effect_id: '0' }))
      .body,
  );
  const history = await (await api.request(
    `${sessionPath}/accounts/${owner.id}/conversations/private/${bot.bot.id}/messages`,
  )).json() as { messages: Array<Record<string, unknown>> };
  const storedCelebration = history.messages.find(({ message_id }) =>
    message_id === celebration?.message_id
  );
  if (
    celebration?.effect_id !== effectId || edited?.effect_id !== effectId ||
    forward?.effect_id !== effectId || withoutEffect === undefined ||
    'effect_id' in withoutEffect || storedCelebration?.effect_id !== effectId
  ) {
    throw new Error(
      `Expected messages to keep their effects, received ${
        JSON.stringify({ celebration, edited, forward, withoutEffect, storedCelebration })
      }`,
    );
  }

  // A batch may add an effect only to a single found message.
  const batch = await callMethod('copyMessages', {
    chat_id: owner.id,
    from_chat_id: owner.id,
    message_ids: [question.message_id, 1_000],
    message_effect_id: effectId,
  });
  const [batchCopy] = (batch.body as { result?: Array<{ message_id: number }> }).result ?? [];
  const storedBatchCopy = (await (await api.request(
    `${sessionPath}/accounts/${owner.id}/conversations/private/${bot.bot.id}/messages`,
  )).json() as { messages: Array<Record<string, unknown>> }).messages.find(({ message_id }) =>
    message_id === batchCopy?.message_id
  );
  if (storedBatchCopy?.effect_id !== effectId) {
    throw new Error(
      `Expected the single copy to show the effect, received ${JSON.stringify(batch.body)}`,
    );
  }

  const failures = [
    [
      'sendMessage',
      { chat_id: supergroup.id, text: 'Hi', message_effect_id: effectId },
      "Bad Request: can't use message effects in the chat",
    ],
    // Telegram looks at the chat and the reply before the effect.
    [
      'sendMessage',
      { chat_id: supergroup.id - 1_000, text: 'Hi', message_effect_id: effectId },
      'Bad Request: chat not found',
    ],
    [
      'sendMessage',
      {
        chat_id: supergroup.id,
        text: 'Hi',
        message_effect_id: effectId,
        reply_parameters: { message_id: 1_000 },
      },
      'Bad Request: message to be replied not found',
    ],
    [
      'copyMessages',
      {
        chat_id: supergroup.id,
        from_chat_id: owner.id,
        message_ids: [question.message_id],
        message_effect_id: effectId,
      },
      "Bad Request: can't use message effects in the chat",
    ],
    [
      'forwardMessages',
      {
        chat_id: owner.id,
        from_chat_id: owner.id,
        message_ids: [question.message_id, celebration?.message_id],
        message_effect_id: effectId,
      },
      "Bad Request: can't use message effects in the method",
    ],
    [
      'sendMessage',
      { chat_id: owner.id, text: 'Hi', message_effect_id: 'fireworks' },
      'Bad Request: invalid sendMessage parameters',
    ],
  ] as const;
  for (const [method, parameters, expectedDescription] of failures) {
    const { status, body } = await callMethod(method, parameters);
    if (status !== 400 || (body as { description?: unknown }).description !== expectedDescription) {
      throw new Error(
        `Expected ${method} ${JSON.stringify(parameters)} to fail with ${expectedDescription}, ` +
          `received ${JSON.stringify(body)}`,
      );
    }
  }
});

Deno.test('copyMessage copies messages without their origin and follows Telegram checks', async () => {
  const { api, sessionPath, owner, bot, supergroup, supergroupPath } =
    await createSupergroupFixture();
  const photoResponse = await api.request(
    `${sessionPath}/accounts/${owner.id}/messages`,
    jsonRequest('POST', {
      to: { type: 'private', botId: bot.bot.id },
      photo: { content_base64: gifImage(4, 3).toBase64() },
      caption: 'Receipt',
    }),
  );
  const { message: photoMessage } = await photoResponse.json() as {
    message: { message_id: number; photo: Array<{ file_unique_id: string }> };
  };
  const copyMessage = (parameters: Record<string, unknown>) =>
    callBotApi(api, `${bot.botApiPath}/copyMessage`, parameters);
  const readSupergroupMessage = async (messageId: unknown) => {
    const history = await (await api.request(`${supergroupPath(owner.id)}/messages`)).json() as {
      messages: Array<Record<string, unknown>>;
    };
    return history.messages.find((message) => message.message_id === messageId);
  };

  const copies = [];
  for (
    const captionParameters of [
      {},
      { caption: '<b>Paid</b> receipt', parse_mode: 'HTML', show_caption_above_media: true },
      { caption: '' },
    ]
  ) {
    const { status, body } = await copyMessage({
      chat_id: supergroup.id,
      from_chat_id: owner.id,
      message_id: photoMessage.message_id,
      ...captionParameters,
    });
    const result = botApiResult(body);
    if (status !== 200 || result === undefined || Object.keys(result).join() !== 'message_id') {
      throw new Error(
        `Expected copyMessage to answer a message ID, received ${JSON.stringify(body)}`,
      );
    }
    const copy = await readSupergroupMessage(result.message_id);
    const { from, caption, caption_entities, show_caption_above_media, forward_origin } = copy ??
      {};
    copies.push({
      fromId: (from as { id: number } | undefined)?.id,
      fileUniqueId: photoSizeOf(copy)?.file_unique_id,
      caption,
      caption_entities,
      show_caption_above_media,
      forward_origin,
    });
  }
  const photoFileUniqueId = photoMessage.photo[0].file_unique_id;
  const expectedCopies = [
    { fromId: bot.bot.id, fileUniqueId: photoFileUniqueId, caption: 'Receipt' },
    {
      fromId: bot.bot.id,
      fileUniqueId: photoFileUniqueId,
      caption: 'Paid receipt',
      caption_entities: [{ type: 'bold', offset: 0, length: 4 }],
      show_caption_above_media: true,
    },
    { fromId: bot.bot.id, fileUniqueId: photoFileUniqueId },
  ];
  if (JSON.stringify(copies) !== JSON.stringify(expectedCopies)) {
    throw new Error(`Expected copies with the chosen captions, received ${JSON.stringify(copies)}`);
  }

  // A copy takes the reply and keyboard of the request, keeps text as it is, and a bot may copy a
  // protected message; a copy of a forward does not show the forward's origin.
  const protectedMessageId = botApiResult(
    (await callBotApi(api, `${bot.botApiPath}/sendMessage`, {
      chat_id: owner.id,
      text: 'Your code is 1234',
      protect_content: true,
    })).body,
  )?.message_id;
  const forwardId = botApiResult(
    (await callBotApi(api, `${bot.botApiPath}/forwardMessage`, {
      chat_id: supergroup.id,
      from_chat_id: owner.id,
      message_id: photoMessage.message_id,
    })).body,
  )?.message_id;
  const inlineKeyboard = [[{ text: 'Done', callback_data: 'done' }]];
  const textCopyId = botApiResult(
    (await copyMessage({
      chat_id: supergroup.id,
      from_chat_id: owner.id,
      message_id: protectedMessageId,
      caption: 'Ignored for text',
      reply_parameters: { message_id: forwardId },
      reply_markup: { inline_keyboard: inlineKeyboard },
    })).body,
  )?.message_id;
  const textCopy = await readSupergroupMessage(textCopyId);
  const copyOfForwardId = botApiResult(
    (await copyMessage({ chat_id: owner.id, from_chat_id: supergroup.id, message_id: forwardId }))
      .body,
  )?.message_id;
  const privateHistory = await (await api.request(
    `${sessionPath}/accounts/${owner.id}/conversations/private/${bot.bot.id}/messages`,
  )).json() as { messages: Array<Record<string, unknown>> };
  const copyOfForward = privateHistory.messages.find(({ message_id }) =>
    message_id === copyOfForwardId
  );
  if (
    textCopy?.text !== 'Your code is 1234' || textCopy.has_protected_content !== undefined ||
    (textCopy.reply_to_message as { message_id?: number } | undefined)?.message_id !==
      forwardId ||
    JSON.stringify(textCopy.reply_markup) !== JSON.stringify({ inline_keyboard: inlineKeyboard }) ||
    copyOfForward === undefined || 'forward_origin' in copyOfForward ||
    copyOfForward.caption !== 'Receipt'
  ) {
    throw new Error(
      `Expected copies to take the request's options, received ${
        JSON.stringify({ textCopy, copyOfForward })
      }`,
    );
  }

  const history = await (await api.request(`${supergroupPath(owner.id)}/messages`)).json() as {
    messages: Array<{ message_id: number }>;
  };
  const expectFailure = async (
    parameters: Record<string, unknown>,
    status: number,
    description: string,
  ) => {
    const { status: actualStatus, body } = await copyMessage(parameters);
    const actualDescription = (body as { description?: unknown }).description;
    if (actualStatus !== status || actualDescription !== description) {
      throw new Error(
        `Expected copyMessage to fail with "${description}", received ${JSON.stringify(body)}`,
      );
    }
  };
  await expectFailure(
    { chat_id: supergroup.id, from_chat_id: owner.id, message_id: 1_000 },
    400,
    'Bad Request: message to copy not found',
  );
  await expectFailure(
    { chat_id: owner.id, from_chat_id: supergroup.id, message_id: history.messages[0].message_id },
    400,
    "Bad Request: the message can't be copied",
  );
  await expectFailure(
    {
      chat_id: supergroup.id,
      from_chat_id: owner.id,
      message_id: photoMessage.message_id,
      caption: 'x'.repeat(1_025),
    },
    400,
    'Bad Request: message caption is too long',
  );
  await api.request(`${sessionPath}/accounts/${owner.id}/blocked-bots/${bot.bot.id}`, {
    method: 'PUT',
  });
  await expectFailure(
    { chat_id: owner.id, from_chat_id: owner.id, message_id: photoMessage.message_id },
    403,
    'Forbidden: bot was blocked by the user',
  );
});

Deno.test('an account forwards messages to bots, which receive their origin', async () => {
  const { api, sessionPath, owner, member, bot, supergroup, supergroupPath, sendSupergroupText } =
    await createSupergroupFixture();
  const readUpdates = createUpdateReader(api);
  const supergroupChat = { type: 'supergroup', chatId: supergroup.id };
  const privateChat = { type: 'private', botId: bot.bot.id };
  const groupMessage = await sendSupergroupText(member.id, 'Lunch at noon?');
  await readUpdates(bot.botApiPath);
  const forward = (accountId: number, body: Record<string, unknown>) =>
    api.request(`${sessionPath}/accounts/${accountId}/messages`, jsonRequest('POST', body));

  const forwardResponse = await forward(owner.id, {
    to: privateChat,
    forward: { chat: supergroupChat, message_id: groupMessage.message_id },
  });
  const { message: shownForward } = await forwardResponse.json() as {
    message: Record<string, unknown>;
  };
  const [update] = await readUpdates(bot.botApiPath);
  const receivedForward = update?.message as Record<string, unknown> | undefined;
  const expectedOrigin = { type: 'user', sender_user: member, date: groupMessage.date };
  if (
    forwardResponse.status !== 201 ||
    JSON.stringify(shownForward.forward_origin) !== JSON.stringify(expectedOrigin) ||
    JSON.stringify(receivedForward) !== JSON.stringify(shownForward) ||
    (receivedForward?.from as { id?: number } | undefined)?.id !== owner.id ||
    receivedForward?.text !== 'Lunch at noon?'
  ) {
    throw new Error(
      `Expected the bot to receive the account's forward, received ${
        JSON.stringify({ status: forwardResponse.status, shownForward, update })
      }`,
    );
  }

  // The account edits nothing of a forward, and cannot forward protected content.
  const editResponse = await api.request(
    `${sessionPath}/accounts/${owner.id}/conversations/private/${bot.bot.id}/messages/${shownForward.message_id}`,
    jsonRequest('PATCH', { text: 'Edited' }),
  );
  const protectedMessageId = botApiResult(
    (await callBotApi(api, `${bot.botApiPath}/sendMessage`, {
      chat_id: owner.id,
      text: 'Your code is 1234',
      protect_content: true,
    })).body,
  )?.message_id;
  const outsider = await createAccount(api, sessionPath, 'Linus');
  const failureStatuses = [
    editResponse.status,
    (await forward(owner.id, {
      to: supergroupChat,
      forward: { chat: privateChat, message_id: protectedMessageId },
    })).status,
    (await forward(owner.id, {
      to: supergroupChat,
      forward: { chat: privateChat, message_id: 1_000 },
    })).status,
    (await forward(outsider.id, {
      to: privateChat,
      forward: { chat: supergroupChat, message_id: groupMessage.message_id },
    })).status,
    (await forward(owner.id, {
      to: privateChat,
      forward: { chat: supergroupChat, message_id: groupMessage.message_id },
      text: 'Also text',
    })).status,
  ];
  if (JSON.stringify(failureStatuses) !== JSON.stringify([400, 400, 404, 403, 400])) {
    throw new Error(`Expected forwards to be refused, received ${failureStatuses}`);
  }

  const history = await (await api.request(`${supergroupPath(owner.id)}/messages`)).json() as {
    messages: unknown[];
  };
  if (history.messages.length !== 4) {
    throw new Error(`Expected refused forwards to leave the supergroup, received ${history}`);
  }
});

Deno.test('forwards and external replies show only the name of an account with private forwards', async () => {
  const { api, sessionPath, owner, bot, supergroup, supergroupPath, sendSupergroupText } =
    await createSupergroupFixture();
  const readUpdates = createUpdateReader(api);
  const accountResponse = await api.request(
    `${sessionPath}/accounts`,
    jsonRequest('POST', { first_name: 'Hedy', last_name: 'Lamarr', has_private_forwards: true }),
  );
  const invalidAccountResponse = await api.request(
    `${sessionPath}/accounts`,
    jsonRequest('POST', { first_name: 'Hedy', has_private_forwards: 'yes' }),
  );
  const { account: hedy } = await accountResponse.json() as { account: { id: number } };
  await api.request(`${supergroupPath(owner.id)}/members/${hedy.id}`, { method: 'PUT' });
  const hedyMessage = await sendSupergroupText(hedy.id, 'Frequency hopping');
  await readUpdates(bot.botApiPath);

  // A bot forwards the message, and replies to it from its private chat with the owner.
  const forward = botApiResult(
    (await callBotApi(api, `${bot.botApiPath}/forwardMessage`, {
      chat_id: supergroup.id,
      from_chat_id: supergroup.id,
      message_id: hedyMessage.message_id,
    })).body,
  );
  await api.request(
    `${sessionPath}/accounts/${owner.id}/messages`,
    jsonRequest('POST', { to: { type: 'private', botId: bot.bot.id }, text: '/start' }),
  );
  const reply = botApiResult(
    (await callBotApi(api, `${bot.botApiPath}/sendMessage`, {
      chat_id: owner.id,
      text: 'Someone asks',
      reply_parameters: { chat_id: supergroup.id, message_id: hedyMessage.message_id },
    })).body,
  );
  // An account forwards it to the bot, which receives the same origin.
  await readUpdates(bot.botApiPath);
  await api.request(
    `${sessionPath}/accounts/${owner.id}/messages`,
    jsonRequest('POST', {
      to: { type: 'private', botId: bot.bot.id },
      forward: {
        chat: { type: 'supergroup', chatId: supergroup.id },
        message_id: hedyMessage.message_id,
      },
    }),
  );
  const [accountForwardUpdate] = await readUpdates(bot.botApiPath);

  const hiddenOrigin = {
    type: 'hidden_user',
    sender_user_name: 'Hedy Lamarr',
    date: hedyMessage.date,
  };
  const { forward_origin, forward_from, forward_sender_name, forward_date } = forward ?? {};
  if (
    accountResponse.status !== 201 || invalidAccountResponse.status !== 400 ||
    JSON.stringify({ forward_origin, forward_from, forward_sender_name, forward_date }) !==
      JSON.stringify({
        forward_origin: hiddenOrigin,
        forward_sender_name: 'Hedy Lamarr',
        forward_date: hedyMessage.date,
      }) ||
    JSON.stringify((reply?.external_reply as Record<string, unknown>)?.origin) !==
      JSON.stringify(hiddenOrigin) ||
    JSON.stringify((accountForwardUpdate?.message as Record<string, unknown>)?.forward_origin) !==
      JSON.stringify(hiddenOrigin)
  ) {
    throw new Error(
      `Expected the origins to hide the account, received ${
        JSON.stringify({
          accountStatus: accountResponse.status,
          invalidAccountStatus: invalidAccountResponse.status,
          forward,
          reply,
          accountForwardUpdate,
        })
      }`,
    );
  }
});

Deno.test('a grammY support bot forwards questions to its team and copies answers back', async () => {
  const { api, sessionPath, member, bot, supergroup, supergroupPath } =
    await createSupergroupFixture();
  const customer = await createAccount(api, sessionPath, 'Linus');
  const grammyBot = new Bot(bot.token, {
    client: {
      apiRoot: `http://emulator.example:9000${sessionPath}/bot-api`,
      fetch: createInProcessFetch(api.fetch),
    },
  });
  const answerCopied = Promise.withResolvers<void>();
  const questionForwarded = Promise.withResolvers<void>();
  grammyBot.chatType('private').on('message', async (context) => {
    await context.forwardMessage(supergroup.id);
    questionForwarded.resolve();
  });
  grammyBot.chatType('supergroup').on('message', async (context) => {
    const origin = context.message.reply_to_message?.forward_origin;
    if (origin?.type === 'user') {
      await context.copyMessage(origin.sender_user.id);
      answerCopied.resolve();
    }
  });
  const polling = grammyBot.start();

  try {
    await api.request(
      `${sessionPath}/accounts/${customer.id}/messages`,
      jsonRequest('POST', { to: { type: 'private', botId: bot.bot.id }, text: 'Is it open?' }),
    );
    await Promise.race([questionForwarded.promise, polling]);
    const teamHistory = await (await api.request(`${supergroupPath(member.id)}/messages`))
      .json() as { messages: Array<{ message_id: number }> };
    const question = teamHistory.messages.at(-1);
    await api.request(
      `${sessionPath}/accounts/${member.id}/messages`,
      jsonRequest('POST', {
        to: { type: 'supergroup', chatId: supergroup.id },
        text: 'Yes, until 6pm.',
        reply_to_message_id: question?.message_id,
      }),
    );
    await Promise.race([answerCopied.promise, polling]);
  } finally {
    await grammyBot.stop();
    await polling;
  }

  const customerHistory = await (await api.request(
    `${sessionPath}/accounts/${customer.id}/conversations/private/${bot.bot.id}/messages`,
  )).json() as { messages: Array<{ from: { id: number }; text: string }> };
  const shownMessages = customerHistory.messages.map(({ from, text }) => [from.id, text]);
  if (
    JSON.stringify(shownMessages) !==
      JSON.stringify([[customer.id, 'Is it open?'], [bot.bot.id, 'Yes, until 6pm.']])
  ) {
    throw new Error(`Expected the team's answer to be copied back, received ${shownMessages}`);
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
    queueResponses({ method: 'sendPoll', retry_after: 3 }),
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
      apiRoot: `http://emulator.example:9000${sessionPath}/bot-api`,
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

async function expectSettlementWithin<T>(
  pending: Promise<T>,
  milliseconds: number,
  failureMessage: string,
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timeoutId = setTimeout(() => reject(new Error(failureMessage)), milliseconds);
  });
  try {
    return await Promise.race([pending, timeout]);
  } finally {
    clearTimeout(timeoutId);
  }
}

/** Creates a session holding a bot and an account that can message it. */
async function createPrivateConversationFixture(sessionSettings?: { upload_profile: string }) {
  const api = createEmulationApi({
    sessionLifecycle: createSessionLifecycleService(),
    publicOrigin: 'http://emulator.example:9000',
  });
  const createSessionResponse = await api.request(
    '/sessions',
    sessionSettings === undefined ? { method: 'POST' } : jsonRequest('POST', sessionSettings),
  );
  const sessionPath = createSessionResponse.headers.get('Location');
  if (sessionPath === null) {
    throw new Error('Expected the created session to have a Location');
  }
  const createBotResponse = await api.request(`${sessionPath}/bots`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ first_name: 'Test Bot', username: 'test_bot' }),
  });
  const createdBot: unknown = await createBotResponse.json();
  if (!isCreatedBotResponse(createdBot)) {
    throw new Error('Expected a created bot response');
  }
  const createAccountResponse = await api.request(`${sessionPath}/accounts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ first_name: 'Ada' }),
  });
  const createdAccount: unknown = await createAccountResponse.json();
  if (!isCreatedAccountResponse(createdAccount)) {
    throw new Error('Expected a created account response');
  }

  const sendText = async (text: string) => {
    const response = await api.request(
      `${sessionPath}/accounts/${createdAccount.account.id}/messages`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: { type: 'private', botId: createdBot.bot.id }, text }),
      },
    );
    if (response.status !== 201) {
      throw new Error(`Expected "${text}" to be accepted, received ${response.status}`);
    }
  };

  return {
    api,
    sessionPath,
    botApiPath: `${sessionPath}/bot-api/bot${createdBot.token}`,
    createdBot,
    createdAccount,
    sendText,
  };
}

/**
 * Creates a session with a supergroup that its owner, Ada, created, and to which Ada added Grace,
 * a bot in privacy mode, and a bot that reads all group messages.
 */
async function createSupergroupFixture() {
  const api = createEmulationApi({
    sessionLifecycle: createSessionLifecycleService(),
    publicOrigin: 'http://emulator.example:9000',
  });
  const createSessionResponse = await api.request('/sessions', { method: 'POST' });
  const sessionPath = createSessionResponse.headers.get('Location');
  if (sessionPath === null) {
    throw new Error('Expected the created session to have a Location');
  }
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
  };
}

async function createAccount(
  api: ReturnType<typeof createEmulationApi>,
  sessionPath: string,
  firstName: string,
) {
  const response = await api.request(
    `${sessionPath}/accounts`,
    jsonRequest('POST', { first_name: firstName }),
  );
  const body: unknown = await response.json();
  if (!isCreatedAccountResponse(body)) {
    throw new Error(`Expected account ${firstName} to be created, received ${response.status}`);
  }
  return body.account;
}

async function createBot(
  api: ReturnType<typeof createEmulationApi>,
  sessionPath: string,
  username: string,
  options: {
    can_read_all_group_messages?: boolean;
    supports_inline_queries?: boolean;
    receives_chosen_inline_results?: boolean;
    requests_inline_location?: boolean;
  } = {},
) {
  const response = await api.request(
    `${sessionPath}/bots`,
    jsonRequest('POST', { first_name: 'Test Bot', username, ...options }),
  );
  const body: unknown = await response.json();
  if (!isCreatedBotResponse(body)) {
    throw new Error(`Expected bot ${username} to be created, received ${response.status}`);
  }
  return { ...body, botApiPath: `${sessionPath}/bot-api/bot${body.token}` };
}

/**
 * A supergroup administrator as the Bot API shows it, holding the given rights; the list includes
 * `can_manage_chat`, which any right includes.
 */
function administratorMember(user: unknown, heldRights: readonly string[]) {
  const holds = (right: string) => heldRights.includes(right);
  return {
    user,
    status: 'administrator',
    can_be_edited: false,
    ...Object.fromEntries(
      [
        'can_manage_chat',
        'can_change_info',
        'can_delete_messages',
        'can_invite_users',
        'can_restrict_members',
        'can_pin_messages',
        'can_manage_topics',
        'can_promote_members',
        'can_manage_video_chats',
        'can_post_stories',
        'can_edit_stories',
        'can_delete_stories',
        'can_manage_tags',
        'can_send_welcome_messages',
      ].map((right) => [right, holds(right)]),
    ),
    is_anonymous: false,
    can_manage_voice_chats: holds('can_manage_video_chats'),
  };
}

function jsonRequest(method: 'PATCH' | 'POST' | 'PUT', body: unknown): RequestInit {
  return { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

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

function isCreatedBotResponse(value: unknown): value is {
  token: string;
  bot: { id: number; is_bot: boolean; first_name: string; username: string };
} {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const { token, bot } = value as Record<string, unknown>;
  return (
    typeof token === 'string' &&
    isUserProfile(bot) &&
    typeof bot.username === 'string'
  );
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

function isBadRequestResponse(value: unknown): value is {
  ok: false;
  error_code: 400;
  description: string;
} {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const { ok, error_code, description } = value as Record<string, unknown>;
  return ok === false && error_code === 400 && typeof description === 'string' &&
    description.startsWith('Bad Request: ');
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

/** Calls a Bot API method with JSON parameters and returns the status and decoded body. */
async function callBotApi(
  api: ReturnType<typeof createEmulationApi>,
  methodPath: string,
  parameters: Record<string, unknown>,
): Promise<{ status: number; body: unknown }> {
  const response = await api.request(methodPath, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(parameters),
  });
  return { status: response.status, body: await response.json() };
}

/**
 * Calls a Bot API method with a multipart body of text parameters and uploaded files, as bots send
 * files, and returns the status and decoded body.
 */
async function callBotApiWithFiles(
  api: ReturnType<typeof createEmulationApi>,
  methodPath: string,
  parameters: Record<string, string>,
  files: Record<string, File>,
): Promise<{ status: number; body: unknown }> {
  const body = new FormData();
  for (const [name, value] of Object.entries(parameters)) {
    body.append(name, value);
  }
  for (const [name, file] of Object.entries(files)) {
    body.append(name, file);
  }
  const response = await api.request(methodPath, { method: 'POST', body });
  return { status: response.status, body: await response.json() };
}

/** Returns the messages and edited messages of a successful getUpdates response. */
function updateMessages(body: unknown): Record<string, unknown>[] {
  if (typeof body !== 'object' || body === null) {
    return [];
  }
  const { ok, result } = body as Record<string, unknown>;
  if (ok !== true || !Array.isArray(result)) {
    return [];
  }
  return result.flatMap((update: Record<string, unknown>) => {
    const message = update.message ?? update.edited_message;
    return typeof message === 'object' && message !== null
      ? [message as Record<string, unknown>]
      : [];
  });
}

/** Returns the one size of a message's photo. */
function photoSizeOf(
  message: Record<string, unknown> | undefined,
): { file_id: string; file_unique_id: string } | undefined {
  const photo = message?.photo;
  return Array.isArray(photo) ? photo[0] : undefined;
}

/** The header of a GIF image, which is all the emulator reads of a photo. */
function gifImage(width: number, height: number): Uint8Array<ArrayBuffer> {
  const image = new Uint8Array(13);
  image.set(new TextEncoder().encode('GIF89a'));
  const view = new DataView(image.buffer);
  view.setUint16(6, width, true);
  view.setUint16(8, height, true);
  return image;
}

/** Returns the message a successful Bot API message method returned, if it did. */
function botApiResult(body: unknown): Record<string, unknown> | undefined {
  if (typeof body !== 'object' || body === null) {
    return undefined;
  }
  const { ok, result } = body as Record<string, unknown>;
  return ok === true && typeof result === 'object' && result !== null
    ? result as Record<string, unknown>
    : undefined;
}

function isCallbackQueryResponse(value: unknown): value is {
  callback_query: {
    id: string;
    callback_data: string;
    status: 'awaiting_answer' | 'answered' | 'expired';
    answer: { text?: string; show_alert: boolean; cache_time: number } | null;
  };
} {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const callbackQuery = (value as Record<string, unknown>).callback_query;
  if (typeof callbackQuery !== 'object' || callbackQuery === null) {
    return false;
  }
  const { id, callback_data, status, answer } = callbackQuery as Record<string, unknown>;
  return typeof id === 'string' && typeof callback_data === 'string' &&
    ['awaiting_answer', 'answered', 'expired'].includes(String(status)) &&
    (answer === null || typeof answer === 'object');
}

function isNotFoundResponse<Description extends string>(
  value: unknown,
  expectedDescription: Description,
): value is { ok: false; error_code: 404; description: Description } {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const { ok, error_code, description } = value as Record<string, unknown>;
  return ok === false && error_code === 404 && description === expectedDescription;
}

const TERMINATED_BY_OTHER_LONG_POLL_DESCRIPTION =
  'Conflict: terminated by other getUpdates request; make sure that only one bot instance is running';

function isTerminatedByOtherLongPollResponse(value: unknown): value is {
  ok: false;
  error_code: 409;
  description: typeof TERMINATED_BY_OTHER_LONG_POLL_DESCRIPTION;
} {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const { ok, error_code, description } = value as Record<string, unknown>;
  return ok === false && error_code === 409 &&
    description === TERMINATED_BY_OTHER_LONG_POLL_DESCRIPTION;
}

function isSentMessageResponse(value: unknown): value is {
  message: TestPrivateMessage;
} {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const { message } = value as Record<string, unknown>;
  return isPrivateMessage(message);
}

function isMessageHistoryResponse(value: unknown): value is {
  messages: Array<TestPrivateMessage>;
} {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const { messages } = value as Record<string, unknown>;
  return Array.isArray(messages) && messages.every(isPrivateMessage);
}

function isGetUpdatesResponse(value: unknown): value is {
  ok: true;
  result: Array<{
    update_id: number;
    message: TestPrivateMessage;
  }>;
} {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const { ok, result } = value as Record<string, unknown>;
  return ok === true && Array.isArray(result) && result.every((update) => {
    if (typeof update !== 'object' || update === null) {
      return false;
    }
    const candidate = update as Record<string, unknown>;
    return typeof candidate.update_id === 'number' && isPrivateMessage(candidate.message);
  });
}

/** The parts of a Bot API message these tests check. */
interface TestPrivateMessage {
  message_id: number;
  from: { id: number };
  chat: { id: number; type: string };
  date: number;
  text: string;
  /** Left unchecked; tests compare it as a whole. */
  entities?: unknown;
  /** Left unchecked; tests compare it as a whole. */
  reply_markup?: unknown;
}

function isPrivateMessage(value: unknown): value is TestPrivateMessage {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const message = value as Record<string, unknown>;
  return (
    typeof message.message_id === 'number' &&
    typeof message.date === 'number' &&
    typeof message.text === 'string' &&
    typeof message.from === 'object' &&
    message.from !== null &&
    typeof (message.from as Record<string, unknown>).id === 'number' &&
    typeof message.chat === 'object' &&
    message.chat !== null &&
    typeof (message.chat as Record<string, unknown>).id === 'number' &&
    typeof (message.chat as Record<string, unknown>).type === 'string'
  );
}

function isCreatedAccountResponse(value: unknown): value is {
  account: {
    id: number;
    is_bot: boolean;
    first_name: string;
    last_name?: string;
    username?: string;
    language_code?: string;
  };
} {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const { account } = value as Record<string, unknown>;
  return isUserProfile(account);
}

function isUserProfile(value: unknown): value is {
  id: number;
  is_bot: boolean;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
} {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const profile = value as Record<string, unknown>;
  return (
    typeof profile.id === 'number' &&
    typeof profile.is_bot === 'boolean' &&
    typeof profile.first_name === 'string' &&
    (profile.last_name === undefined || typeof profile.last_name === 'string') &&
    (profile.username === undefined || typeof profile.username === 'string') &&
    (profile.language_code === undefined || typeof profile.language_code === 'string')
  );
}

/** Returns a reader of each bot's updates since the reader last read that bot's updates. */
function createUpdateReader(api: ReturnType<typeof createEmulationApi>) {
  const nextOffsetsByBotApiPath = new Map<string, number>();
  return async (botApiPath: string): Promise<Array<Record<string, unknown>>> => {
    const { body } = await callBotApi(api, `${botApiPath}/getUpdates`, {
      offset: nextOffsetsByBotApiPath.get(botApiPath) ?? 0,
    });
    const updates = (body as { result: Array<Record<string, unknown>> }).result;
    const lastUpdateId = updates.at(-1)?.update_id;
    if (typeof lastUpdateId === 'number') {
      nextOffsetsByBotApiPath.set(botApiPath, lastUpdateId + 1);
    }
    return updates;
  };
}

function createInProcessFetch(
  handler: (request: Request) => Response | Promise<Response>,
): typeof globalThis.fetch {
  return async (input, init) => await handler(new Request(input, init));
}
