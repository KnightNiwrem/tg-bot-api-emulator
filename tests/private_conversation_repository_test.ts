import { PrivateConversationRepository } from '../src/repositories/private_conversation.ts';

Deno.test('PrivateConversationRepository stores one private conversation per account and bot pair', () => {
  const privateConversations = new PrivateConversationRepository();
  const conversationKey = { accountId: 1, botId: 2 };

  const firstConversation = privateConversations.startPrivateConversation(conversationKey);
  if (
    firstConversation.kind !== 'private' ||
    firstConversation.accountId !== conversationKey.accountId ||
    firstConversation.botId !== conversationKey.botId
  ) {
    throw new Error('Expected the conversation to retain both sides of its canonical identity');
  }

  const secondConversation = privateConversations.startPrivateConversation(conversationKey);
  if (secondConversation !== firstConversation) {
    throw new Error('Expected the account and bot pair to have one canonical conversation');
  }
  const otherBotConversation = privateConversations.startPrivateConversation({
    accountId: 1,
    botId: 3,
  });
  if (otherBotConversation === firstConversation) {
    throw new Error('Expected each account and bot pair to have a distinct conversation');
  }
});

Deno.test('PrivateConversationRepository gives each conversation a Telegram chat instance', () => {
  const privateConversations = new PrivateConversationRepository();
  const firstConversation = privateConversations.startPrivateConversation({
    accountId: 1,
    botId: 2,
  });
  const secondConversation = privateConversations.startPrivateConversation({
    accountId: 1,
    botId: 3,
  });

  for (const { chatInstance } of [firstConversation, secondConversation]) {
    const value = /^-?\d+$/.test(chatInstance) ? BigInt(chatInstance) : undefined;
    if (value === undefined || value < -(2n ** 63n) || value >= 2n ** 63n) {
      throw new Error(`Expected a signed 64-bit decimal chat instance, received ${chatInstance}`);
    }
  }
  if (firstConversation.chatInstance === secondConversation.chatInstance) {
    throw new Error('Expected distinct conversations to have distinct chat instances');
  }
});

Deno.test('PrivateConversationRepository records the reply interface message of a conversation', () => {
  const privateConversations = new PrivateConversationRepository();
  const conversationKey = { accountId: 1, botId: 2 };
  let unknownConversationError: unknown;
  try {
    privateConversations.setReplyInterfaceMessageId(conversationKey, 'keyboard-message');
  } catch (error) {
    unknownConversationError = error;
  }
  if (!(unknownConversationError instanceof Error)) {
    throw new Error('Expected a reply interface only for an existing conversation');
  }

  privateConversations.startPrivateConversation(conversationKey);
  privateConversations.startPrivateConversation({ accountId: 1, botId: 3 });
  privateConversations.setReplyInterfaceMessageId(conversationKey, 'keyboard-message');
  if (
    privateConversations.getReplyInterfaceMessageId(conversationKey) !== 'keyboard-message' ||
    privateConversations.getReplyInterfaceMessageId({ accountId: 1, botId: 3 }) !== undefined
  ) {
    throw new Error('Expected the reply interface message only in its conversation');
  }
  privateConversations.setReplyInterfaceMessageId(conversationKey, undefined);
  if (privateConversations.getReplyInterfaceMessageId(conversationKey) !== undefined) {
    throw new Error('Expected the reply interface message to be cleared');
  }
});

Deno.test('PrivateConversationRepository starts a conversation only when the account starts it', () => {
  const privateConversations = new PrivateConversationRepository();
  const conversationKey = { accountId: 1, botId: 2 };

  const openedConversation = privateConversations.openPrivateConversation(conversationKey);
  const startedAfterOpening = privateConversations.isPrivateConversationStarted(conversationKey);
  const startedConversation = privateConversations.startPrivateConversation(conversationKey);
  const reopenedConversation = privateConversations.openPrivateConversation(conversationKey);

  const outcomes = [
    startedAfterOpening,
    startedConversation === openedConversation,
    reopenedConversation === openedConversation,
    privateConversations.isPrivateConversationStarted(conversationKey),
    privateConversations.isPrivateConversationStarted({ accountId: 1, botId: 3 }),
  ];
  if (JSON.stringify(outcomes) !== JSON.stringify([false, true, true, true, false])) {
    throw new Error(
      `Expected an opened conversation to stay unstarted until the account starts it, received ${
        JSON.stringify(outcomes)
      }`,
    );
  }
});
