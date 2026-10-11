/**
 * The services that send and commit messages, built over the repositories and chat policies of a
 * test that wires its own services instead of a whole session.
 */
import { MessageCommitter } from '../../src/services/message_commit.ts';
import { MessageSendingService } from '../../src/services/message_sending.ts';

type CommitterDependencies = ConstructorParameters<typeof MessageCommitter>[0];
type SendingDependencies = ConstructorParameters<typeof MessageSendingService>[0];

/** What the services read and write, as the test's own repositories and policies hold it. */
export interface MessageSendingServiceSources {
  readonly accounts: CommitterDependencies['accounts'] & SendingDependencies['accounts'];
  readonly bots: CommitterDependencies['bots'] & SendingDependencies['bots'];
  readonly privateChats: SendingDependencies['privateChats'];
  readonly supergroups: SendingDependencies['supergroups'];
  readonly privateConversations:
    & SendingDependencies['privateConversations']
    & CommitterDependencies['privateReplyInterfaces'];
  readonly sharedChats: CommitterDependencies['supergroupMembers'];
  readonly messages: CommitterDependencies['messages'] & SendingDependencies['mediaGroups'];
  readonly files: SendingDependencies['files'];
  readonly polls: SendingDependencies['polls'];
  readonly messageBoxes: CommitterDependencies['messageBoxes'];
  /** The transactions each send and commit runs in, and that receives their events. */
  readonly transactions:
    & CommitterDependencies['transactions']
    & SendingDependencies['transactions'];
  /** Omitted where no join request lets a bot write to an account that never started the chat. */
  readonly joinRequesterContacts?: SendingDependencies['joinRequesterContacts'];
  /** Omitted where no bot shows a message draft, which a bot's message would remove. */
  readonly messageDrafts?: CommitterDependencies['messageDrafts'];
  readonly currentUnixTimeSeconds: () => number;
}

export function createMessageSendingServices(
  {
    accounts,
    bots,
    privateChats,
    supergroups,
    privateConversations,
    sharedChats,
    messages,
    files,
    polls,
    messageBoxes,
    transactions,
    joinRequesterContacts = {
      claimJoinRequesterContact: () => {
        throw new Error('No join request lets a bot contact an account in this test');
      },
    },
    messageDrafts = { clearBotDraft: () => {} },
    currentUnixTimeSeconds,
  }: MessageSendingServiceSources,
): { readonly messageCommitter: MessageCommitter; readonly messageSending: MessageSendingService } {
  const messageCommitter = new MessageCommitter({
    accounts,
    bots,
    messages,
    messageBoxes,
    privateReplyInterfaces: privateConversations,
    supergroupMembers: sharedChats,
    transactions,
    messageDrafts,
    currentUnixTimeSeconds,
  });
  const messageSending = new MessageSendingService({
    accounts,
    bots,
    privateChats,
    supergroups,
    privateConversations,
    joinRequesterContacts,
    mediaGroups: messages,
    files,
    polls,
    commits: messageCommitter,
    transactions,
    currentUnixTimeSeconds,
  });
  return { messageCommitter, messageSending };
}
