import { assertEquals } from '@std/assert';
import { Bot } from 'https://cdn.jsdelivr.net/gh/grammyjs/grammY@^1.46.0/src/bot.ts';

import { createTestInProcessEmulator } from './support/emulation_api.ts';

Deno.test('grammY bots complete a request-and-reply exchange in their private chat', async () => {
  await using emulator = createTestInProcessEmulator();
  const { fetch } = emulator;
  const { result: session } = await emulator.client.createSession();
  try {
    const { result: coordinator } = await session.createBot({
      first_name: 'Coordinator',
      username: 'coordinator_bot',
      enables_bot_to_bot_communication: true,
    });
    const { result: translator } = await session.createBot({
      first_name: 'Translator',
      username: 'translator_bot',
      enables_bot_to_bot_communication: true,
    });
    const { result: { account } } = await session.createAccount({ first_name: 'Ada' });
    const accountChat = { type: 'private', botId: coordinator.bot.id } as const;

    const coordinatorBot = new Bot(coordinator.token, {
      client: { apiRoot: session.botApiRoot, fetch },
    });
    // The coordinator asks the translator by username, which it has not met before.
    coordinatorBot.command(
      'ask',
      (ctx) => ctx.api.sendMessage('@translator_bot', `translate: ${ctx.match}`),
    );
    coordinatorBot.on('message:text').filter(
      (ctx) => ctx.from.id === translator.bot.id && ctx.msg.reply_to_message !== undefined,
      (ctx) => ctx.api.sendMessage(account.id, `Translation: ${ctx.msg.text}`),
    );
    const translatorBot = new Bot(translator.token, {
      client: { apiRoot: session.botApiRoot, fetch },
    });
    // The translator replies by the private chat's numeric ID, to the request's message.
    translatorBot.on('message:text').filter(
      (ctx) => ctx.from.id === coordinator.bot.id && ctx.chat.type === 'private',
      (ctx) =>
        ctx.reply(ctx.msg.text === 'translate: hola' ? 'hello' : 'unknown', {
          reply_parameters: { message_id: ctx.msg.message_id },
        }),
    );
    const pollingBots = [coordinatorBot, translatorBot];
    const polling = pollingBots.map((bot) => bot.start());
    // `await Promise.all(polling)` below reports an error a bot stops with.
    polling.forEach((run) => run.catch(() => {}));

    try {
      const coordinatorActivity = session.botActivity({ bot_id: coordinator.bot.id });
      const beforeAsking = await coordinatorActivity.position();
      await account.sendMessage({ to: accountChat, text: '/ask hola' });

      await coordinatorActivity.waitFor(
        {
          method: 'sendMessage',
          chat_id: account.id,
          ok: true,
          parameters: { text: 'Translation: hello' },
        },
        { after: beforeAsking },
      );

      const history = (await account.getMessages({ chat: accountChat }))
        .map(({ from, text }) => ({ from: from.first_name, text }));
      assertEquals(history, [
        { from: 'Ada', text: '/ask hola' },
        { from: 'Coordinator', text: 'Translation: hello' },
      ], "Expected the coordinator to relay the translator's answer");
    } finally {
      await Promise.all(pollingBots.map((bot) => bot.stop()));
      await Promise.all(polling);
    }
  } finally {
    await session.end();
  }
});
