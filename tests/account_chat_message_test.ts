import { AccountRepository } from '../src/repositories/account.ts';
import { BotRepository } from '../src/repositories/bot.ts';
import { MessageRepository } from '../src/repositories/message.ts';
import { PrivateConversationRepository } from '../src/repositories/private_conversation.ts';
import { SharedChatRepository } from '../src/repositories/shared_chat.ts';
import { TelegramIdentityRepository } from '../src/repositories/telegram_identity.ts';
import {
  type AccountChatMessageLookupResult,
  type AccountMessageChat,
  findAccountChatMessage,
} from '../src/services/account_chat_message.ts';
import { VirtualUserService } from '../src/services/virtual_user.ts';
import { ALL_CHAT_PERMISSIONS } from '../src/types/chat_permissions.ts';

const BOT_MESSAGE_ID = 1;
const SUPERGROUP_MESSAGE_ID = 1;

Deno.test('findAccountChatMessage finds a private chat message once the account started the chat', () => {
  const { find, account, stranger, bot, conversation, privateMessage } = createLookupFixture();
  const privateChat: AccountMessageChat = { type: 'private', botId: bot.profile.id };

  const failures = [
    find(account.profile.id, { type: 'private', botId: 999 }, BOT_MESSAGE_ID),
    find(stranger.profile.id, privateChat, BOT_MESSAGE_ID),
    find(account.profile.id, privateChat, 99),
  ].map(describeLookup);
  assertSameReasons(failures, ['bot_not_found', 'message_not_found', 'message_not_found']);

  const result = find(account.profile.id, privateChat, BOT_MESSAGE_ID);
  if (!result.found || result.message !== privateMessage || result.chat !== conversation) {
    throw new Error('Expected the message with the conversation that holds it');
  }
});

Deno.test('findAccountChatMessage finds a supergroup message only for current members', () => {
  const { find, account, stranger, basicGroupId, supergroup, supergroupMessage } =
    createLookupFixture();
  const supergroupChat: AccountMessageChat = { type: 'supergroup', chatId: supergroup.id };

  const failures = [
    find(account.profile.id, { type: 'supergroup', chatId: -1_000_000_009_999 }, 1),
    find(account.profile.id, { type: 'supergroup', chatId: basicGroupId }, 1),
    find(stranger.profile.id, supergroupChat, 99),
    find(account.profile.id, supergroupChat, 99),
  ].map(describeLookup);
  assertSameReasons(failures, [
    'chat_not_found',
    'chat_not_found',
    'not_a_member',
    'message_not_found',
  ]);

  const result = find(account.profile.id, supergroupChat, SUPERGROUP_MESSAGE_ID);
  if (!result.found || result.message !== supergroupMessage || result.chat !== supergroup) {
    throw new Error('Expected the message with the supergroup that holds it');
  }
});

/**
 * Ada has started a private chat with a bot, which sent her one message, and owns a supergroup
 * with one message; Grace has neither. Message stores find their message by its ID alone, so only
 * the lookup's own checks keep Grace from reaching them.
 */
function createLookupFixture() {
  const bots = new BotRepository();
  const virtualUsers = new VirtualUserService({
    identities: new TelegramIdentityRepository(),
    accounts: new AccountRepository(),
    bots,
  });
  const account = createAccount(virtualUsers, 'Ada');
  const stranger = createAccount(virtualUsers, 'Grace');
  const botCreation = virtualUsers.createBot({ first_name: 'Test Bot', username: 'test_bot' });
  if (!botCreation.created) {
    throw new Error(`Expected bot creation to succeed, received ${botCreation.reason}`);
  }
  const { bot } = botCreation;

  const privateConversations = new PrivateConversationRepository();
  const conversation = privateConversations.startPrivateConversation({
    accountId: account.profile.id,
    botId: bot.profile.id,
  });
  const messages = new MessageRepository();
  const privateMessage = messages.addPrivateMessage({
    conversation,
    authorRole: 'bot',
    sentAtUnixSeconds: 1_700_000_000,
    content: { kind: 'text', text: 'Hello', entities: [] },
  });

  const sharedChats = new SharedChatRepository();
  const basicGroupId = -1;
  const basicGroupRegistration = sharedChats.registerBasicGroup(
    { kind: 'basic_group', id: basicGroupId, title: 'Friends' },
    account.profile.id,
    [],
  );
  const supergroup = {
    kind: 'supergroup',
    id: -1_000_000_000_001,
    title: 'Team',
    chatInstance: '-42',
    hasProtectedContent: false,
    defaultPermissions: ALL_CHAT_PERMISSIONS,
  } as const;
  const supergroupRegistration = sharedChats.registerSupergroup(supergroup, account.profile.id);
  if (!basicGroupRegistration.registered || !supergroupRegistration.registered) {
    throw new Error('Expected the fixture chats to be registered');
  }
  const supergroupMessage = messages.addSupergroupMessage({
    chatId: supergroup.id,
    author: { kind: 'account', accountId: account.profile.id },
    sentAtUnixSeconds: 1_700_000_000,
    content: { kind: 'text', text: 'Welcome', entities: [] },
  });

  const lookups = {
    bots,
    privateConversations,
    privateMessages: {
      getPrivateMessageByBotMessageId: (_conversation: unknown, botMessageId: number) =>
        botMessageId === BOT_MESSAGE_ID ? privateMessage : undefined,
    },
    sharedChats,
    supergroupMessages: {
      getMessageByChatMessageId: (_chatId: number, messageId: number) =>
        messageId === SUPERGROUP_MESSAGE_ID ? supergroupMessage : undefined,
    },
  };
  return {
    find: (accountId: number, chat: AccountMessageChat, messageId: number) =>
      findAccountChatMessage(lookups, accountId, chat, messageId),
    account,
    stranger,
    bot,
    conversation,
    privateMessage,
    basicGroupId,
    supergroup,
    supergroupMessage,
  };
}

function createAccount(virtualUsers: VirtualUserService, firstName: string) {
  const result = virtualUsers.createAccount({ first_name: firstName });
  if (!result.created) {
    throw new Error(`Expected account creation to succeed, received ${result.reason}`);
  }
  return result.account;
}

function describeLookup(result: AccountChatMessageLookupResult): string {
  return result.found ? 'found' : result.reason;
}

function assertSameReasons(actual: readonly string[], expected: readonly string[]): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
  }
}
