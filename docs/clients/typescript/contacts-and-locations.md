# Contacts and locations

[Guide index](README.md) ·
[Feature reference: Contacts and locations](../../features/contacts-and-locations.md)

This page shows how an account shares contacts and static locations with a bot, both directly and by
pressing the bot's `request_contact` and `request_location` keyboard buttons. The examples use the
[shared fixture](sessions-and-fixtures.md) and the [waiting pattern](observing-bot-behavior.md).

## Sending a contact

`account.sendContact` sends a contact the account writes: a phone number, in any form, a first name,
and optionally a last name and vCard. The bot receives an ordinary `message` with a `contact` that
names no Telegram user, even when the number belongs to an account;
[whose contact it is](../../features/contacts-and-locations.md#whose-contact-it-is) explains why.

```ts
import { assertEquals } from 'jsr:@std/assert@^1';
import { withBotFixture } from './bot_fixture.ts';

Deno.test('a written contact names no user', async () => {
  await withBotFixture({
    handlers: (bot) => {
      bot.on('message:contact', async (ctx) => {
        const { first_name, phone_number, user_id } = ctx.msg.contact;
        await ctx.reply(`${first_name}: ${phone_number}, user ${user_id ?? 'unknown'}`, {
          reply_parameters: { message_id: ctx.msg.message_id },
        });
      });
    },
  }, async ({ botProfile, account, privateChat, activity }) => {
    const beforeContact = await activity.position();
    const contact = await account.sendContact({
      to: privateChat,
      contact: { phone_number: '+1 555 0199', first_name: 'Grace', last_name: 'Hopper' },
    });
    assertEquals(contact.contact?.user_id, undefined);

    await activity.waitFor(
      {
        method: 'sendMessage',
        chat_id: account.id,
        ok: true,
        parameters: { reply_parameters: JSON.stringify({ message_id: contact.message_id }) },
      },
      { after: beforeContact },
    );
    const reply = (await account.getMessages({ chat: privateChat })).find(
      ({ from, reply_to_message }) =>
        from.id === botProfile.id && reply_to_message?.message_id === contact.message_id,
    );
    assertEquals(reply?.text, 'Grace: +1 555 0199, user unknown');
  });
});
```

## Sharing the account's own contact

An account created with a `phone_number`, the digits of an E.164 number without its `+`, has a
contact of its own. `account.shareOwnContact` shares it: the contact shows that number, the
account's name, and the account's ID as its `user_id`, so a bot can verify that a user shared their
own number by comparing `contact.user_id` with `from.id`. For an account created without a phone
number, `shareOwnContact` fails and sends nothing.

```ts
import { assertEquals } from 'jsr:@std/assert@^1';
import { withBotFixture } from './bot_fixture.ts';

Deno.test('the bot verifies an account that shares its own contact', async () => {
  await withBotFixture({
    account: { phone_number: '15550100' },
    handlers: (bot) => {
      bot.on('message:contact', async (ctx) => {
        const verified = ctx.msg.contact.user_id === ctx.from.id;
        await ctx.reply(verified ? `Verified ${ctx.msg.contact.phone_number}` : 'Not your number', {
          reply_parameters: { message_id: ctx.msg.message_id },
        });
      });
    },
  }, async ({ botProfile, account, privateChat, activity }) => {
    const beforeContact = await activity.position();
    const contact = await account.shareOwnContact({ to: privateChat });
    assertEquals(contact.contact?.user_id, account.id);

    await activity.waitFor(
      {
        method: 'sendMessage',
        chat_id: account.id,
        ok: true,
        parameters: { reply_parameters: JSON.stringify({ message_id: contact.message_id }) },
      },
      { after: beforeContact },
    );
    const reply = (await account.getMessages({ chat: privateChat })).find(
      ({ from, reply_to_message }) =>
        from.id === botProfile.id && reply_to_message?.message_id === contact.message_id,
    );
    assertEquals(reply?.text, 'Verified 15550100');
  });
});
```

## Sending a location

`account.sendLocation` shares a static location: a latitude, a longitude, and optionally a
horizontal accuracy in meters, which Telegram keeps in whole meters, rounded up. Live locations are
[not supported](../../features/contacts-and-locations.md#static-locations-only); the
[locations](../../features/contacts-and-locations.md#locations) section describes the accepted
ranges.

```ts
import { assertEquals } from 'jsr:@std/assert@^1';
import { withBotFixture } from './bot_fixture.ts';

Deno.test('the bot receives a static location', async () => {
  await withBotFixture({
    handlers: (bot) => {
      bot.on('message:location', async (ctx) => {
        const { latitude, longitude, horizontal_accuracy } = ctx.msg.location;
        await ctx.reply(`At ${latitude}, ${longitude} within ${horizontal_accuracy} m`, {
          reply_parameters: { message_id: ctx.msg.message_id },
        });
      });
    },
  }, async ({ botProfile, account, privateChat, activity }) => {
    const beforeLocation = await activity.position();
    const location = await account.sendLocation({
      to: privateChat,
      location: { latitude: 51.5007, longitude: -0.1246, horizontal_accuracy: 12.2 },
    });
    assertEquals(location.location?.horizontal_accuracy, 13);

    await activity.waitFor(
      {
        method: 'sendMessage',
        chat_id: account.id,
        ok: true,
        parameters: { reply_parameters: JSON.stringify({ message_id: location.message_id }) },
      },
      { after: beforeLocation },
    );
    const reply = (await account.getMessages({ chat: privateChat })).find(
      ({ from, reply_to_message }) =>
        from.id === botProfile.id && reply_to_message?.message_id === location.message_id,
    );
    assertEquals(reply?.text, 'At 51.5007, -0.1246 within 13 m');
  });
});
```

## Pressing contact and location request buttons

A reply keyboard button with `request_contact` or `request_location` asks the client for the user's
phone number or location. `account.pressReplyKeyboardButton` presses one by its text:

- A `request_contact` button shares the account's own contact, so the account needs a
  `phone_number`.
- A `request_location` button shares the `location` the press reports, since the emulator has no
  device location.

Either message replies to the keyboard's message, and the bot receives it as an ordinary contact or
location message. Request buttons appear only in private chats. See
[answering contact requests](../../features/contacts-and-locations.md#answering-contact-requests)
and
[answering location requests](../../features/contacts-and-locations.md#answering-location-requests)
for the details, and [Buttons and menus](buttons-and-menus.md) for reply keyboards in general.

```ts
import { assertEquals, assertExists } from 'jsr:@std/assert@^1';
import { Keyboard } from 'npm:grammy@^1.46.0';
import { withBotFixture } from './bot_fixture.ts';

Deno.test('request buttons share the contact and location the bot asks for', async () => {
  await withBotFixture({
    account: { phone_number: '15550100' },
    handlers: (bot) => {
      bot.command('start', async (ctx) => {
        const keyboard = new Keyboard()
          .requestContact('Share phone number')
          .requestLocation('Share location');
        await ctx.reply('Where should we deliver?', {
          reply_markup: keyboard,
          reply_parameters: { message_id: ctx.msg.message_id },
        });
      });
      bot.on('message:contact', async (ctx) => {
        await ctx.reply(`Phone: ${ctx.msg.contact.phone_number}`, {
          reply_parameters: { message_id: ctx.msg.message_id },
        });
      });
      bot.on('message:location', async (ctx) => {
        await ctx.reply(`Location: ${ctx.msg.location.latitude}, ${ctx.msg.location.longitude}`, {
          reply_parameters: { message_id: ctx.msg.message_id },
        });
      });
    },
  }, async ({ botProfile, account, privateChat, activity }) => {
    const botReplyTo = async (messageId: number, after: number) => {
      await activity.waitFor(
        {
          method: 'sendMessage',
          chat_id: account.id,
          ok: true,
          parameters: { reply_parameters: JSON.stringify({ message_id: messageId }) },
        },
        { after },
      );
      const reply = (await account.getMessages({ chat: privateChat })).find(
        ({ from, reply_to_message }) =>
          from.id === botProfile.id && reply_to_message?.message_id === messageId,
      );
      assertExists(reply);
      return reply;
    };

    const beforeStart = await activity.position();
    const start = await account.sendMessage({ to: privateChat, text: '/start' });
    const keyboardMessage = await botReplyTo(start.message_id, beforeStart);

    const beforeContact = await activity.position();
    const contact = await account.pressReplyKeyboardButton({
      chat: privateChat,
      text: 'Share phone number',
    });
    assertEquals(contact.reply_to_message?.message_id, keyboardMessage.message_id);
    assertEquals(contact.contact?.user_id, account.id);
    assertEquals((await botReplyTo(contact.message_id, beforeContact)).text, 'Phone: 15550100');

    const beforeLocation = await activity.position();
    const location = await account.pressReplyKeyboardButton({
      chat: privateChat,
      text: 'Share location',
      location: { latitude: 51.5007, longitude: -0.1246 },
    });
    assertEquals(location.reply_to_message?.message_id, keyboardMessage.message_id);
    assertEquals(
      (await botReplyTo(location.message_id, beforeLocation)).text,
      'Location: 51.5007, -0.1246',
    );
  });
});
```
