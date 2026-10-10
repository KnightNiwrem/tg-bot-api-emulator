import { Bot } from 'grammy';
import { run } from '@grammyjs/runner';

import {
  type ChatAction,
  EmulationClientError,
  type EmulationSessionClient,
  type ExpireChatActionInput,
  type PrivateMessageTarget,
  type SupergroupMessageTarget,
  TelegramEmulationClient,
  type VirtualAccountClient,
} from '../clients/typescript/mod.ts';
import { createTestApi, TEST_PUBLIC_ORIGIN } from './support/emulation_api.ts';

Deno.test('a test expires the chat action an account sees, which the bot can show again', async () => {
  const { session, bot, ada, privateChat, callBot } = await createChatActionFixture();
  try {
    const shown = () => ada.getChatActions({ chat: privateChat });
    const activity = session.botActivity({ bot_id: bot.id });
    const actionCalls = activity.cursor({ after: await activity.position() });

    const withoutAction = await expiryOutcome(ada, { chat: privateChat });
    const responses = [
      await callBot('sendChatAction', { chat_id: ada.id, action: 'typing' }),
      await callBot('sendChatAction', { chat_id: ada.id, action: 'typing' }),
    ];
    const renewed = await shown();
    responses.push(await callBot('sendChatAction', { chat_id: ada.id, action: 'upload_photo' }));
    const changed = await shown();
    const expiry = await expiryOutcome(ada, { chat: privateChat });
    const afterExpiry = await shown();
    const repeated = await expiryOutcome(ada, { chat: privateChat });
    responses.push(await callBot('sendChatAction', { chat_id: ada.id, action: 'typing' }));
    const shownAgain = await shown();
    const recordedActions = [];
    for (let call = 0; call < responses.length; call++) {
      const entry = await actionCalls.next({ method: 'sendChatAction' }, { timeoutMs: 0 });
      recordedActions.push([entry.parameters.action, entry.answer.ok]);
    }

    expectEqual(
      [
        withoutAction,
        responses,
        renewed,
        changed,
        expiry,
        afterExpiry,
        repeated,
        shownAgain,
        recordedActions,
      ],
      [
        404,
        Array(4).fill({ status: 200, body: { ok: true, result: true } }),
        [shownAction(bot.id, 'typing')],
        [shownAction(bot.id, 'upload_photo')],
        'expired',
        [],
        404,
        [shownAction(bot.id, 'typing')],
        [['typing', true], ['typing', true], ['upload_photo', true], ['typing', true]],
      ],
      'Expected renewals to succeed and record each call, and expiry to remove only the shown action',
    );
  } finally {
    await session.end();
  }
});

Deno.test('a chat action stays until the bot ends it or a test expires it', async () => {
  const { session, ada, bot, privateChat, callBot } = await createChatActionFixture();
  try {
    const shown = () => ada.getChatActions({ chat: privateChat });
    const typing = [shownAction(bot.id, 'typing')];
    const showTyping = () => callBot('sendChatAction', { chat_id: ada.id, action: 'typing' });

    await showTyping();
    await callBot('sendMessage', {
      chat_id: ada.id,
      text: 'Reply',
      reply_parameters: { message_id: 999 },
    });
    const afterFailedSend = await shown();
    await callBot('sendChatAction', { chat_id: ada.id, action: 'cancel' });
    const afterCancel = await shown();
    await showTyping();
    await callBot('sendMessage', { chat_id: ada.id, text: 'Final answer' });
    const afterReply = await shown();

    // A late action outlives the reply, as on Telegram, until the test expires it.
    await showTyping();
    await callBot('sendMessageDraft', { chat_id: ada.id, draft_id: 1, text: 'Next answer' });
    const draft = await ada.getMessageDraft({ chat: privateChat });
    const messages = await ada.getMessages({ chat: privateChat });
    const pendingUpdates = await countPendingUpdates(callBot);
    const lateAction = await shown();
    const expiry = await expiryOutcome(ada, { chat: privateChat });

    expectEqual(
      [
        afterFailedSend,
        afterCancel,
        afterReply,
        lateAction,
        expiry,
        await shown(),
        await ada.getMessageDraft({ chat: privateChat }),
        await ada.getMessages({ chat: privateChat }),
        await countPendingUpdates(callBot),
      ],
      [typing, [], [], typing, 'expired', [], draft, messages, pendingUpdates],
      "Expected the action to outlast a failed send and expiry to leave the chat's draft, " +
        'messages and updates as they were',
    );
  } finally {
    await session.end();
  }
});

Deno.test("a test expires one bot's chat action in a supergroup and leaves the others", async () => {
  const { session, fetch, bot, ada, callBot } = await createChatActionFixture();
  try {
    const { bot: otherBot, token: otherBotToken } = await session.createBot({
      first_name: 'Other Bot',
      username: 'other_bot',
    });
    const callOtherBot = callBotWith(fetch, session, otherBotToken);
    const created = await ada.createSupergroup({ title: 'Study group' });
    const chat: SupergroupMessageTarget = { type: 'supergroup', chatId: created.id };
    await ada.addChatMember({ chat, userId: bot.id });
    await ada.addChatMember({ chat, userId: otherBot.id });
    const { account: linus } = await session.createAccount({ first_name: 'Linus' });
    await ada.addChatMember({ chat, userId: linus.id });
    const { account: grace } = await session.createAccount({ first_name: 'Grace' });
    const shown = () => ada.getChatActions({ chat });

    await callBot('sendChatAction', { chat_id: chat.chatId, action: 'typing' });
    await callOtherBot('sendChatAction', { chat_id: chat.chatId, action: 'find_location' });
    await callBot('sendChatAction', { chat_id: chat.chatId, action: 'choose_sticker' });
    const bothActions = await shown();
    const refused = [
      await expiryOutcome(grace, { chat, botId: bot.id }),
      await expiryOutcome(ada, { chat, botId: ada.id }),
      await expiryOutcome(ada, { chat, botId: 999 }),
      await expiryOutcome(ada, {
        chat: { type: 'supergroup', chatId: -1_000_000_000_999 },
        botId: bot.id,
      }),
    ];
    const afterRefusals = await shown();
    // As the timeout ends an action on every member's client at once, any member's expiry does.
    const expiry = await expiryOutcome(linus, { chat, botId: bot.id });
    const afterExpiry = [await shown(), await linus.getChatActions({ chat })];
    const repeated = await expiryOutcome(ada, { chat, botId: bot.id });
    await callBot('sendChatAction', { chat_id: chat.chatId, action: 'typing' });

    expectEqual(
      [bothActions, refused, afterRefusals, expiry, afterExpiry, repeated, await shown()],
      [
        [shownAction(otherBot.id, 'find_location'), shownAction(bot.id, 'choose_sticker')],
        [403, 404, 404, 404],
        [shownAction(otherBot.id, 'find_location'), shownAction(bot.id, 'choose_sticker')],
        'expired',
        [[shownAction(otherBot.id, 'find_location')], [shownAction(otherBot.id, 'find_location')]],
        404,
        [shownAction(otherBot.id, 'find_location'), shownAction(bot.id, 'typing')],
      ],
      "Expected expiry to remove only the bot's action for every member, and refused expiries to " +
        'remove none',
    );
  } finally {
    await session.end();
  }
});

Deno.test('chat action expiry stays within its own chat, account and session', async () => {
  const api = createTestApi();
  const { session, bot, ada, privateChat, callBot } = await createChatActionFixture(api);
  const other = await createChatActionFixture(api);
  try {
    const { account: grace } = await session.createAccount({ first_name: 'Grace' });
    await grace.sendMessage({ to: privateChat, text: '/start' });
    const { bot: otherBot } = await session.createBot({
      first_name: 'Other Bot',
      username: 'other_bot',
    });
    const otherBotChat: PrivateMessageTarget = { type: 'private', botId: otherBot.id };
    await callBot('sendChatAction', { chat_id: ada.id, action: 'typing' });

    const refused = [
      await expiryOutcome(grace, { chat: privateChat }),
      await expiryOutcome(ada, { chat: otherBotChat }),
      await expiryOutcome(other.ada, { chat: other.privateChat }),
    ];
    const accountPath = `/sessions/${session.id}/accounts/${ada.id}/conversations`;
    const rawExpiryStatus = async (path: string) =>
      (await api.request(`${accountPath}/${path}`, { method: 'POST' })).status;
    const malformed = [
      await rawExpiryStatus('private/abc/chat-actions/expiry'),
      await rawExpiryStatus(`supergroup/${bot.id}/chat-actions/${bot.id}/expiry`),
      await rawExpiryStatus('supergroup/-1000000000001/chat-actions/abc/expiry'),
      (await api.request(
        `/sessions/missing/accounts/${ada.id}/conversations/private/${bot.id}/chat-actions/expiry`,
        { method: 'POST' },
      )).status,
    ];

    expectEqual(
      [refused, malformed, await ada.getChatActions({ chat: privateChat })],
      [[404, 404, 404], [400, 400, 400, 404], [shownAction(bot.id, 'typing')]],
      "Expected expiry to reach only the account's own chat with the bot, in its session",
    );
  } finally {
    await session.end();
    await other.session.end();
  }
});

Deno.test('the TypeScript client expires chat actions by the chat its input names', async () => {
  const { session, bot, ada, privateChat, callBot } = await createChatActionFixture();
  try {
    const created = await ada.createSupergroup({ title: 'Study group' });
    const supergroup: SupergroupMessageTarget = { type: 'supergroup', chatId: created.id };
    await ada.addChatMember({ chat: supergroup, userId: bot.id });
    await callBot('sendChatAction', { chat_id: ada.id, action: 'typing' });
    await callBot('sendChatAction', { chat_id: supergroup.chatId, action: 'typing' });

    const rejection = async (input: unknown) => {
      try {
        // Stands for a JavaScript caller, which the input's type does not check.
        await ada.expireChatAction(input as ExpireChatActionInput);
        return 'expired';
      } catch (error) {
        return error instanceof TypeError ? 'TypeError' : error;
      }
    };
    // @ts-expect-error A private chat names its bot, so the input takes no `botId`.
    const privateWithBotId: ExpireChatActionInput = { chat: privateChat, botId: bot.id };
    // @ts-expect-error A supergroup's expiry names the bot whose action expires.
    const supergroupWithoutBotId: ExpireChatActionInput = { chat: supergroup };

    expectEqual(
      [
        await rejection(privateWithBotId),
        await rejection(supergroupWithoutBotId),
        await ada.getChatActions({ chat: privateChat }),
        await ada.getChatActions({ chat: supergroup }),
      ],
      ['TypeError', 'TypeError', [shownAction(bot.id, 'typing')], [shownAction(bot.id, 'typing')]],
      'Expected inputs that misname the bot to be refused before any request',
    );
  } finally {
    await session.end();
  }
});

// Follows "Notifications and chat actions" in docs/clients/typescript/messages.md, with grammY's
// runner in place of the guide's fixture.
Deno.test('a grammY bot types while a test inspects and expires the action', async () => {
  const { session, fetch, bot, ada, privateChat } = await createChatActionFixture();
  const grammyBot = new Bot(bot.token, { client: { apiRoot: session.botApiRoot, fetch } });
  const reportFinished = Promise.withResolvers<void>();
  grammyBot.command('report', async (context) => {
    await context.replyWithChatAction('typing');
    await reportFinished.promise;
    await context.reply('Report ready');
  });
  const activity = session.botActivity({ bot_id: bot.id });
  const start = await activity.position();
  const runner = run(grammyBot);

  try {
    await ada.sendMessage({ to: privateChat, text: '/report' });
    const typing = await activity.waitFor(
      { method: 'sendChatAction', chat_id: ada.id, ok: true },
      { after: start },
    );
    const whileThinking = await ada.getChatActions({ chat: privateChat });
    await ada.expireChatAction({ chat: privateChat });
    const afterExpiry = await ada.getChatActions({ chat: privateChat });

    reportFinished.resolve();
    await activity.waitFor(
      { method: 'sendMessage', chat_id: ada.id, ok: true },
      { after: typing },
    );

    expectEqual(
      [
        whileThinking,
        afterExpiry,
        await ada.getChatActions({ chat: privateChat }),
        (await ada.getMessages({ chat: privateChat })).map(({ text }) => text),
      ],
      [
        [shownAction(bot.id, 'typing')],
        [],
        [],
        ['/start', '/report', 'Report ready'],
      ],
      'Expected the action to show until the test expired it, and the report to arrive after',
    );
  } finally {
    reportFinished.resolve();
    await runner.stop();
    await session.end();
  }
});

type BotApiCaller = (
  method: string,
  parameters: Record<string, unknown>,
) => Promise<BotApiCallResult>;

interface BotApiCallResult {
  readonly status: number;
  readonly body: unknown;
}

interface ChatActionFixture {
  readonly session: EmulationSessionClient;
  readonly fetch: typeof globalThis.fetch;
  readonly bot: { readonly id: number; readonly token: string };
  readonly ada: VirtualAccountClient;
  readonly privateChat: PrivateMessageTarget;
  readonly callBot: BotApiCaller;
}

/** A session in which Ada started a chat with the bot, which answers Bot API calls. */
async function createChatActionFixture(api = createTestApi()): Promise<ChatActionFixture> {
  const fetch: typeof globalThis.fetch = async (input, init) =>
    await api.fetch(new Request(input, init));
  const session = await new TelegramEmulationClient(TEST_PUBLIC_ORIGIN, { fetch }).createSession();
  const createdBot = await session.createBot({ first_name: 'Answer Bot', username: 'answer_bot' });
  const { account: ada } = await session.createAccount({ first_name: 'Ada' });
  const privateChat: PrivateMessageTarget = { type: 'private', botId: createdBot.bot.id };
  await ada.sendMessage({ to: privateChat, text: '/start' });
  return {
    session,
    fetch,
    bot: { id: createdBot.bot.id, token: createdBot.token },
    ada,
    privateChat,
    callBot: callBotWith(fetch, session, createdBot.token),
  };
}

function callBotWith(
  fetch: typeof globalThis.fetch,
  session: EmulationSessionClient,
  token: string,
): BotApiCaller {
  return async (method, parameters) => {
    const response = await fetch(`${session.botApiRoot}/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(parameters),
    });
    return { status: response.status, body: await response.json() };
  };
}

/** `'expired'` for an expiry that succeeded, or the HTTP status it failed with. */
async function expiryOutcome(
  account: VirtualAccountClient,
  input: ExpireChatActionInput,
): Promise<'expired' | number | undefined> {
  try {
    await account.expireChatAction(input);
    return 'expired';
  } catch (error) {
    if (error instanceof EmulationClientError) {
      return error.status;
    }
    throw error;
  }
}

/** How many updates wait for the bot, read without confirming any. */
async function countPendingUpdates(callBot: BotApiCaller): Promise<number> {
  const { body } = await callBot('getUpdates', { timeout: 0 });
  return (body as { result: unknown[] }).result.length;
}

function shownAction(bot_id: number, action: ChatAction['action']): ChatAction {
  return { bot_id, action };
}

function expectEqual(actual: unknown, expected: unknown, message: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `${message}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`,
    );
  }
}
