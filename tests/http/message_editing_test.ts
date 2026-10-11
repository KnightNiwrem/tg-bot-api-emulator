/**
 * Message editing as each chat type and each sender observes it: which of several competing
 * failures an edit reports, how inline messages are reached, what a join request's contact grant
 * does not allow, and how an edit addresses a message by the chat's own numbering. Every table runs
 * the same edits in a private chat and in a supergroup, so the expectations of the two chat types
 * can be compared row by row.
 */
import { assertEquals } from '@std/assert';

import { createUpdateReader } from '../support/bot_api_requests.ts';
import { type EmulationApi, jsonRequest, requestJson } from '../support/emulation_api.ts';
import { createAccount, createBot } from '../support/http_fixtures.ts';
import {
  type CallOutcome,
  CHAT_TYPES,
  createChatScenario,
  type CreatedBot,
  createJoinRequesterChatScenario,
  describeCall,
  expectStatus,
  sendBotMessage,
} from '../support/chat_type_scenarios.ts';

const NOT_MODIFIED =
  'Bad Request: message is not modified: specified new message content and reply markup are exactly the same as a current content and reply markup of the message';

/** A keyboard whose callback data exceeds Telegram's 64-byte limit. */
const OVERSIZED_CALLBACK_KEYBOARD = {
  inline_keyboard: [[{ text: 'Long', callback_data: 'x'.repeat(65) }]],
};

const INLINE_RESULT_KEYBOARD = { inline_keyboard: [[{ text: 'More', callback_data: 'more' }]] };

/** A keyboard with a Web App button, which Telegram allows only in private chats. */
const WEB_APP_KEYBOARD = {
  inline_keyboard: [[{ text: 'Open', web_app: { url: 'https://example.com/app' } }]],
};

/** The outcome of a successful edit, which answers with the edited message: its ID and text. */
async function describeEdit(
  api: EmulationApi,
  bot: CreatedBot,
  method: string,
  parameters: Record<string, unknown>,
): Promise<CallOutcome> {
  const [status, result] = await describeCall(api, bot, method, parameters);
  if (status !== 200 || typeof result !== 'object' || result === null) {
    return [status, result];
  }
  const { message_id: messageId, text } = result as { message_id?: number; text?: string };
  return [status, { message_id: messageId, text }];
}

for (const chatType of CHAT_TYPES) {
  Deno.test(`a bot's edit in a ${chatType} chat reports the first of competing failures`, async () => {
    await using scenario = await createChatScenario(chatType);
    const { api, sessionPath, bot, chatId, accountMessageId, botMessageId } = scenario;
    /** An ID of a chat the bot cannot reach: an unknown user, or an unknown supergroup. */
    const unreachableChatId = chatType === 'private' ? 999_999 : -1_009_999_999_999;
    const pollMessageId = await sendBotMessage(api, bot, {
      chat_id: chatId,
      question: 'Lunch?',
      options: [{ text: 'Yes' }, { text: 'No' }],
    }, 'sendPoll');
    await describeCall(api, bot, 'stopPoll', { chat_id: chatId, message_id: pollMessageId });
    const outsider = await createBot(api, sessionPath, 'outsider_bot');

    const outcomes = [
      // Empty text is refused before the chat or the message is looked at.
      await describeCall(api, bot, 'editMessageText', {
        chat_id: unreachableChatId,
        message_id: 999,
        text: '',
      }),
      await describeCall(api, bot, 'editMessageText', {
        chat_id: chatId,
        message_id: 999,
        text: '',
      }),
      // The chat is checked before the message.
      await describeCall(api, bot, 'editMessageText', {
        chat_id: unreachableChatId,
        message_id: 999,
        text: 'Changed',
      }),
      await describeCall(api, outsider, 'editMessageReplyMarkup', {
        chat_id: chatId,
        message_id: botMessageId,
      }),
      // The message is found before the keyboard is checked.
      await describeCall(api, bot, 'editMessageReplyMarkup', {
        chat_id: chatId,
        message_id: 999,
        reply_markup: OVERSIZED_CALLBACK_KEYBOARD,
      }),
      // Whether the bot may edit the message is decided before its content.
      await describeCall(api, bot, 'editMessageText', {
        chat_id: chatId,
        message_id: accountMessageId,
        text: 'Hello',
      }),
      await describeCall(api, bot, 'editMessageCaption', {
        chat_id: chatId,
        message_id: accountMessageId,
        caption: 'Caption',
      }),
      // The content is replaced before the keyboard is checked.
      await describeCall(api, bot, 'editMessageCaption', {
        chat_id: chatId,
        message_id: botMessageId,
        caption: 'Caption',
        reply_markup: OVERSIZED_CALLBACK_KEYBOARD,
      }),
      await describeCall(api, bot, 'editMessageText', {
        chat_id: chatId,
        message_id: pollMessageId,
        text: 'Changed',
        reply_markup: OVERSIZED_CALLBACK_KEYBOARD,
      }),
      // A supergroup refuses a Web App button before it checks callback data.
      await describeCall(api, bot, 'editMessageReplyMarkup', {
        chat_id: chatId,
        message_id: botMessageId,
        reply_markup: {
          inline_keyboard: [
            ...WEB_APP_KEYBOARD.inline_keyboard,
            ...OVERSIZED_CALLBACK_KEYBOARD.inline_keyboard,
          ],
        },
      }),
      // The keyboard's callback data is checked before whether anything changes.
      await describeCall(api, bot, 'editMessageText', {
        chat_id: chatId,
        message_id: botMessageId,
        text: 'Menu',
        reply_markup: OVERSIZED_CALLBACK_KEYBOARD,
      }),
      await describeCall(api, bot, 'editMessageText', {
        chat_id: chatId,
        message_id: botMessageId,
        text: 'Menu',
        reply_markup: { inline_keyboard: [[{ text: 'Go', callback_data: 'go' }]] },
      }),
      // Stopping a poll finds its message as an edit does, then the poll.
      await describeCall(api, bot, 'stopPoll', {
        chat_id: unreachableChatId,
        message_id: pollMessageId,
      }),
      await describeCall(api, bot, 'stopPoll', { chat_id: chatId, message_id: botMessageId }),
      await describeCall(api, bot, 'stopPoll', {
        chat_id: chatId,
        message_id: pollMessageId,
        reply_markup: OVERSIZED_CALLBACK_KEYBOARD,
      }),
    ];

    const privateOrSupergroup = (privateOutcome: CallOutcome, supergroupOutcome: CallOutcome) =>
      chatType === 'private' ? privateOutcome : supergroupOutcome;
    assertEquals(outcomes, [
      [400, 'Bad Request: message text is empty'],
      [400, 'Bad Request: message text is empty'],
      [400, 'Bad Request: chat not found'],
      [400, 'Bad Request: chat not found'],
      [400, 'Bad Request: message to edit not found'],
      [400, "Bad Request: message can't be edited"],
      [400, "Bad Request: message can't be edited"],
      [400, 'Bad Request: there is no caption in the message to edit'],
      [400, 'Bad Request: there is no text in the message to edit'],
      privateOrSupergroup(
        [400, 'Bad Request: BUTTON_DATA_INVALID'],
        [400, 'Bad Request: BUTTON_TYPE_INVALID'],
      ),
      [400, 'Bad Request: BUTTON_DATA_INVALID'],
      [400, NOT_MODIFIED],
      [400, 'Bad Request: chat not found'],
      [400, 'Bad Request: message is not a poll'],
      [400, 'Bad Request: poll has already been closed'],
    ], `Expected the ${chatType} edits to fail in Telegram's order`);
  });

  Deno.test(`an account's edit in a ${chatType} chat reports the first of competing failures`, async () => {
    await using scenario = await createChatScenario(chatType);
    const { api, sessionPath, ada, grace, botMessageId, accountMessageId, accountMessagesPath } =
      scenario;
    const linus = await createAccount(api, sessionPath, 'Linus');
    const editAsAccount = async (path: string, body: Record<string, unknown>) => {
      const { status, body: responseBody } = await requestJson<
        { reason?: string; message?: { message_id: number; text?: string } }
      >(api, 'PATCH', path, body);
      return [
        status,
        responseBody.reason ??
          { message_id: responseBody.message?.message_id, text: responseBody.message?.text },
      ];
    };
    const messagePath = (accountId: number, messageId: number) =>
      `${accountMessagesPath(accountId)}/${messageId}`;
    /** A message of a chat Ada cannot address: one with an unknown bot, or an unknown supergroup. */
    const unaddressableMessagePath = chatType === 'private'
      ? `${sessionPath}/accounts/${ada.id}/conversations/private/999999/messages/999`
      : `${sessionPath}/accounts/${ada.id}/conversations/supergroup/-1009999999999/messages/999`;
    const caption = { caption: 'Caption' };

    const outcomes = [
      // The chat is checked before the message, and the message before the new content.
      await editAsAccount(unaddressableMessagePath, caption),
      await editAsAccount(messagePath(linus.id, 999), caption),
      await editAsAccount(messagePath(ada.id, 999), caption),
      // Another chat's message is not found; another member's message is not editable.
      await editAsAccount(messagePath(grace.id, accountMessageId), caption),
      // Whether the account may edit the message is decided before its content.
      await editAsAccount(messagePath(ada.id, botMessageId), caption),
      await editAsAccount(messagePath(ada.id, accountMessageId), caption),
      await editAsAccount(messagePath(ada.id, accountMessageId), { text: 'Hello' }),
      await editAsAccount(messagePath(ada.id, accountMessageId), { text: 'Hello again' }),
    ];

    const privateOrSupergroup = (privateOutcome: unknown, supergroupOutcome: unknown) =>
      chatType === 'private' ? privateOutcome : supergroupOutcome;
    assertEquals(outcomes, [
      privateOrSupergroup([404, 'bot_not_found'], [404, 'chat_not_found']),
      privateOrSupergroup([404, 'message_not_found'], [403, 'not_a_member']),
      [404, 'message_not_found'],
      privateOrSupergroup([404, 'message_not_found'], [400, 'message_not_editable']),
      [400, 'message_not_editable'],
      [400, 'message_has_no_caption'],
      [400, 'message_not_modified'],
      [200, { message_id: accountMessageId, text: 'Hello again' }],
    ], `Expected the account's ${chatType} edits to fail in order, then succeed`);
  });

  Deno.test(`an edit in a ${chatType} chat reaches the chat's bot only for an account's message`, async () => {
    await using scenario = await createChatScenario(chatType);
    const {
      api,
      ada,
      bot,
      chatId,
      botMessageId,
      accountMessageId,
      accountMessagesPath,
      readUpdates,
    } = scenario;

    const botEdit = await describeEdit(api, bot, 'editMessageText', {
      chat_id: chatId,
      message_id: botMessageId,
      text: 'New menu',
    });
    const updatesAfterBotEdit = await readUpdates(bot.botApiPath);
    await requestJson(api, 'PATCH', `${accountMessagesPath(ada.id)}/${accountMessageId}`, {
      text: 'Hello again',
    });
    const updatesAfterAccountEdit = await readUpdates(bot.botApiPath);

    assertEquals(
      [
        botEdit,
        updatesAfterBotEdit,
        updatesAfterAccountEdit.map((update) => {
          const edited = update.edited_message as { message_id: number; text: string } | undefined;
          return [Object.keys(update), edited?.message_id, edited?.text];
        }),
      ],
      [
        [200, { message_id: botMessageId, text: 'New menu' }],
        [],
        [[['update_id', 'edited_message'], accountMessageId, 'Hello again']],
      ],
      `Expected only the account's ${chatType} edit to reach the bot, under the same message ID`,
    );
  });

  Deno.test(`an account's ${chatType} inline message is edited only by its inline bot, which need not be in the chat`, async () => {
    await using scenario = await createChatScenario(chatType);
    const { api, sessionPath, ada, bot, chatId } = scenario;
    const inlineBot = await createBot(api, sessionPath, 'inline_bot', {
      supports_inline_queries: true,
      receives_chosen_inline_results: true,
    });
    const readUpdates = createUpdateReader(api);
    await readUpdates(bot.botApiPath);
    const accountPath = `${sessionPath}/accounts/${ada.id}`;
    const { body: { inline_query: inlineQuery } } = await requestJson<
      { inline_query: { id: string } }
    >(api, 'POST', `${accountPath}/inline-queries`, {
      bot_id: inlineBot.bot.id,
      chat: chatType === 'private'
        ? { type: 'private', botId: bot.bot.id }
        : { type: 'supergroup', chatId },
      query: 'cats',
    });
    await describeCall(api, inlineBot, 'answerInlineQuery', {
      inline_query_id: inlineQuery.id,
      results: [{
        type: 'article',
        id: 'fact',
        title: 'Cat fact',
        input_message_content: { message_text: 'Cats sleep a lot' },
        // Only a message with a keyboard gets an inline message identifier.
        reply_markup: INLINE_RESULT_KEYBOARD,
      }],
    });
    await requestJson(
      api,
      'POST',
      `${accountPath}/inline-queries/${inlineQuery.id}/chosen-results`,
      {
        result_id: 'fact',
      },
    );
    const inlineMessageId = (await readUpdates(inlineBot.botApiPath))
      .map((update) => update.chosen_inline_result as { inline_message_id?: string } | undefined)
      .find((chosen) => chosen?.inline_message_id !== undefined)?.inline_message_id;
    const sentMessageId = (await readUpdates(bot.botApiPath))
      .map((update) => update.message as { message_id?: number } | undefined)
      .find((message) => message?.message_id !== undefined)?.message_id;
    if (inlineMessageId === undefined || sentMessageId === undefined) {
      throw new Error('Expected the chosen result to be sent as an inline message');
    }

    const outcomes = [
      // An unknown inline message is not found before the new keyboard is checked.
      await describeCall(api, inlineBot, 'editMessageText', {
        inline_message_id: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
        text: 'Dogs',
        reply_markup: OVERSIZED_CALLBACK_KEYBOARD,
      }),
      await describeCall(api, inlineBot, 'editMessageText', {
        inline_message_id: inlineMessageId,
        text: '',
      }),
      // Another bot does not find the inline message, even the chat's own bot.
      await describeCall(api, bot, 'editMessageText', {
        inline_message_id: inlineMessageId,
        text: 'Dogs',
      }),
      // By its chat, the chat's bot finds the message but may not edit it, and the inline bot,
      // which is not in the chat, does not reach the chat.
      await describeCall(api, bot, 'editMessageText', {
        chat_id: chatId,
        message_id: sentMessageId,
        text: 'Dogs',
      }),
      await describeCall(api, inlineBot, 'editMessageText', {
        chat_id: chatId,
        message_id: sentMessageId,
        text: 'Dogs',
      }),
      await describeCall(api, inlineBot, 'editMessageCaption', {
        inline_message_id: inlineMessageId,
        caption: 'Caption',
        reply_markup: OVERSIZED_CALLBACK_KEYBOARD,
      }),
      await describeCall(api, inlineBot, 'editMessageText', {
        inline_message_id: inlineMessageId,
        text: 'Cats sleep a lot',
        reply_markup: OVERSIZED_CALLBACK_KEYBOARD,
      }),
      await describeCall(api, inlineBot, 'editMessageText', {
        inline_message_id: inlineMessageId,
        text: 'Cats sleep a lot',
        reply_markup: INLINE_RESULT_KEYBOARD,
      }),
      // A supergroup refuses a Web App button in an inline message too.
      await describeCall(api, inlineBot, 'editMessageReplyMarkup', {
        inline_message_id: inlineMessageId,
        reply_markup: WEB_APP_KEYBOARD,
      }),
      await describeCall(api, inlineBot, 'editMessageText', {
        inline_message_id: inlineMessageId,
        text: 'Cats sleep even more',
      }),
    ];
    const updatesOfChatBot = (await readUpdates(bot.botApiPath)).map((update) => {
      const edited = update.edited_message as { message_id?: number; text?: string } | undefined;
      return [edited?.message_id, edited?.text];
    });

    assertEquals(
      [outcomes, updatesOfChatBot],
      [
        [
          [400, 'Bad Request: MESSAGE_ID_INVALID'],
          [400, 'Bad Request: message text is empty'],
          [400, 'Bad Request: MESSAGE_ID_INVALID'],
          [400, "Bad Request: message can't be edited"],
          [400, 'Bad Request: chat not found'],
          [400, 'Bad Request: there is no caption in the message to edit'],
          [400, 'Bad Request: BUTTON_DATA_INVALID'],
          [400, NOT_MODIFIED],
          chatType === 'private' ? [200, true] : [400, 'Bad Request: BUTTON_TYPE_INVALID'],
          [200, true],
        ],
        chatType === 'private'
          ? [[sentMessageId, 'Cats sleep a lot'], [sentMessageId, 'Cats sleep even more']]
          : [[sentMessageId, 'Cats sleep even more']],
      ],
      `Expected only the inline bot to edit the ${chatType} inline message`,
    );
  });

  Deno.test(`an edit in a ${chatType} chat finds a message only by that chat's own numbering`, async () => {
    await using scenario = await createChatScenario(chatType);
    const { api, sessionPath, bot, chatId, botMessageId } = scenario;
    // A second chat of the same type, where the bot writes after its first chat's message.
    const linus = await createAccount(api, sessionPath, 'Linus');
    let otherChatId: number;
    if (chatType === 'private') {
      await requestJson(api, 'POST', `${sessionPath}/accounts/${linus.id}/messages`, {
        to: { type: 'private', botId: bot.bot.id },
        text: 'Hi',
      });
      otherChatId = linus.id;
    } else {
      const { body: { supergroup } } = await requestJson<{ supergroup: { id: number } }>(
        api,
        'POST',
        `${sessionPath}/accounts/${linus.id}/supergroups`,
        { title: 'Other team' },
      );
      otherChatId = supergroup.id;
      await expectStatus(
        api,
        `${sessionPath}/accounts/${linus.id}/conversations/supergroup/${otherChatId}/members/${bot.bot.id}`,
        { method: 'PUT' },
        204,
      );
    }
    const otherMessageId = await sendBotMessage(api, bot, { chat_id: otherChatId, text: 'Other' });
    const laterMessageId = await sendBotMessage(api, bot, { chat_id: chatId, text: 'Later' });

    assertEquals(
      [
        [botMessageId, otherMessageId, laterMessageId],
        await describeEdit(api, bot, 'editMessageText', {
          chat_id: otherChatId,
          message_id: laterMessageId,
          text: 'Changed',
        }),
        await describeEdit(api, bot, 'editMessageText', {
          chat_id: chatId,
          message_id: otherMessageId,
          text: 'Changed',
        }),
        await describeEdit(api, bot, 'editMessageText', {
          chat_id: otherChatId,
          message_id: otherMessageId,
          text: 'Changed',
        }),
      ],
      chatType === 'private'
        ? [
          // The bot numbers the messages of all its private chats in one sequence.
          [2, 4, 5],
          [400, 'Bad Request: message to edit not found'],
          [400, 'Bad Request: message to edit not found'],
          [200, { message_id: 4, text: 'Changed' }],
        ]
        : [
          // Each supergroup numbers its own messages, its service messages included.
          [botMessageId, 2, botMessageId + 1],
          [400, 'Bad Request: message to edit not found'],
          [400, "Bad Request: message can't be edited"],
          [200, { message_id: 2, text: 'Changed' }],
        ],
      `Expected each ${chatType} chat to find its messages by its own numbering`,
    );
  });
}

Deno.test("a supergroup checks a restricted bot's right to show new content only for rich or media content", async () => {
  await using scenario = await createChatScenario(
    'supergroup',
  );
  const { api, sessionPath, ada, bot, chatId, botMessageId } = scenario;
  await expectStatus(
    api,
    `${sessionPath}/accounts/${ada.id}/conversations/supergroup/${chatId}/restrictions/${bot.bot.id}`,
    jsonRequest('PUT', { permissions: {} }),
    204,
  );
  const richMessage = { blocks: [{ type: 'paragraph', text: 'Rich menu' }] };

  assertEquals(
    [
      // The right is checked once the new content is read, before the keyboard.
      await describeCall(api, bot, 'editMessageText', {
        chat_id: chatId,
        message_id: botMessageId,
        rich_message: richMessage,
        reply_markup: WEB_APP_KEYBOARD,
      }),
      await describeCall(api, bot, 'editMessageText', {
        chat_id: chatId,
        message_id: 999,
        rich_message: richMessage,
      }),
      await describeEdit(api, bot, 'editMessageText', {
        chat_id: chatId,
        message_id: botMessageId,
        text: 'Plain menu',
      }),
    ],
    [
      [400, 'Bad Request: not enough rights to send the rich message to the chat'],
      [400, 'Bad Request: message to edit not found'],
      [200, { message_id: botMessageId, text: 'Plain menu' }],
    ],
    'Expected only the rich edit to need the right to send messages',
  );
});

Deno.test("a join request's contact grant lets a bot write to the requester, but not edit there", async () => {
  await using scenario = await createJoinRequesterChatScenario();
  const { api, sessionPath, grace, bot } = scenario;
  const promptId = await sendBotMessage(api, bot, {
    chat_id: grace.id,
    text: 'Press the button to join',
    reply_markup: { inline_keyboard: [[{ text: 'I am human', callback_data: 'human' }]] },
  });
  const pollId = await sendBotMessage(api, bot, {
    chat_id: grace.id,
    question: 'Human?',
    options: [{ text: 'Yes' }, { text: 'No' }],
  }, 'sendPoll');

  const editsUnderGrant = [
    await describeCall(api, bot, 'editMessageText', {
      chat_id: grace.id,
      message_id: promptId,
      text: 'Changed',
    }),
    await describeCall(api, bot, 'editMessageReplyMarkup', {
      chat_id: grace.id,
      message_id: promptId,
    }),
    await describeCall(api, bot, 'stopPoll', { chat_id: grace.id, message_id: pollId }),
  ];
  // Grace's answer starts the chat, which lets the bot edit there.
  await requestJson(api, 'POST', `${sessionPath}/accounts/${grace.id}/messages`, {
    to: { type: 'private', botId: bot.bot.id },
    text: 'Done',
  });

  assertEquals(
    [
      editsUnderGrant,
      await describeEdit(api, bot, 'editMessageText', {
        chat_id: grace.id,
        message_id: promptId,
        text: 'Changed',
      }),
    ],
    [
      [
        [400, 'Bad Request: chat not found'],
        [400, 'Bad Request: chat not found'],
        [400, 'Bad Request: chat not found'],
      ],
      [200, { message_id: promptId, text: 'Changed' }],
    ],
    'Expected the grant to allow no edit until Grace started the chat',
  );
});

Deno.test('a supergroup turns a former member bot away before it looks for the message', async () => {
  await using scenario = await createChatScenario('supergroup');
  const { api, sessionPath, ada, chatId } = scenario;
  const ownerPath = `${sessionPath}/accounts/${ada.id}/conversations/supergroup/${chatId}`;
  const removedBot = await createBot(api, sessionPath, 'removed_bot');
  const leavingBot = await createBot(api, sessionPath, 'leaving_bot');
  const formerMembers = [removedBot, leavingBot];
  const messageIds: number[] = [];
  for (const formerMember of formerMembers) {
    await expectStatus(api, `${ownerPath}/members/${formerMember.bot.id}`, { method: 'PUT' }, 204);
    messageIds.push(await sendBotMessage(api, formerMember, { chat_id: chatId, text: 'Bye' }));
  }
  await expectStatus(api, `${ownerPath}/members/${removedBot.bot.id}`, { method: 'DELETE' }, 204);
  await describeCall(api, leavingBot, 'leaveChat', { chat_id: chatId });

  const outcomes: CallOutcome[] = [];
  for (const [index, formerMember] of formerMembers.entries()) {
    outcomes.push(
      await describeCall(api, formerMember, 'editMessageText', {
        chat_id: chatId,
        message_id: 999,
        text: 'Changed',
      }),
      // Empty text is refused before the bot's membership is looked at.
      await describeCall(api, formerMember, 'editMessageText', {
        chat_id: chatId,
        message_id: messageIds[index],
        text: '',
      }),
    );
  }

  assertEquals(outcomes, [
    [403, 'Forbidden: bot was kicked from the supergroup chat'],
    [400, 'Bad Request: message text is empty'],
    [403, 'Forbidden: bot is not a member of the supergroup chat'],
    [400, 'Bad Request: message text is empty'],
  ], 'Expected each former member to be turned away as its membership ended');
});
