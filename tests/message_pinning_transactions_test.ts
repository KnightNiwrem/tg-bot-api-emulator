import { assertEquals, assertRejects, assertThrows } from '@std/assert';

import { grantSupergroupAdministratorRights } from '../src/types/chat_membership.ts';
import type { ChatMessage } from '../src/types/virtual_message.ts';
import {
  createBotApiCommandSession,
  FAILED_RECORDING_MESSAGE,
} from './support/bot_api_command_session.ts';

const FAILED_VIEW_MESSAGE = 'The view failed';

Deno.test("an account's pin whose service message fails to project pins nothing", () => {
  using fixture = createPinningFixture();
  const { session, adaId, chatId, beta } = fixture;
  const stateBefore = fixture.readState();
  // As a control route does, the pin opens no transaction of its own.
  const pin = () =>
    session.messagePinning.pinMessageByAccount({
      fromAccountId: adaId,
      chat: { type: 'supergroup', chatId },
      messageId: fixture.adaMessageId,
      isSilent: false,
    });

  // The pin and Alpha's update for its service message are staged before Beta's view fails.
  const restoreViews = fixture.failSupergroupViewsFor(beta.id);
  assertThrows(pin, Error, FAILED_VIEW_MESSAGE);
  restoreViews();
  const stateAfterFailure = fixture.readState();

  assertEquals(stateAfterFailure, stateBefore);
  assertEquals(pin(), { pinned: true });
  assertEquals(fixture.readState().pinnedMessageCount, 1);
});

Deno.test("a bot's pin whose record fails pins nothing", async () => {
  using fixture = createPinningFixture();
  const stateBefore = fixture.readState();
  const pin = () =>
    fixture.callMethod(fixture.alpha, 'pinChatMessage', {
      chat_id: String(fixture.chatId),
      message_id: String(fixture.adaMessageId),
    });

  // The pin, its service message and its updates are staged before the record fails.
  const restoreRecording = fixture.failCallRecording();
  await assertRejects(pin, Error, FAILED_RECORDING_MESSAGE);
  restoreRecording();
  const stateAfterFailure = fixture.readState();
  await fixture.callMethodExpectingResult(fixture.alpha, 'pinChatMessage', {
    chat_id: String(fixture.chatId),
    message_id: String(fixture.adaMessageId),
  });

  assertEquals(stateAfterFailure, stateBefore);
  assertEquals(fixture.readState().pinnedMessageCount, 1);
});

Deno.test('an unpin of every message whose record fails unpins none of them', async () => {
  using fixture = createPinningFixture();
  const { alpha, chatId } = fixture;
  for (const messageId of [fixture.adaMessageId, fixture.alphaMessageId]) {
    await fixture.callMethodExpectingResult(alpha, 'pinChatMessage', {
      chat_id: String(chatId),
      message_id: String(messageId),
    });
  }
  const stateBefore = fixture.readState();

  const restoreRecording = fixture.failCallRecording();
  await assertRejects(
    () => fixture.callMethod(alpha, 'unpinAllChatMessages', { chat_id: String(chatId) }),
    Error,
    FAILED_RECORDING_MESSAGE,
  );
  restoreRecording();

  assertEquals(stateBefore.pinnedMessageCount, 2);
  assertEquals(fixture.readState(), stateBefore);
});

Deno.test('a pin prepared before its bot lost the right to pin is not committed', async () => {
  using fixture = createPinningFixture();
  const reply = fixture.holdWebhookReply(fixture.alpha, {
    method: 'pinChatMessage',
    chat_id: String(fixture.chatId),
    message_id: String(fixture.adaMessageId),
  });

  // Ada takes Alpha's right to pin messages while the reply is still being read.
  fixture.promoteAlpha(['can_delete_messages']);
  const stateBeforeRelease = fixture.readState();
  await reply.release();

  assertEquals(fixture.readState(), {
    ...stateBeforeRelease,
    activityHead: stateBeforeRelease.activityHead + 1,
  });
  assertEquals(await fixture.lastRecordedAnswer(), {
    ok: false,
    error_code: 400,
    description: 'Bad Request: not enough rights to manage pinned messages in the chat',
  });
});

Deno.test('pins and unpins prepared before their session ended change nothing', async () => {
  using fixture = createPinningFixture();
  const { alpha, chatId } = fixture;
  await fixture.callMethodExpectingResult(alpha, 'pinChatMessage', {
    chat_id: String(chatId),
    message_id: String(fixture.alphaMessageId),
  });
  const replyParameters: readonly Readonly<Record<string, string>>[] = [
    { method: 'pinChatMessage', chat_id: String(chatId), message_id: String(fixture.adaMessageId) },
    { method: 'unpinChatMessage', chat_id: String(chatId) },
    { method: 'unpinAllChatMessages', chat_id: String(chatId) },
  ];
  const replies = replyParameters.map((parameters) => fixture.holdWebhookReply(alpha, parameters));
  const stateBefore = fixture.readState();

  fixture.session.end();
  for (const reply of replies) {
    await reply.release();
  }

  assertEquals(fixture.readState(), stateBefore);
});

/**
 * A supergroup of Ada's with Alpha and Beta, bots that read every message, where Alpha may pin
 * messages, and where Ada and Alpha have each written one message.
 */
function createPinningFixture() {
  const harness = createBotApiCommandSession('message-pinning-transactions');
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
  }
  const promoteAlpha = (rights: Parameters<typeof grantSupergroupAdministratorRights>[0]) => {
    const promotion = session.sharedChatAdministration.promoteChatMember({
      actorAccountId: adaId,
      chatId,
      memberId: alpha.id,
      rights: grantSupergroupAdministratorRights(rights),
    });
    if (!promotion.promoted) {
      throw new Error(`Expected Alpha to be promoted: ${promotion.reason}`);
    }
  };
  promoteAlpha(['can_pin_messages']);
  const adaSending = session.messageSending.sendAccountSupergroupMessage({
    fromAccountId: adaId,
    chat: { type: 'supergroup', chatId },
    content: { kind: 'text', text: 'Hello' },
  });
  const alphaSending = session.messageSending.sendChatMessage({
    fromBotId: alpha.id,
    chat: { type: 'supergroup', chatId },
    content: { kind: 'text', text: 'Hi' },
  });
  if (!adaSending.sent || !alphaSending.sent) {
    throw new Error('Expected both messages to be sent');
  }
  const chatMessageIdOf = (message: ChatMessage) =>
    session.botMessageViews.viewMessageForBot(message, alpha.id).message_id;

  return {
    ...harness,
    adaId,
    alpha,
    beta,
    chatId,
    adaMessageId: chatMessageIdOf(adaSending.message),
    alphaMessageId: chatMessageIdOf(alphaSending.message),
    promoteAlpha,
    /**
     * Makes the session's views of supergroup messages fail for one observer, as a projector that
     * breaks an invariant would, until the returned function is called.
     */
    failSupergroupViewsFor: (observerId: number): () => void => {
      const views = session.botMessageViews;
      const viewSupergroupMessage = views.viewSupergroupMessage.bind(views);
      views.viewSupergroupMessage = (message, viewerId) => {
        if (viewerId === observerId) {
          throw new Error(FAILED_VIEW_MESSAGE);
        }
        return viewSupergroupMessage(message, viewerId);
      };
      return () => {
        views.viewSupergroupMessage = viewSupergroupMessage;
      };
    },
    /** The supergroup's messages and pins as Ada sees them, and the bots' updates and calls. */
    readState: () => {
      const history = session.supergroupMessaging.getMessageHistory({ accountId: adaId, chatId });
      const pins = session.messagePinning.getPinnedMessages({
        accountId: adaId,
        chat: { type: 'supergroup', chatId },
      });
      return {
        messageCount: history.found ? history.messages.length : history.reason,
        pinnedMessageCount: pins.found ? pins.messages.length : pins.reason,
        pendingUpdates: harness.countPendingUpdates([alpha, beta]),
        activityHead: session.botActivity.getHeadPosition(),
      };
    },
  };
}
