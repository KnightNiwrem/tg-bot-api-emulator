import { assertEquals, assertThrows } from '@std/assert';

import { createBotApiCommandSession } from './support/bot_api_command_session.ts';

const FAILED_VIEW_MESSAGE = 'The view failed';

Deno.test('a block or an unblock whose projection fails changes nothing', async () => {
  using fixture = createBlockingFixture();
  const { session } = fixture;
  const key = { accountId: fixture.adaId, botId: fixture.alpha.id };

  for (
    const change of [
      () => session.botBlocking.blockBot(key),
      () => session.botBlocking.unblockBot(key),
    ]
  ) {
    const stateBefore = await fixture.readState();
    const restoreViews = fixture.failBlockChangeViews();
    assertThrows(change, Error, FAILED_VIEW_MESSAGE);
    restoreViews();
    assertEquals(await fixture.readState(), stateBefore);

    // The same change takes effect once its update can be projected.
    assertEquals(change(), { applied: true });
    assertEquals((await fixture.readState()).alphaMaySend, !stateBefore.alphaMaySend);
  }
});

/** Ada's private chat with Alpha, which Ada started and has not blocked. */
function createBlockingFixture() {
  const harness = createBotApiCommandSession('bot-blocking-transactions');
  const { session } = harness;
  const adaId = harness.createAccount('Ada');
  const alpha = harness.createBot('alpha_bot');
  const start = session.privateMessaging.sendAccountMessage({
    fromAccountId: adaId,
    to: { type: 'private', botId: alpha.id },
    content: { kind: 'text', text: '/start' },
  });
  if (!start.sent) {
    throw new Error(`Expected Ada to start her chat: ${JSON.stringify(start)}`);
  }

  return {
    ...harness,
    adaId,
    alpha,
    /**
     * Makes the session's view of a block change fail, as a projector that breaks an invariant
     * would, until the returned function is called.
     */
    failBlockChangeViews: (): () => void => {
      const views = session.botMessageViews;
      const viewBotBlockChange = views.viewBotBlockChangeForBot.bind(views);
      views.viewBotBlockChangeForBot = () => {
        throw new Error(FAILED_VIEW_MESSAGE);
      };
      return () => {
        views.viewBotBlockChangeForBot = viewBotBlockChange;
      };
    },
    /**
     * Whether Alpha may write to Ada, as a chat action shows it without sending anything, and
     * Alpha's pending updates.
     */
    readState: async () => {
      const outcome = await harness.callMethod(alpha, 'sendChatAction', {
        chat_id: String(adaId),
        action: 'typing',
      });
      return {
        alphaMaySend: outcome.answered && outcome.answer.body.ok,
        pendingUpdates: harness.countPendingUpdates([alpha]),
      };
    },
  };
}
