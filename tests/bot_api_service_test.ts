import { AccountRepository } from '../src/repositories/account.ts';
import { BlockedUserRepository } from '../src/repositories/blocked_user.ts';
import { BotActivityLogRepository } from '../src/repositories/bot_activity_log.ts';
import { BotRepository } from '../src/repositories/bot.ts';
import { BotCommandRepository } from '../src/repositories/bot_command.ts';
import { BotDefaultAdministratorRightsRepository } from '../src/repositories/bot_default_administrator_rights.ts';
import { BotDescriptionRepository } from '../src/repositories/bot_description.ts';
import { BotMenuButtonRepository } from '../src/repositories/bot_menu_button.ts';
import { BotUpdateRepository } from '../src/repositories/bot_update.ts';
import { BotUpdateSubscriptionRepository } from '../src/repositories/bot_update_subscription.ts';
import { BotWebhookRepository } from '../src/repositories/bot_webhook.ts';
import { CallbackQueryRepository } from '../src/repositories/callback_query.ts';
import { ChatActionRepository } from '../src/repositories/chat_action.ts';
import { FileRepository } from '../src/repositories/file.ts';
import { PollRepository } from '../src/repositories/poll.ts';
import { InlineQueryRepository } from '../src/repositories/inline_query.ts';
import { MessageRepository } from '../src/repositories/message.ts';
import { PrivateConversationRepository } from '../src/repositories/private_conversation.ts';
import { SharedChatRepository } from '../src/repositories/shared_chat.ts';
import { TelegramIdentityRepository } from '../src/repositories/telegram_identity.ts';
import { MessageBoxRepository } from '../src/repositories/message_box.ts';
import { BotActivityService } from '../src/services/bot_activity.ts';
import { BotApiService } from '../src/services/bot_api.ts';
import { BotCommandService } from '../src/services/bot_command.ts';
import { BotDefaultAdministratorRightsService } from '../src/services/bot_default_administrator_rights.ts';
import { BotDescriptionService } from '../src/services/bot_description.ts';
import { BotMenuButtonService } from '../src/services/bot_menu_button.ts';
import { BotMessageViewService } from '../src/services/bot_message_view.ts';
import { MediaFileService } from '../src/services/media_file.ts';
import { normalizeCaption } from '../src/services/message_content.ts';
import { MessagePinningService } from '../src/services/message_pinning.ts';
import { SharedChatAdministrationService } from '../src/services/shared_chat_administration.ts';
import { BotUpdateDeliveryService } from '../src/services/bot_update_delivery.ts';
import { BotUpdatePollingService } from '../src/services/bot_update_polling.ts';
import {
  BotWebhookService,
  WEBHOOK_ATTEMPT_TIMEOUT_MILLISECONDS,
} from '../src/services/bot_webhook.ts';
import { CallbackQueryService } from '../src/services/callback_query.ts';
import { ChatActionService } from '../src/services/chat_action.ts';
import { InlineQueryService } from '../src/services/inline_query.ts';
import { PrivateMessagingService } from '../src/services/private_messaging.ts';
import { SupergroupMessagingService } from '../src/services/supergroup_messaging.ts';
import { VirtualUserService } from '../src/services/virtual_user.ts';
import type { PhotoUpload } from '../src/types/stored_file.ts';

Deno.test('BotApiService translates private messaging failures into Bot API reasons', () => {
  const { virtualUsers, privateMessaging, botApi } = createBotApiFixture();
  const bot = createBot(virtualUsers, 'test_bot');
  const account = createAccount(virtualUsers);
  const strangerAccount = createAccount(virtualUsers);
  privateMessaging.sendAccountMessage({
    fromAccountId: account.profile.id,
    to: { type: 'private', botId: bot.profile.id },
    content: { kind: 'text', text: '/start' },
  });
  // Any user who has not written to the bot is, like an unknown chat, not found.
  const chatId = strangerAccount.profile.id;

  const cases = [
    ['sendMessage', botApi.sendMessage(bot.profile, { chatId, text: 'Hello' }), 'chat_not_found'],
    [
      'editMessageText',
      botApi.editMessageText(bot.profile, {
        chatId,
        messageId: 1,
        content: { kind: 'text', text: 'Done' },
      }),
      'chat_not_found',
    ],
    [
      'editMessageReplyMarkup',
      botApi.editMessageReplyMarkup(bot.profile, { chatId, messageId: 1 }),
      'chat_not_found',
    ],
    [
      'deleteMessage',
      botApi.deleteMessage(bot.profile, { chatId, messageId: 1 }),
      'chat_not_found',
    ],
    [
      'deleteMessages',
      botApi.deleteMessages(bot.profile, { chatId, messageIds: [1] }),
      'chat_not_found',
    ],
    [
      'sendChatAction',
      botApi.sendChatAction(bot.profile, { chatId, action: 'typing' }),
      'chat_not_found',
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
  const { virtualUsers, privateMessaging, botApi } = createBotApiFixture();
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
  if (
    !result.sent ||
    JSON.stringify('contact' in result.message ? result.message.contact : undefined) !==
      JSON.stringify({ phone_number: '15550100', first_name: 'Ada' })
  ) {
    throw new Error(`Expected the contact to show no user, received ${JSON.stringify(result)}`);
  }
});

Deno.test('BotApiService reads text with its parse mode or entities', () => {
  const { botApi } = createBotApiFixture();
  const bold = { type: 'bold', offset: 0, length: 2 } as const;
  const read = (text: string, parseMode?: string) =>
    botApi.readFormattedText({ text, parseMode, entities: [bold] });

  // Without a parse mode, or with `none`, the specified entities stand.
  for (const parseMode of [undefined, '', 'None']) {
    const result = read('*a*', parseMode);
    if (
      !result.read || result.formattedText.text !== '*a*' ||
      JSON.stringify(result.formattedText.entities) !== JSON.stringify([bold])
    ) {
      throw new Error(
        `Expected parse mode ${parseMode} to keep the entities, received ${JSON.stringify(result)}`,
      );
    }
  }
  // A parse mode, matched case-insensitively, overrides them.
  const markdownResult = read('_a_', 'MARKDOWNV2');
  if (
    !markdownResult.read || markdownResult.formattedText.text !== 'a' ||
    JSON.stringify(markdownResult.formattedText.entities) !==
      JSON.stringify([{ type: 'italic', offset: 0, length: 1 }])
  ) {
    throw new Error(`Expected the markup to be parsed, received ${JSON.stringify(markdownResult)}`);
  }

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
  const { virtualUsers, sharedChats, sharedChatAdministration, supergroupMessaging, botApi } =
    createBotApiFixture();
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
  sharedChats.updateChatMemberStatus(chatId, bot.profile.id, {
    status: 'restricted',
    isMember: true,
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
  if (
    JSON.stringify(received) !== JSON.stringify([
        'sent',
        'send_permission_missing',
        'sent',
        'message_not_forwardable',
        'message_not_copyable',
        'messages_not_repeatable',
      ]) || JSON.stringify(batchKinds) !== JSON.stringify(['text'])
  ) {
    throw new Error(
      `Expected only text to reach the supergroup, received ${JSON.stringify([received, batch])}`,
    );
  }
});

Deno.test('BotApiService shows restricted members and default permissions', () => {
  const { virtualUsers, sharedChats, sharedChatAdministration, botApi } = createBotApiFixture();
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
  sharedChats.updateChatMemberStatus(chatId, member.profile.id, {
    status: 'restricted',
    isMember: true,
    permissions: new Set(['can_send_messages', 'can_send_voice_notes']),
    restrictedUntilUnixSeconds: 1_700_003_600,
  });
  sharedChats.updateSupergroupDefaultPermissions(
    chatId,
    new Set(['can_send_messages', 'can_send_polls', 'can_invite_users']),
  );

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
  if (
    !chatMember.found || JSON.stringify(chatMember.member) !== JSON.stringify(expectedMember) ||
    !chat.found || !('permissions' in chat.chat) ||
    JSON.stringify(chat.chat.permissions) !==
      JSON.stringify(permissionsOf(['can_send_messages', 'can_send_polls', 'can_invite_users']))
  ) {
    throw new Error(
      `Expected the restriction and default permissions, received ${
        JSON.stringify([chatMember, chat])
      }`,
    );
  }
});

function createBotApiFixture() {
  const identities = new TelegramIdentityRepository();
  const accounts = new AccountRepository();
  const bots = new BotRepository();
  const virtualUsers = new VirtualUserService({ identities, accounts, bots });
  const messageBoxes = new MessageBoxRepository();
  const messages = new MessageRepository();
  const files = new FileRepository();
  const polls = new PollRepository();
  const botUpdates = new BotUpdateRepository();
  const botActivity = new BotActivityService({ log: new BotActivityLogRepository() });
  const updateSubscriptions = new BotUpdateSubscriptionRepository();
  const sharedChats = new SharedChatRepository();
  const botMessageViews = new BotMessageViewService({
    accounts,
    bots,
    sharedChats,
    messageBoxes,
    messages,
    files,
    polls,
  });
  const events = new BotUpdateDeliveryService({
    botMessageViews,
    botUpdates,
    updateSubscriptions,
    bots,
    sharedChats,
    messages,
  });
  const privateConversations = new PrivateConversationRepository();
  const blockedUsers = new BlockedUserRepository();
  const privateMessaging = new PrivateMessagingService({
    accounts,
    bots,
    privateConversations,
    messages,
    files,
    polls,
    messageBoxes,
    blockedUsers,
    events,
    currentUnixTimeSeconds: () => 1_700_000_000,
  });
  const supergroupMessaging = new SupergroupMessagingService({
    accounts,
    bots,
    sharedChats,
    messages,
    files,
    polls,
    messageBoxes,
    events,
    currentUnixTimeSeconds: () => 1_700_000_000,
  });
  const callbackQueries = new CallbackQueryService({
    accounts,
    bots,
    privateConversations,
    privateMessages: privateMessaging,
    sharedChats,
    supergroupMessages: supergroupMessaging,
    callbackQueries: new CallbackQueryRepository(),
    events,
  });
  const sharedChatAdministration = new SharedChatAdministrationService({
    identities,
    accounts,
    bots,
    sharedChats,
    supergroupMessages: supergroupMessaging,
    events,
    currentUnixTimeSeconds: () => 1_700_000_000,
  });
  const mediaFiles = new MediaFileService({
    files,
    uploadProfile: 'cloud',
    webFiles: {
      download: () => Promise.resolve({ downloaded: false, reason: 'content_unavailable' }),
    },
  });
  const botApi = new BotApiService({
    bots,
    updatePolling: new BotUpdatePollingService({
      botUpdates,
      updateSubscriptions,
      updateActivity: botActivity,
    }),
    webhooks: new BotWebhookService({
      webhooks: new BotWebhookRepository(),
      pendingUpdates: botUpdates,
      updateSubscriptions,
      updateActivity: botActivity,
      sendWebhookRequest: () => Promise.reject(new Error('Unexpected webhook request')),
      runWebhookReply: () => Promise.reject(new Error('Unexpected webhook reply')),
      attemptTimeoutMilliseconds: WEBHOOK_ATTEMPT_TIMEOUT_MILLISECONDS,
      waitBeforeRetry: () => Promise.reject(new Error('Unexpected webhook retry')),
      currentUnixTimeSeconds: () => 1_700_000_000,
    }),
    botMessages: privateMessaging,
    supergroupBotMessages: supergroupMessaging,
    chatMemberships: sharedChatAdministration,
    botMessageViews,
    messagePinning: new MessagePinningService({
      accounts,
      bots,
      privateConversations,
      blockedUsers,
      sharedChats,
      privateMessages: privateMessaging,
      supergroupMessages: supergroupMessaging,
      messages,
      currentUnixTimeSeconds: () => 1_700_000_000,
    }),
    mediaFiles,
    callbackQueries,
    inlineQueries: new InlineQueryService({
      accounts,
      bots,
      sharedChats,
      privateMessages: privateMessaging,
      supergroupMessages: supergroupMessaging,
      inlineQueries: new InlineQueryRepository(),
      webMediaFiles: mediaFiles,
      events,
      currentTimeMilliseconds: () => 1_700_000_000_000,
    }),
    inlineMessages: messages,
    mediaGroups: messages,
    polls,
    botCaptions: {
      normalizeBotCaption: (caption) =>
        normalizeCaption(caption, 'bot', {
          isMentionableUser: (userId) =>
            accounts.getById(userId) !== undefined || bots.getById(userId) !== undefined,
        }),
    },
    botCommands: new BotCommandService({
      accounts,
      bots,
      privateConversations,
      supergroupMembers: sharedChats,
      botCommands: new BotCommandRepository(),
    }),
    botDescriptions: new BotDescriptionService({
      bots,
      botDescriptions: new BotDescriptionRepository(),
    }),
    defaultAdministratorRights: new BotDefaultAdministratorRightsService({
      bots,
      defaultAdministratorRights: new BotDefaultAdministratorRightsRepository(),
    }),
    menuButtons: new BotMenuButtonService({
      accounts,
      bots,
      menuButtons: new BotMenuButtonRepository(),
    }),
    chatActions: new ChatActionService({
      accounts,
      bots,
      sharedChats,
      chatActions: new ChatActionRepository(),
      currentTimeMilliseconds: () => 1_700_000_000_000,
    }),
    publicChats: sharedChatAdministration,
    getPrivateForwardName: () => undefined,
    currentUnixTimeSeconds: () => 1_700_000_000,
  });
  return {
    virtualUsers,
    sharedChats,
    sharedChatAdministration,
    supergroupMessaging,
    privateMessaging,
    botApi,
  };
}

/** A photo upload of a 4 by 3 GIF image, whose header is all the emulator reads. */
function photoUpload(): PhotoUpload {
  const content = new Uint8Array(13);
  content.set(new TextEncoder().encode('GIF89a'));
  content.set([4, 0, 3, 0], 6);
  return { type: 'photo', content, imageFormat: 'gif', width: 4, height: 3 };
}

function createBot(virtualUsers: VirtualUserService, username: string) {
  const result = virtualUsers.createBot({ first_name: 'Test Bot', username });
  if (!result.created) {
    throw new Error(`Expected bot creation to succeed, received ${result.reason}`);
  }
  return result.bot;
}

function createAccount(virtualUsers: VirtualUserService) {
  const result = virtualUsers.createAccount({ first_name: 'Ada' });
  if (!result.created) {
    throw new Error(`Expected account creation to succeed, received ${result.reason}`);
  }
  return result.account;
}
