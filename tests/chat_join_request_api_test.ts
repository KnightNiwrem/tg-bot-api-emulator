import { Bot } from 'https://cdn.jsdelivr.net/gh/grammyjs/grammY@^1.46.0/src/bot.ts';
import { webhookCallback } from 'https://cdn.jsdelivr.net/gh/grammyjs/grammY@^1.46.0/src/convenience/webhook.ts';
import {
  createTestSession,
  type EmulationApi,
  requestJson,
  TEST_PUBLIC_ORIGIN,
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
  const { api, sessionPath } = await createTestSession();
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
  /** Each pending request as `[user, contact status, bots that may contact the user]`. */
  const getRequesterContacts = async () =>
    (await requestJson<
      {
        join_requests: Array<
          { user_id: number; requester_contact: { status: string; bot_ids: number[] } }
        >;
      }
    >(api, 'GET', `${supergroupPath(ada.id)}/join-requests`)).body.join_requests.map((
      { user_id, requester_contact },
    ) => [user_id, requester_contact.status, requester_contact.bot_ids]);
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
    getRequesterContacts,
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
    ada,
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
  const { body: { join_requests: [storedRequest] } } = await requestJson<
    { join_requests: Array<{ user_id: number; date: number }> }
  >(api, 'GET', `${supergroupPath(ada.id)}/join-requests`);
  expectEqual(
    Object.keys(request),
    ['chat', 'from', 'user_chat_id', 'date', 'invite_link'],
    "Expected the fields in the official server's order",
  );
  expectEqual(
    typeof storedRequest?.date === 'number' && storedRequest.date > 1_700_000_000,
    true,
    'Expected the request to be dated when it was sent',
  );
  expectEqual(
    request,
    {
      chat: { id: supergroup.id, title: 'Team', type: 'supergroup' },
      from: { id: grace.id, is_bot: false, first_name: 'Grace' },
      user_chat_id: grace.id,
      date: storedRequest?.date,
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

Deno.test('a bot that received a request prompts its requester, who answers before the decision', async () => {
  const {
    api,
    sessionPath,
    grace,
    inviterBot,
    coInviterBot,
    readUpdates,
    callBot,
    requestLink,
    useLink,
    getRequesterContacts,
  } = await createJoinRequestFixture();
  await useLink(grace, requestLink.invite_link);
  const [update] = await readUpdates(inviterBot, [...READ_UPDATE_TYPES, 'callback_query']);
  await readUpdates(coInviterBot);
  const userChatId = (update?.chat_join_request as { user_chat_id: number }).user_chat_id;
  const contactsBefore = await getRequesterContacts();

  const prompt = await callBot(inviterBot, 'sendMessage', {
    chat_id: userChatId,
    text: 'Press the button to join',
    reply_markup: { inline_keyboard: [[{ text: 'I am human', callback_data: 'human' }]] },
  });
  const competingPrompt = await callBot(coInviterBot, 'sendMessage', {
    chat_id: userChatId,
    text: 'Welcome!',
  });

  const promptMessageId = (prompt.body.result as { message_id: number }).message_id;
  expectEqual(
    [
      contactsBefore,
      [prompt.status, (prompt.body.result as { chat: { id: number } }).chat.id],
      [competingPrompt.status, competingPrompt.body.description],
      await getRequesterContacts(),
      await readUpdates(coInviterBot),
    ],
    [
      [[grace.id, 'open', [inviterBot.bot.id, coInviterBot.bot.id]]],
      [200, grace.id],
      [400, 'Bad Request: chat not found'],
      [[grace.id, 'claimed', [inviterBot.bot.id]]],
      [],
    ],
    'Expected the first bot to write to claim the contact, refusing the other administrator',
  );

  // Grace sees the prompt, presses its button, and answers in the chat.
  const privatePath =
    `${sessionPath}/accounts/${grace.id}/conversations/private/${inviterBot.bot.id}`;
  const history = await requestJson<{ messages: Array<{ message_id: number; text?: string }> }>(
    api,
    'GET',
    `${privatePath}/messages`,
  );
  const press = await requestJson<{ callback_query: { callback_data: string } }>(
    api,
    'POST',
    `${sessionPath}/accounts/${grace.id}/callback-queries`,
    {
      chat: { type: 'private', botId: inviterBot.bot.id },
      message_id: promptMessageId,
      callback_data: 'human',
    },
  );
  const answer = await requestJson<{ message: { text: string } }>(
    api,
    'POST',
    `${sessionPath}/accounts/${grace.id}/messages`,
    { to: { type: 'private', botId: inviterBot.bot.id }, text: 'Done' },
  );
  const updates = await readUpdates(inviterBot, [...READ_UPDATE_TYPES, 'callback_query']);

  expectEqual(
    [
      history.body.messages.map(({ message_id, text }) => [message_id, text]),
      press.status,
      answer.status,
      updates.map((received) =>
        received.callback_query === undefined
          ? (received.message as { text: string }).text
          : (received.callback_query as { data: string }).data
      ),
    ],
    [[[promptMessageId, 'Press the button to join']], 201, 201, ['human', 'Done']],
    'Expected Grace to see the prompt, and the bot to receive her press and answer',
  );

  // The decision ends the grant, but Grace's answer started the chat, which stays open.
  await callBot(inviterBot, 'approveChatJoinRequest', {
    chat_id: (update?.chat_join_request as { chat: { id: number } }).chat.id,
    user_id: grace.id,
  });
  const welcome = await callBot(inviterBot, 'sendMessage', { chat_id: grace.id, text: 'Welcome' });
  const competingWelcome = await callBot(coInviterBot, 'sendMessage', {
    chat_id: grace.id,
    text: 'Welcome',
  });

  expectEqual(
    [welcome.status, [competingWelcome.status, competingWelcome.body.description]],
    [200, [400, 'Bad Request: chat not found']],
    "Expected Grace's answer, not the prompt, to let the bot keep writing after the decision",
  );
});

Deno.test('the prompt alone gives no lasting access, which a decision or an expiry ends', async () => {
  const {
    api,
    sessionPath,
    grace,
    hopper,
    linus,
    inviterBot,
    coInviterBot,
    supergroup,
    readUpdates,
    callBot,
    requestLink,
    useLink,
    getRequesterContacts,
    getJoinRequests,
  } = await createJoinRequestFixture();
  for (const account of [grace, hopper, linus]) {
    await useLink(account, requestLink.invite_link);
  }
  await readUpdates(inviterBot);
  const prompt = (account: FixtureAccount) =>
    callBot(inviterBot, 'sendMessage', { chat_id: account.id, text: 'Solve 2 + 2' });
  const contactExpiryPath = (chatId: number | string, userId: number | string) =>
    `${sessionPath}/supergroups/${chatId}/join-requests/${userId}/requester-contact/expiry`;
  const gracePrompt = await prompt(grace);
  await prompt(hopper);

  await callBot(inviterBot, 'approveChatJoinRequest', {
    chat_id: supergroup.id,
    user_id: grace.id,
  });
  await callBot(coInviterBot, 'declineChatJoinRequest', {
    chat_id: supergroup.id,
    user_id: hopper.id,
  });
  const expiry = await requestJson<{ join_request: Record<string, unknown> }>(
    api,
    'POST',
    contactExpiryPath(supergroup.id, linus.id),
  );
  const graceMessageId = (gracePrompt.body.result as { message_id: number }).message_id;
  const describe = async (response: Promise<{ status: number; body: BotApiResponse }>) => {
    const { status, body } = await response;
    return status === 200 ? status : `${status} ${body.description}`;
  };

  expectEqual(
    [
      expiry.status,
      expiry.body.join_request,
      await getRequesterContacts(),
      await getJoinRequests(),
      await describe(prompt(grace)),
      await describe(prompt(hopper)),
      await describe(prompt(linus)),
      await describe(callBot(inviterBot, 'getChat', { chat_id: grace.id })),
      await describe(callBot(inviterBot, 'editMessageText', {
        chat_id: grace.id,
        message_id: graceMessageId,
        text: 'Solved',
      })),
      (await readUpdates(inviterBot)).filter(({ message }) =>
        (message as { chat: { type: string } } | undefined)?.chat.type === 'private'
      ),
    ],
    [
      200,
      {
        user_id: linus.id,
        invite_link: requestLink.invite_link,
        date: expiry.body.join_request.date,
        requester_contact: { status: 'expired', bot_ids: [] },
      },
      [[linus.id, 'expired', []]],
      [[linus.id, requestLink.invite_link]],
      '400 Bad Request: chat not found',
      '400 Bad Request: chat not found',
      '400 Bad Request: chat not found',
      '400 Bad Request: chat not found',
      '400 Bad Request: chat not found',
      [],
    ],
    "Expected the decisions and the expiry to end the grants, leaving Linus's request pending",
  );

  // Ending a window again, or one of no pending request, is refused without a change.
  expectEqual(
    await Promise.all(
      [
        contactExpiryPath(supergroup.id, linus.id),
        contactExpiryPath(supergroup.id, grace.id),
        contactExpiryPath(-1_009_999_999_999, linus.id),
        contactExpiryPath(supergroup.id, 'linus'),
        contactExpiryPath('team', linus.id),
      ].map(async (path) => (await api.request(path, { method: 'POST' })).status),
    ),
    [409, 404, 404, 400, 400],
    'Expected repeated, unknown and malformed expiries to be refused',
  );
});

Deno.test('a requester contact excludes unrelated bots, blocked bots and other sessions', async () => {
  const {
    api,
    sessionPath,
    grace,
    inviterBot,
    coInviterBot,
    observerBot,
    memberBot,
    asOwner,
    readUpdates,
    callBot,
    requestLink,
    useLink,
    getRequesterContacts,
  } = await createJoinRequestFixture();
  await useLink(grace, requestLink.invite_link);
  // The member bot gains the right only after the request, which it never received.
  await asOwner(
    `administrators/${memberBot.bot.id}`,
    jsonRequest('PUT', { can_invite_users: true }),
  );
  await requestJson(
    api,
    'PUT',
    `${sessionPath}/accounts/${grace.id}/blocked-bots/${coInviterBot.bot.id}`,
  );
  const otherSession = await createJoinRequestFixture();
  await readUpdates(inviterBot);
  const describeSend = async (bot: FixtureBot, chatId: number, call = callBot) => {
    const { status, body } = await call(bot, 'sendMessage', { chat_id: chatId, text: 'Hello' });
    return `${status} ${body.description ?? ''}`.trim();
  };

  expectEqual(
    [
      await describeSend(observerBot, grace.id),
      await describeSend(memberBot, grace.id),
      await describeSend(coInviterBot, grace.id),
      await describeSend(otherSession.inviterBot, otherSession.grace.id, otherSession.callBot),
      await getRequesterContacts(),
      (await requestJson<{ messages: unknown[] }>(
        api,
        'GET',
        `${sessionPath}/accounts/${grace.id}/conversations/private/${coInviterBot.bot.id}/messages`,
      )).body.messages,
      await readUpdates(inviterBot),
    ],
    [
      '400 Bad Request: chat not found',
      '400 Bad Request: chat not found',
      '403 Forbidden: bot was blocked by the user',
      '400 Bad Request: chat not found',
      [[grace.id, 'open', [inviterBot.bot.id, coInviterBot.bot.id]]],
      [],
      [],
    ],
    'Expected refusals that store nothing, leave the contact open, and leak into no other session',
  );
});

Deno.test('competing and repeated contacts keep each grant to its bot and request', async () => {
  const {
    api,
    sessionPath,
    grace,
    inviterBot,
    coInviterBot,
    supergroup,
    readUpdates,
    callBot,
    requestLink,
    useLink,
    getRequesterContacts,
  } = await createJoinRequestFixture();
  // Grace started the co-inviter before requesting, so it writes to her as before.
  await requestJson(api, 'POST', `${sessionPath}/accounts/${grace.id}/messages`, {
    to: { type: 'private', botId: coInviterBot.bot.id },
    text: '/start',
  });
  await useLink(grace, requestLink.invite_link);
  const repeatedRequest = await useLink(grace, requestLink.invite_link);
  await readUpdates(inviterBot);
  const ordinaryMessage = await callBot(coInviterBot, 'sendMessage', {
    chat_id: grace.id,
    text: 'Hello again',
  });
  const contactsAfterOrdinaryMessage = await getRequesterContacts();

  const prompt = await callBot(inviterBot, 'sendMessage', { chat_id: grace.id, text: 'Prove it' });
  const contactsAfterPrompt = await getRequesterContacts();
  await callBot(coInviterBot, 'declineChatJoinRequest', {
    chat_id: supergroup.id,
    user_id: grace.id,
  });
  const afterDecline = await Promise.all(
    [inviterBot, coInviterBot].map(async (bot) =>
      (await callBot(bot, 'sendMessage', { chat_id: grace.id, text: 'Still there?' })).status
    ),
  );
  await useLink(grace, requestLink.invite_link);

  expectEqual(
    [
      repeatedRequest.status,
      ordinaryMessage.status,
      contactsAfterOrdinaryMessage,
      prompt.status,
      contactsAfterPrompt,
      afterDecline,
      await getRequesterContacts(),
    ],
    [
      409,
      200,
      [[grace.id, 'open', [inviterBot.bot.id, coInviterBot.bot.id]]],
      200,
      [[grace.id, 'claimed', [inviterBot.bot.id]]],
      [400, 200],
      [[grace.id, 'open', [inviterBot.bot.id, coInviterBot.bot.id]]],
    ],
    'Expected the started chat to stay ordinary and a new request to open a fresh contact',
  );
});

Deno.test('simultaneous prompts of two bots let exactly one claim the contact', async () => {
  const {
    api,
    sessionPath,
    hopper,
    inviterBot,
    coInviterBot,
    callBot,
    requestLink,
    useLink,
    getRequesterContacts,
  } = await createJoinRequestFixture();
  await useLink(hopper, requestLink.invite_link);

  const prompts = await Promise.all(
    [inviterBot, coInviterBot].map(async (bot) => ({
      bot,
      response: await callBot(bot, 'sendMessage', { chat_id: hopper.id, text: 'Prove it' }),
    })),
  );
  const [claimant] = prompts.filter(({ response }) => response.status === 200);
  const historyLengths = await Promise.all(
    [inviterBot, coInviterBot].map(async (bot) =>
      (await requestJson<{ messages: unknown[] }>(
        api,
        'GET',
        `${sessionPath}/accounts/${hopper.id}/conversations/private/${bot.bot.id}/messages`,
      )).body.messages.length
    ),
  );

  expectEqual(
    [
      prompts.map(({ response }) => response.status).sort(),
      await getRequesterContacts(),
      historyLengths.reduce((total, length) => total + length, 0),
    ],
    [[200, 400], [[hopper.id, 'claimed', [claimant?.bot.bot.id]]], 1],
    'Expected one prompt to be stored and claim the contact, and the other to be refused',
  );
});

Deno.test("a link's expiry leaves its pending requests and their contacts in place", async () => {
  const {
    api,
    sessionPath,
    grace,
    inviterBot,
    supergroup,
    readUpdates,
    callBot,
    createLink,
    useLink,
    getRequesterContacts,
  } = await createJoinRequestFixture();
  const expiringLink = await createLink({
    creates_join_request: true,
    expire_date: Math.floor(Date.now() / 1_000) + 3_600,
  });
  await useLink(grace, expiringLink.invite_link);
  await readUpdates(inviterBot);

  await expectStatus(
    api.request(
      `${sessionPath}/supergroups/${supergroup.id}/invite-links/${
        expiringLink.invite_link.slice('https://t.me/+'.length)
      }/expiry`,
      { method: 'POST' },
    ),
    200,
    'Expected the link to expire',
  );
  const prompt = await callBot(inviterBot, 'sendMessage', { chat_id: grace.id, text: 'Hi' });

  expectEqual(
    [prompt.status, await getRequesterContacts()],
    [200, [[grace.id, 'claimed', [inviterBot.bot.id]]]],
    "Expected the link's expiry to cancel neither Grace's request nor the bots' contact",
  );
});

Deno.test('a grammY bot receives a join request through its webhook, as the log shows', async () => {
  const { api, sessionPath, grace, inviterBot, supergroup, requestLink, useLink } =
    await createJoinRequestFixture();
  const grammyBot = new Bot(inviterBot.token, {
    client: {
      apiRoot: `${TEST_PUBLIC_ORIGIN}${sessionPath}/bot-api`,
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

/** Describes membership updates and service messages briefly, as `kind user by actor: change`. */
function describeMembershipUpdates(updates: ReadonlyArray<Record<string, unknown>>): string[] {
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
      return `chat_member ${chatMember.old_chat_member.user.id} by ${chatMember.from.id}: ${chatMember.old_chat_member.status} -> ${chatMember.new_chat_member.status} via ${chatMember.invite_link?.invite_link}`;
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

Deno.test('a bot approves a request, which lets the account in through the link', async () => {
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
  await useLink(grace, requestLink.invite_link);
  await useLink(hopper, requestLink.invite_link);
  for (const bot of [inviterBot, coInviterBot, observerBot, memberBot]) {
    await readUpdates(bot);
  }
  const memberCount = async () =>
    (await callBot(inviterBot, 'getChatMemberCount', { chat_id: supergroup.id })).body.result;
  const memberCountBefore = await memberCount() as number;

  // The co-inviter, which did not create the link, approves Grace's request.
  const approval = await callBot(coInviterBot, 'approveChatJoinRequest', {
    chat_id: supergroup.id,
    user_id: grace.id,
  });

  expectEqual(
    [approval.status, approval.body.result],
    [200, true],
    'Expected an administrator with can_invite_users to approve a request it did not receive first',
  );
  expectEqual(
    [
      await getMemberStatus(grace.id),
      await memberCount(),
      await getJoinRequests(),
      await getPendingCounts(),
    ],
    ['member', memberCountBefore + 1, [[hopper.id, requestLink.invite_link]], [1]],
    "Expected Grace to join and her request to disappear, leaving Hopper's",
  );
  const inviterUpdates = await readUpdates(inviterBot);
  expectEqual(
    describeMembershipUpdates(inviterUpdates),
    [
      `chat_member ${grace.id} by ${coInviterBot.bot.id}: left -> member via ${requestLink.invite_link}`,
      `joined ${grace.id} by ${grace.id}`,
    ],
    "Expected the approval from the co-inviter, with the link, and Grace's own service message",
  );
  expectEqual(
    (inviterUpdates[0]?.chat_member as { invite_link: unknown }).invite_link,
    { ...requestLink, pending_join_request_count: 1 },
    'Expected the creator to see the whole link with the request still pending',
  );
  expectEqual(
    [
      describeMembershipUpdates(await readUpdates(observerBot)),
      describeMembershipUpdates(await readUpdates(memberBot)),
    ],
    [
      [
        `chat_member ${grace.id} by ${coInviterBot.bot.id}: left -> member via ${
          hiddenInviteLink(requestLink.invite_link)
        }`,
        `joined ${grace.id} by ${grace.id}`,
      ],
      [`joined ${grace.id} by ${grace.id}`],
    ],
    'Expected other administrators to see the hidden link, and other bots only the service message',
  );
  const { body: { messages } } = await requestJson<
    { messages: Array<{ from: { id: number }; new_chat_members?: Array<{ id: number }> }> }
  >(api, 'GET', `${supergroupPath(grace.id)}/messages`);
  expectEqual(
    [messages.at(-1)?.from.id, messages.at(-1)?.new_chat_members?.map(({ id }) => id)],
    [grace.id, [grace.id]],
    "Expected Grace's history to end with her joining",
  );
});

Deno.test('a bot declines a request, which leaves the account outside without an update', async () => {
  const {
    api,
    grace,
    inviterBot,
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
  await useLink(grace, requestLink.invite_link);
  for (const bot of [inviterBot, observerBot, memberBot]) {
    await readUpdates(bot);
  }

  const decline = await callBot(inviterBot, 'declineChatJoinRequest', {
    chat_id: supergroup.id,
    user_id: grace.id,
  });

  expectEqual(
    [
      [decline.status, decline.body.result],
      await getMemberStatus(grace.id),
      await getJoinRequests(),
      await getPendingCounts(),
      (await api.request(`${supergroupPath(grace.id)}/messages`)).status,
      await readUpdates(inviterBot),
      await readUpdates(observerBot),
      await readUpdates(memberBot),
    ],
    [[200, true], 'left', [], [0], 403, [], [], []],
    'Expected the request to disappear, Grace to stay outside, and no bot to hear of it',
  );
  expectEqual(
    [
      (await useLink(grace, requestLink.invite_link)).body.outcome,
      await getJoinRequests(),
    ],
    ['join_request_sent', [[grace.id, requestLink.invite_link]]],
    'Expected Grace to be able to request again',
  );
});

Deno.test('deciding a request has an explicit outcome for each standing, right and chat', async () => {
  const {
    api,
    sessionPath,
    grace,
    hopper,
    linus,
    inviterBot,
    coInviterBot,
    observerBot,
    memberBot,
    supergroup,
    readUpdates,
    callBot,
    requestLink,
    useLink,
    getJoinRequests,
  } = await createJoinRequestFixture();
  await useLink(grace, requestLink.invite_link);
  await useLink(hopper, requestLink.invite_link);
  // Linus starts a private chat with the inviter, which has no join requests.
  await expectStatus(
    api.request(
      `${sessionPath}/accounts/${linus.id}/messages`,
      jsonRequest('POST', { to: { type: 'private', botId: inviterBot.bot.id }, text: 'hi' }),
    ),
    201,
    'Expected Linus to write to the inviter',
  );
  const decide = async (
    bot: FixtureBot,
    method: 'approveChatJoinRequest' | 'declineChatJoinRequest',
    parameters: object,
  ) => {
    const { status, body } = await callBot(bot, method, parameters);
    return [status, body.ok ? body.result : body.description];
  };
  const inChat = (userId: number) => ({ chat_id: supergroup.id, user_id: userId });
  const requestsBefore = await getJoinRequests();
  await readUpdates(inviterBot);
  await readUpdates(coInviterBot);

  const refusals = [
    await decide(inviterBot, 'approveChatJoinRequest', { chat_id: supergroup.id }),
    await decide(inviterBot, 'approveChatJoinRequest', { user_id: grace.id }),
    await decide(inviterBot, 'approveChatJoinRequest', { ...inChat(grace.id), extra: 1 }),
    await decide(inviterBot, 'approveChatJoinRequest', {
      chat_id: -1_009_999_999_999,
      user_id: grace.id,
    }),
    await decide(inviterBot, 'declineChatJoinRequest', { chat_id: linus.id, user_id: grace.id }),
    await decide(observerBot, 'approveChatJoinRequest', inChat(grace.id)),
    await decide(memberBot, 'declineChatJoinRequest', inChat(grace.id)),
    await decide(inviterBot, 'approveChatJoinRequest', inChat(linus.id)),
    await decide(inviterBot, 'declineChatJoinRequest', inChat(999_999_999)),
    await decide(inviterBot, 'approveChatJoinRequest', inChat(inviterBot.bot.id)),
  ];

  expectEqual(
    refusals,
    [
      [400, 'Bad Request: invalid user_id specified'],
      [400, 'Bad Request: chat_id is empty'],
      [400, 'Bad Request: invalid approveChatJoinRequest parameters'],
      [400, 'Bad Request: chat not found'],
      [400, "Bad Request: the chat can't have join requests"],
      [400, 'Bad Request: not enough rights to manage chat join requests'],
      [400, 'Bad Request: not enough rights to manage chat join requests'],
      [400, 'Bad Request: HIDE_REQUESTER_MISSING'],
      [400, 'Bad Request: HIDE_REQUESTER_MISSING'],
      [400, 'Bad Request: USER_ALREADY_PARTICIPANT'],
    ],
    'Expected each refusal in the order Telegram checks',
  );
  expectEqual(
    [await getJoinRequests(), await readUpdates(inviterBot), await readUpdates(coInviterBot)],
    [requestsBefore, [], []],
    'Expected the refusals to change nothing and send no update',
  );

  // Decisions consume requests, so repeating one, or deciding the other way, is refused.
  const decisions = [
    await decide(inviterBot, 'approveChatJoinRequest', inChat(grace.id)),
    await decide(coInviterBot, 'approveChatJoinRequest', inChat(grace.id)),
    await decide(inviterBot, 'declineChatJoinRequest', inChat(grace.id)),
    await decide(inviterBot, 'declineChatJoinRequest', inChat(hopper.id)),
    await decide(inviterBot, 'declineChatJoinRequest', inChat(hopper.id)),
    await decide(coInviterBot, 'approveChatJoinRequest', inChat(hopper.id)),
  ];
  expectEqual(
    decisions,
    [
      [200, true],
      [400, 'Bad Request: USER_ALREADY_PARTICIPANT'],
      [400, 'Bad Request: USER_ALREADY_PARTICIPANT'],
      [200, true],
      [400, 'Bad Request: HIDE_REQUESTER_MISSING'],
      [400, 'Bad Request: HIDE_REQUESTER_MISSING'],
    ],
    'Expected each request to be decided once',
  );

  await callBot(inviterBot, 'leaveChat', { chat_id: supergroup.id });
  expectEqual(
    await decide(inviterBot, 'approveChatJoinRequest', inChat(hopper.id)),
    [403, 'Forbidden: bot is not a member of the supergroup chat'],
    'Expected a bot that left to be turned away',
  );
});

Deno.test('simultaneous approvals add the member once, as the activity log shows', async () => {
  const {
    api,
    sessionPath,
    grace,
    inviterBot,
    coInviterBot,
    observerBot,
    supergroup,
    readUpdates,
    callBot,
    requestLink,
    useLink,
  } = await createJoinRequestFixture();
  await useLink(grace, requestLink.invite_link);
  await readUpdates(observerBot);
  const memberCount = async () =>
    (await callBot(inviterBot, 'getChatMemberCount', { chat_id: supergroup.id })).body.result;
  const memberCountBefore = await memberCount() as number;
  const approve = (bot: FixtureBot) =>
    callBot(bot, 'approveChatJoinRequest', { chat_id: supergroup.id, user_id: grace.id });

  const approvals = await Promise.all([approve(inviterBot), approve(coInviterBot)]);
  const activity = await requestJson<{ entries: Array<Record<string, unknown>> }>(
    api,
    'GET',
    `${sessionPath}/bot-activity?method=approveChatJoinRequest`,
  );

  expectEqual(
    approvals.map(({ status, body }) => [status, body.ok ? body.result : body.description])
      .sort(),
    [[200, true], [400, 'Bad Request: USER_ALREADY_PARTICIPANT']].sort(),
    'Expected one approval to succeed and the other to find Grace a member',
  );
  expectEqual(
    [await memberCount(), describeMembershipUpdates(await readUpdates(observerBot)).length],
    [memberCountBefore + 1, 2],
    'Expected Grace to join once, with one membership update and one service message',
  );
  expectEqual(
    activity.body.entries.map(({ bot_id, answer }) => [bot_id, (answer as { ok: boolean }).ok])
      .sort(),
    [[inviterBot.bot.id, true], [coInviterBot.bot.id, false]].sort(),
    'Expected the activity log to record the success and the failure',
  );
});

Deno.test('an approved account joins with its restriction, and counts for its link while it stays', async () => {
  const {
    api,
    ada,
    grace,
    inviterBot,
    supergroup,
    supergroupPath,
    asOwner,
    callBot,
    requestLink,
    useLink,
  } = await createJoinRequestFixture();
  await useLink(grace, requestLink.invite_link);
  await asOwner(
    `restrictions/${grace.id}`,
    jsonRequest('PUT', { permissions: { can_send_messages: true } }),
  );
  const linkMemberCount = async () =>
    (await requestJson<{ invite_links: Array<{ member_count: number }> }>(
      api,
      'GET',
      `${supergroupPath(ada.id)}/invite-links`,
    )).body.invite_links[0].member_count;

  await callBot(inviterBot, 'approveChatJoinRequest', {
    chat_id: supergroup.id,
    user_id: grace.id,
  });
  const member = (await callBot(inviterBot, 'getChatMember', {
    chat_id: supergroup.id,
    user_id: grace.id,
  })).body.result as { status: string; is_member: boolean };
  const countWhileMember = await linkMemberCount();
  await expectStatus(
    api.request(`${supergroupPath(grace.id)}/members/${grace.id}`, { method: 'DELETE' }),
    204,
    'Expected Grace to leave',
  );

  expectEqual(
    [member.status, member.is_member, countWhileMember, await linkMemberCount()],
    ['restricted', true, 1, 0],
    'Expected Grace to join restricted, through the link, until she leaves',
  );
});

Deno.test('a grammY bot approves join requests through its webhook', async () => {
  const { api, sessionPath, grace, inviterBot, supergroup, requestLink, useLink, getMemberStatus } =
    await createJoinRequestFixture();
  const grammyBot = new Bot(inviterBot.token, {
    client: {
      apiRoot: `${TEST_PUBLIC_ORIGIN}${sessionPath}/bot-api`,
      fetch: async (input, init) => await api.fetch(new Request(input, init)),
    },
  });
  const memberObserved = Promise.withResolvers<Record<string, unknown>>();
  grammyBot.on('chat_join_request', async (context) => {
    await context.approveChatJoinRequest(context.chatJoinRequest.from.id);
  });
  grammyBot.on('chat_member', (context) => {
    memberObserved.resolve(context.chatMember as unknown as Record<string, unknown>);
  });
  const handleWebhookRequest = webhookCallback(grammyBot, 'std/http');
  const webhookServer = Deno.serve(
    { hostname: '127.0.0.1', port: 0, onListen: () => {} },
    (request) => handleWebhookRequest(request),
  );
  try {
    await grammyBot.api.setWebhook(`http://127.0.0.1:${webhookServer.addr.port}/webhook`, {
      allowed_updates: ['chat_join_request', 'chat_member'],
    });
    await useLink(grace, requestLink.invite_link);
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const observed = await Promise.race([
      memberObserved.promise,
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(
          () => reject(new Error('Expected the bot to observe the approved member')),
          5_000,
        );
      }),
    ]).finally(() => clearTimeout(timeoutId));

    expectEqual(
      [
        (observed.from as { id: number }).id,
        (observed.new_chat_member as { user: { id: number }; status: string }).user.id,
        (observed.invite_link as { invite_link: string }).invite_link,
        await getMemberStatus(grace.id),
        (observed.chat as { id: number }).id,
      ],
      [inviterBot.bot.id, grace.id, requestLink.invite_link, 'member', supergroup.id],
      'Expected the bot to approve Grace and receive her joining from itself',
    );
  } finally {
    await api.request(sessionPath, { method: 'DELETE' });
    await webhookServer.shutdown();
  }
});
