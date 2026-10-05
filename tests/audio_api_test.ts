import { Bot } from 'https://cdn.jsdelivr.net/gh/grammyjs/grammY@^1.46.0/src/bot.ts';
import { InputFile } from 'https://cdn.jsdelivr.net/gh/grammyjs/grammY@^1.46.0/src/types.ts';
import {
  createTestSession,
  type EmulationApi,
  requestJson,
  TEST_PUBLIC_ORIGIN,
} from './support/emulation_api.ts';

interface TestPhotoSize {
  readonly file_id: string;
  readonly file_unique_id: string;
  readonly width: number;
  readonly height: number;
}

interface TestAudio {
  readonly duration: number;
  readonly file_name?: string;
  readonly mime_type: string;
  readonly title?: string;
  readonly performer?: string;
  readonly thumbnail?: TestPhotoSize;
  readonly thumb?: TestPhotoSize;
  readonly file_id: string;
  readonly file_unique_id: string;
  readonly file_size: number;
}

interface TestMessage {
  readonly message_id: number;
  readonly from?: { readonly id: number };
  readonly text?: string;
  readonly caption?: string;
  readonly audio?: TestAudio;
  readonly voice?: { readonly file_id: string };
  readonly document?: { readonly file_id: string; readonly file_name: string };
  readonly photo?: readonly TestPhotoSize[];
  readonly media_group_id?: string;
  readonly reply_to_message?: { readonly message_id: number };
  readonly external_reply?: { readonly audio?: TestAudio };
  readonly via_bot?: { readonly id: number };
}

interface TestBotApiAnswer<Result = unknown> {
  readonly ok: boolean;
  readonly result?: Result;
  readonly description?: string;
}

interface TestInlineQuery {
  readonly id: string;
  readonly answer: { readonly results: readonly Record<string, unknown>[] } | null;
}

/** Bytes that stand in for an MP3 file; the emulator reads no audio content or tags. */
const TRACK_BYTES = new TextEncoder().encode('ID3 engines');
const DRIVE_URL = 'https://cdn.example.com/songs/drive.mp3';
const OGG_URL = 'https://cdn.example.com/songs/drive.ogg';

/**
 * Creates a session where Ada has started a private chat with the inline bot and owns a supergroup
 * with Grace and the bot, and the emulated web serves an MP3 file and an OGG file.
 */
async function createAudioFixture() {
  const { api, sessionPath } = await createTestSession();
  const createAccount = async (firstName: string) =>
    (await requestJson<{ account: { id: number } }>(api, 'POST', `${sessionPath}/accounts`, {
      first_name: firstName,
    })).body.account;
  const ada = await createAccount('Ada');
  const grace = await createAccount('Grace');
  const createBot = async (username: string) => {
    const { body } = await requestJson<{ token: string; bot: { id: number } }>(
      api,
      'POST',
      `${sessionPath}/bots`,
      {
        first_name: 'Music Bot',
        username,
        supports_inline_queries: true,
        receives_chosen_inline_results: true,
      },
    );
    return {
      ...body.bot,
      token: body.token,
      botApiPath: `${sessionPath}/bot-api/bot${body.token}`,
    };
  };
  const bot = await createBot('music_bot');
  const otherBot = await createBot('other_music_bot');
  const accountPath = (accountId: number) => `${sessionPath}/accounts/${accountId}`;
  const privateChat = { type: 'private', botId: bot.id } as const;
  const sendAccountMessage = (accountId: number, body: Record<string, unknown>) =>
    requestJson<{ message: TestMessage }>(api, 'POST', `${accountPath(accountId)}/messages`, body);
  const sendAccountAlbum = (
    accountId: number,
    to: Record<string, unknown>,
    media: readonly Record<string, unknown>[],
  ) =>
    requestJson<{ messages: TestMessage[] }>(
      api,
      'POST',
      `${accountPath(accountId)}/media-groups`,
      { to, media },
    );
  await sendAccountMessage(ada.id, { to: privateChat, text: '/start' });

  const { body: { supergroup } } = await requestJson<{ supergroup: { id: number } }>(
    api,
    'POST',
    `${accountPath(ada.id)}/supergroups`,
    { title: 'Band' },
  );
  const supergroupChat = { type: 'supergroup', chatId: supergroup.id } as const;
  const supergroupPath = (accountId: number) =>
    `${accountPath(accountId)}/conversations/supergroup/${supergroup.id}`;
  for (const memberId of [grace.id, bot.id]) {
    await api.request(`${supergroupPath(ada.id)}/members/${memberId}`, { method: 'PUT' });
  }

  for (
    const [url, contentType] of [[DRIVE_URL, 'audio/mpeg'], [OGG_URL, 'audio/ogg']] as const
  ) {
    await requestJson(api, 'POST', `${sessionPath}/web-resources`, {
      url,
      content_type: contentType,
      content_base64: new TextEncoder().encode('drive').toBase64(),
    });
  }

  const callBot = <Result = unknown>(
    botApiPath: string,
    method: string,
    parameters: Record<string, unknown>,
  ) => requestJson<TestBotApiAnswer<Result>>(api, 'POST', `${botApiPath}/${method}`, parameters);
  const getHistory = async (accountId: number, chat: typeof privateChat | typeof supergroupChat) =>
    (await requestJson<{ messages: TestMessage[] }>(
      api,
      'GET',
      chat.type === 'private'
        ? `${accountPath(accountId)}/conversations/private/${chat.botId}/messages`
        : `${supergroupPath(accountId)}/messages`,
    )).body.messages;
  const readUpdates = createUpdateReader(api, bot.botApiPath);
  await readUpdates();

  return {
    api,
    sessionPath,
    ada,
    grace,
    bot,
    otherBot,
    accountPath,
    privateChat,
    supergroupChat,
    supergroupPath,
    sendAccountMessage,
    sendAccountAlbum,
    callBot,
    getHistory,
    readUpdates,
  };
}

/** Returns a reader of the bot's messages since the reader last read its updates. */
function createUpdateReader(api: EmulationApi, botApiPath: string) {
  let nextOffset = 0;
  return async (): Promise<Array<Record<string, unknown>>> => {
    const { body } = await requestJson<{ result: Array<Record<string, unknown>> }>(
      api,
      'POST',
      `${botApiPath}/getUpdates`,
      { offset: nextOffset },
    );
    const lastUpdateId = body.result.at(-1)?.update_id;
    if (typeof lastUpdateId === 'number') {
      nextOffset = lastUpdateId + 1;
    }
    return body.result.map(({ update_id: _updateId, ...update }) => update);
  };
}

/** Calls a Bot API method with multipart form data, which carries uploaded files. */
async function callBotWithFiles<Result = unknown>(
  api: EmulationApi,
  methodPath: string,
  parameters: Record<string, string>,
  files: Record<string, File>,
): Promise<{ body: TestBotApiAnswer<Result> }> {
  const body = new FormData();
  for (const [name, value] of Object.entries(parameters)) {
    body.append(name, value);
  }
  for (const [name, file] of Object.entries(files)) {
    body.append(name, file);
  }
  const response = await api.request(methodPath, { method: 'POST', body });
  return { body: await response.json() };
}

/** The header of a GIF image, which is all the emulator reads of a thumbnail. */
function gifImage(width: number, height: number): Uint8Array<ArrayBuffer> {
  const image = new Uint8Array(13);
  image.set(new TextEncoder().encode('GIF89a'));
  const view = new DataView(image.buffer);
  view.setUint16(6, width, true);
  view.setUint16(8, height, true);
  return image;
}

function expectEqual(actual: unknown, expected: unknown, message: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `${message}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`,
    );
  }
}

/** The audio of a message, which must have one. */
function audioOf(message: TestMessage | undefined): TestAudio {
  if (message?.audio === undefined) {
    throw new Error(`Expected an audio message, received ${JSON.stringify(message)}`);
  }
  return message.audio;
}

Deno.test('an account uploads a track that the bot inspects, downloads, and sends back by file_id', async () => {
  const {
    api,
    sessionPath,
    ada,
    bot,
    privateChat,
    sendAccountMessage,
    callBot,
    getHistory,
    readUpdates,
  } = await createAudioFixture();
  const sent = await sendAccountMessage(ada.id, {
    to: privateChat,
    audio: {
      content_base64: TRACK_BYTES.toBase64(),
      file_name: 'engines.mp3',
      duration: 215,
      performer: 'Ada',
      title: 'Engines',
    },
    caption: 'Listen',
  });
  const [update] = await readUpdates();
  const received = (update?.message ?? {}) as TestMessage;
  const audio = audioOf(received);
  // The official server's `JsonAudio` writes its fields in this order.
  expectEqual(
    [sent.status, Object.keys(audio), audio, received.caption],
    [
      201,
      [
        'duration',
        'file_name',
        'mime_type',
        'title',
        'performer',
        'file_id',
        'file_unique_id',
        'file_size',
      ],
      {
        duration: 215,
        file_name: 'engines.mp3',
        mime_type: 'audio/mpeg',
        title: 'Engines',
        performer: 'Ada',
        file_id: audio.file_id,
        file_unique_id: audio.file_unique_id,
        file_size: TRACK_BYTES.length,
      },
      'Listen',
    ],
    "Expected the bot to see the account's track",
  );

  const { body: file } = await callBot<{ file_path: string }>(bot.botApiPath, 'getFile', {
    file_id: audio.file_id,
  });
  const download = await api.request(
    `${sessionPath}/bot-api/file/bot${bot.token}/${file.result?.file_path}`,
  );
  expectEqual(
    [
      file.result?.file_path,
      download.headers.get('Content-Type'),
      new Uint8Array(await download.arrayBuffer()),
    ],
    ['music/file_0.mp3', 'audio/mpeg', TRACK_BYTES],
    'Expected the bot to download the track as uploaded',
  );

  // A file sent by `file_id` keeps its own metadata, whatever the request specifies.
  const { body: reply } = await callBot<TestMessage>(bot.botApiPath, 'sendAudio', {
    chat_id: ada.id,
    audio: audio.file_id,
    duration: 1,
    performer: 'Bot',
    title: 'Other',
    caption: 'Thanks',
    reply_parameters: { message_id: received.message_id },
  });
  const resentAudio = audioOf(reply.result);
  const history = await getHistory(ada.id, privateChat);
  expectEqual(
    [
      resentAudio.file_unique_id,
      resentAudio.duration,
      resentAudio.title,
      resentAudio.performer,
      reply.result?.caption,
      reply.result?.reply_to_message?.message_id,
      audioOf(history.at(-1)).file_unique_id,
    ],
    [
      audio.file_unique_id,
      215,
      'Engines',
      'Ada',
      'Thanks',
      received.message_id,
      audio.file_unique_id,
    ],
    'Expected the reply to reuse the stored track',
  );

  // The account's client cleans the metadata as Telegram does, refusing text that is not Unicode.
  const refused = await sendAccountMessage(ada.id, {
    to: privateChat,
    audio: { content_base64: TRACK_BYTES.toBase64(), title: '\ud800' },
  });
  const cleaned = await sendAccountMessage(ada.id, {
    to: privateChat,
    audio: { content_base64: TRACK_BYTES.toBase64(), title: 'Side\tB', performer: '\r' },
  });
  expectEqual(
    [refused.status, cleaned.status, cleaned.body.message.audio, (await readUpdates()).length],
    [
      400,
      201,
      {
        duration: 0,
        mime_type: 'audio/mpeg',
        title: 'Side B',
        file_id: cleaned.body.message.audio?.file_id,
        file_unique_id: cleaned.body.message.audio?.file_unique_id,
        file_size: TRACK_BYTES.length,
      },
      1,
    ],
    "Expected the account's metadata to be cleaned",
  );
});

Deno.test('a bot uploads a track with a cover and sends one by URL with the metadata it states', async () => {
  const { api, sessionPath, ada, bot, callBot } = await createAudioFixture();
  const uploaded = await callBotWithFiles<TestMessage>(api, `${bot.botApiPath}/sendAudio`, {
    chat_id: String(ada.id),
    audio: 'attach://track',
    thumbnail: 'attach://cover',
    // The official server clamps the duration.
    duration: '100000',
    performer: 'Grace',
    title: 'Live',
  }, {
    track: new File([TRACK_BYTES], 'session.m4a'),
    cover: new File([gifImage(64, 64)], 'cover.gif'),
  });
  const audio = audioOf(uploaded.body.result);
  const audioFile = await callBot<{ file_path: string }>(bot.botApiPath, 'getFile', {
    file_id: audio.file_id,
  });
  const thumbnailFile = await callBot<{ file_path: string }>(bot.botApiPath, 'getFile', {
    file_id: audio.thumbnail?.file_id,
  });
  expectEqual(
    [
      audio.duration,
      audio.file_name,
      audio.mime_type,
      audio.performer,
      audio.title,
      audio.thumbnail?.width,
      audio.thumb?.file_id === audio.thumbnail?.file_id,
      audioFile.body.result?.file_path,
      thumbnailFile.body.result?.file_path,
    ],
    [
      86_400,
      'session.m4a',
      'audio/mp4',
      'Grace',
      'Live',
      64,
      true,
      'music/file_0.m4a',
      'thumbnails/file_1.gif',
    ],
    'Expected the uploaded track with its cover',
  );

  // A file sent by URL is named after it, typed as served, and takes no thumbnail.
  const { body: fromUrl } = await callBot<TestMessage>(bot.botApiPath, 'sendAudio', {
    chat_id: ada.id,
    audio: DRIVE_URL,
    duration: 180,
    title: 'Drive',
  });
  const urlAudio = audioOf(fromUrl.result);
  const download = await api.request(`${sessionPath}/files/${urlAudio.file_unique_id}`);
  expectEqual(
    [
      urlAudio,
      new TextDecoder().decode(await download.arrayBuffer()),
    ],
    [
      {
        duration: 180,
        file_name: 'drive.mp3',
        mime_type: 'audio/mpeg',
        title: 'Drive',
        file_id: urlAudio.file_id,
        file_unique_id: urlAudio.file_unique_id,
        file_size: 5,
      },
      'drive',
    ],
    'Expected the track downloaded from the URL',
  );

  const refusals = await Promise.all([
    callBot(bot.botApiPath, 'sendAudio', { chat_id: ada.id, audio: OGG_URL }),
    callBot(bot.botApiPath, 'sendAudio', { chat_id: ada.id }),
    callBot(bot.botApiPath, 'sendAudio', { chat_id: ada.id, audio: DRIVE_URL, title: '\ud800' }),
    callBot(bot.botApiPath, 'sendAudio', {
      chat_id: ada.id,
      audio: DRIVE_URL,
      performer: '\udfff',
    }),
    // Audio takes no spoiler, which the emulator rejects as an undocumented parameter.
    callBot(bot.botApiPath, 'sendAudio', { chat_id: ada.id, audio: DRIVE_URL, has_spoiler: true }),
  ]);
  expectEqual(
    refusals.map(({ body }) => body.description),
    [
      'Bad Request: wrong type of the web page content',
      'Bad Request: there is no audio in the request',
      'Bad Request: audio title must be encoded in UTF-8',
      'Bad Request: audio performer must be encoded in UTF-8',
      'Bad Request: invalid sendAudio parameters',
    ],
    'Expected unusable tracks to be refused',
  );
});

Deno.test('audio file IDs send only audio files, and only for the user that knows them', async () => {
  const { ada, bot, otherBot, privateChat, sendAccountMessage, callBot, getHistory, readUpdates } =
    await createAudioFixture();
  await sendAccountMessage(ada.id, {
    to: privateChat,
    audio: { content_base64: TRACK_BYTES.toBase64() },
  });
  await sendAccountMessage(ada.id, {
    to: privateChat,
    document: { content_base64: TRACK_BYTES.toBase64(), file_name: 'notes.txt' },
  });
  const [audioUpdate, documentUpdate] = await readUpdates();
  const audioFileId = audioOf(audioUpdate?.message as TestMessage).file_id;
  const documentFileId = (documentUpdate?.message as TestMessage).document?.file_id;
  const historyBefore = await getHistory(ada.id, privateChat);

  // A second session knows nothing of the first one's files.
  const second = await createAudioFixture();
  const refusals = await Promise.all([
    callBot(bot.botApiPath, 'sendAudio', { chat_id: ada.id, audio: documentFileId }),
    callBot(bot.botApiPath, 'sendVoice', { chat_id: ada.id, voice: audioFileId }),
    callBot(bot.botApiPath, 'sendDocument', { chat_id: ada.id, document: audioFileId }),
    callBot(otherBot.botApiPath, 'sendAudio', { chat_id: ada.id, audio: audioFileId }),
    second.callBot(second.bot.botApiPath, 'sendAudio', {
      chat_id: second.ada.id,
      audio: audioFileId,
    }),
  ]);
  expectEqual(
    [
      ...refusals.map(({ body }) => body.description),
      (await getHistory(ada.id, privateChat)).length,
      (await readUpdates()).length,
      (await second.getHistory(second.ada.id, second.privateChat)).length,
    ],
    [
      "Bad Request: can't use file of type Document as Audio",
      "Bad Request: can't use file of type Audio as VoiceNote",
      "Bad Request: can't use file of type Audio as Document",
      'Bad Request: wrong file identifier/HTTP URL specified',
      'Bad Request: wrong file identifier/HTTP URL specified',
      historyBefore.length,
      0,
      1,
    ],
    'Expected file IDs of other kinds and observers to send nothing',
  );
});

Deno.test('can_send_audios governs the audio files accounts and bots send to a supergroup', async () => {
  const {
    api,
    ada,
    grace,
    bot,
    privateChat,
    supergroupChat,
    supergroupPath,
    sendAccountMessage,
    callBot,
    getHistory,
    readUpdates,
  } = await createAudioFixture();
  const sentToBot = await sendAccountMessage(ada.id, {
    to: privateChat,
    audio: { content_base64: TRACK_BYTES.toBase64() },
  });
  const audioFileId = audioOf((await readUpdates())[0]?.message as TestMessage).file_id;
  const permissions = await requestJson(
    api,
    'PUT',
    `${supergroupPath(ada.id)}/permissions`,
    {
      permissions: {
        can_send_messages: true,
        can_send_documents: true,
        can_send_voice_notes: true,
        can_send_other_messages: true,
      },
    },
  );
  const historyBefore = await getHistory(grace.id, supergroupChat);

  const graceAudio = await sendAccountMessage(grace.id, {
    to: supergroupChat,
    audio: { content_base64: TRACK_BYTES.toBase64() },
  });
  const notEnoughRights = 'Bad Request: not enough rights to send music to the chat';
  const botRefusals = await Promise.all([
    callBot(bot.botApiPath, 'sendAudio', { chat_id: supergroupChat.chatId, audio: audioFileId }),
    callBot(bot.botApiPath, 'sendMediaGroup', {
      chat_id: supergroupChat.chatId,
      media: [{ type: 'audio', media: audioFileId }, { type: 'audio', media: audioFileId }],
    }),
    callBot(bot.botApiPath, 'forwardMessage', {
      chat_id: supergroupChat.chatId,
      from_chat_id: ada.id,
      message_id: sentToBot.body.message.message_id,
    }),
  ]);
  expectEqual(
    [
      permissions.status,
      graceAudio.status,
      ...botRefusals.map(({ body }) => body.description),
      (await getHistory(grace.id, supergroupChat)).length,
    ],
    [
      204,
      403,
      notEnoughRights,
      notEnoughRights,
      "Bad Request: the message can't be forwarded",
      historyBefore.length,
    ],
    'Expected audio to need can_send_audios',
  );

  // A voice note needs another permission, which members keep.
  const graceVoice = await sendAccountMessage(grace.id, {
    to: supergroupChat,
    voice: { content_base64: TRACK_BYTES.toBase64() },
  });
  expectEqual(graceVoice.status, 201, 'Expected a voice note to need can_send_voice_notes only');
});

Deno.test('audio albums hold only audio files, and their messages stay audio files', async () => {
  const {
    api,
    ada,
    bot,
    privateChat,
    sendAccountMessage,
    sendAccountAlbum,
    callBot,
    getHistory,
    readUpdates,
  } = await createAudioFixture();
  await sendAccountMessage(ada.id, {
    to: privateChat,
    audio: { content_base64: TRACK_BYTES.toBase64(), title: 'Engines' },
  });
  const audioFileId = audioOf((await readUpdates())[0]?.message as TestMessage).file_id;
  const historyBefore = await getHistory(ada.id, privateChat);

  const refusals = await Promise.all([
    callBotWithFiles(api, `${bot.botApiPath}/sendMediaGroup`, {
      chat_id: String(ada.id),
      media: JSON.stringify([
        { type: 'audio', media: audioFileId },
        { type: 'photo', media: 'attach://image' },
      ]),
    }, { image: new File([gifImage(4, 3)], 'image.gif') }),
    callBotWithFiles(api, `${bot.botApiPath}/sendMediaGroup`, {
      chat_id: String(ada.id),
      media: JSON.stringify([
        { type: 'document', media: 'attach://notes' },
        { type: 'audio', media: audioFileId },
      ]),
    }, { notes: new File(['notes'], 'notes.txt') }),
    // Audio takes no spoiler or caption placement, which the emulator rejects as undocumented.
    callBot(bot.botApiPath, 'sendMediaGroup', {
      chat_id: ada.id,
      media: [{ type: 'audio', media: audioFileId, show_caption_above_media: true }],
    }),
  ]);
  const accountRefusal = await sendAccountAlbum(ada.id, privateChat, [
    { audio: { content_base64: TRACK_BYTES.toBase64() } },
    { video: { content_base64: TRACK_BYTES.toBase64() } },
  ]);
  expectEqual(
    [
      refusals.map(({ body }) => body.description),
      accountRefusal.status,
      (await getHistory(ada.id, privateChat)).length,
    ],
    [
      [
        "Bad Request: audio can't be mixed with other media types",
        "Bad Request: document can't be mixed with other media types",
        'Bad Request: invalid sendMediaGroup parameters',
      ],
      400,
      historyBefore.length,
    ],
    'Expected albums mixing audio to send nothing',
  );

  const { body: album } = await callBotWithFiles<TestMessage[]>(
    api,
    `${bot.botApiPath}/sendMediaGroup`,
    {
      chat_id: String(ada.id),
      media: JSON.stringify([
        { type: 'audio', media: audioFileId, caption: 'Side A' },
        { type: 'audio', media: 'attach://track', title: 'Outro', duration: 30 },
      ]),
    },
    { track: new File([TRACK_BYTES], 'outro.mp3') },
  );
  const accountAlbum = await sendAccountAlbum(ada.id, privateChat, [
    { audio: { content_base64: TRACK_BYTES.toBase64(), title: 'One' }, caption: 'Demo' },
    { audio: { content_base64: TRACK_BYTES.toBase64(), title: 'Two' } },
  ]);
  const [first, second] = album.result ?? [];
  expectEqual(
    [
      typeof first?.media_group_id,
      second?.media_group_id === first?.media_group_id,
      first?.caption,
      audioOf(first).title,
      audioOf(second).title,
      audioOf(second).duration,
      accountAlbum.status,
      accountAlbum.body.messages.map((message) => audioOf(message).title),
      accountAlbum.body.messages[1]?.media_group_id ===
        accountAlbum.body.messages[0]?.media_group_id,
    ],
    ['string', true, 'Side A', 'Engines', 'Outro', 30, 201, ['One', 'Two'], true],
    'Expected albums of audio files',
  );

  // An audio file of an album becomes only another audio file; outside an album, anything media.
  const editMedia = (messageId: number | undefined, media: Record<string, unknown>) =>
    callBotWithFiles<TestMessage>(api, `${bot.botApiPath}/editMessageMedia`, {
      chat_id: String(ada.id),
      message_id: String(messageId),
      media: JSON.stringify(media),
    }, { notes: new File(['notes'], 'notes.txt') });
  const { body: standalone } = await callBot<TestMessage>(bot.botApiPath, 'sendAudio', {
    chat_id: ada.id,
    audio: audioFileId,
  });
  const edits = [
    await editMedia(first?.message_id, { type: 'document', media: 'attach://notes' }),
    await editMedia(first?.message_id, { type: 'audio', media: DRIVE_URL, title: 'Drive' }),
    await editMedia(standalone.result?.message_id, { type: 'document', media: 'attach://notes' }),
    await editMedia(standalone.result?.message_id, {
      type: 'audio',
      media: audioFileId,
      caption: 'Back again',
    }),
  ];
  const caption = await callBot<TestMessage>(bot.botApiPath, 'editMessageCaption', {
    chat_id: ada.id,
    message_id: first?.message_id,
    caption: 'Side A, remastered',
  });
  expectEqual(
    [
      edits[0].body.description,
      audioOf(edits[1].body.result).title,
      edits[1].body.result?.media_group_id === first?.media_group_id,
      edits[2].body.result?.document?.file_name,
      audioOf(edits[3].body.result).file_id === audioFileId && edits[3].body.result?.caption,
      caption.body.result?.caption,
    ],
    [
      "Bad Request: can't change media type in the album",
      'Drive',
      true,
      'notes.txt',
      'Back again',
      'Side A, remastered',
    ],
    'Expected album audio files to stay audio files',
  );
});

Deno.test('forwarded and copied audio files of one sender form new albums, and replies show them', async () => {
  const {
    ada,
    grace,
    bot,
    privateChat,
    supergroupChat,
    sendAccountMessage,
    callBot,
    getHistory,
  } = await createAudioFixture();
  const sendTrack = async (title: string) =>
    (await sendAccountMessage(ada.id, {
      to: privateChat,
      audio: { content_base64: TRACK_BYTES.toBase64(), title },
    })).body.message.message_id;
  const firstTrack = await sendTrack('One');
  const secondTrack = await sendTrack('Two');
  const notes = (await sendAccountMessage(ada.id, {
    to: privateChat,
    document: { content_base64: TRACK_BYTES.toBase64(), file_name: 'notes.txt' },
  })).body.message.message_id;
  const repeat = (method: 'forwardMessages' | 'copyMessages', messageIds: readonly number[]) =>
    callBot<Array<{ message_id: number }>>(bot.botApiPath, method, {
      chat_id: supergroupChat.chatId,
      from_chat_id: ada.id,
      message_ids: messageIds,
    });

  const forwarded = await repeat('forwardMessages', [firstTrack, secondTrack]);
  const copied = await repeat('copyMessages', [firstTrack, secondTrack]);
  const mixed = await repeat('forwardMessages', [secondTrack, notes]);
  const history = await getHistory(grace.id, supergroupChat);
  const albumsOf = (answer: typeof forwarded) =>
    (answer.body.result ?? []).map(({ message_id }) =>
      history.find((message) => message.message_id === message_id)?.media_group_id
    );
  const [forwardedAlbum, copiedAlbum, mixedAlbum] = [forwarded, copied, mixed].map(albumsOf);
  expectEqual(
    [
      typeof forwardedAlbum[0],
      forwardedAlbum[1] === forwardedAlbum[0],
      typeof copiedAlbum[0],
      copiedAlbum[1] === copiedAlbum[0],
      copiedAlbum[0] !== forwardedAlbum[0],
      mixedAlbum,
    ],
    ['string', true, 'string', true, true, [undefined, undefined]],
    "Expected one sender's audio files alone to form new albums",
  );

  // A reply in another chat shows the replied audio file.
  const { body: reply } = await callBot<TestMessage>(bot.botApiPath, 'sendMessage', {
    chat_id: supergroupChat.chatId,
    text: 'Great track',
    reply_parameters: { chat_id: ada.id, message_id: firstTrack },
  });
  expectEqual(
    reply.result?.external_reply?.audio?.title,
    'One',
    'Expected the reply to show the replied audio file',
  );
});

Deno.test('inline audio results send cached tracks and tracks downloaded from their URL', async () => {
  const {
    api,
    ada,
    grace,
    bot,
    accountPath,
    privateChat,
    supergroupChat,
    supergroupPath,
    sendAccountMessage,
    callBot,
    getHistory,
    readUpdates,
  } = await createAudioFixture();
  await sendAccountMessage(ada.id, {
    to: privateChat,
    audio: { content_base64: TRACK_BYTES.toBase64(), title: 'Engines', performer: 'Ada' },
  });
  await sendAccountMessage(ada.id, {
    to: privateChat,
    document: { content_base64: TRACK_BYTES.toBase64(), file_name: 'notes.txt' },
  });
  const [audioUpdate, documentUpdate] = await readUpdates();
  const cachedAudio = audioOf(audioUpdate?.message as TestMessage);
  const documentFileId = (documentUpdate?.message as TestMessage).document?.file_id;
  const sendQuery = async (accountId: number, chat: Record<string, unknown>) =>
    (await requestJson<{ inline_query: TestInlineQuery }>(
      api,
      'POST',
      `${accountPath(accountId)}/inline-queries`,
      { bot_id: bot.id, chat, query: 'music' },
    )).body.inline_query;
  const answer = (inlineQueryId: string, results: readonly Record<string, unknown>[]) =>
    callBot(bot.botApiPath, 'answerInlineQuery', { inline_query_id: inlineQueryId, results });
  const choose = (accountId: number, inlineQueryId: string, resultId: string) =>
    requestJson<{ message: TestMessage }>(
      api,
      'POST',
      `${accountPath(accountId)}/inline-queries/${inlineQueryId}/chosen-results`,
      { result_id: resultId },
    );
  const urlResult = {
    type: 'audio',
    id: 'drive',
    audio_url: DRIVE_URL,
    title: 'Drive',
    performer: 'Grace',
    audio_duration: 180,
    caption: 'Night',
  };

  const inlineQuery = await sendQuery(ada.id, privateChat);
  const answered = await answer(inlineQuery.id, [
    { type: 'audio', id: 'cached', audio_file_id: cachedAudio.file_id, caption: 'Again' },
    urlResult,
    { ...urlResult, id: 'ogg', audio_url: OGG_URL },
  ]);
  const listing = (await requestJson<{ inline_query: TestInlineQuery }>(
    api,
    'GET',
    `${accountPath(ada.id)}/inline-queries/${inlineQuery.id}`,
  )).body.inline_query.answer?.results;
  const cached = await choose(ada.id, inlineQuery.id, 'cached');
  const downloaded = await choose(ada.id, inlineQuery.id, 'drive');
  const historyBefore = await getHistory(ada.id, privateChat);
  const refused = await choose(ada.id, inlineQuery.id, 'ogg');
  const downloadedAudio = audioOf(downloaded.body.message);
  expectEqual(
    [
      answered.body.ok,
      listing,
      audioOf(cached.body.message).file_unique_id,
      audioOf(cached.body.message).title,
      cached.body.message.caption,
      cached.body.message.via_bot?.id,
      [
        downloadedAudio.file_name,
        downloadedAudio.mime_type,
        downloadedAudio.title,
        downloadedAudio.performer,
        downloadedAudio.duration,
      ],
      downloaded.body.message.caption,
      refused.status,
      (await getHistory(ada.id, privateChat)).length,
    ],
    [
      true,
      [
        { type: 'audio', id: 'cached' },
        { type: 'audio', id: 'drive', title: 'Drive', description: 'Grace' },
        { type: 'audio', id: 'ogg', title: 'Drive', description: 'Grace' },
      ],
      cachedAudio.file_unique_id,
      'Engines',
      'Again',
      bot.id,
      ['drive.mp3', 'audio/mpeg', 'Drive', 'Grace', 180],
      'Night',
      422,
      historyBefore.length,
    ],
    'Expected inline audio results to send their tracks',
  );

  const refusals = await Promise.all([
    // A track given by URL needs a title.
    answer((await sendQuery(ada.id, privateChat)).id, [{ ...urlResult, title: undefined }]),
    answer((await sendQuery(ada.id, privateChat)).id, [
      { type: 'audio', id: 'notes', audio_file_id: documentFileId },
    ]),
  ]);
  expectEqual(
    refusals.map(({ body }) => body.description),
    [
      'Bad Request: invalid answerInlineQuery parameters',
      "Bad Request: can't use file of type Document as Audio",
    ],
    'Expected unusable audio results to be refused',
  );

  // In a supergroup, sending a track needs can_send_audios.
  await requestJson(api, 'PUT', `${supergroupPath(ada.id)}/permissions`, {
    permissions: { can_send_messages: true, can_send_other_messages: true },
  });
  const groupQuery = await sendQuery(grace.id, supergroupChat);
  await answer(groupQuery.id, [urlResult]);
  const groupHistoryBefore = await getHistory(grace.id, supergroupChat);
  expectEqual(
    [
      (await choose(grace.id, groupQuery.id, 'drive')).status,
      (await getHistory(grace.id, supergroupChat)).length,
    ],
    [403, groupHistoryBefore.length],
    'Expected an inline track to need can_send_audios',
  );
});

Deno.test('a grammY bot receives a track and replies with its own track and a cover', async () => {
  const { api, sessionPath, ada, bot, privateChat, sendAccountMessage, getHistory } =
    await createAudioFixture();
  const grammyBot = new Bot(bot.token, {
    client: {
      apiRoot: `${TEST_PUBLIC_ORIGIN}${sessionPath}/bot-api`,
      fetch: async (input, init) => await api.fetch(new Request(input, init)),
    },
  });
  await grammyBot.init();
  const replied = Promise.withResolvers<void>();
  grammyBot.on('message:audio', async (context) => {
    const { audio } = context.message;
    const file = await context.getFile();
    await context.replyWithAudio(new InputFile(TRACK_BYTES, 'answer.mp3'), {
      title: `Reply to ${audio.title}`,
      performer: 'Music Bot',
      duration: audio.duration,
      thumbnail: new InputFile(gifImage(32, 32), 'cover.gif'),
      caption: file.file_path,
      reply_parameters: { message_id: context.message.message_id },
    });
    replied.resolve();
  });
  await grammyBot.api.deleteWebhook({ drop_pending_updates: true });
  const polling = grammyBot.start({ timeout: 1 });
  try {
    await sendAccountMessage(ada.id, {
      to: privateChat,
      audio: {
        content_base64: TRACK_BYTES.toBase64(),
        file_name: 'engines.mp3',
        title: 'Engines',
        duration: 9,
      },
    });
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      replied.promise,
      new Promise((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error('Expected the bot to reply')), 5_000);
      }),
    ]).finally(() => clearTimeout(timeoutId));
  } finally {
    await grammyBot.stop();
    await polling;
  }
  const reply = (await getHistory(ada.id, privateChat)).at(-1);
  const audio = audioOf(reply);
  expectEqual(
    [
      audio.title,
      audio.performer,
      audio.duration,
      audio.file_name,
      audio.thumbnail?.width,
      reply?.caption,
      reply?.from?.id,
    ],
    ['Reply to Engines', 'Music Bot', 9, 'answer.mp3', 32, 'music/file_0.mp3', bot.id],
    "Expected the grammY bot's track",
  );
});
