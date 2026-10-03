import { createEmulationApi } from '../src/api/mod.ts';
import { createSessionLifecycleService } from '../src/composition/session_lifecycle.ts';

type EmulationApi = ReturnType<typeof createEmulationApi>;

interface TestLocation {
  readonly latitude: number;
  readonly longitude: number;
  readonly horizontal_accuracy?: number;
}

interface TestMessage {
  readonly message_id: number;
  readonly from?: { readonly id: number };
  readonly location?: TestLocation;
  readonly reply_to_message?: { readonly message_id: number };
}

/**
 * Creates a session where Ada owns a supergroup with Grace and the location bot, which reads only
 * what privacy mode lets it, and has started a private chat with the bot.
 */
async function createLocationFixture() {
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
  const { body: createdBot } = await requestJson<{ token: string; bot: { id: number } }>(
    api,
    'POST',
    `${sessionPath}/bots`,
    { first_name: 'Location Bot', username: 'location_bot' },
  );
  const botApiPath = `${sessionPath}/bot-api/bot${createdBot.token}`;
  const privateChat = { type: 'private', botId: createdBot.bot.id } as const;
  const accountPath = (accountId: number) => `${sessionPath}/accounts/${accountId}`;
  const sendAccountMessage = (accountId: number, body: Record<string, unknown>) =>
    requestJson<{ message: TestMessage }>(api, 'POST', `${accountPath(accountId)}/messages`, body);
  await sendAccountMessage(ada.id, { to: privateChat, text: '/start' });

  const { body: { supergroup } } = await requestJson<{ supergroup: { id: number } }>(
    api,
    'POST',
    `${accountPath(ada.id)}/supergroups`,
    { title: 'Team' },
  );
  const supergroupChat = { type: 'supergroup', chatId: supergroup.id } as const;
  const supergroupPath = (accountId: number) =>
    `${accountPath(accountId)}/conversations/supergroup/${supergroup.id}`;
  for (const memberId of [grace.id, createdBot.bot.id]) {
    const response = await api.request(`${supergroupPath(ada.id)}/members/${memberId}`, {
      method: 'PUT',
    });
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
  const pressButton = (accountId: number, body: Record<string, unknown>) =>
    requestJson<{ message: TestMessage }>(
      api,
      'POST',
      `${accountPath(accountId)}/reply-keyboard-presses`,
      body,
    );
  const getHistory = async (accountId: number, chat: typeof privateChat | typeof supergroupChat) =>
    (await requestJson<{ messages: TestMessage[] }>(
      api,
      'GET',
      chat.type === 'private'
        ? `${accountPath(accountId)}/conversations/private/${chat.botId}/messages`
        : `${supergroupPath(accountId)}/messages`,
    )).body.messages;
  const readUpdates = createUpdateReader(api, botApiPath);
  await readUpdates();

  return {
    api,
    ada,
    grace,
    privateChat,
    supergroupChat,
    supergroupPath,
    sendAccountMessage,
    callBot,
    pressButton,
    getHistory,
    readUpdates,
  };
}

/** Returns a reader of the bot's updates since the reader last read them. */
function createUpdateReader(api: EmulationApi, botApiPath: string) {
  let nextOffset = 0;
  return async (): Promise<Array<Record<string, unknown>>> => {
    const { body } = await requestJson<{ result: Array<Record<string, unknown>> }>(
      api,
      'POST',
      `${botApiPath}/getUpdates`,
      { offset: nextOffset },
    );
    const lastUpdateId = body.result.at(-1)?.update_id;
    if (typeof lastUpdateId === 'number') {
      nextOffset = lastUpdateId + 1;
    }
    return body.result.map(({ update_id: _updateId, ...update }) => update);
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

function expectEqual(actual: unknown, expected: unknown, message: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `${message}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`,
    );
  }
}

Deno.test('a bot sends static locations whose accuracy Telegram keeps in whole meters', async () => {
  const { ada, privateChat, callBot, getHistory } = await createLocationFixture();
  const accurate = await callBot('sendLocation', {
    chat_id: ada.id,
    latitude: 51.5007,
    longitude: -0.1246,
    horizontal_accuracy: 12.2,
  });
  const edges = await callBot('sendLocation', {
    chat_id: ada.id,
    latitude: '-90',
    longitude: ' 180 ',
    horizontal_accuracy: 0,
  });
  const exponent = await callBot('sendLocation', {
    chat_id: ada.id,
    latitude: '4.5e1',
    longitude: '-1.5E2',
    horizontal_accuracy: '1500',
  });
  expectEqual(
    [accurate, edges, exponent].map(({ status, body }) => [
      status,
      (body.result as TestMessage).location,
    ]),
    [
      [200, { latitude: 51.5007, longitude: -0.1246, horizontal_accuracy: 13 }],
      [200, { latitude: -90, longitude: 180 }],
      [200, { latitude: 45, longitude: -150, horizontal_accuracy: 1500 }],
    ],
    'Expected each location as sent, with its accuracy rounded up and 0 meaning unknown',
  );
  expectEqual(
    (await getHistory(ada.id, privateChat)).slice(-3).map((message) => message.location),
    [
      { latitude: 51.5007, longitude: -0.1246, horizontal_accuracy: 13 },
      { latitude: -90, longitude: 180 },
      { latitude: 45, longitude: -150, horizontal_accuracy: 1500 },
    ],
    'Expected the account history to show the locations',
  );
});

Deno.test('sendLocation refuses missing, off-Earth and live locations without sending', async () => {
  const { ada, privateChat, callBot, getHistory } = await createLocationFixture();
  const historyLength = (await getHistory(ada.id, privateChat)).length;
  const valid = { chat_id: ada.id, latitude: 1, longitude: 2 };
  const invalidParameters = 'Bad Request: invalid sendLocation parameters';
  const refusals = [
    [{ chat_id: ada.id, longitude: 2 }, 'Bad Request: latitude is empty'],
    [{ ...valid, latitude: '  ' }, 'Bad Request: latitude is empty'],
    [{ chat_id: ada.id, latitude: 1 }, 'Bad Request: longitude is empty'],
    [{ latitude: 1, longitude: 2 }, 'Bad Request: chat_id is empty'],
    [{ ...valid, latitude: 90.0001 }, 'Bad Request: invalid location specified'],
    [{ ...valid, longitude: -180.5 }, 'Bad Request: invalid location specified'],
    [{ ...valid, latitude: '1e999' }, 'Bad Request: invalid location specified'],
    [{ ...valid, latitude: 'NaN' }, invalidParameters],
    [{ ...valid, longitude: 'east' }, invalidParameters],
    [{ ...valid, horizontal_accuracy: -1 }, invalidParameters],
    [{ ...valid, horizontal_accuracy: 1500.5 }, invalidParameters],
    [{ ...valid, live_period: 60 }, invalidParameters],
    [{ ...valid, live_period: 0 }, invalidParameters],
    [{ ...valid, heading: 90 }, invalidParameters],
    [{ ...valid, proximity_alert_radius: 100 }, invalidParameters],
  ] as const;
  for (const [parameters, description] of refusals) {
    const { status, body } = await callBot('sendLocation', parameters);
    expectEqual(
      [status, body.description],
      [400, description],
      `Expected ${JSON.stringify(parameters)} to be refused`,
    );
  }
  expectEqual(
    (await getHistory(ada.id, privateChat)).length,
    historyLength,
    'Expected the refused locations to send nothing',
  );
});

Deno.test('an account answers a request_location button with the location its client reports', async () => {
  const { ada, privateChat, callBot, pressButton, getHistory, readUpdates } =
    await createLocationFixture();
  const keyboard = await callBot('sendMessage', {
    chat_id: ada.id,
    text: 'Where are you?',
    reply_markup: {
      keyboard: [[{ text: 'Here', request_location: true }, { text: 'Nowhere' }]],
    },
  });
  const keyboardMessageId = (keyboard.body.result as TestMessage).message_id;
  await readUpdates();
  const historyLength = (await getHistory(ada.id, privateChat)).length;

  const refusals = await Promise.all([
    pressButton(ada.id, { chat: privateChat, text: 'Here' }),
    pressButton(ada.id, {
      chat: privateChat,
      text: 'Nowhere',
      location: { latitude: 1, longitude: 2 },
    }),
    pressButton(ada.id, {
      chat: privateChat,
      text: 'Here',
      location: { latitude: 91, longitude: 0 },
    }),
    pressButton(ada.id, {
      chat: privateChat,
      text: 'Here',
      location: { latitude: 1, longitude: 2, live_period: 60 },
    }),
  ]);
  expectEqual(
    [refusals.map(({ status }) => status), (await getHistory(ada.id, privateChat)).length],
    [[400, 400, 400, 400], historyLength],
    'Expected a location button to need a valid location, which no other button takes',
  );
  expectEqual(await readUpdates(), [], 'Expected the refused presses to reach no bot');

  const press = await pressButton(ada.id, {
    chat: privateChat,
    text: 'Here',
    location: { latitude: 48.8584, longitude: 2.2945, horizontal_accuracy: 5 },
  });
  const sharedLocation = { latitude: 48.8584, longitude: 2.2945, horizontal_accuracy: 5 };
  expectEqual(
    [press.status, press.body.message.location, press.body.message.reply_to_message?.message_id],
    [201, sharedLocation, keyboardMessageId],
    'Expected the press to share the location in reply to the keyboard',
  );
  const [update] = await readUpdates();
  const received = (update as { message: TestMessage }).message;
  expectEqual(
    [received.from?.id, received.location, received.reply_to_message?.message_id],
    [ada.id, sharedLocation, keyboardMessageId],
    'Expected the bot to receive the shared location as an ordinary message',
  );
  const answer = await callBot('sendLocation', {
    chat_id: ada.id,
    latitude: received.location?.latitude,
    longitude: received.location?.longitude,
    reply_parameters: { message_id: received.message_id },
  });
  expectEqual(answer.status, 200, 'Expected the bot to answer with a location of its own');
});

Deno.test('accounts share locations in private chats and supergroups', async () => {
  const {
    ada,
    grace,
    privateChat,
    supergroupChat,
    sendAccountMessage,
    pressButton,
    getHistory,
    readUpdates,
  } = await createLocationFixture();
  const shared = await sendAccountMessage(ada.id, {
    to: privateChat,
    location: { latitude: -33.8568, longitude: 151.2153, horizontal_accuracy: 0.4 },
  });
  const groupShared = await sendAccountMessage(grace.id, {
    to: supergroupChat,
    location: { latitude: 0, longitude: 0 },
  });
  expectEqual(
    [shared.status, shared.body.message.location, groupShared.status, groupShared.body.message],
    [
      201,
      { latitude: -33.8568, longitude: 151.2153, horizontal_accuracy: 1 },
      201,
      { ...groupShared.body.message, location: { latitude: 0, longitude: 0 } },
    ],
    'Expected accounts to share static locations',
  );
  expectEqual(
    (await getHistory(ada.id, supergroupChat)).at(-1)?.location,
    { latitude: 0, longitude: 0 },
    'Expected the supergroup history to keep the location',
  );
  expectEqual(
    (await readUpdates()).map((update) => (update as { message: TestMessage }).message.location),
    [{ latitude: -33.8568, longitude: 151.2153, horizontal_accuracy: 1 }],
    'Expected the privacy-mode bot to receive only the private location',
  );

  const refusedBodies = [
    { to: privateChat, location: { latitude: 90.5, longitude: 0 } },
    { to: privateChat, location: { latitude: 0, longitude: 181 } },
    { to: privateChat, location: { latitude: 0 } },
    { to: privateChat, location: { latitude: 0, longitude: 0, horizontal_accuracy: 1501 } },
    { to: privateChat, location: { latitude: 0, longitude: 0, horizontal_accuracy: -1 } },
    { to: privateChat, location: { latitude: 0, longitude: 0, live_period: 60 } },
    { to: privateChat, location: { latitude: 0, longitude: 0, heading: 1 } },
    { to: privateChat, location: { latitude: '0', longitude: 0 } },
  ];
  const historyLength = (await getHistory(ada.id, privateChat)).length;
  for (const body of refusedBodies) {
    const { status } = await sendAccountMessage(ada.id, body);
    expectEqual(status, 400, `Expected ${JSON.stringify(body)} to be refused`);
  }
  const supergroupPress = await pressButton(grace.id, {
    chat: supergroupChat,
    text: 'Here',
    location: { latitude: 0, longitude: 0 },
  });
  expectEqual(supergroupPress.status, 400, 'Expected no supergroup button to take a location');
  expectEqual(
    [(await getHistory(ada.id, privateChat)).length, await readUpdates()],
    [historyLength, []],
    'Expected refused locations to send nothing',
  );
});

Deno.test('locations need the permission to send messages in supergroups', async () => {
  const {
    api,
    ada,
    grace,
    supergroupChat,
    supergroupPath,
    sendAccountMessage,
    callBot,
    getHistory,
  } = await createLocationFixture();
  const restriction = await requestJson(
    api,
    'PUT',
    `${supergroupPath(ada.id)}/permissions`,
    { permissions: { can_send_polls: true } },
  );
  expectEqual(restriction.status, 204, 'Expected the owner to withhold sending messages');
  const historyLength = (await getHistory(ada.id, supergroupChat)).length;

  const location = { latitude: 1, longitude: 2 };
  const accountLocation = await sendAccountMessage(grace.id, { to: supergroupChat, location });
  const botLocation = await callBot('sendLocation', {
    chat_id: supergroupChat.chatId,
    ...location,
  });
  const ownerLocation = await sendAccountMessage(ada.id, { to: supergroupChat, location });
  expectEqual(
    [
      accountLocation.status,
      botLocation.status,
      botLocation.body.description,
      ownerLocation.status,
    ],
    [403, 400, 'Bad Request: not enough rights to send locations to the chat', 201],
    'Expected only the owner to send a location without the permission',
  );
  expectEqual(
    (await getHistory(ada.id, supergroupChat)).length,
    historyLength + 1,
    'Expected the refused locations to be missing from the history',
  );
});

Deno.test('a location message keeps its location through edits of its keyboard only', async () => {
  const { ada, privateChat, sendAccountMessage, callBot } = await createLocationFixture();
  const document = await sendAccountMessage(ada.id, {
    to: privateChat,
    document: { content_base64: 'aGVsbG8=', file_name: 'notes.txt' },
  });
  const documentFileId = (document.body.message as { document?: { file_id: string } }).document
    ?.file_id;
  const sent = await callBot('sendLocation', {
    chat_id: ada.id,
    latitude: 1,
    longitude: 2,
    reply_markup: { inline_keyboard: [[{ text: 'Route', callback_data: 'route' }]] },
  });
  const target = { chat_id: ada.id, message_id: (sent.body.result as TestMessage).message_id };
  const textEdit = await callBot('editMessageText', { ...target, text: 'Here' });
  const captionEdit = await callBot('editMessageCaption', { ...target, caption: 'Here' });
  const mediaEdit = await callBot('editMessageMedia', {
    ...target,
    media: { type: 'document', media: documentFileId },
  });
  const liveEdit = await callBot('editMessageLiveLocation', {
    ...target,
    latitude: 3,
    longitude: 4,
  });
  const markupEdit = await callBot('editMessageReplyMarkup', {
    ...target,
    reply_markup: { inline_keyboard: [[{ text: 'Map', callback_data: 'map' }]] },
  });
  expectEqual(
    [
      textEdit.body.description,
      captionEdit.body.description,
      mediaEdit.body.description,
      liveEdit.status,
      markupEdit.status,
      (markupEdit.body.result as TestMessage).location,
    ],
    [
      'Bad Request: there is no text in the message to edit',
      'Bad Request: there is no caption in the message to edit',
      "Bad Request: message media can't be edited",
      404,
      200,
      { latitude: 1, longitude: 2 },
    ],
    'Expected only the keyboard of a static location to be editable',
  );
});
