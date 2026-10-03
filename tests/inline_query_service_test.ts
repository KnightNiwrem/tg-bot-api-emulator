import { AccountRepository } from '../src/repositories/account.ts';
import { BlockedUserRepository } from '../src/repositories/blocked_user.ts';
import { BotRepository } from '../src/repositories/bot.ts';
import { FileRepository } from '../src/repositories/file.ts';
import { PollRepository } from '../src/repositories/poll.ts';
import { InlineQueryRepository } from '../src/repositories/inline_query.ts';
import { MessageRepository } from '../src/repositories/message.ts';
import { MessageBoxRepository } from '../src/repositories/message_box.ts';
import { PrivateConversationRepository } from '../src/repositories/private_conversation.ts';
import { SharedChatRepository } from '../src/repositories/shared_chat.ts';
import { TelegramIdentityRepository } from '../src/repositories/telegram_identity.ts';
import {
  type AnswerInlineQueryInput,
  InlineQueryService,
  type SpecifiedInlineQueryResult,
} from '../src/services/inline_query.ts';
import { PrivateMessagingService } from '../src/services/private_messaging.ts';
import { SupergroupMessagingService } from '../src/services/supergroup_messaging.ts';
import { VirtualUserService } from '../src/services/virtual_user.ts';
import type { ChatDomainEvent } from '../src/types/chat_domain_event.ts';
import { ALL_CHAT_PERMISSIONS } from '../src/types/chat_permissions.ts';
import type { InlineQueryChat } from '../src/types/inline_query.ts';

const SUPERGROUP = {
  kind: 'supergroup',
  id: -1_000_000_000_001,
  title: 'Team',
  chatInstance: '-42',
  hasProtectedContent: false,
  defaultPermissions: ALL_CHAT_PERMISSIONS,
} as const;

Deno.test('InlineQueryService sends queries only to inline bots in chats the account writes to', () => {
  const { virtualUsers, sharedChats, inlineQueries, publishedEvents, account, inlineBot } =
    createInlineQueryFixture();
  const plainBot = createBot(virtualUsers, 'plain_bot', { supports_inline_queries: false });
  const stranger = createAccount(virtualUsers, 'Grace');
  sharedChats.registerSupergroup(SUPERGROUP, account.profile.id);
  const send = (fromAccountId: number, botId: number, chat: InlineQueryChat) =>
    inlineQueries.sendInlineQuery({ fromAccountId, botId, chat, query: 'cats', offset: '' });

  const failures = [
    send(999, inlineBot.profile.id, { type: 'private', botId: inlineBot.profile.id }),
    send(account.profile.id, 999, { type: 'private', botId: inlineBot.profile.id }),
    send(account.profile.id, plainBot.profile.id, { type: 'private', botId: plainBot.profile.id }),
    send(account.profile.id, inlineBot.profile.id, { type: 'private', botId: 999 }),
    send(account.profile.id, inlineBot.profile.id, {
      type: 'supergroup',
      chatId: -1_000_000_000_999,
    }),
    send(stranger.profile.id, inlineBot.profile.id, { type: 'supergroup', chatId: SUPERGROUP.id }),
  ].map((result) => result.sent ? 'sent' : result.reason);
  if (
    JSON.stringify(failures) !== JSON.stringify([
        'account_not_found',
        'bot_not_found',
        'inline_mode_disabled',
        'chat_not_found',
        'chat_not_found',
        'not_a_member',
      ]) || publishedEvents.length !== 0
  ) {
    throw new Error(`Expected every query to be refused unpublished, received ${failures}`);
  }

  const result = inlineQueries.sendInlineQuery({
    fromAccountId: account.profile.id,
    botId: inlineBot.profile.id,
    chat: { type: 'supergroup', chatId: SUPERGROUP.id },
    query: 'cats',
    offset: '10',
  });
  if (!result.sent) {
    throw new Error(`Expected the query to be sent, received ${result.reason}`);
  }
  const { inlineQuery } = result;
  if (
    inlineQuery.accountId !== account.profile.id || inlineQuery.botId !== inlineBot.profile.id ||
    inlineQuery.query !== 'cats' || inlineQuery.offset !== '10' ||
    inlineQuery.state.status !== 'awaiting_answer'
  ) {
    throw new Error(`Expected an unanswered query, received ${JSON.stringify(inlineQuery)}`);
  }
  const lastEvent = publishedEvents.at(-1);
  if (lastEvent?.type !== 'inline_query_created' || lastEvent.inlineQuery !== inlineQuery) {
    throw new Error('Expected the query to be published for its bot');
  }
});

Deno.test("InlineQueryService checks answers in Telegram's order", () => {
  const { virtualUsers, inlineQueries, inlineBot, sendQuery } = createInlineQueryFixture();
  const otherBot = createBot(virtualUsers, 'other_bot', { supports_inline_queries: true });
  const inlineQuery = sendQuery();
  const answer = (input: Partial<AnswerInlineQueryInput>) =>
    inlineQueries.answerInlineQuery({
      fromBotId: inlineBot.profile.id,
      inlineQueryId: inlineQuery.id,
      results: [article('1')],
      cacheTimeSeconds: 300,
      isPersonal: false,
      nextOffset: '',
      ...input,
    });
  const startButton = (startParameter: string) => ({
    kind: 'start_bot' as const,
    text: 'Sign in',
    startParameter,
  });
  const cases: [string, Partial<AnswerInlineQueryInput>][] = [
    ['start_parameter_empty', { button: startButton('') }],
    ['start_parameter_too_long', { button: startButton('a'.repeat(65)) }],
    ['start_parameter_invalid', { button: startButton('sign in') }],
    ['too_many_results', {
      inlineQueryId: '999',
      results: Array.from({ length: 51 }, (_, index) => article(String(index))),
    }],
    ['text_invalid', { inlineQueryId: '999', results: [article('1', ' ')] }],
    ['message_text_too_long', { results: [article('1', 'a'.repeat(4_097))] }],
    ['query_id_invalid', { inlineQueryId: '999' }],
    ['query_id_invalid', { fromBotId: otherBot.profile.id }],
    ['next_offset_invalid', { nextOffset: 'a'.repeat(65) }],
    ['result_id_empty', { results: [article('')] }],
    ['result_id_invalid', { results: [article('a'.repeat(65))] }],
    ['result_id_duplicate', { results: [article('1'), article('1')] }],
    ['article_title_empty', { results: [{ ...article('1'), title: '' }] }],
    ['callback_data_invalid', {
      results: [{
        ...article('1'),
        inlineKeyboard: [[{ kind: 'callback', text: 'Go', callbackData: 'a'.repeat(65) }]],
      }],
    }],
  ];
  for (const [expectedReason, input] of cases) {
    const result = answer(input);
    if (result.answered || result.reason !== expectedReason) {
      throw new Error(
        `Expected ${expectedReason}, received ${result.answered ? 'an answer' : result.reason}`,
      );
    }
  }

  const answered = answer({
    results: [
      {
        ...article('1', 'Pay with /start'),
        description: 'Opens a menu',
        url: 'https://grammy.dev',
      },
    ],
    cacheTimeSeconds: 0,
    isPersonal: true,
    nextOffset: '10',
    button: startButton('sign-in_1'),
  });
  if (!answered.answered || answered.inlineQuery.state.status !== 'answered') {
    throw new Error('Expected a well-formed answer to be recorded');
  }
  const { answer: recordedAnswer } = answered.inlineQuery.state;
  const [result] = recordedAnswer.results;
  if (
    recordedAnswer.results.length !== 1 || result?.kind !== 'article' ||
    result.title !== 'Result 1' || result.description !== 'Opens a menu' ||
    result.url !== 'https://grammy.dev' || result.messageContent.kind !== 'text' ||
    JSON.stringify(result.messageContent.entities) !==
      JSON.stringify([{ type: 'bot_command', offset: 9, length: 6 }]) ||
    recordedAnswer.cacheTimeSeconds !== 0 || !recordedAnswer.isPersonal ||
    recordedAnswer.nextOffset !== '10' || recordedAnswer.button?.kind !== 'start_bot'
  ) {
    throw new Error(`Expected the normalized answer, received ${JSON.stringify(recordedAnswer)}`);
  }
  const repeatedAnswer = answer({});
  if (repeatedAnswer.answered || repeatedAnswer.reason !== 'query_id_invalid') {
    throw new Error('Expected an answered query to refuse another answer');
  }
});

Deno.test("InlineQueryService sends a chosen result as the account's message through the bot", () => {
  const {
    virtualUsers,
    files,
    blockedUsers,
    inlineQueries,
    publishedEvents,
    account,
    inlineBot,
    sendQuery,
  } = createInlineQueryFixture();
  const chatBot = createBot(virtualUsers, 'chat_bot', { supports_inline_queries: false });
  const photo = files.addFile({
    type: 'photo',
    content: new Uint8Array([1]),
    imageFormat: 'png',
    width: 1,
    height: 1,
  });
  const inlineQuery = sendQuery({ type: 'private', botId: chatBot.profile.id });
  const choose = (resultId: string, accountId = account.profile.id) =>
    inlineQueries.chooseInlineQueryResult({
      accountId,
      inlineQueryId: inlineQuery.id,
      resultId,
    });
  const unanswered = choose('1');
  if (unanswered.chosen || unanswered.reason !== 'inline_query_not_answered') {
    throw new Error('Expected an unanswered query to offer no result');
  }
  const answered = inlineQueries.answerInlineQuery({
    fromBotId: inlineBot.profile.id,
    inlineQueryId: inlineQuery.id,
    results: [
      {
        ...article('1'),
        inlineKeyboard: [[{ kind: 'callback', text: 'Like', callbackData: 'like' }]],
      },
      {
        kind: 'photo',
        id: 'photo',
        photo,
        title: '',
        description: '',
        messageContent: {
          kind: 'photo',
          photo: { kind: 'stored', file: photo },
          caption: 'A cat',
          hasSpoiler: false,
          showsCaptionAboveMedia: false,
        },
      },
    ],
    cacheTimeSeconds: 300,
    isPersonal: false,
    nextOffset: '',
  });
  if (!answered.answered) {
    throw new Error(`Expected the answer to be recorded, received ${answered.reason}`);
  }

  const failures = [choose('1', 999), choose('unknown')].map((result) =>
    result.chosen ? 'chosen' : result.reason
  );
  if (JSON.stringify(failures) !== JSON.stringify(['inline_query_not_found', 'result_not_found'])) {
    throw new Error(`Expected unknown queries and results to be refused, received ${failures}`);
  }
  const chosenArticle = choose('1');
  const chosenPhoto = choose('photo');
  if (!chosenArticle.chosen || !chosenPhoto.chosen) {
    throw new Error('Expected both results to be sent');
  }
  const { message } = chosenArticle;
  if (
    message.kind !== 'private_message' || message.authorRole !== 'account' ||
    message.conversation.botId !== chatBot.profile.id ||
    message.viaBot?.botId !== inlineBot.profile.id || message.content.kind !== 'text' ||
    message.content.text !== 'Result 1' || message.inlineKeyboard?.[0]?.[0]?.text !== 'Like'
  ) {
    throw new Error(
      `Expected the account's message through the bot, received ${JSON.stringify(message)}`,
    );
  }
  if (
    chosenPhoto.message.content.kind !== 'photo' ||
    chosenPhoto.message.content.fileId !== photo.id ||
    chosenPhoto.message.content.caption.text !== 'A cat' ||
    chosenPhoto.message.viaBot?.inlineMessageId === message.viaBot.inlineMessageId
  ) {
    throw new Error('Expected the photo result to be sent as its own inline message');
  }
  const chosenEvent = publishedEvents.at(-3);
  if (
    chosenEvent?.type !== 'inline_query_result_chosen' || chosenEvent.resultId !== '1' ||
    chosenEvent.message !== message || chosenEvent.inlineQuery.id !== inlineQuery.id
  ) {
    throw new Error('Expected the choice to be published after the message it created');
  }

  blockedUsers.block(account.profile.id, chatBot.profile.id);
  const blocked = choose('1');
  if (blocked.chosen || blocked.reason !== 'bot_blocked') {
    throw new Error("Expected a blocked chat's bot to refuse the result");
  }
});

Deno.test('InlineQueryService sends results to supergroups the inline bot is not a member of', () => {
  const { sharedChats, inlineQueries, account, inlineBot, sendQuery } = createInlineQueryFixture();
  sharedChats.registerSupergroup(SUPERGROUP, account.profile.id);
  const inlineQuery = sendQuery({ type: 'supergroup', chatId: SUPERGROUP.id });
  inlineQueries.answerInlineQuery({
    fromBotId: inlineBot.profile.id,
    inlineQueryId: inlineQuery.id,
    results: [article('1')],
    cacheTimeSeconds: 300,
    isPersonal: false,
    nextOffset: '',
  });

  const chosen = inlineQueries.chooseInlineQueryResult({
    accountId: account.profile.id,
    inlineQueryId: inlineQuery.id,
    resultId: '1',
  });
  if (
    !chosen.chosen || chosen.message.kind !== 'supergroup_message' ||
    chosen.message.author.kind !== 'account' ||
    chosen.message.viaBot?.botId !== inlineBot.profile.id
  ) {
    throw new Error('Expected the result to be sent to the supergroup through the bot');
  }

  sharedChats.removeChatMember(SUPERGROUP.id, account.profile.id, { status: 'left' });
  const departed = inlineQueries.chooseInlineQueryResult({
    accountId: account.profile.id,
    inlineQueryId: inlineQuery.id,
    resultId: '1',
  });
  if (departed.chosen || departed.reason !== 'not_a_member') {
    throw new Error('Expected an account that left to be unable to send the result');
  }
});

Deno.test('InlineQueryService reuses an answer within its cache time', () => {
  const {
    virtualUsers,
    sharedChats,
    inlineQueries,
    publishedEvents,
    account,
    inlineBot,
    sendQuery,
    advanceClockMilliseconds,
  } = createInlineQueryFixture();
  sharedChats.registerSupergroup(SUPERGROUP, account.profile.id);
  const answered = sendQuery();
  inlineQueries.answerInlineQuery({
    fromBotId: inlineBot.profile.id,
    inlineQueryId: answered.id,
    results: [article('1')],
    cacheTimeSeconds: 10,
    isPersonal: false,
    nextOffset: '',
  });
  const publishedQueryCount = () =>
    publishedEvents.filter((event) => event.type === 'inline_query_created').length;
  const send = (input: {
    readonly fromAccountId?: number;
    readonly chat?: InlineQueryChat;
    readonly query?: string;
    readonly offset?: string;
  }) => {
    const result = inlineQueries.sendInlineQuery({
      fromAccountId: input.fromAccountId ?? account.profile.id,
      botId: inlineBot.profile.id,
      chat: input.chat ?? { type: 'private', botId: inlineBot.profile.id },
      query: input.query ?? 'cats',
      offset: input.offset ?? '',
    });
    if (!result.sent) {
      throw new Error(`Expected the query to be sent, received ${result.reason}`);
    }
    return result.inlineQuery;
  };

  advanceClockMilliseconds(9_000);
  const repeated = send({ query: ' cats\n' });
  const otherAccount = createAccount(virtualUsers, 'Grace');
  const fromOtherAccount = send({ fromAccountId: otherAccount.profile.id });
  if (
    repeated.state.status !== 'answered' || fromOtherAccount.state.status !== 'answered' ||
    repeated.id === answered.id || repeated.state.answer.results[0].id !== '1' ||
    publishedQueryCount() !== 1
  ) {
    throw new Error('Expected repeated queries to receive the cached answer unpublished');
  }
  const differentRequests = [
    send({ query: 'dogs' }),
    send({ offset: '10' }),
    send({ chat: { type: 'supergroup', chatId: SUPERGROUP.id } }),
  ];
  if (differentRequests.some((inlineQuery) => inlineQuery.state.status !== 'awaiting_answer')) {
    throw new Error('Expected other text, offsets and chat types to reach the bot');
  }

  // A reused answer expires with the original, however recently it was reused.
  advanceClockMilliseconds(1_000);
  if (send({}).state.status !== 'awaiting_answer') {
    throw new Error('Expected an expired answer to be asked for again');
  }
});

Deno.test('InlineQueryService reuses a personal answer only for its account', () => {
  const { virtualUsers, inlineQueries, account, inlineBot, sendQuery } = createInlineQueryFixture();
  const otherAccount = createAccount(virtualUsers, 'Grace');
  const answer = (inlineQueryId: string, input: Partial<AnswerInlineQueryInput>) =>
    inlineQueries.answerInlineQuery({
      fromBotId: inlineBot.profile.id,
      inlineQueryId,
      results: [article('1')],
      cacheTimeSeconds: 300,
      isPersonal: true,
      nextOffset: '',
      ...input,
    });
  answer(sendQuery().id, {});
  const send = (fromAccountId: number) => {
    const result = inlineQueries.sendInlineQuery({
      fromAccountId,
      botId: inlineBot.profile.id,
      chat: { type: 'private', botId: inlineBot.profile.id },
      query: 'cats',
      offset: '',
    });
    if (!result.sent) {
      throw new Error(`Expected the query to be sent, received ${result.reason}`);
    }
    return result.inlineQuery;
  };

  const ownRepeat = send(account.profile.id);
  const otherQuery = send(otherAccount.profile.id);
  if (ownRepeat.state.status !== 'answered' || otherQuery.state.status !== 'awaiting_answer') {
    throw new Error('Expected a personal answer to be reused only for its own account');
  }

  answer(otherQuery.id, { cacheTimeSeconds: 0, isPersonal: false });
  if (send(otherAccount.profile.id).state.status !== 'awaiting_answer') {
    throw new Error('Expected an answer with no cache time never to be reused');
  }
});

function article(
  id: string,
  text = `Result ${id}`,
): Extract<SpecifiedInlineQueryResult, { readonly kind: 'article' }> {
  return {
    kind: 'article',
    id,
    title: `Result ${id}`,
    description: '',
    url: '',
    messageContent: { kind: 'text', text },
  };
}

function createInlineQueryFixture() {
  const identities = new TelegramIdentityRepository();
  const accounts = new AccountRepository();
  const bots = new BotRepository();
  const virtualUsers = new VirtualUserService({ identities, accounts, bots });
  const messages = new MessageRepository();
  const files = new FileRepository();
  const polls = new PollRepository();
  const messageBoxes = new MessageBoxRepository();
  const sharedChats = new SharedChatRepository();
  const blockedUsers = new BlockedUserRepository();
  const publishedEvents: ChatDomainEvent[] = [];
  const events = { publish: (event: ChatDomainEvent) => publishedEvents.push(event) };
  const privateMessaging = new PrivateMessagingService({
    accounts,
    bots,
    privateConversations: new PrivateConversationRepository(),
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
  let currentTimeMilliseconds = 1_700_000_000_000;
  const inlineQueries = new InlineQueryService({
    accounts,
    bots,
    sharedChats,
    privateMessages: privateMessaging,
    supergroupMessages: supergroupMessaging,
    inlineQueries: new InlineQueryRepository(),
    events,
    currentTimeMilliseconds: () => currentTimeMilliseconds,
  });
  const account = createAccount(virtualUsers, 'Ada');
  const inlineBot = createBot(virtualUsers, 'inline_bot', { supports_inline_queries: true });

  const sendQuery = (
    chat: InlineQueryChat = { type: 'private', botId: inlineBot.profile.id },
  ) => {
    const result = inlineQueries.sendInlineQuery({
      fromAccountId: account.profile.id,
      botId: inlineBot.profile.id,
      chat,
      query: 'cats',
      offset: '',
    });
    if (!result.sent) {
      throw new Error(`Expected the fixture query to be sent, received ${result.reason}`);
    }
    return result.inlineQuery;
  };

  return {
    virtualUsers,
    files,
    sharedChats,
    blockedUsers,
    inlineQueries,
    publishedEvents,
    account,
    inlineBot,
    sendQuery,
    advanceClockMilliseconds: (milliseconds: number) => {
      currentTimeMilliseconds += milliseconds;
    },
  };
}

function createAccount(virtualUsers: VirtualUserService, firstName: string) {
  const result = virtualUsers.createAccount({ first_name: firstName });
  if (!result.created) {
    throw new Error(`Expected account creation to succeed, received ${result.reason}`);
  }
  return result.account;
}

function createBot(
  virtualUsers: VirtualUserService,
  username: string,
  { supports_inline_queries }: { readonly supports_inline_queries: boolean },
) {
  const result = virtualUsers.createBot({
    first_name: 'Test Bot',
    username,
    supports_inline_queries,
  });
  if (!result.created) {
    throw new Error(`Expected bot creation to succeed, received ${result.reason}`);
  }
  return result.bot;
}
