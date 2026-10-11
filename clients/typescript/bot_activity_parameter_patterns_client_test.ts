/**
 * The client's `parameters_json` criterion: waits, cursors and range checks that match the JSON a
 * call sent by its structure, how a view's patterns combine with a read's, and the patterns the
 * client refuses before it reads anything.
 */
import { createTestInProcessEmulator } from '../../tests/support/emulation_api.ts';
import { createHttpBotActivityPageReader } from './bot_activity_http_page_reader.ts';
import { createBotActivityLog } from './bot_activity_log.ts';
import { UnexpectedBotActivityError } from './mod.ts';
import type { BotActivityCriteria, JsonStructure } from './mod.ts';

Deno.test('waitFor, cursors and assertNone match a parameter by its JSON structure', async () => {
  const { session, bot, account, callBotWithJson, callBotWithForm } = await createFixture();
  const activity = session.botActivity();
  const start = await activity.position();
  const { result: command } = await account.sendMessage({
    to: { type: 'private', botId: bot.id },
    text: '/help',
  });

  await callBotWithForm('sendMessage', {
    text: 'Unrelated',
    reply_parameters: JSON.stringify({ message_id: command.message_id + 1 }),
  });
  await callBotWithJson('sendMessage', {
    text: 'Help is on its way',
    reply_parameters: { allow_sending_without_reply: false, message_id: command.message_id },
  });

  const reply = await activity.waitFor({
    method: 'sendMessage',
    parameters_json: { reply_parameters: { message_id: command.message_id } },
  }, { after: start });
  // The criteria narrow the entry to a call, whose parameters need no check of its kind.
  if (reply.parameters.text !== 'Help is on its way') {
    throw new Error(`Expected the reply to the command, found ${JSON.stringify(reply)}`);
  }
  const cursor = activity.cursor({ after: start });
  const replyByCursor = await cursor.next({
    parameters_json: { reply_parameters: { message_id: command.message_id } },
  });
  if (replyByCursor.position !== reply.position) {
    throw new Error('Expected the cursor to find the same reply');
  }
  await activity.assertNone(
    { parameters_json: { reply_parameters: { message_id: command.message_id, quote: 'x' } } },
    { after: start, before: reply.position + 1 },
  );
  try {
    await activity.assertNone(
      { parameters_json: { reply_parameters: { message_id: command.message_id } } },
      { after: start, before: reply.position + 1 },
    );
  } catch (error) {
    if (!(error instanceof UnexpectedBotActivityError) || error.entries.length !== 1) {
      throw error;
    }
    await session.end();
    return;
  }
  throw new Error('Expected assertNone to find the reply');
});

Deno.test('A view and a read combine their parameter patterns', async () => {
  const { session, callBotWithJson } = await createFixture();
  await callBotWithJson('sendMessage', {
    text: 'Pick one',
    reply_markup: { inline_keyboard: [[{ text: 'A', callback_data: 'a' }]] },
  });
  const keyboardPattern = { inline_keyboard: [[{ callback_data: 'a', text: 'A' }]] };
  const activity = session.botActivity({ parameters_json: { reply_markup: keyboardPattern } });

  const sameInAnotherOrder = await activity.waitFor({
    parameters: { text: 'Pick one' },
    parameters_json: { reply_markup: { inline_keyboard: [[{ text: 'A', callback_data: 'a' }]] } },
  }, { after: 0 });
  if (sameInAnotherOrder.method !== 'sendMessage') {
    throw new Error('Expected patterns that differ only in member order to combine');
  }
  const conflictingFilters: BotActivityCriteria[] = [
    { parameters_json: { reply_markup: { inline_keyboard: [] } } },
    { parameters_json: { reply_markup: [] } },
  ];
  for (const filter of conflictingFilters) {
    await assertTypeError(
      () => activity.assertNone(filter, { after: 0, before: 1 }),
      `Expected ${JSON.stringify(filter)} to conflict with the view's pattern`,
    );
  }
  await assertTypeError(
    () => activity.assertNone({ update_id: 1 }, { after: 0, before: 1 }),
    "Expected a view's patterns to rule out update criteria",
  );
  await session.end();
});

Deno.test('The client refuses patterns that sending as JSON would change', async () => {
  const { session } = await createFixture();
  const activity = session.botActivity();
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  const patterns: ReadonlyArray<readonly [string, unknown]> = [
    ['a primitive', 'text'],
    ['null', null],
    ['an undefined member', { message_id: undefined }],
    ['NaN', { message_id: Number.NaN }],
    ['Infinity', [Number.POSITIVE_INFINITY]],
    ['a Date', { date: new Date(0) }],
    ['a Map', new Map()],
    ['a function', { toJSON: () => ({}) }],
    ['a bigint', { id: 1n }],
    ['a cycle', cyclic],
    ['a hidden toJSON', withHiddenToJson({ message_id: 1 })],
    ['a hidden toJSON on a nested object', { quote: withHiddenToJson({ text: 'x' }) }],
    ['a getter', Object.defineProperty({}, 'message_id', { get: () => 1, enumerable: true })],
  ];
  for (const [description, pattern] of patterns) {
    await assertTypeError(
      () =>
        activity.assertNone(
          { parameters_json: { reply_parameters: pattern as JsonStructure } },
          { after: 0, before: 1 },
        ),
      `Expected a pattern holding ${description} to be refused`,
    );
  }
  const viewWithHook = session.botActivity({
    parameters_json: withHiddenToJson({ reply_parameters: { message_id: 1 } }),
  });
  await assertTypeError(
    () => viewWithHook.assertNone({}, { after: 0, before: 1 }),
    "Expected a toJSON hook on a view's patterns to be refused",
  );
  await session.end();
});

Deno.test('Each read sends the text of the patterns as it checked them for that read', async () => {
  const requestedUrls: URL[] = [];
  const fetch: typeof globalThis.fetch = (input) => {
    requestedUrls.push(new URL(input instanceof Request ? input.url : input));
    return Promise.resolve(Response.json({ entries: [], head_position: 0 }));
  };
  const replyParameters: { message_id: number } = { message_id: 5 };
  const activity = createBotActivityLog(
    createHttpBotActivityPageReader(
      { serverRoot: new URL('http://emulator.example/'), fetch },
      'session',
    ),
    { parameters_json: { reply_parameters: replyParameters } },
    {},
  );

  // The view's patterns are checked anew for each read, so a change before a read is what it sends.
  replyParameters.message_id = 6;
  await activity.assertNone({ method: 'sendMessage' }, { after: 0, before: 1 });

  const sentPatterns = requestedUrls.map((url) => url.searchParams.get('parameters_json'));
  if (JSON.stringify(sentPatterns) !== JSON.stringify(['{"reply_parameters":{"message_id":6}}'])) {
    throw new Error(`Expected the checked patterns to be sent: ${JSON.stringify(sentPatterns)}`);
  }
});

function withHiddenToJson<Value extends object>(value: Value): Value {
  return Object.defineProperty(value, 'toJSON', {
    value: () => ({ message_id: 999 }),
    enumerable: false,
  });
}

Deno.test('The HTTP page reader sends parameter patterns as one JSON query parameter', async () => {
  const requestedUrls: URL[] = [];
  const fetch: typeof globalThis.fetch = (input) => {
    requestedUrls.push(new URL(input instanceof Request ? input.url : input));
    return Promise.resolve(Response.json({ entries: [], head_position: 0 }));
  };
  const patterns = JSON.parse('{"__proto__":{"a":1},"reply_parameters":{"message_id":5}}');

  await createHttpBotActivityPageReader(
    { serverRoot: new URL('http://emulator.example/'), fetch },
    'session',
  ).readPage({
    after: 0,
    criteria: { parameters_json: patterns },
    limit: 1,
  });

  const [url] = requestedUrls;
  const sentPatterns = url.searchParams.getAll('parameters_json');
  if (
    sentPatterns.length !== 1 ||
    sentPatterns[0] !== '{"__proto__":{"a":1},"reply_parameters":{"message_id":5}}' ||
    url.searchParams.get('kind') !== 'bot_api_call'
  ) {
    throw new Error(`Expected the patterns as JSON text, sent ${url.search}`);
  }
});

async function assertTypeError(action: () => Promise<unknown>, message: string): Promise<void> {
  try {
    await action();
  } catch (error) {
    if (error instanceof TypeError) {
      return;
    }
    throw error;
  }
  throw new Error(message);
}

async function createFixture() {
  const emulator = createTestInProcessEmulator();
  const { fetch } = emulator;
  const { result: session } = await emulator.client.createSession();
  const { result: { token, bot } } = await session.createBot({
    first_name: 'Test Bot',
    username: 'test_bot',
  });
  const { result: { account } } = await session.createAccount({ first_name: 'Ada' });
  const methodUrl = (method: string) => `${session.botApiRoot}/bot${token}/${method}`;

  /** Calls a Bot API method as the bot, in the account's private chat, with a JSON body. */
  const callBotWithJson = async (method: string, parameters: Record<string, unknown>) => {
    const response = await fetch(methodUrl(method), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: account.id, ...parameters }),
    });
    await response.body?.cancel();
  };
  /** Calls a Bot API method as the bot, in the account's private chat, with a form body. */
  const callBotWithForm = async (method: string, parameters: Record<string, string>) => {
    const response = await fetch(methodUrl(method), {
      method: 'POST',
      body: new URLSearchParams({ chat_id: String(account.id), ...parameters }),
    });
    await response.body?.cancel();
  };
  return {
    session,
    bot,
    account,
    callBotWithJson,
    callBotWithForm,
  };
}
