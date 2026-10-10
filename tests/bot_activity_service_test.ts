import { BotActivityLogRepository } from '../src/repositories/bot_activity_log.ts';
import {
  BotActivityService,
  type ReadBotActivityResult,
  type RecordedBotApiCall,
} from '../src/services/bot_activity.ts';
import type { BotActivityEntry, BotActivityFilter } from '../src/types/bot_activity.ts';
import type { BotApiUpdate } from '../src/types/bot_api.ts';
import { createRealTimeScheduler } from './support/scheduler.ts';

const BOT_ID = 10;
const OTHER_BOT_ID = 20;
const ADA_ID = 1;
const SUPERGROUP_ID = -1_001_000_000_001;

Deno.test('BotActivityService positions entries in the order it records them', async () => {
  const botActivity = createBotActivity();
  if (botActivity.getHeadPosition() !== 0) {
    throw new Error('Expected an empty log to have head position 0');
  }

  botActivity.recordUpdateConfirmations(BOT_ID, [privateMessageUpdate(1)], 'polling');
  botActivity.recordUpdateDeliveries(
    BOT_ID,
    [privateMessageUpdate(2), supergroupMessageUpdate(3)],
    'polling',
  );
  botActivity.recordBotApiCall(sendMessageCall());

  const entries = await readAll(botActivity);
  assertJson(
    entries.map((entry) => [entry.position, entry.kind, entry.chatId]),
    [
      [1, 'update_confirmed', ADA_ID],
      [2, 'update_delivered', ADA_ID],
      [3, 'update_delivered', SUPERGROUP_ID],
      [4, 'bot_api_call', ADA_ID],
    ],
    'Expected entries to be numbered from 1 in recording order',
  );
  if (botActivity.getHeadPosition() !== 4) {
    throw new Error('Expected the head position to be the latest entry');
  }
});

Deno.test('BotActivityService describes the chat and user of each update', async () => {
  const botActivity = createBotActivity();
  botActivity.recordUpdateDeliveries(BOT_ID, [
    privateMessageUpdate(1),
    {
      update_id: 2,
      inline_query: {
        id: 'query',
        from: ada(),
        chat_type: 'sender',
        query: 'cats',
        offset: '',
      },
    },
    {
      update_id: 3,
      callback_query: {
        id: 'inline-press',
        from: ada(),
        inline_message_id: 'inline-message',
        chat_instance: 'instance',
        data: 'yes',
      },
    },
  ], 'polling');

  const entries = await readAll(botActivity);
  assertJson(
    entries.map((entry) => entry.kind === 'update_delivered' && [entry.chatId, entry.userId]),
    [[ADA_ID, ADA_ID], [undefined, ADA_ID], [undefined, ADA_ID]],
    'Expected chats only for updates that happen in one, and the acting user for every update',
  );
});

Deno.test('BotActivityService filters entries by every criterion given', async () => {
  const botActivity = createBotActivity();
  botActivity.recordUpdateDeliveries(BOT_ID, [privateMessageUpdate(1)], 'polling');
  botActivity.recordBotApiCall(sendMessageCall());
  botActivity.recordBotApiCall({
    ...sendMessageCall(),
    method: 'answerCallbackQuery',
    requestedMethod: 'answerCallbackQuery',
    parameters: { callback_query_id: 'press' },
    chatId: undefined,
    answer: { ok: true, result: true },
  });
  botActivity.recordBotApiCall({
    ...sendMessageCall(),
    botId: OTHER_BOT_ID,
    answer: { ok: false, error_code: 403, description: 'Forbidden: bot was blocked by the user' },
  });
  botActivity.recordUpdateConfirmations(BOT_ID, [privateMessageUpdate(1)], 'polling');
  botActivity.recordUpdateDeliveries(OTHER_BOT_ID, [privateMessageUpdate(2)], 'polling');

  const cases: { filter: BotActivityFilter; expected: number[] }[] = [
    { filter: { botId: BOT_ID }, expected: [1, 2, 3, 5] },
    { filter: { kind: 'bot_api_call' }, expected: [2, 3, 4] },
    { filter: { method: 'SENDMESSAGE' }, expected: [2, 4] },
    { filter: { chatId: ADA_ID }, expected: [1, 2, 4, 5, 6] },
    { filter: { userId: ADA_ID }, expected: [1, 5, 6] },
    { filter: { updateId: 1 }, expected: [1, 5] },
    { filter: { updateId: 1, kind: 'update_confirmed' }, expected: [5] },
    { filter: { updateId: 2 }, expected: [6] },
    { filter: { updateId: 2, botId: BOT_ID }, expected: [] },
    { filter: { ok: false }, expected: [4] },
    { filter: { parameters: { callback_query_id: 'press' } }, expected: [3] },
    { filter: { parameters: { text: 'Hello' }, botId: BOT_ID }, expected: [2] },
    { filter: { parameters: { text: 'Hell' } }, expected: [] },
  ];
  for (const { filter, expected } of cases) {
    const entries = await readAll(botActivity, filter);
    assertJson(
      entries.map((entry) => entry.position),
      expected,
      `Expected ${JSON.stringify(filter)} to find ${JSON.stringify(expected)}`,
    );
  }
});

Deno.test('BotActivityService reads ranges after and before positions', async () => {
  const botActivity = createBotActivity();
  for (let updateId = 1; updateId <= 5; updateId++) {
    botActivity.recordUpdateDeliveries(BOT_ID, [privateMessageUpdate(updateId)], 'polling');
  }

  const cases = [
    { after: 0, before: undefined, limit: 100, expected: [1, 2, 3, 4, 5] },
    { after: 2, before: undefined, limit: 100, expected: [3, 4, 5] },
    { after: 1, before: 4, limit: 100, expected: [2, 3] },
    { after: 1, before: 6, limit: 2, expected: [2, 3] },
    { after: 5, before: undefined, limit: 100, expected: [] },
    { after: 0, before: undefined, limit: 0, expected: [] },
  ];
  for (const { after, before, limit, expected } of cases) {
    const result = expectRead(
      await botActivity.readEntries({ after, before, filter: {}, limit, waitMilliseconds: 0 }),
    );
    assertJson(
      result.entries.map((entry) => entry.position),
      expected,
      `Expected entries after ${after} and before ${before} limited to ${limit}`,
    );
    if (result.headPosition !== 5) {
      throw new Error('Expected every read to report the head position');
    }
  }
});

Deno.test('BotActivityService rejects positions beyond the head of the log', async () => {
  const botActivity = createBotActivity();
  botActivity.recordBotApiCall(sendMessageCall());

  const results = await Promise.all([
    botActivity.readEntries({ after: 2, filter: {}, limit: 100, waitMilliseconds: 0 }),
    botActivity.readEntries({ after: 0, before: 3, filter: {}, limit: 100, waitMilliseconds: 0 }),
    botActivity.readEntries({ after: 1, before: 2, filter: {}, limit: 100, waitMilliseconds: 0 }),
  ]);
  assertJson(
    results.map((result) => result.read ? 'read' : result.reason),
    ['after_beyond_head', 'before_beyond_head', 'read'],
    'Expected only positions up to the head, and ranges ending just after it, to be read',
  );
});

Deno.test('BotActivityService holds a read until a matching entry is recorded', async () => {
  const botActivity = createBotActivity();
  const heldRead = botActivity.readEntries({
    after: 0,
    filter: { method: 'sendMessage' },
    limit: 100,
    waitMilliseconds: 10_000,
  });

  botActivity.recordUpdateDeliveries(BOT_ID, [privateMessageUpdate(1)], 'polling');
  botActivity.recordBotApiCall(sendMessageCall());

  const result = expectRead(await heldRead);
  assertJson(
    result.entries.map((entry) => entry.position),
    [2],
    'Expected the held read to skip the unmatched entry and answer with the matching one',
  );
});

Deno.test('BotActivityService answers a held read with nothing when its wait elapses', async () => {
  const botActivity = createBotActivity();
  const startedAt = performance.now();
  const result = expectRead(
    await botActivity.readEntries({ after: 0, filter: {}, limit: 100, waitMilliseconds: 20 }),
  );
  if (result.entries.length !== 0 || performance.now() - startedAt < 15) {
    throw new Error('Expected the read to wait for its whole wait and find nothing');
  }
});

Deno.test('BotActivityService never holds a read of a range that ends before a position', async () => {
  const botActivity = createBotActivity();
  botActivity.recordUpdateDeliveries(BOT_ID, [privateMessageUpdate(1)], 'polling');
  const result = expectRead(
    await botActivity.readEntries({
      after: 0,
      before: 2,
      filter: { kind: 'bot_api_call' },
      limit: 100,
      waitMilliseconds: 10_000,
    }),
  );
  if (result.entries.length !== 0) {
    throw new Error('Expected the range to hold no call');
  }
});

Deno.test('BotActivityService answers held reads when reading ends, and holds none later', async () => {
  const botActivity = createBotActivity();
  const heldRead = botActivity.readEntries({
    after: 0,
    filter: {},
    limit: 100,
    waitMilliseconds: 10_000,
  });
  botActivity.endReading();
  const laterRead = botActivity.readEntries({
    after: 0,
    filter: {},
    limit: 100,
    waitMilliseconds: 10_000,
  });

  const results = await expectSettlementWithin(
    Promise.all([heldRead, laterRead]),
    1_000,
    'Expected ending reading to answer every read at once',
  );
  if (results.some((result) => expectRead(result).entries.length !== 0)) {
    throw new Error('Expected the reads to find nothing');
  }
});

Deno.test('BotActivityService stops holding a read whose reader stops waiting', async () => {
  const botActivity = createBotActivity();
  const reader = new AbortController();
  const heldRead = botActivity.readEntries({
    after: 0,
    filter: {},
    limit: 100,
    waitMilliseconds: 10_000,
    signal: reader.signal,
  });
  reader.abort();
  await expectSettlementWithin(heldRead, 1_000, 'Expected the abandoned read to be answered');
});

function createBotActivity(): BotActivityService {
  return new BotActivityService({
    log: new BotActivityLogRepository(),
    scheduler: createRealTimeScheduler(),
  });
}

async function readAll(
  botActivity: BotActivityService,
  filter: BotActivityFilter = {},
): Promise<readonly BotActivityEntry[]> {
  return expectRead(
    await botActivity.readEntries({ after: 0, filter, limit: 100, waitMilliseconds: 0 }),
  ).entries;
}

function expectRead(result: ReadBotActivityResult) {
  if (!result.read) {
    throw new Error(`Expected the read to succeed, received ${result.reason}`);
  }
  return result;
}

function sendMessageCall(): RecordedBotApiCall {
  return {
    botId: BOT_ID,
    method: 'sendMessage',
    requestedMethod: 'sendmessage',
    via: 'http',
    parameters: { chat_id: String(ADA_ID), text: 'Hello' },
    uploadedFiles: [],
    chatId: ADA_ID,
    answer: { ok: true, result: { message_id: 2 } },
  };
}

function ada() {
  return { id: ADA_ID, is_bot: false as const, first_name: 'Ada' };
}

function privateMessageUpdate(updateId: number): BotApiUpdate {
  return {
    update_id: updateId,
    message: {
      message_id: updateId,
      from: ada(),
      chat: { id: ADA_ID, type: 'private', first_name: 'Ada' },
      date: 1_700_000_000,
      text: 'Hi',
    },
  };
}

function supergroupMessageUpdate(updateId: number): BotApiUpdate {
  return {
    update_id: updateId,
    message: {
      message_id: updateId,
      from: ada(),
      chat: { id: SUPERGROUP_ID, type: 'supergroup', title: 'Team' },
      date: 1_700_000_000,
      text: 'Hi',
    },
  };
}

function assertJson(actual: unknown, expected: unknown, message: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${message}: received ${JSON.stringify(actual)}`);
  }
}

async function expectSettlementWithin<T>(
  pending: Promise<T>,
  milliseconds: number,
  failureMessage: string,
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timeoutId = setTimeout(() => reject(new Error(failureMessage)), milliseconds);
  });
  try {
    return await Promise.race([pending, timeout]);
  } finally {
    clearTimeout(timeoutId);
  }
}
