import { Bot } from 'https://cdn.jsdelivr.net/gh/grammyjs/grammY@^1.46.0/src/bot.ts';
import { run } from '@grammyjs/runner/runner.ts';

import {
  type AccountPollInput,
  EmulationClientError,
  type EmulationSessionClient,
  type PrivateMessageTarget,
  type SupergroupMessageTarget,
  TelegramEmulationClient,
} from '../clients/typescript/mod.ts';
import { createTestApi } from './support/emulation_api.ts';

const PUBLIC_ORIGIN = 'http://emulator.example:9000';

const LUNCH_POLL: AccountPollInput = {
  question: 'Lunch?',
  options: [{ text: 'Pizza' }, { text: 'Pasta' }, { text: 'Soup' }],
  is_anonymous: false,
};

const CAPITAL_QUIZ: AccountPollInput = {
  question: 'Capital of France?',
  options: [{ text: 'Lyon' }, { text: 'Paris' }],
  type: 'quiz',
  correct_option_ids: [1],
  explanation: 'Paris, of course',
};

Deno.test('a grammY bot inspects and answers the poll an account sends to its private chat', async () => {
  const { session, fetch, bot, ada, privateChat } = await createAccountPollFixture();
  const grammyBot = new Bot(bot.token, { client: { apiRoot: session.botApiRoot, fetch } });
  grammyBot.on('message:poll', (context) => {
    const { poll } = context.msg;
    const solution = poll.correct_option_ids === undefined
      ? 'unknown'
      : poll.correct_option_ids.map((position) => poll.options[position].text).join(', ');
    return context.reply(
      `${poll.type} "${poll.question}" from ${context.from?.first_name}: ${solution}`,
      {
        reply_parameters: { message_id: context.msg.message_id },
      },
    );
  });
  grammyBot.on('message:text', (context) => context.reply(`Echo: ${context.msg.text}`));
  const activity = session.botActivity({ bot_id: bot.id });
  const start = await activity.position();
  const runner = run(grammyBot);

  try {
    const quizMessage = await ada.sendPoll({ to: privateChat, poll: CAPITAL_QUIZ });
    expectEqual(
      [quizMessage.from.id, quizMessage.poll?.type, quizMessage.poll?.correct_option_ids],
      [ada.id, 'quiz', [1]],
      'Expected the quiz to come from Ada, with its solution shown to the bot of its private chat',
    );
    expectEqual(
      [
        quizMessage.poll?.is_closed,
        quizMessage.poll?.allows_revoting,
        quizMessage.poll?.explanation,
      ],
      [false, false, 'Paris, of course'],
      'Expected an open quiz that disallows revoting by default, with its explanation',
    );
    await activity.waitFor({
      method: 'sendMessage',
      chat_id: ada.id,
      parameters: { text: 'quiz "Capital of France?" from Ada: Paris' },
    }, { after: start });

    const answer = (await ada.getMessages({ chat: privateChat })).find((message) =>
      message.from.id === bot.id && message.reply_to_message?.message_id === quizMessage.message_id
    );
    expectEqual(
      answer?.reply_to_message?.poll?.id,
      quizMessage.poll?.id,
      'Expected the bot to reply to the poll message, which the reply shows',
    );

    // The owner votes in its own poll, which sends no bot a vote or a poll state.
    const beforeVote = await activity.position();
    const voted = await ada.answerPoll({
      chat: privateChat,
      message_id: quizMessage.message_id,
      option_ids: [0],
    });
    expectEqual(
      voted.message.poll?.options.map(({ voter_count }) => voter_count),
      [1, 0],
      'Expected the vote to count',
    );
    const stopped = await ada.stopPoll({ chat: privateChat, message_id: quizMessage.message_id });
    expectEqual(stopped.poll?.is_closed, true, 'Expected the owner to stop its poll');
    await ada.sendMessage({ to: privateChat, text: 'done' });
    const echo = await activity.waitFor({
      method: 'sendMessage',
      chat_id: ada.id,
      parameters: { text: 'Echo: done' },
    }, { after: beforeVote });
    await activity.assertNone({
      kind: 'update_delivered',
      where: ({ update }) => update.poll !== undefined || update.poll_answer !== undefined,
    }, { after: beforeVote, before: echo });
    await activity.assertNone({
      kind: 'update_delivered',
      where: ({ update }) => update.edited_message !== undefined,
    }, { after: beforeVote, before: echo });
  } finally {
    await runner.stop();
    await session.end();
  }
});

Deno.test('supergroup members vote in an account poll and forward it with the same counts', async () => {
  const { session, fetch, bot, ada, grace, linus, privateChat, group } =
    await createAccountPollFixture();
  const grammyBot = new Bot(bot.token, { client: { apiRoot: session.botApiRoot, fetch } });
  grammyBot.on(
    'message:poll',
    (context) =>
      context.reply(`Seen ${context.msg.poll.id} with ${context.msg.poll.total_voter_count} votes`),
  );
  grammyBot.on('message:text', (context) => context.reply(`Echo: ${context.msg.text}`));
  const activity = session.botActivity({ bot_id: bot.id });
  const start = await activity.position();
  const runner = run(grammyBot);

  try {
    const pollMessage = await ada.sendPoll({ to: group, poll: LUNCH_POLL });
    const pollId = pollMessage.poll?.id;
    await activity.waitFor({
      method: 'sendMessage',
      chat_id: group.chatId,
      parameters: { text: `Seen ${pollId} with 0 votes` },
    }, { after: start });

    const beforeVotes = await activity.position();
    await grace.answerPoll({ chat: group, message_id: pollMessage.message_id, option_ids: [1] });
    await ada.answerPoll({ chat: group, message_id: pollMessage.message_id, option_ids: [0] });

    const forward = await grace.forwardMessage({
      from: group,
      message_id: pollMessage.message_id,
      to: { type: 'private', botId: bot.id },
    });
    expectEqual(
      [forward.poll?.id, forward.poll?.total_voter_count, forward.forward_origin?.type],
      [pollId, 2, 'user'],
      'Expected the forward to show the same poll with its counts',
    );
    await activity.waitFor({
      method: 'sendMessage',
      chat_id: grace.id,
      parameters: { text: `Seen ${pollId} with 2 votes` },
    }, { after: beforeVotes });

    // A vote through the forward counts once in the same poll.
    const changed = await grace.answerPoll({
      chat: { type: 'private', botId: bot.id },
      message_id: forward.message_id,
      option_ids: [2],
    });
    expectEqual(
      changed.message.poll?.options.map(({ voter_count }) => voter_count),
      [1, 0, 1],
      'Expected a vote through the forward to replace the voter answer',
    );
    const inGroup = await linus.getPollAnswer({ chat: group, message_id: pollMessage.message_id })
      .catch((error) => error);
    expectEqual(
      inGroup instanceof EmulationClientError ? inGroup.status : inGroup,
      403,
      'Expected an account outside the supergroup to be refused',
    );
    const seenByAda = await ada.getPollAnswer({ chat: group, message_id: pollMessage.message_id });
    expectEqual(
      [seenByAda.poll_answer.option_ids, seenByAda.message.poll?.options.map((o) => o.voter_count)],
      [[0], [1, 0, 1]],
      'Expected the supergroup message to show the counts the forward shows',
    );

    await ada.sendMessage({ to: privateChat, text: 'votes done' });
    const echo = await activity.waitFor({
      method: 'sendMessage',
      chat_id: ada.id,
      parameters: { text: 'Echo: votes done' },
    }, { after: beforeVotes });
    await activity.assertNone({
      kind: 'update_delivered',
      where: ({ update }) => update.poll !== undefined || update.poll_answer !== undefined,
    }, { after: beforeVotes, before: echo });
  } finally {
    await runner.stop();
    await session.end();
  }
});

Deno.test('only the account that sent a poll stops it, through its own message', async () => {
  const { session, fetch, bot, ada, grace, privateChat, group } = await createAccountPollFixture();
  const callBotApi = createBotApiCaller({ session, fetch, bot });
  const pollMessage = await ada.sendPoll({ to: group, poll: LUNCH_POLL });
  await grace.answerPoll({ chat: group, message_id: pollMessage.message_id, option_ids: [2] });
  const forward = await ada.forwardMessage({
    from: group,
    message_id: pollMessage.message_id,
    to: privateChat,
  });

  await expectRefused(
    grace.stopPoll({ chat: group, message_id: pollMessage.message_id }),
    403,
    'another member stopping the poll',
  );
  await expectRefused(
    ada.stopPoll({ chat: privateChat, message_id: forward.message_id }),
    403,
    'the owner stopping the poll through a forward',
  );
  const botStop = await callBotApi('stopPoll', {
    chat_id: group.chatId,
    message_id: pollMessage.message_id,
  });
  expectEqual(
    [botStop.ok, botStop.description],
    [false, "Bad Request: poll can't be stopped"],
    'Expected a bot to be unable to stop an account poll',
  );
  const unchanged = await grace.getPollAnswer({ chat: group, message_id: pollMessage.message_id });
  expectEqual(
    [unchanged.message.poll?.is_closed, unchanged.message.poll?.total_voter_count],
    [false, 1],
    'Expected refused stops to leave the poll open with its votes',
  );

  const stopped = await ada.stopPoll({ chat: group, message_id: pollMessage.message_id });
  expectEqual(
    [stopped.poll?.is_closed, stopped.poll?.options.map(({ voter_count }) => voter_count)],
    [true, [0, 0, 1]],
    'Expected the stopped poll to keep its votes',
  );
  expectEqual(stopped.edit_date, undefined, 'Expected stopping to add no edit date');
  const forwardView = await ada.getPollAnswer({
    chat: privateChat,
    message_id: forward.message_id,
  });
  expectEqual(forwardView.message.poll?.is_closed, true, 'Expected the forward to show it closed');
  await expectRefused(
    ada.stopPoll({ chat: group, message_id: pollMessage.message_id }),
    409,
    'stopping a closed poll again',
  );
  await expectRefused(
    grace.answerPoll({ chat: group, message_id: pollMessage.message_id, option_ids: [0] }),
    409,
    'voting in a stopped poll',
  );

  // A bot's poll stays the bot's to stop.
  const botPoll = await callBotApi('sendPoll', {
    chat_id: group.chatId,
    question: 'Bot poll?',
    options: JSON.stringify(['Yes', 'No']),
  });
  const botPollMessageId = (botPoll.result as { message_id: number }).message_id;
  await expectRefused(
    ada.stopPoll({ chat: group, message_id: botPollMessageId }),
    403,
    'an account stopping a bot poll',
  );
  const botStopped = await callBotApi('stopPoll', {
    chat_id: group.chatId,
    message_id: botPollMessageId,
  });
  expectEqual(botStopped.ok, true, 'Expected the bot to stop its own poll');

  const textMessage = await ada.sendMessage({ to: group, text: 'not a poll' });
  await expectRefused(
    ada.stopPoll({ chat: group, message_id: textMessage.message_id }),
    404,
    'stopping a message without a poll',
  );
  await session.end();
});

Deno.test('account polls are checked as Telegram checks them and refused ones change nothing', async () => {
  const { session, fetch, bot, ada, grace, privateChat, group } = await createAccountPollFixture();
  const callBotApi = createBotApiCaller({ session, fetch, bot });
  const updatesBefore = await pendingUpdates(callBotApi);
  const privateHistory = await ada.getMessages({ chat: privateChat });
  const groupHistory = await ada.getMessages({ chat: group });

  const refusals: ReadonlyArray<readonly [string, AccountPollInput]> = [
    ['an empty question', { ...LUNCH_POLL, question: '  ' }],
    ['a question over 255 characters', { ...LUNCH_POLL, question: 'q'.repeat(256) }],
    ['no options', { ...LUNCH_POLL, options: [] }],
    [
      'more than 12 options',
      { ...LUNCH_POLL, options: Array.from({ length: 13 }, (_, index) => ({ text: `${index}` })) },
    ],
    ['an option over 100 characters', { ...LUNCH_POLL, options: [{ text: 'o'.repeat(101) }] }],
    ['a quiz without correct options', { ...CAPITAL_QUIZ, correct_option_ids: [] }],
    ['a quiz with a correct option it lacks', { ...CAPITAL_QUIZ, correct_option_ids: [2] }],
    ['a quiz explanation over 200 characters', { ...CAPITAL_QUIZ, explanation: 'e'.repeat(201) }],
  ];
  for (const [description, poll] of refusals) {
    await expectRefused(ada.sendPoll({ to: privateChat, poll }), 400, description);
    await expectRefused(ada.sendPoll({ to: group, poll }), 400, `${description} in a supergroup`);
  }
  await expectRefused(
    ada.sendPoll({
      to: privateChat,
      poll: { ...LUNCH_POLL, correct_option_ids: [0] } as unknown as AccountPollInput,
    }),
    400,
    'a regular poll with correct options',
  );
  await expectRefused(
    ada.sendPoll({ to: privateChat, poll: { ...LUNCH_POLL, is_closed: true } as AccountPollInput }),
    400,
    'a poll created closed',
  );

  await ada.setChatPermissions({
    chat: group,
    permissions: { can_send_messages: true, can_send_polls: false },
  });
  await expectRefused(
    grace.sendPoll({ to: group, poll: LUNCH_POLL }),
    403,
    'a member without can_send_polls',
  );
  await ada.blockBot({ botId: bot.id });
  await expectRefused(ada.sendPoll({ to: privateChat, poll: LUNCH_POLL }), 409, 'a blocked bot');
  await ada.unblockBot({ botId: bot.id });

  expectEqual(
    (await ada.getMessages({ chat: privateChat })).length,
    privateHistory.length,
    'Expected refused polls to add no private message',
  );
  expectEqual(
    (await ada.getMessages({ chat: group })).length,
    groupHistory.length,
    'Expected refused polls to add no supergroup message',
  );
  expectEqual(
    (await pendingUpdates(callBotApi)).slice(updatesBefore.length).map((update) =>
      Object.keys(update).filter((key) => key !== 'update_id')
    ),
    [['my_chat_member'], ['my_chat_member']],
    'Expected refused polls to send the bot no update, only the block and unblock',
  );

  // The owner keeps every permission, and a 255-character question fits an account's limit.
  const owned = await ada.sendPoll({
    to: group,
    poll: { ...LUNCH_POLL, question: 'q'.repeat(255) },
  });
  expectEqual(owned.poll?.question.length, 255, 'Expected the owner to send the poll');
  await session.end();
});

Deno.test('a grammY bot receives the poll an account creates through a request_poll button', async () => {
  const { session, fetch, bot, ada, grace, privateChat } = await createAccountPollFixture();
  await grace.sendMessage({ to: privateChat, text: '/start' });
  const grammyBot = new Bot(bot.token, { client: { apiRoot: session.botApiRoot, fetch } });
  grammyBot.command('survey', (context) =>
    context.reply('Make a poll', {
      reply_markup: {
        keyboard: [
          [{ text: 'Any poll', request_poll: {} }],
          [{ text: 'Quiz', request_poll: { type: 'quiz' } }],
          [{ text: 'Regular', request_poll: { type: 'regular' } }],
          [{ text: 'Plain' }],
        ],
      },
    }));
  grammyBot.command(
    'done',
    (context) => context.reply('Thanks', { reply_markup: { remove_keyboard: true } }),
  );
  grammyBot.on(
    'message:poll',
    (context) => context.reply(`Got ${context.msg.poll.type}: ${context.msg.poll.question}`),
  );
  const activity = session.botActivity({ bot_id: bot.id });
  const start = await activity.position();
  const runner = run(grammyBot);

  try {
    await ada.sendMessage({ to: privateChat, text: '/survey' });
    await activity.waitFor({
      method: 'sendMessage',
      chat_id: ada.id,
      parameters: { text: 'Make a poll' },
    }, { after: start });
    const historyLength = (await ada.getMessages({ chat: privateChat })).length;

    const press = (text: string, extra: Record<string, unknown>) =>
      ada.pressReplyKeyboardButton({ chat: privateChat, text, ...extra });
    await expectRefused(press('Quiz', { poll: LUNCH_POLL }), 400, 'a regular poll for a quiz');
    await expectRefused(press('Regular', { poll: CAPITAL_QUIZ }), 400, 'a quiz for a regular poll');
    await expectRefused(press('Any poll', {}), 400, 'a poll button without a poll');
    await expectRefused(
      press('Any poll', { location: { latitude: 1, longitude: 2 } }),
      400,
      'a location for a poll button',
    );
    await expectRefused(press('Plain', { poll: LUNCH_POLL }), 400, 'a poll for a text button');
    await expectRefused(
      press('Any poll', { poll: { ...LUNCH_POLL, options: [] } }),
      400,
      'an invalid poll',
    );
    await expectRefused(
      press('Any poll', { poll: LUNCH_POLL, location: { latitude: 1, longitude: 2 } }),
      400,
      'two answers',
    );
    await expectRefused(
      grace.pressReplyKeyboardButton({ chat: privateChat, text: 'Quiz', poll: CAPITAL_QUIZ }),
      400,
      'a keyboard shown only to another account',
    );
    expectEqual(
      (await ada.getMessages({ chat: privateChat })).length,
      historyLength,
      'Expected refused presses to send nothing',
    );

    const quiz = await press('Quiz', { poll: CAPITAL_QUIZ });
    expectEqual(
      [quiz.from.id, quiz.poll?.type, quiz.reply_to_message, quiz.text],
      [ada.id, 'quiz', undefined, undefined],
      "Expected the quiz to be sent as Ada's poll message that replies to nothing",
    );
    await activity.waitFor({
      method: 'sendMessage',
      chat_id: ada.id,
      parameters: { text: 'Got quiz: Capital of France?' },
    }, { after: start });
    const regular = await press('Regular', { poll: LUNCH_POLL });
    const either = await press('Any poll', { poll: CAPITAL_QUIZ });
    expectEqual(
      [regular.poll?.type, either.poll?.type],
      ['regular', 'quiz'],
      'Expected each button to send the polls it allows',
    );
    await activity.waitFor({
      method: 'sendMessage',
      chat_id: ada.id,
      parameters: { text: 'Got regular: Lunch?' },
    }, { after: start });

    await ada.sendMessage({ to: privateChat, text: '/done' });
    await activity.waitFor({
      method: 'sendMessage',
      chat_id: ada.id,
      parameters: { text: 'Thanks' },
    }, { after: start });
    const beforeStale = (await ada.getMessages({ chat: privateChat })).length;
    await expectRefused(press('Quiz', { poll: CAPITAL_QUIZ }), 400, 'a removed keyboard');
    expectEqual(
      (await ada.getMessages({ chat: privateChat })).length,
      beforeStale,
      'Expected a press of a removed keyboard to send nothing',
    );
  } finally {
    await runner.stop();
    await session.end();
  }
});

Deno.test('a bot copies an account quiz only where it sees its solution', async () => {
  const { session, fetch, bot, ada, privateChat, group } = await createAccountPollFixture();
  const callBotApi = createBotApiCaller({ session, fetch, bot });
  const privateQuiz = await ada.sendPoll({ to: privateChat, poll: CAPITAL_QUIZ });
  const groupQuiz = await ada.sendPoll({ to: group, poll: CAPITAL_QUIZ });
  const groupView = (await callBotApi('forwardMessage', {
    chat_id: ada.id,
    from_chat_id: group.chatId,
    message_id: groupQuiz.message_id,
  })).result as { poll?: { correct_option_ids?: readonly number[] } };
  expectEqual(
    groupView.poll?.correct_option_ids,
    undefined,
    'Expected a forward of a supergroup quiz to hide its solution from the bot',
  );

  const privateCopy = await callBotApi('copyMessage', {
    chat_id: ada.id,
    from_chat_id: ada.id,
    message_id: privateQuiz.message_id,
  });
  const groupCopy = await callBotApi('copyMessage', {
    chat_id: ada.id,
    from_chat_id: group.chatId,
    message_id: groupQuiz.message_id,
  });
  expectEqual(
    [privateCopy.ok, groupCopy.ok, groupCopy.description],
    [true, false, "Bad Request: the message can't be copied"],
    'Expected the bot to copy only the quiz whose solution it sees',
  );
  const copied = (await ada.getMessages({ chat: privateChat })).find((message) =>
    message.message_id === (privateCopy.result as { message_id: number }).message_id
  );
  if (copied?.poll === undefined || copied.poll.id === privateQuiz.poll?.id) {
    throw new Error('Expected the copy to show a new poll');
  }
  await expectRefused(
    ada.stopPoll({ chat: privateChat, message_id: copied.message_id }),
    403,
    'the account stopping the bot copy of its poll',
  );
  await session.end();
});

Deno.test('account polls stay within their session', async () => {
  const api = createTestApi(PUBLIC_ORIGIN);
  const first = await createAccountPollFixture(api);
  const second = await createAccountPollFixture(api);
  const pollMessage = await first.ada.sendPoll({ to: first.privateChat, poll: LUNCH_POLL });
  const groupPoll = await first.ada.sendPoll({ to: first.group, poll: LUNCH_POLL });

  await expectRefused(
    second.ada.stopPoll({ chat: first.privateChat, message_id: pollMessage.message_id }),
    404,
    'stopping a poll of another session',
  );
  await expectRefused(
    second.ada.answerPoll({
      chat: first.group,
      message_id: groupPoll.message_id,
      option_ids: [0],
    }),
    404,
    'voting in a poll of another session',
  );
  expectEqual(
    (await second.ada.getMessages({ chat: second.privateChat })).filter((message) =>
      message.poll !== undefined
    ),
    [],
    'Expected a poll in one session to leave the other untouched',
  );
  const stillOpen = await first.ada.getPollAnswer({
    chat: first.privateChat,
    message_id: pollMessage.message_id,
  });
  expectEqual(stillOpen.message.poll?.is_closed, false, 'Expected the poll to stay open');
  await first.session.end();
  await second.session.end();
});

/**
 * Creates a session whose bot, which reads all group messages, Ada has started a private chat
 * with; Ada owns a supergroup with Grace and the bot; Linus is an account outside it.
 */
async function createAccountPollFixture(
  api = createTestApi(PUBLIC_ORIGIN),
) {
  const fetch: typeof globalThis.fetch = async (input, init) =>
    await api.fetch(new Request(input, init));
  const session = await new TelegramEmulationClient(PUBLIC_ORIGIN, { fetch }).createSession();
  const createdBot = await session.createBot({
    first_name: 'Survey Bot',
    username: 'survey_bot',
    can_read_all_group_messages: true,
  });
  const { account: ada } = await session.createAccount({ first_name: 'Ada' });
  const { account: grace } = await session.createAccount({ first_name: 'Grace' });
  const { account: linus } = await session.createAccount({ first_name: 'Linus' });
  const privateChat: PrivateMessageTarget = { type: 'private', botId: createdBot.bot.id };
  await ada.sendMessage({ to: privateChat, text: '/start' });
  const supergroup = await ada.createSupergroup({ title: 'Lunch club' });
  const group: SupergroupMessageTarget = { type: 'supergroup', chatId: supergroup.id };
  await ada.addChatMember({ chat: group, userId: grace.id });
  await ada.addChatMember({ chat: group, userId: createdBot.bot.id });
  return {
    session,
    fetch,
    bot: { id: createdBot.bot.id, token: createdBot.token },
    ada,
    grace,
    linus,
    privateChat,
    group,
  };
}

/** Calls the fixture bot's Bot API methods and returns the parsed responses. */
function createBotApiCaller(
  { session, fetch, bot }: {
    readonly session: EmulationSessionClient;
    readonly fetch: typeof globalThis.fetch;
    readonly bot: { readonly token: string };
  },
) {
  return async (method: string, parameters: Record<string, unknown>) => {
    const response = await fetch(`${session.botApiRoot}/bot${bot.token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(parameters),
    });
    return await response.json() as { ok: boolean; result?: unknown; description?: string };
  };
}

/** The updates waiting for the bot, which reading them without an offset keeps. */
async function pendingUpdates(
  callBotApi: ReturnType<typeof createBotApiCaller>,
): Promise<readonly Record<string, unknown>[]> {
  const response = await callBotApi('getUpdates', { timeout: 0 });
  return response.result as readonly Record<string, unknown>[];
}

async function expectRefused(
  request: Promise<unknown>,
  expectedStatus: number,
  description: string,
): Promise<void> {
  try {
    await request;
  } catch (error) {
    if (error instanceof EmulationClientError && error.status === expectedStatus) {
      return;
    }
    throw new Error(`Expected ${description} to be refused with ${expectedStatus}`, {
      cause: error,
    });
  }
  throw new Error(`Expected ${description} to be refused with ${expectedStatus}`);
}

function expectEqual(actual: unknown, expected: unknown, message: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `${message}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`,
    );
  }
}
