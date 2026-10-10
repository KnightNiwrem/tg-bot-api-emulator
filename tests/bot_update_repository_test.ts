import { BotUpdateRepository } from '../src/repositories/bot_update.ts';
import type { BotApiPrivateMessage } from '../src/types/bot_api.ts';

Deno.test('BotUpdateRepository confirms one update a webhook accepted, out of order', () => {
  const botUpdates = new BotUpdateRepository();
  for (const text of ['first', 'second', 'third']) {
    botUpdates.enqueueMessageUpdate(10, createMessage(text));
  }

  botUpdates.confirmPendingUpdate(10, 2);
  botUpdates.confirmPendingUpdate(10, 2);
  const pendingUpdateIds = botUpdates.readPendingUpdates(10).map(({ update_id }) => update_id);
  if (
    JSON.stringify(pendingUpdateIds) !== JSON.stringify([1, 3]) ||
    botUpdates.countPendingUpdates(10) !== 2
  ) {
    throw new Error(`Expected only update 2 to be confirmed, received ${pendingUpdateIds}`);
  }
});

Deno.test('BotUpdateRepository sequences and confirms each bot mailbox independently', () => {
  const botUpdates = new BotUpdateRepository();
  const message = createMessage('first');

  botUpdates.enqueueMessageUpdate(10, message);
  // Callback queries share the message update sequence.
  botUpdates.enqueueCallbackQueryUpdate(10, {
    id: '1',
    from: { id: 1, is_bot: false, first_name: 'Ada' },
    message,
    chat_instance: '-42',
    data: 'yes',
  });
  botUpdates.enqueueMessageUpdate(20, message);

  const limitedUpdates = botUpdates.confirmAndReadPendingUpdates(10, { limit: 1 });
  if (limitedUpdates.length !== 1 || limitedUpdates[0].update_id !== 1) {
    throw new Error('Expected a read to honor its limit without confirming updates');
  }

  const repeatedUpdates = botUpdates.confirmAndReadPendingUpdates(10, { limit: 100 });
  if (
    repeatedUpdates.length !== 2 ||
    repeatedUpdates[0].update_id !== 1 ||
    repeatedUpdates[1].update_id !== 2
  ) {
    throw new Error('Expected unconfirmed updates to remain pending');
  }

  const afterConfirmation = botUpdates.confirmAndReadPendingUpdates(10, {
    firstUnconfirmedUpdateId: 2,
    limit: 100,
  });
  const callbackQueryUpdate = afterConfirmation[0];
  if (
    afterConfirmation.length !== 1 || callbackQueryUpdate.update_id !== 2 ||
    !('callback_query' in callbackQueryUpdate) || callbackQueryUpdate.callback_query.data !== 'yes'
  ) {
    throw new Error('Expected a read to confirm only earlier updates');
  }

  const otherBotUpdates = botUpdates.confirmAndReadPendingUpdates(20, { limit: 100 });
  if (otherBotUpdates.length !== 1 || otherBotUpdates[0].update_id !== 1) {
    throw new Error('Expected each bot to own an independent update sequence');
  }
});

Deno.test('BotUpdateRepository ends a wait when its signal aborts', async () => {
  const botUpdates = new BotUpdateRepository();
  const abortController = new AbortController();
  const awaitedUpdateId = botUpdates.getNextUpdateId(10);
  const pendingWait = botUpdates.waitForUpdate(10, {
    awaitedUpdateId,
    signal: abortController.signal,
  });

  abortController.abort();
  await pendingWait;
  await botUpdates.waitForUpdate(10, { awaitedUpdateId, signal: abortController.signal });
});

Deno.test('BotUpdateRepository resolves a negative offset against the queue tail', () => {
  const botUpdates = new BotUpdateRepository();
  if (botUpdates.resolveFirstUnconfirmedUpdateId(10, -1) !== 1) {
    throw new Error('Expected a negative offset on an empty queue to keep future updates');
  }
  botUpdates.enqueueMessageUpdate(10, createMessage('first'));
  botUpdates.enqueueMessageUpdate(10, createMessage('second'));
  botUpdates.enqueueMessageUpdate(10, createMessage('third'));

  const firstUnconfirmedUpdateId = botUpdates.resolveFirstUnconfirmedUpdateId(10, -2);
  const tailUpdates = botUpdates.confirmAndReadPendingUpdates(10, {
    firstUnconfirmedUpdateId,
    limit: 100,
  });
  if (tailUpdates.map((update) => update.update_id).join() !== '2,3') {
    throw new Error('Expected a negative offset to return the requested queue tail');
  }

  const remainingUpdates = botUpdates.confirmAndReadPendingUpdates(10, { limit: 100 });
  if (remainingUpdates.map((update) => update.update_id).join() !== '2,3') {
    throw new Error('Expected a negative offset to forget updates before the tail');
  }
  if (botUpdates.resolveFirstUnconfirmedUpdateId(10, -5) !== 2) {
    throw new Error('Expected a negative offset beyond the queue length to keep every update');
  }
});

Deno.test('BotUpdateRepository ignores an offset too far beyond the next update ID', () => {
  const botUpdates = new BotUpdateRepository();
  botUpdates.enqueueMessageUpdate(10, createMessage('first'));
  botUpdates.enqueueMessageUpdate(10, createMessage('second'));

  // The next update will receive ID 3, so Telegram ignores offsets above 13.
  const afterIgnoredOffset = botUpdates.confirmAndReadPendingUpdates(10, {
    firstUnconfirmedUpdateId: 14,
    limit: 100,
  });
  if (afterIgnoredOffset.map((update) => update.update_id).join() !== '1,2') {
    throw new Error('Expected an offset beyond the tolerance to confirm no updates');
  }

  const afterFurthestHonoredOffset = botUpdates.confirmAndReadPendingUpdates(10, {
    firstUnconfirmedUpdateId: 13,
    limit: 100,
  });
  if (afterFurthestHonoredOffset.length !== 0) {
    throw new Error('Expected an offset within the tolerance to confirm every pending update');
  }
  botUpdates.enqueueMessageUpdate(10, createMessage('third'));
  const nextUpdates = botUpdates.confirmAndReadPendingUpdates(10, { limit: 100 });
  if (nextUpdates.map((update) => update.update_id).join() !== '3') {
    throw new Error('Expected an honored future offset not to change the update sequence');
  }
});

Deno.test('BotUpdateRepository discards pending updates without restarting the sequence', () => {
  const botUpdates = new BotUpdateRepository();
  botUpdates.enqueueMessageUpdate(10, createMessage('first'));
  botUpdates.enqueueMessageUpdate(20, createMessage('other bot'));

  botUpdates.discardPendingUpdates(10);
  botUpdates.enqueueMessageUpdate(10, createMessage('second'));

  const updates = botUpdates.confirmAndReadPendingUpdates(10, { limit: 100 });
  if (updates.map((update) => update.update_id).join() !== '2') {
    throw new Error('Expected only the later update to remain, continuing the ID sequence');
  }
  if (botUpdates.confirmAndReadPendingUpdates(20, { limit: 100 }).length !== 1) {
    throw new Error("Expected discarding one bot's updates to leave other bots untouched");
  }
});

function createMessage(text: string): BotApiPrivateMessage {
  return {
    message_id: 1,
    from: { id: 1, is_bot: false, first_name: 'Ada' },
    chat: { id: 1, type: 'private', first_name: 'Ada' },
    date: 1_700_000_000,
    text,
  };
}
