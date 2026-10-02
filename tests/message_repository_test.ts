import { MessageRepository } from '../src/repositories/message.ts';

Deno.test('MessageRepository stores ordered private conversation history', () => {
  const messages = new MessageRepository();
  const firstConversation = { accountId: 1, botId: 2 };
  const secondConversation = { accountId: 1, botId: 3 };

  const firstMessage = messages.addPrivateMessage({
    conversation: firstConversation,
    authorRole: 'account',
    sentAtUnixSeconds: 1_700_000_000,
    content: { kind: 'text', text: 'first', entities: [] },
  });
  const unrelatedMessage = messages.addPrivateMessage({
    conversation: secondConversation,
    authorRole: 'account',
    sentAtUnixSeconds: 1_700_000_001,
    content: { kind: 'text', text: 'unrelated', entities: [] },
  });
  const secondMessage = messages.addPrivateMessage({
    conversation: firstConversation,
    authorRole: 'account',
    sentAtUnixSeconds: 1_700_000_002,
    content: { kind: 'text', text: 'second', entities: [] },
  });

  if (
    new Set([firstMessage.id, unrelatedMessage.id, secondMessage.id]).size !== 3
  ) {
    throw new Error('Expected each canonical message to have a distinct identity');
  }
  const history = messages.getPrivateConversationMessages(firstConversation);
  if (history.length !== 2 || history[0] !== firstMessage || history[1] !== secondMessage) {
    throw new Error('Expected history to contain only the conversation messages in order');
  }

  const repeatedHistoryLookup = messages.getPrivateConversationMessages(firstConversation);
  if (history === repeatedHistoryLookup) {
    throw new Error('Expected each history lookup to return a separate array');
  }
});

Deno.test('MessageRepository edits a message in place without changing its identity', () => {
  const messages = new MessageRepository();
  const conversation = { accountId: 1, botId: 2 };
  const inlineKeyboard = [[{ kind: 'callback' as const, text: 'Yes', callbackData: 'yes' }]];
  const firstMessage = messages.addPrivateMessage({
    conversation,
    authorRole: 'bot',
    sentAtUnixSeconds: 1_700_000_000,
    inlineKeyboard,
    content: { kind: 'text', text: 'Continue?', entities: [] },
  });
  const secondMessage = messages.addPrivateMessage({
    conversation,
    authorRole: 'account',
    sentAtUnixSeconds: 1_700_000_001,
    content: { kind: 'text', text: 'Later', entities: [] },
  });
  if (
    JSON.stringify(firstMessage.inlineKeyboard) !== JSON.stringify(inlineKeyboard) ||
    firstMessage.inlineKeyboard === inlineKeyboard ||
    secondMessage.inlineKeyboard !== undefined
  ) {
    throw new Error('Expected a stored copy of the inline keyboard only where one was attached');
  }

  const editedMessage = messages.editPrivateMessage(firstMessage.id, {
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
    editedMessage.authorRole !== 'bot' ||
    editedMessage.content.kind !== 'text' ||
    editedMessage.content.text !== 'Continued /start' ||
    editedMessage.content.entities.length !== 1 ||
    editedMessage.contentEditedAtUnixSeconds !== 1_700_000_005 ||
    'inlineKeyboard' in editedMessage
  ) {
    throw new Error('Expected the edit to replace only the editable content');
  }
  if (messages.getPrivateMessage(firstMessage.id) !== editedMessage) {
    throw new Error('Expected lookups to return the edited message');
  }
  const history = messages.getPrivateConversationMessages(conversation);
  if (history[0] !== editedMessage || history[1] !== secondMessage) {
    throw new Error('Expected history to keep the edited message in its original position');
  }
  if (messages.getPrivateMessage('unknown') !== undefined) {
    throw new Error('Expected an unknown canonical message ID to find nothing');
  }
});

Deno.test('MessageRepository keeps what an edit cannot change', () => {
  const messages = new MessageRepository();
  const conversation = { accountId: 1, botId: 2 };
  const question = messages.addPrivateMessage({
    conversation,
    authorRole: 'account',
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
  const answer = messages.addPrivateMessage({
    conversation,
    authorRole: 'bot',
    sentAtUnixSeconds: 1_700_000_001,
    replyToMessageId: question.id,
    replyInterfaceMarkup,
    isContentProtected: true,
    content: { kind: 'text', text: 'Pick one', entities: [] },
  });
  if (
    answer.replyInterfaceMarkup === replyInterfaceMarkup ||
    JSON.stringify(answer.replyInterfaceMarkup) !== JSON.stringify(replyInterfaceMarkup) ||
    question.isContentProtected || 'replyToMessageId' in question ||
    'replyInterfaceMarkup' in question
  ) {
    throw new Error('Expected a stored copy of the reply interface markup only where one was sent');
  }

  const editedAnswer = messages.editPrivateMessage(answer.id, {
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
  const privateMember = messages.addPrivateMessage({
    conversation: { accountId: 1, botId: 2 },
    authorRole: 'bot',
    sentAtUnixSeconds: 1_700_000_000,
    mediaGroupId,
    content: { ...photo, caption: { text: '', entities: [] }, showsCaptionAboveMedia: false },
  });
  const supergroupMember = messages.addSupergroupMessage({
    chatId: -1_000_000_000_001,
    author: { kind: 'bot', botId: 2 },
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
    messages.editPrivateMessage(privateMember.id, edit),
    messages.editSupergroupMessage(supergroupMember.id, edit),
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
    messages.addPrivateMessage({
      conversation,
      authorRole: 'account',
      sentAtUnixSeconds: 1_700_000_000,
      content: { kind: 'text', text, entities: [] },
    });
  const firstMessage = addMessage('first');
  const deletedMessage = addMessage('deleted');
  const lastMessage = addMessage('last');

  messages.deletePrivateMessage(deletedMessage.id);
  if (messages.getPrivateMessage(deletedMessage.id) !== undefined) {
    throw new Error('Expected the deleted message not to be retrievable');
  }
  const history = messages.getPrivateConversationMessages(conversation);
  if (history.length !== 2 || history[0] !== firstMessage || history[1] !== lastMessage) {
    throw new Error('Expected history to keep the other messages in order');
  }

  let secondDeletionError: unknown;
  try {
    messages.deletePrivateMessage(deletedMessage.id);
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
    messages.addSupergroupMessage({
      chatId,
      author: { kind: 'account', accountId: 1 },
      sentAtUnixSeconds: 1_700_000_000,
      content: { kind: 'text', text, entities: [] },
    });
  const first = add(-1_000_000_000_001, 'first');
  add(-1_000_000_000_002, 'unrelated');
  const second = add(-1_000_000_000_001, 'second');

  const edited = messages.editSupergroupMessage(first.id, {
    inlineKeyboard: undefined,
    contentEditedAtUnixSeconds: 1_700_000_001,
    content: { kind: 'text', text: 'edited', entities: [] },
  });
  messages.deleteSupergroupMessage(second.id);

  const history = messages.getSupergroupMessages(-1_000_000_000_001);
  if (
    history.length !== 1 || history[0] !== edited || edited.id !== first.id ||
    edited.contentEditedAtUnixSeconds !== 1_700_000_001 || !first.author ||
    messages.getSupergroupMessage(second.id) !== undefined ||
    messages.getPrivateMessage(first.id) !== undefined
  ) {
    throw new Error('Expected the supergroup history to hold only its edited remaining message');
  }
});

Deno.test('MessageRepository finds messages sent through inline bots until they are deleted', () => {
  const messages = new MessageRepository();
  const privateMessage = messages.addPrivateMessage({
    conversation: { accountId: 1, botId: 2 },
    authorRole: 'account',
    sentAtUnixSeconds: 1_700_000_000,
    content: { kind: 'text', text: 'Cats', entities: [] },
    viaBotId: 3,
  });
  const supergroupMessage = messages.addSupergroupMessage({
    chatId: -1_000_000_000_001,
    author: { kind: 'account', accountId: 1 },
    sentAtUnixSeconds: 1_700_000_000,
    content: { kind: 'text', text: 'Dogs', entities: [] },
    viaBotId: 3,
  });
  const ownMessage = messages.addPrivateMessage({
    conversation: { accountId: 1, botId: 2 },
    authorRole: 'account',
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

  const editedMessage = messages.editPrivateMessage(privateMessage.id, {
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

  messages.deletePrivateMessage(privateMessage.id);
  messages.deleteSupergroupMessage(supergroupMessage.id);
  if (
    messages.getMessageByInlineMessageId(privateViaBot.inlineMessageId) !== undefined ||
    messages.getMessageByInlineMessageId(supergroupViaBot.inlineMessageId) !== undefined
  ) {
    throw new Error('Expected deleted messages to be found by no inline message identifier');
  }
});
