import { AccountRepository } from '../src/repositories/account.ts';
import { BlockedUserRepository } from '../src/repositories/blocked_user.ts';
import { BotRepository } from '../src/repositories/bot.ts';
import { FileRepository } from '../src/repositories/file.ts';
import { MessageBoxRepository } from '../src/repositories/message_box.ts';
import { MessageRepository } from '../src/repositories/message.ts';
import { PollRepository } from '../src/repositories/poll.ts';
import { PrivateConversationRepository } from '../src/repositories/private_conversation.ts';
import { SharedChatRepository } from '../src/repositories/shared_chat.ts';
import { TelegramIdentityRepository } from '../src/repositories/telegram_identity.ts';
import {
  type AccountChatMessageLookupResult,
  createAccountChatMessageReader,
} from '../src/services/account_chat_message.ts';
import { PrivateChatPolicy } from '../src/services/private_chat_policy.ts';
import { PrivateMessagingService } from '../src/services/private_messaging.ts';
import { SupergroupChatPolicy } from '../src/services/supergroup_chat_policy.ts';
import { SupergroupMessagingService } from '../src/services/supergroup_messaging.ts';
import { VirtualUserService } from '../src/services/virtual_user.ts';
import { ALL_CHAT_PERMISSIONS } from '../src/types/chat_permissions.ts';
import type { AccountChatAddress } from '../src/types/virtual_chat.ts';
import type { ChatMessage } from '../src/types/virtual_message.ts';

Deno.test('the account chat-message reader finds private chat messages by their ID in the bot message box', () => {
  const { reader, ada, stranger, bot, adaConversation, adaMessages } = createReaderFixture();
  const privateChat: AccountChatAddress = { type: 'private', botId: bot.profile.id };
  const find = (accountId: number, chat: AccountChatAddress, messageId: number) =>
    reader.findMessage({ accountId, chat, messageId });

  assertSameReasons(
    [
      find(999, privateChat, adaMessages.botReply.id),
      find(ada.profile.id, { type: 'private', botId: 999 }, adaMessages.botReply.id),
      find(stranger.profile.id, privateChat, adaMessages.botReply.id),
      find(ada.profile.id, privateChat, 99),
    ].map(describeLookup),
    ['account_not_found', 'bot_not_found', 'message_not_found', 'message_not_found'],
  );

  const result = find(ada.profile.id, privateChat, adaMessages.botReply.id);
  if (
    !result.found || result.message !== adaMessages.botReply.message ||
    result.chat !== adaConversation
  ) {
    throw new Error('Expected the message with the conversation that holds it');
  }
});

Deno.test('the account chat-message reader finds messages in a conversation a join request opened', () => {
  const { reader, privateConversations, grace, bot, adaMessages, gracePrompt } =
    createReaderFixture();
  const privateChat: AccountChatAddress = { type: 'private', botId: bot.profile.id };
  const graceConversation = { accountId: grace.profile.id, botId: bot.profile.id };

  const result = reader.findMessage({
    accountId: grace.profile.id,
    chat: privateChat,
    messageId: gracePrompt.id,
  });
  if (
    privateConversations.isPrivateConversationStarted(graceConversation) ||
    !result.found || result.message !== gracePrompt.message ||
    result.chat !== privateConversations.getPrivateConversation(graceConversation)
  ) {
    throw new Error("Expected the bot's prompt in Grace's opened, unstarted conversation");
  }
  // The bot's message box numbers the messages of all its private chats, so Ada's IDs name no
  // message of Grace's.
  assertSameReasons(
    [describeLookup(reader.findMessage({
      accountId: grace.profile.id,
      chat: privateChat,
      messageId: adaMessages.botReply.id,
    }))],
    ['message_not_found'],
  );
});

Deno.test('the account chat-message reader finds supergroup messages only for current members', () => {
  const { reader, ada, stranger, bot, basicGroupId, supergroup, adaMessages, supergroupMessage } =
    createReaderFixture();
  const supergroupChat: AccountChatAddress = { type: 'supergroup', chatId: supergroup.id };
  const find = (accountId: number, chat: AccountChatAddress, messageId: number) =>
    reader.findMessage({ accountId, chat, messageId });

  assertSameReasons(
    [
      find(999, supergroupChat, supergroupMessage.id),
      find(ada.profile.id, { type: 'supergroup', chatId: -1_000_000_009_999 }, 1),
      find(ada.profile.id, { type: 'supergroup', chatId: basicGroupId }, 1),
      find(stranger.profile.id, supergroupChat, 99),
      find(ada.profile.id, supergroupChat, 99),
    ].map(describeLookup),
    ['account_not_found', 'chat_not_found', 'chat_not_found', 'not_a_member', 'message_not_found'],
  );

  // The supergroup numbers its own messages, apart from the bot's private chats.
  const privateResult = find(
    ada.profile.id,
    { type: 'private', botId: bot.profile.id },
    supergroupMessage.id,
  );
  const result = find(ada.profile.id, supergroupChat, supergroupMessage.id);
  if (
    supergroupMessage.id !== adaMessages.start.id ||
    !privateResult.found || privateResult.message !== adaMessages.start.message ||
    !result.found || result.message !== supergroupMessage.message || result.chat !== supergroup
  ) {
    throw new Error('Expected each chat to find its own message by the same ID');
  }
});

/**
 * Ada started a private chat with a bot, which answered her, and owns a supergroup with one
 * message. Grace has a pending join request whose contact grant let the bot prompt her, which
 * opens her conversation without starting it. Hopper has neither chat.
 */
function createReaderFixture() {
  const identities = new TelegramIdentityRepository();
  const accounts = new AccountRepository();
  const bots = new BotRepository();
  const virtualUsers = new VirtualUserService({ identities, accounts, bots });
  const ada = createAccount(virtualUsers, 'Ada');
  const grace = createAccount(virtualUsers, 'Grace');
  const stranger = createAccount(virtualUsers, 'Hopper');
  const botCreation = virtualUsers.createBot({ first_name: 'Test Bot', username: 'test_bot' });
  if (!botCreation.created) {
    throw new Error(`Expected bot creation to succeed, received ${botCreation.reason}`);
  }
  const { bot } = botCreation;

  const privateConversations = new PrivateConversationRepository();
  const blockedUsers = new BlockedUserRepository();
  const joinRequesterContacts = {
    mayContactJoinRequester: (_botId: number, accountId: number) => accountId === grace.profile.id,
    claimJoinRequesterContact: () => {},
  };
  const sharedChats = new SharedChatRepository();
  const messages = new MessageRepository();
  const files = new FileRepository();
  const polls = new PollRepository();
  const messageBoxes = new MessageBoxRepository();
  const events = { publish: () => {} };
  const currentUnixTimeSeconds = () => 1_700_000_000;
  const privateMessaging = new PrivateMessagingService({
    accounts,
    bots,
    sharedChats,
    privateConversations,
    messages,
    files,
    polls,
    messageBoxes,
    blockedUsers,
    joinRequesterContacts,
    events,
    // No draft is shown in these chats; a bot's message has none to remove.
    messageDrafts: { clearBotDraft: () => {} },
    currentUnixTimeSeconds,
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
    currentUnixTimeSeconds,
  });

  const adaStart = privateMessaging.sendAccountMessage({
    fromAccountId: ada.profile.id,
    to: { type: 'private', botId: bot.profile.id },
    content: { kind: 'text', text: '/start' },
  });
  const adaBotReply = privateMessaging.sendBotMessage({
    fromBotId: bot.profile.id,
    to: { type: 'private', accountId: ada.profile.id },
    content: { kind: 'text', text: 'Hello' },
  });
  const gracePrompt = privateMessaging.sendBotMessage({
    fromBotId: bot.profile.id,
    to: { type: 'private', accountId: grace.profile.id },
    content: { kind: 'text', text: 'Press the button to join' },
  });
  if (!adaStart.sent || !adaBotReply.sent || !gracePrompt.sent) {
    throw new Error('Expected the fixture private messages to be sent');
  }
  const adaConversation = privateConversations.getPrivateConversation({
    accountId: ada.profile.id,
    botId: bot.profile.id,
  });

  const basicGroupId = -1;
  const basicGroupRegistration = sharedChats.registerBasicGroup(
    { kind: 'basic_group', id: basicGroupId, title: 'Friends' },
    ada.profile.id,
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
  const supergroupRegistration = sharedChats.registerSupergroup(supergroup, ada.profile.id);
  if (!basicGroupRegistration.registered || !supergroupRegistration.registered) {
    throw new Error('Expected the fixture chats to be registered');
  }
  const supergroupMessage = supergroupMessaging.sendAccountMessage({
    fromAccountId: ada.profile.id,
    chatId: supergroup.id,
    content: { kind: 'text', text: 'Welcome' },
  });
  if (!supergroupMessage.sent) {
    throw new Error('Expected the fixture supergroup message to be sent');
  }

  /** A message with the ID that its chat's message box gave it: the bot's, or the supergroup's. */
  const numbered = (boxId: number, message: ChatMessage) => {
    const id = messageBoxes.getMessageId(boxId, message.id);
    if (id === undefined) {
      throw new Error(`Expected message ${message.id} in message box ${boxId}`);
    }
    return { id, message };
  };

  return {
    reader: createAccountChatMessageReader({
      accounts,
      privateChats: new PrivateChatPolicy({
        accounts,
        bots,
        privateConversations,
        blockedUsers,
        joinRequesterContacts,
        privateMessages: privateMessaging,
      }),
      supergroups: new SupergroupChatPolicy({
        sharedChats,
        supergroupMessages: supergroupMessaging,
      }),
    }),
    privateConversations,
    ada,
    grace,
    stranger,
    bot,
    adaConversation,
    adaMessages: {
      start: numbered(bot.profile.id, adaStart.message),
      botReply: numbered(bot.profile.id, adaBotReply.message),
    },
    gracePrompt: numbered(bot.profile.id, gracePrompt.message),
    basicGroupId,
    supergroup,
    supergroupMessage: numbered(supergroup.id, supergroupMessage.message),
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
