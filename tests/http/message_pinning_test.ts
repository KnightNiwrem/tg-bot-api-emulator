/**
 * Message pinning as each chat type and each pinner observes it: which of several competing
 * failures a pin or an unpin reports, that the message is looked up before the right to pin is
 * checked, how a pin reaches the chat's bot as a service message numbered in the chat's own
 * sequence, how a former participant is turned away, and what a join request's contact grant does
 * not allow. Every table runs the same calls in a private chat and in a supergroup.
 */
import { assertEquals } from '@std/assert';

import { jsonRequest, requestJson } from '../support/emulation_api.ts';
import { createAccount, createBot } from '../support/http_fixtures.ts';
import {
  CHAT_TYPES,
  type ChatType,
  createChatScenario,
  createJoinRequesterChatScenario,
  describeCall,
  expectStatus,
  sendBotMessage,
} from '../support/chat_type_scenarios.ts';

/** A pin's service message as the chat's bot receives it: its ID, author and pinned message. */
function describePinUpdates(updates: readonly Record<string, unknown>[]) {
  return updates.map((update) => {
    const message = update.message as {
      readonly message_id: number;
      readonly from?: { readonly id: number };
      readonly pinned_message?: { readonly message_id: number };
    };
    return {
      messageId: message.message_id,
      fromId: message.from?.id,
      pinnedMessageId: message.pinned_message?.message_id,
    };
  });
}

/** The path by which an account addresses its conversation in the chat of the given type. */
function conversationPathOf(
  sessionPath: string,
  chatType: ChatType,
  { accountId, botId, chatId }: {
    readonly accountId: number;
    readonly botId: number;
    readonly chatId: number;
  },
): string {
  return chatType === 'private'
    ? `${sessionPath}/accounts/${accountId}/conversations/private/${botId}`
    : `${sessionPath}/accounts/${accountId}/conversations/supergroup/${chatId}`;
}

/** Answers an account's pin change as `[204]` or `[status, reason]`. */
async function changePinAsAccount(
  api: Awaited<ReturnType<typeof createChatScenario>>['api'],
  method: 'PUT' | 'DELETE',
  pinnedMessagePath: string,
): Promise<readonly unknown[]> {
  const response = await api.request(pinnedMessagePath, { method });
  return response.status === 204
    ? [204]
    : [response.status, ((await response.json()) as { reason: string }).reason];
}

for (const chatType of CHAT_TYPES) {
  Deno.test(`a bot's pin in a ${chatType} chat reports the first of competing failures`, async () => {
    const { api, sessionPath, bot, chatId, accountMessageId, readUpdates } =
      await createChatScenario(chatType);
    /** An ID of a chat the bot cannot reach: an unknown user, or an unknown supergroup. */
    const unreachableChatId = chatType === 'private' ? 999_999 : -1_009_999_999_999;
    const outsider = await createBot(api, sessionPath, 'outsider_bot');

    const outcomes = [
      // The chat is checked before the message.
      await describeCall(api, bot, 'pinChatMessage', {
        chat_id: unreachableChatId,
        message_id: 999,
      }),
      await describeCall(api, outsider, 'pinChatMessage', {
        chat_id: chatId,
        message_id: accountMessageId,
      }),
      await describeCall(api, outsider, 'unpinAllChatMessages', { chat_id: chatId }),
      // The message is looked up before the right to pin, which the supergroup's bot lacks.
      await describeCall(api, bot, 'pinChatMessage', { chat_id: chatId, message_id: 999 }),
      await describeCall(api, bot, 'unpinChatMessage', { chat_id: chatId, message_id: 999 }),
      await describeCall(api, bot, 'unpinChatMessage', { chat_id: chatId }),
      await describeCall(api, bot, 'pinChatMessage', {
        chat_id: chatId,
        message_id: accountMessageId,
      }),
      await describeCall(api, bot, 'unpinAllChatMessages', { chat_id: chatId }),
    ];

    const lacksRight = [
      400,
      'Bad Request: not enough rights to manage pinned messages in the chat',
    ];
    assertEquals(
      [outcomes, describePinUpdates(await readUpdates(bot.botApiPath))],
      [
        [
          [400, 'Bad Request: chat not found'],
          [400, 'Bad Request: chat not found'],
          [400, 'Bad Request: chat not found'],
          [400, 'Bad Request: message to pin not found'],
          [400, 'Bad Request: message to unpin not found'],
          [400, 'Bad Request: message to unpin not found'],
          chatType === 'private' ? [200, true] : lacksRight,
          chatType === 'private' ? [200, true] : lacksRight,
        ],
        // The bot receives the service message of its own pin.
        chatType === 'private'
          ? [{
            messageId: accountMessageId + 2,
            fromId: bot.bot.id,
            pinnedMessageId: accountMessageId,
          }]
          : [],
      ],
      `Expected the ${chatType} pins to fail in Telegram's order`,
    );
  });

  Deno.test(`a bot that may pin in a ${chatType} chat pins, unpins and receives its pins`, async () => {
    const { api, sessionPath, ada, bot, chatId, accountMessageId, botMessageId, readUpdates } =
      await createChatScenario(chatType);
    if (chatType === 'supergroup') {
      await expectStatus(
        api,
        `${sessionPath}/accounts/${ada.id}/conversations/supergroup/${chatId}/administrators/${bot.bot.id}`,
        jsonRequest('PUT', { can_pin_messages: true }),
        204,
      );
      // The bot learns of its promotion first.
      await readUpdates(bot.botApiPath);
    }
    const adaPinnedMessagesPath = `${
      conversationPathOf(sessionPath, chatType, { accountId: ada.id, botId: bot.bot.id, chatId })
    }/pinned-messages`;
    const readPinnedMessage = async () => {
      const [, chat] = await describeCall(api, bot, 'getChat', { chat_id: chatId });
      return (chat as { pinned_message?: { message_id: number } }).pinned_message?.message_id;
    };

    const pinOutcomes = [
      await describeCall(api, bot, 'pinChatMessage', {
        chat_id: chatId,
        message_id: accountMessageId,
      }),
      await describeCall(api, bot, 'pinChatMessage', {
        chat_id: chatId,
        message_id: accountMessageId,
      }),
    ];
    const botPins = describePinUpdates(await readUpdates(bot.botApiPath));
    const serviceMessageId = botPins[0]?.messageId ?? 0;
    const refusals = [
      // The right is held, so a service message is refused for what it is.
      await describeCall(api, bot, 'pinChatMessage', {
        chat_id: chatId,
        message_id: serviceMessageId,
      }),
      await describeCall(api, bot, 'unpinChatMessage', {
        chat_id: chatId,
        message_id: serviceMessageId,
      }),
      await describeCall(api, bot, 'unpinChatMessage', {
        chat_id: chatId,
        message_id: botMessageId,
      }),
    ];
    const accountPin = await changePinAsAccount(
      api,
      'PUT',
      `${adaPinnedMessagesPath}/${botMessageId}`,
    );
    const accountPins = describePinUpdates(await readUpdates(bot.botApiPath));
    const pinnedMessageBeforeUnpins = await readPinnedMessage();
    const unpinNewest = await describeCall(api, bot, 'unpinChatMessage', { chat_id: chatId });
    const pinnedMessageAfterUnpin = await readPinnedMessage();
    const unpinAll = await describeCall(api, bot, 'unpinAllChatMessages', { chat_id: chatId });

    assertEquals(
      {
        pinOutcomes,
        botPins,
        refusals,
        accountPin,
        accountPins,
        pinnedMessageBeforeUnpins,
        unpinNewest,
        pinnedMessageAfterUnpin,
        unpinAll,
        pinnedMessageAtEnd: await readPinnedMessage(),
        updatesAtEnd: await readUpdates(bot.botApiPath),
      },
      {
        pinOutcomes: [[200, true], [400, 'Bad Request: CHAT_NOT_MODIFIED']],
        // Each pin's service message takes the chat's next ID: the bot's message box in a private
        // chat, the supergroup's own sequence in a supergroup.
        botPins: [{
          messageId: botMessageId + 1,
          fromId: bot.bot.id,
          pinnedMessageId: accountMessageId,
        }],
        refusals: [
          [400, "Bad Request: service messages can't be pinned"],
          [400, "Bad Request: service messages can't be pinned"],
          [400, 'Bad Request: CHAT_NOT_MODIFIED'],
        ],
        accountPin: [204],
        accountPins: [{
          messageId: botMessageId + 2,
          fromId: ada.id,
          pinnedMessageId: botMessageId,
        }],
        pinnedMessageBeforeUnpins: botMessageId,
        unpinNewest: [200, true],
        pinnedMessageAfterUnpin: accountMessageId,
        unpinAll: [200, true],
        pinnedMessageAtEnd: undefined,
        // Unpins record no service message.
        updatesAtEnd: [],
      },
      `Expected the bot to manage the ${chatType} pins`,
    );
  });

  Deno.test(`an account's pin in a ${chatType} chat reports the first of competing failures`, async () => {
    const { api, sessionPath, ada, bot, chatId, accountMessageId, botMessageId } =
      await createChatScenario(chatType);
    const linus = await createAccount(api, sessionPath, 'Linus');
    const pinnedMessagesPath = (accountId: number) =>
      `${
        conversationPathOf(sessionPath, chatType, { accountId, botId: bot.bot.id, chatId })
      }/pinned-messages`;
    /** The pinned messages of a chat Ada cannot address: one with an unknown bot, or an unknown supergroup. */
    const unaddressablePinnedMessagesPath = chatType === 'private'
      ? `${sessionPath}/accounts/${ada.id}/conversations/private/999999/pinned-messages`
      : `${sessionPath}/accounts/${ada.id}/conversations/supergroup/-1009999999999/pinned-messages`;
    const readPins = async (path: string) => {
      const { status, body } = await requestJson<{ messages?: unknown[]; reason?: string }>(
        api,
        'GET',
        path,
      );
      return status === 200 ? [status, body.messages?.length] : [status, body.reason];
    };

    const outcomes = [
      await changePinAsAccount(api, 'PUT', `${unaddressablePinnedMessagesPath}/999`),
      // Linus is no member of the supergroup; in a private chat he reaches his own empty chat.
      await changePinAsAccount(api, 'PUT', `${pinnedMessagesPath(linus.id)}/${botMessageId}`),
      await changePinAsAccount(api, 'PUT', `${pinnedMessagesPath(ada.id)}/999`),
      await changePinAsAccount(api, 'DELETE', `${pinnedMessagesPath(ada.id)}/999`),
      await changePinAsAccount(api, 'PUT', `${pinnedMessagesPath(ada.id)}/${accountMessageId}`),
      await changePinAsAccount(api, 'PUT', `${pinnedMessagesPath(ada.id)}/${accountMessageId}`),
      // The pin's service message took the chat's next ID.
      await changePinAsAccount(api, 'PUT', `${pinnedMessagesPath(ada.id)}/${botMessageId + 1}`),
      await changePinAsAccount(api, 'DELETE', `${pinnedMessagesPath(ada.id)}/${botMessageId}`),
      await changePinAsAccount(api, 'DELETE', `${pinnedMessagesPath(ada.id)}/${accountMessageId}`),
    ];
    const reads = [
      await readPins(unaddressablePinnedMessagesPath),
      await readPins(pinnedMessagesPath(linus.id)),
      await readPins(pinnedMessagesPath(ada.id)),
    ];

    assertEquals(
      { outcomes, reads },
      {
        outcomes: [
          [404, 'chat_not_found'],
          chatType === 'private' ? [404, 'message_not_found'] : [403, 'not_a_member'],
          [404, 'message_not_found'],
          [404, 'message_not_found'],
          [204],
          [409, 'message_already_pinned'],
          [400, 'service_message_not_pinnable'],
          [409, 'message_not_pinned'],
          [204],
        ],
        reads: [
          [404, 'chat_not_found'],
          chatType === 'private' ? [200, 0] : [403, 'not_a_member'],
          [200, 0],
        ],
      },
      `Expected the account's ${chatType} pins to fail in Telegram's order`,
    );
  });

  Deno.test(`a former participant of a ${chatType} chat is turned away before its message is looked up`, async () => {
    const { api, sessionPath, ada, bot, chatId, accountMessageId } = await createChatScenario(
      chatType,
    );
    const adaPinnedMessagesPath = `${
      conversationPathOf(sessionPath, chatType, { accountId: ada.id, botId: bot.bot.id, chatId })
    }/pinned-messages`;
    await changePinAsAccount(api, 'PUT', `${adaPinnedMessagesPath}/${accountMessageId}`);
    // Ada blocks the bot of her private chat, or removes the bot from her supergroup.
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

    const refusal = chatType === 'private'
      ? [403, 'Forbidden: bot was blocked by the user']
      : [403, 'Forbidden: bot was kicked from the supergroup chat'];
    assertEquals(
      [
        await describeCall(api, bot, 'pinChatMessage', { chat_id: chatId, message_id: 999 }),
        await describeCall(api, bot, 'unpinChatMessage', { chat_id: chatId }),
        await describeCall(api, bot, 'unpinAllChatMessages', { chat_id: chatId }),
        await changePinAsAccount(api, 'DELETE', `${adaPinnedMessagesPath}/${accountMessageId}`),
        (await requestJson<{ messages: unknown[] }>(api, 'GET', adaPinnedMessagesPath))
          .body.messages.length,
      ],
      [
        refusal,
        refusal,
        refusal,
        // A block keeps the account from writing to the bot; the owner keeps managing pins.
        chatType === 'private' ? [409, 'bot_blocked'] : [204],
        chatType === 'private' ? 1 : 0,
      ],
      `Expected the former ${chatType} participant to be turned away`,
    );
  });
}

Deno.test('a bot that left a supergroup is no member there to pin', async () => {
  const { api, bot, chatId, accountMessageId } = await createChatScenario('supergroup');
  await describeCall(api, bot, 'leaveChat', { chat_id: chatId });

  assertEquals(
    [
      await describeCall(api, bot, 'pinChatMessage', {
        chat_id: chatId,
        message_id: accountMessageId,
      }),
      await describeCall(api, bot, 'unpinAllChatMessages', { chat_id: chatId }),
    ],
    [
      [403, 'Forbidden: bot is not a member of the supergroup chat'],
      [403, 'Forbidden: bot is not a member of the supergroup chat'],
    ],
    'Expected the bot to be turned away as a former member',
  );
});

Deno.test("a private chat's message IDs name none of the bot's other private chats' messages", async () => {
  const { api, sessionPath, ada, grace, bot, chatId } = await createChatScenario('private');
  // Grace's first message takes the next ID of the bot's message box, which numbers every one of
  // the bot's private chats.
  const { body } = await requestJson<{ message: { message_id: number } }>(
    api,
    'POST',
    `${sessionPath}/accounts/${grace.id}/messages`,
    { to: { type: 'private', botId: bot.bot.id }, text: 'Hi' },
  );
  const graceMessageId = body.message.message_id;

  assertEquals(
    [
      await describeCall(api, bot, 'pinChatMessage', {
        chat_id: chatId,
        message_id: graceMessageId,
      }),
      await changePinAsAccount(
        api,
        'PUT',
        `${sessionPath}/accounts/${ada.id}/conversations/private/${bot.bot.id}/pinned-messages/${graceMessageId}`,
      ),
      await describeCall(api, bot, 'pinChatMessage', {
        chat_id: grace.id,
        message_id: graceMessageId,
      }),
    ],
    [
      [400, 'Bad Request: message to pin not found'],
      [404, 'message_not_found'],
      [200, true],
    ],
    "Expected each private chat to find only its own messages by the bot's IDs",
  );
});

Deno.test("a join request's contact grant lets a bot write to the requester, but not pin there", async () => {
  const { api, sessionPath, grace, bot } = await createJoinRequesterChatScenario();
  const promptId = await sendBotMessage(api, bot, {
    chat_id: grace.id,
    text: 'Press the button to join',
  });

  const pinsUnderGrant = [
    await describeCall(api, bot, 'pinChatMessage', { chat_id: grace.id, message_id: promptId }),
    await describeCall(api, bot, 'unpinChatMessage', { chat_id: grace.id }),
    await describeCall(api, bot, 'unpinAllChatMessages', { chat_id: grace.id }),
  ];
  // Grace's answer starts the chat, which lets the bot pin there.
  await requestJson(api, 'POST', `${sessionPath}/accounts/${grace.id}/messages`, {
    to: { type: 'private', botId: bot.bot.id },
    text: 'Done',
  });

  assertEquals(
    [
      pinsUnderGrant,
      await describeCall(api, bot, 'pinChatMessage', { chat_id: grace.id, message_id: promptId }),
    ],
    [
      [
        [400, 'Bad Request: chat not found'],
        [400, 'Bad Request: chat not found'],
        [400, 'Bad Request: chat not found'],
      ],
      [200, true],
    ],
    'Expected the grant to allow no pin until Grace started the chat',
  );
});
