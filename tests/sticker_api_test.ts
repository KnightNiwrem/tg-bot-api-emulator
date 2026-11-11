import { assertEquals, assertExists, assertNotEquals } from '@std/assert';
import { Bot } from 'https://cdn.jsdelivr.net/gh/grammyjs/grammY@^1.46.0/src/bot.ts';

import {
  EmulationControlError,
  type EmulationSessionClient,
  type PrivateMessageTarget,
  type SupergroupMessageTarget,
  type VirtualAccountClient,
} from '../clients/typescript/mod.ts';
import { createTestInProcessEmulator } from './support/emulation_api.ts';
import {
  gifImage,
  staticWebpSticker,
  vp8lBitstream,
  VP8X_ANIMATION_FLAG,
  vp8xHeader,
  webpChunk,
  webpFile,
} from './support/media_samples.ts';

/** A sticker smaller than Telegram's sticker sets allow, which the emulator accepts as it is. */
const STICKER = staticWebpSticker(96, 64);

const ANIMATED_STICKER = webpFile([
  webpChunk('VP8X', vp8xHeader(64, 64, { flags: VP8X_ANIMATION_FLAG })),
  webpChunk('VP8L', vp8lBitstream(64, 64)),
]);

interface BotApiAnswer {
  readonly ok: boolean;
  readonly result?: Record<string, unknown> & {
    readonly sticker?: Record<string, unknown>;
    readonly file_path?: string;
  };
  readonly description?: string;
}

interface StickerSessionBot {
  readonly id: number;
  readonly token: string;
}

Deno.test('a grammY bot learns the sticker an account sends and resends it on command', async () => {
  await using emulator = createTestInProcessEmulator();
  const { result: session } = await emulator.client.createSession();
  const { result: { token, bot: botProfile } } = await session.createBot({
    first_name: 'Sticker Keeper',
    username: 'sticker_keeper_bot',
  });
  const { result: { account: ada } } = await session.createAccount({ first_name: 'Ada' });
  const privateChat: PrivateMessageTarget = { type: 'private', botId: botProfile.id };

  // The bot learns a sticker only from the updates it receives, one per chat.
  const learnedStickers = new Map<number, string>();
  const bot = new Bot(token, { client: { apiRoot: session.botApiRoot, fetch: emulator.fetch } });
  bot.on('message:sticker', async (context) => {
    learnedStickers.set(context.chat.id, context.msg.sticker.file_id);
    await context.reply(`Learned ${context.msg.sticker.emoji ?? 'a sticker'}`, {
      reply_parameters: { message_id: context.msg.message_id },
    });
  });
  bot.command('sticker', async (context) => {
    const fileId = learnedStickers.get(context.chat.id);
    const replyParameters = { reply_parameters: { message_id: context.msg.message_id } };
    await (fileId === undefined
      ? context.reply('Send me a sticker first', replyParameters)
      : context.replyWithSticker(fileId, { emoji: '🎉', ...replyParameters }));
  });
  const polling = bot.start();
  polling.catch(() => {});

  try {
    const activity = session.botActivity({ bot_id: botProfile.id });
    const { result: stickerMessage, receipt: stickerReceipt } = await ada.sendSticker({
      to: privateChat,
      sticker: STICKER,
      emoji: '🧪',
    });
    await activity.waitFor({
      method: 'sendMessage',
      ok: true,
      parameters_json: { reply_parameters: { message_id: stickerMessage.message_id } },
    }, { after: stickerReceipt });

    const { result: command, receipt: commandReceipt } = await ada.sendMessage({
      to: privateChat,
      text: '/sticker',
    });
    await activity.waitFor({
      method: 'sendSticker',
      ok: true,
      parameters_json: { reply_parameters: { message_id: command.message_id } },
    }, { after: commandReceipt });

    const history = await ada.getMessages({ chat: privateChat });
    const acknowledgement = history.find(({ reply_to_message }) =>
      reply_to_message?.message_id === stickerMessage.message_id
    );
    const resent = history.find(({ reply_to_message }) =>
      reply_to_message?.message_id === command.message_id
    );
    assertEquals(
      acknowledgement?.text,
      'Learned 🧪',
      'Expected the bot to acknowledge the sticker',
    );
    assertEquals(resent?.from.id, botProfile.id, 'Expected the bot to resend the sticker');
    assertEquals(stickerMessage.caption, undefined, 'Expected a sticker without a caption');
    const original = stickerMessage.sticker;
    assertExists(original);
    // The bot's own message shows the same stored sticker, with its stored emoji.
    assertEquals(resent?.sticker, {
      width: 96,
      height: 64,
      emoji: '🧪',
      is_animated: false,
      is_video: false,
      type: 'regular',
      file_id: original.file_id,
      file_unique_id: original.file_unique_id,
      file_size: STICKER.length,
    });
    assertEquals(resent?.caption, undefined, 'Expected the resent sticker without a caption');

    const file = await bot.api.getFile(original.file_id);
    assertEquals(file.file_path, 'stickers/file_0.webp');
    const download = await emulator.fetch(
      `${session.botApiRoot}/file/bot${token}/${file.file_path}`,
    );
    assertEquals(download.headers.get('Content-Type'), 'image/webp');
    assertEquals(new Uint8Array(await download.arrayBuffer()), STICKER, 'Expected the exact bytes');
  } finally {
    await bot.stop();
    await polling;
  }
});

Deno.test('each bot reuses a sticker only by the file_id it knows it by', async () => {
  await using fixture = await createStickerSupergroupFixture();
  const { fetch, ada, group, keeper, reader, callBot, readStickerUpdate } = fixture;
  const { result: sent } = await ada.sendSticker({ to: group, sticker: STICKER, emoji: '🧪' });
  const keeperSticker = await readStickerUpdate(keeper);
  const readerSticker = await readStickerUpdate(reader);
  const adaFileId = sent.sticker?.file_id;
  assertExists(adaFileId);

  assertNotEquals(keeperSticker.file_id, readerSticker.file_id, 'Expected a file_id per observer');
  assertEquals(
    [keeperSticker.file_unique_id, readerSticker.file_unique_id],
    Array(2).fill(sent.sticker?.file_unique_id),
    'Expected every observer to share the file_unique_id',
  );
  for (const [stickerBot, sticker] of [[keeper, keeperSticker], [reader, readerSticker]] as const) {
    const answer = await callBot(stickerBot, 'sendSticker', {
      chat_id: group.chatId,
      sticker: sticker.file_id,
      emoji: '🎉',
    });
    assertEquals(
      answer.result?.sticker,
      { ...sticker },
      `Expected bot ${stickerBot.id} to resend the sticker, keeping its emoji`,
    );
  }

  // Ada has sent a photo, whose file_id is of another type.
  await ada.sendPhoto({ to: group, photo: gifImage(10, 10) });
  const photoFileId = await readPhotoFileId(fixture, keeper);
  const { result: otherSession } = await fixture.emulator.client.createSession();
  const otherSessionCaller = createBotApiCaller(otherSession, fetch);
  const { result: otherBot } = await otherSession.createBot({
    first_name: 'Elsewhere',
    username: 'elsewhere_bot',
  });
  const { result: { account: otherAccount } } = await otherSession.createAccount({
    first_name: 'Linus',
  });
  await otherAccount.sendMessage({ to: { type: 'private', botId: otherBot.bot.id }, text: 'Hi' });
  const historyBefore = await ada.getMessages({ chat: group });

  const refusals = [
    await callBot(keeper, 'sendSticker', { chat_id: group.chatId, sticker: readerSticker.file_id }),
    await callBot(keeper, 'sendSticker', { chat_id: group.chatId, sticker: adaFileId }),
    await callBot(keeper, 'sendSticker', {
      chat_id: group.chatId,
      sticker: keeperSticker.file_unique_id,
    }),
    await callBot(keeper, 'sendSticker', { chat_id: group.chatId, sticker: 'AgADBAADUnknownId' }),
    await otherSessionCaller({ id: otherBot.bot.id, token: otherBot.token }, 'sendSticker', {
      chat_id: otherAccount.id,
      sticker: keeperSticker.file_id,
    }),
    await callBot(keeper, 'sendSticker', { chat_id: group.chatId, sticker: photoFileId }),
  ];
  assertEquals(
    refusals.map(({ ok, description }) => ({ ok, description })),
    [
      ...Array(5).fill({
        ok: false,
        description: 'Bad Request: wrong file identifier/HTTP URL specified',
      }),
      { ok: false, description: "Bad Request: can't use file of type Photo as Sticker" },
    ],
    'Expected only the bot’s own sticker file_id to send a sticker',
  );
  assertEquals(
    await ada.getMessages({ chat: group }),
    historyBefore,
    'Expected refused sends to leave no message',
  );
});

Deno.test('sendSticker refuses uploads, URLs and a missing sticker before the chat', async () => {
  await using fixture = await createStickerSupergroupFixture();
  const { ada, group, keeper, callBot, callBotWithFiles } = fixture;
  const historyBefore = await ada.getMessages({ chat: group });
  const stickerFile = () => new File([STICKER], 'sticker.webp', { type: 'image/webp' });
  const unsupported = 'Bad Request: stickers can be sent only by a file_id the bot knows; ' +
    'uploads and URLs are not supported';

  const answers = [
    await callBot(keeper, 'sendSticker', { chat_id: group.chatId }),
    await callBot(keeper, 'sendSticker', {
      chat_id: group.chatId,
      sticker: 'https://cdn.example.com/sticker.webp',
    }),
    await callBotWithFiles(keeper, 'sendSticker', { chat_id: String(group.chatId) }, {
      sticker: stickerFile(),
    }),
    await callBotWithFiles(keeper, 'sendSticker', {
      chat_id: String(group.chatId),
      sticker: 'attach://upload',
    }, { upload: stickerFile() }),
    // The sticker is read before the chat, so an unknown chat fails for the upload.
    await callBotWithFiles(keeper, 'sendSticker', { chat_id: '-1001' }, {
      sticker: stickerFile(),
    }),
  ];

  assertEquals(
    answers.map(({ ok, description }) => ({ ok, description })),
    [
      { ok: false, description: 'Bad Request: there is no sticker in the request' },
      ...Array(4).fill({ ok: false, description: unsupported }),
    ],
  );
  assertEquals(await ada.getMessages({ chat: group }), historyBefore, 'Expected no message');
});

Deno.test('sending a sticker to a supergroup needs can_send_other_messages', async () => {
  await using fixture = await createStickerSupergroupFixture();
  const { ada, grace, group, keeper, callBot, readStickerUpdate } = fixture;
  await ada.sendSticker({ to: group, sticker: STICKER });
  const keeperSticker = await readStickerUpdate(keeper);
  await ada.setChatPermissions({
    chat: group,
    permissions: { can_send_messages: true, can_send_photos: true },
  });

  const graceRefusal = await refusalOf(grace.sendSticker({ to: group, sticker: STICKER }));
  const keeperRefusal = await callBot(keeper, 'sendSticker', {
    chat_id: group.chatId,
    sticker: keeperSticker.file_id,
  });
  // The owner is exempt from default permissions.
  const { result: ownerSticker } = await ada.sendSticker({ to: group, sticker: STICKER });

  assertEquals(graceRefusal, { status: 403, reason: 'send_permission_missing' });
  assertEquals(
    [keeperRefusal.ok, keeperRefusal.description],
    [false, 'Bad Request: not enough rights to send stickers to the chat'],
  );
  assertEquals(ownerSticker.sticker?.width, 96, 'Expected the owner to send the sticker');

  await ada.setChatPermissions({
    chat: group,
    permissions: { can_send_messages: true, can_send_other_messages: true },
  });
  const { result: graceSticker } = await grace.sendSticker({ to: group, sticker: STICKER });
  assertEquals(graceSticker.sticker?.height, 64, 'Expected the permission to allow stickers');
});

Deno.test('an account sticker that is not a static WebP image is refused without a trace', async () => {
  await using fixture = await createStickerSupergroupFixture();
  const { ada, group, keeper, reader, readUpdates } = fixture;
  const historyBefore = await ada.getMessages({ chat: group });
  await readUpdates(keeper);
  await readUpdates(reader);

  const refusals = [
    await refusalOf(ada.sendSticker({ to: group, sticker: gifImage(64, 64) })),
    await refusalOf(ada.sendSticker({ to: group, sticker: STICKER.slice(0, 20) })),
    await refusalOf(ada.sendSticker({ to: group, sticker: ANIMATED_STICKER })),
    await refusalOf(ada.sendSticker({ to: group, sticker: new Uint8Array() })),
  ];

  assertEquals(refusals, [
    { status: 400, reason: 'sticker_invalid' },
    { status: 400, reason: 'sticker_invalid' },
    { status: 400, reason: 'sticker_animation_unsupported' },
    { status: 400, reason: 'file_empty' },
  ]);
  assertEquals(await ada.getMessages({ chat: group }), historyBefore, 'Expected no message');
  assertEquals(
    [...await readUpdates(keeper), ...await readUpdates(reader)],
    [],
    'Expected no update for a refused sticker',
  );
});

Deno.test('a sticker has no caption or replaceable media, and copies keep it', async () => {
  await using fixture = await createStickerSupergroupFixture();
  const { ada, group, keeper, callBot, readStickerUpdate } = fixture;
  const { result: stickerMessage } = await ada.sendSticker({
    to: group,
    sticker: STICKER,
    emoji: '🧪',
  });
  const keeperSticker = await readStickerUpdate(keeper);
  await ada.sendPhoto({ to: group, photo: gifImage(10, 10) });
  const photoFileId = await readPhotoFileId(fixture, keeper);
  const sentByBot = await callBot(keeper, 'sendSticker', {
    chat_id: group.chatId,
    sticker: keeperSticker.file_id,
  });
  const botMessageId = sentByBot.result?.message_id;

  const captionEdit = await callBot(keeper, 'editMessageCaption', {
    chat_id: group.chatId,
    message_id: botMessageId,
    caption: 'New caption',
  });
  const mediaEdit = await callBot(keeper, 'editMessageMedia', {
    chat_id: group.chatId,
    message_id: botMessageId,
    media: { type: 'photo', media: photoFileId },
  });
  const copy = await callBot(keeper, 'copyMessage', {
    chat_id: group.chatId,
    from_chat_id: group.chatId,
    message_id: stickerMessage.message_id,
    caption: 'Ignored for a sticker',
  });
  const forward = await callBot(keeper, 'forwardMessage', {
    chat_id: group.chatId,
    from_chat_id: group.chatId,
    message_id: stickerMessage.message_id,
  });
  const history = await ada.getMessages({ chat: group });
  const copied = history.find(({ message_id }) => message_id === copy.result?.message_id);
  const forwarded = forward.result;

  assertEquals(
    [captionEdit.description, mediaEdit.description],
    [
      'Bad Request: there is no caption in the message to edit',
      "Bad Request: message media can't be edited",
    ],
  );
  assertEquals(
    [copied?.sticker?.file_unique_id, copied?.caption, copied?.forward_origin],
    [stickerMessage.sticker?.file_unique_id, undefined, undefined],
    'Expected a copy to keep the sticker without a caption or attribution',
  );
  assertEquals(
    [forwarded?.sticker?.file_id, (forwarded?.forward_origin as { type?: string })?.type],
    [keeperSticker.file_id, 'user'],
    'Expected a forward to keep the sticker and show its origin',
  );
});

Deno.test('a reply from another chat shows the replied sticker to each observer', async () => {
  await using fixture = await createStickerSupergroupFixture();
  const { ada, group, keeper, callBot, readStickerUpdate } = fixture;
  const { result: privateSticker } = await ada.sendSticker({
    to: { type: 'private', botId: keeper.id },
    sticker: STICKER,
    emoji: '🧪',
  });
  const keeperSticker = await readStickerUpdate(keeper);

  const reply = await callBot(keeper, 'sendMessage', {
    chat_id: group.chatId,
    text: 'Look what Ada sent',
    reply_parameters: { chat_id: ada.id, message_id: privateSticker.message_id },
  });
  const adaView = (await ada.getMessages({ chat: group })).find(({ message_id }) =>
    message_id === reply.result?.message_id
  );
  const keeperExternalSticker = (reply.result?.external_reply as Record<string, unknown>)?.sticker;

  assertEquals(keeperExternalSticker, keeperSticker, 'Expected the bot to see its own file_id');
  assertEquals(
    adaView?.external_reply?.sticker?.file_unique_id,
    keeperSticker.file_unique_id,
    'Expected the account to see the replied sticker',
  );
  assertEquals(adaView?.quote, undefined, 'Expected a sticker to give the reply no quote');
});

/**
 * A supergroup that Ada owns with Grace, and two bots that read every message: `keeper` and
 * `reader`, each polled through `getUpdates`.
 */
async function createStickerSupergroupFixture() {
  await using disposalOnFailure = new AsyncDisposableStack();
  const emulator = disposalOnFailure.use(createTestInProcessEmulator());
  const { fetch } = emulator;
  const { result: session } = await emulator.client.createSession();
  const createBot = async (username: string): Promise<StickerSessionBot> => {
    const { result: { bot, token } } = await session.createBot({
      first_name: username,
      username,
      can_read_all_group_messages: true,
    });
    return { id: bot.id, token };
  };
  const keeper = await createBot('keeper_bot');
  const reader = await createBot('reader_bot');
  const { result: { account: ada } } = await session.createAccount({ first_name: 'Ada' });
  const { result: { account: grace } } = await session.createAccount({ first_name: 'Grace' });
  const { result: supergroup } = await ada.createSupergroup({ title: 'Stickers' });
  const group: SupergroupMessageTarget = { type: 'supergroup', chatId: supergroup.id };
  for (const userId of [grace.id, keeper.id, reader.id]) {
    await ada.addChatMember({ chat: group, userId });
  }
  const callBot = createBotApiCaller(session, fetch);
  const callBotWithFiles = async (
    bot: StickerSessionBot,
    method: string,
    parameters: Record<string, string>,
    files: Record<string, File>,
  ): Promise<BotApiAnswer> => {
    const body = new FormData();
    for (const [name, value] of Object.entries({ ...parameters, ...files })) {
      body.append(name, value);
    }
    const response = await fetch(`${session.botApiRoot}/bot${bot.token}/${method}`, {
      method: 'POST',
      body,
    });
    return await response.json();
  };
  const nextUpdateIds = new Map<number, number>();
  const readUpdates = async (bot: StickerSessionBot) => {
    const answer = await callBot(bot, 'getUpdates', { offset: nextUpdateIds.get(bot.id) ?? 0 });
    const updates = answer.result as unknown as Array<
      { update_id: number; message?: Record<string, unknown> }
    >;
    const lastUpdate = updates.at(-1);
    if (lastUpdate !== undefined) {
      nextUpdateIds.set(bot.id, lastUpdate.update_id + 1);
    }
    return updates;
  };
  const readStickerUpdate = async (bot: StickerSessionBot) => {
    const sticker = (await readUpdates(bot)).map(({ message }) => message?.sticker).at(-1);
    assertExists(sticker, `Expected bot ${bot.id} to receive a sticker`);
    return sticker as { file_id: string; file_unique_id: string } & Record<string, unknown>;
  };
  const emulatorDisposal = disposalOnFailure.move();
  return {
    emulator,
    session,
    fetch,
    ada,
    grace,
    group,
    keeper,
    reader,
    callBot,
    callBotWithFiles,
    readUpdates,
    readStickerUpdate,
    [Symbol.asyncDispose]: () => emulatorDisposal.disposeAsync(),
  };
}

/** Calls a bot's Bot API methods with JSON parameters and returns the parsed answers. */
function createBotApiCaller(session: EmulationSessionClient, fetch: typeof globalThis.fetch) {
  return async (
    bot: StickerSessionBot,
    method: string,
    parameters: Record<string, unknown>,
  ): Promise<BotApiAnswer> => {
    const response = await fetch(`${session.botApiRoot}/bot${bot.token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(parameters),
    });
    return await response.json();
  };
}

/** The `file_id` of the photo of the latest update a bot reads. */
async function readPhotoFileId(
  { readUpdates }: { readonly readUpdates: (bot: StickerSessionBot) => Promise<unknown[]> },
  bot: StickerSessionBot,
): Promise<string> {
  const updates = await readUpdates(bot) as Array<{ message?: { photo?: { file_id: string }[] } }>;
  const fileId = updates.at(-1)?.message?.photo?.[0]?.file_id;
  assertExists(fileId, 'Expected the bot to receive the photo');
  return fileId;
}

/** The status and reason of a control request the emulator refuses. */
async function refusalOf(
  action: ReturnType<VirtualAccountClient['sendSticker']>,
): Promise<{ status: number; reason: string }> {
  try {
    await action;
  } catch (error) {
    if (error instanceof EmulationControlError) {
      return { status: error.status, reason: error.reason };
    }
    throw error;
  }
  throw new Error('Expected the request to be refused');
}
