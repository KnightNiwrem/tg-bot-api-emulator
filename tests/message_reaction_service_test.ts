import { assertEquals } from '@std/assert';
import {
  MAX_DISTINCT_REACTIONS_PER_MESSAGE,
  MessageReactionService,
} from '../src/services/message_reaction.ts';
import { SharedChatAdministrationService } from '../src/services/shared_chat_administration.ts';
import { createChatMessagingServices } from './support/chat_messaging_services.ts';
import { TEST_UNIX_TIME_SECONDS } from './support/fixed_wall_clock.ts';
import { createVirtualAccount, createVirtualBot } from './support/virtual_users.ts';
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
  assertEquals(
    [added.reactions, changed.reactions, removed.reactions, removed.message.reactions],
    [
      [{ userId: ada.profile.id, emojis: ['👍'] }],
      [{ userId: ada.profile.id, emojis: ['❤'] }],
      [],
      undefined,
    ],
    'Expected the message to hold the account reaction after each change',
  );
  assertEquals(
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
  assertEquals(inspection.reactions, [
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

  assertEquals(
    [set, repeated, removed],
    [{ set: true }, { set: true }, { set: true }],
    'Expected the bot reaction changes to be accepted',
  );
  if (!inspection.found) {
    throw new Error(`Expected the reactions to be found, received ${inspection.reason}`);
  }
  assertEquals(
    inspection.reactions,
    [{ userId: bot.profile.id, emojis: ['👀'] }],
    'Expected the bot reaction to be inspectable',
  );
  assertEquals(publishedEvents, [], 'Expected no published event for bot reactions');
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

  assertEquals(
    failures.map((result) => result.set ? 'set' : result.reason),
    [
      'reaction_emoji_unsupported',
      'reaction_emoji_unsupported',
      'too_many_reactions',
      'too_many_reactions',
    ],
    'Expected unsupported emoji and several reactions to be refused',
  );
  assertEquals([REACTION_EMOJIS.length, accepted], [73, true], 'Expected every documented emoji');
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
  const joined = messages.getChatMessages({ type: 'supergroup', chatId: supergroup.id }).find((
    candidate,
  ) => candidate.content.kind === 'members_joined');
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

  assertEquals(
    [serviceReaction, withoutPermission].map((result) => result.set ? 'set' : result.reason),
    ['message_not_reactable', 'reaction_not_permitted'],
    'Expected a service message and a member without the permission to be refused',
  );
  if (!ownerReaction.set || !reactionOnly.set) {
    throw new Error('Expected the owner, and a member allowed only to react, to react');
  }
  assertEquals(
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
    const account = createVirtualAccount(virtualUsers, { first_name: `Reactor ${index}` });
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

  assertEquals(
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
  const outsider = createVirtualAccount(virtualUsers, { first_name: 'Outsider' });
  const outsiderBot = createVirtualBot(virtualUsers, {
    first_name: 'Reaction Bot',
    username: 'outsider_bot',
  });
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

  assertEquals(
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
  assertEquals(
    publishedEvents.filter((event) => event.type === 'message_reaction_changed'),
    [],
    'Expected refused reactions to publish nothing',
  );
});

Deno.test('MessageReactionService loses the reactions of a deleted message', () => {
  const { messageReactions, messageDeletion, ada, supergroup, sendText } = createReactionFixture();
  const message = sendText(ada.profile.id, 'Typo');
  const key = { accountId: ada.profile.id, chatId: supergroup.id, messageId: message.messageId };
  messageReactions.setAccountMessageReaction({ ...key, emojis: ['😁'] });

  messageDeletion.deleteAccountSupergroupMessage({
    fromAccountId: ada.profile.id,
    chat: { type: 'supergroup', chatId: supergroup.id },
    messageId: message.messageId,
  });

  const inspection = messageReactions.getAccountMessageReactions(key);
  const reaction = messageReactions.setAccountMessageReaction({ ...key, emojis: ['😁'] });
  assertEquals(
    [inspection.found ? 'found' : inspection.reason, reaction.set ? 'set' : reaction.reason],
    ['message_not_found', 'message_not_found'],
    'Expected a deleted message to have no reactions to inspect or change',
  );
});

function createReactionFixture() {
  const services = createChatMessagingServices();
  const {
    virtualUsers,
    accounts,
    bots,
    sharedChats,
    messages,
    messageBoxes,
    publishedEvents,
    supergroupMessaging,
    sharedChatAdministration,
    messageSending,
  } = services;
  const messageReactions = new MessageReactionService({
    accounts,
    bots,
    sharedChats,
    supergroupMessages: supergroupMessaging,
    messages,
    transactions: services.transactions,
    currentUnixTimeSeconds: () => TEST_UNIX_TIME_SECONDS,
  });

  const owner = createVirtualAccount(virtualUsers, { first_name: 'Owner' });
  const ada = createVirtualAccount(virtualUsers, { first_name: 'Ada' });
  const grace = createVirtualAccount(virtualUsers, { first_name: 'Grace' });
  const bot = createVirtualBot(virtualUsers, {
    first_name: 'Reaction Bot',
    username: 'reaction_bot',
  });
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
    const result = messageSending.sendAccountSupergroupMessage({
      fromAccountId: accountId,
      chat: { type: 'supergroup', chatId: supergroup.id },
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
    ...services,
    messageReactions,
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
