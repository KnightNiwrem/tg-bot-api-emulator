# In-process emulator

[Guide index](README.md) · [Getting started](getting-started.md)

When the bot under test runs in the test's own process, the emulator can run there too. There is no
`deno task start` to run first and no port to share, and each test gets an emulator of its own.

The in-process emulator lives in [`in_process/mod.ts`](../../../in_process/mod.ts), next to the
client rather than inside it: it composes the emulator's server code with the client, while the
client itself stays independent of the server.

## The getting-started test, in process

This is the [getting-started](getting-started.md) test with the emulator in process. Save it as
`greeting_in_process_test.ts` in `docs/clients/typescript/`, next to this page.

```ts
import { Bot } from 'npm:grammy@^1.46.0';
import { assertEquals } from 'jsr:@std/assert@^1';
import { createInProcessEmulator } from '../../../in_process/mod.ts';

Deno.test('the bot greets an account that sends /start', async () => {
  // Ends every session on the emulator when the test finishes, even when an assertion fails.
  await using emulator = createInProcessEmulator();
  const { result: session } = await emulator.client.createSession();
  const { result: { token, bot: botProfile } } = await session.createBot({
    first_name: 'Greeter',
    username: 'greeter_bot',
  });
  const { result: { account } } = await session.createAccount({ first_name: 'Ada' });

  // The bot under test reaches the emulator through the emulator's `fetch`.
  const bot = new Bot(token, {
    client: { apiRoot: session.botApiRoot, fetch: emulator.fetch },
  });
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
    const { result: command } = await account.sendMessage({ to: chat, text: '/start' });

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
});
```

From `docs/clients/typescript/`, run it with:

```sh
deno test --allow-env --allow-import=cdn.jsdelivr.net,cdn.skypack.dev,jsr.io greeting_in_process_test.ts
```

It needs no network access. The emulator's own modules load from the hosts `--allow-import` names,
and grammY's npm package reads environment variables when it loads, so it needs `--allow-env`.

## What the emulator provides

`createInProcessEmulator()` returns an emulator with its own, empty set of sessions:

- **`client`** is the control client, a `TelegramEmulationClient` already pointed at the emulator.
  Everything the rest of this guide does with a client works with it.
- **`fetch`** is for the bot under test: pass it to the bot's Bot API client. It behaves like the
  network `fetch`. It serializes each request, including multipart uploads. It rejects with the
  signal's reason when the request's signal aborts, which is how grammY stops polling.
- **Disposal** happens when the `await using` scope ends, or when you call
  `emulator[Symbol.asyncDispose]()`. It ends every session still open on the emulator, which answers
  held long polls and stops webhook deliveries. It then waits for the requests the emulator is
  already answering, and refuses every later request with a `TypeError`.

Requests go through the same HTTP handler as the standalone server's. They are validated, answered
and refused exactly as over the network: control refusals still reject with an
[`EmulationControlError`](troubleshooting.md), and the bot still sees Telegram's error responses.

## Things to know

- **Stop the bot before the emulator is disposed of.** `await using` disposes of the emulator when
  its scope ends, after the `finally` block that stops the bot. A bot still polling afterwards only
  receives refusals.
- **Give the emulator's `fetch` to anything that calls the emulator.** The URLs the emulator
  returns, such as `session.botApiRoot` and the file URLs a bot builds from it, name
  `http://emulator.invalid`, which no network resolves. Pass
  `createInProcessEmulator({ publicOrigin })` to name another origin.
- **Webhooks still go over the network.** The emulator delivers webhook updates with the network
  `fetch`, as the standalone server does. A bot under test that uses webhooks needs a listener of
  its own. Long polling needs none.
- **Every session is the emulator's.** Ending a session yourself with `session.end()` is still fine.
  Disposal ends only the sessions left open.

A bot under test that runs in another process, or in another language, needs the standalone server
from [getting started](getting-started.md) instead.
