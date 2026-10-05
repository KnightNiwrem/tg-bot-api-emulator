# Supergroups

[Guide index](README.md) · [Feature reference: Supergroups](../../features/supergroups.md)

This page shows how an account creates a supergroup, brings a bot and other accounts into it, and
changes the supergroup's settings, and how a test observes what the bot receives there. The examples
use the [shared fixture](sessions-and-fixtures.md) and the
[waiting pattern](observing-bot-behavior.md).
[Permissions and moderation](permissions-and-moderation.md) continues with administrator bots and
restrictions.

## Creating a supergroup and adding the bot

`account.createSupergroup` creates a supergroup that the account owns and returns it with its `id`,
the negative chat ID bots see. Every other operation addresses it as a target,
`{ type: 'supergroup', chatId }`, the supergroup counterpart of the fixture's `privateChat`; the
account's `sendMessage`, `getMessages` and the other message operations take either.

`account.addChatMember` adds a bot or another account. The owner's service message with
`new_chat_members` records the addition as soon as the call returns. An added bot first receives a
`my_chat_member` update showing it as a `member`, then the service message, which bots receive even
in privacy mode. [Membership and messages](../../features/supergroups.md#membership-and-messages)
describes both.

```ts
import { assertEquals, assertExists } from 'jsr:@std/assert@^1';
import type { ChatMemberUpdated } from 'npm:grammy@^1.46.0/types';
import { withBotFixture } from './bot_fixture.ts';

Deno.test('the bot greets the supergroup that adds it', () =>
  withBotFixture({
    handlers: (bot) => {
      bot.on('message:new_chat_members', async (ctx) => {
        if (ctx.msg.new_chat_members.some(({ id }) => id === ctx.me.id)) {
          await ctx.reply('Hello, team!', { reply_parameters: { message_id: ctx.msg.message_id } });
        }
      });
    },
  }, async ({ botProfile, account, activity }) => {
    const supergroup = await account.createSupergroup({ title: 'Team' });
    const groupChat = { type: 'supergroup', chatId: supergroup.id } as const;

    const beforeAdding = await activity.position();
    await account.addChatMember({ chat: groupChat, userId: botProfile.id });

    // The owner's service message records the addition as soon as addChatMember returns.
    const addition = (await account.getMessages({ chat: groupChat })).find((message) =>
      message.from.id === account.id &&
      message.new_chat_members?.some(({ id }) => id === botProfile.id)
    );
    assertExists(addition);

    // The bot first learns of its own membership through my_chat_member.
    const membershipUpdate = await activity.waitFor({
      kind: 'update_delivered',
      chat_id: supergroup.id,
      where: (entry) => 'my_chat_member' in entry.update,
    }, { after: beforeAdding });
    const { new_chat_member } = membershipUpdate.update.my_chat_member as ChatMemberUpdated;
    assertEquals(new_chat_member.status, 'member');

    await activity.waitFor({
      method: 'sendMessage',
      chat_id: supergroup.id,
      ok: true,
      parameters: { reply_parameters: JSON.stringify({ message_id: addition.message_id }) },
    }, { after: beforeAdding });
    const greeting = (await account.getMessages({ chat: groupChat })).find((message) =>
      message.from.id === botProfile.id &&
      message.reply_to_message?.message_id === addition.message_id
    );
    assertEquals(greeting?.text, 'Hello, team!');
  }));
```

## Privacy mode

A bot is in privacy mode unless it is an administrator or was created with
`can_read_all_group_messages: true`. In privacy mode, it receives only the account messages
addressed to it: commands, replies to its messages, and mentions of it, plus service messages.
[Privacy mode](../../features/supergroups.md#privacy-mode) gives the routing rules, including which
bot an unqualified command such as `/start` reaches.

Asserting that the bot did not receive a message needs a fence: a later entry that the bot can only
record after it would have received the message. A bot's updates queue in the order they happen and
`getUpdates` hands them over from the front of the queue, so chatter sent before a command would be
delivered no later than the command. The command's delivery precedes the bot's reply to it, so that
reply fences the chatter's delivery.
[Asserting that something did not happen](../../features/bot-activity.md#asserting-that-something-did-not-happen)
explains fences.

```ts
import { assertEquals } from 'jsr:@std/assert@^1';
import { withBotFixture } from './bot_fixture.ts';

Deno.test('a bot in privacy mode receives commands but not chatter', () =>
  withBotFixture({
    handlers: (bot) => {
      bot.command('start', (ctx) =>
        ctx.reply('Ready.', { reply_parameters: { message_id: ctx.msg.message_id } }));
      bot.on('message:text', (ctx) =>
        ctx.reply('I read everything.', { reply_parameters: { message_id: ctx.msg.message_id } }));
    },
  }, async ({ botProfile, account, activity }) => {
    const supergroup = await account.createSupergroup({ title: 'Team' });
    const groupChat = { type: 'supergroup', chatId: supergroup.id } as const;
    await account.addChatMember({ chat: groupChat, userId: botProfile.id });

    const beforeSending = await activity.position();
    const chatter = await account.sendMessage({ to: groupChat, text: 'Lunch at noon?' });
    const command = await account.sendMessage({ to: groupChat, text: '/start@test_bot' });

    const commandReply = await activity.waitFor({
      method: 'sendMessage',
      chat_id: supergroup.id,
      ok: true,
      parameters: { reply_parameters: JSON.stringify({ message_id: command.message_id }) },
    }, { after: beforeSending });

    // Chatter sent first would be delivered no later than the command the reply answers.
    await activity.assertNone({
      kind: 'update_delivered',
      chat_id: supergroup.id,
      where: (entry) =>
        (entry.update.message as { message_id?: number } | undefined)?.message_id ===
          chatter.message_id,
    }, { after: beforeSending, before: commandReply });

    const botMessages = (await account.getMessages({ chat: groupChat }))
      .filter(({ from }) =>
        from.id === botProfile.id
      );
    assertEquals(
      botMessages.map(({ text }) =>
        text
      ),
      ['Ready.'],
    );
  }));
```

The fixture's `bot` option registers a bot with privacy mode turned off, which receives every
account message:

```ts
import { assertEquals } from 'jsr:@std/assert@^1';
import { withBotFixture } from './bot_fixture.ts';

Deno.test('a bot without privacy mode receives every message', () =>
  withBotFixture({
    bot: { can_read_all_group_messages: true },
    handlers: (bot) => {
      bot.on('message:text', (ctx) =>
        ctx.reply('Noted.', { reply_parameters: { message_id: ctx.msg.message_id } }));
    },
  }, async ({ botProfile, account, activity }) => {
    const supergroup = await account.createSupergroup({ title: 'Team' });
    const groupChat = { type: 'supergroup', chatId: supergroup.id } as const;
    await account.addChatMember({ chat: groupChat, userId: botProfile.id });

    const beforeSending = await activity.position();
    const chatter = await account.sendMessage({ to: groupChat, text: 'Lunch at noon?' });
    await activity.waitFor({
      method: 'sendMessage',
      chat_id: supergroup.id,
      ok: true,
      parameters: { reply_parameters: JSON.stringify({ message_id: chatter.message_id }) },
    }, { after: beforeSending });

    const reply = (await account.getMessages({ chat: groupChat })).find((message) =>
      message.from.id === botProfile.id &&
      message.reply_to_message?.message_id === chatter.message_id
    );
    assertEquals(reply?.text, 'Noted.');
  }));
```

## Members joining and leaving

A supergroup with several people needs more accounts: `session.createAccount` returns another
account client, which acts on its own behalf. The owner adds accounts with `addChatMember`. A
supergroup created with a `username` is public, and any account joins it by itself with
`account.joinChat`; a private supergroup refuses that, and admits accounts only as the owner adds
them or through an [invite link](invite-links.md). `account.leaveChat` leaves; the owner cannot.
Each join or departure is recorded as a service message with `new_chat_members` or
`left_chat_member`, which the supergroup's bots receive.

```ts
import { assertEquals, assertExists, assertRejects } from 'jsr:@std/assert@^1';
import { EmulationClientError } from '../../../clients/typescript/mod.ts';
import { withBotFixture } from './bot_fixture.ts';

Deno.test('the bot welcomes members who join and says goodbye to those who leave', () =>
  withBotFixture({
    handlers: (bot) => {
      bot.on('message:new_chat_members', async (ctx) => {
        const names = ctx.msg.new_chat_members
          .filter(({ id }) => id !== ctx.me.id)
          .map(({ first_name }) => first_name);
        if (names.length > 0) {
          await ctx.reply(`Welcome, ${names.join(', ')}!`, {
            reply_parameters: { message_id: ctx.msg.message_id },
          });
        }
      });
      bot.on(
        'message:left_chat_member',
        (ctx) =>
          ctx.reply(`Goodbye, ${ctx.msg.left_chat_member.first_name}.`, {
            reply_parameters: { message_id: ctx.msg.message_id },
          }),
      );
    },
  }, async ({ session, botProfile, account, activity }) => {
    const supergroup = await account.createSupergroup({
      title: 'Open Team',
      username: 'open_team',
    });
    const groupChat = { type: 'supergroup', chatId: supergroup.id } as const;
    await account.addChatMember({ chat: groupChat, userId: botProfile.id });
    const { account: grace } = await session.createAccount({ first_name: 'Grace' });

    const beforeJoining = await activity.position();
    await grace.joinChat({ chat: groupChat });
    const join = (await grace.getMessages({ chat: groupChat })).find((message) =>
      message.from.id === grace.id && message.new_chat_members !== undefined
    );
    assertExists(join);
    const welcome = await activity.waitFor({
      method: 'sendMessage',
      chat_id: supergroup.id,
      ok: true,
      parameters: { reply_parameters: JSON.stringify({ message_id: join.message_id }) },
    }, { after: beforeJoining });
    assertEquals(welcome.parameters.text, 'Welcome, Grace!');

    const beforeLeaving = await activity.position();
    await grace.leaveChat({ chat: groupChat });
    const departure = (await account.getMessages({ chat: groupChat })).find((message) =>
      message.left_chat_member?.id === grace.id
    );
    assertExists(departure);
    const goodbye = await activity.waitFor({
      method: 'sendMessage',
      chat_id: supergroup.id,
      ok: true,
      parameters: { reply_parameters: JSON.stringify({ message_id: departure.message_id }) },
    }, { after: beforeLeaving });
    assertEquals(goodbye.parameters.text, 'Goodbye, Grace.');

    // A private supergroup admits only the accounts its owner adds or its invite links admit.
    const coreTeam = await account.createSupergroup({ title: 'Core Team' });
    const coreTeamChat = { type: 'supergroup', chatId: coreTeam.id } as const;
    await assertRejects(() => grace.joinChat({ chat: coreTeamChat }), EmulationClientError);
    await account.addChatMember({ chat: coreTeamChat, userId: grace.id });
    const thanks = await grace.sendMessage({ to: coreTeamChat, text: 'Thanks for adding me' });
    assertEquals(thanks.from.id, grace.id);
  }));
```

## Removing the bot

`account.removeChatMember` removes a member and bans it until the owner adds it again. A removed bot
receives a `my_chat_member` update showing it as `kicked`, and its later requests to the supergroup
fail with `403 Forbidden: bot was kicked from the supergroup chat`. A failed call is recorded in the
activity log like a successful one, with `ok: false` in its `answer`, so the test asserts Telegram's
error there. The bot below posts announcements to the supergroup that added it, and tells the
account in their private chat when posting fails.

```ts
import { assertEquals, assertExists } from 'jsr:@std/assert@^1';
import { GrammyError } from 'npm:grammy@^1.46.0';
import type { ChatMemberUpdated } from 'npm:grammy@^1.46.0/types';
import { withBotFixture } from './bot_fixture.ts';

Deno.test('a removed bot is kicked and can no longer post to the supergroup', () => {
  let announcementChatId: number | undefined;
  return withBotFixture({
    handlers: (bot) => {
      bot.on('my_chat_member', (ctx) => {
        if (ctx.myChatMember.new_chat_member.status === 'member') announcementChatId = ctx.chat.id;
      });
      bot.command('announce', async (ctx) => {
        if (announcementChatId === undefined) return;
        try {
          await ctx.api.sendMessage(announcementChatId, ctx.match);
          await ctx.reply('Announced.');
        } catch (error) {
          if (!(error instanceof GrammyError)) throw error;
          await ctx.reply(`Announcement failed: ${error.description}`);
        }
      });
    },
  }, async ({ botProfile, account, privateChat, activity }) => {
    const supergroup = await account.createSupergroup({ title: 'Team' });
    const groupChat = { type: 'supergroup', chatId: supergroup.id } as const;
    await account.addChatMember({ chat: groupChat, userId: botProfile.id });

    const beforeRemoving = await activity.position();
    await account.removeChatMember({ chat: groupChat, userId: botProfile.id });
    const removal = await activity.waitFor({
      kind: 'update_delivered',
      chat_id: supergroup.id,
      where: (entry) =>
        (entry.update.my_chat_member as ChatMemberUpdated | undefined)?.new_chat_member.status ===
          'kicked',
    }, { after: beforeRemoving });

    await account.sendMessage({ to: privateChat, text: '/announce Standup moves to 10:00' });
    const refusedPost = await activity.waitFor({
      method: 'sendMessage',
      chat_id: supergroup.id,
      parameters: { text: 'Standup moves to 10:00' },
    }, { after: removal });
    assertEquals(refusedPost.answer, {
      ok: false,
      error_code: 403,
      description: 'Forbidden: bot was kicked from the supergroup chat',
    });
    await activity.waitFor({
      method: 'sendMessage',
      chat_id: account.id,
      ok: true,
      parameters: {
        text: 'Announcement failed: Forbidden: bot was kicked from the supergroup chat',
      },
    }, { after: refusedPost });

    // The owner still sees the removal's service message.
    const removalMessage = (await account.getMessages({ chat: groupChat })).find((message) =>
      message.left_chat_member?.id === botProfile.id
    );
    assertExists(removalMessage);
  });
});
```

## Title and description

Any member may change the supergroup's title with `account.changeSupergroupTitle` and its
description with `account.changeSupergroupDescription`, unless the
[default permissions](permissions-and-moderation.md) withhold `can_change_info`. A new title is
recorded as the member's service message with `new_chat_title`, which the supergroup's bots receive.
No service message records a description; bots read it with `getChat`.
[Title and description](../../features/supergroups.md#title-and-description) describes how Telegram
cleans both.

```ts
import { assertEquals, assertExists } from 'jsr:@std/assert@^1';
import { withBotFixture } from './bot_fixture.ts';

Deno.test('the bot sees the title and description members set', () =>
  withBotFixture({
    handlers: (bot) => {
      bot.on('message:new_chat_title', (ctx) =>
        ctx.reply(`New title noted: ${ctx.msg.new_chat_title}`, {
          reply_parameters: { message_id: ctx.msg.message_id },
        }));
      bot.command('about', async (ctx) => {
        const chat = await ctx.getChat();
        await ctx.reply(chat.description ?? 'No description.', {
          reply_parameters: { message_id: ctx.msg.message_id },
        });
      });
    },
  }, async ({ botProfile, account, activity }) => {
    const supergroup = await account.createSupergroup({ title: 'Team' });
    const groupChat = { type: 'supergroup', chatId: supergroup.id } as const;
    await account.addChatMember({ chat: groupChat, userId: botProfile.id });

    const beforeRenaming = await activity.position();
    await account.changeSupergroupTitle({ chat: groupChat, title: 'Platform Team' });
    const titleChange = (await account.getMessages({ chat: groupChat })).find((message) =>
      message.new_chat_title === 'Platform Team'
    );
    assertExists(titleChange);
    await activity.waitFor({
      method: 'sendMessage',
      chat_id: supergroup.id,
      ok: true,
      parameters: {
        text: 'New title noted: Platform Team',
        reply_parameters: JSON.stringify({ message_id: titleChange.message_id }),
      },
    }, { after: beforeRenaming });

    await account.changeSupergroupDescription({
      chat: groupChat,
      description: 'Release coordination',
    });
    const beforeAsking = await activity.position();
    const question = await account.sendMessage({ to: groupChat, text: '/about@test_bot' });
    const answer = await activity.waitFor({
      method: 'sendMessage',
      chat_id: supergroup.id,
      ok: true,
      parameters: { reply_parameters: JSON.stringify({ message_id: question.message_id }) },
    }, { after: beforeAsking });
    assertEquals(answer.parameters.text, 'Release coordination');
  }));
```

## Content protection

`account.setContentProtection` turns on Telegram's "Restrict saving content" setting for a
supergroup the account owns, or turns it off with `hasProtectedContent: false`. While it is on,
every message of the supergroup, earlier ones included, shows `has_protected_content`, and neither
accounts nor bots can forward them; bots may still copy them. No bot receives an update for the
change. [Bot promotion](../../features/supergroups.md#bot-promotion) describes the setting together
with the other owner operations.

```ts
import { assertEquals, assertRejects } from 'jsr:@std/assert@^1';
import { EmulationClientError } from '../../../clients/typescript/mod.ts';
import { withBotFixture } from './bot_fixture.ts';

Deno.test('content protection covers every message of the supergroup', () =>
  withBotFixture({
    handlers: (bot) => {
      bot.command('status', (ctx) =>
        ctx.reply(ctx.msg.has_protected_content ? 'Protected.' : 'Open.', {
          reply_parameters: { message_id: ctx.msg.message_id },
        }));
    },
  }, async ({ botProfile, account, privateChat, activity }) => {
    const supergroup = await account.createSupergroup({ title: 'Team' });
    const groupChat = { type: 'supergroup', chatId: supergroup.id } as const;
    await account.addChatMember({ chat: groupChat, userId: botProfile.id });
    const draft = await account.sendMessage({ to: groupChat, text: 'Q3 roadmap draft' });

    await account.setContentProtection({ chat: groupChat, hasProtectedContent: true });

    const beforeAsking = await activity.position();
    const question = await account.sendMessage({ to: groupChat, text: '/status@test_bot' });
    const answer = await activity.waitFor({
      method: 'sendMessage',
      chat_id: supergroup.id,
      ok: true,
      parameters: { reply_parameters: JSON.stringify({ message_id: question.message_id }) },
    }, { after: beforeAsking });
    assertEquals(answer.parameters.text, 'Protected.');

    // Earlier messages are protected too, so not even their author can forward them.
    const history = await account.getMessages({ chat: groupChat });
    assertEquals(
      history.find(({ message_id }) =>
        message_id === draft.message_id
      )?.has_protected_content,
      true,
    );
    const refusal = await assertRejects(
      () =>
        account.forwardMessage({ from: groupChat, message_id: draft.message_id, to: privateChat }),
      EmulationClientError,
    );
    assertEquals(refusal.status, 400);
  }));
```
