import { assertEquals } from '@std/assert';
import { Bot } from 'https://cdn.jsdelivr.net/gh/grammyjs/grammY@^1.46.0/src/bot.ts';
import {
  InlineKeyboard,
} from 'https://cdn.jsdelivr.net/gh/grammyjs/grammY@^1.46.0/src/convenience/keyboard.ts';
import { GrammyError } from 'https://cdn.jsdelivr.net/gh/grammyjs/grammY@^1.46.0/src/core/error.ts';

import { createTestSession, jsonRequest, TEST_PUBLIC_ORIGIN } from '../support/emulation_api.ts';
import { assertEqualsInFieldOrder } from '../support/field_order_assertion.ts';
import { isBadRequestResponse } from '../support/http_response_guards.ts';
import { botApiResult, callBotApi, createUpdateReader } from '../support/bot_api_requests.ts';
import {
  createAccount,
  createBot,
  createPrivateConversationFixture,
  createSupergroupFixture,
} from '../support/http_fixtures.ts';
import { FIXED_WALL_CLOCK, TEST_UNIX_TIME_SECONDS } from '../support/fixed_wall_clock.ts';

/**
 * Every emulator here keeps a fixed calendar time, since these tests compare the dates of updates
 * and service messages that separate requests create.
 */
const FIXED_CLOCK_EMULATOR = { wallClock: FIXED_WALL_CLOCK } as const;

Deno.test('an account creates a supergroup and adds a bot, which receives my_chat_member', async () => {
  await using fixture = await createSupergroupFixture(FIXED_CLOCK_EMULATOR);
  const { api, sessionPath, owner, member, bot, readerBot, supergroup, supergroupPath } = fixture;
  if (
    supergroup.type !== 'supergroup' || supergroup.title !== 'Team' ||
    supergroup.id > -1_000_000_000_000
  ) {
    throw new Error(`Expected a created supergroup, received ${JSON.stringify(supergroup)}`);
  }

  const { body } = await callBotApi(api, `${bot.botApiPath}/getUpdates`, {});
  const updates = (body as { result: Array<Record<string, unknown>> }).result;
  const botUser = {
    id: bot.bot.id,
    is_bot: true,
    first_name: bot.bot.first_name,
    username: bot.bot.username,
  };
  const expectedChatMemberUpdate = {
    chat: { id: supergroup.id, title: 'Team', type: 'supergroup' },
    from: owner,
    old_chat_member: { user: botUser, status: 'left' },
    new_chat_member: { user: botUser, status: 'member' },
  };
  const myChatMember = updates[0]?.my_chat_member as Record<string, unknown> | undefined;
  const { date, ...myChatMemberWithoutDate } = myChatMember ?? {};
  if (typeof date !== 'number') {
    throw new Error(`Expected a my_chat_member update first, received ${JSON.stringify(updates)}`);
  }
  assertEqualsInFieldOrder(
    myChatMemberWithoutDate,
    expectedChatMemberUpdate,
    'Expected a my_chat_member update first',
  );
  // The bot then sees the service messages of its own addition and of the next bot's, but not of
  // the account's addition before it joined.
  const joinMessages = updates.slice(1).map((update) => update.message as Record<string, unknown>);
  const readerBotUser = { ...botUser, id: readerBot.bot.id, username: readerBot.bot.username };
  const expectedJoinMessages = [[2, botUser], [3, readerBotUser]].map(([messageId, user]) => ({
    message_id: messageId,
    from: owner,
    chat: expectedChatMemberUpdate.chat,
    date,
    new_chat_participant: user,
    new_chat_member: user,
    new_chat_members: [user],
  }));
  assertEqualsInFieldOrder(
    joinMessages,
    expectedJoinMessages,
    'Expected new_chat_members service messages',
  );

  const membersPath =
    `${sessionPath}/accounts/${owner.id}/conversations/supergroup/${supergroup.id}/members`;
  const additionStatuses = await Promise.all([
    api.request(`${membersPath}/${bot.bot.id}`, { method: 'PUT' }),
    api.request(
      `${sessionPath}/accounts/${member.id}/conversations/supergroup/${supergroup.id}/members/${owner.id}`,
      { method: 'PUT' },
    ),
    api.request(`${membersPath}/999`, { method: 'PUT' }),
    api.request(
      `${sessionPath}/accounts/${owner.id}/conversations/supergroup/-1000000009999/members/${bot.bot.id}`,
      { method: 'PUT' },
    ),
    api.request(
      `${sessionPath}/accounts/${owner.id}/conversations/supergroup/-5/members/${bot.bot.id}`,
      { method: 'PUT' },
    ),
  ]).then((responses) => responses.map((response) => response.status));
  assertEquals(additionStatuses, [204, 403, 404, 404, 400], 'Expected membership checks');
  const repeatedAddition = await callBotApi(api, `${bot.botApiPath}/getUpdates`, {
    offset: (updates.at(-1)?.update_id as number) + 1,
  });
  if ((repeatedAddition.body as { result: unknown[] }).result.length !== 0) {
    throw new Error('Expected adding a member again to send no update');
  }

  const creationFailures = await Promise.all([
    api.request(`${sessionPath}/accounts/999/supergroups`, jsonRequest('POST', { title: 'X' })),
    api.request(`${sessionPath}/accounts/${owner.id}/supergroups`, jsonRequest('POST', {})),
    api.request(
      `${sessionPath}/accounts/${owner.id}/supergroups`,
      jsonRequest('POST', { title: '' }),
    ),
  ]).then((responses) => responses.map((response) => response.status));
  assertEquals(creationFailures, [404, 400, 400], 'Expected supergroup creation checks');

  const readerUpdates = await callBotApi(api, `${readerBot.botApiPath}/getUpdates`, {});
  const readerUpdate = (readerUpdates.body as { result: Array<Record<string, unknown>> }).result;
  if (
    readerUpdate.length !== 2 || readerUpdate[0].my_chat_member === undefined ||
    (readerUpdate[1].message as Record<string, unknown>)?.message_id !== 3
  ) {
    throw new Error(`Expected the second bot to learn it joined, received ${readerUpdate.length}`);
  }
  if (supergroupPath(owner.id) === supergroupPath(member.id)) {
    throw new Error('Expected each account to address the supergroup from its own path');
  }
});

Deno.test('bots in privacy mode receive only supergroup messages addressed to them', async () => {
  await using fixture = await createSupergroupFixture(FIXED_CLOCK_EMULATOR);
  const { api, owner, member, bot, readerBot, supergroup, sendSupergroupText } = fixture;
  const { body: joinBody } = await callBotApi(api, `${bot.botApiPath}/getUpdates`, {});
  const joinUpdates = (joinBody as { result: Array<{ update_id: number }> }).result;
  const { body: readerJoinBody } = await callBotApi(api, `${readerBot.botApiPath}/getUpdates`, {});
  const readerJoinUpdates = (readerJoinBody as { result: Array<{ update_id: number }> }).result;

  const texts = [
    [owner.id, 'Hello team'],
    [member.id, '/start'],
    [member.id, '/help@other_bot'],
    [member.id, '/help@Test_Bot now'],
    [member.id, 'Ask @test_bot about it'],
    [member.id, 'Mail me at me@test_bot.example'],
    [member.id, 'Run /start later'],
  ] as const;
  for (const [accountId, text] of texts) {
    await sendSupergroupText(accountId, text);
  }
  const botQuestion = await callBotApi(api, `${bot.botApiPath}/sendMessage`, {
    chat_id: supergroup.id,
    text: 'Anyone?',
  });
  const botQuestionId = botApiResult(botQuestion.body)?.message_id as number;
  await sendSupergroupText(member.id, 'Me!', botQuestionId);
  await sendSupergroupText(owner.id, 'Replying to Ada', 1);

  const receivedTexts = async (botApiPath: string, afterUpdateId: number) => {
    const { body } = await callBotApi(api, `${botApiPath}/getUpdates`, {
      offset: afterUpdateId + 1,
    });
    return (body as { result: Array<{ message?: { text: string } }> }).result.map((update) =>
      update.message?.text
    );
  };
  const privacyModeTexts = await receivedTexts(
    bot.botApiPath,
    joinUpdates.at(-1)?.update_id as number,
  );
  const readerTexts = await receivedTexts(
    readerBot.botApiPath,
    readerJoinUpdates.at(-1)?.update_id as number,
  );
  const expectedPrivacyModeTexts = [
    '/start',
    '/help@Test_Bot now',
    'Ask @test_bot about it',
    'Me!',
  ];
  assertEqualsInFieldOrder(
    privacyModeTexts,
    expectedPrivacyModeTexts,
    'Expected only addressed messages',
  );
  const expectedReaderTexts = [...texts.map(([, text]) => text), 'Me!', 'Replying to Ada'];
  assertEqualsInFieldOrder(
    readerTexts,
    expectedReaderTexts,
    'Expected every account message and no bot message',
  );
});

Deno.test('supergroup members see the same message IDs and replies', async () => {
  await using fixture = await createSupergroupFixture(FIXED_CLOCK_EMULATOR);
  const { api, sessionPath, owner, member, bot, supergroup, supergroupPath, sendSupergroupText } =
    fixture;
  const question = await sendSupergroupText(owner.id, '/poll');
  const answer = await callBotApi(api, `${bot.botApiPath}/sendMessage`, {
    chat_id: supergroup.id,
    text: 'Which day?',
    reply_parameters: { message_id: question.message_id },
  });
  const answerMessage = botApiResult(answer.body);
  const reply = await sendSupergroupText(member.id, 'Friday', answerMessage?.message_id as number);

  const expectedChat = { id: supergroup.id, title: 'Team', type: 'supergroup' };
  // The service messages of the fixture's three additions are messages 1 to 3.
  if (
    question.message_id !== 4 ||
    answerMessage?.message_id !== 5 ||
    reply.message_id !== 6
  ) {
    throw new Error(`Expected one numbering and replies, received ${JSON.stringify(reply)}`);
  }
  assertEqualsInFieldOrder(answerMessage.chat, expectedChat, 'Expected one numbering and replies');
  assertEquals(
    (answerMessage.reply_to_message as Record<string, unknown>)?.text,
    '/poll',
    'Expected one numbering and replies',
  );
  assertEqualsInFieldOrder(
    (reply as unknown as Record<string, Record<string, unknown>>)
      .reply_to_message?.from,
    {
      id: bot.bot.id,
      is_bot: true,
      first_name: bot.bot.first_name,
      username: bot.bot.username,
    },
    'Expected one numbering and replies',
  );

  const histories = await Promise.all([owner.id, member.id].map(async (accountId) => {
    const response = await api.request(`${supergroupPath(accountId)}/messages`);
    return await response.json() as { messages: Array<{ message_id: number; text?: string }> };
  }));
  assertEqualsInFieldOrder(histories[0], histories[1], 'Expected both members to see one history');
  assertEquals(histories[0].messages.map(({ message_id, text }) => [message_id, text]), [
    [1, undefined],
    [2, undefined],
    [3, undefined],
    [4, '/poll'],
    [5, 'Which day?'],
    [6, 'Friday'],
  ], 'Expected both members to see one history');

  const stranger = await createAccount(api, sessionPath, 'Grace');
  const strangerStatuses = await Promise.all([
    api.request(`${supergroupPath(stranger.id)}/messages`),
    api.request(
      `${sessionPath}/accounts/${stranger.id}/messages`,
      jsonRequest('POST', { to: { type: 'supergroup', chatId: supergroup.id }, text: 'Hi' }),
    ),
    api.request(
      `${sessionPath}/accounts/${owner.id}/messages`,
      jsonRequest('POST', { to: { type: 'supergroup', chatId: -1_000_000_009_999 }, text: 'Hi' }),
    ),
    api.request(
      `${sessionPath}/accounts/${owner.id}/messages`,
      jsonRequest('POST', {
        to: { type: 'supergroup', chatId: supergroup.id },
        text: 'Hi',
        reply_to_message_id: 99,
      }),
    ),
  ]).then((responses) => responses.map((response) => response.status));
  assertEquals(strangerStatuses, [403, 403, 404, 400], 'Expected member checks');
});

Deno.test('Bot API methods follow Telegram checks in supergroups', async () => {
  await using fixture = await createSupergroupFixture(FIXED_CLOCK_EMULATOR);
  const { api, sessionPath, owner, bot, supergroup, supergroupPath, sendSupergroupText } = fixture;
  const accountMessage = await sendSupergroupText(owner.id, 'Hello');
  const botMessage = botApiResult(
    (await callBotApi(api, `${bot.botApiPath}/sendMessage`, {
      chat_id: supergroup.id,
      text: 'Menu',
      reply_markup: { inline_keyboard: [[{ text: 'Go', callback_data: 'go' }]] },
    })).body,
  );
  const botMessageId = botMessage?.message_id as number;
  const outsider = await createBot(api, sessionPath, 'outsider_bot');

  const expectFailure = async (
    botApiPath: string,
    method: string,
    parameters: Record<string, unknown>,
    description: string,
  ) => {
    const { body } = await callBotApi(api, `${botApiPath}/${method}`, parameters);
    if (!isBadRequestResponse(body) || body.description !== description) {
      throw new Error(
        `Expected ${method} to fail with "${description}", received ${JSON.stringify(body)}`,
      );
    }
  };
  await expectFailure(outsider.botApiPath, 'sendMessage', {
    chat_id: supergroup.id,
    text: 'Hi',
  }, 'Bad Request: chat not found');
  await expectFailure(outsider.botApiPath, 'sendChatAction', {
    chat_id: supergroup.id,
    action: 'typing',
  }, 'Bad Request: chat not found');
  await expectFailure(bot.botApiPath, 'sendMessage', {
    chat_id: supergroup.id,
    text: 'Hi',
    reply_parameters: { message_id: 99 },
  }, 'Bad Request: message to be replied not found');
  await expectFailure(bot.botApiPath, 'editMessageText', {
    chat_id: supergroup.id,
    message_id: accountMessage.message_id,
    text: 'Changed',
  }, "Bad Request: message can't be edited");
  await expectFailure(
    bot.botApiPath,
    'editMessageReplyMarkup',
    {
      chat_id: supergroup.id,
      message_id: botMessageId,
      reply_markup: { inline_keyboard: [[{ text: 'Go', callback_data: 'go' }]] },
    },
    'Bad Request: message is not modified: specified new message content and reply markup are exactly the same as a current content and reply markup of the message',
  );
  await expectFailure(bot.botApiPath, 'deleteMessage', {
    chat_id: supergroup.id,
    message_id: accountMessage.message_id,
  }, "Bad Request: message can't be deleted");
  await expectFailure(bot.botApiPath, 'deleteMessages', {
    chat_id: supergroup.id,
    message_ids: [botMessageId, accountMessage.message_id],
  }, "Bad Request: message can't be deleted");

  const edited = await callBotApi(api, `${bot.botApiPath}/editMessageText`, {
    chat_id: supergroup.id,
    message_id: botMessageId,
    text: '<b>Menu</b>',
    parse_mode: 'HTML',
  });
  const editedMessage = botApiResult(edited.body);
  if (
    editedMessage?.message_id !== botMessageId ||
    typeof editedMessage.edit_date !== 'number' ||
    editedMessage.reply_markup !== undefined
  ) {
    throw new Error(
      `Expected the bot's own message to be edited, received ${JSON.stringify(edited)}`,
    );
  }
  assertEqualsInFieldOrder(
    editedMessage.entities,
    [{ type: 'bold', offset: 0, length: 4 }],
    "Expected the bot's own message to be edited",
  );
  const chatAction = await callBotApi(api, `${bot.botApiPath}/sendChatAction`, {
    chat_id: supergroup.id,
    action: 'typing',
  });
  const deletion = await callBotApi(api, `${bot.botApiPath}/deleteMessages`, {
    chat_id: supergroup.id,
    message_ids: [botMessageId, 99],
  });
  const successBody = JSON.stringify({ ok: true, result: true });
  if (
    JSON.stringify(chatAction.body) !== successBody || JSON.stringify(deletion.body) !== successBody
  ) {
    throw new Error('Expected a chat action and the deletion of its own message to succeed');
  }
  const history = await (await api.request(`${supergroupPath(owner.id)}/messages`)).json() as {
    messages: Array<{ text?: string }>;
  };
  const texts = history.messages.flatMap(({ text }) => text === undefined ? [] : [text]);
  assertEquals(texts, ['Hello'], 'Expected only the account message to remain');
});

Deno.test('a grammY bot runs a vote with an inline keyboard in a supergroup', async () => {
  await using fixture = await createSupergroupFixture(FIXED_CLOCK_EMULATOR);
  const { api, sessionPath, owner, member, bot, supergroup, supergroupPath, sendSupergroupText } =
    fixture;
  const grammyBot = new Bot(bot.token, {
    client: {
      apiRoot: `${TEST_PUBLIC_ORIGIN}${sessionPath}/bot-api`,
      fetch: api.fetch,
    },
  });
  const votes = new Map<number, string>();
  const handled = {
    joined: Promise.withResolvers<void>(),
    vote: Promise.withResolvers<void>(),
    press: Promise.withResolvers<void>(),
    edit: Promise.withResolvers<void>(),
  };
  const chatTypes: string[] = [];
  grammyBot.on('my_chat_member', (context) => {
    chatTypes.push(context.chat.type);
    handled.joined.resolve();
  });
  grammyBot.command('vote', async (context) => {
    chatTypes.push(context.chat.type);
    await context.reply(`Vote on: ${context.match}`, {
      reply_markup: new InlineKeyboard().text('Yes', 'yes').text('No', 'no'),
    });
    handled.vote.resolve();
  });
  grammyBot.callbackQuery(['yes', 'no'], async (context) => {
    votes.set(context.from.id, context.callbackQuery.data);
    await context.answerCallbackQuery({ text: `Voted ${context.callbackQuery.data}` });
    await context.editMessageText(`Votes: ${votes.size}`);
    handled.press.resolve();
  });
  grammyBot.on('edited_message:text', (context) => {
    chatTypes.push(`edited ${context.editedMessage.text}`);
    handled.edit.resolve();
  });
  const polling = grammyBot.start();

  let pressedQuery: Record<string, unknown> | undefined;
  try {
    await Promise.race([handled.joined.promise, polling]);
    const command = await sendSupergroupText(member.id, '/vote@test_bot Pizza');
    await Promise.race([handled.vote.promise, polling]);
    const history = await (await api.request(`${supergroupPath(owner.id)}/messages`)).json() as {
      messages: Array<{ message_id: number; text: string }>;
    };
    const voteMessage = history.messages.at(-1);
    const pressResponse = await api.request(
      `${sessionPath}/accounts/${owner.id}/callback-queries`,
      jsonRequest('POST', {
        chat: { type: 'supergroup', chatId: supergroup.id },
        message_id: voteMessage?.message_id,
        callback_data: 'yes',
      }),
    );
    pressedQuery = (await pressResponse.json() as { callback_query: Record<string, unknown> })
      .callback_query;
    await Promise.race([handled.press.promise, polling]);
    await api.request(
      `${supergroupPath(member.id)}/messages/${command.message_id}`,
      jsonRequest('PATCH', { text: '/vote@test_bot Pasta' }),
    );
    await Promise.race([handled.edit.promise, polling]);
  } finally {
    await grammyBot.stop();
    await polling;
  }

  const answered = await (await api.request(
    `${sessionPath}/accounts/${owner.id}/callback-queries/${pressedQuery?.id}`,
  )).json() as { callback_query: { answer: unknown } };
  assertEqualsInFieldOrder(answered.callback_query.answer, {
    text: 'Voted yes',
    show_alert: false,
    cache_time: 0,
  }, 'Expected the voter to see the answer');
  const history = await (await api.request(`${supergroupPath(member.id)}/messages`)).json() as {
    messages: Array<{ text?: string; reply_markup?: unknown }>;
  };
  const textMessages = history.messages.filter(({ text }) => text !== undefined);
  if (textMessages[1].reply_markup !== undefined) {
    throw new Error(`Expected the vote to run in the group, received ${JSON.stringify(history)}`);
  }
  assertEquals(
    textMessages.map(({ text }) => text),
    ['/vote@test_bot Pasta', 'Votes: 1'],
    'Expected the vote to run in the group',
  );
  assertEquals(
    chatTypes,
    ['supergroup', 'supergroup', 'edited /vote@test_bot Pasta'],
    'Expected the vote to run in the group',
  );
});

Deno.test('members leave or are removed from supergroups, which bots see as service messages', async () => {
  await using fixture = await createSupergroupFixture(FIXED_CLOCK_EMULATOR);
  const { api, sessionPath, owner, member, bot, readerBot, supergroup, supergroupPath } = fixture;
  const readNewUpdates = createUpdateReader(api);
  await readNewUpdates(bot.botApiPath);
  await readNewUpdates(readerBot.botApiPath);
  const membersPath = `${supergroupPath(owner.id)}/members`;
  const botUser = (created: typeof bot) => ({
    id: created.bot.id,
    is_bot: true,
    first_name: created.bot.first_name,
    username: created.bot.username,
  });
  const chat = { id: supergroup.id, title: 'Team', type: 'supergroup' };
  // Update IDs and dates vary between runs.
  const withoutDates = (updates: Array<Record<string, unknown>>) =>
    updates.map(({ update_id: _updateId, ...update }) =>
      Object.fromEntries(
        Object.entries(update).map(([type, payload]) => {
          const { date: _date, ...payloadWithoutDate } = payload as Record<string, unknown>;
          return [type, payloadWithoutDate];
        }),
      )
    );

  // An account that leaves is announced to every bot, privacy mode notwithstanding.
  const leaving = await api.request(`${supergroupPath(member.id)}/members/${member.id}`, {
    method: 'DELETE',
  });
  const memberLeftMessage = {
    message_id: 4,
    from: member,
    chat,
    left_chat_participant: member,
    left_chat_member: member,
  };
  const botUpdatesAfterLeaving = withoutDates(await readNewUpdates(bot.botApiPath));
  const readerUpdatesAfterLeaving = withoutDates(await readNewUpdates(readerBot.botApiPath));
  const formerMemberStatuses = await Promise.all([
    api.request(`${supergroupPath(member.id)}/messages`),
    api.request(`${supergroupPath(member.id)}/members/${member.id}`, { method: 'DELETE' }),
  ]).then((responses) => responses.map((response) => response.status));
  if (leaving.status !== 204) {
    throw new Error(
      `Expected the member to leave, received ${JSON.stringify(botUpdatesAfterLeaving)}`,
    );
  }
  assertEqualsInFieldOrder(
    botUpdatesAfterLeaving,
    [{ message: memberLeftMessage }],
    'Expected the member to leave',
  );
  assertEqualsInFieldOrder(
    readerUpdatesAfterLeaving,
    botUpdatesAfterLeaving,
    'Expected the member to leave',
  );
  assertEquals(formerMemberStatuses, [403, 204], 'Expected the member to leave');

  // A bot the owner removes is banned: it learns so, and Telegram turns it away from then on.
  const removal = await api.request(`${membersPath}/${bot.bot.id}`, { method: 'DELETE' });
  const botLeftMessage = {
    message_id: 5,
    from: owner,
    chat,
    left_chat_participant: botUser(bot),
    left_chat_member: botUser(bot),
  };
  const expectedRemovalUpdates = [
    {
      my_chat_member: {
        chat,
        from: owner,
        old_chat_member: { user: botUser(bot), status: 'member' },
        new_chat_member: { user: botUser(bot), status: 'kicked', until_date: 0 },
      },
    },
    { message: botLeftMessage },
  ];
  const removedBotUpdates = withoutDates(await readNewUpdates(bot.botApiPath));
  const readerUpdatesAfterRemoval = withoutDates(await readNewUpdates(readerBot.botApiPath));
  if (removal.status !== 204) {
    throw new Error(
      `Expected the bot to learn it was removed, received ${
        JSON.stringify([removedBotUpdates, readerUpdatesAfterRemoval])
      }`,
    );
  }
  assertEqualsInFieldOrder(
    removedBotUpdates,
    expectedRemovalUpdates,
    'Expected the bot to learn it was removed',
  );
  assertEqualsInFieldOrder(
    readerUpdatesAfterRemoval,
    [{ message: botLeftMessage }],
    'Expected the bot to learn it was removed',
  );
  const kickedDescription = 'Forbidden: bot was kicked from the supergroup chat';
  const removedBotResponses = await Promise.all([
    callBotApi(api, `${bot.botApiPath}/sendMessage`, { chat_id: supergroup.id, text: 'Hi' }),
    callBotApi(api, `${bot.botApiPath}/sendChatAction`, {
      chat_id: supergroup.id,
      action: 'typing',
    }),
    callBotApi(api, `${bot.botApiPath}/leaveChat`, { chat_id: supergroup.id }),
  ]);
  assertEqualsInFieldOrder(
    removedBotResponses.map(({ status, body }) => ({ status, body })),
    Array(3).fill({
      status: 403,
      body: { ok: false, error_code: 403, description: kickedDescription },
    }),
    'Expected a removed bot to be turned away',
  );

  // Adding the bot again lifts its ban.
  await api.request(`${membersPath}/${bot.bot.id}`, { method: 'PUT' });
  const readditionUpdates = withoutDates(await readNewUpdates(bot.botApiPath));
  const readdedChatMember = readditionUpdates[0]?.my_chat_member as Record<string, unknown>;
  if (readditionUpdates.length !== 2) {
    throw new Error(`Expected the bot to rejoin, received ${JSON.stringify(readditionUpdates)}`);
  }
  assertEqualsInFieldOrder(readdedChatMember?.old_chat_member, {
    user: botUser(bot),
    status: 'kicked',
    until_date: 0,
  }, 'Expected the bot to rejoin');
  await readNewUpdates(readerBot.botApiPath);

  // A bot that leaves learns of its own departure. As a service message, it reaches other bots too.
  const readerLeaving = await callBotApi(api, `${readerBot.botApiPath}/leaveChat`, {
    chat_id: supergroup.id,
  });
  const readerLeftMessage = {
    message_id: 7,
    from: botUser(readerBot),
    chat,
    left_chat_participant: botUser(readerBot),
    left_chat_member: botUser(readerBot),
  };
  const expectedLeavingUpdates = [
    {
      my_chat_member: {
        chat,
        from: botUser(readerBot),
        old_chat_member: { user: botUser(readerBot), status: 'member' },
        new_chat_member: { user: botUser(readerBot), status: 'left' },
      },
    },
    { message: readerLeftMessage },
  ];
  const readerLeavingUpdates = withoutDates(await readNewUpdates(readerBot.botApiPath));
  const botUpdatesAfterReaderLeft = withoutDates(await readNewUpdates(bot.botApiPath));
  assertEqualsInFieldOrder(
    readerLeaving.body,
    { ok: true, result: true },
    'Expected the reader bot to leave',
  );
  assertEqualsInFieldOrder(
    readerLeavingUpdates,
    expectedLeavingUpdates,
    'Expected the reader bot to leave',
  );
  assertEqualsInFieldOrder(
    botUpdatesAfterReaderLeft,
    [{ message: readerLeftMessage }],
    'Expected the reader bot to leave',
  );
  const notMemberDescription = 'Forbidden: bot is not a member of the supergroup chat';
  const leftBotResponses = await Promise.all([
    callBotApi(api, `${readerBot.botApiPath}/sendMessage`, {
      chat_id: supergroup.id,
      text: 'Hi',
    }),
    callBotApi(api, `${readerBot.botApiPath}/leaveChat`, { chat_id: supergroup.id }),
  ]);
  if (
    !leftBotResponses.every(({ status, body }) =>
      status === 403 && (body as { description?: string }).description === notMemberDescription
    )
  ) {
    throw new Error(
      `Expected a bot that left to be turned away, received ${JSON.stringify(leftBotResponses)}`,
    );
  }

  const history = await (await api.request(`${supergroupPath(owner.id)}/messages`)).json() as {
    messages: Array<Record<string, unknown>>;
  };
  const leftMemberIds = history.messages.flatMap((message) =>
    'left_chat_member' in message ? [(message.left_chat_member as { id: number }).id] : []
  );
  assertEqualsInFieldOrder(
    leftMemberIds,
    [member.id, bot.bot.id, readerBot.bot.id],
    'Expected the departures in the history',
  );

  const outsider = await createAccount(api, sessionPath, 'Linus');
  const memberRouteStatuses = await Promise.all([
    api.request(`${membersPath}/${owner.id}`, { method: 'DELETE' }),
    api.request(`${supergroupPath(outsider.id)}/members/${bot.bot.id}`, { method: 'DELETE' }),
    api.request(`${membersPath}/${outsider.id}`, { method: 'DELETE' }),
    api.request(`${membersPath}/999`, { method: 'DELETE' }),
    api.request(
      `${sessionPath}/accounts/${owner.id}/conversations/supergroup/-1000000009999/members/${bot.bot.id}`,
      { method: 'DELETE' },
    ),
    api.request(`${sessionPath}/accounts/${owner.id}/conversations/supergroup/-5/members/1`, {
      method: 'DELETE',
    }),
  ]).then((responses) => responses.map((response) => response.status));
  assertEquals(memberRouteStatuses, [409, 403, 204, 404, 404, 400], 'Expected membership checks');
});

Deno.test('leaveChat follows Telegram checks outside supergroups', async () => {
  await using fixture = await createPrivateConversationFixture(undefined, FIXED_CLOCK_EMULATOR);
  const { api, sessionPath, botApiPath, createdAccount, sendText } = fixture;
  const stranger = await createAccount(api, sessionPath, 'Grace');
  await sendText('/start');

  const responses = await Promise.all([
    callBotApi(api, `${botApiPath}/leaveChat`, { chat_id: createdAccount.account.id }),
    callBotApi(api, `${botApiPath}/leaveChat`, { chat_id: stranger.id }),
    callBotApi(api, `${botApiPath}/leaveChat`, { chat_id: -1_000_000_009_999 }),
    callBotApi(api, `${botApiPath}/leaveChat`, {}),
  ]);
  const descriptions = responses.map(({ body }) => (body as { description?: string }).description);
  const expectedDescriptions = [
    "Bad Request: can't leave private chats",
    'Bad Request: chat not found',
    'Bad Request: chat not found',
    'Bad Request: chat_id is empty',
  ];
  if (!responses.every(({ status }) => status === 400)) {
    throw new Error(`Expected leaveChat checks, received ${JSON.stringify(responses)}`);
  }
  assertEqualsInFieldOrder(descriptions, expectedDescriptions, 'Expected leaveChat checks');
});

Deno.test('a grammY bot welcomes new members and learns it was removed', async () => {
  await using fixture = await createSupergroupFixture(
    FIXED_CLOCK_EMULATOR,
  );
  const { api, sessionPath, owner, bot, supergroupPath } = fixture;
  const newcomer = await createAccount(api, sessionPath, 'Linus');
  const grammyBot = new Bot(bot.token, {
    client: {
      apiRoot: `${TEST_PUBLIC_ORIGIN}${sessionPath}/bot-api`,
      fetch: api.fetch,
    },
  });
  const handled = {
    welcome: Promise.withResolvers<void>(),
    farewell: Promise.withResolvers<void>(),
    removal: Promise.withResolvers<void>(),
  };
  let removalError: unknown;
  grammyBot.on('message:new_chat_members', async (context) => {
    const names = context.message.new_chat_members.map(({ first_name }) => first_name);
    if (names.includes('Linus')) {
      await context.reply(`Welcome, ${names.join(', ')}!`, {
        reply_parameters: { message_id: context.message.message_id },
      });
      handled.welcome.resolve();
    }
  });
  grammyBot.on('message:left_chat_member', async (context) => {
    if (context.message.left_chat_member.id === newcomer.id) {
      await context.reply(`Goodbye, ${context.message.left_chat_member.first_name}.`);
      handled.farewell.resolve();
    }
  });
  grammyBot.on('my_chat_member', async (context) => {
    if (context.myChatMember.new_chat_member.status === 'kicked') {
      removalError = await context.reply('Why?').catch((error: unknown) => error);
      handled.removal.resolve();
    }
  });
  const polling = grammyBot.start();

  try {
    await api.request(`${supergroupPath(owner.id)}/members/${newcomer.id}`, { method: 'PUT' });
    await Promise.race([handled.welcome.promise, polling]);
    await api.request(`${supergroupPath(newcomer.id)}/members/${newcomer.id}`, {
      method: 'DELETE',
    });
    await Promise.race([handled.farewell.promise, polling]);
    await api.request(`${supergroupPath(owner.id)}/members/${bot.bot.id}`, { method: 'DELETE' });
    await Promise.race([handled.removal.promise, polling]);
  } finally {
    await grammyBot.stop();
    await polling;
  }

  const history = await (await api.request(`${supergroupPath(owner.id)}/messages`)).json() as {
    messages: Array<
      { message_id: number; text?: string; reply_to_message?: { message_id: number } }
    >;
  };
  const replies = history.messages.flatMap(({ text, reply_to_message }) =>
    text === undefined ? [] : [[text, reply_to_message?.message_id]]
  );
  assertEquals(
    replies,
    [['Welcome, Linus!', 4], ['Goodbye, Linus.', undefined]],
    'Expected a welcome and a farewell',
  );
  if (
    !(removalError instanceof GrammyError) || removalError.error_code !== 403 ||
    removalError.description !== 'Forbidden: bot was kicked from the supergroup chat'
  ) {
    throw new Error(`Expected the removed bot to be turned away, received ${removalError}`);
  }
});

Deno.test('the owner promotes administrators, whom bots find with getChatMember and getChatAdministrators', async () => {
  await using fixture = await createSupergroupFixture(FIXED_CLOCK_EMULATOR);
  const { api, sessionPath, owner, member, bot, readerBot, supergroup, supergroupPath } = fixture;
  const outsider = await createAccount(api, sessionPath, 'Linus');
  const readNewUpdates = createUpdateReader(api);
  await readNewUpdates(bot.botApiPath);
  const administratorsPath = `${supergroupPath(owner.id)}/administrators`;
  const botUser = (created: typeof bot) => ({
    id: created.bot.id,
    is_bot: true,
    first_name: created.bot.first_name,
    username: created.bot.username,
  });
  const chat = { id: supergroup.id, title: 'Team', type: 'supergroup' };

  const promotionStatuses = await Promise.all([
    api.request(
      `${administratorsPath}/${bot.bot.id}`,
      jsonRequest('PUT', { can_delete_messages: true, can_restrict_members: true }),
    ),
    api.request(
      `${administratorsPath}/${readerBot.bot.id}`,
      jsonRequest('PUT', { can_pin_messages: true }),
    ),
  ]).then((responses) => responses.map((response) => response.status));
  const promotionUpdates = await readNewUpdates(bot.botApiPath);
  const promotedBot = administratorMember(botUser(bot), [
    'can_manage_chat',
    'can_delete_messages',
    'can_restrict_members',
  ]);
  const promotion = promotionUpdates[0]?.my_chat_member as Record<string, unknown> | undefined;
  if (promotionUpdates.length !== 1) {
    throw new Error(
      `Expected the bot to learn of its promotion, received ${JSON.stringify(promotionUpdates)}`,
    );
  }
  assertEquals(promotionStatuses, [204, 204], 'Expected the bot to learn of its promotion');
  assertEqualsInFieldOrder({ ...promotion, date: 0 }, {
    chat,
    from: owner,
    date: 0,
    old_chat_member: { user: botUser(bot), status: 'member' },
    new_chat_member: promotedBot,
  }, 'Expected the bot to learn of its promotion');

  const getChatMember = (userId: number) =>
    callBotApi(api, `${bot.botApiPath}/getChatMember`, { chat_id: supergroup.id, user_id: userId })
      .then(({ body }) => (body as { result: unknown }).result);
  const members = await Promise.all(
    [owner.id, member.id, bot.bot.id, outsider.id].map(getChatMember),
  );
  const expectedMembers = [
    { user: owner, status: 'creator', is_anonymous: false },
    { user: member, status: 'member' },
    promotedBot,
    { user: outsider, status: 'left' },
  ];
  assertEqualsInFieldOrder(members, expectedMembers, "Expected each user's standing");

  // As on Telegram, administrators that are other bots are listed only when requested.
  const [administrators, administratorsWithBots, memberCount] = await Promise.all([
    callBotApi(api, `${bot.botApiPath}/getChatAdministrators`, { chat_id: supergroup.id }),
    callBotApi(api, `${bot.botApiPath}/getChatAdministrators`, {
      chat_id: supergroup.id,
      return_bots: true,
    }),
    callBotApi(api, `${bot.botApiPath}/getChatMemberCount`, { chat_id: supergroup.id }),
  ]).then((responses) => responses.map(({ body }) => (body as { result: unknown }).result));
  const owningMember = expectedMembers[0];
  const promotedReader = administratorMember(botUser(readerBot), [
    'can_manage_chat',
    'can_pin_messages',
  ]);
  if (memberCount !== 4) {
    throw new Error(
      `Expected the administrators and member count, received ${
        JSON.stringify([administrators, administratorsWithBots, memberCount])
      }`,
    );
  }
  assertEqualsInFieldOrder(
    administrators,
    [owningMember, promotedBot],
    'Expected the administrators and member count',
  );
  assertEqualsInFieldOrder(
    administratorsWithBots,
    [owningMember, promotedBot, promotedReader],
    'Expected the administrators and member count',
  );

  const failures = await Promise.all([
    callBotApi(api, `${bot.botApiPath}/getChatMember`, { chat_id: supergroup.id }),
    callBotApi(api, `${bot.botApiPath}/getChatMember`, { user_id: owner.id }),
    callBotApi(api, `${bot.botApiPath}/getChatMember`, { chat_id: supergroup.id, user_id: 999 }),
    callBotApi(api, `${bot.botApiPath}/getChatMember`, {
      chat_id: -1_000_000_009_999,
      user_id: owner.id,
    }),
    callBotApi(api, `${bot.botApiPath}/getChatAdministrators`, {}),
  ]);
  const failureDescriptions = failures.map(({ body }) =>
    (body as { description?: string }).description
  );
  assertEquals(failureDescriptions, [
    'Bad Request: invalid user_id specified',
    'Bad Request: chat_id is empty',
    'Bad Request: member not found',
    'Bad Request: chat not found',
    'Bad Request: chat_id is empty',
  ], "Expected Telegram's checks");

  // Only the owner changes roles, only of other members, and a promotion grants some right.
  const routeStatuses = await Promise.all([
    api.request(
      `${supergroupPath(member.id)}/administrators/${bot.bot.id}`,
      jsonRequest('PUT', { can_delete_messages: true }),
    ),
    api.request(
      `${administratorsPath}/${owner.id}`,
      jsonRequest('PUT', { can_delete_messages: true }),
    ),
    api.request(
      `${administratorsPath}/${outsider.id}`,
      jsonRequest('PUT', { can_delete_messages: true }),
    ),
    api.request(`${administratorsPath}/999`, jsonRequest('PUT', { can_delete_messages: true })),
    api.request(`${administratorsPath}/${member.id}`, jsonRequest('PUT', {})),
    api.request(
      `${administratorsPath}/${member.id}`,
      jsonRequest('PUT', { can_delete_messages: false }),
    ),
    api.request(`${administratorsPath}/${member.id}`, jsonRequest('PUT', { can_fly: true })),
  ]).then((responses) => responses.map((response) => response.status));
  assertEquals(
    routeStatuses,
    [403, 409, 409, 404, 400, 400, 400],
    'Expected administrator route checks',
  );

  const demotionStatuses = await Promise.all([
    api.request(`${administratorsPath}/${bot.bot.id}`, { method: 'DELETE' }),
    api.request(`${administratorsPath}/${bot.bot.id}`, { method: 'DELETE' }),
  ]).then((responses) => responses.map((response) => response.status));
  const demotionUpdates = await readNewUpdates(bot.botApiPath);
  const demotion = demotionUpdates[0]?.my_chat_member as Record<string, unknown> | undefined;
  if (demotionUpdates.length !== 1) {
    throw new Error(
      `Expected the bot to be demoted once, received ${JSON.stringify(demotionUpdates)}`,
    );
  }
  assertEquals(demotionStatuses, [204, 204], 'Expected the bot to be demoted once');
  assertEqualsInFieldOrder([demotion?.old_chat_member, demotion?.new_chat_member], [promotedBot, {
    user: botUser(bot),
    status: 'member',
  }], 'Expected the bot to be demoted once');
});

Deno.test('getChat shows private chats and supergroups as the official server does', async () => {
  await using fixture = await createSupergroupFixture(FIXED_CLOCK_EMULATOR);
  const { api, sessionPath, owner, bot, readerBot, supergroup, supergroupPath } = fixture;
  const getChat = async (chatId: number | string, botApiPath = bot.botApiPath) => {
    const { status, body } = await callBotApi(api, `${botApiPath}/getChat`, { chat_id: chatId });
    return { status, body: body as { result?: unknown; description?: string } };
  };
  const linus = await createAccount(api, sessionPath, 'Linus', {
    last_name: 'Torvalds',
    username: 'linus',
    has_private_forwards: true,
  });
  for (const accountId of [owner.id, linus.id]) {
    await api.request(
      `${sessionPath}/accounts/${accountId}/messages`,
      jsonRequest('POST', { to: { type: 'private', botId: bot.bot.id }, text: '/start' }),
    );
  }
  const publicResponse = await api.request(
    `${sessionPath}/accounts/${owner.id}/supergroups`,
    jsonRequest('POST', { title: 'Open', username: 'open_team', description: 'Everyone' }),
  );
  const { supergroup: publicSupergroup } = await publicResponse.json() as {
    supergroup: { id: number };
  };
  await api.request(`${supergroupPath(owner.id)}/content-protection`, { method: 'PUT' });

  // Accent colors default to TDLib's AccentColorId of the user or channel, modulo 7.
  const allGiftTypes = (accepted: boolean) => ({
    unlimited_gifts: accepted,
    limited_gifts: accepted,
    unique_gifts: accepted,
    premium_subscription: accepted,
    gifts_from_channels: accepted,
  });
  const channelAccentColor = (chatId: number) => (-chatId - 1_000_000_000_000) % 7;
  const everyPermission = Object.fromEntries(
    [
      'can_send_messages',
      'can_send_media_messages',
      'can_send_audios',
      'can_send_documents',
      'can_send_photos',
      'can_send_videos',
      'can_send_video_notes',
      'can_send_voice_notes',
      'can_send_polls',
      'can_send_other_messages',
      'can_add_web_page_previews',
      'can_react_to_messages',
      'can_edit_tag',
      'can_change_info',
      'can_invite_users',
      'can_pin_messages',
      'can_manage_topics',
    ].map((permission) => [permission, true]),
  );
  const expectedChats = [
    {
      id: owner.id,
      first_name: 'Ada',
      type: 'private',
      can_send_gift: true,
      accepted_gift_types: allGiftTypes(true),
      max_reaction_count: 11,
      accent_color_id: owner.id % 7,
    },
    {
      id: linus.id,
      first_name: 'Linus',
      last_name: 'Torvalds',
      username: 'linus',
      type: 'private',
      can_send_gift: true,
      active_usernames: ['linus'],
      has_private_forwards: true,
      accepted_gift_types: allGiftTypes(true),
      max_reaction_count: 11,
      accent_color_id: linus.id % 7,
    },
    {
      id: supergroup.id,
      title: 'Team',
      type: 'supergroup',
      has_visible_history: true,
      permissions: everyPermission,
      join_to_send_messages: true,
      accepted_gift_types: allGiftTypes(false),
      max_reaction_count: 11,
      accent_color_id: channelAccentColor(supergroup.id),
      has_protected_content: true,
    },
    {
      id: publicSupergroup.id,
      title: 'Open',
      username: 'open_team',
      type: 'supergroup',
      active_usernames: ['open_team'],
      description: 'Everyone',
      has_visible_history: true,
      permissions: everyPermission,
      join_to_send_messages: true,
      accepted_gift_types: allGiftTypes(false),
      max_reaction_count: 11,
      accent_color_id: channelAccentColor(publicSupergroup.id),
    },
  ];
  // A public supergroup is readable by bots that are not members, also by its username.
  const chats = await Promise.all(
    [owner.id, linus.id, supergroup.id, '@OPEN_TEAM'].map(async (chatId) =>
      (await getChat(chatId)).body.result
    ),
  );
  assertEqualsInFieldOrder(chats, expectedChats, 'Expected full chat information');

  // A bot that left a private supergroup is turned away, and a removed bot even from a public one.
  await callBotApi(api, `${readerBot.botApiPath}/leaveChat`, { chat_id: supergroup.id });
  await api.request(`${supergroupPath(owner.id)}/members/${bot.bot.id}`, { method: 'DELETE' });
  const publicMembersPath =
    `${sessionPath}/accounts/${owner.id}/conversations/supergroup/${publicSupergroup.id}/members`;
  await api.request(`${publicMembersPath}/${readerBot.bot.id}`, { method: 'PUT' });
  await api.request(`${publicMembersPath}/${readerBot.bot.id}`, { method: 'DELETE' });
  const failures = await Promise.all([
    getChat(supergroup.id, readerBot.botApiPath),
    getChat(supergroup.id),
    getChat(publicSupergroup.id, readerBot.botApiPath),
    getChat(-1_000_000_009_999),
    getChat(owner.id, readerBot.botApiPath),
    getChat(readerBot.bot.id),
    callBotApi(api, `${bot.botApiPath}/getChat`, {}).then(({ status, body }) => ({
      status,
      body: body as { description?: string },
    })),
  ]);
  const expectedFailures = [
    [403, 'Forbidden: bot is not a member of the supergroup chat'],
    [403, 'Forbidden: bot was kicked from the supergroup chat'],
    [403, 'Forbidden: bot was kicked from the supergroup chat'],
    [400, 'Bad Request: chat not found'],
    [400, 'Bad Request: chat not found'],
    [400, 'Bad Request: chat not found'],
    [400, 'Bad Request: chat_id is empty'],
  ];
  const receivedFailures = failures.map(({ status, body }) => [status, body.description]);
  assertEqualsInFieldOrder(receivedFailures, expectedFailures, "Expected Telegram's access checks");
});

Deno.test('the owner sets custom titles, which bots see but cannot change', async () => {
  await using fixture = await createSupergroupFixture(FIXED_CLOCK_EMULATOR);
  const { api, sessionPath, owner, member, bot, readerBot, supergroup, supergroupPath } = fixture;
  const readNewUpdates = createUpdateReader(api);
  const administratorsPath = `${supergroupPath(owner.id)}/administrators`;
  const setCustomTitle = async (userId: number, customTitle: unknown, actorId = owner.id) =>
    (await api.request(
      `${supergroupPath(actorId)}/administrators/${userId}/custom-title`,
      jsonRequest('PUT', { custom_title: customTitle }),
    )).status;
  const getChatMember = (userId: number) =>
    callBotApi(api, `${bot.botApiPath}/getChatMember`, { chat_id: supergroup.id, user_id: userId })
      .then(({ body }) => botApiResult(body));
  const botUser = {
    id: readerBot.bot.id,
    is_bot: true,
    first_name: readerBot.bot.first_name,
    username: readerBot.bot.username,
  };

  await api.request(
    `${administratorsPath}/${bot.bot.id}`,
    jsonRequest('PUT', { can_delete_messages: true }),
  );
  await api.request(
    `${administratorsPath}/${readerBot.bot.id}`,
    jsonRequest('PUT', { can_pin_messages: true }),
  );
  await readNewUpdates(readerBot.botApiPath);
  const titleStatuses = [
    await setCustomTitle(owner.id, 'Founder'),
    await setCustomTitle(readerBot.bot.id, 'Pin keeper'),
  ];
  const [titleUpdate] = await readNewUpdates(readerBot.botApiPath);
  const titledAdministrator = {
    ...administratorMember(botUser, ['can_manage_chat', 'can_pin_messages']),
    custom_title: 'Pin keeper',
  };
  const titleChange = titleUpdate?.my_chat_member as Record<string, unknown> | undefined;
  assertEquals(titleStatuses, [204, 204], 'Expected bots to see the custom titles');
  assertEqualsInFieldOrder(await getChatMember(owner.id), {
    user: owner,
    status: 'creator',
    custom_title: 'Founder',
    is_anonymous: false,
  }, 'Expected bots to see the custom titles');
  assertEqualsInFieldOrder(
    await getChatMember(readerBot.bot.id),
    titledAdministrator,
    'Expected bots to see the custom titles',
  );
  assertEqualsInFieldOrder(
    titleChange?.new_chat_member,
    titledAdministrator,
    'Expected bots to see the custom titles',
  );

  // New rights keep the title, while demotion and an empty title drop it.
  await api.request(
    `${administratorsPath}/${readerBot.bot.id}`,
    jsonRequest('PUT', { can_pin_messages: true, can_invite_users: true }),
  );
  const repromoted = await getChatMember(readerBot.bot.id);
  await api.request(`${administratorsPath}/${readerBot.bot.id}`, { method: 'DELETE' });
  await api.request(
    `${administratorsPath}/${readerBot.bot.id}`,
    jsonRequest('PUT', { can_pin_messages: true }),
  );
  const untitledStatus = await setCustomTitle(owner.id, '');
  const administrators = await callBotApi(api, `${bot.botApiPath}/getChatAdministrators`, {
    chat_id: supergroup.id,
    return_bots: true,
  }).then(({ body }) => botApiResult(body) as unknown as Array<{ custom_title?: string }>);
  if (
    repromoted?.custom_title !== 'Pin keeper' || untitledStatus !== 204 ||
    administrators.some((administrator) => administrator.custom_title !== undefined)
  ) {
    throw new Error(
      `Expected new rights to keep a title and demotion to drop it, received ${
        JSON.stringify([repromoted, administrators])
      }`,
    );
  }

  const failedStatuses = [
    await setCustomTitle(readerBot.bot.id, 'x'.repeat(17)),
    await setCustomTitle(readerBot.bot.id, 'Pin keeper 📌'),
    await setCustomTitle(readerBot.bot.id, 16),
    await setCustomTitle(member.id, 'Guest'),
    await setCustomTitle(readerBot.bot.id, 'Mine', member.id),
  ];
  assertEquals(failedStatuses, [400, 400, 400, 409, 403], 'Expected invalid titles to be refused');

  const setByBot = async (chatId: number, userId: number) => {
    const { body } = await callBotApi(
      api,
      `${bot.botApiPath}/setChatAdministratorCustomTitle`,
      { chat_id: chatId, user_id: userId, custom_title: 'Helper' },
    );
    return isBadRequestResponse(body) ? body.description : JSON.stringify(body);
  };
  await api.request(
    `${sessionPath}/accounts/${owner.id}/messages`,
    jsonRequest('POST', { to: { type: 'private', botId: bot.bot.id }, text: '/start' }),
  );
  const botFailures = [
    await setByBot(supergroup.id, owner.id),
    await setByBot(supergroup.id, member.id),
    await setByBot(supergroup.id, readerBot.bot.id),
    await setByBot(supergroup.id, bot.bot.id),
    await setByBot(owner.id, owner.id),
  ];
  const expectedFailures = [
    'Bad Request: only the owner can edit their custom title',
    'Bad Request: user is not an administrator',
    'Bad Request: not enough rights to change custom title of the user',
    'Bad Request: not enough rights to change custom title of the user',
    'Bad Request: method is available only in groups and supergroups',
  ];
  assertEqualsInFieldOrder(
    botFailures,
    expectedFailures,
    "Expected Telegram's custom title errors",
  );
});

Deno.test('bots with can_change_info change a supergroup title and description', async () => {
  await using fixture = await createSupergroupFixture(
    FIXED_CLOCK_EMULATOR,
  );
  const { api, owner, bot, readerBot, supergroup, supergroupPath } = fixture;
  const readUpdates = createUpdateReader(api);
  const setTitle = (title: string) =>
    callBotApi(api, `${bot.botApiPath}/setChatTitle`, { chat_id: supergroup.id, title });
  const setDescription = (description: string) =>
    callBotApi(api, `${bot.botApiPath}/setChatDescription`, {
      chat_id: supergroup.id,
      description,
    });
  const describe = ({ body }: { body: unknown }) =>
    isBadRequestResponse(body) ? body.description : JSON.stringify(body);
  await readUpdates(bot.botApiPath);
  await readUpdates(readerBot.botApiPath);

  const refusedBeforePromotion = [await setTitle('Team'), await setDescription('About')];
  const promotion = await api.request(
    `${supergroupPath(owner.id)}/administrators/${bot.bot.id}`,
    jsonRequest('PUT', { can_change_info: true }),
  );
  const titleChange = await setTitle('  New\n  Team  ');
  const unchangedTitle = await setTitle('New Team');
  const emptyTitle = await setTitle(' ​\n');
  const descriptionChange = await setDescription('  About us  ');
  const unchangedDescription = await setDescription('About us');
  const chat = botApiResult(
    (await callBotApi(api, `${bot.botApiPath}/getChat`, { chat_id: supergroup.id })).body,
  );
  const descriptionRemoval = await setDescription('');
  const chatWithoutDescription = botApiResult(
    (await callBotApi(api, `${bot.botApiPath}/getChat`, { chat_id: supergroup.id })).body,
  );
  if (
    promotion.status !== 204 ||
    describe(emptyTitle) !== 'Bad Request: title must be non-empty' ||
    describe(unchangedDescription) !== 'Bad Request: chat description is not modified' ||
    chat?.title !== 'New Team' ||
    chat.description !== 'About us' ||
    descriptionRemoval.status !== 200 ||
    chatWithoutDescription === undefined ||
    'description' in chatWithoutDescription
  ) {
    throw new Error(`Expected Telegram's title and description changes, received ${
      JSON.stringify([
        refusedBeforePromotion,
        promotion.status,
        titleChange,
        unchangedTitle,
        emptyTitle,
        descriptionChange,
        unchangedDescription,
        chat,
        chatWithoutDescription,
      ])
    }`);
  }
  assertEquals(refusedBeforePromotion.map(describe), [
    'Bad Request: not enough rights to change chat title',
    'Bad Request: not enough rights to set chat description',
  ], "Expected Telegram's title and description changes");
  assertEqualsInFieldOrder(
    [titleChange.body, unchangedTitle.body, descriptionChange.body],
    Array(3).fill({ ok: true, result: true }),
    "Expected Telegram's title and description changes",
  );

  const serviceMessages = async (botApiPath: string) =>
    (await readUpdates(botApiPath)).flatMap(({ message }) => {
      const { new_chat_title: newChatTitle, from } = message as {
        new_chat_title?: string;
        from?: { id: number };
      } ?? {};
      return newChatTitle === undefined ? [] : [{ newChatTitle, fromId: from?.id }];
    });
  const expectedServiceMessages = [{ newChatTitle: 'New Team', fromId: bot.bot.id }];
  const history = await (await api.request(`${supergroupPath(owner.id)}/messages`)).json() as {
    messages: Array<{ new_chat_title?: string }>;
  };
  if (history.messages.filter((message) => message.new_chat_title !== undefined).length !== 1) {
    throw new Error('Expected one service message for the changed title, seen by every bot');
  }
  assertEqualsInFieldOrder(
    await serviceMessages(bot.botApiPath),
    expectedServiceMessages,
    'Expected one service message for the changed title, seen by every bot',
  );
  assertEqualsInFieldOrder(
    await serviceMessages(readerBot.botApiPath),
    expectedServiceMessages,
    'Expected one service message for the changed title, seen by every bot',
  );

  await using privateChat = await createPrivateConversationFixture(undefined, FIXED_CLOCK_EMULATOR);
  await privateChat.sendText('/start');
  const privateDescription = await callBotApi(
    privateChat.api,
    `${privateChat.botApiPath}/setChatDescription`,
    { chat_id: privateChat.createdAccount.account.id, description: 'Chat' },
  );
  const privateTitle = await callBotApi(
    privateChat.api,
    `${privateChat.botApiPath}/setChatTitle`,
    { chat_id: privateChat.createdAccount.account.id, title: 'Chat' },
  );
  if (
    describe(privateTitle) !== "Bad Request: can't change private chat title" ||
    describe(privateDescription) !== "Bad Request: can't change private chat description"
  ) {
    throw new Error(
      `Expected private chats to have no title to change, received ${
        JSON.stringify([privateTitle, privateDescription])
      }`,
    );
  }
});

Deno.test('accounts change a supergroup title that bots see as a service message', async () => {
  await using fixture = await createSupergroupFixture(
    FIXED_CLOCK_EMULATOR,
  );
  const { api, sessionPath, member, bot, supergroupPath } = fixture;
  const readUpdates = createUpdateReader(api);
  await readUpdates(bot.botApiPath);
  const outsider = await createAccount(api, sessionPath, 'Linus');
  const put = (accountId: number, path: 'title' | 'description', body: unknown) =>
    api.request(`${supergroupPath(accountId)}/${path}`, jsonRequest('PUT', body));

  const statuses = [
    (await put(member.id, 'title', { title: 'Grace and friends' })).status,
    (await put(member.id, 'title', { title: '⠀' })).status,
    (await put(outsider.id, 'title', { title: 'Mine' })).status,
    (await put(member.id, 'description', { description: 'Hello' })).status,
    (await put(member.id, 'description', { description: 'Hello' })).status,
    (await put(member.id, 'title', { name: 'Grace' })).status,
  ];
  const titleUpdates = (await readUpdates(bot.botApiPath)).flatMap(({ message }) => {
    const { new_chat_title: newChatTitle, from } = message as {
      new_chat_title?: string;
      from?: { id: number };
    } ?? {};
    return newChatTitle === undefined ? [] : [{ newChatTitle, fromId: from?.id }];
  });
  assertEquals(
    statuses,
    [204, 400, 403, 204, 409, 400],
    "Expected a member's title change to reach the bot",
  );
  assertEqualsInFieldOrder(
    titleUpdates,
    [{ newChatTitle: 'Grace and friends', fromId: member.id }],
    "Expected a member's title change to reach the bot",
  );
});

Deno.test('the owner protects all supergroup content from forwarding and saving', async () => {
  await using fixture = await createSupergroupFixture(FIXED_CLOCK_EMULATOR);
  const { api, sessionPath, owner, member, bot, supergroup, supergroupPath, sendSupergroupText } =
    fixture;
  const readUpdates = createUpdateReader(api);
  const contentProtectionPath = (accountId: number) =>
    `${supergroupPath(accountId)}/content-protection`;
  await api.request(
    `${sessionPath}/accounts/${owner.id}/messages`,
    jsonRequest('POST', { to: { type: 'private', botId: bot.bot.id }, text: '/start' }),
  );
  const earlierMessage = await sendSupergroupText(member.id, '/plan before protection');
  await readUpdates(bot.botApiPath);

  const protectionStatuses = [
    (await api.request(contentProtectionPath(member.id), { method: 'PUT' })).status,
    (await api.request(contentProtectionPath(owner.id), { method: 'PUT' })).status,
  ];
  const laterMessage = await sendSupergroupText(member.id, '/plan after protection');
  const [update] = await readUpdates(bot.botApiPath);
  const botMessage = botApiResult(
    (await callBotApi(api, `${bot.botApiPath}/sendMessage`, {
      chat_id: supergroup.id,
      text: 'Noted',
    })).body,
  );
  if (
    (update?.message as Record<string, unknown> | undefined)?.has_protected_content !== true ||
    botMessage?.has_protected_content !== true
  ) {
    throw new Error(
      `Expected the owner alone to protect every message, received ${
        JSON.stringify({ protectionStatuses, update, botMessage })
      }`,
    );
  }
  assertEquals(protectionStatuses, [403, 204], 'Expected the owner alone to protect every message');

  // Protection covers earlier messages too; bots may still copy them, as TDLib lets bots.
  const repeat = (method: string, parameters: Record<string, unknown>) =>
    callBotApi(api, `${bot.botApiPath}/${method}`, {
      chat_id: owner.id,
      from_chat_id: supergroup.id,
      ...parameters,
    }).then(({ body }) => body);
  const forwardFailure = await repeat('forwardMessage', { message_id: earlierMessage.message_id });
  const forwardsFailure = await repeat('forwardMessages', {
    message_ids: [earlierMessage.message_id, laterMessage.message_id],
  });
  const copy = await repeat('copyMessage', { message_id: earlierMessage.message_id });
  const externalReply = botApiResult(
    (await callBotApi(api, `${bot.botApiPath}/sendMessage`, {
      chat_id: owner.id,
      text: 'About your plan',
      reply_parameters: { chat_id: supergroup.id, message_id: earlierMessage.message_id },
    })).body,
  );
  const accountForward = await api.request(
    `${sessionPath}/accounts/${owner.id}/messages`,
    jsonRequest('POST', {
      to: { type: 'private', botId: bot.bot.id },
      forward: {
        chat: { type: 'supergroup', chatId: supergroup.id },
        message_id: laterMessage.message_id,
      },
    }),
  );
  if (
    !isBadRequestResponse(forwardFailure) ||
    forwardFailure.description !== "Bad Request: the message can't be forwarded" ||
    !isBadRequestResponse(forwardsFailure) ||
    forwardsFailure.description !== "Bad Request: messages can't be forwarded" ||
    botApiResult(copy)?.message_id === undefined ||
    externalReply === undefined || externalReply.external_reply !== undefined ||
    accountForward.status !== 400
  ) {
    throw new Error(
      `Expected protected messages to be copied only, received ${
        JSON.stringify({ forwardFailure, forwardsFailure, copy, status: accountForward.status })
      }`,
    );
  }

  // Lifting the protection lets every message be forwarded again.
  const liftStatus = (await api.request(contentProtectionPath(owner.id), { method: 'DELETE' }))
    .status;
  const forward = await repeat('forwardMessage', { message_id: earlierMessage.message_id });
  const history = await (await api.request(`${supergroupPath(member.id)}/messages`)).json() as {
    messages: Array<{ message_id: number; has_protected_content?: boolean }>;
  };
  if (
    liftStatus !== 204 || botApiResult(forward)?.message_id === undefined ||
    history.messages.some((message) => message.has_protected_content !== undefined)
  ) {
    throw new Error(
      `Expected lifted protection to allow forwards, received ${
        JSON.stringify({ forward, history })
      }`,
    );
  }
});

Deno.test('bots address public supergroups by their usernames', async () => {
  await using testSession = await createTestSession(undefined, FIXED_CLOCK_EMULATOR);
  const { api, sessionPath } = testSession;
  const owner = await createAccount(api, sessionPath, 'Ada');
  await createAccount(api, sessionPath, 'Grace', { username: 'grace' });
  const bot = await createBot(api, sessionPath, 'team_bot');
  const createSupergroup = (body: Record<string, unknown>) =>
    api.request(`${sessionPath}/accounts/${owner.id}/supergroups`, jsonRequest('POST', body));
  const createResponse = await createSupergroup({ title: 'Team', username: 'team_chat' });
  const { supergroup } = await createResponse.json() as {
    supergroup: { id: number; username?: string };
  };
  const duplicateStatuses = [
    (await createSupergroup({ title: 'Copy', username: 'TEAM_CHAT' })).status,
    (await createSupergroup({ title: 'Copy', username: 'grace' })).status,
  ];
  await api.request(
    `${sessionPath}/accounts/${owner.id}/conversations/supergroup/${supergroup.id}/members/${bot.bot.id}`,
    { method: 'PUT' },
  );
  await api.request(
    `${sessionPath}/accounts/${owner.id}/messages`,
    jsonRequest('POST', { to: { type: 'private', botId: bot.bot.id }, text: '/start' }),
  );
  if (
    createResponse.status !== 201 ||
    supergroup.username !== 'team_chat'
  ) {
    throw new Error(
      `Expected a public supergroup with a unique username, received ${
        JSON.stringify({ supergroup, duplicateStatuses })
      }`,
    );
  }
  assertEquals(
    duplicateStatuses,
    [409, 409],
    'Expected a public supergroup with a unique username',
  );

  const callBot = (method: string, parameters: Record<string, unknown>) =>
    callBotApi(api, `${bot.botApiPath}/${method}`, parameters).then(({ body }) => body);
  const sent = botApiResult(await callBot('sendMessage', { chat_id: '@Team_Chat', text: 'Hi' }));
  const forward = botApiResult(
    await callBot('forwardMessage', {
      chat_id: owner.id,
      from_chat_id: '@team_chat',
      message_id: sent?.message_id,
    }),
  );
  const externalReply = botApiResult(
    await callBot('sendMessage', {
      chat_id: owner.id,
      text: 'About that',
      reply_parameters: { chat_id: '@team_chat', message_id: sent?.message_id },
    }),
  );
  const member = botApiResult(
    await callBot('getChatMember', { chat_id: '@team_chat', user_id: owner.id }),
  );
  const commandsSet = await callBot('setMyCommands', {
    commands: [{ command: 'plan', description: 'Plan the week' }],
    scope: { type: 'chat', chat_id: '@team_chat' },
  });
  const commands = botApiResult(
    await callBot('getMyCommands', { scope: { type: 'chat', chat_id: supergroup.id } }),
  ) as unknown;
  const expectedChat = {
    id: supergroup.id,
    title: 'Team',
    username: 'team_chat',
    type: 'supergroup',
  };
  if (
    forward?.text !== 'Hi' ||
    (externalReply?.external_reply as { chat?: unknown } | undefined)?.chat === undefined ||
    member?.status !== 'creator'
  ) {
    throw new Error(
      `Expected the username to name the supergroup, received ${
        JSON.stringify({ sent, forward, externalReply, member, commandsSet, commands })
      }`,
    );
  }
  assertEqualsInFieldOrder(
    sent?.chat,
    expectedChat,
    'Expected the username to name the supergroup',
  );
  assertEqualsInFieldOrder(
    commandsSet,
    { ok: true, result: true },
    'Expected the username to name the supergroup',
  );
  assertEqualsInFieldOrder(
    commands,
    [{ command: 'plan', description: 'Plan the week' }],
    'Expected the username to name the supergroup',
  );

  // As Telegram's check_chat does, only public supergroups and bots are found by username, and
  // text after `@` that is no valid username names no chat.
  const failures = [
    await callBot('sendMessage', { chat_id: '@grace', text: 'Hi' }),
    await callBot('sendMessage', { chat_id: '@nobody', text: 'Hi' }),
    await callBot('sendMessage', { chat_id: '@', text: 'Hi' }),
    await callBot('sendMessage', { chat_id: '@not a username', text: 'Hi' }),
    await callBot('sendMessage', { chat_id: '@team_bot', text: 'Hi' }),
    await callBot('copyMessage', { chat_id: owner.id, from_chat_id: '@nobody', message_id: 1 }),
    await callBot('sendMessage', {
      chat_id: owner.id,
      text: 'Hi',
      reply_parameters: { chat_id: '@nobody', message_id: 1 },
    }),
    await callBot('getMyCommands', { scope: { type: 'chat', chat_id: '@nobody' } }),
  ];
  if (
    failures.some((failure) =>
      !isBadRequestResponse(failure) || failure.description !== 'Bad Request: chat not found'
    )
  ) {
    throw new Error(
      `Expected unknown usernames to name no chat, received ${JSON.stringify(failures)}`,
    );
  }
});

Deno.test('administrator bots that request chat_member updates observe members joining', async () => {
  await using fixture = await createSupergroupFixture(FIXED_CLOCK_EMULATOR);
  const { api, sessionPath, owner, bot, readerBot, supergroup, supergroupPath } = fixture;
  const outsider = await createAccount(api, sessionPath, 'Linus');
  const promotion = await api.request(
    `${supergroupPath(owner.id)}/administrators/${bot.bot.id}`,
    jsonRequest('PUT', { can_restrict_members: true }),
  );
  // Both bots confirm their earlier updates and request chat_member updates from now on.
  for (const { botApiPath } of [bot, readerBot]) {
    const { body } = await callBotApi(api, `${botApiPath}/getUpdates`, {
      allowed_updates: ['message', 'my_chat_member', 'chat_member'],
    });
    const lastUpdateId = (body as { result: Array<{ update_id: number }> }).result.at(-1)
      ?.update_id;
    await callBotApi(api, `${botApiPath}/getUpdates`, { offset: (lastUpdateId ?? 0) + 1 });
  }
  const addition = await api.request(`${supergroupPath(owner.id)}/members/${outsider.id}`, {
    method: 'PUT',
  });

  const readUpdates = async (botApiPath: string) =>
    ((await callBotApi(api, `${botApiPath}/getUpdates`, {})).body as {
      result: Array<Record<string, unknown>>;
    }).result;
  const [administratorUpdates, readerUpdates] = await Promise.all([
    readUpdates(bot.botApiPath),
    readUpdates(readerBot.botApiPath),
  ]);
  const chatMember = administratorUpdates[0]?.chat_member as Record<string, unknown> | undefined;
  if (
    promotion.status !== 204 ||
    addition.status !== 204
  ) {
    throw new Error(
      `Expected only the administrator bot to observe the join, received ${
        JSON.stringify([administratorUpdates, readerUpdates])
      }`,
    );
  }
  assertEquals(administratorUpdates.map((update) => Object.keys(update)[1]), [
    'chat_member',
    'message',
  ], 'Expected only the administrator bot to observe the join');
  assertEqualsInFieldOrder({ ...chatMember, date: 0 }, {
    chat: { id: supergroup.id, title: 'Team', type: 'supergroup' },
    from: owner,
    date: 0,
    old_chat_member: { user: outsider, status: 'left' },
    new_chat_member: { user: outsider, status: 'member' },
  }, 'Expected only the administrator bot to observe the join');
  assertEquals(
    readerUpdates.map((update) => Object.keys(update)[1]),
    ['message'],
    'Expected only the administrator bot to observe the join',
  );
});

Deno.test('banChatMember, unbanChatMember, and deleteMessage follow Telegram checks for administrators', async () => {
  await using fixture = await createSupergroupFixture(FIXED_CLOCK_EMULATOR);
  const {
    api,
    sessionPath,
    owner,
    member,
    bot,
    readerBot,
    supergroup,
    supergroupPath,
    sendSupergroupText,
  } = fixture;
  const outsider = await createAccount(api, sessionPath, 'Linus');
  const readNewUpdates = createUpdateReader(api);
  await readNewUpdates(bot.botApiPath);
  await readNewUpdates(readerBot.botApiPath);
  const callBot = (method: string, parameters: Record<string, unknown>) =>
    callBotApi(api, `${bot.botApiPath}/${method}`, parameters);
  const describe = (responses: Array<{ status: number; body: unknown }>) =>
    responses.map(({ status, body }) => {
      const { result, description } = body as { result?: unknown; description?: string };
      return [status, description ?? result];
    });
  const target = (userId: number) => ({ chat_id: supergroup.id, user_id: userId });

  // Without rights, the bot bans nobody; nobody bans the owner or itself.
  const refusals = describe(
    await Promise.all([
      callBot('banChatMember', target(member.id)),
      callBot('unbanChatMember', target(member.id)),
      callBot('banChatMember', target(owner.id)),
      callBot('banChatMember', target(bot.bot.id)),
      callBot('banChatMember', { chat_id: supergroup.id }),
    ]),
  );
  const notEnoughRights = 'Bad Request: not enough rights to restrict/unrestrict chat member';
  assertEqualsInFieldOrder(refusals, [
    [400, notEnoughRights],
    [400, notEnoughRights],
    [400, "Bad Request: can't remove chat owner"],
    [400, "Bad Request: can't restrict self"],
    [400, 'Bad Request: invalid user_id specified'],
  ], 'Expected refusals without rights');

  const administratorsPath = `${supergroupPath(owner.id)}/administrators`;
  await api.request(
    `${administratorsPath}/${bot.bot.id}`,
    jsonRequest('PUT', { can_restrict_members: true, can_delete_messages: true }),
  );
  await api.request(
    `${administratorsPath}/${readerBot.bot.id}`,
    jsonRequest('PUT', { can_pin_messages: true }),
  );
  await readNewUpdates(bot.botApiPath);
  await readNewUpdates(readerBot.botApiPath);

  // An administrator bot receives every message, deletes any, and bans members, which a service
  // message of the bot records; as bots never see other bots' messages, only the bot receives it.
  const spam = await sendSupergroupText(member.id, 'Buy now!');
  const untilDate = TEST_UNIX_TIME_SECONDS + 3_600;
  const moderation = describe(
    await Promise.all([
      callBot('deleteMessage', { chat_id: supergroup.id, message_id: spam.message_id }),
      callBot('banChatMember', { ...target(member.id), until_date: untilDate }),
      callBot('banChatMember', target(readerBot.bot.id)),
      callBot('kickChatMember', target(outsider.id)),
    ]),
  );
  const [bannedMember, preBannedOutsider] = await Promise.all([
    callBot('getChatMember', target(member.id)),
    callBot('getChatMember', target(outsider.id)),
  ]).then((responses) => responses.map(({ body }) => (body as { result: unknown }).result));
  const botUpdates = await readNewUpdates(bot.botApiPath);
  const readerUpdates = await readNewUpdates(readerBot.botApiPath);
  const bannedMemberHistory = await api.request(`${supergroupPath(member.id)}/messages`);
  if (bannedMemberHistory.status !== 403) {
    throw new Error(
      `Expected the bot to delete the spam and ban its sender, received ${
        JSON.stringify([moderation, bannedMember, preBannedOutsider])
      }`,
    );
  }
  assertEquals(moderation, [
    [200, true],
    [200, true],
    [400, 'Bad Request: user is an administrator of the chat'],
    [200, true],
  ], 'Expected the bot to delete the spam and ban its sender');
  assertEqualsInFieldOrder(
    bannedMember,
    { user: member, status: 'kicked', until_date: untilDate },
    'Expected the bot to delete the spam and ban its sender',
  );
  assertEqualsInFieldOrder(
    preBannedOutsider,
    { user: outsider, status: 'kicked', until_date: 0 },
    'Expected the bot to delete the spam and ban its sender',
  );
  const describeUpdates = (updates: Array<Record<string, unknown>>) =>
    updates.map(({ message }) => {
      const { text, from, left_chat_member } = message as {
        text?: string;
        from: { id: number };
        left_chat_member?: { id: number };
      };
      return [from.id, text ?? `left_chat_member ${left_chat_member?.id}`];
    });
  // As a service message, the ban's reaches the reader bot, though another bot made it.
  const expectedUpdates = [[member.id, 'Buy now!'], [bot.bot.id, `left_chat_member ${member.id}`]];
  assertEqualsInFieldOrder(
    describeUpdates(botUpdates),
    expectedUpdates,
    "Expected the spam and the ban's service message",
  );
  assertEqualsInFieldOrder(
    describeUpdates(readerUpdates),
    expectedUpdates,
    "Expected the spam and the ban's service message",
  );

  // Lifting only a ban leaves the user free to be added again. Otherwise, as on Telegram,
  // unbanning a member removes it.
  const unbanning = describe(
    await Promise.all([
      callBot('unbanChatMember', { ...target(member.id), only_if_banned: true }),
      callBot('unbanChatMember', { ...target(owner.id), only_if_banned: true }),
    ]),
  );
  const readdition = await api.request(`${supergroupPath(owner.id)}/members/${member.id}`, {
    method: 'PUT',
  });
  const removal = describe([await callBot('unbanChatMember', target(member.id))]);
  const removedMember = await callBot('getChatMember', target(member.id));
  if (readdition.status !== 204) {
    throw new Error(
      `Expected unbanning to lift the ban and then remove the member, received ${
        JSON.stringify([unbanning, removal, removedMember])
      }`,
    );
  }
  assertEquals(
    [...unbanning, ...removal],
    [[200, true], [200, true], [200, true]],
    'Expected unbanning to lift the ban and then remove the member',
  );
  assertEqualsInFieldOrder((removedMember.body as { result: unknown }).result, {
    user: member,
    status: 'left',
  }, 'Expected unbanning to lift the ban and then remove the member');

  // A private chat has two members and no administrators, and its members cannot be banned.
  await api.request(
    `${sessionPath}/accounts/${owner.id}/messages`,
    jsonRequest('POST', { to: { type: 'private', botId: bot.bot.id }, text: '/start' }),
  );
  const privateChat = { chat_id: owner.id, user_id: owner.id };
  const privateResponses = describe(
    await Promise.all([
      callBot('getChatMember', privateChat),
      callBot('getChatMemberCount', { chat_id: owner.id }),
      callBot('getChatAdministrators', { chat_id: owner.id }),
      callBot('banChatMember', privateChat),
      callBot('unbanChatMember', privateChat),
      callBot('banChatMember', { chat_id: outsider.id, user_id: outsider.id }),
    ]),
  );
  assertEqualsInFieldOrder(privateResponses, [
    [200, { user: owner, status: 'member' }],
    [200, 2],
    [400, 'Bad Request: there are no administrators in the private chat'],
    [400, "Bad Request: can't ban members in private chats"],
    [400, 'Bad Request: method is available only in supergroup and channel chats'],
    [400, 'Bad Request: chat not found'],
  ], 'Expected private chat checks');
});

Deno.test('a grammY bot bans a spammer for an administrator and deletes the spam', async () => {
  await using fixture = await createSupergroupFixture(FIXED_CLOCK_EMULATOR);
  const { api, sessionPath, owner, member, bot, supergroupPath, sendSupergroupText } = fixture;
  await api.request(
    `${supergroupPath(owner.id)}/administrators/${bot.bot.id}`,
    jsonRequest('PUT', { can_restrict_members: true, can_delete_messages: true }),
  );
  const grammyBot = new Bot(bot.token, {
    client: {
      apiRoot: `${TEST_PUBLIC_ORIGIN}${sessionPath}/bot-api`,
      fetch: api.fetch,
    },
  });
  const handledCommands: Array<PromiseWithResolvers<void>> = [
    Promise.withResolvers<void>(),
    Promise.withResolvers<void>(),
  ];
  let handledCommandCount = 0;
  grammyBot.command('ban', async (context) => {
    const spam = context.message?.reply_to_message;
    const author = await context.getAuthor();
    if (author.status !== 'creator' && author.status !== 'administrator') {
      await context.reply('Only administrators can ban.');
    } else if (spam?.from !== undefined) {
      await context.banChatMember(spam.from.id);
      await context.api.deleteMessages(context.chat.id, [spam.message_id, context.msgId]);
    }
    handledCommands[handledCommandCount++]?.resolve();
  });
  const polling = grammyBot.start();

  try {
    const spam = await sendSupergroupText(member.id, 'Buy now!');
    await sendSupergroupText(member.id, '/ban', spam.message_id);
    await Promise.race([handledCommands[0].promise, polling]);
    await sendSupergroupText(owner.id, '/ban', spam.message_id);
    await Promise.race([handledCommands[1].promise, polling]);
  } finally {
    await grammyBot.stop();
    await polling;
  }

  const history = await (await api.request(`${supergroupPath(owner.id)}/messages`)).json() as {
    messages: Array<{ from: { id: number }; text?: string; left_chat_member?: { id: number } }>;
  };
  const shownMessages = history.messages.slice(3).map(({ from, text, left_chat_member }) => [
    from.id,
    text ?? `left_chat_member ${left_chat_member?.id}`,
  ]);
  assertEqualsInFieldOrder(shownMessages, [
    [member.id, '/ban'],
    [bot.bot.id, 'Only administrators can ban.'],
    [bot.bot.id, `left_chat_member ${member.id}`],
  ], 'Expected the spam and command to be deleted');
});

/**
 * A supergroup administrator as the Bot API shows it, holding the given rights; the list includes
 * `can_manage_chat`, which any right includes.
 */
function administratorMember(user: unknown, heldRights: readonly string[]) {
  const holds = (right: string) => heldRights.includes(right);
  return {
    user,
    status: 'administrator',
    can_be_edited: false,
    ...Object.fromEntries(
      [
        'can_manage_chat',
        'can_change_info',
        'can_delete_messages',
        'can_invite_users',
        'can_restrict_members',
        'can_pin_messages',
        'can_manage_topics',
        'can_promote_members',
        'can_manage_video_chats',
        'can_post_stories',
        'can_edit_stories',
        'can_delete_stories',
        'can_manage_tags',
        'can_send_welcome_messages',
      ].map((right) => [right, holds(right)]),
    ),
    is_anonymous: false,
    can_manage_voice_chats: holds('can_manage_video_chats'),
  };
}
