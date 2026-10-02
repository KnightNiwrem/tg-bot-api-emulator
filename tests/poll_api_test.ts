import { Bot } from 'https://cdn.jsdelivr.net/gh/grammyjs/grammY@^1.46.0/src/bot.ts';

import { createEmulationApi } from '../src/api/mod.ts';
import { createSessionLifecycleService } from '../src/composition/session_lifecycle.ts';

type EmulationApi = ReturnType<typeof createEmulationApi>;

interface TestPollOption {
  readonly persistent_id: string;
  readonly text: string;
  readonly text_entities?: unknown;
  readonly voter_count: number;
}

interface TestPoll {
  readonly id: string;
  readonly question: string;
  readonly question_entities?: unknown;
  readonly options: readonly TestPollOption[];
  readonly total_voter_count: number;
  readonly is_anonymous: boolean;
}

interface TestMessage {
  readonly message_id: number;
  readonly text?: string;
  readonly poll?: TestPoll;
  readonly external_reply?: { readonly poll?: TestPoll };
  readonly reply_markup?: unknown;
}

interface PollAnswerResponse {
  readonly poll_answer: {
    readonly poll_id: string;
    readonly option_ids: readonly number[];
    readonly option_persistent_ids: readonly string[];
  };
  readonly message: TestMessage;
}

/**
 * Creates a session where Ada owns a supergroup with Grace and a bot as members, and has started a
 * private chat with the bot; Linus is an account outside the supergroup.
 */
async function createPollFixture() {
  const api = createEmulationApi({
    sessionLifecycle: createSessionLifecycleService(),
    publicOrigin: 'http://emulator.example:9000',
  });
  const sessionPath = (await api.request('/sessions', { method: 'POST' })).headers.get('Location');
  if (sessionPath === null) {
    throw new Error('Expected the created session to have a Location');
  }
  const createAccount = async (firstName: string) =>
    (await requestJson<{ account: { id: number } }>(
      api,
      'POST',
      `${sessionPath}/accounts`,
      { first_name: firstName },
    )).body.account;
  const ada = await createAccount('Ada');
  const grace = await createAccount('Grace');
  const linus = await createAccount('Linus');
  const { body: createdBot } = await requestJson<{ token: string; bot: { id: number } }>(
    api,
    'POST',
    `${sessionPath}/bots`,
    { first_name: 'Poll Bot', username: 'poll_bot' },
  );
  const botApiPath = `${sessionPath}/bot-api/bot${createdBot.token}`;
  const privateChat = { type: 'private', botId: createdBot.bot.id } as const;
  const sendAccountMessage = async (accountId: number, body: Record<string, unknown>) =>
    (await requestJson<{ message: TestMessage }>(
      api,
      'POST',
      `${sessionPath}/accounts/${accountId}/messages`,
      body,
    )).body.message;
  const startMessage = await sendAccountMessage(ada.id, { to: privateChat, text: '/start' });

  const { body: { supergroup } } = await requestJson<{ supergroup: { id: number } }>(
    api,
    'POST',
    `${sessionPath}/accounts/${ada.id}/supergroups`,
    { title: 'Team' },
  );
  const supergroupChat = { type: 'supergroup', chatId: supergroup.id } as const;
  for (const memberId of [grace.id, createdBot.bot.id]) {
    const response = await api.request(
      `${sessionPath}/accounts/${ada.id}/conversations/supergroup/${supergroup.id}/members/${memberId}`,
      { method: 'PUT' },
    );
    if (response.status !== 204) {
      throw new Error(`Expected member ${memberId} to be added, received ${response.status}`);
    }
  }

  const callBot = (method: string, parameters: Record<string, unknown>) =>
    requestJson<{ ok: boolean; result?: unknown; description?: string }>(
      api,
      'POST',
      `${botApiPath}/${method}`,
      parameters,
    );
  const sendPoll = async (parameters: Record<string, unknown>) => {
    const { status, body } = await callBot('sendPoll', parameters);
    if (status !== 200 || !body.ok) {
      throw new Error(`Expected the poll to be sent, received ${JSON.stringify(body)}`);
    }
    return body.result as TestMessage & { poll: TestPoll };
  };
  const messagePath = (
    accountId: number,
    chat: typeof privateChat | typeof supergroupChat,
    messageId: number,
  ) =>
    chat.type === 'private'
      ? `${sessionPath}/accounts/${accountId}/conversations/private/${chat.botId}/messages/${messageId}`
      : `${sessionPath}/accounts/${accountId}/conversations/supergroup/${chat.chatId}/messages/${messageId}`;
  const pollAnswerPath = (
    accountId: number,
    chat: typeof privateChat | typeof supergroupChat,
    messageId: number,
  ) => `${messagePath(accountId, chat, messageId)}/poll-answer`;
  const answerPoll = (
    accountId: number,
    chat: typeof privateChat | typeof supergroupChat,
    messageId: number,
    optionIds: readonly number[],
  ) =>
    requestJson<PollAnswerResponse>(api, 'PUT', pollAnswerPath(accountId, chat, messageId), {
      option_ids: optionIds,
    });
  const getHistory = async (accountId: number, chat: typeof privateChat | typeof supergroupChat) =>
    (await requestJson<{ messages: TestMessage[] }>(
      api,
      'GET',
      chat.type === 'private'
        ? `${sessionPath}/accounts/${accountId}/conversations/private/${chat.botId}/messages`
        : `${sessionPath}/accounts/${accountId}/conversations/supergroup/${chat.chatId}/messages`,
    )).body.messages;

  return {
    api,
    sessionPath,
    ada,
    grace,
    linus,
    bot: createdBot.bot,
    botToken: createdBot.token,
    botApiPath,
    privateChat,
    supergroupChat,
    startMessage,
    callBot,
    sendPoll,
    sendAccountMessage,
    pollAnswerPath,
    answerPoll,
    getHistory,
  };
}

async function requestJson<Body>(
  api: EmulationApi,
  method: 'DELETE' | 'GET' | 'POST' | 'PUT',
  path: string,
  body?: unknown,
): Promise<{ status: number; body: Body }> {
  const response = await api.request(path, {
    method,
    ...(body === undefined
      ? {}
      : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  });
  const text = await response.text();
  return {
    status: response.status,
    body: (text.length === 0 ? undefined : JSON.parse(text)) as Body,
  };
}

/** The voter counts of a poll's options, in order, and its total. */
function voterCounts(poll: TestPoll | undefined): string {
  return JSON.stringify([
    poll?.options.map(({ voter_count }) => voter_count),
    poll?.total_voter_count,
  ]);
}

function expectEqual(actual: unknown, expected: unknown, message: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `${message}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`,
    );
  }
}

Deno.test('a bot sends a poll that an account inspects, votes in, changes and retracts', async () => {
  const {
    api,
    ada,
    bot,
    privateChat,
    startMessage,
    sendPoll,
    pollAnswerPath,
    answerPoll,
    getHistory,
  } = await createPollFixture();
  const sent = await sendPoll({
    chat_id: ada.id,
    question: 'Lunch?',
    options: JSON.stringify(['Pizza', { text: 'Pasta' }]),
    is_anonymous: false,
  });
  expectEqual(sent.poll, {
    id: sent.poll.id,
    question: 'Lunch?',
    options: [
      { persistent_id: '0', text: 'Pizza', voter_count: 0 },
      { persistent_id: '1', text: 'Pasta', voter_count: 0 },
    ],
    total_voter_count: 0,
    is_closed: false,
    is_anonymous: false,
    allows_multiple_answers: false,
    allows_revoting: true,
    members_only: false,
    type: 'regular',
  }, 'Expected the sent message to show the open poll');
  if (!/^[1-9]\d*$/.test(sent.poll.id) || sent.text !== undefined) {
    throw new Error(`Expected a decimal poll identifier and no text, received ${sent.poll.id}`);
  }

  const answerPath = pollAnswerPath(ada.id, privateChat, sent.message_id);
  const noAnswer = await requestJson<PollAnswerResponse>(api, 'GET', answerPath);
  expectEqual(
    noAnswer,
    {
      status: 200,
      body: {
        poll_answer: { poll_id: sent.poll.id, option_ids: [], option_persistent_ids: [] },
        message: sent,
      },
    },
    'Expected the account to see the poll without an answer',
  );

  const vote = await answerPoll(ada.id, privateChat, sent.message_id, [1]);
  expectEqual(
    [vote.status, vote.body.poll_answer, voterCounts(vote.body.message.poll)],
    [200, { poll_id: sent.poll.id, option_ids: [1], option_persistent_ids: ['1'] }, '[[0,1],1]'],
    'Expected the vote to count',
  );
  const repeatedVote = await answerPoll(ada.id, privateChat, sent.message_id, [1, 1]);
  const changedVote = await answerPoll(ada.id, privateChat, sent.message_id, [0]);
  expectEqual(
    [repeatedVote.status, voterCounts(repeatedVote.body.message.poll)],
    [200, '[[0,1],1]'],
    'Expected repeating the vote to change nothing',
  );
  expectEqual(
    [changedVote.body.poll_answer.option_ids, voterCounts(changedVote.body.message.poll)],
    [[0], '[[1,0],1]'],
    'Expected the changed vote to move the count',
  );

  const refusals = await Promise.all([
    answerPoll(ada.id, privateChat, sent.message_id, [0, 1]),
    answerPoll(ada.id, privateChat, sent.message_id, [2]),
    answerPoll(ada.id, privateChat, startMessage.message_id, [0]),
    answerPoll(ada.id, privateChat, sent.message_id + 100, [0]),
    answerPoll(ada.id, { type: 'private', botId: bot.id + 100 }, sent.message_id, [0]),
    requestJson(api, 'PUT', answerPath, { option_ids: [] }),
    requestJson(api, 'PUT', answerPath, { option_ids: [-1] }),
    requestJson(api, 'PUT', answerPath, { options: [0] }),
  ]);
  expectEqual(
    refusals.map(({ status }) => status),
    [400, 400, 404, 404, 404, 400, 400, 400],
    'Expected invalid answers and unknown polls to be refused',
  );
  expectEqual(
    voterCounts((await getHistory(ada.id, privateChat)).at(-1)?.poll),
    '[[1,0],1]',
    'Expected refused answers to leave the counts as they were',
  );

  const retraction = await api.request(answerPath, { method: 'DELETE' });
  const repeatedRetraction = await api.request(answerPath, { method: 'DELETE' });
  const afterRetraction = await requestJson<PollAnswerResponse>(api, 'GET', answerPath);
  expectEqual(
    [
      retraction.status,
      repeatedRetraction.status,
      afterRetraction.body.poll_answer.option_ids,
      voterCounts(afterRetraction.body.message.poll),
    ],
    [204, 204, [], '[[0,0],0]'],
    'Expected the retraction to remove the vote',
  );
});

Deno.test('supergroup members vote in a poll whose answers cannot change', async () => {
  const {
    api,
    sessionPath,
    ada,
    grace,
    linus,
    supergroupChat,
    sendPoll,
    pollAnswerPath,
    answerPoll,
    getHistory,
  } = await createPollFixture();
  const sent = await sendPoll({
    chat_id: supergroupChat.chatId,
    question: 'Which days?',
    options: ['Monday', 'Tuesday', 'Wednesday'],
    allows_multiple_answers: true,
    allows_revoting: false,
  });
  if (!sent.poll.is_anonymous) {
    throw new Error('Expected a poll to be anonymous by default');
  }

  const adaVote = await answerPoll(ada.id, supergroupChat, sent.message_id, [2, 0, 2]);
  const graceVote = await answerPoll(grace.id, supergroupChat, sent.message_id, [2]);
  expectEqual(
    [adaVote.body.poll_answer.option_ids, graceVote.body.poll_answer.option_persistent_ids],
    [[0, 2], ['2']],
    'Expected each member to choose the options it named',
  );
  expectEqual(
    voterCounts(graceVote.body.message.poll),
    '[[1,0,2],2]',
    'Expected both members to count',
  );

  // Linus may not vote before joining; once a member, it cannot retract an answer it lacks.
  const outsiderVote = await answerPoll(linus.id, supergroupChat, sent.message_id, [1]);
  const joined = await api.request(
    `${sessionPath}/accounts/${ada.id}/conversations/supergroup/${supergroupChat.chatId}/members/${linus.id}`,
    { method: 'PUT' },
  );
  const refusals = [
    outsiderVote.status,
    joined.status,
    (await answerPoll(ada.id, supergroupChat, sent.message_id, [1])).status,
    (await answerPoll(ada.id, supergroupChat, sent.message_id, [0, 2])).status,
    (await api.request(pollAnswerPath(ada.id, supergroupChat, sent.message_id), {
      method: 'DELETE',
    })).status,
    (await api.request(pollAnswerPath(linus.id, supergroupChat, sent.message_id), {
      method: 'DELETE',
    })).status,
  ];
  expectEqual(
    refusals,
    [403, 204, 409, 409, 409, 409],
    'Expected outsiders and changed answers to be refused',
  );

  const findPollMessage = async (accountId: number) =>
    (await getHistory(accountId, supergroupChat)).find(({ message_id }) =>
      message_id === sent.message_id
    );
  const adaView = await findPollMessage(ada.id);
  const graceView = await findPollMessage(grace.id);
  expectEqual(
    [voterCounts(adaView?.poll), adaView?.poll, adaView?.message_id],
    [voterCounts(graceView?.poll), graceView?.poll, sent.message_id],
    'Expected every member to see the same counts',
  );
  expectEqual(voterCounts(adaView?.poll), '[[1,0,2],2]', 'Expected refusals to change nothing');
});

Deno.test('sendPoll refuses polls as Telegram does and stores none of them', async () => {
  const { ada, bot, privateChat, callBot, getHistory } = await createPollFixture();
  const historyBefore = await getHistory(ada.id, privateChat);
  const twelveOptions = Array.from({ length: 12 }, (_, index) => `Option ${index}`);
  const cases: ReadonlyArray<{
    readonly parameters: Record<string, unknown>;
    readonly description: string;
  }> = [
    {
      parameters: { question: '<b>Lunch?', question_parse_mode: 'HTML', options: ['A'] },
      description:
        'Bad Request: can\'t parse entities: Can\'t find end tag corresponding to start tag "b"',
    },
    { parameters: {}, description: "Bad Request: can't parse options JSON object" },
    {
      parameters: { options: 'Pizza, Pasta' },
      description: "Bad Request: can't parse options JSON object",
    },
    {
      parameters: { options: { text: 'Pizza' } },
      description: 'Bad Request: expected an Array of InputPollOption',
    },
    {
      parameters: { options: [1] },
      description:
        "Bad Request: can't parse InputPollOption: Expected InputPollOption to be an Object",
    },
    {
      parameters: { options: [{ text_parse_mode: 'HTML' }] },
      description: 'Bad Request: can\'t parse InputPollOption: Can\'t find field "text"',
    },
    {
      parameters: { options: [{ text: 'Pizza', media: { type: 'photo', media: 'x' } }] },
      description: 'Bad Request: media of poll options is not supported',
    },
    {
      parameters: { options: [{ text: '<i>Pizza', text_parse_mode: 'HTML' }] },
      description:
        "Bad Request: can't parse InputPollOption: Can't parse entities: Can't find end tag corresponding to start tag \"i\"",
    },
    {
      parameters: { options: [{ text: 'Pizza', text_parse_mode: 'Fancy' }] },
      description: "Bad Request: can't parse InputPollOption: Unsupported parse_mode",
    },
    {
      parameters: { options: ['Pizza'], type: 'quiz' },
      description: 'Bad Request: quiz polls are not supported',
    },
    {
      parameters: { options: ['Pizza'], type: 'survey' },
      description: 'Bad Request: unsupported poll type specified',
    },
    {
      parameters: { options: ['Pizza'], shuffle_options: true },
      description: 'Bad Request: invalid sendPoll parameters',
    },
    {
      parameters: { chat_id: undefined, options: ['Pizza'] },
      description: 'Bad Request: chat_id is empty',
    },
    {
      parameters: { chat_id: bot.id + 100, options: ['Pizza'] },
      description: 'Bad Request: chat not found',
    },
    {
      parameters: { question: ' ', options: ['Pizza'] },
      description: 'Bad Request: text must be non-empty',
    },
    {
      parameters: { question: 'Q'.repeat(301), options: ['Pizza'] },
      description: 'Bad Request: poll question length must not exceed 300',
    },
    {
      parameters: { options: [] },
      description: 'Bad Request: poll must have at least one answer option',
    },
    {
      parameters: { options: null },
      description: 'Bad Request: poll must have at least one answer option',
    },
    {
      parameters: { options: [...twelveOptions, 'One too many'] },
      description: "Bad Request: poll can't have more than 12 options",
    },
    {
      parameters: { options: ['Pizza', '\n'] },
      description: 'Bad Request: text must be non-empty',
    },
    {
      parameters: { options: ['Pizza', 'P'.repeat(101)] },
      description: 'Bad Request: poll options length must not exceed 100',
    },
    {
      parameters: {
        options: ['Pizza'],
        reply_markup: { inline_keyboard: [[{ text: 'Vote', callback_data: 'x'.repeat(65) }]] },
      },
      description: 'Bad Request: BUTTON_DATA_INVALID',
    },
  ];
  for (const { parameters, description } of cases) {
    const { status, body } = await callBot('sendPoll', {
      chat_id: ada.id,
      question: 'Lunch?',
      ...parameters,
    });
    if (status !== 400 || body.description !== description) {
      throw new Error(
        `Expected ${JSON.stringify(parameters)} to fail with ${description}, received ${
          JSON.stringify(body)
        }`,
      );
    }
  }
  expectEqual(
    await getHistory(ada.id, privateChat),
    historyBefore,
    'Expected refused polls to store nothing',
  );

  const atLimits = await callBot('sendPoll', {
    chat_id: ada.id,
    question: 'Q'.repeat(300),
    options: twelveOptions.map((option, index) => index === 0 ? 'P'.repeat(100) : option),
  });
  if (!atLimits.body.ok) {
    throw new Error(`Expected a poll at Telegram's limits, received ${JSON.stringify(atLimits)}`);
  }
});

Deno.test('poll questions and options keep only their custom emoji', async () => {
  const { ada, sendPoll } = await createPollFixture();
  const customEmoji = { type: 'custom_emoji', custom_emoji_id: '5368324170671202286' };
  const sent = await sendPoll({
    chat_id: ada.id,
    question: '🍕 <b>Lunch?</b>',
    question_parse_mode: 'HTML',
    question_entities: [{ type: 'italic', offset: 0, length: 2 }],
    options: [
      { text: '🍕 Pizza', text_entities: [{ ...customEmoji, offset: 0, length: 2 }] },
      { text: '/pasta', text_entities: [{ type: 'bold', offset: 0, length: 6 }] },
    ],
  });
  const { question, question_entities, options } = sent.poll;
  expectEqual(
    [question, question_entities, options.map(({ text_entities }) => text_entities)],
    [
      '🍕 Lunch?',
      undefined,
      [[{
        type: 'custom_emoji',
        offset: 0,
        length: 2,
        custom_emoji_id: customEmoji.custom_emoji_id,
      }], undefined],
    ],
    'Expected the question to be formatted and only custom emoji to remain',
  );
});

Deno.test('forwards share the poll they repeat, while copies create new polls', async () => {
  const {
    ada,
    grace,
    privateChat,
    supergroupChat,
    callBot,
    sendPoll,
    sendAccountMessage,
    answerPoll,
    getHistory,
  } = await createPollFixture();
  const original = await sendPoll({
    chat_id: ada.id,
    question: 'Lunch?',
    options: ['Pizza', 'Pasta'],
    reply_markup: { inline_keyboard: [[{ text: 'Results', callback_data: 'results' }]] },
  });
  await answerPoll(ada.id, privateChat, original.message_id, [0]);

  const accountForward = await sendAccountMessage(ada.id, {
    to: supergroupChat,
    forward: { chat: privateChat, message_id: original.message_id },
  });
  const { body: botForward } = await callBot('forwardMessage', {
    chat_id: supergroupChat.chatId,
    from_chat_id: ada.id,
    message_id: original.message_id,
  });
  const forwardedPoll = (botForward.result as TestMessage).poll;
  expectEqual(
    [accountForward.poll?.id, forwardedPoll?.id, voterCounts(accountForward.poll)],
    [original.poll.id, original.poll.id, '[[1,0],1]'],
    'Expected forwards to show the original poll and its votes',
  );

  // A vote through a forward counts once in the shared poll, wherever it is shown.
  const graceVote = await answerPoll(grace.id, supergroupChat, accountForward.message_id, [1]);
  const adaVoteThroughForward = await answerPoll(
    ada.id,
    supergroupChat,
    accountForward.message_id,
    [1],
  );
  expectEqual(
    [
      graceVote.status,
      adaVoteThroughForward.body.poll_answer.option_ids,
      voterCounts((await getHistory(ada.id, privateChat)).at(-1)?.poll),
    ],
    [200, [1], '[[0,2],2]'],
    'Expected votes through forwards to count in the original poll',
  );

  const { body: copy } = await callBot('copyMessage', {
    chat_id: supergroupChat.chatId,
    from_chat_id: ada.id,
    message_id: original.message_id,
    caption: 'Ignored',
  });
  const { body: copies } = await callBot('copyMessages', {
    chat_id: ada.id,
    from_chat_id: ada.id,
    message_ids: [original.message_id],
  });
  const supergroupHistory = await getHistory(ada.id, supergroupChat);
  const copiedMessage = supergroupHistory.find(({ message_id }) =>
    message_id === (copy.result as { message_id: number }).message_id
  );
  const privateCopy = (await getHistory(ada.id, privateChat)).find(({ message_id }) =>
    message_id === (copies.result as { message_id: number }[])[0].message_id
  );
  const copiedPolls = [copiedMessage?.poll, privateCopy?.poll];
  if (
    new Set([original.poll.id, ...copiedPolls.map((poll) => poll?.id)]).size !== 3 ||
    copiedPolls.some((poll) => voterCounts(poll) !== '[[0,0],0]') ||
    copiedMessage?.reply_markup !== undefined || copiedMessage?.text !== undefined
  ) {
    throw new Error(`Expected copies to show new polls without votes: ${JSON.stringify(copies)}`);
  }
  expectEqual(
    copiedPolls.map((poll) => [poll?.question, poll?.options.map(({ text }) => text)]),
    [['Lunch?', ['Pizza', 'Pasta']], ['Lunch?', ['Pizza', 'Pasta']]],
    "Expected copies to repeat the original's question and options",
  );

  const { body: externalReply } = await callBot('sendMessage', {
    chat_id: supergroupChat.chatId,
    text: 'Vote here too',
    reply_parameters: { chat_id: ada.id, message_id: original.message_id },
  });
  expectEqual(
    (externalReply.result as TestMessage).external_reply?.poll,
    (await getHistory(ada.id, privateChat)).find(({ message_id }) =>
      message_id === original.message_id
    )?.poll,
    'Expected a reply from another chat to show the poll as it is now',
  );
});

Deno.test('bots edit only the reply markup of a poll message', async () => {
  const { api, ada, botApiPath, callBot, sendPoll } = await createPollFixture();
  const sent = await sendPoll({ chat_id: ada.id, question: 'Lunch?', options: ['Pizza'] });
  const documentUpload = new FormData();
  documentUpload.append('chat_id', String(ada.id));
  documentUpload.append('document', new File(['Pizza, pasta'], 'menu.txt'));
  const documentMessage = await (await api.request(`${botApiPath}/sendDocument`, {
    method: 'POST',
    body: documentUpload,
  })).json() as { result: { document: { file_id: string } } };

  const target = { chat_id: ada.id, message_id: sent.message_id };
  const refusals = [
    await callBot('editMessageText', { ...target, text: 'Dinner?' }),
    await callBot('editMessageCaption', { ...target, caption: 'Dinner?' }),
    await callBot('editMessageMedia', {
      ...target,
      media: { type: 'document', media: documentMessage.result.document.file_id },
    }),
  ];
  expectEqual(
    refusals.map(({ body }) => body.description),
    [
      'Bad Request: there is no text in the message to edit',
      'Bad Request: there is no caption in the message to edit',
      "Bad Request: message media can't be edited",
    ],
    'Expected edits of the content of a poll message to be refused',
  );
  const keyboard = { inline_keyboard: [[{ text: 'Results', callback_data: 'results' }]] };
  const { body: edited } = await callBot('editMessageReplyMarkup', {
    ...target,
    reply_markup: keyboard,
  });
  const editedMessage = edited.result as TestMessage;
  expectEqual(
    [editedMessage.reply_markup, editedMessage.poll],
    [keyboard, sent.poll],
    'Expected the keyboard to change and the poll to stay',
  );
});

Deno.test('ending a session discards its polls', async () => {
  const { api, sessionPath, ada, privateChat, sendPoll, pollAnswerPath, answerPoll } =
    await createPollFixture();
  const sent = await sendPoll({ chat_id: ada.id, question: 'Lunch?', options: ['Pizza'] });
  await answerPoll(ada.id, privateChat, sent.message_id, [0]);

  const ended = await api.request(sessionPath, { method: 'DELETE' });
  const afterEnd = await api.request(pollAnswerPath(ada.id, privateChat, sent.message_id));
  expectEqual(
    [ended.status, afterEnd.status],
    [204, 404],
    'Expected the ended session to be gone',
  );
});

Deno.test('a grammY bot sends a poll in reply to a command, and accounts vote in it', async () => {
  const { api, sessionPath, ada, botToken, privateChat, sendAccountMessage, answerPoll } =
    await createPollFixture();
  const grammyBot = new Bot(botToken, {
    client: {
      apiRoot: `http://emulator.example:9000${sessionPath}/bot-api`,
      fetch: async (input, init) => await api.fetch(new Request(input, init)),
    },
  });
  const pollSent = Promise.withResolvers<{ message_id: number; poll: TestPoll }>();
  grammyBot.command('lunch', async (context) => {
    const message = await context.replyWithPoll('Lunch?', ['Pizza', { text: 'Pasta' }], {
      is_anonymous: false,
      allows_multiple_answers: true,
    });
    pollSent.resolve(message as unknown as { message_id: number; poll: TestPoll });
  });
  const polling = grammyBot.start();
  let sent: { message_id: number; poll: TestPoll };
  try {
    await sendAccountMessage(ada.id, { to: privateChat, text: '/lunch' });
    sent = await Promise.race([
      pollSent.promise,
      polling.then(() => {
        throw new Error('Expected the bot to keep polling');
      }),
    ]);
  } finally {
    await grammyBot.stop();
    await polling;
  }

  const vote = await answerPoll(ada.id, privateChat, sent.message_id, [0, 1]);
  expectEqual(
    [sent.poll.question, sent.poll.is_anonymous, voterCounts(vote.body.message.poll)],
    ['Lunch?', false, '[[1,1],1]'],
    'Expected the account to vote for both options of the bot poll',
  );
});
