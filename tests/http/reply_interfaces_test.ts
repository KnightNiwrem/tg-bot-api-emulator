/**
 * Reply interfaces as each chat type shows them to an account: which of several competing failures
 * a read or a press reports, which keyboard the account's client shows and for how long, and what
 * a press sends to the chat's bot. Every table runs the same calls in a private chat and in a
 * supergroup; the requests only private chats' buttons make have their own private-chat tests.
 */
import { assertEquals } from '@std/assert';

import { jsonRequest, requestJson } from '../support/emulation_api.ts';
import { createAccount } from '../support/http_fixtures.ts';
import {
  CHAT_TYPES,
  type ChatType,
  createChatScenario,
  describeCall,
  expectStatus,
  sendBotMessage,
} from '../support/chat_type_scenarios.ts';

/** A reply keyboard of two buttons, which the account's client shows to every member. */
const YES_NO_KEYBOARD = { keyboard: [[{ text: 'Yes' }, { text: 'No' }]] };

type ChatScenario = Awaited<ReturnType<typeof createChatScenario>>;

/** The routes by which an account reads and presses the reply interface of the scenario's chat. */
function createReplyInterfaceCalls(
  { api, sessionPath, bot, chatId }: ChatScenario,
  chatType: ChatType,
) {
  const chat = chatType === 'private'
    ? { type: 'private', botId: bot.bot.id }
    : { type: 'supergroup', chatId };
  const conversationPath = (accountId: number) =>
    chatType === 'private'
      ? `${sessionPath}/accounts/${accountId}/conversations/private/${bot.bot.id}`
      : `${sessionPath}/accounts/${accountId}/conversations/supergroup/${chatId}`;
  /** The shown interface as `[200, type, message_id]`, `[200, null]`, or `[status, reason]`. */
  const readReplyInterface = async (path: string) => {
    const { status, body } = await requestJson<{
      reply_interface?: { type: string; message_id: number } | null;
      reason?: string;
    }>(api, 'GET', `${path}/reply-interface`);
    if (status !== 200) {
      return [status, body.reason];
    }
    const { reply_interface: shown } = body;
    return shown === null || shown === undefined
      ? [status, null]
      : [status, shown.type, shown.message_id];
  };
  /** A press as `[201, text, replied message ID]` or `[status, reason]`. */
  const press = async (accountId: number, body: Record<string, unknown>) => {
    const response = await api.request(
      `${sessionPath}/accounts/${accountId}/reply-keyboard-presses`,
      jsonRequest('POST', { chat, ...body }),
    );
    const responseBody = await response.json() as {
      message?: { text?: string; reply_to_message?: { message_id: number } };
      reason?: string;
    };
    return response.status === 201
      ? [
        response.status,
        responseBody.message?.text,
        responseBody.message?.reply_to_message?.message_id,
      ]
      : [response.status, responseBody.reason];
  };
  return { conversationPath, readReplyInterface, press };
}

for (const chatType of CHAT_TYPES) {
  Deno.test(`an account's press in a ${chatType} chat reports the first of competing failures`, async () => {
    const scenario = await createChatScenario(chatType);
    const { api, sessionPath, ada, bot, chatId, readUpdates } = scenario;
    const { conversationPath, readReplyInterface, press } = createReplyInterfaceCalls(
      scenario,
      chatType,
    );
    const linus = await createAccount(api, sessionPath, 'Linus');
    /** The conversation of a chat Ada cannot address: one with an unknown bot, or an unknown supergroup. */
    const unaddressablePath = chatType === 'private'
      ? `${sessionPath}/accounts/${ada.id}/conversations/private/999999`
      : `${sessionPath}/accounts/${ada.id}/conversations/supergroup/-1009999999999`;

    const readsBeforeKeyboard = [
      await readReplyInterface(conversationPath(999_999)),
      await readReplyInterface(unaddressablePath),
      await readReplyInterface(conversationPath(linus.id)),
      await readReplyInterface(conversationPath(ada.id)),
    ];
    const pressesBeforeKeyboard = [
      await press(999_999, { text: 'Yes' }),
      await press(linus.id, { text: 'Yes' }),
      await press(ada.id, { text: 'Yes' }),
    ];
    const keyboardMessageId = await sendBotMessage(api, bot, {
      chat_id: chatId,
      text: 'Agree?',
      reply_markup: YES_NO_KEYBOARD,
    });
    const readAfterKeyboard = await readReplyInterface(conversationPath(ada.id));
    const pressesWithKeyboard = [
      await press(ada.id, { text: 'Maybe' }),
      await press(ada.id, { text: 'Yes' }),
    ];
    const pressedTexts = (await readUpdates(bot.botApiPath)).map((update) => {
      const message = update.message as {
        text?: string;
        reply_to_message?: { message_id: number };
      };
      return [message.text, message.reply_to_message?.message_id];
    });

    // As Telegram Desktop does outside private chats, a supergroup's press replies to the keyboard.
    const pressReply = chatType === 'private' ? undefined : keyboardMessageId;
    assertEquals(
      {
        readsBeforeKeyboard,
        pressesBeforeKeyboard,
        readAfterKeyboard,
        pressesWithKeyboard,
        pressedTexts,
        // The keyboard stays shown after a press.
        readAfterPress: await readReplyInterface(conversationPath(ada.id)),
      },
      {
        readsBeforeKeyboard: [
          [404, 'account_not_found'],
          chatType === 'private' ? [404, 'bot_not_found'] : [404, 'chat_not_found'],
          // Linus is no member of the supergroup; in a private chat he reads his own chat.
          chatType === 'private' ? [200, null] : [403, 'not_a_member'],
          [200, null],
        ],
        pressesBeforeKeyboard: [
          [404, 'account_not_found'],
          chatType === 'private' ? [400, 'reply_keyboard_button_not_found'] : [403, 'not_a_member'],
          [400, 'reply_keyboard_button_not_found'],
        ],
        readAfterKeyboard: [200, 'keyboard', keyboardMessageId],
        pressesWithKeyboard: [
          [400, 'reply_keyboard_button_not_found'],
          [201, 'Yes', pressReply],
        ],
        pressedTexts: [['Yes', pressReply]],
        readAfterPress: [200, 'keyboard', keyboardMessageId],
      },
      `Expected the ${chatType} reads and presses to fail in Telegram's order`,
    );
  });

  Deno.test(`a ${chatType} chat stops showing a keyboard its bot removes or deletes`, async () => {
    const scenario = await createChatScenario(chatType);
    const { api, ada, bot, chatId } = scenario;
    const { conversationPath, readReplyInterface, press } = createReplyInterfaceCalls(
      scenario,
      chatType,
    );
    const showKeyboard = () =>
      sendBotMessage(api, bot, {
        chat_id: chatId,
        text: 'Agree?',
        reply_markup: YES_NO_KEYBOARD,
      });

    const firstKeyboardId = await showKeyboard();
    // A message without reply markup leaves the keyboard shown.
    await sendBotMessage(api, bot, { chat_id: chatId, text: 'Still there' });
    const readAfterPlainMessage = await readReplyInterface(conversationPath(ada.id));
    await sendBotMessage(api, bot, {
      chat_id: chatId,
      text: 'Done',
      reply_markup: { remove_keyboard: true },
    });
    const readAfterRemoval = await readReplyInterface(conversationPath(ada.id));
    const pressAfterRemoval = await press(ada.id, { text: 'Yes' });
    const forcedReplyId = await sendBotMessage(api, bot, {
      chat_id: chatId,
      text: 'Why?',
      reply_markup: { force_reply: true },
    });
    const readForcedReply = await readReplyInterface(conversationPath(ada.id));
    const pressOnForcedReply = await press(ada.id, { text: 'Yes' });
    const secondKeyboardId = await showKeyboard();
    const deletion = await describeCall(api, bot, 'deleteMessage', {
      chat_id: chatId,
      message_id: secondKeyboardId,
    });

    assertEquals(
      {
        readAfterPlainMessage,
        readAfterRemoval,
        pressAfterRemoval,
        readForcedReply,
        pressOnForcedReply,
        deletion,
        readAfterDeletion: await readReplyInterface(conversationPath(ada.id)),
        pressAfterDeletion: await press(ada.id, { text: 'Yes' }),
      },
      {
        readAfterPlainMessage: [200, 'keyboard', firstKeyboardId],
        readAfterRemoval: [200, null],
        pressAfterRemoval: [400, 'reply_keyboard_button_not_found'],
        readForcedReply: [200, 'force_reply', forcedReplyId],
        pressOnForcedReply: [400, 'reply_keyboard_button_not_found'],
        deletion: [200, true],
        readAfterDeletion: [200, null],
        pressAfterDeletion: [400, 'reply_keyboard_button_not_found'],
      },
      `Expected the ${chatType} chat to show the keyboard only while it is set`,
    );
  });

  Deno.test(`an account that may no longer write to a ${chatType} chat cannot press its keyboard`, async () => {
    const scenario = await createChatScenario(chatType);
    const { api, sessionPath, ada, grace, bot, chatId } = scenario;
    const { conversationPath, readReplyInterface, press } = createReplyInterfaceCalls(
      scenario,
      chatType,
    );
    const keyboardMessageId = await sendBotMessage(api, bot, {
      chat_id: chatId,
      text: 'Agree?',
      reply_markup: YES_NO_KEYBOARD,
    });
    // Ada blocks the bot of her private chat; Grace is removed from the supergroup.
    const presserId = chatType === 'private' ? ada.id : grace.id;
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
        `${sessionPath}/accounts/${ada.id}/conversations/supergroup/${chatId}/members/${grace.id}`,
        { method: 'DELETE' },
        204,
      );
    }

    assertEquals(
      [
        await readReplyInterface(conversationPath(presserId)),
        // A text no button has is refused for the block only after the keyboard is checked.
        await press(presserId, { text: 'Maybe' }),
        await press(presserId, { text: 'Yes' }),
      ],
      chatType === 'private'
        ? [
          [200, 'keyboard', keyboardMessageId],
          [400, 'reply_keyboard_button_not_found'],
          [409, 'bot_blocked'],
        ]
        : [
          [403, 'not_a_member'],
          [403, 'not_a_member'],
          [403, 'not_a_member'],
        ],
      `Expected the ${chatType} press to be refused where the account no longer writes`,
    );
  });
}

Deno.test('a supergroup press answers no request, which is refused before the member is checked', async () => {
  const scenario = await createChatScenario('supergroup');
  const { api, sessionPath } = scenario;
  const { press } = createReplyInterfaceCalls(scenario, 'supergroup');
  const linus = await createAccount(api, sessionPath, 'Linus');

  assertEquals(
    await press(linus.id, { text: 'Where?', location: { latitude: 1, longitude: 2 } }),
    [400, 'reply_keyboard_button_answer_not_requested'],
    'Expected an answer to be refused in a supergroup',
  );
});

Deno.test("a private chat's request button checks its answer before the bot's block", async () => {
  const scenario = await createChatScenario('private');
  const { api, sessionPath, ada, bot, chatId } = scenario;
  const { press } = createReplyInterfaceCalls(scenario, 'private');
  await sendBotMessage(api, bot, {
    chat_id: chatId,
    text: 'Pick',
    reply_markup: {
      keyboard: [
        [{ text: 'People', request_users: { request_id: 1 } }],
        [{ text: 'Quiz', request_poll: { type: 'quiz' } }],
        [{ text: 'Where', request_location: true }],
      ],
    },
  });
  await expectStatus(
    api,
    `${sessionPath}/accounts/${ada.id}/blocked-bots/${bot.bot.id}`,
    { method: 'PUT' },
    204,
  );
  const regularPoll = { question: 'Lunch?', options: [{ text: 'Yes' }, { text: 'No' }] };

  assertEquals(
    [
      await press(ada.id, { text: 'People' }),
      await press(ada.id, { text: 'People', shared_user_ids: [ada.id] }),
      await press(ada.id, { text: 'Quiz', poll: regularPoll }),
      await press(ada.id, { text: 'Where', location: { latitude: 1, longitude: 2 } }),
    ],
    [
      [400, 'reply_keyboard_button_answer_missing'],
      [409, 'bot_blocked'],
      [400, 'requested_poll_type_mismatch'],
      [409, 'bot_blocked'],
    ],
    "Expected each request's answer to be checked before the block",
  );
});
