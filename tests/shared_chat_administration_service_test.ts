import { AccountRepository } from '../src/repositories/account.ts';
import { BotRepository } from '../src/repositories/bot.ts';
import { SharedChatRepository } from '../src/repositories/shared_chat.ts';
import { TelegramIdentityRepository } from '../src/repositories/telegram_identity.ts';
import {
  type AddChatMemberFailureReason,
  type AddChatMemberResult,
  type BasicGroupCreationFailureReason,
  type BasicGroupCreationResult,
  type ChannelCreationResult,
  type LeaveChatResult,
  type RemoveChatMemberResult,
  SharedChatAdministrationService,
  type SupergroupCreationResult,
} from '../src/services/shared_chat_administration.ts';
import type { RecordSupergroupServiceMessageInput } from '../src/services/supergroup_messaging.ts';
import { VirtualUserService } from '../src/services/virtual_user.ts';
import type { ChatDomainEvent } from '../src/types/chat_domain_event.ts';
import {
  type ChatMembership,
  type ChatMemberStatus,
  grantSupergroupAdministratorRights,
  type SupergroupAdministratorRight,
} from '../src/types/chat_membership.ts';
import type { BasicGroup, Channel, Supergroup } from '../src/types/virtual_chat.ts';
import type { SupergroupMessageAuthor } from '../src/types/virtual_message.ts';

Deno.test('SharedChatAdministrationService creates a basic group with its initial participants', () => {
  const { virtualUsers, identities, sharedChats, sharedChatAdministration } =
    createSharedChatAdministrationFixture();
  const creator = createAccount(virtualUsers, 'Ada');
  const member = createAccount(virtualUsers, 'Grace');
  const bot = createBot(virtualUsers, 'Test Bot', 'test_bot');

  const creation = sharedChatAdministration.createBasicGroup({
    title: 'Test Group',
    creatorAccountId: creator.profile.id,
    initialMemberIds: [member.profile.id, bot.profile.id],
  });
  const group = getCreatedBasicGroup(creation);
  if (group.id !== -1) {
    throw new Error('Expected the first basic group to receive ID -1');
  }
  if (identities.getById(group.id)?.kind !== 'basic_group') {
    throw new Error('Expected the group ID to belong to a reserved basic-group identity');
  }
  if (sharedChats.getSharedChat(group.id) !== group) {
    throw new Error('Expected the created group to be stored as the canonical shared chat');
  }
  assertMembershipStatus(
    sharedChats.getChatMembership(group.id, creator.profile.id)?.status,
    'owner',
  );
  assertMembershipStatus(
    sharedChats.getChatMembership(group.id, member.profile.id)?.status,
    'member',
  );
  assertMembershipStatus(sharedChats.getChatMembership(group.id, bot.profile.id)?.status, 'member');
});

Deno.test('SharedChatAdministrationService validates basic-group participants before reserving an ID', () => {
  const { virtualUsers, sharedChatAdministration } = createSharedChatAdministrationFixture();
  const creator = createAccount(virtualUsers, 'Ada');
  const member = createAccount(virtualUsers, 'Grace');

  const missingCreator = sharedChatAdministration.createBasicGroup({
    title: 'Missing Creator',
    creatorAccountId: 999,
    initialMemberIds: [],
  });
  assertBasicGroupCreationFailure(missingCreator, 'creator_account_not_found');

  const ownerRepeatedAsMember = sharedChatAdministration.createBasicGroup({
    title: 'Repeated Owner',
    creatorAccountId: creator.profile.id,
    initialMemberIds: [creator.profile.id],
  });
  assertBasicGroupCreationFailure(ownerRepeatedAsMember, 'initial_members_not_unique');

  const duplicateMembers = sharedChatAdministration.createBasicGroup({
    title: 'Duplicate Members',
    creatorAccountId: creator.profile.id,
    initialMemberIds: [member.profile.id, member.profile.id],
  });
  assertBasicGroupCreationFailure(duplicateMembers, 'initial_members_not_unique');

  const missingMember = sharedChatAdministration.createBasicGroup({
    title: 'Missing Member',
    creatorAccountId: creator.profile.id,
    initialMemberIds: [999],
  });
  assertBasicGroupCreationFailure(missingMember, 'initial_member_not_found');

  const validCreation = sharedChatAdministration.createBasicGroup({
    title: 'First Valid Group',
    creatorAccountId: creator.profile.id,
    initialMemberIds: [member.profile.id],
  });
  if (getCreatedBasicGroup(validCreation).id !== -1) {
    throw new Error('Expected rejected creation attempts not to consume a basic-group ID');
  }
});

Deno.test('SharedChatAdministrationService creates owner-only supergroups and channels', () => {
  const { virtualUsers, identities, sharedChats, sharedChatAdministration } =
    createSharedChatAdministrationFixture();
  const creator = createAccount(virtualUsers, 'Ada');
  const nonMember = createAccount(virtualUsers, 'Grace');

  const supergroup = getCreatedSupergroup(sharedChatAdministration.createSupergroup({
    title: 'Test Supergroup',
    description: 'Supergroup description',
    creatorAccountId: creator.profile.id,
  }));
  const channel = getCreatedChannel(sharedChatAdministration.createChannel({
    title: 'Test Channel',
    creatorAccountId: creator.profile.id,
  }));

  assertSharedChatIds(supergroup, channel);
  assertSharedChatDescriptions(supergroup, channel);
  assertSharedChatIdentityKind(identities, supergroup, 'supergroup');
  assertSharedChatIdentityKind(identities, channel, 'channel');
  assertStoredOwnerOnlyChat(
    sharedChats,
    supergroup,
    creator.profile.id,
    nonMember.profile.id,
  );
  assertStoredOwnerOnlyChat(
    sharedChats,
    channel,
    creator.profile.id,
    nonMember.profile.id,
  );
});

Deno.test('SharedChatAdministrationService validates owners before reserving shared-chat IDs', () => {
  const { virtualUsers, sharedChatAdministration } = createSharedChatAdministrationFixture();

  const missingSupergroupOwner = sharedChatAdministration.createSupergroup({
    title: 'Missing Owner',
    creatorAccountId: 999,
  });
  assertOwnerOnlyChatCreationFailure(missingSupergroupOwner, 'creator_account_not_found');

  const missingChannelOwner = sharedChatAdministration.createChannel({
    title: 'Missing Owner',
    creatorAccountId: 999,
  });
  assertOwnerOnlyChatCreationFailure(missingChannelOwner, 'creator_account_not_found');

  const creator = createAccount(virtualUsers, 'Ada');
  const validChannel = getCreatedChannel(sharedChatAdministration.createChannel({
    title: 'First Valid Shared Chat',
    creatorAccountId: creator.profile.id,
  }));
  if (validChannel.id !== -1_000_000_000_001) {
    throw new Error('Expected rejected creations not to consume a shared-chat ID');
  }
});

Deno.test('SharedChatAdministrationService adds permitted members to shared chats', () => {
  const {
    virtualUsers,
    sharedChats,
    publishedEvents,
    recordedServiceMessages,
    sharedChatAdministration,
  } = createSharedChatAdministrationFixture();
  const owner = createAccount(virtualUsers, 'Ada');
  const account = createAccount(virtualUsers, 'Grace');
  const bot = createBot(virtualUsers, 'Test Bot', 'test_bot');
  const basicGroup = getCreatedBasicGroup(sharedChatAdministration.createBasicGroup({
    title: 'Test Group',
    creatorAccountId: owner.profile.id,
    initialMemberIds: [],
  }));
  const supergroup = getCreatedSupergroup(sharedChatAdministration.createSupergroup({
    title: 'Test Supergroup',
    creatorAccountId: owner.profile.id,
  }));
  const channel = getCreatedChannel(sharedChatAdministration.createChannel({
    title: 'Test Channel',
    creatorAccountId: owner.profile.id,
  }));

  assertMemberAdded(sharedChatAdministration.addChatMember({
    actorAccountId: owner.profile.id,
    chatId: basicGroup.id,
    memberId: bot.profile.id,
  }));
  assertMemberAdded(sharedChatAdministration.addChatMember({
    actorAccountId: owner.profile.id,
    chatId: supergroup.id,
    memberId: bot.profile.id,
  }));
  assertMemberAdded(sharedChatAdministration.addChatMember({
    actorAccountId: owner.profile.id,
    chatId: channel.id,
    memberId: account.profile.id,
  }));

  assertMembershipStatus(
    sharedChats.getChatMembership(basicGroup.id, bot.profile.id)?.status,
    'member',
  );
  assertMembershipStatus(
    sharedChats.getChatMembership(supergroup.id, bot.profile.id)?.status,
    'member',
  );
  assertMembershipStatus(
    sharedChats.getChatMembership(channel.id, account.profile.id)?.status,
    'member',
  );
  const additions = [
    { chat: basicGroup, memberId: bot.profile.id },
    { chat: supergroup, memberId: bot.profile.id },
    { chat: channel, memberId: account.profile.id },
  ];
  const expectedEvents = additions.map(({ chat, memberId }) => ({
    type: 'chat_member_status_changed',
    chat,
    actorId: owner.profile.id,
    memberId,
    oldStatus: { status: 'left' },
    newStatus: { status: 'member' },
    changedAtUnixSeconds: 1_700_000_000,
  }));
  if (JSON.stringify(publishedEvents) !== JSON.stringify(expectedEvents)) {
    throw new Error(
      `Expected each addition to be published, received ${JSON.stringify(publishedEvents)}`,
    );
  }
  const expectedMembershipChanges = [{
    chatId: supergroup.id,
    author: { kind: 'account', accountId: owner.profile.id },
    content: { kind: 'members_joined', memberIds: [bot.profile.id] },
    changedAtUnixSeconds: 1_700_000_000,
  }];
  if (JSON.stringify(recordedServiceMessages) !== JSON.stringify(expectedMembershipChanges)) {
    throw new Error(
      `Expected only the supergroup to record the addition, received ${
        JSON.stringify(recordedServiceMessages)
      }`,
    );
  }
  if (!/^-?\d+$/.test(supergroup.chatInstance)) {
    throw new Error('Expected the supergroup to have a chat instance');
  }
});

Deno.test('SharedChatAdministrationService validates member additions before changing chat state', () => {
  const { virtualUsers, sharedChats, publishedEvents, sharedChatAdministration } =
    createSharedChatAdministrationFixture();
  const owner = createAccount(virtualUsers, 'Ada');
  const existingMember = createAccount(virtualUsers, 'Grace');
  const candidate = createAccount(virtualUsers, 'Linus');
  const bot = createBot(virtualUsers, 'Test Bot', 'test_bot');
  const channel = getCreatedChannel(sharedChatAdministration.createChannel({
    title: 'Test Channel',
    creatorAccountId: owner.profile.id,
  }));
  assertMemberAdded(sharedChatAdministration.addChatMember({
    actorAccountId: owner.profile.id,
    chatId: channel.id,
    memberId: existingMember.profile.id,
  }));

  assertMemberAdditionFailure(
    sharedChatAdministration.addChatMember({
      actorAccountId: 999,
      chatId: channel.id,
      memberId: candidate.profile.id,
    }),
    'actor_account_not_found',
  );
  assertMemberAdditionFailure(
    sharedChatAdministration.addChatMember({
      actorAccountId: owner.profile.id,
      chatId: -999,
      memberId: candidate.profile.id,
    }),
    'chat_not_found',
  );
  assertMemberAdditionFailure(
    sharedChatAdministration.addChatMember({
      actorAccountId: existingMember.profile.id,
      chatId: channel.id,
      memberId: candidate.profile.id,
    }),
    'actor_not_authorized',
  );
  assertMemberAdditionFailure(
    sharedChatAdministration.addChatMember({
      actorAccountId: owner.profile.id,
      chatId: channel.id,
      memberId: 999,
    }),
    'member_not_found',
  );
  assertMemberAdditionFailure(
    sharedChatAdministration.addChatMember({
      actorAccountId: owner.profile.id,
      chatId: channel.id,
      memberId: bot.profile.id,
    }),
    'bot_not_permitted_in_channel',
  );
  assertMemberAdditionFailure(
    sharedChatAdministration.addChatMember({
      actorAccountId: owner.profile.id,
      chatId: channel.id,
      memberId: existingMember.profile.id,
    }),
    'member_already_present',
  );

  if (
    sharedChats.getChatMembership(channel.id, candidate.profile.id) !== undefined ||
    sharedChats.getChatMembership(channel.id, bot.profile.id) !== undefined
  ) {
    throw new Error('Expected rejected member additions not to change chat memberships');
  }
  if (publishedEvents.length !== 1) {
    throw new Error('Expected only the accepted member addition to be published');
  }
});

function getCreatedBasicGroup(result: BasicGroupCreationResult): BasicGroup {
  if (!result.created) {
    throw new Error(`Expected group creation to succeed, received ${result.reason}`);
  }
  return result.group;
}

function getCreatedSupergroup(result: SupergroupCreationResult): Supergroup {
  if (!result.created) {
    throw new Error(`Expected supergroup creation to succeed, received ${result.reason}`);
  }
  return result.supergroup;
}

function getCreatedChannel(result: ChannelCreationResult): Channel {
  if (!result.created) {
    throw new Error(`Expected channel creation to succeed, received ${result.reason}`);
  }
  return result.channel;
}

function assertBasicGroupCreationFailure(
  result: BasicGroupCreationResult,
  expectedReason: BasicGroupCreationFailureReason,
): void {
  if (result.created || result.reason !== expectedReason) {
    throw new Error(`Expected basic-group creation to fail with ${expectedReason}`);
  }
}

function assertOwnerOnlyChatCreationFailure(
  result: SupergroupCreationResult | ChannelCreationResult,
  expectedReason: 'creator_account_not_found' | 'identity_limit_reached',
): void {
  if (result.created || result.reason !== expectedReason) {
    throw new Error(`Expected shared-chat creation to fail with ${expectedReason}`);
  }
}

function assertMemberAdded(result: AddChatMemberResult): void {
  if (!result.added) {
    throw new Error(`Expected member addition to succeed, received ${result.reason}`);
  }
}

function assertMemberAdditionFailure(
  result: AddChatMemberResult,
  expectedReason: AddChatMemberFailureReason,
): void {
  if (result.added || result.reason !== expectedReason) {
    throw new Error(`Expected member addition to fail with ${expectedReason}`);
  }
}

function assertSharedChatIds(supergroup: Supergroup, channel: Channel): void {
  if (
    supergroup.id !== -1_000_000_000_001 ||
    channel.id !== -1_000_000_000_002
  ) {
    throw new Error('Expected supergroups and channels to share their descending ID sequence');
  }
}

function assertSharedChatDescriptions(supergroup: Supergroup, channel: Channel): void {
  if (
    supergroup.description !== 'Supergroup description' ||
    channel.description !== undefined
  ) {
    throw new Error('Expected shared-chat descriptions to preserve their creation inputs');
  }
}

function assertSharedChatIdentityKind(
  identities: TelegramIdentityRepository,
  chat: Supergroup | Channel,
  expectedKind: 'supergroup' | 'channel',
): void {
  if (identities.getById(chat.id)?.kind !== expectedKind) {
    throw new Error(`Expected the shared-chat identity kind to be ${expectedKind}`);
  }
}

function assertStoredOwnerOnlyChat(
  sharedChats: SharedChatRepository,
  chat: Supergroup | Channel,
  ownerAccountId: number,
  nonMemberAccountId: number,
): void {
  if (sharedChats.getSharedChat(chat.id) !== chat) {
    throw new Error('Expected the created shared chat to be stored canonically');
  }
  assertMembershipStatus(sharedChats.getChatMembership(chat.id, ownerAccountId)?.status, 'owner');
  if (sharedChats.getChatMembership(chat.id, nonMemberAccountId) !== undefined) {
    throw new Error('Expected an owner-only shared chat not to add other accounts at creation');
  }
}

function assertMembershipStatus(
  actualStatus: ChatMembership['status'] | undefined,
  expectedStatus: ChatMembership['status'],
): void {
  if (actualStatus !== expectedStatus) {
    throw new Error(`Expected ${expectedStatus} membership, received ${actualStatus}`);
  }
}

Deno.test('SharedChatAdministrationService ends memberships as members leave or are removed', () => {
  const {
    virtualUsers,
    sharedChats,
    publishedEvents,
    recordedServiceMessages,
    sharedChatAdministration,
  } = createSharedChatAdministrationFixture();
  const owner = createAccount(virtualUsers, 'Ada');
  const member = createAccount(virtualUsers, 'Grace');
  const bot = createBot(virtualUsers, 'Test Bot', 'test_bot');
  const supergroup = getCreatedSupergroup(sharedChatAdministration.createSupergroup({
    title: 'Team',
    creatorAccountId: owner.profile.id,
  }));
  for (const memberId of [member.profile.id, bot.profile.id]) {
    assertMemberAdded(sharedChatAdministration.addChatMember({
      actorAccountId: owner.profile.id,
      chatId: supergroup.id,
      memberId,
    }));
  }
  publishedEvents.length = 0;
  recordedServiceMessages.length = 0;

  const refusals = [
    sharedChatAdministration.removeChatMember({
      actorAccountId: member.profile.id,
      chatId: supergroup.id,
      memberId: bot.profile.id,
    }),
    sharedChatAdministration.removeChatMember({
      actorAccountId: owner.profile.id,
      chatId: supergroup.id,
      memberId: 999,
    }),
    sharedChatAdministration.leaveChat({ memberId: owner.profile.id, chatId: supergroup.id }),
    sharedChatAdministration.leaveChat({ memberId: bot.profile.id, chatId: -999 }),
  ];
  const expectedRefusals = [
    'actor_not_authorized',
    'member_not_found',
    'owner_cannot_leave',
    'chat_not_found',
  ];
  if (
    JSON.stringify(refusals.map(failureReason)) !== JSON.stringify(expectedRefusals) ||
    publishedEvents.length !== 0 || recordedServiceMessages.length !== 0
  ) {
    throw new Error(`Expected refusals to change nothing, received ${JSON.stringify(refusals)}`);
  }

  const leaving = sharedChatAdministration.leaveChat({
    memberId: member.profile.id,
    chatId: supergroup.id,
  });
  const removal = sharedChatAdministration.removeChatMember({
    actorAccountId: owner.profile.id,
    chatId: supergroup.id,
    memberId: bot.profile.id,
  });
  if (!('left' in leaving) || !leaving.left || !('removed' in removal) || !removal.removed) {
    throw new Error(`Expected the member to leave and the bot to be removed`);
  }
  if (
    sharedChats.getChatMembership(supergroup.id, member.profile.id) !== undefined ||
    sharedChats.getFormerMemberStatus(supergroup.id, member.profile.id)?.status !== 'left' ||
    sharedChats.getFormerMemberStatus(supergroup.id, bot.profile.id)?.status !== 'kicked'
  ) {
    throw new Error('Expected the member to have left and the bot to be banned');
  }
  const expectedEvents = [
    [member.profile.id, member.profile.id, 'left'],
    [owner.profile.id, bot.profile.id, 'kicked'],
  ].map(([actorId, memberId, statusAfterLeaving]) => ({
    type: 'chat_member_status_changed',
    chat: supergroup,
    actorId,
    memberId,
    oldStatus: { status: 'member' },
    newStatus: { status: statusAfterLeaving },
    changedAtUnixSeconds: 1_700_000_000,
  }));
  const expectedChanges = [
    [{ kind: 'account', accountId: member.profile.id }, member.profile.id],
    [{ kind: 'account', accountId: owner.profile.id }, bot.profile.id],
  ].map(([author, memberId]) => ({
    chatId: supergroup.id,
    author,
    content: { kind: 'member_left', memberId },
    changedAtUnixSeconds: 1_700_000_000,
  }));
  if (
    JSON.stringify(publishedEvents) !== JSON.stringify(expectedEvents) ||
    JSON.stringify(recordedServiceMessages) !== JSON.stringify(expectedChanges)
  ) {
    throw new Error(
      `Expected each departure to be published and recorded, received ${
        JSON.stringify([publishedEvents, recordedServiceMessages])
      }`,
    );
  }

  const repeatedLeaving = sharedChatAdministration.leaveChat({
    memberId: bot.profile.id,
    chatId: supergroup.id,
  });
  if (
    JSON.stringify(repeatedLeaving) !==
      '{"left":false,"reason":"not_a_member","formerStatus":{"status":"kicked"}}'
  ) {
    throw new Error(
      `Expected a removed bot to be told how it left, received ${JSON.stringify(repeatedLeaving)}`,
    );
  }
  assertMemberAdded(sharedChatAdministration.addChatMember({
    actorAccountId: owner.profile.id,
    chatId: supergroup.id,
    memberId: bot.profile.id,
  }));
  const readdition = publishedEvents.at(-1);
  if (
    readdition?.type !== 'chat_member_status_changed' ||
    readdition.oldStatus.status !== 'kicked' ||
    sharedChats.getFormerMemberStatus(supergroup.id, bot.profile.id) !== undefined
  ) {
    throw new Error(
      `Expected adding the removed bot to lift its ban, received ${JSON.stringify(readdition)}`,
    );
  }
});

Deno.test('SharedChatAdministrationService lets the owner promote and demote members', () => {
  const { owner, member, moderatorBot, supergroup, publishedEvents, sharedChatAdministration } =
    createModerationFixture();
  const changeRole = (
    memberId: number,
    rights?: readonly SupergroupAdministratorRight[],
    actorAccountId = owner.profile.id,
  ) => {
    const input = { actorAccountId, chatId: supergroup.id, memberId };
    if (rights === undefined) {
      const demotion = sharedChatAdministration.demoteChatMember(input);
      return demotion.demoted ? 'changed' : demotion.reason;
    }
    const promotion = sharedChatAdministration.promoteChatMember({
      ...input,
      rights: grantSupergroupAdministratorRights(rights),
    });
    return promotion.promoted ? 'changed' : promotion.reason;
  };

  const outcomes = [
    changeRole(moderatorBot.profile.id, ['can_delete_messages']),
    changeRole(moderatorBot.profile.id, ['can_delete_messages']),
    changeRole(moderatorBot.profile.id, ['can_restrict_members']),
    changeRole(moderatorBot.profile.id),
    changeRole(moderatorBot.profile.id),
    changeRole(moderatorBot.profile.id, ['can_delete_messages'], member.profile.id),
    changeRole(owner.profile.id, ['can_delete_messages']),
    changeRole(999, ['can_delete_messages']),
    changeRole(member.profile.id, []),
  ];
  if (
    JSON.stringify(outcomes) !== JSON.stringify([
      'changed',
      'changed',
      'changed',
      'changed',
      'changed',
      'actor_not_authorized',
      'member_is_owner',
      'member_not_found',
      'no_rights_granted',
    ])
  ) {
    throw new Error(`Expected the owner alone to change roles, received ${outcomes.join()}`);
  }

  // Repeating a promotion or a demotion publishes nothing; any right includes can_manage_chat.
  const statusChanges = publishedEvents.map((event) =>
    event.type === 'chat_member_status_changed'
      ? [event.actorId, describeStatus(event.oldStatus), describeStatus(event.newStatus)]
      : event.type
  );
  const promotedTo = (rights: string) => `administrator(${rights})`;
  const expectedStatusChanges = [
    [owner.profile.id, 'member', promotedTo('can_delete_messages,can_manage_chat')],
    [
      owner.profile.id,
      promotedTo('can_delete_messages,can_manage_chat'),
      promotedTo('can_manage_chat,can_restrict_members'),
    ],
    [owner.profile.id, promotedTo('can_manage_chat,can_restrict_members'), 'member'],
  ];
  if (JSON.stringify(statusChanges) !== JSON.stringify(expectedStatusChanges)) {
    throw new Error(`Expected each role change once, received ${JSON.stringify(statusChanges)}`);
  }

  // An administrator that leaves is no member any more, and a non-member has no role to change.
  changeRole(member.profile.id, ['can_pin_messages']);
  publishedEvents.length = 0;
  sharedChatAdministration.leaveChat({ memberId: member.profile.id, chatId: supergroup.id });
  const departure = publishedEvents[0];
  if (
    departure?.type !== 'chat_member_status_changed' ||
    describeStatus(departure.oldStatus) !== promotedTo('can_manage_chat,can_pin_messages') ||
    changeRole(member.profile.id, ['can_pin_messages']) !== 'not_a_member'
  ) {
    throw new Error(`Expected the administrator to leave, received ${JSON.stringify(departure)}`);
  }
});

Deno.test('SharedChatAdministrationService lets bots ban and unban users in TDLib order', () => {
  const {
    owner,
    member,
    stranger,
    moderatorBot,
    otherBot,
    supergroup,
    sharedChats,
    publishedEvents,
    recordedServiceMessages,
    sharedChatAdministration,
  } = createModerationFixture();
  const now = 1_700_000_000;
  const ban = (memberId: number, requestedBanEndUnixSeconds?: number) => {
    const result = sharedChatAdministration.banChatMember({
      actorBotId: moderatorBot.profile.id,
      chatId: supergroup.id,
      memberId,
      ...(requestedBanEndUnixSeconds === undefined ? {} : { requestedBanEndUnixSeconds }),
    });
    return result.banned ? 'banned' : result.reason;
  };
  const unban = (memberId: number, onlyIfBanned = false) => {
    const result = sharedChatAdministration.unbanChatMember({
      actorBotId: moderatorBot.profile.id,
      chatId: supergroup.id,
      memberId,
      onlyIfBanned,
    });
    return result.unbanned ? 'unbanned' : result.reason;
  };
  const statusOf = (userId: number) =>
    describeStatus(
      sharedChats.getChatMembership(supergroup.id, userId) ??
        sharedChats.getFormerMemberStatus(supergroup.id, userId) ?? { status: 'left' },
    );

  // Nobody bans the owner, and banning needs the right to restrict members.
  const refusalsWithoutRights = [
    ban(owner.profile.id),
    ban(moderatorBot.profile.id),
    ban(999),
    ban(member.profile.id),
    unban(member.profile.id),
  ];
  if (
    JSON.stringify(refusalsWithoutRights) !== JSON.stringify([
        'member_is_owner',
        'cannot_restrict_self',
        'member_not_found',
        'not_enough_rights',
        'not_enough_rights',
      ]) || publishedEvents.length !== 0
  ) {
    throw new Error(`Expected refusals without rights, received ${refusalsWithoutRights.join()}`);
  }

  for (
    const [memberId, rights] of [
      [moderatorBot.profile.id, ['can_restrict_members']],
      [otherBot.profile.id, ['can_delete_messages']],
    ] as const
  ) {
    sharedChatAdministration.promoteChatMember({
      actorAccountId: owner.profile.id,
      chatId: supergroup.id,
      memberId,
      rights: grantSupergroupAdministratorRights(rights),
    });
  }
  publishedEvents.length = 0;
  recordedServiceMessages.length = 0;

  // Telegram lets a bot ban only administrators it promoted, and bots promote none here.
  const outcomes = [
    ban(otherBot.profile.id),
    ban(member.profile.id, now + 3_600),
    ban(member.profile.id, now + 3_600),
    ban(member.profile.id, now + 10),
    ban(stranger.profile.id),
  ];
  if (
    JSON.stringify(outcomes) !==
      JSON.stringify(['member_is_administrator', 'banned', 'banned', 'banned', 'banned']) ||
    statusOf(member.profile.id) !== 'kicked' || statusOf(stranger.profile.id) !== 'kicked'
  ) {
    throw new Error(`Expected bans of non-administrators, received ${outcomes.join()}`);
  }
  // A ban that changes nothing publishes nothing, and one shorter than 30 seconds is forever.
  // Only the removal of a member is recorded as a service message, which the bot wrote.
  const botId = moderatorBot.profile.id;
  const describeChanges = () =>
    publishedEvents.splice(0).map((event) =>
      event.type === 'chat_member_status_changed'
        ? [
          event.actorId,
          event.memberId,
          describeStatus(event.oldStatus),
          describeStatus(event.newStatus),
        ]
        : event.type
    );
  const banChanges = describeChanges();
  const expectedBanChanges = [
    [botId, member.profile.id, 'member', `kicked(${now + 3_600})`],
    [botId, member.profile.id, `kicked(${now + 3_600})`, 'kicked'],
    [botId, stranger.profile.id, 'left', 'kicked'],
  ];
  const removalRecord = {
    chatId: supergroup.id,
    author: { kind: 'bot', botId },
    content: { kind: 'member_left', memberId: member.profile.id },
    changedAtUnixSeconds: now,
  };
  if (
    JSON.stringify(banChanges) !== JSON.stringify(expectedBanChanges) ||
    JSON.stringify(recordedServiceMessages.splice(0)) !== JSON.stringify([removalRecord])
  ) {
    throw new Error(`Expected each ban once, received ${JSON.stringify(banChanges)}`);
  }

  // Unbanning lifts a ban, and, unless only a ban is to be lifted, removes a member by banning it
  // for a minute first, as Telegram does. A bot that unbans itself leaves.
  sharedChatAdministration.addChatMember({
    actorAccountId: owner.profile.id,
    chatId: supergroup.id,
    memberId: member.profile.id,
  });
  publishedEvents.length = 0;
  recordedServiceMessages.length = 0;
  const unbanOutcomes = [
    unban(member.profile.id, true),
    unban(stranger.profile.id),
    unban(stranger.profile.id),
    unban(member.profile.id),
    unban(owner.profile.id),
    unban(otherBot.profile.id),
    unban(999, true),
    unban(moderatorBot.profile.id),
  ];
  if (
    JSON.stringify(unbanOutcomes) !== JSON.stringify([
      'unbanned',
      'unbanned',
      'unbanned',
      'unbanned',
      'member_is_owner',
      'member_is_administrator',
      'member_not_found',
      'unbanned',
    ])
  ) {
    throw new Error(`Expected unbans in TDLib order, received ${unbanOutcomes.join()}`);
  }
  const unbanChanges = describeChanges();
  const expectedUnbanChanges = [
    [botId, stranger.profile.id, 'kicked', 'left'],
    [botId, member.profile.id, 'member', `kicked(${now + 60})`],
    [botId, member.profile.id, `kicked(${now + 60})`, 'left'],
    [botId, botId, 'administrator(can_manage_chat,can_restrict_members)', 'left'],
  ];
  if (
    JSON.stringify(unbanChanges) !== JSON.stringify(expectedUnbanChanges) ||
    recordedServiceMessages.length !== 2
  ) {
    throw new Error(
      `Expected unbans to change standings, received ${JSON.stringify(unbanChanges)}`,
    );
  }
  if (ban(member.profile.id) !== 'bot_not_a_member') {
    throw new Error('Expected a bot that left to be turned away');
  }
});

Deno.test('SharedChatAdministrationService tells member bots the standing of supergroup users', () => {
  const {
    owner,
    member,
    stranger,
    moderatorBot,
    otherBot,
    supergroup,
    sharedChatAdministration,
  } = createModerationFixture();
  sharedChatAdministration.promoteChatMember({
    actorAccountId: owner.profile.id,
    chatId: supergroup.id,
    memberId: otherBot.profile.id,
    rights: grantSupergroupAdministratorRights(['can_restrict_members']),
  });
  sharedChatAdministration.banChatMember({
    actorBotId: otherBot.profile.id,
    chatId: supergroup.id,
    memberId: member.profile.id,
  });
  const query = { observerBotId: moderatorBot.profile.id, chatId: supergroup.id };

  const standings = [owner, member, stranger, otherBot, moderatorBot].map(({ profile }) => {
    const result = sharedChatAdministration.getChatMemberStatus({ ...query, userId: profile.id });
    return result.found ? describeStatus(result.status) : result.reason;
  });
  const administrators = sharedChatAdministration.getChatAdministrators(query);
  const memberCount = sharedChatAdministration.getChatMemberCount(query);
  if (
    JSON.stringify(standings) !== JSON.stringify([
        'owner',
        'kicked',
        'left',
        'administrator(can_manage_chat,can_restrict_members)',
        'member',
      ]) ||
    !administrators.found ||
    JSON.stringify(administrators.administrators.map(({ userId }) => userId)) !==
      JSON.stringify([owner.profile.id, otherBot.profile.id]) ||
    !memberCount.found || memberCount.memberCount !== 3
  ) {
    throw new Error(
      `Expected the standings of the supergroup's users, received ${
        JSON.stringify([standings, administrators, memberCount])
      }`,
    );
  }

  const unknownUser = sharedChatAdministration.getChatMemberStatus({ ...query, userId: 999 });
  const bannedBotQuery = { observerBotId: otherBot.profile.id, chatId: supergroup.id };
  sharedChatAdministration.removeChatMember({
    actorAccountId: owner.profile.id,
    chatId: supergroup.id,
    memberId: otherBot.profile.id,
  });
  const refusals = [
    unknownUser,
    sharedChatAdministration.getChatAdministrators(bannedBotQuery),
    sharedChatAdministration.getChatMemberCount({ ...query, chatId: -1_000_000_009_999 }),
  ].map((result) => result.found ? 'found' : result.reason);
  if (
    JSON.stringify(refusals) !==
      JSON.stringify(['member_not_found', 'bot_kicked', 'chat_not_found'])
  ) {
    throw new Error(`Expected member queries to be refused, received ${refusals.join()}`);
  }
});

/** Describes a standing compactly: rights sorted, and a ban's end when it has one. */
Deno.test('SharedChatAdministrationService keeps a restriction while the user leaves and joins', () => {
  const {
    owner,
    member,
    moderatorBot,
    supergroup,
    sharedChats,
    publishedEvents,
    sharedChatAdministration,
  } = createModerationFixture();
  const restriction: ChatMemberStatus = {
    status: 'restricted',
    isMember: true,
    permissions: new Set(['can_send_messages']),
  };
  const statusOf = (userId: number) =>
    describeStatus(
      sharedChats.getChatMembership(supergroup.id, userId) ??
        sharedChats.getFormerMemberStatus(supergroup.id, userId) ?? { status: 'left' },
    );
  const restrict = () =>
    sharedChats.updateChatMemberStatus(supergroup.id, member.profile.id, restriction);
  restrict();

  // As Telegram keeps it, the restriction outlasts leaving and joining again, which events show.
  const statuses = [statusOf(member.profile.id)];
  sharedChatAdministration.leaveChat({ memberId: member.profile.id, chatId: supergroup.id });
  statuses.push(statusOf(member.profile.id));
  sharedChatAdministration.addChatMember({
    actorAccountId: owner.profile.id,
    chatId: supergroup.id,
    memberId: member.profile.id,
  });
  statuses.push(statusOf(member.profile.id));
  // Demotion leaves a restricted member as it is, and the restricted member administers nothing.
  const demotion = sharedChatAdministration.demoteChatMember({
    actorAccountId: owner.profile.id,
    chatId: supergroup.id,
    memberId: member.profile.id,
  });
  statuses.push(statusOf(member.profile.id));
  const administrators = sharedChatAdministration.getChatAdministrators({
    observerBotId: moderatorBot.profile.id,
    chatId: supergroup.id,
  });
  const restrictedMember = 'restricted member(can_send_messages)';
  if (
    JSON.stringify(statuses) !== JSON.stringify([
        restrictedMember,
        'restricted non-member(can_send_messages)',
        restrictedMember,
        restrictedMember,
      ]) ||
    !demotion.demoted || !administrators.found ||
    JSON.stringify(administrators.administrators.map(({ userId }) => userId)) !==
      JSON.stringify([owner.profile.id])
  ) {
    throw new Error(`Expected the restriction to last, received ${JSON.stringify(statuses)}`);
  }
  const changes = publishedEvents.map((event) =>
    event.type === 'chat_member_status_changed'
      ? `${describeStatus(event.oldStatus)} -> ${describeStatus(event.newStatus)}`
      : event.type
  );
  if (
    JSON.stringify(changes) !== JSON.stringify([
      `${restrictedMember} -> restricted non-member(can_send_messages)`,
      `restricted non-member(can_send_messages) -> ${restrictedMember}`,
    ])
  ) {
    throw new Error(`Expected the restriction in each change, received ${JSON.stringify(changes)}`);
  }

  // A ban or a removal ends a restricted member's membership as it ends any other's.
  sharedChatAdministration.promoteChatMember({
    actorAccountId: owner.profile.id,
    chatId: supergroup.id,
    memberId: moderatorBot.profile.id,
    rights: grantSupergroupAdministratorRights(['can_restrict_members']),
  });
  const removal = sharedChatAdministration.unbanChatMember({
    actorBotId: moderatorBot.profile.id,
    chatId: supergroup.id,
    memberId: member.profile.id,
    onlyIfBanned: false,
  });
  const statusAfterRemoval = statusOf(member.profile.id);
  sharedChatAdministration.addChatMember({
    actorAccountId: owner.profile.id,
    chatId: supergroup.id,
    memberId: member.profile.id,
  });
  restrict();
  const ban = sharedChatAdministration.banChatMember({
    actorBotId: moderatorBot.profile.id,
    chatId: supergroup.id,
    memberId: member.profile.id,
  });
  if (
    !removal.unbanned || statusAfterRemoval !== 'left' || !ban.banned ||
    statusOf(member.profile.id) !== 'kicked' ||
    sharedChats.getChatMemberIds(supergroup.id).includes(member.profile.id)
  ) {
    throw new Error(
      `Expected removal and a ban to end the membership, received ${
        JSON.stringify([removal, statusAfterRemoval, ban, statusOf(member.profile.id)])
      }`,
    );
  }
});

Deno.test('SharedChatAdministrationService lets members change information as permissions allow', () => {
  const { owner, member, moderatorBot, supergroup, sharedChats, sharedChatAdministration } =
    createModerationFixture();
  const changeTitle = (actor: SupergroupMessageAuthor, title: string) => {
    const result = sharedChatAdministration.changeSupergroupTitle({
      actor,
      chatId: supergroup.id,
      title,
    });
    return result.changed ? 'changed' : result.reason;
  };
  const memberAccount: SupergroupMessageAuthor = { kind: 'account', accountId: member.profile.id };
  const bot: SupergroupMessageAuthor = { kind: 'bot', botId: moderatorBot.profile.id };

  // By default every account member may change information, but a bot needs the right.
  const byDefault = [changeTitle(memberAccount, 'Members'), changeTitle(bot, 'Bots')];
  sharedChats.updateSupergroupDefaultPermissions(supergroup.id, new Set(['can_send_messages']));
  const withoutDefault = [
    changeTitle(memberAccount, 'Members again'),
    changeTitle({ kind: 'account', accountId: owner.profile.id }, 'Owners'),
  ];
  sharedChatAdministration.promoteChatMember({
    actorAccountId: owner.profile.id,
    chatId: supergroup.id,
    memberId: moderatorBot.profile.id,
    rights: grantSupergroupAdministratorRights(['can_change_info']),
  });
  sharedChats.updateSupergroupDefaultPermissions(supergroup.id, new Set(['can_change_info']));
  sharedChats.updateChatMemberStatus(supergroup.id, member.profile.id, {
    status: 'restricted',
    isMember: true,
    permissions: new Set(['can_send_messages']),
  });
  const withRestriction = [changeTitle(memberAccount, 'Restricted'), changeTitle(bot, 'Bots')];
  const received = [...byDefault, ...withoutDefault, ...withRestriction];
  if (
    JSON.stringify(received) !== JSON.stringify([
      'changed',
      'not_enough_rights',
      'not_enough_rights',
      'changed',
      'not_enough_rights',
      'changed',
    ])
  ) {
    throw new Error(`Expected permissions to decide title changes, received ${received}`);
  }
});

function describeStatus(status: ChatMemberStatus): string {
  switch (status.status) {
    case 'administrator':
      return `administrator(${[...status.rights].sort().join()})`;
    case 'restricted':
      return `restricted ${status.isMember ? 'member' : 'non-member'}(${
        [...status.permissions].sort().join()
      })`;
    case 'kicked':
      return status.bannedUntilUnixSeconds === undefined
        ? 'kicked'
        : `kicked(${status.bannedUntilUnixSeconds})`;
    default:
      return status.status;
  }
}

/**
 * A supergroup with its owner, a member account, a moderator bot, and another bot, and an account
 * that never joined it.
 */
function createModerationFixture() {
  const fixture = createSharedChatAdministrationFixture();
  const { virtualUsers, sharedChatAdministration, publishedEvents, recordedServiceMessages } =
    fixture;
  const owner = createAccount(virtualUsers, 'Ada');
  const member = createAccount(virtualUsers, 'Grace');
  const stranger = createAccount(virtualUsers, 'Linus');
  const moderatorBot = createBot(virtualUsers, 'Moderator Bot', 'moderator_bot');
  const otherBot = createBot(virtualUsers, 'Other Bot', 'other_bot');
  const supergroup = getCreatedSupergroup(sharedChatAdministration.createSupergroup({
    title: 'Team',
    creatorAccountId: owner.profile.id,
  }));
  for (const memberId of [member.profile.id, moderatorBot.profile.id, otherBot.profile.id]) {
    assertMemberAdded(sharedChatAdministration.addChatMember({
      actorAccountId: owner.profile.id,
      chatId: supergroup.id,
      memberId,
    }));
  }
  publishedEvents.length = 0;
  recordedServiceMessages.length = 0;
  return { ...fixture, owner, member, stranger, moderatorBot, otherBot, supergroup };
}

function failureReason(result: LeaveChatResult | RemoveChatMemberResult): string | undefined {
  if ('left' in result) {
    return result.left ? undefined : result.reason;
  }
  return result.removed ? undefined : result.reason;
}

function createSharedChatAdministrationFixture() {
  const identities = new TelegramIdentityRepository();
  const accounts = new AccountRepository();
  const bots = new BotRepository();
  const virtualUsers = new VirtualUserService({ identities, accounts, bots });
  const sharedChats = new SharedChatRepository();
  const publishedEvents: ChatDomainEvent[] = [];
  const recordedServiceMessages: RecordSupergroupServiceMessageInput[] = [];
  const sharedChatAdministration = new SharedChatAdministrationService({
    identities,
    accounts,
    bots,
    sharedChats,
    supergroupMessages: {
      recordServiceMessage: (change) => recordedServiceMessages.push(change),
    },
    events: { publish: (event) => publishedEvents.push(event) },
    currentUnixTimeSeconds: () => 1_700_000_000,
  });
  return {
    identities,
    virtualUsers,
    sharedChats,
    publishedEvents,
    recordedServiceMessages,
    sharedChatAdministration,
  };
}

function createAccount(virtualUsers: VirtualUserService, firstName: string) {
  const result = virtualUsers.createAccount({ first_name: firstName });
  if (!result.created) {
    throw new Error(`Expected account creation to succeed, received ${result.reason}`);
  }
  return result.account;
}

function createBot(virtualUsers: VirtualUserService, firstName: string, username: string) {
  const result = virtualUsers.createBot({ first_name: firstName, username });
  if (!result.created) {
    throw new Error(`Expected bot creation to succeed, received ${result.reason}`);
  }
  return result.bot;
}
