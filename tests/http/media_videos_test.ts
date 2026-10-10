import { Bot } from 'https://cdn.jsdelivr.net/gh/grammyjs/grammY@^1.46.0/src/bot.ts';
import { InputFile } from 'https://cdn.jsdelivr.net/gh/grammyjs/grammY@^1.46.0/src/types.ts';
import {
  webhookCallback,
} from 'https://cdn.jsdelivr.net/gh/grammyjs/grammY@^1.46.0/src/convenience/webhook.ts';

import { jsonRequest, TEST_PUBLIC_ORIGIN } from '../support/emulation_api.ts';
import { expectSettlementWithin } from '../support/settlement.ts';
import { createInProcessFetch } from '../support/in_process_fetch.ts';
import { isBadRequestResponse } from '../support/http_response_guards.ts';
import {
  botApiResult,
  callBotApi,
  callBotApiWithFiles,
  photoSizeOf,
  updateMessages,
} from '../support/bot_api_requests.ts';
import {
  createBot,
  createPrivateConversationFixture,
  createSupergroupFixture,
} from '../support/http_fixtures.ts';
import { gifImage } from '../support/media_samples.ts';

Deno.test('editMessageMedia puts videos in messages and albums, keeping their place', async () => {
  const { api, owner, member, bot, readerBot, supergroup, supergroupPath, sendSupergroupText } =
    await createSupergroupFixture();
  const chatId = String(supergroup.id);
  const question = await sendSupergroupText(member.id, 'What happened?');
  const editMedia = (messageId: unknown, media: unknown, files: Record<string, File> = {}) =>
    callBotApiWithFiles(api, `${bot.botApiPath}/editMessageMedia`, {
      chat_id: chatId,
      message_id: String(messageId),
      media: JSON.stringify(media),
      reply_markup: JSON.stringify({
        inline_keyboard: [[{ text: 'Replay', callback_data: 'replay' }]],
      }),
    }, files);
  const lastUpdateId = async (botApiPath: string) => {
    const { body } = await callBotApi(api, `${botApiPath}/getUpdates`, {});
    return (body as { result: Array<{ update_id: number }> }).result.at(-1)?.update_id ?? 0;
  };
  const botOffset = await lastUpdateId(bot.botApiPath);
  const readerOffset = await lastUpdateId(readerBot.botApiPath);

  // A text reply becomes a video, keeping its ID, its reply and its place in the chat.
  const answer = botApiResult(
    (await callBotApi(api, `${bot.botApiPath}/sendMessage`, {
      chat_id: supergroup.id,
      text: 'Watch this',
      reply_parameters: { message_id: question.message_id },
    })).body,
  );
  const textToVideo = await editMedia(answer?.message_id, {
    type: 'video',
    media: 'attach://clip',
    thumbnail: 'attach://preview',
    duration: 4,
    width: 640,
    height: 480,
    start_timestamp: 1,
    has_spoiler: true,
    show_caption_above_media: true,
    caption: 'The replay',
  }, {
    clip: new File(['clip'], 'replay.mp4'),
    preview: new File([gifImage(24, 18)], 'preview.gif'),
  });
  const editedAnswer = botApiResult(textToVideo.body);
  const editedVideo = editedAnswer?.video as Record<string, unknown> | undefined;
  if (
    textToVideo.status !== 200 || editedAnswer === undefined ||
    editedAnswer.message_id !== answer?.message_id || 'text' in editedAnswer ||
    (editedAnswer.reply_to_message as Record<string, unknown> | undefined)?.message_id !==
      question.message_id ||
    editedVideo?.duration !== 4 || editedVideo.start_timestamp !== 1 ||
    (editedVideo.thumbnail as Record<string, unknown> | undefined)?.height !== 18 ||
    editedAnswer.has_media_spoiler !== true || editedAnswer.show_caption_above_media !== true ||
    editedAnswer.caption !== 'The replay' || typeof editedAnswer.edit_date !== 'number' ||
    JSON.stringify(editedAnswer.reply_markup) !==
      JSON.stringify({ inline_keyboard: [[{ text: 'Replay', callback_data: 'replay' }]] })
  ) {
    throw new Error(
      `Expected the reply to become a video, received ${JSON.stringify(editedAnswer)}`,
    );
  }

  // In an album, a photo and a video replace each other, while a document stays apart.
  const album = await callBotApiWithFiles(api, `${bot.botApiPath}/sendMediaGroup`, {
    chat_id: chatId,
    media: JSON.stringify([
      { type: 'photo', media: 'attach://still' },
      { type: 'video', media: editedVideo.file_id },
    ]),
  }, { still: new File([gifImage(8, 6)], 'still.gif') });
  const [albumPhoto, albumVideo] = (album.body as { result: Record<string, unknown>[] }).result;
  const documents = await callBotApiWithFiles(api, `${bot.botApiPath}/sendMediaGroup`, {
    chat_id: chatId,
    media: JSON.stringify([
      { type: 'document', media: 'attach://first' },
      { type: 'document', media: 'attach://second' },
    ]),
  }, { first: new File(['1'], 'first.txt'), second: new File(['2'], 'second.txt') });
  const [firstDocument] = (documents.body as { result: Record<string, unknown>[] }).result;
  const photoToVideo = botApiResult(
    (await editMedia(albumPhoto.message_id, { type: 'video', media: editedVideo.file_id })).body,
  );
  const videoToPhoto = botApiResult(
    (await editMedia(albumVideo.message_id, {
      type: 'photo',
      media: 'attach://still',
    }, { still: new File([gifImage(8, 6)], 'still.gif') })).body,
  );
  const refusedEdits = await Promise.all([
    editMedia(albumVideo.message_id, { type: 'document', media: 'attach://notes' }, {
      notes: new File(['notes'], 'notes.txt'),
    }),
    editMedia(firstDocument.message_id, { type: 'video', media: editedVideo.file_id }),
  ]);
  if (
    photoToVideo?.media_group_id !== albumPhoto.media_group_id ||
    (photoToVideo?.video as Record<string, unknown> | undefined)?.file_unique_id !==
      editedVideo.file_unique_id ||
    videoToPhoto?.media_group_id !== albumPhoto.media_group_id ||
    photoSizeOf(videoToPhoto) === undefined ||
    refusedEdits.some(({ status, body }) =>
      status !== 400 || !isBadRequestResponse(body) ||
      body.description !== "Bad Request: can't change media type in the album"
    )
  ) {
    throw new Error(
      `Expected album media to change within its kind, received ${
        JSON.stringify({ photoToVideo, videoToPhoto, refusedEdits })
      }`,
    );
  }

  // Members see the edits in their history; no bot receives an update for a bot's edit.
  const history = await (await api.request(`${supergroupPath(owner.id)}/messages`)).json() as {
    messages: Array<Record<string, unknown>>;
  };
  const shownAnswer = history.messages.find((message) => message.message_id === answer?.message_id);
  const updatesAfter = async (botApiPath: string, offset: number) => {
    const { body } = await callBotApi(api, `${botApiPath}/getUpdates`, { offset: offset + 1 });
    return (body as { result: Array<Record<string, unknown>> }).result.map((update) =>
      Object.keys(update).find((key) => key !== 'update_id')
    );
  };
  const botUpdates = await updatesAfter(bot.botApiPath, botOffset);
  const readerUpdates = await updatesAfter(readerBot.botApiPath, readerOffset);
  if (
    (shownAnswer?.video as Record<string, unknown> | undefined)?.file_unique_id !==
      editedVideo.file_unique_id ||
    botUpdates.length !== 0 || readerUpdates.includes('edited_message')
  ) {
    throw new Error(
      `Expected members to see the video and no bot an edit, received ${
        JSON.stringify({ shownAnswer, botUpdates, readerUpdates })
      }`,
    );
  }
});

Deno.test('an inline message takes a video by file_id or URL but not by upload', async () => {
  const { api, sessionPath, createdBot, createdAccount, sendText } =
    await createPrivateConversationFixture();
  await sendText('/start');
  const chatId = createdAccount.account.id;
  const accountPath = `${sessionPath}/accounts/${chatId}`;
  const inlineBot = await createBot(api, sessionPath, 'clips_bot', {
    supports_inline_queries: true,
    receives_chosen_inline_results: true,
  });
  await api.request(
    `${accountPath}/messages`,
    jsonRequest('POST', { to: { type: 'private', botId: inlineBot.bot.id }, text: '/start' }),
  );
  const queryResponse = await api.request(
    `${accountPath}/inline-queries`,
    jsonRequest('POST', {
      bot_id: inlineBot.bot.id,
      chat: { type: 'private', botId: createdBot.bot.id },
      query: 'clips',
    }),
  );
  const { inline_query: inlineQuery } = await queryResponse.json() as {
    inline_query: { id: string };
  };
  await callBotApi(api, `${inlineBot.botApiPath}/answerInlineQuery`, {
    inline_query_id: inlineQuery.id,
    results: [{
      type: 'article',
      id: 'clips',
      title: 'Clips',
      input_message_content: { message_text: 'Clips' },
      // Telegram gives the bot an inline message ID only for a message with a keyboard.
      reply_markup: { inline_keyboard: [[{ text: 'More', callback_data: 'more' }]] },
    }],
  });
  const chosen = await api.request(
    `${accountPath}/inline-queries/${inlineQuery.id}/chosen-results`,
    jsonRequest('POST', { result_id: 'clips' }),
  );
  const { message: inlineMessage } = await chosen.json() as { message: { message_id: number } };
  const updates = await (await api.request(`${inlineBot.botApiPath}/getUpdates`)).json() as {
    result: Array<{ chosen_inline_result?: { inline_message_id?: string } }>;
  };
  const inlineMessageId = updates.result.find((update) => update.chosen_inline_result !== undefined)
    ?.chosen_inline_result?.inline_message_id;
  const ownVideo = botApiResult(
    (await callBotApiWithFiles(api, `${inlineBot.botApiPath}/sendVideo`, {
      chat_id: String(chatId),
      duration: '6',
    }, { video: new File(['clip'], 'clip.mp4') })).body,
  )?.video as Record<string, unknown> | undefined;
  await api.request(
    `${sessionPath}/web-resources`,
    jsonRequest('POST', {
      url: 'https://cdn.example.com/clip.mp4',
      content_type: 'video/mp4',
      content_base64: new TextEncoder().encode('remote').toBase64(),
    }),
  );
  const editInline = (media: unknown, files: Record<string, File> = {}) =>
    callBotApiWithFiles(api, `${inlineBot.botApiPath}/editMessageMedia`, {
      inline_message_id: String(inlineMessageId),
      media: JSON.stringify(media),
    }, files);
  const historyPath = `${accountPath}/conversations/private/${createdBot.bot.id}/messages`;
  const shownMessage = async () =>
    ((await (await api.request(historyPath)).json()) as {
      messages: Array<Record<string, unknown>>;
    }).messages.find(({ message_id }) => message_id === inlineMessage.message_id);

  const upload = await editInline(
    { type: 'video', media: 'attach://clip' },
    { clip: new File(['clip'], 'clip.mp4') },
  );
  const afterUpload = await shownMessage();
  const byFileId = await editInline({
    type: 'video',
    media: ownVideo?.file_id,
    start_timestamp: 3,
  });
  const afterFileId = await shownMessage();
  const byUrl = await editInline({ type: 'video', media: 'https://cdn.example.com/clip.mp4' });
  const afterUrl = await shownMessage();
  const afterUrlVideo = afterUrl?.video as Record<string, unknown> | undefined;
  if (
    !isBadRequestResponse(upload.body) ||
    upload.body.description !== 'Bad Request: invalid message content specified' ||
    afterUpload?.text !== 'Clips' ||
    JSON.stringify(byFileId.body) !== JSON.stringify({ ok: true, result: true }) ||
    (afterFileId?.video as Record<string, unknown> | undefined)?.start_timestamp !== 3 ||
    JSON.stringify(byUrl.body) !== JSON.stringify({ ok: true, result: true }) ||
    afterUrlVideo?.file_name !== 'clip.mp4' || afterUrlVideo.file_size !== 6
  ) {
    throw new Error(
      `Expected an inline message's video by file_id or URL only, received ${
        JSON.stringify([upload, byFileId, byUrl, afterUrl])
      }`,
    );
  }
});

Deno.test('an account and a bot exchange a video, which the bot downloads and sends again', async () => {
  const { api, sessionPath, botApiPath, createdBot, createdAccount } =
    await createPrivateConversationFixture();
  const accountPath = `${sessionPath}/accounts/${createdAccount.account.id}`;
  const historyPath = `${accountPath}/conversations/private/${createdBot.bot.id}/messages`;
  const videoContent = new TextEncoder().encode('bytes the emulator never decodes');

  const sentResponse = await api.request(
    `${accountPath}/messages`,
    jsonRequest('POST', {
      to: { type: 'private', botId: createdBot.bot.id },
      video: {
        content_base64: videoContent.toBase64(),
        file_name: 'holiday.mov',
        duration: 42,
        width: 1280,
        height: 720,
      },
      caption: 'Watch /start',
      caption_entities: [{ type: 'italic', offset: 0, length: 5 }],
    }),
  );
  const sentMessage = (await sentResponse.json()).message as Record<string, unknown> | undefined;
  const updates = await callBotApi(api, `${botApiPath}/getUpdates`, {});
  const received = updateMessages(updates.body)[0];
  const receivedVideo = received?.video as Record<string, unknown> | undefined;
  if (
    sentResponse.status !== 201 ||
    JSON.stringify(Object.keys(receivedVideo ?? {})) !== JSON.stringify([
        'duration',
        'width',
        'height',
        'file_name',
        'mime_type',
        'file_id',
        'file_unique_id',
        'file_size',
      ]) ||
    receivedVideo?.duration !== 42 || receivedVideo.width !== 1280 ||
    receivedVideo.height !== 720 || receivedVideo.file_name !== 'holiday.mov' ||
    receivedVideo.mime_type !== 'video/quicktime' ||
    receivedVideo.file_size !== videoContent.length ||
    JSON.stringify(sentMessage?.video) !== JSON.stringify(receivedVideo) ||
    received.caption !== 'Watch /start' ||
    JSON.stringify(received.caption_entities) !== JSON.stringify([
        { type: 'italic', offset: 0, length: 5 },
        { type: 'bot_command', offset: 6, length: 6 },
      ]) ||
    'show_caption_above_media' in received || 'has_media_spoiler' in received
  ) {
    throw new Error(`Expected the account's video, received ${JSON.stringify(updates.body)}`);
  }

  const fileResponse = await callBotApi(api, `${botApiPath}/getFile`, {
    file_id: receivedVideo.file_id,
  });
  const filePath = botApiResult(fileResponse.body)?.file_path;
  const download = await api.request(
    `${sessionPath}/bot-api/file/bot${createdBot.token}/${filePath}`,
  );
  if (
    filePath !== 'videos/file_0.mov' || download.status !== 200 ||
    download.headers.get('Content-Type') !== 'video/quicktime' ||
    new Uint8Array(await download.arrayBuffer()).toBase64() !== videoContent.toBase64()
  ) {
    throw new Error(`Expected the bot to download the video, received ${filePath}`);
  }

  // A video sent again by file_id keeps its own attributes, whatever the request specifies.
  const reply = await callBotApi(api, `${botApiPath}/sendVideo`, {
    chat_id: createdAccount.account.id,
    video: receivedVideo.file_id,
    duration: 1,
    width: 2,
    height: 3,
    start_timestamp: 7,
    caption: '<b>Again</b>',
    parse_mode: 'HTML',
    show_caption_above_media: true,
    has_spoiler: true,
    reply_parameters: { message_id: received.message_id },
  });
  const replyMessage = botApiResult(reply.body);
  const replyVideo = replyMessage?.video as Record<string, unknown> | undefined;
  const expectedReplyVideo = {
    duration: 42,
    width: 1280,
    height: 720,
    file_name: 'holiday.mov',
    mime_type: 'video/quicktime',
    start_timestamp: 7,
    file_id: receivedVideo.file_id,
    file_unique_id: receivedVideo.file_unique_id,
    file_size: videoContent.length,
  };
  if (
    reply.status !== 200 || JSON.stringify(replyVideo) !== JSON.stringify(expectedReplyVideo) ||
    replyMessage?.caption !== 'Again' || replyMessage.show_caption_above_media !== true ||
    replyMessage.has_media_spoiler !== true ||
    (replyMessage.reply_to_message as Record<string, unknown> | undefined)?.message_id !==
      received.message_id
  ) {
    throw new Error(`Expected the video to be sent again, received ${JSON.stringify(reply.body)}`);
  }

  const history = await (await api.request(historyPath)).json() as {
    messages: Array<Record<string, unknown>>;
  };
  const sessionDownload = await api.request(
    `${sessionPath}/files/${receivedVideo.file_unique_id}`,
  );
  const activity = await (await api.request(
    `${sessionPath}/bot-activity?kind=bot_api_call&bot_id=${createdBot.bot.id}`,
  )).json() as { entries: Array<{ method: string; answer: { ok: boolean } }> };
  if (
    JSON.stringify(history.messages.map((message) => message.video)) !==
      JSON.stringify([receivedVideo, expectedReplyVideo]) ||
    sessionDownload.status !== 200 ||
    new Uint8Array(await sessionDownload.arrayBuffer()).toBase64() !==
      videoContent.toBase64() ||
    !activity.entries.some(({ method, answer }) => method === 'sendVideo' && answer.ok)
  ) {
    throw new Error(
      `Expected the history to show both videos, received ${JSON.stringify(history)}`,
    );
  }
});

Deno.test('sendVideo keeps the attributes bots define and follows Telegram checks', async () => {
  const { api, sessionPath, botApiPath, createdBot, createdAccount, sendText } =
    await createPrivateConversationFixture();
  await sendText('/start');
  const chatId = String(createdAccount.account.id);
  const sendVideo = async (parameters: Record<string, string>, files: Record<string, File>) => {
    const { status, body } = await callBotApiWithFiles(
      api,
      `${botApiPath}/sendVideo`,
      { chat_id: chatId, ...parameters },
      files,
    );
    const message = botApiResult(body);
    const video = message?.video as Record<string, unknown> | undefined;
    if (status !== 200 || message === undefined || video === undefined) {
      throw new Error(`Expected a video to be sent, received ${status} ${JSON.stringify(body)}`);
    }
    return { message, video };
  };

  // The Bot API server clamps the attributes it passes on, as its `get_integer_arg` does.
  const uploaded = await sendVideo({
    video: 'attach://clip',
    thumbnail: 'attach://preview',
    duration: '100000',
    width: '-5',
    height: '720',
    supports_streaming: 'true',
    caption: '<b>Clip</b>',
    parse_mode: 'HTML',
  }, {
    clip: new File(['mp4'], 'folder/clip?.mp4'),
    preview: new File([gifImage(90, 60)], 'preview.gif'),
  });
  const thumbnail = uploaded.video.thumbnail as Record<string, unknown> | undefined;
  if (
    JSON.stringify(Object.keys(uploaded.video)) !== JSON.stringify([
        'duration',
        'width',
        'height',
        'file_name',
        'mime_type',
        'thumbnail',
        'thumb',
        'file_id',
        'file_unique_id',
        'file_size',
      ]) ||
    uploaded.video.duration !== 86_400 || uploaded.video.width !== 0 ||
    uploaded.video.height !== 720 || uploaded.video.file_name !== 'clip.mp4' ||
    uploaded.video.mime_type !== 'video/mp4' ||
    JSON.stringify(uploaded.video.thumb) !== JSON.stringify(thumbnail) ||
    thumbnail?.width !== 90 || uploaded.message.caption !== 'Clip'
  ) {
    throw new Error(`Expected the uploaded video, received ${JSON.stringify(uploaded.message)}`);
  }
  const thumbnailFile = await callBotApi(api, `${botApiPath}/getFile`, {
    file_id: thumbnail.file_id,
  });
  if (botApiResult(thumbnailFile.body)?.file_path !== 'thumbnails/file_0.gif') {
    throw new Error(`Expected a thumbnail path, received ${JSON.stringify(thumbnailFile.body)}`);
  }

  // As TDLib uploads it, a video whose name names no video type is an MPEG-4 video.
  const misnamed = await sendVideo({}, { video: new File(['mp4'], 'notes.txt') });
  await api.request(
    `${sessionPath}/web-resources`,
    jsonRequest('POST', {
      url: 'https://cdn.example.com/media/intro.mp4',
      content_type: 'video/mp4',
      content_base64: new TextEncoder().encode('intro').toBase64(),
    }),
  );
  const downloaded = await sendVideo({
    video: 'https://cdn.example.com/media/intro.mp4',
    duration: '5',
    thumbnail: 'attach://preview',
  }, { preview: new File([gifImage(90, 60)], 'preview.gif') });
  // A URL whose path names no file gives a video without a name.
  await api.request(
    `${sessionPath}/web-resources`,
    jsonRequest('POST', {
      url: 'https://cdn.example.com/media/',
      content_type: 'video/mp4',
      content_base64: new TextEncoder().encode('index').toBase64(),
    }),
  );
  const unnamed = await sendVideo({ video: 'https://cdn.example.com/media/' }, {});
  if (
    misnamed.video.mime_type !== 'video/mp4' || misnamed.video.file_name !== 'notes.txt' ||
    'file_name' in unnamed.video || unnamed.video.mime_type !== 'video/mp4' ||
    JSON.stringify(downloaded.video) !== JSON.stringify({
        duration: 5,
        width: 0,
        height: 0,
        file_name: 'intro.mp4',
        mime_type: 'video/mp4',
        file_id: downloaded.video.file_id,
        file_unique_id: downloaded.video.file_unique_id,
        file_size: 5,
      })
  ) {
    throw new Error(
      `Expected an MPEG-4 upload, a URL video without a thumbnail and one without a name, received ${
        JSON.stringify([misnamed.video, downloaded.video, unnamed.video])
      }`,
    );
  }

  const document = botApiResult(
    (await callBotApiWithFiles(api, `${botApiPath}/sendDocument`, { chat_id: chatId }, {
      document: new File(['a,b'], 'report.csv'),
    })).body,
  )?.document as Record<string, unknown>;
  const photo = photoSizeOf(
    botApiResult(
      (await callBotApiWithFiles(api, `${botApiPath}/sendPhoto`, { chat_id: chatId }, {
        photo: new File([gifImage(4, 3)], 'chart.gif'),
      })).body,
    ),
  );
  await api.request(
    `${sessionPath}/web-resources`,
    jsonRequest('POST', {
      url: 'https://cdn.example.com/media/intro.webm',
      content_type: 'video/webm',
      content_base64: new TextEncoder().encode('intro').toBase64(),
    }),
  );
  const historyPath =
    `${sessionPath}/accounts/${chatId}/conversations/private/${createdBot.bot.id}/messages`;
  const historyBefore = await (await api.request(historyPath)).text();
  const failures: {
    method: string;
    parameters: Record<string, string>;
    files: Record<string, File>;
  }[] = [
    { method: 'sendVideo', parameters: {}, files: {} },
    { method: 'sendVideo', parameters: { video: 'attach://missing' }, files: {} },
    { method: 'sendVideo', parameters: {}, files: { video: new File([], 'empty.mp4') } },
    { method: 'sendVideo', parameters: { video: String(document.file_id) }, files: {} },
    { method: 'sendVideo', parameters: { video: String(photo?.file_id) }, files: {} },
    { method: 'sendDocument', parameters: { document: String(uploaded.video.file_id) }, files: {} },
    { method: 'sendPhoto', parameters: { photo: String(uploaded.video.file_id) }, files: {} },
    { method: 'sendVideo', parameters: { video: String(thumbnail.file_id) }, files: {} },
    { method: 'sendVideo', parameters: { video: 'BAACAgIAAxkBAAIBdGZ' }, files: {} },
    {
      method: 'sendVideo',
      parameters: { video: 'https://cdn.example.com/media/intro.webm' },
      files: {},
    },
    {
      method: 'sendVideo',
      parameters: { video: 'https://cdn.example.com/media/missing.mp4' },
      files: {},
    },
    {
      method: 'sendVideo',
      parameters: { video: String(uploaded.video.file_id), caption: 'x'.repeat(1_025) },
      files: {},
    },
    {
      method: 'sendVideo',
      parameters: { video: String(uploaded.video.file_id), cover: String(photo?.file_id) },
      files: {},
    },
    {
      method: 'sendVideo',
      parameters: { video: String(uploaded.video.file_id), duration: 'long' },
      files: {},
    },
  ];
  const descriptions = [];
  for (const { method, parameters, files } of failures) {
    const { status, body } = await callBotApiWithFiles(
      api,
      `${botApiPath}/${method}`,
      { chat_id: chatId, ...parameters },
      files,
    );
    descriptions.push(status === 400 && isBadRequestResponse(body) ? body.description : status);
  }
  const missingChat = await callBotApi(api, `${botApiPath}/sendVideo`, {
    video: uploaded.video.file_id,
  });
  descriptions.push(isBadRequestResponse(missingChat.body) ? missingChat.body.description : 0);
  const expectedDescriptions = [
    'Bad Request: there is no video in the request',
    'Bad Request: there is no video in the request',
    'Bad Request: file must be non-empty',
    "Bad Request: can't use file of type Document as Video",
    "Bad Request: can't use file of type Photo as Video",
    "Bad Request: can't use file of type Video as Document",
    "Bad Request: can't use file of type Video as Photo",
    "Bad Request: can't use file of type Thumbnail as Video",
    'Bad Request: wrong file identifier/HTTP URL specified',
    'Bad Request: wrong type of the web page content',
    'Bad Request: failed to get HTTP URL content',
    'Bad Request: message caption is too long',
    'Bad Request: invalid sendVideo parameters',
    'Bad Request: invalid sendVideo parameters',
    'Bad Request: chat_id is empty',
  ];
  if (
    JSON.stringify(descriptions) !== JSON.stringify(expectedDescriptions) ||
    (await (await api.request(historyPath)).text()) !== historyBefore
  ) {
    throw new Error(
      `Expected Telegram's errors and no new message, received ${
        JSON.stringify(descriptions, null, 2)
      }`,
    );
  }
});

Deno.test('bots reuse only video file IDs they know, in their own session', async () => {
  const { api, sessionPath, botApiPath, createdBot, createdAccount, sendText } =
    await createPrivateConversationFixture();
  const otherSession = await createPrivateConversationFixture();
  await sendText('/start');
  await otherSession.sendText('/start');
  const otherBot = await createBot(api, sessionPath, 'other_bot');
  const accountPath = `${sessionPath}/accounts/${createdAccount.account.id}`;
  for (const botId of [createdBot.bot.id, otherBot.bot.id]) {
    const response = await api.request(
      `${accountPath}/messages`,
      jsonRequest('POST', {
        to: { type: 'private', botId },
        video: { content_base64: new TextEncoder().encode('clip').toBase64() },
      }),
    );
    if (response.status !== 201) {
      throw new Error(`Expected the account to send a video, received ${response.status}`);
    }
  }
  const lastVideo = (body: unknown) =>
    updateMessages(body).at(-1)?.video as Record<string, unknown> | undefined;
  const ownVideo = lastVideo((await callBotApi(api, `${botApiPath}/getUpdates`, {})).body);
  const otherBotVideo = lastVideo(
    (await callBotApi(api, `${sessionPath}/bot-api/bot${otherBot.token}/getUpdates`, {})).body,
  );
  if (
    ownVideo?.mime_type !== 'video/mp4' || 'file_name' in ownVideo ||
    otherBotVideo?.file_id === ownVideo.file_id
  ) {
    throw new Error(`Expected each bot to know its video, received ${JSON.stringify(ownVideo)}`);
  }

  const refusals = await Promise.all([
    callBotApi(api, `${botApiPath}/sendVideo`, {
      chat_id: createdAccount.account.id,
      video: otherBotVideo?.file_id,
    }),
    callBotApi(otherSession.api, `${otherSession.botApiPath}/sendVideo`, {
      chat_id: otherSession.createdAccount.account.id,
      video: ownVideo.file_id,
    }),
  ]);
  const otherSessionDownload = await otherSession.api.request(
    `${otherSession.sessionPath}/files/${ownVideo.file_unique_id}`,
  );
  await api.request(sessionPath, { method: 'DELETE' });
  const endedSessionDownload = await api.request(
    `${sessionPath}/files/${ownVideo.file_unique_id}`,
  );
  if (
    refusals.some(({ status, body }) =>
      status !== 400 || !isBadRequestResponse(body) ||
      body.description !== 'Bad Request: wrong file identifier/HTTP URL specified'
    ) ||
    otherSessionDownload.status !== 404 || endedSessionDownload.status !== 404
  ) {
    throw new Error(`Expected foreign file IDs to fail, received ${JSON.stringify(refusals)}`);
  }
});

Deno.test('supergroup bots receive videos as they would other messages, each by its own file_id', async () => {
  const { api, owner, member, bot, readerBot, supergroup, supergroupPath, sessionPath } =
    await createSupergroupFixture();
  const lastUpdateId = async (botApiPath: string, allowedUpdates: readonly string[]) => {
    const { body } = await callBotApi(api, `${botApiPath}/getUpdates`, {
      allowed_updates: allowedUpdates,
    });
    return (body as { result: Array<{ update_id: number }> }).result.at(-1)?.update_id ?? 0;
  };
  // The bot in privacy mode subscribes to new messages only.
  const botOffset = await lastUpdateId(bot.botApiPath, ['message']);
  const readerOffset = await lastUpdateId(readerBot.botApiPath, []);
  const sendVideo = async (accountId: number, caption: string) => {
    const response = await api.request(
      `${sessionPath}/accounts/${accountId}/messages`,
      jsonRequest('POST', {
        to: { type: 'supergroup', chatId: supergroup.id },
        video: { content_base64: new TextEncoder().encode(caption).toBase64(), duration: 3 },
        caption,
      }),
    );
    const body = await response.json();
    if (response.status !== 201) {
      throw new Error(`Expected the video to be sent, received ${response.status}`);
    }
    return body.message as Record<string, unknown>;
  };

  const command = await sendVideo(owner.id, '/start');
  await sendVideo(member.id, 'Just a clip');
  const edit = await api.request(
    `${supergroupPath(owner.id)}/messages/${command.message_id}`,
    jsonRequest('PATCH', { caption: '/help' }),
  );
  const botCopy = await callBotApi(api, `${bot.botApiPath}/copyMessage`, {
    chat_id: supergroup.id,
    from_chat_id: supergroup.id,
    message_id: command.message_id,
  });

  const receivedUpdates = async (botApiPath: string, offset: number) => {
    const { body } = await callBotApi(api, `${botApiPath}/getUpdates`, { offset: offset + 1 });
    return (body as {
      result: Array<
        Record<string, { caption?: string; video?: { file_id: string; file_unique_id: string } }>
      >;
    }).result.map((update) => {
      const [kind, message] = Object.entries(update).find(([key]) => key !== 'update_id') ?? [];
      return { kind, caption: message?.caption, video: message?.video };
    });
  };
  const botUpdates = await receivedUpdates(bot.botApiPath, botOffset);
  const readerUpdates = await receivedUpdates(readerBot.botApiPath, readerOffset);
  const commandVideo = command.video as { file_unique_id: string };
  if (
    edit.status !== 200 || botCopy.status !== 200 ||
    JSON.stringify(botUpdates.map(({ kind, caption }) => [kind, caption])) !==
      JSON.stringify([['message', '/start']]) ||
    JSON.stringify(readerUpdates.map(({ kind, caption }) => [kind, caption])) !==
      JSON.stringify([
        ['message', '/start'],
        ['message', 'Just a clip'],
        ['edited_message', '/help'],
      ]) ||
    botUpdates[0].video?.file_unique_id !== commandVideo.file_unique_id ||
    readerUpdates[0].video?.file_unique_id !== commandVideo.file_unique_id ||
    botUpdates[0].video?.file_id === readerUpdates[0].video?.file_id ||
    JSON.stringify(readerUpdates[2].video) !== JSON.stringify(readerUpdates[0].video)
  ) {
    throw new Error(
      `Expected addressed videos and the edit for subscribed bots, received ${
        JSON.stringify({ botUpdates, readerUpdates })
      }`,
    );
  }
});

Deno.test('forwards, copies and replies from other chats show videos with their start', async () => {
  const { api, sessionPath, member, bot, supergroup } = await createSupergroupFixture();
  const privateChatId = member.id;
  const started = await api.request(
    `${sessionPath}/accounts/${member.id}/messages`,
    jsonRequest('POST', { to: { type: 'private', botId: bot.bot.id }, text: 'Hello' }),
  );
  const sent = await callBotApiWithFiles(api, `${bot.botApiPath}/sendVideo`, {
    chat_id: String(privateChatId),
    caption: 'Trailer',
    has_spoiler: 'true',
    start_timestamp: '3',
    duration: '60',
  }, { video: new File(['mp4'], 'trailer.mp4') });
  const sentMessage = botApiResult(sent.body);
  const sentVideo = sentMessage?.video as Record<string, unknown> | undefined;
  const text = botApiResult(
    (await callBotApi(api, `${bot.botApiPath}/sendMessage`, {
      chat_id: privateChatId,
      text: 'Plain',
    })).body,
  );
  if (started.status !== 201 || sentVideo?.start_timestamp !== 3) {
    throw new Error(`Expected a video starting at 3 s, received ${JSON.stringify(sent.body)}`);
  }
  const repeat = async (method: string, parameters: Record<string, unknown>) => {
    const { status, body } = await callBotApi(api, `${bot.botApiPath}/${method}`, {
      chat_id: supergroup.id,
      from_chat_id: privateChatId,
      ...parameters,
    });
    if (status !== 200) {
      throw new Error(`Expected ${method} to succeed, received ${JSON.stringify(body)}`);
    }
    return botApiResult(body);
  };

  const forwarded = await repeat('forwardMessage', {
    message_id: sentMessage?.message_id,
    video_start_timestamp: 12,
  });
  const forwardedFromStart = await repeat('forwardMessage', {
    message_id: sentMessage?.message_id,
    video_start_timestamp: -4,
  });
  const forwardedText = await repeat('forwardMessage', {
    message_id: text?.message_id,
    video_start_timestamp: 5,
  });
  await repeat('copyMessage', {
    message_id: sentMessage?.message_id,
    caption: 'Copy',
    video_start_timestamp: 4,
  });
  await callBotApi(api, `${bot.botApiPath}/copyMessages`, {
    chat_id: supergroup.id,
    from_chat_id: privateChatId,
    message_ids: [sentMessage?.message_id],
    remove_caption: true,
  });
  const reply = await callBotApi(api, `${bot.botApiPath}/sendMessage`, {
    chat_id: supergroup.id,
    text: 'From the private chat',
    reply_parameters: { chat_id: privateChatId, message_id: sentMessage?.message_id },
  });

  const history = await (await api.request(
    `${sessionPath}/accounts/${member.id}/conversations/supergroup/${supergroup.id}/messages`,
  )).json() as { messages: Array<Record<string, unknown>> };
  const shown = history.messages.slice(-6).map((message) => {
    const video = (message.video ??
      (message.external_reply as Record<string, unknown> | undefined)?.video) as
        | Record<string, unknown>
        | undefined;
    return [
      message.caption ?? message.text ?? null,
      video !== undefined && video.file_unique_id === sentVideo.file_unique_id
        ? video.start_timestamp ?? 0
        : null,
      message.has_media_spoiler ??
        (message.external_reply as Record<string, unknown> | undefined)?.has_media_spoiler ??
        false,
    ];
  });
  const externalReply = botApiResult(reply.body)?.external_reply as Record<string, unknown>;
  if (
    JSON.stringify(shown) !== JSON.stringify([
        ['Trailer', 12, true],
        ['Trailer', 0, true],
        ['Plain', null, false],
        ['Copy', 4, true],
        [null, 3, true],
        ['From the private chat', 3, true],
      ]) ||
    (forwarded?.forward_origin as Record<string, unknown> | undefined)?.type !== 'user' ||
    forwardedFromStart?.video === undefined || forwardedText?.text !== 'Plain' ||
    'caption' in externalReply ||
    JSON.stringify(botApiResult(reply.body)?.quote) !==
      JSON.stringify({ text: 'Trailer', position: 0 })
  ) {
    throw new Error(`Expected each video with its start, received ${JSON.stringify(shown)}`);
  }
});

Deno.test('bots and accounts edit the captions and media of video messages', async () => {
  const { api, sessionPath, botApiPath, createdBot, createdAccount, sendText } =
    await createPrivateConversationFixture();
  await sendText('/start');
  const chatId = createdAccount.account.id;
  const accountPath = `${sessionPath}/accounts/${chatId}`;
  const sent = await callBotApiWithFiles(api, `${botApiPath}/sendVideo`, {
    chat_id: String(chatId),
    caption: 'Draft',
  }, { video: new File(['mp4'], 'draft.mp4') });
  const sentMessage = botApiResult(sent.body);
  const messageId = sentMessage?.message_id;

  const captionEdit = await callBotApi(api, `${botApiPath}/editMessageCaption`, {
    chat_id: chatId,
    message_id: messageId,
    caption: 'Final',
    show_caption_above_media: true,
  });
  const unchangedEdit = await callBotApi(api, `${botApiPath}/editMessageCaption`, {
    chat_id: chatId,
    message_id: messageId,
    caption: 'Final',
    show_caption_above_media: true,
  });
  const editedMessage = botApiResult(captionEdit.body);
  if (
    captionEdit.status !== 200 || editedMessage?.caption !== 'Final' ||
    editedMessage.show_caption_above_media !== true ||
    JSON.stringify(editedMessage.video) !== JSON.stringify(sentMessage?.video) ||
    unchangedEdit.status !== 400 || !isBadRequestResponse(unchangedEdit.body) ||
    !unchangedEdit.body.description.startsWith('Bad Request: message is not modified')
  ) {
    throw new Error(
      `Expected a caption edit of the video, received ${JSON.stringify(captionEdit)}`,
    );
  }

  // A video message's media is replaced as a photo's or document's is.
  const mediaEdit = await callBotApiWithFiles(api, `${botApiPath}/editMessageMedia`, {
    chat_id: String(chatId),
    message_id: String(messageId),
    media: JSON.stringify({ type: 'photo', media: 'attach://chart', caption: 'Chart' }),
  }, { chart: new File([gifImage(4, 3)], 'chart.gif') });
  const replaced = botApiResult(mediaEdit.body);
  if (
    mediaEdit.status !== 200 || replaced === undefined || replaced.message_id !== messageId ||
    'video' in replaced ||
    photoSizeOf(replaced) === undefined || replaced.caption !== 'Chart'
  ) {
    throw new Error(`Expected the video to become a photo, received ${JSON.stringify(mediaEdit)}`);
  }

  // An account edits the caption of its own video, which the bot receives as an edit.
  const accountVideo = await api.request(
    `${accountPath}/messages`,
    jsonRequest('POST', {
      to: { type: 'private', botId: createdBot.bot.id },
      video: { content_base64: new TextEncoder().encode('clip').toBase64(), file_name: 'a.mp4' },
      caption: 'Mine',
    }),
  );
  const accountMessage = (await accountVideo.json()).message as Record<string, unknown>;
  const accountEdit = await api.request(
    `${accountPath}/conversations/private/${createdBot.bot.id}/messages/${accountMessage.message_id}`,
    jsonRequest('PATCH', { caption: 'Mine, edited' }),
  );
  const editUpdate = updateMessages(
    (await callBotApi(api, `${botApiPath}/getUpdates`, {})).body,
  ).at(-1);
  if (
    accountEdit.status !== 200 || editUpdate?.caption !== 'Mine, edited' ||
    JSON.stringify(editUpdate.video) !== JSON.stringify(accountMessage.video)
  ) {
    throw new Error(`Expected the account's caption edit, received ${JSON.stringify(editUpdate)}`);
  }
});

Deno.test('a grammY bot receives a video through its webhook and answers with one', async () => {
  const { api, sessionPath, createdBot, createdAccount } = await createPrivateConversationFixture();
  const grammyBot = new Bot(createdBot.token, {
    client: {
      apiRoot: `${TEST_PUBLIC_ORIGIN}${sessionPath}/bot-api`,
      fetch: createInProcessFetch(api.fetch),
    },
  });
  const receivedDurations: number[] = [];
  grammyBot.on('message:video', async (context) => {
    receivedDurations.push(context.msg.video.duration);
    await context.replyWithVideo(new InputFile(new TextEncoder().encode('reply'), 'reply.mp4'), {
      duration: 2,
      width: 320,
      height: 240,
      thumbnail: new InputFile(gifImage(32, 24), 'thumb.gif'),
      caption: `Got ${context.msg.video.file_name}`,
      reply_parameters: { message_id: context.msg.message_id },
    });
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
    const sent = await api.request(
      `${accountPath}/messages`,
      jsonRequest('POST', {
        to: { type: 'private', botId: createdBot.bot.id },
        video: {
          content_base64: new TextEncoder().encode('clip').toBase64(),
          file_name: 'clip.mp4',
          duration: 9,
        },
      }),
    );
    const history = await expectSettlementWithin(
      (async () => {
        for (;;) {
          const { messages } = await (await api.request(historyPath)).json() as {
            messages: Array<Record<string, unknown>>;
          };
          if (messages.length === 2) {
            return messages;
          }
          await new Promise((resolve) => setTimeout(resolve, 5));
        }
      })(),
      5_000,
      'Expected the bot to answer the video with one',
    );
    const answer = history[1];
    const answerVideo = answer.video as Record<string, unknown> | undefined;
    if (
      sent.status !== 201 || JSON.stringify(receivedDurations) !== JSON.stringify([9]) ||
      answer.caption !== 'Got clip.mp4' || answerVideo?.duration !== 2 ||
      answerVideo.width !== 320 ||
      (answerVideo.thumbnail as Record<string, unknown> | undefined)?.height !== 24 ||
      (answer.reply_to_message as Record<string, unknown>).message_id !== history[0].message_id
    ) {
      throw new Error(`Expected the bot's video answer, received ${JSON.stringify(history)}`);
    }
  } finally {
    await api.request(sessionPath, { method: 'DELETE' });
    await webhookServer.shutdown();
  }
});
