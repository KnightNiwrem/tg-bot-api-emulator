import { AccountRepository } from '../src/repositories/account.ts';
import { BotRepository } from '../src/repositories/bot.ts';
import { ChatInviteLinkRepository } from '../src/repositories/chat_invite_link.ts';
import { SharedChatRepository } from '../src/repositories/shared_chat.ts';
import { TelegramIdentityRepository } from '../src/repositories/telegram_identity.ts';
import { ChatAdmissionService } from '../src/services/chat_admission.ts';
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
