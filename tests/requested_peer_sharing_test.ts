import {
  resolveSharedChat,
  resolveSharedUsers,
  type SharedPeerLookups,
} from '../src/services/requested_peer_sharing.ts';
import {
  type ChatAdministratorRightName,
  normalizeDefaultAdministratorRights,
} from '../src/types/bot_default_administrator_rights.ts';
import { ALL_CHAT_PERMISSIONS } from '../src/types/chat_permissions.ts';
import type { ChatMembership } from '../src/types/chat_membership.ts';
import type {
  ReplyKeyboardChatRequest,
  ReplyKeyboardUsersRequest,
} from '../src/types/reply_interface.ts';
import type { SharedChat, Supergroup } from '../src/types/virtual_chat.ts';

const ADA_ID = 1;
const GRACE_ID = 2;
const LINUS_ID = 3;
const BOT_ID = 10;
const HELPER_BOT_ID = 11;
const PRIVATE_GROUP_ID = -1_000_000_000_001;
const PUBLIC_GROUP_ID = -1_000_000_000_002;
const CHANNEL_ID = -1_000_000_000_003;

const ACCOUNTS = [
  account(ADA_ID, { first_name: 'Ada', last_name: 'Lovelace', username: 'ada' }),
  account(GRACE_ID, { first_name: 'Grace' }),
  account(LINUS_ID, { first_name: 'Linus', username: 'linus' }),
];
const BOTS = [
  bot(BOT_ID, 'Sharing Bot', 'sharing_bot'),
  bot(HELPER_BOT_ID, 'Helper Bot', 'helper_bot'),
];

const USERS_REQUEST: ReplyKeyboardUsersRequest = {
  kind: 'users',
  requestId: 7,
  maxQuantity: 2,
  requestsName: false,
  requestsUsername: false,
  requestsPhoto: false,
};

const CHAT_REQUEST: ReplyKeyboardChatRequest = {
  kind: 'chat',
  requestId: 8,
  chatIsChannel: false,
  chatIsCreated: false,
  botIsMember: false,
  requestsTitle: false,
  requestsUsername: false,
  requestsPhoto: false,
};

const CONVERSATION = { accountId: GRACE_ID, botId: BOT_ID };

Deno.test('shared users carry only the details the request asks for, as they are now', () => {
  const lookups = createLookups();
  const idsOnly = resolveSharedUsers(USERS_REQUEST, [ADA_ID, BOT_ID], lookups);
  expectEqual(idsOnly, {
    resolved: true,
    content: {
      kind: 'users_shared',
      requestId: 7,
      users: [{ userId: ADA_ID }, { userId: BOT_ID }],
    },
  }, 'Expected unrequested details to stay omitted');

  const named = resolveSharedUsers(
    { ...USERS_REQUEST, requestsName: true },
    [GRACE_ID, ADA_ID],
    lookups,
  );
  expectEqual(named, {
    resolved: true,
    content: {
      kind: 'users_shared',
      requestId: 7,
      users: [
        { userId: GRACE_ID, firstName: 'Grace' },
        { userId: ADA_ID, firstName: 'Ada', lastName: 'Lovelace' },
      ],
    },
  }, 'Expected names without usernames, in the order chosen');

  const withUsernames = resolveSharedUsers(
    { ...USERS_REQUEST, requestsUsername: true, requestsPhoto: true },
    [GRACE_ID, LINUS_ID],
    lookups,
  );
  expectEqual(withUsernames, {
    resolved: true,
    content: {
      kind: 'users_shared',
      requestId: 7,
      users: [{ userId: GRACE_ID }, { userId: LINUS_ID, username: 'linus' }],
    },
  }, 'Expected usernames only of users that have one, and no photos');
});

Deno.test('shared users are refused as TDLib checks them, and repeats as the emulator does', () => {
  const lookups = createLookups();
  const cases: Array<[ReplyKeyboardUsersRequest, number[], string]> = [
    [USERS_REQUEST, [ADA_ID, GRACE_ID, LINUS_ID], 'shared_users_too_many'],
    [USERS_REQUEST, [ADA_ID, ADA_ID], 'shared_users_duplicated'],
    [USERS_REQUEST, [ADA_ID, 99], 'shared_user_not_found'],
    [{ ...USERS_REQUEST, userIsBot: false }, [ADA_ID, BOT_ID], 'shared_user_kind_mismatch'],
    [{ ...USERS_REQUEST, userIsBot: true }, [HELPER_BOT_ID, ADA_ID], 'shared_user_kind_mismatch'],
    [
      { ...USERS_REQUEST, userIsPremium: true },
      [ADA_ID],
      'reply_keyboard_button_request_unsupported',
    ],
  ];
  for (const [request, userIds, expectedReason] of cases) {
    const resolution = resolveSharedUsers(request, userIds, lookups);
    expectEqual(
      resolution,
      { resolved: false, reason: expectedReason },
      `Expected ${JSON.stringify(userIds)} to be refused`,
    );
  }

  const bots = resolveSharedUsers(
    { ...USERS_REQUEST, userIsBot: true, userIsPremium: false },
    [HELPER_BOT_ID, BOT_ID],
    lookups,
  );
  if (!bots.resolved) {
    throw new Error(`Expected bots, which are never Premium, to be shared: ${bots.reason}`);
  }
});

Deno.test('a shared chat carries only the details the request asks for', () => {
  const lookups = createLookups({
    memberships: [[PUBLIC_GROUP_ID, GRACE_ID, { status: 'member' }]],
  });
  expectEqual(
    resolveSharedChat(CHAT_REQUEST, PUBLIC_GROUP_ID, CONVERSATION, lookups),
    { resolved: true, content: { kind: 'chat_shared', requestId: 8, chatId: PUBLIC_GROUP_ID } },
    'Expected unrequested details to stay omitted',
  );
  expectEqual(
    resolveSharedChat(
      { ...CHAT_REQUEST, requestsTitle: true, requestsUsername: true, requestsPhoto: true },
      PUBLIC_GROUP_ID,
      CONVERSATION,
      lookups,
    ),
    {
      resolved: true,
      content: {
        kind: 'chat_shared',
        requestId: 8,
        chatId: PUBLIC_GROUP_ID,
        title: 'Public Group',
        username: 'public_group',
      },
    },
    'Expected the requested title and username, and no photo',
  );
  const privateGroup = resolveSharedChat(
    { ...CHAT_REQUEST, requestsUsername: true },
    PRIVATE_GROUP_ID,
    { accountId: ADA_ID, botId: BOT_ID },
    lookups,
  );
  expectEqual(
    privateGroup,
    { resolved: true, content: { kind: 'chat_shared', requestId: 8, chatId: PRIVATE_GROUP_ID } },
    'Expected a private supergroup to share no username',
  );
});

Deno.test('a shared chat must meet the criteria TDLib checks for a supergroup', () => {
  const lookups = createLookups({
    memberships: [
      [PUBLIC_GROUP_ID, GRACE_ID, administrator('can_pin_messages', 'can_invite_users')],
      [PUBLIC_GROUP_ID, BOT_ID, { status: 'member' }],
      [PRIVATE_GROUP_ID, GRACE_ID, restrictedMember()],
    ],
  });
  const cases: Array<[ReplyKeyboardChatRequest, number, string]> = [
    [CHAT_REQUEST, -1_000_000_000_099, 'shared_chat_not_found'],
    [CHAT_REQUEST, CHANNEL_ID, 'shared_chat_not_found'],
    [{ ...CHAT_REQUEST, chatHasUsername: false }, PUBLIC_GROUP_ID, 'shared_chat_username_mismatch'],
    [{ ...CHAT_REQUEST, chatHasUsername: true }, PRIVATE_GROUP_ID, 'shared_chat_username_mismatch'],
    [{ ...CHAT_REQUEST, chatIsCreated: true }, PUBLIC_GROUP_ID, 'shared_chat_not_created'],
    [
      { ...CHAT_REQUEST, userAdministratorRights: rights('can_promote_members') },
      PUBLIC_GROUP_ID,
      'user_administrator_rights_missing',
    ],
    [
      { ...CHAT_REQUEST, userAdministratorRights: rights('can_pin_messages') },
      PRIVATE_GROUP_ID,
      'user_administrator_rights_missing',
    ],
    [{ ...CHAT_REQUEST, botIsMember: true }, PRIVATE_GROUP_ID, 'bot_not_member'],
    [
      { ...CHAT_REQUEST, botAdministratorRights: rights('can_pin_messages') },
      PUBLIC_GROUP_ID,
      'bot_administrator_rights_missing',
    ],
  ];
  for (const [request, chatId, expectedReason] of cases) {
    expectEqual(
      resolveSharedChat(request, chatId, CONVERSATION, lookups),
      { resolved: false, reason: expectedReason },
      `Expected supergroup ${chatId} to be refused for ${JSON.stringify(request)}`,
    );
  }

  const met = resolveSharedChat(
    {
      ...CHAT_REQUEST,
      chatHasUsername: true,
      userAdministratorRights: rights('can_pin_messages'),
      botIsMember: true,
    },
    PUBLIC_GROUP_ID,
    CONVERSATION,
    lookups,
  );
  if (!met.resolved) {
    throw new Error(
      `Expected an administrator to share a chat that meets the request: ${met.reason}`,
    );
  }
});

Deno.test('the owner holds every right, and a created chat skips the account rights check', () => {
  const lookups = createLookups({
    memberships: [
      [PRIVATE_GROUP_ID, BOT_ID, administrator('can_delete_messages', 'can_invite_users')],
    ],
  });
  const ownerConversation = { accountId: ADA_ID, botId: BOT_ID };
  const created = resolveSharedChat(
    {
      ...CHAT_REQUEST,
      chatIsCreated: true,
      userAdministratorRights: rights('can_promote_members', 'can_change_info', 'is_anonymous'),
      botAdministratorRights: rights('can_delete_messages'),
      botIsMember: true,
    },
    PRIVATE_GROUP_ID,
    ownerConversation,
    lookups,
  );
  if (!created.resolved) {
    throw new Error(`Expected the owner's own chat to meet the request: ${created.reason}`);
  }
  const ownerRights = resolveSharedChat(
    { ...CHAT_REQUEST, userAdministratorRights: rights('can_promote_members', 'can_manage_tags') },
    PRIVATE_GROUP_ID,
    ownerConversation,
    lookups,
  );
  if (!ownerRights.resolved) {
    throw new Error(`Expected the owner to hold every supergroup right: ${ownerRights.reason}`);
  }
});

Deno.test('chat requests for what the emulator does not model are refused as unsupported', () => {
  const lookups = createLookups();
  const ownerConversation = { accountId: ADA_ID, botId: BOT_ID };
  const unsupportedRequests: ReplyKeyboardChatRequest[] = [
    { ...CHAT_REQUEST, chatIsChannel: true },
    { ...CHAT_REQUEST, chatIsForum: true },
    { ...CHAT_REQUEST, userAdministratorRights: rights('is_anonymous') },
    { ...CHAT_REQUEST, chatIsCreated: true, botAdministratorRights: rights('is_anonymous') },
  ];
  for (const request of unsupportedRequests) {
    expectEqual(
      resolveSharedChat(request, PRIVATE_GROUP_ID, ownerConversation, lookups),
      { resolved: false, reason: 'reply_keyboard_button_request_unsupported' },
      `Expected ${JSON.stringify(request)} to be unsupported`,
    );
  }
  const notForum = resolveSharedChat(
    { ...CHAT_REQUEST, chatIsForum: false },
    PRIVATE_GROUP_ID,
    ownerConversation,
    lookups,
  );
  if (!notForum.resolved) {
    throw new Error(`Expected a request for a chat that is no forum to be met: ${notForum.reason}`);
  }
});

function createLookups(
  { memberships = [] }: {
    readonly memberships?: ReadonlyArray<readonly [number, number, ChatMembership]>;
  } = {},
): SharedPeerLookups {
  const chats: readonly SharedChat[] = [
    supergroup(PRIVATE_GROUP_ID, 'Private Group'),
    supergroup(PUBLIC_GROUP_ID, 'Public Group', 'public_group'),
    { kind: 'channel', id: CHANNEL_ID, title: 'Channel' },
  ];
  const membershipsByKey = new Map<string, ChatMembership>([
    [`${PRIVATE_GROUP_ID}:${ADA_ID}`, { status: 'owner' }],
    [`${PUBLIC_GROUP_ID}:${ADA_ID}`, { status: 'owner' }],
    [`${CHANNEL_ID}:${GRACE_ID}`, { status: 'owner' }],
    ...memberships.map(([chatId, userId, membership]): [string, ChatMembership] => [
      `${chatId}:${userId}`,
      membership,
    ]),
  ]);
  return {
    accounts: { getById: (id) => ACCOUNTS.find(({ profile }) => profile.id === id) },
    bots: { getById: (id) => BOTS.find(({ profile }) => profile.id === id) },
    sharedChats: {
      getSharedChat: (chatId) => chats.find(({ id }) => id === chatId),
      getChatMembership: (chatId, userId) => membershipsByKey.get(`${chatId}:${userId}`),
    },
  };
}

function account(
  id: number,
  names: { first_name: string; last_name?: string; username?: string },
) {
  return { profile: { id, is_bot: false, ...names } };
}

function bot(id: number, firstName: string, username: string) {
  return { profile: { id, is_bot: true, first_name: firstName, username } };
}

function supergroup(id: number, title: string, username?: string): Supergroup {
  return {
    kind: 'supergroup',
    id,
    title,
    ...(username === undefined ? {} : { username }),
    chatInstance: '1',
    hasProtectedContent: false,
    defaultPermissions: ALL_CHAT_PERMISSIONS,
  };
}

function administrator(
  ...grantedRights: Array<'can_pin_messages' | 'can_invite_users' | 'can_delete_messages'>
): ChatMembership {
  return {
    status: 'administrator',
    rights: new Set(['can_manage_chat', ...grantedRights]),
    tenureId: 1,
    promotedById: ADA_ID,
  };
}

function restrictedMember(): ChatMembership {
  return { status: 'restricted', isMember: true, permissions: new Set() };
}

function rights(...requestedRights: ChatAdministratorRightName[]) {
  return normalizeDefaultAdministratorRights('group', requestedRights);
}

function expectEqual(actual: unknown, expected: unknown, message: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `${message}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`,
    );
  }
}
