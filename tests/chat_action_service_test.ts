import { AccountRepository } from '../src/repositories/account.ts';
import { BotRepository } from '../src/repositories/bot.ts';
import { ChatActionRepository } from '../src/repositories/chat_action.ts';
import { SharedChatRepository } from '../src/repositories/shared_chat.ts';
import { TelegramIdentityRepository } from '../src/repositories/telegram_identity.ts';
import { ChatActionService, type GetChatActionsResult } from '../src/services/chat_action.ts';
import { VirtualUserService } from '../src/services/virtual_user.ts';
import { ALL_CHAT_PERMISSIONS } from '../src/types/chat_permissions.ts';
import type { ChatActionChat } from '../src/types/virtual_chat.ts';

const SUPERGROUP_ID = -1_000_000_000_001;

Deno.test('ChatActionService shows a private chat action until it is canceled or expires', () => {
  const { chatActions, clock, account, bot } = createChatActionFixture();
  const chat: ChatActionChat = { type: 'private', accountId: account.profile.id, botId: bot.id };
  const seen = () =>
    actionsOf(chatActions.getPrivateChatActions({ accountId: account.profile.id, botId: bot.id }));

  chatActions.recordBotChatAction({ botId: bot.id, chat, action: 'typing' });
  clock.milliseconds += 5_499;
  const beforeTimeout = seen();
  clock.milliseconds += 1;
  const atTimeout = seen();
  chatActions.recordBotChatAction({ botId: bot.id, chat, action: 'upload_document' });
  const renewed = seen();
  chatActions.recordBotChatAction({ botId: bot.id, chat, action: 'cancel' });
  const canceled = seen();

  const received = [beforeTimeout, atTimeout, renewed, canceled];
  const expected = [`${bot.id}:typing`, '', `${bot.id}:upload_document`, ''];
  if (JSON.stringify(received) !== JSON.stringify(expected)) {
    throw new Error(`Expected the action to last 5.5 seconds, received ${received}`);
  }
});

Deno.test('ChatActionService shows members each bot latest action until its message', () => {
  const { chatActions, sharedChats, virtualUsers, account, bot } = createChatActionFixture();
  const otherBot = createBot(virtualUsers, 'other_bot');
  sharedChats.registerSupergroup(
    {
      kind: 'supergroup',
      id: SUPERGROUP_ID,
      title: 'Team',
      chatInstance: '1',
      hasProtectedContent: false,
      defaultPermissions: ALL_CHAT_PERMISSIONS,
    },
    account.profile.id,
  );
  const chat: ChatActionChat = { type: 'supergroup', chatId: SUPERGROUP_ID };
  const seenBy = (accountId: number) =>
    actionsOf(chatActions.getSupergroupChatActions({ accountId, chatId: SUPERGROUP_ID }));

  chatActions.recordBotChatAction({ botId: bot.id, chat, action: 'typing' });
  chatActions.recordBotChatAction({ botId: otherBot.id, chat, action: 'find_location' });
  chatActions.recordBotChatAction({ botId: bot.id, chat, action: 'choose_sticker' });
  const bothActions = seenBy(account.profile.id);
  chatActions.endBotChatAction({ botId: otherBot.id, chat });
  const afterMessage = seenBy(account.profile.id);

  const stranger = virtualUsers.createAccount({ first_name: 'Grace' });
  if (!stranger.created) {
    throw new Error(`Expected account creation to succeed, received ${stranger.reason}`);
  }
  const strangerResult = chatActions.getSupergroupChatActions({
    accountId: stranger.account.profile.id,
    chatId: SUPERGROUP_ID,
  });
  const missingResult = chatActions.getSupergroupChatActions({
    accountId: account.profile.id,
    chatId: -1_000_000_000_999,
  });
  if (
    bothActions !== `${otherBot.id}:find_location,${bot.id}:choose_sticker` ||
    afterMessage !== `${bot.id}:choose_sticker` ||
    strangerResult.found || strangerResult.reason !== 'not_a_member' ||
    missingResult.found || missingResult.reason !== 'chat_not_found'
  ) {
    throw new Error(
      `Expected members to see each bot's latest action, received ${[bothActions, afterMessage]}`,
    );
  }
});

function actionsOf(result: GetChatActionsResult): string {
  if (!result.found) {
    throw new Error(`Expected the chat actions to be found, received ${result.reason}`);
  }
  return result.chatActions.map(({ botId, action }) => `${botId}:${action}`).join();
}

function createChatActionFixture() {
  const identities = new TelegramIdentityRepository();
  const accounts = new AccountRepository();
  const bots = new BotRepository();
  const virtualUsers = new VirtualUserService({ identities, accounts, bots });
  const sharedChats = new SharedChatRepository();
  const clock = { milliseconds: 1_700_000_000_000 };
  const chatActions = new ChatActionService({
    accounts,
    bots,
    sharedChats,
    chatActions: new ChatActionRepository(),
    currentTimeMilliseconds: () => clock.milliseconds,
  });
  const accountResult = virtualUsers.createAccount({ first_name: 'Ada' });
  if (!accountResult.created) {
    throw new Error(`Expected account creation to succeed, received ${accountResult.reason}`);
  }
  return {
    chatActions,
    sharedChats,
    virtualUsers,
    clock,
    account: accountResult.account,
    bot: createBot(virtualUsers, 'test_bot'),
  };
}

function createBot(virtualUsers: VirtualUserService, username: string) {
  const result = virtualUsers.createBot({ first_name: 'Bot', username });
  if (!result.created) {
    throw new Error(`Expected bot creation to succeed, received ${result.reason}`);
  }
  return result.bot.profile;
}
