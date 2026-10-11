import { assertEquals } from '@std/assert';
import { assertEqualsInFieldOrder } from './support/field_order_assertion.ts';
import { createAccount, createBot } from './support/http_fixtures.ts';
import { createUpdateReader, withoutUpdateIds } from './support/bot_api_requests.ts';
import { createTestSession, requestJson } from './support/emulation_api.ts';

interface TestContact {
  readonly phone_number: string;
  readonly first_name: string;
  readonly last_name?: string;
  readonly vcard?: string;
  readonly user_id?: number;
}

interface TestMessage {
  readonly message_id: number;
  readonly from?: { readonly id: number };
  readonly text?: string;
  readonly contact?: TestContact;
  readonly reply_to_message?: { readonly message_id: number };
}

/**
 * Creates a session where Ada, who signed up with a phone number, owns a supergroup with Grace,
 * who has none, and the contact bot, which reads only what privacy mode lets it; Ada has started
 * a private chat with the bot.
 */
async function createContactFixture() {
  await using disposalOnFailure = new AsyncDisposableStack();
  const { api, sessionPath } = disposalOnFailure.use(await createTestSession());
  const ada = await createAccount(api, sessionPath, 'Ada', {
    last_name: 'Lovelace',
    phone_number: '15550100',
  });
  const grace = await createAccount(api, sessionPath, 'Grace');
  const createdBot = await createBot(api, sessionPath, 'contact_bot', {
    first_name: 'Contact Bot',
  });
  const { botApiPath } = createdBot;
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
  const getHistory = async (accountId: number, chat: typeof privateChat | typeof supergroupChat) =>
    (await requestJson<{ messages: TestMessage[] }>(
      api,
      'GET',
      chat.type === 'private'
        ? `${accountPath(accountId)}/conversations/private/${chat.botId}/messages`
        : `${supergroupPath(accountId)}/messages`,
    )).body.messages;
  const readBotUpdates = createUpdateReader(api);
  const readUpdates = async () => withoutUpdateIds(await readBotUpdates(botApiPath));
  await readUpdates();

  const emulatorDisposal = disposalOnFailure.move();
  return {
    api,
    ada,
    grace,
    bot: createdBot.bot,
    privateChat,
    supergroupChat,
    accountPath,
    supergroupPath,
    sendAccountMessage,
    callBot,
    getHistory,
    readUpdates,
    [Symbol.asyncDispose]: () => emulatorDisposal.disposeAsync(),
  };
}

Deno.test('a bot sends a contact whose texts Telegram cleans and whose user stays unknown', async () => {
  await using fixture = await createContactFixture();
  const { ada, privateChat, callBot, getHistory } = fixture;
  const sent = await callBot('sendContact', {
    chat_id: ada.id,
    phone_number: '+1 (555) 010-0200',
    first_name: 'Grace\u0007Hopper',
    last_name: 'Hopper',
    vcard: 'BEGIN:VCARD\nVERSION:3.0\nFN:Grace Hopper\nEND:VCARD',
  });
  const sentMessage = sent.body.result as TestMessage;
  assertEqualsInFieldOrder(
    sentMessage.contact,
    {
      phone_number: '+1 (555) 010-0200',
      first_name: 'Grace Hopper',
      last_name: 'Hopper',
      vcard: 'BEGIN:VCARD\nVERSION:3.0\nFN:Grace Hopper\nEND:VCARD',
    },
    'Expected the contact as written, with control characters turned into spaces and no user',
  );
  const minimal = await callBot('sendContact', {
    chat_id: ada.id,
    phone_number: '12345',
    first_name: 'Linus',
  });
  assertEqualsInFieldOrder(
    (minimal.body.result as TestMessage).contact,
    { phone_number: '12345', first_name: 'Linus' },
    'Expected an empty last name and vCard to be omitted',
  );
  assertEqualsInFieldOrder(
    (await getHistory(ada.id, privateChat)).slice(-2).map((message) => message.contact),
    [sentMessage.contact, { phone_number: '12345', first_name: 'Linus' }],
    'Expected the account history to show both contacts',
  );
});

Deno.test('sendContact refuses missing, malformed and over-long contacts without sending', async () => {
  await using fixture = await createContactFixture();
  const { ada, privateChat, callBot, getHistory } = fixture;
  const historyLength = (await getHistory(ada.id, privateChat)).length;
  const valid = { chat_id: ada.id, phone_number: '12345', first_name: 'Linus' };
  const refusals = [
    [{ ...valid, phone_number: '' }, 'Bad Request: parameter "phone_number" is required'],
    [{ chat_id: ada.id, first_name: 'Linus' }, 'Bad Request: parameter "phone_number" is required'],
    [{ ...valid, first_name: '' }, 'Bad Request: parameter "first_name" is required'],
    [{ ...valid, phone_number: '\ud800' }, 'Bad Request: phone number must be encoded in UTF-8'],
    [{ ...valid, first_name: 'Li\udc00' }, 'Bad Request: first name must be encoded in UTF-8'],
    [{ ...valid, last_name: '\ud800' }, 'Bad Request: last name must be encoded in UTF-8'],
    [{ ...valid, vcard: '\ud800' }, 'Bad Request: vCard must be encoded in UTF-8'],
    [{ ...valid, phone_number: '\r' }, 'Bad Request: phone number must be non-empty'],
    [{ ...valid, first_name: '\r\r' }, 'Bad Request: first name must be non-empty'],
    [{ ...valid, first_name: 'x'.repeat(65) }, 'Bad Request: invalid sendContact parameters'],
    [{ ...valid, last_name: '😀'.repeat(65) }, 'Bad Request: invalid sendContact parameters'],
    [{ ...valid, vcard: 'é'.repeat(1025) }, 'Bad Request: invalid sendContact parameters'],
    [{ ...valid, user_id: ada.id }, 'Bad Request: invalid sendContact parameters'],
    [{ phone_number: '12345', first_name: 'Linus' }, 'Bad Request: chat_id is empty'],
  ] as const;
  for (const [parameters, description] of refusals) {
    const { status, body } = await callBot('sendContact', parameters);
    assertEquals(
      [status, body.description],
      [400, description],
      `Expected ${JSON.stringify(parameters)} to be refused`,
    );
  }
  const accepted = await callBot('sendContact', {
    ...valid,
    first_name: '😀'.repeat(64),
    vcard: 'é'.repeat(1024),
  });
  assertEquals(accepted.status, 200, 'Expected names and a vCard at their limits to be sent');
  assertEquals(
    (await getHistory(ada.id, privateChat)).length,
    historyLength + 1,
    'Expected only the accepted contact to be sent',
  );
});

Deno.test('an account answers a request_contact button with its own contact, replying to the keyboard', async () => {
  await using fixture = await createContactFixture();
  const { api, ada, bot, privateChat, accountPath, callBot, readUpdates } = fixture;
  const keyboard = await callBot('sendMessage', {
    chat_id: ada.id,
    text: 'Share your number?',
    reply_markup: { keyboard: [[{ text: 'Share', request_contact: true }]] },
  });
  const keyboardMessageId = (keyboard.body.result as TestMessage).message_id;
  await readUpdates();

  const press = await requestJson<{ message: TestMessage }>(
    api,
    'POST',
    `${accountPath(ada.id)}/reply-keyboard-presses`,
    { chat: privateChat, text: 'Share' },
  );
  const ownContact = {
    phone_number: '15550100',
    first_name: 'Ada',
    last_name: 'Lovelace',
    user_id: ada.id,
  };
  assertEqualsInFieldOrder(
    [press.status, press.body.message.contact, press.body.message.reply_to_message?.message_id],
    [201, ownContact, keyboardMessageId],
    'Expected the press to share the own contact in reply to the keyboard',
  );
  const [update] = await readUpdates();
  const received = (update as { message: TestMessage }).message;
  assertEqualsInFieldOrder(
    [received.from?.id, received.contact, received.reply_to_message?.message_id],
    [ada.id, ownContact, keyboardMessageId],
    'Expected the bot to receive the shared contact as an ordinary message',
  );
  assertEquals(
    received.contact?.user_id === received.from?.id,
    true,
    'Expected the bot to verify that the account shared its own contact',
  );

  const answer = await callBot('sendMessage', {
    chat_id: ada.id,
    text: `Thanks, ${received.contact?.first_name}`,
    reply_parameters: { message_id: received.message_id },
    reply_markup: { remove_keyboard: true },
  });
  assertEquals(answer.status, 200, 'Expected the bot to answer the shared contact');
  assertEquals(bot.id, privateChat.botId, 'Expected the press to reach the keyboard bot');
});

Deno.test('a request_contact press without a phone number shares nothing', async () => {
  await using fixture = await createContactFixture();
  const { api, grace, bot, accountPath, sendAccountMessage, callBot, getHistory, readUpdates } =
    fixture;
  const graceChat = { type: 'private', botId: bot.id } as const;
  await sendAccountMessage(grace.id, { to: graceChat, text: '/start' });
  await callBot('sendMessage', {
    chat_id: grace.id,
    text: 'Share your number?',
    reply_markup: { keyboard: [[{ text: 'Share', request_contact: true }]] },
  });
  await readUpdates();
  const historyLength = (await getHistory(grace.id, graceChat)).length;

  const press = await api.request(`${accountPath(grace.id)}/reply-keyboard-presses`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat: graceChat, text: 'Share' }),
  });
  const ownContact = await sendAccountMessage(grace.id, { to: graceChat, own_contact: true });
  assertEquals(
    [press.status, ownContact.status],
    [409, 409],
    'Expected an account without a phone number to have no contact of its own',
  );
  assertEquals(
    [(await getHistory(grace.id, graceChat)).length, await readUpdates()],
    [historyLength, []],
    'Expected the refusals to send nothing',
  );
});

Deno.test('accounts share their own or written contacts in private chats and supergroups', async () => {
  await using fixture = await createContactFixture();
  const { ada, grace, privateChat, supergroupChat, sendAccountMessage, getHistory, readUpdates } =
    fixture;
  const written = await sendAccountMessage(ada.id, {
    to: privateChat,
    contact: { phone_number: '15550100', first_name: 'Ada', last_name: 'Lovelace' },
  });
  assertEqualsInFieldOrder(
    [written.status, written.body.message.contact],
    [201, { phone_number: '15550100', first_name: 'Ada', last_name: 'Lovelace' }],
    "Expected a written contact to show no user, even with the account's own number",
  );
  const own = await sendAccountMessage(ada.id, { to: supergroupChat, own_contact: true });
  assertEquals(
    [own.status, own.body.message.contact?.user_id],
    [201, ada.id],
    'Expected the own contact to show the account as its user in the supergroup',
  );
  const reply = await sendAccountMessage(grace.id, {
    to: supergroupChat,
    reply_to_message_id: own.body.message.message_id,
    contact: { phone_number: '15550199', first_name: 'Grace', vcard: 'BEGIN:VCARD\nEND:VCARD' },
  });
  assertEqualsInFieldOrder(
    [reply.status, reply.body.message.contact, reply.body.message.reply_to_message?.message_id],
    [
      201,
      { phone_number: '15550199', first_name: 'Grace', vcard: 'BEGIN:VCARD\nEND:VCARD' },
      own.body.message.message_id,
    ],
    'Expected a member to reply with a written contact',
  );
  assertEqualsInFieldOrder(
    (await getHistory(grace.id, supergroupChat)).slice(-2).map((message) => message.contact),
    [own.body.message.contact, reply.body.message.contact],
    'Expected the supergroup history to keep both contacts',
  );
  const updates = await readUpdates();
  assertEquals(
    updates.map((update) => (update as { message: TestMessage }).message.contact?.first_name),
    ['Ada'],
    'Expected the privacy-mode bot to receive only the private contact',
  );

  const refusedBodies = [
    { to: privateChat, contact: { phone_number: '', first_name: 'Ada' } },
    { to: privateChat, contact: { phone_number: '1', first_name: '' } },
    { to: privateChat, contact: { phone_number: '1', first_name: 'x'.repeat(65) } },
    { to: privateChat, contact: { phone_number: '1', first_name: 'A', vcard: 'é'.repeat(1025) } },
    { to: privateChat, contact: { phone_number: '1', first_name: 'A', user_id: ada.id } },
    { to: privateChat, contact: { phone_number: '\ud800', first_name: 'A' } },
    { to: privateChat, contact: { phone_number: '1', first_name: '\r' } },
    { to: privateChat, own_contact: false },
    { to: privateChat, own_contact: true, contact: { phone_number: '1', first_name: 'A' } },
  ];
  const privateHistoryLength = (await getHistory(ada.id, privateChat)).length;
  for (const body of refusedBodies) {
    const { status } = await sendAccountMessage(ada.id, body);
    assertEquals(status, 400, `Expected ${JSON.stringify(body)} to be refused`);
  }
  assertEquals(
    [(await getHistory(ada.id, privateChat)).length, await readUpdates()],
    [privateHistoryLength, []],
    'Expected refused contacts to send nothing',
  );
});

Deno.test('sign-up names fit in contacts, and phone numbers are the digits of an E.164 number', async () => {
  await using fixture = await createContactFixture();
  const { api, accountPath } = fixture;
  const accountsPath = accountPath(0).replace(/\/0$/, '');
  const unusableProfiles = [
    { first_name: '\r' },
    { first_name: '\ud800' },
    { first_name: 'Linus', last_name: 'Torvalds\udc00' },
    { first_name: 'Ada\u0007Lovelace' },
    { first_name: 'Linus', last_name: '\r' },
  ];
  for (const profile of unusableProfiles) {
    const response = await api.request(accountsPath, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...profile, phone_number: '15550111' }),
    });
    assertEquals(response.status, 400, `Expected ${JSON.stringify(profile)} to be refused`);
  }
  for (const name of ['x'.repeat(65), '😀'.repeat(65)]) {
    for (const profile of [{ first_name: name }, { first_name: 'Linus', last_name: name }]) {
      const response = await api.request(accountsPath, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(profile),
      });
      assertEquals(response.status, 400, 'Expected a name over 64 characters to be refused');
    }
  }
  for (const phoneNumber of ['+15550100', '015550100', '1555 0100', '', '1234567890123456', 5]) {
    const response = await api.request(accountsPath, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ first_name: 'Linus', phone_number: phoneNumber }),
    });
    assertEquals(response.status, 400, `Expected phone number ${phoneNumber} to be refused`);
  }
});

Deno.test('contacts need the permission to send messages in supergroups', async () => {
  await using fixture = await createContactFixture();
  const {
    api,
    ada,
    grace,
    supergroupChat,
    supergroupPath,
    sendAccountMessage,
    callBot,
    getHistory,
  } = fixture;
  const restriction = await requestJson(
    api,
    'PUT',
    `${supergroupPath(ada.id)}/permissions`,
    { permissions: { can_send_photos: true } },
  );
  assertEquals(restriction.status, 204, 'Expected the owner to withhold sending messages');
  const historyLength = (await getHistory(ada.id, supergroupChat)).length;

  const accountContact = await sendAccountMessage(grace.id, {
    to: supergroupChat,
    contact: { phone_number: '1', first_name: 'Grace' },
  });
  const botContact = await callBot('sendContact', {
    chat_id: supergroupChat.chatId,
    phone_number: '1',
    first_name: 'Bot',
  });
  const ownerContact = await sendAccountMessage(ada.id, { to: supergroupChat, own_contact: true });
  assertEquals(
    [accountContact.status, botContact.status, botContact.body.description, ownerContact.status],
    [403, 400, 'Bad Request: not enough rights to send contacts to the chat', 201],
    'Expected only the owner to send a contact without the permission',
  );
  assertEquals(
    (await getHistory(ada.id, supergroupChat)).length,
    historyLength + 1,
    'Expected the refused contacts to be missing from the history',
  );
});

Deno.test('a contact message keeps its contact through edits of its keyboard only', async () => {
  await using fixture = await createContactFixture();
  const { ada, privateChat, sendAccountMessage, callBot } = fixture;
  const document = await sendAccountMessage(ada.id, {
    to: privateChat,
    document: { content_base64: 'aGVsbG8=', file_name: 'notes.txt' },
  });
  const documentFileId = (document.body.message as { document?: { file_id: string } }).document
    ?.file_id;
  const sent = await callBot('sendContact', {
    chat_id: ada.id,
    phone_number: '12345',
    first_name: 'Linus',
    reply_markup: { inline_keyboard: [[{ text: 'Call', callback_data: 'call' }]] },
  });
  const messageId = (sent.body.result as TestMessage).message_id;
  const target = { chat_id: ada.id, message_id: messageId };
  const textEdit = await callBot('editMessageText', { ...target, text: 'Linus' });
  const captionEdit = await callBot('editMessageCaption', { ...target, caption: 'Linus' });
  const mediaEdit = await callBot('editMessageMedia', {
    ...target,
    media: { type: 'document', media: documentFileId },
  });
  const markupEdit = await callBot('editMessageReplyMarkup', {
    ...target,
    reply_markup: { inline_keyboard: [[{ text: 'Text', callback_data: 'text' }]] },
  });
  assertEqualsInFieldOrder(
    [
      textEdit.body.description,
      captionEdit.body.description,
      mediaEdit.body.description,
      markupEdit.status,
      (markupEdit.body.result as TestMessage).contact,
    ],
    [
      'Bad Request: there is no text in the message to edit',
      'Bad Request: there is no caption in the message to edit',
      "Bad Request: message media can't be edited",
      200,
      { phone_number: '12345', first_name: 'Linus' },
    ],
    'Expected only the keyboard of a contact message to be editable',
  );
});
