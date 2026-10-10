# Observing bot behavior

[Guide index](README.md) · [Feature reference: Bot activity](../../features/bot-activity.md)

A bot under test runs on its own schedule. This page shows how a test waits for exactly the bot
behavior it is about, asserts the order things happened in, and asserts that something did not
happen, all without sleeping. The examples use the [shared fixture](sessions-and-fixtures.md).

## Why tests wait on the activity log

An account's action returns once the bot _can_ receive it, not once the bot has handled it. Right
after `sendMessage` returns, the bot may not have polled yet, may be halfway through its handler, or
may have finished. Reading the chat at that moment shows whichever of these happened to be true.

Sleeping before reading does not fix this. A sleep long enough for a slow machine makes every test
slow, and one short enough to be fast fails whenever the bot is slower than usual. Instead, the
session's bot activity log records the Bot API calls the bot makes, with the parameters it sent and
the answer it received, and every update delivered to it and confirmed by it. Only `getUpdates`
calls are left out, as the updates they deliver and confirm are recorded instead. A test waits for
the entry that shows the bot has done what the test is about, and only then reads the result.

## Positions and waits

Every entry has a position: 1 for the first, one more for each later entry. A test takes the log's
current position _before_ it acts, then waits for a matching entry _after_ that position, so an
entry from earlier in the test can never satisfy the wait:

```ts
import { assertEquals } from 'jsr:@std/assert@1.0.19';
import { withBotFixture } from './bot_fixture.ts';

Deno.test('the bot confirms an order with its total', () =>
  withBotFixture({
    handlers: (bot) =>
      bot.command('order', async (ctx) => {
        await ctx.reply('Checking stock…');
        await ctx.reply(`Order of ${ctx.match} confirmed. Total: 12.50`);
      }),
  }, async ({ botProfile, account, privateChat, activity }) => {
    const beforeOrder = await activity.position();
    await account.sendMessage({ to: privateChat, text: '/order tea' });

    const confirmation = await activity.waitFor(
      {
        method: 'sendMessage',
        chat_id: account.id,
        ok: true,
        parameters: { text: 'Order of tea confirmed. Total: 12.50' },
      },
      { after: beforeOrder },
    );
    assertEquals(confirmation.answer.ok, true);

    const botMessages = (await account.getMessages({ chat: privateChat }))
      .filter(({ from }) => from.id === botProfile.id)
      .map(({ text }) => text);
    assertEquals(botMessages, ['Checking stock…', 'Order of tea confirmed. Total: 12.50']);
  }));
```

`waitFor` resolves with the entry it found. A call's entry holds the `parameters` the bot sent, the
files it uploaded and the `answer` it received; an update's entry holds the update. Because the bot
awaited its first reply before sending the second, the entry for the second shows that both are in
the chat by the time the test reads it.

The `activity` view of the fixture is already filtered to the fixture's bot; `session.botActivity()`
without a filter sees every bot of the session.

## Correlating a wait with the right call

A wait that matches only on the method accepts the first call of that method, which may belong to
another step of the scenario: the "Checking stock…" message above would satisfy
`{ method: 'sendMessage' }`. Give criteria that only the call the test is about meets:

| The bot's call is identified by           | Criteria                                                                               |
| ----------------------------------------- | -------------------------------------------------------------------------------------- |
| Its exact text                            | `parameters: { text: 'Order of tea confirmed. Total: 12.50' }`                         |
| The message it replies to                 | `parameters: { reply_parameters: JSON.stringify({ message_id: trigger.message_id }) }` |
| The query it answers                      | `parameters: { callback_query_id: query.id }` or `{ inline_query_id: query.id }`       |
| The chat it went to                       | `chat_id: account.id`, or a supergroup's ID                                            |
| Its success                               | `ok: true` for calls that succeeded, `ok: false` for calls Telegram refused            |
| Anything else in the entry, on the client | `where: (entry) => ...`, checked after the criteria above                              |

Parameters are recorded as text, as the Bot API reads them, so structured parameters such as
`reply_parameters` and `reply_markup` are JSON text, compared exactly. Exact matching on
`reply_parameters` works when the bot sends nothing but the replied message's ID, as grammY does for
`{ message_id: ctx.msg.message_id }`. For anything less exact, use `where`, which receives the
entries the other criteria let through:

```ts
import { assertEquals } from 'jsr:@std/assert@1.0.19';
import { withBotFixture } from './bot_fixture.ts';

Deno.test('the bot offers a choice of sizes', () =>
  withBotFixture({
    handlers: (bot) =>
      bot.command('size', (ctx) =>
        ctx.reply('Which size?', {
          reply_markup: {
            inline_keyboard: [[
              { text: 'Small', callback_data: 'size:s' },
              { text: 'Large', callback_data: 'size:l' },
            ]],
          },
        })),
  }, async ({ botProfile, account, privateChat, activity }) => {
    const beforeCommand = await activity.position();
    await account.sendMessage({ to: privateChat, text: '/size' });

    await activity.waitFor(
      {
        method: 'sendMessage',
        chat_id: account.id,
        ok: true,
        where: (entry) => entry.parameters.reply_markup?.includes('"size:l"') ?? false,
      },
      { after: beforeCommand },
    );

    const question = (await account.getMessages({ chat: privateChat }))
      .findLast(({ from, text }) => from.id === botProfile.id && text === 'Which size?');
    assertEquals(
      question?.reply_markup?.inline_keyboard[0].map(({ text }) => text),
      ['Small', 'Large'],
    );
  }));
```

A `where` predicate on criteria that name a `method` receives a call's entry, so its `parameters`
type-check without casts.

## Selecting the resulting message

After the wait, select the result by what identifies it in the scenario: its sender, the message it
replies to, its text or its kind of content. The latest message of a chat is the wrong choice in
general. A bot that sends several messages, another participant writing at the same time, or the
account's own message still being the latest all make "latest" pick something else. The examples
above select by sender and text; [Getting started](getting-started.md) selects by sender and replied
message.

## Waiting for updates

Updates have entries too: `update_delivered` when the bot receives one, `update_confirmed` when it
acknowledges it. They show that the bot has received something that leaves no call, such as an edit
it ignores. `where` on `kind: 'update_delivered'` receives a delivery entry, whose `update` is the
update as the bot received it:

```ts
import { assertObjectMatch } from 'jsr:@std/assert@1.0.19';
import { withBotFixture } from './bot_fixture.ts';

Deno.test('the bot receives the edit of a message', () =>
  withBotFixture({
    handlers: () => {},
  }, async ({ account, privateChat, activity }) => {
    const message = await account.sendMessage({ to: privateChat, text: 'Meet at 5' });

    const beforeEdit = await activity.position();
    await account.editMessage({
      chat: privateChat,
      message_id: message.message_id,
      text: 'Meet at 6',
    });

    const delivered = await activity.waitFor(
      {
        kind: 'update_delivered',
        chat_id: account.id,
        where: (entry) => 'edited_message' in entry.update,
      },
      { after: beforeEdit },
    );
    assertObjectMatch(delivered.update, { edited_message: { text: 'Meet at 6' } });
    await activity.waitFor(
      { kind: 'update_confirmed', update_id: delivered.update.update_id },
      { after: delivered },
    );
  }));
```

The confirmation follows the delivery: the bot acknowledges an update once it asks for the next
ones. The [feature reference](../../features/bot-activity.md#entries) lists what each kind of entry
contains and what the log does not record.

## Asserting order

The log's order agrees with every order the bot enforces: when the bot awaits one call before making
the next, their entries come in that order. A cursor waits for a sequence of entries, each after the
previous one, and so asserts that order:

```ts
import { withBotFixture } from './bot_fixture.ts';

Deno.test('the bot shows typing before it answers, and answers in order', () =>
  withBotFixture({
    handlers: (bot) =>
      bot.command('report', async (ctx) => {
        await ctx.replyWithChatAction('typing');
        await ctx.reply('Report: 3 open tickets');
        await ctx.reply('Anything else?');
      }),
  }, async ({ account, privateChat, activity }) => {
    const beforeCommand = await activity.position();
    await account.sendMessage({ to: privateChat, text: '/report' });

    const steps = activity.cursor({ after: beforeCommand });
    await steps.next({ method: 'sendChatAction', chat_id: account.id, ok: true });
    await steps.next({
      method: 'sendMessage',
      chat_id: account.id,
      parameters: { text: 'Report: 3 open tickets' },
    });
    await steps.next({
      method: 'sendMessage',
      chat_id: account.id,
      parameters: { text: 'Anything else?' },
    });
  }));
```

Calls a bot makes concurrently, such as those inside a `Promise.all`, may reach the emulator in
either order. A test asserts only the orders its bot guarantees: wait for each concurrent call after
the same earlier entry, and for the next step after the latest of them, as the
[feature reference](../../features/bot-activity.md#typescript-client) shows with `latest`.

## Asserting that something did not happen

A wait cannot prove that a call will never come; it can only time out. Instead, wait for a later
entry that the bot guarantees comes after the work in question, a _fence_, and then check the range
before it with `assertNone`, which reads only what is already recorded.

grammY's built-in polling, which the fixture uses, handles one update at a time, so the reply to a
later message fences everything the handler of an earlier message did:

```ts
import { withBotFixture } from './bot_fixture.ts';

Deno.test('the bot ignores chatter and answers commands', () =>
  withBotFixture({
    handlers: (bot) => bot.command('ping', (ctx) => ctx.reply('pong')),
  }, async ({ account, privateChat, activity }) => {
    const beforeChatter = await activity.position();
    await account.sendMessage({ to: privateChat, text: 'just saying hello' });
    await account.sendMessage({ to: privateChat, text: '/ping' });

    const pong = await activity.waitFor(
      { method: 'sendMessage', chat_id: account.id, ok: true, parameters: { text: 'pong' } },
      { after: beforeChatter },
    );
    await activity.assertNone(
      { method: 'sendMessage', chat_id: account.id },
      { after: beforeChatter, before: pong },
    );
  }));
```

`assertNone` fails with an `UnexpectedBotActivityError` that lists the entries it found. Which
entries are fences depends on how the bot schedules its work; the
[feature reference](../../features/bot-activity.md#asserting-that-something-did-not-happen) explains
how to choose one for concurrent runners and webhooks. Work a handler starts without awaiting it
falls outside every fence.

## Timeouts and cancellation

A wait fails with a `BotActivityTimeoutError` when no matching entry is recorded in time: 5 seconds
by default. `session.botActivity(filter, { timeoutMs })` changes the default for a view, and
`timeoutMs` on a single `waitFor` or `next` changes it for that wait. Both also take a `signal` that
cancels the wait. The error names the filter and the position the wait started after, which usually
shows at once whether the bot never acted or acted differently than the criteria expect. The
[feature reference](../../features/bot-activity.md#typescript-client) states exactly how the
deadline is measured.
