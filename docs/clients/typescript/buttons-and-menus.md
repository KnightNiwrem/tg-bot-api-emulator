# Buttons and menus

[Guide index](README.md) ·
[Feature reference: Keyboards and callbacks](../../features/keyboards-and-callbacks.md) ·
[Feature reference: Command menus](../../features/command-menus.md)

This page shows how an account presses inline and reply keyboard buttons, reads the bot's callback
answers, and inspects the command menu and menu button the bot sets. The examples use the
[shared fixture](sessions-and-fixtures.md) and the [waiting pattern](observing-bot-behavior.md).

## Pressing a button by its label

`account.pressButton` presses a callback button on a message as the account's history shows it now,
and returns the `CallbackQuery` it creates. The bot receives a `callback_query` update; its answer
arrives asynchronously, so the test waits for the bot's `answerCallbackQuery` call with the query's
`callback_query_id` before reading the answer with `account.getCallbackQuery`. Until then the
query's `status` is `awaiting_answer` and its `answer` is `null`.

A label selector matches a button's whole label, or a `RegExp` the label matches. When a label
repeats, `within` narrows the selection to the innermost keyboard row, table row, list item or block
whose text mentions the given text or pattern. The emulator's
[inline keyboard semantics](../../features/keyboards-and-callbacks.md#inline-keyboards) describe
what a press sends and what an answer may hold.

```ts
import { assertEquals, assertExists } from 'jsr:@std/assert@^1';
import { withBotFixture } from './bot_fixture.ts';

Deno.test('an account presses a Details button by its label and reads the answer', async () => {
  await withBotFixture({
    handlers: (bot) => {
      bot.command('shop', (ctx) =>
        ctx.reply('Shop', {
          reply_parameters: { message_id: ctx.msg.message_id },
          reply_markup: {
            inline_keyboard: [
              [
                { text: 'Potion', callback_data: 'buy:potion' },
                { text: 'Details', callback_data: 'details:potion' },
              ],
              [
                { text: 'Elixir', callback_data: 'buy:elixir' },
                { text: 'Details', callback_data: 'details:elixir' },
              ],
            ],
          },
        }));
      bot.callbackQuery(
        /^details:(.+)$/,
        (ctx) => ctx.answerCallbackQuery({ text: `The ${ctx.match[1]} restores 50 HP` }),
      );
    },
  }, async ({ account, activity, botProfile, privateChat }) => {
    const beforeCommand = await activity.position();
    const command = await account.sendMessage({ to: privateChat, text: '/shop' });
    await activity.waitFor({
      method: 'sendMessage',
      chat_id: account.id,
      ok: true,
      parameters: { reply_parameters: JSON.stringify({ message_id: command.message_id }) },
    }, { after: beforeCommand });
    const shop = (await account.getMessages({ chat: privateChat })).find((message) =>
      message.from.id === botProfile.id &&
      message.reply_to_message?.message_id === command.message_id
    );
    assertExists(shop);

    // Two buttons are labelled Details; `within` picks the one in the row that mentions Potion.
    const beforePress = await activity.position();
    const query = await account.pressButton({
      chat: privateChat,
      message_id: shop.message_id,
      button: { label: 'Details', within: 'Potion' },
    });
    assertEquals(query.callback_data, 'details:potion');
    await activity.waitFor({
      method: 'answerCallbackQuery',
      ok: true,
      parameters: { callback_query_id: query.id },
    }, { after: beforePress });

    const answered = await account.getCallbackQuery(query.id);
    assertEquals(answered.status, 'answered');
    assertEquals(answered.answer?.text, 'The potion restores 50 HP');
    assertEquals(answered.answer?.show_alert, false);
  });
});
```

`pressButton` and `pressCallbackButton` also take `expired: true`, which creates a query the bot
receives but can no longer answer, as the emulator's
[explicit callback expiry](../../features/keyboards-and-callbacks.md#intentional-deviations)
describes.

## Inspecting buttons and selector failures

The selection logic is exported for use without pressing anything. `listButtons(message)` returns
every button a message shows, in the order the client shows them, each with its `label`, the
`button` itself, its `path` in the message, and the `containers` that enclose it, outermost first.
`findButton(message, selector)` returns the one button a selector matches. A selector can also be a
predicate over those buttons.

A selector that matches no button or several throws a `ButtonSelectionError`, whose message lists
the candidates with their paths and whose `matches` holds the buttons it matched. `pressButton`
throws the same error before the bot receives anything, and also when the one matched button is not
a callback button.

```ts
import { assertEquals, assertExists, assertRejects, assertThrows } from 'jsr:@std/assert@^1';
import { ButtonSelectionError, findButton, listButtons } from '../../../clients/typescript/mod.ts';
import { withBotFixture } from './bot_fixture.ts';

Deno.test('selectors pick exactly one button or list the candidates', async () => {
  await withBotFixture({
    handlers: (bot) => {
      bot.command('shop', (ctx) =>
        ctx.reply('Shop', {
          reply_parameters: { message_id: ctx.msg.message_id },
          reply_markup: {
            inline_keyboard: [
              [
                { text: 'Potion', callback_data: 'buy:potion' },
                { text: 'Details', callback_data: 'details:potion' },
              ],
              [
                { text: 'Elixir', callback_data: 'buy:elixir' },
                { text: 'Details', callback_data: 'details:elixir' },
              ],
              [{ text: 'Help', url: 'https://example.com/help' }],
            ],
          },
        }));
    },
  }, async ({ account, activity, botProfile, privateChat }) => {
    const beforeCommand = await activity.position();
    const command = await account.sendMessage({ to: privateChat, text: '/shop' });
    await activity.waitFor({
      method: 'sendMessage',
      chat_id: account.id,
      ok: true,
      parameters: { reply_parameters: JSON.stringify({ message_id: command.message_id }) },
    }, { after: beforeCommand });
    const shop = (await account.getMessages({ chat: privateChat })).find((message) =>
      message.from.id === botProfile.id &&
      message.reply_to_message?.message_id === command.message_id
    );
    assertExists(shop);

    assertEquals(listButtons(shop).map(({ label, path }) => `${label} at ${path}`), [
      'Potion at reply_markup.inline_keyboard[0][0]',
      'Details at reply_markup.inline_keyboard[0][1]',
      'Elixir at reply_markup.inline_keyboard[1][0]',
      'Details at reply_markup.inline_keyboard[1][1]',
      'Help at reply_markup.inline_keyboard[2][0]',
    ]);

    // A predicate selects by anything a button shows, here the row that holds it.
    const elixirDetails = findButton(
      shop,
      ({ label, containers }) =>
        label === 'Details' && containers.some(({ text }) => text.startsWith('Elixir')),
    );
    assertEquals(elixirDetails.path, 'reply_markup.inline_keyboard[1][1]');

    const ambiguous = assertThrows(
      () => findButton(shop, { label: 'Details' }),
      ButtonSelectionError,
    );
    assertEquals(ambiguous.matches.map(({ path }) => path), [
      'reply_markup.inline_keyboard[0][1]',
      'reply_markup.inline_keyboard[1][1]',
    ]);

    // A URL button matches, but pressing it would send the bot nothing.
    const notCallback = await assertRejects(
      () =>
        account.pressButton({
          chat: privateChat,
          message_id: shop.message_id,
          button: { label: 'Help' },
        }),
      ButtonSelectionError,
    );
    assertEquals(notCallback.matches.length, 1);
  });
});
```

## Pressing a button by its callback data

`account.pressCallbackButton` presses the button whose `callback_data` is exactly the given text,
which suits tests that assert the bot's data contract rather than its labels. A bot often answers a
press by editing the message. The test below waits for the edit, correlated by the message's ID,
then for the answer, and reads the edited message from history by its ID.

```ts
import { assertEquals, assertExists } from 'jsr:@std/assert@^1';
import { withBotFixture } from './bot_fixture.ts';

Deno.test('the bot edits its message when an account presses a button', async () => {
  await withBotFixture({
    handlers: (bot) => {
      bot.command('shop', (ctx) =>
        ctx.reply('Shop', {
          reply_parameters: { message_id: ctx.msg.message_id },
          reply_markup: {
            inline_keyboard: [[
              { text: 'Potion', callback_data: 'buy:potion' },
              { text: 'Elixir', callback_data: 'buy:elixir' },
            ]],
          },
        }));
      bot.callbackQuery(/^buy:(.+)$/, async (ctx) => {
        // An empty inline keyboard removes the buttons.
        await ctx.editMessageText(`Bought ${ctx.match[1]}`, {
          reply_markup: { inline_keyboard: [] },
        });
        await ctx.answerCallbackQuery();
      });
    },
  }, async ({ account, activity, botProfile, privateChat }) => {
    const beforeCommand = await activity.position();
    const command = await account.sendMessage({ to: privateChat, text: '/shop' });
    await activity.waitFor({
      method: 'sendMessage',
      chat_id: account.id,
      ok: true,
      parameters: { reply_parameters: JSON.stringify({ message_id: command.message_id }) },
    }, { after: beforeCommand });
    const shop = (await account.getMessages({ chat: privateChat })).find((message) =>
      message.from.id === botProfile.id &&
      message.reply_to_message?.message_id === command.message_id
    );
    assertExists(shop);

    const beforePress = await activity.position();
    const query = await account.pressCallbackButton({
      chat: privateChat,
      message_id: shop.message_id,
      callback_data: 'buy:elixir',
    });
    const edit = await activity.waitFor({
      method: 'editMessageText',
      chat_id: account.id,
      ok: true,
      parameters: { message_id: String(shop.message_id) },
    }, { after: beforePress });
    await activity.waitFor({
      method: 'answerCallbackQuery',
      ok: true,
      parameters: { callback_query_id: query.id },
    }, { after: edit });

    const edited = (await account.getMessages({ chat: privateChat })).find(({ message_id }) =>
      message_id === shop.message_id
    );
    assertEquals(edited?.text, 'Bought elixir');
    assertEquals(edited?.reply_markup, undefined);
    assertEquals((await account.getCallbackQuery(query.id)).status, 'answered');
  });
});
```

Both press operations also work in supergroups, with a `{ type: 'supergroup', chatId }` target, and
on buttons inside [rich messages](rich-messages.md).

## Reply keyboards

`account.getReplyInterface` returns what the account's client shows in place of its usual input: a
`keyboard` with its rows of buttons and flags, a `force_reply`, or `null`. Each names the
`message_id` of the bot message that set it. `account.pressReplyKeyboardButton` presses a button of
the shown keyboard by its text, which sends that text as the account's message and returns it. The
feature page describes how
[interfaces replace and clear each other](../../features/keyboards-and-callbacks.md#reply-keyboards-and-forced-replies),
including [in supergroups](../../features/keyboards-and-callbacks.md#in-supergroups).

```ts
import { assert, assertEquals, assertExists } from 'jsr:@std/assert@^1';
import { withBotFixture } from './bot_fixture.ts';

Deno.test('an account answers a reply keyboard by pressing one of its buttons', async () => {
  await withBotFixture({
    handlers: (bot) => {
      bot.command('size', (ctx) =>
        ctx.reply('Which size?', {
          reply_parameters: { message_id: ctx.msg.message_id },
          reply_markup: {
            keyboard: [[{ text: 'Small' }, { text: 'Large' }]],
            one_time_keyboard: true,
            input_field_placeholder: 'Pick a size',
          },
        }));
      bot.hears(['Small', 'Large'], (ctx) =>
        ctx.reply(`${ctx.msg.text} it is`, {
          reply_parameters: { message_id: ctx.msg.message_id },
          reply_markup: { remove_keyboard: true },
        }));
    },
  }, async ({ account, activity, botProfile, privateChat }) => {
    assertEquals(await account.getReplyInterface({ chat: privateChat }), null);

    const beforeCommand = await activity.position();
    const command = await account.sendMessage({ to: privateChat, text: '/size' });
    await activity.waitFor({
      method: 'sendMessage',
      chat_id: account.id,
      ok: true,
      parameters: { reply_parameters: JSON.stringify({ message_id: command.message_id }) },
    }, { after: beforeCommand });

    const shown = await account.getReplyInterface({ chat: privateChat });
    assert(shown?.type === 'keyboard');
    assertEquals(shown.keyboard.map((row) => row.map(({ text }) => text)), [['Small', 'Large']]);
    assertEquals(shown.one_time_keyboard, true);
    assertEquals(shown.input_field_placeholder, 'Pick a size');
    const question = (await account.getMessages({ chat: privateChat })).find(({ message_id }) =>
      message_id === shown.message_id
    );
    assertEquals(question?.reply_to_message?.message_id, command.message_id);

    const beforePress = await activity.position();
    const press = await account.pressReplyKeyboardButton({ chat: privateChat, text: 'Large' });
    assertEquals(press.text, 'Large');
    await activity.waitFor({
      method: 'sendMessage',
      chat_id: account.id,
      ok: true,
      parameters: { reply_parameters: JSON.stringify({ message_id: press.message_id }) },
    }, { after: beforePress });

    const confirmation = (await account.getMessages({ chat: privateChat })).find((message) =>
      message.from.id === botProfile.id &&
      message.reply_to_message?.message_id === press.message_id
    );
    assertExists(confirmation);
    assertEquals(confirmation.text, 'Large it is');
    // The bot's remove_keyboard restores the account's usual input.
    assertEquals(await account.getReplyInterface({ chat: privateChat }), null);
  });
});
```

A forced reply asks the account's client to reply to the bot's message. The account answers it with
`sendMessage` and `reply_to_message_id`. The forced reply stays shown afterwards, because the
emulator does not reproduce the client's own
[dismissal](../../features/keyboards-and-callbacks.md#intentional-deviations).

```ts
import { assert, assertEquals, assertExists } from 'jsr:@std/assert@^1';
import { withBotFixture } from './bot_fixture.ts';

Deno.test('an account answers a forced reply', async () => {
  await withBotFixture({
    handlers: (bot) => {
      bot.command('rename', (ctx) =>
        ctx.reply('What should I call you?', {
          reply_parameters: { message_id: ctx.msg.message_id },
          reply_markup: { force_reply: true, input_field_placeholder: 'Your name' },
        }));
      bot.on('message:text', (ctx) => {
        if (ctx.msg.reply_to_message?.text !== 'What should I call you?') return;
        return ctx.reply(`Hello, ${ctx.msg.text}`, {
          reply_parameters: { message_id: ctx.msg.message_id },
        });
      });
    },
  }, async ({ account, activity, botProfile, privateChat }) => {
    const beforeCommand = await activity.position();
    const command = await account.sendMessage({ to: privateChat, text: '/rename' });
    await activity.waitFor({
      method: 'sendMessage',
      chat_id: account.id,
      ok: true,
      parameters: { reply_parameters: JSON.stringify({ message_id: command.message_id }) },
    }, { after: beforeCommand });

    const shown = await account.getReplyInterface({ chat: privateChat });
    assert(shown?.type === 'force_reply');
    assertEquals(shown.input_field_placeholder, 'Your name');

    const beforeAnswer = await activity.position();
    const answer = await account.sendMessage({
      to: privateChat,
      text: 'Grace',
      reply_to_message_id: shown.message_id,
    });
    await activity.waitFor({
      method: 'sendMessage',
      chat_id: account.id,
      ok: true,
      parameters: { reply_parameters: JSON.stringify({ message_id: answer.message_id }) },
    }, { after: beforeAnswer });
    const greeting = (await account.getMessages({ chat: privateChat })).find((message) =>
      message.from.id === botProfile.id &&
      message.reply_to_message?.message_id === answer.message_id
    );
    assertExists(greeting);
    assertEquals(greeting.text, 'Hello, Grace');
  });
});
```

Keyboard buttons with `request_contact` or `request_location` are pressed the same way by their
text, but share the account's own contact, or the `location` passed to `pressReplyKeyboardButton`,
in reply to the keyboard's message instead of sending the text.
[Contacts and locations](contacts-and-locations.md) shows both. A `request_poll` button takes the
`poll` the account creates, of the type the button requests, and sends it as the account's poll, as
[Polls](polls.md#answering-a-poll-request) shows. A `web_app` button takes the `web_app_data` its
Web App sends, as [Sending Web App data](#sending-web-app-data) shows.

### Sharing users and chats

A `request_users` button takes the `shared_user_ids` of the session's accounts and bots the account
chooses, and a `request_chat` button takes the `shared_chat_id` of a supergroup the account is a
member of. The press returns the account's service message, which carries `users_shared` or
`chat_shared` with the button's `request_id` and only the details the request asked for; the bot
receives the same message. A choice the request's criteria refuse fails with an
`EmulationClientError` and sends nothing. The emulator never adds or promotes the bot for a
`request_chat` with `bot_is_member` or `bot_administrator_rights`, so the test does that first. The
feature page lists the
[criteria and their limits](../../features/keyboards-and-callbacks.md#sharing-users-and-chats).

```ts
import { assertEquals } from 'jsr:@std/assert@^1';
import { withBotFixture } from './bot_fixture.ts';

Deno.test('an account shares a teammate with the bot that asked for one', async () => {
  await withBotFixture({
    handlers: (bot) => {
      bot.command('invite', (ctx) =>
        ctx.reply('Whom should I invite?', {
          reply_markup: {
            keyboard: [[{
              text: 'Choose a teammate',
              request_users: { request_id: 1, user_is_bot: false, request_name: true },
            }]],
          },
        }));
      bot.on('message:users_shared', (ctx) => {
        const [teammate] = ctx.msg.users_shared.users;
        return ctx.reply(`Inviting ${teammate?.first_name}`);
      });
    },
  }, async ({ session, account, activity, privateChat }) => {
    const { account: grace } = await session.createAccount({ first_name: 'Grace' });

    const beforeCommand = await activity.position();
    await account.sendMessage({ to: privateChat, text: '/invite' });
    await activity.waitFor({
      method: 'sendMessage',
      chat_id: account.id,
      parameters: { text: 'Whom should I invite?' },
    }, { after: beforeCommand });

    const beforeShare = await activity.position();
    const shared = await account.pressReplyKeyboardButton({
      chat: privateChat,
      text: 'Choose a teammate',
      shared_user_ids: [grace.id],
    });
    assertEquals(shared.users_shared?.users, [{ user_id: grace.id, first_name: 'Grace' }]);
    assertEquals(shared.users_shared?.request_id, 1);
    await activity.waitFor({
      method: 'sendMessage',
      chat_id: account.id,
      parameters: { text: 'Inviting Grace' },
    }, { after: beforeShare });
  });
});
```

### Sending Web App data

A `web_app` button takes `web_app_data`, the string its Web App would pass to
`Telegram.WebApp.sendData`. The emulator does not load the Web App: the press opens it and sends the
data at once, so the button must still be shown. The press returns the account's service message,
whose `web_app_data` carries the button's text and the data exactly as given; the bot receives the
same message, which grammY's `message:web_app_data` filter matches. Empty data, and data longer than
4096 bytes in UTF-8, fail with an `EmulationClientError` and send nothing. The feature page
describes
[what the emulator models](../../features/keyboards-and-callbacks.md#sending-web-app-data).

```ts
import { assertEquals } from 'jsr:@std/assert@^1';
import { Keyboard } from 'npm:grammy@^1.46.0';
import { withBotFixture } from './bot_fixture.ts';

Deno.test('an account books the dates its Web App chose', async () => {
  await withBotFixture({
    handlers: (bot) => {
      bot.command('book', (ctx) =>
        ctx.reply('When do you arrive?', {
          reply_markup: new Keyboard().webApp('Choose dates', 'https://hotel.example/dates'),
        }));
      bot.on('message:web_app_data', (ctx) => {
        const { from, nights } = JSON.parse(ctx.msg.web_app_data.data);
        return ctx.reply(`Booked ${nights} nights from ${from}`, {
          reply_markup: { remove_keyboard: true },
        });
      });
    },
  }, async ({ account, activity, privateChat }) => {
    const beforeCommand = await activity.position();
    await account.sendMessage({ to: privateChat, text: '/book' });
    await activity.waitFor({
      method: 'sendMessage',
      chat_id: account.id,
      parameters: { text: 'When do you arrive?' },
    }, { after: beforeCommand });

    const beforeSubmission = await activity.position();
    const submitted = await account.pressReplyKeyboardButton({
      chat: privateChat,
      text: 'Choose dates',
      web_app_data: JSON.stringify({ from: '2026-12-24', nights: 3 }),
    });
    assertEquals(submitted.web_app_data?.button_text, 'Choose dates');
    await activity.waitFor({
      method: 'sendMessage',
      chat_id: account.id,
      parameters: { text: 'Booked 3 nights from 2026-12-24' },
    }, { after: beforeSubmission });

    const history = await account.getMessages({ chat: privateChat });
    assertEquals(history.at(-2)?.web_app_data, submitted.web_app_data);
  });
});
```

## Command menus and the menu button

`account.getBotCommands` returns the commands the account's client suggests in its private chat with
the bot, after the emulator resolves the bot's scopes and languages. `account.getMenuButton` returns
the button shown next to the message field: `commands`, `web_app`, or `default` when the bot chose
none. Both read what the bot has stored, so the test waits for the bot's `setMyCommands` and
`setChatMenuButton` calls before reading. The feature page describes
[scope resolution](../../features/command-menus.md#supported-behavior) and the
[menu button fallback](../../features/command-menus.md#menu-buttons).

```ts
import { assertEquals } from 'jsr:@std/assert@^1';
import { withBotFixture } from './bot_fixture.ts';

Deno.test('an account sees the command menu and menu button the bot sets', async () => {
  await withBotFixture({
    handlers: (bot) => {
      bot.command('start', async (ctx) => {
        await ctx.api.setMyCommands([
          { command: 'shop', description: 'Browse the shop' },
          { command: 'help', description: 'Show help' },
        ], { scope: { type: 'all_private_chats' } });
        await ctx.api.setChatMenuButton({
          chat_id: ctx.chat.id,
          menu_button: { type: 'commands' },
        });
      });
    },
  }, async ({ account, activity, privateChat }) => {
    assertEquals(await account.getBotCommands({ chat: privateChat }), []);
    assertEquals(await account.getMenuButton({ chat: privateChat }), { type: 'default' });

    const beforeStart = await activity.position();
    await account.sendMessage({ to: privateChat, text: '/start' });
    const commandsSet = await activity.waitFor({
      method: 'setMyCommands',
      ok: true,
      parameters: { scope: JSON.stringify({ type: 'all_private_chats' }) },
    }, { after: beforeStart });
    await activity.waitFor(
      { method: 'setChatMenuButton', chat_id: account.id, ok: true },
      { after: commandsSet },
    );

    assertEquals(await account.getBotCommands({ chat: privateChat }), [
      { command: 'shop', description: 'Browse the shop', is_ephemeral: false },
      { command: 'help', description: 'Show help', is_ephemeral: false },
    ]);
    assertEquals(await account.getMenuButton({ chat: privateChat }), { type: 'commands' });
  });
});
```

In a supergroup, `account.getSupergroupBotCommands` returns one list for each bot member that has
commands for the account, with the bot's `bot_id`. The bot below sets commands for a supergroup when
it is added to it; [Supergroups](supergroups.md) covers creating supergroups and adding bots.

```ts
import { assertEquals } from 'jsr:@std/assert@^1';
import { withBotFixture } from './bot_fixture.ts';

Deno.test('a supergroup member sees the commands a bot sets for the supergroup', async () => {
  await withBotFixture({
    handlers: (bot) => {
      bot.on('my_chat_member', async (ctx) => {
        if (ctx.myChatMember.new_chat_member.status !== 'member') return;
        await ctx.api.setMyCommands([{ command: 'standup', description: 'Start the standup' }], {
          scope: { type: 'chat', chat_id: ctx.chat.id },
        });
      });
    },
  }, async ({ account, activity, botProfile }) => {
    const supergroup = await account.createSupergroup({ title: 'Team' });
    const teamChat = { type: 'supergroup', chatId: supergroup.id } as const;

    const beforeAdding = await activity.position();
    await account.addChatMember({ chat: teamChat, userId: botProfile.id });
    await activity.waitFor({
      method: 'setMyCommands',
      ok: true,
      parameters: { scope: JSON.stringify({ type: 'chat', chat_id: supergroup.id }) },
    }, { after: beforeAdding });

    assertEquals(await account.getSupergroupBotCommands({ chat: teamChat }), [{
      bot_id: botProfile.id,
      commands: [{ command: 'standup', description: 'Start the standup', is_ephemeral: false }],
    }]);
  });
});
```
