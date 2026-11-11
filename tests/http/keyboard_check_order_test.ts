/**
 * The order in which methods check an inline keyboard's login buttons against their other faults.
 * As the official Bot API server reads a request, `get_inline_keyboard_button_type` checks a login
 * button's bot username while it parses the keyboard
 * (https://github.com/tdlib/telegram-bot-api/blob/e3e9dd8e5b3d7ab8537cd5a10dc31d5ffa8f82d1/telegram-bot-api/Client.cpp#L10442-L10483),
 * `resolve_reply_markup_bot_usernames` then resolves the bot
 * (https://github.com/tdlib/telegram-bot-api/blob/e3e9dd8e5b3d7ab8537cd5a10dc31d5ffa8f82d1/telegram-bot-api/Client.cpp#L9275-L9340),
 * and only then does TDLib check the buttons' links. Telegram answered these orders in a live
 * capture of issue #250 on 2026-11-11.
 */
import { assertEquals } from '@std/assert';

import { botApiResult, callBotApi } from '../support/bot_api_requests.ts';
import { createPrivateConversationFixture } from '../support/http_fixtures.ts';

const INVALID_URL_BUTTON = { text: 'URL', url: 'https://' };
const INVALID_URL_DESCRIPTION =
  "Bad Request: inline keyboard button URL 'https://' is invalid: URL host is empty";

const INVALID_LOGIN_BUTTON = {
  text: 'Login',
  login_url: { url: 'https://example.com', bot_username: 'bad!' },
};
const INVALID_LOGIN_DESCRIPTION =
  "Bad Request: can't parse InlineKeyboardButton: LoginUrl bot username is invalid";

const UNKNOWN_LOGIN_BOT = 'no_such_login_bot';
const UNKNOWN_LOGIN_BUTTON = {
  text: 'Login',
  login_url: { url: 'https://example.com', bot_username: UNKNOWN_LOGIN_BOT },
};
const UNKNOWN_LOGIN_DESCRIPTION = `Bad Request: bot "${UNKNOWN_LOGIN_BOT}" not found`;

function keyboardOf(...buttons: readonly unknown[]) {
  return { inline_keyboard: [buttons] };
}

/** Creates a private chat in which the bot has sent a text message and a poll. */
async function createChatWithMessages() {
  const fixture = await createPrivateConversationFixture();
  const { api, botApiPath, createdAccount, sendText } = fixture;
  await sendText('/start');
  const chatId = createdAccount.account.id;
  const sendAndReadId = async (method: string, parameters: Record<string, unknown>) => {
    const sent = botApiResult(
      (await callBotApi(api, `${botApiPath}/${method}`, { chat_id: chatId, ...parameters })).body,
    );
    if (typeof sent?.message_id !== 'number') {
      throw new Error(`Expected ${method} to send a message, received ${JSON.stringify(sent)}`);
    }
    return sent.message_id;
  };
  const textMessageId = await sendAndReadId('sendMessage', { text: 'Hi' });
  const pollMessageId = await sendAndReadId('sendPoll', {
    question: 'Which?',
    options: [{ text: 'A' }, { text: 'B' }],
  });
  const describeFailure = async (method: string, parameters: Record<string, unknown>) => {
    const { status, body } = await callBotApi(api, `${botApiPath}/${method}`, parameters);
    return [status, (body as { readonly description?: string }).description];
  };
  return { fixture, chatId, textMessageId, pollMessageId, describeFailure };
}

Deno.test('Every method with a keyboard parses and resolves login buttons before checking links', async () => {
  const { fixture, chatId, textMessageId, pollMessageId, describeFailure } =
    await createChatWithMessages();
  await using _fixture = fixture;
  const methods: Readonly<Record<string, Record<string, unknown>>> = {
    sendMessage: { chat_id: chatId, text: 'Hi' },
    sendLocation: { chat_id: chatId, latitude: 1, longitude: 2 },
    sendContact: { chat_id: chatId, phone_number: '+10000000000', first_name: 'Ada' },
    sendPoll: { chat_id: chatId, question: 'Which?', options: [{ text: 'A' }, { text: 'B' }] },
    copyMessage: { chat_id: chatId, from_chat_id: chatId, message_id: textMessageId },
    editMessageText: { chat_id: chatId, message_id: textMessageId, text: 'Edited' },
    editMessageCaption: { chat_id: chatId, message_id: textMessageId, caption: 'Edited' },
    editMessageReplyMarkup: { chat_id: chatId, message_id: textMessageId },
    stopPoll: { chat_id: chatId, message_id: pollMessageId },
  };

  const answers: Record<string, unknown> = {};
  const expectedAnswers: Record<string, unknown> = {};
  for (const [method, parameters] of Object.entries(methods)) {
    answers[method] = {
      urlOnly: await describeFailure(method, {
        ...parameters,
        reply_markup: keyboardOf(INVALID_URL_BUTTON),
      }),
      usernameAfterUrl: await describeFailure(method, {
        ...parameters,
        reply_markup: keyboardOf(INVALID_URL_BUTTON, INVALID_LOGIN_BUTTON),
      }),
      lookupAfterUrl: await describeFailure(method, {
        ...parameters,
        reply_markup: keyboardOf(INVALID_URL_BUTTON, UNKNOWN_LOGIN_BUTTON),
      }),
      usernameAfterLookup: await describeFailure(method, {
        ...parameters,
        reply_markup: keyboardOf(UNKNOWN_LOGIN_BUTTON, INVALID_LOGIN_BUTTON),
      }),
    };
    expectedAnswers[method] = {
      urlOnly: [400, INVALID_URL_DESCRIPTION],
      usernameAfterUrl: [400, INVALID_LOGIN_DESCRIPTION],
      lookupAfterUrl: [400, UNKNOWN_LOGIN_DESCRIPTION],
      usernameAfterLookup: [400, INVALID_LOGIN_DESCRIPTION],
    };
  }

  assertEquals(
    answers,
    expectedAnswers,
    'Expected a later login button to be parsed and resolved before an earlier link is checked',
  );
});

Deno.test('Login buttons are parsed and resolved where each method reads its keyboard', async () => {
  const { fixture, chatId, textMessageId, describeFailure } = await createChatWithMessages();
  await using _fixture = fixture;
  const unclosedHtml = { parse_mode: 'HTML' };

  const answers = {
    // `do_send_message` resolves the keyboard's bots before `check_chat` reads `chat_id`
    // (Client.cpp#L17366-L17383, #L8868-L8873).
    sendLookupBeforeChat: await describeFailure('sendMessage', {
      text: 'Hi',
      reply_markup: keyboardOf(UNKNOWN_LOGIN_BUTTON),
    }),
    // A send method reads its content before `do_send_message` parses the keyboard.
    sendTextParseBeforeKeyboard: await describeFailure('sendMessage', {
      chat_id: chatId,
      text: '<b>Hi',
      ...unclosedHtml,
      reply_markup: keyboardOf(INVALID_LOGIN_BUTTON),
    }),
    // `process_edit_message_text_query` reads the text, then the keyboard (Client.cpp#L14651-L14662).
    editTextParseBeforeKeyboard: await describeFailure('editMessageText', {
      chat_id: chatId,
      message_id: textMessageId,
      text: '<b>Hi',
      ...unclosedHtml,
      reply_markup: keyboardOf(INVALID_LOGIN_BUTTON),
    }),
    // `process_edit_message_caption_query` reads the keyboard, then the caption
    // (Client.cpp#L14813-L14818).
    editKeyboardParseBeforeCaption: await describeFailure('editMessageCaption', {
      chat_id: chatId,
      message_id: textMessageId,
      caption: '<b>Hi',
      ...unclosedHtml,
      reply_markup: keyboardOf(INVALID_LOGIN_BUTTON),
    }),
    // An inline message's identifier is read after the keyboard is parsed, but before its bots are
    // resolved (Client.cpp#L14662-L14665).
    editKeyboardParseBeforeInlineMessageId: await describeFailure('editMessageReplyMarkup', {
      reply_markup: keyboardOf(INVALID_LOGIN_BUTTON),
    }),
    editInlineMessageIdBeforeLookup: await describeFailure('editMessageReplyMarkup', {
      reply_markup: keyboardOf(UNKNOWN_LOGIN_BUTTON),
    }),
    // A message in a chat is checked by `check_message` once the bots are resolved
    // (Client.cpp#L14674-L14700).
    editLookupBeforeChat: await describeFailure('editMessageReplyMarkup', {
      message_id: textMessageId,
      reply_markup: keyboardOf(UNKNOWN_LOGIN_BUTTON),
    }),
    // `process_stop_poll_query` resolves the bots before `check_message` (Client.cpp#L14326-L14348).
    stopPollLookupBeforeChat: await describeFailure('stopPoll', {
      message_id: textMessageId,
      reply_markup: keyboardOf(UNKNOWN_LOGIN_BUTTON),
    }),
  };

  const unclosedBoldDescription = "Bad Request: can't parse entities: Can't find end tag " +
    'corresponding to start tag "b"';
  assertEquals(answers, {
    sendLookupBeforeChat: [400, UNKNOWN_LOGIN_DESCRIPTION],
    sendTextParseBeforeKeyboard: [400, unclosedBoldDescription],
    editTextParseBeforeKeyboard: [400, unclosedBoldDescription],
    editKeyboardParseBeforeCaption: [400, INVALID_LOGIN_DESCRIPTION],
    editKeyboardParseBeforeInlineMessageId: [400, INVALID_LOGIN_DESCRIPTION],
    editInlineMessageIdBeforeLookup: [400, 'Bad Request: message identifier is not specified'],
    editLookupBeforeChat: [400, UNKNOWN_LOGIN_DESCRIPTION],
    stopPollLookupBeforeChat: [400, UNKNOWN_LOGIN_DESCRIPTION],
  });
});
