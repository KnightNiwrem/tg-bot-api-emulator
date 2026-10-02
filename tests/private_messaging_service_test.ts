import { AccountRepository } from '../src/repositories/account.ts';
import { BlockedUserRepository } from '../src/repositories/blocked_user.ts';
import { BotRepository } from '../src/repositories/bot.ts';
import { BotUpdateRepository } from '../src/repositories/bot_update.ts';
import { BotUpdateSubscriptionRepository } from '../src/repositories/bot_update_subscription.ts';
import { FileRepository } from '../src/repositories/file.ts';
import { MessageRepository } from '../src/repositories/message.ts';
import { PrivateConversationRepository } from '../src/repositories/private_conversation.ts';
import { SharedChatRepository } from '../src/repositories/shared_chat.ts';
import { TelegramIdentityRepository } from '../src/repositories/telegram_identity.ts';
import { MessageBoxRepository } from '../src/repositories/message_box.ts';
import { BotMessageViewService } from '../src/services/bot_message_view.ts';
import { BotUpdateDeliveryService } from '../src/services/bot_update_delivery.ts';
import {
  type BotMessageReplyTarget,
  type DeleteMessagesByBotFailureReason,
  type EditBotMessageTextFailureReason,
  PrivateMessagingService,
  type SendBotMessageResult,
} from '../src/services/private_messaging.ts';
import type { MediaContent } from '../src/services/message_content.ts';
import { VirtualUserService } from '../src/services/virtual_user.ts';
import type { BotApiMessage, BotApiUpdate } from '../src/types/bot_api.ts';
import type { ChatDomainEvent } from '../src/types/chat_domain_event.ts';
import type { InlineKeyboard } from '../src/types/inline_keyboard.ts';
import type { BotMessageReplyMarkup, ReplyInterfaceMarkup } from '../src/types/reply_interface.ts';
import type { DocumentUpload, FileUpload, PhotoUpload } from '../src/types/stored_file.ts';
import {
  getContentText,
  MAX_CAPTION_LENGTH,
  MAX_TEXT_MESSAGE_LENGTH,
  type PrivateMessage,
  type TextEntity,
} from '../src/types/virtual_message.ts';
import type { VirtualBot } from '../src/types/virtual_bot.ts';

Deno.test('PrivateMessagingService activates a private conversation only for known participants', () => {
  const { virtualUsers, privateConversations, privateMessaging } = createPrivateMessagingFixture();
  const account = createAccount(virtualUsers, 'Ada');
  const bot = createBot(virtualUsers, 'First Bot', 'first_bot');

  const missingAccount = privateMessaging.activatePrivateConversation({
    accountId: 999,
    botId: bot.profile.id,
  });
  const missingBot = privateMessaging.activatePrivateConversation({
    accountId: account.profile.id,
    botId: 999,
  });
  if (
    missingAccount.activated || missingAccount.reason !== 'account_not_found' ||
    missingBot.activated || missingBot.reason !== 'bot_not_found'
  ) {
    throw new Error('Expected unknown participants to be rejected');
  }
  if (
    privateConversations.getPrivateConversation({ accountId: 999, botId: bot.profile.id }) !==
      undefined ||
    privateConversations.getPrivateConversation({ accountId: account.profile.id, botId: 999 }) !==
      undefined
  ) {
    throw new Error('Expected rejected activations not to create conversations');
  }

  const activation = privateMessaging.activatePrivateConversation({
    accountId: account.profile.id,
    botId: bot.profile.id,
  });
  if (!activation.activated) {
    throw new Error(`Expected activation to succeed, received ${activation.reason}`);
  }
  if (
    privateConversations.getPrivateConversation({
      accountId: account.profile.id,
      botId: bot.profile.id,
    }) !== activation.conversation
  ) {
    throw new Error('Expected activation to store the canonical private conversation');
  }
});

Deno.test('PrivateMessagingService sends, stores, and publishes private account messages', () => {
  const {
    virtualUsers,
    privateConversations,
    messages,
    botUpdates,
    publishedEvents,
    privateMessaging,
  } = createPrivateMessagingFixture();
  const account = createAccount(virtualUsers, 'Ada');
  const bot = createBot(virtualUsers, 'Test Bot', 'test_bot');

  const firstResult = privateMessaging.sendAccountMessage({
    fromAccountId: account.profile.id,
    to: { type: 'private', botId: bot.profile.id },
    content: { kind: 'text', text: 'Hello' },
  });
  if (!firstResult.sent) {
    throw new Error(`Expected message send to succeed, received ${firstResult.reason}`);
  }
  const secondResult = privateMessaging.sendAccountMessage({
    fromAccountId: account.profile.id,
    to: { type: 'private', botId: bot.profile.id },
    content: { kind: 'text', text: 'Again' },
  });
  if (!secondResult.sent) {
    throw new Error(`Expected message send to succeed, received ${secondResult.reason}`);
  }

  if (
    privateConversations.getPrivateConversation({
      accountId: account.profile.id,
      botId: bot.profile.id,
    }) ===
      undefined
  ) {
    throw new Error('Expected the first message to activate the private conversation');
  }
  const storedMessages = messages.getPrivateConversationMessages({
    accountId: account.profile.id,
    botId: bot.profile.id,
  });
  if (
    storedMessages.length !== 2 ||
    storedMessages[0] !== firstResult.message ||
    storedMessages[1] !== secondResult.message
  ) {
    throw new Error('Expected the sent canonical messages to be retained in conversation history');
  }
  if (
    getContentText(firstResult.message.content).text !== 'Hello' ||
    firstResult.message.authorRole !== 'account' ||
    firstResult.message.sentAtUnixSeconds !== 1_700_000_000 ||
    firstResult.message.conversation.accountId !== account.profile.id ||
    firstResult.message.conversation.botId !== bot.profile.id
  ) {
    throw new Error('Expected the result to carry the canonical account message');
  }

  const history = privateMessaging.getPrivateMessageHistory({
    accountId: account.profile.id,
    botId: bot.profile.id,
  });
  if (
    !history.found ||
    history.messages.map((message) => message.id).join() !==
      [firstResult.message.id, secondResult.message.id].join()
  ) {
    throw new Error('Expected history to return the stored messages in order');
  }
  if (
    publishedEvents.length !== 2 ||
    publishedEvents.some((event, index) =>
      event.type !== 'message_created' || event.message !== storedMessages[index]
    )
  ) {
    throw new Error('Expected each sent message to publish a message_created event');
  }

  const updates = botUpdates.confirmAndReadPendingUpdates(bot.profile.id, { limit: 100 });
  if (
    updates.length !== 2 ||
    textContentOf(messageFromUpdate(updates[0]))?.text !== 'Hello' ||
    textContentOf(messageFromUpdate(updates[1]))?.text !== 'Again'
  ) {
    throw new Error('Expected each sent message to enqueue one update for the target bot');
  }
});

Deno.test("PrivateMessagingService numbers private messages in each user's message box", () => {
  const { virtualUsers, messageBoxes, botUpdates, privateMessaging } =
    createPrivateMessagingFixture();
  const account = createAccount(virtualUsers, 'Ada');
  const otherAccount = createAccount(virtualUsers, 'Grace');
  const firstBot = createBot(virtualUsers, 'First Bot', 'first_bot');
  const secondBot = createBot(virtualUsers, 'Second Bot', 'second_bot');

  const sentMessages = [
    sendPrivateText(privateMessaging, account.profile.id, firstBot),
    sendPrivateText(privateMessaging, account.profile.id, secondBot),
    sendPrivateText(privateMessaging, otherAccount.profile.id, firstBot),
    sendPrivateText(privateMessaging, account.profile.id, firstBot),
  ];
  const messageIdsIn = (ownerId: number) =>
    sentMessages.map((message) => messageBoxes.getMessageId(ownerId, message.id) ?? '-').join();

  // Each user numbers the messages of all its private chats in one sequence.
  if (
    messageIdsIn(firstBot.profile.id) !== '1,-,2,3' ||
    messageIdsIn(secondBot.profile.id) !== '-,1,-,-' ||
    messageIdsIn(account.profile.id) !== '1,2,-,3'
  ) {
    throw new Error('Expected each user to number messages from its own message box');
  }
  const secondBotUpdates = botUpdates.confirmAndReadPendingUpdates(secondBot.profile.id, {
    limit: 100,
  });
  if (secondBotUpdates.length !== 1 || messageFromUpdate(secondBotUpdates[0])?.message_id !== 1) {
    throw new Error("Expected the bot's update to carry its own message ID");
  }
});

Deno.test('PrivateMessagingService validates private messages before changing state', () => {
  const { virtualUsers, privateConversations, messages, botUpdates, privateMessaging } =
    createPrivateMessagingFixture();
  const account = createAccount(virtualUsers, 'Ada');
  const bot = createBot(virtualUsers, 'Test Bot', 'test_bot');

  const failures = [
    privateMessaging.sendAccountMessage({
      fromAccountId: 999,
      to: { type: 'private', botId: bot.profile.id },
      content: { kind: 'text', text: 'Hello' },
    }),
    privateMessaging.sendAccountMessage({
      fromAccountId: account.profile.id,
      to: { type: 'private', botId: 999 },
      content: { kind: 'text', text: 'Hello' },
    }),
    privateMessaging.sendAccountMessage({
      fromAccountId: account.profile.id,
      to: { type: 'private', botId: bot.profile.id },
      content: { kind: 'text', text: '' },
    }),
    privateMessaging.sendAccountMessage({
      fromAccountId: account.profile.id,
      to: { type: 'private', botId: bot.profile.id },
      content: { kind: 'text', text: 'x'.repeat(MAX_TEXT_MESSAGE_LENGTH + 1) },
    }),
  ];
  const expectedReasons = [
    'account_not_found',
    'bot_not_found',
    'message_text_empty',
    'message_text_too_long',
  ];
  failures.forEach((result, index) => {
    if (result.sent || result.reason !== expectedReasons[index]) {
      throw new Error(`Expected message send to fail with ${expectedReasons[index]}`);
    }
  });

  if (
    privateConversations.getPrivateConversation({
        accountId: account.profile.id,
        botId: bot.profile.id,
      }) !==
      undefined ||
    messages.getPrivateConversationMessages({
        accountId: account.profile.id,
        botId: bot.profile.id,
      }).length !== 0 ||
    botUpdates.confirmAndReadPendingUpdates(bot.profile.id, { limit: 100 }).length !== 0
  ) {
    throw new Error('Expected rejected messages not to change conversation state');
  }
});

Deno.test('PrivateMessagingService stores a bot reply in the private conversation', () => {
  const {
    virtualUsers,
    messages,
    messageBoxes,
    botUpdates,
    publishedEvents,
    privateMessaging,
  } = createPrivateMessagingFixture();
  const account = createAccount(virtualUsers, 'Ada');
  const bot = createBot(virtualUsers, 'Test Bot', 'test_bot');
  const incomingMessage = sendPrivateText(privateMessaging, account.profile.id, bot);

  const replyResult = privateMessaging.sendBotMessage({
    fromBotId: bot.profile.id,
    to: { type: 'private', accountId: account.profile.id },
    content: { kind: 'text', text: 'See /help' },
  });
  if (!replyResult.sent) {
    throw new Error(`Expected the bot reply to succeed, received ${replyResult.reason}`);
  }

  const reply = replyResult.message;
  if (
    reply.authorRole !== 'bot' ||
    reply.conversation.accountId !== account.profile.id ||
    reply.conversation.botId !== bot.profile.id ||
    reply.sentAtUnixSeconds !== 1_700_000_000 ||
    JSON.stringify(getContentText(reply.content).entities) !==
      JSON.stringify([{ type: 'bot_command', offset: 4, length: 5 }])
  ) {
    throw new Error("Expected the result to carry the bot's canonical reply with its entities");
  }
  if (
    messageBoxes.getMessageId(account.profile.id, reply.id) !== 2 ||
    messageBoxes.getMessageId(bot.profile.id, reply.id) !== 2
  ) {
    throw new Error("Expected the reply to be numbered in both participants' message boxes");
  }
  const storedMessages = messages.getPrivateConversationMessages({
    accountId: account.profile.id,
    botId: bot.profile.id,
  });
  const history = privateMessaging.getPrivateMessageHistory({
    accountId: account.profile.id,
    botId: bot.profile.id,
  });
  if (
    storedMessages.length !== 2 ||
    storedMessages[0] !== incomingMessage ||
    storedMessages[1] !== reply ||
    !history.found ||
    history.messages.map((message) => message.id).join() !==
      [incomingMessage.id, reply.id].join()
  ) {
    throw new Error('Expected history to hold the incoming message and then the reply');
  }
  if (
    publishedEvents.length !== 2 ||
    JSON.stringify(publishedEvents[1]) !==
      JSON.stringify({ type: 'message_created', message: reply }) ||
    botUpdates.confirmAndReadPendingUpdates(bot.profile.id, { limit: 100 }).length !== 1
  ) {
    throw new Error('Expected the reply to be published without becoming an update for its bot');
  }
});

Deno.test('PrivateMessagingService validates bot messages in Telegram order before changing state', () => {
  const { virtualUsers, publishedEvents, privateMessaging } = createPrivateMessagingFixture();
  const account = createAccount(virtualUsers, 'Ada');
  const strangerAccount = createAccount(virtualUsers, 'Grace');
  const bot = createBot(virtualUsers, 'Test Bot', 'test_bot');
  privateMessaging.activatePrivateConversation({
    accountId: account.profile.id,
    botId: bot.profile.id,
  });
  const tooLongText = 'x'.repeat(MAX_TEXT_MESSAGE_LENGTH + 1);
  // Each case also breaks every later rule, so only the earliest check can explain its failure.
  const cases: {
    fromBotId: number;
    accountId: number;
    text: string;
    replyTo?: BotMessageReplyTarget;
    expectedReason: Extract<SendBotMessageResult, { readonly sent: false }>['reason'];
  }[] = [
    { fromBotId: 999, accountId: 999, text: '', expectedReason: 'bot_not_found' },
    { fromBotId: bot.profile.id, accountId: 999, text: '', expectedReason: 'message_text_empty' },
    {
      fromBotId: bot.profile.id,
      accountId: 999,
      text: tooLongText,
      expectedReason: 'account_not_found',
    },
    {
      fromBotId: bot.profile.id,
      accountId: strangerAccount.profile.id,
      text: tooLongText,
      replyTo: { botMessageId: 1, allowSendingWithoutReply: false },
      expectedReason: 'conversation_not_started',
    },
    {
      fromBotId: bot.profile.id,
      accountId: account.profile.id,
      text: tooLongText,
      replyTo: { botMessageId: 1, allowSendingWithoutReply: false },
      expectedReason: 'reply_message_not_found',
    },
    {
      fromBotId: bot.profile.id,
      accountId: account.profile.id,
      text: tooLongText,
      expectedReason: 'message_text_too_long',
    },
  ];

  for (const { fromBotId, accountId, text, replyTo, expectedReason } of cases) {
    const result = privateMessaging.sendBotMessage({
      fromBotId,
      to: { type: 'private', accountId },
      replyTo,
      content: { kind: 'text', text },
    });
    if (result.sent || result.reason !== expectedReason) {
      throw new Error(`Expected the bot message to fail with ${expectedReason}`);
    }
  }
  if (publishedEvents.length !== 0) {
    throw new Error('Expected rejected bot messages not to store or publish anything');
  }
});

Deno.test('PrivateMessagingService stores replies only to messages of the same chat', () => {
  const { virtualUsers, messages, publishedEvents, privateMessaging } =
    createPrivateMessagingFixture();
  const account = createAccount(virtualUsers, 'Ada');
  const otherAccount = createAccount(virtualUsers, 'Grace');
  const bot = createBot(virtualUsers, 'Test Bot', 'test_bot');
  const otherChatMessage = sendPrivateText(privateMessaging, otherAccount.profile.id, bot);
  const question = sendPrivateText(privateMessaging, account.profile.id, bot);
  const otherChatMessageId = 1;
  const questionId = 2;

  const botReply = privateMessaging.sendBotMessage({
    fromBotId: bot.profile.id,
    to: { type: 'private', accountId: account.profile.id },
    replyTo: { botMessageId: questionId, allowSendingWithoutReply: false },
    isContentProtected: true,
    content: { kind: 'text', text: 'Hi' },
  });
  const accountReply = privateMessaging.sendAccountMessage({
    fromAccountId: account.profile.id,
    to: { type: 'private', botId: bot.profile.id },
    replyToBotMessageId: 3,
    content: { kind: 'text', text: 'Thanks' },
  });
  if (
    !botReply.sent || botReply.message.replyToMessageId !== question.id ||
    !botReply.message.isContentProtected ||
    !accountReply.sent || accountReply.message.replyToMessageId !== botReply.message.id ||
    accountReply.message.isContentProtected
  ) {
    throw new Error('Expected both participants to reply to messages of their chat');
  }

  const eventCountBeforeRejections = publishedEvents.length;
  const botReplyToOtherChat = privateMessaging.sendBotMessage({
    fromBotId: bot.profile.id,
    to: { type: 'private', accountId: account.profile.id },
    replyTo: { botMessageId: otherChatMessageId, allowSendingWithoutReply: false },
    content: { kind: 'text', text: 'Hi' },
  });
  const accountReplyToMissingMessage = privateMessaging.sendAccountMessage({
    fromAccountId: account.profile.id,
    to: { type: 'private', botId: bot.profile.id },
    replyToBotMessageId: 99,
    content: { kind: 'text', text: 'Thanks' },
  });
  if (
    botReplyToOtherChat.sent || botReplyToOtherChat.reason !== 'reply_message_not_found' ||
    accountReplyToMissingMessage.sent ||
    accountReplyToMissingMessage.reason !== 'reply_message_not_found' ||
    publishedEvents.length !== eventCountBeforeRejections
  ) {
    throw new Error('Expected replies to messages outside the chat to fail without a message');
  }

  privateMessaging.deleteMessagesByBot({
    fromBotId: bot.profile.id,
    chat: { type: 'private', accountId: account.profile.id },
    botMessageIds: [questionId],
  });
  const replyToDeletedMessage = privateMessaging.sendBotMessage({
    fromBotId: bot.profile.id,
    to: { type: 'private', accountId: account.profile.id },
    replyTo: { botMessageId: questionId, allowSendingWithoutReply: true },
    content: { kind: 'text', text: 'Still there?' },
  });
  if (!replyToDeletedMessage.sent || replyToDeletedMessage.message.replyToMessageId !== undefined) {
    throw new Error(
      'Expected allowSendingWithoutReply to send a reply to a deleted message as none',
    );
  }
  if (messages.getPrivateMessage(otherChatMessage.id) !== otherChatMessage) {
    throw new Error("Expected the other chat's message to be unaffected");
  }
});

Deno.test('PrivateMessagingService shows the reply interface the latest bot message set', () => {
  const { virtualUsers, messageBoxes, privateMessaging } = createPrivateMessagingFixture();
  const account = createAccount(virtualUsers, 'Ada');
  const bot = createBot(virtualUsers, 'Test Bot', 'test_bot');
  const chat = { accountId: account.profile.id, botId: bot.profile.id };
  sendPrivateText(privateMessaging, account.profile.id, bot);
  const sendWithReplyInterfaceMarkup = (replyInterfaceMarkup: ReplyInterfaceMarkup) => {
    const result = privateMessaging.sendBotMessage({
      fromBotId: bot.profile.id,
      to: { type: 'private', accountId: account.profile.id },
      replyInterfaceMarkup,
      content: { kind: 'text', text: 'Choose' },
    });
    if (!result.sent) {
      throw new Error(`Expected the bot message to be sent, received ${result.reason}`);
    }
    return result.message;
  };
  const shownReplyInterface = () => {
    const result = privateMessaging.getPrivateChatReplyInterface(chat);
    if (!result.found) {
      throw new Error(`Expected the chat's reply interface, received ${result.reason}`);
    }
    return result.shownReplyInterface;
  };
  const pressButton = (text: string) =>
    privateMessaging.pressReplyKeyboardButton({
      fromAccountId: account.profile.id,
      chat: { type: 'private', botId: bot.profile.id },
      text,
    });

  const keyboardMessage = sendWithReplyInterfaceMarkup(COLOR_KEYBOARD);
  sendBotMessage(privateMessaging, account.profile.id, bot, YES_NO_KEYBOARD);
  if (
    shownReplyInterface()?.message.id !== keyboardMessage.id ||
    JSON.stringify(shownReplyInterface()?.replyInterface) !== JSON.stringify(COLOR_KEYBOARD)
  ) {
    throw new Error('Expected the keyboard to stay shown after a message with an inline keyboard');
  }
  const press = pressButton('Red');
  const pressOfMissingButton = pressButton('Blue');
  if (
    !press.sent || press.message.authorRole !== 'account' ||
    getContentText(press.message.content).text !== 'Red' ||
    pressOfMissingButton.sent || pressOfMissingButton.reason !== 'reply_keyboard_button_not_found'
  ) {
    throw new Error("Expected only the keyboard's buttons to send their text");
  }
  if (!pressButton('Green').sent || shownReplyInterface()?.message.id !== keyboardMessage.id) {
    throw new Error('Expected a one-time keyboard to stay available after it is used');
  }

  const forcedReplyMessage = sendWithReplyInterfaceMarkup({
    kind: 'forced_reply',
    inputFieldPlaceholder: 'Your name',
    isSelective: false,
  });
  if (shownReplyInterface()?.message.id !== forcedReplyMessage.id || pressButton('Red').sent) {
    throw new Error('Expected a forced reply to replace the keyboard');
  }
  sendWithReplyInterfaceMarkup(COLOR_KEYBOARD);
  sendWithReplyInterfaceMarkup({ kind: 'reply_keyboard_removal', isSelective: false });
  if (shownReplyInterface() !== undefined) {
    throw new Error('Expected a removal to clear the shown keyboard');
  }

  const replacedKeyboardMessage = sendWithReplyInterfaceMarkup(COLOR_KEYBOARD);
  privateMessaging.deleteMessagesByBot({
    fromBotId: bot.profile.id,
    chat: { type: 'private', accountId: account.profile.id },
    botMessageIds: [expectBotMessageId(messageBoxes, bot, replacedKeyboardMessage.id)],
  });
  if (shownReplyInterface() !== undefined) {
    throw new Error("Expected deleting the keyboard's message to clear it");
  }

  const unknownAccount = privateMessaging.getPrivateChatReplyInterface({
    accountId: 999,
    botId: bot.profile.id,
  });
  const pressForUnknownBot = privateMessaging.pressReplyKeyboardButton({
    fromAccountId: account.profile.id,
    chat: { type: 'private', botId: 999 },
    text: 'Red',
  });
  if (
    unknownAccount.found || unknownAccount.reason !== 'account_not_found' ||
    pressForUnknownBot.sent || pressForUnknownBot.reason !== 'bot_not_found'
  ) {
    throw new Error('Expected unknown participants to be reported');
  }
});

Deno.test('PrivateMessagingService stores an inline keyboard whose callback data fits 64 bytes', () => {
  const { virtualUsers, messages, publishedEvents, privateMessaging } =
    createPrivateMessagingFixture();
  const account = createAccount(virtualUsers, 'Ada');
  const bot = createBot(virtualUsers, 'Test Bot', 'test_bot');
  sendPrivateText(privateMessaging, account.profile.id, bot);
  const send = (inlineKeyboard: InlineKeyboard) =>
    privateMessaging.sendBotMessage({
      fromBotId: bot.profile.id,
      to: { type: 'private', accountId: account.profile.id },
      inlineKeyboard,
      content: { kind: 'text', text: 'Choose' },
    });
  // 32 two-byte characters fill the 64-byte callback data limit exactly.
  const inlineKeyboard: InlineKeyboard = [
    [{ kind: 'callback', text: 'Full', callbackData: 'é'.repeat(32) }],
    [{ kind: 'url', text: 'Docs', url: 'https://grammy.dev' }],
  ];

  const result = send(inlineKeyboard);
  if (!result.sent) {
    throw new Error(`Expected the bot message to be sent, received ${result.reason}`);
  }
  if (
    JSON.stringify(result.message.inlineKeyboard) !== JSON.stringify(inlineKeyboard) ||
    messages.getPrivateMessage(result.message.id) !== result.message
  ) {
    throw new Error('Expected the stored bot message to carry its inline keyboard');
  }
  const oversized = send([[{ kind: 'callback', text: 'Too long', callbackData: 'é'.repeat(33) }]]);
  if (oversized.sent || oversized.reason !== 'callback_data_invalid') {
    throw new Error('Expected 66 bytes of callback data to be rejected');
  }
  if (publishedEvents.length !== 2) {
    throw new Error('Expected the rejected bot message not to be stored or published');
  }
});

Deno.test('PrivateMessagingService edits the text and keyboard of a bot message', () => {
  const { virtualUsers, messageBoxes, publishedEvents, privateMessaging, advanceClockSeconds } =
    createPrivateMessagingFixture();
  const account = createAccount(virtualUsers, 'Ada');
  const bot = createBot(virtualUsers, 'Test Bot', 'test_bot');
  sendPrivateText(privateMessaging, account.profile.id, bot);
  const botMessage = sendBotMessage(privateMessaging, account.profile.id, bot, YES_NO_KEYBOARD);
  const botMessageId = expectBotMessageId(messageBoxes, bot, botMessage.id);
  advanceClockSeconds(5);

  const textEdit = privateMessaging.editBotMessageText({
    fromBotId: bot.profile.id,
    chat: { type: 'private', accountId: account.profile.id },
    botMessageId,
    content: { kind: 'text', text: 'Chosen: /yes' },
  });
  if (!textEdit.edited) {
    throw new Error(`Expected the text edit to succeed, received ${textEdit.reason}`);
  }
  if (
    textEdit.message.id !== botMessage.id ||
    textEdit.message.sentAtUnixSeconds !== 1_700_000_000 ||
    textEdit.message.contentEditedAtUnixSeconds !== 1_700_000_005 ||
    getContentText(textEdit.message.content).text !== 'Chosen: /yes' ||
    JSON.stringify(getContentText(textEdit.message.content).entities) !==
      JSON.stringify([{ type: 'bot_command', offset: 8, length: 4 }]) ||
    textEdit.message.inlineKeyboard !== undefined
  ) {
    throw new Error('Expected a dated text edit that recomputes entities and drops the keyboard');
  }
  advanceClockSeconds(5);

  const keyboardEdit = privateMessaging.editBotMessageInlineKeyboard({
    fromBotId: bot.profile.id,
    chat: { type: 'private', accountId: account.profile.id },
    botMessageId,
    inlineKeyboard: YES_NO_KEYBOARD,
  });
  if (!keyboardEdit.edited) {
    throw new Error(`Expected the keyboard edit to succeed, received ${keyboardEdit.reason}`);
  }
  if (
    getContentText(keyboardEdit.message.content).text !== 'Chosen: /yes' ||
    keyboardEdit.message.contentEditedAtUnixSeconds !== 1_700_000_005 ||
    JSON.stringify(keyboardEdit.message.inlineKeyboard) !== JSON.stringify(YES_NO_KEYBOARD)
  ) {
    throw new Error('Expected a keyboard edit to keep the text and its edit date');
  }

  const sameTextEdit = privateMessaging.editBotMessageText({
    fromBotId: bot.profile.id,
    chat: { type: 'private', accountId: account.profile.id },
    botMessageId,
    content: { kind: 'text', text: 'Chosen: /yes' },
  });
  if (
    !sameTextEdit.edited ||
    sameTextEdit.message.contentEditedAtUnixSeconds !== 1_700_000_005 ||
    sameTextEdit.message.inlineKeyboard !== undefined
  ) {
    throw new Error('Expected an unchanged text to keep its edit date while the keyboard goes');
  }
  if (
    JSON.stringify(publishedEvents.slice(2).map(({ type }) => type)) !==
      JSON.stringify(['message_edited', 'message_edited', 'message_edited'])
  ) {
    throw new Error('Expected each edit to publish the edited message');
  }
});

Deno.test('PrivateMessagingService validates bot message edits in Telegram order', () => {
  const { virtualUsers, messageBoxes, messages, privateMessaging } =
    createPrivateMessagingFixture();
  const account = createAccount(virtualUsers, 'Ada');
  const strangerAccount = createAccount(virtualUsers, 'Grace');
  const otherAccount = createAccount(virtualUsers, 'Joan');
  const bot = createBot(virtualUsers, 'Test Bot', 'test_bot');
  const accountMessage = sendPrivateText(privateMessaging, account.profile.id, bot);
  const botMessage = sendBotMessage(privateMessaging, account.profile.id, bot, YES_NO_KEYBOARD);
  const otherChatMessage = sendPrivateText(privateMessaging, otherAccount.profile.id, bot);
  const accountMessageId = expectBotMessageId(messageBoxes, bot, accountMessage.id);
  const botMessageId = expectBotMessageId(messageBoxes, bot, botMessage.id);
  const otherChatMessageId = expectBotMessageId(messageBoxes, bot, otherChatMessage.id);
  const tooLongText = 'x'.repeat(MAX_TEXT_MESSAGE_LENGTH + 1);
  const invalidKeyboard: InlineKeyboard = [
    [{ kind: 'callback', text: 'Too long', callbackData: 'x'.repeat(65) }],
  ];
  // Each case also breaks every later rule, so only the earliest check can explain its failure.
  const cases: {
    fromBotId: number;
    accountId: number;
    botMessageId: number;
    text: string;
    inlineKeyboard?: InlineKeyboard;
    expectedReason: EditBotMessageTextFailureReason;
  }[] = [
    {
      fromBotId: 999,
      accountId: 999,
      botMessageId: 999,
      text: '',
      expectedReason: 'bot_not_found',
    },
    {
      fromBotId: bot.profile.id,
      accountId: 999,
      botMessageId: 999,
      text: '',
      expectedReason: 'message_text_empty',
    },
    {
      fromBotId: bot.profile.id,
      accountId: 999,
      botMessageId: 999,
      text: tooLongText,
      expectedReason: 'account_not_found',
    },
    {
      fromBotId: bot.profile.id,
      accountId: strangerAccount.profile.id,
      botMessageId,
      text: tooLongText,
      expectedReason: 'conversation_not_started',
    },
    {
      fromBotId: bot.profile.id,
      accountId: account.profile.id,
      botMessageId: 999,
      text: tooLongText,
      expectedReason: 'message_not_found',
    },
    {
      fromBotId: bot.profile.id,
      accountId: account.profile.id,
      botMessageId: otherChatMessageId,
      text: tooLongText,
      expectedReason: 'message_not_found',
    },
    {
      fromBotId: bot.profile.id,
      accountId: account.profile.id,
      botMessageId: accountMessageId,
      text: tooLongText,
      expectedReason: 'message_not_editable',
    },
    {
      fromBotId: bot.profile.id,
      accountId: account.profile.id,
      botMessageId,
      text: tooLongText,
      inlineKeyboard: invalidKeyboard,
      expectedReason: 'message_text_too_long',
    },
    {
      fromBotId: bot.profile.id,
      accountId: account.profile.id,
      botMessageId,
      text: getContentText(botMessage.content).text,
      inlineKeyboard: invalidKeyboard,
      expectedReason: 'callback_data_invalid',
    },
    {
      fromBotId: bot.profile.id,
      accountId: account.profile.id,
      botMessageId,
      text: getContentText(botMessage.content).text,
      inlineKeyboard: YES_NO_KEYBOARD,
      expectedReason: 'message_not_modified',
    },
  ];

  for (
    const { fromBotId, accountId, botMessageId, text, inlineKeyboard, expectedReason } of cases
  ) {
    const result = privateMessaging.editBotMessageText({
      fromBotId,
      chat: { type: 'private', accountId },
      botMessageId,
      content: { kind: 'text', text },
      inlineKeyboard,
    });
    if (result.edited || result.reason !== expectedReason) {
      throw new Error(`Expected the edit to fail with ${expectedReason}`);
    }
  }
  const keyboardEdit = privateMessaging.editBotMessageInlineKeyboard({
    fromBotId: bot.profile.id,
    chat: { type: 'private', accountId: account.profile.id },
    botMessageId,
    inlineKeyboard: YES_NO_KEYBOARD,
  });
  if (keyboardEdit.edited || keyboardEdit.reason !== 'message_not_modified') {
    throw new Error('Expected an identical keyboard edit to be rejected as not modified');
  }
  if (messages.getPrivateMessage(botMessage.id) !== botMessage) {
    throw new Error('Expected rejected edits to leave the message unchanged');
  }
});

Deno.test('PrivateMessagingService refuses edits of messages with reply markup other than an inline keyboard', () => {
  const { virtualUsers, messageBoxes, messages, publishedEvents, privateMessaging } =
    createPrivateMessagingFixture();
  const account = createAccount(virtualUsers, 'Ada');
  const bot = createBot(virtualUsers, 'Test Bot', 'test_bot');
  sendPrivateText(privateMessaging, account.profile.id, bot);
  const chat = { type: 'private', accountId: account.profile.id } as const;
  const sendBotText = (markup: BotMessageReplyMarkup) =>
    privateMessaging.sendBotMessage({
      fromBotId: bot.profile.id,
      to: chat,
      ...markup,
      content: { kind: 'text', text: 'Choose' },
    });
  const sendBotPhoto = (markup: BotMessageReplyMarkup) =>
    privateMessaging.sendBotMessage({
      fromBotId: bot.profile.id,
      to: chat,
      ...markup,
      content: {
        kind: 'photo',
        photo: { kind: 'upload', upload: photoUpload() },
        caption: 'Choose',
        hasSpoiler: false,
        showsCaptionAboveMedia: false,
      },
    });
  const editEveryWay = (botMessageId: number) => [
    privateMessaging.editBotMessageText({
      fromBotId: bot.profile.id,
      chat,
      botMessageId,
      content: { kind: 'text', text: 'Chosen' },
    }),
    privateMessaging.editBotMessageCaption({
      fromBotId: bot.profile.id,
      chat,
      botMessageId,
      caption: 'Chosen',
      showsCaptionAboveMedia: false,
    }),
    privateMessaging.editBotMessageInlineKeyboard({
      fromBotId: bot.profile.id,
      chat,
      botMessageId,
      inlineKeyboard: YES_NO_KEYBOARD,
    }),
  ];
  const replyInterfaceMarkups: ReplyInterfaceMarkup[] = [
    COLOR_KEYBOARD,
    { kind: 'forced_reply', isSelective: false },
    { kind: 'reply_keyboard_removal', isSelective: false },
  ];

  for (const replyInterfaceMarkup of replyInterfaceMarkups) {
    for (const send of [sendBotText, sendBotPhoto]) {
      const sent = send({ replyInterfaceMarkup });
      if (!sent.sent) {
        throw new Error(`Expected the bot message to be sent, received ${sent.reason}`);
      }
      const eventCountBeforeEdits = publishedEvents.length;
      const edits = editEveryWay(expectBotMessageId(messageBoxes, bot, sent.message.id));
      if (
        edits.some((edit) => edit.edited || edit.reason !== 'message_not_editable') ||
        messages.getPrivateMessage(sent.message.id) !== sent.message ||
        publishedEvents.length !== eventCountBeforeEdits
      ) {
        throw new Error(
          `Expected a ${sent.message.content.kind} with ${replyInterfaceMarkup.kind} to refuse ` +
            `every edit, received ${JSON.stringify(edits)}`,
        );
      }
    }
  }

  // A keyboard stays with its message after a later message removes it from the client.
  const keyboardMessage = sendBotText({ replyInterfaceMarkup: COLOR_KEYBOARD });
  sendBotText({ replyInterfaceMarkup: { kind: 'reply_keyboard_removal', isSelective: false } });
  const shown = privateMessaging.getPrivateChatReplyInterface({
    accountId: account.profile.id,
    botId: bot.profile.id,
  });
  if (!keyboardMessage.sent || !shown.found || shown.shownReplyInterface !== undefined) {
    throw new Error('Expected the removal to leave the client without a reply interface');
  }
  const [hiddenKeyboardEdit] = editEveryWay(
    expectBotMessageId(messageBoxes, bot, keyboardMessage.message.id),
  );
  if (hiddenKeyboardEdit.edited || hiddenKeyboardEdit.reason !== 'message_not_editable') {
    throw new Error('Expected a message whose keyboard the client no longer shows to stay fixed');
  }

  for (const markup of [{}, { inlineKeyboard: YES_NO_KEYBOARD }]) {
    const text = sendBotText(markup);
    const photo = sendBotPhoto(markup);
    if (!text.sent || !photo.sent) {
      throw new Error('Expected the bot messages to be sent');
    }
    const [textEdit] = editEveryWay(expectBotMessageId(messageBoxes, bot, text.message.id));
    const [, captionEdit, keyboardEdit] = editEveryWay(
      expectBotMessageId(messageBoxes, bot, photo.message.id),
    );
    if (!textEdit.edited || !captionEdit.edited || !keyboardEdit.edited) {
      throw new Error(
        `Expected messages with ${JSON.stringify(markup)} to be editable, received ` +
          JSON.stringify([textEdit, captionEdit, keyboardEdit]),
      );
    }
  }
});

Deno.test('PrivateMessagingService lets a bot delete messages of its private chat', () => {
  const { virtualUsers, messageBoxes, messages, publishedEvents, privateMessaging } =
    createPrivateMessagingFixture();
  const account = createAccount(virtualUsers, 'Ada');
  const otherAccount = createAccount(virtualUsers, 'Grace');
  const bot = createBot(virtualUsers, 'Test Bot', 'test_bot');
  const accountMessage = sendPrivateText(privateMessaging, account.profile.id, bot);
  const botMessage = sendBotMessage(privateMessaging, account.profile.id, bot, YES_NO_KEYBOARD);
  const keptMessage = sendBotMessage(privateMessaging, account.profile.id, bot);
  const otherChatMessage = sendPrivateText(privateMessaging, otherAccount.profile.id, bot);
  const accountMessageId = expectBotMessageId(messageBoxes, bot, accountMessage.id);
  const botMessageId = expectBotMessageId(messageBoxes, bot, botMessage.id);
  const otherChatMessageId = expectBotMessageId(messageBoxes, bot, otherChatMessage.id);
  const publishedEventCount = publishedEvents.length;

  const deletion = privateMessaging.deleteMessagesByBot({
    fromBotId: bot.profile.id,
    chat: { type: 'private', accountId: account.profile.id },
    botMessageIds: [accountMessageId, botMessageId, botMessageId, otherChatMessageId, 999],
  });
  if (!deletion.deleted || deletion.deletedMessageCount !== 2) {
    throw new Error(
      "Expected both participants' messages to be deleted once and other IDs to be skipped",
    );
  }
  const history = messages.getPrivateConversationMessages({
    accountId: account.profile.id,
    botId: bot.profile.id,
  });
  if (history.length !== 1 || history[0] !== keptMessage) {
    throw new Error('Expected only the undeleted message to remain in the history');
  }
  if (messages.getPrivateMessage(otherChatMessage.id) !== otherChatMessage) {
    throw new Error("Expected a message of the bot's other chat to be kept");
  }
  if (publishedEvents.length !== publishedEventCount) {
    throw new Error('Expected deletions not to publish chat events');
  }

  const repeatedDeletion = privateMessaging.deleteMessagesByBot({
    fromBotId: bot.profile.id,
    chat: { type: 'private', accountId: account.profile.id },
    botMessageIds: [botMessageId],
  });
  if (!repeatedDeletion.deleted || repeatedDeletion.deletedMessageCount !== 0) {
    throw new Error('Expected an already deleted message to be skipped');
  }
  const editOfDeletedMessage = privateMessaging.editBotMessageText({
    fromBotId: bot.profile.id,
    chat: { type: 'private', accountId: account.profile.id },
    botMessageId,
    content: { kind: 'text', text: 'Done' },
  });
  if (editOfDeletedMessage.edited || editOfDeletedMessage.reason !== 'message_not_found') {
    throw new Error('Expected a deleted message not to be found for editing');
  }
  const nextMessage = sendPrivateText(privateMessaging, account.profile.id, bot);
  if (
    expectBotMessageId(messageBoxes, bot, nextMessage.id) !== otherChatMessageId + 1 ||
    expectBotMessageId(messageBoxes, bot, botMessage.id) !== botMessageId
  ) {
    throw new Error('Expected deleted messages to keep their IDs, which are never reused');
  }
});

Deno.test('PrivateMessagingService validates message deletions before changing state', () => {
  const { virtualUsers, messageBoxes, messages, privateMessaging } =
    createPrivateMessagingFixture();
  const account = createAccount(virtualUsers, 'Ada');
  const strangerAccount = createAccount(virtualUsers, 'Grace');
  const bot = createBot(virtualUsers, 'Test Bot', 'test_bot');
  const message = sendPrivateText(privateMessaging, account.profile.id, bot);
  const botMessageId = expectBotMessageId(messageBoxes, bot, message.id);
  const cases: {
    fromBotId: number;
    accountId: number;
    expectedReason: DeleteMessagesByBotFailureReason;
  }[] = [
    { fromBotId: 999, accountId: 999, expectedReason: 'bot_not_found' },
    { fromBotId: bot.profile.id, accountId: 999, expectedReason: 'account_not_found' },
    {
      fromBotId: bot.profile.id,
      accountId: strangerAccount.profile.id,
      expectedReason: 'conversation_not_started',
    },
  ];

  for (const { fromBotId, accountId, expectedReason } of cases) {
    const result = privateMessaging.deleteMessagesByBot({
      fromBotId,
      chat: { type: 'private', accountId },
      botMessageIds: [botMessageId],
    });
    if (result.deleted || result.reason !== expectedReason) {
      throw new Error(`Expected the deletion to fail with ${expectedReason}`);
    }
  }
  if (messages.getPrivateMessage(message.id) !== message) {
    throw new Error('Expected rejected deletions to keep the message');
  }
});

Deno.test('PrivateMessagingService normalizes bot text and entities as Telegram does', () => {
  const { virtualUsers, privateMessaging } = createPrivateMessagingFixture();
  const account = createAccount(virtualUsers, 'Ada');
  const bot = createBot(virtualUsers, 'Test Bot', 'test_bot');
  sendPrivateText(privateMessaging, account.profile.id, bot);

  const result = privateMessaging.sendBotMessage({
    fromBotId: bot.profile.id,
    to: { type: 'private', accountId: account.profile.id },
    content: {
      kind: 'text',
      text: '\n Hi Ada, see\tsite /help  \r\n',
      entities: [
        { type: 'text_mention', offset: 5, length: 3, userId: account.profile.id },
        { type: 'text_link', offset: 14, length: 4, url: 'Example.com' },
        { type: 'bold', offset: 2, length: 20 },
      ],
    },
  });
  if (!result.sent) {
    throw new Error(
      `Expected the formatted message to be sent, received ${JSON.stringify(result)}`,
    );
  }
  // Whitespace is trimmed from both ends, the tab becomes a space, and formatting splits around the
  // mention, the link, and the detected command.
  const expectedEntities = [
    { type: 'bold', offset: 0, length: 3 },
    { type: 'text_mention', offset: 3, length: 3, userId: account.profile.id },
    { type: 'bold', offset: 3, length: 3 },
    { type: 'bold', offset: 6, length: 6 },
    { type: 'text_link', offset: 12, length: 4, url: 'http://example.com/' },
    { type: 'bold', offset: 12, length: 4 },
    { type: 'bold', offset: 16, length: 1 },
    { type: 'bot_command', offset: 17, length: 5 },
    { type: 'bold', offset: 17, length: 3 },
  ];
  if (
    getContentText(result.message.content).text !== 'Hi Ada, see site /help' ||
    JSON.stringify(getContentText(result.message.content).entities) !==
      JSON.stringify(expectedEntities)
  ) {
    throw new Error(
      `Expected normalized text and entities, received ${JSON.stringify(result.message)}`,
    );
  }
});

Deno.test('PrivateMessagingService rejects bot text Telegram cannot normalize after the chat check', () => {
  const { virtualUsers, publishedEvents, privateMessaging } = createPrivateMessagingFixture();
  const account = createAccount(virtualUsers, 'Ada');
  const strangerAccount = createAccount(virtualUsers, 'Grace');
  const bot = createBot(virtualUsers, 'Test Bot', 'test_bot');
  sendPrivateText(privateMessaging, account.profile.id, bot);
  const send = (accountId: number, text: string, entities: readonly TextEntity[] = []) =>
    privateMessaging.sendBotMessage({
      fromBotId: bot.profile.id,
      to: { type: 'private', accountId },
      content: { kind: 'text', text, entities },
    });
  const unknownUserMention: TextEntity = {
    type: 'text_mention',
    offset: 0,
    length: 1,
    userId: 999,
  };

  const unstartedChatResult = send(strangerAccount.profile.id, ' ', [unknownUserMention]);
  if (unstartedChatResult.sent || unstartedChatResult.reason !== 'conversation_not_started') {
    throw new Error('Expected the chat to be checked before the text is normalized');
  }
  const cases: ReadonlyArray<readonly [string, readonly TextEntity[], string]> = [
    [' \n\u200b ', [], 'Text must be non-empty'],
    ['x', [unknownUserMention], 'User not found'],
    [
      'x',
      [{ type: 'text_link', offset: 0, length: 1, url: 'localhost' }],
      "Entity URL 'localhost' is invalid: Wrong HTTP URL",
    ],
    [
      'x',
      [{ type: 'bold', offset: 0, length: 2 }],
      'Entity beginning at UTF-16 offset 0 ends after the end of the text at UTF-16 offset 2',
    ],
  ];
  for (const [text, entities, expectedError] of cases) {
    const result = send(account.profile.id, text, entities);
    if (result.sent || result.reason !== 'text_invalid' || result.textError !== expectedError) {
      throw new Error(
        `Expected ${JSON.stringify(text)} to fail with ${expectedError}, received ${
          JSON.stringify(result)
        }`,
      );
    }
  }

  // Length counts the normalized text, so trailing whitespace does not make text too long.
  const longResult = send(account.profile.id, `${'x'.repeat(MAX_TEXT_MESSAGE_LENGTH)}  `);
  if (!longResult.sent) {
    throw new Error(
      `Expected trimmed text at the length limit to be sent, received ${
        JSON.stringify(longResult)
      }`,
    );
  }
  if (publishedEvents.length !== 2) {
    throw new Error('Expected rejected bot messages not to be stored or published');
  }
});

Deno.test('PrivateMessagingService limits text by its characters, not its UTF-16 code units', () => {
  const { virtualUsers, privateMessaging } = createPrivateMessagingFixture();
  const account = createAccount(virtualUsers, 'Ada');
  const bot = createBot(virtualUsers, 'Test Bot', 'test_bot');
  sendPrivateText(privateMessaging, account.profile.id, bot);
  const send = (text: string, entities: readonly TextEntity[] = []) =>
    privateMessaging.sendBotMessage({
      fromBotId: bot.profile.id,
      to: { type: 'private', accountId: account.profile.id },
      content: { kind: 'text', text, entities },
    });
  const describe = (text: string) => `${[...text].length} characters, ${text.length} code units`;

  const fittingTexts = [
    'a'.repeat(MAX_TEXT_MESSAGE_LENGTH),
    '😀'.repeat(MAX_TEXT_MESSAGE_LENGTH / 2 + 1),
    `${'a'.repeat(MAX_TEXT_MESSAGE_LENGTH - 1)}😀`,
    '😀'.repeat(MAX_TEXT_MESSAGE_LENGTH),
  ];
  for (const text of fittingTexts) {
    const result = send(text);
    if (!result.sent) {
      throw new Error(`Expected text of ${describe(text)} to be sent, received ${result.reason}`);
    }
  }
  const tooLongTexts = [
    'a'.repeat(MAX_TEXT_MESSAGE_LENGTH + 1),
    `${'a'.repeat(MAX_TEXT_MESSAGE_LENGTH)}😀`,
    '😀'.repeat(MAX_TEXT_MESSAGE_LENGTH + 1),
  ];
  for (const text of tooLongTexts) {
    const result = send(text);
    if (result.sent || result.reason !== 'message_text_too_long') {
      throw new Error(`Expected text of ${describe(text)} to be too long`);
    }
  }

  // Entities count UTF-16 code units, while the limit counts the characters of the fixed text.
  const emojiText = '😀'.repeat(MAX_TEXT_MESSAGE_LENGTH);
  const formatted = send(`  ${emojiText}  `, [
    { type: 'bold', offset: 2, length: emojiText.length },
  ]);
  if (
    !formatted.sent || formatted.message.content.kind !== 'text' ||
    formatted.message.content.text !== emojiText ||
    JSON.stringify(formatted.message.content.entities) !==
      JSON.stringify([{ type: 'bold', offset: 0, length: emojiText.length }])
  ) {
    throw new Error('Expected formatted text to be limited after it is trimmed');
  }

  const edited = privateMessaging.editBotMessageText({
    fromBotId: bot.profile.id,
    chat: { type: 'private', accountId: account.profile.id },
    botMessageId: 2,
    content: { kind: 'text', text: `${'😀'.repeat(MAX_TEXT_MESSAGE_LENGTH - 1)}a` },
  });
  if (!edited.edited) {
    throw new Error(
      `Expected an edit to the character limit to succeed, received ${edited.reason}`,
    );
  }
});

Deno.test('PrivateMessagingService normalizes account text as a Telegram client does', () => {
  const { virtualUsers, publishedEvents, privateMessaging } = createPrivateMessagingFixture();
  const account = createAccount(virtualUsers, 'Ada');
  const bot = createBot(virtualUsers, 'Test Bot', 'test_bot');
  const send = (text: string) =>
    privateMessaging.sendAccountMessage({
      fromAccountId: account.profile.id,
      to: { type: 'private', botId: bot.profile.id },
      content: { kind: 'text', text },
    });

  const result = send('  /start\r\n');
  if (
    !result.sent || getContentText(result.message.content).text !== '/start' ||
    JSON.stringify(getContentText(result.message.content).entities) !==
      JSON.stringify([{ type: 'bot_command', offset: 0, length: 6 }])
  ) {
    throw new Error(`Expected trimmed text with its command, received ${JSON.stringify(result)}`);
  }
  const blankResult = send(' \n ');
  if (
    blankResult.sent || blankResult.reason !== 'text_invalid' ||
    blankResult.textError !== 'Text must be non-empty' || publishedEvents.length !== 1
  ) {
    throw new Error(`Expected blank text to be rejected, received ${JSON.stringify(blankResult)}`);
  }
});

Deno.test('PrivateMessagingService treats changed entities as an edit of the text', () => {
  const { virtualUsers, messageBoxes, privateMessaging, advanceClockSeconds } =
    createPrivateMessagingFixture();
  const account = createAccount(virtualUsers, 'Ada');
  const bot = createBot(virtualUsers, 'Test Bot', 'test_bot');
  sendPrivateText(privateMessaging, account.profile.id, bot);
  const botMessage = sendBotMessage(privateMessaging, account.profile.id, bot);
  const botMessageId = expectBotMessageId(messageBoxes, bot, botMessage.id);
  const editText = (entities: readonly TextEntity[]) =>
    privateMessaging.editBotMessageText({
      fromBotId: bot.profile.id,
      chat: { type: 'private', accountId: account.profile.id },
      botMessageId,
      content: { kind: 'text', text: getContentText(botMessage.content).text, entities },
    });
  advanceClockSeconds(5);

  const boldEdit = editText([{ type: 'bold', offset: 0, length: 8 }]);
  if (
    !boldEdit.edited || boldEdit.message.contentEditedAtUnixSeconds !== 1_700_000_005 ||
    JSON.stringify(getContentText(boldEdit.message.content).entities) !==
      JSON.stringify([{ type: 'bold', offset: 0, length: 8 }])
  ) {
    throw new Error(
      `Expected formatting alone to be a dated edit, received ${JSON.stringify(boldEdit)}`,
    );
  }
  const repeatedEdit = editText([{ type: 'bold', offset: 0, length: 4 }, {
    type: 'bold',
    offset: 4,
    length: 4,
  }]);
  if (repeatedEdit.edited || repeatedEdit.reason !== 'message_not_modified') {
    throw new Error(
      `Expected formatting that normalizes to the same entities to be no edit, received ${
        JSON.stringify(repeatedEdit)
      }`,
    );
  }
});

Deno.test('PrivateMessagingService lets a bot show chat actions only in started chats', () => {
  const { virtualUsers, publishedEvents, privateMessaging } = createPrivateMessagingFixture();
  const account = createAccount(virtualUsers, 'Ada');
  const strangerAccount = createAccount(virtualUsers, 'Grace');
  const bot = createBot(virtualUsers, 'Test Bot', 'test_bot');
  sendPrivateText(privateMessaging, account.profile.id, bot);
  const sendAction = (fromBotId: number, accountId: number) =>
    privateMessaging.sendBotChatAction({
      fromBotId,
      to: { type: 'private', accountId },
      action: 'typing',
    });

  const cases = [
    [sendAction(bot.profile.id, account.profile.id), undefined],
    [sendAction(999, account.profile.id), 'bot_not_found'],
    [sendAction(bot.profile.id, 999), 'account_not_found'],
    [sendAction(bot.profile.id, strangerAccount.profile.id), 'conversation_not_started'],
  ] as const;
  for (const [result, expectedReason] of cases) {
    const reason = result.sent ? undefined : result.reason;
    if (reason !== expectedReason) {
      throw new Error(
        `Expected ${expectedReason ?? 'success'}, received ${JSON.stringify(result)}`,
      );
    }
  }
  if (publishedEvents.length !== 1) {
    throw new Error('Expected chat actions not to store or publish anything');
  }
});

Deno.test('PrivateMessagingService sends photos and documents with normalized captions', () => {
  const { virtualUsers, files, botUpdates, privateMessaging } = createPrivateMessagingFixture();
  const account = createAccount(virtualUsers, 'Ada');
  const bot = createBot(virtualUsers, 'Test Bot', 'test_bot');

  const accountPhoto = privateMessaging.sendAccountMessage({
    fromAccountId: account.profile.id,
    to: { type: 'private', botId: bot.profile.id },
    content: { kind: 'media', upload: photoUpload(), caption: '  /start now \n' },
  });
  if (!accountPhoto.sent || accountPhoto.message.content.kind !== 'photo') {
    throw new Error(
      `Expected the account photo to be sent, received ${JSON.stringify(accountPhoto)}`,
    );
  }
  const storedPhoto = files.getFile(accountPhoto.message.content.fileId);
  const photoUpdate = messageFromUpdate(
    botUpdates.confirmAndReadPendingUpdates(bot.profile.id, { limit: 100 })[0],
  );
  if (
    storedPhoto?.type !== 'photo' ||
    JSON.stringify(accountPhoto.message.content.caption) !==
      JSON.stringify({
        text: '/start now',
        entities: [{ type: 'bot_command', offset: 0, length: 6 }],
      }) ||
    photoUpdate === undefined || !('photo' in photoUpdate) ||
    photoUpdate.photo[0].file_unique_id !== storedPhoto.uniqueId ||
    photoUpdate.photo[0].width !== 4 || photoUpdate.caption !== '/start now'
  ) {
    throw new Error(
      `Expected the bot to receive the captioned photo, received ${JSON.stringify(photoUpdate)}`,
    );
  }

  const botDocument = privateMessaging.sendBotMessage({
    fromBotId: bot.profile.id,
    to: { type: 'private', accountId: account.profile.id },
    content: {
      kind: 'document',
      document: {
        kind: 'upload',
        upload: {
          type: 'document',
          content: new Uint8Array([1, 2]),
          fileName: 'report.pdf',
          mimeType: 'application/pdf',
        },
      },
      caption: 'Report',
      captionEntities: [{ type: 'bold', offset: 0, length: 6 }],
    },
  });
  const reusedPhoto = privateMessaging.sendBotMessage({
    fromBotId: bot.profile.id,
    to: { type: 'private', accountId: account.profile.id },
    content: {
      kind: 'photo',
      photo: { kind: 'stored', file: storedPhoto },
      caption: ' \n ',
      hasSpoiler: true,
      showsCaptionAboveMedia: true,
    },
  });
  if (
    !botDocument.sent || botDocument.message.content.kind !== 'document' ||
    files.getFile(botDocument.message.content.fileId)?.type !== 'document' ||
    JSON.stringify(botDocument.message.content.caption.entities) !==
      JSON.stringify([{ type: 'bold', offset: 0, length: 6 }]) ||
    !reusedPhoto.sent ||
    JSON.stringify(reusedPhoto.message.content) !==
      JSON.stringify({
        kind: 'photo',
        fileId: storedPhoto.id,
        caption: { text: '', entities: [] },
        hasSpoiler: true,
        showsCaptionAboveMedia: true,
      })
  ) {
    throw new Error('Expected the bot to send an uploaded document and a stored photo');
  }
});

Deno.test('PrivateMessagingService limits captions and stores no upload of a refused message', () => {
  const { virtualUsers, storedUploads, privateMessaging } = createPrivateMessagingFixture();
  const account = createAccount(virtualUsers, 'Ada');
  const bot = createBot(virtualUsers, 'Test Bot', 'test_bot');
  sendPrivateText(privateMessaging, account.profile.id, bot);
  const sendCaptionedPhoto = (caption: string) =>
    privateMessaging.sendBotMessage({
      fromBotId: bot.profile.id,
      to: { type: 'private', accountId: account.profile.id },
      content: {
        kind: 'photo',
        photo: { kind: 'upload', upload: photoUpload() },
        caption,
        hasSpoiler: false,
        showsCaptionAboveMedia: false,
      },
    });

  const tooLong = sendCaptionedPhoto('x'.repeat(MAX_CAPTION_LENGTH + 1));
  // TDLib counts characters, so a caption of astral emoji may exceed the limit in UTF-16.
  const longestEmoji = sendCaptionedPhoto('📷'.repeat(MAX_CAPTION_LENGTH));
  if (
    tooLong.sent || tooLong.reason !== 'caption_too_long' ||
    !longestEmoji.sent || longestEmoji.message.content.kind !== 'photo'
  ) {
    throw new Error('Expected captions to be limited by their characters');
  }

  const unknownChatPhoto = privateMessaging.sendBotMessage({
    fromBotId: bot.profile.id,
    to: { type: 'private', accountId: 999 },
    content: {
      kind: 'photo',
      photo: { kind: 'upload', upload: photoUpload() },
      caption: '',
      hasSpoiler: false,
      showsCaptionAboveMedia: false,
    },
  });
  if (unknownChatPhoto.sent || storedUploads.length !== 1) {
    throw new Error('Expected only the accepted photo to be stored');
  }
});

Deno.test('PrivateMessagingService sends albums as ordered messages that share an album', () => {
  const { virtualUsers, messages, messageBoxes, botUpdates, privateMessaging } =
    createPrivateMessagingFixture();
  const account = createAccount(virtualUsers, 'Ada');
  const bot = createBot(virtualUsers, 'Test Bot', 'test_bot');

  const accountAlbum = privateMessaging.sendAccountAlbum({
    fromAccountId: account.profile.id,
    to: { type: 'private', botId: bot.profile.id },
    contents: [
      { kind: 'media', upload: photoUpload(), caption: 'First' },
      { kind: 'media', upload: photoUpload(), caption: '  /second  ' },
    ],
  });
  if (!accountAlbum.sent) {
    throw new Error(`Expected the account's album to be sent, received ${accountAlbum.reason}`);
  }
  const [firstPhoto, secondPhoto] = accountAlbum.messages;
  const updates = botUpdates.confirmAndReadPendingUpdates(bot.profile.id, { limit: 100 })
    .map(messageFromUpdate);
  if (
    accountAlbum.messages.length !== 2 || firstPhoto.mediaGroupId === undefined ||
    secondPhoto.mediaGroupId !== firstPhoto.mediaGroupId ||
    getContentText(secondPhoto.content).text !== '/second' ||
    JSON.stringify(updates.map((update) => update?.message_id)) !==
      JSON.stringify([1, 2]) ||
    updates.some((update) => update?.media_group_id !== firstPhoto.mediaGroupId)
  ) {
    throw new Error(
      `Expected the bot to receive the album in order, received ${JSON.stringify(updates)}`,
    );
  }

  const document = (fileName: string): MediaContent => ({
    kind: 'document',
    document: {
      kind: 'upload',
      upload: {
        type: 'document',
        content: new Uint8Array([1]),
        fileName,
        mimeType: 'text/plain',
      },
    },
    caption: '',
  });
  const botAlbum = privateMessaging.sendBotAlbum({
    fromBotId: bot.profile.id,
    to: { type: 'private', accountId: account.profile.id },
    contents: [document('a.txt'), document('b.txt')],
    replyTo: {
      botMessageId: expectBotMessageId(messageBoxes, bot, secondPhoto.id),
      allowSendingWithoutReply: false,
    },
    isSilent: true,
    messageEffectId: '5104841245755180586',
  });
  const singleAlbum = privateMessaging.sendBotAlbum({
    fromBotId: bot.profile.id,
    to: { type: 'private', accountId: account.profile.id },
    contents: [document('c.txt')],
  });
  if (!botAlbum.sent || !singleAlbum.sent) {
    throw new Error('Expected both bot albums to be sent');
  }
  const [firstDocument, secondDocument] = botAlbum.messages;
  if (
    firstDocument.mediaGroupId === undefined ||
    firstDocument.mediaGroupId === firstPhoto.mediaGroupId ||
    secondDocument.mediaGroupId !== firstDocument.mediaGroupId ||
    botAlbum.messages.some((message) =>
      message.replyToMessageId !== secondPhoto.id || !message.isSilent ||
      message.messageEffectId !== '5104841245755180586'
    ) ||
    singleAlbum.messages.length !== 1 || 'mediaGroupId' in singleAlbum.messages[0]
  ) {
    throw new Error('Expected a new album replying alike, and a single message outside albums');
  }
  if (
    JSON.stringify(
      messages.getPrivateConversationMessages({
        accountId: account.profile.id,
        botId: bot.profile.id,
      }).map((message) => message.id),
    ) !==
      JSON.stringify([...accountAlbum.messages, ...botAlbum.messages, ...singleAlbum.messages]
        .map((message) => message.id))
  ) {
    throw new Error('Expected the history to hold the albums in order');
  }
});

Deno.test('PrivateMessagingService checks every message of an album before storing any', () => {
  const { virtualUsers, messages, storedUploads, publishedEvents, blockedUsers, privateMessaging } =
    createPrivateMessagingFixture();
  const account = createAccount(virtualUsers, 'Ada');
  const bot = createBot(virtualUsers, 'Test Bot', 'test_bot');
  sendPrivateText(privateMessaging, account.profile.id, bot);
  const photo = (caption: string, showsCaptionAboveMedia = false): MediaContent => ({
    kind: 'photo',
    photo: { kind: 'upload', upload: photoUpload() },
    caption,
    hasSpoiler: false,
    showsCaptionAboveMedia,
  });
  const documentUpload: DocumentUpload = {
    type: 'document',
    content: new Uint8Array([1]),
    fileName: 'a.txt',
    mimeType: 'text/plain',
  };
  const document: MediaContent = {
    kind: 'document',
    document: { kind: 'upload', upload: documentUpload },
    caption: '',
  };
  const sendBotAlbum = (contents: readonly MediaContent[]) =>
    privateMessaging.sendBotAlbum({
      fromBotId: bot.profile.id,
      to: { type: 'private', accountId: account.profile.id },
      contents,
    });
  const storedState = () => ({
    uploads: storedUploads.length,
    events: publishedEvents.length,
    history: messages.getPrivateConversationMessages({
      accountId: account.profile.id,
      botId: bot.profile.id,
    }).length,
  });
  const stateBefore = storedState();

  const failures = [
    sendBotAlbum([photo('Fits'), photo('x'.repeat(MAX_CAPTION_LENGTH + 1))]),
    sendBotAlbum([]),
    sendBotAlbum(Array.from({ length: 11 }, () => photo(''))),
    sendBotAlbum([photo('', true), photo('')]),
    sendBotAlbum([photo(''), document]),
    privateMessaging.sendAccountAlbum({
      fromAccountId: account.profile.id,
      to: { type: 'private', botId: bot.profile.id },
      contents: [
        { kind: 'media', upload: photoUpload(), caption: '' },
        { kind: 'media', upload: documentUpload, caption: '' },
      ],
    }),
  ].map((result) => result.sent ? 'sent' : result.reason);
  blockedUsers.block(account.profile.id, bot.profile.id);
  failures.push(
    ...[sendBotAlbum([photo(''), photo('')])].map((result) => result.sent ? 'sent' : result.reason),
  );
  if (
    JSON.stringify(failures) !==
      JSON.stringify([
        'caption_too_long',
        'album_empty',
        'album_too_large',
        'album_caption_placement_mixed',
        'album_documents_mixed',
        'album_documents_mixed',
        'bot_blocked',
      ])
  ) {
    throw new Error(`Expected each album to be refused, received ${JSON.stringify(failures)}`);
  }
  if (JSON.stringify(storedState()) !== JSON.stringify(stateBefore)) {
    throw new Error('Expected refused albums to store no message, upload, or event');
  }
});

Deno.test('PrivateMessagingService stores the uploads of rich messages only once they are sent or edited', () => {
  const { virtualUsers, privateMessaging, storedUploads, advanceClockSeconds } =
    createPrivateMessagingFixture();
  const account = createAccount(virtualUsers, 'Ada');
  const bot = createBot(virtualUsers, 'Test Bot', 'test_bot');
  const chat = { type: 'private', accountId: account.profile.id } as const;
  const richMessageWithPhoto = {
    kind: 'rich_message',
    richMessage: {
      blocks: [{
        kind: 'photo',
        photo: { kind: 'upload', upload: photoUpload() },
        hasSpoiler: false,
      }],
      isRightToLeft: false,
    },
    detectsEntities: true,
  } as const;

  const sendBeforeStart = privateMessaging.sendBotMessage({
    fromBotId: bot.profile.id,
    to: chat,
    content: richMessageWithPhoto,
  });
  sendPrivateText(privateMessaging, account.profile.id, bot);
  const sent = privateMessaging.sendBotMessage({
    fromBotId: bot.profile.id,
    to: chat,
    content: { kind: 'text', text: 'Draft' },
  });
  if (sendBeforeStart.sent || !sent.sent || storedUploads.length !== 0) {
    throw new Error('Expected a refused rich message to store no upload');
  }
  const botMessageId = 2;

  const refusedEdit = privateMessaging.editBotMessageText({
    fromBotId: bot.profile.id,
    chat,
    botMessageId,
    content: richMessageWithPhoto,
    inlineKeyboard: [[{ kind: 'callback', text: 'Go', callbackData: 'x'.repeat(65) }]],
  });
  advanceClockSeconds(5);
  const edit = privateMessaging.editBotMessageText({
    fromBotId: bot.profile.id,
    chat,
    botMessageId,
    content: richMessageWithPhoto,
  });
  const storedUploadCount: number = storedUploads.length;
  if (
    refusedEdit.edited || refusedEdit.reason !== 'callback_data_invalid' || !edit.edited ||
    storedUploadCount !== 1 || edit.message.content.kind !== 'rich_message' ||
    edit.message.contentEditedAtUnixSeconds !== 1_700_000_005
  ) {
    throw new Error('Expected only the edit that succeeded to store its upload');
  }
});

Deno.test('PrivateMessagingService edits captions and refuses edits of the other content kind', () => {
  const { virtualUsers, messageBoxes, botUpdates, privateMessaging, advanceClockSeconds } =
    createPrivateMessagingFixture();
  const account = createAccount(virtualUsers, 'Ada');
  const bot = createBot(virtualUsers, 'Test Bot', 'test_bot');
  sendPrivateText(privateMessaging, account.profile.id, bot);
  const botText = privateMessaging.sendBotMessage({
    fromBotId: bot.profile.id,
    to: { type: 'private', accountId: account.profile.id },
    content: { kind: 'text', text: 'Hi' },
  });
  const photo = privateMessaging.sendBotMessage({
    fromBotId: bot.profile.id,
    to: { type: 'private', accountId: account.profile.id },
    content: {
      kind: 'photo',
      photo: { kind: 'upload', upload: photoUpload() },
      caption: 'Old',
      hasSpoiler: false,
      showsCaptionAboveMedia: false,
    },
  });
  if (!botText.sent || !photo.sent) {
    throw new Error('Expected the text and the photo to be sent');
  }
  const chat = { type: 'private', accountId: account.profile.id } as const;
  const photoId = expectBotMessageId(messageBoxes, bot, photo.message.id);
  const editCaption = (caption: string, showsCaptionAboveMedia: boolean, botMessageId = photoId) =>
    privateMessaging.editBotMessageCaption({
      fromBotId: bot.profile.id,
      chat,
      botMessageId,
      caption,
      showsCaptionAboveMedia,
    });
  advanceClockSeconds(5);

  const textEdit = privateMessaging.editBotMessageText({
    fromBotId: bot.profile.id,
    chat,
    botMessageId: photoId,
    content: { kind: 'text', text: 'New' },
  });
  const captionOfText = editCaption(
    'New',
    false,
    expectBotMessageId(messageBoxes, bot, botText.message.id),
  );
  const captionEdit = editCaption('New', false);
  const repeatedEdit = editCaption('New', false);
  advanceClockSeconds(5);
  const placementEdit = editCaption('New', true);
  const removal = editCaption('', true);
  if (
    textEdit.edited || textEdit.reason !== 'message_has_no_text' ||
    captionOfText.edited || captionOfText.reason !== 'message_has_no_caption' ||
    !captionEdit.edited || captionEdit.message.contentEditedAtUnixSeconds !== 1_700_000_005 ||
    getContentText(captionEdit.message.content).text !== 'New' ||
    repeatedEdit.edited || repeatedEdit.reason !== 'message_not_modified' ||
    !placementEdit.edited || placementEdit.message.contentEditedAtUnixSeconds !== 1_700_000_010 ||
    !removal.edited || getContentText(removal.message.content).text !== ''
  ) {
    throw new Error('Expected caption edits to follow Telegram checks');
  }

  const accountDocument = privateMessaging.sendAccountMessage({
    fromAccountId: account.profile.id,
    to: { type: 'private', botId: bot.profile.id },
    content: {
      kind: 'media',
      upload: {
        type: 'document',
        content: new Uint8Array([1]),
        fileName: 'notes.txt',
        mimeType: 'text/plain',
      },
      caption: 'Notes',
    },
  });
  if (!accountDocument.sent) {
    throw new Error(`Expected the document to be sent, received ${accountDocument.reason}`);
  }
  const documentId = expectBotMessageId(messageBoxes, bot, accountDocument.message.id);
  const editAccountMessage = (
    edit: Parameters<typeof privateMessaging.editAccountMessage>[0]['edit'],
  ) =>
    privateMessaging.editAccountMessage({
      fromAccountId: account.profile.id,
      chat: { type: 'private', botId: bot.profile.id },
      botMessageId: documentId,
      edit,
    });
  const accountTextEdit = editAccountMessage({ kind: 'text', text: 'Notes' });
  const unchangedCaption = editAccountMessage({ kind: 'caption', caption: ' Notes ' });
  const accountCaptionEdit = editAccountMessage({ kind: 'caption', caption: '/help notes' });
  const updates = botUpdates.confirmAndReadPendingUpdates(bot.profile.id, { limit: 100 });
  const editUpdate = updates.at(-1);
  if (
    accountTextEdit.edited || accountTextEdit.reason !== 'message_has_no_text' ||
    unchangedCaption.edited || unchangedCaption.reason !== 'message_not_modified' ||
    !accountCaptionEdit.edited || editUpdate === undefined || !('edited_message' in editUpdate) ||
    !('document' in editUpdate.edited_message) ||
    editUpdate.edited_message.caption !== '/help notes' ||
    JSON.stringify(editUpdate.edited_message.caption_entities) !==
      JSON.stringify([{ type: 'bot_command', offset: 0, length: 5 }])
  ) {
    throw new Error(
      `Expected the account caption edit to reach the bot, received ${JSON.stringify(updates)}`,
    );
  }
});

Deno.test('PrivateMessagingService edits the text of an account message and publishes the edit', () => {
  const {
    virtualUsers,
    messageBoxes,
    botUpdates,
    publishedEvents,
    privateMessaging,
    advanceClockSeconds,
  } = createPrivateMessagingFixture();
  const account = createAccount(virtualUsers, 'Ada');
  const bot = createBot(virtualUsers, 'Test Bot', 'test_bot');
  const accountMessage = sendPrivateText(privateMessaging, account.profile.id, bot);
  const botMessageId = expectBotMessageId(messageBoxes, bot, accountMessage.id);
  advanceClockSeconds(5);

  const result = privateMessaging.editAccountMessage({
    fromAccountId: account.profile.id,
    chat: { type: 'private', botId: bot.profile.id },
    botMessageId,
    edit: { kind: 'text', text: '  Hello /help  ' },
  });
  if (!result.edited) {
    throw new Error(`Expected the edit to succeed, received ${result.reason}`);
  }
  if (
    result.message.id !== accountMessage.id ||
    result.message.sentAtUnixSeconds !== 1_700_000_000 ||
    result.message.contentEditedAtUnixSeconds !== 1_700_000_005 ||
    getContentText(result.message.content).text !== 'Hello /help' ||
    JSON.stringify(getContentText(result.message.content).entities) !==
      JSON.stringify([{ type: 'bot_command', offset: 6, length: 5 }])
  ) {
    throw new Error('Expected a dated edit whose text is normalized as when sending');
  }
  if (
    JSON.stringify(publishedEvents.at(-1)) !==
      JSON.stringify({ type: 'message_edited', message: result.message })
  ) {
    throw new Error('Expected the edit to be published');
  }
  const updates = botUpdates.confirmAndReadPendingUpdates(bot.profile.id, { limit: 100 });
  const lastUpdate = updates.at(-1);
  if (
    updates.length !== 2 || lastUpdate === undefined || !('edited_message' in lastUpdate) ||
    lastUpdate.edited_message.message_id !== botMessageId ||
    lastUpdate.edited_message.edit_date !== 1_700_000_005 ||
    textContentOf(lastUpdate.edited_message)?.text !== 'Hello /help'
  ) {
    throw new Error(`Expected an edited_message update, received ${JSON.stringify(updates)}`);
  }
});

Deno.test('PrivateMessagingService validates account message edits before changing state', () => {
  const { virtualUsers, messageBoxes, messages, publishedEvents, privateMessaging } =
    createPrivateMessagingFixture();
  const account = createAccount(virtualUsers, 'Ada');
  const otherAccount = createAccount(virtualUsers, 'Grace');
  const bot = createBot(virtualUsers, 'Test Bot', 'test_bot');
  const accountMessage = sendPrivateText(privateMessaging, account.profile.id, bot);
  const otherChatMessage = sendPrivateText(privateMessaging, otherAccount.profile.id, bot);
  const botMessage = sendBotMessage(privateMessaging, account.profile.id, bot);
  const accountMessageId = expectBotMessageId(messageBoxes, bot, accountMessage.id);
  const editAccountMessage = (
    { fromAccountId = account.profile.id, botId = bot.profile.id, botMessageId, text = 'Edited' }: {
      fromAccountId?: number;
      botId?: number;
      botMessageId: number;
      text?: string;
    },
  ) =>
    privateMessaging.editAccountMessage({
      fromAccountId,
      chat: { type: 'private', botId },
      botMessageId,
      edit: { kind: 'text', text },
    });
  const publishedEventCount = publishedEvents.length;

  const cases = [
    [
      editAccountMessage({ fromAccountId: 999, botMessageId: accountMessageId }),
      'account_not_found',
    ],
    [editAccountMessage({ botId: 999, botMessageId: accountMessageId }), 'bot_not_found'],
    [editAccountMessage({ botMessageId: 99 }), 'message_not_found'],
    [
      editAccountMessage({
        botMessageId: expectBotMessageId(messageBoxes, bot, otherChatMessage.id),
      }),
      'message_not_found',
    ],
    [
      editAccountMessage({
        botMessageId: expectBotMessageId(messageBoxes, bot, botMessage.id),
      }),
      'message_not_editable',
    ],
    [editAccountMessage({ botMessageId: accountMessageId, text: '' }), 'message_text_empty'],
    [editAccountMessage({ botMessageId: accountMessageId, text: '   ' }), 'text_invalid'],
    [
      editAccountMessage({
        botMessageId: accountMessageId,
        text: 'x'.repeat(MAX_TEXT_MESSAGE_LENGTH + 1),
      }),
      'message_text_too_long',
    ],
    // Surrounding whitespace is trimmed, so this text is the stored one.
    [
      editAccountMessage({ botMessageId: accountMessageId, text: ' Hello ' }),
      'message_not_modified',
    ],
  ] as const;
  for (const [result, expectedReason] of cases) {
    if (result.edited || result.reason !== expectedReason) {
      throw new Error(`Expected ${expectedReason}, received ${JSON.stringify(result)}`);
    }
  }
  if (
    messages.getPrivateMessage(accountMessage.id) !== accountMessage ||
    publishedEvents.length !== publishedEventCount
  ) {
    throw new Error('Expected rejected edits to leave the message unchanged and unpublished');
  }
});

Deno.test('PrivateMessagingService refuses writing either way while the account blocks the bot', () => {
  const { virtualUsers, messageBoxes, blockedUsers, publishedEvents, privateMessaging } =
    createPrivateMessagingFixture();
  const account = createAccount(virtualUsers, 'Ada');
  const bot = createBot(virtualUsers, 'Test Bot', 'test_bot');
  const accountMessage = sendPrivateText(privateMessaging, account.profile.id, bot);
  const botMessage = sendBotMessage(privateMessaging, account.profile.id, bot);
  blockedUsers.block(account.profile.id, bot.profile.id);
  const publishedEventCount = publishedEvents.length;
  const sendBotText = (text: string, replyToBotMessageId?: number) =>
    privateMessaging.sendBotMessage({
      fromBotId: bot.profile.id,
      to: { type: 'private', accountId: account.profile.id },
      replyTo: replyToBotMessageId === undefined
        ? undefined
        : { botMessageId: replyToBotMessageId, allowSendingWithoutReply: false },
      content: { kind: 'text', text },
    });

  const cases = [
    [
      privateMessaging.sendAccountMessage({
        fromAccountId: account.profile.id,
        to: { type: 'private', botId: bot.profile.id },
        content: { kind: 'text', text: 'Hello again' },
      }),
      'bot_blocked',
    ],
    [sendBotText('Still there?'), 'bot_blocked'],
    // Telegram's servers refuse the message only after every other check passed.
    [sendBotText(''), 'message_text_empty'],
    [sendBotText('Still there?', 99), 'reply_message_not_found'],
    [
      privateMessaging.sendBotChatAction({
        fromBotId: bot.profile.id,
        to: { type: 'private', accountId: account.profile.id },
        action: 'typing',
      }),
      'bot_blocked',
    ],
  ] as const;
  for (const [result, expectedReason] of cases) {
    if (result.sent || result.reason !== expectedReason) {
      throw new Error(`Expected ${expectedReason}, received ${JSON.stringify(result)}`);
    }
  }
  if (publishedEvents.length !== publishedEventCount) {
    throw new Error('Expected refused messages not to be stored or published');
  }

  const botEdit = privateMessaging.editBotMessageText({
    fromBotId: bot.profile.id,
    chat: { type: 'private', accountId: account.profile.id },
    botMessageId: expectBotMessageId(messageBoxes, bot, botMessage.id),
    content: { kind: 'text', text: 'Goodbye' },
  });
  const accountEdit = privateMessaging.editAccountMessage({
    fromAccountId: account.profile.id,
    chat: { type: 'private', botId: bot.profile.id },
    botMessageId: expectBotMessageId(messageBoxes, bot, accountMessage.id),
    edit: { kind: 'text', text: 'Bye' },
  });
  if (!botEdit.edited || !accountEdit.edited) {
    throw new Error('Expected a block to leave existing messages editable');
  }

  blockedUsers.unblock(account.profile.id, bot.profile.id);
  if (!sendBotText('Welcome back').sent) {
    throw new Error('Expected the bot to write again once unblocked');
  }
});

const COLOR_KEYBOARD: ReplyInterfaceMarkup = {
  kind: 'reply_keyboard',
  rows: [[{ text: 'Red' }, { text: 'Green' }]],
  isPersistent: false,
  resizesToFit: true,
  isOneTime: true,
  isSelective: false,
};

const YES_NO_KEYBOARD: InlineKeyboard = [[
  { kind: 'callback', text: 'Yes', callbackData: 'yes' },
  { kind: 'callback', text: 'No', callbackData: 'no' },
]];

function sendBotMessage(
  privateMessaging: PrivateMessagingService,
  accountId: number,
  bot: VirtualBot,
  inlineKeyboard?: InlineKeyboard,
): PrivateMessage {
  const result = privateMessaging.sendBotMessage({
    fromBotId: bot.profile.id,
    to: { type: 'private', accountId },
    inlineKeyboard,
    content: { kind: 'text', text: 'Continue?' },
  });
  if (!result.sent) {
    throw new Error(`Expected the bot message to be sent, received ${result.reason}`);
  }
  return result.message;
}

function expectBotMessageId(
  messageBoxes: MessageBoxRepository,
  bot: VirtualBot,
  canonicalMessageId: string,
): number {
  const botMessageId = messageBoxes.getMessageId(bot.profile.id, canonicalMessageId);
  if (botMessageId === undefined) {
    throw new Error(`Expected message ${canonicalMessageId} in the bot's message box`);
  }
  return botMessageId;
}

function createPrivateMessagingFixture() {
  const identities = new TelegramIdentityRepository();
  const accounts = new AccountRepository();
  const bots = new BotRepository();
  const virtualUsers = new VirtualUserService({ identities, accounts, bots });
  const privateConversations = new PrivateConversationRepository();
  const messages = new MessageRepository();
  const files = new FileRepository();
  const messageBoxes = new MessageBoxRepository();
  const botUpdates = new BotUpdateRepository();
  const sharedChats = new SharedChatRepository();
  const botUpdateDelivery = new BotUpdateDeliveryService({
    botMessageViews: new BotMessageViewService({
      accounts,
      bots,
      sharedChats,
      messageBoxes,
      messages,
      files,
    }),
    botUpdates,
    updateSubscriptions: new BotUpdateSubscriptionRepository(),
    bots,
    sharedChats,
    messages,
  });
  const publishedEvents: ChatDomainEvent[] = [];
  let currentUnixTimeSeconds = 1_700_000_000;
  const blockedUsers = new BlockedUserRepository();
  const storedUploads: FileUpload[] = [];
  const privateMessaging = new PrivateMessagingService({
    accounts,
    bots,
    privateConversations,
    messages,
    files: {
      addFile: (upload) => {
        storedUploads.push(upload);
        return files.addFile(upload);
      },
    },
    messageBoxes,
    blockedUsers,
    events: {
      publish: (event) => {
        publishedEvents.push(event);
        botUpdateDelivery.publish(event);
      },
    },
    currentUnixTimeSeconds: () => currentUnixTimeSeconds,
  });
  const advanceClockSeconds = (seconds: number) => {
    currentUnixTimeSeconds += seconds;
  };
  return {
    virtualUsers,
    privateConversations,
    messages,
    files,
    storedUploads,
    messageBoxes,
    botUpdates,
    blockedUsers,
    publishedEvents,
    privateMessaging,
    advanceClockSeconds,
  };
}

/** A photo upload of a 4 by 3 GIF image, whose header is all the emulator reads. */
function photoUpload(): PhotoUpload {
  const content = new Uint8Array(13);
  content.set(new TextEncoder().encode('GIF89a'));
  content.set([4, 0, 3, 0], 6);
  return { type: 'photo', content, imageFormat: 'gif', width: 4, height: 3 };
}

function sendPrivateText(
  privateMessaging: PrivateMessagingService,
  accountId: number,
  bot: VirtualBot,
): PrivateMessage {
  const result = privateMessaging.sendAccountMessage({
    fromAccountId: accountId,
    to: { type: 'private', botId: bot.profile.id },
    content: { kind: 'text', text: 'Hello' },
  });
  if (!result.sent) {
    throw new Error(`Expected message send to succeed, received ${result.reason}`);
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

function createBot(virtualUsers: VirtualUserService, firstName: string, username: string) {
  const result = virtualUsers.createBot({ first_name: firstName, username });
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
