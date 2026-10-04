# Getting started

[Guide index](README.md) · [Project README](../../../README.md)

This page takes you from an empty terminal to a passing test: a [grammY](https://grammy.dev) bot
greets an account that sends `/start`, and the test asserts the greeting the account sees.

## Start the emulator

With [Deno](https://deno.com) 2 installed, start the emulator from the repository root and leave it
running:

```sh
deno task start
```

It listens on `http://localhost:8081`. The [project README](../../../README.md#environment) lists
the settings that change the address.

## Write the test

Save this file as `greeting_test.ts` in `docs/clients/typescript/`, next to this page. The client
import is relative to that directory; from anywhere else, point it at the repository's
`clients/typescript/mod.ts`.

```ts
import { Bot } from 'npm:grammy@^1.46.0';
import { assertEquals } from 'jsr:@std/assert@^1';
import { TelegramEmulationClient } from '../../../clients/typescript/mod.ts';

Deno.test('the bot greets an account that sends /start', async () => {
  const emulator = new TelegramEmulationClient('http://localhost:8081');
  const session = await emulator.createSession();
  try {
    const { token, bot: botProfile } = await session.createBot({
      first_name: 'Greeter',
      username: 'greeter_bot',
    });
    const { account } = await session.createAccount({ first_name: 'Ada' });

    // The bot under test: ordinary grammY code, pointed at the session's Bot API root.
    const bot = new Bot(token, { client: { apiRoot: session.botApiRoot } });
    bot.command('start', (ctx) =>
      ctx.reply(`Welcome, ${ctx.from?.first_name}!`, {
        reply_parameters: { message_id: ctx.msg.message_id },
      }));
    const polling = bot.start();

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
      assertEquals(greeting?.text, 'Welcome, Ada!');
    } finally {
      await bot.stop();
      await polling;
    }
  } finally {
    await session.end();
  }
});
```

## Run it

In a second terminal, from `docs/clients/typescript/`:

```sh
deno test --allow-net --allow-env greeting_test.ts
```

The test needs network access to reach the emulator. grammY's npm package reads environment
variables when it loads, so it also needs `--allow-env`.

## What the test does

1. **Creates a session.** A session is an isolated Telegram: its bots, accounts, chats and messages
   exist only inside it, and `session.end()` discards them. Every test gets its own.
2. **Registers a bot and an account.** `createBot` returns the bot's token and its profile;
   `createAccount` returns a client that acts as a Telegram user.
3. **Runs the bot under test.** The bot is ordinary grammY code. Only its API root changes, to
   `session.botApiRoot`, so it long-polls the emulator instead of Telegram.
4. **Takes a position in the bot activity log** before acting. The log records the Bot API calls the
   bot makes, other than its `getUpdates` polling, in order, so the test can wait for calls that
   come after its action.
5. **Acts as the account.** `sendMessage` returns once the bot can receive the message, not once the
   bot has handled it.
6. **Waits for the bot's reply.** `waitFor` resolves with the first successful `sendMessage` to the
   account's chat that replies to the command. Matching only on the method would also accept any
   other message the bot happened to send.
7. **Selects the reply and asserts on it.** The account's history holds both messages; the test
   picks the bot's reply to its command rather than the latest message.
8. **Cleans up.** The `finally` blocks stop the bot and end the session even when an assertion
   fails, so a failing test leaves nothing running.

## Next steps

Continue with the core path:

1. [Sessions and fixtures](sessions-and-fixtures.md) explains what a session owns and turns the
   setup above into a reusable fixture.
2. [Observing bot behavior](observing-bot-behavior.md) covers waiting, correlation, ordering and
   asserting that something did not happen.
3. [Messages](messages.md) covers conversations: replies, edits, deletions, forwards and pins.

The [guide index](README.md) lists the topic pages you can read in any order afterwards.
