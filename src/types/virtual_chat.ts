import type { ChatPermissions } from './chat_permissions.ts';

export interface PrivateConversationKey {
  readonly accountId: number;
  readonly botId: number;
}

/**
 * What a bot shows it is doing in a chat, such as typing, by the Bot API names. `cancel` stops
 * showing an action.
 */
export type ChatAction =
  | 'cancel'
  | 'typing'
  | 'record_video'
  | 'upload_video'
  | 'record_voice'
  | 'upload_voice'
  | 'upload_photo'
  | 'upload_document'
  | 'choose_sticker'
  | 'find_location'
  | 'record_video_note'
  | 'upload_video_note';

/** A chat action a bot shows, which `cancel` is not. */
export type ShownChatActionType = Exclude<ChatAction, 'cancel'>;

/**
 * How long clients show a bot's chat action unless the bot renews it, as TDLib's
 * `DialogActionManager::DIALOG_ACTION_TIMEOUT` sets it.
 */
export const CHAT_ACTION_TIMEOUT_MILLISECONDS = 5_500;

/** A chat action an account's client shows: which bot shows it, and what the bot is doing. */
export interface VisibleChatAction {
  readonly botId: number;
  readonly action: ShownChatActionType;
}

/** A chat a bot shows chat actions in: a private conversation, or a supergroup. */
export type ChatActionChat =
  | { readonly type: 'private'; readonly accountId: number; readonly botId: number }
  | { readonly type: 'supergroup'; readonly chatId: number };

/** Which participant of a private conversation, identified relative to its key. */
export type PrivateConversationRole = 'account' | 'bot';

export interface PrivateConversation extends PrivateConversationKey {
  readonly kind: 'private';
  /**
   * Telegram's `chat_instance`: an opaque signed 64-bit decimal that identifies the chat in
   * callback queries from its messages.
   */
  readonly chatInstance: string;
}

interface SharedChatBase {
  readonly id: number;
  readonly title: string;
}

export interface BasicGroup extends SharedChatBase {
  readonly kind: 'basic_group';
}

export interface Supergroup extends SharedChatBase {
  readonly kind: 'supergroup';
  /**
   * The public username that makes the supergroup public, by which bots can address it as
   * `@username`; omitted for a private supergroup. It is unique among the session's usernames,
   * compared without case.
   */
  readonly username?: string;
  readonly description?: string;
  /** Telegram's `chat_instance` of the supergroup, as `PrivateConversation` describes it. */
  readonly chatInstance: string;
  /**
   * Whether the owner protects all of the supergroup's messages from forwarding and saving, as
   * Telegram's "Restrict saving content" setting does, whoever sent them and whenever.
   */
  readonly hasProtectedContent: boolean;
  /**
   * What members may do unless a restriction of their own withholds more: the permissions that
   * Telegram's `default_banned_rights` of a supergroup does not ban. Administrators are exempt.
   */
  readonly defaultPermissions: ChatPermissions;
}

export interface Channel extends SharedChatBase {
  readonly kind: 'channel';
  readonly description?: string;
}

export type SharedChat = BasicGroup | Supergroup | Channel;

/** Creates a `chat_instance`: Telegram's chat instances look like random signed 64-bit integers. */
export function createChatInstance(): string {
  return crypto.getRandomValues(new BigInt64Array(1))[0].toString();
}
