# Media and files

[Guide index](README.md) · [Feature reference: Media and files](../../features/media-and-files.md)

This page shows how an account sends photos, documents, videos, voice notes, audio files and albums
to a bot, and how a test reads the files the bot sends back. The examples use the
[shared fixture](sessions-and-fixtures.md) and the [waiting pattern](observing-bot-behavior.md).

Accounts upload bytes, so examples inline their fixtures. The emulator reads the header of a photo
to find its dimensions and keeps the bytes unchanged, so a 13-byte GIF is a valid photo. It never
reads the content of videos, voice notes and audio files, so any non-empty bytes do for those.

## Replying to a photo with a document

`account.sendPhoto` sends a photo with an optional caption and returns the account's message, whose
`photo` shows the dimensions the emulator read. The bot receives an ordinary `message` update.

The bot below answers a photo by replying with a document. The account's send returns once the bot
can receive the photo, not once it has replied, so the latest message in the chat may still be the
upload. The test waits for the `sendDocument` call that replies to this photo, then selects the
reply by the message it replies to. `session.downloadFile(file_unique_id)` reads the bytes of any
file in the session, including the ones bots send; it is an emulation API convenience, not a
Telegram API.

```ts
import { assertEquals, assertExists } from 'jsr:@std/assert@1.0.19';
import { InputFile } from 'npm:grammy@1.46.0';
import { withBotFixture } from './bot_fixture.ts';

/** A 2×1 GIF, small enough to spell out and an image the emulator reads dimensions from. */
const RECEIPT_IMAGE = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 2, 0, 1, 0, 0, 0, 0]);
const PROCESSED_RECEIPT = new TextEncoder().encode('Receipt total: 12.50');

Deno.test('the bot replies to a photo with a document', async () => {
  await withBotFixture({
    handlers: (bot) => {
      bot.on('message:photo', async (ctx) => {
        await ctx.replyWithDocument(new InputFile(PROCESSED_RECEIPT, 'receipt.txt'), {
          reply_parameters: { message_id: ctx.msg.message_id },
        });
      });
    },
  }, async ({ session, botProfile, account, privateChat, activity }) => {
    const beforePhoto = await activity.position();
    const photo = await account.sendPhoto({
      to: privateChat,
      photo: RECEIPT_IMAGE,
      caption: 'My receipt',
    });
    assertEquals(photo.photo?.map(({ width, height }) => ({ width, height })), [
      { width: 2, height: 1 },
    ]);

    await activity.waitFor(
      {
        method: 'sendDocument',
        chat_id: account.id,
        ok: true,
        parameters: { reply_parameters: JSON.stringify({ message_id: photo.message_id }) },
      },
      { after: beforePhoto },
    );
    const photoReply = (await account.getMessages({ chat: privateChat })).find(
      ({ from, reply_to_message, document }) =>
        from.id === botProfile.id && reply_to_message?.message_id === photo.message_id &&
        document !== undefined,
    );
    assertExists(photoReply?.document);
    assertEquals(photoReply.document.file_name, 'receipt.txt');

    const replyContent = await session.downloadFile(photoReply.document.file_unique_id);
    assertEquals(replyContent, PROCESSED_RECEIPT);
  });
});
```

## Documents

`account.sendDocument` uploads any non-empty bytes under a file name, whose extension decides the
MIME type the bot sees. The
[feature reference](../../features/media-and-files.md#supported-behavior) describes names, types and
thumbnails.

```ts
import { assertEquals, assertExists } from 'jsr:@std/assert@1.0.19';
import { withBotFixture } from './bot_fixture.ts';

Deno.test('the bot sees the name and type of a document', async () => {
  await withBotFixture({
    handlers: (bot) => {
      bot.on('message:document', async (ctx) => {
        const { file_name, mime_type } = ctx.msg.document;
        await ctx.reply(`Received ${file_name} (${mime_type})`, {
          reply_parameters: { message_id: ctx.msg.message_id },
        });
      });
    },
  }, async ({ botProfile, account, privateChat, activity }) => {
    const beforeDocument = await activity.position();
    const notes = await account.sendDocument({
      to: privateChat,
      document: new TextEncoder().encode('Remember the milk'),
      file_name: 'notes.txt',
    });

    await activity.waitFor(
      {
        method: 'sendMessage',
        chat_id: account.id,
        ok: true,
        parameters: { reply_parameters: JSON.stringify({ message_id: notes.message_id }) },
      },
      { after: beforeDocument },
    );
    const reply = (await account.getMessages({ chat: privateChat })).find(
      ({ from, reply_to_message }) =>
        from.id === botProfile.id && reply_to_message?.message_id === notes.message_id,
    );
    assertExists(reply);
    assertEquals(reply.text, 'Received notes.txt (text/plain)');
  });
});
```

## Videos and voice notes

`account.sendVideo` and `account.sendVoice` send a video and a voice note. Their duration, and a
video's width and height, are what the input says: the emulator never reads the content, so the bot
sees exactly those values, as
[sender-defined media attributes](../../features/media-and-files.md#sender-defined-media-attributes)
explains. The placeholder bytes below are not a real video or recording. See
[videos](../../features/media-and-files.md#videos) and
[voice notes](../../features/media-and-files.md#voice-notes) for ranges, defaults and MIME types.

```ts
import { assertEquals } from 'jsr:@std/assert@1.0.19';
import { withBotFixture } from './bot_fixture.ts';

/** Placeholder content: the emulator stores video and voice bytes without reading them. */
const PLACEHOLDER_MEDIA = new TextEncoder().encode('not really media');

Deno.test('the bot sees the duration and dimensions the account gives', async () => {
  await withBotFixture({
    handlers: (bot) => {
      bot.on('message:video', async (ctx) => {
        const { duration, width, height } = ctx.msg.video;
        await ctx.reply(`Video: ${duration}s at ${width}×${height}`, {
          reply_parameters: { message_id: ctx.msg.message_id },
        });
      });
      bot.on('message:voice', async (ctx) => {
        await ctx.reply(`Voice note: ${ctx.msg.voice.duration}s`, {
          reply_parameters: { message_id: ctx.msg.message_id },
        });
      });
    },
  }, async ({ botProfile, account, privateChat, activity }) => {
    const replyTo = async (messageId: number, after: number) => {
      await activity.waitFor(
        {
          method: 'sendMessage',
          chat_id: account.id,
          ok: true,
          parameters: { reply_parameters: JSON.stringify({ message_id: messageId }) },
        },
        { after },
      );
      return (await account.getMessages({ chat: privateChat })).find(
        ({ from, reply_to_message }) =>
          from.id === botProfile.id && reply_to_message?.message_id === messageId,
      )?.text;
    };

    const beforeVideo = await activity.position();
    const clip = await account.sendVideo({
      to: privateChat,
      video: PLACEHOLDER_MEDIA,
      file_name: 'clip.mp4',
      duration: 12,
      width: 1280,
      height: 720,
    });
    assertEquals(clip.video?.mime_type, 'video/mp4');
    assertEquals(await replyTo(clip.message_id, beforeVideo), 'Video: 12s at 1280×720');

    const beforeVoice = await activity.position();
    const memo = await account.sendVoice({
      to: privateChat,
      voice: PLACEHOLDER_MEDIA,
      duration: 3,
    });
    assertEquals(await replyTo(memo.message_id, beforeVoice), 'Voice note: 3s');
  });
});
```

## Audio files

`account.sendAudio` sends an audio file, such as a music track, with the duration, performer and
title the input gives; the emulator reads no tags from the bytes. A file sent again by its `file_id`
keeps that metadata, whatever the sending call says, so the bot below can answer with the account's
own track. See [audio files](../../features/media-and-files.md#audio-files) for MIME types,
thumbnails and files sent by URL.

```ts
import { assertEquals } from 'jsr:@std/assert@1.0.19';
import { withBotFixture } from './bot_fixture.ts';

/** Placeholder content: the emulator stores audio bytes without reading them. */
const PLACEHOLDER_TRACK = new TextEncoder().encode('not really a track');

Deno.test('the bot sends a track back with the metadata the account gave it', async () => {
  await withBotFixture({
    handlers: (bot) => {
      bot.on('message:audio', async (ctx) => {
        await ctx.replyWithAudio(ctx.msg.audio.file_id, {
          caption: `Now playing: ${ctx.msg.audio.performer} – ${ctx.msg.audio.title}`,
          reply_parameters: { message_id: ctx.msg.message_id },
        });
      });
    },
  }, async ({ botProfile, account, privateChat, activity }) => {
    const beforeTrack = await activity.position();
    const track = await account.sendAudio({
      to: privateChat,
      audio: PLACEHOLDER_TRACK,
      file_name: 'engines.mp3',
      duration: 215,
      performer: 'Ada',
      title: 'Engines',
    });
    assertEquals(track.audio?.mime_type, 'audio/mpeg');
    await activity.waitFor(
      {
        method: 'sendAudio',
        chat_id: account.id,
        ok: true,
        parameters: { reply_parameters: JSON.stringify({ message_id: track.message_id }) },
      },
      { after: beforeTrack },
    );

    const reply = (await account.getMessages({ chat: privateChat })).find(
      ({ from, reply_to_message }) =>
        from.id === botProfile.id && reply_to_message?.message_id === track.message_id,
    );
    assertEquals(reply?.caption, 'Now playing: Ada – Engines');
    assertEquals(reply?.audio?.file_unique_id, track.audio?.file_unique_id);
    assertEquals(reply?.audio?.duration, 215);
  });
});
```

## Albums

`account.sendMediaGroup` sends photos and videos, documents, or audio files, as an album and returns
its messages in order. They share a `media_group_id`, each item has its own caption, and the bot
receives each item as a separate `message` update. The
[albums](../../features/media-and-files.md#albums) section describes which media mix and the limits
on an album.

The bot below replies to every photo with the album it belongs to, so the test waits for one reply
per album message.

```ts
import { assertEquals, assertExists } from 'jsr:@std/assert@1.0.19';
import { withBotFixture } from './bot_fixture.ts';

const RECEIPT_IMAGE = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 2, 0, 1, 0, 0, 0, 0]);

Deno.test('the bot receives each album item as an update in the same media group', async () => {
  await withBotFixture({
    handlers: (bot) => {
      bot.on('message:photo', async (ctx) => {
        await ctx.reply(`Album ${ctx.msg.media_group_id ?? 'none'}`, {
          reply_parameters: { message_id: ctx.msg.message_id },
        });
      });
    },
  }, async ({ botProfile, account, privateChat, activity }) => {
    const beforeAlbum = await activity.position();
    const album = await account.sendMediaGroup({
      to: privateChat,
      media: [{ photo: RECEIPT_IMAGE, caption: 'Both copies' }, { photo: RECEIPT_IMAGE }],
    });
    assertEquals(album.length, 2);
    const mediaGroupId = album[0].media_group_id;
    assertExists(mediaGroupId);
    assertEquals(album[1].media_group_id, mediaGroupId);

    await Promise.all(album.map(({ message_id }) =>
      activity.waitFor(
        {
          method: 'sendMessage',
          chat_id: account.id,
          ok: true,
          parameters: { reply_parameters: JSON.stringify({ message_id }) },
        },
        { after: beforeAlbum },
      )
    ));
    const history = await account.getMessages({ chat: privateChat });
    for (const item of album) {
      const reply = history.find(({ from, reply_to_message }) =>
        from.id === botProfile.id && reply_to_message?.message_id === item.message_id
      );
      assertEquals(reply?.text, `Album ${mediaGroupId}`);
    }
  });
});
```

## Editing a caption

`account.editMessageCaption` changes the caption of a photo, document, video, voice note or audio
file the account sent, and the bot receives an `edited_message` update. [Messages](messages.md)
covers editing in general.

```ts
import { assertEquals } from 'jsr:@std/assert@1.0.19';
import { withBotFixture } from './bot_fixture.ts';

const RECEIPT_IMAGE = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 2, 0, 1, 0, 0, 0, 0]);

Deno.test('the bot sees an edited caption', async () => {
  await withBotFixture({
    handlers: (bot) => {
      bot.on('edited_message:caption', async (ctx) => {
        await ctx.reply(`Caption is now: ${ctx.editedMessage.caption}`);
      });
    },
  }, async ({ account, privateChat, activity }) => {
    const photo = await account.sendPhoto({
      to: privateChat,
      photo: RECEIPT_IMAGE,
      caption: 'My receipt',
    });

    const beforeEdit = await activity.position();
    const edited = await account.editMessageCaption({
      chat: privateChat,
      message_id: photo.message_id,
      caption: 'My corrected receipt',
    });
    assertEquals(edited.caption, 'My corrected receipt');
    await activity.waitFor(
      {
        method: 'sendMessage',
        chat_id: account.id,
        ok: true,
        parameters: { text: 'Caption is now: My corrected receipt' },
      },
      { after: beforeEdit },
    );
  });
});
```

## Files the bot sends by URL

A bot may send a file as an HTTP URL, which Telegram downloads. The emulator never reaches the
network: it downloads the URL from the session's emulated web, where `session.registerWebResource`
registers what each URL serves. A URL without a resource is unreachable, and the bot's call fails.
The [files sent by URL](../../features/media-and-files.md#files-sent-by-url) section describes the
content types and errors each method expects; [test controls](test-controls.md) covers this and the
session's other controls, such as the `upload_profile` that limits the size of bot uploads.

```ts
import { assertEquals, assertExists } from 'jsr:@std/assert@1.0.19';
import { withBotFixture } from './bot_fixture.ts';

const RECEIPT_IMAGE = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 2, 0, 1, 0, 0, 0, 0]);
const RECEIPT_URL = 'https://receipts.example/latest.gif';

Deno.test('the bot sends a photo by URL', async () => {
  await withBotFixture({
    handlers: (bot) => {
      bot.command('receipt', async (ctx) => {
        await ctx.replyWithPhoto(RECEIPT_URL, {
          reply_parameters: { message_id: ctx.msg.message_id },
        });
      });
    },
  }, async ({ session, botProfile, account, privateChat, activity }) => {
    await session.registerWebResource({
      url: RECEIPT_URL,
      content_type: 'image/gif',
      content: RECEIPT_IMAGE,
    });

    const beforeCommand = await activity.position();
    const command = await account.sendMessage({ to: privateChat, text: '/receipt' });
    await activity.waitFor(
      {
        method: 'sendPhoto',
        chat_id: account.id,
        ok: true,
        parameters: { reply_parameters: JSON.stringify({ message_id: command.message_id }) },
      },
      { after: beforeCommand },
    );
    const reply = (await account.getMessages({ chat: privateChat })).find(
      ({ from, reply_to_message, photo }) =>
        from.id === botProfile.id && reply_to_message?.message_id === command.message_id &&
        photo !== undefined,
    );
    const largestPhoto = reply?.photo?.at(-1);
    assertExists(largestPhoto);

    const downloaded = await session.downloadFile(largestPhoto.file_unique_id);
    assertEquals(downloaded, RECEIPT_IMAGE);
  });
});
```
