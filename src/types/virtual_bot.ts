import type { User } from 'grammy/types';

/** A bot's `getMe` profile for the emulator's Bot API 10.3 baseline. */
export interface VirtualBotProfile extends Readonly<User> {
  readonly is_bot: true;
  readonly username: string;
  readonly can_join_groups: boolean;
  readonly can_read_all_group_messages: boolean;
  readonly supports_guest_queries?: boolean;
  readonly supports_inline_queries: boolean;
  readonly can_connect_to_business: boolean;
  readonly has_main_web_app: boolean;
  readonly has_topics_enabled: boolean;
  readonly allows_users_to_create_topics: boolean;
  readonly can_manage_bots: boolean;
  readonly supports_join_request_queries: boolean;
}

export interface VirtualBot {
  readonly token: string;
  readonly profile: VirtualBotProfile;
  /**
   * Whether the bot receives a `chosen_inline_result` update for each inline query result an
   * account sends, as BotFather's inline feedback setting turns on. It matters only for a bot that
   * supports inline queries.
   */
  readonly receivesChosenInlineResults: boolean;
  /**
   * Whether accounts share their location with the bot's inline queries, as BotFather's inline
   * location setting asks them to. It matters only for a bot that supports inline queries.
   */
  readonly requestsInlineLocation: boolean;
  /**
   * Whether the bot turned on BotFather's Bot-to-Bot Communication Mode, which lets a supergroup
   * message of one bot reach another bot it addresses when either of the two turned it on, and a
   * private message between two bots be sent when both turned it on.
   */
  readonly enablesBotToBotCommunication: boolean;
}
