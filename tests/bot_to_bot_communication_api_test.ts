import {
  type EmulationSessionClient,
  TelegramEmulationClient,
  type VirtualAccountClient,
} from '../clients/typescript/mod.ts';
import { createTestApi, createTestSession, requestJson } from './support/emulation_api.ts';

interface SentBotMessage {
  readonly message_id: number;
  readonly from: { readonly id: number; readonly is_bot: boolean };
  readonly chat: { readonly id: number };
  readonly text?: string;
  readonly reply_to_message?: { readonly message_id: number };
}

interface BotApiTestUpdate {
  readonly update_id: number;
  readonly message?: SentBotMessage;
}

Deno.test('bot creation accepts a boolean enables_bot_to_bot_communication that getMe omits', async () => {
  const { api, sessionPath } = await createTestSession();
  for (const value of ['true', 1, null, {}]) {
    const refused = await requestJson(api, 'POST', `${sessionPath}/bots`, {
      first_name: 'Relay',
      username: 'refused_bot',
      enables_bot_to_bot_communication: value,
    });
    assertJson(
      refused.status,
      400,
      `Expected enables_bot_to_bot_communication ${JSON.stringify(value)} to be refused`,
    );
  }

  for (const [username, setting] of [['on_bot', true], ['off_bot', false]] as const) {
    const created = await requestJson<{ token: string; bot: Record<string, unknown> }>(
      api,
      'POST',
      `${sessionPath}/bots`,
      { first_name: 'Relay', username, enables_bot_to_bot_communication: setting },
    );
    assertJson(created.status, 201, `Expected ${username} to be created`);
    const me = await requestJson<{ result: Record<string, unknown> }>(
      api,
      'POST',
      `${sessionPath}/bot-api/bot${created.body.token}/getMe`,
    );
    assertJson(
      ['enables_bot_to_bot_communication' in created.body.bot, Object.keys(me.body.result)],
      [false, Object.keys(created.body.bot)],
      `Expected ${username}'s profile and getMe to report no bot-to-bot setting`,
    );
  }
});

Deno.test('an addressed command and a direct reply reach the other bot when either bot opts in', async () => {
  const settings = [
    { name: 'sender only', a: true, b: false, delivered: true },
    { name: 'receiver only', a: false, b: true, delivered: true },
    { name: 'both', a: true, b: true, delivered: true },
    { name: 'neither', a: false, b: false, delivered: false },
    { name: 'omitted', a: undefined, b: undefined, delivered: false },
  ] as const;
  for (const { name, a, b, delivered } of settings) {
    const fixture = await createFixture();
    try {
      const botA = await fixture.addBot('a_bot', a);
      const botB = await fixture.addBot('b_bot', b);
      await fixture.discardUpdates(botA, botB);

      const command = await fixture.send(botA, { text: '/translate@B_Bot hola' });
      const reply = await fixture.send(botB, {
        text: 'hello',
        reply_parameters: { message_id: command.message_id },
      });

      const receivedByB = await fixture.readUpdates(botB);
      const receivedByA = await fixture.readUpdates(botA);
      assertJson(
        [receivedByB.map((update) => update.message), receivedByA.map((update) => update.message)],
        delivered ? [[command], [reply]] : [[], []],
        `Expected the exchange to be ${delivered ? '' : 'un'}delivered with ${name} opted in`,
      );
      if (delivered && receivedByB[0]?.message?.from.is_bot !== true) {
        throw new Error('Expected the command to come from a bot');
      }
      const history = await fixture.owner.getMessages({ chat: fixture.chat });
      assertJson(
        history.slice(-2).map(({ message_id, from }) => [message_id, from.id]),
        [[command.message_id, botA.id], [reply.message_id, botB.id]],
        `Expected the owner to see both bot messages with ${name} opted in`,
      );
    } finally {
      await fixture.session.end();
    }
  }
});

Deno.test('a bot message reaches only the one member bot it addresses', async () => {
  const fixture = await createFixture();
  const otherFixture = await createFixture();
  try {
    const botA = await fixture.addBot('a_bot', true);
    const botB = await fixture.addBot('b_bot', false);
    const botC = await fixture.addBot('c_bot', false);
    const strangerBot = await fixture.createBot('stranger_bot', true);
    const removedBot = await fixture.addBot('removed_bot', true);
    const messageOfRemovedBot = await fixture.send(removedBot, { text: 'Removed bot speaks' });
    await fixture.owner.removeChatMember({ chat: fixture.chat, userId: removedBot.id });
    const otherSessionBotB = await otherFixture.addBot('b_bot', true);
    const bots = { a: botA, b: botB, c: botC, stranger: strangerBot, removed: removedBot };
    await fixture.discardUpdates(...Object.values(bots));
    await otherFixture.discardUpdates(otherSessionBotB);
    const expectRecipients = async (text: string, expected: readonly string[]) => {
      const received: string[] = [];
      for (const [name, bot] of Object.entries(bots)) {
        const updates = await fixture.readUpdates(bot);
        if (updates.some((update) => update.message?.text === text)) {
          received.push(name);
        }
      }
      assertJson(received, expected, `Expected ${JSON.stringify(text)} to reach ${expected}`);
    };
    const sendAndExpect = async (
      sender: CreatedTestBot,
      parameters: Record<string, unknown> & { readonly text: string },
      expected: readonly string[],
    ) => {
      const message = await fixture.send(sender, parameters);
      await expectRecipients(parameters.text, expected);
      return message;
    };

    const questionOfA = await sendAndExpect(botA, { text: '/ask@b_bot' }, ['b']);
    const questionOfC = await sendAndExpect(botC, { text: 'C asks' }, []);
    // A reply to A reaches A, which opted in, from C, which did not.
    await sendAndExpect(botC, {
      text: 'C answers A',
      reply_parameters: { message_id: questionOfA.message_id },
    }, ['a']);
    await sendAndExpect(botA, { text: '/ask@C_BOT' }, ['c']);

    // Mentions, commands without a username, and commands after the start address no bot.
    await sendAndExpect(botA, { text: 'Hello @b_bot' }, []);
    await sendAndExpect(botA, { text: '/ask' }, []);
    await sendAndExpect(botA, { text: 'Please /ask@b_bot' }, []);
    // A bot never receives its own message.
    await sendAndExpect(botA, { text: '/ask@a_bot' }, []);
    await sendAndExpect(botA, {
      text: 'A follows up',
      reply_parameters: { message_id: questionOfA.message_id },
    }, []);
    // Only current members are addressed.
    await sendAndExpect(botA, { text: '/ask@stranger_bot' }, []);
    await sendAndExpect(botA, { text: '/ask@removed_bot' }, []);
    await sendAndExpect(botA, {
      text: 'A answers the removed bot',
      reply_parameters: { message_id: messageOfRemovedBot.message_id },
    }, []);
    // A reply and a command that name different bots address neither; naming the same bot is fine.
    await sendAndExpect(botA, {
      text: '/ask@b_bot in reply to C',
      reply_parameters: { message_id: questionOfC.message_id },
    }, []);
    await sendAndExpect(botA, {
      text: '/ask@c_bot in reply to C',
      reply_parameters: { message_id: questionOfC.message_id },
    }, ['c']);

    // A reply to an account's message addresses no bot, even when that message was meant for one.
    const accountCommand = await fixture.owner.sendMessage({
      to: fixture.chat,
      text: '/ask@b_bot from the owner',
    });
    await expectRecipients('/ask@b_bot from the owner', ['b']);
    await sendAndExpect(botA, {
      text: 'A answers the owner',
      reply_parameters: { message_id: accountCommand.message_id },
    }, []);

    // Edits of bots' messages reach no bot.
    await fixture.callBotApi(botA, 'editMessageText', {
      chat_id: fixture.supergroupId,
      message_id: questionOfA.message_id,
      text: '/ask@b_bot again',
    });
    assertJson(await fixture.readUpdates(botB), [], 'Expected B to receive no edit of A');

    // Messages addressed in another chat or session stay there.
    const otherSupergroup = await fixture.owner.createSupergroup({ title: 'Elsewhere' });
    const otherChat = { type: 'supergroup', chatId: otherSupergroup.id } as const;
    await fixture.owner.addChatMember({ chat: otherChat, userId: botA.id });
    await fixture.callBotApi(botA, 'sendMessage', {
      chat_id: otherSupergroup.id,
      text: '/ask@b_bot elsewhere',
    });
    await expectRecipients('/ask@b_bot elsewhere', []);
    assertJson(
      await otherFixture.readUpdates(otherSessionBotB),
      [],
      'Expected the other session to receive nothing',
    );
  } finally {
    await fixture.session.end();
    await otherFixture.session.end();
  }
});

Deno.test('bot-to-bot messages keep account privacy routing and service messages', async () => {
  const fixture = await createFixture();
  try {
    const botA = await fixture.addBot('a_bot', true);
    const botB = await fixture.addBot('b_bot', false);
    await fixture.discardUpdates(botA, botB);

    await fixture.send(botA, { text: '/ask@b_bot' });
    await fixture.readUpdates(botB);
    // A wrote last, so only A in privacy mode receives the owner's general command.
    await fixture.owner.sendMessage({ to: fixture.chat, text: '/start' });
    assertJson(
      [(await fixture.readUpdates(botA)).length, (await fixture.readUpdates(botB)).length],
      [1, 0],
      'Expected the general command to reach only the bot that wrote last',
    );

    // A bot's service message still reaches every bot.
    await fixture.callBotApi(botB, 'leaveChat', { chat_id: fixture.supergroupId });
    const departure = (await fixture.readUpdates(botA)).find((update) =>
      update.message !== undefined && 'left_chat_member' in update.message
    );
    if (departure === undefined) {
      throw new Error("Expected A to receive B's departure");
    }
  } finally {
    await fixture.session.end();
  }
});

Deno.test('a recipient that excludes message updates never receives a bot-to-bot message', async () => {
  const fixture = await createFixture();
  const webhookRequests: BotApiTestUpdate[] = [];
  const webhookServer = Deno.serve({
    hostname: '127.0.0.1',
    port: 0,
    onListen: () => {},
  }, async (request) => {
    webhookRequests.push(await request.json());
    return new Response(null);
  });
  try {
    const botA = await fixture.addBot('a_bot', true);
    const pollingBot = await fixture.addBot('polling_bot', false);
    const webhookBot = await fixture.addBot('webhook_bot', false);
    await fixture.discardUpdates(webhookBot);
    await fixture.readUpdates(pollingBot, ['callback_query']);
    await fixture.callBotApi(webhookBot, 'setWebhook', {
      url: `http://127.0.0.1:${webhookServer.addr.port}/`,
      allowed_updates: ['callback_query'],
    });

    await fixture.send(botA, { text: '/ask@polling_bot excluded' });
    await fixture.send(botA, { text: '/ask@webhook_bot excluded' });
    assertJson(
      await fixture.readUpdates(pollingBot, ['message']),
      [],
      'Expected the polling bot to have dropped the excluded message',
    );

    const activity = fixture.session.botActivity({ bot_id: webhookBot.id });
    const start = await activity.position();
    await fixture.callBotApi(webhookBot, 'setWebhook', {
      url: `http://127.0.0.1:${webhookServer.addr.port}/`,
      allowed_updates: ['message'],
    });
    const included = await fixture.send(botA, { text: '/ask@webhook_bot included' });
    // Updates are delivered in order, so the first delivery is the first message kept.
    const delivered = await activity.waitFor({ kind: 'update_delivered' }, { after: start });
    assertJson(
      delivered.update,
      { update_id: delivered.update.update_id, message: included },
      'Expected the webhook to receive only the message sent while it accepted messages',
    );
    await activity.waitFor({ kind: 'update_confirmed' }, { after: delivered });
    assertJson(webhookRequests.length, 1, 'Expected one webhook request');
  } finally {
    await fixture.session.end();
    await webhookServer.shutdown();
  }
});

interface CreatedTestBot {
  readonly id: number;
  readonly token: string;
}

async function createFixture() {
  const publicOrigin = 'http://emulator.example:9000';
  const api = createTestApi(publicOrigin);
  const fetch: typeof globalThis.fetch = async (input, init) =>
    await api.fetch(new Request(input, init));
  const session: EmulationSessionClient = await new TelegramEmulationClient(publicOrigin, {
    fetch,
  }).createSession();
  const { account: owner }: { account: VirtualAccountClient } = await session.createAccount({
    first_name: 'Ada',
  });
  const supergroup = await owner.createSupergroup({ title: 'Team' });
  const chat = { type: 'supergroup', chatId: supergroup.id } as const;
  const nextOffsets = new Map<number, number>();

  const callBotApi = async (
    bot: CreatedTestBot,
    method: string,
    parameters: Record<string, unknown> = {},
  ): Promise<unknown> => {
    const response = await fetch(`${session.botApiRoot}/bot${bot.token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(parameters),
    });
    const body = await response.json();
    if (body.ok !== true) {
      throw new Error(`Expected ${method} to succeed, received ${JSON.stringify(body)}`);
    }
    return body.result;
  };
  const createBot = async (
    username: string,
    enablesBotToBotCommunication: boolean | undefined,
  ): Promise<CreatedTestBot> => {
    const { token, bot } = await session.createBot({
      first_name: username,
      username,
      ...(enablesBotToBotCommunication === undefined
        ? {}
        : { enables_bot_to_bot_communication: enablesBotToBotCommunication }),
    });
    return { id: bot.id, token };
  };

  /** Reads and confirms the bot's pending updates, subscribing it to `allowedUpdates` if given. */
  const readUpdates = async (
    bot: CreatedTestBot,
    allowedUpdates?: readonly string[],
  ): Promise<BotApiTestUpdate[]> => {
    const updates = await callBotApi(bot, 'getUpdates', {
      offset: nextOffsets.get(bot.id) ?? 0,
      timeout: 0,
      ...(allowedUpdates === undefined ? {} : { allowed_updates: allowedUpdates }),
    }) as BotApiTestUpdate[];
    const lastUpdate = updates.at(-1);
    if (lastUpdate !== undefined) {
      nextOffsets.set(bot.id, lastUpdate.update_id + 1);
    }
    return updates;
  };

  return {
    session,
    owner,
    readUpdates,
    chat,
    supergroupId: supergroup.id,
    callBotApi,
    createBot,
    async addBot(
      username: string,
      enablesBotToBotCommunication: boolean | undefined,
    ): Promise<CreatedTestBot> {
      const bot = await createBot(username, enablesBotToBotCommunication);
      await owner.addChatMember({ chat, userId: bot.id });
      return bot;
    },
    async send(
      bot: CreatedTestBot,
      parameters: Record<string, unknown>,
    ): Promise<SentBotMessage> {
      return await callBotApi(bot, 'sendMessage', {
        chat_id: supergroup.id,
        ...parameters,
      }) as SentBotMessage;
    },
    /** Confirms the bots' pending updates, such as those of their joining, unread. */
    async discardUpdates(...bots: readonly CreatedTestBot[]): Promise<void> {
      for (const bot of bots) {
        // The second read confirms what the first returned.
        while ((await readUpdates(bot)).length > 0);
      }
    },
  };
}

function assertJson(actual: unknown, expected: unknown, message: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `${message}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`,
    );
  }
}
