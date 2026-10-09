import type { UserFromGetMe } from 'grammy/types';

export type VirtualBotProfile = Readonly<UserFromGetMe>;

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
   * message of one bot reach another bot it addresses when either of the two turned it on.
   */
  readonly enablesBotToBotCommunication: boolean;
}
