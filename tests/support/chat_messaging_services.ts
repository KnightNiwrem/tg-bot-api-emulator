/**
 * The messaging services of both chat types, wired over fresh repositories as the composition root
 * wires them, for unit tests that observe what a root-backed session keeps private: the domain
 * events each command publishes, the uploads it stores, and the repositories themselves.
 *
 * The repositories are not staged, so each command runs as it is called, and publishes its events
 * as it emits them. Tests that need the session's transactions, views or updates build a session
 * through `buildSessionServices()` instead.
 */
import { AccountRepository } from '../../src/repositories/account.ts';
import { BlockedUserRepository } from '../../src/repositories/blocked_user.ts';
import { BotRepository } from '../../src/repositories/bot.ts';
import { FileRepository } from '../../src/repositories/file.ts';
import { MessageRepository } from '../../src/repositories/message.ts';
import { MessageBoxRepository } from '../../src/repositories/message_box.ts';
import { PollRepository } from '../../src/repositories/poll.ts';
import { PrivateConversationRepository } from '../../src/repositories/private_conversation.ts';
import { SharedChatRepository } from '../../src/repositories/shared_chat.ts';
import { TelegramIdentityRepository } from '../../src/repositories/telegram_identity.ts';
import { MessageDeletionService } from '../../src/services/message_deletion.ts';
import { MessageEditingService } from '../../src/services/message_editing.ts';
import { PrivateChatPolicy } from '../../src/services/private_chat_policy.ts';
import { PrivateMessagingService } from '../../src/services/private_messaging.ts';
import { ReplyInterfaceService } from '../../src/services/reply_interface.ts';
import { SharedChatAdministrationService } from '../../src/services/shared_chat_administration.ts';
import { SupergroupChatPolicy } from '../../src/services/supergroup_chat_policy.ts';
import { SupergroupMessagingService } from '../../src/services/supergroup_messaging.ts';
import { VirtualUserService } from '../../src/services/virtual_user.ts';
import type { ChatDomainEvent } from '../../src/types/chat_domain_event.ts';
import type { FileUpload } from '../../src/types/stored_file.ts';
import { TEST_UNIX_TIME_SECONDS } from './fixed_wall_clock.ts';
import { createMessageSendingServices } from './message_sending_services.ts';

/** Which bots a pending join request lets write to an account that never started their chat. */
export interface JoinRequesterContacts {
  mayContactJoinRequester(botId: number, accountId: number): boolean;
  claimJoinRequesterContact(botId: number, accountId: number): void;
}

/** What a test chooses about the services' surroundings; each is omitted where it plays no part. */
export interface ChatMessagingServicesOptions {
  /** Lets no bot contact an account through a join request when omitted. */
  readonly joinRequesterContacts?: JoinRequesterContacts;
  /** The calendar time messages are dated by; fixed at `TEST_UNIX_TIME_SECONDS` when omitted. */
  readonly currentUnixTimeSeconds?: () => number;
  /**
   * Builds, over the services' repositories, what observes each published event after it is
   * recorded in `publishedEvents`, as the session's bot update delivery projects them.
   */
  readonly createEventObserver?: (
    repositories: ChatMessagingRepositories,
  ) => (event: ChatDomainEvent) => void;
}

/** The repositories the messaging services read and write. */
export interface ChatMessagingRepositories {
  readonly identities: TelegramIdentityRepository;
  readonly accounts: AccountRepository;
  readonly bots: BotRepository;
  readonly privateConversations: PrivateConversationRepository;
  readonly blockedUsers: BlockedUserRepository;
  readonly sharedChats: SharedChatRepository;
  readonly messages: MessageRepository;
  readonly files: FileRepository;
  readonly polls: PollRepository;
  readonly messageBoxes: MessageBoxRepository;
}

const NO_JOIN_REQUESTER_CONTACTS: JoinRequesterContacts = {
  mayContactJoinRequester: () => false,
  claimJoinRequesterContact: () => {
    throw new Error('No join request lets a bot contact an account in this test');
  },
};

/** Builds the messaging services of both chat types over fresh repositories. */
export function createChatMessagingServices(
  {
    joinRequesterContacts = NO_JOIN_REQUESTER_CONTACTS,
    currentUnixTimeSeconds = () => TEST_UNIX_TIME_SECONDS,
    createEventObserver = () => () => {},
  }: ChatMessagingServicesOptions = {},
) {
  const repositories: ChatMessagingRepositories = {
    identities: new TelegramIdentityRepository(),
    accounts: new AccountRepository(),
    bots: new BotRepository(),
    privateConversations: new PrivateConversationRepository(),
    blockedUsers: new BlockedUserRepository(),
    sharedChats: new SharedChatRepository(),
    messages: new MessageRepository(),
    files: new FileRepository(),
    polls: new PollRepository(),
    messageBoxes: new MessageBoxRepository(),
  };
  const {
    identities,
    accounts,
    bots,
    privateConversations,
    blockedUsers,
    sharedChats,
    messages,
    files,
    polls,
    messageBoxes,
  } = repositories;
  const virtualUsers = new VirtualUserService({ identities, accounts, bots });

  const publishedEvents: ChatDomainEvent[] = [];
  const observeEvent = createEventObserver(repositories);
  const events = {
    emit: (event: ChatDomainEvent) => {
      publishedEvents.push(event);
      observeEvent(event);
    },
  };
  const storedUploads: FileUpload[] = [];
  const uploadRecordingFiles = {
    addFile: (upload: FileUpload) => {
      storedUploads.push(upload);
      return files.addFile(upload);
    },
  };

  const privateMessaging = new PrivateMessagingService({
    accounts,
    bots,
    privateConversations,
    messages,
    messageBoxes,
    blockedUsers,
  });
  const supergroupMessaging = new SupergroupMessagingService({
    accounts,
    bots,
    sharedChats,
    messages,
    messageBoxes,
  });
  const privateChats = new PrivateChatPolicy({
    accounts,
    bots,
    privateConversations,
    blockedUsers,
    joinRequesterContacts,
    privateMessages: privateMessaging,
  });
  const supergroups = new SupergroupChatPolicy({
    sharedChats,
    supergroupMessages: supergroupMessaging,
  });
  const immediateTransactions = {
    ...events,
    withinTransaction: <Result>(command: () => Result) => command(),
  };
  const { messageCommitter, messageSending } = createMessageSendingServices({
    accounts,
    bots,
    privateChats,
    supergroups,
    privateConversations,
    sharedChats,
    messages,
    files: uploadRecordingFiles,
    polls,
    messageBoxes,
    transactions: immediateTransactions,
    joinRequesterContacts,
    currentUnixTimeSeconds,
  });

  return {
    ...repositories,
    virtualUsers,
    /** Every event the services published, in order. */
    publishedEvents,
    /** Every upload the services stored, in order. */
    storedUploads,
    privateMessaging,
    supergroupMessaging,
    privateChats,
    supergroups,
    messageCommitter,
    messageSending,
    messageEditing: new MessageEditingService({
      accounts,
      bots,
      privateChats,
      supergroups,
      messages,
      files: uploadRecordingFiles,
      polls,
      transactions: immediateTransactions,
      currentUnixTimeSeconds,
    }),
    messageDeletion: new MessageDeletionService({
      accounts,
      bots,
      privateChats,
      supergroups,
      messages,
      privateReplyInterfaces: privateConversations,
      transactions: immediateTransactions,
    }),
    replyInterfaces: new ReplyInterfaceService({
      accounts,
      privateChats,
      supergroups,
      messages,
      messageBoxes,
      privateReplyInterfaces: privateConversations,
      supergroupReplyInterfaces: sharedChats,
      messageSending,
      sharedPeers: { accounts, bots, sharedChats },
    }),
    sharedChatAdministration: new SharedChatAdministrationService({
      identities,
      accounts,
      bots,
      sharedChats,
      serviceMessages: messageCommitter,
      transactions: immediateTransactions,
      currentUnixTimeSeconds,
    }),
  };
}
