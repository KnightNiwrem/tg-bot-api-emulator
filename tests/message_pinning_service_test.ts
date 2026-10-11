import { assertEquals } from '@std/assert';
import type { SupergroupAdministratorRight } from '../src/types/chat_membership.ts';
import { ALL_CHAT_PERMISSIONS, type ChatPermission } from '../src/types/chat_permissions.ts';
import type { EmulationSession } from '../src/types/emulation_session.ts';
import type { ChatActor, ChatAddress } from '../src/types/virtual_chat.ts';
import type { ChatMessage } from '../src/types/virtual_message.ts';
import { buildSessionServices } from './support/session_services.ts';

/**
 * Creates a session where Ada owns a supergroup with Grace, a pinning bot that is an administrator
 * with `can_pin_messages`, a member bot, and a bot Ada removed, and where Ada has started a
 * private chat with the pinning bot.
 */
function createPinningFixture() {
  const session = buildSessionServices({ id: 'pinning' });
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
    assertEquals(
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
    const result = session.messageSending.sendAccountSupergroupMessage({
      fromAccountId: accountId,
      chat: { type: 'supergroup', chatId },
      content: { kind: 'text', text },
    });
    if (!result.sent) {
      throw new Error(`Supergroup message was not sent: ${result.reason}`);
    }
    return messageIdIn(session, chatId, result.message);
  };
  const sendToPinningBot = (text: string) => {
    const result = session.messageSending.sendAccountPrivateChatMessage({
      fromAccountId: ada,
      chat: { type: 'private', peerId: pinningBot },
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
  assertEquals(result.promoted, true, `member ${memberId} is promoted`);
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

type PinningChat = ChatAddress;
type MessagePinner = ChatActor;
/** Why an unpin of every message refused. */
type UnpinAllRefusalReason = Extract<
  ReturnType<typeof unpinAllAs>,
  { unpinned: false }
>['reason'];

/** Pins a message as the pinner, through the entry point of its kind. */
function pinAs(
  session: EmulationSession,
  { pinner, ...pin }: {
    readonly pinner: MessagePinner;
    readonly chat: PinningChat;
    readonly messageId: number;
    readonly isSilent: boolean;
  },
) {
  return pinner.kind === 'bot'
    ? session.messagePinning.pinMessageByBot({ fromBotId: pinner.botId, ...pin })
    : session.messagePinning.pinMessageByAccount({ fromAccountId: pinner.accountId, ...pin });
}

/** Unpins a message as the pinner, through the entry point of its kind. */
function unpinAs(
  session: EmulationSession,
  { pinner, ...unpin }: {
    readonly pinner: MessagePinner;
    readonly chat: PinningChat;
    readonly messageId?: number;
  },
) {
  return pinner.kind === 'bot'
    ? session.messagePinning.unpinMessageByBot({ fromBotId: pinner.botId, ...unpin })
    : session.messagePinning.unpinMessageByAccount({ fromAccountId: pinner.accountId, ...unpin });
}

/** Unpins every message of a chat as the pinner, through the entry point of its kind. */
function unpinAllAs(
  session: EmulationSession,
  { pinner, chat }: { readonly pinner: MessagePinner; readonly chat: PinningChat },
) {
  return pinner.kind === 'bot'
    ? session.messagePinning.unpinAllMessagesByBot({ fromBotId: pinner.botId, chat })
    : session.messagePinning.unpinAllMessagesByAccount({ fromAccountId: pinner.accountId, chat });
}

Deno.test('a chat pins several messages, lists them newest first, and unpins the newest by default', () => {
  const { session, ada, pinningBot, sendToPinningBot } = createPinningFixture();
  const firstId = sendToPinningBot('first');
  const secondId = sendToPinningBot('second');
  const thirdId = sendToPinningBot('third');
  const botChat: PinningChat = { type: 'private', peerId: ada };
  const accountChat: PinningChat = { type: 'private', peerId: pinningBot };
  const pinner = { kind: 'bot', botId: pinningBot } as const;

  for (const messageId of [thirdId, firstId]) {
    assertEquals(
      pinAs(session, { isSilent: false, pinner, chat: botChat, messageId })
        .pinned,
      true,
      `message ${messageId} is pinned`,
    );
  }
  assertEquals(
    pinAs(session, {
      isSilent: false,
      pinner: { kind: 'account', accountId: ada },
      chat: accountChat,
      messageId: secondId,
    }).pinned,
    true,
    'the account pins with the same pinned messages',
  );
  assertEquals(
    pinnedTexts(session, ada, accountChat),
    ['third', 'second', 'first'],
    'pinned messages are listed by sending order, not pinning order',
  );

  const unpin = unpinAs(session, { pinner, chat: botChat });
  assertEquals(unpin.unpinned, true, 'an unpin without a target succeeds');
  assertEquals(
    pinnedTexts(session, ada, accountChat),
    ['second', 'first'],
    'the newest is unpinned',
  );
  assertEquals(
    unpinAs(session, { pinner, chat: botChat, messageId: firstId }).unpinned,
    true,
    'an explicit unpin succeeds',
  );
  assertEquals(pinnedTexts(session, ada, accountChat), ['second'], 'the target is unpinned');
});

Deno.test('a repeated pin or an unpin of an unpinned message is refused without effect', () => {
  const { session, ada, pinningBot, sendToPinningBot } = createPinningFixture();
  const messageId = sendToPinningBot('hello');
  const pinner = { kind: 'bot', botId: pinningBot } as const;
  const chat: PinningChat = { type: 'private', peerId: ada };

  assertEquals(
    unpinAs(session, { pinner, chat, messageId }),
    { unpinned: false, reason: 'message_not_pinned' },
    'an unpinned message cannot be unpinned',
  );
  assertEquals(
    unpinAs(session, { pinner, chat }),
    { unpinned: false, reason: 'message_not_found' },
    'without a pinned message, an unpin without a target finds none',
  );
  pinAs(session, { isSilent: false, pinner, chat, messageId });
  assertEquals(
    pinAs(session, { isSilent: false, pinner, chat, messageId }),
    { pinned: false, reason: 'message_already_pinned' },
    'a pinned message cannot be pinned again',
  );
  assertEquals(
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

  assertEquals(
    pinAs(session, {
      isSilent: false,
      pinner: { kind: 'bot', botId: pinningBot },
      chat: { type: 'private', peerId: grace },
      messageId: 1,
    }),
    { pinned: false, reason: 'conversation_not_started' },
    'a private chat the account never started is unknown',
  );
  assertEquals(
    pinAs(session, {
      isSilent: false,
      pinner: { kind: 'bot', botId: pinningBot },
      chat: { type: 'private', peerId: 999_999 },
      messageId: 1,
    }),
    { pinned: false, reason: 'account_not_found' },
    'a private chat with no account is unknown',
  );
  assertEquals(
    pinAs(session, {
      isSilent: false,
      pinner: { kind: 'account', accountId: ada },
      chat: { type: 'private', peerId: 999_999 },
      messageId: 1,
    }),
    { pinned: false, reason: 'chat_not_found' },
    'an account has no private chat with a bot that does not exist',
  );
  assertEquals(
    pinAs(session, {
      isSilent: false,
      pinner: { kind: 'bot', botId: removedBot },
      chat: { type: 'supergroup', chatId },
      messageId,
    }),
    { pinned: false, reason: 'bot_kicked' },
    'a removed bot is turned away',
  );
  assertEquals(
    pinAs(session, {
      isSilent: false,
      pinner: { kind: 'account', accountId: outsider },
      chat: { type: 'supergroup', chatId },
      messageId,
    }),
    { pinned: false, reason: 'not_a_member' },
    'an account that is no member is refused',
  );
  assertEquals(
    pinAs(session, {
      isSilent: false,
      pinner: { kind: 'bot', botId: pinningBot },
      chat: { type: 'supergroup', chatId },
      messageId: messageId + 100,
    }),
    { pinned: false, reason: 'message_not_found' },
    'an unknown message is not found',
  );
  assertEquals(
    pinAs(session, {
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
  const pin = (pinner: MessagePinner) =>
    pinAs(session, { isSilent: false, pinner, chat, messageId });
  const unpin = (pinner: MessagePinner) => unpinAs(session, { pinner, chat, messageId });

  assertEquals(
    pin({ kind: 'bot', botId: memberBot }),
    { pinned: false, reason: 'not_enough_rights' },
    'default permissions grant a bot no pin right',
  );
  assertEquals(pin({ kind: 'account', accountId: grace }).pinned, true, 'defaults let members pin');
  assertEquals(
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
  assertEquals(
    pin({ kind: 'account', accountId: grace }),
    { pinned: false, reason: 'not_enough_rights' },
    'defaults that withhold pins refuse members',
  );
  assertEquals(pin({ kind: 'account', accountId: ada }).pinned, true, 'the owner always pins');
  assertEquals(
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
  const sent = session.messageSending.sendAccountSupergroupMessage({
    fromAccountId: ada,
    chat: { type: 'supergroup', chatId },
    content: { kind: 'text', text: 'public rules' },
  });
  if (!sent.sent) {
    throw new Error(`Message was not sent: ${sent.reason}`);
  }
  const messageId = messageIdIn(session, chatId, sent.message);
  const chat: PinningChat = { type: 'supergroup', chatId };
  const pin = (accountId: number) =>
    pinAs(session, {
      isSilent: false,
      pinner: { kind: 'account', accountId },
      chat,
      messageId,
    });

  assertEquals(
    pin(grace),
    { pinned: false, reason: 'not_enough_rights' },
    'a member gets no pin right from the defaults, which grant every permission',
  );
  promote(session, { ownerId: ada, chatId, memberId: grace, rights: ['can_delete_messages'] });
  assertEquals(
    pin(grace),
    { pinned: false, reason: 'not_enough_rights' },
    'nor does an administrator without the right',
  );
  promote(session, { ownerId: ada, chatId, memberId: grace, rights: ['can_pin_messages'] });
  assertEquals(pin(grace).pinned, true, 'the right lets the administrator pin');
  assertEquals(
    pinAs(session, {
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

  assertEquals(
    pinAs(session, {
      isSilent: false,
      pinner: { kind: 'bot', botId: memberBot },
      chat,
      messageId: joinMessageId,
    }),
    { pinned: false, reason: 'not_enough_rights' },
    'the right to pin is checked first',
  );
  assertEquals(
    pinAs(session, {
      isSilent: false,
      pinner: { kind: 'bot', botId: pinningBot },
      chat,
      messageId: joinMessageId,
    }),
    { pinned: false, reason: 'service_message_not_pinnable' },
    'a service message is refused',
  );
  assertEquals(
    unpinAs(session, {
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

  assertEquals(newestText(), undefined, 'a chat without pins has none');
  pinAs(session, { isSilent: false, pinner, chat, messageId: newerId });
  pinAs(session, { isSilent: false, pinner, chat, messageId: olderId });
  assertEquals(newestText(), 'newer', 'pinning an older message keeps the newest');
  unpinAs(session, { pinner, chat, messageId: newerId });
  assertEquals(newestText(), 'older', 'unpinning the newest shows the next');
});

Deno.test('unpinning all clears every pin of one chat, whoever wrote or pinned it, and keeps its messages', () => {
  const { session, ada, grace, pinningBot, memberBot, chatId, sendToSupergroup, sendToPinningBot } =
    createPinningFixture();
  const supergroup: PinningChat = { type: 'supergroup', chatId };
  const pinningBotChat: PinningChat = { type: 'private', peerId: ada };
  const botPinner = { kind: 'bot', botId: pinningBot } as const;
  const adaPinner = { kind: 'account', accountId: ada } as const;
  const pin = (pinner: MessagePinner, chat: PinningChat, messageId: number) =>
    assertEquals(
      pinAs(session, { isSilent: false, pinner, chat, messageId }).pinned,
      true,
      `message ${messageId} is pinned`,
    );
  const botNotice = session.messageSending.sendSupergroupMessage({
    fromBotId: pinningBot,
    chat: { type: 'supergroup', chatId },
    content: { kind: 'text', text: 'bot notice' },
  });
  if (!botNotice.sent) {
    throw new Error(`Supergroup bot message was not sent: ${botNotice.reason}`);
  }
  pin(botPinner, supergroup, messageIdIn(session, chatId, botNotice.message));
  pin({ kind: 'account', accountId: grace }, supergroup, sendToSupergroup(grace, "grace's"));
  pin(adaPinner, supergroup, sendToSupergroup(ada, "ada's"));
  pin(botPinner, supergroup, sendToSupergroup(grace, "grace's, pinned by the bot"));
  assertEquals(
    pinnedTexts(session, ada, supergroup),
    ["grace's, pinned by the bot", "ada's", "grace's", 'bot notice'],
    'messages by the bot and by accounts are pinned in the supergroup',
  );
  pin(adaPinner, { type: 'private', peerId: pinningBot }, sendToPinningBot("ada's"));
  const botReply = session.messageSending.sendPrivateChatMessage({
    fromBotId: pinningBot,
    chat: { type: 'private', peerId: ada },
    content: { kind: 'text', text: 'bot reply' },
  });
  if (!botReply.sent) {
    throw new Error(`Private bot message was not sent: ${botReply.reason}`);
  }
  pin(botPinner, pinningBotChat, messageIdIn(session, pinningBot, botReply.message));
  const otherBotMessage = session.messageSending.sendAccountPrivateChatMessage({
    fromAccountId: ada,
    chat: { type: 'private', peerId: memberBot },
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

  assertEquals(
    unpinAllAs(session, { pinner: botPinner, chat: supergroup }),
    { unpinned: true },
    'the administrator unpins four pins',
  );
  assertEquals(pinnedTexts(session, ada, supergroup), [], 'the supergroup pins nothing');
  assertEquals(
    session.messagePinning.findNewestPinnedMessage({ type: 'supergroup', chatId }),
    undefined,
    'no newest pin is left',
  );
  assertEquals(supergroupHistoryLength(), historyLengthBefore, 'no message is removed or recorded');
  assertEquals(
    pinnedTexts(session, ada, { type: 'private', peerId: pinningBot }),
    ['bot reply', "ada's"],
    "the bot's private chat keeps its pins",
  );

  assertEquals(
    unpinAllAs(session, { pinner: botPinner, chat: pinningBotChat }),
    { unpinned: true },
    "the bot unpins the account's message and its own in their private chat",
  );
  assertEquals(
    pinnedTexts(session, ada, { type: 'private', peerId: pinningBot }),
    [],
    'the private chat pins nothing',
  );
  assertEquals(
    pinnedTexts(session, ada, { type: 'private', peerId: memberBot }),
    ['other bot'],
    "another bot's private chat with the account keeps its pin",
  );
  assertEquals(
    unpinAllAs(session, { pinner: botPinner, chat: pinningBotChat }),
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
    unpinAllAs(session, { pinner, chat });
  const expectRefusals = (pinsState: string) => {
    const refusals: Array<[MessagePinner, PinningChat, UnpinAllRefusalReason]> = [
      [{ kind: 'bot', botId: memberBot }, supergroup, 'not_enough_rights'],
      [{ kind: 'bot', botId: removedBot }, supergroup, 'bot_kicked'],
      [{ kind: 'account', accountId: outsider }, supergroup, 'not_a_member'],
      [
        { kind: 'bot', botId: pinningBot },
        { type: 'private', peerId: grace },
        'conversation_not_started',
      ],
    ];
    for (const [pinner, chat, reason] of refusals) {
      assertEquals(
        unpinAll(pinner, chat),
        { unpinned: false, reason },
        `${JSON.stringify(pinner)} is refused with ${pinsState}`,
      );
    }
  };
  sendToPinningBot('hello');

  expectRefusals('nothing pinned');
  const messageId = sendToSupergroup(grace, 'rules');
  pinAs(session, {
    isSilent: false,
    pinner: { kind: 'bot', botId: pinningBot },
    chat: supergroup,
    messageId,
  });
  pinAs(session, {
    isSilent: false,
    pinner: { kind: 'account', accountId: ada },
    chat: { type: 'private', peerId: pinningBot },
    messageId: sendToPinningBot('pinned'),
  });
  expectRefusals('a pin');

  assertEquals(
    session.sharedChatAdministration.demoteChatMember({
      actorAccountId: ada,
      chatId,
      memberId: pinningBot,
    }).demoted,
    true,
    'the pinning bot is demoted',
  );
  assertEquals(
    unpinAll({ kind: 'bot', botId: pinningBot }, supergroup),
    { unpinned: false, reason: 'not_enough_rights' },
    'a demoted bot lost the right',
  );
  session.botBlocking.blockBot({ accountId: ada, botId: pinningBot });
  assertEquals(
    unpinAll({ kind: 'bot', botId: pinningBot }, pinningBotChat),
    { unpinned: false, reason: 'bot_blocked' },
    'a blocked bot cannot unpin in the private chat',
  );
  assertEquals(
    pinnedTexts(session, ada, supergroup),
    ['rules'],
    'refusals keep the supergroup pin',
  );
  assertEquals(
    pinnedTexts(session, ada, { type: 'private', peerId: pinningBot }),
    ['pinned'],
    'refusals keep the private pin',
  );
});
