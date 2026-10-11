import { assertEquals } from '@std/assert';
import {
  type AccountChatMessageLookupResult,
  createAccountChatMessageReader,
} from '../src/services/account_chat_message.ts';
import { ALL_CHAT_PERMISSIONS } from '../src/types/chat_permissions.ts';
import type { AccountChatAddress } from '../src/types/virtual_chat.ts';
import type { ChatMessage } from '../src/types/virtual_message.ts';
import { createChatMessagingServices } from './support/chat_messaging_services.ts';
import { createVirtualAccount, createVirtualBot } from './support/virtual_users.ts';

Deno.test('the account chat-message reader finds private chat messages by their ID in the bot message box', () => {
  const { reader, ada, stranger, bot, adaConversation, adaMessages } = createReaderFixture();
  const privateChat: AccountChatAddress = { type: 'private', botId: bot.profile.id };
  const find = (accountId: number, chat: AccountChatAddress, messageId: number) =>
    reader.findMessage({ accountId, chat, messageId });

  assertEquals(
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
  assertEquals(
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

  assertEquals(
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
  /** The accounts whose pending join request lets the bot contact them. */
  const joinRequesterIds = new Set<number>();
  const {
    virtualUsers,
    privateConversations,
    sharedChats,
    messageBoxes,
    messageSending,
    accounts,
    privateChats,
    supergroups,
  } = createChatMessagingServices({
    joinRequesterContacts: {
      mayContactJoinRequester: (_botId, accountId) => joinRequesterIds.has(accountId),
      claimJoinRequesterContact: () => {},
    },
  });
  const ada = createVirtualAccount(virtualUsers, { first_name: 'Ada' });
  const grace = createVirtualAccount(virtualUsers, { first_name: 'Grace' });
  joinRequesterIds.add(grace.profile.id);
  const stranger = createVirtualAccount(virtualUsers, { first_name: 'Hopper' });
  const bot = createVirtualBot(virtualUsers, { first_name: 'Test Bot', username: 'test_bot' });

  const adaStart = messageSending.sendAccountPrivateChatMessage({
    fromAccountId: ada.profile.id,
    chat: { type: 'private', peerId: bot.profile.id },
    content: { kind: 'text', text: '/start' },
  });
  const adaBotReply = messageSending.sendPrivateChatMessage({
    fromBotId: bot.profile.id,
    chat: { type: 'private', peerId: ada.profile.id },
    content: { kind: 'text', text: 'Hello' },
  });
  const gracePrompt = messageSending.sendPrivateChatMessage({
    fromBotId: bot.profile.id,
    chat: { type: 'private', peerId: grace.profile.id },
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
  const supergroupMessage = messageSending.sendAccountSupergroupMessage({
    fromAccountId: ada.profile.id,
    chat: { type: 'supergroup', chatId: supergroup.id },
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
    reader: createAccountChatMessageReader({ accounts, privateChats, supergroups }),
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

function describeLookup(result: AccountChatMessageLookupResult): string {
  return result.found ? 'found' : result.reason;
}
