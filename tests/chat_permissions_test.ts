import {
  type ChatMembership,
  type ChatMemberStatus,
  getEffectiveChatPermissions,
  grantSupergroupAdministratorRights,
  isChatAdministrator,
  isChatMember,
  isSameChatMemberStatus,
} from '../src/types/chat_membership.ts';
import {
  ALL_CHAT_PERMISSIONS,
  CHAT_PERMISSIONS,
  type ChatPermission,
  type ChatPermissions,
  getContentSendPermissions,
} from '../src/types/chat_permissions.ts';
import type { RichBlock } from '../src/types/rich_message.ts';

Deno.test('getEffectiveChatPermissions exempts the owner and administrators from restrictions', () => {
  const defaultPermissions: ChatPermissions = new Set();
  const owner: ChatMembership = { status: 'owner' };
  const administrator: ChatMembership = {
    status: 'administrator',
    rights: grantSupergroupAdministratorRights(['can_pin_messages']),
  };

  assertPermissions(
    getEffectiveChatPermissions(owner, { defaultPermissions, isBot: false }),
    CHAT_PERMISSIONS,
    'the owner',
  );
  // An administrator sends anything, but holds only the administrator rights it was granted.
  const sendingPermissions = CHAT_PERMISSIONS.filter((permission) =>
    !['can_change_info', 'can_invite_users', 'can_pin_messages', 'can_manage_topics'].includes(
      permission,
    )
  );
  for (const isBot of [false, true]) {
    assertPermissions(
      getEffectiveChatPermissions(administrator, { defaultPermissions, isBot }),
      [...sendingPermissions, 'can_pin_messages'],
      `an administrator that ${isBot ? 'is' : 'is not'} a bot`,
    );
  }
});

Deno.test('getEffectiveChatPermissions grants default permissions that are rights only to accounts', () => {
  const defaultPermissions: ChatPermissions = new Set([
    'can_send_messages',
    'can_change_info',
    'can_invite_users',
  ]);
  const administrator: ChatMembership = {
    status: 'administrator',
    rights: grantSupergroupAdministratorRights(['can_delete_messages']),
  };
  const member: ChatMembership = { status: 'member' };

  const administratorAccount = getEffectiveChatPermissions(administrator, {
    defaultPermissions,
    isBot: false,
  });
  const administratorBot = getEffectiveChatPermissions(administrator, {
    defaultPermissions,
    isBot: true,
  });
  if (
    !administratorAccount.has('can_change_info') || !administratorAccount.has('can_invite_users') ||
    administratorBot.has('can_change_info') || administratorBot.has('can_invite_users')
  ) {
    throw new Error('Expected default permissions that are rights to extend to accounts only');
  }
  assertPermissions(
    getEffectiveChatPermissions(member, { defaultPermissions, isBot: false }),
    ['can_send_messages', 'can_change_info', 'can_invite_users'],
    'a member account',
  );
  assertPermissions(
    getEffectiveChatPermissions(member, { defaultPermissions, isBot: true }),
    ['can_send_messages'],
    'a member bot',
  );
});

Deno.test('getEffectiveChatPermissions grants a restricted member what both its restriction and the defaults grant', () => {
  const restricted: ChatMembership = {
    status: 'restricted',
    isMember: true,
    permissions: new Set(['can_send_messages', 'can_send_photos', 'can_pin_messages']),
  };
  const defaultPermissions: ChatPermissions = new Set(
    CHAT_PERMISSIONS.filter((permission) => permission !== 'can_send_photos'),
  );

  assertPermissions(
    getEffectiveChatPermissions(restricted, { defaultPermissions, isBot: false }),
    ['can_send_messages', 'can_pin_messages'],
    'a restricted account',
  );
  assertPermissions(
    getEffectiveChatPermissions(restricted, { defaultPermissions, isBot: true }),
    ['can_send_messages'],
    'a restricted bot',
  );
  assertPermissions(
    getEffectiveChatPermissions({ status: 'member' }, {
      defaultPermissions: ALL_CHAT_PERMISSIONS,
      isBot: false,
    }),
    CHAT_PERMISSIONS,
    'a member of an unrestricted supergroup',
  );
});

Deno.test('getContentSendPermissions requires a permission per kind and every rich message file', () => {
  const photoBlock: RichBlock<{ readonly photo: string; readonly document: string }> = {
    kind: 'photo',
    photo: 'photo-file',
    hasSpoiler: false,
  };
  const documentBlock: RichBlock<{ readonly photo: string; readonly document: string }> = {
    kind: 'document',
    document: 'document-file',
  };
  const cases: Array<[Parameters<typeof getContentSendPermissions>[0], ChatPermission[]]> = [
    [{ kind: 'text' }, ['can_send_messages']],
    [{ kind: 'photo' }, ['can_send_photos']],
    [{ kind: 'document' }, ['can_send_documents']],
    [{ kind: 'video' }, ['can_send_videos']],
    [{ kind: 'voice' }, ['can_send_voice_notes']],
    [{ kind: 'poll' }, ['can_send_polls']],
    [{ kind: 'rich_message', richMessage: { blocks: [], isRightToLeft: false } }, [
      'can_send_messages',
    ]],
    [
      {
        kind: 'rich_message',
        richMessage: { blocks: [photoBlock, documentBlock, photoBlock], isRightToLeft: false },
      },
      ['can_send_messages', 'can_send_photos', 'can_send_documents'],
    ],
  ];
  const received = cases.map(([content]) => getContentSendPermissions(content));
  const expected = cases.map(([, permissions]) => permissions);
  if (JSON.stringify(received) !== JSON.stringify(expected)) {
    throw new Error(`Expected ${JSON.stringify(expected)}, received ${JSON.stringify(received)}`);
  }
});

Deno.test('a restricted user is a member while it is in the chat, and no administrator', () => {
  const permissions: ChatPermissions = new Set(['can_send_messages']);
  const restrictedMember: ChatMemberStatus = { status: 'restricted', isMember: true, permissions };
  const restrictedNonMember: ChatMemberStatus = {
    status: 'restricted',
    isMember: false,
    permissions,
  };

  if (
    !isChatMember(restrictedMember) || isChatMember(restrictedNonMember) ||
    isChatAdministrator(restrictedMember) || isChatMember({ status: 'left' }) ||
    isChatMember({ status: 'kicked' }) || !isChatMember({ status: 'member' })
  ) {
    throw new Error('Expected only a restricted user in the chat to be a member');
  }
  const sameRestriction: ChatMemberStatus = {
    ...restrictedMember,
    permissions: new Set(['can_send_messages']),
  };
  if (
    !isSameChatMemberStatus(restrictedMember, sameRestriction) ||
    isSameChatMemberStatus(restrictedMember, restrictedNonMember) ||
    isSameChatMemberStatus(restrictedMember, { ...restrictedMember, permissions: new Set() }) ||
    isSameChatMemberStatus(restrictedMember, {
      ...restrictedMember,
      restrictedUntilUnixSeconds: 1_700_000_000,
    })
  ) {
    throw new Error('Expected restrictions to compare by membership, permissions and end');
  }
});

function assertPermissions(
  received: ChatPermissions,
  expected: readonly ChatPermission[],
  holder: string,
): void {
  const receivedNames = CHAT_PERMISSIONS.filter((permission) => received.has(permission));
  const expectedNames = CHAT_PERMISSIONS.filter((permission) => expected.includes(permission));
  if (JSON.stringify(receivedNames) !== JSON.stringify(expectedNames)) {
    throw new Error(
      `Expected ${holder} to hold ${JSON.stringify(expectedNames)}, received ${
        JSON.stringify(receivedNames)
      }`,
    );
  }
}
