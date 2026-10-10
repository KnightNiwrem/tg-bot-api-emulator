# Rich messages

[Guide index](README.md) · [Feature reference: Rich messages](../../features/rich-messages.md)

This page shows how an account reads the rich messages a bot sends with `sendRichMessage` and
presses the buttons inside them. The examples use the [shared fixture](sessions-and-fixtures.md) and
the [waiting pattern](observing-bot-behavior.md).

## Reading a rich message

A bot's rich message appears in the account's history with its blocks in `rich_message` and no
`text`. The blocks are shown as the emulator normalizes them, with list labels, table cell alignment
and detected entities filled in, as the feature page's
[sending and editing](../../features/rich-messages.md#sending-and-editing) section describes.

Most assertions are about content rather than layout. `richMessageToPlainText` returns everything
the message shows as plain text: each block starts a line, list items start with their label, the
cells of a table row and the buttons of a row are separated by `|`, and the content of `details`
blocks and expandable blockquotes is included whether or not they are open. `richTextToPlainText`
does the same for one piece of rich text, such as a heading's `text`. grammY sends rich messages
with `ctx.replyWithRichMessage` or `bot.api.sendRichMessage`.

Photo, document, video and voice note blocks show their files as `photo`, `document`, `video` and
`voice_note`, typed as the client's `PhotoSize`, `Document`, `Video` and `Voice`; a block's video
has no `start_timestamp`. `richMessageToPlainText` shows only their captions.

```ts
import { assert, assertEquals, assertExists } from 'jsr:@std/assert@1.0.19';
import { richMessageToPlainText, richTextToPlainText } from '../../../clients/typescript/mod.ts';
import { withBotFixture } from './bot_fixture.ts';

Deno.test('an account reads the rich message a bot sends', async () => {
  await withBotFixture({
    handlers: (bot) => {
      bot.command('recipe', (ctx) =>
        ctx.replyWithRichMessage({
          blocks: [
            { type: 'heading', size: 1, text: ['Healing ', { type: 'bold', text: 'potion' }] },
            {
              type: 'list',
              items: [
                { blocks: [{ type: 'paragraph', text: 'Moonleaf' }] },
                { blocks: [{ type: 'paragraph', text: 'Spring water' }] },
              ],
            },
            {
              type: 'details',
              summary: 'Method',
              blocks: [{ type: 'paragraph', text: 'Simmer for an hour.' }],
            },
          ],
        }, { reply_parameters: { message_id: ctx.msg.message_id } }));
    },
  }, async ({ account, activity, botProfile, privateChat }) => {
    const beforeCommand = await activity.position();
    const command = await account.sendMessage({ to: privateChat, text: '/recipe' });
    await activity.waitFor({
      method: 'sendRichMessage',
      chat_id: account.id,
      ok: true,
      parameters: { reply_parameters: JSON.stringify({ message_id: command.message_id }) },
    }, { after: beforeCommand });

    const recipe = (await account.getMessages({ chat: privateChat })).find((message) =>
      message.from.id === botProfile.id &&
      message.reply_to_message?.message_id === command.message_id
    );
    assertExists(recipe?.rich_message);
    assertEquals(recipe.text, undefined);

    // Everything the message shows, one block per line, with the closed details included.
    assertEquals(
      richMessageToPlainText(recipe.rich_message),
      ['Healing potion', '• Moonleaf', '• Spring water', 'Method', 'Simmer for an hour.'].join(
        '\n',
      ),
    );

    // The blocks themselves, for assertions about layout or formatting.
    const [heading, list] = recipe.rich_message.blocks;
    assert(heading?.type === 'heading');
    assertEquals(heading.size, 1);
    assertEquals(richTextToPlainText(heading.text), 'Healing potion');
    assert(list?.type === 'list');
    assertEquals(list.items.map(({ label }) => label), ['•', '•']);
  });
});
```

## Pressing buttons in a rich message

Buttons in a rich message, whether in a `buttons` block or inside text such as a table cell, act as
inline keyboard buttons. `account.pressButton` selects them by label as it selects keyboard buttons,
and `within` narrows a repeated label to the innermost table row, list item or block that mentions
the given text. `listButtons` lists them with their paths in the message, before any inline keyboard
buttons. `account.pressCallbackButton` presses one by its exact `callback_data`. Either way, the bot
receives a `callback_query` update, and the test reads its answer as
[Buttons and menus](buttons-and-menus.md) shows.

```ts
import { assertEquals, assertExists } from 'jsr:@std/assert@1.0.19';
import { listButtons } from '../../../clients/typescript/mod.ts';
import { withBotFixture } from './bot_fixture.ts';

Deno.test('an account presses a button in a table row of a rich message', async () => {
  await withBotFixture({
    handlers: (bot) => {
      bot.command('prices', (ctx) =>
        ctx.replyWithRichMessage({
          blocks: [
            {
              type: 'table',
              cells: [
                [
                  { text: 'Potion', align: 'left', valign: 'middle' },
                  { text: '10g', align: 'right', valign: 'middle' },
                  {
                    text: { type: 'button', button: { text: 'Buy', callback_data: 'buy:potion' } },
                    align: 'center',
                    valign: 'middle',
                  },
                ],
                [
                  { text: 'Elixir', align: 'left', valign: 'middle' },
                  { text: '25g', align: 'right', valign: 'middle' },
                  {
                    text: { type: 'button', button: { text: 'Buy', callback_data: 'buy:elixir' } },
                    align: 'center',
                    valign: 'middle',
                  },
                ],
              ],
            },
            { type: 'buttons', buttons: [{ text: 'Close', callback_data: 'close' }] },
          ],
        }, { reply_parameters: { message_id: ctx.msg.message_id } }));
      bot.callbackQuery(
        /^buy:(.+)$/,
        (ctx) => ctx.answerCallbackQuery({ text: `Bought ${ctx.match[1]}` }),
      );
    },
  }, async ({ account, activity, botProfile, privateChat }) => {
    const beforeCommand = await activity.position();
    const command = await account.sendMessage({ to: privateChat, text: '/prices' });
    await activity.waitFor({
      method: 'sendRichMessage',
      chat_id: account.id,
      ok: true,
      parameters: { reply_parameters: JSON.stringify({ message_id: command.message_id }) },
    }, { after: beforeCommand });
    const prices = (await account.getMessages({ chat: privateChat })).find((message) =>
      message.from.id === botProfile.id &&
      message.reply_to_message?.message_id === command.message_id
    );
    assertExists(prices);

    assertEquals(listButtons(prices).map(({ label, path }) => `${label} at ${path}`), [
      'Buy at rich_message.blocks[0].cells[0][2].text.button',
      'Buy at rich_message.blocks[0].cells[1][2].text.button',
      'Close at rich_message.blocks[1].buttons[0]',
    ]);

    // `within` narrows to the table row that mentions Elixir rather than the whole table.
    const beforePress = await activity.position();
    const query = await account.pressButton({
      chat: privateChat,
      message_id: prices.message_id,
      button: { label: 'Buy', within: 'Elixir' },
    });
    assertEquals(query.callback_data, 'buy:elixir');
    await activity.waitFor({
      method: 'answerCallbackQuery',
      ok: true,
      parameters: { callback_query_id: query.id },
    }, { after: beforePress });
    assertEquals((await account.getCallbackQuery(query.id)).answer?.text, 'Bought elixir');
  });
});
```

The emulator reads rich messages only as `blocks`; one written in HTML or Markdown fails, as its
[intentional deviations](../../features/rich-messages.md#intentional-deviations) explain.
