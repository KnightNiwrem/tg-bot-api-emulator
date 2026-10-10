import { createEmulationSession } from '../src/composition/emulation_session.ts';
import { createSystemSessionTiming } from '../src/timing/system_timing.ts';
import type { SupergroupAdministratorRight } from '../src/types/chat_membership.ts';
import { ALL_CHAT_PERMISSIONS, type ChatPermission } from '../src/types/chat_permissions.ts';
import type { EmulationSession } from '../src/types/emulation_session.ts';
import type { ChatMessage } from '../src/types/virtual_message.ts';

/**
 * Creates a session where Ada owns a supergroup with Grace, a pinning bot that is an administrator
 * with `can_pin_messages`, a member bot, and a bot Ada removed, and where Ada has started a
 * private chat with the pinning bot.
 */
function createPinningFixture() {
  const session = createEmulationSession(
    'pinning',
    { uploadProfile: 'cloud' },
    createSystemSessionTiming(),
  );
  const createAccount = (firstName: string) => {
    const result = session.virtualUsers.createAccount({ first_name: firstName });
    if (!result.created) {
      throw new Error(`Account ${firstName} was not created: ${result.reason}`);
    }
    return result.account.profile.id;
  };
  const createBot = (username: string) => {
    const result = session.virtualUsers.createBot({ first_name: 'Test Bot', username });
    if (!result.created) {
      throw new Error(`Bot ${username} was not created: ${result.reason}`);
    }
    return result.bot.profile.id;
  };
  const ada = createAccount('Ada');
  const grace = createAccount('Grace');
  const outsider = createAccount('Linus');
  const pinningBot = createBot('pinning_bot');
  const memberBot = createBot('member_bot');
  const removedBot = createBot('removed_bot');

  const creation = session.sharedChatAdministration.createSupergroup({
    title: 'Team',
    creatorAccountId: ada,
  });
  if (!creation.created) {
    throw new Error(`Supergroup was not created: ${creation.reason}`);
  }
  const chatId = creation.supergroup.id;
  for (const memberId of [grace, pinningBot, memberBot, removedBot]) {
    expectEqual(
      session.sharedChatAdministration.addChatMember({ actorAccountId: ada, chatId, memberId })
        .added,
      true,
      `member ${memberId} is added`,
    );
  }
  promote(session, { ownerId: ada, chatId, memberId: pinningBot, rights: ['can_pin_messages'] });
  session.sharedChatAdministration.removeChatMember({
    actorAccountId: ada,
    chatId,
    memberId: removedBot,
  });

  const sendToSupergroup = (accountId: number, text: string) => {
    const result = session.supergroupMessaging.sendAccountMessage({
      fromAccountId: accountId,
      chatId,
      content: { kind: 'text', text },
    });
    if (!result.sent) {
      throw new Error(`Supergroup message was not sent: ${result.reason}`);
    }
    return messageIdIn(session, chatId, result.message);
  };
  const sendToPinningBot = (text: string) => {
    const result = session.privateMessaging.sendAccountMessage({
      fromAccountId: ada,
      to: { type: 'private', botId: pinningBot },
      content: { kind: 'text', text },
    });
    if (!result.sent) {
      throw new Error(`Private message was not sent: ${result.reason}`);
    }
    return messageIdIn(session, pinningBot, result.message);
  };

  return {
    session,
    ada,
    grace,
    outsider,
    pinningBot,
    memberBot,
    removedBot,
    chatId,
    sendToSupergroup,
    sendToPinningBot,
  };
}

function promote(
  session: EmulationSession,
  { ownerId, chatId, memberId, rights }: {
    readonly ownerId: number;
    readonly chatId: number;
    readonly memberId: number;
    readonly rights: readonly SupergroupAdministratorRight[];
  },
): void {
  const result = session.sharedChatAdministration.promoteChatMember({
    actorAccountId: ownerId,
    chatId,
    memberId,
    rights: new Set(rights),
  });
  expectEqual(result.promoted, true, `member ${memberId} is promoted`);
}

/** The ID by which an owner of a message box, a bot or a supergroup, numbers a message. */
function messageIdIn(session: EmulationSession, ownerId: number, message: ChatMessage): number {
  const shown = message.kind === 'private_message'
    ? session.botMessageViews.viewPrivateMessageForBot(message)
    : session.botMessageViews.viewSupergroupMessage(message, ownerId);
  return shown.message_id;
}

function pinnedTexts(session: EmulationSession, accountId: number, chat: PinningChat): string[] {
  const result = session.messagePinning.getPinnedMessages({ accountId, chat });
  if (!result.found) {
    throw new Error(`Pinned messages were not found: ${result.reason}`);
  }
  return result.messages.map((message) =>
    message.content.kind === 'text' ? message.content.text : ''
  );
}

type PinningChat = Parameters<EmulationSession['messagePinning']['pinMessage']>[0]['chat'];
type MessagePinner = Parameters<EmulationSession['messagePinning']['pinMessage']>[0]['pinner'];

Deno.test('a chat pins several messages, lists them newest first, and unpins the newest by default', () => {
  const { session, ada, pinningBot, sendToPinningBot } = createPinningFixture();
  const firstId = sendToPinningBot('first');
  const secondId = sendToPinningBot('second');
  const thirdId = sendToPinningBot('third');
  const botChat: PinningChat = { type: 'private', peerId: ada };
  const accountChat: PinningChat = { type: 'private', peerId: pinningBot };
  const pinner = { kind: 'bot', botId: pinningBot } as const;

  for (const messageId of [thirdId, firstId]) {
    expectEqual(
      session.messagePinning.pinMessage({ isSilent: false, pinner, chat: botChat, messageId })
        .pinned,
      true,
      `message ${messageId} is pinned`,
    );
  }
  expectEqual(
    session.messagePinning.pinMessage({
      isSilent: false,
      pinner: { kind: 'account', accountId: ada },
      chat: accountChat,
      messageId: secondId,
    }).pinned,
    true,
    'the account pins with the same pinned messages',
  );
  expectEqual(
    pinnedTexts(session, ada, accountChat),
    ['third', 'second', 'first'],
    'pinned messages are listed by sending order, not pinning order',
  );

  const unpin = session.messagePinning.unpinMessage({ pinner, chat: botChat });
  expectEqual(unpin.unpinned, true, 'an unpin without a target succeeds');
  expectEqual(
    pinnedTexts(session, ada, accountChat),
    ['second', 'first'],
    'the newest is unpinned',
  );
  expectEqual(
    session.messagePinning.unpinMessage({ pinner, chat: botChat, messageId: firstId }).unpinned,
    true,
    'an explicit unpin succeeds',
  );
  expectEqual(pinnedTexts(session, ada, accountChat), ['second'], 'the target is unpinned');
});

Deno.test('a repeated pin or an unpin of an unpinned message is refused without effect', () => {
  const { session, ada, pinningBot, sendToPinningBot } = createPinningFixture();
  const messageId = sendToPinningBot('hello');
  const pinner = { kind: 'bot', botId: pinningBot } as const;
  const chat: PinningChat = { type: 'private', peerId: ada };

  expectEqual(
    session.messagePinning.unpinMessage({ pinner, chat, messageId }),
    { unpinned: false, reason: 'message_not_pinned' },
    'an unpinned message cannot be unpinned',
  );
  expectEqual(
    session.messagePinning.unpinMessage({ pinner, chat }),
    { unpinned: false, reason: 'message_not_found' },
    'without a pinned message, an unpin without a target finds none',
  );
  session.messagePinning.pinMessage({ isSilent: false, pinner, chat, messageId });
  expectEqual(
    session.messagePinning.pinMessage({ isSilent: false, pinner, chat, messageId }),
    { pinned: false, reason: 'message_already_pinned' },
    'a pinned message cannot be pinned again',
  );
  expectEqual(
    pinnedTexts(session, ada, { type: 'private', peerId: pinningBot }),
    ['hello'],
    'the message stays pinned once',
  );
});

Deno.test('a bot reaches only private chats an account started and supergroups it is in', () => {
  const {
    session,
    ada,
    grace,
    outsider,
    pinningBot,
    removedBot,
    chatId,
    sendToSupergroup,
    sendToPinningBot,
  } = createPinningFixture();
  sendToPinningBot('hi');
  const messageId = sendToSupergroup(grace, 'hello');

  expectEqual(
    session.messagePinning.pinMessage({
      isSilent: false,
      pinner: { kind: 'bot', botId: pinningBot },
      chat: { type: 'private', peerId: grace },
      messageId: 1,
    }),
    { pinned: false, reason: 'chat_not_found' },
    'a private chat the account never started is unknown',
  );
  expectEqual(
    session.messagePinning.pinMessage({
      isSilent: false,
      pinner: { kind: 'bot', botId: removedBot },
      chat: { type: 'supergroup', chatId },
      messageId,
    }),
    { pinned: false, reason: 'bot_kicked' },
    'a removed bot is turned away',
  );
  expectEqual(
    session.messagePinning.pinMessage({
      isSilent: false,
      pinner: { kind: 'account', accountId: outsider },
      chat: { type: 'supergroup', chatId },
      messageId,
    }),
    { pinned: false, reason: 'not_a_member' },
    'an account that is no member is refused',
  );
  expectEqual(
    session.messagePinning.pinMessage({
      isSilent: false,
      pinner: { kind: 'bot', botId: pinningBot },
      chat: { type: 'supergroup', chatId },
      messageId: messageId + 100,
    }),
    { pinned: false, reason: 'message_not_found' },
    'an unknown message is not found',
  );
  expectEqual(
    session.messagePinning.pinMessage({
      isSilent: false,
      pinner: { kind: 'bot', botId: pinningBot },
      chat: { type: 'private', peerId: ada },
      messageId,
    }),
    { pinned: false, reason: 'message_not_found' },
    "a supergroup message's ID finds nothing in a private chat",
  );
});

Deno.test('supergroup pins need can_pin_messages, which bots get only as an administrator right', () => {
  const { session, ada, grace, pinningBot, memberBot, chatId, sendToSupergroup } =
    createPinningFixture();
  const messageId = sendToSupergroup(ada, 'rules');
  const chat: PinningChat = { type: 'supergroup', chatId };
  const pin = (pinner: Parameters<typeof session.messagePinning.pinMessage>[0]['pinner']) =>
    session.messagePinning.pinMessage({ isSilent: false, pinner, chat, messageId });
  const unpin = (pinner: Parameters<typeof session.messagePinning.unpinMessage>[0]['pinner']) =>
    session.messagePinning.unpinMessage({ pinner, chat, messageId });

  expectEqual(
    pin({ kind: 'bot', botId: memberBot }),
    { pinned: false, reason: 'not_enough_rights' },
    'default permissions grant a bot no pin right',
  );
  expectEqual(pin({ kind: 'account', accountId: grace }).pinned, true, 'defaults let members pin');
  expectEqual(
    unpin({ kind: 'bot', botId: pinningBot }).unpinned,
    true,
    'the right lets a bot unpin',
  );

  const withholdsPins = new Set<ChatPermission>(
    [...ALL_CHAT_PERMISSIONS].filter((permission) => permission !== 'can_pin_messages'),
  );
  session.sharedChatAdministration.changeDefaultPermissions({
    actor: { kind: 'account', accountId: ada },
    chatId,
    permissions: withholdsPins,
  });
  expectEqual(
    pin({ kind: 'account', accountId: grace }),
    { pinned: false, reason: 'not_enough_rights' },
    'defaults that withhold pins refuse members',
  );
  expectEqual(pin({ kind: 'account', accountId: ada }).pinned, true, 'the owner always pins');
  expectEqual(
    unpin({ kind: 'account', accountId: grace }),
    { unpinned: false, reason: 'not_enough_rights' },
    'unpinning needs the same permission',
  );
});

Deno.test('a public supergroup ignores its default permissions for pins', () => {
  const { session, ada, grace, memberBot, chatId: privateChatId, sendToSupergroup } =
    createPinningFixture();
  const creation = session.sharedChatAdministration.createSupergroup({
    title: 'Public',
    username: 'public_team',
    creatorAccountId: ada,
  });
  if (!creation.created) {
    throw new Error(`Supergroup was not created: ${creation.reason}`);
  }
  const chatId = creation.supergroup.id;
  for (const memberId of [grace, memberBot]) {
    session.sharedChatAdministration.addChatMember({ actorAccountId: ada, chatId, memberId });
  }
  const sent = session.supergroupMessaging.sendAccountMessage({
    fromAccountId: ada,
    chatId,
    content: { kind: 'text', text: 'public rules' },
  });
  if (!sent.sent) {
    throw new Error(`Message was not sent: ${sent.reason}`);
  }
  const messageId = messageIdIn(session, chatId, sent.message);
  const chat: PinningChat = { type: 'supergroup', chatId };
  const pin = (accountId: number) =>
    session.messagePinning.pinMessage({
      isSilent: false,
      pinner: { kind: 'account', accountId },
      chat,
      messageId,
    });

  expectEqual(
    pin(grace),
    { pinned: false, reason: 'not_enough_rights' },
    'a member gets no pin right from the defaults, which grant every permission',
  );
  promote(session, { ownerId: ada, chatId, memberId: grace, rights: ['can_delete_messages'] });
  expectEqual(
    pin(grace),
    { pinned: false, reason: 'not_enough_rights' },
    'nor does an administrator without the right',
  );
  promote(session, { ownerId: ada, chatId, memberId: grace, rights: ['can_pin_messages'] });
  expectEqual(pin(grace).pinned, true, 'the right lets the administrator pin');
  expectEqual(
    session.messagePinning.pinMessage({
      isSilent: false,
      pinner: { kind: 'account', accountId: grace },
      chat: { type: 'supergroup', chatId: privateChatId },
      messageId: sendToSupergroup(grace, 'private rules'),
    }).pinned,
    true,
    'a private supergroup applies its defaults',
  );
});

Deno.test('a service message cannot be pinned or unpinned, after the right to pin is checked', () => {
  const { session, ada, memberBot, pinningBot, chatId } = createPinningFixture();
  const serviceMessage = session.supergroupMessaging.getMessageHistory({ accountId: ada, chatId });
  if (!serviceMessage.found) {
    throw new Error('Expected the supergroup history');
  }
  const joinMessageId = messageIdIn(session, chatId, serviceMessage.messages[0]);
  const chat: PinningChat = { type: 'supergroup', chatId };

  expectEqual(
    session.messagePinning.pinMessage({
      isSilent: false,
      pinner: { kind: 'bot', botId: memberBot },
      chat,
      messageId: joinMessageId,
    }),
    { pinned: false, reason: 'not_enough_rights' },
    'the right to pin is checked first',
  );
  expectEqual(
    session.messagePinning.pinMessage({
      isSilent: false,
      pinner: { kind: 'bot', botId: pinningBot },
      chat,
      messageId: joinMessageId,
    }),
    { pinned: false, reason: 'service_message_not_pinnable' },
    'a service message is refused',
  );
  expectEqual(
    session.messagePinning.unpinMessage({
      pinner: { kind: 'bot', botId: pinningBot },
      chat,
      messageId: joinMessageId,
    }),
    { unpinned: false, reason: 'service_message_not_pinnable' },
    'an unpin of a service message is refused too',
  );
});

Deno.test('findNewestPinnedMessage returns the pinned message sent last', () => {
  const { session, ada, grace, pinningBot, chatId, sendToSupergroup } = createPinningFixture();
  const olderId = sendToSupergroup(ada, 'older');
  const newerId = sendToSupergroup(grace, 'newer');
  const pinner = { kind: 'bot', botId: pinningBot } as const;
  const chat: PinningChat = { type: 'supergroup', chatId };
  const newestText = () => {
    const message = session.messagePinning.findNewestPinnedMessage({ type: 'supergroup', chatId });
    return message?.content.kind === 'text' ? message.content.text : message;
  };

  expectEqual(newestText(), undefined, 'a chat without pins has none');
  session.messagePinning.pinMessage({ isSilent: false, pinner, chat, messageId: newerId });
  session.messagePinning.pinMessage({ isSilent: false, pinner, chat, messageId: olderId });
  expectEqual(newestText(), 'newer', 'pinning an older message keeps the newest');
  session.messagePinning.unpinMessage({ pinner, chat, messageId: newerId });
  expectEqual(newestText(), 'older', 'unpinning the newest shows the next');
});

Deno.test('unpinning all clears every pin of one chat, whoever wrote or pinned it, and keeps its messages', () => {
  const { session, ada, grace, pinningBot, memberBot, chatId, sendToSupergroup, sendToPinningBot } =
    createPinningFixture();
  const supergroup: PinningChat = { type: 'supergroup', chatId };
  const pinningBotChat: PinningChat = { type: 'private', peerId: ada };
  const botPinner = { kind: 'bot', botId: pinningBot } as const;
  const adaPinner = { kind: 'account', accountId: ada } as const;
  const pin = (pinner: MessagePinner, chat: PinningChat, messageId: number) =>
    expectEqual(
      session.messagePinning.pinMessage({ isSilent: false, pinner, chat, messageId }).pinned,
      true,
      `message ${messageId} is pinned`,
    );
  const botNotice = session.supergroupMessaging.sendBotMessage({
    fromBotId: pinningBot,
    chatId,
    content: { kind: 'text', text: 'bot notice' },
  });
  if (!botNotice.sent) {
    throw new Error(`Supergroup bot message was not sent: ${botNotice.reason}`);
  }
  pin(botPinner, supergroup, messageIdIn(session, chatId, botNotice.message));
  pin({ kind: 'account', accountId: grace }, supergroup, sendToSupergroup(grace, "grace's"));
  pin(adaPinner, supergroup, sendToSupergroup(ada, "ada's"));
  pin(botPinner, supergroup, sendToSupergroup(grace, "grace's, pinned by the bot"));
  expectEqual(
    pinnedTexts(session, ada, supergroup),
    ["grace's, pinned by the bot", "ada's", "grace's", 'bot notice'],
    'messages by the bot and by accounts are pinned in the supergroup',
  );
  pin(adaPinner, { type: 'private', peerId: pinningBot }, sendToPinningBot("ada's"));
  const botReply = session.privateMessaging.sendBotMessage({
    fromBotId: pinningBot,
    to: { type: 'private', accountId: ada },
    content: { kind: 'text', text: 'bot reply' },
  });
  if (!botReply.sent) {
    throw new Error(`Private bot message was not sent: ${botReply.reason}`);
  }
  pin(botPinner, pinningBotChat, messageIdIn(session, pinningBot, botReply.message));
  const otherBotMessage = session.privateMessaging.sendAccountMessage({
    fromAccountId: ada,
    to: { type: 'private', botId: memberBot },
    content: { kind: 'text', text: 'other bot' },
  });
  if (!otherBotMessage.sent) {
    throw new Error(`Private message was not sent: ${otherBotMessage.reason}`);
  }
  pin(
    { kind: 'bot', botId: memberBot },
    { type: 'private', peerId: ada },
    messageIdIn(session, memberBot, otherBotMessage.message),
  );
  const supergroupHistoryLength = () => {
    const history = session.supergroupMessaging.getMessageHistory({ accountId: ada, chatId });
    return history.found ? history.messages.length : undefined;
  };
  const historyLengthBefore = supergroupHistoryLength();

  expectEqual(
    session.messagePinning.unpinAllMessages({ pinner: botPinner, chat: supergroup }),
    { unpinned: true },
    'the administrator unpins four pins',
  );
  expectEqual(pinnedTexts(session, ada, supergroup), [], 'the supergroup pins nothing');
  expectEqual(
    session.messagePinning.findNewestPinnedMessage({ type: 'supergroup', chatId }),
    undefined,
    'no newest pin is left',
  );
  expectEqual(supergroupHistoryLength(), historyLengthBefore, 'no message is removed or recorded');
  expectEqual(
    pinnedTexts(session, ada, { type: 'private', peerId: pinningBot }),
    ['bot reply', "ada's"],
    "the bot's private chat keeps its pins",
  );

  expectEqual(
    session.messagePinning.unpinAllMessages({ pinner: botPinner, chat: pinningBotChat }),
    { unpinned: true },
    "the bot unpins the account's message and its own in their private chat",
  );
  expectEqual(
    pinnedTexts(session, ada, { type: 'private', peerId: pinningBot }),
    [],
    'the private chat pins nothing',
  );
  expectEqual(
    pinnedTexts(session, ada, { type: 'private', peerId: memberBot }),
    ['other bot'],
    "another bot's private chat with the account keeps its pin",
  );
  expectEqual(
    session.messagePinning.unpinAllMessages({ pinner: botPinner, chat: pinningBotChat }),
    { unpinned: true },
    'a chat that pins nothing is unpinned again without error',
  );
});

Deno.test('unpinning all checks access and the right to pin first, even when nothing is pinned', () => {
  const {
    session,
    ada,
    grace,
    outsider,
    pinningBot,
    memberBot,
    removedBot,
    chatId,
    sendToSupergroup,
    sendToPinningBot,
  } = createPinningFixture();
  const supergroup: PinningChat = { type: 'supergroup', chatId };
  const pinningBotChat: PinningChat = { type: 'private', peerId: ada };
  const unpinAll = (pinner: MessagePinner, chat: PinningChat) =>
    session.messagePinning.unpinAllMessages({ pinner, chat });
  const expectRefusals = (pinsState: string) => {
    const refusals: Array<[MessagePinner, PinningChat, string]> = [
      [{ kind: 'bot', botId: memberBot }, supergroup, 'not_enough_rights'],
      [{ kind: 'bot', botId: removedBot }, supergroup, 'bot_kicked'],
      [{ kind: 'account', accountId: outsider }, supergroup, 'not_a_member'],
      [{ kind: 'bot', botId: pinningBot }, { type: 'private', peerId: grace }, 'chat_not_found'],
    ];
    for (const [pinner, chat, reason] of refusals) {
      expectEqual(
        unpinAll(pinner, chat),
        { unpinned: false, reason },
        `${JSON.stringify(pinner)} is refused with ${pinsState}`,
      );
    }
  };
  sendToPinningBot('hello');

  expectRefusals('nothing pinned');
  const messageId = sendToSupergroup(grace, 'rules');
  session.messagePinning.pinMessage({
    isSilent: false,
    pinner: { kind: 'bot', botId: pinningBot },
    chat: supergroup,
    messageId,
  });
  session.messagePinning.pinMessage({
    isSilent: false,
    pinner: { kind: 'account', accountId: ada },
    chat: { type: 'private', peerId: pinningBot },
    messageId: sendToPinningBot('pinned'),
  });
  expectRefusals('a pin');

  expectEqual(
    session.sharedChatAdministration.demoteChatMember({
      actorAccountId: ada,
      chatId,
      memberId: pinningBot,
    }).demoted,
    true,
    'the pinning bot is demoted',
  );
  expectEqual(
    unpinAll({ kind: 'bot', botId: pinningBot }, supergroup),
    { unpinned: false, reason: 'not_enough_rights' },
    'a demoted bot lost the right',
  );
  session.botBlocking.blockBot({ accountId: ada, botId: pinningBot });
  expectEqual(
    unpinAll({ kind: 'bot', botId: pinningBot }, pinningBotChat),
    { unpinned: false, reason: 'bot_blocked' },
    'a blocked bot cannot unpin in the private chat',
  );
  expectEqual(
    pinnedTexts(session, ada, supergroup),
    ['rules'],
    'refusals keep the supergroup pin',
  );
  expectEqual(
    pinnedTexts(session, ada, { type: 'private', peerId: pinningBot }),
    ['pinned'],
    'refusals keep the private pin',
  );
});

function expectEqual(actual: unknown, expected: unknown, message: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `${message}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`,
    );
  }
}
