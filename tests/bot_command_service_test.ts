import { AccountRepository } from '../src/repositories/account.ts';
import { BotRepository } from '../src/repositories/bot.ts';
import { BotCommandRepository } from '../src/repositories/bot_command.ts';
import { PrivateConversationRepository } from '../src/repositories/private_conversation.ts';
import { SharedChatRepository } from '../src/repositories/shared_chat.ts';
import { TelegramIdentityRepository } from '../src/repositories/telegram_identity.ts';
import {
  BotCommandService,
  type SetBotCommandsResult,
  type SpecifiedBotCommand,
} from '../src/services/bot_command.ts';
import { VirtualUserService } from '../src/services/virtual_user.ts';
import type { BotCommand, BotCommandScope } from '../src/types/bot_command.ts';
import { ALL_CHAT_PERMISSIONS } from '../src/types/chat_permissions.ts';

Deno.test('BotCommandService stores commands cleaned and trimmed as Telegram does', () => {
  const { botCommands, bot } = createBotCommandFixture();

  const result = botCommands.setBotCommands({
    botId: bot.profile.id,
    scope: { type: 'default' },
    languageCode: '',
    commands: [
      specifiedCommand(' /start\t', '  Start\tover  '),
      { command: 'help', description: 'Show help', isEphemeral: true },
    ],
  });
  assertSet(result);
  assertCommands(
    botCommands.getBotCommands({
      botId: bot.profile.id,
      scope: { type: 'default' },
      languageCode: '',
    }),
    [
      { command: 'start', description: 'Start over', isEphemeral: false },
      { command: 'help', description: 'Show help', isEphemeral: true },
    ],
  );
});

Deno.test('BotCommandService rejects commands in Telegram order without changing the list', () => {
  const { botCommands, bot } = createBotCommandFixture();
  const target = { botId: bot.profile.id, scope: { type: 'default' } as const, languageCode: '' };
  assertSet(botCommands.setBotCommands({ ...target, commands: [specifiedCommand('start', 'Go')] }));

  const cases: ReadonlyArray<readonly [readonly SpecifiedBotCommand[], string]> = [
    [[specifiedCommand('\ud800', '')], 'command_not_utf8'],
    [[specifiedCommand('ok', '\ud800')], 'command_description_not_utf8'],
    [[specifiedCommand(' / ', 'Slash only')], 'command_empty'],
    [[specifiedCommand('c'.repeat(33), '')], 'command_too_long'],
    [[specifiedCommand('ok', ' ')], 'command_description_empty'],
    [[specifiedCommand('ok', 'd'.repeat(257))], 'command_description_too_long'],
    // Each command passes TDLib's checks before the server limits count and characters.
    [[specifiedCommand('Start', 'Go'), specifiedCommand('', 'Go')], 'command_empty'],
    [
      Array.from({ length: 101 }, (_, index) => specifiedCommand(`Command${index}`, 'Go')),
      'too_many_commands',
    ],
    [[specifiedCommand('start-over', 'Go')], 'command_invalid'],
    [[specifiedCommand('Start', 'Go')], 'command_invalid'],
  ];
  for (const [commands, expectedReason] of cases) {
    const result = botCommands.setBotCommands({ ...target, commands });
    if (result.set || result.reason !== expectedReason) {
      throw new Error(`Expected ${expectedReason}, received ${JSON.stringify(result)}`);
    }
  }
  assertSet(
    botCommands.setBotCommands({
      ...target,
      commands: [specifiedCommand('c'.repeat(32), 'd'.repeat(256))],
    }),
  );
  assertCommands(botCommands.getBotCommands(target), [
    { command: 'c'.repeat(32), description: 'd'.repeat(256), isEphemeral: false },
  ]);
});

Deno.test('BotCommandService checks scopes and languages before commands', () => {
  const { botCommands, virtualUsers, privateConversations, bot, account } =
    createBotCommandFixture();
  const stranger = createAccount(virtualUsers, 'Grace');
  privateConversations.getOrCreatePrivateConversation({
    accountId: account.profile.id,
    botId: bot.profile.id,
  });
  const invalidCommands = [specifiedCommand('', '')];
  const cases: ReadonlyArray<readonly [BotCommandScope, string, string]> = [
    [{ type: 'chat', chatId: stranger.profile.id }, 'english', 'chat_not_found'],
    [{ type: 'chat', chatId: -100 }, '', 'chat_not_found'],
    [
      { type: 'chat_administrators', chatId: account.profile.id },
      'english',
      'scope_not_allowed_in_private_chats',
    ],
    [
      {
        type: 'chat_member',
        chatId: account.profile.id,
        userId: account.profile.id,
      },
      '',
      'scope_not_allowed_in_private_chats',
    ],
    [{ type: 'chat', chatId: account.profile.id }, 'EN', 'language_code_invalid'],
    [{ type: 'all_group_chats' }, 'eng', 'language_code_invalid'],
    [{ type: 'all_private_chats' }, 'en', 'command_empty'],
  ];
  for (const [scope, languageCode, expectedReason] of cases) {
    const result = botCommands.setBotCommands({
      botId: bot.profile.id,
      scope,
      languageCode,
      commands: invalidCommands,
    });
    if (result.set || result.reason !== expectedReason) {
      throw new Error(
        `Expected ${
          JSON.stringify(scope)
        } in ${languageCode} to fail with ${expectedReason}, received ${JSON.stringify(result)}`,
      );
    }
    const readResult = botCommands.getBotCommands({ botId: bot.profile.id, scope, languageCode });
    if (
      expectedReason !== 'command_empty' &&
      (readResult.found || readResult.reason !== expectedReason)
    ) {
      throw new Error(`Expected getBotCommands to fail with ${expectedReason} as well`);
    }
  }
});

Deno.test('BotCommandService keeps a list per scope and language, and empty lists delete', () => {
  const { botCommands, bot } = createBotCommandFixture();
  const set = (scope: BotCommandScope, languageCode: string, commands: readonly string[]) =>
    assertSet(botCommands.setBotCommands({
      botId: bot.profile.id,
      scope,
      languageCode,
      commands: commands.map((command) => specifiedCommand(command, command)),
    }));
  const listed = (scope: BotCommandScope, languageCode: string) => {
    const result = botCommands.getBotCommands({ botId: bot.profile.id, scope, languageCode });
    if (!result.found) {
      throw new Error(`Expected the list to be readable, received ${result.reason}`);
    }
    return result.commands.map(({ command }) => command);
  };

  set({ type: 'default' }, '', ['start']);
  set({ type: 'default' }, 'de', ['starten']);
  set({ type: 'all_private_chats' }, '', ['private']);
  if (
    JSON.stringify([
      listed({ type: 'default' }, ''),
      listed({ type: 'default' }, 'de'),
      listed(
        { type: 'all_private_chats' },
        '',
      ),
      listed({ type: 'all_private_chats' }, 'de'),
    ]) !==
      JSON.stringify([['start'], ['starten'], ['private'], []])
  ) {
    throw new Error('Expected each scope and language to keep its own list, without fallback');
  }

  set({ type: 'default' }, 'de', []);
  const deletion = botCommands.deleteBotCommands({
    botId: bot.profile.id,
    scope: { type: 'default' },
    languageCode: '',
  });
  if (
    !deletion.deleted || listed({ type: 'default' }, 'de').length !== 0 ||
    listed({ type: 'default' }, '').length !== 0
  ) {
    throw new Error('Expected an empty list and deleteBotCommands to remove lists');
  }
});

Deno.test('BotCommandService resolves the commands an account sees in its private chat', () => {
  const { botCommands, virtualUsers, privateConversations, bot, account } =
    createBotCommandFixture();
  const germanAccount = createAccount(virtualUsers, 'Emmy', 'de-DE');
  for (const { profile } of [account, germanAccount]) {
    privateConversations.getOrCreatePrivateConversation({
      accountId: profile.id,
      botId: bot.profile.id,
    });
  }
  const seenBy = (accountId: number) => {
    const result = botCommands.getPrivateChatCommands({ accountId, botId: bot.profile.id });
    if (!result.found) {
      throw new Error(`Expected the account to see commands, received ${result.reason}`);
    }
    return result.commands.map(({ command }) => command).join();
  };
  const set = (scope: BotCommandScope, languageCode: string, command: string) =>
    assertSet(botCommands.setBotCommands({
      botId: bot.profile.id,
      scope,
      languageCode,
      commands: [specifiedCommand(command, command)],
    }));

  if (seenBy(account.profile.id) !== '') {
    throw new Error('Expected no commands before the bot sets any');
  }
  set({ type: 'default' }, '', 'default');
  set({ type: 'default' }, 'de', 'default_de');
  if (
    seenBy(account.profile.id) !== 'default' || seenBy(germanAccount.profile.id) !== 'default_de'
  ) {
    throw new Error('Expected the default list in the account language to be preferred');
  }
  set({ type: 'all_group_chats' }, '', 'groups');
  set({ type: 'all_private_chats' }, '', 'private');
  if (seenBy(account.profile.id) !== 'private' || seenBy(germanAccount.profile.id) !== 'private') {
    throw new Error('Expected a private chats list in any language to beat the default scope');
  }
  set({ type: 'chat', chatId: germanAccount.profile.id }, '', 'chat');
  if (seenBy(account.profile.id) !== 'private' || seenBy(germanAccount.profile.id) !== 'chat') {
    throw new Error("Expected a chat's own list to apply only to that chat");
  }

  const missing = botCommands.getPrivateChatCommands({ accountId: 999, botId: bot.profile.id });
  if (missing.found || missing.reason !== 'account_not_found') {
    throw new Error('Expected an unknown account to be reported');
  }
});

Deno.test('BotCommandService addresses supergroups the bot is a member of', () => {
  const { botCommands, sharedChats, bot, account } = createBotCommandFixture();
  const joinedChatId = registerSupergroup(sharedChats, -1_000_000_000_101, account.profile.id);
  const leftChatId = registerSupergroup(sharedChats, -1_000_000_000_102, account.profile.id);
  const bannedChatId = registerSupergroup(sharedChats, -1_000_000_000_103, account.profile.id);
  const strangeChatId = registerSupergroup(sharedChats, -1_000_000_000_104, account.profile.id);
  for (const chatId of [joinedChatId, leftChatId, bannedChatId]) {
    sharedChats.addChatMember(chatId, bot.profile.id);
  }
  sharedChats.removeChatMember(leftChatId, bot.profile.id, { status: 'left' });
  sharedChats.removeChatMember(bannedChatId, bot.profile.id, { status: 'kicked' });

  const commands = [specifiedCommand('start', 'Start')];
  const cases: ReadonlyArray<readonly [BotCommandScope, string | undefined]> = [
    [{ type: 'chat', chatId: joinedChatId }, undefined],
    [{ type: 'chat_administrators', chatId: joinedChatId }, undefined],
    [{ type: 'chat_member', chatId: joinedChatId, userId: account.profile.id }, undefined],
    [{ type: 'chat', chatId: leftChatId }, 'bot_not_a_member'],
    [{ type: 'chat_administrators', chatId: bannedChatId }, 'bot_kicked'],
    [{ type: 'chat_member', chatId: strangeChatId, userId: account.profile.id }, 'chat_not_found'],
  ];
  for (const [scope, expectedReason] of cases) {
    const result = botCommands.setBotCommands({
      botId: bot.profile.id,
      scope,
      languageCode: '',
      commands,
    });
    const reason = result.set ? undefined : result.reason;
    if (reason !== expectedReason) {
      throw new Error(
        `Expected ${JSON.stringify(scope)} to give ${expectedReason}, received ${reason}`,
      );
    }
  }
});

Deno.test('BotCommandService resolves the commands a member sees in a supergroup', () => {
  const { botCommands, virtualUsers, sharedChats, bot, account } = createBotCommandFixture();
  const member = createAccount(virtualUsers, 'Grace', 'de');
  const administrator = createAccount(virtualUsers, 'Linus');
  const silentBot = virtualUsers.createBot({ first_name: 'Silent Bot', username: 'silent_bot' });
  if (!silentBot.created) {
    throw new Error(`Expected bot creation to succeed, received ${silentBot.reason}`);
  }
  const chatId = registerSupergroup(sharedChats, -1_000_000_000_201, account.profile.id);
  for (const memberId of [member.profile.id, administrator.profile.id, bot.profile.id]) {
    sharedChats.addChatMember(chatId, memberId);
  }
  sharedChats.addChatMember(chatId, silentBot.bot.profile.id);
  sharedChats.updateChatMemberStatus(chatId, administrator.profile.id, {
    status: 'administrator',
    rights: new Set(['can_manage_chat']),
    promotedById: account.profile.id,
  });
  // A restricted member administers nothing, so it sees the lists of members.
  sharedChats.updateChatMemberStatus(chatId, member.profile.id, {
    status: 'restricted',
    isMember: true,
    permissions: new Set(['can_send_messages']),
  });
  const set = (scope: BotCommandScope, languageCode: string, command: string) =>
    assertSet(botCommands.setBotCommands({
      botId: bot.profile.id,
      scope,
      languageCode,
      commands: [specifiedCommand(command, command)],
    }));
  const seenBy = (accountId: number) => {
    const result = botCommands.getSupergroupCommands({ accountId, chatId });
    if (!result.found) {
      throw new Error(`Expected the member to see commands, received ${result.reason}`);
    }
    return result.botCommands.map(({ botId, commands }) =>
      `${botId === bot.profile.id ? 'bot' : botId}:${commands.map(({ command }) => command)}`
    ).join();
  };
  const expectSeen = (expected: Record<string, string>, situation: string) => {
    for (
      const [name, accountId] of Object.entries({
        owner: account.profile.id,
        member: member.profile.id,
        administrator: administrator.profile.id,
      })
    ) {
      const seen = seenBy(accountId);
      if (seen !== expected[name]) {
        throw new Error(
          `Expected the ${name} to see "${expected[name]}" ${situation}, got ${seen}`,
        );
      }
    }
  };

  expectSeen({ owner: '', member: '', administrator: '' }, 'before any list, without bots');
  set({ type: 'all_private_chats' }, '', 'private');
  set({ type: 'default' }, '', 'default');
  set({ type: 'default' }, 'de', 'default_de');
  expectSeen(
    { owner: 'bot:default', member: 'bot:default_de', administrator: 'bot:default' },
    'from the default scope in their language',
  );
  set({ type: 'all_group_chats' }, '', 'groups');
  set({ type: 'all_chat_administrators' }, '', 'admins');
  expectSeen(
    { owner: 'bot:admins', member: 'bot:groups', administrator: 'bot:admins' },
    'with group-wide lists',
  );
  set({ type: 'chat', chatId }, '', 'chat');
  expectSeen(
    { owner: 'bot:chat', member: 'bot:chat', administrator: 'bot:chat' },
    "with the chat's list",
  );
  set({ type: 'chat_administrators', chatId }, '', 'chat_admins');
  set({ type: 'chat_member', chatId, userId: member.profile.id }, '', 'just_you');
  expectSeen(
    { owner: 'bot:chat_admins', member: 'bot:just_you', administrator: 'bot:chat_admins' },
    "with the chat's administrator and member lists",
  );

  const stranger = createAccount(virtualUsers, 'Edsger');
  const notMember = botCommands.getSupergroupCommands({ accountId: stranger.profile.id, chatId });
  const missing = botCommands.getSupergroupCommands({
    accountId: stranger.profile.id,
    chatId: -1_000_000_000_999,
  });
  if (
    notMember.found || notMember.reason !== 'not_a_member' || missing.found ||
    missing.reason !== 'chat_not_found'
  ) {
    throw new Error('Expected non-members and unknown supergroups to be reported');
  }
});

function registerSupergroup(
  sharedChats: SharedChatRepository,
  chatId: number,
  ownerAccountId: number,
): number {
  const registration = sharedChats.registerSupergroup(
    {
      kind: 'supergroup',
      id: chatId,
      title: 'Team',
      chatInstance: String(-chatId),
      hasProtectedContent: false,
      defaultPermissions: ALL_CHAT_PERMISSIONS,
    },
    ownerAccountId,
  );
  if (!registration.registered) {
    throw new Error(`Expected the supergroup to be registered, received ${registration.reason}`);
  }
  return chatId;
}

function specifiedCommand(command: string, description: string): SpecifiedBotCommand {
  return { command, description, isEphemeral: false };
}

function assertSet(result: SetBotCommandsResult): void {
  if (!result.set) {
    throw new Error(`Expected the commands to be set, received ${result.reason}`);
  }
}

function assertCommands(
  result: ReturnType<BotCommandService['getBotCommands']>,
  expected: readonly BotCommand[],
): void {
  if (!result.found || JSON.stringify(result.commands) !== JSON.stringify(expected)) {
    throw new Error(`Expected ${JSON.stringify(expected)}, received ${JSON.stringify(result)}`);
  }
}

function createBotCommandFixture() {
  const identities = new TelegramIdentityRepository();
  const accounts = new AccountRepository();
  const bots = new BotRepository();
  const virtualUsers = new VirtualUserService({ identities, accounts, bots });
  const privateConversations = new PrivateConversationRepository();
  const sharedChats = new SharedChatRepository();
  const botCommands = new BotCommandService({
    accounts,
    bots,
    privateConversations,
    supergroupMembers: sharedChats,
    botCommands: new BotCommandRepository(),
  });
  const botResult = virtualUsers.createBot({ first_name: 'Test Bot', username: 'test_bot' });
  if (!botResult.created) {
    throw new Error(`Expected bot creation to succeed, received ${botResult.reason}`);
  }
  return {
    botCommands,
    virtualUsers,
    privateConversations,
    sharedChats,
    bot: botResult.bot,
    account: createAccount(virtualUsers, 'Ada'),
  };
}

function createAccount(virtualUsers: VirtualUserService, firstName: string, languageCode?: string) {
  const result = virtualUsers.createAccount({
    first_name: firstName,
    ...(languageCode === undefined ? {} : { language_code: languageCode }),
  });
  if (!result.created) {
    throw new Error(`Expected account creation to succeed, received ${result.reason}`);
  }
  return result.account;
}
