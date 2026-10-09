# Messages

[Guide index](README.md) · [Feature reference: Messages](../../features/messages.md) ·
[Feature reference: Pinned messages](../../features/pinned-messages.md) ·
[Feature reference: Text formatting](../../features/text-formatting.md)

This page teaches the conversation flows most bot tests start with: replying, formatting, editing,
deleting, forwarding, pinning, blocking, and streaming drafts, from the account's side and from the
bot's. Every example is a complete test module that uses the
[shared fixture](sessions-and-fixtures.md) and the [waiting pattern](observing-bot-behavior.md).

## Replying to messages

`account.sendMessage` returns the account's message as the bot sees it, and `reply_to_message_id`
makes it a reply to a message of the same chat. `account.getMessages` returns the whole
conversation, oldest first, whoever wrote each message. Because the account's action returns before
the bot handles it, a test waits for the bot's reply call and then picks the reply out of the
history by its sender and by the message it answers, never by its position in the history. The
[messages reference](../../features/messages.md#sending-replying-and-inspecting-history) covers
reply parameters and message IDs.

```ts
import { assertEquals, assertExists } from 'jsr:@std/assert@^1';
import { withBotFixture } from './bot_fixture.ts';

Deno.test('the bot greets the name the account gives in reply to its question', () =>
  withBotFixture({
    handlers: (bot) => {
      bot.command(
        'start',
        (ctx) =>
          ctx.reply('What is your name?', { reply_parameters: { message_id: ctx.msg.message_id } }),
      );
      bot.on('message:text', async (ctx) => {
        if (ctx.msg.reply_to_message?.text === 'What is your name?') {
          await ctx.reply(`Nice to meet you, ${ctx.msg.text}!`, {
            reply_parameters: { message_id: ctx.msg.message_id },
          });
        }
      });
    },
  }, async ({ account, botProfile, privateChat, activity }) => {
    const beforeStart = await activity.position();
    const start = await account.sendMessage({ to: privateChat, text: '/start' });
    await activity.waitFor({
      method: 'sendMessage',
      chat_id: account.id,
      ok: true,
      parameters: { reply_parameters: JSON.stringify({ message_id: start.message_id }) },
    }, { after: beforeStart });
    const question = (await account.getMessages({ chat: privateChat })).find((message) =>
      message.from.id === botProfile.id && message.reply_to_message?.message_id === start.message_id
    );
    assertExists(question);
    assertEquals(question.text, 'What is your name?');

    const beforeAnswer = await activity.position();
    const answer = await account.sendMessage({
      to: privateChat,
      text: 'Ada',
      reply_to_message_id: question.message_id,
    });
    assertEquals(answer.reply_to_message?.message_id, question.message_id);
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
    assertEquals(greeting?.text, 'Nice to meet you, Ada!');
  }));
```

## Formatting text

Accounts format text with `entities`, as bots specify them, and the bot receives them on the
message. A bot's `parse_mode` formatting reaches the account's history as entities too. The
[text formatting reference](../../features/text-formatting.md#supported-behavior) lists the entity
types and limits.

```ts
import { assertEquals } from 'jsr:@std/assert@^1';
import { withBotFixture } from './bot_fixture.ts';

Deno.test('the bot repeats the bold part of a message in bold', () =>
  withBotFixture({
    handlers: (bot) => {
      bot.on('message:text', (ctx) => {
        const boldText = ctx.entities('bold').map(({ text }) => text).join(', ');
        // The account's text is not markup, so HTML parse mode needs it escaped.
        const escapedBoldText = boldText.replaceAll('&', '&amp;').replaceAll('<', '&lt;')
          .replaceAll('>', '&gt;');
        return ctx.reply(`Noted: <b>${escapedBoldText}</b>`, {
          parse_mode: 'HTML',
          reply_parameters: { message_id: ctx.msg.message_id },
        });
      });
    },
  }, async ({ account, botProfile, privateChat, activity }) => {
    const beforeSend = await activity.position();
    const request = await account.sendMessage({
      to: privateChat,
      text: 'Buy milk and eggs',
      entities: [{ type: 'bold', offset: 4, length: 4 }],
    });
    await activity.waitFor({
      method: 'sendMessage',
      chat_id: account.id,
      ok: true,
      parameters: { reply_parameters: JSON.stringify({ message_id: request.message_id }) },
    }, { after: beforeSend });

    const confirmation = (await account.getMessages({ chat: privateChat })).find((message) =>
      message.from.id === botProfile.id &&
      message.reply_to_message?.message_id === request.message_id
    );
    assertEquals(confirmation?.text, 'Noted: milk');
    assertEquals(confirmation?.entities, [{ type: 'bold', offset: 7, length: 4 }]);
  }));
```

## Editing messages

`account.editMessage` changes the text of a message the account sent, and
`account.editMessageCaption` the caption of its photo, document, video, voice note, or audio file.
Both return the edited message, with `edit_date`, and send the bot an `edited_message` update. The
new text or caption must differ from the current one. The
[editing reference](../../features/messages.md#editing-and-deleting) lists what can be edited.

```ts
import { assertEquals, assertExists } from 'jsr:@std/assert@^1';
import { withBotFixture } from './bot_fixture.ts';

Deno.test('the bot notices when the account edits its message', () =>
  withBotFixture({
    handlers: (bot) => {
      bot.on('edited_message:text', (ctx) => {
        const boldText = ctx.entities('bold').map(({ text }) => text).join(', ');
        return ctx.reply(`You changed it to: ${ctx.editedMessage.text} (bold: ${boldText})`, {
          reply_parameters: { message_id: ctx.editedMessage.message_id },
        });
      });
    },
  }, async ({ account, botProfile, privateChat, activity }) => {
    const original = await account.sendMessage({ to: privateChat, text: 'Hello' });

    const beforeEdit = await activity.position();
    const edited = await account.editMessage({
      chat: privateChat,
      message_id: original.message_id,
      text: 'Hello again!',
      entities: [{ type: 'bold', offset: 0, length: 5 }],
    });
    assertExists(edited.edit_date);
    await activity.waitFor({
      method: 'sendMessage',
      chat_id: account.id,
      ok: true,
      parameters: {
        reply_parameters: JSON.stringify({ message_id: original.message_id }),
        text: 'You changed it to: Hello again! (bold: Hello)',
      },
    }, { after: beforeEdit });

    const history = await account.getMessages({ chat: privateChat });
    assertEquals(
      history.find(({ message_id }) => message_id === original.message_id)?.text,
      'Hello again!',
    );
    assertExists(history.find((message) =>
      message.from.id === botProfile.id &&
      message.reply_to_message?.message_id === original.message_id
    ));
  }));
```

A caption edit works the same way. The photo below is a 2×1 GIF inlined as bytes, which the emulator
accepts as a photo.

```ts
import { assertEquals } from 'jsr:@std/assert@^1';
import { withBotFixture } from './bot_fixture.ts';

const TINY_GIF = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 2, 0, 1, 0, 0, 0, 0]);

Deno.test('the bot notices when the account edits a caption', () =>
  withBotFixture({
    handlers: (bot) => {
      bot.on('edited_message:caption', (ctx) =>
        ctx.reply(`New caption: ${ctx.editedMessage.caption}`, {
          reply_parameters: { message_id: ctx.editedMessage.message_id },
        }));
    },
  }, async ({ account, privateChat, activity }) => {
    const photo = await account.sendPhoto({ to: privateChat, photo: TINY_GIF, caption: 'Draft' });

    const beforeEdit = await activity.position();
    const edited = await account.editMessageCaption({
      chat: privateChat,
      message_id: photo.message_id,
      caption: 'Final',
    });
    assertEquals(edited.caption, 'Final');
    await activity.waitFor({
      method: 'sendMessage',
      chat_id: account.id,
      ok: true,
      parameters: {
        reply_parameters: JSON.stringify({ message_id: photo.message_id }),
        text: 'New caption: Final',
      },
    }, { after: beforeEdit });
  }));
```

## Deleting messages

`account.deleteMessage` deletes a message for both participants, as Telegram's clients delete for
everyone; in a private chat the account deletes either participant's messages. Telegram sends bots
no update for it, so a test asserts the result in the account's history, and asserts the absence of
an update with a fence: the delivery of a later message, which the bot would receive after any
update the deletion caused. The
[deleting reference](../../features/messages.md#editing-and-deleting) describes who may delete what,
and [Observing bot behavior](observing-bot-behavior.md) explains fences.

```ts
import { assertEquals } from 'jsr:@std/assert@^1';
import { withBotFixture } from './bot_fixture.ts';

Deno.test('deleting a message sends the bot no update', () =>
  withBotFixture({
    handlers: (bot) => {
      bot.on('message:text', (ctx) =>
        ctx.reply(`Got: ${ctx.msg.text}`, {
          reply_parameters: { message_id: ctx.msg.message_id },
        }));
    },
  }, async ({ account, privateChat, activity }) => {
    const beforeTypo = await activity.position();
    const typo = await account.sendMessage({ to: privateChat, text: 'Helo' });
    const typoReply = await activity.waitFor({
      method: 'sendMessage',
      chat_id: account.id,
      ok: true,
      parameters: { reply_parameters: JSON.stringify({ message_id: typo.message_id }) },
    }, { after: beforeTypo });

    await account.deleteMessage({ chat: privateChat, message_id: typo.message_id });
    const history = await account.getMessages({ chat: privateChat });
    assertEquals(history.some(({ message_id }) => message_id === typo.message_id), false);

    const correction = await account.sendMessage({ to: privateChat, text: 'Hello' });
    const correctionDelivery = await activity.waitFor({
      kind: 'update_delivered',
      chat_id: account.id,
      where: ({ update }) =>
        (update.message as { message_id?: number } | undefined)?.message_id ===
          correction.message_id,
    }, { after: typoReply });
    await activity.assertNone(
      { kind: 'update_delivered' },
      { after: typoReply, before: correctionDelivery },
    );
  }));
```

## Following the bot's edits and deletions

A bot receives no update for its own sends, edits, or deletions; the account sees them in its
history. A test waits for each call with parameters that identify it, such as the `message_id` the
bot's earlier call returned, and then reads the history. Parameters are recorded as text, so a
numeric `message_id` is matched as a string.

```ts
import { assert, assertEquals, assertExists } from 'jsr:@std/assert@^1';
import { withBotFixture } from './bot_fixture.ts';

Deno.test('the bot reports progress by editing its status message', () =>
  withBotFixture({
    handlers: (bot) => {
      bot.command('work', async (ctx) => {
        const status = await ctx.reply('Working…', {
          reply_parameters: { message_id: ctx.msg.message_id },
        });
        await ctx.api.editMessageText(ctx.chat.id, status.message_id, 'Done: 3 items');
        await ctx.deleteMessage();
      });
    },
  }, async ({ account, privateChat, activity }) => {
    const beforeCommand = await activity.position();
    const command = await account.sendMessage({ to: privateChat, text: '/work' });
    const statusCall = await activity.waitFor({
      method: 'sendMessage',
      chat_id: account.id,
      ok: true,
      parameters: { reply_parameters: JSON.stringify({ message_id: command.message_id }) },
    }, { after: beforeCommand });
    assert(statusCall.answer.ok);
    const statusId = (statusCall.answer.result as { message_id: number }).message_id;

    const edit = await activity.waitFor({
      method: 'editMessageText',
      chat_id: account.id,
      ok: true,
      parameters: { message_id: String(statusId), text: 'Done: 3 items' },
    }, { after: statusCall });
    await activity.waitFor({
      method: 'deleteMessage',
      chat_id: account.id,
      ok: true,
      parameters: { message_id: String(command.message_id) },
    }, { after: edit });

    const history = await account.getMessages({ chat: privateChat });
    const status = history.find(({ message_id }) => message_id === statusId);
    assertEquals(status?.text, 'Done: 3 items');
    assertExists(status?.edit_date);
    assertEquals(history.some(({ message_id }) => message_id === command.message_id), false);
  }));
```

## Forwarding messages

`account.forwardMessage` forwards a message of one of the account's chats, `from`, to a chat it can
write to, `to`. The forward is the account's message, and its `forward_origin` names who first sent
the message. An account created with `has_private_forwards: true` keeps forwards of its messages
from linking to it: their origin is a `hidden_user` that shows only its name. The
[forwarding reference](../../features/messages.md#forwarding-and-copying) lists what can be
forwarded.

```ts
import { assertEquals, assertExists } from 'jsr:@std/assert@^1';
import { withBotFixture } from './bot_fixture.ts';

Deno.test('the bot names the origin of forwarded messages', () =>
  withBotFixture({
    account: { has_private_forwards: true },
    handlers: (bot) => {
      bot.on('message:forward_origin', (ctx) => {
        const origin = ctx.msg.forward_origin;
        const sender = origin.type === 'user'
          ? origin.sender_user.first_name
          : origin.type === 'hidden_user'
          ? `${origin.sender_user_name} (hidden)`
          : 'a chat';
        return ctx.reply(`Forwarded from ${sender}`, {
          reply_parameters: { message_id: ctx.msg.message_id },
        });
      });
      bot.command('tip', (ctx) =>
        ctx.reply('Drink water.', { reply_parameters: { message_id: ctx.msg.message_id } }));
    },
  }, async ({ account, botProfile, privateChat, activity }) => {
    const beforeTip = await activity.position();
    const command = await account.sendMessage({ to: privateChat, text: '/tip' });
    await activity.waitFor({
      method: 'sendMessage',
      chat_id: account.id,
      ok: true,
      parameters: { reply_parameters: JSON.stringify({ message_id: command.message_id }) },
    }, { after: beforeTip });
    const tip = (await account.getMessages({ chat: privateChat })).find((message) =>
      message.from.id === botProfile.id &&
      message.reply_to_message?.message_id === command.message_id
    );
    assertExists(tip);
    assertEquals(tip.text, 'Drink water.');

    const beforeForwards = await activity.position();
    const forwardedTip = await account.forwardMessage({
      from: privateChat,
      message_id: tip.message_id,
      to: privateChat,
    });
    assertEquals(forwardedTip.forward_origin?.type, 'user');
    const note = await account.sendMessage({ to: privateChat, text: 'Meet at noon' });
    const forwardedNote = await account.forwardMessage({
      from: privateChat,
      message_id: note.message_id,
      to: privateChat,
    });
    assertEquals(forwardedNote.forward_origin, {
      type: 'hidden_user',
      sender_user_name: 'Ada',
      date: note.date,
    });

    await activity.waitFor({
      method: 'sendMessage',
      chat_id: account.id,
      ok: true,
      parameters: {
        reply_parameters: JSON.stringify({ message_id: forwardedTip.message_id }),
        text: 'Forwarded from Test Bot',
      },
    }, { after: beforeForwards });
    await activity.waitFor({
      method: 'sendMessage',
      chat_id: account.id,
      ok: true,
      parameters: {
        reply_parameters: JSON.stringify({ message_id: forwardedNote.message_id }),
        text: 'Forwarded from Ada (hidden)',
      },
    }, { after: beforeForwards });
  }));
```

## Pinning messages

`account.pinMessage` pins a message of the account's chat, and `account.unpinMessage` unpins it. A
chat pins any number of messages; `account.getPinnedMessages` returns them newest first. A pin is
recorded as the account's service message with `pinned_message`, which the bot receives; an unpin
records nothing. In a private chat, either participant pins any message. The
[account pins reference](../../features/pinned-messages.md#account-pins) lists the permissions and
errors.

```ts
import { assertEquals, assertExists } from 'jsr:@std/assert@^1';
import { withBotFixture } from './bot_fixture.ts';

Deno.test('the bot acknowledges a pinned message', () =>
  withBotFixture({
    handlers: (bot) => {
      bot.on('message:pinned_message', (ctx) => {
        const pinned = ctx.msg.pinned_message;
        return ctx.reply(`Pinned: ${'text' in pinned ? pinned.text : 'a message'}`, {
          reply_parameters: { message_id: ctx.msg.message_id },
        });
      });
    },
  }, async ({ account, privateChat, activity }) => {
    const reminder = await account.sendMessage({ to: privateChat, text: 'Buy milk' });

    const beforePin = await activity.position();
    await account.pinMessage({ chat: privateChat, message_id: reminder.message_id });
    const pinnedMessages = await account.getPinnedMessages({ chat: privateChat });
    assertEquals(pinnedMessages.map(({ message_id }) => message_id), [reminder.message_id]);

    const pinService = (await account.getMessages({ chat: privateChat })).find((message) =>
      message.from.id === account.id &&
      message.pinned_message?.message_id === reminder.message_id
    );
    assertExists(pinService);
    await activity.waitFor({
      method: 'sendMessage',
      chat_id: account.id,
      ok: true,
      parameters: {
        reply_parameters: JSON.stringify({ message_id: pinService.message_id }),
        text: 'Pinned: Buy milk',
      },
    }, { after: beforePin });

    await account.unpinMessage({ chat: privateChat, message_id: reminder.message_id });
    assertEquals(await account.getPinnedMessages({ chat: privateChat }), []);
  }));
```

The same calls take a supergroup as `{ type: 'supergroup', chatId }`. Every bot of the supergroup
receives a pin's service message, privacy mode notwithstanding. [Supergroups](supergroups.md) covers
creating one and adding members.

```ts
import { assertEquals } from 'jsr:@std/assert@^1';
import { withBotFixture } from './bot_fixture.ts';

Deno.test('the bot acknowledges a pin in a supergroup', () =>
  withBotFixture({
    handlers: (bot) => {
      bot.on('message:pinned_message', (ctx) => ctx.reply('Pin noted'));
    },
  }, async ({ account, botProfile, activity }) => {
    const supergroup = await account.createSupergroup({ title: 'Team' });
    const teamChat = { type: 'supergroup', chatId: supergroup.id } as const;
    await account.addChatMember({ chat: teamChat, userId: botProfile.id });
    const agenda = await account.sendMessage({ to: teamChat, text: 'Agenda: release' });

    const beforePin = await activity.position();
    await account.pinMessage({ chat: teamChat, message_id: agenda.message_id });
    await activity.waitFor({
      method: 'sendMessage',
      chat_id: supergroup.id,
      ok: true,
      parameters: { text: 'Pin noted' },
    }, { after: beforePin });
    const pinnedMessages = await account.getPinnedMessages({ chat: teamChat });
    assertEquals(pinnedMessages.map(({ text }) => text), ['Agenda: release']);
  }));
```

## Blocking the bot

`account.blockBot` blocks the bot, which Telegram calls stopping it, and `account.unblockBot` lifts
the block. Each change sends the bot a `my_chat_member` update: `kicked` when blocked, `member`
again when unblocked. While blocked, the bot's sends to the account fail with
`403 Forbidden: bot was blocked by the user`, and the account's own sends to the bot are refused
with an `EmulationClientError` of status 409. The
[blocking reference](../../features/messages.md#blocking) describes the rest. The test below sends
as the bot directly through the fixture's `bot.api`.

```ts
import { assertEquals, assertRejects } from 'jsr:@std/assert@^1';
import { GrammyError } from 'npm:grammy@^1.46.0';
import type { ChatMemberUpdated } from 'npm:grammy@^1.46.0/types';
import { EmulationClientError } from '../../../clients/typescript/mod.ts';
import { withBotFixture } from './bot_fixture.ts';

Deno.test('a blocked bot cannot message the account until it is unblocked', () =>
  withBotFixture({
    handlers: (bot) => {
      bot.command('start', (ctx) =>
        ctx.reply('Welcome!', { reply_parameters: { message_id: ctx.msg.message_id } }));
    },
  }, async ({ account, bot, botProfile, privateChat, activity }) => {
    const myChatMemberStatus = (status: string) =>
      ({
        kind: 'update_delivered',
        chat_id: account.id,
        where: ({ update }: { update: Record<string, unknown> }) =>
          (update.my_chat_member as ChatMemberUpdated | undefined)?.new_chat_member.status ===
            status,
      }) as const;

    const beforeStart = await activity.position();
    const start = await account.sendMessage({ to: privateChat, text: '/start' });
    await activity.waitFor({
      method: 'sendMessage',
      chat_id: account.id,
      ok: true,
      parameters: { reply_parameters: JSON.stringify({ message_id: start.message_id }) },
    }, { after: beforeStart });

    const beforeBlock = await activity.position();
    await account.blockBot({ botId: botProfile.id });
    await activity.waitFor(myChatMemberStatus('kicked'), { after: beforeBlock });

    await assertRejects(
      () =>
        bot.api.sendMessage(account.id, 'Still there?'),
      GrammyError,
      'Forbidden: bot was blocked by the user',
    );
    const refusal = await assertRejects(
      () => account.sendMessage({ to: privateChat, text: 'Hello?' }),
      EmulationClientError,
    );
    assertEquals(refusal.status, 409);

    const beforeUnblock = await activity.position();
    await account.unblockBot({ botId: botProfile.id });
    await activity.waitFor(myChatMemberStatus('member'), { after: beforeUnblock });
    const welcomeBack = await bot.api.sendMessage(account.id, 'Welcome back!');
    const history = await account.getMessages({ chat: privateChat });
    assertEquals(
      history.find(({ message_id }) => message_id === welcomeBack.message_id)?.text,
      'Welcome back!',
    );
  }));
```

## Notifications and chat actions

`account.getNotifications` returns the notifications the account's client shows for messages others
sent to the chat, oldest first; a bot's `disable_notification` makes one silent. The account's own
messages do not notify. The [notifications reference](../../features/messages.md#notifications)
describes them.

```ts
import { assertEquals, assertExists } from 'jsr:@std/assert@^1';
import { withBotFixture } from './bot_fixture.ts';

Deno.test('the bot sends its footnote silently', () =>
  withBotFixture({
    handlers: (bot) => {
      bot.command('news', async (ctx) => {
        const reply_parameters = { message_id: ctx.msg.message_id };
        await ctx.reply('Release 2.0 is out', { reply_parameters });
        await ctx.reply('Full notes on the website', {
          disable_notification: true,
          reply_parameters,
        });
      });
    },
  }, async ({ account, botProfile, privateChat, activity }) => {
    const beforeCommand = await activity.position();
    const command = await account.sendMessage({ to: privateChat, text: '/news' });
    await activity.waitFor({
      method: 'sendMessage',
      chat_id: account.id,
      ok: true,
      parameters: { text: 'Full notes on the website' },
    }, { after: beforeCommand });

    const replies = (await account.getMessages({ chat: privateChat })).filter((message) =>
      message.from.id === botProfile.id &&
      message.reply_to_message?.message_id === command.message_id
    );
    const headline = replies.find(({ text }) => text === 'Release 2.0 is out');
    const footnote = replies.find(({ text }) => text === 'Full notes on the website');
    assertExists(headline);
    assertExists(footnote);
    assertEquals(await account.getNotifications({ chat: privateChat }), [
      { message_id: headline.message_id, is_silent: false },
      { message_id: footnote.message_id, is_silent: true },
    ]);
  }));
```

`account.getChatActions` returns the actions, such as typing, that the account's client shows. A
bot's action lasts 5.5 seconds unless the bot sends it again, and ends when the bot sends a message
to the chat. The test below holds the bot's work on a promise it resolves itself, so it can read the
action while the bot works, and resolves it in `finally` so the bot can stop even when an assertion
fails.

```ts
import { assertEquals } from 'jsr:@std/assert@^1';
import { withBotFixture } from './bot_fixture.ts';

Deno.test('the account sees the bot typing until its report arrives', async () => {
  const { promise: reportFinished, resolve: finishReport } = Promise.withResolvers<void>();
  await withBotFixture({
    handlers: (bot) => {
      bot.command('report', async (ctx) => {
        await ctx.replyWithChatAction('typing');
        await reportFinished;
        await ctx.reply('Report ready', { reply_parameters: { message_id: ctx.msg.message_id } });
      });
    },
  }, async ({ account, botProfile, privateChat, activity }) => {
    try {
      const beforeCommand = await activity.position();
      const command = await account.sendMessage({ to: privateChat, text: '/report' });
      const typing = await activity.waitFor({
        method: 'sendChatAction',
        chat_id: account.id,
        ok: true,
        parameters: { action: 'typing' },
      }, { after: beforeCommand });
      assertEquals(await account.getChatActions({ chat: privateChat }), [
        { bot_id: botProfile.id, action: 'typing' },
      ]);

      finishReport();
      await activity.waitFor({
        method: 'sendMessage',
        chat_id: account.id,
        ok: true,
        parameters: { reply_parameters: JSON.stringify({ message_id: command.message_id }) },
      }, { after: typing });
      assertEquals(await account.getChatActions({ chat: privateChat }), []);
    } finally {
      finishReport();
    }
  });
});
```

## Streaming drafts

`account.getMessageDraft` returns the draft of a message the bot is still generating, which the
account's client shows apart from the chat's messages, or `null` for none. Each `sendMessageDraft`
with the same `draft_id` changes the draft, and the bot's next message to the chat removes it.
Telegram's clients also drop a draft 30 seconds after the bot's last write; the emulator never does
so on its own, and `account.expireMessageDraft` stands in for that timeout. The
[message drafts reference](../../features/messages.md#message-drafts) lists the checks and limits.

The test below holds the bot's answer on a promise, reads the draft while the bot waits, and expires
it as if the answer took too long, before the answer arrives anyway.

```ts
import { assertEquals } from 'jsr:@std/assert@^1';
import { withBotFixture } from './bot_fixture.ts';

Deno.test('the answer arrives after its draft timed out', async () => {
  const { promise: answerReady, resolve: finishAnswer } = Promise.withResolvers<void>();
  await withBotFixture({
    handlers: (bot) => {
      bot.command('ask', async (ctx) => {
        // grammY's `replyWithDraft` names a draft after the update that asked for it.
        const draftId = ctx.update.update_id;
        await ctx.api.sendMessageDraft(ctx.chat.id, draftId, 'Looking it up');
        await answerReady;
        await ctx.reply('The answer is 42');
      });
    },
  }, async ({ account, privateChat, activity }) => {
    try {
      const beforeQuestion = await activity.position();
      await account.sendMessage({ to: privateChat, text: '/ask' });
      const drafted = await activity.waitFor({
        method: 'sendMessageDraft',
        chat_id: account.id,
        ok: true,
      }, { after: beforeQuestion });
      const draft_id = String(drafted.parameters.draft_id);
      assertEquals(await account.getMessageDraft({ chat: privateChat }), {
        draft_id,
        text: 'Looking it up',
      });

      await account.expireMessageDraft({ chat: privateChat, draft_id });
      assertEquals(await account.getMessageDraft({ chat: privateChat }), null);

      finishAnswer();
      await activity.waitFor({
        method: 'sendMessage',
        chat_id: account.id,
        ok: true,
        parameters: { text: 'The answer is 42' },
      }, { after: drafted });
      const history = await account.getMessages({ chat: privateChat });
      assertEquals(history.map(({ text }) => text), ['/ask', 'The answer is 42']);
    } finally {
      finishAnswer();
    }
  });
});
```
