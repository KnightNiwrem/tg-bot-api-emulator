import { createEmulationApi } from '../src/api/mod.ts';
import { createSessionLifecycleService } from '../src/composition/session_lifecycle.ts';

type EmulationApi = ReturnType<typeof createEmulationApi>;

interface TestPhotoSize {
  readonly file_id: string;
  readonly file_unique_id: string;
  readonly width: number;
  readonly height: number;
}

interface TestMessage {
  readonly message_id: number;
  readonly from?: { readonly id: number };
  readonly text?: string;
  readonly photo?: readonly TestPhotoSize[];
  readonly document?: {
    readonly file_id: string;
    readonly file_unique_id: string;
    readonly file_name?: string;
    readonly mime_type?: string;
  };
  readonly caption?: string;
  readonly show_caption_above_media?: boolean;
  readonly via_bot?: { readonly id: number; readonly username?: string };
  readonly reply_markup?: unknown;
}

interface TestInlineQuery {
  readonly id: string;
  readonly status: string;
  readonly answer: { readonly results: readonly Record<string, unknown>[] } | null;
}

/** A JPEG image of only a frame header, which is all the emulator reads of it. */
function jpegImage(width: number, height: number): Uint8Array<ArrayBuffer> {
  const image = new Uint8Array(21);
  const view = new DataView(image.buffer);
  view.setUint16(0, 0xffd8);
  view.setUint16(2, 0xffc0);
  view.setUint16(4, 17);
  view.setUint8(6, 8);
  view.setUint16(7, height);
  view.setUint16(9, width);
  return image;
}

const CAT_PHOTO_URL = 'https://cdn.example.com/cat.jpg';
const CATS_PDF_URL = 'https://cdn.example.com/docs/cats.pdf';
const THUMBNAIL_URL = 'https://cdn.example.com/cat-thumbnail.jpg';

/**
 * Creates a session where Ada owns a supergroup with Grace and has started a private chat with
 * the inline bot, which receives chosen results, and the emulated web serves a JPEG photo and a
 * PDF document.
 */
async function createInlineMediaFixture() {
  const api = createEmulationApi({
    sessionLifecycle: createSessionLifecycleService(),
    publicOrigin: 'http://emulator.example:9000',
  });
  const sessionPath = (await api.request('/sessions', { method: 'POST' })).headers.get('Location');
  if (sessionPath === null) {
    throw new Error('Expected the created session to have a Location');
  }
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
        first_name: 'Media Bot',
        username,
        supports_inline_queries: true,
        receives_chosen_inline_results: true,
      },
    );
    return { ...body.bot, botApiPath: `${sessionPath}/bot-api/bot${body.token}` };
  };
  const bot = await createBot('media_bot');
  const otherBot = await createBot('other_media_bot');
  const accountPath = (accountId: number) => `${sessionPath}/accounts/${accountId}`;
  const privateChat = { type: 'private', botId: bot.id } as const;
  await requestJson(api, 'POST', `${accountPath(ada.id)}/messages`, {
    to: privateChat,
    text: '/start',
  });
  const { body: { supergroup } } = await requestJson<{ supergroup: { id: number } }>(
    api,
    'POST',
    `${accountPath(ada.id)}/supergroups`,
    { title: 'Team' },
  );
  const supergroupChat = { type: 'supergroup', chatId: supergroup.id } as const;
  const supergroupPath = (accountId: number) =>
    `${accountPath(accountId)}/conversations/supergroup/${supergroup.id}`;
  await api.request(`${supergroupPath(ada.id)}/members/${grace.id}`, { method: 'PUT' });

  const registerWebResource = async (url: string, contentType: string, content: Uint8Array) => {
    const response = await api.request(`${sessionPath}/web-resources`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url,
        content_type: contentType,
        content_base64: content.toBase64(),
      }),
    });
    if (response.status !== 201) {
      throw new Error(`Expected ${url} to be registered, received ${response.status}`);
    }
  };
  await registerWebResource(CAT_PHOTO_URL, 'image/jpeg', jpegImage(640, 480));
  await registerWebResource(CATS_PDF_URL, 'application/pdf', new TextEncoder().encode('%PDF-1.7'));

  const callBot = (
    botApiPath: string,
    method: string,
    parameters: Record<string, unknown>,
  ) =>
    requestJson<{ ok: boolean; result?: unknown; description?: string }>(
      api,
      'POST',
      `${botApiPath}/${method}`,
      parameters,
    );
  const sendQuery = async (
    accountId: number,
    chat: typeof privateChat | typeof supergroupChat = privateChat,
    query = 'cats',
  ) =>
    (await requestJson<{ inline_query: TestInlineQuery }>(
      api,
      'POST',
      `${accountPath(accountId)}/inline-queries`,
      { bot_id: bot.id, chat, query },
    )).body.inline_query;
  const getInlineQuery = async (accountId: number, inlineQueryId: string) =>
    (await requestJson<{ inline_query: TestInlineQuery }>(
      api,
      'GET',
      `${accountPath(accountId)}/inline-queries/${inlineQueryId}`,
    )).body.inline_query;
  const answer = (inlineQueryId: string, results: readonly Record<string, unknown>[]) =>
    callBot(bot.botApiPath, 'answerInlineQuery', { inline_query_id: inlineQueryId, results });
  const choose = (accountId: number, inlineQueryId: string, resultId: string) =>
    requestJson<{ message: TestMessage } | undefined>(
      api,
      'POST',
      `${accountPath(accountId)}/inline-queries/${inlineQueryId}/chosen-results`,
      { result_id: resultId },
    );
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
    ada,
    grace,
    bot,
    otherBot,
    privateChat,
    supergroupChat,
    accountPath,
    supergroupPath,
    callBot,
    sendQuery,
    getInlineQuery,
    answer,
    choose,
    getHistory,
    readUpdates,
  };
}

/** Returns a reader of the bot's updates since the reader last read them. */
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

async function requestJson<Body>(
  api: EmulationApi,
  method: 'DELETE' | 'GET' | 'POST' | 'PUT',
  path: string,
  body?: unknown,
): Promise<{ status: number; body: Body }> {
  const response = await api.request(path, {
    method,
    ...(body === undefined
      ? {}
      : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  });
  const text = await response.text();
  return {
    status: response.status,
    body: (text.length === 0 ? undefined : JSON.parse(text)) as Body,
  };
}

/** Edits an inline message's media to an uploaded photo, which an inline message cannot take. */
async function uploadMediaEdit(api: EmulationApi, botApiPath: string, inlineMessageId: string) {
  const form = new FormData();
  form.set('inline_message_id', inlineMessageId);
  form.set('media', JSON.stringify({ type: 'photo', media: 'attach://cat' }));
  form.set('cat', new File([jpegImage(64, 48)], 'cat.jpg'));
  const response = await api.request(`${botApiPath}/editMessageMedia`, {
    method: 'POST',
    body: form,
  });
  return {
    status: response.status,
    body: await response.json() as { ok: boolean; result?: unknown; description?: string },
  };
}

function expectEqual(actual: unknown, expected: unknown, message: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `${message}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`,
    );
  }
}

const urlPhotoResult = {
  type: 'photo',
  id: 'cat',
  photo_url: CAT_PHOTO_URL,
  thumbnail_url: THUMBNAIL_URL,
  photo_width: 640,
  photo_height: 480,
  title: 'A cat',
  description: 'Sleeping',
  caption: '*Purr*',
  parse_mode: 'MarkdownV2',
  show_caption_above_media: true,
};

const urlDocumentResult = {
  type: 'document',
  id: 'cats-pdf',
  title: 'Cats',
  document_url: CATS_PDF_URL,
  mime_type: 'application/pdf',
  caption: 'All about cats',
  reply_markup: { inline_keyboard: [[{ text: 'Like', callback_data: 'like' }]] },
};

Deno.test('an account sends photos and documents that an inline result names by URL', async () => {
  const {
    ada,
    bot,
    privateChat,
    sendQuery,
    getInlineQuery,
    answer,
    choose,
    getHistory,
    readUpdates,
  } = await createInlineMediaFixture();
  const inlineQuery = await sendQuery(ada.id);
  const answered = await answer(inlineQuery.id, [urlPhotoResult, urlDocumentResult]);
  expectEqual(answered.body, { ok: true, result: true }, 'Expected the answer to be accepted');
  expectEqual(
    (await getInlineQuery(ada.id, inlineQuery.id)).answer?.results,
    [
      { type: 'photo', id: 'cat', title: 'A cat', description: 'Sleeping' },
      { type: 'document', id: 'cats-pdf', title: 'Cats' },
    ],
    'Expected the account to see the listing',
  );

  const chosenPhoto = await choose(ada.id, inlineQuery.id, 'cat');
  const photoMessage = chosenPhoto.body?.message;
  expectEqual(
    [
      chosenPhoto.status,
      photoMessage?.photo?.map(({ width, height }) => [width, height]),
      photoMessage?.caption,
      photoMessage?.show_caption_above_media,
      photoMessage?.via_bot?.id,
    ],
    [201, [[640, 480]], 'Purr', true, bot.id],
    'Expected the photo downloaded from the URL, sent through the bot',
  );
  const chosenDocument = await choose(ada.id, inlineQuery.id, 'cats-pdf');
  const documentMessage = chosenDocument.body?.message;
  expectEqual(
    [
      chosenDocument.status,
      documentMessage?.document?.file_name,
      documentMessage?.document?.mime_type,
      documentMessage?.caption,
      documentMessage?.via_bot?.id,
    ],
    [201, 'cats.pdf', 'application/pdf', 'All about cats', bot.id],
    'Expected the document named after the URL, sent through the bot',
  );
  const history = await getHistory(ada.id, privateChat);
  expectEqual(
    history.slice(-2).map((message) => message.message_id),
    [photoMessage?.message_id, documentMessage?.message_id],
    'Expected both results in the conversation',
  );

  const updates = await readUpdates();
  const chosenResults = updates.flatMap((update) =>
    update.chosen_inline_result === undefined ? [] : [update.chosen_inline_result]
  ) as Array<Record<string, unknown>>;
  expectEqual(
    chosenResults.map(({ result_id, inline_message_id }) => [
      result_id,
      typeof inline_message_id,
    ]),
    [['cat', 'undefined'], ['cats-pdf', 'string']],
    'Expected each choice, with an inline message ID for the result with a keyboard',
  );

  // Telegram downloads the media each time an account sends the result.
  const resent = await choose(ada.id, inlineQuery.id, 'cat');
  if (
    resent.status !== 201 ||
    resent.body?.message.photo?.[0]?.file_unique_id === photoMessage?.photo?.[0]?.file_unique_id
  ) {
    throw new Error('Expected sending the result again to download the photo anew');
  }
});

Deno.test('a result naming media by URL sends its input_message_content instead', async () => {
  const { ada, sendQuery, answer, choose } = await createInlineMediaFixture();
  const inlineQuery = await sendQuery(ada.id);
  const answered = await answer(inlineQuery.id, [
    {
      ...urlPhotoResult,
      // The emulated web serves nothing here: only the listing shows the photo.
      photo_url: 'https://cdn.example.com/unserved.jpg',
      input_message_content: { message_text: 'A cat, described' },
    },
    { ...urlDocumentResult, input_message_content: { message_text: 'A PDF, described' } },
  ]);
  const chosen = [
    await choose(ada.id, inlineQuery.id, 'cat'),
    await choose(ada.id, inlineQuery.id, 'cats-pdf'),
  ];
  expectEqual(
    [answered.body, ...chosen.map(({ status, body }) => [status, body?.message.text])],
    [{ ok: true, result: true }, [201, 'A cat, described'], [201, 'A PDF, described']],
    'Expected the text in place of the media',
  );
});

Deno.test('answerInlineQuery checks results naming media by URL and records no part of a refused answer', async () => {
  const { api, ada, bot, otherBot, accountPath, callBot, sendQuery, getInlineQuery, answer } =
    await createInlineMediaFixture();
  await requestJson(api, 'POST', `${accountPath(ada.id)}/messages`, {
    to: { type: 'private', botId: otherBot.id },
    text: '/start',
  });
  const sendPhotoFileId = async (botApiPath: string) =>
    ((await callBot(botApiPath, 'sendPhoto', { chat_id: ada.id, photo: CAT_PHOTO_URL })).body
      .result as TestMessage).photo?.[0]?.file_id;
  const ownPhotoFileId = await sendPhotoFileId(bot.botApiPath);
  const otherBotPhotoFileId = await sendPhotoFileId(otherBot.botApiPath);
  const inlineQuery = await sendQuery(ada.id);
  const article = {
    type: 'article',
    id: 'article',
    title: 'Cats',
    input_message_content: { message_text: 'Cats' },
  };
  const refusals = [
    [article, { type: 'photo', id: 'cat', photo_file_id: otherBotPhotoFileId }],
    [article, { type: 'document', id: 'cat', title: 'Cat', document_file_id: ownPhotoFileId }],
    [article, { ...urlPhotoResult, photo_url: 'ftp://cdn.example.com/cat.jpg' }],
    [article, { ...urlDocumentResult, document_url: 'ftp://cdn.example.com/cats.pdf' }],
    [article, { ...urlPhotoResult, thumbnail_url: '' }],
    [article, { ...urlDocumentResult, mime_type: 'image/jpeg' }],
    [article, { ...urlDocumentResult, mime_type: undefined }],
    [article, { ...urlDocumentResult, title: '' }],
    [article, { ...urlPhotoResult, caption: 'a'.repeat(1_025), parse_mode: undefined }],
    [article, { ...urlPhotoResult, id: 'article' }],
  ];
  const descriptions = [];
  for (const results of refusals) {
    descriptions.push((await answer(inlineQuery.id, results)).body.description);
  }
  expectEqual(
    descriptions,
    [
      "Bad Request: wrong remote file identifier specified: can't unserialize it",
      "Bad Request: can't use file of type Photo as Document",
      'Bad Request: WEBDOCUMENT_URL_INVALID',
      'Bad Request: WEBDOCUMENT_URL_INVALID',
      'Bad Request: PHOTO_THUMB_URL_EMPTY',
      'Bad Request: unallowed document MIME type',
      'Bad Request: invalid answerInlineQuery parameters',
      'Bad Request: FILE_TITLE_EMPTY',
      'Bad Request: MEDIA_CAPTION_TOO_LONG',
      'Bad Request: RESULT_ID_DUPLICATE',
    ],
    "Expected Telegram's errors",
  );
  expectEqual(
    (await getInlineQuery(ada.id, inlineQuery.id)).status,
    'awaiting_answer',
    'Expected refused answers to leave the query unanswered',
  );
  // TDLib reads the declared type by its prefix, so parameters after it are allowed.
  const accepted = await answer(inlineQuery.id, [
    { ...urlDocumentResult, mime_type: 'application/pdf; charset=binary' },
  ]);
  expectEqual(accepted.body, { ok: true, result: true }, 'Expected the PDF type to be accepted');
});

Deno.test('an account cannot send media at a URL the emulated web does not serve as the result kind', async () => {
  const { ada, privateChat, sendQuery, answer, choose, getHistory, readUpdates } =
    await createInlineMediaFixture();
  const inlineQuery = await sendQuery(ada.id);
  await answer(inlineQuery.id, [
    { ...urlPhotoResult, id: 'unserved', photo_url: 'https://cdn.example.com/unserved.jpg' },
    // An inline photo must be a JPEG image, unlike a photo that sendPhoto sends by URL.
    { ...urlPhotoResult, id: 'pdf-as-photo', photo_url: CATS_PDF_URL },
    { ...urlDocumentResult, id: 'photo-as-document', document_url: CAT_PHOTO_URL },
  ]);
  const historyBefore = await getHistory(ada.id, privateChat);
  await readUpdates();

  const statuses = [
    (await choose(ada.id, inlineQuery.id, 'unserved')).status,
    (await choose(ada.id, inlineQuery.id, 'pdf-as-photo')).status,
    (await choose(ada.id, inlineQuery.id, 'photo-as-document')).status,
  ];
  expectEqual(statuses, [502, 422, 422], 'Expected unusable media to be refused');
  expectEqual(
    [(await getHistory(ada.id, privateChat)).length, (await readUpdates()).length],
    [historyBefore.length, 0],
    'Expected no message and no chosen result',
  );
});

Deno.test('URL media follows supergroup permissions, blocking, cached answers and inline edits', async () => {
  const {
    api,
    ada,
    grace,
    bot,
    otherBot,
    privateChat,
    supergroupChat,
    accountPath,
    supergroupPath,
    callBot,
    sendQuery,
    answer,
    choose,
    getHistory,
    readUpdates,
  } = await createInlineMediaFixture();

  // Grace may write in the supergroup but not send photos there.
  const permissionsResponse = await requestJson(
    api,
    'PUT',
    `${supergroupPath(ada.id)}/permissions`,
    {
      permissions: {
        can_send_messages: true,
        can_send_documents: true,
        can_send_other_messages: true,
      },
    },
  );
  const groupQuery = await sendQuery(grace.id, supergroupChat);
  await answer(groupQuery.id, [urlPhotoResult, urlDocumentResult]);
  const photoRefusal = await choose(grace.id, groupQuery.id, 'cat');
  const sentDocument = await choose(grace.id, groupQuery.id, 'cats-pdf');
  const groupHistory = await getHistory(grace.id, supergroupChat);
  expectEqual(
    [
      permissionsResponse.status,
      photoRefusal.status,
      sentDocument.status,
      groupHistory.at(-1)?.document?.file_name,
      groupHistory.at(-1)?.via_bot?.id,
    ],
    [204, 403, 201, 'cats.pdf', bot.id],
    'Expected only the document to be sent to the supergroup',
  );

  // The answer to Ada's query is not personal, so Grace's same query receives it too.
  const adaQuery = await sendQuery(ada.id, privateChat, 'kittens');
  await answer(adaQuery.id, [urlPhotoResult, urlDocumentResult]);
  const graceQuery = await sendQuery(grace.id, { type: 'private', botId: bot.id }, 'kittens');
  await requestJson(api, 'POST', `${accountPath(grace.id)}/messages`, {
    to: { type: 'private', botId: bot.id },
    text: '/start',
  });
  const fromCachedAnswer = await choose(grace.id, graceQuery.id, 'cat');
  expectEqual(
    [graceQuery.status, fromCachedAnswer.status, fromCachedAnswer.body?.message.photo?.length],
    ['answered', 201, 1],
    'Expected the cached answer to send the photo, downloaded for Grace',
  );
  await requestJson(api, 'PUT', `${accountPath(grace.id)}/blocked-bots/${bot.id}`);
  expectEqual(
    (await choose(grace.id, graceQuery.id, 'cat')).status,
    409,
    'Expected a blocked bot to refuse the result',
  );

  // The bot edits the inline message it sent the document as.
  await readUpdates();
  await choose(ada.id, adaQuery.id, 'cats-pdf');
  const chosenResult = (await readUpdates()).find((update) => update.chosen_inline_result)
    ?.chosen_inline_result as { inline_message_id?: string } | undefined;
  const inlineMessageId = chosenResult?.inline_message_id;
  if (inlineMessageId === undefined) {
    throw new Error('Expected the document result to have an inline message ID');
  }
  const edits = [
    await callBot(bot.botApiPath, 'editMessageCaption', {
      inline_message_id: inlineMessageId,
      caption: 'Cats, revised',
    }),
    await callBot(bot.botApiPath, 'editMessageMedia', {
      inline_message_id: inlineMessageId,
      media: { type: 'photo', media: CAT_PHOTO_URL },
    }),
    await uploadMediaEdit(api, bot.botApiPath, inlineMessageId),
    await callBot(otherBot.botApiPath, 'editMessageCaption', {
      inline_message_id: inlineMessageId,
      caption: 'Dogs',
    }),
  ].map(({ body }) => body.ok ? body.result : body.description);
  const editedMessage = (await getHistory(ada.id, privateChat)).at(-1);
  expectEqual(
    [edits, editedMessage?.photo?.length, editedMessage?.via_bot?.id],
    [
      [
        true,
        true,
        'Bad Request: invalid message content specified',
        'Bad Request: MESSAGE_ID_INVALID',
      ],
      1,
      bot.id,
    ],
    'Expected the inline bot alone to edit the message, without uploads',
  );
});
