import { Bot } from 'https://cdn.jsdelivr.net/gh/grammyjs/grammY@^1.46.0/src/bot.ts';

import { createEmulationApi } from '../src/api/mod.ts';
import { createSessionLifecycleService } from '../src/composition/session_lifecycle.ts';
import { TelegramEmulationClient } from '../clients/typescript/mod.ts';

for (
  const { optedIn, coordinatorEnables, translatorEnables } of [
    { optedIn: 'the sender', coordinatorEnables: true, translatorEnables: false },
    { optedIn: 'the receiver', coordinatorEnables: false, translatorEnables: true },
  ]
) {
  Deno.test(`grammY bots complete a supergroup command-and-reply exchange when ${optedIn} opts in`, async () => {
    const publicOrigin = 'http://emulator.example:9000';
    const api = createEmulationApi({
      sessionLifecycle: createSessionLifecycleService(),
      publicOrigin,
    });
    const fetch = createInProcessFetch(api.fetch);
    const session = await new TelegramEmulationClient(publicOrigin, { fetch }).createSession();
    try {
      const coordinator = await session.createBot({
        first_name: 'Coordinator',
        username: 'coordinator_bot',
        enables_bot_to_bot_communication: coordinatorEnables,
      });
      const translator = await session.createBot({
        first_name: 'Translator',
        username: 'translator_bot',
        enables_bot_to_bot_communication: translatorEnables,
      });
      const { account } = await session.createAccount({ first_name: 'Ada' });
      const supergroup = await account.createSupergroup({ title: 'Team' });
      const chat = { type: 'supergroup', chatId: supergroup.id } as const;
      for (const { bot } of [coordinator, translator]) {
        await account.addChatMember({ chat, userId: bot.id });
      }

      const coordinatorBot = new Bot(coordinator.token, {
        client: { apiRoot: session.botApiRoot, fetch },
      });
      coordinatorBot.command('ask', (ctx) => ctx.reply(`/translate@translator_bot ${ctx.match}`));
      coordinatorBot.on('message:text').filter(
        (ctx) => ctx.from.is_bot && ctx.msg.reply_to_message?.from?.id === ctx.me.id,
        (ctx) => ctx.reply(`Translation: ${ctx.msg.text}`),
      );
      const translatorBot = new Bot(translator.token, {
        client: { apiRoot: session.botApiRoot, fetch },
      });
      translatorBot.command(
        'translate',
        (ctx) =>
          ctx.reply(ctx.match === 'hola' ? 'hello' : 'unknown', {
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
        await account.sendMessage({ to: chat, text: '/ask@coordinator_bot hola' });

        await coordinatorActivity.waitFor(
          {
            method: 'sendMessage',
            chat_id: supergroup.id,
            ok: true,
            parameters: { text: 'Translation: hello' },
          },
          { after: beforeAsking },
        );

        const history = (await account.getMessages({ chat }))
          .filter(({ from }) => from.is_bot)
          .map(({ from, text, reply_to_message }) => ({
            from: from.username,
            text,
            reply_to: reply_to_message?.from?.username,
          }));
        assertJson(history, [
          { from: 'coordinator_bot', text: '/translate@translator_bot hola' },
          { from: 'translator_bot', text: 'hello', reply_to: 'coordinator_bot' },
          { from: 'coordinator_bot', text: 'Translation: hello' },
        ], 'Expected the bots to finish the exchange');
      } finally {
        await Promise.all(pollingBots.map((bot) => bot.stop()));
        await Promise.all(polling);
      }
    } finally {
      await session.end();
    }
  });
}

function createInProcessFetch(
  handler: (request: Request) => Response | Promise<Response>,
): typeof globalThis.fetch {
  return async (input, init) => await handler(new Request(input, init));
}

function assertJson(actual: unknown, expected: unknown, message: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `${message}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`,
    );
  }
}
