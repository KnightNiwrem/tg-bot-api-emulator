import { assertEquals, assertRejects, assertThrows } from '@std/assert';

import { grantSupergroupAdministratorRights } from '../src/types/chat_membership.ts';
import type { SupergroupMessage } from '../src/types/virtual_message.ts';
import {
  createBotApiCommandSession,
  FAILED_RECORDING_MESSAGE,
} from './support/bot_api_command_session.ts';

const FAILED_VIEW_MESSAGE = 'The view failed';

const THUMBS_UP = JSON.stringify([{ type: 'emoji', emoji: '👍' }]);

Deno.test("an account's reaction whose projection fails commits nothing", async () => {
  const fixture = await createReactionFixture();
  const { session } = fixture;
  const stateBefore = fixture.readState();
  const views = session.botMessageViews;
  const viewMessageReactionChange = views.viewMessageReactionChangeForBot.bind(views);
  views.viewMessageReactionChangeForBot = () => {
    throw new Error(FAILED_VIEW_MESSAGE);
  };
  const react = () =>
    session.messageReactions.setAccountMessageReaction({
      accountId: fixture.adaId,
      chatId: fixture.chatId,
      messageId: fixture.alphaMessageId,
      emojis: ['👍'],
    });

  assertThrows(react, Error, FAILED_VIEW_MESSAGE);
  views.viewMessageReactionChangeForBot = viewMessageReactionChange;
  const stateAfterFailure = fixture.readState();
  assertEquals(react().set, true);

  assertEquals(stateAfterFailure, stateBefore);
  // Each administrator bot that subscribes receives the reaction once it is committed.
  assertEquals(
    fixture.readState().pendingUpdates,
    stateBefore.pendingUpdates.map((count) => count + 1),
  );
});

Deno.test("a bot's reaction whose record fails commits nothing", async () => {
  const fixture = await createReactionFixture();
  const stateBefore = fixture.readState();
  const restoreRecording = fixture.failCallRecording();

  await assertRejects(
    () =>
      fixture.callMethod(fixture.alpha, 'setMessageReaction', {
        chat_id: String(fixture.chatId),
        message_id: String(fixture.adaMessageId),
        reaction: THUMBS_UP,
      }),
    Error,
    FAILED_RECORDING_MESSAGE,
  );
  restoreRecording();

  assertEquals(fixture.readState(), stateBefore);
});

Deno.test('a reaction prepared before its message was deleted is not committed', async () => {
  const fixture = await createReactionFixture();
  const reply = fixture.holdWebhookReply(fixture.alpha, {
    method: 'setMessageReaction',
    chat_id: String(fixture.chatId),
    message_id: String(fixture.adaMessageId),
    reaction: THUMBS_UP,
  });

  // Ada deletes her message while Alpha's reply is still being read.
  const deletion = fixture.session.messageDeletion.deleteAccountSupergroupMessage({
    fromAccountId: fixture.adaId,
    chat: { type: 'supergroup', chatId: fixture.chatId },
    messageId: fixture.adaMessageId,
  });
  assertEquals(deletion, { deleted: true });
  const stateBeforeRelease = fixture.readState();
  await reply.release();

  assertEquals(fixture.readState(), {
    ...stateBeforeRelease,
    activityHead: stateBeforeRelease.activityHead + 1,
  });
  assertEquals(await fixture.lastRecordedAnswer(), {
    ok: false,
    error_code: 400,
    description: 'Bad Request: message to react not found',
  });
});

Deno.test('a reaction prepared before its session ended changes nothing', async () => {
  const fixture = await createReactionFixture();
  const reply = fixture.holdWebhookReply(fixture.alpha, {
    method: 'setMessageReaction',
    chat_id: String(fixture.chatId),
    message_id: String(fixture.adaMessageId),
    reaction: THUMBS_UP,
  });
  const stateBefore = fixture.readState();

  fixture.session.end();
  await reply.release();

  assertEquals(fixture.readState(), stateBefore);
});

/**
 * A supergroup of Ada's with Alpha and Beta as administrator bots that observe reactions, where
 * Ada and Alpha have each written one message.
 */
async function createReactionFixture() {
  const harness = createBotApiCommandSession('message-reaction-transactions');
  const { session } = harness;
  const adaId = harness.createAccount('Ada');
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
  for (const bot of [alpha, beta]) {
    session.sharedChatAdministration.addChatMember({
      actorAccountId: adaId,
      chatId,
      memberId: bot.id,
    });
    const promotion = session.sharedChatAdministration.promoteChatMember({
      actorAccountId: adaId,
      chatId,
      memberId: bot.id,
      rights: grantSupergroupAdministratorRights(['can_pin_messages']),
    });
    if (!promotion.promoted) {
      throw new Error(`Expected ${bot.username} to be promoted: ${promotion.reason}`);
    }
    await harness.callMethodExpectingResult(bot, 'getUpdates', {
      allowed_updates: JSON.stringify(['message', 'message_reaction']),
    });
  }
  const adaSending = session.supergroupMessaging.sendAccountMessage({
    fromAccountId: adaId,
    chatId,
    content: { kind: 'text', text: 'Hello' },
  });
  const alphaSending = session.supergroupMessaging.sendBotMessage({
    fromBotId: alpha.id,
    chatId,
    content: { kind: 'text', text: 'Hi' },
  });
  if (!adaSending.sent || !alphaSending.sent) {
    throw new Error('Expected both messages to be sent');
  }
  const chatMessageIdOf = (message: SupergroupMessage) =>
    session.botMessageViews.viewSupergroupMessage(message, alpha.id).message_id;
  const adaMessageId = chatMessageIdOf(adaSending.message);
  const alphaMessageId = chatMessageIdOf(alphaSending.message);
  const readReactions = (messageId: number) => {
    const reactions = session.messageReactions.getAccountMessageReactions({
      accountId: adaId,
      chatId,
      messageId,
    });
    return reactions.found ? reactions.reactions : reactions.reason;
  };

  return {
    ...harness,
    adaId,
    alpha,
    chatId,
    adaMessageId,
    alphaMessageId,
    /** The supergroup's reactions and the bots' updates, through reads that record nothing. */
    readState: () => ({
      reactions: [readReactions(adaMessageId), readReactions(alphaMessageId)],
      pendingUpdates: harness.countPendingUpdates([alpha, beta]),
      activityHead: session.botActivity.getHeadPosition(),
    }),
  };
}
