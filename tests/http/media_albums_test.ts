import { assertEquals } from '@std/assert';
import { Bot } from 'https://cdn.jsdelivr.net/gh/grammyjs/grammY@^1.46.0/src/bot.ts';
import { InputFile } from 'https://cdn.jsdelivr.net/gh/grammyjs/grammY@^1.46.0/src/types.ts';
import {
  webhookCallback,
} from 'https://cdn.jsdelivr.net/gh/grammyjs/grammY@^1.46.0/src/convenience/webhook.ts';

import { jsonRequest, TEST_PUBLIC_ORIGIN } from '../support/emulation_api.ts';
import { assertEqualsInFieldOrder } from '../support/field_order_assertion.ts';
import { expectSettlementWithin } from '../support/settlement.ts';
import { isBadRequestResponse } from '../support/http_response_guards.ts';
import {
  botApiResult,
  callBotApi,
  callBotApiWithFiles,
  createUpdateReader,
  photoSizeOf,
  updateMessages,
} from '../support/bot_api_requests.ts';
import {
  createBot,
  createPrivateConversationFixture,
  createSupergroupFixture,
} from '../support/http_fixtures.ts';
import { gifImage } from '../support/media_samples.ts';

Deno.test('an account and a bot exchange albums whose messages arrive in order', async () => {
  await using fixture = await createPrivateConversationFixture();
  const { api, sessionPath, botApiPath, createdBot, createdAccount } = fixture;
  const chat = { type: 'private', botId: createdBot.bot.id };
  const accountPath = `${sessionPath}/accounts/${createdAccount.account.id}`;

  const accountAlbumResponse = await api.request(
    `${accountPath}/media-groups`,
    jsonRequest('POST', {
      to: chat,
      media: [
        { photo: { content_base64: gifImage(640, 480).toBase64() }, caption: 'Front' },
        { photo: { content_base64: gifImage(480, 640).toBase64() }, caption: 'Back' },
      ],
    }),
  );
  const accountAlbum = (await accountAlbumResponse.json()).messages as Record<string, unknown>[];
  const updates = updateMessages((await callBotApi(api, `${botApiPath}/getUpdates`, {})).body);
  const [front, back] = updates;
  if (
    accountAlbumResponse.status !== 201 ||
    accountAlbum.length !== 2 ||
    updates.length !== 2 ||
    typeof front.media_group_id !== 'string' ||
    back.media_group_id !== front.media_group_id
  ) {
    throw new Error(
      `Expected the bot to receive the album in order, received ${JSON.stringify(updates)}`,
    );
  }
  assertEquals(updates.map((message) => [message.message_id, message.caption]), [[1, 'Front'], [
    2,
    'Back',
  ]], 'Expected the bot to receive the album in order');
  assertEqualsInFieldOrder(accountAlbum, updates, 'Expected the bot to receive the album in order');

  const reply = await callBotApiWithFiles(api, `${botApiPath}/sendMediaGroup`, {
    chat_id: String(createdAccount.account.id),
    reply_parameters: JSON.stringify({ message_id: back.message_id }),
    media: JSON.stringify([
      {
        type: 'document',
        media: 'attach://summary',
        caption: '*Summary*',
        parse_mode: 'MarkdownV2',
      },
      { type: 'document', media: 'attach://details' },
    ]),
  }, {
    summary: new File(['summary'], 'summary.txt'),
    details: new File(['details'], 'details.csv'),
  });
  const replyMessages = (reply.body as { result?: Record<string, unknown>[] }).result ?? [];
  const [summary, details] = replyMessages;
  if (
    reply.status !== 200 ||
    replyMessages.length !== 2 ||
    summary.message_id !== 3 ||
    details.message_id !== 4 ||
    typeof summary.media_group_id !== 'string' ||
    summary.media_group_id === front.media_group_id ||
    details.media_group_id !== summary.media_group_id ||
    replyMessages.some((message) =>
      (message.reply_to_message as Record<string, unknown>).message_id !== back.message_id
    ) ||
    summary.caption !== 'Summary' ||
    'caption' in details
  ) {
    throw new Error(`Expected the bot's album as a reply, received ${JSON.stringify(reply.body)}`);
  }
  assertEquals(Object.keys(summary), [
    'message_id',
    'from',
    'chat',
    'date',
    'reply_to_message',
    'media_group_id',
    'document',
    'caption',
    'caption_entities',
  ], "Expected the bot's album as a reply");
  const botUpdates = await callBotApi(api, `${botApiPath}/getUpdates`, { offset: 3 });
  if (updateMessages(botUpdates.body).length !== 0) {
    throw new Error('Expected the bot to receive no update for its own album');
  }

  const historyResponse = await api.request(
    `${accountPath}/conversations/private/${createdBot.bot.id}/messages`,
  );
  const history = (await historyResponse.json()).messages as Record<string, unknown>[];
  const downloads = await Promise.all(
    history.slice(2).map(async (message) => {
      const { file_unique_id } = message.document as { file_unique_id: string };
      const download = await api.request(`${sessionPath}/files/${file_unique_id}`);
      return new TextDecoder().decode(await download.arrayBuffer());
    }),
  );
  assertEqualsInFieldOrder(history.map((message) => [message.message_id, message.media_group_id]), [
    [1, front.media_group_id],
    [2, front.media_group_id],
    [3, summary.media_group_id],
    [4, summary.media_group_id],
  ], 'Expected the history to hold both albums');
  assertEquals(downloads, ['summary', 'details'], 'Expected the history to hold both albums');
});

Deno.test('sendMediaGroup follows Telegram checks and sends nothing it refuses', async () => {
  await using fixture = await createPrivateConversationFixture();
  const { api, sessionPath, botApiPath, createdBot, createdAccount, sendText } = fixture;
  await sendText('/start');
  const chatId = String(createdAccount.account.id);
  const uploadedPhoto = await callBotApiWithFiles(api, `${botApiPath}/sendPhoto`, {
    chat_id: chatId,
  }, { photo: new File([gifImage(4, 3)], 'photo.gif') });
  const photoFileId = photoSizeOf(botApiResult(uploadedPhoto.body))?.file_id;
  const uploadedDocument = await callBotApiWithFiles(api, `${botApiPath}/sendDocument`, {
    chat_id: chatId,
  }, { document: new File(['notes'], 'notes.txt') });
  const documentFileId = (botApiResult(uploadedDocument.body)?.document as
    | { file_id: string }
    | undefined)?.file_id;
  if (photoFileId === undefined || documentFileId === undefined) {
    throw new Error('Expected a photo and a document to reuse');
  }
  const photo = { type: 'photo', media: photoFileId };
  const document = { type: 'document', media: documentFileId };
  const image = new File([gifImage(4, 3)], 'image.gif');
  const historyPath =
    `${sessionPath}/accounts/${chatId}/conversations/private/${createdBot.bot.id}/messages`;
  const historyBefore = await (await api.request(historyPath)).text();

  const failures: { parameters: Record<string, string>; files: Record<string, File> }[] = [
    { parameters: { chat_id: chatId }, files: {} },
    { parameters: { chat_id: chatId, media: '[' }, files: {} },
    { parameters: { chat_id: chatId, media: '{}' }, files: {} },
    { parameters: { chat_id: chatId, media: '[]' }, files: {} },
    { parameters: { chat_id: chatId, media: 'null' }, files: {} },
    { parameters: { chat_id: chatId, media: JSON.stringify(Array(11).fill(photo)) }, files: {} },
    { parameters: { chat_id: chatId, media: JSON.stringify([photo, document]) }, files: {} },
    {
      parameters: {
        chat_id: chatId,
        media: JSON.stringify([photo, { ...photo, show_caption_above_media: true }]),
      },
      files: {},
    },
    {
      parameters: {
        chat_id: chatId,
        media: JSON.stringify([photo, { type: 'photo', media: 'attach://missing' }]),
      },
      files: {},
    },
    {
      parameters: {
        chat_id: chatId,
        media: JSON.stringify([photo, { type: 'live_photo', media: 'x' }]),
      },
      files: {},
    },
    {
      parameters: {
        chat_id: chatId,
        media: JSON.stringify([photo, { ...photo, caption: '*bold', parse_mode: 'MarkdownV2' }]),
      },
      files: {},
    },
    {
      parameters: {
        chat_id: chatId,
        media: JSON.stringify([photo, { ...photo, caption: 'x'.repeat(1_025) }]),
      },
      files: {},
    },
    {
      parameters: {
        chat_id: chatId,
        media: JSON.stringify([photo, { type: 'photo', media: 'attach://text' }]),
      },
      files: { text: new File(['not an image'], 'text.gif') },
    },
    // TDLib reads a file_id before Telegram's servers refuse an earlier upload.
    {
      parameters: {
        chat_id: chatId,
        media: JSON.stringify([{ type: 'photo', media: 'attach://text' }, {
          type: 'photo',
          media: 'AgACAgIAAxkBAAIBdGZ',
        }]),
      },
      files: { text: new File(['not an image'], 'text.gif') },
    },
    {
      parameters: {
        chat_id: chatId,
        media: JSON.stringify([photo, { type: 'photo', media: 'attach://empty' }]),
      },
      files: { empty: new File([], 'empty.gif') },
    },
    {
      parameters: {
        chat_id: chatId,
        media: JSON.stringify([photo, { type: 'photo', media: 'https://example.com/a.gif' }]),
      },
      files: {},
    },
    {
      parameters: {
        chat_id: chatId,
        media: JSON.stringify([photo, { type: 'photo', media: 'attach://image' }]),
        reply_markup: JSON.stringify({ inline_keyboard: [] }),
      },
      files: { image },
    },
    {
      parameters: {
        chat_id: chatId,
        media: JSON.stringify([photo, { type: 'photo', media: 'attach://image' }]),
        reply_parameters: JSON.stringify({ message_id: 999 }),
      },
      files: { image },
    },
    {
      parameters: { media: JSON.stringify([photo, { type: 'photo', media: 'attach://image' }]) },
      files: { image },
    },
  ];
  const descriptions = [];
  for (const { parameters, files } of failures) {
    const { status, body } = await callBotApiWithFiles(
      api,
      `${botApiPath}/sendMediaGroup`,
      parameters,
      files,
    );
    descriptions.push(status === 400 && isBadRequestResponse(body) ? body.description : status);
  }
  const expectedDescriptions = [
    'Bad Request: parameter "media" is required',
    "Bad Request: can't parse media JSON object",
    'Bad Request: expected an Array of InputMedia',
    'Bad Request: there are no messages to send',
    'Bad Request: there are no messages to send',
    'Bad Request: too many messages to send as an album',
    "Bad Request: document can't be mixed with other media types",
    'Bad Request: parameter show_caption_above_media must be the same for all messages',
    "Bad Request: can't parse InputMedia: media not found",
    'Bad Request: InputMedia of type "live_photo" is not supported',
    "Bad Request: can't parse InputMedia: Can't parse entities: Can't find end of Bold entity at byte offset 0",
    'Bad Request: message caption is too long',
    'Bad Request: failed to send message #2 with the error message "IMAGE_PROCESS_FAILED"',
    'Bad Request: wrong file identifier/HTTP URL specified',
    'Bad Request: file must be non-empty',
    'Bad Request: failed to send message #2 with the error message "WEBPAGE_CURL_FAILED"',
    'Bad Request: invalid sendMediaGroup parameters: reply_markup',
    'Bad Request: message to be replied not found',
    'Bad Request: chat_id is empty',
  ];
  assertEqualsInFieldOrder(descriptions, expectedDescriptions, "Expected Telegram's errors");
  if ((await (await api.request(historyPath)).text()) !== historyBefore) {
    throw new Error('Expected refused albums to leave the history as it was');
  }

  const single = await callBotApi(api, `${botApiPath}/sendMediaGroup`, {
    chat_id: chatId,
    media: [document],
  });
  const singleMessages = (single.body as { result?: Record<string, unknown>[] }).result;
  if (
    single.status !== 200 || singleMessages?.length !== 1 || 'media_group_id' in singleMessages[0]
  ) {
    throw new Error(`Expected one message outside any album, received ${JSON.stringify(single)}`);
  }
});

Deno.test('sendMediaGroup checks each caption with its file, as TDLib reads them', async () => {
  await using fixture = await createPrivateConversationFixture();
  const { api, sessionPath, botApiPath, createdBot, createdAccount, sendText } = fixture;
  await sendText('/start');
  const chatId = String(createdAccount.account.id);
  const uploadedPhoto = await callBotApiWithFiles(api, `${botApiPath}/sendPhoto`, {
    chat_id: chatId,
  }, { photo: new File([gifImage(4, 3)], 'photo.gif') });
  const photo = { type: 'photo', media: photoSizeOf(botApiResult(uploadedPhoto.body))?.file_id };
  const longCaption = { ...photo, caption: 'x'.repeat(1_025) };
  const unknownPhoto = { type: 'photo', media: 'AgACAgIAAxkBAAIBdGZ' };
  const textAsImage = { text: new File(['not an image'], 'text.gif') };
  const notes = { notes: new File(['notes'], 'notes.txt') };
  const historyPath =
    `${sessionPath}/accounts/${chatId}/conversations/private/${createdBot.bot.id}/messages`;
  const historyBefore = await (await api.request(historyPath)).text();

  const cases: { media: unknown[]; files: Record<string, File>; expected: string }[] = [
    // A caption is refused before the album is checked as a whole.
    {
      media: [longCaption, { type: 'document', media: 'attach://notes' }],
      files: notes,
      expected: 'Bad Request: message caption is too long',
    },
    {
      media: Array(11).fill(longCaption),
      files: {},
      expected: 'Bad Request: message caption is too long',
    },
    // A caption is refused before an upload that only Telegram's servers refuse.
    {
      media: [longCaption, { type: 'photo', media: 'attach://text' }],
      files: textAsImage,
      expected: 'Bad Request: message caption is too long',
    },
    {
      media: [{ type: 'photo', media: 'attach://text' }, longCaption],
      files: textAsImage,
      expected: 'Bad Request: message caption is too long',
    },
    // Each message's file and caption are read before the next message's.
    {
      media: [longCaption, unknownPhoto],
      files: {},
      expected: 'Bad Request: message caption is too long',
    },
    {
      media: [unknownPhoto, longCaption],
      files: {},
      expected: 'Bad Request: wrong file identifier/HTTP URL specified',
    },
  ];
  const descriptions = [];
  for (const { media, files } of cases) {
    const { status, body } = await callBotApiWithFiles(api, `${botApiPath}/sendMediaGroup`, {
      chat_id: chatId,
      media: JSON.stringify(media),
    }, files);
    descriptions.push(status === 400 && isBadRequestResponse(body) ? body.description : status);
  }
  assertEqualsInFieldOrder(
    descriptions,
    cases.map(({ expected }) => expected),
    "Expected TDLib's precedence",
  );
  if ((await (await api.request(historyPath)).text()) !== historyBefore) {
    throw new Error('Expected refused albums to leave the history as it was');
  }
});

Deno.test('albums reach supergroup bots as their messages would alone', async () => {
  await using fixture = await createSupergroupFixture();
  const { api, sessionPath, owner, bot, readerBot, supergroup, supergroupPath } = fixture;
  const readUpdates = createUpdateReader(api);
  const botApiPath = `${sessionPath}/bot-api/bot${bot.token}`;
  const readerBotApiPath = `${sessionPath}/bot-api/bot${readerBot.token}`;
  await readUpdates(botApiPath);
  await readUpdates(readerBotApiPath);

  const albumResponse = await api.request(
    `${sessionPath}/accounts/${owner.id}/media-groups`,
    jsonRequest('POST', {
      to: { type: 'supergroup', chatId: supergroup.id },
      media: [
        { document: { content_base64: 'cGxhbg==', file_name: 'plan.txt' }, caption: '/start' },
        { document: { content_base64: 'bm90ZXM=', file_name: 'notes.txt' }, caption: 'Notes' },
      ],
    }),
  );
  const album = (await albumResponse.json()).messages as Record<string, unknown>[];
  const botMessages = (await readUpdates(botApiPath)).map((update) => update.message) as Record<
    string,
    unknown
  >[];
  const readerMessages = (await readUpdates(readerBotApiPath)).map((update) =>
    update.message
  ) as Record<string, unknown>[];
  if (
    albumResponse.status !== 201 ||
    album.length !== 2 ||
    album[1].media_group_id !== album[0].media_group_id
  ) {
    throw new Error(
      `Expected a bot in privacy mode to receive only the command, received ${
        JSON.stringify({ botMessages, readerMessages })
      }`,
    );
  }
  assertEquals(
    botMessages.map((message) => message.caption),
    ['/start'],
    'Expected a bot in privacy mode to receive only the command',
  );
  assertEqualsInFieldOrder(
    readerMessages.map((message) => [message.message_id, message.media_group_id]),
    album.map((message) => [message.message_id, message.media_group_id]),
    'Expected a bot in privacy mode to receive only the command',
  );

  // Each bot reuses the files by the file_id it received them under.
  const botAlbum = await callBotApi(api, `${readerBotApiPath}/sendMediaGroup`, {
    chat_id: supergroup.id,
    media: readerMessages.map((message) => ({
      type: 'document',
      media: (message.document as { file_id: string }).file_id,
    })),
    protect_content: true,
  });
  const botAlbumMessages = (botAlbum.body as { result?: Record<string, unknown>[] }).result ?? [];
  const history = (await (await api.request(`${supergroupPath(owner.id)}/messages`)).json())
    .messages as Record<string, unknown>[];
  if (
    botAlbum.status !== 200 ||
    botAlbumMessages.length !== 2 ||
    botAlbumMessages.some((message) => message.has_protected_content !== true) ||
    (await readUpdates(botApiPath)).length !== 0
  ) {
    throw new Error(`Expected the bot's album in the history, received ${JSON.stringify(history)}`);
  }
  assertEqualsInFieldOrder(
    history.slice(-2).map((message) => message.media_group_id),
    botAlbumMessages.map((message) => message.media_group_id),
    "Expected the bot's album in the history",
  );
});

Deno.test('forwards and copies of albums form new albums as TDLib groups them', async () => {
  await using fixture = await createPrivateConversationFixture();
  const { api, sessionPath, botApiPath, createdBot, createdAccount } = fixture;
  const chatId = createdAccount.account.id;
  const accountPath = `${sessionPath}/accounts/${chatId}`;
  const historyPath = `${accountPath}/conversations/private/${createdBot.bot.id}/messages`;
  const sendAccountMedia = async (path: string, body: Record<string, unknown>) => {
    const response = await api.request(
      `${accountPath}/${path}`,
      jsonRequest('POST', { to: { type: 'private', botId: createdBot.bot.id }, ...body }),
    );
    if (response.status !== 201) {
      throw new Error(`Expected the account's ${path} to be sent, received ${response.status}`);
    }
  };
  const photo = { photo: { content_base64: gifImage(4, 3).toBase64() } };
  const document = (fileName: string) => ({
    document: { content_base64: 'ZmlsZQ==', file_name: fileName },
  });
  // Messages 1 to 3 form an album, 4 is text, and 5 and 6 are separate documents.
  await sendAccountMedia('media-groups', { media: [photo, photo, photo] });
  await sendAccountMedia('messages', { text: 'Between' });
  await sendAccountMedia('messages', document('a.txt'));
  await sendAccountMedia('messages', document('b.txt'));
  const readGroups = async (messageIds: readonly number[]) => {
    const { messages } = await (await api.request(historyPath)).json() as {
      messages: Array<{ message_id: number; media_group_id?: string }>;
    };
    return messageIds.map((messageId) =>
      messages.find((message) => message.message_id === messageId)?.media_group_id
    );
  };
  const repeat = async (method: string, parameters: Record<string, unknown>) => {
    const { status, body } = await callBotApi(api, `${botApiPath}/${method}`, {
      chat_id: chatId,
      from_chat_id: chatId,
      ...parameters,
    });
    const result = (body as { result?: unknown }).result;
    if (status !== 200) {
      throw new Error(`Expected ${method} to succeed, received ${JSON.stringify(body)}`);
    }
    return Array.isArray(result)
      ? result.map(({ message_id }: { message_id: number }) => message_id)
      : [(result as { message_id: number }).message_id];
  };

  const [originalGroup] = await readGroups([1]);
  const forwardedAlbum = await readGroups(
    await repeat('forwardMessages', { message_ids: [1, 2, 3, 4] }),
  );
  const copiedPart = await readGroups(await repeat('copyMessages', { message_ids: [2, 3] }));
  const loneMembers = await readGroups([
    ...await repeat('forwardMessages', { message_ids: [1] }),
    ...await repeat('forwardMessage', { message_id: 2 }),
    ...await repeat('copyMessage', { message_id: 3 }),
  ]);
  const separateDocuments = await readGroups(
    await repeat('forwardMessages', { message_ids: [5, 6] }),
  );
  const mixedDocuments = await readGroups(
    await repeat('copyMessages', { message_ids: [4, 5, 6] }),
  );
  const [forwardedGroup] = forwardedAlbum;
  if (
    originalGroup === undefined ||
    forwardedGroup === undefined ||
    forwardedGroup === originalGroup ||
    copiedPart[0] === undefined ||
    copiedPart[1] !== copiedPart[0] ||
    new Set([originalGroup, forwardedGroup, copiedPart[0]]).size !== 3 ||
    loneMembers.length !== 3 ||
    loneMembers.some((group) => group !== undefined) ||
    separateDocuments[0] === undefined ||
    separateDocuments[1] !== separateDocuments[0] ||
    mixedDocuments.some((group) => group !== undefined)
  ) {
    throw new Error(
      `Expected repeated albums to form new albums, received ${
        JSON.stringify({ forwardedAlbum, copiedPart, loneMembers, separateDocuments })
      }`,
    );
  }
  assertEqualsInFieldOrder(forwardedAlbum, [
    forwardedGroup,
    forwardedGroup,
    forwardedGroup,
    undefined,
  ], 'Expected repeated albums to form new albums');
});

Deno.test('a message of an album keeps its kind of media, and its album outlives a deletion', async () => {
  await using fixture = await createPrivateConversationFixture();
  const { api, sessionPath, botApiPath, createdBot, createdAccount, sendText } = fixture;
  await sendText('/start');
  const chatId = String(createdAccount.account.id);
  const album = await callBotApiWithFiles(api, `${botApiPath}/sendMediaGroup`, {
    chat_id: chatId,
    media: JSON.stringify([
      { type: 'photo', media: 'attach://front', caption: 'Front' },
      { type: 'photo', media: 'attach://back' },
    ]),
  }, {
    front: new File([gifImage(4, 3)], 'front.gif'),
    back: new File([gifImage(3, 4)], 'back.gif'),
  });
  const [front, back] = (album.body as { result: Record<string, unknown>[] }).result;
  const editMedia = (messageId: unknown, media: Record<string, unknown>, files = {}) =>
    callBotApiWithFiles(api, `${botApiPath}/editMessageMedia`, {
      chat_id: chatId,
      message_id: String(messageId),
      media: JSON.stringify(media),
    }, files);

  const toDocument = await editMedia(front.message_id, {
    type: 'document',
    media: 'attach://notes',
  }, { notes: new File(['notes'], 'notes.txt') });
  const toPhoto = await editMedia(front.message_id, {
    type: 'photo',
    media: photoSizeOf(back)?.file_id,
    caption: 'Both sides',
  });
  const editedFront = botApiResult(toPhoto.body);
  if (
    toDocument.status !== 400 || !isBadRequestResponse(toDocument.body) ||
    toDocument.body.description !== "Bad Request: can't change media type in the album" ||
    toPhoto.status !== 200 || editedFront?.media_group_id !== front.media_group_id ||
    editedFront?.caption !== 'Both sides'
  ) {
    throw new Error(
      `Expected only a photo to replace the album's photo, received ${
        JSON.stringify({ toDocument: toDocument.body, toPhoto: toPhoto.body })
      }`,
    );
  }

  const deletion = await callBotApi(api, `${botApiPath}/deleteMessage`, {
    chat_id: chatId,
    message_id: back.message_id,
  });
  const { messages } = await (await api.request(
    `${sessionPath}/accounts/${chatId}/conversations/private/${createdBot.bot.id}/messages`,
  )).json() as { messages: Record<string, unknown>[] };
  if (deletion.status !== 200) {
    throw new Error(
      `Expected the rest of the album to remain, received ${JSON.stringify(messages)}`,
    );
  }
  assertEqualsInFieldOrder(
    messages.map((message) => [message.message_id, message.media_group_id]),
    [[1, undefined], [front.message_id, front.media_group_id]],
    'Expected the rest of the album to remain',
  );
});

Deno.test('a grammY bot receives an album through its webhook and answers with one', async () => {
  await using fixture = await createPrivateConversationFixture();
  const { api, sessionPath, createdBot, createdAccount } = fixture;
  const grammyBot = new Bot(createdBot.token, {
    client: {
      apiRoot: `${TEST_PUBLIC_ORIGIN}${sessionPath}/bot-api`,
      fetch: api.fetch,
    },
  });
  const receivedAlbum: Array<{ messageId: number; mediaGroupId?: string; fileId: string }> = [];
  grammyBot.on('message:photo', async (context) => {
    const { message } = context;
    receivedAlbum.push({
      messageId: message.message_id,
      mediaGroupId: message.media_group_id,
      fileId: message.photo[0].file_id,
    });
    if (receivedAlbum.length === 2) {
      await context.replyWithMediaGroup([
        { type: 'photo', media: receivedAlbum[0].fileId, caption: 'Yours' },
        { type: 'photo', media: new InputFile(gifImage(8, 6), 'mine.gif') },
      ], { reply_parameters: { message_id: message.message_id } });
    }
  });
  const handleWebhookRequest = webhookCallback(grammyBot, 'std/http');
  const webhookServer = Deno.serve(
    { hostname: '127.0.0.1', port: 0, onListen: () => {} },
    (request) => handleWebhookRequest(request),
  );
  const accountPath = `${sessionPath}/accounts/${createdAccount.account.id}`;
  const historyPath = `${accountPath}/conversations/private/${createdBot.bot.id}/messages`;

  try {
    await grammyBot.api.setWebhook(`http://127.0.0.1:${webhookServer.addr.port}/webhook`);
    const albumResponse = await api.request(
      `${accountPath}/media-groups`,
      jsonRequest('POST', {
        to: { type: 'private', botId: createdBot.bot.id },
        media: [
          { photo: { content_base64: gifImage(4, 3).toBase64() } },
          { photo: { content_base64: gifImage(3, 4).toBase64() } },
        ],
      }),
    );
    const history = await expectSettlementWithin(
      (async () => {
        for (;;) {
          const { messages } = await (await api.request(historyPath)).json() as {
            messages: Array<Record<string, unknown>>;
          };
          if (messages.length === 4) {
            return messages;
          }
          await new Promise((resolve) => setTimeout(resolve, 5));
        }
      })(),
      5_000,
      'Expected the bot to answer the album with one',
    );
    const [first, second, answer, upload] = history;
    if (
      albumResponse.status !== 201 ||
      typeof answer.media_group_id !== 'string' ||
      answer.media_group_id === first.media_group_id ||
      upload.media_group_id !== answer.media_group_id ||
      (answer.reply_to_message as Record<string, unknown>).message_id !== second.message_id ||
      photoSizeOf(answer)?.file_unique_id !== photoSizeOf(first)?.file_unique_id ||
      (upload.photo as Array<{ width: number }>)[0].width !== 8
    ) {
      throw new Error(
        `Expected the bot's album in reply to the account's, received ${JSON.stringify(history)}`,
      );
    }
    assertEqualsInFieldOrder(
      receivedAlbum.map(({ messageId, mediaGroupId }) => [messageId, mediaGroupId]),
      [[1, first.media_group_id], [2, first.media_group_id]],
      "Expected the bot's album in reply to the account's",
    );
    // The call is recorded once its answer is ready, which may follow the history's change.
    const entries = await expectSettlementWithin(
      (async () => {
        for (;;) {
          const { entries } = await (await api.request(`${sessionPath}/bot-activity`)).json() as {
            entries: Array<Record<string, unknown>>;
          };
          if (entries.some((entry) => entry.method === 'sendMediaGroup')) {
            return entries;
          }
          await new Promise((resolve) => setTimeout(resolve, 5));
        }
      })(),
      5_000,
      'Expected the album to be recorded as bot activity',
    );
    const albumActivity = entries.flatMap((entry) =>
      entry.kind === 'update_delivered'
        ? [[entry.kind, entry.via]]
        : entry.method === 'sendMediaGroup'
        ? [[entry.kind, (entry.uploaded_files as unknown[]).length, entry.chat_id]]
        : []
    );
    assertEqualsInFieldOrder(albumActivity, [
      ['update_delivered', 'webhook'],
      ['update_delivered', 'webhook'],
      ['bot_api_call', 1, createdAccount.account.id],
    ], "Expected the album's activity");
  } finally {
    await api.request(sessionPath, { method: 'DELETE' });
    await webhookServer.shutdown();
  }
});

Deno.test("sendMediaGroup reuses files only by the bot's own file_id or a URL", async () => {
  await using fixture = await createPrivateConversationFixture();
  const { api, sessionPath, botApiPath, createdBot, createdAccount, sendText } = fixture;
  await using otherSession = await createPrivateConversationFixture();
  await otherSession.sendText('/start');
  await sendText('/start');
  const chatId = String(createdAccount.account.id);
  const otherBot = await createBot(api, sessionPath, 'other_bot');
  const otherBotApiPath = `${sessionPath}/bot-api/bot${otherBot.token}`;
  const accountPhoto = await api.request(
    `${sessionPath}/accounts/${chatId}/messages`,
    jsonRequest('POST', {
      to: { type: 'private', botId: otherBot.bot.id },
      photo: { content_base64: gifImage(4, 3).toBase64() },
    }),
  );
  const otherBotFileId = photoSizeOf(
    updateMessages((await callBotApi(api, `${otherBotApiPath}/getUpdates`, {})).body)[0],
  )?.file_id;
  const ownPhoto = await callBotApiWithFiles(api, `${botApiPath}/sendPhoto`, { chat_id: chatId }, {
    photo: new File([gifImage(4, 3)], 'own.gif'),
  });
  const ownFileId = photoSizeOf(botApiResult(ownPhoto.body))?.file_id;
  await api.request(
    `${sessionPath}/web-resources`,
    jsonRequest('POST', {
      url: 'https://cdn.example.com/chart.gif',
      content_type: 'image/gif',
      content_base64: gifImage(6, 5).toBase64(),
    }),
  );
  const historyPath =
    `${sessionPath}/accounts/${chatId}/conversations/private/${createdBot.bot.id}/messages`;
  const historyBefore = await (await api.request(historyPath)).text();

  // The account's photo is known to the other bot only, and the file IDs to this session only.
  const refusals = await Promise.all(
    [
      { sessionApi: api, sessionBotApiPath: botApiPath, sessionChatId: chatId },
      {
        sessionApi: otherSession.api,
        sessionBotApiPath: otherSession.botApiPath,
        sessionChatId: String(otherSession.createdAccount.account.id),
      },
    ].map(async ({ sessionApi, sessionBotApiPath, sessionChatId }, index) => {
      const { status, body } = await callBotApi(sessionApi, `${sessionBotApiPath}/sendMediaGroup`, {
        chat_id: sessionChatId,
        media: [
          { type: 'photo', media: ownFileId },
          { type: 'photo', media: index === 0 ? otherBotFileId : ownFileId },
        ],
      });
      return status === 400 && isBadRequestResponse(body) ? body.description : status;
    }),
  );
  if (
    accountPhoto.status !== 201 ||
    otherBotFileId === undefined ||
    ownFileId === undefined ||
    (await (await api.request(historyPath)).text()) !== historyBefore
  ) {
    throw new Error(
      `Expected other bots' and sessions' file IDs to fail, received ${JSON.stringify(refusals)}`,
    );
  }
  assertEquals(refusals, [
    'Bad Request: wrong file identifier/HTTP URL specified',
    'Bad Request: wrong file identifier/HTTP URL specified',
  ], "Expected other bots' and sessions' file IDs to fail");

  const album = await callBotApi(api, `${botApiPath}/sendMediaGroup`, {
    chat_id: chatId,
    media: [
      { type: 'photo', media: ownFileId },
      { type: 'photo', media: 'https://CDN.example.com/chart.gif' },
    ],
  });
  const [reused, downloaded] = (album.body as { result?: Record<string, unknown>[] }).result ?? [];
  if (
    album.status !== 200 || photoSizeOf(reused)?.file_id !== ownFileId ||
    (downloaded?.photo as Array<{ width: number }> | undefined)?.[0].width !== 6 ||
    downloaded.media_group_id !== reused.media_group_id
  ) {
    throw new Error(`Expected a reused and a downloaded photo, received ${JSON.stringify(album)}`);
  }
});

Deno.test('sendMediaGroup sends photos, videos, documents and audio and names each kind it refuses', async () => {
  await using fixture = await createPrivateConversationFixture();
  const { api, botApiPath, createdAccount, sendText } = fixture;
  await sendText('/start');
  const chatId = String(createdAccount.account.id);
  const files = {
    image: new File([gifImage(4, 3)], 'image.gif'),
    notes: new File(['notes'], 'notes.txt'),
  };
  const sendAlbumOf = async (type: string) => {
    const media = type === 'document' || type === 'audio' ? 'attach://notes' : 'attach://image';
    const { status, body } = await callBotApiWithFiles(api, `${botApiPath}/sendMediaGroup`, {
      chat_id: chatId,
      media: JSON.stringify([{ type, media }, { type, media }]),
    }, files);
    if (status === 200) {
      const messages = (body as { result: Record<string, unknown>[] }).result;
      return messages.map((message) =>
        ['photo', 'document', 'video', 'audio'].find((kind) => kind in message) ?? 'unexpected'
      ).join(',');
    }
    return status === 400 && isBadRequestResponse(body) ? body.description : status;
  };

  const outcomes = [];
  for (
    const type of ['photo', 'document', 'video', 'live_photo', 'audio', 'animation', 'voice_note']
  ) {
    outcomes.push([type, await sendAlbumOf(type)]);
  }
  const replacement = await callBotApi(api, `${botApiPath}/editMessageMedia`, {
    chat_id: chatId,
    message_id: 1,
    media: { type: 'animation', media: 'attach://image' },
  });
  const expectedOutcomes = [
    ['photo', 'photo,photo'],
    ['document', 'document,document'],
    ['video', 'video,video'],
    // Telegram sends live photos in albums; the emulator lacks them.
    ['live_photo', 'Bad Request: InputMedia of type "live_photo" is not supported'],
    ['audio', 'audio,audio'],
    // Telegram refuses these in albums itself.
    [
      'animation',
      'Bad Request: can\'t parse InputMedia: type "animation" can\'t be used in sendMediaGroup',
    ],
    ['voice_note', 'Bad Request: can\'t parse InputMedia: type "voice_note" is not allowed'],
  ];
  if (
    replacement.status !== 400 ||
    !isBadRequestResponse(replacement.body) ||
    replacement.body.description !== 'Bad Request: InputMedia of type "animation" is not supported'
  ) {
    throw new Error(
      `Expected each album kind's outcome, received ${
        JSON.stringify({ outcomes, replacement: replacement.body }, null, 2)
      }`,
    );
  }
  assertEqualsInFieldOrder(outcomes, expectedOutcomes, "Expected each album kind's outcome");
});

Deno.test('albums hold photos with videos, and documents only among documents', async () => {
  await using fixture = await createPrivateConversationFixture();
  const { api, sessionPath, botApiPath, createdBot, createdAccount, sendText } = fixture;
  await sendText('/start');
  const chatId = String(createdAccount.account.id);
  const accountPath = `${sessionPath}/accounts/${chatId}`;
  const historyPath = `${accountPath}/conversations/private/${createdBot.bot.id}/messages`;

  // An account sends a photo and a video as one album, which the bot receives in order.
  const accountAlbum = await api.request(
    `${accountPath}/media-groups`,
    jsonRequest('POST', {
      to: { type: 'private', botId: createdBot.bot.id },
      media: [
        { photo: { content_base64: gifImage(4, 3).toBase64() }, caption: 'Before' },
        {
          video: {
            content_base64: new TextEncoder().encode('after').toBase64(),
            file_name: 'after.mp4',
            duration: 8,
          },
          caption: 'After',
        },
      ],
    }),
  );
  const received = updateMessages((await callBotApi(api, `${botApiPath}/getUpdates`, {})).body)
    .slice(-2);
  const receivedVideo = received[1]?.video as Record<string, unknown> | undefined;
  if (
    accountAlbum.status !== 201 || typeof received[0]?.media_group_id !== 'string' ||
    received[1].media_group_id !== received[0].media_group_id ||
    photoSizeOf(received[0]) === undefined || receivedVideo?.duration !== 8 ||
    received[1].caption !== 'After'
  ) {
    throw new Error(`Expected the account's album, received ${JSON.stringify(received)}`);
  }

  // The bot answers with videos from an upload, its file_id and a URL, and a photo.
  await api.request(
    `${sessionPath}/web-resources`,
    jsonRequest('POST', {
      url: 'https://cdn.example.com/teaser.mp4',
      content_type: 'video/mp4',
      content_base64: new TextEncoder().encode('teaser').toBase64(),
    }),
  );
  const album = await callBotApiWithFiles(api, `${botApiPath}/sendMediaGroup`, {
    chat_id: chatId,
    media: JSON.stringify([
      {
        type: 'video',
        media: 'attach://clip',
        // The legacy name of `thumbnail`, which the official server still reads.
        thumb: 'attach://preview',
        duration: 100_000,
        width: 640,
        height: 360,
        start_timestamp: 2,
        has_spoiler: true,
        supports_streaming: true,
        caption: '<i>Clip</i>',
        parse_mode: 'HTML',
      },
      { type: 'video', media: receivedVideo.file_id, duration: 1 },
      { type: 'video', media: 'https://cdn.example.com/teaser.mp4', width: 320 },
      { type: 'photo', media: 'attach://still' },
    ]),
  }, {
    clip: new File(['clip'], 'clip.mov'),
    preview: new File([gifImage(32, 18)], 'preview.gif'),
    still: new File([gifImage(16, 9)], 'still.gif'),
  });
  const albumMessages = (album.body as { result?: Record<string, unknown>[] }).result ?? [];
  const albumVideos = albumMessages.map((message) =>
    message.video as Record<string, unknown> | undefined
  );
  if (
    album.status !== 200 || albumMessages.length !== 4 ||
    new Set(albumMessages.map((message) => message.media_group_id)).size !== 1 ||
    albumMessages[0].media_group_id === received[0].media_group_id ||
    albumVideos[0]?.duration !== 86_400 || albumVideos[0].mime_type !== 'video/quicktime' ||
    albumVideos[0].start_timestamp !== 2 ||
    (albumVideos[0].thumbnail as Record<string, unknown> | undefined)?.width !== 32 ||
    albumMessages[0].has_media_spoiler !== true || albumMessages[0].caption !== 'Clip' ||
    albumVideos[1]?.file_unique_id !== receivedVideo.file_unique_id ||
    albumVideos[1]?.duration !== 8 || albumVideos[2]?.file_name !== 'teaser.mp4' ||
    albumVideos[2].width !== 320 || photoSizeOf(albumMessages[3]) === undefined
  ) {
    throw new Error(`Expected the bot's photo and video album, received ${JSON.stringify(album)}`);
  }

  // Forwarding the album's messages together forms a new album of photos and videos.
  const forwarded = await callBotApi(api, `${botApiPath}/forwardMessages`, {
    chat_id: chatId,
    from_chat_id: chatId,
    message_ids: albumMessages.map((message) => message.message_id),
  });
  const historyBefore = await (await api.request(historyPath)).text();
  const forwardedMessages = (JSON.parse(historyBefore) as {
    messages: Array<Record<string, unknown>>;
  }).messages.slice(-4);
  if (
    forwarded.status !== 200 ||
    new Set(forwardedMessages.map((message) => message.media_group_id)).size !== 1 ||
    forwardedMessages[0].media_group_id === albumMessages[0].media_group_id
  ) {
    throw new Error(`Expected a new forwarded album, received ${JSON.stringify(forwarded)}`);
  }
  assertEquals(
    forwardedMessages.map((message) => 'video' in message),
    [true, true, true, false],
    'Expected a new forwarded album',
  );

  const refusals = [
    [{ type: 'video', media: receivedVideo.file_id }, {
      type: 'document',
      media: 'attach://notes',
    }],
    [{ type: 'video', media: receivedVideo.file_id, show_caption_above_media: true }, {
      type: 'photo',
      media: 'attach://still',
    }],
    [{ type: 'video', media: receivedVideo.file_id, cover: 'attach://still' }],
    [{ type: 'video', media: receivedVideo.file_id }, {
      type: 'video',
      media: 'https://cdn.example.com/missing.mp4',
    }],
    [{ type: 'video', media: receivedVideo.file_id }, {
      type: 'video',
      media: photoSizeOf(albumMessages[3])?.file_id,
    }],
  ];
  const descriptions = [];
  for (const media of refusals) {
    const { status, body } = await callBotApiWithFiles(api, `${botApiPath}/sendMediaGroup`, {
      chat_id: chatId,
      media: JSON.stringify(media),
    }, {
      notes: new File(['notes'], 'notes.txt'),
      still: new File([gifImage(16, 9)], 'still.gif'),
    });
    descriptions.push(status === 400 && isBadRequestResponse(body) ? body.description : status);
  }
  const accountRefusal = await api.request(
    `${accountPath}/media-groups`,
    jsonRequest('POST', {
      to: { type: 'private', botId: createdBot.bot.id },
      media: [
        { video: { content_base64: new TextEncoder().encode('clip').toBase64() } },
        {
          document: {
            content_base64: new TextEncoder().encode('notes').toBase64(),
            file_name: 'a.txt',
          },
        },
      ],
    }),
  );
  const expectedDescriptions = [
    "Bad Request: document can't be mixed with other media types",
    'Bad Request: parameter show_caption_above_media must be the same for all messages',
    'Bad Request: invalid sendMediaGroup parameters',
    'Bad Request: failed to send message #2 with the error message "WEBPAGE_CURL_FAILED"',
    "Bad Request: can't use file of type Photo as Video",
  ];
  if (
    accountRefusal.status !== 400 ||
    (await (await api.request(historyPath)).text()) !== historyBefore
  ) {
    throw new Error(
      `Expected Telegram's refusals and no new message, received ${
        JSON.stringify(descriptions, null, 2)
      }`,
    );
  }
  assertEqualsInFieldOrder(
    descriptions,
    expectedDescriptions,
    "Expected Telegram's refusals and no new message",
  );
});
