import { Bot } from 'https://cdn.jsdelivr.net/gh/grammyjs/grammY@^1.46.0/src/bot.ts';
import { run } from '@grammyjs/runner/runner.ts';
import { sequentialize } from '@grammyjs/runner/sequentialize.ts';

import { latest, TelegramEmulationClient } from '../clients/typescript/mod.ts';
import { createTestApi } from './support/emulation_api.ts';

Deno.test('a sequentialized grammY runner keeps each chat in order while chats interleave', async () => {
  const { session, fetch, createdBot, ada, grace } = await createFixture();
  const grammyBot = new Bot(createdBot.token, {
    client: { apiRoot: session.botApiRoot, fetch },
  });
  grammyBot.use(sequentialize((context) => context.chat?.id.toString()));
  grammyBot.command('order', async (context) => {
    await context.replyWithChatAction('typing');
    // Lets the other chat's order, and this chat's later commands, arrive meanwhile.
    await delay(20);
    await context.reply('Order received');
    await context.reply('Order shipped');
  });
  grammyBot.command('status', (context) => context.reply('Status: shipped'));
  const activity = session.botActivity({ bot_id: createdBot.bot.id });
  const start = await activity.position();
  const runner = run(grammyBot);

  try {
    await ada.sendMessage({ to: { type: 'private', botId: createdBot.bot.id }, text: '/order' });
    await grace.sendMessage({ to: { type: 'private', botId: createdBot.bot.id }, text: '/order' });
    await ada.sendMessage({ to: { type: 'private', botId: createdBot.bot.id }, text: '/status' });

    const shippedByChat = new Map<number, number>();
    for (const chatId of [ada.id, grace.id]) {
      const typing = await activity.waitFor(
        { method: 'sendChatAction', chat_id: chatId },
        { after: start },
      );
      const received = await activity.waitFor(
        { method: 'sendMessage', chat_id: chatId, parameters: { text: 'Order received' } },
        { after: typing },
      );
      const shipped = await activity.waitFor(
        { method: 'sendMessage', chat_id: chatId, parameters: { text: 'Order shipped' } },
        { after: received },
      );
      shippedByChat.set(chatId, shipped.position);
    }
    // sequentialize starts Ada's /status only after her /order was handled, so the status reply
    // fences off everything the /order handler did.
    const status = await activity.waitFor(
      { method: 'sendMessage', chat_id: ada.id, parameters: { text: 'Status: shipped' } },
      { after: shippedByChat.get(ada.id) ?? start },
    );
    await activity.assertNone(
      { method: 'sendMessage', chat_id: ada.id, parameters: { text: 'Order received' } },
      { after: shippedByChat.get(ada.id) ?? start, before: status },
    );
  } finally {
    await runner.stop();
    await session.end();
  }
});

Deno.test('a grammY runner without sequentialize keeps the order each handler awaits', async () => {
  const { session, fetch, createdBot, ada, grace } = await createFixture();
  const grammyBot = new Bot(createdBot.token, {
    client: { apiRoot: session.botApiRoot, fetch },
  });
  grammyBot.command('pair', async (context) => {
    await context.reply('A');
    await Promise.all([context.reply('B'), context.reply('C')]);
    await context.reply('D');
  });
  const activity = session.botActivity({ bot_id: createdBot.bot.id });
  const start = await activity.position();
  const runner = run(grammyBot);

  try {
    await ada.sendMessage({ to: { type: 'private', botId: createdBot.bot.id }, text: '/pair' });
    await grace.sendMessage({ to: { type: 'private', botId: createdBot.bot.id }, text: '/pair' });

    for (const chatId of [ada.id, grace.id]) {
      const reply = (text: string) =>
        ({ method: 'sendMessage', chat_id: chatId, parameters: { text } }) as const;
      const delivered = await activity.waitFor(
        { kind: 'update_delivered', chat_id: chatId },
        { after: start },
      );
      const a = await activity.waitFor(reply('A'), { after: delivered });
      const [b, c] = await Promise.all([
        activity.waitFor(reply('B'), { after: a }),
        activity.waitFor(reply('C'), { after: a }),
      ]);
      await activity.waitFor(reply('D'), { after: latest(b, c) });
    }
  } finally {
    await runner.stop();
    await session.end();
  }
});

async function createFixture() {
  const publicOrigin = 'http://emulator.example:9000';
  const api = createTestApi(publicOrigin);
  const fetch = createInProcessFetch(api.fetch);
  const session = await new TelegramEmulationClient(publicOrigin, { fetch }).createSession();
  const createdBot = await session.createBot({ first_name: 'Shop Bot', username: 'shop_bot' });
  const { account: ada } = await session.createAccount({ first_name: 'Ada' });
  const { account: grace } = await session.createAccount({ first_name: 'Grace' });
  return { session, fetch, createdBot, ada, grace };
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function createInProcessFetch(
  handler: (request: Request) => Response | Promise<Response>,
): typeof globalThis.fetch {
  return async (input, init) => await handler(new Request(input, init));
}
