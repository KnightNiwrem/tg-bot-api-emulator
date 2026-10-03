import { Bot } from 'https://cdn.jsdelivr.net/gh/grammyjs/grammY@^1.46.0/src/bot.ts';
import { webhookCallback } from 'https://cdn.jsdelivr.net/gh/grammyjs/grammY@^1.46.0/src/convenience/webhook.ts';

import { createEmulationApi } from '../src/api/mod.ts';
import { createSessionLifecycleService } from '../src/composition/session_lifecycle.ts';

type EmulationApi = ReturnType<typeof createEmulationApi>;

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

/** A `ChatPermissions` object that grants every permission, which lifts a restriction. */
const ALL_PERMISSIONS = Object.fromEntries(CHAT_PERMISSION_NAMES.map((name) => [name, true]));

/** The media permissions, which `can_send_media_messages` summarizes. */
const MEDIA_PERMISSION_NAMES = [
  'can_send_audios',
  'can_send_documents',
  'can_send_photos',
  'can_send_videos',
  'can_send_video_notes',
  'can_send_voice_notes',
];

/** A 4 by 3 GIF image, whose header is all the emulator reads, as base64 text. */
const PHOTO_BASE64 = btoa(
  String.fromCharCode(...new TextEncoder().encode('GIF89a'), 4, 0, 3, 0, 0, 0, 0),
);

/**
 * Creates a session where Ada owns a supergroup with Grace, a moderator bot that may restrict
 * members, and another bot, both subscribed to `chat_member` and `my_chat_member` updates; Linus
 * is an account outside the supergroup.
 */
async function createRestrictionFixture() {
  const api = createEmulationApi({
    sessionLifecycle: createSessionLifecycleService(),
    publicOrigin: 'http://emulator.example:9000',
  });
  const sessionPath = (await api.request('/sessions', { method: 'POST' })).headers.get('Location');
  if (sessionPath === null) {
    throw new Error('Expected the created session to have a Location');
  }
  const createAccount = async (firstName: string) =>
    (await requestJson<{ account: { id: number; first_name: string } }>(
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
  const otherBot = await createBot('other_bot');

  const { body: { supergroup } } = await requestJson<{ supergroup: { id: number } }>(
    api,
    'POST',
    `${sessionPath}/accounts/${ada.id}/supergroups`,
    { title: 'Team' },
  );
  const accountPath = (accountId: number) => `${sessionPath}/accounts/${accountId}`;
  const supergroupPath = (accountId: number) =>
    `${accountPath(accountId)}/conversations/supergroup/${supergroup.id}`;
  for (const memberId of [grace.id, moderatorBot.bot.id, otherBot.bot.id]) {
    await expectStatus(
      api.request(`${supergroupPath(ada.id)}/members/${memberId}`, { method: 'PUT' }),
      204,
      `Expected member ${memberId} to be added`,
    );
  }
  await expectStatus(
    api.request(
      `${supergroupPath(ada.id)}/administrators/${moderatorBot.bot.id}`,
      jsonRequest('PUT', { can_restrict_members: true }),
    ),
    204,
    'Expected the moderator bot to be promoted',
  );

  const readUpdates = createUpdateReader(api);
  for (const { botApiPath } of [moderatorBot, otherBot]) {
    await readUpdates(botApiPath);
  }
  const callBot = (bot: { botApiPath: string }, method: string, parameters: object) =>
    requestJson<BotApiResponse>(api, 'POST', `${bot.botApiPath}/${method}`, parameters);
  const describeCall = async (
    bot: { botApiPath: string },
    method: string,
    parameters: object,
  ) => {
    const { status, body } = await callBot(bot, method, parameters);
    return [status, body.ok ? body.result : body.description];
  };
  const getChatMember = async (userId: number) => {
    const { body } = await callBot(moderatorBot, 'getChatMember', {
      chat_id: supergroup.id,
      user_id: userId,
    });
    return body.result as Record<string, unknown>;
  };
  const sendAccountMessage = (accountId: number, content: object) =>
    requestJson<{ message?: { message_id: number } }>(
      api,
      'POST',
      `${accountPath(accountId)}/messages`,
      { to: { type: 'supergroup', chatId: supergroup.id }, ...content },
    );

  return {
    api,
    sessionPath,
    ada,
    grace,
    linus,
    moderatorBot,
    otherBot,
    supergroup,
    accountPath,
    supergroupPath,
    readUpdates,
    callBot,
    describeCall,
    getChatMember,
    sendAccountMessage,
  };
}

/**
 * Returns a reader of each bot's updates, including membership changes, since the reader last
 * read that bot's updates.
 */
function createUpdateReader(api: EmulationApi) {
  const nextOffsetsByBotApiPath = new Map<string, number>();
  return async (botApiPath: string): Promise<Array<Record<string, unknown>>> => {
    const { body } = await requestJson<{ result: Array<Record<string, unknown>> }>(
      api,
      'POST',
      `${botApiPath}/getUpdates`,
      {
        offset: nextOffsetsByBotApiPath.get(botApiPath) ?? 0,
        allowed_updates: ['message', 'chat_member', 'my_chat_member'],
      },
    );
    const lastUpdateId = body.result.at(-1)?.update_id;
    if (typeof lastUpdateId === 'number') {
      nextOffsetsByBotApiPath.set(botApiPath, lastUpdateId + 1);
    }
    return body.result.map(({ update_id: _updateId, ...update }) => update);
  };
}

/** Describes membership updates as their kind, member, and old and new status. */
function describeMembershipUpdates(updates: ReadonlyArray<Record<string, unknown>>): string[] {
  return updates.map((update) => {
    const [kind, change] = Object.entries(update)[0];
    if (kind !== 'chat_member' && kind !== 'my_chat_member') {
      return kind;
    }
    const { old_chat_member, new_chat_member } = change as {
      old_chat_member: { status: string };
      new_chat_member: { user: { id: number }; status: string };
    };
    return `${kind} ${new_chat_member.user.id}: ${old_chat_member.status} -> ${new_chat_member.status}`;
  });
}

/** The Bot API's `ChatPermissions` fields, granting exactly the given permissions. */
function permissionFields(granted: readonly string[]): Record<string, boolean> {
  const grants = (name: string) =>
    name === 'can_send_media_messages'
      ? MEDIA_PERMISSION_NAMES.some((media) => granted.includes(media))
      : granted.includes(name);
  return Object.fromEntries(CHAT_PERMISSION_NAMES.map((name) => [name, grants(name)]));
}

/** A restricted member as `getChatMember` shows it. */
function restrictedMember(
  user: unknown,
  granted: readonly string[],
  { untilDate = 0, isMember = true }: { untilDate?: number; isMember?: boolean } = {},
) {
  return {
    user,
    status: 'restricted',
    until_date: untilDate,
    ...permissionFields(granted),
    is_member: isMember,
  };
}

async function requestJson<Body>(
  api: EmulationApi,
  method: 'DELETE' | 'GET' | 'POST' | 'PUT',
  path: string,
  body?: unknown,
): Promise<{ status: number; body: Body }> {
  const response = await api.request(path, {
    method,
    ...(body === undefined
      ? {}
      : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  });
  const text = await response.text();
  return {
    status: response.status,
    body: (text.length === 0 ? undefined : JSON.parse(text)) as Body,
  };
}

function jsonRequest(method: 'POST' | 'PUT', body: unknown): RequestInit {
  return { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

async function expectStatus(
  response: Response | Promise<Response>,
  expectedStatus: number,
  message: string,
): Promise<void> {
  const { status } = await response;
  if (status !== expectedStatus) {
    throw new Error(`${message}: expected ${expectedStatus}, received ${status}`);
  }
}

function expectEqual(actual: unknown, expected: unknown, message: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `${message}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`,
    );
  }
}

function nowUnixSeconds(): number {
  return Math.floor(Date.now() / 1_000);
}

Deno.test('a bot restricts a member, whose prohibited sends fail until the bot lifts it', async () => {
  const {
    grace,
    moderatorBot,
    otherBot,
    supergroup,
    supergroupPath,
    api,
    readUpdates,
    callBot,
    getChatMember,
    sendAccountMessage,
  } = await createRestrictionFixture();
  const untilDate = nowUnixSeconds() + 3_600;
  const restrict = (permissions: object) =>
    callBot(moderatorBot, 'restrictChatMember', {
      chat_id: supergroup.id,
      user_id: grace.id,
      permissions,
      until_date: untilDate,
    });
  const photo = { photo: { content_base64: PHOTO_BASE64 } };

  expectEqual((await restrict({ can_send_messages: true })).body.result, true, 'Restriction');
  const sendsWhileRestricted = [
    (await sendAccountMessage(grace.id, { text: 'Allowed' })).status,
    (await sendAccountMessage(grace.id, photo)).status,
  ];
  const restricted = await getChatMember(grace.id);
  // Restricting again the same way changes nothing, which no update reports.
  await restrict({ can_send_messages: true });
  const moderatorUpdates = await readUpdates(moderatorBot.botApiPath);
  const otherBotUpdates = await readUpdates(otherBot.botApiPath);
  expectEqual(sendsWhileRestricted, [201, 403], 'Expected only the text to be sent');
  expectEqual(
    restricted,
    restrictedMember(grace, ['can_send_messages', 'can_react_to_messages'], { untilDate }),
    'Expected getChatMember to show the restriction',
  );
  // The administrator bot observes the change and the text; the other bot, in privacy mode, sees
  // neither, as it administers nothing.
  expectEqual(
    describeMembershipUpdates(moderatorUpdates),
    [`chat_member ${grace.id}: member -> restricted`, 'message'],
    'Expected the administrator bot to observe the restriction once',
  );
  expectEqual(otherBotUpdates, [], 'Expected the other bot to observe nothing');

  // Every permission lifts the restriction, after which the photo is sent.
  expectEqual((await restrict(ALL_PERMISSIONS)).body.result, true, 'Lifting the restriction');
  const lifted = await getChatMember(grace.id);
  const sentPhoto = await sendAccountMessage(grace.id, photo);
  const history = await requestJson<{ messages: Array<Record<string, unknown>> }>(
    api,
    'GET',
    `${supergroupPath(grace.id)}/messages`,
  );
  expectEqual(lifted, { user: grace, status: 'member' }, 'Expected a plain member again');
  expectEqual(sentPhoto.status, 201, 'Expected the photo to be sent once allowed');
  expectEqual(
    history.body.messages.slice(-2).map((message) => 'photo' in message ? 'photo' : message.text),
    ['Allowed', 'photo'],
    "Expected the history to hold only the member's sent messages",
  );
  expectEqual(
    describeMembershipUpdates(await readUpdates(moderatorBot.botApiPath)),
    [`chat_member ${grace.id}: restricted -> member`, 'message'],
    'Expected the administrator bot to observe the restriction lifted',
  );
});

Deno.test('restrictChatMember reads permissions with the official server implications', async () => {
  const { grace, moderatorBot, supergroup, callBot, getChatMember } =
    await createRestrictionFixture();
  const restrictionOf = async (permissions: object, usesIndependentPermissions = false) => {
    const { body } = await callBot(moderatorBot, 'restrictChatMember', {
      chat_id: supergroup.id,
      user_id: grace.id,
      permissions,
      use_independent_chat_permissions: usesIndependentPermissions,
    });
    if (!body.ok) {
      throw new Error(`Expected the restriction, received ${body.description}`);
    }
    const member = await getChatMember(grace.id);
    return CHAT_PERMISSION_NAMES.filter((name) => member[name] === true);
  };
  const media = MEDIA_PERMISSION_NAMES;

  const cases: Array<[object, boolean, string[]]> = [
    [{}, false, []],
    // Other messages and link previews imply media and text, which implies nothing more.
    [{ can_send_other_messages: true }, false, [
      'can_send_messages',
      'can_send_media_messages',
      ...media,
      'can_send_other_messages',
    ]],
    [{ can_send_other_messages: true }, true, ['can_send_other_messages']],
    [{ can_add_web_page_previews: true }, false, [
      'can_send_messages',
      'can_send_media_messages',
      ...media,
      'can_add_web_page_previews',
    ]],
    // The summary of media stands for every media permission, implies text, and reactions follow
    // text when they are not given.
    [{ can_send_media_messages: true }, false, [
      'can_send_messages',
      'can_send_media_messages',
      ...media,
      'can_react_to_messages',
    ]],
    [{ can_send_media_messages: true }, true, ['can_send_media_messages', ...media]],
    // A media permission given on its own implies no text, and outweighs the summary.
    [{ can_send_photos: true, can_send_media_messages: false }, false, [
      'can_send_media_messages',
      'can_send_photos',
    ]],
    [{ can_send_polls: true }, false, ['can_send_messages', 'can_send_polls']],
    [{ can_send_polls: true, can_react_to_messages: false }, true, ['can_send_polls']],
    // Topics and tags follow pinning when they are not given.
    [{ can_pin_messages: true }, false, ['can_edit_tag', 'can_pin_messages', 'can_manage_topics']],
    [{ can_pin_messages: true, can_manage_topics: false, can_edit_tag: false }, false, [
      'can_pin_messages',
    ]],
  ];
  for (const [permissions, usesIndependentPermissions, expected] of cases) {
    expectEqual(
      await restrictionOf(permissions, usesIndependentPermissions),
      expected,
      `Expected the permissions of ${JSON.stringify(permissions)}${
        usesIndependentPermissions ? ' as independent' : ''
      }`,
    );
  }
});

Deno.test('restrictChatMember refuses what Telegram refuses, without changing anything', async () => {
  const {
    ada,
    grace,
    linus,
    moderatorBot,
    otherBot,
    supergroup,
    accountPath,
    supergroupPath,
    api,
    readUpdates,
    describeCall,
    getChatMember,
  } = await createRestrictionFixture();
  const restrict = (
    bot: { botApiPath: string },
    parameters: Record<string, unknown>,
  ) =>
    describeCall(bot, 'restrictChatMember', {
      chat_id: supergroup.id,
      permissions: { can_send_messages: true },
      ...parameters,
    });
  await api.request(
    `${supergroupPath(ada.id)}/administrators/${otherBot.bot.id}`,
    jsonRequest('PUT', { can_pin_messages: true }),
  );
  await readUpdates(moderatorBot.botApiPath);
  await readUpdates(otherBot.botApiPath);
  const notEnoughRights = 'Bad Request: not enough rights to restrict/unrestrict chat member';

  const refusals = [
    // The other bot administers without the right to restrict members.
    await restrict(otherBot, { user_id: grace.id }),
    await restrict(moderatorBot, { user_id: ada.id }),
    await restrict(moderatorBot, { user_id: moderatorBot.bot.id }),
    await restrict(moderatorBot, { user_id: otherBot.bot.id }),
    // Making an administrator a plain member needs the right to promote members first.
    await restrict(moderatorBot, { user_id: otherBot.bot.id, permissions: ALL_PERMISSIONS }),
    await restrict(moderatorBot, { user_id: 999_999 }),
    await restrict(moderatorBot, { user_id: grace.id, chat_id: ada.id }),
    await restrict(moderatorBot, { user_id: grace.id, chat_id: -1_000_000_999_999 }),
    await restrict(moderatorBot, { chat_id: supergroup.id }),
    await restrict(moderatorBot, { user_id: grace.id, chat_id: undefined }),
    await restrict(moderatorBot, { user_id: grace.id, permissions: '{' }),
    await restrict(moderatorBot, { user_id: grace.id, permissions: [] }),
    await restrict(moderatorBot, { user_id: grace.id, permissions: { can_send_polls: 1 } }),
    // Telegram ignores this summary next to a media field; the emulator still checks its type.
    await restrict(moderatorBot, {
      user_id: grace.id,
      permissions: { can_send_photos: true, can_send_media_messages: 'yes' },
    }),
    await restrict(moderatorBot, { user_id: grace.id, permissions: { can_fly: true } }),
    await restrict(moderatorBot, { user_id: grace.id, can_send_messages: true }),
  ];
  expectEqual(
    refusals,
    [
      [400, notEnoughRights],
      [400, "Bad Request: can't remove chat owner"],
      [400, "Bad Request: can't restrict self"],
      [400, 'Bad Request: user is an administrator of the chat'],
      [400, 'Bad Request: not enough rights'],
      [400, 'Bad Request: member not found'],
      [400, 'Bad Request: chat not found'],
      [400, 'Bad Request: chat not found'],
      [400, 'Bad Request: invalid user_id specified'],
      [400, 'Bad Request: chat_id is empty'],
      [400, "Bad Request: can't parse permissions JSON object"],
      [400, 'Bad Request: object expected as permissions'],
      [
        400,
        'Bad Request: can\'t parse chat permissions: Field "can_send_polls" must be of type Boolean',
      ],
      [
        400,
        'Bad Request: can\'t parse chat permissions: Field "can_send_media_messages" must be of ' +
        'type Boolean',
      ],
      [400, 'Bad Request: invalid restrictChatMember parameters'],
      [400, 'Bad Request: invalid restrictChatMember parameters'],
    ],
    'Expected Telegram refusals',
  );
  expectEqual(
    [await getChatMember(grace.id), (await getChatMember(otherBot.bot.id)).status],
    [{ user: grace, status: 'member' }, 'administrator'],
    'Expected refused restrictions to change nothing',
  );
  expectEqual(
    [...await readUpdates(moderatorBot.botApiPath), ...await readUpdates(otherBot.botApiPath)],
    [],
    'Expected refused restrictions to deliver nothing',
  );

  // A private chat has no members to restrict.
  await requestJson(api, 'POST', `${accountPath(grace.id)}/messages`, {
    to: { type: 'private', botId: moderatorBot.bot.id },
    text: '/start',
  });
  expectEqual(
    await describeCall(moderatorBot, 'restrictChatMember', {
      chat_id: grace.id,
      user_id: grace.id,
    }),
    [400, 'Bad Request: method is available only in supergroups'],
    'Expected a private chat to be refused',
  );
  await readUpdates(moderatorBot.botApiPath);

  // A user outside the supergroup is restricted before it joins, and joins restricted.
  expectEqual(
    await restrict(moderatorBot, { user_id: linus.id }),
    [200, true],
    'Expected a non-member to be restricted',
  );
  const restrictedOutsider = await getChatMember(linus.id);
  await api.request(`${supergroupPath(ada.id)}/members/${linus.id}`, { method: 'PUT' });
  expectEqual(
    [restrictedOutsider, await getChatMember(linus.id)],
    [
      restrictedMember(linus, ['can_send_messages', 'can_react_to_messages'], { isMember: false }),
      restrictedMember(linus, ['can_send_messages', 'can_react_to_messages']),
    ],
    'Expected the outsider to join with its restriction',
  );
  expectEqual(
    describeMembershipUpdates(await readUpdates(moderatorBot.botApiPath)),
    [
      `chat_member ${linus.id}: left -> restricted`,
      `chat_member ${linus.id}: restricted -> restricted`,
      'message',
    ],
    'Expected the restriction and the restricted arrival to be observed',
  );
});

Deno.test('a restricted bot cannot send or forward what it may not, nor lift its restriction', async () => {
  const {
    ada,
    otherBot,
    supergroup,
    supergroupPath,
    api,
    readUpdates,
    describeCall,
    sendAccountMessage,
  } = await createRestrictionFixture();
  const photoMessage = await sendAccountMessage(ada.id, {
    photo: { content_base64: PHOTO_BASE64 },
  });
  // The owner restricts the bot through the emulation API, as `restrictChatMember` would.
  await expectStatus(
    api.request(
      `${supergroupPath(ada.id)}/restrictions/${otherBot.bot.id}`,
      jsonRequest('PUT', { permissions: { can_send_messages: true } }),
    ),
    204,
    'Expected the owner to restrict the bot',
  );
  const messageId = photoMessage.body.message?.message_id;
  const calls = [
    await describeCall(otherBot, 'sendMessage', { chat_id: supergroup.id, text: 'Hi' }),
    await describeCall(otherBot, 'forwardMessage', {
      chat_id: supergroup.id,
      from_chat_id: supergroup.id,
      message_id: messageId,
    }),
    await describeCall(otherBot, 'copyMessage', {
      chat_id: supergroup.id,
      from_chat_id: supergroup.id,
      message_id: messageId,
    }),
    await describeCall(otherBot, 'forwardMessages', {
      chat_id: supergroup.id,
      from_chat_id: supergroup.id,
      message_ids: [messageId],
    }),
    await describeCall(otherBot, 'sendPoll', {
      chat_id: supergroup.id,
      question: 'Lunch?',
      options: ['Pizza', 'Pasta'],
    }),
    await describeCall(otherBot, 'restrictChatMember', {
      chat_id: supergroup.id,
      user_id: otherBot.bot.id,
      permissions: ALL_PERMISSIONS,
    }),
  ].map(([status, result]) => [status, typeof result === 'string' ? result : 'sent']);
  expectEqual(
    calls,
    [
      [200, 'sent'],
      [400, "Bad Request: the message can't be forwarded"],
      [400, "Bad Request: the message can't be copied"],
      [400, "Bad Request: messages can't be forwarded"],
      [400, 'Bad Request: not enough rights to send polls to the chat'],
      [400, "Bad Request: can't unrestrict self"],
    ],
    'Expected the restricted bot to send only text',
  );
  const myChatMember = (await readUpdates(otherBot.botApiPath)).find((update) =>
    'my_chat_member' in update
  )?.my_chat_member as { from: { id: number }; new_chat_member: Record<string, unknown> };
  expectEqual(
    [
      myChatMember.from.id,
      myChatMember.new_chat_member.status,
      myChatMember.new_chat_member.until_date,
    ],
    [ada.id, 'restricted', 0],
    'Expected the bot to observe its own restriction by the owner',
  );

  // The owner lifts the restriction, after which the bot sends a poll; a repeated lift changes
  // nothing.
  for (const expectedStatus of [204, 204]) {
    await expectStatus(
      api.request(`${supergroupPath(ada.id)}/restrictions/${otherBot.bot.id}`, {
        method: 'DELETE',
      }),
      expectedStatus,
      'Expected the owner to lift the restriction',
    );
  }
  expectEqual(
    (await describeCall(otherBot, 'sendPoll', {
      chat_id: supergroup.id,
      question: 'Lunch?',
      options: ['Pizza', 'Pasta'],
    }))[0],
    200,
    'Expected the poll to be sent once the restriction is lifted',
  );
  expectEqual(
    describeMembershipUpdates(await readUpdates(otherBot.botApiPath)),
    [`my_chat_member ${otherBot.bot.id}: restricted -> member`],
    'Expected one update for the lifted restriction',
  );
});

Deno.test('only the owner restricts users through the emulation API', async () => {
  const { ada, grace, linus, accountPath, supergroupPath, api, getChatMember } =
    await createRestrictionFixture();
  const restrictAs = (accountId: number, userId: number, body: unknown) =>
    api.request(`${supergroupPath(accountId)}/restrictions/${userId}`, jsonRequest('PUT', body));
  const restriction = { permissions: { can_send_messages: true } };

  const statuses = [
    (await restrictAs(grace.id, linus.id, restriction)).status,
    (await restrictAs(ada.id, ada.id, restriction)).status,
    (await restrictAs(ada.id, 999_999, restriction)).status,
    (await restrictAs(ada.id, grace.id, { permissions: { can_send_media_messages: true } }))
      .status,
    (await restrictAs(ada.id, grace.id, { ...restriction, until_date: 'soon' })).status,
    (await api.request(
      `${accountPath(ada.id)}/conversations/supergroup/-1000000999999/restrictions/${grace.id}`,
      jsonRequest('PUT', restriction),
    )).status,
  ];
  const ownerLift = await api.request(`${supergroupPath(ada.id)}/restrictions/${ada.id}`, {
    method: 'DELETE',
  });
  expectEqual(
    [...statuses, ownerLift.status],
    [403, 409, 404, 400, 400, 404, 409],
    'Expected owner-only restriction checks',
  );
  expectEqual(
    await getChatMember(grace.id),
    { user: grace, status: 'member' },
    'Expected refused restrictions to change nothing',
  );

  // The owner's restriction keeps exactly the listed permissions; none implies another.
  await restrictAs(ada.id, grace.id, {
    permissions: { can_send_polls: true, can_pin_messages: true },
    until_date: nowUnixSeconds() + 60,
  });
  const member = await getChatMember(grace.id);
  expectEqual(
    CHAT_PERMISSION_NAMES.filter((name) => member[name] === true),
    ['can_send_polls', 'can_pin_messages'],
    'Expected only the listed permissions',
  );
  if (member.status !== 'restricted' || member.until_date === 0) {
    throw new Error(`Expected a temporary restriction, received ${JSON.stringify(member)}`);
  }
});

Deno.test('tests end temporary restrictions explicitly, as their dates normalize', async () => {
  const {
    grace,
    linus,
    moderatorBot,
    supergroup,
    sessionPath,
    api,
    readUpdates,
    callBot,
    getChatMember,
  } = await createRestrictionFixture();
  const restrictUntil = async (userId: number, untilDate: number) => {
    await callBot(moderatorBot, 'restrictChatMember', {
      chat_id: supergroup.id,
      user_id: userId,
      permissions: { can_send_messages: true },
      until_date: untilDate,
    });
    return (await getChatMember(userId)).until_date;
  };
  const expiryPath = (chatId: number, userId: number) =>
    `${sessionPath}/supergroups/${chatId}/restrictions/${userId}/expiry`;
  const now = nowUnixSeconds();

  // As on Telegram, a restriction shorter than 30 seconds or longer than 366 days is permanent.
  const untilDates = [
    await restrictUntil(grace.id, now + 10),
    await restrictUntil(grace.id, now + 400 * 24 * 60 * 60),
    await restrictUntil(grace.id, now + 3_600),
  ];
  expectEqual(untilDates, [0, 0, now + 3_600], 'Expected normalized restriction ends');
  await readUpdates(moderatorBot.botApiPath);

  // A stored date alone ends nothing; the test makes the end arrive.
  const beforeExpiry = (await getChatMember(grace.id)).status;
  const expiry = await requestJson<{ chat_member: unknown }>(
    api,
    'POST',
    expiryPath(supergroup.id, grace.id),
  );
  expectEqual(
    [beforeExpiry, expiry.status, expiry.body.chat_member, await getChatMember(grace.id)],
    ['restricted', 200, { user: grace, status: 'member' }, { user: grace, status: 'member' }],
    'Expected the restriction to end when the test ends it',
  );
  expectEqual(
    await readUpdates(moderatorBot.botApiPath),
    [],
    'Expected no update for an ended restriction, as Telegram announces none',
  );

  // A non-member's temporary restriction ends as having left it.
  await restrictUntil(linus.id, now + 3_600);
  const outsiderExpiry = await requestJson<{ chat_member: unknown }>(
    api,
    'POST',
    expiryPath(supergroup.id, linus.id),
  );
  await restrictUntil(grace.id, now + 10);
  const statuses = [
    (await api.request(expiryPath(supergroup.id, linus.id), { method: 'POST' })).status,
    (await api.request(expiryPath(supergroup.id, grace.id), { method: 'POST' })).status,
    (await api.request(expiryPath(-1_000_000_999_999, grace.id), { method: 'POST' })).status,
    (await api.request(expiryPath(supergroup.id, 999_999), { method: 'POST' })).status,
  ];
  expectEqual(
    [outsiderExpiry.body.chat_member, statuses],
    [{ user: linus, status: 'left' }, [409, 409, 404, 404]],
    'Expected only temporary restrictions to end',
  );
});

Deno.test('a grammY bot mutes a member through its webhook and observes the change', async () => {
  const {
    api,
    sessionPath,
    ada,
    grace,
    moderatorBot,
    getChatMember,
    sendAccountMessage,
  } = await createRestrictionFixture();
  const grammyBot = new Bot(moderatorBot.token, {
    client: {
      apiRoot: `http://emulator.example:9000${sessionPath}/bot-api`,
      fetch: async (input, init) => await api.fetch(new Request(input, init)),
    },
  });
  const restrictionObserved = Promise.withResolvers<string>();
  grammyBot.command('mute', async (context) => {
    const mutedUser = context.message?.reply_to_message?.from;
    if (mutedUser !== undefined) {
      await context.restrictChatMember(mutedUser.id, { can_send_messages: false });
    }
  });
  grammyBot.on('chat_member', (context) => {
    restrictionObserved.resolve(context.chatMember.new_chat_member.status);
  });
  const handleWebhookRequest = webhookCallback(grammyBot, 'std/http');
  const webhookServer = Deno.serve(
    { hostname: '127.0.0.1', port: 0, onListen: () => {} },
    (request) => handleWebhookRequest(request),
  );
  try {
    await grammyBot.api.setWebhook(`http://127.0.0.1:${webhookServer.addr.port}/webhook`, {
      allowed_updates: ['message', 'chat_member'],
    });
    const spam = await sendAccountMessage(grace.id, { text: 'Buy now!' });
    await sendAccountMessage(ada.id, {
      text: '/mute',
      reply_to_message_id: spam.body.message?.message_id,
    });
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const observedStatus = await Promise.race([
      restrictionObserved.promise,
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(
          () => reject(new Error('Expected the bot to observe the restriction')),
          5_000,
        );
      }),
    ]).finally(() => clearTimeout(timeoutId));
    expectEqual(
      [observedStatus, (await getChatMember(grace.id)).can_send_messages],
      ['restricted', false],
      'Expected the bot to mute the member',
    );
    expectEqual(
      (await sendAccountMessage(grace.id, { text: 'Still buying?' })).status,
      403,
      'Expected the muted member to be refused',
    );
  } finally {
    await api.request(sessionPath, { method: 'DELETE' });
    await webhookServer.shutdown();
  }
});
