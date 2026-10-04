# Test controls

[Guide index](README.md) ·
[Feature reference: Sessions and Bot API requests](../../features/sessions-and-requests.md) ·
[Feature reference: Media and files](../../features/media-and-files.md)

Telegram reaches some states only through time, load, or the network: a rate limit, a poll's closing
time, a file a bot sends by URL. A session offers deterministic controls that put the emulator into
those states when the test decides. Examples use the [shared fixture](sessions-and-fixtures.md) and
the [waiting pattern](observing-bot-behavior.md).

## Rate limit answers

`session.queueRateLimitResponses` makes a bot's next calls of a method, or of every method, fail
with `429 Too Many Requests` and the given `retry_after` in seconds, `count` times (once by
default). `session.getRateLimitResponses(botId)` lists the answers still queued. A limited call runs
nothing, and the activity log records it with `ok: false`, so a test correlates the failed call and
the bot's retry by the same method and parameters, `ok: false` and then `ok: true`.
[Rate limit answers](../../features/sessions-and-requests.md#rate-limit-answers) describes the
answer's exact form.

grammY leaves retrying to the bot, for example through its auto-retry plugin. The bot below catches
the `GrammyError` itself and retries once after `retry_after`. The emulator does not reject calls
that come early, so the bot's wait is its own behavior under test, not the test's synchronization.

```ts
import { assert, assertEquals } from 'jsr:@std/assert@^1';
import { GrammyError } from 'npm:grammy@^1.46.0';
import { withBotFixture } from './bot_fixture.ts';

Deno.test('the bot retries a reply that Telegram rate-limited', async () => {
  await withBotFixture({
    handlers: (bot) => {
      bot.command('start', async (ctx) => {
        const reply = () =>
          ctx.reply('Hello!', { reply_parameters: { message_id: ctx.msg.message_id } });
        try {
          await reply();
        } catch (error) {
          const retryAfterSeconds = error instanceof GrammyError && error.error_code === 429
            ? error.parameters.retry_after
            : undefined;
          if (retryAfterSeconds === undefined) throw error;
          await new Promise((resolve) => setTimeout(resolve, retryAfterSeconds * 1_000));
          await reply();
        }
      });
    },
  }, async ({ session, botProfile, account, privateChat, activity }) => {
    const queued = await session.queueRateLimitResponses({
      bot_id: botProfile.id,
      method: 'sendMessage',
      retry_after: 1,
    });
    assertEquals(queued, { method: 'sendMessage', retry_after: 1, remaining_count: 1 });

    const beforeStart = await activity.position();
    const trigger = await account.sendMessage({ to: privateChat, text: '/start' });
    const reply = {
      method: 'sendMessage',
      chat_id: account.id,
      parameters: {
        text: 'Hello!',
        reply_parameters: JSON.stringify({ message_id: trigger.message_id }),
      },
    } as const;
    const limited = await activity.waitFor({ ...reply, ok: false }, { after: beforeStart });
    assert(!limited.answer.ok);
    assertEquals(limited.answer.error_code, 429);
    assertEquals(limited.answer.parameters, { retry_after: 1 });
    await activity.waitFor({ ...reply, ok: true }, { after: limited });

    // The bot used up the queued answer, and the account received one reply.
    assertEquals(await session.getRateLimitResponses(botProfile.id), []);
    const replies = (await account.getMessages({ chat: privateChat })).filter((message) =>
      message.from.id === botProfile.id &&
      message.reply_to_message?.message_id === trigger.message_id
    );
    assertEquals(replies.map(({ text }) => text), ['Hello!']);
  });
});
```

## Time controls

The emulator never lets time end anything by itself. Where Telegram acts when a date arrives, the
test makes that date arrive with a session control, at the point in the scenario it chooses:

| Control                                                   | Makes arrive                           | The bot receives | Walkthrough                                                 |
| --------------------------------------------------------- | -------------------------------------- | ---------------- | ----------------------------------------------------------- |
| `session.expirePoll(pollId)`                              | A poll's `open_period` or `close_date` | A `poll` update  | [Polls](polls.md)                                           |
| `session.expireChatMemberRestriction({ chatId, userId })` | A temporary restriction's `until_date` | Nothing          | [Permissions and moderation](permissions-and-moderation.md) |
| `session.expireChatInviteLink({ chatId, inviteLink })`    | An invite link's `expire_date`         | Nothing          | [Invite links](invite-links.md#expiry-dates)                |

Each control answers the state that results: the closed poll as its bot sees it, the user's standing
(`member`, or `left` for a non-member), or the link as the owner sees it. A control fails with an
`EmulationClientError` whose `status` is `409` when there is no date to make arrive, such as for a
poll without a closing time. The feature pages describe each:
[closing times](../../features/polls.md#closing-times),
[restriction ends](../../features/supergroups.md#restriction-ends) and
[expiry dates](../../features/invite-links.md#expiry-dates).

## The emulated web

Telegram downloads the files bots send by URL. The emulator never reaches the network: it downloads
them from the session's emulated web, where `session.registerWebResource` sets what a URL serves,
with its `content`, `content_type`, `status`, or a redirect `location`. A URL without a resource is
unreachable. A registered photo is downloaded and stored as an upload would be, so the account's
message shows it and `session.downloadFile` returns the registered bytes.
[Files sent by URL](../../features/media-and-files.md#files-sent-by-url) lists the media types each
method accepts and the errors of failed downloads.

```ts
import { assertEquals, assertExists } from 'jsr:@std/assert@^1';
import { withBotFixture } from './bot_fixture.ts';

const LOGO_URL = 'https://example.com/logo.gif';
// A 2×1 GIF, which the emulator accepts as a photo.
const LOGO_GIF = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 2, 0, 1, 0, 0, 0, 0]);

Deno.test('the bot sends a photo by URL from the emulated web', async () => {
  await withBotFixture({
    handlers: (bot) => {
      bot.command('logo', (ctx) =>
        ctx.replyWithPhoto(LOGO_URL, {
          reply_parameters: { message_id: ctx.msg.message_id },
        }));
    },
  }, async ({ session, botProfile, account, privateChat, activity }) => {
    await session.registerWebResource({
      url: LOGO_URL,
      content_type: 'image/gif',
      content: LOGO_GIF,
    });

    const beforeCommand = await activity.position();
    const trigger = await account.sendMessage({ to: privateChat, text: '/logo' });
    await activity.waitFor(
      {
        method: 'sendPhoto',
        chat_id: account.id,
        ok: true,
        parameters: {
          photo: LOGO_URL,
          reply_parameters: JSON.stringify({ message_id: trigger.message_id }),
        },
      },
      { after: beforeCommand },
    );

    const reply = (await account.getMessages({ chat: privateChat })).find((message) =>
      message.from.id === botProfile.id &&
      message.reply_to_message?.message_id === trigger.message_id
    );
    const photo = reply?.photo?.at(-1);
    assertExists(photo);
    assertEquals(await session.downloadFile(photo.file_unique_id), LOGO_GIF);
  });
});
```

Without a registered resource, the bot's call fails with
`Bad Request: failed to get HTTP URL content`, which a test uses to check the bot's fallback:

```ts
import { assert, assertEquals } from 'jsr:@std/assert@^1';
import { GrammyError } from 'npm:grammy@^1.46.0';
import { withBotFixture } from './bot_fixture.ts';

Deno.test('a URL without a registered resource is unreachable', async () => {
  await withBotFixture({
    handlers: (bot) => {
      bot.command('logo', async (ctx) => {
        const replyParameters = { message_id: ctx.msg.message_id };
        try {
          await ctx.replyWithPhoto('https://example.com/logo.gif', {
            reply_parameters: replyParameters,
          });
        } catch (error) {
          if (!(error instanceof GrammyError)) throw error;
          await ctx.reply('The logo is unavailable.', { reply_parameters: replyParameters });
        }
      });
    },
  }, async ({ account, privateChat, activity }) => {
    const beforeCommand = await activity.position();
    const trigger = await account.sendMessage({ to: privateChat, text: '/logo' });
    const replyParameters = JSON.stringify({ message_id: trigger.message_id });

    const failed = await activity.waitFor(
      {
        method: 'sendPhoto',
        chat_id: account.id,
        ok: false,
        parameters: { reply_parameters: replyParameters },
      },
      { after: beforeCommand },
    );
    assert(!failed.answer.ok);
    assertEquals(failed.answer.description, 'Bad Request: failed to get HTTP URL content');
    await activity.waitFor(
      {
        method: 'sendMessage',
        chat_id: account.id,
        ok: true,
        parameters: { text: 'The logo is unavailable.', reply_parameters: replyParameters },
      },
      { after: failed },
    );
  });
});
```

## Upload profiles and custom sessions

A session's upload profile chooses whose upload limits its bots meet: `cloud`, the default, for
`api.telegram.org`, or `local` for a self-hosted Bot API server started with `--local`, which
accepts larger bot uploads. The profile is fixed when the session is created with
`createSession({ upload_profile: 'local' })`, and `session.uploadProfile` reports it.
[Upload profiles](../../features/media-and-files.md#upload-profiles) gives each profile's limits.

The [shared fixture](sessions-and-fixtures.md) creates its own cloud session, so a test that needs
another profile creates the session itself. It then owns the cleanup the fixture would do: it stops
its grammY bot and ends the session in `finally` blocks, so neither outlives a failed assertion.
`session.getMe(token)` checks a token the test created, answering the bot's profile as the Bot API's
`getMe` does.

The bot below uploads a document one byte larger than the cloud's 50 MiB limit, which a `local`
session accepts:

```ts
import { assertEquals, assertExists } from 'jsr:@std/assert@^1';
import { Bot, InputFile } from 'npm:grammy@^1.46.0';
import { TelegramEmulationClient } from '../../../clients/typescript/mod.ts';
import { EMULATOR_URL } from './bot_fixture.ts';

const CLOUD_UPLOAD_LIMIT_BYTES = 50 * 1024 * 1024;
const REPORT_SIZE_BYTES = CLOUD_UPLOAD_LIMIT_BYTES + 1;

Deno.test('a bot of a local session uploads a file larger than the cloud allows', async () => {
  const session = await new TelegramEmulationClient(EMULATOR_URL).createSession({
    upload_profile: 'local',
  });
  try {
    assertEquals(session.uploadProfile, 'local');
    const { token, bot: botProfile } = await session.createBot({
      first_name: 'Report Bot',
      username: 'report_bot',
    });
    assertEquals((await session.getMe(token)).id, botProfile.id);
    const { account } = await session.createAccount({ first_name: 'Ada' });
    const privateChat = { type: 'private', botId: botProfile.id } as const;
    const activity = session.botActivity({ bot_id: botProfile.id });

    const bot = new Bot(token, { client: { apiRoot: session.botApiRoot } });
    bot.command(
      'report',
      (ctx) =>
        ctx.replyWithDocument(new InputFile(new Uint8Array(REPORT_SIZE_BYTES), 'report.bin'), {
          reply_parameters: { message_id: ctx.msg.message_id },
        }),
    );
    const polling = bot.start();
    try {
      const beforeCommand = await activity.position();
      const trigger = await account.sendMessage({ to: privateChat, text: '/report' });
      await activity.waitFor(
        {
          method: 'sendDocument',
          chat_id: account.id,
          ok: true,
          parameters: { reply_parameters: JSON.stringify({ message_id: trigger.message_id }) },
        },
        { after: beforeCommand },
      );

      const reply = (await account.getMessages({ chat: privateChat })).find((message) =>
        message.from.id === botProfile.id &&
        message.reply_to_message?.message_id === trigger.message_id
      );
      assertExists(reply?.document);
      assertEquals(reply.document.file_size, REPORT_SIZE_BYTES);
    } finally {
      await bot.stop();
      await polling;
    }
  } finally {
    await session.end();
  }
});
```
