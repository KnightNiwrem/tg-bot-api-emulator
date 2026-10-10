import {
  createSession,
  createTestSession,
  type EmulationApi,
  requestJson,
} from './support/emulation_api.ts';

interface BotApiResponse {
  readonly ok: boolean;
  readonly result?: unknown;
  readonly description?: string;
}

interface FixtureBot {
  readonly token: string;
  readonly bot: { readonly id: number; readonly username: string };
  readonly botApiPath: string;
}

interface FixtureAccount {
  readonly id: number;
  readonly first_name: string;
}

/** A link as `createChatInviteLink` returns it, in the field order Telegram shows. */
interface CreatedInviteLink {
  readonly invite_link: string;
  readonly [field: string]: unknown;
}

const INVITE_LINK_PATTERN = /^https:\/\/t\.me\/\+[A-Za-z0-9_-]{16}$/;

/** The rights of the administrator bot that creates links: only `can_invite_users`. */
const INVITER_RIGHTS = { can_invite_users: true };

/**
 * Creates a session where Ada owns the supergroup Team with three bots: the inviter, an
 * administrator with `can_invite_users`; the observer, an administrator without it; and a plain
 * member. Grace, Hopper and Linus are accounts outside the supergroup. Every bot reads its
 * membership updates and messages.
 */
async function createInviteLinkFixture() {
  const { api, sessionPath } = await createTestSession();
  const createAccount = (firstName: string) => createSessionAccount(api, sessionPath, firstName);
  const ada = await createAccount('Ada');
  const grace = await createAccount('Grace');
  const hopper = await createAccount('Hopper');
  const linus = await createAccount('Linus');
  const createBot = async (username: string): Promise<FixtureBot> => {
    const { body } = await requestJson<{ token: string; bot: { id: number; username: string } }>(
      api,
      'POST',
      `${sessionPath}/bots`,
      { first_name: 'Test Bot', username },
    );
    return { ...body, botApiPath: `${sessionPath}/bot-api/bot${body.token}` };
  };
  const inviterBot = await createBot('inviter_bot');
  const observerBot = await createBot('observer_bot');
  const memberBot = await createBot('member_bot');

  const { body: { supergroup } } = await requestJson<{ supergroup: { id: number } }>(
    api,
    'POST',
    `${sessionPath}/accounts/${ada.id}/supergroups`,
    { title: 'Team' },
  );
  const supergroupPath = (accountId: number, chatId = supergroup.id) =>
    `${sessionPath}/accounts/${accountId}/conversations/supergroup/${chatId}`;
  const addMember = (userId: number, chatId = supergroup.id) =>
    expectStatus(
      api.request(`${supergroupPath(ada.id, chatId)}/members/${userId}`, { method: 'PUT' }),
      204,
      `Expected member ${userId} to be added`,
    );
  const promote = (userId: number, rights: Record<string, boolean>, chatId = supergroup.id) =>
    expectStatus(
      api.request(
        `${supergroupPath(ada.id, chatId)}/administrators/${userId}`,
        jsonRequest('PUT', rights),
      ),
      204,
      `Expected the owner to promote user ${userId}`,
    );
  for (const bot of [inviterBot, observerBot, memberBot]) {
    await addMember(bot.bot.id);
  }
  await promote(inviterBot.bot.id, INVITER_RIGHTS);
  await promote(observerBot.bot.id, { can_delete_messages: true });

  const readUpdates = createUpdateReader(api);
  for (const bot of [inviterBot, observerBot, memberBot]) {
    await readUpdates(bot);
  }
  const callBot = async (bot: FixtureBot, method: string, parameters: object) => {
    const { status, body } = await requestJson<BotApiResponse>(
      api,
      'POST',
      `${bot.botApiPath}/${method}`,
      parameters,
    );
    return { status, body };
  };
  const createLink = async (parameters: object = {}, bot = inviterBot) => {
    const { status, body } = await callBot(bot, 'createChatInviteLink', {
      chat_id: supergroup.id,
      ...parameters,
    });
    if (status !== 200) {
      throw new Error(`Expected the link to be created: ${body.description}`);
    }
    return body.result as CreatedInviteLink;
  };
  /** Replaces the bot's primary link with `exportChatInviteLink`; returns the new link. */
  const exportLink = async (bot = inviterBot) => {
    const { status, body } = await callBot(bot, 'exportChatInviteLink', { chat_id: supergroup.id });
    if (status !== 200 || typeof body.result !== 'string') {
      throw new Error(`Expected the primary link to be exported: ${body.description}`);
    }
    return body.result;
  };
  /** The primary link `getChat` shows the bot; `undefined` when it shows none. */
  const getChatInviteLink = async (bot = inviterBot) => {
    const { status, body } = await callBot(bot, 'getChat', { chat_id: supergroup.id });
    if (status !== 200) {
      throw new Error(`Expected the bot to read the chat: ${body.description}`);
    }
    return (body.result as { invite_link?: string }).invite_link;
  };
  const joinByLink = (account: FixtureAccount, inviteLink: string) =>
    requestJson<{ chat_id: number; outcome: string }>(
      api,
      'POST',
      `${sessionPath}/accounts/${account.id}/chat-joins`,
      { invite_link: inviteLink },
    );
  const getInviteLinks = (accountId = ada.id) =>
    requestJson<{ invite_links: Array<Record<string, unknown>> }>(
      api,
      'GET',
      `${supergroupPath(accountId)}/invite-links`,
    );
  const getMemberStatus = async (userId: number) =>
    ((await callBot(inviterBot, 'getChatMember', { chat_id: supergroup.id, user_id: userId }))
      .body.result as { status: string; is_member?: boolean }).status;
  const getMemberCount = async () =>
    (await callBot(inviterBot, 'getChatMemberCount', { chat_id: supergroup.id })).body.result;

  return {
    api,
    sessionPath,
    ada,
    grace,
    hopper,
    linus,
    inviterBot,
    observerBot,
    memberBot,
    supergroup,
    supergroupPath,
    addMember,
    promote,
    readUpdates,
    callBot,
    createLink,
    exportLink,
    getChatInviteLink,
    joinByLink,
    getInviteLinks,
    getMemberStatus,
    getMemberCount,
  };
}

async function createSessionAccount(
  api: EmulationApi,
  sessionPath: string,
  firstName: string,
): Promise<FixtureAccount> {
  return (await requestJson<{ account: FixtureAccount }>(
    api,
    'POST',
    `${sessionPath}/accounts`,
    { first_name: firstName },
  )).body.account;
}

/** Returns a reader of each bot's updates since the reader last read that bot's. */
function createUpdateReader(api: EmulationApi) {
  const nextOffsetsByBotApiPath = new Map<string, number>();
  return async (bot: FixtureBot): Promise<Array<Record<string, unknown>>> => {
    const { body } = await requestJson<{ result: Array<Record<string, unknown>> }>(
      api,
      'POST',
      `${bot.botApiPath}/getUpdates`,
      {
        offset: nextOffsetsByBotApiPath.get(bot.botApiPath) ?? 0,
        allowed_updates: ['message', 'chat_member', 'my_chat_member'],
      },
    );
    const lastUpdateId = body.result.at(-1)?.update_id;
    if (typeof lastUpdateId === 'number') {
      nextOffsetsByBotApiPath.set(bot.botApiPath, lastUpdateId + 1);
    }
    return body.result.map(({ update_id: _updateId, ...update }) => update);
  };
}

/** Describes membership updates and service messages briefly, as `kind user: old -> new`. */
function describeUpdates(updates: ReadonlyArray<Record<string, unknown>>): string[] {
  return updates.map((update) => {
    const chatMember = update.chat_member as
      | {
        from: { id: number };
        old_chat_member: { user: { id: number }; status: string };
        new_chat_member: { status: string };
        invite_link?: { invite_link: string };
      }
      | undefined;
    if (chatMember !== undefined) {
      const link = chatMember.invite_link === undefined
        ? ''
        : ` via ${chatMember.invite_link.invite_link}`;
      return `chat_member ${chatMember.old_chat_member.user.id} by ${chatMember.from.id}: ${chatMember.old_chat_member.status} -> ${chatMember.new_chat_member.status}${link}`;
    }
    const message = update.message as
      | { from: { id: number }; new_chat_members?: Array<{ id: number }> }
      | undefined;
    if (message?.new_chat_members !== undefined) {
      return `joined ${
        message.new_chat_members.map(({ id }) => id).join(',')
      } by ${message.from.id}`;
    }
    return JSON.stringify(update);
  });
}

function botUser(bot: FixtureBot) {
  return { id: bot.bot.id, is_bot: true, first_name: 'Test Bot', username: bot.bot.username };
}

/** The hash after `https://t.me/+`, by which the emulation API names a link. */
function inviteLinkHash(inviteLink: string): string {
  return inviteLink.slice('https://t.me/+'.length);
}

/** The link as an administrator other than its creator sees it, with half its hash hidden. */
function hiddenInviteLink(inviteLink: string): string {
  return `https://t.me/+${inviteLinkHash(inviteLink).slice(0, 8)}...`;
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

/** Compares JSON values by content: object keys in any order, array items in order. */
function expectEqual(actual: unknown, expected: unknown, message: string): void {
  if (toCanonicalJson(actual) !== toCanonicalJson(expected)) {
    throw new Error(
      `${message}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`,
    );
  }
}

function toCanonicalJson(value: unknown): string {
  return JSON.stringify(
    value,
    (_key, nested: unknown) =>
      typeof nested === 'object' && nested !== null && !Array.isArray(nested)
        ? Object.fromEntries(
          Object.entries(nested).sort(([first], [second]) => first < second ? -1 : 1),
        )
        : nested,
  );
}

function nowUnixSeconds(): number {
  return Math.floor(Date.now() / 1_000);
}

Deno.test('an administrator bot creates invite links that keep the settings it chose', async () => {
  const { ada, inviterBot, createLink, getInviteLinks } = await createInviteLinkFixture();
  const expireDate = nowUnixSeconds() + 3_600;

  const namedLink = await createLink({
    name: '  Spring \n  sign-ups ',
    expire_date: expireDate,
    member_limit: 5,
  });
  const plainLink = await createLink();
  const longNamedLink = await createLink({ name: 'x'.repeat(40), creates_join_request: true });

  expectEqual(
    [namedLink, plainLink, longNamedLink].map(({ invite_link }) =>
      INVITE_LINK_PATTERN.test(invite_link)
    ),
    [true, true, true],
    'Expected each link to be a t.me link with a hash',
  );
  expectEqual(
    new Set([namedLink, plainLink, longNamedLink].map(({ invite_link }) => invite_link)).size,
    3,
    'Expected each link to be new',
  );
  expectEqual(
    Object.keys(namedLink),
    [
      'invite_link',
      'name',
      'creator',
      'expire_date',
      'member_limit',
      'creates_join_request',
      'is_primary',
      'is_revoked',
    ],
    "Expected the fields in the official server's order",
  );
  expectEqual(
    namedLink,
    {
      invite_link: namedLink.invite_link,
      name: 'Spring sign-ups',
      creator: botUser(inviterBot),
      expire_date: expireDate,
      member_limit: 5,
      creates_join_request: false,
      is_primary: false,
      is_revoked: false,
    },
    'Expected the name cleaned as Telegram cleans names, and the other settings kept',
  );
  expectEqual(
    plainLink,
    {
      invite_link: plainLink.invite_link,
      creator: botUser(inviterBot),
      creates_join_request: false,
      is_primary: false,
      is_revoked: false,
    },
    'Expected a link without settings to omit them',
  );
  expectEqual(
    [longNamedLink.name, longNamedLink.creates_join_request],
    ['x'.repeat(32), true],
    'Expected a name cut to 32 characters, and the join request policy kept',
  );
  expectEqual(
    await getInviteLinks(ada.id),
    {
      status: 200,
      body: {
        invite_links: [
          {
            invite_link: namedLink.invite_link,
            name: 'Spring sign-ups',
            creator_user_id: inviterBot.bot.id,
            expire_date: expireDate,
            member_limit: 5,
            member_count: 0,
            pending_join_request_count: 0,
            creates_join_request: false,
            is_primary: false,
            is_expired: false,
            is_revoked: false,
          },
          {
            invite_link: plainLink.invite_link,
            creator_user_id: inviterBot.bot.id,
            member_count: 0,
            pending_join_request_count: 0,
            creates_join_request: false,
            is_primary: false,
            is_expired: false,
            is_revoked: false,
          },
          {
            invite_link: longNamedLink.invite_link,
            name: 'x'.repeat(32),
            creator_user_id: inviterBot.bot.id,
            member_count: 0,
            pending_join_request_count: 0,
            creates_join_request: true,
            is_primary: false,
            is_expired: false,
            is_revoked: false,
          },
        ],
      },
    },
    'Expected the owner to see every link in the order it was created',
  );
});

Deno.test('createChatInviteLink refuses invalid settings and bots without the right', async () => {
  const {
    api,
    sessionPath,
    ada,
    grace,
    inviterBot,
    observerBot,
    memberBot,
    supergroup,
    callBot,
    getInviteLinks,
  } = await createInviteLinkFixture();
  // Grace starts a private chat with the inviter, which has no invite links.
  await expectStatus(
    api.request(
      `${sessionPath}/accounts/${grace.id}/messages`,
      jsonRequest('POST', { to: { type: 'private', botId: inviterBot.bot.id }, text: 'hi' }),
    ),
    201,
    'Expected Grace to write to the inviter',
  );
  const { body: { supergroup: otherSupergroup } } = await requestJson<
    { supergroup: { id: number } }
  >(api, 'POST', `${sessionPath}/accounts/${ada.id}/supergroups`, { title: 'Elsewhere' });
  const now = nowUnixSeconds();
  const create = async (bot: FixtureBot, parameters: object) => {
    const { status, body } = await callBot(bot, 'createChatInviteLink', parameters);
    return [status, body.description];
  };
  const inChat = (parameters: object = {}) => ({ chat_id: supergroup.id, ...parameters });
  const invalidParameters = [400, 'Bad Request: invalid createChatInviteLink parameters'];

  expectEqual(
    [
      await create(inviterBot, {}),
      await create(inviterBot, inChat({ member_limit: -1 })),
      await create(inviterBot, inChat({ expire_date: -1 })),
      await create(inviterBot, inChat({ expire_date: 'tomorrow' })),
      await create(inviterBot, inChat({ creates_join_request: 'maybe' })),
      await create(inviterBot, inChat({ subscription_period: 2_592_000 })),
      await create(inviterBot, { chat_id: -1_009_999_999_999 }),
      await create(inviterBot, { chat_id: otherSupergroup.id }),
      await create(inviterBot, { chat_id: grace.id, member_limit: 1, creates_join_request: true }),
      await create(inviterBot, inChat({ name: 'bad \ud800 name' })),
      await create(memberBot, inChat({ member_limit: 1, creates_join_request: true })),
      await create(memberBot, inChat()),
      await create(observerBot, inChat()),
      await create(inviterBot, inChat({ expire_date: now - 10 })),
      await create(inviterBot, inChat({ expire_date: 1 })),
      await create(inviterBot, inChat({ member_limit: 100_000 })),
    ],
    [
      [400, 'Bad Request: chat_id is empty'],
      invalidParameters,
      invalidParameters,
      invalidParameters,
      invalidParameters,
      invalidParameters,
      [400, 'Bad Request: chat not found'],
      [400, 'Bad Request: chat not found'],
      [400, "Bad Request: can't invite members to a private chat"],
      [400, 'Bad Request: strings must be encoded in UTF-8'],
      [
        400,
        "Bad Request: member limit can't be specified for links requiring administrator approval",
      ],
      [400, 'Bad Request: not enough rights to manage chat invite link'],
      [400, 'Bad Request: not enough rights to manage chat invite link'],
      [400, 'Bad Request: EXPIRE_DATE_INVALID'],
      [400, 'Bad Request: EXPIRE_DATE_INVALID'],
      [400, 'Bad Request: USAGE_LIMIT_INVALID'],
    ],
    'Expected each refusal in the order Telegram checks',
  );
  expectEqual(
    await getInviteLinks(ada.id),
    { status: 200, body: { invite_links: [] } },
    'Expected no refused request to create a link',
  );

  await callBot(memberBot, 'leaveChat', { chat_id: supergroup.id });
  expectEqual(
    await create(memberBot, inChat()),
    [403, 'Forbidden: bot is not a member of the supergroup chat'],
    'Expected a bot that left to be turned away',
  );
  // A zero expiry date or member limit means none, as Telegram reads them.
  const { status, body } = await callBot(
    inviterBot,
    'createChatInviteLink',
    inChat({ expire_date: 0, member_limit: 0 }),
  );
  expectEqual(
    [status, 'expire_date' in (body.result as object), 'member_limit' in (body.result as object)],
    [200, false, false],
    'Expected a zero expiry date and member limit to set none',
  );
});

Deno.test('an account joins through an invite link, and bots see the link it used', async () => {
  const {
    api,
    grace,
    inviterBot,
    observerBot,
    memberBot,
    supergroup,
    supergroupPath,
    readUpdates,
    createLink,
    joinByLink,
    getInviteLinks,
    getMemberStatus,
    getMemberCount,
  } = await createInviteLinkFixture();
  const link = await createLink({ name: 'Friends', member_limit: 3 });
  const memberCountBefore = await getMemberCount();

  const joining = await joinByLink(grace, link.invite_link);

  expectEqual(
    joining,
    { status: 200, body: { chat_id: supergroup.id, outcome: 'joined' } },
    'Expected Grace to join',
  );
  expectEqual(
    [await getMemberStatus(grace.id), await getMemberCount()],
    ['member', (memberCountBefore as number) + 1],
    'Expected Grace to be a member, counted among the members',
  );
  const inviterUpdates = await readUpdates(inviterBot);
  const chatMemberUpdate = inviterUpdates.find((update) => 'chat_member' in update)
    ?.chat_member as Record<string, unknown>;
  expectEqual(
    Object.keys(chatMemberUpdate),
    ['chat', 'from', 'date', 'old_chat_member', 'new_chat_member', 'invite_link'],
    'Expected the invite link after the members, as the official server shows it',
  );
  expectEqual(
    chatMemberUpdate,
    {
      chat: { id: supergroup.id, title: 'Team', type: 'supergroup' },
      from: { id: grace.id, is_bot: false, first_name: 'Grace' },
      date: chatMemberUpdate.date,
      old_chat_member: {
        user: { id: grace.id, is_bot: false, first_name: 'Grace' },
        status: 'left',
      },
      new_chat_member: {
        user: { id: grace.id, is_bot: false, first_name: 'Grace' },
        status: 'member',
      },
      invite_link: link,
    },
    'Expected the creator to see the whole link Grace joined through',
  );
  expectEqual(
    describeUpdates(inviterUpdates),
    [
      `chat_member ${grace.id} by ${grace.id}: left -> member via ${link.invite_link}`,
      `joined ${grace.id} by ${grace.id}`,
    ],
    "Expected the inviter to see the change and Grace's own service message",
  );
  expectEqual(
    describeUpdates(await readUpdates(observerBot)),
    [
      `chat_member ${grace.id} by ${grace.id}: left -> member via ${
        hiddenInviteLink(link.invite_link)
      }`,
      `joined ${grace.id} by ${grace.id}`,
    ],
    'Expected another administrator to see the link with its hash hidden',
  );
  expectEqual(
    describeUpdates(await readUpdates(memberBot)),
    [`joined ${grace.id} by ${grace.id}`],
    'Expected a bot that is no administrator to see only the service message',
  );
  const { body: { messages } } = await requestJson<
    { messages: Array<{ from: { id: number }; new_chat_members?: Array<{ id: number }> }> }
  >(api, 'GET', `${supergroupPath(grace.id)}/messages`);
  expectEqual(
    [messages.at(-1)?.from.id, messages.at(-1)?.new_chat_members?.map(({ id }) => id)],
    [grace.id, [grace.id]],
    "Expected Grace's history to end with her own joining",
  );
  expectEqual(
    (await getInviteLinks()).body.invite_links.map(({ member_count }) => member_count),
    [1],
    'Expected the link to count Grace',
  );
});

Deno.test('using an invite link has an explicit outcome for each standing and link', async () => {
  const {
    api,
    sessionPath,
    ada,
    grace,
    hopper,
    linus,
    inviterBot,
    supergroup,
    supergroupPath,
    addMember,
    readUpdates,
    callBot,
    createLink,
    joinByLink,
    getMemberStatus,
    getMemberCount,
  } = await createInviteLinkFixture();
  const link = await createLink();
  // Hopper is banned by his removal; Linus is restricted before he joins.
  await addMember(hopper.id);
  await expectStatus(
    api.request(`${supergroupPath(ada.id)}/members/${hopper.id}`, { method: 'DELETE' }),
    204,
    'Expected Hopper to be removed',
  );
  await expectStatus(
    api.request(
      `${supergroupPath(ada.id)}/restrictions/${linus.id}`,
      jsonRequest('PUT', { permissions: { can_send_messages: true } }),
    ),
    204,
    'Expected Linus to be restricted',
  );
  await joinByLink(grace, link.invite_link);
  await readUpdates(inviterBot);
  const memberCountBefore = await getMemberCount();
  const otherSessionPath = await createSession(api);
  const outsider = await createSessionAccount(api, otherSessionPath, 'Outsider');
  const join = async (accountPath: string, body: unknown) =>
    (await requestJson(api, 'POST', `${accountPath}/chat-joins`, body)).status;
  const accountPath = (account: FixtureAccount) => `${sessionPath}/accounts/${account.id}`;

  expectEqual(
    [
      await join(accountPath(grace), { invite_link: link.invite_link }),
      await join(accountPath(hopper), { invite_link: link.invite_link }),
      await join(accountPath(hopper), { invite_link: 'https://t.me/+AAAAAAAAAAAAAAAA' }),
      await join(accountPath(hopper), { invite_link: link.invite_link.replace('https://', '') }),
      await join(`${sessionPath}/accounts/999999999`, { invite_link: link.invite_link }),
      await join(`${otherSessionPath}/accounts/${outsider.id}`, { invite_link: link.invite_link }),
      await join(accountPath(hopper), {}),
      await join(accountPath(hopper), { invite_link: link.invite_link, extra: true }),
    ],
    [409, 403, 404, 404, 404, 404, 400, 400],
    'Expected a member to conflict, a banned user to be refused, and unknown links not found',
  );
  expectEqual(
    [await getMemberStatus(hopper.id), await getMemberCount(), await readUpdates(inviterBot)],
    ['kicked', memberCountBefore, []],
    'Expected the refusals to change nothing',
  );

  const linusJoining = await joinByLink(linus, link.invite_link);
  const linusMember = (await callBot(inviterBot, 'getChatMember', {
    chat_id: supergroup.id,
    user_id: linus.id,
  })).body.result as { status: string; is_member: boolean; can_send_messages: boolean };
  expectEqual(
    [linusJoining.status, linusMember.status, linusMember.is_member, linusMember.can_send_messages],
    [200, 'restricted', true, true],
    'Expected a restricted user to join with its restriction',
  );
});

Deno.test('a member limit counts members that joined through the link while they stay', async () => {
  const {
    api,
    ada,
    grace,
    hopper,
    linus,
    supergroupPath,
    addMember,
    createLink,
    joinByLink,
    getInviteLinks,
  } = await createInviteLinkFixture();
  const link = await createLink({ member_limit: 1 });
  const leave = (account: FixtureAccount) =>
    expectStatus(
      api.request(`${supergroupPath(account.id)}/members/${account.id}`, { method: 'DELETE' }),
      204,
      `Expected ${account.first_name} to leave`,
    );
  const memberCount = async () => (await getInviteLinks()).body.invite_links[0].member_count;
  const steps: unknown[] = [];

  steps.push((await joinByLink(grace, link.invite_link)).status, await memberCount());
  steps.push((await joinByLink(hopper, link.invite_link)).status);
  await leave(grace);
  steps.push(await memberCount());
  steps.push((await joinByLink(hopper, link.invite_link)).status, await memberCount());
  steps.push((await joinByLink(grace, link.invite_link)).status);
  // A user the owner adds takes no place, even if it once joined through the link.
  await leave(hopper);
  await addMember(hopper.id);
  steps.push(await memberCount());
  steps.push((await joinByLink(linus, link.invite_link)).status, await memberCount());
  // A member the owner removes frees its place too.
  await expectStatus(
    api.request(`${supergroupPath(ada.id)}/members/${linus.id}`, { method: 'DELETE' }),
    204,
    'Expected Linus to be removed',
  );
  steps.push(await memberCount());

  expectEqual(
    steps,
    [200, 1, 410, 0, 200, 1, 410, 0, 200, 1, 0],
    'Expected the limit to count the members that joined through the link and still are',
  );
});

Deno.test('a test makes an invite link expire, after which it admits nobody', async () => {
  const {
    api,
    sessionPath,
    grace,
    hopper,
    inviterBot,
    supergroup,
    createLink,
    joinByLink,
    getInviteLinks,
    getMemberStatus,
  } = await createInviteLinkFixture();
  const expireDate = nowUnixSeconds() + 3_600;
  const expiringLink = await createLink({ expire_date: expireDate });
  const lastingLink = await createLink();
  await joinByLink(grace, expiringLink.invite_link);
  const expire = (inviteLink: string, chatId = supergroup.id) =>
    requestJson<{ invite_link: Record<string, unknown> }>(
      api,
      'POST',
      `${sessionPath}/supergroups/${chatId}/invite-links/${inviteLinkHash(inviteLink)}/expiry`,
    );

  expectEqual(
    await expire(expiringLink.invite_link),
    {
      status: 200,
      body: {
        invite_link: {
          invite_link: expiringLink.invite_link,
          creator_user_id: inviterBot.bot.id,
          expire_date: expireDate,
          member_count: 1,
          pending_join_request_count: 0,
          creates_join_request: false,
          is_primary: false,
          is_expired: true,
          is_revoked: false,
        },
      },
    },
    'Expected the link to expire, keeping the members that joined through it',
  );
  expectEqual(
    [
      (await joinByLink(hopper, expiringLink.invite_link)).status,
      await getMemberStatus(hopper.id),
      await getMemberStatus(grace.id),
      (await expire(expiringLink.invite_link)).status,
      (await expire(lastingLink.invite_link)).status,
      (await expire('https://t.me/+AAAAAAAAAAAAAAAA')).status,
      (await expire(expiringLink.invite_link, -1_009_999_999_999)).status,
      (await expire('https://t.me/+short')).status,
    ],
    [410, 'left', 'member', 409, 409, 404, 404, 400],
    'Expected an expired link to admit nobody, and only a pending expiry date to arrive',
  );
  expectEqual(
    (await getInviteLinks()).body.invite_links.map(({ is_expired }) => is_expired),
    [true, false],
    'Expected only the expired link to show it',
  );
});

Deno.test('only the owner inspects the invite links of a supergroup', async () => {
  const { api, sessionPath, ada, grace, inviterBot, addMember, promote, getInviteLinks } =
    await createInviteLinkFixture();
  await addMember(grace.id);
  await promote(grace.id, { can_invite_users: true });

  expectEqual(
    [
      (await getInviteLinks(ada.id)).status,
      (await getInviteLinks(grace.id)).status,
      (await getInviteLinks(inviterBot.bot.id)).status,
      (await requestJson(
        api,
        'GET',
        `${sessionPath}/accounts/${ada.id}/conversations/supergroup/-1009999999999/invite-links`,
      )).status,
    ],
    [200, 403, 404, 404],
    'Expected an administrator account, a bot and an unknown chat to be refused',
  );
});

Deno.test('accounts join a public supergroup by themselves, without an invite link', async () => {
  const { api, sessionPath, ada, grace, hopper, inviterBot, readUpdates, callBot } =
    await createInviteLinkFixture();
  const createSupergroup = async (body: object) =>
    (await requestJson<{ supergroup: { id: number } }>(
      api,
      'POST',
      `${sessionPath}/accounts/${ada.id}/supergroups`,
      body,
    )).body.supergroup;
  const commons = await createSupergroup({ title: 'Commons', username: 'commons' });
  const hidden = await createSupergroup({ title: 'Hidden' });
  const supergroupPath = (accountId: number, chatId: number) =>
    `${sessionPath}/accounts/${accountId}/conversations/supergroup/${chatId}`;
  const asOwner = (path: string, init: RequestInit) =>
    expectStatus(api.request(`${supergroupPath(ada.id, commons.id)}/${path}`, init), 204, path);
  await asOwner(`members/${inviterBot.bot.id}`, { method: 'PUT' });
  await asOwner(`administrators/${inviterBot.bot.id}`, jsonRequest('PUT', INVITER_RIGHTS));
  // Hopper is banned from Commons before he tries to join.
  await asOwner(`members/${hopper.id}`, { method: 'PUT' });
  await asOwner(`members/${hopper.id}`, { method: 'DELETE' });
  await readUpdates(inviterBot);
  const joinStatus = async (accountId: number, chatId: number) =>
    (await api.request(`${supergroupPath(accountId, chatId)}/members/${accountId}`, {
      method: 'PUT',
    })).status;

  expectEqual(
    [
      await joinStatus(grace.id, commons.id),
      await joinStatus(grace.id, commons.id),
      await joinStatus(grace.id, hidden.id),
      await joinStatus(hopper.id, commons.id),
      await joinStatus(grace.id, -1_009_999_999_999),
      await joinStatus(ada.id, hidden.id),
    ],
    [204, 204, 403, 403, 404, 204],
    'Expected a public supergroup to admit Grace once, the others to refuse, and the owner of a private one to stay',
  );
  expectEqual(
    describeUpdates(await readUpdates(inviterBot)),
    [`chat_member ${grace.id} by ${grace.id}: left -> member`, `joined ${grace.id} by ${grace.id}`],
    'Expected one join without an invite link',
  );
  const status = async (chatId: number, userId: number) =>
    ((await callBot(inviterBot, 'getChatMember', { chat_id: chatId, user_id: userId })).body
      .result as { status?: string } | undefined)?.status;
  expectEqual(
    [await status(commons.id, grace.id), await status(commons.id, hopper.id)],
    ['member', 'kicked'],
    'Expected Grace to be a member and Hopper to stay banned',
  );
});

/**
 * Extends the invite link fixture for link lifecycles: helpers that edit and revoke links as a
 * bot, list the owner's view of the pending join requests, and make a link's expiry date arrive.
 */
async function createInviteLinkLifecycleFixture() {
  const fixture = await createInviteLinkFixture();
  const { api, sessionPath, ada, supergroup, inviterBot, callBot, supergroupPath } = fixture;
  const editLink = (inviteLink: string, parameters: object = {}, bot = inviterBot) =>
    callBot(bot, 'editChatInviteLink', {
      chat_id: supergroup.id,
      invite_link: inviteLink,
      ...parameters,
    });
  const revokeLink = (inviteLink: string, parameters: object = {}, bot = inviterBot) =>
    callBot(bot, 'revokeChatInviteLink', {
      chat_id: supergroup.id,
      invite_link: inviteLink,
      ...parameters,
    });
  const getJoinRequests = async () =>
    (await requestJson<{ join_requests: Array<{ user_id: number; invite_link: string }> }>(
      api,
      'GET',
      `${supergroupPath(ada.id)}/join-requests`,
    )).body.join_requests.map(({ user_id, invite_link }) => [user_id, invite_link]);
  const expireLink = (inviteLink: string) =>
    requestJson<{ invite_link: Record<string, unknown> }>(
      api,
      'POST',
      `${sessionPath}/supergroups/${supergroup.id}/invite-links/${
        inviteLinkHash(inviteLink)
      }/expiry`,
    );
  /** A link as the owner inspects it. */
  const inspectLink = async (inviteLink: string) =>
    (await fixture.getInviteLinks()).body.invite_links
      .find(({ invite_link }) => invite_link === inviteLink);
  return { ...fixture, editLink, revokeLink, getJoinRequests, expireLink, inspectLink };
}

Deno.test('editChatInviteLink replaces the settings of a link, which its later uses follow', async () => {
  const {
    grace,
    hopper,
    linus,
    inviterBot,
    supergroup,
    createLink,
    joinByLink,
    editLink,
    expireLink,
    inspectLink,
    getJoinRequests,
  } = await createInviteLinkLifecycleFixture();
  const expireDate = nowUnixSeconds() + 3_600;
  const link = await createLink({ name: 'Spring', expire_date: expireDate, member_limit: 1 });
  await joinByLink(grace, link.invite_link);
  const whileFull = (await joinByLink(hopper, link.invite_link)).status;

  // The edit names no expiry date, so the link keeps none.
  const raisedLimit = await editLink(link.invite_link, { name: ' Autumn ', member_limit: 2 });
  const hopperJoining = await joinByLink(hopper, link.invite_link);

  expectEqual(
    [whileFull, raisedLimit, Object.keys(raisedLimit.body.result as object), hopperJoining],
    [
      410,
      {
        status: 200,
        body: {
          ok: true,
          result: {
            invite_link: link.invite_link,
            name: 'Autumn',
            creator: botUser(inviterBot),
            member_limit: 2,
            creates_join_request: false,
            is_primary: false,
            is_revoked: false,
          },
        },
      },
      [
        'invite_link',
        'name',
        'creator',
        'member_limit',
        'creates_join_request',
        'is_primary',
        'is_revoked',
      ],
      { status: 200, body: { chat_id: supergroup.id, outcome: 'joined' } },
    ],
    'Expected the edit to replace every setting, and the raised limit to admit Hopper',
  );

  // An expired link that an edit gives a new expiry date and join requests admits again, by request.
  await editLink(link.invite_link, { expire_date: expireDate });
  await expireLink(link.invite_link);
  const whileExpired = (await joinByLink(linus, link.invite_link)).status;
  const revival = await editLink(link.invite_link, {
    expire_date: expireDate + 60,
    creates_join_request: true,
  });
  const linusRequest = (await joinByLink(linus, link.invite_link)).body;
  const renamed = await editLink(link.invite_link, {
    name: 'Applicants',
    expire_date: expireDate + 60,
    creates_join_request: true,
  });

  expectEqual(
    [
      whileExpired,
      revival.body.result,
      linusRequest,
      renamed.body.result,
      await inspectLink(link.invite_link),
      await getJoinRequests(),
    ],
    [
      410,
      {
        invite_link: link.invite_link,
        creator: botUser(inviterBot),
        expire_date: expireDate + 60,
        creates_join_request: true,
        is_primary: false,
        is_revoked: false,
      },
      { chat_id: supergroup.id, outcome: 'join_request_sent' },
      {
        invite_link: link.invite_link,
        name: 'Applicants',
        creator: botUser(inviterBot),
        expire_date: expireDate + 60,
        pending_join_request_count: 1,
        creates_join_request: true,
        is_primary: false,
        is_revoked: false,
      },
      {
        invite_link: link.invite_link,
        name: 'Applicants',
        creator_user_id: inviterBot.bot.id,
        expire_date: expireDate + 60,
        member_count: 2,
        pending_join_request_count: 1,
        creates_join_request: true,
        is_primary: false,
        is_expired: false,
        is_revoked: false,
      },
      [[linus.id, link.invite_link]],
    ],
    'Expected the edits to revive the link for requests, as the owner then inspects it',
  );
});

Deno.test('revokeChatInviteLink ends a link for good while its members and pending requests stay', async () => {
  const {
    grace,
    hopper,
    linus,
    inviterBot,
    observerBot,
    supergroup,
    readUpdates,
    createLink,
    joinByLink,
    editLink,
    revokeLink,
    expireLink,
    inspectLink,
    getJoinRequests,
    getMemberStatus,
    callBot,
  } = await createInviteLinkLifecycleFixture();
  const expireDate = nowUnixSeconds() + 3_600;
  const directLink = await createLink({ member_limit: 3 });
  const requestLink = await createLink({ expire_date: expireDate, creates_join_request: true });
  await joinByLink(grace, directLink.invite_link);
  await joinByLink(hopper, requestLink.invite_link);
  await readUpdates(inviterBot);
  await readUpdates(observerBot);

  const revocations = [
    await revokeLink(directLink.invite_link),
    await revokeLink(requestLink.invite_link),
  ];
  const afterRevocation = [
    (await joinByLink(linus, directLink.invite_link)).status,
    (await joinByLink(linus, requestLink.invite_link)).status,
    await getMemberStatus(grace.id),
    await getJoinRequests(),
    [await revokeLink(requestLink.invite_link), await editLink(directLink.invite_link)].map((
      { status, body },
    ) => [status, body.description]),
  ];

  expectEqual(
    revocations,
    [
      {
        status: 200,
        body: {
          ok: true,
          result: {
            invite_link: directLink.invite_link,
            creator: botUser(inviterBot),
            member_limit: 3,
            creates_join_request: false,
            is_primary: false,
            is_revoked: true,
          },
        },
      },
      {
        status: 200,
        body: {
          ok: true,
          result: {
            invite_link: requestLink.invite_link,
            creator: botUser(inviterBot),
            expire_date: expireDate,
            pending_join_request_count: 1,
            creates_join_request: true,
            is_primary: false,
            is_revoked: true,
          },
        },
      },
    ],
    'Expected each revocation to answer the revoked link with its settings',
  );
  expectEqual(
    afterRevocation,
    [
      410,
      410,
      'member',
      [[hopper.id, requestLink.invite_link]],
      [[400, 'Bad Request: INVITE_HASH_EXPIRED'], [400, 'Bad Request: INVITE_HASH_EXPIRED']],
    ],
    "Expected the revoked links to admit nobody new, keeping Grace and Hopper's request",
  );

  // Time passes for a revoked link too, and an administrator still decides its request.
  const expiry = await expireLink(requestLink.invite_link);
  const approval = await callBot(inviterBot, 'approveChatJoinRequest', {
    chat_id: supergroup.id,
    user_id: hopper.id,
  });
  const describeLinkStates = async () =>
    [await inspectLink(directLink.invite_link), await inspectLink(requestLink.invite_link)].map(
      (
        link,
      ) => [
        link?.member_count,
        link?.pending_join_request_count,
        link?.is_expired,
        link?.is_revoked,
      ],
    );

  expectEqual(
    [
      expiry.status,
      approval.body.result,
      await getMemberStatus(hopper.id),
      describeUpdates(await readUpdates(inviterBot)),
      describeUpdates(await readUpdates(observerBot)),
      await describeLinkStates(),
    ],
    [
      200,
      true,
      'member',
      [
        `chat_member ${hopper.id} by ${inviterBot.bot.id}: left -> member via ${requestLink.invite_link}`,
        `joined ${hopper.id} by ${hopper.id}`,
      ],
      [
        `chat_member ${hopper.id} by ${inviterBot.bot.id}: left -> member via ${
          hiddenInviteLink(requestLink.invite_link)
        }`,
        `joined ${hopper.id} by ${hopper.id}`,
      ],
      [[1, 0, false, true], [1, 0, true, true]],
    ],
    'Expected the approval to admit Hopper through the revoked link',
  );
});

Deno.test('editChatInviteLink and revokeChatInviteLink refuse invalid calls without a change', async () => {
  const {
    api,
    sessionPath,
    ada,
    grace,
    inviterBot,
    observerBot,
    memberBot,
    supergroup,
    promote,
    createLink,
    callBot,
    getInviteLinks,
  } = await createInviteLinkFixture();
  // Grace starts a private chat with the inviter, which has no invite links.
  await expectStatus(
    api.request(
      `${sessionPath}/accounts/${grace.id}/messages`,
      jsonRequest('POST', { to: { type: 'private', botId: inviterBot.bot.id }, text: 'hi' }),
    ),
    201,
    'Expected Grace to write to the inviter',
  );
  // In Elsewhere, another supergroup of Ada's, the inviter also creates links.
  const { body: { supergroup: elsewhere } } = await requestJson<
    { supergroup: { id: number } }
  >(api, 'POST', `${sessionPath}/accounts/${ada.id}/supergroups`, { title: 'Elsewhere' });
  await expectStatus(
    api.request(
      `${sessionPath}/accounts/${ada.id}/conversations/supergroup/${elsewhere.id}/members/${inviterBot.bot.id}`,
      { method: 'PUT' },
    ),
    204,
    'Expected the inviter to join Elsewhere',
  );
  await promote(inviterBot.bot.id, INVITER_RIGHTS, elsewhere.id);
  const elsewhereLink = await createLink({ chat_id: elsewhere.id });
  const link = await createLink({ name: 'Kept', member_limit: 2 });
  // The observer becomes a second inviter, whose links are its own.
  await promote(observerBot.bot.id, INVITER_RIGHTS);
  const observerLink = await createLink({}, observerBot);
  const linksBefore = await getInviteLinks();
  const answer = async (call: Promise<{ status: number; body: BotApiResponse }>) => {
    const { status, body } = await call;
    return [status, body.description];
  };
  const edit = (parameters: object, bot = inviterBot) =>
    answer(callBot(bot, 'editChatInviteLink', parameters));
  const revoke = (parameters: object, bot = inviterBot) =>
    answer(callBot(bot, 'revokeChatInviteLink', parameters));
  const ofLink = (parameters: object = {}) => ({
    chat_id: supergroup.id,
    invite_link: link.invite_link,
    ...parameters,
  });
  const invalidEdit = [400, 'Bad Request: invalid editChatInviteLink parameters'];
  const invalidRevocation = [400, 'Bad Request: invalid revokeChatInviteLink parameters'];
  const noRights = [400, 'Bad Request: not enough rights to manage chat invite link'];
  const unavailable = [400, 'Bad Request: INVITE_HASH_EXPIRED'];
  const othersLink = [400, 'Bad Request: CHAT_ADMIN_REQUIRED'];

  expectEqual(
    [
      await edit({ invite_link: link.invite_link }),
      await edit(ofLink({ member_limit: -1 })),
      await edit(ofLink({ expire_date: 'tomorrow' })),
      await edit(ofLink({ is_revoked: true })),
      await edit(ofLink({ chat_id: -1_009_999_999_999 })),
      await edit(ofLink({ chat_id: grace.id })),
      await edit(ofLink({ name: 'bad \ud800 name' })),
      await edit(ofLink({ invite_link: `${link.invite_link}\udc00` })),
      await edit(ofLink({ member_limit: 1, creates_join_request: true }), memberBot),
      await edit(ofLink({ member_limit: 1, creates_join_request: true })),
      await edit({ chat_id: supergroup.id }),
      await edit(ofLink({ invite_link: 'https://t.me/+AAAAAAAAAAAAAAAA' })),
      await edit(ofLink({ invite_link: hiddenInviteLink(link.invite_link) })),
      await edit(ofLink({ invite_link: elsewhereLink.invite_link })),
      await edit(ofLink({ chat_id: elsewhere.id })),
      await edit(ofLink({ invite_link: observerLink.invite_link })),
      await edit(ofLink(), observerBot),
      await edit(ofLink({ expire_date: nowUnixSeconds() - 10 })),
      await edit(ofLink({ member_limit: 100_000 })),
    ],
    [
      [400, 'Bad Request: chat_id is empty'],
      invalidEdit,
      invalidEdit,
      invalidEdit,
      [400, 'Bad Request: chat not found'],
      [400, "Bad Request: can't invite members to a private chat"],
      [400, 'Bad Request: strings must be encoded in UTF-8'],
      [400, 'Bad Request: strings must be encoded in UTF-8'],
      noRights,
      [
        400,
        "Bad Request: member limit can't be specified for links requiring administrator approval",
      ],
      [400, 'Bad Request: invite link must be non-empty'],
      unavailable,
      unavailable,
      unavailable,
      unavailable,
      othersLink,
      othersLink,
      [400, 'Bad Request: EXPIRE_DATE_INVALID'],
      [400, 'Bad Request: USAGE_LIMIT_INVALID'],
    ],
    'Expected each refused edit in the order Telegram checks',
  );
  expectEqual(
    [
      await revoke({ invite_link: link.invite_link }),
      await revoke(ofLink({ name: 'Gone' })),
      await revoke(ofLink({ chat_id: grace.id })),
      await revoke(ofLink(), memberBot),
      await revoke({ chat_id: supergroup.id }),
      await revoke(ofLink({ invite_link: elsewhereLink.invite_link })),
      await revoke(ofLink({ invite_link: observerLink.invite_link })),
    ],
    [
      [400, 'Bad Request: chat_id is empty'],
      invalidRevocation,
      [400, "Bad Request: can't invite members to a private chat"],
      noRights,
      [400, 'Bad Request: invite link must be non-empty'],
      unavailable,
      othersLink,
    ],
    'Expected each refused revocation in the order Telegram checks',
  );

  // The creator loses its right to manage links, then leaves; its links stay as they were.
  await promote(inviterBot.bot.id, { can_delete_messages: true });
  const afterDemotion = [await edit(ofLink({ name: 'Renamed' })), await revoke(ofLink())];
  await callBot(inviterBot, 'leaveChat', { chat_id: supergroup.id });
  const afterLeaving = [await edit(ofLink({ name: 'Renamed' })), await revoke(ofLink())];

  expectEqual(
    [afterDemotion, afterLeaving, await getInviteLinks()],
    [
      [noRights, noRights],
      [
        [403, 'Forbidden: bot is not a member of the supergroup chat'],
        [403, 'Forbidden: bot is not a member of the supergroup chat'],
      ],
      linksBefore,
    ],
    'Expected a refused edit or revocation to leave every link as it was',
  );
});

Deno.test('a session edits and revokes only its own invite links, primary or additional', async () => {
  const first = await createInviteLinkLifecycleFixture();
  const second = await createInviteLinkLifecycleFixture();
  const link = await first.createLink({ name: 'First' });
  const primaryLink = await first.exportLink();
  const linksBefore = await first.getInviteLinks();

  // The second session's inviter, in its own supergroup, names the first session's links.
  const fromSecondSession = [
    await second.editLink(link.invite_link, { name: 'Taken' }),
    await second.revokeLink(link.invite_link),
    await second.revokeLink(primaryLink),
  ].map(({ status, body }) => [status, body.description]);
  // The first session's inviter token is unknown to the second session.
  const { status: foreignTokenStatus } = await requestJson(
    second.api,
    'POST',
    `${second.sessionPath}/bot-api/bot${first.inviterBot.token}/revokeChatInviteLink`,
    { chat_id: first.supergroup.id, invite_link: link.invite_link },
  );

  expectEqual(
    [fromSecondSession, foreignTokenStatus, await first.getInviteLinks()],
    [
      [
        [400, 'Bad Request: INVITE_HASH_EXPIRED'],
        [400, 'Bad Request: INVITE_HASH_EXPIRED'],
        [400, 'Bad Request: INVITE_HASH_EXPIRED'],
      ],
      401,
      linksBefore,
    ],
    "Expected another session's bot to find no such link, leaving it as it was",
  );
  expectEqual(
    [await first.getChatInviteLink(), await second.getChatInviteLink()],
    [primaryLink, undefined],
    "Expected getChat to show each session's bot only its own primary link",
  );
});

/** A link as the owner inspects it, briefly: the link, its creator, and its kind and state. */
function describeInspectedLink(link: Record<string, unknown>) {
  return [link.invite_link, link.creator_user_id, link.is_primary, link.is_revoked];
}

Deno.test('exportChatInviteLink replaces the primary link of the bot, whose members stay', async () => {
  const {
    grace,
    hopper,
    inviterBot,
    observerBot,
    readUpdates,
    exportLink,
    getChatInviteLink,
    joinByLink,
    getInviteLinks,
    getMemberStatus,
  } = await createInviteLinkFixture();

  const beforeExport = await getChatInviteLink();
  const firstLink = await exportLink();
  const afterFirstExport = await getChatInviteLink();
  const graceJoining = await joinByLink(grace, firstLink);
  const inviterUpdates = await readUpdates(inviterBot);
  const observerUpdates = await readUpdates(observerBot);
  const secondLink = await exportLink();
  const hopperThroughFirst = await joinByLink(hopper, firstLink);
  const hopperThroughSecond = await joinByLink(hopper, secondLink);

  expectEqual(
    [
      beforeExport,
      INVITE_LINK_PATTERN.test(firstLink),
      afterFirstExport,
      INVITE_LINK_PATTERN.test(secondLink),
      secondLink === firstLink,
    ],
    [undefined, true, firstLink, true, false],
    'Expected each export to answer a new whole link, which getChat shows from then on',
  );
  const graceChatMemberUpdate = inviterUpdates.find((update) => 'chat_member' in update)
    ?.chat_member as { invite_link?: Record<string, unknown> } | undefined;
  expectEqual(
    graceChatMemberUpdate?.invite_link,
    {
      invite_link: firstLink,
      creator: botUser(inviterBot),
      creates_join_request: false,
      is_primary: true,
      is_revoked: false,
    },
    'Expected the creator to see the whole primary link Grace joined through',
  );
  expectEqual(
    [
      describeUpdates(observerUpdates),
      [graceJoining.status, hopperThroughFirst.status, hopperThroughSecond.status],
      [await getMemberStatus(grace.id), await getMemberStatus(hopper.id)],
      [await getChatInviteLink(), await getChatInviteLink()],
      (await getInviteLinks()).body.invite_links.map((link) => [
        ...describeInspectedLink(link),
        link.member_count,
      ]),
    ],
    [
      [
        `chat_member ${grace.id} by ${grace.id}: left -> member via ${hiddenInviteLink(firstLink)}`,
        `joined ${grace.id} by ${grace.id}`,
      ],
      [200, 410, 200],
      ['member', 'member'],
      [secondLink, secondLink],
      [
        [firstLink, inviterBot.bot.id, true, true, 1],
        [secondLink, inviterBot.bot.id, true, false, 1],
      ],
    ],
    'Expected the replaced link to admit nobody new, its member to stay, and reads to keep the link',
  );
});

Deno.test('revoking the primary link answers it revoked and gives the bot a replacement', async () => {
  const {
    grace,
    hopper,
    inviterBot,
    supergroup,
    callBot,
    exportLink,
    getChatInviteLink,
    joinByLink,
    getMemberStatus,
  } = await createInviteLinkFixture();
  const revokedLink = await exportLink();
  await joinByLink(grace, revokedLink);

  const revocation = await callBot(inviterBot, 'revokeChatInviteLink', {
    chat_id: supergroup.id,
    invite_link: revokedLink,
  });
  const replacement = await getChatInviteLink();
  const repeatedRead = await getChatInviteLink();
  const hopperThroughRevoked = await joinByLink(hopper, revokedLink);
  const hopperThroughReplacement = await joinByLink(hopper, replacement ?? '');
  const repeatedRevocation = await callBot(inviterBot, 'revokeChatInviteLink', {
    chat_id: supergroup.id,
    invite_link: revokedLink,
  });

  expectEqual(
    Object.keys(revocation.body.result as object),
    ['invite_link', 'creator', 'creates_join_request', 'is_primary', 'is_revoked'],
    'Expected a primary link in the field order of the official server, without settings',
  );
  expectEqual(
    [revocation.status, revocation.body.result],
    [
      200,
      {
        invite_link: revokedLink,
        creator: botUser(inviterBot),
        creates_join_request: false,
        is_primary: true,
        is_revoked: true,
      },
    ],
    'Expected the revocation to answer the revoked primary link, not its replacement',
  );
  expectEqual(
    [
      replacement !== undefined && INVITE_LINK_PATTERN.test(replacement),
      replacement === revokedLink,
      repeatedRead === replacement,
      [hopperThroughRevoked.status, hopperThroughReplacement.status],
      [await getMemberStatus(grace.id), await getMemberStatus(hopper.id)],
      [repeatedRevocation.status, repeatedRevocation.body.description],
    ],
    [
      true,
      false,
      true,
      [410, 200],
      ['member', 'member'],
      [400, 'Bad Request: INVITE_HASH_EXPIRED'],
    ],
    'Expected getChat to keep showing one new primary link, which admits accounts in its place',
  );
});

Deno.test('each administrator bot replaces only its own primary link', async () => {
  const {
    grace,
    inviterBot,
    observerBot,
    supergroup,
    promote,
    callBot,
    createLink,
    exportLink,
    getChatInviteLink,
    joinByLink,
    getInviteLinks,
  } = await createInviteLinkFixture();
  await promote(observerBot.bot.id, INVITER_RIGHTS);
  const additionalLink = await createLink({ name: 'Extra' });
  const inviterFirst = await exportLink();
  const observerFirst = await exportLink(observerBot);

  const inviterSecond = await exportLink();
  const observerAfterInviterExport = await getChatInviteLink(observerBot);
  await callBot(observerBot, 'revokeChatInviteLink', {
    chat_id: supergroup.id,
    invite_link: observerFirst,
  });
  const observerReplacement = await getChatInviteLink(observerBot);
  const inviterAfterObserverRevocation = await getChatInviteLink();
  const crossRevocation = await callBot(inviterBot, 'revokeChatInviteLink', {
    chat_id: supergroup.id,
    invite_link: observerReplacement,
  });
  const graceThroughAdditional = await joinByLink(grace, additionalLink.invite_link);

  expectEqual(
    [
      observerAfterInviterExport,
      inviterAfterObserverRevocation,
      [crossRevocation.status, crossRevocation.body.description],
      graceThroughAdditional.status,
      (await getInviteLinks()).body.invite_links.map(describeInspectedLink),
    ],
    [
      observerFirst,
      inviterSecond,
      [400, 'Bad Request: CHAT_ADMIN_REQUIRED'],
      200,
      [
        [additionalLink.invite_link, inviterBot.bot.id, false, false],
        [inviterFirst, inviterBot.bot.id, true, true],
        [observerFirst, observerBot.bot.id, true, true],
        [inviterSecond, inviterBot.bot.id, true, false],
        [observerReplacement, observerBot.bot.id, true, false],
      ],
    ],
    "Expected each bot's rotation to leave the other's primary link and additional links working",
  );
});

Deno.test('exportChatInviteLink and primary link edits refuse invalid calls without a change', async () => {
  const {
    api,
    sessionPath,
    grace,
    inviterBot,
    observerBot,
    memberBot,
    supergroup,
    promote,
    callBot,
    exportLink,
    getChatInviteLink,
    getInviteLinks,
    getMemberCount,
  } = await createInviteLinkFixture();
  // Grace starts a private chat with the inviter, which has no invite links.
  await expectStatus(
    api.request(
      `${sessionPath}/accounts/${grace.id}/messages`,
      jsonRequest('POST', { to: { type: 'private', botId: inviterBot.bot.id }, text: 'hi' }),
    ),
    201,
    'Expected Grace to write to the inviter',
  );
  const primaryLink = await exportLink();
  const linksBefore = await getInviteLinks();
  const memberCountBefore = await getMemberCount();
  const answer = async (call: Promise<{ status: number; body: BotApiResponse }>) => {
    const { status, body } = await call;
    return [status, body.description];
  };
  const exportAs = (bot: FixtureBot, parameters: object) =>
    answer(callBot(bot, 'exportChatInviteLink', parameters));
  const editPrimary = (parameters: object) =>
    answer(callBot(inviterBot, 'editChatInviteLink', {
      chat_id: supergroup.id,
      invite_link: primaryLink,
      ...parameters,
    }));
  const noRights = [400, 'Bad Request: not enough rights to manage chat invite link'];
  const permanent = [400, 'Bad Request: CHAT_INVITE_PERMANENT'];
  const { status: expiryStatus } = await api.request(
    `${sessionPath}/supergroups/${supergroup.id}/invite-links/${
      inviteLinkHash(primaryLink)
    }/expiry`,
    { method: 'POST' },
  );

  expectEqual(
    [
      await exportAs(inviterBot, {}),
      await exportAs(inviterBot, { chat_id: supergroup.id, name: 'Main' }),
      await exportAs(inviterBot, { chat_id: -1_009_999_999_999 }),
      await exportAs(inviterBot, { chat_id: grace.id }),
      await exportAs(memberBot, { chat_id: supergroup.id }),
      await exportAs(observerBot, { chat_id: supergroup.id }),
      await editPrimary({ name: 'Main' }),
      await editPrimary({}),
      await editPrimary({ expire_date: nowUnixSeconds() - 10 }),
      // TDLib refuses this combination before Telegram's servers see the edit or the link.
      await editPrimary({ creates_join_request: true, member_limit: 1 }),
      expiryStatus,
    ],
    [
      [400, 'Bad Request: chat_id is empty'],
      [400, 'Bad Request: invalid exportChatInviteLink parameters'],
      [400, 'Bad Request: chat not found'],
      [400, "Bad Request: can't invite members to a private chat"],
      noRights,
      noRights,
      permanent,
      permanent,
      permanent,
      [
        400,
        "Bad Request: member limit can't be specified for links requiring administrator approval",
      ],
      409,
    ],
    'Expected each refused export and primary link edit, and a primary link to have no expiry',
  );
  expectEqual(
    [
      await getChatInviteLink(),
      await getChatInviteLink(observerBot),
      await getChatInviteLink(memberBot),
    ],
    [primaryLink, undefined, undefined],
    "Expected getChat to show the primary link only to its creator, never another bot's",
  );

  // The creator loses its right to manage links, regains it, then leaves.
  await promote(inviterBot.bot.id, { can_delete_messages: true });
  const afterDemotion = [
    await exportAs(inviterBot, { chat_id: supergroup.id }),
    await getChatInviteLink(),
  ];
  await promote(inviterBot.bot.id, INVITER_RIGHTS);
  const afterRepromotion = [await getChatInviteLink(), await getMemberCount()];
  await callBot(inviterBot, 'leaveChat', { chat_id: supergroup.id });
  const afterLeaving = await exportAs(inviterBot, { chat_id: supergroup.id });

  expectEqual(
    [afterDemotion, afterRepromotion, afterLeaving, await getInviteLinks()],
    [
      [noRights, undefined],
      [primaryLink, memberCountBefore],
      [403, 'Forbidden: bot is not a member of the supergroup chat'],
      linksBefore,
    ],
    'Expected getChat to hide the link without the right, and refusals to change no link',
  );
});

Deno.test('concurrent exports leave the bot exactly one primary link that is not revoked', async () => {
  const { exportLink, getChatInviteLink, getInviteLinks } = await createInviteLinkFixture();

  const exportedLinks = await Promise.all(Array.from({ length: 5 }, () => exportLink()));
  const inspectedLinks = (await getInviteLinks()).body.invite_links;
  const currentLinks = inspectedLinks
    .filter(({ is_primary, is_revoked }) => is_primary === true && is_revoked === false)
    .map(({ invite_link }) => invite_link);

  expectEqual(
    [
      new Set(exportedLinks).size,
      inspectedLinks.length,
      currentLinks.length,
      exportedLinks.includes(currentLinks[0] as string),
      await getChatInviteLink(),
    ],
    [5, 5, 1, true, currentLinks[0]],
    'Expected every export but the last to be revoked, and getChat to show the current one',
  );
});
