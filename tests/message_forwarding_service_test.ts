import type {
  AccountChatMessageKey,
  AccountChatMessageLookupFailureReason,
  AccountChatMessageLookupResult,
} from '../src/services/account_chat_message.ts';
import {
  type ForwardAccountMessageInput,
  MessageForwardingService,
} from '../src/services/message_forwarding.ts';
import { ALL_CHAT_PERMISSIONS } from '../src/types/chat_permissions.ts';
import type { MessageForward } from '../src/types/message_forward.ts';
import type { PrivateConversation, Supergroup } from '../src/types/virtual_chat.ts';
import type { PrivateContentMessage, SupergroupMessage } from '../src/types/virtual_message.ts';

const ACCOUNT_ID = 1_000_001;
const BOT_ID = 1_000_002;
const SUPERGROUP_ID = -1_000_000_000_001;

const conversation: PrivateConversation = {
  kind: 'private',
  accountId: ACCOUNT_ID,
  botId: BOT_ID,
  chatInstance: '-7',
};
const privateMessage: PrivateContentMessage = {
  kind: 'private_message',
  id: 'private',
  conversation,
  authorRole: 'bot',
  sentAtUnixSeconds: 1_700_000_000,
  content: { kind: 'text', text: 'Hello', entities: [] },
  isContentProtected: false,
  isSilent: false,
  isPinned: false,
};
const supergroupMessage: SupergroupMessage = {
  kind: 'supergroup_message',
  id: 'supergroup',
  chatId: SUPERGROUP_ID,
  author: { kind: 'account', accountId: ACCOUNT_ID },
  sentAtUnixSeconds: 1_700_000_000,
  content: { kind: 'text', text: 'Welcome', entities: [] },
  isContentProtected: false,
  isSilent: false,
  isPinned: false,
};

function supergroup(hasProtectedContent: boolean): Supergroup {
  return {
    kind: 'supergroup',
    id: SUPERGROUP_ID,
    title: 'Team',
    chatInstance: '-42',
    hasProtectedContent,
    defaultPermissions: ALL_CHAT_PERMISSIONS,
  };
}

const forwardToBot: ForwardAccountMessageInput = {
  fromAccountId: ACCOUNT_ID,
  fromChat: { type: 'supergroup', chatId: SUPERGROUP_ID },
  messageId: 5,
  toChat: { type: 'private', botId: BOT_ID },
};

Deno.test('MessageForwardingService reports why the account cannot read the message, and sends nothing', () => {
  const reasons: readonly AccountChatMessageLookupFailureReason[] = [
    'account_not_found',
    'bot_not_found',
    'chat_not_found',
    'not_a_member',
    'message_not_found',
  ];

  const results = reasons.map((reason) => {
    const { forwarding, readKeys, sentForwards } = createForwardingFixture({
      found: false,
      reason,
    });
    const result = forwarding.forwardAccountMessage(forwardToBot);
    return {
      reason: result.forwarded ? 'forwarded' : result.reason,
      readKeys,
      sentForwardCount: sentForwards.length,
    };
  });

  const expectedReadKey = {
    accountId: ACCOUNT_ID,
    chat: { type: 'supergroup', chatId: SUPERGROUP_ID },
    messageId: 5,
  };
  const expected = reasons.map((reason) => ({
    reason,
    readKeys: [expectedReadKey],
    sentForwardCount: 0,
  }));
  if (JSON.stringify(results) !== JSON.stringify(expected)) {
    throw new Error(`Expected each lookup failure unchanged, received ${JSON.stringify(results)}`);
  }
});

Deno.test('MessageForwardingService refuses messages of a supergroup that protects its content', () => {
  const protectedForward = createForwardingFixture({
    found: true,
    message: supergroupMessage,
    chat: supergroup(true),
  });
  const unprotectedForward = createForwardingFixture({
    found: true,
    message: supergroupMessage,
    chat: supergroup(false),
  });
  const privateForward = createForwardingFixture({
    found: true,
    message: privateMessage,
    chat: conversation,
  });

  const outcomes = [protectedForward, unprotectedForward, privateForward].map(
    ({ forwarding, sentForwards }) => {
      const result = forwarding.forwardAccountMessage(forwardToBot);
      return [
        result.forwarded ? 'forwarded' : result.reason,
        sentForwards.map(({ destination, forward }) => [destination, forward.content.kind]),
      ];
    },
  );
  const expected = [
    ['message_not_forwardable', []],
    ['forwarded', [['private', 'text']]],
    ['forwarded', [['private', 'text']]],
  ];
  if (JSON.stringify(outcomes) !== JSON.stringify(expected)) {
    throw new Error(
      `Expected only the protected supergroup to refuse, received ${JSON.stringify(outcomes)}`,
    );
  }
});

/** A forwarding service whose reader finds the given result, and which records what it sends. */
function createForwardingFixture(lookupResult: AccountChatMessageLookupResult) {
  const readKeys: AccountChatMessageKey[] = [];
  const sentForwards: {
    readonly destination: 'private' | 'supergroup';
    readonly forward: MessageForward;
  }[] = [];
  const forwarding = new MessageForwardingService({
    accountChatMessages: {
      findMessage: (key) => {
        readKeys.push(key);
        return lookupResult;
      },
    },
    privateMessages: {
      sendAccountForward: ({ forward }) => {
        sentForwards.push({ destination: 'private', forward });
        return { sent: true, message: privateMessage };
      },
    },
    supergroupMessages: {
      sendAccountForward: ({ forward }) => {
        sentForwards.push({ destination: 'supergroup', forward });
        return { sent: true, message: supergroupMessage };
      },
    },
    getPrivateForwardName: () => undefined,
  });
  return { forwarding, readKeys, sentForwards };
}
