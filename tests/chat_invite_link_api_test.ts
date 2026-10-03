import { createEmulationApi } from '../src/api/mod.ts';
import { createSessionLifecycleService } from '../src/composition/session_lifecycle.ts';

type EmulationApi = ReturnType<typeof createEmulationApi>;

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
  const api = createEmulationApi({
    sessionLifecycle: createSessionLifecycleService(),
    publicOrigin: 'http://emulator.example:9000',
  });
  const sessionPath = await createSession(api);
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
    joinByLink,
    getInviteLinks,
    getMemberStatus,
    getMemberCount,
  };
}

async function createSession(api: EmulationApi): Promise<string> {
  const sessionPath = (await api.request('/sessions', { method: 'POST' })).headers.get('Location');
  if (sessionPath === null) {
    throw new Error('Expected the created session to have a Location');
  }
  return sessionPath;
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
            creates_join_request: false,
            is_expired: false,
          },
          {
            invite_link: plainLink.invite_link,
            creator_user_id: inviterBot.bot.id,
            member_count: 0,
            creates_join_request: false,
            is_expired: false,
          },
          {
            invite_link: longNamedLink.invite_link,
            name: 'x'.repeat(32),
            creator_user_id: inviterBot.bot.id,
            member_count: 0,
            creates_join_request: true,
            is_expired: false,
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
          creates_join_request: false,
          is_expired: true,
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

Deno.test('a link that creates join requests admits nobody directly', async () => {
  const { grace, createLink, joinByLink, getMemberStatus } = await createInviteLinkFixture();
  const link = await createLink({ creates_join_request: true });

  expectEqual(
    [(await joinByLink(grace, link.invite_link)).status, await getMemberStatus(grace.id)],
    [501, 'left'],
    'Expected join requests to be unsupported, leaving Grace outside',
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
