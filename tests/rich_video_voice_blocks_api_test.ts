import { createTestSession, type EmulationApi, requestJson } from './support/emulation_api.ts';

type TestRichBlock = Readonly<Record<string, unknown>> & {
  readonly type: string;
  readonly blocks?: readonly TestRichBlock[];
  readonly items?: ReadonlyArray<{ readonly blocks: readonly TestRichBlock[] }>;
  readonly video?: TestMediaFile;
  readonly voice_note?: TestMediaFile;
};

type TestMediaFile = Readonly<Record<string, unknown>> & {
  readonly file_id: string;
  readonly file_unique_id: string;
};

interface TestMessage {
  readonly message_id: number;
  readonly text?: string;
  readonly edit_date?: number;
  readonly photo?: readonly TestMediaFile[];
  readonly video?: TestMediaFile;
  readonly voice?: TestMediaFile;
  readonly rich_message?: { readonly blocks: readonly TestRichBlock[] };
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

/** Bytes that stand in for an MPEG-4 video and an OGG voice note; the emulator reads neither. */
const CLIP_BYTES = new Uint8Array([0, 0, 0, 24]);
const MEMO_BYTES = new TextEncoder().encode('OggS');
const CLIP_URL = 'https://cdn.example.com/clips/launch.mp4';
const MEMO_URL = 'https://cdn.example.com/voice/memo.ogg';
/** A voice note larger than the 1 MB that `sendVoice` sends by URL as a voice note. */
const LONG_MEMO_URL = 'https://cdn.example.com/voice/long-memo.ogg';
const LONG_MEMO_BYTES = 1024 * 1024 + 1;

/**
 * Creates a session where Ada has started private chats with two bots and owns a supergroup with
 * Grace and the first bot, which answers inline queries, and the emulated web serves a video and
 * two voice notes.
 */
async function createRichMediaFixture() {
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
        first_name: 'Clip Bot',
        username,
        supports_inline_queries: true,
        receives_chosen_inline_results: true,
      },
    );
    return { ...body.bot, botApiPath: `${sessionPath}/bot-api/bot${body.token}` };
  };
  const bot = await createBot('clip_bot');
  const otherBot = await createBot('other_clip_bot');
  const accountPath = (accountId: number) => `${sessionPath}/accounts/${accountId}`;
  const privateChat = { type: 'private', botId: bot.id } as const;
  const otherPrivateChat = { type: 'private', botId: otherBot.id } as const;
  const sendAccountMessage = (accountId: number, body: Record<string, unknown>) =>
    requestJson<{ message: TestMessage }>(api, 'POST', `${accountPath(accountId)}/messages`, body);
  await sendAccountMessage(ada.id, { to: privateChat, text: '/start' });
  await sendAccountMessage(ada.id, { to: otherPrivateChat, text: '/start' });

  const { body: { supergroup } } = await requestJson<{ supergroup: { id: number } }>(
    api,
    'POST',
    `${accountPath(ada.id)}/supergroups`,
    { title: 'Launch' },
  );
  const supergroupChat = { type: 'supergroup', chatId: supergroup.id } as const;
  const supergroupPath = (accountId: number) =>
    `${accountPath(accountId)}/conversations/supergroup/${supergroup.id}`;
  for (const memberId of [grace.id, bot.id]) {
    await api.request(`${supergroupPath(ada.id)}/members/${memberId}`, { method: 'PUT' });
  }

  for (
    const [url, contentType, content] of [
      [CLIP_URL, 'video/mp4', CLIP_BYTES],
      [MEMO_URL, 'audio/ogg', MEMO_BYTES],
      [LONG_MEMO_URL, 'audio/ogg', new Uint8Array(LONG_MEMO_BYTES)],
    ] as const
  ) {
    await requestJson(api, 'POST', `${sessionPath}/web-resources`, {
      url,
      content_type: contentType,
      content_base64: content.toBase64(),
    });
  }

  const callBot = <Result = unknown>(
    botApiPath: string,
    method: string,
    parameters: Record<string, unknown>,
  ) => requestJson<TestBotApiAnswer<Result>>(api, 'POST', `${botApiPath}/${method}`, parameters);
  const getHistory = async (
    accountId: number,
    chat: typeof privateChat | typeof otherPrivateChat | typeof supergroupChat,
  ) =>
    (await requestJson<{ messages: TestMessage[] }>(
      api,
      'GET',
      chat.type === 'private'
        ? `${accountPath(accountId)}/conversations/private/${chat.botId}/messages`
        : `${supergroupPath(accountId)}/messages`,
    )).body.messages;
  const readUpdates = createUpdateReader(api, bot.botApiPath);
  const readOtherBotUpdates = createUpdateReader(api, otherBot.botApiPath);
  await readUpdates();
  await readOtherBotUpdates();

  /** Uploads a video and a voice note from Ada to a bot and returns the IDs the bot knows. */
  const uploadAccountMedia = async (readBotUpdates: typeof readUpdates, chat = privateChat) => {
    await sendAccountMessage(ada.id, {
      to: chat,
      video: { content_base64: CLIP_BYTES.toBase64(), file_name: 'rehearsal.mp4', duration: 9 },
    });
    await sendAccountMessage(ada.id, {
      to: chat,
      voice: { content_base64: MEMO_BYTES.toBase64(), duration: 4 },
    });
    const [videoUpdate, voiceUpdate] = await readBotUpdates();
    const message = (update: Record<string, unknown> | undefined) =>
      (update?.message ?? {}) as TestMessage;
    return {
      videoFileId: mediaOf(message(videoUpdate).video).file_id,
      voiceFileId: mediaOf(message(voiceUpdate).voice).file_id,
    };
  };

  return {
    api,
    sessionPath,
    ada,
    grace,
    bot,
    otherBot,
    accountPath,
    privateChat,
    otherPrivateChat,
    supergroupChat,
    supergroupPath,
    sendAccountMessage,
    callBot,
    getHistory,
    readUpdates,
    readOtherBotUpdates,
    uploadAccountMedia,
  };
}

/** Returns a reader of a bot's updates since the reader last read them. */
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
): Promise<{ status: number; body: TestBotApiAnswer<Result> }> {
  const body = new FormData();
  for (const [name, value] of Object.entries(parameters)) {
    body.append(name, value);
  }
  for (const [name, file] of Object.entries(files)) {
    body.append(name, file);
  }
  const response = await api.request(methodPath, { method: 'POST', body });
  return { status: response.status, body: await response.json() };
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

function mediaOf(file: TestMediaFile | undefined): TestMediaFile {
  if (file === undefined) {
    throw new Error('Expected a media file');
  }
  return file;
}

/** The files of a rich message's video and voice note blocks, nested ones included, in order. */
function listBlockFiles(
  message: TestMessage | undefined,
): Array<{ readonly type: string; readonly file: TestMediaFile }> {
  const files: Array<{ readonly type: string; readonly file: TestMediaFile }> = [];
  const visit = (blocks: readonly TestRichBlock[]) => {
    for (const block of blocks) {
      if (block.video !== undefined) {
        files.push({ type: 'video', file: block.video });
      }
      if (block.voice_note !== undefined) {
        files.push({ type: 'voice_note', file: block.voice_note });
      }
      visit(block.blocks ?? []);
      for (const item of block.items ?? []) {
        visit(item.blocks);
      }
    }
  };
  visit(message?.rich_message?.blocks ?? []);
  return files;
}

Deno.test('a bot sends nested video and voice note blocks that accounts see and bots reuse', async () => {
  const { api, ada, bot, privateChat, callBot, getHistory } = await createRichMediaFixture();
  const sent = await callBotWithFiles<TestMessage>(api, `${bot.botApiPath}/sendRichMessage`, {
    chat_id: String(ada.id),
    rich_message: JSON.stringify({
      blocks: [
        {
          type: 'details',
          summary: 'Clips',
          is_open: true,
          blocks: [{
            type: 'video',
            video: {
              type: 'video',
              media: 'attach://clip',
              // The legacy name of `thumbnail`, which the official server reads for blocks too.
              thumb: 'attach://still',
              // The duration and dimensions are clamped, and a block keeps no start.
              duration: 100_000,
              width: 20_000,
              height: 360,
              start_timestamp: 5,
              supports_streaming: true,
              has_spoiler: true,
              caption: 'A block ignores the caption of its media',
            },
            caption: { text: 'Launch', credit: 'Ada' },
          }],
        },
        {
          type: 'list',
          items: [
            {
              blocks: [{
                type: 'voice_note',
                voice_note: { type: 'voice_note', media: MEMO_URL, duration: 7 },
                caption: { text: 'Memo' },
              }],
            },
            {
              blocks: [{
                type: 'voice_note',
                voice_note: { type: 'voice_note', media: LONG_MEMO_URL },
              }],
            },
          ],
        },
        {
          type: 'collage',
          blocks: [
            { type: 'video', video: { type: 'video', media: CLIP_URL, duration: 3 } },
            { type: 'voice_note', voice_note: { type: 'voice_note', media: 'attach://note' } },
          ],
        },
        {
          type: 'document',
          document: { type: 'document', media: 'attach://notes', thumb: 'attach://still' },
        },
      ],
    }),
  }, {
    clip: new File([CLIP_BYTES], 'launch.mp4'),
    still: new File([gifImage(32, 18)], 'still.gif'),
    note: new File([MEMO_BYTES], 'note.mp3'),
    notes: new File(['%PDF-1.7'], 'notes.pdf'),
  });
  const message = sent.body.result;
  const [details, list, collage, documentBlock] = message?.rich_message?.blocks ?? [];
  const uploadedVideoBlock = details?.blocks?.[0];
  const uploadedVideo = mediaOf(uploadedVideoBlock?.video);
  const [memoBlock, longMemoBlock] = (list?.items ?? []).map((item) => item.blocks[0]);
  const [urlVideoBlock, uploadedVoiceBlock] = collage?.blocks ?? [];
  const without = (file: TestMediaFile | undefined, ...keys: string[]) =>
    Object.fromEntries(Object.entries(file ?? {}).filter(([key]) => !keys.includes(key)));
  const fileKeys = ['file_id', 'file_unique_id', 'file_size'];
  // The official server's `JsonRichBlock`, `JsonVideo` and `JsonVoiceNote` write their fields in
  // these orders.
  expectEqual(
    [
      sent.status,
      Object.keys(uploadedVideoBlock ?? {}),
      Object.keys(uploadedVideo),
      without(uploadedVideo, 'thumbnail', 'thumb', ...fileKeys),
      [uploadedVideo.thumbnail, uploadedVideo.thumb].map((thumbnail) => {
        const { width, height } = thumbnail as { width: number; height: number };
        return [width, height];
      }),
      uploadedVideoBlock?.caption,
      uploadedVideoBlock?.has_spoiler,
      Object.keys(memoBlock ?? {}),
      without(memoBlock?.voice_note, ...fileKeys),
      memoBlock?.caption,
      without(longMemoBlock?.voice_note, 'file_id', 'file_unique_id'),
      without(urlVideoBlock?.video, ...fileKeys),
      Object.keys(urlVideoBlock ?? {}),
      without(uploadedVoiceBlock?.voice_note, ...fileKeys),
      (documentBlock?.document as { thumbnail?: { width: number } } | undefined)?.thumbnail?.width,
    ],
    [
      200,
      ['type', 'video', 'caption', 'has_spoiler'],
      [
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
      ],
      {
        duration: 86_400,
        width: 10_000,
        height: 360,
        file_name: 'launch.mp4',
        mime_type: 'video/mp4',
      },
      [[32, 18], [32, 18]],
      { text: 'Launch', credit: 'Ada' },
      true,
      ['type', 'voice_note', 'caption'],
      { duration: 7, mime_type: 'audio/ogg' },
      { text: 'Memo' },
      // A block's voice note sent by URL stays a voice note, however large.
      { duration: 0, mime_type: 'audio/ogg', file_size: LONG_MEMO_BYTES },
      { duration: 3, width: 0, height: 0, file_name: 'launch.mp4', mime_type: 'video/mp4' },
      ['type', 'video'],
      { duration: 0, mime_type: 'audio/mpeg' },
      32,
    ],
    'Expected the blocks to show the videos and voice notes as the bot specified them',
  );

  // The account's history shows the private message as the bot sees it.
  const shown = (await getHistory(ada.id, privateChat)).at(-1);
  expectEqual(shown?.rich_message, message?.rich_message, 'Expected the account to see the blocks');

  const memo = mediaOf(memoBlock?.voice_note);
  const filePaths = await Promise.all(
    [uploadedVideo, memo].map(async ({ file_id }) =>
      (await callBot<{ file_path: string }>(bot.botApiPath, 'getFile', { file_id })).body.result
        ?.file_path
    ),
  );
  const reusedVideo = await callBot<TestMessage>(bot.botApiPath, 'sendVideo', {
    chat_id: ada.id,
    video: uploadedVideo.file_id,
  });
  const reusedVoice = await callBot<TestMessage>(bot.botApiPath, 'sendVoice', {
    chat_id: ada.id,
    voice: memo.file_id,
  });
  const reusedInBlocks = await callBot<TestMessage>(bot.botApiPath, 'sendRichMessage', {
    chat_id: ada.id,
    rich_message: {
      blocks: [
        {
          type: 'blockquote',
          blocks: [
            {
              type: 'video',
              video: { type: 'video', media: uploadedVideo.file_id, duration: 1, width: 1 },
            },
            { type: 'voice_note', voice_note: { type: 'voice_note', media: memo.file_id } },
          ],
        },
      ],
    },
  });
  expectEqual(
    [
      filePaths.map((path) => path?.replace(/\/.*\./, '/*.')),
      reusedVideo.body.result?.video?.file_unique_id,
      reusedVoice.body.result?.voice?.file_unique_id,
      listBlockFiles(reusedInBlocks.body.result).map(({ file }) => file),
    ],
    [
      ['videos/*.mp4', 'voice/*.oga'],
      uploadedVideo.file_unique_id,
      memo.file_unique_id,
      // A file sent again by `file_id` keeps its own attributes.
      [uploadedVideo, memo],
    ],
    'Expected the bot to download and reuse the files of the blocks',
  );
});

Deno.test('a rich message whose video or voice note fails is sent or edited not at all', async () => {
  const {
    api,
    ada,
    bot,
    privateChat,
    otherPrivateChat,
    sendAccountMessage,
    callBot,
    getHistory,
    readUpdates,
    readOtherBotUpdates,
    uploadAccountMedia,
  } = await createRichMediaFixture();
  const { videoFileId, voiceFileId } = await uploadAccountMedia(readUpdates);
  await sendAccountMessage(ada.id, {
    to: privateChat,
    photo: { content_base64: gifImage(4, 3).toBase64() },
  });
  const photoFileId = mediaOf(
    ((await readUpdates())[0]?.message as TestMessage | undefined)?.photo?.[0],
  ).file_id;
  const { videoFileId: otherBotVideoFileId } = await uploadAccountMedia(
    readOtherBotUpdates,
    otherPrivateChat,
  );
  const otherSession = await createRichMediaFixture();
  const { videoFileId: otherSessionVideoFileId } = await otherSession.uploadAccountMedia(
    otherSession.readUpdates,
  );

  const uploadedVideo = { type: 'video', video: { type: 'video', media: 'attach://clip' } };
  const voiceNote = (voice_note: Record<string, unknown>) => ({ type: 'voice_note', voice_note });
  const video = (videoMedia: Record<string, unknown>) => ({ type: 'video', video: videoMedia });
  const cases: Array<readonly [Record<string, unknown>, string]> = [
    [
      voiceNote({ type: 'voice_note', media: photoFileId }),
      "Bad Request: can't use file of type Photo as VoiceNote",
    ],
    [
      video({ type: 'video', media: voiceFileId }),
      "Bad Request: can't use file of type VoiceNote as Video",
    ],
    [
      video({ type: 'video', media: otherBotVideoFileId }),
      'Bad Request: wrong file identifier/HTTP URL specified',
    ],
    [
      video({ type: 'video', media: otherSessionVideoFileId }),
      'Bad Request: wrong file identifier/HTTP URL specified',
    ],
    [
      voiceNote({ type: 'voice_note', media: 'https://cdn.example.com/voice/missing.ogg' }),
      'Bad Request: failed to get HTTP URL content',
    ],
    // The emulated web serves a video where a voice note must be served as `audio/ogg`.
    [
      voiceNote({ type: 'voice_note', media: CLIP_URL }),
      'Bad Request: wrong type of the web page content',
    ],
    [video({ type: 'video', media: 'attach://missing' }), 'Bad Request: media not found'],
    [
      video({ type: 'voice_note', media: videoFileId }),
      'Bad Request: unexpected media type "voice_note" for block "video"',
    ],
    // As for `sendVideo`, covers are not supported; a voice note takes no thumbnail.
    [
      video({ type: 'video', media: videoFileId, cover: 'attach://clip' }),
      'Bad Request: invalid sendRichMessage parameters',
    ],
    [
      voiceNote({ type: 'voice_note', media: voiceFileId, thumbnail: 'attach://clip' }),
      'Bad Request: invalid sendRichMessage parameters',
    ],
  ];
  const historyBefore = await getHistory(ada.id, privateChat);
  const refusals = [];
  for (const [failingBlock] of cases) {
    const { body } = await callBotWithFiles(api, `${bot.botApiPath}/sendRichMessage`, {
      chat_id: String(ada.id),
      rich_message: JSON.stringify({
        blocks: [uploadedVideo, { type: 'details', summary: 'More', blocks: [failingBlock] }],
      }),
    }, { clip: new File([CLIP_BYTES], 'clip.mp4') });
    refusals.push(body.description);
  }
  expectEqual(
    [refusals, await getHistory(ada.id, privateChat), await readUpdates()],
    [cases.map(([, description]) => description), historyBefore, []],
    'Expected each refused rich message to leave the chat as it was',
  );
  expectEqual(
    (await otherSession.getHistory(otherSession.ada.id, otherSession.privateChat)).length,
    3,
    'Expected the other session to keep only its own messages',
  );

  // An edit that fails for a later block leaves the message as it was.
  const textMessage = await callBot<TestMessage>(bot.botApiPath, 'sendMessage', {
    chat_id: ada.id,
    text: 'Clips soon',
  });
  const messageId = textMessage.body.result?.message_id;
  const editTo = (blocks: readonly Record<string, unknown>[]) =>
    callBot<TestMessage>(bot.botApiPath, 'editMessageText', {
      chat_id: ada.id,
      message_id: messageId,
      rich_message: { blocks },
    });
  const validBlocks = [
    video({ type: 'video', media: videoFileId, has_spoiler: true }),
    voiceNote({ type: 'voice_note', media: MEMO_URL, duration: 2 }),
  ];
  const failedEdits = [
    await editTo([...validBlocks, voiceNote({ type: 'voice_note', media: photoFileId })]),
    await editTo([...validBlocks, video({ type: 'video', media: otherBotVideoFileId })]),
  ];
  const afterFailedEdits = (await getHistory(ada.id, privateChat)).at(-1);
  const edit = await editTo(validBlocks);
  const edited = (await getHistory(ada.id, privateChat)).at(-1);
  const failedEditOfRichMessage = await editTo([
    voiceNote({ type: 'voice_note', media: 'https://cdn.example.com/voice/missing.ogg' }),
  ]);
  expectEqual(
    [
      failedEdits.map(({ body }) => body.description),
      afterFailedEdits?.text,
      afterFailedEdits?.edit_date,
      edit.body.ok,
      listBlockFiles(edited).map(({ type, file }) => [type, file.duration]),
      edited?.rich_message?.blocks[0]?.has_spoiler,
      failedEditOfRichMessage.body.description,
      (await getHistory(ada.id, privateChat)).at(-1),
      await readUpdates(),
      (await readOtherBotUpdates()).length,
    ],
    [
      [
        "Bad Request: can't use file of type Photo as VoiceNote",
        'Bad Request: wrong file identifier/HTTP URL specified',
      ],
      'Clips soon',
      undefined,
      true,
      [['video', 9], ['voice_note', 2]],
      true,
      'Bad Request: failed to get HTTP URL content',
      edited,
      [],
      0,
    ],
    'Expected only the edit whose files all resolve to change the message',
  );
});

Deno.test('video and voice note blocks keep observer-specific files through chats, forwards and copies', async () => {
  const {
    ada,
    grace,
    bot,
    otherBot,
    otherPrivateChat,
    supergroupChat,
    sendAccountMessage,
    callBot,
    getHistory,
    readOtherBotUpdates,
    uploadAccountMedia,
    readUpdates,
  } = await createRichMediaFixture();
  const { videoFileId, voiceFileId } = await uploadAccountMedia(readUpdates);
  const sent = await callBot<TestMessage>(bot.botApiPath, 'sendRichMessage', {
    chat_id: supergroupChat.chatId,
    rich_message: {
      blocks: [{
        type: 'slideshow',
        blocks: [
          { type: 'video', video: { type: 'video', media: videoFileId } },
          { type: 'voice_note', voice_note: { type: 'voice_note', media: voiceFileId } },
        ],
        caption: { text: 'Rehearsal' },
      }],
    },
  });
  const filesOf = (message: TestMessage | undefined) =>
    listBlockFiles(message).map(({ file }) => file);
  const botFiles = filesOf(sent.body.result);
  const adaMessage = (await getHistory(ada.id, supergroupChat)).at(-1);
  const adaFiles = filesOf(adaMessage);
  const graceFiles = filesOf((await getHistory(grace.id, supergroupChat)).at(-1));
  const messageId = sent.body.result?.message_id;
  const forwarded = await callBot<TestMessage>(bot.botApiPath, 'forwardMessage', {
    chat_id: ada.id,
    from_chat_id: supergroupChat.chatId,
    message_id: messageId,
  });
  const copied = await callBot<{ message_id: number }>(bot.botApiPath, 'copyMessage', {
    chat_id: ada.id,
    from_chat_id: supergroupChat.chatId,
    message_id: messageId,
  });
  const copiedMessage = (await getHistory(ada.id, { type: 'private', botId: bot.id })).at(-1);

  // Ada forwards the message to another bot, which knows its files by IDs of its own.
  await sendAccountMessage(ada.id, {
    to: otherPrivateChat,
    forward: { chat: supergroupChat, message_id: adaMessage?.message_id },
  });
  const otherBotMessage = (await readOtherBotUpdates()).at(-1)?.message as TestMessage | undefined;
  const otherBotFiles = filesOf(otherBotMessage);
  const otherBotDownloads = await Promise.all(
    [otherBotFiles[0]?.file_id, botFiles[0]?.file_id].map(async (fileId) =>
      (await callBot(otherBot.botApiPath, 'getFile', { file_id: fileId })).body
    ),
  );
  const ids = (files: readonly TestMediaFile[]) => files.map(({ file_id }) => file_id);
  const uniqueIds = (files: readonly TestMediaFile[]) =>
    files.map(({ file_unique_id }) => file_unique_id);
  expectEqual(
    [
      sent.body.ok,
      new Set([...ids(botFiles), ...ids(adaFiles), ...ids(graceFiles), ...ids(otherBotFiles)])
        .size,
      [adaFiles, graceFiles, otherBotFiles].map(uniqueIds),
      ids(filesOf(forwarded.body.result)),
      copied.body.ok,
      ids(filesOf(copiedMessage)),
      otherBotDownloads.map(({ ok, description }) => ok || description),
    ],
    [
      true,
      8,
      [uniqueIds(botFiles), uniqueIds(botFiles), uniqueIds(botFiles)],
      ids(botFiles),
      true,
      ids(botFiles),
      [true, 'Bad Request: invalid file_id'],
    ],
    'Expected each observer to know the files of the blocks by IDs of its own',
  );
});

Deno.test('video and voice note blocks need the permissions of their media', async () => {
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
    uploadAccountMedia,
  } = await createRichMediaFixture();
  const { videoFileId, voiceFileId } = await uploadAccountMedia(readUpdates);
  const nestedVideo = {
    type: 'details',
    summary: 'Clip',
    blocks: [{ type: 'video', video: { type: 'video', media: videoFileId } }],
  };
  const nestedVoiceNote = {
    type: 'list',
    items: [{
      blocks: [{ type: 'voice_note', voice_note: { type: 'voice_note', media: voiceFileId } }],
    }],
  };
  const privateRichMessage = await callBot<TestMessage>(bot.botApiPath, 'sendRichMessage', {
    chat_id: ada.id,
    rich_message: { blocks: [nestedVideo] },
  });
  const setPermissions = (permissions: Record<string, boolean>) =>
    requestJson(api, 'PUT', `${supergroupPath(ada.id)}/permissions`, { permissions });
  const sendToSupergroup = (blocks: readonly Record<string, unknown>[]) =>
    callBot<TestMessage>(bot.botApiPath, 'sendRichMessage', {
      chat_id: supergroupChat.chatId,
      rich_message: { blocks },
    });
  const notEnoughRights = 'Bad Request: not enough rights to send the rich message to the chat';

  await setPermissions({ can_send_messages: true, can_send_voice_notes: true });
  const historyBefore = await getHistory(grace.id, supergroupChat);
  const withoutVideos = [
    await sendToSupergroup([nestedVoiceNote, nestedVideo]),
    await callBot(bot.botApiPath, 'copyMessage', {
      chat_id: supergroupChat.chatId,
      from_chat_id: ada.id,
      message_id: privateRichMessage.body.result?.message_id,
    }),
    await callBot(bot.botApiPath, 'forwardMessage', {
      chat_id: supergroupChat.chatId,
      from_chat_id: ada.id,
      message_id: privateRichMessage.body.result?.message_id,
    }),
  ].map(({ body }) => body.description);
  const historyWithoutVideos = await getHistory(grace.id, supergroupChat);
  const voiceNoteOnly = await sendToSupergroup([nestedVoiceNote]);

  await setPermissions({ can_send_messages: true, can_send_videos: true });
  const withoutVoiceNotes = await sendToSupergroup([nestedVideo, nestedVoiceNote]);
  const videoOnly = await sendToSupergroup([nestedVideo]);
  // An account forwards the bot's rich message only with the permissions of its media.
  const graceForward = await sendAccountMessage(grace.id, {
    to: supergroupChat,
    forward: { chat: supergroupChat, message_id: voiceNoteOnly.body.result?.message_id },
  });
  expectEqual(
    [
      withoutVideos,
      historyWithoutVideos,
      voiceNoteOnly.body.ok,
      withoutVoiceNotes.body.description,
      videoOnly.body.ok,
      graceForward.status,
      (await getHistory(ada.id, privateChat)).length,
    ],
    [
      [
        notEnoughRights,
        "Bad Request: the message can't be copied",
        "Bad Request: the message can't be forwarded",
      ],
      historyBefore,
      true,
      notEnoughRights,
      true,
      403,
      4,
    ],
    'Expected each block to need the permission of its media',
  );
});

Deno.test('inline results send video and voice note blocks the bot knows, but no URLs or uploads', async () => {
  const {
    api,
    accountPath,
    ada,
    grace,
    bot,
    privateChat,
    supergroupChat,
    supergroupPath,
    callBot,
    getHistory,
    readUpdates,
    uploadAccountMedia,
  } = await createRichMediaFixture();
  const { videoFileId, voiceFileId } = await uploadAccountMedia(readUpdates);
  const sendQuery = async (accountId: number, chat: typeof privateChat | typeof supergroupChat) =>
    (await requestJson<{ inline_query: TestInlineQuery }>(
      api,
      'POST',
      `${accountPath(accountId)}/inline-queries`,
      { bot_id: bot.id, chat, query: 'clips' },
    )).body.inline_query;
  const choose = (accountId: number, inlineQueryId: string, resultId: string) =>
    requestJson<{ message?: TestMessage }>(
      api,
      'POST',
      `${accountPath(accountId)}/inline-queries/${inlineQueryId}/chosen-results`,
      { result_id: resultId },
    );
  const richResult = (id: string, blocks: readonly Record<string, unknown>[]) => ({
    type: 'article',
    id,
    title: 'Clips',
    input_message_content: { rich_message: { blocks } },
    reply_markup: { inline_keyboard: [[{ text: 'More', callback_data: 'more' }]] },
  });
  const knownBlocks = [
    {
      type: 'blockquote',
      blocks: [
        { type: 'video', video: { type: 'video', media: videoFileId, has_spoiler: true } },
        { type: 'voice_note', voice_note: { type: 'voice_note', media: voiceFileId } },
      ],
    },
  ];

  const groupQuery = await sendQuery(ada.id, supergroupChat);
  const refusedAnswers = [
    await callBot(bot.botApiPath, 'answerInlineQuery', {
      inline_query_id: groupQuery.id,
      results: [richResult('url', [{ type: 'video', video: { type: 'video', media: CLIP_URL } }])],
    }),
    await callBot(bot.botApiPath, 'answerInlineQuery', {
      inline_query_id: groupQuery.id,
      results: [
        richResult('url', [{
          type: 'voice_note',
          voice_note: { type: 'voice_note', media: MEMO_URL },
        }]),
      ],
    }),
    await callBotWithFiles(api, `${bot.botApiPath}/answerInlineQuery`, {
      inline_query_id: groupQuery.id,
      results: JSON.stringify([
        richResult('upload', [{ type: 'video', video: { type: 'video', media: 'attach://clip' } }]),
      ]),
    }, { clip: new File([CLIP_BYTES], 'clip.mp4') }),
  ].map(({ body }) => body.description);
  const unanswered = (await requestJson<{ inline_query: TestInlineQuery }>(
    api,
    'GET',
    `${accountPath(ada.id)}/inline-queries/${groupQuery.id}`,
  )).body.inline_query;
  const answered = await callBot(bot.botApiPath, 'answerInlineQuery', {
    inline_query_id: groupQuery.id,
    results: [richResult('known', knownBlocks)],
  });
  // Choosing the result again sends the same files once more.
  const chosenMessages = [
    (await choose(ada.id, groupQuery.id, 'known')).body.message,
    (await choose(ada.id, groupQuery.id, 'known')).body.message,
  ];
  const graceView = (await getHistory(grace.id, supergroupChat)).at(-1);
  const updates = await readUpdates();
  const inlineMessageId = (updates.find((update) => update.chosen_inline_result)
    ?.chosen_inline_result as { inline_message_id?: string } | undefined)?.inline_message_id;

  // An edit of the inline message may name the files by URL, which are downloaded as it is made.
  const urlEdit = await callBot(bot.botApiPath, 'editMessageText', {
    inline_message_id: inlineMessageId,
    rich_message: {
      blocks: [
        { type: 'video', video: { type: 'video', media: CLIP_URL, duration: 4 } },
        { type: 'voice_note', voice_note: { type: 'voice_note', media: MEMO_URL, duration: 2 } },
      ],
    },
  });
  const editedMessages = (await getHistory(ada.id, supergroupChat)).slice(-2);

  await requestJson(api, 'PUT', `${supergroupPath(ada.id)}/permissions`, {
    permissions: { can_send_messages: true, can_send_videos: true },
  });
  const graceQuery = await sendQuery(grace.id, supergroupChat);
  await callBot(bot.botApiPath, 'answerInlineQuery', {
    inline_query_id: graceQuery.id,
    results: [richResult('known', knownBlocks)],
  });
  const graceChoice = await choose(grace.id, graceQuery.id, 'known');

  const invalidContent = 'Bad Request: invalid inline message content specified';
  const fileTypes = (message: TestMessage | undefined) =>
    listBlockFiles(message).map(({ type, file }) => [type, file.file_unique_id]);
  expectEqual(
    [
      refusedAnswers,
      unanswered.answer,
      answered.body.ok,
      chosenMessages.map((message) => message?.via_bot?.id),
      fileTypes(chosenMessages[1]),
      chosenMessages[0]?.rich_message?.blocks[0]?.blocks?.[0]?.has_spoiler,
      listBlockFiles(chosenMessages[0]).every(({ file }) =>
        file.file_id !== videoFileId && file.file_id !== voiceFileId
      ),
      fileTypes(graceView),
      urlEdit.body.ok,
      editedMessages.map((message) =>
        listBlockFiles(message).map(({ type, file }) => [type, file.duration])
      ),
      graceChoice.status,
    ],
    [
      [invalidContent, invalidContent, invalidContent],
      null,
      true,
      [bot.id, bot.id],
      fileTypes(chosenMessages[0]),
      true,
      true,
      fileTypes(chosenMessages[0]),
      true,
      // Only the first message the result sent was edited.
      [[['video', 4], ['voice_note', 2]], [['video', 9], ['voice_note', 4]]],
      403,
    ],
    'Expected inline results to send only files the bot knows',
  );
});
