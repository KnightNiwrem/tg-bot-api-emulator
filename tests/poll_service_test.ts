import type {
  AccountChatMessageLookupFailureReason,
  AccountChatMessageLookupResult,
} from '../src/services/account_chat_message.ts';
import { type AccountPollMessageKey, PollService } from '../src/services/poll.ts';
import type { PrivateConversation } from '../src/types/virtual_chat.ts';
import type { PrivateContentMessage } from '../src/types/virtual_message.ts';

const ACCOUNT_ID = 1_000_001;
const BOT_ID = 1_000_002;

const conversation: PrivateConversation = {
  kind: 'private',
  accountId: ACCOUNT_ID,
  botId: BOT_ID,
  chatInstance: '-7',
};
const textMessage: PrivateContentMessage = {
  kind: 'private_message',
  id: 'text',
  conversation,
  authorRole: 'bot',
  sentAtUnixSeconds: 1_700_000_000,
  content: { kind: 'text', text: 'Hello', entities: [] },
  isContentProtected: false,
  isSilent: false,
  isPinned: false,
};
const pollMessageKey: AccountPollMessageKey = {
  accountId: ACCOUNT_ID,
  chat: { type: 'private', botId: BOT_ID },
  messageId: 3,
};

Deno.test('PollService reports why the account cannot read a poll message, before the poll', () => {
  const lookupResults: readonly AccountChatMessageLookupResult[] = [
    ...([
      'account_not_found',
      'bot_not_found',
      'chat_not_found',
      'not_a_member',
      'message_not_found',
    ] satisfies AccountChatMessageLookupFailureReason[]).map((reason) => ({
      found: false as const,
      reason,
    })),
    { found: true, message: textMessage, chat: conversation },
  ];

  const outcomes = lookupResults.map((lookupResult) => {
    const readKeys: unknown[] = [];
    const polls = new PollService({
      accountChatMessages: {
        findMessage: (key) => {
          readKeys.push(key);
          return lookupResult;
        },
      },
      polls: {
        getPoll: () => {
          throw new Error('Unexpected poll read');
        },
        setVoterAnswer: () => {
          throw new Error('Unexpected vote');
        },
        closePoll: () => {
          throw new Error('Unexpected poll closure');
        },
      },
      events: {
        publish: () => {
          throw new Error('Unexpected event');
        },
      },
    });
    const answer = polls.getAccountPollAnswer(pollMessageKey);
    const vote = polls.setAccountPollAnswer({ ...pollMessageKey, optionPositions: [0] });
    const stop = polls.stopAccountPoll(pollMessageKey);
    return [
      answer.found ? 'found' : answer.reason,
      vote.answered ? 'answered' : vote.reason,
      stop.stopped ? 'stopped' : stop.reason,
      readKeys.length,
    ];
  });

  const expected = [
    ...[
      'account_not_found',
      'bot_not_found',
      'chat_not_found',
      'not_a_member',
      'message_not_found',
    ].map((reason) => [reason, reason, reason, 3]),
    ['message_has_no_poll', 'message_has_no_poll', 'message_has_no_poll', 3],
  ];
  if (JSON.stringify(outcomes) !== JSON.stringify(expected)) {
    throw new Error(`Expected each lookup failure unchanged, received ${JSON.stringify(outcomes)}`);
  }
});
