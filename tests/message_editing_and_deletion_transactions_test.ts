import { assertEquals, assertRejects, assertThrows } from '@std/assert';

import { grantSupergroupAdministratorRights } from '../src/types/chat_membership.ts';
import type { VirtualBotProfile } from '../src/types/virtual_bot.ts';
import type { SupergroupMessage } from '../src/types/virtual_message.ts';
import {
  createBotApiCommandSession,
  FAILED_RECORDING_MESSAGE,
} from './support/bot_api_command_session.ts';

const FAILED_VIEW_MESSAGE = 'The view failed';

Deno.test('an account edit whose projection fails after one bot commits nothing', async () => {
  const fixture = createEditingFixture();
  const { session } = fixture;
  const lastAlphaUpdateId = await fixture.confirmUpdates(fixture.alpha);
  const stateBefore = fixture.readState();
  const editAdaMessage = () =>
    session.messageEditing.editAccountSupergroupMessage({
      fromAccountId: fixture.adaId,
      chat: { type: 'supergroup', chatId: fixture.chatId },
      messageId: fixture.adaMessageId,
      edit: { kind: 'text', text: 'Edited' },
    });

  // Alpha's `edited_message` update is staged before Beta's view fails.
  const restoreViews = fixture.failMessageViewsFor(fixture.beta.id);
  assertThrows(editAdaMessage, Error, FAILED_VIEW_MESSAGE);
  restoreViews();
  const stateAfterFailure = fixture.readState();
  assertEquals(editAdaMessage().edited, true);

  assertEquals(stateAfterFailure, stateBefore);
  assertEquals(await fixture.confirmUpdates(fixture.alpha), lastAlphaUpdateId + 1);
});

Deno.test("a bot's edit whose answer fails to be viewed commits nothing", async () => {
  const fixture = createEditingFixture();
  const stateBefore = fixture.readState();
  // The edit is staged before the bot's view of the edited message, which answers the call, fails.
  const restoreViews = fixture.failMessageViewsFor(fixture.alpha.id);

  await assertRejects(
    () =>
      fixture.callMethod(fixture.alpha, 'editMessageText', {
        chat_id: String(fixture.chatId),
        message_id: String(fixture.alphaMessageId),
        text: 'Edited',
      }),
    Error,
    FAILED_VIEW_MESSAGE,
  );
  restoreViews();

  assertEquals(fixture.readState(), stateBefore);
});

Deno.test('a deletion of several messages whose record fails deletes none of them', async () => {
  const fixture = createEditingFixture();
  const stateBefore = fixture.readState();
  const restoreRecording = fixture.failCallRecording();

  await assertRejects(
    () =>
      fixture.callMethod(fixture.alpha, 'deleteMessages', {
        chat_id: String(fixture.chatId),
        message_ids: JSON.stringify([fixture.adaMessageId, fixture.alphaMessageId]),
      }),
    Error,
    FAILED_RECORDING_MESSAGE,
  );
  restoreRecording();

  assertEquals(fixture.readState(), stateBefore);
});

Deno.test('a private deletion whose record fails keeps the reply keyboard shown', async () => {
  const fixture = createEditingFixture();
  const { session, alpha, adaId } = fixture;
  const keyboardMessage = await fixture.callMethodExpectingResult(alpha, 'sendMessage', {
    chat_id: String(adaId),
    text: 'Choose',
    reply_markup: JSON.stringify({ keyboard: [[{ text: 'Yes' }]] }),
  });
  const readPrivateChat = () => ({
    messageCount: readPrivateMessageCount(fixture),
    showsKeyboard: readsShownReplyKeyboard(fixture),
    activityHead: session.botActivity.getHeadPosition(),
  });
  const stateBefore = readPrivateChat();
  const restoreRecording = fixture.failCallRecording();

  await assertRejects(
    () =>
      fixture.callMethod(alpha, 'deleteMessage', {
        chat_id: String(adaId),
        message_id: String(readMessageId(keyboardMessage)),
      }),
    Error,
    FAILED_RECORDING_MESSAGE,
  );
  restoreRecording();

  assertEquals(stateBefore.showsKeyboard, true);
  assertEquals(readPrivateChat(), stateBefore);
});

Deno.test('an edit prepared before its message was deleted is not committed', async () => {
  const fixture = createEditingFixture();
  const { session } = fixture;
  const reply = fixture.holdWebhookReply(fixture.alpha, {
    method: 'editMessageText',
    chat_id: String(fixture.chatId),
    message_id: String(fixture.alphaMessageId),
    text: 'Edited',
  });

  // Ada deletes Alpha's message while the reply is still being read.
  const deletion = session.messageDeletion.deleteAccountSupergroupMessage({
    fromAccountId: fixture.adaId,
    chat: { type: 'supergroup', chatId: fixture.chatId },
    messageId: fixture.alphaMessageId,
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
    description: 'Bad Request: message to edit not found',
  });
});

Deno.test('a deletion prepared before the bot lost its right is not committed', async () => {
  const fixture = createEditingFixture();
  const reply = fixture.holdWebhookReply(fixture.alpha, {
    method: 'deleteMessage',
    chat_id: String(fixture.chatId),
    message_id: String(fixture.adaMessageId),
  });

  // Ada takes Alpha's right to delete messages while the reply is still being read.
  fixture.promoteAlpha(['can_pin_messages']);
  const stateBeforeRelease = fixture.readState();
  await reply.release();

  assertEquals(fixture.readState(), {
    ...stateBeforeRelease,
    activityHead: stateBeforeRelease.activityHead + 1,
  });
  assertEquals(await fixture.lastRecordedAnswer(), {
    ok: false,
    error_code: 400,
    description: "Bad Request: message can't be deleted",
  });
});

Deno.test('an edit or deletion prepared before its session ended changes nothing', async () => {
  const fixture = createEditingFixture();
  const edit = fixture.holdWebhookReply(fixture.alpha, {
    method: 'editMessageText',
    chat_id: String(fixture.chatId),
    message_id: String(fixture.alphaMessageId),
    text: 'Edited',
  });
  const deletion = fixture.holdWebhookReply(fixture.alpha, {
    method: 'deleteMessages',
    chat_id: String(fixture.chatId),
    message_ids: JSON.stringify([fixture.adaMessageId, fixture.alphaMessageId]),
  });
  const stateBefore = fixture.readState();

  fixture.session.end();
  await edit.release();
  await deletion.release();

  assertEquals(fixture.readState(), stateBefore);
});

/**
 * A supergroup of Ada's with Alpha and Beta, bots that read every message, where Alpha may delete
 * messages, and where Ada and Alpha have each written one message; Ada also started her private
 * chat with Alpha.
 */
function createEditingFixture() {
  const harness = createBotApiCommandSession('message-editing-and-deletion-transactions');
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
  promoteAlpha(['can_delete_messages']);
  const sendAdaText = (text: string): SupergroupMessage => {
    const sending = session.supergroupMessaging.sendAccountMessage({
      fromAccountId: adaId,
      chatId,
      content: { kind: 'text', text },
    });
    if (!sending.sent) {
      throw new Error(`Expected Ada's message to be sent: ${JSON.stringify(sending)}`);
    }
    return sending.message;
  };
  const adaMessage = sendAdaText('Hello');
  const alphaSending = session.supergroupMessaging.sendBotMessage({
    fromBotId: alpha.id,
    chatId,
    content: { kind: 'text', text: 'Hi' },
  });
  if (!alphaSending.sent) {
    throw new Error(`Expected Alpha's message to be sent: ${JSON.stringify(alphaSending)}`);
  }
  const privateStart = session.privateMessaging.sendAccountMessage({
    fromAccountId: adaId,
    to: { type: 'private', botId: alpha.id },
    content: { kind: 'text', text: '/start' },
  });
  if (!privateStart.sent) {
    throw new Error(`Expected Ada to start her chat: ${JSON.stringify(privateStart)}`);
  }
  const chatMessageIdOf = (message: SupergroupMessage) =>
    session.botMessageViews.viewSupergroupMessage(message, alpha.id).message_id;

  return {
    ...harness,
    adaId,
    alpha,
    beta,
    chatId,
    adaMessageId: chatMessageIdOf(adaMessage),
    alphaMessageId: chatMessageIdOf(alphaSending.message),
    promoteAlpha,
    /** Confirms every update waiting for the bot, and returns the ID of the last one. */
    confirmUpdates: async (bot: VirtualBotProfile): Promise<number> => {
      const updates = await harness.callMethodExpectingResult(bot, 'getUpdates', {});
      const lastUpdate = Array.isArray(updates) ? updates.at(-1) : undefined;
      if (
        typeof lastUpdate !== 'object' || lastUpdate === null || !('update_id' in lastUpdate) ||
        typeof lastUpdate.update_id !== 'number'
      ) {
        throw new Error(
          `Expected updates for ${bot.username}, received ${JSON.stringify(updates)}`,
        );
      }
      await harness.callMethodExpectingResult(bot, 'getUpdates', {
        offset: String(lastUpdate.update_id + 1),
      });
      return lastUpdate.update_id;
    },
    /**
     * Makes the session's views of supergroup messages fail for one observer, as a projector that
     * breaks an invariant would, until the returned function is called.
     */
    failMessageViewsFor: (observerId: number): () => void => {
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
    /** The supergroup as its readers see it, through reads that record nothing. */
    readState: () => {
      const history = session.supergroupMessaging.getMessageHistory({ accountId: adaId, chatId });
      return {
        messages: history.found
          ? history.messages.map((message) => ({
            content: message.content,
            editedAt: message.contentEditedAtUnixSeconds ?? null,
          }))
          : history.reason,
        pendingUpdates: harness.countPendingUpdates([alpha, beta]),
        activityHead: session.botActivity.getHeadPosition(),
      };
    },
  };
}

type EditingFixture = ReturnType<typeof createEditingFixture>;

function readPrivateMessageCount({ session, adaId, alpha }: EditingFixture): number | string {
  const history = session.privateMessaging.getPrivateMessageHistory({
    accountId: adaId,
    botId: alpha.id,
  });
  return history.found ? history.messages.length : history.reason;
}

function readsShownReplyKeyboard({ session, adaId, alpha }: EditingFixture): boolean | string {
  const replyInterface = session.privateMessaging.getPrivateChatReplyInterface({
    accountId: adaId,
    botId: alpha.id,
  });
  return replyInterface.found
    ? replyInterface.shownReplyInterface !== undefined
    : replyInterface.reason;
}

function readMessageId(message: unknown): number {
  if (
    typeof message !== 'object' || message === null || !('message_id' in message) ||
    typeof message.message_id !== 'number'
  ) {
    throw new Error(`Expected a message, received ${JSON.stringify(message)}`);
  }
  return message.message_id;
}
