/**
 * The messaging services of both chat types, wired over their repositories as the composition root
 * wires them, for unit tests that observe what a root-backed session keeps private: the domain
 * events each command publishes, the uploads it stores, and the repositories themselves.
 *
 * By default the repositories are fresh and unstaged, so each command runs as it is called and
 * publishes its events as it emits them. A test that needs staging gives the repositories and the
 * transactions it composed itself. Tests that need the whole session build it through
 * `buildSessionServices()` instead.
 */
import { AccountRepository } from '../../src/repositories/account/account.ts';
import { BlockedUserRepository } from '../../src/repositories/blocked_user/blocked_user.ts';
import { BotRepository } from '../../src/repositories/bot/bot.ts';
import { FileRepository } from '../../src/repositories/file/file.ts';
import { MessageRepository } from '../../src/repositories/message/message.ts';
import { MessageBoxRepository } from '../../src/repositories/message_box/message_box.ts';
import { PollRepository } from '../../src/repositories/poll/poll.ts';
import { PrivateConversationRepository } from '../../src/repositories/private_conversation/private_conversation.ts';
import { SharedChatRepository } from '../../src/repositories/shared_chat/shared_chat.ts';
import { TelegramIdentityRepository } from '../../src/repositories/telegram_identity/telegram_identity.ts';
import { createAccountChatMessageReader } from '../../src/services/domain/account_chat_message.ts';
import { MessageCommitter } from '../../src/services/domain/message_commit.ts';
import { MessageDeletionService } from '../../src/services/domain/message_deletion.ts';
import { MessageEditingService } from '../../src/services/domain/message_editing.ts';
import { MessageSendingService } from '../../src/services/domain/message_sending.ts';
import { PrivateChatPolicy } from '../../src/services/domain/private_chat_policy.ts';
import { PrivateMessagingService } from '../../src/services/domain/private_messaging.ts';
import { ReplyInterfaceService } from '../../src/services/domain/reply_interface.ts';
import { SharedChatAdministrationService } from '../../src/services/domain/shared_chat_administration.ts';
import { SupergroupChatPolicy } from '../../src/services/domain/supergroup_chat_policy.ts';
import { SupergroupMessagingService } from '../../src/services/domain/supergroup_messaging.ts';
import { VirtualUserService } from '../../src/services/domain/virtual_user.ts';
import type { ChangeStaging } from '../../src/transactions/staging/change_staging.ts';
import type { ChatDomainEvent } from '../../src/types/chat_domain_event.ts';
import type { FileUpload } from '../../src/types/stored_file.ts';
import { TEST_UNIX_TIME_SECONDS } from './fixed_wall_clock.ts';

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
  /** The repositories the services read and write; fresh unstaged ones when omitted. */
  readonly repositories?: ChatMessagingRepositories;
  /**
   * The transactions the services run their commands in, and which receive their events; when
   * omitted, each command runs as it is called and its events go nowhere else.
   */
  readonly transactions?: ChatMessagingTransactions;
}

/** Runs the services' commands, and receives the events they publish. */
export interface ChatMessagingTransactions {
  withinTransaction<Result>(command: () => Result): Result;
  emit(event: ChatDomainEvent): void;
}

/** Commands that run as they are called, outside any transaction, publishing to no one. */
const IMMEDIATE_TRANSACTIONS: ChatMessagingTransactions = {
  withinTransaction: (command) => command(),
  emit: () => {},
};

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

/**
 * Creates fresh repositories for the messaging services. Those the composition root stages are
 * staged in `staging` when it is given, and unstaged otherwise.
 */
export function createChatMessagingRepositories(
  staging?: ChangeStaging,
): ChatMessagingRepositories {
  return {
    identities: new TelegramIdentityRepository(staging),
    accounts: new AccountRepository(),
    bots: new BotRepository(),
    privateConversations: new PrivateConversationRepository(staging),
    blockedUsers: new BlockedUserRepository(staging),
    sharedChats: new SharedChatRepository(staging),
    messages: new MessageRepository(staging),
    files: new FileRepository(staging),
    polls: new PollRepository(staging),
    messageBoxes: new MessageBoxRepository(staging),
  };
}

/** Builds the messaging services of both chat types over their repositories. */
export function createChatMessagingServices(
  {
    joinRequesterContacts = NO_JOIN_REQUESTER_CONTACTS,
    currentUnixTimeSeconds = () => TEST_UNIX_TIME_SECONDS,
    createEventObserver = () => () => {},
    repositories = createChatMessagingRepositories(),
    transactions: givenTransactions = IMMEDIATE_TRANSACTIONS,
  }: ChatMessagingServicesOptions = {},
) {
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
  const transactions: ChatMessagingTransactions = {
    withinTransaction: (command) => givenTransactions.withinTransaction(command),
    emit: (event) => {
      publishedEvents.push(event);
      observeEvent(event);
      givenTransactions.emit(event);
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
  const messageCommitter = new MessageCommitter({
    accounts,
    bots,
    messages,
    messageBoxes,
    privateReplyInterfaces: privateConversations,
    supergroupMembers: sharedChats,
    transactions,
    // No bot shows a message draft here, which a bot's message would otherwise remove.
    messageDrafts: { clearBotDraft: () => {} },
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
    files: uploadRecordingFiles,
    polls,
    commits: messageCommitter,
    transactions,
    currentUnixTimeSeconds,
  });

  return {
    ...repositories,
    virtualUsers,
    /** Every event the services published, in order. */
    publishedEvents,
    /** Every upload the services stored, in order. */
    storedUploads,
    /**
     * The transactions the services run their commands in, which record each event in
     * `publishedEvents`. Services a test builds over the same repositories take them too.
     */
    transactions,
    /** Reads the messages of either chat type that an account addresses by its chat's IDs. */
    accountChatMessages: createAccountChatMessageReader({ accounts, privateChats, supergroups }),
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
      transactions: transactions,
      currentUnixTimeSeconds,
    }),
    messageDeletion: new MessageDeletionService({
      accounts,
      bots,
      privateChats,
      supergroups,
      messages,
      privateReplyInterfaces: privateConversations,
      transactions: transactions,
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
      transactions: transactions,
      currentUnixTimeSeconds,
    }),
  };
}
