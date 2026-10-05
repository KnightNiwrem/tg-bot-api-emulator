# Permissions and moderation

[Guide index](README.md) · [Feature reference: Supergroups](../../features/supergroups.md)

This page shows how a supergroup's owner makes a bot an administrator, restricts members, and sets
what members may do by default, and how a test asserts what an administrator bot does and what a
restricted bot is refused. It builds on [Supergroups](supergroups.md); the examples use the
[shared fixture](sessions-and-fixtures.md) and the [waiting pattern](observing-bot-behavior.md).

## A moderator bot

`account.promoteChatMember` makes a member an administrator with the rights it lists, which must
include at least one; promoting an administrator again replaces its rights. A promoted bot receives
a `my_chat_member` update showing it as `administrator`, receives every message of the supergroup
whatever its privacy mode, and uses its rights through the Bot API: `can_delete_messages` lets it
delete any message, and `can_restrict_members` lets it ban members with `banChatMember`.
[Administrator operations](../../features/supergroups.md#administrator-operations) lists what each
right allows.

The bot below deletes any message containing a banned word and bans its sender. The test waits for
the deletion and the ban of the offending message's sender, uses the ban as a fence to assert that
the bot left the earlier, harmless message alone, and checks the result in the owner's history: the
spam is gone, and the bot's service message records the sender's removal.

```ts
import { assert, assertEquals, assertExists, assertRejects } from 'jsr:@std/assert@^1';
import { EmulationClientError } from '../../../clients/typescript/mod.ts';
import { withBotFixture } from './bot_fixture.ts';

const BANNED_WORD = /\bcasino\b/i;

Deno.test('the moderator bot deletes a banned word and bans its sender', () =>
  withBotFixture({
    handlers: (bot) => {
      bot.on('message:text', async (ctx) => {
        if (!BANNED_WORD.test(ctx.msg.text)) return;
        await ctx.deleteMessage();
        await ctx.banAuthor();
      });
    },
  }, async ({ session, botProfile, account, activity }) => {
    const supergroup = await account.createSupergroup({ title: 'Team' });
    const groupChat = { type: 'supergroup', chatId: supergroup.id } as const;
    await account.addChatMember({ chat: groupChat, userId: botProfile.id });
    const { account: mallory } = await session.createAccount({ first_name: 'Mallory' });
    await account.addChatMember({ chat: groupChat, userId: mallory.id });
    await account.promoteChatMember({
      chat: groupChat,
      userId: botProfile.id,
      rights: { can_delete_messages: true, can_restrict_members: true },
    });

    const beforeSpam = await activity.position();
    const greeting = await mallory.sendMessage({ to: groupChat, text: 'Hi all!' });
    const spam = await mallory.sendMessage({ to: groupChat, text: 'Win big at the casino' });

    const deletion = await activity.waitFor({
      method: 'deleteMessage',
      chat_id: supergroup.id,
      ok: true,
      parameters: { message_id: String(spam.message_id) },
    }, { after: beforeSpam });
    const ban = await activity.waitFor({
      method: 'banChatMember',
      chat_id: supergroup.id,
      ok: true,
      parameters: { user_id: String(mallory.id) },
    }, { after: deletion });

    // The bot handles updates in order, so the ban fences its handling of the greeting.
    await activity.assertNone({
      method: 'deleteMessage',
      chat_id: supergroup.id,
      parameters: { message_id: String(greeting.message_id) },
    }, { after: beforeSpam, before: ban });

    const history = await account.getMessages({ chat: groupChat });
    assert(history.some(({ message_id }) => message_id === greeting.message_id));
    assert(!history.some(({ message_id }) => message_id === spam.message_id));
    const removal = history.find((message) =>
      message.from.id === botProfile.id && message.left_chat_member?.id === mallory.id
    );
    assertExists(removal);

    // Banned, Mallory can no longer write to the supergroup.
    const refusal = await assertRejects(
      () => mallory.sendMessage({ to: groupChat, text: 'Hello?' }),
      EmulationClientError,
    );
    assertEquals(refusal.status, 403);
  }));
```

## Administrators and custom titles

`account.getChatAdministrators` returns the owner, then the administrators in the order they joined,
as a member account sees them: each administrator's rights, custom title, who promoted it, and
whether the inspecting account may edit it. `account.setCustomTitle` sets the owner's own title or
an administrator's, which bots see as `custom_title`. `account.demoteChatMember` makes an
administrator a plain member again, which removes its title; a demoted bot receives a
`my_chat_member` update showing it as `member`, and is back in privacy mode unless it was created
without it. [Administrator delegation](../../features/supergroups.md#administrator-delegation)
describes `promoted_by_user_id` and `can_be_edited`.

```ts
import { assert, assertEquals } from 'jsr:@std/assert@^1';
import type { ChatMemberUpdated } from 'npm:grammy@^1.46.0/types';
import { withBotFixture } from './bot_fixture.ts';

Deno.test('the owner promotes, titles and demotes the bot', () =>
  withBotFixture({ handlers: () => {} }, async ({ botProfile, account, activity }) => {
    const supergroup = await account.createSupergroup({ title: 'Team' });
    const groupChat = { type: 'supergroup', chatId: supergroup.id } as const;
    await account.addChatMember({ chat: groupChat, userId: botProfile.id });
    const botStatusAfter = (position: number, status: string) =>
      activity.waitFor({
        kind: 'update_delivered',
        chat_id: supergroup.id,
        where: (entry) =>
          (entry.update.my_chat_member as ChatMemberUpdated | undefined)?.new_chat_member
            .status === status,
      }, { after: position });

    const beforePromoting = await activity.position();
    await account.promoteChatMember({
      chat: groupChat,
      userId: botProfile.id,
      rights: { can_delete_messages: true, can_pin_messages: true },
    });
    await account.setCustomTitle({
      chat: groupChat,
      userId: botProfile.id,
      customTitle: 'Moderator',
    });
    await botStatusAfter(beforePromoting, 'administrator');

    const [owner, administrator] = await account.getChatAdministrators({ chat: groupChat });
    assertEquals(owner, { user_id: account.id, status: 'owner' });
    assert(administrator.status === 'administrator');
    assertEquals(administrator.user_id, botProfile.id);
    assertEquals(administrator.custom_title, 'Moderator');
    assertEquals(administrator.rights.can_delete_messages, true);
    assertEquals(administrator.rights.can_restrict_members, false);
    assertEquals(administrator.promoted_by_user_id, account.id);
    assertEquals(administrator.can_be_edited, true);

    const beforeDemoting = await activity.position();
    await account.demoteChatMember({ chat: groupChat, userId: botProfile.id });
    await botStatusAfter(beforeDemoting, 'member');
    assertEquals(
      (await account.getChatAdministrators({ chat: groupChat })).map(({ user_id }) => user_id),
      [account.id],
    );
  }));
```

## Restricting a member

`account.restrictChatMember` restricts an account or a bot, member or not, to the permissions it
keeps; unlike in the Bot API, no permission implies another, and keeping every permission lifts the
restriction. A restricted bot receives a `my_chat_member` update showing it as `restricted`, and its
sends that the restriction withholds fail with Telegram's errors, such as
`Bad Request: not enough rights to send photos to the chat`.
[Member restrictions](../../features/supergroups.md#member-restrictions) lists which permission each
kind of content needs and the error a refusal gives.

A restriction with `untilDate` is temporary, but the emulator does not let time pass by itself:
`session.expireChatMemberRestriction` makes its end arrive, and returns the user's standing after
it. No bot receives an update for the end. [Test controls](test-controls.md) covers this and the
other controls that stand in for time passing.

The bot below answers `/cat` with a photo, and falls back to text when Telegram refuses the photo.
The refused `sendPhoto` call is in the activity log with `ok: false` and Telegram's error, which the
test asserts before ending the restriction and asking again.

```ts
import { assertEquals, assertExists } from 'jsr:@std/assert@^1';
import { GrammyError, InputFile } from 'npm:grammy@^1.46.0';
import { withBotFixture } from './bot_fixture.ts';

// A 2×1 GIF image, which the emulator accepts as a photo.
const CAT_PICTURE = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 2, 0, 1, 0, 0, 0, 0]);

Deno.test('a bot restricted to text is refused photos until the restriction ends', () =>
  withBotFixture({
    handlers: (bot) => {
      bot.command('cat', async (ctx) => {
        const reply_parameters = { message_id: ctx.msg.message_id };
        try {
          await ctx.replyWithPhoto(new InputFile(CAT_PICTURE, 'cat.gif'), { reply_parameters });
        } catch (error) {
          if (!(error instanceof GrammyError)) throw error;
          await ctx.reply('No pictures allowed here.', { reply_parameters });
        }
      });
    },
  }, async ({ session, botProfile, account, activity }) => {
    const supergroup = await account.createSupergroup({ title: 'Team' });
    const groupChat = { type: 'supergroup', chatId: supergroup.id } as const;
    await account.addChatMember({ chat: groupChat, userId: botProfile.id });
    const oneHourFromNow = Math.floor(Date.now() / 1_000) + 3_600;
    await account.restrictChatMember({
      chat: groupChat,
      userId: botProfile.id,
      permissions: { can_send_messages: true },
      untilDate: oneHourFromNow,
    });

    const beforeRestrictedRequest = await activity.position();
    const restrictedRequest = await account.sendMessage({ to: groupChat, text: '/cat@test_bot' });
    const repliesTo = (message_id: number) => JSON.stringify({ message_id });
    const refusedPhoto = await activity.waitFor({
      method: 'sendPhoto',
      chat_id: supergroup.id,
      parameters: { reply_parameters: repliesTo(restrictedRequest.message_id) },
    }, { after: beforeRestrictedRequest });
    assertEquals(refusedPhoto.answer, {
      ok: false,
      error_code: 400,
      description: 'Bad Request: not enough rights to send photos to the chat',
    });
    await activity.waitFor({
      method: 'sendMessage',
      chat_id: supergroup.id,
      ok: true,
      parameters: {
        text: 'No pictures allowed here.',
        reply_parameters: repliesTo(restrictedRequest.message_id),
      },
    }, { after: refusedPhoto });

    const standing = await session.expireChatMemberRestriction({
      chatId: supergroup.id,
      userId: botProfile.id,
    });
    assertEquals(standing, 'member');

    const beforeRequest = await activity.position();
    const request = await account.sendMessage({ to: groupChat, text: '/cat@test_bot' });
    await activity.waitFor({
      method: 'sendPhoto',
      chat_id: supergroup.id,
      ok: true,
      parameters: { reply_parameters: repliesTo(request.message_id) },
    }, { after: beforeRequest });
    const photo = (await account.getMessages({ chat: groupChat })).find((message) =>
      message.from.id === botProfile.id &&
      message.reply_to_message?.message_id === request.message_id
    );
    assertExists(photo?.photo);
  }));
```

A restriction without `untilDate` lasts until the owner lifts it with
`account.liftChatMemberRestriction`. An account's message that its restriction withholds is refused
with status 403, so the supergroup's bots never receive it.

```ts
import { assertEquals, assertRejects } from 'jsr:@std/assert@^1';
import { EmulationClientError } from '../../../clients/typescript/mod.ts';
import { withBotFixture } from './bot_fixture.ts';

Deno.test('a muted member is heard again once the owner lifts the restriction', () =>
  withBotFixture({
    bot: { can_read_all_group_messages: true },
    handlers: (bot) => {
      bot.on('message:text', (ctx) =>
        ctx.reply(`Noted, ${ctx.from.first_name}.`, {
          reply_parameters: { message_id: ctx.msg.message_id },
        }));
    },
  }, async ({ session, botProfile, account, activity }) => {
    const supergroup = await account.createSupergroup({ title: 'Team' });
    const groupChat = { type: 'supergroup', chatId: supergroup.id } as const;
    await account.addChatMember({ chat: groupChat, userId: botProfile.id });
    const { account: grace } = await session.createAccount({ first_name: 'Grace' });
    await account.addChatMember({ chat: groupChat, userId: grace.id });

    await account.restrictChatMember({ chat: groupChat, userId: grace.id, permissions: {} });
    const refusal = await assertRejects(
      () => grace.sendMessage({ to: groupChat, text: 'Can anyone hear me?' }),
      EmulationClientError,
    );
    assertEquals(refusal.status, 403);

    await account.liftChatMemberRestriction({ chat: groupChat, userId: grace.id });
    const beforeSending = await activity.position();
    const message = await grace.sendMessage({ to: groupChat, text: 'Can anyone hear me now?' });
    const reply = await activity.waitFor({
      method: 'sendMessage',
      chat_id: supergroup.id,
      ok: true,
      parameters: { reply_parameters: JSON.stringify({ message_id: message.message_id }) },
    }, { after: beforeSending });
    assertEquals(reply.parameters.text, 'Noted, Grace.');
  }));
```

## Default permissions

`account.setChatPermissions` sets what members may do by default, as the owner or an administrator
with `can_restrict_members`. Members, bots included, are then refused what the defaults withhold,
while the owner and administrators are exempt. No bot receives an update for the change; bots read
the defaults as `permissions` in `getChat`.
[Default permissions](../../features/supergroups.md#default-permissions) describes the Bot API's
`setChatPermissions` as well.

```ts
import { assertEquals, assertRejects } from 'jsr:@std/assert@^1';
import { EmulationClientError } from '../../../clients/typescript/mod.ts';
import { withBotFixture } from './bot_fixture.ts';

// A 2×1 GIF image, which the emulator accepts as a photo.
const PICTURE = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 2, 0, 1, 0, 0, 0, 0]);

Deno.test('text-only defaults bind members but not the owner or administrators', () =>
  withBotFixture({
    handlers: (bot) => {
      bot.command('rules', async (ctx) => {
        const { permissions } = await ctx.getChat();
        await ctx.reply(permissions?.can_send_photos ? 'Photos welcome.' : 'Text only, please.', {
          reply_parameters: { message_id: ctx.msg.message_id },
        });
      });
    },
  }, async ({ session, botProfile, account, activity }) => {
    const supergroup = await account.createSupergroup({ title: 'Team' });
    const groupChat = { type: 'supergroup', chatId: supergroup.id } as const;
    await account.addChatMember({ chat: groupChat, userId: botProfile.id });
    const { account: grace } = await session.createAccount({ first_name: 'Grace' });
    await account.addChatMember({ chat: groupChat, userId: grace.id });

    await account.setChatPermissions({
      chat: groupChat,
      permissions: { can_send_messages: true },
    });

    const beforeAsking = await activity.position();
    const question = await grace.sendMessage({ to: groupChat, text: '/rules@test_bot' });
    const answer = await activity.waitFor({
      method: 'sendMessage',
      chat_id: supergroup.id,
      ok: true,
      parameters: { reply_parameters: JSON.stringify({ message_id: question.message_id }) },
    }, { after: beforeAsking });
    assertEquals(answer.parameters.text, 'Text only, please.');

    const refusal = await assertRejects(
      () => grace.sendPhoto({ to: groupChat, photo: PICTURE }),
      EmulationClientError,
    );
    assertEquals(refusal.status, 403);
    await account.sendPhoto({ to: groupChat, photo: PICTURE, caption: 'The owner is exempt' });

    await account.promoteChatMember({
      chat: groupChat,
      userId: grace.id,
      rights: { can_pin_messages: true },
    });
    const adminPhoto = await grace.sendPhoto({ to: groupChat, photo: PICTURE });
    assertEquals(adminPhoto.from.id, grace.id);
  }));
```
