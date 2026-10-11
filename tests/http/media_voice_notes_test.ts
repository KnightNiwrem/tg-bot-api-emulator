import { Bot } from 'https://cdn.jsdelivr.net/gh/grammyjs/grammY@^1.46.0/src/bot.ts';

import { jsonRequest, TEST_PUBLIC_ORIGIN } from '../support/emulation_api.ts';
import { isBadRequestResponse } from '../support/http_response_guards.ts';
import { botApiResult, callBotApi, callBotApiWithFiles } from '../support/bot_api_requests.ts';
import {
  createPrivateConversationFixture,
  createSupergroupFixture,
} from '../support/http_fixtures.ts';
import { gifImage } from '../support/media_samples.ts';

Deno.test('a grammY bot answers an account voice note with one it downloads and sends back', async () => {
  await using fixture = await createPrivateConversationFixture();
  const { api, sessionPath, createdBot, createdAccount } = fixture;
  const accountPath = `${sessionPath}/accounts/${createdAccount.account.id}`;
  const historyPath = `${accountPath}/conversations/private/${createdBot.bot.id}/messages`;
  const recording = new TextEncoder().encode('opus bytes the emulator never decodes');
  const sent = await api.request(
    `${accountPath}/messages`,
    jsonRequest('POST', {
      to: { type: 'private', botId: createdBot.bot.id },
      voice: { content_base64: recording.toBase64(), duration: 7 },
      caption: 'Listen /start',
    }),
  );
  const sentMessage = (await sent.json()).message as Record<string, unknown> | undefined;

  const apiRoot = `${TEST_PUBLIC_ORIGIN}${sessionPath}/bot-api`;
  const fetch = api.fetch;
  const grammyBot = new Bot(createdBot.token, { client: { apiRoot, fetch } });
  const received: Array<{ voice: Record<string, unknown>; filePath?: string; bytes: string }> = [];
  const replied = Promise.withResolvers<void>();
  grammyBot.on('message:voice', async (context) => {
    const file = await context.getFile();
    const download = await fetch(`${apiRoot}/file/bot${createdBot.token}/${file.file_path}`);
    received.push({
      voice: { ...context.msg.voice },
      filePath: file.file_path,
      bytes: new Uint8Array(await download.arrayBuffer()).toBase64(),
    });
    // A voice note sent again by file_id keeps its own duration, whatever the request says.
    await context.replyWithVoice(context.msg.voice.file_id, {
      duration: 1,
      caption: 'Heard you',
      reply_parameters: { message_id: context.msg.message_id },
    });
    replied.resolve();
  });
  const polling = grammyBot.start();
  await Promise.race([replied.promise, polling]);
  await grammyBot.stop();
  await polling;

  const history = await (await api.request(historyPath)).json() as {
    messages: Array<Record<string, unknown>>;
  };
  const [question, answer] = history.messages;
  const receivedVoice = received[0]?.voice;
  const activity = await (await api.request(
    `${sessionPath}/bot-activity?kind=bot_api_call&bot_id=${createdBot.bot.id}`,
  )).json() as { entries: Array<{ method: string; answer: { ok: boolean } }> };
  if (
    sent.status !== 201 ||
    JSON.stringify(Object.keys(receivedVoice ?? {})) !==
      JSON.stringify(['duration', 'mime_type', 'file_id', 'file_unique_id', 'file_size']) ||
    receivedVoice?.duration !== 7 || receivedVoice.mime_type !== 'audio/ogg' ||
    receivedVoice.file_size !== recording.length ||
    JSON.stringify(sentMessage?.voice) !== JSON.stringify(receivedVoice) ||
    received[0].filePath !== 'voice/file_0.oga' || received[0].bytes !== recording.toBase64() ||
    JSON.stringify(question?.caption_entities) !==
      JSON.stringify([{ type: 'bot_command', offset: 7, length: 6 }]) ||
    JSON.stringify(answer?.voice) !== JSON.stringify(receivedVoice) ||
    answer.caption !== 'Heard you' ||
    (answer.reply_to_message as Record<string, unknown>).message_id !== question.message_id ||
    !activity.entries.some(({ method, answer }) => method === 'sendVoice' && answer.ok)
  ) {
    throw new Error(
      `Expected the bot to hear and answer the voice note, received ${
        JSON.stringify({ received, history })
      }`,
    );
  }
});

Deno.test('sendVoice follows Telegram checks and sends long voice notes by URL as files', async () => {
  await using fixture = await createPrivateConversationFixture();
  const { api, sessionPath, botApiPath, createdBot, createdAccount, sendText } = fixture;
  await sendText('/start');
  const chatId = String(createdAccount.account.id);
  const sendVoice = async (parameters: Record<string, string>, files: Record<string, File>) => {
    const { status, body } = await callBotApiWithFiles(
      api,
      `${botApiPath}/sendVoice`,
      { chat_id: chatId, ...parameters },
      files,
    );
    const message = botApiResult(body);
    if (status !== 200 || message === undefined) {
      throw new Error(
        `Expected a voice note to be sent, received ${status} ${JSON.stringify(body)}`,
      );
    }
    return message;
  };

  // The Bot API server clamps the duration, and TDLib types an upload by its name's extension.
  const mp3 = await sendVoice({ duration: '100000', caption: '<b>Memo</b>', parse_mode: 'HTML' }, {
    voice: new File(['mp3'], 'memo.mp3'),
  });
  const wav = await sendVoice({}, { voice: new File(['wav'], 'memo.wav') });
  const megabyte = 1024 * 1024;
  const registerVoice = (url: string, contentType: string, sizeBytes: number) =>
    api.request(
      `${sessionPath}/web-resources`,
      jsonRequest('POST', {
        url,
        content_type: contentType,
        content_base64: new Uint8Array(sizeBytes).toBase64(),
      }),
    );
  await registerVoice('https://cdn.example.com/short.ogg', 'audio/ogg', megabyte);
  await registerVoice('https://cdn.example.com/long.ogg', 'audio/ogg', megabyte + 1);
  await registerVoice('https://cdn.example.com/memo.mp3', 'audio/mpeg', 10);
  const shortByUrl = await sendVoice(
    { voice: 'https://cdn.example.com/short.ogg', duration: '4' },
    {},
  );
  const longByUrl = await sendVoice({
    voice: 'https://cdn.example.com/long.ogg',
    caption: 'Long memo',
  }, {});
  const mp3Voice = mp3.voice as Record<string, unknown> | undefined;
  const shortVoice = shortByUrl.voice as Record<string, unknown> | undefined;
  const longDocument = longByUrl.document as Record<string, unknown> | undefined;
  if (
    mp3Voice?.duration !== 86_400 || mp3Voice.mime_type !== 'audio/mpeg' ||
    mp3.caption !== 'Memo' ||
    (wav.voice as Record<string, unknown> | undefined)?.mime_type !== 'audio/ogg' ||
    shortVoice?.duration !== 4 || shortVoice.file_size !== megabyte ||
    'voice' in longByUrl || longDocument?.file_name !== 'long.ogg' ||
    longDocument.mime_type !== 'audio/ogg' || longDocument.file_size !== megabyte + 1 ||
    longByUrl.caption !== 'Long memo'
  ) {
    throw new Error(
      `Expected voice notes and a long one as a file, received ${
        JSON.stringify([mp3, wav, shortByUrl, longByUrl])
      }`,
    );
  }

  const historyPath =
    `${sessionPath}/accounts/${chatId}/conversations/private/${createdBot.bot.id}/messages`;
  const historyBefore = await (await api.request(historyPath)).text();
  const failures: {
    method: string;
    parameters: Record<string, string>;
    files: Record<string, File>;
  }[] = [
    { method: 'sendVoice', parameters: {}, files: {} },
    { method: 'sendVoice', parameters: {}, files: { voice: new File([], 'empty.ogg') } },
    { method: 'sendVoice', parameters: { voice: String(longDocument.file_id) }, files: {} },
    { method: 'sendDocument', parameters: { document: String(mp3Voice.file_id) }, files: {} },
    { method: 'sendVideo', parameters: { video: String(mp3Voice.file_id) }, files: {} },
    { method: 'sendVoice', parameters: { voice: 'AwACAgIAAxkBAAIBdGZ' }, files: {} },
    { method: 'sendVoice', parameters: { voice: 'https://cdn.example.com/memo.mp3' }, files: {} },
    {
      method: 'sendVoice',
      parameters: { voice: String(mp3Voice.file_id), caption: 'x'.repeat(1_025) },
      files: {},
    },
    {
      method: 'sendVoice',
      parameters: { voice: String(mp3Voice.file_id), has_spoiler: 'true' },
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
  const expectedDescriptions = [
    'Bad Request: there is no voice in the request',
    'Bad Request: file must be non-empty',
    "Bad Request: can't use file of type Document as VoiceNote",
    "Bad Request: can't use file of type VoiceNote as Document",
    "Bad Request: can't use file of type VoiceNote as Video",
    'Bad Request: wrong file identifier/HTTP URL specified',
    'Bad Request: wrong type of the web page content',
    'Bad Request: message caption is too long',
    'Bad Request: invalid sendVoice parameters: has_spoiler',
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

Deno.test('voice notes stay out of albums and media replacement', async () => {
  await using fixture = await createPrivateConversationFixture();
  const { api, sessionPath, botApiPath, createdBot, createdAccount, sendText } = fixture;
  await sendText('/start');
  const chatId = String(createdAccount.account.id);
  const voiceMessage = botApiResult(
    (await callBotApiWithFiles(api, `${botApiPath}/sendVoice`, {
      chat_id: chatId,
      caption: 'Memo',
    }, { voice: new File(['ogg'], 'memo.ogg') })).body,
  );
  const voiceFileId = (voiceMessage?.voice as Record<string, unknown> | undefined)?.file_id;
  const historyPath =
    `${sessionPath}/accounts/${chatId}/conversations/private/${createdBot.bot.id}/messages`;
  const historyBefore = await (await api.request(historyPath)).text();
  const describe = ({ status, body }: { status: number; body: unknown }) =>
    status === 400 && isBadRequestResponse(body) ? body.description : status;

  const refusals = [
    await callBotApi(api, `${botApiPath}/sendMediaGroup`, {
      chat_id: chatId,
      media: [{ type: 'voice_note', media: voiceFileId }, {
        type: 'voice_note',
        media: voiceFileId,
      }],
    }),
    await callBotApi(api, `${botApiPath}/editMessageMedia`, {
      chat_id: chatId,
      message_id: voiceMessage?.message_id,
      media: { type: 'voice_note', media: voiceFileId },
    }),
    // TDLib's `can_edit_message_media` refuses to replace a voice note's media with any media.
    await callBotApiWithFiles(api, `${botApiPath}/editMessageMedia`, {
      chat_id: chatId,
      message_id: String(voiceMessage?.message_id),
      media: JSON.stringify({ type: 'photo', media: 'attach://chart' }),
    }, { chart: new File([gifImage(4, 3)], 'chart.gif') }),
    await callBotApi(api, `${botApiPath}/editMessageText`, {
      chat_id: chatId,
      message_id: voiceMessage?.message_id,
      text: 'Not text',
    }),
  ].map(describe);
  const accountAlbum = await api.request(
    `${sessionPath}/accounts/${chatId}/media-groups`,
    jsonRequest('POST', {
      to: { type: 'private', botId: createdBot.bot.id },
      media: [
        { voice: { content_base64: new TextEncoder().encode('a').toBase64() } },
        { voice: { content_base64: new TextEncoder().encode('b').toBase64() } },
      ],
    }),
  );
  const historyAfterRefusals = await (await api.request(historyPath)).text();
  const captionEdit = await callBotApi(api, `${botApiPath}/editMessageCaption`, {
    chat_id: chatId,
    message_id: voiceMessage?.message_id,
    caption: 'Edited memo',
  });
  const expectedRefusals = [
    'Bad Request: can\'t parse InputMedia: type "voice_note" is not allowed',
    'Bad Request: can\'t parse InputMedia: type "voice_note" is not allowed',
    "Bad Request: message media can't be edited",
    'Bad Request: there is no text in the message to edit',
  ];
  const editedMessage = botApiResult(captionEdit.body);
  if (
    JSON.stringify(refusals) !== JSON.stringify(expectedRefusals) ||
    accountAlbum.status !== 400 || historyAfterRefusals !== historyBefore ||
    captionEdit.status !== 200 || editedMessage?.caption !== 'Edited memo' ||
    JSON.stringify(editedMessage.voice) !== JSON.stringify(voiceMessage?.voice)
  ) {
    throw new Error(
      `Expected voice notes refused where Telegram refuses them, received ${
        JSON.stringify({ refusals, accountAlbum: accountAlbum.status, captionEdit })
      }`,
    );
  }
});

Deno.test('supergroup bots receive voice notes as other messages, and bots repeat them', async () => {
  await using fixture = await createSupergroupFixture();
  const { api, sessionPath, owner, member, bot, readerBot, supergroup } = fixture;
  const lastUpdateId = async (botApiPath: string) => {
    const { body } = await callBotApi(api, `${botApiPath}/getUpdates`, {});
    return (body as { result: Array<{ update_id: number }> }).result.at(-1)?.update_id ?? 0;
  };
  const botOffset = await lastUpdateId(bot.botApiPath);
  const readerOffset = await lastUpdateId(readerBot.botApiPath);
  const sendVoice = async (accountId: number, caption: string) => {
    const response = await api.request(
      `${sessionPath}/accounts/${accountId}/messages`,
      jsonRequest('POST', {
        to: { type: 'supergroup', chatId: supergroup.id },
        voice: { content_base64: new TextEncoder().encode(caption).toBase64(), duration: 2 },
        caption,
      }),
    );
    if (response.status !== 201) {
      throw new Error(`Expected the voice note to be sent, received ${response.status}`);
    }
    return (await response.json()).message as Record<string, unknown>;
  };
  const command = await sendVoice(owner.id, '/start');
  await sendVoice(member.id, 'Just talking');
  const receivedVoices = async (botApiPath: string, offset: number) => {
    const { body } = await callBotApi(api, `${botApiPath}/getUpdates`, { offset: offset + 1 });
    return (body as { result: Array<{ message?: Record<string, unknown> }> }).result.map(
      ({ message }) => ({
        caption: message?.caption,
        voice: message?.voice as Record<string, unknown> | undefined,
      }),
    );
  };
  const botVoices = await receivedVoices(bot.botApiPath, botOffset);
  const readerVoices = await receivedVoices(readerBot.botApiPath, readerOffset);
  const commandVoice = command.voice as Record<string, unknown>;

  // The bot forwards the command to the member's private chat and copies it with a new caption,
  // and replies there to the supergroup's voice note.
  await api.request(
    `${sessionPath}/accounts/${member.id}/messages`,
    jsonRequest('POST', { to: { type: 'private', botId: bot.bot.id }, text: 'Hi' }),
  );
  const forwarded = botApiResult(
    (await callBotApi(api, `${bot.botApiPath}/forwardMessage`, {
      chat_id: member.id,
      from_chat_id: supergroup.id,
      message_id: command.message_id,
    })).body,
  );
  const copied = await callBotApi(api, `${bot.botApiPath}/copyMessage`, {
    chat_id: member.id,
    from_chat_id: supergroup.id,
    message_id: command.message_id,
    caption: 'Copied memo',
  });
  const reply = botApiResult(
    (await callBotApi(api, `${bot.botApiPath}/sendMessage`, {
      chat_id: member.id,
      text: 'About that',
      reply_parameters: { chat_id: supergroup.id, message_id: command.message_id },
    })).body,
  );
  const privateHistory = await (await api.request(
    `${sessionPath}/accounts/${member.id}/conversations/private/${bot.bot.id}/messages`,
  )).json() as { messages: Array<Record<string, unknown>> };
  const copy = privateHistory.messages.find((message) =>
    message.message_id === botApiResult(copied.body)?.message_id
  );
  const externalReply = reply?.external_reply as Record<string, unknown> | undefined;
  if (
    JSON.stringify(botVoices.map(({ caption }) => caption)) !== JSON.stringify(['/start']) ||
    JSON.stringify(readerVoices.map(({ caption }) => caption)) !==
      JSON.stringify(['/start', 'Just talking']) ||
    botVoices[0].voice?.file_unique_id !== commandVoice.file_unique_id ||
    botVoices[0].voice?.file_id === readerVoices[0].voice?.file_id ||
    (forwarded?.voice as Record<string, unknown> | undefined)?.file_unique_id !==
      commandVoice.file_unique_id ||
    forwarded?.caption !== '/start' ||
    (copy?.voice as Record<string, unknown> | undefined)?.duration !== 2 ||
    copy?.caption !== 'Copied memo' ||
    (externalReply?.voice as Record<string, unknown> | undefined)?.file_unique_id !==
      commandVoice.file_unique_id ||
    'caption' in (externalReply ?? {})
  ) {
    throw new Error(
      `Expected voice notes delivered and repeated as other media, received ${
        JSON.stringify({ botVoices, readerVoices, forwarded, copy, reply })
      }`,
    );
  }
});
