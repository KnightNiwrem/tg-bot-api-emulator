/**
 * Private messages between bots through the Bot API, as Telegram showed them on 2026-11-11 to two
 * bots that both turned on Bot-to-Bot Communication Mode, and as Telegram documents the mode for
 * private chats.
 */
import { assertEquals } from '@std/assert';
import { assertEqualsInFieldOrder } from './support/field_order_assertion.ts';
import { createTestInProcessEmulator } from './support/emulation_api.ts';

interface CreatedTestBot {
  readonly id: number;
  readonly token: string;
}

interface BotApiAnswer {
  readonly ok: boolean;
  readonly result?: unknown;
  readonly error_code?: number;
  readonly description?: string;
}

interface PrivateBotMessage {
  readonly message_id: number;
  readonly from: Record<string, unknown>;
  readonly chat: Record<string, unknown>;
  readonly date: number;
  readonly text?: string;
  readonly reply_to_message?: PrivateBotMessage;
}

interface MessageUpdate {
  readonly update_id: number;
  readonly message?: PrivateBotMessage;
}

const CHAT_NOT_FOUND = { ok: false, error_code: 400, description: 'Bad Request: chat not found' };
const BOT_TO_BOT_COMMUNICATION_DISABLED = {
  ok: false,
  error_code: 400,
  description: 'Bad Request: USER_BOT_TO_BOT_DISABLED',
};

Deno.test('a bot messages another bot by username, and both see the chat from their own side', async () => {
  await using fixture = await createFixture();
  const alpha = await fixture.createBot('alpha_bot', true);
  const beta = await fixture.createBot('beta_bot', true);

  const sent = await fixture.callBotApi(alpha, 'sendMessage', {
    chat_id: '@beta_bot',
    text: 'ping',
  });
  const received = await fixture.readUpdates(beta);

  assertEqualsInFieldOrder(sent, {
    ok: true,
    result: {
      message_id: 1,
      from: { id: alpha.id, is_bot: true, first_name: 'alpha_bot', username: 'alpha_bot' },
      chat: { id: beta.id, type: 'private', first_name: 'beta_bot', username: 'beta_bot' },
      date: fixture.sentAt(sent),
      text: 'ping',
    },
  }, "Expected alpha's result to show its private chat with beta");
  assertEqualsInFieldOrder(received.map(({ message }) => message), [{
    message_id: 1,
    from: { id: alpha.id, is_bot: true, first_name: 'alpha_bot', username: 'alpha_bot' },
    chat: { id: alpha.id, type: 'private', first_name: 'alpha_bot', username: 'alpha_bot' },
    date: fixture.sentAt(sent),
    text: 'ping',
  }], 'Expected beta to receive the message in its private chat with alpha');
  assertEquals(
    await fixture.readUpdates(alpha),
    [],
    'Expected alpha to receive no update for its own message',
  );
});

Deno.test('a bot addresses another bot by username without regard to case, and unknown usernames name no chat', async () => {
  await using fixture = await createFixture();
  const alpha = await fixture.createBot('alpha_bot', true);
  const beta = await fixture.createBot('beta_bot', true);

  const answers = [
    await fixture.callBotApi(alpha, 'sendMessage', { chat_id: '@BETA_BOT', text: 'upper' }),
    await fixture.callBotApi(alpha, 'sendMessage', { chat_id: '@nobody_bot', text: 'unknown' }),
  ];

  assertEquals(
    answers.map(({ ok, description }) => ({ ok, description })),
    [{ ok: true, description: undefined }, { ok: false, description: CHAT_NOT_FOUND.description }],
  );
  assertEquals(
    (await fixture.readUpdates(beta)).map(({ message }) => message?.text),
    ['upper'],
  );
});

Deno.test('a bot reaches another bot by ID only once it resolved its username or received its message', async () => {
  await using fixture = await createFixture();
  const alpha = await fixture.createBot('alpha_bot', true);
  const beta = await fixture.createBot('beta_bot', true);
  const gamma = await fixture.createBot('gamma_bot', true);

  // As on Telegram, neither bot knows the other before it resolves its username.
  const beforeResolution = [
    await fixture.callBotApi(alpha, 'sendMessage', { chat_id: beta.id, text: 'too early' }),
    await fixture.callBotApi(beta, 'sendMessage', { chat_id: alpha.id, text: 'too early' }),
    await fixture.callBotApi(alpha, 'getChat', { chat_id: beta.id }),
  ];
  assertEquals(beforeResolution, [CHAT_NOT_FOUND, CHAT_NOT_FOUND, CHAT_NOT_FOUND]);

  // Resolving a username is enough: getChat by username lets alpha reach beta by ID.
  const resolved = await fixture.callBotApi(alpha, 'getChat', { chat_id: '@beta_bot' });
  const byId = await fixture.callBotApi(alpha, 'sendMessage', { chat_id: beta.id, text: 'hi' });
  // Beta knows alpha once alpha's message reached it, and replies by ID.
  const reply = await fixture.callBotApi(beta, 'sendMessage', { chat_id: alpha.id, text: 'hey' });
  // What alpha knows does not leak to gamma.
  const gammaById = await fixture.callBotApi(gamma, 'sendMessage', {
    chat_id: beta.id,
    text: 'stranger',
  });

  assertEquals(
    [resolved.ok, byId.ok, reply.ok, gammaById],
    [true, true, true, CHAT_NOT_FOUND],
  );
  assertEquals(
    [
      (await fixture.readUpdates(beta)).map(({ message }) => message?.text),
      (await fixture.readUpdates(alpha)).map(({ message }) => message?.text),
    ],
    [['hi'], ['hey']],
  );
});

Deno.test('a bot replies to another bot by its own message IDs, and each bot sees the reply by its own', async () => {
  await using fixture = await createFixture();
  const alpha = await fixture.createBot('alpha_bot', true);
  const beta = await fixture.createBot('beta_bot', true);
  const { account } = await fixture.createAccount();
  // Alpha's box numbers its chat with the account too, so its IDs and beta's differ.
  await account.sendMessage({ to: { type: 'private', botId: alpha.id }, text: '/start' });
  await fixture.readUpdates(alpha);
  const toAccount = await fixture.callBotApi(alpha, 'sendMessage', {
    chat_id: account.id,
    text: 'welcome',
  });

  const request = await fixture.callBotApi(alpha, 'sendMessage', {
    chat_id: '@beta_bot',
    text: 'request',
  });
  const [{ message: received }] = await fixture.readUpdates(beta);
  const reply = await fixture.callBotApi(beta, 'sendMessage', {
    chat_id: received?.chat.id,
    text: 'reply',
    reply_parameters: { message_id: received?.message_id },
  });
  const [{ message: replyForAlpha }] = await fixture.readUpdates(alpha, ['message']);

  assertEquals(
    [
      fixture.messageIdOf(toAccount),
      fixture.messageIdOf(request),
      received?.message_id,
      fixture.messageIdOf(reply),
    ],
    [2, 3, 1, 2],
  );
  assertEquals(
    {
      messageId: replyForAlpha?.message_id,
      chatId: replyForAlpha?.chat.id,
      fromId: replyForAlpha?.from.id,
      repliedMessageId: replyForAlpha?.reply_to_message?.message_id,
      repliedChatId: replyForAlpha?.reply_to_message?.chat.id,
    },
    {
      messageId: 4,
      chatId: beta.id,
      fromId: beta.id,
      repliedMessageId: 3,
      repliedChatId: beta.id,
    },
    'Expected alpha to see the reply and the replied message by its own IDs',
  );
});

Deno.test("a bot's private chats with accounts and bots share one gap-free sequence of message IDs", async () => {
  await using fixture = await createFixture();
  const alpha = await fixture.createBot('alpha_bot', true);
  await fixture.createBot('beta_bot', true);
  const { account } = await fixture.createAccount();
  await account.sendMessage({ to: { type: 'private', botId: alpha.id }, text: '/start' });

  const sends = [
    await fixture.callBotApi(alpha, 'sendMessage', { chat_id: '@beta_bot', text: 'one' }),
    await fixture.callBotApi(alpha, 'sendMessage', { chat_id: account.id, text: 'two' }),
    await fixture.callBotApi(alpha, 'sendMessage', { chat_id: '@beta_bot', text: 'three' }),
  ];
  const accountMessageId = fixture.messageIdOf(sends[1]);
  // As on Telegram, an ID of the account's chat names no message of the chat with beta.
  const wrongChatReply = await fixture.callBotApi(alpha, 'sendMessage', {
    chat_id: '@beta_bot',
    text: 'four',
    reply_parameters: { message_id: accountMessageId },
  });

  assertEquals(sends.map((answer) => fixture.messageIdOf(answer)), [2, 3, 4]);
  assertEquals(wrongChatReply, {
    ok: false,
    error_code: 400,
    description: 'Bad Request: message to be replied not found',
  });
});

Deno.test('private messages between bots need Bot-to-Bot Communication Mode on both bots', async () => {
  const settings = [
    { name: 'sender only', sender: true, recipient: false },
    { name: 'recipient only', sender: false, recipient: true },
    { name: 'neither', sender: false, recipient: false },
    { name: 'omitted', sender: undefined, recipient: undefined },
  ] as const;
  for (const { name, sender, recipient } of settings) {
    await using fixture = await createFixture();
    const alpha = await fixture.createBot('alpha_bot', sender);
    const beta = await fixture.createBot('beta_bot', recipient);
    const { account } = await fixture.createAccount();
    await account.sendMessage({ to: { type: 'private', botId: alpha.id }, text: '/start' });

    const refusals = [
      await fixture.callBotApi(alpha, 'sendMessage', { chat_id: '@beta_bot', text: 'hi' }),
      await fixture.callBotApi(alpha, 'sendMessage', { chat_id: beta.id, text: 'hi' }),
    ];
    // The refused messages took no ID of alpha's box.
    const next = await fixture.callBotApi(alpha, 'sendMessage', {
      chat_id: account.id,
      text: 'next',
    });

    assertEquals(
      {
        refusals,
        nextMessageId: fixture.messageIdOf(next),
        updates: await fixture.readUpdates(beta),
      },
      {
        refusals: [BOT_TO_BOT_COMMUNICATION_DISABLED, BOT_TO_BOT_COMMUNICATION_DISABLED],
        nextMessageId: 2,
        updates: [],
      },
      `Expected a message to be refused with ${name} enabling the mode`,
    );
  }
});

Deno.test('a bot cannot message itself, by ID or by username', async () => {
  await using fixture = await createFixture();
  const alpha = await fixture.createBot('alpha_bot', true);

  const answers = [
    await fixture.callBotApi(alpha, 'sendMessage', { chat_id: alpha.id, text: 'me' }),
    await fixture.callBotApi(alpha, 'sendMessage', { chat_id: '@alpha_bot', text: 'me' }),
  ];

  const refusal = {
    ok: false,
    error_code: 403,
    description: "Forbidden: the bot can't send messages to the bot",
  };
  assertEquals(answers, [refusal, refusal]);
  assertEquals(await fixture.readUpdates(alpha), []);
});

Deno.test('getChat shows a bot its private chat with a bot it knows', async () => {
  await using fixture = await createFixture();
  const alpha = await fixture.createBot('alpha_bot', true);
  const beta = await fixture.createBot('beta_bot', false);

  const answers = [
    await fixture.callBotApi(alpha, 'getChat', { chat_id: '@beta_bot' }),
    await fixture.callBotApi(alpha, 'getChat', { chat_id: beta.id }),
  ];

  const chat = {
    id: beta.id,
    first_name: 'beta_bot',
    username: 'beta_bot',
    type: 'private',
    active_usernames: ['beta_bot'],
    accepted_gift_types: {
      unlimited_gifts: false,
      limited_gifts: false,
      unique_gifts: false,
      premium_subscription: false,
      gifts_from_channels: false,
    },
    max_reaction_count: 11,
    accent_color_id: beta.id % 7,
  };
  for (const answer of answers) {
    assertEqualsInFieldOrder(answer, { ok: true, result: chat }, 'Expected the chat with beta');
  }
});

Deno.test('what a bot knows of other bots stays in its session', async () => {
  await using fixture = await createFixture();
  const alpha = await fixture.createBot('alpha_bot', true);
  const beta = await fixture.createBot('beta_bot', true);
  await fixture.callBotApi(alpha, 'sendMessage', { chat_id: '@beta_bot', text: 'hi' });

  await using otherFixture = await createFixture();
  const otherAlpha = await otherFixture.createBot('alpha_bot', true);
  const otherBeta = await otherFixture.createBot('beta_bot', true);

  assertEquals(
    [
      await otherFixture.callBotApi(otherAlpha, 'sendMessage', {
        chat_id: otherBeta.id,
        text: 'hi',
      }),
      (await fixture.callBotApi(alpha, 'sendMessage', { chat_id: beta.id, text: 'again' })).ok,
    ],
    [CHAT_NOT_FOUND, true],
  );
});

async function createFixture() {
  await using disposalOnFailure = new AsyncDisposableStack();
  const emulator = disposalOnFailure.use(createTestInProcessEmulator());
  const { fetch } = emulator;
  const { result: session } = await emulator.client.createSession();
  disposalOnFailure.defer(async () => {
    await session.end();
  });
  const nextOffsets = new Map<number, number>();

  const callBotApi = async (
    bot: CreatedTestBot,
    method: string,
    parameters: Record<string, unknown> = {},
  ): Promise<BotApiAnswer> => {
    const response = await fetch(`${session.botApiRoot}/bot${bot.token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(parameters),
    });
    return await response.json() as BotApiAnswer;
  };

  const sentMessageOf = (answer: BotApiAnswer): PrivateBotMessage => {
    if (!answer.ok) {
      throw new Error(`Expected a sent message, received ${JSON.stringify(answer)}`);
    }
    return answer.result as PrivateBotMessage;
  };

  const disposal = disposalOnFailure.move();
  return {
    callBotApi,
    async createBot(
      username: string,
      enablesBotToBotCommunication: boolean | undefined,
    ): Promise<CreatedTestBot> {
      const { result: { token, bot } } = await session.createBot({
        first_name: username,
        username,
        ...(enablesBotToBotCommunication === undefined
          ? {}
          : { enables_bot_to_bot_communication: enablesBotToBotCommunication }),
      });
      return { id: bot.id, token };
    },
    async createAccount() {
      const { result } = await session.createAccount({ first_name: 'Ada' });
      return result;
    },
    /** Reads and confirms the bot's pending updates, subscribing it to `allowedUpdates` if given. */
    async readUpdates(
      bot: CreatedTestBot,
      allowedUpdates?: readonly string[],
    ): Promise<MessageUpdate[]> {
      const answer = await callBotApi(bot, 'getUpdates', {
        offset: nextOffsets.get(bot.id) ?? 0,
        timeout: 0,
        ...(allowedUpdates === undefined ? {} : { allowed_updates: allowedUpdates }),
      });
      const updates = answer.result as MessageUpdate[];
      const lastUpdate = updates.at(-1);
      if (lastUpdate !== undefined) {
        nextOffsets.set(bot.id, lastUpdate.update_id + 1);
      }
      return updates;
    },
    messageIdOf: (answer: BotApiAnswer): number => sentMessageOf(answer).message_id,
    sentAt: (answer: BotApiAnswer): number => sentMessageOf(answer).date,
    async [Symbol.asyncDispose]() {
      await disposal.disposeAsync();
    },
  };
}
