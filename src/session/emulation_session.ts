import type { BotActivityService } from '../services/bot_activity/bot_activity.ts';
import type { BotApiService } from '../services/bot_api/bot_api.ts';
import type { BotBlockingService } from '../services/domain/bot_blocking.ts';
import type { BotCommandService } from '../services/domain/bot_command.ts';
import type { BotMenuButtonService } from '../services/domain/bot_menu_button.ts';
import type { BotMessageViewService } from '../services/bot_message_view/bot_message_view.ts';
import type { BotRateLimitService } from '../services/domain/bot_rate_limit.ts';
import type { BotServerErrorService } from '../services/domain/bot_server_error.ts';
import type { CallbackQueryService } from '../services/domain/callback_query.ts';
import type { ChatActionService } from '../services/domain/chat_action.ts';
import type { ChatAdmissionService } from '../services/domain/chat_admission.ts';
import type { InlineQueryService } from '../services/domain/inline_query.ts';
import type { MediaFileService } from '../services/domain/media_file.ts';
import type { MessageDraftService } from '../services/domain/message_draft.ts';
import type { MessageDeletionService } from '../services/domain/message_deletion.ts';
import type { MessageEditingService } from '../services/domain/message_editing.ts';
import type { MessageForwardingService } from '../services/domain/message_forwarding.ts';
import type { MessagePinningService } from '../services/domain/message_pinning.ts';
import type { MessageReactionService } from '../services/domain/message_reaction.ts';
import type { MessageSendingService } from '../services/domain/message_sending.ts';
import type { PollService } from '../services/domain/poll.ts';
import type { PrivateMessagingService } from '../services/domain/private_messaging.ts';
import type { ReplyInterfaceService } from '../services/domain/reply_interface.ts';
import type { SessionLifetime } from '../services/session_lifetime/session_lifetime.ts';
import type { SharedChatAdministrationService } from '../services/domain/shared_chat_administration.ts';
import type { SupergroupMessagingService } from '../services/domain/supergroup_messaging.ts';
import type { VirtualUserService } from '../services/domain/virtual_user.ts';
import type { WebResourceService } from '../services/domain/web_resource.ts';
import type { WebhookAttemptScheduler } from '../services/webhook_delivery/webhook_attempt_scheduler.ts';
import type { SessionTransactions } from '../transactions/session/session_transactions.ts';
import type { UploadProfile } from '../types/upload_profile.ts';

/** Settings chosen when a session is created, which stay fixed for its lifetime. */
export interface EmulationSessionOptions {
  readonly uploadProfile: UploadProfile;
}

/**
 * The application capabilities of one isolated Telegram emulation.
 *
 * Repositories stay private to composition so that each invariant has a single service owner.
 */
export interface EmulationSession extends EmulationSessionOptions {
  readonly id: string;
  readonly virtualUsers: VirtualUserService;
  readonly sharedChatAdministration: SharedChatAdministrationService;
  readonly chatAdmission: ChatAdmissionService;
  readonly privateMessaging: PrivateMessagingService;
  readonly supergroupMessaging: SupergroupMessagingService;
  readonly messageSending: MessageSendingService;
  readonly messageEditing: MessageEditingService;
  readonly messageDeletion: MessageDeletionService;
  readonly messageForwarding: MessageForwardingService;
  readonly messagePinning: MessagePinningService;
  readonly messageReactions: MessageReactionService;
  readonly replyInterfaces: ReplyInterfaceService;
  readonly botBlocking: BotBlockingService;
  readonly callbackQueries: CallbackQueryService;
  readonly polls: PollService;
  readonly inlineQueries: InlineQueryService;
  readonly botCommands: BotCommandService;
  readonly botMenuButtons: BotMenuButtonService;
  readonly chatActions: ChatActionService;
  readonly messageDrafts: MessageDraftService;
  readonly botMessageViews: BotMessageViewService;
  readonly mediaFiles: MediaFileService;
  readonly webResources: WebResourceService;
  readonly botRateLimits: BotRateLimitService;
  readonly botServerErrors: BotServerErrorService;
  readonly botApi: BotApiService;
  readonly botActivity: BotActivityService;
  readonly webhookAttempts: WebhookAttemptScheduler;
  /** When the session ends, and whether work may still change it. */
  readonly lifetime: SessionLifetime;
  /** The transactions in which the session's commands change it, and are published. */
  readonly transactions: SessionTransactions;
  /**
   * Ends the session for good. Its lifetime's signal aborts and its commit gate closes, so Bot API
   * calls still running, webhook replies included, change nothing more: their downloads stop, and
   * a call that outlives the end is refused before it commits or is recorded. Held long polls and
   * bot activity reads are answered, later ones do not wait, and webhooks stop, including requests
   * in flight and retry waits, which are cancelled.
   */
  end(): void;
}
