import { AccountRepository } from '../src/repositories/account.ts';
import { BotRepository } from '../src/repositories/bot.ts';
import { FileRepository } from '../src/repositories/file.ts';
import { MessageRepository } from '../src/repositories/message.ts';
import { MessageBoxRepository } from '../src/repositories/message_box.ts';
import { PollRepository } from '../src/repositories/poll.ts';
import { SharedChatRepository } from '../src/repositories/shared_chat.ts';
import { TelegramIdentityRepository } from '../src/repositories/telegram_identity.ts';
import {
  MAX_DISTINCT_REACTIONS_PER_MESSAGE,
  MessageReactionService,
} from '../src/services/message_reaction.ts';
import { SharedChatAdministrationService } from '../src/services/shared_chat_administration.ts';
import { SupergroupMessagingService } from '../src/services/supergroup_messaging.ts';
import { VirtualUserService } from '../src/services/virtual_user.ts';
import type { ChatDomainEvent } from '../src/types/chat_domain_event.ts';
import { grantSupergroupAdministratorRights } from '../src/types/chat_membership.ts';
import type { ChatPermission } from '../src/types/chat_permissions.ts';
import { REACTION_EMOJIS } from '../src/types/message_reaction.ts';

Deno.test('MessageReactionService records an account adding, changing and removing its reaction', () => {
  const { messageReactions, publishedEvents, ada, grace, supergroup, sendText } =
    createReactionFixture();
  const message = sendText(grace.profile.id, 'Ship it?');
  const key = { accountId: ada.profile.id, chatId: supergroup.id, messageId: message.messageId };

  const added = messageReactions.setAccountMessageReaction({ ...key, emojis: ['👍'] });
  const repeated = messageReactions.setAccountMessageReaction({ ...key, emojis: ['👍'] });
  const changed = messageReactions.setAccountMessageReaction({ ...key, emojis: ['❤'] });
  const removed = messageReactions.setAccountMessageReaction({ ...key, emojis: [] });
  const removedAgain = messageReactions.setAccountMessageReaction({ ...key, emojis: [] });

  if (!added.set || !repeated.set || !changed.set || !removed.set || !removedAgain.set) {
    throw new Error('Expected every reaction change to be accepted');
  }
  expectEqual(
    [added.reactions, changed.reactions, removed.reactions, removed.message.reactions],
    [
      [{ userId: ada.profile.id, emojis: ['👍'] }],
      [{ userId: ada.profile.id, emojis: ['❤'] }],
      [],
      undefined,
    ],
    'Expected the message to hold the account reaction after each change',
  );
  expectEqual(
    publishedEvents.map((event) =>
      event.type === 'message_reaction_changed'
        ? [event.accountId, event.message.id, event.oldEmojis, event.newEmojis]
        : event.type
    ),
    [
      [ada.profile.id, message.message.id, [], ['👍']],
      [ada.profile.id, message.message.id, ['👍'], ['❤']],
      [ada.profile.id, message.message.id, ['❤'], []],
    ],
    'Expected one published transition per change and none for a repeated choice',
  );
});

Deno.test('MessageReactionService keeps one entry per user in the order of their last change', () => {
  const { messageReactions, ada, grace, bot, supergroup, sendText } = createReactionFixture();
  const message = sendText(ada.profile.id, 'Lunch?');
  const chatKey = { chatId: supergroup.id, messageId: message.messageId };

  messageReactions.setAccountMessageReaction({
    ...chatKey,
    accountId: ada.profile.id,
    emojis: ['🔥'],
  });
  messageReactions.setBotMessageReaction({ ...chatKey, botId: bot.profile.id, emojis: ['👌'] });
  messageReactions.setAccountMessageReaction({
    ...chatKey,
    accountId: grace.profile.id,
    emojis: ['🔥'],
  });
  messageReactions.setAccountMessageReaction({
    ...chatKey,
    accountId: ada.profile.id,
    emojis: ['🎉'],
  });

  const inspection = messageReactions.getAccountMessageReactions({
    ...chatKey,
    accountId: grace.profile.id,
  });
  if (!inspection.found) {
    throw new Error(`Expected the reactions to be found, received ${inspection.reason}`);
  }
  expectEqual(inspection.reactions, [
    { userId: bot.profile.id, emojis: ['👌'] },
    { userId: grace.profile.id, emojis: ['🔥'] },
    { userId: ada.profile.id, emojis: ['🎉'] },
  ], 'Expected each user once, the last to change last');
});

Deno.test('MessageReactionService stores a bot reaction without publishing it', () => {
  const { messageReactions, publishedEvents, ada, bot, supergroup, sendText } =
    createReactionFixture();
  const message = sendText(ada.profile.id, 'Deploy done');
  const botKey = { botId: bot.profile.id, chatId: supergroup.id, messageId: message.messageId };

  const set = messageReactions.setBotMessageReaction({ ...botKey, emojis: ['👀'] });
  const repeated = messageReactions.setBotMessageReaction({ ...botKey, emojis: ['👀'] });
  const inspection = messageReactions.getAccountMessageReactions({
    accountId: ada.profile.id,
    chatId: supergroup.id,
    messageId: message.messageId,
  });
  const removed = messageReactions.setBotMessageReaction({ ...botKey, emojis: [] });

  expectEqual(
    [set, repeated, removed],
    [{ set: true }, { set: true }, { set: true }],
    'Expected the bot reaction changes to be accepted',
  );
  if (!inspection.found) {
    throw new Error(`Expected the reactions to be found, received ${inspection.reason}`);
  }
  expectEqual(
    inspection.reactions,
    [{ userId: bot.profile.id, emojis: ['👀'] }],
    'Expected the bot reaction to be inspectable',
  );
  expectEqual(publishedEvents, [], 'Expected no published event for bot reactions');
});

Deno.test('MessageReactionService accepts exactly the documented emoji, one per user', () => {
  const { messageReactions, ada, supergroup, sendText } = createReactionFixture();
  const message = sendText(ada.profile.id, 'Rate this');
  const key = { accountId: ada.profile.id, chatId: supergroup.id, messageId: message.messageId };

  const failures = [
    ['❤️'], // With the variation selector U+FE0F, which the documented emoji lacks.
    ['🦆'],
    ['👍', '👎'],
    ['👍', '👍'],
  ].map((emojis) => messageReactions.setAccountMessageReaction({ ...key, emojis }));
  const accepted = REACTION_EMOJIS.every((emoji) =>
    messageReactions.setAccountMessageReaction({ ...key, emojis: [emoji] }).set
  );

  expectEqual(
    failures.map((result) => result.set ? 'set' : result.reason),
    [
      'reaction_emoji_unsupported',
      'reaction_emoji_unsupported',
      'too_many_reactions',
      'too_many_reactions',
    ],
    'Expected unsupported emoji and several reactions to be refused',
  );
  expectEqual([REACTION_EMOJIS.length, accepted], [73, true], 'Expected every documented emoji');
});

Deno.test('MessageReactionService refuses reactions to service messages and without permission', () => {
  const {
    messageReactions,
    sharedChatAdministration,
    messages,
    messageBoxes,
    publishedEvents,
    owner,
    ada,
    supergroup,
    sendText,
  } = createReactionFixture();
  const message = sendText(ada.profile.id, 'Quiet please');
  const joined = messages.getSupergroupMessages(supergroup.id).find((candidate) =>
    candidate.content.kind === 'members_joined'
  );
  const joinedMessageId = joined === undefined
    ? undefined
    : messageBoxes.getMessageId(supergroup.id, joined.id);
  if (joinedMessageId === undefined) {
    throw new Error('Expected a service message recording a member joining');
  }

  const serviceReaction = messageReactions.setAccountMessageReaction({
    accountId: ada.profile.id,
    chatId: supergroup.id,
    messageId: joinedMessageId,
    emojis: ['👍'],
  });
  setDefaultPermissions(sharedChatAdministration, owner.profile.id, supergroup.id, [
    'can_send_messages',
  ]);
  const withoutPermission = messageReactions.setAccountMessageReaction({
    accountId: ada.profile.id,
    chatId: supergroup.id,
    messageId: message.messageId,
    emojis: ['👍'],
  });
  const ownerReaction = messageReactions.setAccountMessageReaction({
    accountId: owner.profile.id,
    chatId: supergroup.id,
    messageId: message.messageId,
    emojis: ['👍'],
  });
  setDefaultPermissions(sharedChatAdministration, owner.profile.id, supergroup.id, [
    'can_react_to_messages',
  ]);
  const reactionOnly = messageReactions.setAccountMessageReaction({
    accountId: ada.profile.id,
    chatId: supergroup.id,
    messageId: message.messageId,
    emojis: ['🙏'],
  });

  expectEqual(
    [serviceReaction, withoutPermission].map((result) => result.set ? 'set' : result.reason),
    ['message_not_reactable', 'reaction_not_permitted'],
    'Expected a service message and a member without the permission to be refused',
  );
  if (!ownerReaction.set || !reactionOnly.set) {
    throw new Error('Expected the owner, and a member allowed only to react, to react');
  }
  expectEqual(
    publishedEvents.filter((event) => event.type === 'message_reaction_changed').map((event) =>
      event.type === 'message_reaction_changed' ? event.accountId : undefined
    ),
    [owner.profile.id, ada.profile.id],
    'Expected only accepted reactions to be published',
  );
});

Deno.test('MessageReactionService limits a message to eleven distinct reactions', () => {
  const { messageReactions, virtualUsers, sharedChatAdministration, owner, supergroup, sendText } =
    createReactionFixture();
  const message = sendText(owner.profile.id, 'Vote with emoji');
  const reactors = Array.from({ length: MAX_DISTINCT_REACTIONS_PER_MESSAGE + 1 }, (_, index) => {
    const account = createAccount(virtualUsers, `Reactor ${index}`);
    sharedChatAdministration.addChatMember({
      actorAccountId: owner.profile.id,
      chatId: supergroup.id,
      memberId: account.profile.id,
    });
    return account.profile.id;
  });
  const chatKey = { chatId: supergroup.id, messageId: message.messageId };

  const distinctResults = reactors.slice(0, MAX_DISTINCT_REACTIONS_PER_MESSAGE).map((
    accountId,
    index,
  ) =>
    messageReactions.setAccountMessageReaction({
      ...chatKey,
      accountId,
      emojis: [REACTION_EMOJIS[index]],
    }).set
  );
  const lastReactorId = reactors[MAX_DISTINCT_REACTIONS_PER_MESSAGE];
  const twelfth = messageReactions.setAccountMessageReaction({
    ...chatKey,
    accountId: lastReactorId,
    emojis: [REACTION_EMOJIS[MAX_DISTINCT_REACTIONS_PER_MESSAGE]],
  });
  const shown = messageReactions.setAccountMessageReaction({
    ...chatKey,
    accountId: lastReactorId,
    emojis: [REACTION_EMOJIS[0]],
  });

  expectEqual(
    [distinctResults.every(Boolean), twelfth.set ? 'set' : twelfth.reason, shown.set],
    [true, 'too_many_distinct_reactions', true],
    'Expected a twelfth distinct reaction to be refused and a shown one accepted',
  );
});

Deno.test('MessageReactionService finds messages only for members and bots of the supergroup', () => {
  const {
    messageReactions,
    virtualUsers,
    sharedChatAdministration,
    publishedEvents,
    ada,
    bot,
    supergroup,
    sendText,
  } = createReactionFixture();
  const message = sendText(ada.profile.id, 'Members only');
  const outsider = createAccount(virtualUsers, 'Outsider');
  const outsiderBot = createBot(virtualUsers, 'outsider_bot');
  const chatKey = { chatId: supergroup.id, messageId: message.messageId };
  publishedEvents.splice(0);

  const accountResults = [
    { ...chatKey, accountId: 999_999_999 },
    { ...chatKey, accountId: outsider.profile.id },
    { ...chatKey, accountId: ada.profile.id, chatId: -1_009_999_999 },
    { ...chatKey, accountId: ada.profile.id, messageId: 999 },
  ].map((key) => messageReactions.setAccountMessageReaction({ ...key, emojis: ['👍'] }));
  sharedChatAdministration.leaveChat({ memberId: bot.profile.id, chatId: supergroup.id });
  const botResults = [
    { ...chatKey, botId: outsiderBot.profile.id },
    { ...chatKey, botId: bot.profile.id },
  ].map((key) => messageReactions.setBotMessageReaction({ ...key, emojis: ['👍'] }));

  expectEqual(
    [...accountResults, ...botResults].map((result) => result.set ? 'set' : result.reason),
    [
      'account_not_found',
      'not_a_member',
      'chat_not_found',
      'message_not_found',
      'chat_not_found',
      'bot_not_a_member',
    ],
    'Expected each unreachable message to be refused',
  );
  expectEqual(
    publishedEvents.filter((event) => event.type === 'message_reaction_changed'),
    [],
    'Expected refused reactions to publish nothing',
  );
});

Deno.test('MessageReactionService loses the reactions of a deleted message', () => {
  const { messageReactions, supergroupMessaging, ada, supergroup, sendText } =
    createReactionFixture();
  const message = sendText(ada.profile.id, 'Typo');
  const key = { accountId: ada.profile.id, chatId: supergroup.id, messageId: message.messageId };
  messageReactions.setAccountMessageReaction({ ...key, emojis: ['😁'] });

  supergroupMessaging.deleteAccountMessage({
    fromAccountId: ada.profile.id,
    chatId: supergroup.id,
    messageId: message.messageId,
  });

  const inspection = messageReactions.getAccountMessageReactions(key);
  const reaction = messageReactions.setAccountMessageReaction({ ...key, emojis: ['😁'] });
  expectEqual(
    [inspection.found ? 'found' : inspection.reason, reaction.set ? 'set' : reaction.reason],
    ['message_not_found', 'message_not_found'],
    'Expected a deleted message to have no reactions to inspect or change',
  );
});

function createReactionFixture() {
  const identities = new TelegramIdentityRepository();
  const accounts = new AccountRepository();
  const bots = new BotRepository();
  const virtualUsers = new VirtualUserService({ identities, accounts, bots });
  const sharedChats = new SharedChatRepository();
  const messages = new MessageRepository();
  const messageBoxes = new MessageBoxRepository();
  const publishedEvents: ChatDomainEvent[] = [];
  const events = { publish: (event: ChatDomainEvent) => publishedEvents.push(event) };
  const currentUnixTimeSeconds = () => 1_700_000_000;
  const supergroupMessaging = new SupergroupMessagingService({
    accounts,
    bots,
    sharedChats,
    messages,
    files: new FileRepository(),
    polls: new PollRepository(),
    messageBoxes,
    events,
    currentUnixTimeSeconds,
  });
  const sharedChatAdministration = new SharedChatAdministrationService({
    identities,
    accounts,
    bots,
    sharedChats,
    supergroupMessages: supergroupMessaging,
    events,
    currentUnixTimeSeconds,
  });
  const messageReactions = new MessageReactionService({
    accounts,
    bots,
    sharedChats,
    supergroupMessages: supergroupMessaging,
    messages,
    events,
    currentUnixTimeSeconds,
  });

  const owner = createAccount(virtualUsers, 'Owner');
  const ada = createAccount(virtualUsers, 'Ada');
  const grace = createAccount(virtualUsers, 'Grace');
  const bot = createBot(virtualUsers, 'reaction_bot');
  const creation = sharedChatAdministration.createSupergroup({
    title: 'Team',
    creatorAccountId: owner.profile.id,
  });
  if (!creation.created) {
    throw new Error(`Expected the supergroup to be created, received ${creation.reason}`);
  }
  const supergroup = creation.supergroup;
  for (const memberId of [ada.profile.id, grace.profile.id, bot.profile.id]) {
    const addition = sharedChatAdministration.addChatMember({
      actorAccountId: owner.profile.id,
      chatId: supergroup.id,
      memberId,
    });
    if (!addition.added) {
      throw new Error(`Expected member ${memberId} to be added, received ${addition.reason}`);
    }
  }
  const promotion = sharedChatAdministration.promoteChatMember({
    actorAccountId: owner.profile.id,
    chatId: supergroup.id,
    memberId: bot.profile.id,
    rights: grantSupergroupAdministratorRights(['can_delete_messages']),
  });
  if (!promotion.promoted) {
    throw new Error(`Expected the bot to be promoted, received ${promotion.reason}`);
  }
  publishedEvents.splice(0);

  /** Sends a text message from an account and returns it with its ID in the supergroup. */
  const sendText = (accountId: number, text: string) => {
    const result = supergroupMessaging.sendAccountMessage({
      fromAccountId: accountId,
      chatId: supergroup.id,
      content: { kind: 'text', text },
    });
    if (!result.sent) {
      throw new Error(`Expected the message to be sent, received ${result.reason}`);
    }
    publishedEvents.splice(0);
    const messageId = messageBoxes.getMessageId(supergroup.id, result.message.id);
    if (messageId === undefined) {
      throw new Error(`Expected message ${result.message.id} to be numbered`);
    }
    return { message: result.message, messageId };
  };

  return {
    virtualUsers,
    sharedChatAdministration,
    supergroupMessaging,
    messages,
    messageBoxes,
    messageReactions,
    publishedEvents,
    owner,
    ada,
    grace,
    bot,
    supergroup,
    sendText,
  };
}

function setDefaultPermissions(
  sharedChatAdministration: SharedChatAdministrationService,
  ownerId: number,
  chatId: number,
  permissions: readonly ChatPermission[],
): void {
  const result = sharedChatAdministration.changeDefaultPermissions({
    actor: { kind: 'account', accountId: ownerId },
    chatId,
    permissions: new Set(permissions),
  });
  if (!result.changed) {
    throw new Error(`Expected the default permissions to change, received ${result.reason}`);
  }
}

function createAccount(virtualUsers: VirtualUserService, firstName: string) {
  const result = virtualUsers.createAccount({ first_name: firstName });
  if (!result.created) {
    throw new Error(`Expected account creation to succeed, received ${result.reason}`);
  }
  return result.account;
}

function createBot(virtualUsers: VirtualUserService, username: string) {
  const result = virtualUsers.createBot({ first_name: 'Reaction Bot', username });
  if (!result.created) {
    throw new Error(`Expected bot creation to succeed, received ${result.reason}`);
  }
  return result.bot;
}

function expectEqual(actual: unknown, expected: unknown, message: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `${message}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`,
    );
  }
}
