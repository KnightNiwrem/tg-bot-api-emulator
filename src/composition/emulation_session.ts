import { runWebhookReply } from '../api/sessions/bot_api/webhook_reply.ts';
import type { EmulationSession, EmulationSessionOptions } from '../session/emulation_session.ts';
import { getPrivateForwardName } from '../types/virtual_account.ts';
import { AccountRepository } from '../repositories/account/account.ts';
import { BlockedUserRepository } from '../repositories/blocked_user/blocked_user.ts';
import { BotActivityLogRepository } from '../repositories/bot_activity_log/bot_activity_log.ts';
import { BotRepository } from '../repositories/bot/bot.ts';
import { BotCommandRepository } from '../repositories/bot_command/bot_command.ts';
import { BotDefaultAdministratorRightsRepository } from '../repositories/bot_default_administrator_rights/bot_default_administrator_rights.ts';
import { BotDescriptionRepository } from '../repositories/bot_description/bot_description.ts';
import { BotMenuButtonRepository } from '../repositories/bot_menu_button/bot_menu_button.ts';
import { BotUpdateRepository } from '../repositories/bot_update/bot_update.ts';
import { BotUpdateSubscriptionRepository } from '../repositories/bot_update_subscription/bot_update_subscription.ts';
import { BotWebhookRepository } from '../repositories/bot_webhook/bot_webhook.ts';
import { CallbackQueryRepository } from '../repositories/callback_query/callback_query.ts';
import { ChatActionRepository } from '../repositories/chat_action/chat_action.ts';
import { ChatInviteLinkRepository } from '../repositories/chat_invite_link/chat_invite_link.ts';
import { FileRepository } from '../repositories/file/file.ts';
import { InlineQueryRepository } from '../repositories/inline_query/inline_query.ts';
import { LastMessageSendingBotRepository } from '../repositories/last_message_sending_bot/last_message_sending_bot.ts';
import { MessageRepository } from '../repositories/message/message.ts';
import { MessageDraftRepository } from '../repositories/message_draft/message_draft.ts';
import { PollRepository } from '../repositories/poll/poll.ts';
import { PrivateConversationRepository } from '../repositories/private_conversation/private_conversation.ts';
import { QueuedBotApiAnswerRepository } from '../repositories/queued_bot_api_answer/queued_bot_api_answer.ts';
import { SharedChatRepository } from '../repositories/shared_chat/shared_chat.ts';
import { TelegramIdentityRepository } from '../repositories/telegram_identity/telegram_identity.ts';
import { WebResourceRepository } from '../repositories/web_resource/web_resource.ts';
import { MessageBoxRepository } from '../repositories/message_box/message_box.ts';
import { createAccountChatMessageReader } from '../services/domain/account_chat_message.ts';
import { BotActivityService } from '../services/bot_activity/bot_activity.ts';
import { BotApiService } from '../services/bot_api/bot_api.ts';
import { BotBlockingService } from '../services/domain/bot_blocking.ts';
import { BotCommandService } from '../services/domain/bot_command.ts';
import { BotDefaultAdministratorRightsService } from '../services/domain/bot_default_administrator_rights.ts';
import { BotDescriptionService } from '../services/domain/bot_description.ts';
import { BotMediaResolver } from '../services/bot_media_resolution/bot_media_resolution.ts';
import { BotMenuButtonService } from '../services/domain/bot_menu_button.ts';
import { BotMessageRepeater } from '../services/bot_message_repetition/bot_message_repetition.ts';
import { BotMessageSender } from '../services/bot_message_sending/bot_message_sending.ts';
import { BotMessageViewService } from '../services/bot_message_view/bot_message_view.ts';
import { BotRateLimitService } from '../services/domain/bot_rate_limit.ts';
import { BotServerErrorService } from '../services/domain/bot_server_error.ts';
import { BotUpdateDeliveryService } from '../services/update_delivery/bot_update_delivery.ts';
import { BotUpdateConsumerService } from '../services/update_consumers/bot_update_consumer.ts';
import { BotUpdatePollingService } from '../services/update_polling/bot_update_polling.ts';
import { CallbackQueryService } from '../services/domain/callback_query.ts';
import { ChatActionService } from '../services/domain/chat_action.ts';
import { ChatAdmissionService } from '../services/domain/chat_admission.ts';
import { InlineQueryService } from '../services/domain/inline_query.ts';
import { MediaFileService } from '../services/domain/media_file.ts';
import { normalizeBotDraftText, normalizeCaption } from '../services/domain/message_content.ts';
import { MessageCommitter } from '../services/domain/message_commit.ts';
import { MessageDeletionService } from '../services/domain/message_deletion.ts';
import { MessageDraftService } from '../services/domain/message_draft.ts';
import { MessageEditingService } from '../services/domain/message_editing.ts';
import { MessageForwardingService } from '../services/domain/message_forwarding.ts';
import { MessagePinningService } from '../services/domain/message_pinning.ts';
import { MessageReactionService } from '../services/domain/message_reaction.ts';
import { MessageSendingService } from '../services/domain/message_sending.ts';
import { PollService } from '../services/domain/poll.ts';
import { PrivateChatPolicy } from '../services/domain/private_chat_policy.ts';
import { PrivateMessagingService } from '../services/domain/private_messaging.ts';
import { ReplyInterfaceService } from '../services/domain/reply_interface.ts';
import { SessionLifetime } from '../services/session_lifetime/session_lifetime.ts';
import { createSessionUserMentionContext } from '../services/domain/session_user_mention.ts';
import { SharedChatAdministrationService } from '../services/domain/shared_chat_administration.ts';
import { SupergroupChatPolicy } from '../services/domain/supergroup_chat_policy.ts';
import { SupergroupMessagingService } from '../services/domain/supergroup_messaging.ts';
import { VirtualUserService } from '../services/domain/virtual_user.ts';
import {
  WEBHOOK_ATTEMPT_TIMEOUT_MILLISECONDS,
  WebhookAttemptScheduler,
} from '../services/webhook_delivery/webhook_attempt_scheduler.ts';
import {
  MAX_WEB_FILE_REDIRECTS,
  WEB_FILE_DOWNLOAD_TIMEOUT_MILLISECONDS,
  WebFileDownloader,
} from '../services/domain/web_file_download.ts';
import { WebResourceService } from '../services/domain/web_resource.ts';
import {
  WebhookDeliveryService,
  type WebhookTransport,
} from '../services/webhook_delivery/webhook_delivery.ts';
import type { SessionTiming } from '../timing/session/session_timing.ts';
import { SessionChangeJournal } from '../transactions/staging/change_staging.ts';
import { SessionTransactions } from '../transactions/session/session_transactions.ts';

/**
 * Composes one isolated session. Its services read calendar time and measure deadlines only
 * through the session's own `timing`, and reach its bots' webhooks only through
 * `webhookTransport`.
 */
export function createEmulationSession(
  id: string,
  { uploadProfile }: EmulationSessionOptions,
  { wallClock, scheduler }: SessionTiming,
  webhookTransport: WebhookTransport,
): EmulationSession {
  const sessionEnd = new AbortController();
  const lifetime = new SessionLifetime(sessionEnd.signal);
  // The repositories given the journal stage their writes in the session's transactions; the
  // others' writes are final at once.
  const journal = new SessionChangeJournal({
    reportNotificationFailure: (error) =>
      console.error('A consumer failed on being notified of a published change', error),
  });
  const identities = new TelegramIdentityRepository(journal);
  const accounts = new AccountRepository();
  const bots = new BotRepository();
  const virtualUsers = new VirtualUserService({ identities, accounts, bots });
  const getAccountPrivateForwardName = (userId: number) => {
    const account = accounts.getById(userId);
    return account === undefined ? undefined : getPrivateForwardName(account);
  };
  const sharedChats = new SharedChatRepository(journal);
  const messages = new MessageRepository(journal);
  const files = new FileRepository(journal);
  const polls = new PollRepository(journal);
  const messageBoxes = new MessageBoxRepository(journal);
  const botUpdates = new BotUpdateRepository(journal);
  const updateSubscriptions = new BotUpdateSubscriptionRepository(journal);
  const botMessageViews = new BotMessageViewService({
    accounts,
    bots,
    sharedChats,
    messageBoxes,
    messages,
    files,
    polls,
  });
  const botUpdateDelivery = new BotUpdateDeliveryService({
    botMessageViews,
    botUpdates,
    updateSubscriptions,
    bots,
    sharedChats,
    messages,
    lastMessageSendingBots: new LastMessageSendingBotRepository(journal),
  });
  const transactions = new SessionTransactions({
    journal,
    lifetime,
    projector: botUpdateDelivery,
  });
  const currentUnixTimeSeconds = () => wallClock.currentUnixTimeSeconds();
  const supergroupMessaging = new SupergroupMessagingService({
    accounts,
    bots,
    sharedChats,
    messages,
    messageBoxes,
  });
  const privateConversations = new PrivateConversationRepository(journal);
  const blockedUsers = new BlockedUserRepository(journal);
  const messageDrafts = new MessageDraftService({
    accounts,
    bots,
    drafts: new MessageDraftRepository(journal),
    transactions,
  });
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
  const sharedChatAdministration = new SharedChatAdministrationService({
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
    memberships: sharedChatAdministration,
    transactions,
    currentUnixTimeSeconds,
  });
  const privateMessaging = new PrivateMessagingService({
    accounts,
    bots,
    privateConversations,
    messages,
    messageBoxes,
    blockedUsers,
  });
  const messageReactions = new MessageReactionService({
    accounts,
    bots,
    sharedChats,
    supergroupMessages: supergroupMessaging,
    messages,
    transactions,
    currentUnixTimeSeconds,
  });
  const privateChats = new PrivateChatPolicy({
    accounts,
    bots,
    privateConversations,
    blockedUsers,
    joinRequesterContacts: chatAdmission,
    privateMessages: privateMessaging,
  });
  const supergroups = new SupergroupChatPolicy({
    sharedChats,
    supergroupMessages: supergroupMessaging,
  });
  const messageSending = new MessageSendingService({
    accounts,
    bots,
    privateChats,
    supergroups,
    privateConversations,
    joinRequesterContacts: chatAdmission,
    mediaGroups: messages,
    files,
    polls,
    commits: messageCommitter,
    transactions,
    currentUnixTimeSeconds,
  });
  const messagePinning = new MessagePinningService({
    accounts,
    bots,
    privateChats,
    supergroups,
    serviceMessages: messageCommitter,
    messages,
    transactions,
    currentUnixTimeSeconds,
  });
  const messageEditing = new MessageEditingService({
    accounts,
    bots,
    privateChats,
    supergroups,
    messages,
    files,
    polls,
    transactions,
    currentUnixTimeSeconds,
  });
  const messageDeletion = new MessageDeletionService({
    accounts,
    bots,
    privateChats,
    supergroups,
    messages,
    privateReplyInterfaces: privateConversations,
    transactions,
  });
  const replyInterfaces = new ReplyInterfaceService({
    accounts,
    privateChats,
    supergroups,
    messages,
    messageBoxes,
    privateReplyInterfaces: privateConversations,
    supergroupReplyInterfaces: sharedChats,
    messageSending,
    sharedPeers: { accounts, bots, sharedChats },
  });
  const accountChatMessages = createAccountChatMessageReader({
    accounts,
    privateChats,
    supergroups,
  });
  const messageForwarding = new MessageForwardingService({
    accountChatMessages,
    messageSending,
    getPrivateForwardName: getAccountPrivateForwardName,
  });
  const webResources = new WebResourceService({ webResources: new WebResourceRepository() });
  const mediaFiles = new MediaFileService({
    files,
    uploadProfile,
    webFiles: new WebFileDownloader({
      fetchWebResource: (request) => webResources.fetchWebResource(request),
      timeoutMilliseconds: WEB_FILE_DOWNLOAD_TIMEOUT_MILLISECONDS,
      maxRedirects: MAX_WEB_FILE_REDIRECTS,
      scheduler,
    }),
  });
  const botBlocking = new BotBlockingService({
    accounts,
    bots,
    blockedUsers,
    transactions,
    currentUnixTimeSeconds,
  });
  const callbackQueries = new CallbackQueryService({
    accountChatMessages,
    bots,
    callbackQueries: new CallbackQueryRepository(journal),
    transactions,
  });
  const pollService = new PollService({
    accountChatMessages,
    polls,
    transactions,
  });
  const inlineQueries = new InlineQueryService({
    accounts,
    bots,
    sharedChats,
    messageSending,
    inlineQueries: new InlineQueryRepository(journal),
    webMediaFiles: mediaFiles,
    transactions,
  });

  const chatActions = new ChatActionService({
    accounts,
    bots,
    sharedChats,
    chatActions: new ChatActionRepository(journal),
  });

  const botCommands = new BotCommandService({
    accounts,
    bots,
    privateConversations,
    supergroupMembers: sharedChats,
    botCommands: new BotCommandRepository(journal),
  });

  const botDescriptions = new BotDescriptionService({
    bots,
    botDescriptions: new BotDescriptionRepository(journal),
  });

  const botDefaultAdministratorRights = new BotDefaultAdministratorRightsService({
    bots,
    defaultAdministratorRights: new BotDefaultAdministratorRightsRepository(journal),
  });

  const botMenuButtons = new BotMenuButtonService({
    accounts,
    bots,
    menuButtons: new BotMenuButtonRepository(journal),
  });

  const botRateLimits = new BotRateLimitService({
    bots,
    rateLimitResponses: new QueuedBotApiAnswerRepository(journal),
  });

  const botServerErrors = new BotServerErrorService({
    bots,
    serverErrorResponses: new QueuedBotApiAnswerRepository(journal),
  });

  const botActivity = new BotActivityService({
    log: new BotActivityLogRepository(journal),
    scheduler,
  });
  const botUpdatePolling = new BotUpdatePollingService({
    botUpdates,
    updateActivity: botActivity,
    scheduler,
    sessionLifetime: lifetime,
    transactions,
  });
  const webhookAttempts = new WebhookAttemptScheduler({
    bots,
    attemptTimeoutMilliseconds: WEBHOOK_ATTEMPT_TIMEOUT_MILLISECONDS,
    scheduler,
  });
  const webhooks = new BotWebhookRepository(journal);
  const webhookDelivery = new WebhookDeliveryService({
    pendingUpdates: botUpdates,
    deliveryErrors: webhooks,
    updateActivity: botActivity,
    sendWebhookRequest: webhookTransport,
    startWebhookReply: (botId, reply) => {
      const bot = bots.getById(botId);
      if (bot === undefined) {
        return;
      }
      // Nobody receives the reply method's answer, so nothing awaits it; only the session's end
      // bounds it. A method that fails by throwing has no caller to report to either, so its
      // failure is observed and dropped, as a failing answer is.
      runWebhookReply({
        session,
        bot: bot.profile,
        signal: lifetime.endSignal,
        via: 'webhook_reply',
      }, reply).catch(() => {});
    },
    attempts: webhookAttempts,
    transactions,
    reportDeliveryChangeFailure: (error) =>
      console.error(
        'A webhook delivery failed to change the session, which it left as it was',
        error,
      ),
    currentUnixTimeSeconds,
  });
  const botUpdateConsumers = new BotUpdateConsumerService({
    webhooks,
    pendingUpdates: botUpdates,
    updateSubscriptions,
    polling: botUpdatePolling,
    webhookDelivery,
    sessionLifetime: lifetime,
    transactions,
  });
  const sessionTextFixingContext = createSessionUserMentionContext({ accounts, bots });
  const botMessageSender = new BotMessageSender({
    privateChatMessages: privateMessaging,
    supergroupMessages: supergroupMessaging,
    messageSending,
    botMessageViews,
    chatActions,
    getPrivateForwardName: getAccountPrivateForwardName,
  });
  const botMediaResolver = new BotMediaResolver({ mediaFiles });
  const botApi = new BotApiService({
    bots,
    botMessages: privateMessaging,
    supergroupBotMessages: supergroupMessaging,
    messageSender: botMessageSender,
    messageRepeater: new BotMessageRepeater({
      messageSender: botMessageSender,
      mediaGroups: messages,
      polls,
      getPrivateForwardName: getAccountPrivateForwardName,
      currentUnixTimeSeconds,
    }),
    botMedia: botMediaResolver,
    botCaptions: {
      normalizeBotCaption: (caption) => normalizeCaption(caption, 'bot', sessionTextFixingContext),
    },
    chatActions,
    messageDrafts,
    botDraftTexts: {
      normalizeBotDraftText: (text) => normalizeBotDraftText(text, sessionTextFixingContext),
    },
    publicChats: sharedChatAdministration,
    currentUnixTimeSeconds,
  });

  const session: EmulationSession = {
    id,
    uploadProfile,
    virtualUsers,
    sharedChatAdministration,
    chatAdmission,
    privateMessaging,
    supergroupMessaging,
    messageEditing,
    messageDeletion,
    messageForwarding,
    messageSending,
    messagePinning,
    messageReactions,
    replyInterfaces,
    botBlocking,
    callbackQueries,
    polls: pollService,
    inlineQueries,
    botCommands,
    botDescriptions,
    botDefaultAdministratorRights,
    botMenuButtons,
    chatActions,
    messageDrafts,
    botMessageViews,
    mediaFiles,
    webResources,
    botRateLimits,
    botServerErrors,
    botApi,
    botMediaResolver,
    botUpdateConsumers,
    botActivity,
    webhookAttempts,
    lifetime,
    transactions,
    end: () => {
      // The commit gate closes first, so that nothing the rest of the teardown wakes can commit.
      // Long polls and webhook deliveries follow the session's end themselves.
      sessionEnd.abort(new DOMException('The session ended', 'AbortError'));
      botActivity.endReading();
    },
  };
  return session;
}
