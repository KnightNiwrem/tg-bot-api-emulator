# Inline mode

[Guide index](README.md) · [Feature reference: Inline mode](../../features/inline-mode.md)

This page shows how an account types inline queries for a bot, reads the bot's answer, sends a
result, and presses buttons on the message it sent, and how a test observes the inline feedback and
edits the bot makes by `inline_message_id`. The examples use the
[shared fixture](sessions-and-fixtures.md) and the [waiting pattern](observing-bot-behavior.md).

## Answering an inline query

A bot receives inline queries only when it is created with `supports_inline_queries: true`, which
the fixture's `bot` option passes to `session.createBot`. `account.sendInlineQuery` types a query
for the bot in a chat the account can write to and returns it with the status `awaiting_answer`; the
bot receives an `inline_query` update. The bot answers asynchronously, so the test waits for its
`answerInlineQuery` call by the query's ID and then reads the answer with `account.getInlineQuery`.
The answer lists each result as the account's client shows it, by type, ID, and title, without the
message it would send. [Supported behavior](../../features/inline-mode.md#supported-behavior) lists
the result types the emulator accepts, and
[answer caching](../../features/inline-mode.md#answer-caching) explains when a repeated query
reaches the bot again.

```ts
import { withBotFixture } from './bot_fixture.ts';
import { assertEquals } from 'jsr:@std/assert@^1';

Deno.test('the bot answers an inline query typed in its private chat', () =>
  withBotFixture({
    bot: { supports_inline_queries: true },
    handlers: (bot) => {
      bot.on('inline_query', (ctx) =>
        ctx.answerInlineQuery([{
          type: 'article',
          id: 'tea',
          title: `Tea for ${ctx.inlineQuery.query}`,
          input_message_content: { message_text: `Tea for ${ctx.inlineQuery.query}` },
        }]));
    },
  }, async ({ account, activity, botProfile, privateChat }) => {
    const beforeQuery = await activity.position();
    const inlineQuery = await account.sendInlineQuery({
      bot_id: botProfile.id,
      chat: privateChat,
      query: 'two',
    });
    assertEquals(inlineQuery.status, 'awaiting_answer');
    await activity.waitFor(
      { method: 'answerInlineQuery', ok: true, parameters: { inline_query_id: inlineQuery.id } },
      { after: beforeQuery },
    );

    const answeredQuery = await account.getInlineQuery(inlineQuery.id);
    assertEquals(answeredQuery.status, 'answered');
    assertEquals(answeredQuery.answer?.results, [
      { type: 'article', id: 'tea', title: 'Tea for two' },
    ]);
  }));
```

## Sending a result in a supergroup

An account also types inline queries in a supergroup it can write to; the inline bot need not be a
member. The bot sees the chat's type in `inline_query.chat_type`. `account.chooseInlineQueryResult`
sends a result of the answer to the chat where the query was typed, as the account's message with
`via_bot`, and returns that message. Bots of the chat receive it as any message of the account.

```ts
import { withBotFixture } from './bot_fixture.ts';
import { assertEquals, assertExists } from 'jsr:@std/assert@^1';

Deno.test('the account sends an inline result to a supergroup', () =>
  withBotFixture({
    bot: { supports_inline_queries: true },
    handlers: (bot) => {
      bot.on('inline_query', (ctx) =>
        ctx.answerInlineQuery([{
          type: 'article',
          id: 'cats',
          title: 'Cats',
          input_message_content: {
            message_text: `${ctx.inlineQuery.query} for this ${ctx.inlineQuery.chat_type} chat`,
          },
        }]));
    },
  }, async ({ account, activity, botProfile }) => {
    const supergroup = await account.createSupergroup({ title: 'Team' });
    const groupChat = { type: 'supergroup', chatId: supergroup.id } as const;

    const beforeQuery = await activity.position();
    const inlineQuery = await account.sendInlineQuery({
      bot_id: botProfile.id,
      chat: groupChat,
      query: 'cats',
    });
    await activity.waitFor(
      { method: 'answerInlineQuery', ok: true, parameters: { inline_query_id: inlineQuery.id } },
      { after: beforeQuery },
    );
    const answeredQuery = await account.getInlineQuery(inlineQuery.id);
    const firstResult = answeredQuery.answer?.results[0];
    assertExists(firstResult);

    const sent = await account.chooseInlineQueryResult({
      inline_query_id: inlineQuery.id,
      result_id: firstResult.id,
    });
    assertEquals(sent.chat.id, supergroup.id);
    assertEquals(sent.via_bot?.id, botProfile.id);

    const stored = (await account.getMessages({ chat: groupChat })).find((message) =>
      message.from.id === account.id && message.message_id === sent.message_id
    );
    assertEquals(stored?.text, 'cats for this supergroup chat');
    assertEquals(stored?.via_bot?.username, botProfile.username);
  }));
```

## Inline feedback and buttons on inline messages

A bot created with `receives_chosen_inline_results: true` receives a `chosen_inline_result` update
for every result an account sends. When the result has an inline keyboard, that update carries the
`inline_message_id` that identifies the sent message to the inline bot. The update has no chat, so
the test finds it in the activity log as an `update_delivered` entry by the account's `user_id`.

The account presses a callback button on the sent message as on any message, by the chat and the
message ID its history shows; [Buttons and menus](buttons-and-menus.md) covers pressing buttons. The
press reaches the inline bot as a callback query with `inline_message_id` and without a message, so
grammY's `ctx.editMessageText` edits the message by that ID. The test waits for the edit by the
`inline_message_id` from the feedback.
[Supported behavior](../../features/inline-mode.md#supported-behavior) describes which bots can edit
an inline message and how.

```ts
import { withBotFixture } from './bot_fixture.ts';
import { assert, assertEquals, assertObjectMatch } from 'jsr:@std/assert@^1';

Deno.test('the inline bot edits the message its result sent when a button is pressed', () =>
  withBotFixture({
    bot: { supports_inline_queries: true, receives_chosen_inline_results: true },
    handlers: (bot) => {
      bot.on('inline_query', (ctx) =>
        ctx.answerInlineQuery([{
          type: 'article',
          id: 'tea',
          title: 'Tea',
          input_message_content: { message_text: 'Tea is ready to brew' },
          reply_markup: { inline_keyboard: [[{ text: 'Brew', callback_data: 'brew' }]] },
        }]));
      bot.callbackQuery('brew', async (ctx) => {
        await ctx.editMessageText('Tea is brewed');
        await ctx.answerCallbackQuery();
      });
    },
  }, async ({ account, activity, botProfile, privateChat }) => {
    const beforeQuery = await activity.position();
    const inlineQuery = await account.sendInlineQuery({
      bot_id: botProfile.id,
      chat: privateChat,
      query: 'tea',
    });
    await activity.waitFor(
      { method: 'answerInlineQuery', ok: true, parameters: { inline_query_id: inlineQuery.id } },
      { after: beforeQuery },
    );

    const beforeChoice = await activity.position();
    const sent = await account.chooseInlineQueryResult({
      inline_query_id: inlineQuery.id,
      result_id: 'tea',
    });
    const feedback = await activity.waitFor(
      {
        kind: 'update_delivered',
        user_id: account.id,
        where: ({ update }) => update.chosen_inline_result !== undefined,
      },
      { after: beforeChoice },
    );
    assertObjectMatch(feedback.update, {
      chosen_inline_result: { result_id: 'tea', query: 'tea' },
    });
    const chosenResult = feedback.update.chosen_inline_result;
    assert(
      typeof chosenResult === 'object' && chosenResult !== null &&
        'inline_message_id' in chosenResult && typeof chosenResult.inline_message_id === 'string',
      'Expected the feedback to carry the inline message ID',
    );
    const inlineMessageId = chosenResult.inline_message_id;

    const beforePress = await activity.position();
    await account.pressCallbackButton({
      chat: privateChat,
      message_id: sent.message_id,
      callback_data: 'brew',
    });
    await activity.waitFor(
      {
        method: 'editMessageText',
        ok: true,
        parameters: { inline_message_id: inlineMessageId, text: 'Tea is brewed' },
      },
      { after: beforePress },
    );

    const edited = (await account.getMessages({ chat: privateChat })).find((message) =>
      message.message_id === sent.message_id
    );
    assertEquals(edited?.text, 'Tea is brewed');
    assertEquals(edited?.via_bot?.id, botProfile.id);
  }));
```

## Sharing the account's location

A bot created with `requests_inline_location: true` asks accounts for their location with inline
queries. `sendInlineQuery` then takes a `location`, which the bot receives in `inline_query` and in
the `chosen_inline_result` of a result sent from the query. The query `getInlineQuery` returns shows
the location as the bot receives it, with its accuracy rounded up to whole meters. A location for a
bot that does not request one is refused with status 409.
[User locations](../../features/inline-mode.md#user-locations) describes the checks.

```ts
import { withBotFixture } from './bot_fixture.ts';
import { assertEquals } from 'jsr:@std/assert@^1';

Deno.test('the bot answers with the location the account shares', () =>
  withBotFixture({
    bot: { supports_inline_queries: true, requests_inline_location: true },
    handlers: (bot) => {
      bot.on('inline_query', (ctx) => {
        const location = ctx.inlineQuery.location;
        const place = location === undefined
          ? 'somewhere'
          : `${location.latitude}, ${location.longitude}`;
        return ctx.answerInlineQuery([{
          type: 'article',
          id: 'nearby',
          title: `Cafés near ${place}`,
          input_message_content: { message_text: `Cafés near ${place}` },
        }]);
      });
    },
  }, async ({ account, activity, botProfile, privateChat }) => {
    const beforeQuery = await activity.position();
    const inlineQuery = await account.sendInlineQuery({
      bot_id: botProfile.id,
      chat: privateChat,
      query: 'cafés',
      location: { latitude: 51.5007, longitude: -0.1246, horizontal_accuracy: 9.5 },
    });
    await activity.waitFor(
      { method: 'answerInlineQuery', ok: true, parameters: { inline_query_id: inlineQuery.id } },
      { after: beforeQuery },
    );

    const answeredQuery = await account.getInlineQuery(inlineQuery.id);
    assertEquals(answeredQuery.location, {
      latitude: 51.5007,
      longitude: -0.1246,
      horizontal_accuracy: 10,
    });
    assertEquals(answeredQuery.answer?.results[0]?.title, 'Cafés near 51.5007, -0.1246');
  }));
```

## Media results named by URL

A photo, document, video, or voice note result can name its file by URL. The emulator downloads such
a file only from the session's emulated web, each time an account sends the result, so a test
registers the file with `session.registerWebResource` before choosing the result; choosing fails
with status 502 when no resource serves it. [Media and files](media-and-files.md) and
[Test controls](test-controls.md) show how to register web resources, and
[Media named by URL](../../features/inline-mode.md#media-named-by-url) describes what each result
type requires.
