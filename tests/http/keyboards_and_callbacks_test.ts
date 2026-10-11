import { assertEquals } from '@std/assert';
import { Bot } from 'https://cdn.jsdelivr.net/gh/grammyjs/grammY@^1.46.0/src/bot.ts';
import {
  InlineKeyboard,
  Keyboard,
} from 'https://cdn.jsdelivr.net/gh/grammyjs/grammY@^1.46.0/src/convenience/keyboard.ts';

import { createTestSession, jsonRequest, TEST_PUBLIC_ORIGIN } from '../support/emulation_api.ts';
import { assertEqualsInFieldOrder } from '../support/field_order_assertion.ts';
import { expectSettlementWithin } from '../support/settlement.ts';
import {
  isBadRequestResponse,
  isGetUpdatesResponse,
  isMessageHistoryResponse,
  isSentMessageResponse,
} from '../support/http_response_guards.ts';
import { botApiResult, callBotApi, createUpdateReader } from '../support/bot_api_requests.ts';
import {
  createAccount,
  createBot,
  createPrivateConversationFixture,
  createSupergroupFixture,
} from '../support/http_fixtures.ts';

Deno.test('sendMessage attaches an inline keyboard from every request encoding', async () => {
  await using fixture = await createPrivateConversationFixture();
  const { api, sessionPath, botApiPath, createdBot, createdAccount, sendText } = fixture;
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
  const expectedMarkup = { inline_keyboard: inlineKeyboard };
  assertEqualsInFieldOrder(
    [
      [jsonReply.status, botApiResult(jsonReply.body)?.reply_markup],
      [formReply.status, botApiResult(await formReply.json())?.reply_markup],
      [emptyKeyboardReply.status, botApiResult(emptyKeyboardReply.body)?.reply_markup],
    ],
    [[200, expectedMarkup], [200, expectedMarkup], [200, undefined]],
    'Expected the keyboard in replies, and no keyboard for an empty one',
  );
  const historyBody: unknown = await (await api.request(
    `${sessionPath}/accounts/${accountId}/conversations/private/${createdBot.bot.id}/messages`,
  )).json();
  if (!isMessageHistoryResponse(historyBody)) {
    throw new Error('Expected the message history');
  }
  assertEqualsInFieldOrder(
    historyBody.messages[1].reply_markup,
    expectedMarkup,
    'Expected history to show the inline keyboard',
  );

  const invalidMarkups: unknown[] = [
    { inline_keyboard: [[{ text: 'Plain' }]] },
    { inline_keyboard: [[{ text: 'Empty', callback_data: '' }]] },
    { inline_keyboard: [[{ text: 'Both', callback_data: 'yes', url: 'https://grammy.dev' }]] },
    { inline_keyboard: [[{ text: 'Pay', pay: true }]] },
    { inline_keyboard: [[]] },
  ];
  for (const replyMarkup of invalidMarkups) {
    const { status, body } = await callBotApi(api, `${botApiPath}/sendMessage`, {
      chat_id: accountId,
      text: 'Hello',
      reply_markup: replyMarkup,
    });
    if (
      status !== 400 || !isBadRequestResponse(body) ||
      !body.description.startsWith('Bad Request: invalid sendMessage parameters: reply_markup')
    ) {
      throw new Error(`Expected ${JSON.stringify(replyMarkup)} to be rejected at reply_markup`);
    }
  }
  const unparsableMarkup = await callBotApi(api, `${botApiPath}/sendMessage`, {
    chat_id: accountId,
    text: 'Hello',
    reply_markup: 'not JSON',
  });
  if (
    unparsableMarkup.status !== 400 || !isBadRequestResponse(unparsableMarkup.body) ||
    unparsableMarkup.body.description !==
      "Bad Request: can't parse reply keyboard markup JSON object"
  ) {
    throw new Error("Expected markup that is not JSON to be rejected with Telegram's description");
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
  await using fixture = await createPrivateConversationFixture();
  const { api, botApiPath, createdAccount, sendText } = fixture;
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
  if (reply.status !== 200) {
    throw new Error(`Expected Telegram's normalized links, received ${JSON.stringify(sentUrls)}`);
  }
  assertEqualsInFieldOrder(sentUrls, expectedUrls, "Expected Telegram's normalized links");

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
  await using fixture = await createPrivateConversationFixture();
  const { api, sessionPath, botApiPath, createdBot, createdAccount, sendText } = fixture;
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
  if (reply.status !== 200) {
    throw new Error(
      `Expected the buttons as Telegram shows them, received ${JSON.stringify(reply)}`,
    );
  }
  assertEqualsInFieldOrder(
    sentMessage?.reply_markup,
    { inline_keyboard: [expectedButtons] },
    'Expected the buttons as Telegram shows them',
  );

  const history = await (await api.request(
    `${sessionPath}/accounts/${accountId}/conversations/private/${createdBot.bot.id}/messages`,
  )).json() as { messages: Array<{ message_id: number; reply_markup?: unknown }> };
  const accountView = history.messages.find(({ message_id }) =>
    message_id === sentMessage?.message_id
  );
  assertEqualsInFieldOrder(
    accountView?.reply_markup,
    { inline_keyboard: [expectedButtons] },
    'Expected the account to see the buttons',
  );

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
  await using fixture = await createPrivateConversationFixture();
  const { api, botApiPath, createdAccount, sendText } = fixture;
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
  assertEqualsInFieldOrder(sentMessage?.reply_markup, {
    inline_keyboard: [[
      { text: 'Log in', url: 'https://grammy.dev/login' },
      { text: 'Open', web_app: { url: 'https://grammy.dev/app' } },
    ]],
  }, 'Expected a login button shown by its URL');

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
  const { bot_username: _authorizingBot, ...loginUrlWithoutBot } = {
    ...loginButton.login_url,
    forward_text: 'Sign in',
  };
  const emptyBotEdit = await editLoginButton({ ...loginUrlWithoutBot, bot_username: '' });
  const omittedBotEdit = await editLoginButton(loginUrlWithoutBot);
  if (
    emptyBotEdit.status !== 200 || !isBadRequestResponse(omittedBotEdit.body) ||
    !omittedBotEdit.body.description.startsWith('Bad Request: message is not modified')
  ) {
    throw new Error(
      `Expected an empty bot username to remove the bot like an omitted one, received ${
        JSON.stringify([emptyBotEdit, omittedBotEdit])
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
  assertEqualsInFieldOrder(forwardedMarkups, [
    { inline_keyboard: [[{ text: 'Sign in', url: 'https://grammy.dev/login' }]] },
    undefined,
  ], 'Expected forwards to keep only login buttons, with their forward text');

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
      { text: 'Log in', login_url: { url: 'https://grammy.dev', bot_username: '@@test_bot' } },
      'Bad Request: loginUrl bot username is invalid',
    ],
    [
      { text: 'Log in', login_url: { url: 'https://grammy.dev', bot_username: '@' } },
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
  await using fixture = await createSupergroupFixture();
  const { api, owner, bot, supergroup, supergroupPath } = fixture;
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
    history.messages.filter(({ text }) => text === 'Play').length !== 1
  ) {
    throw new Error(
      `Expected only the login button in the supergroup, received ${
        JSON.stringify([loginSend, descriptions, history])
      }`,
    );
  }
  assertEquals(descriptions, [
    'Bad Request: BUTTON_TYPE_INVALID',
    'Bad Request: BUTTON_TYPE_INVALID',
    'Bad Request: BUTTON_TYPE_INVALID',
    'Bad Request: bot username must be empty for login_url buttons in rich messages',
  ], 'Expected only the login button in the supergroup');
});

Deno.test('forwards keep switch-inline buttons only of messages sent through an inline bot', async () => {
  await using testSession = await createTestSession();
  const { api, sessionPath } = testSession;
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
  assertEqualsInFieldOrder(
    forwardedMarkups,
    expectedMarkups,
    "Expected a switch to any chat only on the inline message's forward",
  );
});

Deno.test('keyboard buttons keep their style and custom emoji icon', async () => {
  await using fixture = await createPrivateConversationFixture();
  const { api, sessionPath, botApiPath, createdBot, createdAccount, sendText } = fixture;
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
  if (styledReply.status !== 200) {
    throw new Error(`Expected the buttons' appearance, received ${JSON.stringify(styledMessage)}`);
  }
  assertEqualsInFieldOrder(
    styledMessage?.reply_markup,
    expectedMarkup,
    "Expected the buttons' appearance",
  );

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
  if (keyboardReply.status !== 200) {
    throw new Error(
      `Expected the account to see the reply buttons' appearance, received ${
        JSON.stringify(replyInterfaceBody)
      }`,
    );
  }
  assertEqualsInFieldOrder(replyInterfaceBody.reply_interface?.keyboard, [[
    { text: 'Plain' },
    { text: 'Stop', icon_custom_emoji_id: iconId, style: 'danger' },
  ]], "Expected the account to see the reply buttons' appearance");

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
  await using fixture = await createPrivateConversationFixture();
  const { api, sessionPath, botApiPath, createdBot, createdAccount, sendText } = fixture;
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
    typeof callbackQuery.chat_instance !== 'string' ||
    callbackQuery.data !== 'yes' ||
    callbackMessage?.message_id !== replyMessageId ||
    callbackMessage?.text !== 'Continue?'
  ) {
    throw new Error(`Expected a callback_query update, received ${JSON.stringify(updatesBody)}`);
  }
  assertEqualsInFieldOrder(
    callbackQuery.from,
    createdAccount.account,
    'Expected a callback_query update',
  );

  const startLink = `https://t.me/${createdBot.bot.username}?start=saved`;
  const answerResponse = await callBotApi(api, `${botApiPath}/answerCallbackQuery`, {
    callback_query_id: callbackQueryId,
    text: 'Saved',
    show_alert: true,
    url: startLink,
  });
  assertEqualsInFieldOrder(
    answerResponse.body,
    { ok: true, result: true },
    'Expected the answer to be accepted',
  );
  const answeredBody: unknown = await (await api.request(
    `${callbackQueriesPath}/${callbackQueryId}`,
  )).json();
  if (!isCallbackQueryResponse(answeredBody)) {
    throw new Error(
      `Expected the account to see the answer, received ${JSON.stringify(answeredBody)}`,
    );
  }
  assertEqualsInFieldOrder(answeredBody.callback_query.answer, {
    text: 'Saved',
    show_alert: true,
    url: startLink,
    cache_time: 0,
  }, 'Expected the account to see the answer');

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
  assertEquals(
    pressFailures.map((response) => response.status),
    [404, 404, 400, 400, 404, 404],
    'Expected missing resources and bad presses to be rejected',
  );
});

Deno.test('a callback query created expired reaches the bot but refuses its answer', async () => {
  await using fixture = await createPrivateConversationFixture();
  const { api, sessionPath, botApiPath, createdBot, createdAccount, sendText } = fixture;
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
  await using fixture = await createPrivateConversationFixture();
  const { api, botApiPath, createdAccount, sendText } = fixture;
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
    textEdit.status !== 200 ||
    textEditResult?.text !== 'Done' ||
    typeof textEditResult.edit_date !== 'number'
  ) {
    throw new Error('Expected editMessageText to replace the text and keyboard with an edit date');
  }
  assertEqualsInFieldOrder(
    textEditResult.reply_markup,
    keyboard,
    'Expected editMessageText to replace the text and keyboard with an edit date',
  );
});

Deno.test('a grammY bot answers an inline keyboard press and edits its message', async () => {
  await using fixture = await createPrivateConversationFixture();
  const { api, sessionPath, createdBot, createdAccount, sendText } = fixture;
  const accountId = createdAccount.account.id;
  const grammyBot = new Bot(createdBot.token, {
    client: {
      apiRoot: `${TEST_PUBLIC_ORIGIN}${sessionPath}/bot-api`,
      fetch: api.fetch,
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

Deno.test("sendMessage changes the reply interface the account's client shows", async () => {
  await using fixture = await createPrivateConversationFixture();
  const { api, sessionPath, botApiPath, createdBot, createdAccount, sendText } = fixture;
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
  assertEqualsInFieldOrder(await readReplyInterface(), expectedKeyboard, 'Expected the keyboard');

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
  if (!isGetUpdatesResponse(updatesBody)) {
    throw new Error('Expected the bot to receive the pressed button text as a message');
  }
  assertEqualsInFieldOrder(
    updatesBody.result.at(-1)?.message,
    pressBody.message,
    'Expected the bot to receive the pressed button text as a message',
  );

  await sendMarkup({ force_reply: true, input_field_placeholder: 'Your name' });
  assertEqualsInFieldOrder(await readReplyInterface(), {
    type: 'force_reply',
    message_id: 4,
    input_field_placeholder: 'Your name',
  }, 'Expected a forced reply to replace the keyboard');
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
      !body.description.startsWith('Bad Request: invalid sendMessage parameters: reply_markup')
    ) {
      throw new Error(`Expected ${JSON.stringify(replyMarkup)} to be rejected at reply_markup`);
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
  await using fixture = await createPrivateConversationFixture();
  const { api, sessionPath, botApiPath, createdBot, createdAccount, sendText } = fixture;
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
  if (sent.status !== 200) {
    throw new Error(
      `Expected the account to see every request, received ${
        JSON.stringify([sent, replyInterface])
      }`,
    );
  }
  assertEqualsInFieldOrder(
    replyInterface?.keyboard,
    expectedKeyboard,
    'Expected the account to see every request',
  );

  const press = await api.request(
    `${accountPath}/reply-keyboard-presses`,
    jsonRequest('POST', { chat: { type: 'private', botId: createdBot.bot.id }, text: 'Quiz' }),
  );
  if (press.status !== 400) {
    throw new Error(`Expected a poll request button to be unanswerable, received ${press.status}`);
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

  await using group = await createSupergroupFixture();
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
  await using fixture = await createPrivateConversationFixture();
  const { api, sessionPath, createdBot, createdAccount, sendText } = fixture;
  const accountPath = `${sessionPath}/accounts/${createdAccount.account.id}`;
  const grammyBot = new Bot(createdBot.token, {
    client: {
      apiRoot: `${TEST_PUBLIC_ORIGIN}${sessionPath}/bot-api`,
      fetch: api.fetch,
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
    assertEqualsInFieldOrder(
      menu?.keyboard,
      [[{ text: 'Rename' }, { text: 'Quit' }]],
      'Expected the menu keyboard',
    );
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

Deno.test('bots show reply keyboards and forced replies to all or chosen supergroup members', async () => {
  await using fixture = await createSupergroupFixture();
  const { api, sessionPath, owner, member, bot, readerBot, supergroup, supergroupPath } = fixture;
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
  assertEqualsInFieldOrder(shownAfterSelectiveMarkup, [
    null,
    { type: 'force_reply', message_id: forcedReply?.message_id },
  ], 'Expected selective markup to reach only its targets');

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
