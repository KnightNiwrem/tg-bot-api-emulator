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
  readonly bot: { readonly id: number };
  readonly botApiPath: string;
}

/** The rights of a supergroup administrator, in the order the Bot API shows them. */
const SUPERGROUP_ADMINISTRATOR_RIGHTS = [
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
] as const;

/**
 * Creates a session where Ada owns a supergroup with Grace and Hopper, accounts, and two bots
 * subscribed to membership updates. Ada promotes the delegating bot and Grace, both with
 * `can_promote_members`; Linus is an account outside the supergroup.
 */
async function createPromotionFixture() {
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
  const hopper = await createAccount('Hopper');
  const linus = await createAccount('Linus');
  const createBot = async (username: string): Promise<FixtureBot> => {
    const { body } = await requestJson<{ token: string; bot: { id: number } }>(
      api,
      'POST',
      `${sessionPath}/bots`,
      { first_name: 'Test Bot', username },
    );
    return { ...body, botApiPath: `${sessionPath}/bot-api/bot${body.token}` };
  };
  const delegatingBot = await createBot('delegating_bot');
  const otherBot = await createBot('other_bot');

  const { body: { supergroup } } = await requestJson<{ supergroup: { id: number } }>(
    api,
    'POST',
    `${sessionPath}/accounts/${ada.id}/supergroups`,
    { title: 'Team' },
  );
  const supergroupPath = (accountId: number) =>
    `${sessionPath}/accounts/${accountId}/conversations/supergroup/${supergroup.id}`;
  for (const memberId of [grace.id, hopper.id, delegatingBot.bot.id, otherBot.bot.id]) {
    await expectStatus(
      api.request(`${supergroupPath(ada.id)}/members/${memberId}`, { method: 'PUT' }),
      204,
      `Expected member ${memberId} to be added`,
    );
  }
  const promoteAsOwner = (userId: number, rights: Record<string, boolean>) =>
    expectStatus(
      api.request(`${supergroupPath(ada.id)}/administrators/${userId}`, jsonRequest('PUT', rights)),
      204,
      `Expected the owner to promote user ${userId}`,
    );
  await promoteAsOwner(delegatingBot.bot.id, { can_promote_members: true });
  await promoteAsOwner(grace.id, { can_promote_members: true });

  const readUpdates = createUpdateReader(api);
  const callBot = (bot: FixtureBot, method: string, parameters: object) =>
    requestJson<BotApiResponse>(api, 'POST', `${bot.botApiPath}/${method}`, parameters);
  const getChatMember = async (observer: FixtureBot, userId: number) =>
    (await callBot(observer, 'getChatMember', { chat_id: supergroup.id, user_id: userId }))
      .body.result as Record<string, unknown>;
  const getAdministratorsAsAccount = (accountId: number) =>
    requestJson<{ administrators: Array<Record<string, unknown>> }>(
      api,
      'GET',
      `${supergroupPath(accountId)}/administrators`,
    );

  return {
    api,
    sessionPath,
    ada,
    grace,
    hopper,
    linus,
    delegatingBot,
    otherBot,
    supergroup,
    supergroupPath,
    promoteAsOwner,
    readUpdates,
    callBot,
    getChatMember,
    getAdministratorsAsAccount,
  };
}

/** Returns a reader of each bot's membership updates since the reader last read that bot's. */
function createUpdateReader(api: EmulationApi) {
  const nextOffsetsByBotApiPath = new Map<string, number>();
  return async (bot: FixtureBot): Promise<Array<Record<string, unknown>>> => {
    const { body } = await requestJson<{ result: Array<Record<string, unknown>> }>(
      api,
      'POST',
      `${bot.botApiPath}/getUpdates`,
      {
        offset: nextOffsetsByBotApiPath.get(bot.botApiPath) ?? 0,
        allowed_updates: ['chat_member', 'my_chat_member'],
      },
    );
    const lastUpdateId = body.result.at(-1)?.update_id;
    if (typeof lastUpdateId === 'number') {
      nextOffsetsByBotApiPath.set(bot.botApiPath, lastUpdateId + 1);
    }
    return body.result.map(({ update_id: _updateId, ...update }) => update);
  };
}

/** An administrator as the Bot API shows it, holding the given rights and `can_manage_chat`. */
function administratorMember(
  user: unknown,
  heldRights: readonly string[],
  { canBeEdited, customTitle }: { canBeEdited: boolean; customTitle?: string },
) {
  const holds = (right: string) => right === 'can_manage_chat' || heldRights.includes(right);
  return {
    user,
    status: 'administrator',
    can_be_edited: canBeEdited,
    ...Object.fromEntries(SUPERGROUP_ADMINISTRATOR_RIGHTS.map((right) => [right, holds(right)])),
    is_anonymous: false,
    can_manage_voice_chats: holds('can_manage_video_chats'),
    ...(customTitle === undefined ? {} : { custom_title: customTitle }),
  };
}

/** An administrator as an account inspects it, holding the given rights and `can_manage_chat`. */
function administratorForAccount(
  userId: number,
  heldRights: readonly string[],
  { promotedById, canBeEdited }: { promotedById: number; canBeEdited: boolean },
) {
  return {
    user_id: userId,
    status: 'administrator',
    rights: Object.fromEntries(
      SUPERGROUP_ADMINISTRATOR_RIGHTS.map((
        right,
      ) => [right, right === 'can_manage_chat' || heldRights.includes(right)]),
    ),
    promoted_by_user_id: promotedById,
    can_be_edited: canBeEdited,
  };
}

/** The bot user that membership updates and chat members show. */
function botUser(bot: FixtureBot, username: string) {
  return { id: bot.bot.id, is_bot: true, first_name: 'Test Bot', username };
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

Deno.test('bots see the administrators the owner promoted as ones they may not edit', async () => {
  const { ada, grace, delegatingBot, otherBot, supergroup, callBot, getChatMember, readUpdates } =
    await createPromotionFixture();
  const delegatingBotUser = botUser(delegatingBot, 'delegating_bot');

  // The bot's last update is its promotion, after the one for its joining.
  const promotion = (await readUpdates(delegatingBot)).at(-1) ?? {};
  const administrators = await callBot(otherBot, 'getChatAdministrators', {
    chat_id: supergroup.id,
    return_bots: true,
  });

  expectEqual(
    promotion,
    {
      my_chat_member: {
        chat: { id: supergroup.id, title: 'Team', type: 'supergroup' },
        from: { id: ada.id, is_bot: false, first_name: 'Ada' },
        date: (promotion.my_chat_member as { date: number }).date,
        old_chat_member: { user: delegatingBotUser, status: 'member' },
        new_chat_member: administratorMember(delegatingBotUser, ['can_promote_members'], {
          canBeEdited: false,
        }),
      },
    },
    'Expected the promoted bot to see that it may not edit itself',
  );
  expectEqual(
    await getChatMember(delegatingBot, grace.id),
    administratorMember(grace, ['can_promote_members'], { canBeEdited: false }),
    'Expected a bot that may promote to see that it may not edit what the owner promoted',
  );
  expectEqual(
    (administrators.body.result as Array<{ can_be_edited?: boolean }>).map((member) =>
      member.can_be_edited
    ),
    [undefined, false, false],
    'Expected no administrator to be editable by the other bot',
  );
});

Deno.test('members inspect who promoted each administrator and whom they may edit', async () => {
  const {
    api,
    sessionPath,
    ada,
    grace,
    hopper,
    linus,
    delegatingBot,
    supergroup,
    getAdministratorsAsAccount,
  } = await createPromotionFixture();
  await expectStatus(
    api.request(
      `${sessionPath}/accounts/${ada.id}/conversations/supergroup/${supergroup.id}/administrators/${ada.id}/custom-title`,
      jsonRequest('PUT', { custom_title: 'Founder' }),
    ),
    204,
    'Expected the owner to title itself',
  );

  const asOwner = await getAdministratorsAsAccount(ada.id);
  const asAdministrator = await getAdministratorsAsAccount(grace.id);
  const asMember = await getAdministratorsAsAccount(hopper.id);

  const owner = { user_id: ada.id, status: 'owner', custom_title: 'Founder' };
  // Grace joined before the delegating bot, so she is listed first.
  const administrators = (canBeEdited: boolean) => [
    owner,
    administratorForAccount(grace.id, ['can_promote_members'], {
      promotedById: ada.id,
      canBeEdited,
    }),
    administratorForAccount(delegatingBot.bot.id, ['can_promote_members'], {
      promotedById: ada.id,
      canBeEdited,
    }),
  ];
  expectEqual(
    [asOwner.status, asOwner.body.administrators],
    [200, administrators(true)],
    'Expected the owner to edit every administrator',
  );
  expectEqual(
    asAdministrator.body.administrators,
    administrators(false),
    'Expected an administrator that may promote to edit nobody the owner promoted, itself included',
  );
  expectEqual(
    asMember.body.administrators,
    administrators(false),
    'Expected a member to edit none',
  );
  expectEqual(
    [
      (await getAdministratorsAsAccount(linus.id)).status,
      (await requestJson(
        api,
        'GET',
        `${sessionPath}/accounts/${ada.id}/conversations/supergroup/-1000000999999/administrators`,
      )).status,
      (await requestJson(
        api,
        'GET',
        `${sessionPath}/accounts/${ada.id}/conversations/supergroup/1/administrators`,
      )).status,
    ],
    [403, 404, 400],
    'Expected a non-member, an unknown supergroup, and an invalid identifier to be refused',
  );
});
