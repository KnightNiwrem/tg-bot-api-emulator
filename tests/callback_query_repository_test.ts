import { assertEquals } from '@std/assert';
import { CallbackQueryRepository } from '../src/repositories/callback_query.ts';

const CALLBACK_QUERY_INPUT = {
  accountId: 1,
  botId: 2,
  messageId: 'message',
  chatInstance: '-42',
  callbackData: 'yes',
  expired: false,
};

Deno.test('CallbackQueryRepository stores callback queries under distinct IDs', () => {
  const callbackQueries = new CallbackQueryRepository();

  const firstQuery = callbackQueries.addCallbackQuery(CALLBACK_QUERY_INPUT);
  const secondQuery = callbackQueries.addCallbackQuery({
    ...CALLBACK_QUERY_INPUT,
    expired: true,
  });

  if (firstQuery.id === secondQuery.id || !/^\d+$/.test(firstQuery.id)) {
    throw new Error('Expected distinct decimal callback query IDs');
  }
  if (
    callbackQueries.getCallbackQuery(firstQuery.id) !== firstQuery ||
    firstQuery.callbackData !== 'yes' ||
    firstQuery.chatInstance !== '-42' ||
    firstQuery.state.status !== 'awaiting_answer' ||
    secondQuery.state.status !== 'expired'
  ) {
    throw new Error('Expected stored queries awaiting an answer unless created expired');
  }
  if (callbackQueries.getCallbackQuery('unknown') !== undefined) {
    throw new Error('Expected an unknown callback query ID to find nothing');
  }
});

Deno.test('CallbackQueryRepository records one answer per awaiting callback query', () => {
  const callbackQueries = new CallbackQueryRepository();
  const callbackQuery = callbackQueries.addCallbackQuery(CALLBACK_QUERY_INPUT);
  const expiredQuery = callbackQueries.addCallbackQuery({ ...CALLBACK_QUERY_INPUT, expired: true });
  const answer = { text: 'Saved', showAlert: true, cacheTimeSeconds: 5 };

  const answeredQuery = callbackQueries.recordAnswer(callbackQuery.id, answer);
  if (callbackQueries.getCallbackQuery(callbackQuery.id) !== answeredQuery) {
    throw new Error('Expected the answer to be recorded on the stored query');
  }
  assertEquals(
    answeredQuery.state,
    { status: 'answered', answer },
    'Expected the answer to be recorded on the stored query',
  );

  for (const endedQuery of [answeredQuery, expiredQuery]) {
    let rejected = false;
    try {
      callbackQueries.recordAnswer(endedQuery.id, answer);
    } catch {
      rejected = true;
    }
    if (!rejected || callbackQueries.getCallbackQuery(endedQuery.id) !== endedQuery) {
      throw new Error(`Expected the ${endedQuery.state.status} query to reject an answer`);
    }
  }
});
