import { assertEquals } from '@std/assert';
import {
  editChatMessageKeyboard,
  editChatMessageMedia,
  editChatMessageText,
  stopPoll,
} from '../src/api/sessions/bot_api/message_edits.ts';
import type {
  RestrictChatMemberAsAccountInput,
  SharedChatAdministrationService,
} from '../src/services/domain/shared_chat_administration.ts';
import type { VirtualUserService } from '../src/services/domain/virtual_user.ts';
import type { PhotoUpload } from '../src/types/stored_file.ts';
import { getBotApiChatAddress } from '../src/types/virtual_chat.ts';
import { assertEqualsInFieldOrder } from './support/field_order_assertion.ts';
import { buildSessionServices } from './support/session_services.ts';
import { createVirtualAccount, createVirtualBot } from './support/virtual_users.ts';

Deno.test('BotApiService reports why a bot cannot address a private chat, for the Bot API to present', () => {
  using session = buildSessionServices();
  const { virtualUsers, messageSending, botApi } = session;
  const bot = createBot(virtualUsers, 'test_bot');
  const account = createAccount(virtualUsers);
  const strangerAccount = createAccount(virtualUsers);
  messageSending.sendAccountPrivateChatMessage({
    fromAccountId: account.profile.id,
    chat: { type: 'private', peerId: bot.profile.id },
    content: { kind: 'text', text: '/start' },
  });
  // Telegram reports both as an unknown chat; where the messaging services tell them apart, the
  // service passes both on for the presenters to word.
  const chatId = strangerAccount.profile.id;
  const botContext = { session, bot: bot.profile, signal: session.lifetime.endSignal };
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
      editChatMessageText(botContext, {
        chatId,
        messageId: 1,
        content: { kind: 'text', text: 'Done' },
      }),
      'conversation_not_started',
    ],
    [
      'editMessageReplyMarkup',
      editChatMessageKeyboard(botContext, { chatId, messageId: 1 }),
      'conversation_not_started',
    ],
    [
      'stopPoll',
      stopPoll(botContext, { chatId, messageId: 1 }),
      'conversation_not_started',
    ],
    [
      'deleteMessage',
      session.messageDeletion.deleteChatMessages({
        fromBotId: bot.profile.id,
        chat: getBotApiChatAddress(chatId),
        messageIds: [1],
      }),
      'conversation_not_started',
    ],
    [
      'deleteMessages',
      session.messageDeletion.deleteChatMessages({
        fromBotId: bot.profile.id,
        chat: getBotApiChatAddress(unknownAccountId),
        messageIds: [1],
      }),
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
  const { virtualUsers, messageSending, botApi } = session;
  const bot = createBot(virtualUsers, 'test_bot');
  const account = createAccount(virtualUsers);
  messageSending.sendAccountPrivateChatMessage({
    fromAccountId: account.profile.id,
    chat: { type: 'private', peerId: bot.profile.id },
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
  const { virtualUsers, sharedChatAdministration, supergroupMessaging, messageSending, botApi } =
    session;
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
    content: Parameters<typeof messageSending.sendAccountSupergroupMessage>[0]['content'],
  ) => {
    const result = messageSending.sendAccountSupergroupMessage({
      fromAccountId: owner.profile.id,
      chat: { type: 'supergroup', chatId },
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
  const botContext = { session, bot: bot.profile, signal: session.lifetime.endSignal };
  const mediaEdit = editChatMessageMedia(botContext, {
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
