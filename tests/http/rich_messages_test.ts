import { assertEquals } from '@std/assert';
import { Bot } from 'https://cdn.jsdelivr.net/gh/grammyjs/grammY@^1.46.0/src/bot.ts';
import { InputFile } from 'https://cdn.jsdelivr.net/gh/grammyjs/grammY@^1.46.0/src/types.ts';

import { jsonRequest, TEST_PUBLIC_ORIGIN } from '../support/emulation_api.ts';
import { assertEqualsInFieldOrder } from '../support/field_order_assertion.ts';
import { isBadRequestResponse } from '../support/http_response_guards.ts';
import {
  botApiResult,
  callBotApi,
  callBotApiWithFiles,
  createUpdateReader,
} from '../support/bot_api_requests.ts';
import {
  createBot,
  createPrivateConversationFixture,
  createSupergroupFixture,
} from '../support/http_fixtures.ts';
import { gifImage } from '../support/media_samples.ts';

Deno.test('sendRichMessage sends blocks that accounts see and press as the bot sent them', async () => {
  await using fixture = await createPrivateConversationFixture();
  const { api, sessionPath, botApiPath, createdBot, createdAccount, sendText } = fixture;
  await sendText('/start');
  const accountId = createdAccount.account.id;
  const richMessage = {
    blocks: [
      { type: 'heading', text: 'Release plan', size: 2 },
      {
        type: 'paragraph',
        text: ['Ship ', { type: 'bold', text: 'today' }, ', see #plans and example.com'],
      },
      { type: 'anchor', name: 'steps' },
      {
        type: 'list',
        items: [
          {
            blocks: [{ type: 'paragraph', text: 'Build' }],
            has_checkbox: true,
            is_checked: true,
            type: 'i',
            value: 4,
          },
          { blocks: [], type: 'I', value: 27 },
        ],
      },
      {
        type: 'table',
        cells: [
          [{ text: 'Step', is_header: true }, { text: 'Owner', is_header: true, align: 'right' }],
          [{ text: 'Build', colspan: 2, valign: 'top' }, {}],
        ],
        caption: 'Owners',
        is_bordered: true,
      },
      { type: 'pre', text: 'deno task test\u0001', language: 'sh' },
      {
        type: 'photo',
        photo: { type: 'photo', media: 'attach://cover', has_spoiler: true },
        caption: { text: 'Cover', credit: '' },
      },
      {
        type: 'paragraph',
        text: [
          { type: 'reference_link', text: 'note', reference_name: 'n 1' },
          ' and ',
          { type: 'anchor_link', text: 'steps', anchor_name: 'steps' },
          ' and ',
          { type: 'anchor_link', text: 'top', anchor_name: '' },
          ' and ',
          { type: 'anchor_link', text: 'nowhere', anchor_name: 'missing' },
        ],
      },
      { type: 'footer', text: [{ type: 'reference', name: 'n 1', text: 'By @ada_writer' }] },
      {
        type: 'buttons',
        buttons: [
          { text: 'Done', style: 'link', callback_data: 'done' },
          { text: 'Docs', url: 'grammy.dev' },
        ],
        align: 'center',
      },
    ],
    is_rtl: true,
  };

  const sent = await callBotApiWithFiles(api, `${botApiPath}/sendRichMessage`, {
    chat_id: String(accountId),
    rich_message: JSON.stringify(richMessage),
  }, { cover: new File([gifImage(16, 9)], 'cover.gif') });
  const message = botApiResult(sent.body);
  const sentBlocks = (message?.rich_message as { blocks?: Array<Record<string, unknown>> })
    ?.blocks;
  const coverSize = (sentBlocks?.[6]?.photo as Array<Record<string, unknown>> | undefined)?.[0];
  const expectedRichMessage = {
    blocks: [
      { type: 'heading', text: 'Release plan', size: 2 },
      {
        type: 'paragraph',
        text: [
          'Ship ',
          { type: 'bold', text: 'today' },
          ', see ',
          { type: 'hashtag', text: '#plans', hashtag: 'plans' },
          ' and ',
          { type: 'url', text: 'example.com', url: 'example.com' },
        ],
      },
      { type: 'anchor', name: 'steps' },
      {
        type: 'list',
        items: [
          {
            label: 'iv.',
            blocks: [{ type: 'paragraph', text: 'Build' }],
            has_checkbox: true,
            is_checked: true,
            type: 'i',
            value: 4,
          },
          {
            label: 'XXVII.',
            blocks: [{ type: 'paragraph', text: '' }],
            type: 'I',
            value: 27,
          },
        ],
      },
      {
        type: 'table',
        cells: [
          [
            { text: 'Step', is_header: true, align: 'center', valign: 'middle' },
            { text: 'Owner', is_header: true, align: 'right', valign: 'middle' },
          ],
          [
            { text: 'Build', colspan: 2, align: 'left', valign: 'top' },
            { align: 'left', valign: 'middle' },
          ],
        ],
        caption: 'Owners',
        is_bordered: true,
      },
      { type: 'pre', text: 'deno task test ', language: 'sh' },
      {
        type: 'photo',
        photo: [{
          file_id: coverSize?.file_id,
          file_unique_id: coverSize?.file_unique_id,
          file_size: 13,
          width: 16,
          height: 9,
        }],
        caption: { text: 'Cover' },
        has_spoiler: true,
      },
      {
        type: 'paragraph',
        text: [
          { type: 'reference_link', text: 'note', reference_name: 'n 1' },
          ' and ',
          { type: 'anchor_link', text: 'steps', anchor_name: 'steps' },
          ' and ',
          { type: 'anchor_link', text: 'top', anchor_name: '' },
          ' and ',
          { type: 'url', text: 'nowhere', url: '#missing' },
        ],
      },
      {
        type: 'footer',
        text: [{
          type: 'reference',
          text: ['By ', { type: 'mention', text: '@ada_writer', username: 'ada_writer' }],
          name: 'n 1',
        }],
      },
      {
        type: 'buttons',
        buttons: [
          { text: 'Done', style: 'link', callback_data: 'done' },
          { text: 'Docs', url: 'http://grammy.dev/' },
        ],
        align: 'center',
      },
    ],
    is_rtl: true,
  };
  if (
    sent.status !== 200 ||
    typeof coverSize?.file_id !== 'string' ||
    message !== undefined && 'text' in message
  ) {
    throw new Error(`Expected the sent rich message, received ${JSON.stringify(sent.body)}`);
  }
  assertEqualsInFieldOrder(
    message?.rich_message,
    expectedRichMessage,
    'Expected the sent rich message',
  );

  const historyResponse = await api.request(
    `${sessionPath}/accounts/${accountId}/conversations/private/${createdBot.bot.id}/messages`,
  );
  const history = await historyResponse.json() as { messages: unknown[] };
  assertEqualsInFieldOrder(
    history.messages.at(-1),
    message,
    'Expected the account to see the rich message',
  );

  const readUpdates = createUpdateReader(api);
  await readUpdates(botApiPath);
  const pressResponse = await api.request(
    `${sessionPath}/accounts/${accountId}/callback-queries`,
    jsonRequest('POST', {
      chat: { type: 'private', botId: createdBot.bot.id },
      message_id: message?.message_id,
      callback_data: 'done',
    }),
  );
  const [pressUpdate] = await readUpdates(botApiPath);
  const pressedMessage = (pressUpdate?.callback_query as Record<string, unknown> | undefined)
    ?.message as Record<string, unknown> | undefined;
  if (
    pressResponse.status !== 201 ||
    (pressUpdate?.callback_query as Record<string, unknown> | undefined)?.data !== 'done'
  ) {
    throw new Error(
      `Expected the press of a rich message button, received ${pressResponse.status}`,
    );
  }
  assertEqualsInFieldOrder(
    pressedMessage?.rich_message,
    expectedRichMessage,
    'Expected the press of a rich message button',
  );

  // Forwards and copies keep URL buttons, while other buttons keep their look but do nothing.
  const repeatedButtons = {
    type: 'buttons',
    buttons: [
      { text: 'Done', style: 'link', disabled: {} },
      { text: 'Docs', url: 'http://grammy.dev/' },
    ],
    align: 'center',
  };
  const forward = await callBotApi(api, `${botApiPath}/forwardMessage`, {
    chat_id: accountId,
    from_chat_id: accountId,
    message_id: message?.message_id,
  });
  const forwardedBlocks = (botApiResult(forward.body)?.rich_message as {
    blocks?: unknown[];
  } | undefined)?.blocks;
  const copy = await callBotApi(api, `${botApiPath}/copyMessage`, {
    chat_id: accountId,
    from_chat_id: accountId,
    message_id: message?.message_id,
    caption: 'Ignored',
  });
  const copyHistory = await (await api.request(
    `${sessionPath}/accounts/${accountId}/conversations/private/${createdBot.bot.id}/messages`,
  )).json() as { messages: Array<Record<string, unknown>> };
  const copiedMessage = copyHistory.messages.at(-1);
  const copiedBlocks = (copiedMessage?.rich_message as { blocks?: unknown[] } | undefined)?.blocks;
  if (
    copiedMessage?.message_id !== botApiResult(copy.body)?.message_id ||
    copiedMessage !== undefined && 'caption' in copiedMessage
  ) {
    throw new Error(
      `Expected forwards and copies to disable callback buttons, received ${
        JSON.stringify([forward.body, copiedMessage])
      }`,
    );
  }
  assertEqualsInFieldOrder(
    forwardedBlocks?.at(-1),
    repeatedButtons,
    'Expected forwards and copies to disable callback buttons',
  );
  assertEqualsInFieldOrder(
    copiedBlocks?.at(-1),
    repeatedButtons,
    'Expected forwards and copies to disable callback buttons',
  );
  const pressOfCopy = await api.request(
    `${sessionPath}/accounts/${accountId}/callback-queries`,
    jsonRequest('POST', {
      chat: { type: 'private', botId: createdBot.bot.id },
      message_id: copiedMessage?.message_id,
      callback_data: 'done',
    }),
  );
  if (pressOfCopy.status !== 400) {
    throw new Error(`Expected a copy to have no callback button, received ${pressOfCopy.status}`);
  }
});

Deno.test('editMessageText turns text into a rich message and back', async () => {
  await using fixture = await createPrivateConversationFixture();
  const { api, botApiPath, createdAccount, sendText } = fixture;
  await sendText('/start');
  const chatId = createdAccount.account.id;
  const sent = await callBotApi(api, `${botApiPath}/sendMessage`, {
    chat_id: chatId,
    text: 'Draft',
  });
  const messageId = botApiResult(sent.body)?.message_id;
  const richMessage = {
    blocks: [{ type: 'paragraph', text: 'Final for @ada_writer' }],
    skip_entity_detection: true,
  };

  // A rich message replaces the text, which is ignored.
  const toRich = await callBotApi(api, `${botApiPath}/editMessageText`, {
    chat_id: chatId,
    message_id: messageId,
    text: 'Ignored',
    rich_message: richMessage,
  });
  const richResult = botApiResult(toRich.body);
  if (
    richResult !== undefined && 'text' in richResult ||
    typeof richResult?.edit_date !== 'number'
  ) {
    throw new Error(`Expected the text to become rich, received ${JSON.stringify(toRich.body)}`);
  }
  assertEqualsInFieldOrder(richResult?.rich_message, {
    blocks: [{ type: 'paragraph', text: 'Final for @ada_writer' }],
  }, 'Expected the text to become rich');

  const unchanged = await callBotApi(api, `${botApiPath}/editMessageText`, {
    chat_id: chatId,
    message_id: messageId,
    rich_message: richMessage,
  });
  const captionEdit = await callBotApi(api, `${botApiPath}/editMessageCaption`, {
    chat_id: chatId,
    message_id: messageId,
    caption: 'Caption',
  });
  const emptyRichMessage = await callBotApi(api, `${botApiPath}/editMessageText`, {
    chat_id: chatId,
    message_id: messageId,
    text: 'Plain',
    rich_message: '',
  });
  const failures = [unchanged, captionEdit, emptyRichMessage].map(({ body }) =>
    isBadRequestResponse(body) ? body.description : JSON.stringify(body)
  );
  assertEquals(failures, [
    'Bad Request: message is not modified: specified new message content and reply markup are exactly the same as a current content and reply markup of the message',
    'Bad Request: there is no caption in the message to edit',
    'Bad Request: rich message must be non-empty',
  ], "Expected Telegram's refusals of the edits");

  const withPhoto = await callBotApiWithFiles(api, `${botApiPath}/editMessageText`, {
    chat_id: String(chatId),
    message_id: String(messageId),
    rich_message: JSON.stringify({
      blocks: [{ type: 'photo', photo: { type: 'photo', media: 'attach://chart' } }],
    }),
  }, { chart: new File([gifImage(4, 3)], 'chart.gif') });
  const photoBlock = (botApiResult(withPhoto.body)?.rich_message as {
    blocks?: Array<{ type?: string; photo?: Array<Record<string, unknown>> }>;
  } | undefined)?.blocks?.[0];
  if (photoBlock?.type !== 'photo' || photoBlock.photo?.[0]?.width !== 4) {
    throw new Error(
      `Expected an edit to upload a photo, received ${JSON.stringify(withPhoto.body)}`,
    );
  }

  const toText = await callBotApi(api, `${botApiPath}/editMessageText`, {
    chat_id: chatId,
    message_id: messageId,
    text: 'Plain again',
  });
  const textResult = botApiResult(toText.body);
  if (
    textResult?.text !== 'Plain again' || textResult !== undefined && 'rich_message' in textResult
  ) {
    throw new Error(
      `Expected the rich message to become text, received ${JSON.stringify(toText.body)}`,
    );
  }
});

Deno.test('bots send and edit rich messages without blocks', async () => {
  await using fixture = await createPrivateConversationFixture();
  const { api, sessionPath, botApiPath, createdBot, createdAccount, sendText } = fixture;
  await sendText('/start');
  const chatId = createdAccount.account.id;
  const readAccountMessage = async (messageId: unknown) => {
    const response = await api.request(
      `${sessionPath}/accounts/${chatId}/conversations/private/${createdBot.bot.id}/messages`,
    );
    const { messages } = await response.json() as { messages: Array<Record<string, unknown>> };
    return messages.find((message) => message.message_id === messageId);
  };

  const sent = await callBotApi(api, `${botApiPath}/sendRichMessage`, {
    chat_id: chatId,
    rich_message: { blocks: [] },
  });
  const sentMessage = botApiResult(sent.body);
  if (sent.status !== 200 || sentMessage === undefined || 'text' in sentMessage) {
    throw new Error(
      `Expected a rich message without blocks, received ${JSON.stringify(sent.body)}`,
    );
  }
  assertEqualsInFieldOrder(
    sentMessage.rich_message,
    { blocks: [] },
    'Expected the sent message without blocks',
  );
  assertEqualsInFieldOrder(
    await readAccountMessage(sentMessage.message_id),
    sentMessage,
    'Expected the account to see the message without blocks',
  );

  const draft = await callBotApi(api, `${botApiPath}/sendMessage`, {
    chat_id: chatId,
    text: 'Draft',
  });
  const edited = await callBotApi(api, `${botApiPath}/editMessageText`, {
    chat_id: chatId,
    message_id: botApiResult(draft.body)?.message_id,
    rich_message: { blocks: [] },
  });
  const editedMessage = botApiResult(edited.body);
  if (edited.status !== 200 || editedMessage === undefined || 'text' in editedMessage) {
    throw new Error(
      `Expected the text to become a message without blocks, received ${
        JSON.stringify(edited.body)
      }`,
    );
  }
  assertEqualsInFieldOrder(
    editedMessage.rich_message,
    { blocks: [] },
    'Expected the edited message without blocks',
  );
  assertEqualsInFieldOrder(
    await readAccountMessage(editedMessage.message_id),
    editedMessage,
    'Expected the account to see the edited message without blocks',
  );
});

Deno.test('sendRichMessage refuses rich messages as Telegram does', async () => {
  await using fixture = await createPrivateConversationFixture();
  const { api, botApiPath, createdAccount, sendText } = fixture;
  const chatId = createdAccount.account.id;
  const paragraph = (text: unknown) => ({ blocks: [{ type: 'paragraph', text }] });
  const buttonRow = (buttons: unknown[]) => ({ blocks: [{ type: 'buttons', buttons }] });
  const photoBlock = (photo: unknown) => ({ blocks: [{ type: 'photo', photo }] });
  const cases: Array<readonly [unknown, string]> = [
    [undefined, 'Bad Request: rich message must be non-empty'],
    ['not JSON', "Bad Request: can't parse rich message JSON object"],
    [[], 'Bad Request: object expected as rich message'],
    [
      { html: '<b>Hi</b>' },
      'Bad Request: rich messages written in HTML or Markdown are not supported',
    ],
    [{}, 'Bad Request: rich message must be non-empty'],
    [{ blocks: null }, 'Bad Request: invalid sendRichMessage parameters'],
    [
      { blocks: [{ type: 'map', location: { latitude: 52, longitude: 13 }, caption: 1 }] },
      "Bad Request: can't parse InputRichBlock: RichBlockCaption must be an object",
    ],
    [
      { blocks: [{ type: 'table', cells: [[1]] }] },
      "Bad Request: can't parse InputRichBlock: Can't parse PageBlockTableCell: " +
      'RichBlockTableCell must be an object',
    ],
    [
      { blocks: [{ type: 'table', cells: [[{ text: 'A', valign: 'sideways' }]] }] },
      "Bad Request: can't parse InputRichBlock: Can't parse PageBlockTableCell: " +
      'Invalid vertical alignment specified',
    ],
    [
      { blocks: [{ type: 'table', cells: [[{ text: 'A', rowspan: -1 }]] }] },
      'Bad Request: invalid table cell rowspan specified',
    ],
    [
      { blocks: [{ type: 'marquee' }] },
      `Bad Request: can't parse InputRichBlock: type "marquee" is unsupported`,
    ],
    [
      { blocks: [{ type: 'audio', audio: { type: 'audio', media: 'attach://song' } }] },
      'Bad Request: rich message blocks with an animation or an audio file are not supported',
    ],
    [
      { blocks: [{ type: 'thinking', text: 'Thinking' }] },
      'Bad Request: thinking blocks can be used only in rich message drafts',
    ],
    [
      { blocks: [{ type: 'paragraph', text: 'Hi', size: 1 }] },
      'Bad Request: invalid sendRichMessage parameters',
    ],
    [
      { blocks: [{ type: 'heading', text: 'Hi', size: 7 }] },
      'Bad Request: invalid section heading size specified',
    ],
    [
      paragraph({ type: 'blink', text: 'Hi' }),
      "Bad Request: can't parse InputRichBlock: Unsupported rich text type",
    ],
    [paragraph(5), "Bad Request: can't parse InputRichBlock: Invalid rich text specified"],
    [paragraph('\uD800'), 'Bad Request: rich text must be encoded in UTF-8'],
    [
      paragraph({ type: 'date_time', text: 'Soon', unix_time: 0 }),
      'Bad Request: invalid date specified',
    ],
    [
      paragraph({ type: 'date_time', text: 'Soon', unix_time: 1, date_time_format: 'x' }),
      "Bad Request: can't parse InputRichBlock: Invalid date-time format specified",
    ],
    [
      paragraph({ type: 'custom_emoji', custom_emoji_id: 'smile', alternative_text: '🙂' }),
      'Bad Request: invalid custom emoji identifier specified',
    ],
    [
      paragraph({ type: 'text_mention', text: 'Nobody', user: { id: 999 } }),
      'Bad Request: user not found',
    ],
    [{ blocks: [{ type: 'list', items: [] }] }, 'Bad Request: list must be non-empty'],
    [
      {
        blocks: [{
          type: 'list',
          items: [{ blocks: [], type: '1', value: 1 }, { blocks: [] }],
        }],
      },
      'Bad Request: list must be either ordered or unordered',
    ],
    [
      { blocks: [{ type: 'list', items: [{ blocks: [], type: 'x' }] }] },
      'Bad Request: invalid list item type specified',
    ],
    [
      { blocks: [{ type: 'table', cells: [[{ text: 'A', align: 'justify' }]] }] },
      "Bad Request: can't parse InputRichBlock: Can't parse PageBlockTableCell: " +
      'Invalid horizontal alignment specified',
    ],
    [
      { blocks: [{ type: 'table', cells: [[{ text: 'A', colspan: -1 }]] }] },
      'Bad Request: invalid table cell colspan specified',
    ],
    [
      { blocks: [{ type: 'map', location: { latitude: 100, longitude: 0 } }] },
      'Bad Request: invalid location specified',
    ],
    [
      { blocks: [{ type: 'map', location: { latitude: 52, longitude: 13 }, zoom: 25 }] },
      'Bad Request: invalid map properties specified',
    ],
    [buttonRow([]), 'Bad Request: button row must be non-empty'],
    [
      buttonRow([1]),
      "Bad Request: can't parse InputRichBlock: Can't parse RichMessageButton: " +
      'InlineButton must be an Object',
    ],
    [
      buttonRow(
        Array.from({ length: 9 }, (_, index) => ({ text: 'Go', callback_data: `${index}` })),
      ),
      'Bad Request: a button row can have at most 8 buttons',
    ],
    [
      buttonRow([{ text: 'Go', style: 'glow', callback_data: 'go' }]),
      "Bad Request: can't parse InputRichBlock: Can't parse RichMessageButton: " +
      'Invalid button style specified',
    ],
    [
      buttonRow([{ text: 'Go', style: 'link', url: 'https://grammy.dev' }]),
      'Bad Request: only callback buttons can have the link style',
    ],
    [
      buttonRow([{ text: { type: 'bold', text: 'Go' }, callback_data: 'go' }]),
      'Bad Request: button text can have only custom emoji and dates',
    ],
    [
      buttonRow([{ text: 'Go', url: 'grammy' }]),
      "Bad Request: inline keyboard button URL 'grammy' is invalid: Wrong HTTP URL",
    ],
    [
      buttonRow([{ text: 'Go', callback_data: 'x'.repeat(65) }]),
      'Bad Request: BUTTON_DATA_INVALID',
    ],
    [
      photoBlock({ type: 'photo', media: 'attach://missing' }),
      "Bad Request: can't parse InputRichBlock: media not found",
    ],
    [
      photoBlock({ type: 'photo', media: 'https://grammy.dev/logo.png' }),
      'Bad Request: failed to get HTTP URL content',
    ],
    [
      photoBlock({ type: 'document', media: 'attach://missing' }),
      `Bad Request: can't parse InputRichBlock: Unexpected media type "document" for block "photo"`,
    ],
    [
      photoBlock({ type: 'photo', media: 'unknown-file-id' }),
      'Bad Request: wrong file identifier/HTTP URL specified',
    ],
  ];

  // The blocks are read before the chat, which the account has not started yet.
  const unstartedChat = await callBotApi(api, `${botApiPath}/sendRichMessage`, {
    chat_id: chatId,
    rich_message: paragraph('Hello'),
  });
  if (
    !isBadRequestResponse(unstartedChat.body) ||
    unstartedChat.body.description !== 'Bad Request: chat not found'
  ) {
    throw new Error(`Expected an unstarted chat, received ${JSON.stringify(unstartedChat.body)}`);
  }
  await sendText('/start');
  for (const [richMessage, description] of cases) {
    const { body } = await callBotApi(api, `${botApiPath}/sendRichMessage`, {
      chat_id: chatId,
      ...(richMessage === undefined ? {} : { rich_message: richMessage }),
    });
    if (!isBadRequestResponse(body) || body.description !== description) {
      throw new Error(
        `Expected ${JSON.stringify(richMessage)} to fail with "${description}", received ${
          JSON.stringify(body)
        }`,
      );
    }
  }
});

Deno.test('sendRichMessage prefixes the faults the server finds while it reads the blocks', async () => {
  await using fixture = await createPrivateConversationFixture();
  const { api, botApiPath, createdAccount, sendText } = fixture;
  await sendText('/start');
  const blocks = (...richBlocks: unknown[]) => ({ blocks: richBlocks });
  const listOf = (...items: unknown[]) => ({ type: 'list', items });
  const buttonRow = (buttons: unknown[], align?: string) => ({
    type: 'buttons',
    buttons,
    ...(align === undefined ? {} : { align }),
  });
  const paragraph = (text: unknown) => ({ type: 'paragraph', text });
  // The server's outermost `Can't parse` is lowercased when the description is sent; the nested
  // ones and the problem itself keep their case.
  const cases: Array<readonly [unknown, string]> = [
    [
      blocks(1),
      "Bad Request: can't parse InputRichBlock: Object expected as InputRichMessageBlock",
    ],
    [
      blocks(listOf(1)),
      "Bad Request: can't parse InputRichBlock: Can't parse InputRichBlockListItem: " +
      'Object expected as InputRichBlockListItem',
    ],
    [
      blocks(listOf({ blocks: [1] })),
      "Bad Request: can't parse InputRichBlock: Can't parse InputRichBlockListItem: " +
      "Can't parse InputRichBlock: Object expected as InputRichMessageBlock",
    ],
    // Blocks that hold blocks read them as the message does.
    [
      blocks(paragraph('Fine'), { type: 'blockquote', blocks: [1] }),
      "Bad Request: can't parse InputRichBlock: Can't parse InputRichBlock: " +
      'Object expected as InputRichMessageBlock',
    ],
    [
      blocks({ type: 'details', summary: 'More', blocks: [paragraph(5)] }),
      "Bad Request: can't parse InputRichBlock: Can't parse InputRichBlock: " +
      'Invalid rich text specified',
    ],
    [
      blocks({ type: 'collage', blocks: [{ type: 'marquee' }] }),
      "Bad Request: can't parse InputRichBlock: Can't parse InputRichBlock: " +
      'type "marquee" is unsupported',
    ],
    [
      blocks({
        type: 'slideshow',
        blocks: [{ type: 'photo', photo: { type: 'photo', media: 'attach://missing' } }],
      }),
      "Bad Request: can't parse InputRichBlock: Can't parse InputRichBlock: media not found",
    ],
    // Table cells and buttons are read as arrays too, but the rows of a table, rich text and its
    // buttons, and a block's caption are not.
    [
      blocks({ type: 'table', cells: [[{ text: 'A' }], [{ text: { type: 'blink' } }]] }),
      "Bad Request: can't parse InputRichBlock: Can't parse PageBlockTableCell: " +
      'Unsupported rich text type',
    ],
    [
      blocks(buttonRow([{ text: [{ type: 'blink' }], callback_data: 'go' }])),
      "Bad Request: can't parse InputRichBlock: Can't parse RichMessageButton: " +
      'Unsupported rich text type',
    ],
    [
      blocks(buttonRow([{ text: 'Go', callback_data: 'go' }], 'justify')),
      "Bad Request: can't parse InputRichBlock: Invalid horizontal alignment specified",
    ],
    [
      blocks(paragraph(['Press ', { type: 'button', button: 1 }])),
      "Bad Request: can't parse InputRichBlock: InlineButton must be an Object",
    ],
    [
      blocks({
        type: 'map',
        location: { latitude: 52, longitude: 13 },
        caption: { text: { type: 'blink' } },
      }),
      "Bad Request: can't parse InputRichBlock: Unsupported rich text type",
    ],
    [
      blocks({
        type: 'blockquote',
        blocks: [listOf({ blocks: [buttonRow([{ text: 'Go', style: 'glow', url: 'a.io' }])] })],
      }),
      "Bad Request: can't parse InputRichBlock: Can't parse InputRichBlock: " +
      "Can't parse InputRichBlockListItem: Can't parse InputRichBlock: " +
      "Can't parse RichMessageButton: Invalid button style specified",
    ],
    // TDLib checks the blocks once the server has read them, without a prefix, however deeply
    // they are nested.
    [
      blocks({ type: 'heading', text: 'Hi', size: 7 }),
      'Bad Request: invalid section heading size specified',
    ],
    [
      blocks({ type: 'blockquote', blocks: [{ type: 'heading', text: 'Hi', size: 0 }] }),
      'Bad Request: invalid section heading size specified',
    ],
    [blocks(listOf()), 'Bad Request: list must be non-empty'],
    [blocks(listOf({ blocks: [listOf()] })), 'Bad Request: list must be non-empty'],
    [
      blocks({ type: 'table', cells: [[{ text: 'A', colspan: -1 }]] }),
      'Bad Request: invalid table cell colspan specified',
    ],
    // Neither the emulator's own refusals nor its strict reading of the input gain a prefix.
    [
      blocks({ type: 'details', summary: 'More', blocks: [{ type: 'thinking', text: 'Hm' }] }),
      'Bad Request: thinking blocks can be used only in rich message drafts',
    ],
    [
      blocks(listOf({ blocks: [paragraph('Hi'), { type: 'divider', text: 'Hi' }] })),
      'Bad Request: invalid sendRichMessage parameters',
    ],
    // Faults outside the blocks have no prefix either.
    [undefined, 'Bad Request: rich message must be non-empty'],
    [{}, 'Bad Request: rich message must be non-empty'],
  ];
  for (const [richMessage, description] of cases) {
    const { body } = await callBotApi(api, `${botApiPath}/sendRichMessage`, {
      chat_id: createdAccount.account.id,
      ...(richMessage === undefined ? {} : { rich_message: richMessage }),
    });
    assertEquals(
      isBadRequestResponse(body) ? body.description : body,
      description,
      `Expected ${JSON.stringify(richMessage)} to fail as Telegram fails it`,
    );
  }
});

Deno.test('bots send and edit rich messages in supergroups and inline messages', async () => {
  await using fixture = await createSupergroupFixture();
  const { api, sessionPath, owner, bot, supergroup, supergroupPath } = fixture;
  const sent = await callBotApi(api, `${bot.botApiPath}/sendRichMessage`, {
    chat_id: supergroup.id,
    rich_message: { blocks: [{ type: 'paragraph', text: 'Hi @ada_writer' }] },
  });
  const history = await (await api.request(`${supergroupPath(owner.id)}/messages`)).json() as {
    messages: Array<Record<string, unknown>>;
  };
  const expectedRichMessage = {
    blocks: [{
      type: 'paragraph',
      text: ['Hi ', { type: 'mention', text: '@ada_writer', username: 'ada_writer' }],
    }],
  };
  assertEqualsInFieldOrder(
    botApiResult(sent.body)?.rich_message,
    expectedRichMessage,
    "Expected the supergroup's rich message",
  );
  assertEqualsInFieldOrder(
    history.messages.at(-1)?.rich_message,
    expectedRichMessage,
    "Expected the supergroup's rich message",
  );

  const inlineBot = await createBot(api, sessionPath, 'cats_bot', {
    supports_inline_queries: true,
    receives_chosen_inline_results: true,
  });
  const readUpdates = createUpdateReader(api);
  const accountPath = `${sessionPath}/accounts/${owner.id}`;
  const queryResponse = await api.request(
    `${accountPath}/inline-queries`,
    jsonRequest('POST', {
      bot_id: inlineBot.bot.id,
      chat: { type: 'private', botId: inlineBot.bot.id },
      query: 'cats',
    }),
  );
  const { inline_query: inlineQuery } = await queryResponse.json() as {
    inline_query: { id: string };
  };
  await callBotApi(api, `${inlineBot.botApiPath}/answerInlineQuery`, {
    inline_query_id: inlineQuery.id,
    results: [{
      type: 'article',
      id: 'fact',
      title: 'Cat fact',
      input_message_content: { message_text: 'Cats sleep a lot' },
      reply_markup: { inline_keyboard: [[{ text: 'More', callback_data: 'more' }]] },
    }],
  });
  await api.request(
    `${accountPath}/inline-queries/${inlineQuery.id}/chosen-results`,
    jsonRequest('POST', { result_id: 'fact' }),
  );
  const chosenResult = (await readUpdates(inlineBot.botApiPath))
    .find((update) => update.chosen_inline_result !== undefined)
    ?.chosen_inline_result as Record<string, unknown> | undefined;
  const inlineMessageId = chosenResult?.inline_message_id;

  const richEdit = await callBotApi(api, `${inlineBot.botApiPath}/editMessageText`, {
    inline_message_id: inlineMessageId,
    rich_message: { blocks: [{ type: 'heading', text: 'Cats', size: 1 }] },
  });
  const uploadEdit = await callBotApiWithFiles(api, `${inlineBot.botApiPath}/editMessageText`, {
    inline_message_id: String(inlineMessageId),
    rich_message: JSON.stringify({
      blocks: [{ type: 'photo', photo: { type: 'photo', media: 'attach://cat' } }],
    }),
  }, { cat: new File([gifImage(2, 2)], 'cat.gif') });
  const inlineHistory = await (await api.request(
    `${accountPath}/conversations/private/${inlineBot.bot.id}/messages`,
  )).json() as { messages: Array<Record<string, unknown>> };
  if (
    !isBadRequestResponse(uploadEdit.body) ||
    uploadEdit.body.description !== 'Bad Request: invalid message content specified'
  ) {
    throw new Error(
      `Expected an inline message to become rich without uploads, received ${
        JSON.stringify([richEdit.body, uploadEdit.body])
      }`,
    );
  }
  assertEqualsInFieldOrder(
    richEdit.body,
    { ok: true, result: true },
    'Expected an inline message to become rich without uploads',
  );
  assertEqualsInFieldOrder(inlineHistory.messages.at(-1)?.rich_message, {
    blocks: [{ type: 'heading', text: 'Cats', size: 1 }],
  }, 'Expected an inline message to become rich without uploads');
});

Deno.test('a grammY bot sends a rich message with an uploaded photo', async () => {
  await using fixture = await createPrivateConversationFixture();
  const { api, sessionPath, createdBot, createdAccount, sendText } = fixture;
  await sendText('/start');
  const grammyBot = new Bot(createdBot.token, {
    client: {
      apiRoot: `${TEST_PUBLIC_ORIGIN}${sessionPath}/bot-api`,
      fetch: api.fetch,
    },
  });

  const message = await grammyBot.api.sendRichMessage(createdAccount.account.id, {
    blocks: [
      { type: 'paragraph', text: ['Our ', { type: 'italic', text: 'new' }, ' logo'] },
      {
        type: 'photo',
        photo: { type: 'photo', media: new InputFile(gifImage(32, 32), 'logo.gif') },
      },
    ],
  });
  const [paragraph, photo] = message.rich_message?.blocks ?? [];
  if (
    photo?.type !== 'photo' ||
    photo.photo[0]?.width !== 32
  ) {
    throw new Error(`Expected grammY's rich message, received ${JSON.stringify(message)}`);
  }
  assertEqualsInFieldOrder(paragraph, {
    type: 'paragraph',
    text: ['Our ', { type: 'italic', text: 'new' }, ' logo'],
  }, "Expected grammY's rich message");
});
