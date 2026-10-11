import { assertEquals } from '@std/assert';
import { Bot } from 'https://cdn.jsdelivr.net/gh/grammyjs/grammY@^1.46.0/src/bot.ts';
import {
  InlineKeyboard,
} from 'https://cdn.jsdelivr.net/gh/grammyjs/grammY@^1.46.0/src/convenience/keyboard.ts';
import { InputFile } from 'https://cdn.jsdelivr.net/gh/grammyjs/grammY@^1.46.0/src/types.ts';

import { createTestSession, jsonRequest, TEST_PUBLIC_ORIGIN } from '../support/emulation_api.ts';
import { assertEqualsInFieldOrder } from '../support/field_order_assertion.ts';
import { expectSettlementWithin } from '../support/settlement.ts';
import { isBadRequestResponse } from '../support/http_response_guards.ts';
import {
  botApiResult,
  callBotApi,
  callBotApiWithFiles,
  createUpdateReader,
  photoSizeOf,
} from '../support/bot_api_requests.ts';
import {
  createAccount,
  createBot,
  createPrivateConversationFixture,
  createSupergroupFixture,
} from '../support/http_fixtures.ts';
import { gifImage } from '../support/media_samples.ts';

Deno.test('an account sends an inline query, a bot answers, and the account sends a result', async () => {
  await using testSession = await createTestSession();
  const { api, sessionPath } = testSession;
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
    queryResponse.status !== 201 ||
    queryResponse.headers.get('Location') !== inlineQueryPath
  ) {
    throw new Error(`Expected an unanswered inline query, received ${JSON.stringify(queryBody)}`);
  }
  assertEqualsInFieldOrder(queryBody, {
    inline_query: {
      id: queryBody.inline_query.id,
      bot_id: inlineBot.bot.id,
      chat: { type: 'private', botId: inlineBot.bot.id },
      query: 'cats',
      offset: '',
      status: 'awaiting_answer',
      answer: null,
    },
  }, 'Expected an unanswered inline query');
  const [queryUpdate] = await readUpdates(inlineBot.botApiPath);
  assertEqualsInFieldOrder(queryUpdate?.inline_query, {
    id: queryBody.inline_query.id,
    from: account,
    chat_type: 'sender',
    query: 'cats',
    offset: '',
  }, 'Expected an inline_query update');

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
  assertEqualsInFieldOrder(
    answerResponse.body,
    { ok: true, result: true },
    'Expected the answer to be accepted',
  );
  const answeredBody = await (await api.request(inlineQueryPath)).json() as {
    inline_query: { status: string; answer: unknown };
  };
  if (answeredBody.inline_query.status !== 'answered') {
    throw new Error(
      `Expected the account to see the answer, received ${JSON.stringify(answeredBody)}`,
    );
  }
  assertEqualsInFieldOrder(answeredBody.inline_query.answer, {
    results: [
      { type: 'article', id: 'fact-1', title: 'Cat fact', description: 'Cats sleep a lot' },
    ],
    cache_time: 300,
    is_personal: false,
    next_offset: '',
    button: { text: 'Sign in', start_parameter: 'sign-in' },
  }, 'Expected the account to see the answer');

  const chooseResponse = await api.request(
    `${inlineQueryPath}/chosen-results`,
    jsonRequest('POST', { result_id: 'fact-1' }),
  );
  const { message } = await chooseResponse.json() as { message: Record<string, unknown> };
  if (
    chooseResponse.status !== 201 ||
    message.text !== 'Cats sleep a lot'
  ) {
    throw new Error(
      `Expected the account's message through the bot, received ${JSON.stringify(message)}`,
    );
  }
  assertEqualsInFieldOrder(message.from, account, "Expected the account's message through the bot");
  assertEqualsInFieldOrder(
    message.entities,
    [{ type: 'bold', offset: 0, length: 4 }],
    "Expected the account's message through the bot",
  );
  assertEqualsInFieldOrder(message.via_bot, {
    id: inlineBot.bot.id,
    is_bot: true,
    first_name: 'Test Bot',
    username: 'cats_bot',
  }, "Expected the account's message through the bot");
  assertEquals(
    Object.keys(message).slice(-2),
    ['reply_markup', 'via_bot'],
    "Expected the account's message through the bot",
  );
  const [messageUpdate, chosenResultUpdate] = await readUpdates(inlineBot.botApiPath);
  const chosenResult = chosenResultUpdate?.chosen_inline_result as Record<string, unknown>;
  const inlineMessageId = chosenResult?.inline_message_id;
  if (typeof inlineMessageId !== 'string') {
    throw new Error('Expected the message and then the chosen result');
  }
  assertEqualsInFieldOrder(
    messageUpdate?.message,
    message,
    'Expected the message and then the chosen result',
  );
  assertEqualsInFieldOrder(chosenResult, {
    from: account,
    inline_message_id: inlineMessageId,
    query: 'cats',
    result_id: 'fact-1',
  }, 'Expected the message and then the chosen result');

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
    callbackQuery.inline_message_id !== inlineMessageId
  ) {
    throw new Error(`Expected an inline callback query, received ${JSON.stringify(callbackQuery)}`);
  }
  assertEquals(Object.keys(callbackQuery ?? {}), [
    'id',
    'from',
    'inline_message_id',
    'chat_instance',
    'data',
  ], 'Expected an inline callback query');

  const editResponse = await callBotApi(api, `${inlineBot.botApiPath}/editMessageText`, {
    inline_message_id: inlineMessageId,
    text: 'Cats also purr',
  });
  assertEqualsInFieldOrder(
    editResponse.body,
    { ok: true, result: true },
    'Expected the inline edit to answer true',
  );
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
  assertEquals(failureDescriptions, [
    'Bad Request: message is not modified: specified new message content and reply markup are exactly the same as a current content and reply markup of the message',
    'Bad Request: MESSAGE_ID_INVALID',
    'Bad Request: MESSAGE_ID_INVALID',
    'Bad Request: there is no caption in the message to edit',
    'Bad Request: message identifier is not specified',
  ], "Expected Telegram's inline edit errors");

  // As in TDLib, the inline bot also edits the message by its chat, which answers the message.
  const chatEditResponse = await callBotApi(api, `${inlineBot.botApiPath}/editMessageText`, {
    chat_id: account.id,
    message_id: message.message_id,
    text: 'Cats',
  });
  const chatEditResult = botApiResult(chatEditResponse.body);
  if (
    chatEditResponse.status !== 200 ||
    chatEditResult === undefined ||
    chatEditResult.message_id !== message.message_id ||
    chatEditResult.text !== 'Cats'
  ) {
    throw new Error(
      `Expected the inline bot to edit the message by its chat, received ${
        JSON.stringify(chatEditResponse.body)
      }`,
    );
  }
  assertEqualsInFieldOrder(
    chatEditResult.from,
    message.from,
    'Expected the inline bot to edit the message by its chat',
  );
  assertEqualsInFieldOrder(
    chatEditResult.via_bot,
    message.via_bot,
    'Expected the inline bot to edit the message by its chat',
  );
});

Deno.test('repeated inline queries reuse the answer within its cache time', async () => {
  await using testSession = await createTestSession();
  const { api, sessionPath } = testSession;
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
    adaRepeat.status !== 'answered' ||
    adaRepeat.answer?.results.length !== 1 ||
    graceQuery.status !== 'awaiting_answer'
  ) {
    throw new Error(
      `Expected the personal answer to be reused only for Ada, received ${JSON.stringify(updates)}`,
    );
  }
  assertEqualsInFieldOrder(
    updates.map((update) => (update.inline_query as { from: { id: number } }).from.id),
    [ada.id, grace.id],
    'Expected the personal answer to be reused only for Ada',
  );

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
  await using testSession = await createTestSession();
  const { api, sessionPath } = testSession;
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
  if (queryResponse.status !== 201) {
    throw new Error(
      `Expected the bot to receive the account's location, received ${JSON.stringify(queryUpdate)}`,
    );
  }
  assertEqualsInFieldOrder(
    inlineQuery.location,
    expectedLocation,
    "Expected the bot to receive the account's location",
  );
  assertEqualsInFieldOrder(queryUpdate?.inline_query, {
    id: inlineQuery.id,
    from: account,
    location: expectedLocation,
    chat_type: 'sender',
    query: 'cafes',
    offset: '',
  }, "Expected the bot to receive the account's location");

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
  assertEqualsInFieldOrder(chosenResultUpdate?.chosen_inline_result, {
    from: account,
    location: expectedLocation,
    query: 'cafes',
    result_id: 'cafe-1',
  }, 'Expected the chosen result to carry the location');

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
  if ((await readUpdates(nearbyBot.botApiPath)).length !== 2) {
    throw new Error(`Expected the answer reused only at the same place, received ${statuses}`);
  }
  assertEquals(
    statuses,
    ['answered', 'awaiting_answer', 'awaiting_answer'],
    'Expected the answer reused only at the same place',
  );

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
  await using fixture = await createPrivateConversationFixture();
  const { api, sessionPath, createdBot: plainBot, createdAccount, sendText } = fixture;
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
  assertEquals(
    queryFailures.map((response) => response.status),
    [409, 404, 404, 400, 404],
    'Expected inline queries to be refused',
  );

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
      results: [
        article('1', {
          input_message_content: { latitude: 1, longitude: 2, title: 'Cafe', address: 'Main St' },
        }),
      ],
    }),
    await answer({
      results: [
        article('1', { input_message_content: { message_text: 'a.b', parse_mode: 'MarkdownV2' } }),
      ],
    }),
    await answer({
      results: [{
        type: 'document',
        id: '1',
        title: 'Cats',
        document_url: 'https://example.com/cats.txt',
        mime_type: 'text/plain',
      }],
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
  assertEqualsInFieldOrder(answerFailures, [
    'Bad Request: RESULT_ID_DUPLICATE',
    'Bad Request: too many inline query results specified',
    'Bad Request: inline query results of type "gif" are not supported',
    `Bad Request: can't parse InlineQueryResult: type "poll" is unsupported for the inline query result`,
    "Bad Request: can't parse InlineQueryResult: Input message content is not specified",
    'Bad Request: inline query results sending a venue or invoice are not supported',
    "Bad Request: can't parse InlineQueryResult: Can't parse entities: Character '.' is reserved and must be escaped with the preceding '\\'",
    'Bad Request: unallowed document MIME type',
    "Bad Request: wrong remote file identifier specified: can't unserialize it",
    "Bad Request: wrong remote file identifier specified: can't unserialize it",
    'Bad Request: unallowed characters in start_parameter are used',
    'Bad Request: NEXT_OFFSET_INVALID',
    'Bad Request: RESULT_ID_EMPTY',
    "Bad Request: inline keyboard button URL 'go' is invalid: Wrong HTTP URL",
    'Bad Request: invalid answerInlineQuery parameters: results',
    'Bad Request: query is too old and response timeout expired or query ID is invalid',
  ], "Expected Telegram's answerInlineQuery errors");

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
  if (blockResponse.status !== 204) {
    throw new Error(`Expected results to be refused, received ${chooseFailures}`);
  }
  assertEquals(chooseFailures, [400, 409, 404, 404], 'Expected results to be refused');
});

Deno.test('inline query results send rich messages that reuse files', async () => {
  await using testSession = await createTestSession();
  const { api, sessionPath } = testSession;
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
    message.rich_message?.blocks.length !== 3 ||
    message.via_bot === undefined ||
    !JSON.stringify(message.rich_message).includes('"type":"url"') ||
    press.status !== 201 ||
    callbackQuery?.inline_message_id === undefined ||
    callbackQuery.data !== 'more'
  ) {
    throw new Error(
      `Expected the chosen rich message and its callback, received ${
        JSON.stringify([answered, message, press.status, callbackQuery])
      }`,
    );
  }
  assertEqualsInFieldOrder(
    answered.body,
    { ok: true, result: true },
    'Expected the chosen rich message and its callback',
  );

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
  assertEquals(refusals, [
    'Bad Request: invalid inline message content specified',
    'Bad Request: BUTTON_DATA_INVALID',
    "Bad Request: wrong remote file identifier specified: can't unserialize it",
    'Bad Request: invalid inline message content specified',
    'Bad Request: invalid answerInlineQuery parameters',
  ], "Expected Telegram's errors");
});

Deno.test('a grammY bot answers inline queries and edits the message it sent to a group', async () => {
  await using fixture = await createSupergroupFixture();
  const { api, sessionPath, owner, supergroup, supergroupPath } = fixture;
  const inlineBot = await createBot(api, sessionPath, 'cats_bot', {
    supports_inline_queries: true,
    receives_chosen_inline_results: true,
  });
  const ownerPath = `${sessionPath}/accounts/${owner.id}`;
  const grammyBot = new Bot(inlineBot.token, {
    client: {
      apiRoot: `${TEST_PUBLIC_ORIGIN}${sessionPath}/bot-api`,
      fetch: api.fetch,
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
    assertEquals(answer.results.map(({ id }) => id), ['fact', 'photo'], 'Expected both results');

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
