import { isBadRequestResponse } from '../support/http_response_guards.ts';
import { callBotApi } from '../support/bot_api_requests.ts';
import {
  createAccount,
  createPrivateConversationFixture,
  createSupergroupFixture,
} from '../support/http_fixtures.ts';

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
