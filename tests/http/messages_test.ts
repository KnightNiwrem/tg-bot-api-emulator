import { Bot } from 'https://cdn.jsdelivr.net/gh/grammyjs/grammY@^1.46.0/src/bot.ts';
import {
  InlineKeyboard,
} from 'https://cdn.jsdelivr.net/gh/grammyjs/grammY@^1.46.0/src/convenience/keyboard.ts';
import { GrammyError } from 'https://cdn.jsdelivr.net/gh/grammyjs/grammY@^1.46.0/src/core/error.ts';

import { MAX_TELEGRAM_USER_ID } from '../../src/types/telegram_identity.ts';
import { createTestSession, jsonRequest, TEST_PUBLIC_ORIGIN } from '../support/emulation_api.ts';
import { expectSettlementWithin } from '../support/settlement.ts';
import {
  isBadRequestResponse,
  isGetUpdatesResponse,
  isMessageHistoryResponse,
  isPrivateMessage,
  isSentMessageResponse,
  type TestPrivateMessage,
} from '../support/http_response_guards.ts';
import {
  botApiResult,
  callBotApi,
  createUpdateReader,
  photoSizeOf,
} from '../support/bot_api_requests.ts';
import {
  createAccount,
  createBot,
  createPrivateConversationFixture,
  createSupergroupFixture,
} from '../support/http_fixtures.ts';
import { FIXED_WALL_CLOCK } from '../support/fixed_wall_clock.ts';
import { gifImage } from '../support/media_samples.ts';

Deno.test('sendMessage replies only in private chats the account has started', async () => {
  const { api, botApiPath, createdBot, createdAccount, sendText } =
    await createPrivateConversationFixture();
  const sendMessage = async (parameters: Record<string, unknown>) => {
    const response = await api.request(`${botApiPath}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(parameters),
    });
    return { status: response.status, body: (await response.json()) as unknown };
  };
  const expectBadRequest = async (
    parameters: Record<string, unknown>,
    expectedDescription?: string,
  ) => {
    const { status, body } = await sendMessage(parameters);
    if (
      status !== 400 || !isBadRequestResponse(body) ||
      (expectedDescription !== undefined && body.description !== expectedDescription)
    ) {
      throw new Error(
        `Expected ${JSON.stringify(parameters)} to be rejected with ${
          expectedDescription ?? 'a bad request'
        }, received ${status} ${JSON.stringify(body)}`,
      );
    }
  };
  const accountId = createdAccount.account.id;

  await expectBadRequest({ chat_id: accountId, text: 'Hello' }, 'Bad Request: chat not found');
  await sendText('Hi');

  const { status, body } = await sendMessage({ chat_id: accountId, text: 'Try /help' });
  if (
    status !== 200 ||
    typeof body !== 'object' || body === null ||
    !('ok' in body) || body.ok !== true ||
    !('result' in body) || !isPrivateMessage(body.result)
  ) {
    throw new Error(`Expected sendMessage to succeed, received ${status}`);
  }
  const reply = body.result;
  if (
    reply.message_id !== 2 ||
    reply.chat.id !== accountId ||
    JSON.stringify(reply.from) !==
      JSON.stringify({
        id: createdBot.bot.id,
        is_bot: true,
        first_name: 'Test Bot',
        username: 'test_bot',
      }) ||
    reply.text !== 'Try /help'
  ) {
    throw new Error("Expected the sent message in the bot's private chat with the account");
  }

  await expectBadRequest({ text: '' }, 'Bad Request: message text is empty');
  await expectBadRequest({ text: 'Hello' }, 'Bad Request: chat_id is empty');
  await expectBadRequest({ chat_id: accountId }, 'Bad Request: message text is empty');
  await expectBadRequest({ chat_id: 999, text: 'Hello' }, 'Bad Request: chat not found');
  await expectBadRequest(
    { chat_id: createdBot.bot.id, text: 'Hello' },
    'Bad Request: chat not found',
  );
  await expectBadRequest({ chat_id: -1, text: 'Hello' }, 'Bad Request: chat not found');
  await expectBadRequest(
    { chat_id: accountId, text: 'x'.repeat(4_097) },
    'Bad Request: message is too long',
  );
  await expectBadRequest({ chat_id: '@ada', text: 'Hello' });
  await expectBadRequest({ chat_id: accountId, text: 'Hello', message_thread_id: '1' });

  const updatesResponse = await api.request(`${botApiPath}/getUpdates`);
  const updatesBody: unknown = await updatesResponse.json();
  if (
    !isGetUpdatesResponse(updatesBody) ||
    JSON.stringify(updatesBody.result.map((update) => update.message.text)) !==
      JSON.stringify(['Hi'])
  ) {
    throw new Error('Expected the bot to receive no update for its own message');
  }
});

Deno.test('deleteMessage and deleteMessages follow Telegram checks', async () => {
  const { api, sessionPath, botApiPath, createdBot, createdAccount, sendText } =
    await createPrivateConversationFixture();
  await sendText('/start');
  const accountId = createdAccount.account.id;
  const sendReply = async (text: string) => {
    const reply = await callBotApi(api, `${botApiPath}/sendMessage`, { chat_id: accountId, text });
    const messageId = botApiResult(reply.body)?.message_id;
    if (typeof messageId !== 'number') {
      throw new Error(`Expected "${text}" to be sent, received ${JSON.stringify(reply.body)}`);
    }
    return messageId;
  };
  const firstReplyId = await sendReply('First');
  const secondReplyId = await sendReply('Second');
  const expectDeletionFailure = async (
    method: string,
    parameters: Record<string, unknown>,
    expectedDescription: string,
  ) => {
    const { status, body } = await callBotApi(api, `${botApiPath}/${method}`, parameters);
    if (status !== 400 || !isBadRequestResponse(body) || body.description !== expectedDescription) {
      throw new Error(
        `Expected ${method} ${JSON.stringify(parameters)} to fail with ${expectedDescription}, ` +
          `received ${status} ${JSON.stringify(body)}`,
      );
    }
  };
  const expectDeletion = async (method: string, parameters: Record<string, unknown>) => {
    const { status, body } = await callBotApi(api, `${botApiPath}/${method}`, parameters);
    if (status !== 200 || JSON.stringify(body) !== JSON.stringify({ ok: true, result: true })) {
      throw new Error(
        `Expected ${method} ${JSON.stringify(parameters)} to succeed, ` +
          `received ${status} ${JSON.stringify(body)}`,
      );
    }
  };
  const expectHistoryTexts = async (expectedTexts: readonly string[]) => {
    const historyBody: unknown = await (await api.request(
      `${sessionPath}/accounts/${accountId}/conversations/private/${createdBot.bot.id}/messages`,
    )).json();
    const texts = isMessageHistoryResponse(historyBody)
      ? historyBody.messages.map((message) => message.text)
      : [];
    if (JSON.stringify(texts) !== JSON.stringify(expectedTexts)) {
      throw new Error(`Expected history ${JSON.stringify(expectedTexts)}, received ${texts}`);
    }
  };

  await expectDeletionFailure(
    'deleteMessage',
    { message_id: firstReplyId },
    'Bad Request: chat_id is empty',
  );
  await expectDeletionFailure('deleteMessage', { chat_id: 999 }, 'Bad Request: chat not found');
  await expectDeletionFailure(
    'deleteMessage',
    { chat_id: accountId },
    'Bad Request: message to delete not found',
  );
  await expectDeletionFailure(
    'deleteMessage',
    { chat_id: accountId, message_id: 999 },
    'Bad Request: message to delete not found',
  );
  await expectDeletionFailure(
    'deleteMessage',
    { chat_id: accountId, message_id: 'first' },
    'Bad Request: invalid deleteMessage parameters',
  );
  await expectDeletionFailure(
    'deleteMessages',
    { chat_id: 999 },
    'Bad Request: message identifiers are not specified',
  );
  await expectDeletionFailure(
    'deleteMessages',
    { chat_id: 999, message_ids: Array.from({ length: 101 }, (_, index) => index + 1) },
    'Bad Request: too many message identifiers specified',
  );
  await expectDeletionFailure(
    'deleteMessages',
    { chat_id: 999, message_ids: [firstReplyId, 0] },
    'Bad Request: invalid message identifier specified',
  );
  await expectDeletionFailure(
    'deleteMessages',
    { message_ids: [firstReplyId] },
    'Bad Request: chat_id is empty',
  );
  await expectDeletionFailure(
    'deleteMessages',
    { chat_id: 999, message_ids: [firstReplyId] },
    'Bad Request: chat not found',
  );
  await expectDeletionFailure(
    'deleteMessages',
    { chat_id: accountId, message_ids: ['1'] },
    'Bad Request: invalid deleteMessages parameters',
  );
  await expectHistoryTexts(['/start', 'First', 'Second']);

  // A bot can delete the account's messages in their private chat, not only its own.
  await expectDeletion('deleteMessage', { chat_id: accountId, message_id: 1 });
  await expectHistoryTexts(['First', 'Second']);
  await expectDeletion('deleteMessages', {
    chat_id: accountId,
    message_ids: [1, firstReplyId, 999],
  });
  await expectHistoryTexts(['Second']);
  await expectDeletionFailure(
    'deleteMessage',
    { chat_id: accountId, message_id: firstReplyId },
    'Bad Request: message to delete not found',
  );
  await expectDeletionFailure(
    'editMessageText',
    { chat_id: accountId, message_id: firstReplyId, text: 'Edited' },
    'Bad Request: message to edit not found',
  );

  const formEncodedDeletion = await api.request(`${botApiPath}/deleteMessages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      chat_id: String(accountId),
      message_ids: JSON.stringify([secondReplyId]),
    }),
  });
  if (formEncodedDeletion.status !== 200) {
    throw new Error(
      `Expected a form-encoded deleteMessages to succeed, received ${formEncodedDeletion.status}`,
    );
  }
  await expectHistoryTexts([]);
});

Deno.test('a grammY bot deletes an incoming secret and its menu after a button press', async () => {
  const { api, sessionPath, createdBot, createdAccount, sendText } =
    await createPrivateConversationFixture();
  const accountId = createdAccount.account.id;
  const historyPath =
    `${sessionPath}/accounts/${accountId}/conversations/private/${createdBot.bot.id}/messages`;
  const grammyBot = new Bot(createdBot.token, {
    client: {
      apiRoot: `${TEST_PUBLIC_ORIGIN}${sessionPath}/bot-api`,
      fetch: api.fetch,
    },
  });
  const menuSent = Promise.withResolvers<number>();
  const choiceHandled = Promise.withResolvers<void>();
  grammyBot.command('password', async (context) => {
    await context.deleteMessage();
    const menu = await context.reply('Password stored. Keep it?', {
      reply_markup: new InlineKeyboard().text('Keep', 'keep').text('Forget', 'forget'),
    });
    menuSent.resolve(menu.message_id);
  });
  grammyBot.callbackQuery('forget', async (context) => {
    await context.answerCallbackQuery({ text: 'Forgotten' });
    await context.deleteMessage();
    await context.reply('Password forgotten.');
    choiceHandled.resolve();
  });
  const polling = grammyBot.start();

  try {
    await sendText('/password hunter2');
    // Polling ends only when stopped, so settling first means startup failed.
    const menuMessageId = await Promise.race([menuSent.promise, polling.then(() => undefined)]);
    const pressForget = () =>
      api.request(`${sessionPath}/accounts/${accountId}/callback-queries`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat: { type: 'private', botId: createdBot.bot.id },
          message_id: menuMessageId,
          callback_data: 'forget',
        }),
      });
    const pressResponse = await pressForget();
    if (pressResponse.status !== 201) {
      throw new Error(`Expected the button press to be accepted, received ${pressResponse.status}`);
    }
    await expectSettlementWithin(
      choiceHandled.promise,
      5_000,
      'Expected the bot to handle the button press',
    );

    const historyBody: unknown = await (await api.request(historyPath)).json();
    const texts = isMessageHistoryResponse(historyBody)
      ? historyBody.messages.map((message) => message.text)
      : undefined;
    if (JSON.stringify(texts) !== JSON.stringify(['Password forgotten.'])) {
      throw new Error(
        `Expected only the final reply to remain, received ${JSON.stringify(historyBody)}`,
      );
    }
    const pressOnDeletedMenu = await pressForget();
    if (pressOnDeletedMenu.status !== 404) {
      throw new Error(
        `Expected a press on the deleted menu to find no message, received ${pressOnDeletedMenu.status}`,
      );
    }
  } finally {
    await grammyBot.stop();
    await polling;
  }
});

Deno.test('private message routes validate participants and request bodies', async () => {
  const { api, sessionPath } = await createTestSession();
  const account = await createAccount(api, sessionPath, 'Ada');

  const missingBotResponse = await api.request(
    `${sessionPath}/accounts/${account.id}/messages`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: { type: 'private', botId: 999 }, text: 'Hello' }),
    },
  );
  const emptyTextResponse = await api.request(
    `${sessionPath}/accounts/${account.id}/messages`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: { type: 'private', botId: 999 }, text: '' }),
    },
  );
  // The text limit counts characters, so 4,096 emoji fit though they take 8,192 UTF-16 code units.
  const sendEmojiText = (emojiCount: number) =>
    api.request(`${sessionPath}/accounts/${account.id}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: { type: 'private', botId: 999 }, text: '😀'.repeat(emojiCount) }),
    });
  const longestEmojiTextResponse = await sendEmojiText(4_096);
  const tooLongEmojiTextResponse = await sendEmojiText(4_097);
  const highestValidAccountIdResponse = await api.request(
    `${sessionPath}/accounts/${MAX_TELEGRAM_USER_ID}/messages`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        to: { type: 'private', botId: MAX_TELEGRAM_USER_ID },
        text: 'Hello',
      }),
    },
  );
  const excessiveAccountIdResponse = await api.request(
    `${sessionPath}/accounts/${MAX_TELEGRAM_USER_ID + 1}/messages`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: { type: 'private', botId: 999 }, text: 'Hello' }),
    },
  );
  const excessiveBotIdResponse = await api.request(
    `${sessionPath}/accounts/${account.id}/messages`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        to: { type: 'private', botId: MAX_TELEGRAM_USER_ID + 1 },
        text: 'Hello',
      }),
    },
  );

  if (
    missingBotResponse.status !== 404 ||
    emptyTextResponse.status !== 400 ||
    longestEmojiTextResponse.status !== 404 ||
    tooLongEmojiTextResponse.status !== 400 ||
    highestValidAccountIdResponse.status !== 404 ||
    excessiveAccountIdResponse.status !== 400 ||
    excessiveBotIdResponse.status !== 400
  ) {
    throw new Error('Expected message routes to distinguish missing participants from bad input');
  }
});

Deno.test('accounts see the chat action a bot shows until its next message', async () => {
  const { api, sessionPath, botApiPath, createdBot, createdAccount, sendText } =
    await createPrivateConversationFixture();
  const accountId = createdAccount.account.id;
  const chatActionsPath =
    `${sessionPath}/accounts/${accountId}/conversations/private/${createdBot.bot.id}/chat-actions`;
  const shownActions = async () => (await api.request(chatActionsPath)).json();
  await sendText('Hi');

  const actionResponse = await callBotApi(api, `${botApiPath}/sendChatAction`, {
    chat_id: accountId,
    action: 'UPLOAD_PHOTO',
  });
  const whileUploading = await shownActions();
  await callBotApi(api, `${botApiPath}/sendMessage`, { chat_id: accountId, text: 'Done' });
  const afterMessage = await shownActions();
  const unknownBotResponse = await api.request(
    `${sessionPath}/accounts/${accountId}/conversations/private/999/chat-actions`,
  );
  if (
    actionResponse.status !== 200 ||
    JSON.stringify(whileUploading) !==
      JSON.stringify({ chat_actions: [{ bot_id: createdBot.bot.id, action: 'upload_photo' }] }) ||
    JSON.stringify(afterMessage) !== JSON.stringify({ chat_actions: [] }) ||
    unknownBotResponse.status !== 404
  ) {
    throw new Error(
      `Expected the action until the bot's message, received ${
        JSON.stringify([whileUploading, afterMessage])
      }`,
    );
  }
});

Deno.test('accounts see which bot messages notify them silently', async () => {
  const { api, sessionPath, owner, member, bot, supergroup, supergroupPath, sendSupergroupText } =
    await createSupergroupFixture();
  await api.request(
    `${sessionPath}/accounts/${owner.id}/messages`,
    jsonRequest('POST', { to: { type: 'private', botId: bot.bot.id }, text: '/start' }),
  );
  const call = async (method: string, parameters: Record<string, unknown>) =>
    await callBotApi(api, `${bot.botApiPath}/${method}`, parameters);
  const loud = botApiResult((await call('sendMessage', { chat_id: owner.id, text: 'Loud' })).body);
  const quiet = botApiResult(
    (await call('sendMessage', {
      chat_id: owner.id,
      text: 'Quiet',
      disable_notification: true,
    })).body,
  );
  const quietCopies = botApiResult(
    (await call('copyMessages', {
      chat_id: owner.id,
      from_chat_id: owner.id,
      message_ids: [loud?.message_id],
      disable_notification: true,
    })).body,
  ) as unknown as Array<{ message_id: number }> | undefined;
  const memberMessage = await sendSupergroupText(member.id, 'Hi');
  const quietForward = botApiResult(
    (await call('forwardMessage', {
      chat_id: supergroup.id,
      from_chat_id: supergroup.id,
      message_id: memberMessage.message_id,
      disable_notification: 'true',
    })).body,
  );
  const invalid = await call('sendMessage', {
    chat_id: owner.id,
    text: 'Maybe',
    disable_notification: 'maybe',
  });

  const privateNotifications = await (await api.request(
    `${sessionPath}/accounts/${owner.id}/conversations/private/${bot.bot.id}/notifications`,
  )).json();
  const memberNotifications = await (await api.request(
    `${supergroupPath(member.id)}/notifications`,
  )).json() as { notifications: Array<{ message_id: number; is_silent: boolean }> };
  const outsider = await createAccount(api, sessionPath, 'Linus');
  const outsiderResponse = await api.request(`${supergroupPath(outsider.id)}/notifications`);
  if (
    invalid.status !== 400 || outsiderResponse.status !== 403 ||
    JSON.stringify(privateNotifications) !== JSON.stringify({
        notifications: [
          { message_id: loud?.message_id, is_silent: false },
          { message_id: quiet?.message_id, is_silent: true },
          { message_id: quietCopies?.[0]?.message_id, is_silent: true },
        ],
      }) ||
    // The member's own message gives it no notification.
    JSON.stringify(memberNotifications.notifications.slice(-1)) !==
      JSON.stringify([{ message_id: quietForward?.message_id, is_silent: true }]) ||
    memberNotifications.notifications.some(({ message_id }) =>
      message_id === memberMessage.message_id
    )
  ) {
    throw new Error(
      `Expected silent notifications for silent messages only, received ${
        JSON.stringify({
          invalidStatus: invalid.status,
          outsiderStatus: outsiderResponse.status,
          privateNotifications,
          memberNotifications,
        })
      }`,
    );
  }
});

Deno.test('sendChatAction accepts Telegram actions in started private chats', async () => {
  const { api, botApiPath, createdAccount, sendText } = await createPrivateConversationFixture();
  const accountId = createdAccount.account.id;
  const sendChatAction = (parameters: Record<string, unknown>) =>
    callBotApi(api, `${botApiPath}/sendChatAction`, parameters);
  const expectDescription = async (parameters: Record<string, unknown>, expected: string) => {
    const { status, body } = await sendChatAction(parameters);
    if (status !== 400 || !isBadRequestResponse(body) || body.description !== expected) {
      throw new Error(
        `Expected ${JSON.stringify(parameters)} to fail with ${expected}, received ${
          JSON.stringify(body)
        }`,
      );
    }
  };

  await expectDescription({ chat_id: accountId, action: 'typing' }, 'Bad Request: chat not found');
  await sendText('Hi');
  for (const action of ['typing', 'UPLOAD_PHOTO', 'record_audio', 'cancel']) {
    const { status, body } = await sendChatAction({ chat_id: accountId, action });
    if (status !== 200 || JSON.stringify(body) !== JSON.stringify({ ok: true, result: true })) {
      throw new Error(
        `Expected ${action} to be accepted, received ${status} ${JSON.stringify(body)}`,
      );
    }
  }
  // Telegram reads the action before the chat.
  await expectDescription({ action: 'dancing' }, 'Bad Request: wrong parameter action in request');
  await expectDescription({ chat_id: accountId }, 'Bad Request: wrong parameter action in request');
  await expectDescription({ action: 'typing' }, 'Bad Request: chat_id is empty');
  await expectDescription(
    { chat_id: accountId, action: 'typing', message_thread_id: 1 },
    'Bad Request: invalid sendChatAction parameters',
  );
});

Deno.test('sendMessage replies to messages of the chat and accepts Telegram message options', async () => {
  const { api, sessionPath, botApiPath, createdBot, createdAccount, sendText } =
    await createPrivateConversationFixture();
  const accountId = createdAccount.account.id;
  await sendText('Question?');
  const sendMessage = (parameters: Record<string, unknown>) =>
    callBotApi(api, `${botApiPath}/sendMessage`, {
      chat_id: accountId,
      text: 'Answer',
      ...parameters,
    });
  const repliedMessageIdOf = (body: unknown) => {
    const replyToMessage = botApiResult(body)?.reply_to_message;
    return typeof replyToMessage === 'object' && replyToMessage !== null
      ? (replyToMessage as Record<string, unknown>).message_id
      : undefined;
  };

  const reply = await sendMessage({
    reply_parameters: { message_id: 1, chat_id: accountId },
    protect_content: true,
    disable_notification: true,
    link_preview_options: { is_disabled: true },
  });
  const replyResult = botApiResult(reply.body);
  if (
    reply.status !== 200 || repliedMessageIdOf(reply.body) !== 1 ||
    (replyResult?.reply_to_message as Record<string, unknown>).text !== 'Question?' ||
    replyResult?.has_protected_content !== true || 'link_preview_options' in replyResult
  ) {
    throw new Error(
      `Expected a protected reply to the question, received ${JSON.stringify(reply)}`,
    );
  }
  const olderFormReply = await api.request(`${botApiPath}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      chat_id: String(accountId),
      text: 'Answer',
      reply_to_message_id: '1',
      disable_web_page_preview: 'true',
    }),
  });
  if (repliedMessageIdOf(await olderFormReply.json()) !== 1) {
    throw new Error('Expected reply_to_message_id to reply as Telegram still allows');
  }
  const replyParametersWithoutReply = await sendMessage({
    reply_parameters: {},
    reply_to_message_id: 1,
  });
  const replyToMissingMessageWithoutReply = await sendMessage({
    reply_parameters: { message_id: 99, allow_sending_without_reply: true },
  });
  if (
    replyParametersWithoutReply.status !== 200 ||
    repliedMessageIdOf(replyParametersWithoutReply.body) !== undefined ||
    replyToMissingMessageWithoutReply.status !== 200 ||
    repliedMessageIdOf(replyToMissingMessageWithoutReply.body) !== undefined
  ) {
    throw new Error('Expected reply_parameters to override the older form and allow no reply');
  }

  const quotedReply = await sendMessage({
    reply_parameters: {
      message_id: 1,
      quote: 'Question',
      quote_parse_mode: 'HTML',
      quote_position: 3,
    },
  });
  const quoteResult = botApiResult(quotedReply.body)?.quote;
  if (
    quotedReply.status !== 200 || repliedMessageIdOf(quotedReply.body) !== 1 ||
    JSON.stringify(quoteResult) !==
      JSON.stringify({ text: 'Question', position: 0, is_manual: true })
  ) {
    throw new Error(
      `Expected a reply with a chosen quote, received ${JSON.stringify(quotedReply)}`,
    );
  }

  const rejections: [Record<string, unknown>, string][] = [
    [{ reply_parameters: { message_id: 99 } }, 'Bad Request: message to be replied not found'],
    // The chat is checked before the replied message.
    [
      { chat_id: 999, reply_parameters: { message_id: 99 } },
      'Bad Request: chat not found',
    ],
    // The replied message's chat must be one the bot can read.
    [
      { reply_parameters: { message_id: 1, chat_id: createdBot.bot.id } },
      'Bad Request: chat not found',
    ],
    // A quote must be an exact part of the replied text.
    [
      { reply_parameters: { message_id: 1, quote: 'question' } },
      'Bad Request: QUOTE_TEXT_INVALID',
    ],
    // Its formatting is read before the chat.
    [
      {
        chat_id: 999,
        reply_parameters: { message_id: 1, quote: '*x', quote_parse_mode: 'Markdown' },
      },
      "Bad Request: can't parse entities: Can't find end of the entity starting at byte offset 0",
    ],
    [
      { reply_parameters: { message_id: 1, checklist_task_id: 1 } },
      'Bad Request: invalid sendMessage parameters',
    ],
    [
      { link_preview_options: { is_disabled: 'yes' } },
      'Bad Request: invalid sendMessage parameters',
    ],
  ];
  for (const [parameters, expectedDescription] of rejections) {
    const { status, body } = await sendMessage(parameters);
    if (status !== 400 || !isBadRequestResponse(body) || body.description !== expectedDescription) {
      throw new Error(
        `Expected ${JSON.stringify(parameters)} to fail with ${expectedDescription}, received ${
          JSON.stringify(body)
        }`,
      );
    }
  }

  const accountMessagesPath = `${sessionPath}/accounts/${accountId}/messages`;
  const sendAccountReply = (replyToMessageId: number) =>
    api.request(accountMessagesPath, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        to: { type: 'private', botId: createdBot.bot.id },
        text: 'Thanks',
        reply_to_message_id: replyToMessageId,
      }),
    });
  // The replied message never shows its own reply.
  const { reply_to_message: _, ...repliedBotMessage } = replyResult;
  const accountReply = await sendAccountReply(2);
  const accountReplyBody: unknown = await accountReply.json();
  const missingReplyTarget = await sendAccountReply(99);
  if (
    accountReply.status !== 201 || !isSentMessageResponse(accountReplyBody) ||
    JSON.stringify(accountReplyBody.message) !==
      JSON.stringify({ ...accountReplyBody.message, reply_to_message: repliedBotMessage }) ||
    missingReplyTarget.status !== 400
  ) {
    throw new Error("Expected the account to reply only to its chat's messages");
  }
  const updatesBody: unknown = await (await api.request(`${botApiPath}/getUpdates`)).json();
  const updatedMessage = isGetUpdatesResponse(updatesBody)
    ? updatesBody.result.at(-1)?.message
    : undefined;
  if (JSON.stringify(updatedMessage) !== JSON.stringify(accountReplyBody.message)) {
    throw new Error('Expected the bot to receive the account reply with the replied message');
  }
});

Deno.test('a grammY bot asks a question in a reply and reads the account reply to it', async () => {
  const { api, sessionPath, createdBot, createdAccount, sendText } =
    await createPrivateConversationFixture();
  const grammyBot = new Bot(createdBot.token, {
    client: {
      apiRoot: `${TEST_PUBLIC_ORIGIN}${sessionPath}/bot-api`,
      fetch: api.fetch,
    },
  });
  const questionAsked = Promise.withResolvers<number>();
  const greeted = Promise.withResolvers<void>();
  grammyBot.command('start', async (context) => {
    const question = await context.reply('What is your name?', {
      reply_parameters: { message_id: context.msg.message_id },
      link_preview_options: { is_disabled: true },
    });
    questionAsked.resolve(question.message_id);
  });
  grammyBot.on('message:text', async (context) => {
    if (context.msg.reply_to_message?.message_id !== await questionAsked.promise) {
      return;
    }
    await context.reply(`Nice to meet you, ${context.msg.text}!`, { protect_content: true });
    greeted.resolve();
  });
  const polling = grammyBot.start();

  try {
    await sendText('/start');
    // Polling ends only when stopped, so settling first means the bot failed.
    const questionMessageId = await Promise.race([questionAsked.promise, polling]);
    const answer = await api.request(
      `${sessionPath}/accounts/${createdAccount.account.id}/messages`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: { type: 'private', botId: createdBot.bot.id },
          text: 'Ada',
          reply_to_message_id: questionMessageId,
        }),
      },
    );
    if (answer.status !== 201) {
      throw new Error(`Expected the account reply to be accepted, received ${answer.status}`);
    }
    await Promise.race([greeted.promise, polling]);
  } finally {
    await grammyBot.stop();
    await polling;
  }

  const historyBody: unknown = await (await api.request(
    `${sessionPath}/accounts/${createdAccount.account.id}/conversations/private/${createdBot.bot.id}/messages`,
  )).json();
  const history = isMessageHistoryResponse(historyBody)
    ? historyBody.messages.map((message) => {
      const { text, reply_to_message, has_protected_content } = message as
        & TestPrivateMessage
        & {
          reply_to_message?: { text: string };
          has_protected_content?: true;
        };
      return [text, reply_to_message?.text ?? null, has_protected_content ?? false];
    })
    : undefined;
  if (
    JSON.stringify(history) !==
      JSON.stringify([
        ['/start', null, false],
        ['What is your name?', '/start', false],
        ['Ada', 'What is your name?', false],
        ['Nice to meet you, Ada!', null, true],
      ])
  ) {
    throw new Error(
      `Expected the question and answer as replies, received ${JSON.stringify(history)}`,
    );
  }
});

Deno.test('an account blocks a bot, which receives my_chat_member updates and Telegram 403s', async () => {
  const { api, sessionPath, botApiPath, createdBot, createdAccount, sendText } =
    await createPrivateConversationFixture();
  const accountId = createdAccount.account.id;
  const accountPath = `${sessionPath}/accounts/${accountId}`;
  const blockedBotPath = `${accountPath}/blocked-bots/${createdBot.bot.id}`;
  await sendText('/start');
  const keyboardReply = await callBotApi(api, `${botApiPath}/sendMessage`, {
    chat_id: accountId,
    text: 'Menu',
    reply_markup: { keyboard: [['Help']] },
  });
  if (keyboardReply.status !== 200) {
    throw new Error(`Expected the menu to be sent, received ${keyboardReply.status}`);
  }

  for (const _ of [1, 2]) {
    const blockResponse = await api.request(blockedBotPath, { method: 'PUT' });
    if (blockResponse.status !== 204) {
      throw new Error(`Expected blocking to succeed, received ${blockResponse.status}`);
    }
  }
  const blockedDescription = {
    ok: false,
    error_code: 403,
    description: 'Forbidden: bot was blocked by the user',
  };
  for (
    const [method, parameters] of [
      ['sendMessage', { chat_id: accountId, text: 'Still there?' }],
      ['sendChatAction', { chat_id: accountId, action: 'typing' }],
    ] as const
  ) {
    const { status, body } = await callBotApi(api, `${botApiPath}/${method}`, parameters);
    if (status !== 403 || JSON.stringify(body) !== JSON.stringify(blockedDescription)) {
      throw new Error(`Expected ${method} to be forbidden, received ${JSON.stringify(body)}`);
    }
  }
  const accountWrites = [
    await api.request(`${accountPath}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: { type: 'private', botId: createdBot.bot.id }, text: 'Hi' }),
    }),
    await api.request(`${accountPath}/reply-keyboard-presses`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat: { type: 'private', botId: createdBot.bot.id }, text: 'Help' }),
    }),
  ];
  if (accountWrites.some((response) => response.status !== 409)) {
    throw new Error(
      `Expected the account to write only after unblocking, received ${
        accountWrites.map((response) => response.status)
      }`,
    );
  }

  for (const _ of [1, 2]) {
    const unblockResponse = await api.request(blockedBotPath, { method: 'DELETE' });
    if (unblockResponse.status !== 204) {
      throw new Error(`Expected unblocking to succeed, received ${unblockResponse.status}`);
    }
  }
  const welcomeBack = await callBotApi(api, `${botApiPath}/sendMessage`, {
    chat_id: accountId,
    text: 'Welcome back',
  });
  if (welcomeBack.status !== 200) {
    throw new Error(`Expected the bot to write once unblocked, received ${welcomeBack.status}`);
  }

  const { body: updatesBody } = await callBotApi(api, `${botApiPath}/getUpdates`, {});
  const updates = (updatesBody as { result: Array<Record<string, unknown>> }).result;
  const botUser = {
    id: createdBot.bot.id,
    is_bot: true,
    first_name: 'Test Bot',
    username: 'test_bot',
  };
  const memberChanges = updates.slice(1).map(({ my_chat_member }) => {
    const { chat, from, old_chat_member, new_chat_member } = my_chat_member as Record<
      string,
      Record<string, unknown>
    >;
    return [chat.id, from.id, old_chat_member, new_chat_member];
  });
  const member = { user: botUser, status: 'member' };
  const kicked = { user: botUser, status: 'kicked', until_date: 0 };
  if (
    updates.length !== 3 ||
    JSON.stringify(memberChanges) !== JSON.stringify([
        [accountId, accountId, member, kicked],
        [accountId, accountId, kicked, member],
      ])
  ) {
    throw new Error(`Expected one update per block change, received ${JSON.stringify(updates)}`);
  }

  const invalidRequests = [
    [`${accountPath}/blocked-bots/${MAX_TELEGRAM_USER_ID}`, 'PUT', 404],
    [
      `${sessionPath}/accounts/${MAX_TELEGRAM_USER_ID}/blocked-bots/${createdBot.bot.id}`,
      'PUT',
      404,
    ],
    [`${accountPath}/blocked-bots/${accountId}`, 'DELETE', 404],
    [`${accountPath}/blocked-bots/bot`, 'PUT', 400],
  ] as const;
  for (const [path, method, expectedStatus] of invalidRequests) {
    const response = await api.request(path, { method });
    if (response.status !== expectedStatus) {
      throw new Error(
        `Expected ${method} ${path} to answer ${expectedStatus}, received ${response.status}`,
      );
    }
  }
});

Deno.test('accounts delete messages, which bots then no longer find', async () => {
  const { api, sessionPath, owner, member, bot, supergroup, supergroupPath, sendSupergroupText } =
    await createSupergroupFixture();
  const readUpdates = createUpdateReader(api);
  const privatePath = `${sessionPath}/accounts/${owner.id}/conversations/private/${bot.bot.id}`;
  const sent = await api.request(
    `${sessionPath}/accounts/${owner.id}/messages`,
    jsonRequest('POST', { to: { type: 'private', botId: bot.bot.id }, text: 'Hello' }),
  );
  const { message: greeting } = await sent.json() as { message: { message_id: number } };
  const question = botApiResult(
    (await callBotApi(api, `${bot.botApiPath}/sendMessage`, {
      chat_id: owner.id,
      text: 'Your name?',
      reply_markup: { force_reply: true },
    })).body,
  );
  await readUpdates(bot.botApiPath);

  // The account deletes the bot's question and its own greeting for both participants.
  const privateDeletions = [
    (await api.request(`${privatePath}/messages/${question?.message_id}`, { method: 'DELETE' }))
      .status,
    (await api.request(`${privatePath}/messages/${greeting.message_id}`, { method: 'DELETE' }))
      .status,
    (await api.request(`${privatePath}/messages/${greeting.message_id}`, { method: 'DELETE' }))
      .status,
    (await api.request(`${privatePath}/messages/0`, { method: 'DELETE' })).status,
  ];
  const edit = await callBotApi(api, `${bot.botApiPath}/editMessageText`, {
    chat_id: owner.id,
    message_id: question?.message_id,
    text: 'Your full name?',
  });
  const reply = await callBotApi(api, `${bot.botApiPath}/sendMessage`, {
    chat_id: owner.id,
    text: 'Hello to you',
    reply_parameters: { message_id: greeting.message_id },
  });
  const { reply_interface } = await (await api.request(`${privatePath}/reply-interface`))
    .json() as { reply_interface: unknown };
  const { messages: privateHistory } = await (await api.request(`${privatePath}/messages`))
    .json() as { messages: unknown[] };
  if (
    JSON.stringify(privateDeletions) !== JSON.stringify([204, 204, 404, 400]) ||
    JSON.stringify(edit.body) !== JSON.stringify({
        ok: false,
        error_code: 400,
        description: 'Bad Request: message to edit not found',
      }) ||
    (reply.body as { description?: string }).description !==
      'Bad Request: message to be replied not found' ||
    reply_interface !== null || privateHistory.length !== 0 ||
    (await readUpdates(bot.botApiPath)).length !== 0
  ) {
    throw new Error(
      `Expected the account to delete its private messages, received ${
        JSON.stringify({ privateDeletions, edit, reply, reply_interface, privateHistory })
      }`,
    );
  }

  // A member deletes only its own messages; the owner deletes any.
  const memberMessage = await sendSupergroupText(member.id, 'Oops');
  const ownerMessage = await sendSupergroupText(owner.id, 'Welcome');
  const botMessage = botApiResult(
    (await callBotApi(api, `${bot.botApiPath}/sendMessage`, {
      chat_id: supergroup.id,
      text: 'Rules',
    })).body,
  );
  const deleteInSupergroup = async (accountId: number, messageId: unknown) =>
    (await api.request(`${supergroupPath(accountId)}/messages/${messageId}`, {
      method: 'DELETE',
    })).status;
  const outsider = await createAccount(api, sessionPath, 'Linus');
  const supergroupDeletions = [
    await deleteInSupergroup(member.id, ownerMessage.message_id),
    await deleteInSupergroup(member.id, botMessage?.message_id),
    // The service message recording the member joining is the owner's.
    await deleteInSupergroup(member.id, 1),
    await deleteInSupergroup(outsider.id, memberMessage.message_id),
    await deleteInSupergroup(member.id, memberMessage.message_id),
    await deleteInSupergroup(owner.id, botMessage?.message_id),
    await deleteInSupergroup(owner.id, memberMessage.message_id),
  ];
  const { messages: supergroupHistory } = await (await api.request(
    `${supergroupPath(member.id)}/messages`,
  )).json() as { messages: Array<{ message_id: number }> };
  if (
    JSON.stringify(supergroupDeletions) !==
      JSON.stringify([403, 403, 403, 403, 204, 204, 404]) ||
    supergroupHistory.some(({ message_id }) =>
      message_id === memberMessage.message_id || message_id === botMessage?.message_id
    ) ||
    !supergroupHistory.some(({ message_id }) => message_id === ownerMessage.message_id)
  ) {
    throw new Error(
      `Expected members to delete the messages they may delete, received ${
        JSON.stringify({ supergroupDeletions, supergroupHistory })
      }`,
    );
  }
});

Deno.test('PATCH on an account message edits it and sends the bot an edited_message update', async () => {
  const { api, sessionPath, botApiPath, createdBot, createdAccount, sendText } =
    await createPrivateConversationFixture();
  const historyPath =
    `${sessionPath}/accounts/${createdAccount.account.id}/conversations/private/${createdBot.bot.id}/messages`;
  const editMessage = (messageId: number | string, body: unknown) =>
    api.request(`${historyPath}/${messageId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  await sendText('Hello');
  const botReply = await callBotApi(api, `${botApiPath}/sendMessage`, {
    chat_id: createdAccount.account.id,
    text: 'Hi',
  });
  const botMessageId = botApiResult(botReply.body)?.message_id;

  const response = await editMessage(1, { text: 'Hello /help' });
  const responseBody: unknown = await response.json();
  if (response.status !== 200 || !isSentMessageResponse(responseBody)) {
    throw new Error(`Expected the edit to succeed, received ${response.status}`);
  }
  const editedMessage = responseBody.message as TestPrivateMessage & { edit_date?: number };
  if (
    editedMessage.message_id !== 1 || editedMessage.text !== 'Hello /help' ||
    editedMessage.edit_date === undefined ||
    JSON.stringify(editedMessage.entities) !==
      JSON.stringify([{ type: 'bot_command', offset: 6, length: 5 }])
  ) {
    throw new Error(`Expected the edited message, received ${JSON.stringify(editedMessage)}`);
  }

  const { body: updatesBody } = await callBotApi(api, `${botApiPath}/getUpdates`, {});
  const updates = (updatesBody as { result: Array<Record<string, unknown>> }).result;
  if (
    updates.length !== 2 || JSON.stringify(updates[1]) !==
      JSON.stringify({
        update_id: updates[0].update_id as number + 1,
        edited_message: editedMessage,
      })
  ) {
    throw new Error(`Expected an edited_message update, received ${JSON.stringify(updates)}`);
  }

  const invalidEdits = [
    [1, { text: 'Hello /help' }, 400],
    [1, { text: '' }, 400],
    [1, { text: 'Hi', entities: [{ type: 'bold', offset: 0, length: 'all' }] }, 400],
    [botMessageId as number, { text: 'Changed' }, 400],
    [99, { text: 'Changed' }, 404],
    [0, { text: 'Changed' }, 400],
    ['first', { text: 'Changed' }, 400],
  ] as const;
  for (const [messageId, body, expectedStatus] of invalidEdits) {
    const invalidResponse = await editMessage(messageId, body);
    if (invalidResponse.status !== expectedStatus) {
      throw new Error(
        `Expected editing ${messageId} with ${
          JSON.stringify(body)
        } to answer ${expectedStatus}, received ${invalidResponse.status}`,
      );
    }
  }
});

Deno.test('a grammY bot answers an edited message and forgets a user who blocks it', async () => {
  const { api, sessionPath, createdBot, createdAccount, sendText } =
    await createPrivateConversationFixture();
  const accountPath = `${sessionPath}/accounts/${createdAccount.account.id}`;
  const grammyBot = new Bot(createdBot.token, {
    client: {
      apiRoot: `${TEST_PUBLIC_ORIGIN}${sessionPath}/bot-api`,
      fetch: api.fetch,
    },
  });
  const subscribers = new Set<number>();
  const handled = {
    subscription: Promise.withResolvers<void>(),
    edit: Promise.withResolvers<void>(),
    block: Promise.withResolvers<void>(),
  };
  grammyBot.command('subscribe', async (context) => {
    subscribers.add(context.chat.id);
    await context.reply('Subscribed');
    handled.subscription.resolve();
  });
  grammyBot.on('edited_message:text', async (context) => {
    await context.reply(`You changed it to: ${context.editedMessage.text}`);
    handled.edit.resolve();
  });
  grammyBot.on('my_chat_member', (context) => {
    if (context.myChatMember.new_chat_member.status === 'kicked') {
      subscribers.delete(context.chat.id);
      handled.block.resolve();
    }
  });
  const polling = grammyBot.start();

  let broadcastError: unknown;
  try {
    await sendText('/subscribe');
    // Polling ends only when stopped, so settling first means the bot failed.
    await Promise.race([handled.subscription.promise, polling]);
    const helloResponse = await api.request(`${accountPath}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: { type: 'private', botId: createdBot.bot.id }, text: 'Hello' }),
    });
    const helloBody: unknown = await helloResponse.json();
    if (!isSentMessageResponse(helloBody)) {
      throw new Error(`Expected "Hello" to be sent, received ${helloResponse.status}`);
    }
    await api.request(
      `${accountPath}/conversations/private/${createdBot.bot.id}/messages/${helloBody.message.message_id}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: 'Hello there' }),
      },
    );
    await Promise.race([handled.edit.promise, polling]);

    await api.request(`${accountPath}/blocked-bots/${createdBot.bot.id}`, { method: 'PUT' });
    try {
      await grammyBot.api.sendMessage(createdAccount.account.id, 'News');
    } catch (error) {
      broadcastError = error;
    }
    await Promise.race([handled.block.promise, polling]);
  } finally {
    await grammyBot.stop();
    await polling;
  }

  if (
    !(broadcastError instanceof GrammyError) || broadcastError.error_code !== 403 ||
    broadcastError.description !== 'Forbidden: bot was blocked by the user'
  ) {
    throw new Error(`Expected a GrammyError 403, received ${String(broadcastError)}`);
  }
  if (subscribers.size !== 0) {
    throw new Error('Expected the bot to forget the user who blocked it');
  }
  const historyBody: unknown = await (await api.request(
    `${accountPath}/conversations/private/${createdBot.bot.id}/messages`,
  )).json();
  if (
    !isMessageHistoryResponse(historyBody) ||
    JSON.stringify(historyBody.messages.map(({ text }) => text)) !== JSON.stringify([
        '/subscribe',
        'Subscribed',
        'Hello there',
        'You changed it to: Hello there',
      ])
  ) {
    throw new Error('Expected history to hold the edited message and the reply to the edit');
  }
});

Deno.test('bots reply to messages of their other chats with an external reply', async () => {
  const { api, sessionPath, member, bot, supergroup } = await createSupergroupFixture();
  const sendMessage = async (parameters: Record<string, unknown>) => {
    const { status, body } = await callBotApi(api, `${bot.botApiPath}/sendMessage`, parameters);
    return { status, body, message: botApiResult(body) };
  };
  const accountResponse = await api.request(
    `${sessionPath}/accounts/${member.id}/messages`,
    jsonRequest('POST', { to: { type: 'private', botId: bot.bot.id }, text: 'Hello' }),
  );
  const accountBody: unknown = await accountResponse.json();
  if (accountResponse.status !== 201 || !isSentMessageResponse(accountBody)) {
    throw new Error(`Expected the account to write to the bot, received ${accountResponse.status}`);
  }
  const accountMessage = accountBody.message;
  const announcement = await sendMessage({
    chat_id: supergroup.id,
    text: '<b>Ship</b> it <code>now</code>',
    parse_mode: 'HTML',
  });
  const botUser = announcement.message?.from;
  const announcementId = announcement.message?.message_id;

  const privateReply = await sendMessage({
    chat_id: member.id,
    text: 'Noted',
    reply_parameters: { chat_id: supergroup.id, message_id: announcementId },
  });
  const expectedPrivateReply = {
    origin: { type: 'user', sender_user: botUser, date: announcement.message?.date },
    chat: { id: supergroup.id, title: 'Team', type: 'supergroup' },
    message_id: announcementId,
  };
  if (
    privateReply.status !== 200 || privateReply.message?.reply_to_message !== undefined ||
    JSON.stringify(privateReply.message?.external_reply) !== JSON.stringify(expectedPrivateReply) ||
    JSON.stringify(privateReply.message?.quote) !== JSON.stringify({
        text: 'Ship it now',
        entities: [{ type: 'bold', offset: 0, length: 4 }],
        position: 0,
      })
  ) {
    throw new Error(
      `Expected an external reply to the supergroup message, received ${
        JSON.stringify(privateReply.body)
      }`,
    );
  }

  // A chosen quote replaces the automatic one.
  const quotedPrivateReply = await sendMessage({
    chat_id: member.id,
    text: 'Now?',
    reply_parameters: { chat_id: supergroup.id, message_id: announcementId, quote: 'now' },
  });
  if (
    JSON.stringify(quotedPrivateReply.message?.quote) !==
      JSON.stringify({ text: 'now', position: 8, is_manual: true })
  ) {
    throw new Error(
      `Expected the chosen quote of the supergroup message, received ${
        JSON.stringify(quotedPrivateReply.body)
      }`,
    );
  }

  const supergroupReply = await sendMessage({
    chat_id: supergroup.id,
    text: 'A customer says hello',
    reply_parameters: { chat_id: member.id, message_id: accountMessage.message_id },
  });
  const supergroupHistory = await (await api.request(
    `${sessionPath}/accounts/${member.id}/conversations/supergroup/${supergroup.id}/messages`,
  )).json() as { messages: Array<Record<string, unknown>> };
  const expectedSupergroupReply = {
    external_reply: {
      origin: { type: 'user', sender_user: accountMessage.from, date: accountMessage.date },
    },
    quote: { text: 'Hello', position: 0 },
  };
  const shownReply = supergroupHistory.messages.at(-1);
  if (
    supergroupReply.status !== 200 ||
    JSON.stringify({
        external_reply: supergroupReply.message?.external_reply,
        quote: supergroupReply.message?.quote,
      }) !== JSON.stringify(expectedSupergroupReply) ||
    JSON.stringify({ external_reply: shownReply?.external_reply, quote: shownReply?.quote }) !==
      JSON.stringify(expectedSupergroupReply)
  ) {
    throw new Error(
      `Expected an external reply to the private message without its chat, received ${
        JSON.stringify(supergroupReply.body)
      }`,
    );
  }

  // As TDLib does, a message that cannot be forwarded is silently not replied to.
  const protectedMessage = await sendMessage({
    chat_id: supergroup.id,
    text: 'Secret',
    protect_content: true,
  });
  const replyToProtected = await sendMessage({
    chat_id: member.id,
    text: 'Keep it secret',
    reply_parameters: { chat_id: supergroup.id, message_id: protectedMessage.message?.message_id },
  });
  const replyToMissingAllowed = await sendMessage({
    chat_id: member.id,
    text: 'Anyway',
    reply_parameters: {
      chat_id: supergroup.id,
      message_id: 999,
      allow_sending_without_reply: true,
    },
  });
  for (const reply of [replyToProtected, replyToMissingAllowed]) {
    if (
      reply.status !== 200 || reply.message?.external_reply !== undefined ||
      reply.message?.quote !== undefined
    ) {
      throw new Error(`Expected a message without a reply, received ${JSON.stringify(reply.body)}`);
    }
  }

  const rejections: [Record<string, unknown>, string][] = [
    [{ chat_id: supergroup.id, message_id: 999 }, 'Bad Request: message to be replied not found'],
    [{ chat_id: -1_000_000_000_999, message_id: 1 }, 'Bad Request: chat not found'],
  ];
  for (const [replyParameters, expectedDescription] of rejections) {
    const { status, body } = await sendMessage({
      chat_id: member.id,
      text: 'Reply',
      reply_parameters: replyParameters,
    });
    if (status !== 400 || !isBadRequestResponse(body) || body.description !== expectedDescription) {
      throw new Error(`Expected "${expectedDescription}", received ${JSON.stringify(body)}`);
    }
  }
});

Deno.test('forwardMessage forwards messages with their origin and follows Telegram checks', async () => {
  const { api, sessionPath, owner, bot, supergroup, supergroupPath } =
    await createSupergroupFixture();
  const privateChat = { type: 'private', botId: bot.bot.id };
  const accountMessageResponse = await api.request(
    `${sessionPath}/accounts/${owner.id}/messages`,
    jsonRequest('POST', { to: privateChat, text: 'Where is my order?' }),
  );
  const { message: accountMessage } = await accountMessageResponse.json() as {
    message: { message_id: number; date: number };
  };
  const forwardMessage = (parameters: Record<string, unknown>) =>
    callBotApi(api, `${bot.botApiPath}/forwardMessage`, parameters);

  const forward = botApiResult(
    (await forwardMessage({
      chat_id: supergroup.id,
      from_chat_id: owner.id,
      message_id: accountMessage.message_id,
    })).body,
  );
  const expectedOrigin = { type: 'user', sender_user: owner, date: accountMessage.date };
  const expectedForwardFields = {
    forward_origin: expectedOrigin,
    forward_from: owner,
    forward_date: accountMessage.date,
    text: 'Where is my order?',
  };
  const { forward_origin, forward_from, forward_date, text } = forward ?? {};
  if (
    forward?.chat === undefined || (forward.from as { id: number }).id !== bot.bot.id ||
    JSON.stringify({ forward_origin, forward_from, forward_date, text }) !==
      JSON.stringify(expectedForwardFields)
  ) {
    throw new Error(
      `Expected the bot's forward to show its origin, received ${JSON.stringify(forward)}`,
    );
  }

  // A forward of a forward keeps the original's origin.
  const forwardOfForward = botApiResult(
    (await forwardMessage({
      chat_id: owner.id,
      from_chat_id: supergroup.id,
      message_id: forward.message_id,
    })).body,
  );
  if (JSON.stringify(forwardOfForward?.forward_origin) !== JSON.stringify(expectedOrigin)) {
    throw new Error(
      `Expected a forward of a forward to keep its origin, received ${
        JSON.stringify(forwardOfForward)
      }`,
    );
  }

  // Only a keyboard of URL buttons stays on a forward.
  const sendMenu = async (inlineKeyboard: unknown) =>
    botApiResult(
      (await callBotApi(api, `${bot.botApiPath}/sendMessage`, {
        chat_id: owner.id,
        text: 'Menu',
        reply_markup: { inline_keyboard: inlineKeyboard },
      })).body,
    )?.message_id;
  const urlKeyboard = [[{ text: 'Track', url: 'https://example.com/track' }]];
  const callbackKeyboard = [[{ text: 'Track', url: 'https://example.com/track' }, {
    text: 'Cancel',
    callback_data: 'cancel',
  }]];
  const forwardedMarkups = [];
  for (const inlineKeyboard of [urlKeyboard, callbackKeyboard]) {
    const messageId = await sendMenu(inlineKeyboard);
    forwardedMarkups.push(
      botApiResult(
        (await forwardMessage({
          chat_id: supergroup.id,
          from_chat_id: owner.id,
          message_id: messageId,
        })).body,
      )?.reply_markup,
    );
  }
  if (
    JSON.stringify(forwardedMarkups) !==
      JSON.stringify([{ inline_keyboard: urlKeyboard }, undefined])
  ) {
    throw new Error(`Expected only URL keyboards on forwards, received ${forwardedMarkups}`);
  }

  // A forward cannot be edited.
  const editOfForward = await callBotApi(api, `${bot.botApiPath}/editMessageText`, {
    chat_id: supergroup.id,
    message_id: forward.message_id,
    text: 'Edited',
  });
  if (
    !isBadRequestResponse(editOfForward.body) ||
    editOfForward.body.description !== "Bad Request: message can't be edited"
  ) {
    throw new Error(
      `Expected a forward to be uneditable, received ${JSON.stringify(editOfForward)}`,
    );
  }

  const protectedMessageId = botApiResult(
    (await callBotApi(api, `${bot.botApiPath}/sendMessage`, {
      chat_id: owner.id,
      text: 'Your code is 1234',
      protect_content: true,
    })).body,
  )?.message_id;
  const history = await (await api.request(`${supergroupPath(owner.id)}/messages`)).json() as {
    messages: Array<{ message_id: number }>;
  };
  const serviceMessageId = history.messages[0].message_id;
  const expectFailure = async (
    parameters: Record<string, unknown>,
    status: number,
    description: string,
  ) => {
    const { status: actualStatus, body } = await forwardMessage(parameters);
    const actualDescription = (body as { description?: unknown }).description;
    if (actualStatus !== status || actualDescription !== description) {
      throw new Error(
        `Expected forwardMessage to fail with "${description}", received ${JSON.stringify(body)}`,
      );
    }
  };
  await expectFailure(
    { chat_id: supergroup.id, message_id: accountMessage.message_id },
    400,
    'Bad Request: parameter "from_chat_id" is required',
  );
  await expectFailure(
    { from_chat_id: owner.id, message_id: accountMessage.message_id },
    400,
    'Bad Request: chat_id is empty',
  );
  await expectFailure(
    { chat_id: supergroup.id, from_chat_id: owner.id + 1_000, message_id: 1 },
    400,
    'Bad Request: chat not found',
  );
  await expectFailure(
    { chat_id: supergroup.id, from_chat_id: owner.id },
    400,
    'Bad Request: message to forward not found',
  );
  await expectFailure(
    { chat_id: supergroup.id, from_chat_id: supergroup.id, message_id: 1_000 },
    400,
    'Bad Request: message to forward not found',
  );
  await expectFailure(
    { chat_id: supergroup.id, from_chat_id: owner.id, message_id: protectedMessageId },
    400,
    "Bad Request: the message can't be forwarded",
  );
  await expectFailure(
    { chat_id: owner.id, from_chat_id: supergroup.id, message_id: serviceMessageId },
    400,
    "Bad Request: the message can't be forwarded",
  );
  // A supergroup the bot never joined is unknown to it.
  const outsider = await createBot(api, sessionPath, 'outsider_bot');
  const { body: outsiderBody } = await callBotApi(api, `${outsider.botApiPath}/forwardMessage`, {
    chat_id: owner.id,
    from_chat_id: supergroup.id,
    message_id: forward.message_id,
  });
  if (
    !isBadRequestResponse(outsiderBody) ||
    outsiderBody.description !== 'Bad Request: chat not found'
  ) {
    throw new Error(
      `Expected a non-member not to find the supergroup, received ${JSON.stringify(outsiderBody)}`,
    );
  }
});

Deno.test('forwardMessages and copyMessages repeat messages that can be repeated, in order', async () => {
  // The calendar time stands still, since the forwards' origin dates of messages sent by separate
  // requests are compared.
  const { api, sessionPath, owner, bot, supergroup, supergroupPath } =
    await createSupergroupFixture({ wallClock: FIXED_WALL_CLOCK });
  const sendAccountMessage = async (message: Record<string, unknown>) => {
    const response = await api.request(
      `${sessionPath}/accounts/${owner.id}/messages`,
      jsonRequest('POST', { to: { type: 'private', botId: bot.bot.id }, ...message }),
    );
    return ((await response.json()) as { message: { message_id: number } }).message.message_id;
  };
  const questionId = await sendAccountMessage({ text: 'Where is my order?' });
  const followUpId = await sendAccountMessage({
    text: 'It was due today',
    reply_to_message_id: questionId,
  });
  const protectedMessageId = botApiResult(
    (await callBotApi(api, `${bot.botApiPath}/sendMessage`, {
      chat_id: owner.id,
      text: 'Your code is 1234',
      protect_content: true,
    })).body,
  )?.message_id as number;
  const receiptId = await sendAccountMessage({
    photo: { content_base64: gifImage(4, 3).toBase64() },
    caption: 'Receipt',
  });
  const repeatMessages = (method: string, parameters: Record<string, unknown>) =>
    callBotApi(api, `${bot.botApiPath}/${method}`, parameters);
  const readSupergroupMessages = async (messageIds: unknown) => {
    const history = await (await api.request(`${supergroupPath(owner.id)}/messages`)).json() as {
      messages: Array<Record<string, unknown>>;
    };
    return (messageIds as Array<{ message_id: number }>).map(({ message_id }) =>
      history.messages.find((message) => message.message_id === message_id)
    );
  };
  const describe = (message: Record<string, unknown> | undefined) => ({
    text: message?.text ?? message?.caption,
    originDate: (message?.forward_origin as { date?: number } | undefined)?.date,
    repliedMessageId: (message?.reply_to_message as { message_id?: number } | undefined)
      ?.message_id,
  });

  // A missing message and a protected message are skipped; replies within the request are kept.
  const forwarded = await repeatMessages('forwardMessages', {
    chat_id: supergroup.id,
    from_chat_id: owner.id,
    message_ids: [questionId, followUpId, 1_000, protectedMessageId, receiptId],
  });
  const forwards = await readSupergroupMessages(botApiResult(forwarded.body));
  const [forwardedQuestion] = forwards;
  const originDate = (forwardedQuestion?.forward_origin as { date?: number } | undefined)?.date;
  if (
    forwarded.status !== 200 || originDate === undefined ||
    JSON.stringify(forwards.map(describe)) !== JSON.stringify([
        { text: 'Where is my order?', originDate },
        {
          text: 'It was due today',
          originDate,
          repliedMessageId: forwardedQuestion?.message_id,
        },
        { text: 'Receipt', originDate },
      ])
  ) {
    throw new Error(
      `Expected the repeatable messages to be forwarded, received ${JSON.stringify(forwarded)}`,
    );
  }

  // A bot may copy a protected message, and captions can be removed.
  const copied = await repeatMessages('copyMessages', {
    chat_id: supergroup.id,
    from_chat_id: owner.id,
    message_ids: [questionId, followUpId, protectedMessageId, receiptId],
    remove_caption: true,
  });
  const copies = await readSupergroupMessages(botApiResult(copied.body));
  if (
    copied.status !== 200 ||
    JSON.stringify(copies.map(describe)) !== JSON.stringify([
        { text: 'Where is my order?' },
        { text: 'It was due today', repliedMessageId: copies[0]?.message_id },
        { text: 'Your code is 1234' },
        {},
      ]) ||
    photoSizeOf(copies[3]) === undefined
  ) {
    throw new Error(`Expected the messages to be copied, received ${JSON.stringify(copied)}`);
  }

  const history = await (await api.request(`${supergroupPath(owner.id)}/messages`)).json() as {
    messages: Array<{ message_id: number }>;
  };
  const serviceMessageId = history.messages[0].message_id;
  const expectFailure = async (
    method: string,
    parameters: Record<string, unknown>,
    description: string,
  ) => {
    const { status, body } = await repeatMessages(method, parameters);
    const actualDescription = (body as { description?: unknown }).description;
    if (status !== 400 || actualDescription !== description) {
      throw new Error(
        `Expected ${method} to fail with "${description}", received ${JSON.stringify(body)}`,
      );
    }
  };
  const target = { chat_id: supergroup.id, from_chat_id: owner.id };
  await expectFailure(
    'forwardMessages',
    { chat_id: supergroup.id, message_ids: [questionId] },
    'Bad Request: parameter "from_chat_id" is required',
  );
  for (const messageIds of [undefined, []]) {
    await expectFailure(
      'copyMessages',
      { ...target, message_ids: messageIds },
      'Bad Request: message identifiers are not specified',
    );
  }
  await expectFailure(
    'forwardMessages',
    { ...target, message_ids: Array.from({ length: 101 }, (_, index) => index + 1) },
    'Bad Request: too many message identifiers specified',
  );
  await expectFailure(
    'forwardMessages',
    { ...target, message_ids: [questionId, 0] },
    'Bad Request: invalid message identifier specified',
  );
  await expectFailure(
    'forwardMessages',
    { from_chat_id: owner.id, message_ids: [questionId] },
    'Bad Request: chat_id is empty',
  );
  await expectFailure(
    'forwardMessages',
    { chat_id: supergroup.id, from_chat_id: owner.id + 1_000, message_ids: [questionId] },
    'Bad Request: chat not found',
  );
  await expectFailure(
    'copyMessages',
    { ...target, message_ids: [followUpId, questionId] },
    'Bad Request: message identifiers must be in a strictly increasing order',
  );
  await expectFailure(
    'forwardMessages',
    { ...target, message_ids: [1_000, 1_001] },
    'Bad Request: there are no messages to forward',
  );
  await expectFailure(
    'forwardMessages',
    { ...target, message_ids: [protectedMessageId] },
    "Bad Request: messages can't be forwarded",
  );
  await expectFailure(
    'copyMessages',
    { chat_id: owner.id, from_chat_id: supergroup.id, message_ids: [serviceMessageId] },
    "Bad Request: messages can't be forwarded",
  );
});

Deno.test('bots add message effects to private messages only, as TDLib allows', async () => {
  const { api, sessionPath, owner, bot, supergroup } = await createSupergroupFixture();
  const effectId = '5104841245755180586';
  const questionResponse = await api.request(
    `${sessionPath}/accounts/${owner.id}/messages`,
    jsonRequest('POST', { to: { type: 'private', botId: bot.bot.id }, text: 'Hi' }),
  );
  const { message: question } = await questionResponse.json() as {
    message: { message_id: number };
  };
  const callMethod = (method: string, parameters: Record<string, unknown>) =>
    callBotApi(api, `${bot.botApiPath}/${method}`, parameters);

  const celebration = botApiResult(
    (await callMethod('sendMessage', {
      chat_id: owner.id,
      text: 'Congratulations!',
      message_effect_id: effectId,
    })).body,
  );
  const edited = botApiResult(
    (await callMethod('editMessageText', {
      chat_id: owner.id,
      message_id: celebration?.message_id,
      text: 'Congratulations again!',
    })).body,
  );
  const forward = botApiResult(
    (await callMethod('forwardMessage', {
      chat_id: owner.id,
      from_chat_id: owner.id,
      message_id: question.message_id,
      message_effect_id: effectId,
    })).body,
  );
  const withoutEffect = botApiResult(
    (await callMethod('sendMessage', { chat_id: owner.id, text: 'Hi', message_effect_id: '0' }))
      .body,
  );
  const history = await (await api.request(
    `${sessionPath}/accounts/${owner.id}/conversations/private/${bot.bot.id}/messages`,
  )).json() as { messages: Array<Record<string, unknown>> };
  const storedCelebration = history.messages.find(({ message_id }) =>
    message_id === celebration?.message_id
  );
  if (
    celebration?.effect_id !== effectId || edited?.effect_id !== effectId ||
    forward?.effect_id !== effectId || withoutEffect === undefined ||
    'effect_id' in withoutEffect || storedCelebration?.effect_id !== effectId
  ) {
    throw new Error(
      `Expected messages to keep their effects, received ${
        JSON.stringify({ celebration, edited, forward, withoutEffect, storedCelebration })
      }`,
    );
  }

  // A batch may add an effect only to a single found message.
  const batch = await callMethod('copyMessages', {
    chat_id: owner.id,
    from_chat_id: owner.id,
    message_ids: [question.message_id, 1_000],
    message_effect_id: effectId,
  });
  const [batchCopy] = (batch.body as { result?: Array<{ message_id: number }> }).result ?? [];
  const storedBatchCopy = (await (await api.request(
    `${sessionPath}/accounts/${owner.id}/conversations/private/${bot.bot.id}/messages`,
  )).json() as { messages: Array<Record<string, unknown>> }).messages.find(({ message_id }) =>
    message_id === batchCopy?.message_id
  );
  if (storedBatchCopy?.effect_id !== effectId) {
    throw new Error(
      `Expected the single copy to show the effect, received ${JSON.stringify(batch.body)}`,
    );
  }

  const failures = [
    [
      'sendMessage',
      { chat_id: supergroup.id, text: 'Hi', message_effect_id: effectId },
      "Bad Request: can't use message effects in the chat",
    ],
    // Telegram looks at the chat and the reply before the effect.
    [
      'sendMessage',
      { chat_id: supergroup.id - 1_000, text: 'Hi', message_effect_id: effectId },
      'Bad Request: chat not found',
    ],
    [
      'sendMessage',
      {
        chat_id: supergroup.id,
        text: 'Hi',
        message_effect_id: effectId,
        reply_parameters: { message_id: 1_000 },
      },
      'Bad Request: message to be replied not found',
    ],
    [
      'copyMessages',
      {
        chat_id: supergroup.id,
        from_chat_id: owner.id,
        message_ids: [question.message_id],
        message_effect_id: effectId,
      },
      "Bad Request: can't use message effects in the chat",
    ],
    [
      'forwardMessages',
      {
        chat_id: owner.id,
        from_chat_id: owner.id,
        message_ids: [question.message_id, celebration?.message_id],
        message_effect_id: effectId,
      },
      "Bad Request: can't use message effects in the method",
    ],
    [
      'sendMessage',
      { chat_id: owner.id, text: 'Hi', message_effect_id: 'fireworks' },
      'Bad Request: invalid sendMessage parameters',
    ],
  ] as const;
  for (const [method, parameters, expectedDescription] of failures) {
    const { status, body } = await callMethod(method, parameters);
    if (status !== 400 || (body as { description?: unknown }).description !== expectedDescription) {
      throw new Error(
        `Expected ${method} ${JSON.stringify(parameters)} to fail with ${expectedDescription}, ` +
          `received ${JSON.stringify(body)}`,
      );
    }
  }
});

Deno.test('copyMessage copies messages without their origin and follows Telegram checks', async () => {
  const { api, sessionPath, owner, bot, supergroup, supergroupPath } =
    await createSupergroupFixture();
  const photoResponse = await api.request(
    `${sessionPath}/accounts/${owner.id}/messages`,
    jsonRequest('POST', {
      to: { type: 'private', botId: bot.bot.id },
      photo: { content_base64: gifImage(4, 3).toBase64() },
      caption: 'Receipt',
    }),
  );
  const { message: photoMessage } = await photoResponse.json() as {
    message: { message_id: number; photo: Array<{ file_unique_id: string }> };
  };
  const copyMessage = (parameters: Record<string, unknown>) =>
    callBotApi(api, `${bot.botApiPath}/copyMessage`, parameters);
  const readSupergroupMessage = async (messageId: unknown) => {
    const history = await (await api.request(`${supergroupPath(owner.id)}/messages`)).json() as {
      messages: Array<Record<string, unknown>>;
    };
    return history.messages.find((message) => message.message_id === messageId);
  };

  const copies = [];
  for (
    const captionParameters of [
      {},
      { caption: '<b>Paid</b> receipt', parse_mode: 'HTML', show_caption_above_media: true },
      { caption: '' },
    ]
  ) {
    const { status, body } = await copyMessage({
      chat_id: supergroup.id,
      from_chat_id: owner.id,
      message_id: photoMessage.message_id,
      ...captionParameters,
    });
    const result = botApiResult(body);
    if (status !== 200 || result === undefined || Object.keys(result).join() !== 'message_id') {
      throw new Error(
        `Expected copyMessage to answer a message ID, received ${JSON.stringify(body)}`,
      );
    }
    const copy = await readSupergroupMessage(result.message_id);
    const { from, caption, caption_entities, show_caption_above_media, forward_origin } = copy ??
      {};
    copies.push({
      fromId: (from as { id: number } | undefined)?.id,
      fileUniqueId: photoSizeOf(copy)?.file_unique_id,
      caption,
      caption_entities,
      show_caption_above_media,
      forward_origin,
    });
  }
  const photoFileUniqueId = photoMessage.photo[0].file_unique_id;
  const expectedCopies = [
    { fromId: bot.bot.id, fileUniqueId: photoFileUniqueId, caption: 'Receipt' },
    {
      fromId: bot.bot.id,
      fileUniqueId: photoFileUniqueId,
      caption: 'Paid receipt',
      caption_entities: [{ type: 'bold', offset: 0, length: 4 }],
      show_caption_above_media: true,
    },
    { fromId: bot.bot.id, fileUniqueId: photoFileUniqueId },
  ];
  if (JSON.stringify(copies) !== JSON.stringify(expectedCopies)) {
    throw new Error(`Expected copies with the chosen captions, received ${JSON.stringify(copies)}`);
  }

  // A copy takes the reply and keyboard of the request, keeps text as it is, and a bot may copy a
  // protected message; a copy of a forward does not show the forward's origin.
  const protectedMessageId = botApiResult(
    (await callBotApi(api, `${bot.botApiPath}/sendMessage`, {
      chat_id: owner.id,
      text: 'Your code is 1234',
      protect_content: true,
    })).body,
  )?.message_id;
  const forwardId = botApiResult(
    (await callBotApi(api, `${bot.botApiPath}/forwardMessage`, {
      chat_id: supergroup.id,
      from_chat_id: owner.id,
      message_id: photoMessage.message_id,
    })).body,
  )?.message_id;
  const inlineKeyboard = [[{ text: 'Done', callback_data: 'done' }]];
  const textCopyId = botApiResult(
    (await copyMessage({
      chat_id: supergroup.id,
      from_chat_id: owner.id,
      message_id: protectedMessageId,
      caption: 'Ignored for text',
      reply_parameters: { message_id: forwardId },
      reply_markup: { inline_keyboard: inlineKeyboard },
    })).body,
  )?.message_id;
  const textCopy = await readSupergroupMessage(textCopyId);
  const copyOfForwardId = botApiResult(
    (await copyMessage({ chat_id: owner.id, from_chat_id: supergroup.id, message_id: forwardId }))
      .body,
  )?.message_id;
  const privateHistory = await (await api.request(
    `${sessionPath}/accounts/${owner.id}/conversations/private/${bot.bot.id}/messages`,
  )).json() as { messages: Array<Record<string, unknown>> };
  const copyOfForward = privateHistory.messages.find(({ message_id }) =>
    message_id === copyOfForwardId
  );
  if (
    textCopy?.text !== 'Your code is 1234' || textCopy.has_protected_content !== undefined ||
    (textCopy.reply_to_message as { message_id?: number } | undefined)?.message_id !==
      forwardId ||
    JSON.stringify(textCopy.reply_markup) !== JSON.stringify({ inline_keyboard: inlineKeyboard }) ||
    copyOfForward === undefined || 'forward_origin' in copyOfForward ||
    copyOfForward.caption !== 'Receipt'
  ) {
    throw new Error(
      `Expected copies to take the request's options, received ${
        JSON.stringify({ textCopy, copyOfForward })
      }`,
    );
  }

  const history = await (await api.request(`${supergroupPath(owner.id)}/messages`)).json() as {
    messages: Array<{ message_id: number }>;
  };
  const expectFailure = async (
    parameters: Record<string, unknown>,
    status: number,
    description: string,
  ) => {
    const { status: actualStatus, body } = await copyMessage(parameters);
    const actualDescription = (body as { description?: unknown }).description;
    if (actualStatus !== status || actualDescription !== description) {
      throw new Error(
        `Expected copyMessage to fail with "${description}", received ${JSON.stringify(body)}`,
      );
    }
  };
  await expectFailure(
    { chat_id: supergroup.id, from_chat_id: owner.id, message_id: 1_000 },
    400,
    'Bad Request: message to copy not found',
  );
  await expectFailure(
    { chat_id: owner.id, from_chat_id: supergroup.id, message_id: history.messages[0].message_id },
    400,
    "Bad Request: the message can't be copied",
  );
  await expectFailure(
    {
      chat_id: supergroup.id,
      from_chat_id: owner.id,
      message_id: photoMessage.message_id,
      caption: 'x'.repeat(1_025),
    },
    400,
    'Bad Request: message caption is too long',
  );
  await api.request(`${sessionPath}/accounts/${owner.id}/blocked-bots/${bot.bot.id}`, {
    method: 'PUT',
  });
  await expectFailure(
    { chat_id: owner.id, from_chat_id: owner.id, message_id: photoMessage.message_id },
    403,
    'Forbidden: bot was blocked by the user',
  );
});

Deno.test('an account forwards messages to bots, which receive their origin', async () => {
  const { api, sessionPath, owner, member, bot, supergroup, supergroupPath, sendSupergroupText } =
    await createSupergroupFixture();
  const readUpdates = createUpdateReader(api);
  const supergroupChat = { type: 'supergroup', chatId: supergroup.id };
  const privateChat = { type: 'private', botId: bot.bot.id };
  const groupMessage = await sendSupergroupText(member.id, 'Lunch at noon?');
  await readUpdates(bot.botApiPath);
  const forward = (accountId: number, body: Record<string, unknown>) =>
    api.request(`${sessionPath}/accounts/${accountId}/messages`, jsonRequest('POST', body));

  const forwardResponse = await forward(owner.id, {
    to: privateChat,
    forward: { chat: supergroupChat, message_id: groupMessage.message_id },
  });
  const { message: shownForward } = await forwardResponse.json() as {
    message: Record<string, unknown>;
  };
  const [update] = await readUpdates(bot.botApiPath);
  const receivedForward = update?.message as Record<string, unknown> | undefined;
  const expectedOrigin = { type: 'user', sender_user: member, date: groupMessage.date };
  if (
    forwardResponse.status !== 201 ||
    JSON.stringify(shownForward.forward_origin) !== JSON.stringify(expectedOrigin) ||
    JSON.stringify(receivedForward) !== JSON.stringify(shownForward) ||
    (receivedForward?.from as { id?: number } | undefined)?.id !== owner.id ||
    receivedForward?.text !== 'Lunch at noon?'
  ) {
    throw new Error(
      `Expected the bot to receive the account's forward, received ${
        JSON.stringify({ status: forwardResponse.status, shownForward, update })
      }`,
    );
  }

  // The account edits nothing of a forward, and cannot forward protected content.
  const editResponse = await api.request(
    `${sessionPath}/accounts/${owner.id}/conversations/private/${bot.bot.id}/messages/${shownForward.message_id}`,
    jsonRequest('PATCH', { text: 'Edited' }),
  );
  const protectedMessageId = botApiResult(
    (await callBotApi(api, `${bot.botApiPath}/sendMessage`, {
      chat_id: owner.id,
      text: 'Your code is 1234',
      protect_content: true,
    })).body,
  )?.message_id;
  const outsider = await createAccount(api, sessionPath, 'Linus');
  const failureStatuses = [
    editResponse.status,
    (await forward(owner.id, {
      to: supergroupChat,
      forward: { chat: privateChat, message_id: protectedMessageId },
    })).status,
    (await forward(owner.id, {
      to: supergroupChat,
      forward: { chat: privateChat, message_id: 1_000 },
    })).status,
    (await forward(outsider.id, {
      to: privateChat,
      forward: { chat: supergroupChat, message_id: groupMessage.message_id },
    })).status,
    (await forward(owner.id, {
      to: privateChat,
      forward: { chat: supergroupChat, message_id: groupMessage.message_id },
      text: 'Also text',
    })).status,
  ];
  if (JSON.stringify(failureStatuses) !== JSON.stringify([400, 400, 404, 403, 400])) {
    throw new Error(`Expected forwards to be refused, received ${failureStatuses}`);
  }

  const history = await (await api.request(`${supergroupPath(owner.id)}/messages`)).json() as {
    messages: unknown[];
  };
  if (history.messages.length !== 4) {
    throw new Error(`Expected refused forwards to leave the supergroup, received ${history}`);
  }
});

Deno.test('forwards and external replies show only the name of an account with private forwards', async () => {
  const { api, sessionPath, owner, bot, supergroup, supergroupPath, sendSupergroupText } =
    await createSupergroupFixture();
  const readUpdates = createUpdateReader(api);
  const accountResponse = await api.request(
    `${sessionPath}/accounts`,
    jsonRequest('POST', { first_name: 'Hedy', last_name: 'Lamarr', has_private_forwards: true }),
  );
  const invalidAccountResponse = await api.request(
    `${sessionPath}/accounts`,
    jsonRequest('POST', { first_name: 'Hedy', has_private_forwards: 'yes' }),
  );
  const { account: hedy } = await accountResponse.json() as { account: { id: number } };
  await api.request(`${supergroupPath(owner.id)}/members/${hedy.id}`, { method: 'PUT' });
  const hedyMessage = await sendSupergroupText(hedy.id, 'Frequency hopping');
  await readUpdates(bot.botApiPath);

  // A bot forwards the message, and replies to it from its private chat with the owner.
  const forward = botApiResult(
    (await callBotApi(api, `${bot.botApiPath}/forwardMessage`, {
      chat_id: supergroup.id,
      from_chat_id: supergroup.id,
      message_id: hedyMessage.message_id,
    })).body,
  );
  await api.request(
    `${sessionPath}/accounts/${owner.id}/messages`,
    jsonRequest('POST', { to: { type: 'private', botId: bot.bot.id }, text: '/start' }),
  );
  const reply = botApiResult(
    (await callBotApi(api, `${bot.botApiPath}/sendMessage`, {
      chat_id: owner.id,
      text: 'Someone asks',
      reply_parameters: { chat_id: supergroup.id, message_id: hedyMessage.message_id },
    })).body,
  );
  // An account forwards it to the bot, which receives the same origin.
  await readUpdates(bot.botApiPath);
  await api.request(
    `${sessionPath}/accounts/${owner.id}/messages`,
    jsonRequest('POST', {
      to: { type: 'private', botId: bot.bot.id },
      forward: {
        chat: { type: 'supergroup', chatId: supergroup.id },
        message_id: hedyMessage.message_id,
      },
    }),
  );
  const [accountForwardUpdate] = await readUpdates(bot.botApiPath);

  const hiddenOrigin = {
    type: 'hidden_user',
    sender_user_name: 'Hedy Lamarr',
    date: hedyMessage.date,
  };
  const { forward_origin, forward_from, forward_sender_name, forward_date } = forward ?? {};
  if (
    accountResponse.status !== 201 || invalidAccountResponse.status !== 400 ||
    JSON.stringify({ forward_origin, forward_from, forward_sender_name, forward_date }) !==
      JSON.stringify({
        forward_origin: hiddenOrigin,
        forward_sender_name: 'Hedy Lamarr',
        forward_date: hedyMessage.date,
      }) ||
    JSON.stringify((reply?.external_reply as Record<string, unknown>)?.origin) !==
      JSON.stringify(hiddenOrigin) ||
    JSON.stringify((accountForwardUpdate?.message as Record<string, unknown>)?.forward_origin) !==
      JSON.stringify(hiddenOrigin)
  ) {
    throw new Error(
      `Expected the origins to hide the account, received ${
        JSON.stringify({
          accountStatus: accountResponse.status,
          invalidAccountStatus: invalidAccountResponse.status,
          forward,
          reply,
          accountForwardUpdate,
        })
      }`,
    );
  }
});

Deno.test('a grammY support bot forwards questions to its team and copies answers back', async () => {
  const { api, sessionPath, member, bot, supergroup, supergroupPath } =
    await createSupergroupFixture();
  const customer = await createAccount(api, sessionPath, 'Linus');
  const grammyBot = new Bot(bot.token, {
    client: {
      apiRoot: `${TEST_PUBLIC_ORIGIN}${sessionPath}/bot-api`,
      fetch: api.fetch,
    },
  });
  const answerCopied = Promise.withResolvers<void>();
  const questionForwarded = Promise.withResolvers<void>();
  grammyBot.chatType('private').on('message', async (context) => {
    await context.forwardMessage(supergroup.id);
    questionForwarded.resolve();
  });
  grammyBot.chatType('supergroup').on('message', async (context) => {
    const origin = context.message.reply_to_message?.forward_origin;
    if (origin?.type === 'user') {
      await context.copyMessage(origin.sender_user.id);
      answerCopied.resolve();
    }
  });
  const polling = grammyBot.start();

  try {
    await api.request(
      `${sessionPath}/accounts/${customer.id}/messages`,
      jsonRequest('POST', { to: { type: 'private', botId: bot.bot.id }, text: 'Is it open?' }),
    );
    await Promise.race([questionForwarded.promise, polling]);
    const teamHistory = await (await api.request(`${supergroupPath(member.id)}/messages`))
      .json() as { messages: Array<{ message_id: number }> };
    const question = teamHistory.messages.at(-1);
    await api.request(
      `${sessionPath}/accounts/${member.id}/messages`,
      jsonRequest('POST', {
        to: { type: 'supergroup', chatId: supergroup.id },
        text: 'Yes, until 6pm.',
        reply_to_message_id: question?.message_id,
      }),
    );
    await Promise.race([answerCopied.promise, polling]);
  } finally {
    await grammyBot.stop();
    await polling;
  }

  const customerHistory = await (await api.request(
    `${sessionPath}/accounts/${customer.id}/conversations/private/${bot.bot.id}/messages`,
  )).json() as { messages: Array<{ from: { id: number }; text: string }> };
  const shownMessages = customerHistory.messages.map(({ from, text }) => [from.id, text]);
  if (
    JSON.stringify(shownMessages) !==
      JSON.stringify([[customer.id, 'Is it open?'], [bot.bot.id, 'Yes, until 6pm.']])
  ) {
    throw new Error(`Expected the team's answer to be copied back, received ${shownMessages}`);
  }
});
