import { AccountRepository } from '../src/repositories/account.ts';
import { BotRepository } from '../src/repositories/bot.ts';
import { FileRepository } from '../src/repositories/file.ts';
import { PollRepository } from '../src/repositories/poll.ts';
import { MessageRepository } from '../src/repositories/message.ts';
import { SharedChatRepository } from '../src/repositories/shared_chat.ts';
import { TelegramIdentityRepository } from '../src/repositories/telegram_identity.ts';
import { MessageBoxRepository } from '../src/repositories/message_box.ts';
import { BotMessageViewService } from '../src/services/bot_message_view/bot_message_view.ts';
import { VirtualUserService } from '../src/services/domain/virtual_user.ts';
import { assertEqualsInFieldOrder } from './support/field_order_assertion.ts';
import { createVirtualAccount, createVirtualBot } from './support/virtual_users.ts';

Deno.test('BotMessageViewService shows an account message in its bot private chat', () => {
  const { virtualUsers, messages, messageBoxes, botMessageViews } = createViewFixture();
  const account = createAccount(virtualUsers);
  const bot = createBot(virtualUsers);
  const message = messages.addMessage({
    chat: {
      type: 'private',
      conversation: { accountId: account.profile.id, botId: bot.profile.id },
    },
    sender: 'account',
    sentAtUnixSeconds: 1_700_000_000,
    content: {
      kind: 'text',
      text: '/start',
      entities: [{ type: 'bot_command', offset: 0, length: 6 }],
    },
  });
  messageBoxes.assignMessageId(account.profile.id, message.id);
  messageBoxes.assignMessageId(bot.profile.id, 'unrelated-message');
  messageBoxes.assignMessageId(bot.profile.id, message.id);

  const view = botMessageViews.viewPrivateMessageForBot(message);

  const expectedView = {
    message_id: 2,
    from: account.profile,
    chat: { id: account.profile.id, type: 'private', first_name: 'Ada' },
    date: 1_700_000_000,
    text: '/start',
    entities: [{ type: 'bot_command', offset: 0, length: 6 }],
  };
  assertEqualsInFieldOrder(view, expectedView, "Expected the bot's view of the message");
});

Deno.test('BotMessageViewService shows a bot message, then its edit date and keyboard, in Telegram order', () => {
  const { virtualUsers, messages, messageBoxes, botMessageViews } = createViewFixture();
  const account = createAccount(virtualUsers);
  const bot = createBot(virtualUsers);
  const sentMessage = messages.addMessage({
    chat: {
      type: 'private',
      conversation: { accountId: account.profile.id, botId: bot.profile.id },
    },
    sender: 'bot',
    sentAtUnixSeconds: 1_700_000_000,
    content: { kind: 'text', text: 'Continue?', entities: [] },
  });
  messageBoxes.assignMessageId(bot.profile.id, sentMessage.id);
  const botSender = {
    id: bot.profile.id,
    is_bot: true,
    first_name: 'Test Bot',
    username: 'test_bot',
  };
  const sentView = botMessageViews.viewPrivateMessageForBot(sentMessage);
  assertEqualsInFieldOrder(sentView, {
    message_id: 1,
    from: botSender,
    chat: { id: account.profile.id, type: 'private', first_name: 'Ada' },
    date: 1_700_000_000,
    text: 'Continue?',
  }, 'Expected the bot as sender, without entities');

  const message = messages.editMessage(sentMessage.chat, sentMessage.id, {
    inlineKeyboard: [[
      { kind: 'callback', text: 'Yes', callbackData: 'yes' },
      { kind: 'url', text: 'Docs', url: 'https://grammy.dev' },
    ]],
    contentEditedAtUnixSeconds: 1_700_000_005,
    content: {
      kind: 'text',
      text: 'Try /help',
      entities: [{ type: 'bot_command', offset: 4, length: 5 }],
    },
  });

  const view = botMessageViews.viewPrivateMessageForBot(message);

  const expectedView = {
    message_id: 1,
    from: botSender,
    chat: { id: account.profile.id, type: 'private', first_name: 'Ada' },
    date: 1_700_000_000,
    edit_date: 1_700_000_005,
    text: 'Try /help',
    entities: [{ type: 'bot_command', offset: 4, length: 5 }],
    reply_markup: {
      inline_keyboard: [[
        { text: 'Yes', callback_data: 'yes' },
        { text: 'Docs', url: 'https://grammy.dev' },
      ]],
    },
  };
  assertEqualsInFieldOrder(view, expectedView, 'Expected the edited message with its keyboard');
});

Deno.test('BotMessageViewService shows the current replied message until it is deleted', () => {
  const { virtualUsers, messages, messageBoxes, botMessageViews } = createViewFixture();
  const account = createAccount(virtualUsers);
  const bot = createBot(virtualUsers);
  const conversation = { accountId: account.profile.id, botId: bot.profile.id };
  const question = messages.addMessage({
    chat: { type: 'private', conversation },
    sender: 'bot',
    sentAtUnixSeconds: 1_700_000_000,
    content: { kind: 'text', text: 'Your name?', entities: [] },
  });
  messageBoxes.assignMessageId(bot.profile.id, question.id);
  const answer = messages.addMessage({
    chat: { type: 'private', conversation },
    sender: 'account',
    sentAtUnixSeconds: 1_700_000_001,
    replyToMessageId: question.id,
    content: { kind: 'text', text: 'Ada', entities: [] },
  });
  messageBoxes.assignMessageId(bot.profile.id, answer.id);
  const confirmation = messages.addMessage({
    chat: { type: 'private', conversation },
    sender: 'bot',
    sentAtUnixSeconds: 1_700_000_002,
    replyToMessageId: answer.id,
    isContentProtected: true,
    content: { kind: 'text', text: 'Saved', entities: [] },
  });
  messageBoxes.assignMessageId(bot.profile.id, confirmation.id);
  messages.editMessage(question.chat, question.id, {
    inlineKeyboard: undefined,
    contentEditedAtUnixSeconds: 1_700_000_003,
    content: { kind: 'text', text: 'Your first name?', entities: [] },
  });
  const botSender = {
    id: bot.profile.id,
    is_bot: true,
    first_name: 'Test Bot',
    username: 'test_bot',
  };
  const chat = { id: account.profile.id, type: 'private', first_name: 'Ada' };

  const answerView = botMessageViews.viewPrivateMessageForBot(answer);
  const confirmationView = botMessageViews.viewPrivateMessageForBot(confirmation);

  const expectedAnswerView = {
    message_id: 2,
    from: account.profile,
    chat,
    date: 1_700_000_001,
    reply_to_message: {
      message_id: 1,
      from: botSender,
      chat,
      date: 1_700_000_000,
      edit_date: 1_700_000_003,
      text: 'Your first name?',
    },
    text: 'Ada',
  };
  assertEqualsInFieldOrder(
    answerView,
    expectedAnswerView,
    'Expected the reply to show the edited question',
  );
  const expectedConfirmationView = {
    message_id: 3,
    from: botSender,
    chat,
    date: 1_700_000_002,
    reply_to_message: {
      message_id: 2,
      from: account.profile,
      chat,
      date: 1_700_000_001,
      text: 'Ada',
    },
    text: 'Saved',
    has_protected_content: true,
  };
  assertEqualsInFieldOrder(
    confirmationView,
    expectedConfirmationView,
    'Expected a protected reply without a nested reply',
  );

  messages.deleteMessage(question.id);
  const answerViewAfterDeletion = botMessageViews.viewPrivateMessageForBot(answer);
  if ('reply_to_message' in answerViewAfterDeletion) {
    throw new Error('Expected a reply to a deleted message to omit reply_to_message');
  }
});

Deno.test('BotMessageViewService shows a callback query with its message as the bot sees it', () => {
  const { virtualUsers, messages, messageBoxes, botMessageViews } = createViewFixture();
  const account = createAccount(virtualUsers);
  const bot = createBot(virtualUsers);
  const message = messages.addMessage({
    chat: {
      type: 'private',
      conversation: { accountId: account.profile.id, botId: bot.profile.id },
    },
    sender: 'bot',
    sentAtUnixSeconds: 1_700_000_000,
    inlineKeyboard: [[{ kind: 'callback', text: 'Yes', callbackData: 'yes' }]],
    content: { kind: 'text', text: 'Continue?', entities: [] },
  });
  messageBoxes.assignMessageId(bot.profile.id, message.id);

  const view = botMessageViews.viewCallbackQueryForBot({
    id: '7',
    ...message.chat.conversation,
    messageId: message.id,
    chatInstance: '-42',
    callbackData: 'yes',
    state: { status: 'awaiting_answer' },
  }, message);

  const expectedView = {
    id: '7',
    from: account.profile,
    message: botMessageViews.viewPrivateMessageForBot(message),
    chat_instance: '-42',
    data: 'yes',
  };
  assertEqualsInFieldOrder(view, expectedView, "Expected the bot's view of the callback query");
});

Deno.test('BotMessageViewService shows photos and documents in Telegram order with observer file IDs', () => {
  const { virtualUsers, messages, files, messageBoxes, botMessageViews } = createViewFixture();
  const account = createAccount(virtualUsers);
  const bot = createBot(virtualUsers);
  const document = files.addFile({
    type: 'document',
    content: new Uint8Array([1, 2, 3]),
    fileName: 'report.pdf',
    mimeType: 'application/pdf',
  });
  const photo = files.addFile({
    type: 'photo',
    content: new Uint8Array(13),
    imageFormat: 'png',
    width: 640,
    height: 480,
  });
  const documentMessage = messages.addMessage({
    chat: {
      type: 'private',
      conversation: { accountId: account.profile.id, botId: bot.profile.id },
    },
    sender: 'account',
    sentAtUnixSeconds: 1_700_000_000,
    content: { kind: 'document', fileId: document.id, caption: { text: '', entities: [] } },
  });
  const photoMessage = messages.addMessage({
    chat: {
      type: 'private',
      conversation: { accountId: account.profile.id, botId: bot.profile.id },
    },
    sender: 'bot',
    sentAtUnixSeconds: 1_700_000_001,
    content: {
      kind: 'photo',
      fileId: photo.id,
      caption: { text: 'Chart', entities: [{ type: 'bold', offset: 0, length: 5 }] },
      hasSpoiler: true,
      showsCaptionAboveMedia: true,
    },
    replyToMessageId: documentMessage.id,
    isContentProtected: true,
  });
  messageBoxes.assignMessageId(bot.profile.id, documentMessage.id);
  messageBoxes.assignMessageId(bot.profile.id, photoMessage.id);

  const view = botMessageViews.viewPrivateMessageForBot(photoMessage);

  const expectedDocument = {
    file_name: 'report.pdf',
    mime_type: 'application/pdf',
    file_id: files.getOrAssignObserverFileId(bot.profile.id, document.id),
    file_unique_id: document.uniqueId,
    file_size: 3,
  };
  const expectedView = {
    message_id: 2,
    from: { id: bot.profile.id, is_bot: true, first_name: 'Test Bot', username: 'test_bot' },
    chat: { id: account.profile.id, type: 'private', first_name: 'Ada' },
    date: 1_700_000_001,
    reply_to_message: {
      message_id: 1,
      from: account.profile,
      chat: { id: account.profile.id, type: 'private', first_name: 'Ada' },
      date: 1_700_000_000,
      document: expectedDocument,
    },
    photo: [{
      file_id: files.getOrAssignObserverFileId(bot.profile.id, photo.id),
      file_unique_id: photo.uniqueId,
      file_size: 13,
      width: 640,
      height: 480,
    }],
    caption: 'Chart',
    caption_entities: [{ type: 'bold', offset: 0, length: 5 }],
    show_caption_above_media: true,
    has_media_spoiler: true,
    has_protected_content: true,
  };
  assertEqualsInFieldOrder(view, expectedView, "Expected the bot's view of the photo");
  if (
    files.getOrAssignObserverFileId(account.profile.id, photo.id) === expectedView.photo[0].file_id
  ) {
    throw new Error('Expected another observer to know the photo by another file ID');
  }
});

Deno.test('BotMessageViewService rejects a message missing from the bot message box', () => {
  const { virtualUsers, messages, messageBoxes, botMessageViews } = createViewFixture();
  const account = createAccount(virtualUsers);
  const bot = createBot(virtualUsers);
  const message = messages.addMessage({
    chat: {
      type: 'private',
      conversation: { accountId: account.profile.id, botId: bot.profile.id },
    },
    sender: 'account',
    sentAtUnixSeconds: 1_700_000_000,
    content: { kind: 'text', text: 'Hello', entities: [] },
  });
  messageBoxes.assignMessageId(account.profile.id, message.id);

  let viewError: unknown;
  try {
    botMessageViews.viewPrivateMessageForBot(message);
  } catch (error) {
    viewError = error;
  }
  if (!(viewError instanceof Error)) {
    throw new Error('Expected viewing a message the bot has not numbered to throw');
  }
});

function createViewFixture() {
  const identities = new TelegramIdentityRepository();
  const accounts = new AccountRepository();
  const bots = new BotRepository();
  const virtualUsers = new VirtualUserService({ identities, accounts, bots });
  const messages = new MessageRepository();
  const files = new FileRepository();
  const messageBoxes = new MessageBoxRepository();
  const sharedChats = new SharedChatRepository();
  const botMessageViews = new BotMessageViewService({
    accounts,
    bots,
    sharedChats,
    messageBoxes,
    messages,
    files,
    polls: new PollRepository(),
  });
  return { virtualUsers, messages, files, messageBoxes, botMessageViews };
}

function createAccount(virtualUsers: VirtualUserService) {
  return createVirtualAccount(virtualUsers, { first_name: 'Ada' });
}

function createBot(virtualUsers: VirtualUserService) {
  return createVirtualBot(virtualUsers, { first_name: 'Test Bot', username: 'test_bot' });
}
