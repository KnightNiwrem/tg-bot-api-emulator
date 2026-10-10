import { AccountRepository } from '../src/repositories/account.ts';
import { BotRepository } from '../src/repositories/bot.ts';
import { ChatInviteLinkRepository } from '../src/repositories/chat_invite_link.ts';
import { SharedChatRepository } from '../src/repositories/shared_chat.ts';
import { TelegramIdentityRepository } from '../src/repositories/telegram_identity.ts';
import {
  ChatAdmissionService,
  type EditInviteLinkAsBotInput,
  type JoinRequestDecision,
  type RequestedInviteLinkSettings,
} from '../src/services/chat_admission.ts';
import { SharedChatAdministrationService } from '../src/services/shared_chat_administration.ts';
import { VirtualUserService } from '../src/services/virtual_user.ts';
import type { ChatDomainEvent } from '../src/types/chat_domain_event.ts';
import {
  grantSupergroupAdministratorRights,
  type SupergroupAdministratorRight,
} from '../src/types/chat_membership.ts';

/** The session clock, which stands still unless a test moves it. */
const CREATION_TIME_UNIX_SECONDS = 1_700_000_000;

/**
 * Creates a session where Ada owns a supergroup with an administrator bot holding
 * `can_invite_users`, Grace is an account outside it, and the clock reads what `clock` holds.
 */
function createAdmissionFixture() {
  const identities = new TelegramIdentityRepository();
  const accounts = new AccountRepository();
  const bots = new BotRepository();
  const virtualUsers = new VirtualUserService({ identities, accounts, bots });
  const sharedChats = new SharedChatRepository();
  const publishedEvents: ChatDomainEvent[] = [];
  const clock = { nowUnixSeconds: CREATION_TIME_UNIX_SECONDS };
  const currentUnixTimeSeconds = () => clock.nowUnixSeconds;
  const sharedChatAdministration = new SharedChatAdministrationService({
    identities,
    accounts,
    bots,
    sharedChats,
    supergroupMessages: { recordServiceMessage: () => {} },
    events: { publish: (event) => publishedEvents.push(event) },
    currentUnixTimeSeconds,
  });
  const chatAdmission = new ChatAdmissionService({
    accounts,
    bots,
    sharedChats,
    inviteLinks: new ChatInviteLinkRepository(),
    memberships: sharedChatAdministration,
    events: { publish: (event) => publishedEvents.push(event) },
    currentUnixTimeSeconds,
  });

  const ada = virtualUsers.createAccount({ first_name: 'Ada' });
  const grace = virtualUsers.createAccount({ first_name: 'Grace' });
  const bot = virtualUsers.createBot({ first_name: 'Inviter', username: 'inviter_bot' });
  if (!ada.created || !grace.created || !bot.created) {
    throw new Error('Expected the users to be created');
  }
  const creation = sharedChatAdministration.createSupergroup({
    title: 'Team',
    creatorAccountId: ada.account.profile.id,
  });
  if (!creation.created) {
    throw new Error('Expected the supergroup to be created');
  }
  const chatId = creation.supergroup.id;
  const botId = bot.bot.profile.id;
  sharedChatAdministration.addChatMember({
    actorAccountId: ada.account.profile.id,
    chatId,
    memberId: botId,
  });
  sharedChatAdministration.promoteChatMember({
    actorAccountId: ada.account.profile.id,
    chatId,
    memberId: botId,
    rights: grantSupergroupAdministratorRights(['can_invite_users']),
  });
  publishedEvents.length = 0;

  return {
    clock,
    virtualUsers,
    sharedChatAdministration,
    chatAdmission,
    publishedEvents,
    chatId,
    botId,
    adaId: ada.account.profile.id,
    graceId: grace.account.profile.id,
  };
}

/**
 * Extends the admission fixture for join requester contact: a co-inviter bot that also holds
 * `can_invite_users`, an observer bot that administers without it, Hopper, an account outside the
 * supergroup, and a link of the inviter bot that creates join requests and expires in an hour.
 */
function createRequesterContactFixture() {
  const fixture = createAdmissionFixture();
  const { virtualUsers, sharedChatAdministration, chatAdmission, chatId, botId, adaId } = fixture;
  const createBot = (username: string) => {
    const creation = virtualUsers.createBot({ first_name: username, username });
    if (!creation.created) {
      throw new Error(`Expected bot ${username} to be created`);
    }
    return creation.bot.profile.id;
  };
  const promote = (memberId: number, right: SupergroupAdministratorRight) =>
    sharedChatAdministration.promoteChatMember({
      actorAccountId: adaId,
      chatId,
      memberId,
      rights: grantSupergroupAdministratorRights([right]),
    });
  const coInviterBotId = createBot('co_inviter_bot');
  const observerBotId = createBot('observer_bot');
  for (const memberId of [coInviterBotId, observerBotId]) {
    sharedChatAdministration.addChatMember({ actorAccountId: adaId, chatId, memberId });
  }
  promote(coInviterBotId, 'can_invite_users');
  promote(observerBotId, 'can_delete_messages');
  const hopper = virtualUsers.createAccount({ first_name: 'Hopper' });
  if (!hopper.created) {
    throw new Error('Expected Hopper to be created');
  }
  const linkCreation = chatAdmission.createInviteLinkAsBot({
    creatorBotId: botId,
    chatId,
    name: 'Applicants',
    expiresAtUnixSeconds: CREATION_TIME_UNIX_SECONDS + 3_600,
    createsJoinRequest: true,
  });
  if (!linkCreation.created) {
    throw new Error(`Expected the request link to be created, received ${linkCreation.reason}`);
  }
  const requestToJoin = (accountId: number) =>
    chatAdmission.joinChatByInviteLink({ accountId, inviteLinkUrl: linkCreation.link.url });
  /** Each request of the chat as `[user, contact status, bots that may contact the user]`. */
  const describeContacts = () => {
    const inspection = chatAdmission.getJoinRequestsForAccount({ accountId: adaId, chatId });
    return inspection.found
      ? inspection.requests.map(({ request, contactBotIds }) => [
        request.userId,
        request.requesterContact.status,
        contactBotIds,
      ])
      : inspection.reason;
  };

  return {
    ...fixture,
    coInviterBotId,
    observerBotId,
    hopperId: hopper.account.profile.id,
    inviteLinkUrl: linkCreation.link.url,
    promote,
    requestToJoin,
    describeContacts,
  };
}

function expectEqual(actual: unknown, expected: unknown, message: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `${message}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`,
    );
  }
}

Deno.test('ChatAdmissionService accepts only expiry dates after the session clock', () => {
  const { clock, chatAdmission, chatId, botId } = createAdmissionFixture();
  const create = (expiresAtUnixSeconds: number) => {
    const result = chatAdmission.createInviteLinkAsBot({
      creatorBotId: botId,
      chatId,
      name: '',
      expiresAtUnixSeconds,
      createsJoinRequest: false,
    });
    return result.created ? result.link.expiresAtUnixSeconds : result.reason;
  };

  const atCreationTime = create(CREATION_TIME_UNIX_SECONDS);
  const justAfter = create(CREATION_TIME_UNIX_SECONDS + 1);
  clock.nowUnixSeconds += 60;
  const afterTheClockMoved = create(CREATION_TIME_UNIX_SECONDS + 30);

  expectEqual(
    [atCreationTime, justAfter, afterTheClockMoved],
    ['expiry_date_invalid', CREATION_TIME_UNIX_SECONDS + 1, 'expiry_date_invalid'],
    'Expected the expiry date to need to lie after the current time',
  );
});

Deno.test('ChatAdmissionService keeps a link usable after its expiry date passes on the clock', () => {
  const { clock, chatAdmission, publishedEvents, chatId, botId, graceId } =
    createAdmissionFixture();
  const creation = chatAdmission.createInviteLinkAsBot({
    creatorBotId: botId,
    chatId,
    name: 'Soon',
    expiresAtUnixSeconds: CREATION_TIME_UNIX_SECONDS + 60,
    createsJoinRequest: false,
  });
  if (!creation.created) {
    throw new Error(`Expected the link to be created, received ${creation.reason}`);
  }
  clock.nowUnixSeconds += 3_600;

  const joining = chatAdmission.joinChatByInviteLink({
    accountId: graceId,
    inviteLinkUrl: creation.link.url,
  });

  expectEqual(
    [
      joining,
      publishedEvents.map((event) =>
        event.type === 'chat_member_status_changed'
          ? [event.memberId, event.changedAtUnixSeconds, event.inviteLink?.url]
          : event.type
      ),
    ],
    [
      { used: true, chatId, outcome: 'joined' },
      [[graceId, CREATION_TIME_UNIX_SECONDS + 3_600, creation.link.url]],
    ],
    'Expected only a test to make the expiry date arrive, as time does not pass by itself',
  );
});

Deno.test('ChatAdmissionService lets only the owner inspect invite links and join requests', () => {
  const { chatAdmission, chatId, botId, adaId, graceId } = createAdmissionFixture();
  const unknownChatId = -1_009_999_999_999;
  const inspect = (accountId: number, inspectedChatId: number) => {
    const inviteLinks = chatAdmission.getInviteLinksForAccount({
      accountId,
      chatId: inspectedChatId,
    });
    const joinRequests = chatAdmission.getJoinRequestsForAccount({
      accountId,
      chatId: inspectedChatId,
    });
    return [
      inviteLinks.found ? 'found' : inviteLinks.reason,
      joinRequests.found ? 'found' : joinRequests.reason,
    ];
  };

  expectEqual(
    [
      inspect(adaId, chatId),
      inspect(graceId, chatId),
      inspect(botId, chatId),
      inspect(adaId, unknownChatId),
    ],
    [
      ['found', 'found'],
      ['not_the_owner', 'not_the_owner'],
      ['account_not_found', 'account_not_found'],
      ['chat_not_found', 'chat_not_found'],
    ],
    'Expected both inspections to refuse an outsider, a bot and an unknown chat alike',
  );
});

Deno.test('ChatAdmissionService lets the bots that received a request contact its user until one claims it', () => {
  const {
    chatAdmission,
    publishedEvents,
    botId,
    coInviterBotId,
    observerBotId,
    graceId,
    hopperId,
    promote,
    requestToJoin,
    describeContacts,
  } = createRequesterContactFixture();
  requestToJoin(graceId);
  const mayContact = (userId: number) =>
    [botId, coInviterBotId, observerBotId].map((candidateId) =>
      chatAdmission.mayContactJoinRequester(candidateId, userId)
    );

  const requestEvent = publishedEvents.at(-1);
  const beforeClaim = [describeContacts(), mayContact(graceId), mayContact(hopperId)];
  chatAdmission.claimJoinRequesterContact(coInviterBotId, graceId);
  const afterClaim = [describeContacts(), mayContact(graceId)];
  let competingClaim = 'claimed';
  try {
    chatAdmission.claimJoinRequesterContact(botId, graceId);
  } catch {
    competingClaim = 'refused';
  }

  expectEqual(
    [
      requestEvent?.type === 'chat_join_requested' ? requestEvent.request.recipientBotIds : [],
      beforeClaim,
      afterClaim,
      competingClaim,
    ],
    [
      [botId, coInviterBotId],
      [[[graceId, 'open', [botId, coInviterBotId]]], [true, true, false], [false, false, false]],
      [[[graceId, 'claimed', [coInviterBotId]]], [false, true, false]],
      'refused',
    ],
    'Expected the recipients to share the open contact until the first claim made it its own',
  );

  // Rights count when the bot writes: the observer gains nothing, and the claimant loses its claim.
  promote(observerBotId, 'can_invite_users');
  promote(coInviterBotId, 'can_delete_messages');

  expectEqual(
    [describeContacts(), mayContact(graceId)],
    [[[graceId, 'claimed', []]], [false, false, false]],
    'Expected a bot promoted after the request to stay unrelated, and a demoted claimant to stop',
  );
});

Deno.test('ChatAdmissionService claims every request whose contact the bot may claim', () => {
  const {
    virtualUsers,
    sharedChatAdministration,
    chatAdmission,
    botId,
    adaId,
    graceId,
    requestToJoin,
  } = createRequesterContactFixture();
  // A second supergroup, Lab, where the inviter bot and a lab bot hold `can_invite_users`.
  const labCreation = sharedChatAdministration.createSupergroup({
    title: 'Lab',
    creatorAccountId: adaId,
  });
  const labBot = virtualUsers.createBot({ first_name: 'Lab', username: 'lab_bot' });
  if (!labCreation.created || !labBot.created) {
    throw new Error('Expected Lab and its bot to be created');
  }
  const labChatId = labCreation.supergroup.id;
  const labBotId = labBot.bot.profile.id;
  for (const memberId of [botId, labBotId]) {
    sharedChatAdministration.addChatMember({ actorAccountId: adaId, chatId: labChatId, memberId });
    sharedChatAdministration.promoteChatMember({
      actorAccountId: adaId,
      chatId: labChatId,
      memberId,
      rights: grantSupergroupAdministratorRights(['can_invite_users']),
    });
  }
  const labLink = chatAdmission.createInviteLinkAsBot({
    creatorBotId: labBotId,
    chatId: labChatId,
    name: '',
    createsJoinRequest: true,
  });
  if (!labLink.created) {
    throw new Error(`Expected the Lab link to be created, received ${labLink.reason}`);
  }
  requestToJoin(graceId);
  chatAdmission.joinChatByInviteLink({ accountId: graceId, inviteLinkUrl: labLink.link.url });

  chatAdmission.claimJoinRequesterContact(botId, graceId);
  const labRequests = chatAdmission.getJoinRequestsForAccount({
    accountId: adaId,
    chatId: labChatId,
  });

  expectEqual(
    [
      labRequests.found
        ? labRequests.requests.map(({ request, contactBotIds }) => [
          request.requesterContact,
          contactBotIds,
        ])
        : labRequests.reason,
      chatAdmission.mayContactJoinRequester(labBotId, graceId),
    ],
    [[[{ status: 'claimed', claimantBotId: botId }, [botId]]], false],
    "Expected the inviter's message to claim Grace's contact in Lab too, which the Lab bot loses",
  );
});

Deno.test('ChatAdmissionService ends a requester contact with its request or when a test expires it', () => {
  const {
    chatAdmission,
    chatId,
    botId,
    coInviterBotId,
    graceId,
    hopperId,
    inviteLinkUrl,
    requestToJoin,
    describeContacts,
  } = createRequesterContactFixture();
  requestToJoin(graceId);
  requestToJoin(hopperId);
  chatAdmission.claimJoinRequesterContact(botId, hopperId);

  // The link's expiry date arriving leaves the pending requests and their contacts alone.
  const linkExpiry = chatAdmission.expireInviteLink({ chatId, inviteLinkUrl });
  const afterLinkExpiry = describeContacts();
  const expiry = chatAdmission.expireJoinRequesterContact({ chatId, userId: graceId });
  const refusals = [
    chatAdmission.expireJoinRequesterContact({ chatId, userId: graceId }),
    chatAdmission.expireJoinRequesterContact({ chatId, userId: botId }),
    chatAdmission.expireJoinRequesterContact({ chatId: -1_009_999_999_999, userId: graceId }),
  ].map((result) => result.expired ? 'expired' : result.reason);
  const afterExpiry = [
    describeContacts(),
    chatAdmission.mayContactJoinRequester(botId, graceId),
    chatAdmission.mayContactJoinRequester(coInviterBotId, graceId),
  ];

  expectEqual(
    [
      linkExpiry.expired,
      afterLinkExpiry,
      expiry.expired ? [expiry.request.request.requesterContact, expiry.request.contactBotIds] : [],
      refusals,
      afterExpiry,
    ],
    [
      true,
      [[graceId, 'open', [botId, coInviterBotId]], [hopperId, 'claimed', [botId]]],
      [{ status: 'expired' }, []],
      ['requester_contact_already_expired', 'join_request_not_found', 'chat_not_found'],
      [[[graceId, 'expired', []], [hopperId, 'claimed', [botId]]], false, false],
    ],
    "Expected only the test's expiry to end Grace's contact, which leaves her request pending",
  );

  // Approving or declining a request ends its contact with it.
  const approval = chatAdmission.approveJoinRequestAsBot({
    deciderBotId: coInviterBotId,
    chatId,
    userId: graceId,
  });
  const decline = chatAdmission.declineJoinRequestAsBot({
    deciderBotId: coInviterBotId,
    chatId,
    userId: hopperId,
  });

  expectEqual(
    [
      approval.decided,
      decline.decided,
      describeContacts(),
      chatAdmission.mayContactJoinRequester(botId, hopperId),
    ],
    [true, true, [], false],
    'Expected the decisions to end both requests and their contacts',
  );
});

/**
 * Extends the requester contact fixture for decisions by accounts: Kay, an administrator account
 * holding `can_invite_users`; Ned, an administrator account without it; Pat, a plain member; Rae,
 * a restricted member; and Linus, an account outside the supergroup. Grace and Hopper have pending
 * requests, and the inviter bot claimed Grace's contact.
 */
function createAccountDecisionFixture() {
  const fixture = createRequesterContactFixture();
  const {
    virtualUsers,
    sharedChatAdministration,
    chatAdmission,
    publishedEvents,
    chatId,
    botId,
    adaId,
    graceId,
    hopperId,
    requestToJoin,
  } = fixture;
  const createAccount = (firstName: string) => {
    const creation = virtualUsers.createAccount({ first_name: firstName });
    if (!creation.created) {
      throw new Error(`Expected ${firstName} to be created`);
    }
    return creation.account.profile.id;
  };
  const createMember = (firstName: string) => {
    const memberId = createAccount(firstName);
    sharedChatAdministration.addChatMember({ actorAccountId: adaId, chatId, memberId });
    return memberId;
  };
  const setRights = (memberId: number, rights: readonly SupergroupAdministratorRight[]) =>
    sharedChatAdministration.promoteChatMember({
      actorAccountId: adaId,
      chatId,
      memberId,
      rights: grantSupergroupAdministratorRights(rights),
    });
  const kayId = createMember('Kay');
  setRights(kayId, ['can_invite_users']);
  const nedId = createMember('Ned');
  setRights(nedId, ['can_delete_messages']);
  const patId = createMember('Pat');
  const raeId = createMember('Rae');
  sharedChatAdministration.restrictChatMemberAsAccount({
    actorAccountId: adaId,
    chatId,
    memberId: raeId,
    permissions: new Set(['can_send_messages']),
  });
  const linusId = createAccount('Linus');
  requestToJoin(graceId);
  requestToJoin(hopperId);
  chatAdmission.claimJoinRequesterContact(botId, graceId);
  publishedEvents.length = 0;

  /** Decides as an account, answering `decided` or why the decision was refused. */
  const decideAsAccount = (
    deciderAccountId: number,
    userId: number,
    decision: JoinRequestDecision,
    decidedChatId = chatId,
  ) => {
    const result = chatAdmission.decideJoinRequestAsAccount({
      deciderAccountId,
      chatId: decidedChatId,
      userId,
      decision,
    });
    return result.decided ? 'decided' : result.reason;
  };
  /** Describes the published membership changes as `actor: member old -> new via link`. */
  const describeMembershipEvents = () =>
    publishedEvents.map((event) =>
      event.type === 'chat_member_status_changed'
        ? `${event.actorId}: ${event.memberId} ${event.oldStatus.status} -> ${event.newStatus.status} via ${event.inviteLink?.url}`
        : event.type
    );
  /** The request link's members and pending requests, as the owner inspects them. */
  const describeLinkUsage = () => {
    const inspection = chatAdmission.getInviteLinksForAccount({ accountId: adaId, chatId });
    return inspection.found
      ? inspection.links.map(({ memberCount, pendingJoinRequestCount }) => [
        memberCount,
        pendingJoinRequestCount,
      ])
      : inspection.reason;
  };

  return {
    ...fixture,
    kayId,
    nedId,
    patId,
    raeId,
    linusId,
    setRights,
    decideAsAccount,
    describeMembershipEvents,
    describeLinkUsage,
  };
}

Deno.test('ChatAdmissionService lets the owner and administrator accounts with the right decide', () => {
  const {
    chatAdmission,
    botId,
    coInviterBotId,
    adaId,
    kayId,
    graceId,
    hopperId,
    inviteLinkUrl,
    decideAsAccount,
    describeContacts,
    describeMembershipEvents,
    describeLinkUsage,
  } = createAccountDecisionFixture();

  // Kay, who administers with the right, approves Grace through the inviter bot's link.
  const approval = decideAsAccount(kayId, graceId, 'approve');
  const afterApproval = [
    describeMembershipEvents(),
    describeContacts(),
    describeLinkUsage(),
    chatAdmission.mayContactJoinRequester(botId, graceId),
  ];
  // Ada, the owner, declines Hopper, which publishes nothing.
  const decline = decideAsAccount(adaId, hopperId, 'decline');

  expectEqual(
    [
      approval,
      afterApproval,
      decline,
      describeMembershipEvents(),
      describeContacts(),
      describeLinkUsage(),
      [botId, coInviterBotId].map((candidateId) =>
        chatAdmission.mayContactJoinRequester(candidateId, hopperId)
      ),
    ],
    [
      'decided',
      [
        [`${kayId}: ${graceId} left -> member via ${inviteLinkUrl}`],
        [[hopperId, 'open', [botId, coInviterBotId]]],
        [[1, 1]],
        false,
      ],
      'decided',
      [`${kayId}: ${graceId} left -> member via ${inviteLinkUrl}`],
      [],
      [[1, 0]],
      [false, false],
    ],
    'Expected Kay to admit Grace as the actor, and Ada to decline Hopper, ending both contacts',
  );

  // Hopper may request again, with a new contact, after the decline.
  chatAdmission.joinChatByInviteLink({ accountId: hopperId, inviteLinkUrl });
  expectEqual(
    describeContacts(),
    [[hopperId, 'open', [botId, coInviterBotId]]],
    'Expected a declined account to be able to request again',
  );
});

Deno.test('ChatAdmissionService refuses account decisions by rights at decision time, changing nothing', () => {
  const {
    sharedChatAdministration,
    publishedEvents,
    chatId,
    botId,
    adaId,
    kayId,
    nedId,
    patId,
    raeId,
    linusId,
    graceId,
    hopperId,
    setRights,
    decideAsAccount,
    describeContacts,
  } = createAccountDecisionFixture();
  const basicGroup = sharedChatAdministration.createBasicGroup({
    title: 'Basic',
    creatorAccountId: adaId,
    initialMemberIds: [kayId],
  });
  if (!basicGroup.created) {
    throw new Error('Expected the basic group to be created');
  }
  const contactsBefore = describeContacts();

  const refusals = [
    decideAsAccount(999_999_999, graceId, 'approve'),
    decideAsAccount(botId, graceId, 'approve'),
    decideAsAccount(adaId, graceId, 'approve', -1_009_999_999_999),
    decideAsAccount(adaId, graceId, 'decline', basicGroup.group.id),
    decideAsAccount(linusId, graceId, 'approve'),
    decideAsAccount(patId, graceId, 'decline'),
    decideAsAccount(raeId, graceId, 'approve'),
    decideAsAccount(nedId, graceId, 'decline'),
    decideAsAccount(graceId, graceId, 'approve'),
    decideAsAccount(kayId, linusId, 'approve'),
    decideAsAccount(kayId, 999_999_999, 'decline'),
    decideAsAccount(kayId, patId, 'approve'),
    decideAsAccount(kayId, botId, 'decline'),
  ];
  // Rights count when the account decides: Kay loses `can_invite_users`, then her administration.
  setRights(kayId, ['can_delete_messages']);
  const afterLosingRight = decideAsAccount(kayId, graceId, 'approve');
  sharedChatAdministration.demoteChatMember({ actorAccountId: adaId, chatId, memberId: kayId });
  const afterDemotion = decideAsAccount(kayId, hopperId, 'decline');

  expectEqual(
    [refusals, afterLosingRight, afterDemotion],
    [
      [
        'account_not_found',
        'account_not_found',
        'chat_not_found',
        'chat_not_found',
        'not_enough_rights',
        'not_enough_rights',
        'not_enough_rights',
        'not_enough_rights',
        'not_enough_rights',
        'join_request_missing',
        'join_request_missing',
        'already_a_member',
        'already_a_member',
      ],
      'not_enough_rights',
      'not_enough_rights',
    ],
    'Expected each refusal in the order TDLib and then Telegram check them',
  );
  expectEqual(
    [
      describeContacts(),
      publishedEvents.filter((event) =>
        event.type !== 'chat_member_status_changed' || event.memberId !== kayId
      ),
    ],
    [contactsBefore, []],
    "Expected the refusals to keep both requests with their contacts, publishing only Kay's changes",
  );
});

Deno.test('ChatAdmissionService decides each request once among accounts and bots', () => {
  const {
    chatAdmission,
    publishedEvents,
    chatId,
    botId,
    coInviterBotId,
    adaId,
    kayId,
    graceId,
    hopperId,
    linusId,
    inviteLinkUrl,
    decideAsAccount,
    describeContacts,
    describeMembershipEvents,
    describeLinkUsage,
  } = createAccountDecisionFixture();
  chatAdmission.joinChatByInviteLink({ accountId: linusId, inviteLinkUrl });
  publishedEvents.length = 0;
  const decideAsBot = (
    deciderBotId: number,
    userId: number,
    decision: JoinRequestDecision,
  ) => {
    const input = { deciderBotId, chatId, userId };
    const result = decision === 'approve'
      ? chatAdmission.approveJoinRequestAsBot(input)
      : chatAdmission.declineJoinRequestAsBot(input);
    return result.decided ? 'decided' : result.reason;
  };

  const outcomes = [
    // Kay approves Grace before the bots and Ada.
    decideAsAccount(kayId, graceId, 'approve'),
    decideAsBot(botId, graceId, 'approve'),
    decideAsBot(coInviterBotId, graceId, 'decline'),
    decideAsAccount(adaId, graceId, 'decline'),
    // Ada declines Hopper before the bot and Kay.
    decideAsAccount(adaId, hopperId, 'decline'),
    decideAsBot(botId, hopperId, 'approve'),
    decideAsAccount(kayId, hopperId, 'approve'),
    // The bot approves Linus before Kay.
    decideAsBot(botId, linusId, 'approve'),
    decideAsAccount(kayId, linusId, 'decline'),
  ];

  expectEqual(
    [outcomes, describeMembershipEvents(), describeContacts(), describeLinkUsage()],
    [
      [
        'decided',
        'already_a_member',
        'already_a_member',
        'already_a_member',
        'decided',
        'join_request_missing',
        'join_request_missing',
        'decided',
        'already_a_member',
      ],
      [
        `${kayId}: ${graceId} left -> member via ${inviteLinkUrl}`,
        `${botId}: ${linusId} left -> member via ${inviteLinkUrl}`,
      ],
      [],
      [[2, 0]],
    ],
    'Expected the first decision of each request to win, admitting each approved account once',
  );
});

/**
 * Extends the requester contact fixture for link lifecycles: Linus, another account outside the
 * supergroup, and helpers that create, edit and revoke links as a bot, use them as an account, and
 * inspect them as the owner.
 */
function createInviteLinkLifecycleFixture() {
  const fixture = createRequesterContactFixture();
  const { virtualUsers, chatAdmission, chatId, botId, adaId } = fixture;
  const linus = virtualUsers.createAccount({ first_name: 'Linus' });
  if (!linus.created) {
    throw new Error('Expected Linus to be created');
  }
  const createLink = (
    settings: Partial<RequestedInviteLinkSettings> = {},
    creatorBotId = botId,
  ) => {
    const creation = chatAdmission.createInviteLinkAsBot({
      creatorBotId,
      chatId,
      name: '',
      createsJoinRequest: false,
      ...settings,
    });
    if (!creation.created) {
      throw new Error(`Expected the link to be created, received ${creation.reason}`);
    }
    return creation.link.url;
  };
  const edit = (
    input: Partial<EditInviteLinkAsBotInput> & { readonly inviteLinkUrl: string },
  ) => {
    const result = chatAdmission.editInviteLinkAsBot({
      editorBotId: botId,
      chatId,
      name: '',
      createsJoinRequest: false,
      ...input,
    });
    return result.edited ? result.link : result.reason;
  };
  const revoke = (inviteLinkUrl: string, revokerBotId = botId, revokedChatId = chatId) => {
    const result = chatAdmission.revokeInviteLinkAsBot({
      revokerBotId,
      chatId: revokedChatId,
      inviteLinkUrl,
    });
    return result.revoked ? result.link : result.reason;
  };
  const join = (accountId: number, inviteLinkUrl: string) => {
    const result = chatAdmission.joinChatByInviteLink({ accountId, inviteLinkUrl });
    return result.used ? result.outcome : result.reason;
  };
  /** A link as the owner inspects it: its state, members joined through it and pending requests. */
  const inspectLink = (inviteLinkUrl: string) => {
    const inspection = chatAdmission.getInviteLinksForAccount({ accountId: adaId, chatId });
    if (!inspection.found) {
      throw new Error(`Expected the owner to inspect the links, received ${inspection.reason}`);
    }
    const usage = inspection.links.find(({ link }) => link.url === inviteLinkUrl);
    if (usage === undefined) {
      throw new Error(`Expected link ${inviteLinkUrl} to be listed`);
    }
    return {
      link: usage.link,
      memberCount: usage.memberCount,
      pendingJoinRequestCount: usage.pendingJoinRequestCount,
    };
  };

  return {
    ...fixture,
    linusId: linus.account.profile.id,
    createLink,
    edit,
    revoke,
    join,
    inspectLink,
  };
}

Deno.test('ChatAdmissionService replaces every setting of a link its creator edits', () => {
  const { clock, chatId, botId, createLink, edit, inspectLink } =
    createInviteLinkLifecycleFixture();
  const inviteLinkUrl = createLink({
    name: 'Spring',
    expiresAtUnixSeconds: CREATION_TIME_UNIX_SECONDS + 3_600,
    memberLimit: 5,
  });
  clock.nowUnixSeconds += 60;
  const unchangedFields = {
    url: inviteLinkUrl,
    chatId,
    creatorId: botId,
    createdAtUnixSeconds: CREATION_TIME_UNIX_SECONDS,
  };

  const renamed = edit({
    inviteLinkUrl,
    name: `  Autumn\tsign-ups ${'x'.repeat(40)}`,
    expiresAtUnixSeconds: CREATION_TIME_UNIX_SECONDS + 7_200,
    memberLimit: 3,
  });
  const afterRename = inspectLink(inviteLinkUrl).link;
  // An edit that names only the request setting leaves no name, expiry date or member limit.
  const cleared = edit({ inviteLinkUrl, createsJoinRequest: true });
  const afterClearing = inspectLink(inviteLinkUrl).link;

  const renamedLink = {
    ...unchangedFields,
    name: `Autumn sign-ups ${'x'.repeat(16)}`,
    expiresAtUnixSeconds: CREATION_TIME_UNIX_SECONDS + 7_200,
    memberLimit: 3,
    createsJoinRequest: false,
    isPrimary: false,
    hasExpired: false,
    isRevoked: false,
  };
  const clearedLink = {
    ...unchangedFields,
    createsJoinRequest: true,
    isPrimary: false,
    hasExpired: false,
    isRevoked: false,
  };
  expectEqual(
    [renamed, afterRename, cleared, afterClearing].map(toCanonicalJson),
    [renamedLink, renamedLink, clearedLink, clearedLink].map(toCanonicalJson),
    'Expected each edit to replace the name, expiry date, member limit and request setting',
  );
});

Deno.test('ChatAdmissionService refuses an invalid edit or revocation without changing anything', () => {
  const {
    virtualUsers,
    sharedChatAdministration,
    chatAdmission,
    chatId,
    botId,
    coInviterBotId,
    adaId,
    graceId,
    promote,
    createLink,
    edit,
    revoke,
    inspectLink,
    describeContacts,
    requestToJoin,
  } = createInviteLinkLifecycleFixture();
  const inviteLinkUrl = createLink({ name: 'Kept', memberLimit: 2 });
  const coInviterLinkUrl = createLink({ name: 'Theirs' }, coInviterBotId);
  // A second supergroup, Lab, where the inviter bot also creates a link.
  const lab = sharedChatAdministration.createSupergroup({ title: 'Lab', creatorAccountId: adaId });
  const outsider = virtualUsers.createBot({ first_name: 'Outsider', username: 'outsider_bot' });
  if (!lab.created || !outsider.created) {
    throw new Error('Expected Lab and the outsider bot to be created');
  }
  const labChatId = lab.supergroup.id;
  sharedChatAdministration.addChatMember({
    actorAccountId: adaId,
    chatId: labChatId,
    memberId: botId,
  });
  sharedChatAdministration.promoteChatMember({
    actorAccountId: adaId,
    chatId: labChatId,
    memberId: botId,
    rights: grantSupergroupAdministratorRights(['can_invite_users']),
  });
  const labLink = chatAdmission.createInviteLinkAsBot({
    creatorBotId: botId,
    chatId: labChatId,
    name: '',
    createsJoinRequest: false,
  });
  if (!labLink.created) {
    throw new Error(`Expected the Lab link to be created, received ${labLink.reason}`);
  }
  // The outsider bot was a member of Team and left it.
  sharedChatAdministration.addChatMember({
    actorAccountId: adaId,
    chatId,
    memberId: outsider.bot.profile.id,
  });
  sharedChatAdministration.leaveChat({ memberId: outsider.bot.profile.id, chatId });
  requestToJoin(graceId);
  const describeLinks = () =>
    toCanonicalJson([inspectLink(inviteLinkUrl), inspectLink(coInviterLinkUrl)]);
  const linksBefore = describeLinks();
  const contactsBefore = toCanonicalJson(describeContacts());

  const editRefusals = [
    edit({ inviteLinkUrl, editorBotId: outsider.bot.profile.id }),
    edit({ inviteLinkUrl, chatId: -1_009_999_999_999 }),
    edit({ inviteLinkUrl, name: 'Broken \ud800' }),
    edit({ inviteLinkUrl: `${inviteLinkUrl}\udc00` }),
    edit({ inviteLinkUrl, createsJoinRequest: true, memberLimit: 1 }),
    edit({ inviteLinkUrl: '' }),
    edit({ inviteLinkUrl: 'https://t.me/+AAAAAAAAAAAAAAAA' }),
    edit({ inviteLinkUrl: labLink.link.url }),
    edit({ inviteLinkUrl: coInviterLinkUrl }),
    edit({ inviteLinkUrl, expiresAtUnixSeconds: CREATION_TIME_UNIX_SECONDS }),
    edit({ inviteLinkUrl, memberLimit: 100_000 }),
  ];
  const revocationRefusals = [
    revoke(inviteLinkUrl, outsider.bot.profile.id),
    revoke(`${inviteLinkUrl}\udc00`),
    revoke(''),
    revoke(labLink.link.url),
    revoke(inviteLinkUrl, botId, labChatId),
    revoke(coInviterLinkUrl),
  ];
  const contactsUnchanged = toCanonicalJson(describeContacts()) === contactsBefore;
  // Losing `can_invite_users` ends the creator's management of its links, which is checked before
  // the member limit of a link that creates join requests.
  promote(botId, 'can_delete_messages');
  const afterDemotion = [
    edit({ inviteLinkUrl, createsJoinRequest: true, memberLimit: 1 }),
    revoke(inviteLinkUrl),
  ];

  expectEqual(
    [
      editRefusals,
      revocationRefusals,
      afterDemotion,
      [describeLinks() === linksBefore, contactsUnchanged],
    ],
    [
      [
        'bot_not_a_member',
        'chat_not_found',
        'text_encoding_invalid',
        'text_encoding_invalid',
        'member_limit_with_join_request',
        'invite_link_empty',
        'invite_link_not_found',
        'invite_link_not_found',
        'not_the_link_creator',
        'expiry_date_invalid',
        'member_limit_invalid',
      ],
      [
        'bot_not_a_member',
        'text_encoding_invalid',
        'invite_link_empty',
        'invite_link_not_found',
        'invite_link_not_found',
        'not_the_link_creator',
      ],
      ['not_enough_rights', 'not_enough_rights'],
      [true, true],
    ],
    'Expected each refusal in check order, leaving the links and pending requests as they were',
  );
});

Deno.test('ChatAdmissionService revokes a link for good, keeping its members and pending requests', () => {
  const {
    chatAdmission,
    chatId,
    botId,
    graceId,
    hopperId,
    linusId,
    inviteLinkUrl,
    createLink,
    edit,
    revoke,
    join,
    inspectLink,
    describeContacts,
    requestToJoin,
  } = createInviteLinkLifecycleFixture();
  const directLinkUrl = createLink({ memberLimit: 1 });
  join(hopperId, directLinkUrl);
  requestToJoin(graceId);
  chatAdmission.claimJoinRequesterContact(botId, graceId);

  const revocations = [revoke(inviteLinkUrl), revoke(directLinkUrl)].map((result) =>
    typeof result === 'string' ? result : [result.isRevoked, result.hasExpired]
  );
  const afterRevocation = [
    join(linusId, inviteLinkUrl),
    join(linusId, directLinkUrl),
    revoke(inviteLinkUrl),
    edit({ inviteLinkUrl, createsJoinRequest: true }),
    describeContacts(),
    chatAdmission.mayContactJoinRequester(botId, graceId),
  ];
  // Time still passes for a revoked link, and an administrator still decides its requests.
  const expiry = chatAdmission.expireInviteLink({ chatId, inviteLinkUrl });
  const approval = chatAdmission.approveJoinRequestAsBot({
    deciderBotId: botId,
    chatId,
    userId: graceId,
  });

  expectEqual(
    [
      revocations,
      afterRevocation,
      expiry.expired,
      approval.decided,
      [inspectLink(inviteLinkUrl), inspectLink(directLinkUrl)].map((
        { link, memberCount, pendingJoinRequestCount },
      ) => [link.isRevoked, link.hasExpired, memberCount, pendingJoinRequestCount]),
    ],
    [
      [[true, false], [true, false]],
      [
        'invite_link_revoked',
        'invite_link_revoked',
        'invite_link_revoked',
        'invite_link_revoked',
        [[graceId, 'claimed', [botId]]],
        true,
      ],
      true,
      true,
      [[true, true, 1, 0], [true, false, 1, 0]],
    ],
    'Expected revoked links to admit nobody new while their members and requests stay',
  );
});

Deno.test('ChatAdmissionService applies an edit to later uses only, and revives an expired link', () => {
  const {
    chatAdmission,
    chatId,
    botId,
    coInviterBotId,
    graceId,
    hopperId,
    linusId,
    createLink,
    edit,
    join,
    inspectLink,
    describeContacts,
  } = createInviteLinkLifecycleFixture();
  const inviteLinkUrl = createLink({
    expiresAtUnixSeconds: CREATION_TIME_UNIX_SECONDS + 3_600,
    createsJoinRequest: true,
  });
  join(graceId, inviteLinkUrl);
  chatAdmission.expireInviteLink({ chatId, inviteLinkUrl });
  const whileExpired = join(hopperId, inviteLinkUrl);

  // Without an expiry date or join requests, and with a member limit, the link admits directly.
  const revival = edit({ inviteLinkUrl, memberLimit: 1 });
  const afterRevival = [join(hopperId, inviteLinkUrl), join(linusId, inviteLinkUrl)];
  const contactsAfterRevival = describeContacts();
  const usageAfterRevival = inspectLink(inviteLinkUrl);
  // Grace's request, sent while the link created requests, is still decided as one; approving it
  // admits her through the link beyond its member limit, as an administrator's decision.
  const approval = chatAdmission.approveJoinRequestAsBot({
    deciderBotId: botId,
    chatId,
    userId: graceId,
  });
  // A new expiry date that a test makes arrive ends the link again, until the next edit.
  edit({ inviteLinkUrl, expiresAtUnixSeconds: CREATION_TIME_UNIX_SECONDS + 60, memberLimit: 5 });
  const secondExpiry = chatAdmission.expireInviteLink({ chatId, inviteLinkUrl });

  expectEqual(
    [
      whileExpired,
      typeof revival === 'string'
        ? revival
        : [revival.hasExpired, 'expiresAtUnixSeconds' in revival, revival.memberLimit],
      afterRevival,
      contactsAfterRevival,
      [
        usageAfterRevival.link.createsJoinRequest,
        usageAfterRevival.memberCount,
        usageAfterRevival.pendingJoinRequestCount,
      ],
      approval.decided,
      secondExpiry.expired
        ? [secondExpiry.link.link.hasExpired, secondExpiry.link.memberCount]
        : secondExpiry.reason,
      join(linusId, inviteLinkUrl),
    ],
    [
      'invite_link_expired',
      [false, false, 1],
      ['joined', 'invite_link_member_limit_reached'],
      [[graceId, 'open', [botId, coInviterBotId]]],
      [false, 1, 1],
      true,
      [true, 2],
      'invite_link_expired',
    ],
    'Expected the edits to change later uses only, leaving the pending request to a decision',
  );
});

/** JSON of a value with its object keys sorted, so that comparisons ignore key order. */
function toCanonicalJson(value: unknown): string {
  return JSON.stringify(
    value,
    (_key, nestedValue) =>
      typeof nestedValue === 'object' && nestedValue !== null && !Array.isArray(nestedValue)
        ? Object.fromEntries(Object.entries(nestedValue).sort(([a], [b]) => a.localeCompare(b)))
        : nestedValue,
  );
}

Deno.test('ChatAdmissionService replaces a bot primary link in one step when it exports or revokes it', () => {
  const { clock, chatAdmission, chatId, botId, adaId } = createAdmissionFixture();
  const exportLink = () => {
    const result = chatAdmission.exportPrimaryInviteLinkAsBot({ exporterBotId: botId, chatId });
    if (!result.exported) {
      throw new Error(`Expected the primary link to be exported, received ${result.reason}`);
    }
    return result.link;
  };
  const currentPrimaryUrl = () => chatAdmission.findPrimaryInviteLinkOfBot({ botId, chatId })?.url;
  /** Each link of the chat as `[url, created at, primary, revoked]`. */
  const describeLinks = () => {
    const inspection = chatAdmission.getInviteLinksForAccount({ accountId: adaId, chatId });
    return inspection.found
      ? inspection.links.map(({ link }) => [
        link.url,
        link.createdAtUnixSeconds,
        link.isPrimary,
        link.isRevoked,
      ])
      : inspection.reason;
  };

  const first = exportLink();
  clock.nowUnixSeconds += 60;
  const second = exportLink();
  const afterSecondExport = currentPrimaryUrl();
  clock.nowUnixSeconds += 60;
  const revocation = chatAdmission.revokeInviteLinkAsBot({
    revokerBotId: botId,
    chatId,
    inviteLinkUrl: second.url,
  });
  const replacementUrl = currentPrimaryUrl();
  const edit = chatAdmission.editInviteLinkAsBot({
    editorBotId: botId,
    chatId,
    inviteLinkUrl: replacementUrl ?? '',
    name: 'Main',
    createsJoinRequest: false,
  });

  expectEqual(
    [
      { ...first, url: '' },
      afterSecondExport === second.url,
      revocation.revoked ? [revocation.link.url, revocation.link.isRevoked] : revocation.reason,
      edit.edited ? 'edited' : edit.reason,
      describeLinks(),
    ],
    [
      {
        chatId,
        creatorId: botId,
        createdAtUnixSeconds: CREATION_TIME_UNIX_SECONDS,
        isPrimary: true,
        createsJoinRequest: false,
        url: '',
        hasExpired: false,
        isRevoked: false,
      },
      true,
      [second.url, true],
      'primary_invite_link_not_editable',
      [
        [first.url, CREATION_TIME_UNIX_SECONDS, true, true],
        [second.url, CREATION_TIME_UNIX_SECONDS + 60, true, true],
        [replacementUrl, CREATION_TIME_UNIX_SECONDS + 120, true, false],
      ],
    ],
    'Expected each export and revocation to leave one current primary link without settings',
  );
});

Deno.test('ChatAdmissionService shows a primary link while its creator holds can_invite_users', () => {
  const { sharedChatAdministration, chatAdmission, chatId, botId, adaId, graceId } =
    createAdmissionFixture();
  const exportation = chatAdmission.exportPrimaryInviteLinkAsBot({ exporterBotId: botId, chatId });
  if (!exportation.exported) {
    throw new Error(`Expected the primary link to be exported, received ${exportation.reason}`);
  }
  const promote = (right: SupergroupAdministratorRight) =>
    sharedChatAdministration.promoteChatMember({
      actorAccountId: adaId,
      chatId,
      memberId: botId,
      rights: grantSupergroupAdministratorRights([right]),
    });

  promote('can_delete_messages');
  const whileDemoted = [
    chatAdmission.findPrimaryInviteLinkOfBot({ botId, chatId })?.url,
    chatAdmission.exportPrimaryInviteLinkAsBot({ exporterBotId: botId, chatId }),
    chatAdmission.joinChatByInviteLink({ accountId: graceId, inviteLinkUrl: exportation.link.url }),
  ];
  promote('can_invite_users');
  const afterRepromotion = chatAdmission.findPrimaryInviteLinkOfBot({ botId, chatId })?.url;

  expectEqual(
    [whileDemoted, afterRepromotion],
    [
      [
        undefined,
        { exported: false, reason: 'not_enough_rights' },
        { used: true, chatId, outcome: 'joined' },
      ],
      exportation.link.url,
    ],
    'Expected the link to keep admitting accounts while only its visibility follows the right',
  );
});
