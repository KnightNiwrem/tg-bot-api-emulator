import { assertEquals } from '@std/assert';
import type { BotApiCallContext } from '../src/api/sessions/bot_api/method_call.ts';
import { findBotApiMethod } from '../src/api/sessions/bot_api/method_catalogue.ts';
import { callBotApiMethod } from '../src/api/sessions/bot_api/method_invocation.ts';
import { runWebhookReply } from '../src/api/sessions/bot_api/webhook_reply.ts';
import type { BotApiUpdateType } from '../src/types/bot_api.ts';
import {
  grantSupergroupAdministratorRights,
  type SupergroupAdministratorRight,
} from '../src/types/chat_membership.ts';
import type { ChatMemberStatusChangedEvent } from '../src/types/chat_domain_event.ts';
import type { VirtualBotProfile } from '../src/types/virtual_bot.ts';
import { HeldWebhookReply } from './support/bot_api_command_session.ts';
import { assertEqualsInFieldOrder } from './support/field_order_assertion.ts';
import { buildSessionServices } from './support/session_services.ts';
import { createStagedSessionFixture, FAILED_VIEW_MESSAGE } from './support/staged_session.ts';
import { createVirtualAccount, createVirtualBot } from './support/virtual_users.ts';

const SUBSCRIBED_UPDATE_TYPES: ReadonlySet<BotApiUpdateType> = new Set([
  'message',
  'chat_member',
  'chat_join_request',
]);

Deno.test('an approval whose projection fails after one administrator bot commits nothing', () => {
  const fixture = createJoinRequestFixture();
  const stateBefore = fixture.readState();
  const approve = () =>
    fixture.transactions.execute(() =>
      fixture.chatAdmission.approveJoinRequestAsBot({
        deciderBotId: fixture.alpha,
        chatId: fixture.chatId,
        userId: fixture.graceId,
      })
    );

  // Alpha's `chat_member` update is staged before Beta's fails.
  fixture.views.failingObserverId = fixture.beta;
  const failedApproval = captureError(approve);
  const stateAfterFailure = fixture.readState();
  fixture.views.failingObserverId = undefined;
  const approval = approve();
  const alphaUpdates = fixture.botUpdates.readPendingUpdates(fixture.alpha);

  assertEquals(
    {
      failedApproval,
      stateAfterFailure,
      approval,
      alphaUpdates: alphaUpdates.map((update) => ({
        updateId: update.update_id,
        chatMember: 'chat_member' in update,
        serviceMessageId: 'message' in update ? update.message.message_id : null,
      })),
    },
    {
      failedApproval: FAILED_VIEW_MESSAGE,
      stateAfterFailure: stateBefore,
      approval: { executed: true, result: { decided: true } },
      alphaUpdates: [
        { updateId: stateBefore.updates[0].nextUpdateId, chatMember: true, serviceMessageId: null },
        {
          updateId: stateBefore.updates[0].nextUpdateId + 1,
          chatMember: false,
          serviceMessageId: stateBefore.messageCount + 1,
        },
      ],
    },
    'Expected the failed approval to leave the request pending and use up no ID',
  );
});

Deno.test('an account approval outside any command commits nothing when a projection fails', () => {
  const fixture = createJoinRequestFixture();
  const stateBefore = fixture.readState();

  fixture.views.failingObserverId = fixture.beta;
  const failedApproval = captureError(() =>
    fixture.chatAdmission.decideJoinRequestAsAccount({
      deciderAccountId: fixture.adaId,
      chatId: fixture.chatId,
      userId: fixture.graceId,
      decision: 'approve',
    })
  );

  assertEquals(
    { failedApproval, state: fixture.readState() },
    { failedApproval: FAILED_VIEW_MESSAGE, state: stateBefore },
    'Expected the approval to run as a transaction of its own and to be reverted whole',
  );
});

Deno.test('a consumer that fails once an approval is published undoes nothing', async () => {
  const fixture = createJoinRequestFixture();
  const { alpha, botUpdates } = fixture;
  const longPoll = botUpdates.waitForUpdate(alpha, {
    awaitedUpdateId: botUpdates.getNextUpdateId(alpha),
  });

  const approval = fixture.transactions.execute(() => {
    fixture.journal.notifyAfterPublication(() => {
      throw new Error('The consumer failed');
    });
    return fixture.chatAdmission.approveJoinRequestAsBot({
      deciderBotId: alpha,
      chatId: fixture.chatId,
      userId: fixture.graceId,
    });
  });

  assertEquals(
    {
      approval,
      failures: fixture.notificationFailures,
      graceIsMember: fixture.readState().memberIds.includes(fixture.graceId),
      longPoll: await longPoll,
      alphaUpdates: botUpdates.readPendingUpdates(alpha).length,
    },
    {
      approval: { executed: true, result: { decided: true } },
      failures: ['The consumer failed'],
      graceIsMember: true,
      longPoll: 'notified',
      alphaUpdates: 2,
    },
    "Expected the approval to stand and Alpha's long poll to learn of it",
  );
});

Deno.test('approveChatJoinRequest records nothing when its projection fails', async () => {
  using fixture = await createSessionFixture();
  const { session } = fixture;
  const stateBefore = fixture.readState();
  // The session's own views fail for Beta, as a projector that breaks an invariant would.
  const views = session.botMessageViews;
  const viewChatMemberChange = views.viewChatMemberChange.bind(views);
  views.viewChatMemberChange = (event: ChatMemberStatusChangedEvent, observerBotId: number) => {
    if (observerBotId === fixture.beta.id) {
      throw new Error(FAILED_VIEW_MESSAGE);
    }
    return viewChatMemberChange(event, observerBotId);
  };

  const failedCall = await fixture
    .call(fixture.alpha, 'approveChatJoinRequest', fixture.approvalParameters())
    .then(() => 'no error', (error: Error) => error.message);
  views.viewChatMemberChange = viewChatMemberChange;

  assertEquals(
    { failedCall, state: fixture.readState() },
    { failedCall: FAILED_VIEW_MESSAGE, state: stateBefore },
    'Expected neither the join, its updates nor the call to be committed or recorded',
  );
});

Deno.test('a decision prepared before the bot lost its right is not committed', async () => {
  using fixture = await createSessionFixture();
  const reply = new HeldWebhookReply(fixture.approvalParameters('approveChatJoinRequest'));
  const replying = runWebhookReply(fixture.replyContext(fixture.alpha), reply.response);

  // The owner takes Alpha's right to invite users while the reply is still being read.
  fixture.promote(fixture.alpha, ['can_delete_messages']);
  const stateBeforeRelease = fixture.readState();
  reply.release();
  await replying;

  assertEqualsInFieldOrder(
    {
      state: fixture.readState(),
      answer: await fixture.lastRecordedAnswer(),
    },
    {
      state: { ...stateBeforeRelease, activityHead: stateBeforeRelease.activityHead + 1 },
      answer: {
        ok: false,
        error_code: 400,
        description: 'Bad Request: not enough rights to manage chat join requests',
      },
    },
    'Expected the decision to be refused against the rights at its execution',
  );
});

Deno.test('a decision prepared before the request was decided is not committed again', async () => {
  using fixture = await createSessionFixture();
  const reply = new HeldWebhookReply(fixture.approvalParameters('approveChatJoinRequest'));
  const replying = runWebhookReply(fixture.replyContext(fixture.alpha), reply.response);

  // Ada approves the request herself while Alpha's reply is still being read.
  fixture.session.chatAdmission.decideJoinRequestAsAccount({
    deciderAccountId: fixture.adaId,
    chatId: fixture.chatId,
    userId: fixture.graceId,
    decision: 'approve',
  });
  const stateBeforeRelease = fixture.readState();
  reply.release();
  await replying;

  assertEqualsInFieldOrder(
    { state: fixture.readState(), answer: await fixture.lastRecordedAnswer() },
    {
      state: { ...stateBeforeRelease, activityHead: stateBeforeRelease.activityHead + 1 },
      answer: { ok: false, error_code: 400, description: 'Bad Request: USER_ALREADY_PARTICIPANT' },
    },
    'Expected one join only, and the late decision to be refused',
  );
});

Deno.test('a decision prepared before its session ended changes and records nothing', async () => {
  using fixture = await createSessionFixture();
  const reply = new HeldWebhookReply(fixture.approvalParameters('approveChatJoinRequest'));
  const replying = runWebhookReply(fixture.replyContext(fixture.alpha), reply.response);
  const stateBefore = fixture.readState();

  fixture.session.end();
  reply.release();
  await replying;

  assertEquals(
    fixture.readState(),
    stateBefore,
    'Expected the reply to commit nothing into the ended session',
  );
});

/**
 * The staged composition with Alpha and Beta as administrators that may invite users and observe
 * members' changes, and Grace's pending request to join through a link Alpha created.
 */
function createJoinRequestFixture() {
  const fixture = createStagedSessionFixture({ privacyMode: false });
  const { administration, chatAdmission, chatId, adaId } = fixture;
  for (const botId of [fixture.alpha, fixture.beta]) {
    administration.promoteChatMember({
      actorAccountId: adaId,
      chatId,
      memberId: botId,
      rights: grantSupergroupAdministratorRights(['can_invite_users']),
    });
    fixture.updateSubscriptions.setAllowedUpdateTypes(botId, SUBSCRIBED_UPDATE_TYPES);
  }
  const link = chatAdmission.createInviteLinkAsBot({
    creatorBotId: fixture.alpha,
    chatId,
    name: '',
    createsJoinRequest: true,
  });
  if (!link.created) {
    throw new Error(`Expected the invite link to be created: ${link.reason}`);
  }
  const graceId = fixture.createAccount('Grace');
  const request = chatAdmission.joinChatByInviteLink({
    accountId: graceId,
    inviteLinkUrl: link.link.url,
  });
  if (!request.used) {
    throw new Error(`Expected Grace's request to be sent: ${request.reason}`);
  }
  fixture.discardUpdatesSoFar();
  return { ...fixture, graceId };
}

/**
 * A session composed as the server composes it, with the supergroup of `createJoinRequestFixture`,
 * set up through the session's services and Bot API.
 */
async function createSessionFixture() {
  using disposalOnFailure = new DisposableStack();
  const session = disposalOnFailure.use(
    buildSessionServices({ id: 'chat-admission-transactions' }),
  );
  const [adaId, graceId] = ['Ada', 'Grace'].map((firstName) =>
    createVirtualAccount(session.virtualUsers, { first_name: firstName }).profile.id
  );
  const [alpha, beta] = ['alpha_bot', 'beta_bot'].map((username) =>
    createVirtualBot(session.virtualUsers, { first_name: username, username }).profile
  );
  const supergroup = session.sharedChatAdministration.createSupergroup({
    title: 'Team',
    creatorAccountId: adaId,
  });
  if (!supergroup.created) {
    throw new Error(`Expected the supergroup to be created: ${supergroup.reason}`);
  }
  const chatId = supergroup.supergroup.id;

  const replyContext = (bot: VirtualBotProfile): BotApiCallContext => ({
    session,
    bot,
    signal: session.lifetime.endSignal,
    via: 'webhook_reply',
  });
  const call = async (
    bot: VirtualBotProfile,
    methodName: string,
    parameters: Record<string, string>,
  ) => {
    const method = findBotApiMethod(methodName);
    if (method === undefined) {
      throw new Error(`Expected ${methodName} to be implemented`);
    }
    const outcome = await callBotApiMethod({ ...replyContext(bot), via: 'http' }, {
      method,
      requestedMethodName: methodName,
      parameters,
      uploadedFiles: new Map(),
    });
    if (!outcome.answered || !outcome.answer.body.ok) {
      throw new Error(`Expected ${methodName} to succeed: ${JSON.stringify(outcome)}`);
    }
    return outcome.answer.body.result;
  };
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

  for (const bot of [alpha, beta]) {
    session.sharedChatAdministration.addChatMember({
      actorAccountId: adaId,
      chatId,
      memberId: bot.id,
    });
    promote(bot, ['can_invite_users']);
    await call(bot, 'getUpdates', {
      allowed_updates: JSON.stringify([...SUBSCRIBED_UPDATE_TYPES]),
    });
  }
  const link = await call(alpha, 'createChatInviteLink', {
    chat_id: String(chatId),
    creates_join_request: 'true',
  });
  if (typeof link !== 'object' || link === null || !('invite_link' in link)) {
    throw new Error(`Expected an invite link, received ${JSON.stringify(link)}`);
  }
  const request = session.chatAdmission.joinChatByInviteLink({
    accountId: graceId,
    inviteLinkUrl: String(link.invite_link),
  });
  if (!request.used) {
    throw new Error(`Expected Grace's request to be sent: ${request.reason}`);
  }

  const sessionDisposal = disposalOnFailure.move();
  return {
    session,
    adaId,
    graceId,
    alpha,
    beta,
    chatId,
    call,
    promote,
    replyContext,
    approvalParameters: (method?: string) => ({
      ...(method === undefined ? {} : { method }),
      chat_id: String(chatId),
      user_id: String(graceId),
    }),
    /** The answer of the last call the session recorded. */
    lastRecordedAnswer: async () => {
      const reading = await session.botActivity.readEntries({
        after: session.botActivity.getHeadPosition() - 1,
        filter: { kind: 'bot_api_call' },
        limit: 1,
        waitMilliseconds: 0,
      });
      const [entry] = reading.read ? reading.entries : [];
      return entry?.kind === 'bot_api_call' ? entry.answer : null;
    },
    /** The session as its readers see it, through reads that record nothing. */
    readState: () => {
      const status = session.sharedChatAdministration.getChatMemberStatus({
        observerBotId: alpha.id,
        chatId,
        userId: graceId,
      });
      const requests = session.chatAdmission.getJoinRequestsForAccount({
        accountId: adaId,
        chatId,
      });
      const history = session.supergroupMessaging.getMessageHistory({ accountId: adaId, chatId });
      return {
        graceStatus: status.found ? status.status.status : status.reason,
        pendingRequests: requests.found ? requests.requests.length : requests.reason,
        messageCount: history.found ? history.messages.length : history.reason,
        pendingUpdates: [alpha, beta].map((bot) =>
          session.botApi.getWebhookInfo(bot).pending_update_count
        ),
        activityHead: session.botActivity.getHeadPosition(),
      };
    },
    [Symbol.dispose]: () => sessionDisposal.dispose(),
  };
}

function captureError(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  return 'no error';
}
