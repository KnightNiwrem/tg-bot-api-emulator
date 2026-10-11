import { assertEquals } from '@std/assert';
import type { MediaContent } from '../src/services/domain/message_content.ts';
import { grantSupergroupAdministratorRights } from '../src/types/chat_membership.ts';
import { createMessageForward } from '../src/types/message_forward.ts';
import type { PhotoUpload } from '../src/types/stored_file.ts';
import {
  getContentText,
  isSupergroupContentMessage,
  MAX_CAPTION_LENGTH,
  type SupergroupContentMessage,
  type SupergroupMessage,
} from '../src/types/virtual_message.ts';
import { createChatMessagingServices } from './support/chat_messaging_services.ts';
import { createVirtualAccount, createVirtualBot } from './support/virtual_users.ts';

Deno.test('SupergroupMessagingService numbers messages once for the supergroup and publishes them', () => {
  const { messageBoxes, publishedEvents, owner, bot, supergroup, messageSending } =
    createSupergroupMessagingFixture();

  const accountMessage = expectSent(messageSending.sendAccountSupergroupMessage({
    fromAccountId: owner.profile.id,
    chat: { type: 'supergroup', chatId: supergroup.id },
    content: { kind: 'text', text: '  /start  ' },
  }));
  const botMessage = expectSent(messageSending.sendSupergroupMessage({
    fromBotId: bot.profile.id,
    chat: { type: 'supergroup', chatId: supergroup.id },
    replyTo: { messageId: 2, allowSendingWithoutReply: false },
    isContentProtected: true,
    content: { kind: 'text', text: 'Welcome' },
  }));
  const replyToMissing = expectSent(messageSending.sendSupergroupMessage({
    fromBotId: bot.profile.id,
    chat: { type: 'supergroup', chatId: supergroup.id },
    replyTo: { messageId: 99, allowSendingWithoutReply: true },
    content: { kind: 'text', text: 'Anyone?' },
  }));

  if (
    getContentText(accountMessage.content).text !== '/start' ||
    botMessage.replyToMessageId !== accountMessage.id ||
    !botMessage.isContentProtected ||
    replyToMissing.replyToMessageId !== undefined
  ) {
    throw new Error('Expected normalized text, a resolved reply, and a reply sent without target');
  }
  assertEquals(getContentText(accountMessage.content).entities, [{
    type: 'bot_command',
    offset: 0,
    length: 6,
  }], 'Expected normalized text, a resolved reply, and a reply sent without target');
  const messageIds = [accountMessage, botMessage, replyToMissing].map((message) =>
    messageBoxes.getMessageId(supergroup.id, message.id)
  );
  if (
    messageBoxes.getMessageId(owner.profile.id, accountMessage.id) !== undefined ||
    messageBoxes.getMessageId(bot.profile.id, botMessage.id) !== undefined
  ) {
    throw new Error("Expected the supergroup's own box to number its messages");
  }
  assertEquals(messageIds, [2, 3, 4], "Expected the supergroup's own box to number its messages");
  assertEquals(publishedEvents.map((event) => event.type), [
    'message_created',
    'message_created',
    'message_created',
  ], 'Expected each committed message to be published');
});

Deno.test('SupergroupMessagingService sends albums whole, numbered in order for the supergroup', () => {
  const { messageBoxes, publishedEvents, virtualUsers, owner, bot, supergroup, messageSending } =
    createSupergroupMessagingFixture();
  const photo = (caption: string): MediaContent => ({
    kind: 'photo',
    photo: { kind: 'upload', upload: photoUpload() },
    caption,
    hasSpoiler: false,
    showsCaptionAboveMedia: false,
  });

  const accountAlbum = messageSending.sendAccountSupergroupAlbum({
    fromAccountId: owner.profile.id,
    chat: { type: 'supergroup', chatId: supergroup.id },
    contents: [
      { kind: 'media', upload: photoUpload(), caption: 'Before' },
      { kind: 'media', upload: photoUpload(), caption: 'After' },
    ],
  });
  if (!accountAlbum.sent) {
    throw new Error(`Expected the account's album to be sent, received ${accountAlbum.reason}`);
  }
  const botAlbum = messageSending.sendSupergroupAlbum({
    fromBotId: bot.profile.id,
    chat: { type: 'supergroup', chatId: supergroup.id },
    contents: [photo('Reply'), photo('')],
    replyTo: { messageId: 3, allowSendingWithoutReply: false },
    isContentProtected: true,
  });
  if (!botAlbum.sent) {
    throw new Error(`Expected the bot's album to be sent, received ${botAlbum.reason}`);
  }
  const [firstPhoto, secondPhoto] = accountAlbum.messages;
  const [firstReply, secondReply] = botAlbum.messages;
  const messageIds = [...accountAlbum.messages, ...botAlbum.messages].map((message) =>
    messageBoxes.getMessageId(supergroup.id, message.id)
  );
  if (
    firstPhoto.mediaGroupId === undefined ||
    secondPhoto.mediaGroupId !== firstPhoto.mediaGroupId ||
    firstReply.mediaGroupId === undefined ||
    firstReply.mediaGroupId === firstPhoto.mediaGroupId ||
    secondReply.mediaGroupId !== firstReply.mediaGroupId ||
    botAlbum.messages.some((message) =>
      message.replyToMessageId !== secondPhoto.id || !message.isContentProtected
    ) ||
    publishedEvents.length !== 4
  ) {
    throw new Error('Expected two albums numbered in order, the second replying alike');
  }
  assertEquals(
    messageIds,
    [2, 3, 4, 5],
    'Expected two albums numbered in order, the second replying alike',
  );

  const stranger = createVirtualAccount(virtualUsers, { first_name: 'Grace' });
  const failures = [
    messageSending.sendAccountSupergroupAlbum({
      fromAccountId: stranger.profile.id,
      chat: { type: 'supergroup', chatId: supergroup.id },
      contents: [{ kind: 'media', upload: photoUpload(), caption: '' }],
    }),
    messageSending.sendSupergroupAlbum({
      fromBotId: bot.profile.id,
      chat: { type: 'supergroup', chatId: supergroup.id },
      contents: [photo(''), photo('')],
      replyTo: { messageId: 99, allowSendingWithoutReply: false },
    }),
    messageSending.sendSupergroupAlbum({
      fromBotId: bot.profile.id,
      chat: { type: 'supergroup', chatId: supergroup.id },
      contents: [photo(''), photo('')],
      messageEffectId: '5104841245755180586',
    }),
    messageSending.sendSupergroupAlbum({
      fromBotId: bot.profile.id,
      chat: { type: 'supergroup', chatId: supergroup.id },
      contents: [photo('Fits'), photo('x'.repeat(MAX_CAPTION_LENGTH + 1))],
    }),
    messageSending.sendSupergroupAlbum({
      fromBotId: bot.profile.id,
      chat: { type: 'supergroup', chatId: supergroup.id },
      contents: Array.from({ length: 11 }, () => photo('')),
    }),
  ].map((result) => result.sent ? 'sent' : result.reason);
  if (publishedEvents.length !== 4) {
    throw new Error(
      `Expected refused albums to send nothing, received ${JSON.stringify(failures)}`,
    );
  }
  assertEquals(failures, [
    'not_a_member',
    'reply_message_not_found',
    'message_effect_not_allowed_in_chat',
    'caption_too_long',
    'album_too_large',
  ], 'Expected refused albums to send nothing');

  const albumWithoutReply = messageSending.sendSupergroupAlbum({
    fromBotId: bot.profile.id,
    chat: { type: 'supergroup', chatId: supergroup.id },
    contents: [photo(''), photo('')],
    replyTo: { messageId: 99, allowSendingWithoutReply: true },
  });
  if (
    !albumWithoutReply.sent ||
    albumWithoutReply.messages.some((message) => message.replyToMessageId !== undefined)
  ) {
    throw new Error('Expected allowSendingWithoutReply to send the album as no reply');
  }
});

Deno.test('SupergroupMessagingService lets only members write and read', () => {
  const {
    supergroupMessaging,
    virtualUsers,
    publishedEvents,
    owner,
    bot,
    supergroup,
    messageSending,
  } = createSupergroupMessagingFixture();
  const stranger = createVirtualAccount(virtualUsers, { first_name: 'Grace' });
  const strangerBot = createVirtualBot(virtualUsers, {
    first_name: 'Test Bot',
    username: 'stranger_bot',
  });
  const publishedEventCount = publishedEvents.length;

  const accountFailures = [
    messageSending.sendAccountSupergroupMessage({
      fromAccountId: 999,
      chat: { type: 'supergroup', chatId: supergroup.id },
      content: { kind: 'text', text: 'Hi' },
    }),
    messageSending.sendAccountSupergroupMessage({
      fromAccountId: owner.profile.id,
      chat: { type: 'supergroup', chatId: -1_000_000_009_999 },
      content: { kind: 'text', text: 'Hi' },
    }),
    messageSending.sendAccountSupergroupMessage({
      fromAccountId: stranger.profile.id,
      chat: { type: 'supergroup', chatId: supergroup.id },
      content: { kind: 'text', text: 'Hi' },
    }),
    messageSending.sendAccountSupergroupMessage({
      fromAccountId: owner.profile.id,
      chat: { type: 'supergroup', chatId: supergroup.id },
      content: { kind: 'text', text: '' },
    }),
    messageSending.sendAccountSupergroupMessage({
      fromAccountId: owner.profile.id,
      chat: { type: 'supergroup', chatId: supergroup.id },
      content: { kind: 'text', text: 'x'.repeat(4_097) },
    }),
    messageSending.sendAccountSupergroupMessage({
      fromAccountId: owner.profile.id,
      chat: { type: 'supergroup', chatId: supergroup.id },
      replyToMessageId: 99,
      content: { kind: 'text', text: 'Hi' },
    }),
  ].map((result) => result.sent ? 'sent' : result.reason);
  const botFailures = [
    messageSending.sendSupergroupMessage({
      fromBotId: 999,
      chat: { type: 'supergroup', chatId: supergroup.id },
      content: { kind: 'text', text: 'Hi' },
    }),
    messageSending.sendSupergroupMessage({
      fromBotId: bot.profile.id,
      chat: { type: 'supergroup', chatId: supergroup.id },
      content: { kind: 'text', text: '' },
    }),
    messageSending.sendSupergroupMessage({
      fromBotId: strangerBot.profile.id,
      chat: { type: 'supergroup', chatId: supergroup.id },
      content: { kind: 'text', text: 'Hi' },
    }),
    messageSending.sendSupergroupMessage({
      fromBotId: bot.profile.id,
      chat: { type: 'supergroup', chatId: supergroup.id },
      replyTo: { messageId: 99, allowSendingWithoutReply: false },
      content: { kind: 'text', text: 'Hi' },
    }),
    messageSending.sendSupergroupMessage({
      fromBotId: bot.profile.id,
      chat: { type: 'supergroup', chatId: supergroup.id },
      content: { kind: 'text', text: '   ' },
    }),
    messageSending.sendSupergroupMessage({
      fromBotId: bot.profile.id,
      chat: { type: 'supergroup', chatId: supergroup.id },
      inlineKeyboard: [[{ kind: 'callback', text: 'A', callbackData: 'a'.repeat(65) }]],
      content: { kind: 'text', text: 'Pick' },
    }),
  ].map((result) => result.sent ? 'sent' : result.reason);
  const otherFailures = [
    supergroupMessaging.checkBotChatActionAccess({
      fromBotId: strangerBot.profile.id,
      chatId: supergroup.id,
    }),
    supergroupMessaging.getMessageHistory({
      accountId: stranger.profile.id,
      chatId: supergroup.id,
    }),
  ].map((result) => 'reason' in result ? result.reason : 'succeeded');

  const expected = {
    accountFailures: [
      'account_not_found',
      'chat_not_found',
      'not_a_member',
      'message_text_empty',
      'message_text_too_long',
      'reply_message_not_found',
    ],
    botFailures: [
      'bot_not_found',
      'message_text_empty',
      'chat_not_found',
      'reply_message_not_found',
      'text_invalid',
      'callback_data_invalid',
    ],
    otherFailures: ['chat_not_found', 'not_a_member'],
  };
  const received = { accountFailures, botFailures, otherFailures };
  assertEquals(received, expected, 'Expected member checks');
  if (publishedEvents.length !== publishedEventCount) {
    throw new Error('Expected rejected messages not to be published');
  }
});

Deno.test("SupergroupMessagingService edits and deletes only the author's own messages", () => {
  const {
    supergroupMessaging,
    virtualUsers,
    sharedChatAdministration,
    publishedEvents,
    owner,
    bot,
    supergroup,
    messageEditing,
    messageDeletion,
    messageSending,
  } = createSupergroupMessagingFixture();
  const otherBot = createVirtualBot(virtualUsers, {
    first_name: 'Test Bot',
    username: 'other_bot',
  });
  sharedChatAdministration.addChatMember({
    actorAccountId: owner.profile.id,
    chatId: supergroup.id,
    memberId: otherBot.profile.id,
  });
  expectSent(messageSending.sendAccountSupergroupMessage({
    fromAccountId: owner.profile.id,
    chat: { type: 'supergroup', chatId: supergroup.id },
    content: { kind: 'text', text: 'Hello' },
  }));
  expectSent(messageSending.sendSupergroupMessage({
    fromBotId: bot.profile.id,
    chat: { type: 'supergroup', chatId: supergroup.id },
    content: { kind: 'text', text: 'Menu' },
  }));

  const editFailures = [
    messageEditing.editSupergroupMessageText({
      fromBotId: bot.profile.id,
      chat: { type: 'supergroup', chatId: supergroup.id },
      messageId: 3,
      content: { kind: 'text', text: 'Changed' },
    }),
    messageEditing.editSupergroupMessageText({
      fromBotId: otherBot.profile.id,
      chat: { type: 'supergroup', chatId: supergroup.id },
      messageId: 4,
      content: { kind: 'text', text: 'Changed' },
    }),
    messageEditing.editSupergroupMessageText({
      fromBotId: bot.profile.id,
      chat: { type: 'supergroup', chatId: supergroup.id },
      messageId: 99,
      content: { kind: 'text', text: 'Changed' },
    }),
    messageEditing.editSupergroupMessageKeyboard({
      fromBotId: bot.profile.id,
      chat: { type: 'supergroup', chatId: supergroup.id },
      messageId: 4,
    }),
    messageEditing.editAccountSupergroupMessage({
      fromAccountId: owner.profile.id,
      chat: { type: 'supergroup', chatId: supergroup.id },
      messageId: 4,
      edit: { kind: 'text', text: 'Changed' },
    }),
    messageEditing.editAccountSupergroupMessage({
      fromAccountId: owner.profile.id,
      chat: { type: 'supergroup', chatId: supergroup.id },
      messageId: 3,
      edit: { kind: 'text', text: 'Hello' },
    }),
    messageEditing.editAccountSupergroupMessage({
      fromAccountId: owner.profile.id,
      chat: { type: 'supergroup', chatId: supergroup.id },
      messageId: 1,
      edit: { kind: 'text', text: 'Hello' },
    }),
  ].map((result) => result.edited ? 'edited' : result.reason);
  const deletionFailures = [
    messageDeletion.deleteSupergroupMessages({
      fromBotId: bot.profile.id,
      chat: { type: 'supergroup', chatId: supergroup.id },
      messageIds: [4, 3],
    }),
    messageDeletion.deleteSupergroupMessages({
      fromBotId: otherBot.profile.id,
      chat: { type: 'supergroup', chatId: supergroup.id },
      messageIds: [4],
    }),
  ].map((result) => result.deleted ? 'deleted' : result.reason);
  const expectedFailures = {
    editFailures: [
      'message_not_editable',
      'message_not_editable',
      'message_not_found',
      'message_not_modified',
      'message_not_editable',
      'message_not_modified',
      'message_not_editable',
    ],
    deletionFailures: ['message_not_deletable', 'message_not_deletable'],
  };
  assertEquals({ editFailures, deletionFailures }, expectedFailures, 'Expected authorship checks');

  const publishedEventCount = publishedEvents.length;
  const accountEdit = messageEditing.editAccountSupergroupMessage({
    fromAccountId: owner.profile.id,
    chat: { type: 'supergroup', chatId: supergroup.id },
    messageId: 3,
    edit: { kind: 'text', text: 'Hello /help' },
  });
  const deletion = messageDeletion.deleteSupergroupMessages({
    fromBotId: bot.profile.id,
    chat: { type: 'supergroup', chatId: supergroup.id },
    messageIds: [4, 4, 99],
  });
  const history = supergroupMessaging.getMessageHistory({
    accountId: owner.profile.id,
    chatId: supergroup.id,
  });
  if (
    !accountEdit.edited ||
    accountEdit.message.contentEditedAtUnixSeconds !== 1_700_000_000 ||
    publishedEvents.at(-1)?.type !== 'message_edited' ||
    publishedEvents.length !== publishedEventCount + 1 ||
    !deletion.deleted ||
    deletion.deletedMessageCount !== 1 ||
    !history.found
  ) {
    throw new Error('Expected the account edit to be published and the bot message deleted');
  }
  assertEquals(
    history.messages.map(({ content }) => content.kind === 'text' ? content.text : content.kind),
    ['members_joined', 'members_joined', 'Hello /help'],
    'Expected the account edit to be published and the bot message deleted',
  );
});

Deno.test('SupergroupMessagingService lets the inline bot edit a message sent through it by its chat', () => {
  const {
    virtualUsers,
    sharedChatAdministration,
    messageBoxes,
    owner,
    bot,
    supergroup,
    messageEditing,
    messageSending,
  } = createSupergroupMessagingFixture();
  const otherBot = createVirtualBot(virtualUsers, {
    first_name: 'Test Bot',
    username: 'other_bot',
  });
  const outsiderBot = createVirtualBot(virtualUsers, {
    first_name: 'Test Bot',
    username: 'outsider_bot',
  });
  sharedChatAdministration.addChatMember({
    actorAccountId: owner.profile.id,
    chatId: supergroup.id,
    memberId: otherBot.profile.id,
  });
  const sendThrough = (viaBotId: number) => {
    const message = expectSent(messageSending.sendAccountSupergroupInlineResult({
      fromAccountId: owner.profile.id,
      chat: { type: 'supergroup', chatId: supergroup.id },
      viaBotId,
      content: { kind: 'text', text: 'Cats', entities: [] },
    }));
    const messageId = messageBoxes.getMessageId(supergroup.id, message.id);
    if (messageId === undefined || message.viaBot === undefined) {
      throw new Error('Expected a numbered message sent through the inline bot');
    }
    return { message, messageId, inlineMessageId: message.viaBot.inlineMessageId };
  };
  const editText = (fromBotId: number, messageId: number, text: string) =>
    messageEditing.editSupergroupMessageText({
      fromBotId,
      chat: { type: 'supergroup', chatId: supergroup.id },
      messageId,
      content: { kind: 'text', text },
    });

  const inlineMessage = sendThrough(bot.profile.id);
  const textEdit = editText(bot.profile.id, inlineMessage.messageId, 'Dogs');
  const keyboardEdit = messageEditing.editSupergroupMessageKeyboard({
    fromBotId: bot.profile.id,
    chat: { type: 'supergroup', chatId: supergroup.id },
    messageId: inlineMessage.messageId,
    inlineKeyboard: [[{ kind: 'callback', text: 'More', callbackData: 'more' }]],
  });
  if (
    !textEdit.edited || getContentText(textEdit.message.content).text !== 'Dogs' ||
    textEdit.message.sender.kind !== 'account' || !keyboardEdit.edited
  ) {
    throw new Error(
      `Expected the inline bot to edit the message by its chat, received ${
        JSON.stringify([textEdit, keyboardEdit])
      }`,
    );
  }
  const otherBotEdit = editText(otherBot.profile.id, inlineMessage.messageId, 'Birds');
  if (otherBotEdit.edited || otherBotEdit.reason !== 'message_not_editable') {
    throw new Error('Expected another bot of the supergroup not to edit the inline message');
  }

  // Only its inline message identifier reaches a message outside the inline bot's chats.
  const outsiderMessage = sendThrough(outsiderBot.profile.id);
  const outsiderChatEdit = editText(outsiderBot.profile.id, outsiderMessage.messageId, 'Dogs');
  const outsiderInlineEdit = messageEditing.editInlineMessageText({
    fromBotId: outsiderBot.profile.id,
    inlineMessageId: outsiderMessage.inlineMessageId,
    content: { kind: 'text', text: 'Dogs' },
  });
  if (
    outsiderChatEdit.edited || outsiderChatEdit.reason !== 'chat_not_found' ||
    !outsiderInlineEdit.edited
  ) {
    throw new Error(
      `Expected the chat to stay closed to a bot outside it, received ${
        JSON.stringify([outsiderChatEdit, outsiderInlineEdit])
      }`,
    );
  }
});

Deno.test('SupergroupMessagingService lets bots with the right delete any message', () => {
  const {
    supergroupMessaging,
    sharedChatAdministration,
    owner,
    bot,
    supergroup,
    messageDeletion,
    messageSending,
  } = createSupergroupMessagingFixture();
  expectSent(messageSending.sendAccountSupergroupMessage({
    fromAccountId: owner.profile.id,
    chat: { type: 'supergroup', chatId: supergroup.id },
    content: { kind: 'text', text: 'Spam' },
  }));
  const deleteAccountMessages = () => {
    const result = messageDeletion.deleteSupergroupMessages({
      fromBotId: bot.profile.id,
      chat: { type: 'supergroup', chatId: supergroup.id },
      // The bot's join message, then the account's message.
      messageIds: [1, 2],
    });
    return result.deleted ? result.deletedMessageCount : result.reason;
  };
  const promote = (right: 'can_pin_messages' | 'can_delete_messages') =>
    sharedChatAdministration.promoteChatMember({
      actorAccountId: owner.profile.id,
      chatId: supergroup.id,
      memberId: bot.profile.id,
      rights: grantSupergroupAdministratorRights([right]),
    });

  promote('can_pin_messages');
  const deletionWithoutRight = deleteAccountMessages();
  promote('can_delete_messages');
  const deletionWithRight = deleteAccountMessages();
  const history = supergroupMessaging.getMessageHistory({
    accountId: owner.profile.id,
    chatId: supergroup.id,
  });
  if (
    deletionWithoutRight !== 'message_not_deletable' || deletionWithRight !== 2 ||
    !history.found || history.messages.length !== 0
  ) {
    throw new Error(
      `Expected the bot to delete other members' messages only with the right, received ${
        JSON.stringify([deletionWithoutRight, deletionWithRight])
      }`,
    );
  }
});

Deno.test('SupergroupMessagingService turns away bots that left or were removed', () => {
  const {
    supergroupMessaging,
    virtualUsers,
    sharedChatAdministration,
    owner,
    bot,
    supergroup,
    messageEditing,
    messageDeletion,
    messageSending,
  } = createSupergroupMessagingFixture();
  const removedBot = createVirtualBot(virtualUsers, {
    first_name: 'Test Bot',
    username: 'removed_bot',
  });
  sharedChatAdministration.addChatMember({
    actorAccountId: owner.profile.id,
    chatId: supergroup.id,
    memberId: removedBot.profile.id,
  });
  const botMessage = expectSent(messageSending.sendSupergroupMessage({
    fromBotId: bot.profile.id,
    chat: { type: 'supergroup', chatId: supergroup.id },
    content: { kind: 'text', text: 'Bye' },
  }));
  sharedChatAdministration.leaveChat({ memberId: bot.profile.id, chatId: supergroup.id });
  sharedChatAdministration.removeChatMember({
    actorAccountId: owner.profile.id,
    chatId: supergroup.id,
    memberId: removedBot.profile.id,
  });

  const failures = [bot, removedBot].flatMap(({ profile: { id: fromBotId } }) =>
    [
      messageSending.sendSupergroupMessage({
        fromBotId,
        chat: { type: 'supergroup', chatId: supergroup.id },
        content: { kind: 'text', text: 'Hi' },
      }),
      supergroupMessaging.checkBotChatActionAccess({ fromBotId, chatId: supergroup.id }),
      messageEditing.editSupergroupMessageKeyboard({
        fromBotId,
        chat: { type: 'supergroup', chatId: supergroup.id },
        messageId: 3,
      }),
      messageDeletion.deleteSupergroupMessages({
        fromBotId,
        chat: { type: 'supergroup', chatId: supergroup.id },
        messageIds: [3],
      }),
    ].map((result) => 'reason' in result ? result.reason : 'succeeded')
  );
  const expectedFailures = [
    ...Array(4).fill('bot_not_a_member'),
    ...Array(4).fill('bot_kicked'),
  ];
  assertEquals(failures, expectedFailures, 'Expected former members to be turned away');
  const history = supergroupMessaging.getMessageHistory({
    accountId: owner.profile.id,
    chatId: supergroup.id,
  });
  if (
    !history.found ||
    history.messages[2].id !== botMessage.id
  ) {
    throw new Error(`Expected the departures in the history, received ${JSON.stringify(history)}`);
  }
  assertEquals(
    history.messages.map(({ sender, content }) => ({ sender, kind: content.kind })),
    [
      { sender: { kind: 'account', accountId: owner.profile.id }, kind: 'members_joined' },
      { sender: { kind: 'account', accountId: owner.profile.id }, kind: 'members_joined' },
      { sender: { kind: 'bot', botId: bot.profile.id }, kind: 'text' },
      { sender: { kind: 'bot', botId: bot.profile.id }, kind: 'member_left' },
      { sender: { kind: 'account', accountId: owner.profile.id }, kind: 'member_left' },
    ],
    'Expected the departures in the history',
  );
});

Deno.test('SupergroupMessagingService sends only what a member may send', () => {
  const {
    sharedChatAdministration,
    sharedChats,
    virtualUsers,
    publishedEvents,
    owner,
    bot,
    supergroup,
    messageSending,
  } = createSupergroupMessagingFixture();
  const member = createVirtualAccount(virtualUsers, { first_name: 'Grace' });
  sharedChatAdministration.addChatMember({
    actorAccountId: owner.profile.id,
    chatId: supergroup.id,
    memberId: member.profile.id,
  });
  const ownerPhoto = expectSent(messageSending.sendAccountSupergroupMessage({
    fromAccountId: owner.profile.id,
    chat: { type: 'supergroup', chatId: supergroup.id },
    content: { kind: 'media', upload: photoUpload(), caption: '' },
  }));
  sharedChats.updateChatMemberStatus(supergroup.id, member.profile.id, {
    status: 'restricted',
    isMember: true,
    permissions: new Set(['can_send_messages']),
  });
  publishedEvents.splice(0);
  const describe = (
    result:
      | { readonly sent: true }
      | { readonly sent: false; readonly reason: string; readonly contentKind?: string },
  ) => result.sent ? 'sent' : [result.reason, result.contentKind].filter(Boolean).join(' ');

  // The restriction leaves the member text, and nothing else, which no album or forward bypasses.
  const restrictedSends = [
    messageSending.sendAccountSupergroupMessage({
      fromAccountId: member.profile.id,
      chat: { type: 'supergroup', chatId: supergroup.id },
      content: { kind: 'text', text: 'Hello' },
    }),
    messageSending.sendAccountSupergroupMessage({
      fromAccountId: member.profile.id,
      chat: { type: 'supergroup', chatId: supergroup.id },
      content: { kind: 'media', upload: photoUpload(), caption: 'Look' },
    }),
    messageSending.sendAccountSupergroupAlbum({
      fromAccountId: member.profile.id,
      chat: { type: 'supergroup', chatId: supergroup.id },
      contents: [
        { kind: 'media', upload: photoUpload(), caption: '' },
        { kind: 'media', upload: photoUpload(), caption: '' },
      ],
    }),
    messageSending.sendAccountSupergroupForward({
      fromAccountId: member.profile.id,
      chat: { type: 'supergroup', chatId: supergroup.id },
      forward: createMessageForward(expectContentMessage(ownerPhoto), () => undefined),
    }),
    messageSending.sendAccountSupergroupInlineResult({
      fromAccountId: member.profile.id,
      chat: { type: 'supergroup', chatId: supergroup.id },
      viaBotId: bot.profile.id,
      content: { kind: 'text', text: 'Result', entities: [] },
    }),
  ].map(describe);
  if (publishedEvents.length !== 1) {
    throw new Error(
      `Expected only the restricted member's text to be sent, received ${
        JSON.stringify(restrictedSends)
      }`,
    );
  }
  assertEquals(restrictedSends, [
    'sent',
    'send_permission_missing photo',
    'send_permission_missing photo',
    'send_permission_missing photo',
    'inline_bots_not_permitted',
  ], "Expected only the restricted member's text to be sent");

  // Default permissions bind every member, bots too, but not the owner or administrators.
  sharedChats.updateSupergroupDefaultPermissions(supergroup.id, new Set(['can_send_photos']));
  const defaultSends = () =>
    [
      messageSending.sendAccountSupergroupMessage({
        fromAccountId: member.profile.id,
        chat: { type: 'supergroup', chatId: supergroup.id },
        content: { kind: 'text', text: 'Still here' },
      }),
      messageSending.sendAccountSupergroupMessage({
        fromAccountId: owner.profile.id,
        chat: { type: 'supergroup', chatId: supergroup.id },
        content: { kind: 'text', text: 'Quiet, please' },
      }),
      messageSending.sendSupergroupMessage({
        fromBotId: bot.profile.id,
        chat: { type: 'supergroup', chatId: supergroup.id },
        content: { kind: 'text', text: 'Noted' },
      }),
      messageSending.sendSupergroupAlbum({
        fromBotId: bot.profile.id,
        chat: { type: 'supergroup', chatId: supergroup.id },
        contents: [{
          kind: 'photo',
          photo: { kind: 'upload', upload: photoUpload() },
          caption: '',
          hasSpoiler: false,
          showsCaptionAboveMedia: false,
        }],
      }),
    ].map(describe);
  const sendsUnderDefaults = defaultSends();
  sharedChatAdministration.promoteChatMember({
    actorAccountId: owner.profile.id,
    chatId: supergroup.id,
    memberId: bot.profile.id,
    rights: grantSupergroupAdministratorRights(['can_pin_messages']),
  });
  const sendsAsAdministrator = defaultSends();
  assertEquals(sendsUnderDefaults, [
    'send_permission_missing text',
    'sent',
    'send_permission_missing text',
    'sent',
  ], 'Expected default permissions to bind members only');
  assertEquals(
    sendsAsAdministrator,
    ['send_permission_missing text', 'sent', 'sent', 'sent'],
    'Expected default permissions to bind members only',
  );
});

Deno.test('SupergroupMessagingService lets a text mention name any user of the session', () => {
  const { virtualUsers, owner, bot, supergroup, messageSending } =
    createSupergroupMessagingFixture();
  const outsideAccount = createVirtualAccount(virtualUsers, { first_name: 'Grace' });
  const outsideBot = createVirtualBot(virtualUsers, {
    first_name: 'Test Bot',
    username: 'outside_bot',
  });
  const sendMention = (userId: number) =>
    messageSending.sendSupergroupMessage({
      fromBotId: bot.profile.id,
      chat: { type: 'supergroup', chatId: supergroup.id },
      content: {
        kind: 'text',
        text: 'Hi',
        entities: [{ type: 'text_mention', offset: 0, length: 2, userId }],
      },
    });

  // A member, an account outside the supergroup and a bot outside it can all be mentioned.
  for (const userId of [owner.profile.id, outsideAccount.profile.id, outsideBot.profile.id]) {
    const message = expectContentMessage(expectSent(sendMention(userId)));
    const entities = getContentText(message.content).entities;
    assertEquals(
      entities,
      [{ type: 'text_mention', offset: 0, length: 2, userId }],
      `Expected the mention of ${userId} to be kept`,
    );
  }
  const unknownUserResult = sendMention(999);
  if (
    unknownUserResult.sent || unknownUserResult.reason !== 'text_invalid' ||
    unknownUserResult.textError !== 'User not found'
  ) {
    throw new Error(
      `Expected a mention of an unknown user to be rejected, received ${
        JSON.stringify(unknownUserResult)
      }`,
    );
  }
});

/** Ada owns a supergroup the bot is a member of; the events that set it up are cleared. */
function createSupergroupMessagingFixture() {
  const services = createChatMessagingServices();
  const { virtualUsers, sharedChatAdministration, publishedEvents } = services;
  const owner = createVirtualAccount(virtualUsers, { first_name: 'Ada' });
  const bot = createVirtualBot(virtualUsers, { first_name: 'Test Bot', username: 'test_bot' });
  const creation = sharedChatAdministration.createSupergroup({
    title: 'Team',
    creatorAccountId: owner.profile.id,
  });
  if (!creation.created) {
    throw new Error(`Expected the supergroup to be created, received ${creation.reason}`);
  }
  const addition = sharedChatAdministration.addChatMember({
    actorAccountId: owner.profile.id,
    chatId: creation.supergroup.id,
    memberId: bot.profile.id,
  });
  if (!addition.added) {
    throw new Error(`Expected the bot to be added, received ${addition.reason}`);
  }
  publishedEvents.splice(0);

  return { ...services, owner, bot, supergroup: creation.supergroup };
}

/** A photo upload of a 4 by 3 GIF image, whose header is all the emulator reads. */
function photoUpload(): PhotoUpload {
  const content = new Uint8Array(13);
  content.set(new TextEncoder().encode('GIF89a'));
  content.set([4, 0, 3, 0], 6);
  return { type: 'photo', content, imageFormat: 'gif', width: 4, height: 3 };
}

function expectSent(
  result:
    | { readonly sent: true; readonly message: SupergroupMessage }
    | { readonly sent: false; readonly reason: string },
): SupergroupMessage {
  if (!result.sent) {
    throw new Error(`Expected the message to be sent, received ${result.reason}`);
  }
  return result.message;
}

function expectContentMessage(message: SupergroupMessage): SupergroupContentMessage {
  if (!isSupergroupContentMessage(message)) {
    throw new Error(`Expected message ${message.id} to have content`);
  }
  return message;
}
