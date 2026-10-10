import { Bot } from 'grammy';

import { TelegramEmulationClient } from '../clients/typescript/mod.ts';
import { createTestApi } from './support/emulation_api.ts';

// Follows docs/clients/typescript/getting-started.md, whose snippet `deno task check` type-checks,
// with an in-process emulator in place of the one `deno task start` serves.
Deno.test('the getting-started test: the bot greets an account that sends /start', async () => {
  const publicOrigin = 'http://emulator.example:9000';
  const api = createTestApi(publicOrigin);
  const fetch = createInProcessFetch(api.fetch);
  const emulator = new TelegramEmulationClient(publicOrigin, { fetch });
  const session = await emulator.createSession();
  try {
    const { token, bot: botProfile } = await session.createBot({
      first_name: 'Greeter',
      username: 'greeter_bot',
    });
    const { account } = await session.createAccount({ first_name: 'Ada' });

    const bot = new Bot(token, { client: { apiRoot: session.botApiRoot, fetch } });
    bot.command('start', (ctx) =>
      ctx.reply(`Welcome, ${ctx.from?.first_name}!`, {
        reply_parameters: { message_id: ctx.msg.message_id },
      }));
    const polling = bot.start();
    // `await polling` below reports an error the bot stops with; until then, it is not unhandled.
    polling.catch(() => {});

    try {
      const activity = session.botActivity({ bot_id: botProfile.id });
      const chat = { type: 'private', botId: botProfile.id } as const;

      const beforeStart = await activity.position();
      const command = await account.sendMessage({ to: chat, text: '/start' });

      await activity.waitFor(
        {
          method: 'sendMessage',
          chat_id: account.id,
          ok: true,
          parameters: { reply_parameters: JSON.stringify({ message_id: command.message_id }) },
        },
        { after: beforeStart },
      );
      const greeting = (await account.getMessages({ chat })).find(({ from, reply_to_message }) =>
        from.id === botProfile.id && reply_to_message?.message_id === command.message_id
      );
      if (greeting?.text !== 'Welcome, Ada!') {
        throw new Error(`Expected the bot's greeting, received ${greeting?.text}`);
      }
    } finally {
      await bot.stop();
      await polling;
    }
  } finally {
    await session.end();
  }
});

function createInProcessFetch(
  handler: (request: Request) => Response | Promise<Response>,
): typeof globalThis.fetch {
  return async (input, init) => await handler(new Request(input, init));
}
