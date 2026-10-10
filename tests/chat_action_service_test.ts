import { AccountRepository } from '../src/repositories/account.ts';
import { BotRepository } from '../src/repositories/bot.ts';
import { ChatActionRepository } from '../src/repositories/chat_action.ts';
import { SharedChatRepository } from '../src/repositories/shared_chat.ts';
import { TelegramIdentityRepository } from '../src/repositories/telegram_identity.ts';
import {
  ChatActionService,
  type ExpireChatActionResult,
  type GetChatActionsResult,
} from '../src/services/chat_action.ts';
import { VirtualUserService } from '../src/services/virtual_user.ts';
import { ALL_CHAT_PERMISSIONS } from '../src/types/chat_permissions.ts';
import type { ChatKey } from '../src/types/virtual_chat.ts';

const SUPERGROUP_ID = -1_000_000_000_001;

Deno.test('ChatActionService shows a private chat action until it is canceled or expired', () => {
  const { chatActions, account, bot } = createChatActionFixture();
  const key = { accountId: account.profile.id, botId: bot.id };
  const chat: ChatKey = { type: 'private', conversation: key };
  const seen = () => actionsOf(chatActions.getPrivateChatActions(key));
  const expire = () => expiryOf(chatActions.expirePrivateChatAction(key));

  const withoutAction = expire();
  chatActions.recordBotChatAction({ botId: bot.id, chat, action: 'typing' });
  const shown = seen();
  chatActions.recordBotChatAction({ botId: bot.id, chat, action: 'upload_document' });
  const renewed = seen();
  const expired = expire();
  const afterExpiry = seen();
  const repeated = expire();
  chatActions.recordBotChatAction({ botId: bot.id, chat, action: 'typing' });
  const shownAgain = seen();
  chatActions.recordBotChatAction({ botId: bot.id, chat, action: 'cancel' });
  const canceled = seen();

  const received = [
    withoutAction,
    shown,
    renewed,
    expired,
    afterExpiry,
    repeated,
    shownAgain,
    canceled,
    expiryOf(chatActions.expirePrivateChatAction({ ...key, accountId: 999 })),
    expiryOf(chatActions.expirePrivateChatAction({ ...key, botId: 999 })),
  ];
  const expected = [
    'chat_action_not_found',
    `${bot.id}:typing`,
    `${bot.id}:upload_document`,
    'expired',
    '',
    'chat_action_not_found',
    `${bot.id}:typing`,
    '',
    'account_not_found',
    'bot_not_found',
  ];
  if (JSON.stringify(received) !== JSON.stringify(expected)) {
    throw new Error(`Expected the action to show until canceled or expired, received ${received}`);
  }
});

Deno.test('ChatActionService shows members each bot latest action until its message or expiry', () => {
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
  const chat: ChatKey = { type: 'supergroup', chatId: SUPERGROUP_ID };
  const seenBy = (accountId: number) =>
    actionsOf(chatActions.getSupergroupChatActions({ accountId, chatId: SUPERGROUP_ID }));

  chatActions.recordBotChatAction({ botId: bot.id, chat, action: 'typing' });
  chatActions.recordBotChatAction({ botId: otherBot.id, chat, action: 'find_location' });
  chatActions.recordBotChatAction({ botId: bot.id, chat, action: 'choose_sticker' });
  const bothActions = seenBy(account.profile.id);
  chatActions.endBotChatAction({ botId: otherBot.id, chat });
  const afterMessage = seenBy(account.profile.id);
  chatActions.recordBotChatAction({ botId: otherBot.id, chat, action: 'typing' });
  const expiry = expiryOf(
    chatActions.expireSupergroupChatAction({
      accountId: account.profile.id,
      chatId: SUPERGROUP_ID,
      botId: bot.id,
    }),
  );
  const afterExpiry = seenBy(account.profile.id);

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
  const expiryBy = (accountId: number, chatId: number, botId: number) =>
    expiryOf(chatActions.expireSupergroupChatAction({ accountId, chatId, botId }));
  const failedExpiries = [
    expiryBy(account.profile.id, SUPERGROUP_ID, bot.id),
    expiryBy(account.profile.id, SUPERGROUP_ID, 999),
    expiryBy(stranger.account.profile.id, SUPERGROUP_ID, otherBot.id),
    expiryBy(account.profile.id, -1_000_000_000_999, otherBot.id),
  ];
  if (
    bothActions !== `${otherBot.id}:find_location,${bot.id}:choose_sticker` ||
    afterMessage !== `${bot.id}:choose_sticker` ||
    expiry !== 'expired' || afterExpiry !== `${otherBot.id}:typing` ||
    JSON.stringify(failedExpiries) !==
      JSON.stringify([
        'chat_action_not_found',
        'bot_not_found',
        'not_a_member',
        'chat_not_found',
      ]) ||
    seenBy(account.profile.id) !== `${otherBot.id}:typing` ||
    strangerResult.found || strangerResult.reason !== 'not_a_member' ||
    missingResult.found || missingResult.reason !== 'chat_not_found'
  ) {
    throw new Error(
      `Expected members to see each bot's latest action, received ${[
        bothActions,
        afterMessage,
        expiry,
        afterExpiry,
        failedExpiries,
      ]}`,
    );
  }
});

function actionsOf(result: GetChatActionsResult): string {
  if (!result.found) {
    throw new Error(`Expected the chat actions to be found, received ${result.reason}`);
  }
  return result.chatActions.map(({ botId, action }) => `${botId}:${action}`).join();
}

function expiryOf(result: ExpireChatActionResult): string {
  return result.expired ? 'expired' : result.reason;
}

function createChatActionFixture() {
  const identities = new TelegramIdentityRepository();
  const accounts = new AccountRepository();
  const bots = new BotRepository();
  const virtualUsers = new VirtualUserService({ identities, accounts, bots });
  const sharedChats = new SharedChatRepository();
  const chatActions = new ChatActionService({
    accounts,
    bots,
    sharedChats,
    chatActions: new ChatActionRepository(),
  });
  const accountResult = virtualUsers.createAccount({ first_name: 'Ada' });
  if (!accountResult.created) {
    throw new Error(`Expected account creation to succeed, received ${accountResult.reason}`);
  }
  return {
    chatActions,
    sharedChats,
    virtualUsers,
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
