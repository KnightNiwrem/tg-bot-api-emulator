/**
 * Message deletion as each chat type and each sender observes it: which of several competing
 * failures a deletion reports, which messages each sender may delete, that a deletion is all or
 * nothing, that deleted messages keep their IDs, and what a join request's contact grant does not
 * allow. Every table runs the same deletions in a private chat and in a supergroup.
 */
import { jsonRequest, requestJson } from '../support/emulation_api.ts';
import { createAccount, createBot } from '../support/http_fixtures.ts';
import {
  CHAT_TYPES,
  createChatScenario,
  createJoinRequesterChatScenario,
  describeCall,
  expectEqual,
  expectStatus,
  sendBotMessage,
} from '../support/chat_type_scenarios.ts';

for (const chatType of CHAT_TYPES) {
  Deno.test(`a bot's deletion in a ${chatType} chat reports the first of competing failures`, async () => {
    const { api, sessionPath, ada, bot, chatId, accountMessageId, botMessageId, readUpdates } =
      await createChatScenario(chatType);
    /** An ID of a chat the bot cannot reach: an unknown user, or an unknown supergroup. */
    const unreachableChatId = chatType === 'private' ? 999_999 : -1_009_999_999_999;
    const outsider = await createBot(api, sessionPath, 'outsider_bot');
    const historyPath = chatType === 'private'
      ? `${sessionPath}/accounts/${ada.id}/conversations/private/${bot.bot.id}/messages`
      : `${sessionPath}/accounts/${ada.id}/conversations/supergroup/${chatId}/messages`;
    const readMessageIds = async () =>
      (await requestJson<{ messages: Array<{ message_id: number }> }>(api, 'GET', historyPath))
        .body.messages.map(({ message_id }) => message_id);
    const messageIdsBefore = await readMessageIds();

    const outcomes = [
      // The chat is checked before the message.
      await describeCall(api, bot, 'deleteMessage', {
        chat_id: unreachableChatId,
        message_id: 999,
      }),
      await describeCall(api, outsider, 'deleteMessage', {
        chat_id: chatId,
        message_id: botMessageId,
      }),
      await describeCall(api, bot, 'deleteMessage', { chat_id: chatId, message_id: 999 }),
      // `deleteMessages` skips the IDs of no message of the chat.
      await describeCall(api, bot, 'deleteMessages', { chat_id: chatId, message_ids: [999] }),
      // A supergroup refuses another member's message to a bot without the right to delete it,
      // and then deletes none of the messages.
      await describeCall(api, bot, 'deleteMessages', {
        chat_id: chatId,
        message_ids: [botMessageId, accountMessageId, 999],
      }),
    ];
    const messageIdsAfter = await readMessageIds();

    expectEqual(
      [outcomes, messageIdsAfter, await readUpdates(bot.botApiPath)],
      [
        [
          [400, 'Bad Request: chat not found'],
          [400, 'Bad Request: chat not found'],
          [400, 'Bad Request: message to delete not found'],
          [200, true],
          chatType === 'private' ? [200, true] : [400, "Bad Request: message can't be deleted"],
        ],
        chatType === 'private'
          ? messageIdsBefore.filter((id) => id !== botMessageId && id !== accountMessageId)
          : messageIdsBefore,
        [],
      ],
      `Expected the ${chatType} deletions to fail in Telegram's order, sending no update`,
    );
  });

  Deno.test(`a deleted message of a ${chatType} chat keeps its ID, which no later message reuses`, async () => {
    const { api, bot, chatId, botMessageId } = await createChatScenario(chatType);

    const deletion = await describeCall(api, bot, 'deleteMessage', {
      chat_id: chatId,
      message_id: botMessageId,
    });
    const laterMessageId = await sendBotMessage(api, bot, { chat_id: chatId, text: 'Later' });

    expectEqual(
      [
        deletion,
        laterMessageId,
        await describeCall(api, bot, 'deleteMessage', {
          chat_id: chatId,
          message_id: botMessageId,
        }),
        await describeCall(api, bot, 'editMessageText', {
          chat_id: chatId,
          message_id: botMessageId,
          text: 'Changed',
        }),
      ],
      [
        [200, true],
        botMessageId + 1,
        [400, 'Bad Request: message to delete not found'],
        [400, 'Bad Request: message to edit not found'],
      ],
      `Expected the deleted ${chatType} message's ID to stay unused`,
    );
  });

  Deno.test(`an account's deletion in a ${chatType} chat reports the first of competing failures`, async () => {
    const {
      api,
      sessionPath,
      ada,
      grace,
      bot,
      botMessageId,
      accountMessageId,
      accountMessagesPath,
      sendAccountText,
      readUpdates,
    } = await createChatScenario(chatType);
    const linus = await createAccount(api, sessionPath, 'Linus');
    const deleteAsAccount = async (path: string) => {
      const response = await api.request(path, { method: 'DELETE' });
      return response.status === 204
        ? [204]
        : [response.status, ((await response.json()) as { reason: string }).reason];
    };
    const messagePath = (accountId: number, messageId: number) =>
      `${accountMessagesPath(accountId)}/${messageId}`;
    /** A message of a chat Ada cannot address: one with an unknown bot, or an unknown supergroup. */
    const unaddressableMessagePath = chatType === 'private'
      ? `${sessionPath}/accounts/${ada.id}/conversations/private/999999/messages/999`
      : `${sessionPath}/accounts/${ada.id}/conversations/supergroup/-1009999999999/messages/999`;
    const graceMessageId = chatType === 'private'
      ? undefined
      : await sendAccountText(grace.id, 'Hi team');
    await readUpdates(bot.botApiPath);

    const outcomes = [
      // The chat is checked before the message.
      await deleteAsAccount(unaddressableMessagePath),
      await deleteAsAccount(messagePath(linus.id, 999)),
      await deleteAsAccount(messagePath(ada.id, 999)),
      // Another chat's message is not found; another member's message is not deletable.
      await deleteAsAccount(messagePath(grace.id, accountMessageId)),
      // In a private chat, the account deletes either participant's message; in a supergroup, its
      // own, or any as the owner.
      await deleteAsAccount(messagePath(ada.id, botMessageId)),
      await deleteAsAccount(messagePath(ada.id, accountMessageId)),
      ...(graceMessageId === undefined ? [] : [
        await deleteAsAccount(messagePath(grace.id, graceMessageId)),
      ]),
    ];

    expectEqual(
      [outcomes, await readUpdates(bot.botApiPath)],
      [
        chatType === 'private'
          ? [
            [404, 'bot_not_found'],
            [404, 'message_not_found'],
            [404, 'message_not_found'],
            [404, 'message_not_found'],
            [204],
            [204],
          ]
          : [
            [404, 'chat_not_found'],
            [403, 'not_a_member'],
            [404, 'message_not_found'],
            [403, 'message_not_deletable'],
            [204],
            [204],
            [204],
          ],
        [],
      ],
      `Expected the account's ${chatType} deletions to fail in order, then succeed unseen`,
    );
  });
}

Deno.test("a supergroup lets a bot delete other members' messages only with the right to", async () => {
  const { api, sessionPath, ada, bot, chatId, accountMessageId, botMessageId } =
    await createChatScenario('supergroup');
  const ownerPath = `${sessionPath}/accounts/${ada.id}/conversations/supergroup/${chatId}`;
  const removedBot = await createBot(api, sessionPath, 'removed_bot');
  await expectStatus(api, `${ownerPath}/members/${removedBot.bot.id}`, { method: 'PUT' }, 204);
  const removedBotMessageId = await sendBotMessage(api, removedBot, {
    chat_id: chatId,
    text: 'Bye',
  });
  await expectStatus(api, `${ownerPath}/members/${removedBot.bot.id}`, { method: 'DELETE' }, 204);

  const refusal = await describeCall(api, bot, 'deleteMessage', {
    chat_id: chatId,
    message_id: accountMessageId,
  });
  await expectStatus(
    api,
    `${ownerPath}/administrators/${bot.bot.id}`,
    jsonRequest('PUT', { can_delete_messages: true }),
    204,
  );

  expectEqual(
    [
      refusal,
      // A former member is turned away before its message is looked at.
      await describeCall(api, removedBot, 'deleteMessage', {
        chat_id: chatId,
        message_id: removedBotMessageId,
      }),
      await describeCall(api, bot, 'deleteMessages', {
        chat_id: chatId,
        message_ids: [accountMessageId, botMessageId, removedBotMessageId, accountMessageId],
      }),
      await describeCall(api, bot, 'deleteMessage', {
        chat_id: chatId,
        message_id: accountMessageId,
      }),
    ],
    [
      [400, "Bad Request: message can't be deleted"],
      [403, 'Forbidden: bot was kicked from the supergroup chat'],
      [200, true],
      [400, 'Bad Request: message to delete not found'],
    ],
    'Expected the right to delete messages to let the bot delete any message',
  );
});

Deno.test('deleting the private message whose reply keyboard the account sees removes it', async () => {
  const { api, sessionPath, ada, bot, chatId } = await createChatScenario('private');
  const replyInterfacePath =
    `${sessionPath}/accounts/${ada.id}/conversations/private/${bot.bot.id}/reply-interface`;
  const readReplyInterface = async () =>
    (await requestJson<{ reply_interface: unknown }>(api, 'GET', replyInterfacePath)).body
      .reply_interface;
  const keyboardMessageId = await sendBotMessage(api, bot, {
    chat_id: chatId,
    text: 'Pick one',
    reply_markup: { keyboard: [[{ text: 'Cats' }]] },
  });
  const shownBefore = await readReplyInterface();

  await describeCall(api, bot, 'deleteMessage', { chat_id: chatId, message_id: keyboardMessageId });

  expectEqual(
    [(shownBefore as { message_id?: number } | null)?.message_id, await readReplyInterface()],
    [keyboardMessageId, null],
    'Expected the deleted message to take its reply keyboard with it',
  );
});

Deno.test("a join request's contact grant lets a bot write to the requester, but not delete there", async () => {
  const { api, sessionPath, grace, bot } = await createJoinRequesterChatScenario();
  const promptId = await sendBotMessage(api, bot, {
    chat_id: grace.id,
    text: 'Press the button to join',
  });

  const deletionUnderGrant = await describeCall(api, bot, 'deleteMessage', {
    chat_id: grace.id,
    message_id: promptId,
  });
  // Grace's answer starts the chat, which lets the bot delete there.
  await requestJson(api, 'POST', `${sessionPath}/accounts/${grace.id}/messages`, {
    to: { type: 'private', botId: bot.bot.id },
    text: 'Done',
  });

  expectEqual(
    [
      deletionUnderGrant,
      await describeCall(api, bot, 'deleteMessage', { chat_id: grace.id, message_id: promptId }),
    ],
    [[400, 'Bad Request: chat not found'], [200, true]],
    'Expected the grant to allow no deletion until Grace started the chat',
  );
});
