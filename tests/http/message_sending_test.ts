/**
 * Message sending as each chat type and each sender observes it: which of several competing
 * failures a bot's or an account's message reports, in its chat type's order; how a chat that no
 * longer admits a sender turns it away; which updates a message causes; how each observer's box
 * numbers the messages of interleaved chats; and that a bot's file is downloaded only after the
 * options it sent were read, and before its chat is checked. Every table runs the same sends in a
 * private chat and in a supergroup.
 */
import { assertEquals } from '@std/assert';

import { jsonRequest, requestJson } from '../support/emulation_api.ts';
import { createAccount, createBot } from '../support/http_fixtures.ts';
import { gifImage } from '../support/media_samples.ts';
import {
  CHAT_TYPES,
  type ChatType,
  createChatScenario,
  createJoinRequesterChatScenario,
  describeCall,
  expectStatus,
} from '../support/chat_type_scenarios.ts';

type ChatScenario = Awaited<ReturnType<typeof createChatScenario>>;

/** An ID of a chat the bot cannot reach: an unknown user, or an unknown supergroup. */
function unreachableChatIdOf(chatType: ChatType): number {
  return chatType === 'private' ? 999_999 : -1_009_999_999_999;
}

/** A sent message as `[200, text, replied message ID]`, or a failure as `[status, description]`. */
async function describeSend(
  { api }: ChatScenario,
  bot: ChatScenario['bot'],
  method: string,
  parameters: Record<string, unknown>,
) {
  const [status, result] = await describeCall(api, bot, method, parameters);
  if (status !== 200) {
    return [status, result];
  }
  const message = result as { text?: string; reply_to_message?: { message_id: number } };
  return [status, message.text, message.reply_to_message?.message_id];
}

/** An account's message through the control API, as `[201, message ID]` or `[status, reason]`. */
async function sendAsAccount(
  { api, sessionPath }: ChatScenario,
  accountId: number,
  body: Record<string, unknown>,
) {
  const response = await api.request(
    `${sessionPath}/accounts/${accountId}/messages`,
    jsonRequest('POST', body),
  );
  const responseBody = await response.json() as {
    message?: { message_id: number };
    reason?: string;
  };
  return response.status === 201
    ? [response.status, responseBody.message?.message_id]
    : [response.status, responseBody.reason];
}

/** The chat as an account addresses it in a control API request. */
function accountChatOf({ bot, chatId }: ChatScenario, chatType: ChatType) {
  return chatType === 'private'
    ? { type: 'private', botId: bot.bot.id }
    : { type: 'supergroup', chatId };
}

/** The texts and replied message IDs of the messages a bot receives. */
function describeMessageUpdates(updates: readonly Record<string, unknown>[]) {
  return updates.map((update) => {
    const message = update.message as {
      text?: string;
      reply_to_message?: { message_id: number };
    };
    return [message.text, message.reply_to_message?.message_id];
  });
}

const MESSAGE_EFFECT_ID = '5104841245755180586';

for (const chatType of CHAT_TYPES) {
  Deno.test(`a bot's message to a ${chatType} chat reports the first of competing failures`, async () => {
    const scenario = await createChatScenario(chatType);
    const { api, sessionPath, bot, chatId, accountMessageId, readUpdates } = scenario;
    const outsider = await createBot(api, sessionPath, 'outsider_bot');
    const send = (parameters: Record<string, unknown>) =>
      describeSend(scenario, bot, 'sendMessage', { chat_id: chatId, ...parameters });

    const outcomes = [
      // Empty text is refused before the chat is looked up.
      await describeSend(scenario, bot, 'sendMessage', {
        chat_id: unreachableChatIdOf(chatType),
        text: '',
      }),
      await describeSend(scenario, bot, 'sendMessage', {
        chat_id: unreachableChatIdOf(chatType),
        text: 'Hi',
      }),
      await describeSend(scenario, outsider, 'sendMessage', { chat_id: chatId, text: 'Hi' }),
      // The replied message is looked up before a message effect is refused.
      await send({
        text: 'Hi',
        reply_parameters: { message_id: 999 },
        message_effect_id: MESSAGE_EFFECT_ID,
      }),
      await send({
        text: 'Without reply',
        reply_parameters: { message_id: 999, allow_sending_without_reply: true },
      }),
      await send({ text: 'Effect', message_effect_id: MESSAGE_EFFECT_ID }),
      // Callback data is checked before a Web App button, which only a supergroup refuses.
      await send({
        text: 'Buttons',
        reply_markup: {
          inline_keyboard: [[
            { text: 'Open', web_app: { url: 'https://app.example/' } },
            { text: 'Long', callback_data: 'x'.repeat(65) },
          ]],
        },
      }),
      await send({
        text: 'Open',
        reply_markup: {
          inline_keyboard: [[{ text: 'Open', web_app: { url: 'https://app.example/' } }]],
        },
      }),
      await send({
        text: 'Quote',
        reply_parameters: { message_id: accountMessageId, quote: 'Goodbye' },
      }),
      await send({
        text: 'Quoted',
        reply_parameters: { message_id: accountMessageId, quote: 'Hello' },
      }),
    ];

    assertEquals(
      [outcomes, await readUpdates(bot.botApiPath)],
      [
        [
          [400, 'Bad Request: message text is empty'],
          [400, 'Bad Request: chat not found'],
          [400, 'Bad Request: chat not found'],
          [400, 'Bad Request: message to be replied not found'],
          [200, 'Without reply', undefined],
          chatType === 'private'
            ? [200, 'Effect', undefined]
            : [400, "Bad Request: can't use message effects in the chat"],
          [400, 'Bad Request: BUTTON_DATA_INVALID'],
          chatType === 'private'
            ? [200, 'Open', undefined]
            : [400, 'Bad Request: BUTTON_TYPE_INVALID'],
          [400, 'Bad Request: QUOTE_TEXT_INVALID'],
          [200, 'Quoted', accountMessageId],
        ],
        // No bot receives an update for a bot's own message.
        [],
      ],
      `Expected the bot's ${chatType} messages to fail in Telegram's order`,
    );
  });

  Deno.test(`a ${chatType} chat that no longer admits its bot turns it away in its own order`, async () => {
    const scenario = await createChatScenario(chatType);
    const { api, sessionPath, ada, bot, chatId, accountMessageId } = scenario;
    // Ada blocks the bot of her private chat, or removes it from her supergroup.
    if (chatType === 'private') {
      await expectStatus(
        api,
        `${sessionPath}/accounts/${ada.id}/blocked-bots/${bot.bot.id}`,
        { method: 'PUT' },
        204,
      );
    } else {
      await expectStatus(
        api,
        `${sessionPath}/accounts/${ada.id}/conversations/supergroup/${chatId}/members/${bot.bot.id}`,
        { method: 'DELETE' },
        204,
      );
    }
    const send = (parameters: Record<string, unknown>) =>
      describeSend(scenario, bot, 'sendMessage', { chat_id: chatId, ...parameters });
    const turnedAway = chatType === 'private'
      ? [403, 'Forbidden: bot was blocked by the user']
      : [403, 'Forbidden: bot was kicked from the supergroup chat'];

    assertEquals(
      [
        await send({ text: '' }),
        await send({ text: 'Hi', reply_parameters: { message_id: 999 } }),
        await send({
          text: 'Quote',
          reply_parameters: { message_id: accountMessageId, quote: 'Goodbye' },
        }),
        await send({ text: 'Hi' }),
        await describeSend(scenario, bot, 'sendMediaGroup', {
          chat_id: chatId,
          media: [],
        }),
      ],
      chatType === 'private'
        ? [
          [400, 'Bad Request: message text is empty'],
          // A private chat checks the account's block last, after the replied message and quote.
          [400, 'Bad Request: message to be replied not found'],
          [400, 'Bad Request: QUOTE_TEXT_INVALID'],
          turnedAway,
          [400, 'Bad Request: there are no messages to send'],
        ]
        : [
          [400, 'Bad Request: message text is empty'],
          // A supergroup checks the bot's membership before anything about the message.
          turnedAway,
          turnedAway,
          turnedAway,
          [400, 'Bad Request: there are no messages to send'],
        ],
      `Expected the ${chatType} chat to turn its former bot away in its order`,
    );
  });

  Deno.test(`an account's message to a ${chatType} chat reports the first of competing failures`, async () => {
    const scenario = await createChatScenario(chatType);
    const { api, sessionPath, ada, bot, botMessageId, readUpdates } = scenario;
    const linus = await createAccount(api, sessionPath, 'Linus');
    const to = accountChatOf(scenario, chatType);
    const unaddressable = chatType === 'private'
      ? { type: 'private', botId: 999_999 }
      : { type: 'supergroup', chatId: -1_009_999_999_999 };

    const outcomes = [
      await sendAsAccount(scenario, 999_999, { to, text: 'Hi' }),
      await sendAsAccount(scenario, ada.id, { to: unaddressable, text: 'Hi' }),
      await sendAsAccount(scenario, ada.id, { to, text: 'Hi', reply_to_message_id: 999 }),
      await sendAsAccount(scenario, ada.id, {
        to,
        text: 'Reply',
        reply_to_message_id: botMessageId,
      }),
    ];
    const updates = describeMessageUpdates(await readUpdates(bot.botApiPath));
    // Linus never wrote to the bot or joined the supergroup.
    const outsiderOutcome = await sendAsAccount(scenario, linus.id, { to, text: 'Hello' });

    assertEquals(
      { outcomes, updates, outsiderOutcome },
      {
        outcomes: [
          [404, 'account_not_found'],
          chatType === 'private' ? [404, 'bot_not_found'] : [404, 'chat_not_found'],
          [400, 'reply_message_not_found'],
          // Each chat numbers the account's message in its own sequence.
          [201, botMessageId + 1],
        ],
        // The chat's bot receives the account's message under the same ID.
        updates: [['Reply', botMessageId]],
        // An account starts its private chat with any bot, but writes only to supergroups it is in.
        outsiderOutcome: chatType === 'private' ? [201, botMessageId + 2] : [403, 'not_a_member'],
      },
      `Expected the account's ${chatType} messages to fail in Telegram's order`,
    );
  });

  Deno.test(`an account that may not write to a ${chatType} chat is refused before its reply is looked up`, async () => {
    const scenario = await createChatScenario(chatType);
    const { api, sessionPath, ada, grace, bot, chatId } = scenario;
    const to = accountChatOf(scenario, chatType);
    // Ada blocks the bot of her private chat; the supergroup's defaults stop members writing.
    if (chatType === 'private') {
      await expectStatus(
        api,
        `${sessionPath}/accounts/${ada.id}/blocked-bots/${bot.bot.id}`,
        { method: 'PUT' },
        204,
      );
    } else {
      await expectStatus(
        api,
        `${sessionPath}/accounts/${ada.id}/conversations/supergroup/${chatId}/permissions`,
        jsonRequest('PUT', { permissions: { can_send_messages: false } }),
        204,
      );
    }
    const senderId = chatType === 'private' ? ada.id : grace.id;

    assertEquals(
      [
        await sendAsAccount(scenario, senderId, { to, text: 'Hi', reply_to_message_id: 999 }),
        await sendAsAccount(scenario, senderId, { to, text: 'Hi' }),
      ],
      chatType === 'private'
        ? [[409, 'bot_blocked'], [409, 'bot_blocked']]
        : [[403, 'send_permission_missing'], [403, 'send_permission_missing']],
      `Expected the ${chatType} chat to refuse the account before its reply`,
    );
  });

  Deno.test(`each observer's box numbers the messages of interleaved ${chatType} chats`, async () => {
    const scenario = await createChatScenario(chatType);
    const { api, sessionPath, ada, grace, bot, chatId, botMessageId } = scenario;
    // Another chat of the bot gets a message in between: Grace's private chat with the bot, which
    // the bot's box numbers too, or a second supergroup, which numbers its own messages.
    let otherChatId: number;
    if (chatType === 'private') {
      otherChatId = grace.id;
      await sendAsAccount(scenario, grace.id, {
        to: { type: 'private', botId: bot.bot.id },
        text: 'Hi',
      });
    } else {
      const { body } = await requestJson<{ supergroup: { id: number } }>(
        api,
        'POST',
        `${sessionPath}/accounts/${ada.id}/supergroups`,
        { title: 'Other' },
      );
      otherChatId = body.supergroup.id;
      await expectStatus(
        api,
        `${sessionPath}/accounts/${ada.id}/conversations/supergroup/${otherChatId}/members/${bot.bot.id}`,
        { method: 'PUT' },
        204,
      );
    }
    const [, otherChatMessage] = await describeCall(api, bot, 'sendMessage', {
      chat_id: otherChatId,
      text: 'Elsewhere',
    });
    const [, nextMessage] = await describeCall(api, bot, 'sendMessage', {
      chat_id: chatId,
      text: 'Next',
    });
    const otherChatMessageId = (otherChatMessage as { message_id: number }).message_id;

    assertEquals(
      [
        (nextMessage as { message_id: number }).message_id,
        // An ID that numbers another chat's message names nothing in this chat.
        await describeSend(scenario, bot, 'sendMessage', {
          chat_id: chatId,
          text: 'Reply',
          reply_parameters: { message_id: otherChatMessageId },
        }),
      ],
      chatType === 'private'
        ? [botMessageId + 3, [400, 'Bad Request: message to be replied not found']]
        : [botMessageId + 1, [200, 'Reply', otherChatMessageId]],
      `Expected the ${chatType} chat's messages to be numbered in each observer's box`,
    );
  });

  Deno.test(`a bot's file for a ${chatType} chat is downloaded after its options are read and before its chat is checked`, async () => {
    const scenario = await createChatScenario(chatType);
    const { api, sessionPath, bot } = scenario;
    const registeredUrl = 'https://cdn.example.com/cat.gif';
    await expectStatus(
      api,
      `${sessionPath}/web-resources`,
      jsonRequest('POST', {
        url: registeredUrl,
        content_type: 'image/gif',
        content_base64: gifImage(4, 3).toBase64(),
      }),
      201,
    );
    const sendPhoto = (parameters: Record<string, unknown>) =>
      describeSend(scenario, bot, 'sendPhoto', {
        chat_id: unreachableChatIdOf(chatType),
        ...parameters,
      });

    assertEquals(
      [
        // The reply's chat is read with the options, before the photo is downloaded.
        await sendPhoto({
          photo: 'https://cdn.example.com/missing.gif',
          reply_parameters: { chat_id: '@nobody_here', message_id: 1 },
        }),
        await sendPhoto({ photo: 'https://cdn.example.com/missing.gif' }),
        await sendPhoto({ photo: registeredUrl }),
      ],
      [
        [400, 'Bad Request: chat not found'],
        [400, 'Bad Request: failed to get HTTP URL content'],
        [400, 'Bad Request: chat not found'],
      ],
      `Expected the photo for the ${chatType} chat to be downloaded between those checks`,
    );
  });

  Deno.test(`an album for a ${chatType} chat refuses a message effect only outside private chats`, async () => {
    const scenario = await createChatScenario(chatType);
    const { api, sessionPath, bot, chatId } = scenario;
    await expectStatus(
      api,
      `${sessionPath}/web-resources`,
      jsonRequest('POST', {
        url: 'https://cdn.example.com/cat.gif',
        content_type: 'image/gif',
        content_base64: gifImage(4, 3).toBase64(),
      }),
      201,
    );
    const media = [
      { type: 'photo', media: 'https://cdn.example.com/cat.gif' },
      { type: 'photo', media: 'https://cdn.example.com/cat.gif' },
    ];

    const [status, result] = await describeCall(api, bot, 'sendMediaGroup', {
      chat_id: chatId,
      media,
      message_effect_id: MESSAGE_EFFECT_ID,
    });
    const replyFailure = await describeCall(api, bot, 'sendMediaGroup', {
      chat_id: chatId,
      media,
      reply_parameters: { message_id: 999 },
      message_effect_id: MESSAGE_EFFECT_ID,
    });

    assertEquals(
      [
        status === 200 ? [status, (result as unknown[]).length] : [status, result],
        replyFailure,
      ],
      [
        chatType === 'private'
          ? [200, 2]
          : [400, "Bad Request: can't use message effects in the chat"],
        [400, 'Bad Request: message to be replied not found'],
      ],
      `Expected the ${chatType} album to refuse an effect only outside private chats`,
    );
  });
}

Deno.test("a join request's contact grant lets a bot send to the requester before the chat starts", async () => {
  const { api, sessionPath, grace, bot } = await createJoinRequesterChatScenario();

  const sends = [
    await describeCall(api, bot, 'sendMessage', { chat_id: grace.id, text: 'Welcome' }),
    await describeCall(api, bot, 'sendMessage', { chat_id: grace.id, text: 'Again' }),
  ];
  const { body } = await requestJson<{ messages: Array<{ text?: string }> }>(
    api,
    'GET',
    `${sessionPath}/accounts/${grace.id}/conversations/private/${bot.bot.id}/messages`,
  );

  assertEquals(
    [
      sends.map(([status, result]) => [status, (result as { text?: string }).text]),
      body.messages.map(({ text }) => text),
    ],
    [[[200, 'Welcome'], [200, 'Again']], ['Welcome', 'Again']],
    'Expected the grant to let the bot write to Grace before she starts the chat',
  );
});
