import { createTestSession, requestJson } from './support/emulation_api.ts';

interface BotApiResponse {
  readonly ok: boolean;
  readonly result?: unknown;
  readonly description?: string;
}

/** Every Bot API chat permission, in the order the Bot API shows them. */
const CHAT_PERMISSION_NAMES = [
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
] as const;

/** The bytes of a 4 by 3 GIF image, whose header is all the emulator reads. */
const PHOTO_BYTES = new Uint8Array([
  ...new TextEncoder().encode('GIF89a'),
  4,
  0,
  3,
  0,
  0,
  0,
  0,
]);

/**
 * Creates a session where Ada owns a supergroup with Grace; Linus, an administrator account
 * without rights to change information; a moderator bot that may restrict members; and a plain
 * member bot.
 */
async function createDefaultPermissionsFixture() {
  const { api, sessionPath } = await createTestSession();
  const createAccount = async (firstName: string) =>
    (await requestJson<{ account: { id: number } }>(
      api,
      'POST',
      `${sessionPath}/accounts`,
      { first_name: firstName },
    )).body.account;
  const ada = await createAccount('Ada');
  const grace = await createAccount('Grace');
  const linus = await createAccount('Linus');
  const createBot = async (username: string) => {
    const { body } = await requestJson<{ token: string; bot: { id: number } }>(
      api,
      'POST',
      `${sessionPath}/bots`,
      { first_name: 'Test Bot', username },
    );
    return { ...body, botApiPath: `${sessionPath}/bot-api/bot${body.token}` };
  };
  const moderatorBot = await createBot('moderator_bot');
  const memberBot = await createBot('member_bot');

  const { body: { supergroup } } = await requestJson<{ supergroup: { id: number } }>(
    api,
    'POST',
    `${sessionPath}/accounts/${ada.id}/supergroups`,
    { title: 'Team' },
  );
  const accountPath = (accountId: number) => `${sessionPath}/accounts/${accountId}`;
  const supergroupPath = (accountId: number) =>
    `${accountPath(accountId)}/conversations/supergroup/${supergroup.id}`;
  for (const memberId of [grace.id, linus.id, moderatorBot.bot.id, memberBot.bot.id]) {
    await api.request(`${supergroupPath(ada.id)}/members/${memberId}`, { method: 'PUT' });
  }
  for (
    const [userId, rights] of [
      [moderatorBot.bot.id, { can_restrict_members: true }],
      [linus.id, { can_pin_messages: true }],
    ] as const
  ) {
    await requestJson(api, 'PUT', `${supergroupPath(ada.id)}/administrators/${userId}`, rights);
  }

  const callBot = async (bot: { botApiPath: string }, method: string, parameters: object) => {
    const { status, body } = await requestJson<BotApiResponse>(
      api,
      'POST',
      `${bot.botApiPath}/${method}`,
      parameters,
    );
    return [status, body.ok ? 'ok' : body.description] as const;
  };
  const setDefaults = (
    bot: { botApiPath: string },
    permissions: unknown,
    usesIndependentPermissions = false,
  ) =>
    callBot(bot, 'setChatPermissions', {
      chat_id: supergroup.id,
      permissions,
      use_independent_chat_permissions: usesIndependentPermissions,
    });
  const getDefaults = async () => {
    const { body } = await requestJson<{ result: { permissions: Record<string, boolean> } }>(
      api,
      'POST',
      `${moderatorBot.botApiPath}/getChat`,
      { chat_id: supergroup.id },
    );
    return CHAT_PERMISSION_NAMES.filter((name) => body.result.permissions[name]);
  };
  /** Sends a message of an account to the supergroup and answers its status. */
  const sendAsAccount = async (accountId: number, content: object) =>
    (await requestJson(api, 'POST', `${accountPath(accountId)}/messages`, {
      to: { type: 'supergroup', chatId: supergroup.id },
      ...content,
    })).status;
  /** Sends content of a kind as a bot, uploading a file for media, and answers the outcome. */
  const sendAsBot = async (bot: { botApiPath: string }, kind: BotContentKind) => {
    const chatId = String(supergroup.id);
    switch (kind) {
      case 'text':
        return (await callBot(bot, 'sendMessage', { chat_id: supergroup.id, text: 'Hi' }))[1];
      case 'poll':
        return (await callBot(bot, 'sendPoll', {
          chat_id: supergroup.id,
          question: 'Lunch?',
          options: ['Pizza', 'Pasta'],
        }))[1];
      case 'rich_message':
        return (await callBot(bot, 'sendRichMessage', {
          chat_id: supergroup.id,
          rich_message: { blocks: [{ type: 'paragraph', text: 'Agenda' }] },
        }))[1];
      default: {
        const method = BOT_MEDIA_METHODS[kind];
        const body = new FormData();
        body.append('chat_id', chatId);
        body.append(kind, new File([kind === 'photo' ? PHOTO_BYTES : 'bytes'], `file.${kind}`));
        const response = await api.request(`${bot.botApiPath}/${method}`, {
          method: 'POST',
          body,
        });
        const answer = await response.json() as BotApiResponse;
        return answer.ok ? 'ok' : answer.description;
      }
    }
  };

  const nextUpdateOffsets = new Map<string, number>();
  /** Returns a bot's updates since the last read, membership changes included. */
  const readUpdates = async (bot: { botApiPath: string }) => {
    const { body } = await requestJson<{ result: Array<Record<string, unknown>> }>(
      api,
      'POST',
      `${bot.botApiPath}/getUpdates`,
      {
        offset: nextUpdateOffsets.get(bot.botApiPath) ?? 0,
        allowed_updates: ['message', 'chat_member', 'my_chat_member'],
      },
    );
    const lastUpdateId = body.result.at(-1)?.update_id;
    if (typeof lastUpdateId === 'number') {
      nextUpdateOffsets.set(bot.botApiPath, lastUpdateId + 1);
    }
    return body.result;
  };

  return {
    api,
    sessionPath,
    readUpdates,
    ada,
    grace,
    linus,
    moderatorBot,
    memberBot,
    supergroup,
    accountPath,
    supergroupPath,
    callBot,
    setDefaults,
    getDefaults,
    sendAsAccount,
    sendAsBot,
  };
}

type BotContentKind = 'text' | 'photo' | 'document' | 'video' | 'voice' | 'poll' | 'rich_message';

const BOT_MEDIA_METHODS = {
  photo: 'sendPhoto',
  document: 'sendDocument',
  video: 'sendVideo',
  voice: 'sendVoice',
} as const;

/** The content an account sends, by kind, as the emulation API takes it. */
const ACCOUNT_CONTENTS = {
  text: { text: 'Hello' },
  photo: { photo: { content_base64: PHOTO_BYTES.toBase64() } },
  document: { document: { content_base64: 'Ynl0ZXM=', file_name: 'notes.txt' } },
  video: { video: { content_base64: 'Ynl0ZXM=' } },
  voice: { voice: { content_base64: 'Ynl0ZXM=' } },
} as const;

function expectEqual(actual: unknown, expected: unknown, message: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `${message}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`,
    );
  }
}

/** A `ChatPermissions` object that grants every permission. */
const ALL_PERMISSIONS = Object.fromEntries(CHAT_PERMISSION_NAMES.map((name) => [name, true]));

Deno.test('a bot changes default permissions, which members obey and getChat reports', async () => {
  const {
    api,
    ada,
    grace,
    linus,
    moderatorBot,
    memberBot,
    supergroup,
    callBot,
    setDefaults,
    getDefaults,
    readUpdates,
    sendAsAccount,
    sendAsBot,
  } = await createDefaultPermissionsFixture();
  const initialDefaults = await getDefaults();
  await readUpdates(moderatorBot);
  await readUpdates(memberBot);

  expectEqual(await setDefaults(moderatorBot, { can_send_messages: true }), [200, 'ok'], 'Change');
  expectEqual(initialDefaults, CHAT_PERMISSION_NAMES, 'Expected every permission at first');
  expectEqual(
    await getDefaults(),
    ['can_send_messages', 'can_react_to_messages'],
    'Expected getChat to show the new default permissions',
  );
  expectEqual(
    [...await readUpdates(moderatorBot), ...await readUpdates(memberBot)],
    [],
    'Expected no update for changed default permissions',
  );
  // Members, bots included, obey the defaults; the owner and administrators are exempt.
  expectEqual(
    [
      await sendAsAccount(grace.id, ACCOUNT_CONTENTS.text),
      await sendAsAccount(grace.id, ACCOUNT_CONTENTS.photo),
      await sendAsAccount(linus.id, ACCOUNT_CONTENTS.photo),
      await sendAsAccount(ada.id, ACCOUNT_CONTENTS.photo),
      await sendAsBot(memberBot, 'text'),
      await sendAsBot(memberBot, 'photo'),
      await sendAsBot(moderatorBot, 'photo'),
    ],
    [201, 403, 201, 201, 'ok', 'Bad Request: not enough rights to send photos to the chat', 'ok'],
    'Expected the defaults to bind members only',
  );

  // A member's restriction and the defaults both decide what it may send, while getChatMember
  // shows the restriction itself.
  await callBot(moderatorBot, 'restrictChatMember', {
    chat_id: supergroup.id,
    user_id: grace.id,
    permissions: { can_send_photos: true },
  });
  const whileBothWithhold = [
    await sendAsAccount(grace.id, ACCOUNT_CONTENTS.text),
    await sendAsAccount(grace.id, ACCOUNT_CONTENTS.photo),
  ];
  await setDefaults(moderatorBot, ALL_PERMISSIONS);
  const onceDefaultsGrantAll = [
    await sendAsAccount(grace.id, ACCOUNT_CONTENTS.text),
    await sendAsAccount(grace.id, ACCOUNT_CONTENTS.photo),
  ];
  const { body: member } = await requestJson<{ result: Record<string, unknown> }>(
    api,
    'POST',
    `${moderatorBot.botApiPath}/getChatMember`,
    { chat_id: supergroup.id, user_id: grace.id },
  );
  expectEqual(
    [whileBothWithhold, onceDefaultsGrantAll, member.result.can_send_photos],
    [[403, 403], [403, 201], true],
    "Expected the member's restriction to apply within the defaults",
  );
});

Deno.test('setChatPermissions refuses what Telegram refuses, without changing anything', async () => {
  const { grace, memberBot, moderatorBot, supergroup, sessionPath, api, callBot, getDefaults } =
    await createDefaultPermissionsFixture();
  // A private chat the bot knows, and one it does not.
  await requestJson(api, 'POST', `${sessionPath}/accounts/${grace.id}/messages`, {
    to: { type: 'private', botId: moderatorBot.bot.id },
    text: '/start',
  });
  const setPermissions = (bot: { botApiPath: string }, parameters: object) =>
    callBot(bot, 'setChatPermissions', {
      chat_id: supergroup.id,
      permissions: { can_send_messages: true },
      ...parameters,
    });

  const refusals = [
    // Without the right to restrict members, even the permissions the supergroup has are refused.
    await setPermissions(memberBot, {}),
    await setPermissions(memberBot, { permissions: ALL_PERMISSIONS }),
    await setPermissions(moderatorBot, { chat_id: grace.id }),
    await setPermissions(memberBot, { chat_id: grace.id }),
    await setPermissions(moderatorBot, { chat_id: -1_000_000_999_999 }),
    await setPermissions(moderatorBot, { chat_id: undefined }),
    await setPermissions(moderatorBot, { chat_id: undefined, permissions: '[' }),
    await setPermissions(moderatorBot, { permissions: 'true' }),
    await setPermissions(moderatorBot, { permissions: { can_send_photos: 'yes' } }),
    await setPermissions(moderatorBot, { permissions: { can_send_stickers: true } }),
    await setPermissions(moderatorBot, { can_send_messages: true }),
  ];
  const notEnoughRights = 'Bad Request: not enough rights to change chat permissions';
  expectEqual(
    refusals,
    [
      [400, notEnoughRights],
      [400, notEnoughRights],
      [400, "Bad Request: can't change private chat permissions"],
      [400, 'Bad Request: chat not found'],
      [400, 'Bad Request: chat not found'],
      [400, 'Bad Request: chat_id is empty'],
      [400, "Bad Request: can't parse permissions JSON object"],
      [400, 'Bad Request: object expected as permissions'],
      [
        400,
        'Bad Request: can\'t parse chat permissions: Field "can_send_photos" must be of type Boolean',
      ],
      [400, 'Bad Request: invalid setChatPermissions parameters'],
      [400, 'Bad Request: invalid setChatPermissions parameters'],
    ],
    'Expected Telegram refusals',
  );
  expectEqual(await getDefaults(), CHAT_PERMISSION_NAMES, 'Expected the defaults to stay');

  // The permissions the supergroup has change nothing, and missing permissions withhold all.
  expectEqual(
    [
      await setPermissions(moderatorBot, { permissions: ALL_PERMISSIONS }),
      await setPermissions(moderatorBot, { permissions: undefined }),
      await getDefaults(),
    ],
    [[200, 'ok'], [200, 'ok'], []],
    'Expected missing permissions to withhold every permission',
  );
});

Deno.test('default permissions decide information changes and inline bots, never for bots', async () => {
  const {
    ada,
    grace,
    linus,
    memberBot,
    supergroup,
    sessionPath,
    accountPath,
    supergroupPath,
    api,
    callBot,
  } = await createDefaultPermissionsFixture();
  const changeTitle = async (accountId: number, title: string) =>
    (await requestJson(api, 'PUT', `${supergroupPath(accountId)}/title`, { title })).status;
  const changeDefaultsAs = async (accountId: number, permissions: object) =>
    (await requestJson(api, 'PUT', `${supergroupPath(accountId)}/permissions`, { permissions }))
      .status;
  await requestJson(api, 'PUT', `${supergroupPath(ada.id)}/administrators/${memberBot.bot.id}`, {
    can_pin_messages: true,
  });

  // Members change the title as the defaults let them; an administrator account gets the
  // permission from the defaults too, but an administrator bot needs the right itself.
  const withChangeInfo = [
    await changeTitle(grace.id, 'Members'),
    await changeTitle(linus.id, 'Administrators'),
    (await callBot(memberBot, 'setChatTitle', { chat_id: supergroup.id, title: 'Bots' }))[1],
  ];
  // Only a member with the right to restrict members changes the defaults; the owner may.
  const defaultsChanges = [
    await changeDefaultsAs(grace.id, { can_send_messages: true }),
    await changeDefaultsAs(linus.id, { can_send_messages: true }),
    await changeDefaultsAs(ada.id, { can_send_messages: true, can_send_media_messages: true }),
    await changeDefaultsAs(ada.id, { can_send_messages: true }),
  ];
  const withoutChangeInfo = [
    await changeTitle(grace.id, 'Members again'),
    await changeTitle(linus.id, 'Administrators again'),
    await changeTitle(ada.id, 'Owners'),
  ];
  expectEqual(
    [withChangeInfo, defaultsChanges, withoutChangeInfo],
    [
      [204, 204, 'Bad Request: not enough rights to change chat title'],
      [403, 403, 400, 204],
      [403, 403, 204],
    ],
    'Expected default permissions to decide title changes',
  );

  // Using an inline bot needs `can_send_other_messages`, which the defaults now withhold.
  const inlineBot = await requestJson<{ token: string; bot: { id: number } }>(
    api,
    'POST',
    `${sessionPath}/bots`,
    { first_name: 'Inline Bot', username: 'inline_bot', supports_inline_queries: true },
  );
  const inlineQueriesPath = `${accountPath(grace.id)}/inline-queries`;
  const inlineQuery = await requestJson<{ inline_query: { id: string } }>(
    api,
    'POST',
    inlineQueriesPath,
    { bot_id: inlineBot.body.bot.id, chat: { type: 'supergroup', chatId: supergroup.id } },
  );
  const inlineQueryId = inlineQuery.body.inline_query.id;
  await requestJson(
    api,
    'POST',
    `${sessionPath}/bot-api/bot${inlineBot.body.token}/answerInlineQuery`,
    {
      inline_query_id: inlineQueryId,
      results: [{
        type: 'article',
        id: 'agenda',
        title: 'Agenda',
        input_message_content: { message_text: 'Agenda' },
      }],
    },
  );
  const chooseResult = async () =>
    (await requestJson(
      api,
      'POST',
      `${inlineQueriesPath}/${inlineQueryId}/chosen-results`,
      { result_id: 'agenda' },
    )).status;
  const withoutInlineBots = await chooseResult();
  await changeDefaultsAs(ada.id, { can_send_messages: true, can_send_other_messages: true });
  expectEqual(
    [withoutInlineBots, await chooseResult()],
    [403, 201],
    'Expected inline results to need can_send_other_messages',
  );
});

Deno.test('each kind of content needs its own permission, for accounts and bots alike', async () => {
  const { memberBot, moderatorBot, grace, setDefaults, sendAsAccount, sendAsBot } =
    await createDefaultPermissionsFixture();
  const accountKinds = Object.keys(ACCOUNT_CONTENTS) as Array<keyof typeof ACCOUNT_CONTENTS>;
  const botKinds: BotContentKind[] = [
    'text',
    'photo',
    'document',
    'video',
    'voice',
    'poll',
    'rich_message',
  ];
  // Contacts, locations, audio, video notes, stickers and other content are not supported.
  const permissionCases = [
    ['can_send_messages', ['text', 'rich_message']],
    ['can_send_photos', ['photo']],
    ['can_send_documents', ['document']],
    ['can_send_videos', ['video']],
    ['can_send_voice_notes', ['voice']],
    ['can_send_polls', ['poll']],
    ['can_send_audios', []],
  ] as const;

  for (const [permission, sendableKinds] of permissionCases) {
    await setDefaults(moderatorBot, { [permission]: true }, true);
    const accountOutcomes = [];
    for (const kind of accountKinds) {
      accountOutcomes.push([kind, await sendAsAccount(grace.id, ACCOUNT_CONTENTS[kind])]);
    }
    const botOutcomes = [];
    for (const kind of botKinds) {
      botOutcomes.push([kind, await sendAsBot(memberBot, kind)]);
    }
    const isSendable = (kind: string) => (sendableKinds as readonly string[]).includes(kind);
    expectEqual(
      accountOutcomes,
      accountKinds.map((kind) => [kind, isSendable(kind) ? 201 : 403]),
      `Expected an account to send only what ${permission} allows`,
    );
    expectEqual(
      botOutcomes,
      botKinds.map((kind) => [kind, isSendable(kind) ? 'ok' : BOT_REFUSALS[kind]]),
      `Expected a bot to send only what ${permission} allows`,
    );
  }
});

/** Telegram's refusal of each kind of content a bot may not send. */
const BOT_REFUSALS: Record<BotContentKind, string> = {
  text: 'Bad Request: not enough rights to send text messages to the chat',
  photo: 'Bad Request: not enough rights to send photos to the chat',
  document: 'Bad Request: not enough rights to send documents to the chat',
  video: 'Bad Request: not enough rights to send videos to the chat',
  voice: 'Bad Request: not enough rights to send voice notes to the chat',
  poll: 'Bad Request: not enough rights to send polls to the chat',
  rich_message: 'Bad Request: not enough rights to send the rich message to the chat',
};
