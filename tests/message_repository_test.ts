import { assertEquals } from '@std/assert';
import { MessageRepository } from '../src/repositories/message/message.ts';
import type { ChatKey, PrivateChatKey, SupergroupChatKey } from '../src/types/virtual_chat.ts';
import { type ChatMessage, getContentText } from '../src/types/virtual_message.ts';

Deno.test('MessageRepository stores ordered private conversation history', () => {
  const messages = new MessageRepository();
  const firstConversation = { accountId: 1, botId: 2 };
  const secondConversation = { accountId: 1, botId: 3 };

  const firstMessage = messages.addMessage({
    chat: { type: 'private', conversation: firstConversation },
    sender: 'account',
    sentAtUnixSeconds: 1_700_000_000,
    content: { kind: 'text', text: 'first', entities: [] },
  });
  const unrelatedMessage = messages.addMessage({
    chat: { type: 'private', conversation: secondConversation },
    sender: 'account',
    sentAtUnixSeconds: 1_700_000_001,
    content: { kind: 'text', text: 'unrelated', entities: [] },
  });
  const secondMessage = messages.addMessage({
    chat: { type: 'private', conversation: firstConversation },
    sender: 'account',
    sentAtUnixSeconds: 1_700_000_002,
    content: { kind: 'text', text: 'second', entities: [] },
  });

  if (
    new Set([firstMessage.id, unrelatedMessage.id, secondMessage.id]).size !== 3
  ) {
    throw new Error('Expected each canonical message to have a distinct identity');
  }
  const history = messages.getChatMessages({ type: 'private', conversation: firstConversation });
  if (history.length !== 2 || history[0] !== firstMessage || history[1] !== secondMessage) {
    throw new Error('Expected history to contain only the conversation messages in order');
  }

  const repeatedHistoryLookup = messages.getChatMessages({
    type: 'private',
    conversation: firstConversation,
  });
  if (history === repeatedHistoryLookup) {
    throw new Error('Expected each history lookup to return a separate array');
  }
});

Deno.test('MessageRepository edits a message in place without changing its identity', () => {
  const messages = new MessageRepository();
  const conversation = { accountId: 1, botId: 2 };
  const inlineKeyboard = [[{ kind: 'callback' as const, text: 'Yes', callbackData: 'yes' }]];
  const firstMessage = messages.addMessage({
    chat: { type: 'private', conversation },
    sender: 'bot',
    sentAtUnixSeconds: 1_700_000_000,
    inlineKeyboard,
    content: { kind: 'text', text: 'Continue?', entities: [] },
  });
  const secondMessage = messages.addMessage({
    chat: { type: 'private', conversation },
    sender: 'account',
    sentAtUnixSeconds: 1_700_000_001,
    content: { kind: 'text', text: 'Later', entities: [] },
  });
  if (
    firstMessage.inlineKeyboard === inlineKeyboard ||
    secondMessage.inlineKeyboard !== undefined
  ) {
    throw new Error('Expected a stored copy of the inline keyboard only where one was attached');
  }
  assertEquals(
    firstMessage.inlineKeyboard,
    inlineKeyboard,
    'Expected a stored copy of the inline keyboard only where one was attached',
  );

  const editedMessage = messages.editMessage(firstMessage.chat, firstMessage.id, {
    inlineKeyboard: undefined,
    contentEditedAtUnixSeconds: 1_700_000_005,
    content: {
      kind: 'text',
      text: 'Continued /start',
      entities: [{ type: 'bot_command', offset: 10, length: 6 }],
    },
  });
  if (
    editedMessage.id !== firstMessage.id ||
    editedMessage.sentAtUnixSeconds !== 1_700_000_000 ||
    editedMessage.sender !== 'bot' ||
    editedMessage.content.kind !== 'text' ||
    editedMessage.content.text !== 'Continued /start' ||
    editedMessage.content.entities.length !== 1 ||
    editedMessage.contentEditedAtUnixSeconds !== 1_700_000_005 ||
    'inlineKeyboard' in editedMessage
  ) {
    throw new Error('Expected the edit to replace only the editable content');
  }
  if (messages.findChatMessage(firstMessage.chat, firstMessage.id) !== editedMessage) {
    throw new Error('Expected lookups to return the edited message');
  }
  const history = messages.getChatMessages({ type: 'private', conversation });
  if (history[0] !== editedMessage || history[1] !== secondMessage) {
    throw new Error('Expected history to keep the edited message in its original position');
  }
  if (messages.findChatMessage({ type: 'private', conversation }, 'unknown') !== undefined) {
    throw new Error('Expected an unknown canonical message ID to find nothing');
  }
});

Deno.test('MessageRepository keeps what an edit cannot change', () => {
  const messages = new MessageRepository();
  const conversation = { accountId: 1, botId: 2 };
  const question = messages.addMessage({
    chat: { type: 'private', conversation },
    sender: 'account',
    sentAtUnixSeconds: 1_700_000_000,
    content: { kind: 'text', text: 'Colors?', entities: [] },
  });
  const replyInterfaceMarkup = {
    kind: 'reply_keyboard' as const,
    rows: [[{ text: 'Red' }]],
    isPersistent: true,
    resizesToFit: false,
    isOneTime: false,
    isSelective: false,
  };
  const answer = messages.addMessage({
    chat: { type: 'private', conversation },
    sender: 'bot',
    sentAtUnixSeconds: 1_700_000_001,
    replyToMessageId: question.id,
    replyInterfaceMarkup,
    isContentProtected: true,
    content: { kind: 'text', text: 'Pick one', entities: [] },
  });
  if (
    answer.replyInterfaceMarkup === replyInterfaceMarkup ||
    question.isContentProtected ||
    'replyToMessageId' in question ||
    'replyInterfaceMarkup' in question
  ) {
    throw new Error('Expected a stored copy of the reply interface markup only where one was sent');
  }
  assertEquals(
    answer.replyInterfaceMarkup,
    replyInterfaceMarkup,
    'Expected a stored copy of the reply interface markup only where one was sent',
  );

  const editedAnswer = messages.editMessage(answer.chat, answer.id, {
    inlineKeyboard: undefined,
    contentEditedAtUnixSeconds: 1_700_000_005,
    content: { kind: 'text', text: 'Pick a color', entities: [] },
  });
  if (
    editedAnswer.replyToMessageId !== question.id ||
    editedAnswer.replyInterfaceMarkup !== answer.replyInterfaceMarkup ||
    !editedAnswer.isContentProtected
  ) {
    throw new Error('Expected the edit to keep the reply, reply interface markup, and protection');
  }
});

Deno.test('MessageRepository keeps fields that only some messages carry through an edit', () => {
  const messages = new MessageRepository();
  const forwardInfo = {
    originalSender: { kind: 'hidden_user' as const, name: 'Ann' },
    originalSentAtUnixSeconds: 1_600_000_000,
  };
  const privateMessage = messages.addMessage({
    chat: { type: 'private', conversation: { accountId: 1, botId: 2 } },
    sender: 'account',
    sentAtUnixSeconds: 1_700_000_000,
    content: { kind: 'text', text: 'Forwarded', entities: [] },
    forwardInfo,
    isSilent: true,
    messageEffectId: '5104841245755180586',
  });
  const supergroupMessage = messages.addMessage({
    chat: { type: 'supergroup', chatId: -1_000_000_000_001 },
    sender: { kind: 'account', accountId: 1 },
    sentAtUnixSeconds: 1_700_000_000,
    content: { kind: 'text', text: 'Quoted', entities: [] },
    externalReply: { origin: forwardInfo },
    quote: { text: { text: 'Hi', entities: [] }, position: 0, isManual: true },
    viaBotId: 3,
  });
  const edit = {
    content: { kind: 'text' as const, text: 'Edited', entities: [] },
    inlineKeyboard: undefined,
    contentEditedAtUnixSeconds: 1_700_000_005,
  };

  const editedPrivateMessage = messages.editMessage(privateMessage.chat, privateMessage.id, edit);
  const editedSupergroupMessage = messages.editMessage(
    supergroupMessage.chat,
    supergroupMessage.id,
    edit,
  );
  assertEquals(
    [
      editedPrivateMessage.messageEffectId,
      editedPrivateMessage.forwardInfo,
      editedPrivateMessage.isSilent,
      editedSupergroupMessage.externalReply,
      editedSupergroupMessage.quote,
      editedSupergroupMessage.viaBot,
    ],
    [
      '5104841245755180586',
      forwardInfo,
      true,
      supergroupMessage.externalReply,
      supergroupMessage.quote,
      supergroupMessage.viaBot,
    ],
    'Expected the edits to keep every field they do not replace',
  );
  if (
    [
      forwardInfo,
      supergroupMessage.externalReply,
      supergroupMessage.quote,
      supergroupMessage.viaBot,
    ]
      .includes(undefined)
  ) {
    throw new Error('Expected the fixture to set every field the edits keep');
  }
});

Deno.test('MessageRepository drops the inline keyboard and edit time that an edit omits', () => {
  const messages = new MessageRepository();
  const inlineKeyboard = [[{ kind: 'callback' as const, text: 'Yes', callbackData: 'yes' }]];
  const message = messages.addMessage({
    chat: { type: 'supergroup', chatId: -1_000_000_000_001 },
    sender: { kind: 'bot', botId: 2 },
    sentAtUnixSeconds: 1_700_000_000,
    content: { kind: 'text', text: 'Continue?', entities: [] },
    inlineKeyboard,
  });
  const editedMessage = messages.editMessage(message.chat, message.id, {
    content: { kind: 'text', text: 'Continue now?', entities: [] },
    inlineKeyboard,
    contentEditedAtUnixSeconds: 1_700_000_005,
  });
  if (editedMessage.contentEditedAtUnixSeconds !== 1_700_000_005) {
    throw new Error('Expected the edit to write the inline keyboard and edit time it carries');
  }
  assertEquals(
    editedMessage.inlineKeyboard,
    inlineKeyboard,
    'Expected the edit to write the inline keyboard and edit time it carries',
  );

  const reeditedMessage = messages.editMessage(message.chat, message.id, {
    content: { kind: 'text', text: 'Done', entities: [] },
    inlineKeyboard: undefined,
    contentEditedAtUnixSeconds: undefined,
  });
  if ('inlineKeyboard' in reeditedMessage || 'contentEditedAtUnixSeconds' in reeditedMessage) {
    throw new Error('Expected the edit to drop the inline keyboard and edit time it omits');
  }
});

Deno.test('MessageRepository issues distinct album identifiers that messages keep through edits', () => {
  const messages = new MessageRepository();
  const mediaGroupIds = Array.from({ length: 100 }, () => messages.createMediaGroupId());
  if (
    new Set(mediaGroupIds).size !== mediaGroupIds.length ||
    mediaGroupIds.some((mediaGroupId) =>
      !/^[1-9]\d*$/.test(mediaGroupId) || BigInt(mediaGroupId) >= 1n << 63n
    )
  ) {
    throw new Error(`Expected distinct positive 64-bit identifiers, received ${mediaGroupIds}`);
  }

  const [mediaGroupId] = mediaGroupIds;
  const photo = { kind: 'photo' as const, fileId: 'file', hasSpoiler: false };
  const privateMember = messages.addMessage({
    chat: { type: 'private', conversation: { accountId: 1, botId: 2 } },
    sender: 'bot',
    sentAtUnixSeconds: 1_700_000_000,
    mediaGroupId,
    content: { ...photo, caption: { text: '', entities: [] }, showsCaptionAboveMedia: false },
  });
  const supergroupMember = messages.addMessage({
    chat: { type: 'supergroup', chatId: -1_000_000_000_001 },
    sender: { kind: 'bot', botId: 2 },
    sentAtUnixSeconds: 1_700_000_000,
    mediaGroupId,
    content: { ...photo, caption: { text: '', entities: [] }, showsCaptionAboveMedia: false },
  });
  const edit = {
    inlineKeyboard: undefined,
    contentEditedAtUnixSeconds: 1_700_000_005,
    content: {
      ...photo,
      caption: { text: 'Edited', entities: [] },
      showsCaptionAboveMedia: false,
    },
  };
  const editedMembers = [
    messages.editMessage(privateMember.chat, privateMember.id, edit),
    messages.editMessage(supergroupMember.chat, supergroupMember.id, edit),
  ];
  if (
    privateMember.mediaGroupId !== mediaGroupId ||
    supergroupMember.mediaGroupId !== mediaGroupId ||
    editedMembers.some((member) => member.mediaGroupId !== mediaGroupId)
  ) {
    throw new Error('Expected messages to keep their album through an edit');
  }
});

Deno.test('MessageRepository deletes a message from the store and its conversation history', () => {
  const messages = new MessageRepository();
  const conversation = { accountId: 1, botId: 2 };
  const addMessage = (text: string) =>
    messages.addMessage({
      chat: { type: 'private', conversation },
      sender: 'account',
      sentAtUnixSeconds: 1_700_000_000,
      content: { kind: 'text', text, entities: [] },
    });
  const firstMessage = addMessage('first');
  const deletedMessage = addMessage('deleted');
  const lastMessage = addMessage('last');

  messages.deleteMessage(deletedMessage.id);
  if (messages.findChatMessage(deletedMessage.chat, deletedMessage.id) !== undefined) {
    throw new Error('Expected the deleted message not to be retrievable');
  }
  const history = messages.getChatMessages({ type: 'private', conversation });
  if (history.length !== 2 || history[0] !== firstMessage || history[1] !== lastMessage) {
    throw new Error('Expected history to keep the other messages in order');
  }

  let secondDeletionError: unknown;
  try {
    messages.deleteMessage(deletedMessage.id);
  } catch (error) {
    secondDeletionError = error;
  }
  if (!(secondDeletionError instanceof Error)) {
    throw new Error('Expected deleting a message that is not stored to throw');
  }
});

Deno.test('MessageRepository stores, edits, and deletes supergroup messages by chat', () => {
  const messages = new MessageRepository();
  const add = (chatId: number, text: string) =>
    messages.addMessage({
      chat: { type: 'supergroup', chatId },
      sender: { kind: 'account', accountId: 1 },
      sentAtUnixSeconds: 1_700_000_000,
      content: { kind: 'text', text, entities: [] },
    });
  const first = add(-1_000_000_000_001, 'first');
  add(-1_000_000_000_002, 'unrelated');
  const second = add(-1_000_000_000_001, 'second');

  const edited = messages.editMessage(first.chat, first.id, {
    inlineKeyboard: undefined,
    contentEditedAtUnixSeconds: 1_700_000_001,
    content: { kind: 'text', text: 'edited', entities: [] },
  });
  messages.deleteMessage(second.id);

  const history = messages.getChatMessages({ type: 'supergroup', chatId: -1_000_000_000_001 });
  if (
    history.length !== 1 || history[0] !== edited || edited.id !== first.id ||
    edited.contentEditedAtUnixSeconds !== 1_700_000_001 || !first.sender ||
    messages.findChatMessage(second.chat, second.id) !== undefined ||
    messages.findChatMessage({ type: 'supergroup', chatId: -1_000_000_000_002 }, first.id) !==
      undefined ||
    messages.findChatMessage(
        { type: 'private', conversation: { accountId: 1, botId: 2 } },
        first.id,
      ) !==
      undefined
  ) {
    throw new Error('Expected the supergroup history to hold only its edited remaining message');
  }
});

Deno.test('MessageRepository finds messages sent through inline bots until they are deleted', () => {
  const messages = new MessageRepository();
  const privateMessage = messages.addMessage({
    chat: { type: 'private', conversation: { accountId: 1, botId: 2 } },
    sender: 'account',
    sentAtUnixSeconds: 1_700_000_000,
    content: { kind: 'text', text: 'Cats', entities: [] },
    viaBotId: 3,
  });
  const supergroupMessage = messages.addMessage({
    chat: { type: 'supergroup', chatId: -1_000_000_000_001 },
    sender: { kind: 'account', accountId: 1 },
    sentAtUnixSeconds: 1_700_000_000,
    content: { kind: 'text', text: 'Dogs', entities: [] },
    viaBotId: 3,
  });
  const ownMessage = messages.addMessage({
    chat: { type: 'private', conversation: { accountId: 1, botId: 2 } },
    sender: 'account',
    sentAtUnixSeconds: 1_700_000_000,
    content: { kind: 'text', text: 'Hello', entities: [] },
  });
  const privateViaBot = privateMessage.viaBot;
  const supergroupViaBot = supergroupMessage.viaBot;
  if (
    privateViaBot?.botId !== 3 || supergroupViaBot === undefined ||
    ownMessage.viaBot !== undefined ||
    !/^[A-Za-z0-9_-]{32}$/.test(privateViaBot.inlineMessageId) ||
    privateViaBot.inlineMessageId === supergroupViaBot.inlineMessageId
  ) {
    throw new Error('Expected distinct inline message identifiers only for messages through a bot');
  }

  const editedMessage = messages.editMessage(privateMessage.chat, privateMessage.id, {
    content: { kind: 'text', text: 'More cats', entities: [] },
    inlineKeyboard: undefined,
    contentEditedAtUnixSeconds: 1_700_000_001,
  });
  if (
    editedMessage.viaBot?.inlineMessageId !== privateViaBot.inlineMessageId ||
    messages.getMessageByInlineMessageId(privateViaBot.inlineMessageId) !== editedMessage ||
    messages.getMessageByInlineMessageId(supergroupViaBot.inlineMessageId) !== supergroupMessage
  ) {
    throw new Error('Expected edits to keep the inline message identifier');
  }

  messages.deleteMessage(privateMessage.id);
  messages.deleteMessage(supergroupMessage.id);
  if (
    messages.getMessageByInlineMessageId(privateViaBot.inlineMessageId) !== undefined ||
    messages.getMessageByInlineMessageId(supergroupViaBot.inlineMessageId) !== undefined
  ) {
    throw new Error('Expected deleted messages to be found by no inline message identifier');
  }
});

const FIRST_PRIVATE_CHAT: PrivateChatKey = {
  type: 'private',
  conversation: { accountId: 1, botId: 2 },
};
/** Another private chat of the account of `FIRST_PRIVATE_CHAT`. */
const SECOND_PRIVATE_CHAT: PrivateChatKey = {
  type: 'private',
  conversation: { accountId: 1, botId: 3 },
};
/** Another private chat of the bot of `FIRST_PRIVATE_CHAT`. */
const OTHER_ACCOUNT_PRIVATE_CHAT: PrivateChatKey = {
  type: 'private',
  conversation: { accountId: 4, botId: 2 },
};
const FIRST_SUPERGROUP: SupergroupChatKey = { type: 'supergroup', chatId: -1_000_000_000_001 };
const SECOND_SUPERGROUP: SupergroupChatKey = { type: 'supergroup', chatId: -1_000_000_000_002 };
const CHATS: readonly ChatKey[] = [
  FIRST_PRIVATE_CHAT,
  SECOND_PRIVATE_CHAT,
  OTHER_ACCOUNT_PRIVATE_CHAT,
  FIRST_SUPERGROUP,
  SECOND_SUPERGROUP,
];

/** Stores a text message of the account in a private chat, or of account 1 in a supergroup. */
function addText(messages: MessageRepository, chat: ChatKey, text: string): ChatMessage {
  const content = { kind: 'text', text, entities: [] } as const;
  return chat.type === 'private'
    ? messages.addMessage({ chat, sender: 'account', sentAtUnixSeconds: 1_700_000_000, content })
    : messages.addMessage({
      chat,
      sender: { kind: 'account', accountId: 1 },
      sentAtUnixSeconds: 1_700_000_000,
      content,
    });
}

function getTexts(messages: readonly ChatMessage[]): readonly string[] {
  return messages.map((message) => getContentText(message.content).text);
}

Deno.test('MessageRepository keeps one log per chat, whatever the chat type', () => {
  const messages = new MessageRepository();
  const stored = [
    addText(messages, FIRST_PRIVATE_CHAT, 'private 1a'),
    addText(messages, FIRST_SUPERGROUP, 'supergroup 1a'),
    addText(messages, SECOND_PRIVATE_CHAT, 'private 2a'),
    addText(messages, FIRST_PRIVATE_CHAT, 'private 1b'),
    addText(messages, OTHER_ACCOUNT_PRIVATE_CHAT, 'other account a'),
    addText(messages, SECOND_SUPERGROUP, 'supergroup 2a'),
    addText(messages, FIRST_SUPERGROUP, 'supergroup 1b'),
  ];

  assertEquals(CHATS.map((chat) => getTexts(messages.getChatMessages(chat))), [
    ['private 1a', 'private 1b'],
    ['private 2a'],
    ['other account a'],
    ['supergroup 1a', 'supergroup 1b'],
    ['supergroup 2a'],
  ]);
  assertEquals(
    stored.map((message) => [message.kind, message.chat.type]),
    [
      ['private_message', 'private'],
      ['supergroup_message', 'supergroup'],
      ['private_message', 'private'],
      ['private_message', 'private'],
      ['private_message', 'private'],
      ['supergroup_message', 'supergroup'],
      ['supergroup_message', 'supergroup'],
    ],
  );
  // Each message is found through its own chat's key only: not through another chat of either
  // participant, nor through a chat of the other type.
  assertEquals(
    stored.map((message) =>
      CHATS.map((chat) => messages.findChatMessage(chat, message.id) === message)
    ),
    [
      [true, false, false, false, false],
      [false, false, false, true, false],
      [false, true, false, false, false],
      [true, false, false, false, false],
      [false, false, true, false, false],
      [false, false, false, false, true],
      [false, false, false, true, false],
    ],
  );
});

Deno.test("MessageRepository deletes and edits a message only through its own chat's log", () => {
  const messages = new MessageRepository();
  const [privateMessage, supergroupMessage] = [FIRST_PRIVATE_CHAT, FIRST_SUPERGROUP].map(
    (chat) => {
      const deleted = addText(messages, chat, 'deleted');
      addText(messages, chat, 'kept');
      return deleted;
    },
  );
  const otherChatMessages = [SECOND_PRIVATE_CHAT, SECOND_SUPERGROUP].map((chat) =>
    addText(messages, chat, 'other chat')
  );
  const edit = {
    content: { kind: 'text', text: 'edited', entities: [] },
    inlineKeyboard: undefined,
    contentEditedAtUnixSeconds: 1_700_000_005,
  } as const;
  const refusals = [
    () => messages.editMessage(SECOND_PRIVATE_CHAT, privateMessage.id, edit),
    () => messages.editMessage(SECOND_SUPERGROUP, supergroupMessage.id, edit),
    () => messages.editMessage(FIRST_SUPERGROUP, privateMessage.id, edit),
    () => messages.setMessageReactions(SECOND_SUPERGROUP, supergroupMessage.id, []),
  ].map((change) => {
    try {
      change();
      return 'changed';
    } catch (error) {
      return error instanceof Error ? 'refused' : error;
    }
  });
  assertEquals(refusals, ['refused', 'refused', 'refused', 'refused']);
  assertEquals(
    [privateMessage, supergroupMessage].map((message) =>
      messages.findChatMessage(message.chat, message.id) === message
    ),
    [true, true],
  );

  messages.deleteMessage(privateMessage.id);
  messages.deleteMessage(supergroupMessage.id);
  assertEquals(CHATS.map((chat) => getTexts(messages.getChatMessages(chat))), [
    ['kept'],
    ['other chat'],
    [],
    ['kept'],
    ['other chat'],
  ]);
  assertEquals(
    [privateMessage, supergroupMessage, ...otherChatMessages].map((message) =>
      messages.findChatMessage(message.chat, message.id) !== undefined
    ),
    [false, false, true, true],
  );
});

Deno.test('MessageRepository keeps the fields only some chat types carry through other changes', () => {
  const messages = new MessageRepository();
  const content = { kind: 'text', text: 'Hello', entities: [] } as const;
  const privateMessage = messages.addMessage({
    chat: FIRST_PRIVATE_CHAT,
    sender: 'bot',
    sentAtUnixSeconds: 1_700_000_000,
    content,
    messageEffectId: '5104841245755180586',
  });
  const supergroupMessage = messages.addMessage({
    chat: FIRST_SUPERGROUP,
    sender: { kind: 'bot', botId: 2 },
    sentAtUnixSeconds: 1_700_000_000,
    content,
  });
  const reactions = [{ userId: 1, emojis: ['👍' as const] }];
  const reactedMessage = messages.setMessageReactions(
    FIRST_SUPERGROUP,
    supergroupMessage.id,
    reactions,
  );
  const edit = { content, inlineKeyboard: undefined, contentEditedAtUnixSeconds: 1_700_000_005 };
  const editedPrivateMessage = messages.editMessage(FIRST_PRIVATE_CHAT, privateMessage.id, edit);
  const editedSupergroupMessage = messages.editMessage(
    FIRST_SUPERGROUP,
    supergroupMessage.id,
    edit,
  );
  const pinnedPrivateMessage = messages.setMessagePinned(privateMessage.id, true);
  const pinnedSupergroupMessage = messages.setMessagePinned(supergroupMessage.id, true);
  const unreactedMessage = messages.setMessageReactions(
    FIRST_SUPERGROUP,
    supergroupMessage.id,
    [],
  );

  assertEquals(
    [
      reactedMessage.reactions,
      editedSupergroupMessage.reactions,
      pinnedSupergroupMessage.kind === 'supergroup_message' && pinnedSupergroupMessage.reactions,
      'reactions' in unreactedMessage,
      unreactedMessage.isPinned,
      reactedMessage.reactions === reactions,
    ],
    [reactions, reactions, reactions, false, true, false],
  );
  assertEquals(
    [
      editedPrivateMessage.messageEffectId,
      pinnedPrivateMessage.kind === 'private_message' && pinnedPrivateMessage.messageEffectId,
      'messageEffectId' in supergroupMessage,
    ],
    ['5104841245755180586', '5104841245755180586', false],
  );
});
