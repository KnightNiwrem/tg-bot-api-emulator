import { AccountRepository } from '../src/repositories/account.ts';
import { BotRepository } from '../src/repositories/bot.ts';
import { FileRepository } from '../src/repositories/file.ts';
import { PollRepository } from '../src/repositories/poll.ts';
import { MessageRepository } from '../src/repositories/message.ts';
import { MessageBoxRepository } from '../src/repositories/message_box.ts';
import { SharedChatRepository } from '../src/repositories/shared_chat.ts';
import { TelegramIdentityRepository } from '../src/repositories/telegram_identity.ts';
import { SharedChatAdministrationService } from '../src/services/shared_chat_administration.ts';
import type { MediaContent } from '../src/services/message_content.ts';
import { SupergroupMessagingService } from '../src/services/supergroup_messaging.ts';
import { VirtualUserService } from '../src/services/virtual_user.ts';
import type { ChatDomainEvent } from '../src/types/chat_domain_event.ts';
import { grantSupergroupAdministratorRights } from '../src/types/chat_membership.ts';
import type { PhotoUpload } from '../src/types/stored_file.ts';
import {
  getContentText,
  MAX_CAPTION_LENGTH,
  type SupergroupMessage,
} from '../src/types/virtual_message.ts';

Deno.test('SupergroupMessagingService numbers messages once for the supergroup and publishes them', () => {
  const { supergroupMessaging, messageBoxes, publishedEvents, owner, bot, supergroup } =
    createSupergroupMessagingFixture();

  const accountMessage = expectSent(supergroupMessaging.sendAccountMessage({
    fromAccountId: owner.profile.id,
    chatId: supergroup.id,
    content: { kind: 'text', text: '  /start  ' },
  }));
  const botMessage = expectSent(supergroupMessaging.sendBotMessage({
    fromBotId: bot.profile.id,
    chatId: supergroup.id,
    replyTo: { messageId: 2, allowSendingWithoutReply: false },
    isContentProtected: true,
    content: { kind: 'text', text: 'Welcome' },
  }));
  const replyToMissing = expectSent(supergroupMessaging.sendBotMessage({
    fromBotId: bot.profile.id,
    chatId: supergroup.id,
    replyTo: { messageId: 99, allowSendingWithoutReply: true },
    content: { kind: 'text', text: 'Anyone?' },
  }));

  if (
    getContentText(accountMessage.content).text !== '/start' ||
    JSON.stringify(getContentText(accountMessage.content).entities) !==
      JSON.stringify([{ type: 'bot_command', offset: 0, length: 6 }]) ||
    botMessage.replyToMessageId !== accountMessage.id || !botMessage.isContentProtected ||
    replyToMissing.replyToMessageId !== undefined
  ) {
    throw new Error('Expected normalized text, a resolved reply, and a reply sent without target');
  }
  const messageIds = [accountMessage, botMessage, replyToMissing].map((message) =>
    messageBoxes.getMessageId(supergroup.id, message.id)
  );
  if (
    JSON.stringify(messageIds) !== JSON.stringify([2, 3, 4]) ||
    messageBoxes.getMessageId(owner.profile.id, accountMessage.id) !== undefined ||
    messageBoxes.getMessageId(bot.profile.id, botMessage.id) !== undefined
  ) {
    throw new Error("Expected the supergroup's own box to number its messages");
  }
  if (
    JSON.stringify(publishedEvents.map((event) => event.type)) !==
      JSON.stringify(['message_created', 'message_created', 'message_created'])
  ) {
    throw new Error('Expected each committed message to be published');
  }
});

Deno.test('SupergroupMessagingService sends albums whole, numbered in order for the supergroup', () => {
  const {
    supergroupMessaging,
    messageBoxes,
    publishedEvents,
    virtualUsers,
    owner,
    bot,
    supergroup,
  } = createSupergroupMessagingFixture();
  const photo = (caption: string): MediaContent => ({
    kind: 'photo',
    photo: { kind: 'upload', upload: photoUpload() },
    caption,
    hasSpoiler: false,
    showsCaptionAboveMedia: false,
  });

  const accountAlbum = supergroupMessaging.sendAccountAlbum({
    fromAccountId: owner.profile.id,
    chatId: supergroup.id,
    contents: [
      { kind: 'media', upload: photoUpload(), caption: 'Before' },
      { kind: 'media', upload: photoUpload(), caption: 'After' },
    ],
  });
  if (!accountAlbum.sent) {
    throw new Error(`Expected the account's album to be sent, received ${accountAlbum.reason}`);
  }
  const botAlbum = supergroupMessaging.sendBotAlbum({
    fromBotId: bot.profile.id,
    chatId: supergroup.id,
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
    JSON.stringify(messageIds) !== JSON.stringify([2, 3, 4, 5]) ||
    firstPhoto.mediaGroupId === undefined || secondPhoto.mediaGroupId !== firstPhoto.mediaGroupId ||
    firstReply.mediaGroupId === undefined || firstReply.mediaGroupId === firstPhoto.mediaGroupId ||
    secondReply.mediaGroupId !== firstReply.mediaGroupId ||
    botAlbum.messages.some((message) =>
      message.replyToMessageId !== secondPhoto.id || !message.isContentProtected
    ) ||
    publishedEvents.length !== 4
  ) {
    throw new Error('Expected two albums numbered in order, the second replying alike');
  }

  const stranger = createAccount(virtualUsers, 'Grace');
  const failures = [
    supergroupMessaging.sendAccountAlbum({
      fromAccountId: stranger.profile.id,
      chatId: supergroup.id,
      contents: [{ kind: 'media', upload: photoUpload(), caption: '' }],
    }),
    supergroupMessaging.sendBotAlbum({
      fromBotId: bot.profile.id,
      chatId: supergroup.id,
      contents: [photo(''), photo('')],
      messageEffectId: '5104841245755180586',
    }),
    supergroupMessaging.sendBotAlbum({
      fromBotId: bot.profile.id,
      chatId: supergroup.id,
      contents: [photo('Fits'), photo('x'.repeat(MAX_CAPTION_LENGTH + 1))],
    }),
    supergroupMessaging.sendBotAlbum({
      fromBotId: bot.profile.id,
      chatId: supergroup.id,
      contents: Array.from({ length: 11 }, () => photo('')),
    }),
  ].map((result) => result.sent ? 'sent' : result.reason);
  if (
    JSON.stringify(failures) !==
      JSON.stringify([
        'not_a_member',
        'message_effect_not_allowed_in_chat',
        'caption_too_long',
        'album_too_large',
      ]) || publishedEvents.length !== 4
  ) {
    throw new Error(
      `Expected refused albums to send nothing, received ${JSON.stringify(failures)}`,
    );
  }
});

Deno.test('SupergroupMessagingService lets only members write and read', () => {
  const { supergroupMessaging, virtualUsers, publishedEvents, owner, bot, supergroup } =
    createSupergroupMessagingFixture();
  const stranger = createAccount(virtualUsers, 'Grace');
  const strangerBot = createBot(virtualUsers, 'stranger_bot');
  const publishedEventCount = publishedEvents.length;

  const accountFailures = [
    supergroupMessaging.sendAccountMessage({
      fromAccountId: 999,
      chatId: supergroup.id,
      content: { kind: 'text', text: 'Hi' },
    }),
    supergroupMessaging.sendAccountMessage({
      fromAccountId: owner.profile.id,
      chatId: -1_000_000_009_999,
      content: { kind: 'text', text: 'Hi' },
    }),
    supergroupMessaging.sendAccountMessage({
      fromAccountId: stranger.profile.id,
      chatId: supergroup.id,
      content: { kind: 'text', text: 'Hi' },
    }),
    supergroupMessaging.sendAccountMessage({
      fromAccountId: owner.profile.id,
      chatId: supergroup.id,
      content: { kind: 'text', text: '' },
    }),
    supergroupMessaging.sendAccountMessage({
      fromAccountId: owner.profile.id,
      chatId: supergroup.id,
      content: { kind: 'text', text: 'x'.repeat(4_097) },
    }),
    supergroupMessaging.sendAccountMessage({
      fromAccountId: owner.profile.id,
      chatId: supergroup.id,
      replyToMessageId: 99,
      content: { kind: 'text', text: 'Hi' },
    }),
  ].map((result) => result.sent ? 'sent' : result.reason);
  const botFailures = [
    supergroupMessaging.sendBotMessage({
      fromBotId: 999,
      chatId: supergroup.id,
      content: { kind: 'text', text: 'Hi' },
    }),
    supergroupMessaging.sendBotMessage({
      fromBotId: bot.profile.id,
      chatId: supergroup.id,
      content: { kind: 'text', text: '' },
    }),
    supergroupMessaging.sendBotMessage({
      fromBotId: strangerBot.profile.id,
      chatId: supergroup.id,
      content: { kind: 'text', text: 'Hi' },
    }),
    supergroupMessaging.sendBotMessage({
      fromBotId: bot.profile.id,
      chatId: supergroup.id,
      replyTo: { messageId: 99, allowSendingWithoutReply: false },
      content: { kind: 'text', text: 'Hi' },
    }),
    supergroupMessaging.sendBotMessage({
      fromBotId: bot.profile.id,
      chatId: supergroup.id,
      content: { kind: 'text', text: '   ' },
    }),
    supergroupMessaging.sendBotMessage({
      fromBotId: bot.profile.id,
      chatId: supergroup.id,
      inlineKeyboard: [[{ kind: 'callback', text: 'A', callbackData: 'a'.repeat(65) }]],
      content: { kind: 'text', text: 'Pick' },
    }),
  ].map((result) => result.sent ? 'sent' : result.reason);
  const otherFailures = [
    supergroupMessaging.sendBotChatAction({
      fromBotId: strangerBot.profile.id,
      chatId: supergroup.id,
      action: 'typing',
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
  if (JSON.stringify(received) !== JSON.stringify(expected)) {
    throw new Error(`Expected member checks, received ${JSON.stringify(received)}`);
  }
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
  } = createSupergroupMessagingFixture();
  const otherBot = createBot(virtualUsers, 'other_bot');
  sharedChatAdministration.addChatMember({
    actorAccountId: owner.profile.id,
    chatId: supergroup.id,
    memberId: otherBot.profile.id,
  });
  expectSent(supergroupMessaging.sendAccountMessage({
    fromAccountId: owner.profile.id,
    chatId: supergroup.id,
    content: { kind: 'text', text: 'Hello' },
  }));
  expectSent(supergroupMessaging.sendBotMessage({
    fromBotId: bot.profile.id,
    chatId: supergroup.id,
    content: { kind: 'text', text: 'Menu' },
  }));

  const editFailures = [
    supergroupMessaging.editBotMessageText({
      fromBotId: bot.profile.id,
      chatId: supergroup.id,
      messageId: 3,
      content: { kind: 'text', text: 'Changed' },
    }),
    supergroupMessaging.editBotMessageText({
      fromBotId: otherBot.profile.id,
      chatId: supergroup.id,
      messageId: 4,
      content: { kind: 'text', text: 'Changed' },
    }),
    supergroupMessaging.editBotMessageText({
      fromBotId: bot.profile.id,
      chatId: supergroup.id,
      messageId: 99,
      content: { kind: 'text', text: 'Changed' },
    }),
    supergroupMessaging.editBotMessageInlineKeyboard({
      fromBotId: bot.profile.id,
      chatId: supergroup.id,
      messageId: 4,
    }),
    supergroupMessaging.editAccountMessage({
      fromAccountId: owner.profile.id,
      chatId: supergroup.id,
      messageId: 4,
      edit: { kind: 'text', text: 'Changed' },
    }),
    supergroupMessaging.editAccountMessage({
      fromAccountId: owner.profile.id,
      chatId: supergroup.id,
      messageId: 3,
      edit: { kind: 'text', text: 'Hello' },
    }),
    supergroupMessaging.editAccountMessage({
      fromAccountId: owner.profile.id,
      chatId: supergroup.id,
      messageId: 1,
      edit: { kind: 'text', text: 'Hello' },
    }),
  ].map((result) => result.edited ? 'edited' : result.reason);
  const deletionFailures = [
    supergroupMessaging.deleteMessagesByBot({
      fromBotId: bot.profile.id,
      chatId: supergroup.id,
      messageIds: [4, 3],
    }),
    supergroupMessaging.deleteMessagesByBot({
      fromBotId: otherBot.profile.id,
      chatId: supergroup.id,
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
  if (JSON.stringify({ editFailures, deletionFailures }) !== JSON.stringify(expectedFailures)) {
    throw new Error(
      `Expected authorship checks, received ${JSON.stringify({ editFailures, deletionFailures })}`,
    );
  }

  const publishedEventCount = publishedEvents.length;
  const accountEdit = supergroupMessaging.editAccountMessage({
    fromAccountId: owner.profile.id,
    chatId: supergroup.id,
    messageId: 3,
    edit: { kind: 'text', text: 'Hello /help' },
  });
  const deletion = supergroupMessaging.deleteMessagesByBot({
    fromBotId: bot.profile.id,
    chatId: supergroup.id,
    messageIds: [4, 4, 99],
  });
  const history = supergroupMessaging.getMessageHistory({
    accountId: owner.profile.id,
    chatId: supergroup.id,
  });
  if (
    !accountEdit.edited || accountEdit.message.contentEditedAtUnixSeconds !== 1_700_000_000 ||
    publishedEvents.at(-1)?.type !== 'message_edited' ||
    publishedEvents.length !== publishedEventCount + 1 ||
    !deletion.deleted || deletion.deletedMessageCount !== 1 ||
    !history.found ||
    JSON.stringify(
        history.messages.map(({ content }) =>
          content.kind === 'text' ? content.text : content.kind
        ),
      ) !== JSON.stringify(['members_joined', 'members_joined', 'Hello /help'])
  ) {
    throw new Error('Expected the account edit to be published and the bot message deleted');
  }
});

Deno.test('SupergroupMessagingService lets the inline bot edit a message sent through it by its chat', () => {
  const {
    supergroupMessaging,
    virtualUsers,
    sharedChatAdministration,
    messageBoxes,
    owner,
    bot,
    supergroup,
  } = createSupergroupMessagingFixture();
  const otherBot = createBot(virtualUsers, 'other_bot');
  const outsiderBot = createBot(virtualUsers, 'outsider_bot');
  sharedChatAdministration.addChatMember({
    actorAccountId: owner.profile.id,
    chatId: supergroup.id,
    memberId: otherBot.profile.id,
  });
  const sendThrough = (viaBotId: number) => {
    const message = expectSent(supergroupMessaging.sendAccountInlineResult({
      fromAccountId: owner.profile.id,
      chatId: supergroup.id,
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
    supergroupMessaging.editBotMessageText({
      fromBotId,
      chatId: supergroup.id,
      messageId,
      content: { kind: 'text', text },
    });

  const inlineMessage = sendThrough(bot.profile.id);
  const textEdit = editText(bot.profile.id, inlineMessage.messageId, 'Dogs');
  const keyboardEdit = supergroupMessaging.editBotMessageInlineKeyboard({
    fromBotId: bot.profile.id,
    chatId: supergroup.id,
    messageId: inlineMessage.messageId,
    inlineKeyboard: [[{ kind: 'callback', text: 'More', callbackData: 'more' }]],
  });
  if (
    !textEdit.edited || getContentText(textEdit.message.content).text !== 'Dogs' ||
    textEdit.message.author.kind !== 'account' || !keyboardEdit.edited
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
  const outsiderInlineEdit = supergroupMessaging.editBotMessageText({
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
  const { supergroupMessaging, sharedChatAdministration, owner, bot, supergroup } =
    createSupergroupMessagingFixture();
  expectSent(supergroupMessaging.sendAccountMessage({
    fromAccountId: owner.profile.id,
    chatId: supergroup.id,
    content: { kind: 'text', text: 'Spam' },
  }));
  const deleteAccountMessages = () => {
    const result = supergroupMessaging.deleteMessagesByBot({
      fromBotId: bot.profile.id,
      chatId: supergroup.id,
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
  const { supergroupMessaging, virtualUsers, sharedChatAdministration, owner, bot, supergroup } =
    createSupergroupMessagingFixture();
  const removedBot = createBot(virtualUsers, 'removed_bot');
  sharedChatAdministration.addChatMember({
    actorAccountId: owner.profile.id,
    chatId: supergroup.id,
    memberId: removedBot.profile.id,
  });
  const botMessage = expectSent(supergroupMessaging.sendBotMessage({
    fromBotId: bot.profile.id,
    chatId: supergroup.id,
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
      supergroupMessaging.sendBotMessage({
        fromBotId,
        chatId: supergroup.id,
        content: { kind: 'text', text: 'Hi' },
      }),
      supergroupMessaging.sendBotChatAction({ fromBotId, chatId: supergroup.id, action: 'typing' }),
      supergroupMessaging.editBotMessageInlineKeyboard({
        fromBotId,
        chatId: supergroup.id,
        messageId: 3,
      }),
      supergroupMessaging.deleteMessagesByBot({
        fromBotId,
        chatId: supergroup.id,
        messageIds: [3],
      }),
    ].map((result) => 'reason' in result ? result.reason : 'succeeded')
  );
  const expectedFailures = [
    ...Array(4).fill('bot_not_a_member'),
    ...Array(4).fill('bot_kicked'),
  ];
  if (JSON.stringify(failures) !== JSON.stringify(expectedFailures)) {
    throw new Error(`Expected former members to be turned away, received ${failures.join()}`);
  }
  const history = supergroupMessaging.getMessageHistory({
    accountId: owner.profile.id,
    chatId: supergroup.id,
  });
  const expectedHistory = [
    { author: { kind: 'account', accountId: owner.profile.id }, kind: 'members_joined' },
    { author: { kind: 'account', accountId: owner.profile.id }, kind: 'members_joined' },
    { author: { kind: 'bot', botId: bot.profile.id }, kind: 'text' },
    { author: { kind: 'bot', botId: bot.profile.id }, kind: 'member_left' },
    { author: { kind: 'account', accountId: owner.profile.id }, kind: 'member_left' },
  ];
  if (
    !history.found ||
    JSON.stringify(
        history.messages.map(({ author, content }) => ({ author, kind: content.kind })),
      ) !==
      JSON.stringify(expectedHistory) ||
    history.messages[2].id !== botMessage.id
  ) {
    throw new Error(`Expected the departures in the history, received ${JSON.stringify(history)}`);
  }
});

function createSupergroupMessagingFixture() {
  const identities = new TelegramIdentityRepository();
  const accounts = new AccountRepository();
  const bots = new BotRepository();
  const virtualUsers = new VirtualUserService({ identities, accounts, bots });
  const sharedChats = new SharedChatRepository();
  const messageBoxes = new MessageBoxRepository();
  const publishedEvents: ChatDomainEvent[] = [];
  const events = { publish: (event: ChatDomainEvent) => publishedEvents.push(event) };
  const currentUnixTimeSeconds = () => 1_700_000_000;
  const supergroupMessaging = new SupergroupMessagingService({
    accounts,
    bots,
    sharedChats,
    messages: new MessageRepository(),
    files: new FileRepository(),
    polls: new PollRepository(),
    messageBoxes,
    events,
    currentUnixTimeSeconds,
  });
  const sharedChatAdministration = new SharedChatAdministrationService({
    identities,
    accounts,
    bots,
    sharedChats,
    supergroupMessages: supergroupMessaging,
    events,
    currentUnixTimeSeconds,
  });

  const owner = createAccount(virtualUsers, 'Ada');
  const bot = createBot(virtualUsers, 'test_bot');
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

  return {
    virtualUsers,
    sharedChatAdministration,
    supergroupMessaging,
    messageBoxes,
    publishedEvents,
    owner,
    bot,
    supergroup: creation.supergroup,
  };
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

function createAccount(virtualUsers: VirtualUserService, firstName: string) {
  const result = virtualUsers.createAccount({ first_name: firstName });
  if (!result.created) {
    throw new Error(`Expected account creation to succeed, received ${result.reason}`);
  }
  return result.account;
}

function createBot(virtualUsers: VirtualUserService, username: string) {
  const result = virtualUsers.createBot({ first_name: 'Test Bot', username });
  if (!result.created) {
    throw new Error(`Expected bot creation to succeed, received ${result.reason}`);
  }
  return result.bot;
}
