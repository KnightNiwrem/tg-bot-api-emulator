import { assertEquals } from '@std/assert';
import { Bot } from 'https://cdn.jsdelivr.net/gh/grammyjs/grammY@^1.46.0/src/bot.ts';
import { GrammyError } from 'https://cdn.jsdelivr.net/gh/grammyjs/grammY@^1.46.0/src/core/error.ts';

import { jsonRequest, TEST_PUBLIC_ORIGIN } from '../support/emulation_api.ts';
import { assertEqualsInFieldOrder } from '../support/field_order_assertion.ts';
import { isBadRequestResponse, isMessageHistoryResponse } from '../support/http_response_guards.ts';
import { botApiResult, callBotApi, updateMessages } from '../support/bot_api_requests.ts';
import { createAccount, createPrivateConversationFixture } from '../support/http_fixtures.ts';
import { gifImage } from '../support/media_samples.ts';

Deno.test('grammY command handlers match account-sent bot commands', async () => {
  await using fixture = await createPrivateConversationFixture();
  const { api, sessionPath, createdBot, sendText } = fixture;

  for (const text of ['/start', '/start@test_bot payload', 'hello /start']) {
    await sendText(text);
  }

  const grammyBot = new Bot(createdBot.token, {
    client: {
      apiRoot: `${TEST_PUBLIC_ORIGIN}${sessionPath}/bot-api`,
      fetch: api.fetch,
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
  assertEquals(
    startCommandPayloads,
    ['', 'payload'],
    'Expected the start handler to run for leading commands',
  );
});

Deno.test('messages carry the entities Telegram detects in their text', async () => {
  await using fixture = await createPrivateConversationFixture();
  const { api, sessionPath, botApiPath, createdBot, createdAccount } = fixture;
  const accountId = createdAccount.account.id;
  const grammyBot = new Bot(createdBot.token, {
    client: {
      apiRoot: `${TEST_PUBLIC_ORIGIN}${sessionPath}/bot-api`,
      fetch: api.fetch,
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
    assertEquals(
      receivedLinks,
      ['https://grammy.dev/guide', 'grammy.dev'],
      'Expected the bot to receive both links',
    );
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
  assertEqualsInFieldOrder(
    botApiResult(reply.body)?.entities,
    expectedEntities,
    'Expected detected entities instead of the supplied one',
  );
});

Deno.test('accounts send and edit text and captions with the formatting they choose', async () => {
  await using fixture = await createPrivateConversationFixture();
  const { api, sessionPath, botApiPath, createdBot, createdAccount } = fixture;
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
  assertEqualsInFieldOrder(formattingSeen, [
    expectedTextEntities,
    expectedTextEntities,
    expectedCaptionEntities,
    expectedCaptionEntities,
  ], 'Expected the chosen formatting');

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
  assertEqualsInFieldOrder(editedFormatting, [
    expectedEditedText,
    expectedEditedText,
    expectedEditedCaption,
    expectedEditedCaption,
  ], 'Expected the edited formatting');

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
  if (history.messages.length !== 2) {
    throw new Error(
      `Expected rejected formatting to store nothing, received ${
        JSON.stringify({ rejectedStatuses, stored: history.messages.length })
      }`,
    );
  }
  assertEquals(
    rejectedStatuses,
    [400, 400, 400, 400, 400, 400],
    'Expected rejected formatting to store nothing',
  );
});

Deno.test('sendMessage and editMessageText format text from parse_mode or entities', async () => {
  await using fixture = await createPrivateConversationFixture();
  const { api, sessionPath, botApiPath, createdBot, createdAccount, sendText } = fixture;
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
  if (htmlMessage?.text !== 'Hello, Ada! Docs\nbot.start();') {
    throw new Error(
      `Expected the HTML to be parsed, received ${JSON.stringify(htmlResponse.body)}`,
    );
  }
  assertEqualsInFieldOrder(
    htmlMessage.entities,
    expectedHtmlEntities,
    'Expected the HTML to be parsed',
  );

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
  assertEqualsInFieldOrder(entitiesMessage?.entities, [
    { type: 'bot_command', offset: 4, length: 6 },
    { type: 'italic', offset: 9, length: 1 },
    { type: 'italic', offset: 10, length: 2 },
  ], 'Expected specified and detected entities');

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
    typeof editedMessage.edit_date !== 'number'
  ) {
    throw new Error(
      `Expected the edit to apply formatting, received ${JSON.stringify(editResponse.body)}`,
    );
  }
  assertEqualsInFieldOrder(
    editedMessage.entities,
    [{ type: 'bold', offset: 6, length: 4 }],
    'Expected the edit to apply formatting',
  );
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
  assertEqualsInFieldOrder(
    storedEdit?.entities,
    editedMessage.entities,
    'Expected history to show the formatted edit',
  );
});

Deno.test('sendMessage reads and reports date and time entities as Telegram does', async () => {
  await using fixture = await createPrivateConversationFixture();
  const { api, botApiPath, createdAccount, sendText } = fixture;
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
  assertEqualsInFieldOrder(htmlMessage?.entities, expectedHtmlEntities, 'Expected a date entity');

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
  assertEquals(reportedFormats, ['T', 'w', '', 'r'], 'Expected normalized formats');

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
  await using fixture = await createPrivateConversationFixture();
  const { api, sessionPath, createdBot, createdAccount, sendText } = fixture;
  const grammyBot = new Bot(createdBot.token, {
    client: {
      apiRoot: `${TEST_PUBLIC_ORIGIN}${sessionPath}/bot-api`,
      fetch: api.fetch,
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
    if (reply?.text !== 'Welcome, Ada!') {
      throw new Error(
        `Expected the formatted welcome as the last message, received ${JSON.stringify(reply)}`,
      );
    }
    assertEqualsInFieldOrder(
      reply.entities,
      [{ type: 'bold', offset: 0, length: 7 }],
      'Expected the formatted welcome as the last message',
    );
  } finally {
    await grammyBot.stop();
    await polling;
  }
});
