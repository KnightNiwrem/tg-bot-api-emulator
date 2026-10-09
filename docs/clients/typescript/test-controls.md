# Test controls

[Guide index](README.md) ·
[Feature reference: Sessions and Bot API requests](../../features/sessions-and-requests.md) ·
[Feature reference: Media and files](../../features/media-and-files.md) ·
[Feature reference: Webhooks](../../features/webhooks.md)

Telegram reaches some states only through time, load, or the network: a rate limit, a server error,
a webhook retry, a poll's closing time, a file a bot sends by URL. A session offers deterministic
controls that put the emulator into those states when the test decides. Examples use the
[shared fixture](sessions-and-fixtures.md) and the [waiting pattern](observing-bot-behavior.md).

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

## Server error answers

`session.queueServerErrorResponses` makes a bot's next calls of a method, or of every method, fail
with `500 Internal Server Error` or `503 Service Unavailable`, `count` times (once by default), so a
test drives the bot's retries and fallbacks deterministically. The emulator never fails calls this
way by itself. `session.getServerErrorResponses(botId)` lists the answers still queued. A failed
call runs nothing and changes nothing, and the activity log records it with `ok: false`. A call
takes at most one queued answer, and queued rate limit answers apply first.
[Server error answers](../../features/sessions-and-requests.md#server-error-answers) describes the
answer's exact form and which calls take answers.

The bot below retries failed calls with grammY's auto-retry plugin, which waits 3 seconds before it
retries a server error, so the test waits longer than the default 5 seconds for the retried reply:

```ts
import { assertEquals } from 'jsr:@std/assert@^1';
import { autoRetry } from 'npm:@grammyjs/auto-retry@^2.0.2';
import { withBotFixture } from './bot_fixture.ts';

Deno.test('the bot retries a reply that failed with a server error', async () => {
  await withBotFixture({
    handlers: (bot) => {
      bot.api.config.use(autoRetry({ maxRetryAttempts: 3 }));
      bot.command('start', (ctx) => ctx.reply('Hello!'));
    },
  }, async ({ session, botProfile, account, privateChat, activity }) => {
    await session.queueServerErrorResponses({
      bot_id: botProfile.id,
      method: 'sendMessage',
      error_code: 503,
    });

    const beforeStart = await activity.position();
    await account.sendMessage({ to: privateChat, text: '/start' });
    const reply = {
      method: 'sendMessage',
      chat_id: account.id,
      parameters: { text: 'Hello!' },
    } as const;
    const failed = await activity.waitFor({ ...reply, ok: false }, { after: beforeStart });
    assertEquals(failed.answer, { ok: false, error_code: 503, description: 'Service Unavailable' });
    await activity.waitFor({ ...reply, ok: true }, { after: failed, timeoutMs: 10_000 });

    // The bot used up the queued answer, and the account received one reply.
    assertEquals(await session.getServerErrorResponses(botProfile.id), []);
    const replies = (await account.getMessages({ chat: privateChat })).filter((message) =>
      message.from.id === botProfile.id
    );
    assertEquals(replies.map(({ text }) => text), ['Hello!']);
  });
});
```

## Webhook delivery controls

A bot that receives updates through a webhook gets each failed update again after Telegram's
backoff, and an attempt it never answers fails only after 60 seconds. These emulator controls, which
Telegram does not have, let a test drive the bot through failure, timeout and recovery without that
wait. `session.setWebhookDelivery({ bot_id, scheduling: 'manual' })` stops the emulator from ending
the bot's attempts and retry waits by itself, until the test does:

- `session.releaseWebhookRetry({ botId, attemptId })` sends a failed attempt's update again at once.
- `session.expireWebhookAttempt({ botId, attemptId })` makes an attempt's deadline arrive, failing
  it as `timed_out` with `Read timeout expired`, and returns the attempt once it has failed.

Both also work under `automatic` scheduling, the default, to cut a wait short, and each fails with
an `EmulationClientError` whose `status` is `409` when the retry is no longer waiting or the attempt
no longer in flight. The activity log records a `webhook_attempt_failed` entry for each failure,
with the `webhook_attempt_id` the controls take, and each attempt's `update_delivered` and
`update_confirmed` entries name it too. `session.getWebhookAttempts(botId)` lists every attempt with
its status, failure and retry. [Delivery controls](../../features/webhooks.md#delivery-controls)
describes their exact behavior.

The bot below fails its first update, as one whose database is briefly unavailable would, so its
webhook answers `500`. The test releases the retry at once instead of relying on the timing of
Telegram's retries:

```ts
import { assertEquals } from 'jsr:@std/assert@^1';
import { Bot, webhookCallback } from 'npm:grammy@^1.46.0';
import { TelegramEmulationClient } from '../../../clients/typescript/mod.ts';
import { EMULATOR_URL } from './bot_fixture.ts';

Deno.test('the bot answers a command its webhook failed the first time', async () => {
  const session = await new TelegramEmulationClient(EMULATOR_URL).createSession();
  try {
    const { token, bot: botProfile } = await session.createBot({
      first_name: 'Hook Bot',
      username: 'hook_bot',
    });
    const { account } = await session.createAccount({ first_name: 'Ada' });
    const activity = session.botActivity({ bot_id: botProfile.id });

    const bot = new Bot(token, { client: { apiRoot: session.botApiRoot } });
    let unavailableCount = 1;
    bot.command('start', async (ctx) => {
      if (unavailableCount-- > 0) throw new Error('The database is unavailable');
      await ctx.reply('Welcome!');
    });
    const handleUpdate = webhookCallback(bot, 'std/http');
    // A handler's error makes the webhook answer 500, so the update is sent again. Deno passes no
    // request to a handler that declares no parameter, as grammY's does, hence the arrow function.
    const server = Deno.serve(
      {
        hostname: '127.0.0.1',
        port: 0,
        onListen: () => {},
        onError: () => new Response(null, { status: 500 }),
      },
      (request) => handleUpdate(request),
    );
    try {
      await session.setWebhookDelivery({ bot_id: botProfile.id, scheduling: 'manual' });
      await bot.api.setWebhook(`http://127.0.0.1:${server.addr.port}/`);

      const beforeStart = await activity.position();
      await account.sendMessage({ to: { type: 'private', botId: botProfile.id }, text: '/start' });
      const failed = await activity.waitFor(
        { kind: 'webhook_attempt_failed' },
        { after: beforeStart },
      );
      assertEquals(failed.failure.reason, 'http_error');

      await session.releaseWebhookRetry({
        botId: botProfile.id,
        attemptId: failed.webhook_attempt_id,
      });
      await activity.waitFor(
        { method: 'sendMessage', ok: true, parameters: { text: 'Welcome!' } },
        { after: failed },
      );
      await activity.waitFor(
        { kind: 'update_confirmed', update_id: failed.update_id },
        { after: failed },
      );
      const attempts = await session.getWebhookAttempts(botProfile.id);
      assertEquals(attempts.map(({ status }) => status), ['failed', 'accepted']);
    } finally {
      await server.shutdown();
    }
  } finally {
    await session.end();
  }
});
```

## Time controls

Where Telegram acts when a date arrives or a timeout passes, the emulator waits for the test, which
makes it happen with a control at the point in the scenario it chooses:

| Control                                                                      | Makes arrive                                   | The bot receives | Walkthrough                                                            |
| ---------------------------------------------------------------------------- | ---------------------------------------------- | ---------------- | ---------------------------------------------------------------------- |
| `session.expirePoll(pollId)`                                                 | A poll's `open_period` or `close_date`         | A `poll` update  | [Polls](polls.md)                                                      |
| `session.expireChatMemberRestriction({ chatId, userId })`                    | A temporary restriction's `until_date`         | Nothing          | [Permissions and moderation](permissions-and-moderation.md)            |
| `session.expireChatInviteLink({ chatId, inviteLink })`                       | An invite link's `expire_date`                 | Nothing          | [Invite links](invite-links.md#expiry-dates)                           |
| `session.expireJoinRequesterContact({ chatId, userId })`                     | The end of a join request's contact window     | Nothing          | [Invite links](invite-links.md#prompting-requesters-before-a-decision) |
| `session.expireInlineAnswerCache(inlineQueryId)`                             | The `cache_time` of an inline query's answers  | Nothing          | [Inline mode](inline-mode.md#fresh-answers-after-the-cache)            |
| `account.expireMessageDraft({ chat })`                                       | The 30 seconds after which a draft disappears  | Nothing          | [Messages](messages.md#streaming-drafts)                               |
| `account.expireChatAction({ chat })`, or `({ chat, botId })` in a supergroup | The 5.5 seconds after which a chat action ends | Nothing          | [Messages](messages.md#notifications-and-chat-actions)                 |

Each session control answers the state that results: the closed poll as its bot sees it, the user's
standing (`member`, or `left` for a non-member), the link as the owner sees it, or the still pending
join request with its contact `expired`; inline answer expiry answers nothing. A session control
fails with an `EmulationClientError` whose `status` is `409` when there is nothing to expire, such
as a poll without a closing time or a request with no cached answer. The feature pages describe
each: [closing times](../../features/polls.md#closing-times),
[restriction ends](../../features/supergroups.md#restriction-ends),
[expiry dates](../../features/invite-links.md#expiry-dates),
[contacting requesters](../../features/invite-links.md#contacting-requesters) and
[answer caching](../../features/inline-mode.md#answer-caching).

The account controls answer nothing, and fail with `404` when the chat shows no draft or action. A
supergroup's chat action expires per bot, given its `botId`.

Some timing remains. A webhook attempt's deadline and retry backoff run on their own unless the test
takes them over with [webhook delivery controls](#webhook-delivery-controls). A bot's own long-poll
`timeout` and timers in the bot's code are the bot's.

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
    // `await polling` below reports an error the bot stops with; until then, it is not unhandled.
    polling.catch(() => {});
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
