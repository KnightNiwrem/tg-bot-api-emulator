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
import { PrivateChatPolicy } from '../src/services/private_chat_policy.ts';
import { PrivateMessagingService } from '../src/services/private_messaging.ts';
import { SupergroupChatPolicy } from '../src/services/supergroup_chat_policy.ts';
import { SupergroupMessagingService } from '../src/services/supergroup_messaging.ts';
import { VirtualUserService } from '../src/services/virtual_user.ts';
import { ALL_CHAT_PERMISSIONS } from '../src/types/chat_permissions.ts';
import { privateChatMessagePolicy, supergroupMessagePolicy } from '../src/types/chat_policy.ts';
import type {
  PrivateChatKey,
  PrivateConversationRole,
  Supergroup,
  SupergroupChatKey,
} from '../src/types/virtual_chat.ts';
import type {
  ChatMessage,
  PrivateMessage,
  SupergroupMessage,
} from '../src/types/virtual_message.ts';

Deno.test('private chats number messages in one box per participant, across its private chats', () => {
  const { privateMessaging, messageBoxes, ada, grace, bot, otherBot } = createChatPolicyFixture();
  const adaChat = privateChatKey(ada, bot);
  const adaOtherChat = privateChatKey(ada, otherBot);
  const graceChat = privateChatKey(grace, bot);
  const observedId = (chat: PrivateChatKey, role: PrivateConversationRole, message: ChatMessage) =>
    messageBoxes.getMessageId(
      privateChatMessagePolicy.getObserverBoxOwnerId(chat, role),
      message.id,
    );

  // Ada and Grace started their chats in the fixture; these messages interleave the three chats.
  const adaToBot = sendAccountText(privateMessaging, ada, bot, 'Ada to the bot');
  const graceToBot = sendAccountText(privateMessaging, grace, bot, 'Grace to the bot');
  const adaToOtherBot = sendAccountText(privateMessaging, ada, otherBot, 'Ada to the other bot');
  const botToAda = sendBotText(privateMessaging, bot, ada, 'The bot to Ada');
  const otherBotToAda = sendBotText(privateMessaging, otherBot, ada, 'The other bot to Ada');
  const botToGrace = sendBotText(privateMessaging, bot, grace, 'The bot to Grace');

  assertEquals(privateChatMessagePolicy.getNumberingBoxOwnerIds(adaChat), [ada, bot]);
  assertEquals(
    [
      observedId(adaChat, 'account', adaToBot),
      observedId(adaOtherChat, 'account', adaToOtherBot),
      observedId(adaChat, 'account', botToAda),
      observedId(adaOtherChat, 'account', otherBotToAda),
    ],
    [1, 2, 3, 4],
  );
  assertEquals(
    [
      observedId(adaChat, 'bot', adaToBot),
      observedId(graceChat, 'bot', graceToBot),
      observedId(adaChat, 'bot', botToAda),
      observedId(graceChat, 'bot', botToGrace),
    ],
    [1, 2, 3, 4],
  );
  assertEquals(
    [
      observedId(adaOtherChat, 'bot', adaToOtherBot),
      observedId(adaOtherChat, 'bot', otherBotToAda),
    ],
    [1, 2],
  );
  assertEquals(
    [observedId(graceChat, 'account', graceToBot), observedId(graceChat, 'account', botToGrace)],
    [1, 2],
  );
});

Deno.test('a private chat finds its messages by bot box ID, but not by the IDs of other chats', () => {
  const { privateMessaging, privateChats, messageBoxes, ada, grace, bot } =
    createChatPolicyFixture();
  const adaChat = privateChatKey(ada, bot);
  const graceChat = privateChatKey(grace, bot);
  const adaMessage = sendAccountText(privateMessaging, ada, bot, 'Ada to the bot');
  const graceMessage = sendAccountText(privateMessaging, grace, bot, 'Grace to the bot');
  const botBoxId = (message: ChatMessage) => requireMessageId(messageBoxes, bot, message);

  assertEquals(
    [
      privateChats.findMessageByChatMessageId(adaChat, botBoxId(adaMessage))?.id,
      privateChats.findMessageByChatMessageId(graceChat, botBoxId(graceMessage))?.id,
      privateChats.findMessageByChatMessageId(graceChat, botBoxId(adaMessage)),
      privateChats.findMessageByChatMessageId(adaChat, botBoxId(graceMessage)),
    ],
    [adaMessage.id, graceMessage.id, undefined, undefined],
  );

  const deletion = privateMessaging.deleteAccountMessage({
    fromAccountId: ada,
    botId: bot,
    botMessageId: botBoxId(adaMessage),
  });
  const laterMessage = sendAccountText(privateMessaging, ada, bot, 'Ada again');
  assertEquals(
    [
      deletion.deleted,
      privateChats.findMessageByChatMessageId(adaChat, botBoxId(adaMessage)),
      botBoxId(laterMessage) > botBoxId(graceMessage),
    ],
    [true, undefined, true],
  );
});

Deno.test('a private chat address identifies an existing peer without deciding access', () => {
  const { privateMessaging, privateChats, blockedUsers, ada, grace, hopper, bot } =
    createChatPolicyFixture();
  const identifyForBot = (accountId: number) =>
    privateChats.identifyChatForBot(bot, { type: 'private', peerId: accountId });

  assertEquals(
    [
      describeIdentification(
        privateChats.identifyChatForAccount(ada, { type: 'private', peerId: 999 }),
      ),
      describeIdentification(identifyForBot(999)),
    ],
    ['bot_not_found', 'account_not_found'],
  );

  // Hopper never wrote to the bot, but a pending join request lets the bot contact him.
  const hopperIdentification = identifyForBot(hopper);
  if (!hopperIdentification.identified) {
    throw new Error(`Expected Hopper's chat to be identified, received a refusal`);
  }
  const hopperChat = hopperIdentification.key;
  const accessBeforeContact = describeAccess(privateChats, hopperChat);
  const prompt = privateMessaging.sendBotMessage({
    fromBotId: bot,
    to: { type: 'private', accountId: hopper },
    content: { kind: 'text', text: 'Press the button to join' },
  });
  blockedUsers.block(ada, bot);
  assertEquals(
    [
      hopperChat,
      accessBeforeContact,
      prompt.sent,
      describeAccess(privateChats, hopperChat),
      describeAccess(privateChats, privateChatKey(ada, bot)),
      describeAccess(privateChats, privateChatKey(grace, bot)),
    ],
    [
      privateChatKey(hopper, bot),
      { exists: false, started: false, blocked: false, contactable: true },
      true,
      { exists: true, started: false, blocked: false, contactable: true },
      { exists: true, started: true, blocked: true, contactable: false },
      { exists: true, started: true, blocked: false, contactable: false },
    ],
  );
});

Deno.test('private chat updates reach the bot except for its own content messages', () => {
  const { privateMessaging, ada, bot } = createChatPolicyFixture();
  const accountMessage = sendAccountText(privateMessaging, ada, bot, 'Hello');
  const botMessage = sendBotText(privateMessaging, bot, ada, 'Hi');
  const recordPin = (authorRole: PrivateConversationRole) =>
    privateMessaging.recordServiceMessage({
      conversation: { accountId: ada, botId: bot },
      authorRole,
      content: { kind: 'message_pinned', pinnedMessageId: botMessage.id },
      isSilent: true,
    });

  assertEquals(
    [accountMessage, botMessage, recordPin('bot'), recordPin('account')].map((message) =>
      privateChatMessagePolicy.selectMessageRecipientBotIds(message)
    ),
    [[bot], [], [bot], [bot]],
  );
});

Deno.test('a supergroup numbers its messages in one box of its own, which every member observes', () => {
  const { privateMessaging, supergroupMessaging, sharedChats, messageBoxes, ada, bot } =
    createChatPolicyFixture();
  const team = registerSupergroup(sharedChats, ada, TEAM);
  const club = registerSupergroup(sharedChats, ada, CLUB);
  sharedChats.addChatMember(TEAM.id, bot);
  const teamChat: SupergroupChatKey = { type: 'supergroup', chatId: team.id };
  const clubChat: SupergroupChatKey = { type: 'supergroup', chatId: club.id };

  const teamFirst = sendSupergroupText(supergroupMessaging, ada, team, 'First in the team');
  const privateMessage = sendAccountText(privateMessaging, ada, bot, 'Between the groups');
  const clubFirst = sendSupergroupText(supergroupMessaging, ada, club, 'First in the club');
  const teamSecond = sendSupergroupText(supergroupMessaging, ada, team, 'Second in the team');
  const observedId = (chat: SupergroupChatKey, message: ChatMessage) =>
    messageBoxes.getMessageId(
      supergroupMessagePolicy.getObserverBoxOwnerId(chat, 'member'),
      message.id,
    );

  assertEquals(
    [
      supergroupMessagePolicy.getNumberingBoxOwnerIds(teamChat),
      observedId(teamChat, teamFirst),
      observedId(teamChat, teamSecond),
      observedId(clubChat, clubFirst),
      messageBoxes.getMessageId(bot, teamFirst.id),
      requireMessageId(messageBoxes, bot, privateMessage),
    ],
    [[team.id], 1, 2, 1, undefined, 1],
  );
});

Deno.test('a supergroup finds its messages by its own IDs and rejects IDs it never numbered', () => {
  const { supergroupMessaging, supergroups, sharedChats, ada } = createChatPolicyFixture();
  const team = registerSupergroup(sharedChats, ada, TEAM);
  const club = registerSupergroup(sharedChats, ada, CLUB);
  const teamFirst = sendSupergroupText(supergroupMessaging, ada, team, 'First in the team');
  const teamSecond = sendSupergroupText(supergroupMessaging, ada, team, 'Second in the team');
  const clubFirst = sendSupergroupText(supergroupMessaging, ada, club, 'First in the club');
  const find = (supergroup: Supergroup, messageId: number) =>
    supergroups.findMessageByChatMessageId(
      { type: 'supergroup', chatId: supergroup.id },
      messageId,
    )?.id;

  assertEquals(
    [find(team, 1), find(club, 1), find(team, 2), find(club, 2)],
    [teamFirst.id, clubFirst.id, teamSecond.id, undefined],
  );
});

Deno.test('a supergroup address identifies an existing supergroup; membership decides access', () => {
  const { supergroups, sharedChats, ada, grace, bot, otherBot } = createChatPolicyFixture();
  registerSupergroup(sharedChats, ada, TEAM);
  const basicGroupId = -1;
  sharedChats.registerBasicGroup(
    { kind: 'basic_group', id: basicGroupId, title: 'Friends' },
    ada,
    [],
  );
  const identify = (chatId: number) =>
    supergroups.identifyChatForBot(bot, { type: 'supergroup', chatId });
  const identification = identify(TEAM.id);
  if (!identification.identified) {
    throw new Error(`Expected the team to be identified, received ${identification.reason}`);
  }
  const { supergroup } = identification;
  const neverJoined = supergroups.resolveBotMembership(bot, supergroup);
  sharedChats.addChatMember(TEAM.id, bot);
  const joined = supergroups.resolveBotMembership(bot, supergroup);
  sharedChats.removeChatMember(TEAM.id, bot, { status: 'left' });
  const left = supergroups.resolveBotMembership(bot, supergroup);
  sharedChats.addChatMember(TEAM.id, otherBot);
  sharedChats.removeChatMember(TEAM.id, otherBot, { status: 'kicked' });

  assertEquals(
    [
      identification.key,
      describeIdentification(identify(-1_000_000_009_999)),
      describeIdentification(
        supergroups.identifyChatForAccount(ada, { type: 'supergroup', chatId: basicGroupId }),
      ),
      describeMembership(supergroups.resolveAccountMembership(ada, supergroup)),
      describeMembership(supergroups.resolveAccountMembership(grace, supergroup)),
      describeMembership(neverJoined),
      describeMembership(joined),
      describeMembership(left),
      describeMembership(supergroups.resolveBotMembership(otherBot, supergroup)),
    ],
    [
      { type: 'supergroup', chatId: TEAM.id },
      'chat_not_found',
      'chat_not_found',
      'member',
      'not_a_member',
      'chat_not_found',
      'member',
      'bot_not_a_member',
      'bot_kicked',
    ],
  );
});

Deno.test('supergroup service messages reach every member, their author and a departed member', () => {
  const { supergroupMessaging, sharedChats, ada, grace, bot, otherBot } = createChatPolicyFixture();
  registerSupergroup(sharedChats, ada, TEAM);
  for (const memberId of [grace, bot, otherBot]) {
    sharedChats.addChatMember(TEAM.id, memberId);
  }
  const recipients = (message: SupergroupMessage) =>
    supergroupMessagePolicy.selectServiceMessageRecipientIds(
      message,
      sharedChats.getChatMemberIds(TEAM.id),
    );

  const titleChange = supergroupMessaging.recordServiceMessage({
    chatId: TEAM.id,
    author: { kind: 'bot', botId: bot },
    content: { kind: 'title_changed', title: 'Renamed' },
    changedAtUnixSeconds: NOW,
    isSilent: false,
  });
  const titleChangeRecipients = recipients(titleChange);
  sharedChats.removeChatMember(TEAM.id, otherBot, { status: 'kicked' });
  const removal = supergroupMessaging.recordServiceMessage({
    chatId: TEAM.id,
    author: { kind: 'bot', botId: bot },
    content: { kind: 'member_left', memberId: otherBot },
    changedAtUnixSeconds: NOW,
    isSilent: false,
  });

  assertEquals(
    [titleChangeRecipients, sharedChats.getChatMemberIds(TEAM.id), recipients(removal)],
    [[ada, grace, bot, otherBot], [ada, grace, bot], [ada, grace, bot, otherBot]],
  );
});

const NOW = 1_700_000_000;

const TEAM = {
  kind: 'supergroup',
  id: -1_000_000_000_001,
  title: 'Team',
  chatInstance: '-42',
  hasProtectedContent: false,
  defaultPermissions: ALL_CHAT_PERMISSIONS,
} as const satisfies Supergroup;

const CLUB = {
  ...TEAM,
  id: -1_000_000_000_002,
  title: 'Club',
  chatInstance: '-43',
} as const satisfies Supergroup;

/**
 * Ada and Grace started private chats with a bot, and Ada with another bot; Hopper has a pending
 * join request, which lets the bot contact him, and no chat. No supergroup exists yet.
 */
function createChatPolicyFixture() {
  const identities = new TelegramIdentityRepository();
  const accounts = new AccountRepository();
  const bots = new BotRepository();
  const virtualUsers = new VirtualUserService({ identities, accounts, bots });
  const ada = createAccountId(virtualUsers, 'Ada');
  const grace = createAccountId(virtualUsers, 'Grace');
  const hopper = createAccountId(virtualUsers, 'Hopper');
  const bot = createBotId(virtualUsers, 'test_bot');
  const otherBot = createBotId(virtualUsers, 'other_bot');

  const privateConversations = new PrivateConversationRepository();
  const blockedUsers = new BlockedUserRepository();
  const joinRequesterContacts = {
    mayContactJoinRequester: (_botId: number, accountId: number) => accountId === hopper,
    claimJoinRequesterContact: () => {},
  };
  const sharedChats = new SharedChatRepository();
  const messages = new MessageRepository();
  const files = new FileRepository();
  const polls = new PollRepository();
  const messageBoxes = new MessageBoxRepository();
  const events = { publish: () => {} };
  const currentUnixTimeSeconds = () => NOW;
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

  for (const [accountId, botId] of [[ada, bot], [grace, bot], [ada, otherBot]]) {
    const start = privateMessaging.activatePrivateConversation({ accountId, botId });
    if (!start.activated) {
      throw new Error(`Expected the fixture conversation to start, received ${start.reason}`);
    }
  }

  return {
    privateMessaging,
    supergroupMessaging,
    privateChats: new PrivateChatPolicy({
      accounts,
      bots,
      privateConversations,
      blockedUsers,
      joinRequesterContacts,
      privateMessages: privateMessaging,
    }),
    supergroups: new SupergroupChatPolicy({ sharedChats, supergroupMessages: supergroupMessaging }),
    sharedChats,
    blockedUsers,
    messageBoxes,
    ada,
    grace,
    hopper,
    bot,
    otherBot,
  };
}

function privateChatKey(accountId: number, botId: number): PrivateChatKey {
  return { type: 'private', conversation: { accountId, botId } };
}

function registerSupergroup(
  sharedChats: SharedChatRepository,
  ownerId: number,
  supergroup: Supergroup,
): Supergroup {
  const registration = sharedChats.registerSupergroup(supergroup, ownerId);
  if (!registration.registered) {
    throw new Error(`Expected supergroup ${supergroup.id} to be registered`);
  }
  return supergroup;
}

function sendAccountText(
  privateMessaging: PrivateMessagingService,
  accountId: number,
  botId: number,
  text: string,
): PrivateMessage {
  const result = privateMessaging.sendAccountMessage({
    fromAccountId: accountId,
    to: { type: 'private', botId },
    content: { kind: 'text', text },
  });
  if (!result.sent) {
    throw new Error(`Expected the account's message to be sent, received ${result.reason}`);
  }
  return result.message;
}

function sendBotText(
  privateMessaging: PrivateMessagingService,
  botId: number,
  accountId: number,
  text: string,
): PrivateMessage {
  const result = privateMessaging.sendBotMessage({
    fromBotId: botId,
    to: { type: 'private', accountId },
    content: { kind: 'text', text },
  });
  if (!result.sent) {
    throw new Error(`Expected the bot's message to be sent, received ${result.reason}`);
  }
  return result.message;
}

function sendSupergroupText(
  supergroupMessaging: SupergroupMessagingService,
  accountId: number,
  supergroup: Supergroup,
  text: string,
) {
  const result = supergroupMessaging.sendAccountMessage({
    fromAccountId: accountId,
    chatId: supergroup.id,
    content: { kind: 'text', text },
  });
  if (!result.sent) {
    throw new Error(`Expected the supergroup message to be sent, received ${result.reason}`);
  }
  return result.message;
}

function requireMessageId(
  messageBoxes: MessageBoxRepository,
  boxOwnerId: number,
  message: ChatMessage,
): number {
  const messageId = messageBoxes.getMessageId(boxOwnerId, message.id);
  if (messageId === undefined) {
    throw new Error(`Expected message ${message.id} in the message box of ${boxOwnerId}`);
  }
  return messageId;
}

function describeIdentification(
  identification: { readonly identified: true } | {
    readonly identified: false;
    readonly reason: string;
  },
): string {
  return identification.identified ? 'identified' : identification.reason;
}

function describeMembership(
  resolution: { readonly member: true } | { readonly member: false; readonly reason: string },
): string {
  return resolution.member ? 'member' : resolution.reason;
}

function describeAccess(privateChats: PrivateChatPolicy, chat: PrivateChatKey) {
  return {
    exists: privateChats.findConversation(chat) !== undefined,
    started: privateChats.isConversationStarted(chat),
    blocked: privateChats.isBotBlocked(chat),
    contactable: privateChats.mayBotContactJoinRequester(chat),
  };
}

function createAccountId(virtualUsers: VirtualUserService, firstName: string): number {
  const result = virtualUsers.createAccount({ first_name: firstName });
  if (!result.created) {
    throw new Error(`Expected account creation to succeed, received ${result.reason}`);
  }
  return result.account.profile.id;
}

function createBotId(virtualUsers: VirtualUserService, username: string): number {
  const result = virtualUsers.createBot({ first_name: username, username });
  if (!result.created) {
    throw new Error(`Expected bot creation to succeed, received ${result.reason}`);
  }
  return result.bot.profile.id;
}

function assertEquals(actual: unknown, expected: unknown): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
  }
}
