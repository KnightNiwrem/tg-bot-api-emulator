import { runWebhookReply } from '../api/sessions/bot_api/webhook_reply.ts';
import type { EmulationSession, EmulationSessionOptions } from '../types/emulation_session.ts';
import { getPrivateForwardName } from '../types/virtual_account.ts';
import { AccountRepository } from '../repositories/account.ts';
import { BlockedUserRepository } from '../repositories/blocked_user.ts';
import { BotActivityLogRepository } from '../repositories/bot_activity_log.ts';
import { BotRepository } from '../repositories/bot.ts';
import { BotCommandRepository } from '../repositories/bot_command.ts';
import { BotDefaultAdministratorRightsRepository } from '../repositories/bot_default_administrator_rights.ts';
import { BotDescriptionRepository } from '../repositories/bot_description.ts';
import { BotMenuButtonRepository } from '../repositories/bot_menu_button.ts';
import { BotRateLimitRepository } from '../repositories/bot_rate_limit.ts';
import { BotUpdateRepository } from '../repositories/bot_update.ts';
import { BotUpdateSubscriptionRepository } from '../repositories/bot_update_subscription.ts';
import { BotWebhookRepository } from '../repositories/bot_webhook.ts';
import { CallbackQueryRepository } from '../repositories/callback_query.ts';
import { ChatActionRepository } from '../repositories/chat_action.ts';
import { FileRepository } from '../repositories/file.ts';
import { InlineQueryRepository } from '../repositories/inline_query.ts';
import { MessageRepository } from '../repositories/message.ts';
import { PollRepository } from '../repositories/poll.ts';
import { PrivateConversationRepository } from '../repositories/private_conversation.ts';
import { SharedChatRepository } from '../repositories/shared_chat.ts';
import { TelegramIdentityRepository } from '../repositories/telegram_identity.ts';
import { WebResourceRepository } from '../repositories/web_resource.ts';
import { MessageBoxRepository } from '../repositories/message_box.ts';
import { BotActivityService } from '../services/bot_activity.ts';
import { BotApiService } from '../services/bot_api.ts';
import { BotBlockingService } from '../services/bot_blocking.ts';
import { BotCommandService } from '../services/bot_command.ts';
import { BotDefaultAdministratorRightsService } from '../services/bot_default_administrator_rights.ts';
import { BotDescriptionService } from '../services/bot_description.ts';
import { BotMenuButtonService } from '../services/bot_menu_button.ts';
import { BotMessageViewService } from '../services/bot_message_view.ts';
import { BotRateLimitService } from '../services/bot_rate_limit.ts';
import { BotUpdateDeliveryService } from '../services/bot_update_delivery.ts';
import { BotUpdatePollingService } from '../services/bot_update_polling.ts';
import {
  BotWebhookService,
  waitForRetryDelay,
  WEBHOOK_ATTEMPT_TIMEOUT_MILLISECONDS,
} from '../services/bot_webhook.ts';
import { CallbackQueryService } from '../services/callback_query.ts';
import { ChatActionService } from '../services/chat_action.ts';
import { InlineQueryService } from '../services/inline_query.ts';
import { MediaFileService } from '../services/media_file.ts';
import { normalizeCaption } from '../services/message_content.ts';
import { MessageForwardingService } from '../services/message_forwarding.ts';
import { PollService } from '../services/poll.ts';
import { PrivateMessagingService } from '../services/private_messaging.ts';
import { SharedChatAdministrationService } from '../services/shared_chat_administration.ts';
import { SupergroupMessagingService } from '../services/supergroup_messaging.ts';
import { VirtualUserService } from '../services/virtual_user.ts';
import {
  MAX_WEB_FILE_REDIRECTS,
  WEB_FILE_DOWNLOAD_TIMEOUT_MILLISECONDS,
  WebFileDownloader,
} from '../services/web_file_download.ts';
import { WebResourceService } from '../services/web_resource.ts';

export function createEmulationSession(
  id: string,
  { uploadProfile }: EmulationSessionOptions,
): EmulationSession {
  const identities = new TelegramIdentityRepository();
  const accounts = new AccountRepository();
  const bots = new BotRepository();
  const virtualUsers = new VirtualUserService({ identities, accounts, bots });
  const getAccountPrivateForwardName = (userId: number) => {
    const account = accounts.getById(userId);
    return account === undefined ? undefined : getPrivateForwardName(account);
  };
  const sharedChats = new SharedChatRepository();
  const messages = new MessageRepository();
  const files = new FileRepository();
  const polls = new PollRepository();
  const messageBoxes = new MessageBoxRepository();
  const botUpdates = new BotUpdateRepository();
  const updateSubscriptions = new BotUpdateSubscriptionRepository();
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
  });
  const currentUnixTimeSeconds = () => Math.floor(Date.now() / 1_000);
  const supergroupMessaging = new SupergroupMessagingService({
    accounts,
    bots,
    sharedChats,
    messages,
    files,
    polls,
    messageBoxes,
    events: botUpdateDelivery,
    currentUnixTimeSeconds,
  });
  const sharedChatAdministration = new SharedChatAdministrationService({
    identities,
    accounts,
    bots,
    sharedChats,
    supergroupMessages: supergroupMessaging,
    events: botUpdateDelivery,
    currentUnixTimeSeconds,
  });
  const privateConversations = new PrivateConversationRepository();
  const blockedUsers = new BlockedUserRepository();
  const privateMessaging = new PrivateMessagingService({
    accounts,
    bots,
    privateConversations,
    messages,
    files,
    polls,
    messageBoxes,
    blockedUsers,
    events: botUpdateDelivery,
    currentUnixTimeSeconds,
  });
  const messageForwarding = new MessageForwardingService({
    privateMessages: privateMessaging,
    supergroupMessages: supergroupMessaging,
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
    }),
  });
  const botBlocking = new BotBlockingService({
    accounts,
    bots,
    blockedUsers,
    events: botUpdateDelivery,
    currentUnixTimeSeconds,
  });
  const callbackQueries = new CallbackQueryService({
    accounts,
    bots,
    privateConversations,
    privateMessages: privateMessaging,
    sharedChats,
    supergroupMessages: supergroupMessaging,
    callbackQueries: new CallbackQueryRepository(),
    events: botUpdateDelivery,
  });
  const pollAnswers = new PollService({
    accounts,
    bots,
    privateConversations,
    privateMessages: privateMessaging,
    sharedChats,
    supergroupMessages: supergroupMessaging,
    polls,
  });
  const inlineQueries = new InlineQueryService({
    accounts,
    bots,
    sharedChats,
    privateMessages: privateMessaging,
    supergroupMessages: supergroupMessaging,
    inlineQueries: new InlineQueryRepository(),
    events: botUpdateDelivery,
    currentTimeMilliseconds: () => Date.now(),
  });

  const chatActions = new ChatActionService({
    accounts,
    bots,
    sharedChats,
    chatActions: new ChatActionRepository(),
    currentTimeMilliseconds: () => Date.now(),
  });

  const botCommands = new BotCommandService({
    accounts,
    bots,
    privateConversations,
    supergroupMembers: sharedChats,
    botCommands: new BotCommandRepository(),
  });

  const botDescriptions = new BotDescriptionService({
    bots,
    botDescriptions: new BotDescriptionRepository(),
  });

  const defaultAdministratorRights = new BotDefaultAdministratorRightsService({
    bots,
    defaultAdministratorRights: new BotDefaultAdministratorRightsRepository(),
  });

  const botMenuButtons = new BotMenuButtonService({
    accounts,
    bots,
    menuButtons: new BotMenuButtonRepository(),
  });

  const botRateLimits = new BotRateLimitService({
    bots,
    rateLimitResponses: new BotRateLimitRepository(),
  });

  const botActivity = new BotActivityService({ log: new BotActivityLogRepository() });
  const botUpdatePolling = new BotUpdatePollingService({
    botUpdates,
    updateSubscriptions,
    updateActivity: botActivity,
  });
  const botWebhooks = new BotWebhookService({
    webhooks: new BotWebhookRepository(),
    pendingUpdates: botUpdates,
    updateSubscriptions,
    updateActivity: botActivity,
    sendWebhookRequest: (request) => fetch(request),
    runWebhookReply: async (botId, reply, signal) => {
      const bot = bots.getById(botId);
      if (bot !== undefined) {
        await runWebhookReply({ session, bot: bot.profile, signal, via: 'webhook_reply' }, reply);
      }
    },
    attemptTimeoutMilliseconds: WEBHOOK_ATTEMPT_TIMEOUT_MILLISECONDS,
    waitBeforeRetry: waitForRetryDelay,
    currentUnixTimeSeconds,
  });
  const botApi = new BotApiService({
    bots,
    updatePolling: botUpdatePolling,
    webhooks: botWebhooks,
    botMessages: privateMessaging,
    supergroupBotMessages: supergroupMessaging,
    chatMemberships: sharedChatAdministration,
    botMessageViews,
    mediaFiles,
    callbackQueries,
    inlineQueries,
    inlineMessages: messages,
    mediaGroups: messages,
    polls,
    // As the messaging services decide it, a text mention may name any user of the session.
    botCaptions: {
      normalizeBotCaption: (caption) =>
        normalizeCaption(caption, 'bot', {
          isMentionableUser: (userId) =>
            accounts.getById(userId) !== undefined || bots.getById(userId) !== undefined,
        }),
    },
    botCommands,
    botDescriptions,
    defaultAdministratorRights,
    menuButtons: botMenuButtons,
    chatActions,
    publicChats: sharedChatAdministration,
    getPrivateForwardName: getAccountPrivateForwardName,
  });

  const session: EmulationSession = {
    id,
    uploadProfile,
    virtualUsers,
    sharedChatAdministration,
    privateMessaging,
    supergroupMessaging,
    messageForwarding,
    botBlocking,
    callbackQueries,
    pollAnswers,
    inlineQueries,
    botCommands,
    botMenuButtons,
    chatActions,
    botMessageViews,
    mediaFiles,
    webResources,
    botRateLimits,
    botApi,
    botActivity,
    end: () => {
      botUpdatePolling.endLongPolling();
      botWebhooks.endDelivery();
      botActivity.endReading();
    },
  };
  return session;
}
