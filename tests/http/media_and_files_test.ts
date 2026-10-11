import { Bot } from 'https://cdn.jsdelivr.net/gh/grammyjs/grammY@^1.46.0/src/bot.ts';
import { InputFile } from 'https://cdn.jsdelivr.net/gh/grammyjs/grammY@^1.46.0/src/types.ts';

import { jsonRequest, TEST_PUBLIC_ORIGIN } from '../support/emulation_api.ts';
import {
  isBadRequestResponse,
  isGetUpdatesResponse,
  isNotFoundResponse,
} from '../support/http_response_guards.ts';
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

Deno.test('sendPhoto and sendDocument upload files, reuse file IDs, and follow Telegram checks', async () => {
  const { api, botApiPath, createdAccount, sendText } = await createPrivateConversationFixture();
  await sendText('/start');
  const chatId = createdAccount.account.id;

  const uploadedPhoto = await callBotApiWithFiles(api, `${botApiPath}/sendPhoto`, {
    chat_id: String(chatId),
    caption: '<b>Chart</b>',
    parse_mode: 'HTML',
    has_spoiler: 'true',
  }, { photo: new File([gifImage(640, 480)], 'chart.gif') });
  const photo = botApiResult(uploadedPhoto.body);
  const photoSize = Array.isArray(photo?.photo) ? photo.photo[0] : undefined;
  if (
    uploadedPhoto.status !== 200 || photo?.caption !== 'Chart' ||
    JSON.stringify(photo.caption_entities) !==
      JSON.stringify([{ type: 'bold', offset: 0, length: 5 }]) ||
    photo.has_media_spoiler !== true || photoSize?.width !== 640 || photoSize.height !== 480
  ) {
    throw new Error(`Expected an uploaded photo, received ${JSON.stringify(uploadedPhoto.body)}`);
  }

  const uploadedDocument = await callBotApiWithFiles(api, `${botApiPath}/sendDocument`, {
    chat_id: String(chatId),
    document: 'attach://attachment',
  }, { attachment: new File(['a,b\n'], 'folder/report?.csv') });
  const document = botApiResult(uploadedDocument.body)?.document as
    | Record<string, unknown>
    | undefined;
  if (
    uploadedDocument.status !== 200 || document?.file_name !== 'report.csv' ||
    document.mime_type !== 'text/csv' || document.file_size !== 4 ||
    typeof document.file_id !== 'string'
  ) {
    throw new Error(
      `Expected an attached document, received ${JSON.stringify(uploadedDocument.body)}`,
    );
  }

  const reusedPhoto = await callBotApi(api, `${botApiPath}/sendPhoto`, {
    chat_id: chatId,
    photo: photoSize.file_id,
  });
  const reusedPhotoSize = (botApiResult(reusedPhoto.body)?.photo as unknown[] | undefined)?.[0];
  if (
    reusedPhoto.status !== 200 ||
    JSON.stringify(reusedPhotoSize) !== JSON.stringify(photoSize)
  ) {
    throw new Error(`Expected the photo to be sent again, received ${JSON.stringify(reusedPhoto)}`);
  }

  const failures: {
    method: string;
    parameters: Record<string, string | number>;
    files: Record<string, File>;
  }[] = [
    { method: 'sendPhoto', parameters: { chat_id: chatId }, files: {} },
    { method: 'sendPhoto', parameters: { chat_id: chatId, photo: 'attach://missing' }, files: {} },
    { method: 'sendDocument', parameters: { chat_id: chatId }, files: {} },
    {
      method: 'sendPhoto',
      parameters: { chat_id: chatId, photo: 'https://example.com/chart.png' },
      files: {},
    },
    {
      method: 'sendPhoto',
      parameters: { chat_id: chatId },
      files: { photo: new File(['not an image'], 'chart.png') },
    },
    {
      method: 'sendPhoto',
      parameters: { chat_id: chatId },
      files: { photo: new File([gifImage(5_001, 5_000)], 'huge.gif') },
    },
    { method: 'sendPhoto', parameters: { chat_id: chatId }, files: { photo: new File([], 'a') } },
    {
      method: 'sendPhoto',
      parameters: { chat_id: chatId },
      files: {
        photo: new File([gifImage(1_280, 720), new Uint8Array(10 * 1024 * 1024)], 'big.gif'),
      },
    },
    {
      method: 'sendPhoto',
      parameters: { chat_id: chatId, photo: 'AgACAgIAAxkBAAIBdGZ' },
      files: {},
    },
    { method: 'sendPhoto', parameters: { chat_id: chatId, photo: document.file_id }, files: {} },
    {
      method: 'sendDocument',
      parameters: { chat_id: chatId, document: photoSize.file_id },
      files: {},
    },
    {
      method: 'sendPhoto',
      parameters: { chat_id: chatId, photo: photoSize.file_id, caption: 'x'.repeat(1_025) },
      files: {},
    },
    {
      method: 'sendPhoto',
      parameters: {
        chat_id: chatId,
        photo: photoSize.file_id,
        caption: 'Done.',
        parse_mode: 'MarkdownV2',
      },
      files: {},
    },
    { method: 'sendPhoto', parameters: { photo: photoSize.file_id }, files: {} },
  ];
  const descriptions = [];
  for (const { method, parameters, files } of failures) {
    const { status, body } = await callBotApiWithFiles(
      api,
      `${botApiPath}/${method}`,
      Object.fromEntries(Object.entries(parameters).map(([name, value]) => [name, String(value)])),
      files,
    );
    descriptions.push(status === 400 && isBadRequestResponse(body) ? body.description : status);
  }
  const expectedDescriptions = [
    'Bad Request: there is no photo in the request',
    'Bad Request: there is no photo in the request',
    'Bad Request: there is no document in the request',
    'Bad Request: failed to get HTTP URL content',
    'Bad Request: IMAGE_PROCESS_FAILED',
    'Bad Request: PHOTO_INVALID_DIMENSIONS',
    'Bad Request: file must be non-empty',
    `Bad Request: file of size ${
      gifImage(1_280, 720).length + 10 * 1024 * 1024
    } bytes is too big for a photo; the maximum size is 10485760 bytes`,
    'Bad Request: wrong file identifier/HTTP URL specified',
    "Bad Request: can't use file of type Document as Photo",
    "Bad Request: can't use file of type Photo as Document",
    'Bad Request: message caption is too long',
    "Bad Request: can't parse entities: Character '.' is reserved and must be escaped with the preceding '\\'",
    'Bad Request: chat_id is empty',
  ];
  if (JSON.stringify(descriptions) !== JSON.stringify(expectedDescriptions)) {
    throw new Error(
      `Expected Telegram's errors, received ${JSON.stringify(descriptions, null, 2)}`,
    );
  }
});

Deno.test('a cloud session answers bot uploads over 50 MB with 413 and keeps no trace', async () => {
  const { api, sessionPath, botApiPath, createdBot, createdAccount, sendText } =
    await createPrivateConversationFixture();
  await sendText('/start');
  const chatId = String(createdAccount.account.id);
  const maxUploadBytes = 50 * 1024 * 1024;

  const atLimit = await callBotApiWithFiles(api, `${botApiPath}/sendDocument`, {
    chat_id: chatId,
  }, { document: new File([new Uint8Array(maxUploadBytes)], 'at-limit.bin') });
  const atLimitMessage = botApiResult(atLimit.body);
  const atLimitDocument = atLimitMessage?.document as Record<string, unknown> | undefined;
  if (atLimit.status !== 200 || atLimitDocument?.file_size !== maxUploadBytes) {
    throw new Error(`Expected a document of exactly 50 MB, received ${atLimit.status}`);
  }

  const oversizedFile = new File([new Uint8Array(maxUploadBytes + 1)], 'oversized.bin');
  const oversizedAnswers = [
    await callBotApiWithFiles(api, `${botApiPath}/sendDocument`, { chat_id: chatId }, {
      document: oversizedFile,
    }),
    await callBotApiWithFiles(api, `${botApiPath}/sendPhoto`, { chat_id: chatId }, {
      photo: oversizedFile,
    }),
    await callBotApiWithFiles(api, `${botApiPath}/sendVideo`, { chat_id: chatId }, {
      video: oversizedFile,
    }),
    await callBotApiWithFiles(api, `${botApiPath}/sendVoice`, { chat_id: chatId }, {
      voice: oversizedFile,
    }),
    await callBotApiWithFiles(api, `${botApiPath}/editMessageMedia`, {
      chat_id: chatId,
      message_id: String(atLimitMessage?.message_id),
      media: JSON.stringify({ type: 'document', media: 'attach://replacement' }),
    }, { replacement: oversizedFile }),
    await callBotApiWithFiles(api, `${botApiPath}/sendRichMessage`, {
      chat_id: chatId,
      rich_message: JSON.stringify({
        blocks: [{ type: 'document', document: { type: 'document', media: 'attach://block' } }],
      }),
    }, { block: oversizedFile }),
  ];
  for (const { status, body } of oversizedAnswers) {
    if (
      status !== 413 || JSON.stringify(body) !==
        JSON.stringify({ ok: false, error_code: 413, description: 'Request Entity Too Large' })
    ) {
      throw new Error(`Expected 413 Request Entity Too Large, received ${JSON.stringify(body)}`);
    }
  }

  const historyResponse = await api.request(
    `${sessionPath}/accounts/${chatId}/conversations/private/${createdBot.bot.id}/messages`,
  );
  const history = await historyResponse.json() as {
    messages: { document?: { file_name: string } }[];
  };
  const documentNames = history.messages.map((message) => message.document?.file_name ?? null);
  if (JSON.stringify(documentNames) !== JSON.stringify([null, 'at-limit.bin'])) {
    throw new Error(`Expected only the document within the limit, received ${documentNames}`);
  }

  const activityResponse = await api.request(
    `${sessionPath}/bot-activity?kind=bot_api_call&bot_id=${createdBot.bot.id}`,
  );
  const activity = await activityResponse.json() as {
    entries: { method: string; answer: { error_code?: number } }[];
  };
  const recordedAnswers = activity.entries.map((entry) => [
    entry.method,
    entry.answer.error_code ?? 200,
  ]);
  if (
    JSON.stringify(recordedAnswers) !== JSON.stringify([
      ['sendDocument', 200],
      ['sendDocument', 413],
      ['sendPhoto', 413],
      ['sendVideo', 413],
      ['sendVoice', 413],
      ['editMessageMedia', 413],
      ['sendRichMessage', 413],
    ])
  ) {
    throw new Error(`Expected the refused calls to be recorded, received ${recordedAnswers}`);
  }
});

Deno.test('a local session lets bots upload documents, videos and voice notes over 50 MB that getFile cannot serve', async () => {
  const { api, botApiPath, createdAccount, sendText } = await createPrivateConversationFixture({
    upload_profile: 'local',
  });
  await sendText('/start');
  const fileSizeBytes = 50 * 1024 * 1024 + 1;
  const largeFile = new File([new Uint8Array(fileSizeBytes)], 'large.mp4');

  const uploads = [
    ['sendDocument', 'document'],
    ['sendVideo', 'video'],
    ['sendVoice', 'voice'],
  ] as const;
  for (const [method, kind] of uploads) {
    const uploaded = await callBotApiWithFiles(api, `${botApiPath}/${method}`, {
      chat_id: String(createdAccount.account.id),
    }, { [kind]: largeFile });
    const file = botApiResult(uploaded.body)?.[kind] as Record<string, unknown> | undefined;
    if (uploaded.status !== 200 || file?.file_size !== fileSizeBytes) {
      throw new Error(`Expected the large ${kind} to be sent, received ${uploaded.status}`);
    }

    // The local profile changes only upload limits; downloads keep the cloud server's 20 MB cap.
    const download = await callBotApi(api, `${botApiPath}/getFile`, { file_id: file.file_id });
    if (
      download.status !== 400 || !isBadRequestResponse(download.body) ||
      download.body.description !== 'Bad Request: file is too big'
    ) {
      throw new Error(`Expected getFile to refuse the file, received ${JSON.stringify(download)}`);
    }
  }
});

Deno.test('bots send files by URL, which Telegram downloads from registered web resources', async () => {
  const { api, sessionPath, botApiPath, createdBot, createdAccount, sendText } =
    await createPrivateConversationFixture();
  await sendText('/start');
  const chatId = createdAccount.account.id;
  const pdfContent = new TextEncoder().encode('%PDF-1.7 quarterly report');
  const registerWebResource = (body: Record<string, unknown>) =>
    api.request(`${sessionPath}/web-resources`, jsonRequest('POST', body));

  const pdfRegistration = await registerWebResource({
    url: 'https://CDN.example.com/docs/report.pdf',
    content_type: 'application/pdf',
    content_base64: pdfContent.toBase64(),
  });
  const pdfResource = await pdfRegistration.json();
  if (
    pdfRegistration.status !== 201 || JSON.stringify(pdfResource) !== JSON.stringify({
        url: 'https://cdn.example.com/docs/report.pdf',
        status: 200,
        content_type: 'application/pdf',
        content_length: pdfContent.length,
      })
  ) {
    throw new Error(
      `Expected the resource to be registered, received ${JSON.stringify(pdfResource)}`,
    );
  }
  for (
    const body of [
      {
        url: 'https://cdn.example.com/chart.gif',
        content_type: 'image/gif',
        content_base64: gifImage(64, 32).toBase64(),
      },
      { url: 'https://cdn.example.com/latest.pdf', status: 302, location: '/docs/report.pdf' },
      {
        url: 'https://cdn.example.com/notes.txt',
        content_type: 'text/plain',
        content_base64: btoa('notes'),
      },
    ]
  ) {
    const response = await registerWebResource(body);
    if (response.status !== 201) {
      throw new Error(`Expected ${body.url} to be registered, received ${response.status}`);
    }
  }
  for (
    const body of [
      { url: 'ftp://cdn.example.com/report.pdf' },
      { url: 'https://cdn.example.com/a.pdf', status: 100 },
      { url: 'https://cdn.example.com/a.pdf', content_base64: 'not base64!' },
      { url: 'https://cdn.example.com/a.pdf', headers: {} },
    ]
  ) {
    const response = await registerWebResource(body);
    if (response.status !== 400) {
      throw new Error(
        `Expected ${JSON.stringify(body)} to be refused, received ${response.status}`,
      );
    }
  }

  const photo = await callBotApi(api, `${botApiPath}/sendPhoto`, {
    chat_id: chatId,
    photo: 'https://cdn.example.com/chart.gif',
  });
  const photoSize = (botApiResult(photo.body)?.photo as Record<string, unknown>[] | undefined)?.[0];
  const document = await callBotApi(api, `${botApiPath}/sendDocument`, {
    chat_id: chatId,
    document: 'https://cdn.example.com/latest.pdf',
  });
  const documentMessage = botApiResult(document.body);
  const sentDocument = documentMessage?.document as Record<string, unknown> | undefined;
  if (
    photo.status !== 200 || photoSize?.width !== 64 || photoSize.height !== 32 ||
    document.status !== 200 || sentDocument?.file_name !== 'latest.pdf' ||
    sentDocument.mime_type !== 'application/pdf' || sentDocument.file_size !== pdfContent.length
  ) {
    throw new Error(
      `Expected files sent by URL, received ${JSON.stringify([photo.body, document.body])}`,
    );
  }
  const fileResponse = await callBotApi(api, `${botApiPath}/getFile`, {
    file_id: sentDocument.file_id,
  });
  const download = await api.request(
    `${sessionPath}/bot-api/file/bot${createdBot.token}/${
      botApiResult(fileResponse.body)?.file_path
    }`,
  );
  if ((await download.bytes()).toBase64() !== pdfContent.toBase64()) {
    throw new Error('Expected the bot to download the bytes Telegram fetched');
  }

  const edited = await callBotApi(api, `${botApiPath}/editMessageMedia`, {
    chat_id: chatId,
    message_id: documentMessage?.message_id,
    media: { type: 'photo', media: 'https://cdn.example.com/chart.gif' },
  });
  const richMessage = await callBotApi(api, `${botApiPath}/sendRichMessage`, {
    chat_id: chatId,
    rich_message: {
      blocks: [{
        type: 'document',
        document: { type: 'document', media: 'https://cdn.example.com/docs/report.pdf' },
      }],
    },
  });
  if (
    edited.status !== 200 || !Array.isArray(botApiResult(edited.body)?.photo) ||
    richMessage.status !== 200
  ) {
    throw new Error(
      `Expected an edit and a rich message by URL, received ${
        JSON.stringify([edited, richMessage])
      }`,
    );
  }

  const failures = [
    await callBotApi(api, `${botApiPath}/sendDocument`, {
      chat_id: chatId,
      document: 'https://cdn.example.com/missing.pdf',
    }),
    await callBotApi(api, `${botApiPath}/sendDocument`, {
      chat_id: chatId,
      document: 'https://cdn.example.com/notes.txt',
    }),
    await callBotApi(api, `${botApiPath}/sendPhoto`, {
      chat_id: chatId,
      photo: 'ftp://cdn.example.com/chart.gif',
    }),
  ].map(({ status, body }) =>
    status === 400 && isBadRequestResponse(body) ? body.description : status
  );
  if (
    JSON.stringify(failures) !== JSON.stringify([
      'Bad Request: failed to get HTTP URL content',
      'Bad Request: wrong type of the web page content',
      'Bad Request: invalid file HTTP URL specified: Unsupported URL protocol',
    ])
  ) {
    throw new Error(`Expected Telegram's errors, received ${JSON.stringify(failures)}`);
  }

  const historyResponse = await api.request(
    `${sessionPath}/accounts/${chatId}/conversations/private/${createdBot.bot.id}/messages`,
  );
  const history = await historyResponse.json() as { messages: unknown[] };
  if (history.messages.length !== 4) {
    throw new Error(
      `Expected failed sends to leave no messages, received ${history.messages.length}`,
    );
  }
});

Deno.test('sendDocument keeps every upload a document, whatever its content type detection', async () => {
  const { api, botApiPath, createdAccount, sendText } = await createPrivateConversationFixture();
  await sendText('/start');
  // A complete 1x1 GIF image, and an MP4 file's leading `ftyp` box naming the ISO base media
  // format, which content type detection would recognize as an animation and a video.
  const gif = Uint8Array.fromBase64('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7');
  const mp4 = new Uint8Array([
    ...[0, 0, 0, 24],
    ...new TextEncoder().encode('ftypisom'),
    ...[0, 0, 2, 0],
    ...new TextEncoder().encode('isommp41'),
  ]);
  const sentKinds = [];
  for (const file of [new File([gif], 'loop.gif'), new File([mp4], 'clip.mp4')]) {
    for (const disablesDetection of [undefined, 'false', 'true']) {
      const { status, body } = await callBotApiWithFiles(api, `${botApiPath}/sendDocument`, {
        chat_id: String(createdAccount.account.id),
        ...(disablesDetection === undefined
          ? {}
          : { disable_content_type_detection: disablesDetection }),
      }, { document: file });
      const message = botApiResult(body);
      const document = message?.document as Record<string, unknown> | undefined;
      sentKinds.push(
        status === 200 && message !== undefined &&
          !['animation', 'video', 'audio'].some((kind) => kind in message)
          ? document?.mime_type
          : JSON.stringify(body),
      );
    }
  }
  if (
    JSON.stringify(sentKinds) !== JSON.stringify([
      'image/gif',
      'image/gif',
      'image/gif',
      'video/mp4',
      'video/mp4',
      'video/mp4',
    ])
  ) {
    throw new Error(`Expected documents only, received ${JSON.stringify(sentKinds)}`);
  }
});

Deno.test('sendDocument keeps an uploaded thumbnail that bots and accounts see and download', async () => {
  const { api, sessionPath, botApiPath, createdBot, createdAccount, sendText } =
    await createPrivateConversationFixture();
  await sendText('/start');
  const chatId = String(createdAccount.account.id);
  const sendDocument = async (parameters: Record<string, string>, files: Record<string, File>) => {
    const { status, body } = await callBotApiWithFiles(
      api,
      `${botApiPath}/sendDocument`,
      { chat_id: chatId, ...parameters },
      { document: new File(['a,b\n'], 'report.csv'), ...files },
    );
    const document = botApiResult(body)?.document as Record<string, unknown> | undefined;
    if (status !== 200 || document === undefined) {
      throw new Error(`Expected a document to be sent, received ${status} ${JSON.stringify(body)}`);
    }
    return { message: botApiResult(body), document };
  };

  const { message, document } = await sendDocument(
    { thumbnail: 'attach://preview' },
    { preview: new File([gifImage(90, 60)], 'preview.gif') },
  );
  const thumbnail = document.thumbnail as Record<string, unknown> | undefined;
  if (
    JSON.stringify(Object.keys(document)) !== JSON.stringify([
        'file_name',
        'mime_type',
        'thumbnail',
        'thumb',
        'file_id',
        'file_unique_id',
        'file_size',
      ]) ||
    JSON.stringify(document.thumb) !== JSON.stringify(thumbnail) ||
    thumbnail?.width !== 90 || thumbnail.height !== 60 ||
    thumbnail.file_size !== gifImage(90, 60).length || thumbnail.file_id === document.file_id
  ) {
    throw new Error(`Expected the document's thumbnail, received ${JSON.stringify(document)}`);
  }

  const thumbnailFile = await callBotApi(api, `${botApiPath}/getFile`, {
    file_id: thumbnail.file_id,
  });
  const thumbnailPath = botApiResult(thumbnailFile.body)?.file_path;
  const download = await api.request(
    `${sessionPath}/bot-api/file/bot${createdBot.token}/${thumbnailPath}`,
  );
  if (
    thumbnailPath !== 'thumbnails/file_0.gif' || download.status !== 200 ||
    JSON.stringify([...new Uint8Array(await download.arrayBuffer())]) !==
      JSON.stringify([...gifImage(90, 60)])
  ) {
    throw new Error(`Expected the thumbnail to be downloadable, received ${thumbnailPath}`);
  }

  const history = await (await api.request(
    `${sessionPath}/accounts/${chatId}/conversations/private/${createdBot.bot.id}/messages`,
  )).json() as { messages: Array<{ message_id: number; document?: Record<string, unknown> }> };
  const accountThumbnail = history.messages.find(({ message_id }) =>
    message_id === message?.message_id
  )?.document?.thumbnail as Record<string, unknown> | undefined;
  if (
    accountThumbnail?.file_unique_id !== thumbnail.file_unique_id
  ) {
    throw new Error(
      `Expected the account to see the thumbnail, received ${JSON.stringify(history)}`,
    );
  }

  const reusedDocument = await callBotApi(api, `${botApiPath}/sendDocument`, {
    chat_id: chatId,
    document: document.file_id,
  });
  const legacyThumbnail = await sendDocument({}, {
    thumb: new File([gifImage(40, 40)], 'thumb.gif'),
  });
  const oversizedThumbnail = new Uint8Array(200 * 1024);
  oversizedThumbnail.set(gifImage(90, 60));
  const withoutThumbnail = await sendDocument({ thumbnail: 'https://example.com/preview.jpg' }, {
    thumbnail: new File([oversizedThumbnail], 'preview.gif'),
  });
  const reusedThumbnail = (botApiResult(reusedDocument.body)?.document as
    | Record<string, unknown>
    | undefined)?.thumbnail;
  if (
    JSON.stringify(reusedThumbnail) !== JSON.stringify(thumbnail) ||
    (legacyThumbnail.document.thumbnail as Record<string, unknown> | undefined)?.width !== 40 ||
    'thumbnail' in withoutThumbnail.document || 'thumb' in withoutThumbnail.document
  ) {
    throw new Error('Expected reuse to keep the thumbnail, thumb to work, and a large one ignored');
  }

  const thumbnailAsPhoto = await callBotApi(api, `${botApiPath}/sendPhoto`, {
    chat_id: chatId,
    photo: thumbnail.file_id,
  });
  if (
    thumbnailAsPhoto.status !== 400 || !isBadRequestResponse(thumbnailAsPhoto.body) ||
    thumbnailAsPhoto.body.description !== "Bad Request: can't use file of type Thumbnail as Photo"
  ) {
    throw new Error(
      `Expected a thumbnail not to be sent as a photo, received ${
        JSON.stringify(thumbnailAsPhoto.body)
      }`,
    );
  }
});

Deno.test('a bot downloads the files it knows with getFile, and tests read any by unique ID', async () => {
  const { api, sessionPath, botApiPath, createdBot, createdAccount } =
    await createPrivateConversationFixture();
  const image = gifImage(32, 16);
  const sentResponse = await api.request(
    `${sessionPath}/accounts/${createdAccount.account.id}/messages`,
    jsonRequest('POST', {
      to: { type: 'private', botId: createdBot.bot.id },
      photo: { content_base64: image.toBase64() },
      caption: 'My receipt',
    }),
  );
  const sentPhoto = (await sentResponse.json()).message?.photo?.[0];
  const updates = await callBotApi(api, `${botApiPath}/getUpdates`, {});
  const receivedPhoto = photoSizeOf(updateMessages(updates.body)[0]);
  if (
    sentResponse.status !== 201 || receivedPhoto === undefined ||
    receivedPhoto.file_id !== sentPhoto?.file_id ||
    receivedPhoto.file_unique_id !== sentPhoto.file_unique_id
  ) {
    throw new Error(
      `Expected the bot to receive the account photo, received ${JSON.stringify(updates.body)}`,
    );
  }

  const fileResponse = await callBotApi(api, `${botApiPath}/getFile`, {
    file_id: receivedPhoto.file_id,
  });
  const file = botApiResult(fileResponse.body);
  if (
    JSON.stringify(file) !== JSON.stringify({
      file_id: receivedPhoto.file_id,
      file_unique_id: receivedPhoto.file_unique_id,
      file_size: image.length,
      file_path: 'photos/file_0.gif',
    })
  ) {
    throw new Error(`Expected the file with its path, received ${JSON.stringify(fileResponse)}`);
  }
  const download = await api.request(
    `${sessionPath}/bot-api/file/bot${createdBot.token}/photos/file_0.gif`,
  );
  const downloadedContent = new Uint8Array(await download.arrayBuffer());
  const sessionDownload = await api.request(
    `${sessionPath}/files/${receivedPhoto.file_unique_id}`,
  );
  const sessionDownloadedContent = new Uint8Array(await sessionDownload.arrayBuffer());
  if (
    download.status !== 200 || download.headers.get('Content-Type') !== 'image/gif' ||
    downloadedContent.toBase64() !== image.toBase64() ||
    sessionDownload.status !== 200 || sessionDownloadedContent.toBase64() !== image.toBase64()
  ) {
    throw new Error('Expected both downloads to return the photo as sent');
  }

  const getFileFailures = await Promise.all(
    [{}, { file_id: 'unknown' }].map(async (parameters) => {
      const { status, body } = await callBotApi(api, `${botApiPath}/getFile`, parameters);
      return status === 400 && isBadRequestResponse(body) ? body.description : status;
    }),
  );
  const missingDownloads = await Promise.all([
    api.request(`${sessionPath}/bot-api/file/bot${createdBot.token}/photos/file_1.gif`),
    api.request(`${sessionPath}/bot-api/file/bot123:unknown/photos/file_0.gif`),
  ]);
  const missingSessionDownload = await api.request(`${sessionPath}/files/unknown`);
  if (
    JSON.stringify(getFileFailures) !==
      JSON.stringify(['Bad Request: file_id not specified', 'Bad Request: invalid file_id']) ||
    !(await Promise.all(
      missingDownloads.map(async (response) =>
        response.status === 404 && isNotFoundResponse(await response.json(), 'Not Found')
      ),
    )).every(Boolean) ||
    missingSessionDownload.status !== 404
  ) {
    throw new Error('Expected unknown files to be refused as Telegram does');
  }
});

Deno.test('editMessageCaption follows Telegram checks', async () => {
  const { api, botApiPath, createdAccount, sendText } = await createPrivateConversationFixture();
  await sendText('/start');
  const chatId = createdAccount.account.id;
  const sentPhoto = await callBotApiWithFiles(api, `${botApiPath}/sendPhoto`, {
    chat_id: String(chatId),
    caption: 'Pick one',
    reply_markup: JSON.stringify({ inline_keyboard: [[{ text: 'Yes', callback_data: 'yes' }]] }),
  }, { photo: new File([gifImage(8, 8)], 'menu.gif') });
  const photoMessageId = botApiResult(sentPhoto.body)?.message_id;
  const sentText = await callBotApi(api, `${botApiPath}/sendMessage`, {
    chat_id: chatId,
    text: 'Plain',
  });
  const textMessageId = botApiResult(sentText.body)?.message_id;
  if (typeof photoMessageId !== 'number' || typeof textMessageId !== 'number') {
    throw new Error('Expected the photo and the text to be sent');
  }

  const edit = await callBotApi(api, `${botApiPath}/editMessageCaption`, {
    chat_id: chatId,
    message_id: photoMessageId,
    caption: '*Picked*',
    parse_mode: 'MarkdownV2',
    show_caption_above_media: true,
  });
  const editedPhoto = botApiResult(edit.body);
  if (
    edit.status !== 200 || editedPhoto?.caption !== 'Picked' ||
    editedPhoto.show_caption_above_media !== true || typeof editedPhoto.edit_date !== 'number' ||
    'reply_markup' in editedPhoto
  ) {
    throw new Error(`Expected the caption to be edited, received ${JSON.stringify(edit.body)}`);
  }

  const failures = [
    ['editMessageText', { chat_id: chatId, message_id: photoMessageId, text: 'New' }],
    ['editMessageCaption', { chat_id: chatId, message_id: textMessageId, caption: 'New' }],
    [
      'editMessageCaption',
      {
        chat_id: chatId,
        message_id: photoMessageId,
        caption: 'Picked',
        caption_entities: [{ type: 'bold', offset: 0, length: 6 }],
        show_caption_above_media: true,
      },
    ],
    ['editMessageCaption', { caption: 'New' }],
    ['editMessageCaption', { chat_id: chatId, message_id: 999, caption: 'New' }],
  ] as const;
  const descriptions = [];
  for (const [method, parameters] of failures) {
    const { status, body } = await callBotApi(api, `${botApiPath}/${method}`, parameters);
    descriptions.push(status === 400 && isBadRequestResponse(body) ? body.description : status);
  }
  if (
    JSON.stringify(descriptions) !== JSON.stringify([
      'Bad Request: there is no text in the message to edit',
      'Bad Request: there is no caption in the message to edit',
      'Bad Request: message is not modified: specified new message content and reply markup are exactly the same as a current content and reply markup of the message',
      'Bad Request: message identifier is not specified',
      'Bad Request: message to edit not found',
    ])
  ) {
    throw new Error(`Expected Telegram's errors, received ${JSON.stringify(descriptions)}`);
  }
});

Deno.test('editMessageMedia replaces the media of a message', async () => {
  const { api, sessionPath, botApiPath, createdBot, createdAccount, sendText } =
    await createPrivateConversationFixture();
  await sendText('/start');
  const chatId = createdAccount.account.id;
  const sentPhoto = await callBotApiWithFiles(api, `${botApiPath}/sendPhoto`, {
    chat_id: String(chatId),
    caption: 'Old photo',
  }, { photo: new File([gifImage(8, 8)], 'old.gif') });
  const photoMessage = botApiResult(sentPhoto.body);
  const photoFileId = photoSizeOf(photoMessage)?.file_id;
  const sentText = botApiResult(
    (await callBotApi(api, `${botApiPath}/sendMessage`, { chat_id: chatId, text: 'Soon' })).body,
  );
  const editMedia = (messageId: unknown, media: unknown, files: Record<string, File> = {}) =>
    callBotApiWithFiles(api, `${botApiPath}/editMessageMedia`, {
      chat_id: String(chatId),
      message_id: String(messageId),
      media: JSON.stringify(media),
      reply_markup: JSON.stringify({
        inline_keyboard: [[{ text: 'Open', callback_data: 'open' }]],
      }),
    }, files);

  const documentEdit = await editMedia(photoMessage?.message_id, {
    type: 'document',
    media: 'attach://report',
    caption: '<b>Report</b>',
    parse_mode: 'HTML',
  }, { report: new File(['numbers'], 'report.txt', { type: 'text/plain' }) });
  const editedDocument = botApiResult(documentEdit.body);
  const photoEdit = await editMedia(sentText?.message_id, {
    type: 'photo',
    media: photoFileId,
    has_spoiler: true,
    show_caption_above_media: true,
    caption: 'Now a photo',
  });
  const editedText = botApiResult(photoEdit.body);
  const unchangedEdit = await editMedia(sentText?.message_id, {
    type: 'photo',
    media: photoFileId,
    has_spoiler: true,
    show_caption_above_media: true,
    caption: 'Now a photo',
  });
  const keyboard = { inline_keyboard: [[{ text: 'Open', callback_data: 'open' }]] };
  if (
    documentEdit.status !== 200 || 'photo' in (editedDocument ?? {}) ||
    (editedDocument?.document as { file_name?: string } | undefined)?.file_name !==
      'report.txt' ||
    editedDocument?.caption !== 'Report' ||
    JSON.stringify(editedDocument.caption_entities) !==
      JSON.stringify([{ type: 'bold', offset: 0, length: 6 }]) ||
    JSON.stringify(editedDocument.reply_markup) !== JSON.stringify(keyboard) ||
    typeof editedDocument.edit_date !== 'number' ||
    photoEdit.status !== 200 || 'text' in (editedText ?? {}) ||
    photoSizeOf(editedText)?.file_id !== photoFileId || editedText?.has_media_spoiler !== true ||
    editedText.show_caption_above_media !== true || editedText.caption !== 'Now a photo' ||
    !isBadRequestResponse(unchangedEdit.body) ||
    !unchangedEdit.body.description.startsWith('Bad Request: message is not modified')
  ) {
    throw new Error(
      `Expected the media to be replaced, received ${
        JSON.stringify([documentEdit, photoEdit, unchangedEdit])
      }`,
    );
  }
  const updatesBody: unknown = await (await api.request(`${botApiPath}/getUpdates`)).json();
  if (
    !isGetUpdatesResponse(updatesBody) ||
    updatesBody.result.some((update) => 'edited_message' in update)
  ) {
    throw new Error('Expected the bot to receive no update for editing its own message');
  }

  const refusals: Array<[unknown, string]> = [
    [undefined, 'Bad Request: parameter "media" is required'],
    ['{', "Bad Request: can't parse input media JSON object"],
    [[], "Bad Request: can't parse InputMedia: expected an Object"],
    [{ media: photoFileId }, `Bad Request: can't parse InputMedia: Can't find field "type"`],
    [
      { type: 'sticker', media: photoFileId },
      `Bad Request: can't parse InputMedia: type "sticker" is unsupported`,
    ],
    [
      { type: 'video', media: photoFileId },
      "Bad Request: can't use file of type Photo as Video",
    ],
    [
      { type: 'photo', media: 'attach://missing' },
      "Bad Request: can't parse InputMedia: media not found",
    ],
    [
      { type: 'photo', media: 'https://grammy.dev/cat.gif' },
      'Bad Request: failed to get HTTP URL content',
    ],
    [
      { type: 'photo', media: photoFileId, caption: '<b>Bold', parse_mode: 'HTML' },
      "Bad Request: can't parse InputMedia: Can't parse entities: Can't find end tag corresponding to start tag \"b\"",
    ],
    [
      { type: 'document', media: photoFileId },
      "Bad Request: can't use file of type Photo as Document",
    ],
    [
      { type: 'document', media: photoFileId, has_spoiler: true },
      'Bad Request: invalid editMessageMedia parameters',
    ],
  ];
  const descriptions = [];
  for (const [media] of refusals) {
    const { body } = await callBotApiWithFiles(api, `${botApiPath}/editMessageMedia`, {
      chat_id: String(chatId),
      message_id: String(photoMessage?.message_id),
      ...(media === undefined
        ? {}
        : { media: typeof media === 'string' ? media : JSON.stringify(media) }),
    }, {});
    descriptions.push(isBadRequestResponse(body) ? body.description : JSON.stringify(body));
  }
  if (
    JSON.stringify(descriptions) !== JSON.stringify(refusals.map(([, description]) => description))
  ) {
    throw new Error(`Expected Telegram's errors, received ${JSON.stringify(descriptions)}`);
  }

  const inlineBot = await createBot(api, sessionPath, 'cats_bot', {
    supports_inline_queries: true,
    receives_chosen_inline_results: true,
  });
  const accountPath = `${sessionPath}/accounts/${chatId}`;
  const chat = { type: 'private', botId: createdBot.bot.id };
  await api.request(
    `${accountPath}/messages`,
    jsonRequest('POST', { to: { type: 'private', botId: inlineBot.bot.id }, text: '/start' }),
  );
  const queryResponse = await api.request(
    `${accountPath}/inline-queries`,
    jsonRequest('POST', { bot_id: inlineBot.bot.id, chat, query: 'cats' }),
  );
  const { inline_query: inlineQuery } = await queryResponse.json() as {
    inline_query: { id: string };
  };
  await callBotApi(api, `${inlineBot.botApiPath}/answerInlineQuery`, {
    inline_query_id: inlineQuery.id,
    results: [{
      type: 'article',
      id: 'cats',
      title: 'Cats',
      input_message_content: { message_text: 'Cats' },
      reply_markup: { inline_keyboard: [[{ text: 'More', callback_data: 'more' }]] },
    }],
  });
  const chosen = await api.request(
    `${accountPath}/inline-queries/${inlineQuery.id}/chosen-results`,
    jsonRequest('POST', { result_id: 'cats' }),
  );
  const { message: inlineMessage } = await chosen.json() as { message: { message_id: number } };
  const inlineMessageId = await (async () => {
    const updates = await (await api.request(`${inlineBot.botApiPath}/getUpdates`)).json() as {
      result: Array<{ chosen_inline_result?: { inline_message_id?: string } }>;
    };
    return updates.result.find((update) => update.chosen_inline_result !== undefined)
      ?.chosen_inline_result?.inline_message_id;
  })();
  const inlinePhoto = botApiResult(
    (await callBotApiWithFiles(api, `${inlineBot.botApiPath}/sendPhoto`, {
      chat_id: String(chatId),
    }, { photo: new File([gifImage(4, 4)], 'cat.gif') })).body,
  );
  const editInline = (media: unknown, files: Record<string, File> = {}) =>
    callBotApiWithFiles(api, `${inlineBot.botApiPath}/editMessageMedia`, {
      inline_message_id: String(inlineMessageId),
      media: JSON.stringify(media),
    }, files);
  const inlineUpload = await editInline(
    { type: 'photo', media: 'attach://cat' },
    { cat: new File([gifImage(4, 4)], 'cat.gif') },
  );
  const inlineEdit = await editInline({ type: 'photo', media: photoSizeOf(inlinePhoto)?.file_id });
  // A file sent by URL is not an upload, so it may replace an inline message's media.
  await api.request(
    `${sessionPath}/web-resources`,
    jsonRequest('POST', {
      url: 'https://cdn.example.com/cat.gif',
      content_type: 'image/gif',
      content_base64: gifImage(7, 5).toBase64(),
    }),
  );
  const inlineUrlEdit = await editInline({
    type: 'photo',
    media: 'https://cdn.example.com/cat.gif',
  });
  const history = await (await api.request(
    `${accountPath}/conversations/private/${createdBot.bot.id}/messages`,
  )).json() as { messages: Array<Record<string, unknown>> };
  const editedInlineMessage = history.messages.find(({ message_id }) =>
    message_id === inlineMessage.message_id
  );
  if (
    !isBadRequestResponse(inlineUpload.body) ||
    inlineUpload.body.description !== 'Bad Request: invalid message content specified' ||
    JSON.stringify(inlineEdit.body) !== JSON.stringify({ ok: true, result: true }) ||
    JSON.stringify(inlineUrlEdit.body) !== JSON.stringify({ ok: true, result: true }) ||
    (editedInlineMessage?.photo as { width: number }[] | undefined)?.[0]?.width !== 7
  ) {
    throw new Error(
      `Expected an inline message's media to be replaced by file_id or URL, received ${
        JSON.stringify([inlineUpload, inlineEdit, inlineUrlEdit, editedInlineMessage])
      }`,
    );
  }
});

Deno.test('editMessageMedia replaces the media of a supergroup message', async () => {
  const { api, owner, bot, supergroup, supergroupPath } = await createSupergroupFixture();
  const sent = await callBotApiWithFiles(api, `${bot.botApiPath}/sendDocument`, {
    chat_id: String(supergroup.id),
  }, { document: new File(['draft'], 'draft.txt') });
  const edit = await callBotApiWithFiles(api, `${bot.botApiPath}/editMessageMedia`, {
    chat_id: String(supergroup.id),
    message_id: String(botApiResult(sent.body)?.message_id),
    media: JSON.stringify({ type: 'photo', media: 'attach://chart', caption: 'Chart' }),
  }, { chart: new File([gifImage(6, 3)], 'chart.gif') });
  const history = await (await api.request(`${supergroupPath(owner.id)}/messages`)).json() as {
    messages: Array<Record<string, unknown>>;
  };
  const editedMessage = history.messages.at(-1);
  if (
    edit.status !== 200 || editedMessage?.caption !== 'Chart' || 'document' in editedMessage ||
    (photoSizeOf(editedMessage) as { width?: number } | undefined)?.width !== 6
  ) {
    throw new Error(
      `Expected members to see the new photo, received ${JSON.stringify([edit, editedMessage])}`,
    );
  }
});

Deno.test('account message routes send and edit photos and documents', async () => {
  const { api, sessionPath, botApiPath, createdBot, createdAccount } =
    await createPrivateConversationFixture();
  const accountPath = `${sessionPath}/accounts/${createdAccount.account.id}`;
  const to = { type: 'private', botId: createdBot.bot.id };
  const sendAccountMessage = async (body: unknown) => {
    const response = await api.request(`${accountPath}/messages`, jsonRequest('POST', body));
    return {
      status: response.status,
      body: response.status === 201 ? await response.json() : null,
    };
  };

  const sentDocument = await sendAccountMessage({
    to,
    document: { content_base64: new TextEncoder().encode('notes').toBase64(), file_name: 'a.txt' },
  });
  const rejectedStatuses = await Promise.all([
    { to, photo: { content_base64: 'not base64!' } },
    { to, photo: { content_base64: new TextEncoder().encode('text').toBase64() } },
    { to, photo: { content_base64: '' } },
    { to, text: 'Hello', photo: { content_base64: gifImage(1, 1).toBase64() } },
    { to, document: { content_base64: 'AA==', file_name: '' } },
  ].map(async (body) => (await sendAccountMessage(body)).status));
  const documentMessage = sentDocument.body?.message;
  if (
    sentDocument.status !== 201 || documentMessage?.document?.mime_type !== 'text/plain' ||
    'caption' in documentMessage ||
    JSON.stringify(rejectedStatuses) !== JSON.stringify([400, 400, 400, 400, 400])
  ) {
    throw new Error(
      `Expected a document and rejected invalid media, received ${
        JSON.stringify({ sentDocument, rejectedStatuses })
      }`,
    );
  }

  const messagePath =
    `${accountPath}/conversations/private/${createdBot.bot.id}/messages/${documentMessage.message_id}`;
  const textEdit = await api.request(messagePath, jsonRequest('PATCH', { text: 'Notes' }));
  const captionEdit = await api.request(messagePath, jsonRequest('PATCH', { caption: '/help' }));
  const editedDocument = (await captionEdit.json()).message;
  const updates = await callBotApi(api, `${botApiPath}/getUpdates`, {});
  const lastUpdateMessage = updateMessages(updates.body).at(-1);
  if (
    textEdit.status !== 400 || captionEdit.status !== 200 || editedDocument.caption !== '/help' ||
    lastUpdateMessage?.caption !== '/help' ||
    JSON.stringify(lastUpdateMessage.document) !== JSON.stringify(documentMessage.document)
  ) {
    throw new Error(`Expected a caption edit, received ${JSON.stringify(updates.body)}`);
  }
});

Deno.test('a grammY bot downloads a document from an account and replies with a photo', async () => {
  const { api, sessionPath, createdBot, createdAccount } = await createPrivateConversationFixture();
  const csv = 'item,price\ncoffee,3\n';
  const sentResponse = await api.request(
    `${sessionPath}/accounts/${createdAccount.account.id}/messages`,
    jsonRequest('POST', {
      to: { type: 'private', botId: createdBot.bot.id },
      document: { content_base64: new TextEncoder().encode(csv).toBase64(), file_name: 'a.csv' },
      caption: 'Please chart this',
    }),
  );
  if (sentResponse.status !== 201) {
    throw new Error(`Expected the document to be sent, received ${sentResponse.status}`);
  }

  const apiRoot = `${TEST_PUBLIC_ORIGIN}${sessionPath}/bot-api`;
  const fetch = api.fetch;
  const grammyBot = new Bot(createdBot.token, { client: { apiRoot, fetch } });
  const downloadedTexts: string[] = [];
  const replied = Promise.withResolvers<void>();
  grammyBot.on('message:document', async (context) => {
    const file = await context.getFile();
    const download = await fetch(`${apiRoot}/file/bot${createdBot.token}/${file.file_path}`);
    downloadedTexts.push(await download.text());
    await context.replyWithPhoto(new InputFile(gifImage(300, 200), 'chart.gif'), {
      caption: `Chart of ${context.msg.document.file_name}`,
      reply_parameters: { message_id: context.msg.message_id },
    });
    replied.resolve();
  });
  const polling = grammyBot.start();
  await Promise.race([replied.promise, polling]);
  await grammyBot.stop();
  await polling;

  const historyBody = await (await api.request(
    `${sessionPath}/accounts/${createdAccount.account.id}/conversations/private/${createdBot.bot.id}/messages`,
  )).json();
  const reply = historyBody.messages.at(-1);
  if (
    JSON.stringify(downloadedTexts) !== JSON.stringify([csv]) ||
    reply?.caption !== 'Chart of a.csv' || reply.photo?.[0]?.width !== 300 ||
    reply.reply_to_message?.document?.file_name !== 'a.csv'
  ) {
    throw new Error(`Expected the bot to reply with a chart, received ${JSON.stringify(reply)}`);
  }
});
