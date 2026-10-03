import { AccountRepository } from '../src/repositories/account.ts';
import { BotRepository } from '../src/repositories/bot.ts';
import { ChatInviteLinkRepository } from '../src/repositories/chat_invite_link.ts';
import { SharedChatRepository } from '../src/repositories/shared_chat.ts';
import { TelegramIdentityRepository } from '../src/repositories/telegram_identity.ts';
import { ChatAdmissionService } from '../src/services/chat_admission.ts';
import { SharedChatAdministrationService } from '../src/services/shared_chat_administration.ts';
import { VirtualUserService } from '../src/services/virtual_user.ts';
import type { ChatDomainEvent } from '../src/types/chat_domain_event.ts';
import { grantSupergroupAdministratorRights } from '../src/types/chat_membership.ts';

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
    chatAdmission,
    publishedEvents,
    chatId,
    botId,
    graceId: grace.account.profile.id,
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
