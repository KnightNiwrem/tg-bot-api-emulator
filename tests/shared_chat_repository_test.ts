import {
  type BasicGroupRegistrationFailureReason,
  type BasicGroupRegistrationResult,
  type ChatMemberAdditionFailureReason,
  type ChatMemberAdditionResult,
  SharedChatRepository,
} from '../src/repositories/shared_chat.ts';
import { ALL_CHAT_PERMISSIONS, CHAT_PERMISSIONS } from '../src/types/chat_permissions.ts';

Deno.test('SharedChatRepository atomically registers a basic group and its initial memberships', () => {
  const sharedChats = new SharedChatRepository();
  const group = { kind: 'basic_group', id: -1, title: 'Test Group' } as const;

  const result = sharedChats.registerBasicGroup(group, 1, [2]);
  if (!result.registered) {
    throw new Error(`Expected group registration to succeed, received ${result.reason}`);
  }
  if (sharedChats.getSharedChat(group.id) !== group) {
    throw new Error('Expected the registered group to be retrievable by ID');
  }
  if (
    sharedChats.getChatMembership(group.id, 1)?.status !== 'owner' ||
    sharedChats.getChatMembership(group.id, 2)?.status !== 'member'
  ) {
    throw new Error('Expected the group memberships to be stored with the chat');
  }
});

Deno.test('SharedChatRepository rejects non-unique basic-group members without storing the chat', () => {
  const sharedChats = new SharedChatRepository();
  const group = { kind: 'basic_group', id: -1, title: 'Test Group' } as const;

  const ownerRepeatedAsMember = sharedChats.registerBasicGroup(group, 1, [1]);
  assertRegistrationFailure(ownerRepeatedAsMember, 'initial_members_not_unique');

  const duplicateMembers = sharedChats.registerBasicGroup(group, 1, [2, 2]);
  assertRegistrationFailure(duplicateMembers, 'initial_members_not_unique');

  if (sharedChats.getSharedChat(group.id) !== undefined) {
    throw new Error('Expected rejected registration not to store partial chat state');
  }
});

Deno.test('SharedChatRepository registers supergroups and channels with their required owner', () => {
  const sharedChats = new SharedChatRepository();
  const supergroup = {
    kind: 'supergroup',
    id: -1_000_000_000_001,
    title: 'Test',
    chatInstance: '-42',
    hasProtectedContent: false,
    defaultPermissions: ALL_CHAT_PERMISSIONS,
  } as const;
  const channel = { kind: 'channel', id: -1_000_000_000_002, title: 'Test' } as const;

  const results = [
    sharedChats.registerSupergroup(supergroup, 1),
    sharedChats.registerChannel(channel, 1),
  ];
  for (const result of results) {
    if (!result.registered) {
      throw new Error(`Expected registration to succeed, received ${result.reason}`);
    }
  }
  for (const chat of [supergroup, channel]) {
    if (
      sharedChats.getSharedChat(chat.id) !== chat ||
      sharedChats.getChatMembership(chat.id, 1)?.status !== 'owner'
    ) {
      throw new Error(`Expected the ${chat.kind} and its owner to be stored together`);
    }
  }
});

function assertRegistrationFailure(
  result: BasicGroupRegistrationResult,
  expectedReason: BasicGroupRegistrationFailureReason,
): void {
  if (result.registered || result.reason !== expectedReason) {
    throw new Error(`Expected shared-chat registration to fail with ${expectedReason}`);
  }
}

Deno.test('SharedChatRepository preserves an existing shared chat when its ID is registered again', () => {
  const sharedChats = new SharedChatRepository();
  const originalGroup = { kind: 'basic_group', id: -1, title: 'Original' } as const;
  const replacementGroup = { kind: 'basic_group', id: -1, title: 'Replacement' } as const;

  const originalResult = sharedChats.registerBasicGroup(originalGroup, 1, []);
  if (!originalResult.registered) {
    throw new Error('Expected original group registration to succeed');
  }

  const replacementResult = sharedChats.registerBasicGroup(replacementGroup, 2, []);
  if (replacementResult.registered || replacementResult.reason !== 'chat_id_taken') {
    throw new Error('Expected duplicate chat ID registration to be rejected');
  }
  if (
    sharedChats.getSharedChat(originalGroup.id) !== originalGroup ||
    sharedChats.getChatMembership(originalGroup.id, 1)?.status !== 'owner' ||
    sharedChats.getChatMembership(originalGroup.id, 2) !== undefined
  ) {
    throw new Error('Expected duplicate registration not to overwrite existing chat state');
  }
});

Deno.test('SharedChatRepository adds a member once to an existing shared chat', () => {
  const sharedChats = new SharedChatRepository();
  const group = { kind: 'basic_group', id: -1, title: 'Test Group' } as const;
  const registration = sharedChats.registerBasicGroup(group, 1, []);
  if (!registration.registered) {
    throw new Error('Expected group registration to succeed');
  }

  const addition = sharedChats.addChatMember(group.id, 2);
  if (!addition.added) {
    throw new Error(`Expected member addition to succeed, received ${addition.reason}`);
  }

  const missingChat = sharedChats.addChatMember(-2, 3);
  assertMemberAdditionFailure(missingChat, 'chat_not_found');
  const duplicateMember = sharedChats.addChatMember(group.id, 2);
  assertMemberAdditionFailure(duplicateMember, 'member_already_present');
  if (
    sharedChats.getChatMembership(group.id, 1)?.status !== 'owner' ||
    sharedChats.getChatMembership(group.id, 2)?.status !== 'member' ||
    sharedChats.getChatMembership(group.id, 3) !== undefined
  ) {
    throw new Error('Expected the added member, and rejected additions to change nothing');
  }
});

Deno.test('SharedChatRepository refuses to store a restriction that keeps every permission', () => {
  const sharedChats = new SharedChatRepository();
  const group = { kind: 'basic_group', id: -1, title: 'Test Group' } as const;
  sharedChats.registerBasicGroup(group, 1, [2]);
  const restrictions = [
    () =>
      sharedChats.updateChatMemberStatus(group.id, 2, {
        status: 'restricted',
        isMember: true,
        permissions: ALL_CHAT_PERMISSIONS,
      }),
    () =>
      sharedChats.removeChatMember(group.id, 2, {
        status: 'restricted',
        isMember: false,
        permissions: ALL_CHAT_PERMISSIONS,
      }),
    () =>
      sharedChats.updateFormerMemberStatus(group.id, 3, {
        status: 'restricted',
        isMember: false,
        permissions: new Set(CHAT_PERMISSIONS),
      }),
    () =>
      sharedChats.addChatMember(group.id, 3, {
        status: 'restricted',
        isMember: true,
        permissions: ALL_CHAT_PERMISSIONS,
      }),
  ];
  for (const restrict of restrictions) {
    let refused = false;
    try {
      restrict();
    } catch {
      refused = true;
    }
    if (!refused) {
      throw new Error('Expected a restriction keeping every permission to be refused');
    }
  }
  if (
    sharedChats.getChatMembership(group.id, 2)?.status !== 'member' ||
    sharedChats.getChatMembership(group.id, 3) !== undefined ||
    sharedChats.getFormerMemberStatus(group.id, 3) !== undefined
  ) {
    throw new Error('Expected refused restrictions to change nothing');
  }
});

function assertMemberAdditionFailure(
  result: ChatMemberAdditionResult,
  expectedReason: ChatMemberAdditionFailureReason,
): void {
  if (result.added || result.reason !== expectedReason) {
    throw new Error(`Expected member addition to fail with ${expectedReason}`);
  }
}
