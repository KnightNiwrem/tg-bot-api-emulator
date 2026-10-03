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

interface FixtureBot {
  readonly token: string;
  readonly bot: { readonly id: number; readonly username: string };
  readonly botApiPath: string;
}

interface FixtureAccount {
  readonly id: number;
  readonly first_name: string;
}

/** A link as `createChatInviteLink` returns it. */
interface CreatedInviteLink {
  readonly invite_link: string;
  readonly [field: string]: unknown;
}

/** The update types every fixture bot reads. */
const READ_UPDATE_TYPES = ['message', 'chat_member', 'chat_join_request'];

/**
 * Creates a session where Ada owns the supergroup Team with four bots: the inviter, an
 * administrator with `can_invite_users` and `can_restrict_members`; the co-inviter, an
 * administrator with `can_invite_users`; the observer, an administrator without it; and a plain
 * member. Grace, Hopper and Linus are accounts outside the supergroup. The inviter has created a
 * link that creates join requests.
 */
async function createJoinRequestFixture() {
  const api = createEmulationApi({
    sessionLifecycle: createSessionLifecycleService(),
    publicOrigin: 'http://emulator.example:9000',
  });
  const sessionPath = (await api.request('/sessions', { method: 'POST' })).headers.get('Location');
  if (sessionPath === null) {
    throw new Error('Expected the created session to have a Location');
  }
  const createAccount = async (firstName: string) =>
    (await requestJson<{ account: FixtureAccount }>(
      api,
      'POST',
      `${sessionPath}/accounts`,
      { first_name: firstName },
    )).body.account;
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
  const coInviterBot = await createBot('co_inviter_bot');
  const observerBot = await createBot('observer_bot');
  const memberBot = await createBot('member_bot');

  const { body: { supergroup } } = await requestJson<{ supergroup: { id: number } }>(
    api,
    'POST',
    `${sessionPath}/accounts/${ada.id}/supergroups`,
    { title: 'Team' },
  );
  const supergroupPath = (accountId: number) =>
    `${sessionPath}/accounts/${accountId}/conversations/supergroup/${supergroup.id}`;
  const asOwner = (path: string, init: RequestInit) =>
    expectStatus(api.request(`${supergroupPath(ada.id)}/${path}`, init), 204, path);
  for (const bot of [inviterBot, coInviterBot, observerBot, memberBot]) {
    await asOwner(`members/${bot.bot.id}`, { method: 'PUT' });
  }
  await asOwner(
    `administrators/${inviterBot.bot.id}`,
    jsonRequest('PUT', { can_invite_users: true, can_restrict_members: true }),
  );
  await asOwner(
    `administrators/${coInviterBot.bot.id}`,
    jsonRequest('PUT', { can_invite_users: true }),
  );
  await asOwner(
    `administrators/${observerBot.bot.id}`,
    jsonRequest('PUT', { can_delete_messages: true }),
  );

  const readUpdates = createUpdateReader(api);
  for (const bot of [inviterBot, coInviterBot, observerBot, memberBot]) {
    await readUpdates(bot);
  }
  const callBot = async (bot: FixtureBot, method: string, parameters: object) =>
    await requestJson<BotApiResponse>(api, 'POST', `${bot.botApiPath}/${method}`, parameters);
  const createLink = async (parameters: object) => {
    const { status, body } = await callBot(inviterBot, 'createChatInviteLink', {
      chat_id: supergroup.id,
      ...parameters,
    });
    if (status !== 200) {
      throw new Error(`Expected the link to be created: ${body.description}`);
    }
    return body.result as CreatedInviteLink;
  };
  const requestLink = await createLink({ name: 'Applicants', creates_join_request: true });
  const useLink = (account: FixtureAccount, inviteLink: string) =>
    requestJson<{ chat_id: number; outcome: string }>(
      api,
      'POST',
      `${sessionPath}/accounts/${account.id}/chat-joins`,
      { invite_link: inviteLink },
    );
  const getJoinRequests = async () =>
    (await requestJson<{ join_requests: Array<{ user_id: number; invite_link: string }> }>(
      api,
      'GET',
      `${supergroupPath(ada.id)}/join-requests`,
    )).body.join_requests.map(({ user_id, invite_link }) => [user_id, invite_link]);
  const getPendingCounts = async () =>
    (await requestJson<{ invite_links: Array<{ pending_join_request_count: number }> }>(
      api,
      'GET',
      `${supergroupPath(ada.id)}/invite-links`,
    )).body.invite_links.map(({ pending_join_request_count }) => pending_join_request_count);
  const getMemberStatus = async (userId: number) =>
    ((await callBot(inviterBot, 'getChatMember', { chat_id: supergroup.id, user_id: userId }))
      .body.result as { status: string }).status;

  return {
    api,
    sessionPath,
    ada,
    grace,
    hopper,
    linus,
    inviterBot,
    coInviterBot,
    observerBot,
    memberBot,
    supergroup,
    supergroupPath,
    asOwner,
    readUpdates,
    callBot,
    createLink,
    requestLink,
    useLink,
    getJoinRequests,
    getPendingCounts,
    getMemberStatus,
  };
}

/** Returns a reader of each bot's updates since the reader last read that bot's. */
function createUpdateReader(api: EmulationApi) {
  const nextOffsetsByBotApiPath = new Map<string, number>();
  return async (
    bot: FixtureBot,
    allowedUpdates = READ_UPDATE_TYPES,
  ): Promise<Array<Record<string, unknown>>> => {
    const { body } = await requestJson<{ result: Array<Record<string, unknown>> }>(
      api,
      'POST',
      `${bot.botApiPath}/getUpdates`,
      { offset: nextOffsetsByBotApiPath.get(bot.botApiPath) ?? 0, allowed_updates: allowedUpdates },
    );
    const lastUpdateId = body.result.at(-1)?.update_id;
    if (typeof lastUpdateId === 'number') {
      nextOffsetsByBotApiPath.set(bot.botApiPath, lastUpdateId + 1);
    }
    return body.result.map(({ update_id: _updateId, ...update }) => update);
  };
}

/** Describes join requests briefly, as `request user via link (pending count)`. */
function describeJoinRequests(updates: ReadonlyArray<Record<string, unknown>>): string[] {
  return updates.map((update) => {
    const request = update.chat_join_request as
      | {
        from: { id: number };
        invite_link: { invite_link: string; pending_join_request_count?: number };
      }
      | undefined;
    return request === undefined
      ? JSON.stringify(update)
      : `request ${request.from.id} via ${request.invite_link.invite_link} (${request.invite_link.pending_join_request_count})`;
  });
}

/** The link as an administrator other than its creator sees it, with half its hash hidden. */
function hiddenInviteLink(inviteLink: string): string {
  return `https://t.me/+${inviteLink.slice('https://t.me/+'.length).slice(0, 8)}...`;
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

Deno.test('a request link leaves the account outside and sends its request to eligible bots', async () => {
  const {
    api,
    grace,
    hopper,
    inviterBot,
    coInviterBot,
    observerBot,
    memberBot,
    supergroup,
    supergroupPath,
    readUpdates,
    callBot,
    requestLink,
    useLink,
    getJoinRequests,
    getPendingCounts,
    getMemberStatus,
  } = await createJoinRequestFixture();
  // The co-inviter's subscription leaves join requests out.
  await readUpdates(coInviterBot, ['message']);
  const memberCount = async () =>
    (await callBot(inviterBot, 'getChatMemberCount', { chat_id: supergroup.id })).body.result;
  const memberCountBefore = await memberCount();

  const graceRequest = await useLink(grace, requestLink.invite_link);
  const inviterUpdates = await readUpdates(inviterBot);
  const hopperRequest = await useLink(hopper, requestLink.invite_link);

  expectEqual(
    [graceRequest, hopperRequest.body],
    [
      { status: 200, body: { chat_id: supergroup.id, outcome: 'join_request_sent' } },
      { chat_id: supergroup.id, outcome: 'join_request_sent' },
    ],
    'Expected each account to send a request',
  );
  expectEqual(
    [
      await getMemberStatus(grace.id),
      await memberCount(),
      (await api.request(`${supergroupPath(grace.id)}/messages`)).status,
    ],
    ['left', memberCountBefore, 403],
    'Expected Grace to stay outside the supergroup',
  );
  const request = inviterUpdates[0]?.chat_join_request as Record<string, unknown>;
  expectEqual(
    Object.keys(request),
    ['chat', 'from', 'user_chat_id', 'date', 'invite_link'],
    "Expected the fields in the official server's order",
  );
  expectEqual(
    request,
    {
      chat: { id: supergroup.id, title: 'Team', type: 'supergroup' },
      from: { id: grace.id, is_bot: false, first_name: 'Grace' },
      user_chat_id: grace.id,
      date: request.date,
      invite_link: { ...requestLink, pending_join_request_count: 1 },
    },
    "Expected the creator to receive Grace's request with the whole link",
  );
  expectEqual(
    describeJoinRequests(await readUpdates(inviterBot)),
    [`request ${hopper.id} via ${requestLink.invite_link} (2)`],
    'Expected the count to include every pending request',
  );
  expectEqual(
    [
      await readUpdates(observerBot),
      await readUpdates(memberBot),
      await readUpdates(coInviterBot, ['message']),
    ],
    [[], [], []],
    'Expected bots without the right, or without the subscription, to receive nothing',
  );
  expectEqual(
    [await getJoinRequests(), await getPendingCounts()],
    [[[grace.id, requestLink.invite_link], [hopper.id, requestLink.invite_link]], [2]],
    'Expected the owner to see both pending requests',
  );
});

Deno.test('another administrator with the right receives requests with the link hidden', async () => {
  const { grace, coInviterBot, readUpdates, requestLink, useLink } =
    await createJoinRequestFixture();

  await useLink(grace, requestLink.invite_link);

  expectEqual(
    describeJoinRequests(await readUpdates(coInviterBot)),
    [`request ${grace.id} via ${hiddenInviteLink(requestLink.invite_link)} (1)`],
    'Expected the co-inviter to see the link with half its hash hidden',
  );
});

Deno.test('a request link has an explicit outcome for each standing and repeated use', async () => {
  const {
    api,
    sessionPath,
    grace,
    hopper,
    linus,
    inviterBot,
    supergroup,
    asOwner,
    readUpdates,
    createLink,
    requestLink,
    useLink,
    getJoinRequests,
  } = await createJoinRequestFixture();
  const otherRequestLink = await createLink({
    creates_join_request: true,
    expire_date: 2 ** 31 - 1,
  });
  // Hopper is a member, and Linus is banned.
  await asOwner(`members/${hopper.id}`, { method: 'PUT' });
  await asOwner(`members/${linus.id}`, { method: 'PUT' });
  await asOwner(`members/${linus.id}`, { method: 'DELETE' });
  await useLink(grace, requestLink.invite_link);
  await readUpdates(inviterBot);
  const requestsBefore = await getJoinRequests();

  expectEqual(
    [
      (await useLink(grace, requestLink.invite_link)).status,
      (await useLink(grace, otherRequestLink.invite_link)).status,
      (await useLink(hopper, requestLink.invite_link)).status,
      (await useLink(linus, requestLink.invite_link)).status,
    ],
    [409, 409, 409, 403],
    'Expected a pending request, a member and a banned user to be refused',
  );
  expectEqual(
    [await getJoinRequests(), await readUpdates(inviterBot)],
    [requestsBefore, []],
    'Expected the refusals to change nothing and send no update',
  );

  // An expired request link is refused before the pending request is looked at.
  await expectStatus(
    api.request(
      `${sessionPath}/supergroups/${supergroup.id}/invite-links/${
        otherRequestLink.invite_link.slice('https://t.me/+'.length)
      }/expiry`,
      { method: 'POST' },
    ),
    200,
    'Expected the other link to expire',
  );
  expectEqual(
    [(await useLink(grace, otherRequestLink.invite_link)).status, await getJoinRequests()],
    [410, requestsBefore],
    'Expected an expired link to send no request',
  );
});

Deno.test('a pending request ends when its account joins another way or is banned', async () => {
  const {
    grace,
    hopper,
    linus,
    inviterBot,
    supergroup,
    asOwner,
    callBot,
    readUpdates,
    requestLink,
    useLink,
    getJoinRequests,
    getPendingCounts,
  } = await createJoinRequestFixture();
  for (const account of [grace, hopper, linus]) {
    await useLink(account, requestLink.invite_link);
  }
  await readUpdates(inviterBot);

  // The owner adds Grace, the inviter bans Hopper, and the owner restricts Linus.
  await asOwner(`members/${grace.id}`, { method: 'PUT' });
  await callBot(inviterBot, 'banChatMember', { chat_id: supergroup.id, user_id: hopper.id });
  await asOwner(
    `restrictions/${linus.id}`,
    jsonRequest('PUT', { permissions: { can_send_messages: true } }),
  );

  expectEqual(
    [await getJoinRequests(), await getPendingCounts()],
    [[[linus.id, requestLink.invite_link]], [1]],
    "Expected only Linus's request to remain, as a restriction still lets him join",
  );
  expectEqual(
    (await useLink(hopper, requestLink.invite_link)).status,
    403,
    'Expected banned Hopper to send no new request',
  );
});

Deno.test('a bot cannot write to a requester that never started it before a decision', async () => {
  const { grace, inviterBot, readUpdates, callBot, requestLink, useLink } =
    await createJoinRequestFixture();
  await useLink(grace, requestLink.invite_link);
  const [update] = await readUpdates(inviterBot);
  const userChatId = (update?.chat_join_request as { user_chat_id: number }).user_chat_id;

  const reply = await callBot(inviterBot, 'sendMessage', { chat_id: userChatId, text: 'Hello' });

  expectEqual(
    [userChatId, reply.status, reply.body.description],
    [grace.id, 400, 'Bad Request: chat not found'],
    "Expected user_chat_id to name Grace's private chat, which the emulator does not open",
  );
});

Deno.test('a grammY bot receives a join request through its webhook, as the log shows', async () => {
  const { api, sessionPath, grace, inviterBot, supergroup, requestLink, useLink } =
    await createJoinRequestFixture();
  const grammyBot = new Bot(inviterBot.token, {
    client: {
      apiRoot: `http://emulator.example:9000${sessionPath}/bot-api`,
      fetch: async (input, init) => await api.fetch(new Request(input, init)),
    },
  });
  const requestObserved = Promise.withResolvers<Record<string, unknown>>();
  grammyBot.on('chat_join_request', (context) => {
    requestObserved.resolve(context.chatJoinRequest as unknown as Record<string, unknown>);
  });
  const handleWebhookRequest = webhookCallback(grammyBot, 'std/http');
  const webhookServer = Deno.serve(
    { hostname: '127.0.0.1', port: 0, onListen: () => {} },
    (request) => handleWebhookRequest(request),
  );
  try {
    await grammyBot.api.setWebhook(`http://127.0.0.1:${webhookServer.addr.port}/webhook`, {
      allowed_updates: ['chat_join_request'],
    });
    await useLink(grace, requestLink.invite_link);
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const observed = await Promise.race([
      requestObserved.promise,
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(
          () => reject(new Error('Expected the bot to receive the join request')),
          5_000,
        );
      }),
    ]).finally(() => clearTimeout(timeoutId));
    const activity = await requestJson<{ entries: Array<Record<string, unknown>> }>(
      api,
      'GET',
      `${sessionPath}/bot-activity?kind=update_delivered&bot_id=${inviterBot.bot.id}`,
    );

    expectEqual(
      [
        (observed.chat as { id: number }).id,
        (observed.from as { id: number }).id,
        observed.user_chat_id,
        (observed.invite_link as { invite_link: string }).invite_link,
      ],
      [supergroup.id, grace.id, grace.id, requestLink.invite_link],
      'Expected the webhook to carry the requester, chat and link',
    );
    expectEqual(
      activity.body.entries
        .filter(({ update }) => 'chat_join_request' in (update as object))
        .map(({ via, chat_id, user_id }) => [via, chat_id, user_id]),
      [['webhook', supergroup.id, grace.id]],
      'Expected the activity log to record the delivery in the chat, from Grace',
    );
  } finally {
    await api.request(sessionPath, { method: 'DELETE' });
    await webhookServer.shutdown();
  }
});
