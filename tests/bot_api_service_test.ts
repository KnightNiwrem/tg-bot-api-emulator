import { assertEquals } from '@std/assert';
import type {
  RestrictChatMemberAsAccountInput,
  SharedChatAdministrationService,
} from '../src/services/shared_chat_administration.ts';
import type { VirtualUserService } from '../src/services/virtual_user.ts';
import type { PhotoUpload } from '../src/types/stored_file.ts';
import { assertEqualsInFieldOrder } from './support/field_order_assertion.ts';
import { buildSessionServices } from './support/session_services.ts';
import { createVirtualAccount, createVirtualBot } from './support/virtual_users.ts';

Deno.test('BotApiService reports why a bot cannot address a private chat, for the Bot API to present', () => {
  using session = buildSessionServices();
  const { virtualUsers, privateMessaging, botApi } = session;
  const bot = createBot(virtualUsers, 'test_bot');
  const account = createAccount(virtualUsers);
  const strangerAccount = createAccount(virtualUsers);
  privateMessaging.sendAccountMessage({
    fromAccountId: account.profile.id,
    to: { type: 'private', botId: bot.profile.id },
    content: { kind: 'text', text: '/start' },
  });
  // Telegram reports both as an unknown chat; where the messaging services tell them apart, the
  // service passes both on for the presenters to word.
  const chatId = strangerAccount.profile.id;
  const unknownAccountId = strangerAccount.profile.id + 1000;

  const cases = [
    [
      'sendMessage',
      botApi.sendMessage(bot.profile, { chatId, text: 'Hello' }),
      'conversation_not_started',
    ],
    [
      'sendMessage',
      botApi.sendMessage(bot.profile, { chatId: unknownAccountId, text: 'Hello' }),
      'account_not_found',
    ],
    [
      'editMessageText',
      botApi.editMessageText(bot.profile, {
        chatId,
        messageId: 1,
        content: { kind: 'text', text: 'Done' },
      }),
      'conversation_not_started',
    ],
    [
      'editMessageReplyMarkup',
      botApi.editMessageReplyMarkup(bot.profile, { chatId, messageId: 1 }),
      'conversation_not_started',
    ],
    [
      'stopPoll',
      botApi.stopPoll(bot.profile, { chatId, messageId: 1 }),
      'conversation_not_started',
    ],
    [
      'deleteMessage',
      botApi.deleteMessage(bot.profile, { chatId, messageId: 1 }),
      'conversation_not_started',
    ],
    [
      'deleteMessages',
      botApi.deleteMessages(bot.profile, { chatId: unknownAccountId, messageIds: [1] }),
      'account_not_found',
    ],
    [
      'sendChatAction',
      botApi.sendChatAction(bot.profile, { chatId, action: 'typing' }),
      'conversation_not_started',
    ],
    // The text is checked before the chat.
    ['sendMessage', botApi.sendMessage(bot.profile, { chatId, text: '' }), 'message_text_empty'],
    [
      'sendMessage',
      botApi.sendMessage(bot.profile, {
        chatId: account.profile.id,
        text: 'Hello',
        replyTo: { messageId: 99, allowSendingWithoutReply: false },
      }),
      'reply_message_not_found',
    ],
  ] as const;
  for (const [method, result, expectedReason] of cases) {
    if (!('reason' in result) || result.reason !== expectedReason) {
      throw new Error(
        `Expected ${method} to report ${expectedReason}, received ${JSON.stringify(result)}`,
      );
    }
  }
});

Deno.test('BotApiService sends a contact without a user its caller passes along', () => {
  using session = buildSessionServices();
  const { virtualUsers, privateMessaging, botApi } = session;
  const bot = createBot(virtualUsers, 'test_bot');
  const account = createAccount(virtualUsers);
  privateMessaging.sendAccountMessage({
    fromAccountId: account.profile.id,
    to: { type: 'private', botId: bot.profile.id },
    content: { kind: 'text', text: '/start' },
  });
  const contactWithUser = {
    phoneNumber: '15550100',
    firstName: 'Ada',
    lastName: '',
    vcard: '',
    userId: account.profile.id,
  };
  const result = botApi.sendContact(bot.profile, {
    chatId: account.profile.id,
    contact: contactWithUser,
  });
  assertEqualsInFieldOrder(
    result.sent && 'contact' in result.message ? result.message.contact : result,
    { phone_number: '15550100', first_name: 'Ada' },
    'Expected the contact to show no user',
  );
});

Deno.test('BotApiService reads text with its parse mode or entities', () => {
  using session = buildSessionServices();
  const { botApi } = session;
  const bold = { type: 'bold', offset: 0, length: 2 } as const;
  const read = (text: string, parseMode?: string) =>
    botApi.readFormattedText({ text, parseMode, entities: [bold] });

  // Without a parse mode, or with `none`, the specified entities stand.
  for (const parseMode of [undefined, '', 'None']) {
    assertEquals(
      read('*a*', parseMode),
      { read: true, formattedText: { text: '*a*', entities: [bold] } },
      `Expected parse mode ${parseMode} to keep the entities`,
    );
  }
  // A parse mode, matched case-insensitively, overrides them.
  assertEquals(
    read('_a_', 'MARKDOWNV2'),
    {
      read: true,
      formattedText: { text: 'a', entities: [{ type: 'italic', offset: 0, length: 1 }] },
    },
    'Expected the markup to be parsed',
  );

  const failures: ReadonlyArray<readonly [ReturnType<typeof read>, string]> = [
    [read('x'.repeat(2 ** 15 + 1), 'HTML'), 'text_too_long'],
    [read('x'.repeat(2 ** 15 + 1)), 'text_too_long'],
    [read('a', 'XML'), 'parse_mode_unsupported'],
    [read('\ud800', 'HTML'), 'text_encoding_invalid'],
    [read('<b>', 'HTML'), 'markup_invalid'],
  ];
  for (const [result, expectedReason] of failures) {
    if (result.read || result.reason !== expectedReason) {
      throw new Error(`Expected ${expectedReason}, received ${JSON.stringify(result)}`);
    }
  }
  const markupFailure = read('<b>', 'HTML');
  if (
    markupFailure.read || markupFailure.reason !== 'markup_invalid' ||
    markupFailure.markupError !== 'Can\'t find end tag corresponding to start tag "b"'
  ) {
    throw new Error(`Expected TDLib's markup error, received ${JSON.stringify(markupFailure)}`);
  }
});

Deno.test('BotApiService sends, forwards and copies to a supergroup only what the bot may send', () => {
  using session = buildSessionServices();
  const { virtualUsers, sharedChatAdministration, supergroupMessaging, botApi } = session;
  const owner = createAccount(virtualUsers);
  const bot = createBot(virtualUsers, 'test_bot');
  const creation = sharedChatAdministration.createSupergroup({
    title: 'Team',
    creatorAccountId: owner.profile.id,
  });
  if (!creation.created) {
    throw new Error(`Expected the supergroup to be created, received ${creation.reason}`);
  }
  const chatId = creation.supergroup.id;
  sharedChatAdministration.addChatMember({
    actorAccountId: owner.profile.id,
    chatId,
    memberId: bot.profile.id,
  });
  const sendOwnerContent = (
    content: Parameters<typeof supergroupMessaging.sendAccountMessage>[0]['content'],
  ) => {
    const result = supergroupMessaging.sendAccountMessage({
      fromAccountId: owner.profile.id,
      chatId,
      content,
    });
    if (!result.sent) {
      throw new Error(`Expected the owner's message to be sent, received ${result.reason}`);
    }
  };
  // The bot's addition is the supergroup's first message, so these are its second and third.
  sendOwnerContent({ kind: 'text', text: 'Agenda' });
  sendOwnerContent({ kind: 'media', upload: photoUpload(), caption: '' });
  const [textMessageId, photoMessageId] = [2, 3];
  const botPhoto = botApi.sendPhoto(bot.profile, {
    chatId,
    photo: { kind: 'upload', fileName: 'photo.gif', content: photoUpload().content },
    caption: { text: '' },
    hasSpoiler: false,
    showsCaptionAboveMedia: false,
  });
  if (!botPhoto.sent) {
    throw new Error(`Expected the bot's photo to be sent, received ${botPhoto.reason}`);
  }
  restrictAsOwner(sharedChatAdministration, {
    actorAccountId: owner.profile.id,
    chatId,
    memberId: bot.profile.id,
    permissions: new Set(['can_send_messages']),
  });
  // As TDLib's `edit_message_media` does, new media of an edit needs its permission too.
  const mediaEdit = botApi.editMessageMedia(bot.profile, {
    chatId,
    messageId: botPhoto.message.message_id,
    media: {
      kind: 'photo',
      photo: { kind: 'upload', fileName: 'other.gif', content: photoUpload().content },
      caption: { text: 'Replaced' },
      hasSpoiler: false,
      showsCaptionAboveMedia: false,
    },
  });
  if (
    mediaEdit.edited || mediaEdit.reason !== 'send_permission_missing' ||
    mediaEdit.contentKind !== 'photo'
  ) {
    throw new Error(`Expected the media edit to be refused, received ${JSON.stringify(mediaEdit)}`);
  }
  const reasonOf = (result: { readonly sent: boolean; readonly reason?: string }) =>
    result.sent ? 'sent' : result.reason;
  const repeat = { chatId, fromChatId: chatId };

  const received = [
    reasonOf(botApi.sendMessage(bot.profile, { chatId, text: 'Allowed' })),
    reasonOf(botApi.sendPhoto(bot.profile, {
      chatId,
      photo: { kind: 'upload', fileName: 'photo.gif', content: photoUpload().content },
      caption: { text: '' },
      hasSpoiler: false,
      showsCaptionAboveMedia: false,
    })),
    reasonOf(botApi.forwardMessage(bot.profile, {
      chatId,
      forwardedMessage: { chatId, messageId: textMessageId },
    })),
    reasonOf(botApi.forwardMessage(bot.profile, {
      chatId,
      forwardedMessage: { chatId, messageId: photoMessageId },
    })),
    reasonOf(botApi.copyMessage(bot.profile, {
      chatId,
      copiedMessage: { chatId, messageId: photoMessageId },
      showsCaptionAboveMedia: false,
    })),
    reasonOf(botApi.forwardMessages(bot.profile, { ...repeat, messageIds: [photoMessageId] })),
  ];
  // As TDLib's `forward_messages_impl` does, a batch skips what the bot may not send.
  const batch = botApi.forwardMessages(bot.profile, {
    ...repeat,
    messageIds: [textMessageId, photoMessageId],
  });
  const batchKinds = batch.sent
    ? batch.messageIds.map((messageId) =>
      supergroupMessaging.getMessageByChatMessageId(chatId, messageId)?.content.kind
    )
    : [];
  assertEquals(
    [received, batchKinds],
    [
      [
        'sent',
        'send_permission_missing',
        'sent',
        'message_not_forwardable',
        'message_not_copyable',
        'messages_not_repeatable',
      ],
      ['text'],
    ],
    'Expected only text to reach the supergroup',
  );
});

Deno.test('BotApiService shows restricted members and default permissions', () => {
  using session = buildSessionServices();
  const { virtualUsers, sharedChatAdministration, botApi } = session;
  const owner = createAccount(virtualUsers);
  const member = createAccount(virtualUsers);
  const bot = createBot(virtualUsers, 'test_bot');
  const creation = sharedChatAdministration.createSupergroup({
    title: 'Team',
    creatorAccountId: owner.profile.id,
  });
  if (!creation.created) {
    throw new Error(`Expected the supergroup to be created, received ${creation.reason}`);
  }
  const chatId = creation.supergroup.id;
  for (const memberId of [member.profile.id, bot.profile.id]) {
    sharedChatAdministration.addChatMember({ actorAccountId: owner.profile.id, chatId, memberId });
  }
  restrictAsOwner(sharedChatAdministration, {
    actorAccountId: owner.profile.id,
    chatId,
    memberId: member.profile.id,
    permissions: new Set(['can_send_messages', 'can_send_voice_notes']),
    requestedRestrictionEndUnixSeconds: 1_700_003_600,
  });
  const permissionChange = sharedChatAdministration.changeDefaultPermissions({
    actor: { kind: 'account', accountId: owner.profile.id },
    chatId,
    permissions: new Set(['can_send_messages', 'can_send_polls', 'can_invite_users']),
  });
  if (!permissionChange.changed) {
    throw new Error(`Expected the default permissions to change: ${permissionChange.reason}`);
  }

  const chatMember = botApi.getChatMember(bot.profile, { chatId, userId: member.profile.id });
  const chat = botApi.getChat(bot.profile, { chatId });
  const permissionsOf = (granted: readonly string[]) =>
    Object.fromEntries(
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
      ].map((permission) => [permission, granted.includes(permission)]),
    );
  const expectedMember = {
    user: member.profile,
    status: 'restricted',
    until_date: 1_700_003_600,
    ...permissionsOf(['can_send_messages', 'can_send_media_messages', 'can_send_voice_notes']),
    is_member: true,
  };
  assertEqualsInFieldOrder(
    [
      chatMember.found ? chatMember.member : chatMember,
      chat.found && 'permissions' in chat.chat ? chat.chat.permissions : chat,
    ],
    [
      expectedMember,
      permissionsOf(['can_send_messages', 'can_send_polls', 'can_invite_users']),
    ],
    'Expected the restriction and default permissions',
  );
});

Deno.test('BotApiService refuses to change a supergroup for a bot that does not exist', () => {
  using session = buildSessionServices();
  const { virtualUsers, sharedChatAdministration, botApi } = session;
  const owner = createAccount(virtualUsers);
  const bot = createBot(virtualUsers, 'test_bot');
  const creation = sharedChatAdministration.createSupergroup({
    title: 'Team',
    creatorAccountId: owner.profile.id,
  });
  if (!creation.created) {
    throw new Error(`Expected the supergroup to be created, received ${creation.reason}`);
  }
  const chatId = creation.supergroup.id;
  // An authenticated bot always exists, so a bot that does not is an internal error, not a reason.
  const missingBot = { ...bot.profile, id: bot.profile.id + 1 };
  const expectedMessage = `Bot ${missingBot.id} could not act in chat ${chatId}: actor_not_found`;

  const changes = [
    ['setChatTitle', () => botApi.setChatTitle(missingBot, { chatId, title: 'Renamed' })],
    [
      'setChatDescription',
      () => botApi.setChatDescription(missingBot, { chatId, description: 'About' }),
    ],
    [
      'setChatPermissions',
      () => botApi.setChatPermissions(missingBot, { chatId, permissions: new Set() }),
    ],
  ] as const;
  for (const [method, change] of changes) {
    let changeError: unknown;
    try {
      change();
    } catch (error) {
      changeError = error;
    }
    if (!(changeError instanceof Error) || changeError.message !== expectedMessage) {
      throw new Error(`Expected ${method} to throw ${expectedMessage}, received ${changeError}`);
    }
  }
});

/** A photo upload of a 4 by 3 GIF image, whose header is all the emulator reads. */
function photoUpload(): PhotoUpload {
  const content = new Uint8Array(13);
  content.set(new TextEncoder().encode('GIF89a'));
  content.set([4, 0, 3, 0], 6);
  return { type: 'photo', content, imageFormat: 'gif', width: 4, height: 3 };
}

function createBot(virtualUsers: VirtualUserService, username: string) {
  return createVirtualBot(virtualUsers, { first_name: 'Test Bot', username });
}

function createAccount(virtualUsers: VirtualUserService) {
  return createVirtualAccount(virtualUsers, { first_name: 'Ada' });
}

/** Restricts a member as the supergroup's owner, failing the test if the owner may not. */
function restrictAsOwner(
  sharedChatAdministration: SharedChatAdministrationService,
  input: RestrictChatMemberAsAccountInput,
): void {
  const restriction = sharedChatAdministration.restrictChatMemberAsAccount(input);
  if (!restriction.changed) {
    throw new Error(`Expected member ${input.memberId} to be restricted: ${restriction.reason}`);
  }
}
