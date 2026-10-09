import { Bot } from 'https://cdn.jsdelivr.net/gh/grammyjs/grammY@^1.46.0/src/bot.ts';
import { run } from '@grammyjs/runner/runner.ts';

import { createEmulationApi } from '../src/api/mod.ts';
import { createSessionLifecycleService } from '../src/composition/session_lifecycle.ts';
import {
  EmulationClientError,
  type EmulationSessionClient,
  type PressReplyKeyboardButtonInput,
  type PrivateMessageTarget,
  TelegramEmulationClient,
} from '../clients/typescript/mod.ts';

const PUBLIC_ORIGIN = 'http://emulator.example:9000';

/** Every administrator right that grammY's `ChatAdministratorRights` requires, none held. */
const NO_ADMINISTRATOR_RIGHTS = {
  is_anonymous: false,
  can_manage_chat: false,
  can_delete_messages: false,
  can_manage_video_chats: false,
  can_restrict_members: false,
  can_promote_members: false,
  can_change_info: false,
  can_invite_users: false,
  can_post_stories: false,
  can_edit_stories: false,
  can_delete_stories: false,
  can_send_welcome_messages: false,
};

Deno.test('a grammY bot receives the users an account shares through a request_users button', async () => {
  const { session, fetch, bot, ada, grace, linus, privateChat } = await createSharingFixture();
  const grammyBot = new Bot(bot.token, { client: { apiRoot: session.botApiRoot, fetch } });
  grammyBot.command('team', (context) =>
    context.reply('Who joins the team?', {
      reply_markup: {
        keyboard: [[{
          text: 'Choose teammates',
          request_users: {
            request_id: 41,
            user_is_bot: false,
            max_quantity: 2,
            request_name: true,
            request_username: true,
          },
        }]],
      },
    }));
  grammyBot.on('message:users_shared', (context) => {
    const { users, request_id } = context.msg.users_shared;
    return context.reply(
      `Request ${request_id}: ${users.map((user) => user.username ?? user.first_name).join(', ')}`,
      { reply_parameters: { message_id: context.msg.message_id } },
    );
  });
  const activity = session.botActivity({ bot_id: bot.id });
  const start = await activity.position();
  const runner = run(grammyBot);

  try {
    await ada.sendMessage({ to: privateChat, text: '/team' });
    await activity.waitFor({
      method: 'sendMessage',
      chat_id: ada.id,
      parameters: { text: 'Who joins the team?' },
    }, { after: start });

    const shared = await ada.pressReplyKeyboardButton({
      chat: privateChat,
      text: 'Choose teammates',
      shared_user_ids: [linus.id, grace.id],
    });
    expectEqual(shared.users_shared, {
      user_ids: [linus.id, grace.id],
      users: [
        { user_id: linus.id, first_name: 'Linus', last_name: 'Torvalds', username: 'linus' },
        { user_id: grace.id, first_name: 'Grace' },
      ],
      request_id: 41,
    }, 'Expected the requested names and usernames of both users');
    if (
      shared.from.id !== ada.id || shared.user_shared !== undefined ||
      shared.reply_to_message !== undefined || shared.text !== undefined
    ) {
      throw new Error(`Expected a service message of Ada, received ${JSON.stringify(shared)}`);
    }
    await activity.waitFor({
      method: 'sendMessage',
      chat_id: ada.id,
      parameters: { text: 'Request 41: linus, Grace' },
    }, { after: start });

    const alone = await ada.pressReplyKeyboardButton({
      chat: privateChat,
      text: 'Choose teammates',
      shared_user_ids: [grace.id],
    });
    expectEqual(
      [alone.user_shared, alone.users_shared?.user_ids],
      [{ user_id: grace.id, request_id: 41 }, [grace.id]],
      'Expected a single shared user to also show as the legacy user_shared',
    );
    await activity.waitFor({
      method: 'sendMessage',
      chat_id: ada.id,
      parameters: { text: 'Request 41: Grace' },
    }, { after: start });

    const history = await ada.getMessages({ chat: privateChat });
    expectEqual(
      history.filter((message) => message.users_shared !== undefined).map((message) =>
        message.message_id
      ),
      [shared.message_id, alone.message_id],
      'Expected the account history to show both service messages',
    );
    const answer = history.find((message) =>
      message.from.id === bot.id && message.reply_to_message?.message_id === shared.message_id
    );
    expectEqual(
      answer?.reply_to_message?.users_shared,
      shared.users_shared,
      'Expected the bot to reply to the service message, which the reply shows',
    );
  } finally {
    await runner.stop();
    await session.end();
  }
});

Deno.test('a grammY bot receives a supergroup that meets its request_chat criteria', async () => {
  const { session, fetch, bot, ada, privateChat } = await createSharingFixture();
  const team = await ada.createSupergroup({ title: 'Team', username: 'team_chat' });
  const teamChat = { type: 'supergroup', chatId: team.id } as const;
  await ada.addChatMember({ chat: teamChat, userId: bot.id });
  await ada.promoteChatMember({
    chat: teamChat,
    userId: bot.id,
    rights: { can_pin_messages: true },
  });

  const grammyBot = new Bot(bot.token, { client: { apiRoot: session.botApiRoot, fetch } });
  grammyBot.command('setup', (context) =>
    context.reply('Which group should I manage?', {
      reply_markup: {
        keyboard: [[{
          text: 'Choose a group',
          request_chat: {
            request_id: 5,
            chat_is_channel: false,
            chat_has_username: true,
            chat_is_created: true,
            bot_administrator_rights: { ...NO_ADMINISTRATOR_RIGHTS, can_pin_messages: true },
            bot_is_member: true,
            request_title: true,
          },
        }]],
      },
    }));
  grammyBot.on('message:chat_shared', async (context) => {
    const { chat_id, title } = context.msg.chat_shared;
    await context.api.sendMessage(chat_id, `Now managing ${title}`);
  });
  const activity = session.botActivity({ bot_id: bot.id });
  const start = await activity.position();
  const runner = run(grammyBot);

  try {
    await ada.sendMessage({ to: privateChat, text: '/setup' });
    await activity.waitFor({
      method: 'sendMessage',
      chat_id: ada.id,
      parameters: { text: 'Which group should I manage?' },
    }, { after: start });

    const shared = await ada.pressReplyKeyboardButton({
      chat: privateChat,
      text: 'Choose a group',
      shared_chat_id: team.id,
    });
    // The request asked for the title but not the username, which stays omitted.
    expectEqual(
      shared.chat_shared,
      { chat_id: team.id, title: 'Team', request_id: 5 },
      'Expected the shared supergroup with its title only',
    );
    await activity.waitFor({
      method: 'sendMessage',
      chat_id: team.id,
      ok: true,
      parameters: { text: 'Now managing Team' },
    }, { after: start });
  } finally {
    await runner.stop();
    await session.end();
  }
});

Deno.test('shared users and chats answer their own buttons among buttons that share a label', async () => {
  const fixture = await createSharingFixture();
  const { session, bot, ada, grace, privateChat } = fixture;
  const callBot = createBotApiCaller(fixture);
  const team = await ada.createSupergroup({ title: 'Team' });
  await ada.addChatMember({ chat: { type: 'supergroup', chatId: team.id }, userId: bot.id });
  const shown = await callBot('sendMessage', {
    chat_id: ada.id,
    text: 'Share something',
    reply_markup: {
      keyboard: [
        [{ text: 'Share' }],
        [
          { text: 'Share', request_users: { request_id: 7 } },
          {
            text: 'Share',
            request_chat: { request_id: 8, chat_is_channel: false, bot_is_member: true },
          },
        ],
        [
          { text: 'Pick', request_users: { request_id: 1 } },
          { text: 'Pick', request_users: { request_id: 2 } },
        ],
      ],
    },
  });
  if (!shown.ok) {
    throw new Error(`Expected the keyboard to be sent: ${shown.description}`);
  }

  const historyBeforeRefusal = await ada.getMessages({ chat: privateChat });
  await expectRefused(
    ada.pressReplyKeyboardButton({ chat: privateChat, text: 'Pick', shared_user_ids: [grace.id] }),
    400,
    'users requests with different IDs under one label',
  );
  expectEqual(
    await ada.getMessages({ chat: privateChat }),
    historyBeforeRefusal,
    'Expected an ambiguous press to send nothing',
  );

  const chat = await ada.pressReplyKeyboardButton({
    chat: privateChat,
    text: 'Share',
    shared_chat_id: team.id,
  });
  const users = await ada.pressReplyKeyboardButton({
    chat: privateChat,
    text: 'Share',
    shared_user_ids: [grace.id],
  });
  const text = await ada.pressReplyKeyboardButton({ chat: privateChat, text: 'Share' });
  expectEqual(
    [chat.chat_shared, users.users_shared?.request_id, text.text],
    [{ chat_id: team.id, request_id: 8 }, 7, 'Share'],
    'Expected each answer to reach its own button, and no answer the text button',
  );
  await session.end();
});

Deno.test('refused selections create no message or update and leave the request in place', async () => {
  const fixture = await createSharingFixture();
  const { session, bot, ada, grace, privateChat } = fixture;
  const callBot = createBotApiCaller(fixture);
  const team = await ada.createSupergroup({ title: 'Team' });
  const teamChat = { type: 'supergroup', chatId: team.id } as const;
  await ada.addChatMember({ chat: teamChat, userId: grace.id });
  await ada.addChatMember({ chat: teamChat, userId: bot.id });
  const otherGroup = await ada.createSupergroup({ title: 'Other' });
  const strangersGroup = await grace.createSupergroup({ title: 'Strangers' });
  await grace.sendMessage({ to: privateChat, text: '/start' });
  const keyboard = [
    [{
      text: 'People',
      request_users: { request_id: 1, user_is_bot: false, max_quantity: 2 },
    }, {
      text: 'Premium people',
      request_users: { request_id: 2, user_is_premium: true },
    }],
    [{
      text: 'Public group',
      request_chat: { request_id: 3, chat_is_channel: false, chat_has_username: true },
    }, {
      text: 'Pinning group',
      request_chat: {
        request_id: 4,
        chat_is_channel: false,
        user_administrator_rights: { can_promote_members: true },
        bot_administrator_rights: { can_pin_messages: true },
      },
    }],
    [{
      text: 'Group with bot',
      request_chat: { request_id: 5, chat_is_channel: false, bot_is_member: true },
    }, {
      text: 'Admin bot group',
      request_chat: {
        request_id: 6,
        chat_is_channel: false,
        bot_administrator_rights: { can_pin_messages: true },
      },
    }],
    [{
      text: 'Channel',
      request_chat: { request_id: 7, chat_is_channel: true },
    }, {
      text: 'Forum',
      request_chat: { request_id: 8, chat_is_channel: false, chat_is_forum: true },
    }],
    [{ text: 'Plain' }],
  ];
  for (const chatId of [ada.id, grace.id]) {
    await callBot('sendMessage', {
      chat_id: chatId,
      text: 'Choose',
      reply_markup: { keyboard },
    });
  }
  const pendingUpdates = await callBot('getUpdates', {});
  const unreadOffset =
    ((pendingUpdates.result as Array<{ update_id: number }>).at(-1)?.update_id ?? 0) + 1;
  await callBot('getUpdates', { offset: unreadOffset });
  const adaHistoryBefore = await ada.getMessages({ chat: privateChat });
  const graceHistoryBefore = await grace.getMessages({ chat: privateChat });

  const press = (text: string, answer: Partial<PressReplyKeyboardButtonInput>) => ({
    chat: privateChat,
    text,
    ...answer,
  });
  const refusals: Array<[string, PressReplyKeyboardButtonInput, number]> = [
    ['too many users', press('People', { shared_user_ids: [grace.id, ada.id, 99] }), 400],
    ['a repeated user', press('People', { shared_user_ids: [grace.id, grace.id] }), 400],
    ['an unknown user', press('People', { shared_user_ids: [grace.id, 99_999] }), 404],
    ['a bot for users', press('People', { shared_user_ids: [bot.id] }), 400],
    ['Premium users', press('Premium people', { shared_user_ids: [grace.id] }), 400],
    ['no users', press('People', {}), 400],
    ['users for a chat request', press('Public group', { shared_user_ids: [grace.id] }), 400],
    ['a chat for a users request', press('People', { shared_chat_id: team.id }), 400],
    ['a chat for a text button', press('Plain', { shared_chat_id: team.id }), 400],
    [
      'two answers',
      press('People', { shared_user_ids: [grace.id], shared_chat_id: team.id }),
      400,
    ],
    ['a missing chat', press('Group with bot', { shared_chat_id: -1_000_000_099_999 }), 404],
    ['a group without the bot', press('Group with bot', { shared_chat_id: otherGroup.id }), 400],
    [
      'a chat the account is not in',
      press('Group with bot', { shared_chat_id: strangersGroup.id }),
      403,
    ],
    ['a private chat for a public one', press('Public group', { shared_chat_id: team.id }), 400],
    ['a bot without rights', press('Admin bot group', { shared_chat_id: team.id }), 400],
    ['a channel', press('Channel', { shared_chat_id: team.id }), 400],
    ['a forum', press('Forum', { shared_chat_id: team.id }), 400],
    ['a missing button', press('Teammates', { shared_user_ids: [grace.id] }), 400],
    [
      'a supergroup press',
      { chat: teamChat, text: 'People', shared_user_ids: [grace.id] },
      400,
    ],
  ];
  for (const [description, input, expectedStatus] of refusals) {
    await expectRefused(ada.pressReplyKeyboardButton(input), expectedStatus, description);
  }
  // Grace is a member of the team, but not the administrator the request requires.
  await expectRefused(
    grace.pressReplyKeyboardButton(press('Pinning group', { shared_chat_id: team.id })),
    400,
    'missing account rights',
  );

  expectEqual(
    [await ada.getMessages({ chat: privateChat }), await grace.getMessages({ chat: privateChat })],
    [adaHistoryBefore, graceHistoryBefore],
    'Expected refused selections to leave the histories unchanged',
  );
  const updates = await callBot('getUpdates', { offset: unreadOffset });
  expectEqual(updates.result, [], 'Expected refused selections to enqueue no update');
  // An account that blocks the bot cannot write to it, as for any message.
  await ada.blockBot({ botId: bot.id });
  await expectRefused(
    ada.pressReplyKeyboardButton(press('People', { shared_user_ids: [grace.id] })),
    409,
    'a share with a blocked bot',
  );
  await ada.unblockBot({ botId: bot.id });

  // A stale keyboard: once the bot replaces it, its buttons are gone.
  await callBot('sendMessage', {
    chat_id: ada.id,
    text: 'Changed my mind',
    reply_markup: { keyboard: [[{ text: 'Plain' }]] },
  });
  await expectRefused(
    ada.pressReplyKeyboardButton(press('People', { shared_user_ids: [grace.id] })),
    400,
    'a replaced keyboard',
  );
  // Grace still has her own keyboard, which Ada's refused presses did not consume.
  const graceShare = await grace.pressReplyKeyboardButton({
    chat: privateChat,
    text: 'People',
    shared_user_ids: [ada.id],
  });
  expectEqual(
    graceShare.users_shared,
    { user_ids: [ada.id], users: [{ user_id: ada.id }], request_id: 1 },
    'Expected another account to answer its own request',
  );
  // Once Grace administers the team with the rights the request requires, and the bot holds its
  // own, a non-owner administrator's choice meets the request.
  await ada.promoteChatMember({
    chat: teamChat,
    userId: grace.id,
    rights: { can_promote_members: true },
  });
  await ada.promoteChatMember({
    chat: teamChat,
    userId: bot.id,
    rights: { can_pin_messages: true },
  });
  const administratorShare = await grace.pressReplyKeyboardButton({
    chat: privateChat,
    text: 'Pinning group',
    shared_chat_id: team.id,
  });
  expectEqual(
    administratorShare.chat_shared,
    { chat_id: team.id, request_id: 4 },
    "Expected an administrator's supergroup to meet the rights criteria",
  );
  await session.end();
});

Deno.test('sharing users or a chat grants the bot no access, membership, or rights', async () => {
  const fixture = await createSharingFixture();
  const { session, bot, ada, grace, privateChat } = fixture;
  const callBot = createBotApiCaller(fixture);
  const team = await ada.createSupergroup({ title: 'Team' });
  await callBot('sendMessage', {
    chat_id: ada.id,
    text: 'Share',
    reply_markup: {
      keyboard: [[
        { text: 'Person', request_users: { request_id: 1 } },
        { text: 'Group', request_chat: { request_id: 2, chat_is_channel: false } },
      ]],
    },
  });

  await ada.pressReplyKeyboardButton({
    chat: privateChat,
    text: 'Person',
    shared_user_ids: [grace.id],
  });
  await ada.pressReplyKeyboardButton({ chat: privateChat, text: 'Group', shared_chat_id: team.id });

  // The bot still knows neither Grace's private chat nor the team it is not a member of.
  const chatNotFound = { ok: false, error_code: 400, description: 'Bad Request: chat not found' };
  expectEqual(
    [
      await callBot('sendMessage', { chat_id: grace.id, text: 'Hello' }),
      await callBot('getChatMember', { chat_id: team.id, user_id: bot.id }),
      await callBot('sendMessage', { chat_id: team.id, text: 'Hello' }),
    ],
    [chatNotFound, chatNotFound, chatNotFound],
    'Expected the bot to gain no access through what was shared',
  );
  expectEqual(
    await grace.getMessages({ chat: privateChat }),
    [],
    'Expected the shared account to have no chat with the bot',
  );
  await session.end();
});

Deno.test('selections stay within their session', async () => {
  const api = createEmulationApi({
    sessionLifecycle: createSessionLifecycleService(),
    publicOrigin: PUBLIC_ORIGIN,
  });
  const first = await createSharingFixture(api);
  const second = await createSharingFixture(api);
  // Only the second session has a fourth account and a supergroup with this ID.
  const { account: extra } = await second.session.createAccount({ first_name: 'Extra' });
  await second.ada.createSupergroup({ title: 'Elsewhere' });
  const elsewhere = await second.ada.createSupergroup({ title: 'Elsewhere too' });
  await createBotApiCaller(first)('sendMessage', {
    chat_id: first.ada.id,
    text: 'Share',
    reply_markup: {
      keyboard: [[
        { text: 'Person', request_users: { request_id: 1 } },
        { text: 'Group', request_chat: { request_id: 2, chat_is_channel: false } },
      ]],
    },
  });

  await expectRefused(
    first.ada.pressReplyKeyboardButton({
      chat: first.privateChat,
      text: 'Person',
      shared_user_ids: [extra.id],
    }),
    404,
    'a user of another session',
  );
  await expectRefused(
    first.ada.pressReplyKeyboardButton({
      chat: first.privateChat,
      text: 'Group',
      shared_chat_id: elsewhere.id,
    }),
    404,
    'a supergroup of another session',
  );
  await expectRefused(
    second.ada.pressReplyKeyboardButton({
      chat: second.privateChat,
      text: 'Person',
      shared_user_ids: [second.grace.id],
    }),
    400,
    'a keyboard of another session',
  );
  await first.ada.pressReplyKeyboardButton({
    chat: first.privateChat,
    text: 'Person',
    shared_user_ids: [first.grace.id],
  });
  expectEqual(
    (await second.ada.getMessages({ chat: second.privateChat })).filter((message) =>
      message.users_shared !== undefined
    ),
    [],
    'Expected a share in one session to leave the other untouched',
  );
  await first.session.end();
  await second.session.end();
});

/**
 * Creates a session whose bot Ada has started a private chat with, and accounts Grace and Linus
 * that she can share.
 */
async function createSharingFixture(
  api = createEmulationApi({
    sessionLifecycle: createSessionLifecycleService(),
    publicOrigin: PUBLIC_ORIGIN,
  }),
) {
  const fetch: typeof globalThis.fetch = async (input, init) =>
    await api.fetch(new Request(input, init));
  const session = await new TelegramEmulationClient(PUBLIC_ORIGIN, { fetch }).createSession();
  const createdBot = await session.createBot({ first_name: 'Team Bot', username: 'team_bot' });
  const { account: ada } = await session.createAccount({ first_name: 'Ada' });
  const { account: grace } = await session.createAccount({ first_name: 'Grace' });
  const { account: linus } = await session.createAccount({
    first_name: 'Linus',
    last_name: 'Torvalds',
    username: 'linus',
  });
  const privateChat: PrivateMessageTarget = { type: 'private', botId: createdBot.bot.id };
  await ada.sendMessage({ to: privateChat, text: '/start' });
  return {
    session,
    fetch,
    bot: { id: createdBot.bot.id, token: createdBot.token },
    ada,
    grace,
    linus,
    privateChat,
  };
}

/** Calls the fixture bot's Bot API methods and returns the parsed responses. */
function createBotApiCaller(
  { session, fetch, bot }: {
    readonly session: EmulationSessionClient;
    readonly fetch: typeof globalThis.fetch;
    readonly bot: { readonly token: string };
  },
) {
  return async (method: string, parameters: Record<string, unknown>) => {
    const response = await fetch(`${session.botApiRoot}/bot${bot.token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(parameters),
    });
    return await response.json() as { ok: boolean; result?: unknown; description?: string };
  };
}

async function expectRefused(
  press: Promise<unknown>,
  expectedStatus: number,
  description: string,
): Promise<void> {
  try {
    await press;
  } catch (error) {
    if (error instanceof EmulationClientError && error.status === expectedStatus) {
      return;
    }
    throw new Error(`Expected ${description} to be refused with ${expectedStatus}`, {
      cause: error,
    });
  }
  throw new Error(`Expected ${description} to be refused with ${expectedStatus}`);
}

function expectEqual(actual: unknown, expected: unknown, message: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `${message}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`,
    );
  }
}
