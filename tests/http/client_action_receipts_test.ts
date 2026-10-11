/**
 * Action receipts as the TypeScript client returns them: every action resolves to the receipt of
 * its session at the log head before it, and a wait after the receipt finds what the action caused,
 * however soon the bot reacts.
 */
import { assert, assertEquals, assertRejects } from '@std/assert';

import type {
  ActionReceipt,
  BotActivityLog,
  EmulationSessionClient,
} from '../../clients/typescript/mod.ts';
import { callBotApi } from '../support/bot_api_requests.ts';
import { createTestInProcessEmulator, type EmulationApi } from '../support/emulation_api.ts';

/** The path of a bot's Bot API methods in a session. */
function botApiPathOf(session: EmulationSessionClient, token: string): string {
  return `/sessions/${session.id}/bot-api/bot${token}`;
}

/** Calls a Bot API method that must succeed, and returns its result. */
async function callBotApiResult(
  api: EmulationApi,
  methodPath: string,
  parameters: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const { status, body } = await callBotApi(api, methodPath, parameters);
  assertEquals(status, 200, `Expected ${methodPath} to succeed: ${JSON.stringify(body)}`);
  return (body as { result: Record<string, unknown> }).result;
}

/**
 * Plays a polling bot that answers each account's text with `Echo: <text>` as soon as its
 * `getUpdates` hands the message over, until it has answered `replyCount` messages.
 */
async function echoMessages(api: EmulationApi, botApiPath: string, replyCount: number) {
  let offset = 0;
  for (let replied = 0; replied < replyCount;) {
    const { body } = await callBotApi(api, `${botApiPath}/getUpdates`, { offset, timeout: 5 });
    const updates = (body as {
      result: { update_id: number; message?: { chat: { id: number }; text?: string } }[];
    }).result;
    for (const { update_id, message } of updates) {
      offset = update_id + 1;
      if (message?.text === undefined) continue;
      await callBotApi(api, `${botApiPath}/sendMessage`, {
        chat_id: message.chat.id,
        text: `Echo: ${message.text}`,
      });
      replied++;
    }
  }
}

Deno.test('Creating a session answers with the new session at position 0', async () => {
  await using emulator = createTestInProcessEmulator();

  const { result: session, receipt } = await emulator.client.createSession();
  const { receipt: botReceipt } = await session.createBot({
    first_name: 'Shop',
    username: 'shop_bot',
  });

  assertEquals(
    [receipt, botReceipt],
    [{ sessionId: session.id, activityPosition: 0 }, {
      sessionId: session.id,
      activityPosition: 0,
    }],
    'Expected the session and its first creation to come before every entry of its log',
  );
});

Deno.test('Each kind of client action answers with the log head before it', async () => {
  await using emulator = createTestInProcessEmulator();
  const { result: session } = await emulator.client.createSession();
  const { result: { token, bot } } = await session.createBot({
    first_name: 'Shop',
    username: 'shop_bot',
  });
  const { result: { account: ada } } = await session.createAccount({ first_name: 'Ada' });
  const { result: { account: grace } } = await session.createAccount({ first_name: 'Grace' });
  const botApiPath = botApiPathOf(session, token);
  const activity = session.botActivity();
  const privateChat = { type: 'private', botId: bot.id } as const;

  /**
   * Records one bot call, so that the head moves before every action, then runs the action and
   * checks that its receipt is the head as it was just before it.
   */
  const checkReceipt = async <Outcome extends ActionReceipt | { readonly receipt: ActionReceipt }>(
    label: string,
    action: () => Promise<Outcome>,
  ): Promise<Outcome> => {
    await callBotApiResult(emulator, `${botApiPath}/getMe`, {});
    const headBefore = await activity.position();
    const outcome = await action();
    const receipt = 'receipt' in outcome ? outcome.receipt : outcome;
    assertEquals(
      receipt,
      { sessionId: session.id, activityPosition: headBefore },
      `Expected ${label} to answer with the head before it`,
    );
    return outcome;
  };

  // Account actions on hand-registered routes, with JSON and with no content.
  const { result: greeting } = await ada.sendMessage({ to: privateChat, text: 'Hello' });
  await checkReceipt('sending a message', () => ada.sendMessage({ to: privateChat, text: 'Hi' }));
  await checkReceipt(
    'editing a message',
    () => ada.editMessage({ chat: privateChat, message_id: greeting.message_id, text: 'Hello!' }),
  );
  await checkReceipt(
    'pinning a message',
    () => ada.pinMessage({ chat: privateChat, message_id: greeting.message_id }),
  );
  await checkReceipt(
    'unpinning a message',
    () => ada.unpinMessage({ chat: privateChat, message_id: greeting.message_id }),
  );
  await checkReceipt(
    'deleting a message',
    () => ada.deleteMessage({ chat: privateChat, message_id: greeting.message_id }),
  );

  // Account actions on contract routes: creations, and actions with no content.
  const { result: supergroup } = await checkReceipt(
    'creating a supergroup',
    () => ada.createSupergroup({ title: 'Team' }),
  );
  const team = { type: 'supergroup', chatId: supergroup.id } as const;
  await checkReceipt('adding a member', () => ada.addChatMember({ chat: team, userId: grace.id }));
  await checkReceipt(
    'changing a title',
    () => ada.changeSupergroupTitle({ chat: team, title: 'Team A' }),
  );
  await checkReceipt('blocking a bot', () => grace.blockBot({ botId: bot.id }));
  await checkReceipt(
    'blocking a blocked bot, which changes nothing',
    () => grace.blockBot({ botId: bot.id }),
  );
  await checkReceipt('unblocking a bot', () => grace.unblockBot({ botId: bot.id }));
  await checkReceipt('creating an account', () => session.createAccount({ first_name: 'Linus' }));

  // Test-harness actions, with JSON and with no content.
  await checkReceipt(
    'choosing webhook scheduling',
    () => session.setWebhookDelivery({ bot_id: bot.id, scheduling: 'manual' }),
  );
  await checkReceipt(
    'registering a web resource',
    () => session.registerWebResource({ url: 'https://cdn.example.com/a.txt' }),
  );
  await checkReceipt(
    'queueing a rate limit answer',
    () => session.queueRateLimitResponses({ bot_id: bot.id, method: 'sendPhoto', retry_after: 1 }),
  );
  const poll = await callBotApiResult(emulator, `${botApiPath}/sendPoll`, {
    chat_id: ada.id,
    question: 'Lunch?',
    options: [{ text: 'Pizza' }, { text: 'Salad' }],
    open_period: 60,
  });
  await checkReceipt('expiring a poll', () => session.expirePoll((poll.poll as { id: string }).id));
  await callBotApiResult(emulator, `${botApiPath}/sendChatAction`, {
    chat_id: ada.id,
    action: 'typing',
  });
  await checkReceipt('expiring a chat action', () => ada.expireChatAction({ chat: privateChat }));
});

Deno.test('A wait after a receipt finds the reply a bot sends at once', async () => {
  await using emulator = createTestInProcessEmulator();
  const { result: session } = await emulator.client.createSession();
  const { result: { token, bot } } = await session.createBot({
    first_name: 'Echo',
    username: 'echo_bot',
  });
  const { result: { account: ada } } = await session.createAccount({ first_name: 'Ada' });
  const activity = session.botActivity({ bot_id: bot.id });
  // The bot holds a long poll, so it receives the message the moment the emulator stores it, and
  // replies before the action's response reaches the test.
  const echoing = echoMessages(emulator, botApiPathOf(session, token), 1);

  const { receipt } = await ada.sendMessage({ to: { type: 'private', botId: bot.id }, text: 'Hi' });
  await echoing;

  const echo = await activity.waitFor(
    { method: 'sendMessage', chat_id: ada.id, parameters: { text: 'Echo: Hi' } },
    { after: receipt },
  );
  const delivery = await activity.waitFor({ kind: 'update_delivered', user_id: ada.id }, {
    after: receipt,
  });
  assert(
    receipt.activityPosition < delivery.position && delivery.position < echo.position,
    'Expected the delivery and the reply after the receipt',
  );
});

Deno.test('Overlapping actions each find their own reply after their receipts', async () => {
  await using emulator = createTestInProcessEmulator();
  const { result: session } = await emulator.client.createSession();
  const { result: { token, bot } } = await session.createBot({
    first_name: 'Echo',
    username: 'echo_bot',
  });
  const { result: { token: otherToken } } = await session.createBot({
    first_name: 'Busy',
    username: 'busy_bot',
  });
  const { result: { account: ada } } = await session.createAccount({ first_name: 'Ada' });
  const { result: { account: grace } } = await session.createAccount({ first_name: 'Grace' });
  const chat = { type: 'private', botId: bot.id } as const;
  const activity = session.botActivity({ bot_id: bot.id });
  const echoing = echoMessages(emulator, botApiPathOf(session, token), 2);
  // Another bot keeps calling, so unrelated activity interleaves with both actions.
  let otherBotCalls = true;
  const otherBotCalling = (async () => {
    while (otherBotCalls) {
      await callBotApiResult(emulator, `${botApiPathOf(session, otherToken)}/getMe`, {});
    }
  })();

  try {
    const [adaSending, graceSending] = await Promise.all([
      ada.sendMessage({ to: chat, text: 'From Ada' }),
      grace.sendMessage({ to: chat, text: 'From Grace' }),
    ]);
    await echoing;

    const [adaEcho, graceEcho] = await Promise.all([
      activity.waitFor({ chat_id: ada.id, parameters: { text: 'Echo: From Ada' } }, {
        after: adaSending.receipt,
      }),
      activity.waitFor({ chat_id: grace.id, parameters: { text: 'Echo: From Grace' } }, {
        after: graceSending.receipt,
      }),
    ]);
    assert(
      adaSending.receipt.activityPosition < adaEcho.position &&
        graceSending.receipt.activityPosition < graceEcho.position,
      'Expected each reply after its own action receipt',
    );
  } finally {
    otherBotCalls = false;
    await otherBotCalling;
  }
});

Deno.test("A receipt of another session starts no wait on this session's log", async () => {
  await using emulator = createTestInProcessEmulator();
  const { result: session } = await emulator.client.createSession();
  const { result: otherSession, receipt: otherReceipt } = await emulator.client.createSession();
  const activity: BotActivityLog = session.botActivity();

  await assertRejects(
    () => activity.waitFor({}, { after: otherReceipt, timeoutMs: 0 }),
    TypeError,
    `The action receipt is of session ${otherSession.id}`,
  );
  await assertRejects(
    () => activity.assertNone({}, { after: otherReceipt, before: 0 }),
    TypeError,
    `not of this bot activity log's session ${session.id}`,
  );
});
