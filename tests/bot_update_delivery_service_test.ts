import { AccountRepository } from '../src/repositories/account.ts';
import { BotRepository } from '../src/repositories/bot.ts';
import { BotUpdateRepository } from '../src/repositories/bot_update.ts';
import { BotUpdateSubscriptionRepository } from '../src/repositories/bot_update_subscription.ts';
import { FileRepository } from '../src/repositories/file.ts';
import { LastMessageSendingBotRepository } from '../src/repositories/last_message_sending_bot.ts';
import { PollRepository } from '../src/repositories/poll.ts';
import { MessageRepository } from '../src/repositories/message.ts';
import { SharedChatRepository } from '../src/repositories/shared_chat.ts';
import { TelegramIdentityRepository } from '../src/repositories/telegram_identity.ts';
import { MessageBoxRepository } from '../src/repositories/message_box.ts';
import { BotMessageViewService } from '../src/services/bot_message_view.ts';
import { BotUpdateDeliveryService } from '../src/services/bot_update_delivery.ts';
import { VirtualUserService } from '../src/services/virtual_user.ts';
import { findDetectedEntities } from '../src/text_entities/detected_entities.ts';
import type { BotApiMessage, BotApiUpdate } from '../src/types/bot_api.ts';
import { grantSupergroupAdministratorRights } from '../src/types/chat_membership.ts';
import { ALL_CHAT_PERMISSIONS } from '../src/types/chat_permissions.ts';

Deno.test('BotUpdateDeliveryService delivers a private message to its conversation bot', () => {
  const { virtualUsers, messages, messageBoxes, botUpdates, botUpdateDelivery } =
    createDeliveryFixture();
  const account = createAccount(virtualUsers);
  const targetBot = createBot(virtualUsers, 'target_bot');
  const otherBot = createBot(virtualUsers, 'other_bot');
  const message = messages.addPrivateMessage({
    conversation: { accountId: account.profile.id, botId: targetBot.profile.id },
    authorRole: 'account',
    sentAtUnixSeconds: 1_700_000_000,
    content: {
      kind: 'text',
      text: '/start',
      entities: [{ type: 'bot_command', offset: 0, length: 6 }],
    },
  });
  messageBoxes.assignMessageId(targetBot.profile.id, 'unrelated-message');
  messageBoxes.assignMessageId(targetBot.profile.id, message.id);

  botUpdateDelivery.publish({ type: 'message_created', message });

  const targetBotUpdates = botUpdates.confirmAndReadPendingUpdates(targetBot.profile.id, {
    limit: 100,
  });
  if (
    targetBotUpdates.length !== 1 ||
    messageFromUpdate(targetBotUpdates[0])?.message_id !== 2 ||
    messageFromUpdate(targetBotUpdates[0])?.chat.id !== account.profile.id ||
    messageFromUpdate(targetBotUpdates[0])?.from.id !== account.profile.id ||
    messageFromUpdate(targetBotUpdates[0])?.date !== 1_700_000_000 ||
    textContentOf(messageFromUpdate(targetBotUpdates[0]))?.text !== '/start' ||
    JSON.stringify(textContentOf(messageFromUpdate(targetBotUpdates[0]))?.entities) !==
      JSON.stringify([{ type: 'bot_command', offset: 0, length: 6 }])
  ) {
    throw new Error("Expected one update projected with the bot's own message ID");
  }
  const otherBotUpdates = botUpdates.confirmAndReadPendingUpdates(otherBot.profile.id, {
    limit: 100,
  });
  if (otherBotUpdates.length !== 0) {
    throw new Error('Expected a private message not to reach other bots');
  }
});

Deno.test('BotUpdateDeliveryService does not deliver a bot its own message', () => {
  const { virtualUsers, messages, messageBoxes, botUpdates, botUpdateDelivery } =
    createDeliveryFixture();
  const account = createAccount(virtualUsers);
  const bot = createBot(virtualUsers, 'test_bot');
  const message = messages.addPrivateMessage({
    conversation: { accountId: account.profile.id, botId: bot.profile.id },
    authorRole: 'bot',
    sentAtUnixSeconds: 1_700_000_000,
    content: { kind: 'text', text: 'Welcome!', entities: [] },
  });
  messageBoxes.assignMessageId(bot.profile.id, message.id);

  botUpdateDelivery.publish({ type: 'message_created', message });

  if (botUpdates.confirmAndReadPendingUpdates(bot.profile.id, { limit: 100 }).length !== 0) {
    throw new Error('Expected a bot-authored message not to become an update for its bot');
  }
});

Deno.test('BotUpdateDeliveryService delivers a callback query to the bot whose button was pressed', () => {
  const { virtualUsers, messages, messageBoxes, botUpdates, botUpdateDelivery } =
    createDeliveryFixture();
  const account = createAccount(virtualUsers);
  const bot = createBot(virtualUsers, 'test_bot');
  const message = messages.addPrivateMessage({
    conversation: { accountId: account.profile.id, botId: bot.profile.id },
    authorRole: 'bot',
    sentAtUnixSeconds: 1_700_000_000,
    inlineKeyboard: [[{ kind: 'callback', text: 'Yes', callbackData: 'yes' }]],
    content: { kind: 'text', text: 'Continue?', entities: [] },
  });
  messageBoxes.assignMessageId(bot.profile.id, message.id);

  botUpdateDelivery.publish({
    type: 'callback_query_created',
    callbackQuery: {
      id: '7',
      ...message.conversation,
      messageId: message.id,
      chatInstance: '-42',
      callbackData: 'yes',
      state: { status: 'awaiting_answer' },
    },
    message,
  });

  const updates = botUpdates.confirmAndReadPendingUpdates(bot.profile.id, { limit: 100 });
  const update = updates[0];
  if (updates.length !== 1 || update === undefined || !('callback_query' in update)) {
    throw new Error('Expected one callback query update for the bot');
  }
  const { callback_query: callbackQuery } = update;
  if (
    callbackQuery.id !== '7' ||
    callbackQuery.from !== account.profile ||
    callbackQuery.chat_instance !== '-42' ||
    callbackQuery.data !== 'yes' ||
    !('message' in callbackQuery) ||
    callbackQuery.message.message_id !== 1 ||
    callbackQuery.message.from.id !== bot.profile.id ||
    JSON.stringify(callbackQuery.message.reply_markup) !==
      JSON.stringify({ inline_keyboard: [[{ text: 'Yes', callback_data: 'yes' }]] })
  ) {
    throw new Error('Expected the callback query projected with its message as the bot sees it');
  }
});

Deno.test('BotUpdateDeliveryService skips update types excluded by the bot subscription', () => {
  const {
    virtualUsers,
    messages,
    messageBoxes,
    botUpdates,
    updateSubscriptions,
    botUpdateDelivery,
  } = createDeliveryFixture();
  const account = createAccount(virtualUsers);
  const bot = createBot(virtualUsers, 'test_bot');
  const botMessage = messages.addPrivateMessage({
    conversation: { accountId: account.profile.id, botId: bot.profile.id },
    authorRole: 'bot',
    sentAtUnixSeconds: 1_700_000_000,
    inlineKeyboard: [[{ kind: 'callback', text: 'Yes', callbackData: 'yes' }]],
    content: { kind: 'text', text: 'Continue?', entities: [] },
  });
  const accountMessage = messages.addPrivateMessage({
    conversation: botMessage.conversation,
    authorRole: 'account',
    sentAtUnixSeconds: 1_700_000_001,
    content: { kind: 'text', text: 'Hello', entities: [] },
  });
  messageBoxes.assignMessageId(bot.profile.id, botMessage.id);
  messageBoxes.assignMessageId(bot.profile.id, accountMessage.id);

  updateSubscriptions.setAllowedUpdateTypes(bot.profile.id, new Set(['callback_query']));
  botUpdateDelivery.publish({ type: 'message_created', message: accountMessage });
  botUpdateDelivery.publish({ type: 'message_edited', message: accountMessage });
  botUpdateDelivery.publish({
    type: 'bot_block_changed',
    accountId: account.profile.id,
    botId: bot.profile.id,
    isBlocked: true,
    changedAtUnixSeconds: 1_700_000_002,
  });
  updateSubscriptions.setAllowedUpdateTypes(bot.profile.id, new Set(['message']));
  botUpdateDelivery.publish({
    type: 'callback_query_created',
    callbackQuery: {
      id: '7',
      ...botMessage.conversation,
      messageId: botMessage.id,
      chatInstance: '-42',
      callbackData: 'yes',
      state: { status: 'awaiting_answer' },
    },
    message: botMessage,
  });

  if (botUpdates.confirmAndReadPendingUpdates(bot.profile.id, { limit: 100 }).length !== 0) {
    throw new Error('Expected no update of a type the bot excluded');
  }
});

Deno.test('BotUpdateDeliveryService delivers an account edit, but not its own, to the bot', () => {
  const { virtualUsers, messages, messageBoxes, botUpdates, botUpdateDelivery } =
    createDeliveryFixture();
  const account = createAccount(virtualUsers);
  const bot = createBot(virtualUsers, 'test_bot');
  const conversation = { accountId: account.profile.id, botId: bot.profile.id };
  const accountMessage = messages.addPrivateMessage({
    conversation,
    authorRole: 'account',
    sentAtUnixSeconds: 1_700_000_000,
    content: { kind: 'text', text: 'Hello', entities: [] },
  });
  const botMessage = messages.addPrivateMessage({
    conversation,
    authorRole: 'bot',
    sentAtUnixSeconds: 1_700_000_001,
    content: { kind: 'text', text: 'Hi', entities: [] },
  });
  messageBoxes.assignMessageId(bot.profile.id, accountMessage.id);
  messageBoxes.assignMessageId(bot.profile.id, botMessage.id);
  const edit = {
    entities: [],
    inlineKeyboard: undefined,
    contentEditedAtUnixSeconds: 1_700_000_005,
  };

  botUpdateDelivery.publish({
    type: 'message_edited',
    message: messages.editPrivateMessage(botMessage.id, {
      ...edit,
      content: { kind: 'text', text: 'Hi there', entities: [] },
    }),
  });
  botUpdateDelivery.publish({
    type: 'message_edited',
    message: messages.editPrivateMessage(accountMessage.id, {
      ...edit,
      content: { kind: 'text', text: 'Hello!', entities: [] },
    }),
  });

  const updates = botUpdates.confirmAndReadPendingUpdates(bot.profile.id, { limit: 100 });
  if (
    JSON.stringify(updates) !== JSON.stringify([{
      update_id: 1,
      edited_message: {
        message_id: 1,
        from: account.profile,
        chat: { id: account.profile.id, type: 'private', first_name: 'Ada' },
        date: 1_700_000_000,
        edit_date: 1_700_000_005,
        text: 'Hello!',
      },
    }])
  ) {
    throw new Error(
      `Expected only the account edit as an update, received ${JSON.stringify(updates)}`,
    );
  }
});

Deno.test('BotUpdateDeliveryService reports a block and unblock as changes of the bot membership', () => {
  const { virtualUsers, botUpdates, botUpdateDelivery } = createDeliveryFixture();
  const account = createAccount(virtualUsers);
  const bot = createBot(virtualUsers, 'test_bot');
  const otherBot = createBot(virtualUsers, 'other_bot');
  const blockChange = { accountId: account.profile.id, botId: bot.profile.id };

  botUpdateDelivery.publish({
    type: 'bot_block_changed',
    ...blockChange,
    isBlocked: true,
    changedAtUnixSeconds: 1_700_000_000,
  });
  botUpdateDelivery.publish({
    type: 'bot_block_changed',
    ...blockChange,
    isBlocked: false,
    changedAtUnixSeconds: 1_700_000_009,
  });

  const botUser = {
    id: bot.profile.id,
    is_bot: true,
    first_name: 'Test Bot',
    username: 'test_bot',
  };
  const chat = { id: account.profile.id, type: 'private', first_name: 'Ada' };
  const member = { user: botUser, status: 'member' };
  const kicked = { user: botUser, status: 'kicked', until_date: 0 };
  const updates = botUpdates.confirmAndReadPendingUpdates(bot.profile.id, { limit: 100 });
  if (
    JSON.stringify(updates) !== JSON.stringify([
      {
        update_id: 1,
        my_chat_member: {
          chat,
          from: account.profile,
          date: 1_700_000_000,
          old_chat_member: member,
          new_chat_member: kicked,
        },
      },
      {
        update_id: 2,
        my_chat_member: {
          chat,
          from: account.profile,
          date: 1_700_000_009,
          old_chat_member: kicked,
          new_chat_member: member,
        },
      },
    ])
  ) {
    throw new Error(
      `Expected my_chat_member updates in Telegram form, received ${JSON.stringify(updates)}`,
    );
  }
  if (botUpdates.confirmAndReadPendingUpdates(otherBot.profile.id, { limit: 100 }).length !== 0) {
    throw new Error('Expected a block to reach only the blocked bot');
  }
});

Deno.test('BotUpdateDeliveryService delivers supergroup additions and edits to the bots concerned', () => {
  const {
    virtualUsers,
    sharedChats,
    messages,
    messageBoxes,
    botUpdates,
    updateSubscriptions,
    botUpdateDelivery,
  } = createDeliveryFixture();
  const owner = createAccount(virtualUsers);
  const privacyModeBot = createBot(virtualUsers, 'privacy_bot');
  const readerBotResult = virtualUsers.createBot({
    first_name: 'Reader Bot',
    username: 'reader_bot',
    can_read_all_group_messages: true,
  });
  if (!readerBotResult.created) {
    throw new Error('Expected the reader bot to be created');
  }
  const readerBot = readerBotResult.bot;
  const supergroup = {
    kind: 'supergroup',
    id: -1_000_000_000_001,
    title: 'Team',
    chatInstance: '-42',
    hasProtectedContent: false,
    defaultPermissions: ALL_CHAT_PERMISSIONS,
  } as const;
  sharedChats.registerSupergroup(supergroup, owner.profile.id);
  updateSubscriptions.setAllowedUpdateTypes(privacyModeBot.profile.id, new Set(['message']));
  for (const memberId of [privacyModeBot.profile.id, readerBot.profile.id, 999]) {
    sharedChats.addChatMember(supergroup.id, memberId);
    botUpdateDelivery.publish({
      type: 'chat_member_status_changed',
      chat: supergroup,
      actorId: owner.profile.id,
      memberId,
      oldStatus: { status: 'left' },
      newStatus: { status: 'member' },
      changedAtUnixSeconds: 1_700_000_000,
    });
  }
  const message = messages.addSupergroupMessage({
    chatId: supergroup.id,
    author: { kind: 'account', accountId: owner.profile.id },
    sentAtUnixSeconds: 1_700_000_001,
    content: { kind: 'text', text: 'Hello', entities: [] },
  });
  messageBoxes.assignMessageId(supergroup.id, message.id);
  const editedMessage = messages.editSupergroupMessage(message.id, {
    inlineKeyboard: undefined,
    contentEditedAtUnixSeconds: 1_700_000_002,
    content: { kind: 'text', text: 'Hello again', entities: [] },
  });
  botUpdateDelivery.publish({ type: 'message_edited', message: editedMessage });

  const readerUpdates = botUpdates.confirmAndReadPendingUpdates(readerBot.profile.id, {
    limit: 100,
  });
  const readerUpdateKinds = readerUpdates.map((update) => Object.keys(update)[1]);
  const editedUpdate = readerUpdates[1];
  if (
    JSON.stringify(readerUpdateKinds) !== JSON.stringify(['my_chat_member', 'edited_message']) ||
    !('edited_message' in editedUpdate) || editedUpdate.edited_message.message_id !== 1 ||
    editedUpdate.edited_message.edit_date !== 1_700_000_002
  ) {
    throw new Error(
      `Expected the reader bot to join and see the edit, received ${JSON.stringify(readerUpdates)}`,
    );
  }
  const privacyModeUpdates = botUpdates.confirmAndReadPendingUpdates(privacyModeBot.profile.id, {
    limit: 100,
  });
  if (privacyModeUpdates.length !== 0) {
    throw new Error(
      'Expected no unsubscribed join and no unaddressed edit for the privacy-mode bot',
    );
  }
});

Deno.test('BotUpdateDeliveryService delivers a promotion and every message to an administrator bot', () => {
  const { virtualUsers, sharedChats, messages, messageBoxes, botUpdates, botUpdateDelivery } =
    createDeliveryFixture();
  const owner = createAccount(virtualUsers);
  const administratorBot = createBot(virtualUsers, 'admin_bot');
  const supergroup = {
    kind: 'supergroup',
    id: -1_000_000_000_001,
    title: 'Team',
    chatInstance: '-42',
    hasProtectedContent: false,
    defaultPermissions: ALL_CHAT_PERMISSIONS,
  } as const;
  sharedChats.registerSupergroup(supergroup, owner.profile.id);
  sharedChats.addChatMember(supergroup.id, administratorBot.profile.id);
  const administratorStatus = {
    status: 'administrator',
    rights: grantSupergroupAdministratorRights(['can_delete_messages']),
    tenureId: 1,
    promotedById: owner.profile.id,
  } as const;
  sharedChats.updateChatMemberStatus(
    supergroup.id,
    administratorBot.profile.id,
    administratorStatus,
  );
  botUpdateDelivery.publish({
    type: 'chat_member_status_changed',
    chat: supergroup,
    actorId: owner.profile.id,
    memberId: administratorBot.profile.id,
    oldStatus: { status: 'member' },
    newStatus: administratorStatus,
    changedAtUnixSeconds: 1_700_000_000,
  });
  const message = messages.addSupergroupMessage({
    chatId: supergroup.id,
    author: { kind: 'account', accountId: owner.profile.id },
    sentAtUnixSeconds: 1_700_000_001,
    content: { kind: 'text', text: 'Not addressed to any bot', entities: [] },
  });
  messageBoxes.assignMessageId(supergroup.id, message.id);
  botUpdateDelivery.publish({ type: 'message_created', message });

  const updates = botUpdates.confirmAndReadPendingUpdates(administratorBot.profile.id, {
    limit: 100,
  });
  const user = {
    id: administratorBot.profile.id,
    is_bot: true,
    first_name: 'Test Bot',
    username: 'admin_bot',
  };
  const expectedPromotion = {
    chat: { id: supergroup.id, title: 'Team', type: 'supergroup' },
    from: owner.profile,
    date: 1_700_000_000,
    old_chat_member: { user, status: 'member' },
    new_chat_member: {
      user,
      status: 'administrator',
      can_be_edited: false,
      can_manage_chat: true,
      can_change_info: false,
      can_delete_messages: true,
      can_invite_users: false,
      can_restrict_members: false,
      can_pin_messages: false,
      can_manage_topics: false,
      can_promote_members: false,
      can_manage_video_chats: false,
      can_post_stories: false,
      can_edit_stories: false,
      can_delete_stories: false,
      can_manage_tags: false,
      can_send_welcome_messages: false,
      is_anonymous: false,
      can_manage_voice_chats: false,
    },
  };
  const [promotionUpdate, messageUpdate] = updates;
  if (
    updates.length !== 2 || !('my_chat_member' in promotionUpdate) ||
    JSON.stringify(promotionUpdate.my_chat_member) !== JSON.stringify(expectedPromotion) ||
    !('message' in messageUpdate) || messageUpdate.message.message_id !== 1
  ) {
    throw new Error(
      `Expected the administrator bot to learn of its promotion and read every message, received ${
        JSON.stringify(updates)
      }`,
    );
  }
});

Deno.test("BotUpdateDeliveryService delivers bots' membership service messages to every bot", () => {
  const {
    virtualUsers,
    sharedChats,
    messages,
    messageBoxes,
    botUpdates,
    updateSubscriptions,
    botUpdateDelivery,
  } = createDeliveryFixture();
  const owner = createAccount(virtualUsers);
  const spammer = createAccount(virtualUsers);
  const moderatorBot = createBot(virtualUsers, 'moderator_bot');
  const loggingBot = createBot(virtualUsers, 'logging_bot');
  const unsubscribedBot = createBot(virtualUsers, 'unsubscribed_bot');
  const removedBot = createBot(virtualUsers, 'removed_bot');
  const leavingBot = createBot(virtualUsers, 'leaving_bot');
  const supergroup = {
    kind: 'supergroup',
    id: -1_000_000_000_001,
    title: 'Team',
    chatInstance: '-42',
    hasProtectedContent: false,
    defaultPermissions: ALL_CHAT_PERMISSIONS,
  } as const;
  sharedChats.registerSupergroup(supergroup, owner.profile.id);
  for (
    const memberId of [spammer, moderatorBot, loggingBot, unsubscribedBot, removedBot, leavingBot]
  ) {
    sharedChats.addChatMember(supergroup.id, memberId.profile.id);
  }
  updateSubscriptions.setAllowedUpdateTypes(
    unsubscribedBot.profile.id,
    new Set(['my_chat_member']),
  );
  // As the administration service does, a member leaves the chat before its departure is recorded.
  const recordDeparture = (authorBotId: number, memberId: number) => {
    sharedChats.removeChatMember(supergroup.id, memberId, { status: 'left' });
    const message = messages.addSupergroupMessage({
      chatId: supergroup.id,
      author: { kind: 'bot', botId: authorBotId },
      sentAtUnixSeconds: 1_700_000_000,
      content: { kind: 'member_left', memberId },
    });
    messageBoxes.assignMessageId(supergroup.id, message.id);
    botUpdateDelivery.publish({ type: 'message_created', message });
  };
  const departuresSeenBy = (botId: number) =>
    botUpdates.confirmAndReadPendingUpdates(botId, { limit: 100 }).map((update) => {
      const message = messageFromUpdate(update);
      return message !== undefined && 'left_chat_member' in message
        ? `${message.from?.id} removed ${message.left_chat_member.id}`
        : JSON.stringify(update);
    });

  recordDeparture(moderatorBot.profile.id, spammer.profile.id);
  recordDeparture(moderatorBot.profile.id, removedBot.profile.id);
  recordDeparture(leavingBot.profile.id, leavingBot.profile.id);

  const spammerRemoval = `${moderatorBot.profile.id} removed ${spammer.profile.id}`;
  const botRemoval = `${moderatorBot.profile.id} removed ${removedBot.profile.id}`;
  const leaving = `${leavingBot.profile.id} removed ${leavingBot.profile.id}`;
  const expectedDepartures = new Map([
    [moderatorBot, [spammerRemoval, botRemoval, leaving]],
    [loggingBot, [spammerRemoval, botRemoval, leaving]],
    [unsubscribedBot, []],
    [removedBot, [spammerRemoval, botRemoval]],
    [leavingBot, [spammerRemoval, botRemoval, leaving]],
  ]);
  for (const [bot, expected] of expectedDepartures) {
    const received = departuresSeenBy(bot.profile.id);
    if (JSON.stringify(received) !== JSON.stringify(expected)) {
      throw new Error(
        `Expected ${bot.profile.username} to see ${JSON.stringify(expected)}, received ${
          JSON.stringify(received)
        }`,
      );
    }
  }
});

Deno.test('BotUpdateDeliveryService addresses supergroup media by caption and per-bot file IDs', () => {
  const {
    virtualUsers,
    sharedChats,
    messages,
    files,
    messageBoxes,
    botUpdates,
    botUpdateDelivery,
  } = createDeliveryFixture();
  const owner = createAccount(virtualUsers);
  const privacyModeBot = createBot(virtualUsers, 'privacy_bot');
  const readerBotResult = virtualUsers.createBot({
    first_name: 'Reader Bot',
    username: 'reader_bot',
    can_read_all_group_messages: true,
  });
  if (!readerBotResult.created) {
    throw new Error('Expected the reader bot to be created');
  }
  const readerBot = readerBotResult.bot;
  const supergroup = {
    kind: 'supergroup',
    id: -1_000_000_000_001,
    title: 'Team',
    chatInstance: '-42',
    hasProtectedContent: false,
    defaultPermissions: ALL_CHAT_PERMISSIONS,
  } as const;
  sharedChats.registerSupergroup(supergroup, owner.profile.id);
  sharedChats.addChatMember(supergroup.id, privacyModeBot.profile.id);
  sharedChats.addChatMember(supergroup.id, readerBot.profile.id);
  const document = files.addFile({
    type: 'document',
    content: new Uint8Array([1]),
    fileName: 'notes.txt',
    mimeType: 'text/plain',
  });
  const publishDocument = (caption: string) => {
    const message = messages.addSupergroupMessage({
      chatId: supergroup.id,
      author: { kind: 'account', accountId: owner.profile.id },
      sentAtUnixSeconds: 1_700_000_001,
      content: {
        kind: 'document',
        fileId: document.id,
        caption: {
          text: caption,
          entities: caption.startsWith('/')
            ? [{ type: 'bot_command', offset: 0, length: caption.indexOf(' ') }]
            : [],
        },
      },
    });
    messageBoxes.assignMessageId(supergroup.id, message.id);
    botUpdateDelivery.publish({ type: 'message_created', message });
  };

  publishDocument('Meeting notes');
  publishDocument('/summarize@privacy_bot please');

  const documentsOf = (botId: number) =>
    botUpdates.confirmAndReadPendingUpdates(botId, { limit: 100 }).map((update) =>
      'message' in update && 'document' in update.message ? update.message : undefined
    );
  const readerDocuments = documentsOf(readerBot.profile.id);
  const privacyModeDocuments = documentsOf(privacyModeBot.profile.id);
  const readerFileId = readerDocuments[0]?.document.file_id;
  const privacyModeFileId = privacyModeDocuments[0]?.document.file_id;
  if (
    readerDocuments.length !== 2 || privacyModeDocuments.length !== 1 ||
    privacyModeDocuments[0]?.caption !== '/summarize@privacy_bot please' ||
    readerDocuments[1]?.document.file_id !== readerFileId ||
    readerFileId === undefined || privacyModeFileId === undefined ||
    readerFileId === privacyModeFileId ||
    readerDocuments[0]?.document.file_unique_id !== privacyModeDocuments[0]?.document.file_unique_id
  ) {
    throw new Error(
      `Expected the addressed caption to reach the privacy-mode bot with its own file ID, received ${
        JSON.stringify({ readerDocuments, privacyModeDocuments })
      }`,
    );
  }
});

Deno.test('BotUpdateDeliveryService delivers inline queries, and chosen results only with feedback', () => {
  const { virtualUsers, messages, messageBoxes, botUpdates, botUpdateDelivery } =
    createDeliveryFixture();
  const account = createAccount(virtualUsers);
  const feedbackBot = createInlineBot(virtualUsers, 'feedback_bot', true);
  const quietBot = createInlineBot(virtualUsers, 'quiet_bot', false);
  const inlineQuery = {
    id: '1',
    accountId: account.profile.id,
    botId: feedbackBot.profile.id,
    chat: { type: 'private', botId: feedbackBot.profile.id },
    query: 'cats',
    offset: '',
    state: { status: 'awaiting_answer' },
  } as const;
  botUpdateDelivery.publish({ type: 'inline_query_created', inlineQuery });
  const message = messages.addPrivateMessage({
    conversation: { accountId: account.profile.id, botId: feedbackBot.profile.id },
    authorRole: 'account',
    sentAtUnixSeconds: 1_700_000_000,
    content: { kind: 'text', text: 'Cats', entities: [] },
    inlineKeyboard: [[{ kind: 'callback', text: 'Like', callbackData: 'like' }]],
    viaBotId: feedbackBot.profile.id,
  });
  messageBoxes.assignMessageId(feedbackBot.profile.id, message.id);
  botUpdateDelivery.publish({ type: 'message_created', message });
  botUpdateDelivery.publish({
    type: 'inline_query_result_chosen',
    inlineQuery,
    resultId: 'cats-1',
    message,
  });
  botUpdateDelivery.publish({
    type: 'inline_query_result_chosen',
    inlineQuery: { ...inlineQuery, botId: quietBot.profile.id },
    resultId: 'cats-1',
    message,
  });

  const [inlineQueryUpdate, messageUpdate, chosenResultUpdate, ...unexpectedUpdates] = botUpdates
    .confirmAndReadPendingUpdates(feedbackBot.profile.id, { limit: 100 });
  if (
    inlineQueryUpdate === undefined || !('inline_query' in inlineQueryUpdate) ||
    JSON.stringify(inlineQueryUpdate.inline_query) !== JSON.stringify({
        id: '1',
        from: account.profile,
        chat_type: 'sender',
        query: 'cats',
        offset: '',
      })
  ) {
    throw new Error(`Expected the inline query in Telegram's shape`);
  }
  const sentMessage = messageFromUpdate(messageUpdate);
  if (
    sentMessage === undefined ||
    JSON.stringify(Object.keys(sentMessage).slice(-3)) !==
      JSON.stringify(['text', 'reply_markup', 'via_bot']) ||
    sentMessage.via_bot?.id !== feedbackBot.profile.id
  ) {
    throw new Error(`Expected the message with via_bot after its keyboard`);
  }
  if (
    chosenResultUpdate === undefined || !('chosen_inline_result' in chosenResultUpdate) ||
    JSON.stringify(chosenResultUpdate.chosen_inline_result) !== JSON.stringify({
        from: account.profile,
        inline_message_id: message.viaBot?.inlineMessageId,
        query: 'cats',
        result_id: 'cats-1',
      }) ||
    unexpectedUpdates.length !== 0
  ) {
    throw new Error("Expected the chosen result in Telegram's shape");
  }
  if (botUpdates.countPendingUpdates(quietBot.profile.id) !== 0) {
    throw new Error('Expected a bot without inline feedback to learn of no chosen result');
  }
});

Deno.test('BotUpdateDeliveryService delivers supergroup messages sent through a privacy-mode bot', () => {
  const { virtualUsers, sharedChats, messages, messageBoxes, botUpdates, botUpdateDelivery } =
    createDeliveryFixture();
  const owner = createAccount(virtualUsers);
  const inlineBot = createInlineBot(virtualUsers, 'inline_bot', false);
  const otherBot = createInlineBot(virtualUsers, 'other_bot', false);
  const supergroup = {
    kind: 'supergroup',
    id: -1_000_000_000_001,
    title: 'Team',
    chatInstance: '-42',
    hasProtectedContent: false,
    defaultPermissions: ALL_CHAT_PERMISSIONS,
  } as const;
  sharedChats.registerSupergroup(supergroup, owner.profile.id);
  sharedChats.addChatMember(supergroup.id, inlineBot.profile.id);
  for (const viaBotId of [otherBot.profile.id, inlineBot.profile.id]) {
    const message = messages.addSupergroupMessage({
      chatId: supergroup.id,
      author: { kind: 'account', accountId: owner.profile.id },
      sentAtUnixSeconds: 1_700_000_000,
      content: { kind: 'text', text: 'Cats', entities: [] },
      viaBotId,
    });
    messageBoxes.assignMessageId(supergroup.id, message.id);
    botUpdateDelivery.publish({ type: 'message_created', message });
  }

  const updates = botUpdates.confirmAndReadPendingUpdates(inlineBot.profile.id, { limit: 100 });
  if (updates.length !== 1 || messageFromUpdate(updates[0])?.message_id !== 2) {
    throw new Error('Expected the privacy-mode bot to receive only the message sent through it');
  }
});

Deno.test('BotUpdateDeliveryService lets a message reach only the privacy-mode bot it is meant for', () => {
  const {
    virtualUsers,
    sharedChats,
    messages,
    messageBoxes,
    botUpdates,
    updateSubscriptions,
    botUpdateDelivery,
  } = createDeliveryFixture();
  const owner = createAccount(virtualUsers);
  const botA = createBot(virtualUsers, 'a_bot');
  const botB = createBot(virtualUsers, 'b_bot');
  const botC = createInlineBot(virtualUsers, 'c_bot', false);
  const administratorBot = createBot(virtualUsers, 'admin_bot');
  const supergroup = {
    kind: 'supergroup',
    id: -1_000_000_000_001,
    title: 'Team',
    chatInstance: '-42',
    hasProtectedContent: false,
    defaultPermissions: ALL_CHAT_PERMISSIONS,
  } as const;
  sharedChats.registerSupergroup(supergroup, owner.profile.id);
  for (const bot of [botA, botB, botC, administratorBot]) {
    sharedChats.addChatMember(supergroup.id, bot.profile.id);
  }
  sharedChats.updateChatMemberStatus(supergroup.id, administratorBot.profile.id, {
    status: 'administrator',
    rights: grantSupergroupAdministratorRights([]),
    tenureId: 1,
    promotedById: owner.profile.id,
  });
  const bots = { a: botA, b: botB, c: botC, admin: administratorBot };
  const send = (
    author: { readonly kind: 'account'; readonly accountId: number } | {
      readonly kind: 'bot';
      readonly botId: number;
    },
    text: string,
    options: { readonly replyToMessageId?: string; readonly viaBotId?: number } = {},
  ) => {
    const message = messages.addSupergroupMessage({
      chatId: supergroup.id,
      author,
      sentAtUnixSeconds: 1_700_000_000,
      content: {
        kind: 'text',
        text,
        entities: findDetectedEntities(text),
      },
      ...options,
    });
    messageBoxes.assignMessageId(supergroup.id, message.id);
    botUpdateDelivery.publish({ type: 'message_created', message });
    return message;
  };
  const byAccount = { kind: 'account', accountId: owner.profile.id } as const;
  const recipientsOf = (text: string) =>
    Object.entries(bots).flatMap(([name, bot]) =>
      botUpdates.confirmAndReadPendingUpdates(bot.profile.id, { limit: 100 }).some((update) =>
          textContentOf(messageFromUpdate(update))?.text === text
        )
        ? [name]
        : []
    );
  const expectRecipients = (text: string, expected: readonly string[]) => {
    const received = recipientsOf(text);
    if (JSON.stringify(received) !== JSON.stringify(expected)) {
      throw new Error(
        `Expected ${JSON.stringify(text)} to reach ${JSON.stringify(expected)}, received ${
          JSON.stringify(received)
        }`,
      );
    }
  };

  const questionOfA = send({ kind: 'bot', botId: botA.profile.id }, 'Question of A');
  const inlineMessageOfC = send(byAccount, 'Sent through C', { viaBotId: botC.profile.id });
  expectRecipients('Sent through C', ['c', 'admin']);

  // Replies take precedence over a command for another bot, an inline bot, and a mention.
  send(byAccount, '/help@b_bot to A', { replyToMessageId: questionOfA.id });
  expectRecipients('/help@b_bot to A', ['a', 'admin']);
  send(byAccount, 'Through C to A', {
    replyToMessageId: questionOfA.id,
    viaBotId: botC.profile.id,
  });
  expectRecipients('Through C to A', ['a', 'admin']);
  const replyToA = send(byAccount, 'To A, not @b_bot', { replyToMessageId: questionOfA.id });
  expectRecipients('To A, not @b_bot', ['a', 'admin']);
  // A reply to a message meant for a bot is meant for that bot too.
  send(byAccount, 'Still to A', { replyToMessageId: replyToA.id });
  expectRecipients('Still to A', ['a', 'admin']);
  send(byAccount, '/help@b_bot to C', { replyToMessageId: inlineMessageOfC.id });
  expectRecipients('/help@b_bot to C', ['c', 'admin']);

  // Without a reply, the message is meant for its inline bot, then for the bot its command names.
  send(byAccount, '/help@b_bot, not @a_bot');
  expectRecipients('/help@b_bot, not @a_bot', ['b', 'admin']);
  send(byAccount, '/help@b_bot through C', { viaBotId: botC.profile.id });
  expectRecipients('/help@b_bot through C', ['c', 'admin']);
  send(byAccount, '/help@missing_bot, not @a_bot');
  expectRecipients('/help@missing_bot, not @a_bot', ['admin']);
  // Only a message meant for no bot in particular reaches bots through mentions and commands.
  send(byAccount, 'Hello @a_bot and @b_bot');
  expectRecipients('Hello @a_bot and @b_bot', ['a', 'b', 'admin']);
  // Mentions are those Telegram detects, whose usernames match ignoring ASCII letter case.
  send(byAccount, 'Hello @A_BOT.');
  expectRecipients('Hello @A_BOT.', ['a', 'admin']);
  for (const text of ['Hello @a_boté', 'Hello @a_bot中', 'Hello @a_bot٣', 'Hello @a_ſbot']) {
    send(byAccount, text);
    expectRecipients(text, ['admin']);
  }
  send(byAccount, 'See example.com/@a_bot');
  expectRecipients('See example.com/@a_bot', ['admin']);
  // A bot wrote to the group last, so only that bot in privacy mode receives a general command.
  send(byAccount, '/start');
  expectRecipients('/start', ['a', 'admin']);

  // A bot that does not subscribe to messages still keeps them from other bots in privacy mode.
  updateSubscriptions.setAllowedUpdateTypes(botA.profile.id, new Set(['callback_query']));
  send(byAccount, '/help@b_bot to unsubscribed A', { replyToMessageId: questionOfA.id });
  expectRecipients('/help@b_bot to unsubscribed A', ['admin']);
});

Deno.test('BotUpdateDeliveryService sends general commands to the bot that last wrote to the group', () => {
  const {
    virtualUsers,
    sharedChats,
    messages,
    messageBoxes,
    botUpdates,
    lastMessageSendingBots,
    botUpdateDelivery,
  } = createDeliveryFixture();
  const owner = createAccount(virtualUsers);
  const botA = createBot(virtualUsers, 'a_bot');
  const botB = createBot(virtualUsers, 'b_bot');
  const inlineBot = createInlineBot(virtualUsers, 'inline_bot', false);
  const administratorBot = createBot(virtualUsers, 'admin_bot');
  const supergroup = {
    kind: 'supergroup',
    id: -1_000_000_000_001,
    title: 'Team',
    chatInstance: '-42',
    hasProtectedContent: false,
    defaultPermissions: ALL_CHAT_PERMISSIONS,
  } as const;
  sharedChats.registerSupergroup(supergroup, owner.profile.id);
  for (const bot of [botA, botB, inlineBot, administratorBot]) {
    sharedChats.addChatMember(supergroup.id, bot.profile.id);
  }
  sharedChats.updateChatMemberStatus(supergroup.id, administratorBot.profile.id, {
    status: 'administrator',
    rights: grantSupergroupAdministratorRights([]),
    tenureId: 1,
    promotedById: owner.profile.id,
  });
  const bots = { a: botA, b: botB, inline: inlineBot, admin: administratorBot };
  const send = (
    author: { readonly kind: 'account'; readonly accountId: number } | {
      readonly kind: 'bot';
      readonly botId: number;
    },
    text: string,
    viaBotId?: number,
  ) => {
    const message = messages.addSupergroupMessage({
      chatId: supergroup.id,
      author,
      sentAtUnixSeconds: 1_700_000_000,
      content: {
        kind: 'text',
        text,
        entities: findDetectedEntities(text),
      },
      viaBotId,
    });
    messageBoxes.assignMessageId(supergroup.id, message.id);
    botUpdateDelivery.publish({ type: 'message_created', message });
    return message;
  };
  const byAccount = { kind: 'account', accountId: owner.profile.id } as const;
  const expectRecipients = (text: string, expected: readonly string[]) => {
    const received = Object.entries(bots).flatMap(([name, bot]) =>
      botUpdates.confirmAndReadPendingUpdates(bot.profile.id, { limit: 100 }).some((update) =>
          textContentOf(messageFromUpdate(update))?.text === text
        )
        ? [name]
        : []
    );
    if (JSON.stringify(received) !== JSON.stringify(expected)) {
      throw new Error(
        `Expected ${JSON.stringify(text)} to reach ${JSON.stringify(expected)}, received ${
          JSON.stringify(received)
        }`,
      );
    }
  };

  const expectLastMessageSendingBot = (expectedBotId: number | undefined) => {
    const lastMessageSendingBotId = lastMessageSendingBots.getLastMessageSendingBotId(
      supergroup.id,
    );
    if (lastMessageSendingBotId !== expectedBotId) {
      throw new Error(
        `Expected the last message-sending bot ${expectedBotId}, received ${lastMessageSendingBotId}`,
      );
    }
  };

  // Before any bot writes to the group, every bot in privacy mode receives general commands.
  send(byAccount, '/start first');
  expectRecipients('/start first', ['a', 'b', 'inline', 'admin']);
  expectLastMessageSendingBot(undefined);

  const messageOfA = send({ kind: 'bot', botId: botA.profile.id }, 'A speaks');
  expectLastMessageSendingBot(botA.profile.id);
  send(byAccount, 'Chatter of the account');
  send(byAccount, '/start after A');
  expectRecipients('/start after A', ['a', 'admin']);

  send({ kind: 'bot', botId: botB.profile.id }, 'B speaks');
  // A bot's edit of its earlier message does not make it the last bot to write to the group.
  botUpdateDelivery.publish({ type: 'message_edited', message: messageOfA });
  expectLastMessageSendingBot(botB.profile.id);
  send(byAccount, '/start after B');
  expectRecipients('/start after B', ['b', 'admin']);
  // Mentions and commands naming a bot still reach other bots.
  send(byAccount, 'Hello @a_bot');
  expectRecipients('Hello @a_bot', ['a', 'admin']);
  send(byAccount, '/start@a_bot');
  expectRecipients('/start@a_bot', ['a', 'admin']);

  // An account's message sent through an inline bot is not written by that bot.
  send(byAccount, 'Through the inline bot', inlineBot.profile.id);
  expectLastMessageSendingBot(botB.profile.id);
  send(byAccount, '/start after the inline message');
  expectRecipients('/start after the inline message', ['b', 'admin']);

  // When a bot that reads every message wrote last, no bot in privacy mode receives the command.
  send({ kind: 'bot', botId: administratorBot.profile.id }, 'The administrator bot speaks');
  send(byAccount, '/start after the administrator bot');
  expectRecipients('/start after the administrator bot', ['admin']);
});

Deno.test('BotUpdateDeliveryService delivers chat_member updates to subscribed administrator bots', () => {
  const { virtualUsers, sharedChats, botUpdates, updateSubscriptions, botUpdateDelivery } =
    createDeliveryFixture();
  const owner = createAccount(virtualUsers);
  const newcomer = createAccount(virtualUsers);
  const subscribedAdministratorBot = createBot(virtualUsers, 'subscribed_admin_bot');
  const unsubscribedAdministratorBot = createBot(virtualUsers, 'unsubscribed_admin_bot');
  const subscribedMemberBot = createBot(virtualUsers, 'subscribed_member_bot');
  const supergroup = {
    kind: 'supergroup',
    id: -1_000_000_000_001,
    title: 'Team',
    chatInstance: '-42',
    hasProtectedContent: false,
    defaultPermissions: ALL_CHAT_PERMISSIONS,
  } as const;
  const administratorStatus = {
    status: 'administrator',
    rights: grantSupergroupAdministratorRights(['can_restrict_members']),
    tenureId: 1,
    promotedById: owner.profile.id,
  } as const;
  sharedChats.registerSupergroup(supergroup, owner.profile.id);
  for (const bot of [subscribedAdministratorBot, unsubscribedAdministratorBot]) {
    sharedChats.addChatMember(supergroup.id, bot.profile.id);
    sharedChats.updateChatMemberStatus(supergroup.id, bot.profile.id, administratorStatus);
  }
  sharedChats.addChatMember(supergroup.id, subscribedMemberBot.profile.id);
  for (const bot of [subscribedAdministratorBot, subscribedMemberBot]) {
    updateSubscriptions.setAllowedUpdateTypes(
      bot.profile.id,
      new Set(['message', 'my_chat_member', 'chat_member']),
    );
  }

  sharedChats.addChatMember(supergroup.id, newcomer.profile.id);
  botUpdateDelivery.publish({
    type: 'chat_member_status_changed',
    chat: supergroup,
    actorId: owner.profile.id,
    memberId: newcomer.profile.id,
    oldStatus: { status: 'left' },
    newStatus: { status: 'member' },
    changedAtUnixSeconds: 1_700_000_000,
  });
  sharedChats.removeChatMember(supergroup.id, newcomer.profile.id, {
    status: 'kicked',
    bannedUntilUnixSeconds: undefined,
  });
  botUpdateDelivery.publish({
    type: 'chat_member_status_changed',
    chat: supergroup,
    actorId: subscribedAdministratorBot.profile.id,
    memberId: newcomer.profile.id,
    oldStatus: { status: 'member' },
    newStatus: { status: 'kicked' },
    changedAtUnixSeconds: 1_700_000_001,
  });
  // A change of the administrator bot's own standing is its my_chat_member update instead.
  sharedChats.updateChatMemberStatus(supergroup.id, subscribedAdministratorBot.profile.id, {
    status: 'member',
  });
  botUpdateDelivery.publish({
    type: 'chat_member_status_changed',
    chat: supergroup,
    actorId: owner.profile.id,
    memberId: subscribedAdministratorBot.profile.id,
    oldStatus: administratorStatus,
    newStatus: { status: 'member' },
    changedAtUnixSeconds: 1_700_000_002,
  });

  const administratorUpdates = botUpdates.confirmAndReadPendingUpdates(
    subscribedAdministratorBot.profile.id,
    { limit: 100 },
  );
  const chat = { id: supergroup.id, title: 'Team', type: 'supergroup' };
  const expectedChatMemberUpdates = [
    {
      chat,
      from: owner.profile,
      date: 1_700_000_000,
      old_chat_member: { user: newcomer.profile, status: 'left' },
      new_chat_member: { user: newcomer.profile, status: 'member' },
    },
    {
      chat,
      from: {
        id: subscribedAdministratorBot.profile.id,
        is_bot: true,
        first_name: 'Test Bot',
        username: 'subscribed_admin_bot',
      },
      date: 1_700_000_001,
      old_chat_member: { user: newcomer.profile, status: 'member' },
      new_chat_member: { user: newcomer.profile, status: 'kicked', until_date: 0 },
    },
  ];
  if (
    JSON.stringify(administratorUpdates.map((update) => Object.keys(update)[1])) !==
      JSON.stringify(['chat_member', 'chat_member', 'my_chat_member']) ||
    JSON.stringify(
        administratorUpdates.flatMap((update) =>
          'chat_member' in update ? [update.chat_member] : []
        ),
      ) !== JSON.stringify(expectedChatMemberUpdates)
  ) {
    throw new Error(
      `Expected the subscribed administrator to observe other members' changes, received ${
        JSON.stringify(administratorUpdates)
      }`,
    );
  }
  for (const bot of [unsubscribedAdministratorBot, subscribedMemberBot]) {
    const updates = botUpdates.confirmAndReadPendingUpdates(bot.profile.id, { limit: 100 });
    if (updates.some((update) => 'chat_member' in update)) {
      throw new Error(`Expected ${bot.profile.username} to receive no chat_member update`);
    }
  }
});

Deno.test('BotUpdateDeliveryService addresses a bot message only by its own reply or command', () => {
  const { virtualUsers, sharedChats, messages, messageBoxes, botUpdates, botUpdateDelivery } =
    createDeliveryFixture();
  const owner = createAccount(virtualUsers);
  const senderBot = virtualUsers.createBot({
    first_name: 'Sender Bot',
    username: 'sender_bot',
    enables_bot_to_bot_communication: true,
  });
  if (!senderBot.created) {
    throw new Error(`Expected bot creation to succeed, received ${senderBot.reason}`);
  }
  const inlineBot = createInlineBot(virtualUsers, 'inline_bot', false);
  const supergroupIds = [-1_000_000_000_001, -1_000_000_000_002];
  for (const id of supergroupIds) {
    sharedChats.registerSupergroup({
      kind: 'supergroup',
      id,
      title: 'Team',
      chatInstance: `${id}`,
      hasProtectedContent: false,
      defaultPermissions: ALL_CHAT_PERMISSIONS,
    }, owner.profile.id);
    for (const bot of [senderBot.bot, inlineBot]) {
      sharedChats.addChatMember(id, bot.profile.id);
    }
  }
  const [teamId, otherTeamId] = supergroupIds;
  const send = (
    chatId: number,
    authorBotId: number | undefined,
    text: string,
    options: { readonly replyToMessageId?: string; readonly viaBotId?: number } = {},
  ) => {
    const message = messages.addSupergroupMessage({
      chatId,
      author: authorBotId === undefined
        ? { kind: 'account', accountId: owner.profile.id }
        : { kind: 'bot', botId: authorBotId },
      sentAtUnixSeconds: 1_700_000_000,
      content: { kind: 'text', text, entities: findDetectedEntities(text) },
      ...options,
    });
    messageBoxes.assignMessageId(chatId, message.id);
    botUpdateDelivery.publish({ type: 'message_created', message });
    return message;
  };
  let firstUnreadUpdateId: number | undefined;
  const expectInlineBotToReceive = (expectedTexts: readonly string[]) => {
    const updates = botUpdates.confirmAndReadPendingUpdates(inlineBot.profile.id, {
      firstUnconfirmedUpdateId: firstUnreadUpdateId,
      limit: 100,
    });
    const lastUpdate = updates.at(-1);
    if (lastUpdate !== undefined) {
      firstUnreadUpdateId = lastUpdate.update_id + 1;
    }
    const receivedTexts = updates.flatMap((update) =>
      textContentOf(messageFromUpdate(update))?.text ?? []
    );
    if (JSON.stringify(receivedTexts) !== JSON.stringify(expectedTexts)) {
      throw new Error(
        `Expected the inline bot to receive ${JSON.stringify(expectedTexts)}, received ${
          JSON.stringify(receivedTexts)
        }`,
      );
    }
  };
  const senderBotId = senderBot.bot.profile.id;

  // An account's message sent through the inline bot is not the inline bot's message.
  const sentThroughInlineBot = send(teamId, undefined, 'Through the inline bot', {
    viaBotId: inlineBot.profile.id,
  });
  expectInlineBotToReceive(['Through the inline bot']);
  send(teamId, senderBotId, 'Reply to the account', {
    replyToMessageId: sentThroughInlineBot.id,
  });
  send(teamId, senderBotId, 'Marked as through the inline bot', {
    viaBotId: inlineBot.profile.id,
  });
  expectInlineBotToReceive([]);

  // A reply to the inline bot's message of another supergroup addresses no bot.
  const elsewhere = send(otherTeamId, inlineBot.profile.id, 'Elsewhere');
  send(teamId, senderBotId, 'Reply across supergroups', { replyToMessageId: elsewhere.id });
  expectInlineBotToReceive([]);
  send(otherTeamId, senderBotId, 'Reply in the same supergroup', {
    replyToMessageId: elsewhere.id,
  });
  expectInlineBotToReceive(['Reply in the same supergroup']);
});

function createDeliveryFixture() {
  const identities = new TelegramIdentityRepository();
  const accounts = new AccountRepository();
  const bots = new BotRepository();
  const virtualUsers = new VirtualUserService({ identities, accounts, bots });
  const messages = new MessageRepository();
  const files = new FileRepository();
  const messageBoxes = new MessageBoxRepository();
  const botUpdates = new BotUpdateRepository();
  const updateSubscriptions = new BotUpdateSubscriptionRepository();
  const sharedChats = new SharedChatRepository();
  const lastMessageSendingBots = new LastMessageSendingBotRepository();
  const botUpdateDelivery = new BotUpdateDeliveryService({
    botMessageViews: new BotMessageViewService({
      accounts,
      bots,
      sharedChats,
      messageBoxes,
      messages,
      files,
      polls: new PollRepository(),
    }),
    botUpdates,
    updateSubscriptions,
    bots,
    sharedChats,
    messages,
    lastMessageSendingBots,
  });
  return {
    virtualUsers,
    sharedChats,
    messages,
    files,
    messageBoxes,
    botUpdates,
    updateSubscriptions,
    lastMessageSendingBots,
    botUpdateDelivery,
  };
}

function createAccount(virtualUsers: VirtualUserService) {
  const result = virtualUsers.createAccount({ first_name: 'Ada' });
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

function createInlineBot(
  virtualUsers: VirtualUserService,
  username: string,
  receivesChosenInlineResults: boolean,
) {
  const result = virtualUsers.createBot({
    first_name: 'Inline Bot',
    username,
    supports_inline_queries: true,
    receives_chosen_inline_results: receivesChosenInlineResults,
  });
  if (!result.created) {
    throw new Error(`Expected bot creation to succeed, received ${result.reason}`);
  }
  return result.bot;
}

function messageFromUpdate(update: BotApiUpdate | undefined): BotApiMessage | undefined {
  return update !== undefined && 'message' in update ? update.message : undefined;
}

/** The text and entities of a Bot API text message; `undefined` for any other message. */
function textContentOf(
  message: BotApiMessage | undefined,
): { readonly text: string; readonly entities?: readonly unknown[] } | undefined {
  return message !== undefined && 'text' in message
    ? { text: message.text, entities: message.entities }
    : undefined;
}
