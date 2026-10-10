import { Bot, webhookCallback } from 'grammy';
import {
  createSession,
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
 * `can_promote_members`; Linus is an account outside the supergroup. The session is created on
 * `existingApi` when given, or on an API of its own.
 */
async function createPromotionFixture(existingApi?: EmulationApi) {
  const { api, sessionPath } = existingApi === undefined
    ? await createTestSession()
    : { api: existingApi, sessionPath: await createSession(existingApi) };
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
    createBot,
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

/** Describes membership updates as their kind, member, old and new status, and editability. */
function describeMembershipUpdates(updates: ReadonlyArray<Record<string, unknown>>): string[] {
  return updates.map((update) => {
    const [kind, change] = Object.entries(update)[0];
    const { old_chat_member, new_chat_member } = change as {
      old_chat_member: { status: string; can_be_edited?: boolean };
      new_chat_member: { user: { id: number }; status: string; can_be_edited?: boolean };
    };
    const describe = ({ status, can_be_edited }: { status: string; can_be_edited?: boolean }) =>
      can_be_edited === undefined ? status : `${status}(${can_be_edited ? 'editable' : 'fixed'})`;
    return `${kind} ${new_chat_member.user.id}: ${describe(old_chat_member)} -> ${
      describe(new_chat_member)
    }`;
  });
}

Deno.test('a bot promotes a member, changes its rights and demotes it, as observers see', async () => {
  const {
    ada,
    grace,
    hopper,
    delegatingBot,
    otherBot,
    supergroup,
    promoteAsOwner,
    callBot,
    getChatMember,
    getAdministratorsAsAccount,
    readUpdates,
  } = await createPromotionFixture();
  // The other bot administers the supergroup, so it observes other members' changes.
  await promoteAsOwner(otherBot.bot.id, { can_restrict_members: true });
  await promoteAsOwner(delegatingBot.bot.id, {
    can_promote_members: true,
    can_delete_messages: true,
  });
  for (const bot of [delegatingBot, otherBot]) {
    await readUpdates(bot);
  }
  const promote = (rights: Record<string, boolean>) =>
    callBot(delegatingBot, 'promoteChatMember', {
      chat_id: supergroup.id,
      user_id: hopper.id,
      ...rights,
    });

  const promotion = await promote({ can_delete_messages: true });
  const promoted = await getChatMember(delegatingBot, hopper.id);
  const promotedAsOtherBotSees = await getChatMember(otherBot, hopper.id);
  const inspectedByOwner = await getAdministratorsAsAccount(ada.id);
  const inspectedByGrace = await getAdministratorsAsAccount(grace.id);
  // Granting the rights the administrator holds changes nothing, and no update reports it.
  const repeatedPromotion = await promote({ can_delete_messages: true });
  const rightsChange = await promote({ can_promote_members: true, can_manage_voice_chats: false });
  // The documented demotion passes every right as false.
  const demotion = await promote({ can_promote_members: false, can_delete_messages: false });
  const repeatedDemotion = await promote({});
  const demoted = await getChatMember(delegatingBot, hopper.id);

  expectEqual(
    [promotion.body, repeatedPromotion.body, rightsChange.body, demotion.body],
    Array(4).fill({ ok: true, result: true }),
    'Expected every promotion and the demotion to succeed',
  );
  expectEqual(
    [promoted, promotedAsOtherBotSees],
    [
      administratorMember(hopper, ['can_delete_messages'], { canBeEdited: true }),
      administratorMember(hopper, ['can_delete_messages'], { canBeEdited: false }),
    ],
    'Expected only the promoting bot to edit the administrator',
  );
  const findHopper = (administrators: ReadonlyArray<Record<string, unknown>>) =>
    administrators.find(({ user_id }) => user_id === hopper.id);
  expectEqual(
    [
      findHopper(inspectedByOwner.body.administrators),
      findHopper(inspectedByGrace.body.administrators),
    ],
    [
      administratorForAccount(hopper.id, ['can_delete_messages'], {
        promotedById: delegatingBot.bot.id,
        canBeEdited: true,
      }),
      administratorForAccount(hopper.id, ['can_delete_messages'], {
        promotedById: delegatingBot.bot.id,
        canBeEdited: false,
      }),
    ],
    'Expected accounts to see the bot as the promoter, and only the owner to edit it',
  );
  expectEqual(
    [repeatedDemotion.body, demoted],
    [{ ok: true, result: true }, { user: hopper, status: 'member' }],
    'Expected the demoted administrator to be a member, and demoting it again to change nothing',
  );
  expectEqual(
    describeMembershipUpdates(await readUpdates(delegatingBot)),
    [
      `chat_member ${hopper.id}: member -> administrator(editable)`,
      `chat_member ${hopper.id}: administrator(editable) -> administrator(editable)`,
      `chat_member ${hopper.id}: administrator(editable) -> member`,
    ],
    'Expected the promoting bot to observe each change once, as its editor',
  );
  expectEqual(
    describeMembershipUpdates(await readUpdates(otherBot)),
    [
      `chat_member ${hopper.id}: member -> administrator(fixed)`,
      `chat_member ${hopper.id}: administrator(fixed) -> administrator(fixed)`,
      `chat_member ${hopper.id}: administrator(fixed) -> member`,
    ],
    'Expected the other administrator bot to observe the same changes, without editing them',
  );
});

Deno.test('a delegated chain of bots edits only its descendants, within its own rights', async () => {
  const { ada, grace, hopper, delegatingBot, otherBot, supergroup, callBot, getChatMember } =
    await createPromotionFixture();
  const promote = (actor: FixtureBot, userId: number, rights: Record<string, boolean>) =>
    callBot(actor, 'promoteChatMember', { chat_id: supergroup.id, user_id: userId, ...rights })
      .then(({ body }) => body.ok ? body.result : body.description);

  // The owner promoted the delegating bot, which promotes the other bot, which promotes Hopper.
  const chain = [
    await promote(delegatingBot, otherBot.bot.id, { can_promote_members: true }),
    await promote(otherBot, hopper.id, { can_promote_members: true }),
  ];
  const editabilityInChain = [
    (await getChatMember(delegatingBot, hopper.id)).can_be_edited,
    (await getChatMember(otherBot, hopper.id)).can_be_edited,
    (await getChatMember(delegatingBot, otherBot.bot.id)).can_be_edited,
    (await getChatMember(otherBot, delegatingBot.bot.id)).can_be_edited,
  ];
  const escalations = [
    // A right the other bot does not hold.
    await promote(otherBot, hopper.id, { can_promote_members: true, can_restrict_members: true }),
    // Its own rights, its promoter, an administrator the owner promoted, and the owner.
    await promote(otherBot, otherBot.bot.id, { can_promote_members: true }),
    await promote(otherBot, delegatingBot.bot.id, {}),
    await promote(otherBot, grace.id, {}),
    await promote(otherBot, ada.id, { can_promote_members: true }),
  ];
  // The delegating bot demotes Hopper, whom it promoted indirectly.
  const indirectDemotion = await promote(delegatingBot, hopper.id, {});

  expectEqual(chain, [true, true], 'Expected each bot to promote the next one');
  expectEqual(
    editabilityInChain,
    [true, true, true, false],
    'Expected each bot to edit its descendants only',
  );
  expectEqual(
    escalations,
    [
      'Bad Request: RIGHT_FORBIDDEN',
      "Bad Request: can't promote self",
      'Bad Request: user is an administrator of the chat',
      'Bad Request: user is an administrator of the chat',
      "Bad Request: can't remove chat owner",
    ],
    'Expected every escalation to be refused',
  );
  expectEqual(
    [indirectDemotion, (await getChatMember(otherBot, hopper.id)).status],
    [true, 'member'],
    'Expected the delegating bot to demote an indirect appointee',
  );
});

Deno.test('a broken chain leaves the appointee to the owner', async () => {
  const { ada, hopper, delegatingBot, otherBot, supergroup, callBot, getAdministratorsAsAccount } =
    await createPromotionFixture();
  const promote = (actor: FixtureBot, userId: number, rights: Record<string, boolean>) =>
    callBot(actor, 'promoteChatMember', { chat_id: supergroup.id, user_id: userId, ...rights })
      .then(({ body }) => body.ok ? body.result : body.description);

  const setup = [
    await promote(delegatingBot, otherBot.bot.id, { can_promote_members: true }),
    await promote(otherBot, hopper.id, { can_promote_members: true }),
    await promote(delegatingBot, otherBot.bot.id, {}),
  ];
  const editByFormerAncestor = await promote(delegatingBot, hopper.id, {});
  const hopperAsOwnerSees = (await getAdministratorsAsAccount(ada.id)).body.administrators
    .find(({ user_id }) => user_id === hopper.id);

  expectEqual(setup, [true, true, true], 'Expected the chain to be built and broken');
  expectEqual(
    [
      editByFormerAncestor,
      hopperAsOwnerSees?.promoted_by_user_id,
      hopperAsOwnerSees?.can_be_edited,
    ],
    ['Bad Request: user is an administrator of the chat', otherBot.bot.id, true],
    'Expected only the owner to edit the appointee of a demoted promoter',
  );
});

Deno.test('a demoted promoter loses its privileges, and bots act on administrators they promoted', async () => {
  const { grace, hopper, delegatingBot, otherBot, supergroup, promoteAsOwner, callBot } =
    await createPromotionFixture();
  await promoteAsOwner(delegatingBot.bot.id, {
    can_promote_members: true,
    can_restrict_members: true,
  });
  const call = (actor: FixtureBot, method: string, parameters: object) =>
    callBot(actor, method, { chat_id: supergroup.id, ...parameters })
      .then(({ body }) => body.ok ? body.result : body.description);
  const statusOf = async (userId: number) =>
    ((await callBot(delegatingBot, 'getChatMember', { chat_id: supergroup.id, user_id: userId }))
      .body.result as { status: string }).status;

  const delegation = [
    await call(delegatingBot, 'promoteChatMember', {
      user_id: otherBot.bot.id,
      can_promote_members: true,
      can_restrict_members: true,
    }),
    await call(otherBot, 'promoteChatMember', {
      user_id: hopper.id,
      can_restrict_members: true,
    }),
  ];
  const restrictionOfAppointee = await call(otherBot, 'restrictChatMember', {
    user_id: hopper.id,
    permissions: { can_send_messages: true },
  });
  const banOfOwnersAdministrator = await call(otherBot, 'banChatMember', { user_id: grace.id });
  const demotion = await call(delegatingBot, 'promoteChatMember', {
    user_id: otherBot.bot.id,
    can_promote_members: false,
    can_restrict_members: false,
  });
  const afterDemotion = [
    await call(otherBot, 'banChatMember', { user_id: hopper.id }),
    await call(otherBot, 'promoteChatMember', { user_id: hopper.id, can_restrict_members: true }),
  ];

  expectEqual(delegation, [true, true], 'Expected the delegation to succeed');
  expectEqual(
    [restrictionOfAppointee, await statusOf(hopper.id), banOfOwnersAdministrator],
    [true, 'restricted', 'Bad Request: user is an administrator of the chat'],
    'Expected a bot to restrict only an administrator it promoted, which then loses its rights',
  );
  expectEqual(
    [demotion, await statusOf(otherBot.bot.id), afterDemotion],
    [true, 'member', [
      'Bad Request: not enough rights to restrict/unrestrict chat member',
      'Bad Request: not enough rights',
    ]],
    'Expected the demoted bot to lose its privileges',
  );
});

Deno.test('promoteChatMember refuses what Telegram refuses, without changing anything', async () => {
  const {
    api,
    ada,
    grace,
    hopper,
    linus,
    delegatingBot,
    otherBot,
    supergroup,
    supergroupPath,
    promoteAsOwner,
    callBot,
    readUpdates,
    getAdministratorsAsAccount,
  } = await createPromotionFixture();
  // Hopper is banned once the owner removes her, and Grace, no longer an administrator, is
  // restricted.
  await expectStatus(
    api.request(`${supergroupPath(ada.id)}/members/${hopper.id}`, { method: 'DELETE' }),
    204,
    'Expected the owner to remove Hopper',
  );
  await expectStatus(
    api.request(
      `${supergroupPath(ada.id)}/restrictions/${grace.id}`,
      jsonRequest('PUT', { permissions: { can_send_messages: true } }),
    ),
    204,
    'Expected the owner to restrict Grace',
  );
  const administratorsBefore = await getAdministratorsAsAccount(ada.id);
  for (const bot of [delegatingBot, otherBot]) {
    await readUpdates(bot);
  }
  const describe = async (actor: FixtureBot, parameters: Record<string, unknown>) => {
    const { status, body } = await callBot(actor, 'promoteChatMember', parameters);
    return [status, body.ok ? body.result : body.description];
  };

  const failures = [
    await describe(delegatingBot, { chat_id: supergroup.id }),
    await describe(delegatingBot, { user_id: linus.id }),
    await describe(delegatingBot, { chat_id: -1_000_000_999_999, user_id: linus.id }),
    await describe(delegatingBot, { chat_id: linus.id, user_id: linus.id }),
    await describe(delegatingBot, { chat_id: supergroup.id, user_id: 999_999 }),
    await describe(delegatingBot, {
      chat_id: supergroup.id,
      user_id: linus.id,
      is_anonymous: true,
    }),
    await describe(delegatingBot, { chat_id: supergroup.id, user_id: linus.id, can_fly: true }),
    await describe(otherBot, {
      chat_id: supergroup.id,
      user_id: linus.id,
      can_invite_users: true,
    }),
    await describe(delegatingBot, {
      chat_id: supergroup.id,
      user_id: linus.id,
      can_promote_members: true,
    }),
    await describe(delegatingBot, {
      chat_id: supergroup.id,
      user_id: hopper.id,
      can_promote_members: true,
    }),
    // Demoting users that are no administrators: one that left would have to be added, and
    // lifting a ban or restriction needs `can_restrict_members`.
    await describe(delegatingBot, { chat_id: supergroup.id, user_id: linus.id }),
    await describe(delegatingBot, { chat_id: supergroup.id, user_id: hopper.id }),
    await describe(delegatingBot, { chat_id: supergroup.id, user_id: grace.id }),
  ];
  const administratorsAfter = await getAdministratorsAsAccount(ada.id);

  expectEqual(
    failures,
    [
      [400, 'Bad Request: invalid user_id specified'],
      [400, 'Bad Request: chat_id is empty'],
      [400, 'Bad Request: chat not found'],
      [400, 'Bad Request: chat not found'],
      [400, 'Bad Request: member not found'],
      [400, 'Bad Request: anonymous administrators are not supported'],
      [400, 'Bad Request: invalid promoteChatMember parameters'],
      [400, 'Bad Request: not enough rights'],
      [400, 'Bad Request: USER_NOT_MUTUAL_CONTACT'],
      [400, 'Bad Request: USER_KICKED'],
      [400, "Bad Request: bots can't add new chat members"],
      [400, 'Bad Request: not enough rights to restrict/unrestrict chat member'],
      [400, 'Bad Request: not enough rights to restrict/unrestrict chat member'],
    ],
    'Expected Telegram errors',
  );
  expectEqual(administratorsAfter.body, administratorsBefore.body, 'Expected no change');
  expectEqual(
    [await readUpdates(delegatingBot), await readUpdates(otherBot)],
    [[], []],
    'Expected no update for a refused promotion',
  );

  // Demoting a restricted member lifts its restriction once the bot may restrict members.
  await promoteAsOwner(delegatingBot.bot.id, {
    can_promote_members: true,
    can_restrict_members: true,
  });
  expectEqual(
    [
      await describe(delegatingBot, { chat_id: supergroup.id, user_id: grace.id }),
      (await callBot(delegatingBot, 'getChatMember', { chat_id: supergroup.id, user_id: grace.id }))
        .body.result,
    ],
    [[200, true], { user: grace, status: 'member' }],
    'Expected the demotion of a restricted member to lift its restriction',
  );
});

/** Describes membership updates as their kind, actor, member, and old and new status. */
function describeAttributedUpdates(updates: ReadonlyArray<Record<string, unknown>>): string[] {
  return updates.map((update) => {
    const [kind, change] = Object.entries(update)[0];
    const { from, old_chat_member, new_chat_member } = change as {
      from: { id: number };
      old_chat_member: { status: string };
      new_chat_member: { user: { id: number }; status: string };
    };
    return `${kind} by ${from.id} ${new_chat_member.user.id}: ${old_chat_member.status} -> ${new_chat_member.status}`;
  });
}

Deno.test('an administrator account promotes and demotes within its rights, as bots observe', async () => {
  const {
    api,
    ada,
    grace,
    hopper,
    linus,
    delegatingBot,
    otherBot,
    supergroupPath,
    promoteAsOwner,
    readUpdates,
    getChatMember,
    getAdministratorsAsAccount,
  } = await createPromotionFixture();
  await promoteAsOwner(grace.id, { can_promote_members: true, can_delete_messages: true });
  for (const bot of [delegatingBot, otherBot]) {
    await readUpdates(bot);
  }
  const administratorPath = (actorId: number, userId: number) =>
    `${supergroupPath(actorId)}/administrators/${userId}`;
  const promote = async (actorId: number, userId: number, rights: Record<string, boolean>) =>
    (await api.request(administratorPath(actorId, userId), jsonRequest('PUT', rights))).status;
  const demote = async (actorId: number, userId: number) =>
    (await api.request(administratorPath(actorId, userId), { method: 'DELETE' })).status;

  // Grace promotes the other bot, and promoting it with the same rights again changes nothing.
  const promotions = [
    await promote(grace.id, otherBot.bot.id, { can_delete_messages: true }),
    await promote(grace.id, otherBot.bot.id, { can_delete_messages: true }),
  ];
  const promotedAsDelegatingBotSees = await getChatMember(delegatingBot, otherBot.bot.id);
  const promotedAsOwnerSees = (await getAdministratorsAsAccount(ada.id)).body.administrators;
  const promotedAsGraceSees = (await getAdministratorsAsAccount(grace.id)).body.administrators;
  const promotionUpdates = [await readUpdates(delegatingBot), await readUpdates(otherBot)];

  // Excessive grants, protected administrators, and the owner are refused without changes.
  const refusals = [
    await promote(grace.id, hopper.id, { can_restrict_members: true }),
    await promote(grace.id, otherBot.bot.id, { can_delete_messages: true, can_pin_messages: true }),
    await promote(grace.id, delegatingBot.bot.id, { can_delete_messages: true }),
    await demote(grace.id, delegatingBot.bot.id),
    await demote(grace.id, grace.id),
    await demote(grace.id, ada.id),
    await promote(grace.id, linus.id, { can_delete_messages: true }),
    await promote(linus.id, hopper.id, { can_delete_messages: true }),
    await demote(hopper.id, otherBot.bot.id),
    await promote(grace.id, 999_999, { can_delete_messages: true }),
    await promote(grace.id, hopper.id, {}),
  ];
  const administratorsAfterRefusals = await getAdministratorsAsAccount(ada.id);
  const refusalUpdates = [await readUpdates(delegatingBot), await readUpdates(otherBot)];

  // Grace demotes the bot she promoted; demoting it again changes nothing.
  const demotions = [
    await demote(grace.id, otherBot.bot.id),
    await demote(grace.id, otherBot.bot.id),
  ];

  expectEqual(promotions, [204, 204], 'Expected Grace to promote the bot');
  expectEqual(
    promotedAsDelegatingBotSees,
    administratorMember(botUser(otherBot, 'other_bot'), ['can_delete_messages'], {
      canBeEdited: false,
    }),
    'Expected an administrator bot that did not promote it to see it as fixed',
  );
  const findOtherBot = (administrators: ReadonlyArray<Record<string, unknown>>) =>
    administrators.find(({ user_id }) => user_id === otherBot.bot.id);
  expectEqual(
    [findOtherBot(promotedAsOwnerSees), findOtherBot(promotedAsGraceSees)],
    [true, true].map((canBeEdited) =>
      administratorForAccount(otherBot.bot.id, ['can_delete_messages'], {
        promotedById: grace.id,
        canBeEdited,
      })
    ),
    'Expected Grace to be the promoter, whom the owner and Grace may edit',
  );
  expectEqual(
    promotionUpdates.map(describeAttributedUpdates),
    [
      [`chat_member by ${grace.id} ${otherBot.bot.id}: member -> administrator`],
      [`my_chat_member by ${grace.id} ${otherBot.bot.id}: member -> administrator`],
    ],
    'Expected the promotion to reach both bots once, from Grace',
  );
  expectEqual(
    refusals,
    [403, 403, 403, 403, 403, 409, 409, 403, 403, 404, 400],
    'Expected each refusal',
  );
  expectEqual(
    [administratorsAfterRefusals.body.administrators, refusalUpdates],
    [promotedAsOwnerSees, [[], []]],
    'Expected refusals to change nothing and to send no update',
  );
  expectEqual(demotions, [204, 204], 'Expected Grace to demote the bot');
  expectEqual(
    [
      describeAttributedUpdates(await readUpdates(delegatingBot)),
      describeAttributedUpdates(await readUpdates(otherBot)),
    ],
    [
      [`chat_member by ${grace.id} ${otherBot.bot.id}: administrator -> member`],
      [`my_chat_member by ${grace.id} ${otherBot.bot.id}: administrator -> member`],
    ],
    'Expected the demotion to reach both bots once, from Grace',
  );
});

Deno.test('accounts and bots edit administrators along one chain of promotions', async () => {
  const {
    api,
    ada,
    grace,
    hopper,
    otherBot,
    supergroup,
    supergroupPath,
    promoteAsOwner,
    callBot,
    getAdministratorsAsAccount,
  } = await createPromotionFixture();
  const accountChange = async (
    actorId: number,
    userId: number,
    rights?: Record<string, boolean>,
  ) =>
    (await api.request(
      `${supergroupPath(actorId)}/administrators/${userId}`,
      rights === undefined ? { method: 'DELETE' } : jsonRequest('PUT', rights),
    )).status;
  const promoteAsBot = (userId: number, rights: Record<string, boolean>) =>
    callBot(otherBot, 'promoteChatMember', { chat_id: supergroup.id, user_id: userId, ...rights })
      .then(({ body }) => body.ok ? body.result : body.description);
  const hopperAs = async (observerId: number) =>
    (await getAdministratorsAsAccount(observerId)).body.administrators
      .find(({ user_id }) => user_id === hopper.id);

  // Grace promotes the bot, which promotes Hopper; Grace edits Hopper through the bot.
  const chain = [
    await accountChange(grace.id, otherBot.bot.id, { can_promote_members: true }),
    await promoteAsBot(hopper.id, { can_promote_members: true }),
  ];
  const hopperInChain = await hopperAs(grace.id);
  const indirectChange = await accountChange(grace.id, hopper.id, { can_manage_chat: true });
  const hopperAfterGraceChange = await hopperAs(ada.id);
  // The bot no longer edits Hopper, whose promoter is now Grace; Hopper never edits Grace.
  const botAfterGraceChange = await promoteAsBot(hopper.id, {});
  const hopperOnGrace = await accountChange(hopper.id, grace.id);

  // Once the owner demotes Grace, her appointees are left to the owner.
  await accountChange(ada.id, grace.id);
  await promoteAsOwner(grace.id, { can_promote_members: true });
  const afterNewTenure = [
    await accountChange(grace.id, hopper.id),
    await accountChange(grace.id, otherBot.bot.id),
    (await hopperAs(ada.id))?.promoted_by_user_id,
  ];

  expectEqual(chain, [204, true], 'Expected the chain to be built');
  expectEqual(
    hopperInChain,
    administratorForAccount(hopper.id, ['can_promote_members'], {
      promotedById: otherBot.bot.id,
      canBeEdited: true,
    }),
    'Expected Grace to edit the appointee of the bot she promoted',
  );
  expectEqual(
    [indirectChange, hopperAfterGraceChange],
    [
      204,
      administratorForAccount(hopper.id, [], { promotedById: grace.id, canBeEdited: true }),
    ],
    'Expected Grace to become the promoter of Hopper',
  );
  expectEqual(
    [botAfterGraceChange, hopperOnGrace],
    ['Bad Request: user is an administrator of the chat', 403],
    'Expected neither the bot nor Hopper to edit what Grace promoted or Grace herself',
  );
  expectEqual(
    afterNewTenure,
    [403, 403, grace.id],
    'Expected Grace to edit none of the appointees of her earlier tenure',
  );
});

Deno.test('administrator accounts act only within their own session', async () => {
  const first = await createPromotionFixture();
  const second = await createPromotionFixture(first.api);
  for (const bot of [second.delegatingBot, second.otherBot]) {
    await second.readUpdates(bot);
  }
  const administratorsBefore = await second.getAdministratorsAsAccount(second.ada.id);

  // The fixtures' sessions issue the same identifiers, so Grace and Hopper share them too.
  await expectStatus(
    first.api.request(
      `${first.supergroupPath(first.grace.id)}/administrators/${first.hopper.id}`,
      jsonRequest('PUT', { can_promote_members: true }),
    ),
    204,
    'Expected Grace to promote Hopper in the first session',
  );

  expectEqual(
    [
      second.grace.id === first.grace.id && second.hopper.id === first.hopper.id,
      (await second.getAdministratorsAsAccount(second.ada.id)).body,
      await second.readUpdates(second.delegatingBot),
      await second.readUpdates(second.otherBot),
      (await second.getChatMember(second.delegatingBot, second.hopper.id)).status,
      (await first.getChatMember(first.delegatingBot, first.hopper.id)).status,
    ],
    [true, administratorsBefore.body, [], [], 'member', 'administrator'],
    'Expected the promotion to stay in the first session',
  );
});

Deno.test('a grammY bot promotes a member through its webhook, as the activity log shows', async () => {
  const { api, sessionPath, ada, hopper, delegatingBot, supergroup, promoteAsOwner } =
    await createPromotionFixture();
  await promoteAsOwner(delegatingBot.bot.id, {
    can_promote_members: true,
    can_pin_messages: true,
  });
  const grammyBot = new Bot(delegatingBot.token, {
    client: {
      apiRoot: `${TEST_PUBLIC_ORIGIN}${sessionPath}/bot-api`,
      fetch: async (input, init) => await api.fetch(new Request(input, init)),
    },
  });
  const promotionObserved = Promise.withResolvers<{ status: string; can_be_edited?: boolean }>();
  grammyBot.command('promote', async (context) => {
    const promotedUser = context.message?.reply_to_message?.from;
    if (promotedUser !== undefined) {
      await context.promoteChatMember(promotedUser.id, { can_pin_messages: true });
    }
  });
  grammyBot.on('chat_member', (context) => {
    promotionObserved.resolve(context.chatMember.new_chat_member);
  });
  const handleWebhookRequest = webhookCallback(grammyBot, 'std/http');
  const webhookServer = Deno.serve(
    { hostname: '127.0.0.1', port: 0, onListen: () => {} },
    (request) => handleWebhookRequest(request),
  );
  const sendAccountMessage = (accountId: number, content: object) =>
    requestJson<{ message?: { message_id: number } }>(
      api,
      'POST',
      `${sessionPath}/accounts/${accountId}/messages`,
      { to: { type: 'supergroup', chatId: supergroup.id }, ...content },
    );
  try {
    await grammyBot.api.setWebhook(`http://127.0.0.1:${webhookServer.addr.port}/webhook`, {
      allowed_updates: ['message', 'chat_member'],
    });
    const request = await sendAccountMessage(hopper.id, { text: 'May I pin?' });
    await sendAccountMessage(ada.id, {
      text: '/promote',
      reply_to_message_id: request.body.message?.message_id,
    });
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const observed = await Promise.race([
      promotionObserved.promise,
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(
          () => reject(new Error('Expected the bot to observe the promotion')),
          5_000,
        );
      }),
    ]).finally(() => clearTimeout(timeoutId));
    const activity = await requestJson<{ entries: Array<Record<string, unknown>> }>(
      api,
      'GET',
      `${sessionPath}/bot-activity?method=promoteChatMember`,
    );
    expectEqual(
      [observed.status, observed.can_be_edited],
      ['administrator', true],
      'Expected the bot to observe its promotion of the member, as its editor',
    );
    expectEqual(
      activity.body.entries.map(({ via, parameters, answer }) => [via, parameters, answer]),
      [[
        'http',
        { chat_id: String(supergroup.id), user_id: String(hopper.id), can_pin_messages: 'true' },
        { ok: true, result: true },
      ]],
      'Expected the activity log to record the promotion',
    );
  } finally {
    await api.request(sessionPath, { method: 'DELETE' });
    await webhookServer.shutdown();
  }
});

Deno.test('a bot titles an administrator it promoted, which every read shows, without updates', async () => {
  const {
    api,
    ada,
    hopper,
    delegatingBot,
    otherBot,
    supergroup,
    supergroupPath,
    promoteAsOwner,
    callBot,
    getChatMember,
    getAdministratorsAsAccount,
    readUpdates,
  } = await createPromotionFixture();
  await promoteAsOwner(otherBot.bot.id, { can_restrict_members: true });
  await promoteAsOwner(delegatingBot.bot.id, {
    can_promote_members: true,
    can_delete_messages: true,
  });
  const call = (method: string, parameters: object) =>
    callBot(delegatingBot, method, { chat_id: supergroup.id, user_id: hopper.id, ...parameters })
      .then(({ body }) => body.ok ? body.result : body.description);
  const titleOf = async () => [
    (await getChatMember(delegatingBot, hopper.id)).custom_title,
    ((await callBot(otherBot, 'getChatAdministrators', { chat_id: supergroup.id })).body
      .result as Array<{ user: { id: number }; custom_title?: string }>)
      .find(({ user }) => user.id === hopper.id)?.custom_title,
    (await getAdministratorsAsAccount(ada.id)).body.administrators
      .find(({ user_id }) => user_id === hopper.id)?.custom_title,
  ];
  await call('promoteChatMember', { can_delete_messages: true });
  for (const bot of [delegatingBot, otherBot]) {
    await readUpdates(bot);
  }

  // Telegram keeps the title stripped of surrounding spaces.
  const titling = await call('setChatAdministratorCustomTitle', { custom_title: '  Janitor  ' });
  const titled = await titleOf();
  const updatesAfterTitling = [await readUpdates(delegatingBot), await readUpdates(otherBot)];
  const rightsChange = await call('promoteChatMember', { can_promote_members: true });
  const titledAfterRightsChange = await titleOf();
  // A title of 16 characters outside the Basic Multilingual Plane is as long as Telegram allows.
  const longestTitle = '𝔸'.repeat(16);
  const longestTitling = await call('setChatAdministratorCustomTitle', {
    custom_title: longestTitle,
  });
  const longestTitled = (await getChatMember(delegatingBot, hopper.id)).custom_title;
  // A missing title removes it, as an empty one does.
  const removal = await call('setChatAdministratorCustomTitle', {});
  const untitled = await titleOf();
  await call('setChatAdministratorCustomTitle', { custom_title: 'Janitor' });
  const demotion = await call('promoteChatMember', {});
  await call('promoteChatMember', { can_delete_messages: true });
  const titleAfterDemotion = await titleOf();
  // The owner's titles, set with channels.editAdmin, still reach administrator bots.
  await readUpdates(otherBot);
  await expectStatus(
    api.request(
      `${supergroupPath(ada.id)}/administrators/${hopper.id}/custom-title`,
      jsonRequest('PUT', { custom_title: ' Lead ' }),
    ),
    204,
    'Expected the owner to title Hopper',
  );
  const titledByOwner = await titleOf();
  const ownerTitleUpdates = describeMembershipUpdates(await readUpdates(otherBot));

  expectEqual(
    [titling, rightsChange, longestTitling, removal, demotion],
    [true, true, true, true, true],
    'Expected each call to succeed',
  );
  expectEqual(titled, ['Janitor', 'Janitor', 'Janitor'], 'Expected every read to show the title');
  expectEqual(updatesAfterTitling, [[], []], 'Expected no update for a title change');
  expectEqual(
    titledAfterRightsChange,
    ['Janitor', 'Janitor', 'Janitor'],
    'Expected the title to outlast a change of rights',
  );
  expectEqual(longestTitled, longestTitle, 'Expected the longest title to be kept whole');
  expectEqual(untitled, [undefined, undefined, undefined], 'Expected the title to be removed');
  expectEqual(
    titleAfterDemotion,
    [undefined, undefined, undefined],
    'Expected a demotion to drop the title',
  );
  expectEqual(titledByOwner, ['Lead', 'Lead', 'Lead'], 'Expected the owner to title Hopper');
  expectEqual(
    ownerTitleUpdates,
    [`chat_member ${hopper.id}: administrator(fixed) -> administrator(fixed)`],
    "Expected the owner's title to reach administrator bots",
  );
});

Deno.test('setChatAdministratorCustomTitle refuses what Telegram refuses, without changing anything', async () => {
  const {
    ada,
    grace,
    hopper,
    linus,
    delegatingBot,
    otherBot,
    supergroup,
    callBot,
    getChatMember,
  } = await createPromotionFixture();
  const setTitle = async (actor: FixtureBot, parameters: Record<string, unknown>) => {
    const { status, body } = await callBot(actor, 'setChatAdministratorCustomTitle', parameters);
    return [status, body.ok ? body.result : body.description];
  };
  const forHopper = (customTitle: string) => ({
    chat_id: supergroup.id,
    user_id: hopper.id,
    custom_title: customTitle,
  });
  await callBot(delegatingBot, 'promoteChatMember', {
    chat_id: supergroup.id,
    user_id: hopper.id,
    can_promote_members: true,
  });
  await setTitle(delegatingBot, forHopper('Janitor'));

  const refusals = [
    await setTitle(delegatingBot, { chat_id: supergroup.id, custom_title: 'Janitor' }),
    await setTitle(delegatingBot, { user_id: hopper.id, custom_title: 'Janitor' }),
    await setTitle(delegatingBot, { chat_id: linus.id, user_id: linus.id, custom_title: 'Boss' }),
    await setTitle(delegatingBot, { chat_id: supergroup.id, user_id: 999_999 }),
    await setTitle(delegatingBot, { chat_id: supergroup.id, user_id: ada.id, custom_title: 'X' }),
    await setTitle(delegatingBot, { chat_id: supergroup.id, user_id: linus.id, custom_title: 'X' }),
    // Grace was promoted by the owner, and the other bot promoted nobody.
    await setTitle(delegatingBot, { chat_id: supergroup.id, user_id: grace.id, custom_title: 'X' }),
    await setTitle(otherBot, forHopper('X')),
    await setTitle(delegatingBot, forHopper('Seventeen letters')),
    await setTitle(delegatingBot, forHopper('Thumbs 👍')),
    await setTitle(delegatingBot, forHopper('From 🇫🇷')),
    await setTitle(delegatingBot, forHopper('Press 1\ufe0f\u20e3')),
    await setTitle(delegatingBot, forHopper('Tone \u{1F3FB}')),
    await setTitle(delegatingBot, forHopper('Broken \ud800')),
  ];

  expectEqual(
    refusals,
    [
      [400, 'Bad Request: invalid user_id specified'],
      [400, 'Bad Request: chat_id is empty'],
      [400, 'Bad Request: chat not found'],
      [400, 'Bad Request: member not found'],
      [400, 'Bad Request: only the owner can edit their custom title'],
      [400, 'Bad Request: user is not an administrator'],
      [400, 'Bad Request: not enough rights to change custom title of the user'],
      [400, 'Bad Request: not enough rights to change custom title of the user'],
      [400, 'Bad Request: CUSTOM_TITLE_INVALID'],
      [400, 'Bad Request: CUSTOM_TITLE_EMOJI_NOT_ALLOWED'],
      [400, 'Bad Request: CUSTOM_TITLE_EMOJI_NOT_ALLOWED'],
      [400, 'Bad Request: CUSTOM_TITLE_EMOJI_NOT_ALLOWED'],
      [400, 'Bad Request: CUSTOM_TITLE_EMOJI_NOT_ALLOWED'],
      [400, 'Bad Request: strings must be encoded in UTF-8'],
    ],
    'Expected Telegram errors',
  );
  expectEqual(
    [
      (await getChatMember(delegatingBot, hopper.id)).custom_title,
      (await getChatMember(delegatingBot, grace.id)).custom_title,
    ],
    ['Janitor', undefined],
    'Expected no title to change',
  );
});

Deno.test('custom titles keep the symbols Telegram Desktop keeps and lose its emoji', async () => {
  const { hopper, delegatingBot, supergroup, callBot, getChatMember } =
    await createPromotionFixture();
  const promotion = await callBot(delegatingBot, 'promoteChatMember', {
    chat_id: supergroup.id,
    user_id: hopper.id,
    can_promote_members: true,
  });
  expectEqual(promotion.body.result, true, 'Expected the bot to promote Hopper');
  const setTitle = async (customTitle: string) => {
    const { body } = await callBot(delegatingBot, 'setChatAdministratorCustomTitle', {
      chat_id: supergroup.id,
      user_id: hopper.id,
      custom_title: customTitle,
    });
    return body.ok ? body.result : body.description;
  };
  // Pictographs without Unicode's Emoji property, ©, ® and ™ in text presentation, and the
  // characters that are emoji only as keycap bases.
  const acceptedTitles = ['Star ★', 'Helm ⎈', 'Queen ♛', 'Note ♪', 'Tile 🀰', '© ® ™', '123#*'];
  const accepted = [];
  for (const title of acceptedTitles) {
    accepted.push([
      await setTitle(title),
      (await getChatMember(delegatingBot, hopper.id)).custom_title,
    ]);
  }
  const refusedTitles = [
    'Smile 🙂',
    'Copy \u{A9}\u{FE0F}',
    'Mark \u{2122}\u{FE0F}',
    // An emoji without the emoji presentation selector is still one.
    'Both \u{2194}',
    'Both \u{2194}\u{FE0F}',
    'Love \u{2764}',
    'Key 1\u{20E3}',
    'Key 1\u{FE0F}\u{20E3}',
    'From 🇸🇬',
    'Family \u{1F468}\u{200D}\u{1F469}\u{200D}\u{1F467}',
    'Tone \u{1F3FB}',
    // The flag of Scotland, a tag sequence.
    'Flag \u{1F3F4}\u{E0067}\u{E0062}\u{E0073}\u{E0063}\u{E0074}\u{E007F}',
    // Telegram Desktop keeps a lone flag letter, which the emulator refuses.
    'Letter \u{1F1F8}',
  ];
  const refused = [];
  for (const title of refusedTitles) {
    refused.push(await setTitle(title));
  }
  // The length is checked before the emoji.
  const tooLongWithEmoji = await setTitle('🙂'.repeat(17));

  expectEqual(
    accepted,
    acceptedTitles.map((title) => [true, title]),
    'Expected symbols without emoji to be kept',
  );
  expectEqual(
    refused,
    refusedTitles.map(() => 'Bad Request: CUSTOM_TITLE_EMOJI_NOT_ALLOWED'),
    'Expected emoji to be refused',
  );
  expectEqual(tooLongWithEmoji, 'Bad Request: CUSTOM_TITLE_INVALID', 'Expected length first');
  expectEqual(
    (await getChatMember(delegatingBot, hopper.id)).custom_title,
    '123#*',
    'Expected refused titles to change nothing',
  );
});

/**
 * Runs the reported sequence: the owner gave the delegating bot the right to promote, the bot
 * promotes the other bot with that right, demotes itself, and the other bot promotes it back.
 * With an observer, an administrator bot subscribed to membership updates watches every change.
 */
async function runDemotedPromoterRepromotion({ withObserver }: { withObserver: boolean }) {
  const fixture = await createPromotionFixture();
  const { ada, delegatingBot, otherBot, supergroup, supergroupPath, api, callBot, readUpdates } =
    fixture;
  const observerBot = withObserver ? await fixture.createBot('observer_bot') : undefined;
  if (observerBot !== undefined) {
    await expectStatus(
      api.request(`${supergroupPath(ada.id)}/members/${observerBot.bot.id}`, { method: 'PUT' }),
      204,
      'Expected the observer bot to be added',
    );
    await fixture.promoteAsOwner(observerBot.bot.id, { can_invite_users: true });
    await readUpdates(observerBot);
  }
  const promote = async (actor: FixtureBot, userId: number, rights: Record<string, boolean>) => {
    const { status, body } = await callBot(actor, 'promoteChatMember', {
      chat_id: supergroup.id,
      user_id: userId,
      ...rights,
    });
    return [status, body.ok ? body.result : body.description];
  };

  const steps = [
    await promote(delegatingBot, otherBot.bot.id, { can_promote_members: true }),
    await promote(delegatingBot, delegatingBot.bot.id, {}),
    await promote(otherBot, delegatingBot.bot.id, { can_promote_members: true }),
  ];
  return { ...fixture, observerBot, promote, steps };
}

/** The `can_be_edited` of the given administrators, keyed by user ID, as a bot sees it. */
async function readEditabilityAsBot(
  callBot: (bot: FixtureBot, method: string, parameters: object) => Promise<{
    status: number;
    body: BotApiResponse;
  }>,
  observer: FixtureBot,
  chatId: number,
  administratorIds: readonly number[],
) {
  const { status, body } = await callBot(observer, 'getChatAdministrators', {
    chat_id: chatId,
    return_bots: true,
  });
  return [
    status,
    Object.fromEntries(
      (body.result as Array<{ user: { id: number }; can_be_edited?: boolean }>)
        .filter(({ user }) => administratorIds.includes(user.id))
        .map(({ user, can_be_edited }) => [user.id, can_be_edited]),
    ),
  ];
}

for (const withObserver of [false, true]) {
  Deno.test(
    `a demoted promoter promoted back by its appointee revives no delegation${
      withObserver ? ', while another administrator bot observes' : ''
    }`,
    async () => {
      const {
        ada,
        delegatingBot,
        otherBot,
        supergroup,
        observerBot,
        promote,
        steps,
        callBot,
        readUpdates,
        getAdministratorsAsAccount,
      } = await runDemotedPromoterRepromotion({ withObserver });
      const delegatingBotId = delegatingBot.bot.id;
      const otherBotId = otherBot.bot.id;
      const bots = [delegatingBotId, otherBotId];

      expectEqual(steps, Array(3).fill([200, true]), 'Expected every step to succeed');
      // The delegating bot's link to its promoter is new; the other bot's link names the tenure the
      // delegating bot ended, so only the other bot edits, and nobody edits itself.
      expectEqual(
        [
          await readEditabilityAsBot(callBot, delegatingBot, supergroup.id, bots),
          await readEditabilityAsBot(callBot, otherBot, supergroup.id, bots),
        ],
        [
          [200, { [delegatingBotId]: false, [otherBotId]: false }],
          [200, { [delegatingBotId]: true, [otherBotId]: false }],
        ],
        'Expected the bots to agree on who edits whom',
      );
      const asOwnerSees = (await getAdministratorsAsAccount(ada.id)).body.administrators
        .filter(({ user_id }) => bots.includes(user_id as number))
        .map(({ user_id, promoted_by_user_id, can_be_edited }) => [
          user_id,
          promoted_by_user_id,
          can_be_edited,
        ]);
      expectEqual(
        asOwnerSees,
        [[delegatingBotId, otherBotId, true], [otherBotId, delegatingBotId, true]],
        'Expected each promoted_by to name who promoted the bot, and the owner to edit both',
      );
      if (observerBot !== undefined) {
        expectEqual(
          describeMembershipUpdates(await readUpdates(observerBot)),
          [
            `chat_member ${otherBotId}: member -> administrator(fixed)`,
            `chat_member ${delegatingBotId}: administrator(fixed) -> member`,
            `chat_member ${delegatingBotId}: member -> administrator(fixed)`,
          ],
          'Expected the observer to receive every change',
        );
      }

      // The delegating bot may no longer demote the other bot, and the refusal changes nothing.
      const administratorsBefore = (await getAdministratorsAsAccount(ada.id)).body;
      expectEqual(
        [
          await promote(delegatingBot, otherBotId, {}),
          await promote(delegatingBot, otherBotId, { can_promote_members: true }),
          await promote(otherBot, otherBotId, { can_promote_members: true }),
        ],
        [
          [400, 'Bad Request: user is an administrator of the chat'],
          [400, 'Bad Request: user is an administrator of the chat'],
          [400, "Bad Request: can't promote self"],
        ],
        'Expected the stale link to grant nothing',
      );
      expectEqual(
        (await getAdministratorsAsAccount(ada.id)).body,
        administratorsBefore,
        'Expected the refusals to change nothing',
      );
      if (observerBot !== undefined) {
        expectEqual(await readUpdates(observerBot), [], 'Expected no update for a refusal');
      }
    },
  );
}
