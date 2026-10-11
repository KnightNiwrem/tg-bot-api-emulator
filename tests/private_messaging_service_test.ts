import { assertEquals } from '@std/assert';
import { BotUpdateRepository } from '../src/repositories/bot_update/bot_update.ts';
import { BotUpdateSubscriptionRepository } from '../src/repositories/bot_update_subscription/bot_update_subscription.ts';
import { LastMessageSendingBotRepository } from '../src/repositories/last_message_sending_bot/last_message_sending_bot.ts';
import type { MessageBoxRepository } from '../src/repositories/message_box/message_box.ts';
import { BotMessageViewService } from '../src/services/bot_message_view/bot_message_view.ts';
import { BotUpdateDeliveryService } from '../src/services/update_delivery/bot_update_delivery.ts';
import type {
  BotMessageReplyTarget,
  MessageSendingService,
} from '../src/services/domain/message_sending.ts';
import type { MediaContent } from '../src/services/domain/message_content.ts';
import type { MessageDeletionService } from '../src/services/domain/message_deletion.ts';
import type { MessageEditingService } from '../src/services/domain/message_editing.ts';
import type { ReplyInterfaceService } from '../src/services/domain/reply_interface.ts';
import type { BotApiMessage, BotApiUpdate } from '../src/types/bot_api.ts';
import type { InlineKeyboard } from '../src/types/inline_keyboard.ts';
import type {
  BotMessageReplyMarkup,
  ReplyInterfaceMarkup,
  ReplyKeyboardRequestAnswer,
} from '../src/types/reply_interface.ts';
import type { DocumentUpload, PhotoUpload } from '../src/types/stored_file.ts';
import {
  getContentText,
  MAX_CAPTION_LENGTH,
  MAX_TEXT_MESSAGE_LENGTH,
  type PrivateMessage,
  type PrivateMessageContent,
  type TextEntity,
} from '../src/types/virtual_message.ts';
import type { VirtualBot } from '../src/types/virtual_bot.ts';
import { createChatMessagingServices } from './support/chat_messaging_services.ts';
import { assertEqualsInFieldOrder } from './support/field_order_assertion.ts';
import { TEST_UNIX_TIME_SECONDS } from './support/fixed_wall_clock.ts';
import { createVirtualAccount, createVirtualBot } from './support/virtual_users.ts';

Deno.test('PrivateMessagingService activates a private conversation only for known participants', () => {
  const { virtualUsers, privateConversations, privateMessaging } = createPrivateMessagingFixture();
  const account = createVirtualAccount(virtualUsers, { first_name: 'Ada' });
  const bot = createVirtualBot(virtualUsers, { first_name: 'First Bot', username: 'first_bot' });

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
    messageSending,
  } = createPrivateMessagingFixture();
  const account = createVirtualAccount(virtualUsers, { first_name: 'Ada' });
  const bot = createVirtualBot(virtualUsers, { first_name: 'Test Bot', username: 'test_bot' });

  const firstResult = messageSending.sendAccountPrivateChatMessage({
    fromAccountId: account.profile.id,
    chat: { type: 'private', peerId: bot.profile.id },
    content: { kind: 'text', text: 'Hello' },
  });
  if (!firstResult.sent) {
    throw new Error(`Expected message send to succeed, received ${firstResult.reason}`);
  }
  const secondResult = messageSending.sendAccountPrivateChatMessage({
    fromAccountId: account.profile.id,
    chat: { type: 'private', peerId: bot.profile.id },
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
  const storedMessages = messages.getChatMessages({
    type: 'private',
    conversation: {
      accountId: account.profile.id,
      botId: bot.profile.id,
    },
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
    firstResult.message.sender !== 'account' ||
    firstResult.message.sentAtUnixSeconds !== 1_700_000_000 ||
    firstResult.message.chat.conversation.accountId !== account.profile.id ||
    firstResult.message.chat.conversation.botId !== bot.profile.id
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
  const { virtualUsers, messageBoxes, botUpdates, messageSending } =
    createPrivateMessagingFixture();
  const account = createVirtualAccount(virtualUsers, { first_name: 'Ada' });
  const otherAccount = createVirtualAccount(virtualUsers, { first_name: 'Grace' });
  const firstBot = createVirtualBot(virtualUsers, {
    first_name: 'First Bot',
    username: 'first_bot',
  });
  const secondBot = createVirtualBot(virtualUsers, {
    first_name: 'Second Bot',
    username: 'second_bot',
  });

  const sentMessages = [
    sendPrivateText(messageSending, account.profile.id, firstBot),
    sendPrivateText(messageSending, account.profile.id, secondBot),
    sendPrivateText(messageSending, otherAccount.profile.id, firstBot),
    sendPrivateText(messageSending, account.profile.id, firstBot),
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
  const { virtualUsers, privateConversations, messages, botUpdates, messageSending } =
    createPrivateMessagingFixture();
  const account = createVirtualAccount(virtualUsers, { first_name: 'Ada' });
  const bot = createVirtualBot(virtualUsers, { first_name: 'Test Bot', username: 'test_bot' });

  const failures = [
    messageSending.sendAccountPrivateChatMessage({
      fromAccountId: 999,
      chat: { type: 'private', peerId: bot.profile.id },
      content: { kind: 'text', text: 'Hello' },
    }),
    messageSending.sendAccountPrivateChatMessage({
      fromAccountId: account.profile.id,
      chat: { type: 'private', peerId: 999 },
      content: { kind: 'text', text: 'Hello' },
    }),
    messageSending.sendAccountPrivateChatMessage({
      fromAccountId: account.profile.id,
      chat: { type: 'private', peerId: bot.profile.id },
      content: { kind: 'text', text: '' },
    }),
    messageSending.sendAccountPrivateChatMessage({
      fromAccountId: account.profile.id,
      chat: { type: 'private', peerId: bot.profile.id },
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
    messages.getChatMessages({
        type: 'private',
        conversation: {
          accountId: account.profile.id,
          botId: bot.profile.id,
        },
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
    messageSending,
  } = createPrivateMessagingFixture();
  const account = createVirtualAccount(virtualUsers, { first_name: 'Ada' });
  const bot = createVirtualBot(virtualUsers, { first_name: 'Test Bot', username: 'test_bot' });
  const incomingMessage = sendPrivateText(messageSending, account.profile.id, bot);

  const replyResult = messageSending.sendPrivateChatMessage({
    fromBotId: bot.profile.id,
    chat: { type: 'private', peerId: account.profile.id },
    content: { kind: 'text', text: 'See /help' },
  });
  if (!replyResult.sent) {
    throw new Error(`Expected the bot reply to succeed, received ${replyResult.reason}`);
  }

  const reply = replyResult.message;
  if (
    reply.sender !== 'bot' ||
    reply.chat.conversation.accountId !== account.profile.id ||
    reply.chat.conversation.botId !== bot.profile.id ||
    reply.sentAtUnixSeconds !== 1_700_000_000
  ) {
    throw new Error("Expected the result to carry the bot's canonical reply with its entities");
  }
  assertEquals(getContentText(reply.content).entities, [{
    type: 'bot_command',
    offset: 4,
    length: 5,
  }], "Expected the result to carry the bot's canonical reply with its entities");
  if (
    messageBoxes.getMessageId(account.profile.id, reply.id) !== 2 ||
    messageBoxes.getMessageId(bot.profile.id, reply.id) !== 2
  ) {
    throw new Error("Expected the reply to be numbered in both participants' message boxes");
  }
  const storedMessages = messages.getChatMessages({
    type: 'private',
    conversation: {
      accountId: account.profile.id,
      botId: bot.profile.id,
    },
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
    botUpdates.confirmAndReadPendingUpdates(bot.profile.id, { limit: 100 }).length !== 1
  ) {
    throw new Error('Expected the reply to be published without becoming an update for its bot');
  }
  assertEquals(
    publishedEvents[1],
    { type: 'message_created', message: reply },
    'Expected the reply to be published without becoming an update for its bot',
  );
});

Deno.test('PrivateMessagingService validates bot messages in Telegram order before changing state', () => {
  const { virtualUsers, publishedEvents, privateMessaging, messageSending } =
    createPrivateMessagingFixture();
  const account = createVirtualAccount(virtualUsers, { first_name: 'Ada' });
  const strangerAccount = createVirtualAccount(virtualUsers, { first_name: 'Grace' });
  const bot = createVirtualBot(virtualUsers, { first_name: 'Test Bot', username: 'test_bot' });
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
    expectedReason: Extract<
      ReturnType<MessageSendingService['sendPrivateChatMessage']>,
      { readonly sent: false }
    >['reason'];
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
      replyTo: { messageId: 1, allowSendingWithoutReply: false },
      expectedReason: 'conversation_not_started',
    },
    {
      fromBotId: bot.profile.id,
      accountId: account.profile.id,
      text: tooLongText,
      replyTo: { messageId: 1, allowSendingWithoutReply: false },
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
    const result = messageSending.sendPrivateChatMessage({
      fromBotId,
      chat: { type: 'private', peerId: accountId },
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
  const { virtualUsers, messages, publishedEvents, messageDeletion, messageSending } =
    createPrivateMessagingFixture();
  const account = createVirtualAccount(virtualUsers, { first_name: 'Ada' });
  const otherAccount = createVirtualAccount(virtualUsers, { first_name: 'Grace' });
  const bot = createVirtualBot(virtualUsers, { first_name: 'Test Bot', username: 'test_bot' });
  const otherChatMessage = sendPrivateText(messageSending, otherAccount.profile.id, bot);
  const question = sendPrivateText(messageSending, account.profile.id, bot);
  const otherChatMessageId = 1;
  const questionId = 2;

  const botReply = messageSending.sendPrivateChatMessage({
    fromBotId: bot.profile.id,
    chat: { type: 'private', peerId: account.profile.id },
    replyTo: { messageId: questionId, allowSendingWithoutReply: false },
    isContentProtected: true,
    content: { kind: 'text', text: 'Hi' },
  });
  const accountReply = messageSending.sendAccountPrivateChatMessage({
    fromAccountId: account.profile.id,
    chat: { type: 'private', peerId: bot.profile.id },
    replyToMessageId: 3,
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
  const botReplyToOtherChat = messageSending.sendPrivateChatMessage({
    fromBotId: bot.profile.id,
    chat: { type: 'private', peerId: account.profile.id },
    replyTo: { messageId: otherChatMessageId, allowSendingWithoutReply: false },
    content: { kind: 'text', text: 'Hi' },
  });
  const accountReplyToMissingMessage = messageSending.sendAccountPrivateChatMessage({
    fromAccountId: account.profile.id,
    chat: { type: 'private', peerId: bot.profile.id },
    replyToMessageId: 99,
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

  messageDeletion.deletePrivateChatMessages({
    fromBotId: bot.profile.id,
    chat: { type: 'private', peerId: account.profile.id },
    messageIds: [questionId],
  });
  const replyToDeletedMessage = messageSending.sendPrivateChatMessage({
    fromBotId: bot.profile.id,
    chat: { type: 'private', peerId: account.profile.id },
    replyTo: { messageId: questionId, allowSendingWithoutReply: true },
    content: { kind: 'text', text: 'Still there?' },
  });
  if (!replyToDeletedMessage.sent || replyToDeletedMessage.message.replyToMessageId !== undefined) {
    throw new Error(
      'Expected allowSendingWithoutReply to send a reply to a deleted message as none',
    );
  }
  if (messages.findChatMessage(otherChatMessage.chat, otherChatMessage.id) !== otherChatMessage) {
    throw new Error("Expected the other chat's message to be unaffected");
  }
});

Deno.test('PrivateMessagingService shows the reply interface the latest bot message set', () => {
  const { virtualUsers, messageBoxes, replyInterfaces, messageDeletion, messageSending } =
    createPrivateMessagingFixture();
  const account = createVirtualAccount(virtualUsers, { first_name: 'Ada' });
  const bot = createVirtualBot(virtualUsers, { first_name: 'Test Bot', username: 'test_bot' });
  const chat = { accountId: account.profile.id, botId: bot.profile.id };
  sendPrivateText(messageSending, account.profile.id, bot);
  const sendWithReplyInterfaceMarkup = (replyInterfaceMarkup: ReplyInterfaceMarkup) => {
    const result = messageSending.sendPrivateChatMessage({
      fromBotId: bot.profile.id,
      chat: { type: 'private', peerId: account.profile.id },
      replyInterfaceMarkup,
      content: { kind: 'text', text: 'Choose' },
    });
    if (!result.sent) {
      throw new Error(`Expected the bot message to be sent, received ${result.reason}`);
    }
    return result.message;
  };
  const shownReplyInterface = () => {
    const result = replyInterfaces.getPrivateChatReplyInterface({
      accountId: chat.accountId,
      chat: { type: 'private', peerId: chat.botId },
    });
    if (!result.found) {
      throw new Error(`Expected the chat's reply interface, received ${result.reason}`);
    }
    return result.shownReplyInterface;
  };
  const pressButton = (text: string) =>
    replyInterfaces.pressPrivateChatReplyKeyboardButton({
      fromAccountId: account.profile.id,
      chat: { type: 'private', peerId: bot.profile.id },
      text,
    });

  const keyboardMessage = sendWithReplyInterfaceMarkup(COLOR_KEYBOARD);
  sendBotMessage(messageSending, account.profile.id, bot, YES_NO_KEYBOARD);
  if (shownReplyInterface()?.message.id !== keyboardMessage.id) {
    throw new Error('Expected the keyboard to stay shown after a message with an inline keyboard');
  }
  assertEquals(
    shownReplyInterface()?.replyInterface,
    COLOR_KEYBOARD,
    'Expected the keyboard to stay shown after a message with an inline keyboard',
  );
  const press = pressButton('Red');
  const pressOfMissingButton = pressButton('Blue');
  if (
    !press.sent || press.message.sender !== 'account' ||
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
  messageDeletion.deletePrivateChatMessages({
    fromBotId: bot.profile.id,
    chat: { type: 'private', peerId: account.profile.id },
    messageIds: [expectBotMessageId(messageBoxes, bot, replacedKeyboardMessage.id)],
  });
  if (shownReplyInterface() !== undefined) {
    throw new Error("Expected deleting the keyboard's message to clear it");
  }

  const unknownAccount = replyInterfaces.getPrivateChatReplyInterface({
    accountId: 999,
    chat: { type: 'private', peerId: bot.profile.id },
  });
  const pressForUnknownBot = replyInterfaces.pressPrivateChatReplyKeyboardButton({
    fromAccountId: account.profile.id,
    chat: { type: 'private', peerId: 999 },
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
  const { virtualUsers, messages, publishedEvents, messageSending } =
    createPrivateMessagingFixture();
  const account = createVirtualAccount(virtualUsers, { first_name: 'Ada' });
  const bot = createVirtualBot(virtualUsers, { first_name: 'Test Bot', username: 'test_bot' });
  sendPrivateText(messageSending, account.profile.id, bot);
  const send = (inlineKeyboard: InlineKeyboard) =>
    messageSending.sendPrivateChatMessage({
      fromBotId: bot.profile.id,
      chat: { type: 'private', peerId: account.profile.id },
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
  if (messages.findChatMessage(result.message.chat, result.message.id) !== result.message) {
    throw new Error('Expected the stored bot message to carry its inline keyboard');
  }
  assertEquals(
    result.message.inlineKeyboard,
    inlineKeyboard,
    'Expected the stored bot message to carry its inline keyboard',
  );
  const oversized = send([[{ kind: 'callback', text: 'Too long', callbackData: 'é'.repeat(33) }]]);
  if (oversized.sent || oversized.reason !== 'callback_data_invalid') {
    throw new Error('Expected 66 bytes of callback data to be rejected');
  }
  if (publishedEvents.length !== 2) {
    throw new Error('Expected the rejected bot message not to be stored or published');
  }
});

Deno.test('PrivateMessagingService edits the text and keyboard of a bot message', () => {
  const {
    virtualUsers,
    messageBoxes,
    publishedEvents,
    advanceClockSeconds,
    messageEditing,
    messageSending,
  } = createPrivateMessagingFixture();
  const account = createVirtualAccount(virtualUsers, { first_name: 'Ada' });
  const bot = createVirtualBot(virtualUsers, { first_name: 'Test Bot', username: 'test_bot' });
  sendPrivateText(messageSending, account.profile.id, bot);
  const botMessage = sendBotMessage(messageSending, account.profile.id, bot, YES_NO_KEYBOARD);
  const botMessageId = expectBotMessageId(messageBoxes, bot, botMessage.id);
  advanceClockSeconds(5);

  const textEdit = messageEditing.editPrivateChatMessageText({
    fromBotId: bot.profile.id,
    chat: { type: 'private', peerId: account.profile.id },
    messageId: botMessageId,
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
    textEdit.message.inlineKeyboard !== undefined
  ) {
    throw new Error('Expected a dated text edit that recomputes entities and drops the keyboard');
  }
  assertEquals(getContentText(textEdit.message.content).entities, [{
    type: 'bot_command',
    offset: 8,
    length: 4,
  }], 'Expected a dated text edit that recomputes entities and drops the keyboard');
  advanceClockSeconds(5);

  const keyboardEdit = messageEditing.editPrivateChatMessageKeyboard({
    fromBotId: bot.profile.id,
    chat: { type: 'private', peerId: account.profile.id },
    messageId: botMessageId,
    inlineKeyboard: YES_NO_KEYBOARD,
  });
  if (!keyboardEdit.edited) {
    throw new Error(`Expected the keyboard edit to succeed, received ${keyboardEdit.reason}`);
  }
  if (
    getContentText(keyboardEdit.message.content).text !== 'Chosen: /yes' ||
    keyboardEdit.message.contentEditedAtUnixSeconds !== 1_700_000_005
  ) {
    throw new Error('Expected a keyboard edit to keep the text and its edit date');
  }
  assertEquals(
    keyboardEdit.message.inlineKeyboard,
    YES_NO_KEYBOARD,
    'Expected a keyboard edit to keep the text and its edit date',
  );

  const sameTextEdit = messageEditing.editPrivateChatMessageText({
    fromBotId: bot.profile.id,
    chat: { type: 'private', peerId: account.profile.id },
    messageId: botMessageId,
    content: { kind: 'text', text: 'Chosen: /yes' },
  });
  if (
    !sameTextEdit.edited ||
    sameTextEdit.message.contentEditedAtUnixSeconds !== 1_700_000_005 ||
    sameTextEdit.message.inlineKeyboard !== undefined
  ) {
    throw new Error('Expected an unchanged text to keep its edit date while the keyboard goes');
  }
  assertEquals(publishedEvents.slice(2).map(({ type }) => type), [
    'message_edited',
    'message_edited',
    'message_edited',
  ], 'Expected each edit to publish the edited message');
});

Deno.test('PrivateMessagingService validates bot message edits in Telegram order', () => {
  const { virtualUsers, messageBoxes, messages, messageEditing, messageSending } =
    createPrivateMessagingFixture();
  const account = createVirtualAccount(virtualUsers, { first_name: 'Ada' });
  const strangerAccount = createVirtualAccount(virtualUsers, { first_name: 'Grace' });
  const otherAccount = createVirtualAccount(virtualUsers, { first_name: 'Joan' });
  const bot = createVirtualBot(virtualUsers, { first_name: 'Test Bot', username: 'test_bot' });
  const accountMessage = sendPrivateText(messageSending, account.profile.id, bot);
  const botMessage = sendBotMessage(messageSending, account.profile.id, bot, YES_NO_KEYBOARD);
  const otherChatMessage = sendPrivateText(messageSending, otherAccount.profile.id, bot);
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
    expectedReason: Extract<
      ReturnType<MessageEditingService['editPrivateChatMessageText']>,
      { readonly edited: false }
    >['reason'];
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
    const result = messageEditing.editPrivateChatMessageText({
      fromBotId,
      chat: { type: 'private', peerId: accountId },
      messageId: botMessageId,
      content: { kind: 'text', text },
      inlineKeyboard,
    });
    if (result.edited || result.reason !== expectedReason) {
      throw new Error(`Expected the edit to fail with ${expectedReason}`);
    }
  }
  const keyboardEdit = messageEditing.editPrivateChatMessageKeyboard({
    fromBotId: bot.profile.id,
    chat: { type: 'private', peerId: account.profile.id },
    messageId: botMessageId,
    inlineKeyboard: YES_NO_KEYBOARD,
  });
  if (keyboardEdit.edited || keyboardEdit.reason !== 'message_not_modified') {
    throw new Error('Expected an identical keyboard edit to be rejected as not modified');
  }
  if (messages.findChatMessage(botMessage.chat, botMessage.id) !== botMessage) {
    throw new Error('Expected rejected edits to leave the message unchanged');
  }
});

Deno.test('PrivateMessagingService refuses edits of messages with reply markup other than an inline keyboard', () => {
  const {
    virtualUsers,
    messageBoxes,
    messages,
    publishedEvents,
    replyInterfaces,
    messageEditing,
    messageSending,
  } = createPrivateMessagingFixture();
  const account = createVirtualAccount(virtualUsers, { first_name: 'Ada' });
  const bot = createVirtualBot(virtualUsers, { first_name: 'Test Bot', username: 'test_bot' });
  sendPrivateText(messageSending, account.profile.id, bot);
  const chat = { type: 'private', peerId: account.profile.id } as const;
  const sendBotText = (markup: BotMessageReplyMarkup) =>
    messageSending.sendPrivateChatMessage({
      fromBotId: bot.profile.id,
      chat,
      ...markup,
      content: { kind: 'text', text: 'Choose' },
    });
  const sendBotPhoto = (markup: BotMessageReplyMarkup) =>
    messageSending.sendPrivateChatMessage({
      fromBotId: bot.profile.id,
      chat,
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
    messageEditing.editPrivateChatMessageText({
      fromBotId: bot.profile.id,
      chat,
      messageId: botMessageId,
      content: { kind: 'text', text: 'Chosen' },
    }),
    messageEditing.editPrivateChatMessageCaption({
      fromBotId: bot.profile.id,
      chat,
      messageId: botMessageId,
      caption: 'Chosen',
      showsCaptionAboveMedia: false,
    }),
    messageEditing.editPrivateChatMessageKeyboard({
      fromBotId: bot.profile.id,
      chat,
      messageId: botMessageId,
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
        messages.findChatMessage(sent.message.chat, sent.message.id) !== sent.message ||
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
  const shown = replyInterfaces.getPrivateChatReplyInterface({
    accountId: account.profile.id,
    chat: { type: 'private', peerId: bot.profile.id },
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
  const {
    virtualUsers,
    messageBoxes,
    messages,
    publishedEvents,
    messageEditing,
    messageDeletion,
    messageSending,
  } = createPrivateMessagingFixture();
  const account = createVirtualAccount(virtualUsers, { first_name: 'Ada' });
  const otherAccount = createVirtualAccount(virtualUsers, { first_name: 'Grace' });
  const bot = createVirtualBot(virtualUsers, { first_name: 'Test Bot', username: 'test_bot' });
  const accountMessage = sendPrivateText(messageSending, account.profile.id, bot);
  const botMessage = sendBotMessage(messageSending, account.profile.id, bot, YES_NO_KEYBOARD);
  const keptMessage = sendBotMessage(messageSending, account.profile.id, bot);
  const otherChatMessage = sendPrivateText(messageSending, otherAccount.profile.id, bot);
  const accountMessageId = expectBotMessageId(messageBoxes, bot, accountMessage.id);
  const botMessageId = expectBotMessageId(messageBoxes, bot, botMessage.id);
  const otherChatMessageId = expectBotMessageId(messageBoxes, bot, otherChatMessage.id);
  const publishedEventCount = publishedEvents.length;

  const deletion = messageDeletion.deletePrivateChatMessages({
    fromBotId: bot.profile.id,
    chat: { type: 'private', peerId: account.profile.id },
    messageIds: [accountMessageId, botMessageId, botMessageId, otherChatMessageId, 999],
  });
  if (!deletion.deleted || deletion.deletedMessageCount !== 2) {
    throw new Error(
      "Expected both participants' messages to be deleted once and other IDs to be skipped",
    );
  }
  const history = messages.getChatMessages({
    type: 'private',
    conversation: {
      accountId: account.profile.id,
      botId: bot.profile.id,
    },
  });
  if (history.length !== 1 || history[0] !== keptMessage) {
    throw new Error('Expected only the undeleted message to remain in the history');
  }
  if (messages.findChatMessage(otherChatMessage.chat, otherChatMessage.id) !== otherChatMessage) {
    throw new Error("Expected a message of the bot's other chat to be kept");
  }
  if (publishedEvents.length !== publishedEventCount) {
    throw new Error('Expected deletions not to publish chat events');
  }

  const repeatedDeletion = messageDeletion.deletePrivateChatMessages({
    fromBotId: bot.profile.id,
    chat: { type: 'private', peerId: account.profile.id },
    messageIds: [botMessageId],
  });
  if (!repeatedDeletion.deleted || repeatedDeletion.deletedMessageCount !== 0) {
    throw new Error('Expected an already deleted message to be skipped');
  }
  const editOfDeletedMessage = messageEditing.editPrivateChatMessageText({
    fromBotId: bot.profile.id,
    chat: { type: 'private', peerId: account.profile.id },
    messageId: botMessageId,
    content: { kind: 'text', text: 'Done' },
  });
  if (editOfDeletedMessage.edited || editOfDeletedMessage.reason !== 'message_not_found') {
    throw new Error('Expected a deleted message not to be found for editing');
  }
  const nextMessage = sendPrivateText(messageSending, account.profile.id, bot);
  if (
    expectBotMessageId(messageBoxes, bot, nextMessage.id) !== otherChatMessageId + 1 ||
    expectBotMessageId(messageBoxes, bot, botMessage.id) !== botMessageId
  ) {
    throw new Error('Expected deleted messages to keep their IDs, which are never reused');
  }
});

Deno.test('PrivateMessagingService validates message deletions before changing state', () => {
  const { virtualUsers, messageBoxes, messages, messageDeletion, messageSending } =
    createPrivateMessagingFixture();
  const account = createVirtualAccount(virtualUsers, { first_name: 'Ada' });
  const strangerAccount = createVirtualAccount(virtualUsers, { first_name: 'Grace' });
  const bot = createVirtualBot(virtualUsers, { first_name: 'Test Bot', username: 'test_bot' });
  const message = sendPrivateText(messageSending, account.profile.id, bot);
  const botMessageId = expectBotMessageId(messageBoxes, bot, message.id);
  const cases: {
    fromBotId: number;
    accountId: number;
    expectedReason: Extract<
      ReturnType<MessageDeletionService['deletePrivateChatMessages']>,
      { readonly deleted: false }
    >['reason'];
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
    const result = messageDeletion.deletePrivateChatMessages({
      fromBotId,
      chat: { type: 'private', peerId: accountId },
      messageIds: [botMessageId],
    });
    if (result.deleted || result.reason !== expectedReason) {
      throw new Error(`Expected the deletion to fail with ${expectedReason}`);
    }
  }
  if (messages.findChatMessage(message.chat, message.id) !== message) {
    throw new Error('Expected rejected deletions to keep the message');
  }
});

Deno.test('PrivateMessagingService normalizes bot text and entities as Telegram does', () => {
  const { virtualUsers, messageSending } = createPrivateMessagingFixture();
  const account = createVirtualAccount(virtualUsers, { first_name: 'Ada' });
  const bot = createVirtualBot(virtualUsers, { first_name: 'Test Bot', username: 'test_bot' });
  sendPrivateText(messageSending, account.profile.id, bot);

  const result = messageSending.sendPrivateChatMessage({
    fromBotId: bot.profile.id,
    chat: { type: 'private', peerId: account.profile.id },
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
  const expectedEntities: readonly TextEntity[] = [
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
  if (getContentText(result.message.content).text !== 'Hi Ada, see site /help') {
    throw new Error(
      `Expected normalized text and entities, received ${JSON.stringify(result.message)}`,
    );
  }
  assertEquals(
    getContentText(result.message.content).entities,
    expectedEntities,
    'Expected normalized text and entities',
  );
});

Deno.test('PrivateMessagingService rejects bot text Telegram cannot normalize after the chat check', () => {
  const { virtualUsers, publishedEvents, messageSending } = createPrivateMessagingFixture();
  const account = createVirtualAccount(virtualUsers, { first_name: 'Ada' });
  const strangerAccount = createVirtualAccount(virtualUsers, { first_name: 'Grace' });
  const bot = createVirtualBot(virtualUsers, { first_name: 'Test Bot', username: 'test_bot' });
  sendPrivateText(messageSending, account.profile.id, bot);
  const send = (accountId: number, text: string, entities: readonly TextEntity[] = []) =>
    messageSending.sendPrivateChatMessage({
      fromBotId: bot.profile.id,
      chat: { type: 'private', peerId: accountId },
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
  const { virtualUsers, messageEditing, messageSending } = createPrivateMessagingFixture();
  const account = createVirtualAccount(virtualUsers, { first_name: 'Ada' });
  const bot = createVirtualBot(virtualUsers, { first_name: 'Test Bot', username: 'test_bot' });
  sendPrivateText(messageSending, account.profile.id, bot);
  const send = (text: string, entities: readonly TextEntity[] = []) =>
    messageSending.sendPrivateChatMessage({
      fromBotId: bot.profile.id,
      chat: { type: 'private', peerId: account.profile.id },
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
    !formatted.sent ||
    formatted.message.content.kind !== 'text' ||
    formatted.message.content.text !== emojiText
  ) {
    throw new Error('Expected formatted text to be limited after it is trimmed');
  }
  assertEquals(formatted.message.content.entities, [{
    type: 'bold',
    offset: 0,
    length: emojiText.length,
  }], 'Expected formatted text to be limited after it is trimmed');

  const edited = messageEditing.editPrivateChatMessageText({
    fromBotId: bot.profile.id,
    chat: { type: 'private', peerId: account.profile.id },
    messageId: 2,
    content: { kind: 'text', text: `${'😀'.repeat(MAX_TEXT_MESSAGE_LENGTH - 1)}a` },
  });
  if (!edited.edited) {
    throw new Error(
      `Expected an edit to the character limit to succeed, received ${edited.reason}`,
    );
  }
});

Deno.test('PrivateMessagingService normalizes account text as a Telegram client does', () => {
  const { virtualUsers, publishedEvents, messageSending } = createPrivateMessagingFixture();
  const account = createVirtualAccount(virtualUsers, { first_name: 'Ada' });
  const bot = createVirtualBot(virtualUsers, { first_name: 'Test Bot', username: 'test_bot' });
  const send = (text: string) =>
    messageSending.sendAccountPrivateChatMessage({
      fromAccountId: account.profile.id,
      chat: { type: 'private', peerId: bot.profile.id },
      content: { kind: 'text', text },
    });

  const result = send('  /start\r\n');
  if (
    !result.sent ||
    getContentText(result.message.content).text !== '/start'
  ) {
    throw new Error(`Expected trimmed text with its command, received ${JSON.stringify(result)}`);
  }
  assertEquals(getContentText(result.message.content).entities, [{
    type: 'bot_command',
    offset: 0,
    length: 6,
  }], 'Expected trimmed text with its command');
  const blankResult = send(' \n ');
  if (
    blankResult.sent || blankResult.reason !== 'text_invalid' ||
    blankResult.textError !== 'Text must be non-empty' || publishedEvents.length !== 1
  ) {
    throw new Error(`Expected blank text to be rejected, received ${JSON.stringify(blankResult)}`);
  }
});

Deno.test('PrivateMessagingService treats changed entities as an edit of the text', () => {
  const { virtualUsers, messageBoxes, advanceClockSeconds, messageEditing, messageSending } =
    createPrivateMessagingFixture();
  const account = createVirtualAccount(virtualUsers, { first_name: 'Ada' });
  const bot = createVirtualBot(virtualUsers, { first_name: 'Test Bot', username: 'test_bot' });
  sendPrivateText(messageSending, account.profile.id, bot);
  const botMessage = sendBotMessage(messageSending, account.profile.id, bot);
  const botMessageId = expectBotMessageId(messageBoxes, bot, botMessage.id);
  const editText = (entities: readonly TextEntity[]) =>
    messageEditing.editPrivateChatMessageText({
      fromBotId: bot.profile.id,
      chat: { type: 'private', peerId: account.profile.id },
      messageId: botMessageId,
      content: { kind: 'text', text: getContentText(botMessage.content).text, entities },
    });
  advanceClockSeconds(5);

  const boldEdit = editText([{ type: 'bold', offset: 0, length: 8 }]);
  if (
    !boldEdit.edited ||
    boldEdit.message.contentEditedAtUnixSeconds !== 1_700_000_005
  ) {
    throw new Error(
      `Expected formatting alone to be a dated edit, received ${JSON.stringify(boldEdit)}`,
    );
  }
  assertEquals(getContentText(boldEdit.message.content).entities, [{
    type: 'bold',
    offset: 0,
    length: 8,
  }], 'Expected formatting alone to be a dated edit');
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
  const { virtualUsers, publishedEvents, privateMessaging, messageSending } =
    createPrivateMessagingFixture();
  const account = createVirtualAccount(virtualUsers, { first_name: 'Ada' });
  const strangerAccount = createVirtualAccount(virtualUsers, { first_name: 'Grace' });
  const bot = createVirtualBot(virtualUsers, { first_name: 'Test Bot', username: 'test_bot' });
  sendPrivateText(messageSending, account.profile.id, bot);
  const checkAccess = (fromBotId: number, accountId: number) =>
    privateMessaging.checkBotChatActionAccess({
      fromBotId,
      to: { type: 'private', accountId },
    });

  const cases = [
    [checkAccess(bot.profile.id, account.profile.id), undefined],
    [checkAccess(999, account.profile.id), 'bot_not_found'],
    [checkAccess(bot.profile.id, 999), 'account_not_found'],
    [checkAccess(bot.profile.id, strangerAccount.profile.id), 'conversation_not_started'],
  ] as const;
  for (const [result, expectedReason] of cases) {
    const reason = result.allowed ? undefined : result.reason;
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
  const { virtualUsers, files, botUpdates, messageSending } = createPrivateMessagingFixture();
  const account = createVirtualAccount(virtualUsers, { first_name: 'Ada' });
  const bot = createVirtualBot(virtualUsers, { first_name: 'Test Bot', username: 'test_bot' });

  const accountPhoto = messageSending.sendAccountPrivateChatMessage({
    fromAccountId: account.profile.id,
    chat: { type: 'private', peerId: bot.profile.id },
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
    photoUpdate === undefined ||
    !('photo' in photoUpdate) ||
    photoUpdate.photo[0].file_unique_id !== storedPhoto.uniqueId ||
    photoUpdate.photo[0].width !== 4 ||
    photoUpdate.caption !== '/start now'
  ) {
    throw new Error(
      `Expected the bot to receive the captioned photo, received ${JSON.stringify(photoUpdate)}`,
    );
  }
  assertEquals(accountPhoto.message.content.caption, {
    text: '/start now',
    entities: [{ type: 'bot_command', offset: 0, length: 6 }],
  }, 'Expected the bot to receive the captioned photo');

  const botDocument = messageSending.sendPrivateChatMessage({
    fromBotId: bot.profile.id,
    chat: { type: 'private', peerId: account.profile.id },
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
  const reusedPhoto = messageSending.sendPrivateChatMessage({
    fromBotId: bot.profile.id,
    chat: { type: 'private', peerId: account.profile.id },
    content: {
      kind: 'photo',
      photo: { kind: 'stored', file: storedPhoto },
      caption: ' \n ',
      hasSpoiler: true,
      showsCaptionAboveMedia: true,
    },
  });
  if (
    !botDocument.sent ||
    botDocument.message.content.kind !== 'document' ||
    files.getFile(botDocument.message.content.fileId)?.type !== 'document' ||
    !reusedPhoto.sent
  ) {
    throw new Error('Expected the bot to send an uploaded document and a stored photo');
  }
  assertEquals(botDocument.message.content.caption.entities, [{
    type: 'bold',
    offset: 0,
    length: 6,
  }], 'Expected the bot to send an uploaded document and a stored photo');
  assertEquals(reusedPhoto.message.content, {
    kind: 'photo',
    fileId: storedPhoto.id,
    caption: { text: '', entities: [] },
    hasSpoiler: true,
    showsCaptionAboveMedia: true,
  }, 'Expected the bot to send an uploaded document and a stored photo');
});

Deno.test('PrivateMessagingService limits captions and stores no upload of a refused message', () => {
  const { virtualUsers, storedUploads, messageSending } = createPrivateMessagingFixture();
  const account = createVirtualAccount(virtualUsers, { first_name: 'Ada' });
  const bot = createVirtualBot(virtualUsers, { first_name: 'Test Bot', username: 'test_bot' });
  sendPrivateText(messageSending, account.profile.id, bot);
  const sendCaptionedPhoto = (caption: string) =>
    messageSending.sendPrivateChatMessage({
      fromBotId: bot.profile.id,
      chat: { type: 'private', peerId: account.profile.id },
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

  const unknownChatPhoto = messageSending.sendPrivateChatMessage({
    fromBotId: bot.profile.id,
    chat: { type: 'private', peerId: 999 },
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
  const { virtualUsers, messages, messageBoxes, botUpdates, messageSending } =
    createPrivateMessagingFixture();
  const account = createVirtualAccount(virtualUsers, { first_name: 'Ada' });
  const bot = createVirtualBot(virtualUsers, { first_name: 'Test Bot', username: 'test_bot' });

  const accountAlbum = messageSending.sendAccountPrivateChatAlbum({
    fromAccountId: account.profile.id,
    chat: { type: 'private', peerId: bot.profile.id },
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
    accountAlbum.messages.length !== 2 ||
    firstPhoto.mediaGroupId === undefined ||
    secondPhoto.mediaGroupId !== firstPhoto.mediaGroupId ||
    getContentText(secondPhoto.content).text !== '/second' ||
    updates.some((update) => update?.media_group_id !== firstPhoto.mediaGroupId)
  ) {
    throw new Error(
      `Expected the bot to receive the album in order, received ${JSON.stringify(updates)}`,
    );
  }
  assertEquals(
    updates.map((update) => update?.message_id),
    [1, 2],
    'Expected the bot to receive the album in order',
  );

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
  const botAlbum = messageSending.sendPrivateChatAlbum({
    fromBotId: bot.profile.id,
    chat: { type: 'private', peerId: account.profile.id },
    contents: [document('a.txt'), document('b.txt')],
    replyTo: {
      messageId: expectBotMessageId(messageBoxes, bot, secondPhoto.id),
      allowSendingWithoutReply: false,
    },
    isSilent: true,
    messageEffectId: '5104841245755180586',
  });
  const singleAlbum = messageSending.sendPrivateChatAlbum({
    fromBotId: bot.profile.id,
    chat: { type: 'private', peerId: account.profile.id },
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
  assertEquals(
    messages.getChatMessages({
      type: 'private',
      conversation: {
        accountId: account.profile.id,
        botId: bot.profile.id,
      },
    }).map((message) => message.id),
    [...accountAlbum.messages, ...botAlbum.messages, ...singleAlbum.messages]
      .map((message) => message.id),
    'Expected the history to hold the albums in order',
  );
});

Deno.test('PrivateMessagingService checks every message of an album before storing any', () => {
  const { virtualUsers, messages, storedUploads, publishedEvents, blockedUsers, messageSending } =
    createPrivateMessagingFixture();
  const account = createVirtualAccount(virtualUsers, { first_name: 'Ada' });
  const bot = createVirtualBot(virtualUsers, { first_name: 'Test Bot', username: 'test_bot' });
  sendPrivateText(messageSending, account.profile.id, bot);
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
    messageSending.sendPrivateChatAlbum({
      fromBotId: bot.profile.id,
      chat: { type: 'private', peerId: account.profile.id },
      contents,
    });
  const storedState = () => ({
    uploads: storedUploads.length,
    events: publishedEvents.length,
    history: messages.getChatMessages({
      type: 'private',
      conversation: {
        accountId: account.profile.id,
        botId: bot.profile.id,
      },
    }).length,
  });
  const stateBefore = storedState();

  const failures = [
    sendBotAlbum([photo('Fits'), photo('x'.repeat(MAX_CAPTION_LENGTH + 1))]),
    sendBotAlbum([]),
    sendBotAlbum(Array.from({ length: 11 }, () => photo(''))),
    sendBotAlbum([photo('', true), photo('')]),
    sendBotAlbum([photo(''), document]),
    messageSending.sendAccountPrivateChatAlbum({
      fromAccountId: account.profile.id,
      chat: { type: 'private', peerId: bot.profile.id },
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
  assertEquals(failures, [
    'caption_too_long',
    'album_empty',
    'album_too_large',
    'album_caption_placement_mixed',
    'album_documents_mixed',
    'album_documents_mixed',
    'bot_blocked',
  ], 'Expected each album to be refused');
  assertEquals(
    storedState(),
    stateBefore,
    'Expected refused albums to store no message, upload, or event',
  );
});

Deno.test('PrivateMessagingService stores the uploads of rich messages only once they are sent or edited', () => {
  const { virtualUsers, storedUploads, advanceClockSeconds, messageEditing, messageSending } =
    createPrivateMessagingFixture();
  const account = createVirtualAccount(virtualUsers, { first_name: 'Ada' });
  const bot = createVirtualBot(virtualUsers, { first_name: 'Test Bot', username: 'test_bot' });
  const chat = { type: 'private', peerId: account.profile.id } as const;
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

  const sendBeforeStart = messageSending.sendPrivateChatMessage({
    fromBotId: bot.profile.id,
    chat,
    content: richMessageWithPhoto,
  });
  sendPrivateText(messageSending, account.profile.id, bot);
  const sent = messageSending.sendPrivateChatMessage({
    fromBotId: bot.profile.id,
    chat,
    content: { kind: 'text', text: 'Draft' },
  });
  if (sendBeforeStart.sent || !sent.sent || storedUploads.length !== 0) {
    throw new Error('Expected a refused rich message to store no upload');
  }
  const botMessageId = 2;

  const refusedEdit = messageEditing.editPrivateChatMessageText({
    fromBotId: bot.profile.id,
    chat,
    messageId: botMessageId,
    content: richMessageWithPhoto,
    inlineKeyboard: [[{ kind: 'callback', text: 'Go', callbackData: 'x'.repeat(65) }]],
  });
  advanceClockSeconds(5);
  const edit = messageEditing.editPrivateChatMessageText({
    fromBotId: bot.profile.id,
    chat,
    messageId: botMessageId,
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
  const {
    virtualUsers,
    messageBoxes,
    botUpdates,
    advanceClockSeconds,
    messageEditing,
    messageSending,
  } = createPrivateMessagingFixture();
  const account = createVirtualAccount(virtualUsers, { first_name: 'Ada' });
  const bot = createVirtualBot(virtualUsers, { first_name: 'Test Bot', username: 'test_bot' });
  sendPrivateText(messageSending, account.profile.id, bot);
  const botText = messageSending.sendPrivateChatMessage({
    fromBotId: bot.profile.id,
    chat: { type: 'private', peerId: account.profile.id },
    content: { kind: 'text', text: 'Hi' },
  });
  const photo = messageSending.sendPrivateChatMessage({
    fromBotId: bot.profile.id,
    chat: { type: 'private', peerId: account.profile.id },
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
    messageEditing.editPrivateChatMessageCaption({
      fromBotId: bot.profile.id,
      chat: { type: 'private', peerId: chat.accountId },
      messageId: botMessageId,
      caption,
      showsCaptionAboveMedia,
    });
  advanceClockSeconds(5);

  const textEdit = messageEditing.editPrivateChatMessageText({
    fromBotId: bot.profile.id,
    chat: { type: 'private', peerId: chat.accountId },
    messageId: photoId,
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

  const accountDocument = messageSending.sendAccountPrivateChatMessage({
    fromAccountId: account.profile.id,
    chat: { type: 'private', peerId: bot.profile.id },
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
    edit: Parameters<typeof messageEditing.editAccountPrivateChatMessage>[0]['edit'],
  ) =>
    messageEditing.editAccountPrivateChatMessage({
      fromAccountId: account.profile.id,
      chat: { type: 'private', peerId: bot.profile.id },
      messageId: documentId,
      edit,
    });
  const accountTextEdit = editAccountMessage({ kind: 'text', text: 'Notes' });
  const unchangedCaption = editAccountMessage({ kind: 'caption', caption: ' Notes ' });
  const accountCaptionEdit = editAccountMessage({ kind: 'caption', caption: '/help notes' });
  const updates = botUpdates.confirmAndReadPendingUpdates(bot.profile.id, { limit: 100 });
  const editUpdate = updates.at(-1);
  if (
    accountTextEdit.edited ||
    accountTextEdit.reason !== 'message_has_no_text' ||
    unchangedCaption.edited ||
    unchangedCaption.reason !== 'message_not_modified' ||
    !accountCaptionEdit.edited ||
    editUpdate === undefined ||
    !('edited_message' in editUpdate) ||
    !('document' in editUpdate.edited_message) ||
    editUpdate.edited_message.caption !== '/help notes'
  ) {
    throw new Error(
      `Expected the account caption edit to reach the bot, received ${JSON.stringify(updates)}`,
    );
  }
  assertEqualsInFieldOrder(editUpdate.edited_message.caption_entities, [{
    type: 'bot_command',
    offset: 0,
    length: 5,
  }], 'Expected the account caption edit to reach the bot');
});

Deno.test('PrivateMessagingService edits the text of an account message and publishes the edit', () => {
  const {
    virtualUsers,
    messageBoxes,
    botUpdates,
    publishedEvents,
    advanceClockSeconds,
    messageEditing,
    messageSending,
  } = createPrivateMessagingFixture();
  const account = createVirtualAccount(virtualUsers, { first_name: 'Ada' });
  const bot = createVirtualBot(virtualUsers, { first_name: 'Test Bot', username: 'test_bot' });
  const accountMessage = sendPrivateText(messageSending, account.profile.id, bot);
  const botMessageId = expectBotMessageId(messageBoxes, bot, accountMessage.id);
  advanceClockSeconds(5);

  const result = messageEditing.editAccountPrivateChatMessage({
    fromAccountId: account.profile.id,
    chat: { type: 'private', peerId: bot.profile.id },
    messageId: botMessageId,
    edit: { kind: 'text', text: '  Hello /help  ' },
  });
  if (!result.edited) {
    throw new Error(`Expected the edit to succeed, received ${result.reason}`);
  }
  if (
    result.message.id !== accountMessage.id ||
    result.message.sentAtUnixSeconds !== 1_700_000_000 ||
    result.message.contentEditedAtUnixSeconds !== 1_700_000_005 ||
    getContentText(result.message.content).text !== 'Hello /help'
  ) {
    throw new Error('Expected a dated edit whose text is normalized as when sending');
  }
  assertEquals(getContentText(result.message.content).entities, [{
    type: 'bot_command',
    offset: 6,
    length: 5,
  }], 'Expected a dated edit whose text is normalized as when sending');
  assertEquals(
    publishedEvents.at(-1),
    { type: 'message_edited', message: result.message },
    'Expected the edit to be published',
  );
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
  const { virtualUsers, messageBoxes, messages, publishedEvents, messageEditing, messageSending } =
    createPrivateMessagingFixture();
  const account = createVirtualAccount(virtualUsers, { first_name: 'Ada' });
  const otherAccount = createVirtualAccount(virtualUsers, { first_name: 'Grace' });
  const bot = createVirtualBot(virtualUsers, { first_name: 'Test Bot', username: 'test_bot' });
  const accountMessage = sendPrivateText(messageSending, account.profile.id, bot);
  const otherChatMessage = sendPrivateText(messageSending, otherAccount.profile.id, bot);
  const botMessage = sendBotMessage(messageSending, account.profile.id, bot);
  const accountMessageId = expectBotMessageId(messageBoxes, bot, accountMessage.id);
  const editAccountMessage = (
    { fromAccountId = account.profile.id, botId = bot.profile.id, botMessageId, text = 'Edited' }: {
      fromAccountId?: number;
      botId?: number;
      botMessageId: number;
      text?: string;
    },
  ) =>
    messageEditing.editAccountPrivateChatMessage({
      fromAccountId,
      chat: { type: 'private', peerId: botId },
      messageId: botMessageId,
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
    messages.findChatMessage(accountMessage.chat, accountMessage.id) !== accountMessage ||
    publishedEvents.length !== publishedEventCount
  ) {
    throw new Error('Expected rejected edits to leave the message unchanged and unpublished');
  }
});

Deno.test('PrivateMessagingService refuses writing either way while the account blocks the bot', () => {
  const {
    virtualUsers,
    messageBoxes,
    blockedUsers,
    publishedEvents,
    privateMessaging,
    messageEditing,
    messageSending,
  } = createPrivateMessagingFixture();
  const account = createVirtualAccount(virtualUsers, { first_name: 'Ada' });
  const bot = createVirtualBot(virtualUsers, { first_name: 'Test Bot', username: 'test_bot' });
  const accountMessage = sendPrivateText(messageSending, account.profile.id, bot);
  const botMessage = sendBotMessage(messageSending, account.profile.id, bot);
  blockedUsers.block(account.profile.id, bot.profile.id);
  const publishedEventCount = publishedEvents.length;
  const sendBotText = (text: string, replyToBotMessageId?: number) =>
    messageSending.sendPrivateChatMessage({
      fromBotId: bot.profile.id,
      chat: { type: 'private', peerId: account.profile.id },
      replyTo: replyToBotMessageId === undefined
        ? undefined
        : { messageId: replyToBotMessageId, allowSendingWithoutReply: false },
      content: { kind: 'text', text },
    });

  const cases = [
    [
      messageSending.sendAccountPrivateChatMessage({
        fromAccountId: account.profile.id,
        chat: { type: 'private', peerId: bot.profile.id },
        content: { kind: 'text', text: 'Hello again' },
      }),
      'bot_blocked',
    ],
    [sendBotText('Still there?'), 'bot_blocked'],
    // Telegram's servers refuse the message only after every other check passed.
    [sendBotText(''), 'message_text_empty'],
    [sendBotText('Still there?', 99), 'reply_message_not_found'],
  ] as const;
  for (const [result, expectedReason] of cases) {
    if (result.sent || result.reason !== expectedReason) {
      throw new Error(`Expected ${expectedReason}, received ${JSON.stringify(result)}`);
    }
  }
  const chatActionAccess = privateMessaging.checkBotChatActionAccess({
    fromBotId: bot.profile.id,
    to: { type: 'private', accountId: account.profile.id },
  });
  if (chatActionAccess.allowed || chatActionAccess.reason !== 'bot_blocked') {
    throw new Error(`Expected bot_blocked, received ${JSON.stringify(chatActionAccess)}`);
  }
  if (publishedEvents.length !== publishedEventCount) {
    throw new Error('Expected refused messages not to be stored or published');
  }

  const botEdit = messageEditing.editPrivateChatMessageText({
    fromBotId: bot.profile.id,
    chat: { type: 'private', peerId: account.profile.id },
    messageId: expectBotMessageId(messageBoxes, bot, botMessage.id),
    content: { kind: 'text', text: 'Goodbye' },
  });
  const accountEdit = messageEditing.editAccountPrivateChatMessage({
    fromAccountId: account.profile.id,
    chat: { type: 'private', peerId: bot.profile.id },
    messageId: expectBotMessageId(messageBoxes, bot, accountMessage.id),
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

Deno.test('PrivateMessagingService checks the account, bot, and block alike on every account send', () => {
  const { virtualUsers, privateConversations, blockedUsers, publishedEvents, messageSending } =
    createPrivateMessagingFixture();
  const account = createVirtualAccount(virtualUsers, { first_name: 'Ada' });
  const bot = createVirtualBot(virtualUsers, { first_name: 'Test Bot', username: 'test_bot' });
  const blockingAccount = createVirtualAccount(virtualUsers, { first_name: 'Grace' });
  blockedUsers.block(blockingAccount.profile.id, bot.profile.id);
  const sendFromEveryAccountPath = (fromAccountId: number, botId: number) =>
    [
      messageSending.sendAccountPrivateChatMessage({
        fromAccountId,
        chat: { type: 'private', peerId: botId },
        content: { kind: 'text', text: 'Hello' },
      }),
      messageSending.sendAccountPrivateChatAlbum({
        fromAccountId,
        chat: { type: 'private', peerId: botId },
        contents: [{ kind: 'media', upload: photoUpload(), caption: '' }],
      }),
      messageSending.sendAccountPrivateChatInlineResult({
        fromAccountId,
        chat: { type: 'private', peerId: botId },
        viaBotId: bot.profile.id,
        content: { kind: 'text', text: 'Result', entities: [] },
      }),
      messageSending.sendAccountPrivateChatForward({
        fromAccountId,
        chat: { type: 'private', peerId: botId },
        forward: {
          content: { kind: 'text', text: 'Forwarded', entities: [] },
          forwardInfo: {
            originalSender: { kind: 'user', userId: account.profile.id },
            originalSentAtUnixSeconds: 0,
          },
        },
      }),
    ].map((result) => result.sent ? 'sent' : result.reason);

  const received = [
    sendFromEveryAccountPath(999, 999),
    sendFromEveryAccountPath(account.profile.id, 999),
    sendFromEveryAccountPath(blockingAccount.profile.id, bot.profile.id),
  ];
  const expected = [
    Array(4).fill('account_not_found'),
    Array(4).fill('bot_not_found'),
    Array(4).fill('bot_blocked'),
  ];
  assertEquals(received, expected, 'Expected sender checks in order');
  if (
    privateConversations.getPrivateConversation({
        accountId: blockingAccount.profile.id,
        botId: bot.profile.id,
      }) !== undefined || publishedEvents.length !== 0
  ) {
    throw new Error('Expected refused sends to start no conversation and publish nothing');
  }
});

Deno.test('PrivateMessagingService lets a join request contact grant send messages without starting the chat', () => {
  const {
    virtualUsers,
    privateConversations,
    messages,
    messageBoxes,
    blockedUsers,
    joinRequesterGrants,
    publishedEvents,
    privateMessaging,
    messageEditing,
    messageDeletion,
    messageSending,
  } = createPrivateMessagingFixture();
  const account = createVirtualAccount(virtualUsers, { first_name: 'Grace' });
  const bot = createVirtualBot(virtualUsers, {
    first_name: 'Gatekeeper',
    username: 'gatekeeper_bot',
  });
  const accountId = account.profile.id;
  const conversation = { accountId, botId: bot.profile.id };
  const to = { type: 'private', accountId } as const;
  const chat = { type: 'private', peerId: accountId } as const;
  const sendText = (text: string) =>
    messageSending.sendPrivateChatMessage({
      fromBotId: bot.profile.id,
      chat,
      content: { kind: 'text', text },
      inlineKeyboard: YES_NO_KEYBOARD,
    });
  const describeSend = (result: ReturnType<MessageSendingService['sendPrivateChatMessage']>) =>
    result.sent ? getContentText(result.message.content).text : result.reason;

  const withoutGrant = describeSend(sendText('Solve this'));
  joinRequesterGrants.contactableBotIdsByAccountId.set(accountId, new Set([bot.profile.id]));
  blockedUsers.block(accountId, bot.profile.id);
  const whileBlocked = describeSend(sendText('Solve this'));
  blockedUsers.unblock(accountId, bot.profile.id);
  const eventCountBeforeGrantedSends = publishedEvents.length;
  const prompt = sendText('Solve this');
  const album = messageSending.sendPrivateChatAlbum({
    fromBotId: bot.profile.id,
    chat,
    contents: [photoMedia(), photoMedia()],
  });

  assertEquals(
    [
      withoutGrant,
      whileBlocked,
      describeSend(prompt),
      album.sent ? album.messages.length : album.reason,
      joinRequesterGrants.claims,
      publishedEvents.length - eventCountBeforeGrantedSends,
      messages.getChatMessages({ type: 'private', conversation }).length,
      privateConversations.getPrivateConversation(conversation) !== undefined,
      privateMessaging.isPrivateConversationStarted(conversation),
    ],
    [
      'conversation_not_started',
      'bot_blocked',
      'Solve this',
      2,
      [[bot.profile.id, accountId], [bot.profile.id, accountId]],
      3,
      3,
      true,
      false,
    ],
    'Expected only the granted, unblocked sends to be stored and claim the contact, opening an unstarted chat',
  );

  // The grant covers sending messages only: the bot reaches nothing else in the unstarted chat.
  if (!prompt.sent) {
    throw new Error('Expected the prompt to be sent');
  }
  const promptId = expectBotMessageId(messageBoxes, bot, prompt.message.id);
  const edit = messageEditing.editPrivateChatMessageText({
    fromBotId: bot.profile.id,
    chat: { type: 'private', peerId: to.accountId },
    messageId: promptId,
    content: { kind: 'text', text: 'Solved' },
  });
  const deletion = messageDeletion.deletePrivateChatMessages({
    fromBotId: bot.profile.id,
    chat: { type: 'private', peerId: to.accountId },
    messageIds: [promptId],
  });
  const chatActionAccess = privateMessaging.checkBotChatActionAccess({
    fromBotId: bot.profile.id,
    to,
  });
  joinRequesterGrants.contactableBotIdsByAccountId.delete(accountId);
  const afterGrant = describeSend(sendText('Still there?'));

  assertEquals(
    [
      edit.edited ? 'edited' : edit.reason,
      deletion.deleted ? 'deleted' : deletion.reason,
      chatActionAccess.allowed ? 'allowed' : chatActionAccess.reason,
      afterGrant,
    ],
    [
      'conversation_not_started',
      'conversation_not_started',
      'conversation_not_started',
      'conversation_not_started',
    ],
    'Expected the unstarted chat to refuse edits, deletions, actions, and sends once the grant ended',
  );

  // The account's reply starts the chat, which the bot then reaches without the grant.
  sendPrivateText(messageSending, accountId, bot);
  const afterReply = describeSend(sendText('Welcome'));

  assertEquals(
    [
      afterReply,
      joinRequesterGrants.claims.length,
      privateMessaging.isPrivateConversationStarted(conversation),
    ],
    ['Welcome', 2, true],
    "Expected the account's reply to start the chat, so the bot's later send claims nothing",
  );
});

Deno.test('PrivateMessagingService shares chosen users as a service message of the account', () => {
  const { virtualUsers, botUpdates, publishedEvents, replyInterfaces, messageSending } =
    createPrivateMessagingFixture();
  const account = createVirtualAccount(virtualUsers, { first_name: 'Ada' });
  const grace = createVirtualAccount(virtualUsers, { first_name: 'Grace' });
  const bot = createVirtualBot(virtualUsers, { first_name: 'Test Bot', username: 'test_bot' });
  sendPrivateText(messageSending, account.profile.id, bot);
  const keyboard = messageSending.sendPrivateChatMessage({
    fromBotId: bot.profile.id,
    chat: { type: 'private', peerId: account.profile.id },
    replyInterfaceMarkup: {
      kind: 'reply_keyboard',
      rows: [[
        {
          text: 'Friends',
          request: {
            kind: 'users',
            requestId: 3,
            maxQuantity: 1,
            requestsName: true,
            requestsUsername: false,
            requestsPhoto: false,
          },
        },
        {
          text: 'Group',
          request: {
            kind: 'chat',
            requestId: 4,
            chatIsChannel: false,
            chatIsCreated: false,
            botIsMember: false,
            requestsTitle: false,
            requestsUsername: false,
            requestsPhoto: false,
          },
        },
        { text: 'Plain' },
      ]],
      isPersistent: false,
      resizesToFit: false,
      isOneTime: false,
      isSelective: false,
    },
    content: { kind: 'text', text: 'Choose' },
  });
  if (!keyboard.sent) {
    throw new Error(`Expected the keyboard to be sent, received ${keyboard.reason}`);
  }
  const eventCountBeforePresses = publishedEvents.length;
  const press = (text: string, answer?: ReplyKeyboardRequestAnswer) =>
    replyInterfaces.pressPrivateChatReplyKeyboardButton({
      fromAccountId: account.profile.id,
      chat: { type: 'private', peerId: bot.profile.id },
      text,
      ...(answer === undefined ? {} : { answer }),
    });
  const graceAnswer: ReplyKeyboardRequestAnswer = { kind: 'users', userIds: [grace.profile.id] };
  const refusals: Array<
    [ReturnType<ReplyInterfaceService['pressPrivateChatReplyKeyboardButton']>, string]
  > = [
    [press('Friends'), 'reply_keyboard_button_answer_missing'],
    [press('Group'), 'reply_keyboard_button_answer_missing'],
    [press('Plain', graceAnswer), 'reply_keyboard_button_answer_not_requested'],
    [
      press('Friends', { kind: 'chat', chatId: -1_000_000_000_001 }),
      'reply_keyboard_button_answer_not_requested',
    ],
    [press('Group', { kind: 'chat', chatId: -1_000_000_000_001 }), 'shared_chat_not_found'],
    [
      press('Friends', { kind: 'users', userIds: [grace.profile.id, account.profile.id] }),
      'shared_users_too_many',
    ],
  ];
  for (const [result, expectedReason] of refusals) {
    if (result.sent || result.reason !== expectedReason) {
      throw new Error(`Expected ${expectedReason}, received ${JSON.stringify(result)}`);
    }
  }
  if (publishedEvents.length !== eventCountBeforePresses) {
    throw new Error('Expected refused presses to publish nothing');
  }

  const shared = press('Friends', graceAnswer);
  if (!shared.sent) {
    throw new Error(`Expected the users to be shared, received ${shared.reason}`);
  }
  const expectedContent: PrivateMessageContent = {
    kind: 'users_shared',
    requestId: 3,
    users: [{ userId: grace.profile.id, firstName: 'Grace' }],
  };
  if (
    shared.message.sender !== 'account' ||
    shared.message.replyToMessageId !== undefined
  ) {
    throw new Error(
      `Expected a service message of the account, received ${JSON.stringify(shared)}`,
    );
  }
  assertEquals(
    shared.message.content,
    expectedContent,
    'Expected a service message of the account',
  );
  const sharedMessage = messageFromUpdate(
    botUpdates.confirmAndReadPendingUpdates(bot.profile.id, { limit: 100 }).at(-1),
  );
  if (
    sharedMessage === undefined ||
    !('users_shared' in sharedMessage)
  ) {
    throw new Error(
      `Expected the bot to receive the shared user: ${JSON.stringify(sharedMessage)}`,
    );
  }
  assertEqualsInFieldOrder(sharedMessage.users_shared, {
    user_ids: [grace.profile.id],
    users: [{ user_id: grace.profile.id, first_name: 'Grace' }],
    request_id: 3,
  }, 'Expected the bot to receive the shared user');
  assertEqualsInFieldOrder(
    sharedMessage.user_shared,
    { user_id: grace.profile.id, request_id: 3 },
    'Expected the bot to receive the shared user',
  );
});

Deno.test('PrivateMessagingService sends Web App data as a service message of the account', () => {
  const { virtualUsers, botUpdates, publishedEvents, replyInterfaces, messageSending } =
    createPrivateMessagingFixture();
  const account = createVirtualAccount(virtualUsers, { first_name: 'Ada' });
  const bot = createVirtualBot(virtualUsers, { first_name: 'Test Bot', username: 'test_bot' });
  sendPrivateText(messageSending, account.profile.id, bot);
  const keyboard = messageSending.sendPrivateChatMessage({
    fromBotId: bot.profile.id,
    chat: { type: 'private', peerId: account.profile.id },
    replyInterfaceMarkup: {
      kind: 'reply_keyboard',
      rows: [[
        { text: 'Choose dates', request: { kind: 'web_app', url: 'https://hotel.example/' } },
        { text: 'Plain' },
      ]],
      isPersistent: false,
      resizesToFit: false,
      isOneTime: true,
      isSelective: false,
    },
    content: { kind: 'text', text: 'When do you arrive?' },
  });
  if (!keyboard.sent) {
    throw new Error(`Expected the keyboard to be sent, received ${keyboard.reason}`);
  }
  const pendingUpdates = () =>
    botUpdates.confirmAndReadPendingUpdates(bot.profile.id, { limit: 100 });
  const updateCountBeforePresses = pendingUpdates().length;
  const eventCountBeforePresses = publishedEvents.length;
  const press = (text: string, answer?: ReplyKeyboardRequestAnswer) =>
    replyInterfaces.pressPrivateChatReplyKeyboardButton({
      fromAccountId: account.profile.id,
      chat: { type: 'private', peerId: bot.profile.id },
      text,
      ...(answer === undefined ? {} : { answer }),
    });
  const dates: ReplyKeyboardRequestAnswer = { kind: 'web_app', data: '{"nights":3}' };
  const refusals: Array<
    [ReturnType<ReplyInterfaceService['pressPrivateChatReplyKeyboardButton']>, string]
  > = [
    [press('Choose dates'), 'reply_keyboard_button_answer_missing'],
    [press('Plain', dates), 'reply_keyboard_button_answer_not_requested'],
    [
      press('Choose dates', { kind: 'chat', chatId: -1_000_000_000_001 }),
      'reply_keyboard_button_answer_not_requested',
    ],
    [press('Choose a room', dates), 'reply_keyboard_button_not_found'],
  ];
  for (const [result, expectedReason] of refusals) {
    if (result.sent || result.reason !== expectedReason) {
      throw new Error(`Expected ${expectedReason}, received ${JSON.stringify(result)}`);
    }
  }
  if (
    publishedEvents.length !== eventCountBeforePresses ||
    pendingUpdates().length !== updateCountBeforePresses
  ) {
    throw new Error('Expected refused presses to publish nothing');
  }

  const sent = press('Choose dates', dates);
  if (!sent.sent) {
    throw new Error(`Expected the Web App data to be sent, received ${sent.reason}`);
  }
  const expectedContent: PrivateMessageContent = {
    kind: 'web_app_data',
    buttonText: 'Choose dates',
    data: '{"nights":3}',
  };
  if (
    sent.message.sender !== 'account' ||
    sent.message.replyToMessageId !== undefined
  ) {
    throw new Error(`Expected a service message of the account, received ${JSON.stringify(sent)}`);
  }
  assertEquals(sent.message.content, expectedContent, 'Expected a service message of the account');
  const updates = pendingUpdates();
  const sentMessage = messageFromUpdate(updates.at(-1));
  if (
    updates.length !== updateCountBeforePresses + 1 ||
    sentMessage === undefined ||
    'text' in sentMessage ||
    !('web_app_data' in sentMessage)
  ) {
    throw new Error(`Expected the bot to receive the Web App data: ${JSON.stringify(updates)}`);
  }
  assertEqualsInFieldOrder(sentMessage.web_app_data, {
    button_text: 'Choose dates',
    data: '{"nights":3}',
  }, 'Expected the bot to receive the Web App data');
});

Deno.test('PrivateMessagingService answers the button that takes the answer among buttons that share a label', () => {
  const {
    virtualUsers,
    botUpdates,
    publishedEvents,
    privateMessaging,
    replyInterfaces,
    messageSending,
  } = createPrivateMessagingFixture();
  const account = createVirtualAccount(virtualUsers, { first_name: 'Ada' });
  const grace = createVirtualAccount(virtualUsers, { first_name: 'Grace' });
  const bot = createVirtualBot(virtualUsers, { first_name: 'Test Bot', username: 'test_bot' });
  sendPrivateText(messageSending, account.profile.id, bot);
  const conversation = { accountId: account.profile.id, botId: bot.profile.id };
  // The text button comes first, so a press that answers a request must look past it.
  const keyboard = messageSending.sendPrivateChatMessage({
    fromBotId: bot.profile.id,
    chat: { type: 'private', peerId: account.profile.id },
    replyInterfaceMarkup: {
      kind: 'reply_keyboard',
      rows: [
        [{ text: 'Answer' }],
        [
          { text: 'Answer', request: { kind: 'location' } },
          {
            text: 'Answer',
            request: {
              kind: 'users',
              requestId: 3,
              maxQuantity: 1,
              requestsName: true,
              requestsUsername: false,
              requestsPhoto: false,
            },
          },
          {
            text: 'Answer',
            request: {
              kind: 'chat',
              requestId: 4,
              chatIsChannel: false,
              chatIsCreated: false,
              botIsMember: false,
              requestsTitle: false,
              requestsUsername: false,
              requestsPhoto: false,
            },
          },
        ],
        [
          { text: 'Answer', request: { kind: 'poll', pollType: 'quiz' } },
          { text: 'Answer', request: { kind: 'web_app', url: 'https://hotel.example/' } },
        ],
      ],
      isPersistent: false,
      resizesToFit: false,
      isOneTime: true,
      isSelective: false,
    },
    content: { kind: 'text', text: 'Answer me' },
  });
  if (!keyboard.sent) {
    throw new Error(`Expected the keyboard to be sent, received ${keyboard.reason}`);
  }
  const pendingUpdates = () =>
    botUpdates.confirmAndReadPendingUpdates(bot.profile.id, { limit: 100 });
  const readState = () => ({
    history: privateMessaging.getPrivateMessageHistory(conversation),
    replyInterface: replyInterfaces.getPrivateChatReplyInterface({
      accountId: conversation.accountId,
      chat: { type: 'private', peerId: conversation.botId },
    }),
    updateCount: pendingUpdates().length,
    eventCount: publishedEvents.length,
  });
  const press = (answer?: ReplyKeyboardRequestAnswer) =>
    replyInterfaces.pressPrivateChatReplyKeyboardButton({
      fromAccountId: account.profile.id,
      chat: { type: 'private', peerId: bot.profile.id },
      text: 'Answer',
      ...(answer === undefined ? {} : { answer }),
    });
  const quiz = (kind: 'quiz' | 'regular'): ReplyKeyboardRequestAnswer => ({
    kind: 'poll',
    poll: {
      question: { text: 'Which floor?' },
      options: [{ text: 'First' }, { text: 'Second' }],
      isAnonymous: true,
      allowsMultipleAnswers: false,
      allowsRevoting: false,
      type: kind === 'quiz'
        ? { kind: 'quiz', correctOptionPositions: [0], explanation: { text: '' } }
        : { kind: 'regular' },
    },
  });

  const stateBeforeRefusals = readState();
  const refusals: Array<
    [ReturnType<ReplyInterfaceService['pressPrivateChatReplyKeyboardButton']>, string]
  > = [
    [
      press({ kind: 'users', userIds: [grace.profile.id, account.profile.id] }),
      'shared_users_too_many',
    ],
    [press({ kind: 'chat', chatId: -1_000_000_000_001 }), 'shared_chat_not_found'],
    [press(quiz('regular')), 'requested_poll_type_mismatch'],
  ];
  for (const [result, expectedReason] of refusals) {
    if (result.sent || result.reason !== expectedReason) {
      throw new Error(`Expected ${expectedReason}, received ${JSON.stringify(result)}`);
    }
  }
  assertEquals(readState(), stateBeforeRefusals, 'Expected refused presses to change nothing');

  const sentMessages = new Map<string, PrivateMessage>();
  const presses: Array<[string, ReplyKeyboardRequestAnswer | undefined, unknown]> = [
    ['text', undefined, { kind: 'text', text: 'Answer', entities: [] }],
    [
      'location',
      { kind: 'location', location: { latitude: 51.5, longitude: -0.1 } },
      { kind: 'location', location: { latitude: 51.5, longitude: -0.1 } },
    ],
    [
      'users',
      { kind: 'users', userIds: [grace.profile.id] },
      {
        kind: 'users_shared',
        requestId: 3,
        users: [{ userId: grace.profile.id, firstName: 'Grace' }],
      },
    ],
    [
      'Web App data',
      { kind: 'web_app', data: 'payload' },
      { kind: 'web_app_data', buttonText: 'Answer', data: 'payload' },
    ],
    ['quiz', quiz('quiz'), { kind: 'poll' }],
  ];
  for (const [description, answer, expectedContent] of presses) {
    const stateBeforePress = readState();
    const result = press(answer);
    if (!result.sent) {
      throw new Error(`Expected the ${description} press to be sent, received ${result.reason}`);
    }
    assertEquals(
      result.message.content.kind === 'poll' ? { kind: 'poll' } : result.message.content,
      expectedContent,
      `Expected the ${description}`,
    );
    sentMessages.set(description, result.message);
    const stateAfterPress = readState();
    assertEquals(
      [
        stateAfterPress.history.found && stateAfterPress.history.messages.length,
        stateAfterPress.updateCount,
        stateAfterPress.replyInterface,
      ],
      [
        stateBeforePress.history.found && stateBeforePress.history.messages.length + 1,
        stateBeforePress.updateCount + 1,
        stateBeforePress.replyInterface,
      ],
      `Expected the ${description} press to add one message and one update and keep the keyboard`,
    );
  }
  assertEquals(
    [...sentMessages].map(([description, message]) => [description, message.replyToMessageId]),
    [
      ['text', undefined],
      ['location', keyboard.message.id],
      ['users', undefined],
      ['Web App data', undefined],
      ['quiz', undefined],
    ],
    'Expected only the location to reply to the keyboard, as before labels repeated',
  );

  // A press answers the keyboard shown when it is sent.
  messageSending.sendPrivateChatMessage({
    fromBotId: bot.profile.id,
    chat: { type: 'private', peerId: account.profile.id },
    replyInterfaceMarkup: {
      kind: 'reply_keyboard',
      rows: [[{ text: 'Answer', request: { kind: 'web_app', url: 'https://hotel.example/' } }]],
      isPersistent: false,
      resizesToFit: false,
      isOneTime: false,
      isSelective: false,
    },
    content: { kind: 'text', text: 'Only the Web App now' },
  });
  const textAfterReplacement = press();
  if (textAfterReplacement.sent) {
    throw new Error('Expected the replaced text button to be gone');
  }
  assertEquals(
    textAfterReplacement.reason,
    'reply_keyboard_button_answer_missing',
    'Expected the replacement keyboard to leave only the Web App button',
  );
  messageSending.sendPrivateChatMessage({
    fromBotId: bot.profile.id,
    chat: { type: 'private', peerId: account.profile.id },
    replyInterfaceMarkup: { kind: 'reply_keyboard_removal', isSelective: false },
    content: { kind: 'text', text: 'Done' },
  });
  const afterRemoval = press({ kind: 'web_app', data: 'payload' });
  assertEquals(
    afterRemoval.sent ? 'sent' : afterRemoval.reason,
    'reply_keyboard_button_not_found',
    'Expected a removed keyboard to answer nothing',
  );
});

Deno.test('PrivateMessagingService refuses a press whose label leaves buttons that request different things', () => {
  const {
    virtualUsers,
    botUpdates,
    publishedEvents,
    privateMessaging,
    replyInterfaces,
    messageSending,
  } = createPrivateMessagingFixture();
  const account = createVirtualAccount(virtualUsers, { first_name: 'Ada' });
  const grace = createVirtualAccount(virtualUsers, { first_name: 'Grace' });
  const bot = createVirtualBot(virtualUsers, { first_name: 'Test Bot', username: 'test_bot' });
  sendPrivateText(messageSending, account.profile.id, bot);
  const conversation = { accountId: account.profile.id, botId: bot.profile.id };
  const usersRequest = (requestId: number) => ({
    kind: 'users' as const,
    requestId,
    maxQuantity: 1,
    requestsName: false,
    requestsUsername: false,
    requestsPhoto: false,
  });
  const keyboard = messageSending.sendPrivateChatMessage({
    fromBotId: bot.profile.id,
    chat: { type: 'private', peerId: account.profile.id },
    replyInterfaceMarkup: {
      kind: 'reply_keyboard',
      rows: [
        [{ text: 'Share' }, { text: 'Share', request: { kind: 'contact' } }],
        [
          { text: 'Friends', request: usersRequest(1) },
          { text: 'Friends', request: usersRequest(2) },
        ],
        [
          { text: 'App', request: { kind: 'web_app', url: 'https://hotel.example/dates' } },
          { text: 'App', request: { kind: 'web_app', url: 'https://hotel.example/rooms' } },
        ],
        [{ text: 'Same' }, { text: 'Same', style: 'primary' }],
        [
          { text: 'Open', request: { kind: 'web_app', url: 'https://hotel.example/' } },
          { text: 'Open', request: { kind: 'web_app', url: 'https://hotel.example/' } },
        ],
      ],
      isPersistent: false,
      resizesToFit: false,
      isOneTime: false,
      isSelective: false,
    },
    content: { kind: 'text', text: 'Choose' },
  });
  if (!keyboard.sent) {
    throw new Error(`Expected the keyboard to be sent, received ${keyboard.reason}`);
  }
  const readState = () => ({
    history: privateMessaging.getPrivateMessageHistory(conversation),
    replyInterface: replyInterfaces.getPrivateChatReplyInterface({
      accountId: conversation.accountId,
      chat: { type: 'private', peerId: conversation.botId },
    }),
    updateCount: botUpdates.confirmAndReadPendingUpdates(bot.profile.id, { limit: 100 }).length,
    eventCount: publishedEvents.length,
  });
  const press = (text: string, answer?: ReplyKeyboardRequestAnswer) =>
    replyInterfaces.pressPrivateChatReplyKeyboardButton({
      fromAccountId: account.profile.id,
      chat: { type: 'private', peerId: bot.profile.id },
      text,
      ...(answer === undefined ? {} : { answer }),
    });
  const stateBeforeRefusals = readState();
  const refusals: Array<
    [ReturnType<ReplyInterfaceService['pressPrivateChatReplyKeyboardButton']>, string]
  > = [
    [press('Share'), 'reply_keyboard_button_ambiguous'],
    [
      press('Friends', { kind: 'users', userIds: [grace.profile.id] }),
      'reply_keyboard_button_ambiguous',
    ],
    [press('Friends'), 'reply_keyboard_button_answer_missing'],
    [
      press('Friends', { kind: 'web_app', data: 'x' }),
      'reply_keyboard_button_answer_not_requested',
    ],
    [press('App', { kind: 'web_app', data: 'x' }), 'reply_keyboard_button_ambiguous'],
  ];
  for (const [result, expectedReason] of refusals) {
    if (result.sent || result.reason !== expectedReason) {
      throw new Error(`Expected ${expectedReason}, received ${JSON.stringify(result)}`);
    }
  }
  assertEquals(readState(), stateBeforeRefusals, 'Expected ambiguous presses to change nothing');

  const same = press('Same');
  const open = press('Open', { kind: 'web_app', data: 'x' });
  assertEquals(
    [same.sent && same.message.content, open.sent && open.message.content],
    [
      { kind: 'text', text: 'Same', entities: [] },
      { kind: 'web_app_data', buttonText: 'Open', data: 'x' },
    ],
    'Expected buttons that request the same thing to act as one',
  );
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
  messageSending: MessageSendingService,
  accountId: number,
  bot: VirtualBot,
  inlineKeyboard?: InlineKeyboard,
): PrivateMessage {
  const result = messageSending.sendPrivateChatMessage({
    fromBotId: bot.profile.id,
    chat: { type: 'private', peerId: accountId },
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

/**
 * The messaging services over fresh repositories, with the clock the test advances, the join
 * requests the test grants, and the bots' updates projected from the published events.
 */
function createPrivateMessagingFixture() {
  let currentUnixTimeSeconds = TEST_UNIX_TIME_SECONDS;
  /** The bots a pending join request lets write to each account, and the contacts they claimed. */
  const joinRequesterGrants = {
    contactableBotIdsByAccountId: new Map<number, Set<number>>(),
    claims: [] as Array<readonly [botId: number, accountId: number]>,
  };
  const botUpdates = new BotUpdateRepository();
  const services = createChatMessagingServices({
    joinRequesterContacts: {
      mayContactJoinRequester: (botId, accountId) =>
        joinRequesterGrants.contactableBotIdsByAccountId.get(accountId)?.has(botId) ?? false,
      claimJoinRequesterContact: (botId, accountId) => {
        joinRequesterGrants.claims.push([botId, accountId]);
      },
    },
    currentUnixTimeSeconds: () => currentUnixTimeSeconds,
    createEventObserver: (
      { accounts, bots, sharedChats, messageBoxes, messages, files, polls },
    ) => {
      const botUpdateDelivery = new BotUpdateDeliveryService({
        botMessageViews: new BotMessageViewService({
          accounts,
          bots,
          sharedChats,
          messageBoxes,
          messages,
          files,
          polls,
        }),
        botUpdates,
        updateSubscriptions: new BotUpdateSubscriptionRepository(),
        bots,
        sharedChats,
        messages,
        lastMessageSendingBots: new LastMessageSendingBotRepository(),
      });
      return (event) => botUpdateDelivery.project(event);
    },
  });
  return {
    ...services,
    botUpdates,
    joinRequesterGrants,
    advanceClockSeconds: (seconds: number) => {
      currentUnixTimeSeconds += seconds;
    },
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
  messageSending: MessageSendingService,
  accountId: number,
  bot: VirtualBot,
): PrivateMessage {
  const result = messageSending.sendAccountPrivateChatMessage({
    fromAccountId: accountId,
    chat: { type: 'private', peerId: bot.profile.id },
    content: { kind: 'text', text: 'Hello' },
  });
  if (!result.sent) {
    throw new Error(`Expected message send to succeed, received ${result.reason}`);
  }
  return result.message;
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

/** A photo for an album, without a caption. */
function photoMedia(): MediaContent {
  return {
    kind: 'photo',
    photo: { kind: 'upload', upload: photoUpload() },
    caption: '',
    hasSpoiler: false,
    showsCaptionAboveMedia: false,
  };
}
