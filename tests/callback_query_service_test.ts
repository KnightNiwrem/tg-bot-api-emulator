import { AccountRepository } from '../src/repositories/account.ts';
import { BlockedUserRepository } from '../src/repositories/blocked_user.ts';
import { BotRepository } from '../src/repositories/bot.ts';
import { CallbackQueryRepository } from '../src/repositories/callback_query.ts';
import { FileRepository } from '../src/repositories/file.ts';
import { PollRepository } from '../src/repositories/poll.ts';
import { MessageRepository } from '../src/repositories/message.ts';
import { PrivateConversationRepository } from '../src/repositories/private_conversation.ts';
import { SharedChatRepository } from '../src/repositories/shared_chat.ts';
import { TelegramIdentityRepository } from '../src/repositories/telegram_identity.ts';
import { MessageBoxRepository } from '../src/repositories/message_box.ts';
import { createAccountChatMessageReader } from '../src/services/account_chat_message.ts';
import {
  CallbackQueryService,
  type PressCallbackButtonFailureReason,
} from '../src/services/callback_query.ts';
import { PrivateMessagingService } from '../src/services/private_messaging.ts';
import { SupergroupMessagingService } from '../src/services/supergroup_messaging.ts';
import { VirtualUserService } from '../src/services/virtual_user.ts';
import type { ChatDomainEvent } from '../src/types/chat_domain_event.ts';
import { ALL_CHAT_PERMISSIONS } from '../src/types/chat_permissions.ts';

Deno.test('CallbackQueryService publishes a callback query for a pressed button', () => {
  const { publishedEvents, privateConversations, callbackQueries, chat } =
    createCallbackQueryFixture();

  const result = callbackQueries.pressCallbackButton({
    fromAccountId: chat.account.profile.id,
    chat: { type: 'private', botId: chat.bot.profile.id },
    messageId: chat.botMessageId,
    callbackData: 'no',
    expired: false,
  });
  if (!result.pressed) {
    throw new Error(`Expected the button press to succeed, received ${result.reason}`);
  }

  const conversation = privateConversations.getPrivateConversation({
    accountId: chat.account.profile.id,
    botId: chat.bot.profile.id,
  });
  const { callbackQuery } = result;
  if (
    callbackQuery.callbackData !== 'no' ||
    callbackQuery.messageId !== chat.botMessage.id ||
    callbackQuery.chatInstance !== conversation?.chatInstance ||
    callbackQuery.state.status !== 'awaiting_answer'
  ) {
    throw new Error("Expected an unanswered query for the button in the conversation's chat");
  }
  const lastEvent = publishedEvents.at(-1);
  if (
    lastEvent?.type !== 'callback_query_created' ||
    lastEvent.callbackQuery !== callbackQuery ||
    lastEvent.message !== chat.botMessage
  ) {
    throw new Error('Expected the callback query to be published with its message');
  }
});

Deno.test('CallbackQueryService presses buttons on bot messages in a supergroup for members', () => {
  const { virtualUsers, sharedChats, supergroupMessaging, callbackQueries, chat } =
    createCallbackQueryFixture();
  const stranger = createAccount(virtualUsers, 'Grace');
  const supergroup = {
    kind: 'supergroup',
    id: -1_000_000_000_001,
    title: 'Team',
    chatInstance: '-42',
    hasProtectedContent: false,
    defaultPermissions: ALL_CHAT_PERMISSIONS,
  } as const;
  sharedChats.registerSupergroup(supergroup, chat.account.profile.id);
  sharedChats.addChatMember(supergroup.id, chat.bot.profile.id);
  const accountMessage = supergroupMessaging.sendAccountMessage({
    fromAccountId: chat.account.profile.id,
    chatId: supergroup.id,
    content: { kind: 'text', text: 'Hello' },
  });
  const botMessage = supergroupMessaging.sendBotMessage({
    fromBotId: chat.bot.profile.id,
    chatId: supergroup.id,
    inlineKeyboard: [[{ kind: 'callback', text: 'Yes', callbackData: 'yes' }]],
    content: { kind: 'text', text: 'Vote' },
  });
  if (!accountMessage.sent || !botMessage.sent) {
    throw new Error('Expected the supergroup messages to be sent');
  }
  const press = (fromAccountId: number, chatId: number, messageId: number) =>
    callbackQueries.pressCallbackButton({
      fromAccountId,
      chat: { type: 'supergroup', chatId },
      messageId,
      callbackData: 'yes',
      expired: false,
    });

  const failures = [
    press(chat.account.profile.id, -1_000_000_009_999, 2),
    press(stranger.profile.id, supergroup.id, 2),
    press(chat.account.profile.id, supergroup.id, 99),
    press(chat.account.profile.id, supergroup.id, 1),
  ].map((result) => result.pressed ? 'pressed' : result.reason);
  if (
    JSON.stringify(failures) !==
      JSON.stringify([
        'chat_not_found',
        'not_a_member',
        'message_not_found',
        'callback_button_not_found',
      ])
  ) {
    throw new Error(`Expected supergroup press checks, received ${JSON.stringify(failures)}`);
  }

  const result = press(chat.account.profile.id, supergroup.id, 2);
  if (
    !result.pressed || result.callbackQuery.botId !== chat.bot.profile.id ||
    result.callbackQuery.accountId !== chat.account.profile.id ||
    result.callbackQuery.messageId !== botMessage.message.id ||
    result.callbackQuery.chatInstance !== supergroup.chatInstance
  ) {
    throw new Error("Expected a query for the message's bot with the supergroup's chat instance");
  }
});

Deno.test('CallbackQueryService validates button presses before changing state', () => {
  const { virtualUsers, publishedEvents, callbackQueries, chat } = createCallbackQueryFixture();
  const strangerAccount = createAccount(virtualUsers, 'Grace');
  const publishedEventCount = publishedEvents.length;
  const cases: {
    fromAccountId: number;
    botId: number;
    messageId: number;
    callbackData: string;
    expectedReason: PressCallbackButtonFailureReason;
  }[] = [
    {
      fromAccountId: 999,
      botId: chat.bot.profile.id,
      messageId: chat.botMessageId,
      callbackData: 'yes',
      expectedReason: 'account_not_found',
    },
    {
      fromAccountId: chat.account.profile.id,
      botId: 999,
      messageId: chat.botMessageId,
      callbackData: 'yes',
      expectedReason: 'bot_not_found',
    },
    {
      fromAccountId: strangerAccount.profile.id,
      botId: chat.bot.profile.id,
      messageId: chat.botMessageId,
      callbackData: 'yes',
      expectedReason: 'message_not_found',
    },
    {
      fromAccountId: chat.account.profile.id,
      botId: chat.bot.profile.id,
      messageId: 999,
      callbackData: 'yes',
      expectedReason: 'message_not_found',
    },
    {
      fromAccountId: chat.account.profile.id,
      botId: chat.bot.profile.id,
      messageId: chat.botMessageId,
      callbackData: 'maybe',
      expectedReason: 'callback_button_not_found',
    },
    {
      fromAccountId: chat.account.profile.id,
      botId: chat.bot.profile.id,
      messageId: chat.accountMessageId,
      callbackData: 'yes',
      expectedReason: 'callback_button_not_found',
    },
  ];

  for (const { fromAccountId, botId, messageId, callbackData, expectedReason } of cases) {
    const result = callbackQueries.pressCallbackButton({
      fromAccountId,
      chat: { type: 'private', botId },
      messageId,
      callbackData,
      expired: false,
    });
    if (result.pressed || result.reason !== expectedReason) {
      throw new Error(`Expected the button press to fail with ${expectedReason}`);
    }
  }
  if (publishedEvents.length !== publishedEventCount) {
    throw new Error('Expected rejected button presses not to publish anything');
  }
});

Deno.test('CallbackQueryService lets only the receiving bot answer, and only once', () => {
  const { virtualUsers, callbackQueries, chat } = createCallbackQueryFixture();
  const otherBot = createBot(virtualUsers, 'other_bot');
  const pressResult = callbackQueries.pressCallbackButton({
    fromAccountId: chat.account.profile.id,
    chat: { type: 'private', botId: chat.bot.profile.id },
    messageId: chat.botMessageId,
    callbackData: 'yes',
    expired: false,
  });
  if (!pressResult.pressed) {
    throw new Error(`Expected the button press to succeed, received ${pressResult.reason}`);
  }
  const callbackQueryId = pressResult.callbackQuery.id;
  const answer = (fromBotId: number, text?: string) =>
    callbackQueries.answerCallbackQuery({
      fromBotId,
      callbackQueryId,
      text,
      showAlert: true,
      cacheTimeSeconds: 10,
    });

  const otherBotAnswer = answer(otherBot.profile.id, 'Stolen');
  const unknownQueryAnswer = callbackQueries.answerCallbackQuery({
    fromBotId: chat.bot.profile.id,
    callbackQueryId: 'unknown',
    showAlert: false,
    cacheTimeSeconds: 0,
  });
  if (otherBotAnswer.answered || unknownQueryAnswer.answered) {
    throw new Error("Expected other bots' and unknown queries' answers to be rejected");
  }

  const firstAnswer = answer(chat.bot.profile.id, 'Saved');
  if (
    !firstAnswer.answered ||
    JSON.stringify(firstAnswer.callbackQuery.state) !==
      JSON.stringify({
        status: 'answered',
        answer: { text: 'Saved', showAlert: true, cacheTimeSeconds: 10 },
      })
  ) {
    throw new Error("Expected the receiving bot's answer to be recorded");
  }
  if (answer(chat.bot.profile.id, 'Again').answered) {
    throw new Error('Expected a second answer to be rejected');
  }
});

Deno.test('CallbackQueryService records an empty answer text as no notification', () => {
  const { callbackQueries, chat } = createCallbackQueryFixture();
  const pressResult = callbackQueries.pressCallbackButton({
    fromAccountId: chat.account.profile.id,
    chat: { type: 'private', botId: chat.bot.profile.id },
    messageId: chat.botMessageId,
    callbackData: 'yes',
    expired: false,
  });
  if (!pressResult.pressed) {
    throw new Error(`Expected the button press to succeed, received ${pressResult.reason}`);
  }

  const result = callbackQueries.answerCallbackQuery({
    fromBotId: chat.bot.profile.id,
    callbackQueryId: pressResult.callbackQuery.id,
    text: '',
    showAlert: false,
    cacheTimeSeconds: 0,
  });
  if (!result.answered || result.callbackQuery.state.status !== 'answered') {
    throw new Error('Expected the answer to be recorded');
  }
  if ('text' in result.callbackQuery.state.answer) {
    throw new Error('Expected empty answer text to be omitted');
  }
});

Deno.test('CallbackQueryService records only answer URLs that start the answering bot', () => {
  const { callbackQueries, chat } = createCallbackQueryFixture();
  const press = () => {
    const pressResult = callbackQueries.pressCallbackButton({
      fromAccountId: chat.account.profile.id,
      chat: { type: 'private', botId: chat.bot.profile.id },
      messageId: chat.botMessageId,
      callbackData: 'yes',
      expired: false,
    });
    if (!pressResult.pressed) {
      throw new Error(`Expected the button press to succeed, received ${pressResult.reason}`);
    }
    return pressResult.callbackQuery.id;
  };
  const answer = (callbackQueryId: string, url: string) =>
    callbackQueries.answerCallbackQuery({
      fromBotId: chat.bot.profile.id,
      callbackQueryId,
      showAlert: false,
      cacheTimeSeconds: 0,
      url,
    });

  const callbackQueryId = press();
  for (const url of ['https://grammy.dev', 'https://t.me/other_bot?start=x', 't.me/test_bot']) {
    const result = answer(callbackQueryId, url);
    if (result.answered || result.reason !== 'url_invalid') {
      throw new Error(`Expected ${url} to be rejected, received ${JSON.stringify(result)}`);
    }
  }
  const startLink = `https://t.me/${chat.bot.profile.username.toUpperCase()}?start=order`;
  const accepted = answer(callbackQueryId, startLink);
  const withoutUrl = answer(press(), '');
  if (
    !accepted.answered || accepted.callbackQuery.state.status !== 'answered' ||
    accepted.callbackQuery.state.answer.url !== startLink || !withoutUrl.answered ||
    withoutUrl.callbackQuery.state.status !== 'answered' ||
    'url' in withoutUrl.callbackQuery.state.answer
  ) {
    throw new Error('Expected a link that starts the bot to be recorded, and an empty URL omitted');
  }
});

Deno.test('CallbackQueryService shows callback queries only to the account that created them', () => {
  const { virtualUsers, callbackQueries, chat } = createCallbackQueryFixture();
  const otherAccount = createAccount(virtualUsers, 'Grace');
  const pressResult = callbackQueries.pressCallbackButton({
    fromAccountId: chat.account.profile.id,
    chat: { type: 'private', botId: chat.bot.profile.id },
    messageId: chat.botMessageId,
    callbackData: 'yes',
    expired: false,
  });
  if (!pressResult.pressed) {
    throw new Error(`Expected the button press to succeed, received ${pressResult.reason}`);
  }
  const callbackQueryId = pressResult.callbackQuery.id;

  if (
    callbackQueries.getAccountCallbackQuery({
      accountId: chat.account.profile.id,
      callbackQueryId,
    }) !== pressResult.callbackQuery
  ) {
    throw new Error('Expected the pressing account to find its callback query');
  }
  if (
    callbackQueries.getAccountCallbackQuery({
      accountId: otherAccount.profile.id,
      callbackQueryId,
    }) !== undefined
  ) {
    throw new Error("Expected other accounts not to find the account's callback query");
  }
});

Deno.test('CallbackQueryService delivers a query created expired that cannot be answered', () => {
  const { publishedEvents, callbackQueries, chat } = createCallbackQueryFixture();

  const pressResult = callbackQueries.pressCallbackButton({
    fromAccountId: chat.account.profile.id,
    chat: { type: 'private', botId: chat.bot.profile.id },
    messageId: chat.botMessageId,
    callbackData: 'yes',
    expired: true,
  });
  if (!pressResult.pressed || pressResult.callbackQuery.state.status !== 'expired') {
    throw new Error('Expected the press to create an expired callback query');
  }
  const lastEvent = publishedEvents.at(-1);
  if (
    lastEvent?.type !== 'callback_query_created' ||
    lastEvent.callbackQuery !== pressResult.callbackQuery
  ) {
    throw new Error('Expected the expired callback query to be published for the bot');
  }

  const answerResult = callbackQueries.answerCallbackQuery({
    fromBotId: chat.bot.profile.id,
    callbackQueryId: pressResult.callbackQuery.id,
    showAlert: false,
    cacheTimeSeconds: 0,
  });
  if (answerResult.answered) {
    throw new Error('Expected an expired callback query to reject its answer');
  }
});

Deno.test('CallbackQueryService sends a press on an inline message to its inline bot', () => {
  const { virtualUsers, privateMessaging, messageBoxes, callbackQueries, chat } =
    createCallbackQueryFixture();
  const inlineBot = createBot(virtualUsers, 'inline_bot');
  const sending = privateMessaging.sendAccountInlineResult({
    fromAccountId: chat.account.profile.id,
    to: { type: 'private', botId: chat.bot.profile.id },
    viaBotId: inlineBot.profile.id,
    content: { kind: 'text', text: 'Cats', entities: [] },
    inlineKeyboard: [[{ kind: 'callback', text: 'Like', callbackData: 'like' }]],
  });
  if (!sending.sent) {
    throw new Error(`Expected the inline result to be sent, received ${sending.reason}`);
  }
  const messageId = messageBoxes.getMessageId(chat.bot.profile.id, sending.message.id);
  if (messageId === undefined) {
    throw new Error("Expected the inline message in the chat bot's message box");
  }

  const result = callbackQueries.pressCallbackButton({
    fromAccountId: chat.account.profile.id,
    chat: { type: 'private', botId: chat.bot.profile.id },
    messageId,
    callbackData: 'like',
    expired: false,
  });
  if (
    !result.pressed || result.callbackQuery.botId !== inlineBot.profile.id ||
    result.callbackQuery.inlineMessageId !== sending.message.viaBot?.inlineMessageId
  ) {
    throw new Error('Expected the press to reach the inline bot by the inline message identifier');
  }
  const answer = (fromBotId: number) =>
    callbackQueries.answerCallbackQuery({
      fromBotId,
      callbackQueryId: result.callbackQuery.id,
      showAlert: false,
      cacheTimeSeconds: 0,
    }).answered;
  if (answer(chat.bot.profile.id) || !answer(inlineBot.profile.id)) {
    throw new Error("Expected only the inline bot to answer, not the chat's bot");
  }
});

function createCallbackQueryFixture() {
  const identities = new TelegramIdentityRepository();
  const accounts = new AccountRepository();
  const bots = new BotRepository();
  const virtualUsers = new VirtualUserService({ identities, accounts, bots });
  const privateConversations = new PrivateConversationRepository();
  const messages = new MessageRepository();
  const files = new FileRepository();
  const polls = new PollRepository();
  const messageBoxes = new MessageBoxRepository();
  const sharedChats = new SharedChatRepository();
  const publishedEvents: ChatDomainEvent[] = [];
  const events = { publish: (event: ChatDomainEvent) => publishedEvents.push(event) };
  const privateMessaging = new PrivateMessagingService({
    accounts,
    bots,
    sharedChats,
    privateConversations,
    messages,
    files,
    polls,
    messageBoxes,
    blockedUsers: new BlockedUserRepository(),
    joinRequesterContacts: {
      mayContactJoinRequester: () => false,
      claimJoinRequesterContact: () => {
        throw new Error('Unexpected join requester contact');
      },
    },
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
    accountChatMessages: createAccountChatMessageReader({
      accounts,
      bots,
      privateConversations,
      privateMessages: privateMessaging,
      sharedChats,
      supergroupMessages: supergroupMessaging,
    }),
    bots,
    callbackQueries: new CallbackQueryRepository(),
    events,
  });

  const account = createAccount(virtualUsers, 'Ada');
  const bot = createBot(virtualUsers, 'test_bot');
  const accountMessage = privateMessaging.sendAccountMessage({
    fromAccountId: account.profile.id,
    to: { type: 'private', botId: bot.profile.id },
    content: { kind: 'text', text: '/start' },
  });
  const botMessage = privateMessaging.sendBotMessage({
    fromBotId: bot.profile.id,
    to: { type: 'private', accountId: account.profile.id },
    inlineKeyboard: [[
      { kind: 'callback', text: 'Yes', callbackData: 'yes' },
      { kind: 'callback', text: 'No', callbackData: 'no' },
      { kind: 'url', text: 'Help', url: 'https://grammy.dev' },
    ]],
    content: { kind: 'text', text: 'Continue?' },
  });
  if (!accountMessage.sent || !botMessage.sent) {
    throw new Error('Expected the fixture conversation to be created');
  }
  const accountMessageId = messageBoxes.getMessageId(bot.profile.id, accountMessage.message.id);
  const botMessageId = messageBoxes.getMessageId(bot.profile.id, botMessage.message.id);
  if (accountMessageId === undefined || botMessageId === undefined) {
    throw new Error("Expected the fixture messages in the bot's message box");
  }

  return {
    virtualUsers,
    privateConversations,
    sharedChats,
    privateMessaging,
    supergroupMessaging,
    messageBoxes,
    publishedEvents,
    callbackQueries,
    chat: { account, bot, botMessage: botMessage.message, botMessageId, accountMessageId },
  };
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
