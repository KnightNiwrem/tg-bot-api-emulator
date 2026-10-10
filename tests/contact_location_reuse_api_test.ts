import { Bot, Keyboard, webhookCallback } from 'grammy';
import { createTestSession, requestJson, TEST_PUBLIC_ORIGIN } from './support/emulation_api.ts';

interface TestContact {
  readonly phone_number: string;
  readonly first_name: string;
  readonly last_name?: string;
  readonly user_id?: number;
}

interface TestLocation {
  readonly latitude: number;
  readonly longitude: number;
  readonly horizontal_accuracy?: number;
}

interface TestMessage {
  readonly message_id: number;
  readonly from?: { readonly id: number };
  readonly text?: string;
  readonly caption?: string;
  readonly contact?: TestContact;
  readonly location?: TestLocation;
  readonly forward_origin?: {
    readonly type: string;
    readonly sender_user?: { readonly id: number };
  };
  readonly external_reply?: {
    readonly origin: { readonly type: string; readonly sender_user?: { readonly id: number } };
    readonly contact?: TestContact;
    readonly location?: TestLocation;
  };
  readonly quote?: unknown;
}

/**
 * Creates a session where Ada, who signed up with a phone number, has started a private chat with
 * the bot and owns a supergroup with the bot and Grace. Ada has shared her own contact and a
 * location with the bot.
 */
async function createReuseFixture() {
  const { api, sessionPath } = await createTestSession();
  const createAccount = async (profile: Record<string, unknown>) =>
    (await requestJson<{ account: { id: number } }>(
      api,
      'POST',
      `${sessionPath}/accounts`,
      profile,
    )).body.account;
  const ada = await createAccount({ first_name: 'Ada', phone_number: '15550100' });
  const grace = await createAccount({ first_name: 'Grace' });
  const { body: createdBot } = await requestJson<{ token: string; bot: { id: number } }>(
    api,
    'POST',
    `${sessionPath}/bots`,
    { first_name: 'Reuse Bot', username: 'reuse_bot' },
  );
  const botApiPath = `${sessionPath}/bot-api/bot${createdBot.token}`;
  const privateChat = { type: 'private', botId: createdBot.bot.id } as const;
  const accountPath = (accountId: number) => `${sessionPath}/accounts/${accountId}`;
  const sendAccountMessage = async (accountId: number, body: Record<string, unknown>) => {
    const { status, body: responseBody } = await requestJson<{ message: TestMessage }>(
      api,
      'POST',
      `${accountPath(accountId)}/messages`,
      body,
    );
    if (status !== 201) {
      throw new Error(`Expected ${JSON.stringify(body)} to be sent, received ${status}`);
    }
    return responseBody.message;
  };
  await sendAccountMessage(ada.id, { to: privateChat, text: '/start' });
  const ownContact = await sendAccountMessage(ada.id, { to: privateChat, own_contact: true });
  const location = await sendAccountMessage(ada.id, {
    to: privateChat,
    location: { latitude: 51.5007, longitude: -0.1246, horizontal_accuracy: 3 },
  });

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
  const getHistory = async (accountId: number, chat: typeof privateChat | typeof supergroupChat) =>
    (await requestJson<{ messages: TestMessage[] }>(
      api,
      'GET',
      chat.type === 'private'
        ? `${accountPath(accountId)}/conversations/private/${chat.botId}/messages`
        : `${supergroupPath(accountId)}/messages`,
    )).body.messages;

  return {
    api,
    sessionPath,
    ada,
    grace,
    bot: createdBot.bot,
    botToken: createdBot.token,
    botApiPath,
    privateChat,
    supergroupChat,
    supergroupPath,
    ownContact,
    location,
    sendAccountMessage,
    callBot,
    getHistory,
  };
}

function expectEqual(actual: unknown, expected: unknown, message: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `${message}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`,
    );
  }
}

const OWN_CONTACT = { phone_number: '15550100', first_name: 'Ada' } as const;
const SHARED_LOCATION = { latitude: 51.5007, longitude: -0.1246, horizontal_accuracy: 3 } as const;

Deno.test("forwards and copies repeat contacts and locations, an own contact's user included", async () => {
  const { ada, bot, supergroupChat, ownContact, location, callBot, getHistory } =
    await createReuseFixture();
  const forwarded = await callBot('forwardMessage', {
    chat_id: supergroupChat.chatId,
    from_chat_id: ada.id,
    message_id: ownContact.message_id,
  });
  const copied = await callBot('copyMessage', {
    chat_id: supergroupChat.chatId,
    from_chat_id: ada.id,
    message_id: location.message_id,
    caption: 'Ignored',
  });
  const batch = await callBot('forwardMessages', {
    chat_id: supergroupChat.chatId,
    from_chat_id: ada.id,
    message_ids: [ownContact.message_id, location.message_id],
  });
  const copiedBatch = await callBot('copyMessages', {
    chat_id: ada.id,
    from_chat_id: ada.id,
    message_ids: [ownContact.message_id, location.message_id],
  });
  const forwardedMessage = forwarded.body.result as TestMessage;
  expectEqual(
    [
      forwardedMessage.contact,
      forwardedMessage.forward_origin?.sender_user?.id,
      copied.status,
      (batch.body.result as unknown[]).length,
      (copiedBatch.body.result as unknown[]).length,
    ],
    [{ ...OWN_CONTACT, user_id: ada.id }, ada.id, 200, 2, 2],
    'Expected the forward to keep the own contact and its origin, and every repetition to succeed',
  );
  const supergroupHistory = (await getHistory(ada.id, supergroupChat)).slice(-4);
  expectEqual(
    supergroupHistory.map(({ from, contact, location, caption, forward_origin }) => ({
      from: from?.id,
      contact,
      location,
      caption,
      forwarded: forward_origin !== undefined,
    })),
    [
      { from: bot.id, contact: { ...OWN_CONTACT, user_id: ada.id }, forwarded: true },
      { from: bot.id, location: SHARED_LOCATION, forwarded: false },
      { from: bot.id, contact: { ...OWN_CONTACT, user_id: ada.id }, forwarded: true },
      { from: bot.id, location: SHARED_LOCATION, forwarded: true },
    ],
    'Expected the supergroup to show the forwards and the uncaptioned copy unchanged',
  );
  const privateCopies = (await getHistory(ada.id, { type: 'private', botId: bot.id })).slice(-2);
  expectEqual(
    privateCopies.map(({ from, contact, location }) => [from?.id, contact, location]),
    [[bot.id, { ...OWN_CONTACT, user_id: ada.id }, undefined], [
      bot.id,
      undefined,
      SHARED_LOCATION,
    ]],
    "Expected the bot's copies to keep the contact's user and the location",
  );
});

Deno.test('accounts forward contacts and locations between their chats', async () => {
  const { ada, grace, privateChat, supergroupChat, ownContact, location, sendAccountMessage } =
    await createReuseFixture();
  const forwardedContact = await sendAccountMessage(ada.id, {
    to: supergroupChat,
    forward: { chat: privateChat, message_id: ownContact.message_id },
  });
  const forwardedLocation = await sendAccountMessage(ada.id, {
    to: supergroupChat,
    forward: { chat: privateChat, message_id: location.message_id },
  });
  const groupLocation = await sendAccountMessage(grace.id, {
    to: supergroupChat,
    location: { latitude: 1, longitude: 2 },
  });
  const forwardedBack = await sendAccountMessage(ada.id, {
    to: privateChat,
    forward: { chat: supergroupChat, message_id: groupLocation.message_id },
  });
  expectEqual(
    [
      forwardedContact.contact,
      forwardedLocation.location,
      forwardedBack.location,
      forwardedBack.forward_origin?.sender_user?.id,
    ],
    [{ ...OWN_CONTACT, user_id: ada.id }, SHARED_LOCATION, { latitude: 1, longitude: 2 }, grace.id],
    'Expected account forwards to repeat contacts and locations and show their origin',
  );
});

Deno.test('replies from another chat show the replied contact or location without a quote', async () => {
  const { ada, supergroupChat, ownContact, location, callBot, getHistory } =
    await createReuseFixture();
  const contactReply = await callBot('sendMessage', {
    chat_id: supergroupChat.chatId,
    text: 'Ada shared this',
    reply_parameters: { chat_id: ada.id, message_id: ownContact.message_id },
  });
  const locationReply = await callBot('sendLocation', {
    chat_id: supergroupChat.chatId,
    latitude: 0,
    longitude: 0,
    reply_parameters: { chat_id: ada.id, message_id: location.message_id },
  });
  const [contactReplyMessage, locationReplyMessage] = [contactReply, locationReply].map((
    { body },
  ) => body.result as TestMessage);
  expectEqual(
    [contactReplyMessage, locationReplyMessage].map(({ external_reply }) => [
      external_reply?.origin.type,
      external_reply?.origin.sender_user?.id,
    ]),
    [['user', ada.id], ['user', ada.id]],
    'Expected each reply to show that Ada first sent the replied message',
  );
  expectEqual(
    [
      contactReplyMessage.external_reply?.contact,
      contactReplyMessage.external_reply?.location,
      contactReplyMessage.quote,
      locationReplyMessage.external_reply?.location,
      locationReplyMessage.external_reply?.contact,
      locationReplyMessage.location,
      locationReplyMessage.quote,
    ],
    [
      { ...OWN_CONTACT, user_id: ada.id },
      undefined,
      undefined,
      SHARED_LOCATION,
      undefined,
      { latitude: 0, longitude: 0 },
      undefined,
    ],
    'Expected each reply to show the replied content in external_reply',
  );
  expectEqual(
    (await getHistory(ada.id, supergroupChat)).slice(-2).map((message) => message.external_reply),
    [contactReplyMessage.external_reply, locationReplyMessage.external_reply],
    'Expected members to see the same external replies',
  );
});

Deno.test('forwards and copies of contacts and locations need the permission to send messages', async () => {
  const { api, ada, supergroupChat, supergroupPath, ownContact, location, callBot, getHistory } =
    await createReuseFixture();
  const restriction = await requestJson(api, 'PUT', `${supergroupPath(ada.id)}/permissions`, {
    permissions: { can_send_photos: true },
  });
  expectEqual(restriction.status, 204, 'Expected the owner to withhold sending messages');
  const historyLength = (await getHistory(ada.id, supergroupChat)).length;
  const repeated = { chat_id: supergroupChat.chatId, from_chat_id: ada.id };
  const forward = await callBot('forwardMessage', {
    ...repeated,
    message_id: ownContact.message_id,
  });
  const copy = await callBot('copyMessage', { ...repeated, message_id: location.message_id });
  const batch = await callBot('forwardMessages', {
    ...repeated,
    message_ids: [ownContact.message_id, location.message_id],
  });
  expectEqual(
    [forward.body.description, copy.body.description, batch.body.description],
    [
      "Bad Request: the message can't be forwarded",
      "Bad Request: the message can't be copied",
      "Bad Request: messages can't be forwarded",
    ],
    'Expected contacts and locations the bot may not send to be refused',
  );
  expectEqual(
    (await getHistory(ada.id, supergroupChat)).length,
    historyLength,
    'Expected the refusals to repeat nothing',
  );
});

Deno.test('contact and location updates follow allowed_updates, and bots get none for their own', async () => {
  const { ada, privateChat, sendAccountMessage, callBot } = await createReuseFixture();
  const readUpdates = async (allowedUpdates?: readonly string[]) => {
    const { body } = await callBot('getUpdates', {
      offset: -1,
      ...(allowedUpdates === undefined ? {} : { allowed_updates: allowedUpdates }),
    });
    const updates = body.result as Array<{ update_id: number; message?: TestMessage }>;
    const lastUpdateId = updates.at(-1)?.update_id;
    if (lastUpdateId !== undefined) {
      await callBot('getUpdates', { offset: lastUpdateId + 1 });
    }
    return updates.map(({ message }) => message);
  };
  await readUpdates(['callback_query']);
  await sendAccountMessage(ada.id, { to: privateChat, own_contact: true });
  expectEqual(await readUpdates(), [], 'Expected the excluded message update to be dropped');

  await readUpdates(['message']);
  await callBot('sendContact', { chat_id: ada.id, phone_number: '1', first_name: 'Bot' });
  await callBot('sendLocation', { chat_id: ada.id, latitude: 1, longitude: 2 });
  const shared = await sendAccountMessage(ada.id, {
    to: privateChat,
    location: { latitude: 3, longitude: 4 },
  });
  const updates = await readUpdates();
  expectEqual(
    updates.map((message) => [message?.message_id, message?.location]),
    [[shared.message_id, { latitude: 3, longitude: 4 }]],
    "Expected only the account's location to reach the bot",
  );
});

Deno.test("sessions keep their accounts' own contacts apart", async () => {
  const first = await createReuseFixture();
  const second = await createReuseFixture();
  const secondContact = await second.sendAccountMessage(second.ada.id, {
    to: second.privateChat,
    own_contact: true,
  });
  const firstUpdates = await first.callBot('getUpdates', {});
  expectEqual(
    [
      secondContact.contact?.user_id,
      (firstUpdates.body.result as Array<{ message?: TestMessage }>).some(({ message }) =>
        message?.message_id === secondContact.message_id &&
        message.contact?.user_id === second.ada.id
      ),
    ],
    [second.ada.id, false],
    "Expected each session's own contact to stay in that session",
  );
});

Deno.test('a grammY bot asks for a contact and a location through its webhook and answers both', async () => {
  const { api, sessionPath, ada, bot, botToken, privateChat, getHistory } =
    await createReuseFixture();
  const grammyBot = new Bot(botToken, {
    client: {
      apiRoot: `${TEST_PUBLIC_ORIGIN}${sessionPath}/bot-api`,
      fetch: async (input, init) => await api.fetch(new Request(input, init)),
    },
  });
  const answered = Promise.withResolvers<void>();
  grammyBot.command('start', async (context) => {
    await context.reply('Share your number', {
      reply_markup: new Keyboard().requestContact('Share number').oneTime(),
    });
  });
  grammyBot.on('message:contact', async (context) => {
    const { contact } = context.message;
    const isOwnContact = contact.user_id === context.from.id;
    await context.reply(isOwnContact ? `Thanks, ${contact.first_name}` : 'Not yours', {
      reply_markup: new Keyboard().requestLocation('Share location'),
    });
  });
  grammyBot.on('message:location', async (context) => {
    const { latitude, longitude } = context.message.location;
    await context.replyWithLocation(latitude, longitude, {
      reply_parameters: { message_id: context.message.message_id },
      reply_markup: { remove_keyboard: true },
    });
    answered.resolve();
  });
  const handleWebhookRequest = webhookCallback(grammyBot, 'std/http');
  const webhookServer = Deno.serve(
    { hostname: '127.0.0.1', port: 0, onListen: () => {} },
    (request) => handleWebhookRequest(request),
  );
  const pressButton = (body: Record<string, unknown>) =>
    requestJson<{ message: TestMessage }>(
      api,
      'POST',
      `${sessionPath}/accounts/${ada.id}/reply-keyboard-presses`,
      { chat: privateChat, ...body },
    );
  const activityPath = `${sessionPath}/bot-activity?bot_id=${bot.id}`;
  /** Waits for the bot's next call of a method after a position, and returns the call's position. */
  const waitForBot = async (method: string, after: number) => {
    const { body } = await requestJson<{ entries: Array<{ position: number }> }>(
      api,
      'GET',
      `${activityPath}&kind=bot_api_call&method=${method}&after=${after}&wait_ms=5000`,
    );
    const [entry] = body.entries;
    if (entry === undefined) {
      throw new Error(`Expected the bot to call ${method}`);
    }
    return entry.position;
  };
  try {
    // The fixture's own messages are not part of this conversation.
    await grammyBot.api.setWebhook(`http://127.0.0.1:${webhookServer.addr.port}/webhook`, {
      drop_pending_updates: true,
    });
    const { body: { head_position: start } } = await requestJson<{ head_position: number }>(
      api,
      'GET',
      `${activityPath}&limit=0`,
    );
    await requestJson(api, 'POST', `${sessionPath}/accounts/${ada.id}/messages`, {
      to: privateChat,
      text: '/start',
    });
    const keyboardPosition = await waitForBot('sendMessage', start);
    const contactPress = await pressButton({ text: 'Share number' });
    const thanksPosition = await waitForBot('sendMessage', keyboardPosition);
    const locationPress = await pressButton({
      text: 'Share location',
      location: { latitude: 48.8584, longitude: 2.2945 },
    });
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      answered.promise,
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error('Expected the bot to answer')), 5_000);
      }),
    ]).finally(() => clearTimeout(timeoutId));
    await waitForBot('sendLocation', thanksPosition);

    const history = await getHistory(ada.id, privateChat);
    const lastMessages = history.slice(-4);
    expectEqual(
      lastMessages.map(({ from, text, contact, location }) => [from?.id, text, contact, location]),
      [
        [ada.id, undefined, { ...OWN_CONTACT, user_id: ada.id }, undefined],
        [bot.id, 'Thanks, Ada', undefined, undefined],
        [ada.id, undefined, undefined, { latitude: 48.8584, longitude: 2.2945 }],
        [bot.id, undefined, undefined, { latitude: 48.8584, longitude: 2.2945 }],
      ],
      'Expected the bot to verify the own contact and answer the location',
    );
    expectEqual(
      [contactPress.status, locationPress.status],
      [201, 201],
      'Expected both presses to be sent',
    );
    const activity = await requestJson<{ entries: Array<{ update: Record<string, unknown> }> }>(
      api,
      'GET',
      `${sessionPath}/bot-activity?bot_id=${bot.id}&kind=update_delivered`,
    );
    expectEqual(
      activity.body.entries
        .map(({ update }) => update.message as TestMessage | undefined)
        .filter((message) => message?.contact !== undefined || message?.location !== undefined)
        .slice(-2)
        .map((message) => [message?.contact?.user_id, message?.location?.latitude]),
      [[ada.id, undefined], [undefined, 48.8584]],
      'Expected the activity log to record the delivered contact and location',
    );
  } finally {
    await api.request(sessionPath, { method: 'DELETE' });
    await webhookServer.shutdown();
  }
});
