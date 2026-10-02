import type { BotActivityService } from '../services/bot_activity.ts';
import type { BotApiService } from '../services/bot_api.ts';
import type { BotBlockingService } from '../services/bot_blocking.ts';
import type { BotCommandService } from '../services/bot_command.ts';
import type { BotMenuButtonService } from '../services/bot_menu_button.ts';
import type { BotMessageViewService } from '../services/bot_message_view.ts';
import type { BotRateLimitService } from '../services/bot_rate_limit.ts';
import type { CallbackQueryService } from '../services/callback_query.ts';
import type { ChatActionService } from '../services/chat_action.ts';
import type { InlineQueryService } from '../services/inline_query.ts';
import type { MediaFileService } from '../services/media_file.ts';
import type { MessageForwardingService } from '../services/message_forwarding.ts';
import type { PollService } from '../services/poll.ts';
import type { PrivateMessagingService } from '../services/private_messaging.ts';
import type { SharedChatAdministrationService } from '../services/shared_chat_administration.ts';
import type { SupergroupMessagingService } from '../services/supergroup_messaging.ts';
import type { VirtualUserService } from '../services/virtual_user.ts';
import type { WebResourceService } from '../services/web_resource.ts';
import type { UploadProfile } from './upload_profile.ts';

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
  readonly privateMessaging: PrivateMessagingService;
  readonly supergroupMessaging: SupergroupMessagingService;
  readonly messageForwarding: MessageForwardingService;
  readonly botBlocking: BotBlockingService;
  readonly callbackQueries: CallbackQueryService;
  readonly polls: PollService;
  readonly inlineQueries: InlineQueryService;
  readonly botCommands: BotCommandService;
  readonly botMenuButtons: BotMenuButtonService;
  readonly chatActions: ChatActionService;
  readonly botMessageViews: BotMessageViewService;
  readonly mediaFiles: MediaFileService;
  readonly webResources: WebResourceService;
  readonly botRateLimits: BotRateLimitService;
  readonly botApi: BotApiService;
  readonly botActivity: BotActivityService;
  /**
   * Stops the session from keeping requests waiting and from delivering updates: held long polls
   * and bot activity reads are answered, later ones do not wait, and webhooks stop, including
   * requests in flight. Requests that are already running complete against the session's state.
   */
  end(): void;
}
