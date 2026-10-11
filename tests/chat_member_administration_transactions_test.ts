import { assertEquals, assertNotEquals, assertRejects, assertThrows } from '@std/assert';

import {
  grantSupergroupAdministratorRights,
  type SupergroupAdministratorRight,
} from '../src/types/chat_membership.ts';
import type { ChatMemberStatusChangedEvent } from '../src/types/chat_domain_event.ts';
import type { VirtualBotProfile } from '../src/types/virtual_bot.ts';
import {
  createBotApiCommandSession,
  FAILED_RECORDING_MESSAGE,
} from './support/bot_api_command_session.ts';

const FAILED_VIEW_MESSAGE = 'The view failed';

Deno.test("a bot's ban whose projection fails after one bot commits nothing", async () => {
  const fixture = await createAdministrationFixture();
  const stateBefore = fixture.readState();
  // Alpha's `chat_member` update is staged before Beta's view fails.
  const restoreViews = fixture.failMemberChangeViewsFor(fixture.beta.id);

  await assertRejects(
    () =>
      fixture.callMethod(fixture.alpha, 'banChatMember', {
        chat_id: String(fixture.chatId),
        user_id: String(fixture.graceId),
      }),
    Error,
    FAILED_VIEW_MESSAGE,
  );
  restoreViews();

  assertEquals(fixture.readState(), stateBefore);
});

Deno.test("an owner's removal outside any command commits nothing when a projection fails", async () => {
  const fixture = await createAdministrationFixture();
  const stateBefore = fixture.readState();
  const restoreViews = fixture.failMemberChangeViewsFor(fixture.beta.id);

  assertThrows(
    () =>
      fixture.session.sharedChatAdministration.removeChatMember({
        actorAccountId: fixture.adaId,
        chatId: fixture.chatId,
        memberId: fixture.graceId,
      }),
    Error,
    FAILED_VIEW_MESSAGE,
  );
  restoreViews();

  assertEquals(fixture.readState(), stateBefore);
});

Deno.test('a promotion, restriction or chat change whose record fails commits nothing', async () => {
  const fixture = await createAdministrationFixture();
  const changes = [
    ['promoteChatMember', { user_id: String(fixture.graceId), can_change_info: 'true' }],
    ['restrictChatMember', {
      user_id: String(fixture.graceId),
      permissions: JSON.stringify({ can_send_messages: false }),
    }],
    ['setChatTitle', { title: 'Renamed' }],
    ['setChatDescription', { description: 'Renamed' }],
    ['setChatPermissions', { permissions: JSON.stringify({ can_send_messages: false }) }],
  ] as const;

  for (const [methodName, changeParameters] of changes) {
    const parameters = { chat_id: String(fixture.chatId), ...changeParameters };
    const stateBefore = fixture.readState();
    const restoreRecording = fixture.failCallRecording();
    await assertRejects(
      () => fixture.callMethod(fixture.alpha, methodName, parameters),
      Error,
      FAILED_RECORDING_MESSAGE,
    );
    restoreRecording();
    assertEquals(fixture.readState(), stateBefore, `${methodName} left a change behind`);

    // The same call changes the supergroup once its record succeeds.
    await fixture.callMethodExpectingResult(fixture.alpha, methodName, parameters);
    assertNotEquals(fixture.readState(), stateBefore, `${methodName} changed nothing`);
  }
});

Deno.test('a ban prepared before the bot lost its right is not committed', async () => {
  const fixture = await createAdministrationFixture();
  const reply = fixture.holdWebhookReply(fixture.alpha, {
    method: 'banChatMember',
    chat_id: String(fixture.chatId),
    user_id: String(fixture.graceId),
  });

  // Ada takes Alpha's right to restrict members while the reply is still being read.
  fixture.promote(fixture.alpha, ['can_pin_messages']);
  const stateBeforeRelease = fixture.readState();
  await reply.release();

  assertEquals(fixture.readState(), {
    ...stateBeforeRelease,
    activityHead: stateBeforeRelease.activityHead + 1,
  });
  assertEquals(await fixture.lastRecordedAnswer(), {
    ok: false,
    error_code: 400,
    description: 'Bad Request: not enough rights to restrict/unrestrict chat member',
  });
});

Deno.test('a change prepared before its session ended commits nothing', async () => {
  const fixture = await createAdministrationFixture();
  const replies = [
    fixture.holdWebhookReply(fixture.alpha, {
      method: 'banChatMember',
      chat_id: String(fixture.chatId),
      user_id: String(fixture.graceId),
    }),
    fixture.holdWebhookReply(fixture.alpha, {
      method: 'setChatTitle',
      chat_id: String(fixture.chatId),
      title: 'Renamed',
    }),
  ];
  const stateBefore = fixture.readState();

  fixture.session.end();
  for (const reply of replies) {
    await reply.release();
  }

  assertEquals(fixture.readState(), stateBefore);
});

/**
 * A supergroup of Ada's with Grace as a member and Alpha and Beta as administrator bots that
 * observe members' changes; Alpha may restrict and promote members and change the chat's info.
 */
async function createAdministrationFixture() {
  const harness = createBotApiCommandSession('chat-member-administration-transactions');
  const { session } = harness;
  const adaId = harness.createAccount('Ada');
  const graceId = harness.createAccount('Grace');
  const alpha = harness.createBot('alpha_bot');
  const beta = harness.createBot('beta_bot');
  const creation = session.sharedChatAdministration.createSupergroup({
    title: 'Team',
    creatorAccountId: adaId,
  });
  if (!creation.created) {
    throw new Error(`Expected the supergroup to be created: ${creation.reason}`);
  }
  const chatId = creation.supergroup.id;
  const promote = (bot: VirtualBotProfile, rights: readonly SupergroupAdministratorRight[]) => {
    const promotion = session.sharedChatAdministration.promoteChatMember({
      actorAccountId: adaId,
      chatId,
      memberId: bot.id,
      rights: grantSupergroupAdministratorRights(rights),
    });
    if (!promotion.promoted) {
      throw new Error(`Expected ${bot.username} to be promoted: ${promotion.reason}`);
    }
  };
  for (const memberId of [graceId, alpha.id, beta.id]) {
    session.sharedChatAdministration.addChatMember({ actorAccountId: adaId, chatId, memberId });
  }
  promote(alpha, ['can_restrict_members', 'can_promote_members', 'can_change_info']);
  promote(beta, ['can_invite_users']);
  for (const bot of [alpha, beta]) {
    await harness.callMethodExpectingResult(bot, 'getUpdates', {
      allowed_updates: JSON.stringify(['message', 'chat_member']),
    });
  }

  return {
    ...harness,
    adaId,
    graceId,
    alpha,
    beta,
    chatId,
    promote,
    /**
     * Makes the session's views of members' changes fail for one observer, as a projector that
     * breaks an invariant would, until the returned function is called.
     */
    failMemberChangeViewsFor: (observerId: number): () => void => {
      const views = session.botMessageViews;
      const viewChatMemberChange = views.viewChatMemberChange.bind(views);
      views.viewChatMemberChange = (event: ChatMemberStatusChangedEvent, observerBotId: number) => {
        if (observerBotId === observerId) {
          throw new Error(FAILED_VIEW_MESSAGE);
        }
        return viewChatMemberChange(event, observerBotId);
      };
      return () => {
        views.viewChatMemberChange = viewChatMemberChange;
      };
    },
    /** The supergroup as its readers see it, through reads that record nothing. */
    readState: () => {
      const graceStatus = session.sharedChatAdministration.getChatMemberStatus({
        observerBotId: alpha.id,
        chatId,
        userId: graceId,
      });
      const supergroup = session.sharedChatAdministration.getReadableSupergroup({
        observerBotId: alpha.id,
        chatId,
      });
      const history = session.supergroupMessaging.getMessageHistory({ accountId: adaId, chatId });
      return {
        graceStatus: graceStatus.found ? graceStatus.status : graceStatus.reason,
        supergroup: supergroup.found
          ? {
            title: supergroup.supergroup.title,
            description: supergroup.supergroup.description,
            defaultPermissions: [...supergroup.supergroup.defaultPermissions],
          }
          : supergroup.reason,
        messageCount: history.found ? history.messages.length : history.reason,
        pendingUpdates: harness.countPendingUpdates([alpha, beta]),
        activityHead: session.botActivity.getHeadPosition(),
      };
    },
  };
}
