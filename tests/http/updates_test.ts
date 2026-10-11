import { Bot } from 'https://cdn.jsdelivr.net/gh/grammyjs/grammY@^1.46.0/src/bot.ts';

import { TEST_PUBLIC_ORIGIN } from '../support/emulation_api.ts';
import {
  isBadRequestResponse,
  isGetUpdatesResponse,
  isMessageHistoryResponse,
  isSentMessageResponse,
} from '../support/http_response_guards.ts';
import { createPrivateConversationFixture } from '../support/http_fixtures.ts';

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
      apiRoot: `${TEST_PUBLIC_ORIGIN}${sessionPath}/bot-api`,
      fetch: api.fetch,
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

Deno.test('a grammY bot starts polling, replies to a command, and resumes after a restart', async () => {
  const { api, sessionPath, createdBot, createdAccount, sendText } =
    await createPrivateConversationFixture();
  const startGrammyBot = () => {
    const grammyBot = new Bot(createdBot.token, {
      client: {
        apiRoot: `${TEST_PUBLIC_ORIGIN}${sessionPath}/bot-api`,
        fetch: api.fetch,
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
