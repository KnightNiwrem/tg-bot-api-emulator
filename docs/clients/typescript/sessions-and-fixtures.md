# Sessions and fixtures

[Guide index](README.md) ·
[Feature reference: Sessions and requests](../../features/sessions-and-requests.md)

[Getting started](getting-started.md) wrote all of its setup inline. This page explains what each
object owns and turns that setup into a fixture, `bot_fixture.ts`, which the topic pages of this
guide import.

## Who owns what

| Object                    | Created by                         | Owns and does                                                                                          |
| ------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `TelegramEmulationClient` | `new TelegramEmulationClient(url)` | Knows where the emulator runs; creates sessions                                                        |
| `EmulationSessionClient`  | `emulator.createSession()`         | An isolated Telegram: its bots, accounts, chats, messages, files and activity log; `end()` discards it |
| A virtual bot             | `session.createBot(...)`           | A token and a profile; the bot's own code calls the Bot API at `session.botApiRoot` with the token     |
| `VirtualAccountClient`    | `session.createAccount(...)`       | A Telegram user the test acts as; its methods are what a person does in a Telegram app                 |
| `BotActivityLog`          | `session.botActivity(filter?)`     | A view of the session's log of bot calls and updates, for waiting and ordering assertions              |

The client never runs your bot. The bot is your own code, configured with the token and with
`session.botApiRoot` as its API root, exactly as it would be configured for Telegram. Any Bot API
library that takes an API root works; this guide uses grammY.

Sessions share nothing, so tests that each create their own session can run in parallel against one
emulator, and a failed test cannot leak state into the next. Bot and account options, such as a
bot's privacy mode or inline mode and an account's username, phone number or language, are fixed
when they are created. The
[feature reference](../../features/sessions-and-requests.md#supported-behavior) lists them and the
rules their values follow.

## One session, several participants

A session holds as many bots and accounts as a scenario needs. Each account has its own private chat
with a bot, and `getMessages` returns only the chats the account takes part in:

```ts
import { Bot } from 'npm:grammy@^1.46.0';
import { assertEquals } from 'jsr:@std/assert@^1';
import { TelegramEmulationClient } from '../../../clients/typescript/mod.ts';

Deno.test('each account sees only its own conversation with the bot', async () => {
  const session = await new TelegramEmulationClient('http://localhost:8081').createSession();
  try {
    const { token, bot: botProfile } = await session.createBot({
      first_name: 'Echo Bot',
      username: 'echo_bot',
    });
    assertEquals((await session.getMe(token)).username, 'echo_bot');
    const { account: ada } = await session.createAccount({ first_name: 'Ada' });
    const { account: grace } = await session.createAccount({ first_name: 'Grace' });

    const bot = new Bot(token, { client: { apiRoot: session.botApiRoot } });
    bot.on('message:text', (ctx) => ctx.reply(`${ctx.from.first_name} said: ${ctx.msg.text}`));
    const polling = bot.start();
    // `await polling` below reports an error the bot stops with; until then, it is not unhandled.
    polling.catch(() => {});
    try {
      const activity = session.botActivity({ bot_id: botProfile.id });
      const chat = { type: 'private', botId: botProfile.id } as const;

      const beforeMessages = await activity.position();
      await ada.sendMessage({ to: chat, text: 'hello' });
      await grace.sendMessage({ to: chat, text: 'hi' });
      await Promise.all([
        activity.waitFor(
          { method: 'sendMessage', chat_id: ada.id, ok: true },
          { after: beforeMessages },
        ),
        activity.waitFor(
          { method: 'sendMessage', chat_id: grace.id, ok: true },
          { after: beforeMessages },
        ),
      ]);

      const adaHistory = await ada.getMessages({ chat });
      assertEquals(adaHistory.map(({ text }) => text), ['hello', 'Ada said: hello']);
      const graceHistory = await grace.getMessages({ chat });
      assertEquals(graceHistory.map(({ text }) => text), ['hi', 'Grace said: hi']);
    } finally {
      await bot.stop();
      await polling;
    }
  } finally {
    await session.end();
  }
});
```

Here a whole private chat's history is a precise assertion: each chat has exactly the two messages
the scenario produces.

## A reusable fixture

Most tests need the same setup: a session, a bot running the handlers under test, an account, and an
activity view of the bot. They also need the same cleanup, in the right order, however the test
ends. Putting both in one function keeps every test about its scenario. Save this file as
`bot_fixture.ts` next to your tests; the guide's copy is [`bot_fixture.ts`](bot_fixture.ts) beside
this page.

```ts
/**
 * The reusable test setup of the TypeScript client guide, which
 * [Sessions and fixtures](sessions-and-fixtures.md) explains. Each test gets its own emulation
 * session with one grammY bot and one account, and the fixture stops the bot and ends the session
 * however the test finishes.
 */
import { Bot } from 'npm:grammy@^1.46.0';
import {
  type BotActivityLog,
  type CreateVirtualAccountInput,
  type CreateVirtualBotInput,
  type EmulationSessionClient,
  type PrivateMessageTarget,
  TelegramEmulationClient,
  type VirtualAccountClient,
  type VirtualBotProfile,
} from '../../../clients/typescript/mod.ts';

/** Where `deno task start` serves the emulator by default. */
export const EMULATOR_URL = 'http://localhost:8081';

export interface BotFixtureOptions {
  /** Registers the bot's handlers; the fixture starts polling once they are in place. */
  readonly handlers: (bot: Bot) => void;
  /** Overrides the bot's registration, which defaults to `Test Bot` with username `test_bot`. */
  readonly bot?: Partial<CreateVirtualBotInput>;
  /** Overrides the account's registration, which defaults to `Ada`. */
  readonly account?: Partial<CreateVirtualAccountInput>;
}

export interface BotFixture {
  /** The emulation session that owns the bot, the account, and everything they create. */
  readonly session: EmulationSessionClient;
  /** The bot as Telegram describes it, including its `id` and `username`. */
  readonly botProfile: VirtualBotProfile;
  /** The grammY bot under test, polling the session's Bot API root. */
  readonly bot: Bot;
  /** The virtual account that talks to the bot. */
  readonly account: VirtualAccountClient;
  /** The account's private chat with the bot. */
  readonly privateChat: PrivateMessageTarget;
  /** The bot's calls and updates, in the order the emulator decided them. */
  readonly activity: BotActivityLog;
}

/**
 * Runs `test` against a fresh session whose bot polls with the given handlers. The bot stops and
 * the session ends even when the test fails, and an error the bot's polling ends with fails the
 * test.
 */
export async function withBotFixture(
  options: BotFixtureOptions,
  test: (fixture: BotFixture) => Promise<void>,
): Promise<void> {
  const session = await new TelegramEmulationClient(EMULATOR_URL).createSession();
  try {
    const { token, bot: botProfile } = await session.createBot({
      first_name: 'Test Bot',
      username: 'test_bot',
      ...options.bot,
    });
    const { account } = await session.createAccount({ first_name: 'Ada', ...options.account });
    const bot = new Bot(token, { client: { apiRoot: session.botApiRoot } });
    options.handlers(bot);
    const pollingStarted = Promise.withResolvers<void>();
    const polling = bot.start({ onStart: () => pollingStarted.resolve() });
    // `await polling` below reports an error the bot stops with; until then, it is not unhandled.
    polling.catch(() => {});
    try {
      // A bot stopped before it polls leaves grammY's startup retries rejecting unhandled.
      await Promise.race([pollingStarted.promise, polling]);
      await test({
        session,
        botProfile,
        bot,
        account,
        privateChat: { type: 'private', botId: botProfile.id },
        activity: session.botActivity({ bot_id: botProfile.id }),
      });
    } finally {
      await bot.stop();
      await polling;
    }
  } finally {
    await session.end();
  }
}
```

The test starts only once grammY polls, so even a test that ends at once stops a bot that has
finished starting. The bot stops before the session ends, so its last poll is not refused by a
session that no longer exists. Awaiting `polling` turns an error the bot stopped with, such as an
exception a handler threw, into a failure of the test.

A test passes its handlers and receives the fixture. Options override the bot's or account's
registration, and further accounts come from `session.createAccount`:

```ts
import { assertEquals } from 'jsr:@std/assert@^1';
import { withBotFixture } from './bot_fixture.ts';

Deno.test('the bot answers in the language of each account', () =>
  withBotFixture({
    account: { first_name: 'Ada', language_code: 'en' },
    handlers: (bot) =>
      bot.command('hello', (ctx) =>
        ctx.reply(ctx.from?.language_code === 'de' ? 'Hallo!' : 'Hello!', {
          reply_parameters: { message_id: ctx.msg.message_id },
        })),
  }, async ({ session, botProfile, account, privateChat, activity }) => {
    const { account: grete } = await session.createAccount({
      first_name: 'Grete',
      language_code: 'de',
    });

    for (const [speaker, expectedGreeting] of [[account, 'Hello!'], [grete, 'Hallo!']] as const) {
      const beforeCommand = await activity.position();
      const command = await speaker.sendMessage({ to: privateChat, text: '/hello' });
      await activity.waitFor(
        {
          method: 'sendMessage',
          chat_id: speaker.id,
          ok: true,
          parameters: { reply_parameters: JSON.stringify({ message_id: command.message_id }) },
        },
        { after: beforeCommand },
      );
      const greeting = (await speaker.getMessages({ chat: privateChat })).find((message) =>
        message.from.id === botProfile.id &&
        message.reply_to_message?.message_id === command.message_id
      );
      assertEquals(greeting?.text, expectedGreeting);
    }
  }));
```

Run tests that use the fixture as [Getting started](getting-started.md#run-it) runs its test.

## Adapting the fixture

The fixture is a starting point, not part of the client. Change it to fit your bot:

- **Your bot's own setup.** Replace `options.handlers` with a call to the function that builds your
  production bot, so the test exercises the same middleware, plugins and error handling.
- **Another framework.** Any Bot API library that takes an API root works; start and stop it where
  the fixture starts and stops grammY.
- **Webhooks.** A bot can register a webhook with `setWebhook` instead of polling. The
  [webhook reference](../../features/webhooks.md) describes delivery and its limits.
- **Session settings.** `createSession({ upload_profile: 'local' })` chooses the upload limits of a
  self-hosted Bot API server; [Test controls](test-controls.md) covers it with the other
  session-level controls.

## When a client call fails

Client operations reject with an `EmulationClientError` when the emulator refuses a request, as it
does when an account does something Telegram would not let it do, such as writing to a bot it has
blocked. The error carries the request's `method` and `url`, and the response's `status`, which says
why: `404` for something that does not exist, such as an ended session, and `409` for an action the
current state does not allow. The [OpenAPI description](../../../openapi/openapi.yaml) lists each
operation's statuses, and [Troubleshooting](troubleshooting.md) lists common causes.
