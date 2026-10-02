import { AccountRepository } from '../src/repositories/account.ts';
import { BotRepository } from '../src/repositories/bot.ts';
import { FileRepository } from '../src/repositories/file.ts';
import { PollRepository } from '../src/repositories/poll.ts';
import { MessageRepository } from '../src/repositories/message.ts';
import { SharedChatRepository } from '../src/repositories/shared_chat.ts';
import { TelegramIdentityRepository } from '../src/repositories/telegram_identity.ts';
import { MessageBoxRepository } from '../src/repositories/message_box.ts';
import { BotMessageViewService } from '../src/services/bot_message_view.ts';
import { VirtualUserService } from '../src/services/virtual_user.ts';

Deno.test('BotMessageViewService shows an account message in its bot private chat', () => {
  const { virtualUsers, messages, messageBoxes, botMessageViews } = createViewFixture();
  const account = createAccount(virtualUsers);
  const bot = createBot(virtualUsers);
  const message = messages.addPrivateMessage({
    conversation: { accountId: account.profile.id, botId: bot.profile.id },
    authorRole: 'account',
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
  if (JSON.stringify(view) !== JSON.stringify(expectedView)) {
    throw new Error(`Expected the bot's view of the message, received ${JSON.stringify(view)}`);
  }
});

Deno.test('BotMessageViewService shows a bot message, then its edit date and keyboard, in Telegram order', () => {
  const { virtualUsers, messages, messageBoxes, botMessageViews } = createViewFixture();
  const account = createAccount(virtualUsers);
  const bot = createBot(virtualUsers);
  const sentMessage = messages.addPrivateMessage({
    conversation: { accountId: account.profile.id, botId: bot.profile.id },
    authorRole: 'bot',
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
  if (
    JSON.stringify(sentView) !== JSON.stringify({
      message_id: 1,
      from: botSender,
      chat: { id: account.profile.id, type: 'private', first_name: 'Ada' },
      date: 1_700_000_000,
      text: 'Continue?',
    })
  ) {
    throw new Error(
      `Expected the bot as sender, without entities, received ${JSON.stringify(sentView)}`,
    );
  }

  const message = messages.editPrivateMessage(sentMessage.id, {
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
  if (JSON.stringify(view) !== JSON.stringify(expectedView)) {
    throw new Error(
      `Expected the edited message with its keyboard, received ${JSON.stringify(view)}`,
    );
  }
});

Deno.test('BotMessageViewService shows the current replied message until it is deleted', () => {
  const { virtualUsers, messages, messageBoxes, botMessageViews } = createViewFixture();
  const account = createAccount(virtualUsers);
  const bot = createBot(virtualUsers);
  const conversation = { accountId: account.profile.id, botId: bot.profile.id };
  const question = messages.addPrivateMessage({
    conversation,
    authorRole: 'bot',
    sentAtUnixSeconds: 1_700_000_000,
    content: { kind: 'text', text: 'Your name?', entities: [] },
  });
  messageBoxes.assignMessageId(bot.profile.id, question.id);
  const answer = messages.addPrivateMessage({
    conversation,
    authorRole: 'account',
    sentAtUnixSeconds: 1_700_000_001,
    replyToMessageId: question.id,
    content: { kind: 'text', text: 'Ada', entities: [] },
  });
  messageBoxes.assignMessageId(bot.profile.id, answer.id);
  const confirmation = messages.addPrivateMessage({
    conversation,
    authorRole: 'bot',
    sentAtUnixSeconds: 1_700_000_002,
    replyToMessageId: answer.id,
    isContentProtected: true,
    content: { kind: 'text', text: 'Saved', entities: [] },
  });
  messageBoxes.assignMessageId(bot.profile.id, confirmation.id);
  messages.editPrivateMessage(question.id, {
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
  if (JSON.stringify(answerView) !== JSON.stringify(expectedAnswerView)) {
    throw new Error(
      `Expected the reply to show the edited question, received ${JSON.stringify(answerView)}`,
    );
  }
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
  if (JSON.stringify(confirmationView) !== JSON.stringify(expectedConfirmationView)) {
    throw new Error(
      `Expected a protected reply without a nested reply, received ${
        JSON.stringify(confirmationView)
      }`,
    );
  }

  messages.deletePrivateMessage(question.id);
  const answerViewAfterDeletion = botMessageViews.viewPrivateMessageForBot(answer);
  if ('reply_to_message' in answerViewAfterDeletion) {
    throw new Error('Expected a reply to a deleted message to omit reply_to_message');
  }
});

Deno.test('BotMessageViewService shows a callback query with its message as the bot sees it', () => {
  const { virtualUsers, messages, messageBoxes, botMessageViews } = createViewFixture();
  const account = createAccount(virtualUsers);
  const bot = createBot(virtualUsers);
  const message = messages.addPrivateMessage({
    conversation: { accountId: account.profile.id, botId: bot.profile.id },
    authorRole: 'bot',
    sentAtUnixSeconds: 1_700_000_000,
    inlineKeyboard: [[{ kind: 'callback', text: 'Yes', callbackData: 'yes' }]],
    content: { kind: 'text', text: 'Continue?', entities: [] },
  });
  messageBoxes.assignMessageId(bot.profile.id, message.id);

  const view = botMessageViews.viewCallbackQueryForBot({
    id: '7',
    ...message.conversation,
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
  if (JSON.stringify(view) !== JSON.stringify(expectedView)) {
    throw new Error(
      `Expected the bot's view of the callback query, received ${JSON.stringify(view)}`,
    );
  }
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
  const documentMessage = messages.addPrivateMessage({
    conversation: { accountId: account.profile.id, botId: bot.profile.id },
    authorRole: 'account',
    sentAtUnixSeconds: 1_700_000_000,
    content: { kind: 'document', fileId: document.id, caption: { text: '', entities: [] } },
  });
  const photoMessage = messages.addPrivateMessage({
    conversation: { accountId: account.profile.id, botId: bot.profile.id },
    authorRole: 'bot',
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
  if (JSON.stringify(view) !== JSON.stringify(expectedView)) {
    throw new Error(`Expected the bot's view of the photo, received ${JSON.stringify(view)}`);
  }
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
  const message = messages.addPrivateMessage({
    conversation: { accountId: account.profile.id, botId: bot.profile.id },
    authorRole: 'account',
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
  const result = virtualUsers.createAccount({ first_name: 'Ada' });
  if (!result.created) {
    throw new Error(`Expected account creation to succeed, received ${result.reason}`);
  }
  return result.account;
}

function createBot(virtualUsers: VirtualUserService) {
  const result = virtualUsers.createBot({ first_name: 'Test Bot', username: 'test_bot' });
  if (!result.created) {
    throw new Error(`Expected bot creation to succeed, received ${result.reason}`);
  }
  return result.bot;
}
