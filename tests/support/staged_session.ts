/**
 * A session's messaging and chat admission composed over repositories staged in one journal, with
 * explicit seams for what the full composition hides: a view that fails for a chosen observer, the
 * journal that consumers register with, and the session's end.
 */
import { AccountRepository } from '../../src/repositories/account.ts';
import { BlockedUserRepository } from '../../src/repositories/blocked_user.ts';
import { BotRepository } from '../../src/repositories/bot.ts';
import { BotActivityLogRepository } from '../../src/repositories/bot_activity_log.ts';
import { BotUpdateRepository } from '../../src/repositories/bot_update.ts';
import { BotUpdateSubscriptionRepository } from '../../src/repositories/bot_update_subscription.ts';
import { ChatInviteLinkRepository } from '../../src/repositories/chat_invite_link.ts';
import { FileRepository } from '../../src/repositories/file.ts';
import { LastMessageSendingBotRepository } from '../../src/repositories/last_message_sending_bot.ts';
import { MessageRepository } from '../../src/repositories/message.ts';
import { MessageBoxRepository } from '../../src/repositories/message_box.ts';
import { PollRepository } from '../../src/repositories/poll.ts';
import { PrivateConversationRepository } from '../../src/repositories/private_conversation.ts';
import { SharedChatRepository } from '../../src/repositories/shared_chat.ts';
import { TelegramIdentityRepository } from '../../src/repositories/telegram_identity.ts';
import { BotMessageViewService } from '../../src/services/bot_message_view.ts';
import { BotUpdateDeliveryService } from '../../src/services/bot_update_delivery.ts';
import { ChatAdmissionService } from '../../src/services/chat_admission.ts';
import { PrivateChatPolicy } from '../../src/services/private_chat_policy.ts';
import { SessionLifetime } from '../../src/services/session_lifetime.ts';
import { SharedChatAdministrationService } from '../../src/services/shared_chat_administration.ts';
import { SupergroupChatPolicy } from '../../src/services/supergroup_chat_policy.ts';
import { SupergroupMessagingService } from '../../src/services/supergroup_messaging.ts';
import { VirtualUserService } from '../../src/services/virtual_user.ts';
import { SessionChangeJournal } from '../../src/transactions/change_staging.ts';
import { SessionTransactions } from '../../src/transactions/session_transactions.ts';
import type { BotApiChatMemberUpdated, BotApiSupergroupMessage } from '../../src/types/bot_api.ts';
import type { ChatMemberStatusChangedEvent } from '../../src/types/chat_domain_event.ts';
import type { PhotoUpload } from '../../src/types/stored_file.ts';
import type { SupergroupMessage } from '../../src/types/virtual_message.ts';
import { createMessageSendingServices } from './message_sending_services.ts';

/** The error a failing view throws. */
export const FAILED_VIEW_MESSAGE = 'The view failed';

/**
 * Views supergroup messages and members' changes as the session does, failing for one observer
 * when told to.
 */
class FailingBotMessageViews extends BotMessageViewService {
  /** The observer whose views fail; none while `undefined`. */
  failingObserverId: number | undefined;
  /** Which of the failing observer's message views fails, counted from 1. */
  failingMessageViewNumber = 1;
  /** The message views that succeeded, in order. */
  readonly messageViewsSeen: BotApiSupergroupMessage[] = [];
  #failingObserverMessageViewCount = 0;

  override viewSupergroupMessage(
    message: SupergroupMessage,
    observerId: number,
  ): BotApiSupergroupMessage {
    if (observerId === this.failingObserverId) {
      this.#failingObserverMessageViewCount += 1;
      if (this.#failingObserverMessageViewCount === this.failingMessageViewNumber) {
        throw new Error(FAILED_VIEW_MESSAGE);
      }
    }
    const view = super.viewSupergroupMessage(message, observerId);
    this.messageViewsSeen.push(view);
    return view;
  }

  override viewChatMemberChange(
    event: ChatMemberStatusChangedEvent,
    observerBotId: number,
  ): BotApiChatMemberUpdated {
    if (observerBotId === this.failingObserverId) {
      throw new Error(FAILED_VIEW_MESSAGE);
    }
    return super.viewChatMemberChange(event, observerBotId);
  }
}

/**
 * A supergroup of Ada's with two bots, Alpha and Beta, in privacy mode or not, over repositories
 * staged in one session's transactions.
 */
export function createStagedSessionFixture({ privacyMode }: { readonly privacyMode: boolean }) {
  const notificationFailures: unknown[] = [];
  const journal = new SessionChangeJournal({
    reportNotificationFailure: (error) =>
      notificationFailures.push(error instanceof Error ? error.message : error),
  });
  const sessionEnd = new AbortController();
  const identities = new TelegramIdentityRepository(journal);
  const accounts = new AccountRepository();
  const bots = new BotRepository();
  const virtualUsers = new VirtualUserService({ identities, accounts, bots });
  const sharedChats = new SharedChatRepository(journal);
  const messages = new MessageRepository(journal);
  const files = new FileRepository(journal);
  const polls = new PollRepository(journal);
  const messageBoxes = new MessageBoxRepository(journal);
  const botUpdates = new BotUpdateRepository(journal);
  const updateSubscriptions = new BotUpdateSubscriptionRepository();
  const lastMessageSendingBots = new LastMessageSendingBotRepository(journal);
  const activityLog = new BotActivityLogRepository(journal);
  const views = new FailingBotMessageViews({
    accounts,
    bots,
    sharedChats,
    messageBoxes,
    messages,
    files,
    polls,
  });
  const transactions = new SessionTransactions({
    journal,
    lifetime: new SessionLifetime(sessionEnd.signal),
    projector: new BotUpdateDeliveryService({
      botMessageViews: views,
      botUpdates,
      updateSubscriptions,
      bots,
      sharedChats,
      messages,
      lastMessageSendingBots,
    }),
  });
  const currentUnixTimeSeconds = () => 1_700_000_000;
  const supergroupMessaging = new SupergroupMessagingService({
    accounts,
    bots,
    sharedChats,
    messages,
    messageBoxes,
  });
  const privateConversations = new PrivateConversationRepository(journal);
  const { messageCommitter, messageSending } = createMessageSendingServices({
    accounts,
    bots,
    // These sessions send no private messages, so none is found.
    privateChats: new PrivateChatPolicy({
      accounts,
      bots,
      privateConversations,
      blockedUsers: new BlockedUserRepository(),
      joinRequesterContacts: { mayContactJoinRequester: () => false },
      privateMessages: { getPrivateMessageByBotMessageId: () => undefined },
    }),
    supergroups: new SupergroupChatPolicy({ sharedChats, supergroupMessages: supergroupMessaging }),
    privateConversations,
    sharedChats,
    messages,
    files,
    polls,
    messageBoxes,
    events: transactions,
    currentUnixTimeSeconds,
  });
  const administration = new SharedChatAdministrationService({
    identities,
    accounts,
    bots,
    sharedChats,
    serviceMessages: messageCommitter,
    transactions,
    currentUnixTimeSeconds,
  });
  const chatAdmission = new ChatAdmissionService({
    accounts,
    bots,
    sharedChats,
    inviteLinks: new ChatInviteLinkRepository(journal),
    memberships: administration,
    transactions,
    currentUnixTimeSeconds,
  });

  const createAccount = (firstName: string) => {
    const creation = virtualUsers.createAccount({ first_name: firstName });
    if (!creation.created) {
      throw new Error(`Expected ${firstName} to be created: ${creation.reason}`);
    }
    return creation.account.profile.id;
  };
  const adaId = createAccount('Ada');
  const [alpha, beta] = ['alpha_bot', 'beta_bot'].map((username) => {
    const creation = virtualUsers.createBot({
      first_name: username,
      username,
      can_read_all_group_messages: !privacyMode,
    });
    if (!creation.created) {
      throw new Error(`Expected ${username} to be created: ${creation.reason}`);
    }
    return creation.bot.profile.id;
  });
  const creation = administration.createSupergroup({ title: 'Team', creatorAccountId: adaId });
  if (!creation.created) {
    throw new Error(`Expected the supergroup to be created: ${creation.reason}`);
  }
  const chatId = creation.supergroup.id;
  for (const botId of [alpha, beta]) {
    administration.addChatMember({ actorAccountId: adaId, chatId, memberId: botId });
  }
  /** Forgets the updates and views so far, which a test is not about. */
  const discardUpdatesSoFar = () => {
    for (const botId of [alpha, beta]) {
      botUpdates.discardPendingUpdates(botId);
    }
    views.messageViewsSeen.splice(0);
  };
  discardUpdatesSoFar();

  const expectSent = (result: { readonly sent: boolean }) => {
    if (!result.sent) {
      throw new Error(`Expected the message to be sent: ${JSON.stringify(result)}`);
    }
  };
  return {
    journal,
    transactions,
    views,
    files,
    polls,
    botUpdates,
    updateSubscriptions,
    administration,
    chatAdmission,
    notificationFailures,
    chatId,
    adaId,
    alpha,
    beta,
    createAccount,
    discardUpdatesSoFar,
    endSession: () => sessionEnd.abort(),
    sendAccountText: (text: string) =>
      expectSent(
        messageSending.sendAccountSupergroupMessage({
          fromAccountId: adaId,
          chat: { type: 'supergroup', chatId },
          content: { kind: 'text', text },
        }),
      ),
    sendAccountPhoto: (caption: string) =>
      expectSent(
        messageSending.sendAccountSupergroupMessage({
          fromAccountId: adaId,
          chat: { type: 'supergroup', chatId },
          content: { kind: 'media', upload: photoUpload(), caption },
        }),
      ),
    sendAccountAlbum: (captions: readonly string[]) =>
      expectSent(
        messageSending.sendAccountSupergroupAlbum({
          fromAccountId: adaId,
          chat: { type: 'supergroup', chatId },
          contents: captions.map((caption) => ({ kind: 'media', upload: photoUpload(), caption })),
        }),
      ),
    sendBotText: (botId: number, text: string) =>
      expectSent(
        messageSending.sendSupergroupMessage({
          fromBotId: botId,
          chat: { type: 'supergroup', chatId },
          content: { kind: 'text', text },
        }),
      ),
    recordActivity: (botId: number) =>
      activityLog.append({
        kind: 'bot_api_call',
        botId,
        method: 'sendMessage',
        requestedMethod: 'sendMessage',
        via: 'http',
        parameters: {},
        uploadedFiles: [],
        answer: { ok: true, result: true },
      }),
    /** What the staged repositories hold, as readers outside a command see it. */
    readState: (pollId?: string) => {
      const chatMessages = messages.getChatMessages({ type: 'supergroup', chatId });
      return {
        messageCount: chatMessages.length,
        numbering: chatMessages.map((message) => messageBoxes.getMessageId(chatId, message.id)),
        memberIds: sharedChats.getChatMemberIds(chatId),
        joinRequesterIds: sharedChats.listJoinRequests(chatId).map((request) => request.userId),
        updates: [alpha, beta].map((botId) => ({
          pending: botUpdates.readPendingUpdates(botId).length,
          nextUpdateId: botUpdates.getNextUpdateId(botId),
        })),
        lastMessageSendingBotId: lastMessageSendingBots.getLastMessageSendingBotId(chatId) ?? null,
        activityHead: activityLog.getHeadPosition(),
        pollAnswers: pollId === undefined
          ? null
          : [...(polls.getPoll(pollId)?.answersByVoterId ?? new Map())],
      };
    },
  };
}

function photoUpload(): PhotoUpload {
  const content = new Uint8Array(13);
  content.set(new TextEncoder().encode('GIF89a'));
  content.set([4, 0, 3, 0], 6);
  return { type: 'photo', content, imageFormat: 'gif', width: 4, height: 3 };
}
