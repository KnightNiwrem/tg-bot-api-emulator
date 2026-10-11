/**
 * A session's messaging and chat admission composed over repositories staged in one journal, with
 * explicit seams for what the full composition hides: a view that fails for a chosen observer, the
 * journal that consumers register with, and the session's end.
 */
import { BotActivityLogRepository } from '../../src/repositories/bot_activity_log.ts';
import { BotUpdateRepository } from '../../src/repositories/bot_update.ts';
import { BotUpdateSubscriptionRepository } from '../../src/repositories/bot_update_subscription.ts';
import { ChatInviteLinkRepository } from '../../src/repositories/chat_invite_link.ts';
import { LastMessageSendingBotRepository } from '../../src/repositories/last_message_sending_bot.ts';
import { BotMessageViewService } from '../../src/services/bot_message_view/bot_message_view.ts';
import { BotUpdateDeliveryService } from '../../src/services/update_delivery/bot_update_delivery.ts';
import { ChatAdmissionService } from '../../src/services/domain/chat_admission.ts';
import { SessionLifetime } from '../../src/services/session_lifetime/session_lifetime.ts';
import { SessionChangeJournal } from '../../src/transactions/staging/change_staging.ts';
import { SessionTransactions } from '../../src/transactions/session/session_transactions.ts';
import type { BotApiChatMemberUpdated, BotApiSupergroupMessage } from '../../src/types/bot_api.ts';
import type { ChatMemberStatusChangedEvent } from '../../src/types/chat_domain_event.ts';
import type { PhotoUpload } from '../../src/types/stored_file.ts';
import type { SupergroupMessage } from '../../src/types/virtual_message.ts';
import {
  createChatMessagingRepositories,
  createChatMessagingServices,
} from './chat_messaging_services.ts';
import { TEST_UNIX_TIME_SECONDS } from './fixed_wall_clock.ts';

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
  const repositories = createChatMessagingRepositories(journal);
  const { accounts, bots, sharedChats, messages, files, polls, messageBoxes } = repositories;
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
  const {
    virtualUsers,
    messageSending,
    sharedChatAdministration: administration,
  } = createChatMessagingServices({ repositories, transactions });
  const chatAdmission = new ChatAdmissionService({
    accounts,
    bots,
    sharedChats,
    inviteLinks: new ChatInviteLinkRepository(journal),
    memberships: administration,
    transactions,
    currentUnixTimeSeconds: () => TEST_UNIX_TIME_SECONDS,
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
    messageSending,
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
