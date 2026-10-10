import { Bot } from 'grammy';
import { run } from '@grammyjs/runner';

import {
  type MessageTarget,
  type PrivateMessageTarget,
  type SupergroupMessageTarget,
  TelegramEmulationClient,
  type VirtualAccountClient,
} from '../clients/typescript/mod.ts';
import { createTestApi, TEST_PUBLIC_ORIGIN } from './support/emulation_api.ts';

interface FixtureBot {
  readonly id: number;
  readonly token: string;
}

interface BotApiAnswer {
  readonly ok: boolean;
  readonly result?: unknown;
  readonly description?: string;
}

interface ShownMessage {
  readonly message_id: number;
  readonly text?: string;
  readonly pinned_message?: { readonly text?: string };
}

/** A chat as `getChat` shows it, which omits `pinned_message` when the chat pins nothing. */
interface ShownChat {
  readonly pinned_message?: ShownMessage;
}

/**
 * Creates a session where Ada owns a supergroup with Grace, a reset bot that is an administrator
 * with `can_pin_messages`, and a member bot, and where Ada has started private chats with both
 * bots. Grace may pin by the supergroup's default permissions.
 */
async function createUnpinAllFixture() {
  const api = createTestApi();
  const fetch: typeof globalThis.fetch = async (input, init) =>
    await api.fetch(new Request(input, init));
  const session = await new TelegramEmulationClient(TEST_PUBLIC_ORIGIN, { fetch }).createSession();
  const { account: ada } = await session.createAccount({ first_name: 'Ada' });
  const { account: grace } = await session.createAccount({ first_name: 'Grace' });
  const createBot = async (username: string): Promise<FixtureBot> => {
    const created = await session.createBot({ first_name: 'Test Bot', username });
    return { id: created.bot.id, token: created.token };
  };
  const resetBot = await createBot('reset_bot');
  const memberBot = await createBot('member_bot');
  const supergroup = await ada.createSupergroup({ title: 'Team' });
  const team: SupergroupMessageTarget = { type: 'supergroup', chatId: supergroup.id };
  for (const userId of [grace.id, resetBot.id, memberBot.id]) {
    await ada.addChatMember({ chat: team, userId });
  }
  await ada.promoteChatMember({
    chat: team,
    userId: resetBot.id,
    rights: { can_pin_messages: true },
  });
  const resetBotChat: PrivateMessageTarget = { type: 'private', botId: resetBot.id };
  const memberBotChat: PrivateMessageTarget = { type: 'private', botId: memberBot.id };
  await ada.sendMessage({ to: resetBotChat, text: '/start' });
  await ada.sendMessage({ to: memberBotChat, text: '/start' });

  const callBot = async (bot: FixtureBot, method: string, parameters: object = {}) => {
    const response = await fetch(`${session.botApiRoot}/bot${bot.token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(parameters),
    });
    const answer: BotApiAnswer = await response.json();
    return [response.status, answer.ok ? answer.result : answer.description] as const;
  };
  /** Reads and confirms a bot's pending updates. */
  const takeUpdates = async (bot: FixtureBot) => {
    const [, updates] = await callBot(bot, 'getUpdates', { timeout: 0 });
    const pending = updates as ReadonlyArray<{ readonly update_id: number }>;
    const lastUpdate = pending.at(-1);
    if (lastUpdate !== undefined) {
      await callBot(bot, 'getUpdates', { offset: lastUpdate.update_id + 1, timeout: 0 });
    }
    return pending;
  };
  const pinnedTexts = async (account: VirtualAccountClient, chat: MessageTarget) =>
    (await account.getPinnedMessages({ chat })).map((message) => (message as ShownMessage).text);
  const getChatAsBot = async (bot: FixtureBot, chatId: number): Promise<ShownChat> => {
    const [status, chat] = await callBot(bot, 'getChat', { chat_id: chatId });
    if (status !== 200) {
      throw new Error(`Expected getChat to succeed, received ${status}: ${chat}`);
    }
    return chat as ShownChat;
  };
  /** Sends a message as a bot and returns its ID. */
  const sendAsBot = async (bot: FixtureBot, parameters: object) => {
    const [status, message] = await callBot(bot, 'sendMessage', parameters);
    if (status !== 200) {
      throw new Error(`Expected sendMessage to succeed, received ${status}: ${message}`);
    }
    return (message as ShownMessage).message_id;
  };

  return {
    session,
    fetch,
    ada,
    grace,
    resetBot,
    memberBot,
    team,
    resetBotChat,
    memberBotChat,
    callBot,
    takeUpdates,
    pinnedTexts,
    getChatAsBot,
    sendAsBot,
  };
}

type UnpinAllFixture = Awaited<ReturnType<typeof createUnpinAllFixture>>;

Deno.test('a grammY bot clears every pin on /reset, then pins a fresh notice', async () => {
  const fixture = await createUnpinAllFixture();
  const {
    session,
    fetch,
    ada,
    grace,
    resetBot,
    team,
    callBot,
    pinnedTexts,
    getChatAsBot,
    sendAsBot,
  } = fixture;
  const rules = await ada.sendMessage({ to: team, text: 'rules' });
  const agenda = await grace.sendMessage({ to: team, text: 'agenda' });
  const reply = await grace.sendMessage({
    to: team,
    text: 'noted',
    reply_to_message_id: rules.message_id,
  });
  await ada.pinMessage({ chat: team, message_id: rules.message_id });
  await grace.pinMessage({ chat: team, message_id: agenda.message_id });
  expectEqual(
    await callBot(resetBot, 'pinChatMessage', {
      chat_id: team.chatId,
      message_id: reply.message_id,
    }),
    [200, true],
    'the bot pins too',
  );
  const earlierNotice = await sendAsBot(resetBot, {
    chat_id: team.chatId,
    text: 'Earlier notice',
  });
  expectEqual(
    await callBot(resetBot, 'pinChatMessage', { chat_id: team.chatId, message_id: earlierNotice }),
    [200, true],
    'the bot pins its own earlier notice',
  );
  expectEqual(
    await pinnedTexts(ada, team),
    ['Earlier notice', 'noted', 'agenda', 'rules'],
    'Expected messages by the bot and by accounts to be pinned before the reset',
  );
  const historyBeforeReset = await ada.getMessages({ chat: team });

  const clearingObserved = Promise.withResolvers<void>();
  const grammyBot = new Bot(resetBot.token, { client: { apiRoot: session.botApiRoot, fetch } });
  grammyBot.command('reset', async (context) => {
    await context.unpinAllChatMessages();
    // The notice waits until the test has observed the cleared pins.
    await clearingObserved.promise;
    const notice = await context.reply('Fresh start');
    await context.pinChatMessage(notice.message_id, { disable_notification: true });
  });
  const activity = session.botActivity({ bot_id: resetBot.id });
  const start = await activity.position();
  const runner = run(grammyBot);
  try {
    await ada.sendMessage({ to: team, text: '/reset' });
    const clearing = await activity.waitFor(
      { method: 'unpinAllChatMessages', chat_id: team.chatId, ok: true },
      { after: start },
    );
    const pinsAfterClearing = await pinnedTexts(ada, team);
    const chatAfterClearing = await getChatAsBot(resetBot, team.chatId);
    clearingObserved.resolve();
    const notice = await activity.waitFor(
      { method: 'sendMessage', chat_id: team.chatId, ok: true },
      { after: clearing },
    );
    // The bot receives no update between clearing and sending the notice, which it never
    // receives either; the notice's pin is delivered as a service message.
    await activity.assertNone({ kind: 'update_delivered' }, { after: clearing, before: notice });
    await activity.waitFor(
      { method: 'pinChatMessage', chat_id: team.chatId, ok: true },
      { after: notice },
    );

    expectEqual(
      [pinsAfterClearing, 'pinned_message' in chatAfterClearing],
      [[], false],
      'Expected no pin, and getChat to omit pinned_message, between clearing and repinning',
    );
    expectEqual(
      [
        await pinnedTexts(ada, team),
        (await getChatAsBot(resetBot, team.chatId)).pinned_message?.text,
      ],
      [['Fresh start'], 'Fresh start'],
      'Expected the fresh notice to be the only pin',
    );
    const history = await ada.getMessages({ chat: team });
    expectEqual(
      history.slice(0, historyBeforeReset.length),
      historyBeforeReset,
      'Expected earlier messages, replies and pin service messages to be kept',
    );
    expectEqual(
      history.slice(historyBeforeReset.length).map((message) => {
        const shown = message as ShownMessage;
        return shown.text ?? `pinned ${shown.pinned_message?.text}`;
      }),
      ['/reset', 'Fresh start', 'pinned Fresh start'],
      'Expected the command, the notice and its pin to follow, without an unpin message',
    );
  } finally {
    clearingObserved.resolve();
    await runner.stop();
    await session.end();
  }
});

/**
 * Pins, in the reset bot's private chat, a question Ada sent, which the bot pins, and the bot's
 * reply to it, which Ada pins. Ada also sends and pins one message each in the member bot's private
 * chat and the supergroup.
 */
async function pinInEveryChat(
  { ada, resetBot, team, resetBotChat, memberBotChat, callBot, sendAsBot }: UnpinAllFixture,
): Promise<void> {
  const question = await ada.sendMessage({ to: resetBotChat, text: 'question' });
  const answerId = await sendAsBot(resetBot, {
    chat_id: ada.id,
    text: 'answer',
    reply_parameters: { message_id: question.message_id },
  });
  expectEqual(
    await callBot(resetBot, 'pinChatMessage', { chat_id: ada.id, message_id: question.message_id }),
    [200, true],
    "the bot pins Ada's question in its private chat",
  );
  await ada.pinMessage({ chat: resetBotChat, message_id: answerId });
  const other = await ada.sendMessage({ to: memberBotChat, text: 'other bot' });
  await ada.pinMessage({ chat: memberBotChat, message_id: other.message_id });
  const teamMessage = await ada.sendMessage({ to: team, text: 'team' });
  await ada.pinMessage({ chat: team, message_id: teamMessage.message_id });
}

Deno.test('unpinAllChatMessages clears a private chat alone and keeps its history', async () => {
  const fixture = await createUnpinAllFixture();
  const otherSession = await createUnpinAllFixture();
  const {
    ada,
    resetBot,
    team,
    resetBotChat,
    memberBotChat,
    callBot,
    takeUpdates,
    pinnedTexts,
    getChatAsBot,
  } = fixture;
  try {
    await pinInEveryChat(fixture);
    await pinInEveryChat(otherSession);
    const historyBefore = await ada.getMessages({ chat: resetBotChat });
    await takeUpdates(resetBot);
    expectEqual(
      (await getChatAsBot(resetBot, ada.id)).pinned_message?.text,
      'answer',
      "getChat shows the bot's pinned reply before the unpin",
    );

    expectEqual(
      await callBot(resetBot, 'unpinAllChatMessages', { chat_id: ada.id }),
      [200, true],
      "the bot unpins Ada's question and its own reply in its private chat",
    );
    expectEqual(
      [
        await pinnedTexts(ada, resetBotChat),
        'pinned_message' in await getChatAsBot(resetBot, ada.id),
      ],
      [[], false],
      'the private chat pins nothing, and getChat omits pinned_message',
    );
    expectEqual(
      await ada.getMessages({ chat: resetBotChat }),
      historyBefore,
      'messages, the reply and pin service messages are kept',
    );
    expectEqual(await takeUpdates(resetBot), [], 'no update records the unpin');
    expectEqual(
      [await pinnedTexts(ada, memberBotChat), await pinnedTexts(ada, team)],
      [['other bot'], ['team']],
      "another bot's private chat and the supergroup keep their pins",
    );
    expectEqual(
      await otherSession.pinnedTexts(otherSession.ada, otherSession.resetBotChat),
      ['answer', 'question'],
      'another session keeps its pins',
    );
    expectEqual(
      await callBot(resetBot, 'unpinAllChatMessages', { chat_id: ada.id }),
      [200, true],
      'a chat that pins nothing is unpinned again without error',
    );

    const question = (historyBefore as readonly ShownMessage[]).find(({ text }) =>
      text === 'question'
    );
    if (question === undefined) {
      throw new Error('Expected the question in the history');
    }
    expectEqual(
      await callBot(resetBot, 'pinChatMessage', {
        chat_id: ada.id,
        message_id: question.message_id,
      }),
      [200, true],
      'a message is pinned again',
    );
    expectEqual(
      (await takeUpdates(resetBot)).length,
      1,
      'the new pin is delivered as a service message',
    );
    expectEqual(await pinnedTexts(ada, resetBotChat), ['question'], 'the new pin is listed');
  } finally {
    await fixture.session.end();
    await otherSession.session.end();
  }
});

Deno.test('unpinAllChatMessages refuses before changing any pin, even when nothing is pinned', async () => {
  const { session, ada, grace, resetBot, memberBot, team, resetBotChat, callBot, pinnedTexts } =
    await createUnpinAllFixture();
  try {
    const outsiderBot = await session.createBot({
      first_name: 'Outsider',
      username: 'outsider_bot',
    });
    const outsider = { id: outsiderBot.bot.id, token: outsiderBot.token };
    const notEnoughRights = [
      400,
      'Bad Request: not enough rights to manage pinned messages in the chat',
    ] as const;
    const expectRefusals = async (pinsState: string) => {
      const cases: Array<[FixtureBot, object, readonly [number, unknown]]> = [
        [resetBot, {}, [400, 'Bad Request: chat_id is empty']],
        [resetBot, { chat_id: 'team' }, [
          400,
          'Bad Request: invalid unpinAllChatMessages parameters',
        ]],
        [
          resetBot,
          { chat_id: team.chatId, message_id: 1 },
          [400, 'Bad Request: invalid unpinAllChatMessages parameters'],
        ],
        [outsider, { chat_id: team.chatId }, [400, 'Bad Request: chat not found']],
        [resetBot, { chat_id: grace.id }, [400, 'Bad Request: chat not found']],
        [resetBot, { chat_id: -999_999 }, [400, 'Bad Request: chat not found']],
        [memberBot, { chat_id: team.chatId }, notEnoughRights],
      ];
      for (const [bot, parameters, expected] of cases) {
        expectEqual(
          await callBot(bot, 'unpinAllChatMessages', parameters),
          expected,
          `${JSON.stringify(parameters)} by bot ${bot.id} with ${pinsState}`,
        );
      }
    };

    await expectRefusals('nothing pinned');
    const rules = await ada.sendMessage({ to: team, text: 'rules' });
    await ada.pinMessage({ chat: team, message_id: rules.message_id });
    const hello = await ada.sendMessage({ to: resetBotChat, text: 'hello' });
    await ada.pinMessage({ chat: resetBotChat, message_id: hello.message_id });
    await expectRefusals('pins');

    await ada.demoteChatMember({ chat: team, userId: resetBot.id });
    expectEqual(
      await callBot(resetBot, 'unpinAllChatMessages', { chat_id: team.chatId }),
      notEnoughRights,
      'a demoted bot lost the right',
    );
    await ada.removeChatMember({ chat: team, userId: resetBot.id });
    expectEqual(
      await callBot(resetBot, 'unpinAllChatMessages', { chat_id: team.chatId }),
      [403, 'Forbidden: bot was kicked from the supergroup chat'],
      'a removed bot is turned away',
    );
    await ada.blockBot({ botId: resetBot.id });
    expectEqual(
      await callBot(resetBot, 'unpinAllChatMessages', { chat_id: ada.id }),
      [403, 'Forbidden: bot was blocked by the user'],
      'a blocked bot cannot unpin in the private chat',
    );
    expectEqual(
      [await pinnedTexts(ada, team), await pinnedTexts(ada, resetBotChat)],
      [['rules'], ['hello']],
      'refused calls keep every pin',
    );
  } finally {
    await session.end();
  }
});

function expectEqual(actual: unknown, expected: unknown, message: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `${message}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`,
    );
  }
}
